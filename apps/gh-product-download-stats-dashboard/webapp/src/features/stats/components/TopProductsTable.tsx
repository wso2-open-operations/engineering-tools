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
  Card,
  Typography,
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Skeleton,
} from "@wso2/oxygen-ui";
import { type JSX } from "react";
import { useNavigate } from "react-router";
import EmptyState from "@components/empty-state/EmptyState";
import ErrorState from "@components/error-state/ErrorState";
import { formatCompact } from "@utils/format";
import { type TopProduct } from "@features/stats/types/stats";

const TOP_N = 6;

interface TopProductsTableProps {
  products?: TopProduct[];
  isLoading?: boolean;
  isError?: boolean;
}

export default function TopProductsTable({
  products,
  isLoading,
  isError,
}: TopProductsTableProps): JSX.Element {
  const navigate = useNavigate();

  const top = [...(products ?? [])]
    .sort((a, b) => b.totalDownloads - a.totalDownloads)
    .slice(0, TOP_N);

  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
        Top Products (Downloads)
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {Array.from({ length: TOP_N }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={36} />
          ))}
        </Box>
      ) : isError ? (
        <ErrorState minHeight={160} />
      ) : top.length === 0 ? (
        <EmptyState title="No tracked products yet" minHeight={160} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell align="right">Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {top.map((p) => (
              <TableRow
                key={p.repoId}
                hover
                role="button"
                tabIndex={0}
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/downloads?repos=${p.repoId}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/downloads?repos=${p.repoId}`);
                  }
                }}
              >
                <TableCell>{p.productName || p.repoName}</TableCell>
                <TableCell align="right">
                  {formatCompact(p.totalDownloads)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
