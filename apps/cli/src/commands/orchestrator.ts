// orchestrator commands — system workflows, orchestrated runs

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { truncate, type TableColumn } from '../output/table.js';

export function registerOrchestratorCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const orch = program.command('orchestrator').alias('orch').description('Orchestrated workflows');

  // ── templates ──
  orch
    .command('templates')
    .description('List system workflow templates')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const templates = await client.listWorkflowTemplates();

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description', format: (v) => truncate(String(v ?? ''), 40) },
      ];

      outputList(templates as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'System Workflow Templates',
        emptyMessage: 'No system workflow templates available.',
      });
    });

  // ── template show ──
  orch
    .command('template <id>')
    .description('Show details of a system workflow template')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const template = await client.getWorkflowTemplate(id);
      outputRecord(template as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: `Template: ${(template as unknown as Record<string, unknown>)['name'] ?? id}`,
      });
    });

  // ── create-from-template ──
  orch
    .command('create <templateId>')
    .description('Create a workflow definition from a system template')
    .option('--params <json>', 'Template parameters as JSON')
    .action(async (templateId: string, cmdOpts: { params?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      let params = {};
      if (cmdOpts.params) {
        try { params = JSON.parse(cmdOpts.params); }
        catch { process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --params\n\n')); return; }
      }
      const def = await client.createFromTemplate(templateId, params);

      if (opts['json']) { outputJson(def); return; }
      process.stderr.write(chalk.green(`\n  ✓ Created from template: ${def.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${def.id}\n\n`));
    });

  // ── start ──
  orch
    .command('start')
    .description('Start an orchestrated run')
    .requiredOption('--definition <id>', 'Workflow definition ID')
    .option('--project <id>', 'Project ID')
    .option('--vars <json>', 'Variables as JSON')
    .action(async (cmdOpts: { definition: string; project?: string; vars?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const params: Record<string, unknown> = {
        workflowDefinitionId: cmdOpts.definition,
      };
      if (cmdOpts.project) params['projectId'] = cmdOpts.project;
      if (cmdOpts.vars) {
        try { params['variables'] = JSON.parse(cmdOpts.vars); }
        catch { process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --vars\n\n')); return; }
      }

      const result = await client.startOrchestratedRun(params as unknown as Parameters<typeof client.startOrchestratedRun>[0]);

      if (opts['json']) { outputJson(result); return; }
      process.stderr.write(chalk.green(`\n  ✓ Orchestrated run started\n`));
      process.stderr.write(chalk.dim(`    ${JSON.stringify(result)}\n\n`));
    });

  // ── context ──
  orch
    .command('context <runId>')
    .description('Get orchestrator context for a run')
    .action(async (runId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const ctx = await client.getOrchestratorContext(runId);
      outputRecord(ctx as unknown as Record<string, unknown>, {
        json: opts['json'],
        title: 'Orchestrator Context',
      });
    });

  // ── cancel ──
  orch
    .command('cancel <runId>')
    .description('Cancel an orchestrated run')
    .action(async (runId: string) => {
      const opts = program.opts();
      const client = await getClient();
      await client.cancelOrchestratedRun(runId);
      if (opts['json']) { outputJson({ ok: true, cancelled: runId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Orchestrated run cancelled\n\n`));
    });
}
