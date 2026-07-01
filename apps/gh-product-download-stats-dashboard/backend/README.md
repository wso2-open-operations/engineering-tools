# GitHub Product Download Stats Dashboard Backend

Go backend service for the GitHub Product Download Stats Dashboard. It reads the
pre-aggregated daily snapshots written by the Ballerina sync cron into the
`github_statistics` MySQL database and serves them to the React dashboard.

## Quick Start

```bash
# from apps/gh-product-download-stats-dashboard/backend
cp .env.example .env   # fill in DB + auth values
go run ./cmd/server/main.go
```

The server automatically loads `.env` from the working directory on startup
(silently ignored if absent). Backend starts at `http://localhost:8080`.

## Overview

- Default port: `:8080`
- Runtime: Go `1.26+`
- Entry point: `cmd/server/main.go`
- Data source: MySQL (`github_statistics`) — read-only
- Authentication:
  - Incoming requests: JWT validated by the Choreo gateway + JWKS; passed as the
    `x-jwt-assertion` header (set `AUTH_TOKEN_VALIDATOR_ENABLED=false` locally to
    decode without signature verification)
  - Admin endpoints additionally require the caller's JWT `groups` to intersect
    `ADMIN_GROUPS`

## Configuration

| Variable                       | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| `DB_HOST`                      | MySQL host                                                  |
| `DB_PORT`                      | MySQL port (default `3306`)                                 |
| `DB_USER`                      | MySQL user                                                  |
| `DB_PASSWORD`                  | MySQL password                                              |
| `DB_NAME`                      | Database name (`github_statistics`)                         |
| `DB_MAX_OPEN_CONNS`            | Max open pool connections (default `10`)                    |
| `DB_MAX_IDLE_CONNS`            | Max idle pool connections (default `5`)                     |
| `DB_CONN_MAX_LIFETIME_SECONDS` | Max connection lifetime (default `180`)                     |
| `AUTH_JWKS_ENDPOINT`           | JWKS endpoint for JWT signature verification                |
| `AUTH_ISSUER`                  | Expected JWT issuer                                         |
| `AUTH_AUDIENCE`                | Expected JWT audience                                       |
| `AUTH_TOKEN_VALIDATOR_ENABLED` | `false` to skip signature verification (local only)         |
| `ADMIN_GROUPS`                 | Comma-separated group names allowed to call admin endpoints |
| `PORT`                         | Server listen address (default `:8080`)                     |

## Project Structure

```text
backend/
├── cmd/server/main.go            # Entry point — config, routes, server startup
├── internal/
│   ├── apierror/                 # Typed store error (not-found / status mapping)
│   ├── store/
│   │   ├── client.go             # MySQL connection pool + config
│   │   ├── types.go              # Response/DB row structs (camelCase JSON)
│   │   ├── repositories.go       # tracked_repositories read + admin CRUD
│   │   ├── stats.go              # Aggregation queries (summary/total/daily/clones/...)
│   │   ├── synclogs.go           # sync_job_logs read
│   │   └── helpers.go            # asset_prefixes + IN-clause helpers
│   ├── middleware/
│   │   ├── auth.go               # JWT validation; injects UserInfo; admin-group check
│   │   ├── correlation.go        # Correlation-ID propagation + slog enrichment
│   │   ├── logger.go             # Per-request access log
│   │   └── security_headers.go   # X-Content-Type-Options, CSP, HSTS on every response
│   └── handler/
│       ├── response.go           # writeJSON/writeError, query-param parsing, error map
│       ├── repositories.go       # GET /api/v1/repositories
│       ├── stats.go              # GET /api/v1/stats/*
│       └── admin.go              # admin repository CRUD + sync logs
├── openapi.yaml                  # API contract (kept in sync with handlers)
├── .env.example
└── go.mod
```

## Middleware chain

`SecurityHeaders → CorrelationID → Auth → Logger → Mux`

`middleware.ConfigureLogger()` is called at startup so every
`slog.*Context(r.Context(), …)` call automatically includes `correlationID` and
`userID` when present.

## API Endpoints

### Health (anonymous)

| Method | Endpoint  | Description    |
| ------ | --------- | -------------- |
| `GET`  | `/health` | Liveness probe |

### Public (JWT required)

