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
  DEFAULT_STREAM,
  streamReducer as r,
  type ContextUsageSnapshot,
  type PlanBlock,
  type QuestionBlock,
  type StreamState,
  type StreamUsage,
  type StreamsRecord,
  type SystemCategory,
  type WidgetBlock,
} from '@generatorai/client-core';

// Re-exported so existing `@/stores/streamStore.js` imports keep working.
export type {
  PlanBlock,
  QuestionBlock,
  StreamBlock,
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

interface StreamStore {
  streams: StreamsRecord;

  /** Append a token to the session stream. */
  appendToken: (sessionId: string, token: string) => void;

  /** Append thinking/reasoning text. */
  appendThinking: (sessionId: string, text: string) => void;

  /** Complete the thinking phase. */
  completeThinking: (sessionId: string) => void;

  /** Record a tool call start. The server `callId` is used for matching when available. */
  addToolCall: (sessionId: string, tool: string, args: unknown, callId?: string) => void;

  /** Complete a tool call, matching by callId first then tool name. */
  completeToolCall: (sessionId: string, toolOrCallId: string, result: unknown) => void;

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

  /** Read a session's stream state (with defaults). */
  getStream: (sessionId: string) => StreamState;
}

export const useStreamStore = create<StreamStore>((set, get) => {
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
        return streams === state.streams ? state : { streams };
      });

  return {
    streams: {},

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

    getStream: (sessionId) => get().streams[sessionId] ?? DEFAULT_STREAM,
  };
});
