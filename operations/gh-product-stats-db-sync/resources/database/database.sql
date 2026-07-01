-- Reference schema for the GitHub statistics database. The source of truth is the
-- root-level database.sql; this copy is kept for convenience and is never applied as
-- DDL by the cron itself.

CREATE DATABASE  IF NOT EXISTS `github_statistics`
/*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `github_statistics`;

-- KEEP AS-IS: Contains historical daily delta data from Oct 2024 onwards
-- Used for backward-compatible total download charts
CREATE TABLE `repository_daily_increasing_counts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `repository_id` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `forks_count` int DEFAULT NULL,
  `watchers_count` int DEFAULT NULL,
  `stargazers_count` int DEFAULT NULL,
  `open_issue_count` int DEFAULT NULL,
  `clone_count` int DEFAULT NULL,
  `release_assert_download_count` int DEFAULT NULL,
  `org_id` int DEFAULT NULL,
  `org_name` varchar(25) DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Replaces JSON file for repo configuration
CREATE TABLE IF NOT EXISTS `tracked_repositories` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `org_name`        VARCHAR(100) NOT NULL DEFAULT 'wso2',
    `repo_name`       VARCHAR(200) NOT NULL,
    `product_name`    VARCHAR(200),
    `asset_prefixes`  JSON,
    `is_active`       TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`      DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uk_org_repo` (`org_name`, `repo_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Asset-level daily snapshots (enables version breakdown charts)
CREATE TABLE IF NOT EXISTS `release_asset_daily_snapshots` (
    `id`                BIGINT AUTO_INCREMENT PRIMARY KEY,
    `tracked_repo_id`   INT NOT NULL,
    `release_tag`       VARCHAR(200) NOT NULL,
    `release_name`      VARCHAR(255),
    `asset_name`        VARCHAR(500) NOT NULL,
    `asset_github_id`   INT NOT NULL,
    `content_type`      VARCHAR(100),
    `asset_size`        BIGINT,
    `download_count`    BIGINT NOT NULL,
    `snapshot_date`     DATE NOT NULL,
    `created_at`        DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_asset_snap_repo` FOREIGN KEY (`tracked_repo_id`)
        REFERENCES `tracked_repositories`(`id`) ON UPDATE CASCADE,
    UNIQUE KEY `uk_asset_date` (`tracked_repo_id`, `asset_github_id`, `snapshot_date`),
    INDEX `idx_snapshot_date` (`snapshot_date`),
    INDEX `idx_repo_date` (`tracked_repo_id`, `snapshot_date`),
    INDEX `idx_release_tag` (`release_tag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Repo-level daily snapshots (cumulative totals + clone traffic)
CREATE TABLE IF NOT EXISTS `repository_daily_snapshots` (
    `id`                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    `tracked_repo_id`       INT NOT NULL,
    `total_download_count`  BIGINT NOT NULL DEFAULT 0,
    `forks_count`           INT DEFAULT 0,
    `stargazers_count`      INT DEFAULT 0,
    `watchers_count`        INT DEFAULT 0,
    `open_issues_count`     INT DEFAULT 0,
    `clone_count`           INT DEFAULT 0,
    `clone_uniques`         INT DEFAULT 0,
    `snapshot_date`         DATE NOT NULL,
    `created_at`            DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_repo_snap_repo` FOREIGN KEY (`tracked_repo_id`)
        REFERENCES `tracked_repositories`(`id`) ON UPDATE CASCADE,
    UNIQUE KEY `uk_repo_date` (`tracked_repo_id`, `snapshot_date`),
    INDEX `idx_snapshot_date` (`snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sync job execution log
CREATE TABLE IF NOT EXISTS `sync_job_logs` (
    `id`              BIGINT AUTO_INCREMENT PRIMARY KEY,
    `status`          ENUM('STARTED', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED') NOT NULL,
    `repos_synced`    INT DEFAULT 0,
    `repos_failed`    INT DEFAULT 0,
    `error_message`   TEXT,
    `started_at`      DATETIME NOT NULL,
    `completed_at`    DATETIME,
    `created_at`      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
