// ────────────────────────────────────────────────────────────────
// Native browser view occlusion (D-19, 06-desktop-and-shell.md §4.2).
//
// The desktop WebContentsView paints above the DOM, so NativeBrowserView hides
// it while any floating layer overlaps its container, and while the container
// itself is hidden (an inactive dock tab). `isObscured` is the pure decision,
// with the DOM access injected so it is unit-testable.
// ────────────────────────────────────────────────────────────────

import { GAI_OVERLAY_SELECTOR, LEGACY_OVERLAY_SELECTOR } from '@/ui/lib/overlay.js';

export interface OcclusionDeps {
  /** `document.querySelectorAll`, as an array. */
  query: (selector: string) => Element[];
  rectOf: (el: Element) => DOMRectReadOnly;
  /** `visibility: hidden` or `opacity: 0`. */
  isCssHidden: (el: Element) => boolean;
}

/** Overlays plus the legacy Radix layers (the legacy half goes in P7). */
export const OCCLUSION_SELECTOR = `${GAI_OVERLAY_SELECTOR}, ${LEGACY_OVERLAY_SELECTOR}`;

/** Overlays smaller than this (px) on either axis are ignored. */
const MIN_OVERLAY_EDGE = 4;

/** A container smaller than this (px) on either axis counts as hidden. */
export const MIN_VISIBLE_EDGE = 4;

/**
 * True when a floating layer overlaps `container`. Layers that contain the
 * container (the narrow dock sheet hosting the view) and layers inside it
 * (its own placeholder children) never count.
 */
export function isObscured(container: Element, deps: OcclusionDeps, selector: string = OCCLUSION_SELECTOR): boolean {
  const target = deps.rectOf(container);
  for (const el of deps.query(selector)) {
    if (el === container || el.contains(container)) continue; // ancestor exemption
    if (container.contains(el)) continue;
    const r = deps.rectOf(el);
    if (r.width < MIN_OVERLAY_EDGE || r.height < MIN_OVERLAY_EDGE || deps.isCssHidden(el)) continue;
    if (r.right > target.left && r.left < target.right && r.bottom > target.top && r.top < target.bottom) return true;
  }
  return false;
}

/** The real DOM implementation of {@link OcclusionDeps}. */
export const domOcclusionDeps: OcclusionDeps = {
  query: (selector) => Array.from(document.querySelectorAll(selector)),
  rectOf: (el) => el.getBoundingClientRect(),
  isCssHidden: (el) => {
    const style = window.getComputedStyle(el);
    return style.visibility === 'hidden' || style.opacity === '0';
  },
};

/**
 * True when the container is not actually visible — e.g. its dock tabpanel is
 * inactive (`visibility:hidden`) or collapsed. Because `visibility:hidden`
 * preserves layout, a plain bounds check can't tell; we use
 * `checkVisibility()` (which accounts for ancestor visibility / display) plus
 * a zero-size fallback. When hidden, the native view must be hidden too so it
 * stops painting over the now-active tab (06-desktop-and-shell.md §4.3).
 */
export function isContainerHidden(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < MIN_VISIBLE_EDGE || r.height < MIN_VISIBLE_EDGE) return true;
  const cv = (el as unknown as { checkVisibility?: (opts?: { checkVisibilityCSS?: boolean }) => boolean }).checkVisibility;
  if (typeof cv === 'function') {
    try { if (cv.call(el, { checkVisibilityCSS: true }) === false) return true; } catch { /* ignore */ }
  }
  // Fallback for engines without checkVisibility: walk ancestors for a
  // visibility:hidden that would suppress paint.
  let node: HTMLElement | null = el;
  while (node) {
    if (window.getComputedStyle(node).visibility === 'hidden') return true;
    node = node.parentElement;
  }
  return false;
}
