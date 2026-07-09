# GitHub Product Download Stats Dashboard Backend — API Reference

REST API for the GitHub Product Download Stats Dashboard. The backend reads pre-aggregated
daily snapshots from the `github_statistics` MySQL database and serves them to the
React dashboard.

- **Base URL (local):** `http://localhost:8080`
- **Base URL (deployed):** the Choreo-exposed gateway URL for the `gh-product-download-stats-dashboard-api` component
- **Content type:** `application/json` for all request and response bodies
- **API version:** all application endpoints are under `/api/v1`

---

## Authentication & roles

Every endpoint except `GET /health` requires a valid JWT supplied in the
`x-jwt-assertion` header (injected by the Choreo gateway in production; supplied
manually in local development). See [`../../../auth.md`](../../../auth.md) for the
full auth flow.

| Role | How it's determined | Can call |
|------|---------------------|----------|
| **Anonymous** | no/invalid token | `GET /health` only |
| **Authenticated user** | valid JWT with `email` + `userid` claims | all `GET /api/v1/repositories` and `GET /api/v1/stats/*` endpoints |
| **Admin** | authenticated **and** JWT `groups` intersect the `ADMIN_GROUPS` env list | everything above **plus** all `/api/v1/admin/*` endpoints |

Required JWT claims: `email` (string), `userid` (string), `groups` (string array).

---

## Conventions

- **Dates** (`snapshotDate`, `from`, `to`, series `date`) are `YYYY-MM-DD`.
- **Timestamps** (`createdAt`, `updatedAt`, `startedAt`, `completedAt`, `lastSyncDate`) are RFC 3339, e.g. `2026-06-25T03:14:00Z`.
- **Nullable fields** are emitted as JSON `null` (e.g. `productName`, `latestSnapshot`, `releaseName`, `contentType`, `assetSize`, `errorMessage`, `completedAt`).
- **Money/large counters** (`totalDownloadCount`, `downloadCount`, `value`, `id` of snapshots/logs) are 64-bit integers.
- Every response echoes an `X-GH-Stats-Correlation-ID` header; pass your own to correlate logs.

### Date range defaults

The stats endpoints accept optional `from` and `to` query parameters. When omitted:
`to` defaults to **today (UTC)** and `from` defaults to **30 days before today**.

### Error response shape

All errors share one shape:

```json
{ "message": "Human-readable summary." }
```

| Status | Meaning | When |
|--------|---------|------|
| `400 Bad Request` | invalid input | bad date format, bad `repos`/`repoId`, malformed body, missing required field |
| `401 Unauthorized` | not authenticated | missing/invalid `x-jwt-assertion`, or missing `email`/`userid` claim |
| `403 Forbidden` | not authorized | admin endpoint called by a non-admin user |
| `404 Not Found` | resource missing | PATCH/DELETE a repository id that does not exist |
| `413 Payload Too Large` | body over 1 MiB | admin create/update with an oversized body |
| `500 Internal Server Error` | server/DB failure | unexpected error (details never leaked) |

---

