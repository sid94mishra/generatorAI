// ────────────────────────────────────────────────────────────────
// streamStore — W27 bounded store.
//
// The store used to retain every session and every `stageRun:<id>` key that
// ever streamed, with its full block array, for the lifetime of the tab.
// These tests pin the bound at the Zustand boundary — the reducer's own
// eviction tests live in packages/client-core.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_RETAINED_STREAMS,
  protectStream,
  useStreamStore,
  _protectedStreamKeys,
} from '@/stores/streamStore.js';

describe('streamStore bounds', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
    for (const key of _protectedStreamKeys()) {
      // Leaking a protection across tests would silently disable the cap.
      protectStream(key)();
    }
  });

  it('never retains more than MAX_RETAINED_STREAMS keys', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < MAX_RETAINED_STREAMS * 8; i++) {
      store.appendToken(`stageRun:${i}`, 'chunk');
      expect(Object.keys(useStreamStore.getState().streams).length)
        .toBeLessThanOrEqual(MAX_RETAINED_STREAMS);
    }
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(MAX_RETAINED_STREAMS);
  });

  it('keeps the most recently written keys and drops the oldest', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < MAX_RETAINED_STREAMS + 5; i++) {
      store.appendToken(`s${i}`, 'chunk');
    }
    const streams = useStreamStore.getState().streams;
    expect(streams['s0']).toBeUndefined();
    expect(streams['s4']).toBeUndefined();
    expect(streams[`s${MAX_RETAINED_STREAMS + 4}`]).toBeDefined();
  });

  it('a protected (on-screen) session survives a flood of other streams', () => {
    const store = useStreamStore.getState();
    store.appendToken('visible-chat', 'the answer the user is reading');
    const release = protectStream('visible-chat');

    for (let i = 0; i < MAX_RETAINED_STREAMS * 3; i++) {
      store.appendToken(`stageRun:${i}`, 'chunk');
    }

    expect(useStreamStore.getState().streams['visible-chat']?.text)
      .toBe('the answer the user is reading');
    release();

    // Once released it is an ordinary LRU candidate again.
    for (let i = 0; i < MAX_RETAINED_STREAMS; i++) {
      store.appendToken(`later:${i}`, 'chunk');
    }
    expect(useStreamStore.getState().streams['visible-chat']).toBeUndefined();
  });

  it('evictStream drops a key on demand', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'hello');
    expect(useStreamStore.getState().streams['s1']).toBeDefined();
    store.evictStream('s1');
    expect(useStreamStore.getState().streams['s1']).toBeUndefined();
  });

  it('a no-op action still does not re-render subscribers', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'hello');
    const before = useStreamStore.getState().streams;
    // Empty token is a no-op in the reducer; the record identity must survive
    // the prune wrapper too, or every empty event becomes a full re-render.
    store.appendToken('s1', '');
    expect(useStreamStore.getState().streams).toBe(before);
  });
});
