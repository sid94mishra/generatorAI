// ────────────────────────────────────────────────────────────────
// streamHealth — the app-wide answer to "am I live?".
//
// Every screen used to keep its own connection status (the chat screen's
// `SseStatus` chip) and nothing kept the app's. So when the shared socket
// dropped on the Chats tab there was no indication at all, and when the
// server refused the `global` scope — which is what happens to every phone
// paired before `read:activity` existed — the lists simply went quiet.
//
// This store is fed by whichever subscriptions are open (`useGlobalStream`,
// `useChatStream`) and read by `ConnectionStrip`, which is mounted once above
// the navigator. The shared connection is ONE socket, so every scope hears
// the same connection-level callbacks and they cannot disagree.
//
// The pure helpers are exported for the node test-suite: the mapping from a
// `MuxStreamClient` disconnect reason to a state is the one place a wrong
// guess would make a healthy app claim to be offline.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'offline';

export interface RejectedScope {
  scope: string;
  id: string;
  /** The scope the server named as missing, e.g. `read:activity`. */
  requiredScope: string;
}

interface StreamHealthStore {
  connection: ConnectionState;
  /** Reconnect attempt, meaningful only while `reconnecting`. */
  attempt: number;
  rejectedScopes: RejectedScope[];
  /**
   * Bumped by `clearRejected`. Subscribers that were dropped for a missing
   * scope depend on it so they re-subscribe after the user's Retry — the mux
   * client dropped the scope, so nothing else would ask for it again.
   */
  retryGeneration: number;
  setConnection(next: ConnectionState, attempt?: number): void;
  noteRejected(entry: RejectedScope): void;
  clearRejected(): void;
}

export const useStreamHealth = create<StreamHealthStore>((set) => ({
  connection: 'idle',
  attempt: 0,
  rejectedScopes: [],
  retryGeneration: 0,

  setConnection: (next, attempt = 0) =>
    set((state) =>
      state.connection === next && state.attempt === attempt ? state : { connection: next, attempt },
    ),

  noteRejected: (entry) =>
    set((state) => {
      const exists = state.rejectedScopes.some(
        (r) => r.scope === entry.scope && r.id === entry.id,
      );
      return exists ? state : { rejectedScopes: [...state.rejectedScopes, entry] };
    }),

  clearRejected: () =>
    set((state) => ({ rejectedScopes: [], retryGeneration: state.retryGeneration + 1 })),
}));

/** The reason prefix `MuxStreamClient` uses when the server 403s one scope. */
const REJECTED_SCOPE_PREFIX = 'rejected:insufficient_scope:';

/**
 * The scope the server wanted, or null when the reason is not a scope
 * rejection. Scopes themselves contain a colon (`read:activity`), so this is
 * a prefix strip rather than a split.
 */
export function requiredScopeFromReason(reason: string | undefined): string | null {
  if (!reason || !reason.startsWith(REJECTED_SCOPE_PREFIX)) return null;
  const scope = reason.slice(REJECTED_SCOPE_PREFIX.length).trim();
  return scope.length > 0 ? scope : null;
}

/**
 * What a scope's `onDisconnected(reason)` says about the CONNECTION.
 *
 * Returns null when it says nothing: a `gap:` means this scope needs a fresh
 * snapshot but the socket is fine, and a `rejected:` means the server
 * declined this scope while serving the others. Treating either as offline
 * would raise the strip on a working app. `disposed` is the client being
 * torn down on purpose (backgrounding, re-auth), so it returns to idle rather
 * than claiming a failure.
 */
export function connectionFromDisconnect(reason: string | undefined): ConnectionState | null {
  if (!reason) return 'offline';
  if (reason.startsWith('gap:') || reason.startsWith('rejected:')) return null;
  if (reason === 'disposed') return 'idle';
  return 'offline';
}

export type NoticeTone = 'danger' | 'warning';

export interface ConnectionNotice {
  kind: 'offline' | 'reconnecting' | 'rejected';
  tone: NoticeTone;
  message: string;
  /** Present when the strip should offer a Retry. */
  retry: boolean;
}

/** Only the `global` scope's rejection is surfaced by name. */
const SCOPE_LABEL: Record<string, string> = {
  global: 'Activity feed',
};

/**
 * What the strip shows, or null for nothing.
 *
 * Priority is connection first: a rejected scope is moot while the socket is
 * down, and saying "ask an admin" to someone who has walked out of Wi-Fi
 * range sends them to the wrong fix.
 */
export function describeNotice(
  connection: ConnectionState,
  attempt: number,
  rejected: readonly RejectedScope[],
): ConnectionNotice | null {
  if (connection === 'offline') {
    return { kind: 'offline', tone: 'danger', message: 'Offline — live updates paused', retry: false };
  }
  if (connection === 'reconnecting') {
    return {
      kind: 'reconnecting',
      tone: 'warning',
      message: attempt > 0 ? `Reconnecting… (attempt ${attempt})` : 'Reconnecting…',
      retry: false,
    };
  }
  const first = rejected[0];
  if (first) {
    const label = SCOPE_LABEL[first.scope] ?? `The ‘${first.scope}’ feed`;
    return {
      kind: 'rejected',
      tone: 'warning',
      message: `${label} needs the ‘${first.requiredScope}’ permission — ask an admin to update this device’s permissions`,
      retry: true,
    };
  }
  return null;
}
