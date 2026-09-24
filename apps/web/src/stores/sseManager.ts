// ────────────────────────────────────────────────────────────────
// sseManager — STR-04 / Phase 4 streaming rewrite
//
// Each view subscribes a scope against the unified `/api/stream` endpoint
// (STR-03). Those subscriptions share ONE `EventSource` per tab, owned by
// `platform/muxStream.ts` (W09-a, §5.9).
//
// This file used to argue the opposite — that per-scope connections were
// better because there were "only 1-2 EventSources per tab" and "the old
// watchdog-reconnect-and-gap-fill dance is gone". Both premises decayed:
// a chat tab with the right pane open opened FIVE, and the watchdog below is
// still here. De-multiplexing did not remove it; it multiplied the number of
// things that can silently stall from one to five.
//
// What the shared connection changes here, and nothing else:
//
//   - Reconnection, the per-scope cursor map (N-9) and cross-scope dedup on
//     the global event id (N-10) moved into `muxStream`.
//   - Frames arrive in the same `{lastEventId, data}` shape, so `parseFrame`,
//     the replay drain and the stall watchdog are untouched.
//
// What we deliberately KEEP from the old implementation (verbatim):
//
//   - `processEvent` — 500+ lines of carefully-tuned event routing
//     (cross-buffer flush, per-stage stream keys, invalidation,
//     workflow-run-store integration). Do NOT rewrite this — CLAUDE.md
//     explicitly flags the thinking ↔ token cross-buffer flush as
//     load-bearing for UI temporal ordering.
//   - `replayEventsIntoStore` for REST initial replay.
//   - All store contracts (useStreamStore, useChatStore,
//     useWorkflowRunStore, useConnectionStore) stay unchanged so
//     components don't need to adapt.
//
// Public API:
//
//   - connectChatSession(chatId, sessionId, platform) — subscribes
//     scope=chat&id=<chatId>. Primary caller: ChatPage.
//   - connectWorkflowRun(runId, platform) — one EventSource at
//     scope=run&id=<runId>. Primary caller: WorkflowRunPage.
//     Replaces the old per-stage-session connectSession loop.
//   - disconnect* + disconnectAll for cleanup.
// ────────────────────────────────────────────────────────────────

import { useStreamStore } from './streamStore.js';
import { useConnectionStore } from './connectionStore.js';
import { useChatStore } from './chatStore.js';
import { useRewindStore } from './rewindStore.js';
import { useWorkflowRunStore } from './workflowRunStore.js';
import { queryClient } from '../providers/QueryProvider.js';
import { backgroundTasksKeys, queryKeys } from '../hooks/queries.js';
import { workflowKeys } from '../hooks/workflowQueries.js';
import { replayEventsIntoStore } from '../utils/replayEvents.js';
import { hydrateWidgetsForChat } from '../utils/hydrateWidgets.js';
import { widgetBridge } from '../lib/widgetBridge.js';
import { countFallback } from '../lib/clientMetrics.js';
import type { PersistedEvent } from '@generatorai/shared';
import type { WorkflowRunStatus, StageRunStatus } from '@generatorai/shared';
import {
  cancelFrame,
  partitionEffects,
  scheduleFrame,
  StreamEventRouter,
  type FrameHandle,
  type StreamEffect,
} from '@generatorai/client-core';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import { openMultiplexedStream } from '../platform/muxStream.js';
import { globalSingleton } from '../lib/globalSingleton.js';
import { blockDeliveryEntry } from '../platform/surfaceCapabilities.js';

// ── Connection scope ──

type StreamScope = 'chat' | 'run' | 'session' | 'global' | 'automation';

// ── Per-connection state ──
//
// Keyed by `${scope}:${scopeId}` inside the `connections` map.
// Holds exactly what the old `SessionConnection` held — buffer state for
// cross-flush ordering, replay watermarks, dedup set. `primarySessionId`
// is only used by processEvent for query invalidation; for a run-scope
// subscription it's the master-session of the run (or `scopeId`) since
// stage events carry their own session id in payload anyway.

interface ConnectionState {
  readonly scope: StreamScope;
  readonly scopeId: string;
  /** Fallback sessionId for query invalidation / stream key. */
  readonly primarySessionId: string;
  refCount: number;
  eventSource: EventSource | null;
  /** True once the initial REST replay has completed; before that, live
   *  frames are buffered into `pendingSSEEvents` so replay output and
   *  live events don't interleave out of order. */
  replayed: boolean;
  /**
   * W26 — the hydration re-entrancy guard. A reconnect fires `onOpen` again,
   * and a second concurrent snapshot would double every event it fetched.
   */
  hydrating: boolean;
  /** Fires the hydration anyway when `hello` never arrives. */
  hydrateFallback: ReturnType<typeof setTimeout> | null;
  /** True while the pending-event flush loop is executing, preventing
   *  closeConnection from clearing the buffer mid-drain. */
  draining: boolean;
  replayPromise: Promise<void> | null;
  pendingSSEEvents: PersistedEvent[];
  lastReplayedSequence: number;
  maxSeenSequence: number;
  seenSequenceIds: Set<number>;

  /**
   * W26 — the ONE event router, shared with mobile and available to the CLI.
   *
   * One instance PER CONNECTION, not per tab: it owns this connection's
   * per-stream-key token buffers (which is what stops parallel stages
   * interleaving) and its stage attribution. Two connections must not share
   * either.
   */
  router: StreamEventRouter;
  /** Pending frame-aligned drain, if one is scheduled. */
  drainHandle: FrameHandle | null;
  /**
   * Armed settle-and-clear timers, keyed by stream key.
   *
   * A map rather than the single `idleTimer` this replaced: a run-scope
   * connection settles many stage keys, and one shared handle meant the
   * second stage to settle silently cancelled the first one's timer.
   */
  cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;

  // ── Stall watchdog (self-healing for missed terminal events) ──
  // Native EventSource silently drops a connection when a proxy/browser idle
  // timeout fires during a long gap between events (common on multi-tool
  // agentic turns where a single tool runs for 10s+). If the terminal
  // `harness.idle` is emitted during that gap, the browser's Last-Event-ID
  // resume can miss it, stranding the UI on "Copilot is thinking…" forever.
  // The watchdog periodically reconciles against server truth: when an active
  // (non-terminal) stream has received no events for `STALL_MS`, it re-fetches
  // events after `maxSeenSequence` via REST replay and processes any it missed
  // (including the idle), which drives the stream to `complete` naturally.
  /** Wall-clock ms of the last processed event (live or gap-filled). */
  lastEventAt: number;
  /** Periodic stall check. */
  watchdogTimer: ReturnType<typeof setInterval> | null;
  /** Re-entrancy guard so overlapping ticks don't double-fetch. */
  gapFilling: boolean;
  /**
   * Highest sequence below which NOTHING is missing.
   *
   * Distinct from `maxSeenSequence`: a single dropped frame leaves a hole
   * below the tip, and replaying from the tip can never fetch it back. Gap
   * fill therefore resumes from this frontier, not from the high-water mark.
   */
  contiguousSequence: number;
  /** Consecutive stall ticks that found nothing new, for the terminal reconcile. */
  emptyGapFills: number;
}

