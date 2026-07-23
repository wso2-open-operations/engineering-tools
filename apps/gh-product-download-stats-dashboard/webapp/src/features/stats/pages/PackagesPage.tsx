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
} from "@wso2/oxygen-ui-icons-react";
import { type JSX, useMemo, useState } from "react";
import PageHeader from "@components/page-header/PageHeader";
import { usePagination } from "@hooks/usePagination";
import { ROWS_PER_PAGE_OPTIONS } from "@constants/tableConstants";
import { useSearchParams } from "react-router";
import ChartCard from "@features/stats/components/ChartCard";
import SeriesChart, { type ChartSeries } from "@components/charts/SeriesChart";
import EmptyState from "@components/empty-state/EmptyState";
import ErrorState from "@components/error-state/ErrorState";
import { useGetPackageRepos } from "@features/stats/api/useGetPackageRepos";
import { useGetPackageBreakdown } from "@features/stats/api/useGetPackageBreakdown";
import { useGetPackageSeries } from "@features/stats/api/useGetPackageSeries";
import { useGetPackageVersions } from "@features/stats/api/useGetPackageVersions";
import { type Interval, type PackageSeries } from "@features/stats/types/stats";
import { parseFilters, mergeParams } from "@features/stats/utils/filters";
import { formatCompact } from "@utils/format";

// How many of the most active packages the chart shows by default —
// unchecking all packages in the filter shows every package. The Packages
// table below is unaffected and always lists everything.
const DEFAULT_VISIBLE_PACKAGES = 5;

const MODE_OPTIONS: Array<{ value: Interval; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "month", label: "Monthly" },
  { value: "cumulative", label: "Cumulative" },
];

function toChart(series: PackageSeries[]): ChartSeries[] {
  return series.map((p) => ({
    key: p.packageName,
    name: p.packageName,
    points: p.points,
  }));
}

