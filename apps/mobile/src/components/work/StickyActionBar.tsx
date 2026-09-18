// ────────────────────────────────────────────────────────────────
// StickyActionBar — a screen's primary action, pinned above the safe area.
//
// Spec: a detail screen with one primary action (workflow Run) keeps it in
// thumb reach instead of at the end of a scroll. Pair with
// `STICKY_BAR_SPACE` at the end of the scroll content so nothing hides under it.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const STICKY_BAR_SPACE = 88;

export function StickyActionBar({ children }: { children: React.ReactNode }): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute bottom-0 left-0 right-0 border-t border-border-muted bg-background px-4 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      {children}
    </View>
  );
}
