// ────────────────────────────────────────────────────────────────
// AcpProvider — IAgentHarness wrapping ACP-compliant agents.
//
// W39 (was W11) — ACP breadth client. Speaks the REAL Agent Client Protocol
// (ACP) — JSON-RPC 2.0 over the stdio of a spawned agent process, via
// `@agentclientprotocol/sdk` — to any compliant agent (Gemini CLI, Goose,
// etc.).
//
// Corrected 2026-08-26: the previous version of this file invented its own
// HTTP+SSE REST API (`POST /runs`, `POST /runs/:id/messages`, an SSE body
// with `data: {...}` chunks) and called it "ACP". There is no HTTP or
// WebSocket transport in the real spec — every ACP agent is a subprocess an
// editor spawns and talks to over stdin/stdout, exactly like Codex's
// `app-server` (see `CodexProvider.ts`). That fabricated API, its
// hand-written schema (`protocol/acp.generated.ts`, `schemas/acp/acp-schema.json`),
// and this file are replaced with the real thing.
//
// Scope: long-tail agents only — not Claude, Copilot, Codex or OpenCode
// (those have dedicated, higher-fidelity providers).
//
// Architecture laws honoured:
//   L9:  capabilities() declared, fail-closed defaults.
//   L16: Tier-B sessions are host-gated — computer use and unrestricted
//        shell are denied regardless of what the agent's own permission
//        model says. This is IN-PROCESS defense-in-depth (the ACP
//        `session/request_permission` request is intercepted and denied
//        before the agent's own answer is ever consulted); it is not a
//        substitute for the PTY/Browser/CUA host-boundary enforcement the
//        plan also calls for, which depends on those hosts being the live
//        path (tracked separately — see the "native host wiring" item).
//   W13: Semantic cancellation — `session/cancel` surfaces as
//        `harness.cancelled`, not a throw or a generic error.
//
// Protocol: real ACP, version `acp.PROTOCOL_VERSION` (an integer bumped only
// on breaking changes; see `@agentclientprotocol/sdk`). Transport: JSON-RPC
// 2.0 newline-delimited over the spawned agent's stdio.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
// ── W41 — the ACP SDK is resolved on FIRST USE, not at module load ──
//
// This was `import * as acp from '@agentclientprotocol/sdk'` — a namespace
// VALUE import, so every consumer that touched this module (the package barrel
// did, eagerly, and `HarnessFactory` still does) pulled the whole ACP SDK into
// the process at boot. `import type * as` keeps every type reference below
// working and is erased entirely by the compiler.
import type * as acp from '@agentclientprotocol/sdk';
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
import type { AcpProviderOptions } from '../../types.js';

// ── W41 — lazy SDK module singleton ──────────────────────────────

// `import type * as` — erased at compile time, so the SDK is still only
// loaded by the dynamic `import()` below (W41). The inline `typeof import()`
// form this replaces is what `consistent-type-imports` forbids.
import type * as AcpSdkNs from '@agentclientprotocol/sdk';
type AcpSdk = typeof AcpSdkNs;

let acpSdk: AcpSdk | null = null;
let acpSdkLoading: Promise<AcpSdk> | null = null;

/** Resolve `@agentclientprotocol/sdk` on first use. */
async function loadAcpSdk(): Promise<AcpSdk> {
  if (acpSdk) return acpSdk;
  acpSdkLoading ??= import('@agentclientprotocol/sdk')
    .then((mod) => {
      acpSdk = mod;
      return mod;
    })
    .catch((err: unknown) => {
      acpSdkLoading = null;
      throw err;
    });
  return acpSdkLoading;
}

/**
 * The already-loaded SDK, for the synchronous paths.
 *
 * Every caller of this runs only after `initialize()` has completed a
 * handshake, which cannot happen without the SDK — so reaching here with a
 * null module is a programming error, and says so rather than reading
 * `undefined.methods` three frames later.
 */
function acpRuntime(): AcpSdk {
  if (!acpSdk) {
    throw new Error('AcpProvider: ACP SDK used before initialize() loaded it');
  }
  return acpSdk;
}

/** W41 — test seam: has the SDK been pulled into this process yet? */
export function isAcpSdkLoaded(): boolean {
  return acpSdk !== null;
}

// ── Type aliases ─────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

interface ConversationState {
  session: acp.ActiveSession | null;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
}

