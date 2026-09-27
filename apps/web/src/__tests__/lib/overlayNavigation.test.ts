// isOverlayNavigation decides whether WorkflowBuilderPage's unsaved-changes
// blocker lets a navigation through (D-26): opening, paging and closing the
// Settings modal keep the page mounted; leaving the page does not.
import { describe, expect, it } from 'vitest';
import { backgroundLocationOf, isOverlayNavigation } from '@/lib/overlayNavigation.js';

const page = { pathname: '/workflows/w1/edit' };
const over = (bg: { pathname: string } | null, pathname = '/settings/general') => ({
  pathname,
  state: bg ? { backgroundLocation: bg } : null,
});

describe('isOverlayNavigation', () => {
  it('opening Settings over the current page', () => {
    expect(isOverlayNavigation(page, over(page))).toBe(true);
  });

  it('opening Settings without a named background (a plain link: the shell keeps the page)', () => {
    expect(isOverlayNavigation(page, over(null))).toBe(true);
  });

  it('opening Settings over a different page is a real navigation', () => {
    expect(isOverlayNavigation(page, over({ pathname: '/chats' }))).toBe(false);
  });

  it('paging between sections inside the modal', () => {
    expect(isOverlayNavigation(over(page), over(page, '/settings/security'))).toBe(true);
  });

  it('closing back to the background page', () => {
    expect(isOverlayNavigation(over(page), page)).toBe(true);
  });

  it('leaving Settings for another page is a real navigation', () => {
    expect(isOverlayNavigation(over(page), { pathname: '/workflows/w2' })).toBe(false);
    expect(isOverlayNavigation(over(null), page)).toBe(false);
  });

  it('page to page is not an overlay navigation', () => {
    expect(isOverlayNavigation(page, { pathname: '/chats' })).toBe(false);
  });
});

describe('backgroundLocationOf', () => {
  it('reads a background location and rejects anything else', () => {
    expect(backgroundLocationOf({ backgroundLocation: { pathname: '/chats' } })?.pathname).toBe('/chats');
    expect(backgroundLocationOf(null)).toBeNull();
    expect(backgroundLocationOf({ backgroundLocation: 'nope' })).toBeNull();
    expect(backgroundLocationOf({ backgroundLocation: { path: '/x' } })).toBeNull();
  });
});
