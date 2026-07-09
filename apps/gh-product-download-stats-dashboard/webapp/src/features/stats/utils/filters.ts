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

import { DEFAULT_RANGE_DAYS } from "@constants/common";
import { type ChartSeries } from "@components/charts/chartTypes";
import {
  type Interval,
  type Metric,
  type RepoSeries,
} from "@features/stats/types/stats";

export interface StatsFilters {
  from: string;
  to: string;
  repos: number[];
  interval: Interval;
  metric: Metric;
  version: string | null;
}

const VALID_METRICS: Metric[] = ["stars", "forks", "watchers", "openIssues"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Default inclusive range: last DEFAULT_RANGE_DAYS days ending today (UTC).
// Used only by OverviewPage's "last 30 days" hero chart.
export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - DEFAULT_RANGE_DAYS);
  return { from: isoDate(from), to: isoDate(to) };
}

// Default inclusive range for the analytics pages (Downloads, Versions,
// Repository Stats): from the start of tracked history through today (UTC).
export function defaultAnalyticsRange(): { from: string; to: string } {
  return { from: "2024-10-01", to: isoDate(new Date()) };
}

// Parses dashboard filters from URL search params, applying defaults.
export function parseFilters(params: URLSearchParams): StatsFilters {
  const def = defaultAnalyticsRange();
  const reposRaw = params.get("repos") ?? "";
  const repos = reposRaw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  const metricRaw = params.get("metric") as Metric | null;
  const metric: Metric =
    metricRaw && VALID_METRICS.includes(metricRaw) ? metricRaw : "stars";

  const intervalRaw = params.get("interval");
  const interval: Interval =
    intervalRaw === "month"
      ? "month"
      : intervalRaw === "cumulative"
        ? "cumulative"
        : "day";

  return {
    from: params.get("from") || def.from,
    to: params.get("to") || def.to,
    repos,
    interval,
    metric,
    version: params.get("version") || null,
  };
}

type ParamValue = string | number | number[] | null | undefined;

// Returns a new URLSearchParams with the given keys merged in. Empty arrays /
// null / undefined remove the key.
export function mergeParams(
  current: URLSearchParams,
  updates: Record<string, ParamValue>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || (Array.isArray(value) && value.length === 0) || value === "") {
      next.delete(key);
    } else if (Array.isArray(value)) {
      next.set(key, value.join(","));
    } else {
      next.set(key, String(value));
    }
  }
  return next;
}

// Builds the `repos`/`from`/`to`/`interval` query string for stats API calls.
export function seriesQueryString(filters: StatsFilters, withInterval = true): string {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  if (filters.repos.length > 0) params.set("repos", filters.repos.join(","));
  if (withInterval) params.set("interval", filters.interval);
  return params.toString();
}

// Maps backend RepoSeries to the generic chart series shape.
export function toChartSeries(series: RepoSeries[]): ChartSeries[] {
  return series.map((s) => ({
    key: `repo-${s.repoId}`,
    name: s.repoName,
    points: s.points.map((p) => ({ date: p.date, value: p.value })),
  }));
}

export interface PeriodSummary {
  total: number;
  avgPerPoint: number;
  peakDate: string | null;
  peakValue: number;
  minDate: string | null;
  minValue: number;
  pointCount: number;
}

// Aggregates the per-date totals (summed across series) into headline figures.
export function periodSummary(series: ChartSeries[]): PeriodSummary {
  const byDate = new Map<string, number>();
  for (const s of series) {
    for (const p of s.points) {
      byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.value);
    }
  }
  const entries = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return {
      total: 0,
      avgPerPoint: 0,
      peakDate: null,
      peakValue: 0,
      minDate: null,
      minValue: 0,
      pointCount: 0,
    };
  }
  let total = 0;
  let peak = { d: entries[0][0], v: entries[0][1] };
  let min = { d: entries[0][0], v: entries[0][1] };
  for (const [d, v] of entries) {
    total += v;
    if (v > peak.v) peak = { d, v };
    if (v < min.v) min = { d, v };
  }
  return {
    total,
    avgPerPoint: Math.round(total / entries.length),
    peakDate: peak.d,
    peakValue: peak.v,
    minDate: min.d,
    minValue: min.v,
    pointCount: entries.length,
  };
}

export interface DateMatrix {
  dates: string[];
  columns: { key: string; name: string }[];
  cell: (date: string, key: string) => number | undefined;
  totalForDate: (date: string) => number;
}

// Builds a date × series matrix (dates descending) for the data tables.
export function buildDateMatrix(series: ChartSeries[]): DateMatrix {
  const dateSet = new Set<string>();
  const map = new Map<string, Map<string, number>>();
  for (const s of series) {
    for (const p of s.points) {
      dateSet.add(p.date);
      let row = map.get(p.date);
      if (!row) {
        row = new Map();
        map.set(p.date, row);
      }
      row.set(s.key, p.value);
    }
  }
  const dates = [...dateSet].sort((a, b) => b.localeCompare(a));
  const columns = series.map((s) => ({ key: s.key, name: s.name }));
  return {
    dates,
    columns,
    cell: (date, key) => map.get(date)?.get(key),
    totalForDate: (date) => {
      let t = 0;
      const row = map.get(date);
      if (row) for (const v of row.values()) t += v;
      return t;
    },
  };
}
