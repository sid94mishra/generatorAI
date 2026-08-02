// harness commands — view and switch the active AI provider

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';

export function registerHarnessCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const harness = program.command('harness').description('View or switch the AI provider (harness)');

  // ── show ──
  harness
    .command('show')
    .description('Show current harness provider')
    .action(async () => {
      const client = await getClient();
      const baseUrl = (client as { baseUrl?: string }).baseUrl ?? 'http://localhost:3100';
      const opts = program.opts();
      try {
        const res = await fetch(`${baseUrl}/api/harness`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { type: string; availableTypes: string[] };

        if (opts['json']) { outputJson(data); return; }

        process.stderr.write(chalk.bold(`\n  AI Provider (Harness)\n`));
        process.stderr.write(chalk.dim('  ' + '─'.repeat(40)) + '\n\n');
        process.stderr.write(`    ${chalk.dim('Active:')}   ${chalk.green.bold(data.type)}\n`);
        process.stderr.write(`    ${chalk.dim('Available:')} ${data.availableTypes.join(', ')}\n\n`);
      } catch (err) {
        process.stderr.write(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
    });

  // ── switch ──
  harness
    .command('switch <type>')
    .description('Switch to a different provider (copilot | anthropic | claude-agent)')
    .action(async (type: string) => {
      const client = await getClient();
      const baseUrl = (client as { baseUrl?: string }).baseUrl ?? 'http://localhost:3100';
      const opts = program.opts();
      try {
        const res = await fetch(`${baseUrl}/api/harness/switch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        });
        const data = (await res.json()) as { message?: string; type?: string; switched?: boolean; error?: { message?: string } };

        if (!res.ok) {
          process.stderr.write(chalk.red(`  Error: ${data.error?.message ?? 'Switch failed'}\n`));
          process.exit(1);
        }

        if (opts['json']) { outputJson(data); return; }

        if (data.switched) {
          process.stderr.write(chalk.green(`\n  ✓ ${data.message}\n\n`));
        } else {
          process.stderr.write(chalk.yellow(`\n  ${data.message}\n\n`));
        }
      } catch (err) {
        process.stderr.write(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
        process.exit(1);
      }
    });
}
