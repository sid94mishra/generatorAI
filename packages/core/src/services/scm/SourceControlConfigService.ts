// ────────────────────────────────────────────────────────────────
// SourceControlConfigService — connected accounts, settings, sign-in
// ────────────────────────────────────────────────────────────────
//
// Owns `<configDir>/source-control.json`, which holds `SourceControlSettings`
// and NEVER a token: every account's credential lives in the secret store
// under `source-control/<accountId>` / `token`. A pre-accounts file
// (`{ activeProvider, github: { token, … } }`) is migrated into one account on
// first load and the token is moved out of the file.
//
// Also runs the two non-paste sign-in methods — the GitHub OAuth device flow
// (polled server-side so the client only long-polls our own status endpoint)
// and importing the token the `gh` CLI already holds.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {
  ValidationError,
  type DeviceLoginStart,
  type DeviceLoginStatus,
  type EditorId,
  type ILogger,
  type ScmProviderId,
  type SourceControlAccount,
  type SourceControlAuthMethod,
  type SourceControlProviderInfo,
  type SourceControlSettings,
} from '@generatorai/shared';
import { SecretNamespace, type SecretStore } from '@generatorai/secrets';
import {
  GitHubDeviceFlow,
  createProvider,
  ghCliToken,
  type IScmHttpClient,
  type IScmProcessRunner,
  type SourceControlRegistry,
} from '@generatorai/source-control';
import { redactTokens } from './redact.js';

export interface SourceControlConfigDeps {
  http: IScmHttpClient;
  processRunner: IScmProcessRunner;
  /** Where account tokens are kept — they never touch the settings file. */
  secrets: SecretStore;
  logger: ILogger;
  /** Directory holding `source-control.json`. */
  configDir: string;
  /** Boot-time env fallbacks. */
  env?: { githubToken?: string; githubHost?: string; oauthClientId?: string };
}

/** Public (client-safe) view of the legacy config — never exposes a token. */
export interface SafeSourceControlConfig {
  activeProvider: 'github' | 'none';
  availableProviders: Array<'github'>;
  github: {
    configured: boolean;
    host?: string;
    defaultBase?: string;
  };
}

/** Name of the single secret each account namespace holds. */
const TOKEN_SECRET = 'token';

const SETTINGS_FILE = 'source-control.json';

const GH_PROBE_TTL_MS = 60_000;

interface PersistedFileV2 {
  version: 2;
  settings: SourceControlSettings;
}

/** The pre-accounts file shape, still on disk for existing installs. */
interface LegacyFile {
  activeProvider?: 'github' | 'none';
  github?: { token?: string; host?: string; defaultBase?: string };
}

interface DeviceLoginRecord {
  loginId: string;
  status: DeviceLoginStatus['status'];
  provider: ScmProviderId;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  host?: string;
  account?: SourceControlAccount;
  error?: string;
  timer?: ReturnType<typeof setTimeout>;
}

function emptySettings(): SourceControlSettings {
  return {
    accounts: [],
    defaultAccountId: null,
    generation: { provider: null, model: null },
    editor: { defaultEditor: null },
    defaultBase: null,
  };
}

