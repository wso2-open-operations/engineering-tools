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
	"database/sql"
	"fmt"
	"sort"
)

// Package-stats queries over the tables written by the gh-package-stats-scraper
// (package_daily_snapshots / package_version_daily_snapshots — migration
// 000008). All flow numbers use the same previous-day self-join delta pattern
// as DailySeries: a day's downloads = row minus the same identity's row
// exactly 1 day earlier, so first-seen identities and gap reappearances
// contribute nothing, negatives clamp to zero, and dates are labeled with
// activity_date = snapshot_date - 1 day. Stock numbers (latest totals) come
// from each identity's newest row. Results are served from statsCache.

// PackageRepoInfo is a tracked repository that has package data.
type PackageRepoInfo struct {
	RepoID       int     `json:"repoId"`
	RepoName     string  `json:"repoName"`
	ProductName  *string `json:"productName"`
	PackageCount int     `json:"packageCount"`
}

// PackageBreakdownItem is one package's figures over a date range.
type PackageBreakdownItem struct {
	PackageName     string `json:"packageName"`
	PeriodDownloads int64  `json:"periodDownloads"`
	TotalDownloads  int64  `json:"totalDownloads"`
	VersionCount    *int   `json:"versionCount"`
}

// PackageBreakdown is the per-package listing for a repository over a range.
type PackageBreakdown struct {
	RepoID   int                    `json:"repoId"`
	Packages []PackageBreakdownItem `json:"packages"`
}

// PackageSeries is a per-package daily download time series.
type PackageSeries struct {
	PackageName string            `json:"packageName"`
	Points      []TimeSeriesPoint `json:"points"`
}

// PackageVersionItem is one tagged version's figures over a date range.
type PackageVersionItem struct {
	VersionID       int64   `json:"versionId"`
	Tags            *string `json:"tags"`
	PeriodDownloads int64   `json:"periodDownloads"`
	TotalDownloads  int64   `json:"totalDownloads"`
}

// PackageVersionBreakdown is the per-version listing for one package.
type PackageVersionBreakdown struct {
	RepoID      int                  `json:"repoId"`
	PackageName string               `json:"packageName"`
	Versions    []PackageVersionItem `json:"versions"`
}

// PackageRepos returns the active tracked repositories that have package
// snapshot data — the Packages tab only offers these.
func (s *Store) PackageRepos(ctx context.Context) ([]PackageRepoInfo, error) {
	return cachedDo(s.statsCache, "pkg-repos", func() ([]PackageRepoInfo, error) {
		rows, err := s.db.QueryContext(ctx, `
			SELECT t.id, t.repo_name, t.product_name, COUNT(DISTINCT p.package_name)
			FROM tracked_repositories t
			JOIN package_daily_snapshots p ON p.tracked_repo_id = t.id
			WHERE t.is_active = 1
			GROUP BY t.id, t.repo_name, t.product_name
			ORDER BY COALESCE(NULLIF(t.product_name, ''), t.repo_name)`)
		if err != nil {
			return nil, fmt.Errorf("store: package repos: %w", err)
		}
		defer rows.Close()

		out := []PackageRepoInfo{}
		for rows.Next() {
			var (
				info    PackageRepoInfo
				product sql.NullString
			)
			if err := rows.Scan(&info.RepoID, &info.RepoName, &product, &info.PackageCount); err != nil {
				return nil, fmt.Errorf("store: scan package repo: %w", err)
			}
			if product.Valid {
				info.ProductName = &product.String
			}
			out = append(out, info)
		}
		return out, rows.Err()
	})
}

// PackageBreakdown returns each package's period downloads (delta sum over
// the range) and latest stock figures for a repository.
func (s *Store) PackageBreakdown(ctx context.Context, repoID int, from, to string) (*PackageBreakdown, error) {
	key := fmt.Sprintf("pkg-breakdown|%d|%s|%s", repoID, from, to)
	return cachedDo(s.statsCache, key, func() (*PackageBreakdown, error) {
		return s.packageBreakdown(ctx, repoID, from, to)
	})
}

