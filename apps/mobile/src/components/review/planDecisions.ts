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

/**
 * The plan body without a leading `# Title` that repeats the plan's title.
 *
 * Agents open the document with its own title, and the sheet already sets
 * the title as its heading, so the same words appeared twice back to back
 * in the few lines of body a phone has room for above the decision bar.
 */
export function planBodyWithoutTitle(markdown: string, title: string): string {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(markdown);
  if (!match || match[1]!.trim().toLowerCase() !== title.trim().toLowerCase()) return markdown;
  return markdown.slice(match[0].length).replace(/^\s*\n/, '');
}
