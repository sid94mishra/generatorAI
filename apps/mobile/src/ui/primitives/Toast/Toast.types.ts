// MP-30 Toast contract (03 MP-30; MD-26, MD-58). No success toasts.
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type ToastKind = 'error' | 'background' | 'undo';

export interface ToastOptions {
  kind: ToastKind;
  message: string;
  /** 'background': "Open"; 'error': "Retry". */
  action?: { label: string; onPress: () => void };
  /** Required for 'undo'. `commit` runs when the toast expires, is dismissed or is replaced — not when undone. */
  undo?: { onUndo: () => void; commit?: () => Promise<void> };
  /** Leading glyph (default: circle-x for errors, none otherwise). */
  icon?: MobileIconConcept;
  /** Defaults: error 6 s, background 4 s, undo 5 s (MD-58). */
  durationMs?: number;
  testID?: string;
}

export interface ToastHandle {
  dismiss: () => void;
}

export interface ToastHostProps {
  /** Extra space above the safe area when a composer, NewAction or bar sits at the bottom (MD-58). */
  bottomOffset?: number;
}
