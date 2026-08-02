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

export interface NotificationPlan {
  category: NotificationCategory;
  title: string;
  body: string;
  /**
   * Deep link target, e.g. `/runs/abc` or `/chats/xyz`. Tapping a
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
  interruption: 'active' | 'timeSensitive';
}

function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Trim to something that fits a lock screen without being cut mid-word. */
function clip(text: string, max = 120): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

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
      title: 'Waiting for your approval',
      body: clip(prompt ? `${stage}: ${prompt}` : `${stage} needs a decision before it can continue.`),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'timeSensitive',
    };
  }

  if (kind === 'chat.question_asked' || kind === 'chat.plan.review_requested') {
    const chatId = str(data, 'chatId');
    if (!chatId) return null;
    return {
      category: 'approval',
      title: kind === 'chat.question_asked' ? 'Your agent has a question' : 'A plan needs review',
      body: clip(str(data, 'summary') ?? str(data, 'question') ?? 'Open the chat to respond.'),
      route: `/chats/${chatId}`,
      requiredScope: 'read:chats',
      threadId: `chat:${chatId}`,
      interruption: 'timeSensitive',
    };
  }

  // ── Failures ──────────────────────────────────────────────────
  if (kind === 'workflow_run.failed') {
    const runId = str(data, 'workflowRunId');
    if (!runId) return null;
    return {
      category: 'failed',
      title: 'Workflow run failed',
      body: clip(str(data, 'error') ?? 'The run stopped with an error.'),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'active',
    };
  }

  if (kind === 'automation_execution.failed') {
    const automationId = str(data, 'automationId');
    if (!automationId) return null;
    return {
      category: 'failed',
      title: 'Automation failed',
      body: clip(str(data, 'error') ?? 'An automation run did not complete.'),
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
      title: 'Workflow run finished',
      body: clip(str(data, 'name') ?? 'Your run completed successfully.'),
      route: `/runs/${runId}`,
      requiredScope: 'read:workflows',
      threadId: `run:${runId}`,
      interruption: 'active',
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
