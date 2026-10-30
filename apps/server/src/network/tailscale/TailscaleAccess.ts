// ────────────────────────────────────────────────────────────────
// "Connect with Tailscale" — one-click access from the owner's other devices
// (D-123). No hosting, no certificate to install, no LAN exposure:
//
//   tailscale serve --bg --https=443 http://127.0.0.1:<port>
//
// makes `https://<machine>.<tailnet>.ts.net` answer on every device signed in
// to the same tailnet, with a publicly trusted certificate Tailscale
// provisions, proxied to this server on loopback. The server keeps listening
// on 127.0.0.1 only.
//
// The choice is persisted next to the database (`tailscale-access.json`) and
// re-applied when the server starts (the desktop's embedded server may come
// back on another port) and every minute while on (Tailscale started after
// GeneratorAI, or the user cleared Serve by hand). Turning it off removes the
// 443 handler only when it still points at this server.
//
// While on: the ts.net name is on the Host allow-list and CORS origins, the
// D-124 forwarded-header lane trusts `tailscale serve`'s X-Forwarded-Proto
// for that name only, and pairing offers list the ts.net address first.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TailscaleAccessStatus } from '@generatorai/shared';
import { setTailscaleServeHost } from '../requestOrigin.js';
import {
  createTailscaleRunner,
  locateTailscale,
  serveOffArgs,
  serveOnArgs,
  serveStatusArgs,
  serveTarget,
  statusArgs,
  type CliLocation,
  type TailscaleRunner,
} from './tailscaleCli.js';
import { describeCliFailure, extractEnableUrl, parseServeStatus, parseTailscaleStatus } from './tailscaleStatus.js';

const STATE_FILE = 'tailscale-access.json';
/** Where HTTPS certificates and MagicDNS are switched on for a tailnet. */
export const TAILSCALE_DNS_ADMIN_URL = 'https://login.tailscale.com/admin/dns';
const REFRESH_MS = 60_000;
const STATUS_TIMEOUT_MS = 8_000;
/** `serve` blocks while it waits for HTTPS to be enabled; long enough for a normal apply, short enough for a click. */
const SERVE_TIMEOUT_MS = 20_000;

export interface PersistedTailscaleAccess {
  enabled: boolean;
  /** The ts.net name it was turned on for. */
  dnsName: string | null;
  /** The port it last proxied to — recognised as ours when the port moves. */
  port: number | null;
  updatedAt: number;
}

const OFF: PersistedTailscaleAccess = { enabled: false, dnsName: null, port: null, updatedAt: 0 };

function parsePersisted(raw: string): PersistedTailscaleAccess {
  const parsed = JSON.parse(raw) as Partial<PersistedTailscaleAccess>;
  return {
    enabled: parsed.enabled === true,
    dnsName: typeof parsed.dnsName === 'string' && parsed.dnsName ? parsed.dnsName : null,
    port: typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : null,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  };
}

/** Boot only: the security context reads it once before the server listens. */
export function readTailscaleAccess(dataDir: string): PersistedTailscaleAccess {
  try {
    // eslint-disable-next-line no-restricted-syntax -- boot-only read before listen (composition/security.ts)
    return parsePersisted(fs.readFileSync(path.join(dataDir, STATE_FILE), 'utf8'));
  } catch {
    // Missing or corrupt: off. A broken file must never publish the server.
    return { ...OFF };
  }
}

export async function loadTailscaleAccess(dataDir: string): Promise<PersistedTailscaleAccess> {
  try {
    return parsePersisted(await fs.promises.readFile(path.join(dataDir, STATE_FILE), 'utf8'));
  } catch {
    return { ...OFF };
  }
}

