// ────────────────────────────────────────────────────────────────
// W10 — ACP Inbound Adapter
//
// Exposes GeneratorAI as an ACP *agent* so external ACP-aware editors
// (Zed, JetBrains, Cline, Goose, …) can drive GeneratorAI as a backend.
//
// This file used to hand-roll a JSON-RPC dialect that does not exist:
// string protocol versions ('0.2'/'0.1'), invented methods (`turn`,
// `cancel`, `shutdown`) and an invented outbound `turn/chunk`. A real
// client sends `protocolVersion: 1`, was told `-32001 Unsupported
// protocol version`, and disconnected on the first message. Everything
// below now runs on `@agentclientprotocol/sdk`, which owns the wire
// format, the zod-validated params and the JSON-RPC framing — so the
// dialect cannot drift from the spec again.
//
// Transport: whatever `AgentApp.connect()` is handed. `acp-entry.ts`
// gives it `ndJsonStream(stdout, stdin)`; tests give it a `ClientApp`
// for an in-process connection. The SDK owns all writes, which is why
// there is no hand-rolled writer here any more (see `start()`).
//
// ACP methods served:
//   initialize                — capability negotiation (integer version)
//   session/new               — create a chat + session, subscribe to it
//   session/prompt            — run one turn; resolves with a StopReason
//   session/cancel  (notif.)  — abort the in-flight turn
//   session/close             — end one session, release its resources
//
// Outbound (agent → client):
//   session/update             — streamed chunks, tool calls, thoughts
//   session/request_permission — plan-review gates (PLN-01)
//
// ── Why the streaming used to be dead ──────────────────────────────
// The old code subscribed to the EventBus on a conversationId it
// invented (`acp-${sessionId}-${Date.now()}`). Harness events never
// arrive on that key. `ChatManagementService.sendPrompt` subscribes to
// the harness with `session.conversationId` and re-emits on a DIFFERENT
// id — `chat.sessionId` — and that is the only key `EventBus.subscribe`
// will ever deliver on (it builds the channel as `session:${sessionId}`).
// So the adapter must be told BOTH ids: the chatId it prompts with and
// the sessionId it listens on. `AcpSessionHandle` carries the pair and
// they are deliberately different values, so a test that mixes them up
// observes silence rather than a passing green.
//
// Security note (L16): ACP is Tier-B. Tool gating happens at the host
// boundary (CUA/PTY/Browser) for Tier-B sessions, not at the provider
// gate (which cannot fire on every call for ACP). Concretely, that means
// this adapter NEVER calls the client's `fs/*` or `terminal/*` methods,
// no matter what the client advertises in `clientCapabilities` — see
// `handleInitialize`. Note that `fs`/`terminal` are CLIENT capabilities
// in real ACP; an agent has no way to "advertise fs: false", it can only
// decline to use them, which is what we do.
// ────────────────────────────────────────────────────────────────

/* W10 */

import * as acp from '@agentclientprotocol/sdk';
import type { EventBus } from '@generatorai/core';
import type { PersistedEvent } from '@generatorai/shared';

// ── Harness bridge interface ────────────────────────────────────

/**
 * The two ids a GeneratorAI chat is addressed by, which are NOT the same
 * value and must not be conflated.
 *
 * `ChatManagementService.createChat` mints `chatId`, `sessionId` and
 * `conversationId` independently; prompts are addressed by chatId while
 * events are published on sessionId.
 */
export interface AcpSessionHandle {
  /** Id accepted by `sendPrompt` / `cancelTurn` / `releaseSession`. */
  chatId: string;
  /** EventBus channel key — the ONLY id `EventBus.subscribe` delivers on. */
  eventSessionId: string;
}

/** How a plan-review gate was resolved by the ACP client. */
export interface AcpPlanDecision {
  approved: boolean;
  /** One of the `actions` the gate advertised, when approved. */
  action?: string;
}

