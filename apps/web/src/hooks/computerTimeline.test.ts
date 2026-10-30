import { describe, expect, it } from 'vitest';
import {
  COMPUTER_TIMELINE_MAX,
  EMPTY_COMPUTER_TIMELINE,
  foldComputerTimeline,
  frameForEntry,
  seedComputerTimeline,
} from './computerTimeline.js';

describe('computer timeline fold', () => {
  it('accepts {kind,payload}, {kind,data} and string payloads', () => {
    const a = foldComputerTimeline(EMPTY_COMPUTER_TIMELINE, { kind: 'computer.action', payload: { action: 'click', appLabel: 'Q' } }, 1, 'a');
    const b = foldComputerTimeline(a, { kind: 'computer.action', data: { action: 'type', appLabel: 'Q', path: 'synthetic' } }, 2, 'b');
    const c = foldComputerTimeline(b, { kind: 'computer.refusal', payload: JSON.stringify({ action: 'x', code: 'agent_paused', message: 'held' }) }, 3, 'c');
    expect(c.entries.map((e) => [e.id, e.kind, e.action])).toEqual([
      ['c', 'refusal', 'x'],
      ['b', 'action', 'type'],
      ['a', 'action', 'click'],
    ]);
    expect(c.entries[0]!.message).toBe('agent_paused — held');
    expect(c.entries[1]!.path).toBe('synthetic');
  });

  it('a snapshot sets the window title and newest frame; unknown kinds are a no-op', () => {
    const s = foldComputerTimeline(EMPTY_COMPUTER_TIMELINE, {
      kind: 'computer.snapshot',
      payload: { windowTitle: 'Inspector', appLabel: 'Q', elementCount: 12, artifactId: 'f1' },
    }, 1, 's');
    expect(s.windowTitle).toBe('Inspector');
    expect(s.latestFrameId).toBe('f1');
    expect(s.entries[0]).toMatchObject({ action: 'snapshot', target: '12 elements', artifactId: 'f1' });
    expect(foldComputerTimeline(s, { kind: 'computer.preview.frame', payload: {} })).toBe(s);
  });

  it('caps the log and seeds newest first', () => {
    let s = EMPTY_COMPUTER_TIMELINE;
    for (let i = 0; i < COMPUTER_TIMELINE_MAX + 5; i += 1) {
      s = foldComputerTimeline(s, { kind: 'computer.action', payload: { action: `a${i}` } }, i, `id${i}`);
    }
    expect(s.entries).toHaveLength(COMPUTER_TIMELINE_MAX);
    const seeded = seedComputerTimeline([
      { action: 'old', appLabel: '', target: null, path: null, verified: true, refusalCode: null, artifactId: null, createdAt: '2026-01-01T00:00:00Z' },
      { action: 'new', appLabel: '', target: null, path: null, verified: false, refusalCode: 'denied', artifactId: 'f', createdAt: '2026-01-01T00:01:00Z' },
    ]);
    expect(seeded.map((e) => [e.action, e.kind])).toEqual([['new', 'refusal'], ['old', 'action']]);
  });

  it('an action without a frame falls back to the last snapshot before it', () => {
    const entries = [
      { id: 'act', at: 2, kind: 'action' as const, action: 'click', appLabel: '' },
      { id: 'snap', at: 1, kind: 'action' as const, action: 'snapshot', appLabel: '', artifactId: 'f1' },
    ];
    expect(frameForEntry(entries, 'act')).toEqual({ artifactId: 'f1', fallback: true });
    expect(frameForEntry(entries, 'snap')).toEqual({ artifactId: 'f1', fallback: false });
    expect(frameForEntry(entries.slice(0, 1), 'act')).toBeNull();
  });
});
