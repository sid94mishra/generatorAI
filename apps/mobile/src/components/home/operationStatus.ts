// ────────────────────────────────────────────────────────────────
// operationStatus — the one state a Home row shows, and its word.
//
// Pure, so the precedence (failed over waiting over running) is testable
// without rendering a row.
// ────────────────────────────────────────────────────────────────

import type { Operation } from '../../api/activityRanking';
import { statusLabel } from '../runs/statusStyle';

export type OperationState = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'idle';

/** The one state a row shows, in the order that matters to the reader. */
export function operationState(op: Operation): OperationState {
  if (op.status === 'failed') return 'failed';
  if (op.blocked) return 'waiting';
  if (op.running) return 'running';
  if (op.status === 'completed') return 'completed';
  if (op.status === 'cancelled') return 'cancelled';
  return 'idle';
}

export function operationStateLabel(op: Operation): string {
  switch (operationState(op)) {
    case 'waiting':
      return 'Needs you';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      // A chat between turns is "active" to the server (not archived); on a
      // row that reads as busy. Desktop's badge calls this state Idle.
      return op.kind === 'chat' ? 'Idle' : statusLabel(op.status);
  }
}
