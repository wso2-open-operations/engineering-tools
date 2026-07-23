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
  AcrylicOrangeTheme,
  AcrylicPurpleTheme,
  WSO2Theme,
  ClassicTheme,
  HighContrastTheme,
} from "@wso2/oxygen-ui";
import type { OxygenThemeType as OxygenTheme } from "@wso2/oxygen-ui";

// Every Oxygen UI theme the dashboard exposes, keyed by the value used in
// window.config.GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_THEME and persisted as the runtime choice.
// Single source of truth for both the build-time default and the theme picker.
// The "wso2" key maps to Oxygen's WSO2Theme (formerly ChoreoTheme) — the app's
// key/label follow Oxygen's naming. See LEGACY_THEME_KEYS for the migration of
// the old "choreo" key.
export const THEMES = {
  acrylicOrange: AcrylicOrangeTheme,
  acrylicPurple: AcrylicPurpleTheme,
  wso2: WSO2Theme,
  classic: ClassicTheme,
  highContrast: HighContrastTheme,
} satisfies Record<string, OxygenTheme>;

// Renamed theme keys, so a persisted/configured old value still resolves.
// "choreo" was this theme's key before it was renamed to match WSO2Theme.
const LEGACY_THEME_KEYS: Record<string, ThemeKey> = {
  choreo: "wso2",
};

export type ThemeKey = keyof typeof THEMES;

export const DEFAULT_THEME_KEY: ThemeKey = "acrylicOrange";

// Human labels for the theme dropdown, in display order.
export const THEME_OPTIONS: { key: ThemeKey; label: string }[] = [
  { key: "acrylicOrange", label: "Acrylic Orange" },
  { key: "acrylicPurple", label: "Acrylic Purple" },
  { key: "wso2", label: "WSO2" },
  { key: "classic", label: "Classic" },
  { key: "highContrast", label: "High Contrast" },
];

// True when value is a known theme key. Uses Object.hasOwn (not `in`) so an
// inherited Object.prototype name — "toString", "constructor", etc. — from a
// tampered localStorage/window.config value can't be mistaken for a theme key.
export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && Object.hasOwn(THEMES, value);
}

// Normalize a stored/configured key, mapping renamed legacy keys (e.g. the old
// "choreo") to their current key. Returns undefined for unknown values.
export function normalizeThemeKey(value: unknown): ThemeKey | undefined {
  if (isThemeKey(value)) return value;
  if (typeof value === "string" && Object.hasOwn(LEGACY_THEME_KEYS, value)) {
    return LEGACY_THEME_KEYS[value];
  }
  return undefined;
}

// Resolve a (possibly invalid/legacy) key to a concrete Oxygen theme.
export function resolveTheme(key: string | undefined): OxygenTheme {
  return THEMES[normalizeThemeKey(key) ?? DEFAULT_THEME_KEY];
}

// Build-time default theme key from window.config (the runtime picker layers a
// persisted user choice on top of this).
export function configThemeKey(): ThemeKey {
  const fromConfig = window.config?.GH_PRODUCT_DOWNLOAD_STATS_DASHBOARD_THEME;
  return normalizeThemeKey(fromConfig) ?? DEFAULT_THEME_KEY;
}
