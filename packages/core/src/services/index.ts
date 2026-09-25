// @generatorai/core services exports
export { ArtifactService } from './ArtifactService.js';
export { HookExecutor } from './HookExecutor.js';
export type { HookContext, HookDryRunPlan, HookDryRunEntry } from './HookExecutor.js';
export { HookInterceptor } from './HookInterceptor.js';
export { SessionHookRegistry, sessionHookBridgeFactory } from './SessionHookRegistry.js';
export type { SessionHookHandler } from './SessionHookRegistry.js';
export type { SDKHookContext, StageHookContext } from './HookInterceptor.js';
export { TemplateRegistry, TemplateLoadError, TEMPLATE_FILE_SUFFIX } from './TemplateRegistry.js';
export { StartupRecoveryService } from './StartupRecoveryService.js';
export { InterruptedTurnRecoveryService, INTERRUPTED_BY_RESTART_CODE } from './InterruptedTurnRecoveryService.js';
export { OrphanProcessReaper, selectOrphans } from './OrphanProcessReaper.js';
export type { OsProcess, OrphanProcessReaperOptions, ReapSummary } from './OrphanProcessReaper.js';
export type { InterruptedTurnRecoverySummary } from './InterruptedTurnRecoveryService.js';
export { ErrorHandler } from './ErrorHandler.js';

// Workflow execution services
export { SessionAllocator } from './SessionAllocator.js';
export { ChatManagementService } from './ChatManagementService.js';
export type {
  ChatManagementServiceExtensions,
  RewindChatResult,
  ForkChatResult,
  InternalCreateChatExtras,
} from './ChatManagementService.js';
export { WorkflowDefinitionService, assertValidGraph, COMMAND_EDIT_SCOPE } from './WorkflowDefinitionService.js';
export type { DefinitionWriteOptions, CreateDefinitionOptions, DeleteOutcome } from './WorkflowDefinitionService.js';
export { RunDefinitionReader } from './definitions/RunDefinitionReader.js';
export { canonicalGraph } from './definitions/canonical.js';
export { userVariables, codebasesOf, runScope, stagesScope, templateScope } from './definitions/runScope.js';
export type { RunScope, StageScope, CodebaseScope } from './definitions/runScope.js';
export { DAGScheduler } from './DAGScheduler.js';
export { StageExecutionService } from './StageExecutionService.js';
export { WorkflowRunService } from './WorkflowRunService.js';

// W18 — Admission control + concurrency management
export { AdmissionController, AdmissionTimeoutError, laneFor, sizeLane } from './AdmissionController.js';
export type {
  AdmissionLane,
  AdmissionControllerConfig,
  AdmissionClassification,
  AdmissionTicket,
  LaneSnapshot,
  SizingDecision,
} from './AdmissionController.js';

