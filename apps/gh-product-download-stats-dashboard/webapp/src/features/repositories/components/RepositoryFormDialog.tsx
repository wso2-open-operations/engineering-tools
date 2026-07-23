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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Button,
  Box,
  Alert,
  CircularProgress,
} from "@wso2/oxygen-ui";
import { type JSX, useState } from "react";
import { useCreateRepository } from "@features/repositories/api/useCreateRepository";
import { useUpdateRepository } from "@features/repositories/api/useUpdateRepository";
import { type Repository } from "@features/stats/types/stats";

const MIN_LOADING_MS = 1000;

interface RepositoryFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  repository?: Repository;
  onClose: () => void;
}

function parsePrefixes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Create/edit dialog for a tracked repository. In edit mode the org/repo identity
// is read-only (the backend PATCH only updates productName/assetPrefixes/isActive).
export default function RepositoryFormDialog({
  open,
  mode,
  repository,
  onClose,
}: RepositoryFormDialogProps): JSX.Element {
  const createMutation = useCreateRepository();
  const updateMutation = useUpdateRepository();

  const [orgName, setOrgName] = useState(repository?.orgName ?? "");
  const [repoName, setRepoName] = useState(repository?.repoName ?? "");
  const [productName, setProductName] = useState(repository?.productName ?? "");
  const [assetPrefixes, setAssetPrefixes] = useState(
    (repository?.assetPrefixes ?? []).join(", "),
  );
  const [isActive, setIsActive] = useState(repository?.isActive ?? true);
  const [trackPackages, setTrackPackages] = useState(
    repository?.trackPackages ?? false,
  );
  const [submitting, setSubmitting] = useState(false);

  const isEdit = mode === "edit";
  const error = createMutation.error || updateMutation.error;
  const canSubmit = isEdit || (orgName.trim() !== "" && repoName.trim() !== "");

  const handleSubmit = (): void => {
    if (submitting) return;
    setSubmitting(true);

    // Show spinner for 1s first, then fire the mutation and close on success.
    setTimeout(() => {
      const onSuccess = () => {
        setSubmitting(false);
        onClose();
      };
      const onError = () => setSubmitting(false);

      if (isEdit && repository) {
        updateMutation.mutate(
          {
            id: repository.id,
            update: {
              productName: productName.trim() || null,
              assetPrefixes: parsePrefixes(assetPrefixes),
              isActive,
              trackPackages,
            },
          },
          { onSuccess, onError },
        );
      } else {
        createMutation.mutate(
          {
            orgName: orgName.trim(),
            repoName: repoName.trim(),
            productName: productName.trim() || null,
            assetPrefixes: parsePrefixes(assetPrefixes),
            isActive,
            trackPackages,
          },
          { onSuccess, onError },
        );
      }
    }, MIN_LOADING_MS);
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? "Edit repository" : "Add tracked repository"}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          {error && (
            <Alert severity="error">
              {isEdit
                ? "Failed to update the repository."
                : "Failed to add the repository."}
            </Alert>
          )}
          <TextField
            label="Org name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={isEdit}
            required={!isEdit}
            fullWidth
            helperText="GitHub org, also used as the owner path segment (e.g. wso2)."
          />
          <TextField
            label="Repo name"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            disabled={isEdit}
            required={!isEdit}
            fullWidth
          />
          <TextField
            label="Product name"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            fullWidth
            helperText="Display name shown on the dashboard (optional)."
          />
          <TextField
            label="Asset prefixes"
            value={assetPrefixes}
            onChange={(e) => setAssetPrefixes(e.target.value)}
            fullWidth
            helperText="Comma-separated release-asset name prefixes to track. Leave empty for all assets."
          />
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={submitting}
              />
            }
            label="Active (synced daily)"
          />
          <FormControlLabel
            control={
              <Switch
                checked={trackPackages}
                onChange={(e) => setTrackPackages(e.target.checked)}
                disabled={submitting}
              />
            }
            label="Track packages (GitHub container packages, scraped nightly)"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {isEdit ? "Save" : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
