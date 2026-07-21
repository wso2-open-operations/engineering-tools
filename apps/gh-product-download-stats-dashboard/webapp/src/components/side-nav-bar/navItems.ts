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
  LayoutDashboard,
  Download,
  Package,
  Boxes,
  Star,
  Settings,
} from "@wso2/oxygen-ui-icons-react";
import { type ComponentType } from "react";
import { ROUTES } from "@constants/common";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number }>;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", path: ROUTES.OVERVIEW, icon: LayoutDashboard },
  { id: "downloads", label: "Downloads", path: ROUTES.DOWNLOADS, icon: Download },
  { id: "versions", label: "Versions", path: ROUTES.VERSIONS, icon: Package },
  { id: "packages", label: "Packages", path: ROUTES.PACKAGES, icon: Boxes },
  { id: "github-stats", label: "Repository Stats", path: ROUTES.GITHUB_STATS, icon: Star },
  { id: "admin", label: "Admin", path: ROUTES.ADMIN, icon: Settings, adminOnly: true },
];
