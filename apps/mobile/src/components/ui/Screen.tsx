// ────────────────────────────────────────────────────────────────
// Screen — the scaffold every top-level view is built on.
//
// Consolidates the four things that were previously re-implemented per
// screen and drifted: safe-area handling, the large title that collapses on
// scroll, pull-to-refresh, and the loading / empty / error triad.
//
// The collapsing title is the single biggest "this feels native" cue on iOS
// and the thing whose absence made the previous screens read as a web page in
// a phone frame. It is driven by a scroll handler on the UI thread, so it
// stays smooth while a chat stream is running on the JS thread.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { IconButton } from './Button';
import { useTheme } from '../../theme/ThemeProvider';

/** Scroll distance over which the large title shrinks into the nav bar. */
const COLLAPSE_RANGE = 48;

export function ScreenHeader({
  title,
  subtitle,
  scrollY,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  /** When supplied, the title collapses as the content scrolls. */
  scrollY?: SharedValue<number>;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}): React.ReactElement {
  const fallback = useSharedValue(0);
  const y = scrollY ?? fallback;

  const largeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, COLLAPSE_RANGE], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(y.value, [0, COLLAPSE_RANGE], [0, -8], 'clamp') }],
  }));

  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [COLLAPSE_RANGE * 0.6, COLLAPSE_RANGE], [0, 1], 'clamp'),
  }));

  return (
    <View className="bg-background px-4 pb-2 pt-1">
      <View className="h-11 flex-row items-center gap-2">
        {leading}
        {/* The compact title is wrapped rather than being `flex-1` itself:
            NativeWind's flex handling on an animated text node does not
            reliably reserve the row, which pulled the trailing action out of
            the right-hand corner and onto its own line. */}
        <View className="flex-1">
          <Animated.Text
            numberOfLines={1}
            style={compactStyle}
            className="text-md font-semibold text-foreground"
          >
            {title}
          </Animated.Text>
        </View>
        {trailing}
      </View>

      {/* The large title sits below the nav row rather than replacing it, so
          the back button never moves as the title collapses. */}
      <Animated.View style={largeStyle}>
        <Text numberOfLines={1} className="text-3xl font-bold text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="mt-0.5 text-sm text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

export function Screen({
  title,
  subtitle,
  trailing,
  leading,
  back = false,
  onRefresh,
  refreshing = false,
  children,
  /** Set when the screen supplies its own scroller (a virtualised list). */
  scroll = true,
  contentClassName = '',
}: {
  title?: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  /**
   * Draw a back button.
   *
   * Screens that use this also turn the NAVIGATOR header off — otherwise the
   * stack's empty title bar and this one stack up, leaving ~90pt of dead
   * space above every settings page.
   */
  back?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
  scroll?: boolean;
  contentClassName?: string;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const scrollY = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const leadingSlot =
    leading ??
    (back ? (
      <IconButton
        accessibilityLabel="Back"
        icon={<ChevronLeft size={24} color={colors.foreground} />}
        onPress={() => router.back()}
      />
    ) : undefined);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {title ? (
        <ScreenHeader
          title={title}
          {...(subtitle ? { subtitle } : {})}
          scrollY={scrollY}
          leading={leadingSlot}
          trailing={trailing}
        />
      ) : null}

      {scroll ? (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 96, gap: 12 }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors['muted-foreground']}
                colors={[colors.primary ?? '']}
              />
            ) : undefined
          }
        >
          {children}
        </Animated.ScrollView>
      ) : (
        <View className={`flex-1 ${contentClassName}`}>{children}</View>
      )}
    </View>
  );
}

/** Non-animated scroller for nested content that must not own a header. */
export function PlainScroll({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors['muted-foreground']}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
