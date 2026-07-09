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
  Card,
  FormControl,
  Grid,
  IconButton,
  InputBase,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Info, Search, X } from "@wso2/oxygen-ui-icons-react";
import PageHeader from "@components/page-header/PageHeader";
import { usePagination } from "@hooks/usePagination";
import { ROWS_PER_PAGE_OPTIONS } from "@constants/tableConstants";
import { type JSX, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import FilterBar from "@features/stats/components/FilterBar";
import ChartCard from "@features/stats/components/ChartCard";
import SeriesChart, { type ChartSeries } from "@components/charts/SeriesChart";
import EmptyState from "@components/empty-state/EmptyState";
import { useGetRepositories } from "@features/stats/api/useGetRepositories";
import { useGetMetricSeries } from "@features/stats/api/useGetMetricSeries";
import { useGetCloneSeries } from "@features/stats/api/useGetCloneSeries";
import {
  type Interval,
  type Metric,
  type CloneSeries,
  type RepoSeries,
} from "@features/stats/types/stats";
import {
  parseFilters,
  mergeParams,
  toChartSeries,
} from "@features/stats/utils/filters";
import { formatCompact } from "@utils/format";

type StatKey = Metric | "clones" | "uniqueCloners";

const STAT_OPTIONS: Array<{ value: StatKey; label: string }> = [
  { value: "stars", label: "Stars" },
  { value: "forks", label: "Forks" },
  { value: "watchers", label: "Watchers" },
  { value: "openIssues", label: "Open Issues" },
  { value: "clones", label: "Total Clones" },
  { value: "uniqueCloners", label: "Unique Cloners" },
];

const INTERVAL_OPTIONS: Array<{ value: Interval; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "month", label: "Monthly" },
  { value: "cumulative", label: "Cumulative" },
];

// Reshapes daily clone series into chart series for the selected mode/interval.
function transformClones(
  series: CloneSeries[],
  field: "count" | "uniques",
  interval: Interval,
): ChartSeries[] {
  return series.map((s) => {
    const daily = s.points.map((p) => ({ date: p.date, value: p[field] }));
    let points = daily;
    if (interval === "month") {
      const byMonth = new Map<string, number>();
      for (const p of daily) {
        const m = p.date.slice(0, 7);
        byMonth.set(m, (byMonth.get(m) ?? 0) + p.value);
      }
      points = [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, value }));
    } else if (interval === "cumulative") {
      let run = 0;
      points = daily.map((p) => {
        run += p.value;
        return { date: p.date, value: run };
      });
    }
    return { key: `repo-${s.repoId}`, name: s.repoName, points };
  });
}

type TableMode = "total" | "month" | "day";

// Returns the metric value for a repo from a daily DELTA series (tableBase
// always requests interval: "day" — see below) for the given mode/date.
// Returns null in "total" mode so callers can fall back to latestSnapshot.
function getSeriesValue(
  series: RepoSeries[] | undefined,
  repoId: number,
  mode: TableMode,
  date: string,
): number | null {
  if (mode === "total" || !series || !date) return null;
  const s = series.find((r) => r.repoId === repoId);
  if (!s) return 0;
  if (mode === "day") {
    return s.points.find((p) => p.date === date)?.value ?? 0;
  }
  // Monthly: sum of that month's daily deltas (net change over the month),
  // not the last day's value — the series is daily deltas, not cumulative
  // snapshots, so picking the last point would only show that single day's
  // change rather than the whole month's.
  const pts = s.points.filter((p) => p.date.startsWith(date));
  return pts.reduce((sum, p) => sum + p.value, 0);
}

// Anchors the mode-based table date to the selected range's end (filters.to)
// rather than today, so Daily/Monthly views default inside the selected range.
function defaultDateForMode(mode: TableMode, to: string): string {
  if (mode === "day") return to;
  if (mode === "month") return to.slice(0, 7);
  return "";
}

