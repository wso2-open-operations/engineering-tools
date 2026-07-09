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

import { type JSX, lazy } from "react";
import { Routes, Route } from "react-router";
import AuthGuard from "@layouts/AuthGuard";
import RequireAdmin from "@layouts/RequireAdmin";
import ErrorLayout from "@layouts/ErrorLayout";
import Error400Page from "@components/error/Error400Page";
import Error401Page from "@components/error/Error401Page";
import Error403Page from "@components/error/Error403Page";
import Error404Page from "@components/error/Error404Page";
import { ROUTES } from "@constants/common";

// Pages are code-split so switching tabs streams a per-route chunk; the
// <Suspense> in AppLayout shows RouteSuspenseFallback while it loads.
const OverviewPage = lazy(() => import("@features/stats/pages/OverviewPage"));
const DownloadsPage = lazy(() => import("@features/stats/pages/DownloadsPage"));
const VersionsPage = lazy(() => import("@features/stats/pages/VersionsPage"));
const RepositoryStatsPage = lazy(() => import("@features/stats/pages/RepositoryStatsPage"));
const AdminPage = lazy(() => import("@features/repositories/pages/AdminPage"));

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path={ROUTES.ERROR_400} element={<ErrorLayout><Error400Page /></ErrorLayout>} />
      <Route path={ROUTES.ERROR_401} element={<ErrorLayout><Error401Page /></ErrorLayout>} />
      <Route path={ROUTES.ERROR_403} element={<ErrorLayout><Error403Page /></ErrorLayout>} />
      <Route path={ROUTES.ERROR_404} element={<ErrorLayout><Error404Page /></ErrorLayout>} />

      <Route element={<AuthGuard />}>
        <Route path={ROUTES.OVERVIEW} element={<OverviewPage />} />
        <Route path={ROUTES.DOWNLOADS} element={<DownloadsPage />} />
        <Route path={ROUTES.VERSIONS} element={<VersionsPage />} />
        <Route path={ROUTES.GITHUB_STATS} element={<RepositoryStatsPage />} />
        <Route
          path={ROUTES.ADMIN}
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<ErrorLayout><Error404Page /></ErrorLayout>} />
    </Routes>
  );
}
