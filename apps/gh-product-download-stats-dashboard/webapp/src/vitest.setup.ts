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

import "@testing-library/jest-dom/vitest";

// Provide a default runtime config so modules reading window.config don't throw.
window.config = window.config ?? {
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_BASE_URL: "https://api.asgardeo.io/t/test",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_CLIENT_ID: "test-client",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_SIGN_IN_REDIRECT_URL: "http://localhost:3000",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_SIGN_OUT_REDIRECT_URL: "http://localhost:3000",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_BACKEND_BASE_URL: "http://localhost:8080",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_THEME: "acrylicOrange",
  GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_LOG_LEVEL: "NONE",
};
