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

export const APP_NAME = "GitHub Product Download Stats Dashboard";

// Default look-back window (days) applied when no date range is selected.
export const DEFAULT_RANGE_DAYS = 30;

// Application route paths.
export const ROUTES = {
  OVERVIEW: "/",
  DOWNLOADS: "/downloads",
  VERSIONS: "/versions",
  GITHUB_STATS: "/repository-stats",
  ADMIN: "/admin",
  ERROR_400: "/400",
  ERROR_401: "/401",
  ERROR_403: "/403",
  ERROR_404: "/404",
} as const;
