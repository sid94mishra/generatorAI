// U-32: a live run that nothing is moving except stages that are paused (an
// app quit interrupted them, or someone paused them one by one). The engine
// calls such a run `waiting`, but there is nothing to wait for: the run page
// offers Resume for those stages, not Pause for the run.

import type { RunStatus, StageStatus } from './types.js';

/** Stage states that still move a run on by themselves, or wait on a person or an event. */
const MOVING: ReadonlySet<StageStatus> = new Set(['ready', 'running', 'waiting', 'awaiting_input']);

/** The paused stages holding an otherwise idle live run; empty when the run is moving or not live. */
export function heldByPausedStages(run: { status: RunStatus; stages: ReadonlyArray<{ id: string; status: StageStatus }> }): string[] {
  if (run.status !== 'running' && run.status !== 'waiting') return [];
  if (run.stages.some((s) => MOVING.has(s.status))) return [];
  return run.stages.filter((s) => s.status === 'paused').map((s) => s.id);
}
