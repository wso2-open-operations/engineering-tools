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
	"net/http"
	"slices"
)

// CORS returns a middleware that adds cross-origin headers for the configured
// allowed origins and short-circuits preflight OPTIONS requests. When
// allowedOrigins is empty it is a no-op — production runs behind the Choreo
// gateway, which owns CORS; this is for local development (SPA on :3000 calling
// the backend on :8080).
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := origin != "" && len(allowedOrigins) > 0 &&
				(slices.Contains(allowedOrigins, "*") || slices.Contains(allowedOrigins, origin))

			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers",
					"Authorization, Content-Type, Accept, x-jwt-assertion, x-user-id-token, X-GH-Stats-Correlation-ID")
				w.Header().Set("Access-Control-Max-Age", "600")
			}

			// Answer preflight here, before auth would reject the tokenless OPTIONS.
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
