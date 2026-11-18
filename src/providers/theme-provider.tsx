"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type ThemeContextValue = {
  /** Theme currently shown. */
  theme: Theme;
  /** Toggle between the light and dark colour schemes. */
  toggleTheme: () => void;
};

const STORAGE_KEY = "malihub-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

function getPreferredTheme(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** MaliHub supports an explicit, persistent theme choice with system preference as its default. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const sync = () => {
      const next = getPreferredTheme();
      setTheme(next);
      applyTheme(next);
    };
    sync();

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemChange = () => {
      if (!window.localStorage.getItem(STORAGE_KEY)) sync();
    };
    query.addEventListener("change", handleSystemChange);
    return () => query.removeEventListener("change", handleSystemChange);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  };

  const value = useMemo<ThemeContextValue>(() => ({ theme, toggleTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
