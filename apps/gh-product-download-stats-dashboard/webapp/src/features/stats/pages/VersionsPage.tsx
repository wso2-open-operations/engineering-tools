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

import {
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputBase,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Skeleton,
} from "@wso2/oxygen-ui";
import {
  ChevronDown,
  ChevronUp,
  Info,
  ListFilter,
  Search,
  X,
} from "@wso2/oxygen-ui-icons-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import PageHeader from "@components/page-header/PageHeader";
import { usePagination } from "@hooks/usePagination";
import { ROWS_PER_PAGE_OPTIONS } from "@constants/tableConstants";
import { useSearchParams } from "react-router";
import ChartCard from "@features/stats/components/ChartCard";
import SeriesChart, { type ChartSeries } from "@components/charts/SeriesChart";
import EmptyState from "@components/empty-state/EmptyState";
import ErrorState from "@components/error-state/ErrorState";
import { useGetRepositories } from "@features/stats/api/useGetRepositories";
import { useGetVersionSeries } from "@features/stats/api/useGetVersionSeries";
import { useGetAssetBreakdown } from "@features/stats/api/useGetAssetBreakdown";
import { type Interval, type VersionSeries } from "@features/stats/types/stats";
import { parseFilters, mergeParams } from "@features/stats/utils/filters";
import { formatCompact, formatBytes } from "@utils/format";

// How many of the most recent versions to show in the chart by default, so a
// product with many releases doesn't dump every version onto it at once.
// Unchecking all versions in the filter shows every version in the chart too.
// The Versions table below is unaffected — it always lists every version, since
// its purpose is a complete, comparable view rather than a focused chart read.
const DEFAULT_VISIBLE_VERSIONS = 5;

const MODE_OPTIONS: Array<{ value: Interval; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "month", label: "Monthly" },
  { value: "cumulative", label: "Cumulative" },
];

function toChart(series: VersionSeries[]): ChartSeries[] {
  return series.map((v) => ({
    key: v.releaseTag,
    name: v.releaseName || v.releaseTag,
    points: v.points,
  }));
}

