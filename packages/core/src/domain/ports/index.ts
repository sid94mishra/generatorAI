// Domain ports barrel

export type {
  IAgentHarness,
  // P1#6 — capability ports that compose IAgentHarness (bring-your-own-harness).
  IHarnessClientLifecycle,
  IHarnessModelDiscovery,
  IHarnessConversationLifecycle,
  IHarnessMessaging,
  IHarnessEvents,
  HarnessType,
  HarnessAdapterCommonOptions,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  ConversationResponse,
  ConversationMessage,
  SystemMessageConfig,
  CustomAgentConfig,
  BYOKProviderConfig,
  PermissionRequestHandler,
  PermissionRequest,
  PermissionResponse,
  ToolDefinition,
  McpServerConfig,
  AttachmentRef,
  CreateConversationParams,
  // PLN-01 — plan mode
  HarnessPermissionMode,
  SendPromptOptions,
  PlanReviewRequest,
  PlanReviewDecision,
  PlanReviewRequestHandler,
  QuestionRequest,
  QuestionRequestHandler,
  ConversationWarning,
  HarnessRuntimeDiagnostics,
  ConversationResult,
  HarnessAgentInfo,
  ToolBinaryAttachment,
  ConversationAnchor,
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
} from './IAgentHarness.js';
export { TOOL_BINARY_KEY, takeToolBinaries } from './IAgentHarness.js';

export type {
  ISessionRepository,
  IEventRepository,
  IChatMessageRepository,
  IArtifactRepository,
} from './IRepositories.js';

export type { IChatRepository } from './IChatRepository.js';
export type { IAgentRepository, AgentListFilter, AgentUsage } from './IAgentRepository.js';
export type {
  IPlanRepository,
  IAgentInteractionRepository,
  CreatePlanParams,
  AddPlanRevisionParams,
  CreateInteractionParams,
} from './IPlanRepository.js';
export type { IWorkflowDefinitionRepository } from './IWorkflowDefinitionRepository.js';
export type { IStageDefinitionRepository } from './IStageDefinitionRepository.js';
export type { IStageEdgeRepository } from './IStageEdgeRepository.js';
export type { IWorkflowRunRepository } from './IWorkflowRunRepository.js';
export type { IStageRunRepository } from './IStageRunRepository.js';
export type { ISequenceAllocator } from './ISequenceAllocator.js';
export type {
  ISessionAllocationRepository,
  SessionAllocationRow,
  StageSessionMapRow,
} from './ISessionAllocationRepository.js';

export type {
  HookBridge,
  HookBridgeInvocation,
  HookInputBase,
  PreToolUseHookInput,
  PreToolUseHookOutput,
  PreToolUseBridgeHandler,
  PostToolUseHookInput,
  PostToolUseHookOutput,
  PostToolUseBridgeHandler,
  UserPromptSubmittedHookInput,
  UserPromptSubmittedHookOutput,
  UserPromptSubmittedBridgeHandler,
  SessionStartHookInput,
  SessionStartHookOutput,
  SessionStartBridgeHandler,
  SessionEndHookInput,
  SessionEndHookOutput,
  SessionEndBridgeHandler,
  ErrorOccurredHookInput,
  ErrorOccurredHookOutput,
  ErrorOccurredBridgeHandler,
} from './IHookBridge.js';

export type {
  IScriptRunner,
  ScriptRunOptions,
  ScriptRunResult,
} from './IScriptRunner.js';

export type {
  IHttpClient,
  HttpRequestOptions,
  HttpResponse,
} from './IHttpClient.js';

export type {
  ISandboxProvider,
  SandboxConfig,
  SandboxMount,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxInfo,
  SandboxSession,
  ISandboxSessionLookup,
} from './ISandboxProvider.js';

// ── Project & Codebase Management Ports ──
export type { IProjectRepository } from './IProjectRepository.js';
export type { IProjectCodebaseRepository } from './IProjectCodebaseRepository.js';
export type { IProjectConfigRepository } from './IProjectConfigRepository.js';
export type { IWorktreeRepository } from './IWorktreeRepository.js';

// ── Workspace Management Ports ──
export type { IExecutionWorkspaceRepository } from './IExecutionWorkspaceRepository.js';
export type { IWorkspaceMountRepository, WorkspaceMountUpdate } from './IWorkspaceMountRepository.js';
export type { IWorkspaceArtifactRepository } from './IWorkspaceArtifactRepository.js';
export type {
  IWorkspaceFileReviewRepository,
  WorkspaceFileReviewRow,
  WorkspaceFileReviewKey,
} from './IWorkspaceFileReviewRepository.js';

// ── Integrated Browser Port ──
export type {
  IBrowserBridge,
  BrowserHandle,
  BrowserStartOptions,
  BrowserHostObserver,
  BrowserInputEvent,
  PageOutcome,
  ScreencastCapabilities,
  ScreencastCodec,
  ScreencastFrame,
} from './IBrowserBridge.js';

// ── Integrated Terminal Port ──
export type {
  ITerminalHost,
  ITerminalHandle,
  TerminalSpawnOptions,
} from './ITerminalHost.js';

// ── Voice Module Ports ──
export type {
  ISpeechToTextEngine,
  SttTranscribeOptions,
  SttTranscribeResult,
} from './ISpeechToTextEngine.js';
export type {
  ITextToSpeechEngine,
  TtsSynthesizeOptions,
} from './ITextToSpeechEngine.js';
export type {
  ITextFormatter,
  TextFormatterOptions,
} from './ITextFormatter.js';

// ── Computer Use Port ──
export type {
  IComputerBridge,
  ComputerHandle,
  ComputerStartOptions,
  ComputerHostObserver,
  ComputerAppRef,
  ComputerAppIdentity,
  ComputerWindowSelector,
  ComputerWindowTarget,
  ComputerModifier,
  ComputerRefusal,
  ListAppsResult,
  ListWindowsResult,
  SnapshotRequest,
  ActionRequest,
  ActionRequestType,
  ElementAddressedRequest,
} from './IComputerBridge.js';
export { isElementAddressed } from './IComputerBridge.js';
export type {
  ComputerConsentPrompt,
  ComputerConsentScope,
  ComputerStoredGrant,
  IComputerConsentStore,
} from './IComputerConsentStore.js';

// ── Extensions & Widgets Ports ──
export type { IExtensionRegistry } from './IExtensionRegistry.js';
export type { IWidgetRegistry } from './IWidgetRegistry.js';

// ── Provider Instance Port (W34, W42) ──
export type {
  IProviderInstance,
  IProviderInstanceRegistry,
  ProviderCapabilities,
  ProviderInstanceId,
  ProviderWireProtocol,
} from './IProviderInstance.js';
export { makeProviderInstanceId } from './IProviderInstance.js';
