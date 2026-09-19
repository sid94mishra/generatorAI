// The remaining domains, each small enough that a file per group would be
// more navigation than signal: agents, extensions, widgets, review, source
// control, security, hooks, webhooks, harness, templates, scripts,
// orchestrator, browser and computer use.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { HookDefinition } from '@generatorai/shared';
import { defineCommand, type CommandResult, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError, EXIT_CODES } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import { watchRun } from './run.js';
import {
  degradeWidget,
  degradeWidgets,
  type WidgetRenderPayload,
} from '../viewmodels/widgetDegradation.js';
import {
  compact,
  createdColumn,
  idColumn,
  inputSchema,
  list,
  nameColumn,
  ok,
  projectFlag,
  readTextFile,
  record,
  statusColumn,
  verbosityFlag,
  watchFlag,
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
    return resolveRef(ref, { kind: 'agent', candidates: agents });
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
        const markdown = await readTextFile(path.resolve(args.file), 'agent markdown file');
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
          await ctx.api.agents.resolvePreview({
            scope: flags.scope,
            ...compact({ agentRef: args.agent, projectId, harnessType: flags.harness }),
          }),
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
    return resolveRef(ref, { kind: 'script', candidates: scripts });
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
          await ctx.api.scripts.materialize(target.id, // The route reads `profileName`; `profile` was silently ignored.
          compact({ profileName: flags.profile })),
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
      flags: [{ name: 'profile', description: 'Profile name', type: 'string' }, watchFlag, verbosityFlag],
      schema: inputSchema(
        { script: z.string() },
        {
          profile: z.string().optional(),
          watch: z.boolean().optional(),
          verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
        },
      ),
      output: { kind: 'record', successMessage: 'Started run {id}' },
      async handler(ctx, { args, flags }) {
        const target = await find(ctx, args.script);
        const run = await ctx.api.scripts.run(target.id, compact({ profile: flags.profile }));
        if (!flags.watch) {
          return record(run, `Started run ${run.id} — \`generatorai run watch ${run.id}\``);
        }
        // Reuses `run start`'s watcher so there is one implementation of
        // "follow a run" — previously this printed a suggestion to watch
        // instead of actually doing it.
        await watchRun(ctx, run.id, flags.verbosity);
        return record(await ctx.api.runs.get(run.id));
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
        const source = await readTextFile(path.resolve(args.file), 'script file');
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
    return resolveRef(ref, { kind: 'extension', candidates: extensions });
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
      summary: 'Open widget surfaces for a chat, run or session',
      description:
        'Widgets are scoped: the server returns nothing unless one of --chat, --run or --session ' +
        'is given. `renderable` is always false in a terminal — see `widget read` for what that ' +
        'means and what is shown instead.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'chat', description: 'Widgets opened in this chat', type: 'string', completes: 'chat' },
        { name: 'run', description: 'Widgets opened in this workflow run', type: 'string', completes: 'run' },
        { name: 'session', description: 'Widgets opened in this session', type: 'string' },
      ],
      schema: inputSchema(
        {},
        { chat: z.string().optional(), run: z.string().optional(), session: z.string().optional() },
      ),
      output: {
        kind: 'list',
        columns: [
          { key: 'instanceId', header: 'ID', format: 'id', priority: 0 },
          { key: 'title', header: 'Title', priority: 0 },
          { key: 'surface', header: 'Surface', priority: 1 },
          { key: 'status', header: 'Status', format: 'status', priority: 0 },
          { key: 'extensionId', header: 'Extension', priority: 2 },
          { key: 'orphaned', header: 'Orphaned', format: 'boolean', priority: 1 },
        ],
      },
      async handler(ctx, { flags }): Promise<CommandResult<unknown>> {
        // The route starts from an empty list and only fills it inside the
        // chat/run/session branches, so a scopeless call can only ever
        // return nothing — say so rather than printing an empty table that
        // reads as "there are no widgets".
        if (!flags.chat && !flags.run && !flags.session) {
          throw CliError.usage('Pass one of --chat, --run or --session — widgets are scoped to one of those.');
        }
        const scope = compact({
          chatId: flags.chat,
          workflowRunId: flags.run,
          sessionId: flags.session,
        });
        const { instances, render } = await ctx.api.widgets.listWithRender(scope);
        return list(
          degradeWidgets(instances, render as WidgetRenderPayload[]) as unknown as Array<
            Record<string, unknown>
          >,
        );
      },
    }),

    defineCommand({
      id: 'widget.read',
      group: 'widget',
      verb: 'read',
      aliases: ['show'],
      summary: 'Read a widget as text, with what a terminal cannot show',
      description:
        'A widget\'s interface is JavaScript and is never executed here. This prints its real ' +
        'data (props and state) plus an explicit list of what is being left out — see the ' +
        'textual widget degradation contract in viewmodels/widgetDegradation.ts.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'widget', description: 'Widget id', required: true, completes: 'widget' }],
      flags: [
        { name: 'chat', description: 'Chat the widget belongs to — needed to resolve its descriptor', type: 'string', completes: 'chat' },
        { name: 'run', description: 'Run the widget belongs to', type: 'string', completes: 'run' },
        { name: 'session', description: 'Session the widget belongs to', type: 'string' },
      ],
      schema: inputSchema(
        { widget: z.string() },
        { chat: z.string().optional(), run: z.string().optional(), session: z.string().optional() },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const instance = await ctx.api.widgets.get(args.widget);
        // The render payload only comes from the LIST route, and only within
        // a scope. Without one the descriptor cannot be resolved, so the
        // widget reads as orphaned — which is exactly what `degradeWidget`
        // reports, rather than pretending the descriptor is missing.
        let payload: WidgetRenderPayload | undefined;
        if (flags.chat || flags.run || flags.session) {
          const { render } = await ctx.api.widgets.listWithRender(
            compact({ chatId: flags.chat, workflowRunId: flags.run, sessionId: flags.session }),
          );
          payload = (render as WidgetRenderPayload[]).find((p) => p.instanceId === args.widget);
        }
        // `scoped` says whether a descriptor was even looked for — without
        // it the widget would be reported as orphaned (extension gone) when
        // the real story is that this call never looked.
        return record(degradeWidget(instance, payload, { scoped: Boolean(flags.chat || flags.run || flags.session) }));
      },
    }),

    defineCommand({
      id: 'widget.setState',
      group: 'widget',
      verb: 'set-state',
      summary: "Write a widget's state — the degraded way to drive one",
      description:
        'The state route takes a FULL snapshot, not a patch: whatever JSON is passed replaces ' +
        'the widget\'s state entirely. This is how a terminal interacts with a widget whose ' +
        'controls it cannot draw.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'widget', description: 'Widget id', required: true, completes: 'widget' },
        { name: 'state', description: 'Full state as a JSON object', required: true },
      ],
      flags: [],
      schema: inputSchema({ widget: z.string(), state: z.string() }, {}),
      output: { kind: 'record', successMessage: 'State written.' },
      async handler(ctx, { args }) {
        let state: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(args.state);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not a JSON object');
          }
          state = parsed as Record<string, unknown>;
        } catch (error) {
          throw new CliError('VALIDATION', 'state must be a JSON object.', {
            hint: error instanceof Error ? error.message : String(error),
          });
        }
        return record(await ctx.api.widgets.setState(args.widget, state));
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
      summary: 'Start a review thread on a line range',
      description:
        'Scope and scopeId default from the workspace\'s owner when it is a chat. For a workflow ' +
        'run\'s workspace, or to review under a different entity than the workspace default, pass ' +
        'both explicitly — the server has no other way to know which chat/run/automation owns the ' +
        'comment.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'path', description: 'File path', required: true },
        { name: 'body', description: 'Comment text', required: true },
      ],
      flags: [
        { name: 'startLine', description: 'First line of the range (1-based)', type: 'number', required: true },
        { name: 'endLine', description: 'Last line of the range; defaults to startLine', type: 'number' },
        { name: 'side', description: 'Diff side', type: 'string', choices: ['additions', 'deletions'] as const, default: 'additions' },
        { name: 'anchorText', description: 'Exact text at the anchored line, for drift detection', type: 'string' },
        { name: 'alias', description: 'Worktree alias', type: 'string' },
        {
          name: 'scope',
          description: "What owns this comment; defaults to the workspace's owner when it is a chat",
          type: 'string',
          choices: ['chat', 'run', 'automation'] as const,
        },
        { name: 'scopeId', description: 'Id of the chat/run/automation named by --scope', type: 'string' },
        { name: 'baseCheckpoint', description: 'Base checkpoint id; omit for none', type: 'string' },
        { name: 'headCheckpoint', description: 'Head checkpoint id; omit for none', type: 'string' },
        { name: 'intent', description: 'Comment intent', type: 'string', choices: ['fix', 'question', 'note', 'refactor', 'test'] as const },
      ],
      schema: inputSchema(
        { workspace: z.string(), path: z.string(), body: z.string() },
        {
          startLine: z.coerce.number().int().positive(),
          endLine: z.coerce.number().int().positive().optional(),
          side: z.enum(['additions', 'deletions']).default('additions'),
          anchorText: z.string().optional(),
          alias: z.string().optional(),
          scope: z.enum(['chat', 'run', 'automation']).optional(),
          scopeId: z.string().optional(),
          baseCheckpoint: z.string().optional(),
          headCheckpoint: z.string().optional(),
          intent: z.enum(['fix', 'question', 'note', 'refactor', 'test']).optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Created thread {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);

        let scope = flags.scope;
        let scopeId = flags.scopeId;
        if (!scope || !scopeId) {
          // The workspace record — not the trimmed reference from
          // `findWorkspace` — is the only place `ownerType`/`ownerId` live.
          const full = await ctx.api.workspaces.get(target.id);
          if (full.ownerType === 'chat' && !scope && !scopeId) {
            scope = 'chat';
            scopeId = full.ownerId;
          } else if (!scope || !scopeId) {
            throw new CliError(
              'USAGE',
              `This workspace's owner ("${full.ownerType}") cannot be turned into a review scope automatically.`,
              {
                hint: 'Pass both --scope and --scopeId — for a workflow run\'s workspace that is usually `--scope run --scopeId <workflowRunId>`.',
              },
            );
          }
        }

        return record(
          await ctx.api.review.createThread(target.id, {
            path: args.path,
            body: args.body,
            anchorText: flags.anchorText ?? '',
            scopeId,
            baseCheckpointId: flags.baseCheckpoint ?? '',
            headCheckpointId: flags.headCheckpoint ?? '',
            side: flags.side,
            startLine: flags.startLine,
            endLine: flags.endLine ?? flags.startLine,
            ...(flags.alias ? { alias: flags.alias } : {}),
            ...(flags.intent ? { intent: flags.intent } : {}),
            scope,
          }),
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
          await ctx.api.review.addComment(target.id, args.thread, { body: args.body }),
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
          await ctx.api.review.submit(target.id, {
            threadIds,
            ...compact({ note: flags.note, preview: flags.preview }),
          }),
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

    // Phase 8 item 1 — the semantic inspectors, before any image rendering.
    //
    // `BrowserService.readPage()` (the accessibility tree) and the DOM
    // snapshot action were both real and both unreachable from any client:
    // `readPage` had no HTTP route at all until this phase, and `snapshot`
    // was an action nothing outside the SPA ever posted. For a terminal
    // these are the PRIMARY representations of a page — an image is the
    // fallback, not the other way round.
    defineCommand({
      id: 'browser.read',
      group: 'browser',
      verb: 'read',
      aliases: ['inspect'],
      summary: "The page's accessibility tree as text",
      description:
        'The interactive shape of the page — roughly a tenth the size of the DOM snapshot, and ' +
        'readable in a terminal as-is. Element refs ([ref=e1]) are re-issued on every call.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [{ name: 'out', short: 'o', description: 'Write the tree to a file', type: 'string' }],
      schema: inputSchema({ workspace: z.string() }, { out: z.string().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        const page = await ctx.api.browser.readPage(target.id);
        const text = `${page.title}\n${page.url}\n\n${page.snapshot}\n`;
        if (!flags.out) return record(text);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text, 'utf8');
        return record(text, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'browser.dom',
      group: 'browser',
      verb: 'dom',
      summary: 'Capture a full DOM snapshot as a workspace artifact',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [{ name: 'out', short: 'o', description: 'Also write the snapshot here', type: 'string' }],
      schema: inputSchema({ workspace: z.string() }, { out: z.string().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        const outcome = await ctx.api.browser.actions(target.id, { kind: 'snapshot' });
        const artifactPath = typeof outcome['artifactPath'] === 'string' ? outcome['artifactPath'] : '';
        if (!flags.out || !artifactPath) return record(outcome);
        const bytes = await ctx.api.browser.file(target.id, artifactPath);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
        return record({ ...outcome, path: file }, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'browser.screenshot',
      group: 'browser',
      verb: 'screenshot',
      summary: 'Capture the page as a PNG',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [{ name: 'out', short: 'o', description: 'Write the PNG here', type: 'string' }],
      schema: inputSchema({ workspace: z.string() }, { out: z.string().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        // This command was broken outright before: it posted to
        // `/browser/capture`, whose schema REQUIRES a `clip` rectangle (it
        // is the SPA's region-capture endpoint) and which answers with raw
        // `image/png` bytes, not JSON — so `--full-page` 400'd on the
        // missing clip, and a valid call would have thrown inside
        // `request()`'s `res.json()`. `--full-page` is gone with it: the
        // real screenshot action takes no such option.
        //
        // The real path is the `screenshot` ACTION, which writes a
        // `browser_screenshot` artifact and returns its relative path.
        const outcome = await ctx.api.browser.actions(target.id, { kind: 'screenshot' });
        const artifactPath = typeof outcome['artifactPath'] === 'string' ? outcome['artifactPath'] : '';
        if (!artifactPath) {
          throw new CliError('CONFLICT', 'The browser did not produce a screenshot.', {
            hint: typeof outcome['error'] === 'string' ? outcome['error'] : 'Is a browser session running?',
          });
        }
        if (!flags.out) return record({ ...outcome, artifactPath });

        const bytes = await ctx.api.browser.file(target.id, artifactPath);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
        return record({ ...outcome, path: file }, `Wrote ${file}`);
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

    // Phase 8 item 3 — the consent half of the security boundary.
    //
    // `computer status` could REPORT a pending consent prompt; nothing could
    // answer one. The store's `resolve()` and the POST route behind it have
    // always existed, with no client outside the desktop app calling them —
    // so a terminal user watching an agent block on a consent prompt had no
    // way to unblock it without switching to a GUI.
    defineCommand({
      id: 'computer.pending',
      group: 'computer',
      verb: 'pending',
      summary: 'Consent prompts waiting for an answer',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [wsArg],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'requestId', header: 'Request', format: 'id', priority: 0 },
          { key: 'appIdentity', header: 'App', priority: 0 },
          { key: 'reason', header: 'Reason', priority: 1 },
          { key: 'requestedAt', header: 'Asked', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        const consent = await ctx.api.computer.consent(target.id);
        // `{ pending: [...] }` — an envelope, like every other list route in
        // this namespace.
        const pending = (consent as { pending?: Array<Record<string, unknown>> }).pending;
        return list(pending ?? []);
      },
    }),

    defineCommand({
      id: 'computer.answer',
      group: 'computer',
      verb: 'answer',
      summary: 'Answer a pending consent prompt',
      description:
        'allow_once permits this action only; allow_run permits it for the rest of the run; ' +
        'always_allow records a standing grant for the app (see `computer grants`); deny refuses.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        wsArg,
        { name: 'request', description: 'Request id from `computer pending`', required: true },
        {
          name: 'decision',
          description: 'What to answer',
          required: true,
          choices: ['allow_once', 'allow_run', 'always_allow', 'deny'] as const,
        },
      ],
      flags: [
        {
          name: 'app',
          description: 'Application identity the prompt names — the server checks it matches',
          type: 'string',
          required: true,
        },
      ],
      schema: inputSchema(
        {
          workspace: z.string(),
          request: z.string(),
          decision: z.enum(['allow_once', 'allow_run', 'always_allow', 'deny']),
        },
        { app: z.string() },
      ),
      output: { kind: 'record', successMessage: 'Answered.' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.computer.setConsent(target.id, {
            requestId: args.request,
            appIdentity: flags.app,
            decision: args.decision,
          }),
        );
      },
    }),

    defineCommand({
      id: 'computer.runtime',
      group: 'computer',
      verb: 'runtime',
      summary: 'Start, restart or stop the Computer Use driver',
      requiresServer: true,
      // Stopping the driver ends a live desktop-control session; starting one
      // hands an agent control of a real desktop. Both deserve the same gate
      // `terminal kill` and `browser stop` already have.
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        wsArg,
        {
          name: 'action',
          description: 'What to do',
          required: true,
          choices: ['start', 'restart', 'stop'] as const,
        },
      ],
      flags: [],
      schema: inputSchema(
        { workspace: z.string(), action: z.enum(['start', 'restart', 'stop']) },
        {},
      ),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(await ctx.api.computer.setRuntime(target.id, { action: args.action }));
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
      summary: 'Dry-run one hook against a session',
      description:
        '--config is the hook-type-specific config object: {"command":"...","args":[...]} for ' +
        'script, {"url":"...","method":"POST"} for http, {"modulePath":"..."} or ' +
        '{"handlerName":"..."} for function.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'session', description: 'Session id', required: true },
        { name: 'phase', description: 'Hook phase', required: true },
      ],
      flags: [
        { name: 'type', description: 'Hook type', type: 'string', choices: ['script', 'http', 'function'] as const, required: true },
        { name: 'config', description: 'JSON config object for --type', type: 'string', required: true },
        { name: 'priority', description: 'Execution order among hooks on this phase', type: 'number' },
        { name: 'timeout', description: 'Timeout in milliseconds', type: 'number' },
        { name: 'retries', description: 'Retry attempts after the first try', type: 'number' },
        { name: 'failurePolicy', description: 'What a failure does to the phase', type: 'string', choices: ['abort', 'skip', 'continue'] as const },
      ],
      schema: inputSchema(
        { session: z.string(), phase: z.string() },
        {
          type: z.enum(['script', 'http', 'function']),
          config: z.string(),
          priority: z.coerce.number().int().optional(),
          timeout: z.coerce.number().int().positive().optional(),
          retries: z.coerce.number().int().nonnegative().optional(),
          failurePolicy: z.enum(['abort', 'skip', 'continue']).optional(),
        },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(flags.config) as Record<string, unknown>;
        } catch (error) {
          throw new CliError('VALIDATION', '--config is not valid JSON.', {
            hint: error instanceof Error ? error.message : String(error),
          });
        }

        // The executor dispatches on `config.type`, not the outer `type` —
        // if `--config` names one that disagrees with `--type`, silently
        // preferring either one would run a different hook than at least
        // one of the two flags asked for. Refuse rather than guess.
        if (typeof config['type'] === 'string' && config['type'] !== flags.type) {
          throw new CliError(
            'VALIDATION',
            `--config's "type" ("${config['type']}") does not match --type ("${flags.type}").`,
            { hint: 'Drop "type" from --config\'s JSON, or make it match --type.' },
          );
        }

        const result = await ctx.api.hooks.test(args.session, args.phase, {
          type: flags.type,
          // Cast, not `as never`: the shape genuinely cannot be proven
          // statically from arbitrary `--config` JSON, so this names the
          // exact type trusted rather than erasing checking entirely.
          config: { ...config, type: flags.type } as HookDefinition['config'],
          ...(flags.priority !== undefined ? { priority: flags.priority } : {}),
          ...(flags.timeout !== undefined ? { timeoutMs: flags.timeout } : {}),
          ...(flags.retries !== undefined ? { retries: flags.retries } : {}),
          ...(flags.failurePolicy ? { failurePolicy: flags.failurePolicy } : {}),
        });

        // The route always answers 200; a failed dry run is reported in the
        // body, not the status code. Surfacing it as ours to fail is the
        // only way `--json`/exit-code consumers see it as a failure at all.
        return {
          data: result,
          ...(result.success ? {} : { exitCode: EXIT_CODES.RESULT_FAILED }),
          message: result.message,
        };
      },
    }),

    defineCommand({
      id: 'hook.list',
      group: 'hook',
      verb: 'list',
      summary: 'Hooks registered on a session — global definitions plus per-workflow overrides',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'session', description: 'Session id', required: true }],
      flags: [],
      schema: inputSchema({ session: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'scope', header: 'Scope', priority: 0 },
          { key: 'workflowName', header: 'Workflow', priority: 2 },
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'phase', header: 'Phase', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'failurePolicy', header: 'On failure', priority: 2 },
          { key: 'priority', header: 'Priority', format: 'number', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        const response = await ctx.api.hooks.sessionHooks(args.session);
        const rows: Array<Record<string, unknown>> = [];
        const globalById = new Map((response.globalHooks ?? []).map((hook) => [hook.id, hook]));

        for (const hook of response.globalHooks ?? []) {
          rows.push({
            scope: 'global',
            workflowId: null,
            workflowName: null,
            hookId: hook.id,
            name: hook.name,
            phase: hook.phase,
            type: hook.type,
            priority: hook.priority,
            failurePolicy: hook.failurePolicy,
            enabled: hook.enabled,
          });
        }
        for (const wf of response.workflowHooks ?? []) {
          for (const [hookId, override] of Object.entries(wf.hooks ?? {})) {
            // `hookOverrides` is a PARTIAL patch keyed by hook id — a field
            // the override doesn't set falls back to the base definition in
            // `globalHooks`. Without this fallback, a row that overrides only
            // e.g. `priority` rendered every other column as undefined even
            // though the real value was sitting right there in `globalHooks`.
            const base = globalById.get(hookId);
            rows.push({
              scope: 'workflow',
              workflowId: wf.workflowId,
              workflowName: wf.workflowName,
              hookId,
              name: override.name ?? base?.name,
              phase: override.phase ?? base?.phase,
              type: override.type ?? base?.type,
              priority: override.priority ?? base?.priority,
              failurePolicy: override.failurePolicy ?? base?.failurePolicy,
              enabled: override.enabled ?? base?.enabled,
            });
          }
        }
        return list(rows);
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
          choices: ['copilot', 'claude-agent'] as const,
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
