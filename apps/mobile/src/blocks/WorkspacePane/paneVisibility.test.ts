import { describe, expect, it } from 'vitest';

import { paneVisibleOn } from './paneVisibility';

describe('paneVisibleOn', () => {
  it('shows on the claiming chat and the workspace screens pushed from it', () => {
    expect(paneVisibleOn('/chats/c1', '/chats/c1')).toBe(true);
    expect(paneVisibleOn('/workspaces/w1/diff', '/chats/c1')).toBe(true);
    expect(paneVisibleOn('/chats/c2', '/chats/c1')).toBe(false);
  });
  it('steps aside under a presented route opened from it (the commit sheet)', () => {
    expect(paneVisibleOn('/workspaces/w1/commit', '/chats/c1')).toBe(false);
    expect(paneVisibleOn('/chats/c1/turn', '/chats/c1')).toBe(false);
  });
});
