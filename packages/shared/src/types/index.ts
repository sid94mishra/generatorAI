// Shared types barrel
export { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from './ProviderConfig.js';
export type { HarnessProviderId, ReasoningEffort } from './ProviderConfig.js';
export type {
  AgentEvent,
  AgentEventKind,
  FileOpHunk,
  FileOpStat,
  PersistedEvent,
} from './AgentEvent.js';
export {
  isAgentEvent,
  isHarnessEvent,
  isWorkflowRunEvent,
  isStageRunEvent,
  isChatEvent,
  isSessionEvent,
  isGitEvent,
  isHookEvent,
  isBrowserEvent,
  isComputerEvent,
  createAgentEvent,
  isEventOfKind,
  narrowEvent,
} from './AgentEvent.js';

export type { EventClass } from './eventClass.js';
export {
  EVENT_CLASS,
  DELTA_SESSION_INFO_TYPES,
  classifyEvent,
  isDeltaEvent,
} from './eventClass.js';

export type {
  HookPhase,
  HookType,
  HookFailurePolicy,
  HookDefinition,
  HookConfig,
  ScriptHookConfig,
  HttpHookConfig,
  FunctionHookConfig,
  WorkflowHookPhase,
  WorkflowHookDefinition,
  HookResult,
  HookPhaseResult,
} from './HookDefinition.js';

export type { Session, SessionOwnerType, SessionStatus } from './Session.js';

export type { HarnessConfig } from './Workflow.js';

export type { ChatMessage, ChatMessageMetadata } from './ChatMessage.js';
export type { Artifact } from './Artifact.js';

export type {
  ComputerActionPath,
  ComputerRefusalCode,
  ComputerVerification,
  ComputerElement,
  ComputerAppInfo,
  ComputerWindowInfo,
  ComputerSnapshot,
  ComputerScreenshot,
  ComputerActionResult,
  ComputerConsentDecision,
  ComputerGrantDecision,
  ComputerConsentReach,
  ComputerConsentPlanStep,
  ComputerPendingConsent,
  ComputerConsentAnswer,
  ComputerConsentAnswerResult,
  ComputerGrant,
  ComputerControlMode,
  ComputerControlState,
  ComputerCapabilities,
} from './ComputerUse.js';
export { COMPUTER_ANY_APP, COMPUTER_CONTROL_MODES, defaultConsentReach } from './ComputerUse.js';
export type { McpServerConfig } from './McpServerConfig.js';
export type { ILogger } from './ILogger.js';

// ── Agents (first-class agent entity) ──
export type {
  Agent,
  AgentScope,
  AgentRole,
  AgentProjectionMode,
  AgentToolPolicy,
  AgentRuntimePolicy,
  AgentOrchestrationPolicy,
  AgentOverrides,
  CreateAgentParams,
  UpdateAgentParams,
  ResolutionWarning,
  ResolutionWarningCode,
  ResolvedAgentProjection,
  ResolvedSkillRef,
  ResolvedTeamAgent,
} from './Agent.js';
export {
  AGENT_TOOL_GROUPS,
  DEFAULT_AGENT_TOOL_POLICY,
  AGENT_SLUG_PATTERN,
  AGENT_INSTRUCTIONS_MAX_BYTES,
  AGENT_INSTRUCTIONS_WARN_BYTES,
  agentRef,
  parseAgentRef,
  slugifyAgentName,
} from './Agent.js';

// ── v2 New Types ──
export type { Chat, ChatStatus, ChatLocalFolder, CreateChatParams, BackgroundTaskStatus, BackgroundTaskMeta, BackgroundTaskCancelledBy, BackgroundTaskCancellation, BackgroundTaskCancelResult, BackgroundTaskListItem, ChatPermissionMode, ChatPrincipal } from './Chat.js';
export { BACKGROUND_TASK_CANCELLERS } from './Chat.js';
export { DEFAULT_CHAT_PERMISSION_MODE } from './Chat.js';

// ── Agent modes (mode registry, plan documents, interactive questions) ──
export type {
  AgentMode,
  AgentModeDescriptor,
  AgentPermissionMode,
  PlanGateBehaviour,
  PlanAction,
  PlanStatus,
  PlanRevision,
  PlanCommentAnchor,
  PlanComment,
  PlanDecision,
  PlanScope,
  PlanDocument,
  PlanCardSummary,
  AgentQuestionOption,
  AgentQuestion,
  AgentQuestionResponse,
  QuestionCardSummary,
  ToolPermissionType,
  ToolPermissionRequestPayload,
  ToolPermissionResolution,
  PermissionCardSummary,
  AgentInteractionKind,
  AgentInteractionStatus,
  AgentInteraction,
  PlanReviewResolution,
  StageReviewOutcome,
} from './AgentMode.js';
export {
  AGENT_MODE_REGISTRY,
  agentModeDescriptor,
  DEFAULT_AGENT_MODE,
  AGENT_MODES,
  isAgentMode,
  PLAN_ACTIONS,
  isPlanAction,
  TERMINAL_INTERACTION_STATUSES,
  STAGE_REVIEW_OUTCOMES,
  isStageReviewOutcome,
} from './AgentMode.js';
export type {
  WorkflowRun,
  RunUsage,
  WorkflowRunStatus,
  StageRun,
  StageRunStatus,
  WorkflowRunWithStages,
  LoopIteration,
  LoopStateView,
  MapItemView,
  MapStateView,
  MapWinnerView,
  SubworkflowStateView,
  ExpansionStateView,
  PendingDecisionView,
  WorkflowRunPermissionMode,
  ArtifactManifestEntry,
} from './WorkflowRun.js';

export type {
  IPlatformClient,
  InvocationFiles,
  WorkflowRunListFilter,
  PlatformType,
  PaginatedResult,
  EventSubscriptionOptions,
} from './IPlatformClient.js';

// ── Automation Types ──
export type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  AutomationExecutionWithRuns,
  AutomationWithExecutions,
  AutomationTriggerType,
  AutomationErrorPolicy,
  AutomationExecutionStatus,
  AutomationRunItemStatus,
  AutomationRetryPolicy,
  AutomationMissedRunPolicy,
  AutomationOverlapPolicy,
  BatchDataFormat,
  ParsedBatchData,
  CreateAutomationParams,
  UpdateAutomationParams,
  TriggerAutomationBody,
  // E1 — Dynamic Data Source types
  // Track C — Schema-driven pipeline
  DataFieldType,
  DataFieldDef,
  DataSchema,
  IterationMode,
  AutomationDataset,
  PlannedIterations,
  IterationPreview,
} from './Automation.js';

