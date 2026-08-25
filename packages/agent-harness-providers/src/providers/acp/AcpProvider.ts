// ────────────────────────────────────────────────────────────────
// AcpProvider — IAgentHarness wrapping ACP-compliant agents.
//
// W39 (was W11) — ACP breadth client. Speaks the Agent Communication
// Protocol (ACP) to any compliant agent (Goose, Cursor, etc.) using
// explicit protocol-version negotiation.
//
// Scope: long-tail agents only — not Claude, Copilot, Codex or OpenCode
// (those have dedicated, higher-fidelity providers).
//
// Architecture laws honoured:
//   L9:  capabilities() declared, fail-closed defaults.
//   L16: Tier-B sessions are host-gated — computer use and unrestricted
//        shell are denied regardless of what the agent's own permission
//        model says. This is the out-of-band host gate that closes the
//        ACP permission fall-through gap (correction C2, REV2).
//   W13: Semantic cancellation — cancel request emits `harness.cancelled`.
//   D11: ACP protocol version negotiated explicitly; never hardcoded.
//
// Protocol: ACP v0.2.1 (pinned; see schemas/versions.json and W45).
// Transport: HTTP (POST /runs, POST /runs/:id/messages, SSE from the run).
// Types: AcpInitializeRequest, AcpTurnRequest from acp.generated.ts.
//
// NOTE: The plan calls for `@agentclientprotocol/sdk` integration. That SDK
// is not yet in the project's dependencies (it must be added when integrating
// a real agent). This provider implements the same semantics against the raw
// ACP HTTP API directly, using our W45-generated types. When the SDK ships
// a stable release, this can be refactored to use it via dynamic import
// while keeping the same IAgentHarness surface.
// ────────────────────────────────────────────────────────────────

import type {
  IAgentHarness,
  CreateConversationParams,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  ConversationResponse,
  ConversationMessage,
  AttachmentRef,
  SendPromptOptions,
  ConversationWarning,
  HarnessAgentInfo,
  ProviderCapabilities,
} from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';
import type { AcpProviderOptions } from '../../types.js';
import {
  ACP_PROTOCOL_VERSION,
  type AcpInitializeRequest,
  type AcpTurnChunk,
  type AcpTurnRequest,
} from '../../protocol/acp.generated.js';

// W13/B1: truncation error codes from ACP agents
const ACP_TRUNCATION_ERROR_CODES = ['max_tokens', 'length_limit', 'context_length_exceeded'] as const;

// ── Type aliases ─────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

interface ConversationState {
  /** ACP run-id for this conversation thread. */
  runId: string | null;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
  abortController: AbortController | null;
}

/** Capability scopes blocked for Tier-B agents (L16 host gate). */
const TIER_B_BLOCKED_CAPABILITIES = ['computer-use', 'shell-unrestricted'] as const;

// ── AcpProvider ──────────────────────────────────────────────────

/**
 * W39 — IAgentHarness backed by any ACP-compliant agent.
 *
 * Lifecycle:
 *   1. `initialize()` pings the agent and negotiates the protocol version.
 *   2. `createConversation()` calls POST /runs to create a run (thread).
 *   3. `sendPromptAndWait()` sends a turn via POST /runs/:id/messages and
 *      reads the SSE event stream for responses.
 *   4. `abortConversation()` sends a cancel message to the run.
 *   5. `shutdown()` is a no-op (we do not own the agent process).
 */
export class AcpProvider implements IAgentHarness {
  private readonly baseUrl: string;
  private readonly opts: AcpProviderOptions;
  private clientState: HarnessClientState = 'starting';
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private conversations = new Map<string, ConversationState>();
  private negotiatedVersion: string = ACP_PROTOCOL_VERSION; // default; updated in initialize()

