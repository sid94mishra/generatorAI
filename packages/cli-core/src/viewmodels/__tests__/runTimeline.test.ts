import { describe, expect, it } from 'vitest';
import { emptyTimeline, reduceEvent, type StreamEvent } from '../runTimeline.js';

function evt(kind: string, data: Record<string, unknown> = {}, sequence?: number): StreamEvent {
  return { kind, data, ...(sequence !== undefined ? { sequence } : {}) };
}

describe('reduceEvent — stage lifecycle (real event shapes)', () => {
  // Regression: the reducer used to switch on `stage.started`/
  // `stage_run.started` and `stage.awaiting_input`/`stage.resumed` — kinds
  // the server has never emitted. The real producers
  // (`packages/core/src/services/StageExecutionService.ts`,
  // `HitlService.ts`) always send `stage_run.running`/
  // `stage_run.awaiting_input`/`stage_run.input_received`, keyed by
  // `stageRunId`. Against a real server this made the "stage started" card,
  // the HITL approval banner, AND `run.approve`/`run.reject` all
  // unreachable — this suite pins the fix against the real shapes.

  it('renders a stage card on the real stage_run.running event, not the never-emitted "started" kind', () => {
    const state = reduceEvent(emptyTimeline(), evt('stage_run.running', { stageRunId: 'sr_1', name: 'build' }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: 'stage', text: 'build', stageRunId: 'sr_1', complete: false });
    expect(state.currentStage).toBe('build');
  });

  it('re-firing .running for the same stageRunId updates the existing card instead of duplicating it', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.running', { stageRunId: 'sr_1', name: 'build' }));
    state = reduceEvent(state, evt('stage_run.paused', { stageRunId: 'sr_1' }));
    state = reduceEvent(state, evt('stage_run.running', { stageRunId: 'sr_1', name: 'build' }));
    expect(state.items).toHaveLength(1);
  });

  it('completes the stage card matching by stageRunId, not by name (two stage runs can share a name)', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.running', { stageRunId: 'sr_1', name: 'loop-step' }));
    state = reduceEvent(state, evt('stage_run.running', { stageRunId: 'sr_2', name: 'loop-step' }));
    state = reduceEvent(state, evt('stage_run.completed', { stageRunId: 'sr_1' }));

    const [first, second] = state.items;
    expect(first).toMatchObject({ stageRunId: 'sr_1', complete: true });
    expect(second).toMatchObject({ stageRunId: 'sr_2', complete: false });
  });

  it('pushes an error card on stage_run.failed with the real error field', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.running', { stageRunId: 'sr_1', name: 'deploy' }));
    state = reduceEvent(state, evt('stage_run.failed', { stageRunId: 'sr_1', error: 'timed out' }));
    const errorItem = state.items.find((i) => i.kind === 'error');
    expect(errorItem?.text).toBe('deploy: timed out');
  });

  it('sets pendingApproval on the real stage_run.awaiting_input event, keyed by stageRunId', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('stage_run.awaiting_input', { stageRunId: 'sr_1', prompt: 'ok to deploy?' }),
    );
    expect(state.pendingApproval).toEqual({ stageId: 'sr_1', stageName: 'sr_1', prompt: 'ok to deploy?' });
  });

  it('prefers the stage name already tracked from .running over the bare stageRunId', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.running', { stageRunId: 'sr_1', name: 'review' }));
    state = reduceEvent(state, evt('stage_run.awaiting_input', { stageRunId: 'sr_1' }));
    expect(state.pendingApproval?.stageName).toBe('review');
  });

  it('clears pendingApproval on the real stage_run.input_received event', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.awaiting_input', { stageRunId: 'sr_1' }));
    expect(state.pendingApproval).not.toBeNull();
    state = reduceEvent(state, evt('stage_run.input_received', { stageRunId: 'sr_1' }));
    expect(state.pendingApproval).toBeNull();
  });

  it('does NOT clear pendingApproval on stage_run.resumed — a distinct, unrelated real event', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.awaiting_input', { stageRunId: 'sr_1' }));
    state = reduceEvent(state, evt('stage_run.resumed', { stageRunId: 'sr_1' }));
    expect(state.pendingApproval).not.toBeNull();
  });

  it('still accepts the never-real legacy stage.* aliases without crashing', () => {
    expect(() => reduceEvent(emptyTimeline(), evt('stage.started', { stageName: 'legacy' }))).not.toThrow();
    expect(() => reduceEvent(emptyTimeline(), evt('stage.completed', { stageName: 'legacy' }))).not.toThrow();
    expect(() => reduceEvent(emptyTimeline(), evt('stage.failed', { stageName: 'legacy' }))).not.toThrow();
  });
});

