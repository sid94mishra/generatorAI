# Agents and capability overrides: configuration fields

Generated from `packages/shared/src/config/AgentSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## McpServerConfigSchema

Superset accepted by both harness SDKs.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| type | "http" / "sse" / "stdio" | `required` | — |
| url | string | `optional` | — |
| headers | map of string | `optional` | — |
| command | string | `optional` | — |
| args | array of string | `optional` | — |
| env | map of string | `optional` | — |
| cwd | string | `optional` | — |
| tools | array of string | `optional` | — |
| timeoutMs | number | `optional` | int; min 0 |
| enabled | boolean | `optional` | — |

## AgentToolPolicySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| browser | boolean | `optional` | — |
| widgets | boolean | `optional` | — |
| extensionAuthoring | boolean | `optional` | — |
| orchestration | boolean | `optional` | — |
| fileRead | boolean | `optional` | — |
| fileWrite | boolean | `optional` | — |
| shell | boolean | `optional` | — |
| web | boolean | `optional` | — |

## AgentRuntimePolicySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| model | string | `optional` | max 200 |
| harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| contextTier | "default" / "long_context" | `optional` | — |
| maxTurns | number | `optional` | int; min 1; max 1000 |
| permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| defaultAgentMode | "auto" / "plan" | `optional` | — |

## AgentOrchestrationPolicySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| teamAgentRefs | array of string | `default []` | maxLength 50 |
| maxWorkers | number | `optional` | int; min 1; max 50 |
| defaultWorkerModel | string | `optional` | max 200 |

## AgentOverridesSchema

Additive capability delta applied at a binding site (chat / stage).

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| addSkillIds | array of string | `optional` | maxLength 100 |
| removeSkillIds | array of string | `optional` | maxLength 100 |
| addMcpServerIds | array of string | `optional` | maxLength 100 |
| removeMcpServerIds | array of string | `optional` | maxLength 100 |
| tools | object | `optional` | unknown keys: strip |
| tools.browser | boolean | `optional` | — |
| tools.widgets | boolean | `optional` | — |
| tools.extensionAuthoring | boolean | `optional` | — |
| tools.orchestration | boolean | `optional` | — |
| tools.fileRead | boolean | `optional` | — |
| tools.fileWrite | boolean | `optional` | — |
| tools.shell | boolean | `optional` | — |
| tools.web | boolean | `optional` | — |
| runtime | object | `optional` | unknown keys: strip |
| runtime.model | string | `optional` | max 200 |
| runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| runtime.contextTier | "default" / "long_context" | `optional` | — |
| runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| appendInstructions | string | `optional` | max 16000 |
| extraAllow | array of string | `optional` | maxLength 200 |
| extraDeny | array of string | `optional` | maxLength 200 |

## CreateAgentSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| scope | "global" / "project" | `default "global"` | — |
| projectId | string | `optional` | uuid |
| slug | string | `optional` | min 2; max 64; regex /^[a-z0-9][a-z0-9-]{1,63}$/ |
| name | string | `required` | min 1; max 120 |
| description | string | `required` | min 10; max 2000 |
| instructions | string | `required` | min 1; max 32768 |
| role | "agent" / "orchestrator" | `default "agent"` | — |
| projection | "append" / "replace" | `default "append"` | — |
| icon | string | `optional` | max 64 |
| color | string | `optional` | max 32 |
| tags | array of string | `default []` | maxLength 20 |
| enabled | boolean | `default true` | — |
| skillIds | array of string | `default []` | maxLength 200 |
| mcpServerIds | array of string | `default []` | maxLength 100 |
| tools | object | `default {}` | unknown keys: strip |
| tools.browser | boolean | `optional` | — |
| tools.widgets | boolean | `optional` | — |
| tools.extensionAuthoring | boolean | `optional` | — |
| tools.orchestration | boolean | `optional` | — |
| tools.fileRead | boolean | `optional` | — |
| tools.fileWrite | boolean | `optional` | — |
| tools.shell | boolean | `optional` | — |
| tools.web | boolean | `optional` | — |
| runtime | object | `default {}` | unknown keys: strip |
| runtime.model | string | `optional` | max 200 |
| runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| runtime.contextTier | "default" / "long_context" | `optional` | — |
| runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| orchestration | object | `optional` | unknown keys: strip |
| orchestration.teamAgentRefs | array of string | `default []` | maxLength 50 |
| orchestration.maxWorkers | number | `optional` | int; min 1; max 50 |
| orchestration.defaultWorkerModel | string | `optional` | max 200 |

## UpdateAgentSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| slug | string | `optional` | min 2; max 64; regex /^[a-z0-9][a-z0-9-]{1,63}$/ |
| name | string | `optional` | min 1; max 120 |
| description | string | `optional` | min 10; max 2000 |
| instructions | string | `optional` | min 1; max 32768 |
| role | "agent" / "orchestrator" | `optional` | — |
| projection | "append" / "replace" | `optional` | — |
| icon | string | `optional` | max 64 |
| color | string | `optional` | max 32 |
| tags | array of string | `optional` | maxLength 20 |
| enabled | boolean | `optional` | — |
| skillIds | array of string | `optional` | maxLength 200 |
| mcpServerIds | array of string | `optional` | maxLength 100 |
| tools | object | `optional` | unknown keys: strip |
| tools.browser | boolean | `optional` | — |
| tools.widgets | boolean | `optional` | — |
| tools.extensionAuthoring | boolean | `optional` | — |
| tools.orchestration | boolean | `optional` | — |
| tools.fileRead | boolean | `optional` | — |
| tools.fileWrite | boolean | `optional` | — |
| tools.shell | boolean | `optional` | — |
| tools.web | boolean | `optional` | — |
| runtime | object | `optional` | unknown keys: strip |
| runtime.model | string | `optional` | max 200 |
| runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| runtime.contextTier | "default" / "long_context" | `optional` | — |
| runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| orchestration | object | `optional` | unknown keys: strip |
| orchestration.teamAgentRefs | array of string | `default []` | maxLength 50 |
| orchestration.maxWorkers | number | `optional` | int; min 1; max 50 |
| orchestration.defaultWorkerModel | string | `optional` | max 200 |

## ImportAgentSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| markdown | string | `required` | min 1; max 262144 |
| scope | "global" / "project" | `default "global"` | — |
| projectId | string | `optional` | uuid |
| overwrite | boolean | `default false` | — |

## ResolvePreviewSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| agentRef | string | `optional` | max 128 |
| overrides | object | `optional` | unknown keys: strip |
| overrides.addSkillIds | array of string | `optional` | maxLength 100 |
| overrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| overrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| overrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| overrides.tools | object | `optional` | unknown keys: strip |
| overrides.tools.browser | boolean | `optional` | — |
| overrides.tools.widgets | boolean | `optional` | — |
| overrides.tools.extensionAuthoring | boolean | `optional` | — |
| overrides.tools.orchestration | boolean | `optional` | — |
| overrides.tools.fileRead | boolean | `optional` | — |
| overrides.tools.fileWrite | boolean | `optional` | — |
| overrides.tools.shell | boolean | `optional` | — |
| overrides.tools.web | boolean | `optional` | — |
| overrides.runtime | object | `optional` | unknown keys: strip |
| overrides.runtime.model | string | `optional` | max 200 |
| overrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| overrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| overrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| overrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| overrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| overrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| overrides.appendInstructions | string | `optional` | max 16000 |
| overrides.extraAllow | array of string | `optional` | maxLength 200 |
| overrides.extraDeny | array of string | `optional` | maxLength 200 |
| projectId | string | `optional` | uuid |
| harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| scope | "chat" / "stage" / "worker" | `default "chat"` | — |
| draft | object | `optional` | unknown keys: strip |
| draft.scope | "system" / "global" / "project" | `optional` | — |
| draft.projectId | string | `optional` | uuid |
| draft.slug | string | `optional` | min 2; max 64; regex /^[a-z0-9][a-z0-9-]{1,63}$/ |
| draft.name | string | `optional` | max 120 |
| draft.description | string | `optional` | max 2000 |
| draft.instructions | string | `optional` | max 32768 |
| draft.role | "agent" / "orchestrator" | `optional` | — |
| draft.projection | "append" / "replace" | `optional` | — |
| draft.icon | string | `optional` | max 64 |
| draft.color | string | `optional` | max 32 |
| draft.tags | array of string | `optional` | maxLength 20 |
| draft.enabled | boolean | `optional` | — |
| draft.skillIds | array of string | `optional` | maxLength 200 |
| draft.mcpServerIds | array of string | `optional` | maxLength 100 |
| draft.tools | object | `optional` | unknown keys: strip |
| draft.tools.browser | boolean | `optional` | — |
| draft.tools.widgets | boolean | `optional` | — |
| draft.tools.extensionAuthoring | boolean | `optional` | — |
| draft.tools.orchestration | boolean | `optional` | — |
| draft.tools.fileRead | boolean | `optional` | — |
| draft.tools.fileWrite | boolean | `optional` | — |
| draft.tools.shell | boolean | `optional` | — |
| draft.tools.web | boolean | `optional` | — |
| draft.runtime | object | `optional` | unknown keys: strip |
| draft.runtime.model | string | `optional` | max 200 |
| draft.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| draft.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| draft.runtime.contextTier | "default" / "long_context" | `optional` | — |
| draft.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| draft.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| draft.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| draft.orchestration | object | `optional` | unknown keys: strip |
| draft.orchestration.teamAgentRefs | array of string | `default []` | maxLength 50 |
| draft.orchestration.maxWorkers | number | `optional` | int; min 1; max 50 |
| draft.orchestration.defaultWorkerModel | string | `optional` | max 200 |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete AgentSchemas.ts source contract</summary>

```typescript
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
```

</details>
