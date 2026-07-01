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

package store

// All JSON field names use camelCase, per the portal response-shape convention.

// Repository is a row from tracked_repositories.
type Repository struct {
	ID            int      `json:"id"`
	OrgName       string   `json:"orgName"`
	RepoName      string   `json:"repoName"`
	ProductName   *string  `json:"productName"`
	AssetPrefixes []string `json:"assetPrefixes"`
	IsActive      bool     `json:"isActive"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

// RepoSnapshot is the latest repository_daily_snapshots row for a repository.
type RepoSnapshot struct {
	SnapshotDate       string `json:"snapshotDate"`
	TotalDownloadCount int64  `json:"totalDownloadCount"`
	ForksCount         int    `json:"forksCount"`
	StargazersCount    int    `json:"stargazersCount"`
	WatchersCount      int    `json:"watchersCount"`
	OpenIssuesCount    int    `json:"openIssuesCount"`
	CloneCount         int    `json:"cloneCount"`
	CloneUniques       int    `json:"cloneUniques"`
}

// RepositoryWithStats pairs a tracked repository with its most recent snapshot.
type RepositoryWithStats struct {
	Repository
	LatestSnapshot *RepoSnapshot `json:"latestSnapshot"`
}

// Summary holds the dashboard KPI figures.
type Summary struct {
	TrackedRepositories int          `json:"trackedRepositories"`
	TotalDownloads      int64        `json:"totalDownloads"`
	TotalStars          int          `json:"totalStars"`
	TotalForks          int          `json:"totalForks"`
	TotalClonesLast30d  int          `json:"totalClonesLast30d"`
	TotalClonesLast14d  int          `json:"totalClonesLast14d"`
	TodayDownloads      int64        `json:"todayDownloads"`
	TodayDeltaPct       *float64     `json:"todayDeltaPct"`
	MonthDownloads      int64        `json:"monthDownloads"`
	LastSyncDate        *string      `json:"lastSyncDate"`
	LastSyncStatus      *string      `json:"lastSyncStatus"`
	TopProducts         []TopProduct `json:"topProducts"`
}

// TopProduct is a ranked repository row for the Overview "top products" table.
type TopProduct struct {
	RepoID         int     `json:"repoId"`
	RepoName       string  `json:"repoName"`
	ProductName    *string `json:"productName"`
	TodayDownloads int64   `json:"todayDownloads"`
	TotalDownloads int64   `json:"totalDownloads"`
	Stars          int     `json:"stars"`
}

// TimeSeriesPoint is a single (date, value) data point.
type TimeSeriesPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

// RepoSeries is a per-repository time series (used by total and daily endpoints).
type RepoSeries struct {
	RepoID   int               `json:"repoId"`
	RepoName string            `json:"repoName"`
	Points   []TimeSeriesPoint `json:"points"`
}

// ClonePoint is a single day's clone traffic value.
type ClonePoint struct {
	Date    string `json:"date"`
	Count   int    `json:"count"`
	Uniques int    `json:"uniques"`
}

// CloneSeries is a per-repository clone-traffic time series.
type CloneSeries struct {
	RepoID   int          `json:"repoId"`
	RepoName string       `json:"repoName"`
	Points   []ClonePoint `json:"points"`
}

// VersionBreakdownItem is the total download count for one release version.
type VersionBreakdownItem struct {
	ReleaseTag    string  `json:"releaseTag"`
	ReleaseName   *string `json:"releaseName"`
	DownloadCount int64   `json:"downloadCount"`
}

// VersionBreakdown is the per-version download breakdown for a repository at a
// single snapshot date.
type VersionBreakdown struct {
	RepoID       int                    `json:"repoId"`
	SnapshotDate string                 `json:"snapshotDate"`
	Versions     []VersionBreakdownItem `json:"versions"`
}

// VersionSeries is a per-release-tag download time series (for the version chart).
type VersionSeries struct {
	ReleaseTag  string            `json:"releaseTag"`
	ReleaseName *string           `json:"releaseName"`
	Points      []TimeSeriesPoint `json:"points"`
}

// AssetBreakdownItem is the download count for a single release asset.
type AssetBreakdownItem struct {
	ReleaseTag    string  `json:"releaseTag"`
	AssetName     string  `json:"assetName"`
	AssetGithubID int     `json:"assetGithubId"`
	ContentType   *string `json:"contentType"`
	AssetSize     *int64  `json:"assetSize"`
	DownloadCount int64   `json:"downloadCount"`
}

// AssetBreakdown is the per-asset download breakdown for a repository at a single
// snapshot date, optionally filtered to one release version.
type AssetBreakdown struct {
	RepoID       int                  `json:"repoId"`
	SnapshotDate string               `json:"snapshotDate"`
	Version      *string              `json:"version"`
	Assets       []AssetBreakdownItem `json:"assets"`
}

// CompareItem is one repository's figures in a side-by-side comparison.
type CompareItem struct {
	RepoID           int    `json:"repoId"`
	RepoName         string `json:"repoName"`
	TotalDownloads   int64  `json:"totalDownloads"`
	DownloadsInRange int64  `json:"downloadsInRange"`
	Stars            int    `json:"stars"`
	Forks            int    `json:"forks"`
	ClonesInRange    int    `json:"clonesInRange"`
}

// SyncJobLog is a row from sync_job_logs.
type SyncJobLog struct {
	ID           int64   `json:"id"`
	Status       string  `json:"status"`
	ReposSynced  int     `json:"reposSynced"`
	ReposFailed  int     `json:"reposFailed"`
	ErrorMessage *string `json:"errorMessage"`
	StartedAt    string  `json:"startedAt"`
	CompletedAt  *string `json:"completedAt"`
	CreatedAt    string  `json:"createdAt"`
}

// NewRepository is the payload to create a tracked repository.
type NewRepository struct {
	OrgName       string   `json:"orgName"`
	RepoName      string   `json:"repoName"`
	ProductName   *string  `json:"productName"`
	AssetPrefixes []string `json:"assetPrefixes"`
	IsActive      *bool    `json:"isActive"`
}

// RepositoryUpdate is the payload to update a tracked repository. Nil fields are
// left unchanged.
type RepositoryUpdate struct {
	ProductName   *string   `json:"productName"`
	AssetPrefixes *[]string `json:"assetPrefixes"`
	IsActive      *bool     `json:"isActive"`
}
