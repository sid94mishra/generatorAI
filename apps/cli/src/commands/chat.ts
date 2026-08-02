// chat commands — full chat lifecycle: create, list, show, send, messages, watch, delete

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatStatus, formatDate, truncate, type TableColumn } from '../output/table.js';
import { EventRenderer } from '../streaming/EventRenderer.js';
import type { StreamVerbosity } from '../streaming/EventRenderer.js';

export function registerChatCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const chat = program.command('chat').description('Chat conversations with AI');

  // ── list ──
  chat
    .command('list')
    .description('List chats')
    .option('--status <status>', 'Filter by status (active, archived)')
    .option('--project <id>', 'Filter by project ID')
    .action(async (cmdOpts: { status?: string; project?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const filter: Record<string, string> = {};
      if (cmdOpts.status) filter['status'] = cmdOpts.status;
      const chats = await client.listChats(filter);

      const filtered = cmdOpts.project
        ? chats.filter((c) => 'projectId' in c && c.projectId === cmdOpts.project)
        : chats;

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
        { key: 'status', label: 'Status', format: (v) => formatStatus(String(v ?? '')) },
        { key: 'model', label: 'Model', format: (v) => String(v ?? chalk.dim('default')) },
        { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
      ];

      outputList(filtered as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Chats',
        emptyMessage: 'No chats found. Create one with: generatorai chat create <name>',
      });
    });

  // ── create ──
  chat
    .command('create <name>')
    .description('Create a new chat')
    .option('--model <model>', 'AI model to use')
    .option('--project <id>', 'Associate with a project')
    .option('--description <desc>', 'Chat description')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--worktree', 'Create a dedicated worktree')
    .action(async (name: string, cmdOpts: {
      model?: string;
      project?: string;
      description?: string;
      tags?: string;
      worktree?: boolean;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const chat = await client.createChat({
        name,
        description: cmdOpts.description,
        model: cmdOpts.model,
        projectId: cmdOpts.project,
        createWorktree: cmdOpts.worktree,
        tags: cmdOpts.tags ? cmdOpts.tags.split(',').map((t) => t.trim()) : undefined,
      });

      if (opts['json']) { outputJson(chat); return; }

      process.stderr.write(chalk.green(`\n  ✓ Chat created: ${chalk.bold(chat.name)}\n`));
      process.stderr.write(chalk.dim(`    ID: ${chat.id}\n`));
      process.stderr.write(chalk.dim(`    Session: ${chat.sessionId}\n`));
      if (chat.model) process.stderr.write(chalk.dim(`    Model: ${chat.model}\n`));
      process.stderr.write(chalk.dim(`\n    Send a message: generatorai chat send ${chat.id.slice(0, 8)} "your prompt"\n\n`));
    });

  // ── show ──
  chat
    .command('show <id>')
    .description('Show chat details')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveId(client, id);
      const chat = await client.getChat(fullId);

      outputRecord(chat as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: `Chat: ${chat.name}`,
        fields: [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', format: (v) => formatStatus(String(v)) },
          { key: 'sessionId', label: 'Session' },
          { key: 'model', label: 'Model', format: (v) => String(v ?? 'default') },
          { key: 'projectId', label: 'Project', format: (v) => String(v ?? '—') },
          { key: 'tags', label: 'Tags', format: (v) => {
            const arr = v as string[] | undefined;
            return arr?.length ? arr.join(', ') : '—';
          }},
          { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
          { key: 'updatedAt', label: 'Updated', format: (v) => formatDate(v as string) },
        ],
      });
    });

  // ── send ──
  chat
    .command('send <id> <prompt>')
    .description('Send a message to a chat')
    .option('--no-stream', 'Do not stream the response')
    .option('--verbosity <level>', 'Stream verbosity: minimal, normal, verbose', 'normal')
    .option('--thinking', 'Show reasoning/thinking output')
    .action(async (id: string, prompt: string, cmdOpts: {
      stream: boolean;
      verbosity: string;
      thinking?: boolean;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveId(client, id);
      const chat = await client.getChat(fullId);

      // Show user message
      if (!opts['json']) {
        process.stderr.write(chalk.green(`\n  You: `) + prompt + '\n');
      }

      // Send the prompt (fire-and-forget)
      await client.sendChatPrompt(fullId, prompt);

      if (!cmdOpts.stream || opts['json']) {
        // Non-streaming: just confirm sent
        if (opts['json']) {
          outputJson({ sent: true, chatId: fullId, prompt });
        } else {
          process.stderr.write(chalk.dim('  Message sent. Use --stream (default) or `chat messages` to see response.\n\n'));
        }
        return;
      }

      // Stream the response
      const renderer = new EventRenderer({
        verbosity: cmdOpts.verbosity as StreamVerbosity,
        showThinking: cmdOpts.thinking,
        onComplete: () => {
          process.stderr.write('\n');
        },
      });

      await new Promise<void>((resolve) => {
        let idleTimeout: ReturnType<typeof setTimeout>;
        const completionRenderer = new EventRenderer({
          ...renderer,
          verbosity: cmdOpts.verbosity as StreamVerbosity,
          showThinking: cmdOpts.thinking,
          onComplete: () => {
            // Give a small delay for any trailing events
            clearTimeout(idleTimeout);
            idleTimeout = setTimeout(resolve, 500);
          },
        });

        const unsubscribe = client.subscribeToChatEvents(
          chat.sessionId,
          (event) => {
            completionRenderer.handleEvent(event);
          },
          {},
        );

        // Safety timeout: 5 minutes
        const safetyTimeout = setTimeout(() => {
          unsubscribe();
          process.stderr.write(chalk.dim('\n  (stream timeout after 5m)\n'));
          resolve();
        }, 5 * 60 * 1000);

        // Override completion to also cleanup
        const origComplete = completionRenderer['opts'].onComplete;
        completionRenderer['opts'].onComplete = () => {
          origComplete();
          clearTimeout(safetyTimeout);
          // Wait a beat then close
          setTimeout(() => {
            unsubscribe();
            resolve();
          }, 200);
        };
      });
    });

  // ── messages ──
  chat
    .command('messages <id>')
    .description('Show message history for a chat')
    .option('--limit <n>', 'Max messages to show', '50')
    .option('--offset <n>', 'Skip first N messages', '0')
    .action(async (id: string, cmdOpts: { limit: string; offset: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveId(client, id);
      const messages = await client.getChatMessages(
        fullId,
        parseInt(cmdOpts.limit, 10),
        parseInt(cmdOpts.offset, 10),
      );

      if (opts['json']) { outputJson(messages); return; }

      if (messages.length === 0) {
        process.stderr.write(chalk.dim('\n  No messages yet.\n\n'));
        return;
      }

      process.stderr.write(chalk.bold(`\n  Messages (${messages.length})\n\n`));

      for (const msg of messages) {
        const role = String(msg.role);
        const content = msg.content || '';
        const time = formatDate(msg.timestamp as unknown as string);

        let roleDisplay: string;
        switch (role) {
          case 'user':
            roleDisplay = chalk.green.bold('You');
            break;
          case 'assistant':
            roleDisplay = chalk.cyan.bold('AI');
            break;
          case 'system':
            roleDisplay = chalk.dim('System');
            break;
          case 'tool':
            roleDisplay = chalk.yellow(`🔧 ${msg.toolName ?? 'tool'}`);
            break;
          default:
            roleDisplay = chalk.dim(role);
        }

        process.stderr.write(`  ${roleDisplay}  ${time}\n`);

        if (role === 'tool' && msg.toolResult) {
          const resultStr = typeof msg.toolResult === 'string'
            ? msg.toolResult
            : JSON.stringify(msg.toolResult, null, 2);
          process.stderr.write(chalk.dim(`  ${truncate(resultStr, 200)}\n`));
        } else {
          // Indent content
          const lines = content.split('\n');
          for (const line of lines.slice(0, 20)) {
            process.stderr.write(`  ${line}\n`);
          }
          if (lines.length > 20) {
            process.stderr.write(chalk.dim(`  ... (${lines.length - 20} more lines)\n`));
          }
        }
        process.stderr.write('\n');
      }
    });

  // ── watch ──
  chat
    .command('watch <id>')
    .description('Watch live events for a chat')
    .option('--filter <kinds>', 'Comma-separated event kind prefixes (e.g., harness.,chat.)')
    .option('--verbosity <level>', 'Stream verbosity: minimal, normal, verbose', 'normal')
    .action(async (id: string, cmdOpts: { filter?: string; verbosity: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveId(client, id);
      const chat = await client.getChat(fullId);

      process.stderr.write(chalk.bold(`\n  Watching chat: ${chat.name}\n`));
      process.stderr.write(chalk.dim('  Press Ctrl+C to stop.\n\n'));

      const renderer = new EventRenderer({
        verbosity: cmdOpts.verbosity as StreamVerbosity,
      });

      const filter = cmdOpts.filter?.split(',').map((f) => f.trim());

      const unsubscribe = client.subscribeToChatEvents(
        chat.sessionId,
        (event) => {
          if (opts['json']) {
            outputJson(event);
          } else {
            renderer.handleEvent(event);
          }
        },
        {},
      );

      // Keep alive until Ctrl+C
      await new Promise<void>((resolve) => {
        const handler = () => {
          unsubscribe();
          process.stderr.write(chalk.dim('\n\n  Stopped watching.\n\n'));
          process.removeListener('SIGINT', handler);
          resolve();
        };
        process.once('SIGINT', handler);
      });
    });

  // ── delete ──
  chat
    .command('delete <id>')
    .description('Archive/delete a chat')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveId(client, id);
      await client.archiveChat(fullId);

      if (opts['json']) { outputJson({ ok: true, archived: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Chat ${fullId.slice(0, 8)} archived\n\n`));
    });
}

/**
 * Resolve a potentially short ID to full UUID by listing chats and matching prefix.
 * If the ID is already a full UUID (36 chars), returns as-is.
 */
async function resolveId(client: CLIPlatformClient, id: string): Promise<string> {
  if (id.length >= 36) return id;

  // Try prefix match
  const chats = await client.listChats();
  const matches = chats.filter((c) => c.id.startsWith(id));

  if (matches.length === 0) {
    throw new Error(`No chat found with ID prefix: ${id}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ID "${id}" matches ${matches.length} chats. Use a longer prefix.`);
  }
  return matches[0]!.id;
}
