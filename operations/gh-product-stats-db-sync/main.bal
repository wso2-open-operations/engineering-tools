// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
import gh_product_stats_db_sync.database;
import gh_product_stats_db_sync.entity;

import ballerina/log;
import ballerina/time;

// One-shot daily sync. The schedule is supplied externally by the Choreo Scheduled Task.
// All GitHub data is fetched through the Engineering Entity REST service; the cron makes
// zero direct GitHub API calls.

@display {
    label: "Github API stats DB sync",
    id: "github_stats_db_sync"
}
public function main() returns error? {
    log:printInfo("GitHub stats to database sync task started.");
    error? result = run();
    if result is error {
        log:printError("GitHub stats to database sync task failed.", result);
        return result;
    }
    log:printInfo("GitHub stats to database sync task completed.");
}

# Run a full daily sync: read active repos, sync each in isolation, log the outcome.
#
# + return - A fatal error if the job could not start or repos could not be read
isolated function run() returns error? {
    int jobId = check database:startSyncJob();
    log:printInfo("Sync job started", jobId = jobId);

    database:TrackedRepository[] repos;
    do {
        repos = check database:getActiveTrackedRepositories();
    } on fail error e {
        string message = "Failed to read tracked_repositories: " + e.message();
        check database:completeSyncJob(jobId, "FAILED", 0, 0, message);
        log:printError(message, e);
        return e;
    }

    int reposSynced = 0;
    int reposFailed = 0;
    string[] errors = [];

    foreach database:TrackedRepository repo in repos {
        do {
            check syncRepository(repo);
            reposSynced += 1;
        } on fail error e {
            reposFailed += 1;
            errors.push(string `${repo.org_name}/${repo.repo_name}: ${e.message()}`);
            log:printError("Repository sync failed", e, repo = repo.repo_name, org = repo.org_name);
        }
    }

    database:SyncJobStatus status = reposFailed == 0 ? "SUCCESS" : (reposSynced == 0 ? "FAILED" : "PARTIAL_FAILURE");
    string? errorMessage = errors.length() == 0 ? () : string:'join("; ", ...errors);
    check database:completeSyncJob(jobId, status, reposSynced, reposFailed, errorMessage);
    log:printInfo("Sync job completed", status = status, reposSynced = reposSynced, reposFailed = reposFailed);
}

# Sync a single repository. Releases and repo-stats failures are fatal for this repo;
# clone-traffic failures are soft (stored as 0).
#
# + repo - The tracked repository to sync
# + return - An error if the repo's releases/repo-stats fetch or DB write fails
isolated function syncRepository(database:TrackedRepository repo) returns error? {
    string org = repo.org_name;
    string name = repo.repo_name;
    string[] prefixes = toPrefixes(repo.asset_prefixes);

    // Hard dependencies: a failure here marks the whole repo failed.
    entity:Repository repository = check entity:getRepository(org, name);
    entity:Release[] releases = check entity:getAllReleases(org, name);

    // Single UTC instant for all of this repo's date math.
    time:Utc now = time:utcNow();

    // snapshot_date is stamped with the cron's run date (today), matching the
    // convention already baked into the migrated historical data (see
    // resources/migrations — legacy rows use DATE(created_at), i.e. the sync date,
    // not the date the data represents). NOTE: the cumulative totals fetched below
    // (downloads/stars/forks/watchers/issues) are still, in truth, the state as of
    // the END of the PREVIOUS day — GitHub's API only reports a running cumulative
    // count, so a same-day delta can never exist. Downstream consumers must treat
    // "this row's delta" as "yesterday's real activity, labeled with today's date."
    string snapshotDate = formatUtcDate(now);

    // Soft dependency: clone traffic needs Administration:read; store 0 if unavailable.
    // GitHub's clone count/uniques for the current UTC day are cumulative-and-partial
    // until the day closes, so match yesterday's — the most recent *complete* — day
    // instead, even though it's stored under today's snapshotDate above (same
    // one-day-behind reality as the download/star/fork figures).
    int cloneCount = 0;
    int cloneUniques = 0;
    entity:ClonesTraffic|error clones = entity:getClonesTraffic(org, name);
    if clones is entity:ClonesTraffic {
        string yesterday = formatUtcDate(time:utcAddSeconds(now, -86400));
        foreach entity:CloneRecord cloneRecord in clones.clones {
            if cloneRecord.timestamp.startsWith(yesterday) {
                cloneCount = cloneRecord.count;
                cloneUniques = cloneRecord.uniques;
                break;
            }
        }
    } else {
        log:printWarn("Clone traffic fetch failed; storing 0", clones, repo = name, org = org);
    }

    // Filter assets by prefix, build asset snapshots, and total the filtered downloads.
    database:AssetSnapshotData[] assetSnapshots = [];
    int totalDownloadCount = 0;
    foreach entity:Release release in releases {
        foreach entity:Asset asset in release.assets {
            if matchesPrefix(asset.name, prefixes) {
                totalDownloadCount += asset.downloadCount;
                assetSnapshots.push({
                    releaseTag: release.tagName,
                    releaseName: release.name,
                    assetName: asset.name,
                    assetGithubId: asset.id,
                    contentType: asset.contentType,
                    assetSize: asset.size,
                    downloadCount: asset.downloadCount
                });
            }
        }
    }

    database:RepoSnapshotData repoData = {
        totalDownloadCount,
        forksCount: repository.forksCount ?: 0,
        stargazersCount: repository.stargazersCount ?: 0,
        watchersCount: repository.watchersCount ?: 0,
        openIssuesCount: repository.openIssuesCount ?: 0,
        cloneCount,
        cloneUniques
    };
    check database:writeRepoSnapshot(repo.id, snapshotDate, repoData, assetSnapshots);
}

# True if the asset name matches the prefix filter. An empty prefix list means "include all".
#
# + assetName - The asset file name
# + prefixes - Configured asset-name prefixes
# + return - Whether the asset should be included
isolated function matchesPrefix(string assetName, string[] prefixes) returns boolean {
    if prefixes.length() == 0 {
        return true;
    }
    foreach string prefix in prefixes {
        if assetName.startsWith(prefix) {
            return true;
        }
    }
    return false;
}

# Parse the `asset_prefixes` JSON column into a string array. Null/invalid => empty (include all).
#
# + prefixes - The raw JSON value from the DB
# + return - The list of prefixes
isolated function toPrefixes(json prefixes) returns string[] {
    json[] values;
    if prefixes is json[] {
        values = prefixes;
    } else if prefixes is string {
        json|error parsed = prefixes.fromJsonString();
        values = parsed is json[] ? parsed : [];
    } else {
        return [];
    }
    string[] result = [];
    foreach json value in values {
        if value is string {
            result.push(value);
        }
    }
    return result;
}

# Formats a UTC instant as "YYYY-MM-DD".
#
# + utc - The UTC instant to format
# + return - The formatted date string
isolated function formatUtcDate(time:Utc utc) returns string {
    time:Civil civil = time:utcToCivil(utc);
    string month = civil.month < 10 ? "0" + civil.month.toString() : civil.month.toString();
    string day = civil.day < 10 ? "0" + civil.day.toString() : civil.day.toString();
    return string `${civil.year}-${month}-${day}`;
}
