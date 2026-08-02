// ────────────────────────────────────────────────────────────────
// GeneratorAI — Main SDK facade class
//
// One-liner entry point for external consumers. Internally wires all
// repositories, services, and providers via createCoreServices.
// ────────────────────────────────────────────────────────────────

import {
  createCoreServices,
  type CoreServices,
  SandboxedScriptRunner,
  FetchHttpClient,
  GitManager,
  WorkflowScriptLoader,
  CustomToolRegistry,
  InMemoryMcpHub,
  WorkspaceManager,
  WorkflowOrchestrator,
  WorkflowPreprocessor,
  ResultValidator,
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
  StreamBroker,
  DurableSleepService,
  WorktreeCleanupService,
  SystemArtifactService,
  BrowserService,
  ServerPlaywrightHost,
  type IWorkflowRunRepository,
  type IChatRepository,
} from '@generatorai/core';
import {
  createDB,
  closeDB,
  migrateDB,
  withTransaction,
  createAllRepositories,
  EventRetentionService,
  type AppDatabase,
} from '@generatorai/db';
import {
  createHarnessProvider,
  HarnessProxy,
  type HarnessType,
} from '@generatorai/agent-harness-providers';
import { createLogger, type ILogger } from '@generatorai/shared';

import { type GeneratorAIConfig, type ResolvedConfig, resolveConfig } from './config.js';
import {
  WorkflowFacade,
  ChatFacade,
  AutomationFacade,
  ScriptFacade,
  EventFacade,
  ToolFacade,
  ProjectFacade,
  HookFacade,
  HitlFacade,
  WorkspaceFacade,
  BrowserFacade,
} from './facades/index.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Background services + repositories the SDK lifecycle (initialize/shutdown) owns. */
interface GeneratorAIInternals {
  repos: ReturnType<typeof createAllRepositories>;
  eventRetention: EventRetentionService;
  durableSleep: DurableSleepService;
  worktreeCleanup: WorktreeCleanupService;
  systemArtifacts: SystemArtifactService;
}

export class GeneratorAI {
  /** Workflow operations (create, run, orchestrate, stream, pause, resume, cancel) */
  readonly workflows: WorkflowFacade;
  /** Chat operations (create, send, stream) */
  readonly chat: ChatFacade;
  /** Automation operations (create, trigger, schedule) */
  readonly automations: AutomationFacade;
  /** Workflow script operations (list, get, run, materialize) */
  readonly scripts: ScriptFacade;
  /** Event system (subscribe, replay) */
  readonly events: EventFacade;
  /** Custom tool registration */
  readonly tools: ToolFacade;
  /** Project & Codebase management (projects, git repos, worktrees, configs) */
  readonly projects: ProjectFacade;
  /** Lifecycle hook registration */
  readonly hooks: HookFacade;
  /** Human-in-the-loop interrupt/resume */
  readonly hitl: HitlFacade;
  /** Execution workspace isolation */
  readonly workspaces: WorkspaceFacade;
  /** Integrated Browser (v13) — Chromium under CDP for chats/runs. */
  readonly browser: BrowserFacade;

  /**
   * Direct access to the raw core service graph.
   *
   * @internal UNSTABLE — not part of the SDK's semver contract; the shape and
   * method signatures can change in any minor release. Prefer the facades
   * (`workflows`, `chat`, `automations`, …). Use only if you accept breakage
   * across upgrades and pin an exact version. See API-STABILITY.md.
   */
  readonly services: CoreServices;

  /**
   * Direct access to the workflow orchestrator.
   * @internal UNSTABLE — see `services`. Prefer `workflows.run` / `workflows.orchestrate`.
   */
  readonly orchestrator: WorkflowOrchestrator;

  /**
   * Direct access to the stream broker for SSE-style pub/sub.
   * @internal UNSTABLE — see `services`. Prefer `events.*`.
   */
  readonly streamBroker: StreamBroker;

  /** Direct access to the logger */
  readonly logger: ILogger;

