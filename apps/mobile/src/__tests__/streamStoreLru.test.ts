// ────────────────────────────────────────────────────────────────
// streamStore — D14 bounds: LRU eviction across chats, block cap per chat.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamEffect } from '@generatorai/client-core';

import {
  MAX_BLOCKS_PER_STREAM,
  MAX_RETAINED_STREAMS,
  TRIMMED_MESSAGE,
  _resetStreamStoreForTests,
  _streamStoreInternals,
  evictLeastRecent,
  isSettledBlock,
  protectStream,
  trimStream,
  useStreamStore,
} from '../stream/streamStore';

const token = (key: string, text = 'x'): StreamEffect => ({ op: 'appendToken', key, text });
const toolCall = (key: string, callId: string): StreamEffect => ({
  op: 'addToolCall',
  key,
  tool: 'Read',
  args: {},
  callId,
});
const complete = (key: string, callId: string): StreamEffect => ({
  op: 'completeToolCall',
  key,
  toolOrCallId: callId,
  result: 'ok',
});

function keys(): string[] {
  return Object.keys(useStreamStore.getState().streams);
}

describe('streamStore — LRU across chats', () => {
  beforeEach(() => _resetStreamStoreForTests());

  it('keeps at most MAX_RETAINED_STREAMS chats', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < MAX_RETAINED_STREAMS * 4; i += 1) {
      store.applyEffects([token(`chat-${i}`)]);
      expect(keys().length).toBeLessThanOrEqual(MAX_RETAINED_STREAMS);
    }
    expect(keys()).toHaveLength(MAX_RETAINED_STREAMS);
    expect(MAX_RETAINED_STREAMS).toBe(6);
  });

  it('evicts the least-recently-touched chat when a 7th is created', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < 6; i += 1) store.applyEffects([token(`chat-${i}`)]);
    // chat-0 is the oldest, but reading it makes it the newest.
    store.getStream('chat-0');
    store.applyEffects([token('chat-6')]);
    const remaining = keys();
    expect(remaining).toContain('chat-0');
    expect(remaining).not.toContain('chat-1');
    expect(remaining).toContain('chat-6');
  });

  it('touch() counts as recency without reading or writing', () => {
    const store = useStreamStore.getState();
    for (let i = 0; i < 6; i += 1) store.applyEffects([token(`chat-${i}`)]);
    store.touch('chat-1');
    store.applyEffects([token('chat-7')]);
    expect(keys()).toContain('chat-1');
    expect(keys()).not.toContain('chat-0');
  });

  it('a protected (on-screen) chat survives a flood of others', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('visible', 'the answer')]);
    const release = protectStream('visible');
    for (let i = 0; i < 20; i += 1) store.applyEffects([token(`other-${i}`)]);
    expect(useStreamStore.getState().streams['visible']?.text).toBe('the answer');
    expect(keys()).toHaveLength(MAX_RETAINED_STREAMS);

    release();
    expect(_streamStoreInternals().protectedKeys).toEqual([]);
    for (let i = 0; i < 6; i += 1) store.applyEffects([token(`later-${i}`)]);
    expect(useStreamStore.getState().streams['visible']).toBeUndefined();
  });

  it('clear() drops a chat and its recency entry', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('a'), token('b')]);
    store.clear('a');
    expect(keys()).toEqual(['b']);
    expect(_streamStoreInternals().recency.has('a')).toBe(false);
    // Clearing an unknown key is a no-op with the same record identity.
    const before = useStreamStore.getState().streams;
    store.clear('nope');
    expect(useStreamStore.getState().streams).toBe(before);
  });

  it('applyEffects with nothing to do keeps the record identity', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('a')]);
    const before = useStreamStore.getState().streams;
    store.applyEffects([]);
    expect(useStreamStore.getState().streams).toBe(before);
    store.applyEffects([token('a', '')]);
    expect(useStreamStore.getState().streams).toBe(before);
  });

  it('evictLeastRecent is pure and ranks unknown keys oldest', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('known')]);
    const streams = {
      ...useStreamStore.getState().streams,
      unknown: useStreamStore.getState().streams['known']!,
    };
    const rank = _streamStoreInternals().recency;
    const next = evictLeastRecent(streams, 1, rank, new Set());
    expect(Object.keys(next)).toEqual(['known']);
    expect(evictLeastRecent(streams, 5, rank, new Set())).toBe(streams);
  });
});

describe('streamStore — block cap per chat', () => {
  beforeEach(() => _resetStreamStoreForTests());

  it('trims the oldest settled blocks behind one system note', () => {
    const store = useStreamStore.getState();
    const effects: StreamEffect[] = [];
    // Each completed tool call is one settled block.
    for (let i = 0; i < MAX_BLOCKS_PER_STREAM + 50; i += 1) {
      effects.push(toolCall('c', `call-${i}`), complete('c', `call-${i}`));
    }
    store.applyEffects(effects);

    const stream = useStreamStore.getState().streams['c']!;
    expect(stream.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_STREAM);
    expect(stream.blocks[0]).toMatchObject({ type: 'system', message: TRIMMED_MESSAGE });
    // Newest survives; oldest is gone.
    const callIds = stream.blocks.flatMap((b) => (b.type === 'tool_call' ? [b.callId] : []));
    expect(callIds).toContain(`call-${MAX_BLOCKS_PER_STREAM + 49}`);
    expect(callIds).not.toContain('call-0');
    // Exactly one marker, even after a second overflow.
    store.applyEffects([toolCall('c', 'more'), complete('c', 'more')]);
    for (let i = 0; i < 100; i += 1) store.applyEffects([toolCall('c', `m-${i}`), complete('c', `m-${i}`)]);
    const again = useStreamStore.getState().streams['c']!;
    expect(again.blocks.filter((b) => b.type === 'system' && b.message === TRIMMED_MESSAGE)).toHaveLength(1);
    expect(again.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_STREAM);
  });

  it('keeps unsettled blocks (a running tool call) while trimming around them', () => {
    const store = useStreamStore.getState();
    const effects: StreamEffect[] = [toolCall('c', 'still-running')];
    for (let i = 0; i < MAX_BLOCKS_PER_STREAM + 10; i += 1) {
      effects.push(toolCall('c', `done-${i}`), complete('c', `done-${i}`));
    }
    store.applyEffects(effects);
    const stream = useStreamStore.getState().streams['c']!;
    const running = stream.blocks.find((b) => b.type === 'tool_call' && b.callId === 'still-running');
    expect(running).toBeDefined();
    // …and the reducer can still complete it by id after the trim.
    store.applyEffects([complete('c', 'still-running')]);
    const after = useStreamStore.getState().streams['c']!;
    const settled = after.blocks.find((b) => b.type === 'tool_call' && b.callId === 'still-running');
    expect(settled).toMatchObject({ status: 'complete' });
  });

  it('trimStream returns the same object under the cap', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('c', 'hello')]);
    const stream = useStreamStore.getState().streams['c']!;
    expect(trimStream(stream)).toBe(stream);
  });

  it('treats the in-flight text block as unsettled', () => {
    const store = useStreamStore.getState();
    store.applyEffects([token('c', 'growing')]);
    const stream = useStreamStore.getState().streams['c']!;
    const last = stream.blocks[stream.blocks.length - 1]!;
    expect(isSettledBlock(last, true)).toBe(false);
    expect(isSettledBlock(last, false)).toBe(true);
  });
});
