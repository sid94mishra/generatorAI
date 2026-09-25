// ────────────────────────────────────────────────────────────────
// WorkflowOrchestrator — Item 10: post-processing (auto-commit/auto-PR)
// survives a run that completes before the listener attaches, and
// re-arms after a restart via the persisted intent.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { WorkflowOrchestrator } from '../src/services/WorkflowOrchestrator.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import {
  MockWorkflowDefinitionStore,
  MockWorkflowRunRepository,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import type {
  OrchestratorContext,
  PreprocessingResult,
  AgentEvent,
  PersistedEvent,
  ILogger,
} from '@generatorai/shared';

/** Minimal in-process pub/sub matching the two EventBus methods the orchestrator uses. */
class FakeEventBus {
  private handlers: Array<(event: PersistedEvent) => void | Promise<void>> = [];
  emitted: AgentEvent[] = [];

  subscribeGlobal(handler: (event: PersistedEvent) => void | Promise<void>): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async emitGlobal(event: AgentEvent): Promise<void> {
    this.emitted.push(event);
    const persisted = { ...event, seq: this.emitted.length, timestamp: new Date() } as unknown as PersistedEvent;
    for (const handler of [...this.handlers]) {
      await handler(persisted);
    }
  }
}

function makeLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

/** A graph whose lifecycle asks for an auto-commit. */
function autoCommitGraph(): WorkflowGraph {
  return testGraph(['a'], [], { lifecycle: { postProcessing: { autoCommit: true } } });
}

/** The orchestrator's in-memory definition shape: the pinned graph's workflow section plus the definition id. */
type RunDefinition = { id: string } & WorkflowGraph['workflow'];

function makeDefinition(): RunDefinition {
  return { id: 'def-1', ...autoCommitGraph().workflow };
}

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    workflowRunId: 'run-1',
    workflowDefinitionId: 'def-1',
    clonedRepositories: { main: '/tmp/main' },
    featureBranches: {},
    resolvedVariables: {},
    preprocessingResults: [],
    postProcessingResults: [],
    ...overrides,
  };
}

