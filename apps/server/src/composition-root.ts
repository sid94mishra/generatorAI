// ────────────────────────────────────────────────────────────────
// Composition Root — DI container wiring all services together
// ────────────────────────────────────────────────────────────────

import type { AppConfig, ILogger } from '@generatorai/shared';
import { createLogger } from '@generatorai/shared';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import * as path from 'node:path';
import { HarnessRegistry, MultiHarness, type HarnessType } from '@generatorai/agent-harness-providers';
import { createSecurityContext, type SecurityContext } from './composition/security.js';
import { mintLocalAdminToken } from './composition/localAdminToken.js';
import { RelayHostBroker } from './relay/RelayHostBroker.js';
import {
  ExpoPushProvider,
  PushDispatcher,
  type PushTarget,
} from '@generatorai/core';
import { createDB, migrateDB, closeDB, withTransaction, EventRetentionService, PushTokenRepository } from '@generatorai/db';
import type { AppDatabase } from '@generatorai/db';
import {
  DrizzleSessionRepository,
  DrizzleWorkflowRepository,
  DrizzleEventRepository,
  DrizzleSequenceAllocator,
  DrizzleSessionAllocationRepository,
  DrizzleStreamCursorRepository,
  DrizzleChatMessageRepository,
  DrizzleArtifactRepository,
  DrizzleWebhookRepository,
  // v2 repositories
  DrizzleChatRepository,
  DrizzleWorkflowDefinitionRepository,
  DrizzleStageDefinitionRepository,
  DrizzleStageEdgeRepository,
  DrizzleWorkflowRunRepository,
  DrizzleStageRunRepository,
  // Automation repositories
  DrizzleAutomationRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleIdempotencyKeyRepository,
  // Project & Codebase Management repositories
  DrizzleProjectRepository,
  DrizzleProjectCodebaseRepository,
  DrizzleProjectConfigRepository,
  DrizzleWorktreeRepository,
  DrizzleSystemConfigRepository,
  // Workspace Management repositories
  DrizzleExecutionWorkspaceRepository,
  DrizzleWorkspaceWorktreeRepository,
  DrizzleWorkspaceArtifactRepository,
  DrizzleCheckpointRepository,
  DrizzleReviewRepository,
  DrizzlePlanRepository,
  DrizzleAgentInteractionRepository,
  // Widget & Extension repositories
  DrizzleWidgetInstanceRepository,
} from '@generatorai/db';
import {
  // Bootstrap — shared core services factory
  createCoreServices,
  StartupRecoveryService,
  SandboxedScriptRunner,
  FetchHttpClient,
  GitManager,
  ChangeSetService,
  ChangeSummaryService,
  WorkspaceTreeService,
  CheckpointService,
  GitShadowRefStore,
  WorkspaceCheckpointService,
  ReviewThreadService,
  SourceControlService,
  SourceControlConfigService,
  SourceControlRegistry,
  GitHubProvider,
  DockerSandboxProvider,
  HostProcessSandboxProvider,
  SandboxScriptRunner,
  // orchestrator services
  WorkflowOrchestrator,
  WorkflowPreprocessor,
  ResultValidator,
  SandboxLifecycleManager,
  // Phase 4 streaming rewrite (additive)
  StreamBroker,
  // Section 8 — custom tool layer + MCP hub (harness-agnostic)
  CustomToolRegistry,
  InMemoryMcpHub,
  // DUR-05 — durable step.sleep sweeper
  DurableSleepService,
  // Project & Codebase Management services
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
  WorktreeCleanupService,
  SystemArtifactService,
  // Workspace Management service
  WorkspaceManager,
  // Workflow Script loader
  WorkflowScriptLoader,
  // Integrated Browser (v13)
  ServerPlaywrightHost,
  ElectronBridgeAdapter,
  BrowserService,
  // Integrated Terminal
  TerminalService,
  NodePtyHost,
  FallbackChildProcessHost,
  SandboxPtyHost,
  // Widgets & Extensions
  WidgetRegistry,
  WidgetService,
  ExtensionManager,
  // Extension-author built-in tools
  buildWriteExtensionTool,
  buildReloadExtensionTool,
} from '@generatorai/core';
import type {
  IAgentHarness,
  ISandboxProvider,
  TemplateRegistry,
  HookExecutor,
  ConfigResolver,
  IMcpHub,

  // Types referenced by call sites below
  EventBus,
  SessionService,
  ArtifactService,
  WebhookService,
  ErrorHandler,
  // v2 services
  SessionAllocator,
  ChatManagementService,
  OrchestratorService,
  WorkflowDefinitionService,
  DAGScheduler,
  StageExecutionService,
  WorkflowRunService,
  // automation services
  AutomationService,
  // Track A1 — boot reconciler + idempotency sweeper
  AutomationRecoveryService,
  // HITL-03 — human-in-the-loop interrupt/resume service
  HitlService,
  AgentInteractionService,
  PlanService,
  ChatManagementServiceExtensions} from '@generatorai/core';
// PRV-01 — harness provider is created via the unified factory from
// @generatorai/agent-harness-providers. Dynamic imports ensure SDK
// dependencies are optional at runtime.
// Legacy streaming imports removed in CLN-12 — unified /api/stream is the only transport.