func (s *Store) packageBreakdown(ctx context.Context, repoID int, from, to string) (*PackageBreakdown, error) {
	out := &PackageBreakdown{RepoID: repoID, Packages: []PackageBreakdownItem{}}

	// Stock: every package's newest row (drives the listing, so packages with
	// no in-range activity still appear with period 0).
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.package_name, p.total_download_count, p.version_count
		FROM package_daily_snapshots p
		JOIN (
			SELECT package_name, MAX(snapshot_date) AS max_date
			FROM package_daily_snapshots
			WHERE tracked_repo_id = ?
			GROUP BY package_name
		) latest ON latest.package_name = p.package_name AND latest.max_date = p.snapshot_date
		WHERE p.tracked_repo_id = ?`, repoID, repoID)
	if err != nil {
		return nil, fmt.Errorf("store: package breakdown totals: %w", err)
	}
	defer rows.Close()

	index := map[string]int{}
	for rows.Next() {
		var (
			item         PackageBreakdownItem
			versionCount sql.NullInt64
		)
		if err := rows.Scan(&item.PackageName, &item.TotalDownloads, &versionCount); err != nil {
			return nil, fmt.Errorf("store: scan package totals: %w", err)
		}
		if versionCount.Valid && versionCount.Int64 > 0 {
			vc := int(versionCount.Int64)
			item.VersionCount = &vc
		}
		index[item.PackageName] = len(out.Packages)
		out.Packages = append(out.Packages, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Flow: period downloads per package over the range.
	deltaRows, err := s.db.QueryContext(ctx, `
		SELECT cur.package_name,
		       CAST(SUM(GREATEST(cur.total_download_count - prev.total_download_count, 0)) AS SIGNED)
		FROM package_daily_snapshots cur
		JOIN package_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.package_name = cur.package_name
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		WHERE cur.tracked_repo_id = ?
		  AND cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
		GROUP BY cur.package_name`, repoID, from, to)
	if err != nil {
		return nil, fmt.Errorf("store: package breakdown deltas: %w", err)
	}
	defer deltaRows.Close()

	for deltaRows.Next() {
		var (
			name   string
			period int64
		)
		if err := deltaRows.Scan(&name, &period); err != nil {
			return nil, fmt.Errorf("store: scan package delta: %w", err)
		}
		if i, ok := index[name]; ok {
			out.Packages[i].PeriodDownloads = period
		}
	}
	if err := deltaRows.Err(); err != nil {
		return nil, err
	}

	sortPackagesByActivity(out.Packages)
	return out, nil
}

// PackageSeriesForRepo returns each package's download time series over the
// range, at daily / monthly / cumulative granularity — mirroring VersionSeries.
// "day"/"month" are download flows (self-join deltas, clamped, summed);
// "cumulative" is the running all-time total per day (a stock, no delta).
func (s *Store) PackageSeriesForRepo(ctx context.Context, repoID int, from, to string, interval Interval) ([]PackageSeries, error) {
	key := fmt.Sprintf("pkg-series|%d|%s|%s|%s", repoID, from, to, interval)
	return cachedDo(s.statsCache, key, func() ([]PackageSeries, error) {
		return s.packageSeriesForRepo(ctx, repoID, from, to, interval)
	})
}

func (s *Store) packageSeriesForRepo(ctx context.Context, repoID int, from, to string, interval Interval) ([]PackageSeries, error) {
	const deltaBase = `
		FROM package_daily_snapshots cur
		JOIN package_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.package_name = cur.package_name
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		WHERE cur.tracked_repo_id = ?
		  AND cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`

	var query string
	switch interval {
	case IntervalCumulative:
		query = `
			SELECT package_name,
			       DATE_FORMAT(DATE_SUB(snapshot_date, INTERVAL 1 DAY), '%Y-%m-%d'),
			       CAST(total_download_count AS SIGNED)
			FROM package_daily_snapshots
			WHERE tracked_repo_id = ?
			  AND snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
			ORDER BY package_name, snapshot_date`
	case IntervalMonth:
		query = `
			SELECT cur.package_name,
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m'),
			       CAST(SUM(GREATEST(cur.total_download_count - prev.total_download_count, 0)) AS SIGNED)` + deltaBase + `
			GROUP BY cur.package_name, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')
			ORDER BY cur.package_name, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')`
	default: // day
		query = `
			SELECT cur.package_name,
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m-%d'),
			       CAST(SUM(GREATEST(cur.total_download_count - prev.total_download_count, 0)) AS SIGNED)` + deltaBase + `
			GROUP BY cur.package_name, cur.snapshot_date
			ORDER BY cur.package_name, cur.snapshot_date`
	}

	rows, err := s.db.QueryContext(ctx, query, repoID, from, to)
	if err != nil {
		return nil, fmt.Errorf("store: package series: %w", err)
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*PackageSeries{}
	for rows.Next() {
		var (
			name  string
			date  string
			value int64
		)
		if err := rows.Scan(&name, &date, &value); err != nil {
			return nil, fmt.Errorf("store: scan package series: %w", err)
		}
		ps, ok := byName[name]
		if !ok {
			ps = &PackageSeries{PackageName: name, Points: []TimeSeriesPoint{}}
			byName[name] = ps
			order = append(order, name)
		}
		ps.Points = append(ps.Points, TimeSeriesPoint{Date: date, Value: value})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]PackageSeries, 0, len(order))
	for _, name := range order {
		out = append(out, *byName[name])
	}
	return out, nil
}

