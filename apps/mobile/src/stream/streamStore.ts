// ────────────────────────────────────────────────────────────────
// streamStore — mobile binding for the shared stream reducer.
//
// Same reducer AND the same effect applier as apps/web, so the two render
// identical transcripts. This file is now only the Zustand adapter: the
// effect → reducer switch it used to own moved to `applyStreamEffect` in
// client-core (W26), because two copies of it is two places for a fix to
// land on one surface and miss the other.
//
// The one mobile-specific concern left here is the frame-coalesced flush:
// applying every token to the store as it arrives means hundreds of renders
// per second and a visible stutter on any phone. See `useChatStream`.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import {
  applyStreamEffects,
  DEFAULT_STREAM,
  streamReducer as r,
  type StreamEffect,
  type StreamState,
  type StreamsRecord,
} from '@generatorai/client-core';

interface StreamStore {
  streams: StreamsRecord;
  /** Apply a batch of router effects in one update. */
  applyEffects(effects: StreamEffect[]): void;
  getStream(key: string): StreamState;
  clear(key: string): void;
}

export const useStreamStore = create<StreamStore>((set, get) => ({
  streams: {},

  applyEffects: (effects) =>
    set((state) => {
      if (effects.length === 0) return state;
      const next = applyStreamEffects(state.streams, effects);
      return next === state.streams ? state : { streams: next };
    }),

  getStream: (key) => get().streams[key] ?? DEFAULT_STREAM,

  clear: (key) =>
    set((state) => {
      const next = r.clearStream(state.streams, key);
      return next === state.streams ? state : { streams: next };
    }),
}));
