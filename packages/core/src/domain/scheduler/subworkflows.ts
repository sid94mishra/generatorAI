// ────────────────────────────────────────────────────────────────
// Sub-workflow stages (P05 §4.2), inside the pure decide(). The stage's
// scope is a CHILD RUN:
//
//   ready          inputs := eval(subworkflow.inputs) in the stage's place;
//                  `ready → running`, effect start_child (the invocation
//                  service, trigger {kind: 'stage'}, an idempotency key per
//                  instance so a re-dispatch after a crash finds the same
//                  child)
//   child_started  the child run id is recorded
//   child_settled  the child finalized: completed → the stage completes
//                  with the child's declared `outputs`; failed → fails
//                  (subworkflow_failed); cancelled → cancelled. The child's
//                  usage rolls up into the stage and the run.
//
// Cancel propagates (the working copy's stop of a container cancels the
// child), and so do a run pause and resume (`child_command`). The child's
// decision cards (approvals, parked loops, waits) are mirrored to the
// parent by the approval service, not here.
// ────────────────────────────────────────────────────────────────

import { evaluate } from '@generatorai/workflow-spec';
import { classified, type StageErrorCode } from '../errors/StageError.js';
import type { CompiledNode } from '../workflow-graph/compile.js';
import type { InstanceState, RunOutcome, SubworkflowState, Usage } from './types.js';
import { cancelInstance, failInstance, stageEvent, type Working } from './working.js';

type SubInstance = InstanceState & { containerState: SubworkflowState };

function isSub(i: InstanceState): i is SubInstance {
  return i.containerState?.kind === 'subworkflow';
}

function startSubworkflow(w: Working, inst: InstanceState, node: CompiledNode): void {
  const sub = node.subworkflow!;
  const scope = w.guardScope(inst);
  const inputs: Record<string, unknown> = {};
  let failure: string | null = null;
  for (const [name, expr] of sub.inputs) {
    if ('error' in expr) {
      failure = `input '${name}': cannot parse "${expr.source}": ${expr.error}`;
      break;
    }
    const r = evaluate(expr.ast, scope);
    if (!r.ok) {
      failure = `input '${name}': "${expr.source}": ${r.error.message}`;
      break;
    }
    inputs[name] = r.value;
  }
  const state: SubworkflowState = { kind: 'subworkflow', phase: failure ? 'done' : 'starting', childRunId: null, inputs };
  w.transition(inst, 'running', { statusReason: null, containerState: state });
  if (failure) return failInstance(w, inst, classified('condition_error', `The sub-workflow's inputs could not be evaluated: ${failure}`));
  stageEvent(w, 'stage_run.running', inst, { kind: 'subworkflow' });
  w.push({ t: 'start_child', stageRunId: inst.id, inputs });
}

export function settleSubworkflows(w: Working): boolean {
  let changed = false;
  for (const inst of w.sorted()) {
    const node = w.node(inst);
    if (!node?.subworkflow || inst.status !== 'ready' || inst.containerState != null) continue;
    startSubworkflow(w, inst, node);
    changed = true;
  }
  return changed;
}

export function onChildStarted(w: Working, msg: { stageRunId: string; childRunId: string }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isSub(inst) || inst.status !== 'running' || inst.containerState.phase !== 'starting') return;
  w.instancePatch(inst, { containerState: { ...inst.containerState, phase: 'running', childRunId: msg.childRunId } });
  w.emit('subworkflow.child_started', { stageRunId: inst.id, stageKey: inst.stageKey, instancePath: inst.instancePath, childRunId: msg.childRunId, version: inst.version });
}

export function onChildStartFailed(w: Working, msg: { stageRunId: string; code: string; error: string }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isSub(inst) || inst.status !== 'running' || inst.containerState.phase !== 'starting') return;
  w.instancePatch(inst, { containerState: { ...inst.containerState, phase: 'done' } });
  const code: StageErrorCode = msg.code === 'subworkflow_output_drift' ? 'subworkflow_output_drift' : 'subworkflow_start_failed';
  failInstance(w, inst, classified(code, msg.error), `subworkflow:${code}`);
}

export function onChildSettled(
  w: Working,
  msg: { stageRunId: string; childRunId: string; status: RunOutcome; outputs: Record<string, unknown>; usage: Usage; error?: string },
): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isSub(inst) || inst.status !== 'running' || inst.containerState.childRunId !== msg.childRunId) return;
  if (Object.keys(msg.usage).length > 0) w.usage(inst, msg.usage);
  w.instancePatch(inst, { containerState: { ...inst.containerState, phase: 'done' } });
  if (msg.status === 'completed') {
    w.transition(inst, 'completed', {
      statusReason: null,
      outputData: msg.outputs,
      summary: `Sub-workflow run ${msg.childRunId} completed`,
      error: null,
      errorClass: null,
      errorCode: null,
    });
    w.push({ t: 'cancel_timer', stageRunId: inst.id });
    stageEvent(w, 'stage_run.completed', inst, { childRunId: msg.childRunId });
    return;
  }
  if (msg.status === 'cancelled') return cancelInstance(w, inst, 'child_cancelled');
  failInstance(w, inst, classified('subworkflow_failed', `The sub-workflow run ${msg.childRunId} failed${msg.error ? `: ${msg.error}` : ''}`), 'subworkflow:failed');
}

/** Pause or resume every running child with the run. */
export function propagateToChildren(w: Working, command: 'pause' | 'resume'): void {
  for (const inst of w.sorted()) {
    if (!isSub(inst) || inst.status !== 'running' || !inst.containerState.childRunId || inst.containerState.phase !== 'running') continue;
    w.push({ t: 'child_command', stageRunId: inst.id, childRunId: inst.containerState.childRunId, command });
  }
}

/** A sub-workflow whose child is being started keeps the run busy; one with a running child too (work goes on there). */
export function subworkflowBusy(i: InstanceState): boolean {
  return isSub(i) && i.status === 'running' && i.containerState.phase !== 'done';
}
