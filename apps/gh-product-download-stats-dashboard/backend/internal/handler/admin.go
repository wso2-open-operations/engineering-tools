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
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/middleware"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

// adminStore abstracts the store methods used by AdminHandler.
type adminStore interface {
	ListAllRepositoriesWithStats(ctx context.Context) ([]store.RepositoryWithStats, error)
	CreateRepository(ctx context.Context, in store.NewRepository) (int, error)
	UpdateRepository(ctx context.Context, id int, upd store.RepositoryUpdate) error
	DeactivateRepository(ctx context.Context, id int) error
	ListSyncLogs(ctx context.Context, limit, offset int) ([]store.SyncJobLog, error)
}

// AdminHandler serves the admin-only repository management and sync-log endpoints.
type AdminHandler struct {
	store       adminStore
	adminGroups []string
}

// NewAdminHandler creates an AdminHandler. Only callers whose JWT groups intersect
// adminGroups may invoke its endpoints.
func NewAdminHandler(s adminStore, adminGroups []string) *AdminHandler {
	return &AdminHandler{store: s, adminGroups: adminGroups}
}

// requireAdmin returns the authenticated admin user or writes the appropriate
// 401/403 and returns nil.
func (h *AdminHandler) requireAdmin(w http.ResponseWriter, r *http.Request) *middleware.UserInfo {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return nil
	}
	if !user.HasAnyGroup(h.adminGroups) {
		writeError(w, http.StatusForbidden, ErrMsgForbidden)
		return nil
	}
	return user
}

// readJSONBody reads and unmarshals a size-capped JSON request body into v.
func readJSONBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		if _, ok := err.(*http.MaxBytesError); ok {
			writeError(w, http.StatusRequestEntityTooLarge, ErrMsgTooLarge)
			return false
		}
		writeError(w, http.StatusBadRequest, errMsgReadBody)
		return false
	}
	if err := json.Unmarshal(body, v); err != nil {
		writeError(w, http.StatusBadRequest, ErrMsgBadRequest)
		return false
	}
	return true
}

// adminRepositoriesResponse wraps the admin repository listing.
type adminRepositoriesResponse struct {
	Count        int                         `json:"count"`
	Repositories []store.RepositoryWithStats `json:"repositories"`
}

// ListRepositories handles GET /api/v1/admin/repositories — all tracked repos
// (active and inactive) for the management table.
func (h *AdminHandler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	user := h.requireAdmin(w, r)
	if user == nil {
		return
	}

	repos, err := h.store.ListAllRepositoriesWithStats(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "list all repositories failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to list repositories.")
		return
	}
	writeJSONValue(w, http.StatusOK, adminRepositoriesResponse{Count: len(repos), Repositories: repos})
}

// CreateRepository handles POST /api/v1/admin/repositories.
func (h *AdminHandler) CreateRepository(w http.ResponseWriter, r *http.Request) {
	user := h.requireAdmin(w, r)
	if user == nil {
		return
	}

	var in store.NewRepository
	if !readJSONBody(w, r, &in) {
		return
	}
	in.OrgName = strings.TrimSpace(in.OrgName)
	in.RepoName = strings.TrimSpace(in.RepoName)
	if in.OrgName == "" || in.RepoName == "" {
		writeError(w, http.StatusBadRequest, "orgName and repoName are required.")
		return
	}

	id, err := h.store.CreateRepository(r.Context(), in)
	if err != nil {
		slog.ErrorContext(r.Context(), "create repository failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to create repository.")
		return
	}
	writeJSONValue(w, http.StatusCreated, map[string]int{"id": id})
}

// UpdateRepository handles PATCH /api/v1/admin/repositories/{id}.
func (h *AdminHandler) UpdateRepository(w http.ResponseWriter, r *http.Request) {
	user := h.requireAdmin(w, r)
	if user == nil {
		return
	}
	id, ok := parseRepoIDPath(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepo)
		return
	}

	var upd store.RepositoryUpdate
	if !readJSONBody(w, r, &upd) {
		return
	}

	if err := h.store.UpdateRepository(r.Context(), id, upd); err != nil {
		slog.ErrorContext(r.Context(), "update repository failed", "userID", user.UserID, "repoID", id, "err", err)
		mapStoreError(w, err, "Failed to update repository.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeactivateRepository handles DELETE /api/v1/admin/repositories/{id}.
func (h *AdminHandler) DeactivateRepository(w http.ResponseWriter, r *http.Request) {
	user := h.requireAdmin(w, r)
	if user == nil {
		return
	}
	id, ok := parseRepoIDPath(r, "id")
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepo)
		return
	}

	if err := h.store.DeactivateRepository(r.Context(), id); err != nil {
		slog.ErrorContext(r.Context(), "deactivate repository failed", "userID", user.UserID, "repoID", id, "err", err)
		mapStoreError(w, err, "Failed to deactivate repository.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// syncLogsResponse wraps the sync-log listing.
type syncLogsResponse struct {
	Count int                `json:"count"`
	Logs  []store.SyncJobLog `json:"logs"`
}

// ListSyncLogs handles GET /api/v1/admin/sync/logs.
func (h *AdminHandler) ListSyncLogs(w http.ResponseWriter, r *http.Request) {
	user := h.requireAdmin(w, r)
	if user == nil {
		return
	}
	limit, offset := parsePagination(r, 50, 200)

	logs, err := h.store.ListSyncLogs(r.Context(), limit, offset)
	if err != nil {
		slog.ErrorContext(r.Context(), "list sync logs failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to list sync logs.")
		return
	}
	writeJSONValue(w, http.StatusOK, syncLogsResponse{Count: len(logs), Logs: logs})
}
