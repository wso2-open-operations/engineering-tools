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
  AppShell,
  Box,
  LinearProgress,
  Typography,
  useAppShell,
} from "@wso2/oxygen-ui";
import { type JSX, Suspense, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useAsgardeo } from "@asgardeo/react";
import Header from "@components/header/Header";
import SideBar from "@components/side-nav-bar/SideBar";
import PageSkeleton from "@components/skeleton/PageSkeleton";
import IdleTimeoutProvider from "@context/IdleTimeoutProvider";

// Main authenticated shell: top navbar, collapsible sidebar, and routed content.
//
// Auth initialisation and routed content use different loading treatments:
// until the Asgardeo SDK settles (`hasInitialized`), a centered "Loading…"
// screen is shown and the sidebar stays hidden — this avoids briefly flashing
// the full dashboard shell/nav for a signed-out visitor right before they're
// redirected to the IdP. Once initialised, lazy route chunks fall back to a
// content-shaped PageSkeleton instead, since that transition stays in-app.
export default function AppLayout(): JSX.Element {
  const { state, actions } = useAppShell({ initialCollapsed: false });
  const { isLoading: isAuthLoading, isSignedIn } = useAsgardeo();

  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (!isAuthLoading) {
      // One-way init latch: flips once auth settles and stays there.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional init latch
      setHasInitialized(true);
    }
  }, [isAuthLoading]);

  return (
    <IdleTimeoutProvider>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          overflow: "hidden",
        }}
      >
        <AppShell sx={{ flex: 1, minHeight: 0 }}>
          <AppShell.Navbar>
            <Header
              onToggleSidebar={actions.toggleSidebar}
              collapsed={state.sidebarCollapsed}
            />
          </AppShell.Navbar>

          {hasInitialized && isSignedIn && (
            <AppShell.Sidebar>
              <SideBar collapsed={state.sidebarCollapsed} />
            </AppShell.Sidebar>
          )}

          <AppShell.Main>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                ...(hasInitialized ? { p: 3 } : { p: 0 }),
              }}
            >
              {!hasInitialized ? (
                <Box
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <LinearProgress
                    color="inherit"
                    sx={{ color: "primary.main", width: "80%", maxWidth: 400, height: 4 }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    Loading…
                  </Typography>
                </Box>
              ) : (
                <Suspense fallback={<PageSkeleton />}>
                  <Outlet />
                </Suspense>
              )}
            </Box>
          </AppShell.Main>
        </AppShell>
      </Box>
    </IdleTimeoutProvider>
  );
}
