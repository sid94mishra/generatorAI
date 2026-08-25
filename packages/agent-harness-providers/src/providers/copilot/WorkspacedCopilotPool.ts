// ────────────────────────────────────────────────────────────────
// WorkspacedCopilotPool — W36 / P0-13 fix
//
// P0-13: A single CopilotClient (CLI process) serves ALL sessions.
//   Any conversation that triggers a long tool chain blocks every
//   other conversation waiting on the same process.
//
// Fix: one CopilotProvider (= one CopilotClient = one CLI process)
//   per WORKSPACE (working directory). Conversations in the same
//   workspace share a process; conversations in different workspaces
//   run in parallel without any head-of-line blocking between them.
//
// Design:
//   • WorkspacedCopilotPool implements IAgentHarness exactly.
//   • It creates/reuses a CopilotProvider per workspace key
//     (params.workingDirectory ?? options.defaultCwd).
//   • A conversationId→workspaceKey map routes every method call
//     to the correct sub-provider.
//   • Sub-providers are lazily initialized (cold-start held by the
//     AgentHostSupervisor's coldStart semaphore when one is supplied).
//   • getClientState() returns 'running' when ANY sub-provider is
//     running; returns 'starting' when none has been initialized yet.
//   • onClientEvent() fans out across all sub-providers.
//
// Usage (composition-root):
//   const copilotPool = new WorkspacedCopilotPool(baseOptions);
//   // Pass copilotPool to HarnessRegistry as the copilot provider.
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
import type { CopilotProviderOptions } from './CopilotProvider.js';
import { CopilotProvider } from './CopilotProvider.js';
import type { AgentHostSupervisor } from '../../AgentHostSupervisor.js';

// ── Types ──────────────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/**
 * Configuration for the WorkspacedCopilotPool.
 * Extends CopilotProviderOptions with a supervisor for cold-start gating.
 */
export interface WorkspacedCopilotPoolOptions extends CopilotProviderOptions {
  /**
   * W12 / W36 — optional supervisor for cold-start semaphore.
   * When provided, each new workspace provider acquisition holds one
   * cold-start permit during `initialize()` so at most
   * `maxConcurrentColdStarts` workspace CLI processes start simultaneously.
   */
  supervisor?: AgentHostSupervisor;

  /**
   * Maximum number of workspace provider instances to keep alive.
   * Least-recently-used workspaces are stopped and evicted when this
   * limit is reached (default: unlimited).
   */
  maxWorkspaces?: number;
}

/** One managed workspace entry. */
interface WorkspaceEntry {
  provider: CopilotProvider;
  /** Monotonic creation time — used for LRU eviction. */
  createdAt: number;
  /** Last time a conversation was created or a turn was submitted. */
  lastUsedAt: number;
  /** True while the provider's initialize() is in flight. */
  initializing: boolean;
  /** Clients waiting on the initialization to complete. */
  initWaiters: Array<(err: Error | null) => void>;
  /** True once initialize() completed successfully. */
  initialized: boolean;
}

// ── WorkspacedCopilotPool ─────────────────────────────────────────

/**
 * W36 — IAgentHarness proxy that routes each conversation to the
 * CopilotProvider for its workspace (working directory).
 *
 * All IAgentHarness methods are forwarded to the correct sub-provider.
 * Sub-providers are created and started on demand.
 */
export class WorkspacedCopilotPool implements IAgentHarness {
  private readonly baseOptions: WorkspacedCopilotPoolOptions;
  private readonly supervisor?: AgentHostSupervisor;
  private readonly maxWorkspaces: number;

  /** workspaceKey → WorkspaceEntry */
  private readonly workspaces = new Map<string, WorkspaceEntry>();
  /** conversationId → workspaceKey */
  private readonly conversationWorkspace = new Map<string, string>();
  /** Client event handlers registered by external callers. */
  private readonly clientEventHandlers = new Set<Listener<HarnessClientEvent>>();
  /** Cleanup functions for per-workspace client event subscriptions. */
  private readonly workspaceEventUnsubs = new Map<string, UnsubFn>();

