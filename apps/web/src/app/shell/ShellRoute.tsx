// ────────────────────────────────────────────────────────────────
// ShellRoute — the app frame around every page (06 §2.1; replaces
// components/layout/AppLayout.tsx). Wiring only: every pixel comes from
// ui/shell.
//
//   layout        from the window chrome (lib/desktop.ts), static per process:
//                 mac | strip (Windows, Linux custom) | native (Linux, web)
//   sidebar mode  useSidebarMode: the rail below 1200px or on a forceRail
//                 route, the saved preference otherwise
//   activity      the Activity column (D-92), docked or as an overlay
//   overlays      the flyout (forced rail), the command palette, the find bar,
//                 the shortcuts sheet and the Settings modal
//   page          `useRoutes(PAGE_ROUTES, pageLocation)` in the MainCard; each
//                 page renders its own PageHeader. `pageLocation` is the URL,
//                 except under the Settings modal (D-26, 06 §2.4): there it
//                 is the page the modal was opened over
//                 (`state.backgroundLocation`), else the last page shown (a
//                 plain link or a deep link to /settings/…), else Home (a
//                 direct load). The page stays mounted while the modal is open.
// ────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useRef } from 'react';
import { matchRoutes, useRoutes, type Location } from 'react-router';
import { shellLayoutFor, windowChrome } from '@/lib/desktop.js';
import { useShellStore } from '@/stores/shellStore.js';
import { AppFrame } from '@/ui/shell/AppFrame/AppFrame.js';
import { MainCard } from '@/ui/shell/MainCard/MainCard.js';
import { SidebarFlyout } from '@/ui/shell/SidebarFlyout/SidebarFlyout.js';
import { CommandPalette } from '@/features/palette/index.js';
import { NewChatDialog } from '@/features/chats/create/NewChatDialog.js';
import { CHROME } from '@generatorai/design-tokens';
import { useActivityStore } from '@/stores/activityStore.js';
import { ConnectedActivityColumn, useActivityPlacement } from './ConnectedActivityColumn.js';
import { ConnectedRail } from './ConnectedRail.js';
import { ConnectedSidebar } from './ConnectedSidebar.js';
import { ConnectedTitleStrip } from './ConnectedTitleStrip.js';
import { EditSourcesHost } from './EditSourcesHost.js';
import { FindBar } from './FindBar.js';
import { ShortcutsSheet } from './ShortcutsSheet.js';
import { useCommandHost } from './useCommandHost.js';
import { useDesktopBridge } from './useDesktopBridge.js';
import { useSidebarMode } from './useSidebarMode.js';
import { PageRoutesBoundary } from './RouteErrors.js';
import { useSettingsOpener, useShellLocations } from './settingsRouting.js';
import { PAGE_ROUTES } from '../routes/index.js';
import type { GaiRouteHandle } from '../routes/defineRoute.js';
import { SettingsModalRoute } from '../routes/settings.routes.js';

// Static per process: main passes it to the preload as a launch argument.
const LAYOUT = shellLayoutFor(windowChrome());

/** The pages, rendered at `location` (memoised: a re-render of the frame is not a navigation for the page). */
const PageRoutes = memo(function PageRoutes({ location }: { location: Location }) {
  return useRoutes(PAGE_ROUTES, location);
});

function routeForcesRail(location: Location): boolean {
  return (matchRoutes(PAGE_ROUTES, location) ?? []).some(
    (m) => (m.route.handle as Partial<GaiRouteHandle> | undefined)?.forceRail === true,
  );
}

export function ShellRoute() {
  const { location, pageLocation, settingsSection, background } = useShellLocations();
  const { mode } = useSidebarMode(useMemo(() => routeForcesRail(pageLocation), [pageLocation]));
  const flyoutOpen = useShellStore((s) => s.flyoutOpen);
  const setFlyoutOpen = useShellStore((s) => s.setFlyoutOpen);
  // The Activity column (D-92): docked while the card keeps room beside it, else an overlay.
  const activityOpen = useActivityStore((s) => s.open);
  const activityWidth = useActivityStore((s) => s.width);
  const sidebarWidth = mode === 'expanded' ? CHROME.sidebarWidth : CHROME.railWidth;
  const placement = useActivityPlacement(sidebarWidth, activityWidth);
  const activityDocked = activityOpen && placement === 'docked';

  // Publishes window chrome, follows native route pushes, and mirrors UI
  // state back into the menu. No-op outside the Electron shell.
  useDesktopBridge({ sidebarExpanded: mode === 'expanded' });
  // Menu commands (desktop) and the registry's web key bindings (browser).
  useCommandHost();
  useSettingsOpener(location);

  // Following a link from the flyout lands on the page, not under the flyout.
  const { pathname } = location;
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
      sidebar={
        mode === 'expanded' ? (
          <ConnectedSidebar layout={LAYOUT} activityOpen={activityOpen} />
        ) : (
          <ConnectedRail layout={LAYOUT} covered={flyoutOpen} activityDocked={activityDocked} />
        )
      }
      // Mounted only while open or easing closed (AppFrame's Reveal, D-109).
      activity={<ConnectedActivityColumn placement={placement} sidebarWidth={sidebarWidth} />}
      activityOpen={activityOpen}
      activityOverlay={placement === 'overlay'}
      flyout={
        <SidebarFlyout onClose={() => setFlyoutOpen(false)}>
          <ConnectedSidebar layout={LAYOUT} inFlyout />
        </SidebarFlyout>
      }
      flyoutOpen={flyoutOpen}
      overlays={
        <>
          {/* The command palette (palette.toggle: Mod+K, menu, Search buttons). */}
          <CommandPalette />
          {/* 04 §0 cross-feature rule: mounted once here, opened from anywhere
              via useNewChatStore (chat.new, ChatsList's header button, …). */}
          <NewChatDialog />
          <ShortcutsSheet />
          {/* The chat workspace's "Edit sources…" dialog (editSourcesStore). */}
          <EditSourcesHost />
          {settingsSection ? <SettingsModalRoute section={settingsSection} background={background} /> : null}
        </>
      }
    >
      <MainCard underStrip={LAYOUT === 'strip'}>
        <PageRoutesBoundary resetKey={pageLocation.pathname}>
          <PageRoutes location={pageLocation} />
        </PageRoutesBoundary>
        {/* Desktop find-in-page, anchored to the card (S-12). */}
        <FindBar />
      </MainCard>
    </AppFrame>
  );
}
