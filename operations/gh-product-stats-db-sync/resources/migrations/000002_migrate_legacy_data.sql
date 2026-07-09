-- ============================================================================
-- Migration 000002: Migrate legacy data to new schema
-- ============================================================================
-- Migrates historical data from the old tables (repository, releases,
-- release_asserts) into the new snapshot tables (repository_daily_snapshots,
-- release_asset_daily_snapshots).
--
-- Prerequisites:
--   1. New schema tables created (table_update_v1.0.1.sql)
--   2. tracked_repositories seeded (000001_seed_tracked_repositories.sql)
--
-- Notes:
--   - tracked_repositories is NOT modified.
--   - repository_daily_increasing_counts is NOT migrated (deltas are derivable).
--   - sync_job_logs starts fresh (no legacy equivalent).
--   - clone_uniques is set to 0 (old schema did not track it).
--   - Idempotent: safe to re-run thanks to ON DUPLICATE KEY UPDATE.
-- ============================================================================

USE `github_statistics`;

-- ============================================================================
-- SECTION 1: PRE-MIGRATION DIAGNOSTICS
-- Run these SELECT queries first to understand the legacy data before migrating.
-- ============================================================================

-- 1a. Which old repos will / won't match tracked_repositories?
--     Rows with NULL tracked_repo_id will be SKIPPED during migration.
SELECT DISTINCT r.name, r.org_name,
       tr.id AS tracked_repo_id,
       CASE WHEN tr.id IS NULL THEN '** SKIPPED **' ELSE 'OK' END AS status
FROM repository r
LEFT JOIN tracked_repositories tr
    ON tr.repo_name = r.name AND tr.org_name = r.org_name
ORDER BY tr.id IS NULL DESC, r.name;

-- 1b. Row counts in each legacy table.
SELECT 'repository' AS tbl, COUNT(*) AS cnt FROM repository
UNION ALL
SELECT 'releases', COUNT(*) FROM releases
UNION ALL
SELECT 'release_asserts', COUNT(*) FROM release_asserts
UNION ALL
SELECT 'repository_daily_increasing_counts', COUNT(*) FROM repository_daily_increasing_counts;

-- 1c. Date range of legacy repository snapshots.
SELECT MIN(DATE(created_at)) AS earliest,
       MAX(DATE(created_at)) AS latest,
       COUNT(DISTINCT DATE(created_at)) AS distinct_days
FROM repository;

-- 1d. NULL tag_names that will be dropped from asset migration.
SELECT COUNT(*) AS null_tag_releases FROM releases WHERE tag_name IS NULL;

-- 1e. Duplicate (asset_id, date) pairs — verifies dedup logic is needed.
SELECT asset_id, DATE(created_at) AS snap_date, COUNT(*) AS cnt
FROM release_asserts
GROUP BY asset_id, DATE(created_at)
HAVING cnt > 1
LIMIT 20;

-- ============================================================================
-- SECTION 2: MIGRATE repository → repository_daily_snapshots
-- ============================================================================
-- The old cron inserted one row per repo per day. If the cron ran more than
-- once on the same day, there may be duplicate (repo, date) pairs. The dedup
-- subquery picks the row with the highest id (latest insert) for each pair.
-- clone_uniques is set to 0 because the old schema did not capture it.
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
    -- Dedup: pick the latest row per (repo name, org, date)
    SELECT name, org_name, DATE(created_at) AS snap_date, MAX(id) AS max_id
    FROM repository
    GROUP BY name, org_name, DATE(created_at)
) dedup
    ON dedup.max_id = r.id
ON DUPLICATE KEY UPDATE
    total_download_count = VALUES(total_download_count),
    forks_count          = VALUES(forks_count),
    stargazers_count     = VALUES(stargazers_count),
    watchers_count       = VALUES(watchers_count),
    open_issues_count    = VALUES(open_issues_count),
    clone_count          = VALUES(clone_count),
    clone_uniques        = VALUES(clone_uniques);

-- ============================================================================
-- SECTION 3: MIGRATE release_asserts → release_asset_daily_snapshots
-- ============================================================================
-- Joins release_asserts → releases → repository → tracked_repositories to
-- resolve the tracked_repo_id foreign key. Deduplicates by picking the latest
-- release_asserts row per (asset_id, date). Rows with NULL tag_name or
-- NULL asset_name are excluded (the new schema requires NOT NULL for both).
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
    -- Dedup: pick the latest asset row per (asset_id, date)
    SELECT asset_id, DATE(created_at) AS snap_date, MAX(id) AS max_id
    FROM release_asserts
    GROUP BY asset_id, DATE(created_at)
) dedup
    ON dedup.max_id = ra.id
WHERE ra.asset_name IS NOT NULL
  AND rel.tag_name IS NOT NULL
ON DUPLICATE KEY UPDATE
    release_tag    = VALUES(release_tag),
    release_name   = VALUES(release_name),
    asset_name     = VALUES(asset_name),
    content_type   = VALUES(content_type),
    asset_size     = VALUES(asset_size),
    download_count = VALUES(download_count);

-- ============================================================================
-- SECTION 4: POST-MIGRATION VALIDATION
-- Run these queries after migration to verify correctness.
-- ============================================================================

-- 4a. Row counts in the new tables.
SELECT 'repository_daily_snapshots' AS tbl, COUNT(*) AS cnt
FROM repository_daily_snapshots
UNION ALL
SELECT 'release_asset_daily_snapshots', COUNT(*)
FROM release_asset_daily_snapshots;

-- 4b. Date range preserved in repository snapshots.
SELECT MIN(snapshot_date) AS earliest,
       MAX(snapshot_date) AS latest,
       COUNT(DISTINCT snapshot_date) AS distinct_days
FROM repository_daily_snapshots;

-- 4c. Date range preserved in asset snapshots.
SELECT MIN(snapshot_date) AS earliest,
       MAX(snapshot_date) AS latest,
       COUNT(DISTINCT snapshot_date) AS distinct_days
FROM release_asset_daily_snapshots;

-- 4d. Per-repo row count — should roughly equal (distinct_days × matched_repos).
SELECT tr.repo_name, COUNT(*) AS snapshot_rows
FROM repository_daily_snapshots rds
INNER JOIN tracked_repositories tr ON tr.id = rds.tracked_repo_id
GROUP BY tr.repo_name
ORDER BY tr.repo_name;

-- 4e. Spot-check: compare download totals for product-apim (old vs new).
SELECT rds.snapshot_date,
       rds.total_download_count AS new_total,
       r.release_assert_download_count AS old_total,
       (rds.total_download_count - r.release_assert_download_count) AS diff
FROM repository_daily_snapshots rds
INNER JOIN tracked_repositories tr ON tr.id = rds.tracked_repo_id
INNER JOIN (
    SELECT name, org_name, DATE(created_at) AS snap_date, MAX(id) AS max_id
    FROM repository
    GROUP BY name, org_name, DATE(created_at)
) dedup ON dedup.name = tr.repo_name AND dedup.org_name = tr.org_name AND dedup.snap_date = rds.snapshot_date
INNER JOIN repository r ON r.id = dedup.max_id
WHERE tr.repo_name = 'product-apim'
ORDER BY rds.snapshot_date
LIMIT 20;
