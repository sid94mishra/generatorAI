// ────────────────────────────────────────────────────────────────
// Live-state model (mobile MG-07 / MX-11, 06 §7.3, MD-90, MD-182).
//
// One model for every "this is happening right now" surface: in-app status,
// notification copy, the iOS Live Activity, the Android Live Update and the
// widgets. It folds the attention feed (G-01), a run's stage progress and the
// outcome of a finished item into one `LiveState` per entity, and answers
// which items deserve a system surface and when that surface ends.
//
// State machine (per entity):
//
//   (none) ─attention─▶ queued ─▶ running ⇄ needs_you | waiting | paused
//                                    │
//            attention drops it ─▶ ending (awaiting its outcome, `endedAt` set)
//                                    │
//                     ended ─▶ succeeded | failed | cancelled  (terminal)
//
//   ending without an outcome for OUTCOME_GRACE_MS → forgotten (the surface
//   ends at once; no outcome is invented, MD-27).
//   any non-terminal: not confirmed for STALE_AFTER_MS → stale (derived:
//   now > staleAt), cleared by the next confirmation.
//
// Pure and React-free; mobile wraps it in its own store.
// ────────────────────────────────────────────────────────────────

import {
  STATUS_STATE_DEFS,
  type AttentionAskKind,
  type AttentionEntity,
  type AttentionItem,
} from '@generatorai/shared';
import { STEP_VERBS } from '@generatorai/shared/ui-contract';
import { attentionItemRoute } from '../attention/route.js';

export type LivePhase = 'queued' | 'running' | 'needs_you' | 'waiting' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type LiveOutcome = Extract<LivePhase, 'succeeded' | 'failed' | 'cancelled'>;
export type LiveSegment = 'done' | 'current' | 'needs_you' | 'failed' | 'pending';

export interface LiveServer {
  id: string;
  name: string;
}

export interface LiveStep {
  index?: number;
  count?: number;
  /** A stage name (runs) or a tool-step phrase (chats). */
  label?: string;
}

export interface LiveAsk {
  kind: AttentionAskKind;
  summary: string;
  risky: boolean;
}

export interface LiveState {
  /** `${serverId}:${entity}:${entityId}` */
  key: string;
  serverId: string;
  serverName: string;
  entity: AttentionEntity;
  entityId: string;
  title: string;
  /** When the API provides it (MG-29); never invented. */
  runNumber?: number;
  phase: LivePhase;
  /** Shared status copy (MD-25): "Needs you", "Running", "Cancelled". */
  statusWord: string;
  step?: LiveStep;
  /** Runs only, at most MAX_SEGMENTS. */
  segments?: LiveSegment[];
  ask?: LiveAsk;
  /** The next stage's name. */
  next?: string;
  startedAt: string;
  /** Last content change. */
  updatedAt: string;
  /** Past this the surface reads "Updates paused" (cleared by the next confirmation). */
  staleAt: string;
  /** `generatorai://…?server=<id>`; the gate's route while `ask` is set. */
  deepLink: string;
  /** Set when the attention feed dropped the item; with a non-terminal phase it awaits its outcome. */
  endedAt?: string;
}

export type LiveMap = Readonly<Record<string, LiveState>>;

export type LiveEvent =
  /** The server's full attention lists (snapshot or after a delta): upserts present items, ends missing ones. */
  | { type: 'attention'; items: readonly AttentionItem[]; server: LiveServer; now: Date }
  /** Stage progress from an open run's stream (or the reconcile after resume). */
  | { type: 'progress'; key: string; step?: LiveStep; segments?: readonly LiveSegment[]; next?: string | null; now: Date }
  /** The outcome of an ending item. */
  | { type: 'ended'; key: string; outcome: LiveOutcome; now: Date }
  /** Stop following / unpair: the surface ends immediately. */
  | { type: 'forget'; key: string }
  /** Unpair: every item of the server. */
  | { type: 'forgetServer'; serverId: string }
  /** Drop items whose dismissal time passed and endings that never learned their outcome. */
  | { type: 'sweep'; now: Date };

