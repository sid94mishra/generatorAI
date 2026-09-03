// ────────────────────────────────────────────────────────────────
// Stream reducer — eviction (invariant 6, W27 "bounded stores").
//
// The record used to grow forever: `clearStream` reset an entry's content but
// kept the key, and nothing anywhere deleted one. These tests pin the bound
// and the order in which entries are given up.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { streamReducer as r, type StreamsRecord } from '../index.js';

/** Build a record of `n` sessions, touched oldest-first. */
function seed(n: number, prefix = 's'): StreamsRecord {
  let streams: StreamsRecord = {};
  for (let i = 0; i < n; i++) {
    streams = r.appendToken(streams, `${prefix}${i}`, `hello ${i}`);
  }
  return streams;
}

describe('streamReducer — eviction', () => {
  it('stamps a monotonically increasing lastActivityAt on every write', () => {
    let streams = r.appendToken({}, 'a', 'x');
    const first = streams['a']!.lastActivityAt;
    streams = r.appendToken(streams, 'b', 'y');
    const second = streams['b']!.lastActivityAt;
    streams = r.appendToken(streams, 'a', 'z');
    const third = streams['a']!.lastActivityAt;

    expect(second).toBeGreaterThan(first);
    // Touching `a` again moves it back to the front of the LRU order — this
    // is what keeps a live turn from ever being the eviction candidate.
    expect(third).toBeGreaterThan(second);
  });

  it('evictStream removes the key entirely, unlike clearStream', () => {
    const streams = r.appendToken({}, 'a', 'hello');

    const cleared = r.clearStream(streams, 'a');
    expect('a' in cleared).toBe(true);
    expect(cleared['a']!.blocks).toHaveLength(0);

    const evicted = r.evictStream(streams, 'a');
    expect('a' in evicted).toBe(false);
  });

  it('evictStream returns the ORIGINAL record for an unknown key', () => {
    const streams = r.appendToken({}, 'a', 'hello');
    expect(r.evictStream(streams, 'nope')).toBe(streams);
  });

  it('pruneStreams is a no-op below the cap', () => {
    const streams = seed(5);
    expect(r.pruneStreams(streams, { maxEntries: 10 })).toBe(streams);
  });

  it('the bound holds: 500 sessions never retain more than the cap', () => {
    let streams: StreamsRecord = {};
    for (let i = 0; i < 500; i++) {
      streams = r.appendToken(streams, `s${i}`, 'token');
      streams = r.pruneStreams(streams, { maxEntries: 16 });
      expect(Object.keys(streams).length).toBeLessThanOrEqual(16);
    }
    expect(Object.keys(streams)).toHaveLength(16);
  });

  it('evicts the least recently touched entries first', () => {
    const streams = r.pruneStreams(seed(6), { maxEntries: 3 });
    // s0..s2 were touched first, so they go.
    expect(Object.keys(streams).sort()).toEqual(['s3', 's4', 's5']);
  });

  it('a re-touched old entry survives a younger one', () => {
    let streams = seed(4); // s0 oldest … s3 newest
    streams = r.appendToken(streams, 's0', ' more'); // s0 is now the newest
    streams = r.pruneStreams(streams, { maxEntries: 2 });
    expect(Object.keys(streams).sort()).toEqual(['s0', 's3']);
  });

  it('never evicts a protected key, even when it is the oldest', () => {
    const streams = r.pruneStreams(seed(6), { maxEntries: 2, protect: ['s0'] });
    expect('s0' in streams).toBe(true);
    // The cap applies to the evictable set; protected keys are extra, which is
    // still bounded because only what is on screen is protected.
    expect(Object.keys(streams).length).toBeLessThanOrEqual(3);
  });

  it('evicting everything evictable stops rather than dropping protected keys', () => {
    const streams = r.pruneStreams(seed(3), {
      maxEntries: 1,
      protect: ['s0', 's1', 's2'],
    });
    expect(Object.keys(streams).sort()).toEqual(['s0', 's1', 's2']);
  });

  it('eviction drops the whole payload, not just the block list', () => {
    let streams = r.appendToken({}, 'a', 'x');
    streams = r.addToolCall(streams, 'a', 'read', { path: '/big' }, 'tc1');
    streams = r.completeToolCall(streams, 'a', 'tc1', 'x'.repeat(10_000));
    streams = r.appendToken(streams, 'b', 'y');

    const pruned = r.pruneStreams(streams, { maxEntries: 1 });
    expect(pruned['a']).toBeUndefined();
    expect(pruned['b']).toBeDefined();
  });
});