/**
 * L16 — tool kinds a Tier-B agent is PERMITTED to request, as a frozen
 * opt-in set. Everything else is denied.
 *
 * This replaces a substring denylist (`'computer-use'`, `'screen'`, `'mouse'`…)
 * matched against `title`/`name`. That gate failed OPEN in two independent
 * ways, and both are reachable by an untrusted agent by construction:
 *
 *  1. `title` and `name` are MODEL-CONTROLLED free text. An agent that wants
 *     its shell call approved simply does not put "screen" in the title.
 *  2. Everything the denylist did not name fell through to the default-approve
 *     branch at the bottom of `handleRequestPermission` — so `edit`, `delete`,
 *     `move` and `fetch` were all auto-approved for a Tier-B agent that the
 *     class header describes as untrusted. A file delete was one un-listed
 *     keyword away from running unattended.
 *
 * The plan's rule is opt-in frozensets, never negations, denied by default.
 * Only kinds that cannot mutate the workspace or reach the network are listed;
 * an absent, null or unrecognised kind is denied precisely because it is
 * unrecognised. `ToolKind` is an open union in ACP v2 (`| string`), so an
 * allowlist is also the only shape that stays correct as the vocabulary grows.
 */
const TIER_B_ALLOWED_KINDS: ReadonlySet<string> = new Set<acp.ToolKind>([
  'read',   // read a file the agent was already given a cwd for
  'search', // grep/glob within that cwd
  'think',  // no side effects at all
]);

/** True when a Tier-B agent may NOT make this call. Denied unless allowed. */
function isTierBBlocked(toolCall: { kind?: acp.ToolKind | null }): boolean {
  return !toolCall.kind || !TIER_B_ALLOWED_KINDS.has(toolCall.kind);
}

