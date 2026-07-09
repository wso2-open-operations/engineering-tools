-- ============================================================================
-- PILOT Migration 000003: Migrate legacy data to new schema for a date range
-- Target Range: 2026-07-01 to 2026-07-09 (final catch-up to the present.
-- CAUTION: if the new Ballerina sync cron has already started writing to this
-- database, this upserts over its rows for any overlapping day — values should
-- be near-identical (both snapshot the same GitHub counters), but prefer
-- ending this range the day BEFORE the new cron's first production write.)
-- (Previously run: October 2024 through June 2026 fully migrated.)
-- To reuse: update the range in ALL SIX filters below (Section 2 dedup + outer,
-- Section 3 dedup + outer, both 4c counts) — a partial edit silently migrates
-- nothing while validation still looks plausible.
-- ============================================================================

USE `github_statistics`;

-- ============================================================================
-- SECTION 2: PILOT MIGRATE repository → repository_daily_snapshots
-- ============================================================================

INSERT INTO repository_daily_snapshots
    (tracked_repo_id, total_download_count, forks_count, stargazers_count,
     watchers_count, open_issues_count, clone_count, clone_uniques, snapshot_date)
SELECT
    tr.id                               AS tracked_repo_id,
    r.release_assert_download_count     AS total_download_count,
    r.forks_count,
    r.stargazers_count,
    r.watchers_count,
    r.open_issues_count,
    r.clone_count,
    0                                   AS clone_uniques,
    DATE(r.created_at)                  AS snapshot_date
FROM repository r
INNER JOIN tracked_repositories tr
    ON tr.repo_name = r.name
    AND tr.org_name = r.org_name
INNER JOIN (
    -- Dedup: pick the latest row per (repo name, org, date) FOR THE PILOT DATE
    SELECT name, org_name, DATE(created_at) AS snap_date, MAX(id) AS max_id
    FROM repository
    WHERE DATE(created_at) BETWEEN '2026-07-01' AND '2026-07-09'
    GROUP BY name, org_name, DATE(created_at)
) dedup
    ON dedup.max_id = r.id
WHERE DATE(r.created_at) BETWEEN '2026-07-01' AND '2026-07-09'
ON DUPLICATE KEY UPDATE
    total_download_count = VALUES(total_download_count),
    forks_count          = VALUES(forks_count),
    stargazers_count     = VALUES(stargazers_count),
    watchers_count       = VALUES(watchers_count),
    open_issues_count    = VALUES(open_issues_count),
    clone_count          = VALUES(clone_count),
    clone_uniques        = VALUES(clone_uniques);

-- ============================================================================
-- SECTION 3: PILOT MIGRATE release_asserts → release_asset_daily_snapshots
-- ============================================================================

INSERT INTO release_asset_daily_snapshots
    (tracked_repo_id, release_tag, release_name, asset_name, asset_github_id,
     content_type, asset_size, download_count, snapshot_date)
SELECT
    tr.id                           AS tracked_repo_id,
    rel.tag_name                    AS release_tag,
    rel.release_name                AS release_name,
    ra.asset_name                   AS asset_name,
    ra.asset_id                     AS asset_github_id,
    ra.asset_content_type           AS content_type,
    ra.asset_size                   AS asset_size,
    ra.asset_download_count         AS download_count,
    DATE(ra.created_at)             AS snapshot_date
FROM release_asserts ra
INNER JOIN releases rel
    ON rel.id = ra.release_id
INNER JOIN repository repo
    ON repo.id = rel.repository_id
INNER JOIN tracked_repositories tr
    ON tr.repo_name = repo.name
    AND tr.org_name = repo.org_name
INNER JOIN (
    -- Dedup: pick the latest asset row per (asset_id, date) FOR THE PILOT DATE
    SELECT asset_id, DATE(created_at) AS snap_date, MAX(id) AS max_id
    FROM release_asserts
    WHERE DATE(created_at) BETWEEN '2026-07-01' AND '2026-07-09'
    GROUP BY asset_id, DATE(created_at)
) dedup
    ON dedup.max_id = ra.id
WHERE ra.asset_name IS NOT NULL
  AND rel.tag_name IS NOT NULL
  AND DATE(ra.created_at) BETWEEN '2026-07-01' AND '2026-07-09'
ON DUPLICATE KEY UPDATE
    release_tag    = VALUES(release_tag),
    release_name   = VALUES(release_name),
    asset_name     = VALUES(asset_name),
    content_type   = VALUES(content_type),
    asset_size     = VALUES(asset_size),
    download_count = VALUES(download_count);

-- ============================================================================
-- SECTION 4: POST-PILOT VALIDATION
-- ============================================================================

-- 4a. Overall migrated span for repositories (includes previously migrated
-- days — expect earliest 2024-10-01; latest = wherever production's legacy
-- data actually ends (the filter allows through 2026-07-09, but rows only
-- exist up to the legacy cron's last run);
-- fewer only if the legacy cron skipped days).
SELECT MIN(snapshot_date) AS earliest,
       MAX(snapshot_date) AS latest,
       COUNT(DISTINCT snapshot_date) AS distinct_days
FROM repository_daily_snapshots;

-- 4b. Overall migrated span for assets (same expectation as 4a).
SELECT MIN(snapshot_date) AS earliest,
       MAX(snapshot_date) AS latest,
       COUNT(DISTINCT snapshot_date) AS distinct_days
FROM release_asset_daily_snapshots;

-- 4c. Verify exactly how many rows were inserted for the target range.
SELECT 'repository_daily_snapshots' AS tbl, COUNT(*) AS rows_migrated
FROM repository_daily_snapshots
WHERE snapshot_date BETWEEN '2026-07-01' AND '2026-07-09'
UNION ALL
SELECT 'release_asset_daily_snapshots', COUNT(*)
FROM release_asset_daily_snapshots
WHERE snapshot_date BETWEEN '2026-07-01' AND '2026-07-09';

-- 4d. Per-day repo row counts across the range — a single total can hide a
-- missing/thin day; each day here should show roughly the same repo count.
SELECT snapshot_date, COUNT(*) AS repo_rows
FROM repository_daily_snapshots
WHERE snapshot_date BETWEEN '2026-07-01' AND '2026-07-09'
GROUP BY snapshot_date
ORDER BY snapshot_date;