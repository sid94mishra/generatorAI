// ────────────────────────────────────────────────────────────────
// createCoreServices — shared factory for the repository + service graph
//
// Both `apps/server` and `apps/cli` (direct mode) need the same core
// wiring: every repo, EventBus, hooks, session services,
// automation. Before Phase 1 each app duplicated ~180 lines of DI; a
// signature change meant two parallel edits. This factory centralizes
// that surface so changes land in one place.
//
// Every dependency the workflow services need is a REQUIRED input (P01
// WP-1.3): the durable repos, the workspace manager, the admission
// controller, the source-control flow and the engine's stores. Both roots
// (server and SDK) pass them, so no service carries an "absent dependency"
// fallback. Platform-specific concerns (harness adapter construction,
// provider choice, HTTP streaming, graceful shutdown) stay in the app's
// own composition-root.
// ────────────────────────────────────────────────────────────────

import type { ILogger, AgentEvent, AgentOverrides, HarnessConfig } from '@generatorai/shared';
import type {
  ISessionRepository,
  IEventRepository,
  IChatMessageRepository,
  IArtifactRepository,
  IChatRepository,
  IWorkflowDefinitionStore,
  IWorkflowRunRepository,
  IStageRunRepository,
  IAgentHarness,
  IScriptRunner,
  IHttpClient,
  ISequenceAllocator,
} from '../domain/ports/index.js';
import type { EngineStores } from '../domain/ports/IEngineStore.js';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from '../services/AutomationService.js';
import type { IIdempotencyKeyRepository } from '../services/AutomationRecoveryService.js';

import { EventBus } from '../events/EventBus.js';
import { ArtifactService } from '../services/ArtifactService.js';
import { HookExecutor } from '../services/HookExecutor.js';
import { HookInterceptor } from '../services/HookInterceptor.js';
import { SessionHookRegistry } from '../services/SessionHookRegistry.js';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import { ErrorHandler } from '../services/ErrorHandler.js';
import { ChatManagementService } from '../services/ChatManagementService.js';
import type { ChatManagementServiceExtensions } from '../services/ChatManagementService.js';
import { SessionComposer } from '../services/session/SessionComposer.js';
import { TurnContextRegistry } from '../services/session/gates.js';
import { resolverLayer } from '../services/session/agentProjection.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../services/orchestrator/OrchestratorService.js';
import type { OrchestratorConfig } from '../services/orchestrator/OrchestratorService.js';
import { WorkflowDefinitionService } from '../services/WorkflowDefinitionService.js';
import { RunDefinitionReader } from '../services/definitions/RunDefinitionReader.js';
import { WorkflowRunService } from '../services/WorkflowRunService.js';
import { RunSupervisor, type SupervisorTiming } from '../services/engine/RunSupervisor.js';
import { StageConversationService } from '../services/engine/StageConversationService.js';
import type { OutboxPublisher } from '../services/engine/OutboxDispatcher.js';
import type { DecideRecord } from '../services/engine/RunActor.js';
import { AutomationService } from '../services/AutomationService.js';
import { AutomationRecoveryService } from '../services/AutomationRecoveryService.js';
import { HitlService } from '../services/HitlService.js';
import { AgentInteractionService } from '../services/AgentInteractionService.js';
import { PlanService } from '../services/PlanService.js';
import { DurableExecutionEngine } from '../services/DurableExecutionEngine.js';
import { WorkflowPreprocessor, type WorkflowScmFlowPort } from '../services/WorkflowPreprocessor.js';
import type { WorkspaceManager } from '../services/WorkspaceManager.js';
import type { AdmissionController } from '../services/AdmissionController.js';
import type { RegisterRepository, EntryRepository } from '@generatorai/db';
import type { AgentService } from '../services/AgentService.js';
import type { AgentResolver } from '../services/AgentResolver.js';
import type { AgentStagingService } from '../services/AgentStagingService.js';
import type { IPlanRepository, IAgentInteractionRepository } from '../domain/ports/IPlanRepository.js';
import type { GitManager } from '../infrastructure/GitManager.js';

/**
 * Inputs that both composition-roots already have by the time they wire
 * core services: infra adapters (db+repos), the harness port, the sandboxed
 * script runner, HTTP client, git manager, and an optional transaction
 * wrapper (for multi-row writes in WorkflowRunService / AutomationService).
 */
export interface CoreServicesInputs {
  logger: ILogger;
  harness: IAgentHarness;
  scriptRunner: IScriptRunner;
  httpClient: IHttpClient;
  gitManager: GitManager;
  sequenceAllocator: ISequenceAllocator;

