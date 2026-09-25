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
// controller, the source-control flow and the sandbox choice. Both roots
// (server and SDK) pass them, so no service carries an "absent dependency"
// fallback. Platform-specific concerns (harness adapter construction,
// provider choice, HTTP streaming, graceful shutdown) stay in the app's
// own composition-root.
// ────────────────────────────────────────────────────────────────

import type { ILogger, AgentEvent } from '@generatorai/shared';
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
  ISessionAllocationRepository,
} from '../domain/ports/index.js';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from '../services/AutomationService.js';
import type { IIdempotencyKeyRepository } from '../services/AutomationRecoveryService.js';

import { EventBus } from '../events/EventBus.js';
import { ArtifactService } from '../services/ArtifactService.js';
import { HookExecutor } from '../services/HookExecutor.js';
import { HookInterceptor } from '../services/HookInterceptor.js';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import { StartupRecoveryService } from '../services/StartupRecoveryService.js';
import { ErrorHandler } from '../services/ErrorHandler.js';
import { SessionAllocator } from '../services/SessionAllocator.js';
import { ChatManagementService } from '../services/ChatManagementService.js';
import type { ChatManagementServiceExtensions } from '../services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../services/orchestrator/OrchestratorService.js';
import type { OrchestratorConfig } from '../services/orchestrator/OrchestratorService.js';
import { DAGScheduler } from '../services/DAGScheduler.js';
import { WorkflowDefinitionService } from '../services/WorkflowDefinitionService.js';
import { RunDefinitionReader } from '../services/definitions/RunDefinitionReader.js';
import { StageExecutionService } from '../services/StageExecutionService.js';
import { WorkflowRunService } from '../services/WorkflowRunService.js';
import { AutomationService } from '../services/AutomationService.js';
import { AutomationRecoveryService } from '../services/AutomationRecoveryService.js';
import { HitlService } from '../services/HitlService.js';
import { AgentInteractionService } from '../services/AgentInteractionService.js';
import { PlanService } from '../services/PlanService.js';
import { DurableExecutionEngine } from '../services/DurableExecutionEngine.js';
import { WorkflowPreprocessor, type WorkflowScmFlowPort } from '../services/WorkflowPreprocessor.js';
import type { OrchestratorSandbox } from '../services/WorkflowOrchestrator.js';
import type { WorkspaceManager } from '../services/WorkspaceManager.js';
import type { AdmissionController } from '../services/AdmissionController.js';
import type { RegisterRepository, EntryRepository } from '@generatorai/db';
import type { AgentService } from '../services/AgentService.js';
import type { AgentResolver } from '../services/AgentResolver.js';
import type { AgentStagingService } from '../services/AgentStagingService.js';
import type { IPlanRepository, IAgentInteractionRepository } from '../domain/ports/IPlanRepository.js';
import { Semaphore } from '../utils/Semaphore.js';
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

  /** Optional — persistence for SessionAllocator state (Phase 1, 1.6). */
  sessionAllocationRepo?: ISessionAllocationRepository;

  /**
   * The run sandbox, or `null` when sandbox mode is off in the deployment
   * config. Also the boot-time orphan reaper (Phase 1, 1.7 / 1.9).
   */
  sandbox: OrchestratorSandbox | null;

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
    /**
     * P1#7 — max stages executing concurrently across all runs (bounds
     * harness subprocess fan-out). `<= 0` ⇒ unlimited. Defaults to 8.
     */
    maxConcurrentStages?: number;
  };

  /** W22 / W47 — durable execution engine repositories. */
  registerRepo: RegisterRepository;
  entryRepo: EntryRepository;

  /**
   * Section 8 — optional harness-agnostic extensions for ChatManagementService.
   * When omitted, behaviour is identical to pre-Phase-6. Supply a populated
   * `customToolRegistry` / `mcpHub` / `buildHookBridge` once a workflow or
   * plug-in wants to exercise the custom tool / plan-mode / MCP layer.
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

  // Session/workflow services
  artifactService: ArtifactService;
  recoveryService: StartupRecoveryService;
  errorHandler: ErrorHandler;

  // Workflow execution services
  sessionAllocator: SessionAllocator;
  chatManagementService: ChatManagementService;
  orchestratorService: OrchestratorService;
  dagScheduler: DAGScheduler;
  workflowDefinitionService: WorkflowDefinitionService;
  /** The graph of each run's pinned definition version. */
  runDefinitionReader: RunDefinitionReader;
  stageExecutionService: StageExecutionService;
  workflowRunService: WorkflowRunService;

  // Automation
  automationService: AutomationService;
  /** Track A — boot reconciler + idempotency-key sweeper. May be null
   *  when the caller didn't supply an idempotency repository. */
  automationRecoveryService: AutomationRecoveryService | null;

  /** HITL — human-in-the-loop interrupt/resume primitive. */
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
    sessionAllocationRepo,
    sandbox,
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

  // ── Session services ──
  const artifactService = new ArtifactService(artifactRepo, config.artifactsDir);

  // Build workflow execution services first so the recovery service can depend on them.
  // (Circular dep avoided because sessionAllocator only uses recovery
  // indirectly via rehydrate(), not the other way around.)

  const errorHandler = new ErrorHandler(eventBus, logger);

  // ── Workflow execution services ──
  const sessionAllocator = new SessionAllocator(
    sessionRepo,
    harness,
    eventBus,
    sessionAllocationRepo,
  );

  const chatManagementService = new ChatManagementService(
    chatEntityRepo,
    sessionRepo,
    chatMessageRepo,
    harness,
    eventBus,
    inputs.chatExtensions,
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
    if (inputs.chatExtensions) {
      inputs.chatExtensions.planService = planService;
      inputs.chatExtensions.agentInteractionService = agentInteractionService;
    }
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
  if (inputs.chatExtensions) {
    inputs.chatExtensions.orchestratorService = orchestratorService;
  }

  // Runs read their pinned definition version through one reader (W-13).
  const runDefinitionReader = new RunDefinitionReader(workflowDefinitionStore);
  const dagScheduler = new DAGScheduler(runDefinitionReader, stageRunRepo, workflowRunRepo, logger);
  const workflowDefinitionService = new WorkflowDefinitionService(workflowDefinitionStore, templateRegistry);

  // W22 — Durable execution engine (§3.4 / P0-41 / X-23 fix). Built before
  // HitlService, which takes it as its durable Awakeable backend.
  const durableExecutionEngine = new DurableExecutionEngine(registerRepo, entryRepo, logger);

  // HITL — one service instance per process. Stateless across runs
  // (waiters are per-stageRunId); safe to share.
  // Created before StageExecutionService so it can be injected as the
  // permission bridge (HITL-06).
  const hitlService = new HitlService(stageRunRepo, eventBus, durableExecutionEngine, logger);

  const stageExecutionService = new StageExecutionService(
    stageRunRepo,
    runDefinitionReader,
    chatMessageRepo,
    harness,
    eventBus,
    sessionAllocator,
    hookExecutor,
    workspaceManager,
    workflowRunRepo,        // HITL-06: read run's permissionMode per request
    hitlService,            // HITL-06: bridge harness prompts to HITL waiter
  );

  // W22 — put the effect sandwich on the real turn path. Without this line
  // `withEffect()` has no production caller and an interrupted stage re-runs
  // every prompt and every tool call from scratch on the next boot. Late-wired
  // rather than added to an already-11-argument constructor.
  stageExecutionService.setDurableEngine(durableExecutionEngine);

  // P1#7 — bound concurrent stage execution (and therefore harness subprocess
  // fan-out). Default 8; configurable, 0 = unlimited.
  const stageSemaphore = new Semaphore(config.maxConcurrentStages ?? 8);

  // PLN-01 — a plan-mode stage files its output as a real PlanDocument, so a
  // workflow plan is the same artefact as a chat plan. Late-wired because
  // PlanService is constructed above but StageExecutionService takes it
  // through a setter to avoid widening an already long constructor.
  if (planService) stageExecutionService.setPlanService(planService);

  // AGT-01 — late-wire the agent graph exactly where the server's
  // composition-root does, so an SDK embedder that supplies the services gets
  // identical behaviour instead of a half-enabled feature.
  if (inputs.agentResolver) {
    stageExecutionService.setAgentServices(inputs.agentResolver, inputs.agentStaging);
    if (inputs.chatExtensions) {
      inputs.chatExtensions.agentResolver = inputs.agentResolver;
      if (inputs.agentStaging) inputs.chatExtensions.agentStaging = inputs.agentStaging;
    }
  }
  if (inputs.agentService) orchestratorService.setAgentService(inputs.agentService);

  const workflowRunService = new WorkflowRunService(
    workflowRunRepo,
    stageRunRepo,
    runDefinitionReader,
    workflowDefinitionService,
    eventBus,
    dagScheduler,
    stageExecutionService,
    sessionAllocator,
    workspaceManager,
    admissionController,
    logger,
    stageSemaphore,
  );

  // X-25 — read side of the durable artifact channel, so a successor's
  // context comes from the predecessor's durable result rather than a column
  // that an interrupted stage may never have written.
  workflowRunService.setDurableEngine(durableExecutionEngine);

  // P0-a — an approval that arrives after a restart has no live `interrupt()`
  // frame to resume, so HitlService returns the stage to `pending` and needs
  // this to actually relaunch it. Late-bound: WorkflowRunService is built
  // after HitlService (via StageExecutionService).
  hitlService.setRedriveRun((runId: string) => workflowRunService.redriveRun(runId));

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

  // Built last because it wires in sessionAllocator (for rehydrate) and
  // the optional sandbox orphan reaper. Other services don't depend on it.
  const recoveryService = new StartupRecoveryService(
    sessionRepo,
    harness,
    eventBus,
    logger,
    workflowRunRepo,
    stageRunRepo,
    sessionAllocator,
    sandbox?.lifecycle,
    // DUR-06 — auto-resume interrupted runs by re-driving from durable DB state.
    (runId: string) => workflowRunService.redriveRun(runId),
    // Skip eager tool-less rehydration of chat sessions — they lazily resume
    // WITH tools on the next prompt (see StartupRecoveryService.rehydrateSessions).
    chatEntityRepo,
  );

  // X-13 — record which session an interrupted stage lost, and why. Without
  // this the discarded conversation leaves no trace at all.
  recoveryService.setDurableEngine(durableExecutionEngine);

  // Pre/post-processing of orchestrated runs; commit/push/PR through the flow.
  const workflowPreprocessor = new WorkflowPreprocessor(gitManager, scriptRunner, eventBus, logger, scmFlow);

  return {
    eventBus,
    templateRegistry,
    hookExecutor,
    hookInterceptor,
    artifactService,
    recoveryService,
    errorHandler,
    sessionAllocator,
    chatManagementService,
    orchestratorService,
    dagScheduler,
    workflowDefinitionService,
    runDefinitionReader,
    stageExecutionService,
    workflowRunService,
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
