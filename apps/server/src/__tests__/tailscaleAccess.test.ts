// ────────────────────────────────────────────────────────────────
// "Connect with Tailscale" (D-123, D-124): reading the CLI, building its
// commands, the service's connect / disconnect / re-apply, the forwarded-
// header lane, the Host allow-list and the endpoint order.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeCliFailure,
  extractEnableUrl,
  parseServeStatus,
  parseTailscaleStatus,
} from '../network/tailscale/tailscaleStatus.js';
import {
  createTailscaleRunner,
  locateTailscale,
  serveOffArgs,
  serveOnArgs,
  serveStatusArgs,
  statusArgs,
  tailscaleCandidates,
  type CliResult,
} from '../network/tailscale/tailscaleCli.js';
import {
  TailscaleAccess,
  limitedTailscaleStatus,
  readTailscaleAccess,
  resetTailscaleAdvertisedOrigin,
  tailscaleAdvertisedOrigin,
} from '../network/tailscale/TailscaleAccess.js';
import {
  isTailscaleServeRequest,
  parseTrustProxy,
  requestAbsoluteUrl,
  requestClientAddress,
  requestOrigin,
  setTailscaleServeHost,
  tailscaleServeHost,
} from '../network/requestOrigin.js';
import { buildHostAllowlist, hostCheck, resetHostAllowlistCache, serverHostAllowlist } from '../middleware/hostAllowlist.js';
import { classifyTransport } from '../middleware/transportPolicy.js';
import { resolveAdvertisedEndpoints, selectPairingEndpoint } from '../network/advertisedEndpoints.js';
import { serverEndpoints } from '../network/serverEndpoints.js';

const NAME = 'studio.tail1234.ts.net';

// ── Fixtures: what `tailscale status --json` prints ───────────────

const runningHttps = {
  Version: '1.88.3-t1234',
  BackendState: 'Running',
  AuthURL: '',
  Self: { DNSName: 'Studio.tail1234.ts.net.', HostName: 'studio', CapMap: { https: null, 'funnel-ports?ports=443': null } },
  CertDomains: ['studio.tail1234.ts.net'],
  CurrentTailnet: { Name: 'owner@example.com', MagicDNSSuffix: 'tail1234.ts.net', MagicDNSEnabled: true },
};
const loggedOut = {
  Version: '1.88.3',
  BackendState: 'NeedsLogin',
  AuthURL: 'https://login.tailscale.com/a/abc123',
  Self: { DNSName: '' },
  CurrentTailnet: null,
};
const httpsOff = {
  ...runningHttps,
  Self: { DNSName: 'studio.tail1234.ts.net.', Capabilities: ['funnel'] },
  CertDomains: null,
};
const stopped = { ...runningHttps, BackendState: 'Stopped' };
/** Fast user switching: the CLI reports the current tailnet; certificate names may list several. */
const multipleTailnets = {
  ...runningHttps,
  Self: { DNSName: 'studio.work-net.ts.net.' },
  CertDomains: ['studio.tail1234.ts.net', 'studio.work-net.ts.net'],
  CurrentTailnet: { Name: 'work.example', MagicDNSSuffix: 'work-net.ts.net', MagicDNSEnabled: true },
};

