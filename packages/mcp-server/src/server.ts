// ────────────────────────────────────────────────────────────────
// GeneratorAiMcpServer — an MCP server exposing a RUNNING GeneratorAI
// server to external MCP clients (Claude Code, Codex, Claude Desktop, …)
// over stdio (P04 WP-4.4, RV-23, W-58; P06 WP-6.8).
//
// Remote mode only: everything acts on the server at `GENERATORAI_URL`
// through `@generatorai/client-core`, authenticated as a paired device of
// platform `mcp` (PD-22). There is no embedded core: a second engine on a
// second database is exactly what W-58 removed.
//
// Tools:
//   generatorai_<name>        — every workflow tool the server lists
//                               (`GET /workflow-tools`: list, describe, run,
//                               check, respond, cancel, the authoring guide,
//                               validate, plan, create a draft). The server
//                               runs the same handlers an in-app agent gets,
//                               so descriptions, limits and refusals match.
//   generatorai_list_chats    — chats.list
//   generatorai_send_prompt   — chats.create + chats.send
//
// Resources: the workflow authoring skill bundle, one resource per file,
// `generatorai://workflow-author/<path>` (SKILL.md, reference/*, schema/*,
// examples/*). There are NO prompts: an MCP prompt appears as a slash
// command in Claude Code, and the product has no slash commands.
//
// `AiFacade` is the narrow slice of the remote API the server needs, so it
// can be unit-tested with a fake instead of a live server.
// ────────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  WORKFLOW_AUTHOR_RESOURCE_PREFIX,
  type AuthoringSkillIndex,
  type WorkflowToolAdvert,
} from '@generatorai/workflow-spec';

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

/** One skill file as an MCP resource. */
export interface McpAdvertisedResource {
  uri: string;
  name: string;
  mimeType: string;
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

/** The server's workflow tools (`GET /workflow-tools`, `POST /workflow-tools/:name`). */
export interface AiWorkflowToolApi {
  list(): Promise<WorkflowToolAdvert[]>;
  call(name: string, args: Record<string, unknown>, opts: { idempotencyKey?: string; clientName?: string }): Promise<unknown>;
}

/** The authoring skill bundle the server serves. */
export interface AiSkillApi {
  index(): Promise<AuthoringSkillIndex>;
  file(path: string): Promise<string>;
}

export interface AiFacade {
  chat: AiChatApi;
  workflowTools: AiWorkflowToolApi;
  skill: AiSkillApi;
}

/** Every server tool is advertised under this prefix. */
export const TOOL_PREFIX = 'generatorai_';

/**
 * Tools that start or create something: their MCP schema gains an
 * `idempotencyKey`, sent as the call's key (an MCP call has no headers), so
 * a retried call answers the same run or draft.
 */
const KEYED_TOOLS = new Set(['run_workflow', 'create_workflow_draft']);

const IDEMPOTENCY_KEY_PROPERTY = {
  type: 'string',
  description: 'Any unique string for this call (e.g. a UUID). A retried call with the same key returns the same result instead of doing it twice.',
};

/** How long the server's tool list is reused before it is fetched again. */
const TOOL_CACHE_MS = 30_000;

const CHAT_TOOLS: McpAdvertisedTool[] = [
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
];

/** The MCP advertisement of one server workflow tool. */
export function toMcpTool(advert: WorkflowToolAdvert): McpAdvertisedTool {
  const schema = { type: 'object', ...advert.parametersSchema } as Record<string, unknown>;
  const inputSchema = KEYED_TOOLS.has(advert.name)
    ? { ...schema, properties: { ...((schema['properties'] as Record<string, unknown> | undefined) ?? {}), idempotencyKey: IDEMPOTENCY_KEY_PROPERTY } }
    : schema;
  return {
    name: `${TOOL_PREFIX}${advert.name}`,
    description: advert.description,
    inputSchema,
    annotations: advert.readOnly ? { readOnlyHint: true } : { readOnlyHint: false },
  };
}

/** A sensible media type for a bundle file. */
export function skillMimeType(path: string): string {
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'text/javascript';
  return 'text/plain';
}

export interface McpServerOptions {
  ai: AiFacade;
  name?: string;
  version?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export class GeneratorAiMcpServer {
  private readonly server: Server;
  private toolCache: { at: number; adverts: WorkflowToolAdvert[] } | null = null;

  constructor(private readonly opts: McpServerOptions) {
    this.server = new Server(
      { name: opts.name ?? 'generatorai', version: opts.version ?? '0.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await this.listTools() }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.callTool(name, (args ?? {}) as Record<string, unknown>);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], ...(isRefusal(result) ? { isError: true } : {}) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.log?.(`[GeneratorAiMcpServer] tool '${name}' failed`, { error: message });
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: await this.listResources() }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return { contents: [{ uri, mimeType: skillMimeType(uri), text: await this.readResource(uri) }] };
    });
  }

  private async serverTools(): Promise<WorkflowToolAdvert[]> {
    if (this.toolCache && Date.now() - this.toolCache.at < TOOL_CACHE_MS) return this.toolCache.adverts;
    const adverts = await this.opts.ai.workflowTools.list();
    this.toolCache = { at: Date.now(), adverts };
    return adverts;
  }

  /** The name of the MCP client, from the initialize handshake. */
  private clientName(): string | undefined {
    return this.server.getClientVersion()?.name || undefined;
  }

  private async dispatchChatTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
    if (name === 'generatorai_list_chats') return this.opts.ai.chat.list(str('status'), str('projectId'));

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

  /** Advertised tool list: the chat tools, then every server workflow tool. */
  async listTools(): Promise<McpAdvertisedTool[]> {
    return [...CHAT_TOOLS, ...(await this.serverTools()).map(toMcpTool)];
  }

  /** Call a tool — the MCP handler's path, also exposed for tests and non-MCP callers. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (CHAT_TOOLS.some((t) => t.name === name)) return this.dispatchChatTool(name, args);
    const serverName = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : '';
    if (!serverName || !(await this.serverTools()).some((t) => t.name === serverName)) throw new Error(`Unknown tool: "${name}"`);

    let forwarded = args;
    let idempotencyKey: string | undefined;
    if (KEYED_TOOLS.has(serverName)) {
      const { idempotencyKey: key, ...rest } = args;
      forwarded = rest;
      if (typeof key === 'string' && key) idempotencyKey = key;
    }
    const clientName = this.clientName();
    return this.opts.ai.workflowTools.call(serverName, forwarded, {
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(clientName ? { clientName } : {}),
    });
  }

  /** Every skill bundle file as a resource. */
  async listResources(): Promise<McpAdvertisedResource[]> {
    const index = await this.opts.ai.skill.index();
    return index.files.map((file) => ({
      uri: `${WORKFLOW_AUTHOR_RESOURCE_PREFIX}${file}`,
      name: file,
      mimeType: skillMimeType(file),
    }));
  }

  /** One skill file's text, by its resource URI. */
  async readResource(uri: string): Promise<string> {
    if (!uri.startsWith(WORKFLOW_AUTHOR_RESOURCE_PREFIX)) throw new Error(`Unknown resource: "${uri}"`);
    const file = uri.slice(WORKFLOW_AUTHOR_RESOURCE_PREFIX.length);
    if (!file) throw new Error(`Unknown resource: "${uri}"`);
    return this.opts.ai.skill.file(file);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    this.opts.log?.('[GeneratorAiMcpServer] connected');
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

/** A tool refusal (`{ok: false, code, error}`) is a normal result the model should see as an error. */
function isRefusal(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false;
}
