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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/time/rate"
)

// jwksSanitizer strips the optional "x5c" (and "x5t#S256") fields from JWKS
// responses before jwkset parses them. jwkset unconditionally runs every x5c
// certificate through Go's strict x509.ParseCertificate, and Asgardeo's JWKS
// certificate has a negative serial number — technically invalid per RFC 5280,
// which Go rejects outright. x5c isn't needed for JWT signature verification
// (only the raw key material, e.g. n/e, is), so removing it avoids the parse
// failure entirely without weakening verification.
type jwksSanitizer struct {
	Transport http.RoundTripper
}

func (t *jwksSanitizer) RoundTrip(req *http.Request) (*http.Response, error) {
	transport := t.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	resp, err := transport.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusOK && resp.Body != nil {
		// Generous raw-read cap (x5c certificate chains can be sizeable) — this
		// only guards against a malicious/broken upstream, not realistic JWKS
		// payloads, since the real size check runs after x5c is stripped below.
		const maxRawJWKSBytes = 5 << 20 // 5MB
		// The sanitized (x5c/x5t#S256-stripped) payload should be small — only
		// key material remains. Catches genuinely abnormal responses.
		const maxSanitizedJWKSBytes = 1 << 16 // 64KB

		bodyReader := http.MaxBytesReader(nil, resp.Body, maxRawJWKSBytes)
		bodyBytes, err := io.ReadAll(bodyReader)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("JWKS response too large or read failed: %w", err)
		}
		var payload map[string]any
		if err := json.Unmarshal(bodyBytes, &payload); err == nil {
			if keys, ok := payload["keys"].([]any); ok {
				for _, k := range keys {
					if keyObj, ok := k.(map[string]any); ok {
						delete(keyObj, "x5c")
						delete(keyObj, "x5t#S256")
					}
				}
			}
			if newBytes, err := json.Marshal(payload); err == nil {
				bodyBytes = newBytes
			}
		}
		if len(bodyBytes) > maxSanitizedJWKSBytes {
			return nil, fmt.Errorf("sanitized JWKS response too large: %d bytes", len(bodyBytes))
		}
		resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		resp.ContentLength = int64(len(bodyBytes))

		// Synchronize the HTTP header if it exists
		if resp.Header.Get("Content-Length") != "" {
			resp.Header.Set("Content-Length", strconv.Itoa(len(bodyBytes)))
		}
	}
	return resp, nil
}

// authErrorBody is the JSON error payload for auth failures.
type authErrorBody struct {
	Message string `json:"message"`
}

func writeAuthError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(authErrorBody{Message: message})
}

const jwtAssertionHeader = "x-jwt-assertion"

type contextKey string

const userInfoKey contextKey = "user-info"

// UserInfo holds the authenticated user's identity extracted from the JWT.
type UserInfo struct {
	Email  string
	UserID string
	Groups []string
}

// Config holds JWT validation configuration.
type Config struct {
	JWKSEndpoint          string
	Issuer                string
	Audience              string
	ClockSkew             time.Duration
	TokenValidatorEnabled bool
}

// jwtClaims defines the expected JWT payload fields, mirroring the Ballerina
// CustomJwtPayload in the authorization module.
type jwtClaims struct {
	Email  string   `json:"email"`
	UserID string   `json:"userid"`
	Groups []string `json:"groups"`
	jwt.RegisteredClaims
}

