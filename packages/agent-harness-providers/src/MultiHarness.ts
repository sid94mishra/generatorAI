// ────────────────────────────────────────────────────────────────
// MultiHarness — an IAgentHarness that fans out across every provider.
//
// This is the piece that lets one chat run on Claude while a background task
// runs on Copilot, or stage 1 of a workflow use Opus and stage 2 use GPT-5.
//
// It works by remembering which provider created each conversation. Callers
// keep using the same `IAgentHarness` API they always did — only
// `createConversation` gained an optional `harnessType`/`model` hint — and
// every conversation-scoped call (sendPrompt, abort, getMessages, …) is routed
// back to the adapter that owns that conversation. Routing a conversation to
// the wrong provider would hand an SDK a session id it has never seen, so the
// ownership map is the single most important invariant here.
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
  AgentEvent,
  ConversationWarning,
  HarnessAgentInfo,
  ProviderCapabilities,
} from '@generatorai/core';
import type { HarnessRegistry } from './HarnessRegistry.js';
import { ALL_HARNESS_TYPES } from './HarnessRegistry.js';
import type { HarnessType } from './types.js';
import type { ProviderInstanceId } from '@generatorai/core';

/** Persists conversation→provider ownership so it survives a restart. */
export interface ConversationOwnershipStore {
  load(): Promise<Array<{ conversationId: string; harnessType: string }>>;
  save(conversationId: string, harnessType: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
}

export class MultiHarness implements IAgentHarness {
  /** conversationId → the provider that created it. */
  private readonly owners = new Map<string, HarnessType>();
  private readonly clientEventHandlers = new Set<(event: HarnessClientEvent) => void>();
  private readonly clientEventUnsubs = new Map<HarnessType, () => void>();
  /**
   * W34 / L17 — ProviderInstanceId → HarnessType translation table.
   *
   * Populated by callers that wire a ProviderInstanceRegistry. When undefined
   * (the deferred case), providerInstanceId routing falls through to harnessType
   * resolution (safe but loses the specific-instance guarantee).
   *
   * Finding-1: this was entirely absent before; the fix adds the routing path
   * and the population API (`setInstanceTypeMap`). Composition-root will call
   * `setInstanceTypeMap` once ProviderInstanceRegistry is fully activated.
   */
  private instanceTypeMap?: ReadonlyMap<ProviderInstanceId, HarnessType>;

  constructor(
    private readonly registry: HarnessRegistry,
    private readonly store?: ConversationOwnershipStore,
    private readonly logger?: { info: (m: string) => void; warn: (m: string) => void },
  ) {}

  /**
   * Provide a ProviderInstanceId → HarnessType lookup table so that
   * `createConversation` can honour L17 routing from `params.providerInstanceId`.
   *
   * Call this once at startup after populating the ProviderInstanceRegistry:
   * ```ts
   * const map = new Map(
   *   [...registry.listAll()].map((i) => [i.id, i.driverType as HarnessType])
   * );
   * multiHarness.setInstanceTypeMap(map);
   * ```
   */
  setInstanceTypeMap(map: ReadonlyMap<ProviderInstanceId, HarnessType>): void {
    this.instanceTypeMap = map;
  }

  /** Provider used when a caller doesn't name one. */
  get harnessType(): HarnessType {
    return this.registry.primary;
  }

  /** Rehydrate conversation ownership after a restart. */
  async hydrate(): Promise<void> {
    if (!this.store) return;
    const rows = await this.store.load();
    for (const r of rows) {
      if (r.conversationId && r.harnessType) {
        this.owners.set(r.conversationId, r.harnessType as HarnessType);
      }
    }
    this.logger?.info(`[MultiHarness] Rehydrated ${this.owners.size} conversation owner(s)`);
  }

  /** The provider that owns a conversation (falls back to primary). */
  ownerOf(conversationId: string): HarnessType {
    return this.owners.get(conversationId) ?? this.registry.primary;
  }

