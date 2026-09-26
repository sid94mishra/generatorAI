// ────────────────────────────────────────────────────────────────
// GeneratorAiMcpServer — an MCP server exposing a RUNNING GeneratorAI
// server to external MCP clients (Claude Desktop, another agent, …) over
// stdio (P04 WP-4.4, RV-23, W-58).
//
// Remote mode only: the tools act on the server at `GENERATORAI_URL`
// through `@generatorai/client-core`, authenticated as a paired device of
// platform `mcp` (PD-22). There is no embedded core: a second engine on a
// second database is exactly what W-58 removed.
//
// Three built-in tools, minimal on purpose (the full tool set, resources and
// prompts arrive in P06):
//   generatorai_list_chats    — chats.list
//   generatorai_send_prompt   — chats.create + chats.send
//   generatorai_run_workflow  — workflows.invoke (THE invocation; the server
//                               derives the trigger `external_agent via mcp`)
//
// `AiFacade` is the narrow slice of the remote API the tools need, so the
// server can be unit-tested with a fake instead of a live server.
// ────────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { InvocationRequest, InvocationResult } from '@generatorai/workflow-spec';

/** Minimal MCP tool advertisement shape (MCP spec 2025-06-18). */
export interface McpAdvertisedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface AiChatSummary {
  id: string;
  name: string;
  status: string;
  projectId?: string | null;
}

/** The chat half of the remote API the tools use. */
export interface AiChatApi {
  list(status?: string, projectId?: string): Promise<AiChatSummary[]>;
  create(options: { name: string; projectId?: string }): Promise<{ id: string }>;
  send(chatId: string, message: string): Promise<void>;
}

/** The workflow half: the one invocation. */
export interface AiWorkflowApi {
  invoke(request: InvocationRequest, opts?: { idempotencyKey?: string }): Promise<InvocationResult>;
}

export interface AiFacade {
  chat: AiChatApi;
  workflows: AiWorkflowApi;
}

const BUILTIN_TOOLS: McpAdvertisedTool[] = [
  {
    name: 'generatorai_list_chats',
    description: 'List GeneratorAI chats, optionally filtered by status and/or project id.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "e.g. 'active', 'archived'" },
        projectId: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'generatorai_send_prompt',
    description:
      'Send a prompt to a GeneratorAI chat. Omit chatId to create a new chat first. Fire-and-forget — ' +
      "the reply streams as events on the chat, not as this call's result.",
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Existing chat id. Omitted → a new chat is created.' },
        message: { type: 'string' },
        name: { type: 'string', description: 'Name for the new chat when chatId is omitted.' },
        projectId: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'generatorai_run_workflow',
    description:
      'Start a run of a GeneratorAI workflow definition. Returns the run id, its plan (stages, codebases, ' +
      'post-processing, permission mode) and links. A repeated idempotencyKey returns the same run.',
    inputSchema: {
      type: 'object',
      properties: {
        definitionId: { type: 'string' },
        variables: { type: 'object', description: 'Input variable values by name' },
        projectId: { type: 'string' },
        codebases: {
          type: 'array',
          description: 'Project codebases to mount: [{alias, baseRef?}]',
          items: { type: 'object', properties: { alias: { type: 'string' }, baseRef: { type: 'string' } }, required: ['alias'] },
        },
        name: { type: 'string', description: 'Run name' },
        testRun: { type: 'boolean', description: 'Run the working graph as a test run (the only way to run a draft)' },
        idempotencyKey: { type: 'string', description: 'A retried call with the same key returns the same run' },
      },
      required: ['definitionId'],
    },
  },
];

export interface McpServerOptions {
  ai: AiFacade;
  name?: string;
  version?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export class GeneratorAiMcpServer {
  private readonly server: Server;

  constructor(private readonly opts: McpServerOptions) {
    this.server = new Server(
      { name: opts.name ?? 'generatorai', version: opts.version ?? '0.1.0' },
      { capabilities: { tools: {} } },
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.dispatch(name, (args ?? {}) as Record<string, unknown>);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.log?.(`[GeneratorAiMcpServer] tool '${name}' failed`, { error: message });
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    });
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
    const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
    switch (name) {
      case 'generatorai_list_chats':
        return this.opts.ai.chat.list(str('status'), str('projectId'));

      case 'generatorai_send_prompt': {
        const message = str('message');
        if (!message) throw new Error('"message" is required');
        let chatId = str('chatId');
        let created = false;
        if (!chatId) {
          const projectId = str('projectId');
          const chat = await this.opts.ai.chat.create({
            name: str('name') ?? `MCP chat ${new Date().toISOString()}`,
            ...(projectId ? { projectId } : {}),
          });
          chatId = chat.id;
          created = true;
        }
        await this.opts.ai.chat.send(chatId, message);
        return { chatId, created };
      }

      case 'generatorai_run_workflow': {
        const definitionId = str('definitionId');
        if (!definitionId) throw new Error('"definitionId" is required');
        const projectId = str('projectId');
        const name = str('name');
        const key = str('idempotencyKey');
        const codebases = Array.isArray(args['codebases'])
          ? (args['codebases'] as Array<{ alias: string; baseRef?: string }>).map((c) => ({
              alias: c.alias,
              mode: 'worktree' as const,
              ...(c.baseRef ? { baseRef: c.baseRef } : {}),
            }))
          : undefined;
        const result = await this.opts.ai.workflows.invoke(
          {
            target: { kind: 'definition', workflowDefinitionId: definitionId, ...(args['testRun'] === true ? { testRun: true } : {}) },
            variables: (args['variables'] as Record<string, unknown> | undefined) ?? {},
            ...(projectId ? { projectId } : {}),
            ...(codebases ? { codebases } : {}),
            ...(name ? { name } : {}),
            client: 'mcp',
          },
          key ? { idempotencyKey: key } : {},
        );
        return { runId: result.runId, status: result.status, replayed: result.replayed, links: result.links, plan: result.plan };
      }

      default:
        throw new Error(`Unknown tool: "${name}"`);
    }
  }

  /** Advertised tool list — exposed for callers that want it without a transport (tests, `--list-tools`). */
  listTools(): McpAdvertisedTool[] {
    return [...BUILTIN_TOOLS];
  }

  /** Call a tool directly — exposed for tests and non-MCP callers. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.dispatch(name, args);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    this.opts.log?.('[GeneratorAiMcpServer] connected');
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