  // Private state for lifecycle (initialize / shutdown)
  private readonly _db: AppDatabase;
  private readonly _harness: HarnessProxy;
  private readonly _config: ResolvedConfig;
  private readonly _scriptLoader?: WorkflowScriptLoader;
  private readonly _internals: GeneratorAIInternals;
  private _initialized = false;
  private _shutdown = false;

  private constructor(
    services: CoreServices,
    db: AppDatabase,
    harness: HarnessProxy,
    config: ResolvedConfig,
    logger: ILogger,
    runRepo: IWorkflowRunRepository,
    chatRepo: IChatRepository,
    orchestrator: WorkflowOrchestrator,
    streamBroker: StreamBroker,
    workspaceManager: WorkspaceManager,
    projectService: ProjectService,
    codebaseService: CodebaseService,
    worktreeService: WorktreeService,
    projectConfigService: ProjectConfigService,
    browserService: BrowserService,
    internals: GeneratorAIInternals,
    scriptLoader?: WorkflowScriptLoader,
    toolRegistry?: CustomToolRegistry,
  ) {
    this.services = services;
    this._db = db;
    this._harness = harness;
    this._config = config;
    this.logger = logger;
    this._scriptLoader = scriptLoader;
    this._internals = internals;
    this.orchestrator = orchestrator;
    this.streamBroker = streamBroker;

    // Create facades with all dependencies
    this.workflows = new WorkflowFacade(services, runRepo, orchestrator, scriptLoader);
    this.chat = new ChatFacade(services, chatRepo);
    this.automations = new AutomationFacade(services);
    this.scripts = new ScriptFacade(services, config, scriptLoader);
    this.events = new EventFacade(services);
    this.tools = new ToolFacade(services, toolRegistry);
    this.projects = new ProjectFacade(projectService, codebaseService, worktreeService, projectConfigService);
    this.hooks = new HookFacade(services);
    this.hitl = new HitlFacade(services);
    this.workspaces = new WorkspaceFacade(workspaceManager);
    this.browser = new BrowserFacade(browserService, workspaceManager);
  }

  /**
   * Start the engine. Call once after {@link create} and before running
   * workflows/chats. Mirrors the server's composition-root lifecycle so an
   * SDK-embedded engine is fully functional:
   *  1. load workflow/stage templates + system artifacts
   *  2. **start the harness** (without this, no workflow/chat can run)
   *  3. register global harness lifecycle hooks
   *  4. restore the global event-sequence counter
   *  5. recover interrupted runs/sessions (+ rehydrate the session allocator)
   *  6. start automation cron jobs
   *  7. start background sweepers (event retention, durable step.sleep, worktree GC)
   *
   * A failed harness start is logged (not thrown) so read-only operations still
   * work in "degraded mode" — exactly like the server. Idempotent.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
    const { templateRegistry, configResolver, hookInterceptor, eventBus, recoveryService, automationService } =
      this.services;
    const { repos, eventRetention, durableSleep, worktreeCleanup, systemArtifacts } = this._internals;

    // 1. Templates (root + system subdirectory), tolerating a missing dir.
    const templatesDir = this._config.templatesDir;
    if (fs.existsSync(templatesDir)) {
      await templateRegistry.loadWorkflowTemplates(templatesDir);
      const systemTemplatesDir = path.join(templatesDir, 'system');
      if (fs.existsSync(systemTemplatesDir)) {
        await templateRegistry.loadWorkflowTemplates(systemTemplatesDir);
      }
    }

    // 2. Start the harness — the blocker fix. Degraded mode on failure.
    try {
      await this._harness.initialize();
      this.logger.info('[GeneratorAI] Harness initialized');
    } catch (err) {
      this.logger.warn(
        `[GeneratorAI] Harness initialization failed (degraded mode): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Global harness lifecycle hooks.
    try {
      const globalHooks = configResolver.resolveGlobalHooks();
      hookInterceptor.registerClientLifecycleHooks(this._harness, globalHooks, {
        sessionId: '__global__',
        workspacePath: path.join(this._config.artifactsDir, 'workspaces'),
        variables: {},
        eventBus,
      });
    } catch (err) {
      this.logger.warn(`[GeneratorAI] Global hook registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Restore global event sequence counter (avoids post-restart collisions).
    await repos.eventRepo.initialize();

    // 5. Recover interrupted runs/sessions (also rehydrates SessionAllocator).
    await recoveryService.recover();

    // 6. Automation cron scheduler.
    await automationService.initializeCronJobs();

    // 7. Background sweepers.
    eventRetention.start();
    durableSleep.start();
    await worktreeCleanup.recoverOnStartup();
    worktreeCleanup.start();

    // System artifacts (skills/prompts/agents).
    await systemArtifacts.loadSystemArtifacts();

    this.logger.info('[GeneratorAI] initialized');
  }

  /** Graceful shutdown — stops sweepers + run loops, flushes events, closes harness + DB */
  async shutdown(): Promise<void> {
    if (this._shutdown) return;
    this._shutdown = true;

    // Stop background sweepers first so they can't touch the DB after close.
    try {
      this._internals.eventRetention.stop();
      this._internals.durableSleep.stop();
      this._internals.worktreeCleanup.stop();
      this.services.automationService.shutdown();
    } catch {
      // Best-effort
    }

    // Stop run poll loops + EventBus subscriptions so no new events are produced
    // and no setInterval handles are orphaned.
    try {
      this.services.workflowRunService.shutdown();
    } catch {
      // Best-effort
    }

    try {
      await this._harness.stop();
    } catch {
      // Best-effort harness shutdown
    }

    // Deterministically drain in-flight EventBus emit queues (replaces the old
    // best-effort 50ms sleep) so a session's final events are persisted before
    // the DB connection closes.
    try {
      await this.services.eventBus.flush();
    } catch {
      // Best-effort drain
    }

    try {
      closeDB(this._db);
    } catch {
      // Best-effort DB close
    }
  }

