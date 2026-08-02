// run commands — workflow run lifecycle, monitoring, HITL, stage control

import type { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import { accessSync } from 'node:fs';
import * as path from 'node:path';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';
import { outputRecord, outputList } from '../output/format.js';
import { formatStatus, formatDate, truncate, type TableColumn } from '../output/table.js';
import { EventRenderer } from '../streaming/EventRenderer.js';
import type { StreamVerbosity } from '../streaming/EventRenderer.js';
import { RunProfileSchema } from '@generatorai/shared';
import type { VariableDefinition } from '@generatorai/shared';
import { getProjectConfigDir } from '../config/paths.js';

export function registerRunCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const run = program.command('run').description('Workflow runs');

  // ── list ──
  run
    .command('list')
    .description('List workflow runs')
    .option('--status <status>', 'Filter by status')
    .option('--definition <id>', 'Filter by definition ID')
    .option('--limit <n>', 'Limit results', '20')
    .action(async (cmdOpts: { status?: string; definition?: string; limit: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const filter: { definitionId?: string; status?: string } = {};
      if (cmdOpts.status) filter.status = cmdOpts.status;
      if (cmdOpts.definition) filter.definitionId = cmdOpts.definition;
      const runs = await client.listRuns(filter);

      const limited = runs.slice(0, parseInt(cmdOpts.limit, 10));

      const columns: TableColumn[] = [
        { key: 'id', label: 'ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 25) },
        { key: 'status', label: 'Status', format: (v) => formatStatus(String(v ?? '')) },
        { key: 'createdAt', label: 'Created', format: (v) => formatDate(v as string) },
      ];

      outputList(limited as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Workflow Runs',
        emptyMessage: 'No workflow runs found.',
      });
    });

  // ── start ──
  run
    .command('start <definitionId>')
    .description('Start a new workflow run')
    .option('--name <name>', 'Run name')
    .option('--var <key=value...>', 'Set variables (repeatable)', collectKeyValue, {})
    .option('--profile <path>', 'Run profile JSON file path')
    .option('--watch', 'Watch events after starting')
    .option('--permission-mode <mode>', 'HITL mode: bypassPermissions, default, acceptEdits, plan', 'bypassPermissions')
    .option('--project <id>', 'Project ID')
    .action(async (definitionId: string, cmdOpts: {
      name?: string;
      var: Record<string, string>;
      profile?: string;
      watch?: boolean;
      permissionMode: string;
      project?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();

      // Resolve definition ID prefix
      const defId = await resolveDefId(client, definitionId);
      const definition = await client.getDefinition(defId);

      // Load run profile if provided
      let profileVars: Record<string, unknown> = {};
      let profilePermMode = cmdOpts.permissionMode;
      let profileProjectId = cmdOpts.project;
      let stageOverrides: unknown[] | undefined;

      if (cmdOpts.profile) {
        const profilePath = resolveProfilePath(cmdOpts.profile);
        let profileContent: string;
        try {
          profileContent = await fs.readFile(profilePath, 'utf-8');
        } catch {
          process.stderr.write(chalk.red(`\n  ✗ Cannot read profile: ${profilePath}\n\n`));
          process.exitCode = 1;
          return;
        }

        let profileData: unknown;
        try {
          profileData = JSON.parse(profileContent);
        } catch {
          process.stderr.write(chalk.red(`\n  ✗ Invalid JSON in profile: ${profilePath}\n\n`));
          process.exitCode = 1;
          return;
        }

        const parseResult = RunProfileSchema.safeParse(profileData);
        if (!parseResult.success) {
          process.stderr.write(chalk.red(`\n  ✗ Invalid run profile:\n`));
          for (const issue of parseResult.error.issues) {
            process.stderr.write(chalk.red(`    • ${issue.path.join('.')}: ${issue.message}\n`));
          }
          process.stderr.write('\n');
          process.exitCode = 1;
          return;
        }

        const profile = parseResult.data;
        profileVars = profile.variables;
        if (profile.permissionMode) profilePermMode = profile.permissionMode;
        if (profile.projectId) profileProjectId = profile.projectId;
        stageOverrides = profile.stageOverrides;

        process.stderr.write(chalk.dim(`  Using run profile: ${profilePath}\n`));
      }

      // Merge variables: profile < CLI --var flags (CLI wins)
      const mergedVars: Record<string, unknown> = { ...profileVars };
      for (const [k, v] of Object.entries(cmdOpts.var)) {
        mergedVars[k] = v;
      }

      // Validate required variables against definition
      const validationErrors = validateVariables(definition.variables, mergedVars);
      if (validationErrors.length > 0) {
        process.stderr.write(chalk.red(`\n  ✗ Variable validation failed:\n`));
        for (const err of validationErrors) {
          process.stderr.write(chalk.red(`    • ${err}\n`));
        }
        process.stderr.write(chalk.dim(`\n  Generate a profile: generatorai run profile generate ${defId.slice(0, 8)}\n\n`));
        process.exitCode = 1;
        return;
      }

      // Create then start the run
      // Include stageOverrides in variables so they flow through to execution
      const createVars: Record<string, unknown> = { ...mergedVars };
      if (stageOverrides && stageOverrides.length > 0) {
        createVars['__stageOverrides'] = stageOverrides;
      }

      const wfRun = await client.createRun({
        workflowDefinitionId: defId,
        variables: Object.keys(createVars).length > 0 ? createVars : undefined,
        projectId: profileProjectId,
      });

      // Set permission mode BEFORE starting so the orchestrator uses it immediately
      await client.setPermissionMode(
        wfRun.id,
        profilePermMode as 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
      );

      await client.startRun(wfRun.id);

      if (opts['json']) { outputJson(wfRun); return; }

      process.stderr.write(chalk.green(`\n  ✓ Run started: ${wfRun.id.slice(0, 8)}\n`));
      process.stderr.write(chalk.dim(`    ID: ${wfRun.id}\n`));
      process.stderr.write(chalk.dim(`    Status: ${formatStatus(wfRun.status)}\n`));

      if (cmdOpts.watch) {
        process.stderr.write(chalk.dim('    Streaming events...\n\n'));
        await watchRun(client, wfRun.id, opts, { verbosity: 'normal' });
      } else {
        process.stderr.write(chalk.dim(`\n    Watch: generatorai run watch ${wfRun.id.slice(0, 8)}\n\n`));
      }
    });

  // ── show ──
  run
    .command('show <id>')
    .description('Show workflow run details with stages')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      const wfRun = await client.getRun(fullId);

      if (opts['json']) { outputJson(wfRun); return; }

      outputRecord(wfRun as unknown as Record<string, unknown>, {
        title: `Run: ${wfRun.id.slice(0, 8)}`,
        fields: [
          { key: 'id', label: 'ID' },
          { key: 'status', label: 'Status', format: (v) => formatStatus(String(v)) },
          { key: 'workflowDefinitionId', label: 'Definition', format: (v) => String(v).slice(0, 8) },
          { key: 'createdAt', label: 'Started', format: (v) => formatDate(v as string) },
          { key: 'completedAt', label: 'Completed', format: (v) => v ? formatDate(v as string) : '—' },
        ],
      });

      // Show stages
      try {
        const stages = await client.getRunStages(fullId);
        if (stages.length > 0) {
          process.stderr.write(chalk.bold(`  Stage Runs (${stages.length})\n\n`));
          for (const s of stages) {
            const icon = getStatusIcon(s.status);
            const step = s.totalSteps > 0 ? chalk.dim(` [${s.currentStep}/${s.totalSteps}]`) : '';
            process.stderr.write(`    ${icon} ${s.name} ${formatStatus(s.status)}${step}\n`);
            if (s.error) process.stderr.write(chalk.red(`       Error: ${truncate(s.error, 60)}\n`));
            if (s.summary) process.stderr.write(chalk.dim(`       ${truncate(s.summary, 60)}\n`));

            // Show hook context messages for completed stages
            if (s.sessionId && (s.status === 'completed' || s.status === 'failed')) {
              try {
                const msgs = await client.getChatHistory(s.sessionId, undefined, undefined, s.id);
                const hookMsgs = msgs.filter((m) =>
                  m.role === 'user' && m.metadata?.isHookContext,
                );
                const ctxMsgs = msgs.filter((m) =>
                  m.role === 'user' && m.metadata?.isContextMessage,
                );
                if (hookMsgs.length > 0) {
                  process.stderr.write(chalk.magenta(`       🪝 ${hookMsgs.length} hook context message(s) injected\n`));
                }
                if (ctxMsgs.length > 0) {
                  process.stderr.write(chalk.dim(`       📋 ${ctxMsgs.length} predecessor context message(s)\n`));
                }
              } catch { /* messages not available */ }
            }
          }
          process.stderr.write('\n');

          // Show hook-injected variables
          const variables = wfRun.variables as Record<string, unknown> | undefined;
          if (variables) {
            const hookVars = Object.entries(variables).filter(
              ([k]) => k === 'hookInjected' || k === 'enrichedBy' || k === 'attachmentFile',
            );
            if (hookVars.length > 0) {
              process.stderr.write(chalk.bold(`  Hook-Injected Variables\n\n`));
              for (const [k, v] of hookVars) {
                process.stderr.write(`    ${chalk.magenta('🪝')} ${k}: ${chalk.cyan(String(v))}\n`);
              }
              process.stderr.write('\n');
            }
          }
        }
      } catch {
        // Stage details may not be available for all run types
      }
    });

  // ── watch ──
  run
    .command('watch <id>')
    .description('Watch live events for a workflow run')
    .option('--verbosity <level>', 'Stream verbosity: minimal, normal, verbose', 'normal')
    .option('--filter <kinds>', 'Comma-separated event kind prefixes')
    .action(async (id: string, cmdOpts: { verbosity: string; filter?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      await watchRun(client, fullId, opts, cmdOpts);
    });

  // ── messages — show messages for a run (per-stage breakdown) ──
  run
    .command('messages <id>')
    .description('Show messages for a workflow run (per-stage breakdown)')
    .option('--stage <name>', 'Filter by stage name')
    .option('--type <type>', 'Filter: all, hook, context, prompt, summary', 'all')
    .action(async (id: string, cmdOpts: { stage?: string; type: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      const wfRun = await client.getRun(fullId);

      if (opts['json']) {
        // Collect all messages with stage metadata
        const allMsgs: Array<Record<string, unknown>> = [];
        const stages = await client.getRunStages(fullId);
        for (const s of stages) {
          if (cmdOpts.stage && s.name !== cmdOpts.stage) continue;
          if (!s.sessionId) continue;
          const msgs = await client.getChatHistory(s.sessionId, undefined, undefined, s.id);
          for (const m of msgs) {
            allMsgs.push({ ...(m as unknown as Record<string, unknown>), stageName: s.name, stageId: s.id });
          }
        }
        outputJson(allMsgs);
        return;
      }

      const stages = await client.getRunStages(fullId);
      process.stderr.write(chalk.bold.cyan(`\n  Messages for Run: ${fullId.slice(0, 8)}\n`));
      process.stderr.write(chalk.dim(`  ${'─'.repeat(50)}\n`));

      for (const s of stages) {
        if (cmdOpts.stage && s.name !== cmdOpts.stage) continue;
        if (!s.sessionId) {
          process.stderr.write(chalk.dim(`\n  ${getStatusIcon(s.status)} ${s.name}: No session\n`));
          continue;
        }

        const msgs = await client.getChatHistory(s.sessionId, undefined, undefined, s.id);
        const filtered = filterMessages(msgs as unknown as Record<string, unknown>[], cmdOpts.type);

        process.stderr.write(chalk.bold(`\n  ${getStatusIcon(s.status)} ${s.name} ${chalk.dim(`(${filtered.length} messages)`)}\n`));

        if (filtered.length === 0) {
          process.stderr.write(chalk.dim(`    No ${cmdOpts.type === 'all' ? '' : cmdOpts.type + ' '}messages\n`));
          continue;
        }

        for (const msg of filtered) {
          const meta = msg.metadata as Record<string, unknown> | undefined;
          const role = msg.role as string;
          const content = msg.content as string;

          if (meta?.isHookContext) {
            process.stderr.write(chalk.magenta(`    🪝 Hook Context:\n`));
            process.stderr.write(chalk.dim(`       ${truncate(content, 120)}\n`));
          } else if (meta?.isContextMessage) {
            process.stderr.write(chalk.yellow(`    📋 Predecessor Context:\n`));
            process.stderr.write(chalk.dim(`       ${truncate(content, 120)}\n`));
          } else if (meta?.isSummaryPrompt) {
            process.stderr.write(chalk.blue(`    📝 Summary Prompt\n`));
          } else if (role === 'user') {
            process.stderr.write(chalk.cyan(`    💬 User Prompt:\n`));
            process.stderr.write(`       ${truncate(content, 120)}\n`);
          } else if (role === 'assistant') {
            process.stderr.write(chalk.green(`    🤖 Assistant:\n`));
            process.stderr.write(`       ${truncate(content, 120)}\n`);
          }
        }
      }
      process.stderr.write('\n');
    });

  // ── pause ──
  run
    .command('pause <id>')
    .description('Pause a running workflow')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      await client.pauseRun(fullId);

      if (opts['json']) { outputJson({ ok: true, paused: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Run ${fullId.slice(0, 8)} paused\n\n`));
    });

  // ── resume ──
  run
    .command('resume <id>')
    .description('Resume a paused workflow')
    .option('--watch', 'Watch events after resuming')
    .action(async (id: string, cmdOpts: { watch?: boolean }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      await client.resumeRun(fullId);

      if (opts['json']) { outputJson({ ok: true, resumed: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Run ${fullId.slice(0, 8)} resumed\n\n`));

      if (cmdOpts.watch) {
        process.stderr.write(chalk.dim('    Streaming events...\n\n'));
        await watchRun(client, fullId, opts, { verbosity: 'normal' });
      }
    });

  // ── cancel ──
  run
    .command('cancel <id>')
    .description('Cancel a running workflow')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      await client.cancelRun(fullId);

      if (opts['json']) { outputJson({ ok: true, cancelled: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Run ${fullId.slice(0, 8)} cancelled\n\n`));
    });

  // ── retry ──
  run
    .command('retry <id>')
    .description('Retry a failed workflow run')
    .action(async (id: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, id);
      await client.retryRun(fullId);

      if (opts['json']) { outputJson({ ok: true, retried: fullId }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Run ${fullId.slice(0, 8)} retried\n\n`));
    });

  // ── HITL commands ──
  const hitl = run.command('hitl').description('Human-in-the-loop controls');

  hitl
    .command('mode <runId>')
    .description('Get or set HITL permission mode')
    .option('--set <mode>', 'Set mode: bypassPermissions, default, acceptEdits, plan')
    .action(async (runId: string, cmdOpts: { set?: string }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, runId);

      if (cmdOpts.set) {
        await client.setPermissionMode(
          fullId,
          cmdOpts.set as 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
        );
        if (opts['json']) { outputJson({ runId: fullId, mode: cmdOpts.set }); return; }
        process.stderr.write(chalk.green(`\n  ✓ Permission mode set to: ${cmdOpts.set}\n\n`));
      } else {
        const result = await client.getPermissionMode(fullId);
        if (opts['json']) { outputJson(result); return; }
        process.stderr.write(`\n  Permission mode: ${chalk.cyan(result.mode)}\n\n`);
      }
    });

  hitl
    .command('pending <runId>')
    .description('List stages awaiting human input')
    .action(async (runId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, runId);
      const pending = await client.listPendingInterrupts(fullId);

      const columns: TableColumn[] = [
        { key: 'id', label: 'Stage ID', format: (v) => String(v).slice(0, 8) },
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status', format: (v) => formatStatus(String(v)) },
      ];

      outputList(pending as unknown as Record<string, unknown>[], columns, {
        json: opts['json'],
        title: 'Pending Interrupts',
        emptyMessage: 'No stages awaiting input.',
      });
    });

  hitl
    .command('resume <runId> <stageId>')
    .description('Resume a stage awaiting input')
    .option('--approve', 'Approve the stage action')
    .option('--reject', 'Reject the stage action')
    .option('--reason <reason>', 'Reason for approval/rejection')
    .option('--value <json>', 'JSON value to send')
    .action(async (runId: string, stageId: string, cmdOpts: {
      approve?: boolean;
      reject?: boolean;
      reason?: string;
      value?: string;
    }) => {
      const opts = program.opts();
      const client = await getClient();
      const fullRunId = await resolveRunId(client, runId);

      const approved = cmdOpts.approve ? true : cmdOpts.reject ? false : true;
      let value: unknown;
      if (cmdOpts.value) {
        try { value = JSON.parse(cmdOpts.value); }
        catch { process.stderr.write(chalk.red('\n  ✗ Invalid JSON in --value\n\n')); return; }
      }

      const result = await client.resumeStage(fullRunId, stageId, {
        approved,
        value,
        reason: cmdOpts.reason,
      });

      if (opts['json']) { outputJson(result); return; }

      if (result.ok) {
        process.stderr.write(chalk.green(`\n  ✓ Stage resumed (${approved ? 'approved' : 'rejected'})\n\n`));
      } else {
        process.stderr.write(chalk.red(`\n  ✗ Resume failed: ${result.reason}\n\n`));
        process.exitCode = 1;
      }
    });

  // ── stage controls ──
  const stageCtrl = run.command('stage').description('Stage run controls');

  stageCtrl
    .command('pause <runId> <stageId>')
    .description('Pause a running stage')
    .action(async (runId: string, stageId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullRunId = await resolveRunId(client, runId);
      await client.pauseStageRun(fullRunId, stageId);
      if (opts['json']) { outputJson({ ok: true }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage paused\n\n`));
    });

  stageCtrl
    .command('resume-stage <runId> <stageId>')
    .description('Resume a paused stage')
    .action(async (runId: string, stageId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullRunId = await resolveRunId(client, runId);
      await client.resumeStageRun(fullRunId, stageId);
      if (opts['json']) { outputJson({ ok: true }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage resumed\n\n`));
    });

  stageCtrl
    .command('retry <runId> <stageId>')
    .description('Retry a failed stage')
    .action(async (runId: string, stageId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullRunId = await resolveRunId(client, runId);
      await client.retryStageRun(fullRunId, stageId);
      if (opts['json']) { outputJson({ ok: true }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage retried\n\n`));
    });

  stageCtrl
    .command('cancel <runId> <stageId>')
    .description('Cancel a running stage')
    .action(async (runId: string, stageId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullRunId = await resolveRunId(client, runId);
      await client.cancelStageRun(fullRunId, stageId);
      if (opts['json']) { outputJson({ ok: true }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Stage cancelled\n\n`));
    });

  // ── run profile — generate, validate, list ──
  const profile = run.command('profile').description('Run profile management');

  profile
    .command('generate <definitionId>')
    .description('Generate a run profile template for a workflow')
    .option('-o, --output <file>', 'Output file path')
    .action(async (definitionId: string, cmdOpts: { output?: string }) => {
      const client = await getClient();
      const defId = await resolveDefId(client, definitionId);
      const def = await client.getDefinition(defId);

      const stages = (def as unknown as Record<string, unknown>)['stages'] as Array<Record<string, unknown>> | undefined;

      const profileTemplate = {
        version: 1,
        name: `${def.name} - Run Profile`,
        description: `Run profile for ${def.name}`,
        workflowDefinitionId: def.id,
        variables: Object.fromEntries(
          def.variables.map(v => [
            v.name,
            v.defaultValue ?? (v.type === 'boolean' ? false : v.type === 'number' ? 0 : ''),
          ]),
        ),
        permissionMode: 'bypassPermissions',
        stageOverrides: stages?.map((s, i) => ({
          stageName: s['name'] as string,
          stageIndex: i,
          skip: false,
          // variables: {},
          // agentName: undefined,
          // timeoutMs: undefined,
          // contextFilter: undefined,
        })) ?? [],
      };

      const json = JSON.stringify(profileTemplate, null, 2) + '\n';

      if (cmdOpts.output) {
        await fs.writeFile(cmdOpts.output, json, 'utf-8');
        process.stderr.write(chalk.green(`\n  ✓ Run profile generated: ${cmdOpts.output}\n\n`));
      } else {
        // Write to .generatorai/run-profiles/<name>.json
        const safeName = def.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
        const profileDir = path.join(getProjectConfigDir(), 'run-profiles');
        try { await fs.mkdir(profileDir, { recursive: true }); } catch { /* exists */ }
        const outputPath = path.join(profileDir, `${safeName}.json`);
        await fs.writeFile(outputPath, json, 'utf-8');
        process.stderr.write(chalk.green(`\n  ✓ Run profile generated: ${outputPath}\n`));
        process.stderr.write(chalk.dim(`  Edit the file and run:\n`));
        process.stderr.write(chalk.dim(`    generatorai run start ${defId.slice(0, 8)} --profile ${outputPath}\n\n`));
      }

      // Show required variables info
      const required = def.variables.filter(v => v.required);
      if (required.length > 0) {
        process.stderr.write(chalk.yellow(`  Required variables:\n`));
        for (const v of required) {
          const defVal = v.defaultValue !== undefined ? chalk.dim(` [default: ${String(v.defaultValue)}]`) : '';
          process.stderr.write(`    ${chalk.red('*')} ${v.name} (${v.type}): ${v.label}${defVal}\n`);
          if (v.options?.length) process.stderr.write(chalk.dim(`        Options: ${v.options.join(', ')}\n`));
        }
        process.stderr.write('\n');
      }
    });

  profile
    .command('validate <path>')
    .description('Validate a run profile against its workflow definition')
    .action(async (profilePath: string) => {
      const opts = program.opts();
      const client = await getClient();

      const resolvedPath = resolveProfilePath(profilePath);
      let content: string;
      try {
        content = await fs.readFile(resolvedPath, 'utf-8');
      } catch {
        process.stderr.write(chalk.red(`\n  ✗ Cannot read: ${resolvedPath}\n\n`));
        process.exitCode = 1;
        return;
      }

      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        process.stderr.write(chalk.red(`\n  ✗ Invalid JSON in: ${resolvedPath}\n\n`));
        process.exitCode = 1;
        return;
      }

      // Schema validation
      const parseResult = RunProfileSchema.safeParse(data);
      if (!parseResult.success) {
        process.stderr.write(chalk.red(`\n  ✗ Schema validation failed:\n`));
        for (const issue of parseResult.error.issues) {
          process.stderr.write(chalk.red(`    • ${issue.path.join('.')}: ${issue.message}\n`));
        }
        process.stderr.write('\n');
        if (opts['json']) { outputJson({ valid: false, errors: parseResult.error.issues }); }
        process.exitCode = 1;
        return;
      }

      // Variable validation against definition
      const profileData = parseResult.data;
      try {
        const def = await client.getDefinition(profileData.workflowDefinitionId);
        const errors = validateVariables(def.variables, profileData.variables);
        if (errors.length > 0) {
          process.stderr.write(chalk.red(`\n  ✗ Variable validation failed:\n`));
          for (const err of errors) {
            process.stderr.write(chalk.red(`    • ${err}\n`));
          }
          process.stderr.write('\n');
          if (opts['json']) { outputJson({ valid: false, errors }); }
          process.exitCode = 1;
          return;
        }
      } catch (err) {
        process.stderr.write(chalk.yellow(`\n  ⚠ Could not validate against workflow: ${err instanceof Error ? err.message : String(err)}\n`));
      }

      if (opts['json']) { outputJson({ valid: true, profile: profileData }); return; }
      process.stderr.write(chalk.green(`\n  ✓ Run profile is valid\n`));
      process.stderr.write(chalk.dim(`    Workflow: ${profileData.workflowDefinitionId}\n`));
      process.stderr.write(chalk.dim(`    Variables: ${Object.keys(profileData.variables).length}\n\n`));
    });

  profile
    .command('list')
    .description('List run profiles in .generatorai/run-profiles/')
    .action(async () => {
      const opts = program.opts();
      const profileDir = path.join(getProjectConfigDir(), 'run-profiles');

      try {
        const files = await fs.readdir(profileDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
          if (opts['json']) { outputJson([]); return; }
          process.stderr.write(chalk.dim(`\n  No run profiles found in ${profileDir}\n\n`));
          return;
        }

        const profiles: Array<Record<string, unknown>> = [];
        for (const file of jsonFiles) {
          try {
            const content = await fs.readFile(path.join(profileDir, file), 'utf-8');
            const parsed = JSON.parse(content) as Record<string, unknown>;
            profiles.push({
              file,
              name: parsed['name'] ?? file,
              workflow: String(parsed['workflowDefinitionId'] ?? '').slice(0, 8),
              vars: typeof parsed['variables'] === 'object' ? Object.keys(parsed['variables'] as object).length : 0,
            });
          } catch {
            profiles.push({ file, name: file, workflow: '?', vars: 0 });
          }
        }

        const columns: TableColumn[] = [
          { key: 'file', label: 'File' },
          { key: 'name', label: 'Name', format: (v) => truncate(String(v ?? ''), 30) },
          { key: 'workflow', label: 'Workflow' },
          { key: 'vars', label: 'Vars' },
        ];

        outputList(profiles, columns, {
          json: opts['json'],
          title: 'Run Profiles',
          emptyMessage: 'No run profiles found.',
        });
      } catch {
        process.stderr.write(chalk.dim(`\n  No .generatorai/run-profiles/ directory. Run: generatorai init\n\n`));
      }
    });

  // ── run workspace — file access for completed runs ──
  run
    .command('workspace <runId>')
    .description('Show workspace files for a workflow run')
    .action(async (runId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const fullId = await resolveRunId(client, runId);
      const workspace = await client.getRunWorkspace(fullId);

      if (opts['json']) { outputJson(workspace); return; }

      process.stderr.write(chalk.bold.cyan(`\n  Run Workspace: ${fullId.slice(0, 8)}\n`));
      process.stderr.write(chalk.dim(`  ${'─'.repeat(50)}\n`));

      const ws = workspace as unknown as Record<string, unknown>;
      const workspaceFiles = ws['workspaceFiles'] as string[] | undefined;
      const artifactFiles = ws['artifactFiles'] as string[] | undefined;

      if (workspaceFiles?.length) {
        process.stderr.write(chalk.bold(`\n  Output Files (${workspaceFiles.length}):\n`));
        for (const f of workspaceFiles) {
          process.stderr.write(chalk.green(`    📄 ${f}\n`));
        }
      }

      if (artifactFiles?.length) {
        process.stderr.write(chalk.bold(`\n  Artifacts (${artifactFiles.length}):\n`));
        for (const f of artifactFiles) {
          process.stderr.write(chalk.blue(`    📋 ${f}\n`));
        }
      }
      process.stderr.write('\n');
    });
}

