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

package store

import (
	"context"
	"os"
	"strconv"
	"testing"
)

// TestIntegrationRoundTrip exercises the real SQL against a MySQL instance
// that has migration 000008 applied. Guarded: set RUN_DB=1 plus the DB_* env
// vars (see README). Uses an existing tracked repo id and cleans up after
// itself.
func TestIntegrationRoundTrip(t *testing.T) {
	if os.Getenv("RUN_DB") != "1" {
		t.Skip("set RUN_DB=1 with DB_* env vars to run against a real database")
	}
	port, _ := strconv.Atoi(os.Getenv("DB_PORT"))
	st, err := New(Config{
		Host:       os.Getenv("DB_HOST"),
		Port:       port,
		User:       os.Getenv("DB_USER"),
		Password:   os.Getenv("DB_PASSWORD"),
		Database:   os.Getenv("DB_NAME"),
		TLSEnabled: os.Getenv("DB_TLS_ENABLED") == "true",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = st.Close() }()
	ctx := context.Background()

	repos, err := st.ActiveTrackedRepos(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) == 0 {
		t.Skip("no active tracked repositories in this database")
	}
	repoID := repos[0].ID
	const testPkg = "__scraper_integration_test__"
	const testDate = "1999-01-01" // far outside any real data range

	cleanup := func() {
		_, _ = st.db.ExecContext(ctx, `DELETE FROM package_version_daily_snapshots WHERE package_name = ?`, testPkg)
		_, _ = st.db.ExecContext(ctx, `DELETE FROM package_daily_snapshots WHERE package_name = ?`, testPkg)
	}
	cleanup()
	defer cleanup()

	// Insert, then upsert with a new value: the second write must update in
	// place (same-day rerun semantics), not duplicate.
	snap := PackageSnapshot{TrackedRepoID: repoID, PackageName: testPkg,
		PackageGithubID: 42, VersionCount: 7, TotalDownloads: 100}
	if err := st.UpsertPackageSnapshot(ctx, snap, testDate); err != nil {
		t.Fatal(err)
	}
	snap.TotalDownloads = 150
	if err := st.UpsertPackageSnapshot(ctx, snap, testDate); err != nil {
		t.Fatal(err)
	}
	var n, total int64
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*), MAX(total_download_count) FROM package_daily_snapshots WHERE package_name = ?`,
		testPkg).Scan(&n, &total); err != nil {
		t.Fatal(err)
	}
	if n != 1 || total != 150 {
		t.Fatalf("package upsert: rows=%d total=%d, want 1 row with 150", n, total)
	}

	versions := []VersionSnapshot{
		{TrackedRepoID: repoID, PackageName: testPkg, VersionID: 1, Tags: "v1.0.0,latest", Downloads: 10},
		{TrackedRepoID: repoID, PackageName: testPkg, VersionID: 2, Tags: "v0.9.0", Downloads: 5},
	}
	if err := st.UpsertVersionSnapshots(ctx, versions, testDate); err != nil {
		t.Fatal(err)
	}
	versions[0].Downloads = 12
	if err := st.UpsertVersionSnapshots(ctx, versions, testDate); err != nil {
		t.Fatal(err)
	}
	var vn, vmax int64
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*), MAX(download_count) FROM package_version_daily_snapshots WHERE package_name = ?`,
		testPkg).Scan(&vn, &vmax); err != nil {
		t.Fatal(err)
	}
	if vn != 2 || vmax != 12 {
		t.Fatalf("version upsert: rows=%d max=%d, want 2 rows with max 12", vn, vmax)
	}

	jobID, err := st.StartScrapeJob(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CompleteScrapeJob(ctx, jobID, "SUCCESS", 3, 0, nil); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := st.db.QueryRowContext(ctx,
		`SELECT status FROM package_scrape_job_logs WHERE id = ?`, jobID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "SUCCESS" {
		t.Fatalf("job status = %q, want SUCCESS", status)
	}
	_, _ = st.db.ExecContext(ctx, `DELETE FROM package_scrape_job_logs WHERE id = ?`, jobID)
}
