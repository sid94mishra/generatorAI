// ────────────────────────────────────────────────────────────────
// Activity ordering and filtering.
//
// Extracted from `useActivity` so it can be tested without React Native in
// the runner: the hook transitively imports the auth provider, which imports
// `react-native`, whose Flow-typed entry point vitest cannot parse.
//
// The rule this encodes is the entire product argument for a phone client:
// show me the one thing that is waiting on me, before anything else.
// ────────────────────────────────────────────────────────────────


export type OperationKind = 'chat' | 'run' | 'automation';

export interface Operation {
  id: string;
  /** Entity id separate from the feed key, which can identify one of several asks. */
  entityId?: string;
  stoppable?: boolean;
  retryable?: boolean;
  kind: OperationKind;
  name: string;
  status: string;
  updatedAt: number;
  /** Route to open when tapped. */
  href: string;
  /** True when a person is blocking progress. */
  blocked: boolean;
  running: boolean;
  /**
   * The open gate, for chats. Absent for runs (whose block is a stage
   * awaiting approval, answered on the run screen) and for chats whose
   * pending-interaction probe has not returned yet.
   */
  gate?: GateInfo;
}

// ── Gates ────────────────────────────────────────────────────────
//
// `GET /api/chats/:id/interactions` returns pending rows as
// `{ interactionId, kind, status, payload }` where `payload` is whatever the
// service opened the gate with (`ChatManagementService`): the tool-permission
// payload, `{ questions }`, or `{ planId, revision, title, summary, actions }`.
// The mapping below turns that into queue-card facts; the gate route builds
// the full block shapes from the same payload.

export type GateKind = 'tool_permission' | 'question' | 'plan_review';

export interface GateInfo {
  permissionAllowed?: boolean;
  interactionId: string;
  kind: GateKind;
  /** One line for a queue card: "Allow Bash?", "Answer 2 questions", "Review plan". */
  summary: string;
  /** Tool name for a permission gate, plan title for a plan gate. */
  subject?: string;
  /** Plan gates carry the plan id so the queue can deep-link to the plan sheet. */
  planId?: string;
}

// ── Approvals ────────────────────────────────────────────────────

export interface ApprovalGroups {
  chats: Operation[];
  runs: Operation[];
  total: number;
}

/**
 * Everything waiting on a person, grouped for the approvals sheet.
 *
 * Workflow and automation asks share the run group in the legacy sheet.
 * Server attention determines whether an item is blocked.
 */
export function groupApprovals(operations: readonly Operation[]): ApprovalGroups {
  const chats: Operation[] = [];
  const runs: Operation[] = [];
  for (const op of operations) {
    if (!op.blocked) continue;
    if (op.kind === 'chat') chats.push(op);
    else runs.push(op);
  }
  return { chats, runs, total: chats.length + runs.length };
}

/** The number on the tab badge and the accessory strip. */
export function needsYouCount(operations: readonly Operation[]): number {
  return groupApprovals(operations).total;
}

export type ActivityFilter = 'today' | 'running' | 'attention';

const DAY_MS = 24 * 60 * 60 * 1000;

export function filterOperations(
  operations: Operation[],
  filter: ActivityFilter,
  now = Date.now(),
): Operation[] {
  switch (filter) {
    case 'running':
      return operations.filter((op) => op.running);
    case 'attention':
      return operations.filter((op) => op.blocked);
    case 'today':
    default:
      // "Today" means the last 24h, not "since midnight": someone checking
      // their phone at 00:30 wants last night's work, not an empty list.
      return operations.filter((op) => now - op.updatedAt < DAY_MS);
  }
}
