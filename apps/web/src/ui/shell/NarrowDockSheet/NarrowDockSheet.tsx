// ────────────────────────────────────────────────────────────────
// S-09 NarrowDockSheet (03 §4 S-09; D-19, D-27; 06 §2.5, §4.3).
//
// Below a 1200px window the dock is a sheet over the chat, inside the main
// card: absolute on the right of its (positioned) host, full height of the
// host (which starts under the page header), `w-sheet` (380) — the full host
// width when `fullWidth` (viewport < 768) — `bg-overlay`, a `line` border on
// the hinge, `shadow-pop`, on the dock layer.
//
// Non-modal (D-19): `role="dialog"` WITHOUT `aria-modal`, no backdrop, no focus
// trap — the chat beside it stays usable — and `data-gai-overlay="sheet"`, so a
// native browser view the sheet CONTAINS ignores it (ancestor exemption) while
// one elsewhere hides under it.
//
// Why this is a surface and not a P-33 Sheet (Base UI Dialog): the dock body
// must be ONE stable React tree across the 1200px breakpoint (06 §4.3 item 3)
// — a portal or a different parent element on the other side of the
// breakpoint would remount every terminal and recreate every native browser
// view. So S-08 DockFrame always renders this element around the dock body and
// only flips `active`: active = sheet styling + dialog semantics; inactive =
// a plain positioned surface whose geometry the frame supplies (`className`).
// The sheet's look is P-33's `sheetPopupVariants` (shared, not copied).
// `open={false}` hides it with `visibility:hidden` + `inert` (never
// `display:none`: `NativeBrowserView.isContainerHidden()` relies on it).
// Motion (D-108, `motion-dock`): as a sheet it slides in from the right edge
// and back out; as the panel surface it follows the split's easing. Either
// way `visibility` turns hidden only when the close has finished, and it is
// inert from the moment it starts closing.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, Ref } from 'react';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { sheetPopupVariants } from '../../primitives/Sheet/Sheet.js';

export interface NarrowDockSheetProps extends ComponentProps<'div'> {
  /** Sheet mode (window < 1200). False: a plain surface placed by `className`. */
  active: boolean;
  /** Viewport < 768 (or a host too narrow for two columns): the sheet takes the host's full width. */
  fullWidth?: boolean;
  /** Collapsed (dock closed): hidden, never unmounted. Default true. */
  open?: boolean;
  /** The dialog's accessible name while `active`. Default "Side pane". */
  label?: string;
  ref?: Ref<HTMLDivElement>;
}

/** The dock's own surface; a non-modal 380px sheet while `active`. */
export function NarrowDockSheet({
  active,
  fullWidth = false,
  open = true,
  label = 'Side pane',
  className,
  children,
  ...rest
}: NarrowDockSheetProps) {
  return (
    <div
      {...rest}
      {...(active ? { role: 'dialog', 'aria-label': label, ...overlayProps('sheet') } : {})}
      data-open={open || undefined}
      inert={!open}
      className={cn(
        active && [
          sheetPopupVariants({ side: 'right', contained: true }),
          // The dock layer (D-41), not the dialog layer: menus opened from the sheet sit above it.
          'z-dock',
          fullWidth ? 'w-full border-l-0' : 'w-sheet',
        ],
        'motion-dock',
        !open && ['invisible', active && 'translate-x-full'],
        className,
      )}
    >
      {children}
    </div>
  );
}
