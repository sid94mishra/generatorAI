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
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { IconButton } from '../components/ui/Button';
import { goBack } from '../components/ui/Screen';
import { MAX_SCALE } from '../components/ui/accessibility';
import { useTheme } from '../theme/ThemeProvider';

/** The sheet's own top padding: the form sheet already sits below the status bar on iOS. */
function useSheetTopInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? 8 : insets.top;
}

export function RouteSheet({
  title,
  subtitle,
  action,
  children,
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
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Where Close goes when there is nothing to pop. */
  fallback?: Parameters<typeof goBack>[0];
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = useSheetTopInset();

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: top }}>
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
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
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
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}
    </View>
  );
}