/**
 * Minimal service interface the adapter needs.
 *
 * Deliberately expressed as a port rather than importing
 * `ChatManagementService`: `acp-entry.ts` builds it over the container so
 * the ACP path uses the SAME service the HTTP path uses, and the adapter
 * stays unit-testable without a database.
 */
export interface AcpHarnessBridge {
  /** Create a chat + session. Returns both ids. */
  createSession(params: {
    /** Absolute cwd from `session/new`. */
    cwd: string;
    /** Extra workspace roots the client asked for. */
    additionalDirectories?: string[];
  }): Promise<AcpSessionHandle>;

  /** Send one user turn. Resolves once accepted; the turn ends via events. */
  sendPrompt(chatId: string, text: string): Promise<void>;

  /** Abort the in-flight turn. */
  cancelTurn(chatId: string): Promise<void>;

  /**
   * Release a finished session's runtime resources — must call
   * `harness.deleteConversation` so the SDK conversation does not leak for
   * the lifetime of the process.
   */
  releaseSession(handle: AcpSessionHandle): Promise<void>;

  /**
   * Resolve an open plan-review gate. Optional because plan mode depends on
   * `planService` + `agentInteractionService`, both of which are
   * `| undefined` on the container. When absent the adapter does not raise
   * a permission request at all, rather than raising one nobody can answer.
   */
  decidePlan?(chatId: string, planId: string, decision: AcpPlanDecision): Promise<void>;
}

// ── Session state ───────────────────────────────────────────────

/** One in-flight `session/prompt`. */
interface ActiveTurn {
  resolve: (response: acp.PromptResponse) => void;
  reject: (err: unknown) => void;
  /** Set once `session/cancel` (or an abort signal) has been honoured. */
  cancelRequested: boolean;
  /** Latest `harness.usage` seen this turn, reported on the PromptResponse. */
  usage: acp.Usage | undefined;
  /**
   * A turn's text arrives twice: as `harness.token` deltas AND as a final
   * `harness.message_complete` carrying the whole segment. Forwarding both
   * doubles every message in the client. Track which we saw so the complete
   * event is only used when the provider streamed no deltas.
   */
  sawToken: boolean;
  /** Same duplication problem for `reasoning_delta` vs `reasoning_complete`. */
  sawThought: boolean;
}

interface AcpSession {
  handle: AcpSessionHandle;
  /** EventBus unsubscribe callback. */
  unsubscribe: () => void;
  turn: ActiveTurn | null;
  /**
   * Serializes outbound `session/update` notifications.
   *
   * EventBus handlers are synchronous but `ctx.notify()` is async, so without
   * a queue two events emitted back-to-back could be written out of order.
   * Awaiting each notify is also how write backpressure is honoured: the
   * SDK's stream writer resolves only once the chunk is accepted.
   */
  outbound: Promise<void>;
}

// ── AgentEvent → ACP mapping helpers ────────────────────────────

/**
 * Best-effort `ToolKind` for a GeneratorAI tool name.
 *
 * ACP uses this only to pick an icon, so an unknown tool degrading to
 * 'other' is correct behaviour, not a gap.
 */
function toolKindFor(tool: string): acp.ToolKind {
  const name = tool.toLowerCase();
  if (name.includes('read') || name.includes('notebookread')) return 'read';
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit';
  if (name.includes('bash') || name.includes('shell') || name.includes('exec') || name.includes('terminal')) {
    return 'execute';
  }
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('find')) {
    return 'search';
  }
  if (name.includes('fetch') || name.includes('websearch') || name.includes('browser')) return 'fetch';
  if (name.includes('think') || name.includes('todo') || name.includes('plan')) return 'think';
  return 'other';
}

/**
 * Flatten a `session/prompt` content array into the plain string the harness
 * takes.
 *
 * ACP requires an agent to handle `text` and `resource_link` as a baseline;
 * everything else is opt-in via `promptCapabilities`, which we advertise as
 * off, so anything else arriving is a client bug and is skipped rather than
 * silently mangled into the prompt.
 */
function textFromPrompt(blocks: acp.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'resource_link') parts.push(`@${block.uri}`);
  }
  return parts.join('\n');
}

