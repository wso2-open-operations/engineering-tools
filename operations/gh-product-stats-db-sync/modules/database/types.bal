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
import ballerinax/mysql;

# [Configurable] Github Stats database configs.
#
# + user - User of the database
# + password - Password of the database
# + database - Name of the database
# + host - Host of the database
# + port - Port of the database
# + connectionPool - Database connection pool
type DatabaseConfig record {|
    string user;
    string password;
    string database;
    string host;
    int port;
    sql:ConnectionPool connectionPool;
|};

# Database client config record.
#
# + options - Additional configurations related to the MySQL database connection
type DatabaseClientConfig record {|
    *DatabaseConfig;
    mysql:Options? options;
|};

# Terminal status values for a `sync_job_logs` row. Mirrors the `sync_job_logs.status`
# ENUM column (minus the transient `STARTED` value, which `startSyncJobQuery` sets directly).
public type SyncJobStatus "SUCCESS"|"PARTIAL_FAILURE"|"FAILED";

# An active row from the `tracked_repositories` table.
#
# + id - Primary key (used as `tracked_repo_id` foreign key in snapshots)
# + org_name - GitHub org name (used for both the Entity `orgName` and `owner` path segments)
# + repo_name - Repository name
# + asset_prefixes - JSON array of asset-name prefixes to include (null/empty => all assets)
public type TrackedRepository record {|
    int id;
    string org_name;
    string repo_name;
    json asset_prefixes;
|};

# Repo-level snapshot values to upsert into `repository_daily_snapshots`.
#
# + totalDownloadCount - Sum of download counts across filtered assets
# + forksCount - Number of forks
# + stargazersCount - Number of stargazers
# + watchersCount - Number of watchers
# + openIssuesCount - Number of open issues
# + cloneCount - Yesterday's (most recently complete day's) clone count (0 if unavailable)
# + cloneUniques - Yesterday's (most recently complete day's) unique cloners (0 if unavailable)
public type RepoSnapshotData record {|
    int totalDownloadCount;
    int forksCount;
    int stargazersCount;
    int watchersCount;
    int openIssuesCount;
    int cloneCount;
    int cloneUniques;
|};

# Asset-level snapshot values to upsert into `release_asset_daily_snapshots`.
#
# + releaseTag - Git tag of the release
# + releaseName - Release title (may be null)
# + assetName - Asset file name
# + assetGithubId - GitHub asset ID
# + contentType - MIME type (may be null)
# + assetSize - Asset size in bytes
# + downloadCount - The asset's own download count
public type AssetSnapshotData record {|
    string releaseTag;
    string? releaseName;
    string assetName;
    int assetGithubId;
    string? contentType;
    int assetSize;
    int downloadCount;
|};
