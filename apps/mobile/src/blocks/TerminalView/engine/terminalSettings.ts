// ────────────────────────────────────────────────────────────────
// Terminal settings — constants shared by the renderer document and the
// React Native host.
//
// Pure constants, no imports: `terminalHtml.ts` (loaded lazily) and
// `TerminalView.tsx` (loaded eagerly) both read these, and this module must
// not drag the vendored xterm bundle onto the eager side, nor MMKV into the
// unit-testable side.
// ────────────────────────────────────────────────────────────────

/** Pinch-to-zoom bounds. Below 10 nothing is legible; above 20 a phone gets ~30 columns. */
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const FONT_SIZE_DEFAULT = 12;

/**
 * Lines kept above the viewport. The web panel keeps 5,000; a phone keeps
 * 2,000 because xterm holds every line as a typed-array row in the WebView's
 * heap, which sits on top of the app's own.
 */
export const SCROLLBACK_LINES = 2000;

/**
 * Bytes of history replayed on attach. Bounded so re-attaching after a tab
 * switch does not pull a whole build log through the bridge; 256 KB is more
 * than 2,000 lines of anything but a progress bar.
 */
export const SCROLLBACK_REPLAY_BYTES = 256 * 1024;

/** MMKV keys (see `src/storage/prefs.ts`). */
export const TERMINAL_PREF_KEYS = {
  fontSize: 'terminal.fontSize',
  /** `auto` | `shown` | `hidden` — see `TerminalView`'s key-bar logic. */
  keyBar: 'terminal.keyBar',
} as const;

export type KeyBarMode = 'auto' | 'shown' | 'hidden';

export function clampFontSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}
