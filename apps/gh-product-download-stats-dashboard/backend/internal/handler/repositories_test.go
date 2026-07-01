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

func TestListRepositories_Unauthorized(t *testing.T) {
	h := NewRepositoryHandler(&mockStore{})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/repositories", nil)

	h.ListRepositories(w, r)

	assertStatus(t, w, http.StatusUnauthorized)
	assertErrorMessage(t, w, ErrMsgUnauthorized)
}

func TestListRepositories_Success(t *testing.T) {
	mock := &mockStore{
		listReposFn: func(_ context.Context) ([]store.RepositoryWithStats, error) {
			return []store.RepositoryWithStats{
				{Repository: store.Repository{ID: 1, OrgName: "wso2", RepoName: "product-apim"}},
				{Repository: store.Repository{ID: 2, OrgName: "wso2", RepoName: "product-is"}},
			}, nil
		},
	}
	h := NewRepositoryHandler(mock)
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/repositories", nil), testUser)

	h.ListRepositories(w, r)

	assertStatus(t, w, http.StatusOK)
	got := decodeJSON[repositoriesResponse](t, w)
	if got.Count != 2 || len(got.Repositories) != 2 {
		t.Fatalf("count = %d, repositories = %d; want 2/2", got.Count, len(got.Repositories))
	}
	if got.Repositories[0].RepoName != "product-apim" {
		t.Errorf("repo[0] = %q, want product-apim", got.Repositories[0].RepoName)
	}
}
