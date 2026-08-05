// ────────────────────────────────────────────────────────────────
// Screen — the scaffold every top-level view is built on.
//
// Consolidates the things that were previously re-implemented per screen and
// drifted: safe-area handling, the large title that collapses on scroll,
// search, pull-to-refresh, back navigation, and the loading / empty / error
// triad.
//
// The collapsing title is the single biggest "this feels native" cue on iOS
// and the thing whose absence made the previous screens read as a web page in
// a phone frame. It is driven by a scroll handler on the UI thread, so it
// stays smooth while a chat stream is running on the JS thread.
//
// Two defects this version fixes:
//   • The title was rendered twice and both copies were readable, so every
//     screen announced its name twice to a screen reader.
//   • `router.back()` was called unconditionally. Arriving from a push
//     notification into `/runs/<id>` produces a stack with no history, so the
//     back button did nothing and the user was stranded on a detail screen.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useRef } from 'react';
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
import { SearchField } from './Form';
import { MAX_SCALE } from './accessibility';
import { useTheme } from '../../theme/ThemeProvider';

/** Scroll distance over which the large title shrinks into the nav bar. */
const COLLAPSE_RANGE = 48;

/**
 * Leave the current screen without stranding the user.
 *
 * A deep link, a notification tap or a cold start on a detail route all
 * produce a stack with nothing behind them.
 */
export function goBack(fallback: Parameters<typeof router.replace>[0] = '/(tabs)'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

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
      <View className="min-h-11 flex-row items-center gap-2">
        {leading}
        {/* The compact title is wrapped rather than being `flex-1` itself:
            NativeWind's flex handling on an animated text node does not
            reliably reserve the row, which pulled the trailing action out of
            the right-hand corner and onto its own line.

            It is also hidden from assistive tech. Both copies are always
            mounted so the crossfade can run, and leaving both readable made
            every screen announce its own name twice. */}
        <View
          className="flex-1"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.Text
            numberOfLines={1}
            style={compactStyle}
            maxFontSizeMultiplier={MAX_SCALE.control}
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
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="text-3xl font-bold text-foreground"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} className="mt-0.5 text-sm text-muted-foreground">
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
  backFallback,
  onRefresh,
  refreshing = false,
  search,
  children,
  /** Set when the screen supplies its own scroller (a virtualised list). */
  scroll = true,
  contentClassName = '',
  /** Extra bottom clearance. Tab screens pass the FAB's height. */
  bottomInset = 0,
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
  backFallback?: Parameters<typeof router.replace>[0];
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Renders a search field under the title. */
  search?: { value: string; onChangeText: (next: string) => void; placeholder?: string };
  children: React.ReactNode;
  scroll?: boolean;
  contentClassName?: string;
  bottomInset?: number;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const scrollY = useSharedValue(0);
  const scroller = useRef<Animated.ScrollView>(null);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const onBack = useCallback(() => goBack(backFallback), [backFallback]);

  const leadingSlot =
    leading ??
    (back ? (
      <IconButton
        accessibilityLabel="Back"
        icon={<ChevronLeft size={24} color={colors.foreground} />}
        onPress={onBack}
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

      {search ? (
        <View className="px-4 pb-2">
          <SearchField
            value={search.value}
            onChangeText={search.onChangeText}
            placeholder={search.placeholder ?? 'Search'}
          />
        </View>
      ) : null}

      {scroll ? (
        <Animated.ScrollView
          ref={scroller}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // Dragging the content down dismisses the keyboard, tracking the
          // finger. Both platforms do this; its absence is felt immediately
          // on any screen with a field near the top.
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24 + bottomInset,
            gap: 12,
          }}
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
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
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
