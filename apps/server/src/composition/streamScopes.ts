// ────────────────────────────────────────────────────────────────
// Which stream scopes an event fans out to.
//
// Extracted from `composition-root.ts`'s `bridgeEvent`, which was an
// unexported closure inside a 1000-line setup function — so the single piece
// of logic deciding who sees which event had no test at all, and each new
// scope (automation, then workspace) was added on the same "verified by
// reading it" basis as the last.
//
// Pure: an event in, a list of `(scope, id)` pairs out. No broker, no
// promises, no logging.
// ────────────────────────────────────────────────────────────────

export type SecondaryScope = 'run' | 'chat' | 'automation' | 'workspace' | 'global';

export interface ScopeTarget {
  scope: SecondaryScope;
  id: string;
}

/** `scope=global` is addressed by the literal id `all` (`routes/stream.ts`). */
export const GLOBAL_SCOPE_ID = 'all';

/**
 * Event kinds that describe an entity APPEARING, CHANGING STATE, or GOING
 * AWAY — the ones a list view has to know about to stay correct.
 *
 * Deliberately a closed list rather than a prefix match. The bridge sees
 * every event on the bus, including one `harness.token` per streamed
 * character; fanning those out to a scope every connected client subscribes
 * to would multiply the busiest traffic in the system by the number of
 * clients, to tell them something no list view renders.
 *
 * The rule for adding a kind here: would a LIST of these entities be wrong
 * on screen until the next poll if this event were missed? If not, it does
 * not belong.
 */
export const LIFECYCLE_EVENT_KINDS: ReadonlySet<string> = new Set([
  // Chats
  'chat.created',
  'chat.archived',
  'chat.deleted',
  'chat.mode_changed',
  'chat.agent_changed',
  // Workflow runs
  'workflow_run.created',
  'workflow_run.starting',
  'workflow_run.running',
  'workflow_run.paused',
  'workflow_run.resumed',
  'workflow_run.cancelling',
  'workflow_run.completed',
  'workflow_run.failed',
  'workflow_run.cancelled',
  'workflow_run.retried',
  // Automations
  'automation_execution.started',
  'automation_execution.completed',
  'automation_execution.failed',
  'automation_execution.cancelled',
  'automation_execution.recovered',
]);

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as { [k: string]: unknown })[key];
    return typeof value === 'string' && value ? value : undefined;
  }
  return undefined;
}

/**
 * The SECONDARY scopes an event should also be published to.
 *
 * The primary scope is never included: `eventBus.setEventStore` has already
 * appended the event on `session` and `global` before this runs — awaited,
 * which is what makes commit-then-broadcast hold — so republishing it here
 * would double every event on those two.
 *
 * `sessionId` is how the caller says which path the event arrived by:
 * `'__global__'` means it came through `subscribeGlobal`, and is therefore
 * already on the global scope.
 */
export function deriveStreamScopes(event: {
  sessionId: string;
  kind: string;
  data: unknown;
}): ScopeTarget[] {
  const targets: ScopeTarget[] = [];

  const runId = readString(event.data, 'workflowRunId');
  if (runId) targets.push({ scope: 'run', id: runId });

  const chatId = readString(event.data, 'chatId');
  if (chatId) targets.push({ scope: 'chat', id: chatId });

  if (event.kind.startsWith('automation_execution.')) {
    // Per EXECUTION: what a pane watching one run of an automation attaches
    // to.
    const executionId = readString(event.data, 'executionId');
    if (executionId) targets.push({ scope: 'automation', id: executionId });

    // Per AUTOMATION: what a pane showing an automation's whole execution
    // HISTORY needs. Without it such a pane could only ever follow one
    // execution — whichever happened to be running when it was opened — and
    // went permanently stale the moment that one finished.
    const automationId = readString(event.data, 'automationId');
    if (automationId) targets.push({ scope: 'automation', id: automationId });
  }

  const workspaceId = readString(event.data, 'workspaceId');
  if (workspaceId) targets.push({ scope: 'workspace', id: workspaceId });

  // Entity lifecycle → the global scope, so a LIST view can stay correct
  // without polling. Skipped when the event already arrived by the global
  // path, which would double it.
  if (event.sessionId !== '__global__' && LIFECYCLE_EVENT_KINDS.has(event.kind)) {
    targets.push({ scope: 'global', id: GLOBAL_SCOPE_ID });
  }

  return targets;
}