describe('WorkflowOrchestrator — post-processing durability (Item 10)', () => {
  let runRepo: MockWorkflowRunRepository;
  let eventBus: FakeEventBus;
  let executePostProcessing: ReturnType<typeof vi.fn>;
  let orchestrator: WorkflowOrchestrator;
  let getVersion: MockInstance<MockWorkflowDefinitionStore['getVersion']>;
  let versionId: string;

  beforeEach(async () => {
    runRepo = new MockWorkflowRunRepository();
    const store = new MockWorkflowDefinitionStore();
    ({ versionId } = await seedDefinition(store, autoCommitGraph(), 'def-1'));
    getVersion = vi.spyOn(store, 'getVersion');
    eventBus = new FakeEventBus();
    executePostProcessing = vi.fn(
      async (): Promise<PreprocessingResult[]> => [
        { stepName: 'Auto-commit changes', success: true, durationMs: 5 },
      ],
    );
    const workflowRunServiceStub = {} as unknown as ConstructorParameters<typeof WorkflowOrchestrator>[0];
    const definitionServiceStub = {} as unknown as ConstructorParameters<typeof WorkflowOrchestrator>[1];
    const preprocessorStub = { executePostProcessing } as unknown as ConstructorParameters<typeof WorkflowOrchestrator>[3];

    orchestrator = new WorkflowOrchestrator(
      workflowRunServiceStub,
      definitionServiceStub,
      new RunDefinitionReader(store),
      preprocessorStub,
      runRepo,
      eventBus as unknown as ConstructorParameters<typeof WorkflowOrchestrator>[5],
      makeLogger(),
      "/tmp/gai-art",
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      null,
    );
  });

  it('post-processes a run that is ALREADY terminal by the time the listener attaches', async () => {
    // Simulates the exact race Item 10 closes: the run finished (and its
    // completion event already fired) before `setupCompletionCleanup`
    // subscribed. No event will ever come again — the immediate terminal
    // check is the only thing that can still catch this run.
    const run = await runRepo.create({
      id: 'run-fast',
      workflowDefinitionId: 'def-1',
      definitionVersionId: versionId,
      name: 'fast run',
      status: 'completed',
      sessionMode: 'auto',
      variables: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const definition = makeDefinition();
    const context = makeContext({ workflowRunId: run.id });

    // Private, but this IS the unit under test for the race itself.
    await (orchestrator as unknown as {
      setupCompletionCleanup: (
        runId: string,
        context: OrchestratorContext,
        definition: RunDefinition,
        runWorkspaceDir: string,
      ) => Promise<void>;
    }).setupCompletionCleanup(run.id, context, definition, '/tmp/ws');

    expect(executePostProcessing).toHaveBeenCalledOnce();
    expect(eventBus.emitted.some((e) => e.kind === 'workflow_run.postprocessing_completed')).toBe(true);
    expect(eventBus.emitted.some((e) => e.kind === 'workflow_run.orchestration_completed')).toBe(true);
  });

  it('still reacts to a LATER completion event for a run that is not yet terminal', async () => {
    const run = await runRepo.create({
      id: 'run-slow',
      workflowDefinitionId: 'def-1',
      definitionVersionId: versionId,
      name: 'slow run',
      status: 'running',
      sessionMode: 'auto',
      variables: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const definition = makeDefinition();
    const context = makeContext({ workflowRunId: run.id });

    await (orchestrator as unknown as {
      setupCompletionCleanup: (
        runId: string,
        context: OrchestratorContext,
        definition: RunDefinition,
        runWorkspaceDir: string,
      ) => Promise<void>;
    }).setupCompletionCleanup(run.id, context, definition, '/tmp/ws');

    expect(executePostProcessing).not.toHaveBeenCalled();

    await eventBus.emitGlobal({
      kind: 'workflow_run.completed',
      data: { workflowRunId: run.id },
    } as AgentEvent);

    expect(executePostProcessing).toHaveBeenCalledOnce();
  });

  describe('reArmPendingPostProcessing (boot-time recovery)', () => {
    it('post-processes a run whose intent is still pending', async () => {
      await runRepo.create({
        id: 'run-restart',
        workflowDefinitionId: 'def-1',
        definitionVersionId: versionId,
        name: 'restarted run',
        status: 'completed',
        sessionMode: 'auto',
        variables: {
          __postProcessingIntent: {
            pending: true,
            runWorkspaceDir: '/tmp/ws',
            clonedRepositories: { main: '/tmp/main' },
            featureBranches: {},
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await orchestrator.reArmPendingPostProcessing();

      // The definition comes from the run's pinned version.
      expect(getVersion).toHaveBeenCalledWith(versionId);
      expect(executePostProcessing).toHaveBeenCalledOnce();

      // The intent is cleared once handled, so a second boot doesn't redo it.
      const updated = await runRepo.getById('run-restart');
      expect((updated.variables as Record<string, unknown>)['__postProcessingIntent']).toBeUndefined();
    });

    it('leaves a run with no pending intent untouched', async () => {
      await runRepo.create({
        id: 'run-normal',
        workflowDefinitionId: 'def-1',
        definitionVersionId: versionId,
        name: 'normal run',
        status: 'completed',
        sessionMode: 'auto',
        variables: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await orchestrator.reArmPendingPostProcessing();

      expect(executePostProcessing).not.toHaveBeenCalled();
    });

    it('re-arming twice is idempotent (second pass is a no-op)', async () => {
      await runRepo.create({
        id: 'run-twice',
        workflowDefinitionId: 'def-1',
        definitionVersionId: versionId,
        name: 'twice run',
        status: 'completed',
        sessionMode: 'auto',
        variables: {
          __postProcessingIntent: {
            pending: true,
            runWorkspaceDir: '/tmp/ws',
            clonedRepositories: { main: '/tmp/main' },
            featureBranches: {},
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await orchestrator.reArmPendingPostProcessing();
      expect(executePostProcessing).toHaveBeenCalledOnce();

      await orchestrator.reArmPendingPostProcessing();
      expect(executePostProcessing).toHaveBeenCalledOnce(); // still once — not called again
    });
  });
});