// ── Module singleton state ──

const connections = globalSingleton(
  'web.sseManager.connections',
  () => new Map<string, ConnectionState>(),
);

/**
 * How far below the tip `seenSequenceIds` is retained.
 *
 * Two things depend on it and must agree: pruning the dedup set, and how far
 * back a gap fill may resume. A hole older than this window cannot be
 * recovered without re-processing events we can no longer recognise as
 * duplicates — see `gapFill`, which reports what it had to skip.
 */
const DEDUP_WINDOW = 2000;

// ── P1-51: Per-tick invalidation de-duplication ─────────────────────────────
// A 20-stage run can fire ~160 full refetches per second: each stage event
// calls invalidateQueries for its own chat-history key, the run key, and the
// runs list — all synchronously inside processEvent. Many events share the
// same keys so the work is wasted.
//
// Fix: buffer keys into a Set and flush once per FRAME (16 ms), matching
// mobile's `useChatStream` coalescing window.
//
// A microtask was not enough. SSE frames arrive one macrotask apart, so a
// microtask flush collapses only the keys produced by a single frame — with
// twenty stages streaming that is still ~60 invalidation batches a second,
// each a full refetch. `scheduleFrame` (W26) is the shared frame boundary: a
// burst becomes one refetch, and it still lands on the frame the user sees.
// Deliberately the SAME primitive the token drain uses, so the two cannot
// drift into different notions of "a tick".
const _pendingInvalidations = new Set<string>();
let _invalidationFrame: FrameHandle | null = null;

function flushInvalidations(): void {
  // F7 fix: snapshot the set before clearing so that any synchronous
  // `invalidateQueries` subscriber that calls `scheduleInvalidation` during
  // iteration queues a NEW tick rather than having its key silently eaten
  // by `.clear()` on the live set. Clearing the timer handle after `.clear()`
  // also ensures the re-entry path schedules a proper tick.
  const keys = [..._pendingInvalidations];
  _pendingInvalidations.clear();
  _invalidationFrame = null;
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
  }
}

/**
 * Schedule a query invalidation, de-duplicated within a 16 ms tick.
 * Multiple calls with identical `queryKey` arrays — and calls from separate
 * SSE frames landing inside the same frame — collapse to a single
 * `invalidateQueries` call.
 */
export function scheduleInvalidation(queryKey: readonly unknown[]): void {
  _pendingInvalidations.add(JSON.stringify(queryKey));
  if (_invalidationFrame === null) {
    _invalidationFrame = scheduleFrame(flushInvalidations);
  }
}

/** Flush any buffered invalidations immediately (unit tests only). */
export function _flushInvalidationsNow(): void {
  if (import.meta.env.PROD) return;
  if (_invalidationFrame !== null) {
    cancelFrame(_invalidationFrame);
    _invalidationFrame = null;
  }
  flushInvalidations();
}

/**
 * Where a gap fill may resume from — and what it has to give up to get there.
 *
 * Resuming from the contiguous frontier is what makes a dropped frame
 * recoverable. But `seenSequenceIds` only retains `DEDUP_WINDOW` entries below
 * the tip, so a hole older than that cannot be refetched without re-processing
 * events we can no longer recognise as duplicates (duplicated tool calls,
 * duplicated text). The clamp past it is therefore permanent data loss for
 * this tab.
 *
 * N4: it used to happen in complete silence — the comment acknowledged it and
 * nothing surfaced it. This function is where that stops: it counts the lost
 * sequences and records them against the connection, which is what puts a
 * "some events could not be recovered" badge in front of the user instead of
 * leaving a transcript quietly missing a tool result. Exported so the branch
 * has a test rather than a comment.
 */
export function resolveGapResume(
  contiguousSequence: number,
  maxSeenSequence: number,
  sessionId: string,
): number {
  const windowFloor = maxSeenSequence - DEDUP_WINDOW;
  if (windowFloor <= contiguousSequence) return contiguousSequence;
  const skipped = windowFloor - contiguousSequence;
  countFallback('streamGapSkippedEvents', skipped);
  useConnectionStore.getState().recordGap(sessionId, skipped);
  return windowFloor;
}

// ── Event processing ──
//
// W26 — this used to be a ~1000-line `switch` over every event kind, a second
// copy of the one in `packages/client-core/src/stream/eventRouter.ts` that
// mobile already used and a third of the one in the CLI's TUI store. Three
// copies meant every fix landed in one of them: web had the parallel-stage
// stream keys and the workflow timeline, mobile had the `message_complete`
// fallback and the replay-safe turn guard, and neither had the other's.
//
// The switch is gone. `conn.router` decides WHAT should happen; the two
// functions below decide HOW on this surface — folding transcript ops into
// the Zustand store, mapping `invalidate` resources onto web's query keys,
// driving the workflow-run store and the widget bridge, and owning the two
// timers (settle-and-clear, delayed history refetch) that need a clock.
//
// The load-bearing part CLAUDE.md flags — the thinking ↔ token cross-buffer
// flush that preserves temporal order — moved WITH the routing and is tested
// in `packages/client-core/src/__tests__/eventRouter.test.ts`, which is
// strictly better than the comment that used to guard it here.

/** Kinds that carry no state and must not count as proof of life. */
const IGNORED_FOR_LIVENESS = new Set<string>(['harness.session_info', 'harness.unknown']);

/**
 * How long a settled chat transcript stays on screen before it is swapped for
 * the persisted messages.
 *
 * Long enough that the refetch has landed, short enough that the user does not
 * see the two representations disagree.
 */
const TRANSCRIPT_CLEANUP_MS = 5_000;

/**
 * How long to wait for `hello` before hydrating anyway.
 *
 * Hydrating after `hello` is what closes the snapshot/stream gap, but making
 * it a precondition would mean a connection that never opens leaves the view
 * permanently blank. One second is far longer than a healthy handshake and
 * short enough that the user reads it as loading rather than as broken.
 */
const HYDRATE_FALLBACK_MS = 1_000;

/**
 * A second history refetch, a second after `harness.message_complete`.
 *
 * The event fires when the model finished, which is not when the row is
 * readable: the write is still settling, so a refetch issued on the event
 * itself frequently returns the transcript WITHOUT the message that just
 * completed. Kept deliberately — it is the difference between a turn that
 * lands and one that appears only on the next navigation.
 */
