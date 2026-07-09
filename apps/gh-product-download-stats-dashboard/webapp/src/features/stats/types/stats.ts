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

// Mirrors the backend response shapes (see backend/API.md). camelCase throughout.

export type Interval = "day" | "month" | "cumulative";
export type Metric = "stars" | "forks" | "watchers" | "openIssues";

export interface RepoSnapshot {
  snapshotDate: string;
  totalDownloadCount: number;
  forksCount: number;
  stargazersCount: number;
  watchersCount: number;
  openIssuesCount: number;
  cloneCount: number;
  cloneUniques: number;
}

export interface Repository {
  id: number;
  orgName: string;
  repoName: string;
  productName: string | null;
  assetPrefixes: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  latestSnapshot: RepoSnapshot | null;
}

export interface RepositoriesResponse {
  count: number;
  repositories: Repository[];
}

export interface TopProduct {
  repoId: number;
  repoName: string;
  productName: string | null;
  todayDownloads: number;
  totalDownloads: number;
  stars: number;
}

export interface Summary {
  trackedRepositories: number;
  totalDownloads: number;
  totalStars: number;
  totalForks: number;
  totalClonesLast30d: number;
  totalClonesLast14d: number;
  todayDownloads: number;
  todayDeltaPct: number | null;
  // The actual snapshot date todayDownloads/topProducts[].todayDownloads are
  // computed from — may be older than today if the sync cron hasn't run/
  // succeeded recently.
  asOfDate: string | null;
  monthDownloads: number;
  lastSyncDate: string | null;
  lastSyncStatus: string | null;
  topProducts: TopProduct[];
}

export interface VersionSeries {
  releaseTag: string;
  releaseName: string | null;
  points: TimeSeriesPoint[];
}

export interface VersionSeriesResponse {
  repoId: number;
  from: string;
  to: string;
  interval: Interval;
  series: VersionSeries[];
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface RepoSeries {
  repoId: number;
  repoName: string;
  points: TimeSeriesPoint[];
}

export interface SeriesResponse {
  from: string;
  to: string;
  interval: Interval;
  series: RepoSeries[];
}

export interface MetricSeriesResponse extends SeriesResponse {
  metric: Metric;
}

export interface ClonePoint {
  date: string;
  count: number;
  uniques: number;
}

export interface CloneSeries {
  repoId: number;
  repoName: string;
  points: ClonePoint[];
}

export interface CloneSeriesResponse {
  from: string;
  to: string;
  series: CloneSeries[];
}

export interface VersionBreakdownItem {
  releaseTag: string;
  releaseName: string | null;
  downloadCount: number;
}

export interface VersionBreakdown {
  repoId: number;
  snapshotDate: string;
  versions: VersionBreakdownItem[];
}

export interface AssetBreakdownItem {
  releaseTag: string;
  assetName: string;
  assetGithubId: number;
  contentType: string | null;
  assetSize: number | null;
  downloadCount: number;
}

export interface AssetBreakdown {
  repoId: number;
  snapshotDate: string;
  version: string | null;
  assets: AssetBreakdownItem[];
}
