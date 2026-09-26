// ────────────────────────────────────────────────────────────────
// Gate-card keyboard defaults (B-20; `GATE_ACTIONS` in the ui-contract):
// Esc = deny/dismiss, ↵ = the primary action, Mod ↵ = approve. They fire while
// focus is inside the card. A focused button keeps its own plain Enter/Space;
// a multi-line field keeps plain Enter (only Mod ↵ submits from it).
// ────────────────────────────────────────────────────────────────

import type { KeyboardEvent } from 'react';
import { formatBinding, GATE_KEY_BINDINGS, type GateKey } from '@generatorai/shared/ui-contract';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The Kbd chips of a gate key for this viewer (`Mod` → ⌘ on macOS, Ctrl elsewhere). */
export function gateKeyChips(key: GateKey): readonly string[] {
  return formatBinding(GATE_KEY_BINDINGS[key], 'web', { mac: isMac })[0] ?? [];
}

export type GateKeyHandlers = Partial<Record<GateKey, (() => void) | undefined>>;

/** An `onKeyDown` for the card root that runs the action bound to the pressed key. */
export function gateKeyDown(handlers: GateKeyHandlers) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (event.key === 'Escape' && handlers.escape) {
      event.preventDefault();
      event.stopPropagation();
      handlers.escape();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && handlers.mod_enter) {
      event.preventDefault();
      handlers.mod_enter();
      return;
    }
    // A focused button or link keeps its own Enter.
    if (tag === 'BUTTON' || tag === 'A') return;
    if (!mod && handlers.enter && tag !== 'TEXTAREA') {
      event.preventDefault();
      handlers.enter();
    }
  };
}