## Endpoint index

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/health` | Anonymous | Liveness probe |
| `GET` | `/api/v1/repositories` | User | List tracked repos with latest stats |
| `GET` | `/api/v1/stats/summary` | User | Dashboard KPIs |
| `GET` | `/api/v1/stats/total` | User | Cumulative downloads per repo over time |
| `GET` | `/api/v1/stats/daily` | User | Daily download deltas per repo |
| `GET` | `/api/v1/stats/metric` | User | Time series for one GitHub stat (stars/forks/watchers/openIssues) |
| `GET` | `/api/v1/stats/clones` | User | Clone traffic history per repo |
| `GET` | `/api/v1/stats/versions/{repoId}` | User | Download breakdown by release version |
| `GET` | `/api/v1/stats/versions/{repoId}/series` | User | Per-version download time series |
| `GET` | `/api/v1/stats/assets/{repoId}` | User | Download breakdown by release asset |
| `GET` | `/api/v1/stats/compare` | User | Side-by-side repo comparison |
| `GET` | `/api/v1/admin/repositories` | Admin | List all tracked repos (incl. inactive) |
| `POST` | `/api/v1/admin/repositories` | Admin | Add a tracked repository |
| `PATCH` | `/api/v1/admin/repositories/{id}` | Admin | Update a tracked repository (partial) |
| `DELETE` | `/api/v1/admin/repositories/{id}` | Admin | Deactivate a tracked repository |
| `GET` | `/api/v1/admin/sync/logs` | Admin | View sync job history |

---

## Health

### `GET /health`

Liveness probe. No authentication.

- **Response:** `200 OK`, empty body.

---

## Repositories

### `GET /api/v1/repositories`

List all **active** tracked repositories, each joined with its most recent daily
snapshot (`latestSnapshot` is `null` when a repo has never been synced).

- **Role:** User
- **Query params:** none

**Response `200`:**

```json
{
  "count": 2,
  "repositories": [
    {
      "id": 1,
      "orgName": "wso2",
      "repoName": "product-apim",
      "productName": "WSO2 API Manager",
      "assetPrefixes": ["wso2am-"],
      "isActive": true,
      "createdAt": "2026-06-01T08:00:00Z",
      "updatedAt": "2026-06-25T03:14:00Z",
      "latestSnapshot": {
        "snapshotDate": "2026-06-25",
        "totalDownloadCount": 154233,
        "forksCount": 812,
        "stargazersCount": 2451,
        "watchersCount": 2451,
        "openIssuesCount": 137,
        "cloneCount": 412,
        "cloneUniques": 301
      }
    },
    {
      "id": 2,
      "orgName": "wso2",
      "repoName": "product-is",
      "productName": null,
      "assetPrefixes": [],
      "isActive": true,
      "createdAt": "2026-06-01T08:00:00Z",
      "updatedAt": "2026-06-01T08:00:00Z",
      "latestSnapshot": null
    }
  ]
}
```

- **Errors:** `401`, `500`

---

## Statistics

All `GET /api/v1/stats/*` endpoints require the User role.

### `GET /api/v1/stats/summary`

Dashboard KPI figures. Totals are summed over each active repository's most recent
snapshot; `totalClonesLast30d` sums `cloneCount` across the last 30 days.
`todayDownloads` (despite the name) is the download delta for the most recently
*completed* day, not the current one — the sync cron takes one snapshot per day
and stamps it with its own run date, but GitHub only ever reports a cumulative
total, never a per-day delta, so the delta between the two most recent snapshots
reflects the previous day's real activity. `asOfDate` names that day (one day
behind the latest snapshot's own date) — one day behind the current date is the
healthy case; more than that means the sync cron hasn't run/succeeded recently —
see the `asOfDate` field below.

- **Query params:** none

**Response `200`:**

```json
{
  "trackedRepositories": 12,
  "totalDownloads": 8421337,
  "totalStars": 19873,
  "totalForks": 6042,
  "totalClonesLast30d": 9123,
  "totalClonesLast14d": 4310,
  "todayDownloads": 1305,
  "todayDeltaPct": 5.2,
  "asOfDate": "2026-06-24",
  "monthDownloads": 40218,
  "lastSyncDate": "2026-06-25T03:14:00Z",
  "lastSyncStatus": "SUCCESS",
  "topProducts": [
    { "repoId": 1, "repoName": "product-apim", "productName": "WSO2 API Manager", "todayDownloads": 1120, "totalDownloads": 90120, "stars": 2451 }
  ]
}
```

`lastSyncDate` and `lastSyncStatus` are `null` when no sync has ever run.

- **Errors:** `401`, `500`

---

### `GET /api/v1/stats/total`

Cumulative download series per repository over the date range. `value` is the
stored cumulative `total_download_count` at each snapshot date.

- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | date | no | Inclusive start (default: 30 days ago) |
| `to` | date | no | Inclusive end (default: today UTC) |
| `repos` | string | no | Comma-separated repo ids; omitted ⇒ all active repos |
| `interval` | string | no | `day` (default) or `month`. Monthly returns each month's end-of-month cumulative value; `point.date` is then `YYYY-MM`. |

**Response `200`:**

```json
{
  "from": "2026-06-01",
  "to": "2026-06-25",
  "interval": "day",
  "series": [
    {
      "repoId": 1,
      "repoName": "product-apim",
      "points": [
        { "date": "2026-06-01", "value": 150100 },
        { "date": "2026-06-02", "value": 150480 }
      ]
    }
  ]
}
```

- **Errors:** `400` (invalid `from`/`to`/`repos`/`interval`), `401`, `500`

---

### `GET /api/v1/stats/daily`

Per-repository **daily download deltas** over the range. Deltas are computed at read
time from the cumulative totals (using a SQL `LAG` window across the repo's full
history, so the first day in the range is still correct). A repository's very first
snapshot has no prior day and is **omitted**, which prevents a newly-added repo's
day-1 total from skewing the graph. Negative deltas are clamped to `0`.

- **Query params:** same as `/stats/total` (`from`, `to`, `repos`, `interval`).
  With `interval=month` this returns **monthly downloads** (sum of daily deltas per
  calendar month; `point.date` is `YYYY-MM`).

**Response `200`:** identical shape to `/stats/total` (`value` = that day's/month's delta):

```json
{
  "from": "2026-06-01",
  "to": "2026-06-25",
  "interval": "day",
  "series": [
    {
      "repoId": 1,
      "repoName": "product-apim",
      "points": [
        { "date": "2026-06-02", "value": 380 },
        { "date": "2026-06-03", "value": 415 }
      ]
    }
  ]
}
```

- **Errors:** `400`, `401`, `500`

---

### `GET /api/v1/stats/metric`

Per-repository time series for a single GitHub stat (stars/forks/watchers/open
issues). `interval=day`/`month` return the actual **change** in the metric —
how many stars/forks/watchers were gained or lost that day, or summed over the
month — computed the same way as download deltas. Unlike downloads, this delta
is **not** clamped to zero: losing stars, forks, or watchers, or issues being
closed, are real, meaningful negative values. `interval=cumulative` returns the
raw point-in-time value instead (e.g. "2,451 stars as of this day").

- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `metric` | string | **yes** | One of `stars`, `forks`, `watchers`, `openIssues` |
| `from` | date | no | Inclusive start (default: 30 days ago) |
| `to` | date | no | Inclusive end (default: today UTC) |
| `repos` | string | no | Comma-separated repo ids; omitted ⇒ all active repos |
| `interval` | string | no | `day` (default, daily delta), `month` (monthly summed delta), or `cumulative` (raw point-in-time value) |

**Response `200`:**

```json
{
  "metric": "stars",
  "from": "2026-06-01",
  "to": "2026-06-25",
  "interval": "day",
  "series": [
    {
      "repoId": 1,
      "repoName": "product-apim",
      "points": [
        { "date": "2026-06-24", "value": 2449 },
        { "date": "2026-06-25", "value": 2451 }
      ]
    }
  ]
}
```

- **Errors:** `400` (missing/invalid `metric`, or invalid `from`/`to`/`repos`/`interval`), `401`, `500`

---

### `GET /api/v1/stats/clones`

Per-repository clone-traffic history over the range.

- **Query params:** same as `/stats/total` (`from`, `to`, `repos`)

**Response `200`:**

```json
{
  "from": "2026-06-01",
  "to": "2026-06-25",
  "series": [
    {
      "repoId": 1,
      "repoName": "product-apim",
      "points": [
        { "date": "2026-06-24", "count": 402, "uniques": 290 },
        { "date": "2026-06-25", "count": 412, "uniques": 301 }
      ]
    }
  ]
}
```

- **Errors:** `400`, `401`, `500`

---

### `GET /api/v1/stats/versions/{repoId}`

Download totals grouped by release version (`release_tag`) for one repository, taken
at the latest asset snapshot date within the range.

- **Path params:** `repoId` (positive integer)
- **Query params:** `from`, `to` (date range as above)

**Response `200`:**

```json
{
  "repoId": 1,
  "snapshotDate": "2026-06-25",
  "versions": [
    { "releaseTag": "v4.3.0", "releaseName": "WSO2 API Manager 4.3.0", "downloadCount": 90120 },
    { "releaseTag": "v4.2.0", "releaseName": "WSO2 API Manager 4.2.0", "downloadCount": 64113 }
  ]
}
```

When the repo has no asset snapshots in the range, `snapshotDate` is `""` and
`versions` is `[]`.

- **Errors:** `400` (invalid `repoId` or dates), `401`, `500`

---

### `GET /api/v1/stats/versions/{repoId}/series`

Per-version download time series for one repository — one point series per
`release_tag`, for charting version-over-version download trends.

- **Path params:** `repoId` (positive integer)
- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | date | no | Inclusive start (default: 30 days ago) |
| `to` | date | no | Inclusive end (default: today UTC) |
| `interval` | string | no | `day` (default), `month`, or `cumulative` |

`interval=day`/`month` return that period's download **delta** per version;
`interval=cumulative` returns the running per-version total instead.

**Response `200`:**

```json
{
  "repoId": 1,
  "from": "2026-06-01",
  "to": "2026-06-25",
  "interval": "day",
  "series": [
    {
      "releaseTag": "v4.3.0",
      "releaseName": "WSO2 API Manager 4.3.0",
      "points": [
        { "date": "2026-06-24", "value": 1120 },
        { "date": "2026-06-25", "value": 1305 }
      ]
    }
  ]
}
```

- **Errors:** `400` (invalid `repoId`, dates, or `interval`), `401`, `500`

---

### `GET /api/v1/stats/assets/{repoId}`

Download counts grouped by individual release asset for one repository, **summed as
daily deltas over `from`–`to`** (the same read-time delta pattern as `/stats/versions`,
so it relies on the date range exactly like the Versions table/series does) rather than
a single point-in-time cumulative snapshot. Optionally filtered to a single version.
`snapshotDate` is metadata only — the latest activity date the totals cover, for
staleness awareness — not "the day these totals are as of."

- **Path params:** `repoId` (positive integer)
- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | date | no | Inclusive start (default: 30 days ago) |
| `to` | date | no | Inclusive end (default: today UTC) |
| `version` | string | no | Filter to a single `release_tag` |

**Response `200`:**

```json
{
  "repoId": 1,
  "snapshotDate": "2026-06-25",
  "version": "v4.3.0",
  "assets": [
    {
      "releaseTag": "v4.3.0",
      "assetName": "wso2am-4.3.0.zip",
      "assetGithubId": 987654,
      "contentType": "application/zip",
      "assetSize": 734003200,
      "downloadCount": 54210
    }
  ]
}
```

`version` is `null` when no `version` filter was supplied. `contentType`/`assetSize`
may be `null`.

- **Errors:** `400`, `401`, `500`

---

### `GET /api/v1/stats/compare`

Side-by-side figures for the requested repositories over the range.
`downloadsInRange` = (latest cumulative total in range − earliest cumulative total in
range), clamped to `0`.

- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repos` | string | **yes** | Comma-separated repo ids (at least one) |
| `from` | date | no | Inclusive start (default: 30 days ago) |
| `to` | date | no | Inclusive end (default: today UTC) |

**Response `200`:**

```json
{
  "from": "2026-06-01",
  "to": "2026-06-25",
  "items": [
    {
      "repoId": 1,
      "repoName": "product-apim",
      "totalDownloads": 154233,
      "downloadsInRange": 4133,
      "stars": 2451,
      "forks": 812,
      "clonesInRange": 9120
    }
  ]
}
```

- **Errors:** `400` (missing `repos`, or invalid `repos`/dates), `401`, `500`

---

## Admin

All `/api/v1/admin/*` endpoints require the Admin role. A non-admin authenticated
user receives `403`; an unauthenticated caller receives `401`.

### `POST /api/v1/admin/repositories`

Add a new tracked repository.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
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

**Response `201`:**

```json
{ "id": 42 }
```

- **Errors:** `400` (missing `orgName`/`repoName` or malformed JSON), `401`, `403`, `413`, `500`

---

### `PATCH /api/v1/admin/repositories/{id}`

Partially update a tracked repository. Send only the fields you want to change;
omitted fields are left unchanged.

- **Path params:** `id` (positive integer)
- **Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `productName` | string \| null | New product name |
| `assetPrefixes` | string[] | Replace the tracked asset prefixes |
| `isActive` | boolean | Activate / deactivate syncing |

```json
{
  "isActive": false,
  "assetPrefixes": ["wso2am-", "wso2am-analytics-"]
}
```

**Response `204 No Content`** (empty body).

- **Errors:** `400` (invalid `id`, malformed JSON, or no updatable fields), `401`, `403`, `404` (unknown id), `413`, `500`

---

### `DELETE /api/v1/admin/repositories/{id}`

Deactivate a tracked repository (sets `is_active = 0`; the row is **not** deleted,
preserving its historical snapshots).

- **Path params:** `id` (positive integer)
- **Request body:** none

**Response `204 No Content`** (empty body).

- **Errors:** `400` (invalid `id`), `401`, `403`, `404` (unknown id), `500`

---

### `GET /api/v1/admin/sync/logs`

View the cron's sync job history, most recent first.

- **Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | integer | no | Page size (default `50`, max `200`) |
| `offset` | integer | no | Rows to skip (default `0`) |

**Response `200`:**

```json
{
  "count": 2,
  "logs": [
    {
      "id": 311,
      "status": "SUCCESS",
      "reposSynced": 12,
      "reposFailed": 0,
      "errorMessage": null,
      "startedAt": "2026-06-25T03:00:00Z",
      "completedAt": "2026-06-25T03:14:00Z",
      "createdAt": "2026-06-25T03:00:00Z"
    },
    {
      "id": 310,
      "status": "PARTIAL_FAILURE",
      "reposSynced": 11,
      "reposFailed": 1,
      "errorMessage": "wso2/product-is: releases fetch failed: 502",
      "startedAt": "2026-06-24T03:00:00Z",
      "completedAt": "2026-06-24T03:13:10Z",
      "createdAt": "2026-06-24T03:00:00Z"
    }
  ]
}
```

`status` is one of `STARTED`, `SUCCESS`, `PARTIAL_FAILURE`, `FAILED`.

- **Errors:** `401`, `403`, `500`

---

## Schema reference

### Repository / RepositoryWithStats

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | integer | no | Primary key |
| `orgName` | string | no | GitHub org |
| `repoName` | string | no | Repository name |
| `productName` | string | yes | Product/display name |
| `assetPrefixes` | string[] | no | Empty array ⇒ track all assets |
| `isActive` | boolean | no | Synced by the cron when `true` |
| `createdAt` | string (RFC3339) | no | |
| `updatedAt` | string (RFC3339) | no | |
| `latestSnapshot` | RepoSnapshot | yes | `null` until first sync (only on `RepositoryWithStats`) |

### RepoSnapshot

| Field | Type | Notes |
|-------|------|-------|
| `snapshotDate` | string (date) | |
| `totalDownloadCount` | integer (int64) | Cumulative |
| `forksCount` | integer | |
| `stargazersCount` | integer | |
| `watchersCount` | integer | |
| `openIssuesCount` | integer | |
| `cloneCount` | integer | That day's clones |
| `cloneUniques` | integer | That day's unique cloners |

### Summary

| Field | Type | Nullable |
|-------|------|----------|
| `trackedRepositories` | integer | no |
| `totalDownloads` | integer (int64) | no |
| `totalStars` | integer | no |
| `totalForks` | integer | no |
| `totalClonesLast30d` | integer | no |
| `totalClonesLast14d` | integer | no |
| `todayDownloads` | integer (int64) | no |
| `todayDeltaPct` | number | yes |
| `asOfDate` | string (date) | yes |
| `monthDownloads` | integer (int64) | no |
| `lastSyncDate` | string (RFC3339) | yes |
| `lastSyncStatus` | string | yes |
| `topProducts` | array of TopProduct | no |

`asOfDate` is the calendar day that `todayDownloads` (and each
`topProducts[].todayDownloads`) actually represents — the latest snapshot's own
`snapshot_date` minus one day, since the sync cron stamps `snapshot_date` with
its own run date (matching the convention used by the migrated historical data),
but the snapshot itself only captures state as of the end of the *previous* day —
GitHub reports a cumulative total, never a per-day delta, so a same-day figure
can never exist. **One day behind the current date is therefore the expected,
healthy value for `asOfDate`.** Clients should treat `todayDownloads` as
"yesterday's complete daily delta," and treat `asOfDate` as a staleness signal
only when it falls *more than* one day behind the current date.

`TopProduct`: `repoId` (integer), `repoName` (string), `productName` (string, nullable), `todayDownloads` (integer int64), `totalDownloads` (integer int64), `stars` (integer).

### Series response wrapper (total, daily, metric)

The `total` and `daily` endpoints return `{ from, to, interval, series[] }`; the
`metric` endpoint additionally includes `metric`. Each entry of `series` is a
`RepoSeries`:

| Field | Type | Notes |
|-------|------|-------|
| `repoId` | integer | |
| `repoName` | string | |
| `points[].date` | string | `YYYY-MM-DD` for `interval=day`, `YYYY-MM` for `interval=month` |
| `points[].value` | integer (int64) | cumulative (total), delta (daily), or the stat value (metric) |

Top-level wrapper fields: `interval` is `"day"` or `"month"`; `metric` (metric
endpoint only) is `stars` / `forks` / `watchers` / `openIssues`.

### CloneSeries / ClonePoint (clones)

| Field | Type |
|-------|------|
| `repoId` | integer |
| `repoName` | string |
| `points[].date` | string (date) |
| `points[].count` | integer |
| `points[].uniques` | integer |

### VersionBreakdown

| Field | Type | Nullable |
|-------|------|----------|
| `repoId` | integer | no |
| `snapshotDate` | string (date) | no (`""` when empty) |
| `versions[].releaseTag` | string | no |
| `versions[].releaseName` | string | yes |
| `versions[].downloadCount` | integer (int64) | no |

### VersionSeries (versions series)

| Field | Type | Nullable |
|-------|------|----------|
| `repoId` | integer | no |
| `interval` | string | no |
| `series[].releaseTag` | string | no |
| `series[].releaseName` | string | yes |
| `series[].points[].date` | string (date, or `YYYY-MM` for `month`) | no |
| `series[].points[].value` | integer (int64) | no |

### AssetBreakdown

| Field | Type | Nullable |
|-------|------|----------|
| `repoId` | integer | no |
| `snapshotDate` | string (date) | no (`""` when empty) |
| `version` | string | yes |
| `assets[].releaseTag` | string | no |
| `assets[].assetName` | string | no |
| `assets[].assetGithubId` | integer | no |
| `assets[].contentType` | string | yes |
| `assets[].assetSize` | integer (int64) | yes |
| `assets[].downloadCount` | integer (int64) | no |

### CompareItem

| Field | Type |
|-------|------|
| `repoId` | integer |
| `repoName` | string |
| `totalDownloads` | integer (int64) |
| `downloadsInRange` | integer (int64) |
| `stars` | integer |
| `forks` | integer |
| `clonesInRange` | integer |

### SyncJobLog

| Field | Type | Nullable |
|-------|------|----------|
| `id` | integer (int64) | no |
| `status` | string | no |
| `reposSynced` | integer | no |
| `reposFailed` | integer | no |
| `errorMessage` | string | yes |
| `startedAt` | string (RFC3339) | no |
| `completedAt` | string (RFC3339) | yes |
| `createdAt` | string (RFC3339) | no |

### NewRepository (POST body)

| Field | Type | Required |
|-------|------|----------|
| `orgName` | string | yes |
| `repoName` | string | yes |
| `productName` | string | no |
| `assetPrefixes` | string[] | no |
| `isActive` | boolean | no (default `true`) |

### RepositoryUpdate (PATCH body)

| Field | Type | Required |
|-------|------|----------|
| `productName` | string | no |
| `assetPrefixes` | string[] | no |
| `isActive` | boolean | no |

### ErrorPayload

| Field | Type |
|-------|------|
| `message` | string |

---

> The machine-readable contract lives in [`openapi.yaml`](./openapi.yaml) and must be
> kept in sync with this document and the handlers whenever the API changes.