// PackageVersionBreakdown returns each tagged version's period downloads and
// latest figures for one package over a date range.
func (s *Store) PackageVersionBreakdown(ctx context.Context, repoID int, packageName, from, to string) (*PackageVersionBreakdown, error) {
	key := fmt.Sprintf("pkg-versions|%d|%s|%s|%s", repoID, packageName, from, to)
	return cachedDo(s.statsCache, key, func() (*PackageVersionBreakdown, error) {
		return s.packageVersionBreakdown(ctx, repoID, packageName, from, to)
	})
}

func (s *Store) packageVersionBreakdown(ctx context.Context, repoID int, packageName, from, to string) (*PackageVersionBreakdown, error) {
	out := &PackageVersionBreakdown{RepoID: repoID, PackageName: packageName, Versions: []PackageVersionItem{}}

	// Stock: every version's newest row (latest count + current tags).
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.version_github_id, v.tags, v.download_count
		FROM package_version_daily_snapshots v
		JOIN (
			SELECT version_github_id, MAX(snapshot_date) AS max_date
			FROM package_version_daily_snapshots
			WHERE tracked_repo_id = ? AND package_name = ?
			GROUP BY version_github_id
		) latest ON latest.version_github_id = v.version_github_id AND latest.max_date = v.snapshot_date
		WHERE v.tracked_repo_id = ? AND v.package_name = ?`,
		repoID, packageName, repoID, packageName)
	if err != nil {
		return nil, fmt.Errorf("store: package version totals: %w", err)
	}
	defer rows.Close()

	index := map[int64]int{}
	for rows.Next() {
		var (
			item PackageVersionItem
			tags sql.NullString
		)
		if err := rows.Scan(&item.VersionID, &tags, &item.TotalDownloads); err != nil {
			return nil, fmt.Errorf("store: scan package version totals: %w", err)
		}
		if tags.Valid && tags.String != "" {
			item.Tags = &tags.String
		}
		index[item.VersionID] = len(out.Versions)
		out.Versions = append(out.Versions, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Flow: period downloads per version over the range.
	deltaRows, err := s.db.QueryContext(ctx, `
		SELECT cur.version_github_id,
		       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED)
		FROM package_version_daily_snapshots cur
		JOIN package_version_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.package_name = cur.package_name
		 AND prev.version_github_id = cur.version_github_id
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		WHERE cur.tracked_repo_id = ? AND cur.package_name = ?
		  AND cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
		GROUP BY cur.version_github_id`,
		repoID, packageName, from, to)
	if err != nil {
		return nil, fmt.Errorf("store: package version deltas: %w", err)
	}
	defer deltaRows.Close()

	for deltaRows.Next() {
		var (
			id     int64
			period int64
		)
		if err := deltaRows.Scan(&id, &period); err != nil {
			return nil, fmt.Errorf("store: scan package version delta: %w", err)
		}
		if i, ok := index[id]; ok {
			out.Versions[i].PeriodDownloads = period
		}
	}
	if err := deltaRows.Err(); err != nil {
		return nil, err
	}

	sortVersionsByActivity(out.Versions)
	return out, nil
}

// sortPackagesByActivity orders by period downloads, then total, then name —
// most active first, stable for equal figures.
func sortPackagesByActivity(items []PackageBreakdownItem) {
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.PeriodDownloads != b.PeriodDownloads {
			return a.PeriodDownloads > b.PeriodDownloads
		}
		if a.TotalDownloads != b.TotalDownloads {
			return a.TotalDownloads > b.TotalDownloads
		}
		return a.PackageName < b.PackageName
	})
}

// sortVersionsByActivity orders by period downloads, then total, then id desc
// (newer version ids first for equal figures).
func sortVersionsByActivity(items []PackageVersionItem) {
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.PeriodDownloads != b.PeriodDownloads {
			return a.PeriodDownloads > b.PeriodDownloads
		}
		if a.TotalDownloads != b.TotalDownloads {
			return a.TotalDownloads > b.TotalDownloads
		}
		return a.VersionID > b.VersionID
	})
}
