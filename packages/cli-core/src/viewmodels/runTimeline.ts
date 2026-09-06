// ────────────────────────────────────────────────────────────────
// Event stream → a renderable timeline.
//
// The previous CLI put this in `EventRenderer.ts` and wrote straight to the
// terminal, which meant the TUI could not reuse a line of it. The reducer
// here produces data; a renderer decides how it looks.
//
// The `__isInternalTurn` filtering is domain knowledge worth preserving: hook
// context injection and validation feedback run as real turns on the same
// session, and rendering them makes the agent look like it is talking to
// itself.
// ────────────────────────────────────────────────────────────────

export type TimelineItemKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'stage'
  | 'step'
  | 'hook'
  | 'notice'
  | 'error'
  | 'usage';

export interface StepState {
  index: number;
  totalSteps?: number;
  label?: string;
  status: 'running' | 'complete';
}

export interface HookState {
  name: string;
  phase: string;
  status: 'running' | 'complete' | 'error';
  error?: string;
}

export interface ToolCallState {
  id: string;
  tool: string;
  args?: unknown;
  result?: unknown;
  status: 'running' | 'complete' | 'error';
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  /** Accumulated text for streaming kinds. */
  text: string;
  /** Set once the producing turn has completed. */
  complete: boolean;
  at: number;
  stageName?: string;
  /**
   * The stage RUN's own id (`data.stageRunId` on every real `stage_run.*`
   * event — `packages/shared/src/types/AgentEvent.ts`). Completion/failure
   * matching keys off this, not `stageName`: two stage runs (a retry, or
   * two branches of a loop template) can share a name, and matching by
   * text risked marking the wrong one complete.
   */
  stageRunId?: string;
  tool?: ToolCallState;
  step?: StepState;
  hook?: HookState;
  level?: 'info' | 'warn' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
}

/** A question card's option, trimmed to what a terminal picker needs. */
export interface PendingQuestionOption {
  label: string;
  description?: string;
}

/** One clarifying question inside a `chat.question.asked` gate. */
export interface PendingQuestion {
  id: string;
  header: string;
  question: string;
  options: PendingQuestionOption[];
  multiSelect: boolean;
  allowFreeform: boolean;
}

/**
 * A chat-scoped HITL gate — distinct from `pendingApproval` (a workflow
 * STAGE gate, `stage_run.awaiting_input`). This is `AgentInteractionService`
 * (`packages/core/src/services/AgentInteractionService.ts`), a separate
 * subsystem with different recovery semantics: a chat gate blocks an
 * in-memory SDK callback that does not survive a restart, so it expires
 * rather than resuming.
 *
 * Real producer for both event families: `ChatManagementService.ts`'s
 * `buildPlanReviewHandler`/`buildQuestionHandler`/`answerQuestion` — verified
 * field-by-field there, not assumed from `AgentEvent.ts`'s type names alone.
 */
export type PendingChatInteraction =
  | {
      kind: 'plan';
      interactionId: string;
      planId: string;
      title: string;
      summary: string;
      actions: string[];
      recommendedAction?: string;
    }
  | {
      kind: 'question';
      interactionId: string;
      questions: PendingQuestion[];
    }
  | {
      kind: 'permission';
      interactionId: string;
      /** Harness tool name (`Bash`, `WebFetch`, Copilot `shell`, …). */
      toolName: string;
      /** `ToolPermissionType` — kept as `string` so this viewmodel does not
       *  need shared's enum just to pass it through unchanged. */
      permissionType: string;
      description: string;
      /** Bounded, secret-redacted rendering of the tool input. */
      inputSummary: string;
      permissionMode: string;
    };