describe('reduceEvent — harness.context_usage', () => {
  it('records a provider-reported context snapshot', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('harness.context_usage', {
        source: 'provider',
        currentTokens: 12_345,
        promptTokenLimit: 190_000,
        totalContextWindow: 200_000,
        compactionThreshold: 160_000,
      }),
    );
    expect(state.contextUsage).toEqual({
      currentTokens: 12_345,
      promptTokenLimit: 190_000,
      totalContextWindow: 200_000,
      compactionThreshold: 160_000,
    });
  });

  it('ignores a sub-agent snapshot — the main-pane gauge has no sub-agent slot yet', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('harness.context_usage', { agentId: 'sub_1', currentTokens: 999 }),
    );
    expect(state.contextUsage).toBeNull();
  });

  it('a later snapshot (e.g. after compaction) replaces the earlier one, including dropping back down', () => {
    let state = reduceEvent(emptyTimeline(), evt('harness.context_usage', { currentTokens: 150_000 }));
    state = reduceEvent(state, evt('harness.context_usage', { currentTokens: 8_000 }));
    expect(state.contextUsage?.currentTokens).toBe(8_000);
  });
});

// Phase 6 item 4 — per-stage step progress (`RunPane`'s stage detail view).
// Fields verified against the real producer
// (`packages/core/src/services/StageExecutionService.ts`), not assumed
// from `AgentEvent.ts`'s type union alone.
describe('reduceEvent — stage_run.step_started / step_completed', () => {
  it('pushes a running step item scoped to its stage run', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('stage_run.step_started', { stageRunId: 'sr_1', step: 0, totalSteps: 3, label: 'lint' }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      kind: 'step',
      stageRunId: 'sr_1',
      text: 'lint',
      complete: false,
      step: { index: 0, totalSteps: 3, label: 'lint', status: 'running' },
    });
  });

  it('completes the matching step by stageRunId + step index, not the first running step of any stage', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.step_started', { stageRunId: 'sr_1', step: 0 }));
    state = reduceEvent(state, evt('stage_run.step_started', { stageRunId: 'sr_2', step: 0 }));
    state = reduceEvent(state, evt('stage_run.step_completed', { stageRunId: 'sr_1', step: 0 }));

    const [first, second] = state.items;
    expect(first).toMatchObject({ stageRunId: 'sr_1', complete: true, step: { status: 'complete' } });
    expect(second).toMatchObject({ stageRunId: 'sr_2', complete: false, step: { status: 'running' } });
  });

  it('does not confuse two different steps of the SAME stage run', () => {
    let state = reduceEvent(emptyTimeline(), evt('stage_run.step_started', { stageRunId: 'sr_1', step: 0 }));
    state = reduceEvent(state, evt('stage_run.step_started', { stageRunId: 'sr_1', step: 1 }));
    state = reduceEvent(state, evt('stage_run.step_completed', { stageRunId: 'sr_1', step: 0 }));

    const [step0, step1] = state.items;
    expect(step0?.complete).toBe(true);
    expect(step1?.complete).toBe(false);
  });
});

