// ────────────────────────────────────────────────────────────────
// Client-hosted MCP — the platform's tools as an MCP server OpenCode connects
// to over a WebSocket we open (experimental in OpenCode 2.2.7).
//
// `GET /api/experimental/client-mcp?name=&location[directory]=` is upgraded to
// a WebSocket on which WE are the MCP server and OpenCode the client (one
// JSON-RPC message per text frame; reference: `connectClientMcp` in
// `@opencode/client/src/mcp.ts`). Its tools reach every session at that
// location as `<name>_<tool>`, and each call carries the calling session in
// `params._meta["ai.opencode/sessionID"]`.
//
// So: one socket per location (a conversation's working directory), listing
// the UNION of the tools the conversations there registered, and a call is
// dispatched to the handler of the conversation whose session made it. A
// session that does not own the tool gets an error result, never another
// chat's handler. When the union changes, `notifications/tools/list_changed`
// makes OpenCode list again.
//
// OpenCode caps an attached server's tool call at 10 minutes
// (`ATTACHED_EXECUTION_TIMEOUT`, core `mcp/client.ts`).
// ────────────────────────────────────────────────────────────────

import { takeToolBinaries, type ToolDefinition } from '@generatorai/core';

const SESSION_ID_META_KEY = 'ai.opencode/sessionID';
const PROTOCOL_VERSION = '2025-11-25';
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** How long `sync` waits for OpenCode to (re)list the tools before the turn goes ahead anyway. */
const LIST_WAIT_MS = 5_000;

export interface ClientMcpHostOptions {
  /** Base URL of the OpenCode server. */
  url: string;
  /** Handshake headers (the Basic credential). */
  headers: Record<string, string>;
  /** `[a-zA-Z0-9_-]+` — tools appear as `<name>_<tool>`. */
  name: string;
  /** The tools every conversation at `directory` registered. */
  toolsFor: (directory: string) => ToolDefinition[];
  /** The handler for `tool` of the conversation whose session called it, or a reason it has none. */
  resolveCall: (sessionID: string | undefined, tool: string) => { def: ToolDefinition } | { error: string };
  logger?: { warn?: (msg: string) => void };
}

interface Connection {
  directory: string;
  socket?: WebSocket;
  delay: number;
  timer?: ReturnType<typeof setTimeout>;
  /** JSON of the tool list OpenCode last received. */
  listedKey: string | null;
  /** Waiters for the next `tools/list` answer. */
  listWaiters: Array<() => void>;
  initialized: boolean;
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** A host tool's return value as MCP content: text (JSON for objects) plus any binary attachments as images. */
export function toMcpContent(result: unknown): McpContent[] {
  const { text, binaries } = takeToolBinaries(result);
  const content: McpContent[] = [];
  const rendered = typeof text === 'string' ? text : JSON.stringify(text ?? null);
  content.push({ type: 'text', text: rendered });
  for (const b of binaries) {
    if (b.mimeType.startsWith('image/')) content.push({ type: 'image', data: b.data, mimeType: b.mimeType });
  }
  return content;
}

export class ClientMcpHost {
  private readonly connections = new Map<string, Connection>();
  private disposed = false;

  constructor(private readonly opts: ClientMcpHostOptions) {}

