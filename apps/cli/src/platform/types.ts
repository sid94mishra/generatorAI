// CLIPlatformClient — Extended interface covering all 105+ server API endpoints.
// Extends IPlatformClient from @generatorai/shared with additional methods for
// domains not covered by the base interface (orchestrator, copilot, workspace, etc.)

import type {
  IPlatformClient,
  PersistedEvent,
  Automation,
  AutomationWithExecutions,
  AutomationExecution,
  AutomationExecutionWithRuns,
  CreateAutomationParams,
  UpdateAutomationParams,
  TriggerAutomationBody,
  Project,
  ProjectCodebase,
  ProjectConfig,
  WorktreeInfo,
  ProjectSettings,
  CodebaseType,
  ConfigType,
  WorkflowTemplate,
  OrchestratedRunParams,
  OrchestratorContext,
  RunWorkspaceInfo,
  WorkspaceInfo,
  WorkspaceFilters,
  ArtifactWithSource,
  McpServerEntry,
  FileEntry,
  StageDefinition,
  StageEdge,
  CreateStageParams,
  CreateEdgeParams,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  ImportWorkflowJson,
  StageRun,
  DataSourceTestResult,
  WebhookRegistration,
} from '@generatorai/shared';

// ── API Error ────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── SSE Types ────────────────────────────────────────────────────

export type SSEScope = 'session' | 'run' | 'chat' | 'global';

export interface SSESubscriptionOptions {
  afterSequence?: number;
  filter?: string[];
  onConnected?: () => void;
  onReconnecting?: () => void;
  onDisconnected?: () => void;
}

export interface ReplayResult {
  events: PersistedEvent[];
  lastSequence: number;
  hasMore: boolean;
}

// ── Extended Client Interface ────────────────────────────────────

export interface CLIPlatformClient extends IPlatformClient {
  readonly baseUrl: string;

  // ── Unified SSE ──
  subscribeToStream(
    scope: SSEScope,
    id: string,
    handler: (event: PersistedEvent) => void,
    opts?: SSESubscriptionOptions,
  ): () => void;

  streamReplay(
    scope: SSEScope,
    id: string,
    afterSeq: number,
    limit?: number,
  ): Promise<ReplayResult>;

  // ── Health & System ──
  getHealthInfo(): Promise<Record<string, unknown>>;
  getHealthConfig(): Promise<Record<string, unknown>>;
  getCopilotModels(): Promise<Array<{ id: string; name: string }>>;
  getCopilotState(): Promise<Record<string, unknown>>;
  getSystemArtifacts(type?: string): Promise<ArtifactWithSource[]>;
  getSystemMcpServers(): Promise<McpServerEntry[]>;

  // ── Copilot ──
  listCopilotConversations(): Promise<Array<Record<string, unknown>>>;
  getCopilotConversationMessages(conversationId: string): Promise<Array<Record<string, unknown>>>;
  copilotPing(): Promise<{ alive: boolean }>;

  // ── Session Messages ──
  getSessionMessages(sessionId: string, stageRunId?: string): Promise<Array<Record<string, unknown>>>;

  // ── Workflow Definition Extensions ──
  validateDefinition(id: string): Promise<{ valid: boolean; errors: string[] }>;
  importFromTemplate(templateId: string, name?: string): Promise<WorkflowDefinition>;
  importFromJSON(data: ImportWorkflowJson): Promise<WorkflowDefinitionWithStages>;
  exportDefinition(id: string): Promise<Record<string, unknown>>;

  // ── Stage CRUD ──
  addStage(defId: string, params: Omit<CreateStageParams, 'workflowDefinitionId'>): Promise<StageDefinition>;
  updateStage(defId: string, stageId: string, params: Partial<Omit<CreateStageParams, 'workflowDefinitionId'>>): Promise<StageDefinition>;
  deleteStage(defId: string, stageId: string): Promise<void>;

