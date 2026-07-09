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

/* eslint-disable react-refresh/only-export-components -- Provider + its hook are colocated per the repo's context idiom (fast-refresh DX only) */

import { GlobalStyles, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  configThemeKey,
  isThemeKey,
  resolveTheme,
  THEME_OPTIONS,
  type ThemeKey,
} from "@config/themeConfig";

const STORAGE_KEY = "ghstats.theme";

interface ThemePreferenceContextValue {
  themeKey: ThemeKey;
  setThemeKey: (next: ThemeKey) => void;
  options: typeof THEME_OPTIONS;
}

const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

// Initial theme key: a saved user choice wins, else the window.config default.
function readInitial(): ThemeKey {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeKey(saved)) return saved;
  } catch {
    /* localStorage may be unavailable — fall back to the config default */
  }
  return configThemeKey();
}

// Owns the runtime palette selection: holds the chosen key in state so the picker
// can switch live, persists it to localStorage, and wraps children in
// OxygenUIThemeProvider with the resolved theme. (Light/dark is orthogonal — that
// is the ColorSchemeToggle.)
export function ThemePreferenceProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readInitial());

  const theme = useMemo(() => resolveTheme(themeKey), [themeKey]);

  const setThemeKey = useCallback((next: ThemeKey): void => {
    setThemeKeyState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore — the in-memory choice still applies for this session */
    }
  }, []);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({ themeKey, setThemeKey, options: THEME_OPTIONS }),
    [themeKey, setThemeKey],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      <OxygenUIThemeProvider theme={theme}>
        {/* Reserves the vertical scrollbar's gutter permanently, so a small
            content-height change (e.g. a table's empty-search state being a
            few px taller/shorter than the rows it replaces) can't cross the
            scroll threshold and toggle the scrollbar on/off. On non-overlay
            scrollbars (Windows/Linux, or macOS set to always-show) that
            toggle shifts every right-anchored element on the page — e.g. a
            table's pagination controls — sideways by the scrollbar's width. */}
        <GlobalStyles styles={{ html: { scrollbarGutter: "stable" } }} />
        {children}
      </OxygenUIThemeProvider>
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error(
      "useThemePreference must be used within a ThemePreferenceProvider",
    );
  }
  return ctx;
}
