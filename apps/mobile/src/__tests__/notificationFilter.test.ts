import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  NOTIFY_PREF_DEFAULTS,
  readNotifyPrefs,
  shouldMuteOnServer,
  shouldPresent,
  type NotifyPrefs,
} from '../notifications/notificationFilter';

const ALL_ON: NotifyPrefs = { gates: true, runs: true, chats: true };
const ALL_OFF: NotifyPrefs = { gates: false, runs: false, chats: false };

// Shapes copied from PushDispatcher.ts: `data: { route, category, threadId }`.
const approval = { route: '/runs/r1', category: 'approval', threadId: 'r1' };
const runFailed = { route: '/runs/r1', category: 'failed', threadId: 'r1' };
const runDone = { route: '/runs/r1', category: 'completed', threadId: 'r1' };
const chatDone = { route: '/chats/c1', category: 'completed', threadId: 'c1' };

describe('categoryOf', () => {
  it('maps the server’s categories onto the three switches', () => {
    expect(categoryOf(approval)).toBe('gates');
    expect(categoryOf(runFailed)).toBe('runs');
    expect(categoryOf(runDone)).toBe('runs');
    expect(categoryOf(chatDone)).toBe('chats');
  });

  it('ignores payloads that are not ours', () => {
    expect(categoryOf(undefined)).toBeNull();
    expect(categoryOf({ foo: 1 })).toBeNull();
    expect(categoryOf({ category: 'marketing', route: '/chats/x' })).toBeNull();
  });
});

describe('shouldPresent', () => {
  it('honours each switch independently', () => {
    expect(shouldPresent(approval, { ...ALL_ON, gates: false })).toBe(false);
    expect(shouldPresent(approval, { ...ALL_OFF, gates: true })).toBe(true);
    expect(shouldPresent(runFailed, { ...ALL_ON, runs: false })).toBe(false);
    expect(shouldPresent(runDone, { ...ALL_OFF, runs: true })).toBe(true);
    expect(shouldPresent(chatDone, { ...ALL_ON, chats: false })).toBe(false);
    expect(shouldPresent(chatDone, { ...ALL_OFF, chats: true })).toBe(true);
  });

  it('always shows payloads it cannot classify', () => {
    expect(shouldPresent(undefined, ALL_OFF)).toBe(true);
    expect(shouldPresent({ category: 'other' }, ALL_OFF)).toBe(true);
  });

  it('defaults match the settings screen: gates + runs on, chats off', () => {
    expect(NOTIFY_PREF_DEFAULTS).toEqual({ gates: true, runs: true, chats: false });
    expect(shouldPresent(chatDone, NOTIFY_PREF_DEFAULTS)).toBe(false);
    expect(shouldPresent(approval, NOTIFY_PREF_DEFAULTS)).toBe(true);
  });
});

describe('readNotifyPrefs', () => {
  it('reads "1"/"0" strings and falls back to defaults', () => {
    const store: Record<string, string> = { 'notify.gates': '0', 'notify.chats': '1' };
    expect(readNotifyPrefs((k) => store[k])).toEqual({ gates: false, runs: true, chats: true });
    expect(readNotifyPrefs(() => null)).toEqual(NOTIFY_PREF_DEFAULTS);
  });
});

describe('shouldMuteOnServer', () => {
  it('engages the server mute only when both non-approval categories are off', () => {
    // Approvals are never mutable server-side (MUTABLE_CATEGORIES in core),
    // so the gates switch must not influence this.
    expect(shouldMuteOnServer({ gates: true, runs: false, chats: false })).toBe(true);
    expect(shouldMuteOnServer({ gates: false, runs: false, chats: false })).toBe(true);
    expect(shouldMuteOnServer({ gates: true, runs: true, chats: false })).toBe(false);
    expect(shouldMuteOnServer({ gates: true, runs: false, chats: true })).toBe(false);
  });
});
