// `generatorai automation …` — triggers that fan out into workflow runs.

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import {
  compact,
  createdColumn,
  idColumn,
  inputSchema,
  list,
  nameColumn,
  ok,
  parseKeyValues,
  projectFlag,
  record,
  requireSomeUpdate,
  statusColumn,
} from './_shared.js';

export const AUTOMATION_GROUP = {
  name: 'automation',
  aliases: ['auto'],
  summary: 'Scheduled, webhook and manual triggers that fan out into runs',
  order: 40,
};

const TRIGGERS = ['manual', 'schedule', 'webhook'] as const;
const INPUT_MODES = ['single', 'loop', 'batch', 'script'] as const;
const ERROR_POLICIES = ['stop', 'continue', 'retry'] as const;

async function findAutomation(ctx: CliContext, ref: string) {
  const automations = await ctx.api.automations.list();
  return resolveRef(ref, { kind: 'automation', candidates: automations as never });
}

export function automationCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'automation.list',
      group: 'automation',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List automations',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [projectFlag],
      schema: inputSchema({}, { project: z.string().optional() }),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          { key: 'triggerType', header: 'Trigger', priority: 0 },
          { key: 'inputMode', header: 'Input', priority: 1 },
          { key: 'enabled', header: 'Enabled', format: 'boolean', priority: 0 },
          { key: 'schedule', header: 'Schedule', priority: 3 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }
        return list(await ctx.api.automations.list(projectId));
      },
    }),

    defineCommand({
      id: 'automation.show',
      group: 'automation',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show an automation with recent executions',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [],
      schema: inputSchema({ automation: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        return record(await ctx.api.automations.get(target.id));
      },
    }),

    defineCommand({
      id: 'automation.create',
      group: 'automation',
      verb: 'create',
      aliases: ['new'],
      summary: 'Create an automation',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai auto create --name nightly --workflow e2e --trigger schedule --schedule "0 2 * * *"',
        'generatorai auto create --name batch --workflow review --input-mode loop --loop-variable file',
      ],
      args: [],
      flags: [
        { name: 'name', description: 'Automation name', type: 'string', required: true },
        {
          name: 'workflow',
          description: 'Workflow definition (repeatable — they run in order)',
          type: 'string',
          variadic: true,
          required: true,
          completes: 'workflow',
        },
        { name: 'trigger', description: 'Trigger type', type: 'string', choices: TRIGGERS, default: 'manual' },
        { name: 'schedule', description: 'Cron expression (schedule trigger)', type: 'string' },
        { name: 'inputMode', description: 'How inputs fan out', type: 'string', choices: INPUT_MODES, default: 'single' },
        { name: 'loopVariable', description: 'Variable iterated in loop mode', type: 'string' },
        { name: 'batchFormat', description: 'Batch payload format', type: 'string' },
        { name: 'var', description: 'Static variable key=value (repeatable)', type: 'string', variadic: true },
        { name: 'maxConcurrency', description: 'Parallel run cap', type: 'number' },
        { name: 'onError', description: 'Error policy', type: 'string', choices: ERROR_POLICIES },
        { name: 'dataSource', description: 'Data-source script id or JSON config', type: 'string' },
        projectFlag,
        { name: 'enabled', description: 'Enable immediately', type: 'boolean' },
      ],
      schema: inputSchema(
        {},
        {
          name: z.string().min(1),
          workflow: z.array(z.string()).min(1, 'at least one workflow is required'),
          trigger: z.enum(TRIGGERS).default('manual'),
          schedule: z.string().optional(),
          inputMode: z.enum(INPUT_MODES).default('single'),
          loopVariable: z.string().optional(),
          batchFormat: z.string().optional(),
          var: z.array(z.string()).optional(),
          maxConcurrency: z.coerce.number().int().positive().optional(),
          onError: z.enum(ERROR_POLICIES).optional(),
          dataSource: z.string().optional(),
          project: z.string().optional(),
          enabled: z.boolean().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Created automation {id}' },
      async handler(ctx, { flags }) {
        if (flags.trigger === 'schedule' && !flags.schedule) {
          throw CliError.usage('--schedule is required when --trigger is schedule.', {
            hint: 'Use a 5-field cron expression, e.g. "0 2 * * *".',
          });
        }
        if (flags.inputMode === 'loop' && !flags.loopVariable) {
          throw CliError.usage('--loop-variable is required when --input-mode is loop.');
        }

        const definitions = await ctx.api.definitions.list();
        const workflowIds = flags.workflow.map(
          (ref) => resolveRef(ref, { kind: 'workflow', candidates: definitions as never }).id,
        );

        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }

        let dataSource: unknown;
        if (flags.dataSource) {
          try {
            dataSource = JSON.parse(flags.dataSource);
          } catch {
            dataSource = { scriptId: flags.dataSource };
          }
        }

        return record(
          await ctx.api.automations.create(
            compact({
              name: flags.name,
              workflowDefinitionIds: workflowIds,
              triggerType: flags.trigger,
              schedule: flags.schedule,
              inputMode: flags.inputMode,
              loopVariable: flags.loopVariable,
              batchFormat: flags.batchFormat,
              variables: parseKeyValues(flags.var),
              maxConcurrency: flags.maxConcurrency,
              errorPolicy: flags.onError,
              dataSource,
              projectId,
              enabled: flags.enabled ?? false,
            }) as never,
          ),
        );
      },
    }),

    defineCommand({
      id: 'automation.update',
      group: 'automation',
      verb: 'update',
      summary: 'Patch an automation',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'schedule', description: 'New cron expression', type: 'string' },
        { name: 'maxConcurrency', description: 'Parallel run cap', type: 'number' },
        { name: 'onError', description: 'Error policy', type: 'string', choices: ERROR_POLICIES },
        { name: 'var', description: 'Static variable key=value (repeatable, replaces)', type: 'string', variadic: true },
      ],
      schema: inputSchema(
        { automation: z.string() },
        {
          name: z.string().optional(),
          schedule: z.string().optional(),
          maxConcurrency: z.coerce.number().int().positive().optional(),
          onError: z.enum(ERROR_POLICIES).optional(),
          var: z.array(z.string()).optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findAutomation(ctx, args.automation);
        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            schedule: flags.schedule,
            maxConcurrency: flags.maxConcurrency,
            errorPolicy: flags.onError,
            variables: flags.var ? parseKeyValues(flags.var) : undefined,
          }),
          'Pass at least one field to change.',
        );
        return record(await ctx.api.automations.update(target.id, body as never));
      },
    }),

    ...(['enable', 'disable'] as const).map((verb) =>
      defineCommand({
        id: `automation.${verb}`,
        group: 'automation',
        verb,
        summary: `${verb === 'enable' ? 'Enable' : 'Disable'} an automation`,
        requiresServer: true,
        sinceVersion: '0.2.0',
        args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
        flags: [],
        schema: inputSchema({ automation: z.string() }, {}),
        output: { kind: 'record', successMessage: `Automation {id} ${verb}d.` },
        async handler(ctx, { args }) {
          const target = await findAutomation(ctx, args.automation);
          return record(await ctx.api.automations[verb](target.id));
        },
      }),
    ),

    defineCommand({
      id: 'automation.trigger',
      group: 'automation',
      verb: 'trigger',
      aliases: ['run'],
      summary: 'Fire an automation now',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [
        { name: 'var', description: 'Payload variable key=value (repeatable)', type: 'string', variadic: true },
        { name: 'payload', description: 'Raw JSON payload', type: 'string' },
      ],
      schema: inputSchema(
        { automation: z.string() },
        { var: z.array(z.string()).optional(), payload: z.string().optional() },
      ),
      output: { kind: 'record', successMessage: 'Triggered execution {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findAutomation(ctx, args.automation);

        let dataset: Record<string, unknown> = parseKeyValues(flags.var);
        if (flags.payload) {
          try {
            dataset = { ...dataset, ...(JSON.parse(flags.payload) as Record<string, unknown>) };
          } catch (error) {
            throw new CliError('VALIDATION', '--payload is not valid JSON.', {
              hint: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // The authenticated route, not the public webhook: it works for
        // `manual` and `schedule` automations that have no token, validates
        // the dataset, and dedups a retried invocation.
        return record(
          await ctx.api.automations.trigger(
            target.id,
            Object.keys(dataset).length ? { dataset } : {},
            { idempotencyKey: randomUUID() },
          ),
        );
      },
    }),

    defineCommand({
      id: 'automation.rotateWebhookToken',
      group: 'automation',
      verb: 'rotate-webhook-token',
      summary: 'Issue a new webhook token, invalidating the old one',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [],
      schema: inputSchema({ automation: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        const result = await ctx.api.automations.rotateWebhookToken(target.id);
        return {
          data: result,
          warnings: ['The previous token stopped working immediately. Update any callers.'],
        };
      },
    }),

    defineCommand({
      id: 'automation.execution.list',
      group: 'automation',
      verb: 'execution list',
      summary: 'Executions of an automation',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [],
      schema: inputSchema({ automation: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          statusColumn,
          { key: 'totalRuns', header: 'Runs', format: 'number', priority: 1 },
          { key: 'completedRuns', header: 'Done', format: 'number', priority: 2 },
          createdColumn,
        ],
      },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        return list(await ctx.api.automations.executions(target.id));
      },
    }),

    defineCommand({
      id: 'automation.execution.show',
      group: 'automation',
      verb: 'execution show',
      summary: 'One execution and its nested runs',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'automation', description: 'Automation reference', required: true, completes: 'automation' },
        { name: 'execution', description: 'Execution id', required: true },
      ],
      flags: [],
      schema: inputSchema({ automation: z.string(), execution: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        return record(await ctx.api.automations.execution(target.id, args.execution));
      },
    }),

    defineCommand({
      id: 'automation.execution.cancel',
      group: 'automation',
      verb: 'execution cancel',
      summary: 'Cancel an execution and its runs',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'automation', description: 'Automation reference', required: true, completes: 'automation' },
        { name: 'execution', description: 'Execution id', required: true },
      ],
      flags: [],
      schema: inputSchema({ automation: z.string(), execution: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Cancelled.' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        await ctx.api.automations.cancelExecution(target.id, args.execution);
        return ok('Cancelled execution.');
      },
    }),

    defineCommand({
      id: 'automation.datasource.test',
      group: 'automation',
      verb: 'datasource test',
      summary: 'Dry-run a data-source config and print what it would yield',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'config', description: 'JSON config, or a script id', required: true }],
      flags: [],
      schema: inputSchema({ config: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(args.config) as Record<string, unknown>;
        } catch {
          config = { scriptId: args.config };
        }
        return record(await ctx.api.automations.testDataSource(config));
      },
    }),

    defineCommand({
      id: 'automation.delete',
      group: 'automation',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete an automation',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [],
      schema: inputSchema({ automation: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        await ctx.api.automations.remove(target.id);
        return ok(`Deleted automation ${target.name ?? target.id}.`);
      },
    }),
  ];
}
