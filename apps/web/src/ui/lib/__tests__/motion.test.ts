import { afterEach, describe, expect, it } from 'vitest';
import { prefersReducedMotion, settleOnOpen } from '../motion.js';

function panel(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

function transition(el: HTMLElement, type: 'transitionrun' | 'transitionend', propertyName: string, target: Element = el) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  target.dispatchEvent(event);
}

describe('settleOnOpen (D-109)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-motion');
  });

  it('settles a panel that mounts already open', () => {
    const el = panel({ 'data-open': '' });
    settleOnOpen(el);
    expect(el.hasAttribute('data-settled')).toBe(true);
  });

  it('keeps a panel that is opening clipped until its fade ends', () => {
    const el = panel({ 'data-open': '', 'data-starting-style': '' });
    settleOnOpen(el);
    expect(el.hasAttribute('data-settled')).toBe(false);
    el.removeAttribute('data-starting-style');
    transition(el, 'transitionrun', 'height');
    transition(el, 'transitionend', 'height');
    expect(el.hasAttribute('data-settled')).toBe(false);
    transition(el, 'transitionend', 'opacity');
    expect(el.hasAttribute('data-settled')).toBe(true);
  });

  it('clips again when a transition of its own starts, and never settles while closed', () => {
    const el = panel({ 'data-open': '' });
    settleOnOpen(el);
    el.removeAttribute('data-open');
    transition(el, 'transitionrun', 'height');
    expect(el.hasAttribute('data-settled')).toBe(false);
    transition(el, 'transitionend', 'opacity');
    expect(el.hasAttribute('data-settled')).toBe(false);
  });

  it('ignores transitions of its content', () => {
    const el = panel({ 'data-open': '' });
    const child = document.createElement('button');
    el.append(child);
    settleOnOpen(el);
    transition(el, 'transitionrun', 'background-color', child);
    expect(el.hasAttribute('data-settled')).toBe(true);
  });

  it('reads the Reduce motion setting', () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    expect(prefersReducedMotion()).toBe(true);
  });
});