export interface TimelineState {
  items: TimelineItem[];
  /** The item currently receiving tokens, if any. */
  streamingItemId: string | null;
  currentStage: string | null;
  /** Highest sequence seen, for `Last-Event-ID` resume. */
  lastSequence: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  /** True while a turn the user did not initiate is in flight. */
  internalTurn: boolean;
  runStatus: string | null;
  pendingApproval: { stageId: string; stageName: string; prompt?: string } | null;
  /**
   * Provider-reported context-window snapshot (`harness.context_usage`) —
   * a real number when the provider sends one, distinct from `usage`
   * (accumulated token/cost deltas across the whole conversation, which is
   * NOT the same thing as "how full is the window right now": compaction
   * resets the window without changing the running total). `null` until a
   * provider actually sends one — not every provider does, so callers must
   * still fall back to `usage` themselves rather than assume this is always
   * populated.
   */
  contextUsage: {
    currentTokens: number;
    promptTokenLimit?: number;
    totalContextWindow?: number;
    compactionThreshold?: number;
  } | null;
  /** The chat-scoped HITL gate currently blocking the turn, if any. See `PendingChatInteraction`. */
  pendingInteraction: PendingChatInteraction | null;
  /**
   * Bumped every time a `workspace.changed` / `checkpoint.restored` event
   * says this workspace's files on disk are not what was last fetched
   * (Phase 7 item 2).
   *
   * A counter rather than a timeline item because a changes pane's content
   * is a FILE LIST fetched over REST, not a transcript: the event says
   * "refetch", it is not itself something to render. `AgentEvent.ts`'s own
   * comment calls `workspace.changed` the replacement for "the Changes
   * panel's polling loop" — this is the field that makes that true here.
   * Starts at 0 and only ever increases, so a consumer compares it against
   * the value it last fetched at rather than reacting to identity.
   */
  workspaceRevision: number;
}

export function emptyTimeline(): TimelineState {
  return {
    items: [],
    streamingItemId: null,
    currentStage: null,
    lastSequence: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
    internalTurn: false,
    runStatus: null,
    pendingApproval: null,
    contextUsage: null,
    pendingInteraction: null,
    workspaceRevision: 0,
  };
}

export interface StreamEvent {
  kind: string;
  data: Record<string, unknown>;
  sequence?: number;
}

export interface ReduceOptions {
  showThinking?: boolean;
  showTools?: boolean;
  /** Drop everything except stage transitions, errors and the final message. */
  minimal?: boolean;
  /** Cap on retained items; older ones are dropped. 0 keeps everything. */
  maxItems?: number;
}

