// ────────────────────────────────────────────────────────────────
// streamStore — Zustand binding for the shared stream reducer.
//
// All semantics live in `@generatorai/client-core`'s stream reducer so the
// web app and the mobile app render identical transcripts. This file is
// only the Zustand adapter: it owns the `streams` record and forwards each
// action to the matching pure function.
//
// If you are about to add behaviour here, it almost certainly belongs in
// packages/client-core/src/stream/reducer.ts instead — otherwise mobile
// silently diverges.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import {
  applyStreamEffects,
  DEFAULT_STREAM,
  streamReducer as r,
  type ContextUsageSnapshot,
  type StreamEffect,
  type PermissionBlock,
  type PlanBlock,
  type QuestionBlock,
  type StreamHookInvocation,
  type StreamState,
  type StreamUsage,
  type ToolFileOp,
  type StreamsRecord,
  type SystemCategory,
  type WidgetBlock,
} from '@generatorai/client-core';

// Re-exported so existing `@/stores/streamStore.js` imports keep working.
export type {
  PermissionBlock,
  PlanBlock,
  QuestionBlock,
  StreamBlock,
  StreamHookInvocation,
  StreamState,
  StreamStatus,
  StreamToolCall,
  StreamUsage,
  SystemBlock,
  SystemCategory,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  WidgetBlock,
} from '@generatorai/client-core';
import { globalSingleton } from '../lib/globalSingleton.js';

interface StreamStore {
  streams: StreamsRecord;

  /**
   * Apply a batch of router effects in ONE update.
   *
   * W26 — this is how `sseManager` writes now. A frame's worth of events
   * produces one Zustand notification instead of one per effect, and the
   * effect → reducer mapping is `applyStreamEffect` in client-core, shared
   * with mobile, rather than a switch each surface maintains separately.
   */
  applyEffects: (effects: readonly StreamEffect[]) => void;

  /** Append a token to the session stream. */
  appendToken: (sessionId: string, token: string) => void;

  /** Append thinking/reasoning text. */
  appendThinking: (sessionId: string, text: string) => void;

  /** Complete the thinking phase. */
  completeThinking: (sessionId: string) => void;

  /** Record a tool call start. The server `callId` is used for matching when available. */
  addToolCall: (
    sessionId: string,
    tool: string,
    args: unknown,
    callId?: string,
    parentCallId?: string,
  ) => void;

  /** Complete a tool call, matching by callId first then tool name. */
  completeToolCall: (
    sessionId: string,
    toolOrCallId: string,
    result: unknown,
    fileOp?: ToolFileOp,
    success?: boolean,
  ) => void;

  /** Append a system/subagent/error note. */
  addSystemMessage: (sessionId: string, message: string, category?: SystemCategory) => void;

  /** Render (or re-render) an extension widget. */
  addWidget: (
    sessionId: string,
    widget: Omit<WidgetBlock, 'type' | 'blockId' | 'surface'> & { surface: string },
  ) => void;

  /** Apply a `harness.widget.state` update. */
  updateWidgetState: (sessionId: string, instanceId: string, state: unknown) => void;

  /** Mark a widget active/closed/error. */
  setWidgetStatus: (
    sessionId: string,
    instanceId: string,
    status: WidgetBlock['status'],
    error?: string,
  ) => void;

  /** Insert or merge a plan card (de-duped by planId). */
  upsertPlan: (sessionId: string, plan: Omit<PlanBlock, 'type' | 'blockId'>) => void;

  /** Transition a plan card's status. */
  setPlanStatus: (
    sessionId: string,
    planId: string,
    status: PlanBlock['status'],
    extra?: { interactionId?: string; revision?: number },
  ) => void;

  /** Insert or merge a question card (de-duped by interactionId). */
  upsertQuestion: (sessionId: string, question: Omit<QuestionBlock, 'type' | 'blockId'>) => void;

  /** Record the user's answer to a question card. */
  answerQuestion: (
    sessionId: string,
    interactionId: string,
    answers: Record<string, string[]>,
    freeformResponse?: string,
  ) => void;

  /** Mark a question card expired/cancelled. */
  expireQuestion: (sessionId: string, interactionId: string) => void;

  /** Insert or merge a tool-permission card (de-duped by interactionId). */
  upsertPermission: (
    sessionId: string,
    permission: Omit<PermissionBlock, 'type' | 'blockId'>,
  ) => void;

  /** Record the user's allow/deny decision on a permission card. */
  resolvePermission: (
    sessionId: string,
    interactionId: string,
    behavior: 'allow' | 'deny',
    message?: string,
  ) => void;

  /** Mark a permission card expired (the turn ended before it was answered). */
  expirePermission: (sessionId: string, interactionId: string) => void;

  /** Begin a new turn (user sent a message, awaiting the agent). */
  startPending: (sessionId: string, userMessage?: string) => void;

  /** Latch the server-generated turnId from `copilot.turn_start`. */
  setServerTurnId: (sessionId: string, turnId: string) => void;

  /** Store token usage stats. */
  setUsage: (sessionId: string, usage: StreamUsage) => void;

