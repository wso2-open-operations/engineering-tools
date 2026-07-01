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
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/apierror"
)

// maxRequestBodyBytes caps the size of request bodies the handlers will read.
const maxRequestBodyBytes = 1 << 20 // 1 MiB

// defaultRangeDays is the look-back window applied when no from/to is supplied.
const defaultRangeDays = 30

// Error message constants.
const (
	ErrMsgUnauthorized    = "You are not authorized to perform this action. Please try again."
	ErrMsgForbidden       = "Access to the requested resource is forbidden!"
	ErrMsgNotFound        = "The requested resource was not found!"
	ErrMsgBadRequest      = "Invalid request payload."
	ErrMsgTooLarge        = "Request body too large."
	ErrMsgInternal        = "An internal server error occurred. Please try again later."
	ErrMsgInvalidDate     = "Invalid date format; expected YYYY-MM-DD."
	ErrMsgInvalidRepos    = "Invalid repository id filter."
	ErrMsgInvalidRepo     = "Invalid repository id."
	ErrMsgInvalidInterval = "Invalid interval; expected 'day' or 'month'."
	ErrMsgInvalidMetric   = "Invalid or missing metric; expected one of: stars, forks, watchers, openIssues."
	errMsgReadBody        = "Failed to read request body."
)

const dateLayout = "2006-01-02"

// errorBody is the JSON error payload format.
type errorBody struct {
	Message string `json:"message"`
}

// writeError writes a JSON error response: {"message": "..."}.
func writeError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(errorBody{Message: message})
}

// writeJSON writes a raw JSON response with the given status code.
func writeJSON(w http.ResponseWriter, statusCode int, data []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_, _ = w.Write(data)
}

// writeJSONValue marshals v and writes the result as a JSON response.
func writeJSONValue(w http.ResponseWriter, statusCode int, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, ErrMsgInternal)
		return
	}
	writeJSON(w, statusCode, data)
}

// mapStoreError translates a data-store error to an HTTP error response without
// leaking storage details to the caller.
func mapStoreError(w http.ResponseWriter, err error, fallbackMsg string) {
	if errors.Is(err, apierror.ErrNotFound) {
		writeError(w, http.StatusNotFound, ErrMsgNotFound)
		return
	}
	var apiErr *apierror.Error
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusBadRequest:
			writeError(w, http.StatusBadRequest, ErrMsgBadRequest)
		case http.StatusNotFound:
			writeError(w, http.StatusNotFound, ErrMsgNotFound)
		default:
			writeError(w, http.StatusInternalServerError, fallbackMsg)
		}
		return
	}
	writeError(w, http.StatusInternalServerError, fallbackMsg)
}

// dateRange holds a validated inclusive from/to date filter.
type dateRange struct {
	From string
	To   string
}

// parseDateRange reads the from/to query parameters (YYYY-MM-DD). When omitted,
// it defaults to the last defaultRangeDays days ending today (UTC).
func parseDateRange(r *http.Request) (dateRange, bool) {
	now := time.Now().UTC()
	to := r.URL.Query().Get("to")
	from := r.URL.Query().Get("from")

	if to == "" {
		to = now.Format(dateLayout)
	} else if !validDate(to) {
		return dateRange{}, false
	}
	if from == "" {
		from = now.AddDate(0, 0, -defaultRangeDays).Format(dateLayout)
	} else if !validDate(from) {
		return dateRange{}, false
	}
	return dateRange{From: from, To: to}, true
}

func validDate(s string) bool {
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

// parseRepoIDs parses the comma-separated "repos" query parameter into ints.
// An absent/empty value yields a nil slice (meaning "all repositories").
func parseRepoIDs(r *http.Request) ([]int, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("repos"))
	if raw == "" {
		return nil, true
	}
	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		id, err := strconv.Atoi(p)
		if err != nil || id <= 0 {
			return nil, false
		}
		ids = append(ids, id)
	}
	return ids, true
}

// parseRepoIDPath parses a positive integer path parameter.
func parseRepoIDPath(r *http.Request, name string) (int, bool) {
	raw := strings.TrimSpace(r.PathValue(name))
	id, err := strconv.Atoi(raw)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// parsePagination reads limit/offset query params with sane defaults and caps.
func parsePagination(r *http.Request, defLimit, maxLimit int) (limit, offset int) {
	limit = defLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}
