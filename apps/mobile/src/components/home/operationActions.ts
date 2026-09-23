// Which inline action an activity row offers — the desktop Activity panel's
// rule: Stop a running chat turn, Cancel a running run, Retry a failed run.
// Pure, so the rule is tested without a renderer.

import type { Operation } from '../../api/activityRanking';

export type OperationActionKind = 'stop-chat' | 'cancel-run' | 'retry-run';

export interface OperationActionDef {
  kind: OperationActionKind;
  label: string;
  /** Cancelling a run cannot be undone; the others can simply be redone. */
  confirm: boolean;
  id: string;
}

const RETRYABLE = new Set(['failed', 'cancelled']);

export function operationActionFor(op: Operation): OperationActionDef | null {
  const id = op.id.slice(op.id.indexOf(':') + 1);
  if (!id) return null;
  // A gate is answered on its own card; stopping from the feed would discard
  // the question instead of answering it.
  if (op.kind === 'chat') return op.running && !op.blocked ? { kind: 'stop-chat', label: 'Stop', confirm: false, id } : null;
  if (op.kind === 'run') {
    if (op.running) return { kind: 'cancel-run', label: 'Cancel', confirm: true, id };
    if (RETRYABLE.has(op.status)) return { kind: 'retry-run', label: 'Retry', confirm: false, id };
  }
  return null;
}
