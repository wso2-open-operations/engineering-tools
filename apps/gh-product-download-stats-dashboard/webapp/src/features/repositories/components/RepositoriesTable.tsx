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
  Box,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TablePagination,
  Chip,
  IconButton,
  Skeleton,
  Switch,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
} from "@wso2/oxygen-ui";
import { Pencil } from "@wso2/oxygen-ui-icons-react";
import { type JSX, useState } from "react";
import { usePagination } from "@hooks/usePagination";
import { ROWS_PER_PAGE_OPTIONS } from "@constants/tableConstants";
import EmptyState from "@components/empty-state/EmptyState";
import ErrorState from "@components/error-state/ErrorState";
import { type Repository } from "@features/stats/types/stats";
import { useDeactivateRepository } from "@features/repositories/api/useDeactivateRepository";
import { useUpdateRepository } from "@features/repositories/api/useUpdateRepository";

const MIN_LOADING_MS = 1000;

interface RepositoriesTableProps {
  repositories?: Repository[];
  isLoading?: boolean;
  isError?: boolean;
  onEdit: (repository: Repository) => void;
}

type ToggleKind = "isActive" | "trackPackages";

interface ConfirmState {
  repo: Repository;
  kind: ToggleKind;
  nextValue: boolean;
}

export default function RepositoriesTable({
  repositories,
  isLoading,
  isError,
  onEdit,
}: RepositoriesTableProps): JSX.Element {
  const deactivate = useDeactivateRepository();
  const update = useUpdateRepository();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirming, setConfirming] = useState(false);

  const pendingId =
    (deactivate.isPending && deactivate.variables) ||
    (update.isPending && update.variables?.id) ||
    null;
  const pagination = usePagination(repositories ?? []);

  const handleToggle = (repo: Repository) => {
    setConfirm({ repo, kind: "isActive", nextValue: !repo.isActive });
  };

  const handleToggleTrackPackages = (repo: Repository) => {
    setConfirm({ repo, kind: "trackPackages", nextValue: !repo.trackPackages });
  };

  const handleConfirm = () => {
    if (!confirm || confirming) return;
    const snapshot = confirm;
    setConfirming(true);

    // Show spinner for 1s first, then fire the mutation. Close only on success;
    // on error, keep the dialog open with the failure visible so the admin can retry.
    setTimeout(() => {
      const onSuccess = () => {
        setConfirm(null);
        setConfirming(false);
      };
      const onError = () => setConfirming(false);
      if (snapshot.kind === "trackPackages") {
        update.mutate(
          { id: snapshot.repo.id, update: { trackPackages: snapshot.nextValue } },
          { onSuccess, onError },
        );
      } else if (snapshot.nextValue) {
        update.mutate({ id: snapshot.repo.id, update: { isActive: true } }, { onSuccess, onError });
      } else {
        deactivate.mutate(snapshot.repo.id, { onSuccess, onError });
      }
    }, MIN_LOADING_MS);
  };

  const toggleError = update.error || deactivate.error;

  if (isLoading) {
    return (
      <Card sx={{ p: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={40} />
          ))}
        </Box>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card sx={{ p: 2 }}>
        <ErrorState minHeight={160} />
      </Card>
    );
  }
  if (!repositories || repositories.length === 0) {
    return (
      <Card sx={{ p: 2 }}>
        <EmptyState
          title="No tracked repositories"
          description="Add a repository to start collecting daily stats."
          minHeight={160}
        />
      </Card>
    );
  }

  const confirmRepoLabel = confirm
    ? confirm.repo.productName || confirm.repo.repoName
    : "";

  return (
    <>
      <Card sx={{ p: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Repository</TableCell>
              <TableCell>Organization</TableCell>
              <TableCell>Prefixes</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Packages</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pagination.paged.map((repo) => (
              <TableRow
                key={repo.id}
                sx={!repo.isActive ? { opacity: 0.5 } : undefined}
              >
                <TableCell>{repo.productName || "—"}</TableCell>
                <TableCell>{repo.repoName}</TableCell>
                <TableCell>{repo.orgName}</TableCell>
                <TableCell>
                  {repo.assetPrefixes.length > 0
                    ? repo.assetPrefixes.join(", ")
                    : "All"}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={repo.isActive ? "Active" : "Inactive"}
                    color={repo.isActive ? "success" : "default"}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip
                    title={
                      repo.trackPackages
                        ? "Stop scraping GitHub package downloads for this repo"
                        : "Start scraping GitHub package downloads for this repo"
                    }
                  >
                    <Switch
                      size="small"
                      checked={repo.trackPackages}
                      disabled={pendingId === repo.id}
                      onChange={() => handleToggleTrackPackages(repo)}
                      color="success"
                      inputProps={{
                        "aria-label": repo.trackPackages
                          ? "Stop tracking packages"
                          : "Start tracking packages",
                      }}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.5,
                      justifyContent: "flex-end",
                      alignItems: "center",
                    }}
                  >
                    <Tooltip title={repo.isActive ? "Deactivate" : "Activate"}>
                      <Switch
                        size="small"
                        checked={repo.isActive}
                        disabled={pendingId === repo.id}
                        onChange={() => handleToggle(repo)}
                        color="success"
                        inputProps={{
                          "aria-label": repo.isActive
                            ? "Deactivate repository"
                            : "Activate repository",
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => onEdit(repo)}>
                        <Pencil size={16} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
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
      </Card>

      <Dialog
        open={confirm !== null}
        onClose={() => { if (!confirming) setConfirm(null); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {confirm?.kind === "trackPackages"
            ? confirm.nextValue
              ? "Enable package tracking?"
              : "Disable package tracking?"
            : confirm?.nextValue
              ? "Activate repository?"
              : "Deactivate repository?"}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {toggleError && (
              <Alert severity="error">
                {confirm?.kind === "trackPackages"
                  ? "Failed to update package tracking."
                  : confirm?.nextValue
                    ? "Failed to activate the repository."
                    : "Failed to deactivate the repository."}
              </Alert>
            )}
            <Typography color="text.secondary">
              {confirm?.kind === "trackPackages"
                ? confirm.nextValue
                  ? `Start tracking packages for "${confirmRepoLabel}"? web scraper will begin covering it on the next cron-job.`
                  : `Stop tracking packages for "${confirmRepoLabel}"? web scraper will no longer cover it from the next cron-job onward.`
                : confirm?.nextValue
                  ? `Activate "${confirmRepoLabel}"? It will start appearing in charts, stats, and tables.`
                  : `Deactivate "${confirmRepoLabel}"? It will be hidden from all charts, stats, and tables.`}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            onClick={() => setConfirm(null)}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color={confirm?.nextValue ? "success" : "error"}
            onClick={handleConfirm}
            disabled={confirming}
            startIcon={confirming ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {confirm?.kind === "trackPackages"
              ? confirm.nextValue
                ? "Enable"
                : "Disable"
              : confirm?.nextValue
                ? "Activate"
                : "Deactivate"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
