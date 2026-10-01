import { runStatusTone } from '../../theme/status';
// Status → semantic tone. One table for runs, stages and executions.

import type { Tone } from '../ui/primitives';

export function toneOf(status: string): Tone {
  return runStatusTone(status);
}
