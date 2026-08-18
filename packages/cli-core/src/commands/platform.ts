// The remaining domains, each small enough that a file per group would be
// more navigation than signal: agents, extensions, widgets, review, source
// control, security, hooks, webhooks, harness, templates, scripts,
// orchestrator, browser and computer use.

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
  projectFlag,
  record,
  statusColumn,
} from './_shared.js';

export const GROUPS = [
  { name: 'agent', summary: 'First-class agent definitions', order: 15 },
  { name: 'script', aliases: ['sc'], summary: 'Programmatic workflow scripts (.workflow.mjs)', order: 60 },
  { name: 'template', summary: 'System workflow templates', order: 61 },
  { name: 'orchestrator', aliases: ['orch'], summary: 'System workflows and orchestrated runs', order: 62 },
  { name: 'extension', aliases: ['ext'], summary: 'Hot-loadable extensions', order: 70 },
  { name: 'widget', summary: 'Agent-rendered widget surfaces', order: 71 },
  { name: 'review', summary: 'Review threads on workspace files', order: 72 },
  { name: 'browser', summary: 'Workspace-scoped Chromium', order: 73 },
  { name: 'computer', summary: 'Computer Use: desktop windows and audit', order: 74 },
  { name: 'hook', summary: 'Lifecycle hooks', order: 80 },
  { name: 'webhook', summary: 'Incoming and outgoing webhooks', order: 81 },
  { name: 'harness', summary: 'AI provider selection', order: 82 },
  { name: 'source-control', aliases: ['scm'], summary: 'Git provider and pull-request configuration', order: 83 },
  { name: 'security', summary: 'Security posture, devices and audit', order: 84 },
];

async function findWorkspace(ctx: CliContext, ref: string) {
  const workspaces = await ctx.api.workspaces.list();
  return resolveRef(ref, {
    kind: 'workspace',
    candidates: workspaces.map((w) => ({
      id: w.id,
      name: `${w.ownerType}:${w.ownerId.slice(0, 8)}`,
      status: w.status,
      createdAt: w.createdAt,
    })),
    activeStatuses: ['active'],
  });
}

// ── Agents ─────────────────────────────────────────────────────────

