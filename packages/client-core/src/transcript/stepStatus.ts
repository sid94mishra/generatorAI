import type { StatusMapping } from '@generatorai/shared';
import type { StepStatus } from './types.js';

/** Transcript steps use `waiting` for a human gate, unlike timer-waiting runs. */
const STEP_STATUS = {
  pending: { state: 'queued' },
  running: { state: 'running' },
  waiting: { state: 'needs_you' },
  done: { state: 'succeeded', label: 'Done' },
  failed: { state: 'failed' },
} satisfies Record<StepStatus, StatusMapping>;

export function transcriptStepStatus(status: StepStatus): StatusMapping {
  return STEP_STATUS[status];
}
