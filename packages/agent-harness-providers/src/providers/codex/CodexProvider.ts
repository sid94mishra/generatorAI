// ────────────────────────────────────────────────────────────────
// CodexProvider — IAgentHarness wrapping `codex app-server` (JSON-RPC).
//
// W37 — Codex provider. Speaks newline-delimited JSON-RPC 2.0 over the stdio
// of a long-lived `codex app-server` child process.
//
// ── Protocol provenance ──────────────────────────────────────────
// Every method name, notification name and payload type used here comes from
// `protocol/codex.generated.ts`, which is emitted by `pnpm generate:schemas`
// from `schemas/codex/codex_app_server_protocol.schemas.json` — the artifact
// `codex app-server generate-json-schema` produces from the pinned
// `@openai/codex` binary. `CODEX_METHODS` in that file is derived from the
// artifact's own request/notification unions, so a method renamed upstream
// changes the generated table and fails CI's `git diff` rather than surfacing
// as a runtime "unknown method".
//
// This replaces a hand-invented vocabulary (`session.create`, `turn`,
// `turn.steer { signal: 'cancel' }`, a `-32001` rate-limit code) that the real
// app-server has never spoken. The differences were not cosmetic:
//
//   • Threads, not sessions. `thread/start` → `thread.id`; `thread/resume`
//     rejoins one. There is no `session.create`.
//   • `turn/steer` INJECTS INPUT into a running turn. Sending it to cancel —
//     as the previous code did — would have appended a message rather than
//     stopping anything. Cancellation is `turn/interrupt`.
//   • Notifications carry `turnId` as well as `threadId`, so a late terminal
//     event from an abandoned turn is identified by its id instead of being
//     guessed at with a timed drain. The old `cancelDrainMs` window is gone.
//   • The server sends REQUESTS to the client (approvals, elicitations,
//     dynamic tool calls) and blocks the turn until one is answered. The
//     previous provider never replied to any of them, so any turn that asked
//     for approval hung until the RPC deadline. Every server request is now
//     answered, fail-closed by default.
//   • Rate limiting arrives as `codexErrorInfo: "rateLimitExceeded"` (or
//     `usageLimitExceeded` / `serverOverloaded`) on an error notification,
//     never as JSON-RPC code -32001, so the old backoff was unreachable.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, never probed.
//   L17: ProviderInstanceId routing via MultiHarness — this class is stateless
//        per provider type; routing is the registry's concern.
//   L18: protocol types generated from a pinned upstream artifact.
//   W13: truncation guard — a context-window stop fails pending tool calls.
//   W13: semantic cancellation — abort emits `harness.cancelled`, not throws.
//   W13: rate limiting triggers exponential backoff with jitter.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
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
import { buildHarnessEnv } from '../../childEnv.js';
import type { CodexProviderOptions } from '../../types.js';
import type {
  JSONRPCErrorError,
  V2AskForApproval,
  V2CodexErrorInfo,
  V2ErrorNotification,
  V2ItemCompletedNotification,
  V2ItemStartedNotification,
  V2AgentMessageDeltaNotification,
  V2Model,
  V2ModelListResponse,
  V2SandboxMode,
  V2ThreadItemsListResponse,
  V2ThreadResumeResponse,
  V2ThreadStartParams,
  V2ThreadStartResponse,
  V2ThreadItem,
  V2Turn,
  V2TurnCompletedNotification,
  V2TurnError,
  V2TurnStartParams,
  V2TurnStartResponse,
  V2UserInput,
} from '../../protocol/codex.generated.js';

// ── Type aliases for clarity ─────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/** A JSON-RPC message read off the child's stdout, before discrimination. */
interface IncomingMessage {
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCErrorError;
}

interface ConversationState {
  /** The Codex thread id (`thread/start` → `thread.id`). */
  threadId: string;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
  /**
   * Id of the turn currently being awaited, once `turn/start` has answered.
   *
   * This is what makes the old timed "drain" unnecessary: every turn
   * notification carries the turn it belongs to, so a terminal event owed by a
   * turn the user cancelled is recognised by its id and dropped, rather than
   * being raced against a 2-second window and possibly ending the NEXT turn
   * with empty content.
   */
  activeTurnId: string | null;
  /**
   * Settles the turn currently being awaited inside `sendPromptAndWait`.
   *
   * Without this, `abortConversation()` could emit `harness.cancelled` but had
   * no way to make the awaited promise settle — and `inFlight` is only cleared
   * in `sendPromptAndWait`'s `finally`, which needs that promise to settle. One
   * Stop therefore wedged the conversation permanently.
   */
  settleTurn: (() => void) | null;
  /**
   * Set by `abortConversation()` / an aborted signal so a retry loop parked in
   * a rate-limit backoff does not start another attempt after the user stopped.
   */
  cancelRequested: boolean;
  /**
   * Turn ids this conversation is finished with.
   *
   * `activeTurnId` alone is not enough to attribute a notification, because it
   * is only known once `turn/start` has ANSWERED. A turn cancelled locally can
   * have its `turn/completed` arrive after the next turn's request has gone
   * out but before that turn's response has been read — a window in which
   * `activeTurnId` is null and the stale terminal event would end the new turn
   * immediately with empty content. Remembering retired ids closes it.
   *
   * Bounded: only the most recent ids matter, and a conversation can run for
   * thousands of turns.
   */
  retiredTurns: Set<string>;
}

