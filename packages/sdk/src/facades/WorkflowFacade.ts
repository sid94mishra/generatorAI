// ────────────────────────────────────────────────────────────────
// WorkflowFacade — ai.workflows.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, WorkflowScriptLoader, IWorkflowRunRepository, WorkflowOrchestrator } from '@generatorai/core';
import type { PersistedEvent, WorkflowRun } from '@generatorai/shared';
import type {
  ValidationResult,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowGraph,
  WorkflowGraphInput,
} from '@generatorai/workflow-spec';

/** Anything with a `build()` that yields a graph — a `WorkflowBuilder` from `@generatorai/workflow-spec/builders`. */
export interface GraphSource {
  build(): WorkflowGraph;
}

export interface CreateWorkflowOptions {
  /**
   * Publish at once so it can run (default true). The SDK is an in-process
   * embedder; a draft can still start a test run (`run(id, { testRun: true })`).
   */
  publish?: boolean;
}

export interface RunOptions {
  variables?: Record<string, unknown>;
  projectId?: string;
  /** Run the working graph as a test version (the only way to run a draft). */
  testRun?: boolean;
}

export interface OrchestrateOptions {
  variables?: Record<string, unknown>;
  projectId?: string;
  selectedCodebases?: string[];
  /** Per-stage overrides, by stage key. */
  stageOverrides?: Array<{ stageKey: string; skip?: boolean; variables?: Record<string, unknown> }>;
  testRun?: boolean;
}

export interface StreamOptions {
  fromSequence?: number;
}

const TERMINAL_KINDS = new Set([
  'workflow_run.completed',
  'workflow_run.failed',
  'workflow_run.cancelled',
]);

const isGraphSource = (v: unknown): v is GraphSource => !!v && typeof (v as { build?: unknown }).build === 'function';

export class WorkflowFacade {
  constructor(
    private services: CoreServices,
    private runRepo: IWorkflowRunRepository,
    private orchestrator: WorkflowOrchestrator,
    private scriptLoader?: WorkflowScriptLoader,
  ) {}

  /**
   * Create a workflow definition from a whole graph (or a builder), through
   * the one materializer. Invalid graphs throw `WorkflowValidationError`
   * with the validator's issues.
   */
  async create(graph: WorkflowGraphInput | GraphSource, options: CreateWorkflowOptions = {}): Promise<WorkflowDefinitionRecord> {
    return this.services.workflowDefinitionService.createFromSpec(isGraphSource(graph) ? graph.build() : graph, {
      canEditCommands: true,
      status: options.publish === false ? 'draft' : 'published',
    });
  }

  /** Replace a definition's whole graph (409 `RevisionConflictError` on a stale revision). */
  async save(definitionId: string, graph: WorkflowGraphInput, expectedRevision: number): Promise<WorkflowDefinitionRecord> {
    return this.services.workflowDefinitionService.saveGraph(definitionId, graph, expectedRevision, { canEditCommands: true });
  }

  /** Publish the working graph as the version runs use. */
  async publish(definitionId: string): Promise<WorkflowDefinitionRecord> {
    return this.services.workflowDefinitionService.publish(definitionId);
  }

  /** Validate a document without storing it. */
  validate(graph: unknown): ValidationResult {
    return this.services.workflowDefinitionService.validate(graph);
  }

  /** List workflow definitions (first page, up to 200). */
  async list(): Promise<WorkflowDefinitionSummary[]> {
    return (await this.services.workflowDefinitionService.list()).items;
  }

  /** Get a workflow definition (its whole graph). */
  async get(definitionId: string): Promise<WorkflowDefinitionRecord> {
    return this.services.workflowDefinitionService.get(definitionId);
  }

  /**
   * Create a workflow run record WITHOUT executing it. Use this when you want
   * to stage a run and start it later. To create AND execute in one call, use
   * `run()`.
   */
  async createRun(definitionId: string, options?: RunOptions): Promise<WorkflowRun> {
    return this.services.workflowRunService.createRun({
      workflowDefinitionId: definitionId,
      variables: options?.variables,
      projectId: options?.projectId,
      ...(options?.testRun ? { testRun: true } : {}),
    });
  }

