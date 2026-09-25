// `generatorai workflow …` — v2 workflow documents: create, import, export,
// validate, publish, and edit stages and edges.
//
// A definition is ONE document (`WorkflowGraph`). Every edit below is a
// read-modify-write of the whole graph: fetch the record, change the graph,
// `PUT /:id/graph` with the revision that was read. A stale revision is a
// 409; the edit is re-applied once to a fresh read, then reported.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import {
  EDGE_ON_VALUES,
  HookDefinitionSchema,
  STAGE_HOOK_PHASES,
  STAGE_KEY_PATTERN,
  validateWorkflow,
  type HookDefinition,
  type ValidationIssue,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionSummary,
  type WorkflowGraphInput,
} from '@generatorai/workflow-spec';
import type { DefinitionListParams } from '@generatorai/client-core';
import { defineCommand, type CommandResult, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import {
  compact,
  createdColumn,
  idColumn,
  inputSchema,
  list,
  nameColumn,
  parseList,
  projectFlag,
  readTextFile,
  record,
  statusColumn,
  updatedColumn,
} from './_shared.js';

export const WORKFLOW_GROUP = {
  name: 'workflow',
  aliases: ['wf'],
  summary: 'Workflow definitions: documents, versions, stages and edges',
  order: 20,
};

type StageInput = WorkflowGraphInput['stages'][number];
type EdgeInput = NonNullable<WorkflowGraphInput['edges']>[number];

const HOOK_TYPES = ['script', 'http', 'function'] as const;
const HOOK_FAILURE_POLICIES = ['abort', 'skip', 'continue'] as const;
const OUTPUT_FORMATS = ['text', 'json'] as const;
const CONTEXT_MODES = ['summary', 'output', 'structured', 'none'] as const;
const APPROVAL_SWITCH = ['on', 'off'] as const;
const DEFINITION_STATUSES = ['draft', 'published'] as const;

/** Upper bound on list pages followed when resolving a reference. */
const MAX_LIST_PAGES = 50;

// ── Definitions ─────────────────────────────────────────────────────

/** Every definition matching `params`, following `nextCursor` (at most `limit` rows when given). */
export async function listDefinitions(
  ctx: CliContext,
  params: DefinitionListParams = {},
): Promise<WorkflowDefinitionSummary[]> {
  const rows: WorkflowDefinitionSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await ctx.api.definitions.list({ ...params, ...(cursor ? { cursor } : {}) });
    rows.push(...(result?.items ?? []));
    cursor = result?.nextCursor;
    if (!cursor || (params.limit !== undefined && rows.length >= params.limit)) break;
  }
  return params.limit !== undefined ? rows.slice(0, params.limit) : rows;
}

/** A workflow reference (id, prefix, name, `#n`, `@last`) → its list row. */
export async function findDefinition(ctx: CliContext, ref: string): Promise<WorkflowDefinitionSummary> {
  return resolveRef(ref, { kind: 'workflow', candidates: await listDefinitions(ctx) });
}

/** A stage reference (key or name) → the stage key. */
function findStageKey(graph: WorkflowGraphInput, ref: string): string {
  return resolveRef(ref, {
    kind: 'stage',
    candidates: graph.stages.map((stage) => ({ id: stage.key, name: stage.name })),
  }).id;
}

function stageAt(graph: WorkflowGraphInput, key: string): StageInput {
  const stage = graph.stages.find((s) => s.key === key);
  if (!stage) throw CliError.notFound('stage', key);
  return stage;
}

// ── Validation output ───────────────────────────────────────────────

/** `error /stages/2/prompts/0/text [build]: message — hint` */
export function formatIssue(issue: ValidationIssue): string {
  const where = `${issue.path || '/'}${issue.stageKey ? ` [${issue.stageKey}]` : ''}`;
  return `${issue.severity} ${where}: ${issue.message}${issue.hint ? ` — ${issue.hint}` : ''}`;
}

function invalidError(what: string, issues: ValidationIssue[], details: Record<string, unknown> = {}): CliError {
  const errors = issues.filter((issue) => issue.severity === 'error');
  return new CliError('VALIDATION', `${what}:\n${errors.map((issue) => `  ${formatIssue(issue)}`).join('\n')}`, {
    // `--json` surfaces `details`, so a scripted caller gets every issue
    // with its pointer and stage key, not just the prose.
    details: { ...details, issues },
  });
}

/**
 * The same validator the server saves with, run before sending: a 422 from
 * the server reaches the CLI as one sentence, while this names every issue
 * with its JSON pointer.
 */