function newAccountId(): string {
  return `scm-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** `https://ghe.acme.com/api/v3` → `ghe.acme.com`; unset → `github.com`. */
function hostLabel(host?: string): string {
  if (!host) return 'github.com';
  const withoutScheme = host.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const name = (withoutScheme.split('/')[0] ?? '').replace(/\/+$/, '');
  return name || 'github.com';
}

function errText(err: unknown): string {
  return redactTokens(err instanceof Error ? err.message : String(err));
}

export class SourceControlConfigService {
  private settings: SourceControlSettings = emptySettings();
  private readonly filePath: string;
  private readonly logins = new Map<string, DeviceLoginRecord>();
  private ghProbe: { at: number; available: boolean } | null = null;
  private disposed = false;

  constructor(
    private readonly registry: SourceControlRegistry,
    private readonly deps: SourceControlConfigDeps,
  ) {
    this.filePath = path.join(deps.configDir, SETTINGS_FILE);
  }

  // ── Lifecycle ──

  /** Read the file, migrate the legacy shape, load tokens, register accounts. */
  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch {
      raw = null;
    }

    let migrated = false;
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as PersistedFileV2 | LegacyFile;
        if (isV2(parsed)) {
          this.settings = normaliseSettings(parsed.settings);
        } else {
          this.settings = await this.migrateLegacy(parsed);
          migrated = true;
        }
      } catch (err) {
        this.deps.logger.warn(
          `[SCM] Could not read ${SETTINGS_FILE}, starting from empty settings: ${errText(err)}`,
        );
        this.settings = emptySettings();
      }
    }

    // Env seed — only when nothing is configured yet.
    if (this.settings.accounts.length === 0 && this.deps.env?.githubToken) {
      try {
        const account: SourceControlAccount = {
          id: 'env-github',
          provider: 'github',
          label: `github @ ${hostLabel(this.deps.env.githubHost)}`,
          ...(this.deps.env.githubHost ? { host: this.deps.env.githubHost } : {}),
          authMethod: 'token',
          createdAt: new Date().toISOString(),
        };
        await this.storeToken(account.id, this.deps.env.githubToken);
        this.settings.accounts = [account];
        this.settings.defaultAccountId = account.id;
        migrated = true;
      } catch (err) {
        // Best effort — a broken secret store must never stop the server booting.
        this.deps.logger.warn(`[SCM] Could not seed the env GitHub token: ${errText(err)}`);
      }
    }

    if (migrated) await this.persist();
    await this.registerAll();
    this.deps.logger.info(
      `[SCM] Source control loaded — ${this.settings.accounts.length} account(s), default=${this.settings.defaultAccountId ?? 'none'}`,
    );
  }

  /** Clear pending device-login timers. Safe to call more than once. */
  stop(): void {
    this.disposed = true;
    for (const record of this.logins.values()) {
      if (record.timer) clearTimeout(record.timer);
      record.timer = undefined;
    }
  }

  /** Alias of {@link stop}. */
  dispose(): void {
    this.stop();
  }

  // ── Settings ──

  /** Client-safe settings. Never contains a token. */
  getSettings(): SourceControlSettings {
    return {
      accounts: this.settings.accounts.map((a) => ({ ...a })),
      defaultAccountId: this.settings.defaultAccountId,
      generation: { ...this.settings.generation },
      editor: { ...this.settings.editor },
      defaultBase: this.settings.defaultBase,
    };
  }

  async updateSettings(partial: {
    defaultAccountId?: string | null;
    generation?: { provider?: string | null; model?: string | null };
    editor?: { defaultEditor?: EditorId | null };
    defaultBase?: string | null;
  }): Promise<SourceControlSettings> {
    if (partial.defaultAccountId !== undefined) {
      const id = partial.defaultAccountId;
      if (id !== null && !this.settings.accounts.some((a) => a.id === id)) {
        throw new ValidationError(`Unknown source-control account: ${id}`);
      }
      this.settings.defaultAccountId = id;
      this.registry.setDefault(id);
    }
    if (partial.generation) {
      if (partial.generation.provider !== undefined) {
        this.settings.generation.provider = partial.generation.provider;
      }
      if (partial.generation.model !== undefined) {
        this.settings.generation.model = partial.generation.model;
      }
    }
    if (partial.editor && partial.editor.defaultEditor !== undefined) {
      this.settings.editor.defaultEditor = partial.editor.defaultEditor;
    }
    if (partial.defaultBase !== undefined) {
      this.settings.defaultBase = partial.defaultBase || null;
    }
    await this.persist();
    return this.getSettings();
  }

  /** Model used to write commit messages and PR text. */
  generation(): { provider: string | null; model: string | null } {
    return { ...this.settings.generation };
  }

  /** Fallback base branch when a repo's default branch cannot be resolved. */
  defaultBase(): string | null {
    return this.settings.defaultBase;
  }

  /** Editor chosen for "Open in editor". */
  defaultEditor(): EditorId | null {
    return this.settings.editor.defaultEditor;
  }

  // ── Accounts ──

  async addAccount(input: {
    provider: ScmProviderId;
    method: SourceControlAuthMethod;
    token?: string;
    host?: string;
    label?: string;
  }): Promise<SourceControlAccount> {
    let token = input.token;
    if (input.method === 'token') {
      if (!token || !token.trim()) {
        throw new ValidationError('A personal access token is required for token sign-in.');
      }
      token = token.trim();
    } else if (input.method === 'gh-cli') {
      token = (await ghCliToken(this.deps.processRunner, input.host)) ?? undefined;
      if (!token) {
        throw new ValidationError(
          `The \`gh\` CLI has no token for ${hostLabel(input.host)}. Run \`gh auth login\` and try again.`,
        );
      }
    } else if (!token || !token.trim()) {
      throw new ValidationError('No token was obtained from the device flow.');
    }

    return this.connect({
      provider: input.provider,
      method: input.method,
      token: token!,
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    });
  }

  async removeAccount(id: string): Promise<void> {
    const existed = this.settings.accounts.some((a) => a.id === id);
    this.settings.accounts = this.settings.accounts.filter((a) => a.id !== id);
    this.registry.removeAccount(id);

    const namespace = SecretNamespace.sourceControl(id);
    try {
      await this.deps.secrets.removeNamespace(namespace);
    } catch {
      try {
        await this.deps.secrets.remove(namespace, TOKEN_SECRET);
      } catch (err) {
        this.deps.logger.warn(`[SCM] Could not remove the token for ${id}: ${errText(err)}`);
      }
    }

    if (this.settings.defaultAccountId === id) {
      this.settings.defaultAccountId = this.settings.accounts[0]?.id ?? null;
      this.registry.setDefault(this.settings.defaultAccountId);
    }
    if (existed) await this.persist();
  }

  // ── Sign-in methods ──

  async providerInfo(): Promise<SourceControlProviderInfo[]> {
    const loginMethods: SourceControlAuthMethod[] = ['token'];
    if (this.oauthClientId()) loginMethods.push('device');
    if (await this.ghCliAvailable()) loginMethods.push('gh-cli');
    return [{ id: 'github', name: 'GitHub', loginMethods }];
  }

  async startDeviceLogin(input: {
    provider: ScmProviderId;
    host?: string;
  }): Promise<DeviceLoginStart> {
    const clientId = this.oauthClientId();
    if (!clientId) {
      throw new ValidationError(
        'Device sign-in is not configured on this server (GENERATORAI_GITHUB_OAUTH_CLIENT_ID is unset).',
      );
    }
    const flow = new GitHubDeviceFlow(this.deps.http, {
      clientId,
      ...(input.host ? { host: input.host } : {}),
    });
    const grant = await flow.start();
    const loginId = `dl-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const record: DeviceLoginRecord = {
      loginId,
      status: 'pending',
      provider: input.provider,
      deviceCode: grant.deviceCode,
      intervalMs: Math.max(1, grant.interval) * 1000,
      expiresAt: Date.now() + Math.max(1, grant.expiresIn) * 1000,
      ...(input.host ? { host: input.host } : {}),
    };
    this.logins.set(loginId, record);
    this.schedulePoll(record, flow);
    return {
      loginId,
      userCode: grant.userCode,
      verificationUri: grant.verificationUri,
      expiresIn: grant.expiresIn,
      interval: grant.interval,
    };
  }

  /** Never exposes the device code or the token. */
  getDeviceLogin(loginId: string): DeviceLoginStatus | null {
    const record = this.logins.get(loginId);
    if (!record) return null;
    return {
      loginId: record.loginId,
      status: record.status,
      ...(record.account ? { account: { ...record.account } } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }

  // ── Legacy shims (the pre-accounts routes still call these) ──

  getConfig(): SafeSourceControlConfig {
    const configured = this.settings.accounts.length > 0;
    const account =
      this.settings.accounts.find((a) => a.id === this.settings.defaultAccountId) ??
      this.settings.accounts[0];
    return {
      activeProvider: configured ? 'github' : 'none',
      availableProviders: ['github'],
      github: {
        configured,
        ...(account?.host ? { host: account.host } : {}),
        ...(this.settings.defaultBase ? { defaultBase: this.settings.defaultBase } : {}),
      },
    };
  }

  async setConfig(update: {
    activeProvider?: 'github' | 'none';
    github?: { token?: string | null; host?: string | null; defaultBase?: string | null };
  }): Promise<SafeSourceControlConfig> {
    if (update.github?.defaultBase !== undefined) {
      this.settings.defaultBase = update.github.defaultBase || null;
      await this.persist();
    }
    if (update.github?.token !== undefined) {
      if (update.github.token === null || update.github.token === '') {
        const id = this.settings.defaultAccountId ?? this.settings.accounts[0]?.id;
        if (id) await this.removeAccount(id);
      } else {
        await this.addAccount({
          provider: 'github',
          method: 'token',
          token: update.github.token,
          ...(update.github.host ? { host: update.github.host } : {}),
        });
      }
    }
    if (update.activeProvider === 'none') {
      this.settings.defaultAccountId = null;
      this.registry.setDefault(null);
      this.registry.setActive('none');
      await this.persist();
    }
    return this.getConfig();
  }

  // ── Internals ──

  /** Validate a token, store it, register the account and persist. */
  private async connect(input: {
    provider: ScmProviderId;
    method: SourceControlAuthMethod;
    token: string;
    host?: string;
    label?: string;
  }): Promise<SourceControlAccount> {
    const provider = createProvider(
      input.provider,
      { token: input.token, ...(input.host ? { host: input.host } : {}) },
      {
        http: this.deps.http,
        logger: this.deps.logger,
        processRunner: this.deps.processRunner,
      },
    );

    let user: { login: string; avatarUrl?: string; scopes?: string[] };
    try {
      user = await provider.getAuthenticatedUser();
    } catch (err) {
      throw new ValidationError(
        `Could not authenticate with ${hostLabel(input.host)}: ${errText(err)}`,
      );
    }

    const account: SourceControlAccount = {
      id: newAccountId(),
      provider: input.provider,
      label: input.label ?? `${user.login} @ ${hostLabel(input.host)}`,
      ...(input.host ? { host: input.host } : {}),
      ...(user.login ? { login: user.login } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      ...(user.scopes ? { scopes: user.scopes } : {}),
      authMethod: input.method,
      createdAt: new Date().toISOString(),
    };

    await this.storeToken(account.id, input.token);
    this.settings.accounts = [...this.settings.accounts, account];
    this.registry.registerAccount(account, provider);
    if (!this.settings.defaultAccountId) {
      this.settings.defaultAccountId = account.id;
      this.registry.setDefault(account.id);
    }
    await this.persist();
    this.deps.logger.info(`[SCM] Connected account ${account.label} (${account.authMethod})`);
    return account;
  }

  private async registerAll(): Promise<void> {
    for (const account of this.settings.accounts) {
      try {
        const token = await this.readToken(account.id);
        const provider = createProvider(
          account.provider,
          { ...(token ? { token } : {}), ...(account.host ? { host: account.host } : {}) },
          {
            http: this.deps.http,
            logger: this.deps.logger,
            processRunner: this.deps.processRunner,
          },
        );
        this.registry.registerAccount(account, provider);
      } catch (err) {
        this.deps.logger.warn(
          `[SCM] Could not register account ${account.id}: ${errText(err)}`,
        );
      }
    }
    this.registry.setDefault(this.settings.defaultAccountId);
  }

  private async migrateLegacy(legacy: LegacyFile): Promise<SourceControlSettings> {
    const settings = emptySettings();
    settings.defaultBase = legacy.github?.defaultBase ?? null;
    const token = legacy.github?.token;
    if (!token) return settings;

    const account: SourceControlAccount = {
      id: 'legacy-github',
      provider: 'github',
      label: 'github',
      ...(legacy.github?.host ? { host: legacy.github.host } : {}),
      authMethod: 'token',
      createdAt: new Date().toISOString(),
    };
    try {
      await this.storeToken(account.id, token);
      settings.accounts = [account];
      settings.defaultAccountId = account.id;
      this.deps.logger.info('[SCM] Migrated the legacy GitHub token into an account');
    } catch (err) {
      this.deps.logger.warn(`[SCM] Could not migrate the legacy token: ${errText(err)}`);
    }
    return settings;
  }

  private async storeToken(accountId: string, token: string): Promise<void> {
    await this.deps.secrets.set(
      SecretNamespace.sourceControl(accountId),
      TOKEN_SECRET,
      new TextEncoder().encode(token),
    );
  }

  private async readToken(accountId: string): Promise<string | null> {
    const bytes = await this.deps.secrets.get(
      SecretNamespace.sourceControl(accountId),
      TOKEN_SECRET,
    );
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  private oauthClientId(): string | undefined {
    return (
      this.deps.env?.oauthClientId ??
      process.env['GENERATORAI_GITHUB_OAUTH_CLIENT_ID'] ??
      undefined
    );
  }

  private async ghCliAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.ghProbe && now - this.ghProbe.at < GH_PROBE_TTL_MS) return this.ghProbe.available;
    let available = false;
    try {
      const res = await this.deps.processRunner.run('gh', ['--version'], {
        cwd: process.cwd(),
        timeout: 5000,
      });
      available = res.exitCode === 0;
    } catch {
      available = false;
    }
    this.ghProbe = { at: now, available };
    return available;
  }

  /** One tick of the server-side device poller. Timers are unref'd. */
  private schedulePoll(record: DeviceLoginRecord, flow: GitHubDeviceFlow): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      void this.pollOnce(record, flow);
    }, record.intervalMs);
    // Never hold the process open on a login nobody is waiting for.
    (timer as { unref?: () => void }).unref?.();
    record.timer = timer;
  }

  private async pollOnce(record: DeviceLoginRecord, flow: GitHubDeviceFlow): Promise<void> {
    record.timer = undefined;
    if (this.disposed || record.status !== 'pending') return;
    if (Date.now() >= record.expiresAt) {
      record.status = 'expired';
      return;
    }
    try {
      const result = await flow.poll(record.deviceCode);
      switch (result.status) {
        case 'pending':
          this.schedulePoll(record, flow);
          return;
        case 'slow_down':
          record.intervalMs = Math.max(record.intervalMs, Math.max(1, result.interval) * 1000);
          this.schedulePoll(record, flow);
          return;
        case 'complete': {
          try {
            record.account = await this.connect({
              provider: record.provider,
              method: 'device',
              token: result.token,
              ...(record.host ? { host: record.host } : {}),
            });
            record.status = 'complete';
          } catch (err) {
            record.status = 'error';
            record.error = errText(err);
          }
          return;
        }
        case 'expired':
          record.status = 'expired';
          return;
        case 'denied':
          record.status = 'error';
          record.error = 'Sign-in was denied.';
          return;
        default:
          record.status = 'error';
          record.error = redactTokens(result.error);
          return;
      }
    } catch (err) {
      record.status = 'error';
      record.error = errText(err);
    }
  }

  private async persist(): Promise<void> {
    const payload: PersistedFileV2 = { version: 2, settings: this.getSettings() };
    try {
      await fs.mkdir(this.deps.configDir, { recursive: true });
      await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    } catch (err) {
      this.deps.logger.warn(`[SCM] Failed to persist ${SETTINGS_FILE}: ${errText(err)}`);
    }
  }
}

function isV2(value: PersistedFileV2 | LegacyFile): value is PersistedFileV2 {
  return (
    typeof (value as PersistedFileV2).version === 'number' &&
    typeof (value as PersistedFileV2).settings === 'object' &&
    (value as PersistedFileV2).settings !== null
  );
}

/** Fill in anything an older/hand-edited file left out. */
function normaliseSettings(raw: Partial<SourceControlSettings> | undefined): SourceControlSettings {
  const base = emptySettings();
  if (!raw) return base;
  return {
    accounts: Array.isArray(raw.accounts) ? raw.accounts.map(stripToken) : base.accounts,
    defaultAccountId: raw.defaultAccountId ?? null,
    generation: {
      provider: raw.generation?.provider ?? null,
      model: raw.generation?.model ?? null,
    },
    editor: { defaultEditor: raw.editor?.defaultEditor ?? null },
    defaultBase: raw.defaultBase ?? null,
  };
}

/** Defensive: a hand-edited file must not be able to smuggle a token back in. */
function stripToken(account: SourceControlAccount): SourceControlAccount {
  const clone = { ...account } as SourceControlAccount & { token?: unknown };
  delete clone.token;
  return clone;
}
