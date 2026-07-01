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

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/apierror"
)

// ListRepositoriesWithStats returns all active tracked repositories joined with
// their most recent daily snapshot (nil when a repo has no snapshot yet).
func (s *Store) ListRepositoriesWithStats(ctx context.Context) ([]RepositoryWithStats, error) {
	return s.repositoriesWithStats(ctx, true)
}

// ListAllRepositoriesWithStats returns every tracked repository (active and
// inactive) joined with its most recent snapshot. Used by the admin panel so
// deactivated repos can be reviewed and re-activated.
func (s *Store) ListAllRepositoriesWithStats(ctx context.Context) ([]RepositoryWithStats, error) {
	return s.repositoriesWithStats(ctx, false)
}

// repositoriesWithStats is the shared query for the repository-with-latest-snapshot
// listing. When activeOnly is true it filters to is_active = 1.
func (s *Store) repositoriesWithStats(ctx context.Context, activeOnly bool) ([]RepositoryWithStats, error) {
	query := `
		SELECT t.id, t.org_name, t.repo_name, t.product_name, t.asset_prefixes,
		       t.is_active, t.created_at, t.updated_at,
		       s.snapshot_date, s.total_download_count, s.forks_count, s.stargazers_count,
		       s.watchers_count, s.open_issues_count, s.clone_count, s.clone_uniques
		FROM tracked_repositories t
		LEFT JOIN repository_daily_snapshots s ON s.id = (
			SELECT s2.id FROM repository_daily_snapshots s2
			WHERE s2.tracked_repo_id = t.id
			ORDER BY s2.snapshot_date DESC, s2.id DESC
			LIMIT 1
		)`
	if activeOnly {
		query += " WHERE t.is_active = 1"
	}
	query += " ORDER BY t.is_active DESC, t.repo_name"

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("store: list repositories: %w", err)
	}
	defer rows.Close()

	result := []RepositoryWithStats{}
	for rows.Next() {
		var (
			r            Repository
			productName  sql.NullString
			prefixes     []byte
			createdAt    time.Time
			updatedAt    time.Time
			snapDate     sql.NullTime
			totalDl      sql.NullInt64
			forks        sql.NullInt64
			stars        sql.NullInt64
			watchers     sql.NullInt64
			openIssues   sql.NullInt64
			cloneCount   sql.NullInt64
			cloneUniques sql.NullInt64
		)
		if err := rows.Scan(
			&r.ID, &r.OrgName, &r.RepoName, &productName, &prefixes,
			&r.IsActive, &createdAt, &updatedAt,
			&snapDate, &totalDl, &forks, &stars, &watchers, &openIssues, &cloneCount, &cloneUniques,
		); err != nil {
			return nil, fmt.Errorf("store: scan repository: %w", err)
		}

		if productName.Valid {
			r.ProductName = &productName.String
		}
		r.AssetPrefixes = parseAssetPrefixes(prefixes)
		r.CreatedAt = formatDateTime(createdAt)
		r.UpdatedAt = formatDateTime(updatedAt)

		item := RepositoryWithStats{Repository: r}
		if snapDate.Valid {
			item.LatestSnapshot = &RepoSnapshot{
				SnapshotDate:       formatDate(snapDate.Time),
				TotalDownloadCount: totalDl.Int64,
				ForksCount:         int(forks.Int64),
				StargazersCount:    int(stars.Int64),
				WatchersCount:      int(watchers.Int64),
				OpenIssuesCount:    int(openIssues.Int64),
				CloneCount:         int(cloneCount.Int64),
				CloneUniques:       int(cloneUniques.Int64),
			}
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// CreateRepository inserts a new tracked repository and returns its generated id.
func (s *Store) CreateRepository(ctx context.Context, in NewRepository) (int, error) {
	prefixes, err := encodeAssetPrefixes(in.AssetPrefixes)
	if err != nil {
		return 0, fmt.Errorf("store: encode asset prefixes: %w", err)
	}
	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}

	const query = `
		INSERT INTO tracked_repositories (org_name, repo_name, product_name, asset_prefixes, is_active)
		VALUES (?, ?, ?, ?, ?)`
	res, err := s.db.ExecContext(ctx, query, in.OrgName, in.RepoName, in.ProductName, prefixes, isActive)
	if err != nil {
		return 0, fmt.Errorf("store: create repository: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("store: create repository last insert id: %w", err)
	}
	return int(id), nil
}

// UpdateRepository updates the mutable fields of a tracked repository. Nil fields
// in the update are left unchanged. Returns apierror.ErrNotFound when no row matches.
func (s *Store) UpdateRepository(ctx context.Context, id int, upd RepositoryUpdate) error {
	setClauses := []string{}
	args := []any{}

	if upd.ProductName != nil {
		setClauses = append(setClauses, "product_name = ?")
		args = append(args, *upd.ProductName)
	}
	if upd.AssetPrefixes != nil {
		prefixes, err := encodeAssetPrefixes(*upd.AssetPrefixes)
		if err != nil {
			return fmt.Errorf("store: encode asset prefixes: %w", err)
		}
		setClauses = append(setClauses, "asset_prefixes = ?")
		args = append(args, prefixes)
	}
	if upd.IsActive != nil {
		setClauses = append(setClauses, "is_active = ?")
		args = append(args, *upd.IsActive)
	}

	if len(setClauses) == 0 {
		return &apierror.Error{StatusCode: 400, Message: "no fields to update"}
	}

	query := "UPDATE tracked_repositories SET " + joinComma(setClauses) + " WHERE id = ?"
	args = append(args, id)

	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("store: update repository: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: update repository rows affected: %w", err)
	}
	if affected == 0 {
		return apierror.ErrNotFound
	}
	return nil
}

// DeactivateRepository sets is_active = 0 for the given repository.
// Returns apierror.ErrNotFound when no row matches.
func (s *Store) DeactivateRepository(ctx context.Context, id int) error {
	const query = `UPDATE tracked_repositories SET is_active = 0 WHERE id = ?`
	res, err := s.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("store: deactivate repository: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: deactivate repository rows affected: %w", err)
	}
	if affected == 0 {
		return apierror.ErrNotFound
	}
	return nil
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
