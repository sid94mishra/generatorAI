// ────────────────────────────────────────────────────────────────
// GeneratorAiMcpServer — a REAL MCP server exposing GeneratorAI itself to
// external MCP clients (Claude Desktop, another agent, etc.), over stdio.
//
// This replaces the previous `McpServerScaffold`, whose `start()` was a
// single log line: the package had `@modelcontextprotocol/sdk` sitting in
// node_modules and a name that promised exactly this, but no wire transport
// and no importer anywhere in the repo.
//
// Three built-in tools, minimal on purpose:
//   generatorai_list_chats    — ai.chat.list()
//   generatorai_send_prompt   — ai.chat.create() + ai.chat.send()
//   generatorai_run_workflow  — ai.workflows.run()
//
// Plus every tool already registered in a `CustomToolRegistry` (TOL-05,
// `toolAdapter.ts`) is advertised and dispatched alongside the built-ins —
// that machinery predates this file and was "fully usable on its own" per
// the old docstring; it just had no transport to reach a client through.
//
// `AiFacade` below is a narrow structural slice of `@generatorai/sdk`'s
// `GeneratorAI` class — a real instance satisfies it, but the server takes
// the interface rather than the class so it can be unit-tested with a fake
// instead of standing up the whole core/db/harness graph.
// ────────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CustomToolRegistry } from '@generatorai/core';
import { advertiseRegistry, invokeRegisteredTool, type McpAdvertisedTool } from './toolAdapter.js';

export interface AiChatSummary {
  id: string;
  name: string;
  status: string;
  projectId?: string;
}

/** Narrow slice of `@generatorai/sdk`'s `ChatFacade` this server needs. */
export interface AiChatApi {
  list(status?: string, projectId?: string): Promise<AiChatSummary[]>;
  create(options: { name: string; description?: string; projectId?: string }): Promise<{ id: string }>;
  send(chatId: string, message: string): Promise<void>;
}

/** Narrow slice of `@generatorai/sdk`'s `WorkflowFacade` this server needs. */
export interface AiWorkflowApi {
  run(
    definitionId: string,
    options?: { variables?: Record<string, unknown>; projectId?: string },
  ): Promise<{ id: string; status: string }>;
}

/** Structural slice of `@generatorai/sdk`'s `GeneratorAI`. A real instance satisfies this. */
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
      'the reply streams as events on the chat, not as this call\'s result.',
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
    description: 'Start a run of a GeneratorAI workflow definition.',
    inputSchema: {
      type: 'object',
      properties: {
        definitionId: { type: 'string' },
        variables: { type: 'object' },
        projectId: { type: 'string' },
      },
      required: ['definitionId'],
    },
  },
];

const BUILTIN_TOOL_NAMES = new Set(BUILTIN_TOOLS.map((t) => t.name));

export interface McpServerOptions {
  ai: AiFacade;
  /** Optional harness-agnostic custom tools (TOL-05) to expose alongside the built-ins. */
  registry?: CustomToolRegistry;
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

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...BUILTIN_TOOLS, ...(this.opts.registry ? advertiseRegistry(this.opts.registry) : [])],
    }));

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
    if (!BUILTIN_TOOL_NAMES.has(name)) {
      if (!this.opts.registry) throw new Error(`Unknown tool: "${name}"`);
      return invokeRegisteredTool(this.opts.registry, name, args);
    }

    switch (name) {
      case 'generatorai_list_chats':
        return this.opts.ai.chat.list(
          typeof args['status'] === 'string' ? args['status'] : undefined,
          typeof args['projectId'] === 'string' ? args['projectId'] : undefined,
        );

      case 'generatorai_send_prompt': {
        const message = args['message'];
        if (typeof message !== 'string' || message.length === 0) {
          throw new Error('"message" is required');
        }
        let chatId = typeof args['chatId'] === 'string' ? args['chatId'] : undefined;
        let created = false;
        if (!chatId) {
          const chat = await this.opts.ai.chat.create({
            name: typeof args['name'] === 'string' ? args['name'] : `MCP chat ${new Date().toISOString()}`,
            projectId: typeof args['projectId'] === 'string' ? args['projectId'] : undefined,
          });
          chatId = chat.id;
          created = true;
        }
        await this.opts.ai.chat.send(chatId, message);
        return { chatId, created };
      }

      case 'generatorai_run_workflow': {
        const definitionId = args['definitionId'];
        if (typeof definitionId !== 'string' || definitionId.length === 0) {
          throw new Error('"definitionId" is required');
        }
        return this.opts.ai.workflows.run(definitionId, {
          variables: (args['variables'] as Record<string, unknown> | undefined) ?? undefined,
          projectId: typeof args['projectId'] === 'string' ? args['projectId'] : undefined,
        });
      }

      default:
        // Unreachable — BUILTIN_TOOL_NAMES gates this branch — but keeps the
        // switch exhaustive without an explicit assertNever import here.
        throw new Error(`Unknown tool: "${name}"`);
    }
  }

  /** Advertised tool list — exposed for callers that want it without a transport (tests, `--list-tools`). */
  listTools(): McpAdvertisedTool[] {
    return [...BUILTIN_TOOLS, ...(this.opts.registry ? advertiseRegistry(this.opts.registry) : [])];
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
