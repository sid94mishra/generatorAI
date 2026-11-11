// ────────────────────────────────────────────────────────────────
// AcpProvider — the `acp` provider: every enabled ACP agent behind one
// IAgentHarness (docs/acp ACP-1…ACP-3).
//
// One `AcpAgentConnection` (one agent process) per enabled agent. A model id
// names its agent — `<agentId>/<value>`, or `<agentId>` alone for an agent
// that publishes no model option (ACP-2) — and a conversation stays bound to
// the agent that created it; a rebind with another agent's model moves it
// (a new session there, reported as CONVERSATION_RESTARTED so the transcript
// is handed over). Provider session ids are `<agentId>/<sessionId>` so a
// resume after a restart reaches the agent that issued it.
//
// The agent set is live: `setAgents` (the server's ACP service calls it when
// an agent is enabled, disabled, updated or its env changes) starts, restarts
// and stops connections without a server restart; `onChange` tells the host
// to re-probe. With no agent enabled the catalog is empty and the status says
// "No ACP agents enabled" (ACP-9).
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
  CompactConversationOptions,
  ForkConversationOptions,
  ForkConversationResult,
  HarnessRuntimeDiagnostics,
} from '@generatorai/core';
import type { AgentEvent, HarnessSubProviderStatus } from '@generatorai/shared';
import type { AcpAgentLaunch, AcpProviderOptions } from '../../types.js';
import { AcpAgentConnection, type AcpConnectionStatus } from './AcpAgentConnection.js';

type Listener<T> = (event: T) => void;

/** `<agentId>/<value>` → its parts. An id with no `/` is the agent's default model. */
export function splitAcpModelId(modelId: string): { agentId: string; value: string } {
  const slash = modelId.indexOf('/');
  return slash < 0 ? { agentId: modelId, value: '' } : { agentId: modelId.slice(0, slash), value: modelId.slice(slash + 1) };
}

/** The catalog id of an agent's model value (`''` = its default model). */
export function acpModelId(agentId: string, value: string): string {
  return value ? `${agentId}/${value}` : agentId;
}

/** What makes a running connection stale: anything about how the process is launched. */
function launchSignature(l: AcpAgentLaunch): string {
  return JSON.stringify([l.command, l.args, l.env ?? {}, l.cwd ?? '', l.tierB ?? true]);
}

interface AgentEntry {
  launch: AcpAgentLaunch;
  conn: AcpAgentConnection | null;
  starting: Promise<AcpAgentConnection> | null;
  /** Why the last start failed. */
  startError?: string;
}

interface ConversationBinding {
  agentId: string;
  /** The agent's session id, kept so a re-created connection can resume it. */
  sessionId?: string;
  unsubscribe?: () => void;
}

export class AcpProvider implements IAgentHarness {
  private readonly opts: AcpProviderOptions;
  private readonly agents = new Map<string, AgentEntry>();
  private order: string[] = [];
  private readonly bindings = new Map<string, ConversationBinding>();
  private readonly listeners = new Map<string, Set<Listener<AgentEvent>>>();
  private readonly clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private clientState: HarnessClientState = 'starting';
  private lastProbeError: string | undefined;

  constructor(opts: AcpProviderOptions = {}) {
    this.opts = opts;
    for (const launch of opts.agents ?? []) this.agents.set(launch.id, { launch, conn: null, starting: null });
    this.order = (opts.agents ?? []).map((a) => a.id);
  }

  // ── The agent set ────────────────────────────────────────────────

  /** The enabled agents, in display order. */
  agentIds(): string[] {
    return [...this.order];
  }