export function agentCommands(): CommandSpec[] {
  const find = async (ctx: CliContext, ref: string) => {
    const agents = await ctx.api.agents.list();
    return resolveRef(ref, { kind: 'agent', candidates: agents as never });
  };

  return [
    defineCommand({
      id: 'agent.list',
      group: 'agent',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List agents',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'scope', description: 'Filter by scope', type: 'string', choices: ['system', 'project', 'user'] as const },
        projectFlag,
      ],
      schema: inputSchema({}, { scope: z.string().optional(), project: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          { key: 'scope', header: 'Scope', priority: 1 },
          { key: 'role', header: 'Role', priority: 2 },
          { key: 'enabled', header: 'On', format: 'boolean', priority: 0 },
        ],
      },
      async handler(ctx, { flags }) {
        let rows = (await ctx.api.agents.list()) as unknown as Array<Record<string, unknown>>;
        if (flags.scope) rows = rows.filter((a) => a['scope'] === flags.scope);
        return list(rows);
      },
    }),

    defineCommand({
      id: 'agent.show',
      group: 'agent',
      verb: 'show',
      summary: 'Show an agent',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'agent', description: 'Agent reference', required: true, completes: 'agent' }],
      flags: [],
      schema: inputSchema({ agent: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        return record(await find(ctx, args.agent));
      },
    }),

    defineCommand({
      id: 'agent.export',
      group: 'agent',
      verb: 'export',
      summary: 'Export an agent as markdown',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'agent', description: 'Agent reference', required: true, completes: 'agent' }],
      flags: [{ name: 'out', short: 'o', description: 'Write to a file', type: 'string' }],
      schema: inputSchema({ agent: z.string() }, { out: z.string().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await find(ctx, args.agent);
        const exported = await ctx.api.agents.export(target.id);
        const markdown = typeof exported === 'string' ? exported : exported.markdown;
        if (!flags.out) return record(markdown);
        const file = path.resolve(flags.out);
        await fs.writeFile(file, markdown, 'utf8');
        return record({ path: file }, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'agent.import',
      group: 'agent',
      verb: 'import',
      summary: 'Import an agent from a markdown file',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'file', description: 'Markdown file', required: true, completes: 'file' }],
      flags: [
        { name: 'scope', description: 'Target scope', type: 'string', choices: ['system', 'project', 'user'] as const },
        projectFlag,
        { name: 'overwrite', description: 'Replace an existing agent with the same name', type: 'boolean' },
      ],
      schema: inputSchema(
        { file: z.string() },
        { scope: z.string().optional(), project: z.string().optional(), overwrite: z.boolean().optional() },
      ),
      output: { kind: 'record', successMessage: 'Imported agent {id}' },
      async handler(ctx, { args, flags }) {
        const markdown = await fs.readFile(path.resolve(args.file), 'utf8');
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        return record(
          await ctx.api.agents.import(
            compact({ markdown, scope: flags.scope, projectId, overwrite: flags.overwrite }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'agent.usage',
      group: 'agent',
      verb: 'usage',
      summary: 'Chats, stages and workflows bound to an agent',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'agent', description: 'Agent reference', required: true, completes: 'agent' }],
      flags: [],
      schema: inputSchema({ agent: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await find(ctx, args.agent);
        return record(await ctx.api.agents.usage(target.id));
      },
    }),

    defineCommand({
      id: 'agent.resolve',
      group: 'agent',
      verb: 'resolve',
      summary: 'Preview the effective agent after overrides and project config',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'agent', description: 'Agent reference', required: false, completes: 'agent' }],
      flags: [
        { name: 'scope', description: 'Resolution scope', type: 'string', choices: ['chat', 'stage', 'worker'] as const, default: 'chat' },
        projectFlag,
        { name: 'harness', description: 'Provider to resolve against', type: 'string', choices: ['copilot', 'claude-agent'] as const },
      ],
      schema: inputSchema(
        { agent: z.string().optional() },
        {
          scope: z.enum(['chat', 'stage', 'worker']).default('chat'),
          project: z.string().optional(),
          harness: z.string().optional(),
        },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        return record(
          await ctx.api.agents.resolvePreview(
            compact({
              agentRef: args.agent,
              scope: flags.scope,
              projectId,
              harnessType: flags.harness,
            }) as never,
          ),
        );
      },
    }),

    defineCommand({
      id: 'agent.delete',
      group: 'agent',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete an agent',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'agent', description: 'Agent reference', required: true, completes: 'agent' }],
      flags: [{ name: 'force', short: 'f', description: 'Delete even when bound', type: 'boolean' }],
      schema: inputSchema({ agent: z.string() }, { force: z.boolean().optional() }),
      output: { kind: 'record', successMessage: 'Deleted.' },
      async handler(ctx, { args, flags }) {
        const target = await find(ctx, args.agent);
        return record(await ctx.api.agents.remove(target.id, flags.force));
      },
    }),
  ];
}

// ── Scripts / templates / orchestrator ─────────────────────────────

