# GitHub Product Download Stats Dashboard — Webapp

React + Vite single-page app that visualizes the GitHub product download/clone/stars
statistics served by the dashboard backend. Built with WSO2 Oxygen UI, Asgardeo auth,
and TanStack Query, following the team's `apps/customer-portal/webapp` conventions.

## Quick start

```bash
# from apps/gh-product-download-stats-dashboard/webapp
npm install
cp public/config.js.example public/config.js   # fill in Asgardeo + backend URL
npm run dev
```

App runs at `http://localhost:3000`. Runtime config is read from `public/config.js`
(`window.config`) — it is **not** bundled, so the same build works across environments.

## Configuration (`public/config.js`)

| Key                                                              | Description                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_BASE_URL`              | Asgardeo tenant base URL                                                            |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_CLIENT_ID`             | Asgardeo SPA app client id                                                          |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_SIGN_IN_REDIRECT_URL`  | Post-login redirect (e.g. `http://localhost:3000`)                                  |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_AUTH_SIGN_OUT_REDIRECT_URL` | Post-logout redirect                                                                |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_BACKEND_BASE_URL`           | Dashboard backend base URL (Choreo gateway URL in prod)                             |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_THEME`                      | Oxygen theme: `acrylicOrange` (default), `acrylicPurple`, `highContrast`, `classic` |
| `GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_LOG_LEVEL`                  | `DEBUG` / `INFO` / `WARN` / `ERROR` / `NONE`                                        |

## Scripts

```bash
npm run dev       # vite dev server
npm run build     # tsc -b && vite build  ->  dist/
npm run lint      # eslint
npm run test      # vitest
npm run preview   # preview the production build
```

## Authentication

Asgardeo Authorization-Code + PKCE in the SPA. `useAuthApiClient` attaches a fresh ID
token as `Authorization: Bearer <token>`; in production the Choreo gateway converts this
to the `x-jwt-assertion` header the backend validates. The **Admin** nav/route is shown
only when the backend's `GET /user-info` reports `isAdmin: true` — admin group names
live solely in the backend's `ADMIN_GROUPS` environment variable, never in frontend
config, and the backend independently enforces admin access on every `/admin` endpoint
(see the repo-root `auth.md`).

## Pages

| Route           | Page                                                                        | Data                                                                         |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/`             | Overview — KPIs, 30-day trend, top products, last-synced banner             | `/stats/summary`, `/repositories`, `/stats/total`                            |
| `/downloads`    | Downloads — cumulative + per-period (day/month), version & asset drill-down | `/stats/total`, `/stats/daily`, `/stats/versions/{id}`, `/stats/assets/{id}` |
| `/clones`       | Clone Traffic — total vs unique                                             | `/stats/clones`                                                              |
| `/github-stats` | GitHub Stats — stars/forks/watchers/issues over time                        | `/stats/metric`                                                              |
| `/admin`        | Admin (gated) — manage tracked repos + sync history                         | `/admin/repositories`, CRUD, `/admin/sync/logs`                              |

All analytics filters (repos, date range, interval, metric) live in the **URL query
string**, so any view is shareable/bookmarkable.

## Structure

```text
src/
├── main.tsx · AppWithConfig.tsx · App.tsx     # entry, providers, routes
├── config/      auth · api · theme · logger
├── constants/   apiConstants · authConstants · common
├── context/logger/  · hooks/  (useAuthApiClient, useApiQuery, useLogger, useIsAdmin)
├── utils/       format · accessControl
├── layouts/     AppLayout · AuthGuard · RequireAdmin · ErrorLayout
├── components/   side-nav-bar · header · error · empty-state · error-state · stat-card · charts
└── features/
    ├── stats/        api · components · pages (Overview/Downloads/Clones/GitHubStats) · types · utils · constants
    └── repositories/ api · components · pages (Admin) · types
```

> **Note on charts:** all chart rendering is isolated in
> `src/components/charts/SeriesChart.tsx` (the only file importing
> `@wso2/oxygen-ui-charts-react`). If the installed chart library's prop API differs
> from the recharts-style usage here, adjust that one component.