// Phase 6 item 4 — hooks are run-scoped, not stage-scoped: confirmed by
// reading every real `hook.*` emit call in
// `packages/core/src/services/HookExecutor.ts`, none of which carries a
// `stageRunId`/`stageId`.
describe('reduceEvent — hook.started / completed / failed', () => {
  it('pushes a running hook item with no stage correlation', () => {
    const state = reduceEvent(emptyTimeline(), evt('hook.started', { hookName: 'pre_run', phase: 'pre_run' }));
    expect(state.items[0]).toMatchObject({
      kind: 'hook',
      hook: { name: 'pre_run', phase: 'pre_run', status: 'running' },
    });
    expect(state.items[0]).not.toHaveProperty('stageRunId');
  });

  it('completes the most recent matching running hook by name+phase', () => {
    let state = reduceEvent(emptyTimeline(), evt('hook.started', { hookName: 'pre_run', phase: 'pre_run' }));
    state = reduceEvent(state, evt('hook.completed', { hookName: 'pre_run', phase: 'pre_run' }));
    expect(state.items[0]).toMatchObject({ complete: true, hook: { status: 'complete' } });
  });

  it('records the error message on hook.failed', () => {
    let state = reduceEvent(emptyTimeline(), evt('hook.started', { hookName: 'validate', phase: 'post_turn' }));
    state = reduceEvent(
      state,
      evt('hook.failed', { hookName: 'validate', phase: 'post_turn', error: 'schema mismatch' }),
    );
    expect(state.items[0]).toMatchObject({ hook: { status: 'error', error: 'schema mismatch' } });
  });

  it('is a no-op if a completion arrives with no matching running hook', () => {
    const state = reduceEvent(emptyTimeline(), evt('hook.completed', { hookName: 'ghost', phase: 'pre_run' }));
    expect(state.items).toHaveLength(0);
  });

  it('matching by name+phase does not cross-complete a differently-phased hook of the same name', () => {
    let state = reduceEvent(emptyTimeline(), evt('hook.started', { hookName: 'notify', phase: 'pre_run' }));
    state = reduceEvent(state, evt('hook.started', { hookName: 'notify', phase: 'post_turn' }));
    state = reduceEvent(state, evt('hook.completed', { hookName: 'notify', phase: 'post_turn' }));

    const [preRun, postTurn] = state.items;
    expect(preRun).toMatchObject({ complete: false });
    expect(postTurn).toMatchObject({ complete: true });
  });

  // Steps/hooks are the same class of granular noise as a tool call —
  // "minimal" verbosity (Phase 6 item 4's per-pane control, which maps to
  // `showTools: false`) must actually hide them, or the feature does not
  // do what its name promises for a run pane full of step/hook events.
  it('showTools: false suppresses step and hook items, matching how it already suppresses tool calls', () => {
    const options = { showTools: false };
    let state = reduceEvent(emptyTimeline(), evt('stage_run.step_started', { stageRunId: 'sr_1', step: 0 }), options);
    state = reduceEvent(state, evt('hook.started', { hookName: 'pre_run', phase: 'pre_run' }), options);
    expect(state.items).toHaveLength(0);

    // And a completion for something that was never pushed (because it was
    // suppressed) must stay a safe no-op, not throw.
    state = reduceEvent(state, evt('stage_run.step_completed', { stageRunId: 'sr_1', step: 0 }), options);
    state = reduceEvent(state, evt('hook.completed', { hookName: 'pre_run', phase: 'pre_run' }), options);
    expect(state.items).toHaveLength(0);
  });
});

// Phase 6 item 6 — automation pane live log. Kinds verified against every
// real emit call in `packages/core/src/services/AutomationService.ts`, not
// assumed from `AgentEvent.ts`'s type union — `iteration_started`/
// `iteration_completed`/`iteration_failed` are declared there but have zero
// real producers, so they are deliberately absent from this suite too.
describe('reduceEvent — automation_execution.*', () => {
  it('logs a notice for started', () => {
    const state = reduceEvent(emptyTimeline(), evt('automation_execution.started', { executionId: 'e1' }));
    expect(state.items[0]).toMatchObject({ kind: 'notice', text: 'Execution started' });
  });

  it('logs progress with the real completedRuns/failedRuns/totalRuns fields', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('automation_execution.progress', { completedRuns: 3, failedRuns: 1, totalRuns: 10 }),
    );
    expect(state.items[0]?.text).toBe('Progress: 4/10 runs (1 failed)');
  });

  it('logs completed as a notice, failed as an error with the real message', () => {
    let state = reduceEvent(emptyTimeline(), evt('automation_execution.completed', {}));
    expect(state.items[0]).toMatchObject({ kind: 'notice', text: 'Execution completed' });

    state = reduceEvent(state, evt('automation_execution.failed', { error: 'quota exceeded' }));
    expect(state.items[1]).toMatchObject({ kind: 'error', text: 'Execution failed: quota exceeded' });
  });

  it('logs cancelled and recovered', () => {
    let state = reduceEvent(emptyTimeline(), evt('automation_execution.cancelled', {}));
    expect(state.items[0]).toMatchObject({ kind: 'notice', text: 'Execution cancelled', level: 'warn' });

    state = reduceEvent(
      state,
      evt('automation_execution.recovered', { finalStatus: 'failed', error: 'crash' }),
    );
    expect(state.items[1]).toMatchObject({
      kind: 'notice',
      text: 'Execution recovered as failed: crash',
      level: 'error',
    });
  });

  it('logs an iteration retry with the real attempt/maxAttempts fields', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('automation_execution.iteration_retried', { iterationIndex: 2, attempt: 2, maxAttempts: 3 }),
    );
    expect(state.items[0]?.text).toBe('Iteration 2: retry 2/3');
  });
});

