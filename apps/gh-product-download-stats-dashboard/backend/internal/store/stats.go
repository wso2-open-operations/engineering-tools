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
	"time"
)

// Summary computes the dashboard KPI figures.
func (s *Store) Summary(ctx context.Context) (*Summary, error) {
	var sum Summary

	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tracked_repositories WHERE is_active = 1`,
	).Scan(&sum.TrackedRepositories); err != nil {
		return nil, fmt.Errorf("store: summary count repos: %w", err)
	}

	// Totals are summed over each active repository's most recent snapshot.
	const totalsQuery = `
		SELECT COALESCE(SUM(s.total_download_count), 0),
		       COALESCE(SUM(s.stargazers_count), 0),
		       COALESCE(SUM(s.forks_count), 0)
		FROM tracked_repositories t
		JOIN repository_daily_snapshots s ON s.id = (
			SELECT s2.id FROM repository_daily_snapshots s2
			WHERE s2.tracked_repo_id = t.id
			ORDER BY s2.snapshot_date DESC, s2.id DESC
			LIMIT 1
		)
		WHERE t.is_active = 1`
	if err := s.db.QueryRowContext(ctx, totalsQuery).
		Scan(&sum.TotalDownloads, &sum.TotalStars, &sum.TotalForks); err != nil {
		return nil, fmt.Errorf("store: summary totals: %w", err)
	}

	if err := s.db.QueryRowContext(ctx,
		`SELECT
		   COALESCE(SUM(CASE WHEN s.snapshot_date >= (CURDATE() - INTERVAL 29 DAY) THEN s.clone_count ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN s.snapshot_date >= (CURDATE() - INTERVAL 13 DAY) THEN s.clone_count ELSE 0 END), 0)
		 FROM repository_daily_snapshots s
		 JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1`,
	).Scan(&sum.TotalClonesLast30d, &sum.TotalClonesLast14d); err != nil {
		return nil, fmt.Errorf("store: summary clones: %w", err)
	}

	// Today's / previous-day / this-month download counts, derived from per-repo
	// daily deltas (first snapshot per repo is NULL → omitted, per the first-day rule).
	// snapshot_date is stamped with the sync's run date, not the date the delta's
	// activity happened — GitHub only reports a cumulative total, so the delta at
	// the latest snapshot_date reflects the PREVIOUS day's completed activity.
	// asOfDate is therefore MAX(snapshot_date) - 1 day, so it names the day
	// TodayDownloads actually represents, not the day the sync happened to run.
	// MonthDownloads is likewise attributed by activity_date (snapshot_date - 1),
	// so a delta whose snapshot_date falls on the 1st (but whose activity
	// actually happened on the last day of the PREVIOUS month) isn't miscounted
	// into the wrong month.
	const downloadsQuery = `
		WITH deltas AS (
			SELECT s.snapshot_date,
			       DATE_SUB(s.snapshot_date, INTERVAL 1 DAY) AS activity_date,
			       s.total_download_count - LAG(s.total_download_count)
			           OVER (PARTITION BY s.tracked_repo_id ORDER BY s.snapshot_date) AS d
			FROM repository_daily_snapshots s
			JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1
		)
		SELECT
		  COALESCE((SELECT SUM(GREATEST(d, 0)) FROM deltas WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM deltas)), 0),
		  COALESCE((SELECT SUM(GREATEST(d, 0)) FROM deltas WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM deltas WHERE snapshot_date < (SELECT MAX(snapshot_date) FROM deltas))), 0),
		  COALESCE((SELECT SUM(GREATEST(d, 0)) FROM deltas WHERE DATE_FORMAT(activity_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')), 0),
		  DATE_SUB((SELECT MAX(snapshot_date) FROM deltas), INTERVAL 1 DAY)`
	var prevDownloads int64
	var asOfDate sql.NullTime
	if err := s.db.QueryRowContext(ctx, downloadsQuery).
		Scan(&sum.TodayDownloads, &prevDownloads, &sum.MonthDownloads, &asOfDate); err != nil {
		return nil, fmt.Errorf("store: summary downloads: %w", err)
	}
	if prevDownloads > 0 {
		pct := (float64(sum.TodayDownloads) - float64(prevDownloads)) / float64(prevDownloads) * 100
		sum.TodayDeltaPct = &pct
	}
	if asOfDate.Valid {
		d := formatDate(asOfDate.Time)
		sum.AsOfDate = &d
	}

	topProducts, err := s.topProducts(ctx, 8)
	if err != nil {
		return nil, err
	}
	sum.TopProducts = topProducts

	var (
		status   sql.NullString
		syncTime sql.NullTime
	)
	err = s.db.QueryRowContext(ctx,
		`SELECT status, COALESCE(completed_at, started_at) FROM sync_job_logs
		 ORDER BY started_at DESC, id DESC LIMIT 1`,
	).Scan(&status, &syncTime)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("store: summary last sync: %w", err)
	}
	if status.Valid {
		sum.LastSyncStatus = &status.String
	}
	if syncTime.Valid {
		d := formatDateTime(syncTime.Time)
		sum.LastSyncDate = &d
	}

	return &sum, nil
}

// Interval selects daily or monthly granularity for the time-series endpoints.
type Interval string

const (
	// IntervalDay yields one point per snapshot day (daily delta for flow metrics).
	IntervalDay Interval = "day"
	// IntervalMonth aggregates points by calendar month.
	IntervalMonth Interval = "month"
	// IntervalCumulative yields the running cumulative value per day.
	IntervalCumulative Interval = "cumulative"
)

// ParseInterval validates the interval query parameter ("" defaults to day).
func ParseInterval(s string) (Interval, bool) {
	switch s {
	case "", string(IntervalDay):
		return IntervalDay, true
	case string(IntervalMonth):
		return IntervalMonth, true
	case string(IntervalCumulative):
		return IntervalCumulative, true
	default:
		return "", false
	}
}

// Metric selects a point-in-time GitHub stat column for the metric series endpoint.
type Metric string

const (
	MetricStars      Metric = "stars"
	MetricForks      Metric = "forks"
	MetricWatchers   Metric = "watchers"
	MetricOpenIssues Metric = "openIssues"
)

// metricColumns maps a whitelisted Metric to its snapshot column. Only values in
// this map are ever interpolated into SQL, so the column name is never user input.
var metricColumns = map[Metric]string{
	MetricStars:      "stargazers_count",
	MetricForks:      "forks_count",
	MetricWatchers:   "watchers_count",
	MetricOpenIssues: "open_issues_count",
}

// ParseMetric validates the metric query parameter against the whitelist.
func ParseMetric(s string) (Metric, bool) {
	m := Metric(s)
	_, ok := metricColumns[m]
	return m, ok
}

// collectSeries groups (repoID, repoName, date, value) rows into per-repo series,
// preserving first-seen order. The date column must already be a formatted string.
func collectSeries(rows *sql.Rows) ([]RepoSeries, error) {
	c := newSeriesCollector()
	for rows.Next() {
		var (
			repoID int
			name   string
			date   string
			value  int64
		)
		if err := rows.Scan(&repoID, &name, &date, &value); err != nil {
			return nil, fmt.Errorf("store: scan series: %w", err)
		}
		c.add(repoID, name, TimeSeriesPoint{Date: date, Value: value})
	}
	return c.series(), rows.Err()
}

// topProducts returns the top-N active repositories by latest cumulative
// downloads, each with its latest total, today's download delta, and star count.
func (s *Store) topProducts(ctx context.Context, limit int) ([]TopProduct, error) {
	const query = `
		SELECT t.id, t.repo_name, t.product_name,
		       s.total_download_count,
		       s.stargazers_count,
		       GREATEST(s.total_download_count - COALESCE(p.total_download_count, s.total_download_count), 0) AS today_dl
		FROM tracked_repositories t
		JOIN repository_daily_snapshots s ON s.id = (
			SELECT id FROM repository_daily_snapshots WHERE tracked_repo_id = t.id
			ORDER BY snapshot_date DESC, id DESC LIMIT 1
		)
		LEFT JOIN repository_daily_snapshots p ON p.id = (
			SELECT id FROM repository_daily_snapshots WHERE tracked_repo_id = t.id
			ORDER BY snapshot_date DESC, id DESC LIMIT 1 OFFSET 1
		)
		WHERE t.is_active = 1
		ORDER BY s.total_download_count DESC
		LIMIT ?`
	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("store: top products: %w", err)
	}
	defer rows.Close()

	out := []TopProduct{}
	for rows.Next() {
		var (
			tp          TopProduct
			productName sql.NullString
		)
		if err := rows.Scan(&tp.RepoID, &tp.RepoName, &productName,
			&tp.TotalDownloads, &tp.Stars, &tp.TodayDownloads); err != nil {
			return nil, fmt.Errorf("store: scan top product: %w", err)
		}
		if productName.Valid {
			tp.ProductName = &productName.String
		}
		out = append(out, tp)
	}
	return out, rows.Err()
}

// TotalSeries returns the cumulative download series per repository over the date
// range, at daily or monthly (end-of-month value) granularity. Dates are labeled
// by activity_date (snapshot_date - 1 day): the sync cron stamps snapshot_date
// with its own run date, but the cumulative total it captures only reflects state
// as of the end of the PREVIOUS day, so activity_date is the day the value was
// actually true as of.
func (s *Store) TotalSeries(ctx context.Context, from, to string, repoIDs []int, interval Interval) ([]RepoSeries, error) {
	activity := `
		SELECT s.tracked_repo_id AS tracked_repo_id, t.repo_name AS repo_name,
		       DATE_SUB(s.snapshot_date, INTERVAL 1 DAY) AS activity_date,
		       s.total_download_count AS value
		FROM repository_daily_snapshots s
		JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1`
	var args []any
	if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
		activity += " WHERE s.tracked_repo_id IN (" + in + ")"
		args = append(args, inArgs...)
	}

	if interval == IntervalMonth {
		query := `
			SELECT x.tracked_repo_id, x.repo_name, x.month_key, x.value FROM (
				SELECT tracked_repo_id, repo_name,
				       DATE_FORMAT(activity_date, '%Y-%m') AS month_key,
				       value,
				       ROW_NUMBER() OVER (PARTITION BY tracked_repo_id, DATE_FORMAT(activity_date, '%Y-%m')
				                          ORDER BY activity_date DESC) AS rn
				FROM (` + activity + `) a
				WHERE activity_date BETWEEN ? AND ?
			) x WHERE x.rn = 1 ORDER BY x.tracked_repo_id, x.month_key`
		args := append(append([]any{}, args...), from, to)
		rows, err := s.db.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("store: total series (monthly): %w", err)
		}
		defer rows.Close()
		return collectSeries(rows)
	}

	query := `
		SELECT tracked_repo_id, repo_name, DATE_FORMAT(activity_date, '%Y-%m-%d'), value
		FROM (` + activity + `) a
		WHERE activity_date BETWEEN ? AND ?
		ORDER BY tracked_repo_id, activity_date`
	args = append(args, from, to)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: total series: %w", err)
	}
	defer rows.Close()
	return collectSeries(rows)
}

// DailySeries returns per-repository daily download deltas over the date range,
// at daily or monthly granularity. Deltas are computed with a window function
// across the repository's full history so the first day of the range still gets a
// correct delta; the repository's very first snapshot has a NULL delta and is
// omitted — this is what prevents a newly-added repo's day-1 total (which carries
// all historical downloads) from skewing the graph. Negative deltas (e.g. an asset
// removed upstream) are clamped to zero. Dates are labeled by activity_date
// (snapshot_date - 1 day): the delta stored at a row stamped with the sync's run
// date is really the PREVIOUS day's completed activity (GitHub only reports a
// cumulative total, never a per-day delta), so activity_date is the day the
// delta actually represents.
func (s *Store) DailySeries(ctx context.Context, from, to string, repoIDs []int, interval Interval) ([]RepoSeries, error) {
	inner := `
		SELECT s.tracked_repo_id AS tracked_repo_id, t.repo_name AS repo_name,
		       DATE_SUB(s.snapshot_date, INTERVAL 1 DAY) AS activity_date,
		       DATE_FORMAT(DATE_SUB(s.snapshot_date, INTERVAL 1 DAY), '%Y-%m') AS month_key,
		       s.total_download_count - LAG(s.total_download_count)
		           OVER (PARTITION BY s.tracked_repo_id ORDER BY s.snapshot_date) AS delta
		FROM repository_daily_snapshots s
		JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1`
	var args []any
	if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
		inner += " WHERE s.tracked_repo_id IN (" + in + ")"
		args = append(args, inArgs...)
	}

	var query string
	if interval == IntervalMonth {
		query = `SELECT d.tracked_repo_id, d.repo_name, d.month_key, CAST(SUM(GREATEST(d.delta, 0)) AS SIGNED) FROM (` + inner + `) d
			WHERE d.activity_date BETWEEN ? AND ? AND d.delta IS NOT NULL
			GROUP BY d.tracked_repo_id, d.repo_name, d.month_key
			ORDER BY d.tracked_repo_id, d.month_key`
	} else {
		query = `SELECT d.tracked_repo_id, d.repo_name, DATE_FORMAT(d.activity_date, '%Y-%m-%d'), GREATEST(d.delta, 0) FROM (` + inner + `) d
			WHERE d.activity_date BETWEEN ? AND ? AND d.delta IS NOT NULL
			ORDER BY d.tracked_repo_id, d.activity_date`
	}
	args = append(args, from, to)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: daily series: %w", err)
	}
	defer rows.Close()
	return collectSeries(rows)
}

// MetricSeries returns a per-repository time series for a GitHub stat
// (stars/forks/watchers/open issues) over the date range. Dates are labeled by
// activity_date (snapshot_date - 1 day), consistent with TotalSeries.
//
// "cumulative" returns the raw point-in-time value per day (e.g. "1,234 stars
// as of this day"). "day"/"month" return the actual CHANGE in the metric
// (stars/forks/watchers/issues gained or lost that day, or summed over the
// month) via the same LAG() delta pattern as DailySeries — unlike downloads,
// this delta is deliberately NOT clamped to zero: losing stars, forks, or
// watchers, or issues being closed, are real, meaningful negative deltas.
func (s *Store) MetricSeries(ctx context.Context, metric Metric, from, to string, repoIDs []int, interval Interval) ([]RepoSeries, error) {
	col, ok := metricColumns[metric]
	if !ok {
		return nil, fmt.Errorf("store: unknown metric %q", metric)
	}

	if interval == IntervalCumulative {
		activity := `
			SELECT s.tracked_repo_id AS tracked_repo_id, t.repo_name AS repo_name,
			       DATE_SUB(s.snapshot_date, INTERVAL 1 DAY) AS activity_date,
			       s.` + col + ` AS value
			FROM repository_daily_snapshots s
			JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1`
		var args []any
		if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
			activity += " WHERE s.tracked_repo_id IN (" + in + ")"
			args = append(args, inArgs...)
		}
		query := `
			SELECT tracked_repo_id, repo_name, DATE_FORMAT(activity_date, '%Y-%m-%d'), value
			FROM (` + activity + `) a
			WHERE activity_date BETWEEN ? AND ?
			ORDER BY tracked_repo_id, activity_date`
		args = append(args, from, to)
		rows, err := s.db.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("store: metric series (cumulative): %w", err)
		}
		defer rows.Close()
		return collectSeries(rows)
	}

	// First snapshot per repo has a NULL delta (nothing to diff against) and is
	// omitted, same as DailySeries — prevents a newly-tracked repo's day-1
	// cumulative value from being misread as a huge single-day delta.
	deltas := `
		SELECT s.tracked_repo_id AS tracked_repo_id, t.repo_name AS repo_name,
		       DATE_SUB(s.snapshot_date, INTERVAL 1 DAY) AS activity_date,
		       DATE_FORMAT(DATE_SUB(s.snapshot_date, INTERVAL 1 DAY), '%Y-%m') AS month_key,
		       s.` + col + ` - LAG(s.` + col + `)
		           OVER (PARTITION BY s.tracked_repo_id ORDER BY s.snapshot_date) AS delta
		FROM repository_daily_snapshots s
		JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1`
	var args []any
	if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
		deltas += " WHERE s.tracked_repo_id IN (" + in + ")"
		args = append(args, inArgs...)
	}

	var query string
	if interval == IntervalMonth {
		query = `SELECT d.tracked_repo_id, d.repo_name, d.month_key, CAST(SUM(d.delta) AS SIGNED) FROM (` + deltas + `) d
			WHERE d.activity_date BETWEEN ? AND ? AND d.delta IS NOT NULL
			GROUP BY d.tracked_repo_id, d.repo_name, d.month_key
			ORDER BY d.tracked_repo_id, d.month_key`
	} else {
		query = `SELECT d.tracked_repo_id, d.repo_name, DATE_FORMAT(d.activity_date, '%Y-%m-%d'), d.delta FROM (` + deltas + `) d
			WHERE d.activity_date BETWEEN ? AND ? AND d.delta IS NOT NULL
			ORDER BY d.tracked_repo_id, d.activity_date`
	}
	args = append(args, from, to)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: metric series: %w", err)
	}
	defer rows.Close()
	return collectSeries(rows)
}

// CloneSeries returns per-repository clone-traffic history over the date range.
func (s *Store) CloneSeries(ctx context.Context, from, to string, repoIDs []int) ([]CloneSeries, error) {
	query := `
		SELECT s.tracked_repo_id, t.repo_name, s.snapshot_date, s.clone_count, s.clone_uniques
		FROM repository_daily_snapshots s
		JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1
		WHERE s.snapshot_date BETWEEN ? AND ?`
	args := []any{from, to}
	if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
		query += " AND s.tracked_repo_id IN (" + in + ")"
		args = append(args, inArgs...)
	}
	query += " ORDER BY s.tracked_repo_id, s.snapshot_date"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: clone series: %w", err)
	}
	defer rows.Close()

	order := []int{}
	byID := map[int]*CloneSeries{}
	for rows.Next() {
		var (
			repoID  int
			name    string
			date    time.Time
			count   int
			uniques int
		)
		if err := rows.Scan(&repoID, &name, &date, &count, &uniques); err != nil {
			return nil, fmt.Errorf("store: scan clone series: %w", err)
		}
		cs, ok := byID[repoID]
		if !ok {
			cs = &CloneSeries{RepoID: repoID, RepoName: name, Points: []ClonePoint{}}
			byID[repoID] = cs
			order = append(order, repoID)
		}
		cs.Points = append(cs.Points, ClonePoint{Date: formatDate(date), Count: count, Uniques: uniques})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]CloneSeries, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, nil
}

// VersionBreakdown returns per-version download totals for a repository at the
// latest snapshot date within the range.
func (s *Store) VersionBreakdown(ctx context.Context, repoID int, from, to string) (*VersionBreakdown, error) {
	snapDate, err := s.maxAssetSnapshotDate(ctx, repoID, from, to)
	if err != nil {
		return nil, err
	}
	out := &VersionBreakdown{RepoID: repoID, Versions: []VersionBreakdownItem{}}
	if snapDate == "" {
		return out, nil
	}
	out.SnapshotDate = activityDateOf(snapDate)

	const query = `
		SELECT release_tag, MAX(release_name), SUM(download_count)
		FROM release_asset_daily_snapshots
		WHERE tracked_repo_id = ? AND snapshot_date = ?
		GROUP BY release_tag
		ORDER BY SUM(download_count) DESC, release_tag`
	rows, err := s.db.QueryContext(ctx, query, repoID, snapDate)
	if err != nil {
		return nil, fmt.Errorf("store: version breakdown: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			tag   string
			name  sql.NullString
			total int64
		)
		if err := rows.Scan(&tag, &name, &total); err != nil {
			return nil, fmt.Errorf("store: scan version breakdown: %w", err)
		}
		item := VersionBreakdownItem{ReleaseTag: tag, DownloadCount: total}
		if name.Valid {
			item.ReleaseName = &name.String
		}
		out.Versions = append(out.Versions, item)
	}
	return out, rows.Err()
}

// VersionSeries returns a per-release-tag download time series for a repository.
// interval "day" = daily delta, "month" = monthly sum of deltas, "cumulative" =
// running total. Asset rows are summed per (release_tag, date) first. Dates are
// labeled by activity_date (snapshot_date - 1 day) — see DailySeries/TotalSeries
// comments for why: the sync cron stamps snapshot_date with its own run date, but
// the value it captures only reflects state as of the end of the PREVIOUS day.
func (s *Store) VersionSeries(ctx context.Context, repoID int, from, to string, interval Interval) ([]VersionSeries, error) {
	const base = `
		WITH per_day AS (
			SELECT release_tag, MAX(release_name) AS release_name, snapshot_date,
			       SUM(download_count) AS total
			FROM release_asset_daily_snapshots
			WHERE tracked_repo_id = ?
			GROUP BY release_tag, snapshot_date
		),
		deltas AS (
			SELECT release_tag, release_name, snapshot_date,
			       DATE_SUB(snapshot_date, INTERVAL 1 DAY) AS activity_date, total,
			       total - LAG(total) OVER (PARTITION BY release_tag ORDER BY snapshot_date) AS d
			FROM per_day
		)`

	var query string
	switch interval {
	case IntervalCumulative:
		query = base + `
			SELECT release_tag, release_name, DATE_FORMAT(activity_date, '%Y-%m-%d'), total
			FROM deltas
			WHERE activity_date BETWEEN ? AND ?
			ORDER BY release_tag, activity_date`
	case IntervalMonth:
		query = base + `
			SELECT release_tag, MAX(release_name), DATE_FORMAT(activity_date, '%Y-%m'),
			       CAST(SUM(GREATEST(d, 0)) AS SIGNED)
			FROM deltas
			WHERE activity_date BETWEEN ? AND ? AND d IS NOT NULL
			GROUP BY release_tag, DATE_FORMAT(activity_date, '%Y-%m')
			ORDER BY release_tag, DATE_FORMAT(activity_date, '%Y-%m')`
	default: // day
		query = base + `
			SELECT release_tag, release_name, DATE_FORMAT(activity_date, '%Y-%m-%d'), GREATEST(d, 0)
			FROM deltas
			WHERE activity_date BETWEEN ? AND ? AND d IS NOT NULL
			ORDER BY release_tag, activity_date`
	}

	rows, err := s.db.QueryContext(ctx, query, repoID, from, to)
	if err != nil {
		return nil, fmt.Errorf("store: version series: %w", err)
	}
	defer rows.Close()

	order := []string{}
	byTag := map[string]*VersionSeries{}
	for rows.Next() {
		var (
			tag   string
			name  sql.NullString
			date  string
			value int64
		)
		if err := rows.Scan(&tag, &name, &date, &value); err != nil {
			return nil, fmt.Errorf("store: scan version series: %w", err)
		}
		vs, ok := byTag[tag]
		if !ok {
			vs = &VersionSeries{ReleaseTag: tag, Points: []TimeSeriesPoint{}}
			if name.Valid {
				vs.ReleaseName = &name.String
			}
			byTag[tag] = vs
			order = append(order, tag)
		}
		vs.Points = append(vs.Points, TimeSeriesPoint{Date: date, Value: value})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]VersionSeries, 0, len(order))
	for _, tag := range order {
		out = append(out, *byTag[tag])
	}
	return out, nil
}

// AssetBreakdown returns per-asset download deltas summed over the date range
// — matching VersionSeries's day-delta pattern, so the Assets table relies on
// the same date range as the Versions table, instead of a single point-in-time
// snapshot. Optionally filtered to a single release version. Negative deltas
// are clamped to zero, consistent with every other download-delta query (a
// real per-asset count can only grow). asset_github_id is the LAG() partition
// key — it's the schema's actual per-asset identity (see uk_asset_date).
// SnapshotDate is kept as metadata (the latest activity date the totals cover,
// for staleness awareness), not as the date the totals are "as of" a single day.
func (s *Store) AssetBreakdown(ctx context.Context, repoID int, from, to string, version string) (*AssetBreakdown, error) {
	out := &AssetBreakdown{RepoID: repoID, Assets: []AssetBreakdownItem{}}
	if version != "" {
		out.Version = &version
	}

	snapDate, err := s.maxAssetSnapshotDate(ctx, repoID, from, to)
	if err != nil {
		return nil, err
	}
	if snapDate == "" {
		return out, nil
	}
	out.SnapshotDate = activityDateOf(snapDate)

	query := `
		WITH deltas AS (
			SELECT release_tag, asset_name, asset_github_id, content_type, asset_size,
			       DATE_SUB(snapshot_date, INTERVAL 1 DAY) AS activity_date,
			       download_count - LAG(download_count)
			           OVER (PARTITION BY asset_github_id ORDER BY snapshot_date) AS d
			FROM release_asset_daily_snapshots
			WHERE tracked_repo_id = ?`
	args := []any{repoID}
	if version != "" {
		query += " AND release_tag = ?"
		args = append(args, version)
	}
	query += `
		)
		SELECT release_tag, asset_name, asset_github_id, MAX(content_type), MAX(asset_size),
		       CAST(SUM(GREATEST(d, 0)) AS SIGNED) AS total
		FROM deltas
		WHERE activity_date BETWEEN ? AND ? AND d IS NOT NULL
		GROUP BY release_tag, asset_name, asset_github_id
		ORDER BY total DESC, asset_name`
	args = append(args, from, to)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: asset breakdown: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			item        AssetBreakdownItem
			contentType sql.NullString
			assetSize   sql.NullInt64
		)
		if err := rows.Scan(&item.ReleaseTag, &item.AssetName, &item.AssetGithubID,
			&contentType, &assetSize, &item.DownloadCount); err != nil {
			return nil, fmt.Errorf("store: scan asset breakdown: %w", err)
		}
		if contentType.Valid {
			item.ContentType = &contentType.String
		}
		if assetSize.Valid {
			item.AssetSize = &assetSize.Int64
		}
		out.Assets = append(out.Assets, item)
	}
	return out, rows.Err()
}

// Compare returns side-by-side figures for the given repositories over the range.
func (s *Store) Compare(ctx context.Context, repoIDs []int, from, to string) ([]CompareItem, error) {
	const query = `
		SELECT t.repo_name,
		  (SELECT total_download_count FROM repository_daily_snapshots
		     WHERE tracked_repo_id = t.id AND snapshot_date BETWEEN ? AND ?
		     ORDER BY snapshot_date DESC, id DESC LIMIT 1) AS latest_total,
		  (SELECT total_download_count FROM repository_daily_snapshots
		     WHERE tracked_repo_id = t.id AND snapshot_date BETWEEN ? AND ?
		     ORDER BY snapshot_date ASC, id ASC LIMIT 1) AS earliest_total,
		  (SELECT stargazers_count FROM repository_daily_snapshots
		     WHERE tracked_repo_id = t.id AND snapshot_date BETWEEN ? AND ?
		     ORDER BY snapshot_date DESC, id DESC LIMIT 1) AS stars,
		  (SELECT forks_count FROM repository_daily_snapshots
		     WHERE tracked_repo_id = t.id AND snapshot_date BETWEEN ? AND ?
		     ORDER BY snapshot_date DESC, id DESC LIMIT 1) AS forks,
		  (SELECT COALESCE(SUM(clone_count), 0) FROM repository_daily_snapshots
		     WHERE tracked_repo_id = t.id AND snapshot_date BETWEEN ? AND ?) AS clones
		FROM tracked_repositories t
		WHERE t.id = ? AND t.is_active = 1`

	out := []CompareItem{}
	for _, id := range repoIDs {
		args := []any{from, to, from, to, from, to, from, to, from, to, id}
		var (
			name        string
			latestTotal sql.NullInt64
			earliestTot sql.NullInt64
			stars       sql.NullInt64
			forks       sql.NullInt64
			clonesInRng int
		)
		err := s.db.QueryRowContext(ctx, query, args...).
			Scan(&name, &latestTotal, &earliestTot, &stars, &forks, &clonesInRng)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("store: compare repo %d: %w", id, err)
		}
		downloadsInRange := latestTotal.Int64 - earliestTot.Int64
		if downloadsInRange < 0 {
			downloadsInRange = 0
		}
		out = append(out, CompareItem{
			RepoID:           id,
			RepoName:         name,
			TotalDownloads:   latestTotal.Int64,
			DownloadsInRange: downloadsInRange,
			Stars:            int(stars.Int64),
			Forks:            int(forks.Int64),
			ClonesInRange:    clonesInRng,
		})
	}
	return out, nil
}

// maxAssetSnapshotDate returns the latest asset snapshot date for a repository
// within the range, or "" when there is none.
func (s *Store) maxAssetSnapshotDate(ctx context.Context, repoID int, from, to string) (string, error) {
	var d sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT MAX(snapshot_date) FROM release_asset_daily_snapshots
		 WHERE tracked_repo_id = ? AND DATE_SUB(snapshot_date, INTERVAL 1 DAY) BETWEEN ? AND ?`,
		repoID, from, to,
	).Scan(&d)
	if err != nil {
		return "", fmt.Errorf("store: max asset snapshot date: %w", err)
	}
	if !d.Valid {
		return "", nil
	}
	return formatDate(d.Time), nil
}

// activityDateOf shifts a "YYYY-MM-DD" snapshot_date back one day to the
// activity_date it actually represents — the sync cron stamps snapshot_date with
// its own run date, but the value it captures only reflects state as of the end
// of the PREVIOUS day (see DailySeries/TotalSeries comments). Returns the input
// unchanged if it isn't a valid date.
func activityDateOf(snapshotDate string) string {
	t, err := time.Parse("2006-01-02", snapshotDate)
	if err != nil {
		return snapshotDate
	}
	return formatDate(t.AddDate(0, 0, -1))
}

// seriesCollector accumulates time-series points grouped by repository while
// preserving first-seen order.
type seriesCollector struct {
	order []int
	byID  map[int]*RepoSeries
}

func newSeriesCollector() *seriesCollector {
	return &seriesCollector{byID: map[int]*RepoSeries{}}
}

func (c *seriesCollector) add(repoID int, name string, point TimeSeriesPoint) {
	rs, ok := c.byID[repoID]
	if !ok {
		rs = &RepoSeries{RepoID: repoID, RepoName: name, Points: []TimeSeriesPoint{}}
		c.byID[repoID] = rs
		c.order = append(c.order, repoID)
	}
	rs.Points = append(rs.Points, point)
}

func (c *seriesCollector) series() []RepoSeries {
	out := make([]RepoSeries, 0, len(c.order))
	for _, id := range c.order {
		out = append(out, *c.byID[id])
	}
	return out
}
