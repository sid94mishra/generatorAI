// ────────────────────────────────────────────────────────────────
// Wait stages (P05 §4.3), inside the pure decide(). A wait holds no
// executor, lease or admission slot: `ready → waiting` with its question in
// `interrupt_data`, and one of
//
//   approval  the `approve` command (approved | rejected, the form data)
//   event     the oldest unconsumed delivered event with its key: the
//             `deliver_event` command or the wait's callback URL write a
//             `workflow_run_events` row (early arrivals wait in the table);
//             each wait instance consumes its own event (a CAS)
//   timer     the `wait_timer` timer
//
// completes it with `{outcome, data, by, at}`. `timeoutMs` arms
// `wait_timeout` (onTimeout complete → outcome timeout; fail →
// `wait_timeout`); an unattended run's approval or event wait without one
// expires after the pause TTL (72 h, PD-2).
// ────────────────────────────────────────────────────────────────

import { evaluate, renderTemplate, type WaitOutcome } from '@generatorai/workflow-spec';
import { classified } from '../errors/StageError.js';
import type { CompiledNode } from '../workflow-graph/compile.js';
import type { InstanceState } from './types.js';
import { failInstance, PAUSE_TTL_MS, stageEvent, type Working } from './working.js';

/** What a waiting wait asks (`interrupt_data`). */
export interface WaitInterrupt {
  kind: 'wait';
  type: 'approval' | 'event' | 'timer';
  /** approval: the rendered prompt and the form (JSON Schema). */
  prompt?: string;
  label?: string;
  form?: Record<string, unknown>;
  /** event: the evaluated key. */
  eventKey?: string;
  /** When the timer or the timeout fires (epoch ms), for the UI. */
  until?: number | null;
  onTimeout?: 'fail' | 'complete';
}

export function waitInterruptOf(i: Pick<InstanceState, 'interruptData'>): WaitInterrupt | null {
  const d = i.interruptData as WaitInterrupt | null;
  return d && typeof d === 'object' && d.kind === 'wait' ? d : null;
}

function completeWait(w: Working, inst: InstanceState, outcome: WaitOutcome, data: unknown, by: string | null, at: number): void {
  w.transition(inst, 'completed', {
    statusReason: null,
    interruptData: null,
    outputData: { outcome, data: data ?? null, by, at },
    summary: `Wait ${outcome}${by ? ` by ${by}` : ''}`,
    error: null,
    errorClass: null,
    errorCode: null,
  });
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stageEvent(w, 'stage_run.completed', inst, { outcome });
}

/** A ready wait: arm it (`ready → waiting`). */
function startWait(w: Working, inst: InstanceState, node: CompiledNode): void {
  const spec = node.wait!;
  const scope = w.guardScope(inst);
  let interrupt: WaitInterrupt;
  let failure: string | null = null;
  switch (spec.type) {
    case 'approval': {
      const r = renderTemplate(spec.prompt.text, scope);
      interrupt = {
        kind: 'wait',
        type: 'approval',
        label: spec.prompt.label,
        prompt: r.ok ? r.text : spec.prompt.text,
        ...(spec.form ? { form: spec.form } : {}),
        until: spec.timeoutMs !== undefined ? w.now + spec.timeoutMs : null,
        onTimeout: spec.onTimeout,
      };
      break;
    }
    case 'event': {
      let eventKey = '';
      if ('error' in spec.eventKey) failure = `cannot parse "${spec.eventKey.source}": ${spec.eventKey.error}`;
      else {
        const r = evaluate(spec.eventKey.ast, scope);
        if (!r.ok) failure = `"${spec.eventKey.source}": ${r.error.message}`;
        else if (typeof r.value !== 'string' && typeof r.value !== 'number') failure = `"${spec.eventKey.source}" is not a string`;
        else eventKey = String(r.value);
      }
      interrupt = { kind: 'wait', type: 'event', eventKey, until: spec.timeoutMs !== undefined ? w.now + spec.timeoutMs : null, onTimeout: spec.onTimeout };
      break;
    }
    case 'timer':
      interrupt = { kind: 'wait', type: 'timer', until: w.now + spec.durationMs };
      break;
  }
  w.transition(inst, 'waiting', { statusReason: `wait:${spec.type}`, interruptData: interrupt });
  if (failure) return failInstance(w, inst, classified('condition_error', `The wait's event key could not be evaluated: ${failure}`));
  stageEvent(w, 'stage_run.waiting', inst, { interruptData: interrupt });
  if (spec.type === 'timer') w.timer('wait_timer', inst, spec.durationMs, inst.version, { jitter: 'none' });
  else if (spec.timeoutMs !== undefined) w.timer('wait_timeout', inst, spec.timeoutMs, inst.version, { jitter: 'none' });
  else if (w.run.unattended) w.timer('pause_ttl', inst, PAUSE_TTL_MS, inst.version, { jitter: 'none' });
  if (spec.type === 'event') consumeEvent(w, inst, interrupt.eventKey!);
}

/** An event wait takes the oldest delivered, unconsumed event with its key. */
function consumeEvent(w: Working, inst: InstanceState, eventKey: string): boolean {
  const event = w.events.find((e) => e.eventKey === eventKey);
  if (!event) return false;
  w.consumeEvent(event, inst);
  completeWait(w, inst, 'event', event.data, null, event.receivedAt);
  return true;
}

/** Waits that can move without a message: ready ones arm, waiting event waits take a delivered event. */
export function settleWaits(w: Working): boolean {
  let changed = false;
  for (const inst of w.sorted()) {
    const node = w.node(inst);
    if (!node?.wait) continue;
    if (inst.status === 'ready') {
      startWait(w, inst, node);
      changed = true;
    } else if (inst.status === 'waiting' && node.wait.type === 'event') {
      const key = waitInterruptOf(inst)?.eventKey;
      if (key !== undefined && consumeEvent(w, inst, key)) changed = true;
    }
  }
  return changed;
}

/** `wait_timer` / `wait_timeout` fired for a waiting wait. */
export function onWaitTimer(w: Working, inst: InstanceState, kind: 'wait_timer' | 'wait_timeout'): void {
  const node = w.node(inst);
  if (!node?.wait || inst.status !== 'waiting') return;
  if (kind === 'wait_timer') {
    if (node.wait.type === 'timer') completeWait(w, inst, 'elapsed', null, null, w.now);
    return;
  }
  if (node.wait.type === 'timer') return;
  if (node.wait.onTimeout === 'complete') return completeWait(w, inst, 'timeout', null, null, w.now);
  failInstance(w, inst, classified('wait_timeout', `The wait timed out after ${node.wait.timeoutMs ?? 0} ms`), 'wait_timeout');
}

/**
 * The `approve` command on an approval wait: approved or rejected (a wait
 * has no change request), with the form data. Returns a refusal, or null.
 */
export function approveWait(w: Working, inst: InstanceState, outcome: 'approved' | 'rejected' | 'changes_requested', data: unknown, actor: string | undefined): string | null {
  const node = w.node(inst);
  if (!node?.wait) return `'${inst.stageKey}' is not a wait`;
  if (node.wait.type !== 'approval') return `the ${node.wait.type} wait '${inst.stageKey}' is not resolved by an approval`;
  if (inst.status !== 'waiting') return `cannot approve a ${inst.status} wait`;
  if (outcome === 'changes_requested') return 'a wait is approved or rejected; it cannot take a change request';
  completeWait(w, inst, outcome, data, actor ?? null, w.now);
  return null;
}
