// `generatorai workflow …` — DAG definitions, stages and edges.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { HookDefinitionSchema, type HookDefinition } from '@generatorai/shared';
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
  ok,
  parseList,
  projectFlag,
  readTextFile,
  record,
  requireSomeUpdate,
} from './_shared.js';

export const WORKFLOW_GROUP = {
  name: 'workflow',
  aliases: ['wf'],
  summary: 'Workflow definitions: stages, edges, variables and validation',
  order: 20,
};

const EDGE_TYPES = ['on_success', 'on_failure', 'on_completion', 'always'] as const;
const SESSION_MODES = ['isolated', 'shared', 'continue'] as const;
/** `StageCondition['type']` (`packages/shared/src/types/StageDefinition.ts`). */
const CONDITION_TYPES = ['always', 'on_success', 'on_failure', 'expression'] as const;
/**
 * Read off the server's own schema rather than retyped here: a hand-written
 * list drifts the moment a phase is added, and a phase this CLI does not
 * offer is one no terminal user can ever attach a hook to. `.options` is
 * zod's own enum member array, so this list is the route's list by
 * construction.
 */
const HOOK_PHASES = HookDefinitionSchema.shape.phase.options;
const HOOK_TYPES = ['script', 'http', 'function'] as const;
const HOOK_FAILURE_POLICIES = ['abort', 'skip', 'continue'] as const;

/**
 * `--var name=value` pairs → the `variables` record the stage schema takes
 * (`CreateStageSchema.variables: z.record(z.unknown())`).
 *
 * A value that parses as JSON is stored as JSON (`--var retries=3` is the
 * number 3, `--var opts={"a":1}` an object); anything else is stored as the
 * literal string. Without this every variable would be a string, and a
 * workflow expression comparing one to a number would silently never match.
 */