describe('parseTailscaleStatus', () => {
  it('reads a running node with HTTPS on, normalising the name', () => {
    expect(parseTailscaleStatus(JSON.stringify(runningHttps))).toEqual({
      backend: 'running',
      dnsName: NAME,
      tailnet: 'owner@example.com',
      magicDnsEnabled: true,
      httpsEnabled: true,
      loginUrl: null,
      version: '1.88.3-t1234',
    });
  });

  it('reads a logged-out node and keeps only a Tailscale sign-in link', () => {
    const parsed = parseTailscaleStatus(JSON.stringify(loggedOut));
    expect(parsed?.backend).toBe('needs-login');
    expect(parsed?.loginUrl).toBe('https://login.tailscale.com/a/abc123');
    expect(parsed?.dnsName).toBeNull();
    const hostile = parseTailscaleStatus(JSON.stringify({ ...loggedOut, AuthURL: 'https://evil.example/login' }));
    expect(hostile?.loginUrl).toBeNull();
  });

  it('sees HTTPS certificates off when neither CertDomains nor the capability says so', () => {
    expect(parseTailscaleStatus(JSON.stringify(httpsOff))?.httpsEnabled).toBe(false);
    // The older `Capabilities` list counts too.
    const viaCaps = { ...httpsOff, Self: { DNSName: `${NAME}.`, Capabilities: ['https'] } };
    expect(parseTailscaleStatus(JSON.stringify(viaCaps))?.httpsEnabled).toBe(true);
  });

  it('maps every backend state', () => {
    expect(parseTailscaleStatus(JSON.stringify(stopped))?.backend).toBe('stopped');
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'Starting' }))?.backend).toBe('starting');
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsMachineAuth' }))?.backend).toBe('needs-login');
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'Weird' }))?.backend).toBe('unknown');
  });

  it('uses this node’s own name when several tailnets’ names are listed', () => {
    const parsed = parseTailscaleStatus(JSON.stringify(multipleTailnets));
    expect(parsed?.dnsName).toBe('studio.work-net.ts.net');
    expect(parsed?.httpsEnabled).toBe(true);
    expect(parsed?.tailnet).toBe('work.example');
  });

  it('refuses garbage and names that are not plain DNS names', () => {
    expect(parseTailscaleStatus('not json')).toBeNull();
    expect(parseTailscaleStatus('[]')).toBeNull();
    const injected = parseTailscaleStatus(JSON.stringify({ ...runningHttps, Self: { DNSName: 'a b.ts.net.' } }));
    expect(injected?.dnsName).toBeNull();
  });
});

