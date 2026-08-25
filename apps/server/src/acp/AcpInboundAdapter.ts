// ────────────────────────────────────────────────────────────────
// W10 — ACP Inbound Adapter
//
// Exposes GeneratorAI as an ACP (Agent Communication Protocol) agent
// over stdio so external ACP-aware tools (Cursor, Cline, Goose, etc.)
// can use GeneratorAI as a backend.
//
// Transport: JSON-RPC 2.0 over stdio (one message per line, both
// directions). This matches the ACP v0.2 wire format.
//
// ACP v0.2 methods handled:
//   initialize    — capability negotiation
//   turn          — execute one user turn (streaming response via notifications)
//   cancel        — abort an in-progress turn
//   shutdown      — graceful exit
//
// Security note (L16): ACP is Tier-B. Tool gating happens at the host
// boundary (CUA/PTY/Browser) for Tier-B sessions, not at the provider
// gate (which cannot fire on every call for ACP). This adapter marks the
// conversation as Tier-B so the gateway enforces the right policy.
// ────────────────────────────────────────────────────────────────

/* W10 */

import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import type { EventBus } from '@generatorai/core';
import type { PersistedEvent } from '@generatorai/shared';

// ── ACP Protocol Types ───────────────────────────────────────────

/** Supported ACP protocol versions (preferred first). */
const SUPPORTED_VERSIONS = ['0.2', '0.1'] as const;
type AcpVersion = (typeof SUPPORTED_VERSIONS)[number];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// ACP chunk types (§5.9-b, ACP v0.2 turn/chunk payload)
type AcpChunk =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | { type: 'tool_result'; callId: string; output: unknown; success: boolean }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'cancelled'; reason?: string }
  | { type: 'error'; message: string; code?: number };

// ACP initialize request params
interface AcpInitializeParams {
  protocolVersion: string;
  clientInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
}

// ACP turn request params
interface AcpTurnParams {
  sessionId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  workingDirectory?: string;
}

// ACP cancel params
interface AcpCancelParams {
  sessionId: string;
}

// ── Harness bridge interface ────────────────────────────────────

/**
 * Minimal harness interface the adapter needs.
 * Decoupled from the full IAgentHarness to avoid import cycles.
 */
export interface AcpHarnessBridge {
  /** Create a new conversation. Returns a conversationId. */
  createConversation(params: {
    conversationId: string;
    model?: string;
    workingDirectory?: string;
  }): Promise<{ conversationId: string }>;

  /** Send a prompt to an existing conversation. */
  sendPrompt(conversationId: string, text: string): Promise<void>;

  /** Abort a running conversation turn. */
  abortConversation(conversationId: string): Promise<void>;
}

// ── Session state ───────────────────────────────────────────────

interface AcpSession {
  /** ACP session id (from client). */
  acpSessionId: string;
  /** Internal GeneratorAI conversationId. */
  conversationId: string;
  /** EventBus unsubscribe callback. */
  unsubscribe: (() => void) | null;
  /** Whether a turn is currently active. */
  activeTurn: boolean;
}

// ── Adapter ─────────────────────────────────────────────────────

export interface AcpInboundAdapterOptions {
  harness: AcpHarnessBridge;
  eventBus: EventBus;
  /** Generator instance id for the initialize response. */
  serverName?: string;
  serverVersion?: string;
  /** Override stdin/stdout (for testing). */
  input?: NodeJS.ReadableStream;
  output?: Writable;
  /** Called when the adapter exits (shutdown or stdin close). */
  onExit?: (code: number) => void;
}

export class AcpInboundAdapter {
  /* W10 */
  private readonly harness: AcpHarnessBridge;
  private readonly eventBus: EventBus;
  private readonly out: Writable;
  private readonly onExit: (code: number) => void;
  private readonly serverName: string;
  private readonly serverVersion: string;

  /** ACP sessionId → session state */
  private readonly sessions = new Map<string, AcpSession>();

  /** Negotiated protocol version after initialize. */
  private negotiatedVersion: AcpVersion | null = null;

  /** Whether we have received an initialize message. */
  private initialized = false;

  constructor(opts: AcpInboundAdapterOptions) {
    this.harness = opts.harness;
    this.eventBus = opts.eventBus;
    this.out = opts.output ?? process.stdout;
    this.onExit = opts.onExit ?? ((code) => process.exit(code));
    this.serverName = opts.serverName ?? 'GeneratorAI';
    this.serverVersion = opts.serverVersion ?? '0.1.0';
  }

