// ────────────────────────────────────────────────────────────────
// connectionStore — SSE connection state tracking per session
// + global multiplexed SSE connection state
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface ConnectionInfo {
  state: ConnectionState;
  lastEventTime: number | null;
  eventsReceived: number;
  /**
   * N4 — events a resume could not recover.
   *
   * When a hole in the sequence is older than the client's dedup window, gap
   * fill clamps past it: those events are gone from this tab's view of the
   * transcript for good. That is data loss, and it used to be completely
   * invisible — the comment in `sseManager.gapFill` acknowledged it and
   * nothing said so to the user. This is what makes it sayable.
   */
  unrecoverableEvents: number;
  /** When the most recent unrecoverable gap was detected (epoch ms). */
  lastGapAt: number | null;
}

interface ConnectionStore {
  /** Per-session connection info */
  connections: Record<string, ConnectionInfo>;
  /** Global multiplexed SSE connection state */
  globalSSEState: ConnectionState;
  setConnectionState: (sessionId: string, state: ConnectionState) => void;
  setGlobalSSEState: (state: ConnectionState) => void;
  recordEvent: (sessionId: string) => void;
  /** Report `count` events that a resume could not recover. See ConnectionInfo. */
  recordGap: (sessionId: string, count: number) => void;
  getConnection: (sessionId: string) => ConnectionInfo;
  removeConnection: (sessionId: string) => void;
}

const DEFAULT_CONNECTION: ConnectionInfo = {
  state: 'disconnected',
  lastEventTime: null,
  eventsReceived: 0,
  unrecoverableEvents: 0,
  lastGapAt: null,
};

const useConnectionStoreImpl = create<ConnectionStore>((set, get) => ({
  connections: {},
  globalSSEState: 'disconnected',

  setConnectionState: (sessionId, state) => set((prev) => ({
    connections: {
      ...prev.connections,
      [sessionId]: {
        ...(prev.connections[sessionId] ?? DEFAULT_CONNECTION),
        state,
      },
    },
  })),

  setGlobalSSEState: (state) => set({ globalSSEState: state }),

  recordEvent: (sessionId) => set((prev) => {
    const existing = prev.connections[sessionId] ?? DEFAULT_CONNECTION;
    return {
      connections: {
        ...prev.connections,
        [sessionId]: {
          ...existing,
          lastEventTime: Date.now(),
          eventsReceived: existing.eventsReceived + 1,
          state: 'connected',
        },
      },
    };
  }),

  recordGap: (sessionId, count) => set((prev) => {
    if (count <= 0) return prev;
    const existing = prev.connections[sessionId] ?? DEFAULT_CONNECTION;
    return {
      connections: {
        ...prev.connections,
        [sessionId]: {
          ...existing,
          unrecoverableEvents: existing.unrecoverableEvents + count,
          lastGapAt: Date.now(),
        },
      },
    };
  }),

  getConnection: (sessionId) => get().connections[sessionId] ?? DEFAULT_CONNECTION,

  removeConnection: (sessionId) => set((prev) => {
    const { [sessionId]: _, ...rest } = prev.connections;
    return { connections: rest };
  }),
}));


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useConnectionStore = globalSingleton('web.connectionStore', () => useConnectionStoreImpl);
