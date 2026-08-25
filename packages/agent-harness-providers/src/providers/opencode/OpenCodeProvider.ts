// ────────────────────────────────────────────────────────────────
// OpenCodeProvider — IAgentHarness wrapping `opencode serve` (HTTP + SSE).
//
// W38 — OpenCode provider. Connects to a running `opencode serve` instance
// at a configurable base URL. Uses the generated types from W45
// (`opencode.generated.ts`) so schema drift between the pinned spec and
// our types fails CI.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, never probed.
//   W13: truncation guard — session.event 'message.part.text.finish' with
//        stop_reason 'length' fails all pending tool calls in the batch.
//   W13: semantic cancellation — DELETE /session/:id/message emits
//        `harness.cancelled`, not throws.
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
import type { OpenCodeProviderOptions } from '../../types.js';
import type {
  OpenCodeSession,
  OpenCodeModel,
} from '../../protocol/opencode.generated.js';

// ── Type aliases ─────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

interface ConversationState {
  /** The opencode session id (UUID from POST /session). */
  openCodeSessionId: string;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
  abortController: AbortController | null;
}

// ── OpenCodeProvider ─────────────────────────────────────────────

/**
 * W38 — IAgentHarness backed by `opencode serve` HTTP+SSE.
 *
 * Lifecycle:
 *   1. `initialize()` verifies the server is reachable (GET /session).
 *   2. `createConversation()` calls POST /session → gets a session id.
 *   3. `sendPromptAndWait()` POSTs to /session/:id/message and reads the
 *      resulting SSE stream for `session.event` lines.
 *   4. `abortConversation()` sends DELETE /session/:id/message.
 *   5. `shutdown()` is a no-op (we don't own the server process).
 */
export class OpenCodeProvider implements IAgentHarness {
  private readonly baseUrl: string;
  private readonly opts: OpenCodeProviderOptions;
  private clientState: HarnessClientState = 'starting';
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private conversations = new Map<string, ConversationState>();