const MESSAGE_SETTLE_REFETCH_MS = 1_000;

/**
 * Record a sequence as delivered and push the contiguous frontier forward.
 *
 * The frontier is what gap fill resumes from, so a dropped frame stops it
 * advancing and the missing event stays reachable.
 */
function noteSeen(conn: ConnectionState, seq: number): void {
  conn.seenSequenceIds.add(seq);
  if (seq > conn.maxSeenSequence) conn.maxSeenSequence = seq;
  while (conn.seenSequenceIds.has(conn.contiguousSequence + 1)) {
    conn.contiguousSequence += 1;
  }
}

function connKey(scope: StreamScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

// ── Helpers ──

/**
 * Invalidate chat messages queries for any v2 Chat that owns this session.
 * Resolves chatId from the chatStore's sessionId → chatId reverse lookup.
 */
function invalidateChatMessagesBySession(sessionId: string): void {
  const { chatSessionMap } = useChatStore.getState();
  for (const [chatId, sid] of Object.entries(chatSessionMap)) {
    if (sid === sessionId) {
      // P1-51: batched — de-duplicated within the current frame.
      scheduleInvalidation(queryKeys.chatMessages(chatId));
    }
  }
}

/**
 * Map one `invalidate` effect onto web's query keys.
 *
 * The router names a RESOURCE because it has no query library and the
 * surfaces do not agree on key shapes. This is web's half of that contract;
 * mobile's is in `useChatStream`.
 *
 * Everything goes through `scheduleInvalidation`, which de-duplicates within
 * a frame — a twenty-stage run fires the same three keys dozens of times a
 * second, and each one is a full refetch.
 */
function invalidateResource(
  sessionId: string,
  effect: Extract<StreamEffect, { op: 'invalidate' }>,
): void {
  switch (effect.resource) {
    case 'messages':
      if (effect.id) {
        // Carried a chat id of its own (`chat.prompt_sent`), so no reverse
        // lookup is needed.
        scheduleInvalidation(queryKeys.chatMessages(effect.id));
        break;
      }
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      invalidateChatMessagesBySession(sessionId);
      break;
    case 'chat':
      if (effect.id) scheduleInvalidation(queryKeys.chat(effect.id));
      break;
    case 'chats':
      scheduleInvalidation(queryKeys.chats);
      break;
    case 'session':
      scheduleInvalidation(queryKeys.session(sessionId));
      break;
    case 'sessions':
      scheduleInvalidation(queryKeys.sessions);
      break;
    case 'run':
      if (effect.id) scheduleInvalidation(workflowKeys.run(effect.id));
      break;
    case 'runs':
      scheduleInvalidation(workflowKeys.runs);
      break;
    case 'plans':
      if (!effect.id) break;
      scheduleInvalidation(['chat', effect.id, 'plans']);
      // The inline card carries its own summary from the event, but the Plan
      // tab renders the REST document — without this a revision published
      // mid-turn leaves the tab showing the previous markdown, which is the
      // text the user would then approve.
      if (effect.subId) scheduleInvalidation(['chat', effect.id, 'plan', effect.subId]);
      break;
    case 'interactions':
      // Polled, and what ChatPage reconciles card state against; refreshing it
      // here keeps the two views from disagreeing for a whole poll period.
      if (effect.id) scheduleInvalidation(['chat', effect.id, 'interactions']);
      break;
    case 'workspace': {
      if (!effect.id) break;
      const id = effect.id;
      // The summary alone only drives the tree and the +/- counts. Without the
      // per-file bodies the file list updates while the rendered diff keeps
      // showing the previous revision's content; without the tree queries a
      // newly created file never appears at all; without the review threads a
      // thread sits on "Sent to agent" long after the agent addressed it.
      for (const prefix of [
        // `workspace.prep` moves the mounts themselves — aliases, branches,
        // per-mount status — which every surface below renders from.
        'workspace-info',
        'workspace-change-summary',
        'workspace-change-file',
        'workspace-change-patch',
        'workspace-files',
        'workspace-file-index',
        'workspace-tree',
        'workspace-tree-file',
        'workspace-checkpoints',
        'review-threads',
        'workspace-changes',
      ]) {
        scheduleInvalidation([prefix, id]);
      }
      break;
    }
    case 'tasks':
      if (effect.id) scheduleInvalidation(backgroundTasksKeys.list(effect.id));
      break;
    case 'artifacts':
      scheduleInvalidation(queryKeys.artifacts(sessionId));
      break;
    case 'agents':
      scheduleInvalidation(['agents']);
      break;
    default:
      break;
  }
}

/** Apply the effects only this surface knows how to perform. */
function applyHostEffect(
  sessionId: string,
  conn: ConnectionState,
  effect: StreamEffect,
): void {
  switch (effect.op) {
    case 'invalidate':
      invalidateResource(sessionId, effect);
      return;

    case 'scheduleTranscriptCleanup': {
      const key = effect.key;
      const existing = conn.cleanupTimers.get(key);
      if (existing) clearTimeout(existing);
      conn.cleanupTimers.set(
        key,
        setTimeout(() => {
          conn.cleanupTimers.delete(key);
          const store = useStreamStore.getState();
          if (store.streams[key]?.status !== 'complete') return;
          // `clearStream` intentionally preserves widget blocks (see
          // streamStore.ts) — extension-rendered iframes live only in the
          // event stream and must survive the swap to persisted history.
          store.clearStream(key);
          const remaining = useStreamStore.getState().streams[key]?.blocks.length ?? 0;
          // `clearStream` drops the status to `idle`; restore `complete` so a
          // surviving widget surface keeps rendering.
          if (remaining > 0) store.completeStream(key);
        }, TRANSCRIPT_CLEANUP_MS),
      );
      return;
    }

    case 'cancelTranscriptCleanup': {
      const timer = conn.cleanupTimers.get(effect.key);
      if (timer) {
        clearTimeout(timer);
        conn.cleanupTimers.delete(effect.key);
      }
      return;
    }

    case 'runStatus': {
      const store = useWorkflowRunStore.getState();
      // An event for a DIFFERENT run must not rewrite the one on screen. An
      // absent runId means "the run this connection is watching", which is
      // the only run the store holds.
      if (!store.run) return;
      if (effect.runId !== undefined && effect.runId !== store.run.id) return;
      store.updateRunStatus(effect.status as WorkflowRunStatus, effect.data);
      return;
    }

    case 'stageStatus': {
      const store = useWorkflowRunStore.getState();
      if (!store.run) return;
      store.updateStageRunStatus(effect.stageRunId, effect.status as StageRunStatus, effect.data);
      return;
    }

    case 'registerStageSession':
      useWorkflowRunStore.getState().registerStageSession(effect.stageRunId, effect.sessionId);
      return;

    case 'selectStageRun':
      useWorkflowRunStore.getState().selectStageRun(effect.stageRunId);
      return;

    case 'stageSettled': {
      const streamKey = `stageRun:${effect.stageRunId}`;
      const store = useStreamStore.getState();
      const state = store.streams[streamKey];
      if (state && state.status !== 'complete' && state.status !== 'error') {
        store.completeStream(streamKey);
      }
      // Safety net: `harness.idle` also invalidates, but it may arrive before
      // the terminal stage event, and the run page swaps stream blocks for
      // full history off this query.
      const stageSession = useWorkflowRunStore.getState().stageSessionMap[effect.stageRunId];
      if (stageSession) scheduleInvalidation(queryKeys.chatHistory(stageSession));
      return;
    }

    case 'chatRewound': {
      // The conversation lost its tail. Any live stream state for this chat
      // belongs to a turn at or after the anchor — a rewind is refused while
      // one is in flight, so what is left is the last completed turn, which
      // the rewind dropped too. Leaving it would replay a response the server
      // no longer has under a prompt that is no longer there.
      if (effect.scope !== 'code') {
        const key = useChatStore.getState().getSessionId(effect.chatId) ?? sessionId;
        const timer = conn.cleanupTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          conn.cleanupTimers.delete(key);
        }
        const store = useStreamStore.getState();
        if (store.streams[key]) store.clearStream(key);
        // The prompt is offered back to the composer (never resent) — the
        // page picks it up and hands it to the input box.
        useRewindStore.getState().offerPrompt(effect.chatId, effect.prompt);
      }
      return;
    }

    case 'widgetInvoke':
      // Forward to the iframe over the postMessage bridge; the widget replies
      // with a result the bridge POSTs back to resolve the server-side promise.
      widgetBridge.invoke(effect.instanceId, effect.invokeId, effect.action, effect.args);
      return;

    case 'widgetTeardown':
      // Ask the live widget to commit its final state so the server-side
      // `close()` resolves with something current rather than a stale copy.
      widgetBridge.teardown(effect.instanceId, effect.teardownId);
      return;

    default:
      return;
  }
}