// Orchestrator mode (background-agent orchestration for Chat)
export { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from './orchestrator/OrchestratorService.js';
export type { OrchestratorConfig, SpawnResult } from './orchestrator/OrchestratorService.js';
export { ORCHESTRATOR_SYSTEM_PROMPT, WORKER_SYSTEM_PROMPT } from './orchestrator/prompts.js';
export { buildOrchestratorToolSet } from '../tools/orchestrator/index.js';

// Orchestrator services
export { WorkflowOrchestrator } from './WorkflowOrchestrator.js';
export type { OrchestratorSandbox } from './WorkflowOrchestrator.js';
export { createRunSandbox } from './createRunSandbox.js';
export type { RunSandboxOptions } from './createRunSandbox.js';
export { WorkflowPreprocessor } from './WorkflowPreprocessor.js';
export type { WorkflowScmFlowPort } from './WorkflowPreprocessor.js';
export { ResultValidator } from './ResultValidator.js';

// Phase 4 streaming rewrite (additive — coexists with legacy transports)
export { StreamBroker } from './StreamBroker.js';
export { StreamWriteBatcher } from './StreamWriteBatcher.js';
export type { StreamWriteBatcherOptions } from './StreamWriteBatcher.js';
export { DeltaLog } from './DeltaLog.js';
export type { DeltaLogEntry, DeltaLogOptions } from './DeltaLog.js';
export type {
  StreamEventRow,
  StreamScope,
  StreamEventHandler,
  StreamBrokerPublishResult,
  StreamBrokerSubscribeOptions,
} from './StreamBroker.js';

// Automation services
export { AutomationService, hashWebhookToken, toPublicAutomation } from './AutomationService.js';
export type { IAutomationRepository, IAutomationExecutionRepository, ResolvedWebhook } from './AutomationService.js';
export { splitShellWords, ShellWordsError } from './shellWords.js';
export { planIterations, previewIterations } from './IterationPlanner.js';
export type { PlanArgs } from './IterationPlanner.js';
export { AutomationRecoveryService } from './AutomationRecoveryService.js';
export type { IIdempotencyKeyRepository } from './AutomationRecoveryService.js';

// Sandbox services
export { SandboxLifecycleManager } from './SandboxLifecycleManager.js';
export type { SandboxSession, SandboxLifecycleConfig } from './SandboxLifecycleManager.js';

// HITL-01..05 — human-in-the-loop interrupt/resume.
export { HitlService } from './HitlService.js';
export type { InterruptResolution, HitlLogger } from './HitlService.js';

// PLN-01 — plan mode
export { AgentInteractionService } from './AgentInteractionService.js';
export type {
  InteractionScope,
  InteractionOutcome,
  OpenInteractionOptions,
  AgentInteractionServiceConfig,
  InteractionLogger,
} from './AgentInteractionService.js';
export { PlanService, PLAN_DIR, buildPlanFileName } from './PlanService.js';
export type { CreatePlanFromGateParams, PlanServiceLogger } from './PlanService.js';

// Project & Codebase Management services
export { ProjectService } from './ProjectService.js';
export { CodebaseService } from './CodebaseService.js';
export { WorktreeService } from './WorktreeService.js';
export { ProjectConfigService } from './ProjectConfigService.js';
export { WorktreeCleanupService } from './WorktreeCleanupService.js';
export { WorkspaceRetentionService } from './WorkspaceRetentionService.js';
export type {
  WorkspaceRetentionResult,
  WorkspaceRetentionServiceOptions,
  WorkspaceRetentionPrefs,
} from './WorkspaceRetentionService.js';
export { SystemArtifactService } from './SystemArtifactService.js';
export type { ISystemConfigRepository } from './SystemArtifactService.js';

// ── Agents (first-class agent entity) ──
export { ArtifactCatalog } from './ArtifactCatalog.js';
export type { CatalogSkill, CatalogMcpServer, IProjectConfigReader } from './ArtifactCatalog.js';
export { AgentResolver, redactProjection } from './AgentResolver.js';
export type { ResolveAgentInput } from './AgentResolver.js';
export { AgentService } from './AgentService.js';
export type { AgentServiceDeps, ModelCatalogProbe } from './AgentService.js';
export { AgentStagingService } from './AgentStagingService.js';
export type { StagingResult } from './AgentStagingService.js';
export {
  parseAgentMarkdown,
  serialiseAgentMarkdown,
  AGENT_MARKDOWN_MAX_BYTES,
} from './agentMarkdown.js';
export type { ParsedAgentMarkdown } from './agentMarkdown.js';

// Workspace Management services
export { WorkspaceManager, WorkspaceTreeBusyError, resolveWorktreePath } from './WorkspaceManager.js';
export type { WorkspaceManagerConfig, WorkspaceTeardownPhase } from './WorkspaceManager.js';
export { WorkspaceCheckpointService } from './WorkspaceCheckpointService.js';
export type { MountSource, RestoreTurnResult } from './WorkspaceCheckpointService.js';
export {
  groupTurns,
  lastAnchor,
  firstAnchor,
  turnsAreAnchored,
  buildConversationSeed,
  applyConversationSeed,
} from './chatTranscript.js';
export type { ChatTurn } from './chatTranscript.js';
export {
  MountService,
  buildExposure,
  branchSlugFor,
  GENERATED_MOUNT_ALIAS,
  SCRATCH_DIR,
  SOURCE_DIR,
} from './MountService.js';
export type { PlannedMount, PlanOptions, MountServiceDeps, PrepareScope } from './MountService.js';
export { buildWorkspaceHint } from './chatSystemHints.js';
export { buildAutoCommitHint } from './chatSystemHints.js';
export type {
  CaptureWorkspaceCheckpointParams,
  WorkspaceRepoRef,
} from './WorkspaceCheckpointService.js';
export { SourceControlService } from './SourceControlService.js';
export type { CreatePrParams } from './SourceControlService.js';
// Source control — accounts, readiness, commit → PR flow, PR review, editors.
// `SourceControlConfigService` now lives under ./scm/ (accounts + secret-store
// tokens); the legacy `getConfig`/`setConfig` shims are still on it.
export * from './scm/index.js';
export { PathResolver, PathEscapeError, SymlinkEscapeError } from './PathResolver.js';

// Workflow Script services
export { WorkflowScriptLoader, WORKFLOW_SCRIPTS_DISABLED_MESSAGE, ScriptSecurityError, ScriptValidationError, scriptIdOf } from './WorkflowScriptLoader.js';
export type { ScriptMetadata, LoadedScript, WorkflowScriptLoaderOptions } from './WorkflowScriptLoader.js';

// Integrated Browser service (v13)
export { BrowserService } from './BrowserService.js';
export type { BrowserServiceConfig } from './BrowserService.js';

export { ComputerService } from './ComputerService.js';
export type {
  ComputerServiceConfig,
  ComputerUseConfig,
  ComputerCallContext,
  ComputerConsentPrompt,
  ComputerConsentScope,
  ComputerStoredGrant,
  ComputerAuditEntry,
  IComputerConsentStore,
  IComputerAuditSink,
} from './ComputerService.js';

// Integrated Terminal service
export { TerminalService } from './TerminalService.js';
export type { TerminalServiceConfig, TerminalViewer } from './TerminalService.js';

// Voice Module service (Phase 0-4)
export { VoiceService } from './VoiceService.js';
export type { VoiceServiceConfig, SttSessionHandle, SpeakOptions, SpeechSessionHandle } from './VoiceService.js';

// ── Widgets & Extensions ──
export { WidgetRegistry } from './WidgetRegistry.js';
export { WidgetService } from './WidgetService.js';
export type { CreateWidgetInstanceParams, WidgetServiceConfig } from './WidgetService.js';
export {
  ExtensionManager,
  newWidgetInstanceId,
  encodeAssetPath,
  decodeAssetPath,
} from './ExtensionManager.js';
export type {
  ExtensionManagerConfig,
  ExtensionManagerDeps,
} from './ExtensionManager.js';
// v2 authoring surface — the `ai` handle passed to loadExtension.
export { ExtensionAPI } from './ExtensionApi.js';
export type {
  ExtensionDisposer,
  StagedWidgetInput,
  StagedToolInput,
  StagedMcpServerInput,
  StagedCommandInput,
  StagedHookInput,
  StagedSkillInput,
  StagedPromptInput,
  StagedContributions,
} from './ExtensionApi.js';


// Agent-mode / permission policy (deployment-posture aware default).
export {
  setDefaultChatPermissionMode,
  getDefaultChatPermissionMode,
  resolveTurnPermissionMode,
  shouldAttachPermissionHandler,
} from './agentModePolicy.js';

export * from './push/index.js';

// W12 — Agent Host client (gateway-side IAgentHarness proxy)
export { AgentHostClient } from './AgentHostClient.js';

// W14 — PTY Host client (gateway-side PTY proxy)
export { PtyHostClient } from './PtyHostClient.js';
export type { PtyHostClientOptions, PtyDataHandler, PtyExitHandler, PtyReadyHandler } from './PtyHostClient.js';
export { PtyHostAdapter } from './PtyHostAdapter.js';
export type { PtyHostAdapterOptions } from './PtyHostAdapter.js';

// △ W15/W17 — `BrowserHostClient` and `CuaHostClient` were DELETED, not moved.
//
// Both were exported here with zero callers anywhere in the app, and neither
// could acquire one without being rewritten:
//
//   • BrowserHostClient's own header called itself "a drop-in replacement for
//     in-process Playwright usage". It covered 8 of `IBrowserBridge`'s ~30
//     operations — no cookies, no DOM snapshot, no inspector, no ref-based
//     element addressing, no `invokeFunction` — and its screencast was a
//     `page.screenshot()` poll loop, which is the capture path W15 replaced.
//   • CuaHostClient drives a protocol (`CuaHostIpc.ComputerAction`) that
//     carries NO app or window identity, so every action resolves "whatever is
//     frontmost". `IComputerBridge`'s own header names that hazard: "the user
//     approves Safari and the click lands in 1Password." It must not be wired
//     until the protocol carries addressing, so a client for it is dead by
//     design, not by omission.
//
// `apps/browser-host` and `apps/cua-host` still exist and still have their own
// tests. What is gone is the claim, made by exporting these from the core
// package's public surface, that the gateway can already use them.

// W22 — Durable execution engine (§3.4 / P0-41 / X-23 fix)
export { DurableExecutionEngine } from './DurableExecutionEngine.js';
export type {
  ReplayPolicy,
  JournalCorruption,
  EffectSpec,
  DurableContext,
} from './DurableExecutionEngine.js';
export * from './session/index.js';
