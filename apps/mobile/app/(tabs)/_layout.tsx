// ────────────────────────────────────────────────────────────────
// Top-level shell.
//
// The four top-level scenes (Home, Chats, Work, Projects) still live in a tab
// NAVIGATOR — it keeps each scene mounted, so switching destinations keeps
// scroll position and search text — but there is no tab BAR. The navigation
// drawer (src/navigation/shell/AppDrawer) is the way between them, the same
// way every agentic chat client navigates: the conversation gets the full
// height of the phone and recent chats get a list rather than a slot.
//
// The navigator header is OFF: every scene draws its own header through
// `<Screen>`, led by the menu button.
//
// `TabShellProvider` hands every scene the FAB and list-end insets plus the
// attention count, computed once here.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../src/theme/ThemeProvider';
import { useActivity, needsYouCount } from '../../src/api/useActivity';
import { useReduceMotion } from '../../src/components/ui';
import { TabShellProvider, type TabShellValue } from '../../src/navigation/tabShell';
import { shellContentInsets } from '../../src/navigation/tabsImplementation';

const NO_BAR = (): null => null;

export default function TabsLayout(): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { operations } = useActivity();
  const attention = needsYouCount(operations);
  const reduceMotion = useReduceMotion();

  const shell = useMemo<TabShellValue>(
    () => ({ ...shellContentInsets(insets.bottom), attention }),
    [insets.bottom, attention],
  );

  return (
    <TabShellProvider value={shell}>
      <Tabs
        tabBar={NO_BAR}
        screenOptions={{
          headerShown: false,
          // A short cross-fade between destinations; a hard cut read as the app
          // reloading. Reduce Motion (OS or app preference) keeps the cut.
          animation: reduceMotion ? 'none' : 'fade',
          // The navigator paints its OWN scene background, and it defaults to
          // React Navigation's light theme (#F2F2F2).
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
        <Tabs.Screen name="runs" options={{ title: 'Work' }} />
        <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      </Tabs>
    </TabShellProvider>
  );
}