/** Human label for a `PlanAction` id advertised on a plan-review gate. */
const PLAN_ACTION_LABELS: Record<string, string> = {
  exit_only: 'Approve plan, stop here',
  implement_interactive: 'Approve and implement (interactive)',
  implement_autopilot: 'Approve and implement (autopilot)',
};

/** Option id used for the reject choice we always add to a plan gate. */
const PLAN_REJECT_OPTION_ID = 'reject';

// ── Adapter ─────────────────────────────────────────────────────

export interface AcpInboundAdapterOptions {
  bridge: AcpHarnessBridge;
  eventBus: EventBus;
  /** `agentInfo.name` in the initialize response. */
  agentName?: string;
  /** `agentInfo.version` in the initialize response. */
  agentVersion?: string;
  /** Diagnostics sink. Defaults to stderr — stdout is the ACP wire. */
  onDiagnostic?: (message: string) => void;
}

/**
 * Serves ONE ACP connection.
 *
 * That is not a limitation being papered over: the ACP stdio contract is one
 * agent process per client, so `start()` being idempotent and `stop()` tearing
 * everything down is the whole lifecycle.
 */
export class AcpInboundAdapter {
  /* W10 */
  private readonly bridge: AcpHarnessBridge;
  private readonly eventBus: EventBus;
  private readonly agentName: string;
  private readonly agentVersion: string;
  private readonly onDiagnostic: (message: string) => void;

  /** ACP sessionId (== chatId) → session state. */
  private readonly sessions = new Map<string, AcpSession>();

  private readonly app: acp.AgentApp;

  private connection: acp.AgentConnection | null = null;

  /** Whether `initialize` has completed. */
  private initialized = false;

  constructor(opts: AcpInboundAdapterOptions) {
    this.bridge = opts.bridge;
    this.eventBus = opts.eventBus;
    this.agentName = opts.agentName ?? 'GeneratorAI';
    this.agentVersion = opts.agentVersion ?? '0.1.0';
    this.onDiagnostic =
      opts.onDiagnostic ?? ((message) => process.stderr.write(`[acp] ${message}\n`));

    this.app = acp
      .agent({ name: this.agentName })
      .onRequest(acp.methods.agent.initialize, (ctx) => this.handleInitialize(ctx.params))
      .onRequest(acp.methods.agent.session.new, (ctx) => this.handleNewSession(ctx.params))
      .onRequest(acp.methods.agent.session.prompt, (ctx) =>
        this.handlePrompt(ctx.params, ctx.signal),
      )
      .onRequest(acp.methods.agent.session.close, (ctx) => this.handleCloseSession(ctx.params))
      .onNotification(acp.methods.agent.session.cancel, (ctx) => this.handleCancel(ctx.params));
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /**
   * Connect to a transport (`ndJsonStream(...)`) or, for tests, directly to a
   * `ClientApp`.
   *
   * Idempotent: a second call returns the existing connection instead of
   * opening a second one against the same stdio pair, which previously
   * produced two readers racing over one stdin.
   *
   * The SDK owns every byte written from here on. There is no hand-rolled
   * `out.write()` (and therefore no discarded backpressure and no bare
   * `catch {}` swallowing EPIPE): outbound notifications are awaited through
   * `session.outbound`, and a broken pipe rejects that await, which `enqueue`
   * reports and turns into a failed turn instead of dropping.
   */
  start(target: acp.Stream | acp.ClientApp): acp.AgentConnection {
    if (this.connection) return this.connection;

    // `connect` is overloaded rather than union-typed, so TS cannot resolve it
    // against a union argument. Both overloads accept this value at runtime.
    const connection = this.app.connect(target as acp.Stream);
    this.connection = connection;

    // Client disconnect (stdin EOF, editor exit, transport error) must release
    // every session — the old adapter only cleaned up at process exit, so a
    // long-lived host leaked an EventBus subscription and an SDK conversation
    // per session forever.
    void connection.closed
      .catch(() => undefined)
      .then(() => {
        void this.releaseAllSessions('client disconnected');
      });

    return connection;
  }

  /** Close the connection and release every session. Idempotent. */
  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.initialized = false;
    await this.releaseAllSessions('adapter stopped');
    connection?.close();
  }

