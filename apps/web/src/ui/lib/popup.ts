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

/**
 * Popover box (P-29): a fixed-width card never wider than the room Base UI
 * measured between the anchor's collision boundary edges, so a 340 card
 * anchored in a narrow dock still fits the window.
 */
export const popoverClamp =
  // --available-width: Base UI's usable width for the popup inside the viewport.
  'max-w-(--available-width)';

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

/**
 * Dialog `placement="top"` (03 §2 P-31, the command palette): 120px below the
 * top of a 900px window ≈ 13vh, and never closer than 22px to the bottom edge
 * (the clamp's bottom margin). Viewport arithmetic has no token.
 */
export const dialogTop = 'top-[13vh] max-h-[calc(87vh-22px)]';

/**
 * Fixed dialog boxes without a height/width token (`SHELL.dialogWidth` in
 * packages/design-tokens chrome.ts): `lg` Settings 960×640 (the width is the
 * `w-dialog-lg` token), `xl` Run dialog 1040×856. `dialogClamp` still wins on
 * a smaller window.
 */
export const dialogHeightLg = 'h-[640px]';
export const dialogBoxXl = 'h-[856px] w-[1040px]';

/**
 * T-04 Workspace (03 §5 T-04): the transcript/timeline column's reading
 * width when the dock is closed — a fixed literal with no vocabulary entry
 * (unlike the shell's named widths, `SHELL`/`CONTAINER_NAMES`), so it lives
 * here alongside the dialog box literals above.
 */
export const workspaceMainMaxWidth = 'max-w-[860px]';

/**
 * T-04 Workspace, D-27: below the 1200px window the dock renders as a
 * non-modal overlay sheet (380 wide) elsewhere in the tree; `main` reserves
 * this much right padding so its content never sits under the floating
 * sheet. Viewport-derived literal, no token.
 */
export const workspaceNarrowPadding = 'pr-[404px]';

/**
 * Picker popups (03 §2.1 B-01 ModelPicker 620×384, B-02 AgentPicker 760×508):
 * fixed board boxes with no SHELL token, like the dialog boxes above. Both
 * shrink to Base UI's room beside the anchor (`--available-height`) and to the
 * window width minus the popup's 8px collision margin on each side.
 */
export const modelPickerBox = 'h-[384px] max-h-(--available-height) w-[620px] max-w-[calc(100vw-16px)]';
export const agentPickerBox = 'h-[508px] max-h-(--available-height) w-[760px] max-w-[calc(100vw-16px)]';
