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
// v2: the search field lives INSIDE the collapsing block, so it folds away
// with the large title exactly as a `UISearchController` does — and stays
// pinned while it has focus, because a field that scrolls away under the
// keyboard it summoned is the one thing worse than no search. `headerRight`
// is the v2 name for `trailing`; both work.
//
// Two defects the previous version fixed and this one keeps fixed:
//   • The title was rendered twice and both copies were readable, so every
//     screen announced its name twice to a screen reader.
//   • `router.back()` was called unconditionally. Arriving from a push
//     notification into `/runs/<id>` produces a stack with no history, so the
//     back button did nothing and the user was stranded on a detail screen.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useRef, useState } from 'react';
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
import { usePreferences } from '../../prefs/preferences';
import { usePullToRefresh } from './usePullToRefresh';
import { READABLE_MAX_WIDTH } from './windowInsets';

/**
 * iPad / landscape: header and content share one centred column. Phones in
 * portrait are narrower than the cap, so this is a no-op there.
 */
const COLUMN = { width: '100%', maxWidth: READABLE_MAX_WIDTH, alignSelf: 'center' } as const;

const noop = (): void => undefined;

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

export interface ScreenSearch {
  value: string;
  /** v2 name. */
  onChange?: (next: string) => void;
  /** v1 name; either works. */
  onChangeText?: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

export function ScreenHeader({
  title,
  subtitle,
  scrollY,
  leading,
  trailing,
  below,
  belowPinned = false,
  variant = 'large',
}: {
  title: string;
  subtitle?: string;
  /** When supplied, the title collapses as the content scrolls. */
  scrollY?: SharedValue<number>;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Rendered inside the collapsing block, under the title — the search field. */
  below?: React.ReactNode;
  /** Keep `below` visible regardless of scroll — while search has focus. */
  belowPinned?: boolean;
  /**
   * `large` (default): nav row + a 30pt title that collapses into it.
   * `compact`: ONE ~52pt row with a bold 22pt title and the trailing actions
   * — the tab-root header. A large title on a tab root cost ~110pt of every
   * first screen and, because tab lists own their scroller, never collapsed.
   */
  variant?: 'large' | 'compact';
}): React.ReactElement {
  const fallback = useSharedValue(0);
  // Settings → Accessibility → "Large titles collapse". Off, the header
  // reads the constant 0 instead of the scroll offset, so every interpolation
  // below holds at its resting value and the large title simply stays.
  const { largeTitleCollapse } = usePreferences();
  const y = largeTitleCollapse && scrollY ? scrollY : fallback;
  // The large block's natural height, measured from an unconstrained inner
  // view. Collapsing used to animate opacity only, so the title faded but
  // its ~48pt stayed reserved and scrolling reclaimed no space at all.
  const largeHeight = useSharedValue(0);

  const largeStyle = useAnimatedStyle(() => {
    const h = largeHeight.value;
    return {
      opacity: interpolate(y.value, [0, COLLAPSE_RANGE], [1, 0], 'clamp'),
      transform: [{ translateY: interpolate(y.value, [0, COLLAPSE_RANGE], [0, -8], 'clamp') }],
      ...(h > 0 ? { height: interpolate(y.value, [0, COLLAPSE_RANGE], [h, 0], 'clamp') } : {}),
    };
  });

  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [COLLAPSE_RANGE * 0.6, COLLAPSE_RANGE], [0, 1], 'clamp'),
  }));

  // The search row folds a beat after the title so the two read as one
  // block collapsing rather than two things disappearing at once.
  const belowStyle = useAnimatedStyle(
    () => ({
      opacity: belowPinned ? 1 : interpolate(y.value, [COLLAPSE_RANGE * 0.5, COLLAPSE_RANGE * 1.5], [1, 0], 'clamp'),
      transform: [
        {
          translateY: belowPinned ? 0 : interpolate(y.value, [0, COLLAPSE_RANGE * 1.5], [0, -6], 'clamp'),
        },
      ],
    }),
    [belowPinned],
  );

  if (variant === 'compact') {
    return (
      <View className="bg-background px-4 pb-1">
        <View className="flex-row items-center gap-2" style={{ minHeight: 52 }}>
          {leading}
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.control}
            className="flex-1 font-bold text-foreground"
            style={{ fontSize: 22, lineHeight: 28 }}
          >
            {title}
          </Text>
          {trailing}
        </View>
        {below ? <View className="pb-1 pt-1">{below}</View> : null}
      </View>
    );
  }

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
        <View className="flex-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
      <Animated.View style={[largeStyle, { overflow: 'hidden' }]}>
        <View
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height;
            if (next > 0 && Math.abs(next - largeHeight.value) > 0.5) largeHeight.value = next;
          }}
        >
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
        </View>
      </Animated.View>

      {below ? (
        <Animated.View style={belowStyle} className="pt-2">
          {below}
        </Animated.View>
      ) : null}
    </View>
  );
}

