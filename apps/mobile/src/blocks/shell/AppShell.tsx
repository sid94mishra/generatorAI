// AppShell (06 §1.1, MD-18, MD-24): the one place the shell connects the kit panels to the shell store, the router
// and the command host. Start: the sidebar in a SidePanel — a drawer over a scrim on phones, a persistent column at
// ≥ 600 unless hidden. Main: the column that pays the status-bar and side insets once (its subtree reads 0 there;
// full-window surfaces read `useWindowInsets()`), the connection banner, then the Stack. Mounts the kit hosts left by
// M4 (ToastHost, AlertDialogHost, SheetProvider) and registers the biometric step-up for AlertDialog.
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { requireStepUp } from '../../services/auth/stepUp';
import { SidePanel } from '../../ui/layout/SidePanel';
import { AlertDialogHost, setStepUpHandler } from '../../ui/native/AlertDialog';
import { SheetProvider } from '../../ui/native/Sheet';
import { useSizeClass } from '../../ui/platform/breakpoints';
import { edgeSwipeOpensDrawer } from '../../ui/platform/gestures';
import { WindowInsetsProvider } from '../../ui/platform/insets';
import { ToastHost } from '../../ui/primitives/Toast';
import { ConnectionBanner } from '../ConnectionStatus';
import { DrawerContent } from './DrawerContent';
import { ErrorBoundary } from './ErrorBoundary';
import { isModuleRoot } from './parentHref';
import { useShellStore } from './shellStore';

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const consumed = useMemo(() => ({ ...insets, top: 0, left: 0, right: 0 }), [insets]);
  const pathname = usePathname();
  const { sizeClass } = useSizeClass();
  const drawerOpen = useShellStore((s) => s.drawerOpen);
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen);
  const sidebarHidden = useShellStore((s) => s.sidebarHidden);
  const surfaceOwnsGestures = useShellStore((s) => s.gestureOwner === 'surface');

  const persistent = sizeClass !== 'compact' && !sidebarHidden;
  const modalOpen = drawerOpen && !persistent;
  const root = isModuleRoot(pathname);
  const edgeOpen = !persistent && edgeSwipeOpensDrawer({ role: root ? 'top' : 'detail', sizeClass, surfaceOwnsGestures });

  // Any route change answers the tap that caused it: a drawer left open over a new screen reads as a glitch.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);
  useEffect(() => {
    setStepUpHandler((reason) => requireStepUp(reason));
    return () => setStepUpHandler(null);
  }, []);

  return (
    <WindowInsetsProvider insets={insets}>
      <SheetProvider>
        <View className="flex-1 flex-row bg-ground">
          <SidePanel
            side="start"
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            presentation={persistent ? 'persistent' : 'overlay'}
            edgeOpenEnabled={edgeOpen}
            dragToCloseEnabled={!surfaceOwnsGestures}
            accessibilityLabel="Sidebar"
            testID="drawer"
          >
            <DrawerContent variant={persistent ? 'persistent' : 'modal'} onNavigate={() => setDrawerOpen(false)} active={persistent || drawerOpen} />
          </SidePanel>
          <View
            className="flex-1 bg-surface"
            accessibilityElementsHidden={modalOpen}
            importantForAccessibility={modalOpen ? 'no-hide-descendants' : 'auto'}
            style={{ paddingTop: insets.top, paddingLeft: persistent ? 0 : insets.left, paddingRight: insets.right }}
          >
            <SafeAreaInsetsContext.Provider value={consumed}>
              <ConnectionBanner />
              <ErrorBoundary scope="shell">{children}</ErrorBoundary>
            </SafeAreaInsetsContext.Provider>
          </View>
        </View>
        <ToastHost />
        <AlertDialogHost />
      </SheetProvider>
    </WindowInsetsProvider>
  );
}