  // Session/workflow repositories
  sessionRepo: ISessionRepository;
  eventRepo: IEventRepository;
  chatMessageRepo: IChatMessageRepository;
  artifactRepo: IArtifactRepository;

  // DAG/run repositories
  chatEntityRepo: IChatRepository;
  /** Workflow definitions as v2 documents (P01 WP-1.7). */
  workflowDefinitionStore: IWorkflowDefinitionStore;
  workflowRunRepo: IWorkflowRunRepository;
  stageRunRepo: IStageRunRepository;

  // Automation repositories
  automationRepo: IAutomationRepository;
  automationExecutionRepo: IAutomationExecutionRepository;
  /** Track A3 — repository backing the idempotency-key store. Optional
   *  because tests that don't exercise triggers can leave it out. */
  idempotencyKeyRepo?: IIdempotencyKeyRepository;

  /** The workflow engine's stores over the same database (`createEngineStores(db)`). */
  engineStores: EngineStores;
  /**
   * The harness boundary of the engine (P03 WP-3.4): a provider failure
   * becomes a `HarnessError`. Core cannot import the providers package, so
   * the composition root passes `toHarnessError`.
   */
  toHarnessError: (provider: string | undefined, raw: unknown) => unknown;
  /**
   * Where the engine's outbox events go (G5 §5.8). Default:
   * `eventBus.emitGlobal`, awaited. The server also publishes them to the
   * run's stream scope, awaited.
   */
  publishEngineEvent?: OutboxPublisher;
  /** A label for the engine lock row (host, pid). */
  engineOwnerLabel?: string;
  /** Engine timing (tests compress it). */
  engineTiming?: Partial<SupervisorTiming>;
  /** Every committed decision batch (the testkit's replay fixtures, G5 §7.3). */
  engineOnDecide?: (record: DecideRecord) => void;

  /** Every run gets an execution workspace. */
  workspaceManager: WorkspaceManager;

  /** W18 — the lane every stage launch is admitted through. */
  admissionController: AdmissionController;

  /**
   * Post-processing commit/push/PR runs through the source-control flow
   * (doc §5) — the one the Changes tab and agent-native chats use.
   */
  scmFlow: WorkflowScmFlowPort;

  // Config
  config: {
    artifactsDir: string;
  };

  /** W22 / W47 — durable execution engine repositories. */
  registerRepo: RegisterRepository;
  entryRepo: EntryRepository;

  /**
   * The platform services every agent session is built with — chats AND
   * workflow stages share this object (the session composer's deps), by
   * reference, so services wired into it after the graph is built reach both.
   */
  chatExtensions?: ChatManagementServiceExtensions;
  /**
   * PLN-01 — plan mode. Both are optional so existing embedders keep working;
   * when omitted, plan mode is simply unavailable.
   */
  planRepo?: IPlanRepository;
  agentInteractionRepo?: IAgentInteractionRepository;

  /**
   * AGT-01 — first-class agents. Supplied pre-constructed because
   * `AgentService` needs an artifact catalog and a model-list probe, both of
   * which are platform concerns the composition-root already owns. When
   * omitted, agent bindings simply do not resolve and every surface behaves
   * exactly as it did before agents existed.
   */
  agentResolver?: AgentResolver;
  agentService?: AgentService;
  agentStaging?: AgentStagingService;
}

/**
 * The full core service graph. Apps layer platform-specific services on top
 * (orchestrator routes, sandbox lifecycle, stream manager, etc.).
 */
export interface CoreServices {
  eventBus: EventBus;
  templateRegistry: TemplateRegistry;
  hookExecutor: HookExecutor;
  hookInterceptor: HookInterceptor;
  /**
   * In-process hooks every agent session runs (W-54). The composition root
   * turns it into the composer's `buildHookBridge` and feeds it extension hooks.
   */
  sessionHookRegistry: SessionHookRegistry;

  // Session/workflow services
  artifactService: ArtifactService;
  errorHandler: ErrorHandler;

  // Workflow execution services
  chatManagementService: ChatManagementService;
  /** Builds every agent session (chats and stages). */
  sessionComposer: SessionComposer;
  orchestratorService: OrchestratorService;
  workflowDefinitionService: WorkflowDefinitionService;
  /** The graph of each run's pinned definition version. */
  runDefinitionReader: RunDefinitionReader;
  /**
   * THE workflow engine (P03): actors, `decide()`, the executor, timers,
   * lease reaper, outbox and recovery. The composition root calls `start()`
   * at boot (it takes the single-engine lock and recovers) and `stop()` at
   * shutdown.
   */
  engine: RunSupervisor;
  workflowRunService: WorkflowRunService;
  /** The stage conversation API (P03b): messages, turn stops, amendments and gate answers of stage instances. */
  stageConversationService: StageConversationService;

