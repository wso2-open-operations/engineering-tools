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

import { Box, Typography, Button } from "@wso2/oxygen-ui";
import { Plus } from "@wso2/oxygen-ui-icons-react";
import { type JSX, useState } from "react";
import RepositoriesTable from "@features/repositories/components/RepositoriesTable";
import SyncLogsTable from "@features/repositories/components/SyncLogsTable";
import RepositoryFormDialog from "@features/repositories/components/RepositoryFormDialog";
import { useGetAdminRepositories } from "@features/repositories/api/useGetAdminRepositories";
import { type Repository } from "@features/stats/types/stats";

export default function AdminPage(): JSX.Element {
  const { data, isLoading, isError } = useGetAdminRepositories();
  const [dialog, setDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    repository?: Repository;
  }>({ open: false, mode: "create" });

  const openCreate = (): void => setDialog({ open: true, mode: "create" });
  const openEdit = (repository: Repository): void =>
    setDialog({ open: true, mode: "edit", repository });
  const closeDialog = (): void =>
    setDialog((d) => ({ ...d, open: false }));

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          mb: 2,
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4">Admin</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage tracked repositories and review DB sync and scraper job history.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={openCreate}
        >
          Add repository
        </Button>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <RepositoriesTable
          repositories={data?.repositories}
          isLoading={isLoading}
          isError={isError}
          onEdit={openEdit}
        />
        <SyncLogsTable />
      </Box>

      {dialog.open && (
        <RepositoryFormDialog
          open={dialog.open}
          mode={dialog.mode}
          repository={dialog.repository}
          onClose={closeDialog}
        />
      )}
    </Box>
  );
}