  // ── Edge CRUD ──
  addEdge(defId: string, params: Omit<CreateEdgeParams, 'workflowDefinitionId'>): Promise<StageEdge>;
  deleteEdge(defId: string, edgeId: string): Promise<void>;

  // ── Run Extensions ──
  retryRun(id: string): Promise<void>;
  getRunStages(runId: string): Promise<StageRun[]>;

  // ── Stage Run Controls ──
  pauseStageRun(runId: string, stageId: string): Promise<void>;
  resumeStageRun(runId: string, stageId: string): Promise<void>;
  retryStageRun(runId: string, stageId: string): Promise<void>;
  cancelStageRun(runId: string, stageId: string): Promise<void>;

  // ── Run SSE (convenience) ──
  subscribeToRunEvents(runId: string, handler: (e: PersistedEvent) => void, opts?: { afterSequence?: number }): () => void;
  subscribeToChatEvents(sessionId: string, handler: (e: PersistedEvent) => void, opts?: { afterSequence?: number }): () => void;

  // ── Orchestrator ──
  listWorkflowTemplates(): Promise<WorkflowTemplate[]>;
  getWorkflowTemplate(id: string): Promise<WorkflowTemplate>;
  createFromTemplate(templateId: string, params: Record<string, unknown>): Promise<WorkflowDefinition>;
  startOrchestratedRun(params: OrchestratedRunParams): Promise<Record<string, unknown>>;
  getOrchestratorContext(runId: string): Promise<OrchestratorContext>;
  cancelOrchestratedRun(runId: string): Promise<void>;
  uploadWorkflowFiles(defId: string, category: string, files: Array<{ name: string; content: Buffer }>): Promise<void>;
  listWorkflowFiles(defId: string): Promise<FileEntry[]>;
  downloadWorkflowFile(defId: string, path: string): Promise<Buffer>;
  deleteWorkflowFile(defId: string, path: string): Promise<void>;
  uploadRunFiles(runId: string, category: string, files: Array<{ name: string; content: Buffer }>): Promise<void>;
  getRunWorkspace(runId: string): Promise<RunWorkspaceInfo>;
  downloadRunFile(runId: string, path: string, source?: string): Promise<Buffer>;
  getRunFileContent(runId: string, path: string, source?: string): Promise<string>;
  getRunDiff(runId: string): Promise<string>;

  // ── Automation ──
  createAutomation(params: CreateAutomationParams): Promise<Automation>;
  listAutomations(projectId?: string): Promise<Automation[]>;
  getAutomation(id: string): Promise<AutomationWithExecutions>;
  updateAutomation(id: string, params: UpdateAutomationParams): Promise<Automation>;
  deleteAutomation(id: string): Promise<void>;
  enableAutomation(id: string): Promise<Automation>;
  disableAutomation(id: string): Promise<Automation>;
  triggerAutomation(
    id: string,
    body?: TriggerAutomationBody,
    opts?: { idempotencyKey?: string },
  ): Promise<AutomationExecution>;
  rotateWebhookToken(id: string): Promise<{ token: string }>;
  testDataSource(config: Record<string, unknown>): Promise<DataSourceTestResult>;
  getExecutionsByAutomation(automationId: string): Promise<AutomationExecution[]>;
  getExecutionWithRuns(automationId: string, execId: string): Promise<AutomationExecutionWithRuns>;
  cancelExecution(automationId: string, execId: string): Promise<void>;

