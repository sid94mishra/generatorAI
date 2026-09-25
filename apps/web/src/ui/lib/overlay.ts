// ────────────────────────────────────────────────────────────────
// Overlay contract (D-19, docs/redesign/06-desktop-and-shell.md §4.1).
//
// Every floating layer rendered by ui/ (menus, popovers, selects, comboboxes,
// tooltips, dialogs and their backdrops, sheets, the command palette) carries
// `data-gai-overlay="<kind>"` via `overlayProps(kind)`, spread onto the element
// whose box IS the layer (Base UI Positioner / Popup / Backdrop). The desktop
// app's native browser view — a WebContentsView painted above the DOM — hides
// itself whenever such a layer overlaps it, unless the layer CONTAINS the view
// (the narrow-window dock sheet): see components/chat/nativeBrowserOcclusion.ts.
// ────────────────────────────────────────────────────────────────

export type OverlayKind =
  | 'menu'
  | 'popover'
  | 'select'
  | 'combobox'
  | 'tooltip'
  | 'dialog'
  | 'backdrop'
  | 'sheet'
  | 'toast'
  | 'palette';

/** Spread onto a floating layer: `<Menu.Positioner {...overlayProps('menu')}>`. */
export const overlayProps = (kind: OverlayKind) => ({ 'data-gai-overlay': kind }) as const;

/**
 * The single query the native browser view uses. Sonner cannot tag each toast
 * `<li>` with a custom attribute, so toasts are matched by their own one.
 */
export const GAI_OVERLAY_SELECTOR = '[data-gai-overlay], [data-sonner-toast]';

/**
 * Floating layers of the legacy Radix `components/ui` layer and hand-rolled
 * modals, which do not carry `data-gai-overlay`. Removed in Phase 7 together
 * with components/ui (P7-01).
 */
export const LEGACY_OVERLAY_SELECTOR =
  '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"], [data-modal-open="true"]';
