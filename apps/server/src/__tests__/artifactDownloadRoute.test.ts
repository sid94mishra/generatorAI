import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createArtifactRoutes } from '../routes/artifacts.js';

let dir: string;
let root: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'gai-artifact-test-'));
  root = path.join(dir, 'managed'); await mkdir(root);
  file = path.join(root, 'content'); await writeFile(file, new Uint8Array([0, 255, 27, 65]));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
function app(scopes: string[], ownerType = 'chat', artifactPath = file, exists = true) {
  const server = express();
  server.use((req, _res, next) => { req.principal = { scopes } as never; next(); });
  server.use('/api/artifacts', createArtifactRoutes({
    config: { artifactsDir: root },
    artifactService: { getArtifact: vi.fn(async () => exists ? { id: 'a', sessionId: 's', path: artifactPath, mimeType: 'application/octet-stream', name: 'result ✓.bin' } : null) },
    sessionRepo: { getById: vi.fn(async () => ({ ownerType })) },
  } as never));
  return server;
}
it('serves exact registered bytes with download metadata and no caching', async () => {
  const res = await request(app(['read:files', 'read:chats'])).get('/api/artifacts/a/download');
  expect(res.status).toBe(200);
  expect([...res.body]).toEqual([0, 255, 27, 65]);
  expect(res.headers['content-disposition']).toContain("filename*=UTF-8''result%20%E2%9C%93.bin");
  expect(res.headers['cache-control']).toBe('no-store');
});
it('requires the owning workflow scope even when chat reading is allowed', async () => {
  expect((await request(app(['read:files', 'read:chats'], 'stage_run')).get('/api/artifacts/a/download')).status).toBe(403);
  expect((await request(app(['read:files', 'read:workflows'], 'stage_run')).get('/api/artifacts/a/download')).status).toBe(200);
});
it('rejects both direct and symlink escapes from managed artifact storage', async () => {
  const outside = path.join(dir, 'outside'); await writeFile(outside, 'private');
  const link = path.join(root, 'link'); await symlink(outside, link);
  for (const candidate of [outside, link]) expect((await request(app(['read:chats'], 'chat', candidate)).get('/api/artifacts/a/download')).status).toBe(403);
});
it('unknown artifact ids return 404', async () => {
  expect((await request(app(['read:chats'], 'chat', file, false)).get('/api/artifacts/missing/download')).status).toBe(404);
});

it('missing files return 404 rather than an internal error', async () => {
  expect((await request(app(['read:chats'], 'chat', path.join(root, 'missing'))).get('/api/artifacts/a/download')).status).toBe(404);
});
