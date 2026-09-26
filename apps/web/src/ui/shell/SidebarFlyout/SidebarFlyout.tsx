// ────────────────────────────────────────────────────────────────
// SidebarFlyout (06 §2.1, §2.5; part of S-02/S-03).
//
// While the rail is FORCED (window < 1200px, or a `forceRail` route), the
// rail's Expand button opens the full 232px sidebar over the page instead of
// changing the saved preference. A non-modal sheet (no backdrop, no focus
// trap; the page behind stays usable): `role="dialog"`, `bg-ground`,
// `shadow-pop`, on the sidebar layer, `data-gai-overlay="sheet"` so the native
// browser view hides under it (D-19).
// Closes on Escape and on a pointer-down outside it (a press on an element
// marked `data-sidebar-toggle` is left to that control's own toggle); focus
// moves into it on open and back to where it was on close. Navigation closes
// it too (app/shell does that).
// ────────────────────────────────────────────────────────────────

import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';

export interface SidebarFlyoutProps extends ComponentProps<'div'> {
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The full sidebar over a forced rail. Render it only while open. */
export function SidebarFlyout({ onClose, className, children, ...rest }: SidebarFlyoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // The opener, read while rendering: by the first effect the covered rail is
  // `inert` and has already dropped focus to <body>.
  const openerRef = useRef(typeof document === 'undefined' ? null : document.activeElement);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return undefined;
    const previous = openerRef.current instanceof HTMLElement ? openerRef.current : null;
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Not `defaultPrevented`: a focused button's tooltip swallows the first
      // Escape that way. A layer of its own (a menu opened from the flyout)
      // keeps its Escape, though.
      const target = e.target;
      if (target instanceof Element && !panel.contains(target) && target.closest('[data-gai-overlay]')) return;
      e.preventDefault();
      closeRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || panel.contains(target)) return;
      if (target instanceof Element && target.closest('[data-sidebar-toggle]')) return;
      closeRef.current();
    };
    // Capture: a focused control's tooltip stops Escape from bubbling.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      // By now the panel is detached, so focus that was in it sits on <body>.
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || panel.contains(active);
      // After the commit, once the rail under the flyout is no longer inert.
      if (previous && focusWasInside) queueMicrotask(() => previous.isConnected && previous.focus());
    };
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Sidebar"
      data-testid="sidebar-flyout"
      {...overlayProps('sheet')}
      className={cn('absolute inset-y-0 left-0 z-sidebar flex border-r border-line-soft bg-ground shadow-pop', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