export function Screen({
  title,
  subtitle,
  trailing,
  headerRight,
  leading,
  back = false,
  backFallback,
  onBack,
  onRefresh,
  refreshing = false,
  search,
  children,
  /** Set when the screen supplies its own scroller (a virtualised list). */
  scroll = true,
  contentClassName = '',
  /** Extra bottom clearance. Tab screens pass the FAB's height. */
  bottomInset = 0,
  scrollY: externalScrollY,
  variant = 'large',
}: {
  title?: string;
  subtitle?: string;
  /** Trailing header slot. `headerRight` is the v2 name for the same slot. */
  trailing?: React.ReactNode;
  headerRight?: React.ReactNode;
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
  /** Replace the default pop; for a sheet-like screen that confirms first. */
  onBack?: () => void;
  /** May return a promise; the spinner then ends when it settles. */
  onRefresh?: () => unknown;
  /**
   * Whether the data is fetching. The spinner only shows for a USER pull —
   * a background poll that flips this does not drop a spinner over the page.
   */
  refreshing?: boolean;
  /** Renders a search field under the title that collapses with it. */
  search?: ScreenSearch;
  children: React.ReactNode;
  scroll?: boolean;
  contentClassName?: string;
  bottomInset?: number;
  /**
   * When the screen owns its scroller (`scroll={false}`), pass the shared
   * value its `useAnimatedScrollHandler` writes so the title still collapses.
   */
  scrollY?: SharedValue<number>;
  /** Header style. Tab roots pass `compact`; see `ScreenHeader`. */
  variant?: 'large' | 'compact';
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? internalScrollY;
  const scroller = useRef<Animated.ScrollView>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const pull = usePullToRefresh(onRefresh ?? noop, refreshing);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else goBack(backFallback);
  }, [onBack, backFallback]);

  const trailingSlot = headerRight ?? trailing;

  // `IconButton` is a full platform-minimum box (44pt / 48dp) with the
  // `tap` haptic — the back button must never be the one control on the
  // screen that is smaller than the finger.
  const leadingSlot =
    leading ??
    (back ? (
      <IconButton
        accessibilityLabel="Back"
        accessibilityHint="Returns to the previous screen"
        icon={<ChevronLeft size={24} color={colors.foreground} />}
        onPress={handleBack}
        haptic="tap"
      />
    ) : undefined);

  const onSearchChange = search?.onChange ?? search?.onChangeText;
  const searchNode =
    search && onSearchChange ? (
      <SearchField
        value={search.value}
        onChangeText={onSearchChange}
        placeholder={search.placeholder ?? 'Search'}
        autoFocus={search.autoFocus ?? false}
        {...(search.onSubmit ? { onSubmit: search.onSubmit } : {})}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        onCancel={() => setSearchFocused(false)}
      />
    ) : null;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View style={COLUMN}>
        {title ? (
          <ScreenHeader
            title={title}
            {...(subtitle ? { subtitle } : {})}
            scrollY={scrollY}
            leading={leadingSlot}
            trailing={trailingSlot}
            below={searchNode}
            belowPinned={searchFocused}
            variant={variant}
          />
        ) : searchNode ? (
          // No title to collapse under: the field simply sits at the top.
          <View className="px-4 pb-2 pt-1">{searchNode}</View>
        ) : null}
      </View>

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
          contentContainerStyle={[
            COLUMN,
            {
              padding: 16,
              paddingBottom: insets.bottom + 24 + bottomInset,
              gap: 12,
            },
          ]}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={colors['muted-foreground']}
                colors={[colors.primary ?? '']}
              />
            ) : undefined
          }
        >
          {children}
        </Animated.ScrollView>
      ) : (
        <View className={`flex-1 ${contentClassName}`} style={COLUMN}>
          {children}
        </View>
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
  onRefresh?: () => unknown;
  /** Whether data is fetching; the spinner shows only for a user pull. */
  refreshing?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const pull = usePullToRefresh(onRefresh ?? noop, refreshing);
  return (
    <ScrollView
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors['muted-foreground']} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
