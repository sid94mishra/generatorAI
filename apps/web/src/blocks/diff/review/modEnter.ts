// The "Mod+Enter" chord the review cards submit with: ⌘ on macOS, Ctrl on
// Windows and Linux (the same SPA runs in every browser and the desktop shell).

import type { KeyboardEvent } from 'react';
import { isMacOS } from '@/lib/desktop.js';

/** For a `Kbd` / Button `shortcut`: `['⌘', '↵']` or `['Ctrl', '↵']`. */
export const MOD_ENTER_KEYS: readonly string[] = [isMacOS ? '⌘' : 'Ctrl', '↵'];

/** For a placeholder or a tooltip, where a Kbd cannot go: `⌘↵` / `Ctrl+↵`. */
export const MOD_ENTER_TEXT = isMacOS ? '⌘↵' : 'Ctrl+↵';

/** Either modifier is accepted on every OS, as before (a Mac keyboard on Linux, Ctrl on a Mac). */
export function isModEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}