  /**
   * Decide which provider should run a new conversation.
   *
   * Priority order (L17 — providerInstanceId is the authoritative routing key):
   *  1. `params.providerInstanceId` → look up in instanceTypeMap (when populated).
   *  2. Explicit `params.harnessType`.
   *  3. Model-catalog lookup.
   *  4. Primary provider.
   *
   * Finding-1 fix: `providerInstanceId` is now checked FIRST. The `instanceTypeMap`
   * is populated by callers that wire a ProviderInstanceRegistry (deferred: not yet
   * wired in composition-root; see docs/V2_IMPLEMENTATION_TRACKER.md Finding-1).
   * Until that wiring is complete, a supplied providerInstanceId falls through to
   * harnessType/model resolution, which is safe — it just loses the L17 guarantee
   * that the specific instance is used, not just the correct provider family.
   */
  private async resolveTarget(params: CreateConversationParams): Promise<HarnessType> {
    // L17: ProviderInstanceId takes priority over all other routing hints.
    /* W34-M3 */
    if (params.providerInstanceId) {
      // 1. Try the explicit lookup table (populated by setInstanceTypeMap once
      //    ProviderInstanceRegistry is wired in composition-root).
      if (this.instanceTypeMap) {
        const mapped = this.instanceTypeMap.get(params.providerInstanceId);
        if (mapped) return mapped;
        this.logger?.warn(
          `[MultiHarness] providerInstanceId '${params.providerInstanceId}' not in instanceTypeMap — trying inline parse`,
        );
      }
      // 2. Fallback: parse the driver prefix from the ProviderInstanceId itself.
      //    ProviderInstanceIds are encoded as `<driverType>:<suffix>`, so
      //    `claude-agent:default` → driver 'claude-agent'. This allows routing to
      //    work even before the full ProviderInstanceRegistry is wired (W34 deferred
      //    wiring — see docs/V2_IMPLEMENTATION_TRACKER.md M3 note).
      const colonIdx = params.providerInstanceId.indexOf(':');
      if (colonIdx > 0) {
        const driverPrefix = params.providerInstanceId.slice(0, colonIdx) as HarnessType;
        if (ALL_HARNESS_TYPES.includes(driverPrefix)) {
          this.logger?.info(
            `[MultiHarness] providerInstanceId '${params.providerInstanceId}' resolved via prefix → '${driverPrefix}'`,
          );
          return driverPrefix;
        }
      }
    }
    const explicit = params.harnessType as HarnessType | undefined;
    if (explicit) return explicit;
    if (params.model) {
      const byModel = await this.registry.resolveProviderForModel(params.model);
      if (byModel) return byModel;
    }
    return this.registry.primary;
  }

  /** Adapter that owns `conversationId`, brought up if necessary. */
  private adapterFor(conversationId: string): Promise<IAgentHarness> {
    return this.registry.get(this.ownerOf(conversationId));
  }

  // ── Conversation lifecycle ──

