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
  TablePagination,
  Chip,
  Skeleton,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
} from "@wso2/oxygen-ui";
import { CalendarDays, X } from "@wso2/oxygen-ui-icons-react";
import { type JSX, useRef, useState } from "react";
import { usePagination } from "@hooks/usePagination";
import { ROWS_PER_PAGE_OPTIONS } from "@constants/tableConstants";
import EmptyState from "@components/empty-state/EmptyState";
import ErrorState from "@components/error-state/ErrorState";
import { formatDateTime } from "@utils/format";
import { useGetSyncLogs } from "@features/repositories/api/useGetSyncLogs";

const STATUS_COLOR: Record<
  string,
  "success" | "warning" | "error" | "info" | "default"
> = {
  SUCCESS: "success",
  PARTIAL_FAILURE: "warning",
  FAILED: "error",
  STARTED: "info",
};

const STATUS_OPTIONS = ["SUCCESS", "PARTIAL_FAILURE", "FAILED", "STARTED"];

const SOURCE_LABEL: Record<string, string> = {
  DB_SYNC: "DB Sync",
  PACKAGE_SCRAPE: "Scraper Sync",
};

const SOURCE_OPTIONS = ["DB_SYNC", "PACKAGE_SCRAPE"];

export default function SyncLogsTable(): JSX.Element {
  const { data, isLoading, isError } = useGetSyncLogs(100);
  const logs = data?.logs ?? [];

  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startedFilter, setStartedFilter] = useState("");
  const [completedFilter, setCompletedFilter] = useState("");

  const startedInputRef = useRef<HTMLInputElement>(null);
  const completedInputRef = useRef<HTMLInputElement>(null);

  const filtered = logs.filter((log) => {
    if (sourceFilter && log.source !== sourceFilter) return false;
    if (statusFilter && log.status !== statusFilter) return false;
    if (startedFilter && !log.startedAt?.startsWith(startedFilter))
      return false;
    if (completedFilter && !log.completedAt?.startsWith(completedFilter))
      return false;
    return true;
  });

  const pagination = usePagination(filtered);

  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
        Sync &amp; scrape history
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={36} />
          ))}
        </Box>
      ) : isError ? (
        <ErrorState minHeight={140} />
      ) : logs.length === 0 ? (
        <EmptyState
          title="No sync or scrape runs recorded yet"
          minHeight={140}
        />
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                {/* Source filter — inline select */}
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    Source
                    <Select
                      size="small"
                      displayEmpty
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      sx={{
                        fontSize: "0.75rem",
                        height: 24,
                        ml: 0.5,
                        "& .MuiSelect-select": { py: "2px", px: "8px" },
                      }}
                    >
                      <MenuItem value="">All</MenuItem>
                      {SOURCE_OPTIONS.map((s) => (
                        <MenuItem key={s} value={s} sx={{ fontSize: "0.8rem" }}>
                          {SOURCE_LABEL[s]}
                        </MenuItem>
                      ))}
                    </Select>
                  </Box>
                </TableCell>

                {/* Status filter — inline select */}
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    Status
                    <Select
                      size="small"
                      displayEmpty
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      sx={{
                        fontSize: "0.75rem",
                        height: 24,
                        ml: 0.5,
                        "& .MuiSelect-select": { py: "2px", px: "8px" },
                      }}
                    >
                      <MenuItem value="">All</MenuItem>
                      {STATUS_OPTIONS.map((s) => (
                        <MenuItem key={s} value={s} sx={{ fontSize: "0.8rem" }}>
                          {s}
                        </MenuItem>
                      ))}
                    </Select>
                  </Box>
                </TableCell>

                <TableCell align="right">Synced</TableCell>
                <TableCell align="right">Failed</TableCell>

                {/* Started date filter */}
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    Started
                    <Tooltip
                      title={startedFilter ? "Change date" : "Filter by date"}
                    >
                      <Box
                        sx={{ position: "relative", display: "inline-flex" }}
                      >
                        <input
                          ref={startedInputRef}
                          type="date"
                          aria-hidden="true"
                          tabIndex={-1}
                          value={startedFilter}
                          onChange={(e) => setStartedFilter(e.target.value)}
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: 0,
                            pointerEvents: "none",
                            width: "100%",
                            height: "100%",
                          }}
                        />
                        <IconButton
                          size="small"
                          aria-label={
                            startedFilter
                              ? "Change started date filter"
                              : "Filter by started date"
                          }
                          onClick={() => startedInputRef.current?.showPicker()}
                        >
                          <CalendarDays size={14} />
                        </IconButton>
                      </Box>
                    </Tooltip>
                    {startedFilter && (
                      <Tooltip title="Clear">
                        <IconButton
                          size="small"
                          onClick={() => setStartedFilter("")}
                        >
                          <X size={12} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>

                {/* Completed date filter */}
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    Completed
                    <Tooltip
                      title={completedFilter ? "Change date" : "Filter by date"}
                    >
                      <Box
                        sx={{ position: "relative", display: "inline-flex" }}
                      >
                        <input
                          ref={completedInputRef}
                          type="date"
                          aria-hidden="true"
                          tabIndex={-1}
                          value={completedFilter}
                          onChange={(e) => setCompletedFilter(e.target.value)}
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: 0,
                            pointerEvents: "none",
                            width: "100%",
                            height: "100%",
                          }}
                        />
                        <IconButton
                          size="small"
                          aria-label={
                            completedFilter
                              ? "Change completed date filter"
                              : "Filter by completed date"
                          }
                          onClick={() =>
                            completedInputRef.current?.showPicker()
                          }
                        >
                          <CalendarDays size={14} />
                        </IconButton>
                      </Box>
                    </Tooltip>
                    {completedFilter && (
                      <Tooltip title="Clear">
                        <IconButton
                          size="small"
                          onClick={() => setCompletedFilter("")}
                        >
                          <X size={12} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>

                <TableCell>Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    align="center"
                    sx={{ py: 3, color: "text.secondary" }}
                  >
                    No results match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                pagination.paged.map((log) => (
                  <TableRow key={`${log.source}-${log.id}`}>
                    <TableCell>
                      {SOURCE_LABEL[log.source] ?? log.source}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={log.status}
                        sx={{ fontSize: "0.7rem", fontWeight: 500, pt: 0.2 }}
                        color={STATUS_COLOR[log.status] ?? "default"}
                      />
                    </TableCell>
                    <TableCell align="right">{log.reposSynced}</TableCell>
                    <TableCell align="right">{log.reposFailed}</TableCell>
                    <TableCell>{formatDateTime(log.startedAt)}</TableCell>
                    <TableCell>{formatDateTime(log.completedAt)}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={log.errorMessage ?? ""}
                    >
                      {log.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={pagination.count}
            page={pagination.page}
            onPageChange={pagination.onPageChange}
            rowsPerPage={pagination.rowsPerPage}
            onRowsPerPageChange={pagination.onRowsPerPageChange}
            rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            showFirstButton
            showLastButton
          />
        </>
      )}
    </Card>
  );
}
