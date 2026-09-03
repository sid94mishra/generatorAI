// ────────────────────────────────────────────────────────────────
// W13 — late-update guard: an update for a superseded turn is
// DISCARDED, not applied.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { GenerationGuard } from '../../src/hardening/lateUpdateGuard.js';

describe('W13 — late-update guard', () => {
  it('accepts an update stamped with the current generation', () => {
    const g = new GenerationGuard();
    const gen = g.begin('conv-1');
    expect(g.accept('conv-1', gen)).toBe(true);
  });

  it('DISCARDS an update from the previous turn once a new turn begins', () => {
    const g = new GenerationGuard();
    const first = g.begin('conv-1');
    const second = g.begin('conv-1');
    expect(second).toBe(first + 1);
    expect(g.accept('conv-1', first)).toBe(false);
    expect(g.accept('conv-1', second)).toBe(true);
  });

  it('discards updates from a turn superseded by a CANCEL, with no replacement turn', () => {
    const g = new GenerationGuard();
    const turn = g.begin('conv-1');
    g.supersede('conv-1');
    expect(g.accept('conv-1', turn)).toBe(false);
  });

  it('does not cross conversations — superseding A leaves B alone', () => {
    const g = new GenerationGuard();
    const a = g.begin('conv-A');
    const b = g.begin('conv-B');
    g.begin('conv-A');
    expect(g.accept('conv-A', a)).toBe(false);
    expect(g.accept('conv-B', b)).toBe(true);
  });

  it('counts every discard rather than dropping silently', () => {
    const seen: Array<[string, number, number]> = [];
    const g = new GenerationGuard({
      onDiscard: (key, update, current) => seen.push([key, update, current]),
    });
    const stale = g.begin('c');
    g.begin('c');
    g.accept('c', stale);
    g.accept('c', stale);
    expect(g.discardedCount).toBe(2);
    expect(seen).toEqual([['c', 1, 2], ['c', 1, 2]]);
  });

  it('gate() stops a superseded turn writing into its replacement', () => {
    const g = new GenerationGuard();
    const applied: string[] = [];

    const turn1 = g.begin('c');
    const emitTurn1 = g.gate('c', turn1, (text: string) => applied.push(`t1:${text}`));

    emitTurn1('hello');

    // Turn 1 is cancelled; turn 2 starts and begins emitting.
    const turn2 = g.begin('c');
    const emitTurn2 = g.gate('c', turn2, (text: string) => applied.push(`t2:${text}`));
    emitTurn2('new turn');

    // Turn 1's trailing message finally arrives. Without the guard this would
    // append turn 1's text to turn 2's message — and a trailing `idle` would
    // end a turn that is still running.
    emitTurn1('trailing');
    emitTurn1('idle');

    expect(applied).toEqual(['t1:hello', 't2:new turn']);
    expect(g.discardedCount).toBe(2);
  });

  it('generation 0 means nothing has started, and an update claiming it is accepted only then', () => {
    const g = new GenerationGuard();
    expect(g.current('fresh')).toBe(0);
    expect(g.accept('fresh', 0)).toBe(true);
    g.begin('fresh');
    expect(g.accept('fresh', 0)).toBe(false);
  });

  it('forget() drops a deleted conversation, so the map does not grow forever', () => {
    const g = new GenerationGuard();
    g.begin('gone');
    g.forget('gone');
    expect(g.current('gone')).toBe(0);
  });
});
