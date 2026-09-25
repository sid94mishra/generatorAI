// ────────────────────────────────────────────────────────────────
// Attention feed read model (G-01) — the pure half.
//
// `GET /api/attention` returns a snapshot stamped with `seq`; the server then
// emits one `attention.upsert` / `attention.remove` per change on the `global`
// stream scope, each carrying the next `seq`. The rule every client applies:
//
//   seq <= snapshot.seq      already folded into the snapshot — ignore
//   seq == snapshot.seq + 1  apply
//   seq >  snapshot.seq + 1  a delta was missed — refetch the snapshot
//
// A restarted server starts its `seq` far beyond the old one, so a client that
// outlives a restart sees a gap and refetches, which is what it must do.
//
// `attention.counts` never advances `seq`: it is for counts-only consumers
// (tray, badge — G-05). A client holding items derives counts from them with
// the same `countAttention` the server uses, so it ignores that kind here.
//
// React-free and platform-free: web wraps it in React Query, mobile in its
// own store (`createAttentionStore`).
// ────────────────────────────────────────────────────────────────

import {
  compareAttentionItems,
  countAttention,
  type AttentionEntity,
  type AttentionFilter,
  type AttentionItem,
  type AttentionSnapshot,
} from '@generatorai/shared';

/** One event off the stream, as both the web mux and `MuxStreamClient` deliver it. */
export interface AttentionStreamEvent {
  kind: string;
  data: unknown;
}

/** Kinds the attention read model consumes. Subscribe `global` with this filter. */
export const ATTENTION_STREAM_FILTER: readonly string[] = ['attention.'];

export function isAttentionStreamEvent(event: { kind: string }): boolean {
  return event.kind.startsWith('attention.');
}

export interface ApplyAttentionResult {
  snapshot: AttentionSnapshot;
  /** A delta was missed; the snapshot is stale until refetched. */
  gap: boolean;
}

function readSeq(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const seq = (data as { seq?: unknown }).seq;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined;
}

function matchesFilter(item: AttentionItem, filter: AttentionFilter): boolean {
  return !filter.projectId || item.project?.id === filter.projectId;
}

/**
 * Folds one stream event into a snapshot. Returns the SAME snapshot object
 * when nothing changed, so a caller can skip a re-render by identity.
 */
export function applyAttentionEvent(
  snapshot: AttentionSnapshot,
  event: AttentionStreamEvent,
  filter: AttentionFilter = {},
): ApplyAttentionResult {
  if (event.kind !== 'attention.upsert' && event.kind !== 'attention.remove') {
    return { snapshot, gap: false };
  }
  const seq = readSeq(event.data);
  if (seq === undefined || seq <= snapshot.seq) return { snapshot, gap: false };
  if (seq > snapshot.seq + 1) return { snapshot, gap: true };

  const data = event.data as { key?: unknown; item?: AttentionItem };
  const item = event.kind === 'attention.upsert' ? data.item : undefined;
  const key = item ? item.key : typeof data.key === 'string' ? data.key : undefined;
  // A malformed delta still consumed a `seq`; only a fresh snapshot can say what it was.
  if (typeof key !== 'string') return { snapshot, gap: true };

  const needsYou = snapshot.needsYou.filter((entry) => entry.key !== key);
  const running = snapshot.running.filter((entry) => entry.key !== key);
  // An item outside a project filter still advances `seq`: as far as this
  // view is concerned it is a removal.
  if (item && matchesFilter(item, filter)) {
    const list = item.ask ? needsYou : running;
    list.push(item);
    list.sort(compareAttentionItems);
  }
  return {
    snapshot: { ...snapshot, seq, needsYou, running, counts: countAttention(needsYou, running) },
    gap: false,
  };
}

// ── The reducer ──────────────────────────────────────────────────

export interface AttentionState {
  /** Null until the first snapshot arrives. */
  snapshot: AttentionSnapshot | null;
  filter: AttentionFilter;
  /** Deltas that arrived before the first snapshot; replayed on top of it. */
  buffered: AttentionStreamEvent[];
  /** A delta was missed (or the stream lost its place): refetch the snapshot. */
  needsResync: boolean;
  /** The last snapshot fetch failed. Cleared by the next snapshot. */
  error: string | null;
}

export type AttentionReducerEvent =
  | { type: 'snapshot'; snapshot: AttentionSnapshot }
  | { type: 'stream'; event: AttentionStreamEvent }
  | { type: 'resync' }
  | { type: 'error'; message: string };

/** Pre-snapshot deltas worth keeping; anything older is covered by the snapshot or detected as a gap. */
const MAX_BUFFERED = 500;

export function initialAttentionState(filter: AttentionFilter = {}): AttentionState {
  return { snapshot: null, filter, buffered: [], needsResync: false, error: null };
}

export function attentionReducer(state: AttentionState, event: AttentionReducerEvent): AttentionState {
  switch (event.type) {
    case 'snapshot': {
      let snapshot = event.snapshot;
      let gap = false;
      for (const buffered of state.buffered) {
        const result = applyAttentionEvent(snapshot, buffered, state.filter);
        if (result.gap) {
          gap = true;
          break;
        }
        snapshot = result.snapshot;
      }
      return { ...state, snapshot, buffered: [], needsResync: gap, error: null };
    }
    case 'stream': {
      if (!isAttentionStreamEvent(event.event)) return state;
      if (!state.snapshot) {
        return { ...state, buffered: [...state.buffered, event.event].slice(-MAX_BUFFERED) };
      }
      const result = applyAttentionEvent(state.snapshot, event.event, state.filter);
      if (result.gap) return state.needsResync ? state : { ...state, needsResync: true };
      return result.snapshot === state.snapshot ? state : { ...state, snapshot: result.snapshot };
    }
    case 'resync':
      return state.needsResync ? state : { ...state, needsResync: true };
    case 'error':
      return { ...state, error: event.message };
  }
}

// ── Selectors ────────────────────────────────────────────────────

const NONE: readonly AttentionItem[] = Object.freeze([]);

/** Needs you, oldest ask first. Empty until loaded — check `state.snapshot` before saying "nothing". */
export function selectNeedsYou(state: AttentionState): readonly AttentionItem[] {
  return state.snapshot?.needsYou ?? NONE;
}

/** Running, longest-running first. */
export function selectRunning(state: AttentionState): readonly AttentionItem[] {
  return state.snapshot?.running ?? NONE;
}

/** Null until loaded, so a badge never shows a made-up zero. */
export function selectCounts(state: AttentionState): AttentionSnapshot['counts'] | null {
  return state.snapshot?.counts ?? null;
}

/** Every item for one entity (a chat's asks, a run's stages …), Needs you first. */
export function selectAttentionFor(state: AttentionState, entity: AttentionEntity, id: string): AttentionItem[] {
  const match = (item: AttentionItem): boolean => item.entity === entity && item.entityId === id;
  return [...selectNeedsYou(state).filter(match), ...selectRunning(state).filter(match)];
}

/** Needs you + Running narrowed to one project, with counts for that project. */
export function selectAttentionByProject(
  state: AttentionState,
  projectId: string,
): { needsYou: AttentionItem[]; running: AttentionItem[]; counts: AttentionSnapshot['counts'] } {
  const inProject = (item: AttentionItem): boolean => item.project?.id === projectId;
  const needsYou = selectNeedsYou(state).filter(inProject);
  const running = selectRunning(state).filter(inProject);
  return { needsYou, running, counts: countAttention(needsYou, running) };
}