export function scriptCommands(): CommandSpec[] {
  const find = async (ctx: CliContext, ref: string) => {
    const scripts = await ctx.api.scripts.list();
    return resolveRef(ref, { kind: 'script', candidates: scripts as never });
  };

  return [
    defineCommand({
      id: 'script.list',
      group: 'script',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List programmatic workflow scripts',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [idColumn, nameColumn, { key: 'description', header: 'Description', priority: 2 }, { key: 'path', header: 'Path', priority: 4 }],
      },
      async handler(ctx) {
        return list(await ctx.api.scripts.list());
      },
    }),

    defineCommand({
      id: 'script.show',
      group: 'script',
      verb: 'show',
      summary: 'Show a script',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'script', description: 'Script reference', required: true, completes: 'script' }],
      flags: [],
      schema: inputSchema({ script: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await find(ctx, args.script);
        return record(await ctx.api.scripts.get(target.id));
      },
    }),

    defineCommand({
      id: 'script.profiles',
      group: 'script',
      verb: 'profiles',
      summary: 'Profiles a script exposes',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'script', description: 'Script reference', required: true, completes: 'script' }],
      flags: [],
      schema: inputSchema({ script: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [nameColumn, { key: 'description', header: 'Description', priority: 1 }],
      },
      async handler(ctx, { args }) {
        const target = await find(ctx, args.script);
        return list(await ctx.api.scripts.profiles(target.id));
      },
    }),

    defineCommand({
      id: 'script.materialize',
      group: 'script',
      verb: 'materialize',
      summary: 'Turn a script into a concrete workflow definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'script', description: 'Script reference', required: true, completes: 'script' }],
      flags: [{ name: 'profile', description: 'Profile name', type: 'string' }],
      schema: inputSchema({ script: z.string() }, { profile: z.string().optional() }),
      output: { kind: 'record', successMessage: 'Materialized workflow {id}' },
      async handler(ctx, { args, flags }) {
        const target = await find(ctx, args.script);
        return record(
          await ctx.api.scripts.materialize(target.id, compact({ profile: flags.profile })),
        );
      },
    }),

    defineCommand({
      id: 'script.run',
      group: 'script',
      verb: 'run',
      summary: 'Materialize and start a script',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'script', description: 'Script reference', required: true, completes: 'script' }],
      flags: [
        { name: 'profile', description: 'Profile name', type: 'string' },
        { name: 'watch', short: 'w', description: 'Stream until finished', type: 'boolean' },
      ],
      schema: inputSchema(
        { script: z.string() },
        { profile: z.string().optional(), watch: z.boolean().optional() },
      ),
      output: { kind: 'record', successMessage: 'Started run {id}' },
      async handler(ctx, { args, flags }) {
        const target = await find(ctx, args.script);
        const run = await ctx.api.scripts.run(target.id, compact({ profile: flags.profile }));
        if (!flags.watch) return record(run);
        // Delegating to `run watch` keeps one implementation of "follow a run".
        return record(run, `Started run ${run.id} — \`generatorai run watch ${run.id}\``);
      },
    }),

    defineCommand({
      id: 'script.validate',
      group: 'script',
      verb: 'validate',
      summary: 'Validate a script file without registering it',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'file', description: '.workflow.mjs file', required: true, completes: 'file' }],
      flags: [],
      schema: inputSchema({ file: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const source = await fs.readFile(path.resolve(args.file), 'utf8');
        const result = await ctx.api.scripts.validate({ source, name: path.basename(args.file) });
        if (!result.valid) {
          throw new CliError('VALIDATION', `Script is not valid:\n${(result.errors ?? []).map((e) => `  ${e}`).join('\n')}`);
        }
        return record(result, 'Script is valid.');
      },
    }),

    defineCommand({
      id: 'script.reload',
      group: 'script',
      verb: 'reload',
      summary: 'Re-read scripts from disk without restarting the server',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'script', description: 'Script reference; omit for all', required: false, completes: 'script' }],
      flags: [],
      schema: inputSchema({ script: z.string().optional() }, {}),
      output: { kind: 'record', successMessage: 'Reloaded.' },
      async handler(ctx, { args }) {
        if (!args.script) return record(await ctx.api.scripts.reloadAll());
        const target = await find(ctx, args.script);
        return record(await ctx.api.scripts.reload(target.id));
      },
    }),
  ];
}

export function templateCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'template.list',
      group: 'template',
      verb: 'list',
      aliases: ['ls'],
      summary: 'System workflow templates',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [idColumn, nameColumn, { key: 'description', header: 'Description', priority: 2 }],
      },
      async handler(ctx) {
        return list(await ctx.api.templates.list());
      },
    }),

    defineCommand({
      id: 'template.show',
      group: 'template',
      verb: 'show',
      summary: 'Show one template',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'template', description: 'Template id', required: true, completes: 'template' }],
      flags: [],
      schema: inputSchema({ template: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        return record(await ctx.api.templates.get(args.template));
      },
    }),
  ];
}

export function orchestratorCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'orchestrator.templates',
      group: 'orchestrator',
      verb: 'templates',
      summary: 'System workflows available to the orchestrator',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'list', columns: [idColumn, nameColumn, { key: 'description', header: 'Description', priority: 2 }] },
      async handler(ctx) {
        return list(await ctx.api.orchestrator.templates());
      },
    }),

    defineCommand({
      id: 'orchestrator.context',
      group: 'orchestrator',
      verb: 'context',
      summary: 'Orchestrator context for a run',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        return record(await ctx.api.orchestrator.context(args.run));
      },
    }),

    defineCommand({
      id: 'orchestrator.cancel',
      group: 'orchestrator',
      verb: 'cancel',
      summary: 'Cancel an orchestrated run and everything under it',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Cancelled.' },
      async handler(ctx, { args }) {
        await ctx.api.orchestrator.cancel(args.run);
        return ok('Cancelled orchestrated run.');
      },
    }),
  ];
}

