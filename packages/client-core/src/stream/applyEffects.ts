// ────────────────────────────────────────────────────────────────
// applyStreamEffect — the one place a `StreamEffect` becomes a store write.
//
// `eventRouter` decides WHAT should happen; this decides HOW it lands in the
// block model. Splitting them is what lets one routing implementation drive
// several stores: web's Zustand adapter and mobile's both call this, so a fix
// to (say) the replay-safe `startTurn` choice below cannot land on one surface
// and silently miss the other — which is exactly what happened before, when
// each surface owned its own copy of this switch.
//
// Pure: returns the ORIGINAL record when nothing changed, so a no-op event is
// a genuine no-op update rather than a re-render of every subscriber.
//
// `invalidate` is deliberately a no-op here. It names a REST resource, not a
// block-model change, and only the host knows its query layer (TanStack on
// web and mobile, nothing at all in a unit test). Hosts filter those out
// before calling this — see `partitionEffects`.
// ────────────────────────────────────────────────────────────────

import * as r from './reducer.js';
import type { StreamEffect } from './eventRouter.js';
import type { StreamsRecord } from './types.js';

/** Fold one effect into the record. */
export function applyStreamEffect(streams: StreamsRecord, effect: StreamEffect): StreamsRecord {
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
      // `startTurn`, not `startPending`: a gap-fill after a dropped connection
      // replays the user message, and the raw reset would wipe the blocks of
      // the turn that is still streaming.
      return r.startTurn(streams, effect.key, effect.userMessage);
    case 'startPendingIfEmpty':
      return r.startPendingIfEmpty(streams, effect.key);
    case 'addToolCall':
      return r.addToolCall(
        streams,
        effect.key,
        effect.tool,
        effect.args,
        effect.callId,
        effect.parentCallId,
      );
    case 'completeToolCall':
      return r.completeToolCall(
        streams,
        effect.key,
        effect.toolOrCallId,
        effect.result,
        effect.fileOp,
        effect.success,
      );
    case 'addSystemMessage':
      return r.addSystemMessage(streams, effect.key, effect.message, effect.category);
    case 'hookStarted':
      return r.addHookStarted(streams, effect.key, effect.hookName, effect.phase, {
        hookId: effect.hookId,
        hookType: effect.hookType,
        stageRunId: effect.stageRunId,
      });
    case 'hookCompleted':
      return r.completeHook(streams, effect.key, effect.status, effect.hookName, effect.phase, {
        hookId: effect.hookId,
        hookType: effect.hookType,
        stageRunId: effect.stageRunId,
        durationMs: effect.durationMs,
      });
    case 'processInlineToolCalls':
      return r.processInlineToolCalls(streams, effect.key, effect.content);
    case 'completeStream':
      return r.completeStream(streams, effect.key, effect.force ? { force: true } : {});
    case 'errorStream':
      return r.errorStream(streams, effect.key);
    case 'setServerTurnId':
      return r.setServerTurnId(streams, effect.key, effect.turnId);
    case 'setTyping':
      return r.setTyping(streams, effect.key, effect.typing);
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
    case 'upsertPermission':
      return r.upsertPermission(streams, effect.key, effect.permission);
    case 'resolvePermission':
      return r.resolvePermission(streams, effect.key, effect.interactionId, effect.behavior, effect.message);
    case 'expirePermission':
      return r.expirePermission(streams, effect.key, effect.interactionId);
    case 'addWidget':
      return r.addWidget(streams, effect.key, effect.widget);
    case 'updateWidgetState':
      return r.updateWidgetState(streams, effect.key, effect.instanceId, effect.state);
    case 'setWidgetStatus':
      return r.setWidgetStatus(streams, effect.key, effect.instanceId, effect.status, effect.error);
    // Not block-model changes. `invalidate` names a REST resource; the
    // run-store, widget-bridge and host-timer ops name things only a surface
    // has (a query cache, a run store, a postMessage bridge, a clock). Hosts
    // partition them out before calling this — listing them explicitly rather
    // than letting `default` swallow them means adding a new effect op is a
    // compile error here until someone decides which side it belongs on.
    case 'invalidate':
    case 'scheduleTranscriptCleanup':
    case 'cancelTranscriptCleanup':
    case 'runStatus':
    case 'runTimeline':
    case 'stageStatus':
    case 'stageTimeline':
    case 'registerStageSession':
    case 'stageAwaitingInput':
    case 'selectStageRun':
    case 'stageSettled':
    case 'widgetInvoke':
    case 'widgetTeardown':
      return streams;
    default:
      return streams;
  }
}

/**
 * Split a batch into the ops that mutate the block model and the ops a host
 * has to interpret.
 *
 * Every surface needs this exact split, and getting it wrong in one of them
 * is how an invalidation silently stops firing — so it lives here rather than
 * being re-derived per host.
 */
export function partitionEffects(effects: readonly StreamEffect[]): {
  store: StreamEffect[];
  host: StreamEffect[];
} {
  const store: StreamEffect[] = [];
  const host: StreamEffect[] = [];
  for (const effect of effects) {
    if (HOST_OPS.has(effect.op)) host.push(effect);
    else store.push(effect);
  }
  return { store, host };
}

const HOST_OPS: ReadonlySet<StreamEffect['op']> = new Set<StreamEffect['op']>([
  'invalidate',
  'scheduleTranscriptCleanup',
  'cancelTranscriptCleanup',
  'runStatus',
  'runTimeline',
  'stageStatus',
  'stageTimeline',
  'registerStageSession',
  'stageAwaitingInput',
  'selectStageRun',
  'stageSettled',
  'widgetInvoke',
  'widgetTeardown',
]);

/** Fold a batch. Returns the original record when the batch changed nothing. */
export function applyStreamEffects(
  streams: StreamsRecord,
  effects: readonly StreamEffect[],
): StreamsRecord {
  let next = streams;
  for (const effect of effects) next = applyStreamEffect(next, effect);
  return next;
}
