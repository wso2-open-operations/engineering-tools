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

package main

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/handler"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/middleware"
	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/store"
)

func main() {
	os.Exit(run())
}

// run wires up and serves the app, returning the process exit code. Keeping
// this separate from main lets deferred cleanup (st.Close, context cancels)
// always run, since os.Exit from within main would skip them.
func run() int {
	loadDotEnv(".env")
	middleware.ConfigureLogger()

	storeCfg := store.Config{
		Host:            mustEnv("DB_HOST"),
		Port:            atoiOrDefault("DB_PORT", 3306),
		User:            mustEnv("DB_USER"),
		Password:        os.Getenv("DB_PASSWORD"),
		Database:        mustEnv("DB_NAME"),
		MaxOpenConns:    atoiOrDefault("DB_MAX_OPEN_CONNS", 10),
		MaxIdleConns:    atoiOrDefault("DB_MAX_IDLE_CONNS", 5),
		ConnMaxLifetime: time.Duration(atoiOrDefault("DB_CONN_MAX_LIFETIME_SECONDS", 180)) * time.Second,
		TLSEnabled:      os.Getenv("DB_TLS_ENABLED") != "false",
	}
	st, err := store.New(storeCfg)
	if err != nil {
		slog.Error("failed to connect to database", "err", err)
		return 1
	}
	defer st.Close()

	repositoryHandler := handler.NewRepositoryHandler(st)
	statsHandler := handler.NewStatsHandler(st)
	adminHandler := handler.NewAdminHandler(st, splitComma(os.Getenv("ADMIN_GROUPS")))

	authCfg := middleware.Config{
		JWKSEndpoint:          mustEnv("AUTH_JWKS_ENDPOINT"),
		Issuer:                mustEnv("AUTH_ISSUER"),
		Audience:              mustEnv("AUTH_AUDIENCE"),
		ClockSkew:             5 * time.Second,
		TokenValidatorEnabled: os.Getenv("AUTH_TOKEN_VALIDATOR_ENABLED") != "false",
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("GET /api/v1/user-info", adminHandler.UserInfo)
	mux.HandleFunc("GET /api/v1/repositories", repositoryHandler.ListRepositories)
	mux.HandleFunc("GET /api/v1/stats/summary", statsHandler.GetSummary)
	mux.HandleFunc("GET /api/v1/stats/total", statsHandler.GetTotal)
	mux.HandleFunc("GET /api/v1/stats/daily", statsHandler.GetDaily)
	mux.HandleFunc("GET /api/v1/stats/metric", statsHandler.GetMetric)
	mux.HandleFunc("GET /api/v1/stats/clones", statsHandler.GetClones)
	mux.HandleFunc("GET /api/v1/stats/versions/{repoId}", statsHandler.GetVersions)
	mux.HandleFunc("GET /api/v1/stats/versions/{repoId}/series", statsHandler.GetVersionSeries)
	mux.HandleFunc("GET /api/v1/stats/assets/{repoId}", statsHandler.GetAssets)
	mux.HandleFunc("GET /api/v1/stats/compare", statsHandler.GetCompare)

	mux.HandleFunc("GET /api/v1/admin/repositories", adminHandler.ListRepositories)
	mux.HandleFunc("POST /api/v1/admin/repositories", adminHandler.CreateRepository)
	mux.HandleFunc("PATCH /api/v1/admin/repositories/{id}", adminHandler.UpdateRepository)
	mux.HandleFunc("DELETE /api/v1/admin/repositories/{id}", adminHandler.DeactivateRepository)
	mux.HandleFunc("GET /api/v1/admin/sync/logs", adminHandler.ListSyncLogs)

	addr := envOrDefault("PORT", ":8080")

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		slog.Error("failed to bind", "addr", addr, "err", err)
		return 1
	}
	slog.Info("GitHub Stats Dashboard Backend started", "addr", addr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// CORS is nested inside SecurityHeaders so every response — including
	// preflight OPTIONS and rejected-origin responses, which CORS answers
	// directly without reaching the inner middleware — still gets the security
	// headers. ctx cancels the JWKS background refresh goroutine on shutdown.
	// Empty CORS origins is a no-op in production (the Choreo gateway owns CORS);
	// set for local SPA development.
	corsOrigins := splitComma(os.Getenv("CORS_ALLOWED_ORIGINS"))

	srv := &http.Server{
		Handler: middleware.SecurityHeaders(
			middleware.CORS(corsOrigins)(
				middleware.CorrelationID(
					middleware.Auth(ctx, authCfg)(
						middleware.Logger(mux),
					),
				),
			),
		),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// serveErr carries an unexpected listener failure back to the main flow so
	// shutdown (and this function's defers) still run through the normal path
	// instead of the goroutine calling os.Exit directly.
	serveErr := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	exitCode := 0
	select {
	case <-ctx.Done():
		stop()
	case err := <-serveErr:
		if err != nil {
			slog.Error("server exited unexpectedly", "err", err)
			exitCode = 1
		}
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		return 1
	}
	slog.Info("GitHub Stats Dashboard Backend stopped")
	return exitCode
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("required environment variable is not set", "key", key)
		os.Exit(1)
	}
	return v
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func atoiOrDefault(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		slog.Warn("invalid integer env var; using default", "key", key, "value", v, "default", def)
		return def
	}
	return n
}

// loadDotEnv reads a .env file and sets any unset environment variables from it.
// Silently ignored if the file does not exist; logs a warning for any other error.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("loadDotEnv: failed to open .env file", "err", err)
		}
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		// Strip surrounding quotes from value.
		if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
			v = v[1 : len(v)-1]
		}
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("loadDotEnv: error reading .env file", "err", err)
	}
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			result = append(result, t)
		}
	}
	return result
}
