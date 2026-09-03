import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectEndpoint } from '../createCliClient.js';
import { ConnectionManager } from '../../connection/ConnectionManager.js';
import type { ResolvedCliConfig } from '../../config/schema.js';
import { DEFAULT_CONFIG } from '../../config/schema.js';

/**
 * `selectEndpoint` is the one place the version-range negotiation
 * (audit §12 Phase 2 item 3) actually runs — the rest of `createCliClient`
 * needs a live DPoP runtime to exercise meaningfully; this branch does not.
 */
describe('selectEndpoint — protocol version negotiation', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'generatorai-cli-test-'));
    process.env['GENERATORAI_CONFIG_DIR'] = configDir;
  });

  afterEach(() => {
    delete process.env['GENERATORAI_CONFIG_DIR'];
    rmSync(configDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  function config(): ResolvedCliConfig {
    return { ...DEFAULT_CONFIG, sources: { user: null, project: null, env: [], flags: [] } };
  }

  function seedConnection(): void {
    const manager = new ConnectionManager();
    manager.upsert({
      serverId: 'srv_1',
      label: 'test-server',
      endpoint: 'http://127.0.0.1:3100',
      endpoints: ['http://127.0.0.1:3100'],
      kind: 'local',
      managed: false,
      lastConnectedAt: Date.now(),
    });
    manager.setActive('srv_1');
  }

  function stubProbeResponse(body: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ serverId: 'srv_1', ...body }), { status: 200 }),
      ),
    );
  }

  it('succeeds silently with no warning when the server is within the supported range', async () => {
    seedConnection();
    stubProbeResponse({ protocolVersion: 2 });

    const result = await selectEndpoint({ config: config() });

    expect(result.protocolWarning).toBeNull();
  });

  it('throws VERSION_MISMATCH when the server is older than this CLI build requires', async () => {
    seedConnection();
    stubProbeResponse({ protocolVersion: 1 });

    await expect(selectEndpoint({ config: config() })).rejects.toMatchObject({
      code: 'VERSION_MISMATCH',
    });
  });

  it('does NOT throw, but returns a protocolWarning, when the server is ahead of this CLI build', async () => {
    seedConnection();
    stubProbeResponse({ protocolVersion: 99 });

    const result = await selectEndpoint({ config: config() });

    expect(result.protocolWarning).toEqual(expect.stringContaining('ahead'));
  });

  it('treats a server with no advertised protocol version as compatible (an old server predating this field)', async () => {
    seedConnection();
    stubProbeResponse({}); // no protocolVersion field at all

    const result = await selectEndpoint({ config: config() });

    expect(result.protocolWarning).toBeNull();
  });

  it('skips the probe (and therefore the version check) entirely when --server overrides the connection', async () => {
    // No connection seeded, no fetch stub — a version check here would
    // throw "fetch is not defined" or similar if this path were wrong.
    const result = await selectEndpoint({ config: config(), serverUrl: 'http://127.0.0.1:9999' });

    expect(result).toEqual({ baseUrl: 'http://127.0.0.1:9999', connection: null, protocolWarning: null });
  });
});
