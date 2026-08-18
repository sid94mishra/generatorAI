// `generatorai workflow …` — DAG definitions, stages and edges.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
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

async function findDefinition(ctx: CliContext, ref: string) {
  const definitions = await ctx.api.definitions.list();
  return resolveRef(ref, { kind: 'workflow', candidates: definitions as never });
}

async function findStageDef(ctx: CliContext, defId: string, ref: string) {
  const full = (await ctx.api.definitions.get(defId)) as unknown as {
    stages?: Array<{ id: string; name?: string }>;
  };
  return resolveRef(ref, { kind: 'stage', candidates: (full.stages ?? []) as never });
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
      flags: [projectFlag, { name: 'tag', description: 'Filter by tag', type: 'string' }],
      schema: inputSchema({}, { project: z.string().optional(), tag: z.string().optional() }),
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
            { details: { workflowId: target.id } },
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
            : await fs.readFile(path.resolve(args.file), 'utf8');
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
          { key: 'model', header: 'Model', priority: 3 },
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
        { name: 'retries', description: 'Retry attempts on failure', type: 'number' },
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
          retries: z.coerce.number().int().min(0).optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Added stage {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findDefinition(ctx, args.workflow);
        if (flags.prompt && flags.promptFile) {
          throw CliError.usage('--prompt and --prompt-file are mutually exclusive.');
        }
        const prompt = flags.promptFile
          ? await fs.readFile(path.resolve(flags.promptFile), 'utf8')
          : flags.prompt;

        return record(
          await ctx.api.definitions.addStage(
            target.id,
            compact({
              name: flags.name,
              prompt,
              model: flags.model,
              agentRef: flags.agent,
              order: flags.order,
              timeoutSeconds: flags.timeout,
              maxRetries: flags.retries,
            }) as never,
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
        { name: 'retries', description: 'Retry attempts', type: 'number' },
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
          retries: z.coerce.number().int().min(0).optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated stage {id}' },
      async handler(ctx, { args, flags }) {
        const definition = await findDefinition(ctx, args.workflow);
        const stage = await findStageDef(ctx, definition.id, args.stage);
        const prompt = flags.promptFile
          ? await fs.readFile(path.resolve(flags.promptFile), 'utf8')
          : flags.prompt;

        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            prompt,
            model: flags.model,
            agentRef: flags.agent,
            timeoutSeconds: flags.timeout,
            maxRetries: flags.retries,
          }),
          'Pass at least one field to change.',
        );
        return record(await ctx.api.definitions.updateStage(definition.id, stage.id, body));
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
        { name: 'condition', description: 'Boolean expression evaluated server-side', type: 'string' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          from: z.string(),
          to: z.string(),
          on: z.enum(EDGE_TYPES).default('on_success'),
          condition: z.string().optional(),
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
        return record(
          await ctx.api.definitions.addEdge(
            definition.id,
            compact({
              fromStageId: from.id,
              toStageId: to.id,
              edgeType: flags.on,
              condition: flags.condition,
            }) as never,
          ),
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
        const edge = resolveRef(args.edge, { kind: 'edge', candidates: (full.edges ?? []) as never });
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
