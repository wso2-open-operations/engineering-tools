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
import { type PackageVersionBreakdown } from "@features/stats/types/stats";

// GET /api/v1/stats/packages/{repoId}/versions?package= — per-version period
// downloads and latest figures for one package. Package names may contain
// slashes (e.g. "helm-charts/thunderid"), hence the encodeURIComponent.
export function useGetPackageVersions(
  repoId: number | null,
  packageName: string | null,
  from: string,
  to: string,
): UseQueryResult<PackageVersionBreakdown, Error> {
  const enabled = repoId != null && repoId > 0 && !!packageName;
  return useApiQuery<PackageVersionBreakdown>(
    [ApiQueryKeys.PACKAGE_VERSIONS, repoId, packageName, from, to],
    `/stats/packages/${repoId}/versions?package=${encodeURIComponent(packageName ?? "")}&from=${from}&to=${to}`,
    enabled,
  );
}