/** Fold one batch of router effects into this surface. */
function applyEffects(
  sessionId: string,
  conn: ConnectionState,
  effects: readonly StreamEffect[],
): void {
  if (effects.length === 0) return;
  const { store, host } = partitionEffects(effects);
  // One Zustand notification for the whole batch, not one per effect.
  if (store.length > 0) useStreamStore.getState().applyEffects(store);
  for (const effect of host) applyHostEffect(sessionId, conn, effect);
}

/**
 * Drain the router's text buffers at the next frame boundary.
 *
 * W26 — the drain used to be a 100 ms `setInterval` per connection, which is
 * both slower than a frame and unsynchronised with paint, so a burst could
 * land halfway through one. A frame-aligned drain collapses everything that
 * arrived since the last paint into a single store write and lands it on the
 * frame the user actually sees.
 *
 * Idempotent: an already-scheduled drain is left alone rather than cancelled
 * and re-armed, so a fast token stream schedules once per frame regardless of
 * how many events arrive inside it.
 */
function scheduleDrain(sessionId: string, conn: ConnectionState): void {
  if (conn.drainHandle) return;
  conn.drainHandle = scheduleFrame(() => {
    conn.drainHandle = null;
    if (conn.refCount <= 0) return;
    applyEffects(sessionId, conn, conn.router.drain());
    // Block delivery (W30-d) can hold text back past a drain, so the next
    // frame has to be scheduled or the hold would only be released by the
    // next incoming event.
    if (conn.router.hasPending) scheduleDrain(sessionId, conn);
  });
}

/**
 * Process a streaming/state event for a specific session.
 *
 * Routing lives in `conn.router`; this is the surface's half.
 */
function processEvent(sessionId: string, conn: ConnectionState, event: PersistedEvent): void {
  if (!event?.kind || !event?.sessionId) return;

  // Touch the stall-watchdog clock only for events that can actually advance a
  // stream. `harness.session_info` / `harness.unknown` are raw SDK passthrough
  // and made up 98% of one orchestrator turn's traffic — letting them refresh
  // the clock kept the stall detector permanently asleep.
  if (!IGNORED_FOR_LIVENESS.has(event.kind)) {
    conn.lastEventAt = Date.now();
  }

  useConnectionStore.getState().recordEvent(sessionId);

  applyEffects(
    sessionId,
    conn,
    conn.router.handle(sessionId, {
      kind: event.kind,
      data: (event.data ?? {}) as Record<string, unknown>,
    }),
  );
  if (conn.router.hasPending) scheduleDrain(sessionId, conn);

  // See `MESSAGE_SETTLE_REFETCH_MS`. Host-side because it needs a clock, and
  // kind-specific because only this event races the write it describes.
  if (
    event.kind === 'harness.message_complete' &&
    !(event.data as Record<string, unknown> | undefined)?.['__isInternalTurn']
  ) {
    setTimeout(() => {
      if (conn.refCount <= 0) return;
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      invalidateChatMessagesBySession(sessionId);
    }, MESSAGE_SETTLE_REFETCH_MS);
  }
}

// ── Transport adapter ──
//
// The server frame format is `id: <seq>\ndata: {"kind":..., "payload":...}\n\n`
// (see apps/server/src/routes/stream.ts writeFrame comment). We reconstruct
// a PersistedEvent shape so `processEvent` and `replayEventsIntoStore` —
// both predating STR-04 — keep working without modification.

function parseFrame(
  conn: ConnectionState,
  rawSeq: string,
  rawData: string,
): PersistedEvent | null {
  if (!rawData) return null;
  let parsed: { kind?: string; payload?: unknown };
  try {
    parsed = JSON.parse(rawData) as typeof parsed;
  } catch {
    return null;
  }
  const seq = parseInt(rawSeq, 10);
  const payload = (parsed.payload ?? {}) as Record<string, unknown>;
  // PersistedEvent.kind is a typed union of ~90 AgentEvent kinds; the
  // server may emit internal kinds (`hook.*`, `copilot.client_*`, etc.)
  // not yet in the union. A string cast is correct at the transport
  // boundary — processEvent's switch statement is the source of truth
  // for handled kinds, and its default-case covers anything unknown.
  return {
    id: Number.isFinite(seq) ? seq : 0,
    sessionId: (payload['sessionId'] as string) || conn.primarySessionId,
    sequenceId: Number.isFinite(seq) ? seq : 0,
    kind: String(parsed.kind ?? '') as PersistedEvent['kind'],
    data: parsed.payload,
    timestamp: Date.now(),
  } as PersistedEvent;
}

