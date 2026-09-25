// D-19 overlay contract: the pure occlusion decision behind NativeBrowserView
// (06-desktop-and-shell.md §4.5, unit tests 1–7). Real DOM elements give the
// containment relations; rects and CSS visibility come from fake deps.
import { afterEach, describe, expect, it } from 'vitest';

import { isObscured, OCCLUSION_SELECTOR, type OcclusionDeps } from '@/components/chat/nativeBrowserOcclusion.js';
import { overlayProps } from '@/ui/lib/overlay.js';

interface Box { left: number; top: number; width: number; height: number }

const rect = ({ left, top, width, height }: Box): DOMRectReadOnly =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRectReadOnly;

const VIEWPORT: Box = { left: 0, top: 0, width: 1440, height: 900 };
/** The dock's browser tab body at 1440×900. */
const VIEW: Box = { left: 960, top: 100, width: 460, height: 760 };

function setup() {
  const rects = new Map<Element, Box>();
  const hidden = new Set<Element>();
  const deps: OcclusionDeps = {
    query: (selector) => Array.from(document.querySelectorAll(selector)),
    rectOf: (el) => rect(rects.get(el) ?? { left: 0, top: 0, width: 0, height: 0 }),
    isCssHidden: (el) => hidden.has(el),
  };
  const add = (parent: Element, attrs: Record<string, string>, box?: Box): HTMLElement => {
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    if (box) rects.set(el, box);
    return el;
  };
  return { deps, rects, hidden, add };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isObscured (D-19)', () => {
  it('1. a menu positioner overlapping the container obscures it', () => {
    const { deps, add } = setup();
    const container = add(document.body, {}, VIEW);
    add(document.body, overlayProps('menu'), { left: 1000, top: 120, width: 200, height: 240 });
    expect(isObscured(container, deps)).toBe(true);
  });

  it('a menu elsewhere does not', () => {
    const { deps, add } = setup();
    const container = add(document.body, {}, VIEW);
    add(document.body, overlayProps('menu'), { left: 100, top: 120, width: 200, height: 240 });
    expect(isObscured(container, deps)).toBe(false);
  });

  it('2. browser tab inside narrow dock sheet stays visible', () => {
    const { deps, add } = setup();
    const sheet = add(document.body, { ...overlayProps('sheet'), role: 'dialog' }, { left: 720, top: 0, width: 380, height: 760 });
    const container = add(sheet, {}, { left: 720, top: 44, width: 380, height: 716 });
    expect(isObscured(container, deps)).toBe(false);
  });

  it('3. menu over browser tab hides it (portalled menu over the sheet)', () => {
    const { deps, add } = setup();
    const sheet = add(document.body, { ...overlayProps('sheet'), role: 'dialog' }, { left: 720, top: 0, width: 380, height: 760 });
    const container = add(sheet, {}, { left: 720, top: 44, width: 380, height: 716 });
    add(document.body, overlayProps('menu'), { left: 900, top: 40, width: 180, height: 200 });
    expect(isObscured(container, deps)).toBe(true);
  });

  it('4. an overlapping sonner toast obscures; a toast elsewhere does not', () => {
    const { deps, add, rects } = setup();
    const container = add(document.body, {}, VIEW);
    const toaster = add(document.body, { 'data-sonner-toaster': '' });
    const toast = add(toaster, { 'data-sonner-toast': '' }, { left: 1060, top: 800, width: 356, height: 64 });
    expect(isObscured(container, deps)).toBe(true);
    rects.set(toast, { left: 24, top: 800, width: 356, height: 64 });
    expect(isObscured(container, deps)).toBe(false);
  });

  it('5. zero-size or CSS-hidden overlays are ignored', () => {
    const { deps, add, hidden } = setup();
    const container = add(document.body, {}, VIEW);
    add(document.body, overlayProps('popover'), { left: 1000, top: 200, width: 0, height: 0 });
    add(document.body, overlayProps('tooltip'), { left: 1000, top: 200, width: 3, height: 40 });
    const closing = add(document.body, overlayProps('menu'), { left: 1000, top: 200, width: 200, height: 200 });
    hidden.add(closing);
    expect(isObscured(container, deps)).toBe(false);
  });

  it('6. maximized dock with no overlays stays visible; a viewport backdrop obscures it', () => {
    const { deps, add } = setup();
    const mainCard: Box = { left: 240, top: 8, width: 1192, height: 884 };
    const container = add(document.body, {}, mainCard);
    expect(isObscured(container, deps)).toBe(false);
    add(document.body, overlayProps('backdrop'), VIEWPORT);
    expect(isObscured(container, deps)).toBe(true);
  });

  it('7. a legacy Radix popper wrapper overlapping obscures it (deleted in P7)', () => {
    const { deps, add } = setup();
    const container = add(document.body, {}, VIEW);
    add(document.body, { 'data-radix-popper-content-wrapper': '' }, { left: 1000, top: 120, width: 200, height: 240 });
    expect(isObscured(container, deps)).toBe(true);
  });

  it('the container itself and its own children never obscure it', () => {
    const { deps, add } = setup();
    const container = add(document.body, overlayProps('sheet'), VIEW);
    add(container, overlayProps('tooltip'), { left: 1000, top: 120, width: 200, height: 40 });
    expect(isObscured(container, deps)).toBe(false);
  });

  it('the default selector covers the design overlays, toasts and the legacy layers', () => {
    for (const part of ['[data-gai-overlay]', '[data-sonner-toast]', '[data-radix-popper-content-wrapper]', '[role="menu"]']) {
      expect(OCCLUSION_SELECTOR).toContain(part);
    }
  });
});
