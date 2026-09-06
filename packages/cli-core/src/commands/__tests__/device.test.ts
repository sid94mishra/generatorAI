import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deviceCommands } from '../device.js';
import type { CliContext } from '../../context/CliContext.js';

interface FakeApi {
  devices: { createInvite: ReturnType<typeof vi.fn> };
}

function fakeContext(overrides: { baseUrl?: string; api?: FakeApi } = {}): CliContext {
  return {
    baseUrl: 'http://127.0.0.1:3100',
    api: { devices: { createInvite: vi.fn(async () => ({ pairingCode: 'FROM-API' })) } },
    ...overrides,
  } as unknown as CliContext;
}

const invite = deviceCommands().find((c) => c.id === 'device.invite')!;

async function runInvite(ctx: CliContext, dataDir: string) {
  return invite.handler(ctx, { args: {}, flags: { dataDir, ttl: 10 } } as never);
}

describe('device invite', () => {
  const dirs: string[] = [];
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'generatorai-device-invite-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('prefers the server-minted unclaimed-install grant when present, with no network call', async () => {
    const dir = tempDir();
    const expiresAt = Date.now() + 60_000;
    writeFileSync(
      join(dir, 'bootstrap-pairing.json'),
      JSON.stringify({ pairingCode: 'BOOTSTRAP-CODE', pairingUrl: 'generatorai://pair?code=BOOTSTRAP-CODE', expiresAt }),
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ctx = fakeContext();
    const result = await runInvite(ctx, dir);

    expect((result.data as { pairingCode: string }).pairingCode).toBe('BOOTSTRAP-CODE');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((ctx.api as unknown as FakeApi).devices.createInvite).not.toHaveBeenCalled();
  });

  it('falls back to the loopback-verified recovery channel when only local-admin.json exists', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'local-admin.json'), JSON.stringify({ token: 'the-local-admin-token', pid: 1, startedAt: Date.now() }));
    try {
      chmodSync(join(dir, 'local-admin.json'), 0o600);
    } catch {
      // best effort; permissions are irrelevant to this test's assertions
    }

    const fetchSpy = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            pairingCode: 'RECOVERY-CODE',
            pairingUrl: 'generatorai://pair?code=RECOVERY-CODE',
            shortCode: '1234-5678',
            expiresAt: Date.now() + 60_000,
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const ctx = fakeContext({ baseUrl: 'http://127.0.0.1:3100' });
    const result = await runInvite(ctx, dir);

    expect((result.data as { pairingCode: string }).pairingCode).toBe('RECOVERY-CODE');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3100/internal/desktop/pairing');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer the-local-admin-token');
    // The raw token must never appear in the command's own output.
    expect(JSON.stringify(result)).not.toContain('the-local-admin-token');
    // Neither --scopes nor a non-default --ttl was passed — unlike the
    // bootstrap-file branch, this one used to warn about ignored flags
    // unconditionally, even when none were actually set.
    expect(result.warnings?.some((w) => w.includes('are ignored'))).toBe(false);
  });

  it('warns about ignored --scopes/--ttl on the recovery-token path only when they were actually passed', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'local-admin.json'), JSON.stringify({ token: 'tok', pid: 1, startedAt: Date.now() }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ pairingCode: 'X', pairingUrl: 'generatorai://pair?code=X', shortCode: '1-2', expiresAt: Date.now() + 60_000 }),
            { status: 201 },
          ),
      ),
    );

    const ctx = fakeContext({ baseUrl: 'http://127.0.0.1:3100' });
    const result = await invite.handler(ctx, { args: {}, flags: { dataDir: dir, ttl: 20 } } as never);

    expect(result.warnings?.some((w) => w.includes('are ignored'))).toBe(true);
  });

  it('refuses to send the local admin token to a configured non-loopback baseUrl', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'local-admin.json'), JSON.stringify({ token: 'the-local-admin-token', pid: 1, startedAt: Date.now() }));

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ctx = fakeContext({ baseUrl: 'https://attacker.example' });
    await expect(runInvite(ctx, dir)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the authenticated API when neither bootstrap file exists', async () => {
    const dir = tempDir(); // empty — neither file present
    const ctx = fakeContext();
    const result = await runInvite(ctx, dir);
    expect((result.data as { pairingCode: string }).pairingCode).toBe('FROM-API');
    expect((ctx.api as unknown as FakeApi).devices.createInvite).toHaveBeenCalledTimes(1);
  });

  // `POST /api/auth/pair` requires `deviceName` (min 1, max 64) and rejects a
  // `ttlMs` over ten minutes. The command sent neither correctly, so its
  // authenticated path failed every single time with "deviceName: Required"
  // while the two bootstrap paths — which never call the API — masked it.
  it('sends deviceName and platform on the authenticated path', async () => {
    const dir = tempDir(); // empty: no bootstrap grant, no local-admin token
    const ctx = fakeContext();

    await invite.handler(ctx, { args: {}, flags: { dataDir: dir, ttl: 10 } } as never);

    const body = (ctx.api as unknown as FakeApi).devices.createInvite.mock.calls[0][0];
    expect(body.deviceName).toBeTruthy();
    expect(String(body.deviceName).length).toBeGreaterThan(0);
    expect(body.platform).toBe('other');
    expect(body.ttlMs).toBe(600_000);
  });

  it('uses the given --name and --platform', async () => {
    const dir = tempDir();
    const ctx = fakeContext();

    await invite.handler(ctx, {
      args: {},
      flags: { dataDir: dir, ttl: 5, name: 'Ops laptop', platform: 'desktop' },
    } as never);

    const body = (ctx.api as unknown as FakeApi).devices.createInvite.mock.calls[0][0];
    expect(body.deviceName).toBe('Ops laptop');
    expect(body.platform).toBe('desktop');
    expect(body.ttlMs).toBe(300_000);
  });

});
