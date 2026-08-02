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
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Tabs } from 'expo-router';
import { Activity, FolderGit2, MessagesSquare, Workflow } from 'lucide-react-native';

import { useTheme } from '../../src/theme/ThemeProvider';

export default function TabsLayout(): React.ReactElement {
  const { colors } = useTheme();

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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors['muted-foreground'],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <MessagesSquare color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="runs"
        options={{
          title: 'Work',
          tabBarIcon: ({ color, size }) => <Workflow color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <FolderGit2 color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
