// The terminal font size (MB-27, MD-78): one preference for every shell — pinch or A− / A+ in any terminal resizes
// them all — persisted in MMKV, clamped 10–20, with a `fontStep` haptic per point.
import { prefs } from '../../../services/storage/prefs';
import { haptic } from '../../../ui/platform/haptics';
import { FONT_SIZE_DEFAULT, TERMINAL_PREF_KEYS, clampFontSize } from '../engine/terminalSettings';

type Listener = (size: number) => void;
const listeners = new Set<Listener>();
let current: number | null = null;

export function getTerminalFont(): number {
  if (current === null) {
    try {
      const stored = prefs.getString(TERMINAL_PREF_KEYS.fontSize);
      current = clampFontSize(stored === undefined ? FONT_SIZE_DEFAULT : Number(stored));
    } catch {
      current = FONT_SIZE_DEFAULT;
    }
  }
  return current;
}

export function setTerminalFont(next: number): void {
  const size = clampFontSize(next);
  if (size === getTerminalFont()) return;
  current = size;
  try {
    prefs.setString(TERMINAL_PREF_KEYS.fontSize, String(size));
  } catch {
    // A preference write never blocks the terminal.
  }
  haptic('fontStep');
  for (const listener of listeners) listener(size);
}

export function subscribeTerminalFont(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
