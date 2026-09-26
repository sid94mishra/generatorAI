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
  AdmissionController,
  EngineLockedError,
  MountService,
  runBootHousekeeping,
  type RunSandbox,
  createRunSandbox,
  SourceControlRegistry,
  SourceControlConfigService,
  RepoReadinessService,
  ScmTextGenerator,
  SourceControlFlowService,
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
  StreamBroker,
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
  createAllRepositories,
  createEngineStores,
  EventRetentionService,
  type AppDatabase,
} from '@generatorai/db';
import {
  createHarnessProvider,
  harnessErrorOf,
  HarnessProxy,
  type HarnessType,
} from '@generatorai/agent-harness-providers';
import { createLogger, type ILogger } from '@generatorai/shared';
import { createSecretStore } from '@generatorai/secrets';

import { type GeneratorAIConfig, type ResolvedConfig, resolveConfig } from './config.js';

/** The GitHub token the server also reads, seeded into source control when no account exists. */
function githubToken(): string | undefined {
  return process.env['GENERATORAI_GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? undefined;
}

/** `HarnessProviderConfig` option-bag key per harness type. */
const PROVIDER_OPTIONS_KEY: Record<HarnessType, string> = {
  copilot: 'copilot',
  'claude-agent': 'claudeAgent',
  codex: 'codex',
  opencode: 'opencode',
  acp: 'acp',
};
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
  AgentFacade,
} from './facades/index.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Background services + repositories the SDK lifecycle (initialize/shutdown) owns. */
interface GeneratorAIInternals {
  repos: ReturnType<typeof createAllRepositories>;
  /** The run sandbox (its orphan reaper runs at boot), or null. */
  sandbox: RunSandbox | null;
  eventRetention: EventRetentionService;
  worktreeCleanup: WorktreeCleanupService;
  systemArtifacts: SystemArtifactService;
}

export class GeneratorAI {
  /** Workflow operations (create, invoke/run/fork, plan, waitFor, stream, commands) */
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
   * AGT-01 — reusable agents (instructions + skills + MCP servers + capabilities).
   * Throws on use when the host did not supply the agent services.
   */
  readonly agents: AgentFacade;

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
    this.streamBroker = streamBroker;

