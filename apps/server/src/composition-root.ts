// ────────────────────────────────────────────────────────────────
// Composition Root — DI container wiring all services together
// ────────────────────────────────────────────────────────────────

import type { AppConfig, ILogger, PersistedEvent } from '@generatorai/shared';
import { createLogger, readBoundedInt } from '@generatorai/shared';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import * as path from 'node:path';
import { HarnessRegistry, MultiHarness, ALL_HARNESS_TYPES, type HarnessType, AgentHostSupervisor, type ProviderInstanceRegistry, FauxProvider, resolveCodexCommand } from '@generatorai/agent-harness-providers';
import type { ProviderInstanceId } from '@generatorai/core';
import { readWorkspaceRetentionPreferences } from './settings/workspaceRetention.js';
import { readAudioPreferences } from './settings/audio.js';
import { AgentHostClient, HostSupervisor, resolveWorktreePath } from '@generatorai/core';
import { createSecurityContext, type SecurityContext } from './composition/security.js';
import { registerHarnessInstances } from './composition/harnessInstances.js';
import { mintLocalAdminToken } from './composition/localAdminToken.js';
import { installAgentCursorTheme, resolveCuaDriverBinary } from './computer/driverBinary.js';
import { ScreenCast } from './computer/screenCast.js';
import { createPreviewProducer } from './computer/previewProducer.js';
import { registerEphemeralProducer } from './streaming/ephemeralScopes.js';
import { RelayHostBroker } from './relay/RelayHostBroker.js';
import { deriveStreamScopes } from './composition/streamScopes.js';
import {
  ExpoPushProvider,
  PushDispatcher,
  type PushTarget,
} from '@generatorai/core';
import {
  createDB,
  migrateDB,
  closeDB,
  withTransaction,
  setInvalidJsonColumnReporter,
  EventRetentionService,
  PushTokenRepository,
} from '@generatorai/db';
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
  DrizzleAgentRepository,
  DrizzleWorktreeRepository,
  DrizzleSystemConfigRepository,
  // Workspace Management repositories
  DrizzleExecutionWorkspaceRepository,
  DrizzleWorkspaceMountRepository,
  DrizzleWorkspaceArtifactRepository,
  DrizzleComputerUseRepository,
  DrizzleCheckpointRepository,
  DrizzleReviewRepository,
  DrizzleWorkspaceFileReviewRepository,
  DrizzlePlanRepository,
  DrizzleAgentInteractionRepository,
  // Widget & Extension repositories
  DrizzleWidgetInstanceRepository,
  // W34 / P1-42 — conversation ownership store (migration v33)
  SqliteConversationOwnershipRepository,
  // W34 — multi-instance provider registry (migrations v?, v40)
  SqliteHarnessInstanceRepository,
  SqliteConversationInstanceOwnershipRepository,
  // W22 / W47 — durable execution engine storage (migration v36–v37)
  RegisterRepository,
  EntryRepository,
} from '@generatorai/db';
import {
  // Bootstrap — shared core services factory
  createCoreServices,
  StartupRecoveryService,
  InterruptedTurnRecoveryService,
  OrphanProcessReaper,
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
  RepoReadinessService,
  ScmTextGenerator,
  SourceControlFlowService,
  EditorLauncherService,
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
  // W07 — durable delta log, dual-written alongside stream_cursors
  DeltaLog,
  // Section 8 — custom tool layer + MCP hub (harness-agnostic)
  CustomToolRegistry,
  InMemoryMcpHub,
  McpCredentialVault,
  McpSettingsStore,
  // DUR-05 — durable step.sleep sweeper
  DurableSleepService,
  // Project & Codebase Management services
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
  WorktreeCleanupService,
  WorkspaceRetentionService,
  SystemArtifactService,
  ArtifactCatalog,
  AgentService,
  AgentResolver,
  AgentStagingService,
  // Workspace Management service
  WorkspaceManager,
  // Workflow Script loader
  WorkflowScriptLoader,
  // Integrated Browser (v13)
  ServerPlaywrightHost,
  ElectronBridgeAdapter,
  BrowserService,
  // Computer Use
  ComputerService,
  CuaDriverBridge,
  NullComputerBridge,
  PendingConsentStore,
  // Integrated Terminal
  TerminalService,
  NodePtyHost,
  FallbackChildProcessHost,
  SandboxPtyHost,
  PtyHostAdapter,
  // Voice Module (Phase 0-4)
  VoiceService,
  createSttEngine,
  createSileroVadFactory,
  EnergyVad,
  createTtsEngine,
  resolveSttEngineId,
  type VoiceActivityDetector,
  sharedVoiceWorkerPool,
  disposeSharedVoiceWorkerPool,
  RuleBasedTextFormatter,
  LlmTextFormatter,
  // Widgets & Extensions
  WidgetRegistry,
  WidgetService,
  ExtensionManager,
  // Extension-author built-in tools
  buildWriteExtensionTool,
  buildReloadExtensionTool,
  // M8-fix: W18 admission controller — value import (cannot be `import type`)
  AdmissionController,
  // Workspace mounts (chat sources → directories the agent edits)
  MountService,
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
  ChatManagementServiceExtensions,
} from '@generatorai/core';
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

  // Review 6.6 — a stored JSON column that fails validation is replaced by a
  // default, and the next unrelated save persists that default over the real
  // value. Route those substitutions into the real log so the loss is visible
  // instead of silent. Installed once, covers every repository read.
  setInvalidJsonColumnReporter((error, rawValue) => {
    logger.warn('[db] stored JSON column failed validation — substituting the default', {
      error: error instanceof Error ? error.message : String(error),
      // Bounded: a corrupt column can be large, and this is a log line.
      rawValue: JSON.stringify(rawValue)?.slice(0, 500),
    });
  });

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

  /**
   * Claude filesystem settings sources. Defaults to none: `.claude/settings.json`
   * in a cloned repo can define shell hooks, so loading it is a per-deployment
   * trust decision rather than a default.
   */
  const parseSettingSources = (raw?: string): Array<'user' | 'project' | 'local'> => {
    if (!raw) return [];
    const allowed = new Set(['user', 'project', 'local']);
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is 'user' | 'project' | 'local' => allowed.has(s));
  };

  // W12 / P0-14 — process-wide supervisor bounding concurrent Claude turns.
  // maxConcurrentExecutions defaults to 16 (env: GENERATORAI_MAX_CONCURRENT_AGENT_TURNS).
  // maxConcurrentColdStarts defaults to 4 (env: GENERATORAI_MAX_CONCURRENT_COLD_STARTS).
  //
  // W12-wiring: AgentHostClient (out-of-process) is OPT-IN, not the default,
  // even when the agent-host build exists. It requires GENERATORAI_AGENT_HOST=true.
  //
  // △ Fixed during end-to-end review — this used to default to ENABLED whenever
  // the dist build was present, silently making it the live path for anyone who
  // had ever run `pnpm --filter @generatorai/agent-host build` and never set the
  // var. That is unsafe today: `AgentHostClient.sendPromptAndWait()` resolved
  // every turn with a hardcoded `{content: ''}` (it listened for the wrong event
  // kind — 'chat.message_complete', which nothing ever emits, instead of the
  // real 'harness.message_complete') and `getMessages()` read from a map nothing
  // ever populated. Both are fixed (see AgentHostClient.ts); `getModels()`,
  // `selectAgent()` and `listAgents()` now round-trip to the host too (A12,
  // 2026-09-05). What still keeps this opt-in: enabling the host bypasses
  // `MultiHarness`, the instance registry and the ownership store, so
  // multi-provider routing is lost, and the host path has not been soaked
  // under real load. Flip the default once `MultiHarness` runs inside the
  // host and a restart mid-turn has been drilled through it.
  //
  // The agent-host dist path is resolved relative to this package's location.
  // In a monorepo pnpm install the symlink structure ensures the built artifact
  // lands at `<root>/apps/agent-host/dist/index.js`.
  const agentHostSupervisor = new AgentHostSupervisor();

  // Codex joins the provider set whenever its CLI can be found — configured
  // path, `CODEX_CLI_PATH`, PATH, or the copy bundled with the ChatGPT desktop
  // app. Resolved once at boot; without a CLI there is nothing to run, so the
  // provider is left unconfigured and Settings reports it as not installed.
  const codexCommand = await resolveCodexCommand({ configuredPath: config.harness?.codex?.binaryPath });
  if (codexCommand) {
    logger.info(`[Container] Codex CLI found (${codexCommand.source}): ${codexCommand.path}`);
  } else {
    logger.info('[Container] Codex CLI not found — install Codex or set CODEX_CLI_PATH to enable the Codex provider');
  }
  const codexHome = harnessHomeDir('codex') ?? process.env['CODEX_HOME'];

  /** Per-provider construction options, resolved lazily by the registry. */
  const buildHarnessConfig = (type: HarnessType) => ({
    type,
    codex: type === 'codex' && codexCommand ? {
      binaryPath: codexCommand.command,
      args: [...codexCommand.argsPrefix, 'app-server'],
      env: {
        ...codexCommand.env,
        // Codex keeps sign-in, config and history under its home. The user's
        // own is used unless homes are isolated per harness (see above).
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      },
      defaultModel: config.harness?.codex?.defaultModel,
      defaultCwd: config.artifactsDir,
      // `on-request` + `workspace-write`: commands inside the workspace sandbox
      // run without prompting, and anything Codex wants to do beyond it is
      // asked through the chat's approval UI. A chat's own permission mode
      // still overrides this per turn (see CodexProvider.approvalPolicyForTurn).
      approvalPolicy: config.harness?.codex?.approvalPolicy ?? 'on-request',
      sandboxMode: config.harness?.codex?.sandboxMode ?? 'workspace-write',
      clientName: 'generatorai',
      logger,
    } : undefined,
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
      // W36 / P0-13 — cold-start gating via the shared supervisor.
      // Each workspace gets its own CLI process; the cold-start semaphore
      // prevents thundering-herd starts when many workspaces open at once.
      supervisor: agentHostSupervisor,
    } : undefined,
    claudeAgent: type === 'claude-agent' ? {
      defaultModel: config.harness?.claudeAgent?.defaultModel ?? 'sonnet',
      defaultCwd: config.artifactsDir,
      defaultEffort: config.harness?.claudeAgent?.effort ?? 'high',
      defaultPermissionMode: config.harness?.claudeAgent?.permissionMode ?? 'bypassPermissions',
      defaultMaxTurns: config.harness?.claudeAgent?.maxTurns,
      defaultMaxBudgetUsd: config.harness?.claudeAgent?.maxBudgetUsd,
      // W12 / P0-14 — bound concurrent turns to prevent unbounded process spawns
      supervisor: agentHostSupervisor,
      // HITL-07 — share the same "stuck session" watchdog value as Copilot.
      // Claude uses a rolling-window timer that pauses while a permission
      // request is in flight, so slow human approvals don't spuriously abort.
      defaultTimeoutMs: config.copilot.defaultTimeoutMs,
      includePartialMessages: config.harness?.claudeAgent?.includePartialMessages ?? true,
      enableFileCheckpointing: config.harness?.claudeAgent?.enableFileCheckpointing ?? false,
      // Default OFF. `project`/`local` load `.claude/settings.json` from the
      // cloned repo, which can define shell hooks — enabling it globally would
      // execute settings from any repository the user opens.
      settingSources: parseSettingSources(process.env['GENERATORAI_CLAUDE_SETTING_SOURCES']),
      verbose: config.logLevel === 'debug',
      homeDir: harnessHomeDir(type),
    } : undefined,
  });

  const harnessRegistry = new HarnessRegistry({
    buildConfig: buildHarnessConfig,
    primary: primaryHarnessType,
    logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m) },
    // W41 — disk cache so boot never blocks on a provider probe.
    diskCacheFile: `${config.artifactsDir}/.generatorai-provider-status-cache.json`,
  });
  // W41-N2 — disk cache is awaited in initialize() so the seed is guaranteed
  // to complete before any getAllModels() call. Do NOT call it here (construction
  // time) — the fire-and-forget races the first user-facing query.
  // W34 / P1-42 — wire the durable ownership store so conversation→provider
  // routing survives a server restart. Before this fix `undefined` was passed,
  // meaning every restart silently lost ownership and routed old conversations
  // to the wrong (primary) provider. The table is created by migration v33.
  const conversationOwnershipStore = new SqliteConversationOwnershipRepository(db);
  const multiHarness = new MultiHarness(
    harnessRegistry,
    conversationOwnershipStore,
    { info: (m) => logger.info(m), warn: (m) => logger.warn(m) },
  );
  // W34-M3 / L17: Seed the instanceTypeMap with default provider instances so
  // that a ProviderInstanceId in the form `<driverType>:default` resolves
  // correctly via the explicit table path (not just the inline-prefix fallback).
  // This is the minimal wiring before the full ProviderInstanceRegistry is activated
  // (see docs/V2_IMPLEMENTATION_TRACKER.md — M3 deferred wiring).
  /* W34-M3 */
  {
    const defaultInstanceMap = new Map<ProviderInstanceId, HarnessType>(
      ALL_HARNESS_TYPES.map((t) => [`${t}:default` as ProviderInstanceId, t as HarnessType]),
    );
    multiHarness.setInstanceTypeMap(defaultInstanceMap);
  }

  // W34 — load any persisted `harness_instances` (multiple accounts of the
  // same driver) and register them as genuinely independent, concurrently
  // routable adapters. See composition/harnessInstances.ts for the full
  // rationale. This is additive: with zero rows (every deployment today,
  // since nothing has ever written to this table) it registers nothing, and
  // `instanceRegistry.resolveForConversation()` always returns undefined, so
  // every conversation continues to route through the single-adapter-per-type
  // path exactly as it did before this block existed.
  const harnessInstanceRepo = new SqliteHarnessInstanceRepository(db);
  const conversationInstanceOwnershipStore = new SqliteConversationInstanceOwnershipRepository(db);
  const providerInstanceRegistry = await registerHarnessInstances({
    harnessRegistry,
    instanceRepo: harnessInstanceRepo,
    secretStore: security.secretStore,
    artifactsDir: config.artifactsDir,
    supervisor: agentHostSupervisor,
    ownershipStore: conversationInstanceOwnershipStore,
    logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m) },
  });
  multiHarness.setInstanceRegistry(providerInstanceRegistry);

  logger.info(`[Container] Harness registry created (primary=${primaryHarnessType})`);

  // W12 — wire AgentHostClient (out-of-process) when BOTH:
  //   (a) GENERATORAI_AGENT_HOST is explicitly 'true' (opt-in — see the note above), AND
  //   (b) the agent-host dist build exists on disk.
  // If the build is absent, we fall back to MultiHarness with a warning so the
  // server still starts.
  const agentHostEnabled = process.env['GENERATORAI_AGENT_HOST'] === 'true';
  // §1.Q — see the FauxProvider branch just below. Named so every place that
  // must also avoid touching a real provider CLI (the model-catalog warm-up,
  // in particular) can check the same flag rather than re-reading env.
  const loadTestFauxHarness = process.env['GENERATORAI_LOAD_TEST_FAUX_HARNESS'] === 'true';
  let harness: IAgentHarness;
  let hostSupervisor: HostSupervisor | undefined;

  // §1.Q — the concurrent-load test (agent-tests/concurrent-load-1q.mjs)
  // needs to drive real chat/workflow/automation traffic through the FULL
  // event/streaming/DB pipeline in CI, where no real Copilot/Claude
  // credentials exist. `FauxProvider` is a fully IAgentHarness-compliant,
  // already-tested fake (used by W44's conformance suites) that completes a
  // turn near-instantly when nothing is scripted — exactly "fast,
  // deterministic, zero external dependency" load generation, without
  // faking the pipeline itself: every chat still goes through the real
  // ChatManagementService, EventBus, and DB writes end to end. Explicit,
  // scary env var name so this is unmistakably a test-only escape hatch —
  // off by default, never reachable in a normal deployment.
  if (loadTestFauxHarness) {
    harness = new FauxProvider();
    logger.warn(
      '[Container] GENERATORAI_LOAD_TEST_FAUX_HARNESS=true — using FauxProvider for ALL conversations. ' +
      'This must never be set outside a load test.',
    );
  } else if (agentHostEnabled) {
    // Resolve the agent-host entry point. In the monorepo the package lives
    // two directories above the server package: <root>/apps/agent-host/dist/index.js.
    // `fileURLToPath` + `dirname` converts the ESM import.meta.url to a FS path.
    const __serverDir = dirname(fileURLToPath(import.meta.url));
    const agentHostEntry = resolve(__serverDir, '..', '..', 'agent-host', 'dist', 'index.js');
    const hostExists = existsSync(agentHostEntry);

    if (hostExists) {
      // AgentHostClient must be created BEFORE HostSupervisor so we can pass
      // the event handler to the supervisor constructor (onHostEvent).
      // We break the circular dependency with a forward-declared callback.
      let agentHostClient!: AgentHostClient;
      const supervisor = new HostSupervisor({
        hostEntryPath: agentHostEntry,
        logger,
        env: {
          // Forward the primary harness type so the host boots the right provider.
          GENERATORAI_PRIMARY_HARNESS: primaryHarnessType,
          // Pass our PID so the host can self-terminate when the gateway dies.
          GENERATORAI_PARENT_PID: String(process.pid),
          ...(process.env['LOG_LEVEL'] ? { LOG_LEVEL: process.env['LOG_LEVEL'] } : {}),
        },
        // Route agent events from the host process back into the client's
        // per-conversation handler map. The callback is closed over
        // `agentHostClient`, which is assigned immediately below.
        onHostEvent: (msg) => agentHostClient?.handleHostEvent(msg),
        // W12 — a restarted host boots with EMPTY session maps. Without this
        // the client keeps a handler map the host knows nothing about and every
        // later turn fails SESSION_NOT_FOUND forever while health stays green.
        onHostRestart: () => agentHostClient?.reattachSessions() ?? Promise.resolve(),
        // W20 — restart-cap exhaustion must be visible. This flips the client
        // to 'error' and fails every live session loudly instead of leaving
        // pending turns hanging in front of a process that no longer exists.
        onFatal: (reason) => agentHostClient?.handleHostFatal(reason),
      });
      agentHostClient = new AgentHostClient(supervisor, logger);
      hostSupervisor = supervisor;
      harness = agentHostClient;
      logger.info('[Container] AgentHostClient wired — provider runtimes will run out-of-process (L5)');
    } else {
      logger.warn(
        `[Container] GENERATORAI_AGENT_HOST is enabled but agent-host build not found at ${agentHostEntry}. ` +
        'Falling back to in-process MultiHarness. ' +
        'Run `pnpm --filter @generatorai/agent-host build` to enable process isolation.',
      );
      harness = multiHarness;
    }
  } else {
    logger.info('[Container] GENERATORAI_AGENT_HOST not set to "true" — using in-process MultiHarness (default)');
    harness = multiHarness;
  }

  const scriptRunner = new SandboxedScriptRunner(logger, {
    extraAllowlist: config.scripts.extraAllowlist,
  });
  const httpClient = new FetchHttpClient();
  const gitManager = new GitManager(scriptRunner, logger, {
    workspacesDir: config.workspacesDir,
  });

  // ── Change-set engine (centralized diff/status) ──
  const changeSetService = new ChangeSetService(gitManager, logger);

  // ── Source Control (accounts registry + config + the commit → PR flow) ──
  //
  // The registry is populated by `SourceControlConfigService.load()`, which
  // reads `<dataDir>/source-control.json`, migrates a legacy `github.token`,
  // seeds an account from the env token when nothing is configured yet, and
  // registers one provider per account. Nothing is registered from env here
  // any more — a single env-built provider could not answer "which account
  // owns this remote host?", which is what every SCM route now asks.
  const scmRegistry = new SourceControlRegistry();
  const githubToken =
    process.env['GENERATORAI_GITHUB_TOKEN'] ??
    process.env['GITHUB_TOKEN'] ??
    process.env['GH_TOKEN'] ??
    undefined;
  const githubHost = process.env['GENERATORAI_GITHUB_HOST'] ?? process.env['COPILOT_GH_HOST'] ?? undefined;

  // Persistent settings + accounts (JSON-file backed under the data dir;
  // tokens live in the secret store, never in the file).
  // Operators running GitHub Enterprise on a private network allow-list its
  // hostname(s) here; everything else keeps the public-only address policy.
  const scmAllowedHosts = (process.env['GENERATORAI_SCM_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const scmHttpClient = scmAllowedHosts.length > 0 ? new FetchHttpClient({ allowedHosts: scmAllowedHosts }) : httpClient;
  const sourceControlConfigService = new SourceControlConfigService(scmRegistry, {
    http: scmHttpClient,
    processRunner: scriptRunner,
    secrets: security.secretStore,
    logger,
    configDir: resolve(config.dbPath, '..'),
    env: {
      ...(githubToken ? { githubToken } : {}),
      ...(githubHost ? { githubHost } : {}),
      ...(process.env['GENERATORAI_GITHUB_OAUTH_CLIENT_ID']
        ? { oauthClientId: process.env['GENERATORAI_GITHUB_OAUTH_CLIENT_ID'] }
        : {}),
    },
  });
  await sourceControlConfigService.load();

  // Legacy surface (`/api/source-control/config|status`, the workspace
  // commit/PR routes) — reads the registry through its `getActiveProvider()`
  // shim, which now resolves to the default account's provider.
  const sourceControlService = new SourceControlService(scmRegistry, gitManager, logger);

  const repoReadinessService = new RepoReadinessService({
    git: gitManager,
    registry: scmRegistry,
    logger,
    settings: () => sourceControlConfigService.getSettings(),
  });
  const scmTextGenerator = new ScmTextGenerator({
    harness,
    logger,
    generation: () => sourceControlConfigService.generation(),
  });
  const sourceControlFlowService = new SourceControlFlowService({
    git: gitManager,
    registry: scmRegistry,
    readiness: repoReadinessService,
    text: scmTextGenerator,
    logger,
    settings: () => sourceControlConfigService.getSettings(),
  });
  const editorLauncherService = new EditorLauncherService({
    logger,
    processRunner: scriptRunner,
    defaultEditor: () => sourceControlConfigService.defaultEditor(),
  });
  logger.info(
    `[Container] Source control — ${sourceControlConfigService.getSettings().accounts.length} account(s), ` +
      `active=${scmRegistry.getActive()}`,
  );

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
  // W22 / W47 — durable execution engine storage (migration v36–v37).
  const registerRepo = new RegisterRepository(db);
  const entryRepo = new EntryRepository(db);

  // ── Project & Codebase Management Repositories ──
  const projectRepo = new DrizzleProjectRepository(db);
  const projectCodebaseRepo = new DrizzleProjectCodebaseRepository(db);
  const projectConfigRepo = new DrizzleProjectConfigRepository(db);
  const worktreeRepo = new DrizzleWorktreeRepository(db);
  const systemConfigRepo = new DrizzleSystemConfigRepository(db);

  // ── Workspace Management Repositories ──
  const executionWorkspaceRepo = new DrizzleExecutionWorkspaceRepository(db);
  const workspaceMountRepo = new DrizzleWorkspaceMountRepository(db);
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
  // W48 — resolve `secretref:` pointers to real values right before a run's
  // MCP config reaches the harness adapter (see packages/core/src/mcp). Every
  // upstream projection (catalog, resolver, chat snapshot, DB row) only ever
  // holds the pointer; this is the one place a value is read back out.
  const mcpCredentialVault = new McpCredentialVault(security.secretStore);
  const mcpHub: IMcpHub = new InMemoryMcpHub({
    vault: mcpCredentialVault,
    logger: { warn: (m) => logger.warn(m) },
  });
  // W48 — server-side settings (bundled catalog on/off + inputs + custom
  // servers) live in mcp-settings.json next to the DB file, same convention
  // as `settings/computerUse.ts`'s computer-use.json.
  const mcpSettingsStore = new McpSettingsStore(path.dirname(resolve(config.dbPath)));

  // Chat extensions object — passed by reference to createCoreServices.
  // `worktreeService` is set later after project services are created.
  const chatExtensions: ChatManagementServiceExtensions = {
    customToolRegistry,
    mcpHub,
    // Agent-native source control (doc §5) — the post-turn commit → push → PR
    // hook for chats created with `sourceControl.autoCommit`.
    sourceControlFlowService,
    repoReadinessService,
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
    // W22 / W47 — durable execution engine storage.
    registerRepo,
    entryRepo,
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
      //
      // Bounded read: this value reaches `new Semaphore(...)`, and a bare
      // `parseInt` of a typo'd value yielded NaN — which the semaphore
      // accepted and then never granted a permit for, hanging every stage
      // launch silently. `readBoundedInt` cannot produce a non-finite value.
      maxConcurrentStages: process.env['MAX_CONCURRENT_STAGES']
        ? readBoundedInt('MAX_CONCURRENT_STAGES', {
            defaultValue: 8,
            min: 1,
            max: 64,
            onWarn: (msg, rec) => logger.warn(msg, rec as unknown as Record<string, unknown>),
          })
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
  // W07 — the file-backed delta log. OPT-IN (`GENERATORAI_DELTA_LOG=true`),
  // and off by default, because as shipped it was a write-only duplicate:
  // `StreamBroker.publish` still committed every delta to `stream_cursors`
  // (batched) and THEN appended it here, and `DeltaLog.readTail` had no
  // production caller — replay, crash recovery and retention all read SQL.
  // Every token therefore cost a SQL row plus an `appendFile` to a file
  // nothing read, plus a sweeper to delete it. Architecture law L1 ("tokens
  // never reach the relational store") is NOT met by this code path; what
  // holds today is honest batching (`StreamWriteBatcher`). Finishing the
  // design means routing deltas ONLY here and merging them back into replay
  // by `seq` — until that lands, the flag exists so the implementation can be
  // exercised without taxing every deployment.
  const deltaLogEnabled = process.env['GENERATORAI_DELTA_LOG'] === 'true';
  const deltaLog = deltaLogEnabled
    ? new DeltaLog({
        // Sibling of the other `~/.generatorai/*` directories, keyed off the
        // same "next to the DB" convention already used for `harnesses/<id>/home`.
        dir: path.join(path.dirname(resolve(config.dbPath)), 'delta-logs'),
        logger,
      })
    : undefined;
  if (deltaLogEnabled) {
    logger.info('[Container] GENERATORAI_DELTA_LOG=true — deltas are dual-written to the file delta log (experimental)');
  }
  const streamBroker = new StreamBroker(streamCursorRepo, logger, deltaLog ? { deltaLog } : {});

  // P1-4 / EVT-01 — the durable stream log is now the event bus's commit point
  // AND its sequence source. `emit()` awaits `append` before broadcasting, so a
  // live subscriber can never see an event that replay cannot return, and
  // `getSessionEvents` reads the same counter that `emit` stamped.
  //
  // Global events use the same scope mapping the SSE route does, so
  // `scope=global&id=all` replays them.
  const primaryScopeFor = (sessionId: string): { scope: 'session' | 'global'; id: string } =>
    sessionId === '__global__' ? { scope: 'global', id: 'all' } : { scope: 'session', id: sessionId };

  /** Page size for replay. The API itself is unbounded; this bounds each query. */
  const REPLAY_PAGE = 500;

  eventBus.setEventStore({
    append: async (sessionId, event) => {
      const { scope, id } = primaryScopeFor(sessionId);
      const row = await streamBroker.publish(scope, id, event.kind, event.data);
      return { seq: row.seq, id: row.id };
    },
    replaySessionEvents: async (sessionId, afterSeq) => {
      const { scope, id } = primaryScopeFor(sessionId);
      const out: PersistedEvent[] = [];
      let cursor = afterSeq;
      for (;;) {
        const rows = await streamCursorRepo.replayAfter(scope, id, cursor, REPLAY_PAGE);
        if (rows.length === 0) break;
        for (const r of rows) {
          out.push({
            id: r.id,
            sessionId,
            sequenceId: r.seq,
            kind: r.kind,
            data: r.payload,
            timestamp: r.ts,
          } as PersistedEvent);
        }
        cursor = rows[rows.length - 1]!.seq;
        if (rows.length < REPLAY_PAGE) break;
      }
      return out;
    },
    deleteSessionEvents: async (sessionId) => {
      const { scope, id } = primaryScopeFor(sessionId);
      await streamCursorRepo.deleteScope(scope, id);
    },
    lastSeq: async (sessionId) => {
      const { scope, id } = primaryScopeFor(sessionId);
      return streamCursorRepo.getLastSeq(scope, id);
    },
  });

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
    scope: 'session' | 'run' | 'chat' | 'global' | 'automation' | 'workspace',
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

  const bridgeEvent = (event: {
    sessionId: string;
    kind: string;
    data: unknown;
  }): void => {
    // Which secondary scopes this event reaches is decided by
    // `deriveStreamScopes` (`composition/streamScopes.ts`) rather than by an
    // inline chain here: it was an unexported closure inside this setup
    // function, so the single piece of logic deciding who sees which event
    // had no test, and each new scope was added on a read-it-and-hope basis.
    //
    // The primary scope is NOT published here. `eventBus.setEventStore` above
    // already appended it — awaited, before this broadcast — which is what
    // makes commit-then-broadcast hold. Publishing it again from the bridge
    // would double every event on `scope=session` and `scope=global`.
    //
    // Secondary scopes stay fire-and-forget: they are additional views of an
    // event that is already durable, so losing one costs a resume on that
    // view alone.
    for (const target of deriveStreamScopes(event)) {
      publishToBroker(target.scope, target.id, event.kind, event.data);
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
  // W07 — the delta log's own bound is total bytes, not a TTL cutoff like the
  // SQL sweeps, so `cutoffTs` is unused; `limit` IS honoured (bounds deletions
  // per tick, matching every other sweeper's contract) — the extension point
  // (built for "future EVT-04 blob store, artifact retention, etc.") already
  // fits a filesystem sweeper without touching `EventRetentionService` itself.
  if (deltaLog) {
    eventRetentionService.registerSweeper('deltaLog', async (_cutoffTs, limit) =>
      deltaLog.enforceGlobalCeiling(limit),
    );
  }

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
    // Post-processing commit/push/PR runs through the SAME flow as the
    // Changes tab and agent-native chats (doc §5) — one branch policy, one
    // base-branch sync, one conflict dry-run.
    sourceControlFlowService,
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

  // ── Agents (first-class agent entity) ──
  const artifactCatalog = new ArtifactCatalog(
    systemArtifactService,
    projectConfigRepo,
    resolve(config.templatesDir, 'system'),
    logger,
    {
      mcpSettings: mcpSettingsStore,
      // W48 fix: `ProjectConfig.filePath` is stored relative to the
      // project's config dir (see ArtifactCatalogOptions.resolveProjectConfigPath
      // doc) — without this a project MCP server's file never resolved and
      // the server was silently dropped from the catalog.
      resolveProjectConfigPath: (c) => path.join(projectService.getProjectConfigTypeDir(c.projectId, c.type), c.filePath),
    },
  );
  const agentRepo = new DrizzleAgentRepository(db);
  const agentResolver = new AgentResolver(agentRepo, artifactCatalog, logger);
  const agentStaging = new AgentStagingService(logger);
  const agentService = new AgentService({
    agentRepo,
    catalog: artifactCatalog,
    logger,
    resolver: agentResolver,
    listModels: async () => {
      const models = await harness.getModels();
      return models.map((m) => ({ id: m.id, ...(m.provider ? { provider: m.provider } : {}) }));
    },
    emitEvent: (kind, data) => {
      // Global scope so every connected client invalidates its agent cache.
      void eventBus.emitGlobal({ kind, data } as Parameters<typeof eventBus.emitGlobal>[0]);
    },
  });

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
    workspaceMountRepo,
    workspaceArtifactRepo,
    {
      workspacesDir: config.workspacesDir,
      defaultGitEnabled: true,
    },
    logger,
    gitManager,
    // The legacy `worktrees` table: back-fills mounts for pre-mount
    // workspaces and is unregistered on delete.
    worktreeRepo,
  );

  // ── Mounts ──
  //
  // A chat's sources (project codebases and/or local folders, each in place
  // or as a worktree, on a chosen branch) become mounts: the directories the
  // agent edits. The service validates them before the chat exists,
  // materialises them in the background, and gates the first prompt.
  const mountService = new MountService({
    mountRepo: workspaceMountRepo,
    workspaceRepo: executionWorkspaceRepo,
    git: gitManager,
    logger,
    workspacesDir: config.workspacesDir,
    codebaseRepo: projectCodebaseRepo,
    eventBus,
  });

  // ── Workspace retention (nightly) ──
  //
  // Execution workspaces were the one thing nothing ever reclaimed: three
  // sweepers start below (events, durable sleep, worktrees) and this was not
  // among them, so `cleanupExpiredWorkspaces` only ran when someone POSTed to
  // /api/workspaces/cleanup by hand. Measured on a developer machine after a
  // few months: 1,136 directories, 6.3GB, ~50 more per day.
  //
  // OFF by default — it deletes the user's files on a timer, so it waits for
  // an explicit opt-in in Settings. Preferences are read per tick, not
  // captured here, so a change applies without a restart.
  const workspaceRetentionService = new WorkspaceRetentionService({
    workspaceManager,
    workspaceRepo: executionWorkspaceRepo,
    workspacesDir: config.workspacesDir,
    readPreferences: () =>
      readWorkspaceRetentionPreferences(path.dirname(resolve(config.dbPath))),
    logger,
  });

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
    // The mounts ARE the tracked set — same definition the Changes tab uses.
    { toMountRefs: (ws) => workspaceManager.toMountRefs(ws) },
    gitManager,
    logger,
  );
  // The "since the start" anchor is captured the moment every mount is
  // ready — while the tree is pristine, after any branch switch.
  mountService.setBaselineCapture((workspaceId) =>
    workspaceCheckpointService.capture({ workspaceId, kind: 'baseline' }),
  );
  // Archived chats: reclaim worktree directories after the project's
  // retention (default 24h), keeping branches so the work is recoverable.
  worktreeCleanupService.setArchivedReleaser(async () => {
    let released = 0;
    const archived = await chatEntityRepo.getByStatus('archived');
    for (const chat of archived) {
      if (!chat.workspaceId) continue;
      const ws = await executionWorkspaceRepo.findById(chat.workspaceId);
      if (!ws || ws.ownerId !== chat.id) continue;
      const since = ws.archivedAt ?? chat.updatedAt;
      let retentionMs = 24 * 60 * 60 * 1000;
      if (ws.projectId) {
        try {
          const project = await projectRepo.getById(ws.projectId);
          const setting = project.settings?.worktreeRetention ?? 'hours-24';
          retentionMs = setting === 'manual' ? Infinity : setting === 'immediate' ? 0 : setting === 'hours-72' ? 72 * 3_600_000 : 24 * 3_600_000;
        } catch {
          /* default retention */
        }
      }
      if (!Number.isFinite(retentionMs) || Date.now() - since.getTime() < retentionMs) continue;
      released += await mountService.releaseWorktrees(ws.id);
    }
    return released;
  });
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

  // A turn-level rewind rewrites several mounts in one call; each rewrite must
  // drop the memoised working tree before it is announced (see the restore
  // route, which does the same inline).
  workspaceCheckpointService.setRestoreListener((repoDir) => changeSummaryService.invalidateWorkingTree(repoDir));

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

  // ── Per-file review state ("Keep") ──
  //
  // One row per file the user has accepted, at the exact blob they accepted.
  // The Changes tab reads it to sort reviewed files out of the way; the
  // review/discard routes write it. Deliberately not a service: there is no
  // behaviour beyond the four row operations, and the interesting rule (a
  // row stops counting the moment its blob no longer matches the head) lives
  // where the summary is assembled.
  const workspaceFileReviewRepo = new DrizzleWorkspaceFileReviewRepository(db);
  const reviewThreadService = new ReviewThreadService(
    reviewRepo,
    {
      readCurrent: async (workspaceId, repoAlias, filePath) => {
        const ws = await workspaceManager.getExecutionWorkspace(workspaceId);
        if (!ws) return null;
        const versions = await changeSummaryService.getFileVersions({
          workspaceId,
          rootPath: ws.codeRoot ?? ws.rootPath,
          mounts: await workspaceManager.toMountRefs(ws),
          head: { kind: 'working' },
          autoInit: false,
          filePath,
          alias: repoAlias,
        });
        return versions.new?.contents ?? null;
      },
      readPatchSince: async (workspaceId, repoAlias, filePath, fromCheckpointId) => {
        const ws = await workspaceManager.getExecutionWorkspace(workspaceId);
        if (!ws) return null;
        const result = await changeSummaryService.getFilePatch({
          workspaceId,
          rootPath: ws.codeRoot ?? ws.rootPath,
          mounts: await workspaceManager.toMountRefs(ws),
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
  // `storage`: rows only, nothing native — must not run ahead of handle release.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await reviewThreadService.deleteWorkspace(workspaceId);
  }, 'storage');

  // Same for "kept" rows: they describe files in this workspace and nothing
  // else, so they must not outlive it.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await workspaceFileReviewRepo.deleteWorkspace(workspaceId);
  }, 'storage');

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
        const ws = await workspaceManager.getExecutionWorkspace(data.workspaceId!);
        if (!ws) return;
        // A checkpoint means the working tree just settled. Drop the memoised
        // snapshot first: it is only meant to keep ONE panel render
        // self-consistent, and reusing it here would re-anchor review threads
        // against the pre-edit file list — and leave clients refetching into
        // the same stale entry, since they react to this very event.
        changeSummaryService.invalidateWorkingTree();
        const summary = await changeSummaryService.getSummary({
          workspaceId: data.workspaceId!,
          rootPath: ws.codeRoot ?? ws.rootPath,
          mounts: await workspaceManager.toMountRefs(ws),
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
  }, 'storage');

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

  // M8-fix: W18 — wire the AdmissionController so stage launches are gated by
  // the `ordinary` lane. Interactive chat turns bypass this via ChatManagementService.
  //
  // W18 requires configuration to be clamped on load, logged, and audited.
  // Reading these with a bare `parseInt` was a live hang: a typo'd value
  // parsed to NaN, which `new Semaphore(NaN)` accepted and every `acquire()`
  // then awaited forever — no error, no log, every workflow stage stuck.
  // `readBoundedInt` cannot produce a non-finite value, and reports whatever
  // it had to correct. `undefined` (variable unset) is passed through so the
  // controller can size the lane from measured machine capacity instead.
  const laneEnv = (name: string, min: number, max: number, dflt: number): number | undefined =>
    process.env[name] === undefined
      ? undefined
      : readBoundedInt(name, {
          defaultValue: dflt,
          min,
          max,
          onWarn: (msg, rec) => logger.warn(msg, rec as unknown as Record<string, unknown>),
        });

  const admissionController = new AdmissionController({
    interactiveConcurrency: laneEnv('GENERATORAI_INTERACTIVE_CONCURRENCY', 1, 64, 4),
    ordinaryConcurrency: laneEnv('GENERATORAI_ORDINARY_CONCURRENCY', 1, 64, 8),
    bulkConcurrency: laneEnv('GENERATORAI_BULK_CONCURRENCY', 1, 64, 2),
    queueWaitTimeoutMs: readBoundedInt('GENERATORAI_ADMISSION_QUEUE_WAIT_MS', {
      defaultValue: 1_800_000,
      min: 0,
      max: 24 * 60 * 60 * 1000,
      onWarn: (msg, rec) => logger.warn(msg, rec as unknown as Record<string, unknown>),
    }),
    logger: {
      info: (msg, meta) => logger.info(msg, meta),
      warn: (msg, meta) => logger.warn(msg, meta),
    },
  });
  workflowRunService.setAdmissionController(admissionController);
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
  chatExtensions.mountService = mountService;
  // Per-turn snapshots: captured just before every prompt so the Changes
  // panel can answer "what did this message change?" and `/rewind` has an
  // anchor to restore to.
  chatExtensions.workspaceCheckpointService = workspaceCheckpointService;
  // Give the orchestrator the workspace manager so it can write the shared
  // `orchestrator/state.json` scratchpad into the (shared) workspace.
  orchestratorService.setWorkspaceManager(workspaceManager);
  // Agents — wired into every path that can bind one. A missing wiring here
  // makes an agent-bound chat/stage fail loudly rather than silently drop its
  // skills, MCP servers and tool policy.
  chatExtensions.agentResolver = agentResolver;
  chatExtensions.agentStaging = agentStaging;
  chatExtensions.systemArtifacts = systemArtifactService;
  stageExecutionService.setAgentServices(agentResolver, agentStaging);
  orchestratorService.setAgentService(agentService);
  // Staged skill files live under `<workspace>/.generatorai`, outside every
  // worktree; drop them with the workspace (invariant §5.14).
  //
  // `storage`: this is an `fs.rm`. Registered here (early), it used to run
  // BEFORE the browser / CUA / terminal teardown registered further down —
  // deleting files while native handles were still open. The phase, not the
  // registration order, now decides.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    try {
      const ws = await workspaceManager.getExecutionWorkspace(workspaceId);
      if (ws) await agentStaging.cleanup(ws.rootPath);
    } catch {
      // Best effort — never block workspace deletion.
    }
  }, 'storage');
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
      // §1.P lists this variable as a documented cap the code did not honour.
      // Read it the same bounded way `ServerPlaywrightHost` does, so the two
      // readers of the same variable cannot disagree.
      maxConcurrent: readBoundedInt('GENERATORAI_BROWSER_MAX_CONCURRENT', {
        defaultValue: 5,
        min: 1,
        max: 100,
        onWarn: (msg, rec) => logger.warn(msg, rec as unknown as Record<string, unknown>),
      }),
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

  // P0-35: Register browser teardown BEFORE the workspace filesystem is deleted.
  // Without this hook, deleting a workspace would rm -rf the profile directory
  // while Chromium still had it open, leaving the process running against a
  // dead tree. The beforeDelete listener fires before fs.rm in deleteWorkspace().
  // `native`: also fires on archive, per INV-7 ("a session dies when the
  // workspace is deleted or archived — never orphans a Chromium process").
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    try {
      await browserService.stop(workspaceId, 'workspace-deleted');
    } catch {
      // Best effort — session may already be stopped.
    }
  }, 'native');

  // Late-wire browserService into ChatManagementService so chats with
  // `browserConfig.enabled: true` auto-boot a shared Chromium and inject
  // the CDP endpoint into the harness system prompt.
  chatExtensions.browserService = browserService;  // Same story for stage sessions — the workflow path builds sessions
  // via StageExecutionService which needs BrowserService to register
  // the built-in browser tool set per stage.
  stageExecutionService.setBrowserService(browserService);

  // Computer Use. The bridge chain ends in NullComputerBridge so that with no
  // desktop attached every call resolves to a typed refusal rather than
  // falling off the end of the chain.
  //
  // CuaDriverBridge resolves an endpoint in this order: one pushed by the
  // desktop shell, then a socket somebody else manages, then a daemon it
  // spawns from the bundled executable, then the in-process runtime. Only the
  // daemon forms own the agent-cursor overlay; in-process works but cannot
  // show the user what the agent is doing.
  //
  // `GENERATORAI_CUA_DRIVER_SOCKET` is the escape hatch for a server sitting
  // in Windows Session 0 or behind SSH, where a daemon it spawned itself would
  // inherit a session with no desktop and silently return no windows.
  const computerUseConfig = config.computerUse;
  const computerUseRepo = new DrizzleComputerUseRepository(db);
  const driverBinaryPath = resolveCuaDriverBinary();
  if (driverBinaryPath) logger.info?.(`[computer-use] driver executable: ${driverBinaryPath}`);
  const cursorThemeId = driverBinaryPath ? installAgentCursorTheme(logger) : null;
  const computerConsentStore = new PendingConsentStore(computerUseRepo, eventBus, logger, {
    autoApproveForDevelopment: process.env['GENERATORAI_COMPUTER_USE_AUTO_APPROVE'] === '1',
  });
  const cuaDriverBridge = new CuaDriverBridge({
    logger,
    maxSnapshotElements: computerUseConfig.maxSnapshotElements,
    maxSnapshotDepth: computerUseConfig.maxSnapshotDepth,
    ...(driverBinaryPath ? { driverBinaryPath } : {}),
    ...(cursorThemeId ? { cursorThemeId } : {}),
    ...(process.env['GENERATORAI_CUA_DRIVER_SOCKET']
      ? { attachSocketPath: process.env['GENERATORAI_CUA_DRIVER_SOCKET'] }
      : {}),
  });
  // Screen capture for the Computer panel's live feed. The driver records too,
  // but with `+faststart` — unplayable until the run ends — so this runs the
  // same ffmpeg with fragmented-MP4 flags instead.
  const screenCast = new ScreenCast(logger);
  const computerService = new ComputerService(
    workspaceArtifactRepo,
    eventBus,
    logger,
    computerConsentStore,
    { record: (entry) => computerUseRepo.recordAudit(entry) },
    computerUseConfig,
    [cuaDriverBridge, new NullComputerBridge()],
  );
  // Late-wired like browserService: chats only see the computer_* tools when
  // the feature is enabled AND a workspace root exists.
  chatExtensions.computerService = computerService;
  // A deleted workspace must not leave a driver session attached to the user's
  // desktop — the session outlives the thing that authorised it otherwise.
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await computerService.stop(workspaceId, 'workspace-deleted');
  }, 'native');

  // W09 / P1-11 — the live preview is a live-only scope on the shared stream,
  // not a second SSE endpoint with a poll per connection. One producer per
  // workspace feeds every watcher; it starts on the first and stops on the last.
  registerEphemeralProducer(
    'computer',
    createPreviewProducer({
      recordingsRoot: async (workspaceId) => {
        const ws = await workspaceManager.getExecutionWorkspace(workspaceId);
        if (!ws) return null;
        return resolve(ws.rootPath, 'computer', 'recordings');
      },
      previewWindow: (workspaceId) => computerService.previewWindow(workspaceId),
      logger,
    }),
  );

  // ── Integrated Terminal ──
  //
  // Host chain: `SandboxPtyHost` (only usable when the caller explicitly
  // requests `attachToSandbox: true` — Phase 2) → `PtyHostAdapter` (opt-in,
  // out-of-process — see below) → `NodePtyHost` (real PTY via node-pty,
  // in-process) → `FallbackChildProcessHost` (degraded child_process shell
  // used when node-pty fails to load). `TerminalService` picks the first
  // `isAvailable()` host by default, so opting into the sandbox requires a
  // spawn-time flag.
  //
  // `PtyHostAdapter` is opt-in — GENERATORAI_PTY_HOST=true AND the
  // apps/pty-host dist build present — same pattern as GENERATORAI_AGENT_HOST
  // above: L5 ("native handles never live in the control-plane process") is
  // real for PTYs only once this is on, but the in-process `NodePtyHost` is
  // a well-exercised, long-lived default and shouldn't silently change
  // behavior for existing deployments just because a sibling package was
  // built.
  const ptyHostEnabled = process.env['GENERATORAI_PTY_HOST'] === 'true';
  let ptyHostAdapter: PtyHostAdapter | undefined;
  if (ptyHostEnabled) {
    const __serverDirForPty = dirname(fileURLToPath(import.meta.url));
    const ptyHostEntry = resolve(__serverDirForPty, '..', '..', 'pty-host', 'dist', 'index.js');
    if (existsSync(ptyHostEntry)) {
      ptyHostAdapter = new PtyHostAdapter({ logger, hostEntryPath: ptyHostEntry });
      // Still fire-and-forget so boot is not blocked on a child process, but
      // no longer a race: `TerminalService.selectHost` awaits this adapter's
      // `whenReady()` before dropping to `NodePtyHost`, so a terminal opened
      // in the first few hundred ms lands on the same host as one opened a
      // second later. A genuinely failed start still degrades to NodePtyHost.
      void ptyHostAdapter.start().catch((err: unknown) => {
        logger.warn(`[Container] pty-host failed to start — falling back to in-process node-pty: ${String(err)}`);
      });
      logger.info('[Container] GENERATORAI_PTY_HOST=true — out-of-process pty-host enabled');
    } else {
      logger.warn(
        `[Container] GENERATORAI_PTY_HOST is enabled but pty-host build not found at ${ptyHostEntry}. ` +
          'Falling back to in-process node-pty. Run `pnpm --filter @generatorai/pty-host build` first.',
      );
    }
  }
  const terminalHosts = [
    ...(sandboxLifecycleManager ? [new SandboxPtyHost(logger, sandboxLifecycleManager)] : []),
    ...(ptyHostAdapter ? [ptyHostAdapter] : []),
    new NodePtyHost(logger),
    new FallbackChildProcessHost(logger),
  ];
  const terminalService = new TerminalService(
    terminalHosts,
    eventBus,
    logger,
    async (workspaceId) => {
      const ws = await executionWorkspaceRepo.findById(workspaceId);
      if (!ws) return null;
      // The primary mount — the same directory the agent works in — so a
      // command the user types acts on the same tree the agent edits.
      try {
        return (await workspaceManager.getExposure(ws)).workingDirectory;
      } catch {
        return ws.rootPath;
      }
    },
  );
  terminalService.start();
  // Warm the terminal hosts at boot.
  //
  // `NodePtyHost.isAvailable()` lazily `require`s the node-pty NATIVE addon on
  // its first call, and `TerminalService.selectHost` is the first caller — so
  // the very first terminal a user opened paid that load while they waited.
  // Measured: the first `terminal create` cost ~1.1 s more than every one
  // after it, against a raw node-pty spawn of 285 ms.
  //
  // `isAvailable()` is idempotent and synchronous, so probing each host here
  // simply moves the load into startup. Wrapped because a host that cannot
  // load must degrade to the next one, exactly as it does today — this is a
  // warm-up, not a new failure point.
  for (const host of terminalHosts) {
    try {
      host.isAvailable();
    } catch (err) {
      logger.debug?.(`[Container] terminal host warm-up skipped: ${String(err)}`);
    }
  }
  // On workspace deletion, kill any orphaned PTYs first (see R-3).
  workspaceManager.registerBeforeDelete(async (workspaceId) => {
    await terminalService.killAllForWorkspace(workspaceId);
  }, 'native');

  // ── Voice Module ──
  //
  // Engines are built through `createSttEngine`/`createTtsEngine` rather than
  // constructed here, so swapping the speech model is a configuration change
  // and this file never names one. See VoiceEngineFactory.ts for the
  // descriptor table (measured latency, download size, whether the engine
  // emits capitals/punctuation) and for why voice mirrors HarnessFactory's
  // shape rather than inventing a second convention.
  //
  // GENERATORAI_STT_ENGINE selects it:
  //   'auto' (default) — preferred engine, falling back to Whisper if it
  //                cannot load (offline first run, wiped cache, bad override,
  //                OOM session).
  //   'nemotron' | 'parakeet' | 'moonshine' | 'whisper' — that engine only,
  //                no fallback. 'nemotron' additionally needs
  //                GENERATORAI_NEMO_SPEECH_BIN — see NemotronSttEngine.ts.
  //   'disabled' — same as GENERATORAI_STT=0.
  // GENERATORAI_STT_PREFERRED overrides which engine 'auto' tries first.
  // The default is now decided per machine by `defaultPreferredSttEngine()`:
  // Nemotron when its weights are present (the best engine in the table, and
  // the only one with a native streaming decoder, so words appear as they are
  // spoken rather than in blocks after each pause), otherwise Moonshine —
  // which was the previous unconditional default. See VoiceEngineFactory.ts's
  // measured head-to-head.
  // Whisper is never removed, per VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md
  // Part E Phase 1 ("Keep Whisper registered as a fallback engine").
  //
  // No `registerBeforeDelete` hook: STT sessions aren't workspace-scoped
  // (see VoiceService's file header) and already die with their own
  // WebSocket connection.
  //
  // GENERATORAI_STT=0 disables voice input entirely (stt-ws.ts checks the
  // same flag and never attaches the route). Unlike `ttsEngine` below,
  // `VoiceService`'s `sttEngine` constructor param isn't optional — so
  // rather than construct a real Whisper/Parakeet/CascadingSttEngine and
  // let `voiceService.start()` eagerly `load()` (and, on first run,
  // download) it for a route nothing can ever reach, substitute a no-op
  // `DisabledSttEngine` so the flag's "entirely" is actually true (final
  // end-to-end review finding — TTS's equivalent flag already worked this
  // way; STT's didn't).
  const sttDisabled = process.env['GENERATORAI_STT'] === '0';

  // Voice inference runs on a WORKER THREAD, not this one. `onnxruntime-node`
  // executes `session.run()` synchronously on the calling thread despite its
  // Promise-shaped API — measured, a 120s dictation segment blocks the event
  // loop for ~14s and a single "read aloud" for ~10s, during which the server
  // answers nothing at all and `WedgeDetector` (correctly) declares the
  // process wedged and shuts it down. See VoiceWorkerPool.ts for the full
  // measurements. Set GENERATORAI_VOICE_IN_PROCESS=1 to opt back into the
  // old in-process behaviour for debugging; it is not safe for real use.
  const voiceInProcess = process.env['GENERATORAI_VOICE_IN_PROCESS'] === '1';
  // Lazy: the worker is not spawned until an engine actually loads a model,
  // so this costs nothing when voice is unused or disabled.
  const voiceWorkerPool = voiceInProcess ? undefined : sharedVoiceWorkerPool(logger);
  if (voiceInProcess) {
    logger.warn(
      '[Container] GENERATORAI_VOICE_IN_PROCESS=1 — voice inference will run on the main event loop and can wedge the server. Debugging only.',
    );
  }
  const voiceEngineOpts = { logger, ...(voiceWorkerPool ? { workerPool: voiceWorkerPool } : {}) };

  // Settings -> Audio. The ENVIRONMENT still wins: an operator who pinned an
  // engine for a deployment must not be overridden from a UI, which is why
  // the env var is consulted first and the stored choice only fills the gap.
  const audioPrefs = await readAudioPreferences(path.dirname(resolve(config.dbPath)));
  const sttEngineId = sttDisabled
    ? 'disabled'
    : resolveSttEngineId(process.env['GENERATORAI_STT_ENGINE'] ?? audioPrefs.sttEngine, logger);
  const preferred = process.env['GENERATORAI_STT_PREFERRED'];
  const sttEngine = createSttEngine(sttEngineId, {
    ...voiceEngineOpts,
    endpointSilenceMs: audioPrefs.endpointSilenceMs,
    ...(preferred === 'nemotron' || preferred === 'parakeet' || preferred === 'moonshine' || preferred === 'whisper'
      ? { preferred }
      : {}),
  });
  logger.info(`[Container] Voice STT engine: ${sttEngineId} (${sttEngine.name})`);

  // GENERATORAI_VOICE_TEXT_FORMATTER (Phase 2 — Part E):
  //   'rule-based' (default) — local, free, deterministic filler-word +
  //                 spoken-punctuation cleanup. Always safe, no network.
  //   'llm'         — opt-in BYOK cleanup pass: grammar, spelling and
  //                 inferred punctuation beyond what the ASR emits. The API
  //                 key is resolved from the encrypted secrets vault
  //                 (SecretNamespace.voice / textFormatterApiKey — see
  //                 LlmTextFormatter.ts), NEVER a plaintext config value,
  //                 per the security review's standing P0-2 finding. Falls
  //                 back to passing text through unformatted (never breaks
  //                 dictation) if the key is missing or the request fails —
  //                 see LlmTextFormatter's resilience contract.
  //   'none'        — no cleanup pass; raw engine output, same as Phase 1.
  //
  // It stays OPT-IN on purpose. It rewrites the user's own words, and it puts
  // a network round-trip in front of every committed segment; both are
  // choices a deployment should make deliberately, not inherit.
  //
  // ENDPOINT/MODEL are configurable here. LlmTextFormatter's header says "any
  // OpenAI-compatible endpoint works by construction (self-hosted, Azure,
  // OpenRouter, etc.) via `baseUrl`" — which was true of the class and false
  // of the product, because this call site never passed one, hard-pinning
  // every deployment to OpenAI + gpt-4o-mini. Anthropic publishes an
  // OpenAI-compatible chat-completions endpoint, so an install that already
  // has Claude credits can point at it and reuse them rather than buying a
  // second vendor's key:
  //
  //   GENERATORAI_VOICE_TEXT_FORMATTER=llm
  //   GENERATORAI_VOICE_TEXT_FORMATTER_BASE_URL=https://api.anthropic.com/v1/chat/completions
  //   GENERATORAI_VOICE_TEXT_FORMATTER_MODEL=claude-haiku-4-5-20251001
  const textFormatterMode = process.env['GENERATORAI_VOICE_TEXT_FORMATTER'] ?? audioPrefs.textFormatter;
  const formatterBaseUrl = process.env['GENERATORAI_VOICE_TEXT_FORMATTER_BASE_URL'];
  const formatterModel = process.env['GENERATORAI_VOICE_TEXT_FORMATTER_MODEL'];
  const voiceTextFormatter =
    textFormatterMode === 'none'
      ? undefined
      : textFormatterMode === 'llm'
        ? new LlmTextFormatter(security.secretStore, {
            logger,
            ...(formatterBaseUrl ? { baseUrl: formatterBaseUrl } : {}),
            ...(formatterModel ? { model: formatterModel } : {}),
          })
        : new RuleBasedTextFormatter();
  if (textFormatterMode === 'llm') {
    logger.info(`[Container] Voice text formatter: ${voiceTextFormatter?.name} @ ${formatterBaseUrl ?? 'api.openai.com (default)'}`);
  }

  // GENERATORAI_TTS=0 disables voice output entirely (attachTtsWebSocket
  // checks the same flag) — no point constructing/warming an engine that
  // no route will ever reach.
  const ttsEngine = createTtsEngine(
    process.env['GENERATORAI_TTS'] === '0' || !audioPrefs.ttsEnabled ? 'disabled' : 'kokoro',
    { ...voiceEngineOpts, defaultVoice: audioPrefs.ttsVoice, defaultSpeed: audioPrefs.ttsSpeed },
  );

  // GENERATORAI_STT_VAD picks how utterances are segmented:
  //   'silero' (default) — neural VAD. Measured on the reference clip it
  //             finds 6 real pauses where the RMS detector finds 2, because
  //             RMS cannot tell quiet room tone from speech (78% agreement,
  //             and the disagreements are all low-energy non-speech that RMS
  //             calls speech). ~2MB, 0.325ms per 32ms window.
  //   'energy'  — the original RMS detector. No download, no model.
  //
  // Silero is loaded lazily and asynchronously because it needs a one-time
  // 2MB fetch; until it resolves, and forever if it fails, sessions fall back
  // to the RMS detector rather than losing dictation. Segmentation degrading
  // is survivable; not segmenting at all is not.
  const vadMode = process.env['GENERATORAI_STT_VAD'] ?? 'silero';
  let createVad: (() => VoiceActivityDetector) | undefined;
  if (vadMode === 'silero' && !sttDisabled && voiceWorkerPool) {
    void createSileroVadFactory(voiceWorkerPool, {}, logger)
      .then((factory) => {
        createVad = factory;
      })
      .catch((err: unknown) => {
        logger.warn(
          `[Container] Silero VAD unavailable (${(err as Error).message}); segmenting with the RMS detector instead.`,
        );
      });
  }

  const voiceService = new VoiceService(
    sttEngine,
    eventBus,
    logger,
    undefined,
    voiceTextFormatter,
    ttsEngine,
    // Read through a closure, not captured by value: the neural detector
    // becomes available a moment after boot, and sessions started before then
    // simply use the fallback.
    () => createVad?.() ?? new EnergyVad(),
  );
  voiceService.start();

  // ── Workflow Script Loader ──
  const scriptDirs = [
    resolve(config.templatesDir, 'scripts'),
    resolve(config.templatesDir),
  ];
  const workflowScriptLoader = new WorkflowScriptLoader(logger, scriptDirs, hookExecutor, {
    // The gate lives IN the loader, so the boot-time scan below and the
    // reload/validate/upload routes are all refused together when scripts are
    // not opted in — not just the upload route.
    enabled: config.scripts.workflowScriptsEnabled,
  });

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

  // Extension-authoring tools.
  //
  // Registered on the process-wide registry, but NOT handed to every
  // conversation: `ChatManagementService.selectCustomTools` filters them out
  // unless the chat's agent grants the `extensionAuthoring` capability, which
  // is false by default (review 5.3). These two tools write a file tree and
  // import it into THIS process, so they are host code execution — a chat has
  // to be given that, never assumed to have it.
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
    sourceControlFlowService,
    repoReadinessService,
    scmTextGenerator,
    editorLauncherService,

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
    workspaceRetentionService,
    systemArtifactService,

    // Agents (first-class agent entity)
    agentRepo,
    agentService,
    agentResolver,
    agentStaging,
    artifactCatalog,

    // Workspace Management
    workspaceManager,
    mountService,

    // Checkpoints (workspace snapshots / rewind)
    checkpointService,
    workspaceCheckpointService,
    checkpointRepo,
    changeSummaryService,
    workspaceTreeService,
    reviewThreadService,
    reviewRepo,
    workspaceFileReviewRepo,

    // Integrated Browser (v13)
    browserService,
    // Exposed so routes/internal-browser.ts can push each workspace's
    // scoped CDP endpoint as Electron main's active tab changes.
    electronBridgeAdapter,

    // Computer Use
    computerService,
    computerUseRepo,
    cuaDriverBridge,
    computerConsentStore,
    screenCast,
    // Expose the execution-workspace + artifact repos so routes can read
    // browser artifacts + workspace rows without a full service round-trip.
    executionWorkspaceRepo,
    workspaceArtifactRepo,

    // Integrated Terminal
    terminalService,

    // Voice Module (Phase 0 — STT half)
    voiceService,

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
    // W34 — exposed so a future settings UI/API can list/create/enable
    // harness_instances without composition-root growing another wiring path.
    providerInstanceRegistry,
    harnessInstanceRepo,
    // W12 — exposed so tests and health routes can check which path is active.
    // undefined = fell back to in-process MultiHarness.
    hostSupervisor,
    admissionController,
    streamBroker,
    customToolRegistry,
    mcpHub,
    mcpSettingsStore,
    mcpCredentialVault,
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

      // W41-N2 — seed provider status from disk before any getAllModels() call.
      // Never throws (loadDiskCache is best-effort). Must come before hydrate()
      // so the registry knows which providers are installed before routing.
      await harnessRegistry.loadDiskCache(); /* W41-N2 */

      // W34 / P1-42 — rehydrate conversation→provider ownership from DB so
      // routing is correct from the first request after a restart.
      try {
        await multiHarness.hydrate();
        logger.info('[Container] MultiHarness ownership rehydrated');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Container] MultiHarness hydration failed (ownership reset): ${msg}`);
      }

      // W34 — rehydrate conversation→provider INSTANCE ownership. A no-op
      // (empty rows) for every deployment that has never registered a
      // harness_instances row, same as providerInstanceRegistry itself.
      try {
        await providerInstanceRegistry.hydrate();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Container] Provider instance ownership hydration failed: ${msg}`);
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
      //
      // §1.Q — skipped under the FauxProvider load-test escape hatch. This
      // warm-up is independent of `harness` (it walks `harnessRegistry`,
      // which is constructed with real provider configs regardless of the
      // Faux override above) and spawns the REAL provider CLI — e.g. a real
      // `copilot` process — to probe it. On a machine with no configured
      // credentials that probe can stall rather than exit, and the load
      // test's own `killOwnDescendants()` shutdown assertion caught exactly
      // that: a leftover `copilot.exe`/`conhost.exe` pair reaped at shutdown
      // even though FauxProvider had handled every actual conversation.
      if (loadTestFauxHarness) {
        logger.warn('[Container] GENERATORAI_LOAD_TEST_FAUX_HARNESS=true — skipping real-provider model-catalog warm-up.');
      } else {
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
      }

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

      // Chat turns the previous process died in: persist what streamed and
      // write the terminal events a reconnecting client is waiting for.
      // Runs after `recover()` so sequence counters are already restored.
      try {
        const interrupted = await new InterruptedTurnRecoveryService(
          chatEntityRepo,
          chatMessageRepo,
          eventBus,
          logger,
        ).recover();
        if (interrupted.interrupted > 0) {
          logger.warn(
            `[Container] closed ${interrupted.interrupted} chat turn(s) interrupted by the last shutdown ` +
              `(${interrupted.persistedPartials} partial message(s) persisted)`,
          );
        }
      } catch (err) {
        logger.warn(`[Container] interrupted-turn recovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Child processes a previous run left behind (Windows does not end a
      // process's descendants with it): rg scans and CLI sessions whose parent
      // is gone and whose command line names one of OUR directories. Scoped
      // that way so nothing else on the machine is touched. Fire-and-forget —
      // boot must not wait on a process listing. `GENERATORAI_REAP_ORPHANS=false`
      // opts out.
      if (process.env['GENERATORAI_REAP_ORPHANS'] !== 'false') {
        void new OrphanProcessReaper({
          ownedDirs: [config.artifactsDir, config.workspacesDir, path.dirname(resolve(config.dbPath))],
          logger,
        })
          .reap()
          .catch((err: unknown) => {
            logger.warn(`[Container] orphan process reap failed: ${err instanceof Error ? err.message : String(err)}`);
          });
      }

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

      // Re-arm workflow post-processing that a restart interrupted.
      //
      // Auto-commit and auto-PR were attached to a run only as an in-memory
      // event subscription, so a restart lost them silently: the run reported
      // success and never opened its pull request. The intent is persisted on
      // the run now, and this is what picks it back up (review 6.2).
      if (workflowOrchestrator) {
        try {
          await workflowOrchestrator.reArmPendingPostProcessing();
        } catch (err) {
          logger.warn(
            `[Container] Re-arming workflow post-processing failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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

      // Workspace retention: the nightly execution-workspace sweep. A no-op
      // until the user opts in from Settings.
      workspaceRetentionService.start();

      // Load system-level artifacts (skills, prompts, agents)
      await systemArtifactService.loadSystemArtifacts();

      // Upsert the bundled `*.agent.md` definitions. Runs after the artifact
      // scan so an agent's declared skills resolve to real catalog ids.
      try {
        await agentService.syncSystemAgents(systemArtifactService.artifactsDir);
      } catch (err) {
        logger.warn(
          `[Container] System agent sync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

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
      workspaceRetentionService.stop();
      // Stop run poll loops + unsubscribe EventBus listeners + close run loggers
      // so no new events are produced and no setInterval handles are orphaned.
      workflowRunService.shutdown();

      // Kill any live terminal sessions (PTY handles hold FDs → must not
      // outlive the process on shutdown paths where OS reaping is unreliable).
      await terminalService.shutdown();
      // …then tear down the out-of-process host itself. `stop()` had ZERO
      // callers, so every server restart left a pty-host process — and the
      // shells it owned — running. Ordered after `terminalService.shutdown()`
      // so sessions get their normal kill path first; the host's SIGTERM
      // handler is the backstop for anything that did not.
      if (ptyHostAdapter) {
        await ptyHostAdapter.stop().catch((err: unknown) => {
          logger.warn(`[Container] pty-host stop failed: ${String(err)}`);
        });
      }
      // Cancel any live dictation sessions + release the STT engine.
      await voiceService.shutdown();
      // Then terminate the inference worker the engines were delegating to.
      // Ordered after voiceService.shutdown() so in-flight transcriptions get
      // cancelled through the normal path first, rather than being rejected
      // by a worker that vanished underneath them. It is `unref`'d, so this
      // is tidiness rather than something the process would hang without.
      await disposeSharedVoiceWorkerPool();

      // Deny every parked consent prompt before tearing the service down, so
      // no `act()` is left awaiting an answer that can never arrive, and end
      // any live driver sessions.
      computerConsentStore.cancelAll();
      await computerService.dispose();

      // Stop every live Integrated Browser session through its normal path
      // (bridge stop, row → terminated, `browser.session_stopped`). Before
      // this the browser service was the one live-process owner missing from
      // this sequence, so each graceful restart force-killed its Chromiums
      // via the descendant reaper instead. Ordered before `harness.shutdown()`
      // because the agent's browser tools reach these sessions.
      await browserService.dispose().catch((err: unknown) => {
        logger.warn(`[Container] browser service dispose failed: ${String(err)}`);
      });

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
      // AND the broker's write batcher. `eventBus.flush()` only covers events
      // emitted through the bus; the bridge publishes the run- and chat-scope
      // copies fire-and-forget, so those sit in the batcher for up to the delta
      // window. Closing the handle first ran their commit against a closed
      // connection and lost the last few hundred milliseconds of every run,
      // while the session-scope copies survived — a hole on the run page that
      // the session page did not have.
      await streamBroker.flushWrites();
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
  /** The commit → sync → push → PR flow (doc §4), shared by chat/workspace routes. */
  sourceControlFlowService: SourceControlFlowService;
  /** "Can this mount commit / push / open a PR, and if not why" (doc §3). */
  repoReadinessService: RepoReadinessService;
  /** Model-written commit messages and PR text (heuristic fallback). */
  scmTextGenerator: ScmTextGenerator;
  /** "Open in editor" — probes the editor CLIs and launches one detached (doc §7). */
  editorLauncherService: EditorLauncherService;

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
  workspaceRetentionService: WorkspaceRetentionService;
  projectConfigService: ProjectConfigService;
  systemArtifactService: SystemArtifactService;
  agentRepo: DrizzleAgentRepository;
  agentService: AgentService;
  agentResolver: AgentResolver;
  agentStaging: AgentStagingService;
  artifactCatalog: ArtifactCatalog;

  // Workspace Management
  workspaceManager: WorkspaceManager;
  mountService: MountService;
  checkpointService: CheckpointService;
  workspaceCheckpointService: WorkspaceCheckpointService;
  checkpointRepo: DrizzleCheckpointRepository;
  changeSummaryService: ChangeSummaryService;
  workspaceTreeService: WorkspaceTreeService;
  reviewThreadService: ReviewThreadService;
  reviewRepo: DrizzleReviewRepository;
  /** Per-file "Keep" rows behind the Changes tab's review flow. */
  workspaceFileReviewRepo: DrizzleWorkspaceFileReviewRepository;

  /** Integrated Browser service (v13). Optional per workspace/chat/run. */
  browserService: BrowserService;
  /** Desktop CDP bridge — exposed so routes/internal-browser.ts can push
   *  per-workspace scoped CDP endpoints from Electron main. */
  electronBridgeAdapter: ElectronBridgeAdapter;

  /** Computer Use service. Refuses everything unless a desktop is attached. */
  computerService: ComputerService;
  computerUseRepo: DrizzleComputerUseRepository;
  /** Exposed so routes/internal-computer.ts can push the driver socket path. */
  cuaDriverBridge: CuaDriverBridge;
  /** Exposed so routes/internal-computer.ts can deliver the user's answer. */
  computerConsentStore: PendingConsentStore;
  screenCast: ScreenCast;
  /** Execution workspace repo — exposed for the browser route (read workspace row). */
  executionWorkspaceRepo: InstanceType<typeof DrizzleExecutionWorkspaceRepository>;
  /** Workspace artifact repo — exposed for the browser route (list browser artifacts). */
  workspaceArtifactRepo: InstanceType<typeof DrizzleWorkspaceArtifactRepository>;

  /** Integrated Terminal service — ephemeral PTY sessions per workspace. */
  terminalService: TerminalService;

  /** Voice Module service — ephemeral STT (+ TTS from Phase 3) sessions. */
  voiceService: VoiceService;

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
  /**
   * W34 — metadata + conversation-ownership registry for `harness_instances`
   * rows (multiple accounts of the same driver). Populated at boot by
   * `registerHarnessInstances()`; empty in every deployment that has never
   * written to `harness_instances`.
   */
  providerInstanceRegistry: ProviderInstanceRegistry;
  /** Raw `harness_instances` CRUD — for a future settings UI/API. */
  harnessInstanceRepo: SqliteHarnessInstanceRepository;
  /**
   * W12 — Gateway-side supervisor for the agent-host child process.
   * `undefined` unless the agent-host build exists AND GENERATORAI_AGENT_HOST=true
   * (i.e. when MultiHarness is the active harness instead of AgentHostClient).
   */
  hostSupervisor: HostSupervisor | undefined;
  /**
   * W18 — lane-based admission control. Exposed so `/api/health` can publish
   * cap/running/queued/parked per lane, which the plan requires so throttling
   * is observable rather than mysterious.
   */
  admissionController: AdmissionController;
  streamBroker: StreamBroker;
  /** TOL-01 — harness-agnostic custom tool catalog. Empty by default. */
  customToolRegistry: CustomToolRegistry;
  /** TOL-06 — MCP server configuration hub. Pass-through by default. */
  mcpHub: IMcpHub;
  /** W48 — server-side settings for the bundled MCP catalog + custom servers. */
  mcpSettingsStore: McpSettingsStore;
  /** W48 — the only place MCP credential VALUES are read/written. */
  mcpCredentialVault: McpCredentialVault;
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