// ── Extensions & widgets ───────────────────────────────────────────

export function extensionCommands(): CommandSpec[] {
  const find = async (ctx: CliContext, ref: string) => {
    const extensions = await ctx.api.extensions.list();
    return resolveRef(ref, { kind: 'extension', candidates: extensions as never });
  };

  return [
    defineCommand({
      id: 'extension.list',
      group: 'extension',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Installed extensions',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          { key: 'version', header: 'Version', priority: 2 },
          { key: 'scope', header: 'Scope', priority: 3 },
          { key: 'enabled', header: 'On', format: 'boolean', priority: 0 },
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.extensions.list());
      },
    }),

    defineCommand({
      id: 'extension.show',
      group: 'extension',
      verb: 'show',
      summary: 'Show one extension and what it contributes',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'extension', description: 'Extension reference', required: true, completes: 'extension' }],
      flags: [],
      schema: inputSchema({ extension: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await find(ctx, args.extension);
        return record(await ctx.api.extensions.get(target.id));
      },
    }),

    ...(['enable', 'disable'] as const).map((verb) =>
      defineCommand({
        id: `extension.${verb}`,
        group: 'extension',
        verb,
        summary: `${verb === 'enable' ? 'Enable' : 'Disable'} an extension`,
        requiresServer: true,
        sinceVersion: '0.2.0',
        args: [{ name: 'extension', description: 'Extension reference', required: true, completes: 'extension' }],
        flags: [],
        schema: inputSchema({ extension: z.string() }, {}),
        output: { kind: 'record', successMessage: `Extension {id} ${verb}d.` },
        async handler(ctx, { args }) {
          const target = await find(ctx, args.extension);
          return record(await ctx.api.extensions.update(target.id, { enabled: verb === 'enable' }));
        },
      }),
    ),

    defineCommand({
      id: 'extension.reload',
      group: 'extension',
      verb: 'reload',
      summary: 'Reload extensions from disk',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'extension', description: 'Extension reference; omit for all', required: false, completes: 'extension' }],
      flags: [],
      schema: inputSchema({ extension: z.string().optional() }, {}),
      output: { kind: 'record', successMessage: 'Reloaded.' },
      async handler(ctx, { args }) {
        if (!args.extension) return record(await ctx.api.extensions.reloadAll());
        const target = await find(ctx, args.extension);
        return record(await ctx.api.extensions.reload(target.id));
      },
    }),

    defineCommand({
      id: 'extension.uninstall',
      group: 'extension',
      verb: 'uninstall',
      aliases: ['rm'],
      summary: 'Uninstall an extension',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'extension', description: 'Extension reference', required: true, completes: 'extension' }],
      flags: [],
      schema: inputSchema({ extension: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Uninstalled.' },
      async handler(ctx, { args }) {
        const target = await find(ctx, args.extension);
        await ctx.api.extensions.remove(target.id);
        return ok(`Uninstalled ${target.name ?? target.id}.`);
      },
    }),
  ];
}

export function widgetCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'widget.list',
      group: 'widget',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Open widget surfaces',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'title', header: 'Title', priority: 0 },
          { key: 'surface', header: 'Surface', priority: 1 },
          statusColumn,
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.widgets.list());
      },
    }),

    defineCommand({
      id: 'widget.read',
      group: 'widget',
      verb: 'read',
      aliases: ['show'],
      summary: 'Read a widget and its state',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'widget', description: 'Widget id', required: true, completes: 'widget' }],
      flags: [],
      schema: inputSchema({ widget: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        return record(await ctx.api.widgets.get(args.widget));
      },
    }),

    defineCommand({
      id: 'widget.close',
      group: 'widget',
      verb: 'close',
      summary: 'Tear down a widget',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'widget', description: 'Widget id', required: true, completes: 'widget' }],
      flags: [],
      schema: inputSchema({ widget: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Closed.' },
      async handler(ctx, { args }) {
        await ctx.api.widgets.close(args.widget);
        return ok('Widget closed.');
      },
    }),
  ];
}

// ── Review ─────────────────────────────────────────────────────────