  async createConversation(params: CreateConversationParams): Promise<string> {
    const target = await this.resolveTarget(params);
    const adapter = await this.registry.get(target);
    const id = await adapter.createConversation(params);
    this.owners.set(id, target);
    // Also key by the requested id: some providers echo back a different id,
    // and callers may address the conversation by either.
    if (params.conversationId && params.conversationId !== id) {
      this.owners.set(params.conversationId, target);
    }
    /* W34-N6 */ await this.store?.save(id, target).catch((e: unknown) =>
      this.logger?.warn(`[MultiHarness] Failed to persist ownership for ${id} → ${target}: ${e}`),
    );
    this.logger?.info(`[MultiHarness] conversation ${id} → '${target}' (model=${params.model ?? 'default'})`);
    return id;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const current = this.owners.get(conversationId);
    const target = params ? await this.resolveTarget(params) : (current ?? this.registry.primary);

    // Provider changed (the user picked a model belonging to a different
    // provider, or named one explicitly). An SDK session can't move between
    // providers, so retire it on the old one and start a fresh conversation on
    // the new one. Our own message history lives in the DB and is unaffected;
    // only the provider-side agent context restarts.
    if (current && target !== current) {
      this.logger?.info(
        `[MultiHarness] conversation ${conversationId} moving '${current}' → '${target}' (model=${params?.model ?? 'default'})`,
      );
      try {
        const previous = await this.registry.get(current);
        await previous.destroyConversation(conversationId);
      } catch {
        // The old provider may already have dropped it — not fatal.
      }
      this.owners.set(conversationId, target);
      /* W34-N6 */ await this.store?.save(conversationId, target).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to persist ownership for ${conversationId} → ${target}: ${e}`),
      );
      const adapter = await this.registry.get(target);
      await adapter.createConversation({ ...(params as CreateConversationParams), conversationId });
      return;
    }

    this.owners.set(conversationId, target);
    const adapter = await this.registry.get(target);
    return adapter.resumeConversation(conversationId, params);
  }

  hasLiveConversation(conversationId: string): boolean {
    const adapter = this.registry.peek(this.ownerOf(conversationId));
    return adapter?.hasLiveConversation(conversationId) ?? false;
  }

  async listConversations(): Promise<string[]> {
    const ids = await Promise.all(
      this.registry.readyTypes.map(async (t) => {
        try { return await (await this.registry.get(t)).listConversations(); } catch { return []; }
      }),
    );
    return [...new Set(ids.flat())];
  }

  async getLastConversationId(): Promise<string | null> {
    const adapter = await this.registry.get(this.registry.primary);
    return adapter.getLastConversationId();
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const adapter = await this.adapterFor(conversationId);
    await adapter.deleteConversation(conversationId);
    this.owners.delete(conversationId);
    /* W34-N6 */ await this.store?.remove(conversationId).catch((e: unknown) =>
      this.logger?.warn(`[MultiHarness] Failed to remove ownership for ${conversationId}: ${e}`),
    );
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const adapter = await this.adapterFor(conversationId);
    await adapter.destroyConversation(conversationId);
    this.owners.delete(conversationId);
    /* W34-N6 */ await this.store?.remove(conversationId).catch((e: unknown) =>
      this.logger?.warn(`[MultiHarness] Failed to remove ownership for ${conversationId}: ${e}`),
    );
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    const adapter = this.registry.peek(this.ownerOf(conversationId));
    return adapter?.getConversationWarnings(conversationId) ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    const adapter = await this.adapterFor(conversationId);
    return adapter.selectAgent(conversationId, agentName);
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    const adapter = await this.adapterFor(conversationId);
    return adapter.listAgents(conversationId);
  }

  // ── Messaging ──

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    return (await this.adapterFor(conversationId)).sendPrompt(conversationId, prompt, attachments, options);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    return (await this.adapterFor(conversationId)).sendPromptAndWait(
      conversationId,
      prompt,
      attachments,
      signal,
      options,
    );
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return (await this.adapterFor(conversationId)).getMessages(conversationId);
  }

  async abortConversation(conversationId: string): Promise<void> {
    return (await this.adapterFor(conversationId)).abortConversation(conversationId);
  }

  // ── Events ──

  onConversationEvent(conversationId: string, handler: (event: AgentEvent) => void): () => void {
    // Subscription is synchronous in the port, but resolving the adapter is
    // not — bridge the gap with a deferred unsubscribe.
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void this.adapterFor(conversationId)
      .then((adapter) => {
        if (cancelled) return;
        cleanup = adapter.onConversationEvent(conversationId, handler);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientEventHandlers.add(handler);
    // Attach to whichever providers are already up; `attachClientEvents` wires
    // any that come up later.
    for (const type of this.registry.readyTypes) this.attachClientEvents(type);
    return () => { this.clientEventHandlers.delete(handler); };
  }

  /** Forward one provider's client events to every registered handler. */
  private attachClientEvents(type: HarnessType): void {
    if (this.clientEventUnsubs.has(type)) return;
    const adapter = this.registry.peek(type);
    if (!adapter) return;
    const unsub = adapter.onClientEvent((event) => {
      for (const h of this.clientEventHandlers) {
        try { h(event); } catch { /* a bad handler must not break the fan-out */ }
      }
    });
    this.clientEventUnsubs.set(type, unsub);
  }

  // ── Client lifecycle ──

  async initialize(): Promise<void> {
    // Bring up the primary eagerly so the app is usable immediately; other
    // providers start on first use (or when the UI probes readiness).
    await this.registry.get(this.registry.primary);
    this.attachClientEvents(this.registry.primary);
  }

  async stop(): Promise<void> {
    await Promise.all(this.registry.readyTypes.map(async (t) => {
      try { await (await this.registry.get(t)).stop(); } catch { /* best effort */ }
    }));
  }

  async forceStop(): Promise<void> {
    await Promise.all(this.registry.readyTypes.map(async (t) => {
      try { await (await this.registry.get(t)).forceStop(); } catch { /* best effort */ }
    }));
  }

  getClientState(): HarnessClientState {
    // The app is "running" when at least one provider is; this keeps existing
    // health UI meaningful without inventing a new aggregate state.
    const states = this.registry.readyTypes
      .map((t) => this.registry.peek(t)?.getClientState())
      .filter((s): s is HarnessClientState => !!s);
    if (states.includes('running')) return 'running';
    if (states.includes('starting')) return 'starting';
    if (states.length > 0 && states.every((s) => s === 'error')) return 'error';
    return this.registry.peek(this.registry.primary)?.getClientState() ?? 'stopped';
  }

  async ping(): Promise<boolean> {
    // Liveness must be derived from adapters that are actually up, NOT from
    // `registry.readyTypes`. `readyTypes` is populated only by a status
    // refresh (`registry.refresh()`), which is driven by the harness-status
    // route; on a freshly booted server nothing has called it yet, so
    // `readyTypes` is `[]` and `[].some(Boolean)` is `false` — reporting a
    // perfectly healthy provider as dead until someone opens the UI.
    //
    // Prefer the refreshed verdict when we have one, otherwise fall back to
    // every already-initialized adapter. We never call `registry.get()` here:
    // ping is on the /api/health path and must not lazily boot a CLI.
    const candidates = this.registry.readyTypes.length > 0
      ? this.registry.readyTypes
      : ALL_HARNESS_TYPES.filter((t) => this.registry.peek(t) !== null);

    const results = await Promise.all(
      candidates.map(async (t) => {
        const adapter = this.registry.peek(t);
        if (!adapter) return false;
        try { return await adapter.ping(); } catch { return false; }
      }),
    );
    return results.some(Boolean);
  }

  async shutdown(): Promise<void> {
    for (const unsub of this.clientEventUnsubs.values()) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.clientEventUnsubs.clear();
    await this.registry.shutdownAll();
  }

  // ── Model discovery ──

  /** Merged live catalog across every ready provider. */
  getModels(): Promise<HarnessModel[]> {
    return this.registry.getAllModels();
  }

  // ── Capability declarations (W42 / N-2) ──

  /**
   * Returns the GLOBAL capability envelope: a feature is true only when
   * ALL ready providers declare it.
   *
   * Use this for system-wide checks ("does this deployment support MCP?").
   * Do NOT use this for per-conversation decisions — two providers may differ
   * in their capabilities, and a conversation runs on exactly one of them.
   *
   * Finding-6 fix: callers that need per-conversation capability (e.g. the
   * reasoning toggle, tool-gating checks) should call `capabilitiesFor(conversationId)`
   * instead so they get the owning adapter's own declaration.
   *
   * W42 — N-2 fix: capability discovery is by declaration, not by exception.
   */
  capabilities(): ProviderCapabilities {
    const adapters = ALL_HARNESS_TYPES
      .map((t) => this.registry.peek(t))
      .filter((a): a is IAgentHarness => a !== null && typeof (a as IAgentHarness).capabilities === 'function');

    if (adapters.length === 0) {
      // No adapters up yet — return the most conservative defaults.
      return {
        vision: false,
        reasoning: false,
        reasoningEfforts: [],
        planMode: false,
        mcpServers: false,
        skillDirectories: false,
        fullToolGating: false,
        sessionPersistence: false,
        budgetTracking: false,
      };
    }

    const caps = adapters.map((a) => a.capabilities());
    return {
      vision: caps.every((c) => c.vision),
      reasoning: caps.every((c) => c.reasoning),
      // N5 fix: union (not intersect) reasoning efforts — multi-provider
      // installs can do reasoning when at least ONE provider supports it.
      // An intersection would always yield [] whenever a non-reasoning
      // provider (e.g. Copilot) is also installed.
      /* W42-N5 */ reasoningEfforts: [
        ...new Set(caps.flatMap((c) => c.reasoningEfforts as Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>)),
      ],
      maxParallelTools: Math.min(...caps.map((c) => c.maxParallelTools ?? 8)),
      planMode: caps.every((c) => c.planMode),
      mcpServers: caps.every((c) => c.mcpServers),
      skillDirectories: caps.every((c) => c.skillDirectories),
      fullToolGating: caps.every((c) => c.fullToolGating),
      sessionPersistence: caps.every((c) => c.sessionPersistence),
      budgetTracking: caps.every((c) => c.budgetTracking),
    };
  }

  /**
   * Per-conversation capability query — routes to the provider that owns this
   * conversation and returns its own declared capabilities.
   *
   * Finding-6 fix: unlike `capabilities()` (global intersection), this method
   * reflects what the owning provider actually supports. Use this for:
   * - Reasoning toggle visibility
   * - Tool-gating enforcement checks
   * - Budget tracking availability
   *
   * Falls back to `capabilities()` if the conversation has no owner yet
   * (e.g. during construction before `createConversation` is called).
   */
  capabilitiesFor(conversationId: string): ProviderCapabilities {
    const harnessType = this.owners.get(conversationId);
    if (!harnessType) return this.capabilities();
    const adapter = this.registry.peek(harnessType);
    if (!adapter || typeof (adapter as IAgentHarness).capabilities !== 'function') {
      return this.capabilities();
    }
    return (adapter as IAgentHarness).capabilities();
  }
}
