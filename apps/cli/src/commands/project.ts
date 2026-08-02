// project commands — CRUD, codebases, configs, MCP servers, worktrees

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatDate, truncate, type TableColumn } from '../output/table.js';

async function resolveProjectId(client: CLIPlatformClient, id: string): Promise<string> {
  if (id.length >= 36) return id;
  const projects = await client.listProjects();
  const matches = projects.filter((p) => p.id.startsWith(id));
  if (matches.length === 0) throw new Error(`No project found with ID prefix: ${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous ID "${id}" matches ${matches.length} projects. Use a longer prefix.`);
  return matches[0]!.id;
}

/**
 * Resolve a codebase by full id, id-prefix, or alias within a project — so CLI
 * users can pass the human-friendly alias they linked it with instead of a UUID.
 */
async function resolveCodebaseId(
  client: CLIPlatformClient,
  projectId: string,
  idOrAlias: string,
): Promise<string> {
  const codebases = await client.listCodebases(projectId);
  const byId = codebases.find((c) => c.id === idOrAlias);
  if (byId) return byId.id;
  const byAlias = codebases.filter((c) => c.alias === idOrAlias);
  if (byAlias.length === 1) return byAlias[0]!.id;
  if (byAlias.length > 1) throw new Error(`Ambiguous alias "${idOrAlias}" matches ${byAlias.length} codebases.`);
  const byPrefix = codebases.filter((c) => c.id.startsWith(idOrAlias));
  if (byPrefix.length === 1) return byPrefix[0]!.id;
  if (byPrefix.length > 1) throw new Error(`Ambiguous ID "${idOrAlias}" matches ${byPrefix.length} codebases. Use a longer prefix.`);
  throw new Error(`No codebase found matching "${idOrAlias}" in this project (try its alias or ID).`);
}

