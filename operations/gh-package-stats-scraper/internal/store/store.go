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

// Package store is the scraper's MySQL layer: it reads the shared
// tracked_repositories table (the single source of truth for what to scrape)
// and writes the package snapshot tables created by migration 000001.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const pingTimeout = 10 * time.Second

// Config holds the MySQL connection settings.
type Config struct {
	Host       string
	Port       int
	User       string
	Password   string
	Database   string
	TLSEnabled bool
}

// Store wraps the database connection pool.
type Store struct {
	db *sql.DB
}

// TrackedRepo is the subset of tracked_repositories the scraper needs.
type TrackedRepo struct {
	ID       int
	OrgName  string
	RepoName string
}

// PackageSnapshot is one package's daily row.
type PackageSnapshot struct {
	TrackedRepoID   int
	PackageName     string
	PackageGithubID int64
	VersionCount    int
	TotalDownloads  int64
}

// VersionSnapshot is one tagged version's daily row.
type VersionSnapshot struct {
	TrackedRepoID int
	PackageName   string
	VersionID     int64
	Tags          string
	Downloads     int64
}

// New opens and pings the pool.
func New(cfg Config) (*Store, error) {
	tlsMode := "false"
	if cfg.TLSEnabled {
		tlsMode = "true"
	}
	dsn := mysql.Config{
		User:                 cfg.User,
		Passwd:               cfg.Password,
		Net:                  "tcp",
		Addr:                 net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		DBName:               cfg.Database,
		ParseTime:            true,
		Loc:                  time.UTC,
		AllowNativePasswords: true,
		TLSConfig:            tlsMode,
		Params:               map[string]string{"charset": "utf8mb4"},
	}
	db, err := sql.Open("mysql", dsn.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("store: open db: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping db: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the pool.
func (s *Store) Close() error {
	return s.db.Close()
}

// ActiveTrackedRepos returns the repos the scraper should cover: active AND
// explicitly opted in to package tracking (track_packages — migration 000002).
// Most tracked repos publish no GitHub packages, so scraping is opt-in.
func (s *Store) ActiveTrackedRepos(ctx context.Context) ([]TrackedRepo, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, org_name, repo_name FROM tracked_repositories
		 WHERE is_active = 1 AND track_packages = 1 ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("store: list tracked repos: %w", err)
	}
	defer rows.Close()
	var out []TrackedRepo
	for rows.Next() {
		var r TrackedRepo
		if err := rows.Scan(&r.ID, &r.OrgName, &r.RepoName); err != nil {
			return nil, fmt.Errorf("store: scan tracked repo: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertPackageSnapshot writes a package's daily row (idempotent per day).
func (s *Store) UpsertPackageSnapshot(ctx context.Context, snap PackageSnapshot, snapshotDate string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO package_daily_snapshots
			(tracked_repo_id, package_name, package_github_id, version_count,
			 total_download_count, snapshot_date)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			package_github_id = VALUES(package_github_id),
			version_count = VALUES(version_count),
			total_download_count = VALUES(total_download_count)`,
		snap.TrackedRepoID, snap.PackageName, snap.PackageGithubID,
		snap.VersionCount, snap.TotalDownloads, snapshotDate)
	if err != nil {
		return fmt.Errorf("store: upsert package snapshot %s: %w", snap.PackageName, err)
	}
	return nil
}

// UpsertVersionSnapshots writes a package's tagged-version rows in one
// transaction (idempotent per day).
func (s *Store) UpsertVersionSnapshots(ctx context.Context, snaps []VersionSnapshot, snapshotDate string) error {
	if len(snaps) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin version snapshot tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const q = `
		INSERT INTO package_version_daily_snapshots
			(tracked_repo_id, package_name, version_github_id, tags, download_count, snapshot_date)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			tags = VALUES(tags),
			download_count = VALUES(download_count)`
	for _, v := range snaps {
		tags := v.Tags
		// Defensive cap: the column is VARCHAR(1000); an absurd tag list
		// should not fail the whole package.
		if len(tags) > 1000 {
			tags = tags[:1000]
		}
		if _, err := tx.ExecContext(ctx, q,
			v.TrackedRepoID, v.PackageName, v.VersionID, tags, v.Downloads, snapshotDate); err != nil {
			return fmt.Errorf("store: upsert version snapshot %s/%d: %w", v.PackageName, v.VersionID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit version snapshots: %w", err)
	}
	return nil
}

// StartScrapeJob inserts a STARTED row and returns its id.
func (s *Store) StartScrapeJob(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO package_scrape_job_logs (status, started_at) VALUES ('STARTED', UTC_TIMESTAMP())`)
	if err != nil {
		return 0, fmt.Errorf("store: start scrape job: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("store: scrape job id: %w", err)
	}
	return id, nil
}

// CompleteScrapeJob finalizes the job row.
func (s *Store) CompleteScrapeJob(ctx context.Context, jobID int64, status string,
	reposSynced, reposFailed int, errs []string) error {
	var errMsg any
	if len(errs) > 0 {
		errMsg = strings.Join(errs, "; ")
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE package_scrape_job_logs
		SET status = ?, repos_synced = ?, repos_failed = ?, error_message = ?,
		    completed_at = UTC_TIMESTAMP()
		WHERE id = ?`,
		status, reposSynced, reposFailed, errMsg, jobID)
	if err != nil {
		return fmt.Errorf("store: complete scrape job: %w", err)
	}
	return nil
}