export async function createContainer(config: AppConfig): Promise<Container> {
  const logger: ILogger = createLogger({ level: config.logLevel ?? 'info', service: 'generatorai' });

  // ── Infrastructure ──
  // DB-01 — driver seam: GENERATORAI_DATABASE_URL (e.g. postgres://…) selects a
  // provider via the config switch without code changes. Unset ⇒ the SQLite
  // path. Non-SQLite drivers are recognized and throw a clear "not yet wired"
  // error (see packages/db/PORTABILITY.md). migrateDB only runs for SQLite
  // because createDB throws first for other drivers.
  const db: AppDatabase = createDB(process.env['GENERATORAI_DATABASE_URL'] ?? config.dbPath);
  migrateDB(db);

  // ── Security (Phase 0–2) ──
  // Built immediately after the schema exists and BEFORE any harness, route or
  // listener is created: `createSecurityContext` throws `StartupSecurityError`
  // when the process is configured in a way that would expose an
  // unauthenticated API, and we want that to happen before anything binds.
  const security = await createSecurityContext({ config, db, logger });

  // Recovery channel for a lost admin device. Only meaningful once pairing is
  // actually enforced; in unauthenticated loopback mode it would be a live
  // credential on disk that grants nothing not already freely available.
  // Minted here, published to disk only once the listener binds (see index.ts).
  const localAdminToken = security.posture.authenticationRequired
    ? mintLocalAdminToken()
    : null;

  // Outbound relay connector. Demand-driven: it stays closed until a relay
  // device is paired or a relay pairing is requested.
  const relayHostBroker = new RelayHostBroker({
    security,
    logger,
    enabled: config.security.relayEnabled,
    directorUrl: config.security.relayDirectorUrl,
    signingKey: security.relaySigningKey,
  });

  // ── Harness Providers (multi-provider) ──
  // Every installed provider runs side by side. `harness.type` only decides
  // which one is used when a request doesn't name one; a chat, a workflow
  // stage or an orchestrator subagent can each pick a different provider by
  // passing `harnessType` (or simply a model that belongs to that provider).
  const primaryHarnessType = (config.harness?.type ?? 'copilot') as HarnessType;

  /**
   * Isolated config/home directory for a harness instance.
   *
   * OFF by default. Set `GENERATORAI_HARNESS_ISOLATED_HOMES=1` to enable.
   *
   * ── Why it is opt-in ────────────────────────────────────────────
   *
   * Enabling this unconditionally silently broke `copilot /login`. The
   * provider injects the path as `COPILOT_HOME`, and the Copilot CLI keeps
   * `config.json` — which records `lastLoggedInUser`, i.e. WHICH host to
   * authenticate against — inside that home. Point the CLI at a fresh
   * directory and it forgets the user's GHEC tenant, falls back to
   * github.com, and that identity has no Copilot entitlement:
   *
   *   COPILOT_HOME=<fresh dir>                   → 403 "unauthorized: not
   *                                                authorized to use this
   *                                                Copilot feature"
   *   COPILOT_HOME=<fresh dir> + COPILOT_GH_HOST → "Not authenticated.
   *                                                Please authenticate first."
   *
   * Either way `models.list` fails, the provider reports
   * `authenticated: false`, drops out of the model catalog, and the UI shows
   * "not connected" to a user who really did log in. Claude masked the
   * problem because its credentials do not live in `CLAUDE_CONFIG_DIR`.
   *
   * Note this canNOT be inferred from the filesystem: the CLI creates the
   * directory (and a stub `config.json` with no user in it) the first time it
   * runs, so "does the directory exist" is true forever after the first
   * failure. Multi-account isolation therefore has to be an explicit choice,
   * and whoever turns it on is responsible for running `/login` against each
   * instance home.
   */
  const isolatedHarnessHomes = process.env['GENERATORAI_HARNESS_ISOLATED_HOMES'] === '1';

  const harnessHomeDir = (instanceId: string): string | undefined =>
    isolatedHarnessHomes
      ? path.join(path.dirname(resolve(config.dbPath)), 'harnesses', instanceId, 'home')
      : undefined;

  /** Per-provider construction options, resolved lazily by the registry. */
  const buildHarnessConfig = (type: HarnessType) => ({
    type,
    copilot: type === 'copilot' ? {
      useStdio: config.copilot.useStdio,
      defaultModel: config.copilot.defaultModel,
      defaultTimeoutMs: config.copilot.defaultTimeoutMs,
      defaultCwd: config.artifactsDir,
      autoRestart: config.copilot.autoRestart,
      cliPath: config.copilot.cliPath ?? undefined,
      githubToken: config.copilot.githubToken ?? undefined,
      githubHost: config.copilot.githubHost ?? undefined,
      homeDir: harnessHomeDir(type),
    } : undefined,
    claudeAgent: type === 'claude-agent' ? {
      defaultModel: config.harness?.claudeAgent?.defaultModel ?? 'sonnet',
      defaultCwd: config.artifactsDir,
      defaultEffort: config.harness?.claudeAgent?.effort ?? 'high',
      defaultPermissionMode: config.harness?.claudeAgent?.permissionMode ?? 'bypassPermissions',
      defaultMaxTurns: config.harness?.claudeAgent?.maxTurns,
      defaultMaxBudgetUsd: config.harness?.claudeAgent?.maxBudgetUsd,
      // HITL-07 — share the same "stuck session" watchdog value as Copilot.
      // Claude uses a rolling-window timer that pauses while a permission
      // request is in flight, so slow human approvals don't spuriously abort.
      defaultTimeoutMs: config.copilot.defaultTimeoutMs,
      includePartialMessages: config.harness?.claudeAgent?.includePartialMessages ?? true,
      enableFileCheckpointing: config.harness?.claudeAgent?.enableFileCheckpointing ?? false,
      verbose: config.logLevel === 'debug',
      homeDir: harnessHomeDir(type),
    } : undefined,
  });

  const harnessRegistry = new HarnessRegistry({
    buildConfig: buildHarnessConfig,
    primary: primaryHarnessType,
    logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m) },
  });
  const multiHarness = new MultiHarness(
    harnessRegistry,
    undefined,
    { info: (m) => logger.info(m), warn: (m) => logger.warn(m) },
  );
  logger.info(`[Container] Harness registry created (primary=${primaryHarnessType})`);

  const harness: IAgentHarness = multiHarness;

  const scriptRunner = new SandboxedScriptRunner(logger);
  const httpClient = new FetchHttpClient();
  const gitManager = new GitManager(scriptRunner, logger, {
    workspacesDir: config.workspacesDir,
  });

  // ── Change-set engine (centralized diff/status) ──
  const changeSetService = new ChangeSetService(gitManager, logger);

  // ── Source Control (VCS-host provider registry + service) ──
  // GitHub is the only provider for now. Configuration comes from persisted
  // settings (loaded later) with env fallbacks. Default active provider is
  // resolved from GENERATORAI_SCM_PROVIDER, else 'github' when a token is set,
  // else 'none'.
  const scmRegistry = new SourceControlRegistry();
  const githubToken =
    process.env['GENERATORAI_GITHUB_TOKEN'] ??
    process.env['GITHUB_TOKEN'] ??
    process.env['GH_TOKEN'] ??
    undefined;
  const githubHost = process.env['GENERATORAI_GITHUB_HOST'] ?? process.env['COPILOT_GH_HOST'] ?? undefined;
  scmRegistry.register(
    new GitHubProvider(
      httpClient,
      logger,
      { token: githubToken, host: githubHost, allowCliFallback: true },
      scriptRunner,
    ),
  );
  const scmEnv = process.env['GENERATORAI_SCM_PROVIDER'];
  const initialActive: 'github' | 'none' =
    scmEnv === 'github' || scmEnv === 'none' ? scmEnv : githubToken ? 'github' : 'none';
  scmRegistry.setActive(initialActive);
  const sourceControlService = new SourceControlService(scmRegistry, gitManager, logger);

  // Persistent provider config (JSON-file backed under the data dir).
  const sourceControlConfigService = new SourceControlConfigService(scmRegistry, {
    http: httpClient,
    processRunner: scriptRunner,
    logger,
    configDir: resolve(config.dbPath, '..'),
    initial: {
      activeProvider: initialActive,
      github: { token: githubToken, host: githubHost },
    },
  });
  await sourceControlConfigService.load();
  logger.info(`[Container] Source control provider active=${scmRegistry.getActive()}`);

  // ── Sandbox Infrastructure (conditional) ──
  let sandboxProvider: ISandboxProvider | undefined;
  let sandboxLifecycleManager: SandboxLifecycleManager | undefined;

  if (config.sandbox.enabled) {
    // Determine which provider to use
    const wantDocker = config.sandbox.provider === 'docker' || config.sandbox.provider === 'auto';
    let dockerAvailable = false;

    if (wantDocker) {
      const dockerProvider = new DockerSandboxProvider(logger);
      dockerAvailable = await dockerProvider.isAvailable();

      if (dockerAvailable) {
        sandboxProvider = dockerProvider;
        logger.info('[Container] Docker Sandbox detected — using microVM isolation');
      } else if (config.sandbox.provider === 'docker') {
        // User explicitly requested Docker but it's not available
        logger.error('[Container] Docker Sandbox not available but provider=docker was specified');
        throw new Error(
          'Sandbox mode requires Docker Desktop with Sandbox support. ' +
          'Set sandbox.provider to "auto" or "host" for fallback, or disable sandbox mode.',
        );
      }
    }

    if (!sandboxProvider) {
      // Host-process fallback has NO hypervisor isolation — agent-generated
      // code runs directly on the host. Require explicit opt-in (either by
      // choosing `provider='host'` or by setting the env var below) to prevent
      // users who configured `auto` from silently running unsandboxed.
      const hostExplicit = config.sandbox.provider === 'host';
      const hostAllowed = process.env['GENERATORAI_ALLOW_HOST_SANDBOX'] === 'true';
      if (!hostExplicit && !hostAllowed) {
        logger.error(
          '[Container] Docker Sandbox unavailable and host-process fallback not opted in. ' +
          'Either install Docker, set sandbox.provider="host" explicitly, ' +
          'or set GENERATORAI_ALLOW_HOST_SANDBOX=true to proceed without isolation.',
        );
        throw new Error(
          'Sandbox fallback to host-process requires explicit opt-in. ' +
          'Set GENERATORAI_ALLOW_HOST_SANDBOX=true or sandbox.provider="host".',
        );
      }
      sandboxProvider = new HostProcessSandboxProvider(logger);
      // Use ERROR level so this cannot be missed in log scrapers; agent code
      // running on the host is a production hazard.
      logger.error(
        '[Container] SANDBOX ISOLATION DISABLED — using host-process fallback. ' +
        'Agent-generated code will run with the server process\'s privileges. ' +
        `(opt-in source: ${hostExplicit ? 'sandbox.provider="host"' : 'GENERATORAI_ALLOW_HOST_SANDBOX=true'})`,
      );
    }

    sandboxLifecycleManager = new SandboxLifecycleManager(
      sandboxProvider,
      {
        image: config.sandbox.image,
        cliPort: config.sandbox.cliPort,
        startupTimeoutMs: config.sandbox.startupTimeoutMs,
        dockerAvailable,
      },
      logger,
    );

    logger.info(`[Container] Sandbox mode ENABLED (provider: ${dockerAvailable ? 'docker' : 'host-fallback'})`);
  }

  // ── Repositories (v1) ──
  const sessionRepo = new DrizzleSessionRepository(db);
  const workflowRepo = new DrizzleWorkflowRepository(db);
  const eventRepo = new DrizzleEventRepository(db);
  const chatMessageRepo = new DrizzleChatMessageRepository(db);
  const artifactRepo = new DrizzleArtifactRepository(db);
  const webhookRepo = new DrizzleWebhookRepository(db);

  // ── Repositories (v2) ──
  const chatEntityRepo = new DrizzleChatRepository(db);
  const workflowDefinitionRepo = new DrizzleWorkflowDefinitionRepository(db);
  const stageDefinitionRepo = new DrizzleStageDefinitionRepository(db);
  const stageEdgeRepo = new DrizzleStageEdgeRepository(db);
  const workflowRunRepo = new DrizzleWorkflowRunRepository(db);
  const stageRunRepo = new DrizzleStageRunRepository(db);

  // ── Automation Repositories ──
  const automationRepo = new DrizzleAutomationRepository(db);
  const automationExecutionRepo = new DrizzleAutomationExecutionRepository(db);
  // Track A3 — idempotency-key store.
  const idempotencyKeyRepo = new DrizzleIdempotencyKeyRepository(db);

  // ── Project & Codebase Management Repositories ──
  const projectRepo = new DrizzleProjectRepository(db);
  const projectCodebaseRepo = new DrizzleProjectCodebaseRepository(db);
  const projectConfigRepo = new DrizzleProjectConfigRepository(db);
  const worktreeRepo = new DrizzleWorktreeRepository(db);
  const systemConfigRepo = new DrizzleSystemConfigRepository(db);

  // ── Workspace Management Repositories ──
  const executionWorkspaceRepo = new DrizzleExecutionWorkspaceRepository(db);
  const workspaceWorktreeRepo = new DrizzleWorkspaceWorktreeRepository(db);
  const workspaceArtifactRepo = new DrizzleWorkspaceArtifactRepository(db);

  // ── Widget & Extension Repositories ──
  const widgetInstanceRepo = new DrizzleWidgetInstanceRepository(db);

  // DrizzleSequenceAllocator provides cross-process safe, SQL-allocated
  // sequence IDs. Without it, the in-memory counter in EventRepository
  // can collide when multiple processes write to the same DB.
  const sequenceAllocator = new DrizzleSequenceAllocator(db);
  // Persist SessionAllocator state (Phase 1, 1.6) so a restart doesn't
  // orphan SDK sessions.
  const sessionAllocationRepo = new DrizzleSessionAllocationRepository(db);

  // Section 8 (TOL-01 / TOL-06) — harness-agnostic tool + MCP layer.
  // Declared BEFORE `createCoreServices` so they can be threaded into
  // `ChatManagementService` via `chatExtensions`. Empty registry + pass-
  // through MCP hub keep behaviour identical to pre-rollout until a
  // module registers a tool or overrides an MCP server.
  const customToolRegistry = new CustomToolRegistry();
  const mcpHub: IMcpHub = new InMemoryMcpHub();

  // Chat extensions object — passed by reference to createCoreServices.
  // `worktreeService` is set later after project services are created.
  const chatExtensions: ChatManagementServiceExtensions = {
    customToolRegistry,
    mcpHub,
  };

  // Core services factory — shared with the CLI composition root. Any
  // change to the service graph lands in one place. Platform-specific
  // wiring (stream manager, sandbox manager, orchestrator stack) stays
  // here.
  const core = createCoreServices({
    logger,
    harness,
    scriptRunner,
    httpClient,
    gitManager,
    sequenceAllocator,
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
    sessionAllocationRepo,
    // Wire the sandbox lifecycle manager as the orphan reaper so
    // StartupRecoveryService can call `cleanupOrphans()` on boot to
    // destroy `genai-run-*` containers left behind by a crash.
    sandboxCleaner: sandboxLifecycleManager,
    config: {
      artifactsDir: config.artifactsDir,
      maxConcurrentSessions: config.maxConcurrentSessions,
      // P1#7 — bound concurrent stage execution (harness subprocess fan-out).
      // Env-overridable; defaults to 8 inside createCoreServices when undefined.
      maxConcurrentStages: process.env['MAX_CONCURRENT_STAGES']
        ? parseInt(process.env['MAX_CONCURRENT_STAGES'], 10)
        : undefined,
      webhooks: config.webhooks,
      projectRoot: config.projectRoot,
    },
    // Atomically commit multi-row writes (run + stage_rows, automation open);
    // a mid-sequence failure rolls back.
    withTransaction: (fn) => withTransaction(db, fn),
    // Section 8 — thread harness-agnostic extensions into ChatManagementService.
    // Until a module registers tools / overrides MCP / installs a HookBridge
    // factory, every handler here is a no-op at runtime.
    // Section 8 — thread harness-agnostic extensions into ChatManagementService.
    // Until a module registers tools / overrides MCP / installs a HookBridge
    // factory, every handler here is a no-op at runtime.
    // `worktreeService` is set *after* project service creation below.
    chatExtensions,
    // PLN-01 — plan mode persistence.
    planRepo: new DrizzlePlanRepository(db),
    agentInteractionRepo: new DrizzleAgentInteractionRepository(db),
  });

  const {
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
    automationService,
    automationRecoveryService,
    hitlService,
    planService,
    agentInteractionService,
    dataSourceResolver,
  } = core;

  // STR-01 / CLN-12 — `StreamBroker` is now the only streaming transport.
  // Web clients subscribe via the unified `/api/stream?scope=<s>&id=<id>`
  // endpoint (Phase 4). The legacy `DurableStreamManager` + per-route
  // ring buffers + module-level `streamSubscriptions` fan-out were all
  // deleted once the web migration landed.
  const streamCursorRepo = new DrizzleStreamCursorRepository(db);
  const streamBroker = new StreamBroker(streamCursorRepo, logger);

  // Bridge legacy EventBus → broker so both transports see the same events.
  //
  // Routing rules:
  //   - sessionId === '__global__' → scope='global', id='all'
  //   - any event whose payload references a `workflowRunId` → ALSO
  //     published to scope='run', id=<workflowRunId>
  //   - any event whose payload references a `chatId` → ALSO
  //     published to scope='chat', id=<chatId>
  //   - otherwise → scope='session', id=<sessionId>
  //
  // We deliberately republish the SAME event to multiple scopes so each
  // scope has its own monotonic sequence for Last-Event-ID resume. This
  // is copy-on-read, not fan-out in the broker itself — the broker treats
  // each scope independently.
  //
  // WorkflowRun + Chat producers can also call streamBroker.publish()
  // directly on their own scopes once STR-04 migrates callers off the
  // EventBus; the bridge below is transitional.
  const publishToBroker = (
    scope: 'session' | 'run' | 'chat' | 'global' | 'automation',
    scopeId: string,
    kind: string,
    data: unknown,
  ): void => {
    streamBroker.publish(scope, scopeId, kind, data).catch((err) => {
      logger.warn?.(
        `[StreamBroker] bridge publish failed for ${scope}:${scopeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  };

  // EVT-03 — defensive indexed reads instead of `as Record<string, unknown>`.
  // We don't know the exact AgentEvent kind here (this is the universal
  // bridge), but the two FK fields we need are well-known across the union.
  const readString = (obj: unknown, key: string): string | undefined => {
    if (obj && typeof obj === 'object' && key in obj) {
      const val = (obj as { [k: string]: unknown })[key];
      return typeof val === 'string' ? val : undefined;
    }
    return undefined;
  };

  const bridgeEvent = (event: {
    sessionId: string;
    kind: string;
    data: unknown;
  }): void => {
    const runId = readString(event.data, 'workflowRunId');
    const chatId = readString(event.data, 'chatId');
    // Track B — automation execution events also fan out to their own
    // scope so `GET /api/stream?scope=automation&id=<executionId>` works.
    const executionId = readString(event.data, 'executionId');

    // Primary scope. Global events go to global; session events to session.
    const primaryScope = event.sessionId === '__global__' ? 'global' : 'session';
    const primaryId = event.sessionId === '__global__' ? 'all' : event.sessionId;
    publishToBroker(primaryScope, primaryId, event.kind, event.data);

    // Secondary per-entity scopes — makes /api/stream?scope=run&id=X work.
    if (runId) publishToBroker('run', runId, event.kind, event.data);
    if (chatId) publishToBroker('chat', chatId, event.kind, event.data);
    if (executionId && event.kind.startsWith('automation_execution.')) {
      publishToBroker('automation', executionId, event.kind, event.data);
    }
  };

  eventBus.subscribeAll(bridgeEvent);
  eventBus.subscribeGlobal((event) => {
    // Global events arrive with sessionId='__global__' already, but some
    // callers emit with a concrete sessionId plus a global fanout. Route
    // consistently so global scope gets the event exactly once.
    bridgeEvent({ sessionId: '__global__', kind: event.kind, data: event.data });
  });

  // (StreamSubscriptions + DurableStreamManager fan-out removed — CLN-12.)

  // DB-04 — background retention sweeper for the events + stream_cursors
  // tables. Runs every `sweepIntervalMs` and deletes rows older than
  // `eventPayloadTtlDays`, capped by `maxDeletePerSweep` per table so the
  // sweep can't monopolise the SQLite write lock. Disabled in tests/CI via
  // `retention.enabled: false` in the Zod config.
  const eventRetentionService = new EventRetentionService(
    db,
    config.retention,
    logger,
  );

  // DUR-05 — durable step.sleep sweeper. Flips `sleeping → queued` for
  // stage rows whose `wake_at` has passed and then invokes `onWake` to
  // resume execution. Stage code calls `durableSleepService.sleep(...)`
  // to park a running stage; the sweeper owns the reverse transition.
  //
  // `onWake` lives in the composition root because it bridges two
  // services — it needs `stageExecutionService` (to re-run the stage)
  // AND `workflowRunRepo` (to fetch the run's sessionMode). Keeping it
  // here avoids pulling either concern into `DurableSleepService`.
  const durableSleepService = new DurableSleepService(
    stageRunRepo,
    eventBus,
    async (stage) => {
      try {
        const run = await workflowRunRepo.getById(stage.workflowRunId);
        // Fire-and-forget: the stage execution path already plumbs
        // onStageCompleted / onStageFailed through WorkflowRunService,
        // so the run loop continues on its own once executeStage
        // resolves / rejects.
        stageExecutionService
          .executeStage(stage, stage.workflowRunId, run.sessionMode)
          .then(() => workflowRunService.onStageCompleted(stage.workflowRunId, stage.id))
          .catch((err) => workflowRunService.onStageFailed(stage.workflowRunId, stage.id, err));
      } catch (err) {
        logger.error(`[DurableSleep] Failed to resume woken stage ${stage.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    config.durableSleep,
    logger,
  );

  // ── Orchestrator Services ──

  const workflowPreprocessor = new WorkflowPreprocessor(
    gitManager,
    scriptRunner,
    eventBus,
    logger,
    sourceControlService,
  );

  const resultValidator = new ResultValidator(
    chatMessageRepo,
    stageRunRepo,
    eventBus,
    logger,
    scriptRunner,
  );

  // ── Project & Codebase Management Services ──
  const projectService = new ProjectService(
    projectRepo,
    projectCodebaseRepo,
    projectConfigRepo,
    config.artifactsDir,
    logger,
  );

  const codebaseService = new CodebaseService(
    projectCodebaseRepo,
    projectService,
    gitManager,
    logger,
  );

  const worktreeService = new WorktreeService(
    worktreeRepo,
    projectCodebaseRepo,
    projectService,
    gitManager,
    logger,
  );

  const projectConfigService = new ProjectConfigService(
    projectConfigRepo,
    projectService,
    logger,
  );

  const systemArtifactService = new SystemArtifactService(
    systemConfigRepo,
    resolve(config.templatesDir, 'system', 'artifacts'),
    logger,
  );

  const worktreeCleanupService = new WorktreeCleanupService(
    worktreeService,
    worktreeRepo,
    projectRepo,
    workflowRunRepo,
    logger,
    // Chat repo lets the orphan check correctly evaluate chat-owned worktrees
    // (runType 'manual') instead of mis-classifying every live chat worktree.
    chatEntityRepo,
  );

  // ── Workspace Manager ──
  const workspaceManager = new WorkspaceManager(
    executionWorkspaceRepo,
    workspaceWorktreeRepo,
    workspaceArtifactRepo,
    {
      workspacesDir: config.workspacesDir,
      defaultGitEnabled: true,
    },
    logger,
    gitManager,
  );

  // ── Checkpoints (workspace snapshots via private git refs) ──
  //
  // Snapshots are commit objects reachable only from
  // `refs/generatorai/checkpoints/…`. They never touch the user's index,
  // HEAD, branches or remotes, and are the baseline primitive for per-turn
  // diffs, stable review anchors and rewind.
  const checkpointRepo = new DrizzleCheckpointRepository(db);
  const snapshotStore = new GitShadowRefStore(gitManager, logger);
  const checkpointService = new CheckpointService(
    snapshotStore,
    checkpointRepo,
    gitManager,
    logger,
  );
  const workspaceCheckpointService = new WorkspaceCheckpointService(
    checkpointService,
    executionWorkspaceRepo,
    workspaceWorktreeRepo,
    gitManager,
    logger,
  );
  // Checkpoint activity drives the Changes panel via `workspace.changed`,
  // which is what lets us drop the panel's polling loop entirely.
  workspaceCheckpointService.setEventBus(eventBus);

  // Summary-first change engine. Diffs against a CHECKPOINT (session
  // baseline / a specific turn / a stage) rather than "first commit ∪ working
  // tree", which is what makes "what did this message change?" answerable.
  const changeSummaryService = new ChangeSummaryService(
    gitManager,
    {
      getBaseline: (workspaceId, repoAlias) =>
        checkpointService.getBaseline(workspaceId, repoAlias),
      getById: (id) => checkpointService.getById(id),
      getLatest: (workspaceId, repoAlias) =>
        checkpointService.getLatest(workspaceId, repoAlias),
    },
    logger,
  );

  // "What files are here?" — the browsing counterpart to the change summary.
  // Kept as its own service because its cache lifetime is completely
  // different: the path list only moves when files are created or deleted,
  // while the summary moves on every write.
  const workspaceTreeService = new WorkspaceTreeService(gitManager, logger);

  // ── Review threads (inline comments on diffs) ──
  //
  // The content reader is what lets a comment survive later edits: the
  // service re-hashes the anchored lines against current file content and
  // walks the patch to find where they moved to.
  const reviewRepo = new DrizzleReviewRepository(db);
  const reviewThreadService = new ReviewThreadService(
    reviewRepo,
    {
      readCurrent: async (workspaceId, repoAlias, filePath) => {
        const info = await workspaceManager.getWorkspaceInfo(workspaceId);
        if (!info) return null;
        const versions = await changeSummaryService.getFileVersions({
          workspaceId,
          rootPath: info.rootPath,
          worktrees: (info.worktrees ?? []).map((wt) => ({
            alias: wt.alias,
            worktreePath: path.join(info.rootPath, wt.worktreePath),
          })),
          head: { kind: 'working' },
          autoInit: false,
          filePath,
          alias: repoAlias,
        });
        return versions.new?.contents ?? null;
      },
      readPatchSince: async (workspaceId, repoAlias, filePath, fromCheckpointId) => {
        const info = await workspaceManager.getWorkspaceInfo(workspaceId);
        if (!info) return null;
        const result = await changeSummaryService.getFilePatch({
          workspaceId,
          rootPath: info.rootPath,
          worktrees: (info.worktrees ?? []).map((wt) => ({
            alias: wt.alias,
            worktreePath: path.join(info.rootPath, wt.worktreePath),
          })),
          base: { kind: 'checkpoint', id: fromCheckpointId },
          head: { kind: 'working' },
          autoInit: false,
          filePath,
          alias: repoAlias,
        });
        return result.patch || null;
      },
    },
    logger,
  );

  // Review threads annotate workspace files, so they die with the workspace.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await reviewThreadService.deleteWorkspace(workspaceId);
  });

  // Re-anchor review comments whenever the workspace changes.
  //
  // This is what closes the comment → fix → verify loop: after the agent
  // edits, every open thread's line numbers are recomputed from its anchored
  // CONTENT (not trusted), and a submitted thread whose anchor was rewritten
  // or edited flips to `addressed`. Runs off the event bus so it never sits
  // in the agent's critical path.
  eventBus.subscribeAll((event) => {
    if (event.kind !== 'checkpoint.created') return;
    const data = event.data as {
      workspaceId?: string;
      checkpointId?: string;
      repoAlias?: string;
    };
    if (!data.workspaceId || !data.checkpointId) return;

    void (async () => {
      try {
        const info = await workspaceManager.getWorkspaceInfo(data.workspaceId!);
        if (!info) return;
        // A checkpoint means the working tree just settled. Drop the memoised
        // snapshot first: it is only meant to keep ONE panel render
        // self-consistent, and reusing it here would re-anchor review threads
        // against the pre-edit file list — and leave clients refetching into
        // the same stale entry, since they react to this very event.
        changeSummaryService.invalidateWorkingTree();
        const summary = await changeSummaryService.getSummary({
          workspaceId: data.workspaceId!,
          rootPath: info.rootPath,
          worktrees: (info.worktrees ?? []).map((wt) => ({
            alias: wt.alias,
            worktreePath: path.join(info.rootPath, wt.worktreePath),
          })),
          autoInit: false,
        });
        const files = summary.repos.flatMap((repo) =>
          repo.files.map((f) => ({ repoAlias: repo.alias, path: f.path })),
        );
        if (files.length === 0) return;

        const result = await reviewThreadService.reanchorFiles(
          data.workspaceId!,
          files,
          data.checkpointId,
        );
        if (result.updated || result.outdated || result.addressed) {
          logger.info(
            `[Review] Re-anchored threads for ${data.workspaceId}: ` +
              `${result.updated} moved, ${result.addressed} addressed, ${result.outdated} outdated`,
          );
        }
      } catch (err) {
        logger.warn(`[Review] Re-anchor failed for ${data.workspaceId}: ${err}`);
      }
    })();
  });

  // Checkpoint rows outlive the workspace directory, so drop them (and any
  // pending rolling capture) as part of workspace teardown.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await workspaceCheckpointService.forget(workspaceId);
  });

  // ── Push notifications ─────────────────────────────────────────
  //
  // Opt-out (`GENERATORAI_PUSH=0`) rather than opt-in: an approval gate
  // raised while the app is closed is invisible without this, which
  // undercuts the whole point of a companion app. But it degrades cleanly —
  // a server with push disabled simply returns 501 from the registration
  // route, and every client stays fully usable.
  const pushEnabled = process.env['GENERATORAI_PUSH'] !== '0';
  const pushTokens = pushEnabled ? new PushTokenRepository(db) : null;
  let pushTargets: PushTarget[] = [];

  if (pushTokens) {
    const dispatcher = new PushDispatcher({
      // Snapshot refreshed off the device list rather than read per event:
      // `DeviceService.getDevice` is async and the dispatcher decision path
      // is deliberately synchronous so it can never stall the event bus.
      //
      // The window this opens is bounded and closed from both ends: the
      // refresh below runs on a short interval, AND revoking a device
      // deletes its push row via the ON DELETE CASCADE, so a revoked device
      // stops receiving notifications on the next refresh at the latest.
      listTargets: () => pushTargets,
      recordSuccess: (deviceId) => pushTokens.recordSuccess(deviceId),
      recordFailure: (deviceId, error) => pushTokens.recordFailure(deviceId, error),
      provider: new ExpoPushProvider(httpClient, {
        accessToken: process.env['EXPO_ACCESS_TOKEN'],
      }),
      logger,
    });

    const refreshPushTargets = async (): Promise<void> => {
      try {
        const devices = await security.devices.listDevices(false);
        const byId = new Map(devices.map((d) => [d.deviceId, d]));
        pushTargets = pushTokens
          .listAll()
          .flatMap((record) => {
            const device = byId.get(record.deviceId);
            // Unknown or revoked → no notification. The body carries readable
            // content, so a stale target would leak it.
            if (!device || device.revokedAt) return [];
            return [
              {
                deviceId: record.deviceId,
                scopes: device.scopes,
                token: record.token,
                provider: record.provider,
                platform: record.platform,
                mutedUntil: record.mutedUntil,
              } satisfies PushTarget,
            ];
          });
      } catch (err) {
        logger.warn('[Push] Could not refresh device targets', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    eventBus.subscribeAll((event) => {
      dispatcher.handleEvent({ kind: event.kind, data: event.data });
    });

    const pushRefreshTimer = setInterval(() => void refreshPushTargets(), 30_000);
    pushRefreshTimer.unref?.();
    const pushPruneTimer = setInterval(() => dispatcher.pruneDedupeCache(), 300_000);
    pushPruneTimer.unref?.();
    void refreshPushTargets();
  }

  const workflowOrchestrator = new WorkflowOrchestrator(
    workflowRunService,
    workflowDefinitionService,
    workflowPreprocessor,
    resultValidator,
    stageRunRepo,
    stageDefinitionRepo,
    workflowRunRepo,
    eventBus,
    templateRegistry,
    logger,
    config.artifactsDir,
    sandboxLifecycleManager,
    sandboxProvider,
    worktreeService,
    projectService,
    projectConfigService,
    workspaceManager,
    hookExecutor,
  );

  // Late-wire workspaceManager into services that were created before it.
  workflowRunService.setWorkspaceManager(workspaceManager);
  workflowRunService.setWorktreeService(worktreeService, projectCodebaseRepo);
  workflowRunService.setHookExecutor(hookExecutor);
  workflowRunService.setResultValidator(resultValidator);
  stageExecutionService.setWorkspaceManager(workspaceManager);
  stageExecutionService.setWorkspaceCheckpointService(workspaceCheckpointService);

  // ── Register built-in function hook handlers ──
  // These handlers demonstrate the HookResult return channel and can be
  // referenced in workflow definitions via config: { type: 'function', handlerName: '...' }

  hookExecutor.registerFunctionHandler('enrichContext', async (ctx) => {
    // Reads a variable and returns context messages + variables for downstream stages
    const source = ctx.args?.['source'] as string | undefined;
    const contextText = ctx.args?.['contextText'] as string | undefined;
    return {
      variables: {
        enrichedBy: 'enrichContext hook',
        enrichedAt: new Date().toISOString(),
        ...(source ? { hookSource: source } : {}),
      },
      contextMessages: contextText ? [{ content: contextText }] : [],
    };
  });

  hookExecutor.registerFunctionHandler('injectRequirements', async (ctx) => {
    // Simulates an external API call that returns requirements as context
    const project = ctx.variables?.['projectName'] ?? ctx.args?.['project'] ?? 'Default Project';
    return {
      variables: {
        projectName: String(project),
        hookInjected: 'true',
      },
      contextMessages: [{
        content: `## Project Requirements (injected by hook)\n\n` +
          `**Project:** ${project}\n\n` +
          `The following requirements were fetched by the pre-run hook:\n` +
          `1. Implement clean, modular TypeScript code\n` +
          `2. Include comprehensive error handling\n` +
          `3. Follow REST API best practices\n` +
          `4. Write production-ready code with proper types\n`,
      }],
    };
  });

  hookExecutor.registerFunctionHandler('addAttachment', async (ctx) => {
    // Returns a file attachment that gets written to the workspace
    const filename = (ctx.args?.['filename'] as string) ?? 'hook-data.json';
    const data = ctx.args?.['data'] ?? { message: 'Data from hook', timestamp: new Date().toISOString() };
    return {
      attachments: [{
        filename,
        content: JSON.stringify(data, null, 2),
        contentType: 'application/json',
      }],
      variables: {
        attachmentFile: filename,
      },
    };
  });

  hookExecutor.registerFunctionHandler('logCompletion', async (ctx) => {
    // Post-run hook - logs completion info (no return needed)
    logger.info(`[Hook:logCompletion] Workflow ${ctx.workflowId} completed. Variables: ${JSON.stringify(Object.keys(ctx.variables))}`);
  });

  // Late-wire worktreeService into ChatManagementService extensions.
  // The chatExtensions object was passed by reference to createCoreServices,
  // so mutating it here takes effect inside ChatManagementService.
  chatExtensions.worktreeService = worktreeService;
  chatExtensions.workspaceManager = workspaceManager;
  // Per-turn snapshots: captured just before every prompt so the Changes
  // panel can answer "what did this message change?" and `/rewind` has an
  // anchor to restore to.
  chatExtensions.workspaceCheckpointService = workspaceCheckpointService;
  // Give the orchestrator the workspace manager so it can write the shared
  // `orchestrator/state.json` scratchpad into the (shared) workspace.
  orchestratorService.setWorkspaceManager(workspaceManager);
  chatExtensions.codebaseRepo = projectCodebaseRepo;  // ── Integrated Browser (v13) ──
  // BrowserService owns the per-workspace Chromium lifecycle. The bridge
  // chain is tried in order: `ElectronBridgeAdapter` first (only available
  // when running under the desktop shell with
  // `GENERATORAI_DESKTOP_NATIVE_BROWSER=1` — it `connectOverCDP`s to a
  // per-tab `ScopedCdpProxy` that Electron main pushes via
  // `POST /internal/browser/cdp-endpoint` as the active tab changes, and
  // drives the human's WCV directly, so agent + user see the same tab).
  // `ServerPlaywrightHost` is the fallback used everywhere else and by CI.
  const electronBridgeAdapter = new ElectronBridgeAdapter(logger);
  const serverPlaywrightHost = new ServerPlaywrightHost(logger);
  const browserService = new BrowserService(
    executionWorkspaceRepo,
    workspaceArtifactRepo,
    eventBus,
    logger,
    [electronBridgeAdapter, serverPlaywrightHost],
    {
      maxConcurrent: Number(process.env['GENERATORAI_BROWSER_MAX_CONCURRENT'] ?? '5'),
    },
  );

  // Register the `beforeBrowserAction` function hook so workflow authors
  // can chain their own gating logic (allowlists live inside BrowserService
  // itself; this handler is the shim that exposes the enforcement to the
  // hook system for observability).
  hookExecutor.registerFunctionHandler('browser.beforeAction', async (ctx) => {
    const workspaceId = (ctx.variables?.['browserWorkspaceId'] as string | undefined)
      ?? (ctx.args?.['workspaceId'] as string | undefined);
    const action = (ctx.args?.['action'] as string | undefined) ?? 'unknown';
    const target = ctx.args?.['target'] as string | undefined;
    if (!workspaceId) return; // No workspace context — nothing to gate
    const result = await browserService.beforeBrowserActionHook(workspaceId, action, target);
    if (!result.allow) {
      return {
        variables: { browserBlocked: 'true', browserBlockReason: result.reason ?? 'blocked' },
        contextMessages: [{
          content: `[browser.beforeAction] Blocked action '${action}' on '${target}': ${result.reason ?? 'policy'}`,
        }],
      };
    }
  });

  hookExecutor.registerFunctionHandler('browser.afterAction', async (ctx) => {
    const action = ctx.args?.['action'] as string | undefined;
    const ok = ctx.args?.['ok'];
    logger.debug?.(`[Hook:browser.afterAction] action=${action ?? '?'} ok=${String(ok)}`);
  });

  // Late-wire browserService into ChatManagementService so chats with
  // `browserConfig.enabled: true` auto-boot a shared Chromium and inject
  // the CDP endpoint into the harness system prompt.
  chatExtensions.browserService = browserService;
  // Same story for stage sessions — the workflow path builds sessions
  // via StageExecutionService which needs BrowserService to register
  // the built-in browser tool set per stage.
  stageExecutionService.setBrowserService(browserService);

  // ── Integrated Terminal ──
  //
  // Host chain: `SandboxPtyHost` (only usable when the caller explicitly
  // requests `attachToSandbox: true` — Phase 2) → `NodePtyHost` (real PTY
  // via node-pty) → `FallbackChildProcessHost` (degraded child_process
  // shell used when node-pty fails to load). `TerminalService` picks the
  // first `isAvailable()` host by default, so opting into the sandbox
  // requires a spawn-time flag.
  const terminalHosts = [
    ...(sandboxLifecycleManager ? [new SandboxPtyHost(logger, sandboxLifecycleManager)] : []),
    new NodePtyHost(logger),
    new FallbackChildProcessHost(logger),
  ];
  const terminalService = new TerminalService(
    terminalHosts,
    eventBus,
    logger,
    async (workspaceId) => {
      const ws = await executionWorkspaceRepo.findById(workspaceId);
      return ws?.rootPath ?? null;
    },
  );
  terminalService.start();
  // On workspace deletion, kill any orphaned PTYs first (see R-3).
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await terminalService.killAllForWorkspace(workspaceId);
  });

  // ── Workflow Script Loader ──
  const scriptDirs = [
    resolve(config.templatesDir, 'scripts'),
    resolve(config.templatesDir),
  ];
  const workflowScriptLoader = new WorkflowScriptLoader(logger, scriptDirs, hookExecutor);

  // Late-bind script loader into DataSourceResolver for 'workflow_script' data source support
  dataSourceResolver.setScriptLoader(workflowScriptLoader);

  // ── Widgets & Extensions ──
  const widgetRegistry = new WidgetRegistry();
  const extensionManager = new ExtensionManager(
    {
      systemDir: resolve(config.templatesDir, 'system', 'extensions'),
      userDir: config.extensionsDir,
      resolveWorkspaceDir: (workspaceId) => {
        return resolve(config.workspacesDir, workspaceId, '.generatorai', 'extensions');
      },
      logger,
    },
    { widgetRegistry, customToolRegistry, eventBus },
  );
  const widgetOrigin =
    process.env['WIDGET_ORIGIN'] ??
    `http://127.0.0.1:${process.env['WIDGET_PORT'] ?? '3101'}`;
  const widgetService = new WidgetService(
    widgetInstanceRepo,
    widgetRegistry,
    extensionManager,
    eventBus,
    { assetsBase: widgetOrigin, logger },
  );

  // Widgets — wire the widget service into chat conversations so the v2
  // widget tools (render/update/close/search) get bound at conversation
  // creation. Widget iframes load from a DEDICATED origin (separate
  // loopback port, default 127.0.0.1:3101) so they are isolated from the
  // host SPA/API — the MCP-Apps sandbox-proxy origin split. Override with
  // WIDGET_ORIGIN (e.g. a packaged desktop build's loopback URL).
  chatExtensions.widgetService = widgetService;
  chatExtensions.widgetRegistry = widgetRegistry;
  chatExtensions.widgetAssetsBase = widgetOrigin;

  // Extension-authoring tools — register on the process-wide custom tool
  // registry so every chat conversation gets them automatically. The
  // agent uses these together with the "extension-author" skill to
  // scaffold, install, and reload user extensions from a chat prompt.
  customToolRegistry.register(
    buildWriteExtensionTool({ extensionManager, widgetRegistry }),
  );
  customToolRegistry.register(
    buildReloadExtensionTool({ extensionManager }),
  );

  return {
    config,
    logger,
    eventBus,
    security,
    localAdminToken,
    relayHostBroker,
    pushTokens,

    // Services
    sessionService,
    artifactService,
    webhookService,
    errorHandler,

    // v2 Services
    chatManagementService,
    orchestratorService,
    workflowDefinitionService,
    workflowRunService,
    dagScheduler,
    stageExecutionService,
    sessionAllocator,

    // Orchestrator
    workflowOrchestrator,
    gitManager,
    changeSetService,
    sourceControlService,
    sourceControlRegistry: scmRegistry,
    sourceControlConfigService,

    // Automation
    automationService,
    automationRecoveryService,
    idempotencyKeyRepo,

    // HITL (Human-in-the-Loop)
    hitlService,

    // PLN-01 — plan mode
    planService,
    agentInteractionService,

    // Project & Codebase Management
    projectService,
    codebaseService,
    worktreeService,
    projectConfigService,
    worktreeCleanupService,
    systemArtifactService,

    // Workspace Management
    workspaceManager,

    // Checkpoints (workspace snapshots / rewind)
    checkpointService,
    workspaceCheckpointService,
    checkpointRepo,
    changeSummaryService,
    workspaceTreeService,
    reviewThreadService,
    reviewRepo,

    // Integrated Browser (v13)
    browserService,
    // Exposed so routes/internal-browser.ts can push each workspace's
    // scoped CDP endpoint as Electron main's active tab changes.
    electronBridgeAdapter,
    // Expose the execution-workspace + artifact repos so routes can read
    // browser artifacts + workspace rows without a full service round-trip.
    executionWorkspaceRepo,
    workspaceArtifactRepo,

    // Integrated Terminal
    terminalService,

    // v2 Repositories (exposed for route-level queries)
    workflowRepo,
    chatEntityRepo,
    chatMessageRepo,
    workflowRunRepo,
    stageRunRepo,

    // Infrastructure exposed for routes
    harness,
    harnessRegistry,
    multiHarness,
    streamBroker,
    customToolRegistry,
    mcpHub,
    durableSleepService,
    templateRegistry,
    hookExecutor,
    configResolver,
    workflowScriptLoader,

    // Widgets & Extensions
    extensionManager,
    widgetRegistry,
    widgetService,

    /** Initialize all services. Call on startup. */
    async initialize(): Promise<void> {
      // Relay connector first — it only opens a socket if a relay-bound device
      // already exists, and starting it early means a device revoked while the
      // server was down gets its revocation delivered as soon as possible.
      await relayHostBroker.start();

      // Load templates (both workflow and stage templates)
      await templateRegistry.loadWorkflowTemplates(config.templatesDir);

      // Load system workflow templates from the system subdirectory
      const systemTemplatesDir = resolve(config.templatesDir, 'system');
      if (existsSync(systemTemplatesDir)) {
        await templateRegistry.loadWorkflowTemplates(systemTemplatesDir);
        const count = templateRegistry.getAllWorkflowTemplates().length;
        logger.info(`[Container] ${count} workflow template${count !== 1 ? 's' : ''} loaded`);
      }

      // Load workflow scripts (.workflow.mjs)
      try {
        await workflowScriptLoader.discoverScripts();
      } catch (err) {
        logger.warn(`[Container] Failed to load workflow scripts — continuing without scripts: ${String(err)}`);
      }

      // Start harness provider — required for operation
      try {
        await harness.initialize();
        logger.info('[Container] Harness provider initialized successfully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Container] Harness initialization failed (degraded mode): ${msg}`);
      }

      // Warm every provider's live model catalog in the background. A cold
      // probe spawns the provider's CLI and can take ~10s; doing it here means
      // the model picker is already populated by the time a user opens it
      // instead of showing a long "Loading models…" state.
      void harnessRegistry.refresh(true)
        .then((statuses) => {
          for (const s of statuses) {
            logger.info(
              `[Container] Provider '${s.type}': ready=${s.ready} models=${s.models.length}` +
              (s.error ? ` error=${s.error}` : ''),
            );
          }
        })
        .catch((err: unknown) => {
          logger.warn(`[Container] Provider catalog warm-up failed: ${String(err)}`);
        });

      // Register global harness lifecycle hooks
      const globalHooks = configResolver.resolveGlobalHooks();
      hookInterceptor.registerClientLifecycleHooks(harness, globalHooks, {
        sessionId: '__global__',
        workspacePath: config.workspacesDir,
        variables: {},
        eventBus,
      });

      // Restore global event sequence counter from DB so post-restart
      // global events don't collide with pre-restart sequence IDs.
      await eventRepo.initialize();

      // Recover interrupted sessions (also restores per-session EventBus
      // sequence counters from DB via restoreCounters()).
      await recoveryService.recover();

      // Track A1 — reconcile automation executions left in a non-terminal
      // state by the previous process, and start the idempotency-key
      // sweeper. Only runs when the recovery service is wired
      // (idempotencyKeyRepo present).
      //
      // IMPORTANT: Recovery MUST complete before cron scheduling starts.
      // A cron tick that fires while `recoverOnBoot` is still walking
      // executions could otherwise re-trigger an automation whose previous
      // execution recovery is about to mark completed/failed.
      if (automationRecoveryService) {
        try {
          await automationRecoveryService.recoverOnBoot();
        } catch (err) {
          logger.warn(
            `[Container] Automation recovery failed on boot: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        automationRecoveryService.startIdempotencySweeper();
      }

      // Initialize automation cron scheduler AFTER recovery so the two
      // don't race on the same execution row.
      await automationService.initializeCronJobs();

      // DB-04 — start the event/stream retention sweeper. No-op if disabled.
      eventRetentionService.start();

      // DUR-05 — start the durable-sleep sweeper. One tick fires
      // immediately so a server that restarted mid-sleep resumes any
      // stages whose `wake_at` is already in the past.
      durableSleepService.start();

      // Worktree cleanup: detect orphaned worktrees from crashed runs
      // and start the background retention sweep timer.
      await worktreeCleanupService.recoverOnStartup();
      worktreeCleanupService.start();

      // Load system-level artifacts (skills, prompts, agents)
      await systemArtifactService.loadSystemArtifacts();

      // Load installed extensions (system + user scopes; workspace scope is
      // lazy on API access). Failures for individual extensions are logged
      // per-record and never abort boot.
      try {
        await extensionManager.reload();
        const loaded = extensionManager.list();
        logger.info(
          `[Container] ${loaded.length} extension${loaded.length !== 1 ? 's' : ''} loaded` +
          (loaded.length > 0 ? `: ${loaded.map((e) => e.manifest.id).join(', ')}` : ''),
        );
      } catch (err) {
        logger.warn(`[Container] Extension load failed — continuing without extensions: ${String(err)}`);
      }

      logger.info('[Container] All services initialized');
    },

    /** Graceful shutdown. */
    async shutdown(): Promise<void> {
      scriptRunner.shutdown();
      automationService.shutdown();
      // Track A1 — stop the idempotency-key sweeper.
      if (automationRecoveryService) {
        automationRecoveryService.stopIdempotencySweeper();
      }
      // DB-04 — halt the retention sweeper so a pending sweep can't block
      // closeDB() by holding the write lock.
      eventRetentionService.stop();
      // DUR-05 — stop the durable-sleep sweeper. Any stages still
      // `sleeping` stay that way — a subsequent server boot resumes
      // them on the next sweep.
      durableSleepService.stop();
      worktreeCleanupService.stop();
      // Stop run poll loops + unsubscribe EventBus listeners + close run loggers
      // so no new events are produced and no setInterval handles are orphaned.
      workflowRunService.shutdown();

      // Kill any live terminal sessions (PTY handles hold FDs → must not
      // outlive the process on shutdown paths where OS reaping is unreliable).
      await terminalService.shutdown();

      // Destroy any active sandboxes
      if (sandboxLifecycleManager) {
        await sandboxLifecycleManager.destroyAll();
      }

      await harness.shutdown();
      // Flush the security audit queue before the DB closes, otherwise the
      // final revoke/denied events would be written against a closed handle.
      await relayHostBroker.stop();
      await security.shutdown();
      // Drain any queued per-session event persists before closing the DB, so
      // a session's final events aren't lost on shutdown (and no insert runs
      // against a closed connection).
      await eventBus.flush();
      // Close SQLite database
      closeDB(db);
      logger.info('[Container] Shutdown complete');
    },
  };
}

export interface Container {
  config: AppConfig;
  logger: ILogger;
  eventBus: EventBus;
  /** Secret store, device/pairing services, DPoP verification, audit log. */
  security: SecurityContext;
  /**
   * Per-launch token proving a caller is the OS user who owns this server.
   * Null when authentication is disabled, where it would grant nothing.
   */
  localAdminToken: string | null;
  /** Outbound-only relay connector. Disabled unless `security.relayEnabled`. */
  relayHostBroker: RelayHostBroker;
  /**
   * Push token registry, or null when push is disabled
   * (`GENERATORAI_PUSH=0`). Routes must handle null by returning 501 rather
   * than assuming it exists.
   */
  pushTokens: PushTokenRepository | null;
  sessionService: SessionService;
  artifactService: ArtifactService;
  webhookService: WebhookService;
  errorHandler: ErrorHandler;

  // v2 services
  chatManagementService: ChatManagementService;
  orchestratorService: OrchestratorService;
  workflowDefinitionService: WorkflowDefinitionService;
  workflowRunService: WorkflowRunService;
  dagScheduler: DAGScheduler;
  stageExecutionService: StageExecutionService;
  sessionAllocator: SessionAllocator;

  // Orchestrator
  workflowOrchestrator: WorkflowOrchestrator;
  gitManager: GitManager;
  changeSetService: ChangeSetService;
  sourceControlService: SourceControlService;
  sourceControlRegistry: SourceControlRegistry;
  sourceControlConfigService: SourceControlConfigService;

  // Automation
  automationService: AutomationService;
  /** Track A — recovery service for boot-time reconciliation. */
  automationRecoveryService: AutomationRecoveryService | null;
  /** Track A3 — idempotency key store, used directly by trigger routes. */
  idempotencyKeyRepo: DrizzleIdempotencyKeyRepository;

  /** HITL — human-in-the-loop interrupt/resume service. */
  hitlService: HitlService;
  /** PLN-01 — plan mode. Undefined only if the plan repos were not supplied. */
  planService: PlanService | undefined;
  agentInteractionService: AgentInteractionService | undefined;

  // Project & Codebase Management
  projectService: ProjectService;
  codebaseService: CodebaseService;
  worktreeService: WorktreeService;
  worktreeCleanupService: WorktreeCleanupService;
  projectConfigService: ProjectConfigService;
  systemArtifactService: SystemArtifactService;

  // Workspace Management
  workspaceManager: WorkspaceManager;
  checkpointService: CheckpointService;
  workspaceCheckpointService: WorkspaceCheckpointService;
  checkpointRepo: DrizzleCheckpointRepository;
  changeSummaryService: ChangeSummaryService;
  workspaceTreeService: WorkspaceTreeService;
  reviewThreadService: ReviewThreadService;
  reviewRepo: DrizzleReviewRepository;

  /** Integrated Browser service (v13). Optional per workspace/chat/run. */
  browserService: BrowserService;
  /** Desktop CDP bridge — exposed so routes/internal-browser.ts can push
   *  per-workspace scoped CDP endpoints from Electron main. */
  electronBridgeAdapter: ElectronBridgeAdapter;
  /** Execution workspace repo — exposed for the browser route (read workspace row). */
  executionWorkspaceRepo: InstanceType<typeof DrizzleExecutionWorkspaceRepository>;
  /** Workspace artifact repo — exposed for the browser route (list browser artifacts). */
  workspaceArtifactRepo: InstanceType<typeof DrizzleWorkspaceArtifactRepository>;

  /** Integrated Terminal service — ephemeral PTY sessions per workspace. */
  terminalService: TerminalService;

  // v2 repositories (for route-level queries)
  workflowRepo: InstanceType<typeof DrizzleWorkflowRepository>;
  chatEntityRepo: InstanceType<typeof DrizzleChatRepository>;
  chatMessageRepo: InstanceType<typeof DrizzleChatMessageRepository>;
  workflowRunRepo: InstanceType<typeof DrizzleWorkflowRunRepository>;
  stageRunRepo: InstanceType<typeof DrizzleStageRunRepository>;

  harness: IAgentHarness;
  /** Multi-provider registry: per-provider readiness + live model catalogs. */
  harnessRegistry: HarnessRegistry;
  /** Router that sends each conversation to the provider that owns it. */
  multiHarness: MultiHarness;
  streamBroker: StreamBroker;
  /** TOL-01 — harness-agnostic custom tool catalog. Empty by default. */
  customToolRegistry: CustomToolRegistry;
  /** TOL-06 — MCP server configuration hub. Pass-through by default. */
  mcpHub: IMcpHub;
  /** DUR-05 — durable step.sleep sweeper. Stage code calls `sleep(...)` to park. */
  durableSleepService: DurableSleepService;
  templateRegistry: TemplateRegistry;
  hookExecutor: HookExecutor;
  configResolver: ConfigResolver;
  workflowScriptLoader: WorkflowScriptLoader;

  // Widgets & Extensions
  extensionManager: ExtensionManager;
  widgetRegistry: WidgetRegistry;
  widgetService: WidgetService;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

