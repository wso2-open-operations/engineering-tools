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

func TestGetSummary_Unauthorized(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/stats/summary", nil)

	h.GetSummary(w, r)

	assertStatus(t, w, http.StatusUnauthorized)
}

func TestGetSummary_Success(t *testing.T) {
	mock := &mockStore{
		summaryFn: func(_ context.Context) (*store.Summary, error) {
			return &store.Summary{TrackedRepositories: 3, TotalDownloads: 1500, TotalStars: 42}, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/summary", nil), testUser)

	h.GetSummary(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[store.Summary](t, w)
	if got.TrackedRepositories != 3 || got.TotalDownloads != 1500 {
		t.Errorf("unexpected summary: %+v", got)
	}
}

func TestGetTotal_BadDate(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/total?from=not-a-date", nil), testUser)

	h.GetTotal(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidDate)
}

func TestGetTotal_BadRepos(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/total?repos=1,abc", nil), testUser)

	h.GetTotal(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidRepos)
}

func TestGetTotal_Success(t *testing.T) {
	var gotFrom, gotTo string
	var gotIDs []int
	var gotInterval store.Interval
	mock := &mockStore{
		totalFn: func(_ context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error) {
			gotFrom, gotTo, gotIDs, gotInterval = from, to, repoIDs, interval
			return []store.RepoSeries{{RepoID: 1, RepoName: "product-apim", Points: []store.TimeSeriesPoint{{Date: "2026-06-01", Value: 100}}}}, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/total?from=2026-06-01&to=2026-06-25&repos=1,2", nil), testUser)

	h.GetTotal(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[seriesResponse](t, w)
	if got.From != "2026-06-01" || got.To != "2026-06-25" {
		t.Errorf("range = %s..%s, want 2026-06-01..2026-06-25", got.From, got.To)
	}
	if got.Interval != "day" {
		t.Errorf("interval = %q, want day (default)", got.Interval)
	}
	if gotFrom != "2026-06-01" || gotTo != "2026-06-25" || len(gotIDs) != 2 || gotInterval != store.IntervalDay {
		t.Errorf("store called with from=%s to=%s ids=%v interval=%s", gotFrom, gotTo, gotIDs, gotInterval)
	}
	if len(got.Series) != 1 {
		t.Fatalf("series = %d, want 1", len(got.Series))
	}
}

func TestGetDaily_Monthly(t *testing.T) {
	var gotInterval store.Interval
	mock := &mockStore{
		dailyFn: func(_ context.Context, _, _ string, _ []int, interval store.Interval) ([]store.RepoSeries, error) {
			gotInterval = interval
			return []store.RepoSeries{{RepoID: 1, RepoName: "product-apim", Points: []store.TimeSeriesPoint{{Date: "2026-06", Value: 1200}}}}, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/daily?interval=month", nil), testUser)

	h.GetDaily(w, r)

	assertStatus(t, w, http.StatusOK)
	if gotInterval != store.IntervalMonth {
		t.Errorf("interval passed to store = %q, want month", gotInterval)
	}
	got := decodeJSON[seriesResponse](t, w)
	if got.Interval != "month" {
		t.Errorf("response interval = %q, want month", got.Interval)
	}
}

func TestGetTotal_BadInterval(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/total?interval=weekly", nil), testUser)

	h.GetTotal(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidInterval)
}

func TestGetMetric_MissingMetric(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/metric", nil), testUser)

	h.GetMetric(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidMetric)
}

func TestGetMetric_BadMetric(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/metric?metric=downloads", nil), testUser)

	h.GetMetric(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidMetric)
}

func TestGetMetric_Success(t *testing.T) {
	var gotMetric store.Metric
	mock := &mockStore{
		metricFn: func(_ context.Context, metric store.Metric, _, _ string, _ []int, _ store.Interval) ([]store.RepoSeries, error) {
			gotMetric = metric
			return []store.RepoSeries{{RepoID: 1, RepoName: "product-apim", Points: []store.TimeSeriesPoint{{Date: "2026-06-25", Value: 2451}}}}, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/metric?metric=stars&repos=1", nil), testUser)

	h.GetMetric(w, r)

	assertStatus(t, w, http.StatusOK)
	if gotMetric != store.MetricStars {
		t.Errorf("metric passed to store = %q, want stars", gotMetric)
	}
	got := decodeJSON[metricSeriesResponse](t, w)
	if got.Metric != "stars" || got.Interval != "day" || len(got.Series) != 1 {
		t.Errorf("unexpected metric response: %+v", got)
	}
}

func TestGetVersions_BadRepoID(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/versions/abc", nil), testUser)
	r.SetPathValue("repoId", "abc")

	h.GetVersions(w, r)

	assertStatus(t, w, http.StatusBadRequest)
	assertErrorMessage(t, w, ErrMsgInvalidRepo)
}

func TestGetVersions_Success(t *testing.T) {
	mock := &mockStore{
		versionFn: func(_ context.Context, repoID int, _, _ string) (*store.VersionBreakdown, error) {
			return &store.VersionBreakdown{
				RepoID:       repoID,
				SnapshotDate: "2026-06-25",
				Versions:     []store.VersionBreakdownItem{{ReleaseTag: "v1.0.0", DownloadCount: 500}},
			}, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/versions/7", nil), testUser)
	r.SetPathValue("repoId", "7")

	h.GetVersions(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[store.VersionBreakdown](t, w)
	if got.RepoID != 7 || len(got.Versions) != 1 {
		t.Errorf("unexpected breakdown: %+v", got)
	}
}

func TestGetCompare_MissingRepos(t *testing.T) {
	h := NewStatsHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/compare", nil), testUser)

	h.GetCompare(w, r)

	assertStatus(t, w, http.StatusBadRequest)
}

func TestGetCompare_Success(t *testing.T) {
	mock := &mockStore{
		compareFn: func(_ context.Context, repoIDs []int, _, _ string) ([]store.CompareItem, error) {
			items := make([]store.CompareItem, 0, len(repoIDs))
			for _, id := range repoIDs {
				items = append(items, store.CompareItem{RepoID: id, RepoName: "repo", TotalDownloads: 10})
			}
			return items, nil
		},
	}
	h := NewStatsHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/stats/compare?repos=1,2,3", nil), testUser)

	h.GetCompare(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[compareResponse](t, w)
	if len(got.Items) != 3 {
		t.Fatalf("items = %d, want 3", len(got.Items))
	}
}
