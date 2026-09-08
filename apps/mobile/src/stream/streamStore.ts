// ────────────────────────────────────────────────────────────────
// streamStore — mobile binding for the shared stream reducer.
//
// Same reducer AND the same effect applier as apps/web, so the two render
// identical transcripts. This file is the Zustand adapter plus the two
// mobile-specific bounds:
//
//   1. The RECORD is bounded (D14, plan §7.2 item 6). At most
//      `MAX_RETAINED_STREAMS` chats keep stream state; the least recently
//      touched is evicted when one more is created. Web keeps 32 because a
//      tab has memory to spare; a phone keeps 6 — a chat renders one key,
//      and the rest refill from REST replay on the way back.
//
//   2. Each STREAM is bounded. A turn that runs for an hour accumulates
//      thousands of blocks; past `MAX_BLOCKS_PER_STREAM` the oldest settled
//      ones are dropped behind an "Earlier output trimmed" note. The
//      reducer locates blocks by id (`findIndex`) and appends to the LAST
//      block, so removing from the front is safe; anything still live
//      (a running tool call, an open gate, an active widget) is kept.
//
// Recency is tracked HERE, not via the reducer's `lastActivityAt`: that
// stamp only moves on writes, and the chat the user is reading right now
// may not be writing. `applyEffects` bumps every key it touches, `getStream`
// and `touch` bump on read, and `protectStream` pins an on-screen key.
//
// The frame-coalesced flush lives in `useChatStream`.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import {
  applyStreamEffects,
  DEFAULT_STREAM,
  streamReducer as r,
  type StreamBlock,
  type StreamEffect,
  type StreamState,
  type StreamsRecord,
} from '@generatorai/client-core';

/** Chats whose stream state stays resident. */
export const MAX_RETAINED_STREAMS = 6;

/** Blocks per stream before the oldest settled ones are dropped. */
export const MAX_BLOCKS_PER_STREAM = 2000;

/** The note left where blocks were dropped. Exactly one per stream. */
export const TRIMMED_MESSAGE = 'Earlier output trimmed';

// ── Recency ─────────────────────────────────────────────────────

let tick = 0;
const recency = new Map<string, number>();
const protectedKeys = new Set<string>();

function bump(key: string): void {
  tick += 1;
  recency.set(key, tick);
}

/**
 * Pin a key while a screen renders it. Pair with a `useEffect` cleanup.
 *
 * A protected key is never evicted; it still counts toward the cap, so with
 * one chat on screen five others stay resident.
 */
export function protectStream(key: string): () => void {
  protectedKeys.add(key);
  bump(key);
  return () => {
    protectedKeys.delete(key);
  };
}

/** Test-only view of internals. */
export function _streamStoreInternals(): { protectedKeys: string[]; recency: Map<string, number> } {
  return { protectedKeys: [...protectedKeys], recency: new Map(recency) };
}

/** Test-only: forget every key. */
export function _resetStreamStoreForTests(): void {
  recency.clear();
  protectedKeys.clear();
  tick = 0;
  useStreamStore.setState({ streams: {} });
}

// ── Pure bounds ─────────────────────────────────────────────────

/** A block the reducer will never write to again. */
export function isSettledBlock(block: StreamBlock, isLast: boolean): boolean {
  switch (block.type) {
    case 'text':
      // Tokens append to the last block; any earlier text block is done.
      return !isLast;
    case 'thinking':
      return block.isComplete;
    case 'tool_call':
      return block.status === 'complete';
    case 'system':
      return true;
    case 'widget':
      return block.status !== 'active';
    case 'plan':
      return block.status !== 'drafting' && block.status !== 'awaiting_review';
    case 'question':
      return block.status !== 'pending';
    case 'permission':
      return block.status !== 'pending';
    default:
      return false;
  }
}

/**
 * Drop the oldest settled blocks until the stream is within `max`.
 *
 * Returns the SAME object when nothing needs trimming, so the hot token path
 * allocates nothing. Unsettled blocks are skipped rather than dropped, so a
 * stream of 2,000 open gates would not be trimmed at all — an unreachable
 * shape, and the correct failure if it were reached.
 */
