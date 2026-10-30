// ────────────────────────────────────────────────────────────────
// Which events deserve a push notification.
//
// Pure decision logic, deliberately separate from delivery so it can be
// tested exhaustively without a push provider, a device, or a network.
//
// ── The governing principle ──────────────────────────────────────
// A notification interrupts a person. The bar is therefore: "would this
// person want to be interrupted, right now, by this?" Almost nothing an
// agent emits clears that bar. What does:
//
//   * something is BLOCKED waiting for a human decision  (the flagship case)
//   * something FAILED and will not proceed
//   * a long-running thing FINISHED
//
// Everything else — tokens, tool calls, stage transitions, progress — is
// noise. Notifying on those trains the user to swipe the notification away
// without reading it, which destroys the value of the ones that matter.
// ────────────────────────────────────────────────────────────────

import type { GateRisk, PushQuestion } from '@generatorai/shared';
import { NOTIFICATION_MAX_OPTIONS, type NotificationCategoryId, type NotificationInterruption } from '@generatorai/shared/ui-contract';

/** Minimal shape of an event, so this module needs no core imports. */
export interface NotifiableEvent {
  kind: string;
  data: Record<string, unknown> | undefined;
}

export type NotificationCategory =
  /** A human decision is blocking progress. Actionable. */
  | 'approval'
  /** Work finished successfully. */
  | 'completed'
  /** Work stopped because something broke. */
  | 'failed';

export type InteractionKind = 'permission' | 'question' | 'plan';

/**
 * A chat gate the phone can address directly. Carried in the push `data` so
 * a lock-screen action can resolve the gate without opening the app.
 */
export interface PendingInteraction {
  chatId: string;
  interactionId: string;
  kind: InteractionKind;
  /**
   * Lock-screen action identifiers. Set ONLY for tool-permission prompts:
   * those have a closed allow/deny answer, whereas a question or a plan
   * review needs the user to read something first, so their notification
   * opens the gate screen instead of offering buttons.
   */
  actions?: readonly string[];
  /** MG-04 — a risky gate gets no lock-screen actions; it opens the app (MG-05 signs it). */
  risk?: GateRisk;
}

export interface NotificationPlan {
  /** The mute class (`MUTABLE_CATEGORIES`). */
  category: NotificationCategory;
  /** The v2 category the phone registers actions for (shared `NOTIFICATION_CATEGORIES`, MG-06 part B). */
  categoryId: NotificationCategoryId;
  title: string;
  body: string;
  /**
   * Deep link target, e.g. `/runs/abc` or `/chats/xyz/gate/123`. Tapping a
   * notification must land on the thing it is about — anything else and the
   * user has to go hunting, which defeats the point of notifying.
   */
  route: string;
  /**
   * Scope required to even see this. A device without `read:workflows` must
   * not be told a workflow failed: the notification body would leak the name
   * of something it is not allowed to read.
   */
  requiredScope: string;
  /** Groups related notifications on both platforms. */
  threadId: string;
  /**
   * iOS interruption level. Only approvals earn `timeSensitive`, which
   * breaks through Focus modes — spending that on a completion notice is how
   * users disable notifications for an app entirely.
   */
  interruption: NotificationInterruption;
  /** Present when the notification is about a specific chat gate. */
  interaction?: PendingInteraction;
  /** Workflow run gates and outcomes. */
  runId?: string;
  stageRunId?: string;
  /** A chat question's first question and its options, so a reply can be matched to an option (MD-183). */
  question?: PushQuestion;
}

/** Deep link into a specific chat gate (falls back to the chat itself). */
export function gateRoute(chatId: string, interactionId: string | undefined): string {
  return interactionId
    ? `/chats/${encodeURIComponent(chatId)}/gate/${encodeURIComponent(interactionId)}`
    : `/chats/${encodeURIComponent(chatId)}`;
}

function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Collapse whitespace so a multi-line tool input reads as one line. */
function oneLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

/** The text of the first question in a `chat.question.asked` payload. */
function firstQuestion(data: Record<string, unknown> | undefined): string | undefined {
  const questions = data?.['questions'];
  if (!Array.isArray(questions)) return undefined;
  for (const q of questions) {
    if (q && typeof q === 'object') {
      const text = (q as { question?: unknown }).question;
      if (typeof text === 'string' && text.length > 0) return text;
    }
  }
  return undefined;
}

