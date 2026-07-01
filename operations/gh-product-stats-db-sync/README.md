# GitHub Product Stats to DB Sync

A one-shot Ballerina scheduled task, run under `operations/` in this repo, that captures
a daily snapshot of GitHub product statistics into the `github_statistics` database. The
schedule is supplied externally by the Choreo Scheduled Task; the program runs once per
invocation via `public function main()`.

For each active repository in `tracked_repositories`, the sync writes:

- **Repo-level snapshot** (`repository_daily_snapshots`) — total filtered download
  count, forks/stargazers/watchers/open-issues counts, and today's clone count/uniques.
- **Asset-level snapshot** (`release_asset_daily_snapshots`) — one row per release asset
  whose name matches the repo's configured `asset_prefixes`, enabling per-version
  download breakdowns.
- **Job outcome** (`sync_job_logs`) — status (`SUCCESS`/`PARTIAL_FAILURE`/`FAILED`),
  repos synced/failed, and any per-repo error messages.

Repo-stats and release-asset fetches are hard dependencies (a failure fails that repo's
sync); clone-traffic requires `Administration:read` and is treated as a soft dependency,
falling back to 0 when unavailable. All GitHub data is read through the Engineering
Entity REST service — the cron makes zero direct GitHub API calls.

## Project structure

| Path                              | Description                                                            |
| --------------------------------- | ---------------------------------------------------------------------- |
| `main.bal`                        | Entry point and sync orchestration (`run`, `syncRepository`, helpers). |
| `modules/database`                | Database client, query builders, functions, and types.                 |
| `modules/entity`                  | Engineering Entity REST client and the GitHub stats fetch functions.   |
| `resources/database/database.sql` | Reference schema (source of truth lives in the root `database.sql`).   |

## Configuration

Copy `Config.toml.local` to `Config.toml` and fill in the values.

- `gh_product_stats_db_sync.database` — MySQL connection, pool, and timeout.
- `gh_product_stats_db_sync.entity` — Engineering Entity base URL, OAuth2 client
  credentials (Choreo Connection), and HTTP retry settings.

## Build and run

```bash
bal build
bal run
```

> **Note:** This package builds on Ballerina distribution `2201.13.4`. Run
> `bal dist use 2201.13.4` before building if a different distribution is active.
