// ────────────────────────────────────────────────────────────────
// `generatorai agent …` — first-class Agent management (AGT-01)
//
//   generatorai agent list [--scope] [--role] [--project]
//   generatorai agent show <id>
//   generatorai agent create --file <path> [--scope] [--project] [--overwrite]
//   generatorai agent export <id> [--out <path>]
//   generatorai agent delete <id> [--force]
//   generatorai agent usage <id>
//   generatorai agent resolve [--ref] [--add-skill] [--add-mcp] [--scope]
//
// Authoring happens through `.agent.md` documents rather than a wall of
// flags: the same file is what the web editor exports and what
// `templates/system/artifacts/agents/` ships, so an agent stays portable
// between an installation, a repository and a teammate.
// ────────────────────────────────────────────────────────────────

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import type { TableColumn } from '../output/table.js';
import { outputList, outputRecord } from '../output/format.js';
import type { Agent, ResolutionWarning, ResolvedAgentProjection } from '@generatorai/shared';

/** Core emits machine-readable warnings; the CLI is the copy layer. */
function warningLine(w: ResolutionWarning): string {
  const params = Object.entries(w.params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return `${w.code}${params ? ` (${params})` : ''}`;
}

function printWarnings(warnings: ResolutionWarning[] | undefined): void {
  for (const w of warnings ?? []) {
    process.stderr.write(chalk.yellow(`  ! ${warningLine(w)}\n`));
  }
}

function printProjection(p: ResolvedAgentProjection): void {
  process.stdout.write(chalk.bold('\n  Effective capabilities\n'));
  process.stdout.write(chalk.dim('  ' + '─'.repeat(48)) + '\n');
  if (p.driving) {
    process.stdout.write(
      `  ${chalk.dim('Agent:')}   ${chalk.cyan(p.driving.name)} (${p.driving.ref}, ${p.driving.role})\n`,
    );
  }
  process.stdout.write(
    `  ${chalk.dim('Skills:')}  ${p.skills.names.length ? p.skills.names.join(', ') : '(none)'}\n`,
  );
  const mcp = Object.keys(p.mcpServers ?? {});
  process.stdout.write(`  ${chalk.dim('MCP:')}     ${mcp.length ? mcp.join(', ') : '(none)'}\n`);
  const on = Object.entries(p.toolPolicy.groups)
    .filter(([, v]) => v)
    .map(([k]) => k);
  process.stdout.write(`  ${chalk.dim('Tools:')}   ${on.join(', ') || '(none)'}\n`);
  if (p.runtime.model) process.stdout.write(`  ${chalk.dim('Model:')}   ${p.runtime.model}\n`);
  if (p.team.length) {
    process.stdout.write(`  ${chalk.dim('Team:')}    ${p.team.map((t) => t.ref).join(', ')}\n`);
  }
  process.stdout.write('\n');
  printWarnings(p.warnings);
}

export function registerAgentCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const agent = program.command('agent').description('Manage reusable agents');

  // ── list ──
  agent
    .command('list')
    .alias('ls')
    .description('List agents')
    .option('--scope <scope>', 'Filter by scope (system, global, project)')
    .option('--role <role>', 'Filter by role (agent, orchestrator)')
    .option('--project <id>', 'Filter by project id')
    .option('--enabled-only', 'Only enabled agents')
    .option('-q, --query <text>', 'Search name and description')
    .action(
      async (cmdOpts: {
        scope?: string;
        role?: string;
        project?: string;
        enabledOnly?: boolean;
        query?: string;
      }) => {
        const opts = program.opts();
        const client = await getClient();
        const agents = await client.listAgents({
          ...(cmdOpts.scope ? { scope: cmdOpts.scope } : {}),
          ...(cmdOpts.role ? { role: cmdOpts.role } : {}),
          ...(cmdOpts.project ? { projectId: cmdOpts.project } : {}),
          ...(cmdOpts.query ? { q: cmdOpts.query } : {}),
          ...(cmdOpts.enabledOnly ? { enabledOnly: true } : {}),
        });

        // `--json` emits the FULL agent rows, not the table projection: a
        // script consuming this needs skillIds/mcpServerIds, not the counts.
        if (opts['json']) return outputJson(agents);

        const columns: TableColumn[] = [
          { key: 'ref', label: 'Ref' },
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role' },
          { key: 'skills', label: 'Skills' },
          { key: 'mcp', label: 'MCP' },
          { key: 'enabled', label: 'Enabled' },
        ];
        const rows = agents.map((a) => ({
          ref: a.ref,
          name: a.name,
          role: a.role,
          skills: a.skillIds.length,
          mcp: a.mcpServerIds.length,
          enabled: a.enabled ? 'yes' : 'no',
        }));

        outputList(rows as unknown as Record<string, unknown>[], columns, {
          json: false,
          title: 'Agents',
          emptyMessage: 'No agents found.',
        });
      },
    );

  // ── show ──
  agent
    .command('show <id>')
    .description('Show an agent (id or scope:slug ref)')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const a = await client.getAgent(id);
      if (opts['json']) return outputJson(a);
      outputRecord(
        {
          ref: a.ref,
          name: a.name,
          description: a.description,
          role: a.role,
          projection: a.projection,
          enabled: a.enabled,
          version: a.version,
          skills: a.skillIds.join(', ') || '(none)',
          mcpServers: a.mcpServerIds.join(', ') || '(none)',
          model: a.runtime.model ?? '(inherit)',
          team: a.orchestration?.teamAgentRefs.join(', ') ?? '(any)',
          sourcePath: a.sourcePath ?? '(authored)',
        },
        { json: false, title: `Agent ${a.ref}` },
      );
    });

  // ── create (from a .agent.md document) ──
  agent
    .command('create')
    .description('Create or update an agent from a .agent.md document')
    .requiredOption('-f, --file <path>', 'Path to the .agent.md document')
    .option('--scope <scope>', 'Target scope (global or project)', 'global')
    .option('--project <id>', 'Project id (required for --scope project)')
    .option('--overwrite', 'Replace an existing agent with the same slug')
    .action(
      async (cmdOpts: { file: string; scope: string; project?: string; overwrite?: boolean }) => {
        const opts = program.opts();
        const client = await getClient();
        const markdown = await readFile(resolve(cmdOpts.file), 'utf-8');
        const created = (await client.importAgent({
          markdown,
          scope: cmdOpts.scope,
          ...(cmdOpts.project ? { projectId: cmdOpts.project } : {}),
          ...(cmdOpts.overwrite ? { overwrite: true } : {}),
        })) as Agent & { warnings?: ResolutionWarning[] };

        if (opts['json']) return outputJson(created);
        process.stdout.write(
          chalk.green(`\n  ✓ ${created.ref} (v${created.version}) — ${created.name}\n\n`),
        );
        printWarnings(created.warnings);
      },
    );

  // ── export ──
  agent
    .command('export <id>')
    .description('Export an agent as a credential-free .agent.md document')
    .option('-o, --out <path>', 'Write to a file instead of stdout')
    .action(async (id: string, cmdOpts: { out?: string }) => {
      const client = await getClient();
      const markdown = await client.exportAgent(id);
      if (cmdOpts.out) {
        await writeFile(resolve(cmdOpts.out), markdown, 'utf-8');
        process.stderr.write(chalk.green(`\n  ✓ Wrote ${cmdOpts.out}\n\n`));
        return;
      }
      process.stdout.write(markdown);
    });

  // ── usage ──
  agent
    .command('usage <id>')
    .description('Show where an agent is bound')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const usage = await client.getAgentUsage(id);
      if (opts['json']) return outputJson(usage);

      // The response carries the bound ENTITIES, not counts — printing the raw
      // arrays produced an empty-looking record, which read as "unused".
      const total = usage.chats.length + usage.stages.length + usage.workflows.length;
      process.stdout.write(chalk.bold(`\n  Agent usage — ${total} binding(s)\n`));
      process.stdout.write(chalk.dim('  ' + '─'.repeat(48)) + '\n');
      const section = (label: string, rows: Array<{ id: string; name: string }>) => {
        process.stdout.write(`  ${chalk.dim(label + ':')} ${rows.length}\n`);
        for (const row of rows) {
          process.stdout.write(`      ${chalk.cyan(row.id.slice(0, 8))}  ${row.name}\n`);
        }
      };
      section('chats', usage.chats);
      section('stages', usage.stages);
      section('workflows', usage.workflows);
      process.stdout.write('\n');
    });

  // ── delete ──
  agent
    .command('delete <id>')
    .alias('rm')
    .description('Delete an agent (409 when still bound unless --force)')
    .option('--force', 'Soft-delete: disable it, keeping existing bindings working')
    .action(async (id: string, cmdOpts: { force?: boolean }) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await client.deleteAgent(id, cmdOpts.force ?? false);
      if (opts['json']) return outputJson(result);
      process.stdout.write(
        chalk.green(`\n  ✓ ${result.soft ? 'Disabled' : 'Deleted'} agent ${id}\n\n`),
      );
    });

  // ── resolve ──
  agent
    .command('resolve')
    .description('Preview the effective capabilities of a binding')
    .option('--ref <ref>', 'Agent ref (scope:slug)')
    .option('--project <id>', 'Project id')
    .option('--harness <type>', 'copilot | claude-agent', 'copilot')
    .option('--scope <scope>', 'chat | stage | worker', 'chat')
    .option('--add-skill <id...>', 'Skill ids to add on top of the agent')
    .option('--add-mcp <id...>', 'MCP server ids to add on top of the agent')
    .option('--remove-skill <id...>', 'Skill ids to remove')
    .option('--remove-mcp <id...>', 'MCP server ids to remove')
    .action(
      async (cmdOpts: {
        ref?: string;
        project?: string;
        harness: string;
        scope: string;
        addSkill?: string[];
        addMcp?: string[];
        removeSkill?: string[];
        removeMcp?: string[];
      }) => {
        const opts = program.opts();
        const client = await getClient();
        const projection = await client.resolveAgentPreview({
          ...(cmdOpts.ref ? { agentRef: cmdOpts.ref } : {}),
          ...(cmdOpts.project ? { projectId: cmdOpts.project } : {}),
          harnessType: cmdOpts.harness === 'claude-agent' ? 'claude-agent' : 'copilot',
          scope: (cmdOpts.scope === 'stage' || cmdOpts.scope === 'worker'
            ? cmdOpts.scope
            : 'chat') as 'chat' | 'stage' | 'worker',
          overrides: {
            ...(cmdOpts.addSkill?.length ? { addSkillIds: cmdOpts.addSkill } : {}),
            ...(cmdOpts.addMcp?.length ? { addMcpServerIds: cmdOpts.addMcp } : {}),
            ...(cmdOpts.removeSkill?.length ? { removeSkillIds: cmdOpts.removeSkill } : {}),
            ...(cmdOpts.removeMcp?.length ? { removeMcpServerIds: cmdOpts.removeMcp } : {}),
          },
        });
        if (opts['json']) return outputJson(projection);
        printProjection(projection);
      },
    );
}
