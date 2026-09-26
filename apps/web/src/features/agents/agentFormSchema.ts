// ────────────────────────────────────────────────────────────────
// AgentEditor form — values, defaults and validation (D-38: TanStack Form 1
// + zod 4 for forms with > 5 fields).
//
// The form mirrors the persisted `Agent` shape 1:1 (`AgentFormValues`) so
// `agentToForm`/`agentFormToCreateParams` are trivial. Business rules that
// depend on more than one field (the slug pattern once derived from the
// name, the instructions byte budget, project-scope requiring a project, an
// orchestrator excluding itself from its own team) run in one `superRefine`
// so every rule is visible in one place instead of scattered across field
// validators.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import {
  AGENT_INSTRUCTIONS_MAX_BYTES,
  AGENT_SLUG_PATTERN,
  slugifyAgentName,
  type Agent,
  type AgentOrchestrationPolicy,
  type AgentProjectionMode,
  type AgentRole,
  type AgentRuntimePolicy,
  type AgentScope,
  type AgentToolPolicy,
  type CreateAgentParams,
} from '@generatorai/shared';

export interface AgentFormValues {
  scope: AgentScope;
  projectId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  role: AgentRole;
  projection: AgentProjectionMode;
  tags: string[];
  enabled: boolean;
  skillIds: string[];
  mcpServerIds: string[];
  tools: Partial<AgentToolPolicy>;
  runtime: AgentRuntimePolicy;
  orchestration: AgentOrchestrationPolicy;
}

export const EMPTY_AGENT_FORM: AgentFormValues = {
  scope: 'global',
  projectId: '',
  slug: '',
  name: '',
  description: '',
  instructions: '',
  role: 'agent',
  projection: 'append',
  tags: [],
  enabled: true,
  skillIds: [],
  mcpServerIds: [],
  tools: {},
  runtime: {},
  orchestration: { teamAgentRefs: [] },
};

export function agentToForm(agent: Agent): AgentFormValues {
  return {
    scope: agent.scope,
    projectId: agent.projectId,
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    role: agent.role,
    projection: agent.projection,
    tags: agent.tags,
    enabled: agent.enabled,
    skillIds: agent.skillIds,
    mcpServerIds: agent.mcpServerIds,
    tools: agent.tools ?? {},
    runtime: agent.runtime ?? {},
    orchestration: agent.orchestration ?? { teamAgentRefs: [] },
  };
}

/** The `CreateAgentParams`/`UpdateAgentParams` payload (both accept the same shape). */
export function agentFormToParams(values: AgentFormValues): Omit<CreateAgentParams, 'scope' | 'projectId'> & {
  scope?: AgentScope;
  projectId?: string;
} {
  const slug = effectiveSlug(values);
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    instructions: values.instructions,
    slug,
    role: values.role,
    projection: values.projection,
    tags: values.tags,
    enabled: values.enabled,
    skillIds: values.skillIds,
    mcpServerIds: values.mcpServerIds,
    tools: values.tools,
    runtime: values.runtime,
    ...(values.role === 'orchestrator' ? { orchestration: values.orchestration } : {}),
  };
}

/** UTF-8 byte length — the server's `AGENT_INSTRUCTIONS_MAX_BYTES` budget is bytes, not UTF-16 code units. */
export function instructionBytes(instructions: string): number {
  return new TextEncoder().encode(instructions).length;
}

/** The slug is auto-derived from the name until the author types their own (`slugTouched`). */
export function effectiveSlug(values: Pick<AgentFormValues, 'slug' | 'name'>): string {
  return values.slug || slugifyAgentName(values.name || 'agent');
}

const toolPolicySchema = z
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

const runtimePolicySchema = z.object({}).catchall(z.unknown());
const orchestrationPolicySchema = z.object({
  teamAgentRefs: z.array(z.string()),
  maxWorkers: z.number().optional(),
  defaultWorkerModel: z.string().optional(),
});

/**
 * Validates an `AgentFormValues` draft. Every rule below is a real
 * constraint the server also enforces (`AgentSchemas.ts` / `AgentService`):
 * a form that let Save through past these previously surfaced only as a
 * generic 400 "Request body validation failed" toast naming no field.
 */
export const agentFormSchema = z
  .object({
    scope: z.enum(['system', 'global', 'project']),
    projectId: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    role: z.enum(['agent', 'orchestrator']),
    projection: z.enum(['append', 'replace']),
    tags: z.array(z.string()),
    enabled: z.boolean(),
    skillIds: z.array(z.string()),
    mcpServerIds: z.array(z.string()),
    tools: toolPolicySchema,
    runtime: runtimePolicySchema,
    orchestration: orchestrationPolicySchema,
  })
  .superRefine((values, ctx) => {
    if (!values.name.trim()) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required.' });
    }
    if (values.description.trim().length < 10) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Description must be at least 10 characters — both SDKs use it to route delegation.',
      });
    }
    const slug = effectiveSlug(values);
    if (!AGENT_SLUG_PATTERN.test(slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'Slug must be 2–64 characters: lowercase letters, digits and hyphens.',
      });
    }
    // Required by the create contract (`AgentSchemas.ts`: instructions is
    // `z.string().min(1)`) — it becomes the agent's system prompt.
    if (!values.instructions.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: 'Instructions are required — they become the agent’s system prompt.',
      });
    }
    const bytes = instructionBytes(values.instructions);
    if (bytes > AGENT_INSTRUCTIONS_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: `Instructions are ${bytes} bytes; the limit is ${AGENT_INSTRUCTIONS_MAX_BYTES}.`,
      });
    }
    if (values.scope === 'project' && !values.projectId) {
      ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Pick a project for a project-scoped agent.' });
    }
    if (values.role === 'orchestrator' && values.orchestration.teamAgentRefs.includes(`${values.scope}:${slug}`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['orchestration', 'teamAgentRefs'],
        message: 'An orchestrator cannot include itself in its own team.',
      });
    }
  });

/** Human-readable validation errors for the draft, in a stable field order. */
export function validateAgentForm(values: AgentFormValues): string[] {
  const result = agentFormSchema.safeParse(values);
  if (result.success) return [];
  // De-duplicate: `instructions` can carry two independent issues (empty AND
  // over budget cannot both be true, but a future rule might add a third).
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}
