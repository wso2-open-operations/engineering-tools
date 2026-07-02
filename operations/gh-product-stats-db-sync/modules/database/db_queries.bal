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
import ballerina/sql;

# Build query to read all active tracked repositories.
#
# + return - sql:ParameterizedQuery - Select query for the tracked_repositories table
isolated function getActiveTrackedRepositoriesQuery() returns sql:ParameterizedQuery =>
`
    SELECT
        id,
        org_name,
        repo_name,
        asset_prefixes
    FROM
        tracked_repositories
    WHERE
        is_active = 1
`;

# Build query to insert a STARTED row into sync_job_logs.
#
# + return - sql:ParameterizedQuery - Insert query for the sync_job_logs table
isolated function startSyncJobQuery() returns sql:ParameterizedQuery =>
`
    INSERT INTO sync_job_logs
        (status, started_at)
    VALUES
        ('STARTED', NOW())
`;

# Build query to finalize a sync job with its terminal status and counts.
#
# + jobId - The sync job id returned by the start query
# + status - One of SUCCESS / PARTIAL_FAILURE / FAILED
# + reposSynced - Number of repositories synced successfully
# + reposFailed - Number of repositories that failed
# + errorMessage - Aggregated error message (null if none)
# + return - sql:ParameterizedQuery - Update query for the sync_job_logs table
isolated function completeSyncJobQuery(int jobId, SyncJobStatus status, int reposSynced, int reposFailed,
        string? errorMessage) returns sql:ParameterizedQuery =>
`
    UPDATE sync_job_logs
    SET
        status = ${status},
        repos_synced = ${reposSynced},
        repos_failed = ${reposFailed},
        error_message = ${errorMessage},
        completed_at = NOW()
    WHERE
        id = ${jobId}
`;

# Build the upsert query for a repository's daily snapshot.
# Idempotent for the same day via ON DUPLICATE KEY UPDATE on the snapshot_date unique key.
#
# + trackedRepoId - tracked_repositories.id
# + snapshotDate - The UTC date ("YYYY-MM-DD") to record this snapshot under
# + repoData - Repo-level snapshot values
# + return - sql:ParameterizedQuery - Upsert query for the repository_daily_snapshots table
isolated function repositorySnapshotUpsertQuery(int trackedRepoId, string snapshotDate, RepoSnapshotData repoData)
    returns sql:ParameterizedQuery =>
`
    INSERT INTO repository_daily_snapshots
        (tracked_repo_id, total_download_count, forks_count, stargazers_count, watchers_count,
         open_issues_count, clone_count, clone_uniques, snapshot_date)
    VALUES
        (${trackedRepoId}, ${repoData.totalDownloadCount}, ${repoData.forksCount},
         ${repoData.stargazersCount}, ${repoData.watchersCount}, ${repoData.openIssuesCount},
         ${repoData.cloneCount}, ${repoData.cloneUniques}, ${snapshotDate})
    ON DUPLICATE KEY UPDATE
        total_download_count = VALUES(total_download_count),
        forks_count = VALUES(forks_count),
        stargazers_count = VALUES(stargazers_count),
        watchers_count = VALUES(watchers_count),
        open_issues_count = VALUES(open_issues_count),
        clone_count = VALUES(clone_count),
        clone_uniques = VALUES(clone_uniques)
`;

# Build the upsert query for a single release asset's daily snapshot.
# Idempotent for the same day via ON DUPLICATE KEY UPDATE on the snapshot_date unique key.
#
# + trackedRepoId - tracked_repositories.id
# + snapshotDate - The UTC date ("YYYY-MM-DD") to record this snapshot under
# + asset - Asset-level snapshot values (already prefix-filtered)
# + return - sql:ParameterizedQuery - Upsert query for the release_asset_daily_snapshots table
isolated function assetSnapshotUpsertQuery(int trackedRepoId, string snapshotDate, AssetSnapshotData asset)
    returns sql:ParameterizedQuery =>
`
    INSERT INTO release_asset_daily_snapshots
        (tracked_repo_id, release_tag, release_name, asset_name, asset_github_id,
         content_type, asset_size, download_count, snapshot_date)
    VALUES
        (${trackedRepoId}, ${asset.releaseTag}, ${asset.releaseName}, ${asset.assetName},
         ${asset.assetGithubId}, ${asset.contentType}, ${asset.assetSize},
         ${asset.downloadCount}, ${snapshotDate})
    ON DUPLICATE KEY UPDATE
        release_tag = VALUES(release_tag),
        release_name = VALUES(release_name),
        asset_name = VALUES(asset_name),
        content_type = VALUES(content_type),
        asset_size = VALUES(asset_size),
        download_count = VALUES(download_count)
`;
