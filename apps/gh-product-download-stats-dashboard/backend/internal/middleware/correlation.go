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

package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/google/uuid"
)

const correlationIDHeader = "X-GH-Stats-Correlation-ID"

// maxCorrelationIDLen bounds client-supplied correlation IDs so an attacker
// can't smuggle oversized or control-character-laden values into logs and the
// echoed response header.
const maxCorrelationIDLen = 64

type correlationIDKey struct{}

// CorrelationID is an HTTP middleware that reads the correlation-ID request
// header or generates a UUID v4 if absent or invalid. The ID is:
//   - stored in the context for automatic inclusion in slog records
//   - echoed in the response header so callers can reference it in support
//     requests
func CorrelationID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(correlationIDHeader)
		if !isValidCorrelationID(id) {
			id = newCorrelationID()
		}
		w.Header().Set(correlationIDHeader, id)
		ctx := context.WithValue(r.Context(), correlationIDKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// CorrelationIDFromContext returns the correlation ID stored in ctx, or ""
// if the CorrelationID middleware was not applied.
func CorrelationIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(correlationIDKey{}).(string)
	return v
}

// isValidCorrelationID bounds a client-supplied correlation ID to a length and
// charset safe to log and echo back verbatim (alphanumeric plus -/_).
func isValidCorrelationID(id string) bool {
	if id == "" || len(id) > maxCorrelationIDLen {
		return false
	}
	for _, c := range id {
		isAlnum := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if !isAlnum && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

func newCorrelationID() string {
	return uuid.NewString()
}

// ctxHandler wraps a slog.Handler to automatically inject the correlation ID
// and authenticated user ID from the request context into every log record
// produced via *Context methods.
type ctxHandler struct {
	inner slog.Handler
}

func (h ctxHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h ctxHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := CorrelationIDFromContext(ctx); id != "" {
		r.AddAttrs(slog.String("correlationID", id))
	}
	if user := UserInfoFromContext(ctx); user != nil {
		r.AddAttrs(slog.String("userID", user.UserID))
	}
	return h.inner.Handle(ctx, r)
}

func (h ctxHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return ctxHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h ctxHandler) WithGroup(name string) slog.Handler {
	return ctxHandler{inner: h.inner.WithGroup(name)}
}

// ConfigureLogger sets up the default slog logger with a handler that
// automatically adds the correlation ID from the request context to every log
// record. Call once at startup before any log statements.
func ConfigureLogger() {
	inner := slog.NewTextHandler(os.Stderr, nil)
	slog.SetDefault(slog.New(ctxHandler{inner: inner}))
}
