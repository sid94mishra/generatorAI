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
  ProviderWireProtocol,
} from '@generatorai/core';

// ── W34 — ProviderRuntimeBinding ─────────────────────────────────

/**
 * How a thread came to be bound to its instance.
 *
 * This exists because the three origins have genuinely different trust levels
 * and the UI must be able to tell them apart (REV2 migration rule). A binding
 * we *chose* under ambiguity is not the same fact as one the user configured,
 * and silently presenting them identically is how a thread ends up resuming
 * against an account its owner never picked.
 */
export type BindingOrigin =
  /** Written by `assignConversation` at the time the thread was created. */
  | 'explicit'
  /** Migrated: `provider` was set and exactly one instance of that driver existed. */
  | 'migrated-unambiguous'
  /**
   * Migrated: `provider` was set but several instances of that driver existed,
   * so the driver's default instance was chosen. Surfaced in the UI so a user
   * can correct it — we guessed, and we record that we guessed.
   */
  | 'migrated-ambiguous';

/**
 * W34 — the full runtime binding for one thread.
 *
 * Track 3 specifies `{threadId, provider, providerInstanceId, adapterKey,
 * resumeCursor, runtimePayload, runtimeMode}`. The pre-existing storage was
 * `conversation_instance_ownership(conversation_id, instance_id, updated_at)` —
 * only two of those seven fields.
 *
 * `provider` (the credential/account family) and the instance's `protocol`
 * (the wire API) are deliberately separate fields, not one: N-4 — GitHub
 * Copilot serves three wire APIs from a single credential, so collapsing them
 * makes a protocol switch look like an account change and loses ownership.
 *
 * `resumeCursor` is OPAQUE. Nothing outside the owning adapter may parse it,
 * and it is only ever replayed when `providerInstanceId` still matches — a
 * cursor is meaningful only to the account that issued it.
 */
export interface ProviderRuntimeBinding {
  /** The conversation/thread this binding belongs to. */
  threadId: string;
  /** Credential/account family — the driver, not the wire protocol (N-4). */
  provider: string;
  /** The only routing key (L17). */
  providerInstanceId: ProviderInstanceId;
  /** Which adapter implementation serves this binding. */
  adapterKey: string;
  /** Opaque provider-side resume token. Never parsed here. */
  resumeCursor?: string;
  /** Adapter-defined payload carried across a restart. Never parsed here. */
  runtimePayload?: Readonly<Record<string, unknown>>;
  /** Wire protocol currently in use for this binding (N-4's `api` axis). */
  runtimeMode?: ProviderWireProtocol;
  /** How this binding was established. */
  bindingOrigin: BindingOrigin;
}

/**
 * Persistence port. The DB-backed implementation lives in
 * `@generatorai/db` (SqliteConversationOwnershipRepository) and is injected;
 * this interface keeps the registry free of DB imports.
 *
 * Finding-2 fix: field names are now `conversationId` and `instanceId` to
 * match what `SqliteConversationOwnershipRepository.load()` returns and what
 * `hydrate()` consumes. The original names (`instanceId`, `harnessType`) were
 * semantically inverted — a maintenance trap for any future implementor.
 *
 * W34: `loadBindings`/`saveBinding` are OPTIONAL so that a store which has not
 * been migrated to the full {@link ProviderRuntimeBinding} shape can omit them
 * and let the registry degrade to the narrow pair. The shipped SQLite store
 * (`SqliteConversationInstanceOwnershipRepository`, migration 44) implements
 * both — B1: for the whole of W34 it implemented neither, so the six columns
 * migration 44 added had no writer and no reader and five of the binding's
 * seven fields died with the process.
 *
 * A store may return BOTH shapes: `loadBindings()` yields the rows written
 * whole, `load()` yields every row including the ones that predate the full
 * shape. `hydrate()` therefore reads both — see its comment.
 */