  /** Store the latest context-window snapshot from `harness.context_usage`. */
  setContextUsage: (sessionId: string, snapshot: ContextUsageSnapshot) => void;

  /** Mark the stream complete. */
  completeStream: (sessionId: string) => void;
  /** User pressed Stop: settle the turn and ignore late live-status events. */
  requestCancel: (sessionId: string) => void;

  /** Mark the stream errored. */
  errorStream: (sessionId: string) => void;

  /** Clear response text only (keeps thinking, tools, system blocks). */
  clearStreamText: (sessionId: string) => void;

  /** Reset the stream, preserving widgets and usage. */
  clearStream: (sessionId: string) => void;

  /** Restructure inline `<function_calls>` XML into proper blocks. */
  processInlineToolCalls: (sessionId: string, content: string) => void;

  /** Drop a stream entirely — see the reducer's `evictStream`. */
  evictStream: (sessionId: string) => void;

  /** Read a session's stream state (with defaults). */
  getStream: (sessionId: string) => StreamState;
}

/**
 * W27 — the record is bounded.
 *
 * Every session and every `stageRun:<id>` key that ever streamed keeps its
 * full block array (text, tool results, widget props) for the lifetime of the
 * tab. A long orchestrator session or a re-run workflow walks that into tens
 * of megabytes that nothing on screen references.
 *
 * 32 is well above what any surface renders at once (a chat renders one key;
 * the run page renders one per visible stage), so eviction only ever reaches
 * keys the user navigated away from — and those refill from REST replay on
 * the way back.
 */
const MAX_RETAINED_STREAMS = 32;

/**
 * Keys the UI is currently rendering, exempt from eviction.
 *
 * Module-level rather than store state: registering a key must not re-render
 * every stream subscriber, and the set is read inside the reducer bridge on
 * the hot token path.
 */
const protectedStreamKeys = globalSingleton('web.streamStore.protected', () => new Set<string>());

/**
 * Mark a stream key as on-screen for as long as the returned function is
 * uncalled. Pair it with a `useEffect` cleanup.
 */
export function protectStream(sessionId: string): () => void {
  protectedStreamKeys.add(sessionId);
  return () => {
    protectedStreamKeys.delete(sessionId);
  };
}

/** Test-only view of the protection set. */
export function _protectedStreamKeys(): string[] {
  return [...protectedStreamKeys];
}

export { MAX_RETAINED_STREAMS };

const useStreamStoreImpl = create<StreamStore>((set, get) => {
  /**
   * Bridge a pure reducer into Zustand.
   *
   * Reducers return the ORIGINAL record when nothing changed, so the
   * identity check below turns a no-op event into a genuine no-op update
   * rather than a re-render of every subscriber.
   */
  const apply =
    <A extends unknown[]>(fn: (streams: StreamsRecord, ...args: A) => StreamsRecord) =>
    (...args: A): void =>
      set((state) => {
        const streams = fn(state.streams, ...args);
        if (streams === state.streams) return state;
        // Prune on the write path, not on a timer: a timer would have to be
        // owned somewhere, and eviction only ever becomes necessary because
        // of a write. `pruneStreams` returns the same record when the cap is
        // not exceeded, so the token path pays one `Object.keys` and nothing
        // else.
        const bounded = r.pruneStreams(streams, {
          maxEntries: MAX_RETAINED_STREAMS,
          protect: protectedStreamKeys,
        });
        return { streams: bounded };
      });

  return {
    streams: {},

    applyEffects: apply((streams, effects: readonly StreamEffect[]) =>
      applyStreamEffects(streams, effects),
    ),

    appendToken: apply(r.appendToken),
    appendThinking: apply(r.appendThinking),
    completeThinking: apply(r.completeThinking),
    addToolCall: apply(r.addToolCall),
    completeToolCall: apply(r.completeToolCall),
    addSystemMessage: apply(r.addSystemMessage),
    addWidget: apply(r.addWidget),
    updateWidgetState: apply(r.updateWidgetState),
    setWidgetStatus: apply(r.setWidgetStatus),
    upsertPlan: apply(r.upsertPlan),
    setPlanStatus: apply(r.setPlanStatus),
    upsertQuestion: apply(r.upsertQuestion),
    answerQuestion: apply(r.answerQuestion),
    expireQuestion: apply(r.expireQuestion),
    upsertPermission: apply(r.upsertPermission),
    resolvePermission: apply(r.resolvePermission),
    expirePermission: apply(r.expirePermission),
    startPending: apply(r.startPending),
    setServerTurnId: apply(r.setServerTurnId),
    setUsage: apply(r.setUsage),
    setContextUsage: apply(r.setContextUsage),
    completeStream: apply(r.completeStream),
    requestCancel: apply(r.requestCancel),
    errorStream: apply(r.errorStream),
    clearStreamText: apply(r.clearStreamText),
    clearStream: apply(r.clearStream),
    processInlineToolCalls: apply(r.processInlineToolCalls),
    evictStream: apply(r.evictStream),

    getStream: (sessionId) => get().streams[sessionId] ?? DEFAULT_STREAM,
  };
});


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useStreamStore = globalSingleton('web.streamStore', () => useStreamStoreImpl);