export const STALE_AFTER_MS = 10 * 60_000;
/** How long an ending item waits for its outcome before it is forgotten. */
export const OUTCOME_GRACE_MS = 60_000;
/** At most this many system surfaces at once (MD-90). */
export const MAX_LIVE_SURFACES = 3;
export const MAX_SEGMENTS = 12;
/** A follow lasts this long after the item was started or opened here (MD-90). */
export const FOLLOW_TTL_MS = 24 * 60 * 60_000;
/** Dismissal after the end (MD-90): failures stay longer. */
export const END_DISMISS_MS: Readonly<Record<LiveOutcome, number>> = {
  succeeded: 15 * 60_000,
  cancelled: 15 * 60_000,
  failed: 30 * 60_000,
};
/** Surfaces never update an item more often than this (06 §7.3). */
export const LIVE_COALESCE_MS = 1000;

const ID = /^[A-Za-z0-9_-]+$/;

export function liveKey(serverId: string, entity: AttentionEntity, entityId: string): string {
  return `${serverId}:${entity}:${entityId}`;
}

export function isLiveTerminal(phase: LivePhase): phase is LiveOutcome {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}

/** The shared status word for a phase. */
export function liveStatusWord(phase: LivePhase): string {
  return phase === 'cancelled' ? 'Cancelled' : STATUS_STATE_DEFS[phase].label;
}

/** Stage approvals are always risky until the server sends a verdict (MD-31, MG-34). */
function askRisky(item: AttentionItem): boolean {
  const ask = item.ask;
  if (!ask) return false;
  if (ask.risk) return ask.risk === 'risky';
  return ask.kind === 'stage_approval';
}

function deepLinkFor(item: AttentionItem, serverId: string): string {
  const route = attentionItemRoute(item, serverId);
  if (!route) return `generatorai:///?server=${encodeURIComponent(serverId)}`;
  const query = new URLSearchParams(route.params).toString();
  return `generatorai://${route.pathname}${query ? `?${query}` : ''}`;
}

function stepOf(item: AttentionItem | undefined): LiveStep | undefined {
  const p = item?.progress;
  if (!p) return undefined;
  const step: LiveStep = {};
  if (typeof p.step === 'number') step.index = p.step;
  if (typeof p.of === 'number') step.count = p.of;
  if (p.label) step.label = p.label;
  return Object.keys(step).length ? step : undefined;
}

function earliest(items: readonly AttentionItem[]): string {
  let best = items[0]!.since;
  for (const item of items) if (Date.parse(item.since) < Date.parse(best)) best = item.since;
  return best;
}

/**
 * One entity's attention items (its running row and/or its asks) → its live state. An ask wins the phase;
 * the oldest ask is the one shown.
 */
export function liveFromAttention(
  items: readonly AttentionItem[],
  server: LiveServer,
  now: Date,
  prev?: LiveState,
): LiveState {
  if (items.length === 0) throw new Error('liveFromAttention needs at least one item');
  const asks = items.filter((i) => i.ask).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  const ask = asks[0];
  const running = items.find((i) => !i.ask);
  const lead = ask ?? running ?? items[0]!;
  const phase: LivePhase = ask ? 'needs_you' : (running ?? lead).state;
  const iso = now.toISOString();
  const step = stepOf(running) ?? stepOf(lead);
  const state: LiveState = {
    key: liveKey(server.id, lead.entity, lead.entityId),
    serverId: server.id,
    serverName: server.name,
    entity: lead.entity,
    entityId: lead.entityId,
    title: (running ?? lead).title,
    phase,
    statusWord: liveStatusWord(phase),
    startedAt: prev?.startedAt ?? earliest(items),
    updatedAt: iso,
    staleAt: new Date(now.getTime() + STALE_AFTER_MS).toISOString(),
    deepLink: deepLinkFor(lead, server.id),
  };
  if (step) state.step = step;
  if (ask?.ask) state.ask = { kind: ask.ask.kind, summary: ask.ask.summary, risky: askRisky(ask) };
  if (prev?.runNumber !== undefined) state.runNumber = prev.runNumber;
  if (prev?.segments) state.segments = prev.segments;
  if (prev?.next) state.next = prev.next;
  return state;
}