  /** Live ACP session count. Exposed for tests and health checks. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ── Method handlers ──────────────────────────────────────────

  private handleInitialize(params: acp.InitializeRequest): acp.InitializeResponse {
    // ACP does NOT negotiate by rejection. The spec is explicit: respond with
    // the client's version when supported, otherwise with the latest version
    // this agent speaks, and let the CLIENT decide whether to disconnect.
    // Returning an error here (as the old `-32001` did) breaks every real
    // client on its very first message.
    if (params.protocolVersion !== acp.PROTOCOL_VERSION) {
      this.onDiagnostic(
        `client requested protocol version ${params.protocolVersion}; responding with ${acp.PROTOCOL_VERSION}`,
      );
    }

    // L16 Tier-B: the client may well advertise `fs` and `terminal`. We record
    // that it did and then never call those methods — file and terminal access
    // for an ACP session is gated at the host boundary (PTY/Browser/CUA), not
    // proxied back through the editor where nothing can gate it.
    if (params.clientCapabilities?.fs || params.clientCapabilities?.terminal) {
      this.onDiagnostic(
        'client advertises fs/terminal; ACP sessions are Tier-B (L16) and never use them',
      );
    }

    this.initialized = true;

    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: this.agentName, version: this.agentVersion },
      agentCapabilities: {
        // `session/load` would have to rebuild a full transcript as replayed
        // session/update notifications. Not implemented, so not advertised.
        loadSession: false,
        // Text and resource_link are the ACP baseline and need no capability.
        // Everything below is opt-in and genuinely unsupported by this path.
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
    };
  }

  private async handleNewSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.requireInitialized();

    const handle = await this.bridge.createSession({
      cwd: params.cwd,
      ...(params.additionalDirectories?.length
        ? { additionalDirectories: params.additionalDirectories }
        : {}),
    });

    // Subscribe on the EVENT session id, not the chat id. This is the line the
    // old adapter got wrong; everything else about streaming was downstream of
    // it. See the file header.
    const unsubscribe = this.eventBus.subscribe(
      handle.eventSessionId,
      (event: PersistedEvent) => this.onSessionEvent(handle.chatId, event),
      `acp-inbound:${handle.chatId}`,
    );

    this.sessions.set(handle.chatId, {
      handle,
      unsubscribe,
      turn: null,
      outbound: Promise.resolve(),
    });

    // The ACP sessionId IS the chatId, so an operator can find the transcript
    // for any ACP session by id without a translation table.
    return { sessionId: handle.chatId };
  }

  private async handlePrompt(
    params: acp.PromptRequest,
    signal: AbortSignal,
  ): Promise<acp.PromptResponse> {
    this.requireInitialized();
    const session = this.requireSession(params.sessionId);

    if (session.turn) {
      throw new acp.RequestError(
        -32000,
        `A turn is already in progress for session ${params.sessionId}`,
      );
    }

    const text = textFromPrompt(params.prompt);
    if (!text.trim()) {
      throw acp.RequestError.invalidParams(
        undefined,
        'prompt contained no text or resource_link content',
      );
    }

    // The turn ends when the harness says so, not when sendPrompt resolves —
    // sendPrompt only means "accepted". `harness.idle` / `harness.cancelled` /
    // `harness.error` settle this deferred from `onSessionEvent`.
    const result = new Promise<acp.PromptResponse>((resolve, reject) => {
      session.turn = {
        resolve,
        reject,
        cancelRequested: false,
        usage: undefined,
        sawToken: false,
        sawThought: false,
      };
    });
    // The `await result` below is the only consumer, and the sendPrompt-failure
    // path throws before reaching it. Without this the rejection we raise there
    // would surface as an unhandled rejection and kill the host process.
    void result.catch(() => undefined);

    // A client that drops the request (or the whole connection) mid-turn must
    // not leave the harness generating into a void.
    const onAbort = (): void => {
      void this.cancelTurn(session, 'request aborted');
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await this.bridge.sendPrompt(session.handle.chatId, text);
    } catch (err) {
      const message = `sendPrompt failed: ${err instanceof Error ? err.message : String(err)}`;
      this.failTurn(session, message);
      signal.removeEventListener('abort', onAbort);
      throw new acp.RequestError(-32000, message);
    }

    try {
      return await result;
    } finally {
      signal.removeEventListener('abort', onAbort);
      session.turn = null;
    }
  }

  /**
   * `session/cancel` is a NOTIFICATION. JSON-RPC 2.0 forbids any response to
   * it — the old adapter replied with `id: null`, which is a malformed
   * response object that a strict client rejects. Returning void here is the
   * whole fix; the SDK writes nothing back.
   */
  private async handleCancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;
    await this.cancelTurn(session, 'session/cancel');
  }

  private async handleCloseSession(params: acp.CloseSessionRequest): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;
    await this.releaseSession(session, 'session/close');
  }

  // ── Turn control ─────────────────────────────────────────────

  private async cancelTurn(session: AcpSession, reason: string): Promise<void> {
    const turn = session.turn;
    if (!turn || turn.cancelRequested) return;
    turn.cancelRequested = true;

    try {
      await this.bridge.cancelTurn(session.handle.chatId);
      // Do NOT settle here. ACP says a client keeps accepting updates after a
      // cancel, and the harness still emits its trailing events before going
      // idle; `onSessionEvent` turns that idle into `stopReason: 'cancelled'`
      // because `cancelRequested` is set.
    } catch (err) {
      // The abort never reached the harness, so no terminal event is coming.
      // Settle now rather than hanging the client's `session/prompt` forever.
      this.onDiagnostic(
        `cancelTurn(${reason}) failed for ${session.handle.chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.settleTurn(session, { stopReason: 'cancelled' });
    }
  }

  /** Resolve (or drop) the in-flight turn exactly once. */
  private settleTurn(session: AcpSession, response: acp.PromptResponse | null): void {
    const turn = session.turn;
    if (!turn) return;
    session.turn = null;
    if (!response) return;
    turn.resolve(turn.usage ? { ...response, usage: turn.usage } : response);
  }

  /** Fail the in-flight turn with a JSON-RPC error. */
  private failTurn(session: AcpSession, message: string): void {
    const turn = session.turn;
    if (!turn) return;
    session.turn = null;
    turn.reject(new acp.RequestError(-32000, message));
  }

  // ── AgentEvent → session/update ──────────────────────────────

  /**
   * EventBus handler. Must stay synchronous (that is the bus contract), so all
   * async work is chained onto `session.outbound`, which both preserves
   * ordering and applies backpressure.
   */
  private onSessionEvent(chatId: string, event: PersistedEvent): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const kind = event.kind as string;
    const data = (event.data ?? {}) as Record<string, unknown>;

    // Terminal + bookkeeping events are handled synchronously so a turn is
    // never settled out of order with respect to the queue draining.
    switch (kind) {
      case 'harness.usage': {
        /* W10 */
        if (session.turn) {
          const inputTokens = Number(data['inputTokens'] ?? 0);
          const outputTokens = Number(data['outputTokens'] ?? 0);
          session.turn.usage = {
            totalTokens: inputTokens + outputTokens,
            inputTokens,
            outputTokens,
          };
        }
        return;
      }

      // Terminal events go through the SAME outbound queue as the chunks, so
      // the `session/prompt` response can never overtake the trailing
      // `session/update` notifications of its own turn. Settling inline (as
      // the obvious implementation does) resolves the request while chunk
      // writes are still queued, and the client sees the stop first.
      case 'harness.error': {
        /* W10 */
        const message = typeof data['message'] === 'string' ? data['message'] : 'Unknown harness error';
        this.enqueue(session, async () => this.failTurn(session, message));
        return;
      }

      case 'harness.cancelled': {
        /* W10 — X-4 semantic cancellation. */
        this.enqueue(session, async () => this.settleTurn(session, { stopReason: 'cancelled' }));
        return;
      }

      case 'harness.idle': {
        // `harness.idle` is the real end-of-turn signal in this repo.
        // `harness.message_complete` is NOT: an agentic turn narrates between
        // tool waves and fires it once per narration. (The old code branched
        // on `chat.message_complete`, a kind nothing has ever emitted.)
        this.enqueue(session, async () =>
          this.settleTurn(session, {
            stopReason: session.turn?.cancelRequested ? 'cancelled' : 'end_turn',
          }),
        );
        return;
      }

      default:
        break;
    }

    const update = this.updateFor(session, kind, data);
    if (update) {
      this.enqueue(session, () =>
        this.notifyClient(acp.methods.client.session.update, {
          sessionId: session.handle.chatId,
          update,
        }),
      );
      return;
    }

    if (kind === 'chat.plan.review_requested') {
      /* W10 — PLN-01 plan gate → session/request_permission. */
      this.enqueue(session, () => this.requestPlanPermission(session, data));
    }
  }

  /** Map one harness event to a `SessionUpdate`, or null if it carries none. */
  private updateFor(
    session: AcpSession,
    kind: string,
    data: Record<string, unknown>,
  ): acp.SessionUpdate | null {
    switch (kind) {
      case 'harness.token': {
        /* W10 */
        const text = data['text'];
        if (typeof text !== 'string' || text === '') return null;
        if (session.turn) session.turn.sawToken = true;
        return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } };
      }

      case 'harness.message_complete': {
        /* W10 — only when the provider streamed nothing; otherwise this is a
           replay of tokens the client already rendered. */
        const content = data['content'];
        if (typeof content !== 'string' || content === '') return null;
        if (session.turn?.sawToken) {
          // A new segment starts after this one, so allow its deltas to count.
          session.turn.sawToken = false;
          return null;
        }
        return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: content } };
      }

      case 'harness.reasoning_delta': {
        /* W10 */
        const text = data['text'];
        if (typeof text !== 'string' || text === '') return null;
        if (session.turn) session.turn.sawThought = true;
        return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } };
      }

      case 'harness.reasoning_complete': {
        /* W10 — providers that emit only the finished block never send deltas. */
        const content = data['content'];
        if (typeof content !== 'string' || content === '') return null;
        if (session.turn?.sawThought) return null;
        return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: content } };
      }

      case 'harness.tool_start': {
        /* W10 */
        const tool = typeof data['tool'] === 'string' ? data['tool'] : 'unknown';
        return {
          sessionUpdate: 'tool_call',
          toolCallId: this.toolCallId(data, tool),
          title: tool,
          kind: toolKindFor(tool),
          status: 'in_progress',
          rawInput: data['args'],
        };
      }

      case 'harness.tool_complete': {
        /* W10 */
        const tool = typeof data['tool'] === 'string' ? data['tool'] : 'unknown';
        return {
          sessionUpdate: 'tool_call_update',
          toolCallId: this.toolCallId(data, tool),
          status: data['success'] === false ? 'failed' : 'completed',
          rawOutput: data['result'],
        };
      }

      default:
        // Every other kind (chat.*, harness.session_info, widget events, …) is
        // GeneratorAI-specific and has no ACP representation. Dropping them at
        // the boundary is correct, not a gap.
        return null;
    }
  }

  /**
   * A stable ACP `toolCallId`.
   *
   * `callId` is optional on both harness tool events, and when it is absent
   * `ChatManagementService` itself pairs start/complete by tool NAME — so we
   * do the same. The old code used `call-${Date.now()}` on start and `''` on
   * complete, which meant no client could ever pair the two.
   */
  private toolCallId(data: Record<string, unknown>, tool: string): string {
    const callId = data['callId'];
    return typeof callId === 'string' && callId ? callId : `tool:${tool}`;
  }

  // ── Outbound: session/request_permission ─────────────────────

  /**
   * Turn a PLN-01 plan-review gate into a real `session/request_permission`.
   *
   * The response's `optionId` is echoed straight back into `decidePlan`, but
   * only after checking it is one this request actually advertised — a client
   * returning an id we never offered must not be able to pick a plan action by
   * accident.
   */
  private async requestPlanPermission(
    session: AcpSession,
    data: Record<string, unknown>,
  ): Promise<void> {
    const decidePlan = this.bridge.decidePlan;
    if (!decidePlan) return;

    const planId = data['planId'];
    const interactionId = data['interactionId'];
    if (typeof planId !== 'string' || typeof interactionId !== 'string') return;

    const actions = Array.isArray(data['actions'])
      ? (data['actions'] as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    const summary = typeof data['summary'] === 'string' ? data['summary'] : 'Plan review requested';

    const options: acp.PermissionOption[] = [
      ...actions.map((action) => ({
        optionId: action,
        name: PLAN_ACTION_LABELS[action] ?? action,
        kind: 'allow_once' as const,
      })),
      { optionId: PLAN_REJECT_OPTION_ID, name: 'Reject plan', kind: 'reject_once' as const },
    ];
    const advertised = new Set(options.map((o) => o.optionId));

    let decision: AcpPlanDecision;
    try {
      const response = await this.notifyPermission({
        sessionId: session.handle.chatId,
        toolCall: {
          toolCallId: interactionId,
          title: summary.split('\n')[0] ?? summary,
          kind: 'think',
          status: 'pending',
        },
        options,
      });

      const outcome = response.outcome;
      if (outcome.outcome !== 'selected' || !advertised.has(outcome.optionId)) {
        // 'cancelled', or an id we never offered — both mean "not approved".
        decision = { approved: false };
      } else if (outcome.optionId === PLAN_REJECT_OPTION_ID) {
        decision = { approved: false };
      } else {
        decision = { approved: true, action: outcome.optionId };
      }
    } catch (err) {
      this.onDiagnostic(
        `session/request_permission failed for plan ${planId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      decision = { approved: false };
    }

    await decidePlan(session.handle.chatId, planId, decision);
  }

  // ── Outbound plumbing ────────────────────────────────────────

  private notifyClient(
    method: typeof acp.methods.client.session.update,
    params: acp.SessionNotification,
  ): Promise<void> {
    const client = this.connection?.client;
    if (!client) return Promise.resolve();
    return client.notify(method, params);
  }

  private notifyPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const client = this.connection?.client;
    if (!client) return Promise.reject(new Error('not connected'));
    return client.request(acp.methods.client.session.requestPermission, params);
  }

  /**
   * Chain outbound work for one session.
   *
   * A rejection here means the wire is gone (EPIPE) or the client errored. The
   * old code swallowed exactly this in a bare `catch {}`; instead we surface it
   * on the diagnostic channel and fail the in-flight turn, because a turn whose
   * output the client never received did not succeed.
   */
  private enqueue(session: AcpSession, op: () => Promise<void>): void {
    session.outbound = session.outbound.then(op).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.onDiagnostic(`outbound write failed for ${session.handle.chatId}: ${message}`);
      this.failTurn(session, `client write failed: ${message}`);
    });
  }

  // ── Cleanup ──────────────────────────────────────────────────

  private async releaseSession(session: AcpSession, reason: string): Promise<void> {
    if (!this.sessions.delete(session.handle.chatId)) return;

    session.unsubscribe();
    this.failTurn(session, `session released: ${reason}`);

    try {
      await this.bridge.releaseSession(session.handle);
    } catch (err) {
      this.onDiagnostic(
        `releaseSession(${reason}) failed for ${session.handle.chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async releaseAllSessions(reason: string): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values()).map((session) => this.releaseSession(session, reason)),
    );
  }

  // ── Guards ───────────────────────────────────────────────────

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new acp.RequestError(-32002, 'Server not initialized: call `initialize` first');
    }
  }

  private requireSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(undefined, `Unknown session: ${sessionId}`);
    }
    return session;
  }
}