let seq = 0;
function itemId(): string {
  seq += 1;
  return `t${seq}`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Folds one event into the timeline.
 *
 * Returns a NEW state so a React store can diff it; mutating in place would
 * make `useSyncExternalStore` miss updates.
 */
export function reduceEvent(
  state: TimelineState,
  event: StreamEvent,
  options: ReduceOptions = {},
): TimelineState {
  const { kind, data } = event;
  const now = Date.now();
  const sequence = event.sequence ?? state.lastSequence;

  // Re-delivered events after a reconnect must not duplicate output.
  if (event.sequence !== undefined && event.sequence <= state.lastSequence) return state;

  const base = { ...state, lastSequence: Math.max(state.lastSequence, sequence) };
  const isInternal = Boolean(data['__isInternalTurn']);

  switch (kind) {
    case 'harness.turn_start':
      return { ...base, internalTurn: isInternal, streamingItemId: null };

    case 'harness.turn_end':
    case 'harness.completion':
    case 'chat.turn_complete':
      return {
        ...base,
        internalTurn: false,
        streamingItemId: null,
        items: closeStreaming(base.items, base.streamingItemId),
      };

    case 'harness.user_message': {
      if (base.internalTurn || isInternal) return base;
      return push(base, {
        id: itemId(),
        kind: 'user',
        text: str(data['content'] ?? data['text']),
        complete: true,
        at: now,
      }, options);
    }

    case 'harness.token': {
      if (base.internalTurn || isInternal || options.minimal) return base;
      return appendStreaming(base, 'assistant', str(data['text']), now, options);
    }

    case 'harness.reasoning_delta': {
      if (base.internalTurn || isInternal || options.showThinking === false || options.minimal) {
        return base;
      }
      return appendStreaming(base, 'thinking', str(data['text']), now, options);
    }

    case 'harness.message_complete': {
      if (base.internalTurn || isInternal) return base;
      const content = str(data['content']);
      // A message_complete carrying the full text supersedes the accumulated
      // token stream: providers occasionally normalise whitespace or fix up
      // markdown between the last token and the final message.
      if (base.streamingItemId && content) {
        return {
          ...base,
          streamingItemId: null,
          items: base.items.map((item) =>
            item.id === base.streamingItemId ? { ...item, text: content, complete: true } : item,
          ),
        };
      }
      if (!content) {
        return { ...base, streamingItemId: null, items: closeStreaming(base.items, base.streamingItemId) };
      }
      return push(base, { id: itemId(), kind: 'assistant', text: content, complete: true, at: now }, options);
    }

    case 'harness.tool_start': {
      if (base.internalTurn || isInternal || options.showTools === false) return base;
      const tool: ToolCallState = {
        id: str(data['toolCallId'] ?? data['id'] ?? itemId()),
        tool: str(data['tool'] ?? data['name'] ?? 'tool'),
        args: data['args'] ?? data['input'],
        status: 'running',
        startedAt: now,
      };
      return push(
        base,
        {
          id: itemId(),
          kind: 'tool',
          text: tool.tool,
          complete: false,
          at: now,
          tool,
          ...(base.currentStage ? { stageName: base.currentStage } : {}),
        },
        options,
      );
    }

    case 'harness.tool_complete':
    case 'harness.tool_error': {
      if (options.showTools === false) return base;
      const callId = str(data['toolCallId'] ?? data['id']);
      const failed = kind === 'harness.tool_error';
      return {
        ...base,
        items: base.items.map((item) => {
          if (item.kind !== 'tool' || !item.tool) return item;
          if (callId && item.tool.id !== callId) return item;
          if (!callId && item.tool.status !== 'running') return item;
          return {
            ...item,
            complete: true,
            tool: {
              ...item.tool,
              status: failed ? 'error' : 'complete',
              result: data['result'] ?? data['output'],
              endedAt: now,
              ...(failed ? { error: str(data['error'] ?? data['message']) } : {}),
            },
          };
        }),
      };
    }

    // The server's real stage lifecycle (`packages/shared/src/types/AgentEvent.ts`,
    // confirmed against every producer in `packages/core/src/services/*.ts` —
    // there is no `stage.*`/`stage_run.started` emitter anywhere; the moment
    // a stage actually begins executing is `stage_run.running`). The bare
    // `stage.*` names are kept as harmless legacy aliases in case an older
    // recording/fixture still carries them, not because anything real still
    // sends them.
    case 'stage.started':
    case 'stage_run.running': {
      const stageRunId = str(data['stageRunId'] ?? data['stageId'] ?? data['id']);
      const stageName = str(data['name'] ?? data['stageName'] ?? stageRunId);
      // A retry, or resuming after `.paused`/`.sleeping`, re-fires `.running`
      // for a stage run whose card already exists — update it in place
      // rather than pushing a duplicate card for the same stage run.
      const existing = stageRunId
        ? base.items.find((item) => item.kind === 'stage' && item.stageRunId === stageRunId)
        : undefined;
      if (existing) {
        return {
          ...base,
          currentStage: stageName,
          items: base.items.map((item) =>
            item === existing ? { ...item, complete: false, text: stageName, stageName } : item,
          ),
        };
      }
      return push(
        { ...base, currentStage: stageName },
        {
          id: itemId(),
          kind: 'stage',
          text: stageName,
          complete: false,
          at: now,
          stageName,
          ...(stageRunId ? { stageRunId } : {}),
          level: 'info',
        },
        options,
      );
    }

    case 'stage.completed':
    case 'stage_run.completed': {
      const stageRunId = str(data['stageRunId'] ?? data['stageId'] ?? data['id']);
      const stageName = str(data['stageName'] ?? data['name'] ?? base.currentStage);
      return {
        ...base,
        items: base.items.map((item) => {
          if (item.kind !== 'stage') return item;
          // Prefer matching by the stage run's own id — a name match is
          // only the fallback for an event shape that omits it.
          const matches = stageRunId ? item.stageRunId === stageRunId : item.stageName === stageName;
          return matches ? { ...item, complete: true } : item;
        }),
      };
    }

    case 'stage.failed':
    case 'stage_run.failed': {
      const stageRunId = str(data['stageRunId'] ?? data['stageId'] ?? data['id']);
      const stageName = str(data['stageName'] ?? data['name'] ?? base.currentStage);
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: `${stageName}: ${str(data['error'] ?? 'stage failed')}`,
          complete: true,
          at: now,
          stageName,
          ...(stageRunId ? { stageRunId } : {}),
          level: 'error',
        },
        options,
      );
    }

    // `stage.awaiting_input`/`stage.resumed` used to be the case labels here,
    // matching a HITL event shape that was never real — the actual producer
    // (`packages/core/src/services/HitlService.ts`) has always emitted
    // `stage_run.awaiting_input`/`stage_run.input_received`, with the
    // pending stage identified by `stageRunId`, not `stageId`/`id`. This
    // made the HITL approval banner and `run.approve`/`run.reject` entirely
    // unreachable against a real server. `stage_run.resumed` (a distinct,
    // real event — generic pause/resume, unrelated to HITL) is deliberately
    // NOT treated as clearing an approval.
    case 'stage_run.awaiting_input': {
      const stageRunId = str(data['stageRunId']);
      const stageName = str(data['name'] ?? base.currentStage ?? stageRunId);
      return push(
        {
          ...base,
          pendingApproval: {
            stageId: stageRunId,
            stageName,
            ...(data['prompt'] ? { prompt: str(data['prompt']) } : {}),
          },
        },
        {
          id: itemId(),
          kind: 'notice',
          text: `${stageName} is waiting for approval`,
          complete: true,
          at: now,
          stageName,
          ...(stageRunId ? { stageRunId } : {}),
          level: 'warn',
        },
        options,
      );
    }

    case 'stage_run.input_received':
      return { ...base, pendingApproval: null };

    // Phase 6 item 4 — per-stage step progress, for the stage detail view.
    // Verified against the real producer (`StageExecutionService.ts`):
    // fields are exactly `stageRunId`/`workflowRunId`/`step`/`totalSteps`/
    // `label`, matching `AgentEvent.ts`'s declared shape.
    case 'stage_run.step_started': {
      // Step/hook progress is the same class of granular noise as a tool
      // call — gated by the same `showTools` flag (Phase 6 item 4's
      // per-pane verbosity control derives it from the pane's level) so
      // "minimal" verbosity actually reduces what a run pane shows, not
      // just its assistant/thinking text.
      if (options.showTools === false) return base;
      const stageRunId = str(data['stageRunId']);
      const index = num(data['step']) ?? 0;
      const step: StepState = {
        index,
        ...(num(data['totalSteps']) !== undefined ? { totalSteps: num(data['totalSteps']) } : {}),
        ...(data['label'] ? { label: str(data['label']) } : {}),
        status: 'running',
      };
      return push(
        base,
        {
          id: itemId(),
          kind: 'step',
          text: step.label ?? `step ${index + 1}`,
          complete: false,
          at: now,
          ...(stageRunId ? { stageRunId } : {}),
          step,
        },
        options,
      );
    }

    case 'stage_run.step_completed': {
      if (options.showTools === false) return base;
      const stageRunId = str(data['stageRunId']);
      const index = num(data['step']) ?? 0;
      return {
        ...base,
        items: base.items.map((item) =>
          item.kind === 'step' && item.stageRunId === stageRunId && item.step?.index === index
            ? { ...item, complete: true, step: { ...item.step, status: 'complete' } }
            : item,
        ),
      };
    }

    // Hooks are correlated to the whole run (`workflowRunId`), NOT to a
    // specific stage run — `HookExecutor.ts`'s real emit calls carry no
    // `stageRunId`/`stageId` at all, confirmed by reading every emit site,
    // not assumed from `AgentEvent.ts`'s type names alone. A hook can fire
    // outside any stage (session-level phases), so it deliberately has no
    // `stageRunId` on its item.
    case 'hook.started': {
      if (options.showTools === false) return base;
      const hook: HookState = { name: str(data['hookName']), phase: str(data['phase']), status: 'running' };
      return push(
        base,
        { id: itemId(), kind: 'hook', text: `${hook.name} (${hook.phase})`, complete: false, at: now, hook },
        options,
      );
    }

    case 'hook.completed':
    case 'hook.failed': {
      if (options.showTools === false) return base;
      const name = str(data['hookName']);
      const phase = str(data['phase']);
      const failed = kind === 'hook.failed';
      // No id correlates a start to its completion — matches the most
      // RECENT still-running hook with the same name+phase, same fallback
      // shape `harness.tool_complete` already uses for an id-less match.
      const index = base.items.reduce<number>(
        (found, item, i) =>
          item.kind === 'hook' && item.hook?.status === 'running' && item.hook.name === name && item.hook.phase === phase
            ? i
            : found,
        -1,
      );
      if (index === -1) return base;
      return {
        ...base,
        items: base.items.map((item, i) =>
          i === index && item.hook
            ? {
                ...item,
                complete: true,
                hook: {
                  ...item.hook,
                  status: failed ? 'error' : 'complete',
                  ...(failed ? { error: str(data['error']) } : {}),
                },
              }
            : item,
        ),
      };
    }

    // Phase 6 item 6 — a live log for the automation pane's currently-
    // watched execution (its `attachment` is scoped to the execution's own
    // id, per the real server-side bridge: `apps/server/src/composition-
    // root.ts`'s `bridgeEvent` republishes `automation_execution.*` to
    // `scope:'automation', id:<executionId>` — NOT `id:<automationId>`).
    // Verified against every real producer in
    // `packages/core/src/services/AutomationService.ts`: `.started`,
    // `.progress`, `.completed`, `.failed`, `.cancelled`, `.recovered`, and
    // `.iteration_retried` are the only kinds actually emitted.
    // `AgentEvent.ts` ALSO declares `.iteration_started`/`.iteration_
    // completed`/`.iteration_failed` — none of the three has a real
    // producer anywhere; they are not handled here because handling a kind
    // that never arrives would be dead code pretending otherwise.
    case 'automation_execution.started':
      return push(base, { id: itemId(), kind: 'notice', text: 'Execution started', complete: true, at: now, level: 'info' }, options);

    case 'automation_execution.progress': {
      const completed = num(data['completedRuns']) ?? 0;
      const failed = num(data['failedRuns']) ?? 0;
      const total = num(data['totalRuns']) ?? 0;
      return push(
        base,
        { id: itemId(), kind: 'notice', text: `Progress: ${completed + failed}/${total} runs (${failed} failed)`, complete: true, at: now, level: 'info' },
        options,
      );
    }

    case 'automation_execution.completed':
      return push(base, { id: itemId(), kind: 'notice', text: 'Execution completed', complete: true, at: now, level: 'info' }, options);

    case 'automation_execution.failed':
      return push(
        base,
        { id: itemId(), kind: 'error', text: `Execution failed: ${str(data['error'] ?? 'unknown error')}`, complete: true, at: now, level: 'error' },
        options,
      );

    case 'automation_execution.cancelled':
      return push(base, { id: itemId(), kind: 'notice', text: 'Execution cancelled', complete: true, at: now, level: 'warn' }, options);

    case 'automation_execution.recovered':
      return push(
        base,
        {
          id: itemId(),
          kind: 'notice',
          text: `Execution recovered as ${str(data['finalStatus'])}${data['error'] ? `: ${str(data['error'])}` : ''}`,
          complete: true,
          at: now,
          level: data['finalStatus'] === 'failed' ? 'error' : 'info',
        },
        options,
      );

    case 'automation_execution.iteration_retried':
      return push(
        base,
        {
          id: itemId(),
          kind: 'notice',
          text: `Iteration ${num(data['iterationIndex']) ?? '?'}: retry ${num(data['attempt']) ?? '?'}/${num(data['maxAttempts']) ?? '?'}`,
          complete: true,
          at: now,
          level: 'warn',
        },
        options,
      );

    // Phase 6 item 3 — chat-scoped HITL (plan review / clarifying
    // questions), distinct from `pendingApproval` above (a workflow STAGE
    // gate). Verified field-by-field against the real emitters in
    // `ChatManagementService.ts`'s `buildPlanReviewHandler`/
    // `buildQuestionHandler`/`answerQuestion` — this whole event family had
    // never been consumed by any TUI code before this (`grep` across
    // `apps/cli/src/tui` for it returned nothing).
    case 'chat.plan.review_requested': {
      const rawActions = data['actions'];
      return {
        ...base,
        pendingInteraction: {
          kind: 'plan',
          interactionId: str(data['interactionId']),
          planId: str(data['planId']),
          title: str(data['title']),
          summary: str(data['summary']),
          actions: Array.isArray(rawActions) ? rawActions.map(str) : [],
          ...(data['recommendedAction'] ? { recommendedAction: str(data['recommendedAction']) } : {}),
        },
      };
    }

    // `chat.plan.decided` (the user answered) and `chat.plan.expired` (the
    // gate timed out / the server restarted — `AgentInteractionService`'s
    // chat gates cannot survive a restart, unlike a workflow stage gate)
    // both clear the banner the same way.
    case 'chat.plan.decided':
    case 'chat.plan.expired': {
      if (base.pendingInteraction?.kind !== 'plan') return base;
      if (base.pendingInteraction.interactionId !== str(data['interactionId'])) return base;
      return { ...base, pendingInteraction: null };
    }

    case 'chat.question.asked': {
      const rawQuestions = Array.isArray(data['questions']) ? data['questions'] : [];
      return {
        ...base,
        pendingInteraction: {
          kind: 'question',
          interactionId: str(data['interactionId']),
          questions: rawQuestions.map((raw) => {
            const q = (raw ?? {}) as Record<string, unknown>;
            const rawOptions = Array.isArray(q['options']) ? q['options'] : [];
            return {
              id: str(q['id']),
              header: str(q['header']),
              question: str(q['question']),
              options: rawOptions.map((raw2) => {
                const o = (raw2 ?? {}) as Record<string, unknown>;
                return {
                  label: str(o['label']),
                  ...(o['description'] ? { description: str(o['description']) } : {}),
                };
              }),
              multiSelect: Boolean(q['multiSelect']),
              allowFreeform: Boolean(q['allowFreeform']),
            };
          }),
        },
      };
    }

    case 'chat.question.answered':
    case 'chat.question.expired': {
      if (base.pendingInteraction?.kind !== 'question') return base;
      if (base.pendingInteraction.interactionId !== str(data['interactionId'])) return base;
      return { ...base, pendingInteraction: null };
    }

    // Review finding 5.1 — a chat set to "ask me before each tool"
    // (`default`) or "accept edits" (`acceptEdits`) blocks the agent on
    // every (or every non-edit) tool call until the user allows or denies
    // it. Same chat-scoped-gate family as plan/question above — real
    // producer is `ChatManagementService.buildPermissionHandler`, event
    // shapes verified against `packages/shared/src/types/AgentEvent.ts`.
    case 'chat.permission.requested': {
      return {
        ...base,
        pendingInteraction: {
          kind: 'permission',
          interactionId: str(data['interactionId']),
          toolName: str(data['toolName']),
          permissionType: str(data['type']),
          description: str(data['description']),
          inputSummary: str(data['inputSummary']),
          permissionMode: str(data['permissionMode']),
        },
      };
    }

    case 'chat.permission.resolved':
    case 'chat.permission.expired': {
      if (base.pendingInteraction?.kind !== 'permission') return base;
      if (base.pendingInteraction.interactionId !== str(data['interactionId'])) return base;
      return { ...base, pendingInteraction: null };
    }

    // Phase 6 item 3 — background-task visibility. Real producer:
    // `packages/core/src/services/orchestrator/OrchestratorService.ts`
    // (verified field-by-field there — the per-field shapes match
    // `AgentEvent.ts`'s declarations, unlike several other event families in
    // this file, but `.failed` itself is declared with zero real emit
    // sites — see the case below).
    // Emitted on the PARENT chat's session, so a chat pane open on the
    // parent already receives these through its normal subscription; no
    // new scope needed. Rendered inline as notice/error cards, the same
    // treatment stage/hook/step events already get, rather than a separate
    // toast mechanism this reducer has no way to trigger (it is pure).
    case 'chat.background_task.spawned':
      return push(
        base,
        { id: itemId(), kind: 'notice', text: `Background task spawned: ${str(data['taskName'])}`, complete: true, at: now, level: 'info' },
        options,
      );

    case 'chat.background_task.status':
      return push(
        base,
        { id: itemId(), kind: 'notice', text: `${str(data['taskName'])}: ${str(data['status'])}`, complete: true, at: now, level: 'info' },
        options,
      );

    // `.completed`'s own `status` field is how a failure actually surfaces:
    // `OrchestratorService.ts` sets `record.status = 'failed'` on a worker
    // error (line ~413) but only reaches an emit once the idle-wait resolves
    // and fires `chat.background_task.completed` with that status — there is
    // no separate synchronous failure emit at the catch site itself. Must
    // branch on `status` here or a failed background task renders as a plain
    // "completed" info notice, indistinguishable from success.
    case 'chat.background_task.completed': {
      const status = str(data['status']);
      const failed = status === 'failed';
      return push(
        base,
        {
          id: itemId(),
          kind: failed ? 'error' : 'notice',
          text: `Background task ${failed ? 'failed' : 'completed'}: ${str(data['taskName'])}${data['summary'] ? ` — ${str(data['summary'])}` : ''}`,
          complete: true,
          at: now,
          level: failed ? 'error' : 'info',
        },
        options,
      );
    }

    // Declared in `AgentEvent.ts` but, as of this writing, no real producer
    // anywhere in `packages/core` emits it (`grep -r background_task.failed`
    // returns nothing) — a real failure arrives via `.completed` above with
    // `status: 'failed'` instead. Handled anyway, defensively, in case a
    // future producer starts emitting it as declared; today this case never
    // fires.
    case 'chat.background_task.failed':
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: `Background task failed: ${str(data['taskName'])}${data['error'] ? `: ${str(data['error'])}` : ''}`,
          complete: true,
          at: now,
          level: 'error',
        },
        options,
      );

    // ── Workspace / checkpoint (Phase 7 item 2) ───────────────────
    //
    // Reachable by a live subscriber only since the `'workspace'`
    // stream-broker scope was added; before that these three were emitted
    // correctly by `WorkspaceCheckpointService` and fanned out to nothing.
    //
    // `workspace.changed` bumps the revision WITHOUT adding a timeline item:
    // it fires on every debounced write burst during an agent turn, so
    // rendering one line each would bury a chat transcript in "files
    // changed" noise for no information a refreshed file list does not
    // already carry.
    case 'workspace.changed':
      return { ...base, workspaceRevision: base.workspaceRevision + 1 };

    case 'checkpoint.created':
      return push(
        base,
        {
          id: itemId(),
          kind: 'notice',
          text: `Checkpoint ${data['label'] ? `"${str(data['label'])}"` : str(data['checkpointKind'])} taken on ${str(data['repoAlias'])}`,
          complete: true,
          at: now,
          level: 'info',
        },
        options,
      );

    case 'checkpoint.restored': {
      const skipped = Array.isArray(data['skipped']) ? data['skipped'].length : 0;
      return push(
        // A restore rewrites the working tree — the file list a changes pane
        // is showing is stale the moment this arrives, so it bumps the
        // revision as well as reporting itself.
        { ...base, workspaceRevision: base.workspaceRevision + 1 },
        {
          id: itemId(),
          kind: 'notice',
          text:
            `Restored ${num(data['restoredCount']) ?? 0} file(s)` +
            `${num(data['deletedCount']) ? `, deleted ${num(data['deletedCount'])}` : ''}` +
            `${skipped > 0 ? ` — ${skipped} skipped` : ''}`,
          complete: true,
          at: now,
          level: skipped > 0 ? 'warn' : 'info',
        },
        options,
      );
    }

    case 'run.status':
    case 'workflow_run.status':
      return { ...base, runStatus: str(data['status']) };

    case 'harness.usage': {
      const usage = {
        inputTokens: base.usage.inputTokens + (num(data['inputTokens']) ?? 0),
        outputTokens: base.usage.outputTokens + (num(data['outputTokens']) ?? 0),
        totalTokens: base.usage.totalTokens + (num(data['totalTokens']) ?? 0),
        costUsd: base.usage.costUsd + (num(data['costUsd']) ?? 0),
      };
      return { ...base, usage };
    }

    case 'harness.context_usage': {
      // Sub-agent context is tracked separately from the main agent's — no
      // sub-agent gauge exists in either pane yet, so a sub-agent's snapshot
      // would silently overwrite the main agent's real number if not
      // filtered out here.
      if (data['agentId']) return base;
      return {
        ...base,
        contextUsage: {
          currentTokens: num(data['currentTokens']) ?? 0,
          ...(num(data['promptTokenLimit']) !== undefined
            ? { promptTokenLimit: num(data['promptTokenLimit']) }
            : {}),
          ...(num(data['totalContextWindow']) !== undefined
            ? { totalContextWindow: num(data['totalContextWindow']) }
            : {}),
          ...(num(data['compactionThreshold']) !== undefined
            ? { compactionThreshold: num(data['compactionThreshold']) }
            : {}),
        },
      };
    }

    // Surfaced at `warning` level so the terminal shows it without claiming
    // the turn failed — an MCP server that could not start is the usual case.
    case 'harness.warning':
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: str(data['message'] ?? 'Warning'),
          complete: true,
          at: now,
          level: 'warn',
        },
        options,
      );

    case 'harness.error':
    case 'run.error':
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: str(data['message'] ?? data['error'] ?? 'Unknown error'),
          complete: true,
          at: now,
          level: 'error',
        },
        options,
      );

    default:
      // The SAME object when nothing about the timeline changed — not
      // `base`, which is a fresh object every time.
      //
      // The store skips its `set()` on reference equality
      // (`applyEvent`: `if (next === current) return {}`), and a `set()`
      // notifies every subscriber AND re-runs `StreamReconciler.reconcile()`
      // over the whole workbench (audit §6.4: "Every store update reruns
      // attachment reconciliation"). Returning a fresh object for an event
      // this reducer does not even model spent all of that on nothing —
      // and the server emits plenty of kinds no pane renders.
      //
      // `base` is still returned when it carries a real cursor advance, so
      // resume-after-reconnect does not stall on a run of unmodelled events.
      return base.lastSequence === state.lastSequence ? state : base;
  }
}

