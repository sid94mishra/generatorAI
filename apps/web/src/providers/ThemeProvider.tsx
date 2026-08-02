// ────────────────────────────────────────────────────────────────
// ThemeProvider — Dark/Light mode with system preference detection
// + orthogonal accent color (see themes/registry.ts).
// Applies `.dark`/`.light` class, `data-theme` and `data-accent` on
// <html>; the pre-hydration script in index.html mirrors this before
// first paint (keep both in sync).
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  THEME_STORAGE_KEY,
  getAccent,
} from '@generatorai/design-tokens';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  accent: string;
  setAccent: (accent: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = THEME_STORAGE_KEY;

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'system';
  } catch {
    // Private browsing / security settings can throw on localStorage access.
    return 'system';
  }
}

function storeTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Swallow QuotaExceededError / SecurityError in private mode.
  }
}

function getStoredAccent(): string {
  if (typeof window === 'undefined') return DEFAULT_ACCENT;
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    // Unknown ids (removed accents) fall back to the default.
    return stored && getAccent(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function storeAccent(accent: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Swallow QuotaExceededError / SecurityError in private mode.
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'dark' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme() || defaultTheme);
  const [accent, setAccentState] = useState<string>(() => getStoredAccent());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    const stored = getStoredTheme() || defaultTheme;
    return stored === 'system' ? getSystemTheme() : stored;
  });

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    // SSR-safe + private-browsing-safe (Phase 1, 1.21). See `storeTheme`.
    storeTheme(newTheme);
  }, []);

  const setAccent = useCallback((newAccent: string) => {
    const valid = getAccent(newAccent) ? newAccent : DEFAULT_ACCENT;
    setAccentState(valid);
    storeAccent(valid);
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    setResolvedTheme(resolved);

    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'system-theme');
    root.classList.add(resolved);
    if (theme === 'system') {
      root.classList.add('system-theme');
    }
    // Central hook for named themes (theme registry) — CSS keys on [data-theme].
    root.dataset.theme = theme;
  }, [theme]);

  // Apply accent attribute to <html> — CSS keys on [data-accent].
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(resolved);
      // Keep system-theme class since we're still in system mode
    };

    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}
