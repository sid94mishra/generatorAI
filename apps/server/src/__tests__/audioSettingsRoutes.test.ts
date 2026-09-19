// ────────────────────────────────────────────────────────────────
// /api/system/audio — Settings ▸ Audio.
//
// Two things about this resource are load-bearing for the UI, and both were
// broken in ways that looked like the speech engine misbehaving:
//
//   • GET and PUT must answer with the SAME shape. PUT used to return only the
//     stored preferences, so the moment any audio setting was saved the client
//     lost `engines`/`formatters` — and the engine dropdown, whose options
//     come from that list, could no longer match the value it had just saved
//     and rendered its placeholder ("Select…") as if nothing were configured.
//
//   • A write has to be APPLIED, not just recorded. The engines are built once
//     while the container is wired, so without `reloadVoiceConfig()` every
//     control on that screen was inert until the next server restart, beneath
//     a line of copy promising that no restart was needed.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSystemRoutes } from '../routes/system.js';

let dataDir: string;
const reloadVoiceConfig = vi.fn().mockResolvedValue(undefined);

function makeApp() {
  const container = {
    config: { dbPath: join(dataDir, 'generatorai.db') },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reloadVoiceConfig,
    systemArtifactService: {},
    artifactCatalog: {},
    mcpSettingsStore: {},
    mcpCredentialVault: {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api/system', createSystemRoutes(container as never));
  return app;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'audio-settings-'));
  reloadVoiceConfig.mockClear();
  delete process.env['GENERATORAI_STT_ENGINE'];
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET/PUT /api/system/audio', () => {
  it('serves the defaults plus the choices the UI renders them from', async () => {
    const res = await request(makeApp()).get('/api/system/audio').expect(200);
    expect(res.body.sttEngine).toBe('auto');
    expect(res.body.engines).toContain('nemotron');
    expect(res.body.formatters).toEqual(['rule-based', 'none']);
    expect(res.body.minEndpointMs).toBeLessThan(res.body.maxEndpointMs);
    expect(res.body.engineLockedByEnv).toBeNull();
  });

  it('answers a write with the same shape as a read', async () => {
    const app = makeApp();
    const before = await request(app).get('/api/system/audio').expect(200);
    const after = await request(app)
      .put('/api/system/audio')
      .send({ sttEngine: 'nemotron' })
      .expect(200);

    expect(Object.keys(after.body).sort()).toEqual(Object.keys(before.body).sort());
    expect(after.body.sttEngine).toBe('nemotron');
    // The saved value is still one of the offered options — which is exactly
    // what the dropdown needs in order to display it.
    expect(after.body.engines).toContain(after.body.sttEngine);
  });

  it('applies the change instead of only recording it', async () => {
    await request(makeApp())
      .put('/api/system/audio')
      .send({ endpointSilenceMs: 1200 })
      .expect(200);
    expect(reloadVoiceConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects a value outside the advertised bounds without touching the engines', async () => {
    await request(makeApp())
      .put('/api/system/audio')
      .send({ endpointSilenceMs: 999_999 })
      .expect(400);
    expect(reloadVoiceConfig).not.toHaveBeenCalled();
  });

  it('reports an operator override so the UI can disable the control', async () => {
    process.env['GENERATORAI_STT_ENGINE'] = 'whisper';
    const res = await request(makeApp()).get('/api/system/audio').expect(200);
    expect(res.body.engineLockedByEnv).toBe('whisper');
  });
});
