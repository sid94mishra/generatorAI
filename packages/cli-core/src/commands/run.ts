// `generatorai run …` — starting, watching and controlling workflow runs.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { defineCommand, type CommandResult, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import { getRunProfilesDir, getUserRunProfilesDir } from '../config/paths.js';
import {
  compact,
  createdColumn,
  idColumn,
  inputSchema,
  isTerminalRunState,
  list,
  ok,
  parseKeyValues,
  record,
  statusColumn,
  streamUntil,
  verbosityFlag,
  waitForRunTerminal,
  watchFlag,
} from './_shared.js';

export const RUN_GROUP = {
  name: 'run',
  summary: 'Workflow run lifecycle, stage controls and human-in-the-loop gates',
  order: 30,
};

const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const;

export interface RunProfile {
  variables?: Record<string, unknown>;
  permissionMode?: string;
  projectId?: string;
  name?: string;
  stageOverrides?: Array<{ stageId: string; patch: Record<string, unknown> }>;
}

async function findRun(ctx: CliContext, ref: string) {
  const runs = await ctx.api.runs.list({});
  return resolveRef(ref, {
    kind: 'run',
    candidates: runs.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      status: r.status,
      createdAt: r.createdAt,
    })),
    activeStatuses: ['running', 'awaiting_input', 'paused', 'starting'],
  });
}

async function findDefinition(ctx: CliContext, ref: string) {
  const definitions = await ctx.api.definitions.list();
  return resolveRef(ref, { kind: 'workflow', candidates: definitions });
}

async function findStage(ctx: CliContext, runId: string, ref: string) {
  const stages = await ctx.api.runs.stages(runId);
  return resolveRef(ref, {
    kind: 'stage',
    candidates: (stages as unknown as Array<Record<string, unknown>>).map((s) => ({
      id: String(s['id'] ?? s['stageDefinitionId'] ?? ''),
      name: (s['name'] ?? s['stageName']) as string | null,
      status: s['status'] as string | null,
    })),
  });
}

/**
 * Loads a run profile.
 *
 * Bare names resolve against `./.generatorai/run-profiles/` first and the
 * user directory second, so a repo can ship its own profiles and a user can
 * keep personal ones without collision. A path with a separator is taken
 * literally.
 */