describe('parseServeStatus', () => {
  it('reads an empty config', () => {
    expect(parseServeStatus('{}', NAME)).toEqual({ proxyTarget: null, funnel: false });
    expect(parseServeStatus('', NAME)).toEqual({ proxyTarget: null, funnel: false });
  });

  it('reads the root handler for this name on 443, and Funnel', () => {
    const config = {
      TCP: { '443': { HTTPS: true } },
      Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3100' } } } },
      AllowFunnel: { [`${NAME}:443`]: true },
    };
    expect(parseServeStatus(JSON.stringify(config), NAME)).toEqual({ proxyTarget: 'http://127.0.0.1:3100', funnel: true });
  });

  it('ignores another name or port, and garbage', () => {
    const config = { Web: { [`${NAME}:8443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:1' } } } } };
    expect(parseServeStatus(JSON.stringify(config), NAME)?.proxyTarget).toBeNull();
    expect(parseServeStatus('{', NAME)).toBeNull();
  });
});

describe('CLI output', () => {
  it('finds the enable-HTTPS link the CLI prints, and only Tailscale’s', () => {
    const out = '\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nXYZ\n\n';
    expect(extractEnableUrl(out)).toBe('https://login.tailscale.com/f/serve?node=nXYZ');
    expect(extractEnableUrl('visit https://evil.example/f/serve')).toBeNull();
  });

  it('describes failures in plain words', () => {
    expect(describeCliFailure('failed to connect to local tailscaled; it doesn’t appear to be running').code).toBe('not-running');
    expect(describeCliFailure('Access denied: serve config denied').code).toBe('permission');
    expect(describeCliFailure('boom').message).toContain('boom');
  });
});

describe('command builder', () => {
  it('builds exact argument arrays (no shell anywhere)', () => {
    expect(statusArgs()).toEqual(['status', '--json']);
    expect(serveStatusArgs()).toEqual(['serve', 'status', '--json']);
    expect(serveOnArgs(3100)).toEqual(['serve', '--bg', '--https=443', 'http://127.0.0.1:3100']);
    expect(serveOffArgs()).toEqual(['serve', '--https=443', 'off']);
    expect(() => serveOnArgs(0)).toThrow();
    expect(() => serveOnArgs(70_000)).toThrow();
    expect(() => serveOnArgs(Number.NaN)).toThrow();
  });

  it('looks in PATH first, then where each OS installs Tailscale', () => {
    const mac = tailscaleCandidates('darwin', { PATH: '/usr/bin:/opt/x' });
    expect(mac.slice(0, 2)).toEqual(['/usr/bin/tailscale', '/opt/x/tailscale']);
    expect(mac).toContain('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
    const win = tailscaleCandidates('win32', { Path: 'C:\\Tools;"C:\\Other"', ProgramFiles: 'C:\\Program Files' });
    expect(win[0]).toBe('C:\\Tools\\tailscale.exe');
    expect(win[1]).toBe('C:\\Other\\tailscale.exe');
    expect(win).toContain('C:\\Program Files\\Tailscale\\tailscale.exe');
    expect(tailscaleCandidates('linux', { PATH: '' })).toEqual([
      '/usr/bin/tailscale',
      '/usr/sbin/tailscale',
      '/usr/local/bin/tailscale',
      '/snap/bin/tailscale',
    ]);
  });

  it('locates the CLI, the macOS app bundle, an override, or nothing', () => {
    const bundle = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
    expect(locateTailscale({ platform: 'darwin', env: { PATH: '/usr/bin' }, isExecutable: (f) => f === bundle })?.path).toBe(bundle);
    expect(locateTailscale({ platform: 'linux', env: { PATH: '/usr/bin' }, isExecutable: () => false })).toBeNull();
    const script = locateTailscale({ env: { GENERATORAI_TAILSCALE_CLI: '/tmp/fake-tailscale.mjs' }, isExecutable: () => false, nodePath: '/node' });
    expect(script).toEqual({ command: '/node', prefix: ['/tmp/fake-tailscale.mjs'], path: '/tmp/fake-tailscale.mjs' });
  });
});

describe('runner', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gai-ts-runner-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes arguments verbatim, never through a shell', async () => {
    const script = join(dir, 'echo.mjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const run = createTailscaleRunner({ command: process.execPath, prefix: [script], path: script });
    const hostile = ['serve', '$(touch pwned)', '; rm -rf /', '`id`', '&& echo hi'];
    const result = await run(hostile);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(hostile);
  });

  it('kills a CLI that waits (serve waiting for HTTPS to be enabled) at the timeout', async () => {
    const script = join(dir, 'hang.mjs');
    writeFileSync(script, 'console.log("To enable, visit: https://login.tailscale.com/f/serve?node=1"); setInterval(() => {}, 1000);');
    chmodSync(script, 0o755);
    const run = createTailscaleRunner({ command: process.execPath, prefix: [script], path: script });
    const started = Date.now();
    const result = await run(['serve'], { timeoutMs: 600 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(extractEnableUrl(result.stdout)).toBe('https://login.tailscale.com/f/serve?node=1');
  });

  it('reports a program that cannot start', async () => {
    const run = createTailscaleRunner({ command: join(dir, 'missing'), prefix: [], path: 'missing' });
    const result = await run(['status']);
    expect(result.spawnError).toBeTruthy();
  });
});

// ── The service, against a scripted CLI ───────────────────────────

interface FakeCli {
  status: unknown;
  serveTarget: string | null;
  httpsEnabledOnServe: boolean;
  calls: string[][];
  failServe?: string;
}

function fakeRunner(cli: FakeCli) {
  return async (args: string[]): Promise<CliResult> => {
    cli.calls.push(args);
    const ok = (stdout: string): CliResult => ({ code: 0, stdout, stderr: '', timedOut: false, spawnError: null });
    if (args[0] === 'status') return ok(JSON.stringify(cli.status));
    if (args.join(' ') === 'serve status --json') {
      return ok(cli.serveTarget ? JSON.stringify({ Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: cli.serveTarget } } } } }) : '{}');
    }
    if (args[0] === 'serve' && args.at(-1) === 'off') {
      cli.serveTarget = null;
      return ok('');
    }
    if (args[0] === 'serve' && args[1] === '--bg') {
      if (cli.failServe) return { code: 1, stdout: '', stderr: cli.failServe, timedOut: false, spawnError: null };
      if (!cli.httpsEnabledOnServe) {
        return { code: 0, stdout: 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=n1\n', stderr: '', timedOut: false, spawnError: null };
      }
      cli.serveTarget = args[3]!;
      return ok(`Available within your tailnet:\nhttps://${NAME}\n`);
    }
    return { code: 1, stdout: '', stderr: 'unknown command', timedOut: false, spawnError: null };
  };
}

describe('TailscaleAccess', () => {
  let dataDir: string;
  let cli: FakeCli;
  let reachable: boolean[];
  let blockers: { code: string; message: string }[];
  let port: number;

  const make = (installed = true) =>
    new TailscaleAccess({
      dataDir,
      port: () => port,
      logger: { info: () => {}, warn: () => {} },
      blockers: async () => blockers,
      onReachableChange: (r) => reachable.push(r),
      locate: () => (installed ? { command: 'tailscale', prefix: [], path: '/usr/bin/tailscale' } : null),
      runnerFor: () => fakeRunner(cli),
      now: () => 1_000,
    });

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'gai-ts-access-'));
    cli = { status: runningHttps, serveTarget: null, httpsEnabledOnServe: true, calls: [] };
    reachable = [];
    blockers = [];
    port = 3100;
    setTailscaleServeHost(null);
    resetTailscaleAdvertisedOrigin();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    setTailscaleServeHost(null);
    resetTailscaleAdvertisedOrigin();
  });

  it('reports each state the UI explains', async () => {
    expect((await make(false).status()).state).toBe('not-installed');
    cli.status = loggedOut;
    const needsLogin = await make().status();
    expect(needsLogin.state).toBe('needs-login');
    expect(needsLogin.loginUrl).toBe('https://login.tailscale.com/a/abc123');
    cli.status = httpsOff;
    const off = await make().status();
    expect(off.state).toBe('https-disabled');
    expect(off.enableHttpsUrl).toBe('https://login.tailscale.com/admin/dns');
    cli.status = stopped;
    expect((await make().status()).state).toBe('not-running');
    cli.status = runningHttps;
    expect((await make().status()).state).toBe('ready');
  });

  it('connects: serves 443 → loopback, persists, trusts and advertises the name', async () => {
    const access = make();
    const result = await access.connect();
    expect(result.ok).toBe(true);
    expect(cli.calls).toContainEqual(['serve', '--bg', '--https=443', 'http://127.0.0.1:3100']);
    expect(result.status).toMatchObject({ state: 'on', enabled: true, origin: `https://${NAME}` });
    expect(readTailscaleAccess(dataDir)).toMatchObject({ enabled: true, dnsName: NAME, port: 3100 });
    expect(tailscaleServeHost()).toBe(NAME);
    expect(tailscaleAdvertisedOrigin()).toBe(`https://${NAME}`);
    expect(reachable).toEqual([true]);
    access.stop();
  });

  it('surfaces Tailscale’s own enable-HTTPS link when Serve is not enabled yet', async () => {
    cli.status = httpsOff;
    cli.httpsEnabledOnServe = false;
    const result = await make().connect();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TAILSCALE_HTTPS_DISABLED');
    expect(result.status.enableHttpsUrl).toBe('https://login.tailscale.com/f/serve?node=n1');
    expect(readTailscaleAccess(dataDir).enabled).toBe(false);
    expect(tailscaleServeHost()).toBeNull();
  });

  it('refuses when not installed, signed out, or blocked', async () => {
    expect((await make(false).connect()).ok).toBe(false);
    cli.status = loggedOut;
    const signedOut = await make().connect();
    expect(signedOut.ok ? null : signedOut.code).toBe('TAILSCALE_NEEDS_LOGIN');
    cli.status = runningHttps;
    blockers = [{ code: 'unauthenticated_loopback', message: 'Authentication is off.' }];
    const blocked = await make().connect();
    expect(blocked.ok ? null : blocked.code).toBe('TAILSCALE_BLOCKED');
    expect(cli.calls.some((c) => c[1] === '--bg')).toBe(false);
  });

  it('does not replace another app’s Serve handler unless asked', async () => {
    cli.serveTarget = 'http://127.0.0.1:8080';
    const access = make();
    const refused = await access.connect();
    expect(refused.ok ? null : refused.code).toBe('TAILSCALE_SERVE_CONFLICT');
    expect(cli.serveTarget).toBe('http://127.0.0.1:8080');
    const replaced = await access.connect({ replace: true });
    expect(replaced.ok).toBe(true);
    expect(cli.serveTarget).toBe('http://127.0.0.1:3100');
    access.stop();
  });

  it('turns off its own handler, and leaves a foreign one alone', async () => {
    const access = make();
    await access.connect();
    const off = await access.disconnect();
    expect(off.enabled).toBe(false);
    expect(cli.serveTarget).toBeNull();
    expect(tailscaleServeHost()).toBeNull();
    expect(tailscaleAdvertisedOrigin()).toBeNull();
    expect(reachable.at(-1)).toBe(false);

    await access.connect();
    cli.serveTarget = 'http://127.0.0.1:9999';
    await access.disconnect();
    expect(cli.serveTarget).toBe('http://127.0.0.1:9999');
    access.stop();
  });

  it('re-applies on start when the server came back on another port', async () => {
    const first = make();
    await first.connect();
    first.stop();
    setTailscaleServeHost(null);
    resetTailscaleAdvertisedOrigin();

    port = 3105;
    const second = make();
    second.setListenPort(3105);
    await second.start();
    expect(cli.serveTarget).toBe('http://127.0.0.1:3105');
    expect(readTailscaleAccess(dataDir).port).toBe(3105);
    expect(tailscaleAdvertisedOrigin()).toBe(`https://${NAME}`);
    second.stop();
  });

  it('pauses (never serves) at start while a blocker applies', async () => {
    const first = make();
    await first.connect();
    first.stop();
    cli.serveTarget = null;
    blockers = [{ code: 'insecure_secret_store', message: 'Weak vault.' }];
    const second = make();
    await second.start();
    expect(cli.serveTarget).toBeNull();
    expect(tailscaleServeHost()).toBeNull();
    expect((await second.status()).problem).toContain('paused');
    second.stop();
  });

  it('a corrupt state file means off', () => {
    writeFileSync(join(dataDir, 'tailscale-access.json'), '{nope');
    expect(readTailscaleAccess(dataDir).enabled).toBe(false);
  });

  it('the limited view names nothing about the machine', async () => {
    const access = make();
    await access.connect();
    const limited = limitedTailscaleStatus(await access.status());
    expect(limited).toEqual({ detail: 'limited', enabled: true, state: 'on', origin: null });
    access.stop();
  });
});

