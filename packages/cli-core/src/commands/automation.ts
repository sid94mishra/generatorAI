// `generatorai automation …` — triggers that fan out into workflow runs.

import { z } from 'zod';
import type { CreateAutomationParams } from '@generatorai/shared';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
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
  readTextFile,
  record,
  requireSomeUpdate,
  statusColumn,
} from './_shared.js';
import { listDefinitions } from './workflow.js';

export const AUTOMATION_GROUP = {
  name: 'automation',
  aliases: ['auto'],
  summary: 'Scheduled, webhook and manual triggers that fan out into runs',
  order: 40,
};

const TRIGGERS = ['manual', 'schedule', 'webhook'] as const;
// `AutomationErrorPolicy` (packages/shared) has exactly these two values —
// the CLI previously also offered 'retry', which `CreateAutomationSchema`
// does not accept and `validate()` would have silently stripped.
const ERROR_POLICIES = ['continue', 'stop'] as const;
const DATASET_FORMATS = ['json_array', 'csv', 'jsonl'] as const;
// PD-18 — the permission mode an automation's unattended runs use.
const PERMISSION_MODES = ['acceptEdits', 'default', 'plan', 'bypassPermissions'] as const;

/** Parses a JSON-valued flag, or fails naming the flag. */
function parseJsonFlag(flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw CliError.usage(`--${flag} is not valid JSON.`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

async function findAutomation(ctx: CliContext, ref: string) {
  const automations = await ctx.api.automations.list();
  return resolveRef(ref, { kind: 'automation', candidates: automations });
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
          { key: 'enabled', header: 'Enabled', format: 'boolean', priority: 0 },
          { key: 'schedule', header: 'Schedule', priority: 3 },
          // The scheduler has always stored `nextRunAt`; neither this table
          // nor the web list showed it, so the one question an operator has
          // about a scheduled automation had no answer anywhere.
          { key: 'nextRunAt', header: 'Next run', format: 'relative', priority: 1 },
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
        'generatorai auto create --name review-each --workflow review --data-schema \'{"format":"json_array","fields":[{"name":"file","type":"string"}]}\' --iteration-mode \'{"kind":"each_row"}\'',
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
        { name: 'dataSchema', description: 'JSON row schema: each dataset row becomes run variables', type: 'string' },
        { name: 'iterationMode', description: 'JSON iteration mode, e.g. {"kind":"each_row"} (required with --data-schema)', type: 'string' },
        { name: 'defaultDatasetFile', description: 'Default dataset (used by schedule triggers and bare manual triggers)', type: 'string', completes: 'file' },
        { name: 'defaultDatasetFormat', description: 'Format of --default-dataset-file', type: 'string', choices: DATASET_FORMATS },
        { name: 'var', description: 'Static variable key=value (repeatable)', type: 'string', variadic: true },
        { name: 'maxConcurrency', description: 'Parallel run cap (1-10)', type: 'number' },
        { name: 'onError', description: 'Error policy', type: 'string', choices: ERROR_POLICIES },
        {
          name: 'permissionMode',
          description: 'Permission mode of the unattended runs (bypass on a webhook needs admin:settings)',
          type: 'string',
          choices: PERMISSION_MODES,
          default: 'acceptEdits',
        },
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
          dataSchema: z.string().optional(),
          iterationMode: z.string().optional(),
          defaultDatasetFile: z.string().optional(),
          defaultDatasetFormat: z.enum(DATASET_FORMATS).optional(),
          var: z.array(z.string()).optional(),
          maxConcurrency: z.coerce.number().int().min(1).max(10).optional(),
          onError: z.enum(ERROR_POLICIES).optional(),
          permissionMode: z.enum(PERMISSION_MODES).default('acceptEdits'),
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
        if (flags.dataSchema && !flags.iterationMode) {
          throw CliError.usage('--iteration-mode is required with --data-schema.', {
            hint: 'e.g. --iteration-mode \'{"kind":"each_row"}\'',
          });
        }
        if (flags.defaultDatasetFile && !flags.defaultDatasetFormat) {
          throw CliError.usage('--default-dataset-format is required with --default-dataset-file.');
        }
        const dataSchema = flags.dataSchema
          ? (parseJsonFlag('data-schema', flags.dataSchema) as CreateAutomationParams['dataSchema'])
          : undefined;
        const iterationMode = flags.iterationMode
          ? (parseJsonFlag('iteration-mode', flags.iterationMode) as CreateAutomationParams['iterationMode'])
          : undefined;
        const defaultDataset = flags.defaultDatasetFile
          ? {
              format: flags.defaultDatasetFormat!,
              data: await readTextFile(path.resolve(flags.defaultDatasetFile), 'default dataset file'),
            }
          : undefined;

        const definitions = await listDefinitions(ctx);
        const workflowIds = flags.workflow.map(
          (ref) => resolveRef(ref, { kind: 'workflow', candidates: definitions }).id,
        );

        let projectId: string | undefined;
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project, { kind: 'project', candidates: projects }).id;
        }

        // Field names below are `CreateAutomationParams`'s exactly.
        const created = await ctx.api.automations.create({
          name: flags.name,
          workflowIds,
          triggerType: flags.trigger,
          permissionMode: flags.permissionMode,
          variables: parseKeyValues(flags.var),
          ...compact({
            cronExpression: flags.schedule,
            dataSchema,
            iterationMode,
            defaultDataset,
            maxConcurrency: flags.maxConcurrency,
            onError: flags.onError,
            projectId,
          }),
        });

        const warnings: string[] = [];
        let result = created;
        if (flags.enabled) {
          try {
            // `enable()` returns the post-enable record — reusing `created`
            // here reported `enabled: false` in the CLI's own output even
            // though the server call right above it had just succeeded.
            result = await ctx.api.automations.enable(created.id);
          } catch (error) {
            warnings.push(
              `Automation created, but was not enabled: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        return { data: result, ...(warnings.length ? { warnings } : {}) };
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
        { name: 'maxConcurrency', description: 'Parallel run cap (1-10)', type: 'number' },
        { name: 'onError', description: 'Error policy', type: 'string', choices: ERROR_POLICIES },
        { name: 'permissionMode', description: 'Permission mode of the unattended runs', type: 'string', choices: PERMISSION_MODES },
        { name: 'var', description: 'Static variable key=value (repeatable, replaces)', type: 'string', variadic: true },
      ],
      schema: inputSchema(
        { automation: z.string() },
        {
          name: z.string().optional(),
          schedule: z.string().optional(),
          maxConcurrency: z.coerce.number().int().min(1).max(10).optional(),
          onError: z.enum(ERROR_POLICIES).optional(),
          permissionMode: z.enum(PERMISSION_MODES).optional(),
          var: z.array(z.string()).optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findAutomation(ctx, args.automation);
        // `cronExpression`/`onError` are `UpdateAutomationParams`'s real
        // names — the previous `schedule`/`errorPolicy` keys were silently
        // stripped by `validate()`, so `automation update --schedule ...`
        // reported success while changing nothing.
        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            cronExpression: flags.schedule,
            maxConcurrency: flags.maxConcurrency,
            onError: flags.onError,
            permissionMode: flags.permissionMode,
            variables: flags.var ? parseKeyValues(flags.var) : undefined,
          }),
          'Pass at least one field to change.',
        );
        return record(await ctx.api.automations.update(target.id, body));
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
      summary: 'Issue a new webhook token + signing secret, invalidating the old ones',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'automation', description: 'Automation reference', required: true, completes: 'automation' }],
      flags: [],
      schema: inputSchema({ automation: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findAutomation(ctx, args.automation);
        // Response is `{ token, signingSecret }` — shown ONLY in this
        // output. Neither value can be retrieved again: `automation show`
        // and `automation list` always come back redacted.
        const result = await ctx.api.automations.rotateWebhookToken(target.id);
        return {
          data: result,
          warnings: [
            'The previous token and signing secret stopped working immediately. ' +
              'This is the only place the new ones are shown — save them now.',
          ],
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
          { key: 'totalIterations', header: 'Runs', format: 'number', priority: 1 },
          { key: 'completedIterations', header: 'Done', format: 'number', priority: 2 },
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
