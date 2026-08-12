// ────────────────────────────────────────────────────────────────
// WorkflowDefinition — Persistent, reusable workflow configuration
// Design-time entity: saveable, editable, shareable
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from './Workflow.js';
import type { StageDefinition } from './StageDefinition.js';
import type { StageEdge } from './StageDefinition.js';
import type {
  OrchestratorConfig,
  WorkflowCategory,
} from './WorkflowOrchestrator.js';
import type { WorkflowHookDefinition, HooksFileConfig } from './HookDefinition.js';
import type { BrowserConfig } from './BrowserSession.js';

/** How sessions are allocated across stages */
export type WorkflowSessionMode = 'single' | 'per-stage' | 'auto';

/** User-configurable variable for workflow parameterization */
export interface VariableDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'choice' | 'text';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
}

/** Skill reference for workflow-level skill configuration */
export interface SkillReference {
  name: string;
  directory?: string;
  description?: string;
}

/** Agent reference for workflow-level agent configuration */
export interface AgentReference {
  name: string;
  description?: string;
  instructions?: string;
  tools?: string[];
}

/** WorkflowDefinition domain entity */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  sessionMode: WorkflowSessionMode;
  /** Agent harness configuration (provider-agnostic) */
  harnessConfig?: Partial<HarnessConfig>;
  variables: VariableDefinition[];
  tags: string[];
  /** Orchestrator configuration (preprocessing, validation, post-processing) */
  orchestratorConfig?: OrchestratorConfig;
  /** Project ID — scopes this workflow to a project (null = global) */
  projectId?: string;
  /** Skills for this workflow */
  skills?: SkillReference[];
  /** Agents for this workflow */
  agents?: AgentReference[];
  /** Selected artifact IDs for skills/agents/prompts */
  selectedArtifacts?: { skillIds?: string[]; agentIds?: string[]; promptIds?: string[] };
  /** Whether to create worktrees for project codebases during execution */
  useWorktree?: boolean;
  /** Workflow-level lifecycle hooks */
  hooks?: WorkflowHookDefinition[];
  /** Imported hooks file configuration (.hooks.json) */
  hooksFile?: HooksFileConfig;
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig?: BrowserConfig;
  /** Portable `scope:slug` ref of the default agent for stages that do not bind their own. */
  defaultAgentRef?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Compound type: definition + stages + edges for API responses */
export interface WorkflowDefinitionWithStages extends WorkflowDefinition {
  stages: StageDefinition[];
  edges: StageEdge[];
}

/** Parameters for creating a new WorkflowDefinition */
export interface CreateWorkflowDefinitionParams {
  name: string;
  description?: string;
  sessionMode?: WorkflowSessionMode;
  harnessConfig?: Partial<HarnessConfig>;
  variables?: VariableDefinition[];
  tags?: string[];
  orchestratorConfig?: OrchestratorConfig;
  /** Project ID — scopes this workflow to a project */
  projectId?: string;
  skills?: SkillReference[];
  agents?: AgentReference[];
  /** Selected artifact IDs for skills/agents/prompts */
  selectedArtifacts?: { skillIds?: string[]; agentIds?: string[]; promptIds?: string[] };
  /** Workflow-level lifecycle hooks */
  hooks?: WorkflowHookDefinition[];
  /** Imported hooks file configuration */
  hooksFile?: HooksFileConfig;
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig?: BrowserConfig;
  /** Portable `scope:slug` ref of the default agent for stages that do not bind their own. */
  defaultAgentRef?: string;
}

/** Parameters for updating a WorkflowDefinition */
export interface UpdateWorkflowDefinitionParams {
  name?: string;
  description?: string;
  sessionMode?: WorkflowSessionMode;
  harnessConfig?: Partial<HarnessConfig>;
  variables?: VariableDefinition[];
  tags?: string[];
  orchestratorConfig?: OrchestratorConfig;
  skills?: SkillReference[];
  agents?: AgentReference[];
  /** Workflow-level lifecycle hooks */
  hooks?: WorkflowHookDefinition[];
  /** Imported hooks file configuration */
  hooksFile?: HooksFileConfig;
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig?: BrowserConfig;
  /** Portable `scope:slug` ref of the default agent. `null` clears the binding. */
  defaultAgentRef?: string | null;
}
