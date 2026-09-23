// Shell geometry.
//
// The bottom tab bar is gone: the navigation drawer (src/navigation/shell)
// carries every destination, which gives the whole height of the phone to the
// content. What remains here is where floating chrome and list ends sit now
// that the only thing under a scene is the system's own bottom inset (the
// home indicator on iOS, the gesture pill or 3-button bar on Android).

/** Hex `#rrggbb` to rgba, for callers that need a translucent tint. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Content insets inside the shell ─────────────────────────────

/** HIG / M3 FAB diameter. */
export const FAB_SIZE = 56;
/** Gap between the FAB and whatever it floats above. */
export const FAB_MARGIN = 16;

export interface TabContentInsets {
  /** Kept for callers that lay out against it; nothing overlays a scene any more. */
  barOverlap: number;
  /** `bottom` for a FAB in a top-level scene. */
  fabBottom: number;
  /** Bottom padding a list needs so its last row clears the inset (and the FAB). */
  listBottom: (hasFab: boolean) => number;
}

/**
 * Where floating chrome and list ends sit in a top-level scene.
 *
 * `bottomInset` is the system inset. The FAB floats a margin above it; a
 * list's last row ends above the FAB, or above the inset when there is none.
 */
export function shellContentInsets(bottomInset: number): TabContentInsets {
  const inset = Math.max(0, bottomInset);
  const fabBottom = inset + FAB_MARGIN;
  return {
    barOverlap: 0,
    fabBottom,
    listBottom: (hasFab) => (hasFab ? fabBottom + FAB_SIZE + FAB_MARGIN : inset + FAB_MARGIN + 8),
  };
}
