// ────────────────────────────────────────────────────────────────
// useDesktopIntegration — binds the SPA to the Electron shell.
//
// Three jobs, all no-ops in a plain browser tab:
//   1. Read the window chrome once and publish it to <html> so CSS can
//      reserve space for the OS window controls.
//   2. Handle menu/accelerator commands pushed from the main process.
//   3. Mirror renderer state back into the native menu, so checkmarks and
//      enablement stay truthful.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  NATIVE_CHROME,
  applyChromeToDocument,
  isDesktop,
  onDesktopCommand,
  onDesktopNavigate,
  onWindowStateChanged,
  pushMenuState,
  readWindowChrome,
  trackWindowControlsOverlay,
  type DesktopWindowChrome,
} from '@/lib/desktop.js';
import { useUiStore } from '@/stores/uiStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { useTheme } from '@/providers/ThemeProvider.js';

const ROUTE_LABELS: Array<[prefix: string, label: string]> = [
  ['/chats', 'Chats'],
  ['/workflows', 'Workflows'],
  ['/projects', 'Projects'],
  ['/scripts', 'Scripts'],
  ['/automations', 'Automations'],
  ['/settings', 'Settings'],
];

function routeLabel(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  const hit = ROUTE_LABELS.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : pathname;
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
      untrack = trackWindowControlsOverlay();
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
      root.classList.toggle('window-fullscreen', s.fullScreen);
      root.classList.toggle('window-maximized', s.maximized);
      root.classList.toggle('window-blurred', !s.focused);
    });
  }, []);

  // ── 2. Menu / accelerator commands ──
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopCommand((command) => {
      const ui = useUiStore.getState();
      switch (command) {
        case 'command-palette':
          ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
          break;
        case 'toggle-sidebar':
          ui.toggleSidebar();
          break;
        case 'toggle-right-pane':
          useRightPaneStore.getState().controller?.toggle();
          break;
        case 'focus-search':
          // The palette doubles as the app's search surface.
          ui.setCommandPaletteOpen(true);
          break;
        case 'find-next':
          // Delegated to whichever panel owns an active find session.
          window.dispatchEvent(new CustomEvent('generatorai:find-next'));
          break;
        case 'show-shortcuts':
          window.dispatchEvent(new CustomEvent('generatorai:show-shortcuts'));
          break;
        case 'new-chat':
          navigate('/chats');
          break;
        case 'new-workflow':
          navigate('/workflows/new');
          break;
        case 'new-project':
          navigate('/projects/new');
          break;
        case 'new-automation':
          navigate('/automations/new');
          break;
        case 'reload-scripts':
          window.dispatchEvent(new CustomEvent('generatorai:reload-scripts'));
          break;
        default:
          break;
      }
    });
  }, [navigate]);

  // Route pushes from the menu, tray, dock menu, JumpList and deep links.
  useEffect(() => {
    if (!isDesktop) return undefined;
    return onDesktopNavigate((path) => {
      if (typeof path === 'string' && path.startsWith('/')) navigate(path);
    });
  }, [navigate]);

  // ── 3. Mirror renderer state into the native menu ──
  useEffect(() => {
    if (!isDesktop) return;
    const label = routeLabel(location.pathname);
    const next = [
      { label, route: location.pathname },
      ...recentRef.current.filter((r) => r.route !== location.pathname),
    ].slice(0, 10);
    recentRef.current = next;

    pushMenuState({
      sidebarOpen,
      rightPaneOpen,
      // react-router v6 exposes no reliable canGoBack, so approximate from
      // the session history depth: index 0 means nothing to go back to.
      canGoBack: window.history.length > 1,
      canGoForward: false,
      theme: mode,
      recent: next,
    });
  }, [location.pathname, sidebarOpen, rightPaneOpen, mode]);

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
