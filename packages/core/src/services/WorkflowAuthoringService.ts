// ────────────────────────────────────────────────────────────────
// WorkflowAuthoringService — how any agent authors a workflow (P06 WP-6.5;
// G4 §3.3). One implementation behind the chat/stage tools, the MCP tools,
// the CLI and the HTTP routes:
//
//   validate(graph)   the spec package's `validateWorkflow` (the same rules
//                     the offline `validate.mjs` bundles) plus the checks
//                     only the server can make: the agent exists and is
//                     enabled, the model is in the catalog, provider
//                     capability conflicts (warnings), and command-bearing
//                     fields a caller without `admin:settings` cannot write
//   plan(...)         the invocation planner over a saved definition or an
//                     unsaved graph, nothing written, plus the per-stage
//                     guards decided now and the unresolved `variables.*`
//   createDraft(...)  a DRAFT, tagged `agent-authored`, with its author
//   publish(id, ...)  a person's act (PD-14): an agent principal publishes
//                     only when the operator set `allowAgentPublish`
//   schema()          `{version, hash, jsonSchema}`: an agent holding an
//                     older skill sees the hash differ
//   guide(topic)      a section of the generated `generatorai-workflow-author`
//                     skill bundle (the same files the skill directories and
//                     the MCP resources serve)
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InsufficientScopeError, sessionCapabilityWarnings, ValidationError } from '@generatorai/shared';
import {
  collectCommandFields,
  WORKFLOW_FORMAT_VERSION,
  WorkflowGraphSchema,
  type DefinitionAuthor,
  type InvocationPlan,
  type ValidationIssue,
  type WorkflowDefinitionRecord,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IAgentRepository } from '../domain/ports/IAgentRepository.js';
