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
// Summary is served from statsCache: it fans out to several aggregate queries
// (including the per-asset download delta), and the underlying data changes
// only once a day. Repository mutations purge the cache (see cache.go).
func (s *Store) Summary(ctx context.Context) (*Summary, error) {
	return cachedDo(s.statsCache, "summary", func() (*Summary, error) {
		return s.summary(ctx)
	})
}

func (s *Store) summary(ctx context.Context) (*Summary, error) {
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

	// Today's / previous-day / this-month download counts. These MUST use the
	// same per-ASSET consecutive-day delta as DailySeries (the Downloads page),
	// or the KPI cards disagree with it: the old repo-level total_download_count
	// LAG diff counts newly-discovered / reappearing assets as same-day
	// downloads, inflating the figures (e.g. 12,875 vs the real 249).
	//
	// The self-join is pre-aggregated to one row per activity_date inside the
	// CTE, so the expensive scan runs once and the today/prev/month picks
	// operate on a handful of rows. The scan is bounded to snapshots from the
	// start of the latest snapshot's month onward (enough for the current
	// calendar month plus the two most recent activity days), anchored on the
	// data itself so a stale sync still resolves today/prev correctly.
	//
	// Dates are labeled by activity_date = snapshot_date - 1 (GitHub reports a
	// cumulative total, so the latest snapshot's delta is the PREVIOUS day's
	// completed activity); asOfDate is MAX(activity_date), and MonthDownloads
	// is attributed by activity_date so a snapshot on the 1st (activity on the
	// prior month's last day) isn't miscounted into this month.
	const downloadsQuery = `
		WITH daily AS (
			SELECT DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY) AS activity_date,
			       SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS total
			FROM release_asset_daily_snapshots cur
			JOIN release_asset_daily_snapshots prev
			  ON prev.tracked_repo_id = cur.tracked_repo_id
			 AND prev.asset_github_id = cur.asset_github_id
			 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
			JOIN tracked_repositories t ON t.id = cur.tracked_repo_id AND t.is_active = 1
			WHERE cur.snapshot_date >= (
				SELECT DATE_SUB(DATE_FORMAT(MAX(snapshot_date), '%Y-%m-01'), INTERVAL 1 DAY)
				FROM release_asset_daily_snapshots
			)
			GROUP BY DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		)
		SELECT
		  COALESCE((SELECT total FROM daily WHERE activity_date = (SELECT MAX(activity_date) FROM daily)), 0),
		  COALESCE((SELECT total FROM daily WHERE activity_date = (SELECT MAX(activity_date) FROM daily WHERE activity_date < (SELECT MAX(activity_date) FROM daily))), 0),
		  COALESCE((SELECT SUM(total) FROM daily WHERE DATE_FORMAT(activity_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')), 0),
		  (SELECT MAX(activity_date) FROM daily)`
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
// at daily or monthly granularity. A day's delta is the sum, per repo, of each
// ASSET's growth versus its own row exactly 1 day earlier — expressed as a
// self-join on the uk_asset_date unique key rather than a LAG() window: the
// join makes both exclusions structural (no previous-day row, no delta) and
// keeps the query index-driven instead of window-scanning the table's full
// history on every request. The exclusions are deliberate:
//   - An asset's first-ever recorded row contributes nothing, so a release the
//     sync discovers for the first time (e.g. an older release that predates
//     tracking, caught up in one run) can't dump its entire historical download
//     count into a single day.
//   - An asset that vanishes from the data and reappears later (e.g. old
//     milestone releases the legacy scraper stopped capturing in 2024,
//     rediscovered by the new cron's full sweep) has no row exactly 1 day
//     before its comeback, so the whole gap's growth — unattributable to any
//     one day — is likewise excluded.
//
// Negative per-asset deltas (e.g. an asset removed upstream) are clamped to
// zero before summing. Dates are labeled by activity_date (snapshot_date - 1
// day): the delta stored at a row stamped with the sync's run date is really
// the PREVIOUS day's completed activity (GitHub only reports a cumulative
// total, never a per-day delta) — hence the range filter on cur.snapshot_date
// is shifted forward one day, which also keeps it sargable on idx_snapshot_date.
// Results are served from statsCache (see cache.go): the underlying data only
// changes once a day, and the full-history variant of this query is the most
// expensive read in the service.
func (s *Store) DailySeries(ctx context.Context, from, to string, repoIDs []int, interval Interval) ([]RepoSeries, error) {
	key := fmt.Sprintf("daily|%s|%s|%v|%s", from, to, repoIDs, interval)
	return cachedDo(s.statsCache, key, func() ([]RepoSeries, error) {
		return s.dailySeries(ctx, from, to, repoIDs, interval)
	})
}

func (s *Store) dailySeries(ctx context.Context, from, to string, repoIDs []int, interval Interval) ([]RepoSeries, error) {
	base := `
		FROM release_asset_daily_snapshots cur
		JOIN release_asset_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.asset_github_id = cur.asset_github_id
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		JOIN tracked_repositories t ON t.id = cur.tracked_repo_id AND t.is_active = 1
		WHERE cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`
	args := []any{from, to}
	if in, inArgs := repoIDPlaceholders(repoIDs); in != "" {
		base += " AND cur.tracked_repo_id IN (" + in + ")"
		args = append(args, inArgs...)
	}

	var query string
	if interval == IntervalMonth {
		query = `
			SELECT cur.tracked_repo_id, t.repo_name,
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m'),
			       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED)` + base + `
			GROUP BY cur.tracked_repo_id, t.repo_name, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')
			ORDER BY cur.tracked_repo_id, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')`
	} else {
		query = `
			SELECT cur.tracked_repo_id, t.repo_name,
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m-%d'),
			       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED)` + base + `
			GROUP BY cur.tracked_repo_id, t.repo_name, cur.snapshot_date
			ORDER BY cur.tracked_repo_id, cur.snapshot_date`
	}

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

// CloneSeries returns per-repository clone-traffic history over the date
// range. Dates are labeled by activity_date (snapshot_date - 1 day), same as
// every other series function: the cron matches clone_count/clone_uniques to
// the most recently COMPLETE day (see main.bal), which is always the day
// before the sync's own run date, so today's sync row holds yesterday's clone
// traffic, never today's — today can never have a clone data point, the same
// way it can never have a download delta. Results are cached (see cache.go).
func (s *Store) CloneSeries(ctx context.Context, from, to string, repoIDs []int) ([]CloneSeries, error) {
	key := fmt.Sprintf("clones|%s|%s|%v", from, to, repoIDs)
	return cachedDo(s.statsCache, key, func() ([]CloneSeries, error) {
		return s.cloneSeries(ctx, from, to, repoIDs)
	})
}

func (s *Store) cloneSeries(ctx context.Context, from, to string, repoIDs []int) ([]CloneSeries, error) {
	query := `
		SELECT s.tracked_repo_id, t.repo_name, DATE_SUB(s.snapshot_date, INTERVAL 1 DAY), s.clone_count, s.clone_uniques
		FROM repository_daily_snapshots s
		JOIN tracked_repositories t ON t.id = s.tracked_repo_id AND t.is_active = 1
		WHERE s.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`
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
// running total. Dates are labeled by activity_date (snapshot_date - 1 day) —
// see DailySeries/TotalSeries comments for why: the sync cron stamps
// snapshot_date with its own run date, but the value it captures only reflects
// state as of the end of the PREVIOUS day.
// Results are served from statsCache (see cache.go/DailySeries).
func (s *Store) VersionSeries(ctx context.Context, repoID int, from, to string, interval Interval) ([]VersionSeries, error) {
	key := fmt.Sprintf("versions|%d|%s|%s|%s", repoID, from, to, interval)
	return cachedDo(s.statsCache, key, func() ([]VersionSeries, error) {
		return s.versionSeries(ctx, repoID, from, to, interval)
	})
}

func (s *Store) versionSeries(ctx context.Context, repoID int, from, to string, interval Interval) ([]VersionSeries, error) {
	// Deltas are computed per ASSET (the same previous-day self-join as
	// DailySeries — see its comment for why first-seen and gap-reappearing
	// assets are excluded) and only then summed per tag: summing per tag first
	// would let assets newly discovered under an already-existing tag inflate
	// the tag's day delta with their whole historical count — the tag itself
	// has rows on consecutive days, so no tag-level guard can catch it.
	// Cumulative mode is a running total (a stock, not a flow), so it uses the
	// plain per-day tag sums. Both filter on cur.snapshot_date shifted forward
	// one day, keeping the range sargable on idx_repo_date.
	const deltaBase = `
		FROM release_asset_daily_snapshots cur
		JOIN release_asset_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.asset_github_id = cur.asset_github_id
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		WHERE cur.tracked_repo_id = ?
		  AND cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`

	var query string
	switch interval {
	case IntervalCumulative:
		query = `
			SELECT release_tag, MAX(release_name), DATE_FORMAT(DATE_SUB(snapshot_date, INTERVAL 1 DAY), '%Y-%m-%d'),
			       CAST(SUM(download_count) AS SIGNED)
			FROM release_asset_daily_snapshots
			WHERE tracked_repo_id = ?
			  AND snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
			GROUP BY release_tag, snapshot_date
			ORDER BY release_tag, snapshot_date`
	case IntervalMonth:
		query = `
			SELECT cur.release_tag, MAX(cur.release_name),
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m'),
			       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED)` + deltaBase + `
			GROUP BY cur.release_tag, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')
			ORDER BY cur.release_tag, DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m')`
	default: // day
		query = `
			SELECT cur.release_tag, MAX(cur.release_name),
			       DATE_FORMAT(DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY), '%Y-%m-%d'),
			       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED)` + deltaBase + `
			GROUP BY cur.release_tag, cur.snapshot_date
			ORDER BY cur.release_tag, cur.snapshot_date`
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
// real per-asset count can only grow). asset_github_id is the join identity
// — it's the schema's actual per-asset identity (see uk_asset_date).
// SnapshotDate is kept as metadata (the latest activity date the totals cover,
// for staleness awareness), not as the date the totals are "as of" a single day.
// Results are served from statsCache (see cache.go/DailySeries).
func (s *Store) AssetBreakdown(ctx context.Context, repoID int, from, to string, version string) (*AssetBreakdown, error) {
	key := fmt.Sprintf("assets|%d|%s|%s|%s", repoID, from, to, version)
	return cachedDo(s.statsCache, key, func() (*AssetBreakdown, error) {
		return s.assetBreakdown(ctx, repoID, from, to, version)
	})
}

func (s *Store) assetBreakdown(ctx context.Context, repoID int, from, to string, version string) (*AssetBreakdown, error) {
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

	// Same previous-day self-join as DailySeries (see its comment): only
	// consecutive-day pairs contribute, so first-seen and gap-reappearing
	// assets can't leak their historical counts into the range total, and the
	// query stays index-driven (uk_asset_date lookup per row, sargable range).
	query := `
		SELECT cur.release_tag, cur.asset_name, cur.asset_github_id,
		       MAX(cur.content_type), MAX(cur.asset_size),
		       CAST(SUM(GREATEST(cur.download_count - prev.download_count, 0)) AS SIGNED) AS total
		FROM release_asset_daily_snapshots cur
		JOIN release_asset_daily_snapshots prev
		  ON prev.tracked_repo_id = cur.tracked_repo_id
		 AND prev.asset_github_id = cur.asset_github_id
		 AND prev.snapshot_date = DATE_SUB(cur.snapshot_date, INTERVAL 1 DAY)
		WHERE cur.tracked_repo_id = ?
		  AND cur.snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`
	args := []any{repoID, from, to}
	if version != "" {
		query += " AND cur.release_tag = ?"
		args = append(args, version)
	}
	query += `
		GROUP BY cur.release_tag, cur.asset_name, cur.asset_github_id
		ORDER BY total DESC, cur.asset_name`

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
		 WHERE tracked_repo_id = ?
		   AND snapshot_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`,
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
