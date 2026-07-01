# GitHub Product Download Stats Dashboard Backend

Go HTTP server (`net/http`, Go 1.26+) that acts as a backend-for-frontend (BFF) for
the GitHub Product Download Stats Dashboard. Unlike a forwarding BFF, its "upstream" is the
`github_statistics` **MySQL database** (read-only): it runs aggregation queries over
the daily snapshots written by the Ballerina sync cron and shapes the results for the
React dashboard.

## Middleware chain

`SecurityHeaders → CorrelationID → Auth → Logger → Mux`

- `SecurityHeaders`: sets `X-Content-Type-Options: nosniff`, `Content-Security-Policy: upgrade-insecure-requests`, `Strict-Transport-Security` on every response; outermost so headers exist even on auth failures
- `CorrelationID`: reads `X-GH-Stats-Correlation-ID` or generates a UUID v4; stores it in context for slog and echoes it in the response header
- `Auth`: validates the `x-jwt-assertion` JWT and sets `UserInfo` in context
- `Logger`: logs every completed request (method, path, status, elapsed) via slog

`middleware.ConfigureLogger()` must be called at startup so every
`slog.*Context(r.Context(), …)` call automatically includes `correlationID` and `userID`.

## Data layer

All data access lives in `internal/store` (the MySQL upstream):

- `store.New(Config)` opens and pings the pool; `Store` owns every query
- One file per concern: `repositories.go`, `stats.go`, `synclogs.go`
- Query builders embed no user input via string concatenation except whitelisted
  fragments (IN-clause `?` placeholders, fixed SET columns); all values are bound
  parameters
- Daily download deltas are computed at read time with a SQL `LAG` window function
  over each repo's full history, so the first day of a range still gets a correct
  delta. Negative deltas are clamped to zero
- Cumulative `total_download_count` is stored already-cumulative by the cron;
  read-time work only differences it

## Adding a new endpoint

1. **Store method** (`internal/store/`) — add a method on `*Store`; bind every value as a `?` parameter, never string-concatenate user input
2. **Handler interface** — extend the local interface in the relevant handler file (e.g. `statsStore` in `stats.go`); keep it minimal
3. **Handler func** — auth check → path/query guards → call store → `mapStoreError` on failure → write response
4. **Route** (`cmd/server/main.go`) — register with Go 1.22 method-prefixed patterns: `"GET /api/v1/stats/foo/{repoId}"`
5. **OpenAPI spec** (`openapi.yaml`) — add the path with 400/401/403/500 (and 404 if it reads a single row); `403` is always required because admin handlers and forbidden access can return it
6. **Tests** — add handler tests; wire the new method into `mockStore` in `helpers_test.go`

## Handler conventions

- **Auth**: always check `middleware.UserInfoFromContext(r.Context()) == nil` first → 401
- **Admin gate**: admin handlers call `h.requireAdmin(w, r)`, which returns nil after writing 401 (no user) or 403 (not in `ADMIN_GROUPS`)
- **Body size**: cap with `http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)` (1 MiB) before reading; `readJSONBody` does this
- **Path params**: `parseRepoIDPath` rejects non-positive / non-integer ids with 400 before any query
- **Query params**: `parseDateRange` (defaults to last 30 days, validates `YYYY-MM-DD`) and `parseRepoIDs` (comma-separated positive ints); both fail fast with 400
- **Store errors**: always use `mapStoreError(w, err, "<fallback message>")` — never inline status mappings; it maps `apierror.ErrNotFound` → 404
- **Response**: build typed structs and use `writeJSONValue`; never write upstream/storage error text to the caller

## Response shape

- All portal-owned JSON fields use **camelCase** via `json:"fieldName"` struct tags (see `internal/store/types.go`)
- Nullable DB columns map to pointer fields (`*string`, `*int64`) so `null` is explicit
- Dates render as `YYYY-MM-DD`; datetimes as RFC3339

## Security

- **Never commit secrets** — DB credentials, JWKS URLs, etc. come from environment variables / `.env` (git-ignored)
- **No sensitive data in logs** — log only IDs and error summaries, never request bodies or JWT payloads
- **JWT is the only auth mechanism** — every endpoint except `/health` validates the caller via `middleware.UserInfoFromContext`
- **Input validation** — validate path/query/body at the boundary before touching the store
- **Parameterised SQL only** — every value is a bound `?` parameter; never interpolate user input into SQL text

## Testing

- Mocks live in `internal/handler/helpers_test.go` — `mockStore` implements all three
  handler interfaces via optional func fields; set only what a test needs
- `withUser(r, testUser|testAdmin)` injects an authenticated user into the request context
- `decodeJSON[T]()` decodes response bodies; `assertStatus` / `assertErrorMessage` assert outcomes
- Tests are pure unit tests — no database required
