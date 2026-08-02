// ────────────────────────────────────────────────────────────────
// connectionStore — SSE connection state tracking per session
// + global multiplexed SSE connection state
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface ConnectionInfo {
  state: ConnectionState;
  lastEventTime: number | null;
  eventsReceived: number;
}

interface ConnectionStore {
  /** Per-session connection info */
  connections: Record<string, ConnectionInfo>;
  /** Global multiplexed SSE connection state */
  globalSSEState: ConnectionState;
  setConnectionState: (sessionId: string, state: ConnectionState) => void;
  setGlobalSSEState: (state: ConnectionState) => void;
  recordEvent: (sessionId: string) => void;
  getConnection: (sessionId: string) => ConnectionInfo;
  removeConnection: (sessionId: string) => void;
}

const DEFAULT_CONNECTION: ConnectionInfo = {
  state: 'disconnected',
  lastEventTime: null,
  eventsReceived: 0,
};

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
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

  getConnection: (sessionId) => get().connections[sessionId] ?? DEFAULT_CONNECTION,

  removeConnection: (sessionId) => set((prev) => {
    const { [sessionId]: _, ...rest } = prev.connections;
    return { connections: rest };
  }),
}));