export default function RepositoryStatsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const { data: reposData } = useGetRepositories();

  const statParam = params.get("stat");
  const stat: StatKey = STAT_OPTIONS.some((o) => o.value === statParam)
    ? (statParam as StatKey)
    : "stars";
  const isClone = stat === "clones" || stat === "uniqueCloners";
  const gaugeMetric: Metric = isClone ? "stars" : (stat as Metric);

  const metricQuery = useGetMetricSeries({ ...filters, metric: gaugeMetric });
  const cloneQuery = useGetCloneSeries(filters);
  const activeQuery = isClone ? cloneQuery : metricQuery;

  // Daily series for each metric — used exclusively by the Current stats table
  // so mode/date filtering works on all columns regardless of chart interval.
  const tableBase = { ...filters, interval: "day" as Interval };
  const starsTableQuery = useGetMetricSeries({ ...tableBase, metric: "stars" });
  const forksTableQuery = useGetMetricSeries({ ...tableBase, metric: "forks" });
  const watchersTableQuery = useGetMetricSeries({
    ...tableBase,
    metric: "watchers",
  });
  const issuesTableQuery = useGetMetricSeries({
    ...tableBase,
    metric: "openIssues",
  });

  const chartSeries: ChartSeries[] = isClone
    ? transformClones(
        cloneQuery.data?.series ?? [],
        stat === "uniqueCloners" ? "uniques" : "count",
        filters.interval,
      )
    : toChartSeries(metricQuery.data?.series ?? []);

  const onChange = (updates: Record<string, string | number[] | null>) =>
    setParams(mergeParams(params, updates), { replace: true });

  const [tableMode, setTableMode] = useState<TableMode>("total");
  const [tableDate, setTableDate] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductSearch, setShowProductSearch] = useState(false);

  // Sum clone series per repo, filtered by tableMode/tableDate.
  const cloneTotals = useMemo(() => {
    const map = new Map<number, { count: number; uniques: number }>();
    for (const s of cloneQuery.data?.series ?? []) {
      let points = s.points;
      if (tableMode === "month" && tableDate) {
        points = s.points.filter((p) => p.date.startsWith(tableDate));
      } else if (tableMode === "day" && tableDate) {
        points = s.points.filter((p) => p.date === tableDate);
      }
      map.set(s.repoId, {
        count: points.reduce((acc, p) => acc + p.count, 0),
        uniques: points.reduce((acc, p) => acc + p.uniques, 0),
      });
    }
    return map;
  }, [cloneQuery.data, tableMode, tableDate]);

  const label = STAT_OPTIONS.find((o) => o.value === stat)?.label ?? "Stars";
  const repos = reposData?.repositories ?? [];

  const filteredRepos = repos.filter((r) => {
    if (filters.repos.length > 0 && !filters.repos.includes(r.id)) return false;
    if (
      productSearch &&
      !(r.productName || r.repoName)
        .toLowerCase()
        .includes(productSearch.toLowerCase())
    )
      return false;
    return true;
  });

  const repoPagination = usePagination(filteredRepos);

  return (
    <Box>
      <PageHeader
        title="Repository Stats"
        description="Stars, forks, watchers, open issues, and clone traffic over time for each tracked repository."
      />

      <FilterBar
        filters={filters}
        onChange={onChange}
        filterSlot={
          <>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Stat</InputLabel>
                <Select
                  value={stat}
                  label="Stat"
                  onChange={(e) => onChange({ stat: e.target.value })}
                >
                  {STAT_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Interval</InputLabel>
                <Select
                  value={filters.interval}
                  label="Interval"
                  onChange={(e) => onChange({ interval: e.target.value })}
                >
                  {INTERVAL_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </>
        }
      />

      <ChartCard
        title={`${label} over time`}
        subtitle="Repository stats and clone traffic per product"
        showTypeToggle={filters.interval !== "month"}
        defaultVariant={filters.interval === "month" ? "bar" : "line"}
      >
        {(v) => (
          <SeriesChart
            variant={filters.interval === "month" ? "bar" : v}
            series={chartSeries}
            isLoading={activeQuery.isLoading}
            isError={activeQuery.isError}
            onRetry={() => void activeQuery.refetch()}
          />
        )}
      </ChartCard>

      <Card sx={{ p: 2, mt: 2, overflowX: "auto" }}>
        {/* Card header: title left, time-mode controls right */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
            flexWrap: "wrap",
            gap: 1,
          }}
        >
          <Typography variant="h6" component="h3">
            Current stats
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {tableMode !== "total" && (
              <Box
                component="input"
                type={tableMode === "month" ? "month" : "date"}
                value={tableDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTableDate(e.target.value)
                }
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  px: 1,
                  py: 0.5,
                  fontSize: "0.8rem",
                  color: "text.primary",
                  bgcolor: "background.paper",
                  cursor: "pointer",
                  outline: "none",
                  "&:focus": { borderColor: "primary.main" },
                }}
              />
            )}
            <ToggleButtonGroup
              size="small"
              color="primary"
              value={tableMode}
              exclusive
              onChange={(_, v: TableMode | null) => {
                if (v) {
                  setTableMode(v);
                  setTableDate(defaultDateForMode(v, filters.to));
                }
              }}
            >
              <ToggleButton value="total">Total</ToggleButton>
              <ToggleButton value="month">Monthly</ToggleButton>
              <ToggleButton value="day">Daily</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        <Table size="small">
          <TableHead>
            <TableRow>
              {/* Product column with inline search — stays as input, no chip */}
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  Product
                  {!showProductSearch ? (
                    <Tooltip title="Filter by product">
                      <IconButton
                        size="small"
                        aria-label="Filter by product"
                        onClick={() => setShowProductSearch(true)}
                      >
                        <Search size={14} />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <>
                      <InputBase
                        autoFocus
                        placeholder="Filter…"
                        aria-label="Filter products"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setProductSearch("");
                            setShowProductSearch(false);
                          }
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
                          aria-label="Clear product filter"
                          onClick={() => {
                            setProductSearch("");
                            setShowProductSearch(false);
                          }}
                        >
                          <X size={14} />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              </TableCell>
              <TableCell align="right">Stars</TableCell>
              <TableCell align="right">Forks</TableCell>
              <TableCell align="right">Watchers</TableCell>
              <TableCell align="right">Open Issues</TableCell>
              <TableCell align="right">Clones</TableCell>
              <TableCell align="right">
                <Tooltip
                  title="Unique cloners summed per day. Same person on different days counts separately."
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
                    Unique Cloners
                    <Info size={13} style={{ opacity: 0.5 }} />
                  </Box>
                </Tooltip>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repoPagination.paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyState
                    title="No products match your search"
                    minHeight={120}
                  />
                </TableCell>
              </TableRow>
            ) : (
              repoPagination.paged.map((r) => {
                const stars =
                  getSeriesValue(
                    starsTableQuery.data?.series,
                    r.id,
                    tableMode,
                    tableDate,
                  ) ??
                  r.latestSnapshot?.stargazersCount ??
                  0;
                const forks =
                  getSeriesValue(
                    forksTableQuery.data?.series,
                    r.id,
                    tableMode,
                    tableDate,
                  ) ??
                  r.latestSnapshot?.forksCount ??
                  0;
                const watchers =
                  getSeriesValue(
                    watchersTableQuery.data?.series,
                    r.id,
                    tableMode,
                    tableDate,
                  ) ??
                  r.latestSnapshot?.watchersCount ??
                  0;
                const issues =
                  getSeriesValue(
                    issuesTableQuery.data?.series,
                    r.id,
                    tableMode,
                    tableDate,
                  ) ??
                  r.latestSnapshot?.openIssuesCount ??
                  0;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.productName || r.repoName}</TableCell>
                    <TableCell align="right">{formatCompact(stars)}</TableCell>
                    <TableCell align="right">{formatCompact(forks)}</TableCell>
                    <TableCell align="right">
                      {formatCompact(watchers)}
                    </TableCell>
                    <TableCell align="right">{formatCompact(issues)}</TableCell>
                    <TableCell align="right">
                      {formatCompact(cloneTotals.get(r.id)?.count ?? 0)}
                    </TableCell>
                    <TableCell align="right">
                      {formatCompact(cloneTotals.get(r.id)?.uniques ?? 0)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={repoPagination.count}
          page={repoPagination.page}
          onPageChange={repoPagination.onPageChange}
          rowsPerPage={repoPagination.rowsPerPage}
          onRowsPerPageChange={repoPagination.onRowsPerPageChange}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          showFirstButton
          showLastButton
        />
      </Card>
    </Box>
  );
}
