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
  HarnessRuntimeDiagnostics,
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
} from '@generatorai/core';
import { HarnessConnectionError } from '@generatorai/shared';
import type { HarnessRegistry } from './HarnessRegistry.js';
import { ALL_HARNESS_TYPES } from './HarnessRegistry.js';
import type { HarnessType } from './types.js';
import type { IProviderInstanceRegistry, ProviderInstanceId } from '@generatorai/core';

/** Persists conversation→provider ownership so it survives a restart. */
export interface ConversationOwnershipStore {
  load(): Promise<Array<{ conversationId: string; harnessType: string }>>;
  save(conversationId: string, harnessType: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
}

/**
 * W34 — the binding queries `IProviderInstanceRegistry` (in `@generatorai/core`)
 * does not expose.
 *
 * Duck-typed rather than added to the core port because the port lives in a
 * package this change may not edit. `ProviderInstanceRegistry` implements it;
 * a registry that does not simply keeps the pre-W34 behaviour.
 */
interface BindingAwareInstanceRegistry {
  orphanedBindingFor(conversationId: string): { missingInstanceId: ProviderInstanceId } | null;
  clearBinding(conversationId: string): void;
}

function asBindingAware(
  registry: IProviderInstanceRegistry | undefined,
): BindingAwareInstanceRegistry | undefined {
  const candidate = registry as unknown as Partial<BindingAwareInstanceRegistry> | undefined;
  return typeof candidate?.orphanedBindingFor === 'function' &&
    typeof candidate?.clearBinding === 'function'
    ? (candidate as BindingAwareInstanceRegistry)
    : undefined;
}

/**
 * W34 — a thread bound to a provider instance that no longer exists.
 *
 * Thrown instead of falling back to another account. The acceptance criterion
 * is explicit that this must NOT degrade quietly: *"a thread whose configured
 * instance has been deleted refuses to resume and starts a new provider
 * session, rather than resuming against a different account."* Resuming a
 * cursor issued by account A against account B is a cross-account data leak,
 * not a graceful degradation.
 */
export class ProviderInstanceUnavailableError extends Error {
  readonly code = 'PROVIDER_INSTANCE_UNAVAILABLE';
  constructor(
    readonly conversationId: string,
    readonly missingInstanceId: ProviderInstanceId,
  ) {
    super(
      `[MultiHarness] Conversation '${conversationId}' is bound to provider instance ` +
        `'${missingInstanceId}', which is no longer configured. Refusing to route it to a ` +
        `different account — start a new provider session for this thread instead.`,
    );
    this.name = 'ProviderInstanceUnavailableError';
  }
}

/**
 * Model ids that mean "let the provider pick" rather than naming a model.
 *
 * Every vendor spells this differently — Copilot publishes `auto` in its
 * catalog, claude-agent publishes `default` — so a sentinel looked up in the
 * shared catalog resolves to whichever provider happens to use that spelling.
 * That is an accident of vocabulary, not a routing decision, so sentinels are
 * excluded from provider resolution entirely.
 */
const ROUTING_SENTINEL_MODELS: ReadonlySet<string> = new Set(['auto', 'default', 'inherit', '']);

function isRoutingSentinel(model: string | undefined): boolean {
  return model === undefined || ROUTING_SENTINEL_MODELS.has(model.trim().toLowerCase());
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

  /**
   * W34 — when set, conversation routing prefers a SPECIFIC provider
   * instance (an account/credential set — see `HarnessRegistry.getInstance`)
   * over the driver-type-only path above. This is what actually closes the
   * L17 gap: `instanceTypeMap` alone can only ever resolve a `providerInstanceId`
   * down to a driver family and reuse the ONE shared adapter for that family
   * (the pre-fix ceiling); this registry is consulted for ownership so two
   * conversations can be pinned to two DIFFERENT accounts of the same driver
   * and never collide.
   *
   * Optional and additive: every method below still falls back to the
   * existing type-based `owners` map when this is undefined, when a
   * conversation has no assigned instance, or when the resolved instance was
   * never registered with `HarnessRegistry.registerInstance()` — so a
   * deployment that never configures multiple accounts behaves exactly as
   * it did before this field existed.
   */
  private instanceRegistry?: IProviderInstanceRegistry;

  constructor(
    private readonly registry: HarnessRegistry,
    private readonly store?: ConversationOwnershipStore,
    private readonly logger?: { info: (m: string) => void; warn: (m: string) => void },
    instanceRegistry?: IProviderInstanceRegistry,
  ) {
    this.instanceRegistry = instanceRegistry;
  }

  /**
   * Wire (or replace) the instance registry after construction — composition-root
   * builds `MultiHarness` before the instance registry finishes hydrating from
   * `harness_instances`, so this lets it attach the registry once ready rather
   * than threading a not-yet-populated one through the constructor.
   */
  setInstanceRegistry(instanceRegistry: IProviderInstanceRegistry): void {
    this.instanceRegistry = instanceRegistry;
  }

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
   * Drop a model the target provider does not offer, so it can fall back to
   * its own default instead of rejecting a name it has never heard of.
   *
   * This is the second half of the sentinel problem, and it bites in two ways:
   *
   *  1. **Sentinels.** `resolveTarget` correctly refuses to *route* on `auto`,
   *     but the literal string still travelled to the provider as a model
   *     name. claude-agent then answered "There's an issue with the selected
   *     model (auto). It may not exist or you may not have access to it." —
   *     zero tokens, no answer, the same "no output at all" symptom as the
   *     routing bug it sits behind.
   *
   *  2. **Foreign real models.** Because an established binding now outranks a
   *     model-name inference, a chat bound to claude-agent carrying a stale
   *     Copilot-only id (`gpt-5.5`) stays on claude-agent — and would hand it
   *     that id and fail identically. Keeping the binding is right; passing
   *     the foreign name along with it is not.
   *
   * Dropping rather than translating is deliberate: a sentinel *means* "you
   * choose", and omitting the field is exactly the path a brand-new chat with
   * no model already takes, so it is known-good rather than a mapping table
   * that has to be kept in step with five vendors' vocabularies.
   *
   * Only strips when the target's catalog is actually KNOWN and lacks the
   * model. An unprobed provider reports an empty catalog, and treating that as
   * "offers nothing" would strip every legitimate model during the boot
   * window.
   */
  private withModelSupportedBy(
    target: HarnessType,
    params: CreateConversationParams | undefined,
  ): CreateConversationParams | undefined {
    const model = params?.model;
    if (!params || !model) return params;

    const offered = this.registry.statusSnapshot?.[target]?.models ?? [];
    if (offered.length === 0) return params; // catalog unknown — do not guess
    if (offered.some((m) => m.id === model)) return params;

    this.logger?.info(
      `[MultiHarness] '${target}' does not offer model '${model}'` +
        `${isRoutingSentinel(model) ? " (a provider-agnostic sentinel — it spells its own differently)" : ''}` +
        ' — letting the provider choose its default instead of passing a name it will reject',
    );
    const { model: _dropped, ...rest } = params;
    return rest as CreateConversationParams;
  }

  /**
   * The provider already bound to `conversationId`, or `undefined` for a
   * genuinely new conversation. Unlike `ownerOf` this does NOT fall back to
   * the primary — routing has to be able to tell "bound to the primary" apart
   * from "not bound to anything yet", because only the former may veto a
   * model-driven provider change.
   */
  private existingOwnerFor(conversationId: string | undefined): HarnessType | undefined {
    return conversationId ? this.owners.get(conversationId) : undefined;
  }

  /**
   * Decide which provider should run a conversation.
   *
   * Priority order (L17 — providerInstanceId is the authoritative routing key):
   *  1. `params.providerInstanceId` → look up in instanceTypeMap (when populated).
   *  2. Explicit `params.harnessType`.
   *  3. Model-catalog lookup — but never for a provider-agnostic sentinel, and
   *     never against an established binding the current provider can serve.
   *  4. The conversation's current owner, when it has one.
   *  5. Primary provider.
   *
   * Finding-1 fix: `providerInstanceId` is now checked FIRST. The `instanceTypeMap`
   * is populated by callers that wire a ProviderInstanceRegistry (deferred: not yet
   * wired in composition-root; see docs/V2_IMPLEMENTATION_TRACKER.md Finding-1).
   * Until that wiring is complete, a supplied providerInstanceId falls through to
   * harnessType/model resolution, which is safe — it just loses the L17 guarantee
   * that the specific instance is used, not just the correct provider family.
   *
   * `current` is the provider that already owns this conversation, when there is
   * one. It matters because moving an ESTABLISHED conversation between providers
   * is destructive — `resumeConversation` destroys the provider-side session and
   * starts a fresh one, discarding the agent context — so a move must never be
   * *inferred*. See `isRoutingSentinel` for the specific way that used to happen.
   */
  private async resolveTarget(
    params: CreateConversationParams,
    current?: HarnessType,
  ): Promise<HarnessType> {
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

    // A sentinel means "provider, you choose a model" — it is not a routing
    // instruction, and it is spelled differently by each vendor ('auto' for
    // Copilot, 'default' for claude-agent). Resolving it through the shared
    // catalog therefore answers "which provider happens to spell its sentinel
    // this way", which is not the question. That is a live defect, not a
    // hypothetical: the web composer's default model is 'auto', only Copilot
    // lists 'auto', so EVERY claude-agent chat resolved to Copilot on its
    // first prompt and had its Claude session destroyed underneath it.
    if (params.model && !isRoutingSentinel(params.model)) {
      const byModel = await this.registry.resolveProviderForModel(params.model);
      // For an established conversation, a model lookup may only CONFIRM the
      // current provider, never override it. Overriding is destructive (the
      // session is torn down and restarted elsewhere), so it takes an explicit
      // harnessType or providerInstanceId above — never an inference from a
      // string that may be a stale stored default or another vendor's alias.
      if (byModel && (!current || byModel === current)) return byModel;
      if (byModel && current) {
        this.logger?.info(
          `[MultiHarness] model '${params.model}' maps to '${byModel}' but conversation is bound to ` +
            `'${current}' — keeping the established binding. Pass an explicit harnessType to move it.`,
        );
      }
    }

    return current ?? this.defaultTarget();
  }

  /**
   * Provider to use when nothing in the request picks one.
   *
   * `registry.primary` is pure configuration — it is whatever `harness.type`
   * says (default `'copilot'`) and carries no claim that the provider can
   * actually serve a conversation. Returning it blind is a real failure, not a
   * theoretical one: an unauthenticated Copilot still reports `connected:true`
   * (its stdio client resolves `start()` before the child is known good), so a
   * chat created with no model routed to it and only died at the first
   * JSON-RPC write to the dead stdin — surfacing as `ERR_STREAM_DESTROYED`,
   * normalized to a bare 502 "Action failed" with no hint that another
   * provider was sitting there ready.
   *
   * This has nothing to do with the host OS — it reproduces on any machine
   * where the primary provider is not signed in — so the fix is readiness,
   * not a platform branch. Prefer `primary`, fall back to whatever is ready,
   * and fail with a provider-specific reason when nothing is.
   */
  private defaultTarget(): HarnessType {
    const primary = this.registry.primary;
    // A registry that exposes no status at all (a narrow test double, or a
    // future implementation) must not be able to break routing — an absent
    // snapshot says nothing about readiness, so it is treated exactly like
    // "not probed yet" below rather than as evidence against `primary`.
    const snapshot = this.registry.statusSnapshot as
      | Readonly<Record<string, { ready?: boolean; checkedAt?: number; error?: string } | undefined>>
      | undefined;
    const primaryStatus = snapshot?.[primary];

    // `checkedAt == null` means no probe has completed yet. On a cold boot
    // every provider looks unready, and demoting `primary` there would route
    // the first conversation somewhere the user never asked for. Trust the
    // configured provider until a probe actually contradicts it.
    if (primaryStatus?.ready || primaryStatus?.checkedAt == null) return primary;

    const [fallback] = this.registry.readyTypes ?? [];
    if (fallback) {
      this.logger?.warn(
        `[MultiHarness] primary provider '${primary}' is not ready` +
          `${primaryStatus.error ? ` (${primaryStatus.error})` : ''} — routing to '${fallback}' instead. ` +
          `Sign in to '${primary}' or set a default model to silence this.`,
      );
      return fallback;
    }

    const reasons = ALL_HARNESS_TYPES.map((type) => {
      const status = snapshot?.[type];
      return `${type}: ${status?.error ?? (status?.ready ? 'ready' : 'not ready')}`;
    }).join('; ');
    throw new HarnessConnectionError(
      `No agent provider is ready. Sign in to a provider in Settings → Model Providers, ` +
        `or pick a model from one that is available. Provider status — ${reasons}`,
      primary,
    );
  }

  /**
   * W34 — the SPECIFIC provider instance that owns `conversationId`, when
   * one was actually assigned AND that instance is registered with the
   * registry (i.e. `HarnessRegistry.registerInstance()` was called for it).
   * Returns `undefined` for every conversation that predates instance-level
   * routing, or when no instance registry is wired at all — the caller then
   * falls back to the type-level `owners` map, unchanged from before W34.
   */
  private resolveInstance(conversationId: string): ProviderInstanceId | undefined {
    const found = this.instanceRegistry?.resolveForConversation(conversationId);
    if (!found) return undefined;
    if (!this.registry.hasInstance(found.id)) return undefined;
    return found.id;
  }

  /**
   * W34 — the instance id a thread is bound to when that instance has been
   * DELETED, or `null` when the thread is either unbound or bound to a live
   * instance.
   *
   * `resolveInstance()` cannot express this: it returns `undefined` for both
   * "never bound" (where falling back to the default account is correct) and
   * "bound to a deleted account" (where falling back is the bug). Every caller
   * that routes must check this first.
   */
  private orphanedInstanceFor(conversationId: string): ProviderInstanceId | null {
    const bindingAware = asBindingAware(this.instanceRegistry);
    const orphan = bindingAware?.orphanedBindingFor(conversationId);
    return orphan ? orphan.missingInstanceId : null;
  }

  /**
   * Throws when `conversationId` is bound to a deleted instance.
   *
   * Deliberately fails loudly rather than degrading: routing this thread
   * anywhere else means replaying one account's session against another.
   */
  private assertInstanceAvailable(conversationId: string): void {
    const missing = this.orphanedInstanceFor(conversationId);
    if (missing) throw new ProviderInstanceUnavailableError(conversationId, missing);
  }

  /** Adapter that owns `conversationId`, brought up if necessary. */
  private adapterFor(conversationId: string): Promise<IAgentHarness> {
    /* W34 — refuse before routing, never after. */
    this.assertInstanceAvailable(conversationId);
    const instanceId = this.resolveInstance(conversationId);
    if (instanceId) return this.registry.getInstance(instanceId);
    return this.registry.get(this.ownerOf(conversationId));
  }

  // ── Conversation lifecycle ──

  async createConversation(params: CreateConversationParams): Promise<string> {
    // W34/L17 — an explicit, REGISTERED instance takes priority over the
    // driver-type path: it is the only way two accounts of the same driver
    // stay distinguishable rather than collapsing onto one shared adapter.
    if (params.providerInstanceId && this.registry.hasInstance(params.providerInstanceId)) {
      const instanceId = params.providerInstanceId;
      const adapter = await this.registry.getInstance(instanceId);
      // for the legacy owners map / status displays
      const target = await this.resolveTarget(params, this.existingOwnerFor(params.conversationId));
      const id = await adapter.createConversation(
        this.withModelSupportedBy(target, params) as CreateConversationParams,
      );
      this.owners.set(id, target);
      if (params.conversationId && params.conversationId !== id) this.owners.set(params.conversationId, target);
      await this.instanceRegistry?.assignConversation(id, instanceId).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to persist instance ownership for ${id} → ${instanceId}: ${e}`),
      );
      /* W34-N6 */ await this.store?.save(id, target).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to persist ownership for ${id} → ${target}: ${e}`),
      );
      this.logger?.info(`[MultiHarness] conversation ${id} → instance '${instanceId}' (model=${params.model ?? 'default'})`);
      return id;
    }

