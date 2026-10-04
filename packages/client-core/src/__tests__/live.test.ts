import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@generatorai/shared';
import {
  createLiveCoalescer,
  END_DISMISS_MS,
  isLiveStale,
  liveAwaitingOutcome,
  liveCandidates,
  liveDismissal,
  liveKey,
  liveReducer,
  OUTCOME_GRACE_MS,
  redactForLockScreen,
  STALE_AFTER_MS,
  type LiveMap,
  type LiveState,
} from '../live/index.js';

const server = { id: 'srv1', name: 'This computer' };
const t0 = new Date('2026-10-03T10:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

function item(over: Partial<AttentionItem> & Pick<AttentionItem, 'key' | 'entity' | 'entityId'>): AttentionItem {
  return {
    title: 'Fix flaky checkout test',
    href: `/chats/${over.entityId}`,
    state: 'running',
    since: t0.toISOString(),
    stoppable: true,
    ...over,
  };
}

const runningChat = item({ key: 'chat:c1', entity: 'chat', entityId: 'c1', progress: { label: 'Running pnpm test' } });
const askChat = item({
  key: 'chat:c1:i1',
  entity: 'chat',
  entityId: 'c1',
  href: '/chats/c1/gate/i1',
  state: 'needs_you',
  since: at(5000).toISOString(),
  ask: { kind: 'tool_permission', id: 'i1', summary: 'Allow Bash: rm -rf build?', actions: ['allow_once', 'deny'], risk: 'risky' },
});
const run = item({
  key: 'workflow_run:r1',
  entity: 'workflow_run',
  entityId: 'r1',
  title: 'Nightly dependency audit',
  href: '/workflows/w1/runs/r1',
  progress: { label: 'Apply upgrades', step: 3, of: 6 },
  since: at(-60_000).toISOString(),
});

const apply = (map: LiveMap, items: AttentionItem[], now = t0) => liveReducer(map, { type: 'attention', items, server, now });

describe('live-state model', () => {
  it('folds an entity’s running row and its ask into one needs-you state with the gate link', () => {
    const map = apply({}, [runningChat, askChat]);
    const s = map[liveKey('srv1', 'chat', 'c1')]!;
    expect(s).toMatchObject({
      phase: 'needs_you',
      statusWord: 'Needs you',
      title: 'Fix flaky checkout test',
      serverName: 'This computer',
      ask: { kind: 'tool_permission', summary: 'Allow Bash: rm -rf build?', risky: true },
      step: { label: 'Running pnpm test' },
      deepLink: 'generatorai:///chats/c1/gate/i1?server=srv1',
      startedAt: t0.toISOString(),
    });
    expect(Date.parse(s.staleAt) - t0.getTime()).toBe(STALE_AFTER_MS);
  });

  it('treats a stage approval without a server verdict as risky (MD-31)', () => {
    const ask = item({ key: 'workflow_run:r1:s1', entity: 'workflow_run', entityId: 'r1', state: 'needs_you', ask: { kind: 'stage_approval', id: 's1', summary: 'Approve “Apply upgrades”', actions: ['approve', 'reject'] } });
    expect(apply({}, [ask])['srv1:workflow_run:r1']!.ask!.risky).toBe(true);
  });

  it('keeps the same map when nothing changed, and refreshes staleAt only after a minute', () => {
    const a = apply({}, [run]);
    expect(apply(a, [run], at(30_000))).toBe(a);
    const b = apply(a, [run], at(90_000));
    expect(b).not.toBe(a);
    expect(b['srv1:workflow_run:r1']!.updatedAt).toBe(a['srv1:workflow_run:r1']!.updatedAt);
    expect(b['srv1:workflow_run:r1']!.staleAt).toBe(at(90_000 + STALE_AFTER_MS).toISOString());
  });

  it('runs the state machine: running → ending → outcome → dismissed after the MD-90 window', () => {
    let map = apply({}, [run]);
    const key = 'srv1:workflow_run:r1';
    map = liveReducer(map, { type: 'progress', key, segments: ['done', 'done', 'current', 'pending'], next: 'Open PR', now: at(1000) });
    expect(map[key]).toMatchObject({ segments: ['done', 'done', 'current', 'pending'], next: 'Open PR' });

    map = apply(map, [], at(2000));
    expect(map[key]!.endedAt).toBe(at(2000).toISOString());
    expect(liveAwaitingOutcome(map).map((s) => s.key)).toEqual([key]);

    map = liveReducer(map, { type: 'ended', key, outcome: 'failed', now: at(3000) });
    expect(map[key]).toMatchObject({ phase: 'failed', statusWord: 'Failed', segments: ['done', 'done', 'failed', 'pending'] });
    expect(liveDismissal(map[key]!)).toEqual({ policy: 'after', at: at(2000 + END_DISMISS_MS.failed) });

    expect(liveReducer(map, { type: 'sweep', now: at(2000 + END_DISMISS_MS.failed - 1) })).toBe(map);
    expect(liveReducer(map, { type: 'sweep', now: at(2000 + END_DISMISS_MS.failed) })[key]).toBeUndefined();
  });

  it('a succeeded run ends with a complete bar, even when progress never reached the last stages', () => {
    let map = apply({}, [run]);
    const key = 'srv1:workflow_run:r1';
    map = liveReducer(map, { type: 'progress', key, segments: ['done', 'current', 'pending', 'pending'], now: at(1000) });
    map = liveReducer(apply(map, [], at(2000)), { type: 'ended', key, outcome: 'succeeded', now: at(3000) });
    expect(map[key]).toMatchObject({ phase: 'succeeded', segments: ['done', 'done', 'done', 'done'] });
  });

  it('never invents an outcome: an ending item that learns none is forgotten', () => {
    let map = apply(apply({}, [run]), [], at(1000));
    map = liveReducer(map, { type: 'sweep', now: at(1000 + OUTCOME_GRACE_MS) });
    expect(map).toEqual({});
  });

  it('brings an ending item back when the feed lists it again, and restarts a finished one', () => {
    const key = 'srv1:workflow_run:r1';
    let map = apply(apply({}, [run]), [], at(1000));
    map = apply(map, [run], at(2000));
    expect(map[key]!.endedAt).toBeUndefined();
    map = liveReducer(apply(map, [], at(3000)), { type: 'ended', key, outcome: 'succeeded', now: at(3000) });
    map = apply(map, [{ ...run, since: at(4000).toISOString() }], at(4000));
    expect(map[key]).toMatchObject({ phase: 'running', startedAt: at(4000).toISOString() });
    expect(map[key]!.endedAt).toBeUndefined();
  });

  it('leaves other servers alone and forgets one server on unpair', () => {
    const other = liveReducer({}, { type: 'attention', items: [run], server: { id: 'srv2', name: 'Laptop' }, now: t0 });
    const map = apply(other, []);
    expect(map['srv2:workflow_run:r1']!.endedAt).toBeUndefined();
    expect(liveReducer(map, { type: 'forgetServer', serverId: 'srv2' })).toEqual({});
  });

  it('picks at most three followed candidates, needs-you first, then the oldest', () => {
    const items = ['a', 'b', 'c', 'd'].map((id, i) => item({ key: `chat:${id}`, entity: 'chat', entityId: id, since: at(i * 1000).toISOString() }));
    const map = apply({}, [...items, item({ key: 'chat:d:q', entity: 'chat', entityId: 'd', state: 'needs_you', ask: { kind: 'question', id: 'q', summary: 'Which?', actions: ['answer'] } })]);
    const followed = new Set(['srv1:chat:a', 'srv1:chat:b', 'srv1:chat:c', 'srv1:chat:d']);
    expect(liveCandidates(map, followed).map((s) => s.entityId)).toEqual(['d', 'a', 'b']);
    expect(liveCandidates(map, new Set(['srv1:chat:c'])).map((s) => s.entityId)).toEqual(['c']);
  });

  it('derives staleness for live items only', () => {
    const s = apply({}, [run])['srv1:workflow_run:r1']!;
    expect(isLiveStale(s, at(STALE_AFTER_MS))).toBe(false);
    expect(isLiveStale(s, at(STALE_AFTER_MS + 1))).toBe(true);
    expect(isLiveStale({ ...s, phase: 'succeeded' }, at(STALE_AFTER_MS + 1))).toBe(false);
  });

  it('redacts commands and paths for the lock screen, keeping titles and stage names', () => {
    const chat = apply({}, [runningChat, askChat])['srv1:chat:c1']!;
    const r = redactForLockScreen(chat);
    expect(r.title).toBe('Fix flaky checkout test');
    expect(r.step).toEqual({ label: 'Running' });
    expect(r.ask!.summary).toBe('Allow Bash?');
    const stage = apply({}, [run])['srv1:workflow_run:r1']!;
    expect(redactForLockScreen(stage).step).toEqual({ index: 3, count: 6, label: 'Apply upgrades' });
    const pathy: LiveState = { ...stage, step: { label: 'Edit src/app.ts' }, next: 'cat .env' };
    const out = redactForLockScreen(pathy);
    expect(out.step).toBeUndefined();
    expect(out.next).toBeUndefined();
    expect(redactForLockScreen({ ...chat, ask: { kind: 'question', summary: 'Delete ~/repo/build?', risky: false } }).ask!.summary).toBe('Needs your answer');
  });

  it('coalesces surface updates to one per second per item', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const c = createLiveCoalescer((k) => emitted.push(k), { now: () => Date.now(), setTimeout, clearTimeout: (h) => clearTimeout(h as never) });
    c.push('a');
    c.push('a');
    c.push('a');
    c.push('b');
    expect(emitted).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1000);
    expect(emitted).toEqual(['a', 'b', 'a']);
    c.push('a');
    c.cancel();
    vi.advanceTimersByTime(2000);
    expect(emitted).toEqual(['a', 'b', 'a']);
    vi.useRealTimers();
  });
});