  constructor(options: WorkspacedCopilotPoolOptions) {
    this.baseOptions = options;
    this.supervisor = options.supervisor;
    this.maxWorkspaces = options.maxWorkspaces ?? Number.POSITIVE_INFINITY;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * No-op: sub-providers are initialized lazily when the first conversation
   * is created for a workspace.
   */
  async initialize(): Promise<void> {
    // Lazy init — nothing to do here.
  }

  async stop(): Promise<void> {
    await Promise.all([...this.workspaces.values()].map((e) => e.provider.stop()));
    this.workspaces.clear();
    this.conversationWorkspace.clear();
  }

  async forceStop(): Promise<void> {
    await Promise.all([...this.workspaces.values()].map((e) => e.provider.forceStop()));
    this.workspaces.clear();
    this.conversationWorkspace.clear();
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  async ping(): Promise<boolean> {
    if (this.workspaces.size === 0) return false;
    const results = await Promise.all([...this.workspaces.values()].map((e) => e.provider.ping()));
    return results.some(Boolean);
  }

  getClientState(): HarnessClientState {
    if (this.workspaces.size === 0) return 'starting';
    const states = [...this.workspaces.values()].map((e) => e.provider.getClientState());
    if (states.some((s) => s === 'running')) return 'running';
    if (states.some((s) => s === 'starting')) return 'starting';
    if (states.some((s) => s === 'error')) return 'error';
    return 'stopped';
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventHandlers.add(handler);
    // Also subscribe to any already-active workspace providers
    for (const [key, entry] of this.workspaces) {
      if (!this.workspaceEventUnsubs.has(key)) {
        const unsub = entry.provider.onClientEvent((e) => this.fanOutClientEvent(e));
        this.workspaceEventUnsubs.set(key, unsub);
      }
    }
    return () => this.clientEventHandlers.delete(handler);
  }

  // ── Capabilities ──────────────────────────────────────────────────

  capabilities(): ProviderCapabilities {
    // Use the first initialized provider's capabilities; fall back to a
    // single-instance default when no workspace is active yet.
    for (const entry of this.workspaces.values()) {
      if (entry.initialized) return entry.provider.capabilities();
    }
    // Default (mirrors CopilotProvider defaults) — no workspace yet
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: true,
      mcpServers: false,
      skillDirectories: false,
      fullToolGating: true,
      sessionPersistence: true,
      budgetTracking: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    // Return models from the first initialized workspace provider.
    for (const entry of this.workspaces.values()) {
      if (entry.initialized) {
        const models = await entry.provider.getModels();
        if (models.length > 0) return models;
      }
    }
    // No initialized workspace — attempt to get from the default workspace.
    const defaultKey = this.baseOptions.defaultCwd ?? '';
    const entry = await this.ensureWorkspace(defaultKey);
    await this.waitForInit(entry);
    return entry.provider.getModels();
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const key = this.workspaceKeyFor(params);
    const entry = await this.ensureWorkspace(key);
    await this.waitForInit(entry);
    entry.lastUsedAt = Date.now();
    this.conversationWorkspace.set(params.conversationId, key);
    return entry.provider.createConversation(params);
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const entry = await this.resolveEntry(conversationId, params);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    return entry.provider.resumeConversation(conversationId, params);
  }

  hasLiveConversation(conversationId: string): boolean {
    const key = this.conversationWorkspace.get(conversationId);
    if (!key) return false;
    return this.workspaces.get(key)?.provider.hasLiveConversation(conversationId) ?? false;
  }

  async listConversations(): Promise<string[]> {
    const results = await Promise.all(
      [...this.workspaces.values()].map((e) => e.provider.listConversations()),
    );
    return results.flat();
  }

  async getLastConversationId(): Promise<string | null> {
    for (const [, entry] of [...this.workspaces].reverse()) {
      const id = await entry.provider.getLastConversationId();
      if (id) return id;
    }
    return null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const entry = this.entryFor(conversationId);
    if (!entry) return;
    await entry.provider.deleteConversation(conversationId);
    this.conversationWorkspace.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const entry = this.entryFor(conversationId);
    if (!entry) return;
    await entry.provider.destroyConversation(conversationId);
    this.conversationWorkspace.delete(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.entryFor(conversationId)?.provider.getConversationWarnings(conversationId) ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    return this.entryFor(conversationId)?.provider.selectAgent(conversationId, agentName);
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    return this.entryFor(conversationId)?.provider.listAgents(conversationId) ?? [];
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    const entry = this.entryFor(conversationId);
    if (!entry) throw new Error(`WorkspacedCopilotPool: no conversation "${conversationId}"`);
    entry.lastUsedAt = Date.now();
    return entry.provider.sendPrompt(conversationId, prompt, attachments, options);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const entry = this.entryFor(conversationId);
    if (!entry) throw new Error(`WorkspacedCopilotPool: no conversation "${conversationId}"`);
    entry.lastUsedAt = Date.now();
    return entry.provider.sendPromptAndWait(conversationId, prompt, attachments, signal, options);
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.entryFor(conversationId)?.provider.getMessages(conversationId) ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    return this.entryFor(conversationId)?.provider.abortConversation(conversationId);
  }

  // ── Events ────────────────────────────────────────────────────────

  onConversationEvent(
    conversationId: string,
    handler: Listener<AgentEvent>,
  ): UnsubFn {
    const entry = this.entryFor(conversationId);
    if (!entry) return () => { /* noop */ };
    return entry.provider.onConversationEvent(conversationId, handler);
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Derive the workspace key for a conversation.
   * Uses `params.workingDirectory` when present; falls back to `options.defaultCwd`.
   * An empty string key means "no specific workspace" (uses the shared default client).
   */
  private workspaceKeyFor(params: CreateConversationParams): string {
    return params.workingDirectory ?? this.baseOptions.defaultCwd ?? '';
  }

  /**
   * Get or create a WorkspaceEntry for the given key.
   * If the pool is at capacity, evicts the LRU workspace first.
   */
  private async ensureWorkspace(key: string): Promise<WorkspaceEntry> {
    const existing = this.workspaces.get(key);
    if (existing) return existing;

    // Evict LRU workspace if at capacity
    if (this.workspaces.size >= this.maxWorkspaces) {
      await this.evictLru();
    }

    // Create a new provider for this workspace
    const provider = new CopilotProvider({
      ...this.baseOptions,
      defaultCwd: key || this.baseOptions.defaultCwd,
    });

    const entry: WorkspaceEntry = {
      provider,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      initializing: false,
      initWaiters: [],
      initialized: false,
    };
    this.workspaces.set(key, entry);

    // Wire up client events from this workspace to the pool's fan-out
    const unsub = provider.onClientEvent((e) => this.fanOutClientEvent(e));
    this.workspaceEventUnsubs.set(key, unsub);

    // Kick off initialization asynchronously
    this.startInit(key, entry);

    return entry;
  }

  /** Start (or re-use) the initialization of a workspace entry. */
  private startInit(key: string, entry: WorkspaceEntry): void {
    if (entry.initializing || entry.initialized) return;
    entry.initializing = true;

    const doInit = async () => {
      let releaseCold: (() => void) | undefined;
      try {
        if (this.supervisor) {
          releaseCold = await this.supervisor.acquireColdStart();
          this.supervisor.registerInstance(key);
        }
        await entry.provider.initialize();
        entry.initialized = true;
        entry.initializing = false;
        // Notify all waiters
        for (const resolve of entry.initWaiters) resolve(null);
        entry.initWaiters = [];
      } catch (err) {
        entry.initializing = false;
        const error = err instanceof Error ? err : new Error(String(err));
        for (const resolve of entry.initWaiters) resolve(error);
        entry.initWaiters = [];
        // Remove the failed entry so it can be retried
        this.workspaces.delete(key);
        const unsub = this.workspaceEventUnsubs.get(key);
        if (unsub) { unsub(); this.workspaceEventUnsubs.delete(key); }
        throw error;
      } finally {
        releaseCold?.();
      }
    };

    void doInit();
  }

  /** Wait until the entry's initialize() has completed (or re-throw its error). */
  private waitForInit(entry: WorkspaceEntry): Promise<void> {
    if (entry.initialized) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      entry.initWaiters.push((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Evict the least-recently-used workspace entry. */
  private async evictLru(): Promise<void> {
    let lruKey: string | undefined;
    let lruTime = Infinity;
    for (const [key, entry] of this.workspaces) {
      if (entry.lastUsedAt < lruTime) {
        lruTime = entry.lastUsedAt;
        lruKey = key;
      }
    }
    if (!lruKey) return;

    const entry = this.workspaces.get(lruKey);
    if (entry) {
      try { await entry.provider.stop(); } catch { /* best effort */ }
    }
    this.workspaces.delete(lruKey);
    const unsub = this.workspaceEventUnsubs.get(lruKey);
    if (unsub) { unsub(); this.workspaceEventUnsubs.delete(lruKey); }
    this.supervisor?.unregisterInstance(lruKey);

    // Remove any lingering conversation→workspace mappings for the evicted workspace
    for (const [convId, wsKey] of this.conversationWorkspace) {
      if (wsKey === lruKey) this.conversationWorkspace.delete(convId);
    }
  }

  /** Look up the WorkspaceEntry for an existing conversation. */
  private entryFor(conversationId: string): WorkspaceEntry | undefined {
    const key = this.conversationWorkspace.get(conversationId);
    if (!key) return undefined;
    return this.workspaces.get(key);
  }

  /**
   * Resolve or create the entry for a conversation that may have been loaded
   * from a prior session (resume flow). When the conversation isn't in our
   * map yet but `params` provides a workingDirectory, register it.
   */
  private async resolveEntry(
    conversationId: string,
    params?: CreateConversationParams,
  ): Promise<WorkspaceEntry | undefined> {
    const existing = this.entryFor(conversationId);
    if (existing) return existing;
    if (!params) return undefined;
    // Treat resume as a late-binding create
    const key = this.workspaceKeyFor(params);
    const entry = await this.ensureWorkspace(key);
    this.conversationWorkspace.set(conversationId, key);
    return entry;
  }

  /** Fan-out a client event from any workspace to all external handlers. */
  private fanOutClientEvent(event: HarnessClientEvent): void {
    for (const h of this.clientEventHandlers) h(event);
  }
}