export interface ProviderInstanceStore {
  load(): Promise<Array<{ conversationId: string; instanceId: string }>>;
  save(conversationId: string, instanceId: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
  /** Full-shape read. Preferred over `load()` when the store supports it. */
  loadBindings?(): Promise<ProviderRuntimeBinding[]>;
  /** Full-shape write. Preferred over `save()` when the store supports it. */
  saveBinding?(binding: ProviderRuntimeBinding): Promise<void>;
}

/**
 * A thread whose recorded binding names an instance that no longer exists.
 *
 * This is a distinct outcome from "no binding at all", and conflating the two
 * is precisely the W34 acceptance-criterion failure: an unbound thread may
 * safely fall back to the default account, but a thread bound to a DELETED
 * account must never silently resume against a different one.
 */
export interface OrphanedBinding {
  binding: ProviderRuntimeBinding;
  /** The instance id that is recorded but no longer registered. */
  missingInstanceId: ProviderInstanceId;
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
  /**
   * threadId → the full binding.
   *
   * W34: this deliberately outlives the instance it names. When an account is
   * deleted the binding STAYS, because "this thread belonged to account A,
   * which is gone" is the fact callers need in order to refuse to resume. If
   * we dropped the row with the instance, the thread would become
   * indistinguishable from a never-bound one and would silently fall back.
   */
  private readonly bindings = new Map<string, ProviderRuntimeBinding>();
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
   * W34 — remove a configured instance (the user deleted the account).
   *
   * Bindings that name it are deliberately NOT deleted; see {@link bindings}.
   * Returns whether an instance was actually removed.
   */
  unregister(id: ProviderInstanceId): boolean {
    const removed = this.instances.delete(id);
    if (this.primaryId === id) {
      // Promote an arbitrary survivor rather than leaving a dangling primary,
      // which would make `primary()` return undefined and break new chats.
      this.primaryId = this.instances.keys().next().value as ProviderInstanceId | undefined;
    }
    return removed;
  }

  /**
   * Rehydrate conversation ownership from the durable store on server startup.
   * Must be called before the first conversation is routed.
   *
   * W34 — promotion happens HERE, at the persistence boundary, and nowhere
   * else. Runtime callers must never infer a binding (REV2). A row read back
   * as a bare `{conversationId, instanceId}` predates the full binding shape,
   * so it is promoted according to the REV2 table before any routing sees it.
   */
  async hydrate(): Promise<void> {
    if (!this.store) return;

    // Full-shape rows first, and they WIN: a binding that was written whole
    // records what actually happened (including the opaque cursor and the
    // 'explicit' origin), whereas promotion can only re-guess it from the
    // instances configured right now — and might land on a different account.
    if (this.store.loadBindings) {
      for (const b of await this.store.loadBindings()) {
        this.bindings.set(b.threadId, b);
      }
    }

    // B1: then the legacy rows. This used to `return` above, on the assumption
    // that a store which understands the full shape has no old rows — but the
    // full shape arrived as a migration on a table that was already in use, so
    // a real database holds BOTH. Returning early dropped every pre-W34
    // conversation on the floor: no binding, no promotion, silent fallback to
    // the default account. Rows already restored above are skipped, so a
    // written binding is never overwritten by a guess.
    const rows = await this.store.load();
    for (const r of rows) {
      if (this.bindings.has(r.conversationId)) continue;
      // Finding-2 fix: r.conversationId is the map key; r.instanceId is the value.
      const promoted = this.promoteLegacyRow(r.conversationId, r.instanceId as ProviderInstanceId);
      if (promoted) this.bindings.set(r.conversationId, promoted);
    }
  }

  /**
   * REV2 migration rule, applied on read for rows written before the full
   * binding shape existed.
   *
   * | Existing state                                   | Promotion                       |
   * |--------------------------------------------------|---------------------------------|
   * | instance id resolves to exactly one instance     | bind, `migrated-unambiguous`    |
   * | driver known, several instances of that driver   | bind to default, `…-ambiguous`  |
   * | instance unknown / driver unknown                | LEAVE UNBOUND (returns null)    |
   *
   * The last row is the important one: an unbound thread must never resume
   * with someone else's cursor, so we decline to guess and let the next turn
   * re-initialise a fresh provider session.
   */
  private promoteLegacyRow(
    conversationId: string,
    instanceId: ProviderInstanceId,
  ): ProviderRuntimeBinding | null {
    const exact = this.instances.get(instanceId);
    if (exact) {
      return {
        threadId: conversationId,
        provider: exact.driverType,
        providerInstanceId: exact.id,
        adapterKey: exact.driverType,
        runtimeMode: exact.protocol,
        bindingOrigin: 'migrated-unambiguous',
      };
    }

    // The id is unknown. Its `<driverType>:<suffix>` prefix is the only signal
    // left about which account family it belonged to.
    const colonIdx = instanceId.indexOf(':');
    if (colonIdx <= 0) return null;
    const driver = instanceId.slice(0, colonIdx);
    const sameDriver = [...this.instances.values()].filter((i) => i.driverType === driver);
    if (sameDriver.length === 0) return null;

    if (sameDriver.length === 1) {
      const only = sameDriver[0]!;
      return {
        threadId: conversationId,
        provider: only.driverType,
        providerInstanceId: only.id,
        adapterKey: only.driverType,
        runtimeMode: only.protocol,
        bindingOrigin: 'migrated-unambiguous',
      };
    }

    // Several candidates — bind to the driver's default and RECORD that this
    // was a guess so the UI can surface it (REV2 `migrated-ambiguous`).
    const preferred =
      (this.primaryId && sameDriver.find((i) => i.id === this.primaryId)) ??
      sameDriver.find((i) => i.enabled) ??
      sameDriver[0]!;
    return {
      threadId: conversationId,
      provider: preferred.driverType,
      providerInstanceId: preferred.id,
      adapterKey: preferred.driverType,
      runtimeMode: preferred.protocol,
      bindingOrigin: 'migrated-ambiguous',
    };
  }

