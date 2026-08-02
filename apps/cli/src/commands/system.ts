// system commands — health, health-config, models, status, artifacts, mcp-servers

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import type { TableColumn } from '../output/table.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatDuration } from '../utils/formatDuration.js';

export function registerSystemCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const system = program.command('system').description('System health and status');

  // ── health ──
  system
    .command('health')
    .description('Check server health')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const health = await client.getHealthInfo();

      if (opts['json']) { outputJson(health); return; }

      const uptimeNum = typeof health['uptime'] === 'number' ? health['uptime'] : 0;
      const uptime = formatDuration(new Date(Date.now() - uptimeNum * 1000));

      process.stderr.write(chalk.bold(`\n  GeneratorAI Health\n`));
      process.stderr.write(chalk.dim('  ' + '─'.repeat(40)) + '\n');
      process.stderr.write(`  ${chalk.dim('Status:')}      ${chalk.green(String(health['status'] ?? 'unknown'))}\n`);
      process.stderr.write(`  ${chalk.dim('Uptime:')}      ${uptime}\n`);

      const config = (health['config'] ?? {}) as Record<string, unknown>;
      process.stderr.write(`  ${chalk.dim('Database:')}    ${String(config['dbPath'] ?? 'unknown')}\n`);
      process.stderr.write(`  ${chalk.dim('Workspaces:')} ${String(config['workspacesDir'] ?? 'unknown')}\n`);
      process.stderr.write(`  ${chalk.dim('Log Level:')}  ${String(config['logLevel'] ?? 'unknown')}\n`);

      if (health['activeChats'] !== undefined) {
        process.stderr.write(`  ${chalk.dim('Active Chats:')}  ${health['activeChats']}\n`);
      }
      if (health['activeRuns'] !== undefined) {
        process.stderr.write(`  ${chalk.dim('Active Runs:')}   ${health['activeRuns']}\n`);
      }
      process.stderr.write('\n');
    });

  // ── health-config ──
  system
    .command('health-config')
    .description('Show public (non-sensitive) server configuration')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const config = await client.getHealthConfig();
      outputRecord(config, { json: opts['json'], title: 'Server Configuration' });
    });

  // ── models ──
  system
    .command('models')
    .description('List available AI models')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const models = await client.getCopilotModels();

      if (opts['json']) { outputJson(models); return; }

      if (models.length === 0) {
        process.stderr.write(chalk.dim('\n  No models available. Check Copilot connection.\n\n'));
        return;
      }

      process.stderr.write(chalk.bold(`\n  Available Models (${models.length})\n\n`));
      for (const model of models) {
        const name = model.name ? chalk.dim(` (${model.name})`) : '';
        process.stderr.write(`    ${chalk.cyan(model.id)}${name}\n`);
      }
      process.stderr.write('\n');
    });

  // ── status ──
  system
    .command('status')
    .description('Get Copilot client state')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const state = await client.getCopilotState();
      outputRecord(state, { json: opts['json'], title: 'Copilot Status' });
    });

  // ── artifacts ──
  system
    .command('artifacts')
    .description('List system artifacts')
    .option('--type <type>', 'Filter by type (agent, prompt, skill)')
    .action(async (cmdOpts: { type?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const artifacts = await client.getSystemArtifacts(cmdOpts.type);

      const columns: TableColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'source', label: 'Source' },
      ];
      outputList(artifacts as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'System Artifacts',
        emptyMessage: 'No system artifacts found.',
      });
    });

  // ── mcp-servers ──
  system
    .command('mcp-servers')
    .description('List system MCP servers')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const servers = await client.getSystemMcpServers();

      const columns: TableColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'type', label: 'Type' },
        { key: 'command', label: 'Command' },
      ];
      outputList(servers as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'System MCP Servers',
        emptyMessage: 'No system MCP servers configured.',
      });
    });

  // Also register top-level aliases for convenience
  program
    .command('health')
    .description('Check server health (alias for system health)')
    .action(async () => {
      const healthCmd = system.commands.find((c) => c.name() === 'health');
      if (!healthCmd) throw new Error('health command not registered');
      await healthCmd.parseAsync([], { from: 'user' });
    });

  program
    .command('models')
    .description('List available AI models (alias for system models)')
    .action(async () => {
      const modelsCmd = system.commands.find((c) => c.name() === 'models');
      if (!modelsCmd) throw new Error('models command not registered');
      await modelsCmd.parseAsync([], { from: 'user' });
    });
}
