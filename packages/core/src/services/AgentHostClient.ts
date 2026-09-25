/**
 * W12 — AgentHostClient: gateway-side IAgentHarness that proxies to the agent-host process.
 *
 * Drop-in replacement for MultiHarness. The composition root can switch between
 * them with a config flag (`GENERATORAI_AGENT_HOST=true` — opt-in; see
 * composition-root.ts for why this is opt-in rather than the default).
 *
 * All provider handles (CLI processes, SDK instances) stay in the host process.
 * The gateway only holds typed IPC messages and session state.
 *
 * L5: Native handles never live in the control-plane process.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventNotification,
  SessionEndedNotification,
  CallbackInvokeNotification,
  CallbackResultRequest,
  SpawnSessionRequest,
  SendTurnRequest,
  AbortSessionRequest,
  DeleteSessionRequest,
} from '@generatorai/shared';
import { serializeHostCallbacks } from '@generatorai/shared';
import type {
  IAgentHarness,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  CreateConversationParams,
  ConversationResponse,
  ConversationMessage,
  ConversationWarning,
  HarnessAgentInfo,
  SendPromptOptions,
  AttachmentRef,
} from '../domain/ports/IAgentHarness.js';
import type { ProviderCapabilities } from '../domain/ports/IProviderInstance.js';
import type { HostSupervisor } from '../infrastructure/HostSupervisor.js';
import type { ILogger } from '@generatorai/shared';

type EventHandler = (event: AgentEvent) => void;

/** Static capabilities for the proxied host — declared, never discovered. */
const HOST_CLIENT_CAPABILITIES: ProviderCapabilities = {
  vision: true,
  reasoning: true,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  maxParallelTools: 8,
  planMode: true,
  mcpServers: true,
  skillDirectories: true,
  fullToolGating: true,
  sessionPersistence: true,
  budgetTracking: true,
  // The host proxies provider turns over IPC and owns no computer-use driver
  // of its own. Declared explicitly rather than left undefined: W44's
  // capability-declaration suite requires every field to be stated, and an
  // omitted optional field reads as "nobody decided" rather than "no".
  computerUse: false,
};

/**
 * Everything the gateway must know about a session to (a) route events and
 * (b) re-create it verbatim on the far side after a host restart.
 */
interface HostSession {
  /**
   * The spawn params as the CALLER passed them (functions included). Held so
   * a restarted host — which boots with empty maps — can be handed the same
   * session back; they are re-serialised, with fresh callback ids, on every
   * spawn.
   */
  params: CreateConversationParams;
  /**
   * Last `seq` seen for this session. A jump means the host's bounded queue
   * dropped frames.
   */
  lastSeq: number;
  /**
   * Whether a terminal event (idle/error/cancelled) has been delivered to
   * handlers for the current turn. Reset when `session_ended` is consumed.
   */
  terminalDelivered: boolean;
}

export class AgentHostClient implements IAgentHarness {
  /* W12 */
  private clientState: HarnessClientState = 'starting';
  private readonly clientHandlers = new Set<(e: HarnessClientEvent) => void>();
  /**
   * Subscription registry. △ This used to double as the liveness registry,
   * which is what made `resumeConversation` unrecoverable: `onConversationEvent`
   * auto-creates an entry for ANY id, so one stray subscribe made
   * `hasLiveConversation()` answer true for a conversation the host had never
   * heard of. Liveness now lives in `sessions`, which is only ever written by a
   * successful spawn.
   */
  private readonly conversationHandlers = new Map<string, Set<EventHandler>>();
  private readonly sessions = new Map<string, HostSession>();
  private readonly conversationWarnings = new Map<string, ConversationWarning[]>();
  private readonly conversationMessages = new Map<string, ConversationMessage[]>();
  /**
   * RV-26 — sessionId → callbackId → the gateway-side function a host stub
   * calls: host tool handlers, the permission / question / plan-review gates
   * and the hook bridge. Functions cannot cross IPC; `spawnSession` swaps
   * each for a marker and the host calls back with `callback_invoke`.
   */
  private readonly callbacks = new Map<string, Map<string, (...args: unknown[]) => unknown>>();
  private callbackSeq = 0;
  /** Frames the host reported dropping, for health reporting. */
  private droppedEventCount = 0;

