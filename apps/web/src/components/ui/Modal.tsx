// ────────────────────────────────────────────────────────────────
// Modal — canonical dialog primitive
// One consistent dimmed + centered backdrop, Escape-to-close,
// click-outside-to-close, focus trap, and size variants.
// Built on the vendored Radix Dialog part (real focus trap, ARIA,
// scroll lock, portal stacking) — same ModalProps API as before.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DialogOverlay } from './primitives/dialog.js';
import { cn } from '@/lib/utils.js';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

// Each size defines BOTH a fixed width and a fixed height so the modal
// frame is stable from the moment it opens — content scrolls inside
// instead of the frame growing/shrinking with body length. `min(<vh>,
// <rem>)` clamps so the modal stays inside the viewport on small
// screens but never grows beyond a comfortable maximum on wide ones.
const SIZES: Record<ModalSize, string> = {
  sm: 'w-[min(92vw,28rem)] h-[min(80vh,22rem)]',
  md: 'w-[min(92vw,36rem)] h-[min(82vh,32rem)]',
  lg: 'w-[min(94vw,48rem)] h-[min(85vh,40rem)]',
  xl: 'w-[min(96vw,64rem)] h-[min(88vh,48rem)]',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  /** Hide the default close (X) button in the header */
  hideClose?: boolean;
  /** Disable closing on backdrop click / Escape (e.g., while submitting) */
  dismissible?: boolean;
  /** Footer content pinned at the bottom of the modal */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  hideClose = false,
  dismissible = true,
  footer,
  children,
  className,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className={cn(
            // Fixed dimensions come from SIZES; the panel is a stable
            // frame with an internal scrollable body.
            'fixed left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2',
            'flex flex-col overflow-hidden',
            'rounded-xl border border-border bg-card shadow-2xl',
            'data-[state=open]:animate-slide-in-up',
            SIZES[size],
            className,
          )}
          aria-describedby={undefined}
        >
          {title ? (
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {!hideClose && <ModalCloseButton onClose={onClose} />}
            </div>
          ) : (
            // Radix requires a Title for accessibility; render it
            // visually hidden when the modal has no header.
            <>
              <DialogPrimitive.Title className="sr-only">Dialog</DialogPrimitive.Title>
              {!hideClose && (
                <div className="absolute right-3 top-3 z-10">
                  <ModalCloseButton onClose={onClose} />
                </div>
              )}
            </>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
