// ────────────────────────────────────────────────────────────────
// OpenCodeProvider — IAgentHarness wrapping `opencode serve` (HTTP + SSE).
//
// W38 — OpenCode provider. Talks to a running `opencode serve` over its HTTP
// API and consumes its server-sent event stream.
//
// ── Protocol provenance ──────────────────────────────────────────
// Every route and payload type used here comes from
// `protocol/opencode.generated.ts`, emitted by `pnpm generate:schemas` from
// `schemas/opencode/openapi.json` — the OpenAPI 3.1 document `opencode serve`
// publishes at `GET /doc`. The generated `OPENCODE_OPERATIONS` table records,
// per route, whether its success response is `text/event-stream`.
//
// That table is the correction this rewrite is built on. The previous version
// POSTed the prompt to `/session/{id}/message` and read the RESPONSE BODY as an
// SSE stream. It is not one: the document declares exactly four streaming
// routes, and `session.prompt` is not among them — it returns a single JSON
// `{ info, parts }` once the turn is over. So the old parser looked for
// `data: ` lines in a JSON object, matched none, and every turn returned empty
// content having emitted no tokens at all.
//
// The real shape, verified against opencode-ai@1.18.25:
//
//   • Streaming is a SEPARATE, server-wide subscription: `GET /event`. One
//     connection carries every session's events, so this provider holds one and
//     demultiplexes by `properties.sessionID`.
//   • Text arrives as `message.part.updated` whose `part.text` is CUMULATIVE,
//     not a delta. Token deltas are derived by diffing against the last text
//     seen for that part id.
//   • A turn ends at `session.idle`; `message.updated` carries the assistant
//     message's `finish` reason. Truncation is `MessageOutputLengthError` on a
//     `session.error` event, not a `stop_reason: length` field.
//   • `POST /session` takes `{ parentID?, title? }`. It has never accepted
//     `model` or `systemPrompt` — both were sent and silently ignored, so every
//     conversation ran on the server default. The model belongs on the PROMPT,
//     as `{ providerID, modelID }`, and the system prompt as `system`.
//   • Cancellation is `POST /session/{id}/abort`, not `DELETE .../message`.
//   • Models come from `GET /config/providers`, which returns real capability
//     and context-window metadata. `GET /model` does not exist.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, never probed.
//   L18: protocol types generated from a pinned upstream artifact.
//   W13: truncation guard — MessageOutputLengthError fails open tool calls.
//   W13: semantic cancellation — abort emits `harness.cancelled`, not throws.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
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
import type { OpenCodeProviderOptions } from '../../types.js';
import type {
  Agent as OpenCodeAgent,
  AssistantMessage,
  Event as OpenCodeEvent,
  Model as OpenCodeModel,
  Part as OpenCodePart,
  Provider as OpenCodeProviderInfo,
  Session as OpenCodeSession,
} from '../../protocol/opencode.generated.js';
import { OPENCODE_OPERATIONS } from '../../protocol/opencode.generated.js';

// ── Type aliases ─────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/** A model reference on the wire: OpenCode addresses models by provider + id. */
interface ModelRef {
  providerID: string;
  modelID: string;
}

interface TurnState {
  /** Resolves the awaited turn. */
  settle: (outcome: 'done' | 'cancelled') => void;
  /** Rejects the awaited turn. */
  fail: (err: Error) => void;
  /** Cumulative assistant text, assembled from part updates. */
  text: string;
  /** Last cumulative text seen per part id, so deltas can be derived. */
  partText: Map<string, string>;
  /** Tool part ids started but not yet completed. */
  openTools: Set<string>;
  /** Assistant message id, once known, so other sessions' parts are excluded. */
  assistantMessageId: string | null;
  settled: boolean;
  /**
   * Whether a terminal event (`harness.idle` / `harness.cancelled`) has already
   * been broadcast for this turn.
   *
   * The stream and the HTTP response both describe the same ending, and both
   * are consulted — so without this a cancelled turn emitted `harness.cancelled`
   * twice: once when `session.error` carried `MessageAbortedError`, and again
   * when the prompt response came back with `finish: "aborted"`.
   */
  terminalEmitted: boolean;
}

interface ConversationState {
  /** The OpenCode session id (`ses_…`) from POST /session. */
  sessionId: string;
  params: CreateConversationParams;
  /**
   * Model for this conversation, resolved once at creation from
   * `params.model ?? opts.defaultModel` and sent on every prompt. OpenCode has
   * no per-session model, so this must ride along with each message or the
   * user's choice is discarded.
   */
  model: ModelRef | null;
  /** System prompt, sent on every prompt for the same reason. */
  system: string | undefined;
  /**
   * Project root for this conversation, sent as `?directory=` on every
   * session-scoped request.
   *
   * `opencode serve` is one process serving many roots: every endpoint in
   * `schemas/opencode/openapi.json` — `POST /session` included — takes an
   * optional `directory` query parameter naming the project the call applies
   * to, and `Session.directory` is what the server echoes back. Without it a
   * session inherits the SERVER's cwd, so a chat bound to a worktree read and
   * wrote the directory the GeneratorAI server happened to start in.
   *
   * Undefined when neither the conversation nor `opts.defaultCwd` names one —
   * then the server's own default applies, as before.
   */
  directory: string | undefined;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  turn: TurnState | null;
}

