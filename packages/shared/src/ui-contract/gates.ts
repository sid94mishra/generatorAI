// ────────────────────────────────────────────────────────────────
// Gate-card contract (03-component-inventory-domain.md §2.4 B-20; 08 M-11).
//
// A gate is a card that parks the agent until a person answers it. Four kinds
// exist; each offers a fixed set of actions with a fixed keyboard default, and
// ends in one of a fixed set of outcomes. Web (`blocks/transcript/gates`) and,
// next pass, mobile draw the same kinds, actions and keys; the words live in
// `./copy.ts` (M-13).
//
// Types and constants only, dependency-free: never import the shared root
// (the Electron main bundle loads `@generatorai/shared/ui-contract`).
// ────────────────────────────────────────────────────────────────

/** Every gate the transcript can raise. */
export const GATE_KINDS = ['permission', 'question', 'plan', 'computer_consent'] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/**
 * Where a gate is in its life:
 * - `pending`  — waiting on the user, actions live;
 * - `resolved` — answered (allowed / denied / answered / approved / changes requested …);
 * - `expired`  — can no longer be answered (the turn ended, or a replayed card
 *                that was still pending when it was persisted — replay coerces
 *                pending → expired).
 */
export type GateLifecycle = 'pending' | 'resolved' | 'expired';

/** The keyboard default an action carries (rendered as a trailing Kbd). */
export type GateKey = 'escape' | 'enter' | 'mod_enter';

/** How an action is drawn: the primary fill, a plain button, a destructive one, or a quiet dismissal. */
export type GateActionRole = 'primary' | 'secondary' | 'danger' | 'quiet';

export type PermissionGateAction = 'deny' | 'allow_once' | 'confirm_deny' | 'cancel_deny';
export type QuestionGateAction = 'submit_answers' | 'skip_questions' | 'next_question';
export type PlanGateAction = 'open_plan' | 'approve' | 'approve_autopilot' | 'request_changes' | 'send_feedback' | 'cancel_feedback';
export type ComputerConsentGateAction = 'consent_deny' | 'consent_allow_run' | 'consent_allow_once' | 'consent_always_allow';

export interface GateActionMap {
  permission: PermissionGateAction;
  question: QuestionGateAction;
  plan: PlanGateAction;
  computer_consent: ComputerConsentGateAction;
}
export type GateActionId = GateActionMap[GateKind];

export interface GateActionDef<A extends string = GateActionId> {
  id: A;
  role: GateActionRole;
  /** Keyboard default; at most one action per card holds each key. */
  key?: GateKey;
}

/**
 * The actions each gate offers, in display order (left → right in the action
 * row). A card shows the subset that applies to its state — `confirm_deny` /
 * `cancel_deny` only while a deny reason is being typed, `approve_autopilot`
 * only when the plan's server `actions` include `implement_autopilot`,
 * `consent_always_allow` only when the prompt is not synthetic input.
 *
 * Keys follow the board (B-20): Esc = deny/dismiss, ↵ = the primary action,
 * Mod ↵ = approve where approve is not already ↵.
 */
export const GATE_ACTIONS: { [K in GateKind]: readonly GateActionDef<GateActionMap[K]>[] } = {
  permission: [
    { id: 'deny', role: 'secondary', key: 'escape' },
    { id: 'allow_once', role: 'primary', key: 'enter' },
    { id: 'cancel_deny', role: 'quiet', key: 'escape' },
    { id: 'confirm_deny', role: 'danger', key: 'enter' },
  ],
  question: [
    { id: 'skip_questions', role: 'quiet' },
    { id: 'next_question', role: 'secondary' },
    { id: 'submit_answers', role: 'primary', key: 'mod_enter' },
  ],
  plan: [
    { id: 'open_plan', role: 'quiet' },
    { id: 'request_changes', role: 'secondary' },
    { id: 'approve', role: 'primary', key: 'mod_enter' },
    { id: 'approve_autopilot', role: 'secondary' },
    { id: 'cancel_feedback', role: 'quiet', key: 'escape' },
    { id: 'send_feedback', role: 'primary', key: 'mod_enter' },
  ],
  computer_consent: [
    { id: 'consent_deny', role: 'secondary', key: 'escape' },
    { id: 'consent_always_allow', role: 'secondary' },
    { id: 'consent_allow_run', role: 'secondary' },
    { id: 'consent_allow_once', role: 'primary', key: 'enter' },
  ],
};

/** Server statuses per gate kind (mirrors the stream block unions; kept structural so this file stays dependency-free). */
export interface GateStatusMap {
  permission: 'pending' | 'allowed' | 'denied' | 'expired';
  question: 'pending' | 'answered' | 'expired';
  plan:
    | 'drafting'
    | 'recorded'
    | 'awaiting_review'
    | 'changes_requested'
    | 'approved'
    | 'rejected'
    | 'superseded'
    | 'expired';
  /** A live consent prompt is pending; answered prompts leave the pending list. */
  computer_consent: 'pending' | 'allowed' | 'denied' | 'expired';
}

/** Which lifecycle phase a server status belongs to. */
export function gateLifecycle<K extends GateKind>(kind: K, status: GateStatusMap[K]): GateLifecycle {
  if (status === 'expired' || status === 'superseded') return 'expired';
  if (kind === 'plan') return status === 'awaiting_review' ? 'pending' : status === 'drafting' ? 'pending' : 'resolved';
  return status === 'pending' ? 'pending' : 'resolved';
}

/** Each `GateKey` as a binding string for `formatBinding` (`./keys.ts`); `Mod` is ⌘ on macOS, Ctrl elsewhere. */
export const GATE_KEY_BINDINGS: Record<GateKey, string> = {
  escape: 'Escape',
  enter: 'Enter',
  mod_enter: 'Mod+Enter',
};
