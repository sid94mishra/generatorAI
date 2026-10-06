// ────────────────────────────────────────────────────────────────
// Motion helpers for the kit (D-108; the utilities live in globals.css
// "Motion"). Every expand / collapse and show / hide uses one of:
//
//   motion-collapse / motion-accordion  inline height + fade (Collapsible,
//                                       Accordion, CollapsiblePanel, Reveal,
//                                       StepRail)
//   motion-reveal-x                     a docked side panel's width (Activity)
//   motion-slide-start                  a floating side panel (Activity overlay,
//                                       the sidebar flyout)
//   motion-pop / motion-dialog          popups / dialogs (fade + scale)
//   motion-fade                         backdrops
//   motion-sheet-start / -end           Sheet panels
//   motion-size                         sidebar ↔ rail
//   motion-dock / motion-split          the dock surface and its split
//
// Durations and easing come from the motion tokens (`--gai-duration-*`,
// `--gai-ease-in-out`), which reduced motion zeroes.
// ────────────────────────────────────────────────────────────────

const SETTLED = 'data-settled';
const watched = new WeakSet<HTMLElement>();

/**
 * Ref for a height / width motion panel (a Base UI Collapsible or Accordion
 * panel): marks it `data-settled` while it rests open — already open when it
 * mounts, or once its open transition has ended — and clears the mark as soon
 * as a transition of its own starts (a close, or a re-open that interrupted
 * one). The motion utilities clip an unsettled panel, so moving content
 * neither paints nor scrolls outside it, and leave a settled one unclipped, so
 * focus rings and hit areas at its edges show. DOM-only: no React state, no
 * re-render. Stable, so React attaches it once per element.
 */
export function settleOnOpen(el: HTMLElement | null): void {
  if (!el || watched.has(el)) return;
  watched.add(el);
  const isOpen = () => el.hasAttribute('data-open');
  if (isOpen() && !el.hasAttribute('data-starting-style')) el.setAttribute(SETTLED, '');
  el.addEventListener('transitionrun', (event) => {
    if (event.target === el) el.removeAttribute(SETTLED);
  });
  el.addEventListener('transitionend', (event) => {
    // Opacity moves on every open (0 → 1), even when the content has no height yet.
    if (event.target === el && event.propertyName === 'opacity' && isOpen()) el.setAttribute(SETTLED, '');
  });
}

/** Reduced motion is on: the "Reduce motion" setting (`data-motion="reduce"`) or the OS preference. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'reduce') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