// ── Project & Codebase Types ──
export type {
  Project,
  ProjectStatus,
  ProjectSettings,
  WorktreeRetentionPolicy,
  CreateProjectParams,
  UpdateProjectParams,
  CodebaseType,
  CodebaseStatus,
  ProjectCodebase,
  CodebaseSettings,
  CreateCodebaseParams,
  UpdateCodebaseParams,
  ConfigType,
  ProjectConfig,
  CreateProjectConfigParams,
  WorktreeRunType,
  WorktreeStatus,
  WorktreeInfo,
  EntityScope,
  ProjectWithCodebases,
  ProjectSummary,
  SystemConfig,
  ArtifactSource,
  ArtifactType,
  ArtifactWithSource,
  McpServerEntry,
  FileEntry,
  // G-16 — codebase fetch/clone jobs and live logs
  CodebaseJobKind,
  CodebaseJobStatus,
  CodebaseJob,
  CodebaseLogLine,
  CodebaseLogsResponse,
  FetchCodebaseResult,
  // G-17 — worktree enrichment
  WorktreeLinkEntity,
  WorktreeLink,
  WorktreeListItem,
  WorktreeListEnriched,
  // G-19 — per-project artifact customization
  ProjectArtifactPrefEntry,
  ProjectArtifactPrefs,
} from './Project.js';