  constructor(opts: AcpProviderOptions) {
    this.opts = opts;
    // Normalize the address into a base URL
    const addr = opts.address;
    if (addr.startsWith('http://') || addr.startsWith('https://')) {
      this.baseUrl = addr.replace(/\/$/, '');
    } else if (addr.startsWith('ws://') || addr.startsWith('wss://')) {
      // WebSocket transport is not supported — convert to error on initialize()
      this.baseUrl = '';
    } else if (addr.startsWith('stdio://')) {
      // stdio transport: not yet implemented for ACP — fallback to error
      this.baseUrl = '';
    } else {
      this.baseUrl = `http://${addr}`.replace(/\/$/, '');
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.baseUrl) {
      this.clientState = 'error';
      const addr = this.opts.address;
      if (addr.startsWith('ws://') || addr.startsWith('wss://')) {
        throw new Error(`AcpProvider: WebSocket transport (${addr}) is not supported. Use http:// or https://.`);
      }
      throw new Error(`AcpProvider: stdio:// transport is not yet implemented. Use http:// or https://.`);
    }

    // D11: Explicit protocol version negotiation — try preferred, then fall back to '0.1'.
    const preferred = this.opts.preferredVersion ?? ACP_PROTOCOL_VERSION;
    const versionsToTry = preferred === '0.1' ? ['0.1'] : [preferred, '0.1'];

    const buildInitReq = (ver: string): AcpInitializeRequest => ({
      protocolVersion: ver,
      capabilities: {
        // Declare only what we serve (per W39 spec: never lie)
        fs: false,
        terminal: false,
      },
      clientInfo: {
        name: 'GeneratorAI',
        version: '2.0.0',
      },
    });

    let lastErr: unknown;
    for (const ver of versionsToTry) {
      try {
        const resp = await this.post<{ protocolVersion?: string }>('/initialize', buildInitReq(ver));
        this.negotiatedVersion = resp.protocolVersion ?? ver;
        this.clientState = 'running';
        return;
      } catch (err) {
        lastErr = err;
        // Try next version if available
      }
    }

    this.clientState = 'error';
    throw new Error(
      `AcpProvider: failed to initialize ACP agent at ${this.opts.address}. ` +
      `Tried protocol versions: ${versionsToTry.join(', ')}. ` +
      `Ensure the agent is running and supports ACP v0.1 or higher. ` +
      `Error: ${String(lastErr)}`,
    );
  }