    // `ChatManagementService.ensureConversation` re-enters here to rebuild a
    // chat whose in-process session was lost (server restart, or a prior
    // archive), reusing the SAME conversationId. That is a RECOVERY, not a new
    // chat, and the binding for it survives in `owners` (rehydrated at boot) —
    // so the established provider must win over a model-name inference here
    // exactly as it does on the resume path.
    const target = await this.resolveTarget(params, this.existingOwnerFor(params.conversationId));
    const adapter = await this.registry.get(target);
    const id = await adapter.createConversation(
      this.withModelSupportedBy(target, params) as CreateConversationParams,
    );
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

  /**
   * Route a pre-warm to whichever provider owns the conversation.
   *
   * Never resolves a target the way `resumeConversation` does: warming is
   * best-effort, and a conversation whose owner is not yet known has nothing
   * to warm. Binding one here would let a warm-up decide routing, which is the
   * owner map's job.
   */
  async prewarmConversation(conversationId: string, turnOptions?: SendPromptOptions): Promise<void> {
    const owner = this.owners.get(conversationId);
    if (!owner) return;
    try {
      const adapter = await this.registry.get(owner);
      await adapter.prewarmConversation?.(conversationId, turnOptions);
    } catch {
      // Best-effort by contract: the first turn pays what it pays today.
    }
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const current = this.owners.get(conversationId);
    // `current` is passed so a model-name inference cannot silently move an
    // established conversation to another provider — see `resolveTarget`.
    // Same readiness rule as creation: resuming a conversation with no
    // recorded owner must not land on a provider that cannot serve it.
    const target = params ? await this.resolveTarget(params, current) : (current ?? this.defaultTarget());

    // W34 — the thread is bound to an account that has since been deleted.
    //
    // Acceptance criterion: refuse to RESUME (the provider-side cursor belongs
    // to the deleted account and must never be replayed against another one)
    // and start a FRESH provider session instead. Our own message history
    // lives in the DB and is untouched; only the provider-side agent context
    // restarts. Falling through to `adapter.resumeConversation` here is the
    // exact bug — it hands account B a cursor account A issued.
    const orphanedInstanceId = this.orphanedInstanceFor(conversationId);
    if (orphanedInstanceId) {
      this.logger?.warn(
        `[MultiHarness] conversation ${conversationId} was bound to deleted provider instance ` +
          `'${orphanedInstanceId}' — starting a NEW provider session on '${target}' rather than ` +
          `resuming against a different account`,
      );
      asBindingAware(this.instanceRegistry)?.clearBinding(conversationId);
      this.owners.set(conversationId, target);
      await this.store?.save(conversationId, target).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to persist ownership for ${conversationId} → ${target}: ${e}`),
      );
      const freshAdapter = await this.registry.get(target);
      await freshAdapter.createConversation({
        ...(this.withModelSupportedBy(target, params) ?? {}),
        conversationId,
      } as CreateConversationParams);
      return;
    }

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
      await adapter.createConversation({
        ...(this.withModelSupportedBy(target, params) as CreateConversationParams),
        conversationId,
      });
      return;
    }

    this.owners.set(conversationId, target);
    const adapter = await this.registry.get(target);
    return adapter.resumeConversation(conversationId, this.withModelSupportedBy(target, params));
  }

  conversationHarness(conversationId: string): HarnessType {
    return this.ownerOf(conversationId);
  }

  getProviderSessionId(conversationId: string): string | undefined {
    if (this.orphanedInstanceFor(conversationId)) return undefined;
    const instanceId = this.resolveInstance(conversationId);
    const adapter = instanceId
      ? this.registry.peekInstance(instanceId)
      : this.registry.peek(this.ownerOf(conversationId));
    return adapter?.getProviderSessionId?.(conversationId);
  }

  /**
   * A fork stays with the provider that owns the source: the new conversation
   * is recorded under the same owner (and instance) before the adapter is
   * asked, so later calls for it route the same way.
   */
  async forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    const adapter = await this.adapterFor(conversationId);
    if (!adapter.forkConversation) throw new Error('This provider cannot fork conversations');
    const owner = this.owners.get(conversationId);
    if (owner) {
      this.owners.set(options.newConversationId, owner);
      await this.store?.save(options.newConversationId, owner).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to persist ownership for fork ${options.newConversationId} → ${owner}: ${e}`),
      );
    }
    const instanceId = this.resolveInstance(conversationId);
    if (instanceId) {
      await this.instanceRegistry?.assignConversation(options.newConversationId, instanceId).catch((e: unknown) =>
        this.logger?.warn(`[MultiHarness] Failed to bind fork ${options.newConversationId} to instance ${instanceId}: ${e}`),
      );
    }
    return adapter.forkConversation(conversationId, options);
  }

  async rewindConversation(conversationId: string, options: RewindConversationOptions): Promise<ForkConversationResult> {
    const adapter = await this.adapterFor(conversationId);
    if (!adapter.rewindConversation) throw new Error('This provider cannot rewind conversations');
    return adapter.rewindConversation(conversationId, options);
  }

  hasLiveConversation(conversationId: string): boolean {
    // W34 — a thread bound to a deleted account has no live session anywhere.
    // Peeking the fallback adapter here would report another account's session
    // as this thread's, which is the same cross-account confusion
    // `adapterFor` refuses. This is a read, so it answers false rather than
    // throwing.
    if (this.orphanedInstanceFor(conversationId)) return false;
    const instanceId = this.resolveInstance(conversationId);
    const adapter = instanceId
      ? this.registry.peekInstance(instanceId)
      : this.registry.peek(this.ownerOf(conversationId));
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
    // W34 — teardown must still succeed for a thread whose account was
    // deleted. There is no provider-side session left to delete (it went with
    // the account), so skip the adapter call rather than letting
    // `adapterFor()` throw and strand the row forever.
    if (!this.orphanedInstanceFor(conversationId)) {
      const adapter = await this.adapterFor(conversationId);
      await adapter.deleteConversation(conversationId);
    }
    this.forgetConversation(conversationId);
    /* W34-N6 */ await this.store?.remove(conversationId).catch((e: unknown) =>
      this.logger?.warn(`[MultiHarness] Failed to remove ownership for ${conversationId}: ${e}`),
    );
  }

  async destroyConversation(conversationId: string): Promise<void> {
    if (!this.orphanedInstanceFor(conversationId)) {
      const adapter = await this.adapterFor(conversationId);
      await adapter.destroyConversation(conversationId);
    }
    this.forgetConversation(conversationId);
    /* W34-N6 */ await this.store?.remove(conversationId).catch((e: unknown) =>
      this.logger?.warn(`[MultiHarness] Failed to remove ownership for ${conversationId}: ${e}`),
    );
  }

  /**
   * Drop every trace of a conversation from the routing tables.
   *
   * W34 — the instance binding is cleared here too. Previously it was
   * deliberately leaked ("a leak, not a correctness risk"), which was true
   * only while a stale binding degraded silently. Now that a stale binding
   * makes the thread refuse to route, leaving one behind after a delete would
   * poison any future thread that reused the id.
   */
  private forgetConversation(conversationId: string): void {
    this.owners.delete(conversationId);
    asBindingAware(this.instanceRegistry)?.clearBinding(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    // W34 — never read another account's warnings for an orphaned thread.
    if (this.orphanedInstanceFor(conversationId)) return [];
    const instanceId = this.resolveInstance(conversationId);
    const adapter = instanceId
      ? this.registry.peekInstance(instanceId)
      : this.registry.peek(this.ownerOf(conversationId));
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

  runtimeDiagnostics(): HarnessRuntimeDiagnostics {
    // Same rule as `ping()`: never `registry.get()` here — this is on the
    // health path and must not boot a CLI. Only adapters that already exist.
    const total: HarnessRuntimeDiagnostics = { liveConversations: 0, liveSessions: 0, warmSessions: 0, providers: {} };
    for (const type of ALL_HARNESS_TYPES) {
      const adapter = this.registry.peek(type);
      const diag = adapter?.runtimeDiagnostics?.();
      if (!diag) continue;
      total.liveConversations += diag.liveConversations;
      total.liveSessions += diag.liveSessions;
      total.warmSessions += diag.warmSessions;
      total.providers![type] = {
        liveConversations: diag.liveConversations,
        liveSessions: diag.liveSessions,
        warmSessions: diag.warmSessions,
        ...(diag.maxLiveSessions !== undefined ? { maxLiveSessions: diag.maxLiveSessions } : {}),
        ...(diag.turnsInFlight !== undefined ? { turnsInFlight: diag.turnsInFlight } : {}),
        ...(diag.maxConcurrentTurns !== undefined ? { maxConcurrentTurns: diag.maxConcurrentTurns } : {}),
        ...(diag.turnsQueued !== undefined ? { turnsQueued: diag.turnsQueued } : {}),
      };
    }
    return total;
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
        approvalGating: 'none',
        hostTools: 'none',
        structuredOutput: 'none',
        skills: 'none',
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
      // Levels: the weakest level any ready provider declares.
      approvalGating: weakest(caps.map((c) => c.approvalGating), ['per_call', 'exec_and_patch', 'none']),
      hostTools: weakest(caps.map((c) => c.hostTools), ['full', 'start_only', 'none']),
      structuredOutput: weakest(caps.map((c) => c.structuredOutput), ['native', 'tool', 'none']),
      skills: caps.every((c) => c.skills === caps[0]!.skills) ? caps[0]!.skills : 'none',
      sessionPersistence: caps.every((c) => c.sessionPersistence),
      budgetTracking: caps.every((c) => c.budgetTracking),
      conversationFork: caps.every((c) => c.conversationFork === true),
      conversationRewind: caps.every((c) => c.conversationRewind === true),
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
  /** The provider a conversation with these params routes to; never throws. */
  async resolveProvider(params: { conversationId?: string; harnessType?: string; model?: string }): Promise<string | undefined> {
    try {
      return await this.resolveTarget(
        {
          conversationId: params.conversationId ?? '',
          ...(params.harnessType ? { harnessType: params.harnessType } : {}),
          ...(params.model ? { model: params.model } : {}),
        } as CreateConversationParams,
        this.existingOwnerFor(params.conversationId),
      );
    } catch {
      return undefined;
    }
  }

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

/** The weakest of `levels`, where `order` runs strongest → weakest. */
function weakest<T extends string>(levels: T[], order: readonly T[]): T {
  let worst = 0;
  for (const l of levels) worst = Math.max(worst, order.indexOf(l));
  return order[worst] ?? order[order.length - 1]!;
}