// ── Connection lifecycle ──

/**
 * Open (or ref-count into) a subscription for the given (scope, scopeId).
 *
 * Steps:
 *   1. If an existing connection exists, bump refCount and return disconnect.
 *   2. Create ConnectionState + open EventSource against /api/stream.
 *   3. Kick off async REST replay via /api/stream/replay for initial history.
 *   4. Buffer live frames during replay; flush with dedup after replay finishes.
 *   5. Last-Event-ID is set automatically by EventSource on reconnect — the
 *      server resumes from that seq, so we don't implement our own watchdog.
 *
 * Returns a disconnect function.
 */
function openConnection(
  scope: StreamScope,
  scopeId: string,
  primarySessionId: string,
  platform: HttpPlatformClient,
): () => void {
  const key = connKey(scope, scopeId);
  const existing = connections.get(key);
  if (existing) {
    existing.refCount += 1;
    return () => closeConnection(scope, scopeId);
  }

  const conn: ConnectionState = {
    scope,
    scopeId,
    primarySessionId,
    refCount: 1,
    eventSource: null,
    replayed: false,
    hydrating: false,
    hydrateFallback: null,
    draining: false,
    replayPromise: null,
    pendingSSEEvents: [],
    lastReplayedSequence: 0,
    maxSeenSequence: 0,
    seenSequenceIds: new Set(),
    contiguousSequence: 0,
    emptyGapFills: 0,
    router: new StreamEventRouter({ blockDelivery: blockDeliveryEntry() }),
    drainHandle: null,
    cleanupTimers: new Map(),
    lastEventAt: Date.now(),
    watchdogTimer: null,
    gapFilling: false,
  };
  connections.set(key, conn);

  // Connection-state tracking is keyed by primarySessionId so ChatPage's
  // status badges (tied to session id) continue to work. For run-scope
  // we register under the runId — a different scope, different key.
  const connStore = useConnectionStore.getState();
  connStore.setConnectionState(primarySessionId, 'reconnecting');

  // ── 1. Hydrate, AFTER the stream says our subscription is live ──
  //
  // W26's snapshot/stream boundary. The replay used to start here, in
  // parallel with the connection POST, which leaves a real hole: a snapshot
  // that completes before the socket attaches misses every event in between,
  // and nothing notices — the transcript is simply short by whatever happened
  // during the gap. `onOpen` fires from `hello`/`subs`, i.e. once the server
  // has confirmed this scope is active and is buffering from our cursor, so
  // anything the snapshot misses is redelivered rather than lost.
  //
  // Two guards, both load-bearing:
  //   * `hydrating` — a reconnect fires `onOpen` again, and a second
  //     concurrent replay would double every event it fetched.
  //   * the 1 s fallback — a `hello` that never arrives (a proxy that
  //     buffers the first frames, a server mid-restart) must not mean a
  //     permanently blank transcript. Late history is recoverable; a view
  //     that never hydrates is not.
  const hydrate = (): void => {
    if (conn.hydrating || conn.refCount <= 0) return;
    conn.hydrating = true;
    if (conn.hydrateFallback) {
      clearTimeout(conn.hydrateFallback);
      conn.hydrateFallback = null;
    }
    conn.replayPromise = startHydration();
  };

  const startHydration = (): Promise<void> => (async () => {
    try {
      // Paginate through all persisted events. A single page (500) may miss
      // later stages in multi-stage workflow runs that produce thousands of
      // events across all stages.
      //
      // Rather than waiting for EVERY page before rendering anything (which
      // left stages blank for seconds on large multi-stage runs), we replay
      // incrementally: after each page arrives we re-group ALL accumulated
      // events by stage and rebuild only the stages that gained new events.
      // Early stages therefore appear as soon as the first page lands instead
      // of after the whole run history finishes downloading.
      const PAGE_SIZE = 500;
      type StreamRow = Awaited<ReturnType<typeof platform.streamReplay>>[number];
      const allRows: StreamRow[] = [];
      let afterSeq = 0;

      // Per-stage / session replayed-event counts so we only rebuild a stream
      // when its accumulated event count actually changes across pages. This
      // keeps settled (completed) stages from flickering on every page.
      const replayedStageCounts = new Map<string, number>();
      let replayedSessionCount = 0;
      const registeredStageSessions = new Set<string>();

      // A stage group is "settled" once it contains a terminal marker for its
      // last turn (harness.idle / harness.error). Only settled stages are
      // replayed during intermediate pages — an incremental replay that ends
      // mid-stream would leave the stream in a pending/streaming/thinking
      // state, which trips the re-entrancy guard in replayEventsIntoStore and
      // makes every later page skip that stage (→ permanently blank blocks).
      // This is especially common for PARALLEL stages, whose events interleave
      // with their peer and almost always straddle a 500-event page boundary
      // without the stage's own idle. Non-settled (still-running) stages are
      // deferred to the final pass, where no later page can trip the guard.
      const isSettled = (stageEvents: PersistedEvent[]): boolean => {
        for (const ev of stageEvents) {
          const d = (ev.data ?? {}) as Record<string, unknown>;
          if (d['__isInternalTurn']) continue;
          // W13 / Finding-4: harness.cancelled is a terminal event (user Stop),
          // not just harness.idle/harness.error. Without this, a cancelled stage
          // is never settled → blank stage blocks in the workflow run UI.
          if (ev.kind === 'harness.idle' || ev.kind === 'harness.error' || ev.kind === 'harness.cancelled') return true;
        }
        return false;
      };

      const replayAccumulated = (isFinal: boolean) => {
        if (allRows.length === 0) return;
        // Reshape broker rows into PersistedEvent for replayEventsIntoStore.
        // See parseFrame() re: kind cast — PersistedEvent.kind is a typed
        // union, but the transport carries whatever the server emits.
        const events: PersistedEvent[] = allRows.map((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          return {
            id: row.id,
            sessionId: (payload['sessionId'] as string) || primarySessionId,
            sequenceId: row.seq,
            kind: row.kind as PersistedEvent['kind'],
            data: row.payload,
            timestamp: row.ts,
          };
        });

        // Group events by stageRunId so that each stage's events are replayed
        // independently into their own stream key (stageRun:<id>). Without
        // grouping, replayEventsIntoStore picks only the FIRST stageRunId and
        // all subsequent stages get zero blocks → "No messages".
        if (scope === 'run') {
          const stageGroups = new Map<string, PersistedEvent[]>();
          const sessionEvents: PersistedEvent[] = [];
          for (const ev of events) {
            const d = (ev.data ?? {}) as Record<string, unknown>;
            const srid = d['stageRunId'] as string | undefined;
            if (srid) {
              let group = stageGroups.get(srid);
              if (!group) { group = []; stageGroups.set(srid, group); }
              group.push(ev);
            } else {
              sessionEvents.push(ev);
            }
          }

          // Register stage → session ID mappings from lifecycle events.
          // This is critical for history fetching after page refresh:
          // WorkflowMessages needs the session ID to query chat history
          // for completed stages. Without this, the stageSessionMap is empty
          // after a browser refresh because processEvent (which normally
          // registers these) only runs for live SSE, not replay.
          const runStore = useWorkflowRunStore.getState();
          for (const ev of events) {
            if (ev.kind === 'stage_run.running') {
              const d = (ev.data ?? {}) as Record<string, unknown>;
              const stageRunId = d['stageRunId'] as string | undefined;
              const stageSessionId = d['sessionId'] as string | undefined;
              if (stageRunId && stageSessionId && !registeredStageSessions.has(stageRunId)) {
                runStore.registerStageSession(stageRunId, stageSessionId);
                registeredStageSessions.add(stageRunId);
              }
            }
          }

          // Rebuild each stage when its accumulated event count grew, but only
          // once it's settled (has its terminal marker) — unless this is the
          // final pass, where still-active stages are also replayed so their
          // partial blocks show and live SSE can continue from there.
          for (const [srid, stageEvents] of stageGroups) {
            if (replayedStageCounts.get(srid) === stageEvents.length) continue;
            if (!isFinal && !isSettled(stageEvents)) continue;
            replayedStageCounts.set(srid, stageEvents.length);
            replayEventsIntoStore(primarySessionId, stageEvents);
          }
          // Replay session-level events (workflow status, etc.) when changed.
          if (sessionEvents.length > 0 && sessionEvents.length !== replayedSessionCount) {
            replayedSessionCount = sessionEvents.length;
            replayEventsIntoStore(primarySessionId, sessionEvents);
          }
        } else if (isFinal) {
          // Non-run scope (chat / session / global) is ONE stream, so a
          // per-page incremental replay is both pointless and harmful: the
          // first page of a long turn (>PAGE_SIZE events) leaves the stream in
          // a `thinking`/`streaming` status, which then trips the re-entrancy
          // guard in replayEventsIntoStore so EVERY later page is skipped —
          // stranding the answer / widget / idle events (which live past the
          // first page) and freezing the UI on "Generating". Replaying once,
          // on the final pass with the full accumulated event list, rebuilds
          // the whole turn correctly (matches pre-incremental behaviour).
          replayEventsIntoStore(primarySessionId, events);
        }

        const maxSeq = events.reduce((m, e) => Math.max(m, e.sequenceId), 0);
        conn.lastReplayedSequence = maxSeq;
        conn.maxSeenSequence = maxSeq;
        conn.contiguousSequence = maxSeq;
      };

      while (true) {
        let page: StreamRow[];
        try {
          page = await platform.streamReplay(
            scope as 'chat' | 'run' | 'session' | 'global',
            scopeId,
            afterSeq,
            PAGE_SIZE,
          );
        } catch (err) {
          // A page fetch failed (e.g. transient 429/network). Stop paginating
          // but DON'T abandon replay — fall through to the final authoritative
          // pass below so every already-fetched stage (including deferred
          // parallel stages) still renders from the events we have.
          if (import.meta.env?.DEV) console.debug('[sseManager] Replay page failed for', key, err);
          break;
        }
        if (conn.refCount <= 0) return;
        if (page.length === 0) break;
        for (const row of page) allRows.push(row);
        // Render settled stages so far before fetching the next page.
        replayAccumulated(false);
        if (page.length < PAGE_SIZE) break;
        afterSeq = page[page.length - 1]!.seq;
      }
      // Final authoritative pass — replays any still-unsettled (active) stage
      // groups that were deferred above. Runs even after a partial pagination
      // failure so parallel/active stages aren't left blank.
      replayAccumulated(true);

      // Replayed rows rebuild the transcript, but `replayEventsIntoStore` is
      // the store half only — the router's invalidation half never runs for
      // them, because `processEvent` is reached exclusively by LIVE frames.
      // Anything that changed an entity *before* this subscription existed
      // therefore left its react-query cache stale until a manual reload.
      //
      // That window is not a narrow race. Creating a chat emits
      // `workspace.prep` ('preparing' then 'ready') within ~300 ms, as
      // chat-scope seq 2 and 3 — always before the client can be connected,
      // since it must first receive the POST response, navigate, GET the chat
      // to learn its sessionId, and only then open the stream. So the
      // composer's "Preparing workspace…" gate, which reads
      // `chat.workspacePrep`, stayed up permanently on every chat created
      // with sources, on every platform, until the user reloaded by hand.
      //
      // Replay the accumulated rows through a THROWAWAY router and apply only
      // the `invalidate` effects: a fresh instance so none of the live
      // router's buffering or stage state is disturbed, and invalidate-only
      // so replaying history cannot re-fire toasts or other user-visible
      // notes. `scheduleInvalidation` de-duplicates within a frame, so a long
      // replay costs one refetch per key rather than one per row.
      if (allRows.length > 0) {
        const catchUpRouter = new StreamEventRouter();
        for (const row of allRows) {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const rowSession = (payload['sessionId'] as string) || primarySessionId;
          for (const effect of catchUpRouter.handle(rowSession, {
            kind: row.kind,
            data: payload,
          })) {
            if (effect.op === 'invalidate') invalidateResource(rowSession, effect);
          }
        }
      }
    } catch {
      if (import.meta.env?.DEV) {
        console.debug('[sseManager] Replay failed for', key);
      }
      // Fallback: if replay fails, set high water from buffered SSE events
      // so we don't re-process events already delivered via live stream.
      if (conn.pendingSSEEvents.length > 0) {
        const maxBuffered = conn.pendingSSEEvents.reduce(
          (m, e) => Math.max(m, e.sequenceId ?? 0), 0,
        );
        if (maxBuffered > 0) conn.maxSeenSequence = maxBuffered;
      }
    }

    if (conn.refCount <= 0) return;

    // Atomic swap: flush any live frames that arrived during replay, with dedup.
    // Mark draining so closeConnection won't clear pendingSSEEvents mid-flush.
    conn.draining = true;
    conn.replayed = true;
    const pending = conn.pendingSSEEvents;
    conn.pendingSSEEvents = [];
    for (const ev of pending) {
      if (ev.sequenceId != null && ev.sequenceId > 0) {
        if (ev.sequenceId <= conn.lastReplayedSequence || conn.seenSequenceIds.has(ev.sequenceId)) continue;
        noteSeen(conn, ev.sequenceId);
      }
      processEvent(ev.sessionId, conn, ev);
    }
    conn.draining = false;
    useConnectionStore.getState().setConnectionState(primarySessionId, 'connected');
    // Replay contains the asset port from the original render event. Desktop
    // chooses a new isolated port on every launch; current REST metadata must
    // win after replay, or persisted widgets keep loading a dead origin.
    // This optional refresh must not block live tokens or context telemetry.
    if (scope === 'chat' && conn.refCount > 0) {
      void hydrateWidgetsForChat(scopeId, primarySessionId);
    }
  })();

  conn.hydrateFallback = setTimeout(hydrate, HYDRATE_FALLBACK_MS);

  // ── 2. Join the shared multiplexed stream (W09-a) ──
  // One `EventSource` per tab, not one per scope. Reconnection, the cursor
  // map and cross-scope dedup all live in `muxStream`; from here it behaves
  // exactly like the single-scope source it replaced.
  const handle = openMultiplexedStream(
    scope,
    scopeId,
    {
      onOpen: () => {
        useConnectionStore.getState().setConnectionState(primarySessionId, 'connected');
        // `hello`/`subs` confirmed this scope is active server-side. Safe to
        // take the snapshot now — see `hydrate`.
        hydrate();
      },
      onMessage: (msg) => {
        const event = parseFrame(conn, msg.lastEventId, msg.data);
        if (!event) return;

        // During initial replay, buffer; flushed atomically above.
        if (!conn.replayed) {
          conn.pendingSSEEvents.push(event);
          return;
        }

        // Dedup by seq (handles out-of-order delivery + replay overlap).
        if (event.sequenceId > 0) {
          if (event.sequenceId <= conn.lastReplayedSequence || conn.seenSequenceIds.has(event.sequenceId)) {
            return;
          }
          conn.seenSequenceIds.add(event.sequenceId);
          if (event.sequenceId > conn.maxSeenSequence) conn.maxSeenSequence = event.sequenceId;
          while (conn.seenSequenceIds.has(conn.contiguousSequence + 1)) {
            conn.contiguousSequence += 1;
          }
          // Bounded seen set: use a sliding window that retains the last N sequence
          // IDs based on the maximum seen, pruning entries well below the window.
          // A wider window (maxSeenSequence - 500) prevents legitimate late arrivals
          // from being dropped on high-latency networks while keeping memory bounded.
          if (conn.seenSequenceIds.size > DEDUP_WINDOW + 500) {
            const threshold = conn.maxSeenSequence - DEDUP_WINDOW;
            for (const id of conn.seenSequenceIds) {
              if (id < threshold) conn.seenSequenceIds.delete(id);
            }
          }
        }

        processEvent(event.sessionId, conn, event);
      },
      onError: (es) => {
        const state = useConnectionStore.getState();
        if (es && es.readyState === EventSource.CONNECTING) {
          state.setConnectionState(primarySessionId, 'reconnecting');
        } else {
          state.setConnectionState(primarySessionId, 'disconnected');
        }
      },
      onResync: (reason) => {
        // The server said our view has a hole: it could not honour our cursor
        // (`hello` with `resumed:false`), or it shed deltas we were too slow to
        // read (`gap`). Replay is authoritative, so refill from the contiguous
        // frontier. Before the initial replay finishes it already fetches
        // everything after that frontier, so there is nothing to add.
        if (!conn.replayed || conn.refCount <= 0) return;
        if (import.meta.env?.DEV) console.debug('[sseManager] resync for', key, reason);
        void gapFill();
      },
    },
  );
  // `closeConnection` only knows how to `.close()`, so adapt the handle to the
  // EventSource-shaped slot it already manages.
  conn.eventSource = handle as unknown as EventSource;
  // ── 3. Stall watchdog ──
  // Reconciles client state against server truth when the live stream stalls
  // (missed terminal event after a silent EventSource reconnect). Only acts
  // while a stream owned by this connection is non-terminal, so an idle chat
  // never polls.
  const STALL_MS = 20_000;      // no events for this long while active → reconcile
  const WATCHDOG_INTERVAL = 5_000;

  const connHasActiveStream = (): boolean => {
    const streams = useStreamStore.getState().streams;
    const isActive = (s: { status?: string } | undefined): boolean =>
      !!s && (s.status === 'pending' || s.status === 'streaming' || s.status === 'thinking');
    if (isActive(streams[primarySessionId])) return true;
    // Run / automation scope fan out into per-stage stream keys.
    if (scope === 'run' || scope === 'automation') {
      for (const [k, s] of Object.entries(streams)) {
        if (k.startsWith('stageRun:') && isActive(s)) return true;
      }
    }
    return false;
  };

  const gapFill = async (): Promise<void> => {
    if (conn.gapFilling || conn.refCount <= 0) return;
    conn.gapFilling = true;
    let applied = 0;
    try {
      const PAGE_SIZE = 500;
      // Resume from the contiguous frontier, not the tip: a dropped frame
      // leaves a hole BELOW `maxSeenSequence`, and replaying from the tip can
      // never fetch it back. Bounded by the dedup window — anything older has
      // been pruned from `seenSequenceIds` and would re-process.
      let afterSeq = resolveGapResume(
        conn.contiguousSequence,
        conn.maxSeenSequence,
        primarySessionId,
      );
      countFallback('streamGapFills');
      while (conn.refCount > 0) {
        let page: Awaited<ReturnType<typeof platform.streamReplay>>;
        try {
          // `streamReplay` accepts chat/run/session/global; automation-scope
          // connections reuse the same broker replay endpoint at runtime.
          page = await platform.streamReplay(
            scope as 'chat' | 'run' | 'session' | 'global',
            scopeId,
            afterSeq,
            PAGE_SIZE,
          );
        } catch {
          break; // transient — try again on the next tick
        }
        if (conn.refCount <= 0 || page.length === 0) break;
        for (const row of page) {
          const seq = row.seq;
          if (seq <= conn.lastReplayedSequence || conn.seenSequenceIds.has(seq)) continue;
          noteSeen(conn, seq);
          applied += 1;
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          processEvent((payload['sessionId'] as string) || primarySessionId, conn, {
            id: row.id,
            sessionId: (payload['sessionId'] as string) || primarySessionId,
            sequenceId: seq,
            kind: row.kind as PersistedEvent['kind'],
            data: row.payload,
            timestamp: row.ts,
          });
        }
        if (page.length < PAGE_SIZE) break;
        afterSeq = page[page.length - 1]!.seq;
      }
    } finally {
      conn.gapFilling = false;
      // Repeated empty replays justify checking server liveness, but cannot
      // themselves establish completion: tools and reasoning can be silent.
      if (applied > 0) {
        countFallback('streamGapFilledEvents', applied);
        conn.emptyGapFills = 0;
      } else if (++conn.emptyGapFills >= 3 && connHasActiveStream()) {
        conn.emptyGapFills = 0;
        // Silence is normal during a long tool call or model reasoning. Only
        // settle when the server confirms this chat no longer owns a turn.
        // An unreachable server is unknown, not evidence of completion.
        let stopped = false;
        const checkedTurnId = useStreamStore.getState().getStream(primarySessionId).turnId;
        const checkedLastEventAt = conn.lastEventAt;
        if (scope === 'chat') {
          try {
            const health = await platform.getHealth();
            stopped = Array.isArray(health.runningChatIds) && !health.runningChatIds.includes(scopeId);
          } catch { /* retry reconciliation on the next stall window */ }
        }
        // Say WHY the stream is settling: this path fires when a turn died
        // without its terminal event (server crash mid-turn, killed provider
        // process). Silently completing left the user staring at a response
        // that just... stopped, with no indication anything went wrong.
        const store = useStreamStore.getState();
        if (stopped && conn.refCount > 0 && connHasActiveStream()
          && store.getStream(primarySessionId).turnId === checkedTurnId
          && conn.lastEventAt === checkedLastEventAt) {
          store.addSystemMessage(
            primarySessionId,
            'The stream went quiet and its completion could not be recovered — the turn may have been interrupted. The transcript above is everything that was received.',
            'error',
          );
          store.errorStream(primarySessionId);
        }
      }
      // Push the clock forward so we re-poll at most once per STALL window
      // even if the turn is genuinely still running (no new events found).
      conn.lastEventAt = Date.now();
    }
  };

  conn.watchdogTimer = setInterval(() => {
    if (conn.refCount <= 0 || !conn.replayed || conn.gapFilling) return;
    if (Date.now() - conn.lastEventAt < STALL_MS) return;
    if (!connHasActiveStream()) return;
    void gapFill();
  }, WATCHDOG_INTERVAL);

  return () => closeConnection(scope, scopeId);
}