export function trimStream(state: StreamState, max: number = MAX_BLOCKS_PER_STREAM): StreamState {
  const { blocks } = state;
  if (blocks.length <= max) return state;

  const hasMarker =
    blocks[0]?.type === 'system' && blocks[0].message === TRIMMED_MESSAGE;
  // Reserve one slot for the marker so the result is exactly ≤ max.
  const target = max - 1;
  const kept: StreamBlock[] = [];
  let excess = blocks.length - (hasMarker ? 1 : 0) - target;
  const lastIndex = blocks.length - 1;

  for (let i = hasMarker ? 1 : 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (excess > 0 && isSettledBlock(block, i === lastIndex)) {
      excess -= 1;
      continue;
    }
    kept.push(block);
  }

  if (kept.length === blocks.length - (hasMarker ? 1 : 0)) return state;

  const markerId = hasMarker ? (blocks[0] as { blockId: number }).blockId : state._nextBlockId;
  const marker: StreamBlock = {
    type: 'system',
    blockId: markerId,
    message: TRIMMED_MESSAGE,
    category: 'system',
  };

  // The legacy flat lists grow in step with the blocks; bound them too, or
  // the cap only halves the problem.
  const cap = (list: readonly unknown[]) => (list.length > max ? list.slice(list.length - max) : list);

  return {
    ...state,
    blocks: [marker, ...kept],
    _nextBlockId: hasMarker ? state._nextBlockId : state._nextBlockId + 1,
    toolCalls: cap(state.toolCalls) as StreamState['toolCalls'],
    systemMessages: cap(state.systemMessages) as StreamState['systemMessages'],
  };
}

/**
 * Evict the least-recently-touched unprotected keys until within `max`.
 *
 * Keys the recency map has never seen (state restored some other way) rank
 * oldest. Returns the same record when already within the cap.
 */
export function evictLeastRecent(
  streams: StreamsRecord,
  max: number,
  rank: ReadonlyMap<string, number>,
  protect: ReadonlySet<string>,
): StreamsRecord {
  const keys = Object.keys(streams);
  if (keys.length <= max) return streams;

  const evictable = keys.filter((k) => !protect.has(k));
  evictable.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  const excess = keys.length - max;
  if (excess <= 0 || evictable.length === 0) return streams;

  let next = streams;
  for (let i = 0; i < excess && i < evictable.length; i += 1) {
    next = r.evictStream(next, evictable[i]!);
  }
  return next;
}

// ── Store ───────────────────────────────────────────────────────

interface StreamStore {
  streams: StreamsRecord;
  /** Apply a batch of router effects in one update. */
  applyEffects(effects: StreamEffect[]): void;
  /** Read with defaults. Counts as a touch. */
  getStream(key: string): StreamState;
  /** Mark a key as recently used without reading or writing it. */
  touch(key: string): void;
  /**
   * Drop a chat's stream state entirely (D14).
   *
   * Call when the user closes a chat or the screen unmounts for good. The
   * next visit refills from REST replay. This is `evictStream`, not the
   * reducer's `clearStream`: that one keeps the key, its usage and its
   * widgets resident, which is the leak this exists to fix.
   */
  clear(key: string): void;
}

export const useStreamStore = create<StreamStore>((set, get) => ({
  streams: {},

  applyEffects: (effects) =>
    set((state) => {
      if (effects.length === 0) return state;
      let next = applyStreamEffects(state.streams, effects);
      if (next === state.streams) return state;

      const touched = new Set<string>();
      for (const effect of effects) {
        if ('key' in effect && typeof effect.key === 'string') touched.add(effect.key);
      }
      for (const key of touched) {
        bump(key);
        const stream = next[key];
        if (stream && stream.blocks.length > MAX_BLOCKS_PER_STREAM) {
          const trimmed = trimStream(stream);
          if (trimmed !== stream) next = { ...next, [key]: trimmed };
        }
      }

      next = evictLeastRecent(next, MAX_RETAINED_STREAMS, recency, protectedKeys);
      for (const key of recency.keys()) {
        if (!(key in next)) recency.delete(key);
      }
      return { streams: next };
    }),

  getStream: (key) => {
    const stream = get().streams[key];
    if (stream) bump(key);
    return stream ?? DEFAULT_STREAM;
  },

  touch: (key) => {
    bump(key);
  },

  clear: (key) =>
    set((state) => {
      recency.delete(key);
      const next = r.evictStream(state.streams, key);
      return next === state.streams ? state : { streams: next };
    }),
}));
