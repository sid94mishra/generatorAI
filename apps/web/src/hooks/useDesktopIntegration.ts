// ────────────────────────────────────────────────────────────────
// useDesktopIntegration — binds the SPA to the Electron shell.
//
// Jobs, all no-ops in a plain browser tab:
//   1. Read the window chrome once and publish it to <html> so CSS can
//      reserve space for the OS window controls.
//   2. Follow route pushes from the menu, tray, dock menu and deep links.
//   3. Mirror renderer state back into the native menu, so checkmarks and
//      enablement stay truthful.
// Menu/accelerator COMMANDS are executed by useCommandHost (one handler table
// for desktop IPC and the web key handler, D-24).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  NATIVE_CHROME,
  applyChromeToDocument,
  applyFullscreenInsets,
  isDesktop,
  onDesktopNavigate,
  onDesktopThemePreference,
  onWindowStateChanged,
  pushMenuState,
  readWindowChrome,
  trackWindowControlsOverlay,
  type DesktopWindowChrome,
} from '@/lib/desktop.js';
import { navDestinationFor } from '@generatorai/shared/ui-contract';
import { useUiStore } from '@/stores/uiStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { usePageTitleStore } from '@/stores/pageTitleStore.js';
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';

/** `File ▸ Open Recent` label for a route without a page title: its section (D-22). */
function routeLabel(pathname: string): string {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings';
  return navDestinationFor(pathname)?.label ?? pathname;
}

export function useDesktopIntegration(): DesktopWindowChrome {
  const [chrome, setChrome] = useState<DesktopWindowChrome>(NATIVE_CHROME);
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useTheme();

  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightPaneController = useRightPaneStore((s) => s.controller);
  const rightPaneOpen = rightPaneController?.open ?? false;

  // Visited routes, newest first — feeds the native `File ▸ Open Recent`.
  const recentRef = useRef<Array<{ label: string; route: string }>>([]);
  // The document's own name, once the page has loaded it. Without this every
  // recent entry read as its section, so three chats were three "Chats".
  const pageTitle = usePageTitleStore((s) => s.title);
  const hasUnsavedWork = useUnsavedWorkStore((s) => s.dirtyKeys.size > 0);

  // ── 1. Publish window chrome ──
  useEffect(() => {
    let cancelled = false;
    let untrack: (() => void) | undefined;
    void readWindowChrome().then((c) => {
      if (cancelled) return;
      setChrome(c);
      applyChromeToDocument(c);
      // The main process only knows the *expected* control width; Chromium
      // knows the real one and reports changes. Prefer it once it is live.
      untrack = trackWindowControlsOverlay(c);
    });
    return () => {
      cancelled = true;
      untrack?.();
    };
  }, []);

  // Fullscreen and maximise change how the title bar should look (a maximised
  // window loses its rounded corners; an unfocused one dims).
  useEffect(() => {
    if (!isDesktop) return undefined;
    const root = document.documentElement;
    return onWindowStateChanged((s) => {
      applyFullscreenInsets(chrome, s.fullScreen);
      root.classList.toggle('window-fullscreen', s.fullScreen);
      root.classList.toggle('window-maximized', s.maximized);
      root.classList.toggle('window-blurred', !s.focused);
    });
  }, [chrome]);

  // ── 2. Route pushes from the menu, tray, dock menu, JumpList and deep links ──
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopNavigate((path) => {
      if (typeof path === 'string' && path.startsWith('/')) navigate(path);
    });
  }, [navigate]);

  // ── 3. Mirror renderer state into the native menu ──
  useEffect(() => {
    if (!isDesktop) return;
    const label = pageTitle ?? routeLabel(location.pathname);
    const next = [
      { label, route: location.pathname },
      ...recentRef.current.filter((r) => r.route !== location.pathname),
    ].slice(0, 10);
    recentRef.current = next;

    pushMenuState({
      sidebarOpen,
      rightPaneOpen,
      theme: mode,
      recent: next,
      hasUnsavedWork,
    });
  }, [location.pathname, sidebarOpen, rightPaneOpen, mode, pageTitle, hasUnsavedWork]);

  // The native View ▸ Appearance radio group is a user choice of MODE, so it
  // sets the app's own preference. Reporting only the resolved colour meant
  // picking "Light" did nothing whenever the in-app preference was pinned.
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopThemePreference((next) => setMode(next));
  }, [setMode]);

  // The native View ▸ Appearance radio group writes to the shell's settings;
  // reflect that back into the SPA theme provider.
  useEffect(() => {
    if (!isDesktop) return undefined;
    const bridgeTheme = (window as unknown as {
      generatoraiDesktop?: { onThemeChanged?: (cb: (t: 'light' | 'dark') => void) => () => void };
    }).generatoraiDesktop?.onThemeChanged;
    if (!bridgeTheme) return undefined;
    return bridgeTheme((resolved) => {
      // Only follow the OS when the user has not pinned a mode themselves.
      // Toggling the class directly (rather than calling setMode) keeps the
      // stored preference on `system` — the OS is the source of truth here,
      // and persisting its current value would silently pin it.
      if (mode === 'system') document.documentElement.classList.toggle('dark', resolved === 'dark');
    });
  }, [mode, setMode]);

  return chrome;
}
