// ────────────────────────────────────────────────────────────────
// Agent Zod validation schemas
//
// Also the single source of truth for `McpServerConfigSchema` and
// `AgentOverridesSchema`, which the Chat and Workflow schemas reuse so the
// three historically-drifted HarnessConfig shapes stay in step.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../types/ProviderConfig.js';
import { AGENT_SLUG_PATTERN, AGENT_INSTRUCTIONS_MAX_BYTES } from '../types/Agent.js';

/** Superset accepted by both harness SDKs. */
export const McpServerConfigSchema = z.object({
  type: z.enum(['http', 'sse', 'stdio']),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  tools: z.array(z.string()).optional(),
  timeoutMs: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export const AgentToolPolicySchema = z
  .object({
    browser: z.boolean(),
    widgets: z.boolean(),
    extensionAuthoring: z.boolean(),
    orchestration: z.boolean(),
    fileRead: z.boolean(),
    fileWrite: z.boolean(),
    shell: z.boolean(),
    web: z.boolean(),
  })
  .partial();

export const AgentRuntimePolicySchema = z
  .object({
    model: z.string().max(200),
    harnessType: z.enum(HARNESS_PROVIDER_IDS),
    reasoningEffort: z.enum(REASONING_EFFORTS),
    contextTier: z.enum(['default', 'long_context']),
    maxTurns: z.number().int().min(1).max(1000),
    permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']),
    defaultAgentMode: z.enum(['auto', 'plan']),
  })
  .partial();

export const AgentOrchestrationPolicySchema = z.object({
  teamAgentRefs: z.array(z.string().max(128)).max(50).default([]),
  maxWorkers: z.number().int().min(1).max(50).optional(),
  defaultWorkerModel: z.string().max(200).optional(),
});

/** Additive capability delta applied at a binding site (chat / stage). */
export const AgentOverridesSchema = z
  .object({
    addSkillIds: z.array(z.string().max(200)).max(100),
    removeSkillIds: z.array(z.string().max(200)).max(100),
    addMcpServerIds: z.array(z.string().max(200)).max(100),
    removeMcpServerIds: z.array(z.string().max(200)).max(100),
    tools: AgentToolPolicySchema,
    runtime: AgentRuntimePolicySchema,
    appendInstructions: z.string().max(16_000),
    extraAllow: z.array(z.string().max(200)).max(200),
    extraDeny: z.array(z.string().max(200)).max(200),
  })
  .partial();

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(AGENT_SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens');

export const CreateAgentSchema = z.object({
  scope: z.enum(['global', 'project']).default('global'),
  projectId: z.string().uuid().optional(),
  slug: slug.optional(),
  name: z.string().min(1).max(120),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters — it is the signal the model uses to decide when to use this agent')
    .max(2000),
  instructions: z.string().min(1).max(AGENT_INSTRUCTIONS_MAX_BYTES),
  role: z.enum(['agent', 'orchestrator']).default('agent'),
  projection: z.enum(['append', 'replace']).default('append'),
  icon: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  enabled: z.boolean().default(true),
  skillIds: z.array(z.string().max(200)).max(200).default([]),
  mcpServerIds: z.array(z.string().max(200)).max(100).default([]),
  tools: AgentToolPolicySchema.default({}),
  runtime: AgentRuntimePolicySchema.default({}),
  orchestration: AgentOrchestrationPolicySchema.optional(),
});

export const UpdateAgentSchema = CreateAgentSchema.partial().omit({ scope: true, projectId: true });

export const ImportAgentSchema = z.object({
  /** Raw `.agent.md` document. Capped well below the JSON body limit. */
  markdown: z.string().min(1).max(256 * 1024),
  scope: z.enum(['global', 'project']).default('global'),
  projectId: z.string().uuid().optional(),
  /** Overwrite an existing agent with the same slug instead of 409-ing. */
  overwrite: z.boolean().default(false),
});

export const ResolvePreviewSchema = z.object({
  agentRef: z.string().max(128).optional(),
  overrides: AgentOverridesSchema.optional(),
  projectId: z.string().uuid().optional(),
  harnessType: z.enum(HARNESS_PROVIDER_IDS).optional(),
  scope: z.enum(['chat', 'stage', 'worker']).default('chat'),
  /**
   * Unsaved draft from the editor — previewed without persisting.
   *
   * The save-time minimums are deliberately relaxed here. A draft is
   * half-written by definition: `scope` may be `system` (built-in agents are
   * previewed read-only) and `instructions` / `description` are routinely
   * still empty. Enforcing CreateAgentSchema made the effective-capabilities
   * panel 400 for every new agent until the instructions had been typed.
   */
  draft: CreateAgentSchema.partial()
    .extend({
      scope: z.enum(['system', 'global', 'project']).optional(),
      name: z.string().max(120).optional(),
      description: z.string().max(2000).optional(),
      instructions: z.string().max(AGENT_INSTRUCTIONS_MAX_BYTES).optional(),
    })
    .optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
export type ImportAgentInput = z.infer<typeof ImportAgentSchema>;
export type ResolvePreviewInput = z.infer<typeof ResolvePreviewSchema>;