/** The first question with its options (≤ NOTIFICATION_MAX_OPTIONS), as the push carries it. */
function firstQuestionPayload(data: Record<string, unknown> | undefined): PushQuestion | undefined {
  const questions = data?.['questions'];
  if (!Array.isArray(questions)) return undefined;
  const q = questions[0] as Record<string, unknown> | undefined;
  if (!q || typeof q !== 'object' || typeof q['id'] !== 'string' || !q['id']) return undefined;
  const options = Array.isArray(q['options'])
    ? q['options']
        .map((o) => (o && typeof o === 'object' && typeof (o as { label?: unknown }).label === 'string' ? (o as { label: string }).label : null))
        .filter((label): label is string => !!label)
        .slice(0, NOTIFICATION_MAX_OPTIONS)
        .map((label) => clip(oneLine(label) ?? label, 60))
    : [];
  return {
    id: q['id'],
    options,
    multiSelect: q['multiSelect'] === true,
    freeText: q['allowFreeform'] !== false || options.length === 0,
    count: questions.length,
  };
}

/** Trim to something that fits a lock screen without being cut mid-word. */
function clip(text: string, max = 120): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Longest tool-input summary that still reads well inside a title. */
const INLINE_SUMMARY_MAX = 48;

/**
 * Decide whether an event warrants a notification.
 *
 * Returns `null` for the overwhelming majority of events — that is the
 * expected outcome, not a failure.
 */
