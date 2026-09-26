// ────────────────────────────────────────────────────────────────
// G-12 — GET /api/system/info: Home "System" card + Settings › Diagnostics.
//
// Real temp SQLite database file on disk (not mocked): the route reads its
// actual byte size (plus -wal/-shm) and the containing directory's real disk
// usage via `fs.promises.statfs`. Only `chatManagementService` (an
// in-process registry with no table behind it) is a stand-in.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, type AppDatabase } from '@generatorai/db';
import type { SystemInfo } from '@generatorai/shared';

import { createSystemRoutes } from '../routes/system.js';

let dir: string;
let dbPath: string;
let db: AppDatabase;
let streamingChatIds: string[];

function makeApp() {
  const container = {
    config: { dbPath, maxConcurrentSessions: 8 },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    chatManagementService: { getStreamingChatIds: () => streamingChatIds },
    reloadVoiceConfig: vi.fn().mockResolvedValue(undefined),
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
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g12-test-'));
  dbPath = join(dir, 'generatorai.db');
  db = createDB(dbPath);
  migrateDB(db);
  streamingChatIds = [];
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the handle a moment longer */
  }
});

describe('GET /api/system/info', () => {
  it('reports server, agent capacity, real database size and disk usage', async () => {
    const res = await request(makeApp()).get('/api/system/info');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as SystemInfo;

    expect(typeof body.serverName).toBe('string');
    expect(body.serverName.length).toBeGreaterThan(0);
    expect(typeof body.serverVersion).toBe('string');
    expect(body.platform).toBe(process.platform);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);

    expect(body.agents).toEqual({ running: 0, max: 8 });

    // The migrated file is real bytes on disk, not an invented number.
    expect(body.database.kind).toBe('sqlite');
    expect(body.database.sizeBytes).toBeGreaterThan(0);

    // `fs.promises.statfs` on the real temp directory — same call on every OS.
    if (body.disk) {
      expect(body.disk.totalBytes).toBeGreaterThan(0);
      expect(body.disk.usedBytes).toBeGreaterThanOrEqual(0);
      expect(body.disk.usedBytes).toBeLessThanOrEqual(body.disk.totalBytes);
    }
  });

  it('reflects currently streaming chats, not a run-history query', async () => {
    streamingChatIds = ['c1', 'c2'];
    const res = await request(makeApp()).get('/api/system/info');
    expect((res.body as SystemInfo).agents.running).toBe(2);
  });

  it('omits database.sizeBytes rather than inventing 0 when the db file is unreadable', async () => {
    db.$client.close?.();
    rmSync(dbPath, { force: true });
    const res = await request(makeApp()).get('/api/system/info');
    const body = res.body as SystemInfo;
    expect(body.database.kind).toBe('sqlite');
    expect(body.database.sizeBytes).toBeUndefined();
  });
});
