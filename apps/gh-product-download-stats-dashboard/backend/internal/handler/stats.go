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

// statsStore abstracts the store methods used by StatsHandler.
type statsStore interface {
	Summary(ctx context.Context) (*store.Summary, error)
	TotalSeries(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	DailySeries(ctx context.Context, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	MetricSeries(ctx context.Context, metric store.Metric, from, to string, repoIDs []int, interval store.Interval) ([]store.RepoSeries, error)
	CloneSeries(ctx context.Context, from, to string, repoIDs []int) ([]store.CloneSeries, error)
	VersionBreakdown(ctx context.Context, repoID int, from, to string) (*store.VersionBreakdown, error)
	VersionSeries(ctx context.Context, repoID int, from, to string, interval store.Interval) ([]store.VersionSeries, error)
	AssetBreakdown(ctx context.Context, repoID int, from, to, version string) (*store.AssetBreakdown, error)
	Compare(ctx context.Context, repoIDs []int, from, to string) ([]store.CompareItem, error)
}

// StatsHandler serves the dashboard statistics endpoints.
type StatsHandler struct {
	store statsStore
}

// NewStatsHandler creates a StatsHandler backed by the given store.
func NewStatsHandler(s statsStore) *StatsHandler {
	return &StatsHandler{store: s}
}

// GetSummary handles GET /api/v1/stats/summary.
func (h *StatsHandler) GetSummary(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}

	summary, err := h.store.Summary(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "stats summary failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to compute summary.")
		return
	}
	writeJSONValue(w, http.StatusOK, summary)
}

// seriesResponse wraps a per-repository time series list.
type seriesResponse struct {
	From     string             `json:"from"`
	To       string             `json:"to"`
	Interval string             `json:"interval"`
	Series   []store.RepoSeries `json:"series"`
}

// GetTotal handles GET /api/v1/stats/total.
func (h *StatsHandler) GetTotal(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	rng, repoIDs, interval, ok := h.parseSeriesParams(w, r)
	if !ok {
		return
	}

	series, err := h.store.TotalSeries(r.Context(), rng.From, rng.To, repoIDs, interval)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats total failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to load total downloads.")
		return
	}
	writeJSONValue(w, http.StatusOK, seriesResponse{From: rng.From, To: rng.To, Interval: string(interval), Series: series})
}

// GetDaily handles GET /api/v1/stats/daily.
func (h *StatsHandler) GetDaily(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	rng, repoIDs, interval, ok := h.parseSeriesParams(w, r)
	if !ok {
		return
	}

	series, err := h.store.DailySeries(r.Context(), rng.From, rng.To, repoIDs, interval)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats daily failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to load daily downloads.")
		return
	}
	writeJSONValue(w, http.StatusOK, seriesResponse{From: rng.From, To: rng.To, Interval: string(interval), Series: series})
}

// metricSeriesResponse wraps a per-repository GitHub-stat time series list.
type metricSeriesResponse struct {
	Metric   string             `json:"metric"`
	From     string             `json:"from"`
	To       string             `json:"to"`
	Interval string             `json:"interval"`
	Series   []store.RepoSeries `json:"series"`
}

// GetMetric handles GET /api/v1/stats/metric — a time series for a single
// point-in-time GitHub stat (stars/forks/watchers/openIssues).
func (h *StatsHandler) GetMetric(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}

	metric, ok := store.ParseMetric(r.URL.Query().Get("metric"))
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidMetric)
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}
	repoIDs, ok := parseRepoIDs(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepos)
		return
	}
	interval, ok := store.ParseInterval(r.URL.Query().Get("interval"))
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidInterval)
		return
	}

	series, err := h.store.MetricSeries(r.Context(), metric, rng.From, rng.To, repoIDs, interval)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats metric failed", "userID", user.UserID, "metric", string(metric), "err", err)
		mapStoreError(w, err, "Failed to load metric series.")
		return
	}
	writeJSONValue(w, http.StatusOK, metricSeriesResponse{
		Metric: string(metric), From: rng.From, To: rng.To, Interval: string(interval), Series: series,
	})
}

// cloneSeriesResponse wraps a per-repository clone-traffic series list.
type cloneSeriesResponse struct {
	From   string              `json:"from"`
	To     string              `json:"to"`
	Series []store.CloneSeries `json:"series"`
}

