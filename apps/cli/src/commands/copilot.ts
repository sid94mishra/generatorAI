// copilot commands — conversations, messages, ping

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputList } from '../output/format.js';
import type { TableColumn } from '../output/table.js';

export function registerCopilotCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const copilot = program.command('copilot').description('Copilot management');

  // ── conversations ──
  copilot
    .command('conversations')
    .description('List active Copilot conversations')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const convos = await client.listCopilotConversations();

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID' },
        { key: 'status', label: 'Status' },
        { key: 'createdAt', label: 'Created' },
      ];
      outputList(convos, columns, {
        json: opts['json'],
        title: 'Copilot Conversations',
        emptyMessage: 'No active conversations.',
      });
    });

  // ── messages ──
  copilot
    .command('messages <conversationId>')
    .description('Get messages for a Copilot conversation')
    .action(async (conversationId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const messages = await client.getCopilotConversationMessages(conversationId);

      if (opts['json']) { outputJson(messages); return; }

      if (messages.length === 0) {
        process.stderr.write(chalk.dim('\n  No messages in this conversation.\n\n'));
        return;
      }

      process.stderr.write(chalk.bold(`\n  Messages (${messages.length})\n\n`));
      for (const msg of messages) {
        const role = String(msg['role'] ?? 'unknown');
        const roleColor = role === 'assistant' ? chalk.cyan : role === 'user' ? chalk.green : chalk.dim;
        const content = String(msg['content'] ?? '').slice(0, 200);
        process.stderr.write(`  ${roleColor(role)}: ${content}\n`);
      }
      process.stderr.write('\n');
    });

  // ── ping ──
  copilot
    .command('ping')
    .description('Health ping to Copilot')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.copilotPing();

      if (opts['json']) { outputJson(result); return; }

      if (result.alive) {
        process.stderr.write(chalk.green('\n  ✓ Copilot is alive\n\n'));
      } else {
        process.stderr.write(chalk.red('\n  ✗ Copilot is not responding\n\n'));
        process.exitCode = 1;
      }
    });
}
