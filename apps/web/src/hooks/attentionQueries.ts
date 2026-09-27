// ────────────────────────────────────────────────────────────────
// Attention feed hooks (G-01) — Needs you + Running, live.
//
// One implementation for every client (08-mobile-readiness): the web wraps
// client-core's `createAttentionStore` — the same store mobile uses — in
// `useSyncExternalStore`. The store owns the seq rules:
//
//   - a delta already covered by the snapshot is ignored;
//   - a skipped `seq`, a stream resync, or a reconnect after an error
//     refetches the snapshot — one request at a time, never cancelled, so a
//     burst of deltas cannot keep a refetch from landing (P2-R12);
//   - every delta that arrives while a request is in flight is held and
//     replayed on top of the response, so an answer built before the latest
//     delta never rolls the view back.
//
// Every hook instance for the same platform + project shares one store (one
// `global` subscription, one request), reference-counted and stopped when the
// last consumer unmounts.
//
// Consumers: the sidebar and rail (P3), ChatsList status (P3), Home, the
// ProjectDetail banner and the palette (P5), the desktop badge/tray feed
// (`app/shell/useDesktopBridge`). No UI lives here. Until `data` is defined the
// lists are UNKNOWN, not empty — render nothing rather than "Nothing needs
// you" (D-36).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  createAttentionStore,
  initialAttentionState,
  type AttentionState,
  type AttentionStore,
  type AttentionStreamEvent,
  type AttentionStreamPort,
} from '@generatorai/client-core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AttentionCounts, AttentionItem, AttentionSnapshot, IPlatformClient } from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import { openMultiplexedStream } from '../platform/muxStream.js';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';

export interface UseAttentionOptions {
  /** Only this project's items; counts follow the filter. */
  projectId?: string;
  enabled?: boolean;
}

export interface AttentionResult {
  /** Undefined until the first snapshot — never an invented empty feed. */
  data: AttentionSnapshot | undefined;
  /** The last snapshot request failed (the previous data, if any, is kept). */
  error: string | null;
  isLoading: boolean;
  /** Fetch the snapshot again now. */
  refetch: () => Promise<void>;
}

/**
 * Safety net for a principal whose `global` subscription was refused: the
 * stream keeps the snapshot current otherwise.
 */
const SAFETY_REFRESH_MS = 60_000;

/** Parses one multiplexed frame body (`{"kind":…,"payload":…}`). */
function parseFrame(raw: string): AttentionStreamEvent | null {
  try {
    const frame = JSON.parse(raw) as { kind?: unknown; payload?: unknown };
    return typeof frame.kind === 'string' ? { kind: frame.kind, data: frame.payload } : null;
  } catch {
    return null;
  }
}

/** The web's shared multiplexed stream, in the shape `createAttentionStore` subscribes to. */
const muxPort: AttentionStreamPort = {
  subscribe(scope, id, handler, options) {
    const handle = openMultiplexedStream(
      scope,
      id,
      {
        onMessage: (message) => {
          const event = parseFrame(message.data);
          if (event) handler(event);
        },
        onOpen: () => options?.onConnected?.(),
        onError: () => options?.onDisconnected?.('error'),
        // The server could not replay this scope from our cursor.
        onResync: (reason) => options?.onDisconnected?.(`gap:${reason}`),
      },
      options?.filter,
    );
    return () => handle.close();
  },
};

interface Entry {
  store: AttentionStore;
  refs: number;
  timer: ReturnType<typeof setInterval> | null;
}

const registry = new WeakMap<IPlatformClient, Map<string, Entry>>();

function acquire(platform: IPlatformClient, projectId: string | undefined): Entry {
  let byKey = registry.get(platform);
  if (!byKey) {
    byKey = new Map();
    registry.set(platform, byKey);
  }
  const key = projectId ?? '';
  let entry = byKey.get(key);
  if (!entry) {
    entry = {
      store: createAttentionStore(platform, muxPort, projectId ? { projectId } : {}),
      refs: 0,
      timer: null,
    };
    byKey.set(key, entry);
  }
  entry.refs += 1;
  if (entry.refs === 1) {
    entry.store.start();
    const store = entry.store;
    entry.timer = setInterval(() => void store.refresh(), SAFETY_REFRESH_MS);
  }
  return entry;
}

