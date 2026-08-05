// ────────────────────────────────────────────────────────────────
// Tab shell.
//
// Four tabs, chosen to match what someone actually does away from a desk:
// see what needs them, talk to an agent, watch work run, browse code.
// Settings lives in each screen's own header rather than burning a tab — HIG
// is explicit that a tab bar is for navigation between peer sections, and
// settings is not a peer of them.
//
// Deliberately NOT a mirror of the web sidebar — that has seven entries,
// which on a phone produces targets too small to hit reliably.
//
// The navigator header is OFF: every tab screen draws its own large title
// through `<Screen>`, which collapses on scroll. Leaving the navigator header
// on would stack two titles.
//
// Three platform behaviours the default JS tab bar does not give us and that
// a fluent user notices within a minute:
//
//   • a haptic on tab change (the single strongest "native" cue there is),
//   • a badge on Activity when something is blocked waiting for a decision —
//     HIG reserves badges for exactly this, information that warrants
//     attention rather than a general unread count,
//   • re-tapping the active tab scrolls its content back to the top.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Activity, FolderGit2, MessagesSquare, Workflow } from 'lucide-react-native';

import { useTheme } from '../../src/theme/ThemeProvider';
import { useActivity } from '../../src/api/useActivity';
import { haptics, useFontScale } from '../../src/components/ui';
import { scrollActiveToTop } from '../../src/navigation/scrollToTop';

export default function TabsLayout(): React.ReactElement {
  const { colors } = useTheme();
  const fontScale = useFontScale();
  const { counts } = useActivity();

  // Tab presses are the one place a haptic is unconditionally right: the
  // whole screen changes, so the feedback confirms the target was hit even
  // before the new content paints.
  const onTabPress = useCallback((routeName: string, focused: boolean) => {
    if (focused) {
      scrollActiveToTop(routeName);
      return;
    }
    haptics.select();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The navigator paints its OWN scene background, and it defaults to
        // React Navigation's light theme (#F2F2F2). That rectangle covered the
        // themed shell underneath, so in dark mode every tab rendered dark
        // cards and light chrome on a near-white page.
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: {
          backgroundColor: colors.sidebar,
          borderTopColor: colors['sidebar-border'],
          borderTopWidth: 1,
        },
        // Labels are dropped rather than truncated past ~1.4×: "Projects"
        // wrapping to two lines pushes the icon out of the bar entirely.
        tabBarShowLabel: fontScale <= 1.4,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors['muted-foreground'],
        tabBarBadgeStyle: {
          backgroundColor: colors.danger,
          color: colors['destructive-foreground'],
          fontSize: 11,
          // The default badge is a fixed circle sized for two digits; a third
          // one overflows it. Padding lets it grow into a pill instead.
          paddingHorizontal: 4,
          minWidth: 18,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
          ...(counts.attention > 0
            ? {
                // Past 99 the exact figure stops being actionable and the
                // badge starts crowding the icon it is attached to.
                tabBarBadge: counts.attention > 99 ? '99+' : counts.attention,
                tabBarAccessibilityLabel: `Activity, ${counts.attention} waiting for you`,
              }
            : {}),
        }}
        listeners={({ navigation, route }) => ({
          tabPress: () => onTabPress(route.name, navigation.isFocused()),
        })}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <MessagesSquare color={color} size={size} />,
        }}
        listeners={({ navigation, route }) => ({
          tabPress: () => onTabPress(route.name, navigation.isFocused()),
        })}
      />
      <Tabs.Screen
        name="runs"
        options={{
          title: 'Work',
          tabBarIcon: ({ color, size }) => <Workflow color={color} size={size} />,
        }}
        listeners={({ navigation, route }) => ({
          tabPress: () => onTabPress(route.name, navigation.isFocused()),
        })}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <FolderGit2 color={color} size={size} />,
        }}
        listeners={({ navigation, route }) => ({
          tabPress: () => onTabPress(route.name, navigation.isFocused()),
        })}
      />
    </Tabs>
  );
}
