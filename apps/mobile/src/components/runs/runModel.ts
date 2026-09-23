// ────────────────────────────────────────────────────────────────
// Run model — which controls a run or stage offers, and what a parked
// stage is asking.
//
// Pure, so the rules that decide which buttons appear are testable without
// React Native. The run screen, the stage screen and the attention cards all
// read from here rather than each re-deriving "can I retry this?".
// ────────────────────────────────────────────────────────────────

import { epochOr, type Timestamp } from '@generatorai/client-core';

import { isTerminal } from './statusStyle';

/**
 * A stage that is waiting on an APPROVAL decision.
 *
 * Deliberately narrower than `needsAttention`: a failed stage needs a person
 * too, but the right answer to it is Retry, not Approve — and a paused stage
 * wants Resume. Only `awaiting_input` is a HITL gate the approve route accepts.
 */
export function awaitsApproval(status: string): boolean {
  return status === 'awaiting_input';
}

export interface InterruptView {
  /** What the stage is asking — always present, with a generic fallback. */
  reason: string;
  /** Harness summary for a stage-completion review. */
  summary?: string;
  /** Tool name for a permission-style interrupt. */
  tool?: string;
  kind?: string;
}

const FALLBACK_REASON = 'This stage is waiting for your approval.';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Read the parked payload of an `awaiting_input` stage.
 *
 * Mirrors web's `deriveRunView`: the payload is `reason`, `message` or
 * `prompt` depending on which gate parked it (a completion review, a harness
 * permission, a manual interrupt), or a bare string.
 */
export function interruptOf(data: unknown): InterruptView {
  if (typeof data === 'string') return { reason: str(data) ?? FALLBACK_REASON };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { reason: FALLBACK_REASON };
  const r = data as Record<string, unknown>;
  const view: InterruptView = {
    reason: str(r['reason']) ?? str(r['message']) ?? str(r['prompt']) ?? FALLBACK_REASON,
  };
  const summary = str(r['summary']);
  const tool = str(r['tool']) ?? str(r['toolName']);
  const kind = str(r['kind']);
  if (summary) view.summary = summary;
  if (tool) view.tool = tool;
  if (kind) view.kind = kind;
  return view;
}

export interface RunControls {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  retry: boolean;
}

/** Run-level controls, matching what `workflowRuns.ts` accepts per status. */
export function runControlsFor(status: string): RunControls {
  return {
    pause: status === 'running' || status === 'starting',
    resume: status === 'paused',
    cancel: !isTerminal(status) && status !== 'cancelling',
    retry: status === 'failed' || status === 'cancelled',
  };
}

export interface StageControls {
  retry: boolean;
  resume: boolean;
  wake: boolean;
  cancel: boolean;
}

/** Stage-level controls. A run that is itself finished offers only Retry. */
export function stageControlsFor(stageStatus: string, runStatus?: string): StageControls {
  const runDone = runStatus !== undefined && isTerminal(runStatus);
  return {
    retry: stageStatus === 'failed' || (stageStatus === 'cancelled' && !runDone),
    resume: !runDone && stageStatus === 'paused',
    wake: !runDone && stageStatus === 'sleeping',
    cancel:
      !runDone &&
      (stageStatus === 'running' ||
        stageStatus === 'queued' ||
        stageStatus === 'paused' ||
        stageStatus === 'sleeping'),
  };
}

/**
 * Should the screen keep polling?
 *
 * Only a terminal run stops. `created` and `cancelling` are not terminal —
 * they are about to change on their own — so they keep a (slow) poll going.
 */
export function pollIntervalFor(status: string | undefined, streamConnected: boolean): number | false {
  if (!status) return 5_000;
  if (isTerminal(status)) return false;
  // With the run scope connected, events drive refreshes; polling is only a
  // safety net for a dropped event.
  return streamConnected ? 30_000 : 5_000;
}

/**
 * The display title of a run — one implementation, shared with the web client
 * so the two never disagree about what a run is called.
 */
export { runTitle } from '@generatorai/client-core';

/**
 * The status to SHOW for a stage. The server can report a stage `completed`
 * that carries an error inside a `failed` run: the liveness monitor marks the
 * stage failed, then the aborted executor finishes and overwrites the row.
 * A green check beside "the executor is hung" misleads, so a completed stage
 * with an error in a failed run reads as failed (and offers Retry).
 */
export function effectiveStageStatus<S extends string>(
  stage: { status: S; error?: string | null },
  runStatus?: string,
): S | 'failed' {
  if (stage.status === 'completed' && stage.error && runStatus === 'failed') return 'failed';
  return stage.status;
}

/**
 * The most recently updated run, whatever order the server listed them in.
 * The workflows list took the first element and showed the OLDEST run's
 * status ("last run Failed" over a later success) while the workflow page,
 * which sorts, showed the right one.
 */
export function newestRun<T extends { updatedAt?: Timestamp | null; createdAt?: Timestamp | null }>(
  runs: readonly T[],
): T | undefined {
  let best: T | undefined;
  let bestAt = -Infinity;
  for (const run of runs) {
    const at = epochOr(run.updatedAt ?? run.createdAt ?? null, 0);
    if (at > bestAt) {
      best = run;
      bestAt = at;
    }
  }
  return best;
}
