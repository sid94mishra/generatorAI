// ────────────────────────────────────────────────────────────────
// HarnessRegistry — runs EVERY installed provider side by side.
//
// The original design bound the whole process to a single provider chosen at
// boot (`HARNESS_TYPE`), so a chat could only ever talk to Copilot *or*
// Claude. This registry instead owns one adapter per provider type, brings
// each up lazily on first use, and reports live readiness for all of them.
//
// "Ready" means *the provider can actually run a turn*:
//   installed (SDK resolves) → connected (initialize() succeeds)
//   → authenticated (a model catalog AND working credentials)
//
// Listing models is necessary but not sufficient: the Claude CLI answers
// `supportedModels()` from a local table even with no credentials, so a
// catalog-only check reported a logged-out provider as ready and the picker
// happily offered models whose every turn failed with "Please run /login".
// Providers that can report account state are therefore asked for it.
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness, HarnessModel } from '@generatorai/core';
import { createHarnessProvider } from './HarnessFactory.js';
import type { HarnessType, HarnessProviderConfig } from './types.js';

/**
 * Optional credential probe. Providers that can distinguish "installed" from
 * "logged in" implement this; those that can't are judged on their catalog.
 */
interface AccountAware {
  getAccountInfo(): Promise<{
    tokenSource?: string;
    apiKeySource?: string;
    email?: string;
    organization?: string;
    subscriptionType?: string;
    apiProvider?: string;
  }>;
}

function isAccountAware(a: unknown): a is AccountAware {
  return typeof (a as AccountAware)?.getAccountInfo === 'function';
}

/**
 * Decide whether an account probe proves the provider has NO credentials.
 *
 * Returns a message only on POSITIVE evidence of being logged out. An absent
 * field is not evidence: providers report whatever their CLI happens to
 * expose, and treating "didn't say" as "logged out" locks a working account
 * out of the model picker.
 *
 * Concretely, the Claude SDK's initialization result carries
 * `{ email, organization, subscriptionType, apiProvider }` and never populates
 * `tokenSource` / `apiKeySource`. Requiring those fields marked a fully
 * authenticated Claude Enterprise account as "Not logged in" and emptied its
 * catalog.
 */
export function credentialFailure(account: {
  tokenSource?: string;
  apiKeySource?: string;
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiProvider?: string;
}): string | undefined {
  const hasKey = !!account.apiKeySource && account.apiKeySource !== 'none';
  if (hasKey) return undefined;

  // Any identity the CLI can name means it resolved a credential to name it.
  const hasIdentity =
    !!account.email ||
    !!account.organization ||
    !!account.subscriptionType ||
    !!account.apiProvider;
  if (hasIdentity) return undefined;

  // Only an EXPLICIT 'none' is a verdict. `undefined` means "not reported".
  if (account.tokenSource === 'none') {
    return 'Not logged in — run the provider CLI login to authenticate.';
  }

  return undefined;
}

/** Every provider this build knows about, in display order. */
export const ALL_HARNESS_TYPES: readonly HarnessType[] = ['copilot', 'claude-agent'] as const;

/** Human label for a provider type. */
export function harnessTypeLabel(type: HarnessType): string {
  switch (type) {
    case 'copilot': return 'GitHub Copilot';
    // The provider is the Claude Agent SDK (Claude Code), not the raw
    // Anthropic API — label and brand it accordingly.
    case 'claude-agent': return 'Claude Code';
    default: return type;
  }
}

/** Live readiness + catalog for one provider. */
export interface HarnessProviderStatus {
  type: HarnessType;
  label: string;
  /** SDK package resolves in this install. */
  installed: boolean;
  /** `initialize()` succeeded — the CLI/client is running. */
  connected: boolean;
  /** The provider returned a model catalog, so credentials work. */
  authenticated: boolean;
  /** True when the provider can actually be used for a conversation. */
  ready: boolean;
  /** Live catalog (empty unless `ready`). */
  models: HarnessModel[];
  /** Why the provider isn't ready, when it isn't. */
  error?: string;
  /** When the catalog was last refreshed (epoch ms). */
  checkedAt?: number;
}

interface Entry {
  adapter: IAgentHarness | null;
  initializing: Promise<IAgentHarness> | null;
  status: HarnessProviderStatus;
}

export interface HarnessRegistryOptions {
  /**
   * Provider construction options, keyed the same way `createHarnessProvider`
   * expects. The registry supplies `type` itself.
   */
  buildConfig: (type: HarnessType) => HarnessProviderConfig;
  /** Provider used when a caller doesn't name one. */
  primary: HarnessType;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  /** How long a readiness probe stays fresh. Default 5 min. */
  statusTtlMs?: number;
}

export class HarnessRegistry {
  private readonly entries = new Map<HarnessType, Entry>();
  private readonly opts: HarnessRegistryOptions;
  private readonly statusTtlMs: number;
  private _primary: HarnessType;
  private refreshInFlight: Promise<HarnessProviderStatus[]> | null = null;

  constructor(opts: HarnessRegistryOptions) {
    this.opts = opts;
    this._primary = opts.primary;
    this.statusTtlMs = opts.statusTtlMs ?? 5 * 60_000;
    for (const type of ALL_HARNESS_TYPES) {
      this.entries.set(type, {
        adapter: null,
        initializing: null,
        status: {
          type,
          label: harnessTypeLabel(type),
          installed: false,
          connected: false,
          authenticated: false,
          ready: false,
          models: [],
        },
      });
    }
  }