// GetClones handles GET /api/v1/stats/clones.
func (h *StatsHandler) GetClones(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}
	repoIDs, ok := parseRepoIDs(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepos)
		return
	}

	series, err := h.store.CloneSeries(r.Context(), rng.From, rng.To, repoIDs)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats clones failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to load clone traffic.")
		return
	}
	writeJSONValue(w, http.StatusOK, cloneSeriesResponse{From: rng.From, To: rng.To, Series: series})
}

// GetVersions handles GET /api/v1/stats/versions/{repoId}.
func (h *StatsHandler) GetVersions(w http.ResponseWriter, r *http.Request) {
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

	breakdown, err := h.store.VersionBreakdown(r.Context(), repoID, rng.From, rng.To)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats versions failed", "userID", user.UserID, "repoID", repoID, "err", err)
		mapStoreError(w, err, "Failed to load version breakdown.")
		return
	}
	writeJSONValue(w, http.StatusOK, breakdown)
}

// versionSeriesResponse wraps the per-version time series.
type versionSeriesResponse struct {
	RepoID   int                   `json:"repoId"`
	From     string                `json:"from"`
	To       string                `json:"to"`
	Interval string                `json:"interval"`
	Series   []store.VersionSeries `json:"series"`
}

// GetVersionSeries handles GET /api/v1/stats/versions/{repoId}/series.
func (h *StatsHandler) GetVersionSeries(w http.ResponseWriter, r *http.Request) {
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

	series, err := h.store.VersionSeries(r.Context(), repoID, rng.From, rng.To, interval)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats version series failed", "userID", user.UserID, "repoID", repoID, "err", err)
		mapStoreError(w, err, "Failed to load version series.")
		return
	}
	writeJSONValue(w, http.StatusOK, versionSeriesResponse{
		RepoID: repoID, From: rng.From, To: rng.To, Interval: string(interval), Series: series,
	})
}

// GetAssets handles GET /api/v1/stats/assets/{repoId}.
func (h *StatsHandler) GetAssets(w http.ResponseWriter, r *http.Request) {
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
	version := r.URL.Query().Get("version")

	breakdown, err := h.store.AssetBreakdown(r.Context(), repoID, rng.From, rng.To, version)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats assets failed", "userID", user.UserID, "repoID", repoID, "err", err)
		mapStoreError(w, err, "Failed to load asset breakdown.")
		return
	}
	writeJSONValue(w, http.StatusOK, breakdown)
}

// compareResponse wraps the side-by-side comparison list.
type compareResponse struct {
	From  string              `json:"from"`
	To    string              `json:"to"`
	Items []store.CompareItem `json:"items"`
}

// GetCompare handles GET /api/v1/stats/compare.
func (h *StatsHandler) GetCompare(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}
	repoIDs, ok := parseRepoIDs(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepos)
		return
	}
	if len(repoIDs) == 0 {
		writeError(w, http.StatusBadRequest, "At least one repository id is required in the repos parameter.")
		return
	}
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return
	}

	items, err := h.store.Compare(r.Context(), repoIDs, rng.From, rng.To)
	if err != nil {
		slog.ErrorContext(r.Context(), "stats compare failed", "userID", user.UserID, "err", err)
		mapStoreError(w, err, "Failed to load comparison.")
		return
	}
	writeJSONValue(w, http.StatusOK, compareResponse{From: rng.From, To: rng.To, Items: items})
}

// parseSeriesParams validates the shared date-range + repos + interval filter used
// by the total/daily endpoints, writing the appropriate 400 on failure.
func (h *StatsHandler) parseSeriesParams(w http.ResponseWriter, r *http.Request) (dateRange, []int, store.Interval, bool) {
	rng, valid := parseDateRange(r)
	if !valid {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidDate)
		return dateRange{}, nil, "", false
	}
	repoIDs, ok := parseRepoIDs(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidRepos)
		return dateRange{}, nil, "", false
	}
	interval, ok := store.ParseInterval(r.URL.Query().Get("interval"))
	if !ok {
		writeError(w, http.StatusBadRequest, ErrMsgInvalidInterval)
		return dateRange{}, nil, "", false
	}
	return rng, repoIDs, interval, true
}