// ── The D-124 lane ────────────────────────────────────────────────

function req(headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

describe('forwarded headers from tailscale serve (D-124)', () => {
  const off = parseTrustProxy(undefined);
  const serveHeaders = { host: NAME, 'x-forwarded-host': NAME, 'x-forwarded-proto': 'https', 'x-forwarded-for': '100.101.102.103' };

  it('a loopback request for the ts.net name is https://<name>', () => {
    expect(isTailscaleServeRequest(req(serveHeaders), NAME)).toBe(true);
    expect(requestOrigin(req(serveHeaders), off, NAME)).toEqual({ scheme: 'https', host: NAME, forwarded: true });
  });

  it('honours it only while Tailscale access is on', () => {
    setTailscaleServeHost(NAME);
    try {
      expect(requestAbsoluteUrl(req(serveHeaders), '/api/x', off)).toBe(`https://${NAME}/api/x`);
      expect(classifyTransport(req(serveHeaders), off)).toBe('https');
      expect(requestClientAddress(req(serveHeaders), off)).toBe('100.101.102.103');
    } finally {
      setTailscaleServeHost(null);
    }
    expect(requestOrigin(req(serveHeaders), off).scheme).toBe('http');
  });

  it('ignores the same headers from a non-loopback peer', () => {
    const forged = req(serveHeaders, '192.168.1.50');
    expect(requestOrigin(forged, off, NAME)).toEqual({ scheme: 'http', host: NAME, forwarded: false });
    expect(requestClientAddress(forged, off)).toBe('192.168.1.50');
  });

  it('ignores a loopback request whose Host or X-Forwarded-Host is another name (rebinding)', () => {
    expect(requestOrigin(req({ ...serveHeaders, host: 'evil.example' }), off, NAME).forwarded).toBe(false);
    expect(requestOrigin(req({ ...serveHeaders, 'x-forwarded-host': 'evil.example' }), off, NAME).forwarded).toBe(false);
    expect(requestOrigin(req({ ...serveHeaders, host: `${NAME}.evil.example` }), off, NAME).forwarded).toBe(false);
  });

  it('never makes a request loopback-privileged, and never reads Tailscale-User-*', () => {
    const withIdentity = req({ ...serveHeaders, 'tailscale-user-login': 'owner@example.com' });
    const origin = requestOrigin(withIdentity, off, NAME);
    // Forwarded → not the local-machine lane.
    expect(origin.forwarded).toBe(true);
    expect(JSON.stringify(origin)).not.toContain('owner@example.com');
  });
});

describe('Host allow-list with the ts.net name (D-119, D-123)', () => {
  afterEach(() => {
    setTailscaleServeHost(null);
    resetHostAllowlistCache();
  });

  it('accepts the name only while access is on, and never bypasses the check for loopback', () => {
    const source = { security: { posture: { bindHost: '127.0.0.1' }, tls: null } };
    const off = parseTrustProxy(undefined);
    resetHostAllowlistCache();
    expect(hostCheck(req({ host: NAME }), serverHostAllowlist(source), off).ok).toBe(false);
    setTailscaleServeHost(NAME);
    resetHostAllowlistCache();
    const allowlist = serverHostAllowlist(source);
    expect(hostCheck(req({ host: NAME }), allowlist, off).ok).toBe(true);
    expect(hostCheck(req({ host: 'evil.example', 'x-forwarded-host': NAME }), allowlist, off).ok).toBe(false);
    // A loopback-only server does not accept other names under the same label.
    expect(hostCheck(req({ host: 'studio.other.ts.net' }), buildHostAllowlist({ bindHost: '127.0.0.1', hostname: 'other-host' }), off).ok).toBe(false);
  });
});

describe('endpoint order with Tailscale on', () => {
  const interfaces = { en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00', cidr: null }] } as never;

  it('lists the ts.net origin first for browsers and the native app', () => {
    const browser = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      networkInterfaces: interfaces,
      lanScheme: 'https',
      tailscaleOrigin: `https://${NAME}`,
    });
    expect(browser[0]).toMatchObject({ origin: `https://${NAME}`, reachability: 'private-network', secure: true, source: 'tailscale' });
    expect(browser.map((e) => e.origin)).toEqual([`https://${NAME}`, 'https://192.168.1.20:3100', 'http://127.0.0.1:3100']);
    expect(selectPairingEndpoint(browser, 'web')?.origin).toBe(`https://${NAME}`);

    const native = serverEndpoints({ port: 3100, bindHost: '127.0.0.1', tls: null, audience: 'native', tailscaleOrigin: `https://${NAME}`, configuredOrigins: [] });
    expect(native.map((e) => e.origin)).toEqual([`https://${NAME}`, 'http://127.0.0.1:3100']);
    expect(selectPairingEndpoint(native, 'mobile')?.origin).toBe(`https://${NAME}`);
  });

  it('a loopback-only server without Tailscale still has nothing for a phone', () => {
    const native = serverEndpoints({ port: 3100, bindHost: '127.0.0.1', tls: null, audience: 'native', tailscaleOrigin: null, configuredOrigins: [] });
    expect(selectPairingEndpoint(native, 'mobile')).toBeNull();
  });
});
