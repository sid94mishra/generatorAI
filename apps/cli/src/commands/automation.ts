// automation commands — CRUD, enable/disable, trigger, executions

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatStatus, formatDate, truncate, type TableColumn } from '../output/table.js';
import type { TriggerAutomationBody } from '@generatorai/shared';

export function registerAutomationCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const auto = program.command('automation').alias('auto').description('Automation management');

  // ── list ──
  auto
    .command('list')
    .description('List automations')
    .option('--project <id>', 'Filter by project')
    .action(async (cmdOpts: { project?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const automations = await client.listAutomations(cmdOpts.project);

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 25) },
        { key: 'enabled', label: 'Enabled', format: (v) => v ? chalk.green('✓') : chalk.dim('✗') },
        { key: 'trigger', label: 'Trigger' },
        { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
      ];

      outputList(automations as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Automations',
        emptyMessage: 'No automations found.',
      });
    });

  // ── create ──
  auto
    .command('create')
    .description('Create an automation')
    .requiredOption('--name <name>', 'Automation name')
    .requiredOption('--definition <ids...>', 'Workflow definition ID(s) — space-separated for multiple')
    .option('--trigger <type>', 'Trigger type: webhook, schedule, manual', 'manual')
    .option('--schedule <cron>', 'Cron schedule expression')
    .option('--project <id>', 'Project ID')
    .option('--input-mode <mode>', 'Input mode: single, loop, batch, script (legacy)', 'single')
    .option('--loop-variable <name>', 'Variable name for loop iterations (legacy)')
    .option('--loop-items <json>', 'JSON array of loop items (legacy)')
    .option('--batch-format <format>', 'Batch data format: json, csv, jsonl (legacy)')
    .option('--batch-data <data>', 'Raw batch data string (legacy)')
    .option('--var <pairs...>', 'Variables as key=value pairs')
    .option('--max-concurrency <n>', 'Max concurrent runs (1-10)', '1')
    .option('--on-error <policy>', 'Error policy: continue, stop', 'continue')
    .option('--description <text>', 'Automation description')
    .option('--data-source <json>', 'Data source config JSON (legacy)')
    // ── Track C — schema-driven pipeline ──
    .option('--schema-file <path>', 'Path to JSON file with DataSchema definition')
    .option('--iteration-mode <mode>', 'each_row | group_by | single')
    .option('--group-by <fields>', 'Comma-separated field names for group_by mode')
    .option('--group-variable <name>', 'Variable holding grouped rows (default "items")')
    .option('--default-dataset <path>', 'Path to file with default dataset text')
    .option('--default-dataset-format <fmt>', 'json_array | csv | jsonl (required with --default-dataset)')
    // ── Track A — retry policy ──
    .option('--retry-max <n>', 'Retry: max attempts per iteration', '1')
    .option('--retry-backoff-ms <ms>', 'Retry: initial backoff in ms', '1000')
    .option('--retry-multiplier <n>', 'Retry: backoff multiplier', '2')
    .option('--retry-max-backoff-ms <ms>', 'Retry: cap on backoff delay', '60000')
    .option('--retry-on <classes>', 'Retry: comma-separated error classes (timeout,network,workflow_failed)')
    .action(async (cmdOpts: {
      name: string;
      definition: string[];
      trigger: string;
      schedule?: string;
      project?: string;
      inputMode?: string;
      loopVariable?: string;
      loopItems?: string;
      batchFormat?: string;
      batchData?: string;
      var?: string[];
      maxConcurrency?: string;
      onError?: string;
      description?: string;
      dataSource?: string;
      schemaFile?: string;
      iterationMode?: string;
      groupBy?: string;
      groupVariable?: string;
      defaultDataset?: string;
      defaultDatasetFormat?: string;
      retryMax?: string;
      retryBackoffMs?: string;
      retryMultiplier?: string;
      retryMaxBackoffMs?: string;
      retryOn?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fs = await import('node:fs/promises');

      // Build variables from --var key=value pairs
      const variables: Record<string, unknown> = {};
      if (cmdOpts.var) {
        for (const pair of cmdOpts.var) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            variables[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
          }
        }
      }

      // Parse loop items JSON if provided
      let loopItems: unknown[] | undefined;
      if (cmdOpts.loopItems) {
        try {
          loopItems = JSON.parse(cmdOpts.loopItems);
        } catch { /* will fail server-side validation */ }
      }

      const params: Record<string, unknown> = {
        name: cmdOpts.name,
        workflowIds: cmdOpts.definition,
        triggerType: cmdOpts.trigger,
        inputMode: cmdOpts.inputMode ?? 'single',
      };
      if (cmdOpts.description) params['description'] = cmdOpts.description;
      if (cmdOpts.schedule) params['cronExpression'] = cmdOpts.schedule;
      if (cmdOpts.project) params['projectId'] = cmdOpts.project;
      if (cmdOpts.loopVariable) params['loopVariable'] = cmdOpts.loopVariable;
      if (loopItems) params['loopItems'] = loopItems;
      if (cmdOpts.batchFormat) params['batchDataFormat'] = cmdOpts.batchFormat;
      if (cmdOpts.batchData) params['batchData'] = cmdOpts.batchData;
      if (Object.keys(variables).length > 0) params['variables'] = variables;
      params['maxConcurrency'] = parseInt(cmdOpts.maxConcurrency ?? '1', 10);
      if (cmdOpts.onError) params['onError'] = cmdOpts.onError;

      // Parse data source config JSON
      if (cmdOpts.dataSource) {
        try {
          params['dataSourceConfig'] = JSON.parse(cmdOpts.dataSource);
        } catch {
          process.stderr.write(chalk.red('\n  ✗ Invalid --data-source JSON\n\n'));
          process.exit(1);
        }
      }

      // ── Track C: schema + iteration mode ──
      if (cmdOpts.schemaFile) {
        try {
          const raw = await fs.readFile(cmdOpts.schemaFile, 'utf-8');
          params['dataSchema'] = JSON.parse(raw);
        } catch (err) {
          process.stderr.write(chalk.red(`\n  ✗ Failed to read schema file: ${err instanceof Error ? err.message : String(err)}\n\n`));
          process.exit(1);
        }
      }
      if (cmdOpts.iterationMode) {
        const mode = cmdOpts.iterationMode;
        if (mode === 'each_row') {
          params['iterationMode'] = { kind: 'each_row' };
        } else if (mode === 'group_by') {
          const fields = (cmdOpts.groupBy ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          if (fields.length === 0) {
            process.stderr.write(chalk.red('\n  ✗ --iteration-mode group_by requires --group-by <fields>\n\n'));
            process.exit(1);
          }
          params['iterationMode'] = {
            kind: 'group_by',
            fields,
            ...(cmdOpts.groupVariable ? { groupVariable: cmdOpts.groupVariable } : {}),
          };
        } else if (mode === 'single') {
          params['iterationMode'] = {
            kind: 'single',
            ...(cmdOpts.groupVariable ? { datasetVariable: cmdOpts.groupVariable } : {}),
          };
        } else {
          process.stderr.write(chalk.red(`\n  ✗ Invalid --iteration-mode: ${mode}\n\n`));
          process.exit(1);
        }
      }
      if (cmdOpts.defaultDataset) {
        const fmt = cmdOpts.defaultDatasetFormat;
        if (!fmt || !['json_array', 'csv', 'jsonl'].includes(fmt)) {
          process.stderr.write(chalk.red('\n  ✗ --default-dataset requires --default-dataset-format (json_array | csv | jsonl)\n\n'));
          process.exit(1);
        }
        try {
          const raw = await fs.readFile(cmdOpts.defaultDataset, 'utf-8');
          params['defaultDataset'] = { format: fmt, data: raw };
        } catch (err) {
          process.stderr.write(chalk.red(`\n  ✗ Failed to read default dataset: ${err instanceof Error ? err.message : String(err)}\n\n`));
          process.exit(1);
        }
      }

      // ── Track A: retry policy ──
      const retryMax = parseInt(cmdOpts.retryMax ?? '1', 10);
      if (retryMax > 1) {
        const retryOn = (cmdOpts.retryOn ?? 'workflow_failed')
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is 'timeout' | 'network' | 'workflow_failed' =>
            s === 'timeout' || s === 'network' || s === 'workflow_failed');
        params['retryPolicy'] = {
          maxAttempts: retryMax,
          initialBackoffMs: parseInt(cmdOpts.retryBackoffMs ?? '1000', 10),
          backoffMultiplier: parseFloat(cmdOpts.retryMultiplier ?? '2'),
          maxBackoffMs: parseInt(cmdOpts.retryMaxBackoffMs ?? '60000', 10),
          retryOn: retryOn.length > 0 ? retryOn : ['workflow_failed'],
        };
      }

      const automation = await client.createAutomation(params as unknown as Parameters<typeof client.createAutomation>[0]);

      if (opts['json']) { outputJson(automation); return; }
      process.stderr.write(chalk.green(`\n  ✓ Automation created: ${automation.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${automation.id}\n\n`));
    });

  // ── show ──
  auto
    .command('show <id>')
    .description('Show automation details with executions')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const automation = await client.getAutomation(id);
      outputRecord(automation as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: `Automation: ${automation.name}`,
      });
    });

  // ── enable / disable ──
  auto
    .command('enable <id>')
    .description('Enable an automation')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.enableAutomation(id);
      if (opts['json']) { outputJson({ ok: true, enabled: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Automation enabled\n\n`));
    });

  auto
    .command('disable <id>')
    .description('Disable an automation')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.disableAutomation(id);
      if (opts['json']) { outputJson({ ok: true, disabled: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Automation disabled\n\n`));
    });

  // ── trigger ──
  auto
    .command('trigger <id>')
    .description('Manually trigger an automation')
    .option('--data <path>', 'Path to a dataset file (used for this run only unless --save-default)')
    .option('--data-format <fmt>', 'Format of the dataset file: json_array | csv | jsonl')
    .option('--save-default', 'Persist the supplied dataset as the automation default')
    .option('--idempotency-key <key>', 'Idempotency key for safe retry')
    .action(async (id: string, cmdOpts: {
      data?: string;
      dataFormat?: string;
      saveDefault?: boolean;
      idempotencyKey?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const body: Record<string, unknown> = {};
      if (cmdOpts.data) {
        const fs = await import('node:fs/promises');
        const fmt = cmdOpts.dataFormat;
        if (!fmt || !['json_array', 'csv', 'jsonl'].includes(fmt)) {
          process.stderr.write(chalk.red('\n  ✗ --data requires --data-format (json_array | csv | jsonl)\n\n'));
          process.exit(1);
        }
        try {
          const raw = await fs.readFile(cmdOpts.data, 'utf-8');
          body['dataset'] = { format: fmt, data: raw };
        } catch (err) {
          process.stderr.write(chalk.red(`\n  ✗ Failed to read dataset: ${err instanceof Error ? err.message : String(err)}\n\n`));
          process.exit(1);
        }
      }
      if (cmdOpts.saveDefault) body['saveAsDefault'] = true;

      const execution = await client.triggerAutomation(
        id,
        Object.keys(body).length > 0 ? (body as TriggerAutomationBody) : undefined,
        cmdOpts.idempotencyKey ? { idempotencyKey: cmdOpts.idempotencyKey } : undefined,
      );
      if (opts['json']) { outputJson(execution); return; }
      process.stderr.write(chalk.green(`\n  ✓ Automation triggered\n`));
      process.stderr.write(chalk.dim(`    Execution: ${execution.id}\n\n`));
    });

  // ── update-dataset ──
  auto
    .command('update-dataset <id>')
    .description('Update the default dataset without triggering')
    .requiredOption('--data <path>', 'Path to a dataset file')
    .requiredOption('--data-format <fmt>', 'json_array | csv | jsonl')
    .action(async (id: string, cmdOpts: { data: string; dataFormat: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(cmdOpts.data, 'utf-8');
      const updated = await client.updateAutomation(id, {
        defaultDataset: { format: cmdOpts.dataFormat as 'json_array' | 'csv' | 'jsonl', data: raw },
      } as never);
      if (opts['json']) { outputJson(updated); return; }
      process.stderr.write(chalk.green(`\n  ✓ Default dataset updated\n\n`));
    });

  // ── delete ──
  auto
    .command('delete <id>')
    .description('Delete an automation')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.deleteAutomation(id);
      if (opts['json']) { outputJson({ ok: true, deleted: id }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Automation deleted\n\n`));
    });

  // ── executions ──
  auto
    .command('executions <automationId>')
    .description('List executions for an automation')
    .action(async (automationId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const executions = await client.getExecutionsByAutomation(automationId);

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'status', label: 'Status', format: (v) => formatStatus(String(v ?? '')) },
        { key: 'createdAt', label: 'Started', format: (v) => formatDate(v as string) },
      ];

      outputList(executions as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Executions',
        emptyMessage: 'No executions found.',
      });
    });

  // ── rotate-token ──
  auto
    .command('rotate-token <id>')
    .description('Rotate webhook token for an automation')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.rotateWebhookToken(id);
      if (opts['json']) { outputJson(result); return; }
      process.stderr.write(chalk.green(`\n  ✓ Token rotated\n`));
      process.stderr.write(chalk.dim(`    New token: ${result.token}\n\n`));
    });

  // ── cancel-execution ──
  auto
    .command('cancel-execution <automationId> <executionId>')
    .description('Cancel a running automation execution')
    .action(async (automationId: string, executionId: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.cancelExecution(automationId, executionId);
      if (opts['json']) { outputJson({ ok: true, cancelled: executionId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Execution cancelled\n\n`));
    });
}
