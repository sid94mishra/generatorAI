// workspace commands — list, archive, commit, delete, cleanup

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatStatus, formatDate, type TableColumn } from '../output/table.js';

export function registerWorkspaceCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const ws = program.command('workspace').alias('ws').description('Workspace management');

  // ── list ──
  ws
    .command('list')
    .description('List workspaces')
    .option('--status <status>', 'Filter by status')
    .option('--project <id>', 'Filter by project')
    .action(async (cmdOpts: { status?: string; project?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const filters: Record<string, string> = {};
      if (cmdOpts.status) filters['status'] = cmdOpts.status;
      if (cmdOpts.project) filters['projectId'] = cmdOpts.project;
      const workspaces = await client.listWorkspaces(filters);

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status', format: (v) => formatStatus(String(v ?? '')) },
        { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
      ];

      outputList(workspaces as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Workspaces',
        emptyMessage: 'No workspaces found.',
      });
    });

  // ── show ──
  ws
    .command('show <id>')
    .description('Show workspace details')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const workspace = await client.getWorkspace(id);
      outputRecord(workspace as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: 'Workspace',
      });
    });

  // ── archive ──
  ws
    .command('archive <id>')
    .description('Archive a workspace')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.archiveWorkspace(id);
      if (opts['json']) { outputJson({ ok: true, archived: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Workspace archived\n\n`));
    });

  // ── commit ──
  ws
    .command('commit <id>')
    .description('Commit workspace changes')
    .option('--message <msg>', 'Commit message')
    .action(async (id: string, cmdOpts: { message?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      await client.commitWorkspace(id, cmdOpts.message);
      if (opts['json']) { outputJson({ ok: true, committed: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Workspace committed\n\n`));
    });

  // ── delete ──
  ws
    .command('delete <id>')
    .description('Delete a workspace')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.deleteWorkspace(id);
      if (opts['json']) { outputJson({ ok: true, deleted: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Workspace deleted\n\n`));
    });

  // ── cleanup ──
  ws
    .command('cleanup')
    .description('Clean up old workspaces')
    .option('--retention-hours <hours>', 'Retention period in hours')
    .option('--max-disk-mb <mb>', 'Max disk usage in MB')
    .action(async (cmdOpts: { retentionHours?: string; maxDiskMb?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.cleanupWorkspaces(
        cmdOpts.retentionHours ? parseInt(cmdOpts.retentionHours, 10) : undefined,
        cmdOpts.maxDiskMb ? parseInt(cmdOpts.maxDiskMb, 10) : undefined,
      );
      if (opts['json']) { outputJson(result); return; }
      process.stderr.write(chalk.green(`\n  ✓ Cleanup complete\n`));
      process.stderr.write(chalk.dim(`    ${JSON.stringify(result)}\n\n`));
    });
}
