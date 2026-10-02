import { describe, expect, it } from 'vitest';

import { paneTabs } from './paneFacts';
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

  it('counts changed files and running tasks; dots a plan to review and a consent ask (MD-23)', () => {
    const tabs = paneTabs({ kind: 'chat', changedFiles: 3, tasks: { orchestrator: true, total: 2, running: 1 }, planStatus: 'awaiting_review', computer: { enabled: true, needsAnswer: true } });
    expect(tabs.map((t) => t.type)).toEqual(['changes', 'files', 'terminal', 'browser', 'tasks', 'computer', 'plan']);
    expect(tabs.find((t) => t.type === 'changes')?.count).toBe(3);
    expect(tabs.find((t) => t.type === 'tasks')?.count).toBe(1);
    expect(tabs.filter((t) => t.attention).map((t) => t.type)).toEqual(['computer', 'plan']);
    // A run pane has no chat-only tabs; a plain chat shows the pinned four.
    expect(paneTabs({ kind: 'run', planStatus: 'approved', tasks: { orchestrator: true, total: 1, running: 1 } }).map((t) => t.type)).toEqual(['changes', 'files', 'terminal', 'browser']);
    expect(paneTabs({ kind: 'chat', changedFiles: 0, tasks: { orchestrator: false, total: 0, running: 0 } }).every((t) => t.count === undefined)).toBe(true);
  });
});