// ── MCP servers (config forwarding, credentials, startup status) ──
export type {
  McpTransport,
  McpServerSource,
  McpCredentialRefs,
  McpCredentialInput,
  SystemMcpCatalogInput,
  SystemMcpCatalogCredential,
  SystemMcpCatalogEntry,
  SystemMcpServerPrefs,
  CustomMcpServerRecord,
  McpSettings,
  McpNeedsConfiguration,
  McpServerStartupStatus,
  McpStartupWarning,
} from './McpServer.js';
export {
  MCP_SECRET_REF_PREFIX,
  MCP_REDACTED_VALUE,
  MCP_PLACEHOLDER_RE,
  mcpCredentialNamespace,
  mcpCredentialSecretName,
  mcpSecretRef,
  isMcpSecretRef,
  parseMcpSecretRef,
  redactMcpValues,
  mcpStartupWarnings,
} from './McpServer.js';

// ── Run lifecycle ──
export type {
  PreprocessingResult,
  RunCodebase,
  RunPhaseRecord,
  RunSystemVars,
  RunWorkspaceInfo,
} from './RunLifecycle.js';

// ── Workspace Management Types ──
export type {
  WorkspaceOwnerType,
  WorkspaceStatus,
  WorkspaceArtifactType,
  BrowserSessionStatus,
  WorktreeDetail,
  ExecutionWorkspace,
  MountMode,
  MountOriginKind,
  MountStatus,
  MountGitState,
  WorkspaceMount,
  WorkspacePrepStatus,
  ChatSourceSpec,
  WorkspaceExposure,
  WorkspaceArtifactRecord,
  WorkspaceInfo,
  CreateWorkspaceParams,
  WorkspaceFilters,
  TrackArtifactParams,
  WorkspaceRetentionPolicy,
  WorkspaceManifest,
} from './Workspace.js';

// ── Checkpoint Types (workspace snapshots / rewind) ──
export type {
  CheckpointKind,
  CheckpointRefKind,
  CheckpointProvenance,
  CheckpointStats,
  CheckpointRecord,
  CreateCheckpointParams,
  CheckpointFilters,
  CheckpointDiffFile,
  RestoreCheckpointResult,
  CheckpointRetentionPolicy,
} from './Checkpoint.js';
export { DEFAULT_CHECKPOINT_RETENTION } from './Checkpoint.js';

// ── Integrated Browser Types ──
export type {
  BrowserMode,
  BrowserConfig,
  BrowserSessionDescriptor,
  BrowserActionKind,
  BrowserAction,
  BrowserInspectorSelection,
  ImportedCookie,
} from './BrowserSession.js';

// ── Integrated Terminal Types ──
export type {
  TerminalSessionDescriptor,
  TerminalHostKind,
  CreateTerminalRequest,
  TerminalInputFrame,
  TerminalOutputFrame,
} from './Terminal.js';

// ── Voice Module Types ──
export type {
  SttEngineKind,
  SttSessionStatus,
  SttSessionDescriptor,
  SttClientFrame,
  SttServerFrame,
  TtsClientFrame,
  TtsServerFrame,
} from './Voice.js';

// ── Widgets + Extensions (agent-rendered UI) ──
export type {
  WidgetSurface,
  WidgetPermission,
  WidgetActionDef,
  WidgetDescriptor,
  WidgetInstance,
  WidgetInstanceStatus,
} from './Widget.js';
export { normalizeWidgetSurface, DEFAULT_WIDGET_SURFACE } from './Widget.js';

export type {
  ExtensionScope,
  ExtensionAuthor,
  ExtensionEngines,
  ExtensionManifest,
  InstalledExtension,
  InstallExtensionParams,
} from './Extension.js';

// ── Source Control (accounts, readiness, commit → PR flow, PR browsing, editors) ──
export type {
  SourceControlProviderId as ScmProviderId,
  SourceControlAuthMethod,
  SourceControlAccount,
  SourceControlProviderInfo,
  EditorId,
  EditorInfo,
  SourceControlSettings,
  SourceControlSettingsResponse,
  DeviceLoginStart,
  DeviceLoginStatus,
  PullRequestState as ScmPullRequestState,
  PullRequestSummary,
  CheckConclusion as ScmCheckConclusion,
  ChecksSummary as ScmChecksSummary,
  PullRequestDetail,
  PullRequestFile,
  PullRequestComment,
  ProjectPullRequest,
  ProjectPullRequestsResponse,
  RepoReadiness,
  WorkspaceReadinessResponse,
  ScmFlowRequest,
  ScmFlowStepId,
  ScmFlowStep,
  ScmConflictReport,
  ScmFlowResult,
  ScmGenerateRequest,
  ScmGenerateResult,
  ChatSourceControlOptions,
  OpenInEditorRequest,
  OpenInEditorResult,
} from './SourceControl.js';

