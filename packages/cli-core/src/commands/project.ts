// `generatorai project …` — projects, codebases, configs, MCP servers, worktrees.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import {
  compact,
  createdColumn,
  forceFlag,
  idColumn,
  inputSchema,
  list,
  nameColumn,
  ok,
  record,
  requireSomeUpdate,
  statusColumn,
} from './_shared.js';

export const PROJECT_GROUP = {
  name: 'project',
  aliases: ['proj'],
  summary: 'Projects, linked codebases, configs, MCP servers and worktrees',
  order: 50,
};

const CODEBASE_TYPES = ['git-remote', 'git-local', 'local-dir'] as const;

async function findProject(ctx: CliContext, ref: string) {
  const projects = await ctx.api.projects.list();
  return resolveRef(ref, { kind: 'project', candidates: projects as never });
}

async function findCodebase(ctx: CliContext, projectId: string, ref: string) {
  const codebases = await ctx.api.projects.codebases.list(projectId);
  return resolveRef(ref, {
    kind: 'codebase',
    candidates: (codebases as unknown as Array<Record<string, unknown>>).map((c) => ({
      id: String(c['id']),
      name: (c['alias'] ?? c['name']) as string | null,
    })),
  });
}

export function projectCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'project.list',
      group: 'project',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List projects',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [{ name: 'status', description: 'Filter by status', type: 'string' }],
      schema: inputSchema({}, { status: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [idColumn, nameColumn, statusColumn, { key: 'description', header: 'Description', priority: 3 }, createdColumn],
      },
      async handler(ctx, { flags }) {
        const rows = await ctx.api.projects.list();
        return list(
          flags.status
            ? rows.filter((p) => (p as unknown as { status?: string }).status === flags.status)
            : rows,
        );
      },
    }),

    defineCommand({
      id: 'project.show',
      group: 'project',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a project with its codebases',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [],
      schema: inputSchema({ project: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        const [project, codebases] = await Promise.all([
          ctx.api.projects.get(target.id),
          ctx.api.projects.codebases.list(target.id),
        ]);
        return record({ ...project, codebases });
      },
    }),

    defineCommand({
      id: 'project.create',
      group: 'project',
      verb: 'create',
      aliases: ['new'],
      summary: 'Create a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'name', description: 'Project name', required: true }],
      flags: [{ name: 'description', short: 'd', description: 'Description', type: 'string' }],
      schema: inputSchema({ name: z.string().min(1) }, { description: z.string().optional() }),
      output: { kind: 'record', successMessage: 'Created project {id}' },
      async handler(ctx, { args, flags }) {
        return record(
          await ctx.api.projects.create(compact({ name: args.name, description: flags.description })),
        );
      },
    }),

    defineCommand({
      id: 'project.update',
      group: 'project',
      verb: 'update',
      summary: 'Patch a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'description', description: 'New description', type: 'string' },
      ],
      schema: inputSchema(
        { project: z.string() },
        { name: z.string().optional(), description: z.string().optional() },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findProject(ctx, args.project);
        const body = requireSomeUpdate(
          compact({ name: flags.name, description: flags.description }),
          'Pass --name or --description.',
        );
        return record(await ctx.api.projects.update(target.id, body));
      },
    }),

    defineCommand({
      id: 'project.delete',
      group: 'project',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a project',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [forceFlag],
      schema: inputSchema({ project: z.string() }, { force: z.boolean().optional() }),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args, flags }) {
        const target = await findProject(ctx, args.project);
        await ctx.api.projects.remove(target.id, flags.force);
        return ok(`Deleted project ${target.name ?? target.id}.`);
      },
    }),

    // ── Codebases ─────────────────────────────────────────────────
    defineCommand({
      id: 'project.codebase.list',
      group: 'project',
      verb: 'codebase list',
      summary: 'Codebases linked to a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [],
      schema: inputSchema({ project: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'alias', header: 'Alias', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'url', header: 'URL', priority: 2 },
          { key: 'defaultBranch', header: 'Branch', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        return list(await ctx.api.projects.codebases.list(target.id));
      },
    }),

    defineCommand({
      id: 'project.codebase.link',
      group: 'project',
      verb: 'codebase link',
      summary: 'Link a repository or directory to a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai proj codebase link acme --alias core --type git-remote --url https://github.com/acme/core.git',
      ],
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [
        { name: 'alias', description: 'Short name used in prompts and worktrees', type: 'string', required: true },
        { name: 'type', description: 'Codebase type', type: 'string', choices: CODEBASE_TYPES, required: true },
        { name: 'url', description: 'Remote URL (git-remote)', type: 'string' },
        { name: 'localPath', description: 'Path on the server (git-local / local-dir)', type: 'string' },
        { name: 'defaultBranch', description: 'Default branch', type: 'string' },
      ],
      schema: inputSchema(
        { project: z.string() },
        {
          alias: z.string().min(1),
          type: z.enum(CODEBASE_TYPES),
          url: z.string().optional(),
          localPath: z.string().optional(),
          defaultBranch: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Linked codebase {id}' },
      async handler(ctx, { args, flags }) {
        if (flags.type === 'git-remote' && !flags.url) {
          throw CliError.usage('--url is required for a git-remote codebase.');
        }
        if (flags.type !== 'git-remote' && !flags.localPath) {
          throw CliError.usage(`--local-path is required for a ${flags.type} codebase.`, {
            hint: 'The path is resolved on the SERVER, not on this machine.',
          });
        }
        const target = await findProject(ctx, args.project);
        return record(
          await ctx.api.projects.codebases.link(
            target.id,
            compact({
              alias: flags.alias,
              type: flags.type,
              url: flags.url,
              localPath: flags.localPath,
              defaultBranch: flags.defaultBranch,
            }),
          ),
        );
      },
    }),

    defineCommand({
      id: 'project.codebase.fetch',
      group: 'project',
      verb: 'codebase fetch',
      summary: 'Fetch the latest commits for a codebase',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'codebase', description: 'Codebase alias or id', required: true, completes: 'codebase' },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), codebase: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Fetched.' },
      async handler(ctx, { args }) {
        const project = await findProject(ctx, args.project);
        const codebase = await findCodebase(ctx, project.id, args.codebase);
        return record(await ctx.api.projects.codebases.fetch(project.id, codebase.id));
      },
    }),

    defineCommand({
      id: 'project.codebase.branches',
      group: 'project',
      verb: 'codebase branches',
      summary: 'Branches in a codebase',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'codebase', description: 'Codebase alias or id', required: true, completes: 'codebase' },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), codebase: z.string() }, {}),
      output: { kind: 'list', columns: [{ key: 'name', header: 'Branch', priority: 0 }] },
      async handler(ctx, { args }) {
        const project = await findProject(ctx, args.project);
        const codebase = await findCodebase(ctx, project.id, args.codebase);
        const branches = await ctx.api.projects.codebases.branches(project.id, codebase.id);
        return list(branches.map((name) => ({ name })));
      },
    }),

    defineCommand({
      id: 'project.codebase.browse',
      group: 'project',
      verb: 'codebase browse',
      summary: 'List files in a codebase',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'codebase', description: 'Codebase alias or id', required: true, completes: 'codebase' },
        { name: 'path', description: 'Directory within the codebase', required: false },
      ],
      flags: [],
      schema: inputSchema(
        { project: z.string(), codebase: z.string(), path: z.string().optional() },
        {},
      ),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'type', header: 'Type', priority: 1 },
          { key: 'size', header: 'Size', format: 'bytes', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const project = await findProject(ctx, args.project);
        const codebase = await findCodebase(ctx, project.id, args.codebase);
        return list(await ctx.api.projects.codebases.files(project.id, codebase.id, args.path));
      },
    }),

    defineCommand({
      id: 'project.codebase.file',
      group: 'project',
      verb: 'codebase file',
      summary: 'Print a file from a codebase',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'codebase', description: 'Codebase alias or id', required: true, completes: 'codebase' },
        { name: 'path', description: 'File path within the codebase', required: true },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), codebase: z.string(), path: z.string() }, {}),
      output: { kind: 'raw' },
      async handler(ctx, { args }) {
        const project = await findProject(ctx, args.project);
        const codebase = await findCodebase(ctx, project.id, args.codebase);
        const { content } = await ctx.api.projects.codebases.fileContent(
          project.id,
          codebase.id,
          args.path,
        );
        return record(content);
      },
    }),

    defineCommand({
      id: 'project.codebase.unlink',
      group: 'project',
      verb: 'codebase unlink',
      summary: 'Unlink a codebase',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'codebase', description: 'Codebase alias or id', required: true, completes: 'codebase' },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), codebase: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Unlinked.' },
      async handler(ctx, { args }) {
        const project = await findProject(ctx, args.project);
        const codebase = await findCodebase(ctx, project.id, args.codebase);
        await ctx.api.projects.codebases.unlink(project.id, codebase.id);
        return ok(`Unlinked ${codebase.name ?? codebase.id}.`);
      },
    }),

    // ── Configs ───────────────────────────────────────────────────
    defineCommand({
      id: 'project.config.list',
      group: 'project',
      verb: 'config list',
      summary: 'Project-scope agents, prompts, skills and other configs',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [{ name: 'type', description: 'Config type', type: 'string' }],
      schema: inputSchema({ project: z.string() }, { type: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [idColumn, nameColumn, { key: 'type', header: 'Type', priority: 0 }, createdColumn],
      },
      async handler(ctx, { args, flags }) {
        const target = await findProject(ctx, args.project);
        return list(await ctx.api.projects.configs.list(target.id, flags.type));
      },
    }),

    defineCommand({
      id: 'project.config.upload',
      group: 'project',
      verb: 'config upload',
      summary: 'Upload a project config file',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'type', description: 'Config type (agent, prompt, skill, …)', required: true },
        { name: 'file', description: 'Path to the file', required: true, completes: 'file' },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), type: z.string(), file: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Uploaded {id}' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        const file = path.resolve(args.file);
        const content = await fs.readFile(file, 'utf8');
        return record(
          await ctx.api.projects.configs.create(target.id, {
            type: args.type,
            name: path.basename(file),
            content,
          }),
        );
      },
    }),

    defineCommand({
      id: 'project.config.delete',
      group: 'project',
      verb: 'config delete',
      summary: 'Delete a project config',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'config', description: 'Config id', required: true },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), config: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        await ctx.api.projects.configs.remove(target.id, args.config);
        return ok('Deleted config.');
      },
    }),

    // ── MCP ───────────────────────────────────────────────────────
    defineCommand({
      id: 'project.mcp.list',
      group: 'project',
      verb: 'mcp list',
      summary: 'MCP servers configured for a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [],
      schema: inputSchema({ project: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [idColumn, nameColumn, { key: 'type', header: 'Type', priority: 1 }, { key: 'command', header: 'Command', priority: 2 }],
      },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        return list(await ctx.api.projects.mcp.list(target.id));
      },
    }),

    defineCommand({
      id: 'project.mcp.add',
      group: 'project',
      verb: 'mcp add',
      summary: 'Add an MCP server to a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [
        { name: 'name', description: 'Server name', type: 'string', required: true },
        { name: 'type', description: 'Transport', type: 'string', choices: ['stdio', 'http', 'sse'] as const },
        { name: 'command', description: 'Command to spawn (stdio)', type: 'string' },
        { name: 'url', description: 'Endpoint (http/sse)', type: 'string' },
        { name: 'config', description: 'Raw JSON config, overriding the flags above', type: 'string' },
      ],
      schema: inputSchema(
        { project: z.string() },
        {
          name: z.string().min(1),
          type: z.enum(['stdio', 'http', 'sse']).optional(),
          command: z.string().optional(),
          url: z.string().optional(),
          config: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Added MCP server {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findProject(ctx, args.project);
        let body: Record<string, unknown>;
        if (flags.config) {
          try {
            body = JSON.parse(flags.config) as Record<string, unknown>;
          } catch (error) {
            throw new CliError('VALIDATION', '--config is not valid JSON.', {
              hint: error instanceof Error ? error.message : String(error),
            });
          }
          body['name'] = flags.name;
        } else {
          body = compact({
            name: flags.name,
            type: flags.type,
            command: flags.command,
            url: flags.url,
          });
        }
        return record(await ctx.api.projects.mcp.add(target.id, body));
      },
    }),

    defineCommand({
      id: 'project.mcp.remove',
      group: 'project',
      verb: 'mcp remove',
      aliases: ['mcp rm'],
      summary: 'Remove an MCP server from a project',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'server', description: 'MCP server id', required: true },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), server: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        await ctx.api.projects.mcp.remove(target.id, args.server);
        return ok('Removed MCP server.');
      },
    }),

    // ── Worktrees ─────────────────────────────────────────────────
    defineCommand({
      id: 'project.worktree.list',
      group: 'project',
      verb: 'worktree list',
      summary: 'Worktrees carved from a project',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [],
      schema: inputSchema({ project: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'path', header: 'Path', priority: 0 },
          { key: 'branch', header: 'Branch', priority: 1 },
          { key: 'ownerId', header: 'Owner', format: 'id', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        return list(await ctx.api.projects.worktrees.list(target.id));
      },
    }),

    defineCommand({
      id: 'project.worktree.remove',
      group: 'project',
      verb: 'worktree remove',
      summary: 'Remove one worktree',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'project', description: 'Project reference', required: true, completes: 'project' },
        { name: 'worktree', description: 'Worktree id', required: true },
      ],
      flags: [],
      schema: inputSchema({ project: z.string(), worktree: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Removed.' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        await ctx.api.projects.worktrees.remove(target.id, args.worktree);
        return ok('Removed worktree.');
      },
    }),

    defineCommand({
      id: 'project.worktree.cleanup',
      group: 'project',
      verb: 'worktree cleanup',
      summary: 'Garbage-collect orphaned worktrees',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'project', description: 'Project reference', required: true, completes: 'project' }],
      flags: [],
      schema: inputSchema({ project: z.string() }, {}),
      output: { kind: 'record', successMessage: 'Cleanup complete.' },
      async handler(ctx, { args }) {
        const target = await findProject(ctx, args.project);
        return record(await ctx.api.projects.worktrees.cleanup(target.id));
      },
    }),
  ];
}
