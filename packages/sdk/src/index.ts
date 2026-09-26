// ────────────────────────────────────────────────────────────────
// @generatorai/sdk — Main Entry Point
//
// INTERNAL / UNPUBLISHED. This package embeds the whole server dependency
// graph in-process (`createCoreServices` + `createDB` + a harness provider);
// it does not talk to a running `apps/server`. It has no importers in this
// repository and cannot be installed outside it — see README.md.
//
// Usage from inside the monorepo:
//
//   import { createGeneratorAI } from '@generatorai/sdk';
//   const ai = await createGeneratorAI({ harness: 'copilot' }); // HarnessType
//   const run = await ai.workflows.run(defId, { variables: { code: '...' } });
//
// ────────────────────────────────────────────────────────────────

// ── Main Entry ──
export { GeneratorAI, createGeneratorAI } from './GeneratorAI.js';
export type {
  GeneratorAIConfig,
  HarnessSelection,
  ResolvedConfig,
  LoggerConfig,
  SandboxConfig,
} from './config.js';
// Database driver seam (DB-01) — config-level, part of the stable surface.
export type { DatabaseConfig, DatabaseDriver } from '@generatorai/db';

// ── Facades ──
export {
  WorkflowFacade,
  ChatFacade,
  AutomationFacade,
  EventFacade,
  ScriptFacade,
  ToolFacade,
  ProjectFacade,
  HookFacade,
  HitlFacade,
  WorkspaceFacade,
  tool,
} from './facades/index.js';

export type {
  CreateWorkflowOptions,
  GraphSource,
  RunOptions,
  StreamOptions,
  CreateChatOptions,
  RunScriptOptions,
  ToolConfig,
  ToolDefinition,
  CreateProjectInput,
  UpdateProjectInput,
  LinkCodebaseInput,
  CreateWorktreeOptions,
  UploadConfigInput,
  HookContext,
  HookResult,
  HookHandler,
  StageVerdict,
  CreateWorkspaceInput,
  WorkspaceFilters,
} from './facades/index.js';

// ── Workflow documents: builders, validation, canonical import/export ──
export { workflow, WorkflowBuilder, StageBuilder, WorkflowBuildError } from '@generatorai/workflow-spec/builders';
export { validateWorkflow, exportGraph, importGraph, parseGraph } from '@generatorai/workflow-spec';
export type {
  WorkflowGraph,
  WorkflowGraphInput,
  StageSpec,
  EdgeSpec,
  WorkflowSpec,
  ValidationIssue,
  ValidationResult,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionSummary,
} from '@generatorai/workflow-spec';

// ── Types (selective re-export from shared) ──
export type {
  AgentEvent,
  AgentEventKind,
  PersistedEvent,
  WorkflowRun,
  StageRun,
  Chat,
  ChatMessage,
  ChatStatus,
  Automation,
  AutomationExecution,
  CreateAutomationParams,
  UpdateAutomationParams,
  Session,
  Artifact,
  HookDefinition,
  HookConfig,
  WorkspaceOwnerType,
  WorkspaceStatus,
} from '@generatorai/shared';

// ── Errors (re-export from shared) ──
export {
  GeneratorAIError,
  ValidationError,
  HarnessConnectionError,
} from '@generatorai/shared';

// ── Run and instance state tables (stable, pure data) ──
export {
  STAGE_RUN_TRANSITIONS,
  WORKFLOW_RUN_TRANSITIONS,
  type RunCommand,
  type ForkRunRequest,
} from '@generatorai/workflow-spec';

// ── Harness extension point (bring-your-own-harness) ──
// `IAgentHarness` is part of the STABLE surface: an integrator can implement it
// and pass the instance as `config.harness` to run on any harness they like.
// See ./internal for the repository ports / service classes used for deeper,
// non-stable composition.
export type { IAgentHarness } from '@generatorai/core';

// ── Harness provider types ──
export type {
  HarnessType,
  HarnessProviderConfig,
} from '@generatorai/agent-harness-providers';

// ────────────────────────────────────────────────────────────────
// ADVANCED / UNSTABLE surface
//
// The raw core service graph (CoreServices, service classes, repository
// ports, DAG utilities) is intentionally NOT exported from the main entry.
// It changes across minor versions and is not covered by the SDK's semver
// contract (see API-STABILITY.md). Power users who accept that can import it
// explicitly:
//
//   import { WorkflowInvocationService } from '@generatorai/sdk/internal';
//
// Prefer the facades (`ai.workflows`, `ai.chat`, …) — they are the stable API.
// ────────────────────────────────────────────────────────────────
