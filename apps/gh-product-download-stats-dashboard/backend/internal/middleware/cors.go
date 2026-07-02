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
//
// A literal "*" in allowedOrigins is intentionally NOT combined with credentialed
// headers: reflecting any Origin while also allowing credentials would let any
// website make credentialed requests to this API. "*" is only ever sent as a
// literal wildcard, uncredentialed; explicit origins get the full credentialed
// response.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Always vary on Origin so shared caches don't mix cross-origin responses,
			// regardless of whether this particular request's origin is allowed.
			w.Header().Add("Vary", "Origin")

			origin := r.Header.Get("Origin")
			wildcard := slices.Contains(allowedOrigins, "*")
			explicit := origin != "" && slices.Contains(allowedOrigins, origin)

			switch {
			case explicit:
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			case wildcard:
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}

			if explicit || wildcard {
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
