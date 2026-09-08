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

import { isArchived, toEpochMs, type ChatSummary, type InteractionSummary } from '@generatorai/client-core';

export type OperationKind = 'chat' | 'run' | 'automation';

export interface Operation {
  id: string;
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
  interactionId: string;
  kind: GateKind;
  /** One line for a queue card: "Allow Bash?", "Answer 2 questions", "Review plan". */
  summary: string;
  /** Tool name for a permission gate, plan title for a plan gate. */
  subject?: string;
  /** Plan gates carry the plan id so the queue can deep-link to the plan sheet. */
  planId?: string;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Normalise a pending interaction into queue-card facts. Null when the row
 * is not pending or its kind is unknown to this build — a newer server's
 * gate kind is left to the chat screen rather than mislabelled here.
 */
export function gateFromInteraction(interaction: InteractionSummary): GateInfo | null {
  if (interaction.status !== 'pending') return null;
  const payload = interaction.payload ?? {};
  switch (interaction.kind) {
    case 'tool_permission': {
      const toolName = asString(payload['toolName'], 'a tool');
      return {
        interactionId: interaction.interactionId,
        kind: 'tool_permission',
        summary: `Allow ${toolName}?`,
        subject: toolName,
      };
    }
    case 'question': {
      const questions = Array.isArray(payload['questions']) ? payload['questions'].length : 0;
      return {
        interactionId: interaction.interactionId,
        kind: 'question',
        summary: questions > 1 ? `Answer ${questions} questions` : 'Answer a question',
      };
    }
    case 'plan_review': {
      const title = asString(payload['title']);
      const planId = asString(payload['planId']);
      return {
        interactionId: interaction.interactionId,
        kind: 'plan_review',
        summary: 'Review plan',
        ...(title ? { subject: title } : {}),
        ...(planId ? { planId } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * The gate a queue card should show for a chat: the permission prompt first
 * (the agent is stopped mid-tool-call), then a question, then a plan review
 * — the same priority the chat screen's pinned card uses.
 */
export function primaryGate(
  interactions: readonly InteractionSummary[] | undefined,
): GateInfo | null {
  if (!interactions) return null;
  const gates = interactions.map(gateFromInteraction).filter((g): g is GateInfo => g !== null);
  const order: GateKind[] = ['tool_permission', 'question', 'plan_review'];
  for (const kind of order) {
    const found = gates.find((g) => g.kind === kind);
    if (found) return found;
  }
  return null;
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
 * Automations never block, so they have no group. Failed runs count: a
 * failure needs a decision (retry, or give up) even though nothing is
 * strictly "asking".
 */
export function groupApprovals(operations: readonly Operation[]): ApprovalGroups {
  const chats: Operation[] = [];
  const runs: Operation[] = [];
  for (const op of operations) {
    if (!op.blocked) continue;
    if (op.kind === 'chat') chats.push(op);
    else if (op.kind === 'run') runs.push(op);
  }
  return { chats, runs, total: chats.length + runs.length };
}

/** The number on the tab badge and the accessory strip. */
export function needsYouCount(operations: readonly Operation[]): number {
  return groupApprovals(operations).total;
}

export type ActivityFilter = 'today' | 'running' | 'attention';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Urgency first, then recency.
 *
 * Returns a new array — the caller's list is usually a `useMemo` input and
 * mutating it in place would make the memo lie.
 */
export function rankOperations(operations: Operation[]): Operation[] {
  return [...operations].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

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

/**
 * How many chats the Activity feed probes for an open gate per refresh.
 *
 * D10 — there is no list-level "waiting on you" signal for chats: the health
 * snapshot only carries `runningChatIds`, and the only pending-gate source is
 * `GET /api/chats/:id/interactions`, one chat at a time. Twelve small GETs on
 * a 15 s cadence is what a phone can afford; the ordering below makes them
 * the twelve that matter.
 */
export const GATE_PROBE_LIMIT = 12;

/**
 * Which chats to ask about open gates, most likely first.
 *
 * Running chats first: a tool-permission or question gate holds the turn
 * open, so those chats are exactly where such a gate can be. Then the most
 * recently updated — a plan awaiting review ends the turn, so that chat is
 * no longer "running" but is almost always the freshest one.
 */
export function selectGateCandidates(
  chats: readonly ChatSummary[],
  runningChatIds: Iterable<string>,
  limit = GATE_PROBE_LIMIT,
): string[] {
  const running = new Set(runningChatIds);
  const live = chats.filter((chat) => !isArchived(chat));
  const ordered = [...live].sort((a, b) => {
    const ra = running.has(a.id);
    const rb = running.has(b.id);
    if (ra !== rb) return ra ? -1 : 1;
    return (toEpochMs(b.updatedAt) ?? 0) - (toEpochMs(a.updatedAt) ?? 0);
  });
  return ordered.slice(0, Math.max(0, limit)).map((chat) => chat.id);
}

/**
 * True when the chat has a gate a person must answer.
 *
 * The route already returns only pending rows (`listPendingByChat`), but the
 * status is checked anyway so a future "all interactions" response cannot
 * flag every chat that ever asked a question.
 */
export function hasPendingGate(interactions: readonly InteractionSummary[] | undefined): boolean {
  return Boolean(interactions?.some((i) => i.status === 'pending'));
}