  // ── Project ──
  createProject(params: { name: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project>;
  listProjects(status?: string): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  updateProject(id: string, params: { name?: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project>;
  deleteProject(id: string, force?: boolean): Promise<void>;
  getProjectAvailableArtifacts(id: string, type?: string): Promise<ArtifactWithSource[]>;

  // ── Codebase ──
  linkCodebase(projectId: string, params: { alias: string; type: CodebaseType; url?: string; localPath?: string; defaultBranch?: string }): Promise<ProjectCodebase>;
  listCodebases(projectId: string): Promise<ProjectCodebase[]>;
  updateCodebase(projectId: string, codebaseId: string, params: Record<string, unknown>): Promise<ProjectCodebase>;
  unlinkCodebase(projectId: string, codebaseId: string): Promise<void>;
  fetchCodebase(projectId: string, codebaseId: string): Promise<void>;
  getCodebaseBranches(projectId: string, codebaseId: string): Promise<string[]>;
  getCodebaseStatus(projectId: string, codebaseId: string): Promise<Record<string, unknown>>;
  browseCodebaseFiles(projectId: string, codebaseId: string, path?: string): Promise<FileEntry[]>;
  getCodebaseFileContent(projectId: string, codebaseId: string, path: string): Promise<string>;

  // ── Project Config ──
  uploadProjectConfig(projectId: string, type: ConfigType, file: { name: string; content: Buffer }): Promise<ProjectConfig>;
  listProjectConfigs(projectId: string, type?: ConfigType): Promise<ProjectConfig[]>;
  getProjectConfig(projectId: string, configId: string): Promise<ProjectConfig>;
  updateProjectConfig(projectId: string, configId: string, file: { name: string; content: Buffer }): Promise<ProjectConfig>;
  deleteProjectConfig(projectId: string, configId: string): Promise<void>;

  // ── Project MCP Servers ──
  addProjectMcpServer(projectId: string, params: Record<string, unknown>): Promise<McpServerEntry>;
  listProjectMcpServers(projectId: string): Promise<McpServerEntry[]>;
  updateProjectMcpServer(projectId: string, serverId: string, params: Record<string, unknown>): Promise<McpServerEntry>;
  removeProjectMcpServer(projectId: string, serverId: string): Promise<void>;

  // ── Project Worktrees ──
  listProjectWorktrees(projectId: string): Promise<WorktreeInfo[]>;
  removeProjectWorktree(projectId: string, worktreeId: string): Promise<void>;
  cleanupProjectWorktrees(projectId: string): Promise<{ cleaned: number }>;

  // ── Workspace ──
  listWorkspaces(filters?: WorkspaceFilters): Promise<WorkspaceInfo[]>;
  getWorkspace(id: string): Promise<WorkspaceInfo>;
  archiveWorkspace(id: string): Promise<void>;
  commitWorkspace(id: string, message?: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  cleanupWorkspaces(retentionHours?: number, maxDiskMb?: number): Promise<Record<string, unknown>>;
  listWorkspaceWorktrees(id: string): Promise<WorktreeInfo[]>;

  // ── Webhook ──
  createWebhookRegistration(params: Record<string, unknown>): Promise<WebhookRegistration>;
  listWebhookRegistrations(): Promise<WebhookRegistration[]>;
  deleteWebhookRegistration(id: string): Promise<void>;

  // ── Hooks ──
  listHookPhases(): Promise<Array<Record<string, unknown>>>;
  testHook(sessionId: string, phase: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>>;

  // ── Templates ──
  getTemplate(id: string): Promise<Record<string, unknown>>;

  // ── Workflow Scripts ──
  listScripts(): Promise<Array<Record<string, unknown>>>;
  getScript(id: string): Promise<Record<string, unknown>>;
  getScriptProfiles(id: string): Promise<Array<Record<string, unknown>>>;
  materializeScript(id: string, params?: { name?: string; projectId?: string; variables?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  runScript(id: string, params?: { profileName?: string; variables?: Record<string, unknown>; projectId?: string }): Promise<{ definitionId: string; runId: string; status: string }>;
  reloadScripts(): Promise<{ count: number; scripts: Array<Record<string, unknown>> }>;
  reloadScript(id: string): Promise<Record<string, unknown>>;
  validateScript(path: string): Promise<{ valid: boolean; errors: string[] }>;
}