import { COMMAND_EDIT_SCOPE, type WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { WorkflowInvocationService } from './workflow-invocation/WorkflowInvocationService.js';
import type { InvocationContext } from './workflow-invocation/types.js';

/** The tag every agent-authored definition carries. */
export const AGENT_AUTHORED_TAG = 'agent-authored';

/** The guide topics and the bundle file each one serves (WP-6.6 layout). */
export const AUTHORING_GUIDE_TOPICS = {
  overview: 'SKILL.md',
  schema: 'reference/schema.md',
  stages: 'reference/stages.md',
  edges: 'reference/edges-and-expressions.md',
  expressions: 'reference/edges-and-expressions.md',
  'control-flow': 'reference/control-flow.md',
  agents: 'reference/agents-and-models.md',
  lifecycle: 'reference/lifecycle.md',
  pitfalls: 'reference/pitfalls.md',
  examples: 'examples',
} as const;
export type AuthoringGuideTopic = keyof typeof AUTHORING_GUIDE_TOPICS;

export interface AuthoringValidation {
  valid: boolean;
  issues: ValidationIssue[];
  /** The schema the server validated against; compare with the skill's `schemaHash`. */
  schema: { version: number; hash: string | null };
}

export interface AuthoringPlan {
  plan: InvocationPlan;
  /** Guards decided before the run (over variables alone): stage key → true / false. Undecided guards are absent. */
  guards: Record<string, boolean>;
  /** `variables.<name>` read by a prompt or expression, with no value given and no default. */
  unresolved: string[];
  /** Validation warnings (capability conflicts and the like). */
  warnings: ValidationIssue[];
}

export interface DraftResult {
  workflowId: string;
  status: 'draft';
  name: string;
  reviewLink: string;
  warnings: ValidationIssue[];
}

export interface WorkflowAuthoringDeps {
  definitions: WorkflowDefinitionService;
  invocation: WorkflowInvocationService;
  agents?: Pick<IAgentRepository, 'getByRef'> | undefined;
  models?: (() => Promise<Array<{ id: string }>>) | undefined;
  /** The generated skill bundle (`templates/system/skills/generatorai-workflow-author`). */
  skillDir?: string | undefined;
  /** The operator switch (`GENERATORAI_ALLOW_AGENT_PUBLISH`): agents may publish. Default off (PD-14). */
  allowAgentPublish?: (() => boolean) | undefined;
  /** The web app origin, for review links. */
  appUrl?: string | undefined;
}

/** Who asks, for the checks that depend on it. */
export interface AuthoringCaller {
  /** Holds `admin:settings`: may write command-bearing fields. */
  canEditCommands: boolean;
}

const VAR_REF = /\bvariables\.([A-Za-z_][A-Za-z0-9_]*)/g;

export class WorkflowAuthoringService {
  private schemaCache: { hash: string | null; json: Record<string, unknown> | null } | undefined;

  constructor(private readonly deps: WorkflowAuthoringDeps) {}

  /** Whether agents may publish (the operator's switch). */
  agentsMayPublish(): boolean {
    return this.deps.allowAgentPublish?.() === true;
  }

  // ── validate ────────────────────────────────────────────────

  async validate(input: unknown, caller: AuthoringCaller): Promise<AuthoringValidation> {
    const result = await this.deps.definitions.validate(input);
    const issues = [...result.issues];
    if (result.graph) issues.push(...(await this.serverIssues(result.graph, caller)));
    const { hash } = await this.loadSchema();
    return {
      valid: !issues.some((i) => i.severity === 'error'),
      issues,
      schema: { version: WORKFLOW_FORMAT_VERSION, hash },
    };
  }

  /** The checks only the server can make (G4 §3.3 layers 5–6). */
  private async serverIssues(graph: WorkflowGraph, caller: AuthoringCaller): Promise<ValidationIssue[]> {
    const out: ValidationIssue[] = [];
    const agentPaths: Array<{ ref: string; path: string; stageKey?: string }> = [];
    if (graph.workflow.session.agentRef) agentPaths.push({ ref: graph.workflow.session.agentRef, path: '/workflow/session/agentRef' });
    graph.stages.forEach((s, i) => {
      if (s.kind === 'agent' && s.session?.agentRef) agentPaths.push({ ref: s.session.agentRef, path: `/stages/${i}/session/agentRef`, stageKey: s.key });
    });
    if (this.deps.agents) {
      for (const a of agentPaths) {
        const agent = await this.deps.agents.getByRef(a.ref).catch(() => null);
        if (!agent) {
          out.push({ code: 'agent-not-found', severity: 'error', path: a.path, ...(a.stageKey ? { stageKey: a.stageKey } : {}), message: `No agent "${a.ref}" exists`, hint: 'List the agents and use an existing `scope:slug` ref' });
        } else if (agent.enabled === false) {
          out.push({ code: 'agent-disabled', severity: 'error', path: a.path, ...(a.stageKey ? { stageKey: a.stageKey } : {}), message: `Agent "${a.ref}" is disabled` });
        }
      }
    }

    const models = new Map<string, string>();
    if (graph.workflow.session.model) models.set('/workflow/session/model', graph.workflow.session.model);
    graph.stages.forEach((s, i) => {
      if (s.kind === 'agent' && s.session?.model) models.set(`/stages/${i}/session/model`, s.session.model);
    });
    if (models.size > 0 && this.deps.models) {
      const catalog = await this.deps.models().catch(() => []);
      if (catalog.length > 0) {
        const ids = new Set(catalog.map((m) => m.id));
        for (const [p, m] of models) {
          if (!ids.has(m)) out.push({ code: 'unknown-model', severity: 'error', path: p, message: `"${m}" is not a model of any provider`, hint: 'Omit the model to use the default, or pick one from the catalog' });
        }
      }
    }

    // Provider capability conflicts (C-11): warnings, the run decides.
    const wf = graph.workflow.session;
    graph.stages.forEach((s, i) => {
      if (s.kind !== 'agent') return;
      const provider = s.session?.harnessType ?? wf.harnessType;
      if (!provider) return;
      const mode = s.session?.permissionMode ?? wf.permissionMode;
      for (const w of sessionCapabilityWarnings({
        provider,
        ...(mode ? { permissionMode: mode } : {}),
        wantsSkills: !!(s.session?.skills ?? wf.skills),
        computerUse: s.session?.computerUse === true,
      })) {
        out.push({ code: `capability-${w.code.replace(/_/g, '-')}`, severity: 'warning', path: `/stages/${i}/session`, stageKey: s.key, message: w.message });
      }
    });

    if (!caller.canEditCommands) {
      for (const f of collectCommandFields(graph)) {
        out.push({
          code: 'command-needs-admin',
          severity: 'error',
          path: f.pointer,
          ...(f.stageKey ? { stageKey: f.stageKey } : {}),
          message: `A ${f.kind} field (${f.command ?? 'a command'}) makes the server run a program; writing it needs ${COMMAND_EDIT_SCOPE}`,
          hint: 'Remove it, or ask a person with admin rights to add it',
        });
      }
    }
    return out;
  }

  // ── plan ────────────────────────────────────────────────────

  /** What a run would do, for a saved definition (its working graph) or an unsaved graph. Nothing is written. */
  async plan(
    input: { graph?: unknown; workflowId?: string; variables?: Record<string, unknown>; stageOverrides?: unknown[]; projectId?: string },
    ctx: InvocationContext,
  ): Promise<AuthoringPlan> {
    let graph: WorkflowGraph;
    let workflowDefinitionId = 'draft';
    if (input.workflowId) {
      const record = await this.deps.definitions.get(input.workflowId);
      graph = record.graph;
      workflowDefinitionId = record.id;
    } else {
      const parsed = WorkflowGraphSchema.safeParse(input.graph);
      if (!parsed.success) {
        throw new ValidationError(
          `The graph does not parse: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '/'}: ${i.message}`).join('; ')}; call validate_workflow for every issue`,
        );
      }
      graph = parsed.data;
    }
    const validation = await this.deps.definitions.validate(graph, input.workflowId ? { definitionId: input.workflowId } : {});
    const errors = validation.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new ValidationError(`The workflow is not valid (${errors.length} error${errors.length === 1 ? '' : 's'}): ${errors.slice(0, 3).map((i) => `${i.path || '/'}: ${i.message}`).join('; ')}`);
    }
    const variables = input.variables ?? {};
    const plan = await this.deps.invocation.planGraph(
      { workflowDefinitionId, graph },
      {
        variables,
        ...(input.stageOverrides ? { stageOverrides: input.stageOverrides } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      ctx,
    );
    const guards: Record<string, boolean> = {};
    for (const s of plan.stages) {
      const stage = graph.stages.find((x) => x.key === s.key);
      if (!stage?.guard) continue;
      if (s.skipReason === 'guard_false') guards[s.key] = false;
      else if (!/\bstages\.|\bloop\.|\bmaps\.|\bitem\b/.test(stage.guard)) guards[s.key] = true;
    }
    return { plan, guards, unresolved: unresolvedVariables(graph, variables), warnings: validation.issues.filter((i) => i.severity === 'warning') };
  }

  // ── drafts and publishing ───────────────────────────────────

  /**
   * A draft from an agent: validated like any definition, tagged
   * `agent-authored`, its author recorded. It never runs until a person
   * publishes it (a test run from the review UI excepted).
   */
  async createDraft(
    input: unknown,
    opts: { authoredBy: Omit<DefinitionAuthor, 'at'>; projectId?: string | undefined; canEditCommands: boolean },
  ): Promise<DraftResult> {
    const parsed = WorkflowGraphSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `The graph does not parse: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '/'}: ${i.message}`).join('; ')}; call validate_workflow for every issue`,
      );
    }
    const graph = parsed.data;
    if (opts.authoredBy.replacesWorkflowId) await this.deps.definitions.get(opts.authoredBy.replacesWorkflowId);
    const tagged: WorkflowGraph = {
      ...graph,
      workflow: {
        ...graph.workflow,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        tags: [...new Set([...graph.workflow.tags, AGENT_AUTHORED_TAG])].slice(0, 20),
      },
    };
    const server = await this.serverIssues(tagged, { canEditCommands: opts.canEditCommands });
    const blocking = server.filter((i) => i.severity === 'error');
    if (blocking.length > 0) {
      throw new ValidationError(`The draft is not valid: ${blocking.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    }
    const record = await this.deps.definitions.createFromSpec(tagged, {
      canEditCommands: opts.canEditCommands,
      status: 'draft',
      authoredBy: { ...opts.authoredBy, at: new Date().toISOString() },
    });
    return {
      workflowId: record.id,
      status: 'draft',
      name: record.graph.workflow.name,
      reviewLink: this.reviewLink(record.id),
      warnings: server.filter((i) => i.severity === 'warning'),
    };
  }

  /** The builder page of a definition (the agent-draft banner shows there). */
  reviewLink(workflowId: string): string {
    return `${this.deps.appUrl ?? ''}/workflows/${workflowId}/edit`;
  }

  /**
   * Publish (PD-14): a person may; an agent (a chat, a stage, an external
   * agent or a service account) only when the operator allows it.
   */
  async publish(id: string, by: { person: boolean }): Promise<WorkflowDefinitionRecord> {
    if (!by.person && !this.agentsMayPublish()) {
      throw new InsufficientScopeError(
        'Only a person publishes a workflow: an agent submits drafts, and a person reviews and publishes them (the operator setting allowAgentPublish is off)',
        'publish',
      );
    }
    return this.deps.definitions.publish(id);
  }

  // ── schema and guide ────────────────────────────────────────

  /** The workflow JSON Schema the server validates against, with its hash. */
  async schema(): Promise<{ version: number; hash: string | null; jsonSchema: Record<string, unknown> | null }> {
    const s = await this.loadSchema();
    return { version: WORKFLOW_FORMAT_VERSION, hash: s.hash, jsonSchema: s.json };
  }

  private async loadSchema(): Promise<{ hash: string | null; json: Record<string, unknown> | null }> {
    if (this.schemaCache) return this.schemaCache;
    const file = this.deps.skillDir ? path.join(this.deps.skillDir, 'schema', 'workflow.schema.json') : undefined;
    try {
      if (!file) throw new Error('no skill bundle');
      const text = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
      this.schemaCache = { hash: schemaHashOf(text), json: JSON.parse(text) as Record<string, unknown> };
    } catch {
      this.schemaCache = { hash: null, json: null };
    }
    return this.schemaCache;
  }

  /** A section of the generated skill bundle (the in-app skill channel). */
  async guide(topic: string | undefined): Promise<string> {
    const key = (topic ?? 'overview') as AuthoringGuideTopic;
    const rel = AUTHORING_GUIDE_TOPICS[key];
    if (!rel) {
      return `Unknown topic "${topic}". Topics: ${Object.keys(AUTHORING_GUIDE_TOPICS).join(', ')}.`;
    }
    const dir = this.deps.skillDir;
    if (!dir) return 'The workflow authoring guide is not installed on this server.';
    try {
      if (rel === 'examples') return await this.examplesIndex(dir);
      const text = await fs.readFile(path.join(dir, rel), 'utf8');
      return text.replace(/\r\n/g, '\n');
    } catch {
      return `The guide section "${key}" is missing from this server's skill bundle.`;
    }
  }

  /** The bundle's files (MCP resources and the skill route serve the same ones). */
  async bundleFiles(): Promise<string[]> {
    const dir = this.deps.skillDir;
    if (!dir) return [];
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (child !== 'evals') await walk(child);
        } else out.push(child);
      }
    };
    await walk('');
    return out.sort();
  }

  /** One bundle file by its relative path (never outside the bundle). */
  async bundleFile(rel: string): Promise<string> {
    const dir = this.deps.skillDir;
    if (!dir) throw new ValidationError('The workflow authoring skill is not installed on this server');
    const norm = rel.replace(/\\/g, '/');
    if (norm.startsWith('/') || norm.split('/').some((p) => p === '..' || p === '')) throw new ValidationError(`Not a bundle path: ${rel}`);
    if (!(await this.bundleFiles()).includes(norm)) throw new ValidationError(`No bundle file ${rel}`);
    return (await fs.readFile(path.join(dir, norm), 'utf8')).replace(/\r\n/g, '\n');
  }

  private async examplesIndex(dir: string): Promise<string> {
    const files = (await fs.readdir(path.join(dir, 'examples')).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
    const lines = ['# Examples', '', 'Each file is a complete workflow document that validates. Read one with the MCP resource `generatorai://workflow-author/examples/<file>` or `generatorai skill print examples/<file>`.', ''];
    for (const f of files) {
      try {
        const doc = JSON.parse(await fs.readFile(path.join(dir, 'examples', f), 'utf8')) as { workflow?: { name?: string; description?: string } };
        lines.push(`- \`${f}\`: ${doc.workflow?.name ?? f}${doc.workflow?.description ? ` — ${doc.workflow.description}` : ''}`);
      } catch {
        lines.push(`- \`${f}\``);
      }
    }
    return lines.join('\n') + '\n';
  }
}

/** The hash an agent's skill carries (`schemaHash`): sha256 of the LF-normalised workflow.schema.json. */
export function schemaHashOf(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

/** `variables.<name>` a prompt, guard or expression reads that has no value and no default. */
function unresolvedVariables(graph: WorkflowGraph, provided: Record<string, unknown>): string[] {
  const text = JSON.stringify(graph.stages);
  const declared = new Map(graph.workflow.variables.map((v) => [v.name, v]));
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_REF)) {
    const name = m[1]!;
    const has = provided[name] !== undefined && provided[name] !== null && provided[name] !== '';
    if (!has && declared.get(name)?.defaultValue === undefined) out.add(name);
  }
  return [...out].sort();
}