function push(state: TimelineState, item: TimelineItem, options: ReduceOptions): TimelineState {
  const items = [...state.items, item];
  const max = options.maxItems ?? 0;
  return {
    ...state,
    items: max > 0 && items.length > max ? items.slice(items.length - max) : items,
  };
}

function closeStreaming(items: TimelineItem[], streamingId: string | null): TimelineItem[] {
  if (!streamingId) return items;
  return items.map((item) => (item.id === streamingId ? { ...item, complete: true } : item));
}

/**
 * Appends to the live item, opening one if the previous turn closed.
 *
 * Thinking and assistant text must not share an item: interleaving them into
 * one blob is precisely the bug the web `sseManager` cross-buffer flush
 * exists to prevent.
 */
function appendStreaming(
  state: TimelineState,
  kind: 'assistant' | 'thinking',
  text: string,
  now: number,
  options: ReduceOptions,
): TimelineState {
  if (!text) return state;

  const current = state.items.find((i) => i.id === state.streamingItemId);
  if (current && current.kind === kind && !current.complete) {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === current.id ? { ...item, text: item.text + text } : item,
      ),
    };
  }

  const item: TimelineItem = {
    id: itemId(),
    kind,
    text,
    complete: false,
    at: now,
    ...(state.currentStage ? { stageName: state.currentStage } : {}),
  };
  return { ...push({ ...state, items: closeStreaming(state.items, state.streamingItemId) }, item, options), streamingItemId: item.id };
}

