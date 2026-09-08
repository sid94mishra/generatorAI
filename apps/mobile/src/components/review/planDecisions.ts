// ────────────────────────────────────────────────────────────────
// Plan decisions — the ONE encoder (D12).
//
// `PlanSection` used to carry its own `{ approved, action }` mapping next
// to `gateActions.toPlanDecision`, and the two disagreed about what
// "Discard" meant. Everything now goes through `toPlanDecision`; this module
// only names the buttons and adds the edit-aware fields the server accepts
// (`useEditedContent`, `expectedRevision`) that the gate encoder has no
// reason to know about.
// ────────────────────────────────────────────────────────────────

import { toPlanDecision, type PlanDecision } from '../chat/gateActions';

export type PlanDecisionKind = 'approve' | 'autopilot' | 'changes' | 'discard';

/** The server action ids each button stands for — what `PlanSummary.actions` lists. */
export const PLAN_ACTION_ID: Record<PlanDecisionKind, string> = {
  approve: 'implement_interactive',
  autopilot: 'implement_autopilot',
  changes: 'request_changes',
  discard: 'exit_only',
};

export interface PlanDecisionBody extends PlanDecision {
  useEditedContent?: boolean;
  expectedRevision?: number;
}

/**
 * Build the body for `POST /chats/:id/plans/:planId/decision`.
 *
 * Requesting changes without feedback is refused here rather than by the
 * server: the agent cannot act on an empty rejection.
 */
export function planDecisionFor(
  kind: PlanDecisionKind,
  feedback?: string,
  options: { useEditedContent?: boolean; expectedRevision?: number } = {},
): PlanDecisionBody {
  const base = toPlanDecision(PLAN_ACTION_ID[kind], feedback);
  return {
    ...base,
    ...(options.useEditedContent ? { useEditedContent: true } : {}),
    ...(options.expectedRevision !== undefined ? { expectedRevision: options.expectedRevision } : {}),
  };
}

/** Whether the server offered autonomous implementation for this plan. */
export function offersAutopilot(actions: readonly string[] | undefined): boolean {
  return (actions ?? []).some((a) => /autopilot|auto_run|autorun/i.test(a));
}

export function canRequestChanges(feedback: string): boolean {
  return feedback.trim().length > 0;
}
