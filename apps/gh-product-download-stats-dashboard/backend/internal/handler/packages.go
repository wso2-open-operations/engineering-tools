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

// packagesStore abstracts the store methods used by PackagesHandler.
type packagesStore interface {
	PackageRepos(ctx context.Context) ([]store.PackageRepoInfo, error)
	PackageBreakdown(ctx context.Context, repoID int, from, to string) (*store.PackageBreakdown, error)
	PackageSeriesForRepo(ctx context.Context, repoID int, from, to string, interval store.Interval) ([]store.PackageSeries, error)
	PackageVersionBreakdown(ctx context.Context, repoID int, packageName, from, to string) (*store.PackageVersionBreakdown, error)
}

// PackagesHandler serves the GitHub Packages statistics endpoints.
type PackagesHandler struct {
	store packagesStore
}

// NewPackagesHandler creates a PackagesHandler backed by the given store.
func NewPackagesHandler(s packagesStore) *PackagesHandler {
	return &PackagesHandler{store: s}
}

// errMsgMissingPackage is returned when the package query parameter is absent.
const errMsgMissingPackage = "The package query parameter is required."

// packageReposResponse wraps the repos-with-packages listing.
type packageReposResponse struct {
	Count int                     `json:"count"`
	Repos []store.PackageRepoInfo `json:"repos"`
}

// GetPackageRepos handles GET /api/v1/stats/packages/repos — the tracked
// repositories that have package data (powers the Packages tab selector).
func (h *PackagesHandler) GetPackageRepos(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}

	repos, err := h.store.PackageRepos(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "package repos failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to load package repositories.")
		return
	}
	writeJSONValue(w, http.StatusOK, packageReposResponse{Count: len(repos), Repos: repos})
}

// GetPackageBreakdown handles GET /api/v1/stats/packages/{repoId} — each
// package's period downloads and latest totals over the date range.
func (h *PackagesHandler) GetPackageBreakdown(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	repoID, ok := parseRepoIDPath(r, "repoId")
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepo)
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}

	breakdown, err := h.store.PackageBreakdown(r.Context(), repoID, rng.From, rng.To)
	if err != nil {
		slog.ErrorContext(r.Context(), "package breakdown failed",
			"userID", user.UserID, "repoID", repoID, "err", err)
		mapStoreError(w, err, "Failed to load package breakdown.")
		return
	}
	writeJSONValue(w, http.StatusOK, breakdown)
}

// packageSeriesResponse wraps the per-package series list.
type packageSeriesResponse struct {
	From     string                `json:"from"`
	To       string                `json:"to"`
	Interval string                `json:"interval"`
	Series   []store.PackageSeries `json:"series"`
}

// GetPackageSeries handles GET /api/v1/stats/packages/{repoId}/series — each
// package's download series over the date range at the requested interval.
func (h *PackagesHandler) GetPackageSeries(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	repoID, ok := parseRepoIDPath(r, "repoId")
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepo)
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}
	interval, ok := store.ParseInterval(r.URL.Query().Get("interval"))
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidInterval)
		return
	}

	series, err := h.store.PackageSeriesForRepo(r.Context(), repoID, rng.From, rng.To, interval)
	if err != nil {
		slog.ErrorContext(r.Context(), "package series failed",
			"userID", user.UserID, "repoID", repoID, "err", err)
		mapStoreError(w, err, "Failed to load package series.")
		return
	}
	writeJSONValue(w, http.StatusOK, packageSeriesResponse{
		From: rng.From, To: rng.To, Interval: string(interval), Series: series,
	})
}

// GetPackageVersions handles GET /api/v1/stats/packages/{repoId}/versions?package=
// — each tagged version's period downloads and latest figures for one package.
func (h *PackagesHandler) GetPackageVersions(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	repoID, ok := parseRepoIDPath(r, "repoId")
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepo)
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}
	packageName := r.URL.Query().Get("package")
	if packageName == "" {
		writeError(w, http.StatusBadRequest, errMsgMissingPackage)
		return
	}

	breakdown, err := h.store.PackageVersionBreakdown(r.Context(), repoID, packageName, rng.From, rng.To)
	if err != nil {
		slog.ErrorContext(r.Context(), "package versions failed",
			"userID", user.UserID, "repoID", repoID, "package", packageName, "err", err)
		mapStoreError(w, err, "Failed to load package versions.")
		return
	}
	writeJSONValue(w, http.StatusOK, breakdown)
}
