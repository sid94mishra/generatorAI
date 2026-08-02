// ────────────────────────────────────────────────────────────────
// Sheet — a bottom sheet for scoped tasks.
//
// Follows the platform conventions for sheets (Apple HIG):
//   * a grabber, which signals resizability and is reachable by VoiceOver
//   * tap-outside and swipe-down to dismiss, not just a close button
//   * one sheet at a time; never a sheet on top of a sheet
//   * scoped, short content — a sheet is not a place to hide a multi-step flow
//
// ── Why this is NOT built on `Modal` ────────────────────────────
//
// `Modal` renders into a separate host subtree. `ThemeProvider` injects the
// palette as NativeWind variables on a wrapper View, and every themed class
// (`bg-card`, `text-foreground`) resolves against those variables — so inside
// a Modal they resolve to nothing and the sheet painted fully TRANSPARENT,
// with the screen behind showing through, in both light and dark. On
// react-native-web the modal host also lands at `z-index: 0`, so the composer
// drew on top of it.
//
// Rendering inline keeps the sheet inside the themed subtree and inside the
// normal stacking context, which behaves identically on iOS, Android and web.
// The one thing `Modal` gave us for free — Android hardware-back — is wired
// explicitly below.
// ─────────────────────────────────────────────────────────

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeProvider';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Optional trailing action rendered in the sheet header. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /**
   * Cap the sheet height as a fraction of the screen. Defaults to a
   * "medium detent" so the content behind stays partly visible, which is what
   * makes a sheet feel like a sheet rather than a new screen.
   */
  maxHeightRatio?: number;
}

export function Sheet({
  visible,
  onClose,
  title,
  action,
  children,
  maxHeightRatio = 0.82,
}: SheetProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const { style: themeVars } = useTheme();

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android hardware back must dismiss, or the sheet becomes a trap.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/*
        The theme variables MUST be re-applied here.

        `ThemeProvider` publishes the palette as a NativeWind `vars()` object
        and applies it to a wrapper View; every themed class (`bg-card`,
        `text-foreground`) resolves against it. A `Modal` renders into a
        separate host subtree that is NOT a descendant of that wrapper, so
        without this the whole sheet painted transparent — the chat showed
        straight through it, in both light and dark.

        `zIndex` is explicit for the same class of reason: on
        react-native-web the modal host lands at `z-index: 0`, so the composer
        drew on top of the sheet.
      */}
      <View
        style={[StyleSheet.absoluteFill, themeVars, { justifyContent: 'flex-end', zIndex: 50 }]}
      >
        {/* Scrim. Tapping outside dismisses — expected on both platforms. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          className="bg-overlay/70"
        />

        <View
          className="rounded-t-xl border-t border-border bg-card"
          style={{ maxHeight: `${Math.round(maxHeightRatio * 100)}%` }}
        >
          {/* Grabber */}
          <View className="items-center pt-2">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>

          <View className="flex-row items-center justify-between gap-3 px-4 pb-2 pt-3">
            <Text className="flex-1 text-lg font-semibold text-foreground">{title}</Text>
            {action}
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
            // Lets a row be tapped while the keyboard is up, instead of the
            // first tap only dismissing the keyboard.
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** A tappable row inside a sheet, with an optional selected checkmark. */
export function SheetRow({
  title,
  subtitle,
  selected = false,
  onPress,
  right,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`flex-row items-center gap-3 px-4 py-3 ${selected ? 'bg-accent' : ''}`}
    >
      <View className="flex-1">
        <Text
          className={`text-base ${selected ? 'font-semibold text-primary' : 'text-foreground'}`}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

/** A section heading inside a sheet. */
export function SheetSection({ title }: { title: string }): React.ReactElement {
  return (
    <Text className="px-4 pb-1 pt-4 text-xs uppercase tracking-wide text-muted-foreground">
      {title}
    </Text>
  );
}