/** First permission option matching one of `kinds`, in priority order. */
function findOption(
  options: acp.PermissionOption[],
  kinds: readonly acp.PermissionOptionKind[],
): acp.PermissionOption | undefined {
  for (const kind of kinds) {
    const found = options.find((o) => o.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/** Extract plain text from an ACP content block, or '' for non-text blocks. */
function textOf(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : '';
}

/**
 * Deadline for `initialize`, `session/new` and `session/close`.
 *
 * A spawned agent that reads our request and simply never answers is
 * indistinguishable from a slow one at the protocol level, and `initialize()`
 * sits on the harness bring-up path — an unbounded wait there stalls boot.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Deadline for a domain permission decision. Deliberately long: a human may be
 * on the other end. It exists so an approver who never answers eventually
 * denies rather than pinning the agent's open JSON-RPC request forever.
 */
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;

// ── AcpProvider ──────────────────────────────────────────────────

/**
 * W39 — IAgentHarness backed by any real ACP-compliant agent process.
 *
 * Lifecycle:
 *   1. `initialize()` spawns the agent binary, wraps its stdio in an ACP
 *      `Stream`, and sends `initialize` to negotiate the protocol version.
 *   2. `createConversation()` calls `session/new` (via the SDK's
 *      `buildSession(cwd).start()`), returning a long-lived `ActiveSession`.
 *   3. `sendPromptAndWait()` calls `session.prompt(...)` and drains
 *      `session.nextUpdate()` until the turn stops, translating each
 *      `session/update` notification into an `AgentEvent`.
 *   4. `abortConversation()` sends the `session/cancel` notification.
 *   5. `shutdown()` closes the ACP connection and kills the agent process.
 */
export class AcpProvider implements IAgentHarness {
  private readonly opts: AcpProviderOptions;
  private proc: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private clientState: HarnessClientState = 'starting';
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private conversations = new Map<string, ConversationState>();
  /** Protocol version the agent actually confirmed in its InitializeResponse. */
  // W41 — set from the loaded SDK in `initialize()`; the SDK is no longer
  // available at field-initialiser time (it is imported dynamically).
  private negotiatedVersion: acp.ProtocolVersion | undefined;
  /** True once we have asked the agent to exit, so its exit is not an error. */
  private stopping = false;

  constructor(opts: AcpProviderOptions) {
    this.opts = opts;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const bin = this.opts.command;
    this.stopping = false;

    // Same ENOENT-safe spawn pattern as CodexProvider: the 'error' event
    // fires on next tick, ahead of setImmediate, so a missing binary rejects
    // initialize() instead of leaving the provider silently half-started.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, this.opts.args ?? [], {
        cwd: this.opts.defaultCwd ?? process.cwd(),
        // The agent executes model-authored tool calls, so it gets the
        // allowlisted harness environment, never the full parent env — same
        // rule `childEnv.ts` enforces for every other spawned provider.
        env: buildHarnessEnv({ extra: this.opts.env }),
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      this.proc = proc;

      proc.once('error', (err) => {
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `ACP agent binary "${bin}" not found. Install it and ensure it is on PATH, or set AcpProviderOptions.command to an absolute path.`
          : err.message;
        this.clientState = 'error';
        for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: msg } });
        reject(new Error(msg));
      });

      proc.on('exit', (code, sig) => {
        // `kill('SIGTERM')` yields `code === null`, so keying purely off
        // `code === 0` reported every ORDERLY shutdown as a provider failure:
        // `shutdown()` set 'stopped', this handler immediately flipped it back
        // to 'error', and every listener got a spurious `client.error`.
        const clean = this.stopping || code === 0;
        this.clientState = clean ? 'stopped' : 'error';
        for (const h of this.clientEventListeners) {
          h({
            type: clean ? 'client.stopped' : 'client.error',
            data: clean
              ? undefined
              : { message: sig ? `ACP agent exited on signal ${sig}` : `ACP agent exited with code ${code}` },
          });
        }
      });

      setImmediate(resolve);
    });

    const proc = this.proc!;
    // W41 — first use of the ACP SDK in this process.
    const sdk = await loadAcpSdk();
    this.negotiatedVersion = sdk.PROTOCOL_VERSION;
    const stream = sdk.ndJsonStream(
      Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
    );

    const clientApp = sdk
      .client({ name: 'GeneratorAI' })
      // L16 host gate + (when the caller supplies one) the domain
      // `onPermissionRequest` callback — see `handleRequestPermission`.
      .onRequest(sdk.methods.client.session.requestPermission, (ctx) =>
        this.handleRequestPermission(ctx.params),
      );

    this.connection = clientApp.connect(stream);

    try {
      // Bounded: an agent that reads the handshake and never answers used to
      // hang harness bring-up forever, with no error and no log.
      const initResult = await this.withDeadline(
        this.connection.agent.request(sdk.methods.agent.initialize, {
        protocolVersion: sdk.PROTOCOL_VERSION,
        // L9: declare only what we actually serve. We register no
        // `fs/*`/`terminal/*` handlers, so both stay false — an agent that
        // calls them anyway gets the SDK's own "Method not found" (-32601),
        // which is the honest answer, not a stub that pretends to comply.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'GeneratorAI', version: '2.0.0' },
        }),
        this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        `ACP initialize handshake with "${bin}"`,
      );
      this.negotiatedVersion = initResult.protocolVersion;
      if (this.negotiatedVersion !== sdk.PROTOCOL_VERSION) {
        // Per spec: "The client should disconnect if it doesn't support this
        // version." This SDK build only implements acp.PROTOCOL_VERSION.
        throw new Error(
          `AcpProvider: agent negotiated protocol version ${this.negotiatedVersion}, ` +
          `but this build only supports ${sdk.PROTOCOL_VERSION}.`,
        );
      }
    } catch (err) {
      this.clientState = 'error';
      // A failed handshake used to leave `connection` and `proc` non-null with
      // their listeners still attached, so the caller held a provider that
      // looked half-alive: `ping()` could still say true, `shutdown()` would
      // "work" on a connection already closed, and a retried `initialize()`
      // silently orphaned the first child. Tear the whole thing down.
      this.stopping = true;
      try { this.connection.close(err); } catch { /* already closing */ }
      this.connection = null;
      const proc = this.proc;
      this.proc = null;
      proc?.removeAllListeners('exit');
      proc?.kill('SIGTERM');
      throw new Error(`AcpProvider: failed to initialize ACP agent "${bin}": ${String(err)}`);
    }

    this.clientState = 'running';
  }

  /**
   * Reject `promise` if it has not settled within `ms`.
   *
   * ACP requests are held open by the peer, not by us: nothing in the SDK
   * bounds a request whose agent simply never replies, so every request we
   * make on a critical path carries its own deadline.
   */
  private async withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    if (ms <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`AcpProvider: ${what} timed out after ${ms} ms`)), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(): Promise<void> { await this.shutdown(); }
  async forceStop(): Promise<void> {
    this.stopping = true;
    this.connection?.close();
    this.connection = null;
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.clientState = 'stopped';
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.connection?.close();
    this.connection = null;
    this.proc?.kill('SIGTERM');
    this.proc = null;
    this.clientState = 'stopped';
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    return this.clientState === 'running' && this.proc != null && !this.proc.killed;
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
      skills: 'none',
      // `session/request_permission` reaches the session's gate per call
      // (Tier-B additionally denies `execute`-kind calls at the boundary).
      approvalGating: 'per_call',
      hostTools: 'none',
      structuredOutput: 'none',
      sessionPersistence: false,
      budgetTracking: false,
      // ACP has no dedicated GUI/computer-use surface, and Tier-B blocks
      // `execute`-kind tool calls outright regardless — declared explicitly
      // (required by runCapabilityDeclarationConformance's L9 check) rather
      // than left undefined.
      computerUse: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    // ACP does not define a model catalog method. The model is configured
    // on the agent's side (or via `providers/*`, which is agent-specific),
    // not picked here.
    return [];
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    if (!this.connection) throw new Error('AcpProvider: not initialized (call initialize() first)');

    const warnings: ConversationWarning[] = [];
    if (this.opts.tierB ?? true) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { capability: 'computer-use, unrestricted shell', reason: 'Tier-B ACP agents cannot use this capability (L16 host gate)' },
      });
    }

    // The chat's other mounts and its managed workspace root. ACP models this
    // natively (`NewSessionRequest.additionalDirectories`, protocol
    // `acp.generated.ts`), and the SDK exposes it as
    // `SessionBuilder.withAdditionalDirectories` — so unlike Copilot this
    // provider can widen the session's file-system scope without changing cwd.
    // Agents that do not advertise the capability ignore the field; the
    // `session/new` failure path below already reports a rejection.
    const extraRoots = [...new Set(params.additionalDirectories ?? [])];

    let session: acp.ActiveSession | null = null;
    try {
      const builder = this.connection.agent
        .buildSession(params.workingDirectory ?? this.opts.defaultCwd ?? process.cwd());
      if (extraRoots.length > 0) builder.withAdditionalDirectories(extraRoots);
      session = await this.withDeadline(
        builder.start(),
        this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        'ACP session/new',
      );
    } catch (err) {
      // The agent may not support `session/new` at all, or rejected the cwd.
      // Surface it as a warning rather than throwing — a live conversation
      // record is still useful so the caller can see why every send fails.
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'session/new', reason: `session/new failed: ${String(err)}` },
      });
    }

    this.conversations.set(params.conversationId, {
      session,
      params,
      listeners: new Set(),
      warnings,
      inFlight: false,
    });
    return params.conversationId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
  }

  hasLiveConversation(conversationId: string): boolean {
    const conv = this.conversations.get(conversationId);
    return conv != null && conv.session != null;
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
    if (conv.session && this.connection) {
      conv.session.dispose();
      // Best-effort: not every agent implements session/close.
      try {
        // Bounded, and best-effort: an agent that never answers `session/close`
        // must not be able to block a conversation delete.
        await this.withDeadline(
          this.connection.agent.request(acpRuntime().methods.agent.session.close, {
            sessionId: conv.session.sessionId,
          }),
          this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
          'ACP session/close',
        );
      } catch { /* best effort */ }
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
    // ACP addresses one agent per connection; in-session switching is not supported.
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
    // Fire-and-forget, but never un-caught: `sendPromptAndWait` rejects on
    // several paths (no conversation, no live session, turn already in flight,
    // agent error) and an unhandled rejection can take the process down.
    void this.sendPromptAndWait(conversationId, prompt, attachments).catch((err: unknown) => {
      const conv = this.conversations.get(conversationId);
      const message = err instanceof Error ? err.message : String(err);
      if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'acp' } });
      this.opts.logger?.warn?.(`[AcpProvider] sendPrompt("${conversationId}") failed: ${message}`);
    });
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
    if (!conv.session) throw new Error(`AcpProvider: conversation "${conversationId}" has no live ACP session (see getConversationWarnings)`);
    if (conv.inFlight) throw new Error(`AcpProvider: conversation "${conversationId}" already has a turn in flight`);

    // A signal that is ALREADY aborted must not start a turn. Nothing checked
    // this, so a caller whose run had been cancelled before the stage reached
    // the provider still sent the prompt, paid for it, and only discovered the
    // cancellation once the agent answered.
    if (signal?.aborted) {
      this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
      return { content: '' };
    }

    conv.inFlight = true;
    const session = conv.session;
    let assistantText = '';
    /** Tool calls announced but not yet resolved — see the W13-B1 guard below. */
    const openToolCallIds = new Set<string>();

    const onAbort = () => {
      void this.connection?.agent
        .notify(acpRuntime().methods.agent.session.cancel, { sessionId: session.sessionId })
        .catch(() => { /* best effort */ });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      // `prompt(...)` resolves when the turn ends, but the SAME completion
      // is also queued as a `stop` message for `nextUpdate()` — draining
      // that queue is what lets us stream tokens AS they arrive instead of
      // only seeing the final text after the whole turn finishes. A request
      // failure rejects BOTH `promptPromise` and the update queue (the SDK's
      // `ActiveSession.prompt()` routes its own rejection into
      // `updates.reject(...)`), so `nextUpdate()` below throws first in the
      // normal case; the no-op `.catch` here only stops Node from flagging
      // `promptPromise` itself as an unhandled rejection when that happens —
      // the real error still surfaces from the `await promptPromise` after
      // the loop (or from the loop's own throw, whichever runs first).
      const promptPromise = session.prompt(prompt);
      promptPromise.catch(() => { /* see comment above */ });

      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === 'stop') {
          if (message.stopReason === 'cancelled') {
            this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
          } else {
            // W13-B1 — ACP's `StopReason` includes `max_tokens`, and this
            // provider had no guard for it: a turn cut off mid-tool-call
            // emitted `harness.idle` and left every open call dangling, so the
            // agent waited forever for a result and the caller saw a clean
            // "done". Fail them, exactly as Codex/OpenCode/Claude do.
            if (message.stopReason === 'max_tokens') {
              for (const callId of openToolCallIds) {
                this.broadcast(conv, {
                  kind: 'harness.tool_complete',
                  data: {
                    tool: callId,
                    result: `Response was truncated (stopReason: ${message.stopReason}). All tool calls in this batch are cancelled. Please re-issue your request.`,
                    callId,
                    success: false,
                  },
                });
              }
            }
            this.broadcast(conv, { kind: 'harness.idle', data: {} });
          }
          break;
        }
        this.applySessionUpdate(conv, message.update, openToolCallIds);
        if (message.update.sessionUpdate === 'agent_message_chunk') {
          assistantText += textOf(message.update.content);
        }
      }

      await promptPromise;
      return { content: assistantText };
    } catch (err) {
      if (signal?.aborted) {
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
        return { content: assistantText };
      }
      this.broadcast(conv, { kind: 'harness.error', data: { message: String(err), provider: 'acp' } });
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      conv.inFlight = false;
    }
  }

  /** Translate one `session/update` notification into `AgentEvent`(s). */
  private applySessionUpdate(
    conv: ConversationState,
    update: acp.SessionUpdate,
    openToolCallIds: Set<string>,
  ): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = textOf(update.content);
        if (text) this.broadcast(conv, { kind: 'harness.token', data: { text } });
        break;
      }
      case 'agent_thought_chunk': {
        const text = textOf(update.content);
        if (text) this.broadcast(conv, { kind: 'harness.reasoning_delta', data: { text } });
        break;
      }
      case 'user_message_chunk':
        break; // Echo of what we sent — nothing new to report.
      case 'tool_call': {
        openToolCallIds.add(update.toolCallId);
        this.broadcast(conv, {
          kind: 'harness.tool_start',
          data: { tool: update.title, args: update.rawInput, callId: update.toolCallId },
        });
        break;
      }
      case 'tool_call_update': {
        if (update.status === 'completed' || update.status === 'failed') {
          // Pruned here so the truncation guard fails only calls still open.
          openToolCallIds.delete(update.toolCallId);
          this.broadcast(conv, {
            kind: 'harness.tool_complete',
            data: {
              tool: update.toolCallId,
              result: update.rawOutput ?? update.content ?? null,
              callId: update.toolCallId,
              success: update.status === 'completed',
            },
          });
        }
        break;
      }
      case 'plan':
      case 'plan_update':
      case 'plan_removed':
        this.broadcast(conv, { kind: 'harness.plan_changed', data: { operation: update.sessionUpdate } });
        break;
      default:
        // available_commands_update / current_mode_update / config_option_update /
        // session_info_update / usage_update / compaction_update /
        // compaction_summary_chunk — informational, preserved for visibility
        // rather than silently dropped.
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: { infoType: update.sessionUpdate, message: `ACP ${update.sessionUpdate}`, raw: update },
        });
        break;
    }
  }

  async getMessages(_conversationId: string): Promise<ConversationMessage[]> {
    // ACP does not expose message history retrieval; return empty.
    return [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv?.session || !conv.inFlight) return;
    // W13: emit harness.cancelled immediately rather than waiting for the
    // agent to acknowledge — the notify below is fire-and-forget by design.
    this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
    void this.connection?.agent
      .notify(acpRuntime().methods.agent.session.cancel, { sessionId: conv.session.sessionId })
      .catch(() => { /* best effort */ });
  }

  // ── Permission gate (L16 Tier-B host gate + domain callback) ──────

  private async handleRequestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    // A throw here escapes as a JSON-RPC internal error (-32603), which is NOT
    // a denial: what the agent does with an errored permission request is the
    // agent's business, and we have just handed an untrusted process a
    // non-answer. A gate that can error is a gate that can fail open, so every
    // path — including a bug in this method — resolves to an explicit reject.
    try {
      return await this.decidePermission(params);
    } catch (err) {
      this.opts.logger?.warn?.(
        `[AcpProvider] permission gate errored for tool "${params.toolCall.title ?? params.toolCall.toolCallId}" — denying (fail-closed): ${String(err)}`,
      );
      return this.rejectOutcome(params);
    }
  }

  /** The reject/cancel outcome for a request, preferring an explicit reject option. */
  private rejectOutcome(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
    const reject = findOption(params.options, ['reject_once', 'reject_always']);
    return reject
      ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  private async decidePermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const conv = [...this.conversations.values()].find((c) => c.session?.sessionId === params.sessionId);
    const tierB = this.opts.tierB ?? true; // fail-closed default

    if (tierB && isTierBBlocked(params.toolCall)) {
      if (conv) {
        this.broadcast(conv, {
          kind: 'harness.tool_complete',
          data: {
            tool: params.toolCall.title ?? params.toolCall.toolCallId,
            result:
              `Tool "${params.toolCall.title ?? params.toolCall.toolCallId}" (kind: ${params.toolCall.kind ?? 'unspecified'}) ` +
              `is blocked for Tier-B ACP agents (L16 host gate). Permitted kinds: ${[...TIER_B_ALLOWED_KINDS].join(', ')}.`,
            callId: params.toolCall.toolCallId,
            success: false,
          },
        });
      }
      return this.rejectOutcome(params);
    }

    const onPermissionRequest = conv?.params.onPermissionRequest;
    if (onPermissionRequest) {
      const kind = params.toolCall.kind;
      const domainType: 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other' =
        kind === 'edit' || kind === 'delete' || kind === 'move' ? 'file_write'
        : kind === 'read' ? 'file_read'
        : kind === 'execute' ? 'shell_exec'
        : kind === 'fetch' ? 'network'
        : 'other';
      // Bounded. The callback may be waiting on a human, so the deadline is
      // generous — but it must exist: the agent's JSON-RPC request is held open
      // for the whole wait, and an approver who never answers otherwise pins
      // that request (and the agent's turn) for the process's lifetime.
      const decision = await this.withDeadline(
        onPermissionRequest({
          type: domainType,
          description: params.toolCall.title ?? `ACP tool call ${params.toolCall.toolCallId}`,
          details: { rawInput: params.toolCall.rawInput },
        }),
        this.opts.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS,
        `permission decision for "${params.toolCall.title ?? params.toolCall.toolCallId}"`,
      );
      const wanted: acp.PermissionOptionKind[] = decision.granted
        ? ['allow_once', 'allow_always']
        : ['reject_once', 'reject_always'];
      const chosen = findOption(params.options, wanted);
      if (chosen) return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
      // No option of the wanted kind exists. `cancelled` is the safe answer
      // either way: it grants nothing.
      return { outcome: { outcome: 'cancelled' } };
    }

    // No domain callback wired. For a NON-Tier-B (trusted) agent the caller has
    // explicitly opted out of the host gate, so approve. A Tier-B agent never
    // reaches here with a disallowed kind — the allowlist above already
    // rejected it — so what is approved is read/search/think only.
    const allow = findOption(params.options, ['allow_once', 'allow_always']);
    return allow
      ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
      : { outcome: { outcome: 'cancelled' } };
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
}
