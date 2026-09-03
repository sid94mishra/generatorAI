import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemCommands } from '../system.js';
import type { CliContext } from '../../context/CliContext.js';

const version = systemCommands('1.2.3').find((c) => c.id === 'system.version')!;
const doctor = systemCommands('1.2.3').find((c) => c.id === 'system.doctor')!;

function fakeContext(overrides: Partial<CliContext> = {}): CliContext {
  return {
    connection: { label: 'test-server' },
    baseUrl: 'http://127.0.0.1:3100',
    capabilities: {},
    config: { sources: {}, server: {} },
    api: { health: vi.fn(async () => ({ ok: true })) },
    ...overrides,
  } as unknown as CliContext;
}

function stubServerInfo(body: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe('system version', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the server as compatible when its protocol version is within range — its own summary promises "whether they are compatible"', async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 2 });

    const result = await version.handler(fakeContext(), {} as never);

    expect(result.data['server']).toBe('workstation');
    expect(result.data['protocolVersion']).toBe(2);
    expect(result.data['compatible']).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
  });

  it('warns (does not fail the command) when the server is ahead of this CLI build', async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 99 });

    const result = await version.handler(fakeContext(), {} as never);

    expect(result.data['compatible']).toBe(true); // "ahead" is not incompatible
    expect(result.warnings).toEqual([expect.stringContaining('ahead')]);
  });

  it('warns and reports incompatible when the server is older than this CLI build requires', async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 1 });

    const result = await version.handler(fakeContext(), {} as never);

    expect(result.data['compatible']).toBe(false);
    expect(result.warnings).toEqual([expect.stringContaining('Upgrade the server')]);
  });

  it("used to always print 'unknown' — the fields it read (probe.version) never existed on the real response — now reads the server's real serverName field", async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 2 });
    const result = await version.handler(fakeContext(), {} as never);
    expect(result.data['server']).not.toBe('unknown');
  });
});

describe('system doctor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds a server.protocol check reflecting compatibility, ok:false only when the server is too old', async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 1 });

    const result = await doctor.handler(fakeContext(), {} as never);

    const checks = result.data as Array<{ check: string; result: string; ok: boolean }>;
    const protocolCheck = checks.find((c) => c.check === 'server.protocol');
    expect(protocolCheck?.ok).toBe(false);
    expect(protocolCheck?.result).toContain('too old');
  });

  it('marks server.protocol ok:true (not a failure) when the server is merely ahead', async () => {
    stubServerInfo({ serverName: 'workstation', protocolVersion: 99 });

    const result = await doctor.handler(fakeContext(), {} as never);

    const checks = result.data as Array<{ check: string; result: string; ok: boolean }>;
    const protocolCheck = checks.find((c) => c.check === 'server.protocol');
    expect(protocolCheck?.ok).toBe(true);
    expect(protocolCheck?.result).toContain('ahead');
  });
});