// ── Attention feed (G-01) ──
export type {
  AttentionEntity,
  AttentionItemState,
  AttentionAskKind,
  AttentionAction,
  AttentionAsk,
  AttentionProgress,
  AttentionItem,
  AttentionEntityCounts,
  AttentionCounts,
  AttentionSnapshot,
  AttentionFilter,
  AttentionUpsertEventData,
  AttentionRemoveEventData,
  AttentionCountsEventData,
  AttentionEventKind,
} from './Attention.js';
export {
  ATTENTION_ENTITIES,
  ATTENTION_EVENT_KINDS,
  isAttentionAsk,
  emptyAttentionCounts,
  countAttention,
  compareAttentionItems,
} from './Attention.js';

// ── Desktop shell IPC payloads (G-03…G-05, D-25) ──
export type {
  DesktopThemePreference,
  DesktopAppearancePush,
  DesktopAppearanceRequest,
  DesktopShellStatePush,
  ServerReachability,
  DesktopServerEntry,
  DesktopUpdateState,
  // P2-R41 — window chrome / find-in-page / browser-IPC payloads, single-sourced.
  DesktopPlatform,
  WindowChrome,
  WindowStateChange,
  NavHistoryState,
  FindInPageResult,
  BrowserBounds,
  BrowserDevtoolsPanel,
  BrowserEmulationParams,
  NativeBrowserDescriptor,
  NativeBrowserEvent,
  BrowserPickResult,
  BrowserAnnotationSummary,
  BrowserAnnotatePollResult,
} from './DesktopShell.js';

// ── Chat list v2 (G-02) ──
export type {
  ChatTurnStatus,
  ChatChangeStats,
  ChatLastTurn,
  ChatListAgent,
  ChatListPreview,
  ChatListSummary,
  ChatListItem,
  ChatListState,
  ChatListSort,
  ChatListQuery,
  ChatListCounts,
  ChatListPage,
  ChatBulkRequest,
  ChatBulkFailure,
  ChatBulkResult,
  ChatUpdatedEventData,
} from './ChatList.js';
export {
  CHAT_TURN_STATUSES,
  CHAT_LIST_STATES,
  CHAT_LIST_SORTS,
  CHAT_LIST_DEFAULT_LIMIT,
  CHAT_LIST_MAX_LIMIT,
  CHAT_BULK_MAX_IDS,
  chatListSearchParams,
  runChatBulk,
  liveChatIds,
} from './ChatList.js';

// ── Agent-provider catalog (G-09) ──
export type {
  ModelTier,
  HarnessCatalogModel,
  HarnessProviderStatus,
  HarnessProvidersResponse,
  HarnessLoginResult,
  HarnessSetDefaultResult,
} from './HarnessCatalog.js';
export { MODEL_TIERS, MODEL_TIER_LABELS } from './HarnessCatalog.js';

// ── System info (G-12) ──
export type { SystemInfo } from './SystemInfo.js';

// ── Project-scoped workflow runs (G-15) ──
export type { ProjectRunListItem, ProjectRunListQuery, ProjectRunListPage } from './ProjectRuns.js';

// ── Recently finished activity (G-11) ──
export type {
  ActivityEntity,
  ActivityOutcome,
  RecentActivityQuery,
  RecentActivityChanges,
  RecentActivityItem,
  RecentActivityPage,
} from './RecentActivity.js';

// ── Stats summary (G-10) ──
export type {
  StatsSummaryQuery,
  StatsChatsSummary,
  StatsRunsSummary,
  StatsAutomationsSummary,
  StatsByDefinitionRow,
  StatsSummary,
} from './StatsSummary.js';

// ── Palette entity search (G-18) ──
export type {
  SearchEntityType,
  SearchResultAction,
  SearchResult,
  SearchQuery,
  SearchResponse,
} from './EntitySearch.js';
export { SEARCH_ENTITY_TYPES } from './EntitySearch.js';
export type { PushData } from './Push.js';
