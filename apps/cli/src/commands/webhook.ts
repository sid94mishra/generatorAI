// webhook and hook commands

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputList } from '../output/format.js';
import { type TableColumn } from '../output/table.js';

export function registerWebhookCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const webhook = program.command('webhook').description('Webhook registrations');

  webhook
    .command('list')
    .description('List webhook registrations')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const webhooks = await client.listWebhookRegistrations();

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'url', label: 'URL' },
        { key: 'events', label: 'Events', format: (v) => {
          const arr = v as string[] | undefined;
          return arr?.join(', ') ?? '—';
        }},
      ];

      outputList(webhooks as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Webhook Registrations',
        emptyMessage: 'No webhooks registered.',
      });
    });

  webhook
    .command('create')
    .description('Register an inbound webhook → workflow trigger')
    .requiredOption('--name <name>', 'Registration name')
    .requiredOption('--source <source>', 'Source: github | custom')
    .requiredOption('--event <type>', 'Event type to match (e.g. pull_request, push, custom-trigger-name)')
    .requiredOption('--template <id>', 'Workflow template ID to materialize and run on match')
    .option('--no-auto-start', 'Do not auto-start the run on match')
    .option('--condition <expr>', 'Optional condition expression')
    .option('--session-config <json>', 'Session config as JSON')
    .action(async (cmdOpts: {
      name: string;
      source: string;
      event: string;
      template: string;
      autoStart?: boolean;
      condition?: string;
      sessionConfig?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const params: Record<string, unknown> = {
        name: cmdOpts.name,
        source: cmdOpts.source,
        eventType: cmdOpts.event,
        templateId: cmdOpts.template,
      };
      if (cmdOpts.autoStart === false) params['autoStart'] = false;
      if (cmdOpts.condition) params['condition'] = cmdOpts.condition;
      if (cmdOpts.sessionConfig) {
        try { params['sessionConfig'] = JSON.parse(cmdOpts.sessionConfig); }
        catch {
          process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --session-config\n\n'));
          process.exitCode = 1;
          return;
        }
      }

      const registration = await client.createWebhookRegistration(params);
      if (opts['json']) { outputJson(registration); return; }
      process.stderr.write(chalk.green(`\n  ✓ Webhook registered\n`));
      process.stderr.write(chalk.dim(`    ID: ${registration.id}\n\n`));
    });

  webhook
    .command('delete <id>')
    .description('Delete a webhook registration')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.deleteWebhookRegistration(id);
      if (opts['json']) { outputJson({ ok: true, deleted: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Webhook deleted\n\n`));
    });

  // ── Hooks ──
  const hook = program.command('hook').description('Hook management');

  hook
    .command('phases')
    .description('List available hook phases')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const phases = await client.listHookPhases();

      const columns: TableColumn[] = [
        { key: 'name', label: 'Phase' },
        { key: 'description', label: 'Description' },
      ];

      outputList(phases, columns, {
        json: opts['json'],
        title: 'Hook Phases',
        emptyMessage: 'No hook phases available.',
      });
    });

  hook
    .command('test <sessionId> <phase>')
    .description('Test a hook for a session (dry-run)')
    .option('--type <type>', 'Hook type: script | http | function', 'script')
    .option('--command <cmd>', 'Script command (for type=script)')
    .option('--args <args>', 'Script args (comma-separated)')
    .option('--url <url>', 'HTTP URL (for type=http)')
    .option('--method <method>', 'HTTP method (for type=http)', 'POST')
    .option('--handler <name>', 'Function handler name (for type=function)')
    .option('--name <name>', 'Hook name', 'cli-test-hook')
    .option('--timeout <ms>', 'Hook timeout in milliseconds', '5000')
    .option('--config <json>', 'Full hook config JSON (overrides individual flags)')
    .option('--payload <json>', 'Test payload as JSON (server-side context)')
    .action(async (sessionId: string, phase: string, cmdOpts: {
      type: string;
      command?: string;
      args?: string;
      url?: string;
      method: string;
      handler?: string;
      name: string;
      timeout: string;
      config?: string;
      payload?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();

      let hookConfig: Record<string, unknown>;
      if (cmdOpts.config) {
        try { hookConfig = JSON.parse(cmdOpts.config) as Record<string, unknown>; }
        catch {
          process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --config\n\n'));
          process.exitCode = 1;
          return;
        }
        hookConfig['phase'] = phase;
      } else {
        hookConfig = {
          phase,
          type: cmdOpts.type,
          name: cmdOpts.name,
          enabled: true,
          failurePolicy: 'continue',
          retries: 0,
          timeoutMs: parseInt(cmdOpts.timeout, 10),
          priority: 0,
        };
        if (cmdOpts.type === 'script') {
          if (!cmdOpts.command) {
            process.stderr.write(chalk.red('\n  ✗ --command is required for type=script\n\n'));
            process.exitCode = 1;
            return;
          }
          hookConfig['command'] = cmdOpts.command;
          if (cmdOpts.args) hookConfig['args'] = cmdOpts.args.split(',').map((a) => a.trim());
        } else if (cmdOpts.type === 'http') {
          if (!cmdOpts.url) {
            process.stderr.write(chalk.red('\n  ✗ --url is required for type=http\n\n'));
            process.exitCode = 1;
            return;
          }
          hookConfig['url'] = cmdOpts.url;
          hookConfig['method'] = cmdOpts.method;
        } else if (cmdOpts.type === 'function') {
          if (!cmdOpts.handler) {
            process.stderr.write(chalk.red('\n  ✗ --handler is required for type=function\n\n'));
            process.exitCode = 1;
            return;
          }
          hookConfig['handler'] = cmdOpts.handler;
        }
      }

      if (cmdOpts.payload) {
        try { hookConfig['payload'] = JSON.parse(cmdOpts.payload); }
        catch {
          process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --payload\n\n'));
          process.exitCode = 1;
          return;
        }
      }

      const result = await client.testHook(sessionId, phase, hookConfig);
      if (opts['json']) { outputJson(result); return; }

      process.stderr.write(chalk.green(`\n  ✓ Hook test complete\n`));

      // Format HookResult fields
      const r = result as Record<string, unknown>;
      if (r['variables'] && typeof r['variables'] === 'object' && Object.keys(r['variables'] as object).length > 0) {
        process.stderr.write(chalk.bold(`\n  Variables:\n`));
        for (const [k, v] of Object.entries(r['variables'] as Record<string, unknown>)) {
          process.stderr.write(`    ${chalk.cyan(k)}: ${String(v)}\n`);
        }
      }
      if (Array.isArray(r['contextMessages']) && r['contextMessages'].length > 0) {
        process.stderr.write(chalk.bold(`\n  Context Messages (${r['contextMessages'].length}):\n`));
        for (const msg of r['contextMessages'] as Array<{ content: string }>) {
          const preview = msg.content.length > 100 ? msg.content.slice(0, 100) + '…' : msg.content;
          process.stderr.write(chalk.magenta(`    🪝 ${preview}\n`));
        }
      }
      if (Array.isArray(r['attachments']) && r['attachments'].length > 0) {
        process.stderr.write(chalk.bold(`\n  Attachments (${r['attachments'].length}):\n`));
        for (const att of r['attachments'] as Array<{ filename: string; contentType?: string }>) {
          process.stderr.write(chalk.blue(`    📎 ${att.filename}${att.contentType ? ' (' + att.contentType + ')' : ''}\n`));
        }
      }
      if (r['abort']) {
        process.stderr.write(chalk.red(`\n  ⚠ Abort requested: ${r['abortReason'] ?? 'no reason given'}\n`));
      }
      process.stderr.write('\n');
    });
}
