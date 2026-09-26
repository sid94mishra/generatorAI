// ────────────────────────────────────────────────────────────────
// ShellRoute — the app frame around every page (06 §2.1; replaces
// components/layout/AppLayout.tsx). Wiring only: every pixel comes from
// ui/shell.
//
//   layout        from the window chrome (lib/desktop.ts), static per process:
//                 mac | strip (Windows, Linux custom) | native (Linux, web)
//   sidebar mode  useSidebarMode: the rail below 1200px or on a forceRail
//                 route, the saved preference otherwise
//   overlays      the flyout (forced rail), the command palette, the find bar
//                 and the shortcuts sheet
// The page renders into the MainCard through <Outlet/>; its RouteSlot adds
// the LegacyHeader when the route still needs it (D-21).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { shellLayoutFor, windowChrome } from '@/lib/desktop.js';
import { useShellStore } from '@/stores/shellStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { AppFrame } from '@/ui/shell/AppFrame/AppFrame.js';
import { MainCard } from '@/ui/shell/MainCard/MainCard.js';
import { SidebarFlyout } from '@/ui/shell/SidebarFlyout/SidebarFlyout.js';
import { CommandPalette } from '@/features/palette/index.js';
import { FindBar } from '@/components/layout/FindBar.js';
import { ShortcutsSheet } from '@/components/layout/ShortcutsSheet.js';
import { ConnectedRail } from './ConnectedRail.js';
import { ConnectedSidebar } from './ConnectedSidebar.js';
import { ConnectedTitleStrip } from './ConnectedTitleStrip.js';
import { useCommandHost } from './useCommandHost.js';
import { useDesktopBridge } from './useDesktopBridge.js';
import { useSidebarMode } from './useSidebarMode.js';

// Static per process: main passes it to the preload as a launch argument.
const LAYOUT = shellLayoutFor(windowChrome());

export function ShellRoute() {
  const { mode } = useSidebarMode();
  const flyoutOpen = useShellStore((s) => s.flyoutOpen);
  const setFlyoutOpen = useShellStore((s) => s.setFlyoutOpen);

  // Publishes window chrome, follows native route pushes, and mirrors UI
  // state back into the menu. No-op outside the Electron shell.
  useDesktopBridge({ sidebarExpanded: mode === 'expanded' });
  // Menu commands (desktop) and the registry's web key bindings (browser).
  useCommandHost();
  useSettingsNavigator();

  // Following a link from the flyout lands on the page, not under the flyout.
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setFlyoutOpen(false);
  }, [pathname, setFlyoutOpen]);

  return (
    <AppFrame
      layout={LAYOUT}
      sidebarMode={mode}
      titleStrip={<ConnectedTitleStrip />}
      sidebar={mode === 'expanded' ? <ConnectedSidebar layout={LAYOUT} /> : <ConnectedRail layout={LAYOUT} covered={flyoutOpen} />}
      flyout={
        flyoutOpen ? (
          <SidebarFlyout onClose={() => setFlyoutOpen(false)}>
            <ConnectedSidebar layout={LAYOUT} inFlyout />
          </SidebarFlyout>
        ) : null
      }
      overlays={
        <>
          {/* The command palette (palette.toggle: Mod+K, menu, Search buttons). */}
          <CommandPalette />
          <FindBar />
          <ShortcutsSheet />
        </>
      }
    >
      <MainCard underStrip={LAYOUT === 'strip'}>
        <Outlet />
      </MainCard>
    </AppFrame>
  );
}

/**
 * Settings is a routed page; `openSettings(section)` is a navigation, and the
 * store cannot hold a router hook. The shell lends it one — imported the other
 * way round (store → router) it would close an import cycle through every
 * lazy page.
 */
function useSettingsNavigator(): void {
  const navigate = useNavigate();
  const setSettingsNavigator = useSettingsUiStore((s) => s.setNavigator);
  useEffect(() => {
    setSettingsNavigator((path, opts) => navigate(path, { replace: opts?.replace ?? false }));
    return () => setSettingsNavigator(null);
  }, [navigate, setSettingsNavigator]);
}
