// Shared config barrel
export { AppConfigSchema } from './AppConfig.js';
export type { AppConfig } from './AppConfig.js';
export {
  WorkflowTemplateSchema,
  StageTemplateSchema,
  WorkflowRunProfileSchema,
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
  StageTemplatePromptSchema,
} from './WorkflowTemplate.js';
export type { WorkflowTemplate, StageTemplate, WorkflowRunProfile } from './WorkflowTemplate.js';

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
  AgentModeSchema,
  CreateChatSchema,
  SendChatPromptSchema,
  UpdatePlanContentSchema,
  CreatePlanCommentSchema,
  PlanDecisionSchema,
  AnswerQuestionSchema,
  SetChatPermissionModeSchema,
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
