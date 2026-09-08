// ────────────────────────────────────────────────────────────────
// Tab shell.
//
// Four tabs, chosen to match what someone actually does away from a desk:
// see what needs them (Home), talk to an agent (Chats), watch work run
// (Work), browse code and agents (Projects). Settings lives in each
// screen's own header rather than burning a tab — HIG is explicit that a
// tab bar is for navigation between peer sections, and settings is not a
// peer of them.
//
// The navigator header is OFF: every tab screen draws its own large title
// through `<Screen>`, which collapses on scroll.
//
// Platform behaviours the default JS tab bar does not give us:
//
//   • a haptic on tab change (the single strongest "native" cue there is),
//   • a badge on Home when something is blocked waiting for a decision —
//     HIG reserves badges for exactly this,
//   • re-tapping the active tab scrolls its content back to the top,
//   • a "needs you" accessory pill above the bar (plan §6.2) — tap opens
//     the approvals sheet,
//   • a bar sized from its contents (`tabBarMetrics`): 49pt + inset on iOS
//     with a translucent tint of the sidebar surface, Material 3's 80dp on
//     Android with the active-icon pill. The web preview used to clip the
//     labels because the height ignored the label's line-height.
//
// Native Tabs (`expo-router/unstable-native-tabs`) sit behind
// `USE_NATIVE_TABS` in `src/navigation/tabsImplementation.ts`; only the JS
// bar is implemented here until they are verified on device.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo } from 'react';
import { Platform, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FolderGit2, House, MessagesSquare, Workflow, type LucideIcon } from 'lucide-react-native';

import { useTheme } from '../../src/theme/ThemeProvider';
import { useActivity, needsYouCount } from '../../src/api/useActivity';
import { haptics, useFontScale } from '../../src/components/ui';
import { NeedsYouStrip } from '../../src/components/home/NeedsYouStrip';
import { scrollActiveToTop } from '../../src/navigation/scrollToTop';
import { USE_NATIVE_TABS, tabBarMetrics, withAlpha } from '../../src/navigation/tabsImplementation';

/**
 * The icon slot. On Android the focused icon sits in a Material 3 active
 * indicator (64×32 pill); iOS tints the glyph only.
 */
function TabIcon({
  Icon,
  color,
  size,
  focused,
  pill,
  pillColor,
}: {
  Icon: LucideIcon;
  color: string;
  size: number;
  focused: boolean;
  pill: boolean;
  pillColor: string;
}): React.ReactElement {
  if (!pill) return <Icon color={color} size={size} />;
  return (
    <View
      style={{
        width: 64,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? pillColor : 'transparent',
      }}
    >
      <Icon color={color} size={size} />
    </View>
  );
}

export default function TabsLayout(): React.ReactElement {
  const { colors } = useTheme();
  const fontScale = useFontScale();
  const insets = useSafeAreaInsets();
  const { operations } = useActivity();
  const attention = needsYouCount(operations);

  const metrics = useMemo(
    () => tabBarMetrics(Platform.OS as Parameters<typeof tabBarMetrics>[0], insets.bottom, fontScale),
    [insets.bottom, fontScale],
  );

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

  const icon = useCallback(
    (Icon: LucideIcon) =>
      ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
        <TabIcon
          Icon={Icon}
          color={String(color)}
          size={Math.min(size, metrics.iconSize)}
          focused={focused}
          pill={metrics.activePill}
          pillColor={colors['sidebar-accent'] ?? colors.accent ?? 'transparent'}
        />
      ),
    [metrics.iconSize, metrics.activePill, colors],
  );

  // Native Tabs are not wired yet — see `tabsImplementation.ts` for the
  // exact steps. The JS bar below is the only implementation for now.
  void USE_NATIVE_TABS;

  const ios = Platform.OS === 'ios';

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          // The navigator paints its OWN scene background, and it defaults to
          // React Navigation's light theme (#F2F2F2). That rectangle covered the
          // themed shell underneath, so in dark mode every tab rendered dark
          // cards and light chrome on a near-white page.
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: {
            // iOS: a translucent tint of the sidebar surface, content scrolling
            // under it. Without expo-blur (no new native modules) this is the
            // closest honest reading of the system bar. Every tab list already
            // pads its bottom past the bar height for the FAB.
            ...(ios ? { position: 'absolute' as const } : {}),
            backgroundColor: ios ? withAlpha(colors.sidebar ?? '#000000', 0.94) : colors.sidebar,
            borderTopColor: colors['sidebar-border'],
            borderTopWidth: 1,
            height: metrics.height,
            paddingBottom: metrics.paddingBottom,
            paddingTop: 4,
            elevation: 0,
          },
          tabBarItemStyle: {
            paddingVertical: 0,
          },
          // Labels are dropped rather than truncated past ~1.4×: "Projects"
          // wrapping to two lines pushes the icon out of the bar entirely.
          tabBarShowLabel: metrics.showLabel,
          tabBarLabelStyle: {
            fontSize: metrics.labelFontSize,
            lineHeight: metrics.labelLineHeight,
            fontWeight: '600',
            marginTop: metrics.activePill ? 4 : 0,
          },
          // `fontScale` is already applied through the metrics; letting the
          // label scale twice is what pushed it out of the bar.
          tabBarAllowFontScaling: false,
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
            title: 'Home',
            tabBarIcon: icon(House),
            ...(attention > 0
              ? {
                  // Past 99 the exact figure stops being actionable and the
                  // badge starts crowding the icon it is attached to.
                  tabBarBadge: attention > 99 ? '99+' : attention,
                  tabBarAccessibilityLabel: `Home, ${attention} waiting for you`,
                }
              : { tabBarAccessibilityLabel: 'Home' }),
          }}
          listeners={({ navigation, route }) => ({
            tabPress: () => onTabPress(route.name, navigation.isFocused()),
          })}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: 'Chats',
            tabBarIcon: icon(MessagesSquare),
            tabBarAccessibilityLabel: 'Chats',
          }}
          listeners={({ navigation, route }) => ({
            tabPress: () => onTabPress(route.name, navigation.isFocused()),
          })}
        />
        <Tabs.Screen
          name="runs"
          options={{
            title: 'Work',
            tabBarIcon: icon(Workflow),
            tabBarAccessibilityLabel: 'Work',
          }}
          listeners={({ navigation, route }) => ({
            tabPress: () => onTabPress(route.name, navigation.isFocused()),
          })}
        />
        <Tabs.Screen
          name="projects"
          options={{
            title: 'Projects',
            tabBarIcon: icon(FolderGit2),
            tabBarAccessibilityLabel: 'Projects',
          }}
          listeners={({ navigation, route }) => ({
            tabPress: () => onTabPress(route.name, navigation.isFocused()),
          })}
        />
      </Tabs>

      {/* Plan §6.2 — the accessory strip. A sibling of the navigator rather
          than a child of any tab, so it survives tab changes and never
          re-mounts with the screen underneath it. */}
      <NeedsYouStrip count={attention} offset={metrics.height} />
    </View>
  );
}