  /** Tool names as listed (the MCP-safe form OpenCode accepts). */
  private listFor(directory: string): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    const seen = new Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }>();
    for (const t of this.opts.toolsFor(directory)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(t.name) || seen.has(t.name)) continue;
      seen.set(t.name, {
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', ...(t.parametersSchema ?? {}) },
      });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Make OpenCode's view of `directory`'s tools current: connect when there is
   * no socket yet, announce a changed list, and wait (bounded) until OpenCode
   * has listed them, so the next prompt's model request already has them.
   */
  async sync(directory: string): Promise<void> {
    if (this.disposed) return;
    const tools = this.listFor(directory);
    const key = JSON.stringify(tools);
    let conn = this.connections.get(directory);
    if (!conn) {
      if (tools.length === 0) return; // nothing to host here yet
      conn = { directory, delay: RECONNECT_MIN_MS, listedKey: null, listWaiters: [], initialized: false };
      this.connections.set(directory, conn);
      const listed = this.waitForList(conn);
      this.connect(conn);
      await listed;
      return;
    }
    if (conn.listedKey === key) return;
    const listed = this.waitForList(conn);
    if (conn.initialized) this.send(conn, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    await listed;
  }

  private waitForList(conn: Connection): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        conn.listWaiters = conn.listWaiters.filter((w) => w !== done);
        this.opts.logger?.warn?.(`[OpenCodeProvider] OpenCode did not list the platform tools for ${conn.directory} within ${LIST_WAIT_MS} ms`);
        resolve();
      }, LIST_WAIT_MS);
      timer.unref?.();
      const done = (): void => { clearTimeout(timer); resolve(); };
      conn.listWaiters.push(done);
    });
  }

  private endpoint(directory: string): string {
    const base = new URL(this.opts.url);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const url = new URL('api/experimental/client-mcp', base);
    url.searchParams.set('location[directory]', directory);
    url.searchParams.set('name', this.opts.name);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  private connect(conn: Connection): void {
    if (this.disposed) return;
    // Node's WebSocket (undici) takes `{ headers }` as its second argument; the DOM typings only know protocols.
    const socket = new WebSocket(this.endpoint(conn.directory), { headers: this.opts.headers } as unknown as string[]);
    conn.socket = socket;
    conn.initialized = false;
    socket.addEventListener('message', (event) => {
      if (this.disposed || typeof event.data !== 'string') return;
      let msg: { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      try { msg = JSON.parse(event.data) as typeof msg; } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.method === 'notifications/initialized') {
        conn.initialized = true;
        conn.delay = RECONNECT_MIN_MS;
        return;
      }
      if ((typeof msg.id !== 'string' && typeof msg.id !== 'number') || typeof msg.method !== 'string') return;
      void this.respond(conn, msg.method, msg.params).then((reply) => this.send(conn, { jsonrpc: '2.0', id: msg.id, ...reply }));
    });
    socket.addEventListener('error', () => { /* followed by close */ });
    socket.addEventListener('close', () => {
      if (conn.socket === socket) conn.socket = undefined;
      conn.initialized = false;
      conn.listedKey = null;
      if (this.disposed || !this.connections.has(conn.directory)) return;
      conn.timer = setTimeout(() => this.connect(conn), conn.delay);
      conn.timer.unref?.();
      conn.delay = Math.min(conn.delay * 2, RECONNECT_MAX_MS);
    });
  }

  private send(conn: Connection, message: object): void {
    const socket = conn.socket;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private async respond(conn: Connection, method: string, params: Record<string, unknown> | undefined): Promise<object> {
    switch (method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: typeof params?.['protocolVersion'] === 'string' ? params['protocolVersion'] : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: this.opts.name, version: '1.0.0' },
          },
        };
      case 'ping':
        return { result: {} };
      case 'tools/list': {
        const tools = this.listFor(conn.directory);
        conn.listedKey = JSON.stringify(tools);
        const waiters = conn.listWaiters.splice(0);
        // After the reply is on the wire: resolve on the next tick.
        setTimeout(() => { for (const w of waiters) w(); }, 0);
        return { result: { tools } };
      }
      case 'tools/call': {
        const name = typeof params?.['name'] === 'string' ? params['name'] : '';
        const meta = params?.['_meta'] as Record<string, unknown> | undefined;
        const sessionID = typeof meta?.[SESSION_ID_META_KEY] === 'string' ? (meta[SESSION_ID_META_KEY] as string) : undefined;
        const args = (params?.['arguments'] && typeof params['arguments'] === 'object' ? params['arguments'] : {}) as Record<string, unknown>;
        const found = this.opts.resolveCall(sessionID, name);
        if ('error' in found) return { result: { content: [{ type: 'text', text: found.error }], isError: true } };
        try {
          const out = await found.def.handler(args, {});
          return { result: { content: toMcpContent(out) } };
        } catch (err) {
          return { result: { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true } };
        }
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  /** Drop the socket for a location nobody uses any more. */
  release(directory: string): void {
    const conn = this.connections.get(directory);
    if (!conn) return;
    this.connections.delete(directory);
    clearTimeout(conn.timer);
    conn.socket?.close(1000);
  }

  async close(): Promise<void> {
    this.disposed = true;
    for (const conn of this.connections.values()) {
      clearTimeout(conn.timer);
      for (const w of conn.listWaiters.splice(0)) w();
      conn.socket?.close(1000);
    }
    this.connections.clear();
  }
}