  constructor(opts: OpenCodeProviderOptions) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:4096').replace(/\/$/, '');
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Probe the server by listing sessions
    try {
      const resp = await this.fetch('/session');
      if (!resp.ok) throw new Error(`opencode serve responded ${resp.status}`);
      this.clientState = 'running';
    } catch (err) {
      this.clientState = 'error';
      throw new Error(
        `OpenCodeProvider: cannot reach opencode serve at ${this.baseUrl}. ` +
        `Start it with \`opencode serve\` and ensure the base URL is correct. ` +
        `Original error: ${String(err)}`,
      );
    }
  }

  async stop(): Promise<void> { this.clientState = 'stopped'; }
  async forceStop(): Promise<void> { this.clientState = 'stopped'; }
  async shutdown(): Promise<void> { this.clientState = 'stopped'; }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    try {
      const resp = await this.fetch('/session');
      return resp.ok;
    } catch { return false; }
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9) ────────────────────────────────────────────

  capabilities(): ProviderCapabilities {
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: true,  // OpenCode has native MCP support
      skillDirectories: false,
      fullToolGating: false,
      sessionPersistence: true, // opencode persists sessions server-side
      budgetTracking: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    try {
      const resp = await this.fetch('/model');
      if (!resp.ok) return [];
      const models = await resp.json() as OpenCodeModel[];
      return models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: 'opencode' as const,
        supportsReasoning: false,
      }));
    } catch { return []; }
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const resp = await this.fetch('/session', {
      method: 'POST',
      body: JSON.stringify({
        // opencode uses the system prompt from the first message; nothing to set here
      }),
    });
    if (!resp.ok) throw new Error(`OpenCodeProvider: POST /session failed with ${resp.status}`);
    const session = await resp.json() as OpenCodeSession;
    this.conversations.set(params.conversationId, {
      openCodeSessionId: session.id,
      params,
      listeners: new Set(),
      warnings: [],
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
    if (conv) {
      try {
        await this.fetch(`/session/${conv.openCodeSessionId}`, { method: 'DELETE' });
      } catch { /* best effort */ }
      this.conversations.delete(conversationId);
    }
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // OpenCode does not expose agent selection; no-op.
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
    if (!conv) throw new Error(`OpenCodeProvider: no conversation "${conversationId}"`);
    if (conv.inFlight) throw new Error(`OpenCodeProvider: conversation "${conversationId}" already has a turn in flight`);

    conv.inFlight = true;
    const ac = new AbortController();
    conv.abortController = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });

    let assistantText = '';
    const pendingToolCallIds: string[] = [];

    try {
      // POST the message and get the SSE stream back
      const resp = await this.fetch(`/session/${conv.openCodeSessionId}/message`, {
        method: 'POST',
        body: JSON.stringify({ content: [{ type: 'text', text: prompt }] }),
        signal: ac.signal,
      });
      if (!resp.ok) throw new Error(`OpenCodeProvider: POST /message failed with ${resp.status}`);
      if (!resp.body) throw new Error('OpenCodeProvider: no SSE body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let turnDone = false;
      while (!turnDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          // [DONE] sentinel must break the OUTER while, not just the inner for
          if (data === '[DONE]') { turnDone = true; break; }
          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            const handled = this.handleSseEvent(conv, event, assistantText, pendingToolCallIds);
            assistantText = handled.assistantText;
            if (handled.done) {
              return { content: assistantText };
            }
          } catch { /* skip malformed lines */ }
        }
      }

      this.broadcast(conv, { kind: 'harness.idle', data: {} });
      return { content: assistantText };
    } catch (err) {
      if (ac.signal.aborted) {
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
        return { content: assistantText };
      }
      throw err;
    } finally {
      conv.inFlight = false;
      conv.abortController = null;
    }
  }

  private handleSseEvent(
    conv: ConversationState,
    event: Record<string, unknown>,
    assistantText: string,
    pendingToolCallIds: string[],
  ): { assistantText: string; done: boolean } {
    const type = event['type'] as string | undefined;

    switch (type) {
      case 'message.part.text.delta': {
        const text = (event['text'] as string | undefined) ?? '';
        this.broadcast(conv, { kind: 'harness.token', data: { text } });
        return { assistantText: assistantText + text, done: false };
      }
      case 'message.part.tool_use.start': {
        const callId = (event['id'] as string | undefined) ?? '';
        const toolName = (event['name'] as string | undefined) ?? '';
        pendingToolCallIds.push(callId);
        this.broadcast(conv, {
          kind: 'harness.tool_start',
          data: { tool: toolName, args: {}, callId },
        });
        return { assistantText, done: false };
      }
      case 'message.part.tool_result': {
        const callId = (event['tool_use_id'] as string | undefined) ?? '';
        const content = (event['content'] as string | undefined) ?? '';
        const isError = (event['is_error'] as boolean | undefined) ?? false;
        this.broadcast(conv, {
          kind: 'harness.tool_complete',
          data: { tool: callId, result: content, callId, success: !isError },
        });
        return { assistantText, done: false };
      }
      case 'message.finish': {
        const stopReason = (event['stop_reason'] as string | undefined) ?? 'end_turn';
        // W13/B1: truncation guard
        if (stopReason === 'length') {
          for (const callId of pendingToolCallIds) {
            this.broadcast(conv, {
              kind: 'harness.tool_complete',
              data: {
                tool: callId,
                result: 'Response was truncated (stop_reason: length). All tool calls in this batch are cancelled. Please re-issue your request.',
                callId,
                success: false,
              },
            });
          }
          this.broadcast(conv, { kind: 'harness.idle', data: {} });
        } else if (stopReason === 'cancelled') {
          // W13: server-initiated cancel — emit harness.cancelled, not harness.idle
          this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
        } else {
          this.broadcast(conv, { kind: 'harness.idle', data: {} });
        }
        return { assistantText, done: true };
      }
      default:
        return { assistantText, done: false };
    }
  }

  async getMessages(_conversationId: string): Promise<ConversationMessage[]> {
    return [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.inFlight) return;
    conv.abortController?.abort();
    try {
      await this.fetch(`/session/${conv.openCodeSessionId}/message`, { method: 'DELETE' });
    } catch { /* best effort */ }
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

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    };
    if (this.opts.authToken) headers['Authorization'] = this.opts.authToken;
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...((init?.headers ?? {}) as Record<string, string>) },
    });
  }
}
