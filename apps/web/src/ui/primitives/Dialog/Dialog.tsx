// ────────────────────────────────────────────────────────────────
// P-31 Dialog (03 §2 P-31; Base UI Dialog). Pulled forward from P4-05 for the
// command palette frame (S-10, P3-05).
//
// Backdrop `bg-scrim`; popup `bg-overlay`, 1px line, dialog radius,
// `shadow-pop`, overflow hidden. Sizes `sm` 420 · `md` 640 · `lg` 960×640 ·
// `xl` 1040×856, each clamped to `100vw−64` × `100vh−44`. `placement="top"`
// (palette: 120px from the top at 900h) or centred. `header` (default) draws
// the 48h header: title (title step) · optional badge · close button;
// `header={false}` keeps the title for assistive tech only (`aria-label`). Parts:
// `DialogBody` (pad 20, gap 20, scrolls) and `DialogFooter` (56h, hint left,
// actions right), `DialogClose` for a Cancel button.
//
// Modal: focus is trapped, the page behind is inert, Escape and the backdrop
// close it, and focus returns to the trigger — or, when the dialog was opened
// from the keyboard without one (the palette's Mod+K), to whatever had focus
// before. Backdrop and popup carry `data-gai-overlay` (D-19) on the dialog
// layer (D-41); `overlay="palette"` marks the command palette.
// ────────────────────────────────────────────────────────────────

import type { ReactElement, ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { dialogBoxXl, dialogClamp, dialogHeightLg, dialogTop } from '../../lib/popup.js';
import { IconButton } from '../IconButton/IconButton.js';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';
export type DialogPlacement = 'center' | 'top';

export const dialogPopupVariants = cva(
  [
    'fixed left-1/2 z-dialog flex -translate-x-1/2 flex-col overflow-hidden',
    'rounded-dialog border border-line bg-overlay text-fg shadow-pop outline-none',
    dialogClamp,
  ],
  {
    variants: {
      size: {
        sm: 'w-dialog-sm',
        md: 'w-dialog',
        lg: cn('w-dialog-lg', dialogHeightLg),
        xl: dialogBoxXl,
      },
      // After the clamp so the top placement's own max-height wins.
      placement: {
        center: 'top-1/2 -translate-y-1/2',
        top: dialogTop,
      },
    },
    defaultVariants: { size: 'md', placement: 'center' },
  },
);

type FocusTarget = BaseDialog.Popup.Props['initialFocus'];
type FinalFocusTarget = BaseDialog.Popup.Props['finalFocus'];

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Optional trigger element (a Button); omit when `open` is controlled. */
  trigger?: ReactElement;
  size?: DialogSize;
  placement?: DialogPlacement;
  /** The dialog's accessible name; shown in the header unless `header={false}`. */
  title: ReactNode;
  /** Draw the 48h header (title, badge, close). Default true. */
  header?: boolean;
  /** Badge beside the title (a Badge or StatusBadge). */
  badge?: ReactNode;
  /** Element focused on open. Default: the first focusable element inside. */
  initialFocus?: FocusTarget;
  /** Element focused on close. Default: the trigger, else what had focus before. */
  finalFocus?: FinalFocusTarget;
  /** D-19 overlay kind of the popup. `palette` for the command palette. */
  overlay?: 'dialog' | 'palette';
  className?: string;
  children?: ReactNode;
  'data-testid'?: string;
}

/** A modal dialog on the dialog layer, with a scrim, focus trap and focus return. */
export function Dialog({
  open,
  onOpenChange,
  defaultOpen,
  trigger,
  size = 'md',
  placement = 'center',
  title,
  header = true,
  badge,
  initialFocus,
  finalFocus,
  overlay = 'dialog',
  className,
  children,
  'data-testid': testId,
}: DialogProps) {
  return (
    <BaseDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      onOpenChange={(next) => onOpenChange?.(next)}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-dialog bg-scrim motion-fade" {...overlayProps('backdrop')} />
        <BaseDialog.Popup
          className={cn(dialogPopupVariants({ size, placement }), 'motion-dialog', className)}
          {...(initialFocus !== undefined ? { initialFocus } : {})}
          {...(finalFocus !== undefined ? { finalFocus } : {})}
          data-testid={testId}
          // Headerless: named by aria-label, not an invisible heading in the outline.
          {...(!header && typeof title === 'string' ? { 'aria-label': title } : {})}
          {...overlayProps(overlay)}
        >
          {header ? (
            <div className="flex h-dialog-bar shrink-0 items-center gap-2 border-b border-line-soft pr-2.5 pl-5">
              <BaseDialog.Title className="min-w-0 truncate text-title text-fg">{title}</BaseDialog.Title>
              {badge}
              <BaseDialog.Close render={<IconButton icon="x" label="Close" tooltip={false} className="ml-auto" />} />
            </div>
          ) : (
            <>
              {typeof title === 'string' ? null : <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>}
              {/* Touch screen readers need a way out of a modal (Base UI); keyboard users have Escape. */}
              <BaseDialog.Close className="sr-only" tabIndex={-1}>
                Close
              </BaseDialog.Close>
            </>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface DialogBodyProps {
  className?: string;
  children?: ReactNode;
}

/** Scrolling content area: pad 20, gap 20. */
export function DialogBody({ className, children }: DialogBodyProps) {
  return <div className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5', className)}>{children}</div>;
}

export interface DialogFooterProps {
  /** Left-aligned hint (small fg-3), e.g. what the primary action will do. */
  hint?: ReactNode;
  className?: string;
  /** Actions, right-aligned (Cancel, primary). */
  children?: ReactNode;
}

/** 56h footer: hint on the left, actions on the right. */
export function DialogFooter({ hint, className, children }: DialogFooterProps) {
  return (
    <div className={cn('flex h-footer shrink-0 items-center gap-2 border-t border-line-soft pr-4 pl-5', className)}>
      {hint != null ? <span className="min-w-0 truncate text-small text-fg-3">{hint}</span> : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Closes the dialog; render a Button through it: `<DialogClose render={<Button />}>Cancel</DialogClose>`. */
export const DialogClose = BaseDialog.Close;