export function reviewCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'review.list',
      group: 'review',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Review threads in a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [
        { name: 'path', description: 'Filter to one file', type: 'string' },
        { name: 'status', description: 'Filter by status', type: 'string', choices: ['open', 'resolved'] as const },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        { path: z.string().optional(), status: z.string().optional() },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'path', header: 'File', priority: 0 },
          { key: 'line', header: 'Line', format: 'number', priority: 1 },
          statusColumn,
          { key: 'commentCount', header: 'Comments', format: 'number', priority: 2 },
        ],
      },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        const response = await ctx.api.review.threads(
          target.id,
          compact({ path: flags.path, status: flags.status }),
        );
        // This route returns `{ workspaceId, threads }`; every other list
        // route returns a bare array.
        return list(Array.isArray(response) ? response : (response.threads ?? []));
      },
    }),

    defineCommand({
      id: 'review.create',
      group: 'review',
      verb: 'create',
      summary: 'Start a review thread on a line',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'path', description: 'File path', required: true },
        { name: 'body', description: 'Comment text', required: true },
      ],
      flags: [
        { name: 'line', description: 'Line number', type: 'number' },
        { name: 'side', description: 'Diff side', type: 'string', choices: ['old', 'new'] as const },
      ],
      schema: inputSchema(
        { workspace: z.string(), path: z.string(), body: z.string() },
        { line: z.coerce.number().int().positive().optional(), side: z.string().optional() },
      ),
      output: { kind: 'record', successMessage: 'Created thread {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.review.createThread(
            target.id,
            compact({ path: args.path, body: args.body, line: flags.line, side: flags.side }) as never,
          ),
        );
      },
    }),

    defineCommand({
      id: 'review.reply',
      group: 'review',
      verb: 'reply',
      summary: 'Reply on a thread',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'thread', description: 'Thread id', required: true },
        { name: 'body', description: 'Comment text', required: true },
      ],
      flags: [],
      schema: inputSchema({ workspace: z.string(), thread: z.string(), body: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Replied.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.review.addComment(target.id, args.thread, { body: args.body } as never),
        );
      },
    }),

    ...(['resolve', 'unresolve'] as const).map((verb) =>
      defineCommand({
        id: `review.${verb}`,
        group: 'review',
        verb,
        summary: `Mark a thread ${verb === 'resolve' ? 'resolved' : 'open'}`,
        requiresServer: true,
        sinceVersion: '0.2.0',
        args: [
          { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
          { name: 'thread', description: 'Thread id', required: true },
        ],
        flags: [],
        schema: inputSchema({ workspace: z.string(), thread: z.string() }, {}),
        output: { kind: 'record', successMessage: `Thread ${verb}d.` },
        async handler(ctx, { args }) {
          const target = await findWorkspace(ctx, args.workspace);
          return record(
            await ctx.api.review.setThreadStatus(
              target.id,
              args.thread,
              verb === 'resolve' ? 'resolved' : 'open',
            ),
          );
        },
      }),
    ),

    defineCommand({
      id: 'review.submit',
      group: 'review',
      verb: 'submit',
      summary: 'Hand a batch of threads to the agent',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [
        { name: 'thread', description: 'Thread id (repeatable); omit for every open thread', type: 'string', variadic: true },
        { name: 'note', description: 'Covering note', type: 'string' },
        { name: 'preview', description: 'Show what would be sent without sending', type: 'boolean' },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        { thread: z.array(z.string()).optional(), note: z.string().optional(), preview: z.boolean().optional() },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        let threadIds = flags.thread;
        if (!threadIds?.length) {
          const open = await ctx.api.review.threads(target.id, { status: 'open' });
          const rows = Array.isArray(open) ? open : (open.threads ?? []);
          threadIds = (rows as unknown as Array<{ id: string }>).map((t) => t.id);
        }
        if (!threadIds.length) {
          throw new CliError('CONFLICT', 'There are no open review threads to submit.');
        }
        return record(
          await ctx.api.review.submit(
            target.id,
            compact({ threadIds, note: flags.note, preview: flags.preview }) as never,
          ),
        );
      },
    }),
  ];
}

// ── Browser ────────────────────────────────────────────────────────