function collectKeyValue(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const eqIdx = value.indexOf('=');
  if (eqIdx <= 0) {
    process.stderr.write(
      chalk.red(`\n  ✗ Invalid --var "${value}": expected format key=value\n\n`),
    );
    process.exit(1);
  }
  const key = value.substring(0, eqIdx);
  const val = value.substring(eqIdx + 1);
  previous[key] = val;
  return previous;
}

async function watchRun(
  client: CLIPlatformClient,
  runId: string,
  opts: Record<string, unknown>,
  cmdOpts: { verbosity?: string; filter?: string },
): Promise<void> {
  process.stderr.write(chalk.bold(`\n  Watching run: ${runId.slice(0, 8)}\n`));
  process.stderr.write(chalk.dim('  Press Ctrl+C to stop (auto-exits on completion).\n\n'));

  return new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | undefined;

    const cleanup = (reason: string) => {
      unsubscribe?.();
      process.stderr.write(chalk.dim(`\n\n  ${reason}\n\n`));
      process.removeListener('SIGINT', sigintHandler);
      resolve();
    };

    const sigintHandler = () => cleanup('Stopped watching.');

    const renderer = new EventRenderer({
      verbosity: (cmdOpts.verbosity ?? 'normal') as StreamVerbosity,
      onComplete: () => cleanup('Watch ended (run finished).'),
    });

    unsubscribe = client.subscribeToRunEvents(
      runId,
      (event) => {
        if (opts['json']) {
          outputJson(event);
        } else {
          renderer.handleEvent(event);
        }
      },
      {},
    );

    process.once('SIGINT', sigintHandler);
  });
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return chalk.green('✓');
    case 'running': return chalk.cyan('⟳');
    case 'pending': case 'queued': return chalk.dim('○');
    case 'failed': return chalk.red('✗');
    case 'cancelled': return chalk.red('⊘');
    case 'paused': return chalk.yellow('⏸');
    case 'awaiting_input': return chalk.yellow('?');
    case 'skipped': return chalk.dim('⊘');
    default: return chalk.dim('·');
  }
}

