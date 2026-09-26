// ────────────────────────────────────────────────────────────────
// FloatingCard — a card pinned next to the thing it is about (B-07)
// ────────────────────────────────────────────────────────────────
//
// Used by the review composer and the thread pop-out. Both are opened from
// inside the diff's shadow-root, where the element that was clicked is not
// reachable from here. What IS reachable is the pointer position that opened
// it, so that is what we anchor to: a zero-size element placed at the pointer,
// which the kit Popover (P-29) positions against — collision-aware, and
// re-placed as the card grows while the user types.
//
// Non-modal, like the Popover it is built on: Escape closes from anywhere
// (including while typing), a pointer-down outside closes, focus moves in and
// goes back where it was; the page beneath stays legible and interactive.
//
// The anchor is portalled to <body>: the diff viewer is a `contain: layout`
// scroller, which would turn a `position: fixed` child into a child of the
// scroller instead of the viewport.

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PopoverPopup, PopoverRoot } from '@/ui/primitives/Popover/Popover.js';
import { popoverClamp } from '@/ui/lib/popup.js';

export interface FloatingCardProps {
  /** Viewport coordinates of the gesture that opened this. */
  anchor: { x: number; y: number } | null;
  /** Fired on Escape and on outside pointer-down. */
  onDismiss: () => void;
  width?: number;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}

export function FloatingCard({ anchor, onDismiss, width = 340, label, children }: FloatingCardProps) {
  if (!anchor) return null;
  // A new gesture is a new card: remount so the popup re-anchors and the
  // initial focus runs again instead of animating from the old spot.
  return (
    <AnchoredCard key={`${anchor.x},${anchor.y}`} x={anchor.x} y={anchor.y} onDismiss={onDismiss} width={width} label={label}>
      {children}
    </AnchoredCard>
  );
}

function AnchoredCard({
  x,
  y,
  onDismiss,
  width,
  label,
  children,
}: {
  x: number;
  y: number;
  onDismiss: () => void;
  width: number;
  label: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {createPortal(
        <span
          ref={anchorRef}
          aria-hidden
          data-floating-card-anchor
          className="pointer-events-none fixed size-0"
          style={{ left: x, top: y }}
        />,
        document.body,
      )}
      <PopoverRoot
        open
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
      >
        <PopoverPopup
          anchor={anchorRef}
          side="bottom"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className={popoverClamp}
          style={width !== undefined ? { width } : undefined}
          aria-label={label}
          // The card is for writing: land in its first text field when it has
          // one (the composer's comment box), else on the card itself.
          initialFocus={() => bodyRef.current?.querySelector<HTMLElement>('textarea') ?? true}
        >
          <div ref={bodyRef}>{children}</div>
        </PopoverPopup>
      </PopoverRoot>
    </>
  );
}