function assertValidGraph(graph: unknown, what: string): string[] {
  const result = validateWorkflow(graph);
  if (!result.valid) throw invalidError(what, result.issues);
  return result.issues.filter((issue) => issue.severity === 'warning').map(formatIssue);
}

// ── Documents on disk ───────────────────────────────────────────────

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** A JSON document from a file, or stdin for `-`. */
async function readDocument(file: string): Promise<unknown> {
  const raw = file === '-' ? await readAll(process.stdin) : await readTextFile(path.resolve(file), 'workflow file');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CliError('VALIDATION', `${file} is not valid JSON.`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

async function isFile(target: string): Promise<boolean> {
  if (target === '-') return true;
  try {
    return (await fs.stat(path.resolve(target))).isFile();
  } catch {
    return false;
  }
}

async function resolveProjectId(ctx: CliContext, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const projects = await ctx.api.projects.list();
  return resolveRef(ref, { kind: 'project', candidates: projects }).id;
}

/** Applies `--name/--description/--tags/--project` to a document's workflow settings. */
function withSettings(
  graph: WorkflowGraphInput,
  settings: { name?: string | undefined; description?: string | undefined; tags?: string[] | undefined; projectId?: string | undefined },
): WorkflowGraphInput {
  return { ...graph, workflow: { ...graph.workflow, ...compact(settings) } };
}

function asGraph(document: unknown, file: string): WorkflowGraphInput {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new CliError('VALIDATION', `${file} does not hold a workflow document.`, {
      hint: 'Expected {"formatVersion": 2, "workflow": {...}, "stages": [...], "edges": [...]}.',
    });
  }
  return document as WorkflowGraphInput;
}

// ── Read-modify-write ───────────────────────────────────────────────

function isRevisionConflict(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 409;
}

/**
 * Applies `change` to the definition's graph and saves it with the revision
 * that was read. On a 409 the definition was saved by someone else in
 * between: the change is re-applied to a fresh read ONCE, and a second
 * conflict is reported rather than retried forever.
 */
export async function editGraph<R>(
  ctx: CliContext,
  definitionId: string,
  change: (graph: WorkflowGraphInput) => R,
): Promise<{ record: WorkflowDefinitionRecord; result: R; warnings: string[] }> {
  for (let attempt = 0; ; attempt++) {
    const current = await ctx.api.definitions.get(definitionId);
    const graph = structuredClone(current.graph) as WorkflowGraphInput;
    const result = change(graph);
    const warnings = assertValidGraph(graph, 'The edited workflow is not valid; nothing was saved');
    try {
      const saved = await ctx.api.definitions.saveGraph(definitionId, graph, current.revision);
      return { record: saved, result, warnings };
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
      if (attempt >= 1) {
        throw new CliError(
          'CONFLICT',
          `Workflow "${current.graph.workflow.name}" changed again while this edit was being saved; nothing was saved.`,
          {
            hint: 'Someone else is editing it. Run the command again once they are done.',
            details: { workflowId: definitionId, revision: current.revision },
          },
        );
      }
    }
  }
}

// ── Stage fields ────────────────────────────────────────────────────

const STAGE_FIELD_FLAGS = [
  { name: 'description', description: 'What the stage is for', type: 'string' },
  { name: 'prompt', description: 'Prompt text (replaces the prompts)', type: 'string' },
  { name: 'promptFile', description: 'Read the prompt from a file', type: 'string', completes: 'file' },
  { name: 'guard', description: 'Expression; false skips the stage ("" clears it)', type: 'string' },
  { name: 'retryAttempts', description: 'Attempts including the first (1-10)', type: 'number' },
  { name: 'timeoutMs', description: 'Agent time per attempt, in milliseconds', type: 'number' },
  { name: 'outputFormat', description: 'Output format', type: 'string', choices: OUTPUT_FORMATS },
  { name: 'contextFrom', description: 'Comma-separated stage keys whose output is context', type: 'string', completes: 'stage' },
  { name: 'contextMode', description: 'What context the stage receives', type: 'string', choices: CONTEXT_MODES },
  { name: 'agent', description: 'Agent reference (scope:slug)', type: 'string', completes: 'agent' },
  { name: 'model', description: 'Model id', type: 'string', completes: 'model' },
  { name: 'approval', description: 'Human review after the stage', type: 'string', choices: APPROVAL_SWITCH },
] as const;

const stageFieldSchema = {
  description: z.string().optional(),
  prompt: z.string().optional(),
  promptFile: z.string().optional(),
  guard: z.string().optional(),
  retryAttempts: z.coerce.number().int().min(1).max(10).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(86_400_000).optional(),
  outputFormat: z.enum(OUTPUT_FORMATS).optional(),
  contextFrom: z.string().optional(),
  contextMode: z.enum(CONTEXT_MODES).optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  approval: z.enum(APPROVAL_SWITCH).optional(),
};

type StageFieldFlags = {
  [K in keyof typeof stageFieldSchema]?: z.infer<(typeof stageFieldSchema)[K]>;
};

async function promptText(flags: StageFieldFlags): Promise<string | undefined> {
  if (flags.prompt !== undefined && flags.promptFile) {
    throw CliError.usage('--prompt and --prompt-file are mutually exclusive.');
  }
  return flags.promptFile ? readTextFile(path.resolve(flags.promptFile), 'prompt file') : flags.prompt;
}

/** Whether any stage-field flag was given (an update with none is refused). */
function hasStageFields(flags: StageFieldFlags): boolean {
  return Object.keys(stageFieldSchema).some((key) => flags[key as keyof StageFieldFlags] !== undefined);
}

/** Writes the given flags into a stage, leaving everything else as it was. */
function applyStageFields(
  graph: WorkflowGraphInput,
  stage: StageInput,
  flags: StageFieldFlags,
  prompt: string | undefined,
): void {
  if (flags.description !== undefined) stage.description = flags.description || undefined;
  if (prompt !== undefined) stage.prompts = [{ label: 'prompt', text: prompt }];
  if (flags.guard !== undefined) stage.guard = flags.guard || undefined;
  if (flags.retryAttempts !== undefined) stage.retry = { ...stage.retry, maxAttempts: flags.retryAttempts };
  if (flags.timeoutMs !== undefined) stage.timeouts = { ...stage.timeouts, attemptMs: flags.timeoutMs };
  if (flags.outputFormat !== undefined) stage.output = { ...stage.output, format: flags.outputFormat };
  if (flags.contextFrom !== undefined || flags.contextMode !== undefined) {
    const from = flags.contextFrom !== undefined
      ? (parseList(flags.contextFrom) ?? []).map((ref) => findStageKey(graph, ref))
      : stage.context?.from;
    stage.context = {
      ...stage.context,
      ...(flags.contextMode !== undefined ? { mode: flags.contextMode } : {}),
      from,
    };
    if (flags.contextFrom === '') delete stage.context.from;
  }
  if (flags.agent !== undefined || flags.model !== undefined) {
    stage.session = {
      ...stage.session,
      ...(flags.agent !== undefined ? { agentRef: flags.agent || undefined } : {}),
      ...(flags.model !== undefined ? { model: flags.model || undefined } : {}),
    };
  }
  if (flags.approval === 'on') stage.approval = stage.approval ?? {};
  if (flags.approval === 'off') delete stage.approval;
}

/** A stage key from a display name: `Write tests` → `write_tests`, unique in the graph. */
export function deriveStageKey(name: string, taken: ReadonlySet<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `stage_${base}`.replace(/_+$/, '');
  base = base.slice(0, 44);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const workflowArg = { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' } as const;
const stageArg = { name: 'stage', description: 'Stage key or name', required: true, completes: 'stage' } as const;

function stageRow(stage: StageInput): Record<string, unknown> {
  return {
    key: stage.key,
    name: stage.name,
    prompts: stage.prompts?.length ?? 0,
    model: stage.session?.model,
    agent: stage.session?.agentRef,
    guard: stage.guard,
    approval: stage.approval !== undefined,
  };
}

export function workflowCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'workflow.list',
      group: 'workflow',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List workflow definitions',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { ...projectFlag, description: 'Project id or name; "global" lists definitions without a project' },
        { name: 'status', description: 'Only drafts or only published definitions', type: 'string', choices: DEFINITION_STATUSES },
        { name: 'search', description: 'Name or description contains', type: 'string' },
        { name: 'tag', description: 'Filter by tag', type: 'string' },
        { name: 'archived', description: 'Include archived definitions', type: 'boolean' },
        { name: 'limit', description: 'Maximum rows', type: 'number' },
      ],
      schema: inputSchema(
        {},
        {
          project: z.string().optional(),
          status: z.enum(DEFINITION_STATUSES).optional(),
          search: z.string().optional(),
          tag: z.string().optional(),
          archived: z.boolean().optional(),
          limit: z.coerce.number().int().positive().optional(),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          statusColumn,
          { key: 'revision', header: 'Rev', format: 'number', priority: 3 },
          { key: 'stageCount', header: 'Stages', format: 'number', priority: 2 },
          { key: 'tags', header: 'Tags', format: 'list', priority: 4 },
          updatedColumn,
        ],
      },
      async handler(ctx, { flags }) {
        const projectId = flags.project === 'global' ? 'global' : await resolveProjectId(ctx, flags.project);
        const params: DefinitionListParams = compact({
          projectId,
          status: flags.status,
          q: flags.search,
          includeArchived: flags.archived,
        });
        // The tag filter is client-side, so `--limit` is applied after it:
        // "this many matching rows", not "this many rows, some then dropped".
        let rows = await listDefinitions(ctx, flags.tag ? params : { ...params, ...compact({ limit: flags.limit }) });
        if (flags.tag) rows = rows.filter((row) => row.tags.includes(flags.tag!));
        if (flags.limit) rows = rows.slice(0, flags.limit);
        return list(rows);
      },
    }),

    defineCommand({
      id: 'workflow.show',
      group: 'workflow',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a definition: status, revision and its graph',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        return record(await ctx.api.definitions.get(target.id));
      },
    }),

    defineCommand({
      id: 'workflow.create',
      group: 'workflow',
      verb: 'create',
      aliases: ['new'],
      summary: 'Create a draft from a workflow document, or an empty one with --name',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai wf create review.workflow.json',
        'generatorai wf create --name "Nightly e2e" --project web',
        'generatorai wf create review.workflow.json --publish',
      ],
      args: [{ name: 'file', description: 'WorkflowGraph JSON file, or - for stdin', required: false, completes: 'file' }],
      flags: [
        { name: 'name', description: 'Workflow name (overrides the document)', type: 'string' },
        { name: 'description', short: 'd', description: 'Description', type: 'string' },
        projectFlag,
        { name: 'tags', description: 'Comma-separated tags (replaces)', type: 'string' },
        { name: 'publish', description: 'Publish it right after creating it', type: 'boolean' },
      ],
      schema: inputSchema(
        { file: z.string().optional() },
        {
          name: z.string().optional(),
          description: z.string().optional(),
          project: z.string().optional(),
          tags: z.string().optional(),
          publish: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Created workflow {id}' },
      async handler(ctx, { args, flags }) {
        if (!args.file && !flags.name) {
          throw CliError.usage('Pass a workflow document file, or --name for an empty draft.');
        }
        const base: WorkflowGraphInput = args.file
          ? asGraph(await readDocument(args.file), args.file)
          : { formatVersion: 2, workflow: { name: flags.name! }, stages: [], edges: [] };
        const graph = withSettings(base, {
          name: flags.name,
          description: flags.description,
          tags: parseList(flags.tags),
          projectId: await resolveProjectId(ctx, flags.project),
        });
        const warnings = assertValidGraph(graph, 'The workflow document is not valid');
        const created = await ctx.api.definitions.create(graph);
        if (!flags.publish) {
          return { data: created, warnings, message: `Created draft ${created.id}` };
        }
        const published = await ctx.api.definitions.publish(created.id);
        return { data: published, warnings, message: `Created and published ${published.id}` };
      },
    }),

    defineCommand({
      id: 'workflow.import',
      group: 'workflow',
      verb: 'import',
      summary: 'Import a canonical workflow document, or instantiate a template',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai wf import exported.json --publish',
        'generatorai wf import --template code-review --name "Review PRs"',
      ],
      args: [{ name: 'file', description: 'Canonical document (JSON), or - for stdin', required: false, completes: 'file' }],
      flags: [
        { name: 'template', description: 'Template id instead of a file', type: 'string', completes: 'template' },
        { name: 'name', description: 'Name of the new definition', type: 'string' },
        projectFlag,
        { name: 'publish', description: 'Publish it on import', type: 'boolean' },
      ],
      schema: inputSchema(
        { file: z.string().optional() },
        {
          template: z.string().optional(),
          name: z.string().optional(),
          project: z.string().optional(),
          publish: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Imported workflow {id}' },
      async handler(ctx, { args, flags }) {
        if (Boolean(args.file) === Boolean(flags.template)) {
          throw CliError.usage('Pass exactly one of a document file or --template <id>.');
        }
        const projectId = await resolveProjectId(ctx, flags.project);
        if (flags.template) {
          return record(
            await ctx.api.definitions.importTemplate(
              flags.template,
              compact({ name: flags.name, projectId, publish: flags.publish }),
            ),
          );
        }
        const graph = withSettings(asGraph(await readDocument(args.file!), args.file!), {
          name: flags.name,
          projectId,
        });
        const warnings = assertValidGraph(graph, 'The workflow document is not valid');
        const imported = await ctx.api.definitions.import(graph, compact({ publish: flags.publish }));
        return { data: imported, warnings };
      },
    }),

    defineCommand({
      id: 'workflow.export',
      group: 'workflow',
      verb: 'export',
      summary: 'The canonical document (import gives it back unchanged)',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [{ name: 'out', short: 'o', description: 'Write to a file instead of stdout', type: 'string' }],
      schema: inputSchema({ workflow: z.string() }, { out: z.string().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findDefinition(ctx, args.workflow);
        const text = await ctx.api.definitions.export(target.id);
        if (!flags.out) return record(text);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text, 'utf8');
        return record({ path: file }, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'workflow.validate',
      group: 'workflow',
      verb: 'validate',
      summary: 'Validate a document file, or a stored definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: ['generatorai wf validate review.workflow.json', 'generatorai wf validate nightly-e2e'],
      args: [{ name: 'target', description: 'Document file (or - for stdin), or a workflow reference', required: true, completes: 'workflow' }],
      flags: [],
      schema: inputSchema({ target: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        let document: unknown;
        let details: Record<string, unknown>;
        if (await isFile(args.target)) {
          document = await readDocument(args.target);
          details = { file: args.target };
        } else {
          const target = await findDefinition(ctx, args.target);
          document = (await ctx.api.definitions.get(target.id)).graph;
          details = { workflowId: target.id };
        }
        const result = await ctx.api.definitions.validate(document);
        if (!result.valid) throw invalidError('Workflow is not valid', result.issues, details);
        return {
          data: { valid: true, issues: result.issues },
          warnings: result.issues.map(formatIssue),
          message: 'Workflow is valid.',
        };
      },
    }),

    defineCommand({
      id: 'workflow.publish',
      group: 'workflow',
      verb: 'publish',
      summary: 'Publish the working graph as a new version (runs use the latest)',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const published = await ctx.api.definitions.publish(target.id);
        return record(published, `Published ${published.graph.workflow.name} (version ${published.currentVersionId}).`);
      },
    }),

    defineCommand({
      id: 'workflow.versions',
      group: 'workflow',
      verb: 'versions',
      summary: 'Published and test versions of a definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'version', header: 'Ver', format: 'number', priority: 0 },
          { key: 'kind', header: 'Kind', priority: 0 },
          idColumn,
          { key: 'contentHash', header: 'Hash', format: 'id', priority: 3 },
          createdColumn,
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        return list(await ctx.api.definitions.versions(target.id));
      },
    }),

    defineCommand({
      id: 'workflow.update',
      group: 'workflow',
      verb: 'update',
      summary: "Change a definition's name, description or tags",
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'description', description: 'New description ("" clears it)', type: 'string' },
        { name: 'tags', description: 'Comma-separated tags (replaces)', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          name: z.string().optional(),
          description: z.string().optional(),
          tags: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        if (flags.name === undefined && flags.description === undefined && flags.tags === undefined) {
          throw CliError.usage('Nothing to update.', { hint: 'Pass at least one of --name, --description or --tags.' });
        }
        const target = await findDefinition(ctx, args.workflow);
        const { record: saved, warnings } = await editGraph(ctx, target.id, (graph) => {
          if (flags.name !== undefined) graph.workflow.name = flags.name;
          if (flags.description !== undefined) graph.workflow.description = flags.description || undefined;
          if (flags.tags !== undefined) graph.workflow.tags = parseList(flags.tags) ?? [];
        });
        return { data: saved, warnings };
      },
    }),

    defineCommand({
      id: 'workflow.clone',
      group: 'workflow',
      verb: 'clone',
      summary: 'Copy a definition into a new draft',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, { name: 'name', description: 'Name for the copy', required: false }],
      flags: [],
      schema: inputSchema({ workflow: z.string(), name: z.string().optional() }, {}),
      output: { kind: 'record', successMessage: 'Cloned to {id}' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { graph } = await ctx.api.definitions.get(target.id);
        return record(
          await ctx.api.definitions.create(
            withSettings(graph, { name: args.name ?? `${graph.workflow.name} (copy)` }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'workflow.delete',
      group: 'workflow',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a definition (archived instead when runs pin it)',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const outcome = await ctx.api.definitions.remove(target.id);
        return record(
          outcome,
          'archived' in outcome
            ? `Archived workflow ${target.name} — ${outcome.runs} run(s) pin it, so it was not deleted.`
            : `Deleted workflow ${target.name}.`,
        );
      },
    }),

    // ── Stages ────────────────────────────────────────────────────
    defineCommand({
      id: 'workflow.stage.list',
      group: 'workflow',
      verb: 'stage list',
      summary: 'Stages in a definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'key', header: 'Key', priority: 0 },
          nameColumn,
          { key: 'prompts', header: 'Prompts', format: 'number', priority: 3 },
          { key: 'model', header: 'Model', priority: 2 },
          { key: 'agent', header: 'Agent', priority: 3 },
          { key: 'guard', header: 'Guard', priority: 4 },
          { key: 'approval', header: 'Review', format: 'boolean', priority: 4 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { graph } = await ctx.api.definitions.get(target.id);
        return list(graph.stages.map(stageRow));
      },
    }),

    defineCommand({
      id: 'workflow.stage.add',
      group: 'workflow',
      verb: 'stage add',
      summary: 'Add an agent stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: ['generatorai wf stage add my-wf --name "Write tests" --prompt "Add tests for {{ variables.module }}"'],
      args: [workflowArg],
      flags: [
        { name: 'name', description: 'Stage name', type: 'string', required: true },
        { name: 'key', description: 'Stage key (lower snake case; derived from the name when omitted)', type: 'string' },
        ...STAGE_FIELD_FLAGS,
      ],
      schema: inputSchema({ workflow: z.string() }, { name: z.string().min(1), key: z.string().optional(), ...stageFieldSchema }),
      output: { kind: 'record', successMessage: 'Added stage {key}' },
      async handler(ctx, { args, flags }) {
        if (flags.key !== undefined && !STAGE_KEY_PATTERN.test(flags.key)) {
          throw CliError.usage(`"${flags.key}" is not a stage key.`, {
            hint: 'Keys are lower snake case: a letter, then letters, digits or _ (at most 48).',
          });
        }
        const target = await findDefinition(ctx, args.workflow);
        const prompt = await promptText(flags);
        const { result: stage, warnings } = await editGraph(ctx, target.id, (graph) => {
          const taken = new Set(graph.stages.map((s) => s.key));
          const key = flags.key ?? deriveStageKey(flags.name, taken);
          if (taken.has(key)) {
            throw new CliError('CONFLICT', `This workflow already has a stage with key "${key}".`, {
              hint: 'Pass another --key.',
            });
          }
          const added: StageInput = { kind: 'agent', key, name: flags.name };
          graph.stages.push(added);
          applyStageFields(graph, added, flags, prompt);
          return added;
        });
        return { data: stageRow(stage), warnings };
      },
    }),

    defineCommand({
      id: 'workflow.stage.update',
      group: 'workflow',
      verb: 'stage update',
      summary: 'Change a stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, stageArg],
      flags: [{ name: 'name', description: 'New name', type: 'string' }, ...STAGE_FIELD_FLAGS],
      schema: inputSchema({ workflow: z.string(), stage: z.string() }, { name: z.string().optional(), ...stageFieldSchema }),
      output: { kind: 'record', successMessage: 'Updated stage {key}' },
      async handler(ctx, { args, flags }) {
        if (flags.name === undefined && !hasStageFields(flags)) {
          throw CliError.usage('Nothing to update.', { hint: 'Pass at least one field to change.' });
        }
        const target = await findDefinition(ctx, args.workflow);
        const prompt = await promptText(flags);
        const { result: stage, warnings } = await editGraph(ctx, target.id, (graph) => {
          const changed = stageAt(graph, findStageKey(graph, args.stage));
          if (flags.name) changed.name = flags.name;
          applyStageFields(graph, changed, flags, prompt);
          return changed;
        });
        return { data: stageRow(stage), warnings };
      },
    }),

    defineCommand({
      id: 'workflow.stage.remove',
      group: 'workflow',
      verb: 'stage remove',
      aliases: ['stage rm'],
      summary: 'Remove a stage, its edges and references to it as a context source',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, stageArg],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { result: removed, warnings } = await editGraph(ctx, target.id, (graph) => {
          const key = findStageKey(graph, args.stage);
          const stage = stageAt(graph, key);
          graph.stages = graph.stages.filter((s) => s.key !== key);
          graph.edges = (graph.edges ?? []).filter((e) => e.from !== key && e.to !== key);
          for (const other of graph.stages) {
            if (!other.context?.from?.includes(key)) continue;
            const from = other.context.from.filter((k) => k !== key);
            // An emptied list falls back to the direct predecessors rather
            // than silently becoming "no context" (that is `--context-mode none`).
            other.context = { ...other.context, from };
            if (from.length === 0) delete other.context.from;
          }
          return stage;
        });
        return { data: null, warnings, message: `Removed stage ${removed.key} (${removed.name}).` };
      },
    }),

    // ── Stage hooks ───────────────────────────────────────────────
    //
    // The hook array is too structured for flat flags to express as a
    // whole; one hook at a time is exactly the right grain.

    defineCommand({
      id: 'workflow.stage.hook.list',
      group: 'workflow',
      verb: 'stage hook list',
      summary: "A stage's lifecycle hooks",
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, stageArg],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          { key: 'phase', header: 'Phase', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'failurePolicy', header: 'On failure', priority: 2 },
          { key: 'priority', header: 'Priority', format: 'number', priority: 3 },
          { key: 'enabled', header: 'On', format: 'boolean', priority: 1 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { graph } = await ctx.api.definitions.get(target.id);
        return list(stageAt(graph, findStageKey(graph, args.stage)).hooks ?? []);
      },
    }),

    defineCommand({
      id: 'workflow.stage.hook.add',
      group: 'workflow',
      verb: 'stage hook add',
      summary: 'Attach a lifecycle hook to a stage',
      description:
        '--config is the hook-type-specific config object: {"command":"...","args":[...]} for script, ' +
        '{"url":"...","method":"POST"} for http, {"modulePath":"..."} or {"handlerName":"..."} for function. ' +
        'Script and function hooks need the admin:settings scope.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, stageArg],
      flags: [
        { name: 'name', description: 'Hook name', type: 'string', required: true },
        { name: 'phase', description: 'When it runs', type: 'string', choices: STAGE_HOOK_PHASES, required: true },
        { name: 'type', description: 'Hook type', type: 'string', choices: HOOK_TYPES, required: true },
        { name: 'config', description: 'JSON config object for --type', type: 'string', required: true },
        { name: 'priority', description: 'Higher runs first within a phase', type: 'number', default: 0 },
        { name: 'timeoutMs', description: 'Timeout in milliseconds', type: 'number', default: 30000 },
        { name: 'retries', description: 'Retries after a failed execution (0-5)', type: 'number', default: 0 },
        { name: 'failurePolicy', description: 'What a failure does to the stage', type: 'string', choices: HOOK_FAILURE_POLICIES, default: 'skip' },
        { name: 'disabled', description: 'Attach it switched off', type: 'boolean' },
      ],
      schema: inputSchema(
        { workflow: z.string(), stage: z.string() },
        {
          name: z.string().min(1),
          phase: z.enum(STAGE_HOOK_PHASES),
          type: z.enum(HOOK_TYPES),
          config: z.string(),
          priority: z.coerce.number().int().default(0),
          timeoutMs: z.coerce.number().int().positive().default(30000),
          retries: z.coerce.number().int().min(0).max(5).default(0),
          failurePolicy: z.enum(HOOK_FAILURE_POLICIES).default('skip'),
          disabled: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Attached hook {name}' },
      async handler(ctx, { args, flags }) {
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(flags.config) as Record<string, unknown>;
        } catch (error) {
          throw new CliError('VALIDATION', '--config is not valid JSON.', {
            hint: error instanceof Error ? error.message : String(error),
          });
        }
        if (typeof config['type'] === 'string' && config['type'] !== flags.type) {
          throw new CliError(
            'VALIDATION',
            `--config's "type" ("${String(config['type'])}") does not match --type ("${flags.type}").`,
            { hint: 'Drop "type" from --config\'s JSON, or make it match --type.' },
          );
        }
        const parsed = HookDefinitionSchema.safeParse({
          id: `${flags.phase}-${flags.name}`,
          name: flags.name,
          phase: flags.phase,
          type: flags.type,
          priority: flags.priority,
          enabled: !flags.disabled,
          failurePolicy: flags.failurePolicy,
          timeoutMs: flags.timeoutMs,
          retries: flags.retries,
          config: { ...config, type: flags.type },
        });
        // Checked against the same schema the server validates with, so a
        // missing `method` or `command` names the field, not a raw 422.
        if (!parsed.success) {
          throw new CliError('VALIDATION', `--config is not a valid ${flags.type} hook config.`, {
            hint: parsed.error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; '),
          });
        }
        const hook: HookDefinition = parsed.data;

        const target = await findDefinition(ctx, args.workflow);
        const { warnings } = await editGraph(ctx, target.id, (graph) => {
          const stage = stageAt(graph, findStageKey(graph, args.stage));
          const existing = stage.hooks ?? [];
          if (existing.some((h) => h.name === flags.name)) {
            throw new CliError('CONFLICT', `This stage already has a hook named "${flags.name}".`, {
              hint: 'Remove it first, or pick another name.',
            });
          }
          stage.hooks = [...existing, hook];
        });
        return { data: hook, warnings };
      },
    }),

    defineCommand({
      id: 'workflow.stage.hook.remove',
      group: 'workflow',
      verb: 'stage hook remove',
      aliases: ['stage hook rm'],
      summary: 'Detach a lifecycle hook from a stage',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [workflowArg, stageArg, { name: 'hook', description: 'Hook id or name', required: true }],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string(), hook: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Detached.' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { result: removed, warnings } = await editGraph(ctx, target.id, (graph) => {
          const stage = stageAt(graph, findStageKey(graph, args.stage));
          const existing = stage.hooks ?? [];
          const hook = resolveRef(args.hook, { kind: 'hook', candidates: existing });
          stage.hooks = existing.filter((h) => h.id !== hook.id);
          return hook;
        });
        return { data: null, warnings, message: `Detached hook ${removed.name}.` };
      },
    }),

    // ── Edges ─────────────────────────────────────────────────────
    defineCommand({
      id: 'workflow.edge.list',
      group: 'workflow',
      verb: 'edge list',
      summary: 'Edges in a definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'from', header: 'From', priority: 0 },
          { key: 'to', header: 'To', priority: 0 },
          { key: 'on', header: 'On', priority: 0 },
          { key: 'when', header: 'When', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const { graph } = await ctx.api.definitions.get(target.id);
        return list(graph.edges);
      },
    }),

    defineCommand({
      id: 'workflow.edge.add',
      group: 'workflow',
      verb: 'edge add',
      summary: 'Connect two stages',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai wf edge add my-wf --from plan --to build',
        'generatorai wf edge add my-wf --from review --to fix --on success --when "stages.review.output.approved == false"',
      ],
      args: [workflowArg],
      flags: [
        { name: 'from', description: 'Source stage key or name', type: 'string', required: true, completes: 'stage' },
        { name: 'to', description: 'Target stage key or name', type: 'string', required: true, completes: 'stage' },
        { name: 'on', description: 'Source outcome that activates the edge', type: 'string', choices: EDGE_ON_VALUES, default: 'success' },
        { name: 'when', description: 'Expression; false makes the edge inactive', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          from: z.string(),
          to: z.string(),
          on: z.enum(EDGE_ON_VALUES).default('success'),
          when: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Connected {from} → {to}' },
      async handler(ctx, { args, flags }) {
        const target = await findDefinition(ctx, args.workflow);
        const { result: edge, warnings } = await editGraph(ctx, target.id, (graph) => {
          const from = findStageKey(graph, flags.from);
          const to = findStageKey(graph, flags.to);
          if (from === to) throw CliError.usage('An edge cannot connect a stage to itself.');
          const edges = graph.edges ?? [];
          if (edges.some((e) => e.from === from && e.to === to)) {
            throw new CliError('CONFLICT', `${from} → ${to} is already connected (one edge per pair).`, {
              hint: 'Remove it first to change how it is activated.',
            });
          }
          const added: EdgeInput = { from, to, on: flags.on, ...(flags.when ? { when: flags.when } : {}) };
          graph.edges = [...edges, added];
          return added;
        });
        return { data: edge, warnings };
      },
    }),

    defineCommand({
      id: 'workflow.edge.remove',
      group: 'workflow',
      verb: 'edge remove',
      aliases: ['edge rm'],
      summary: 'Disconnect two stages',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [workflowArg],
      flags: [
        { name: 'from', description: 'Source stage key or name', type: 'string', required: true, completes: 'stage' },
        { name: 'to', description: 'Target stage key or name', type: 'string', required: true, completes: 'stage' },
        { name: 'on', description: 'Only when the edge has this outcome', type: 'string', choices: EDGE_ON_VALUES },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        { from: z.string(), to: z.string(), on: z.enum(EDGE_ON_VALUES).optional() },
      ),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(ctx, { args, flags }) {
        const target = await findDefinition(ctx, args.workflow);
        const { result: removed, warnings } = await editGraph(ctx, target.id, (graph) => {
          const from = findStageKey(graph, flags.from);
          const to = findStageKey(graph, flags.to);
          const edges = graph.edges ?? [];
          const edge = edges.find((e) => e.from === from && e.to === to && (!flags.on || (e.on ?? 'success') === flags.on));
          if (!edge) throw CliError.notFound('edge', `${from} → ${to}${flags.on ? ` on ${flags.on}` : ''}`);
          graph.edges = edges.filter((e) => e !== edge);
          return edge;
        });
        return { data: null, warnings, message: `Removed edge ${removed.from} → ${removed.to}.` };
      },
    }),
  ];
}