export async function loadRunProfile(ref: string, cwd = process.cwd()): Promise<RunProfile> {
  const candidates = ref.includes('/') || ref.includes('\\') || ref.endsWith('.json')
    ? [path.resolve(cwd, ref)]
    : [
        path.join(getRunProfilesDir(cwd), `${ref}.json`),
        path.join(getUserRunProfilesDir(), `${ref}.json`),
      ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      return JSON.parse(raw) as RunProfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new CliError('VALIDATION', `Could not read profile at ${candidate}.`, {
          hint: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  throw CliError.notFound('run profile', ref, {
    hint: `Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
    suggestions: ['generatorai run profile list'],
  });
}

/** Missing-required and unknown variables, reported together. */
export function validateVariables(
  defined: Array<{ name: string; required?: boolean; type?: string; defaultValue?: unknown }>,
  provided: Record<string, unknown>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set(defined.map((v) => v.name));

  for (const variable of defined) {
    const value = provided[variable.name];
    if (value === undefined) {
      if (variable.required && variable.defaultValue === undefined) {
        errors.push(`missing required variable "${variable.name}"`);
      }
      continue;
    }
    if (variable.type === 'number' && typeof value !== 'number') {
      errors.push(`variable "${variable.name}" must be a number, got ${typeof value}`);
    }
    if (variable.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`variable "${variable.name}" must be a boolean, got ${typeof value}`);
    }
  }

  // Unknown variables are a warning, not an error: a workflow can read a
  // variable that its definition does not declare, and failing the run for it
  // would be worse than the typo it usually indicates.
  for (const name of Object.keys(provided)) {
    if (!name.startsWith('__') && !known.has(name)) {
      warnings.push(`variable "${name}" is not declared by this workflow`);
    }
  }

  return { errors, warnings };
}

/** Renders a run's event stream and stops at the run's terminal state. */
/** Streams a run to completion. Exported so any command that starts a run — not just `run start` — can offer `--watch` without duplicating this. */
export async function watchRun(
  ctx: CliContext,
  runId: string,
  verbosity: 'minimal' | 'normal' | 'verbose',
): Promise<void> {
  const showThinking = verbosity === 'verbose';
  const showTools = verbosity !== 'minimal';
  let internalTurn = false;
  let currentStage = '';

  const streamed = streamUntil(ctx, 'run', runId, {
    onEvent: (event) => {
      const data = event.data;
      if (event.kind === 'harness.turn_start') {
        internalTurn = Boolean(data['__isInternalTurn']);
        return;
      }

      // The server's real stage lifecycle: there is no `stage.*`/
      // `stage_run.started` producer anywhere (confirmed against every
      // emitter in `packages/core/src/services/*.ts`) — a stage actually
      // beginning is `stage_run.running`, and HITL's real gate events are
      // `stage_run.awaiting_input`/`stage_run.input_received`, keyed by
      // `stageRunId`, not `stage.awaiting_input`/`stageId`. Before this fix,
      // `run watch`/`--watch` never printed a single "▶ stage" progress
      // line, nor the "waiting for approval" hint, against a real run.
      switch (event.kind) {
        case 'stage.started':
        case 'stage_run.running': {
          currentStage = String(data['name'] ?? data['stageName'] ?? data['stageRunId'] ?? '');
          ctx.emit({ type: 'log', level: 'info', message: `▶ ${currentStage}` });
          return;
        }
        case 'stage.completed':
        case 'stage_run.completed':
          ctx.emit({ type: 'log', level: 'info', message: `✓ ${currentStage || String(data['name'] ?? '')}` });
          return;
        case 'stage.failed':
        case 'stage_run.failed':
          ctx.emit({
            type: 'log',
            level: 'error',
            message: `✗ ${currentStage || String(data['name'] ?? '')}: ${String(data['error'] ?? '')}`,
          });
          return;
        case 'stage_run.awaiting_input':
          ctx.emit({
            type: 'log',
            level: 'warn',
            message: `⏳ ${currentStage} is waiting for approval — run \`generatorai run hitl pending ${runId}\``,
          });
          return;
      }

      if (internalTurn || data['__isInternalTurn']) return;

      switch (event.kind) {
        case 'harness.token':
          if (verbosity !== 'minimal') ctx.chunk(String(data['text'] ?? ''));
          break;
        case 'harness.reasoning_delta':
          if (showThinking) ctx.chunk(String(data['text'] ?? ''), 'thinking');
          break;
        case 'harness.tool_start':
          if (showTools) {
            ctx.emit({
              type: 'log',
              level: 'info',
              message: `  → ${String(data['tool'] ?? data['name'] ?? 'tool')}`,
            });
          }
          break;
        case 'harness.usage':
          if (verbosity === 'verbose') {
            ctx.emit({ type: 'log', level: 'debug', message: `tokens: ${JSON.stringify(data)}` });
          }
          break;
      }
    },
  });

  // The stream never ends on its own; the poll decides when the run is over.
  // Racing them means a missed terminal event cannot hang the command.
  const terminal = await waitForRunTerminal(ctx, runId);
  await ctx.dispose();
  await streamed.catch(() => undefined);

  if (terminal.status === 'failed') {
    throw new CliError('RESULT_FAILED', `Run failed: ${terminal.error ?? 'no error message'}`, {
      details: { runId, status: terminal.status },
    });
  }
}

export function runCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'run.list',
      group: 'run',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List workflow runs',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        { name: 'status', description: 'Filter by status', type: 'string' },
        { name: 'definition', description: 'Filter by workflow', type: 'string', completes: 'workflow' },
        { name: 'limit', description: 'Maximum rows', type: 'number', default: 50 },
      ],
      schema: inputSchema(
        {},
        {
          status: z.string().optional(),
          definition: z.string().optional(),
          limit: z.coerce.number().int().positive().default(50),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          { key: 'name', header: 'Name', priority: 1 },
          statusColumn,
          { key: 'workflowDefinitionId', header: 'Workflow', format: 'id', priority: 3 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        const definitionId = flags.definition
          ? (await findDefinition(ctx, flags.definition)).id
          : undefined;
        return list(
          await ctx.api.runs.list(compact({ status: flags.status, definitionId, limit: flags.limit })),
        );
      },
    }),

    defineCommand({
      id: 'run.start',
      group: 'run',
      verb: 'start',
      summary: 'Create and start a run',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai run start nightly-e2e --var topic=caching --watch',
        'generatorai run start a3f2 --profile quick-surface --permission-mode acceptEdits',
      ],
      args: [
        {
          name: 'workflow',
          description: 'Workflow definition reference',
          required: true,
          completes: 'workflow',
        },
      ],
      flags: [
        {
          name: 'name',
          description: 'Name for this run',
          type: 'string',
          unsupported: 'The server has no route that names a run, so this value is accepted and discarded.',
        },
        { name: 'var', description: 'Variable as key=value (repeatable)', type: 'string', variadic: true },
        { name: 'profile', description: 'Run profile name or path', type: 'string' },
        { name: 'project', description: 'Project id or name', type: 'string', completes: 'project' },
        {
          name: 'permissionMode',
          description: 'Permission mode for the run',
          type: 'string',
          choices: PERMISSION_MODES,
        },
        watchFlag,
        verbosityFlag,
        { name: 'noStart', description: 'Create the run but leave it pending', type: 'boolean' },
      ],
      schema: inputSchema(
        { workflow: z.string() },
        {
          name: z.string().optional(),
          var: z.array(z.string()).optional(),
          profile: z.string().optional(),
          project: z.string().optional(),
          permissionMode: z.enum(PERMISSION_MODES).optional(),
          watch: z.boolean().optional(),
          verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
          noStart: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Started run {id}' },
      async handler(ctx, { args, flags }) {
        const definition = await findDefinition(ctx, args.workflow);
        const full = await ctx.api.definitions.get(definition.id);

        const profile = flags.profile ? await loadRunProfile(flags.profile) : {};
        const variables = { ...profile.variables, ...parseKeyValues(flags.var) };

        const declared = ((full as unknown as Record<string, unknown>)['variables'] ?? []) as Array<{
          name: string;
          required?: boolean;
          type?: string;
          defaultValue?: unknown;
        }>;
        const { errors, warnings } = validateVariables(declared, variables);
        if (errors.length) {
          throw new CliError('VALIDATION', `Cannot start run:\n${errors.map((e) => `  ${e}`).join('\n')}`, {
            hint: declared.length
              ? `Declared variables: ${declared.map((v) => v.name).join(', ')}`
              : 'This workflow declares no variables.',
          });
        }

        let projectId = profile.projectId;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }

        // Stage overrides ride in as a reserved variable; that is the channel
        // the run service reads them from.
        if (profile.stageOverrides?.length) {
          (variables as Record<string, unknown>)['__stageOverrides'] = profile.stageOverrides;
        }

        const created = await ctx.api.runs.create(
          compact({
            workflowDefinitionId: definition.id,
            variables,
            projectId,
          }),
        );

        // `CreateWorkflowRunSchema` accepts only the three fields above, and
        // the validate() middleware replaces the body with its stripped parse
        // output — so a name or permission mode sent alongside them would be
        // dropped without a word. Apply them as follow-ups instead.
        const permissionMode = flags.permissionMode ?? profile.permissionMode;
        if (permissionMode) {
          await ctx.api.runs.permissionMode
            .set(created.id, permissionMode)
            .catch((error: unknown) => {
              warnings.push(
                `Run created, but the permission mode stayed at the default: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
        }

        const name = flags.name ?? profile.name;
        if (name) {
          warnings.push('Runs are not named server-side yet; --name was not applied.');
        }

        if (flags.noStart) {
          return { data: created, warnings, message: `Created run ${created.id} (pending)` };
        }

        const started = await ctx.api.runs.start(created.id);

        if (flags.watch) {
          await watchRun(ctx, created.id, flags.verbosity);
          return { data: await ctx.api.runs.get(created.id), warnings };
        }

        return {
          data: started,
          warnings,
          message: `Started run ${created.id} — watch it with \`generatorai run watch ${created.id}\``,
        };
      },
    }),

    defineCommand({
      id: 'run.show',
      group: 'run',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show a run and its stages',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [{ name: 'stages', description: 'Include stage detail', type: 'boolean', default: true }],
      schema: inputSchema({ run: z.string() }, { stages: z.boolean().default(true) }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const run = await ctx.api.runs.get(target.id);
        if (!flags.stages) return record(run);
        const stages = await ctx.api.runs.stages(target.id);
        return record({ ...run, stages });
      },
    }),

    defineCommand({
      id: 'run.watch',
      group: 'run',
      verb: 'watch',
      summary: 'Stream a run until it reaches a terminal state',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [verbosityFlag],
      schema: inputSchema(
        { run: z.string() },
        { verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal') },
      ),
      output: { kind: 'stream' },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const run = await ctx.api.runs.get(target.id);
        if (isTerminalRunState(run.status)) {
          return record(run, `Run already ${run.status}.`);
        }
        await watchRun(ctx, target.id, flags.verbosity);
        return record(await ctx.api.runs.get(target.id));
      },
    }),

    ...(['pause', 'resume', 'cancel', 'retry'] as const).map((verb) =>
      defineCommand({
        id: `run.${verb}`,
        group: 'run',
        verb,
        summary: `${verb[0]!.toUpperCase()}${verb.slice(1)} a run`,
        requiresServer: true,
        destructive: verb === 'cancel',
        sinceVersion: '0.2.0',
        args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
        flags: verb === 'retry' ? [watchFlag, verbosityFlag] : [],
        schema: inputSchema(
          { run: z.string() },
          {
            watch: z.boolean().optional(),
            verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
          },
        ),
        output: { kind: 'record', successMessage: `Run {id} ${verb}d.` },
        async handler(ctx, { args, flags }) {
          const target = await findRun(ctx, args.run);
          const result = await ctx.api.runs[verb](target.id);
          if (verb === 'retry' && flags.watch) {
            await watchRun(ctx, target.id, flags.verbosity);
            return record(await ctx.api.runs.get(target.id));
          }
          return record(result);
        },
      }),
    ),

    defineCommand({
      id: 'run.delete',
      group: 'run',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a run record',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        await ctx.api.runs.remove(target.id);
        return ok(`Deleted run ${target.id}.`);
      },
    }),

    defineCommand({
      id: 'run.stage.list',
      group: 'run',
      verb: 'stage list',
      summary: 'Stage runs for a run',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'id', header: 'Stage Run', format: 'id', priority: 0 },
          { key: 'stageName', header: 'Stage', priority: 0 },
          statusColumn,
          { key: 'startedAt', header: 'Started', format: 'relative', priority: 3 },
          { key: 'durationMs', header: 'Duration', format: 'duration', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        return list(await ctx.api.runs.stages(target.id));
      },
    }),

    ...(['pause', 'resume', 'retry', 'cancel'] as const).map((verb) =>
      defineCommand({
        id: `run.stage.${verb}`,
        group: 'run',
        verb: `stage ${verb}`,
        summary: `${verb[0]!.toUpperCase()}${verb.slice(1)} one stage`,
        requiresServer: true,
        destructive: verb === 'cancel',
        sinceVersion: '0.2.0',
        args: [
          { name: 'run', description: 'Run reference', required: true, completes: 'run' },
          { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        ],
        flags: [],
        schema: inputSchema({ run: z.string(), stage: z.string() }, {}),
        output: { kind: 'void', successMessage: `Stage ${verb}d.` },
        async handler(ctx, { args }) {
          const run = await findRun(ctx, args.run);
          const stage = await findStage(ctx, run.id, args.stage);
          await ctx.api.runs.stage[verb](run.id, stage.id);
          return ok(`Stage ${stage.name ?? stage.id} ${verb}d.`);
        },
      }),
    ),

    defineCommand({
      id: 'run.hitl.mode',
      group: 'run',
      verb: 'hitl mode',
      summary: 'Show or set the run permission mode',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'run', description: 'Run reference', required: true, completes: 'run' },
        { name: 'mode', description: 'New mode; omit to read', required: false },
      ],
      flags: [],
      schema: inputSchema({ run: z.string(), mode: z.enum(PERMISSION_MODES).optional() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        if (!args.mode) return record(await ctx.api.runs.permissionMode.get(target.id));
        return record(
          await ctx.api.runs.permissionMode.set(target.id, args.mode),
          `Permission mode set to ${args.mode}.`,
        );
      },
    }),

    defineCommand({
      id: 'run.hitl.pending',
      group: 'run',
      verb: 'hitl pending',
      summary: 'Gates waiting for a human decision',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'stageId', header: 'Stage', format: 'id', priority: 0 },
          { key: 'stageName', header: 'Name', priority: 0 },
          { key: 'prompt', header: 'Prompt', priority: 1 },
          { key: 'createdAt', header: 'Waiting since', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        return list(await ctx.api.runs.pendingInterrupts(target.id));
      },
    }),

    // Three verdicts, one per command. `rejected` terminates the run;
    // `changes_requested` sends feedback and re-parks the stage.
    ...(
      [
        { verb: 'approve', outcome: 'approved', past: 'approved' },
        { verb: 'reject', outcome: 'rejected', past: 'rejected' },
        { verb: 'changes-request', outcome: 'changes_requested', past: 'sent back for changes' },
      ] as const
    ).map(({ verb, outcome, past }) =>
      defineCommand({
        id: `run.hitl.${verb}`,
        group: 'run',
        verb: `hitl ${verb}`,
        summary:
          outcome === 'approved'
            ? 'Approve a waiting stage'
            : outcome === 'rejected'
              ? 'Reject a waiting stage and fail the run'
              : 'Send a waiting stage back for changes',
        requiresServer: true,
        destructive: outcome === 'rejected',
        sinceVersion: '0.2.0',
        args: [
          { name: 'run', description: 'Run reference', required: true, completes: 'run' },
          { name: 'stage', description: 'Stage reference', required: true, completes: 'stage' },
        ],
        flags: [
          { name: 'value', description: 'JSON value to hand back to the stage', type: 'string' },
          { name: 'reason', description: 'Why', type: 'string' },
          {
            name: 'followUp',
            description: 'Follow-up prompt sent to the agent',
            type: 'string',
          },
        ],
        schema: inputSchema(
          { run: z.string(), stage: z.string() },
          {
            value: z.string().optional(),
            reason: z.string().optional(),
            followUp: z.string().optional(),
          },
        ),
        output: { kind: 'record', successMessage: `Stage ${past}.` },
        async handler(ctx, { args, flags }) {
          const run = await findRun(ctx, args.run);
          const stage = await findStage(ctx, run.id, args.stage);

          let value: unknown;
          if (flags.value !== undefined) {
            try {
              value = JSON.parse(flags.value);
            } catch {
              value = flags.value;
            }
          }

          return record(
            await ctx.api.runs.stage.approve(
              run.id,
              stage.id,
              compact({ outcome, value, reason: flags.reason, followUpPrompt: flags.followUp }),
            ),
          );
        },
      }),
    ),

    defineCommand({
      id: 'run.profile.list',
      group: 'run',
      verb: 'profile list',
      summary: 'Run profiles visible from here',
      requiresServer: false,
      sinceVersion: '0.2.0',
      args: [],
      flags: [],
      schema: inputSchema({}, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'name', header: 'Name', priority: 0 },
          { key: 'scope', header: 'Scope', priority: 1 },
          { key: 'path', header: 'Path', priority: 3 },
        ],
      },
      async handler() {
        const rows: Array<{ name: string; scope: string; path: string }> = [];
        for (const [scope, dir] of [
          ['project', getRunProfilesDir()],
          ['user', getUserRunProfilesDir()],
        ] as const) {
          try {
            for (const file of await fs.readdir(dir)) {
              if (file.endsWith('.json')) {
                rows.push({ name: file.replace(/\.json$/, ''), scope, path: path.join(dir, file) });
              }
            }
          } catch {
            // Directory does not exist — nothing to list from this scope.
          }
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'run.profile.generate',
      group: 'run',
      verb: 'profile generate',
      summary: 'Write a run-profile template for a workflow',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
      ],
      flags: [{ name: 'out', short: 'o', description: 'Output path', type: 'string' }],
      schema: inputSchema({ workflow: z.string() }, { out: z.string().optional() }),
      output: { kind: 'record' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const definition = await findDefinition(ctx, args.workflow);
        const full = (await ctx.api.definitions.get(definition.id)) as unknown as Record<string, unknown>;
        const declared = (full['variables'] ?? []) as Array<{ name: string; defaultValue?: unknown }>;

        const profile: RunProfile = {
          name: `${String(full['name'] ?? 'run')} profile`,
          variables: Object.fromEntries(declared.map((v) => [v.name, v.defaultValue ?? ''])),
          permissionMode: 'default',
          stageOverrides: [],
        };

        if (!flags.out) return record(profile);

        const target = path.resolve(flags.out);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
        return record({ path: target }, `Wrote ${target}`);
      },
    }),

    defineCommand({
      id: 'run.profile.validate',
      group: 'run',
      verb: 'profile validate',
      summary: 'Check a run profile against a workflow definition',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'workflow', description: 'Workflow reference', required: true, completes: 'workflow' },
        { name: 'profile', description: 'Profile name or path', required: true },
      ],
      flags: [],
      schema: inputSchema({ workflow: z.string(), profile: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const definition = await findDefinition(ctx, args.workflow);
        const full = (await ctx.api.definitions.get(definition.id)) as unknown as Record<string, unknown>;
        const declared = (full['variables'] ?? []) as Array<{ name: string; required?: boolean; type?: string }>;
        const profile = await loadRunProfile(args.profile);

        const { errors, warnings } = validateVariables(declared, profile.variables ?? {});

        const stageIds = new Set(
          ((full['stages'] ?? []) as Array<{ id: string }>).map((s) => s.id),
        );
        for (const override of profile.stageOverrides ?? []) {
          if (!stageIds.has(override.stageId)) {
            errors.push(`stage override targets unknown stage "${override.stageId}"`);
          }
        }

        if (errors.length) {
          throw new CliError('VALIDATION', `Profile is not valid:\n${errors.map((e) => `  ${e}`).join('\n')}`);
        }
        return { data: { valid: true, warnings }, warnings, message: 'Profile is valid.' };
      },
    }),

    defineCommand({
      id: 'run.messages',
      group: 'run',
      verb: 'messages',
      summary: 'Messages recorded for a run, optionally one stage',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [{ name: 'stage', description: 'Limit to one stage', type: 'string', completes: 'stage' }],
      schema: inputSchema({ run: z.string() }, { stage: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [
          { key: 'role', header: 'Role', priority: 0 },
          { key: 'content', header: 'Content', priority: 0 },
          { key: 'timestamp', header: 'When', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args, flags }) {
        const target = await findRun(ctx, args.run);
        const stages = (await ctx.api.runs.stages(target.id)) as unknown as Array<Record<string, unknown>>;

        const wanted = flags.stage
          ? [await findStage(ctx, target.id, flags.stage)]
          : stages.map((s) => ({ id: String(s['id']), name: String(s['stageName'] ?? '') }));

        const sessionByStage = new Map(
          stages.map((s) => [String(s['id']), s['sessionId'] as string | undefined]),
        );

        const rows: Array<Record<string, unknown>> = [];
        for (const stage of wanted) {
          const sessionId = sessionByStage.get(stage.id);
          if (!sessionId) continue;
          const messages = await ctx.api.sessions.chat(sessionId);
          for (const message of messages) rows.push({ stage: stage.name, ...message });
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'run.diff',
      group: 'run',
      verb: 'diff',
      summary: 'Unified diff of everything a run changed',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'raw' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        const diff = await ctx.api.orchestrator.runDiff(target.id);
        return record(typeof diff === 'string' ? diff : (diff.diff ?? ''));
      },
    }),

    defineCommand({
      id: 'run.workspace',
      group: 'run',
      verb: 'workspace',
      summary: 'Workspace a run executed in',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'run', description: 'Run reference', required: true, completes: 'run' }],
      flags: [],
      schema: inputSchema({ run: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findRun(ctx, args.run);
        return record(await ctx.api.orchestrator.runWorkspace(target.id));
      },
    }),
  ];
}