/** Folds a batch, e.g. a replay response. */
export function reduceAll(
  state: TimelineState,
  events: StreamEvent[],
  options: ReduceOptions = {},
): TimelineState {
  return events.reduce((acc, event) => reduceEvent(acc, event, options), state);
}

// ── History ───────────────────────────────────────────────────────

/** A persisted message, as `GET /api/chats/:id/messages` returns it. */
export interface PersistedMessage {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: string | number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Seeds a timeline from stored messages.
 *
 * Without this a pane shows only what arrives on the live stream, so opening
 * any existing conversation reports "No messages yet" no matter how long it
 * is — the single most disorienting thing the UI could do.
 *
 * `lastSequence` is deliberately left at 0: history carries no stream
 * sequence numbers, and claiming one would make the reducer discard the
 * replayed events that follow.
 */
/**
 * The default retention bound, shared by live reduction and history
 * hydration.
 *
 * Audit §6.4: "REST hydration can push a timeline beyond its nominal
 * retention bound." It could, and did — `reduceEvent`'s `maxItems` only ever
 * applied to LIVE events, so opening a chat with fifty thousand stored
 * messages loaded all fifty thousand into memory and into the render path,
 * with the bound only starting to apply once the fifty-thousand-and-first
 * event streamed in. One constant, applied on both paths, is the fix.
 */
export const DEFAULT_TIMELINE_RETENTION = 2000;

export function timelineFromHistory(
  messages: PersistedMessage[],
  options: { maxItems?: number } = {},
): TimelineState {
  const items: TimelineItem[] = [];
  const maxItems = options.maxItems ?? DEFAULT_TIMELINE_RETENTION;

  for (const message of messages) {
    const text = typeof message.content === 'string' ? message.content : '';
    if (!text.trim()) continue;
    // Hook context and validation feedback are real turns on the same
    // session; showing them makes the agent look like it talks to itself.
    if (message.metadata?.['__isInternalTurn']) continue;

    const kind: TimelineItemKind =
      message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'notice';

    items.push({
      id: message.id ?? `history-${items.length}`,
      kind,
      text,
      complete: true,
      at: toEpochMs(message.timestamp),
    });
  }

  // The NEWEST are kept, matching `push`'s own trimming — the tail of a
  // conversation is what a reopened pane needs to show first.
  return { ...emptyTimeline(), items: maxItems > 0 ? items.slice(-maxItems) : items };
}

/**
 * Merges stored history under whatever already arrived live, keeping the
 * whole timeline inside the retention bound.
 *
 * Live events are newer than anything on disk, so they win the ORDER; the
 * bound then trims from the oldest end, which is the history side. Without
 * the trim, a long conversation's hydration re-broke the bound the moment it
 * landed, however carefully live reduction had held it.
 */
export function mergeHistoryIntoTimeline(
  current: TimelineState | undefined,
  history: TimelineState,
  options: { maxItems?: number } = {},
): TimelineState {
  const maxItems = options.maxItems ?? DEFAULT_TIMELINE_RETENTION;
  const trim = (items: TimelineItem[]): TimelineItem[] =>
    maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  if (!current || current.items.length === 0) {
    return { ...history, items: trim(history.items) };
  }
  return { ...current, items: trim([...history.items, ...current.items]) };
}

function toEpochMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