function closeConnection(scope: StreamScope, scopeId: string): void {
  const key = connKey(scope, scopeId);
  const conn = connections.get(key);
  if (!conn) return;

  conn.refCount -= 1;
  if (conn.refCount <= 0) {
    // If the replay drain is still in progress, let it finish before cleanup.
    // The drain loop is synchronous so this only guards against concurrent
    // event-loop interleaving of closeConnection during microtask yields.
    if (conn.draining) return;
    if (conn.hydrateFallback) {
      clearTimeout(conn.hydrateFallback);
      conn.hydrateFallback = null;
    }
    // Release anything the router is still holding — W30-d's block delivery
    // can be mid-hold, and a closing connection is the last chance to commit
    // it. `drainFinal`, not `drain`: a partial block still belongs to the user.
    applyEffects(conn.primarySessionId, conn, conn.router.drainFinal());
    cancelFrame(conn.drainHandle);
    conn.drainHandle = null;
    for (const timer of conn.cleanupTimers.values()) clearTimeout(timer);
    conn.cleanupTimers.clear();
    if (conn.watchdogTimer) { clearInterval(conn.watchdogTimer); conn.watchdogTimer = null; }
    conn.router.reset();
    conn.pendingSSEEvents = [];
    conn.seenSequenceIds.clear();
    conn.eventSource?.close();
    conn.eventSource = null;
    connections.delete(key);
    useConnectionStore.getState().removeConnection(conn.primarySessionId);
  }
}

