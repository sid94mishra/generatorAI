// ────────────────────────────────────────────────────────────────
// AcpAgentsService — every ACP Registry agent, installable from Settings
// (docs/acp ACP-1…ACP-10). The server half of `/api/acp`.
//
// Owns:
//   - the catalogue (`AcpRegistryCatalog`: `<data>/acp/registry/`, hourly, snapshot fallback);
//   - installs (`<data>/acp/agents/<id>/<version>/`, binary or npm, progress per agent);
//   - which agents are enabled, their installed version and the names of their user env vars
//     (`<data>/acp/agents.json`, beside provider-visibility.json; the values live in the secret
//     store under `harness/acp-<id>`), plus custom agents (ACP-10);
//   - the launch specs the `acp` provider runs (`launches()`), pushed to the live provider with
//     `setAgents` on every change — enable/disable/update/env take effect without a restart.
//
// Not a `harness_instances` use: those rows are separate adapters per account; ACP agents are
// sub-providers of the ONE `acp` adapter (ACP-1), so their state is a small JSON store.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ACP_NATIVE_PROVIDERS,
  AcpRegistryCatalog,
  acpPlatformKey,
  findNodeRuntime,
  installBinaryAgent,
  installNpxAgent,
  launchFromManifest,
  offeredDistributions,
  pickDistribution,
  posixCommandLine,
  powershellCommandLine,
  readInstallManifest,
  removeOtherVersions,
  uninstallAgent,
  type AcpAgentLaunch,
  type AcpInstallManifest,
  type AcpProvider,
  type AcpRegistryAgent,
  type AcpRegistryState,
  type NodeRuntime,
} from '@generatorai/agent-harness-providers';
import { SecretNamespace, type SecretStore } from '@generatorai/secrets';
import type {
  AcpAgentInfo,
  AcpAgentsResponse,
  AcpAuthMethodInfo,
  AcpCustomAgentRequest,
  AcpInstallProgress,
  AcpTerminalAuthSpec,
  AcpTestResult,
  AcpAgentRuntimeStatus,
} from '@generatorai/shared';

const STORE_FILE = 'agents.json';
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** How long a Node.js lookup is trusted before PATH is searched again. */
const NODE_RECHECK_MS = 60_000;

/** A request the caller got wrong (unknown agent, nothing to install …): HTTP 4xx, `code` says which. */
export class AcpAgentsError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'AcpAgentsError';
  }
}

interface StoredAgent {
  enabled: boolean;
  installedVersion?: string;
  envNames: string[];
}

interface StoredCustomAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  envNames: string[];
}

interface StoreFile {
  version: 1;
  agents: Record<string, StoredAgent>;
  custom: StoredCustomAgent[];
}

function normalizeStore(raw: unknown): StoreFile {
  const out: StoreFile = { version: 1, agents: {}, custom: [] };
  const r = (raw ?? {}) as { agents?: Record<string, unknown>; custom?: unknown[] };
  for (const [id, v] of Object.entries(r.agents ?? {})) {
    const a = v as Partial<StoredAgent> | null;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !a) continue;
    out.agents[id] = {
      enabled: a.enabled === true,
      ...(typeof a.installedVersion === 'string' ? { installedVersion: a.installedVersion } : {}),
      envNames: Array.isArray(a.envNames) ? a.envNames.filter((n): n is string => typeof n === 'string' && ENV_NAME.test(n)) : [],
    };
  }
  for (const v of r.custom ?? []) {
    const c = v as Partial<StoredCustomAgent> | null;
    if (!c || typeof c.id !== 'string' || !/^custom-[a-z0-9-]+$/.test(c.id) || typeof c.command !== 'string' || typeof c.name !== 'string') continue;
    out.custom.push({
      id: c.id,
      name: c.name,
      command: c.command,
      args: Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : [],
      enabled: c.enabled !== false,
      envNames: Array.isArray(c.envNames) ? c.envNames.filter((n): n is string => typeof n === 'string' && ENV_NAME.test(n)) : [],
    });
  }
  return out;
}