export default function PackagesPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const { data: reposData } = useGetPackageRepos();
  const repos = reposData?.repos ?? [];

  const repoParam = Number(params.get("repo"));
  const repoId = repoParam > 0 ? repoParam : (repos[0]?.repoId ?? null);

  // Single-package selection for the Versions panel (row click).
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  // repoId for which the defaults below have been computed — state (not a
  // ref) because it's read during render to gate the versions query.
  const [defaultsRepoId, setDefaultsRepoId] = useState<number | null>(null);
  // Multi-select filter narrowing which packages appear in the chart.
  const [chartPackages, setChartPackages] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const breakdownQuery = useGetPackageBreakdown(
    repoId,
    filters.from,
    filters.to,
  );
  const seriesQuery = useGetPackageSeries(
    repoId,
    filters.from,
    filters.to,
    filters.interval,
  );

  // Memoized (not a bare `?? []`) so derived values below get a referentially
  // stable dependency while the query is loading — the same lesson as
  // VersionsPage, where an inline `?? []` caused an infinite update loop.
  const series = useMemo(
    () => seriesQuery.data?.series ?? [],
    [seriesQuery.data],
  );
  const packages = useMemo(
    () => breakdownQuery.data?.packages ?? [],
    [breakdownQuery.data],
  );

  // Gates the versions query until this repo's default package is resolved,
  // so it never fires with the previous repo's stale selection.
  const repoSettled = defaultsRepoId === repoId;

  const versionsQuery = useGetPackageVersions(
    repoSettled ? repoId : null,
    selectedPackage,
    filters.from,
    filters.to,
  );

  // Product switch: clear the previous repo's stale selections immediately,
  // then auto-select defaults once the new repo's breakdown lands — the
  // Versions panel follows the Packages table's top row, and the chart starts
  // with the most active DEFAULT_VISIBLE_PACKAGES. Both adjustments happen
  // during render (React's documented "adjust state when props change"
  // pattern) instead of an effect. The separate clearedRepoId tracker makes
  // the clear run exactly once per switch — without it, the loading branch
  // would call setChartPackages([]) every render (a fresh [] never bails
  // out), looping forever. When the breakdown is already cached, both blocks
  // run in the same render pass and the defaults win — no ordering race.
  const [clearedRepoId, setClearedRepoId] = useState<number | null>(repoId);
  if (clearedRepoId !== repoId) {
    setClearedRepoId(repoId);
    setSelectedPackage(null);
    setChartPackages([]);
  }
  if (defaultsRepoId !== repoId && breakdownQuery.data) {
    const names = breakdownQuery.data.packages.map((p) => p.packageName);
    setSelectedPackage(names[0] ?? null);
    setChartPackages(names.slice(0, DEFAULT_VISIBLE_PACKAGES));
    setDefaultsRepoId(repoId);
  }

  const onChange = (updates: Record<string, string | number[] | null>) =>
    setParams(mergeParams(params, updates), { replace: true });

  // Chart-only narrowing; memoized on true dependencies so table interactions
  // (package row clicks) never re-render the chart.
  const chartSeries = useMemo(
    () =>
      toChart(
        chartPackages.length > 0
          ? series.filter((p) => chartPackages.includes(p.packageName))
          : series,
      ),
    [series, chartPackages],
  );

  // "Cumulative" is a different metric from "Daily"/"Monthly": a running
  // stock total (totalDownloads), not a period flow (periodDownloads). Day
  // and month deliberately show the SAME number for a fixed date range —
  // summing daily deltas over a range equals summing monthly deltas over the
  // same range — so only cumulative needs a different source field, mirroring
  // how DownloadsPage switches its whole data source (dailyQuery vs
  // totalQuery) on the same toggle.
  const isCumulative = filters.interval === "cumulative";
  const downloadsOf = (item: { periodDownloads: number; totalDownloads: number }) =>
    isCumulative ? item.totalDownloads : item.periodDownloads;

  const periodTotal = packages.reduce((acc, p) => acc + downloadsOf(p), 0);
  const rows = packages.map((p) => ({
    ...p,
    share: periodTotal > 0 ? (downloadsOf(p) / periodTotal) * 100 : 0,
  }));

  const versions = versionsQuery.data?.versions ?? [];
  const packagePagination = usePagination(rows);
  const versionPagination = usePagination(versions);

  return (
    <Box>
      <PageHeader
        title="Packages"
        description="GitHub container package downloads per product — package totals and per-version breakdowns."
      />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <FormControl size="small" sx={{ flex: 1, minWidth: 200 }}>
            <InputLabel>Product</InputLabel>
            <Select
              value={repoId ?? ""}
              label="Product"
              onChange={(e) => {
                setSelectedPackage(null);
                onChange({ repo: String(e.target.value) });
              }}
            >
              {repos.map((r) => (
                <MenuItem key={r.repoId} value={r.repoId}>
                  {r.productName || r.repoName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel shrink>Chart packages</InputLabel>
            <Select
              multiple
              displayEmpty
              notched
              value={chartPackages}
              label="Chart packages"
              onChange={(e) => {
                const val = e.target.value;
                setChartPackages(Array.isArray(val) ? val : [val]);
              }}
              renderValue={(selected) => {
                if (selected.length === 0) return "All packages";
                if (selected.length === 1) return selected[0];
                return `${selected.length} packages`;
              }}
            >
              {packages.map((p) => (
                <MenuItem key={p.packageName} value={p.packageName}>
                  <Checkbox
                    size="small"
                    checked={chartPackages.includes(p.packageName)}
                  />
                  <ListItemText primary={p.packageName} />
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
        title="Downloads by package"
        subtitle="Package pulls over the selected range, from exact scraped totals"
        showTypeToggle={filters.interval !== "month"}
        defaultVariant={filters.interval === "month" ? "bar" : "line"}
      >
        {(v) => (
          <SeriesChart
            variant={filters.interval === "month" ? "bar" : v}
            series={chartSeries}
            isLoading={seriesQuery.isLoading}
            isError={seriesQuery.isError}
            onRetry={() => void seriesQuery.refetch()}
            emptyTitle="No package data for this product / range yet"
            xTickFormat="short"
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
            Packages
          </Typography>
          {breakdownQuery.isLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={36} />
              ))}
            </Box>
          ) : breakdownQuery.isError ? (
            <ErrorState minHeight={160} />
          ) : rows.length === 0 ? (
            <EmptyState title="No packages found" minHeight={160} />
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Package</TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title={
                          isCumulative
                            ? "All-time downloads, as of the latest sync"
                            : "Downloads within the selected date range"
                        }
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
                          Downloads
                        </Box>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {packagePagination.paged.map((p) => (
                    <TableRow
                      key={p.packageName}
                      hover
                      selected={selectedPackage === p.packageName}
                      role="button"
                      tabIndex={0}
                      sx={{ cursor: "pointer" }}
                      onClick={() => setSelectedPackage(p.packageName)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPackage(p.packageName);
                        }
                      }}
                    >
                      <TableCell>{p.packageName}</TableCell>
                      <TableCell align="right">
                        {formatCompact(downloadsOf(p))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={packagePagination.count}
                page={packagePagination.page}
                onPageChange={packagePagination.onPageChange}
                rowsPerPage={packagePagination.rowsPerPage}
                onRowsPerPageChange={packagePagination.onRowsPerPageChange}
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
              Versions
            </Typography>
            {selectedPackage ? (
              <Chip
                size="small"
                label={selectedPackage}
                color="primary"
                onDelete={() => setSelectedPackage(null)}
              />
            ) : (
              <Tooltip
                title="Click a package row to see its tagged versions"
                placement="right"
              >
                <Info size={15} style={{ opacity: 0.45, cursor: "help" }} />
              </Tooltip>
            )}
          </Box>
          {!repoSettled || versionsQuery.isLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={36} />
              ))}
            </Box>
          ) : versionsQuery.isError ? (
            <ErrorState minHeight={160} />
          ) : !selectedPackage || versions.length === 0 ? (
            <EmptyState
              title={
                selectedPackage
                  ? "No tagged version data yet"
                  : "Select a package to see versions"
              }
              minHeight={160}
            />
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tags</TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title={
                          isCumulative
                            ? "All-time downloads, as of the latest sync"
                            : "Downloads within the selected date range"
                        }
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
                          Downloads
                        </Box>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {versionPagination.paged.map((v) => (
                    <TableRow key={v.versionId}>
                      <TableCell>
                        <Box
                          component="span"
                          sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
                        >
                          {v.tags || `#${v.versionId}`}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {formatCompact(downloadsOf(v))}
                      </TableCell>
                    </TableRow>
                  ))}
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
      </Box>
    </Box>
  );
}
