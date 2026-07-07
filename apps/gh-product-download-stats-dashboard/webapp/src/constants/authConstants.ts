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

// OAuth2 scopes requested from Asgardeo. `groups` is required for admin gating.
export const AUTH_SCOPES = ["openid", "email", "groups", "profile"] as const;

// Idle-timeout / session-warning configuration.
// After IDLE_TIMEOUT_MS of inactivity the "Are you still there?" dialog is shown.
// There is no auto-logout — the session stays alive until the user acts.
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_THROTTLE_MS = 500;