  /**
   * Replace the enabled agents. New ones start (when the provider runs), removed ones stop, and one whose launch
   * changed (an update, new env) restarts; its conversations resume their sessions on the next turn.
   */
  async setAgents(launches: AcpAgentLaunch[]): Promise<void> {
    const next = new Map(launches.map((l) => [l.id, l]));
    const stops: Array<Promise<void>> = [];
    for (const [id, entry] of this.agents) {
      if (next.has(id)) continue;
      this.agents.delete(id);
      stops.push(this.stopEntry(entry));
    }
    for (const launch of launches) {
      const entry = this.agents.get(launch.id);
      if (!entry) {
        this.agents.set(launch.id, { launch, conn: null, starting: null });
        if (this.clientState === 'running') void this.ensureAgent(launch.id).catch(() => undefined);
        continue;
      }
      const changed = launchSignature(entry.launch) !== launchSignature(launch);
      entry.launch = launch;
      if (changed) {
        stops.push(this.stopEntry(entry));
        delete entry.startError;
        if (this.clientState === 'running') void this.ensureAgent(launch.id).catch(() => undefined);
      }
    }
    this.order = launches.map((l) => l.id);
    await Promise.all(stops);
    this.notifyChange();
  }

  /** Stop an agent's process and start it again (after a terminal sign-in exited 0). */
  async restartAgent(agentId: string): Promise<AcpAgentConnection> {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`ACP agent "${agentId}" is not enabled.`);
    await this.stopEntry(entry);
    delete entry.startError;
    const conn = await this.ensureAgent(agentId);
    this.notifyChange();
    return conn;
  }

  private async stopEntry(entry: AgentEntry): Promise<void> {
    const conn = entry.conn ?? (await entry.starting?.catch(() => null)) ?? null;
    entry.conn = null;
    entry.starting = null;
    if (conn) await conn.shutdown().catch(() => undefined);
  }

  /** The agent's running connection, started (or restarted after its process died) on demand. */
  async ensureAgent(agentId: string): Promise<AcpAgentConnection> {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`ACP agent "${agentId}" is not enabled. Enable it in Settings › Model providers › ACP agents.`);
    if (entry.conn && entry.conn.getClientState() === 'running') return entry.conn;
    if (entry.starting) return entry.starting;
    const launch = entry.launch;
    const conn = new AcpAgentConnection({
      command: launch.command,
      args: launch.args,
      env: launch.env,
      cwd: launch.cwd,
      defaultCwd: this.opts.defaultCwd,
      agentId: launch.id,
      label: launch.label,
      tierB: launch.tierB ?? true,
      requestTimeoutMs: this.opts.requestTimeoutMs,
      permissionTimeoutMs: this.opts.permissionTimeoutMs,
      authTimeoutMs: this.opts.authTimeoutMs,
      onStateChange: () => this.notifyChange(),
      logger: this.opts.logger,
    });
    entry.conn = null;
    const starting = (async () => {
      await conn.initialize();
      return conn;
    })();
    entry.starting = starting;
    try {
      await starting;
      if (entry.starting !== starting) {
        // Replaced (setAgents / restart) while it was starting.
        await conn.shutdown().catch(() => undefined);
        throw new Error(`ACP agent "${agentId}" was restarted while it started.`);
      }
      entry.conn = conn;
      delete entry.startError;
      return conn;
    } catch (err) {
      if (entry.starting === starting) entry.startError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      if (entry.starting === starting) entry.starting = null;
    }
  }

  /** The running connection of an agent, if any (never starts one). */
  peekAgent(agentId: string): AcpAgentConnection | null {
    return this.agents.get(agentId)?.conn ?? null;
  }

  /** Per-agent state for the ACP API: connection status, or why it is not running. */
  agentStatus(agentId: string): (AcpConnectionStatus & { startError?: string }) | null {
    const entry = this.agents.get(agentId);
    if (!entry) return null;
    const base: AcpConnectionStatus = entry.conn?.status() ?? {
      connected: false,
      authState: 'unknown',
      models: [],
      authMethods: [],
      supportsLogout: false,
    };
    // A start that failed is a finished check (clients stop waiting for the first probe).
    return { ...base, ...(entry.startError ? { startError: entry.startError, error: entry.startError, checkedAt: base.checkedAt ?? Date.now() } : {}) };
  }

  private notifyChange(): void {
    try { this.opts.onChange?.(); } catch { /* a listener never breaks the provider */ }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.clientState = 'running';
    // Every enabled agent comes up now; one failing to start is its own status, never the provider's.
    await Promise.allSettled(this.order.map((id) => this.ensureAgent(id)));
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    await Promise.all([...this.agents.values()].map(async (e) => {
      const conn = e.conn;
      e.conn = null;
      e.starting = null;
      await conn?.forceStop().catch(() => undefined);
    }));
    this.clientState = 'stopped';
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.agents.values()].map((e) => this.stopEntry(e)));
    for (const b of this.bindings.values()) b.unsubscribe?.();
    this.clientState = 'stopped';
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    return this.clientState === 'running';
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): () => void {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities ─────────────────────────────────────────────────

  /** Before a conversation exists: the conservative baseline every ACP agent meets (L9). */
  capabilities(): ProviderCapabilities {
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: true,
      skills: 'none',
      approvalGating: 'per_call',
      hostTools: 'none',
      structuredOutput: 'none',
      sessionPersistence: false,
      budgetTracking: false,
      computerUse: false,
      conversationFork: false,
      conversationCompact: false,
      compactInstructions: false,
    };
  }

  capabilitiesFor(conversationId: string): ProviderCapabilities {
    const conn = this.connFor(conversationId);
    return conn ? conn.capabilitiesFor(conversationId) : this.capabilities();
  }

  // ── Catalog (ACP-2/3) ────────────────────────────────────────────

  invalidateModelCache(): void {
    for (const e of this.agents.values()) e.conn?.invalidateModelCache();
  }

  getLastModelProbeError(): string | undefined {
    return this.lastProbeError;
  }

  /** Models of every enabled agent that is up and signed in, ids `<agentId>/<value>`, `subProvider` set. */
  async getModels(): Promise<HarnessModel[]> {
    if (this.order.length === 0) {
      this.lastProbeError = 'No ACP agents enabled. Install and enable one in Settings › Model providers › ACP agents.';
      return [];
    }
    const perAgent = await Promise.all(this.order.map(async (id) => {
      const entry = this.agents.get(id)!;
      try {
        const conn = await this.ensureAgent(id);
        const models = await conn.getModels();
        return { id, models, error: models.length ? undefined : conn.getLastModelProbeError() };
      } catch (err) {
        return { id, models: [] as HarnessModel[], error: `${entry.launch.label}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }));
    const out: HarnessModel[] = [];
    for (const { id, models } of perAgent) {
      for (const m of models) out.push({ ...m, id: acpModelId(id, m.id), provider: 'acp', subProvider: id });
    }
    const errors = perAgent.filter((r) => r.models.length === 0 && r.error).map((r) => r.error!);
    this.lastProbeError = out.length === 0 ? (errors.join(' · ') || 'No enabled ACP agent listed any models.') : undefined;
    return out;
  }

  /** One entry per enabled agent, in order — `HarnessProviderStatus.subProviders` (ACP-3). */
  getSubProviders(): HarnessSubProviderStatus[] {
    return this.order.map((id) => {
      const entry = this.agents.get(id)!;
      const s = this.agentStatus(id)!;
      const authenticated = s.authState === 'authenticated' || s.authState === 'not_required';
      return {
        id,
        label: entry.launch.label,
        ...(entry.launch.mark ? { mark: entry.launch.mark } : {}),
        ...(entry.launch.version ? { version: entry.launch.version } : {}),
        installed: !entry.startError || !/not found|ENOENT/i.test(entry.startError),
        connected: s.connected,
        authState: s.authState,
        authenticated,
        ready: s.connected && s.models.length > 0,
        ...(s.error ? { error: s.error } : {}),
        modelCount: s.models.length,
      };
    });
  }

  // ── Routing ──────────────────────────────────────────────────────

  private connFor(conversationId: string): AcpAgentConnection | null {
    const binding = this.bindings.get(conversationId);
    return binding ? this.peekAgent(binding.agentId) : null;
  }

  /** The agent a conversation with these params belongs to. */
  private agentForParams(params: CreateConversationParams): string {
    if (params.model && !['auto', 'default'].includes(params.model)) {
      const { agentId } = splitAcpModelId(params.model);
      if (this.agents.has(agentId)) return agentId;
    }
    const resumed = params.resumeProviderSessionId ? splitAcpModelId(params.resumeProviderSessionId).agentId : undefined;
    if (resumed && this.agents.has(resumed)) return resumed;
    const bound = this.bindings.get(params.conversationId)?.agentId;
    if (bound && this.agents.has(bound)) return bound;
    if (this.order.length === 1) return this.order[0]!;
    if (params.model) throw new Error(`No enabled ACP agent serves the model "${params.model}". Enable its agent in Settings › Model providers › ACP agents.`);
    throw new Error('Choose an ACP agent model: several ACP agents are enabled.');
  }

  /** The params as the agent's connection sees them: its own model value and session id. */
  private paramsForAgent(agentId: string, params: CreateConversationParams, warnings: ConversationWarning[]): CreateConversationParams {
    const { model, resumeProviderSessionId, ...rest } = params;
    const own: CreateConversationParams = { ...rest };
    if (model) {
      const split = splitAcpModelId(model);
      if (split.agentId === agentId && split.value) own.model = split.value;
    }
    if (resumeProviderSessionId) {
      const split = splitAcpModelId(resumeProviderSessionId);
      if (split.agentId === agentId && split.value) own.resumeProviderSessionId = split.value;
      else {
        delete own.resumeProviderSessionHarness;
        warnings.push({ code: 'CONVERSATION_RESTARTED', params: { provider: 'acp', reason: 'the chat moved to another ACP agent' } });
      }
    }
    return own;
  }

  private bind(conversationId: string, agentId: string, conn: AcpAgentConnection): void {
    const old = this.bindings.get(conversationId);
    old?.unsubscribe?.();
    const unsubscribe = conn.onConversationEvent(conversationId, (event) => {
      for (const h of this.listeners.get(conversationId) ?? []) h(event);
    });
    this.bindings.set(conversationId, { agentId, sessionId: conn.getProviderSessionId(conversationId), unsubscribe });
  }

  async createConversation(params: CreateConversationParams): Promise<string> {
    const agentId = this.agentForParams(params);
    const conn = await this.ensureAgent(agentId);
    const extra: ConversationWarning[] = [];
    await conn.createConversation(this.paramsForAgent(agentId, params, extra));
    conn.getConversationWarnings(params.conversationId).push(...extra);
    this.bind(params.conversationId, agentId, conn);
    return params.conversationId;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const binding = this.bindings.get(conversationId);
    if (!params) {
      if (binding) await (await this.ensureAgent(binding.agentId)).resumeConversation(conversationId);
      return;
    }
    const agentId = this.agentForParams(params);
    if (binding && binding.agentId !== agentId) {
      // Another agent's model: the conversation moves (the transcript is handed over).
      await this.peekAgent(binding.agentId)?.deleteConversation(conversationId).catch(() => undefined);
      binding.unsubscribe?.();
      this.bindings.delete(conversationId);
      const conn = await this.ensureAgent(agentId);
      const fresh = { ...params };
      delete fresh.resumeProviderSessionId;
      delete fresh.resumeProviderSessionHarness;
      await conn.createConversation(this.paramsForAgent(agentId, fresh, []));
      conn.getConversationWarnings(conversationId).push({
        code: 'CONVERSATION_RESTARTED',
        params: { provider: 'acp', reason: 'the chat moved to another ACP agent' },
      });
      this.bind(conversationId, agentId, conn);
      return;
    }
    const conn = await this.ensureAgent(agentId);
    const warnings: ConversationWarning[] = [];
    let own = this.paramsForAgent(agentId, params, warnings);
    // The connection was re-created (an update, a crash) and no longer has the conversation: resume the session
    // it had, so the agent keeps its memory.
    if (!conn.hasLiveConversation(conversationId) && !own.resumeProviderSessionId && binding?.sessionId) {
      own = { ...own, resumeProviderSessionId: binding.sessionId, resumeProviderSessionHarness: 'acp' };
    }
    await conn.resumeConversation(conversationId, own);
    conn.getConversationWarnings(conversationId).push(...warnings);
    this.bind(conversationId, agentId, conn);
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.connFor(conversationId)?.hasLiveConversation(conversationId) ?? false;
  }

  getProviderSessionId(conversationId: string): string | undefined {
    const binding = this.bindings.get(conversationId);
    if (!binding) return undefined;
    const sessionId = this.peekAgent(binding.agentId)?.getProviderSessionId(conversationId) ?? binding.sessionId;
    if (sessionId) binding.sessionId = sessionId;
    return sessionId ? `${binding.agentId}/${sessionId}` : undefined;
  }

  async providerSessionExists(providerSessionId: string): Promise<boolean> {
    const { agentId, value } = splitAcpModelId(providerSessionId);
    if (!value || !this.agents.has(agentId)) return false;
    const conn = await this.ensureAgent(agentId).catch(() => null);
    return conn?.capabilities().sessionPersistence === true;
  }

  conversationHarness(_conversationId: string): 'acp' {
    return 'acp';
  }

  async listConversations(): Promise<string[]> {
    return [...this.bindings.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.bindings.keys()];
    return ids[ids.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const binding = this.bindings.get(conversationId);
    if (!binding) return;
    binding.unsubscribe?.();
    this.bindings.delete(conversationId);
    await this.peekAgent(binding.agentId)?.deleteConversation(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  async forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    const agentId = this.bindings.get(conversationId)?.agentId
      ?? (options.sourceProviderSessionId ? splitAcpModelId(options.sourceProviderSessionId).agentId : undefined);
    if (!agentId) throw new Error(`AcpProvider: no agent for conversation "${conversationId}"`);
    const conn = await this.ensureAgent(agentId);
    const source = options.sourceProviderSessionId ? splitAcpModelId(options.sourceProviderSessionId).value : undefined;
    const result = await conn.forkConversation(conversationId, {
      ...options,
      ...(source ? { sourceProviderSessionId: source } : {}),
      params: this.paramsForAgent(agentId, { ...options.params, conversationId: options.newConversationId }, []),
    });
    this.bind(options.newConversationId, agentId, conn);
    return result.providerSessionId ? { ...result, providerSessionId: `${agentId}/${result.providerSessionId}` } : result;
  }

  async compactConversation(conversationId: string, options?: CompactConversationOptions): Promise<void> {
    const conn = this.requireConn(conversationId);
    await conn.compactConversation(conversationId, options);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.connFor(conversationId)?.getConversationWarnings(conversationId) ?? [];
  }

  async selectAgent(): Promise<void> { /* one ACP agent per conversation */ }

  async listAgents(): Promise<HarnessAgentInfo[]> {
    return [];
  }

  runtimeDiagnostics(): HarnessRuntimeDiagnostics {
    const providers: Record<string, Omit<HarnessRuntimeDiagnostics, 'providers'>> = {};
    let liveConversations = 0;
    let liveSessions = 0;
    for (const id of this.order) {
      const d = this.peekAgent(id)?.runtimeDiagnostics();
      if (!d) continue;
      providers[id] = d;
      liveConversations += d.liveConversations;
      liveSessions += d.liveSessions;
    }
    return { liveConversations, liveSessions, warmSessions: 0, providers };
  }

  // ── Messaging ────────────────────────────────────────────────────

  private requireConn(conversationId: string): AcpAgentConnection {
    const binding = this.bindings.get(conversationId);
    if (!binding) throw new Error(`AcpProvider: no conversation "${conversationId}"`);
    const conn = this.peekAgent(binding.agentId);
    if (!conn) throw new Error(`AcpProvider: the agent "${binding.agentId}" of conversation "${conversationId}" is not running`);
    return conn;
  }

  async sendPrompt(conversationId: string, prompt: string, attachments?: AttachmentRef[], options?: SendPromptOptions): Promise<void> {
    let conn: AcpAgentConnection;
    try {
      conn = this.requireConn(conversationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const h of this.listeners.get(conversationId) ?? []) h({ kind: 'harness.error', data: { message, provider: 'acp' } });
      return;
    }
    await conn.sendPrompt(conversationId, prompt, attachments, options);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    return this.requireConn(conversationId).sendPromptAndWait(conversationId, prompt, attachments, signal, options);
  }

  async getMessages(): Promise<ConversationMessage[]> {
    return [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    await this.connFor(conversationId)?.abortConversation(conversationId);
  }

  onConversationEvent(conversationId: string, handler: Listener<AgentEvent>): () => void {
    let set = this.listeners.get(conversationId);
    if (!set) {
      set = new Set();
      this.listeners.set(conversationId, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(conversationId);
    };
  }
}
