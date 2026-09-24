// Shared config barrel

// W18 — bounded/audited numeric env reading. Replaces bare `parseInt(env)`,
// which turns a typo into a NaN that deadlocks Semaphore-gated call paths.
export {
  readBoundedInt,
  getConfigAudit,
  getConfigCorrections,
  resetConfigAudit,
} from './numericEnv.js';
export type { ConfigReadAction, ConfigReadRecord, ReadBoundedIntOptions } from './numericEnv.js';

// §11.1 "no capability granted by negation" — allowlist-built environments for
// any child that runs model-authored commands (harness, terminal, sandbox).
export {
  buildChildEnv,
  isBlockedChildEnvVar,
  filterDelegatedChildEnv,
  BASE_CHILD_ENV_ALLOWLIST,
  DELEGATED_ENV_NAME_PATTERN,
} from './childEnv.js';
export type { ChildEnvOptions } from './childEnv.js';

export { AppConfigSchema } from './AppConfig.js';
export { McpServerBodySchema, McpTransportSchema, SystemMcpPrefsBodySchema } from './McpSchemas.js';
export type { McpServerBody, SystemMcpPrefsBody } from './McpSchemas.js';
export type { AppConfig } from './AppConfig.js';
export {
  WorkflowTemplateSchema,
  StageTemplateSchema,
  HookDefinitionSchema,
  WorkflowHookDefinitionSchema,
  HooksFileConfigSchema,
  TemplateCategorySchema,
  TemplateHarnessConfigSchema,
  ConfigurableVariableSchema,
  PreprocessingStepSchema,
  ResultValidationSchema,
  WorkflowTemplateStageSchema,
  WorkflowTemplateEdgeSchema,
  templateStageToCreateParams,
  StageTemplatePromptSchema,
} from './WorkflowTemplate.js';
export type { WorkflowTemplate, WorkflowTemplateStage, StageTemplate } from './WorkflowTemplate.js';

export {
  CreateWorkflowDefinitionSchema,
  UpdateWorkflowDefinitionSchema,
  CreateStageSchema,
  CreateEdgeSchema,
  CreateWorkflowRunSchema,
  WorkflowDefinitionSchema,
  ImportWorkflowJsonSchema,
  PromptDefinitionSchema,
  PromptTypeSchema,
  RetryPolicySchema,
  StageConditionSchema,
  VariableDefinitionSchema,
  SkillDefinitionSchema,
  AgentDefinitionSchema,
} from './WorkflowDefinitionSchemas.js';
export type { ImportWorkflowJson, RunProfileInput } from './WorkflowDefinitionSchemas.js';
export { RunProfileSchema, StageRunOverrideSchema } from './WorkflowDefinitionSchemas.js';

export {
  McpServerConfigSchema,
  AgentToolPolicySchema,
  AgentRuntimePolicySchema,
  AgentOrchestrationPolicySchema,
  AgentOverridesSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  ImportAgentSchema,
  ResolvePreviewSchema,
} from './AgentSchemas.js';
export type {
  CreateAgentInput,
  UpdateAgentInput,
  ImportAgentInput,
  ResolvePreviewInput,
} from './AgentSchemas.js';

export {
  AgentModeSchema,
  CreateChatSchema,
  ChatSourceSpecSchema,
  UpdateChatSourcesSchema,
  SendChatPromptSchema,
  UpdatePlanContentSchema,
  CreatePlanCommentSchema,
  PlanDecisionSchema,
  AnswerQuestionSchema,
  SetChatPermissionModeSchema,
  ResolveToolPermissionSchema,
  UpdateChatSchema,
  StageReviewDecisionSchema,
} from './ChatSchemas.js';

// Orchestrator mode — background-agent task brief + result digest contracts
export {
  TaskBriefSchema,
  TaskBudgetSchema,
  TaskResultDigestSchema,
  TaskResultStatusSchema,
  TaskArtifactRefSchema,
} from './OrchestratorSchemas.js';
export type { TaskBrief, TaskResultDigest } from './OrchestratorSchemas.js';

// Integrated Browser config (v13)
export { BrowserConfigSchema } from './BrowserConfigSchema.js';
export type { BrowserConfigInput } from './BrowserConfigSchema.js';

// Automation schemas
export {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  TestDataSourceSchema,
  DataSchemaSchema,
  IterationModeSchema,
  AutomationDatasetSchema,
  AutomationRetryPolicySchema,
  TriggerAutomationBodySchema,
  PreviewIterationsBodySchema,
} from './AutomationSchemas.js';

// Workflow Script schemas
export {
  WorkflowScriptOutputSchema,
  ScriptRunProfileSchema,
} from './WorkflowScriptSchema.js';
export type {
  WorkflowScriptOutputParsed,
  ScriptRunProfileParsed,
} from './WorkflowScriptSchema.js';

// Extensions + Widgets
export {
  ExtensionManifestSchema,
  InstallExtensionParamsSchema,
  WidgetSurfaceSchema,
} from './ExtensionManifestSchema.js';
export type { ExtensionManifestParsed } from './ExtensionManifestSchema.js';

export {
  CreateWidgetInstanceSchema,
  UpdateWidgetStateSchema,
  DispatchWidgetActionSchema,
  WidgetInvokeResultSchema,
} from './WidgetSchemas.js';
