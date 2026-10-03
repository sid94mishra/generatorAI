import { describe, expect, it } from 'vitest';
import { badgeTotal } from './badges';
import { isOnScreen, itemScreen } from './onScreen';
import { normalizePushData } from './pushData';

const chat = { serverId: 'A', href: '/chats/c1/gate/i1', category: 'approval' };
const run = { serverId: 'A', href: '/workflows/w1/runs/r1/approval/s1', category: 'run.approval' };

describe('foreground duplicates', () => {
  it('names the chat or run a push is about', () => {
    expect(itemScreen(chat)).toBe('/chats/c1');
    expect(itemScreen(run)).toBe('/workflows/w1/runs/r1');
    expect(itemScreen({ href: '/settings/security' })).toBeNull();
  });

  it('hides a push about the item on screen, on its own server only', () => {
    expect(isOnScreen(chat, { serverId: 'A', pathname: '/chats/c1' })).toBe(true);
    expect(isOnScreen(chat, { serverId: 'A', pathname: '/chats/c12' })).toBe(false);
    expect(isOnScreen(chat, { serverId: 'B', pathname: '/chats/c1' })).toBe(false);
    expect(isOnScreen(run, { serverId: 'A', pathname: '/workflows/w1/runs/r1/stages/s1' })).toBe(true);
    expect(isOnScreen(null, { serverId: 'A', pathname: '/chats/c1' })).toBe(false);
  });
});

describe('badge', () => {
  it('sums the last known Needs-you count of every paired server', () => {
    const store: Record<string, number> = { 'srv.A.badge.needsYou': 2, 'srv.B.badge.needsYou': 3, 'srv.C.badge.needsYou': -1 };
    expect(badgeTotal(['A', 'B', 'C', 'D'], (k) => store[k] ?? 0)).toBe(5);
  });
});

describe('push data v2', () => {
  const base = { v: 2, serverId: 'A', href: '/chats/c1', threadId: 'chat:c1', category: 'done' };
  it('accepts the shared categories and the part B fields', () => {
    expect(normalizePushData({ ...base, counts: { needsYou: 1, running: 0 }, redacted: { title: 'Finished', body: 'Open GeneratorAI to see it.' } })).toMatchObject({ route: '/chats/c1', counts: { needsYou: 1 } });
  });
  it('refuses an unknown category or malformed counts', () => {
    expect(normalizePushData({ ...base, category: 'completed' })).toBeNull();
    expect(normalizePushData({ ...base, counts: { needsYou: -1, running: 0 } })).toBeNull();
  });
});