async function writeTailscaleAccess(dataDir: string, state: PersistedTailscaleAccess): Promise<void> {
  await fs.promises.mkdir(dataDir, { recursive: true });
  // Owner-only: it decides whether the server is reachable from other devices.
  await fs.promises.writeFile(path.join(dataDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

let advertisedOrigin: string | null = null;

/** `https://<name>.ts.net` while Tailscale access is on and serving this server; pairing offers list it first. */
export function tailscaleAdvertisedOrigin(): string | null {
  return advertisedOrigin;
}

/** Test seam. */
export function resetTailscaleAdvertisedOrigin(): void {
  advertisedOrigin = null;
}

export interface TailscaleAccessOptions {
  dataDir: string;
  /** The port this server listens on now. */
  port: () => number;
  logger: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
  /** Reasons the server must not be reachable from other devices (unauthenticated mode, a weak vault). */
  blockers: () => Promise<{ code: string; message: string }[]>;
  /** Called when the server becomes reachable from other devices, or stops being. */
  onReachableChange?: (reachable: boolean) => void;
  locate?: () => CliLocation | null;
  runnerFor?: (location: CliLocation) => TailscaleRunner;
  now?: () => number;
}

export type TailscaleConnectResult =
  | { ok: true; status: TailscaleAccessStatus }
  | { ok: false; code: string; message: string; status: TailscaleAccessStatus };

type FullStatus = TailscaleAccessStatus & { detail: 'full' };

export class TailscaleAccess {
  private readonly options: TailscaleAccessOptions;
  private lastProblem: string | null = null;
  private lastEnableUrl: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private boundPort: number | null = null;

  constructor(options: TailscaleAccessOptions) {
    this.options = options;
  }

  /** The port the listener actually bound (it may have moved past a busy one). */
  setListenPort(port: number): void {
    this.boundPort = port;
  }

  private port(): number {
    return this.boundPort ?? this.options.port();
  }

  persisted(): Promise<PersistedTailscaleAccess> {
    return loadTailscaleAccess(this.options.dataDir);
  }

  private runner(): { location: CliLocation; run: TailscaleRunner } | null {
    const location = (this.options.locate ?? (() => locateTailscale()))();
    if (!location) return null;
    return { location, run: (this.options.runnerFor ?? ((l) => createTailscaleRunner(l)))(location) };
  }

  /** Inspects Tailscale and this server's Serve handler. Never throws; never changes anything. */
  async status(): Promise<FullStatus> {
    const persisted = await this.persisted();
    const blockers = await this.options.blockers().catch(() => []);
    const base: FullStatus = {
      detail: 'full',
      enabled: persisted.enabled,
      state: 'error',
      origin: null,
      dnsName: null,
      tailnet: null,
      version: null,
      cliPath: null,
      loginUrl: null,
      enableHttpsUrl: null,
      problem: this.lastProblem,
      conflict: null,
      funnel: false,
      blockers,
    };
    const cli = this.runner();
    if (!cli) return { ...base, state: 'not-installed', problem: null };
    base.cliPath = cli.location.path;

    const result = await cli.run(statusArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
    const parsed = result.code === 0 ? parseTailscaleStatus(result.stdout) : null;
    if (!parsed) {
      // `status --json` exits non-zero when tailscaled is down, but still
      // prints JSON when it is merely logged out on some versions.
      const fallback = parseTailscaleStatus(result.stdout);
      if (fallback && fallback.backend === 'needs-login') {
        return { ...base, state: 'needs-login', loginUrl: fallback.loginUrl, version: fallback.version, problem: null };
      }
      const failure = result.timedOut
        ? { code: 'not-running' as const, message: 'Tailscale did not answer. Open Tailscale and connect, then try again.' }
        : describeCliFailure(`${result.spawnError ?? ''}\n${result.stderr}\n${result.stdout}`);
      // The card explains not-running / needs-login itself; only an
      // unreadable answer needs the CLI's words.
      const state = failure.code === 'not-running' ? 'not-running' : failure.code === 'needs-login' ? 'needs-login' : 'error';
      return { ...base, state, problem: state === 'error' ? failure.message : null };
    }
    const withTailnet: FullStatus = { ...base, dnsName: parsed.dnsName, tailnet: parsed.tailnet, version: parsed.version };
    if (parsed.backend === 'needs-login') return { ...withTailnet, state: 'needs-login', loginUrl: parsed.loginUrl, problem: null };
    if (parsed.backend !== 'running') return { ...withTailnet, state: 'not-running', problem: null };
    if (!parsed.dnsName || !parsed.magicDnsEnabled) {
      return {
        ...withTailnet,
        state: 'https-disabled',
        enableHttpsUrl: TAILSCALE_DNS_ADMIN_URL,
        problem: this.lastProblem ?? 'Turn on MagicDNS for your tailnet (Tailscale admin console › DNS), then HTTPS Certificates.',
      };
    }
    if (!parsed.httpsEnabled && !(persisted.enabled && persisted.dnsName === parsed.dnsName)) {
      return {
        ...withTailnet,
        state: 'https-disabled',
        enableHttpsUrl: this.lastEnableUrl ?? TAILSCALE_DNS_ADMIN_URL,
        // The card already says what to do; a failed Connect adds its reason.
        problem: this.lastProblem,
      };
    }

    const serve = await cli.run(serveStatusArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
    const handler = serve.code === 0 ? parseServeStatus(serve.stdout, parsed.dnsName) : null;
    const ours = serveTarget(this.port());
    const previous = persisted.port ? serveTarget(persisted.port) : null;
    const proxyTarget = handler?.proxyTarget ?? null;
    const conflict =
      proxyTarget && proxyTarget !== ours && proxyTarget !== previous
        ? `Tailscale Serve already sends https://${parsed.dnsName} to ${proxyTarget}. Connecting replaces it.`
        : null;
    const on = persisted.enabled && proxyTarget === ours;
    return {
      ...withTailnet,
      state: on ? 'on' : 'ready',
      origin: on ? `https://${parsed.dnsName}` : null,
      funnel: Boolean(on && handler?.funnel),
      conflict,
      problem: on ? null : persisted.enabled ? (this.lastProblem ?? 'Tailscale Serve is not pointing at this server right now.') : this.lastProblem,
    };
  }

  /** One Tailscale change at a time: a click during the minute refresh must not interleave CLI calls. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  connect(options: { replace?: boolean } = {}): Promise<TailscaleConnectResult> {
    return this.exclusive(() => this.connectNow(options));
  }

  private async connectNow(options: { replace?: boolean }): Promise<TailscaleConnectResult> {
    const before = await this.status();
    const fail = (code: string, message: string, status: FullStatus = before): TailscaleConnectResult => {
      this.lastProblem = message;
      return { ok: false, code, message, status: { ...status, problem: message } };
    };
    if (before.blockers && before.blockers.length > 0) {
      return fail('TAILSCALE_BLOCKED', before.blockers.map((b: { message: string }) => b.message).join(' '));
    }
    switch (before.state) {
      case 'not-installed':
        return fail('TAILSCALE_NOT_INSTALLED', 'Tailscale is not installed on this computer. Install it (free), sign in, then connect.');
      case 'not-running':
        return fail('TAILSCALE_NOT_RUNNING', before.problem ?? 'Tailscale is not running.');
      case 'needs-login':
        return fail('TAILSCALE_NEEDS_LOGIN', 'Sign in to Tailscale on this computer, then connect.');
      case 'error':
        return fail('TAILSCALE_ERROR', before.problem ?? 'Tailscale could not be read.');
      default:
        break;
    }
    if (!before.dnsName) return fail('TAILSCALE_NO_NAME', 'Tailscale gave this computer no MagicDNS name. Turn on MagicDNS.');
    if (before.conflict && !options.replace) return fail('TAILSCALE_SERVE_CONFLICT', before.conflict);

    const cli = this.runner();
    if (!cli) return fail('TAILSCALE_NOT_INSTALLED', 'Tailscale is not installed on this computer.');
    const port = this.port();
    const result = await cli.run(serveOnArgs(port), { timeoutMs: SERVE_TIMEOUT_MS });
    const output = `${result.stdout}\n${result.stderr}`;
    const check = await cli.run(serveStatusArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
    const handler = check.code === 0 ? parseServeStatus(check.stdout, before.dnsName) : null;
    if (handler?.proxyTarget !== serveTarget(port)) {
      const enableUrl = extractEnableUrl(output);
      if (enableUrl) {
        this.lastEnableUrl = enableUrl;
        return fail(
          'TAILSCALE_HTTPS_DISABLED',
          'HTTPS has to be turned on for your tailnet first. Open the Tailscale link, approve it, then click Connect again.',
          { ...before, state: 'https-disabled', enableHttpsUrl: enableUrl },
        );
      }
      const failure = result.timedOut
        ? { message: 'Tailscale did not finish setting up Serve. Check the Tailscale app, then try again.' }
        : describeCliFailure(`${result.spawnError ?? ''}\n${output}`);
      this.options.logger.warn('[Tailscale] serve failed', { code: result.code, timedOut: result.timedOut });
      return fail('TAILSCALE_SERVE_FAILED', failure.message);
    }

    await writeTailscaleAccess(this.options.dataDir, { enabled: true, dnsName: before.dnsName, port, updatedAt: (this.options.now ?? Date.now)() });
    this.lastProblem = null;
    this.lastEnableUrl = null;
    this.applyOn(before.dnsName);
    this.options.logger.info('[Tailscale] serving this server', { origin: `https://${before.dnsName}`, port });
    this.startRefresh();
    return { ok: true, status: await this.status() };
  }

  disconnect(): Promise<TailscaleAccessStatus> {
    return this.exclusive(async () => {
      const persisted = await this.persisted();
      // Stop trusting and advertising first: even if the CLI fails below, this
      // server no longer accepts the ts.net lane.
      await writeTailscaleAccess(this.options.dataDir, { ...persisted, enabled: false, updatedAt: (this.options.now ?? Date.now)() });
      this.applyOff();
      this.stopRefresh();
      this.lastProblem = null;
      const cli = this.runner();
      if (cli && persisted.dnsName) {
        const serve = await cli.run(serveStatusArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
        const target = serve.code === 0 ? parseServeStatus(serve.stdout, persisted.dnsName)?.proxyTarget : null;
        const ours = new Set([serveTarget(this.port()), ...(persisted.port ? [serveTarget(persisted.port)] : [])]);
        // Never remove a handler another app put there.
        if (target && ours.has(target)) {
          const off = await cli.run(serveOffArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
          if (off.code !== 0) {
            this.lastProblem = `Tailscale Serve could not be turned off: ${describeCliFailure(`${off.stderr}\n${off.stdout}`).message} Run "tailscale serve --https=443 off".`;
          }
        }
      }
      this.options.logger.info('[Tailscale] access turned off');
      return this.status();
    });
  }

  /**
   * On server start: trust the persisted name, then make Serve point at this
   * process's port again. Safe to call when Tailscale is absent or off.
   */
  async start(): Promise<void> {
    const persisted = await this.persisted();
    if (!persisted.enabled) return;
    await this.reapply();
    this.startRefresh();
  }

  private reapply(): Promise<void> {
    return this.exclusive(async () => {
      const persisted = await this.persisted();
      if (!persisted.enabled) return;
      const blockers = await this.options.blockers().catch(() => []);
      if (blockers.length > 0) {
        // Never publish a server that must not be reachable; the owner sees why.
        this.applyOff();
        this.lastProblem = `Tailscale access is paused: ${blockers.map((b: { message: string }) => b.message).join(' ')}`;
        this.options.logger.warn('[Tailscale] access paused', { blockers: blockers.map((b) => b.code) });
        return;
      }
      if (persisted.dnsName) setTailscaleServeHost(persisted.dnsName);
      const status = await this.status();
      if (status.state === 'on') {
        this.applyOn(status.dnsName ?? persisted.dnsName!);
        return;
      }
      advertisedOrigin = null;
      if (status.state !== 'ready' || !status.dnsName || status.conflict) return;
      const cli = this.runner();
      if (!cli) return;
      const port = this.port();
      const result = await cli.run(serveOnArgs(port), { timeoutMs: SERVE_TIMEOUT_MS });
      const check = await cli.run(serveStatusArgs(), { timeoutMs: STATUS_TIMEOUT_MS });
      if (check.code === 0 && parseServeStatus(check.stdout, status.dnsName)?.proxyTarget === serveTarget(port)) {
        await writeTailscaleAccess(this.options.dataDir, { ...persisted, dnsName: status.dnsName, port, updatedAt: (this.options.now ?? Date.now)() });
        this.lastProblem = null;
        this.applyOn(status.dnsName);
        this.options.logger.info('[Tailscale] re-applied Serve', { origin: `https://${status.dnsName}`, port });
      } else {
        this.lastProblem = describeCliFailure(`${result.stderr}\n${result.stdout}`).message;
        this.options.logger.warn('[Tailscale] could not re-apply Serve', { code: result.code });
      }
    });
  }

  private applyOn(dnsName: string): void {
    setTailscaleServeHost(dnsName);
    const origin = `https://${dnsName}`;
    if (advertisedOrigin !== origin) {
      advertisedOrigin = origin;
      this.options.onReachableChange?.(true);
    }
  }

  private applyOff(): void {
    setTailscaleServeHost(null);
    if (advertisedOrigin !== null) {
      advertisedOrigin = null;
    }
    this.options.onReachableChange?.(false);
  }

  private startRefresh(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.reapply().catch(() => undefined), REFRESH_MS);
    this.timer.unref?.();
  }

  private stopRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.stopRefresh();
  }
}

/** What a device without `admin:settings` sees (D-120): whether it is on, nothing that names the machine. */
export function limitedTailscaleStatus(status: TailscaleAccessStatus): TailscaleAccessStatus {
  return { detail: 'limited', enabled: status.enabled, state: status.state, origin: null };
}
