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
	"strings"
	"testing"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/apierror"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

func adminGroups() []string { return []string{adminGroup} }

func TestAdminListRepositories_Forbidden(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/admin/repositories", nil), testUser)

	h.ListRepositories(w, r)

	assertStatus(t, w, http.StatusForbidden)
}

func TestAdminListRepositories_Success(t *testing.T) {
	mock := &mockStore{
		listAllReposFn: func(_ context.Context) ([]store.RepositoryWithStats, error) {
			return []store.RepositoryWithStats{
				{Repository: store.Repository{ID: 1, OrgName: "wso2", RepoName: "product-apim", IsActive: true}},
				{Repository: store.Repository{ID: 2, OrgName: "wso2", RepoName: "product-old", IsActive: false}},
			}, nil
		},
	}
	h := NewAdminHandler(mock, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/admin/repositories", nil), testAdmin)

	h.ListRepositories(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[adminRepositoriesResponse](t, w)
	if got.Count != 2 || len(got.Repositories) != 2 {
		t.Fatalf("count = %d, repositories = %d; want 2/2", got.Count, len(got.Repositories))
	}
}

func TestCreateRepository_Unauthorized(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/repositories", strings.NewReader(`{}`))

	h.CreateRepository(w, r)

	assertStatus(t, w, http.StatusUnauthorized)
}

func TestCreateRepository_Forbidden(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	w := httptest.NewRecorder()
	body := `{"orgName":"wso2","repoName":"product-apim"}`
	r := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/admin/repositories", strings.NewReader(body)), testUser)

	h.CreateRepository(w, r)

	assertStatus(t, w, http.StatusForbidden)
	assertErrorMessage(t, w, ErrMsgForbidden)
}

func TestCreateRepository_MissingFields(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/admin/repositories", strings.NewReader(`{"orgName":"wso2"}`)), testAdmin)

	h.CreateRepository(w, r)

	assertStatus(t, w, http.StatusBadRequest)
}

func TestCreateRepository_Success(t *testing.T) {
	var got store.NewRepository
	mock := &mockStore{
		createRepoFn: func(_ context.Context, in store.NewRepository) (int, error) {
			got = in
			return 42, nil
		},
	}
	h := NewAdminHandler(mock, adminGroups())
	w := httptest.NewRecorder()
	body := `{"orgName":"wso2","repoName":"product-apim","assetPrefixes":["wso2am-"]}`
	r := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/admin/repositories", strings.NewReader(body)), testAdmin)

	h.CreateRepository(w, r)

	assertStatus(t, w, http.StatusCreated)
	resp := decodeJSON[map[string]int](t, w)
	if resp["id"] != 42 {
		t.Errorf("id = %d, want 42", resp["id"])
	}
	if got.RepoName != "product-apim" || len(got.AssetPrefixes) != 1 {
		t.Errorf("store received %+v", got)
	}
}

func TestUpdateRepository_NotFound(t *testing.T) {
	mock := &mockStore{
		updateRepoFn: func(_ context.Context, _ int, _ store.RepositoryUpdate) error {
			return apierror.ErrNotFound
		},
	}
	h := NewAdminHandler(mock, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodPatch, "/api/v1/admin/repositories/9", strings.NewReader(`{"isActive":false}`)), testAdmin)
	r.SetPathValue("id", "9")

	h.UpdateRepository(w, r)

	assertStatus(t, w, http.StatusNotFound)
}

func TestDeactivateRepository_Success(t *testing.T) {
	called := false
	mock := &mockStore{
		deactivateFn: func(_ context.Context, id int) error {
			called = id == 5
			return nil
		},
	}
	h := NewAdminHandler(mock, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/repositories/5", nil), testAdmin)
	r.SetPathValue("id", "5")

	h.DeactivateRepository(w, r)

	assertStatus(t, w, http.StatusNoContent)
	if !called {
		t.Error("expected DeactivateRepository to be called with id 5")
	}
}

func TestListSyncLogs_Forbidden(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/admin/sync/logs", nil), testUser)

	h.ListSyncLogs(w, r)

	assertStatus(t, w, http.StatusForbidden)
}

func TestListSyncLogs_Success(t *testing.T) {
	mock := &mockStore{
		listSyncLogFn: func(_ context.Context, _, _ int) ([]store.SyncJobLog, error) {
			return []store.SyncJobLog{{ID: 1, Status: "SUCCESS"}}, nil
		},
	}
	h := NewAdminHandler(mock, adminGroups())
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/admin/sync/logs", nil), testAdmin)

	h.ListSyncLogs(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[syncLogsResponse](t, w)
	if got.Count != 1 || len(got.Logs) != 1 {
		t.Fatalf("count = %d, logs = %d; want 1/1", got.Count, len(got.Logs))
	}
}
