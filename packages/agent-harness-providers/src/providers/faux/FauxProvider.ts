// ────────────────────────────────────────────────────────────────
// W44 — FauxProvider
//
// A deterministic IAgentHarness implementation for testing.
// Shipped in the package (not test files) so any consumer's test suite
// can import it without reaching into __tests__ directories.
//
// Callers configure a script of responses before calling sendPrompt.
// The provider replays the script, pausing at tool_call entries until
// provideToolResult() is called.
//
// Usage:
//   const faux = new FauxProvider();
//   faux.script([
//     { type: 'text', content: 'I will read the file.' },
//     { type: 'tool_call', name: 'Read', input: { file_path: '/foo' } },
//     // test calls: await faux.provideToolResult(callId, 'hello')
//     { type: 'text', content: 'The file contains: hello' },
//     { type: 'complete' },
//   ]);
//   await harness.sendPromptAndWait(convId, 'read /foo');
// ────────────────────────────────────────────────────────────────

import type {
  IAgentHarness,
  IHarnessClientLifecycle,
  IHarnessModelDiscovery,
  IHarnessConversationLifecycle,
  IHarnessMessaging,
  IHarnessEvents,
  HarnessClientEvent,
  HarnessClientState,
  HarnessModel,
  CreateConversationParams,
  ConversationResult,
  ConversationWarning,
  HarnessAgentInfo,
  ConversationMessage,
  ConversationResponse,
  AttachmentRef,
  SendPromptOptions,
  ProviderCapabilities,
} from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';

// ── Script entry types ──────────────────────────────────────────

/** Emit text token-by-token (word-split for realism). */
export interface FauxTextEntry {
  type: 'text';
  content: string;
}

/** Emit a tool_start event and wait for provideToolResult(). */
export interface FauxToolCallEntry {
  type: 'tool_call';
  name: string;
  input: Record<string, unknown>;
  /** Caller may override the callId; defaults to auto-assigned. */
  callId?: string;
}

/** Emit a tool_error event (for B1 truncation testing). */
export interface FauxToolErrorEntry {
  type: 'tool_error';
  name: string;
  error: string;
  callId?: string;
}

/** End the turn with success. */
export interface FauxCompleteEntry {
  type: 'complete';
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
}

/** End the turn with semantic cancellation (not a throw). */
export interface FauxCancelledEntry {
  type: 'cancelled';
  reason?: 'user_abort' | 'timeout' | 'budget_exceeded';
}

/**
 * End the turn with stop_reason='length' — all pending tool calls receive
 * a synthetic error, exercising the W13/B1 truncation guard.
 */
export interface FauxTruncatedEntry {
  type: 'truncated';
}

/** End the turn with a harness error. */
export interface FauxErrorEntry {
  type: 'error';
  message: string;
}

/** Max-turns exhaustion delivered as an in-band error (not a throw). */
export interface FauxExhaustedEntry {
  type: 'exhausted';
  maxTurns: number;
}

export type FauxScriptEntry =
  | FauxTextEntry
  | FauxToolCallEntry
  | FauxToolErrorEntry
  | FauxCompleteEntry
  | FauxCancelledEntry
  | FauxTruncatedEntry
  | FauxErrorEntry
  | FauxExhaustedEntry;

// ── Internal session state ────────────────────────────────────────

interface FauxConversationState {
  id: string;
  params: CreateConversationParams;
  messages: ConversationMessage[];
  handlers: Array<(event: AgentEvent) => void>;
  warnings: ConversationWarning[];
  /** Script to replay on the next sendPrompt. May be multi-turn. */
  pendingScript: FauxScriptEntry[][];
  /** Map from callId to resolver, populated at tool_call pause points. */
  pendingTools: Map<string, (result: unknown) => void>;
  /** Set while a sendPromptAndWait is in flight. */
  inFlight: boolean;
}

// ── FauxProvider ─────────────────────────────────────────────────