/** Same content apart from the timestamps the reducer refreshes. */
function sameContent(a: LiveState, b: LiveState): boolean {
  const strip = (s: LiveState) => ({ ...s, updatedAt: '', staleAt: '' });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Refresh `staleAt` only when it moved by a minute, so a steady feed does not re-render every surface. */
const STALE_REFRESH_STEP_MS = 60_000;

function reconcile(map: LiveMap, items: readonly AttentionItem[], server: LiveServer, now: Date): LiveMap {
  if (!ID.test(server.id)) return map;
  const groups = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const key = liveKey(server.id, item.entity, item.entityId);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const draft: { map: Record<string, LiveState> | null } = { map: null };
  const write = (key: string, value: LiveState | undefined) => {
    const next = (draft.map ??= { ...map });
    if (value) next[key] = value;
    else delete next[key];
  };
  for (const [key, group] of groups) {
    const prev = map[key];
    // A terminal item that shows up again is a new run of the same entity (a chat's next turn).
    const base = prev && !isLiveTerminal(prev.phase) ? prev : undefined;
    const fresh = liveFromAttention(group, server, now, base);
    if (base && !base.endedAt && sameContent(base, fresh)) {
      const moved = Date.parse(fresh.staleAt) - Date.parse(base.staleAt);
      if (moved >= STALE_REFRESH_STEP_MS) write(key, { ...base, staleAt: fresh.staleAt });
      continue;
    }
    write(key, fresh);
  }
  for (const [key, state] of Object.entries(map)) {
    if (state.serverId !== server.id || groups.has(key) || state.endedAt || isLiveTerminal(state.phase)) continue;
    write(key, { ...state, endedAt: now.toISOString(), updatedAt: now.toISOString() });
  }
  return draft.map ?? map;
}

function segmentsEqual(a: readonly LiveSegment[] | undefined, b: readonly LiveSegment[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

export function liveReducer(map: LiveMap, event: LiveEvent): LiveMap {
  switch (event.type) {
    case 'attention':
      return reconcile(map, event.items, event.server, event.now);

    case 'progress': {
      const prev = map[event.key];
      if (!prev || isLiveTerminal(prev.phase)) return map;
      const nextState: LiveState = { ...prev };
      if (event.step) nextState.step = { ...prev.step, ...event.step };
      if (event.segments) nextState.segments = event.segments.slice(0, MAX_SEGMENTS);
      if (event.next === null) delete nextState.next;
      else if (event.next !== undefined) nextState.next = event.next;
      const changed =
        JSON.stringify(nextState.step) !== JSON.stringify(prev.step) ||
        !segmentsEqual(nextState.segments, prev.segments) ||
        nextState.next !== prev.next;
      if (!changed) return map;
      const iso = event.now.toISOString();
      return { ...map, [event.key]: { ...nextState, updatedAt: iso, staleAt: new Date(event.now.getTime() + STALE_AFTER_MS).toISOString() } };
    }

    case 'ended': {
      const prev = map[event.key];
      if (!prev || isLiveTerminal(prev.phase)) return map;
      const iso = event.now.toISOString();
      const ended: LiveState = {
        ...prev,
        phase: event.outcome,
        statusWord: liveStatusWord(event.outcome),
        endedAt: prev.endedAt ?? iso,
        updatedAt: iso,
      };
      delete ended.ask;
      if (ended.segments) {
        const mark: LiveSegment = event.outcome === 'failed' ? 'failed' : 'done';
        ended.segments = ended.segments.map((s) => (s === 'current' || s === 'needs_you' ? mark : s));
      }
      return { ...map, [event.key]: ended };
    }

    case 'forget': {
      if (!(event.key in map)) return map;
      const next = { ...map };
      delete next[event.key];
      return next;
    }

    case 'forgetServer': {
      const keys = Object.keys(map).filter((k) => map[k]!.serverId === event.serverId);
      if (!keys.length) return map;
      const next = { ...map };
      for (const k of keys) delete next[k];
      return next;
    }

    case 'sweep': {
      const now = event.now.getTime();
      const drop = Object.values(map).filter((s) => {
        if (!s.endedAt) return false;
        const ended = Date.parse(s.endedAt);
        if (isLiveTerminal(s.phase)) return now >= ended + END_DISMISS_MS[s.phase];
        return now >= ended + OUTCOME_GRACE_MS;
      });
      if (!drop.length) return map;
      const next = { ...map };
      for (const s of drop) delete next[s.key];
      return next;
    }

    default:
      return map;
  }
}

/** Items still waiting for their outcome (the client resolves them, then sends `ended`). */
export function liveAwaitingOutcome(map: LiveMap): LiveState[] {
  return Object.values(map).filter((s) => s.endedAt !== undefined && !isLiveTerminal(s.phase));
}

/**
 * Which items get a system surface (MD-90): followed on this device, Running or Needs you, at most `max`,
 * Needs you first, then the oldest start.
 */
export function liveCandidates(map: LiveMap, followed: ReadonlySet<string>, max = MAX_LIVE_SURFACES): LiveState[] {
  return Object.values(map)
    .filter((s) => followed.has(s.key) && !s.endedAt && (s.phase === 'running' || s.phase === 'needs_you'))
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase === 'needs_you' ? -1 : 1;
      const d = Date.parse(a.startedAt) - Date.parse(b.startedAt);
      return d !== 0 ? d : a.key < b.key ? -1 : 1;
    })
    .slice(0, Math.max(0, max));
}

/** When a surface ends: after the MD-90 window for a finished item; null while it is live. */
export function liveDismissal(state: LiveState): { policy: 'after'; at: Date } | null {
  if (!isLiveTerminal(state.phase)) return null;
  const ended = Date.parse(state.endedAt ?? state.updatedAt);
  return { policy: 'after', at: new Date(ended + END_DISMISS_MS[state.phase]) };
}

export function isLiveStale(state: LiveState, now: Date): boolean {
  return !isLiveTerminal(state.phase) && now.getTime() > Date.parse(state.staleAt);
}

// ── Lock-screen redaction (MD-33, 06 §6.5) ──────────────────────

/** Paths, commands, code: anything a lock screen must not show. */
const SENSITIVE_MARKS = /[/\\`$|<>{}=~]|\s-{1,2}[A-Za-z]|\.[A-Za-z]{1,5}\b/;
/** Shell words, lower-case only, so a tool name ("Allow Bash?") survives. */
const SHELL_WORDS = /\b(?:rm|git|npm|pnpm|yarn|curl|sudo|cd|cat|ls|bash|sh|python|node)\b/;
const SENSITIVE = { test: (text: string): boolean => SENSITIVE_MARKS.test(text) || SHELL_WORDS.test(text) };

const LIVE_VERBS: readonly string[] = [
  ...new Set(Object.values(STEP_VERBS).map((v) => v.live)),
].sort((a, b) => b.length - a.length);

/** A tool step → its verb ("Running pnpm test" → "Running"); a clean stage name stays. */
function redactStepLabel(label: string, entity: AttentionEntity): string | undefined {
  const verb = LIVE_VERBS.find((v) => label === v || label.startsWith(`${v} `));
  if (verb) return verb;
  if (entity === 'chat') return undefined;
  return SENSITIVE.test(label) ? undefined : label;
}

/** "Allow Bash: rm -rf build?" → "Allow Bash?"; a summary with no safe head is dropped to its kind. */
function redactSummary(summary: string): string {
  if (!SENSITIVE.test(summary)) return summary;
  const head = summary.split(':')[0]!.trim();
  if (head && head !== summary && !SENSITIVE.test(head)) return head.endsWith('?') ? head : `${head}?`;
  return 'Needs your answer';
}

/** Titles, stage names, status words and counts only; tool steps as verbs; never paths or commands. */
export function redactForLockScreen(state: LiveState): LiveState {
  const out: LiveState = { ...state };
  if (state.step) {
    const step: LiveStep = { ...state.step };
    const label = state.step.label ? redactStepLabel(state.step.label, state.entity) : undefined;
    if (label) step.label = label;
    else delete step.label;
    if (Object.keys(step).length) out.step = step;
    else delete out.step;
  }
  if (state.ask) out.ask = { ...state.ask, summary: redactSummary(state.ask.summary) };
  if (state.next && SENSITIVE.test(state.next)) delete out.next;
  return out;
}

// ── Coalescing (06 §7.3: at most one surface update per second per item) ──

export interface LiveTimers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LiveCoalescer {
  /** Ask for `key` to be emitted; emits now when it was quiet for `intervalMs`, else once at the end of the window. */
  push(key: string): void;
  /** Drop pending emits (unmount, unpair). */
  cancel(): void;
}

export function createLiveCoalescer(emit: (key: string) => void, timers: LiveTimers, intervalMs = LIVE_COALESCE_MS): LiveCoalescer {
  const last = new Map<string, number>();
  const pending = new Map<string, unknown>();
  return {
    push(key) {
      if (pending.has(key)) return;
      const now = timers.now();
      const since = now - (last.get(key) ?? -Infinity);
      if (since >= intervalMs) {
        last.set(key, now);
        emit(key);
        return;
      }
      pending.set(
        key,
        timers.setTimeout(() => {
          pending.delete(key);
          last.set(key, timers.now());
          emit(key);
        }, intervalMs - since),
      );
    },
    cancel() {
      for (const handle of pending.values()) timers.clearTimeout(handle);
      pending.clear();
    },
  };
}