export default function VersionsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const { data: reposData } = useGetRepositories();
  const repos = reposData?.repositories ?? [];

  const repoParam = Number(params.get("repo"));
  const repoId = repoParam > 0 ? repoParam : (repos[0]?.id ?? null);

  // Single-version selection for the Assets panel (row click).
  const [version, setVersion] = useState<string | null>(null);
  // repoId for which the auto-selected version/selectedVersions defaults below
  // have actually been computed. State (not a ref) because it's read during
  // render to gate the Assets query — see repoSettled below.
  const [defaultVersionRepoId, setDefaultVersionRepoId] = useState<
    number | null
  >(null);

  // Multi-select filter for which versions appear in the chart + by-version table.
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [versionSearch, setVersionSearch] = useState("");
  const [showVersionSearch, setShowVersionSearch] = useState(false);
  const [searchResetRepoId, setSearchResetRepoId] = useState(repoId);

  const seriesQuery = useGetVersionSeries(
    repoId,
    filters.from,
    filters.to,
    filters.interval,
  );

  // Memoized (not a bare `?? []`) so this stays referentially stable across
  // renders whenever seriesQuery.data itself hasn't changed — otherwise `?? []`
  // creates a brand-new empty array every render while loading, which the
  // React Compiler can't safely treat as a dependency for memoized values
  // derived from it (see chartSeries below).
  const series = useMemo(
    () => seriesQuery.data?.series ?? [],
    [seriesQuery.data],
  );

  // True once the effect below has computed the auto-selected version for the
  // CURRENT repoId. Gates the Assets query so it never fires for a repo whose
  // default version hasn't been resolved yet — without this, switching repos
  // fired the Assets query once immediately with the stale/null version left
  // over from the previous repo, showing unfiltered (wrong-looking) data, and
  // then fired it again moments later once the real default version landed,
  // producing a second avoidable loading flicker right after the chart and
  // Versions table had already finished loading.
  const repoSettled = defaultVersionRepoId === repoId;

  const assetsQuery = useGetAssetBreakdown(
    repoSettled ? repoId : null,
    filters.from,
    filters.to,
    version,
  );

  // Auto-select the Assets panel's default version to match the Versions
  // table's own first row (highest total downloads) — not the latest release
  // tag, which is a different sort and could easily point at a different,
  // mismatched version. Also defaults the chart to just the most recent
  // DEFAULT_VISIBLE_VERSIONS releases (tag desc — a chart of recent trends,
  // not tied to the Assets panel's selection), when data first loads for a
  // newly selected product. This was previously two
  // separate effects (one resetting on repoId change, one auto-selecting once
  // series arrived) — when a repo's series was already cached by TanStack Query,
  // the data arrived on the SAME render as the repoId change, so the auto-select
  // effect ran first and picked 5, then the reset effect (declared after it)
  // immediately overwrote that back to empty/"all versions". Merging into one
  // effect makes that ordering race impossible.
  //
  // Deliberately depends on seriesQuery.data, NOT the derived `series` variable
  // above — `series` falls back to a brand-new `[]` literal on every render
  // while the query is loading (unlike seriesQuery.data, which TanStack Query
  // keeps referentially stable until the fetch actually resolves), so using it
  // as a dependency reran this effect every render, and setSelectedVersions([])
  // in the loading branch below never bails out (a new [] is never Object.is
  // the previous one), forcing another render — an infinite update loop.
  useEffect(() => {
    if (defaultVersionRepoId === repoId) return;
    if (!seriesQuery.data) {
      // New repo's data hasn't arrived yet — clear the previous repo's stale
      // selections. Leaves defaultVersionRepoId unset so this effect re-runs
      // and picks real defaults once data lands.
      setSelectedVersions([]);
      setVersion(null);
      return;
    }
    const byDownloads = seriesQuery.data.series
      .map((v) => ({
        tag: v.releaseTag,
        total: v.points.reduce((a, p) => a + p.value, 0),
      }))
      .sort((a, b) => b.total - a.total);
    const sortedByTag = [...seriesQuery.data.series].sort((a, b) =>
      b.releaseTag.localeCompare(a.releaseTag),
    );
    setVersion(byDownloads[0]?.tag ?? null);
    setSelectedVersions(
      sortedByTag.slice(0, DEFAULT_VISIBLE_VERSIONS).map((v) => v.releaseTag),
    );
    setDefaultVersionRepoId(repoId);
  }, [repoId, seriesQuery.data, defaultVersionRepoId]);

  // Reset the version search when the product changes, so a search from one
  // product doesn't silently carry over and hide rows on another. Adjusted
  // during render (React's documented pattern for this) rather than via an
  // effect, since it's a plain "prop changed" reset with no async work.
  if (repoId !== searchResetRepoId) {
    setSearchResetRepoId(repoId);
    setVersionSearch("");
    setShowVersionSearch(false);
  }

  const onChange = (updates: Record<string, string | number[] | null>) =>
    setParams(mergeParams(params, updates), { replace: true });

  // Build rows from all series (unfiltered) — used for dropdown options.
  const allRows = series
    .map((v) => {
      const total = v.points.reduce((a, p) => a + p.value, 0);
      return {
        tag: v.releaseTag,
        name: v.releaseName || v.releaseTag,
        total,
        avg: v.points.length ? Math.round(total / v.points.length) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // The version multi-select filter narrows the chart only, so a product with
  // many releases doesn't dump every line onto it at once. The table's job is
  // the opposite — a complete, comparable view of every version — so it always
  // shows allRows regardless of the chart's selection.
  //
  // Memoized on its true dependencies only (series, selectedVersions) — not
  // computed inline — so it keeps the same array reference across renders
  // triggered by unrelated table-only state (the version search text, the
  // single-row version click for the Assets panel, etc). SeriesChart itself
  // memoizes its chart data off the `series` prop's reference, so an inline
  // computation here (a new array every render regardless of cause) defeated
  // that memoization and made the chart visibly re-render on every table
  // interaction, even though chart data and table data are meant to be
  // isolated from each other.
  const chartSeries = useMemo(
    () =>
      toChart(
        selectedVersions.length > 0
          ? series.filter((v) => selectedVersions.includes(v.releaseTag))
          : series,
      ),
    [series, selectedVersions],
  );

  const grandTotal = allRows.reduce((acc, r) => acc + r.total, 0);
  const rowsWithShare = allRows.map((r) => ({
    ...r,
    share: grandTotal > 0 ? (r.total / grandTotal) * 100 : 0,
  }));

  // Search narrows which rows are shown/paginated, but share % stays relative
  // to the true total across all versions (not just the search results).
  const displayedRows = versionSearch
    ? rowsWithShare.filter(
        (r) =>
          r.name.toLowerCase().includes(versionSearch.toLowerCase()) ||
          r.tag.toLowerCase().includes(versionSearch.toLowerCase()),
      )
    : rowsWithShare;

  const assets = assetsQuery.data?.assets ?? [];
  const versionPagination = usePagination(displayedRows);
  const assetPagination = usePagination(assets);

  const variant = filters.interval === "month" ? "bar" : "line";

  return (
    <Box>
      <PageHeader
        title="Versions"
        description="Per-release download breakdown and asset-level stats for each tracked product."
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        {/* Always-visible: product + version multi-select + filter toggle */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <FormControl size="small" sx={{ flex: 1, minWidth: 200 }}>
            <InputLabel shrink>Product</InputLabel>
            <Select
              notched
              value={repoId ?? ""}
              label="Product"
              onChange={(e) => {
                setVersion(null);
                onChange({ repo: String(e.target.value) });
              }}
            >
              {repos.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.productName || r.repoName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel shrink>Version</InputLabel>
            <Select
              multiple
              displayEmpty
              notched
              value={selectedVersions}
              label="Version"
              onChange={(e) => {
                const val = e.target.value;
                setSelectedVersions(Array.isArray(val) ? val : [val]);
              }}
              renderValue={(selected) => {
                if (selected.length === 0) return "All versions";
                if (selected.length === 1) return selected[0];
                return `${selected.length} versions`;
              }}
            >
              {allRows.map((r) => (
                <MenuItem key={r.tag} value={r.tag}>
                  <Checkbox
                    size="small"
                    checked={selectedVersions.includes(r.tag)}
                  />
                  <ListItemText primary={r.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="outlined"
            size="small"
            color="primary"
            onClick={() => setFiltersOpen((o) => !o)}
            startIcon={<ListFilter size={16} />}
            endIcon={
              filtersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />
            }
          >
            Filters
          </Button>
        </Box>

        {/* Collapsible: date range + interval */}
        {filtersOpen && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="From"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={filters.from}
                  onChange={(e) => onChange({ from: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="To"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={filters.to}
                  onChange={(e) => onChange({ to: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Interval</InputLabel>
                  <Select
                    value={filters.interval}
                    label="Interval"
                    onChange={(e) => onChange({ interval: e.target.value })}
                  >
                    {MODE_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </>
        )}
      </Paper>

      <ChartCard
        title="Downloads by version"
        showTypeToggle={filters.interval !== "month"}
        defaultVariant={variant}
      >
        {(v) => (
          <SeriesChart
            variant={filters.interval === "month" ? "bar" : v}
            series={chartSeries}
            isLoading={seriesQuery.isLoading}
            isError={seriesQuery.isError}
            onRetry={() => void seriesQuery.refetch()}
            emptyTitle="No release data for this product / range"
          />
        )}
      </ChartCard>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          mt: 2,
        }}
      >
        <Card sx={{ p: 2 }}>
          <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
            Versions
          </Typography>
          {seriesQuery.isLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={36} />
              ))}
            </Box>
          ) : seriesQuery.isError ? (
            <ErrorState minHeight={160} />
          ) : rowsWithShare.length === 0 ? (
            <EmptyState title="No versions found" minHeight={160} />
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                      >
                        Version
                        {!showVersionSearch ? (
                          <Tooltip title="Filter by version">
                            <IconButton
                              size="small"
                              aria-label="Filter by version"
                              onClick={() => setShowVersionSearch(true)}
                            >
                              <Search size={14} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <>
                            <InputBase
                              autoFocus
                              placeholder="Filter…"
                              aria-label="Filter versions"
                              autoComplete="off"
                              value={versionSearch}
                              onChange={(e) => setVersionSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setVersionSearch("");
                                  setShowVersionSearch(false);
                                }
                              }}
                              inputProps={{
                                "data-lpignore": "true",
                                "data-1p-ignore": "true",
                                "data-bwignore": "true",
                                "data-form-type": "other",
                              }}
                              sx={{
                                fontSize: "0.8rem",
                                width: 110,
                                borderBottom: "1px solid",
                                borderColor: "divider",
                              }}
                            />
                            <Tooltip title="Clear filter">
                              <IconButton
                                size="small"
                                aria-label="Clear version filter"
                                onClick={() => {
                                  setVersionSearch("");
                                  setShowVersionSearch(false);
                                }}
                              >
                                <X size={14} />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>Tag</TableCell>
                    <TableCell align="right">Downloads</TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title="Percentage of total downloads across all displayed versions in the selected date range"
                        placement="top"
                      >
                        <Box
                          component="span"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 0.5,
                            cursor: "help",
                          }}
                        >
                          Share
                          <Info size={13} style={{ opacity: 0.5 }} />
                        </Box>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {displayedRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ border: 0 }}>
                        <EmptyState
                          title="No versions match your search"
                          minHeight={120}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    versionPagination.paged.map((r) => (
                      <TableRow
                        key={r.tag}
                        hover
                        selected={version === r.tag}
                        role="button"
                        tabIndex={0}
                        sx={{ cursor: "pointer" }}
                        onClick={() =>
                          setVersion(version === r.tag ? null : r.tag)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setVersion(version === r.tag ? null : r.tag);
                          }
                        }}
                      >
                        <TableCell>{r.name}</TableCell>
                        <TableCell>
                          <Box
                            component="span"
                            sx={{
                              fontFamily: "monospace",
                              fontSize: "0.75rem",
                            }}
                          >
                            {r.tag}
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          {formatCompact(r.total)}
                        </TableCell>
                        <TableCell align="right">
                          {r.share.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={versionPagination.count}
                page={versionPagination.page}
                onPageChange={versionPagination.onPageChange}
                rowsPerPage={versionPagination.rowsPerPage}
                onRowsPerPageChange={versionPagination.onRowsPerPageChange}
                rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
                showFirstButton
                showLastButton
              />
            </>
          )}
        </Card>

        <Card sx={{ p: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <Typography variant="h6" component="h3">
              Assets
            </Typography>
            {version ? (
              <Chip
                size="small"
                label={version}
                color="primary"
                onDelete={() => setVersion(null)}
              />
            ) : (
              <Tooltip
                title="Click a version row to filter assets by that release"
                placement="right"
              >
                <Info size={15} style={{ opacity: 0.45, cursor: "help" }} />
              </Tooltip>
            )}
          </Box>
          {!repoSettled || assetsQuery.isLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={36} />
              ))}
            </Box>
          ) : assetsQuery.isError ? (
            <ErrorState minHeight={160} />
          ) : assets.length === 0 ? (
            <EmptyState title="No asset data" minHeight={160} />
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Asset</TableCell>
                    <TableCell align="right">Size</TableCell>
                    <TableCell align="right">Downloads</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {assetPagination.paged.map((a) => (
                    <TableRow key={a.assetGithubId}>
                      <TableCell>{a.assetName}</TableCell>
                      <TableCell align="right">
                        {formatBytes(a.assetSize)}
                      </TableCell>
                      <TableCell align="right">
                        {formatCompact(a.downloadCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={assetPagination.count}
                page={assetPagination.page}
                onPageChange={assetPagination.onPageChange}
                rowsPerPage={assetPagination.rowsPerPage}
                onRowsPerPageChange={assetPagination.onRowsPerPageChange}
                rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
                showFirstButton
                showLastButton
              />
            </>
          )}
        </Card>
      </Box>
    </Box>
  );
}