// ── Public API ──

/**
 * Subscribe to all events for a chat.
 *
 * Internally opens `/api/stream?scope=chat&id=<chatId>`. Events carry
 * sessionId in payload so processEvent can invalidate the right caches.
 * Returns a disconnect function; safe to call multiple times (ref-counted).
 */
export function connectChatSession(
  chatId: string,
  sessionId: string,
  platform: HttpPlatformClient,
): () => void {
  // Register chatId → sessionId mapping so processEvent can find it for
  // invalidateChatMessagesBySession() later.
  useChatStore.getState().registerChat(chatId, sessionId);
  return openConnection('chat', chatId, sessionId, platform);
}

/** Release the chat subscription; no-op if the refCount is still above 1. */
export function disconnectChatSession(chatId: string): void {
  closeConnection('chat', chatId);
}

/**
 * Subscribe to all events for a workflow run.
 *
 * Internally opens `/api/stream?scope=run&id=<runId>`. Stage events carry
 * stageRunId + workflowRunId in payload — processEvent's per-stage stream
 * key (`stageRun:<id>`) continues to work.
 *
 * NOTE: replaces the pre-STR-04 pattern of calling `connectSession` for
 * each stage session, which opened N EventSources (one per stage) against
 * the browser's 6-per-origin cap. Now always one EventSource per run.
 */
