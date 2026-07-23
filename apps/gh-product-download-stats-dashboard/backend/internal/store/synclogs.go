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

// ListSyncLogs returns job log rows from both the Ballerina daily sync
// (sync_job_logs) and the package stats scraper (package_scrape_job_logs —
// gh-package-stats-scraper, written to this same database), merged into one
// chronological history and distinguished by Source. Most recent first.
func (s *Store) ListSyncLogs(ctx context.Context, limit, offset int) ([]SyncJobLog, error) {
	const query = `
		SELECT id, source, status, repos_synced, repos_failed, error_message, started_at, completed_at, created_at
		FROM (
			SELECT id, ? AS source, status, repos_synced, repos_failed, error_message, started_at, completed_at, created_at
			FROM sync_job_logs
			UNION ALL
			SELECT id, ? AS source, status, repos_synced, repos_failed, error_message, started_at, completed_at, created_at
			FROM package_scrape_job_logs
		) combined

		ORDER BY started_at DESC, id DESC, source ASC
		LIMIT ? OFFSET ?`
	rows, err := s.db.QueryContext(ctx, query, JobLogSourceDBSync, JobLogSourcePackageScrape, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("store: list sync logs: %w", err)
	}
	defer rows.Close()

	result := []SyncJobLog{}
	for rows.Next() {
		var (
			log         SyncJobLog
			errMsg      sql.NullString
			startedAt   time.Time
			completedAt sql.NullTime
			createdAt   time.Time
		)
		if err := rows.Scan(&log.ID, &log.Source, &log.Status, &log.ReposSynced, &log.ReposFailed,
			&errMsg, &startedAt, &completedAt, &createdAt); err != nil {
			return nil, fmt.Errorf("store: scan sync log: %w", err)
		}
		if errMsg.Valid {
			log.ErrorMessage = &errMsg.String
		}
		log.StartedAt = formatDateTime(startedAt)
		if completedAt.Valid {
			c := formatDateTime(completedAt.Time)
			log.CompletedAt = &c
		}
		log.CreatedAt = formatDateTime(createdAt)
		result = append(result, log)
	}
	return result, rows.Err()
}
