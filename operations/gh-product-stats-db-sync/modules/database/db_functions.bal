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

# Read all active repositories the cron should sync.
#
# + return - List of active tracked repositories, or an error
public isolated function getActiveTrackedRepositories() returns TrackedRepository[]|error {
    stream<TrackedRepository, sql:Error?> resultStream = databaseClient->query(getActiveTrackedRepositoriesQuery());
    return from TrackedRepository repo in resultStream
        select repo;
}

# Insert a STARTED row into `sync_job_logs` and return its generated id.
#
# + return - The generated sync job id, or an error
public isolated function startSyncJob() returns int|error {
    sql:ExecutionResult result = check databaseClient->execute(startSyncJobQuery());
    int|string? lastInsertId = result.lastInsertId;
    if lastInsertId is int {
        return lastInsertId;
    }
    return error("Failed to obtain generated sync_job_logs id");
}

# Finalize a sync job row with its terminal status and counts.
#
# + jobId - The sync job id returned by `startSyncJob`
# + status - One of SUCCESS / PARTIAL_FAILURE / FAILED
# + reposSynced - Number of repositories synced successfully
# + reposFailed - Number of repositories that failed
# + errorMessage - Aggregated error message (null if none)
# + return - An error if the update fails
public isolated function completeSyncJob(int jobId, SyncJobStatus status, int reposSynced, int reposFailed,
        string? errorMessage) returns error? {
    _ = check databaseClient->execute(completeSyncJobQuery(jobId, status, reposSynced, reposFailed, errorMessage));
}

# Upsert a single repository's daily snapshot (repo row + all asset rows) in one transaction.
# Idempotent for the same day via ON DUPLICATE KEY UPDATE on the `snapshot_date` unique keys.
#
# + trackedRepoId - `tracked_repositories.id`
# + snapshotDate - The UTC date ("YYYY-MM-DD") to record this snapshot under
# + repoData - Repo-level snapshot values
# + assets - Asset-level snapshot values (already prefix-filtered)
# + return - An error if any write fails (rolls back the transaction)
public isolated function writeRepoSnapshot(int trackedRepoId, string snapshotDate, RepoSnapshotData repoData,
        AssetSnapshotData[] assets) returns error? {
    transaction {
        _ = check databaseClient->execute(repositorySnapshotUpsertQuery(trackedRepoId, snapshotDate, repoData));
        foreach AssetSnapshotData asset in assets {
            _ = check databaseClient->execute(assetSnapshotUpsertQuery(trackedRepoId, snapshotDate, asset));
        }
        check commit;
    }
}
