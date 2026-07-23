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

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

func newPackagesRequest(t *testing.T, target string, h http.HandlerFunc, pattern string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(pattern, h)
	r := withUser(httptest.NewRequest(http.MethodGet, target, nil), testUser)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestGetPackageReposRequiresAuth(t *testing.T) {
	h := NewPackagesHandler(&mockStore{})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/stats/packages/repos", nil)
	w := httptest.NewRecorder()
	h.GetPackageRepos(w, r)
	assertStatus(t, w, http.StatusUnauthorized)
}

func TestGetPackageRepos(t *testing.T) {
	product := "Thunder ID"
	h := NewPackagesHandler(&mockStore{
		pkgReposFn: func(ctx context.Context) ([]store.PackageRepoInfo, error) {
			return []store.PackageRepoInfo{
				{RepoID: 13, RepoName: "thunderid", ProductName: &product, PackageCount: 3},
			}, nil
		},
	})
	w := newPackagesRequest(t, "/api/v1/stats/packages/repos",
		h.GetPackageRepos, "GET /api/v1/stats/packages/repos")

	assertStatus(t, w, http.StatusOK)
	body := decodeJSON[packageReposResponse](t, w)
	if body.Count != 1 || len(body.Repos) != 1 || body.Repos[0].RepoName != "thunderid" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestGetPackageBreakdown(t *testing.T) {
	h := NewPackagesHandler(&mockStore{
		pkgBreakdownFn: func(ctx context.Context, repoID int, from, to string) (*store.PackageBreakdown, error) {
			return &store.PackageBreakdown{RepoID: repoID, Packages: []store.PackageBreakdownItem{
				{PackageName: "controller", PeriodDownloads: 120, TotalDownloads: 51410},
			}}, nil
		},
	})
	w := newPackagesRequest(t, "/api/v1/stats/packages/12?from=2026-07-01&to=2026-07-20",
		h.GetPackageBreakdown, "GET /api/v1/stats/packages/{repoId}")

	assertStatus(t, w, http.StatusOK)
	body := decodeJSON[store.PackageBreakdown](t, w)
	if body.RepoID != 12 || len(body.Packages) != 1 || body.Packages[0].TotalDownloads != 51410 {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestGetPackageBreakdownRejectsBadRepoID(t *testing.T) {
	h := NewPackagesHandler(&mockStore{})
	w := newPackagesRequest(t, "/api/v1/stats/packages/zero",
		h.GetPackageBreakdown, "GET /api/v1/stats/packages/{repoId}")
	assertStatus(t, w, http.StatusBadRequest)
}

func TestGetPackageSeries(t *testing.T) {
	var gotInterval store.Interval
	h := NewPackagesHandler(&mockStore{
		pkgSeriesFn: func(ctx context.Context, repoID int, from, to string, interval store.Interval) ([]store.PackageSeries, error) {
			gotInterval = interval
			return []store.PackageSeries{
				{PackageName: "controller", Points: []store.TimeSeriesPoint{{Date: "2026-07-19", Value: 200}}},
			}, nil
		},
	})
	w := newPackagesRequest(t, "/api/v1/stats/packages/12/series?from=2026-07-01&to=2026-07-20&interval=month",
		h.GetPackageSeries, "GET /api/v1/stats/packages/{repoId}/series")

	assertStatus(t, w, http.StatusOK)
	if gotInterval != store.IntervalMonth {
		t.Fatalf("interval passed to store = %q, want month", gotInterval)
	}
	body := decodeJSON[packageSeriesResponse](t, w)
	if len(body.Series) != 1 || body.Series[0].PackageName != "controller" {
		t.Fatalf("unexpected body: %+v", body)
	}
	if body.From != "2026-07-01" || body.To != "2026-07-20" || body.Interval != "month" {
		t.Fatalf("range/interval echo wrong: %+v", body)
	}
}

func TestGetPackageSeriesRejectsBadInterval(t *testing.T) {
	h := NewPackagesHandler(&mockStore{})
	w := newPackagesRequest(t, "/api/v1/stats/packages/12/series?interval=weekly",
		h.GetPackageSeries, "GET /api/v1/stats/packages/{repoId}/series")
	assertStatus(t, w, http.StatusBadRequest)
}

func TestGetPackageVersionsRequiresPackageParam(t *testing.T) {
	h := NewPackagesHandler(&mockStore{})
	w := newPackagesRequest(t, "/api/v1/stats/packages/12/versions",
		h.GetPackageVersions, "GET /api/v1/stats/packages/{repoId}/versions")
	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, errMsgMissingPackage)
}

func TestGetPackageVersions(t *testing.T) {
	tags := "v1.2.0,latest"
	var gotPackage string
	h := NewPackagesHandler(&mockStore{
		pkgVersionsFn: func(ctx context.Context, repoID int, packageName, from, to string) (*store.PackageVersionBreakdown, error) {
			gotPackage = packageName
			return &store.PackageVersionBreakdown{RepoID: repoID, PackageName: packageName,
				Versions: []store.PackageVersionItem{
					{VersionID: 1032948485, Tags: &tags, PeriodDownloads: 14, TotalDownloads: 310},
				}}, nil
		},
	})
	// Slash-named packages arrive URL-encoded in the query string.
	w := newPackagesRequest(t, "/api/v1/stats/packages/13/versions?package=helm-charts%2Fthunderid",
		h.GetPackageVersions, "GET /api/v1/stats/packages/{repoId}/versions")

	assertStatus(t, w, http.StatusOK)
	if gotPackage != "helm-charts/thunderid" {
		t.Fatalf("package param = %q, want the decoded slashed name", gotPackage)
	}
	body := decodeJSON[store.PackageVersionBreakdown](t, w)
	if len(body.Versions) != 1 || body.Versions[0].VersionID != 1032948485 {
		t.Fatalf("unexpected body: %+v", body)
	}
}