export interface AcpAgentsServiceOptions {
  /** The server data directory (`dirname(dbPath)`); everything lives under `<dataDir>/acp`. */
  dataDir: string;
  secretStore: SecretStore;
  /** The live `acp` provider, brought up on demand; null when the provider is hidden on this server. */
  provider: () => Promise<AcpProvider | null>;
  /** The live provider if it is already up (never starts it). */
  peekProvider: () => AcpProvider | null;
  /** The provider's status changed in a way the model catalog must reflect. */
  onCatalogChange: () => void;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  fetchImpl?: typeof fetch;
}

export class AcpAgentsService {
  private store: StoreFile = { version: 1, agents: {}, custom: [] };
  private readonly catalog: AcpRegistryCatalog;
  private readonly root: string;
  private readonly agentsRoot: string;
  private manifests = new Map<string, AcpInstallManifest>();
  private readonly installing = new Map<string, AcpInstallProgress>();
  private readonly installErrors = new Map<string, string>();
  private nodeCache: { at: number; runtime?: NodeRuntime; error?: string } | null = null;
  private resolvedLaunches: AcpAgentLaunch[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly opts: AcpAgentsServiceOptions) {
    this.root = path.join(opts.dataDir, 'acp');
    this.agentsRoot = path.join(this.root, 'agents');
    this.catalog = new AcpRegistryCatalog({
      cacheDir: path.join(this.root, 'registry'),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      logger: { info: (m) => opts.logger?.info(m), warn: (m) => opts.logger?.warn(m) },
    });
  }

  /** Read the store, the catalogue (cache or snapshot) and every enabled agent's install; never throws. */
  static async load(opts: AcpAgentsServiceOptions): Promise<AcpAgentsService> {
    const svc = new AcpAgentsService(opts);
    try {
      svc.store = normalizeStore(JSON.parse(await fs.readFile(path.join(svc.root, STORE_FILE), 'utf8')));
    } catch { /* first run */ }
    await svc.catalog.load();
    for (const [id, a] of Object.entries(svc.store.agents)) {
      if (!a.installedVersion) continue;
      const m = await readInstallManifest(svc.agentsRoot, id, a.installedVersion);
      if (m) svc.manifests.set(id, m);
      else {
        opts.logger?.warn(`[AcpAgents] ${id} ${a.installedVersion} is no longer installed; disabling it`);
        delete a.installedVersion;
        a.enabled = false;
      }
    }
    await svc.rebuildLaunches(false);
    return svc;
  }

  // ── Launches (what the provider runs) ────────────────────────────

  /** The enabled agents' launch specs, resolved (env secrets included). Synchronous: read by `buildConfig`. */
  launches(): AcpAgentLaunch[] {
    return this.resolvedLaunches;
  }

