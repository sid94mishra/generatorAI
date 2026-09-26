// ────────────────────────────────────────────────────────────────
// WorkflowFacade — ai.workflows.*
//
// A run starts through THE invocation (P04): `invoke`, and its shorthands
// `run` (a definition) and `fork` (a terminal run). The trigger is
// `external_agent via sdk`; the run goes through the same lifecycle as every
// other entry point.
// ────────────────────────────────────────────────────────────────

import {
  RunCommandRefusedError,
  type CoreServices,
  type IEventRepository,
  type InvocationContext,
  type WorkflowScriptLoader,
  type IWorkflowRunRepository,
  type StageGateAnswer,
  type StageMessage,
  type StageSendOutcome,
} from '@generatorai/core';
import type { PersistedEvent, WorkflowRun } from '@generatorai/shared';
import type {
  InvocationPlan,
  InvocationRequest,
  InvocationResult,
  RunCommand,
  RunDigest,
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

/** `run()`'s options: everything an invocation takes but its target. */
export type RunOptions = Partial<Omit<InvocationRequest, 'target' | 'client'>> & {
  /** Run the working graph as a test version (the only way to run a draft). */
  testRun?: boolean;
};

export interface StreamOptions {
  fromSequence?: number;
}

/** The in-process SDK caller: an external agent over the SDK, trusted like the local owner. */
export const SDK_INVOCATION_CONTEXT: InvocationContext = {
  principal: { kind: 'local', id: 'sdk', scopes: ['exec:agent', 'read:workflows', 'write:workflows', 'admin:settings'] },
  trigger: { kind: 'external_agent', via: 'sdk', principalId: 'sdk' },
  loopback: true,
};

const isGraphSource = (v: unknown): v is GraphSource => !!v && typeof (v as { build?: unknown }).build === 'function';

export class WorkflowFacade {
  constructor(
    private services: CoreServices,
    private runRepo: IWorkflowRunRepository,
    private eventRepo: IEventRepository,
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
  validate(graph: unknown): Promise<ValidationResult> {
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

  // ── Starting runs (one invocation path) ──────────────────────

  /**
   * Start a run: a definition, a script or a fork of a terminal run. Throws
   * `InvocationError` (a code and the issues behind it). Resolves once the
   * run is starting; follow it with `waitFor`, `digest` or `stream`.
   */
  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    return this.services.workflowInvocationService.invoke({ ...request, client: 'sdk' }, SDK_INVOCATION_CONTEXT);
  }

  /** Run a definition: `invoke({target: {kind: 'definition', …}, …options})`. */
  async run(definitionId: string, options: RunOptions = {}): Promise<InvocationResult> {
    const { testRun, variables, ...rest } = options;
    return this.invoke({
      target: { kind: 'definition', workflowDefinitionId: definitionId, ...(testRun ? { testRun: true } : {}) },
      variables: variables ?? {},
      ...rest,
    });
  }

  /** What an invocation would do, without writing anything. */
  async plan(request: InvocationRequest): Promise<InvocationPlan> {
    return this.services.workflowInvocationService.plan({ ...request, client: 'sdk' }, SDK_INVOCATION_CONTEXT);
  }

  /**
   * Re-run a terminal run as a NEW run (the source stays as it ended): an
   * invocation with a fork target. By default every instance that did not
   * complete runs again; completed ones are copied with their results.
   */
  async fork(
    runId: string,
    request: {
      rerunFrom?: string[];
      definition?: 'pinned' | 'latest';
      workspace?: 'restore_checkpoint' | 'reuse' | 'fresh';
      variables?: Record<string, unknown>;
    } = {},
  ): Promise<InvocationResult> {
    return this.invoke({
      target: {
        kind: 'fork',
        sourceRunId: runId,
        ...(request.rerunFrom ? { rerunFrom: request.rerunFrom } : {}),
        definition: request.definition ?? 'pinned',
        workspace: request.workspace ?? 'fresh',
      },
      variables: request.variables ?? {},
    });
  }

  /** Wait for the run to finalize (post-processing done), an approval (`stopOnApproval`) or the timeout. */
  async waitFor(runId: string, opts: { timeoutMs: number; stopOnApproval?: boolean; signal?: AbortSignal }): Promise<RunDigest> {
    return this.services.workflowInvocationService.waitFor(runId, opts);
  }

  /** The run's compact state (status, stages, pending approvals, post-processing). */
  async digest(runId: string, opts?: { detail?: 'brief' | 'full' }): Promise<RunDigest> {
    return this.services.workflowInvocationService.digest(runId, opts);
  }

  /**
   * The run's events (AsyncIterable): the run scope replayed from the event
   * log (from `fromSequence` on), then live events, until
   * `workflow_run.finalized`. It subscribes before it reads, so an event in
   * between is not lost.
   */
  async *stream(runId: string, options?: StreamOptions): AsyncGenerator<PersistedEvent> {
    const fromSeq = options?.fromSequence ?? 0;
    await this.runRepo.getById(runId);
    const queue: PersistedEvent[] = [];
    let wake: (() => void) | null = null;
    const unsub = this.services.eventBus.subscribeToWorkflowRun(runId, (persisted) => {
      queue.push(persisted);
      const w = wake;
      wake = null;
      w?.();
    });
    const seen = new Set<string>();
    const keyOf = (e: PersistedEvent) => `${e.sessionId}:${e.sequenceId}:${e.kind}`;
    try {
      for (const event of await this.eventRepo.getByWorkflowRunId(runId)) {
        if (event.sequenceId < fromSeq) continue;
        seen.add(keyOf(event));
        yield event;
        if (event.kind === 'workflow_run.finalized') return;
      }
      const run = await this.runRepo.getById(runId);
      if (['completed', 'failed', 'cancelled'].includes(run.status) && queue.every((e) => seen.has(keyOf(e)))) return;
      for (;;) {
        const event = queue.shift();
        if (!event) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (seen.has(keyOf(event)) || event.sequenceId < fromSeq) continue;
        yield event;
        if (event.kind === 'workflow_run.finalized') return;
      }
    } finally {
      unsub();
    }
  }

  // ── A run in flight ──────────────────────────────────────────

  /**
   * An operator command on the run or one of its instances: pause, resume,
   * cancel, retry, skip, fail, approve (the engine's commands API). Throws
   * when the engine refuses it.
   */
  async command(runId: string, command: RunCommand): Promise<void> {
    const r = await this.services.workflowRunService.command(runId, command);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }

  /**
   * Send an operator message to a stage instance (a stage is a compact
   * chat): queued between turns, an amendment of a completed stage (its
   * output replaced; successors are not re-run), a retry of a paused one.
   * Throws `StageConversationError` (`STAGE_BUSY` mid-turn,
   * `INTERACTION_PENDING` on an open gate, …).
   */
  async sendToStage(runId: string, instanceId: string, message: StageMessage): Promise<StageSendOutcome> {
    return (await this.services.stageConversationService.send(runId, instanceId, message)).outcome;
  }

  /** Stop a stage's turn in flight without failing the stage. */
  stopStageTurn(runId: string, instanceId: string, opts?: { force?: boolean }): void {
    this.services.stageConversationService.cancelTurn(runId, instanceId, opts);
  }

  /** Answer the in-turn gate (tool permission, question, plan review) a stage is waiting on. */
  async answerStageGate(runId: string, instanceId: string, interactionId: string, answer: StageGateAnswer): Promise<void> {
    await this.services.stageConversationService.resolveInteraction(runId, instanceId, interactionId, answer);
  }

  /** Get current status of a run */
  async status(runId: string): Promise<WorkflowRun> {
    return this.runRepo.getById(runId);
  }

  /** Delete a run */
  async deleteRun(runId: string): Promise<void> {
    return this.services.workflowRunService.deleteRun(runId);
  }

  /** The loaded script loader, if the SDK discovered scripts. */
  get scripts(): WorkflowScriptLoader | undefined {
    return this.scriptLoader;
  }
}
