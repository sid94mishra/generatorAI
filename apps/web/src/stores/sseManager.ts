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
import { useWorkflowRunStore } from './workflowRunStore.js';
import { queryClient } from '../providers/QueryProvider.js';
import { queryKeys } from '../hooks/queries.js';
import { workflowKeys } from '../hooks/workflowQueries.js';
import { replayEventsIntoStore } from '../utils/replayEvents.js';
import { widgetBridge } from '../lib/widgetBridge.js';
import type { PersistedEvent } from '@generatorai/shared';
import type { WorkflowRunStatus, StageRunStatus } from '@generatorai/shared';
import type { SystemCategory, QuestionBlock, PlanBlock } from './streamStore.js';
import type { ContextUsageSnapshot } from '@generatorai/client-core';
import type { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import { openMultiplexedStream } from '../platform/muxStream.js';

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
  /** True while the pending-event flush loop is executing, preventing
   *  closeConnection from clearing the buffer mid-drain. */
  draining: boolean;
  replayPromise: Promise<void> | null;
  pendingSSEEvents: PersistedEvent[];
  lastReplayedSequence: number;
  maxSeenSequence: number;
  seenSequenceIds: Set<number>;

  // Buffer state used by processEvent — per-stream-key buffers to prevent
  // token interleaving when parallel stages stream simultaneously.
  // Each stream key (e.g. `stageRun:<id>`) gets its own token/thinking buffer.
  stageBuffers: Map<string, { tokenBuf: string; thinkingBuf: string }>;
  flushTimer: ReturnType<typeof setInterval> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  currentStageRunId: string | null;

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

const connections = new Map<string, ConnectionState>();
const FLUSH_INTERVAL = 100; // ms — 10 flushes/sec, matches prior behaviour

// ── P1-51: Per-tick invalidation de-duplication ─────────────────────────────
// A 20-stage run can fire ~160 full refetches per second: each stage event
// calls invalidateQueries for its own chat-history key, the run key, and the
// runs list — all synchronously inside processEvent. Many events share the
// same keys so the work is wasted.
//
// Fix: buffer keys into a Set; a queueMicrotask fires the batch once per
// event-loop turn. Same-tick duplicates collapse to one invalidation.
const _pendingInvalidations = new Set<string>();
let _invalidationQueued = false;

function flushInvalidations(): void {
  _invalidationQueued = false;
  for (const key of _pendingInvalidations) {
    queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
  }
  _pendingInvalidations.clear();
}

/**
 * Schedule a query invalidation, de-duplicated within the current
 * microtask tick. Multiple calls with identical `queryKey` arrays collapse
 * to a single `invalidateQueries` call.
 */
function scheduleInvalidation(queryKey: unknown[]): void {
  _pendingInvalidations.add(JSON.stringify(queryKey));
  if (!_invalidationQueued) {
    _invalidationQueued = true;
    queueMicrotask(flushInvalidations);
  }
}

/** Kinds that carry no state and must not count as proof of life. */
const IGNORED_FOR_LIVENESS = new Set<string>(['harness.session_info', 'harness.unknown']);

const PLAN_STATUSES = new Set([
  'drafting', 'recorded', 'awaiting_review', 'changes_requested',
  'approved', 'rejected', 'superseded', 'expired',
]);

/**
 * A plan filed by the non-blocking `record_plan` tool is born `recorded` and
 * gets no follow-up status event, so pinning `drafting` left its card spinning
 * forever.
 */
function planStatusOf(data: Record<string, unknown>): PlanBlock['status'] {
  const s = data['status'];
  return typeof s === 'string' && PLAN_STATUSES.has(s) ? (s as PlanBlock['status']) : 'drafting';
}

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

function detectCategory(message: string): SystemCategory {
  const lower = message.toLowerCase();
  if (lower.includes('subagent') || lower.includes('sub-agent') || lower.includes('sub agent')) {
    return 'subagent';
  }
  return 'system';
}

/**
 * Invalidate chat messages queries for any v2 Chat that owns this session.
 * Resolves chatId from the chatStore's sessionId → chatId reverse lookup.
 */
function invalidateChatMessagesBySession(sessionId: string): void {
  const { chatSessionMap } = useChatStore.getState();
  for (const [chatId, sid] of Object.entries(chatSessionMap)) {
    if (sid === sessionId) {
      // P1-51: batched — de-duplicated within the current microtask tick.
      scheduleInvalidation(queryKeys.chatMessages(chatId));
    }
  }
}

/**
 * PLN-01 — refresh the polled pending-interaction list for a chat.
 *
 * ChatPage reconciles plan/question card state against that list, so a gate
 * opening or closing has to refresh it immediately rather than waiting out the
 * 5s poll interval.
 */
function invalidatePendingInteractions(chatId: unknown): void {
  if (typeof chatId !== 'string' || !chatId) return;
  scheduleInvalidation(['chat', chatId, 'interactions']);
}

/**
 * PLN-01 — refetch the full plan document behind the Plan tab.
 *
 * The inline card carries its own summary from the event, but the tab renders
 * the REST document. Without this, a revision the agent publishes mid-turn
 * leaves the tab showing the previous revision's markdown — which is the text
 * the user would then approve.
 */
function invalidatePlanDocument(chatId: unknown, planId: unknown): void {
  if (typeof chatId !== 'string' || !chatId) return;
  scheduleInvalidation(['chat', chatId, 'plans']);
  if (typeof planId === 'string' && planId) {
    scheduleInvalidation(['chat', chatId, 'plan', planId]);
  }
}

function flushBuffers(sessionId: string, conn: ConnectionState): void {
  const store = useStreamStore.getState();
  for (const [sk, buf] of conn.stageBuffers) {
    if (buf.thinkingBuf) {
      store.appendThinking(sk, buf.thinkingBuf);
      buf.thinkingBuf = '';
    }
    if (buf.tokenBuf) {
      store.appendToken(sk, buf.tokenBuf);
      buf.tokenBuf = '';
    }
  }
}

function flushNow(sessionId: string, conn: ConnectionState): void {
  stopFlushTimer(conn);
  flushBuffers(sessionId, conn);
}

function ensureFlushTimer(sessionId: string, conn: ConnectionState): void {
  if (!conn.flushTimer) {
    conn.flushTimer = setInterval(() => flushBuffers(sessionId, conn), FLUSH_INTERVAL);
  }
}

function stopFlushTimer(conn: ConnectionState): void {
  if (conn.flushTimer) {
    clearInterval(conn.flushTimer);
    conn.flushTimer = null;
  }
}

// ── Event processing (verbatim from legacy impl) ──

/**
 * Process a streaming/state event for a specific session.
 * This is the core handler that updates the stream store.
 *
 * IMPORTANT: This function is preserved from the pre-STR-04 sseManager.
 * The switch-case order and the cross-buffer flush in copilot.token /
 * copilot.reasoning_delta cases are load-bearing for UI temporal ordering
 * (see CLAUDE.md known-gotchas section). Do not reshape without reading
 * that file first.
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

  const { recordEvent } = useConnectionStore.getState();
  recordEvent(sessionId);

  const kind = event.kind;
  const data = (event.data ?? {}) as Record<string, unknown>;

  // Per-event stream key routing: each event's stageRunId determines which
  // stream key it writes to. This is critical for parallel stages — without
  // per-event routing, a shared mutable `currentStageRunId` causes events
  // from stage A to land in stage B's stream when B starts first.
  const eventStageRunId = data['stageRunId'] as string | undefined;
  if (eventStageRunId) conn.currentStageRunId = eventStageRunId;
  // Use the event's own stageRunId if present; fall back to connection-level
  // tracking only for harness events that don't carry stageRunId themselves
  // (tokens, reasoning deltas, tool events emitted under the stage's session).
  const sk = eventStageRunId
    ? `stageRun:${eventStageRunId}`
    : (conn.currentStageRunId ? `stageRun:${conn.currentStageRunId}` : sessionId);

  switch (kind) {
    case 'harness.token': {
      if (data['__isInternalTurn']) break;
      const tokenText = data['text'] as string;
      if (tokenText) {
        let buf = conn.stageBuffers.get(sk);
        if (!buf) { buf = { tokenBuf: '', thinkingBuf: '' }; conn.stageBuffers.set(sk, buf); }
        if (buf.thinkingBuf) {
          useStreamStore.getState().appendThinking(sk, buf.thinkingBuf);
          buf.thinkingBuf = '';
        }
        buf.tokenBuf += tokenText;
        ensureFlushTimer(sessionId, conn);
      }
      break;
    }

    case 'harness.reasoning_delta': {
      if (data['__isInternalTurn']) break;
      const thinkText = data['text'] as string;
      if (thinkText) {
        let buf = conn.stageBuffers.get(sk);
        if (!buf) { buf = { tokenBuf: '', thinkingBuf: '' }; conn.stageBuffers.set(sk, buf); }
        if (buf.tokenBuf) {
          useStreamStore.getState().appendToken(sk, buf.tokenBuf);
          buf.tokenBuf = '';
        }
        buf.thinkingBuf += thinkText;
        ensureFlushTimer(sessionId, conn);
      }
      break;
    }

    case 'harness.reasoning_complete':
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) break;
      useStreamStore.getState().completeThinking(sk);
      break;

    case 'harness.message_complete':
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) break;
      {
        const msgContent = data['content'] as string | undefined;
        if (msgContent && (/<function_calls>/.test(msgContent) || /<tool_calls>/.test(msgContent))) {
          useStreamStore.getState().processInlineToolCalls(sk, msgContent);
        } else if (msgContent) {
          // When the SDK delivers content only via message_complete (no token
          // streaming — e.g. assistant.streaming_delta mode), inject the full
          // response into stream blocks so the UI has something to display
          // during active runs rather than showing "Waiting for model response".
          const ss = useStreamStore.getState();
          const existingStream = ss.streams[sk];
          const hasNoTextBlocks = !existingStream || existingStream.blocks.every(
            (b) => b.type !== 'text',
          );
          if (hasNoTextBlocks) {
            ss.appendToken(sk, msgContent);
          }
        }
      }
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      invalidateChatMessagesBySession(sessionId);
      setTimeout(() => {
        scheduleInvalidation(queryKeys.chatHistory(sessionId));
        invalidateChatMessagesBySession(sessionId);
      }, 1000);
      break;

    case 'harness.user_message':
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) {
        scheduleInvalidation(queryKeys.chatHistory(sessionId));
        invalidateChatMessagesBySession(sessionId);
        break;
      }
      if (conn.idleTimer) { clearTimeout(conn.idleTimer); conn.idleTimer = null; }
      {
        const skBuf = conn.stageBuffers.get(sk);
        if (skBuf) { skBuf.tokenBuf = ''; skBuf.thinkingBuf = ''; }
      }
      {
        const freshStore = useStreamStore.getState();
        const existing = freshStore.streams[sk];
        const isAlreadyInTurn = existing && (
          existing.status === 'pending' ||
          ((existing.status === 'streaming' || existing.status === 'thinking') && existing.blocks.length > 0)
        );
        const incomingContent = ((data['content'] as string) ?? '').trim();
        const currentContent = (existing?.turnUserMessage ?? '').trim();
        const isDifferentPrompt = isAlreadyInTurn && incomingContent && currentContent && incomingContent !== currentContent;
        if (!isAlreadyInTurn || isDifferentPrompt) {
          const userText = (data['content'] as string) || existing?.pendingUserMessage || null;
          freshStore.startPending(sk, userText ?? undefined);
        }
      }
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      invalidateChatMessagesBySession(sessionId);
      break;

    case 'harness.tool_start': {
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) break;
      const callId = (data['callId'] as string) ?? undefined;
      useStreamStore.getState().addToolCall(sk, data['tool'] as string, data['args'], callId);
      break;
    }

    case 'harness.tool_complete': {
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) break;
      const matchKey = (data['callId'] as string) ?? (data['tool'] as string);
      useStreamStore.getState().completeToolCall(sk, matchKey, data['result']);
      break;
    }

    case 'harness.error': {
      flushNow(sessionId, conn);
      const s = useStreamStore.getState();
      s.errorStream(sk);
      s.addSystemMessage(sk, `Error: ${data['message']}`, 'error');
      scheduleInvalidation(queryKeys.session(sessionId));
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      break;
    }

    // ── Widget events ──
    case 'harness.widget.render': {
      flushNow(sessionId, conn);
      useStreamStore.getState().addWidget(sk, {
        instanceId: String(data['instanceId'] ?? ''),
        descriptorId: String(data['descriptorId'] ?? ''),
        extensionId: String(data['extensionId'] ?? ''),
        component: String(data['component'] ?? ''),
        title: typeof data['title'] === 'string' ? data['title'] : undefined,
        surface: typeof data['surface'] === 'string' ? data['surface'] : 'widget',
        assetsBase: typeof data['assetsBase'] === 'string' ? data['assetsBase'] : '',
        entry: String(data['entry'] ?? ''),
        props: data['props'],
        state: data['state'],
        status: 'active',
      });
      break;
    }
    case 'harness.widget.state': {
      flushNow(sessionId, conn);
      useStreamStore
        .getState()
        .updateWidgetState(sk, String(data['instanceId'] ?? ''), data['state']);
      break;
    }
    case 'harness.widget.action': {
      // Actions are informational — surfaces already show them through the
      // widget UI. We just flush to preserve ordering with subsequent
      // tool_start/token events.
      flushNow(sessionId, conn);
      break;
    }
    case 'harness.widget.invoke': {
      // Agent → widget imperative action dispatch. Forward to the iframe
      // over the postMessage bridge; the widget replies with a result that
      // the bridge POSTs back to /api/widgets/:id/invoke-result to resolve
      // the server-side pending promise.
      flushNow(sessionId, conn);
      widgetBridge.invoke(
        String(data['instanceId'] ?? ''),
        String(data['invokeId'] ?? ''),
        String(data['action'] ?? ''),
        data['args'],
      );
      break;
    }
    case 'harness.widget.teardown': {
      // Host → widget teardown request. Ask the live widget to commit its
      // final state, then the bridge POSTs /teardown-ack so the server-side
      // close() resolves with fresh state.
      flushNow(sessionId, conn);
      widgetBridge.teardown(
        String(data['instanceId'] ?? ''),
        String(data['teardownId'] ?? ''),
      );
      break;
    }
    case 'harness.widget.closed': {
      flushNow(sessionId, conn);
      useStreamStore.getState().setWidgetStatus(sk, String(data['instanceId'] ?? ''), 'closed');
      break;
    }
    case 'harness.widget.error': {
      flushNow(sessionId, conn);
      useStreamStore.getState().setWidgetStatus(
        sk,
        String(data['instanceId'] ?? ''),
        'error',
        typeof data['error'] === 'string' ? data['error'] : undefined,
      );
      break;
    }

    // ── PLN-01: plan mode ──
    //
    // Cards are pushed into the stream so they interleave with the rest of the
    // turn. They are ALSO persisted into the assistant message metadata, which
    // is what rebuilds them for completed chats (event replay is skipped by the
    // fast path in replayEvents.ts).
    //
    // Every gate-lifecycle event also invalidates the pending-interaction list.
    // That list is polled on a 5s interval and is what ChatPage reconciles card
    // state against, so refreshing it here keeps the two views from disagreeing
    // for up to a full poll period.
    case 'chat.plan.created': {
      flushNow(sessionId, conn);
      useStreamStore.getState().upsertPlan(sk, {
        planId: String(data['planId'] ?? ''),
        revision: Number(data['revision'] ?? 1),
        title: String(data['title'] ?? 'Plan'),
        fileName: String(data['fileName'] ?? 'plan.md'),
        summary: String(data['summary'] ?? ''),
        status: planStatusOf(data),
        actions: [],
      });
      invalidatePlanDocument(data['chatId'], data['planId']);
      break;
    }
    case 'chat.plan.updated': {
      flushNow(sessionId, conn);
      useStreamStore.getState().setPlanStatus(sk, String(data['planId'] ?? ''), planStatusOf(data), {
        revision: Number(data['revision'] ?? 1),
      });
      invalidatePlanDocument(data['chatId'], data['planId']);
      break;
    }
    case 'chat.plan.review_requested': {
      flushNow(sessionId, conn);
      const actions = Array.isArray(data['actions']) ? (data['actions'] as string[]) : [];
      // `upsertPlan` merges onto the card created by `chat.plan.created`, so
      // omit title/fileName when absent rather than overwriting good values
      // with the raw summary or an empty string.
      useStreamStore.getState().upsertPlan(sk, {
        planId: String(data['planId'] ?? ''),
        revision: Number(data['revision'] ?? 1),
        ...(typeof data['title'] === 'string' && data['title']
          ? { title: data['title'] }
          : { title: String(data['summary'] ?? 'Plan') }),
        ...(typeof data['fileName'] === 'string' && data['fileName']
          ? { fileName: data['fileName'] }
          : {}),
        summary: String(data['summary'] ?? ''),
        status: 'awaiting_review',
        actions,
        ...(typeof data['recommendedAction'] === 'string'
          ? { recommendedAction: data['recommendedAction'] }
          : {}),
        interactionId: String(data['interactionId'] ?? ''),
      });
      invalidatePendingInteractions(data['chatId']);
      invalidatePlanDocument(data['chatId'], data['planId']);
      break;
    }
    case 'chat.plan.decided': {
      flushNow(sessionId, conn);
      const approved = data['approved'] === true;
      const action = typeof data['action'] === 'string' ? data['action'] : undefined;
      useStreamStore.getState().setPlanStatus(
        sk,
        String(data['planId'] ?? ''),
        approved ? (action === 'exit_only' ? 'rejected' : 'approved') : 'changes_requested',
      );
      invalidatePendingInteractions(data['chatId']);
      invalidatePlanDocument(data['chatId'], data['planId']);
      break;
    }
    case 'chat.plan.expired': {
      flushNow(sessionId, conn);
      useStreamStore.getState().setPlanStatus(sk, String(data['planId'] ?? ''), 'expired');
      invalidatePendingInteractions(data['chatId']);
      invalidatePlanDocument(data['chatId'], data['planId']);
      break;
    }
    case 'chat.plan.extraction_failed': {
      flushNow(sessionId, conn);
      useStreamStore
        .getState()
        .addSystemMessage(
          sk,
          `Plan mode: ${String(data['reason'] ?? 'the plan could not be captured')}`,
          'error',
        );
      break;
    }
    case 'chat.question.asked': {
      flushNow(sessionId, conn);
      const questions = Array.isArray(data['questions'])
        ? (data['questions'] as QuestionBlock['questions'])
        : [];
      useStreamStore.getState().upsertQuestion(sk, {
        interactionId: String(data['interactionId'] ?? ''),
        questions,
        status: 'pending',
      });
      invalidatePendingInteractions(data['chatId']);
      break;
    }
    case 'chat.question.answered': {
      flushNow(sessionId, conn);
      useStreamStore.getState().answerQuestion(
        sk,
        String(data['interactionId'] ?? ''),
        (data['answers'] as Record<string, string[]>) ?? {},
        typeof data['freeformResponse'] === 'string' ? data['freeformResponse'] : undefined,
      );
      invalidatePendingInteractions(data['chatId']);
      break;
    }
    case 'chat.question.expired': {
      flushNow(sessionId, conn);
      useStreamStore.getState().expireQuestion(sk, String(data['interactionId'] ?? ''));
      invalidatePendingInteractions(data['chatId']);
      break;
    }

    case 'harness.idle':
      flushNow(sessionId, conn);
      if (data['__isInternalTurn']) {
        scheduleInvalidation(queryKeys.chatHistory(sessionId));
        invalidateChatMessagesBySession(sessionId);
        break;
      }
      useStreamStore.getState().completeStream(sk);
      scheduleInvalidation(queryKeys.chatHistory(sessionId));
      invalidateChatMessagesBySession(sessionId);
      scheduleInvalidation(queryKeys.session(sessionId));
      scheduleInvalidation(queryKeys.sessions);
      if (conn.idleTimer) { clearTimeout(conn.idleTimer); conn.idleTimer = null; }
      if (!sk.startsWith('stageRun:')) {
        const capturedKey = sk;
        conn.idleTimer = setTimeout(() => {
          const s = useStreamStore.getState();
          const st = s.streams[capturedKey];
          if (st?.status === 'complete') {
            // `clearStream` intentionally preserves widget blocks (see
            // streamStore.ts) — extension-rendered iframes live only in
            // the event stream and must survive the idle cleanup.
            s.clearStream(capturedKey);
            // If widgets remain, restore 'complete' status so the UI keeps
            // rendering the widget surface (clearStream drops to 'idle').
            const stillHasWidgets = useStreamStore.getState().streams[capturedKey]?.blocks.length ?? 0;
            if (stillHasWidgets > 0) {
              s.completeStream(capturedKey);
            }
          }
          conn.idleTimer = null;
        }, 5_000);
      }
      break;

    // ── Git events ──
    case 'git.clone_start':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Cloning repository: ${data['repoUrl']}`, detectCategory(`Cloning: ${data['repoUrl']}`));
      break;
    case 'git.clone_complete':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Repository cloned to: ${data['localPath']}`);
      break;
    case 'git.commit':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Git commit: ${data['message']} (${data['sha']})`);
      break;
    case 'git.push':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Pushed to branch: ${data['branch']}`);
      break;
    case 'git.pr_created':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `PR created: ${data['url']}`);
      break;

    // ── Workspace / checkpoint events ──
    //
    // These replace the Changes panel's polling loop. Invalidation is keyed
    // by workspaceId (a prefix of every change query key), so whichever
    // base/head the panel currently shows gets refreshed.
    case 'workspace.changed': {
      const workspaceId = typeof data['workspaceId'] === 'string' ? data['workspaceId'] : null;
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: ['workspace-change-summary', workspaceId],
        });
        // The per-file bodies must go too. The summary alone only drives the
        // tree and the +/- counts; without this the file list updates while
        // the rendered diff keeps showing the previous revision's content.
        void queryClient.invalidateQueries({ queryKey: ['workspace-change-file', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-change-patch', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
        // The Files view browses paths the diff never mentions, so it has
        // its own queries — a new file appears in the tree only if these go.
        void queryClient.invalidateQueries({ queryKey: ['workspace-tree', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-tree-file', workspaceId] });
        // Legacy panel — remove once the renderer swap is everywhere.
        void queryClient.invalidateQueries({ queryKey: ['workspace-changes', workspaceId] });
      }
      break;
    }
    case 'checkpoint.created': {
      const workspaceId = typeof data['workspaceId'] === 'string' ? data['workspaceId'] : null;
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: ['workspace-checkpoints', workspaceId],
        });
        // A checkpoint is also when the server re-anchors review threads and
        // flips submitted → addressed. Without this the reviewer watches a
        // thread sit on "Sent to agent" long after the agent has finished,
        // and only a manual reload reveals it was addressed.
        void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
      }
      break;
    }
    case 'checkpoint.restored': {
      const workspaceId = typeof data['workspaceId'] === 'string' ? data['workspaceId'] : null;
      if (workspaceId) {
        // The working tree moved underneath every open view.
        void queryClient.invalidateQueries({
          queryKey: ['workspace-change-summary', workspaceId],
        });
        void queryClient.invalidateQueries({ queryKey: ['workspace-change-file', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-change-patch', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-checkpoints', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-tree', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-tree-file', workspaceId] });
        // Rewinding moves the code out from under every anchored comment.
        void queryClient.invalidateQueries({ queryKey: ['review-threads', workspaceId] });
      }
      const skipped = Array.isArray(data['skipped']) ? data['skipped'].length : 0;
      const restored = typeof data['restoredCount'] === 'number' ? data['restoredCount'] : 0;
      const deleted = typeof data['deletedCount'] === 'number' ? data['deletedCount'] : 0;
      flushNow(sessionId, conn);
      useStreamStore
        .getState()
        .addSystemMessage(
          sessionId,
          `Restored checkpoint — ${restored} file(s) restored, ${deleted} removed` +
            (skipped > 0 ? `, ${skipped} skipped` : ''),
        );
      break;
    }

    // ── Script events ──
    case 'script.stdout':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `[stdout] ${data['line']}`);
      break;
    case 'script.stderr':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `[stderr] ${data['line']}`);
      break;
    case 'script.exit':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Script exited with code: ${data['code']}`);
      break;

    // ── Hook events ──
    case 'hook.started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Hook "${data['hookName']}" started (phase: ${data['phase']})`);
      break;
    case 'hook.completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Hook "${data['hookName']}" completed`);
      break;
    case 'hook.failed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Hook "${data['hookName']}" failed: ${data['error']}`, 'error');
      break;

    // ── Artifact events ──
    case 'artifact.created':
    case 'artifact.available':
      queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(sessionId) });
      if (kind === 'artifact.created') {
        flushNow(sessionId, conn);
        useStreamStore.getState().addSystemMessage(sessionId, `Artifact created: ${data['name']}`);
      }
      break;

    // ── Copilot client lifecycle ──
    case 'harness.client_error':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Copilot client error: ${data['message'] ?? 'Unknown error'}`, 'error');
      break;
    case 'harness.client_restarting':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Copilot client restarting...');
      break;
    case 'harness.client_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Copilot client started');
      break;
    case 'harness.client_stopped':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Copilot client stopped');
      break;

    // ── Permission events ──
    case 'permission.requested':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Permission requested: ${data['permission']}`);
      break;
    case 'permission.granted':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Permission granted: ${data['permission']}`);
      break;
    case 'permission.denied':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Permission denied: ${data['permission']}`);
      break;

    // ── Orchestration & preprocessing events — provide timeline + system messages ──
    case 'workflow_run.orchestration_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Orchestration started — preparing workflow execution');
      break;
    case 'workflow_run.orchestration_completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Orchestration completed');
      break;
    case 'workflow_run.orchestration_failed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Orchestration failed: ${data['error'] ?? 'Unknown error'}`, 'error');
      break;
    case 'workflow_run.worktree_creating':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Creating worktree...');
      break;
    case 'workflow_run.worktree_created':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Worktree created: ${data['path'] ?? ''}`);
      break;
    case 'workflow_run.preprocessing_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Preprocessing started');
      break;
    case 'workflow_run.preprocessing_completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Preprocessing completed');
      break;
    case 'workflow_run.preprocessing_step_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Preprocessing: ${data['stepName'] ?? data['step'] ?? 'step'} started`);
      break;
    case 'workflow_run.preprocessing_step_completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Preprocessing: ${data['stepName'] ?? data['step'] ?? 'step'} completed`);
      break;
    case 'workflow_run.preprocessing_step_failed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Preprocessing step failed: ${data['error'] ?? 'Unknown'}`, 'error');
      break;
    case 'workflow_run.postprocessing_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Post-processing started');
      break;
    case 'workflow_run.postprocessing_completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Post-processing completed');
      break;
    case 'workflow_run.postprocessing_step_started':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Post-processing: ${data['stepName'] ?? data['step'] ?? 'step'} started`);
      break;
    case 'workflow_run.postprocessing_step_completed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Post-processing: ${data['stepName'] ?? data['step'] ?? 'step'} completed`);
      break;
    case 'workflow_run.postprocessing_step_failed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Post-processing step failed: ${data['error'] ?? 'Unknown'}`, 'error');
      break;
    case 'workflow_run.sandbox_created':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Sandbox created: ${data['sandboxId'] ?? ''}`);
      break;
    case 'workflow_run.sandbox_destroyed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, 'Sandbox destroyed');
      break;
    case 'workflow_run.stage_validation':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Stage validation: ${data['message'] ?? 'validating stages'}`);
      break;
    case 'workflow_run.cancelling': {
      const runStore = useWorkflowRunStore.getState();
      const runId = data['runId'] as string | undefined ?? data['workflowRunId'] as string | undefined;
      if (runStore.run && (runId === runStore.run.id || runId === undefined)) {
        runStore.updateRunStatus('cancelling' as WorkflowRunStatus, data);
        runStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'run',
          runId: runStore.run.id,
          status: 'cancelling' as WorkflowRunStatus,
          message: 'Workflow run cancelling...',
          data,
        });
      }
      if (runId) {
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
      }
      break;
    }
    case 'workflow_run.permission_mode_changed':
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Permission mode changed to: ${data['mode'] ?? 'unknown'}`);
      break;

    // ── Stage durability events (HITL, sleep, retry) ──
    case 'stage_run.awaiting_input': {
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        stageRunStore.updateStageRunStatus(stageRunId, 'awaiting_input' as StageRunStatus, data);
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: 'awaiting_input' as StageRunStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" awaiting input`,
          data,
        });
        // Notify the store that HITL approval is needed
        stageRunStore.setAwaitingInput(stageRunId, data);
      }
      const stageStreamKey = stageRunId ? `stageRun:${stageRunId}` : sk;
      useStreamStore.getState().addSystemMessage(stageStreamKey, `⏸ Awaiting human input — check the HITL panel to approve or reject`);
      break;
    }
    case 'stage_run.input_received': {
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        stageRunStore.updateStageRunStatus(stageRunId, 'running' as StageRunStatus, data);
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: 'running' as StageRunStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" input received — resuming`,
          data,
        });
        // Clear the HITL notification
        stageRunStore.clearAwaitingInput(stageRunId);
      }
      const stageStreamKey = stageRunId ? `stageRun:${stageRunId}` : sk;
      useStreamStore.getState().addSystemMessage(stageStreamKey, '▶ Input received — stage resuming');
      break;
    }
    case 'stage_run.sleeping': {
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        stageRunStore.updateStageRunStatus(stageRunId, 'sleeping' as StageRunStatus, data);
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: 'sleeping' as StageRunStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" sleeping${data['wakeAt'] ? ` until ${new Date(data['wakeAt'] as number).toLocaleTimeString()}` : ''}`,
          data,
        });
      }
      const stageStreamKey = stageRunId ? `stageRun:${stageRunId}` : sk;
      useStreamStore.getState().addSystemMessage(stageStreamKey, `💤 Stage sleeping${data['wakeAt'] ? ` — wake at ${new Date(data['wakeAt'] as number).toLocaleTimeString()}` : ''}`);
      break;
    }
    case 'stage_run.woken': {
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        stageRunStore.updateStageRunStatus(stageRunId, 'running' as StageRunStatus, data);
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: 'running' as StageRunStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" woken — resuming`,
          data,
        });
      }
      const stageStreamKey = stageRunId ? `stageRun:${stageRunId}` : sk;
      useStreamStore.getState().addSystemMessage(stageStreamKey, '⏰ Stage woken — resuming execution');
      break;
    }
    case 'stage_run.retrying': {
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: 'running' as StageRunStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" retrying (attempt ${data['attempt'] ?? '?'})`,
          data,
        });
      }
      const stageStreamKey = stageRunId ? `stageRun:${stageRunId}` : sk;
      useStreamStore.getState().addSystemMessage(stageStreamKey, `🔄 Retrying (attempt ${data['attempt'] ?? '?'})`);
      break;
    }

    // ── Session lifecycle events ──
    case 'session.created':
    case 'session.active':
    case 'session.closing':
    case 'session.closed':
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      break;
    case 'session.paused':
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      break;
    case 'session.error':
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      flushNow(sessionId, conn);
      useStreamStore.getState().addSystemMessage(sessionId, `Session error: ${data['message'] ?? 'Unknown error'}`, 'error');
      break;

    // ── harness.turn_end — mark turn boundary for proper state tracking ──
    case 'harness.turn_end':
      // Flush any remaining buffers at turn boundary to ensure all
      // content from this turn is rendered before the next turn starts.
      flushNow(sessionId, conn);
      break;

    case 'git.clone_progress':
    case 'harness.session_start':
    case 'harness.unknown':
    case 'hook.skipped':
    case 'subscriber.error':
      break;

    // Suppress most session_info events but handle sub-agent & abort events
    case 'harness.session_info': {
      if (data['__isInternalTurn']) break;
      const infoType = data['infoType'] as string | undefined;
      if (infoType === 'subagent_started') {
        flushNow(sessionId, conn);
        useStreamStore.getState().addSystemMessage(
          sk,
          (data['message'] as string) ?? 'Sub-agent started',
          'subagent',
        );
      } else if (infoType === 'subagent_completed') {
        flushNow(sessionId, conn);
        useStreamStore.getState().addSystemMessage(
          sk,
          (data['message'] as string) ?? 'Sub-agent completed',
          'subagent',
        );
      } else if (infoType === 'subagent_failed') {
        flushNow(sessionId, conn);
        useStreamStore.getState().addSystemMessage(
          sk,
          (data['message'] as string) ?? 'Sub-agent failed',
          'error',
        );
      } else if (infoType === 'abort') {
        flushNow(sessionId, conn);
        useStreamStore.getState().addSystemMessage(
          sk,
          (data['message'] as string) ?? 'Turn aborted',
          'error',
        );
      }
      // All other session_info types (pending_messages, etc.) are silent
      break;
    }

    // ── harness.context_usage — the provider's view of context-window fill ──
    // Drives the single ContextUsageGauge. Sub-agent snapshots carry an
    // agentId and are ignored here: a sub-agent runs its own window, and
    // letting it overwrite the main gauge made the number jump around.
    //
    // Deliberately NOT gated on `__isInternalTurn`. That flag exists to stop
    // the client resetting stream BLOCKS for framework-issued turns (context
    // injection, summarisation); those turns still consume the real context
    // window, so skipping their telemetry left every workflow stage gauge
    // empty and under-reported the window in chats.
    case 'harness.context_usage': {
      if (typeof data['agentId'] === 'string' && data['agentId']) break;
      const current = data['currentTokens'];
      if (typeof current !== 'number' || !Number.isFinite(current)) break;
      const numOrUndef = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      useStreamStore.getState().setContextUsage(sk, {
        source: data['source'] === 'provider' ? 'provider' : 'derived',
        currentTokens: current,
        promptTokenLimit: numOrUndef(data['promptTokenLimit']),
        totalContextWindow: numOrUndef(data['totalContextWindow']),
        compactionThreshold: numOrUndef(data['compactionThreshold']),
        messagesLength: numOrUndef(data['messagesLength']),
        model: typeof data['model'] === 'string' ? data['model'] : undefined,
        provider: typeof data['provider'] === 'string' ? data['provider'] : undefined,
        breakdown: (data['breakdown'] as ContextUsageSnapshot['breakdown']) ?? undefined,
        apiUsage: (data['apiUsage'] as ContextUsageSnapshot['apiUsage']) ?? undefined,
      });
      break;
    }

    // WEB-02: latch the server-generated turnId so ChatView can dedup
    // chatHistory entries by metadata.turnId instead of content.
    case 'harness.turn_start': {
      const tId = data['turnId'];
      if (typeof tId === 'string' && tId.length > 0) {
        useStreamStore.getState().setServerTurnId(sk, tId);
      }
      break;
    }

    case 'harness.usage': {
      // Same rationale as harness.context_usage: an internal (framework)
      // turn still spends real tokens, so its usage belongs in the totals.
      // Sub-agent turns report their own usage; attributing it to the main
      // conversation made the gauge and cost chip jump around mid-turn.
      if (typeof data['agentId'] === 'string' && data['agentId']) break;
      const usage = {
        model: (data['model'] as string) ?? 'unknown',
        inputTokens: (data['inputTokens'] as number) ?? 0,
        outputTokens: (data['outputTokens'] as number) ?? 0,
        durationMs: (data['durationMs'] as number) ?? undefined,
        cacheReadTokens: (data['cacheReadTokens'] as number) ?? undefined,
        cacheWriteTokens: (data['cacheWriteTokens'] as number) ?? undefined,
        cost: (data['cost'] as number) ?? undefined,
        provider: (data['provider'] as string) ?? undefined,
      };
      useStreamStore.getState().setUsage(sk, usage);
      break;
    }

    // ── v2 Chat events ──
    case 'chat.created':
    case 'chat.archived':
    case 'chat.deleted':
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
      break;

    // ── Agent catalog events ──
    // The catalog is cached for 30s, so without this a newly created agent
    // would not show up in an already-open picker.
    case 'agent.created':
    case 'agent.updated':
    case 'agent.deleted':
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      break;
    case 'chat.agent_changed': {
      const chatId = data['chatId'] as string;
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
      break;
    }
    case 'chat.prompt_sent': {
      const chatId = data['chatId'] as string;
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
      }
      break;
    }
    case 'chat.prompt_failed': {
      const chatId = data['chatId'] as string;
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
        // Reset stream state so the ChatPage "Processing..." spinner clears
        const sessionId = useChatStore.getState().getSessionId(chatId);
        if (sessionId) {
          useStreamStore.getState().errorStream(sessionId);
        }
      }
      break;
    }

    // ── v2 Workflow Run events ──
    case 'workflow_run.created':
    case 'workflow_run.starting':
    case 'workflow_run.running':
    case 'workflow_run.paused':
    case 'workflow_run.completed':
    case 'workflow_run.failed':
    case 'workflow_run.cancelled':
    case 'workflow_run.resumed': {
      // 'resumed' is not a valid WorkflowRunStatus — map it to 'running'
      // since the server sets the DB status to 'running' before emitting this event.
      const runStatus = kind === 'workflow_run.resumed'
        ? 'running' as WorkflowRunStatus
        : kind.replace('workflow_run.', '') as WorkflowRunStatus;
      const runStore = useWorkflowRunStore.getState();
      const runId = data['runId'] as string | undefined ?? data['workflowRunId'] as string | undefined;
      if (runStore.run && (runId === runStore.run.id || runId === undefined)) {
        runStore.updateRunStatus(runStatus, data);
        runStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'run',
          runId: runStore.run.id,
          status: runStatus,
          message: `Workflow run ${kind === 'workflow_run.resumed' ? 'resumed' : runStatus}${data['error'] ? `: ${data['error']}` : ''}`,
          data,
        });
      }
      if (runId) {
        queryClient.invalidateQueries({ queryKey: workflowKeys.run(runId) });
      }
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs });
      break;
    }

    case 'stage_run.pending':
    case 'stage_run.queued':
    case 'stage_run.running':
    case 'stage_run.paused':
    case 'stage_run.completed':
    case 'stage_run.failed':
    case 'stage_run.cancelled':
    case 'stage_run.skipped':
    case 'stage_run.resumed': {
      // 'resumed' is not a valid StageRunStatus — map it to 'running'
      const stageStatus = kind === 'stage_run.resumed'
        ? 'running' as StageRunStatus
        : kind.replace('stage_run.', '') as StageRunStatus;
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        stageRunStore.updateStageRunStatus(stageRunId, stageStatus, data);
        const stageSessionId = data['sessionId'] as string | undefined;
        if (stageSessionId) {
          stageRunStore.registerStageSession(stageRunId, stageSessionId);
        }
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: stageStatus,
          message: `Stage "${stageRun?.name ?? stageRunId}" ${stageStatus}${data['error'] ? `: ${data['error']}` : ''}`,
          data,
        });
        if (stageStatus === 'running') {
          stageRunStore.selectStageRun(stageRunId);
          // Only initialize the stream if it's not already populated.
          // After page refresh, replay fills stream with prior tokens;
          // calling startPending here would wipe that data.
          // Similarly, after pause→resume the existing stream blocks
          // should persist — the model continues from where it left off.
          const stageStreamKey = `stageRun:${stageRunId}`;
          const existingStageStream = useStreamStore.getState().streams[stageStreamKey];
          const alreadyHasContent = existingStageStream && (
            existingStageStream.blocks.length > 0 ||
            existingStageStream.status === 'streaming' ||
            existingStageStream.status === 'thinking'
          );
          if (!alreadyHasContent) {
            useStreamStore.getState().startPending(stageStreamKey);
          }
        }
        // When a stage reaches a terminal state, ensure its stream is marked
        // complete so the UI does not remain stuck showing "Generating..."
        // This is necessary for parallel stages where `copilot.idle` may arrive
        // while conn.currentStageRunId has been overwritten by the sibling stage,
        // causing the idle handler to complete the wrong stream key.
        if (stageStatus === 'completed' || stageStatus === 'failed' || stageStatus === 'cancelled' || stageStatus === 'skipped') {
          const stageStreamKey = `stageRun:${stageRunId}`;
          flushNow(sessionId, conn);
          const ss = useStreamStore.getState();
          const stageStreamState = ss.streams[stageStreamKey];
          if (stageStreamState && stageStreamState.status !== 'complete' && stageStreamState.status !== 'error') {
            ss.completeStream(stageStreamKey);
          }
          // Safety-net: ensure chatHistory for this stage's session is invalidated
          // so WorkflowMessages can transition from stream blocks to full history.
          // The harness.idle handler also invalidates, but it may fire before the
          // stage_run.completed event — this ensures the query stays fresh.
          const stageSession = stageRunStore.stageSessionMap[stageRunId];
          if (stageSession) {
            scheduleInvalidation(queryKeys.chatHistory(stageSession));
          }
        }
      }
      const parentRunId = data['workflowRunId'] as string | undefined;
      if (parentRunId) {
        scheduleInvalidation(workflowKeys.run(parentRunId));
      }
      scheduleInvalidation(workflowKeys.runs);
      break;
    }

    case 'stage_run.step_started':
    case 'stage_run.step_completed': {
      // Flush any buffered tokens/thinking BEFORE recording the step
      // transition to preserve temporal ordering between step boundaries.
      flushNow(sessionId, conn);
      const stageRunId = data['stageRunId'] as string | undefined;
      const stageRunStore = useWorkflowRunStore.getState();
      if (stageRunStore.run && stageRunId) {
        const stageRun = stageRunStore.run.stageRuns.find((sr) => sr.id === stageRunId);
        const stepLabel = (data['label'] as string) ?? `Step ${data['step']}`;
        const isStarted = kind === 'stage_run.step_started';
        stageRunStore.addTimelineEvent({
          timestamp: new Date(),
          type: 'stage',
          runId: stageRunStore.run.id,
          stageRunId,
          stageName: stageRun?.name ?? stageRunId,
          status: isStarted ? 'running' : 'completed',
          message: `${stageRun?.name ?? stageRunId}: ${stepLabel} ${isStarted ? 'started' : 'completed'}`,
          data,
        });
        if (isStarted && data['step'] !== undefined) {
          stageRunStore.updateStageRunStatus(stageRunId, 'running', {
            currentStep: data['step'],
            totalSteps: data['totalSteps'],
          });
        }
      }
      break;
    }

    default:
      if (import.meta.env?.DEV) {
        console.debug('[sseManager] unhandled event kind:', kind);
      }
      break;
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
    draining: false,
    replayPromise: null,
    pendingSSEEvents: [],
    lastReplayedSequence: 0,
    maxSeenSequence: 0,
    seenSequenceIds: new Set(),
    contiguousSequence: 0,
    emptyGapFills: 0,
    stageBuffers: new Map(),
    flushTimer: null,
    idleTimer: null,
    currentStageRunId: null,
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

  // ── 1. Kick off REST replay (returns a PersistedEvent[]-shaped response) ──
  conn.replayPromise = (async () => {
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
  })();

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
          if (conn.seenSequenceIds.size > 2500) {
            const threshold = conn.maxSeenSequence - 2000;
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
      let afterSeq = Math.max(conn.contiguousSequence, conn.maxSeenSequence - 2000);
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
      // Last resort. Replay is authoritative, so several stall windows that
      // surface nothing new mean the turn really is over and its terminal
      // event is unrecoverable — settle the stream rather than spin forever.
      if (applied > 0) {
        conn.emptyGapFills = 0;
      } else if (++conn.emptyGapFills >= 3 && connHasActiveStream()) {
        conn.emptyGapFills = 0;
        useStreamStore.getState().completeStream(primarySessionId);
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
    stopFlushTimer(conn);
    if (conn.idleTimer) { clearTimeout(conn.idleTimer); conn.idleTimer = null; }
    if (conn.watchdogTimer) { clearInterval(conn.watchdogTimer); conn.watchdogTimer = null; }
    conn.stageBuffers.clear();
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

/**
 * Track B — subscribe to events for a single automation execution.
 * Opens `/api/stream?scope=automation&id=<executionId>`. Events fire
 * on the standard connectionStore. Returns a disconnect function.
 */
export function connectAutomationExecution(
  executionId: string,
  platform: HttpPlatformClient,
): () => void {
  return openConnection('automation', executionId, executionId, platform);
}

/** Release an automation-execution subscription. */
export function disconnectAutomationExecution(executionId: string): void {
  closeConnection('automation', executionId);
}

/** Disconnect every live subscription. Used by tests + page unmount edge cases. */
export function disconnectAll(): void {
  for (const [, conn] of connections) {
    stopFlushTimer(conn);
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
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
