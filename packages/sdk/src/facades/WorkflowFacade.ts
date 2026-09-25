// ────────────────────────────────────────────────────────────────
// WorkflowFacade — ai.workflows.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, WorkflowScriptLoader, IWorkflowRunRepository, WorkflowOrchestrator } from '@generatorai/core';
import type {
  PersistedEvent,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  WorkflowRun,
  StageDefinition,
  StageEdge,
} from '@generatorai/shared';

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  stages: Array<{
    localId: string;
    name: string;
    prompt: string;
    systemPrompt?: string;
    condition?: string;
    hooks?: Array<{
      phase: string;
      config: Record<string, unknown>;
    }>;
    harnessOverrides?: Record<string, unknown>;
  }>;
  // SDK-7: edges carry only an `edgeType` because the platform evaluates
  // CONDITIONS on the TARGET STAGE, not on edges. To make an edge conditional,
  // set the target stage's `condition` (an expression like
  // `variables.env == 'prod'`) on its stage input above — it is evaluated for
  // each inbound edge during routing. There is intentionally no per-edge
  // condition field (the data model has none).
  edges: Array<{
    fromStageLocalId: string;
    toStageLocalId: string;
    edgeType: 'on_success' | 'on_failure' | 'on_completion' | 'always';
  }>;
  variables?: Record<string, unknown>;
  sessionMode?: 'single' | 'per-stage' | 'auto';
  tags?: string[];
  projectId?: string;
}

export interface RunOptions {
  variables?: Record<string, unknown>;
  projectId?: string;
}

export interface OrchestrateOptions {
  variables?: Record<string, unknown>;
  projectId?: string;
  selectedCodebases?: string[];
  stageOverrides?: Array<Record<string, unknown>>;
}

export interface StreamOptions {
  fromSequence?: number;
}

const TERMINAL_KINDS = new Set([
  'workflow_run.completed',
  'workflow_run.failed',
  'workflow_run.cancelled',
]);

export class WorkflowFacade {
  constructor(
    private services: CoreServices,
    private runRepo: IWorkflowRunRepository,
    private orchestrator: WorkflowOrchestrator,
    private scriptLoader?: WorkflowScriptLoader,
  ) {}

  /**
   * Create a workflow definition with stages and edges in one call.
   * Stages are connected by `localId` references in edges.
   */
  async create(input: CreateWorkflowInput): Promise<WorkflowDefinitionWithStages> {
    // 1. Create definition (no stages/edges)
    const definition = await this.services.workflowDefinitionService.createDefinition({
      name: input.name,
      description: input.description,
      sessionMode: input.sessionMode,
      tags: input.tags,
      projectId: input.projectId,
    });

    // 2. Create stages, building localId → realId map
    const stageIdMap = new Map<string, string>();
    const stages: StageDefinition[] = [];
    for (const stageInput of input.stages) {
      const stage = await this.services.workflowDefinitionService.addStage({
        workflowDefinitionId: definition.id,
        name: stageInput.name,
        prompts: [{
          label: stageInput.name,
          text: stageInput.prompt,
          ...(stageInput.systemPrompt ? { systemPrompt: stageInput.systemPrompt } : {}),
        }],
        hooks: stageInput.hooks as never,
        condition: stageInput.condition
          ? { type: 'expression' as const, expression: stageInput.condition }
          : undefined,
      });
      stageIdMap.set(stageInput.localId, stage.id);
      stages.push(stage);
    }

    // 3. Create edges using the real stage IDs
    const edges: StageEdge[] = [];
    for (const edgeInput of input.edges) {
      const fromStageId = stageIdMap.get(edgeInput.fromStageLocalId);
      const toStageId = stageIdMap.get(edgeInput.toStageLocalId);
      if (!fromStageId) throw new Error(`Unknown stage localId: ${edgeInput.fromStageLocalId}`);
      if (!toStageId) throw new Error(`Unknown stage localId: ${edgeInput.toStageLocalId}`);

      const edge = await this.services.workflowDefinitionService.addEdge({
        workflowDefinitionId: definition.id,
        fromStageId,
        toStageId,
        edgeType: edgeInput.edgeType,
      });
      edges.push(edge);
    }

    return { ...definition, stages, edges };
  }

  /** List all workflow definitions */
  async list(): Promise<WorkflowDefinition[]> {
    return this.services.workflowDefinitionService.listDefinitions();
  }

  /** Get a workflow definition by ID (with stages and edges) */
  async get(definitionId: string): Promise<WorkflowDefinitionWithStages> {
    return this.services.workflowDefinitionService.getDefinitionWithStages(definitionId);
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
    } as never);
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