function release(platform: IPlatformClient, projectId: string | undefined, entry: Entry): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entry.timer) clearInterval(entry.timer);
  entry.timer = null;
  entry.store.stop();
  registry.get(platform)?.delete(projectId ?? '');
}

const IDLE: AttentionState = initialAttentionState();
const noopSubscribe = (): (() => void) => () => {};

/** The attention snapshot, kept live. `data.needsYou` / `data.running` / `data.counts`. */
export function useAttention(options: UseAttentionOptions = {}): AttentionResult {
  const platform = usePlatform();
  const { projectId } = options;
  const enabled = options.enabled !== false;
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEntry(null);
      return undefined;
    }
    const acquired = acquire(platform, projectId);
    setEntry(acquired);
    return () => release(platform, projectId, acquired);
  }, [platform, projectId, enabled]);

  const store = entry?.store;
  const state = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getState : () => IDLE,
  );
  const refetch = useCallback(() => (store ? store.refresh() : Promise.resolve()), [store]);

  const data = state.snapshot ?? undefined;
  return {
    data,
    error: state.error,
    isLoading: enabled && !data && !state.error,
    refetch,
  };
}

/**
 * Needs you / Running totals for badges (rail dot, running counter). Undefined
 * until loaded — never a made-up zero.
 */
export function useAttentionCounts(options: UseAttentionOptions = {}): AttentionCounts | undefined {
  return useAttention(options).data?.counts;
}

// ── Inline actions (Home "Needs you" / "Running", D-22) ─────────────
//
// Every action calls an EXISTING endpoint (05 §G-01 "Quick actions"); the
// feed's own `attention.remove` delta then drops the row, and a refetch after
// the call covers a missed delta. Kinds without an inline form (a question, a
// stage input, computer consent — its answer needs the app identity only the
// computer panel holds — and a paused run) are opened, never answered here.

/** An inline action Home can run on an attention item. */
export type AttentionInlineAction = 'allow_once' | 'approve' | 'stop';

export interface AttentionActionInput {
  item: Pick<AttentionItem, 'entity' | 'entityId' | 'ask'>;
  action: AttentionInlineAction;
}

/** Runs one inline action on an attention item, then refetches the feed. */
export function useAttentionAction() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  const { refetch } = useAttention();
  return useMutation({
    mutationFn: async ({ item, action }: AttentionActionInput): Promise<void> => {
      const { entity, entityId, ask } = item;
      if (action === 'stop') {
        if (entity === 'chat') {
          await platform.cancelChat(entityId);
          return;
        }
        if (entity === 'workflow_run') return platform.runCommand(entityId, { command: 'cancel' });
        throw new Error('This item cannot be stopped from here.');
      }
      if (!ask) throw new Error('Nothing is waiting on this item.');
      if (action === 'allow_once' && entity === 'chat' && ask.kind === 'tool_permission') {
        return platform.respondToChatPermission(entityId, ask.id, { behavior: 'allow' });
      }
      if (action === 'approve' && entity === 'chat' && ask.kind === 'plan_review') {
        // The ask is the gate; the decision route is keyed by the plan the gate carries.
        const gates = await platform.getChatInteractions(entityId);
        const planId = gates.find((g) => g.interactionId === ask.id)?.payload?.['planId'];
        if (typeof planId !== 'string') throw new Error('This plan is no longer awaiting review.');
        return platform.decideChatPlan(entityId, planId, { approved: true });
      }
      if (action === 'approve' && entity === 'workflow_run' && ask.kind === 'stage_approval') {
        // Engine v2: an approval gate is resolved by the run's `approve` command
        // on the waiting instance; a refused command (409) rejects with the reason.
        return platform.runCommand(entityId, { command: 'approve', instanceId: ask.id, outcome: 'approved' });
      }
      throw new Error('This request has to be answered where it was asked.');
    },
    onSettled: (_data, _error, { item }) => {
      void refetch();
      if (item.entity === 'chat') void queryClient.invalidateQueries({ queryKey: ['chat', item.entityId, 'interactions'] });
    },
  });
}
