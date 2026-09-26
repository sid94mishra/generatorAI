// ────────────────────────────────────────────────────────────────
// Shared popup recipes for Base UI floating parts (02 §6.4 elevation level 1,
// §6.5 z-order; 03 §2 P-28/P-30/P-19).
//
// Base UI positions popups with CSS variables it sets on the Positioner and
// Popup (`--available-height`, `--anchor-width`). Using
// them needs the `-(--x)` class form, which the ratchet (`varInClassString`)
// allows only here in ui/lib — so every passthrough lives in this file, each
// with the reason next to it (plus the dialog viewport clamp, which needs
// arbitrary `calc()` values).
// ────────────────────────────────────────────────────────────────

/** Level-1 float (menus, popovers, listboxes, tooltips, toasts): overlay fill, line border, `shadow-pop`. */
export const floatSurface = 'border border-line bg-overlay text-fg shadow-pop';

/** Menu / listbox popup box: r8, pad 4, min 220 wide, never taller than the viewport room. */
export const listPopup =
  // --available-height: Base UI's room between the anchor and the viewport edge,
  // so a long menu scrolls instead of overflowing the window.
  'max-h-(--available-height) min-w-55 overflow-y-auto rounded-card p-1 outline-none';

/** A listbox that should be at least as wide as its input (autocomplete, select). */
export const anchorWidth =
  // --anchor-width: the trigger/input width Base UI measures.
  'min-w-(--anchor-width)';

/**
 * Dialog clamp (03 §2 P-31): every dialog size stays inside the window with
 * 32px left/right and 22px top/bottom of breathing room (`100vw − 64`,
 * `100vh − 44`). Viewport arithmetic has no token, so it lives here.
 */
export const dialogClamp = 'max-h-[calc(100vh-44px)] max-w-[calc(100vw-64px)]';
