// Run model (M8-03; MWorkflowRun, MWorkflowRunMenu, MRunStageChat): which controls a run or a stage offers, what a
// parked stage is asking, and the status a stage shows. Pure, unit-tested (moved from components/runs/runModel).
import { isTerminal } from '../../../services/api/runActivity';

/**
 * A stage waiting on an APPROVAL decision — narrower than "needs attention": a failed stage wants Retry, a paused
 * one Resume; only `awaiting_input` is a gate the approve command accepts.
 */
export function awaitsApproval(status: string): boolean {
  return status === 'awaiting_input';
}

export interface InterruptView {
  /** What the stage is asking — always present, with a generic fallback. */
  reason: string;
  summary?: string;
  tool?: string;
  kind?: string;
}

const FALLBACK_REASON = 'This stage is waiting for your approval.';
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value : undefined);

/** The parked payload of an `awaiting_input` stage (`reason`, `message` or `prompt`, or a bare string). */
export function interruptOf(data: unknown): InterruptView {
  if (typeof data === 'string') return { reason: str(data) ?? FALLBACK_REASON };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { reason: FALLBACK_REASON };
  const r = data as Record<string, unknown>;
  const view: InterruptView = { reason: str(r['reason']) ?? str(r['message']) ?? str(r['prompt']) ?? FALLBACK_REASON };
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
  /** A fork: a finished run is never mutated. */
  retry: boolean;
}

/** Run-level controls, matching what the run commands accept per status. */
export function runControlsFor(status: string): RunControls {
  return {
    pause: status === 'running' || status === 'starting' || status === 'waiting',
    resume: status === 'paused',
    cancel: !isTerminal(status) && status !== 'cancelling' && status !== 'finalizing',
    retry: status === 'failed' || status === 'cancelled',
  };
}

export interface StageControls {
  pause: boolean;
  resume: boolean;
  /** retry (resume / restart) of a paused instance in a live run; a fork from it once the run is finished. */
  retry: boolean;
  skip: boolean;
  cancel: boolean;
  /** Re-run from here: a fork of a finished run from this stage. */
  rerun: boolean;
}

const CANCELLABLE_STAGE: ReadonlySet<string> = new Set(['ready', 'starting', 'running', 'validating', 'retry_wait', 'waiting', 'paused']);
const PAUSABLE_STAGE: ReadonlySet<string> = new Set(['starting', 'running', 'validating', 'retry_wait']);

/**
 * Stage-level controls (MRunStageChat menu, MDF-74: items follow what the server accepts). In a live run only a
 * PAUSED instance retries or is skipped; a finished run offers Re-run from here (a fork) for any stage that ran.
 */
export function stageControlsFor(stageStatus: string, runStatus?: string): StageControls {
  const runDone = runStatus !== undefined && isTerminal(runStatus);
  if (runDone) {
    const ran = stageStatus !== 'pending' && stageStatus !== 'ready';
    return { pause: false, resume: false, retry: stageStatus === 'failed' || stageStatus === 'cancelled', skip: false, cancel: false, rerun: ran };
  }
  return {
    pause: PAUSABLE_STAGE.has(stageStatus),
    resume: stageStatus === 'paused',
    retry: stageStatus === 'paused',
    skip: stageStatus === 'paused',
    cancel: CANCELLABLE_STAGE.has(stageStatus),
    rerun: false,
  };
}

/**
 * The status to SHOW for a stage: a `completed` stage carrying an error in a `failed` run reads as failed (the
 * liveness monitor failed it, then the aborted executor overwrote the row).
 */
export function effectiveStageStatus<S extends string>(stage: { status: S; error?: string | null }, runStatus?: string): S | 'failed' {
  if (stage.status === 'completed' && stage.error && runStatus === 'failed') return 'failed';
  return stage.status;
}