    // Create facades with all dependencies
    this.workflows = new WorkflowFacade(services, runRepo, internals.repos.eventRepo, scriptLoader);
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
    this.agents = new AgentFacade(services);
  }

  /**
   * Start the engine. Call once after {@link create} and before running
   * workflows/chats. Mirrors the server's composition-root lifecycle so an
   * SDK-embedded engine is fully functional:
   *  1. load workflow/stage templates + system artifacts
   *  2. **start the harness** (without this, no workflow/chat can run)
   *  3. register global harness lifecycle hooks
   *  4. restore the event-sequence counters, finish closing sessions, reap sandbox orphans
   *  5. start the workflow engine: the single-engine lock (the server, the
   *     desktop app and every SDK instance on one database share it), then
   *     recovery of every live run
   *  6. start automation cron jobs
   *  7. start background sweepers (event retention, durable step.sleep, worktree GC)
   *
   * A failed harness start is logged (not thrown) so read-only operations still
   * work in "degraded mode" — exactly like the server. Idempotent.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
    const { templateRegistry, hookInterceptor, engine, eventBus, automationService } = this.services;
    const { repos, sandbox, eventRetention, worktreeCleanup, systemArtifacts } = this._internals;

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

    // 3. Harness client lifecycle events → global event stream.
    hookInterceptor.registerClientLifecycleEvents(this._harness);

    // 4. Restore global event sequence counter (avoids post-restart collisions).
    await repos.eventRepo.initialize();

    await runBootHousekeeping({
      eventBus,
      sessionRepo: repos.sessionRepo,
      harness: this._harness,
      ...(sandbox ? { orphanReaper: sandbox.lifecycle } : {}),
      logger: this.logger,
    });

    // 5. The workflow engine. Another live process owning this database's
    //    engine leaves this instance without one: run commands then fail
    //    with `engine_unavailable`, everything else works.
    try {
      await engine.start();
    } catch (err) {
      if (!(err instanceof EngineLockedError)) throw err;
      this.logger.error(`[GeneratorAI] ${err.message}`);
    }

    // 6. Automation cron scheduler.
    await automationService.initializeCronJobs();

    // 7. Background sweepers.
    eventRetention.start();
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
      this._internals.worktreeCleanup.stop();
      this.services.automationService.shutdown();
    } catch {
      // Best-effort
    }

    // Stop the workflow engine (timers, reaper, outbox) and release its lock.
    try {
      await this.services.engine.stop();
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
   *   harness: 'copilot',          // HarnessType — same word as the server's HARNESS_TYPE
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
    if (typeof resolved.harness === 'string') {
      const harnessType: HarnessType = resolved.harness;
      // `HarnessProviderConfig` keys its per-provider options by a camelCased
      // form of the type; this is the same mapping the server's config layer
      // applies, so `providerOptions` lands where the provider reads it.
      const rawHarness = await createHarnessProvider({
        type: harnessType,
        [PROVIDER_OPTIONS_KEY[harnessType]]: resolved.providerOptions,
      } as never);
      harness = new HarnessProxy(rawHarness, harnessType);
    } else {
      // Bring-your-own-harness: the caller passed a pre-built IAgentHarness.
      // Label it 'custom' (not 'copilot') so health/telemetry don't misreport
      // the provider. The proxy accepts any string label (HarnessTypeLabel).
      harness = new HarnessProxy(resolved.harness, 'custom');
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

    // ── Workspace Manager ──
    const workspacesDir = path.join(resolved.artifactsDir, 'workspaces');
    fs.mkdirSync(workspacesDir, { recursive: true });
    const workspaceManager = new WorkspaceManager(
      repos.executionWorkspaceRepo,
      repos.workspaceMountRepo,
      repos.workspaceArtifactRepo,
      { workspacesDir, defaultGitEnabled: true },
      logger,
      gitManager,
      repos.worktreeRepo,
    );

    // ── Source control (accounts + the commit → PR flow), as on the server ──
    // Account settings live in `<artifactsDir>/source-control.json`; tokens in
    // the encrypted secret store beside it, never in the file.
    const scmRegistry = new SourceControlRegistry();
    const scmConfig = new SourceControlConfigService(scmRegistry, {
      http: httpClient,
      processRunner: scriptRunner,
      secrets: createSecretStore({ dataDir: resolved.artifactsDir, logger }),
      logger,
      configDir: resolved.artifactsDir,
      env: {
        ...(githubToken() ? { githubToken: githubToken()! } : {}),
        ...(process.env['GENERATORAI_GITHUB_HOST'] ?? process.env['COPILOT_GH_HOST']
          ? { githubHost: (process.env['GENERATORAI_GITHUB_HOST'] ?? process.env['COPILOT_GH_HOST'])! }
          : {}),
      },
    });
    await scmConfig.load();
    const scmFlow = new SourceControlFlowService({
      git: gitManager,
      registry: scmRegistry,
      readiness: new RepoReadinessService({
        git: gitManager,
        registry: scmRegistry,
        logger,
        settings: () => scmConfig.getSettings(),
      }),
      text: new ScmTextGenerator({ harness, logger, generation: () => scmConfig.generation() }),
      logger,
      settings: () => scmConfig.getSettings(),
    });

    // ── Run sandbox (same provider choice as the server) ──
    const sandbox = resolved.sandbox.enabled
      ? await createRunSandbox({ provider: resolved.sandbox.preferDocker === false ? 'host' : 'auto' }, logger)
      : null;

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
      chatEntityRepo: repos.chatEntityRepo,
      workflowDefinitionStore: repos.workflowDefinitionStore,
      workflowRunRepo: repos.workflowRunRepo,
      stageRunRepo: repos.stageRunRepo,
      automationRepo: repos.automationRepo,
      automationExecutionRepo: repos.automationExecutionRepo,
      registerRepo: repos.registerRepo,
      entryRepo: repos.entryRepo,
      // P04 — the invocation path: idempotency, staged uploads, the codebases a run mounts.
      idempotencyKeyRepo: repos.idempotencyKeyRepo,
      invocationUploadRepo: repos.invocationUploadRepo,
      projectCodebaseRepo: repos.projectCodebaseRepo,
      engineStores: createEngineStores(db),
      toHarnessError: harnessErrorOf,
      engineOwnerLabel: `sdk:${process.pid}`,
      workspaceManager,
      // The engine's one concurrency gate (W-66): stage launches use the ordinary lane.
      admissionController: new AdmissionController({ ordinaryConcurrency: resolved.maxConcurrentStages }),
      scmFlow,
      config: {
        artifactsDir: resolved.artifactsDir,
      },
      chatExtensions: { customToolRegistry, mcpHub },
    });

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

    // The run lifecycle mounts a run's codebases like a chat's (MountService),
    // wires the project's configs and runs the sandbox, as on the server.
    const mountService = new MountService({
      mountRepo: repos.workspaceMountRepo,
      workspaceRepo: repos.executionWorkspaceRepo,
      git: gitManager,
      logger,
      workspacesDir,
      codebaseRepo: repos.projectCodebaseRepo,
      eventBus: services.eventBus,
    });
    services.engine.setLifecyclePlatform({ mounts: mountService, projectConfigs: projectConfigService, sandbox });

    // ── Stream Broker ──
    const streamBroker = new StreamBroker(repos.streamCursorRepo, logger);

    // ── Workflow Script Loader (if scripts directory exists) ──
    let scriptLoader: WorkflowScriptLoader | undefined;
    if (fs.existsSync(resolved.scriptsDir)) {
      scriptLoader = new WorkflowScriptLoader(
        logger,
        [resolved.scriptsDir],
        services.hookExecutor,
      );
      await scriptLoader.discoverScripts();
      // A script target is materialized from the loaded script.
      services.workflowInvocationService.setScripts(scriptLoader);
    }

    // ── Background lifecycle services (constructed here, started by initialize()) ──
    // Defaults mirror the server's AppConfig so SDK-embedded engines get the
    // same durability (event retention, worktree GC).
    const eventRetention = new EventRetentionService(
      db,
      { eventPayloadTtlDays: 90, sweepIntervalMs: 6 * 60 * 60 * 1000, maxDeletePerSweep: 50_000, enabled: true },
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
      streamBroker,
      workspaceManager,
      projectService,
      codebaseService,
      worktreeService,
      projectConfigService,
      browserService,
      { repos, sandbox, eventRetention, worktreeCleanup, systemArtifacts },
      scriptLoader,
      customToolRegistry,
    );
  }
}

/** Convenience alias for GeneratorAI.create() */
export async function createGeneratorAI(config: GeneratorAIConfig): Promise<GeneratorAI> {
  return GeneratorAI.create(config);
}
