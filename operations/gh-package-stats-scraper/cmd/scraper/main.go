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

// gh-package-stats-scraper is a one-shot daily job (Choreo Scheduled Task)
// that records download counts for the GitHub container packages of tracked
// repositories. Discovery (which packages belong to which tracked repo) uses
// the GitHub REST API with a classic read:packages PAT; the actual counts
// exist only on github.com's HTML pages and are scraped from there. All
// per-repo and per-package work is soft-failure: one broken package never
// aborts the run.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wso2-open-operations/engineering-tools/operations/gh-package-stats-scraper/internal/github"
	"github.com/wso2-open-operations/engineering-tools/operations/gh-package-stats-scraper/internal/store"
)

// Spacing between github.com page fetches: the whole nightly run is
// ~150-200 fetches, so this keeps it well under any bot-detection profile
// while still finishing in a few minutes. Each wait lands randomly in
// [scrapeMinDelay, scrapeMinDelay+scrapeJitterRange) — i.e. [1.0s, 1.6s) — a
// perfectly uniform interval is itself a signal abuse detection can key off.
const (
	scrapeMinDelay    = 1000 * time.Millisecond
	scrapeJitterRange = 600 * time.Millisecond
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("package stats scrape failed", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	st, err := store.New(cfg.db)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	jobID, err := st.StartScrapeJob(ctx)
	if err != nil {
		return err
	}
	slog.Info("package scrape job started", "jobId", jobID)

	repos, err := st.ActiveTrackedRepos(ctx)
	if err != nil {
		msg := "failed to read tracked_repositories: " + err.Error()
		_ = st.CompleteScrapeJob(ctx, jobID, "FAILED", 0, 0, []string{msg})
		return err
	}

	api := github.NewAPIClient(cfg.githubPAT)
	scraper := github.NewScraper(scrapeMinDelay, scrapeJitterRange)
	defer scraper.Close()

	// snapshot_date is the run date (UTC) — same convention as the main sync.
	snapshotDate := time.Now().UTC().Format("2006-01-02")

	// Discover each org's packages once, not once per repo.
	byOrg := map[string][]store.TrackedRepo{}
	for _, r := range repos {
		byOrg[r.OrgName] = append(byOrg[r.OrgName], r)
	}

	reposSynced, reposFailed := 0, 0
	var errs []string

	for org, orgRepos := range byOrg {
		packages, err := api.ListOrgContainerPackages(ctx, org)
		if err != nil {
			// Discovery down for this org: every one of its repos is failed.
			slog.Error("package discovery failed for org", "org", org, "err", err)
			reposFailed += len(orgRepos)
			errs = append(errs, fmt.Sprintf("%s: discovery: %s", org, err))
			continue
		}

		// Group the org's packages by their linked repository name.
		pkgsByRepo := map[string][]github.Package{}
		for _, p := range packages {
			if p.Repository != nil {
				pkgsByRepo[p.Repository.Name] = append(pkgsByRepo[p.Repository.Name], p)
			}
		}

		for _, repo := range orgRepos {
			repoPackages := pkgsByRepo[repo.RepoName]
			if len(repoPackages) == 0 {
				// Most tracked repos publish no GitHub packages — normal.
				reposSynced++
				continue
			}
			failed := scrapeRepoPackages(ctx, scraper, st, repo, repoPackages, snapshotDate, cfg.versionPages)
			if failed > 0 {
				reposFailed++
				errs = append(errs, fmt.Sprintf("%s/%s: %d of %d packages failed",
					org, repo.RepoName, failed, len(repoPackages)))
			} else {
				reposSynced++
			}
		}
	}

	status := "SUCCESS"
	if reposFailed > 0 {
		status = "PARTIAL_FAILURE"
		if reposSynced == 0 {
			status = "FAILED"
		}
	}
	if err := st.CompleteScrapeJob(ctx, jobID, status, reposSynced, reposFailed, errs); err != nil {
		return err
	}
	slog.Info("package scrape job completed",
		"status", status, "reposSynced", reposSynced, "reposFailed", reposFailed)
	if status == "FAILED" {
		return fmt.Errorf("all repos failed")
	}
	return nil
}

// scrapeRepoPackages snapshots every package of one repo; returns how many
// packages failed (each logged individually, none fatal).
func scrapeRepoPackages(ctx context.Context, scraper *github.Scraper, st *store.Store,
	repo store.TrackedRepo, packages []github.Package, snapshotDate string, versionPages int) int {

	failed := 0
	for _, pkg := range packages {
		if err := scrapeOnePackage(ctx, scraper, st, repo, pkg, snapshotDate, versionPages); err != nil {
			slog.Error("package scrape failed",
				"org", repo.OrgName, "repo", repo.RepoName, "package", pkg.Name, "err", err)
			failed++
		}
	}
	return failed
}

func scrapeOnePackage(ctx context.Context, scraper *github.Scraper, st *store.Store,
	repo store.TrackedRepo, pkg github.Package, snapshotDate string, versionPages int) error {

	total, err := scraper.FetchPackageTotal(ctx, repo.OrgName, repo.RepoName, pkg.Name)
	if err != nil {
		return err
	}
	if err := st.UpsertPackageSnapshot(ctx, store.PackageSnapshot{
		TrackedRepoID:   repo.ID,
		PackageName:     pkg.Name,
		PackageGithubID: pkg.ID,
		VersionCount:    pkg.VersionCount,
		TotalDownloads:  total,
	}, snapshotDate); err != nil {
		return err
	}

	// Version rows are best-effort ON TOP of the package row: the package
	// total is already stored, so a versions-page failure loses detail for a
	// day, not the headline number.
	rows, err := scraper.FetchTaggedVersions(ctx, repo.OrgName, repo.RepoName, pkg.Name, versionPages)
	if err != nil {
		slog.Warn("tagged versions scrape failed; package total was stored",
			"org", repo.OrgName, "repo", repo.RepoName, "package", pkg.Name, "err", err)
		return nil
	}
	snaps := make([]store.VersionSnapshot, 0, len(rows))
	for _, r := range rows {
		snaps = append(snaps, store.VersionSnapshot{
			TrackedRepoID: repo.ID,
			PackageName:   pkg.Name,
			VersionID:     r.VersionID,
			Tags:          strings.Join(r.Tags, ","),
			Downloads:     r.Downloads,
		})
	}
	if err := st.UpsertVersionSnapshots(ctx, snaps, snapshotDate); err != nil {
		slog.Warn("version snapshot write failed; package total was stored",
			"org", repo.OrgName, "repo", repo.RepoName, "package", pkg.Name, "err", err)
	}
	slog.Info("package scraped",
		"org", repo.OrgName, "repo", repo.RepoName, "package", pkg.Name,
		"total", total, "taggedVersions", len(snaps))
	return nil
}

// ----- configuration -----

type config struct {
	db           store.Config
	githubPAT    string
	versionPages int
}

func loadConfig() (config, error) {
	port, err := strconv.Atoi(envOrDefault("DB_PORT", "3306"))
	if err != nil {
		return config{}, fmt.Errorf("config: invalid DB_PORT: %w", err)
	}
	versionPages, err := strconv.Atoi(envOrDefault("VERSION_PAGES_LIMIT", "3"))
	if err != nil || versionPages < 1 {
		return config{}, fmt.Errorf("config: invalid VERSION_PAGES_LIMIT")
	}
	cfg := config{
		db: store.Config{
			Host:       os.Getenv("DB_HOST"),
			Port:       port,
			User:       os.Getenv("DB_USER"),
			Password:   os.Getenv("DB_PASSWORD"),
			Database:   envOrDefault("DB_NAME", "github_statistics"),
			TLSEnabled: envOrDefault("DB_TLS_ENABLED", "true") == "true",
		},
		githubPAT:    os.Getenv("GITHUB_PAT"),
		versionPages: versionPages,
	}
	if cfg.db.Host == "" || cfg.db.User == "" {
		return config{}, fmt.Errorf("config: DB_HOST and DB_USER are required")
	}
	if cfg.githubPAT == "" {
		return config{}, fmt.Errorf("config: GITHUB_PAT is required (classic PAT with read:packages — package discovery rejects anonymous and fine-grained tokens)")
	}
	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
