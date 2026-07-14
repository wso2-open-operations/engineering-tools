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

import { type UseQueryResult } from "@tanstack/react-query";
import { useApiQuery } from "@hooks/useApiQuery";
import { ApiQueryKeys } from "@constants/apiConstants";

// The signed-in caller's identity and privileges, as computed by the backend.
export interface UserInfo {
  email: string;
  isAdmin: boolean;
}

// GET /api/v1/user-info — isAdmin is decided server-side against the backend's
// ADMIN_GROUPS env var, so admin group names never appear in frontend config.
export function useGetUserInfo(): UseQueryResult<UserInfo, Error> {
  return useApiQuery<UserInfo>([ApiQueryKeys.USER_INFO], "/user-info");
}