  /**
   * SDK-6: Create a run AND start executing the DAG (PATH B).
   *
   * Previously `run()` only created the record and never executed — a foot-gun
   * next to `orchestrate()`. It now creates the run then calls `startRun`, so
   * `run()` does what its name implies. For the heavier envelope (clone /
   * worktrees / preprocessing / post-processing) use `orchestrate()`. To create
   * a run without starting it, use `createRun()`.
   *
   * Returns the run record; execution proceeds in the background — use
   * `stream(runId)` to observe progress.
   */
  async run(definitionId: string, options?: RunOptions): Promise<WorkflowRun> {
    const run = await this.services.workflowRunService.createRun({
      workflowDefinitionId: definitionId,
      variables: options?.variables,
      projectId: options?.projectId,
      ...(options?.testRun ? { testRun: true } : {}),
    });
    await this.services.workflowRunService.startRun(run.id);
    return run;
  }

  /**
   * Start an orchestrated workflow run (full DAG execution).
   *
   * Unlike `run()` which only creates the record, `orchestrate()` triggers
   * the complete pipeline: preprocessing → DAG scheduling → stage execution →
   * result validation → hooks. Events are emitted throughout.
   *
   * Returns the run ID immediately; execution happens in the background.
   * Use `stream(runId)` to observe progress.
   */
  async orchestrate(definitionId: string, options?: OrchestrateOptions): Promise<{ workflowRunId: string }> {
    const result = await this.orchestrator.startOrchestratedRun({
      workflowDefinitionId: definitionId,
      variables: options?.variables,
      projectId: options?.projectId,
      selectedCodebases: options?.selectedCodebases,
      stageOverrides: options?.stageOverrides,
      ...(options?.testRun ? { testRun: true } : {}),
    });
    return { workflowRunId: result.workflowRunId };
  }

  /**
   * Stream events from a running workflow (AsyncIterable).
   *
   * Subscribes for live events and completes when the run reaches a
   * terminal state. A run that is already terminal completes immediately:
   * history is read through the run stream scope (`/api/stream?scope=run`)
   * on the server.
   */
  async *stream(runId: string, options?: StreamOptions): AsyncGenerator<PersistedEvent> {
    const fromSeq = options?.fromSequence ?? 0;

    // Check if run is already in a terminal state
    const run = await this.runRepo.getById(runId);
    if (!run) throw new Error(`Workflow run not found: ${runId}`);

    // Already terminal: nothing more will be emitted for it.
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return;

    // Subscribe for live events
    const queue: PersistedEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const unsub = this.services.eventBus.subscribeToWorkflowRun(runId, (persisted) => {
      if (persisted.sequenceId < fromSeq) return;
      queue.push(persisted);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    try {
      while (!done) {
        if (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          if (TERMINAL_KINDS.has(event.kind)) {
            done = true;
          }
        } else {
          await new Promise<void>((r) => { resolve = r; });
        }
      }
    } finally {
      unsub();
    }
  }

  /** Pause a running workflow */
  async pause(runId: string): Promise<void> {
    return this.services.workflowRunService.pauseRun(runId);
  }

  /** Resume a paused workflow */
  async resume(runId: string): Promise<void> {
    return this.services.workflowRunService.resumeRun(runId);
  }

  /** Cancel a workflow */
  async cancel(runId: string): Promise<void> {
    return this.services.workflowRunService.cancelRun(runId);
  }

  /** Get current status of a run */
  async status(runId: string): Promise<WorkflowRun> {
    return this.runRepo.getById(runId);
  }

  /** Retry a failed run */
  async retry(runId: string): Promise<WorkflowRun> {
    return this.services.workflowRunService.retryRun(runId);
  }

  /** Delete a run */
  async deleteRun(runId: string): Promise<void> {
    return this.services.workflowRunService.deleteRun(runId);
  }
}