// Auth returns an HTTP middleware that validates the x-jwt-assertion header on
// every request and stores the resulting UserInfo in the request context.
// When Config.TokenValidatorEnabled is false the token is only decoded without
// signature verification — safe for local development only. shutdownCtx ends
// the JWKS background refresh goroutine when the server shuts down.
func Auth(shutdownCtx context.Context, cfg Config) func(http.Handler) http.Handler {
	var keyFunc jwt.Keyfunc
	if cfg.TokenValidatorEnabled {
		// Asgardeo's JWKS response includes an x5c certificate chain with a
		// negative serial number, which Go's x509 parser rejects outright.
		// jwksSanitizer strips it (and x5t#S256) before jwkset ever parses the
		// document, since neither is needed for JWT signature verification.
		customClient := &http.Client{
			Transport: &jwksSanitizer{},
			Timeout:   10 * time.Second,
		}
		jwksStorage, err := jwkset.NewStorageFromHTTP(cfg.JWKSEndpoint, jwkset.HTTPClientStorageOptions{
			Client: customClient,
			Ctx:    shutdownCtx,
			// false (default): the first HTTP fetch must succeed, so an
			// unreachable/misconfigured JWKS endpoint fails startup below via the
			// panic, instead of silently running with an empty key set (which
			// would fail every JWT with no clearer signal than refresh-error logs).
			NoErrorReturnFirstHTTPReq: false,
			// Subsequent periodic refreshes: a failed refresh here just logs via
			// RefreshErrorHandler and keeps the last-known-good key set — it does
			// not clear it — so this interval is about staying current with IdP
			// key rotation, not failure recovery.
			RefreshInterval: 5 * time.Minute,
			RefreshErrorHandler: func(ctx context.Context, err error) {
				slog.ErrorContext(ctx, "failed to refresh JWKS", "url", cfg.JWKSEndpoint, "err", err)
			},
		})
		if err != nil {
			// Misconfigured auth must not silently pass — fail at startup.
			panic("auth: failed to initialise JWKS from " + cfg.JWKSEndpoint + ": " + err.Error())
		}
		// NewStorageFromHTTP alone only refreshes on RefreshInterval, with no
		// on-demand fallback — an unrecognized kid (e.g. right after Asgardeo
		// rotates in a new signing key) would fail every request until the next
		// scheduled refresh. Wrapping it in NewHTTPClient with RefreshUnknownKID
		// restores that on-demand, rate-limited re-fetch (same defaults
		// jwkset's own NewDefaultCtx path uses) while keeping our sanitized client.
		jwksClient, err := jwkset.NewHTTPClient(jwkset.HTTPClientOptions{
			HTTPURLs:          map[string]jwkset.Storage{cfg.JWKSEndpoint: jwksStorage},
			RateLimitWaitMax:  2 * time.Second,
			RefreshUnknownKID: rate.NewLimiter(rate.Every(5*time.Minute), 1),
		})
		if err != nil {
			panic("auth: failed to wrap JWKS storage from " + cfg.JWKSEndpoint + ": " + err.Error())
		}
		jwks, err := keyfunc.New(keyfunc.Options{Ctx: shutdownCtx, Storage: jwksClient})
		if err != nil {
			panic("auth: failed to initialise keyfunc from " + cfg.JWKSEndpoint + ": " + err.Error())
		}
		keyFunc = jwks.Keyfunc
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for the health check endpoint.
			if r.Method == http.MethodGet && r.URL.Path == "/health" {
				next.ServeHTTP(w, r)
				return
			}

			tokenStr := r.Header.Get(jwtAssertionHeader)
			if tokenStr == "" {
				// Local development / direct-IdP: there is no Choreo gateway to
				// inject x-jwt-assertion, so fall back to the bearer access token.
				if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
					tokenStr = strings.TrimPrefix(ah, "Bearer ")
				}
			}
			if tokenStr == "" {
				writeAuthError(w, "You are not authorized to perform this action. Please try again.")
				return
			}

			info, err := extractUserInfo(tokenStr, cfg, keyFunc)
			if err != nil {
				slog.ErrorContext(r.Context(), "auth: token validation failed", "err", err)
				writeAuthError(w, "You are not authorized to perform this action. Please try again.")
				return
			}

			ctx := context.WithValue(r.Context(), userInfoKey, info)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserInfoFromContext retrieves the authenticated user's info from the context.
// Returns nil if the auth middleware was not applied.
func UserInfoFromContext(ctx context.Context) *UserInfo {
	v, _ := ctx.Value(userInfoKey).(*UserInfo)
	return v
}

// WithUserInfo returns a copy of ctx carrying the given UserInfo.
// Call this in tests to bypass JWT parsing and inject a fake authenticated user.
func WithUserInfo(ctx context.Context, user *UserInfo) context.Context {
	return context.WithValue(ctx, userInfoKey, user)
}

// HasAnyGroup reports whether the user belongs to at least one of the given
// groups. Used to gate admin-only endpoints.
func (u *UserInfo) HasAnyGroup(groups []string) bool {
	for _, want := range groups {
		for _, have := range u.Groups {
			if want == have {
				return true
			}
		}
	}
	return false
}

func extractUserInfo(tokenStr string, cfg Config, keyFunc jwt.Keyfunc) (*UserInfo, error) {
	var c jwtClaims

	if !cfg.TokenValidatorEnabled {
		// Local mode: decode without signature verification.
		_, _, err := new(jwt.Parser).ParseUnverified(tokenStr, &c)
		if err != nil {
			return nil, fmt.Errorf("decode token: %w", err)
		}
	} else {
		token, err := jwt.ParseWithClaims(tokenStr, &c, keyFunc,
			jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithIssuer(cfg.Issuer),
			jwt.WithAudience(cfg.Audience),
			jwt.WithLeeway(cfg.ClockSkew),
			jwt.WithExpirationRequired(),
		)
		if err != nil {
			return nil, fmt.Errorf("validate token: %w", err)
		}
		if !token.Valid {
			return nil, fmt.Errorf("invalid token")
		}
	}

	// Resolve the user id from the `userid` claim, falling back to the standard
	// `sub` claim (Asgardeo / Choreo tokens identify the user via sub).
	userID := c.UserID
	if userID == "" {
		userID = c.Subject
	}
	if userID == "" {
		return nil, fmt.Errorf("token missing userid/sub claim")
	}

	// Email is optional: it is not used for authorization (groups) or identity
	// (userID) — only as logging context — so tokens without an email claim are
	// still accepted (e.g. an Asgardeo app that doesn't issue the email claim).

	return &UserInfo{
		Email:  c.Email,
		UserID: userID,
		Groups: c.Groups,
	}, nil
}
