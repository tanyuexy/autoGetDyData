"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  APP_UI_THEME_STORAGE_KEY,
  type AppUiTheme,
  buildIntercomAntdTheme,
  buildVoltagentAntdTheme,
} from "@/lib/appUiTheme";

interface UIThemeContextValue {
  theme: AppUiTheme;
  setTheme: (t: AppUiTheme) => void;
  toggleTheme: () => void;
}

const UIThemeContext = createContext<UIThemeContextValue | null>(null);

export function readStoredTheme(): AppUiTheme {
  if (typeof window === "undefined") return "intercom";
  try {
    const raw = window.localStorage.getItem(APP_UI_THEME_STORAGE_KEY);
    if (raw === "voltagent") return "voltagent";
  } catch {
    /* ignore */
  }
  return "intercom";
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppUiTheme>("intercom");

  useLayoutEffect(() => {
    const t = readStoredTheme();
    setThemeState(t);
    document.documentElement.setAttribute("data-ui-theme", t);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-ui-theme", theme);
  }, [theme]);

  /** 其他标签页改 localStorage 时同步 */
  useLayoutEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== APP_UI_THEME_STORAGE_KEY) return;
      const t = e.newValue === "voltagent" ? "voltagent" : "intercom";
      setThemeState(t);
      document.documentElement.setAttribute("data-ui-theme", t);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((t: AppUiTheme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(APP_UI_THEME_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-ui-theme", t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "intercom" ? "voltagent" : "intercom");
  }, [theme, setTheme]);

  const antdTheme = useMemo(
    () => (theme === "voltagent" ? buildVoltagentAntdTheme() : buildIntercomAntdTheme()),
    [theme]
  );

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return (
    <UIThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        <App>{children}</App>
      </ConfigProvider>
    </UIThemeContext.Provider>
  );
}

export function useAppUiTheme() {
  const v = useContext(UIThemeContext);
  if (!v) {
    throw new Error("useAppUiTheme must be used within AppThemeProvider");
  }
  return v;
}