let callIdSeq = 0;
function nextCallId(): string {
  return `faux-call-${++callIdSeq}`;
}

/**
 * W44 — Deterministic test double for IAgentHarness.
 *
 * Create one per test; call script() before sendPrompt; await provideToolResult()
 * when the test needs to supply a tool response.
 */
export class FauxProvider implements IAgentHarness {
  private state: HarnessClientState = 'stopped';
  private readonly clientHandlers: Array<(e: HarnessClientEvent) => void> = [];
  private readonly conversations = new Map<string, FauxConversationState>();
  private readonly capabilitiesOverride: Partial<ProviderCapabilities>;

  /** W44 — configurable capabilities so conformance tests can exercise edge cases. */
  constructor(opts: { capabilities?: Partial<ProviderCapabilities> } = {}) {
    this.capabilitiesOverride = opts.capabilities ?? {};
  }

  // ── IHarnessClientLifecycle ─────────────────────────────────────

  capabilities(): ProviderCapabilities {
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      maxParallelTools: 8,
      planMode: false,
      mcpServers: false,
      skillDirectories: false,
      fullToolGating: true,
      sessionPersistence: false,
      budgetTracking: false,
      computerUse: false, // MINOR-4: explicit fail-closed default (L9)
      ...this.capabilitiesOverride,
    };
  }

  async initialize(): Promise<void> {
    this.state = 'running';
    this.emit({ type: 'client.started' });
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    this.emit({ type: 'client.stopped' });
  }

  async forceStop(): Promise<void> {
    return this.stop();
  }

  getClientState(): HarnessClientState {
    return this.state;
  }

  async ping(): Promise<boolean> {
    return this.state === 'running';
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientHandlers.push(handler);
    return () => {
      const idx = this.clientHandlers.indexOf(handler);
      if (idx !== -1) this.clientHandlers.splice(idx, 1);
    };
  }

  private emit(event: HarnessClientEvent): void {
    for (const h of this.clientHandlers) h(event);
  }

  // ── IHarnessModelDiscovery ──────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    return [
      {
        id: 'faux-model',
        name: 'Faux Model',
        provider: 'faux',
        description: 'Deterministic faux model for testing',
        promptTokenLimit: 200_000,
        totalContextWindow: 200_000,
      },
    ];
  }

  // ── IHarnessConversationLifecycle ───────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const conv: FauxConversationState = {
      id: params.conversationId,
      params,
      messages: [],
      handlers: [],
      warnings: [],
      pendingScript: [],
      pendingTools: new Map(),
      inFlight: false,
    };
    this.conversations.set(params.conversationId, conv);
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
    const keys = [...this.conversations.keys()];
    return keys[keys.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // no-op in faux
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  // ── IHarnessMessaging ───────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    // Fire and forget
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    signal?: AbortSignal,
    _options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`FauxProvider: unknown conversation ${conversationId}`);
    if (conv.inFlight) throw new Error(`FauxProvider: turn already in flight for ${conversationId}`);

    conv.inFlight = true;
    conv.messages.push({ role: 'user', content: prompt, timestamp: new Date() });

    // Dequeue the next script turn
    const script = conv.pendingScript.shift() ?? [];
    let assistantText = '';

    // W44 / W13-B1: Pre-scan for a 'truncated' entry.
    // If present, ALL tool_call entries that precede it in the script are
    // immediately failed (no waiting for provideToolResult). This exercises
    // the truncation guard without hanging on the first tool_call.
    const truncatedIdx = script.findIndex((e) => e.type === 'truncated');
    if (truncatedIdx !== -1) {
      const truncatedScript = script.slice(0, truncatedIdx);
      for (const entry of truncatedScript) {
        if (entry.type === 'text') {
          const words = (entry as FauxTextEntry).content.split(' ');
          for (const word of words) {
            const token = words.indexOf(word) === 0 ? word : ` ${word}`;
            this.broadcast(conversationId, { kind: 'harness.token', data: { text: token } });
            assistantText += token;
          }
        } else if (entry.type === 'tool_call') {
          const tc = entry as FauxToolCallEntry;
          const callId = tc.callId ?? nextCallId();
          this.broadcast(conversationId, {
            kind: 'harness.tool_start',
            data: { tool: tc.name, args: tc.input, callId },
          });
          this.broadcast(conversationId, {
            kind: 'harness.tool_complete',
            data: {
              tool: tc.name,
              result: 'Response was truncated (stop_reason: length). All tool calls in this batch are cancelled. Please re-issue your request.',
              callId,
              success: false,
            },
          });
        }
      }
      this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
      conv.inFlight = false;
      return { content: assistantText };
    }

    try {
      for (const entry of script) {
        // Honour abort signal between entries
        if (signal?.aborted) {
          this.broadcast(conversationId, {
            kind: 'harness.cancelled',
            data: { reason: 'user_abort', provider: 'faux' },
          });
          conv.inFlight = false;
          return { content: assistantText };
        }

        switch (entry.type) {
          case 'text': {
            // Emit word-by-word for realism
            const words = entry.content.split(' ');
            for (const word of words) {
              const token = words.indexOf(word) === 0 ? word : ` ${word}`;
              this.broadcast(conversationId, { kind: 'harness.token', data: { text: token } });
              assistantText += token;
            }
            break;
          }

          case 'tool_call': {
            const callId = entry.callId ?? nextCallId();
            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: entry.name, args: entry.input, callId },
            });
            // Pause until provideToolResult() is called
            const result = await new Promise<unknown>((resolve) => {
              conv.pendingTools.set(callId, resolve);
            });
            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: entry.name, result, callId, success: true },
            });
            break;
          }

          case 'tool_error': {
            const callId = entry.callId ?? nextCallId();
            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: entry.name, args: {}, callId },
            });
            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: entry.name, result: entry.error, callId, success: false },
            });
            break;
          }

          case 'truncated': {
            // Should not be reached (handled by pre-scan above), but kept as safety.
            this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'cancelled': {
            this.broadcast(conversationId, {
              kind: 'harness.cancelled',
              data: { reason: entry.reason ?? 'user_abort', provider: 'faux' },
            });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'error': {
            this.broadcast(conversationId, {
              kind: 'harness.error',
              data: { message: entry.message, provider: 'faux' },
            });
            conv.inFlight = false;
            throw new Error(entry.message);
          }

          case 'exhausted': {
            this.broadcast(conversationId, {
              kind: 'harness.error',
              data: {
                message: `Max turns reached (${entry.maxTurns}). The agent stopped automatically.`,
                provider: 'faux',
              },
            });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'complete': {
            if (entry.usage) {
              this.broadcast(conversationId, {
                kind: 'harness.usage',
                data: {
                  model: 'faux-model',
                  inputTokens: entry.usage.inputTokens ?? 0,
                  outputTokens: entry.usage.outputTokens ?? 0,
                  cost: entry.usage.cost,
                  provider: 'faux',
                },
              });
            }
            if (assistantText) {
              this.broadcast(conversationId, {
                kind: 'harness.message_complete',
                data: { content: assistantText },
              });
              conv.messages.push({ role: 'assistant', content: assistantText, timestamp: new Date() });
            }
            this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
            conv.inFlight = false;
            return { content: assistantText };
          }
        }
      }

      // Script ended without an explicit terminal entry — auto-complete
      if (assistantText) {
        this.broadcast(conversationId, {
          kind: 'harness.message_complete',
          data: { content: assistantText },
        });
        conv.messages.push({ role: 'assistant', content: assistantText, timestamp: new Date() });
      }
      this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
    } finally {
      conv.inFlight = false;
    }

    return { content: assistantText };
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.conversations.get(conversationId)?.messages ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    // Resolve all pending tools immediately so the turn can unblock
    for (const [callId, resolve] of conv.pendingTools) {
      resolve('__aborted__');
      conv.pendingTools.delete(callId);
    }
    this.broadcast(conversationId, {
      kind: 'harness.cancelled',
      data: { reason: 'user_abort', provider: 'faux' },
    });
  }

  // ── IHarnessEvents ──────────────────────────────────────────────

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    const conv = this.conversations.get(conversationId);
    if (!conv) {
      // Lazy registration — conversation may not exist yet
      return () => {};
    }
    conv.handlers.push(handler);
    return () => {
      const idx = conv.handlers.indexOf(handler);
      if (idx !== -1) conv.handlers.splice(idx, 1);
    };
  }

  private broadcast(conversationId: string, event: AgentEvent): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    for (const h of conv.handlers) {
      try { h(event); } catch { /* handler errors must not kill the provider */ }
    }
  }

  // ── Test-control API ────────────────────────────────────────────

  /**
   * W44 — Configure the response script for one turn.
   * Each call to script() appends a turn script. Scripts are dequeued in order:
   * the first sendPrompt call replays the first script, the second call replays
   * the second script, etc.
   *
   * @example
   * faux.script([
   *   { type: 'text', content: 'Let me check the file.' },
   *   { type: 'tool_call', name: 'Read', input: { file_path: '/x' } },
   *   { type: 'text', content: 'Done.' },
   *   { type: 'complete' },
   * ]);
   */
  script(entries: FauxScriptEntry[], conversationId?: string): void {
    if (conversationId) {
      const conv = this.conversations.get(conversationId);
      if (conv) { conv.pendingScript.push(entries); return; }
    }
    // Apply to the next created/existing conversation
    this._pendingScripts.push(entries);
  }

  private _pendingScripts: FauxScriptEntry[][] = [];

  /** Called after createConversation to transfer pending scripts. */
  private _transferScripts(conv: FauxConversationState): void {
    while (this._pendingScripts.length > 0) {
      conv.pendingScript.push(this._pendingScripts.shift()!);
    }
  }

  /**
   * W44 — Supply the result for a paused tool_call entry.
   * The pending tool call resolves and the script resumes.
   *
   * @param callId   The callId from the FauxToolCallEntry, or the auto-assigned id.
   *                 If you didn't set callId in the script entry, call nextPendingCallId()
   *                 to discover it, or provide the tool result to ALL pending tools.
   * @param result   The value the tool handler returns.
   */
  async provideToolResult(callId: string, result: unknown): Promise<void> {
    for (const conv of this.conversations.values()) {
      const resolve = conv.pendingTools.get(callId);
      if (resolve) {
        conv.pendingTools.delete(callId);
        resolve(result);
        return;
      }
    }
    throw new Error(`FauxProvider: no pending tool call with id=${callId}`);
  }

  /**
   * W44 — Provide a result for the FIRST pending tool call across all conversations.
   * Useful when the test does not care about the callId.
   */
  async provideNextToolResult(result: unknown): Promise<void> {
    for (const conv of this.conversations.values()) {
      const [callId, resolve] = conv.pendingTools.entries().next().value ?? [];
      if (callId && resolve) {
        conv.pendingTools.delete(callId);
        resolve(result);
        return;
      }
    }
    throw new Error('FauxProvider: no pending tool call');
  }

  /**
   * W44 — Returns true if there is a tool call waiting for a result.
   */
  hasPendingToolCall(): boolean {
    for (const conv of this.conversations.values()) {
      if (conv.pendingTools.size > 0) return true;
    }
    return false;
  }

  /**
   * W44 — Returns ids of all pending tool calls across all conversations.
   */
  pendingCallIds(): string[] {
    const ids: string[] = [];
    for (const conv of this.conversations.values()) {
      ids.push(...conv.pendingTools.keys());
    }
    return ids;
  }
}
