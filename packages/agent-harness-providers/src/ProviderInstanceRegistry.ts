// ────────────────────────────────────────────────────────────────
// ProviderInstanceRegistry — W34 / L17 implementation.
//
// Manages N provider instances (one per account/credential set).
// Each instance has a persisted ProviderInstanceId that is the ONLY
// routing key (L17). Model names, driver names, and display names are
// never used as routing keys — they exist for discovery and display only.
//
// N-3 fix: Two Copilot accounts, two Claude accounts, or a mix are all
// representable. The registry keeps them as independent IProviderInstance
// entries keyed by their persisted id.
//
// N-4 fix: Driver family ('copilot') and wire protocol ('copilot-sdk')
// are separate axes. An instance can switch protocols without changing
// its id or losing conversation ownership.
// ────────────────────────────────────────────────────────────────

import type {
  IProviderInstance,
  IProviderInstanceRegistry,
  ProviderInstanceId,
} from '@generatorai/core';

/**
 * Persistence port. The DB-backed implementation lives in
 * `@generatorai/db` (SqliteConversationOwnershipRepository) and is injected;
 * this interface keeps the registry free of DB imports.
 *
 * Finding-2 fix: field names are now `conversationId` and `instanceId` to
 * match what `SqliteConversationOwnershipRepository.load()` returns and what
 * `hydrate()` consumes. The original names (`instanceId`, `harnessType`) were
 * semantically inverted — a maintenance trap for any future implementor.
 */
export interface ProviderInstanceStore {
  load(): Promise<Array<{ conversationId: string; instanceId: string }>>;
  save(conversationId: string, instanceId: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
}

/**
 * In-memory implementation of IProviderInstanceRegistry backed by an optional
 * durable store (injected, satisfying the Dependency Inversion principle).
 *
 * Instances are populated at startup from the configuration or DB (via
 * `register()`), then queried by callers that need to route a conversation.
 *
 * L17 compliance: `assignConversation` is the ONLY routing write path.
 */
export class ProviderInstanceRegistry implements IProviderInstanceRegistry {
  private readonly instances = new Map<ProviderInstanceId, IProviderInstance>();
  /** conversationId → ProviderInstanceId */
  private readonly conversationOwnership = new Map<string, ProviderInstanceId>();
  private primaryId: ProviderInstanceId | undefined;

  constructor(private readonly store?: ProviderInstanceStore) {}

  /**
   * Register a provider instance. Called during server bootstrap when the
   * harness configuration is resolved. The first registration is automatically
   * marked as primary unless `setPrimary()` is called.
   */
  register(instance: IProviderInstance): void {
    this.instances.set(instance.id, instance);
    if (!this.primaryId) {
      this.primaryId = instance.id;
    }
  }

  /**
   * Override which instance is the default. Must be called after `register()`.
   */
  setPrimary(id: ProviderInstanceId): void {
    if (!this.instances.has(id)) {
      throw new Error(`[ProviderInstanceRegistry] Cannot set primary: instance '${id}' not registered`);
    }
    this.primaryId = id;
  }

  /**
   * Rehydrate conversation ownership from the durable store on server startup.
   * Must be called before the first conversation is routed.
   */
  async hydrate(): Promise<void> {
    if (!this.store) return;
    const rows = await this.store.load();
    for (const r of rows) {
      // Finding-2 fix: r.conversationId is the map key; r.instanceId is the value.
      this.conversationOwnership.set(r.conversationId, r.instanceId as ProviderInstanceId);
    }
  }

  // ── IProviderInstanceRegistry ──

  listAll(): ReadonlyArray<IProviderInstance> {
    return [...this.instances.values()];
  }

  listEnabled(): ReadonlyArray<IProviderInstance> {
    return [...this.instances.values()].filter((i) => i.enabled);
  }

  resolveForConversation(conversationId: string): IProviderInstance | undefined {
    const instanceId = this.conversationOwnership.get(conversationId);
    if (!instanceId) return undefined;
    return this.instances.get(instanceId);
  }

  async assignConversation(conversationId: string, instanceId: ProviderInstanceId): Promise<void> {
    this.conversationOwnership.set(conversationId, instanceId);
    // Persist via store so ownership survives restarts (P1-42 fix).
    await this.store?.save(conversationId, instanceId).catch(() => undefined);
  }

  findById(id: ProviderInstanceId): IProviderInstance | undefined {
    return this.instances.get(id);
  }

  primary(): IProviderInstance | undefined {
    if (!this.primaryId) return undefined;
    return this.instances.get(this.primaryId);
  }
}
