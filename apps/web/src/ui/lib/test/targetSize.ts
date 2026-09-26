// ────────────────────────────────────────────────────────────────
// Minimum target size check (WCAG 2.2 SC 2.5.8; 09 §9.4), for Storybook play
// functions and, later, the route a11y spec.
//
// Every visible interactive element must be ≥ 24×24 CSS px — or, when it
// carries `data-gai-hit`, its `::before` hit-slop (ui/lib/focus.ts) must be.
// Elements inside running text (a link in a sentence) are exempt by the SC.
// ────────────────────────────────────────────────────────────────

const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="radio"]';

const MIN = 24;

export interface TargetSizeFailure {
  element: Element;
  width: number;
  height: number;
}

function hitBox(el: Element): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  if (!el.hasAttribute('data-gai-hit')) return { width: rect.width, height: rect.height };
  const before = getComputedStyle(el, '::before');
  const w = Number.parseFloat(before.width);
  const h = Number.parseFloat(before.height);
  return { width: Math.max(rect.width, Number.isNaN(w) ? 0 : w), height: Math.max(rect.height, Number.isNaN(h) ? 0 : h) };
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Returns the interactive elements under `root` whose effective hit area is below 24×24. */
export function findSmallTargets(root: ParentNode): TargetSizeFailure[] {
  const failures: TargetSizeFailure[] = [];
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
    // Skip running text, hidden form proxies (the input Base UI puts next to a
    // checkbox or radio)
    // and anything removed from the accessibility tree.
    if (!isVisible(el) || el.closest('p, [aria-hidden="true"]')) continue;
    if (el.tagName === 'INPUT' && el.getAttribute('tabindex') === '-1') continue;
    const { width, height } = hitBox(el);
    // 0.5px tolerance for sub-pixel layout.
    if (width + 0.5 < MIN || height + 0.5 < MIN) failures.push({ element: el, width, height });
  }
  return failures;
}

/** Throws with a readable list when any target is too small. */
export function assertTargetSize(root: ParentNode): void {
  const failures = findSmallTargets(root);
  if (failures.length === 0) return;
  const lines = failures.map(
    (f) => `${f.element.tagName.toLowerCase()} "${f.element.getAttribute('aria-label') ?? f.element.textContent?.trim() ?? ''}" ${f.width.toFixed(1)}×${f.height.toFixed(1)}`,
  );
  throw new Error(`Targets below 24×24 px (WCAG 2.5.8):\n${lines.join('\n')}`);
}