  private async secretEnv(id: string, names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) {
      try {
        const bytes = await this.opts.secretStore.get(SecretNamespace.harness(`acp-${id}`), name);
        if (bytes) out[name] = Buffer.from(bytes).toString('utf8');
      } catch (err) {
        this.opts.logger?.warn(`[AcpAgents] could not read ${id}'s ${name}: ${String(err)}`);
      }
    }
    return out;
  }

  private async nodeRuntime(force = false): Promise<{ runtime?: NodeRuntime; error?: string }> {
    if (!force && this.nodeCache && Date.now() - this.nodeCache.at < NODE_RECHECK_MS) return this.nodeCache;
    try {
      this.nodeCache = { at: Date.now(), runtime: await findNodeRuntime() };
    } catch (err) {
      this.nodeCache = { at: Date.now(), error: err instanceof Error ? err.message : String(err) };
    }
    return this.nodeCache;
  }

  /** The launch of one registry or custom agent (whether or not it is enabled). */
  private async launchFor(id: string): Promise<AcpAgentLaunch> {
    const custom = this.store.custom.find((c) => c.id === id);
    if (custom) {
      return { id, label: custom.name, command: custom.command, args: custom.args, env: await this.secretEnv(id, custom.envNames) };
    }
    const manifest = this.manifests.get(id);
    if (!manifest) throw new AcpAgentsError('CONFLICT', `${id} is not installed.`);
    const node = manifest.kind === 'npx' ? (await this.nodeRuntime()).runtime?.node : undefined;
    const spec = launchFromManifest(this.agentsRoot, manifest, node);
    const reg = this.registryAgent(id);
    const mark = this.catalog.current?.marks[id];
    return {
      id,
      label: reg?.name ?? id,
      command: spec.command,
      args: spec.args,
      env: { ...spec.env, ...(await this.secretEnv(id, this.store.agents[id]?.envNames ?? [])) },
      cwd: spec.cwd,
      version: manifest.version,
      ...(mark ? { mark } : {}),
    };
  }

  /** The provider reported a state change (an agent signed in, started, stopped): re-read its status. */
  notifyProviderChanged(): void {
    this.opts.onCatalogChange();
  }

  /** Recompute the launches; push them to the live provider (`push`) and re-probe. */
  private async rebuildLaunches(push = true): Promise<void> {
    const out: AcpAgentLaunch[] = [];
    for (const [id, a] of Object.entries(this.store.agents)) {
      if (!a.enabled || !this.manifests.has(id)) continue;
      try {
        out.push(await this.launchFor(id));
      } catch (err) {
        this.opts.logger?.warn(`[AcpAgents] ${id} cannot be launched: ${String(err)}`);
      }
    }
    for (const c of this.store.custom) {
      if (c.enabled) out.push(await this.launchFor(c.id));
    }
    this.resolvedLaunches = out;
    if (!push) return;
    const provider = this.opts.peekProvider();
    if (provider) await provider.setAgents(out);
    this.opts.onCatalogChange();
  }

  private async persist(): Promise<void> {
    const body = `${JSON.stringify({ ...this.store, updatedAt: Date.now() }, null, 2)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.root, { recursive: true });
      const file = path.join(this.root, STORE_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, file);
    });
    return this.writeChain;
  }

  // ── Catalogue ────────────────────────────────────────────────────

  private registryAgent(id: string): AcpRegistryAgent | undefined {
    return this.catalog.current?.index.agents.find((a) => a.id === id);
  }

  private requireKnown(id: string): { registry?: AcpRegistryAgent; custom?: StoredCustomAgent } {
    const custom = this.store.custom.find((c) => c.id === id);
    if (custom) return { custom };
    const registry = this.registryAgent(id);
    if (registry || this.store.agents[id]) return { ...(registry ? { registry } : {}) };
    throw new AcpAgentsError('NOT_FOUND', `Unknown ACP agent "${id}".`);
  }

  /** `GET /api/acp/agents`: the catalogue with each agent's state. Refreshes in the background when due. */
  async list(): Promise<AcpAgentsResponse> {
    if (this.catalog.isStale()) void this.catalog.refresh().then(() => undefined, () => undefined);
    return this.response();
  }

  /** `POST /api/acp/registry/refresh`: ask the network now. */
  async refresh(): Promise<AcpAgentsResponse> {
    await this.catalog.refresh(true);
    await this.nodeRuntime(true);
    return this.response();
  }

  private async response(): Promise<AcpAgentsResponse> {
    const state = this.catalog.current ?? (await this.catalog.load());
    const node = await this.nodeRuntime();
    const key = acpPlatformKey();
    const provider = this.opts.peekProvider();
    const agents: AcpAgentInfo[] = [];
    const listed = new Set<string>();
    for (const reg of state.index.agents) {
      listed.add(reg.id);
      agents.push(this.registryInfo(reg, state, key, node, provider));
    }
    // Installed agents the registry dropped stay manageable (uninstall, disable).
    for (const [id, stored] of Object.entries(this.store.agents)) {
      if (listed.has(id) || !stored.installedVersion) continue;
      const manifest = this.manifests.get(id);
      agents.push({
        id,
        name: id,
        description: 'No longer in the ACP Registry.',
        custom: false,
        distribution: { offered: [], selected: null, unavailableReason: 'No longer in the ACP Registry.' },
        installed: manifest ? { version: manifest.version, kind: manifest.kind, installedAt: manifest.installedAt, unverified: manifest.unverified } : null,
        updateAvailable: false,
        enabled: stored.enabled,
        env: stored.envNames.map((name) => ({ name, set: true as const })),
        ...this.runtimeOf(id, stored.enabled, provider),
        ...this.installStateOf(id),
      });
    }
    for (const c of this.store.custom) {
      agents.push({
        id: c.id,
        name: c.name,
        description: 'Custom ACP agent',
        custom: true,
        distribution: { offered: ['custom'], selected: 'custom' },
        installed: null,
        updateAvailable: false,
        enabled: c.enabled,
        env: c.envNames.map((name) => ({ name, set: true as const })),
        command: { command: c.command, args: c.args },
        ...this.runtimeOf(c.id, c.enabled, provider),
      });
    }
    return {
      registry: {
        url: state.url,
        source: state.source,
        ...(state.fetchedAt ? { fetchedAt: state.fetchedAt } : {}),
        ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
        ...(state.error ? { error: state.error } : {}),
      },
      platform: key,
      node: node.runtime ? { available: true, version: node.runtime.version } : { available: false, ...(node.error ? { error: node.error } : {}) },
      agents,
    };
  }

  private installStateOf(id: string): Pick<AcpAgentInfo, 'installing' | 'installError'> {
    const installing = this.installing.get(id);
    const error = this.installErrors.get(id);
    return { ...(installing ? { installing: { ...installing } } : {}), ...(error ? { installError: error } : {}) };
  }

  private runtimeOf(id: string, enabled: boolean, provider: AcpProvider | null): Pick<AcpAgentInfo, 'status'> {
    if (!enabled) return {};
    const s = provider?.agentStatus(id);
    const status: AcpAgentRuntimeStatus = s
      ? {
          connected: s.connected,
          authState: s.authState,
          ready: s.connected && s.models.length > 0,
          modelCount: s.models.length,
          ...(s.error ? { error: s.error } : {}),
          authMethods: s.authMethods.map(toAuthMethodInfo),
          supportsLogout: s.supportsLogout,
          ...(s.agentInfo ? { agentInfo: s.agentInfo } : {}),
          ...(s.checkedAt ? { checkedAt: s.checkedAt } : {}),
        }
      : { connected: false, authState: 'unknown', ready: false, modelCount: 0, authMethods: [], supportsLogout: false, ...(provider ? {} : { error: 'Starting…' }) };
    return { status };
  }

  private registryInfo(
    reg: AcpRegistryAgent,
    state: AcpRegistryState,
    key: ReturnType<typeof acpPlatformKey>,
    node: { runtime?: NodeRuntime; error?: string },
    provider: AcpProvider | null,
  ): AcpAgentInfo {
    const choice = pickDistribution(reg, key);
    const stored = this.store.agents[reg.id];
    const manifest = this.manifests.get(reg.id);
    const nativeProvider = ACP_NATIVE_PROVIDERS[reg.id];
    const distribution: AcpAgentInfo['distribution'] = {
      offered: offeredDistributions(reg),
      selected: choice.kind,
      ...(choice.kind === null ? { unavailableReason: choice.reason } : {}),
      ...(choice.kind === 'binary' && !choice.target.sha256 ? { unverified: true } : {}),
      ...(choice.kind === 'npx' ? { package: choice.dist.package } : {}),
      ...(choice.kind === 'npx' && !node.runtime ? { unavailableReason: node.error ?? 'Node.js was not found.' } : {}),
    };
    const distEnv = choice.kind === 'binary' ? choice.target.env : choice.kind === 'npx' ? choice.dist.env : undefined;
    return {
      id: reg.id,
      name: reg.name,
      description: reg.description,
      version: reg.version,
      custom: false,
      ...(reg.repository ? { repository: reg.repository } : {}),
      ...(reg.website ? { website: reg.website } : {}),
      ...(reg.license ? { license: reg.license } : {}),
      ...(reg.authors ? { authors: reg.authors } : {}),
      ...(state.marks[reg.id] ? { mark: state.marks[reg.id] } : {}),
      ...(nativeProvider ? { nativeProvider } : {}),
      distribution,
      installed: manifest ? { version: manifest.version, kind: manifest.kind, installedAt: manifest.installedAt, unverified: manifest.unverified } : null,
      updateAvailable: !!manifest && manifest.version !== reg.version && compareVersions(reg.version, manifest.version) > 0,
      ...this.installStateOf(reg.id),
      enabled: stored?.enabled === true,
      ...this.runtimeOf(reg.id, stored?.enabled === true, provider),
      env: (stored?.envNames ?? []).map((name) => ({ name, set: true as const })),
      ...(distEnv && Object.keys(distEnv).length ? { distributionEnv: distEnv } : {}),
    };
  }

  // ── Install / update / uninstall ─────────────────────────────────

  /**
   * Install (or update to) the registry's version, in the background. Answers at once; `GET /agents` reports
   * `installing` until it is done. A running agent switches to the new version once it is in place.
   */
  async install(id: string): Promise<AcpAgentsResponse> {
    const reg = this.registryAgent(id);
    if (!reg) throw new AcpAgentsError('NOT_FOUND', `"${id}" is not in the ACP Registry.`);
    if (this.installing.has(id)) return this.response();
    const choice = pickDistribution(reg, acpPlatformKey());
    if (choice.kind === null) throw new AcpAgentsError('UNAVAILABLE', choice.reason);
    const runtime = choice.kind === 'npx' ? await this.nodeRuntime(true) : undefined;
    if (choice.kind === 'npx' && !runtime?.runtime) throw new AcpAgentsError('UNAVAILABLE', runtime?.error ?? 'Node.js was not found.');
    if (this.manifests.get(id)?.version === reg.version) throw new AcpAgentsError('CONFLICT', `${reg.name} ${reg.version} is already installed.`);

    this.installErrors.delete(id);
    this.installing.set(id, { phase: 'resolving', version: reg.version, receivedBytes: 0 });
    const onProgress = (p: { phase: AcpInstallProgress['phase']; receivedBytes: number; totalBytes?: number }) => {
      this.installing.set(id, { version: reg.version, ...p });
    };
    this.opts.logger?.info(`[AcpAgents] installing ${id} ${reg.version} (${choice.kind})`);
    const job = choice.kind === 'binary'
      ? installBinaryAgent({ root: this.agentsRoot, id, version: reg.version, key: choice.key, target: choice.target, onProgress, ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}) })
      : installNpxAgent({ root: this.agentsRoot, id, version: reg.version, dist: choice.dist, runtime: runtime!.runtime!, onProgress });
    void job
      .then(async (manifest) => {
        this.manifests.set(id, manifest);
        const stored = (this.store.agents[id] ??= { enabled: false, envNames: [] });
        stored.installedVersion = manifest.version;
        await this.persist();
        await this.rebuildLaunches(); // a running agent restarts on the new version
        await removeOtherVersions(this.agentsRoot, id, manifest.version);
        this.opts.logger?.info(`[AcpAgents] installed ${id} ${manifest.version}${manifest.unverified ? ' (unverified: no sha256 in the registry)' : ''}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.installErrors.set(id, message);
        this.opts.logger?.warn(`[AcpAgents] installing ${id} failed: ${message}`);
      })
      .finally(() => {
        this.installing.delete(id);
      });
    return this.response();
  }

  /** Stop and remove an installed agent (it is disabled first). */
  async uninstall(id: string): Promise<AcpAgentsResponse> {
    if (this.installing.has(id)) throw new AcpAgentsError('CONFLICT', `${id} is being installed.`);
    const stored = this.store.agents[id];
    if (!stored?.installedVersion && !this.manifests.has(id)) throw new AcpAgentsError('CONFLICT', `${id} is not installed.`);
    if (stored) {
      stored.enabled = false;
      delete stored.installedVersion;
    }
    this.manifests.delete(id);
    await this.rebuildLaunches(); // stops its process before the files go
    try {
      await uninstallAgent(this.agentsRoot, id);
    } catch (err) {
      this.installErrors.set(id, `Could not remove every file: ${err instanceof Error ? err.message : String(err)}`);
    }
    await this.persist();
    return this.response();
  }

  // ── Enable / env ─────────────────────────────────────────────────

  async setEnabled(id: string, enabled: boolean): Promise<AcpAgentsResponse> {
    const known = this.requireKnown(id);
    if (known.custom) {
      known.custom.enabled = enabled;
    } else {
      if (enabled && !this.manifests.has(id)) throw new AcpAgentsError('CONFLICT', `Install ${id} before enabling it.`);
      const stored = (this.store.agents[id] ??= { enabled: false, envNames: [] });
      stored.enabled = enabled;
    }
    await this.persist();
    await this.rebuildLaunches();
    return this.response();
  }

  /** Set (string) or remove (null) per-agent environment variables; values go to the secret store. */
  async setEnv(id: string, patch: Record<string, string | null>): Promise<AcpAgentsResponse> {
    const known = this.requireKnown(id);
    const names = new Set(known.custom ? known.custom.envNames : (this.store.agents[id]?.envNames ?? []));
    const ns = SecretNamespace.harness(`acp-${id}`);
    for (const [name, value] of Object.entries(patch)) {
      if (!ENV_NAME.test(name)) throw new AcpAgentsError('INVALID', `"${name}" is not an environment variable name.`);
      if (value === null) {
        await this.opts.secretStore.remove(ns, name);
        names.delete(name);
      } else {
        await this.opts.secretStore.set(ns, name, new TextEncoder().encode(value));
        names.add(name);
      }
    }
    if (known.custom) known.custom.envNames = [...names].sort();
    else (this.store.agents[id] ??= { enabled: false, envNames: [] }).envNames = [...names].sort();
    await this.persist();
    await this.rebuildLaunches(); // an enabled agent restarts with the new environment
    return this.response();
  }

  // ── Custom agents (ACP-10) ───────────────────────────────────────

  async addCustom(body: AcpCustomAgentRequest): Promise<AcpAgentsResponse> {
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'agent';
    const id = `custom-${slug}-${randomUUID().slice(0, 6)}`;
    this.store.custom.push({ id, name: body.name.trim(), command: body.command.trim(), args: body.args ?? [], enabled: true, envNames: [] });
    await this.persist();
    if (body.env && Object.keys(body.env).length) return this.setEnv(id, body.env);
    await this.rebuildLaunches();
    return this.response();
  }

  async removeCustom(id: string): Promise<AcpAgentsResponse> {
    const i = this.store.custom.findIndex((c) => c.id === id);
    if (i < 0) throw new AcpAgentsError('NOT_FOUND', `Unknown custom agent "${id}".`);
    this.store.custom.splice(i, 1);
    await this.opts.secretStore.removeNamespace(SecretNamespace.harness(`acp-${id}`)).catch(() => undefined);
    await this.persist();
    await this.rebuildLaunches();
    return this.response();
  }

  // ── Sign-in (ACP-8) ──────────────────────────────────────────────

  private async enabledConnection(id: string) {
    this.requireKnown(id);
    if (!this.resolvedLaunches.some((l) => l.id === id)) throw new AcpAgentsError('CONFLICT', `Enable ${id} first.`);
    const provider = await this.opts.provider();
    if (!provider) throw new AcpAgentsError('UNAVAILABLE', 'ACP agents are hidden on this server.');
    return { provider, conn: await provider.ensureAgent(id) };
  }

  /** Sign in with an `agent` method (the agent opens a browser itself, typically). Resolves when it is done. */
  async authenticate(id: string, methodId: string): Promise<AcpAgentsResponse> {
    const { conn } = await this.enabledConnection(id);
    const method = conn.status().authMethods.find((m) => m.id === methodId);
    if (!method) throw new AcpAgentsError('NOT_FOUND', `${id} has no sign-in method "${methodId}".`);
    if ((method as { type?: string }).type === 'terminal') {
      throw new AcpAgentsError('CONFLICT', `"${method.name}" signs in from a terminal: use POST /api/acp/agents/${id}/terminal-auth.`);
    }
    await conn.authenticate(methodId);
    this.opts.onCatalogChange();
    return this.response();
  }

  async logout(id: string): Promise<AcpAgentsResponse> {
    const { conn } = await this.enabledConnection(id);
    if (!conn.status().supportsLogout) throw new AcpAgentsError('CONFLICT', `${id} cannot sign out from the app.`);
    await conn.logout();
    this.opts.onCatalogChange();
    return this.response();
  }

  /** The exact process to run for a terminal sign-in: the agent's own launch + the method's args/env. */
  async terminalAuth(id: string, methodId: string): Promise<AcpTerminalAuthSpec> {
    const { conn } = await this.enabledConnection(id);
    const method = conn.status().authMethods.find((m) => m.id === methodId) as
      | { id: string; name: string; type?: string; args?: string[]; env?: Record<string, string> }
      | undefined;
    if (!method) throw new AcpAgentsError('NOT_FOUND', `${id} has no sign-in method "${methodId}".`);
    if (method.type !== 'terminal') throw new AcpAgentsError('CONFLICT', `"${method.name}" is not a terminal sign-in; use POST /api/acp/agents/${id}/authenticate.`);
    const launch = this.resolvedLaunches.find((l) => l.id === id)!;
    const args = [...launch.args, ...(method.args ?? [])];
    const env = { ...(launch.env ?? {}), ...(method.env ?? {}) };
    return {
      agentId: id,
      methodId,
      command: launch.command,
      args,
      env,
      cwd: launch.cwd ?? this.root,
      posixCommandLine: posixCommandLine(launch.command, args, env),
      powershellCommandLine: powershellCommandLine(launch.command, args, env),
    };
  }

  /** Restart the agent (after a terminal sign-in exited 0) and re-probe it. */
  async reinitialize(id: string): Promise<AcpAgentsResponse> {
    const { provider } = await this.enabledConnection(id);
    const conn = await provider.restartAgent(id);
    await conn.getModels();
    this.opts.onCatalogChange();
    return this.response();
  }

  /** A fresh, separate connection to the agent: does it start, is it signed in, how many models. */
  async test(id: string): Promise<AcpTestResult> {
    this.requireKnown(id);
    const launch = this.resolvedLaunches.find((l) => l.id === id) ?? (await this.launchFor(id));
    const { AcpAgentConnection } = await import('@generatorai/agent-harness-providers/acp');
    const started = Date.now();
    const conn = new AcpAgentConnection({
      command: launch.command,
      args: launch.args,
      ...(launch.env ? { env: launch.env } : {}),
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      agentId: id,
      label: launch.label,
    });
    try {
      await conn.initialize();
      const models = await conn.getModels();
      const s = conn.status();
      return {
        ok: models.length > 0,
        authState: s.authState,
        modelCount: models.length,
        durationMs: Date.now() - started,
        ...(s.error ? { error: s.error } : {}),
        ...(s.agentInfo ? { agentInfo: s.agentInfo } : {}),
      };
    } catch (err) {
      return { ok: false, authState: 'unknown', modelCount: 0, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await conn.shutdown().catch(() => undefined);
    }
  }
}

function toAuthMethodInfo(m: { id: string; name: string; description?: string | null; type?: string; args?: string[]; env?: Record<string, string> }): AcpAuthMethodInfo {
  return {
    id: m.id,
    name: m.name,
    ...(m.description ? { description: m.description } : {}),
    type: m.type === 'terminal' ? 'terminal' : 'agent',
    ...(m.type === 'terminal' && m.args ? { args: m.args } : {}),
    ...(m.type === 'terminal' && m.env ? { env: m.env } : {}),
  };
}

/** Compare dotted versions numerically (`2026.11.05` > `2026.9.1`); non-numeric parts compare as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
