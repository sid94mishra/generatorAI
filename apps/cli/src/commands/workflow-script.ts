// workflow-script commands — list, show, validate, materialize, run, reload

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatDate, truncate, type TableColumn } from '../output/table.js';

export function registerWorkflowScriptCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const script = program.command('script').alias('sc').description('Workflow scripts (.workflow.mjs)');

  // ── list ──
  script
    .command('list')
    .description('List all discovered workflow scripts')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const scripts = await client.listScripts();

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => truncate(String(v ?? ''), 25) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
        { key: 'stageCount', label: 'Stages' },
        { key: 'profileCount', label: 'Profiles' },
        { key: 'tags', label: 'Tags', format: (v) => {
          const arr = v as string[] | undefined;
          return arr?.length ? arr.join(', ') : '—';
        }},
        { key: 'lastModified', label: 'Modified', format: (v) => formatDate(v as string) },
      ];

      outputList(scripts, columns, {
        json: opts['json'],
        title: 'Workflow Scripts',
        emptyMessage: 'No workflow scripts found. Place .workflow.mjs files in templates/scripts/',
      });
    });

  // ── show ──
  script
    .command('show <id>')
    .description('Show workflow script details')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const data = await client.getScript(id);

      if (opts['json']) { outputJson(data); return; }

      const metadata = data['metadata'] as Record<string, unknown>;
      const stages = data['stages'] as Array<Record<string, unknown>>;
      const edges = data['edges'] as Array<Record<string, unknown>>;

      outputRecord(metadata, {
        title: `Script: ${metadata['name']}`,
        fields: [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'description', label: 'Description', format: (v) => String(v ?? '—') },
          { key: 'filePath', label: 'File' },
          { key: 'stageCount', label: 'Stages' },
          { key: 'profileCount', label: 'Profiles' },
          { key: 'tags', label: 'Tags', format: (v) => {
            const arr = v as string[] | undefined;
            return arr?.length ? arr.join(', ') : '—';
          }},
        ],
      });

      if (stages?.length) {
        process.stderr.write(chalk.dim('\n  Stages:\n'));
        for (const stage of stages) {
          const config = stage['config'] as Record<string, unknown>;
          process.stderr.write(`    ${chalk.cyan(stage['localId'])} → ${config['name']}\n`);
        }
      }

      if (edges?.length) {
        process.stderr.write(chalk.dim('\n  Edges:\n'));
        for (const edge of edges) {
          process.stderr.write(`    ${edge['from']} → ${edge['to']} (${edge['edgeType']})\n`);
        }
      }
    });

  // ── profiles ──
  script
    .command('profiles <id>')
    .description('Show run profiles for a script')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const profiles = await client.getScriptProfiles(id);

      if (opts['json']) { outputJson(profiles); return; }

      const columns: TableColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description', format: (v) => truncate(String(v ?? '—'), 40) },
        { key: 'sessionMode', label: 'Mode', format: (v) => String(v ?? 'auto') },
        { key: 'permissionMode', label: 'Permissions', format: (v) => String(v ?? 'default') },
      ];

      outputList(profiles, columns, {
        json: false,
        title: `Run Profiles for ${id}`,
        emptyMessage: 'No profiles defined in this script.',
      });
    });

  // ── validate ──
  script
    .command('validate <path>')
    .description('Validate a .workflow.mjs script file')
    .action(async (filePath: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.validateScript(filePath);

      if (opts['json']) { outputJson(result); return; }

      if (result.valid) {
        process.stderr.write(chalk.green('\n  ✓ Script is valid\n\n'));
      } else {
        process.stderr.write(chalk.red('\n  ✗ Script validation failed:\n'));
        for (const err of result.errors) {
          process.stderr.write(chalk.red(`    • ${err}\n`));
        }
        process.stderr.write('\n');
        process.exit(1);
      }
    });

  // ── materialize ──
  script
    .command('materialize <id>')
    .description('Create a WorkflowDefinition from a script')
    .option('--name <name>', 'Override workflow name')
    .option('--project <id>', 'Associate with project')
    .action(async (id: string, cmdOpts: { name?: string; project?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.materializeScript(id, {
        name: cmdOpts.name,
        projectId: cmdOpts.project,
      });

      if (opts['json']) { outputJson(result); return; }

      process.stderr.write(chalk.green(`\n  ✓ Script materialized into definition\n`));
      process.stderr.write(chalk.dim(`    Definition ID: ${result['definitionId']}\n`));
      process.stderr.write(chalk.dim(`    Stages: ${result['stageCount']}\n`));
      process.stderr.write(chalk.dim(`    Edges: ${result['edgeCount']}\n`));
      process.stderr.write(chalk.dim(`\n    Run it: generatorai run start ${String(result['definitionId']).slice(0, 8)}\n\n`));
    });

  // ── run ──
  script
    .command('run <id>')
    .description('Materialize and run a script in one step')
    .option('--profile <name>', 'Use a named profile from the script')
    .option('--var <key=value...>', 'Override variables (repeatable)', collectVars, {})
    .option('--project <id>', 'Associate with project')
    .action(async (id: string, cmdOpts: { profile?: string; var?: Record<string, string>; project?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.runScript(id, {
        profileName: cmdOpts.profile,
        variables: cmdOpts.var,
        projectId: cmdOpts.project,
      });

      if (opts['json']) { outputJson(result); return; }

      process.stderr.write(chalk.green(`\n  ✓ Script workflow started\n`));
      process.stderr.write(chalk.dim(`    Definition: ${result.definitionId.slice(0, 8)}\n`));
      process.stderr.write(chalk.dim(`    Run ID: ${result.runId.slice(0, 8)}\n`));
      process.stderr.write(chalk.dim(`    Status: ${result.status}\n`));
      process.stderr.write(chalk.dim(`\n    Monitor: generatorai run show ${result.runId.slice(0, 8)}\n\n`));
    });

  // ── reload ──
  script
    .command('reload [id]')
    .description('Reload scripts (all or specific by ID)')
    .action(async (id?: string) => {
      const opts = program.opts();
      const client = await getClient();

      if (id) {
        const result = await client.reloadScript(id);
        if (opts['json']) { outputJson(result); return; }
        process.stderr.write(chalk.green(`\n  ✓ Reloaded script: ${result['name']}\n\n`));
      } else {
        const result = await client.reloadScripts();
        if (opts['json']) { outputJson(result); return; }
        process.stderr.write(chalk.green(`\n  ✓ Reloaded ${result.count} script(s)\n\n`));
      }
    });
}

/** Helper to collect --var key=value pairs into an object */
function collectVars(value: string, previous: Record<string, string>): Record<string, string> {
  const [key, ...rest] = value.split('=');
  if (key) {
    previous[key] = rest.join('=');
  }
  return previous;
}
