# GitHub Package Stats Scraper

One-shot daily job (Choreo Scheduled Task) that records download counts for
the **GitHub container packages** of tracked repositories, feeding the
Packages tab of the GitHub Product Download Stats Dashboard.

## Why scraping

GitHub exposes **no API for container-package download counts** — not REST,
not GraphQL, not the registry protocol. The counts exist only on github.com's
package pages. This service therefore splits its sources:

| Data                                                 | Source                                                                                        | Auth                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Which packages exist, and which repo each belongs to | GitHub REST API (`GET /orgs/{org}/packages?package_type=container`)                           | classic PAT, `read:packages` (fine-grained PATs are rejected by these endpoints) |
| Package's exact all-time download total              | Package page HTML — the rounded "51.1K" text carries the exact value in its `title` attribute | none (public pages)                                                              |
| Per-version download counts, version IDs, tags       | Versions page HTML (tagged filter), first `VERSION_PAGES_LIMIT` pages                         | none                                                                             |

The scraped pages are an **unstable contract**: GitHub can change markup any
time. Parsers are built to fail loudly (a page that parses to nothing is an
error, never a silent zero), failures are soft (one broken package never
aborts the run), and golden-fixture tests in `internal/github/testdata/`
pin the expected markup — refresh them when GitHub changes (commands in
`scrape_test.go`).

## Which repos are covered

Package scraping is **opt-in per repository**: the scraper reads
`tracked_repositories` (the shared source of truth) and covers only rows with
`is_active = 1 AND track_packages = 1` (flag added by migration
`migrations/000002_add_track_packages_flag.sql`).
Most tracked repos publish no GitHub packages — or publish elsewhere, e.g.
DockerHub — so they stay opted out. Enable/disable a repo with:

```sql
UPDATE tracked_repositories SET track_packages = 1  -- or 0
WHERE org_name = '<org>' AND repo_name = '<repo>';
```

## What gets written

Tables from migration `migrations/000001_add_package_snapshot_tables.sql`:

- `package_daily_snapshots` — one row per package per day with the **exact**
  total. This is the authoritative package number; it must never be derived
  by summing version rows (untagged and aged-out versions are inside it).
- `package_version_daily_snapshots` — one row per **tagged** version per day,
  windowed to the newest `VERSION_PAGES_LIMIT` pages (~50 rows/page).
  `version_github_id` is the identity; tags are display labels.
- `package_scrape_job_logs` — per-run outcome, separate from the main sync's
  `sync_job_logs`.

Same-day reruns are safe everywhere (`ON DUPLICATE KEY UPDATE`).

Downstream reads use the dashboard backend's consecutive-day delta pattern,
so a version's first-ever row (or a reappearance after a gap) contributes
nothing to any single day — historical counts can't masquerade as one day's
activity.

## Configuration (environment)

| Variable                                                  | Purpose                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL (`github_statistics`)                                           |
| `DB_TLS_ENABLED`                                          | `true` (default) for stage/prod; `false` for local                    |
| `GITHUB_PAT`                                              | classic PAT, `read:packages` only, SSO-authorized for each org        |
| `VERSION_PAGES_LIMIT`                                     | versions pages per package (default `3` ≈ 150 newest tagged versions) |

## Build, test, run

```bash
go build ./...
go test ./...                  # HTML parsers (golden fixtures) + API client (mock server)
RUN_LIVE=1 go test ./internal/github/ -run TestLiveScrape -v   # today's real markup
RUN_DB=1 DB_HOST=... go test ./internal/store/ -run TestIntegrationRoundTrip -v
go run ./cmd/scraper           # one full run (needs DB_* and GITHUB_PAT)
```

The API-client tests need **no real PAT**: they run against an in-process mock
of GitHub's packages endpoint (`api_test.go`) using a sample token and the
sample JSON responses in `testdata/org_packages_page*.json`, which mirror
GitHub's documented response shape (including a slashed package name and a
repo-unlinked package). Only `RUN_LIVE`/`RUN_DB` tests and real runs need
credentials.

## Deployment

Choreo Scheduled Task, daily at `30 1 * * *` UTC — after the main sync;
unlike it, this job has no midnight-semantics constraint, only "once a day,
consistently". Total nightly volume is ~150–200 page fetches, each preceded
by a randomized wait in [1.0s, 1.6s) (`internal/github/scrape.go`) — a
perfectly uniform interval is itself a signal bot/abuse detection can key
off, so the spacing is deliberately irregular on top of just being polite
about volume.