// Phase 6 item 3 — chat-scoped HITL (plan review / clarifying questions).
// Fields verified against the real producers in `ChatManagementService.ts`
// (`buildPlanReviewHandler`/`buildQuestionHandler`/`answerQuestion`), not
// assumed from any type union.
describe('reduceEvent — chat.plan.* (plan review gate)', () => {
  it('sets pendingInteraction on chat.plan.review_requested', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.plan.review_requested', {
        chatId: 'c1',
        planId: 'p1',
        interactionId: 'i1',
        revision: 2,
        title: 'Add OAuth login',
        fileName: '2026-07-29-add-oauth-login.md',
        summary: 'Adds Google OAuth.',
        actions: ['implement_interactive', 'implement_autopilot', 'exit_only'],
        recommendedAction: 'implement_interactive',
      }),
    );
    expect(state.pendingInteraction).toEqual({
      kind: 'plan',
      interactionId: 'i1',
      planId: 'p1',
      title: 'Add OAuth login',
      summary: 'Adds Google OAuth.',
      actions: ['implement_interactive', 'implement_autopilot', 'exit_only'],
      recommendedAction: 'implement_interactive',
    });
  });

  it('clears pendingInteraction on chat.plan.decided, matching by interactionId', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.plan.review_requested', { interactionId: 'i1', planId: 'p1' }),
    );
    state = reduceEvent(state, evt('chat.plan.decided', { interactionId: 'i1', approved: true }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('clears pendingInteraction on chat.plan.expired', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.plan.review_requested', { interactionId: 'i1', planId: 'p1' }),
    );
    state = reduceEvent(state, evt('chat.plan.expired', { interactionId: 'i1', reason: 'timeout' }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('does not clear a DIFFERENT pending interaction (id mismatch)', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.plan.review_requested', { interactionId: 'i1', planId: 'p1' }),
    );
    state = reduceEvent(state, evt('chat.plan.decided', { interactionId: 'i-other' }));
    expect(state.pendingInteraction).not.toBeNull();
  });
});

