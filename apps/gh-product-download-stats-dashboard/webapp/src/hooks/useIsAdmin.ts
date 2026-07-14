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

import { useAsgardeo } from "@asgardeo/react";
import { useGetUserInfo } from "@hooks/useGetUserInfo";

interface AdminState {
  isAdmin: boolean;
  isLoading: boolean;
}

// Resolves whether the signed-in user is an admin by asking the backend
// (GET /user-info), which computes it against its ADMIN_GROUPS env var. The
// frontend never sees admin group names. UX gating only — the backend enforces
// admin access on every /admin endpoint regardless of what the UI shows.
export function useIsAdmin(): AdminState {
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();
  const userInfoQuery = useGetUserInfo();

  return {
    isAdmin: userInfoQuery.data?.isAdmin ?? false,
    isLoading: isAuthLoading || (isSignedIn && userInfoQuery.isLoading),
  };
}