/** Wall-clock deadline shared by every non-streaming call. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Idle deadline between SSE frames on the shared event stream. */
const DEFAULT_SSE_TIMEOUT_MS = 120_000;
/** How long `autoStart` waits for a spawned server to answer. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
/** Ceiling on a single turn with no terminal event. 0 disables. */
const DEFAULT_TURN_TIMEOUT_MS = 0;
/**
 * How long the slower of {prompt response, event stream} gets to catch up once
 * the other has reported the turn is over. The two are independent connections
 * and routinely settle out of order.
 */
const DEFAULT_SETTLE_GRACE_MS = 2_000;

/** Errors OpenCode reports on `session.error` that mean the model was truncated. */
const TRUNCATION_ERRORS: ReadonlySet<string> = new Set([
  'MessageOutputLengthError',
  'ContextOverflowError',
]);
/** Errors that mean the user (or we) stopped the turn. */
const ABORT_ERRORS: ReadonlySet<string> = new Set(['MessageAbortedError']);

// ── OpenCodeProvider ─────────────────────────────────────────────

/**
 * W38 — IAgentHarness backed by `opencode serve`.
 *
 * Lifecycle:
 *   1. `initialize()` probes the server (`GET /session`), starting one with
 *      `autoStart` when it is not reachable, then opens the shared event
 *      stream.
 *   2. `createConversation()` calls `POST /session` → session id.
 *   3. `sendPromptAndWait()` POSTs the prompt and resolves from the shared
 *      stream, streaming `harness.token` as the text parts grow.
 *   4. `abortConversation()` calls `POST /session/{id}/abort`.
 *   5. `shutdown()` closes the stream and stops only a server WE started.
 */
export class OpenCodeProvider implements IAgentHarness {
  private baseUrl: string;
  private readonly opts: OpenCodeProviderOptions;
  private readonly requestTimeoutMs: number;
  private readonly sseTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private clientState: HarnessClientState = 'starting';
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private conversations = new Map<string, ConversationState>();
  /** sessionId → conversationId, for demultiplexing the shared event stream. */
  private sessionIndex = new Map<string, string>();
  /** Only set when `autoStart` spawned the server — we own it, so we stop it. */
  private serverProc: ChildProcess | null = null;

  /** Aborts the shared event-stream reader. */
  private streamAbort: AbortController | null = null;
  /** Resolves once the stream is connected, so a prompt cannot race it. */
  private streamReady: Promise<void> | null = null;
  /** True once `shutdown()` has run, so the stream does not reconnect. */
  private closed = false;

  constructor(opts: OpenCodeProviderOptions) {
    this.opts = opts;
    // No invented default port. `opencode serve --port` defaults to 0 (an
    // ephemeral port), so there is no well-known address to guess: the caller
    // supplies `baseUrl`, or `autoStart` binds a port we choose and we read the
    // real URL back off the child's output.
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/$/, '');
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.sseTimeoutMs = opts.sseTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;
    this.turnTimeoutMs = opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.closed = false;

    if (this.baseUrl && (await this.probe())) {
      this.clientState = 'running';
      await this.openEventStream();
      return;
    }

    if (this.opts.autoStart) {
      await this.startServer();
      this.clientState = 'running';
      await this.openEventStream();
      return;
    }

