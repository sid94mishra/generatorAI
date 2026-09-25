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
  HooksFileConfig,
  HookResult,
  HookPhaseResult,
} from './HookDefinition.js';
export { HOOK_PHASE_INFO } from './HookDefinition.js';

export type { Session, SessionOwnerType, SessionStatus } from './Session.js';

export type { HarnessConfig } from './Workflow.js';
export type { WorkflowRunTransition } from './WorkflowRunStateMachine.js';
export type { StageRunTransition } from './StageRunStateMachine.js';

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
  ComputerConsentRequest,
  ComputerCapabilities,
} from './ComputerUse.js';
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
export type { Chat, ChatStatus, ChatLocalFolder, CreateChatParams, BackgroundTaskStatus, BackgroundTaskMeta, ChatPermissionMode } from './Chat.js';
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
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  WorkflowSessionMode,
  VariableDefinition,
  CreateWorkflowDefinitionParams,
  UpdateWorkflowDefinitionParams,
} from './WorkflowDefinition.js';
export type {
  StageDefinition,
  StageEdge,
  StageEdgeType,
  PromptDefinition,
  RetryPolicy,
  StageCondition,
  CreateStageParams,
  CreateEdgeParams,
  ContextFilter,
  StageSkillReference,
  ArtifactManifestEntry,
} from './StageDefinition.js';
export type {
  WorkflowRun,
  WorkflowRunStatus,
  StageRun,
  StageRunStatus,
  WorkflowRunWithStages,
  CreateWorkflowRunParams,
  WorkflowRunPermissionMode,
  WorkflowDefinitionSnapshot,
  RunScratchpad,
  RunScratchpadEntry,
} from './WorkflowRun.js';
export { DEFAULT_WORKFLOW_RUN_PERMISSION_MODE } from './WorkflowRun.js';
export type { RunProfile, StageRunOverride } from './RunProfile.js';

export type {
  IPlatformClient,
  PlatformType,
  PaginatedResult,
  EventSubscriptionOptions,
  WorkflowTemplateSummary,
} from './IPlatformClient.js';

// ── Automation Types ──
export type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  AutomationExecutionWithRuns,
  AutomationWithExecutions,
  AutomationTriggerType,
  AutomationInputMode,
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
  DataSourceType,
  DataSourceOutputFormat,
  DataSourceConfig,
  StaticDataSourceConfig,
  ScriptDataSourceConfig,
  HttpDataSourceConfig,
  FileDataSourceConfig,
  WorkflowScriptDataSourceConfig,
  DataSourceSchema,
  DataSourceTestResult,
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
  SystemConfig,
  ArtifactSource,
  ArtifactType,
  ArtifactWithSource,
  McpServerEntry,
  FileEntry,
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

// ── Orchestrator Types ──
export type {
  PreprocessingStep,
  PreprocessingStepType,
  PreprocessingStepConfig,
  CloneRepoStepConfig,
  RunScriptStepConfig,
  ValidateInputStepConfig,
  SetVariableStepConfig,
  ConditionalStepConfig,
  ValidationRule,
  StageResultValidation,
  ResultValidationRule,
  WorkflowCategory,
  PostProcessingStep,
  PostProcessingStepType,
  PostProcessingStepConfig,
  CommitAndPushStepConfig,
  CreatePRStepConfig,
  PostRunScriptStepConfig,
  OrchestratorConfig,
  OrchestratedRunParams,
  OrchestratorContext,
  PreprocessingResult,
  StageValidationResult,
  RunWorkspaceInfo,
  RunUploadResult,
} from './WorkflowOrchestrator.js';

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
