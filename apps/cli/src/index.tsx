#!/usr/bin/env node
// GeneratorAI CLI — entry point

import { Command } from 'commander';
import chalk from 'chalk';
import { CLI_VERSION, EXIT_CODES, DEFAULT_SERVER_URL } from './utils/constants.js';
import { loadCLIConfig } from './config/loadConfig.js';
import { createClient } from './platform/createClient.js';
import { registerAllCommands } from './commands/index.js';
import { bootstrapUserDir } from './commands/init.js';
import type { CLIPlatformClient } from './platform/types.js';

// ── Program setup ──
const program = new Command();

program
  .name('generatorai')
  .description('GeneratorAI CLI — AI workflow engine from your terminal')
  .version(CLI_VERSION, '-V, --version', 'Show CLI version')
  .option('--json', 'Output as JSON (machine-readable)')
  .option('--server <url>', 'Server URL', DEFAULT_SERVER_URL)
  .option('--api-key <key>', 'API key for authentication')
  .option('--local', 'Run in-process (no server) — embeds the engine via the SDK')
  .option('--config-profile <name>', 'Use a named config profile')
  .option('--verbose', 'Enable verbose output')
  .option('--no-color', 'Disable colored output');

// Lazy singleton: resolved on first command that needs the client
let _clientPromise: Promise<CLIPlatformClient> | undefined;

async function getClient(): Promise<CLIPlatformClient> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const opts = program.opts();
      const cliFlags: Record<string, unknown> = {};
      if (opts['server']) cliFlags['server'] = { url: opts['server'] };
      if (opts['apiKey']) cliFlags['server'] = { ...(cliFlags['server'] as object ?? {}), apiKey: opts['apiKey'] };
      if (opts['configProfile']) cliFlags['activeProfile'] = opts['configProfile'];

      const config = await loadCLIConfig({
        cliFlags,
        verbose: opts['verbose'] as boolean | undefined,
      });

      // Set API key in env so HttpPlatformClient picks it up
      if (config.server.apiKey) {
        process.env['GENERATORAI_API_KEY'] = config.server.apiKey;
      }

      // --local boots the engine in-process (no server required).
      if (opts['local']) {
        const { client } = await createClient({ mode: 'direct', direct: {} });
        return client;
      }

      const { client } = await createClient({
        mode: 'auto',
        serverUrl: config.server.url,
      });
      return client;
    })();
  }
  return _clientPromise;
}

// Register all commands
registerAllCommands(program, getClient);

// ── TUI command ──
program
  .command('tui')
  .description('Launch interactive terminal UI')
  .action(async () => {
    const opts = program.opts();
    const { launchTUI } = await import('./tui/index.js');
    await launchTUI({
      serverUrl: opts['server'] as string | undefined,
      apiKey: opts['apiKey'] as string | undefined,
    });
  });

// ── Signal handling ──
const shutdown = (signal: string) => {
  process.stderr.write(chalk.dim(`\n  Received ${signal}, shutting down...\n`));
  process.exit(EXIT_CODES.CANCELLED);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Error handling ──
program.exitOverride(); // throw instead of process.exit on parse errors

async function main() {
  // Bootstrap ~/.generatorai/ on first use
  await bootstrapUserDir();

  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    // Commander parse errors have `exitCode`
    if (error && typeof error === 'object' && 'exitCode' in error) {
      process.exit((error as { exitCode: number }).exitCode);
    }

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Cannot connect to server')) {
      process.stderr.write(chalk.red(`\n  ✗ ${message}\n\n`));
      process.exit(EXIT_CODES.ERROR);
    }

    if (message.includes('Authentication')) {
      process.stderr.write(chalk.red(`\n  ✗ Authentication failed: ${message}\n`));
      process.stderr.write(chalk.dim('  Set GENERATORAI_API_KEY or use --api-key\n\n'));
      process.exit(EXIT_CODES.AUTH_FAILURE);
    }

    process.stderr.write(chalk.red(`\n  ✗ ${message}\n\n`));

    if (program.opts()['verbose'] && error instanceof Error && error.stack) {
      process.stderr.write(chalk.dim(error.stack) + '\n\n');
    }

    process.exit(EXIT_CODES.ERROR);
  }
}

main();
