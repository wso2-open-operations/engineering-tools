-- ============================================================================
-- Migration 000001: Add GitHub Packages snapshot tables
-- ============================================================================
-- Storage for the gh-package-stats-scraper service (operations/
-- gh-package-stats-scraper): daily snapshots of container-package download
-- counts for tracked repositories, scraped from GitHub (no API exposes these
-- counts; see the scraper's README).
--
-- Two-level design, mirroring repository_daily_snapshots /
-- release_asset_daily_snapshots:
--   - package_daily_snapshots: one row per package per day with the EXACT
--     all-time total (scraped from the package page's title attribute). This
--     is the authoritative package-level number — it includes downloads of
--     untagged and aged-out versions, so it must NEVER be derived by summing
--     the version table.
--   - package_version_daily_snapshots: one row per TAGGED version per day,
--     limited to each package's most recent version pages (the scraper's
--     VERSION_PAGES_LIMIT). version_github_id is the stable identity; tags
--     are display labels (they can move between versions, e.g. "latest").
--
-- Reads use the same consecutive-day delta pattern as the dashboard's other
-- stats: a day's downloads = row minus the same identity's row exactly 1 day
-- earlier, so first-seen and gap-reappearing identities contribute nothing.
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS only).
-- ============================================================================

USE `github_statistics`;

CREATE TABLE IF NOT EXISTS `package_daily_snapshots` (
    `id`                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    `tracked_repo_id`      INT NOT NULL,
    `package_name`         VARCHAR(255) NOT NULL,
    `package_github_id`    BIGINT NULL,
    `version_count`        INT NULL,
    `total_download_count` BIGINT NOT NULL,
    `snapshot_date`        DATE NOT NULL,
    `created_at`           DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_pkg_snap_repo` FOREIGN KEY (`tracked_repo_id`)
        REFERENCES `tracked_repositories`(`id`) ON UPDATE CASCADE,
    UNIQUE KEY `uk_pkg_date` (`tracked_repo_id`, `package_name`, `snapshot_date`),
    INDEX `idx_pkg_repo_date` (`tracked_repo_id`, `snapshot_date`),
    INDEX `idx_pkg_snapshot_date` (`snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `package_version_daily_snapshots` (
    `id`                BIGINT AUTO_INCREMENT PRIMARY KEY,
    `tracked_repo_id`   INT NOT NULL,
    `package_name`      VARCHAR(255) NOT NULL,
    `version_github_id` BIGINT NOT NULL,
    `tags`              VARCHAR(1000) NULL,
    `download_count`    BIGINT NOT NULL,
    `snapshot_date`     DATE NOT NULL,
    `created_at`        DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_pkgver_snap_repo` FOREIGN KEY (`tracked_repo_id`)
        REFERENCES `tracked_repositories`(`id`) ON UPDATE CASCADE,
    UNIQUE KEY `uk_pkgver_date` (`tracked_repo_id`, `package_name`, `version_github_id`, `snapshot_date`),
    INDEX `idx_pkgver_repo_pkg_date` (`tracked_repo_id`, `package_name`, `snapshot_date`),
    INDEX `idx_pkgver_snapshot_date` (`snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Separate log table (not sync_job_logs) so the scraper's health is visible
-- independently of the main Ballerina sync's.
CREATE TABLE IF NOT EXISTS `package_scrape_job_logs` (
    `id`            BIGINT AUTO_INCREMENT PRIMARY KEY,
    `status`        ENUM('STARTED', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED') NOT NULL,
    `repos_synced`  INT DEFAULT 0,
    `repos_failed`  INT DEFAULT 0,
    `error_message` TEXT,
    `started_at`    DATETIME NOT NULL,
    `completed_at`  DATETIME,
    `created_at`    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