/** How many finished turn ids to remember per conversation. */
const RETIRED_TURN_MEMORY = 32;

// ── Errors ───────────────────────────────────────────────────────

/**
 * A JSON-RPC **error response** (`{ id, error: { code, message } }`).
 *
 * These used to be `resolve`d as if they were successes, which is how a failed
 * thread start silently degraded into "use the caller's own id" and handed back
 * a thread the binary had never heard of.
 */
export class CodexRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(`Codex JSON-RPC error ${code}: ${message}`);
    this.name = 'CodexRpcError';
  }
}

/**
 * A turn that failed with backpressure, carrying the upstream classification.
 *
 * Distinct from `CodexRpcError` because rate limiting is reported on an `error`
 * NOTIFICATION mid-turn (`codexErrorInfo`), not as an error response to the
 * request that started the turn.
 */
export class CodexRateLimitedError extends Error {
  constructor(readonly info: V2CodexErrorInfo, message: string) {
    super(message);
    this.name = 'CodexRateLimitedError';
  }
}

/**
 * Upstream error classifications that mean "try again later" rather than "this
 * turn is broken". Read off `TurnError.codexErrorInfo`.
 */
const RETRYABLE_ERROR_INFO: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'usageLimitExceeded',
  'serverOverloaded',
]);

/**
 * Upstream classifications meaning the model ran out of room. Treated the way
 * a `stop_reason: length` is: every tool call still open in the batch is failed
 * so the model cannot believe work happened that did not (W13/B1).
 */
const TRUNCATION_ERROR_INFO: ReadonlySet<string> = new Set(['contextWindowExceeded']);

/** `V2CodexErrorInfo` is a union of bare strings and single-key objects. */
function errorInfoTag(info: V2CodexErrorInfo | null | undefined): string | null {
  if (typeof info === 'string') return info;
  if (info && typeof info === 'object') {
    const keys = Object.keys(info);
    return keys[0] ?? null;
  }
  return null;
}

function isRetryable(err: unknown): err is CodexRateLimitedError {
  return err instanceof CodexRateLimitedError;
}

// ── Utility helpers ──────────────────────────────────────────────

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4); // ±20% jitter
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thread items that represent a tool the model invoked. */
const TOOL_ITEM_TYPES: ReadonlySet<string> = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
]);

/** A display name for a tool item, and its arguments where the item carries any. */
function describeToolItem(item: V2ThreadItem): { tool: string; args: unknown } {
  const anyItem = item as unknown as Record<string, unknown>;
  switch (item.type) {
    case 'commandExecution':
      return { tool: 'shell', args: { command: anyItem['command'], cwd: anyItem['cwd'] } };
    case 'fileChange':
      return { tool: 'apply_patch', args: { changes: anyItem['changes'] } };
    case 'mcpToolCall':
      return {
        tool: `${String(anyItem['server'] ?? 'mcp')}/${String(anyItem['tool'] ?? '')}`,
        args: anyItem['arguments'],
      };
    case 'dynamicToolCall':
      return { tool: String(anyItem['tool'] ?? 'tool'), args: anyItem['arguments'] };
    default:
      return { tool: item.type, args: anyItem };
  }
}

/**
 * Whether a completed tool item succeeded, and the text to report as its result.
 *
 * Each item type spells success differently — an exit code, a patch status, an
 * `error` object, a `success` boolean — so the mapping is explicit per type
 * rather than a hopeful `!item.error`.
 */
function summariseToolResult(item: V2ThreadItem): { success: boolean; result: string } {
  const anyItem = item as unknown as Record<string, unknown>;
  const asText = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);

  switch (item.type) {
    case 'commandExecution': {
      const exitCode = anyItem['exitCode'];
      const status = anyItem['status'];
      return {
        success: status === 'completed' && (exitCode == null || exitCode === 0),
        result: asText(anyItem['aggregatedOutput']),
      };
    }
    case 'fileChange':
      return { success: anyItem['status'] === 'completed', result: asText(anyItem['changes']) };
    case 'mcpToolCall':
      return {
        success: anyItem['status'] === 'completed' && anyItem['error'] == null,
        result: asText(anyItem['error'] ?? anyItem['result']),
      };
    case 'dynamicToolCall':
      return {
        success: anyItem['success'] === true || anyItem['status'] === 'completed',
        result: asText(anyItem['contentItems']),
      };
    default:
      return { success: true, result: asText(anyItem) };
  }
}

// ── CodexProvider ────────────────────────────────────────────────

/**
 * W37 — IAgentHarness backed by `codex app-server` JSON-RPC over stdio.
 *
 * Lifecycle:
 *   1. `initialize()` spawns `codex app-server`, completes the `initialize`
 *      handshake and sends the `initialized` notification.
 *   2. `createConversation()` calls `thread/start` (or `thread/resume` when the
 *      caller supplies a provider session id) and keeps the thread id.
 *   3. `sendPromptAndWait()` calls `turn/start` and consumes the `item/*` and
 *      `turn/*` notifications it produces.
 *   4. `abortConversation()` calls `turn/interrupt` for the active turn.
 *   5. `shutdown()` sends `SIGTERM`, waits, then escalates to `SIGKILL`.
 */
