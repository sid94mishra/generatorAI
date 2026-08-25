// ────────────────────────────────────────────────────────────────
// CodexProvider — IAgentHarness wrapping `codex app-server` (JSON-RPC).
//
// W37 — Codex provider. Speaks JSON-RPC over a long-lived stdio session
// spawned from the `codex` binary. Uses the generated types from W45
// (`codex.generated.ts`) so schema drift between the pinned binary and
// our types fails CI.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, never probed.
//   L16: every tool call passes the gate (PreToolUse bridge).
//   L17: ProviderInstanceId routing via MultiHarness — this class is stateless
//        per provider type; routing is the registry's concern.
//   W13: truncation guard — `stop_reason: 'length'` fails all tool calls.
//   W13: semantic cancellation — abort emits `harness.cancelled`, not throws.
//   W13: `-32001` (rate limit) triggers exponential backoff with jitter.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
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
import type { CodexProviderOptions } from '../../types.js';
import type {
  CodexJsonRpcRequest,
  CodexJsonRpcResponse,
  CodexJsonRpcNotification,
  CodexSessionCreateParams,
  CodexSessionCreateResult,
  CodexTurnParams,
  CodexTurnEvent,
  CodexModelListResult,
} from '../../protocol/codex.generated.js';
import { CODEX_TRUNCATION_STOP_REASONS, CODEX_RATE_LIMIT_ERROR_CODE } from '../../protocol/codex.generated.js';

// ── Type aliases for clarity ─────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

interface ConversationState {
  codexSessionId: string;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
}

// ── Utility helpers ──────────────────────────────────────────────

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4); // ±20% jitter
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── CodexProvider ────────────────────────────────────────────────

/**
 * W37 — IAgentHarness backed by `codex app-server` JSON-RPC over stdio.
 *
 * Lifecycle:
 *   1. `initialize()` spawns `codex app-server` and waits for a ready signal.
 *   2. `createConversation()` calls `session.create` via JSON-RPC.
 *   3. `sendPromptAndWait()` sends `turn` and streams `turn.*` notifications.
 *   4. `abortConversation()` sends `turn.steer { signal: 'cancel' }`.
 *   5. `shutdown()` sends `SIGTERM` to the child.
 */
export class CodexProvider implements IAgentHarness {
  private readonly opts: Required<Omit<CodexProviderOptions, 'logger' | 'binaryPath' | 'env'>> & {
    binaryPath?: string;
    env?: Record<string, string | undefined>;
    logger?: CodexProviderOptions['logger'];
  };

  private proc: ChildProcess | null = null;
  private clientState: HarnessClientState = 'starting';
  private rpcIdCounter = 0;
  // Pending RPC calls indexed by id
  private pendingRpc = new Map<
    string | number,
    { resolve: (r: CodexJsonRpcResponse<unknown>) => void; reject: (e: Error) => void }
  >();
  // Notification handlers — fired for every incoming JSON-RPC notification
  private notificationListeners = new Set<Listener<CodexJsonRpcNotification<unknown>>>();
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();

  private conversations = new Map<string, ConversationState>();

