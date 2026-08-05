// ────────────────────────────────────────────────────────────────
// streamStore — mobile binding for the shared stream reducer.
//
// Same reducer as apps/web, so the two render identical transcripts. The
// only mobile-specific concern is the frame-coalesced flush: applying every
// token to the store as it arrives means hundreds of renders per second and
// a visible stutter on any phone.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import {
  DEFAULT_STREAM,
  streamReducer as r,
  type StreamEffect,
  type StreamState,
  type StreamsRecord,
} from '@generatorai/client-core';

interface StreamStore {
  streams: StreamsRecord;
  /** Apply a batch of router effects in one update. */
  applyEffects(effects: StreamEffect[]): void;
  getStream(key: string): StreamState;
  clear(key: string): void;
}

/**
 * Fold one effect into the record.
 *
 * Returns the SAME record when nothing changed, which is what lets the store
 * skip a no-op update rather than re-rendering every subscriber.
 */
function applyEffect(streams: StreamsRecord, effect: StreamEffect): StreamsRecord {
  switch (effect.op) {
    case 'appendToken':
      return r.appendToken(streams, effect.key, effect.text);
    case 'appendTokenIfNoText':
      return r.appendTokenIfNoText(streams, effect.key, effect.text);
    case 'appendThinking':
      return r.appendThinking(streams, effect.key, effect.text);
    case 'completeThinking':
      return r.completeThinking(streams, effect.key);
    case 'startPending':
      // `startTurn`, not `startPending`: a gap-fill after a dropped
      // connection replays the user message, and the raw reset would wipe
      // the blocks of the turn that is still streaming.
      return r.startTurn(streams, effect.key, effect.userMessage);
    case 'addToolCall':
      return r.addToolCall(streams, effect.key, effect.tool, effect.args, effect.callId);
    case 'completeToolCall':
      return r.completeToolCall(streams, effect.key, effect.toolOrCallId, effect.result);
    case 'addSystemMessage':
      return r.addSystemMessage(streams, effect.key, effect.message, effect.category);
    case 'processInlineToolCalls':
      return r.processInlineToolCalls(streams, effect.key, effect.content);
    case 'completeStream':
      return r.completeStream(streams, effect.key);
    case 'errorStream':
      return r.errorStream(streams, effect.key);
    case 'setServerTurnId':
      return r.setServerTurnId(streams, effect.key, effect.turnId);
    case 'setUsage':
      return r.setUsage(streams, effect.key, effect.usage as never);
    case 'setContextUsage':
      return r.setContextUsage(streams, effect.key, effect.snapshot as never);
    case 'upsertPlan':
      return r.upsertPlan(streams, effect.key, effect.plan);
    case 'setPlanStatus':
      return r.setPlanStatus(streams, effect.key, effect.planId, effect.status, effect.extra);
    case 'upsertQuestion':
      return r.upsertQuestion(streams, effect.key, effect.question);
    case 'answerQuestion':
      return r.answerQuestion(
        streams,
        effect.key,
        effect.interactionId,
        effect.answers,
        effect.freeformResponse,
      );
    case 'expireQuestion':
      return r.expireQuestion(streams, effect.key, effect.interactionId);
    case 'addWidget':
      return r.addWidget(streams, effect.key, effect.widget);
    case 'updateWidgetState':
      return r.updateWidgetState(streams, effect.key, effect.instanceId, effect.state);
    case 'setWidgetStatus':
      return r.setWidgetStatus(
        streams,
        effect.key,
        effect.instanceId,
        effect.status,
        effect.error,
      );
    case 'invalidate':
      // Handled by the query layer, not the stream store.
      return streams;
    default:
      return streams;
  }
}

export const useStreamStore = create<StreamStore>((set, get) => ({
  streams: {},

  applyEffects: (effects) =>
    set((state) => {
      if (effects.length === 0) return state;
      let next = state.streams;
      for (const effect of effects) next = applyEffect(next, effect);
      return next === state.streams ? state : { streams: next };
    }),

  getStream: (key) => get().streams[key] ?? DEFAULT_STREAM,

  clear: (key) =>
    set((state) => {
      const next = r.clearStream(state.streams, key);
      return next === state.streams ? state : { streams: next };
    }),
}));