  constructor(
    private readonly supervisor: HostSupervisor,
    private readonly logger: ILogger,
  ) {}

  // ── IHarnessClientLifecycle ───────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.supervisor.start();
    this.clientState = 'running';
    this.emitClientEvent({ type: 'client.started' });
    this.logger.info('[AgentHostClient] Initialized — agent host connected');
  }

  async stop(): Promise<void> {
    await this.supervisor.stop();
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped' });
  }

  async forceStop(): Promise<void> {
    await this.stop();
  }

  getClientState(): HarnessClientState {
    // The supervisor is the source of truth for whether a host process exists.
    // Checking it here means `getClientState()` cannot report 'running' in
    // front of a dead host even if `onFatal` was never wired up.
    const hostState = this.supervisor.getState();
    if (hostState === 'fatal') return 'error';
    if (hostState === 'stopped' && this.clientState === 'running') return 'stopped';
    return this.clientState;
  }

  async ping(): Promise<boolean> {
    try {
      const resp = await this.supervisor.send({ type: 'ping' });
      return resp.type === 'pong';
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientHandlers.add(handler);
    return () => this.clientHandlers.delete(handler);
  }

  capabilities(): ProviderCapabilities {
    return HOST_CLIENT_CAPABILITIES;
  }

  // ── IHarnessModelDiscovery ────────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    // Was a Phase-B stub returning `[]`, which emptied the model picker the
    // moment the host was turned on. The host owns the provider; ask it.
    const resp = await this.supervisor.send({ type: 'list_models' });
    if (resp.type === 'models') return resp.models as unknown as HarnessModel[];
    if (resp.type === 'error') throw new Error(`AgentHostClient.getModels failed: ${resp.message}`);
    throw new Error(`AgentHostClient.getModels: unexpected response ${resp.type}`);
  }

  // ── IHarnessConversationLifecycle ─────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const sessionId = randomUUID();
    await this.spawnSession(sessionId, params);
    return sessionId;
  }

  /**
   * Spawn a session on the host under a CALLER-CHOSEN id.
   *
   * The id is the routing key on both sides, so it has to be decided here and
   * sent, never minted by a nested `createConversation()` call — that was the
   * `resumeConversation` bug: it minted a fresh `randomUUID()`, discarded it,
   * and left the caller's id bound to nothing, so the next `sendPrompt` failed
   * SESSION_NOT_FOUND permanently.
   */
  private async spawnSession(sessionId: string, params: CreateConversationParams): Promise<void> {
    // A re-spawn (host restart) re-registers every callback under fresh ids.
    const registry = new Map<string, (...args: unknown[]) => unknown>();
    this.callbacks.set(sessionId, registry);
    const serialized = serializeHostCallbacks(params, (fn) => {
      const id = `cb-${++this.callbackSeq}`;
      registry.set(id, fn);
      return id;
    }) as Record<string, unknown>;

    this.conversationHandlers.set(sessionId, this.conversationHandlers.get(sessionId) ?? new Set());
    if (!this.conversationWarnings.has(sessionId)) this.conversationWarnings.set(sessionId, []);
    if (!this.conversationMessages.has(sessionId)) this.conversationMessages.set(sessionId, []);

    const spawnReq: Omit<SpawnSessionRequest, 'reqId'> = {
      type: 'spawn_session',
      sessionId,
      params: serialized,
    };
    const resp = await this.supervisor.send(spawnReq).catch((err: unknown) => {
      this.cleanupSessionMaps(sessionId);
      throw new Error(`AgentHostClient spawn failed for ${sessionId}: ${String(err)}`);
    });

    if (resp.type === 'error') {
      // N11-fix: clean all maps on spawn failure, not just conversationHandlers
      this.cleanupSessionMaps(sessionId);
      throw new Error(`AgentHostClient.createConversation failed: ${resp.message}`);
    }

    // Liveness is committed only on a confirmed spawn.
    this.sessions.set(sessionId, { params, lastSeq: 0, terminalDelivered: false });
  }

  private cleanupSessionMaps(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.callbacks.delete(sessionId);
    this.conversationHandlers.delete(sessionId);
    this.conversationWarnings.delete(sessionId);
    this.conversationMessages.delete(sessionId);
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (this.sessions.has(conversationId)) return;
    await this.spawnSession(conversationId, {
      ...(params ?? {}),
      harnessType: params?.harnessType ?? 'claude-agent',
    } as CreateConversationParams);
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.sessions.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.sessions.keys()];
    return ids[ids.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const deleteReq: Omit<DeleteSessionRequest, 'reqId'> = { type: 'delete_session', sessionId: conversationId };
    await this.supervisor.send(deleteReq).catch((err: unknown) => {
      // The host may already be gone; local state must still be released.
      this.logger.warn(`[AgentHostClient] delete_session for ${conversationId} failed: ${String(err)}`);
    });
    this.cleanupSessionMaps(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversationWarnings.get(conversationId) ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    const resp = await this.supervisor.send({ type: 'select_agent', sessionId: conversationId, agentName });
    if (resp.type === 'ack') return;
    if (resp.type === 'error') throw new Error(`AgentHostClient.selectAgent failed: ${resp.message}`);
    throw new Error(`AgentHostClient.selectAgent: unexpected response ${resp.type}`);
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    const resp = await this.supervisor.send({ type: 'list_agents', sessionId: conversationId });
    if (resp.type === 'agents') return resp.agents as HarnessAgentInfo[];
    if (resp.type === 'error') throw new Error(`AgentHostClient.listAgents failed: ${resp.message}`);
    throw new Error(`AgentHostClient.listAgents: unexpected response ${resp.type}`);
  }

  // ── IHarnessMessaging ─────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    const turnReq: Omit<SendTurnRequest, 'reqId'> = {
      type: 'send_turn',
      sessionId: conversationId,
      prompt,
      // AttachmentRef uses `path` as the stable identifier; the host resolves files by path
      attachments: attachments?.map((a) => ({ type: 'file', id: a.path })),
      ...(options
        ? {
            options: {
              ...(options.agentMode ? { agentMode: options.agentMode } : {}),
              ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
            },
          }
        : {}),
    };
    const resp = await this.supervisor.send(turnReq);
    if (resp.type === 'error') {
      throw new Error(`AgentHostClient.sendPrompt failed: ${resp.message}`);
    }
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    // △ Fixed during end-to-end review — this used to listen for
    // 'chat.message_complete', an event kind nothing in the codebase ever
    // emits (the real kind is 'harness.message_complete' — see
    // packages/shared/src/types/AgentEvent.ts). So this branch never fired,
    // and every turn resolved via 'harness.idle' with a hardcoded
    // `{content: ''}`, discarding whatever the assistant actually said.
    //
    // `content` is the FINAL text segment of the turn, matching every other
    // provider's contract (see ChatMessage.ts's `textSegments` doc: "content
    // holds only the final one") — an agentic turn can emit several
    // `harness.message_complete` events interleaved with tool calls, so we
    // track the latest and resolve with it once the turn goes idle.
    this.pushMessage(conversationId, { role: 'user', content: prompt, timestamp: new Date() });

    return new Promise<ConversationResponse>((resolve, reject) => {
      let settled = false;
      let lastContent = '';

      // Capture the abort handler by reference so removeEventListener works cleanly in Node.js
      const abortHandler = (): void => {
        if (!settled) {
          settled = true;
          void this.abortConversation(conversationId);
          reject(new Error('Aborted'));
        }
      };
      signal?.addEventListener('abort', abortHandler);

      const cleanup = this.onConversationEvent(conversationId, (event) => {
        const kind = (event as { kind?: string }).kind ?? '';
        if (kind === 'harness.message_complete') {
          const content = (event as { data?: { content?: unknown } }).data?.content;
          if (typeof content === 'string') {
            lastContent = content;
            this.pushMessage(conversationId, { role: 'assistant', content, timestamp: new Date() });
          }
          return;
        }
        if (kind === 'harness.idle') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            resolve({ content: lastContent });
          }
        } else if (kind === 'harness.error') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            reject(new Error((event as { data?: { message?: string } }).data?.message ?? 'Harness error'));
          }
        } else if (kind === 'harness.cancelled') {
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abortHandler);
            cleanup();
            // W13: cancellation is a semantic success value, not a throw.
            // Whatever text streamed before the cancel still counts as the
            // response — resolving with '' here would discard a partial
            // answer the user already watched arrive.
            resolve({ content: lastContent });
          }
        }
      });

      // N10-fix: also remove the abort handler on sendPrompt rejection so it
      // doesn't leak and cannot fire a redundant abortConversation call later.
      this.sendPrompt(conversationId, prompt, attachments, options).catch((err: unknown) => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', abortHandler);
          cleanup();
          reject(err);
        }
      });
    });
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.conversationMessages.get(conversationId) ?? [];
  }

  /**
   * Record a message for `getMessages()`. Mirrors every other provider's
   * `pushMessage` — without this, `conversationMessages` was initialized in
   * `createConversation()` and never written to again, so `getMessages()`
   * always returned `[]` regardless of how many turns actually ran.
   */
  private pushMessage(conversationId: string, message: ConversationMessage): void {
    const list = this.conversationMessages.get(conversationId);
    if (list) list.push(message);
  }

  async abortConversation(conversationId: string): Promise<void> {
    const abortReq: Omit<AbortSessionRequest, 'reqId'> = { type: 'abort_session', sessionId: conversationId };
    await this.supervisor.send(abortReq).catch((err: unknown) => {
      this.logger.warn(`[AgentHostClient] abortConversation error: ${String(err)}`);
    });
  }

  // ── IHarnessEvents ────────────────────────────────────────────────────────

  onConversationEvent(conversationId: string, handler: EventHandler): () => void {
    let handlers = this.conversationHandlers.get(conversationId);
    if (!handlers) {
      handlers = new Set();
      this.conversationHandlers.set(conversationId, handlers);
    }
    handlers.add(handler);
    return () => {
      this.conversationHandlers.get(conversationId)?.delete(handler);
    };
  }

  // ── Called by HostSupervisor when events arrive from the host process ─────

  /** Wire this up: pass as `onHostEvent` to HostSupervisor. */
  handleHostEvent(msg: AgentEventNotification | SessionEndedNotification | CallbackInvokeNotification): void {
    if (msg.type === 'agent_event') {
      this.handleAgentEvent(msg);
      return;
    }
    if (msg.type === 'callback_invoke') {
      void this.handleCallbackInvoke(msg);
      return;
    }
    if (msg.type === 'session_ended') {
      this.handleSessionEnded(msg);
      return;
    }
    // △ `handleHostEvent` used to test only `msg.type === 'agent_event'` and
    // silently drop everything else, which made `session_ended` a fully dead
    // path end to end — the host built it, the supervisor forwarded it, and it
    // landed here and vanished.
    this.logger.warn(`[AgentHostClient] Unhandled host notification type: ${(msg as { type: string }).type}`);
  }

  /**
   * RV-26 — run the gateway-side function a host stub called and send its
   * answer back. A gate may block for as long as a human takes to answer, so
   * there is no deadline here; the host rejects the stub when the session is
   * torn down.
   */
  private async handleCallbackInvoke(msg: CallbackInvokeNotification): Promise<void> {
    const fn = this.callbacks.get(msg.sessionId)?.get(msg.callbackId);
    let reply: Omit<CallbackResultRequest, 'reqId'>;
    if (!fn) {
      reply = { type: 'callback_result', callId: msg.callId, ok: false, error: `Unknown callback ${msg.callbackId} for session ${msg.sessionId}` };
    } else {
      try {
        const value = await fn(...msg.args);
        reply = { type: 'callback_result', callId: msg.callId, ok: true, ...(value !== undefined ? { value } : {}) };
      } catch (err: unknown) {
        reply = { type: 'callback_result', callId: msg.callId, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    await this.supervisor.send(reply).catch((err: unknown) => {
      this.logger.warn(`[AgentHostClient] callback_result for ${msg.callId} could not be delivered: ${String(err)}`);
    });
  }

  private handleAgentEvent(msg: AgentEventNotification): void {
    const session = this.sessions.get(msg.sessionId);
    if (session) {
      this.noteSequence(msg.sessionId, session, msg);
      const kind = (msg.event as { kind?: string }).kind ?? '';
      if (kind === 'harness.idle' || kind === 'harness.error' || kind === 'harness.cancelled') {
        session.terminalDelivered = true;
      }
    }
    this.deliver(msg.sessionId, msg.event);
  }

  /**
   * The host's authoritative turn boundary.
   *
   * Normally the terminal AgentEvent that caused it has already been delivered
   * and there is nothing to do but reset the turn flag. If it has NOT — which
   * happens exactly when the host's bounded queue dropped it under load — a
   * caller awaiting `sendPromptAndWait` would hang forever on a turn the host
   * knows is over. Synthesising the terminal event here is the only thing
   * standing between a dropped frame and a permanently stuck turn.
   */
  private handleSessionEnded(msg: SessionEndedNotification): void {
    const session = this.sessions.get(msg.sessionId);
    if (session && !session.terminalDelivered) {
      this.logger.warn(
        `[AgentHostClient] session_ended(${msg.reason}) for ${msg.sessionId} arrived without its terminal event — ` +
          'synthesising it so the pending turn settles',
      );
      this.deliver(msg.sessionId, this.synthesiseTerminalEvent(msg));
    }
    if (session) session.terminalDelivered = false;
  }

  private synthesiseTerminalEvent(msg: SessionEndedNotification): AgentEvent {
    const timestamp = new Date().toISOString();
    if (msg.reason === 'error') {
      return { kind: 'harness.error', data: { message: msg.error ?? 'Agent host reported an error' }, timestamp } as AgentEvent;
    }
    if (msg.reason === 'cancelled') {
      return { kind: 'harness.cancelled', data: { reason: 'user_abort' }, timestamp } as AgentEvent;
    }
    return { kind: 'harness.idle', data: {}, timestamp } as AgentEvent;
  }

  /**
   * Record the host's per-session sequence number and report loss.
   *
   * Two independent signals, because either alone can be missed: an explicit
   * `droppedBefore` count from the overflowing queue, and a `seq` jump. A host
   * that does not sequence at all (older build) sends no `seq`, and is skipped
   * rather than reported as one continuous gap.
   */
  private noteSequence(sessionId: string, session: HostSession, msg: AgentEventNotification): void {
    if (msg.droppedBefore && msg.droppedBefore > 0) {
      this.droppedEventCount += msg.droppedBefore;
      this.logger.warn(
        `[AgentHostClient] Host dropped ${msg.droppedBefore} event(s) for session ${sessionId} — ` +
          'its bounded queue overflowed',
      );
    }
    if (typeof msg.seq !== 'number') return;
    if (session.lastSeq > 0 && msg.seq > session.lastSeq + 1 && !msg.droppedBefore) {
      const missing = msg.seq - session.lastSeq - 1;
      this.droppedEventCount += missing;
      this.logger.warn(`[AgentHostClient] Sequence gap of ${missing} for session ${sessionId}`);
    }
    session.lastSeq = msg.seq;
  }

  private deliver(sessionId: string, event: AgentEvent): void {
    this.notify(this.conversationHandlers.get(sessionId), event);
  }

  /**
   * Deliver to an explicitly-held handler set. Needed on the re-attach failure
   * path, where the session's maps have already been torn down but its
   * subscribers still have to be told the session is gone.
   */
  private notify(handlers: Set<EventHandler> | undefined, event: AgentEvent): void {
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(event);
      } catch {
        // isolated — EVT-02
      }
    }
  }

  /** Number of events the host reported dropping. Exposed for health reporting. */
  getDroppedEventCount(): number {
    return this.droppedEventCount;
  }

  // ── Host lifecycle callbacks (wire these to HostSupervisor) ───────────────

  /**
   * Re-establish every live session on a freshly restarted host.
   *
   * The new process starts with EMPTY session maps while this client still
   * holds the handler map, so without this every later turn fails
   * SESSION_NOT_FOUND forever and — because `clientState` stayed 'running' —
   * the gateway reports the whole thing healthy. Pass as `onHostRestart`.
   *
   * A session that cannot be re-spawned is failed LOUDLY: its callers get a
   * `harness.error` event and the session is dropped, rather than being left
   * as a live-looking id that can never complete a turn again.
   */
  async reattachSessions(): Promise<void> {
    const toReattach = [...this.sessions.entries()];
    if (toReattach.length === 0) return;

    this.logger.info(`[AgentHostClient] Agent host restarted — re-attaching ${toReattach.length} session(s)`);
    let failed = 0;

    for (const [sessionId, session] of toReattach) {
      // Hold the subscriber set: a failed spawn tears the session's maps down,
      // and those subscribers are precisely who has to be told it is gone.
      const subscribers = this.conversationHandlers.get(sessionId);
      // The host lost the session, so this client's record is stale too;
      // drop it first so `spawnSession` commits a fresh one on success.
      this.sessions.delete(sessionId);
      try {
        await this.spawnSession(sessionId, session.params);
      } catch (err: unknown) {
        failed++;
        this.logger.error(`[AgentHostClient] Failed to re-attach session ${sessionId}: ${String(err)}`);
        this.cleanupSessionMaps(sessionId);
        this.notify(subscribers, {
          kind: 'harness.error',
          data: { message: `Session lost: the agent host restarted and this session could not be restored (${String(err)})` },
          timestamp: new Date().toISOString(),
        } as AgentEvent);
      }
    }

    if (failed > 0) {
      this.clientState = 'error';
      this.emitClientEvent({ type: 'client.error', data: { message: `${failed} session(s) lost across an agent-host restart` } });
    }
  }

  /**
   * The supervisor has given up on the host. Pass as `onFatal`.
   *
   * △ Restart-cap exhaustion used to be entirely silent here: the supervisor
   * set its internal `stopped` flag, `spawn()` threw forever, and
   * `getClientState()` kept answering 'running' — so health checks reported a
   * healthy harness in front of a process that no longer exists.
   */
  handleHostFatal(reason: string): void {
    this.clientState = 'error';
    this.logger.error(`[AgentHostClient] Agent host is unrecoverable: ${reason}`);
    this.emitClientEvent({ type: 'client.error', data: { message: reason } });
    // Every live session is gone with the process. Tell their subscribers so
    // pending turns reject instead of hanging.
    for (const sessionId of [...this.sessions.keys()]) {
      this.deliver(sessionId, {
        kind: 'harness.error',
        data: { message: `Agent host is unrecoverable: ${reason}` },
        timestamp: new Date().toISOString(),
      } as AgentEvent);
      this.cleanupSessionMaps(sessionId);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emitClientEvent(event: HarnessClientEvent): void {
    for (const h of this.clientHandlers) {
      try {
        h(event);
      } catch {
        // isolated
      }
    }
  }
}
