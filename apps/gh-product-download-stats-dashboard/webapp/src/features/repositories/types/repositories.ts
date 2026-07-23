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

import { type Repository } from "@features/stats/types/stats";

export interface AdminRepositoriesResponse {
  count: number;
  repositories: Repository[];
}

export interface NewRepository {
  orgName: string;
  repoName: string;
  productName?: string | null;
  assetPrefixes?: string[];
  isActive?: boolean;
  trackPackages?: boolean;
}

export interface RepositoryUpdate {
  productName?: string | null;
  assetPrefixes?: string[];
  isActive?: boolean;
  trackPackages?: boolean;
}

// A job's source: the Ballerina daily sync, or the package stats scraper.
// id is only unique within a source, never across the two — pair them
// together (e.g. `${source}-${id}`) for a stable list key.
export type JobLogSource = "DB_SYNC" | "PACKAGE_SCRAPE";

export interface SyncJobLog {
  id: number;
  source: JobLogSource;
  status: string;
  reposSynced: number;
  reposFailed: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface SyncLogsResponse {
  count: number;
  logs: SyncJobLog[];
}