  /** Provider used when a request doesn't specify one. */
  get primary(): HarnessType {
    return this._primary;
  }

  setPrimary(type: HarnessType): void {
    this._primary = type;
  }

  /** Types that currently pass the full readiness check. */
  get readyTypes(): HarnessType[] {
    return [...this.entries.values()].filter((e) => e.status.ready).map((e) => e.status.type);
  }

  /**
   * Get (and lazily bring up) the adapter for a provider.
   *
   * Concurrent callers share a single in-flight initialization so we never
   * spawn two CLIs for the same provider.
   */
  async get(type: HarnessType): Promise<IAgentHarness> {
    const entry = this.entries.get(type);
    if (!entry) throw new Error(`Unknown harness type: "${type}"`);
    if (entry.adapter) return entry.adapter;
    if (entry.initializing) return entry.initializing;

    entry.initializing = (async () => {
      const adapter = await createHarnessProvider(this.opts.buildConfig(type));
      entry.status.installed = true;
      await adapter.initialize();
      entry.status.connected = true;
      entry.adapter = adapter;
      this.opts.logger?.info(`[HarnessRegistry] '${type}' initialized`);
      return adapter;
    })();

    try {
      return await entry.initializing;
    } catch (err) {
      // Leave the entry un-adapted so a later call can retry (e.g. after the
      // user logs in) rather than caching the failure forever.
      entry.status.error = (err as Error).message;
      entry.status.ready = false;
      throw err;
    } finally {
      entry.initializing = null;
    }
  }

  /** The already-initialized adapter for a type, if any. */
  peek(type: HarnessType): IAgentHarness | null {
    return this.entries.get(type)?.adapter ?? null;
  }

  /** Last known status for every provider (may be stale — see `refresh`). */
  getStatuses(): HarnessProviderStatus[] {
    return ALL_HARNESS_TYPES.map((t) => ({ ...this.entries.get(t)!.status }));
  }

  /**
   * Probe every provider and return fresh statuses + live catalogs.
   *
   * Providers are probed in parallel and one provider's failure never masks
   * another's success. Results are cached for `statusTtlMs` because a cold
   * probe spawns a CLI and can take ~10s.
   */
  async refresh(force = false): Promise<HarnessProviderStatus[]> {
    const fresh = (e: Entry): boolean =>
      !force && e.status.checkedAt != null && Date.now() - e.status.checkedAt < this.statusTtlMs;

    if (!force && [...this.entries.values()].every(fresh)) return this.getStatuses();
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      await Promise.all(
        ALL_HARNESS_TYPES.map(async (type) => {
          const entry = this.entries.get(type)!;
          if (fresh(entry)) return;
          try {
            const adapter = await this.get(type);
            const models = await adapter.getModels();

            // A catalog alone doesn't prove the account can run a turn — the
            // Claude CLI lists models offline. Ask for credential state when
            // the provider exposes it; a probe failure is not fatal (we fall
            // back to the catalog signal) but an explicit "no credentials"
            // is, because every turn would fail at send time.
            let credentialError: string | undefined;
            if (isAccountAware(adapter)) {
              try {
                credentialError = credentialFailure(await adapter.getAccountInfo());
              } catch {
                // Probe unavailable on this build; keep the catalog verdict.
              }
            }

            const usable = models.length > 0 && !credentialError;
            entry.status = {
              ...entry.status,
              installed: true,
              connected: true,
              // An empty catalog means the CLI answered but the account has no
              // entitlements — treat that as "not usable" rather than ready.
              authenticated: usable,
              ready: usable,
              // Don't advertise a catalog the account can't actually use.
              models: usable ? models : [],
              checkedAt: Date.now(),
            };
            if (credentialError) entry.status.error = credentialError;
            else delete entry.status.error;
          } catch (err) {
            const message = (err as Error).message ?? String(err);
            entry.status = {
              ...entry.status,
              // `installed` stays true once we've proven the module resolves.
              authenticated: false,
              ready: false,
              models: [],
              error: message,
              checkedAt: Date.now(),
            };
            this.opts.logger?.warn(`[HarnessRegistry] '${type}' unavailable: ${message}`);
          }
        }),
      );
      return this.getStatuses();
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  /**
   * Every model from every ready provider, each tagged with its owning
   * provider so the caller can route a later conversation correctly.
   */
  async getAllModels(force = false): Promise<HarnessModel[]> {
    const statuses = await this.refresh(force);
    return statuses
      .filter((s) => s.ready)
      .flatMap((s) => s.models.map((m) => ({ ...m, provider: m.provider ?? s.type })));
  }

  /**
   * Which provider owns a model id, based on the live catalogs.
   * Returns `null` when no ready provider advertises the id.
   */
  async resolveProviderForModel(modelId: string): Promise<HarnessType | null> {
    const statuses = await this.refresh();
    for (const s of statuses) {
      if (!s.ready) continue;
      if (s.models.some((m) => m.id === modelId)) return s.type;
    }
    return null;
  }

  /** Shut every initialized provider down. */
  async shutdownAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (e) => {
        if (!e.adapter) return;
        try { await e.adapter.shutdown(); } catch { /* best effort */ }
        e.adapter = null;
        e.status.connected = false;
        e.status.ready = false;
      }),
    );
  }
}
