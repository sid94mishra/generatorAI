// `generatorai workspace …`, `artifact …` and `terminal …`
//
// Grouped in one module because all three address the same object: an
// execution workspace is the filesystem a run/chat executed in, artifacts are
// what it produced, and a terminal is a PTY attached to it.

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
  ok,
  projectFlag,
  record,
  statusColumn,
} from './_shared.js';

export const WORKSPACE_GROUP = {
  name: 'workspace',
  aliases: ['ws'],
  summary: 'Per-run filesystems, their files, changes and checkpoints',
  order: 55,
};

export const TERMINAL_GROUP = {
  name: 'terminal',
  aliases: ['term'],
  summary: 'PTYs attached to a workspace',
  order: 57,
};

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
    activeStatuses: ['active', 'creating'],
  });
}

export function workspaceCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'workspace.list',
      group: 'workspace',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List execution workspaces',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'status', description: 'Filter by status', type: 'string' },
        projectFlag,
        { name: 'limit', description: 'Maximum rows', type: 'number', default: 50 },
      ],
      schema: inputSchema(
        {},
        {
          status: z.string().optional(),
          project: z.string().optional(),
          limit: z.coerce.number().int().positive().default(50),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'ownerType', header: 'Owner', priority: 0 },
          { key: 'ownerId', header: 'Owner ID', format: 'id', priority: 2 },
          statusColumn,
          { key: 'sizeBytes', header: 'Size', format: 'bytes', priority: 3 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        return list(
          await ctx.api.workspaces.list(compact({ projectId, status: flags.status, limit: flags.limit })),
        );
      },
    }),

    defineCommand({
      id: 'workspace.show',
      group: 'workspace',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a workspace with its worktrees',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        const [workspace, worktrees] = await Promise.all([
          ctx.api.workspaces.get(target.id),
          ctx.api.workspaces.worktrees(target.id).catch(() => []),
        ]);
        return record({ ...workspace, worktrees });
      },
    }),

    defineCommand({
      id: 'workspace.tree',
      group: 'workspace',
      verb: 'tree',
      aliases: ['files'],
      summary: 'List files in a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'path', description: 'Directory within the workspace', required: false },
      ],
      flags: [{ name: 'alias', description: 'Worktree alias to browse', type: 'string' }],
      schema: inputSchema(
        { workspace: z.string(), path: z.string().optional() },
        { alias: z.string().optional() },
      ),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'size', header: 'Size', format: 'bytes', priority: 2 },
        ],
      },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        // `tree` understands worktree aliases; `files` is the flat listing.
        if (flags.alias) {
          const tree = await ctx.api.workspaces.tree(target.id, flags.alias);
          return list(
            Array.isArray(tree)
              ? (tree as Array<Record<string, unknown>>)
              : ((tree as { entries?: Array<Record<string, unknown>> }).entries ?? []),
          );
        }
        return list(await ctx.api.workspaces.files(target.id, args.path));
      },
    }),

    defineCommand({
      id: 'workspace.get',
      group: 'workspace',
      verb: 'cat',
      summary: 'Print a file from a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'path', description: 'File path', required: true },
      ],
      flags: [
        { name: 'alias', description: 'Worktree alias', type: 'string' },
        { name: 'out', short: 'o', description: 'Write to a local file', type: 'string' },
      ],
      schema: inputSchema(
        { workspace: z.string(), path: z.string() },
        { alias: z.string().optional(), out: z.string().optional() },
      ),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        const payload = flags.alias
          ? await ctx.api.workspaces.treeFile(target.id, { path: args.path, alias: flags.alias })
          : await ctx.api.workspaces.fileContent(target.id, args.path);
        const content = (payload as { content?: string }).content ?? '';

        if (!flags.out) return record(content);
        const file = path.resolve(flags.out);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content, 'utf8');
        return record({ path: file }, `Wrote ${file}`);
      },
    }),

    defineCommand({
      id: 'workspace.changes',
      group: 'workspace',
      verb: 'changes',
      aliases: ['diff'],
      summary: 'Files a workspace changed, or the unified diff of one',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'path', description: 'One file — prints its diff instead of the list', required: false },
      ],
      flags: [
        { name: 'alias', description: 'Worktree alias', type: 'string' },
        { name: 'base', description: 'Base ref', type: 'string' },
        { name: 'head', description: 'Head ref', type: 'string' },
      ],
      schema: inputSchema(
        { workspace: z.string(), path: z.string().optional() },
        { alias: z.string().optional(), base: z.string().optional(), head: z.string().optional() },
      ),
      output: {
        kind: 'list',
        columns: [
          { key: 'status', header: 'S', priority: 0, width: 1 },
          { key: 'path', header: 'File', priority: 0 },
          { key: 'additions', header: '+', format: 'number', align: 'right', priority: 1 },
          { key: 'deletions', header: '-', format: 'number', align: 'right', priority: 1 },
        ],
      },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        if (args.path) {
          const patch = await ctx.api.workspaces.filePatch(
            target.id,
            compact({ path: args.path, alias: flags.alias, base: flags.base, head: flags.head }) as never,
          );
          return record(typeof patch === 'string' ? patch : JSON.stringify(patch, null, 2));
        }
        const changes = await ctx.api.workspaces.changes(
          target.id,
          compact({ alias: flags.alias, base: flags.base, head: flags.head }),
        );
        return list(
          Array.isArray(changes)
            ? (changes as Array<Record<string, unknown>>)
            : ((changes as { files?: Array<Record<string, unknown>> }).files ?? []),
        );
      },
    }),

    defineCommand({
      id: 'workspace.checkpoints',
      group: 'workspace',
      verb: 'checkpoints',
      summary: 'Checkpoints taken in a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [idColumn, { key: 'label', header: 'Label', priority: 0 }, createdColumn],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        const response = (await ctx.api.workspaces.checkpoints(target.id)) as unknown;
        return list(
          Array.isArray(response)
            ? (response as Array<Record<string, unknown>>)
            : ((response as { checkpoints?: Array<Record<string, unknown>> }).checkpoints ?? []),
        );
      },
    }),

    defineCommand({
      id: 'workspace.restore',
      group: 'workspace',
      verb: 'restore',
      summary: 'Restore a workspace to a checkpoint',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'checkpoint', description: 'Checkpoint id', required: true },
      ],
      flags: [
        { name: 'path', description: 'Restore only these paths (repeatable)', type: 'string', variadic: true },
      ],
      schema: inputSchema(
        { workspace: z.string(), checkpoint: z.string() },
        { path: z.array(z.string()).optional() },
      ),
      output: { kind: 'record', successMessage: 'Restored.' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.workspaces.restoreCheckpoint(
            target.id,
            args.checkpoint,
            flags.path ? { paths: flags.path } : undefined,
          ),
        );
      },
    }),

    defineCommand({
      id: 'workspace.commit',
      group: 'workspace',
      verb: 'commit',
      summary: 'Commit the workspace worktrees',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [{ name: 'message', short: 'm', description: 'Commit message', type: 'string' }],
      schema: inputSchema({ workspace: z.string() }, { message: z.string().optional() }),
      output: { kind: 'record', successMessage: 'Committed.' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(await ctx.api.workspaces.commit(target.id, flags.message));
      },
    }),

    defineCommand({
      id: 'workspace.pr',
      group: 'workspace',
      verb: 'pr',
      summary: 'Open a pull request from a workspace, or list existing ones',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [
        { name: 'title', description: 'PR title — creating requires it', type: 'string' },
        { name: 'body', description: 'PR body', type: 'string' },
        { name: 'base', description: 'Base branch', type: 'string' },
        { name: 'draft', description: 'Open as a draft', type: 'boolean' },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        {
          title: z.string().optional(),
          body: z.string().optional(),
          base: z.string().optional(),
          draft: z.boolean().optional(),
        },
      ),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findWorkspace(ctx, args.workspace);
        if (!flags.title) {
          return list(await ctx.api.workspaces.pullRequests(target.id));
        }
        return record(
          await ctx.api.workspaces.createPullRequest(
            target.id,
            compact({ title: flags.title, body: flags.body, base: flags.base, draft: flags.draft }),
          ),
          'Pull request opened.',
        );
      },
    }),

    defineCommand({
      id: 'workspace.archive',
      group: 'workspace',
      verb: 'archive',
      summary: 'Archive a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Archived.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(await ctx.api.workspaces.archive(target.id));
      },
    }),

    defineCommand({
      id: 'workspace.delete',
      group: 'workspace',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a workspace and everything in it',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        await ctx.api.workspaces.remove(target.id);
        return ok(`Deleted workspace ${target.id}.`);
      },
    }),

    defineCommand({
      id: 'workspace.cleanup',
      group: 'workspace',
      verb: 'cleanup',
      summary: 'Garbage-collect old or oversized workspaces',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'retentionHours', description: 'Keep workspaces newer than this', type: 'number' },
        { name: 'maxDiskMb', description: 'Total disk budget', type: 'number' },
      ],
      schema: inputSchema(
        {},
        {
          retentionHours: z.coerce.number().int().positive().optional(),
          maxDiskMb: z.coerce.number().int().positive().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Cleanup complete.' },
      async handler(ctx, { flags }) {
        return record(
          await ctx.api.workspaces.cleanup(
            compact({ retentionHours: flags.retentionHours, maxDiskMb: flags.maxDiskMb }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'workspace.worktrees',
      group: 'workspace',
      verb: 'worktree list',
      summary: 'Worktrees inside a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'alias', header: 'Alias', priority: 0 },
          { key: 'path', header: 'Path', priority: 1 },
          { key: 'branch', header: 'Branch', priority: 1 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.workspaces.worktrees(target.id));
      },
    }),
  ];
}

export function terminalCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'terminal.list',
      group: 'terminal',
      verb: 'list',
      aliases: ['ls'],
      summary: 'Terminals attached to a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [],
      schema: inputSchema({ workspace: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'shell', header: 'Shell', priority: 0 },
          { key: 'cwd', header: 'CWD', priority: 1 },
          { key: 'cols', header: 'Cols', format: 'number', priority: 3 },
          { key: 'rows', header: 'Rows', format: 'number', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        return list(await ctx.api.terminals.list(target.id));
      },
    }),

    defineCommand({
      id: 'terminal.create',
      group: 'terminal',
      verb: 'create',
      aliases: ['new'],
      summary: 'Start a PTY in a workspace',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' }],
      flags: [
        { name: 'cols', description: 'Columns', type: 'number', default: 120 },
        { name: 'rows', description: 'Rows', type: 'number', default: 30 },
      ],
      schema: inputSchema(
        { workspace: z.string() },
        {
          cols: z.coerce.number().int().positive().default(120),
          rows: z.coerce.number().int().positive().default(30),
        },
      ),
      output: { kind: 'record', successMessage: 'Started terminal {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findWorkspace(ctx, args.workspace);
        return record(
          await ctx.api.terminals.create(target.id, { cols: flags.cols, rows: flags.rows }),
        );
      },
    }),

    defineCommand({
      id: 'terminal.scrollback',
      group: 'terminal',
      verb: 'scrollback',
      aliases: ['tail'],
      summary: 'Print a terminal buffer',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'terminal', description: 'Terminal id', required: true },
      ],
      flags: [],
      schema: inputSchema({ workspace: z.string(), terminal: z.string() }, {}),
      output: { kind: 'raw' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        const { data } = await ctx.api.terminals.scrollback(target.id, args.terminal);
        return record(data);
      },
    }),

    defineCommand({
      id: 'terminal.signal',
      group: 'terminal',
      verb: 'signal',
      summary: 'Send a signal to the process group',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'terminal', description: 'Terminal id', required: true },
        { name: 'signal', description: 'Signal name', required: false },
      ],
      flags: [],
      schema: inputSchema(
        { workspace: z.string(), terminal: z.string(), signal: z.string().default('SIGINT') },
        {},
      ),
      output: { kind: 'void', successMessage: 'Signal sent.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        await ctx.api.terminals.signal(target.id, args.terminal, args.signal);
        return ok(`Sent ${args.signal}.`);
      },
    }),

    defineCommand({
      id: 'terminal.kill',
      group: 'terminal',
      verb: 'kill',
      summary: 'Kill a terminal',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'terminal', description: 'Terminal id', required: true },
      ],
      flags: [],
      schema: inputSchema({ workspace: z.string(), terminal: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Killed.' },
      async handler(ctx, { args }) {
        const target = await findWorkspace(ctx, args.workspace);
        await ctx.api.terminals.kill(target.id, args.terminal);
        return ok('Terminal killed.');
      },
    }),

    /**
     * Raw attach.
     *
     * The binary surface cannot host a PTY inside its own line-oriented
     * output, so this hands stdin/stdout straight to the socket and restores
     * the terminal on exit. The TUI does the same thing via
     * Ink's `suspendTerminal`.
     */
    defineCommand({
      id: 'terminal.attach',
      group: 'terminal',
      verb: 'attach',
      summary: 'Attach this terminal to a workspace PTY (Ctrl+] detaches)',
      requiresServer: true,
      inPalette: false,
      inRpc: false,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workspace', description: 'Workspace reference', required: true, completes: 'workspace' },
        { name: 'terminal', description: 'Terminal id; omit to create one', required: false },
      ],
      flags: [],
      schema: inputSchema({ workspace: z.string(), terminal: z.string().optional() }, {}),
      output: { kind: 'stream' },
      async handler(ctx, { args }) {
        if (!ctx.capabilities.isTTY) {
          throw CliError.usage('`terminal attach` needs a real terminal.', {
            hint: 'Use `terminal scrollback` to read the buffer non-interactively.',
          });
        }
        const target = await findWorkspace(ctx, args.workspace);
        const terminalId =
          args.terminal ??
          (await ctx.api.terminals.create(target.id, {
            cols: ctx.capabilities.columns,
            rows: ctx.capabilities.rows,
          })).id;

        // The transport is supplied by the surface: cli-core must not import
        // `ws`, and the TUI attaches through Ink's terminal suspension rather
        // than through raw stdin.
        ctx.emit({
          type: 'stream',
          kind: 'terminal.attach_requested',
          data: { workspaceId: target.id, terminalId },
        });
        return record({ workspaceId: target.id, terminalId });
      },
    }),
  ];
}
