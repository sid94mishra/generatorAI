import { describe, expect, it } from 'vitest';

import { isMobilePaneTab, paneTabTypes } from './paneRegistry';
import { paneVisibleOn } from './paneVisibility';

describe('pane registry (MB-42, MD-23, MD-96)', () => {
  it('always shows the pinned four and adds the conditional tabs that apply', () => {
    expect(paneTabTypes({})).toEqual(['changes', 'files', 'terminal', 'browser']);
    expect(paneTabTypes({ tasks: true, plan: true })).toEqual(['changes', 'files', 'terminal', 'browser', 'tasks', 'plan']);
    expect(paneTabTypes({ computer: true })).toContain('computer');
  });

  it('has no Widget or file tab on mobile', () => {
    expect(isMobilePaneTab('widget')).toBe(false);
    expect(isMobilePaneTab('file')).toBe(false);
    expect(isMobilePaneTab('plan')).toBe(true);
  });

  it('shows over its own screen and the workspace screens pushed from it, nowhere else', () => {
    expect(paneVisibleOn('/chats/c1', '/chats/c1')).toBe(true);
    expect(paneVisibleOn('/changes/w1/file', '/chats/c1')).toBe(true);
    expect(paneVisibleOn('/workspaces/w1/diff', '/chats/c1')).toBe(true);
    expect(paneVisibleOn('/chats/c2', '/chats/c1')).toBe(false);
    expect(paneVisibleOn('/settings', '/chats/c1')).toBe(false);
  });
});
