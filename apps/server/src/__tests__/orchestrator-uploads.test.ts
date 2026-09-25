import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestratorRoutes } from '../routes/orchestrator.js';
import type { Container } from '../composition-root.js';

describe('orchestrated run uploads', () => {
  let dir: string;
  let initialize: ((id: string) => Promise<void>) | undefined;
  const start = vi.fn(async (_config: unknown, prepare?: (id: string) => Promise<void>) => {
    initialize = prepare;
    return { workflowRunId: 'run-1' };
  });
  const app = express();
  app.use(express.json());
  app.use(createOrchestratorRoutes({
    workflowOrchestrator: { startOrchestratedRun: start, getRunUploadsDir: async () => dir },
    logger: { info: vi.fn() },
  } as unknown as Container));

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'gai-run-upload-')); start.mockClear(); initialize = undefined; });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('keeps JSON callers compatible', async () => {
    await request(app).post('/runs').send({ workflowDefinitionId: 'def-1' }).expect(201);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ workflowDefinitionId: 'def-1' }), undefined);
  });

  it('passes overrides and stages categorized files into the final workspace before discovery', async () => {
    const config = { workflowDefinitionId: 'def-1', stageOverrides: [{ stageKey: 'review', skip: true }] };
    await request(app).post('/runs').field('config', JSON.stringify(config))
      .attach('skills', Buffer.from('---\nname: risk-review\ndescription: Review risk\n---\nCheck edges.'), 'risk-review.md')
      .attach('prompts', Buffer.from('Operator instructions'), 'review.md').expect(201);
    expect(start).toHaveBeenCalledWith(expect.objectContaining(config), expect.any(Function));
    await initialize!('run-1');
    expect(await readFile(join(dir, 'skills/risk-review/SKILL.md'), 'utf8')).toContain('Check edges.');
    expect(await readFile(join(dir, 'prompts/review.md'), 'utf8')).toBe('Operator instructions');
  });

  it('rejects malformed configuration before creating a run', async () => {
    await request(app).post('/runs').field('config', '{broken').attach('skills', Buffer.from('x'), 'safe.md').expect(400);
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects disallowed uploads before creating a run', async () => {
    await request(app).post('/runs').field('config', '{"workflowDefinitionId":"d"}')
      .attach('skills', Buffer.from('x'), 'unsafe.exe').expect(400);
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a symlinked destination outside the upload directory', async () => {
    await request(app).post('/runs').field('config', '{"workflowDefinitionId":"d"}')
      .attach('skills', Buffer.from('x'), 'safe.md').expect(201);
    await symlink(tmpdir(), join(dir, 'skills'));
    await expect(initialize!('run-1')).rejects.toThrow('Invalid upload destination');
  });
});
