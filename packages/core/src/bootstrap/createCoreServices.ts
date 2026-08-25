// ────────────────────────────────────────────────────────────────
// createCoreServices — shared factory for the repository + service graph
//
// Both `apps/server` and `apps/cli` (direct mode) need the same core
// wiring: every repo, EventBus, hooks, session services,
// automation. Before Phase 1 each app duplicated ~180 lines of DI; a
// signature change meant two parallel edits. This factory centralizes
// that surface so changes land in one place.
//
// Platform-specific concerns (harness adapter construction, sandbox
// lifecycle, HTTP streaming manager, orchestrator file-management
// routes, composition of CLI platform clients, graceful shutdown) stay
// in the app's own composition-root.
// ────────────────────────────────────────────────────────────────

import type { ILogger, AgentEvent } from '@generatorai/shared';
import type {
  ISessionRepository,
  IEventRepository,
  IChatMessageRepository,
  IArtifactRepository,
  IWebhookRepository,
  IChatRepository,
  IWorkflowDefinitionRepository,
  IStageDefinitionRepository,
  IStageEdgeRepository,
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
import { SessionService } from '../services/SessionService.js';
import { ArtifactService } from '../services/ArtifactService.js';
import { WebhookService } from '../services/WebhookService.js';
import { HookExecutor } from '../services/HookExecutor.js';
import { HookInterceptor } from '../services/HookInterceptor.js';
import { ConfigResolver } from '../services/ConfigResolver.js';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import { StartupRecoveryService } from '../services/StartupRecoveryService.js';
import type { ISandboxCleaner } from '../services/StartupRecoveryService.js';
import { ErrorHandler } from '../services/ErrorHandler.js';
import { SessionAllocator } from '../services/SessionAllocator.js';
import { ChatManagementService } from '../services/ChatManagementService.js';
import type { ChatManagementServiceExtensions } from '../services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../services/orchestrator/OrchestratorService.js';
import type { OrchestratorConfig } from '../services/orchestrator/OrchestratorService.js';
import { DAGScheduler } from '../services/DAGScheduler.js';
import { WorkflowDefinitionService } from '../services/WorkflowDefinitionService.js';
import { StageExecutionService } from '../services/StageExecutionService.js';
import { WorkflowRunService } from '../services/WorkflowRunService.js';
import { AutomationService } from '../services/AutomationService.js';
import { AutomationRecoveryService } from '../services/AutomationRecoveryService.js';
import { DataSourceResolver } from '../services/DataSourceResolver.js';
import { HitlService } from '../services/HitlService.js';
import { AgentInteractionService } from '../services/AgentInteractionService.js';
import { PlanService } from '../services/PlanService.js';
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
  webhookRepo: IWebhookRepository;

  // DAG/run repositories
  chatEntityRepo: IChatRepository;
  workflowDefinitionRepo: IWorkflowDefinitionRepository;
  stageDefinitionRepo: IStageDefinitionRepository;
  stageEdgeRepo: IStageEdgeRepository;
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

  /** Optional — sandbox orphan reaper (Phase 1, 1.7 / 1.9). */
  sandboxCleaner?: ISandboxCleaner;

  // Config
  config: {
    artifactsDir: string;
    maxConcurrentSessions: number;
    /**
     * P1#7 — max stages executing concurrently across all runs (bounds
     * harness subprocess fan-out). `<= 0` ⇒ unlimited. Defaults to 8.
     */
    maxConcurrentStages?: number;
    webhooks: { enabled?: boolean; githubSecret?: string; webhookToken?: string };    projectRoot?: string;  };

  /** Optional transactional wrapper for multi-row writes. */
  withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>;

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
  configResolver: ConfigResolver;
  hookExecutor: HookExecutor;
  hookInterceptor: HookInterceptor;

  // Session/workflow services
  sessionService: SessionService;
  artifactService: ArtifactService;
  webhookService: WebhookService;
  recoveryService: StartupRecoveryService;
  errorHandler: ErrorHandler;

  // Workflow execution services
  sessionAllocator: SessionAllocator;
  chatManagementService: ChatManagementService;
  orchestratorService: OrchestratorService;
  dagScheduler: DAGScheduler;
  workflowDefinitionService: WorkflowDefinitionService;
  stageExecutionService: StageExecutionService;
  workflowRunService: WorkflowRunService;

  // Automation
  dataSourceResolver: DataSourceResolver;
  automationService: AutomationService;
  /** Track A — boot reconciler + idempotency-key sweeper. May be null
   *  when the caller didn't supply an idempotency repository. */
  automationRecoveryService: AutomationRecoveryService | null;

  /** HITL — human-in-the-loop interrupt/resume primitive. */
  hitlService: HitlService;
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
    webhookRepo,
    chatEntityRepo,
    workflowDefinitionRepo,
    stageDefinitionRepo,
    stageEdgeRepo,
    workflowRunRepo,
    stageRunRepo,
    automationRepo,
    automationExecutionRepo,
    idempotencyKeyRepo,
    sequenceAllocator,
    sessionAllocationRepo,
    sandboxCleaner,
    config,
    withTransaction,
  } = inputs;

  // ── Events ──
  const eventBus = new EventBus(eventRepo, logger, sequenceAllocator);

  // ── Config / Templates ──
  const templateRegistry = new TemplateRegistry(logger);
  const configResolver = new ConfigResolver(templateRegistry);

  // ── Hooks ──
  const hookExecutor = new HookExecutor(scriptRunner, httpClient, eventBus);
  const hookInterceptor = new HookInterceptor(hookExecutor, eventBus);

  // ── Session services ──
  const sessionService = new SessionService(
    sessionRepo,
    eventBus,
    harness,
    { maxConcurrentSessions: config.maxConcurrentSessions },
  );

  const artifactService = new ArtifactService(artifactRepo, config.artifactsDir);

  const webhookService = new WebhookService(
    webhookRepo,
    sessionService,
    templateRegistry,
    eventBus,
    config.webhooks,
  );

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

  const dagScheduler = new DAGScheduler(
    stageDefinitionRepo,
    stageEdgeRepo,
    stageRunRepo,
    workflowRunRepo, // SCHEMA-3: enables variables.* in edge conditions
  );

  const workflowDefinitionService = new WorkflowDefinitionService(
    workflowDefinitionRepo,
    stageDefinitionRepo,
    stageEdgeRepo,
    templateRegistry,
    dagScheduler,
    withTransaction, // P0#4 — atomic template/JSON import
  );

  // HITL — one service instance per process. Stateless across runs
  // (waiters are per-stageRunId); safe to share.
  // Created before StageExecutionService so it can be injected as the
  // permission bridge (HITL-06).
  const hitlService = new HitlService(stageRunRepo, eventBus, logger);

  const stageExecutionService = new StageExecutionService(
    stageRunRepo,
    stageDefinitionRepo,
    chatMessageRepo,
    harness,
    eventBus,
    sessionAllocator,
    hookExecutor,
    undefined, // workspaceManager — late-wired via setWorkspaceManager below
    workflowDefinitionRepo, // HOOK-2: enables hooksFile per-stage/wildcard merge
    workflowRunRepo,        // HITL-06: read run's permissionMode per request
    hitlService,            // HITL-06: bridge harness prompts to HITL waiter
  );

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
    stageDefinitionRepo,
    workflowDefinitionRepo,
    eventBus,
    dagScheduler,
    stageExecutionService,
    sessionAllocator,
    config.artifactsDir,
    logger,
    withTransaction,
    undefined, // workspaceManager — late-wired via setWorkspaceManager
    undefined, // worktreeService — late-wired via setWorktreeService
    undefined, // codebaseRepo — late-wired via setWorktreeService
    stageSemaphore,
  );

  // ── Automation ──
  const dataSourceResolver = new DataSourceResolver(scriptRunner, httpClient, logger, config.projectRoot);
  const automationService = new AutomationService(
    automationRepo,
    automationExecutionRepo,
    workflowRunService,
    workflowRunRepo,
    workflowDefinitionService,
    eventBus,
    logger,
    config.artifactsDir,
    dataSourceResolver,
    withTransaction,
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
    sandboxCleaner,
    // DUR-06 — auto-resume interrupted runs by re-driving from durable DB state.
    (runId: string) => workflowRunService.redriveRun(runId),
    // Skip eager tool-less rehydration of chat sessions — they lazily resume
    // WITH tools on the next prompt (see StartupRecoveryService.rehydrateSessions).
    chatEntityRepo,
  );

  return {
    eventBus,
    templateRegistry,
    configResolver,
    hookExecutor,
    hookInterceptor,
    sessionService,
    artifactService,
    webhookService,
    recoveryService,
    errorHandler,
    sessionAllocator,
    chatManagementService,
    orchestratorService,
    dagScheduler,
    workflowDefinitionService,
    stageExecutionService,
    workflowRunService,
    dataSourceResolver,
    automationService,
    automationRecoveryService,
    hitlService,
    ...(planService ? { planService } : {}),
    ...(agentInteractionService ? { agentInteractionService } : {}),
    ...(inputs.agentService ? { agentService: inputs.agentService } : {}),
    ...(inputs.agentResolver ? { agentResolver: inputs.agentResolver } : {}),
    ...(inputs.agentStaging ? { agentStaging: inputs.agentStaging } : {}),
  };
}