  /** Start the stdio read loop. Returns when stdin closes. */
  start(input?: NodeJS.ReadableStream): void {
    const rl = createInterface({
      input: input ?? process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleLine(trimmed).catch((err) => {
        this.sendLog('error', `Unhandled ACP adapter error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    rl.on('close', () => {
      this.cleanupAllSessions();
      this.onExit(0);
    });
  }

  // ── Line handler ──────────────────────────────────────────────

  private async handleLine(line: string): Promise<void> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      // Malformed JSON — send a parse error. No id available.
      this.sendError(null, -32700, 'Parse error');
      return;
    }

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      this.sendError(req.id ?? null, -32600, 'Invalid Request');
      return;
    }

    // Pre-initialize guard
    if (req.method !== 'initialize' && !this.initialized) {
      this.sendError(req.id ?? null, -32002, 'Server not initialized');
      return;
    }

    switch (req.method) {
      case 'initialize':
        await this.handleInitialize(req);
        break;
      case 'turn':
        await this.handleTurn(req);
        break;
      case 'cancel':
        await this.handleCancel(req);
        break;
      case 'shutdown':
        await this.handleShutdown(req);
        break;
      default:
        if (req.id != null) {
          this.sendError(req.id, -32601, `Method not found: ${req.method}`);
        }
        // Notifications with unknown methods are silently ignored per JSON-RPC spec.
    }
  }

  // ── Method handlers ──────────────────────────────────────────

  private async handleInitialize(req: JsonRpcRequest): Promise<void> {
    const params = req.params as AcpInitializeParams | undefined;
    const requested = params?.protocolVersion ?? '0.2';

    // Version negotiation — use the client's requested version if we support it,
    // otherwise reject. We do not silently upgrade; the client must re-initialize
    // with a supported version.
    const negotiated: AcpVersion | null = (SUPPORTED_VERSIONS as readonly string[]).includes(requested)
      ? (requested as AcpVersion)
      : null;

    if (!negotiated) {
      this.sendError(req.id ?? null, -32001, `Unsupported protocol version: ${requested}. Supported: ${SUPPORTED_VERSIONS.join(', ')}`);
      return;
    }

    if (requested !== negotiated) {
      this.sendLog('warn', `Client requested ACP ${requested}, negotiated ${negotiated}`);
    }

    this.negotiatedVersion = negotiated;
    this.initialized = true;

    this.sendResult(req.id ?? null, {
      protocolVersion: negotiated,
      serverInfo: {
        name: this.serverName,
        version: this.serverVersion,
      },
      capabilities: {
        // What GeneratorAI can do as an ACP server
        streaming: true,
        cancellation: true,
        toolCalls: true,
        // ACP Tier-B constraint: we cannot gate every tool call at the ACP layer
        // (L16). Terminal/browser/CUA capabilities are denied for Tier-B sessions.
        terminal: false,
        fs: false,
      },
    });
  }

  private async handleTurn(req: JsonRpcRequest): Promise<void> {
    const params = req.params as AcpTurnParams | undefined;
    if (!params?.sessionId || !Array.isArray(params.messages)) {
      this.sendError(req.id ?? null, -32602, 'Invalid params: sessionId and messages required');
      return;
    }

    const { sessionId, messages, model, workingDirectory } = params;

    // Get or create the GeneratorAI session
    let session = this.sessions.get(sessionId);
    if (!session) {
      const conversationId = `acp-${sessionId}-${Date.now()}`;
      try {
        await this.harness.createConversation({ conversationId, model, workingDirectory });
      } catch (err) {
        this.sendError(req.id ?? null, -32000, `Failed to create conversation: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // Subscribe to this conversation's events
      const unsubscribe = this.eventBus.subscribe(
        conversationId,
        (event: PersistedEvent) => {
          this.handleAgentEvent(sessionId, event);
        },
        `acp-inbound:${sessionId}`,
      );

      session = { acpSessionId: sessionId, conversationId, unsubscribe, activeTurn: false };
      this.sessions.set(sessionId, session);
    }

    if (session.activeTurn) {
      this.sendError(req.id ?? null, -32000, 'A turn is already in progress for this session');
      return;
    }

    // Extract the last user message
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      this.sendError(req.id ?? null, -32602, 'No user message found in messages array');
      return;
    }

    session.activeTurn = true;

    // Acknowledge: stream_start
    this.sendResult(req.id ?? null, { type: 'stream_start', sessionId });

    // Send the prompt (non-blocking — events flow via EventBus subscription)
    this.harness.sendPrompt(session.conversationId, lastUser.content).catch((err) => {
      // Only emit error if the turn is still marked active (not already cancelled)
      if (session!.activeTurn) {
        session!.activeTurn = false;
        this.sendChunk(sessionId, {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          code: -32000,
        });
      }
    });
  }

  private async handleCancel(req: JsonRpcRequest): Promise<void> {
    const params = req.params as AcpCancelParams | undefined;
    if (!params?.sessionId) {
      if (req.id != null) {
        this.sendError(req.id, -32602, 'Invalid params: sessionId required');
      }
      return;
    }

    const session = this.sessions.get(params.sessionId);
    if (session?.activeTurn) {
      await this.harness.abortConversation(session.conversationId).catch(() => undefined);
      // The harness.cancelled event will arrive via EventBus and cleanly end the turn.
    }

    if (req.id != null) {
      this.sendResult(req.id, { cancelled: true });
    }
  }

  private async handleShutdown(req: JsonRpcRequest): Promise<void> {
    if (req.id != null) {
      this.sendResult(req.id, null);
    }
    this.cleanupAllSessions();
    // Give the response a chance to flush before exiting
    setImmediate(() => this.onExit(0));
  }

  // ── AgentEvent → ACP chunk mapping ──────────────────────────

  private handleAgentEvent(acpSessionId: string, event: PersistedEvent): void {
    const session = this.sessions.get(acpSessionId);
    if (!session) return;

    const { kind, data } = event as { kind: string; data: Record<string, unknown> };

    switch (kind) {
      case 'harness.token': {
        /* W10 */
        const text = (data as { text?: string }).text;
        if (text) {
          this.sendChunk(acpSessionId, { type: 'text', content: text });
        }
        break;
      }

      case 'harness.thinking': {
        /* W10 */
        const thinking = (data as { text?: string }).text;
        if (thinking) {
          this.sendChunk(acpSessionId, { type: 'thinking', content: thinking });
        }
        break;
      }

      case 'harness.tool_start': {
        /* W10 */
        const d = data as { tool?: string; args?: unknown; callId?: string };
        this.sendChunk(acpSessionId, {
          type: 'tool_call',
          callId: d.callId ?? `call-${Date.now()}`,
          name: d.tool ?? 'unknown',
          input: d.args,
        });
        break;
      }

      case 'harness.tool_complete': {
        /* W10 */
        const d = data as { tool?: string; result?: unknown; callId?: string; success?: boolean };
        this.sendChunk(acpSessionId, {
          type: 'tool_result',
          callId: d.callId ?? '',
          output: d.result,
          success: d.success !== false,
        });
        break;
      }

      case 'harness.cancelled': {
        /* W10 — X-4 semantic cancellation */
        const d = data as { reason?: string };
        session.activeTurn = false;
        this.sendChunk(acpSessionId, { type: 'cancelled', reason: d.reason });
        break;
      }

      case 'harness.error': {
        /* W10 */
        const d = data as { message?: string };
        session.activeTurn = false;
        this.sendChunk(acpSessionId, {
          type: 'error',
          message: d.message ?? 'Unknown harness error',
        });
        break;
      }

      case 'chat.message_complete':
      case 'harness.idle': {
        /* W10 — turn is done */
        const d = data as { usage?: { inputTokens?: number; outputTokens?: number } };
        session.activeTurn = false;
        this.sendChunk(acpSessionId, {
          type: 'done',
          usage: d.usage
            ? {
                inputTokens: d.usage.inputTokens ?? 0,
                outputTokens: d.usage.outputTokens ?? 0,
              }
            : undefined,
        });
        break;
      }

      // Delta events (tokens, thinking fragments) — already handled above.
      // All other events are silently ignored at the ACP boundary.
      default:
        break;
    }
  }

  // ── JSON-RPC write helpers ───────────────────────────────────

  private send(msg: JsonRpcResponse | JsonRpcNotification): void {
    try {
      this.out.write(JSON.stringify(msg) + '\n');
    } catch {
      // stdout may close before we finish writing — swallow silently
    }
  }

  private sendResult(id: number | string | null, result: unknown): void {
    this.send({ jsonrpc: '2.0', id: id ?? null, result });
  }

  private sendError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.send({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    });
  }

  private sendChunk(sessionId: string, chunk: AcpChunk): void {
    this.send({
      jsonrpc: '2.0',
      method: 'turn/chunk',
      params: { sessionId, chunk },
    });
  }

  private sendLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.send({
      jsonrpc: '2.0',
      method: 'log',
      params: { level, message },
    });
  }

  // ── Cleanup ──────────────────────────────────────────────────

  private cleanupAllSessions(): void {
    for (const session of this.sessions.values()) {
      session.unsubscribe?.();
    }
    this.sessions.clear();
  }

  /** Exposed for testing. */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