  // ── W34 — binding reads ───────────────────────────────────────

  /**
   * The recorded binding for a thread, INDEPENDENT of whether the instance it
   * names still exists.
   *
   * `resolveForConversation()` cannot answer this: it returns the instance
   * object, so it yields `undefined` both for "never bound" and for "bound to
   * a deleted account". Callers that must tell those apart use this instead.
   */
  bindingFor(conversationId: string): ProviderRuntimeBinding | undefined {
    return this.bindings.get(conversationId);
  }

  /**
   * Non-null when the thread IS bound but its instance has been deleted.
   * `null` for both a live binding and no binding at all.
   */
  orphanedBindingFor(conversationId: string): OrphanedBinding | null {
    const binding = this.bindings.get(conversationId);
    if (!binding) return null;
    if (this.instances.has(binding.providerInstanceId)) return null;
    return { binding, missingInstanceId: binding.providerInstanceId };
  }

  /**
   * Forget a thread's binding entirely (thread deleted, or rebound).
   *
   * B1: the durable row goes with it. While nothing was persisted beyond the
   * two-column pair this was survivable; now that a binding round-trips, an
   * in-memory-only clear is undone by the next restart — and because a
   * binding to a deleted instance makes the thread REFUSE to route
   * (`orphanedBindingFor`), the resurrected row would strand that thread
   * permanently, which is worse than the leak it replaced.
   *
   * Stays synchronous because every caller (`MultiHarness.forgetConversation`,
   * the orphan-rebind path) is on a teardown route where a store error must
   * not abort the operation: the in-memory clear has already succeeded and is
   * what routing reads. The SQLite DELETE itself runs synchronously inside
   * `remove()`, so the row is gone before this returns.
   */
  clearBinding(conversationId: string): void {
    this.bindings.delete(conversationId);
    void this.store?.remove(conversationId).catch(() => undefined);
  }

  // ── IProviderInstanceRegistry ──

  listAll(): ReadonlyArray<IProviderInstance> {
    return [...this.instances.values()];
  }

  listEnabled(): ReadonlyArray<IProviderInstance> {
    return [...this.instances.values()].filter((i) => i.enabled);
  }

  resolveForConversation(conversationId: string): IProviderInstance | undefined {
    const binding = this.bindings.get(conversationId);
    if (!binding) return undefined;
    return this.instances.get(binding.providerInstanceId);
  }

  async assignConversation(conversationId: string, instanceId: ProviderInstanceId): Promise<void> {
    const instance = this.instances.get(instanceId);
    const binding: ProviderRuntimeBinding = {
      threadId: conversationId,
      // Fall back to the id's `<driverType>:<suffix>` prefix when the instance
      // is not (yet) registered, so the binding still records WHICH account
      // family it belongs to rather than an empty string.
      provider: instance?.driverType ?? instanceId.split(':')[0] ?? 'unknown',
      providerInstanceId: instanceId,
      adapterKey: instance?.driverType ?? instanceId.split(':')[0] ?? 'unknown',
      runtimeMode: instance?.protocol,
      bindingOrigin: 'explicit',
    };
    this.bindings.set(conversationId, binding);
    // Persist via store so ownership survives restarts (P1-42 fix).
    if (this.store?.saveBinding) {
      await this.store.saveBinding(binding).catch(() => undefined);
    } else {
      await this.store?.save(conversationId, instanceId).catch(() => undefined);
    }
  }

  findById(id: ProviderInstanceId): IProviderInstance | undefined {
    return this.instances.get(id);
  }

  primary(): IProviderInstance | undefined {
    if (!this.primaryId) return undefined;
    return this.instances.get(this.primaryId);
  }
}