function parseVariablePairs(pairs: string[] | undefined): Record<string, unknown> | undefined {
  if (!pairs?.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      throw CliError.usage(`--var expects name=value, got "${pair}".`);
    }
    const name = pair.slice(0, at).trim();
    const raw = pair.slice(at + 1);
    try {
      out[name] = JSON.parse(raw) as unknown;
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * `--condition`/`--condition-expression` → the `StageCondition` the stage
 * schema takes. `expression` without an expression is refused rather than
 * sent as a condition that can never evaluate.
 */
function buildCondition(
  type: (typeof CONDITION_TYPES)[number] | undefined,
  expression: string | undefined,
): { type: (typeof CONDITION_TYPES)[number]; expression?: string } | undefined {
  if (!type) {
    if (expression) {
      throw CliError.usage('--condition-expression needs --condition expression.');
    }
    return undefined;
  }
  if (type === 'expression' && !expression) {
    throw CliError.usage('--condition expression needs --condition-expression.');
  }
  return { type, ...(expression ? { expression } : {}) };
}

/** The stage a `--stage`-style reference names, with its current stored shape. */
async function findStageFull(
  ctx: CliContext,
  defId: string,
  ref: string,
): Promise<Record<string, unknown> & { id: string; name?: string }> {
  const full = (await ctx.api.definitions.get(defId)) as unknown as {
    stages?: Array<Record<string, unknown> & { id: string; name?: string }>;
  };
  const matched = resolveRef(ref, { kind: 'stage', candidates: full.stages ?? [] });
  return (full.stages ?? []).find((s) => s.id === matched.id) ?? matched;
}

async function findDefinition(ctx: CliContext, ref: string) {
  const definitions = await ctx.api.definitions.list();
  return resolveRef(ref, { kind: 'workflow', candidates: definitions });
}

async function findStageDef(ctx: CliContext, defId: string, ref: string) {
  const full = (await ctx.api.definitions.get(defId)) as unknown as {
    stages?: Array<{ id: string; name?: string }>;
  };
  return resolveRef(ref, { kind: 'stage', candidates: full.stages ?? [] });
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
        projectFlag,
        { name: 'tag', description: 'Filter by tag', type: 'string' },
        // Every other list command takes `--limit`; this one did not, so a
        // workspace with hundreds of definitions had no way to ask for a
        // readable page of them from the terminal.
        { name: 'limit', description: 'Maximum rows', type: 'number' },
      ],
      schema: inputSchema(
        {},
        {
          project: z.string().optional(),
          tag: z.string().optional(),
          limit: z.coerce.number().int().positive().optional(),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          { key: 'version', header: 'Ver', format: 'number', priority: 3 },
          { key: 'sessionMode', header: 'Session', priority: 2 },
          { key: 'tags', header: 'Tags', format: 'list', priority: 4 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        let rows = await ctx.api.definitions.list(projectId);
        if (flags.tag) {
          rows = rows.filter((d) =>
            ((d as unknown as { tags?: string[] }).tags ?? []).includes(flags.tag!),
          );
        }
        // Applied AFTER the tag filter so `--limit` means "this many matching
        // rows", not "this many rows, some of which are then filtered away".
        if (flags.limit) rows = rows.slice(0, flags.limit);
        return list(rows);
      },
    }),

    defineCommand({
      id: 'workflow.show',
      group: 'workflow',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a definition with its stages and edges',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
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
      summary: 'Create an empty workflow definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'name', description: 'Workflow name', required: true }],
      flags: [
        { name: 'description', short: 'd', description: 'Description', type: 'string' },
        {
          name: 'sessionMode',
          description: 'How stages share harness sessions',
          type: 'string',
          choices: SESSION_MODES,
        },
        projectFlag,
        { name: 'tags', description: 'Comma-separated tags', type: 'string' },
      ],
      schema: inputSchema(
        { name: z.string().min(1) },
        {
          description: z.string().optional(),
          sessionMode: z.enum(SESSION_MODES).optional(),
          project: z.string().optional(),
          tags: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Created workflow {id}' },
      async handler(ctx, { args, flags }) {
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        return record(
          await ctx.api.definitions.create(
            compact({
              name: args.name,
              description: flags.description,
              sessionMode: flags.sessionMode,
              projectId,
              tags: parseList(flags.tags),
            }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'workflow.update',
      group: 'workflow',
      verb: 'update',
      summary: 'Patch a definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'description', description: 'New description', type: 'string' },
        { name: 'sessionMode', description: 'Session mode', type: 'string', choices: SESSION_MODES },
        { name: 'tags', description: 'Comma-separated tags (replaces)', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          name: z.string().optional(),
          description: z.string().optional(),
          sessionMode: z.enum(SESSION_MODES).optional(),
          tags: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findDefinition(ctx, args.workflow);
        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            description: flags.description,
            sessionMode: flags.sessionMode,
            tags: parseList(flags.tags),
          }),
          'Pass at least one of --name, --description, --session-mode or --tags.',
        );
        return record(await ctx.api.definitions.update(target.id, body));
      },
    }),

    defineCommand({
      id: 'workflow.delete',
      group: 'workflow',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a definition',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        await ctx.api.definitions.remove(target.id);
        return ok(`Deleted workflow ${target.name ?? target.id}.`);
      },
    }),

    defineCommand({
      id: 'workflow.validate',
      group: 'workflow',
      verb: 'validate',
      summary: 'Check a definition for cycles, orphans and bad references',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const result = await ctx.api.definitions.validate(target.id);
        if (!result.valid) {
          throw new CliError(
            'VALIDATION',
            `Workflow is not valid:\n${(result.errors ?? []).map((e) => `  ${e}`).join('\n')}`,
            {
              // `issues` names the stage/edge each error belongs to — the
              // whole point of this being machine-readable, and what the
              // TUI's validation navigation reads. `--json` surfaces
              // `details`, so a scripted caller gets the same structure.
              details: {
                workflowId: target.id,
                ...(result.issues ? { issues: result.issues } : {}),
              },
            },
          );
        }
        return {
          data: result,
          warnings: result.warnings ?? [],
          message: 'Workflow is valid.',
        };
      },
    }),

    defineCommand({
      id: 'workflow.export',
      group: 'workflow',
      verb: 'export',
      summary: 'Export a definition as JSON',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [{ name: 'out', short: 'o', description: 'Write to a file instead of stdout', type: 'string' }],
      schema: inputSchema({ workflow: z.string() }, { out: z.string().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findDefinition(ctx, args.workflow);
        const exported = await ctx.api.definitions.export(target.id);
        const text = `${JSON.stringify(exported, null, 2)}\n`;
        if (!flags.out) return record(text);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text, 'utf8');
        return record({ path: file }, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'workflow.importJson',
      group: 'workflow',
      verb: 'import-json',
      summary: 'Import a definition from a JSON file',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'file', description: 'Path to the JSON file, or - for stdin', required: true, completes: 'file' }],
      flags: [{ name: 'name', description: 'Override the imported name', type: 'string' }],
      schema: inputSchema({ file: z.string() }, { name: z.string().optional() }),
      output: { kind: 'record', successMessage: 'Imported workflow {id}' },
      async handler(ctx, { args, flags }) {
        const raw =
          args.file === '-'
            ? await readAll(process.stdin)
            : await readTextFile(path.resolve(args.file), 'JSON file');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new CliError('VALIDATION', `${args.file} is not valid JSON.`, {
            hint: error instanceof Error ? error.message : String(error),
          });
        }
        if (flags.name && typeof parsed === 'object' && parsed !== null) {
          (parsed as Record<string, unknown>)['name'] = flags.name;
        }
        return record(await ctx.api.definitions.importJson(parsed));
      },
    }),

    defineCommand({
      id: 'workflow.fromTemplate',
      group: 'workflow',
      verb: 'from-template',
      aliases: ['import-template'],
      deprecates: ['workflow import-template', 'wf import-template'],
      summary: 'Create a definition from a system template',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'template', description: 'Template id', required: true, completes: 'template' }],
      flags: [{ name: 'name', description: 'Name for the new workflow', type: 'string' }],
      schema: inputSchema({ template: z.string() }, { name: z.string().optional() }),
      output: { kind: 'record', successMessage: 'Created workflow {id}' },
      async handler(ctx, { args, flags }) {
        return record(await ctx.api.definitions.importTemplate(args.template, flags.name));
      },
    }),

    defineCommand({
      id: 'workflow.clone',
      group: 'workflow',
      verb: 'clone',
      summary: 'Copy a definition, stages and edges included',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'name', description: 'Name for the copy', required: false },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), name: z.string().optional() }, {}),
      output: { kind: 'record', successMessage: 'Cloned to {id}' },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        // Round-tripping through export/import reuses the server's own
        // deep-copy semantics, so a clone cannot drift from an import.
        const exported = (await ctx.api.definitions.export(target.id)) as Record<string, unknown>;
        exported['name'] = args.name ?? `${String(exported['name'] ?? target.name)} (copy)`;
        delete exported['id'];
        return record(await ctx.api.definitions.importJson(exported));
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
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: {
        kind: 'list',
        itemsAt: 'stages',
        columns: [
          idColumn,
          nameColumn,
          { key: 'order', header: 'Order', format: 'number', priority: 2 },
          // The model override lives at `harnessConfigOverrides.model` — the
          // flat `model` key this used to read does not exist on a stage, so
          // the column rendered "—" even for stages that had one set.
          { key: 'harnessConfigOverrides.model', header: 'Model', priority: 3 },
          { key: 'agentRef', header: 'Agent', priority: 4 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const full = (await ctx.api.definitions.get(target.id)) as unknown as {
          stages?: Array<Record<string, unknown>>;
        };
        return list(full.stages ?? []);
      },
    }),

    defineCommand({
      id: 'workflow.stage.add',
      group: 'workflow',
      verb: 'stage add',
      summary: 'Add a stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [
        { name: 'name', description: 'Stage name', type: 'string', required: true },
        { name: 'prompt', description: 'Prompt text', type: 'string' },
        { name: 'promptFile', description: 'Read the prompt from a file', type: 'string', completes: 'file' },
        { name: 'model', description: 'Model override', type: 'string', completes: 'model' },
        { name: 'agent', description: 'Agent reference', type: 'string', completes: 'agent' },
        { name: 'order', description: 'Display order', type: 'number' },
        { name: 'timeout', description: 'Timeout in seconds', type: 'number' },
        { name: 'retries', description: 'Retry attempts on failure (0-10)', type: 'number' },
        { name: 'var', description: 'Stage variable as name=value (repeatable)', type: 'string', variadic: true },
        { name: 'condition', description: 'When this stage runs', type: 'string', choices: CONDITION_TYPES },
        { name: 'conditionExpression', description: 'Expression for --condition expression', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          name: z.string().min(1),
          prompt: z.string().optional(),
          promptFile: z.string().optional(),
          model: z.string().optional(),
          agent: z.string().optional(),
          order: z.coerce.number().int().optional(),
          timeout: z.coerce.number().int().positive().optional(),
          retries: z.coerce.number().int().min(0).max(10).optional(),
          var: z.array(z.string()).optional(),
          condition: z.enum(CONDITION_TYPES).optional(),
          conditionExpression: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Added stage {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findDefinition(ctx, args.workflow);
        if (flags.prompt && flags.promptFile) {
          throw CliError.usage('--prompt and --prompt-file are mutually exclusive.');
        }
        const prompt = flags.promptFile
          ? await readTextFile(path.resolve(flags.promptFile), 'prompt file')
          : flags.prompt;
        const condition = buildCondition(flags.condition, flags.conditionExpression);

        // Field names/shapes below are `CreateStageParams`'s exactly. The
        // previous body sent `prompt` (real field is `prompts: PromptDefinition[]`),
        // `model` (real field is nested in `harnessConfigOverrides.model`),
        // `timeoutSeconds` (real field is `timeoutMs`) and `maxRetries` (real
        // field is nested in `retryPolicy.maxRetries`) — `validate()` drops
        // unknown keys, so all four were silently discarded on every call.
        return record(
          await ctx.api.definitions.addStage(
            target.id,
            {
              name: flags.name,
              ...compact({
                agentRef: flags.agent,
                order: flags.order,
                prompts: prompt
                  ? [{ label: 'prompt', text: prompt, source: 'inline' as const, waitForCompletion: true }]
                  : undefined,
                harnessConfigOverrides: flags.model ? { model: flags.model } : undefined,
                timeoutMs: flags.timeout !== undefined ? flags.timeout * 1000 : undefined,
                retryPolicy:
                  flags.retries !== undefined
                    ? { maxRetries: flags.retries, backoffMs: 1000, backoffMultiplier: 2 }
                    : undefined,
                // `variables` and `condition` are real fields on
                // `CreateStageSchema` that this command has never exposed —
                // a stage could only ever be given variables or a run
                // condition through the web UI or a raw API call.
                variables: parseVariablePairs(flags.var),
                condition,
              }),
            },
          ),
        );
      },
    }),

    defineCommand({
      id: 'workflow.stage.update',
      group: 'workflow',
      verb: 'stage update',
      summary: 'Patch a stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'prompt', description: 'New prompt', type: 'string' },
        { name: 'promptFile', description: 'Read the prompt from a file', type: 'string', completes: 'file' },
        { name: 'model', description: 'Model override', type: 'string', completes: 'model' },
        { name: 'agent', description: 'Agent reference', type: 'string', completes: 'agent' },
        { name: 'timeout', description: 'Timeout in seconds', type: 'number' },
        { name: 'retries', description: 'Retry attempts (0-10)', type: 'number' },
        { name: 'var', description: 'Stage variable as name=value (repeatable, merges)', type: 'string', variadic: true },
        { name: 'clearVars', description: 'Remove every variable before applying --var', type: 'boolean' },
        { name: 'condition', description: 'When this stage runs', type: 'string', choices: CONDITION_TYPES },
        { name: 'conditionExpression', description: 'Expression for --condition expression', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string(), stage: z.string() },
        {
          name: z.string().optional(),
          prompt: z.string().optional(),
          promptFile: z.string().optional(),
          model: z.string().optional(),
          agent: z.string().optional(),
          timeout: z.coerce.number().int().positive().optional(),
          retries: z.coerce.number().int().min(0).max(10).optional(),
          var: z.array(z.string()).optional(),
          clearVars: z.boolean().optional(),
          condition: z.enum(CONDITION_TYPES).optional(),
          conditionExpression: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated stage {id}' },
      async handler(ctx, { args, flags }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageFull(ctx, definition.id, args.stage);
        const prompt = flags.promptFile
          ? await readTextFile(path.resolve(flags.promptFile), 'prompt file')
          : flags.prompt;

        // The route PUTs the whole `variables` record, so a partial update
        // has to merge against what the stage already has or every unnamed
        // variable is dropped. `--clear-vars` is the explicit way to ask for
        // the replacing behaviour instead.
        const incoming = parseVariablePairs(flags.var);
        const existing = (stage['variables'] as Record<string, unknown> | undefined) ?? {};
        const variables =
          incoming || flags.clearVars
            ? { ...(flags.clearVars ? {} : existing), ...(incoming ?? {}) }
            : undefined;

        // Same real field names/shapes as `workflow stage add` — see that
        // handler's comment. `updateStage` used to accept a bare
        // `Record<string, unknown>`, so this compiled fine while sending
        // fields the route's schema silently dropped.
        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            agentRef: flags.agent,
            prompts: prompt
              ? [{ label: 'prompt', text: prompt, source: 'inline' as const, waitForCompletion: true }]
              : undefined,
            harnessConfigOverrides: flags.model ? { model: flags.model } : undefined,
            timeoutMs: flags.timeout !== undefined ? flags.timeout * 1000 : undefined,
            retryPolicy:
              flags.retries !== undefined
                ? { maxRetries: flags.retries, backoffMs: 1000, backoffMultiplier: 2 }
                : undefined,
            variables,
            condition: buildCondition(flags.condition, flags.conditionExpression),
          }),
          'Pass at least one field to change.',
        );
        return record(await ctx.api.definitions.updateStage(definition.id, stage.id, body));
      },
    }),

    // ── Stage variables and hooks (Phase 7 item 4) ─────────────────
    //
    // `CreateStageSchema` has accepted `variables` and `hooks` since it
    // existed; no CLI surface ever set either, so the only way to give a
    // stage a variable or a lifecycle hook was the web UI or a raw API
    // call. `--var` above covers writing variables; these read them back and
    // manage the hook array, which is too structured for flat flags to
    // express as a whole (one hook at a time is exactly the right grain).

    defineCommand({
      id: 'workflow.stage.variables',
      group: 'workflow',
      verb: 'stage variables',
      aliases: ['stage vars'],
      summary: "A stage's variables",
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'value', header: 'Value', priority: 0 },
        ],
      },
      async handler(ctx, { args }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageFull(ctx, definition.id, args.stage);
        const variables = (stage['variables'] as Record<string, unknown> | undefined) ?? {};
        return list(
          Object.entries(variables).map(([name, value]) => ({
            name,
            value: typeof value === 'string' ? value : JSON.stringify(value),
          })),
        );
      },
    }),

    defineCommand({
      id: 'workflow.stage.hook.list',
      group: 'workflow',
      verb: 'stage hook list',
      summary: "A stage's lifecycle hooks",
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
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
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageFull(ctx, definition.id, args.stage);
        return list((stage['hooks'] as Array<Record<string, unknown>> | undefined) ?? []);
      },
    }),

    defineCommand({
      id: 'workflow.stage.hook.add',
      group: 'workflow',
      verb: 'stage hook add',
      summary: 'Attach a lifecycle hook to a stage',
      description:
        '--config is the hook-type-specific config object, the same shape `hook test --config` ' +
        'takes: {"command":"...","args":[...]} for script, {"url":"...","method":"POST"} for ' +
        'http, {"modulePath":"..."} or {"handlerName":"..."} for function.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
      flags: [
        { name: 'name', description: 'Hook name', type: 'string', required: true },
        { name: 'phase', description: 'When it runs', type: 'string', choices: HOOK_PHASES, required: true },
        { name: 'type', description: 'Hook type', type: 'string', choices: HOOK_TYPES, required: true },
        { name: 'config', description: 'JSON config object for --type', type: 'string', required: true },
        { name: 'priority', description: 'Execution order among hooks on this phase', type: 'number', default: 0 },
        { name: 'timeout', description: 'Timeout in milliseconds', type: 'number', default: 30000 },
        { name: 'retries', description: 'Retry attempts after the first try', type: 'number', default: 0 },
        { name: 'failurePolicy', description: 'What a failure does to the phase', type: 'string', choices: HOOK_FAILURE_POLICIES, default: 'abort' },
        { name: 'disabled', description: 'Attach it switched off', type: 'boolean' },
      ],
      schema: inputSchema(
        { workflow: z.string(), stage: z.string() },
        {
          name: z.string().min(1),
          phase: z.enum(HOOK_PHASES),
          type: z.enum(HOOK_TYPES),
          config: z.string(),
          priority: z.coerce.number().int().default(0),
          timeout: z.coerce.number().int().positive().default(30000),
          retries: z.coerce.number().int().min(0).max(10).default(0),
          failurePolicy: z.enum(HOOK_FAILURE_POLICIES).default('abort'),
          disabled: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Attached hook {name}' },
      async handler(ctx, { args, flags }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageFull(ctx, definition.id, args.stage);

        let config: Record<string, unknown>;
        try {
          config = JSON.parse(flags.config) as Record<string, unknown>;
        } catch (error) {
          throw new CliError('VALIDATION', '--config is not valid JSON.', {
            hint: error instanceof Error ? error.message : String(error),
          });
        }
        // Same rule `hook test` already enforces: the executor dispatches on
        // `config.type`, so a `--config` naming a different one would run a
        // different hook than at least one of the two flags asked for.
        if (typeof config['type'] === 'string' && config['type'] !== flags.type) {
          throw new CliError(
            'VALIDATION',
            `--config's "type" ("${String(config['type'])}") does not match --type ("${flags.type}").`,
            { hint: 'Drop "type" from --config\'s JSON, or make it match --type.' },
          );
        }

        const existing = (stage['hooks'] as Array<Record<string, unknown>> | undefined) ?? [];
        if (existing.some((hook) => hook['name'] === flags.name)) {
          throw new CliError(
            'CONFLICT',
            `This stage already has a hook named "${flags.name}".`,
            { hint: 'Remove it first, or pick another name.' },
          );
        }

        const hook: HookDefinition = {
          // The route PUTs the whole array, so the id has to be stable and
          // supplied here — there is no per-hook create endpoint to mint one.
          id: `${flags.phase}-${flags.name}`,
          name: flags.name,
          phase: flags.phase,
          type: flags.type,
          priority: flags.priority,
          enabled: !flags.disabled,
          failurePolicy: flags.failurePolicy,
          timeoutMs: flags.timeout,
          retries: flags.retries,
          // Cast, not `as never`: an arbitrary `--config` JSON object cannot
          // be proven to match one of the three config shapes statically, so
          // this names the exact type being trusted — the same treatment
          // `hook test` gives the identical flag.
          config: { ...config, type: flags.type } as HookDefinition['config'],
        };

        // Checked against the SAME schema the route validates with, before
        // sending: an `http` config missing `method`, or a `script` one
        // missing `command`, otherwise comes back as a raw 400 naming a
        // field the user cannot map to the flag they typed.
        const parsed = HookDefinitionSchema.safeParse(hook);
        if (!parsed.success) {
          throw new CliError(
            'VALIDATION',
            `--config is not a valid ${flags.type} hook config.`,
            {
              hint: parsed.error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join('; '),
            },
          );
        }

        await ctx.api.definitions.updateStage(definition.id, stage.id, {
          hooks: [...(existing as unknown as HookDefinition[]), hook],
        });
        return record(hook);
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
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        { name: 'hook', description: 'Hook id or name', required: true },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string(), hook: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Detached.' },
      async handler(ctx, { args }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageFull(ctx, definition.id, args.stage);
        const existing = (stage['hooks'] as Array<Record<string, unknown>> | undefined) ?? [];
        const target = resolveRef(args.hook, {
          kind: 'hook',
          candidates: existing as Array<{ id: string; name?: string }>,
        });
        await ctx.api.definitions.updateStage(definition.id, stage.id, {
          hooks: (existing as unknown as HookDefinition[]).filter((hook) => hook.id !== target.id),
        });
        return ok(`Detached hook ${target.name ?? target.id}.`);
      },
    }),

    defineCommand({
      id: 'workflow.stage.delete',
      group: 'workflow',
      verb: 'stage delete',
      aliases: ['stage rm'],
      summary: 'Delete a stage and its edges',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), stage: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageDef(ctx, definition.id, args.stage);
        await ctx.api.definitions.deleteStage(definition.id, stage.id);
        return ok(`Deleted stage ${stage.name ?? stage.id}.`);
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
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [],
      schema: inputSchema({ workflow: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'fromStageId', header: 'From', format: 'id', priority: 0 },
          { key: 'toStageId', header: 'To', format: 'id', priority: 0 },
          { key: 'edgeType', header: 'On', priority: 0 },
          { key: 'condition', header: 'Condition', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findDefinition(ctx, args.workflow);
        const full = (await ctx.api.definitions.get(target.id)) as unknown as {
          edges?: Array<Record<string, unknown>>;
        };
        return list(full.edges ?? []);
      },
    }),

    defineCommand({
      id: 'workflow.edge.add',
      group: 'workflow',
      verb: 'edge add',
      summary: 'Connect two stages',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: ['generatorai wf edge add my-wf --from plan --to build --on on_success'],
      args: [{ name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' }],
      flags: [
        { name: 'from', description: 'Source stage', type: 'string', required: true, completes: 'stage' },
        { name: 'to', description: 'Target stage', type: 'string', required: true, completes: 'stage' },
        { name: 'on', description: 'Edge type', type: 'string', choices: EDGE_TYPES, default: 'on_success' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          from: z.string(),
          to: z.string(),
          on: z.enum(EDGE_TYPES).default('on_success'),
        },
      ),
      output: { kind: 'record', successMessage: 'Added edge {id}' },
      async handler(ctx, { args, flags }) {
        const definition = await findDefinition(ctx, args.workflow);
        const from = await findStageDef(ctx, definition.id, flags.from);
        const to = await findStageDef(ctx, definition.id, flags.to);
        if (from.id === to.id) {
          throw CliError.usage('An edge cannot connect a stage to itself.');
        }
        // `CreateEdgeParams` has no `condition` field — an edge is only
        // `{fromStageId, toStageId, edgeType}`. Conditional branching is a
        // property of the STAGE (`StageCondition`), not the edge; a
        // previous `--condition` flag here was silently dropped by
        // `validate()` on every call and is not offered any more.
        return record(
          await ctx.api.definitions.addEdge(definition.id, {
            fromStageId: from.id,
            toStageId: to.id,
            edgeType: flags.on,
          }),
        );
      },
    }),

    defineCommand({
      id: 'workflow.edge.delete',
      group: 'workflow',
      verb: 'edge delete',
      aliases: ['edge rm'],
      summary: 'Delete an edge',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'edge', description: 'Edge id', required: true },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), edge: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const definition = await findDefinition(ctx, args.workflow);
        const full = (await ctx.api.definitions.get(definition.id)) as unknown as {
          edges?: Array<{ id: string }>;
        };
        const edge = resolveRef(args.edge, { kind: 'edge', candidates: full.edges ?? [] });
        await ctx.api.definitions.deleteEdge(definition.id, edge.id);
        return ok(`Deleted edge ${edge.id}.`);
      },
    }),
  ];
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
