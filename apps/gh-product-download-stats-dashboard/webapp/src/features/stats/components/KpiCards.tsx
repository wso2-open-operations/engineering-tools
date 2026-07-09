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

import { Box } from "@wso2/oxygen-ui";
import {
  Download,
  CalendarDays,
  Database,
  Boxes,
  Copy,
} from "@wso2/oxygen-ui-icons-react";
import { type JSX } from "react";
import { StatCard } from "@components/stat-card/StatCard";
import TrendIndicator from "@components/stat-card/TrendIndicator";
import { formatCompact, formatNumber } from "@utils/format";
import { type Summary } from "@features/stats/types/stats";

interface KpiCardsProps {
  summary?: Summary;
  isLoading?: boolean;
  isError?: boolean;
}

// The 5 Overview KPI tiles. Daily downloads is the hero metric (with a Δ% vs
// yesterday), per the design plan.
export default function KpiCards({
  summary,
  isLoading,
  isError,
}: KpiCardsProps): JSX.Element {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "1fr",
          sm: "1fr 1fr",
          md: "repeat(5, 1fr)",
        },
        mb: 2,
      }}
    >
      <StatCard
        label="Yesterday's Downloads"
        value={formatCompact(summary?.todayDownloads ?? 0)}
        icon={<Download size={20} />}
        iconColor="success"
        trend={<TrendIndicator pct={summary?.todayDeltaPct ?? null} />}
        tooltipText="New downloads on the latest sync day, across all products."
        isLoading={isLoading}
        isError={isError}
      />
      <StatCard
        label="This Month's Downloads"
        value={formatCompact(summary?.monthDownloads ?? 0)}
        icon={<CalendarDays size={20} />}
        iconColor="primary"
        isLoading={isLoading}
        isError={isError}
      />
      <StatCard
        label="Total Downloads"
        value={formatCompact(summary?.totalDownloads ?? 0)}
        icon={<Database size={20} />}
        iconColor="info"
        tooltipText="Sum of the latest cumulative download count across all tracked products."
        isLoading={isLoading}
        isError={isError}
      />
      <StatCard
        label="Products Tracked"
        value={formatNumber(summary?.trackedRepositories ?? 0)}
        icon={<Boxes size={20} />}
        iconColor="secondary"
        isLoading={isLoading}
        isError={isError}
      />
      <StatCard
        label="Clones (14d)"
        value={formatCompact(summary?.totalClonesLast14d ?? 0)}
        icon={<Copy size={20} />}
        iconColor="warning"
        tooltipText="Total git clones across all products in the last 14 days."
        isLoading={isLoading}
        isError={isError}
      />
    </Box>
  );
}
