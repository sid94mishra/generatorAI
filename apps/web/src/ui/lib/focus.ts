// ────────────────────────────────────────────────────────────────
// Focus and hit-area helpers for the kit (02 §2.3 focus-ring recipe, 09 §9.3,
// §9.4; D-12, D-15).
//
// `focusRing` is the ONLY way a kit control styles keyboard focus: the
// `focus-ring` utility (globals.css) draws `outline: 2px solid var(--gai-focus)`
// with a 2px offset on :focus-visible. Fields use `fieldFocus` instead (border
// in the focus colour plus the board's 3px `selected` halo).
//
// `hitSlop` + `HIT_ATTRS`: controls that can draw smaller than 24×24 (sm icon
// buttons and chips at compact density, checkboxes, a chip's remove button)
// keep a ≥ 24×24 target (WCAG 2.2 SC 2.5.8) through an invisible ::before
// centred on the control. `data-gai-hit` tells the target-size check
// (ui/lib/test/targetSize.ts) to measure that pseudo-element.
// ────────────────────────────────────────────────────────────────

/** Keyboard focus ring for every interactive kit part. */
export const focusRing = 'focus-ring';

/** Field focus: `border-focus` + 3px `selected` halo; invalid swaps both to err. */
export const fieldFocus =
  'focus-within:border-focus focus-within:ring-3 focus-within:ring-selected';
export const fieldInvalid = 'border-err ring-3 ring-err-bg focus-within:border-err focus-within:ring-err-bg';

/**
 * Invisible ≥ 24×24 hit area centred on a small control. The arbitrary size is
 * the one sanctioned use here: `max(100%, 24px)` keeps larger controls as they
 * are and grows only the ones below the WCAG minimum.
 */
export const hitSlop =
  'relative before:absolute before:top-1/2 before:left-1/2 before:size-[max(100%,24px)] before:-translate-x-1/2 before:-translate-y-1/2';

/** Marks an element whose hit area is its `hitSlop` pseudo-element (09 §9.4). */
export const HIT_ATTRS = { 'data-gai-hit': '' } as const;

/**
 * 8px invisible hit area centred on a 1px separator/resize handle (C-20
 * SplitPane), the same `::before` technique as `hitSlop` but sized for a
 * draggable line rather than a 24×24 control. Lives here (not in
 * ui/patterns) because the literal `h-2`/`w-2` pseudo-element sizes are
 * exempt from the height/arbitrary-value restrictions only in `ui/lib`.
 */
export const separatorHitSlop = {
  /** Separator is a vertical line (splits left/right): widen the hit area horizontally. */
  vertical: 'relative before:absolute before:inset-y-0 before:left-1/2 before:w-2 before:-translate-x-1/2',
  /** Separator is a horizontal line (splits top/bottom): widen the hit area vertically. */
  horizontal: 'relative before:absolute before:inset-x-0 before:top-1/2 before:h-2 before:-translate-y-1/2',
} as const;