describe('reduceEvent — chat.question.* (clarifying-question gate)', () => {
  it('sets pendingInteraction on chat.question.asked with the real question shape', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.question.asked', {
        interactionId: 'i2',
        turnId: 't1',
        questions: [
          {
            id: 'q1',
            header: 'Framework',
            question: 'Which framework?',
            options: [{ label: 'React', description: 'Most common' }, { label: 'Vue' }],
            multiSelect: false,
            allowFreeform: true,
          },
        ],
      }),
    );
    expect(state.pendingInteraction).toEqual({
      kind: 'question',
      interactionId: 'i2',
      questions: [
        {
          id: 'q1',
          header: 'Framework',
          question: 'Which framework?',
          options: [{ label: 'React', description: 'Most common' }, { label: 'Vue' }],
          multiSelect: false,
          allowFreeform: true,
        },
      ],
    });
  });

  it('clears pendingInteraction on chat.question.answered', () => {
    let state = reduceEvent(emptyTimeline(), evt('chat.question.asked', { interactionId: 'i2', questions: [] }));
    state = reduceEvent(state, evt('chat.question.answered', { interactionId: 'i2', answers: {} }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('clears pendingInteraction on chat.question.expired', () => {
    let state = reduceEvent(emptyTimeline(), evt('chat.question.asked', { interactionId: 'i2', questions: [] }));
    state = reduceEvent(state, evt('chat.question.expired', { interactionId: 'i2', reason: 'timeout' }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('a plan gate is not accidentally cleared by a question-kind clearing event, and vice versa', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.plan.review_requested', { interactionId: 'i1', planId: 'p1' }),
    );
    state = reduceEvent(state, evt('chat.question.answered', { interactionId: 'i1' }));
    expect(state.pendingInteraction).not.toBeNull();
  });
});

// Review finding 5.1 — the blocking tool-permission prompt. Same chat-scoped
// gate family as plan/question above; fields verified against
// `ChatManagementService.buildPermissionHandler` and
// `packages/shared/src/types/AgentEvent.ts`'s `chat.permission.*` shapes.
describe('reduceEvent — chat.permission.* (tool-permission gate)', () => {
  it('sets pendingInteraction on chat.permission.requested with the real payload shape', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.permission.requested', {
        chatId: 'c1',
        interactionId: 'i3',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'rm -rf /tmp/scratch',
        permissionMode: 'default',
      }),
    );
    expect(state.pendingInteraction).toEqual({
      kind: 'permission',
      interactionId: 'i3',
      toolName: 'Bash',
      permissionType: 'shell_exec',
      description: 'Run a shell command',
      inputSummary: 'rm -rf /tmp/scratch',
      permissionMode: 'default',
    });
  });

  it('clears pendingInteraction on chat.permission.resolved', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.permission.requested', { interactionId: 'i3', toolName: 'Bash' }),
    );
    state = reduceEvent(state, evt('chat.permission.resolved', { interactionId: 'i3', behavior: 'allow' }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('clears pendingInteraction on chat.permission.expired', () => {
    let state = reduceEvent(
      emptyTimeline(),
      evt('chat.permission.requested', { interactionId: 'i3', toolName: 'Bash' }),
    );
    state = reduceEvent(state, evt('chat.permission.expired', { interactionId: 'i3', reason: 'turn ended' }));
    expect(state.pendingInteraction).toBeNull();
  });

  it('a question gate is not accidentally cleared by a permission-kind clearing event, and vice versa', () => {
    let state = reduceEvent(emptyTimeline(), evt('chat.question.asked', { interactionId: 'i2', questions: [] }));
    state = reduceEvent(state, evt('chat.permission.resolved', { interactionId: 'i2', behavior: 'allow' }));
    expect(state.pendingInteraction).not.toBeNull();
  });
});

// Phase 6 item 3 — background-task visibility. Fields verified against the
// real producer, `packages/core/src/services/orchestrator/OrchestratorService.ts`.
describe('reduceEvent — chat.background_task.*', () => {
  it('renders a spawn notice', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.background_task.spawned', { taskId: 'bg1', taskName: 'refactor-auth' }),
    );
    expect(state.items[0]).toMatchObject({ kind: 'notice', text: 'Background task spawned: refactor-auth' });
  });

  it('renders a status notice', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.background_task.status', { taskId: 'bg1', taskName: 'refactor-auth', status: 'running' }),
    );
    expect(state.items[0]).toMatchObject({ kind: 'notice', text: 'refactor-auth: running' });
  });

  it('renders a completion notice with its summary', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.background_task.completed', {
        taskId: 'bg1',
        taskName: 'refactor-auth',
        status: 'completed',
        summary: 'Migrated to OAuth.',
      }),
    );
    expect(state.items[0]).toMatchObject({
      kind: 'notice',
      text: 'Background task completed: refactor-auth — Migrated to OAuth.',
    });
  });

  it('renders a failure as an error card', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.background_task.failed', { taskId: 'bg1', taskName: 'refactor-auth', error: 'OOM' }),
    );
    expect(state.items[0]).toMatchObject({
      kind: 'error',
      level: 'error',
      text: 'Background task failed: refactor-auth: OOM',
    });
  });

  // `chat.background_task.failed` above is declared in `AgentEvent.ts` but
  // has zero real producers (`grep -r background_task.failed` across
  // `packages/core` returns nothing). The real failure path is
  // `OrchestratorService.ts` emitting `.completed` with `status: 'failed'`
  // once the idle-wait resolves after the worker's prompt rejects — that
  // must render as an error card too, not a plain "completed" info notice.
  it('renders a `.completed` event with status "failed" as an error card, not a success notice', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('chat.background_task.completed', {
        taskId: 'bg1',
        taskName: 'refactor-auth',
        status: 'failed',
        summary: 'Ran out of memory mid-refactor.',
      }),
    );
    expect(state.items[0]).toMatchObject({
      kind: 'error',
      level: 'error',
      text: 'Background task failed: refactor-auth — Ran out of memory mid-refactor.',
    });
  });
});

