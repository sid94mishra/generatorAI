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
//
// W41 — Demand-gated status refresh.
// The previous design awaited `refresh()` on every `getAllModels()` /
// `resolveProviderForModel()` call, causing a ~10 s stall on the first new
// chat after each 5-minute TTL expiry (P2-22). The current design:
//   • `statusSnapshot` — reads the current cached statuses SYNCHRONOUSLY.
//   • `requestRefresh()` — fire-and-forget; no-op if a refresh is in flight.
//   • `getAllModels()` / `resolveProviderForModel()` — use the snapshot
//     immediately and trigger a background refresh if the cache is stale.
//   • Disk cache — snapshot persisted as JSON after each refresh so a cold
//     boot returns stale-but-useful data instantly rather than blocking.
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness, HarnessModel, ProviderCapabilities, ProviderInstanceId } from '@generatorai/core';
import { createHarnessProvider } from './HarnessFactory.js';
import type { HarnessType, HarnessProviderConfig } from './types.js';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';

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
 * W41 — providers whose `getModels()` never throws report the reason for an
 * empty catalog here instead. Without this the registry loses the diagnostic:
 * `getModels()` returning `[]` used to be indistinguishable from "the account
 * genuinely has no entitlements".
 */
interface ModelProbeErrorAware {
  getLastModelProbeError(): string | undefined;
}