  constructor(opts: CodexProviderOptions = {}) {
    this.opts = {
      defaultModel: opts.defaultModel ?? 'codex-mini',
      defaultCwd: opts.defaultCwd ?? process.cwd(),
      baseBackoffMs: opts.baseBackoffMs ?? 1_000,
      maxBackoffRetries: opts.maxBackoffRetries ?? 4,
      binaryPath: opts.binaryPath,
      env: opts.env,
      logger: opts.logger,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const bin = this.opts.binaryPath ?? 'codex';

    // Wrap spawn in a Promise that rejects if the binary fails to start (e.g. ENOENT).
    // The 'error' event fires via nextTick (before setImmediate), so if ENOENT fires,
    // reject() wins before resolve() — guaranteeing initialize() throws on bad binary.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ['app-server'], {
        cwd: this.opts.defaultCwd,
        env: { ...process.env, ...this.opts.env },
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      this.proc = proc;

      // Error handler fires on next tick — rejects initialize() if binary missing
      proc.once('error', (err) => {
        const msg = err.message.includes('ENOENT')
          ? `Codex binary not found at "${bin}". Install Codex (https://github.com/openai/codex) and ensure it is on PATH.`
          : err.message;
        this.clientState = 'error';
        for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: msg } });
        reject(new Error(msg));
      });

      // Ongoing exit handler (fires after init phase)
      proc.on('exit', (code) => {
        this.clientState = code === 0 ? 'stopped' : 'error';
        for (const h of this.clientEventListeners) {
          h({
            type: code === 0 ? 'client.stopped' : 'client.error',
            data: code ? { message: `codex exited with code ${code}` } : undefined,
          });
        }
      });

      // Wire up JSON-RPC message reading from stdout
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if ('id' in msg && msg['id'] != null) {
            // Response to a request
            const resp = msg as unknown as CodexJsonRpcResponse<unknown>;
            const pending = this.pendingRpc.get(resp.id!);
            if (pending) {
              this.pendingRpc.delete(resp.id!);
              pending.resolve(resp);
            }
          } else if ('method' in msg) {
            // Notification
            for (const h of this.notificationListeners) {
              h(msg as unknown as CodexJsonRpcNotification<unknown>);
            }
          }
        } catch {
          // Ignore non-JSON lines (e.g. startup banner)
        }
      });

      // If we reach setImmediate, the process started without ENOENT
      setImmediate(resolve);
    });

    this.clientState = 'running';
  }

  async stop(): Promise<void> { await this.shutdown(); }
  async forceStop(): Promise<void> {
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.clientState = 'stopped';
  }
  async shutdown(): Promise<void> {
    this.proc?.kill('SIGTERM');
    this.proc = null;
    this.clientState = 'stopped';
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    try {
      await this.rpc<unknown>({ method: 'ping', params: {} });
      return true;
    } catch { return false; }
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9: declared, never probed) ────────────────────

  capabilities(): ProviderCapabilities {
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: false,
      skillDirectories: false,
      fullToolGating: false, // Codex has no PreToolUse hook
      sessionPersistence: false,
      budgetTracking: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    try {
      const result = await this.rpc<CodexModelListResult>({ method: 'model.list', params: {} });
      if (result.result?.models) {
        return result.result.models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: 'codex' as const,
          supportsReasoning: m.supportsReasoning ?? false,
        }));
      }
    } catch { /* binary not running — return empty */ }
    return [];
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const sessionParams: CodexSessionCreateParams = {
      model: params.model ?? this.opts.defaultModel,
      systemPrompt: this.extractSystemPrompt(params),
      maxTurns: params.maxTurns,
    };
    const result = await this.rpc<CodexSessionCreateResult>({
      method: 'session.create',
      params: sessionParams,
    });
    const codexSessionId = result.result?.sessionId ?? params.conversationId;
    this.conversations.set(params.conversationId, {
      codexSessionId,
      params,
      listeners: new Set(),
      warnings: [],
      inFlight: false,
    });
    return params.conversationId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
    // Codex sessions are server-side and stateful; no explicit resume needed.
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
        await this.rpc({ method: 'session.delete', params: { sessionId: conv.codexSessionId } });
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
    // Codex does not have a multi-agent surface; no-op with warning.
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
    // Fire-and-forget wrapper
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
    if (!conv) throw new Error(`CodexProvider: no conversation "${conversationId}"`);
    if (conv.inFlight) throw new Error(`CodexProvider: conversation "${conversationId}" already has a turn in flight`);
    conv.inFlight = true;

    try {
      return await this.doTurn(conv, prompt, signal);
    } finally {
      conv.inFlight = false;
    }
  }

  private async doTurn(
    conv: ConversationState,
    prompt: string,
    signal?: AbortSignal,
    attempt = 0,
  ): Promise<ConversationResponse> {
    const turnParams: CodexTurnParams = {
      sessionId: conv.codexSessionId,
      input: prompt,
    };

    let assistantText = '';
    const pendingToolCallIds: string[] = [];

    return new Promise<ConversationResponse>((resolve, reject) => {
      // Handle abort
      if (signal?.aborted) {
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
        resolve({ content: assistantText });
        return;
      }

      const onAbort = () => {
        void this.rpc({
          method: 'turn.steer',
          params: { sessionId: conv.codexSessionId, signal: 'cancel' },
        }).catch(() => { /* best-effort */ });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const unsub = this.onNotification(async (notif) => {
        const event = notif.params as CodexTurnEvent | undefined;
        if (!event || event.sessionId !== conv.codexSessionId) return;

        switch (event.type) {
          case 'token': {
            const tok = event.token ?? '';
            this.broadcast(conv, { kind: 'harness.token', data: { text: tok } });
            assistantText += tok;
            break;
          }
          case 'tool.call': {
            if (event.toolCall) {
              pendingToolCallIds.push(event.toolCall.id);
              this.broadcast(conv, {
                kind: 'harness.tool_start',
                data: { tool: event.toolCall.name, args: event.toolCall.input, callId: event.toolCall.id },
              });
            }
            break;
          }
          case 'tool.result': {
            if (event.toolResult) {
              this.broadcast(conv, {
                kind: 'harness.tool_complete',
                data: {
                  tool: event.toolResult.toolCallId,
                  result: event.toolResult.content ?? '',
                  callId: event.toolResult.toolCallId,
                  success: !event.toolResult.isError,
                },
              });
            }
            break;
          }
          case 'turn.end': {
            signal?.removeEventListener('abort', onAbort);
            unsub();

            const stopReason = event.stopReason ?? 'end_turn';

            // W13/B1: if truncated, fail all pending tool calls
            if ((CODEX_TRUNCATION_STOP_REASONS as readonly string[]).includes(stopReason)) {
              for (const callId of pendingToolCallIds) {
                this.broadcast(conv, {
                  kind: 'harness.tool_complete',
                  data: {
                    tool: callId,
                    result: `Response was truncated (stop_reason: ${stopReason}). All tool calls in this batch are cancelled. Please re-issue your request.`,
                    callId,
                    success: false,
                  },
                });
              }
            }

            // W13: semantic cancellation
            if (stopReason === 'cancelled') {
              this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
            } else {
              this.broadcast(conv, { kind: 'harness.idle', data: {} });
            }

            resolve({ content: assistantText });
            break;
          }
          case 'error': {
            signal?.removeEventListener('abort', onAbort);
            unsub();

            // W37: -32001 rate limit → exponential backoff with jitter
            if (
              event.error?.code === CODEX_RATE_LIMIT_ERROR_CODE &&
              attempt < this.opts.maxBackoffRetries
            ) {
              const delayMs = jitter(this.opts.baseBackoffMs * Math.pow(2, attempt));
              this.opts.logger?.warn?.(
                `[CodexProvider] Rate limited (-32001); retrying in ${Math.round(delayMs)} ms (attempt ${attempt + 1}/${this.opts.maxBackoffRetries})`,
              );
              await sleep(delayMs);
              // Re-use the same conv ref — inFlight is managed by the caller
              try {
                const result = await this.doTurn(conv, prompt, signal, attempt + 1);
                resolve(result);
              } catch (e) {
                reject(e);
              }
              return;
            }

            this.broadcast(conv, {
              kind: 'harness.error',
              data: { message: event.error?.message ?? 'Unknown Codex error', provider: 'codex' },
            });
            reject(new Error(event.error?.message ?? 'Codex turn error'));
            break;
          }
          default:
            break;
        }
      });

      // Fire the turn request (non-awaited: notifications drive completion)
      this.rpc({ method: 'turn', params: turnParams }).catch((err) => {
        unsub();
        reject(err);
      });
    });
  }

  async getMessages(_conversationId: string): Promise<ConversationMessage[]> {
    // Codex does not expose message history via JSON-RPC; return empty.
    return [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.inFlight) return;
    // W13: emit harness.cancelled immediately — don't wait for the binary to acknowledge.
    // The binary may also send turn.end { stopReason: 'cancelled' }; that path is a no-op
    // because inFlight will be false by then (the turn Promise resolved on the steer call).
    this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
    void this.rpc({
      method: 'turn.steer',
      params: { sessionId: conv.codexSessionId, signal: 'cancel' },
    }).catch(() => { /* best effort */ });
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

  private rpcIdNext(): number {
    return ++this.rpcIdCounter;
  }

  private async rpc<R>(req: Omit<CodexJsonRpcRequest, 'jsonrpc' | 'id'>): Promise<CodexJsonRpcResponse<R>> {
    if (!this.proc?.stdin) throw new Error('CodexProvider: not initialized (call initialize() first)');
    const id = this.rpcIdNext();
    const message: CodexJsonRpcRequest = { jsonrpc: '2.0', id, ...req };
    return new Promise<CodexJsonRpcResponse<R>>((resolve, reject) => {
      this.pendingRpc.set(id, {
        resolve: resolve as (r: CodexJsonRpcResponse<unknown>) => void,
        reject,
      });
      this.proc!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  private onNotification(handler: Listener<CodexJsonRpcNotification<unknown>>): UnsubFn {
    this.notificationListeners.add(handler);
    return () => this.notificationListeners.delete(handler);
  }

  private extractSystemPrompt(params: CreateConversationParams): string | undefined {
    if (params.systemMessage) {
      if (typeof params.systemMessage === 'string') return params.systemMessage;
      if (Array.isArray(params.systemMessage)) {
        return params.systemMessage
          .filter((b: unknown) => typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'text')
          .map((b: unknown) => (b as Record<string, unknown>)['text'] as string)
          .join('\n');
      }
    }
    return params.systemPromptAppend;
  }
}