  async stop(): Promise<void> { this.clientState = 'stopped'; }
  async forceStop(): Promise<void> { this.clientState = 'stopped'; }
  async shutdown(): Promise<void> { this.clientState = 'stopped'; }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    try {
      await this.rawFetch('GET', '/ping');
      return true;
    } catch { return false; }
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9, L16: Tier-B fail-closed) ────────────────────

  capabilities(): ProviderCapabilities {
    const tierB = this.opts.tierB ?? true; // fail-closed default
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: false,
      skillDirectories: false,
      // Tier-B: full tool gating enforced at host boundary, not in-provider
      fullToolGating: !tierB,
      sessionPersistence: false,
      budgetTracking: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    // ACP does not define a model catalog endpoint; return empty.
    // The model is configured on the agent's side, not picked here.
    return [];
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    // L16 Tier-B gate: record blocked capabilities in warnings
    const warnings: ConversationWarning[] = [];
    if (this.opts.tierB ?? true) {
      for (const blocked of TIER_B_BLOCKED_CAPABILITIES) {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER' as const,
          params: { capability: blocked, reason: 'Tier-B ACP agents cannot use this capability (L16 host gate)' },
        });
      }
    }

    // ACP: create a new run (thread).
    // Failure is surfaced as a warning so callers can see it in getConversationWarnings().
    let runId: string | null = null;
    try {
      const resp = await this.post<{ id: string }>('/runs', {
        agent_id: params.defaultAgent ?? 'default',
      });
      runId = resp.id;
    } catch (err) {
      // Agent may not support the /runs API — fall back to inline /turns.
      // Warn so the caller knows and can log it.
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER' as const,
        params: {
          field: '/runs',
          reason: `POST /runs failed: ${String(err)}. Falling back to /turns endpoint.`,
        },
      });
    }

    this.conversations.set(params.conversationId, {
      runId,
      params,
      listeners: new Set(),
      warnings,
      inFlight: false,
      abortController: null,
    });
    return params.conversationId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversations.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.conversations.keys()];
    return ids[ids.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    if (conv.runId) {
      try { await this.rawFetch('DELETE', `/runs/${conv.runId}`); } catch { /* best effort */ }
    }
    this.conversations.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // ACP agents are selected at the address level; in-session switching is not supported.
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    _options?: SendPromptOptions,
  ): Promise<void> {
    void this.sendPromptAndWait(conversationId, prompt, attachments);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    signal?: AbortSignal,
    _options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`AcpProvider: no conversation "${conversationId}"`);
    if (conv.inFlight) throw new Error(`AcpProvider: conversation "${conversationId}" already has a turn in flight`);

    conv.inFlight = true;
    const ac = new AbortController();
    conv.abortController = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });

    let assistantText = '';

    try {
      // Build ACP turn request (ACP v0.2.1 schema: content is a plain string)
      const turnReq: AcpTurnRequest = {
        messageId: `${conversationId}-${Date.now()}`,
        role: 'user',
        content: prompt,
      };

      const endpoint = conv.runId
        ? `/runs/${conv.runId}/messages`
        : '/turns';

      const resp = await this.rawFetch('POST', endpoint, turnReq, ac.signal);

      if (!resp.ok) {
        throw new Error(`AcpProvider: turn request failed with ${resp.status}`);
      }

      // Read ACP SSE stream. Chunks are typed per AcpTurnChunk (L18: generated types only).
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pendingToolCallIds: string[] = [];
      let turnDone = false;
      const tierB = this.opts.tierB ?? true; // L16: fail-closed

      while (!turnDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          // ACP streams end with [DONE] or a 'done' chunk — either terminates the turn
          if (data === '[DONE]') { turnDone = true; break; }
          try {
            const chunk = JSON.parse(data) as AcpTurnChunk;
            switch (chunk.type) {
              case 'text': {
                const text = chunk.text ?? '';
                if (text) {
                  this.broadcast(conv, { kind: 'harness.token', data: { text } });
                  assistantText += text;
                }
                break;
              }
              case 'tool_call': {
                if (chunk.toolCall) {
                  // L16 Tier-B host gate: block dangerous capabilities
                  if (tierB && TIER_B_BLOCKED_CAPABILITIES.some(
                    (cap) => chunk.toolCall!.name.toLowerCase().includes(cap),
                  )) {
                    this.broadcast(conv, {
                      kind: 'harness.tool_complete',
                      data: {
                        tool: chunk.toolCall.name,
                        result: `Tool "${chunk.toolCall.name}" is blocked for Tier-B ACP agents (L16 host gate). Capability: ${TIER_B_BLOCKED_CAPABILITIES.find((c) => chunk.toolCall!.name.toLowerCase().includes(c))}.`,
                        callId: chunk.toolCall.id,
                        success: false,
                      },
                    });
                  } else {
                    pendingToolCallIds.push(chunk.toolCall.id);
                    this.broadcast(conv, {
                      kind: 'harness.tool_start',
                      data: { tool: chunk.toolCall.name, args: chunk.toolCall.input, callId: chunk.toolCall.id },
                    });
                  }
                }
                break;
              }
              case 'tool_result': {
                if (chunk.toolResult) {
                  this.broadcast(conv, {
                    kind: 'harness.tool_complete',
                    data: {
                      tool: chunk.toolResult.toolCallId,
                      result: chunk.toolResult.content,
                      callId: chunk.toolResult.toolCallId,
                      success: !chunk.toolResult.isError,
                    },
                  });
                }
                break;
              }
              case 'done': {
                // Normal turn completion
                this.broadcast(conv, { kind: 'harness.idle', data: {} });
                turnDone = true;
                break;
              }
              case 'error': {
                const errInfo = chunk.error;
                const code = errInfo?.code ?? '';
                // W13/B1: truncation guard — fail all pending tool calls before emitting idle
                if (ACP_TRUNCATION_ERROR_CODES.some((tc) => code.includes(tc))) {
                  for (const callId of pendingToolCallIds) {
                    this.broadcast(conv, {
                      kind: 'harness.tool_complete',
                      data: {
                        tool: callId,
                        result: `Response was truncated (error.code: ${code}). All tool calls in this batch are cancelled. Please re-issue your request.`,
                        callId,
                        success: false,
                      },
                    });
                  }
                  this.broadcast(conv, { kind: 'harness.idle', data: {} });
                } else {
                  this.broadcast(conv, {
                    kind: 'harness.error',
                    data: { message: errInfo?.message ?? 'ACP agent error', provider: 'acp' },
                  });
                }
                turnDone = true;
                break;
              }
              default:
                break;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      if (!turnDone) {
        // Stream ended without a 'done' chunk (EOF) — emit idle to unblock consumers
        this.broadcast(conv, { kind: 'harness.idle', data: {} });
      }
      return { content: assistantText };
    } catch (err) {
      if (ac.signal.aborted) {
        // W13: semantic cancellation
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
        return { content: assistantText };
      }
      throw err;
    } finally {
      conv.inFlight = false;
      conv.abortController = null;
    }
  }

  async getMessages(_conversationId: string): Promise<ConversationMessage[]> {
    return [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.inFlight) return;
    conv.abortController?.abort();
    if (conv.runId) {
      try {
        await this.rawFetch('POST', `/runs/${conv.runId}/cancel`, {});
      } catch { /* best effort */ }
    }
  }

  // ── Events ────────────────────────────────────────────────────────

  onConversationEvent(
    conversationId: string,
    handler: Listener<AgentEvent>,
  ): UnsubFn {
    const conv = this.conversations.get(conversationId);
    if (!conv) return () => { /* noop */ };
    conv.listeners.add(handler);
    return () => conv.listeners.delete(handler);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private broadcast(conv: ConversationState, event: AgentEvent): void {
    for (const h of conv.listeners) h(event);
  }

  private async post<R = unknown>(path: string, body: unknown): Promise<R> {
    const resp = await this.rawFetch('POST', path, body);
    if (!resp.ok) throw new Error(`AcpProvider: ${path} returned ${resp.status}`);
    return resp.json() as Promise<R>;
  }

  private async rawFetch(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  }
}