async function resolveRunId(client: CLIPlatformClient, id: string): Promise<string> {
  if (id.length >= 36) return id;
  const runs = await client.listRuns();
  const matches = runs.filter((r) => r.id.startsWith(id));
  if (matches.length === 0) throw new Error(`No run found with ID prefix: ${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous ID "${id}" matches ${matches.length} runs. Use a longer prefix.`);
  return matches[0]!.id;
}

async function resolveDefId(client: CLIPlatformClient, id: string): Promise<string> {
  if (id.length >= 36) return id;
  const defs = await client.listDefinitions();
  const matches = defs.filter((d) => d.id.startsWith(id));
  if (matches.length === 0) throw new Error(`No workflow found with ID prefix: ${id}`);
  if (matches.length > 1) throw new Error(`Ambiguous ID "${id}" matches ${matches.length} workflows. Use a longer prefix.`);
  return matches[0]!.id;
}

function resolveProfilePath(profilePath: string): string {
  // If absolute or contains path separator, use as-is
  if (path.isAbsolute(profilePath)) return profilePath;

  // Check in .generatorai/run-profiles/ first
  const projectPath = path.join(getProjectConfigDir(), 'run-profiles', profilePath);
  // Append .json if needed
  const candidatePaths = [
    profilePath,
    profilePath.endsWith('.json') ? '' : profilePath + '.json',
    projectPath,
    projectPath.endsWith('.json') ? '' : projectPath + '.json',
  ].filter(Boolean);

  // Return the first that might exist (caller will verify)
  // Prefer project-relative paths
  for (const p of [projectPath, projectPath + '.json']) {
    try {
      // Synchronous existence check — ok for CLI startup
      accessSync(p);
      return p;
    } catch { /* not found, continue */ }
  }
  // Fall back to CWD-relative
  return path.resolve(profilePath);
}

