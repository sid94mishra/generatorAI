// ────────────────────────────────────────────────────────────────
// FloatingCard — a card pinned next to the thing it is about
// ────────────────────────────────────────────────────────────────
//
// Used by the review composer and the thread pop-out. Both are opened from
// somewhere inside the diff's shadow root, which means the usual anchoring
// libraries have nothing to attach to: the element that was clicked is not
// reachable from here. What IS reachable is the pointer position that opened
// it, so that is what we anchor to — a zero-size anchor element placed at
// the pointer, which the shared Popover primitive then positions against
// (collision-aware, re-placed as the card grows while the user types).
//
// Built on Radix Popover rather than a hand-rolled full-viewport catcher
// (a `position: fixed`, zero-inset overlay div) so it gets the dismissal contract for free: Escape closes from anywhere
// (including while typing), a pointer-down outside closes, and focus goes
// back to where it was. It is deliberately NON-modal — the page beneath
// stays legible and interactive, exactly as before; there is no scrim.
//
// The anchor is portalled to <body>: the diff viewer is a `contain: layout`
// scroller, which would turn a `position: fixed` child into a child of the
// scroller instead of the viewport.

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { createPortal } from 'react-dom';

export interface FloatingCardProps {
  /** Viewport coordinates of the gesture that opened this. */
  anchor: { x: number; y: number } | null;
  /** Fired on Escape and on outside pointer-down. */
  onDismiss: () => void;
  width?: number;
  /** Accessible name for the dialog. */
  label: string;
  children: React.ReactNode;
}

export function FloatingCard({
  anchor,
  onDismiss,
  width = 340,
  label,
  children,
}: FloatingCardProps) {
  if (!anchor) return null;

  return (
    <PopoverPrimitive.Root
      // A new gesture is a new card: remount so the popper re-anchors and
      // the auto-focus runs again instead of animating from the old spot.
      key={`${anchor.x},${anchor.y}`}
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      {createPortal(
        <PopoverPrimitive.Anchor asChild>
          <span
            aria-hidden
            data-floating-card-anchor
            style={{
              position: 'fixed',
              left: anchor.x,
              top: anchor.y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </PopoverPrimitive.Anchor>,
        document.body,
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl outline-none"
          style={{ width, maxWidth: 'calc(100vw - 16px)' }}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
