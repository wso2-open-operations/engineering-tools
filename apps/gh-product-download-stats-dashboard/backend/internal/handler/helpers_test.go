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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/middleware"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

// adminGroup is the group granted admin access in tests.
const adminGroup = "gh-stats-admins"

// testUser is a regular authenticated user (no admin group).
var testUser = &middleware.UserInfo{
	Email:  "viewer@example.com",
	UserID: "user-123",
	Groups: []string{"gh-stats-viewers"},
}

// testAdmin is an authenticated user that belongs to the admin group.
var testAdmin = &middleware.UserInfo{
	Email:  "admin@example.com",
	UserID: "admin-1",
	Groups: []string{adminGroup},
}

// withUser returns r with the given user stored in its context.
func withUser(r *http.Request, user *middleware.UserInfo) *http.Request {
	return r.WithContext(middleware.WithUserInfo(r.Context(), user))
}

// ----- assertion helpers -----

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Errorf("status = %d, want %d; body: %s", w.Code, want, w.Body.String())
	}
}

func assertErrorMessage(t *testing.T, w *httptest.ResponseRecorder, want string) {
	t.Helper()
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v; raw: %s", err, w.Body.String())
	}
	if body.Message != want {
		t.Errorf("message = %q, want %q", body.Message, want)
	}
}

func decodeJSON[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(w.Body).Decode(&v); err != nil {
		t.Fatalf("decode response body: %v; raw: %s", err, w.Body.String())
	}
	return v
}

// ----- mock store -----

// mockStore implements repositoryStore, statsStore, and adminStore via optional
// func fields. Unset fields return zero values, so each test wires only what it needs.
type mockStore struct {
	listReposFn     func(ctx context.Context) ([]store.RepositoryWithStats, error)
	summaryFn       func(ctx context.Context) (*store.Summary, error)
	totalFn         func(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	dailyFn         func(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	metricFn        func(ctx context.Context, metric store.Metric, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	cloneFn         func(ctx context.Context, from, to string, repoIDs []int) ([]store.CloneSeries, error)
	versionFn       func(ctx context.Context, repoID int, from, to string) (*store.VersionBreakdown, error)
	versionSeriesFn func(ctx context.Context, repoID int, from, to string, interval store.Interval) ([]store.VersionSeries, error)
	assetFn         func(ctx context.Context, repoID int, from, to, version string) (*store.AssetBreakdown, error)
	compareFn       func(ctx context.Context, repoIDs []int, from, to string) ([]store.CompareItem, error)
	listAllReposFn  func(ctx context.Context) ([]store.RepositoryWithStats, error)
	createRepoFn    func(ctx context.Context, in store.NewRepository) (int, error)
	updateRepoFn    func(ctx context.Context, id int, upd store.RepositoryUpdate) error
	deactivateFn    func(ctx context.Context, id int) error
	listSyncLogFn   func(ctx context.Context, limit, offset int) ([]store.SyncJobLog, error)
}

func (m *mockStore) ListRepositoriesWithStats(ctx context.Context) ([]store.RepositoryWithStats, error) {
	if m.listReposFn != nil {
		return m.listReposFn(ctx)
	}
	return nil, nil
}

func (m *mockStore) Summary(ctx context.Context) (*store.Summary, error) {
	if m.summaryFn != nil {
		return m.summaryFn(ctx)
	}
	return &store.Summary{}, nil
}

func (m *mockStore) TotalSeries(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error) {
	if m.totalFn != nil {
		return m.totalFn(ctx, from, to, repoIDs, interval)
	}
	return nil, nil
}

func (m *mockStore) DailySeries(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error) {
	if m.dailyFn != nil {
		return m.dailyFn(ctx, from, to, repoIDs, interval)
	}
	return nil, nil
}

func (m *mockStore) MetricSeries(ctx context.Context, metric store.Metric, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error) {
	if m.metricFn != nil {
		return m.metricFn(ctx, metric, from, to, repoIDs, interval)
	}
	return nil, nil
}

func (m *mockStore) CloneSeries(ctx context.Context, from, to string, repoIDs []int) ([]store.CloneSeries, error) {
	if m.cloneFn != nil {
		return m.cloneFn(ctx, from, to, repoIDs)
	}
	return nil, nil
}

func (m *mockStore) VersionBreakdown(ctx context.Context, repoID int, from, to string) (*store.VersionBreakdown, error) {
	if m.versionFn != nil {
		return m.versionFn(ctx, repoID, from, to)
	}
	return &store.VersionBreakdown{RepoID: repoID}, nil
}

func (m *mockStore) VersionSeries(ctx context.Context, repoID int, from, to string, interval store.Interval) ([]store.VersionSeries, error) {
	if m.versionSeriesFn != nil {
		return m.versionSeriesFn(ctx, repoID, from, to, interval)
	}
	return nil, nil
}

func (m *mockStore) AssetBreakdown(ctx context.Context, repoID int, from, to, version string) (*store.AssetBreakdown, error) {
	if m.assetFn != nil {
		return m.assetFn(ctx, repoID, from, to, version)
	}
	return &store.AssetBreakdown{RepoID: repoID}, nil
}

func (m *mockStore) Compare(ctx context.Context, repoIDs []int, from, to string) ([]store.CompareItem, error) {
	if m.compareFn != nil {
		return m.compareFn(ctx, repoIDs, from, to)
	}
	return nil, nil
}

func (m *mockStore) ListAllRepositoriesWithStats(ctx context.Context) ([]store.RepositoryWithStats, error) {
	if m.listAllReposFn != nil {
		return m.listAllReposFn(ctx)
	}
	return nil, nil
}

func (m *mockStore) CreateRepository(ctx context.Context, in store.NewRepository) (int, error) {
	if m.createRepoFn != nil {
		return m.createRepoFn(ctx, in)
	}
	return 0, nil
}

func (m *mockStore) UpdateRepository(ctx context.Context, id int, upd store.RepositoryUpdate) error {
	if m.updateRepoFn != nil {
		return m.updateRepoFn(ctx, id, upd)
	}
	return nil
}

func (m *mockStore) DeactivateRepository(ctx context.Context, id int) error {
	if m.deactivateFn != nil {
		return m.deactivateFn(ctx, id)
	}
	return nil
}

func (m *mockStore) ListSyncLogs(ctx context.Context, limit, offset int) ([]store.SyncJobLog, error) {
	if m.listSyncLogFn != nil {
		return m.listSyncLogFn(ctx, limit, offset)
	}
	return nil, nil
}
