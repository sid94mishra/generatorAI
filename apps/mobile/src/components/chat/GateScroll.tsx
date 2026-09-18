// ────────────────────────────────────────────────────────────────
// GateScroll — the bounded, scrollable body of a decision card.
//
// The permission, question and plan cards are pinned above the composer.
// Unbounded, a long tool input or a four-question prompt grew the card past
// the viewport — with the keyboard up (a deny reason, a freeform answer) the
// transcript collapsed to nothing and the card's own buttons went off
// screen. The header and the action buttons stay outside this; only the
// content between them scrolls, capped at a share of the window height.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

/** Share of the window the scrollable body of a card may take. */
const BODY_SHARE = 0.32;

export function GateScroll({ children }: { children: React.ReactNode }): React.ReactElement {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      style={{ flexGrow: 0, maxHeight: Math.max(160, Math.round(height * BODY_SHARE)) }}
      contentContainerStyle={{ gap: 12 }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
    >
      {children}
    </ScrollView>
  );
}
