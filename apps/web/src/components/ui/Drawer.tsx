// ────────────────────────────────────────────────────────────────
// Drawer — canonical edge-anchored sheet (mobile navigation, side
// panels, filters). Built on the vendored Radix Dialog part so it gets,
// for free, everything the hand-rolled `fixed inset-0` drawers lacked:
//
//   • the rest of the page is made inert (aria-hidden + no tab stops)
//     while the drawer is open — a modal that lets focus escape behind
//     the scrim is not a modal;
//   • a real focus trap, Escape to close, click-outside to close;
//   • focus returns to the element that opened it.
//
// Pair with `Modal` (centered) and `ConfirmDialog` (blocking). Do not
// hand-roll another overlay.
// ────────────────────────────────────────────────────────────────

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DialogOverlay } from './primitives/dialog.js';
import { cn } from '@/lib/utils.js';

export type DrawerSide = 'left' | 'right' | 'bottom';

const SIDES: Record<DrawerSide, string> = {
  left: 'inset-y-0 left-0 h-full w-[min(85vw,18rem)] border-r data-[state=open]:animate-slide-in-left',
  right: 'inset-y-0 right-0 h-full w-[min(85vw,22rem)] border-l data-[state=open]:animate-slide-in-right',
  bottom:
    'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-slide-in-up',
};

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  /** Accessible name. Rendered as a visible header unless `hideTitle`. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Keep the title for assistive tech only (e.g. a navigation drawer). */
  hideTitle?: boolean;
  /** Hide the default close (X) button */
  hideClose?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  side = 'left',
  title,
  description,
  hideTitle = false,
  hideClose = false,
  children,
  className,
}: DrawerProps) {
  // Drawers are almost always opened by a button that is NOT a
  // `Dialog.Trigger` (a header toggle, a store action), and Radix only
  // returns focus to a Trigger. Remember whoever had focus at the moment
  // we opened and hand it back ourselves.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-drawer-side={side}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const opener = openerRef.current;
            if (opener && opener.isConnected) opener.focus();
          }}
          className={cn(
            'fixed z-[1000] flex flex-col overflow-hidden border-border bg-sidebar text-foreground shadow-2xl',
            'focus:outline-none',
            SIDES[side],
            className,
          )}
          // Radix warns when there is no Description; opting out explicitly
          // is the documented way to say "this dialog has none".
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {hideTitle ? (
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          ) : (
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {!hideClose && <DrawerCloseButton />}
            </div>
          )}
          {hideTitle && !hideClose && (
            <div className="absolute right-2 top-2 z-10">
              <DrawerCloseButton />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DrawerCloseButton() {
  return (
    <DialogPrimitive.Close
      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Close"
    >
      <X className="h-4 w-4" aria-hidden />
    </DialogPrimitive.Close>
  );
}
