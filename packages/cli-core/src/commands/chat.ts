// `generatorai chat …` — the conversation surface.

import { z } from 'zod';
import type { SendMessageInput } from '@generatorai/client-core';
import { defineCommand, type CommandResult, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import { resolveRef } from '../refs/resolveRef.js';
import type { CliContext } from '../context/CliContext.js';
import {
  createdColumn,
  idColumn,
  inputSchema,
  list,
  nameColumn,
  ok,
  parseList,
  projectFlag,
  record,
  requireSomeUpdate,
  compact,
  statusColumn,
  streamUntil,
  verbosityFlag,
} from './_shared.js';

export const CHAT_GROUP = {
  name: 'chat',
  summary: 'Conversations against a provider, optionally scoped to a project',
  order: 10,
};

/** Resolves a chat reference against the full list. */
async function findChat(ctx: CliContext, ref: string) {
  const chats = await ctx.api.chats.list();
  return resolveRef(ref, {
    kind: 'chat',
    candidates: chats.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    activeStatuses: ['running', 'active'],
  });
}

/**
 * Renders one assistant turn to the surface and resolves when it completes.
 *
 * `harness.completion` is the authoritative end-of-turn marker; the fallback
 * on `harness.error` exists because a provider failure emits an error and
 * then stops, with no completion event to wait for.
 */
async function streamTurn(
  ctx: CliContext,
  chatId: string,
  sessionId: string | null,
  verbosity: 'minimal' | 'normal' | 'verbose',
  /** `false` follows the conversation instead of stopping at the first turn. */
  untilTurnEnds = true,
): Promise<void> {
  const showThinking = verbosity === 'verbose';
  const showTools = verbosity !== 'minimal';
  let internalTurn = false;

  await streamUntil(ctx, sessionId ? 'session' : 'chat', sessionId ?? chatId, {
    onEvent: (event) => {
      const data = event.data;
      // Hook context injection and validation feedback run as real turns on
      // the same session. Rendering them makes the agent look like it is
      // talking to itself.
      if (event.kind === 'harness.turn_start') {
        internalTurn = Boolean(data['__isInternalTurn']);
        return;
      }
      if (internalTurn || data['__isInternalTurn']) return;

      switch (event.kind) {
        case 'harness.token':
          ctx.chunk(String(data['text'] ?? ''));
          break;
        case 'harness.reasoning_delta':
          if (showThinking) ctx.chunk(String(data['text'] ?? ''), 'thinking');
          break;
        case 'harness.tool_start':
          if (showTools) {
            ctx.emit({
              type: 'log',
              level: 'info',
              message: `→ ${String(data['tool'] ?? data['name'] ?? 'tool')}`,
            });
          }
          break;
        case 'harness.tool_error':
          ctx.emit({
            type: 'log',
            level: 'error',
            message: `tool failed: ${String(data['error'] ?? 'unknown')}`,
          });
          break;
        case 'harness.error':
          ctx.emit({ type: 'log', level: 'error', message: String(data['message'] ?? 'error') });
          break;
      }
    },
    ...(untilTurnEnds
      ? {
          isDone: (event: { kind: string }) =>
            event.kind === 'harness.completion' ||
            event.kind === 'chat.turn_complete' ||
            event.kind === 'harness.error',
        }
      : {}),
  });
}

export function chatCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'chat.list',
      group: 'chat',
      verb: 'list',
      aliases: ['ls'],
      summary: 'List chats',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [],
      flags: [
        {
          name: 'status',
          description: 'Filter by status',
          type: 'string',
          choices: ['active', 'archived', 'all'] as const,
          default: 'active',
        },
        projectFlag,
        { name: 'limit', description: 'Maximum rows', type: 'number' },
      ],
      schema: inputSchema(
        {},
        {
          status: z.enum(['active', 'archived', 'all']).default('active'),
          project: z.string().optional(),
          limit: z.coerce.number().int().positive().optional(),
        },
      ),
      output: {
        kind: 'list',
        columns: [
          idColumn,
          nameColumn,
          statusColumn,
          { key: 'model', header: 'Model', priority: 2 },
          { key: 'projectId', header: 'Project', format: 'id', priority: 4 },
          createdColumn,
        ],
      },
      async handler(ctx, { flags }) {
        const params: { archived?: boolean; limit?: number } = {};
        if (flags.status === 'archived') params.archived = true;
        if (flags.status === 'active') params.archived = false;
        if (flags.limit) params.limit = flags.limit;

        let rows = await ctx.api.chats.list(params);
        if (flags.project) {
          const projects = await ctx.api.projects.list();
          const project = resolveRef(flags.project, { kind: 'project', candidates: projects });
          rows = rows.filter((c) => c.projectId === project.id);
        }
        return list(rows);
      },
    }),

    defineCommand({
      id: 'chat.create',
      group: 'chat',
      verb: 'create',
      aliases: ['new'],
      summary: 'Create a chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai chat create "auth refactor" --project acme --agent reviewer',
        'generatorai chat create scratch --model claude-sonnet-4.6 --no-worktree',
      ],
      args: [{ name: 'name', description: 'Chat name', required: true }],
      flags: [
        { name: 'description', short: 'd', description: 'Description', type: 'string' },
        { name: 'model', description: 'Model id', type: 'string', completes: 'model' },
        projectFlag,
        { name: 'agent', description: 'Agent reference to bind', type: 'string', completes: 'agent' },
        {
          name: 'codebase',
          description: 'Codebase alias to attach (repeatable, max 3)',
          type: 'string',
          variadic: true,
          completes: 'codebase',
        },
        { name: 'worktree', description: 'Create a git worktree (default when a project is set)', type: 'boolean' },
        { name: 'noWorktree', description: 'Skip worktree creation', type: 'boolean' },
        { name: 'tags', description: 'Comma-separated tags', type: 'string' },
        {
          name: 'permissionMode',
          description: 'Initial permission mode',
          type: 'string',
          choices: ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const,
        },
      ],
      schema: inputSchema(
        { name: z.string().min(1, 'a chat needs a name') },
        {
          description: z.string().optional(),
          model: z.string().optional(),
          project: z.string().optional(),
          agent: z.string().optional(),
          codebase: z.array(z.string()).optional(),
          worktree: z.boolean().optional(),
          noWorktree: z.boolean().optional(),
          tags: z.string().optional(),
          permissionMode: z.string().optional(),
        },
      ),
      output: {
        kind: 'record',
        successMessage: 'Created chat {id}',
        fields: [idColumn, nameColumn, statusColumn, { key: 'model', header: 'Model' }],
      },
      async handler(ctx, { flags, args }) {
        if (flags.worktree && flags.noWorktree) {
          throw CliError.usage('--worktree and --no-worktree are mutually exclusive.');
        }
        if ((flags.codebase?.length ?? 0) > 3) {
          throw CliError.usage('A chat can attach at most 3 codebases.');
        }

        let projectId: string | undefined;
        if (flags.project ?? ctx.config.cli.defaultProjectId) {
          const projects = await ctx.api.projects.list();
          projectId = resolveRef(flags.project ?? ctx.config.cli.defaultProjectId!, {
            kind: 'project',
            candidates: projects,
          }).id;
        }

        const body = compact({
          name: args.name,
          description: flags.description,
          model: flags.model ?? ctx.config.cli.defaultModel,
          projectId,
          agentRef: flags.agent,
          codebaseAliases: flags.codebase,
          useWorktree: flags.noWorktree ? false : flags.worktree,
          tags: parseList(flags.tags),
          permissionMode: flags.permissionMode,
        });

        return record(
          await ctx.api.chats.create(body as unknown as { name: string }),
          `Created chat ${args.name}`,
        );
      },
    }),

    defineCommand({
      id: 'chat.show',
      group: 'chat',
      verb: 'show',
      aliases: ['get'],
      summary: 'Show one chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat id, prefix or name', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        return record(await ctx.api.chats.get(target.id));
      },
    }),

    defineCommand({
      id: 'chat.send',
      group: 'chat',
      verb: 'send',
      summary: 'Send a prompt and stream the reply',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai chat send @last "summarise the diff"',
        'echo "explain this" | generatorai chat send a3f2 -',
      ],
      args: [
        { name: 'chat', description: 'Chat reference', required: true, completes: 'chat' },
        { name: 'prompt', description: 'Prompt text, or - to read stdin', required: true },
      ],
      flags: [
        verbosityFlag,
        { name: 'noStream', description: 'Return once the turn completes instead of streaming', type: 'boolean' },
        { name: 'model', description: 'Override the model for this turn', type: 'string', completes: 'model' },
        { name: 'agent', description: 'Override the agent for this turn', type: 'string', completes: 'agent' },
        {
          name: 'attach',
          description: 'Attach a file (repeatable)',
          type: 'string',
          variadic: true,
          completes: 'file',
        },
      ],
      schema: inputSchema(
        { chat: z.string(), prompt: z.string() },
        {
          verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
          noStream: z.boolean().optional(),
          model: z.string().optional(),
          agent: z.string().optional(),
          attach: z.array(z.string()).optional(),
        },
      ),
      output: { kind: 'stream' },
      async handler(ctx, { args, flags }) {
        const target = await findChat(ctx, args.chat);
        const chat = await ctx.api.chats.get(target.id);

        const prompt = args.prompt === '-' ? await readStdin() : args.prompt;
        if (!prompt.trim()) throw CliError.usage('The prompt is empty.');

        // No cast: `SendMessageInput` is the contract, and the cast is what
        // let a wrong field name through to a 400 at runtime.
        const body: SendMessageInput = { message: prompt };

        const warnings: string[] = [];
        // Accepted for forward compatibility but not carried by the JSON
        // prompt route — saying so beats silently dropping them.
        if (flags.model) warnings.push('--model is not applied per turn; set it with `chat update --model`.');
        if (flags.agent) warnings.push('--agent is not applied per turn; bind it with `chat update --agent`.');
        if (flags.attach?.length) {
          warnings.push('--attach needs a multipart upload and is not sent by this command yet.');
        }

        // Subscribe BEFORE sending. Subscribing after the POST races the
        // first tokens, and on a fast local model the whole reply can land
        // before the stream is open.
        if (flags.noStream) {
          await ctx.api.chats.send(target.id, body);
          return { ...ok('Sent.'), ...(warnings.length ? { warnings } : {}) };
        }

        const streamed = streamTurn(ctx, target.id, chat.sessionId ?? null, flags.verbosity);
        await ctx.api.chats.send(target.id, body);
        await streamed;
        ctx.chunk('\n');
        return ok('');
      },
    }),

    defineCommand({
      id: 'chat.watch',
      group: 'chat',
      verb: 'watch',
      summary: 'Attach to a chat and stream events as they arrive',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [verbosityFlag],
      schema: inputSchema(
        { chat: z.string() },
        { verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal') },
      ),
      output: { kind: 'stream' },
      async handler(ctx, { args, flags }) {
        const target = await findChat(ctx, args.chat);
        const chat = await ctx.api.chats.get(target.id);
        // Open-ended: watching follows the conversation and ends on Ctrl+C,
        // which the context turns into a dispose.
        await streamTurn(ctx, target.id, chat.sessionId ?? null, flags.verbosity, false);
        return ok('');
      },
    }),

    defineCommand({
      id: 'chat.messages',
      group: 'chat',
      verb: 'messages',
      summary: 'Message history',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [
        { name: 'limit', description: 'Maximum messages', type: 'number', default: 50 },
        { name: 'before', description: 'Cursor: message id to page back from', type: 'string' },
      ],
      schema: inputSchema(
        { chat: z.string() },
        { limit: z.coerce.number().int().positive().default(50), before: z.string().optional() },
      ),
      output: {
        kind: 'list',
        columns: [
          { key: 'role', header: 'Role', priority: 0 },
          { key: 'content', header: 'Content', priority: 0 },
          { key: 'timestamp', header: 'When', format: 'relative', priority: 2 },
        ],
      },
      async handler(ctx, { args, flags }) {
        const target = await findChat(ctx, args.chat);
        return list(
          await ctx.api.chats.messages(target.id, compact({ limit: flags.limit, before: flags.before })),
        );
      },
    }),

    defineCommand({
      id: 'chat.update',
      group: 'chat',
      verb: 'update',
      summary: 'Rename or retag a chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [
        { name: 'name', description: 'New name', type: 'string' },
        { name: 'description', description: 'New description', type: 'string' },
        { name: 'tags', description: 'Comma-separated tags (replaces)', type: 'string' },
        { name: 'model', description: 'Default model', type: 'string', completes: 'model' },
      ],
      schema: inputSchema(
        { chat: z.string() },
        {
          name: z.string().optional(),
          description: z.string().optional(),
          tags: z.string().optional(),
          model: z.string().optional(),
        },
      ),
      output: { kind: 'record', successMessage: 'Updated {id}' },
      async handler(ctx, { args, flags }) {
        const target = await findChat(ctx, args.chat);
        const body = requireSomeUpdate(
          compact({
            name: flags.name,
            description: flags.description,
            tags: parseList(flags.tags),
            model: flags.model,
          }),
          'Pass at least one of --name, --description, --tags or --model.',
        );
        return record(await ctx.api.chats.update(target.id, body as never));
      },
    }),

    defineCommand({
      id: 'chat.permissionMode',
      group: 'chat',
      verb: 'permission-mode',
      summary: 'Show or set the chat permission mode',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'chat', description: 'Chat reference', required: true, completes: 'chat' },
        { name: 'mode', description: 'New mode; omit to read the current one', required: false },
      ],
      flags: [],
      schema: inputSchema(
        {
          chat: z.string(),
          mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
        },
        {},
      ),
      output: { kind: 'record' },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        if (!args.mode) {
          const chat = await ctx.api.chats.get(target.id);
          return record({ permissionMode: chat.permissionMode ?? 'default' });
        }
        await ctx.api.chats.setPermissionMode(target.id, args.mode);
        return record({ permissionMode: args.mode }, `Permission mode set to ${args.mode}`);
      },
    }),

    defineCommand({
      id: 'chat.cancel',
      group: 'chat',
      verb: 'cancel',
      aliases: ['stop'],
      summary: 'Stop the in-flight turn',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Cancelled.' },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        await ctx.api.chats.cancel(target.id);
        return ok('Cancelled.');
      },
    }),

    defineCommand({
      id: 'chat.archive',
      group: 'chat',
      verb: 'archive',
      summary: 'Archive a chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Archived.' },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        await ctx.api.chats.archive(target.id);
        return ok(`Archived ${target.name ?? target.id}.`);
      },
    }),

    defineCommand({
      id: 'chat.delete',
      group: 'chat',
      verb: 'delete',
      aliases: ['rm'],
      summary: 'Delete a chat and its messages',
      requiresServer: true,
      destructive: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: { kind: 'void', successMessage: 'Deleted.' },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        await ctx.api.chats.remove(target.id);
        return ok(`Deleted ${target.name ?? target.id}.`);
      },
    }),

    defineCommand({
      id: 'chat.plans',
      group: 'chat',
      verb: 'plans',
      summary: 'Plans produced in a chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'planId', header: 'Plan', format: 'id', priority: 0 },
          { key: 'title', header: 'Title', priority: 0 },
          { key: 'status', header: 'Status', format: 'status', priority: 1 },
          { key: 'revision', header: 'Rev', format: 'number', priority: 2 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        return list(await ctx.api.chats.plans(target.id));
      },
    }),

    defineCommand({
      id: 'chat.plan',
      group: 'chat',
      verb: 'plan',
      summary: 'Print a plan document, or approve/reject it',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [
        { name: 'chat', description: 'Chat reference', required: true, completes: 'chat' },
        { name: 'planId', description: 'Plan id', required: true },
      ],
      flags: [
        { name: 'approve', description: 'Approve the plan', type: 'boolean' },
        { name: 'reject', description: 'Reject the plan', type: 'boolean' },
        { name: 'note', description: 'Decision note', type: 'string' },
      ],
      schema: inputSchema(
        { chat: z.string(), planId: z.string() },
        { approve: z.boolean().optional(), reject: z.boolean().optional(), note: z.string().optional() },
      ),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }): Promise<CommandResult<unknown>> {
        const target = await findChat(ctx, args.chat);
        if (flags.approve && flags.reject) {
          throw CliError.usage('--approve and --reject are mutually exclusive.');
        }
        if (flags.approve || flags.reject) {
          await ctx.api.chats.decidePlan(target.id, args.planId, {
            // `PlanDecisionSchema` takes a boolean plus `feedback`; a
            // `decision` string is stripped by validation and the required
            // `approved` field then reads as missing.
            approved: Boolean(flags.approve),
            ...(flags.note ? { feedback: flags.note } : {}),
          });
          return ok(flags.approve ? 'Plan approved.' : 'Plan rejected.');
        }
        const content = await ctx.api.chats.planContent(target.id, args.planId);
        return record(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      },
    }),

    defineCommand({
      id: 'chat.tasks',
      group: 'chat',
      verb: 'tasks',
      summary: 'Background tasks spawned by an orchestrator chat',
      requiresServer: true,
      sinceVersion: '0.2.0',
      args: [{ name: 'chat', description: 'Chat reference', required: true, completes: 'chat' }],
      flags: [],
      schema: inputSchema({ chat: z.string() }, {}),
      output: {
        kind: 'list',
        columns: [
          { key: 'taskId', header: 'Task', format: 'id', priority: 0 },
          { key: 'taskName', header: 'Name', priority: 0 },
          { key: 'status', header: 'Status', format: 'status', priority: 0 },
          { key: 'model', header: 'Model', priority: 3 },
        ],
      },
      async handler(ctx, { args }) {
        const target = await findChat(ctx, args.chat);
        const response = await ctx.api.chats.backgroundTasks(target.id);
        // The route wraps its rows in `{ tasks }` where every other list
        // endpoint returns a bare array.
        return list(Array.isArray(response) ? response : (response.tasks ?? []));
      },
    }),
  ];
}

/**
 * Reads all of stdin.
 *
 * Guarded on `isTTY` so `chat send <id> -` at an interactive prompt fails
 * fast with a usable message instead of hanging with no output, which is what
 * a naive read does and is indistinguishable from a broken command.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw CliError.usage('Reading the prompt from stdin, but stdin is a terminal.', {
      hint: 'Pipe the prompt in, or pass it as an argument.',
      suggestions: ['echo "your prompt" | generatorai chat send <id> -'],
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