    this.clientState = 'error';
    throw new Error(
      this.baseUrl
        ? `OpenCodeProvider: cannot reach opencode serve at ${this.baseUrl}. ` +
          `Start it with \`opencode serve --port <port>\`, set \`autoStart: true\` to have this ` +
          `provider start it, or correct \`baseUrl\`.`
        : `OpenCodeProvider: no \`baseUrl\` given and \`autoStart\` is false. ` +
          `\`opencode serve\` binds an ephemeral port by default, so there is no address to ` +
          `assume — pass \`baseUrl\`, or set \`autoStart: true\`.`,
    );
  }

  /** Spawn `opencode serve` ourselves and wait for it to answer. */
  private async startServer(): Promise<void> {
    const bin = this.opts.binaryPath ?? 'opencode';
    // Bind an explicit port so the URL is knowable. When the caller gave a
    // baseUrl we honour its port; otherwise we let the OS choose and read the
    // bound address back from the child's own startup line.
    const configuredPort = this.baseUrl ? new URL(this.baseUrl).port : '';
    const args = this.opts.serveArgs ?? [
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      configuredPort || '0',
    ];

    const proc = spawn(bin, args, {
      // Without an explicit cwd the server inherits the GeneratorAI server's
      // own working directory and treats it as the default project root.
      // Per-conversation roots ride on `?directory=` (see
      // `ConversationState.directory`); this is only the fallback.
      ...(this.opts.defaultCwd ? { cwd: this.opts.defaultCwd } : {}),
      // OpenCode runs model-authored tool calls, so it gets the allowlisted
      // harness environment, never the full parent env — the same rule
      // `childEnv.ts` enforces for every other spawned provider.
      env: buildHarnessEnv({ extra: this.opts.env }),
      // stdout is PIPED because the server prints the address it actually bound
      // to, which is the only way to learn an ephemeral port.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.serverProc = proc;

    let stderrTail = '';
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (c: string) => { stderrTail = (stderrTail + c).slice(-8_192); });

    // `opencode serve` announces itself as
    //   "opencode server listening on http://127.0.0.1:PORT"
    // on stdout (and, depending on --print-logs, stderr).
    const discoveredUrl = new Promise<string>((resolve) => {
      const scan = (chunk: string): void => {
        const match = /https?:\/\/[0-9a-zA-Z.\-\[\]:]+:\d+/.exec(chunk);
        if (match) resolve(match[0]);
      };
      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', scan);
      proc.stderr?.on('data', scan);
    });

    const spawnFailure = new Promise<never>((_, reject) => {
      proc.once('error', (err) => reject(new Error(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `OpenCodeProvider: opencode binary "${bin}" not found. Install it, or set \`binaryPath\`.`
          : err.message,
      )));
      proc.once('exit', (code) => reject(new Error(
        `OpenCodeProvider: \`${bin} ${args.join(' ')}\` exited with code ${code}` +
        (stderrTail.trim() ? `\n--- opencode stderr ---\n${stderrTail.trim()}` : ''),
      )));
    });

    const startupTimeoutMs = this.opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const deadline = Date.now() + startupTimeoutMs;
    try {
      // Learn the address first — polling a URL we only guessed at is how an
      // ephemeral-port server looks identical to a dead one.
      if (!this.baseUrl) {
        const url = await Promise.race([
          discoveredUrl,
          spawnFailure,
          new Promise<never>((_, reject) => {
            const t = setTimeout(
              () => reject(new Error(
                `OpenCodeProvider: \`${bin} ${args.join(' ')}\` did not announce a listening ` +
                `address within ${startupTimeoutMs} ms.`,
              )),
              startupTimeoutMs,
            );
            t.unref?.();
          }),
        ]);
        this.baseUrl = url.replace(/\/$/, '');
      }

      while (Date.now() < deadline) {
        // Race the poll against the child dying, so a server that fails to
        // bind reports its own reason instead of a blank timeout.
        const ready = await Promise.race([this.probe(), spawnFailure]);
        if (ready) return;
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (err) {
      this.clientState = 'error';
      await this.stopServer();
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.clientState = 'error';
    await this.stopServer();
    throw new Error(
      `OpenCodeProvider: started \`${bin} ${args.join(' ')}\` but it did not answer at ` +
      `${this.baseUrl} within ${startupTimeoutMs} ms.`,
    );
  }

  private async stopServer(): Promise<void> {
    const proc = this.serverProc;
    this.serverProc = null;
    if (!proc || proc.exitCode != null || proc.signalCode != null) return;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5_000);
      timer.unref?.();
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  private async probe(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const resp = await this.fetch(OPENCODE_OPERATIONS['session.list'].path);
      // Drain the body so the socket returns to the pool instead of dangling.
      await resp.arrayBuffer().catch(() => undefined);
      return resp.ok;
    } catch { return false; }
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    this.closed = true;
    this.streamAbort?.abort();
    this.serverProc?.kill('SIGKILL');
    this.serverProc = null;
    this.failAllTurns(new Error('OpenCodeProvider: force-stopped'));
    this.clientState = 'stopped';
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.streamReady = null;
    this.failAllTurns(new Error('OpenCodeProvider: shut down'));
    // Only a server this provider started is ours to stop.
    await this.stopServer();
    this.clientState = 'stopped';
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    return this.probe();
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9) ────────────────────────────────────────────

  capabilities(): ProviderCapabilities {
    return {
      // Prompts take `FilePartInput` attachments; whether a given MODEL accepts
      // images is reported per model by `GET /config/providers`.
      vision: true,
      // OpenCode surfaces reasoning parts, but exposes no effort control.
      reasoning: true,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: true,  // OpenCode has native MCP support (`/mcp` routes)
      // `GET /skill` exists; there is no way to point it at our directories.
      skills: 'none',
      // Nothing routes OpenCode's own permission requests to the session's
      // gate, so a run cannot be held to `default` or `plan` (PD-17).
      approvalGating: 'none',
      hostTools: 'none',
      structuredOutput: 'none',
      sessionPersistence: true, // opencode persists sessions server-side
      // Assistant messages carry `cost`; there is no budget ceiling to set.
      budgetTracking: false,
      computerUse: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    try {
      // `GET /model` does not exist — the previous version called it and so
      // always returned an empty list. Models live under the providers route.
      const resp = await this.fetch(OPENCODE_OPERATIONS['config.providers'].path);
      if (!resp.ok) return [];
      const body = await resp.json() as {
        providers?: OpenCodeProviderInfo[];
        default?: Record<string, string>;
      };
      const out: HarnessModel[] = [];
      for (const provider of body.providers ?? []) {
        for (const model of Object.values(provider.models ?? {})) {
          out.push(this.toHarnessModel(provider, model as OpenCodeModel));
        }
      }
      return out;
    } catch { return []; }
  }

  private toHarnessModel(provider: OpenCodeProviderInfo, model: OpenCodeModel): HarnessModel {
    const limit = model.limit as { context?: number; output?: number } | undefined;
    const capabilities = model.capabilities as
      | { reasoning?: boolean; input?: { image?: boolean } }
      | undefined;
    return {
      // Qualified so two providers offering the same model id stay distinct —
      // an unqualified id collides the moment a second provider is configured.
      id: `${provider.id}/${model.id}`,
      name: model.name ?? model.id,
      provider: 'opencode',
      supportsReasoning: capabilities?.reasoning ?? false,
      ...(limit?.context ? { promptTokenLimit: limit.context } : {}),
      ...(limit?.context && limit?.output
        ? { totalContextWindow: limit.context + limit.output }
        : {}),
    };
  }

  /**
   * Splits a model id into the `{ providerID, modelID }` pair the wire wants.
   *
   * Accepts both the qualified form `getModels()` emits (`opencode/gpt-5`) and
   * a bare id, which is resolved against the caller-supplied default provider.
   */
  private parseModelRef(model: string | undefined): ModelRef | null {
    if (!model) return null;
    const slash = model.indexOf('/');
    if (slash > 0) {
      return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
    }
    const providerID = this.opts.defaultProviderId;
    if (!providerID) return null;
    return { providerID, modelID: model };
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const warnings: ConversationWarning[] = [];
    const rawModel = params.model ?? this.opts.defaultModel;
    const model = this.parseModelRef(rawModel);
    if (rawModel && !model) {
      // Silently running on the server default is how a user's model choice
      // disappears without trace. Say so.
      warnings.push({
        code: 'FIELD_COERCED',
        params: {
          field: 'model',
          value: rawModel,
          reason: 'unqualified model id and no defaultProviderId configured',
        },
      });
    }

    // The chat's primary mount. `opencode serve` has no notion of extra
    // roots — `Session` carries a single `directory`, and no endpoint in the
    // pinned OpenAPI document accepts a list — so the other mounts and the
    // managed workspace root cannot be granted here.
    const directory = params.workingDirectory ?? this.opts.defaultCwd;
    if (params.additionalDirectories?.length) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: {
          field: 'additionalDirectories',
          provider: 'opencode',
          reason: 'a session has exactly one project directory',
        },
      });
    }
    // The server process is shared by every conversation and is spawned before
    // any of them exists, so per-conversation variables cannot reach it.
    if (params.env && Object.keys(params.env).length > 0) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'env', provider: 'opencode', reason: 'shared server process' },
      });
    }

    let sessionId: string;
    if (params.resumeProviderSessionId) {
      // W12 — rejoin the existing server-side session rather than starting the
      // model over with no memory of the chat.
      sessionId = params.resumeProviderSessionId;
      const resp = await this.fetch(
        this.route(OPENCODE_OPERATIONS['session.get'].path, { sessionID: sessionId }),
        undefined,
        directory,
      );
      await resp.arrayBuffer().catch(() => undefined);
      if (!resp.ok) {
        throw new Error(
          `OpenCodeProvider: cannot resume session "${sessionId}" (HTTP ${resp.status}).`,
        );
      }
    } else {
      // `POST /session` accepts only `{ parentID?, title? }`. Sending `model`
      // or `systemPrompt` here — as the previous version did — is silently
      // ignored; both belong on each prompt instead.
      const resp = await this.fetch(
        OPENCODE_OPERATIONS['session.create'].path,
        { method: 'POST', body: JSON.stringify({ title: params.conversationId }) },
        directory,
      );
      if (!resp.ok) {
        throw new Error(`OpenCodeProvider: POST /session failed with ${resp.status}`);
      }
      const session = await resp.json() as OpenCodeSession;
      sessionId = session.id;
    }

    this.conversations.set(params.conversationId, {
      sessionId,
      params,
      model,
      system: this.extractSystemPrompt(params),
      directory,
      listeners: new Set(),
      warnings,
      turn: null,
    });
    this.sessionIndex.set(sessionId, params.conversationId);
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

  /** W12 — OpenCode sessions are server-side, so they survive a runtime recycle. */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.sessionId;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      try {
        const resp = await this.fetch(
          this.route(OPENCODE_OPERATIONS['session.delete'].path, { sessionID: conv.sessionId }),
          { method: 'DELETE' },
          conv.directory,
        );
        await resp.arrayBuffer().catch(() => undefined);
      } catch { /* best effort */ }
      this.sessionIndex.delete(conv.sessionId);
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
    // OpenCode takes the agent per prompt rather than as session state, so this
    // records the choice and every later prompt carries it.
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    conv.params = { ...conv.params, defaultAgent: agentName };
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    try {
      // `GET /agent` is a real route returning the configured agents (build,
      // plan, explore, general, …). Returning `[]` unconditionally, as the
      // previous version did, hid every one of them.
      const resp = await this.fetch(OPENCODE_OPERATIONS['app.agents'].path);
      if (!resp.ok) return [];
      const agents = await resp.json() as OpenCodeAgent[];
      return agents.map((a) => ({
        name: a.name,
        description: a.description ?? undefined,
        model: a.model ? `${a.model.providerID}/${a.model.modelID}` : undefined,
        source: 'opencode',
      }));
    } catch { return []; }
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    // Fire-and-forget, but never un-caught: `sendPromptAndWait` rejects on
    // several paths and an unhandled rejection can kill the process outright.
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options)
      .catch((err: unknown) => {
        const conv = this.conversations.get(conversationId);
        const message = err instanceof Error ? err.message : String(err);
        if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'opencode' } });
        this.opts.logger?.warn?.(`[OpenCodeProvider] sendPrompt("${conversationId}") failed: ${message}`);
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
    if (!conv) throw new Error(`OpenCodeProvider: no conversation "${conversationId}"`);
    if (conv.turn) throw new Error(`OpenCodeProvider: conversation "${conversationId}" already has a turn in flight`);

    // The stream must be live BEFORE the prompt is posted, or the first tokens
    // are emitted into a subscription that does not exist yet.
    await this.ensureEventStream();

    let settleTurn!: (outcome: 'done' | 'cancelled') => void;
    let failTurn!: (err: Error) => void;
    const completion = new Promise<'done' | 'cancelled'>((resolve, reject) => {
      settleTurn = resolve;
      failTurn = reject;
    });
    // Observed here rather than awaited raw, so the stream's outcome can be
    // inspected after the fact without an unhandled rejection when the HTTP
    // side is the one that settles the turn.
    let streamOutcome: 'done' | 'cancelled' | null = null;
    let streamError: Error | null = null;
    const streamSettled = completion.then(
      (o) => { streamOutcome = o; },
      (e: unknown) => { streamError = e instanceof Error ? e : new Error(String(e)); },
    );

    const turn: TurnState = {
      settle: (outcome) => { if (!turn.settled) { turn.settled = true; settleTurn(outcome); } },
      fail: (err) => { if (!turn.settled) { turn.settled = true; failTurn(err); } },
      text: '',
      partText: new Map(),
      openTools: new Set(),
      assistantMessageId: null,
      settled: false,
      terminalEmitted: false,
    };
    conv.turn = turn;

    // Keep the handler so it can be REMOVED. A caller that reuses one
    // long-lived AbortSignal (a whole workflow run, say) accumulates one
    // listener per turn otherwise — and `once: true` does not help, because
    // the listener that never fires is the one that never leaves.
    const onAbort = (): void => { void this.abortConversation(conversationId); };
    signal?.addEventListener('abort', onAbort, { once: true });

    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (signal?.aborted) {
        this.emitTerminal(conv, turn, 'cancelled');
        return { content: '' };
      }

      if (this.turnTimeoutMs > 0) {
        turnTimer = setTimeout(
          () => turn.fail(new Error(
            `OpenCodeProvider: turn did not finish within ${this.turnTimeoutMs} ms`,
          )),
          this.turnTimeoutMs,
        );
        turnTimer.unref?.();
      }

      const body = {
        parts: [
          { type: 'text', text: prompt },
          ...this.buildFileParts(attachments),
        ],
        ...(conv.model ? { model: conv.model } : {}),
        ...(conv.system ? { system: conv.system } : {}),
        ...(this.agentFor(conv, options) ? { agent: this.agentFor(conv, options) } : {}),
      };

      // `POST /session/{id}/message` returns a single JSON body when the turn
      // is over — it is NOT a stream (see OPENCODE_OPERATIONS). Streaming comes
      // from the shared `/event` subscription opened above. Both are used: the
      // stream drives token/tool events, the response is the authoritative
      // final message.
      //
      // The two arrive in EITHER order. On loopback the HTTP response
      // consistently lands first, and tearing the turn down on it — as the
      // first version of this rewrite did — discarded every event still in
      // flight, so a turn that streamed perfectly well emitted no tokens at
      // all. So the request is started, not awaited, and both sides are then
      // given a bounded chance to arrive.
      const httpSettled = this.fetch(
        this.route(OPENCODE_OPERATIONS['session.prompt'].path, { sessionID: conv.sessionId }),
        { method: 'POST', body: JSON.stringify(body) },
        conv.directory,
      ).then(
        (resp) => ({ ok: true as const, resp }),
        (err: unknown) => ({ ok: false as const, err }),
      );

      // Whichever side reports first ends the turn; the other then gets a short
      // grace period to catch up.
      await Promise.race([httpSettled, streamSettled]);
      await this.withGrace(streamSettled);
      const http = await this.withGrace(httpSettled);

      if (streamError) throw streamError;

      let final: { info?: AssistantMessage; parts?: OpenCodePart[] } = {};
      if (http) {
        if (!http.ok) throw http.err instanceof Error ? http.err : new Error(String(http.err));
        if (!http.resp.ok) {
          const detail = await http.resp.text().catch(() => '');
          throw new Error(
            `OpenCodeProvider: POST prompt failed with ${http.resp.status}` +
            (detail ? `: ${detail.slice(0, 500)}` : ''),
          );
        }
        final = await http.resp.json().catch(() => ({})) as typeof final;
      }

      const finishReason = (final.info as unknown as { finish?: string } | undefined)?.finish
        ?? (streamOutcome === 'cancelled' ? 'aborted' : undefined);
      // Prefer the streamed text when the HTTP body carried none: an aborted or
      // errored turn answers with no parts, and the partial the user already
      // saw is the honest result.
      const text = this.textOf(final.parts) || turn.text;

      if (finishReason === 'length') {
        // W13/B1 — truncation: fail every tool call still open so the model is
        // never told work completed that did not.
        this.failOpenTools(conv, turn, 'the response was truncated (finish: length)');
      }
      if (finishReason === 'aborted') {
        this.emitTerminal(conv, turn, 'cancelled');
        return { content: text };
      }

      this.emitTerminal(conv, turn, 'idle');
      return { content: text };
    } catch (err) {
      if (signal?.aborted) {
        this.emitTerminal(conv, turn, 'cancelled');
        return { content: turn.text };
      }
      throw err;
    } finally {
      if (turnTimer) clearTimeout(turnTimer);
      signal?.removeEventListener('abort', onAbort);
      turn.settled = true;
      conv.turn = null;
    }
  }

  /**
   * Broadcast a turn's terminal event exactly once.
   *
   * Both the event stream and the prompt response report the same ending, and
   * either may arrive first, so every terminal emission funnels through here.
   */
  private emitTerminal(
    conv: ConversationState,
    turn: TurnState,
    kind: 'idle' | 'cancelled',
  ): void {
    if (turn.terminalEmitted) return;
    turn.terminalEmitted = true;
    this.broadcast(
      conv,
      kind === 'cancelled'
        ? { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } }
        : { kind: 'harness.idle', data: {} },
    );
  }

  /**
   * Await `promise`, but give up after the settle grace and return null.
   *
   * Used to let the slower of {HTTP response, event stream} catch up without
   * letting either one hang a turn: a lost `session.idle` costs one grace
   * period, not the whole conversation.
   */
  private async withGrace<T>(promise: Promise<T>): Promise<T | null> {
    const ms = this.opts.settleGraceMs ?? DEFAULT_SETTLE_GRACE_MS;
    if (ms <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Which agent to run this turn under, if any. */
  private agentFor(conv: ConversationState, _options: SendPromptOptions | undefined): string | undefined {
    return conv.params.defaultAgent;
  }

  /** File attachments become `FilePartInput` parts. */
  private buildFileParts(attachments?: AttachmentRef[]): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [];
    for (const att of attachments ?? []) {
      if (att.type !== 'file' || !att.path) continue;
      // Attachments used to be accepted and dropped entirely.
      parts.push({
        type: 'file',
        // `file://` is how the OpenAPI document's FilePartInput addresses a
        // path on the server's own filesystem.
        url: att.path.startsWith('file://') ? att.path : `file://${att.path}`,
        filename: att.displayName ?? att.path.split(/[\\/]/).pop() ?? att.path,
        mime: 'application/octet-stream',
      });
    }
    return parts;
  }

  /** Concatenate the text parts of a finished message. */
  private textOf(parts: OpenCodePart[] | undefined): string {
    let out = '';
    for (const part of parts ?? []) {
      if ((part as { type?: string }).type === 'text') {
        out += (part as { text?: string }).text ?? '';
      }
    }
    return out;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    try {
      // `GET /session/{id}/message` is a real route. The previous version
      // returned `[]` unconditionally.
      const resp = await this.fetch(
        this.route(OPENCODE_OPERATIONS['session.messages'].path, { sessionID: conv.sessionId }),
        undefined,
        conv.directory,
      );
      if (!resp.ok) return [];
      const rows = await resp.json() as Array<{ info?: { role?: string }; parts?: OpenCodePart[] }>;
      return rows.map((row) => ({
        role: (row.info?.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: this.textOf(row.parts),
      }));
    } catch { return []; }
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.turn) return;
    try {
      const resp = await this.fetch(
        this.route(OPENCODE_OPERATIONS['session.abort'].path, { sessionID: conv.sessionId }),
        { method: 'POST' },
        conv.directory,
      );
      await resp.arrayBuffer().catch(() => undefined);
    } catch { /* best effort */ }
    // Settle locally too: waiting for the server to confirm is what left a
    // stopped conversation permanently "in flight" if the abort was lost.
    conv.turn.settle('cancelled');
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

  // ── Shared event stream ───────────────────────────────────────────

  private async ensureEventStream(): Promise<void> {
    if (!this.streamReady) await this.openEventStream();
    else await this.streamReady;
  }

  /**
   * Open the server-wide SSE subscription and demultiplex it by session.
   *
   * One connection for the whole provider, not one per turn: `/event` is a
   * server-wide stream, so opening it per turn would deliver every other
   * session's traffic to every turn and multiply the connection count by the
   * number of active conversations.
   */
  private async openEventStream(): Promise<void> {
    if (this.closed) return;
    const abort = new AbortController();
    this.streamAbort = abort;

    let markReady!: () => void;
    let markFailed!: (err: Error) => void;
    this.streamReady = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    });

    // The stream request carries its own long-lived signal, so it opts out of
    // the blanket request deadline in `fetch`. That leaves the CONNECT
    // unbounded: a server that accepts the socket and never sends response
    // headers would hang `initialize()` — which sits on the harness bring-up
    // path — forever. Bound the connect explicitly; once headers arrive,
    // `sseTimeoutMs` governs the body.
    let connected = false;
    const connectTimer = setTimeout(() => {
      if (!connected) abort.abort();
    }, this.requestTimeoutMs);
    connectTimer.unref?.();

    const run = async (): Promise<void> => {
      let resp: Response;
      try {
        resp = await this.fetch(OPENCODE_OPERATIONS['event.subscribe'].path, {
          signal: abort.signal,
          headers: { Accept: 'text/event-stream' },
        });
      } catch (err) {
        throw abort.signal.aborted && !connected
          ? new Error(
              `OpenCodeProvider: GET /event did not answer within ` +
              `${this.requestTimeoutMs} ms.`,
            )
          : err;
      } finally {
        clearTimeout(connectTimer);
      }
      if (!resp.ok || !resp.body) {
        throw new Error(`OpenCodeProvider: GET /event failed with ${resp.status}`);
      }
      connected = true;
      markReady();

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await this.readWithIdleTimeout(reader);
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              this.dispatchEvent(JSON.parse(payload) as OpenCodeEvent);
            } catch { /* skip malformed frames */ }
          }
        }
      } finally {
        // Both closes the body and releases the lock, so the connection is
        // actually returned rather than dangling.
        await reader.cancel().catch(() => { /* already closed */ });
      }
    };

    run().catch((err: unknown) => {
      clearTimeout(connectTimer);
      // An abort BEFORE the stream connected is the connect deadline firing,
      // which is a real failure the caller must hear about; an abort after is
      // our own shutdown.
      if ((abort.signal.aborted && connected) || this.closed) return;
      const message = err instanceof Error ? err.message : String(err);
      markFailed(err instanceof Error ? err : new Error(message));
      this.streamReady = null;
      // A dropped stream means no turn can ever complete, so say so loudly and
      // fail whatever is waiting rather than hanging forever.
      for (const h of this.clientEventListeners) {
        h({ type: 'client.error', data: { message: `OpenCode event stream lost: ${message}` } });
      }
      this.failAllTurns(new Error(`OpenCodeProvider: event stream lost: ${message}`));
    });

    // Surface an immediate connection failure to the caller of initialize();
    // a later drop is reported through `client.error` above.
    await this.streamReady;
  }

  /**
   * `reader.read()` with an idle deadline.
   *
   * A server that accepts the connection and then goes quiet would otherwise
   * leave every turn awaiting a read that never settles. OpenCode sends
   * periodic `server.heartbeat` frames, so silence really does mean trouble.
   */
  private async readWithIdleTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
    if (this.sseTimeoutMs <= 0) return reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(
              `OpenCodeProvider: no SSE frame for ${this.sseTimeoutMs} ms — stream abandoned`,
            )),
            this.sseTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Route one stream event to the conversation that owns its session. */
  private dispatchEvent(event: OpenCodeEvent): void {
    const type = (event as { type?: string }).type;
    const props = (event as { properties?: Record<string, unknown> }).properties ?? {};
    const sessionId = props['sessionID'];
    if (typeof sessionId !== 'string') return;

    const conversationId = this.sessionIndex.get(sessionId);
    if (!conversationId) return;
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    const turn = conv.turn;
    if (!turn) return;

    switch (type) {
      case 'message.updated': {
        const info = props['info'] as { id?: string; role?: string } | undefined;
        // Remember which message is the assistant's reply so parts belonging to
        // the echoed user message are not streamed back as model output.
        if (info?.role === 'assistant' && typeof info.id === 'string') {
          turn.assistantMessageId = info.id;
        }
        break;
      }

      case 'message.part.updated': {
        const part = props['part'] as Record<string, unknown> | undefined;
        if (!part) break;
        if (turn.assistantMessageId && part['messageID'] !== turn.assistantMessageId) break;
        this.handlePart(conv, turn, part);
        break;
      }

      case 'session.error': {
        const error = props['error'] as { name?: string; data?: { message?: string } } | undefined;
        const name = error?.name ?? 'UnknownError';
        const message = error?.data?.message ?? name;
        if (ABORT_ERRORS.has(name)) {
          this.emitTerminal(conv, turn, 'cancelled');
          turn.settle('cancelled');
          break;
        }
        if (TRUNCATION_ERRORS.has(name)) {
          this.failOpenTools(conv, turn, `the response was truncated (${name})`);
          this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'opencode' } });
          turn.settle('done');
          break;
        }
        this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'opencode' } });
        turn.fail(new Error(message));
        break;
      }

      case 'session.idle':
        turn.settle('done');
        break;

      default:
        break;
    }
  }

  /**
   * Turn one part update into harness events.
   *
   * `part.text` is CUMULATIVE — each update carries the whole text so far — so
   * a delta is the suffix beyond what we last saw for that part id. Emitting
   * the field verbatim would replay the entire message on every frame.
   */
  private handlePart(conv: ConversationState, turn: TurnState, part: Record<string, unknown>): void {
    const partId = typeof part['id'] === 'string' ? part['id'] : '';
    const type = part['type'];

    if (type === 'text') {
      const full = typeof part['text'] === 'string' ? part['text'] : '';
      const seen = turn.partText.get(partId) ?? '';
      if (full.length > seen.length && full.startsWith(seen)) {
        const delta = full.slice(seen.length);
        turn.partText.set(partId, full);
        turn.text += delta;
        this.broadcast(conv, { kind: 'harness.token', data: { text: delta } });
      } else if (full !== seen) {
        // A rewritten part (a retry, a correction): replace rather than append,
        // and do not emit a token for text the client has already been shown.
        turn.partText.set(partId, full);
      }
      return;
    }

    if (type === 'tool') {
      const state = part['state'] as { status?: string; input?: unknown; output?: string; error?: string } | undefined;
      const callId = typeof part['callID'] === 'string' ? part['callID'] : partId;
      const tool = typeof part['tool'] === 'string' ? part['tool'] : 'tool';
      switch (state?.status) {
        case 'running':
          if (!turn.openTools.has(callId)) {
            turn.openTools.add(callId);
            this.broadcast(conv, {
              kind: 'harness.tool_start',
              data: { tool, args: state.input ?? {}, callId },
            });
          }
          break;
        case 'completed':
          // Emitted whether or not a `running` frame was seen: a fast tool can
          // go straight to `completed`, and swallowing its result because no
          // start was observed loses the tool call entirely.
          turn.openTools.delete(callId);
          this.broadcast(conv, {
            kind: 'harness.tool_complete',
            data: { tool, result: state.output ?? '', callId, success: true },
          });
          break;
        case 'error':
          turn.openTools.delete(callId);
          this.broadcast(conv, {
            kind: 'harness.tool_complete',
            data: { tool, result: state.error ?? '', callId, success: false },
          });
          break;
        default:
          break;
      }
    }
  }

  /** W13/B1 — fail every tool call still open, with the reason. */
  private failOpenTools(conv: ConversationState, turn: TurnState, why: string): void {
    for (const callId of turn.openTools) {
      this.broadcast(conv, {
        kind: 'harness.tool_complete',
        data: {
          tool: callId,
          result:
            `Tool call cancelled: ${why}. All tool calls in this batch are cancelled. ` +
            `Please re-issue your request.`,
          callId,
          success: false,
        },
      });
    }
    turn.openTools.clear();
  }

  private failAllTurns(err: Error): void {
    for (const conv of this.conversations.values()) conv.turn?.fail(err);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private broadcast(conv: ConversationState, event: AgentEvent): void {
    for (const h of conv.listeners) h(event);
  }

  /** Substitute `{sessionID}`-style parameters into a generated path template. */
  private route(template: string, params: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
      params[key] === undefined ? whole : encodeURIComponent(params[key]!),
    );
  }

  private extractSystemPrompt(params: CreateConversationParams): string | undefined {
    // `systemMessage` is a `SystemMessageConfig` ({ mode, content }); the wire
    // carries a single `system` string on each prompt, so `mode` has no
    // representation and both modes send the same text.
    return params.systemMessage?.content ?? params.systemPromptAppend;
  }

  /**
   * One HTTP call against `opencode serve`.
   *
   * `directory` is appended as the `?directory=` query parameter every
   * endpoint in the pinned OpenAPI document accepts; it is what makes one
   * shared server usable by chats rooted in different projects.
   */
  private async fetch(path: string, init?: RequestInit, directory?: string): Promise<Response> {
    if (!this.baseUrl) throw new Error('OpenCodeProvider: no base URL — call initialize() first.');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.opts.authToken) {
      // A bare token with no scheme is rejected (or worse, ignored) by every
      // conformant server. Only add `Bearer ` when the caller has not already
      // supplied a scheme of their own.
      headers['Authorization'] = /^\S+\s/.test(this.opts.authToken)
        ? this.opts.authToken
        : `Bearer ${this.opts.authToken}`;
    }
    // The event stream passes its own long-lived `signal` and manages its own
    // idle deadline; everything else is bounded here, because a hung
    // `opencode serve` must not be able to stall the caller — least of all
    // `initialize()`, which sits on the harness bring-up path.
    const signal = init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs);
    const url = directory
      ? `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`
      : `${this.baseUrl}${path}`;
    return globalThis.fetch(url, {
      ...init,
      signal,
      headers: { ...headers, ...((init?.headers ?? {}) as Record<string, string>) },
    });
  }
}
