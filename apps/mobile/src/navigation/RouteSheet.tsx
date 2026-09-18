// ────────────────────────────────────────────────────────────────
// RouteSheet — the scaffold for a route-addressable sheet.
//
// `/approvals`, `/chats/[id]/gate/[interactionId]`, `/chats/[id]/plan/[planId]`
// and `/scope-request` are real routes (a push notification can open them
// cold) presented as `formSheet` on iOS and a modal on Android. The
// navigator header is off for them; this draws the title row with a Close
// that works with NO history behind it — the cold-start case — by falling
// back to the tab shell.
//
// Content is a plain scroller by default. A screen that owns its own list
// passes `scroll={false}`.
//
// `footer` — the primary action(s). A form sheet opens at the 0.6 detent, so
// a Send / Approve button at the END of the scroll content started below the
// visible part of the sheet, under the fold, with nothing saying it was
// there. The footer is pinned under the scroller instead, always on screen
// at every detent. Put the one or two buttons that complete the sheet here;
// leave explanatory text in the content.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { IconButton } from '../components/ui/Button';
import { goBack } from '../components/ui/Screen';
import { MAX_SCALE } from '../components/ui/accessibility';
import { usePullToRefresh } from '../components/ui/usePullToRefresh';
import { KeyboardSticky } from '../components/ui/KeyboardSticky';
import { useWindowInsets } from '../components/ui/windowInsets';
import { useTheme } from '../theme/ThemeProvider';

/**
 * iOS presents these routes as a native `formSheet`: UIKit places the sheet
 * below the status bar, lifts it above the keyboard itself, and presents it
 * OUTSIDE `ConnectionStripHost` — so the side insets that host pays are not
 * paid for it (landscape notch). Android / web present an in-hierarchy modal
 * inside the host, where the opposite holds on all three counts. That is a
 * genuine presentation difference, hence the branch.
 */
const NATIVE_SHEET = Platform.OS === 'ios';

function useSheetInsets(): { top: number; left: number; right: number } {
  const insets = useSafeAreaInsets();
  const window = useWindowInsets();
  return NATIVE_SHEET
    ? { top: 8, left: window.left, right: window.right }
    : { top: insets.top, left: 0, right: 0 };
}

export function RouteSheet({
  title,
  subtitle,
  action,
  children,
  footer,
  scroll = true,
  onRefresh,
  refreshing = false,
  fallback = '/(tabs)',
}: {
  title: string;
  subtitle?: string;
  /** Trailing slot in the title row, replacing the default Close. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /**
   * Pinned below the content, outside the scroller: the sheet's primary
   * action(s). Stays visible at the 0.6 detent and above the keyboard.
   */
  footer?: React.ReactNode;
  scroll?: boolean;
  onRefresh?: () => unknown;
  /** Whether data is fetching; the spinner shows only for a user pull. */
  refreshing?: boolean;
  /** Where Close goes when there is nothing to pop. */
  fallback?: Parameters<typeof goBack>[0];
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { top, left, right } = useSheetInsets();
  const pull = usePullToRefresh(onRefresh ?? (() => undefined), refreshing);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: top, paddingLeft: left, paddingRight: right }}>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-1">
        <View className="flex-1 gap-0.5">
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.control}
            className="text-xl font-bold text-foreground"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} className="text-sm text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ?? (
          <IconButton
            accessibilityLabel="Close"
            accessibilityHint="Closes this sheet"
            icon={<X size={20} color={colors['muted-foreground']} />}
            onPress={() => goBack(fallback)}
          />
        )}
      </View>

      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          // iOS: inset the content by the keyboard so a focused field near
          // the end can scroll into view. No-op elsewhere.
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            padding: 16,
            // With a footer, the footer owns the home-indicator inset.
            paddingBottom: footer ? 24 : insets.bottom + 32,
            gap: 12,
          }}
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
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}

      {footer ? (
        <KeyboardSticky
          mode="padding"
          // The native sheet already rides above the keyboard (see above).
          enabled={!NATIVE_SHEET}
          offset={insets.bottom}
          className="border-t border-border-muted bg-background"
        >
          {/* Inner view: `padding` mode owns the outer paddingBottom. */}
          <View className="gap-2 px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
            {footer}
          </View>
        </KeyboardSticky>
      ) : null}
    </View>
  );
}
