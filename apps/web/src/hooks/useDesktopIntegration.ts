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
  onWindowStateChanged,
  pushMenuState,
  readWindowChrome,
  trackWindowControlsOverlay,
  type DesktopWindowChrome,
} from '@/lib/desktop.js';
import { navDestinationFor } from '@generatorai/shared/ui-contract';
import { useUiStore } from '@/stores/uiStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { usePageTitleStore } from '@/stores/pageTitleStore.js';
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';
import { useAttentionCounts } from './attentionQueries.js';

/** `File ▸ Open Recent` label for a route without a page title: its section (D-22). */
function routeLabel(pathname: string): string {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings';
  return navDestinationFor(pathname)?.label ?? pathname;
}

export function useDesktopIntegration(): DesktopWindowChrome {
  const [chrome, setChrome] = useState<DesktopWindowChrome>(NATIVE_CHROME);
  const navigate = useNavigate();
  const location = useLocation();

  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightPaneController = useRightPaneStore((s) => s.controller);
  const rightPaneOpen = rightPaneController?.open ?? false;

  // Visited routes, newest first — feeds the native `File ▸ Open Recent`.
  const recentRef = useRef<Array<{ label: string; route: string }>>([]);
  // The document's own name, once the page has loaded it. Without this every
  // recent entry read as its section, so three chats were three "Chats".
  const pageTitle = usePageTitleStore((s) => s.title);
  const hasUnsavedWork = useUnsavedWorkStore((s) => s.dirtyKeys.size > 0);
  // Only the desktop shell has a badge/tray to feed; a plain tab must not
  // open a feed (request, `global` stream, safety poll) nobody reads (P2-R18).
  // Undefined until the first snapshot loads (D-36) — sent as `null`
  // ("unknown"), never a fabricated zero, so main clears the badge and tray
  // counts instead of keeping a previous server's numbers (G-05, P2-R8).
  const attentionCounts = useAttentionCounts({ enabled: isDesktop });

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
      recent: next,
      hasUnsavedWork,
      attention: attentionCounts ?? null,
    });
  }, [location.pathname, sidebarOpen, rightPaneOpen, pageTitle, hasUnsavedWork, attentionCounts]);

  // Appearance is not handled here: ThemeProvider is its only writer and owns
  // the desktop appearance IPC in both directions (D-25).

  return chrome;
}