export class CodexProvider implements IAgentHarness {
  private readonly opts: Required<
    Omit<CodexProviderOptions, 'logger' | 'binaryPath' | 'env' | 'defaultModel' | 'onApproval'>
  > & {
    binaryPath?: string;
    env?: Record<string, string | undefined>;
    defaultModel?: string;
    logger?: CodexProviderOptions['logger'];
    onApproval?: CodexProviderOptions['onApproval'];
  };

  private proc: ChildProcess | null = null;
  /** Kept so `shutdown()` can close it — an orphaned readline holds the stdout fd open. */
  private rl: ReadlineInterface | null = null;
  private clientState: HarnessClientState = 'starting';
  private rpcIdCounter = 0;
  // Pending RPC calls indexed by id
  private pendingRpc = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (e: Error) => void;
      /** Deadline timer — cleared on settle so a dead child can't leak it. */
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // Notification handlers — fired for every incoming JSON-RPC notification
  private notificationListeners = new Set<(method: string, params: unknown) => void>();
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  /** Rolling tail of the child's stderr — see `stderrCaptureBytes`. */
  private stderrTail = '';
  /** True once we have asked the child to exit, so its exit is not an error. */
  private stopping = false;

  private conversations = new Map<string, ConversationState>();

  constructor(opts: CodexProviderOptions = {}) {
    this.opts = {
      args: opts.args ?? ['app-server'],
      // No invented default model. `codex-mini` was not a model the binary
      // offers, and sending an unknown name fails the thread start. Omitting
      // `model` lets the server pick its own configured default, which is the
      // only correct behaviour when the caller has not chosen one.
      defaultModel: opts.defaultModel,
      defaultCwd: opts.defaultCwd ?? process.cwd(),
      approvalPolicy: opts.approvalPolicy ?? 'never',
      sandboxMode: opts.sandboxMode ?? 'workspace-write',
      baseBackoffMs: opts.baseBackoffMs ?? 1_000,
      maxBackoffRetries: opts.maxBackoffRetries ?? 4,
      rpcTimeoutMs: opts.rpcTimeoutMs ?? 30_000,
      shutdownGraceMs: opts.shutdownGraceMs ?? 5_000,
      stderrCaptureBytes: opts.stderrCaptureBytes ?? 8_192,
      clientName: opts.clientName ?? 'generatorai',
      clientVersion: opts.clientVersion ?? '0.1.0',
      binaryPath: opts.binaryPath,
      env: opts.env,
      logger: opts.logger,
      onApproval: opts.onApproval,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const bin = this.opts.binaryPath ?? 'codex';
    this.stopping = false;

    // Wrap spawn in a Promise that rejects if the binary fails to start (e.g. ENOENT).
    // The 'error' event fires via nextTick (before setImmediate), so if ENOENT fires,
    // reject() wins before resolve() — guaranteeing initialize() throws on bad binary.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, this.opts.args, {
        cwd: this.opts.defaultCwd,
        // Codex executes model-authored shell commands, so it must never
        // inherit the vault key, the desktop admin token, source-control
        // tokens or DB credentials. `buildHarnessEnv` gives it the base
        // allowlist (PATH, locale, proxy, etc.) plus only what the caller
        // explicitly injects via `opts.env` (e.g. `OPENAI_API_KEY`).
        env: buildHarnessEnv({ extra: this.opts.env }),
        // W12: stderr is PIPED, not inherited. Inheriting it dumped the child's
        // diagnostics into the server's own console where nothing could attach
        // them to the failure they explain.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => this.captureStderr(chunk));

      // Error handler fires on next tick — rejects initialize() if binary missing
      proc.once('error', (err) => {
        const msg = err.message.includes('ENOENT')
          ? `Codex binary not found at "${bin}". Install Codex (https://github.com/openai/codex) and ensure it is on PATH.`
          : err.message;
        this.clientState = 'error';
        const detailed = this.withStderr(msg);
        for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: detailed } });
        // Nothing can answer an outstanding call once spawn itself failed.
        this.failAllPendingRpc(new Error(detailed));
        reject(new Error(detailed));
      });

      // Ongoing exit handler (fires after init phase)
      proc.on('exit', (code, sig) => {
        // A child we asked to stop is NOT an error, and neither is a clean
        // signal death: `kill('SIGTERM')` yields `code === null`, so keying
        // purely off `code === 0` reported every orderly shutdown — including
        // our own SIGKILL escalation — as a provider failure.
        const clean = this.stopping || code === 0;
        this.clientState = clean ? 'stopped' : 'error';
        const message = this.withStderr(
          sig ? `codex exited on signal ${sig}` : `codex exited with code ${code}`,
        );
        for (const h of this.clientEventListeners) {
          h({
            type: clean ? 'client.stopped' : 'client.error',
            data: clean ? undefined : { message },
          });
        }
        // Drain the pending map. A response can never arrive for a dead child,
        // so leaving these unsettled hangs every caller — `ping()` included —
        // for the lifetime of the process.
        this.failAllPendingRpc(new Error(message));
        // Any turn parked on notifications is equally unreachable now.
        this.settleAllTurns();
      });

      // Wire up JSON-RPC message reading from stdout
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
      this.rl = rl;
      rl.on('line', (line) => this.onStdoutLine(line));

      // If we reach setImmediate, the process started without ENOENT
      setImmediate(resolve);
    });

    // The app-server requires the `initialize` handshake before it will accept
    // any other method, and expects the `initialized` notification afterwards.
    // Neither was sent before; every call was made against a server that had
    // not agreed to talk yet.
    try {
      await this.rpc('initialize', {
        clientInfo: { name: this.opts.clientName, version: this.opts.clientVersion },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.notify('initialized', undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.shutdown().catch(() => { /* best effort */ });
      // AFTER shutdown, which sets 'stopped': a provider whose bring-up failed
      // must report 'error', or a supervisor reads it as an orderly stop and
      // never retries.
      this.clientState = 'error';
      throw new Error(`CodexProvider: initialize handshake failed: ${message}`);
    }

    this.clientState = 'running';
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    this.stopping = true;
    this.teardownIo();
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.clientState = 'stopped';
    this.failAllPendingRpc(new Error('CodexProvider: force-stopped'));
    this.settleAllTurns();
  }

  async shutdown(): Promise<void> {
    const proc = this.proc;
    this.stopping = true;
    this.teardownIo();
    this.proc = null;
    this.clientState = 'stopped';
    this.failAllPendingRpc(new Error('CodexProvider: shut down'));
    this.settleAllTurns();
    if (!proc || proc.exitCode != null || proc.signalCode != null) return;

    // SIGTERM then WAIT. Killing and immediately nulling `this.proc` leaks a
    // child that ignores SIGTERM (or is mid-tool-call): the handle is gone
    // before anyone can escalate.
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.opts.logger?.warn?.(
          `[CodexProvider] codex did not exit ${this.opts.shutdownGraceMs} ms after SIGTERM — escalating to SIGKILL`,
        );
        proc.kill('SIGKILL');
        resolve();
      }, this.opts.shutdownGraceMs);
      timer.unref?.();
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    // There is no `ping` method in the protocol. `model/list` is the cheapest
    // real request that proves the child is alive AND answering — the previous
    // `ping` call was an invented method the server would reject, so this
    // returned false for a perfectly healthy binary.
    try {
      await this.rpc('model/list', { limit: 1 });
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
      // Codex accepts `image` / `localImage` user input parts.
      vision: true,
      // Models advertise `supportedReasoningEfforts`; turns take an `effort`.
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high'],
      planMode: false,
      // `mcpServerStatus/list`, `mcpServer/tool/call` and MCP elicitation
      // requests are all in the protocol.
      mcpServers: true,
      // `skills/list` and `skills/extraRoots/set` exist upstream.
      skillDirectories: true,
      // Approvals are per-command/patch and only fire under an approval policy
      // that asks for them — not a PreToolUse gate on every call.
      fullToolGating: false,
      // Threads are persisted server-side and rejoinable via `thread/resume`.
      sessionPersistence: true,
      budgetTracking: false,
      computerUse: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    const models: HarnessModel[] = [];
    try {
      // `model/list` is paginated. The previous version read a single
      // unpaginated `models` array that the protocol does not have, so it
      // always returned nothing.
      let cursor: string | undefined;
      do {
        const page = await this.rpc<V2ModelListResponse>('model/list', {
          ...(cursor ? { cursor } : {}),
        });
        for (const m of page.data ?? []) models.push(this.toHarnessModel(m));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    } catch {
      // Binary not running or not authenticated — an empty list is the
      // contract here (W41: getModels never throws).
      return models;
    }
    return models;
  }

  private toHarnessModel(m: V2Model): HarnessModel {
    return {
      id: m.id,
      name: m.displayName || m.model || m.id,
      provider: 'codex',
      description: m.description || undefined,
      supportsReasoning: (m.supportedReasoningEfforts?.length ?? 0) > 0,
    };
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const warnings: ConversationWarning[] = [];

    // W12 — rejoin the caller's existing thread when one was handed over,
    // rather than starting the model over with no memory of the chat.
    let threadId: string;
    if (params.resumeProviderSessionId) {
      const resumed = await this.rpc<V2ThreadResumeResponse>('thread/resume', {
        threadId: params.resumeProviderSessionId,
        ...(params.model ? { model: params.model } : {}),
        cwd: this.opts.defaultCwd,
        excludeTurns: true,
      });
      threadId = resumed.thread.id;
    } else {
      const startParams: V2ThreadStartParams = {
        ...(params.model ?? this.opts.defaultModel
          ? { model: params.model ?? this.opts.defaultModel }
          : {}),
        cwd: this.opts.defaultCwd,
        approvalPolicy: this.opts.approvalPolicy,
        sandbox: this.opts.sandboxMode,
        ...(this.buildInstructions(params, warnings)),
      };
      const started = await this.rpc<V2ThreadStartResponse>('thread/start', startParams);
      threadId = started.thread.id;
    }

    this.conversations.set(params.conversationId, {
      threadId,
      params,
      listeners: new Set(),
      warnings,
      inFlight: false,
      activeTurnId: null,
      settleTurn: null,
      cancelRequested: false,
      retiredTurns: new Set(),
    });
    return params.conversationId;
  }

  /**
   * Maps our system-message config onto the two instruction slots the protocol
   * has, and records a warning when the caller asked for something Codex cannot
   * express — a silently dropped system prompt is how a conversation ends up
   * behaving nothing like the caller configured it.
   */
  private buildInstructions(
    params: CreateConversationParams,
    warnings: ConversationWarning[],
  ): Pick<V2ThreadStartParams, 'baseInstructions' | 'developerInstructions'> {
    const out: Pick<V2ThreadStartParams, 'baseInstructions' | 'developerInstructions'> = {};
    const sys = params.systemMessage;
    if (sys?.content) {
      if (sys.mode === 'replace') out.baseInstructions = sys.content;
      else out.developerInstructions = sys.content;
    } else if (params.systemPromptAppend) {
      out.developerInstructions = params.systemPromptAppend;
    }
    if (params.maxTurns != null) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'maxTurns', provider: 'codex' },
      });
    }
    return out;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
    // Codex threads are server-side and stateful; a live one needs no resume.
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

  /**
   * W12 — the provider's own id for this conversation, so a runtime recycle can
   * hand it to a fresh adapter as `resumeProviderSessionId` and keep the
   * thread's history instead of starting cold.
   */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.threadId;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      try {
        await this.rpc('thread/delete', { threadId: conv.threadId });
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

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    // Codex has no agent-selection method. Record it rather than pretending it
    // worked, so the caller can surface "this provider ignored your agent".
    const conv = this.conversations.get(conversationId);
    conv?.warnings.push({
      code: 'AGENT_NOT_REGISTERED',
      params: { agent: agentName, provider: 'codex' },
    });
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
    // Fire-and-forget wrapper. `sendPromptAndWait` rejects on several paths; an
    // un-caught `void` here surfaces each as an unhandled rejection that can
    // take the whole process down under `--unhandled-rejections=strict`.
    void this.sendPromptAndWait(conversationId, prompt, attachments).catch((err: unknown) => {
      const conv = this.conversations.get(conversationId);
      const message = err instanceof Error ? err.message : String(err);
      if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
      this.opts.logger?.warn?.(`[CodexProvider] sendPrompt("${conversationId}") failed: ${message}`);
    });
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`CodexProvider: no conversation "${conversationId}"`);
    if (conv.inFlight) throw new Error(`CodexProvider: conversation "${conversationId}" already has a turn in flight`);
    conv.inFlight = true;
    conv.cancelRequested = false;

    try {
      return await this.doTurn(conv, prompt, attachments, signal, options);
    } finally {
      // Retire BEFORE clearing, so a terminal event still owed by this turn is
      // recognised as stale rather than attributed to whatever runs next.
      if (conv.activeTurnId) {
        conv.retiredTurns.add(conv.activeTurnId);
        while (conv.retiredTurns.size > RETIRED_TURN_MEMORY) {
          const oldest = conv.retiredTurns.values().next().value as string | undefined;
          if (oldest === undefined) break;
          conv.retiredTurns.delete(oldest);
        }
      }
      conv.inFlight = false;
      conv.settleTurn = null;
      conv.activeTurnId = null;
      conv.cancelRequested = false;
    }
  }

  /**
   * Run one turn, retrying on upstream backpressure with exponential backoff.
   *
   * The retry lives HERE rather than inside the notification handler so the
   * whole turn — request and stream alike — is re-attempted as a unit.
   */
  private async doTurn(
    conv: ConversationState,
    prompt: string,
    attachments: AttachmentRef[] | undefined,
    signal: AbortSignal | undefined,
    options: SendPromptOptions | undefined,
  ): Promise<ConversationResponse> {
    let lastPartial = '';
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runTurnOnce(conv, prompt, attachments, signal, options, (text) => {
          lastPartial = text;
        });
      } catch (err) {
        if (!isRetryable(err) || attempt >= this.opts.maxBackoffRetries) throw err;
        const delayMs = jitter(this.opts.baseBackoffMs * Math.pow(2, attempt));
        this.opts.logger?.warn?.(
          `[CodexProvider] ${errorInfoTag(err.info) ?? 'backpressure'}; retrying in ${Math.round(delayMs)} ms ` +
          `(attempt ${attempt + 1}/${this.opts.maxBackoffRetries})`,
        );
        await sleep(delayMs);
        // A Stop pressed while we were parked in the backoff must not be
        // followed by yet another attempt.
        if (conv.cancelRequested || signal?.aborted) {
          this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
          return { content: lastPartial };
        }
      }
    }
  }

  /** One `turn/start` request plus the notification stream it produces. */
  private runTurnOnce(
    conv: ConversationState,
    prompt: string,
    attachments: AttachmentRef[] | undefined,
    signal: AbortSignal | undefined,
    options: SendPromptOptions | undefined,
    reportPartial: (text: string) => void,
  ): Promise<ConversationResponse> {
    const turnParams: V2TurnStartParams = {
      threadId: conv.threadId,
      input: this.buildInput(prompt, attachments),
      // `SendPromptOptions` carries only `agentMode` / `permissionMode`. Codex
      // has no per-turn agent mode, and its per-turn approval policy is the
      // nearest analogue of a permission mode: a caller asking for `plan` or
      // `dontAsk` must not silently get the thread's default.
      ...(this.approvalPolicyForTurn(options)),
    };

    let assistantText = '';
    /**
     * Tool calls seen but not yet resolved. Pruned on completion — leaving
     * completed ids here makes a truncation stop emit `tool_complete
     * success:false` for tools that already succeeded, telling the model to
     * redo work it has done and (for a write or delete) possibly redo it
     * destructively.
     */
    const pendingToolItems = new Set<string>();

    return new Promise<ConversationResponse>((resolve, reject) => {
      let settled = false;
      // Assigned below, but `cancel()` can run before we get there (a signal
      // that was already aborted), so it must start life callable.
      let unsub: UnsubFn = () => { /* not subscribed yet */ };

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
        conv.settleTurn = null;
        unsub();
      };

      /**
       * The single place a turn is cancelled from — used by the external
       * signal, by `abortConversation()` (via `conv.settleTurn`) and by child
       * exit. It SETTLES the promise; emitting `harness.cancelled` without
       * settling is what wedged the conversation forever.
       */
      const cancel = (): void => {
        conv.cancelRequested = true;
        finish(() => {
          this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
          reportPartial(assistantText);
          resolve({ content: assistantText });
        });
      };

      const onAbort = (): void => {
        void this.interruptActiveTurn(conv);
        cancel();
      };

      if (signal?.aborted || conv.cancelRequested) {
        cancel();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      conv.settleTurn = cancel;

      /** Fail every still-open tool call — used when the model was truncated. */
      const failOpenToolCalls = (why: string): void => {
        for (const callId of pendingToolItems) {
          this.broadcast(conv, {
            kind: 'harness.tool_complete',
            data: {
              tool: callId,
              result:
                `Response was truncated (${why}). All tool calls in this batch are ` +
                `cancelled. Please re-issue your request.`,
              callId,
              success: false,
            },
          });
        }
        pendingToolItems.clear();
      };

      unsub = this.onNotification((method, params) => {
        // Every turn notification is keyed by thread AND turn, so events owed
        // by a turn we already walked away from are dropped by id rather than
        // guessed at with a timer.
        const p = params as Record<string, unknown> | undefined;
        if (!p || p['threadId'] !== conv.threadId) return;
        const turnId = p['turnId'];
        if (typeof turnId === 'string') {
          // A turn we have already finished with can still owe a terminal
          // event. Drop it explicitly — `activeTurnId` is null until
          // `turn/start` answers, so an `activeTurnId`-only guard fails OPEN
          // during exactly the window in which the stale event arrives.
          if (conv.retiredTurns.has(turnId)) return;
          if (conv.activeTurnId && turnId !== conv.activeTurnId) return;
        }

        switch (method) {
          case 'item/agentMessage/delta': {
            const delta = (params as V2AgentMessageDeltaNotification).delta ?? '';
            if (delta) {
              this.broadcast(conv, { kind: 'harness.token', data: { text: delta } });
              assistantText += delta;
              reportPartial(assistantText);
            }
            break;
          }

          case 'item/started': {
            const item = (params as V2ItemStartedNotification).item;
            if (item && TOOL_ITEM_TYPES.has(item.type)) {
              const { tool, args } = describeToolItem(item);
              pendingToolItems.add(item.id);
              this.broadcast(conv, {
                kind: 'harness.tool_start',
                data: { tool, args, callId: item.id },
              });
            }
            break;
          }

          case 'item/completed': {
            const item = (params as V2ItemCompletedNotification).item;
            if (!item) break;
            if (TOOL_ITEM_TYPES.has(item.type)) {
              const { tool } = describeToolItem(item);
              const { success, result } = summariseToolResult(item);
              pendingToolItems.delete(item.id);
              this.broadcast(conv, {
                kind: 'harness.tool_complete',
                data: { tool, result, callId: item.id, success },
              });
            } else if (item.type === 'agentMessage') {
              // The completed item carries the authoritative final text. Deltas
              // can be coalesced or replayed upstream, so trust this over the
              // accumulator when the two disagree.
              const text = (item as unknown as { text?: string }).text;
              if (typeof text === 'string' && text.length >= assistantText.length) {
                assistantText = text;
                reportPartial(assistantText);
              }
            }
            break;
          }

          case 'error': {
            const notif = params as V2ErrorNotification;
            // `willRetry` means the server is handling it — say nothing and let
            // the turn continue, or we would end a turn that is still running.
            if (notif.willRetry) break;
            const tag = errorInfoTag(notif.error?.codexErrorInfo);
            const message = notif.error?.message ?? 'Unknown Codex error';
            if (tag && RETRYABLE_ERROR_INFO.has(tag)) {
              finish(() => reject(new CodexRateLimitedError(notif.error!.codexErrorInfo!, message)));
              break;
            }
            if (tag && TRUNCATION_ERROR_INFO.has(tag)) {
              finish(() => {
                failOpenToolCalls(tag);
                this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
                resolve({ content: assistantText });
              });
              break;
            }
            finish(() => {
              this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
              reject(new Error(message));
            });
            break;
          }

          case 'turn/completed': {
            const turn: V2Turn | undefined = (params as V2TurnCompletedNotification).turn;
            // `turn/completed` identifies its turn inside the payload rather
            // than as a sibling `turnId`, so the guard above cannot see it.
            if (turn?.id) {
              if (conv.retiredTurns.has(turn.id)) break;
              if (conv.activeTurnId && turn.id !== conv.activeTurnId) break;
            }
            finish(() => {
              const status = turn?.status;
              if (status === 'interrupted') {
                this.broadcast(conv, {
                  kind: 'harness.cancelled',
                  data: { reason: 'user_abort', provider: 'codex' },
                });
                resolve({ content: assistantText });
                return;
              }
              if (status === 'failed') {
                const err: V2TurnError | null | undefined = turn?.error;
                const tag = errorInfoTag(err?.codexErrorInfo);
                const message = err?.message ?? 'Codex turn failed';
                if (tag && RETRYABLE_ERROR_INFO.has(tag)) {
                  reject(new CodexRateLimitedError(err!.codexErrorInfo!, message));
                  return;
                }
                if (tag && TRUNCATION_ERROR_INFO.has(tag)) failOpenToolCalls(tag);
                this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
                reject(new Error(message));
                return;
              }
              this.broadcast(conv, { kind: 'harness.idle', data: {} });
              resolve({ content: assistantText });
            });
            break;
          }

          default:
            break;
        }
      });

      // Fire the turn request. Notifications drive completion, but the request
      // itself can still fail.
      this.rpc<V2TurnStartResponse>('turn/start', turnParams).then(
        (res) => {
          conv.activeTurnId = res.turn?.id ?? null;
          // A turn that was cancelled between the request and its answer must
          // be interrupted now that we finally know its id.
          if (conv.cancelRequested) void this.interruptActiveTurn(conv);
        },
        (err: unknown) => {
          finish(() => {
            const message = err instanceof Error ? err.message : String(err);
            this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
            reject(err instanceof Error ? err : new Error(message));
          });
        },
      );
    });
  }

  /**
   * Maps a per-turn permission mode onto Codex's per-turn approval policy.
   *
   * Only the modes with an honest Codex equivalent are mapped; the rest fall
   * through to the thread's policy rather than being approximated. Returning
   * `{}` is deliberate — an unmapped mode must inherit, not silently become
   * `never`.
   */
  private approvalPolicyForTurn(
    options: SendPromptOptions | undefined,
  ): Pick<V2TurnStartParams, 'approvalPolicy'> {
    switch (options?.permissionMode) {
      case 'bypassPermissions':
      case 'dontAsk':
        return { approvalPolicy: 'never' }; // security-ok: not a default — translates the caller's EXPLICIT bypass request into Codex's vocabulary
      case 'acceptEdits':
      case 'default':
        return { approvalPolicy: 'on-request' };
      case 'plan':
        // Codex has no plan mode; the safest reading of "plan only" is to ask
        // before anything runs.
        return { approvalPolicy: 'untrusted' };
      default:
        return {};
    }
  }

  /** Build the `input` array, carrying image attachments through as local images. */
  private buildInput(prompt: string, attachments?: AttachmentRef[]): V2UserInput[] {
    const input: V2UserInput[] = [{ type: 'text', text: prompt, text_elements: [] }];
    for (const att of attachments ?? []) {
      if (att.type !== 'file' || !att.path) continue;
      // Attachments used to be accepted and dropped on the floor. Images are
      // the one kind the protocol takes inline; anything else is mentioned by
      // path so the model can open it with its own file tools.
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(att.path)) {
        input.push({ type: 'localImage', path: att.path });
      } else {
        input.push({ type: 'mention', name: att.displayName ?? att.path, path: att.path });
      }
    }
    return input;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    const out: ConversationMessage[] = [];
    try {
      // `thread/items/list` is real and paginated; the previous version
      // returned `[]` with a comment claiming Codex "does not expose message
      // history", which it does.
      let cursor: string | undefined;
      do {
        const page = await this.rpc<V2ThreadItemsListResponse>('thread/items/list', {
          threadId: conv.threadId,
          ...(cursor ? { cursor } : {}),
        });
        for (const entry of page.data ?? []) {
          const item = entry.item;
          if (item?.type === 'userMessage') {
            const content = (item as unknown as { content?: Array<{ text?: string }> }).content;
            out.push({
              role: 'user',
              content: (content ?? []).map((c) => c.text ?? '').join(''),
            });
          } else if (item?.type === 'agentMessage') {
            out.push({ role: 'assistant', content: (item as unknown as { text?: string }).text ?? '' });
          }
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    } catch {
      // History is best-effort; a failure here must not break the caller.
    }
    return out;
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.inFlight) return;
    conv.cancelRequested = true;
    // W13: settle the turn ourselves rather than waiting for the binary to
    // acknowledge. `settleTurn` emits `harness.cancelled` AND resolves the
    // awaited promise, which is what releases `inFlight`; the interrupt below
    // is the courtesy notification to the child.
    void this.interruptActiveTurn(conv);
    conv.settleTurn?.();
  }

  /**
   * Best-effort `turn/interrupt`, deliberately not awaited by callers: a wedged
   * or dead child must not be able to hold a Stop hostage.
   */
  private async interruptActiveTurn(conv: ConversationState): Promise<void> {
    const turnId = conv.activeTurnId;
    if (!turnId) return; // turn/start has not answered yet — nothing to interrupt
    try {
      await this.rpc('turn/interrupt', { threadId: conv.threadId, turnId });
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

  /** Parse one NDJSON line from the child's stdout. */
  private onStdoutLine(line: string): void {
    if (!line.trim()) return;
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(line) as IncomingMessage;
    } catch {
      return; // Non-JSON line (e.g. a startup banner) — ignore.
    }

    // A message carrying BOTH an id and a method is a server→client REQUEST
    // and must be answered, or the turn that raised it blocks until it times
    // out. This branch did not exist before.
    if (msg.id != null && typeof msg.method === 'string') {
      this.handleServerRequest(msg.id, msg.method, msg.params);
      return;
    }

    if (msg.id != null) {
      const pending = this.pendingRpc.get(msg.id);
      if (!pending) return;
      this.clearPending(msg.id);
      // A JSON-RPC error response is a FAILURE. Resolving it as a success is
      // what let a failed thread start pass silently.
      if (msg.error) {
        pending.reject(new CodexRpcError(msg.error.code, msg.error.message, msg.error.data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.method === 'string') {
      const { method, params } = msg;
      for (const h of [...this.notificationListeners]) h(method, params);
    }
  }

  /**
   * Answer a server→client request.
   *
   * Fail-closed: unless the host supplies an `onApproval` decision, anything
   * that would run a command, write a file or widen permissions is DECLINED.
   * The important part is that it is answered at all — an unanswered approval
   * stalls the turn indefinitely, which is what happened before.
   */
  private handleServerRequest(id: string | number, method: string, params: unknown): void {
    const respond = (result: unknown): void => this.writeMessage({ id, result });
    const respondError = (code: number, message: string): void =>
      this.writeMessage({ id, error: { code, message } });

    const decide = async (): Promise<void> => {
      const decision = this.opts.onApproval
        ? await this.opts.onApproval({ method, params })
        : 'decline';
      const approved = decision === 'accept';

      switch (method) {
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval':
          respond({ decision: approved ? 'accept' : 'decline' });
          return;
        // Legacy approval methods, still emitted by older binaries.
        case 'execCommandApproval':
        case 'applyPatchApproval':
          respond({ decision: approved ? 'approved' : { denied: { rejection: 'Denied by host policy.' } } });
          return;
        case 'item/permissions/requestApproval':
          // Never widen permissions on the model's say-so: there is no
          // "partial grant" that is safe to invent, so decline by refusing the
          // request rather than returning an empty profile the server would
          // read as a grant of nothing in particular.
          respondError(-32001, 'Permission escalation declined by host policy.');
          return;
        case 'item/tool/requestUserInput':
          respond({ answers: {} });
          return;
        case 'mcpServer/elicitation/request':
          respond({ action: approved ? 'accept' : 'decline' });
          return;
        case 'item/tool/call':
          // Host-executed dynamic tools are not wired up; say so explicitly
          // rather than leaving the call outstanding.
          respond({
            success: false,
            contentItems: [{ type: 'text', text: 'No host tool handler is registered.' }],
          });
          return;
        case 'account/chatgptAuthTokens/refresh':
        case 'attestation/generate':
          respondError(-32601, `${method} is not supported by this host.`);
          return;
        default:
          respondError(-32601, `Unhandled server request "${method}".`);
      }
    };

    void decide().catch((err: unknown) => {
      // An approval callback that throws must not leave the request dangling.
      respondError(-32603, err instanceof Error ? err.message : String(err));
    });
  }

  private rpcIdNext(): number {
    return ++this.rpcIdCounter;
  }

  private clearPending(id: string | number): void {
    const pending = this.pendingRpc.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRpc.delete(id);
  }

  /** Reject and drop every outstanding call — the child can no longer answer. */
  private failAllPendingRpc(err: Error): void {
    if (this.pendingRpc.size === 0) return;
    const entries = [...this.pendingRpc.entries()];
    this.pendingRpc.clear();
    for (const [, pending] of entries) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  /** Cancel every in-flight turn — used when the child dies or we shut down. */
  private settleAllTurns(): void {
    for (const conv of this.conversations.values()) conv.settleTurn?.();
  }

  private teardownIo(): void {
    // A readline interface left open keeps its 'line' listener — and the
    // stdout fd — alive for the lifetime of the provider.
    this.rl?.close();
    this.rl = null;
    this.proc?.stdout?.removeAllListeners('data');
    this.proc?.stderr?.removeAllListeners('data');
  }

  private captureStderr(chunk: string): void {
    const cap = this.opts.stderrCaptureBytes;
    if (cap <= 0) return;
    this.stderrTail = (this.stderrTail + chunk).slice(-cap);
  }

  /** Attach the captured stderr tail to a message, when there is any. */
  private withStderr(message: string): string {
    const tail = this.stderrTail.trim();
    return tail ? `${message}\n--- codex stderr (last ${tail.length} bytes) ---\n${tail}` : message;
  }

  /** Write one JSON-RPC message to the child's stdin. */
  private writeMessage(message: Record<string, unknown>): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  /** Send a notification (no id, no reply expected). */
  private notify(method: string, params: unknown): void {
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  private async rpc<R = unknown>(method: string, params?: unknown): Promise<R> {
    const proc = this.proc;
    if (!proc?.stdin || proc.stdin.destroyed) {
      throw new Error('CodexProvider: not initialized (call initialize() first)');
    }
    const id = this.rpcIdNext();
    return new Promise<R>((resolve, reject) => {
      // Every call is bounded. Without this a child that accepts the write and
      // never answers holds its caller forever, and `pendingRpc` grows without
      // limit — the map is only otherwise pruned by a matching response.
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(
          this.withStderr(`CodexProvider: '${method}' timed out after ${this.opts.rpcTimeoutMs} ms`),
        ));
      }, this.opts.rpcTimeoutMs);
      timer.unref?.();

      this.pendingRpc.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      proc.stdin!.write(payload + '\n', (err) => {
        if (!err) return;
        this.clearPending(id);
        reject(new Error(`CodexProvider: failed to write '${method}' to codex stdin: ${err.message}`));
      });
    });
  }

  private onNotification(handler: (method: string, params: unknown) => void): UnsubFn {
    this.notificationListeners.add(handler);
    return () => this.notificationListeners.delete(handler);
  }
}

/** Re-exported so hosts can type an approval policy without a deep import. */
export type CodexApprovalPolicy = V2AskForApproval;
export type CodexSandboxMode = V2SandboxMode;