| Method | Endpoint                                           | Description                                |
| ------ | -------------------------------------------------- | ------------------------------------------ |
| `GET`  | `/api/v1/repositories`                             | List tracked repos with their latest stats |
| `GET`  | `/api/v1/stats/summary`                            | Dashboard KPIs                             |
| `GET`  | `/api/v1/stats/total?from=&to=&repos=`             | Cumulative downloads per repo              |
| `GET`  | `/api/v1/stats/daily?from=&to=&repos=&interval=`   | Daily download deltas per repo             |
| `GET`  | `/api/v1/stats/metric?metric=&from=&to=&repos=&interval=` | Time series for one GitHub stat (stars/forks/watchers/openIssues) |
| `GET`  | `/api/v1/stats/clones?from=&to=&repos=`            | Clone traffic history per repo             |
| `GET`  | `/api/v1/stats/versions/{repoId}?from=&to=`        | Download breakdown by version              |
| `GET`  | `/api/v1/stats/versions/{repoId}/series?from=&to=&interval=` | Per-version download time series    |
| `GET`  | `/api/v1/stats/assets/{repoId}?from=&to=&version=` | Download breakdown by asset                |
| `GET`  | `/api/v1/stats/compare?repos=&from=&to=`           | Side-by-side comparison                    |

`from`/`to` default to the last 30 days; `repos` is an optional comma-separated
list of tracked-repository ids. `interval` on `total`, `daily`, and `metric` is
`day` (default) or `month` — use `daily?interval=month` for monthly downloads.
`interval` on `versions/{repoId}/series` additionally accepts `cumulative` for
the running per-version total.

### Admin (JWT + admin group)

| Method   | Endpoint                          | Description             |
| -------- | --------------------------------- | ----------------------- |
| `GET`    | `/api/v1/admin/repositories`      | List all repos (incl. inactive) |
| `POST`   | `/api/v1/admin/repositories`      | Add a new repo to track |
| `PATCH`  | `/api/v1/admin/repositories/{id}` | Update repo config      |
| `DELETE` | `/api/v1/admin/repositories/{id}` | Deactivate a repo       |
| `GET`    | `/api/v1/admin/sync/logs`         | View sync job history   |

> Manual sync triggering is intentionally not exposed here — the cron runs as a
> Choreo Scheduled Task and has no in-process trigger.

#### Request payloads

**`POST /api/v1/admin/repositories`** — create a tracked repository.

| Field | Type | Required | Description |
|---|---|---|---|
| `orgName` | string | **yes** | GitHub org (also used as the `owner` path segment) |
| `repoName` | string | **yes** | Repository name |
| `productName` | string \| null | no | Display/product name |
| `assetPrefixes` | string[] | no | Release-asset name prefixes to track (empty/omitted ⇒ all assets) |
| `isActive` | boolean | no | Whether the cron should sync it (default `true`) |

```json
{
  "orgName": "wso2",
  "repoName": "product-apim",
  "productName": "WSO2 API Manager",
  "assetPrefixes": ["wso2am-"],
  "isActive": true
}
```

Response `201`: `{ "id": 42 }`

**`PATCH /api/v1/admin/repositories/{id}`** — partial update; send only the fields
you want to change (omitted fields are left unchanged).

| Field | Type | Description |
|---|---|---|
| `productName` | string \| null | New product name |
| `assetPrefixes` | string[] | Replace the tracked asset prefixes |
| `isActive` | boolean | Activate / deactivate syncing |

```json
{
  "isActive": false,
  "assetPrefixes": ["wso2am-", "wso2am-analytics-"]
}
```

Response `204 No Content`. Returns `404` if no repository has that id.

## Testing

Tests are pure unit tests (mock store) — no running database needed.

```bash
go test ./...
go test -race ./...
make test    # vet + race tests
make build   # vet + tests + compile
```

## Run Locally

```bash
# from apps/gh-product-download-stats-dashboard/backend
go run ./cmd/server/main.go
```

```bash
JWT="<your-jwt-token>"

# Dashboard summary
curl -H "x-jwt-assertion: $JWT" http://localhost:8080/api/v1/stats/summary

# Total downloads for two repos over a date range
curl -H "x-jwt-assertion: $JWT" \
  "http://localhost:8080/api/v1/stats/total?from=2026-06-01&to=2026-06-25&repos=1,2"

# Add a tracked repository (admin)
curl -X POST -H "x-jwt-assertion: $JWT" -H "Content-Type: application/json" \
  -d '{"orgName":"wso2","repoName":"product-apim","assetPrefixes":["wso2am-"]}' \
  http://localhost:8080/api/v1/admin/repositories

# Update a tracked repository (admin) — partial; only the given fields change
curl -X PATCH -H "x-jwt-assertion: $JWT" -H "Content-Type: application/json" \
  -d '{"isActive":false}' \
  http://localhost:8080/api/v1/admin/repositories/42
```