  /** Get the resolved configuration */
  get config(): Readonly<ResolvedConfig> {
    return this._config;
  }

  /**
   * Create a new GeneratorAI SDK instance.
   *
   * This is the recommended way to get started:
   * ```typescript
   * const ai = await GeneratorAI.create({
   *   provider: 'copilot',
   *   database: './my-app.db',
   * });
   * ```
   */
  static async create(config: GeneratorAIConfig): Promise<GeneratorAI> {
    const resolved = resolveConfig(config);

    // ── Logger ──
    const logger: ILogger = resolved.logger === false
      ? createLogger({ level: 'silent', service: 'generatorai-sdk' })
      : createLogger({
          level: resolved.logger.level ?? 'info',
          service: 'generatorai-sdk',
        });

    // ── Ensure directories exist ──
    fs.mkdirSync(resolved.artifactsDir, { recursive: true });

    // ── Database ──
    const db = createDB(resolved.database);
    migrateDB(db);

    // ── Harness ──
    let harness: HarnessProxy;
    if (typeof resolved.provider === 'string') {
      const harnessType = resolved.provider as HarnessType;
      const rawHarness = await createHarnessProvider({
        type: harnessType,
        ...(harnessType === 'copilot'
          ? { copilot: resolved.providerOptions }
          : { claudeAgent: resolved.providerOptions }),
      } as never);
      harness = new HarnessProxy(rawHarness, harnessType);
    } else {
      // Bring-your-own-harness: the caller passed a pre-built IAgentHarness.
      // Label it 'custom' (not 'copilot') so health/telemetry don't misreport
      // the provider. The proxy accepts any string label (HarnessTypeLabel).
      harness = new HarnessProxy(resolved.provider, 'custom');
    }

    // ── Infrastructure ──
    const scriptRunner = new SandboxedScriptRunner(logger);
    const httpClient = new FetchHttpClient();
    const gitManager = new GitManager(scriptRunner, logger, {
      workspacesDir: path.join(resolved.artifactsDir, 'workspaces'),
    });

    // ── Repositories ──
    const repos = createAllRepositories(db);

    // ── Custom Tools + MCP ──
    const customToolRegistry = new CustomToolRegistry();
    const mcpHub = new InMemoryMcpHub();

    // ── Core Services ──
    const services = createCoreServices({
      logger,
      harness,
      scriptRunner,
      httpClient,
      gitManager,
      sequenceAllocator: repos.sequenceAllocator,
      sessionRepo: repos.sessionRepo,
      eventRepo: repos.eventRepo,
      chatMessageRepo: repos.chatMessageRepo,
      artifactRepo: repos.artifactRepo,
      webhookRepo: repos.webhookRepo,
      chatEntityRepo: repos.chatEntityRepo,
      workflowDefinitionRepo: repos.workflowDefinitionRepo,
      stageDefinitionRepo: repos.stageDefinitionRepo,
      stageEdgeRepo: repos.stageEdgeRepo,
      workflowRunRepo: repos.workflowRunRepo,
      stageRunRepo: repos.stageRunRepo,
      automationRepo: repos.automationRepo,
      automationExecutionRepo: repos.automationExecutionRepo,
      sessionAllocationRepo: repos.sessionAllocationRepo,
      config: {
        artifactsDir: resolved.artifactsDir,
        maxConcurrentSessions: resolved.maxConcurrentSessions,
        maxConcurrentStages: resolved.maxConcurrentStages,
        webhooks: resolved.webhooks,
        projectRoot: resolved.projectRoot,
      },
      withTransaction: <T>(fn: () => Promise<T>) => withTransaction(db, fn),
      chatExtensions: { customToolRegistry, mcpHub },
    });

    // ── Workspace Manager + Late-Wire ──
    const workspacesDir = path.join(resolved.artifactsDir, 'workspaces');
    fs.mkdirSync(workspacesDir, { recursive: true });
    const workspaceManager = new WorkspaceManager(
      repos.executionWorkspaceRepo,
      repos.workspaceWorktreeRepo,
      repos.workspaceArtifactRepo,
      { workspacesDir, defaultGitEnabled: true },
      logger,
    );

    // Late-wire workspace manager into services that were created before it
    services.workflowRunService.setWorkspaceManager(workspaceManager);
    services.workflowRunService.setHookExecutor(services.hookExecutor);
    services.stageExecutionService.setWorkspaceManager(workspaceManager);

    // ── Project & Codebase Management Services ──
    const projectService = new ProjectService(
      repos.projectRepo,
      repos.projectCodebaseRepo,
      repos.projectConfigRepo,
      resolved.artifactsDir,
      logger,
    );

    const codebaseService = new CodebaseService(
      repos.projectCodebaseRepo,
      projectService,
      gitManager,
      logger,
    );

    const worktreeService = new WorktreeService(
      repos.worktreeRepo,
      repos.projectCodebaseRepo,
      projectService,
      gitManager,
      logger,
    );

    const projectConfigService = new ProjectConfigService(
      repos.projectConfigRepo,
      projectService,
      logger,
    );

    // Late-wire worktreeService into WorkflowRunService
    services.workflowRunService.setWorktreeService(worktreeService, repos.projectCodebaseRepo);

    // ── Stream Broker ──
    const streamBroker = new StreamBroker(repos.streamCursorRepo, logger);

    // ── Workflow Orchestrator (full DAG execution) ──
    const workflowPreprocessor = new WorkflowPreprocessor(
      gitManager,
      scriptRunner,
      services.eventBus,
      logger,
    );

    const resultValidator = new ResultValidator(
      repos.chatMessageRepo,
      repos.stageRunRepo,
      services.eventBus,
      logger,
      scriptRunner,
    );

    // SDK-9: the SDK does not yet wire sandbox providers (the server does). If
    // the caller asked for a sandbox, warn instead of silently ignoring it so
    // the no-op is visible rather than a false sense of isolation.
    if (resolved.sandbox?.enabled) {
      logger.warn(
        '[GeneratorAI] sandbox.enabled=true was requested but the SDK runs stages WITHOUT a sandbox ' +
        '(sandbox providers are server-only). Commands execute on the host. Run via the server for sandboxing.',
      );
    }

    const workflowOrchestrator = new WorkflowOrchestrator(
      services.workflowRunService,
      services.workflowDefinitionService,
      workflowPreprocessor,
      resultValidator,
      repos.stageRunRepo,
      repos.stageDefinitionRepo,
      repos.workflowRunRepo,
      services.eventBus,
      services.templateRegistry,
      logger,
      resolved.artifactsDir,
      undefined, // sandboxLifecycleManager — not wired in SDK mode (SDK-9); see warning above
      undefined, // sandboxProvider — not wired in SDK mode (SDK-9); see warning above
      worktreeService,
      projectService,
      projectConfigService,
      workspaceManager,
      services.hookExecutor,
    );

    // ── Workflow Script Loader (if scripts directory exists) ──
    let scriptLoader: WorkflowScriptLoader | undefined;
    if (fs.existsSync(resolved.scriptsDir)) {
      scriptLoader = new WorkflowScriptLoader(
        logger,
        [resolved.scriptsDir],
        services.hookExecutor,
      );
      await scriptLoader.discoverScripts();
      // Connect script loader to data source resolver for automation
      services.dataSourceResolver.setScriptLoader(scriptLoader);
    }

    // ── Background lifecycle services (constructed here, started by initialize()) ──
    // Defaults mirror the server's AppConfig so SDK-embedded engines get the
    // same durability (event retention, durable step.sleep wake, worktree GC).
    const eventRetention = new EventRetentionService(
      db,
      { eventPayloadTtlDays: 90, sweepIntervalMs: 6 * 60 * 60 * 1000, maxDeletePerSweep: 50_000, enabled: true },
      logger,
    );

    const durableSleep = new DurableSleepService(
      repos.stageRunRepo,
      services.eventBus,
      async (stage) => {
        try {
          const run = await repos.workflowRunRepo.getById(stage.workflowRunId);
          // Fire-and-forget: WorkflowRunService.onStageCompleted/onStageFailed
          // drives the DAG forward once executeStage settles.
          services.stageExecutionService
            .executeStage(stage, stage.workflowRunId, run.sessionMode)
            .then(() => services.workflowRunService.onStageCompleted(stage.workflowRunId, stage.id))
            .catch((err) => services.workflowRunService.onStageFailed(stage.workflowRunId, stage.id, err));
        } catch (err) {
          logger.error(`[DurableSleep] Failed to resume woken stage ${stage.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      { sweepIntervalMs: 5_000, maxWakesPerSweep: 100, enabled: true },
      logger,
    );

    const worktreeCleanup = new WorktreeCleanupService(
      worktreeService,
      repos.worktreeRepo,
      repos.projectRepo,
      repos.workflowRunRepo,
      logger,
      repos.chatEntityRepo,
    );

    const systemArtifacts = new SystemArtifactService(
      repos.systemConfigRepo,
      path.join(resolved.templatesDir, 'system', 'artifacts'),
      logger,
    );

    // Integrated Browser (v13) — headless-capable per-workspace Chromium.
    const browserService = new BrowserService(
      repos.executionWorkspaceRepo,
      repos.workspaceArtifactRepo,
      services.eventBus,
      logger,
      [new ServerPlaywrightHost(logger)],
      {
        maxConcurrent: Number(process.env['GENERATORAI_BROWSER_MAX_CONCURRENT'] ?? '5'),
      },
    );

    return new GeneratorAI(
      services,
      db,
      harness,
      resolved,
      logger,
      repos.workflowRunRepo,
      repos.chatEntityRepo,
      workflowOrchestrator,
      streamBroker,
      workspaceManager,
      projectService,
      codebaseService,
      worktreeService,
      projectConfigService,
      browserService,
      { repos, eventRetention, durableSleep, worktreeCleanup, systemArtifacts },
      scriptLoader,
      customToolRegistry,
    );
  }
}

/** Convenience alias for GeneratorAI.create() */
export async function createGeneratorAI(config: GeneratorAIConfig): Promise<GeneratorAI> {
  return GeneratorAI.create(config);
}
