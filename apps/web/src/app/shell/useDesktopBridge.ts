// ────────────────────────────────────────────────────────────────
// useDesktopBridge — binds the SPA to the Electron shell (06 §2.1, §3.6;
// was hooks/useDesktopIntegration.ts).
//
// Jobs, all no-ops in a plain browser tab:
//   1. Publish the window chrome to <html> (classes, `data-layout`,
//      `--gai-titlebar-*`) — the pre-paint script already did it before first
//      paint; this keeps it true and tracks the live Window Controls Overlay.
//   2. Follow route pushes from the menu, tray, dock menu and deep links.
//   3. Mirror renderer state back into the native menu, so checkmarks and
//      enablement stay truthful.
// Menu/accelerator COMMANDS are executed by useCommandHost (one handler table
// for desktop IPC and the web key handler, D-24).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  applyChromeToDocument,
  applyFullscreenInsets,
  isDesktop,
  onDesktopNavigate,
  onWindowStateChanged,
  pushMenuState,
  trackWindowControlsOverlay,
  windowChrome,
} from '@/lib/desktop.js';
import { isSettingsPath, navDestinationFor, settingsSectionFromPath } from '@generatorai/shared/ui-contract';
import { useDockStore } from '@/stores/dockStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { usePageTitleStore } from '@/stores/pageTitleStore.js';
import { useUnsavedWorkStore } from '@/stores/unsavedWorkStore.js';
import { useAttentionCounts } from '@/hooks/attentionQueries.js';

/** `File ▸ Open Recent` label for a route without a page title: its section (D-22). */
function routeLabel(pathname: string): string {
  if (isSettingsPath(pathname)) return 'Settings';
  return navDestinationFor(pathname)?.label ?? pathname;
}

export interface DesktopBridgeOptions {
  /** The full sidebar is showing (the native `View ▸ Toggle Sidebar` checkmark). */
  sidebarExpanded: boolean;
}

export function useDesktopBridge({ sidebarExpanded }: DesktopBridgeOptions): void {
  const navigate = useNavigate();
  const location = useLocation();

  const rightPaneController = useDockStore((s) => s.controller);
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

  // ── 1. Window chrome and window state ──
  useEffect(() => {
    const chrome = windowChrome();
    applyChromeToDocument(chrome);
    // The main process only knows the *expected* control width; Chromium
    // knows the real one and reports changes. Prefer it once it is live.
    const untrack = trackWindowControlsOverlay(chrome);
    if (!isDesktop) return untrack;
    // Fullscreen and maximise change how the chrome should look (a maximised
    // window loses its corner radius; an unfocused one dims).
    const root = document.documentElement;
    const unsubscribe = onWindowStateChanged((s) => {
      applyFullscreenInsets(chrome, s.fullScreen);
      root.classList.toggle('window-fullscreen', s.fullScreen);
      root.classList.toggle('window-maximized', s.maximized);
      root.classList.toggle('window-blurred', !s.focused);
    });
    return () => {
      untrack();
      unsubscribe();
    };
  }, []);

  // ── 2. Route pushes from the menu, tray, dock menu, JumpList and deep links ──
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopNavigate((path) => {
      if (typeof path !== 'string' || !path.startsWith('/')) return;
      // `generatorai://settings/<section>` opens the modal over the current
      // page (D-26); on a cold start that page is Home.
      const section = settingsSectionFromPath(path.split(/[?#]/)[0]!);
      if (section) useSettingsUiStore.getState().openSettings(section);
      else void navigate(path);
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
      sidebarOpen: sidebarExpanded,
      rightPaneOpen,
      recent: next,
      hasUnsavedWork,
      attention: attentionCounts ?? null,
    });
  }, [location.pathname, sidebarExpanded, rightPaneOpen, pageTitle, hasUnsavedWork, attentionCounts]);

  // Appearance is not handled here: ThemeProvider is its only writer and owns
  // the desktop appearance IPC in both directions (D-25).
}