export function planNotification(event: NotifiableEvent): NotificationPlan | null {
  const { kind, data } = event;

  // ── Blocked on a human ────────────────────────────────────────
  if (kind === 'stage_run.awaiting_input') {
    const runId = str(data, 'workflowRunId');
    if (!runId) return null;
    const stage = str(data, 'name') ?? 'A stage';
    const prompt = str(data, 'prompt');
    return {
      category: 'approval',
      categoryId: 'run.approval',
      title: 'Waiting for your approval',
      body: clip(prompt ? `${stage}: ${prompt}` : `${stage} needs a decision before it can continue.`),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'timeSensitive',
      runId,
      ...(str(data, 'stageRunId') ? { stageRunId: str(data, 'stageRunId')! } : {}),
    };
  }

  // A tool call is blocked on allow/deny. The most time-critical gate of
  // all: the agent sits idle until someone answers, and the answer is one
  // tap — so this one carries lock-screen actions.
  if (kind === 'chat.permission.requested') {
    const chatId = str(data, 'chatId');
    const interactionId = str(data, 'interactionId');
    if (!chatId || !interactionId) return null;
    const toolName = str(data, 'toolName') ?? 'a tool';
    const riskValue = str(data, 'risk');
    const risk: GateRisk | undefined = riskValue === 'risky' || riskValue === 'standard' ? riskValue : undefined;
    const summary = oneLine(str(data, 'inputSummary'));
    const description = oneLine(str(data, 'description'));
    // "Allow Bash: pnpm test?" when the summary fits a title; otherwise the
    // summary moves to the body so it is not truncated mid-command.
    const inline = summary !== undefined && summary.length <= INLINE_SUMMARY_MAX ? summary : undefined;
    const title = inline ? `Allow ${toolName}: ${inline}?` : `Allow ${toolName}?`;
    const body =
      (inline ? description : (summary ?? description)) ??
      'Your agent is waiting for permission to continue.';
    return {
      category: 'approval',
      categoryId: risk === 'risky' ? 'approval.risky' : 'approval',
      title,
      body: clip(body),
      route: gateRoute(chatId, interactionId),
      requiredScope: 'read:chats',
      threadId: `chat:${chatId}`,
      interruption: 'timeSensitive',
      interaction: {
        chatId,
        interactionId,
        kind: 'permission',
        ...(risk === 'risky' ? { risk } : { actions: ['approve', 'deny'], ...(risk ? { risk } : {}) }),
      },
    };
  }

  // A device asked for more access. Only a device that can ANSWER should be
  // interrupted; `requiredScope` keeps it off every default-scope phone.
  if (kind === 'device.scope_requested') {
    const requestId = str(data, 'requestId');
    if (!requestId) return null;
    const name = str(data, 'deviceName') ?? 'A device';
    const rawScopes = data?.['scopes'];
    const scopes = Array.isArray(rawScopes) ? rawScopes.filter((s): s is string => typeof s === 'string') : [];
    return {
      category: 'approval',
      categoryId: 'scope_request',
      title: `${name} is asking for access`,
      body: clip(scopes.length > 0 ? scopes.join(', ') : 'Open Settings › Security to review.'),
      route: '/settings/security',
      requiredScope: 'admin:devices',
      threadId: `scope-request:${requestId}`,
      interruption: 'timeSensitive',
    };
  }

  if (kind === 'chat.question.asked') {
    const chatId = str(data, 'chatId');
    if (!chatId) return null;
    const interactionId = str(data, 'interactionId');
    const question = firstQuestionPayload(data);
    return {
      category: 'approval',
      categoryId: 'question',
      title: 'Your agent has a question',
      body: clip(oneLine(firstQuestion(data)) ?? str(data, 'summary') ?? 'Open the chat to respond.'),
      route: gateRoute(chatId, interactionId),
      requiredScope: 'read:chats',
      threadId: `chat:${chatId}`,
      interruption: 'timeSensitive',
      ...(interactionId ? { interaction: { chatId, interactionId, kind: 'question' } } : {}),
      ...(question ? { question } : {}),
    };
  }

  if (kind === 'chat.plan.review_requested') {
    const chatId = str(data, 'chatId');
    if (!chatId) return null;
    const interactionId = str(data, 'interactionId');
    return {
      category: 'approval',
      categoryId: 'plan',
      title: 'A plan needs review',
      body: clip(oneLine(str(data, 'title')) ?? oneLine(str(data, 'summary')) ?? 'Open the chat to respond.'),
      route: gateRoute(chatId, interactionId),
      requiredScope: 'read:chats',
      threadId: `chat:${chatId}`,
      interruption: 'timeSensitive',
      ...(interactionId ? { interaction: { chatId, interactionId, kind: 'plan' } } : {}),
    };
  }

  // A run paused because its budget ran out: it waits for someone to raise
  // the budget or stop it (P07 WP-7.3).
  if (kind === 'workflow_run.budget_exhausted') {
    const runId = str(data, 'workflowRunId');
    if (!runId) return null;
    return {
      category: 'approval',
      categoryId: 'run.approval',
      title: 'Workflow run out of budget',
      body: clip(`${str(data, 'name') ?? 'A run'} paused: its budget is spent. Raise it or stop the run.`),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'active',
      runId,
    };
  }

  // ── Failures ──────────────────────────────────────────────────
  if (kind === 'workflow_run.failed') {
    const runId = str(data, 'workflowRunId');
    if (!runId) return null;
    return {
      category: 'failed',
      categoryId: 'failed',
      title: 'Workflow run failed',
      body: clip(str(data, 'error') ?? 'The run stopped with an error.'),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'active',
      runId,
    };
  }

  // `partial` (some iterations failed) and a recovery that settled on
  // failed/partial travel the SAME alert path as an outright failure: a
  // mostly-failed batch reported silently is exactly what made unattended
  // operation unsafe (APPLICATION-REVIEW §6.3, item 28).
  const recoveredBadly =
    kind === 'automation_execution.recovered' &&
    (str(data, 'finalStatus') === 'failed' || str(data, 'finalStatus') === 'partial');
  if (kind === 'automation_execution.failed' || kind === 'automation_execution.partial' || recoveredBadly) {
    const automationId = str(data, 'automationId');
    if (!automationId) return null;
    const partial = kind === 'automation_execution.partial' || str(data, 'finalStatus') === 'partial';
    return {
      category: 'failed',
      categoryId: 'failed',
      title: partial ? 'Automation partially failed' : 'Automation failed',
      body: clip(str(data, 'error') ?? (partial ? 'Some iterations of an automation run failed.' : 'An automation run did not complete.')),
      route: `/automations/${automationId}`,
      requiredScope: 'read:workflows',
      threadId: `automation:${automationId}`,
      interruption: 'active',
    };
  }

  // ── Completion ────────────────────────────────────────────────
  if (kind === 'workflow_run.completed') {
    const runId = str(data, 'workflowRunId');
    if (!runId) return null;
    return {
      category: 'completed',
      categoryId: 'done',
      title: 'Workflow run finished',
      body: clip(str(data, 'name') ?? 'Your run completed successfully.'),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      // A completion never interrupts (06 §7.2): it lands in the list, grouped.
      interruption: 'passive',
      runId,
    };
  }

  return null;
}

/**
 * Categories a device has opted out of.
 *
 * Approvals are deliberately NOT mutable here: a user who mutes approvals
 * has effectively disabled the feature the app exists for, and would then
 * silently block their own agents. Muting is offered per-category for
 * completions and failures only.
 */
export const MUTABLE_CATEGORIES: NotificationCategory[] = ['completed', 'failed'];

export function isMutable(category: NotificationCategory): boolean {
  return MUTABLE_CATEGORIES.includes(category);
}
