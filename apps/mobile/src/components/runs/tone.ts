// Status → semantic tone. One table for runs, stages and executions.

import type { Tone } from '../ui/primitives';
import { isActive, needsAttention } from './statusStyle';

export function toneOf(status: string): Tone {
  if (status === 'failed') return 'danger';
  if (needsAttention(status)) return 'warning';
  if (isActive(status) || status === 'cancelling') return 'info';
  if (status === 'completed' || status === 'succeeded') return 'success';
  return 'neutral';
}