export function browserCommands(): CommandSpec[] {
  const wsArg = {
    name: 'workspace',
    description: 'Workspace reference',
    required: true,
    completes: 'workspace' as const,
  };

  return [
    defineCommand({
      id: 'browser.start',
      group: 'browser',
      verb: 'start',
      summary: 'Start a Chromium session in a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [
        { name: 'url', description: 'Initial URL', type: 'string' },
        { name: 'width', description: 'Viewport width', type: 'number' },
        { name: 'height', description: 'Viewport height', type: 'number' },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        {
          url: z.string().optional(),
          width: z.coerce.number().int().positive().optional(),
          height: z.coerce.number().int().positive().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Browser started.' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.browser.start(
            target.id,
            compact({ url: flags.url, width: flags.width, height: flags.height }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'browser.status',
      group: 'browser',
      verb: 'status',
      summary: 'Current browser descriptor',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(await ctx.api.browser.descriptor(target.id));
      },
    }),

    ...(
      [
        ['navigate', 'goto', 'Navigate to a URL'],
        ['back', 'back', 'Go back'],
        ['forward', 'forward', 'Go forward'],
        ['reload', 'reload', 'Reload the page'],
      ] as const
    ).map(([verb, action, summary]) =>
      defineCommand({
        id: `browser.${verb}`,
        group: 'browser',
        verb,
        summary,
        requiresServer: true,
        sinceVersion: '0.2.0',
        args: verb === 'navigate' ? [wsArg, { name: 'url', description: 'URL', required: true }] : [wsArg],
        flags: [],
        schema: inputSchema({ workspace: z.string(), url: z.string().optional() }, {}),
        output: { kind: 'record', successMessage: `${summary}.` },
        async handler(ctx, { args }) {
          const target = await findWorkspace(ctx, args.workspace);
          return record(
            await ctx.api.browser.actions(target.id, compact({ action, url: args.url })),
          );
        },
      }),
    ),

    defineCommand({
      id: 'browser.screenshot',
      group: 'browser',
      verb: 'screenshot',
      summary: 'Capture the page',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [
        { name: 'out', short: 'o', description: 'Write the PNG here', type: 'string' },
        { name: 'fullPage', description: 'Capture beyond the viewport', type: 'boolean' },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        { out: z.string().optional(), fullPage: z.boolean().optional() },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        const result = await ctx.api.browser.capture(
          target.id,
          compact({ fullPage: flags.fullPage }),
        );

        if (flags.out && typeof result['data'] === 'string') {
          const file = path.resolve(flags.out);
          await fs.mkdir(path.dirname(file), { recursive: true });
          // The server returns base64 rather than binary so the payload can
          // ride in the same JSON envelope as its metadata.
          await fs.writeFile(file, Buffer.from(result['data'], 'base64'));
          return record({ ...result, data: undefined, path: file }, `Wrote ${file}`);
        }
        return record(result);
      },
    }),

    defineCommand({
      id: 'browser.snapshots',
      group: 'browser',
      verb: 'snapshots',
      summary: 'Captures taken in this workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [idColumn, { key: 'url', header: 'URL', priority: 0 }, createdColumn],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.browser.snapshots(target.id));
      },
    }),

    defineCommand({
      id: 'browser.stop',
      group: 'browser',
      verb: 'stop',
      summary: 'Stop the browser session',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Browser stopped.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        await ctx.api.browser.stop(target.id);
        return ok('Browser stopped.');
      },
    }),
  ];
}

// ── Computer use ───────────────────────────────────────────────────

