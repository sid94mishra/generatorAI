// ────────────────────────────────────────────────────────────────
// FloatingCard — a card pinned next to the thing it is about
// ────────────────────────────────────────────────────────────────
//
// Used by the review composer and the thread pop-out. Both are opened from
// somewhere inside the diff's shadow root, which means the usual anchoring
// libraries have nothing to attach to: the element that was clicked is not
// reachable from here. What IS reachable is the pointer position that opened
// it, so that is what we anchor to.
//
// Rendered in a portal rather than inline for one specific reason: the diff
// viewer is a scrolling, `contain: layout style` container, and anything
// positioned inside it is clipped by it. A comment box that gets cut in half
// by the edge of the pane is worse than no comment box.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FloatingCardProps {
  /** Viewport coordinates of the gesture that opened this. */
  anchor: { x: number; y: number } | null;
  /** Fired on Escape, on outside pointer-down, and on backdrop click. */
  onDismiss: () => void;
  width?: number;
  /** Accessible name for the dialog. */
  label: string;
  children: React.ReactNode;
}

/** Keeps the card fully on screen, biased below-right of the anchor. */
function place(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
): { left: number; top: number } {
  const margin = 8;
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer to the right of the pointer; flip left when that would overflow.
  let left = anchor.x + gap;
  if (left + size.width + margin > vw) left = anchor.x - gap - size.width;
  left = Math.max(margin, Math.min(left, vw - size.width - margin));

  // Prefer below; flip above when there is not enough room, then clamp. The
  // clamp is what stops a tall card near the bottom edge from being cut off.
  let top = anchor.y + gap;
  if (top + size.height + margin > vh) top = anchor.y - gap - size.height;
  top = Math.max(margin, Math.min(top, vh - size.height - margin));

  return { left, top };
}

export function FloatingCard({
  anchor,
  onDismiss,
  width = 340,
  label,
  children,
}: FloatingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // `null` until measured. Rendering off-screen for the first paint avoids
  // the card visibly jumping from a guessed spot to its real one.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place. `useLayoutEffect` so this lands before paint.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !anchor) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setPos(place(anchor, { width: rect.width, height: rect.height }));
    };
    measure();
    // The card grows as the user types, and a growing card can run off the
    // bottom of the screen. Re-place whenever it changes size.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  // Escape closes, from anywhere — including while focus is in the textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onDismiss]);

  if (!anchor) return null;

  return createPortal(
    <>
      {/*
        A transparent, full-screen catcher rather than a document-level
        "click outside" listener. The listener approach cannot see clicks
        inside the diff's shadow root reliably, and it also races with the
        very click that opened the card. A backdrop has neither problem.
        It is not a modal scrim: it paints nothing and the page beneath
        stays fully legible.
      */}
      <div
        className="fixed inset-0 z-40"
        onPointerDown={onDismiss}
        aria-hidden
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-label={label}
        className="fixed z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl"
        style={{
          width,
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          // Hidden rather than unmounted for the measuring pass — it has to
          // be in the DOM to have a size.
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