function isModelProbeErrorAware(a: unknown): a is ModelProbeErrorAware {
  return typeof (a as ModelProbeErrorAware)?.getLastModelProbeError === 'function';
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

/**
 * Every provider this build knows about, in display order.
 * W37/W38/W39: codex, opencode, acp added.
 *
 * NOTE: codex / opencode / acp are excluded from the automatic probe loop
 * because they require a live external binary/server to be useful. They are
 * probed only when explicitly configured via `HarnessRegistryOptions.buildConfig`.
 * The first two entries (copilot, claude-agent) are the "managed" providers
 * that the registry brings up automatically.
 */
export const ALL_HARNESS_TYPES: readonly HarnessType[] = [
  'copilot',
  'claude-agent',
  'codex',
  'opencode',
  'acp',
] as const;

/** The subset probed automatically — the two managed providers. */
const AUTO_PROBE_TYPES: readonly HarnessType[] = ['copilot', 'claude-agent'] as const;

/**
 * W48 — provider honesty. `codex` / `opencode` / `acp` were listed in
 * `ALL_HARNESS_TYPES` (so `get()` / `registerInstance()` can address them)
 * and shown by every UI that iterated that list, regardless of whether
 * `HarnessRegistryOptions.buildConfig` actually supplied their provider
 * section. Selecting one that wasn't configured failed the FIRST turn with
 * an opaque error instead of never being offered. `isConfigurable` is the
 * single source of truth a caller should filter on before presenting a type.
 */
const CONFIG_KEY_FOR_TYPE: Partial<Record<HarnessType, keyof HarnessProviderConfig>> = {
  codex: 'codex',
  opencode: 'opencode',
  acp: 'acp',
};

/**
 * W48 — capabilities `ProviderCapabilities` has no field for at all, so a
 * `false` in the struct can't surface them. Hooks are Claude/Copilot-only
 * plumbing (`HookExecutor` wiring); none of the three breadth adapters
 * implement them, and nothing in `capabilities()` says so.
 */
const UNMODELED_CAPABILITIES: Partial<Record<HarnessType, readonly string[]>> = {
  codex: ['hooks'],
  opencode: ['hooks'],
  acp: ['hooks'],
};

/** Human label for a provider type. */
export function harnessTypeLabel(type: HarnessType): string {
  switch (type) {
    case 'copilot': return 'GitHub Copilot';
    // The provider is the Claude Agent SDK (Claude Code), not the raw
    // Anthropic API — label and brand it accordingly.
    case 'claude-agent': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'opencode': return 'OpenCode';
    case 'acp': return 'ACP Agent';
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
  /**
   * W41 — this verdict was restored from the disk cache and has NOT been
   * re-verified by a live probe in this process. The catalog is still usable
   * for routing (that is the entire point of the cache: a cold boot answers
   * instantly instead of blocking on a ~10 s CLI spawn), but a UI may want to
   * mark it provisional. Cleared by the first successful live probe.
   */
  fromDiskCache?: boolean;
  /**
   * W41 — identity this verdict was measured against, written only into the
   * DISK cache (never kept in memory, so it does not leak into snapshots).
   *
   * A readiness verdict belongs to one ACCOUNT of one driver, not to a driver
   * name. Keying the cache by `type` alone meant a "ready, 12 models" verdict
   * measured for `copilot:work` was replayed for `copilot:personal`, and a
   * verdict for an instance the operator has since DISABLED was replayed as
   * though it were live. See {@link statusCacheKey}.
   */
  cacheKey?: string;
}

/**
 * W41 — the identity a cached status is valid for: instance ∧ driver ∧ enabled.
 *
 * `instanceId` is absent for the per-TYPE entries (the two auto-probed managed
 * providers), which are keyed on the driver alone because that is genuinely
 * what they describe.
 */
export function statusCacheKey(args: {
  driverType: HarnessType;
  instanceId?: ProviderInstanceId;
  enabled: boolean;
}): string {
  return `${args.instanceId ?? '__type__'}|${args.driverType}|${args.enabled ? 'on' : 'off'}`;
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
  /**
   * W41 — Path to the disk cache file for provider statuses.
   * When set, the snapshot is persisted here after each refresh and loaded on
   * boot so a cold start never blocks waiting for a provider probe.
   * File format: JSON array of `HarnessProviderStatus`, version-tagged.
   */
  diskCacheFile?: string;
}

/** Shape stored in the disk cache file (version-tagged for safe loading). */
interface DiskCachePayload {
  version: 1;
  savedAt: number;
  statuses: HarnessProviderStatus[];
  /**
   * W41 — per-INSTANCE (per-account) verdicts. Absent in files written by
   * builds before W41; those files carry driver-level statuses only, which is
   * exactly the conflation this field exists to end.
   */
  instances?: Array<{
    instanceId: ProviderInstanceId;
    driverType: HarnessType;
    enabled: boolean;
    status: HarnessProviderStatus;
  }>;
}

/** How long a disk-cache file is considered fresh enough to pre-seed from. */
const DISK_CACHE_MAX_AGE_MS = 60 * 60_000; // 1 hour

export class HarnessRegistry {
  private readonly entries = new Map<HarnessType, Entry>();
  /**
   * W34 — one adapter per registered provider INSTANCE (account/credential
   * set), keyed by its persisted `ProviderInstanceId` rather than its driver
   * type. This is what actually lets two accounts of the same driver
   * ('copilot:work' and 'copilot:personal') run concurrently: `entries`
   * above still holds exactly one adapter per TYPE (the pre-W34 ceiling,
   * kept for `get()`/`peek()` callers and the "no specific instance chosen"
   * default path), while `instanceEntries` holds one adapter per ACCOUNT.
   * Each instance carries its own `HarnessProviderConfig` — captured at
   * `registerInstance()` time rather than derived from `opts.buildConfig`,
   * since two instances of the same type need DIFFERENT config (credentials,
   * homeDir) that a single `(type) => config` function cannot express.
   */
  private readonly instanceEntries = new Map<ProviderInstanceId, Entry & { driverType: HarnessType; config: HarnessProviderConfig; enabled: boolean }>();
  private readonly opts: HarnessRegistryOptions;
  private readonly statusTtlMs: number;
  private _primary: HarnessType;
  private refreshInFlight: Promise<HarnessProviderStatus[]> | null = null;
  /** W41 — semaphore flag for fire-and-forget background refresh. */
  #refreshing = false;
  /** Serialises disk-cache writes — see `persistDiskCache`. */
  #persistChain: Promise<void> = Promise.resolve();
  #persistSeq = 0;

  // ── W41 — generational enrichment ────────────────────────────────────────
  //
  // Every source of status (a live probe, a disk-cache seed) belongs to a
  // GENERATION. Writes used to be unconditional, so whichever source happened
  // to finish last won — and the slowest source is systematically the STALEST
  // one. The concrete failure is a boot race: `loadDiskCache()` reads a file
  // (real I/O, ~ms) while a live `refresh()` runs entirely in memory, so the
  // hour-old cached verdict routinely landed ON TOP of the fresh probe and the
  // provider was reported with a stale catalog and `fromDiskCache: true`.
  //
  // A monotonic counter fixes it in one line at each write site: a result may
  // only be written if its generation is not older than the one already there.
  #generation = 0;
  readonly #statusGeneration = new Map<string, number>();

  /**
   * Claim the right to write `key`'s status on behalf of generation `gen`.
   * Returns false when a newer generation has already written — in which case
   * this result is superseded and MUST be discarded rather than applied.
   */
  #claimGeneration(key: string, gen: number): boolean {
    const last = this.#statusGeneration.get(key) ?? -1;
    if (gen < last) return false;
    this.#statusGeneration.set(key, gen);
    return true;
  }

  // ── W41 — watcher-gated refresh ──────────────────────────────────────────
  //
  // `statusSnapshot` is a pure read and must stay one. Anything that wants to
  // be TOLD about changes subscribes here, and the periodic refresh exists
  // only for as long as someone is subscribed: a server with no status UI
  // attached should not be spawning provider CLIs on a timer forever.
  readonly #watchers = new Set<(statuses: HarnessProviderStatus[]) => void>();
  #watchTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: HarnessRegistryOptions) {
    this.opts = opts;
    this._primary = opts.primary;
    this.statusTtlMs = opts.statusTtlMs ?? 5 * 60_000;
    // ALL_HARNESS_TYPES includes codex/opencode/acp but they are NOT
    // auto-probed (they require live external services configured by the
    // caller). We still create entries for them so callers can `get()` them
    // when explicitly configured.
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

  // ── W41 — Disk cache helpers ─────────────────────────────────────────────

  /**
   * Load the disk cache and pre-seed the in-memory snapshot.
   * Call once at boot, before any user-facing calls.
   * Never throws — a missing or corrupt file is silently ignored.
   */
  async loadDiskCache(): Promise<void> {
    const path = this.opts.diskCacheFile;
    if (!path) return;
    try {
      const raw = await readFile(path, 'utf8');
      const payload = JSON.parse(raw) as unknown;
      if (!isDiskCachePayload(payload)) return;
      if (Date.now() - payload.savedAt > DISK_CACHE_MAX_AGE_MS) return; // too old

      // W41 — the seed is generation 0: the OLDEST possible source. Any live
      // probe that has already written (generation ≥ 1) outranks it, so a slow
      // file read can no longer land on top of a fresh result.
      const SEED_GENERATION = 0;

      for (const status of payload.statuses) {
        const entry = this.entries.get(status.type);
        if (!entry) continue;

        // W41 — instance ∧ driver ∧ enabled. A verdict written for a different
        // identity is not evidence about this one. `cacheKey` is absent in
        // files written by pre-W41 builds; those are accepted by type for the
        // one hour it takes them to age out, rather than being discarded and
        // costing every upgrading user a cold boot.
        const expected = statusCacheKey({ driverType: status.type, enabled: true });
        if (status.cacheKey !== undefined && status.cacheKey !== expected) continue;

        if (!this.#claimGeneration(`type:${status.type}`, SEED_GENERATION)) continue;
        // Pre-seed installed/models/checkedAt AND the readiness verdict.
        //
        // This used to deliberately leave `ready: false`, which made the whole
        // cache dead weight: every consumer — `getAllModels`,
        // `resolveProviderForModel`, `readyTypes` — filters on `ready`, so the
        // seeded catalog was unreachable and a cold boot still routed nothing
        // until a live probe finished. `connected` stays false because no
        // process is running yet; `get(type)` brings one up lazily on first
        // use, so a cached-ready provider is genuinely usable.
        entry.status = {
          ...entry.status,
          installed: status.installed,
          models: status.models,
          checkedAt: status.checkedAt,
          authenticated: status.ready,
          ready: status.ready,
          fromDiskCache: true,
          ...(status.error ? { error: status.error } : {}),
        };
      }

      // W41 — per-instance verdicts. Only applied to an instance that is
      // registered NOW, with the same driver and the same enabled state; a
      // cache entry for an account that has since been disabled or re-pointed
      // is dropped rather than replayed. (Instances must therefore be
      // registered before `loadDiskCache()` for their cache to apply — the
      // composition root does exactly that.)
      for (const row of payload.instances ?? []) {
        const entry = this.instanceEntries.get(row.instanceId);
        if (!entry) continue;
        const expected = statusCacheKey({
          driverType: entry.driverType,
          instanceId: row.instanceId,
          enabled: entry.enabled,
        });
        if (row.status.cacheKey !== expected) continue;
        if (!this.#claimGeneration(`instance:${row.instanceId}`, SEED_GENERATION)) continue;
        entry.status = {
          ...entry.status,
          installed: row.status.installed,
          models: row.status.models,
          checkedAt: row.status.checkedAt,
          authenticated: row.status.ready,
          ready: row.status.ready,
          fromDiskCache: true,
          ...(row.status.error ? { error: row.status.error } : {}),
        };
      }

      this.opts.logger?.info(`[HarnessRegistry] Loaded provider status cache (${payload.statuses.length} entries, ${Math.round((Date.now() - payload.savedAt) / 60_000)} min old)`);
    } catch {
      // Missing file, parse error, permission issue — start fresh.
    }
  }

  /**
   * Persist the current snapshot to the disk cache. Best-effort.
   *
   * Writes are (a) atomic — tmp file then rename, so a crash or a concurrent
   * reader never sees a half-written JSON document that `loadDiskCache` would
   * silently discard — and (b) serialised through `#persistChain`, because
   * every caller invokes this fire-and-forget (`void this.persistDiskCache()`)
   * and two overlapping `writeFile`s to the same path interleave their bytes.
   * `#refreshing` does not prevent that: it is cleared in a `.finally()` that
   * runs before the persist it kicked off has finished.
   */
  private persistDiskCache(): Promise<void> {
    const path = this.opts.diskCacheFile;
    if (!path) return Promise.resolve();
    this.#persistChain = this.#persistChain.then(async () => {
      const tmp = `${path}.${process.pid}.${++this.#persistSeq}.tmp`;
      try {
        // W41 — every persisted verdict carries the identity it was measured
        // against, so a later load can refuse to replay it for a different one.
        const payload: DiskCachePayload = {
          version: 1,
          savedAt: Date.now(),
          statuses: this.getStatuses().map((s) => ({
            ...s,
            cacheKey: statusCacheKey({ driverType: s.type, enabled: true }),
          })),
          instances: [...this.instanceEntries.entries()].map(([instanceId, e]) => ({
            instanceId,
            driverType: e.driverType,
            enabled: e.enabled,
            status: {
              ...e.status,
              cacheKey: statusCacheKey({ driverType: e.driverType, instanceId, enabled: e.enabled }),
            },
          })),
        };
        await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
        await rename(tmp, path);
      } catch {
        // Non-fatal — the cache is best-effort. Clean up the partial file so a
        // failing disk does not accumulate one `.tmp` per refresh.
        await rm(tmp, { force: true }).catch(() => { /* nothing more to do */ });
      }
    });
    return this.#persistChain;
  }

  // ── W41 — Demand-gated refresh ───────────────────────────────────────────

  /**
   * Current cached statuses — SYNCHRONOUS, never triggers a probe.
   * Use for read-only display paths where blocking is unacceptable.
   */
  get statusSnapshot(): Readonly<Record<HarnessType, HarnessProviderStatus>> {
    const result = {} as Record<HarnessType, HarnessProviderStatus>;
    for (const type of ALL_HARNESS_TYPES) {
      result[type] = { ...this.entries.get(type)!.status };
    }
    return result;
  }

  /**
   * Fire-and-forget background refresh.
   * No-op when a refresh is already in flight.
   * Callers that need a fresh snapshot should await `refresh(true)` instead,
   * but most callers should prefer this to avoid blocking the hot path.
   *
   * W41 — replaces the implicit "await refresh()" on every createConversation.
   */
  requestRefresh(): void {
    if (this.#refreshing) return;
    this.#refreshing = true;
    const start = Date.now();
    this.refresh(false)
      // AWAIT the persist rather than firing it off: `#refreshing` is cleared
      // in the `.finally()` below, so a fire-and-forget write left the door
      // open for the next `requestRefresh()` to start a second, overlapping
      // write of the same file.
      .then(async () => {
        await this.persistDiskCache();
        if (Date.now() - start > 2_000) {
          this.opts.logger?.info(`[HarnessRegistry] Background refresh completed in ${Date.now() - start} ms`);
        }
      })
      .catch((err) => {
        this.opts.logger?.warn(`[HarnessRegistry] Background refresh failed: ${String(err)}`);
      })
      .finally(() => {
        this.#refreshing = false;
      });
  }

  /**
   * W41 — subscribe to status changes, and gate the periodic refresh on there
   * being a subscriber.
   *
   * Two things were missing. The refresh was purely demand-driven, so a status
   * surface (the model picker, a health page) had no way to be told about a
   * change without polling `statusSnapshot` — and polling a *snapshot* never
   * refreshes it, so such a surface showed a frozen verdict indefinitely. And
   * the obvious fix, an unconditional interval, is worse: it spawns provider
   * CLIs every TTL forever on a server nobody is looking at.
   *
   * Gating the interval on the watcher count gives both properties: work
   * happens exactly while something is watching, and `statusSnapshot` stays a
   * pure, non-blocking read that never triggers a probe.
   *
   * @returns unsubscribe. The last unsubscribe stops the timer.
   */
  watchStatus(listener: (statuses: HarnessProviderStatus[]) => void): () => void {
    this.#watchers.add(listener);
    if (this.#watchTimer === undefined) {
      this.#watchTimer = setInterval(() => {
        if (this.isStale()) this.requestRefresh();
      }, this.statusTtlMs);
      // Never hold the process open for a status poll.
      (this.#watchTimer as unknown as { unref?: () => void }).unref?.();
    }
    // Give the new watcher the current verdict immediately — it is a Ref-style
    // read, so this costs nothing and saves every caller a first-render special
    // case. A refresh is requested only if the snapshot is actually stale.
    listener(this.getStatuses());
    if (this.isStale()) this.requestRefresh();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#watchers.delete(listener);
      if (this.#watchers.size === 0 && this.#watchTimer !== undefined) {
        clearInterval(this.#watchTimer);
        this.#watchTimer = undefined;
      }
    };
  }

  /** W41 — how many status watchers are attached (the refresh gate). */
  get watcherCount(): number {
    return this.#watchers.size;
  }

  /** Notify every watcher. A throwing listener never blocks the others. */
  #notifyWatchers(): void {
    if (this.#watchers.size === 0) return;
    const statuses = this.getStatuses();
    for (const listener of [...this.#watchers]) {
      try {
        listener(statuses);
      } catch (err) {
        this.opts.logger?.warn(`[HarnessRegistry] status watcher threw: ${String(err)}`);
      }
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
   * W48 — whether `type` can actually be selected right now.
   *
   * The two managed providers (`copilot`, `claude-agent`) are always
   * configurable — the registry brings them up itself. `codex` / `opencode`
   * / `acp` are configurable only once the caller's `buildConfig` supplies
   * their provider-specific config section; before that `get(type)` would
   * construct an adapter with no connection info and fail the first turn.
   */
  isConfigurable(type: HarnessType): boolean {
    if (AUTO_PROBE_TYPES.includes(type)) return true;
    const key = CONFIG_KEY_FOR_TYPE[type];
    if (!key) return false;
    try {
      return this.opts.buildConfig(type)[key] !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * W48 — every provider that can currently be selected. This is what a
   * model picker / provider list should filter on instead of iterating
   * `ALL_HARNESS_TYPES` directly, which is a superset that includes types
   * this deployment has no config for.
   */
  get configurableTypes(): HarnessType[] {
    return ALL_HARNESS_TYPES.filter((t) => this.isConfigurable(t));
  }

  /**
   * W48 — provider honesty, part two. `codex` / `opencode` / `acp` are
   * genuine adapters, not stubs, but each drops capabilities Claude/Copilot
   * chats take for granted (see each adapter's `capabilities()` and
   * `UNMODELED_CAPABILITIES` above for the ones the struct can't even
   * express, like hooks). Silently dropping them is how a workflow authored
   * against Claude quietly lost its skills or its per-call permission gate
   * the moment it got routed to one of these — this makes the loss a log
   * line instead of a mystery.
   */
  #logDroppedCapabilities(type: HarnessType, adapter: IAgentHarness): void {
    if (AUTO_PROBE_TYPES.includes(type)) return; // the capability baseline
    let caps: ProviderCapabilities;
    try {
      caps = adapter.capabilities();
    } catch {
      return; // best-effort — never let a diagnostic break startup
    }
    const dropped: string[] = [];
    if (!caps.mcpServers) dropped.push('tools (no MCP server support)');
    if (!caps.skillDirectories) dropped.push('skills (no skill directory support)');
    if (!caps.fullToolGating) dropped.push('permissions (no per-call PreToolUse gate — treat as lower-trust)');
    dropped.push(...(UNMODELED_CAPABILITIES[type] ?? []));
    if (dropped.length === 0) return;
    this.opts.logger?.warn(
      `[HarnessRegistry] '${type}' is configured but its adapter drops: ${dropped.join(', ')}. ` +
      `A chat routed to '${type}' loses these silently unless the caller checks capabilities() itself.`,
    );
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
      this.#logDroppedCapabilities(type, adapter); // W48
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

  // ── W34 — Multi-instance (per-account) adapters ─────────────────────────

  /**
   * Registers one provider INSTANCE (account/credential set) with the
   * config needed to construct its own adapter. Idempotent by design —
   * re-registering the same `instanceId` (e.g. on a hot-reload of instance
   * metadata) replaces the stored config for the NEXT `getInstance()` call
   * but does not tear down an adapter already running under the old config;
   * call `shutdownInstance()` first if the credentials actually changed.
   */
  registerInstance(
    instanceId: ProviderInstanceId,
    driverType: HarnessType,
    config: HarnessProviderConfig,
    /**
     * W41 — whether the operator currently has this account switched on.
     * Part of the disk-cache key: a verdict measured while an instance was
     * enabled must not be replayed for the same id once it has been disabled.
     * Defaults to `true` so existing three-argument callers are unaffected.
     */
    enabled = true,
  ): void {
    const existing = this.instanceEntries.get(instanceId);
    if (existing) {
      existing.config = config;
      existing.driverType = driverType;
      existing.enabled = enabled;
      return;
    }
    this.instanceEntries.set(instanceId, {
      adapter: null,
      initializing: null,
      driverType,
      config,
      enabled,
      status: {
        type: driverType,
        label: `${harnessTypeLabel(driverType)} (${instanceId})`,
        installed: false,
        connected: false,
        authenticated: false,
        ready: false,
        models: [],
      },
    });
  }

  /** Whether `instanceId` has been registered (regardless of live status). */
  hasInstance(instanceId: ProviderInstanceId): boolean {
    return this.instanceEntries.has(instanceId);
  }

  /**
   * W41 — flip an instance's enabled flag. Changes its disk-cache key, so a
   * verdict cached while it was enabled is not replayed once it is disabled.
   */
  setInstanceEnabled(instanceId: ProviderInstanceId, enabled: boolean): void {
    const entry = this.instanceEntries.get(instanceId);
    if (entry) entry.enabled = enabled;
  }

  /** W41 — an instance's current enabled flag, or `undefined` if unregistered. */
  isInstanceEnabled(instanceId: ProviderInstanceId): boolean | undefined {
    return this.instanceEntries.get(instanceId)?.enabled;
  }

  /** Every registered instance id, in registration order. */
  listInstanceIds(): ProviderInstanceId[] {
    return [...this.instanceEntries.keys()];
  }

  /**
   * Get (and lazily bring up) the adapter for a specific provider instance.
   * Mirrors `get(type)`'s concurrent-caller sharing so two requests for the
   * same instance never spawn two CLIs for one account.
   */
  async getInstance(instanceId: ProviderInstanceId): Promise<IAgentHarness> {
    const entry = this.instanceEntries.get(instanceId);
    if (!entry) throw new Error(`[HarnessRegistry] Unknown provider instance: "${instanceId}" (was it registered?)`);
    if (entry.adapter) return entry.adapter;
    if (entry.initializing) return entry.initializing;

    entry.initializing = (async () => {
      const adapter = await createHarnessProvider(entry.config);
      entry.status.installed = true;
      await adapter.initialize();
      entry.status.connected = true;
      entry.adapter = adapter;
      this.opts.logger?.info(`[HarnessRegistry] instance '${instanceId}' (${entry.driverType}) initialized`);
      this.#logDroppedCapabilities(entry.driverType, adapter); // W48
      return adapter;
    })();

    try {
      return await entry.initializing;
    } catch (err) {
      entry.status.error = (err as Error).message;
      entry.status.ready = false;
      throw err;
    } finally {
      entry.initializing = null;
    }
  }

  /** The already-initialized adapter for an instance, if any. */
  peekInstance(instanceId: ProviderInstanceId): IAgentHarness | null {
    return this.instanceEntries.get(instanceId)?.adapter ?? null;
  }

  /** Shut a single instance's adapter down (e.g. before re-registering new credentials). */
  async shutdownInstance(instanceId: ProviderInstanceId): Promise<void> {
    const entry = this.instanceEntries.get(instanceId);
    if (!entry?.adapter) return;
    try { await entry.adapter.shutdown(); } catch { /* best effort */ }
    entry.adapter = null;
    entry.status.connected = false;
    entry.status.ready = false;
  }

  /** Last known status for every provider (may be stale — see `refresh`). */
  getStatuses(): HarnessProviderStatus[] {
    return ALL_HARNESS_TYPES.map((t) => ({ ...this.entries.get(t)!.status }));
  }

  /**
   * Has any auto-probed provider ever been probed — either in this process or
   * in a previous one, via `loadDiskCache()`?
   *
   * This is the "do we have something worth serving right now" question. A
   * read-only display path should answer from the snapshot and refresh in the
   * background whenever this is true, and block only when it is false (a
   * genuinely first-ever boot, where blocking is the only way to return
   * anything meaningful).
   */
  get hasProbedStatuses(): boolean {
    return this.autoProbeEntries().some((e) => e.status.checkedAt != null);
  }

  /**
   * Public read of `isStale()`, so HTTP callers can tell a client that what
   * they are holding is last-known-good and a fresher answer is on its way.
   */
  get statusesAreStale(): boolean {
    return this.isStale();
  }

  /**
   * The types a refresh probes: the managed providers, plus every breadth
   * provider (`codex` / `opencode` / `acp`) this deployment has configured.
   *
   * Configuring one used to change nothing observable — `refresh()` walked
   * `AUTO_PROBE_TYPES` alone, so a configured, installed, signed-in Codex never
   * got a status, never became `ready`, and never reached the model picker.
   * Unconfigured breadth types stay out, which is what keeps them from making
   * the snapshot permanently stale (see `isStale`).
   */
  private probeTypes(): HarnessType[] {
    return ALL_HARNESS_TYPES.filter((t) => this.isConfigurable(t));
  }

  /** The entries a refresh actually probes. */
  private autoProbeEntries(): Entry[] {
    return this.probeTypes().map((t) => this.entries.get(t)!);
  }

  /**
   * Is the cached snapshot old enough to warrant a background refresh?
   *
   * Computed over the PROBED types only. Asking it of all five was a silent
   * performance defect: `refresh()` probes only the managed and configured
   * providers, so an unconfigured codex/opencode/acp never gets a `checkedAt` and was
   * therefore *permanently* stale. Every `getAllModels()` and every
   * `resolveProviderForModel()` — i.e. every new chat and every model lookup —
   * consequently fired `requestRefresh()`, whose success path writes the whole
   * disk cache. The 5-minute TTL suppressed precisely nothing.
   */
  private isStale(): boolean {
    const now = Date.now();
    return this.autoProbeEntries().some(
      (e) => e.status.checkedAt == null || now - e.status.checkedAt >= this.statusTtlMs,
    );
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

    // Only the PROBED types can ever be fresh — nothing sets `checkedAt` on an
    // unconfigured codex/opencode/acp. Asking `every entry` here meant this
    // early return never fired; see `isStale()` for the same bug's expensive half.
    if (!force && this.autoProbeEntries().every(fresh)) return this.getStatuses();
    if (this.refreshInFlight) return this.refreshInFlight;

    // W41 — this refresh's generation. Every write below is guarded by it, so
    // a result produced here can never be overwritten by an older source that
    // happens to finish later (see `#claimGeneration`).
    const gen = ++this.#generation;

    this.refreshInFlight = (async () => {
      // The managed providers, plus whichever breadth providers are configured
      // (codex / opencode / acp need an external binary or server, so they are
      // probed only once `buildConfig` supplies their section).
      await Promise.all(
        this.probeTypes().map(async (type) => {
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

            // W41 — `getModels()` no longer throws; an empty catalog can mean
            // "probe failed". Recover the reason so the status still explains
            // itself instead of silently reporting an entitlement-less account.
            if (models.length === 0 && !credentialError && isModelProbeErrorAware(adapter)) {
              credentialError = adapter.getLastModelProbeError();
            }

            const usable = models.length > 0 && !credentialError;
            // W41 — discard a result a newer generation has already superseded.
            if (!this.#claimGeneration(`type:${type}`, gen)) return;
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
              // A live probe supersedes whatever the disk cache claimed.
              fromDiskCache: false,
            };
            if (credentialError) entry.status.error = credentialError;
            else delete entry.status.error;
          } catch (err) {
            const message = (err as Error).message ?? String(err);
            if (!this.#claimGeneration(`type:${type}`, gen)) return; /* W41 */
            entry.status = {
              ...entry.status,
              // `installed` stays true once we've proven the module resolves.
              authenticated: false,
              ready: false,
              models: [],
              error: message,
              checkedAt: Date.now(),
              fromDiskCache: false,
            };
            this.opts.logger?.warn(`[HarnessRegistry] '${type}' unavailable: ${message}`);
          }
        }),
      );
      this.#notifyWatchers(); /* W41 */
      return this.getStatuses();
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  /**
   * Every model from every ready provider, each tagged with its owning
   * provider so the caller can route a later conversation correctly.
   *
   * W41 — uses the cached snapshot immediately; triggers a background refresh
   * if the cache is stale. Callers that NEED a fresh catalog (e.g. the model
   * picker UI) should pass `force = true` and await the result.
   */
  async getAllModels(force = false): Promise<HarnessModel[]> {
    if (force) {
      // Explicit force: block for a fresh probe.
      const statuses = await this.refresh(true);
      void this.persistDiskCache();
      return statuses
        .filter((s) => s.ready)
        .flatMap((s) => s.models.map((m) => ({ ...m, provider: m.provider ?? s.type })));
    }

    // Fast path: use the snapshot, trigger a background refresh if stale.
    if (this.isStale()) this.requestRefresh(); // W41 — fire-and-forget, never blocks

    return this.getStatuses()
      .filter((s) => s.ready)
      .flatMap((s) => s.models.map((m) => ({ ...m, provider: m.provider ?? s.type })));
  }

  /**
   * Which provider owns a model id, based on the live catalogs.
   * Returns `null` when no ready provider advertises the id.
   *
   * W41 — uses the snapshot; triggers a background refresh if stale.
   * Callers wanting guaranteed freshness should `await refresh(true)` first.
   */
  async resolveProviderForModel(modelId: string): Promise<HarnessType | null> {
    if (this.isStale()) this.requestRefresh();

    for (const s of this.getStatuses()) {
      if (!s.ready) continue;
      if (s.models.some((m) => m.id === modelId)) return s.type;
    }
    return null;
  }

  /** Shut every initialized provider down — both per-type and per-instance adapters. */
  async shutdownAll(): Promise<void> {
    // W41 — drop watchers and their timer first, so nothing schedules a probe
    // against a registry that is being torn down.
    this.#watchers.clear();
    if (this.#watchTimer !== undefined) {
      clearInterval(this.#watchTimer);
      this.#watchTimer = undefined;
    }
    await Promise.all([
      ...[...this.entries.values()].map(async (e) => {
        if (!e.adapter) return;
        try { await e.adapter.shutdown(); } catch { /* best effort */ }
        e.adapter = null;
        e.status.connected = false;
        e.status.ready = false;
      }),
      ...[...this.instanceEntries.keys()].map((id) => this.shutdownInstance(id)),
    ]);
  }
}

// ── W41 — Type guard for disk cache payload ──────────────────────────────────

function isDiskCachePayload(v: unknown): v is DiskCachePayload {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    obj['version'] === 1 &&
    typeof obj['savedAt'] === 'number' &&
    Array.isArray(obj['statuses'])
  );
}
