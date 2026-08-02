// workflow commands — definition CRUD, stage management, edge management, import/export

import type { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatStatus, formatDate, truncate, type TableColumn } from '../output/table.js';
import { getProjectConfigDir } from '../config/paths.js';

export function registerWorkflowCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const wf = program.command('workflow').alias('wf').description('Workflow definitions');

  // ── list ──
  wf
    .command('list')
    .description('List workflow definitions')
    .action(async () => {
      const opts = program.opts();
      const client = await getClient();
      const defs = await client.listDefinitions();

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
        { key: 'sessionMode', label: 'Mode' },
        { key: 'version', label: 'Ver' },
        { key: 'tags', label: 'Tags', format: (v) => {
          const arr = v as string[] | undefined;
          return arr?.length ? arr.join(', ') : '—';
        }},
        { key: 'updatedAt', label: 'Updated', format: (v) => formatDate(v as string) },
      ];

      outputList(defs as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Workflow Definitions',
        emptyMessage: 'No workflow definitions. Create one: generatorai workflow create <name>',
      });
    });

  // ── create ──
  wf
    .command('create <name>')
    .description('Create a new workflow definition')
    .option('--description <desc>', 'Workflow description')
    .option('--session-mode <mode>', 'Session mode: single, per-stage, auto', 'single')
    .option('--project <id>', 'Associate with a project')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (name: string, cmdOpts: {
      description?: string;
      sessionMode: string;
      project?: string;
      tags?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const def = await client.createDefinition({
        name,
        description: cmdOpts.description,
        sessionMode: cmdOpts.sessionMode as 'single' | 'per-stage' | 'auto',
        projectId: cmdOpts.project,
        tags: cmdOpts.tags?.split(',').map((t) => t.trim()),
      });

      if (opts['json']) { outputJson(def); return; }

      process.stderr.write(chalk.green(`\n  ✓ Workflow created: ${chalk.bold(def.name)}\n`));
      process.stderr.write(chalk.dim(`    ID: ${def.id}\n`));
      process.stderr.write(chalk.dim(`    Mode: ${def.sessionMode}\n`));
      process.stderr.write(chalk.dim(`\n    Add stages: generatorai workflow stage add ${def.id.slice(0, 8)} <name>\n\n`));
    });

  // ── show ──
  wf
    .command('show <id>')
    .description('Show workflow definition with stages and edges')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      const def = await client.getDefinition(fullId);

      if (opts['json']) { outputJson(def); return; }

      outputRecord(def as unknown as Record<string, unknown>, {
        title: `Workflow: ${def.name}`,
        fields: [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'description', label: 'Description', format: (v) => String(v ?? '—') },
          { key: 'sessionMode', label: 'Session Mode' },
          { key: 'version', label: 'Version' },
          { key: 'projectId', label: 'Project', format: (v) => String(v ?? '—') },
          { key: 'tags', label: 'Tags', format: (v) => {
            const arr = v as string[] | undefined;
            return arr?.length ? arr.join(', ') : '—';
          }},
        ],
      });

      // Show stages
      if (def.stages.length > 0) {
        process.stderr.write(chalk.bold(`  Stages (${def.stages.length})\n\n`));
        for (const stage of def.stages.sort((a, b) => a.order - b.order)) {
          const prompts = stage.prompts?.length
            ? chalk.dim(` (${stage.prompts.length} prompt${stage.prompts.length > 1 ? 's' : ''})`)
            : '';
          const hookCount = (stage as unknown as Record<string, unknown>)['hooks'] as unknown[] | undefined;
          const hookInfo = hookCount?.length ? chalk.magenta(` [${hookCount.length} hook${hookCount.length > 1 ? 's' : ''}]`) : '';
          process.stderr.write(`    ${chalk.cyan(String(stage.order))}. ${stage.name}${prompts}${hookInfo}\n`);
          if (stage.description) {
            process.stderr.write(chalk.dim(`       ${truncate(stage.description, 60)}\n`));
          }
          // Show hook details
          if (hookCount?.length) {
            for (const h of hookCount) {
              const hook = h as Record<string, unknown>;
              const enabled = hook['enabled'] !== false ? chalk.green('●') : chalk.dim('○');
              const config = hook['config'] as Record<string, unknown> | undefined;
              const handler = config?.['handlerName'] ?? config?.['command'] ?? config?.['url'] ?? '';
              process.stderr.write(chalk.dim(`       ${enabled} ${hook['phase']}: ${hook['name']} (${hook['type']}${handler ? ': ' + handler : ''})\n`));
            }
          }
        }
        process.stderr.write('\n');
      }

      // Show edges (DAG)
      if (def.edges.length > 0) {
        process.stderr.write(chalk.bold(`  Edges (${def.edges.length})\n\n`));
        const stageMap = new Map(def.stages.map((s) => [s.id, s.name]));
        for (const edge of def.edges) {
          const from = stageMap.get(edge.fromStageId) ?? edge.fromStageId.slice(0, 8);
          const to = stageMap.get(edge.toStageId) ?? edge.toStageId.slice(0, 8);
          const type = edge.edgeType ?? 'on_success';
          process.stderr.write(`    ${from} ${chalk.dim('→')} ${to} ${chalk.dim(`(${type})`)}\n`);
        }
        process.stderr.write('\n');
      }

      // Show variables
      if (def.variables?.length) {
        process.stderr.write(chalk.bold(`  Variables (${def.variables.length})\n\n`));
        for (const v of def.variables) {
          const req = v.required ? chalk.red('*') : '';
          process.stderr.write(`    ${chalk.cyan(v.name)}${req}: ${v.type}`);
          if (v.defaultValue !== undefined) process.stderr.write(chalk.dim(` = ${JSON.stringify(v.defaultValue)}`));
          process.stderr.write('\n');
          if (v.description) process.stderr.write(chalk.dim(`      ${v.description}\n`));
        }
        process.stderr.write('\n');
      }

      // Show workflow-level hooks
      const wfHooks = (def as unknown as Record<string, unknown>)['hooks'] as unknown[] | undefined;
      if (wfHooks?.length) {
        process.stderr.write(chalk.bold(`  Workflow Hooks (${wfHooks.length})\n\n`));
        for (const h of wfHooks) {
          const hook = h as Record<string, unknown>;
          const enabled = hook['enabled'] !== false ? chalk.green('●') : chalk.dim('○');
          const config = hook['config'] as Record<string, unknown> | undefined;
          const handler = config?.['handlerName'] ?? config?.['command'] ?? config?.['url'] ?? '';
          process.stderr.write(`    ${enabled} ${hook['phase']}: ${hook['name']} (${hook['type']}${handler ? ': ' + handler : ''})\n`);
          if (hook['failurePolicy'] && hook['failurePolicy'] !== 'skip') {
            process.stderr.write(chalk.dim(`      Failure: ${hook['failurePolicy']}\n`));
          }
        }
        process.stderr.write('\n');
      }
    });

  // ── update ──
  wf
    .command('update <id>')
    .description('Update a workflow definition')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--session-mode <mode>', 'Session mode: single, per-stage, auto')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (id: string, cmdOpts: {
      name?: string;
      description?: string;
      sessionMode?: string;
      tags?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      const params: Record<string, unknown> = {};
      if (cmdOpts.name) params['name'] = cmdOpts.name;
      if (cmdOpts.description) params['description'] = cmdOpts.description;
      if (cmdOpts.sessionMode) params['sessionMode'] = cmdOpts.sessionMode;
      if (cmdOpts.tags) params['tags'] = cmdOpts.tags.split(',').map((t) => t.trim());

      const updated = await client.updateDefinition(fullId, params);

      if (opts['json']) { outputJson(updated); return; }
      process.stderr.write(chalk.green(`\n  ✓ Workflow updated: ${updated.name}\n\n`));
    });

  // ── delete ──
  wf
    .command('delete <id>')
    .description('Delete a workflow definition')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      await client.deleteDefinition(fullId);

      if (opts['json']) { outputJson({ ok: true, deleted: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Workflow ${fullId.slice(0, 8)} deleted\n\n`));
    });

  // ── validate ──
  wf
    .command('validate <id>')
    .description('Validate a workflow definition (DAG check)')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      const result = await client.validateDefinition(fullId);

      if (opts['json']) { outputJson(result); return; }

      if (result.valid) {
        process.stderr.write(chalk.green(`\n  ✓ Workflow is valid\n\n`));
      } else {
        process.stderr.write(chalk.red(`\n  ✗ Validation errors:\n`));
        for (const err of result.errors) {
          process.stderr.write(chalk.red(`    • ${err}\n`));
        }
        process.stderr.write('\n');
        process.exitCode = 1;
      }
    });

  // ── export ──
  wf
    .command('export <id>')
    .description('Export workflow definition as JSON')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .action(async (id: string, cmdOpts: { output?: string }) => {
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      const exported = await client.exportDefinition(fullId);
      const json = JSON.stringify(exported, null, 2);

      if (cmdOpts.output) {
        await fs.writeFile(cmdOpts.output, json + '\n', 'utf-8');
        process.stderr.write(chalk.green(`\n  ✓ Exported to ${cmdOpts.output}\n\n`));
      } else {
        process.stdout.write(json + '\n');
      }
    });

  // ── import ──
  wf
    .command('import <file>')
    .description('Import workflow definition from JSON file')
    .action(async (file: string) => {
      const opts = program.opts();
      const client = await getClient();
      const content = await fs.readFile(file, 'utf-8');
      let data: Parameters<typeof client.importFromJSON>[0];
      try { data = JSON.parse(content) as Parameters<typeof client.importFromJSON>[0]; }
      catch { process.stderr.write(chalk.red(`\n  ✗ Invalid JSON in file: ${file}\n\n`)); return; }
      const imported = await client.importFromJSON(data);

      if (opts['json']) { outputJson(imported); return; }

      process.stderr.write(chalk.green(`\n  ✓ Imported: ${imported.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${imported.id}\n`));
      process.stderr.write(chalk.dim(`    Stages: ${imported.stages?.length ?? 0}\n\n`));
    });

  // ── stage subcommands ──
  const stage = wf.command('stage').description('Manage stages within a workflow');

  stage
    .command('add <defId> <name>')
    .description('Add a stage to a workflow')
    .option('--description <desc>', 'Stage description')
    .option('--prompt <text>', 'Inline prompt text')
    .option('--prompt-file <path>', 'Prompt from a file')
    .option('--order <n>', 'Stage order (default: append)')
    .option('--agent <name>', 'Agent name for this stage')
    .option('--timeout <ms>', 'Timeout in milliseconds')
    .option('--hooks-file <path>', 'JSON file with hooks array')
    .action(async (defId: string, name: string, cmdOpts: {
      description?: string;
      prompt?: string;
      promptFile?: string;
      order?: string;
      agent?: string;
      timeout?: string;
      hooksFile?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullDefId = await resolveDefId(client, defId);

      const prompts = [];
      if (cmdOpts.prompt) {
        prompts.push({ label: 'main', text: cmdOpts.prompt, waitForCompletion: true });
      }
      if (cmdOpts.promptFile) {
        const text = await fs.readFile(cmdOpts.promptFile, 'utf-8');
        prompts.push({ label: 'main', text, source: 'file' as const, filePath: cmdOpts.promptFile, waitForCompletion: true });
      }

      let hooks: unknown[] | undefined;
      if (cmdOpts.hooksFile) {
        try {
          const hooksContent = await fs.readFile(cmdOpts.hooksFile, 'utf-8');
          const parsed = JSON.parse(hooksContent);
          hooks = Array.isArray(parsed) ? parsed : parsed.hooks ?? [parsed];
        } catch (err) {
          process.stderr.write(chalk.red(`\n  ✗ Cannot read hooks file: ${err instanceof Error ? err.message : String(err)}\n\n`));
          return;
        }
      }

      const stageParams: Record<string, unknown> = {
        name,
        description: cmdOpts.description,
        prompts: prompts.length > 0 ? prompts : undefined,
        order: cmdOpts.order ? parseInt(cmdOpts.order, 10) : undefined,
        agentName: cmdOpts.agent,
        timeoutMs: cmdOpts.timeout ? parseInt(cmdOpts.timeout, 10) : undefined,
      };
      if (hooks) stageParams['hooks'] = hooks;

      const stage = await client.addStage(fullDefId, stageParams as Parameters<typeof client.addStage>[1]);

      if (opts['json']) { outputJson(stage); return; }

      process.stderr.write(chalk.green(`\n  ✓ Stage added: ${stage.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${stage.id}\n`));
      process.stderr.write(chalk.dim(`    Order: ${stage.order}\n`));
      if (hooks?.length) process.stderr.write(chalk.magenta(`    Hooks: ${hooks.length}\n`));
      process.stderr.write('\n');
    });

  stage
    .command('update <defId> <stageId>')
    .description('Update a stage')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--prompt <text>', 'New inline prompt')
    .option('--order <n>', 'New order')
    .option('--hooks-file <path>', 'JSON file with hooks array (replaces existing)')
    .option('--clear-hooks', 'Remove all hooks from this stage')
    .action(async (defId: string, stageId: string, cmdOpts: {
      name?: string;
      description?: string;
      prompt?: string;
      order?: string;
      hooksFile?: string;
      clearHooks?: boolean;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullDefId = await resolveDefId(client, defId);
      const params: Record<string, unknown> = {};
      if (cmdOpts.name) params['name'] = cmdOpts.name;
      if (cmdOpts.description) params['description'] = cmdOpts.description;
      if (cmdOpts.order) params['order'] = parseInt(cmdOpts.order, 10);
      if (cmdOpts.prompt) {
        params['prompts'] = [{ label: 'main', text: cmdOpts.prompt, waitForCompletion: true }];
      }
      if (cmdOpts.clearHooks) {
        params['hooks'] = [];
      } else if (cmdOpts.hooksFile) {
        try {
          const hooksContent = await fs.readFile(cmdOpts.hooksFile, 'utf-8');
          const parsed = JSON.parse(hooksContent);
          params['hooks'] = Array.isArray(parsed) ? parsed : parsed.hooks ?? [parsed];
        } catch (err) {
          process.stderr.write(chalk.red(`\n  ✗ Cannot read hooks file: ${err instanceof Error ? err.message : String(err)}\n\n`));
          return;
        }
      }

      const updated = await client.updateStage(fullDefId, stageId, params);

      if (opts['json']) { outputJson(updated); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage updated: ${updated.name}\n`));
      const updatedHooks = (updated as unknown as Record<string, unknown>)['hooks'] as unknown[] | undefined;
      if (updatedHooks?.length) process.stderr.write(chalk.magenta(`    Hooks: ${updatedHooks.length}\n`));
      process.stderr.write('\n');
    });

  stage
    .command('delete <defId> <stageId>')
    .description('Remove a stage from a workflow')
    .action(async (defId: string, stageId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullDefId = await resolveDefId(client, defId);
      await client.deleteStage(fullDefId, stageId);

      if (opts['json']) { outputJson({ ok: true, deleted: stageId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage deleted\n\n`));
    });

  // ── edge subcommands ──
  const edge = wf.command('edge').description('Manage edges (connections) between stages');

  edge
    .command('add <defId> <fromStageId> <toStageId>')
    .description('Add an edge between two stages')
    .option('--type <type>', 'Edge type: on_success, on_failure, on_completion, always', 'on_success')
    .action(async (defId: string, fromStageId: string, toStageId: string, cmdOpts: { type: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullDefId = await resolveDefId(client, defId);
      const newEdge = await client.addEdge(fullDefId, {
        fromStageId,
        toStageId,
        edgeType: cmdOpts.type as 'on_success' | 'on_failure' | 'on_completion' | 'always',
      });

      if (opts['json']) { outputJson(newEdge); return; }
      process.stderr.write(chalk.green(`\n  ✓ Edge added: ${fromStageId.slice(0, 8)} → ${toStageId.slice(0, 8)}\n\n`));
    });

  edge
    .command('delete <defId> <edgeId>')
    .description('Remove an edge')
    .action(async (defId: string, edgeId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullDefId = await resolveDefId(client, defId);
      await client.deleteEdge(fullDefId, edgeId);

      if (opts['json']) { outputJson({ ok: true, deleted: edgeId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Edge deleted\n\n`));
    });

  // ── from-template (system) ──
  wf
    .command('from-template <templateId>')
    .description('Create workflow from a system template')
    .option('--name <name>', 'Override name')
    .action(async (templateId: string, cmdOpts: { name?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const def = await client.importFromTemplate(templateId, cmdOpts.name);

      if (opts['json']) { outputJson(def); return; }
      process.stderr.write(chalk.green(`\n  ✓ Created from template: ${def.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${def.id}\n\n`));
    });

  // ── Local template management ──
  const tpl = wf.command('template').alias('tpl').description('Local workflow templates');

  tpl
    .command('list')
    .description('List local templates from .generatorai/templates/')
    .action(async () => {
      const opts = program.opts();
      const templatesDir = path.join(getProjectConfigDir(), 'templates');
      try {
        const files = await fs.readdir(templatesDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
          if (opts['json']) { outputJson([]); return; }
          process.stderr.write(chalk.dim(`\n  No local templates found in ${templatesDir}\n\n`));
          return;
        }

        const templates: Array<Record<string, unknown>> = [];
        for (const file of jsonFiles) {
          try {
            const content = await fs.readFile(path.join(templatesDir, file), 'utf-8');
            const parsed = JSON.parse(content) as Record<string, unknown>;
            templates.push({
              file,
              name: parsed['name'] ?? file,
              description: parsed['description'] ?? '—',
              stages: Array.isArray(parsed['stages']) ? (parsed['stages'] as unknown[]).length : 0,
            });
          } catch {
            templates.push({ file, name: file, description: '(parse error)', stages: 0 });
          }
        }

        const columns: TableColumn[] = [
          { key: 'file', label: 'File' },
          { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
          { key: 'stages', label: 'Stages' },
          { key: 'description', label: 'Description', format: (v) => truncate(String(v ?? ''), 40) },
        ];

        outputList(templates, columns, {
          json: opts['json'],
          title: 'Local Workflow Templates',
          emptyMessage: 'No local templates found.',
        });
      } catch {
        process.stderr.write(chalk.dim(`\n  No .generatorai/templates/ directory. Run: generatorai init\n\n`));
      }
    });

  tpl
    .command('create <file>')
    .description('Create a workflow from a local template file')
    .option('--name <name>', 'Override workflow name')
    .action(async (file: string, cmdOpts: { name?: string }) => {
      const opts = program.opts();
      const client = await getClient();

      // Resolve file path: check .generatorai/templates/ first, then absolute/relative
      let filePath = file;
      if (!path.isAbsolute(file) && !file.includes(path.sep)) {
        const localPath = path.join(getProjectConfigDir(), 'templates', file);
        try {
          await fs.access(localPath);
          filePath = localPath;
        } catch {
          // Try as-is (relative to cwd)
        }
      }

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        process.stderr.write(chalk.red(`\n  ✗ Cannot read file: ${filePath}\n\n`));
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(content) as Record<string, unknown>;
      } catch {
        process.stderr.write(chalk.red(`\n  ✗ Invalid JSON in: ${filePath}\n\n`));
        return;
      }

      // Override name if provided
      if (cmdOpts.name) data['name'] = cmdOpts.name;

      const imported = await client.importFromJSON(data as Parameters<typeof client.importFromJSON>[0]);

      if (opts['json']) { outputJson(imported); return; }
      process.stderr.write(chalk.green(`\n  ✓ Created from local template: ${imported.name}\n`));
      process.stderr.write(chalk.dim(`    ID: ${imported.id}\n`));
      process.stderr.write(chalk.dim(`    Stages: ${imported.stages?.length ?? 0}\n\n`));
    });

  // ── config (show detailed workflow config) ──
  wf
    .command('config <id>')
    .description('Show detailed configuration for a workflow')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveDefId(client, id);
      const def = await client.getDefinition(fullId);

      if (opts['json']) { outputJson(def); return; }

      // Show comprehensive config
      process.stderr.write(chalk.bold.cyan(`\n  Workflow Configuration: ${def.name}\n`));
      process.stderr.write(chalk.dim(`  ${'─'.repeat(50)}\n`));
      process.stderr.write(`  ID:           ${def.id}\n`);
      process.stderr.write(`  Session Mode: ${def.sessionMode}\n`);
      process.stderr.write(`  Version:      ${def.version}\n`);
      if (def.description) process.stderr.write(`  Description:  ${def.description}\n`);
      if (def.tags.length > 0) process.stderr.write(`  Tags:         ${def.tags.join(', ')}\n`);

      // Variables
      if (def.variables.length > 0) {
        process.stderr.write(chalk.bold(`\n  Variables (${def.variables.length}):\n`));
        for (const v of def.variables) {
          const req = v.required ? chalk.red('*') : ' ';
          const defVal = v.defaultValue !== undefined ? chalk.dim(` [default: ${String(v.defaultValue)}]`) : '';
          process.stderr.write(`    ${req} ${v.name} (${v.type}): ${v.label}${defVal}\n`);
          if (v.description) process.stderr.write(chalk.dim(`        ${v.description}\n`));
          if (v.options?.length) process.stderr.write(chalk.dim(`        Options: ${v.options.join(', ')}\n`));
        }
      }

      // Stages
      const stages = (def as unknown as Record<string, unknown>)['stages'] as Array<Record<string, unknown>> | undefined;
      if (stages && stages.length > 0) {
        process.stderr.write(chalk.bold(`\n  Stages (${stages.length}):\n`));
        for (const s of stages) {
          const prompts = s['prompts'] as Array<Record<string, unknown>> | undefined;
          const hooks = s['hooks'] as Array<Record<string, unknown>> | undefined;
          const hookInfo = hooks?.length ? chalk.magenta(` [${hooks.length} hook${hooks.length > 1 ? 's' : ''}]`) : '';
          process.stderr.write(`    ${s['order']}. ${s['name']} — ${prompts?.length ?? 0} prompt(s)${hookInfo}\n`);
          if (s['agentName']) process.stderr.write(chalk.dim(`       Agent: ${s['agentName']}\n`));
          if (s['timeoutMs']) process.stderr.write(chalk.dim(`       Timeout: ${s['timeoutMs']}ms\n`));
          // Show hook details
          if (hooks?.length) {
            for (const h of hooks) {
              const enabled = h['enabled'] !== false ? chalk.green('●') : chalk.dim('○');
              const config = h['config'] as Record<string, unknown> | undefined;
              const handler = config?.['handlerName'] ?? config?.['command'] ?? config?.['url'] ?? '';
              process.stderr.write(chalk.dim(`       ${enabled} ${h['phase']}: ${h['name']} (${h['type']}${handler ? ': ' + handler : ''})\n`));
            }
          }
        }
      }

      // Show workflow-level hooks
      const wfHooks = (def as unknown as Record<string, unknown>)['hooks'] as Array<Record<string, unknown>> | undefined;
      if (wfHooks?.length) {
        process.stderr.write(chalk.bold(`\n  Workflow Hooks (${wfHooks.length}):\n`));
        for (const h of wfHooks) {
          const enabled = h['enabled'] !== false ? chalk.green('●') : chalk.dim('○');
          const config = h['config'] as Record<string, unknown> | undefined;
          const handler = config?.['handlerName'] ?? config?.['command'] ?? config?.['url'] ?? '';
          process.stderr.write(`    ${enabled} ${h['phase']}: ${h['name']} (${h['type']}${handler ? ': ' + handler : ''})\n`);
        }
      }
      process.stderr.write('\n');
    });
}

async function resolveDefId(client: CLIPlatformClient, id: string): Promise<string> {
  if (id.length >= 36) return id;

  const defs = await client.listDefinitions();
  const matches = defs.filter((d) => d.id.startsWith(id));
  if (matches.length === 0) throw new Error(`No workflow found with ID prefix: ${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous ID "${id}" matches ${matches.length} workflows. Use a longer prefix.`);
  return matches[0]!.id;
}
