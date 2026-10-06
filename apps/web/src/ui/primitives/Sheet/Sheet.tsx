// ────────────────────────────────────────────────────────────────
// P-33 Sheet — a side panel as a dialog (03 §2 P-33; Base UI Dialog).
// Replaces `components/ui/Drawer.tsx` (deleted with the legacy layer, 03 §8).
//
// `bg-overlay`, a 1px `line` border on the hinge side only (`border-l` for
// side="right", `border-r` for side="left"), `shadow-pop`, no radius; full
// height of its box; `w-sheet` (380, the narrow dock) unless `width` is given.
//
// Two modes (D-19, D-27; 06 §2.5, §4.1):
// - `modal` (default): `bg-scrim` backdrop, focus trapped, the page behind
//   inert, outside press / Escape close, focus returns to the trigger.
// - `modal={false}`: the narrow dock sheet. NO backdrop element at all — a
//   scrim would not be an ancestor of the native browser view's container and
//   would hide that view forever — no focus trap, no `aria-modal`, and an
//   outside press does not close it (the chat beside it stays usable); the
//   caller closes it (Close button, Escape). `dismissible` overrides that.
// Every rendered layer carries `data-gai-overlay`: the popup `sheet`, the
// backdrop (modal only) `backdrop`. The desktop app's native browser view
// ignores the sheet when the sheet CONTAINS it (ancestor exemption).
//
// `container` portals the sheet into an element (the main card) instead of
// <body>; the sheet is then `absolute` against that element (which must be
// positioned), so the caller places it — e.g. `top-11` below the 44px header.
// `onOpenChange` receives Base UI's event details as its second argument, so a
// caller can `details.cancel()` a close it does not want (Escape from a
// terminal that owns every key).
// Parts: `SheetBody` (pad 16, gap 16, scrolls), `SheetFooter` (56h, actions
// right), `SheetClose` for a Cancel button.
// ────────────────────────────────────────────────────────────────

import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { IconButton } from '../IconButton/IconButton.js';

export type SheetSide = 'right' | 'left';

export const sheetPopupVariants = cva(
  'inset-y-0 z-dialog flex max-w-full flex-col overflow-hidden border-line bg-overlay text-fg shadow-pop outline-none',
  {
    variants: {
      side: {
        right: 'right-0 border-l',
        left: 'left-0 border-r',
      },
      // In a container: positioned against it; otherwise against the viewport.
      contained: {
        true: 'absolute',
        false: 'fixed',
      },
    },
    defaultVariants: { side: 'right', contained: false },
  },
);

type FocusTarget = BaseDialog.Popup.Props['initialFocus'];
type FinalFocusTarget = BaseDialog.Popup.Props['finalFocus'];
export type SheetContainer = BaseDialog.Portal.Props['container'];
export type SheetChangeDetails = BaseDialog.Root.ChangeEventDetails;

export interface SheetProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  open?: boolean;
  onOpenChange?: (open: boolean, details: SheetChangeDetails) => void;
  defaultOpen?: boolean;
  /** Optional trigger element (a Button); omit when `open` is controlled. */
  trigger?: ReactElement;
  /** The hinge edge. Default `right`. */
  side?: SheetSide;
  /** Width (px number or CSS length). Default: `w-sheet` (380). */
  width?: number | string;
  /** Portal target (the main card). Default: <body>. The sheet is `absolute` inside it. */
  container?: SheetContainer;
  /** `false`: the non-modal narrow dock sheet — no backdrop, no focus trap. Default true. */
  modal?: boolean;
  /** Whether an outside press closes it. Default: `modal`. */
  dismissible?: boolean;
  /** Keep the sheet in the DOM while closed. */
  keepMounted?: boolean;
  /** The sheet's accessible name; shown in the header unless `header={false}`. */
  title: ReactNode;
  /** Draw the 48h header (title, actions, close). Default true. */
  header?: boolean;
  /** Header content between the title and the close button. */
  actions?: ReactNode;
  /** Element focused on open. Default: the first focusable element inside. */
  initialFocus?: FocusTarget;
  /** Element focused on close. Default: the trigger, else what had focus before. */
  finalFocus?: FinalFocusTarget;
  children?: ReactNode;
}

/** A side panel: modal with a scrim by default, or non-modal without one (the narrow dock). */
export function Sheet({
  open,
  onOpenChange,
  defaultOpen,
  trigger,
  side = 'right',
  width,
  container,
  modal = true,
  dismissible,
  keepMounted = false,
  title,
  header = true,
  actions,
  initialFocus,
  finalFocus,
  className,
  style,
  children,
  ...rest
}: SheetProps) {
  const contained = container != null;
  return (
    <BaseDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      modal={modal}
      disablePointerDismissal={!(dismissible ?? modal)}
      onOpenChange={(next, details) => onOpenChange?.(next, details)}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal container={container} keepMounted={keepMounted}>
        {/* Non-modal: no backdrop element at all (D-19). */}
        {modal ? (
          <BaseDialog.Backdrop
            className={cn(contained ? 'absolute' : 'fixed', 'inset-0 z-dialog bg-scrim motion-fade')}
            {...overlayProps('backdrop')}
          />
        ) : null}
        <BaseDialog.Popup
          {...rest}
          className={cn(
            sheetPopupVariants({ side, contained }),
            side === 'left' ? 'motion-sheet-start' : 'motion-sheet-end',
            width === undefined && 'w-sheet',
            className,
          )}
          style={width !== undefined ? { ...style, width } : style}
          {...(initialFocus !== undefined ? { initialFocus } : {})}
          {...(finalFocus !== undefined ? { finalFocus } : {})}
          // Headerless: named by aria-label, not an invisible heading in the outline.
          {...(!header && typeof title === 'string' ? { 'aria-label': title } : {})}
          {...overlayProps('sheet')}
        >
          {header ? (
            <div className="flex h-dialog-bar shrink-0 items-center gap-2 border-b border-line-soft pr-2.5 pl-4">
              <BaseDialog.Title className="min-w-0 flex-1 truncate text-title text-fg">{title}</BaseDialog.Title>
              {actions}
              <BaseDialog.Close render={<IconButton icon="x" label="Close" tooltip={false} />} />
            </div>
          ) : (
            <>
              {typeof title === 'string' ? null : <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>}
              {/* Touch screen readers need a way out of a modal (Base UI); keyboard users have Escape. */}
              {modal ? (
                <BaseDialog.Close className="sr-only" tabIndex={-1}>
                  Close
                </BaseDialog.Close>
              ) : null}
            </>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface SheetBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Scrolling content area: pad 16, gap 16. */
export function SheetBody({ className, children, ...rest }: SheetBodyProps) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SheetFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** Left-aligned hint (small fg-3). */
  hint?: ReactNode;
  /** Actions, right-aligned (Cancel, primary). */
  children?: ReactNode;
}

/** 56h footer: hint on the left, actions on the right. */
export function SheetFooter({ hint, className, children, ...rest }: SheetFooterProps) {
  return (
    <div className={cn('flex h-footer shrink-0 items-center gap-2 border-t border-line-soft px-4', className)} {...rest}>
      {hint != null ? <span className="min-w-0 truncate text-small text-fg-3">{hint}</span> : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Closes the sheet; render a Button through it: `<SheetClose render={<Button />}>Cancel</SheetClose>`. */
export const SheetClose = BaseDialog.Close;