export function computerCommands(): CommandSpec[] {
  const wsArg = {
    name: 'workspace',
    description: 'Workspace reference',
    required: true,
    completes: 'workspace' as const,
  };

  return [
    defineCommand({
      id: 'computer.status',
      group: 'computer',
      verb: 'status',
      summary: 'Computer Use runtime and consent state',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        const [runtime, consent] = await Promise.all([
          ctx.api.computer.runtime(target.id),
          ctx.api.computer.consent(target.id),
        ]);
        return record({ runtime, consent });
      },
    }),

    defineCommand({
      id: 'computer.grants',
      group: 'computer',
      verb: 'grants',
      summary: 'Per-application grants',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'appIdentity', header: 'App', priority: 0 },
          { key: 'scopes', header: 'Scopes', format: 'list', priority: 1 },
          { key: 'grantedAt', header: 'Granted', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.computer.grants(target.id));
      },
    }),

    defineCommand({
      id: 'computer.revoke',
      group: 'computer',
      verb: 'revoke',
      summary: 'Revoke an application grant',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [wsArg, { name: 'app', description: 'Application identity', required: true }],
      flags: [],
      schema: inputSchema({ workspace: z.string(), app: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Revoked.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        await ctx.api.computer.revokeGrant(target.id, args.app);
        return ok(`Revoked ${args.app}.`);
      },
    }),

    defineCommand({
      id: 'computer.activity',
      group: 'computer',
      verb: 'activity',
      aliases: ['audit'],
      summary: 'Audit trail of computer-use actions',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'timestamp', header: 'When', format: 'relative', priority: 0 },
          { key: 'action', header: 'Action', priority: 0 },
          { key: 'target', header: 'Target', priority: 1 },
          { key: 'result', header: 'Result', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.computer.activity(target.id));
      },
    }),

    defineCommand({
      id: 'computer.frames',
      group: 'computer',
      verb: 'frames',
      summary: 'Captured window frames',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [idColumn, { key: 'app', header: 'App', priority: 0 }, createdColumn],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.computer.frames(target.id));
      },
    }),
  ];
}

// ── Hooks, webhooks, harness, source control, security ─────────────