function filterMessages(msgs: Array<Record<string, unknown>>, type: string): Array<Record<string, unknown>> {
  return msgs.filter((msg) => {
    const meta = msg['metadata'] as Record<string, unknown> | undefined;
    switch (type) {
      case 'hook':
        return meta?.isHookContext;
      case 'context':
        return meta?.isContextMessage;
      case 'prompt':
        return msg['role'] === 'user' && !meta?.isHookContext && !meta?.isContextMessage && !meta?.isSummaryPrompt;
      case 'summary':
        return meta?.isSummaryPrompt || (msg['role'] === 'assistant' && msgs.indexOf(msg) > 0);
      default:
        return true;
    }
  });
}

function validateVariables(
  definitions: VariableDefinition[],
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const def of definitions) {
    const value = values[def.name];

    // Required check
    if (def.required && (value === undefined || value === null || value === '')) {
      if (def.defaultValue === undefined) {
        errors.push(`Required variable "${def.name}" is missing.`);
      }
      continue;
    }

    if (value === undefined || value === null) continue;

    // Type check
    switch (def.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Variable "${def.name}" must be a number, got: ${String(value)}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && !['true', 'false', '0', '1'].includes(String(value))) {
          errors.push(`Variable "${def.name}" must be a boolean, got: ${String(value)}`);
        }
        break;
      case 'choice':
        if (def.options?.length && !def.options.includes(String(value))) {
          errors.push(`Variable "${def.name}" must be one of [${def.options.join(', ')}], got: ${String(value)}`);
        }
        break;
    }
  }

  return errors;
}