export function connectWorkflowRun(
  runId: string,
  platform: HttpPlatformClient,
): () => void {
  // The run scope has no single "primary sessionId" — use runId as the
  // connection-status key so the UI badge tracks this EventSource.
  return openConnection('run', runId, runId, platform);
}

/** Release the workflow run subscription. */
export function disconnectWorkflowRun(runId: string): void {
  closeConnection('run', runId);
}

/** Disconnect every live subscription. Used by tests + page unmount edge cases. */
export function disconnectAll(): void {
  for (const [, conn] of connections) {
    cancelFrame(conn.drainHandle);
    conn.drainHandle = null;
    for (const timer of conn.cleanupTimers.values()) clearTimeout(timer);
    conn.cleanupTimers.clear();
    if (conn.watchdogTimer) { clearInterval(conn.watchdogTimer); conn.watchdogTimer = null; }
    conn.router.reset();
    conn.eventSource?.close();
    useConnectionStore.getState().removeConnection(conn.primarySessionId);
  }
  connections.clear();
}

// ── Test helpers ──
//
// CLN-09 — these are UNIT-TEST ONLY. Every body is guarded by a Vite-inlined
// `import.meta.env.PROD` check so esbuild/terser can DCE the entire body in
// production builds.

/** Reset internal state (for unit tests only). No-op in production. */
export function _resetForTests(): void {
  if (import.meta.env.PROD) return;
  disconnectAll();
}

/** Get current connection count (for unit tests only). Returns 0 in production. */
export function _getConnectionCount(): number {
  if (import.meta.env.PROD) return 0;
  return connections.size;
}

/** Get refCount for a (scope, scopeId) pair. Returns 0 in production. */
export function _getRefCount(scope: StreamScope, scopeId: string): number {
  if (import.meta.env.PROD) return 0;
  return connections.get(connKey(scope, scopeId))?.refCount ?? 0;
}