export function platformCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'hook.phases',
      group: 'hook',
      verb: 'phases',
      summary: 'Hook phases the server can invoke',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'phase', header: 'Phase', priority: 0 },
          { key: 'category', header: 'Category', priority: 1 },
          { key: 'description', header: 'Description', priority: 2 },
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.hooks.phases());
      },
    }),

    defineCommand({
      id: 'hook.test',
      group: 'hook',
      verb: 'test',
      summary: 'Fire one hook phase against a session',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'session', description: 'Session id', required: true },
        { name: 'phase', description: 'Hook phase', required: true },
      ],
      flags: [{ name: 'payload', description: 'JSON payload', type: 'string' }],
      schema: inputSchema(
        { session: z.string(), phase: z.string() },
        { payload: z.string().optional() },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        let payload: Record<string, unknown> | undefined;
        if (flags.payload) {
          try {
            payload = JSON.parse(flags.payload) as Record<string, unknown>;
          } catch (error) {
            throw new CliError('VALIDATION', '--payload is not valid JSON.', {
              hint: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return record(await ctx.api.hooks.test(args.session, args.phase, payload));
      },
    }),

    defineCommand({
      id: 'hook.list',
      group: 'hook',
      verb: 'list',
      summary: 'Hooks registered on a session',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'session', description: 'Session id', required: true }],
      flags: [],
      schema: inputSchema({ session: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'phase', header: 'Phase', priority: 0 },
          { key: 'type', header: 'Type', priority: 0 },
          { key: 'failurePolicy', header: 'On failure', priority: 2 },
          { key: 'priority', header: 'Priority', format: 'number', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        return list(await ctx.api.hooks.sessionHooks(args.session));
      },
    }),

    defineCommand({
      id: 'webhook.list',
      group: 'webhook',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Outgoing webhook registrations',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'url', header: 'URL', priority: 0 },
          { key: 'events', header: 'Events', format: 'list', priority: 1 },
          createdColumn,
        ],
      },
      async handler(ctx) {
        return list(await ctx.api.webhooks.list());
      },
    }),

    defineCommand({
      id: 'webhook.create',
      group: 'webhook',
      verb: 'create',
      summary: 'Register an outgoing webhook',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'url', description: 'Destination URL', required: true }],
      flags: [
        { name: 'event', description: 'Event to deliver (repeatable)', type: 'string', variadic: true },
        { name: 'secret', description: 'HMAC secret', type: 'string' },
      ],
      schema: inputSchema(
        { url: z.string().url('must be a URL') },
        { event: z.array(z.string()).optional(), secret: z.string().optional() },
      ),
      output: { kind: 'record', successMessage: 'Registered webhook {id}' },
      async handler(ctx, { args, flags }) {
        return record(
          await ctx.api.webhooks.create(
            compact({ url: args.url, events: flags.event, secret: flags.secret }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'webhook.delete',
      group: 'webhook',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Remove a webhook registration',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'webhook', description: 'Registration id', required: true }],
      flags: [],
      schema: inputSchema({ webhook: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(ctx, { args }) {
        await ctx.api.webhooks.remove(args.webhook);
        return ok('Removed webhook.');
      },
    }),

    defineCommand({
      id: 'harness.show',
      group: 'harness',
      verb: 'show',
      summary: 'Active provider and its readiness',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'refresh', description: 'Re-probe each provider', type: 'boolean' }],
      schema: inputSchema({}, { refresh: z.boolean().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { flags }) {
        return record(await ctx.api.harness.providers(Boolean(flags.refresh)));
      },
    }),

    defineCommand({
      id: 'harness.switch',
      group: 'harness',
      verb: 'switch',
      summary: 'Change the default provider',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        {
          name: 'provider',
          description: 'Provider to switch to',
          required: true,
        },
      ],
      flags: [],
      schema: inputSchema({ provider: z.enum(['copilot', 'claude-agent']) }, {}),
      output: { kind: 'record', successMessage: 'Provider switched.' },
      async handler(ctx, { args }) {
        const result = await ctx.api.harness.setDefault(args.provider);
        return {
          data: result,
          warnings: [
            'Model overrides are provider-specific. Stages pinned to a model this provider does not offer will fail.',
          ],
        };
      },
    }),

    defineCommand({
      id: 'sourceControl.status',
      group: 'source-control',
      verb: 'status',
      summary: 'Provider connection and repository status',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx) {
        return record(await ctx.api.sourceControl.status());
      },
    }),

    defineCommand({
      id: 'sourceControl.config',
      group: 'source-control',
      verb: 'config',
      summary: 'Show or set source-control configuration',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'provider', description: 'Provider id', type: 'string' },
        { name: 'defaultBase', description: 'Default PR base branch', type: 'string' },
        { name: 'draft', description: 'Open pull requests as drafts', type: 'boolean' },
      ],
      schema: inputSchema(
        {},
        {
          provider: z.string().optional(),
          defaultBase: z.string().optional(),
          draft: z.boolean().optional(),
        },
      ),
      output: { kind: 'record' },
      async handler(ctx, { flags }): Promise<CommandResult<unknown>> {
        const body = compact({
          provider: flags.provider,
          defaultBaseBranch: flags.defaultBase,
          draftByDefault: flags.draft,
        });
        if (Object.keys(body).length === 0) {
          return record(await ctx.api.sourceControl.config());
        }
        return record(await ctx.api.sourceControl.setConfig(body), 'Configuration updated.');
      },
    }),

    defineCommand({
      id: 'security.posture',
      group: 'security',
      verb: 'posture',
      summary: 'Auth mode, secret backend and network exposure',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: { kind: 'record' },
      async handler(ctx) {
        return record(await ctx.api.security.posture());
      },
    }),

    defineCommand({
      id: 'security.networkAccess',
      group: 'security',
      verb: 'network-access',
      summary: 'Show or set whether the server listens beyond loopback',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        {
          name: 'mode',
          description: 'New exposure mode',
          type: 'string',
          choices: ['loopback', 'lan', 'relay'] as const,
        },
      ],
      schema: inputSchema({}, { mode: z.string().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { flags }) {
        if (!flags.mode) return record(await ctx.api.security.networkAccess());
        return {
          data: await ctx.api.security.setNetworkAccess({ mode: flags.mode }),
          warnings:
            flags.mode === 'loopback'
              ? []
              : ['The server is now reachable from other machines. Every client must still pair.'],
        };
      },
    }),

    defineCommand({
      id: 'security.audit',
      group: 'security',
      verb: 'audit',
      summary: 'Authentication and device audit log',
      requiresServer: true,
      scopes: ['admin:devices'],
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'limit', description: 'Maximum rows', type: 'number', default: 50 }],
      schema: inputSchema({}, { limit: z.coerce.number().int().positive().default(50) }),
      output: {
        kind: 'list',
        columns: [
          { key: 'timestamp', header: 'When', format: 'relative', priority: 0 },
          { key: 'event', header: 'Event', priority: 0 },
          { key: 'deviceId', header: 'Device', format: 'id', priority: 1 },
          { key: 'outcome', header: 'Outcome', format: 'status', priority: 0 },
        ],
      },
      async handler(ctx, { flags }) {
        return list(await ctx.api.devices.audit({ limit: flags.limit }));
      },
    }),
  ];
}
