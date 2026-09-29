// ────────────────────────────────────────────────────────────────
// Gate action presentation.
//
// Pure, and deliberately NOT inside the component file: it encodes a safety
// rule (approve and reject must never look alike) that has to be unit
// testable without dragging React Native into the test runner.
// ────────────────────────────────────────────────────────────────

export interface GateAction {
  id: string;
  label: string;
  tone: 'primary' | 'danger' | 'neutral';
}

const AFFIRMATIVE = /(approve|accept|yes|continue|proceed)/;
const NEGATIVE = /(reject|deny|no|cancel|abort|stop)/;

/**
 * Map a server-supplied action id to its presentation.
 *
 * Unknown actions render as neutral rather than being hidden: a newer server
 * offering an action this build does not recognise must still be actionable,
 * because the alternative is a gate the user cannot resolve at all.
 */
export function toGateAction(id: string): GateAction {
  const normalized = id.toLowerCase();
  if (AFFIRMATIVE.test(normalized)) return { id, label: humanize(id), tone: 'primary' };
  if (NEGATIVE.test(normalized)) return { id, label: humanize(id), tone: 'danger' };
  return { id, label: humanize(id), tone: 'neutral' };
}

function humanize(id: string): string {
  const spaced = id.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The decision body `POST /plans/:id/decision` accepts. */
export interface PlanDecision {
  approved: boolean;
  action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot';
  feedback?: string;
}

/**
 * Turn a server-supplied plan action id into the decision body.
 *
 * The server validates `{ approved, action?, feedback? }` and rejects
 * anything else with a 400, so the action id alone is NOT a valid payload —
 * posting it directly is why plan approval silently failed.
 */
export function toPlanDecision(actionId: string, feedback?: string): PlanDecision {
  const id = actionId.toLowerCase();
  const withFeedback = feedback?.trim() ? { feedback } : {};

  if (/exit|discard|abandon/.test(id)) {
    return { approved: true, action: 'exit_only', ...withFeedback };
  }
  if (/autopilot|auto_run|autorun/.test(id)) {
    return { approved: true, action: 'implement_autopilot', ...withFeedback };
  }
  if (NEGATIVE.test(id) || /changes/.test(id)) {
    return { approved: false, ...withFeedback };
  }
  return { approved: true, action: 'implement_interactive', ...withFeedback };
}

/** A plan-card button: what it posts, what it says, whether it asks for a note first. */
export interface PlanCardAction extends GateAction {
  /** Reveal a feedback field before posting ("Request changes"). */
  wantsFeedback: boolean;
}

/** Server action ids the card knows how to name. */
const PLAN_CARD_LABELS: Array<{ match: RegExp; label: string; tone: GateAction['tone']; wantsFeedback: boolean }> = [
  { match: /autopilot|auto_run|autorun/i, label: 'Approve & run autonomously', tone: 'neutral', wantsFeedback: false },
  { match: /implement|approve|accept/i, label: 'Approve & implement', tone: 'primary', wantsFeedback: false },
  { match: /changes|revise|feedback/i, label: 'Request changes', tone: 'neutral', wantsFeedback: true },
  { match: /exit|discard|abandon|reject/i, label: 'Discard plan', tone: 'danger', wantsFeedback: false },
];

/**
 * The plan card's buttons, from the server's `plan.actions`.
 *
 * Order is fixed (approve first, autopilot, changes, discard) regardless of
 * the order the server listed them, so the primary action is always in the
 * same place. A server that sends no list gets the two decisions every plan
 * supports; an id nothing here recognises still renders, neutral, so a
 * newer server can never leave the gate unresolvable.
 */
export function planCardActions(actions: readonly string[] | undefined): PlanCardAction[] {
  const ids = actions && actions.length > 0 ? actions : ['implement_interactive', 'request_changes'];
  const known: Array<PlanCardAction & { rank: number }> = [];
  const unknown: PlanCardAction[] = [];
  for (const id of ids) {
    const rank = PLAN_CARD_LABELS.findIndex((rule) => rule.match.test(id));
    if (rank < 0) {
      unknown.push({ ...toGateAction(id), wantsFeedback: false });
      continue;
    }
    if (known.some((k) => k.rank === rank)) continue;
    const rule = PLAN_CARD_LABELS[rank]!;
    known.push({ id, label: rule.label, tone: rule.tone, wantsFeedback: rule.wantsFeedback, rank });
  }
  // Approve (rank 1) leads, then autopilot (0), changes (2), discard (3).
  const order = [1, 0, 2, 3];
  known.sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
  return [...known.map(({ rank: _rank, ...action }) => action), ...unknown];
}