  // Automation
  automationService: AutomationService;
  /** Track A — boot reconciler + idempotency-key sweeper. May be null
   *  when the caller didn't supply an idempotency repository. */
  automationRecoveryService: AutomationRecoveryService | null;

  /** HITL — the operator side of parked stage instances. */
  hitlService: HitlService;
  /** W22 — Durable execution engine (§3.4 / P0-41 / X-23 fix). */
  durableExecutionEngine: DurableExecutionEngine;
  /** Preprocessing + post-processing steps of orchestrated runs. */
  workflowPreprocessor: WorkflowPreprocessor;
  /** PLN-01 — present only when the plan repositories were supplied. */
  planService?: PlanService;
  agentInteractionService?: AgentInteractionService;
  /** AGT-01 — present only when the caller supplied them. */
  agentService?: AgentService;
  agentResolver?: AgentResolver;
  agentStaging?: AgentStagingService;
}

export function createCoreServices(inputs: CoreServicesInputs): CoreServices {
  const {
    logger,
    harness,
    scriptRunner,
    httpClient,
    gitManager,
    sessionRepo,
    eventRepo,
    chatMessageRepo,
    artifactRepo,
    chatEntityRepo,
    workflowDefinitionStore,
    workflowRunRepo,
    stageRunRepo,
    automationRepo,
    automationExecutionRepo,
    idempotencyKeyRepo,
    sequenceAllocator,
    workspaceManager,
    admissionController,
    scmFlow,
    config,
    registerRepo,
    entryRepo,
  } = inputs;

  // ── Events ──
  const eventBus = new EventBus(eventRepo, logger, sequenceAllocator);

  // ── Config / Templates ──
  const templateRegistry = new TemplateRegistry(logger);

  // ── Hooks ──
  const hookExecutor = new HookExecutor(scriptRunner, httpClient, eventBus);
  const hookInterceptor = new HookInterceptor(hookExecutor, eventBus);
  const sessionHookRegistry = new SessionHookRegistry(hookExecutor);

  // ── Session services ──
  const artifactService = new ArtifactService(artifactRepo, config.artifactsDir);

  const errorHandler = new ErrorHandler(eventBus, logger);

  // ONE session composer for chats and stages (P02). The extensions object is
  // shared by reference: composition roots wire several services into it
  // after the graph is built, and both owners see them.
  const sessionExtensions: ChatManagementServiceExtensions = inputs.chatExtensions ?? {};
  const sessionComposer = new SessionComposer(sessionExtensions, harness, new TurnContextRegistry());
  const chatManagementService = new ChatManagementService(
    chatEntityRepo,
    sessionRepo,
    chatMessageRepo,
    harness,
    eventBus,
    sessionExtensions,
    sessionComposer,
  );

  // PLN-01 — plan mode. Late-bound into the (by-reference) chat extensions so
  // createChat/buildConversationConfig can install the plan + question gates.
  let planService: PlanService | undefined;
  let agentInteractionService: AgentInteractionService | undefined;
  if (inputs.planRepo && inputs.agentInteractionRepo) {
    planService = new PlanService(inputs.planRepo, logger);
    agentInteractionService = new AgentInteractionService(
      inputs.agentInteractionRepo,
      // Interaction lifecycle → EventBus.
      //
      // This is REQUIRED, not optional telemetry: when a gate dies without a
      // user decision (server restart, timeout, cancel) the card in the
      // transcript must be told, otherwise it sits on "pending" forever and
      // the user's answer comes back 409. We also emit `harness.idle` so the
      // composer unblocks — the SDK turn that was blocked on the gate is gone.
      async (event) => {
        if (event.type !== 'expired') return;
        const record = await inputs.agentInteractionRepo!
          .findById(event.interactionId)
          .catch(() => null);
        const sessionId = record?.sessionId;
        const chatId = record?.chatId ?? event.chatId;
        if (!sessionId || !chatId) return;

        if (record?.kind === 'plan_review') {
          const payload = (record.payload ?? {}) as { planId?: string };
          // The plan itself must stop asking for review too. Clients read
          // the plan list, not the gate, so a plan left `awaiting_review`
          // kept its Approve buttons after a restart and every tap came
          // back 409 with no way out but a new prompt.
          if (payload.planId && planService) {
            const plan = await planService.findById(payload.planId).catch(() => null);
            if (plan?.status === 'awaiting_review') {
              await planService.setStatus(plan.id, 'expired').catch(() => undefined);
            }
          }
          await eventBus.emit(sessionId, {
            kind: 'chat.plan.expired',
            data: { chatId, planId: payload.planId ?? '', interactionId: event.interactionId, reason: event.reason },
          } as AgentEvent);
        } else {
          await eventBus.emit(sessionId, {
            kind: 'chat.question.expired',
            data: { chatId, interactionId: event.interactionId, reason: event.reason },
          } as AgentEvent);
        }

        // The blocked provider callback is gone — release the UI.
        await eventBus.emit(sessionId, {
          kind: 'harness.idle',
          data: { chatId },
        } as unknown as AgentEvent);
      },
      logger,
    );
    sessionExtensions.planService = planService;
    sessionExtensions.agentInteractionService = agentInteractionService;
    // A pending chat gate blocks an in-memory SDK callback that did not
    // survive the restart, so it can never be honestly resumed.
    void agentInteractionService.expireOrphans().catch(() => undefined);
  }

  // Orchestrator mode — background-agent orchestration for Chat. Created after
  // ChatManagementService and late-bound both ways to break the cycle:
  //   OrchestratorService needs ChatManagementService (spawn/send prompts)
  //   ChatManagementService needs OrchestratorService (inject the tool set)
  const envInt = (name: string, fallback: number): number => {
    const v = process.env[name];
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const orchestratorConfig: OrchestratorConfig = {
    maxWorkers: envInt('GENERATORAI_ORCH_MAX_WORKERS', DEFAULT_ORCHESTRATOR_CONFIG.maxWorkers),
    maxReviewRounds: envInt('GENERATORAI_ORCH_MAX_REVIEW_ROUNDS', DEFAULT_ORCHESTRATOR_CONFIG.maxReviewRounds),
    defaultWorkerModel: process.env['GENERATORAI_ORCH_DEFAULT_WORKER_MODEL'] || DEFAULT_ORCHESTRATOR_CONFIG.defaultWorkerModel,
    workerTimeoutMs: envInt('GENERATORAI_ORCH_WORKER_TIMEOUT_MS', DEFAULT_ORCHESTRATOR_CONFIG.workerTimeoutMs),
    warmFirst: process.env['GENERATORAI_ORCH_WARM_FIRST'] !== '0',
    // W24 / X-20: termination conditions, all overridable via env vars.
    maxWaves: envInt('GENERATORAI_ORCH_MAX_WAVES', DEFAULT_ORCHESTRATOR_CONFIG.maxWaves),
    timeBudgetMs: envInt('GENERATORAI_ORCH_TIME_BUDGET_MS', DEFAULT_ORCHESTRATOR_CONFIG.timeBudgetMs),
    convergenceThreshold: (() => {
      const v = process.env['GENERATORAI_ORCH_CONVERGENCE_THRESHOLD'];
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_ORCHESTRATOR_CONFIG.convergenceThreshold;
    })(),
  };
  const orchestratorService = new OrchestratorService(
    chatEntityRepo,
    sessionRepo,
    chatMessageRepo,
    harness,
    eventBus,
    orchestratorConfig,
  );
  orchestratorService.setChatManagementService(chatManagementService);
  // Late-bind into the chat extensions object (passed by reference) so
  // createChat can inject the orchestrator tool set for orchestrator chats.
  sessionExtensions.orchestratorService = orchestratorService;

  // Runs read their pinned definition version through one reader (W-13).
  const runDefinitionReader = new RunDefinitionReader(workflowDefinitionStore);
  const workflowDefinitionService = new WorkflowDefinitionService(workflowDefinitionStore, templateRegistry);

  // W22 — Durable execution engine (automations' iteration claims and awakeables).
  const durableExecutionEngine = new DurableExecutionEngine(registerRepo, entryRepo, logger);

  // AGT-01 — late-wire the agent graph exactly where the server's
  // composition-root does, so an SDK embedder that supplies the services gets
  // identical behaviour instead of a half-enabled feature.
  if (inputs.agentResolver) {
    sessionExtensions.agentResolver = inputs.agentResolver;
    if (inputs.agentStaging) sessionExtensions.agentStaging = inputs.agentStaging;
  }
  if (inputs.agentService) orchestratorService.setAgentService(inputs.agentService);

  // ── The workflow engine (P03) ──
  // The admission controller is its ONE concurrency gate (W-66). The PD-17
  // start check is the run facade's, built below (late-bound through the
  // closure).
  let workflowRunService!: WorkflowRunService;
  const engine = new RunSupervisor({
    stores: inputs.engineStores,
    runRepo: workflowRunRepo,
    definitions: runDefinitionReader,
    harness,
    composer: sessionComposer,
    sessionRepo,
    eventBus,
    workspaceManager,
    admission: admissionController,
    hookExecutor,
    planService,
    scriptRunner,
    toHarnessError: inputs.toHarnessError,
    artifacts: artifactService,
    ...(inputs.publishEngineEvent ? { publish: inputs.publishEngineEvent } : {}),
    permissionCheck: (run, graph) => workflowRunService.assertPermissionGating(run, graph),
    ...(inputs.engineOwnerLabel ? { ownerLabel: inputs.engineOwnerLabel } : {}),
    ...(inputs.engineTiming ? { timing: inputs.engineTiming } : {}),
    ...(inputs.engineOnDecide ? { onDecide: inputs.engineOnDecide } : {}),
    logger,
  });

  workflowRunService = new WorkflowRunService(
    workflowRunRepo,
    stageRunRepo,
    runDefinitionReader,
    workflowDefinitionService,
    eventBus,
    engine,
    logger,
  );
  // A stage is a compact chat (P03b): send, stop, amend, answer its gates.
  const stageConversationService = new StageConversationService({ engine, stageRuns: stageRunRepo, logger });

  // PD-17 — which provider a stage would run on, for the run-start and
  // mode-change checks: the bound agent's runtime (read through the same
  // resolver the composer uses), then routing by model (review R8).
  workflowRunService.setProviderResolver(async ({ session, projectId }) => {
    let harnessType: string | undefined = session.harnessType;
    let model = session.model;
    const agentResolver = sessionExtensions.agentResolver;
    if (session.agentRef && agentResolver) {
      const projection = await agentResolver
        .resolve({
          agentRef: session.agentRef,
          ...(session.agentOverrides ? { overrides: session.agentOverrides as AgentOverrides } : {}),
          ...(resolverLayer(session) ? { runtimeOverrides: resolverLayer(session)! } : {}),
          ...(projectId ? { projectId } : {}),
          harnessType: (harnessType ?? 'copilot') as HarnessConfig['harnessType'],
          scope: 'stage',
        })
        .catch(() => undefined);
      harnessType = projection?.runtime.harnessType ?? harnessType;
      model = projection?.runtime.model ?? model;
    }
    if (harnessType) return harnessType;
    return harness.resolveProvider?.({ ...(model ? { model } : {}) });
  });

  // HITL — the operator side of parked instances: resolutions and cancels are run commands.
  const hitlService = new HitlService(stageRunRepo, engine);

  // ── Automation ──
  const automationService = new AutomationService(
    automationRepo,
    automationExecutionRepo,
    workflowRunService,
    workflowRunRepo,
    workflowDefinitionService,
    eventBus,
    logger,
    // W22: durable iteration claiming (P0-41 fix).
    durableExecutionEngine,
    config.artifactsDir,
  );

  // Track A1 — boot-time reconciler + idempotency sweeper. Only wired
  // when the caller supplied an idempotency repo (server always does;
  // some tests skip it).
  const automationRecoveryService = idempotencyKeyRepo
    ? new AutomationRecoveryService(
        automationRepo,
        automationExecutionRepo,
        workflowRunRepo,
        eventBus,
        idempotencyKeyRepo,
        logger,
        // P0-b — the post-restart caller for the durable iteration machinery.
        // Without it the reconciler only finalises, so an interrupted batch
        // reports success for iterations that never ran.
        (executionId, opts) => automationService.resumeExecution(executionId, opts),
      )
    : null;

  // Pre/post-processing of orchestrated runs; commit/push/PR through the flow.
  const workflowPreprocessor = new WorkflowPreprocessor(gitManager, scriptRunner, eventBus, logger, scmFlow);

  return {
    eventBus,
    templateRegistry,
    hookExecutor,
    hookInterceptor,
    sessionHookRegistry,
    artifactService,
    errorHandler,
    chatManagementService,
    sessionComposer,
    orchestratorService,
    workflowDefinitionService,
    runDefinitionReader,
    engine,
    workflowRunService,
    stageConversationService,
    automationService,
    automationRecoveryService,
    hitlService,
    durableExecutionEngine,
    workflowPreprocessor,
    ...(planService ? { planService } : {}),
    ...(agentInteractionService ? { agentInteractionService } : {}),
    ...(inputs.agentService ? { agentService: inputs.agentService } : {}),
    ...(inputs.agentResolver ? { agentResolver: inputs.agentResolver } : {}),
    ...(inputs.agentStaging ? { agentStaging: inputs.agentStaging } : {}),
  };
}
