"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  /** Resolved theme currently shown (always follows the device setting). */
  theme: Theme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/**
 * MaliHub follows the device's light/dark setting. The colour tokens switch via
 * CSS (`prefers-color-scheme`) so there is no flash; this provider only keeps
 * the `dark` class and `color-scheme` in sync for `dark:` utilities and native
 * controls, and updates live when the device setting changes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      const next: Theme = query.matches ? "light" : "dark";
      setTheme(next);
      applyTheme(next);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