export function registerProjectCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const proj = program.command('project').alias('proj').description('Project management');

  // ── list ──
  proj
    .command('list')
    .description('List projects')
    .option('--status <status>', 'Filter by status')
    .action(async (cmdOpts: { status?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const projects = await client.listProjects(cmdOpts.status);

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
        { key: 'description', label: 'Description', format: (v) => truncate(String(v ?? ''), 30) },
        { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
      ];

      outputList(projects as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Projects',
        emptyMessage: 'No projects found. Create one: generatorai project create <name>',
      });
    });

  // ── create ──
  proj
    .command('create <name>')
    .description('Create a new project')
    .option('--description <desc>', 'Project description')
    .action(async (name: string, cmdOpts: { description?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const project = await client.createProject({ name, description: cmdOpts.description });

      if (opts['json']) { outputJson(project); return; }
      process.stderr.write(chalk.green(`\n  ✓ Project created: ${project.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${project.id}\n\n`));
    });

  // ── show ──
  proj
    .command('show <id>')
    .description('Show project details')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveProjectId(client, id);
      const project = await client.getProject(fullId);
      outputRecord(project as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: `Project: ${project.name}`,
      });
    });

  // ── update ──
  const RETENTION_POLICIES = ['immediate', 'hours-24', 'hours-72', 'manual'] as const;
  proj
    .command('update <id>')
    .description('Update a project (metadata and settings)')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--max-codebases <n>', 'Max codebases allowed (1-50)')
    .option('--worktree-retention <policy>', `Worktree retention: ${RETENTION_POLICIES.join(' | ')}`)
    .action(async (id: string, cmdOpts: {
      name?: string;
      description?: string;
      maxCodebases?: string;
      worktreeRetention?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveProjectId(client, id);

      // Map flags into the {name, description, settings} shape the API expects —
      // previously settings (retention / max codebases) could only be set at
      // creation time even though PUT /projects/:id accepts them.
      const params: { name?: string; description?: string; settings?: Record<string, unknown> } = {};
      if (cmdOpts.name !== undefined) params.name = cmdOpts.name;
      if (cmdOpts.description !== undefined) params.description = cmdOpts.description;

      const settings: Record<string, unknown> = {};
      if (cmdOpts.maxCodebases !== undefined) {
        const n = Number(cmdOpts.maxCodebases);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          throw new Error('--max-codebases must be an integer between 1 and 50');
        }
        settings['maxCodebases'] = n;
      }
      if (cmdOpts.worktreeRetention !== undefined) {
        if (!(RETENTION_POLICIES as readonly string[]).includes(cmdOpts.worktreeRetention)) {
          throw new Error(`--worktree-retention must be one of: ${RETENTION_POLICIES.join(', ')}`);
        }
        settings['worktreeRetention'] = cmdOpts.worktreeRetention;
      }
      if (Object.keys(settings).length > 0) params.settings = settings;

      const updated = await client.updateProject(fullId, params);
      if (opts['json']) { outputJson(updated); return; }
      process.stderr.write(chalk.green(`\n  ✓ Project updated: ${updated.name}\n\n`));
    });

  // ── delete ──
  // Without --force the server ARCHIVES the project (soft delete, restorable);
  // --force performs a hard delete (removes files + cascades all data). The
  // command output reflects which actually happened so it never claims a
  // permanent delete when it only archived.
  proj
    .command('delete <id>')
    .description('Archive a project (soft delete). Use --force to permanently delete.')
    .option('--force', 'Permanently delete: remove files and cascade-delete all codebases, configs, and worktrees (not reversible)')
    .action(async (id: string, cmdOpts: { force?: boolean }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveProjectId(client, id);
      await client.deleteProject(fullId, cmdOpts.force);
      const action = cmdOpts.force ? 'deleted' : 'archived';
      if (opts['json']) { outputJson({ ok: true, id: fullId, action }); return; }
      if (cmdOpts.force) {
        process.stderr.write(chalk.green(`\n  ✓ Project permanently deleted\n\n`));
      } else {
        process.stderr.write(
          chalk.green(`\n  ✓ Project archived`) +
          chalk.dim(` (soft delete — re-run with --force to permanently delete)\n\n`),
        );
      }
    });

  // ── codebase subcommands ──
  const codebase = proj.command('codebase').alias('cb').description('Project codebases');

  codebase
    .command('list <projectId>')
    .description('List codebases for a project')
    .action(async (projectId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const codebases = await client.listCodebases(fullProjectId);

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'alias', label: 'Alias' },
        { key: 'type', label: 'Type' },
        { key: 'url', label: 'URL', format: (v) => truncate(String(v ?? '—'), 40) },
      ];

      outputList(codebases as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Codebases',
        emptyMessage: 'No codebases linked.',
      });
    });

  codebase
    .command('link <projectId>')
    .description('Link a codebase to a project')
    .requiredOption('--alias <alias>', 'Codebase alias')
    .requiredOption('--type <type>', 'Type: git-remote, git-local, local-dir')
    .option('--url <url>', 'Git repository URL')
    .option('--path <path>', 'Local path')
    .option('--branch <branch>', 'Default branch')
    .action(async (projectId: string, cmdOpts: {
      alias: string;
      type: string;
      url?: string;
      path?: string;
      branch?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cb = await client.linkCodebase(fullProjectId, {
        alias: cmdOpts.alias,
        type: cmdOpts.type as 'git-remote' | 'git-local' | 'local-dir',
        url: cmdOpts.url,
        localPath: cmdOpts.path,
        defaultBranch: cmdOpts.branch,
      });
      if (opts['json']) { outputJson(cb); return; }
      process.stderr.write(chalk.green(`\n  ✓ Codebase linked: ${cb.alias}\n\n`));
    });

  codebase
    .command('unlink <projectId> <codebaseId>')
    .description('Unlink a codebase from a project')
    .action(async (projectId: string, codebaseId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      await client.unlinkCodebase(fullProjectId, cbId);
      if (opts['json']) { outputJson({ ok: true }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Codebase unlinked\n\n`));
    });

  // ── fetch (git pull/fetch for remote/local-git codebases) ──
  codebase
    .command('fetch <projectId> <codebaseId>')
    .description('Fetch latest from a git codebase (git-remote / git-local)')
    .action(async (projectId: string, codebaseId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      await client.fetchCodebase(fullProjectId, cbId);
      if (opts['json']) { outputJson({ ok: true, codebaseId: cbId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Codebase fetched\n\n`));
    });

  // ── status (clone/fetch state, last error) ──
  codebase
    .command('status <projectId> <codebaseId>')
    .description('Show a codebase status (pending/cloning/ready/error/stale) and last error')
    .action(async (projectId: string, codebaseId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      const status = await client.getCodebaseStatus(fullProjectId, cbId);
      outputRecord(status as Record<string, unknown>, {
        json: opts['json'],
        title: 'Codebase Status',
      });
    });

  // ── branches ──
  codebase
    .command('branches <projectId> <codebaseId>')
    .description('List branches for a git codebase')
    .action(async (projectId: string, codebaseId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      const branches = await client.getCodebaseBranches(fullProjectId, cbId);
      if (opts['json']) { outputJson(branches); return; }
      outputList(
        branches.map((b) => ({ branch: b })),
        [{ key: 'branch', label: 'Branch' }],
        { json: false, title: 'Branches', emptyMessage: 'No branches found.' },
      );
    });

  // ── browse (list files at a path) ──
  codebase
    .command('browse <projectId> <codebaseId> [path]')
    .description('List files/directories in a codebase (gitignore-filtered)')
    .action(async (projectId: string, codebaseId: string, subPath?: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      const entries = await client.browseCodebaseFiles(fullProjectId, cbId, subPath);
      const columns: TableColumn[] = [
        { key: 'type', label: 'Type', format: (v) => (v === 'directory' ? 'dir' : 'file') },
        { key: 'name', label: 'Name' },
        { key: 'size', label: 'Size', format: (v) => (v == null ? '—' : `${v}`) },
        { key: 'path', label: 'Path', format: (v) => truncate(String(v ?? ''), 50) },
      ];
      outputList(entries as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: subPath ? `Files: ${subPath}` : 'Files',
        emptyMessage: 'No files found.',
      });
    });

  // ── read (print file content) ──
  codebase
    .command('read <projectId> <codebaseId> <filePath>')
    .description('Print the contents of a file in a codebase')
    .action(async (projectId: string, codebaseId: string, filePath: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullProjectId = await resolveProjectId(client, projectId);
      const cbId = await resolveCodebaseId(client, fullProjectId, codebaseId);
      const content = await client.getCodebaseFileContent(fullProjectId, cbId, filePath);
      if (opts['json']) { outputJson({ path: filePath, content }); return; }
      process.stdout.write(content.endsWith('\n') ? content : content + '\n');
    });

  // ── artifacts ──
  proj
    .command('artifacts <id>')
    .description('List available artifacts for a project')
    .option('--type <type>', 'Filter by type')
    .action(async (id: string, cmdOpts: { type?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveProjectId(client, id);
      const artifacts = await client.getProjectAvailableArtifacts(fullId, cmdOpts.type);

      const columns: TableColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'source', label: 'Source' },
      ];

      outputList(artifacts as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Project Artifacts',
        emptyMessage: 'No artifacts found.',
      });
    });
}
