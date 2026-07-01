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
	"log/slog"
	"net/http"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/middleware"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

// repositoryStore abstracts the store methods used by RepositoryHandler.
type repositoryStore interface {
	ListRepositoriesWithStats(ctx context.Context) ([]store.RepositoryWithStats, error)
}

// RepositoryHandler serves the tracked-repository listing endpoint.
type RepositoryHandler struct {
	store repositoryStore
}

// NewRepositoryHandler creates a RepositoryHandler backed by the given store.
func NewRepositoryHandler(s repositoryStore) *RepositoryHandler {
	return &RepositoryHandler{store: s}
}

// repositoriesResponse is the portal-shaped response for the repositories list.
type repositoriesResponse struct {
	Count        int                         `json:"count"`
	Repositories []store.RepositoryWithStats `json:"repositories"`
}

// ListRepositories handles GET /api/v1/repositories.
func (h *RepositoryHandler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}

	repos, err := h.store.ListRepositoriesWithStats(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "list repositories failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to list repositories.")
		return
	}

	writeJSONValue(w, http.StatusOK, repositoriesResponse{Count: len(repos), Repositories: repos})
}