// ── Workspace / checkpoint events (Phase 7 item 2) ─────────────────
//
// `WorkspaceCheckpointService` has always emitted these correctly; until
// the `'workspace'` stream-broker scope existed they were fanned out to
// nobody, so no client could ever receive one. These pin the shapes the
// real emitter sends (`packages/core/src/services/WorkspaceCheckpointService.ts`).

describe('reduceEvent — workspace and checkpoint events', () => {
  it('bumps workspaceRevision on workspace.changed WITHOUT adding a timeline item', () => {
    // It fires on every debounced write burst during a turn — one line each
    // would bury a chat transcript in "files changed" noise carrying no
    // information a refreshed file list does not already have.
    const state = reduceEvent(
      emptyTimeline(),
      evt('workspace.changed', {
        workspaceId: 'ws-1',
        repoAlias: '.',
        changedPaths: ['a.ts'],
        stats: { files: 1, additions: 3, deletions: 0 },
      }),
    );
    expect(state.workspaceRevision).toBe(1);
    expect(state.items).toHaveLength(0);
  });

  it('keeps counting up, so a consumer can compare against what it last fetched at', () => {
    let state = emptyTimeline();
    for (let i = 0; i < 3; i++) state = reduceEvent(state, evt('workspace.changed', { workspaceId: 'ws-1' }));
    expect(state.workspaceRevision).toBe(3);
  });

  it('renders checkpoint.created with its label, and leaves the revision alone', () => {
    // Taking a checkpoint does not change the working tree — nothing to refetch.
    const state = reduceEvent(
      emptyTimeline(),
      evt('checkpoint.created', {
        workspaceId: 'ws-1',
        checkpointId: 'cp-1',
        repoAlias: 'main',
        checkpointKind: 'manual',
        label: 'before refactor',
      }),
    );
    expect(state.items[0]).toMatchObject({ kind: 'notice', complete: true });
    expect(state.items[0]?.text).toContain('before refactor');
    expect(state.items[0]?.text).toContain('main');
    expect(state.workspaceRevision).toBe(0);
  });

  it('falls back to the checkpoint kind when it has no label', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('checkpoint.created', { checkpointId: 'cp-1', repoAlias: 'main', checkpointKind: 'auto' }),
    );
    expect(state.items[0]?.text).toContain('auto');
  });

  it('reports a restore AND bumps the revision — a restore rewrites the working tree', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('checkpoint.restored', {
        workspaceId: 'ws-1',
        checkpointId: 'cp-1',
        repoAlias: 'main',
        preRestoreCheckpointId: 'cp-0',
        restoredCount: 4,
        deletedCount: 1,
        skipped: [],
      }),
    );
    expect(state.workspaceRevision).toBe(1);
    expect(state.items[0]?.text).toContain('Restored 4 file(s)');
    expect(state.items[0]?.text).toContain('deleted 1');
    expect(state.items[0]?.level).toBe('info');
  });

  it('warns when a restore skipped files rather than reporting a clean success', () => {
    const state = reduceEvent(
      emptyTimeline(),
      evt('checkpoint.restored', {
        restoredCount: 1,
        deletedCount: 0,
        skipped: [{ path: 'x.ts', reason: 'dirty' }],
      }),
    );
    expect(state.items[0]?.level).toBe('warn');
    expect(state.items[0]?.text).toContain('1 skipped');
  });
});
