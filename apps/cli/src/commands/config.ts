// config commands — show, set, get, edit, reset + profile CRUD

import type { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { loadCLIConfig, writeDefaultConfig } from '../config/loadConfig.js';
import { getUserConfigFilePath, getUserConfigDir } from '../config/paths.js';
import {
  listProfiles,
  getActiveProfile,
  createProfile,
  useProfile,
  deleteProfile,
} from '../config/profileManager.js';

export function registerConfigCommands(
  program: Command,
  _getClient: () => Promise<CLIPlatformClient>,
): void {
  const config = program.command('config').description('Manage CLI configuration');

  // ── show ──
  config
    .command('show')
    .description('Display resolved configuration')
    .action(async () => {
      const opts = program.opts();
      const resolved = await loadCLIConfig({ verbose: opts['verbose'] });

      if (opts['json']) { outputJson(resolved); return; }

      process.stderr.write(chalk.bold(`\n  GeneratorAI CLI Configuration\n`));
      process.stderr.write(chalk.dim('  ' + '─'.repeat(50)) + '\n');

      process.stderr.write(chalk.bold('\n  Server\n'));
      process.stderr.write(`    ${chalk.dim('URL:')}             ${resolved.server.url}\n`);
      process.stderr.write(`    ${chalk.dim('API Key:')}         ${resolved.server.apiKey ? chalk.green('✓ set') : chalk.dim('not set')}\n`);

      process.stderr.write(chalk.bold('\n  CLI\n'));
      process.stderr.write(`    ${chalk.dim('Output:')}          ${resolved.cli.defaultOutput}\n`);
      process.stderr.write(`    ${chalk.dim('Color:')}           ${resolved.cli.color}\n`);
      process.stderr.write(`    ${chalk.dim('Pager:')}           ${resolved.cli.pager}\n`);
      process.stderr.write(`    ${chalk.dim('Verbosity:')}       ${resolved.cli.streamVerbosity}\n`);
      process.stderr.write(`    ${chalk.dim('Default Model:')}   ${resolved.cli.defaultModel ?? chalk.dim('not set')}\n`);

      process.stderr.write(chalk.bold('\n  TUI\n'));
      process.stderr.write(`    ${chalk.dim('Theme:')}           ${resolved.tui.theme}\n`);
      process.stderr.write(`    ${chalk.dim('Show Usage:')}      ${resolved.tui.showUsage}\n`);
      process.stderr.write(`    ${chalk.dim('Collapse Tools:')}  ${resolved.tui.collapseTools}\n`);

      if (resolved.activeProfile) {
        process.stderr.write(chalk.bold('\n  Active Profile\n'));
        process.stderr.write(`    ${chalk.cyan(resolved.activeProfile)}\n`);
      }

      process.stderr.write('\n');
      process.stderr.write(chalk.dim(`  Config file: ${getUserConfigFilePath()}\n\n`));
    });

  // ── set ──
  config
    .command('set <key> <value>')
    .description('Set a configuration value (e.g., server.url, cli.defaultModel)')
    .action(async (key: string, value: string) => {
      const configPath = getUserConfigFilePath();
      let existing: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch { /* start fresh */ }

      // Parse nested keys
      const keys = key.split('.');
      let target = existing;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (typeof target[k] !== 'object' || target[k] === null || Array.isArray(target[k])) target[k] = {};
        target = target[k] as Record<string, unknown>;
      }

      // Parse value type
      let parsed: unknown = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

      target[keys[keys.length - 1]!] = parsed;

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

      process.stderr.write(chalk.green(`\n  ✓ Set ${key} = ${JSON.stringify(parsed)}\n`));
      process.stderr.write(chalk.dim(`  Saved to: ${configPath}\n\n`));
    });

  // ── get ──
  config
    .command('get <key>')
    .description('Get a configuration value')
    .action(async (key: string) => {
      const opts = program.opts();
      const resolved = await loadCLIConfig();
      const keys = key.split('.');
      let value: unknown = resolved;
      for (const k of keys) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[k];
        } else {
          value = undefined;
          break;
        }
      }

      if (opts['json']) { outputJson({ key, value }); return; }
      process.stdout.write(String(value ?? '') + '\n');
    });

  // ── edit ──
  config
    .command('edit')
    .description('Open config in $EDITOR')
    .action(async () => {
      const configPath = getUserConfigFilePath();
      // Ensure file exists
      try { await fs.access(configPath); } catch {
        const dir = getUserConfigDir();
        await fs.mkdir(dir, { recursive: true });
        await writeDefaultConfig(dir);
      }

      const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'vi';
      try {
        const result = spawnSync(editor, [configPath], { stdio: 'inherit' });
        if (result.error) throw result.error;
      } catch {
        process.stderr.write(chalk.red(`\n  ✗ Failed to open editor: ${editor}\n`));
        process.stderr.write(chalk.dim(`  Set EDITOR env var or edit manually: ${configPath}\n\n`));
      }
    });

  // ── reset ──
  config
    .command('reset')
    .description('Reset configuration to defaults')
    .option('--force', 'Skip confirmation')
    .action(async (cmdOpts: { force?: boolean }) => {
      if (!cmdOpts.force) {
        process.stderr.write(chalk.yellow('\n  ⚠ This will overwrite your config with defaults.\n'));
        process.stderr.write(chalk.dim('  Use --force to confirm.\n\n'));
        return;
      }
      const dir = getUserConfigDir();
      await fs.mkdir(dir, { recursive: true });
      const configPath = await writeDefaultConfig(dir);
      // Force overwrite
      const { CLIConfigSchema } = await import('../config/schema.js');
      const defaults = CLIConfigSchema.parse({});
      await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(defaults, null, 2), 'utf-8');
      process.stderr.write(chalk.green(`\n  ✓ Config reset to defaults\n`));
      process.stderr.write(chalk.dim(`  File: ${configPath}\n\n`));
    });

  // ── profile subcommands ──
  const profile = config.command('profile').description('Manage named profiles');

  profile
    .command('list')
    .description('List all profiles')
    .action(async () => {
      const opts = program.opts();
      const profiles = await listProfiles();
      const active = await getActiveProfile();

      if (opts['json']) { outputJson({ profiles, active }); return; }

      if (profiles.length === 0) {
        process.stderr.write(chalk.dim('\n  No profiles configured.\n'));
        process.stderr.write(chalk.dim('  Create one: generatorai config profile create <name>\n\n'));
        return;
      }

      process.stderr.write(chalk.bold(`\n  Profiles\n\n`));
      for (const name of profiles) {
        const marker = name === active ? chalk.green(' ● ') : '   ';
        process.stderr.write(`${marker}${name}${name === active ? chalk.dim(' (active)') : ''}\n`);
      }
      process.stderr.write('\n');
    });

  profile
    .command('create <name>')
    .description('Create a new profile')
    .option('--server <url>', 'Server URL for this profile')
    .option('--model <model>', 'Default model for this profile')
    .action(async (name: string, cmdOpts: { server?: string; model?: string }) => {
      const profileData: Record<string, unknown> = {};
      if (cmdOpts.server) profileData['server'] = { url: cmdOpts.server };
      if (cmdOpts.model) profileData['cli'] = { defaultModel: cmdOpts.model };
      await createProfile(name, profileData);
      process.stderr.write(chalk.green(`\n  ✓ Profile "${name}" created\n`));
      process.stderr.write(chalk.dim(`  Activate: generatorai config profile use ${name}\n\n`));
    });

  profile
    .command('use <name>')
    .description('Switch to a named profile')
    .action(async (name: string) => {
      await useProfile(name);
      process.stderr.write(chalk.green(`\n  ✓ Switched to profile "${name}"\n\n`));
    });

  profile
    .command('delete <name>')
    .description('Delete a profile')
    .action(async (name: string) => {
      await deleteProfile(name);
      process.stderr.write(chalk.green(`\n  ✓ Profile "${name}" deleted\n\n`));
    });
}
