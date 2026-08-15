// The replay index is the one place a Computer Use capture can reach the user's
// browser, so it carries a privacy rule worth pinning down.
//
// The recorder creates a turn folder and takes a `before` frame before the
// target window has been resolved. If the run ends there, the frame it leaves
// behind is a grab of the whole physical display — measured at 1920x1200 against
// 1918x1138 for genuine window captures, and observed containing an unrelated
// chat app's private messages. Such a turn has no `action.json` because no agent
// action ran in it, and that absence is what both routes key off.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createComputerRoutes } from '../routes/computer.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A run directory with one acted turn and one abandoned, targetless turn. */
async function makeRun(): Promise<string> {
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-'));
  const run = path.join(workingDir, 'computer', 'recordings', 'run-1');

  const acted = path.join(run, 'turn-00001');
  await fs.mkdir(acted, { recursive: true });
  await fs.writeFile(path.join(acted, 'before.png'), PNG);
  await fs.writeFile(path.join(acted, 'after.png'), PNG);
  await fs.writeFile(
    path.join(acted, 'action.json'),
    JSON.stringify({ tool: 'type_text', timestamp: '1786791885.119' }),
  );

  const abandoned = path.join(run, 'turn-00002');
  await fs.mkdir(abandoned, { recursive: true });
  await fs.writeFile(path.join(abandoned, 'before.png'), PNG);

  return workingDir;
}

function makeApp(workingDir: string) {
  const container = {
    workspaceArtifactRepo: {},
    workspaceManager: {
      getExecutionWorkspace: vi.fn(async () => ({ id: 'ws' })),
      getWorkingDirectory: vi.fn(() => workingDir),
    },
    computerService: {},
    computerUseRepo: {},
    computerConsentStore: {},
    screenCast: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces/:id/computer', createComputerRoutes(container as never));
  return app;
}

describe('computer replay index', () => {
  it('lists a turn that recorded an action', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns');

    expect(res.status).toBe(200);
    expect(res.body.turns).toHaveLength(1);
    expect(res.body.turns[0]).toMatchObject({ turn: 'turn-00001', tool: 'type_text' });
    expect(res.body.turns[0].frames).toEqual(['before', 'after']);
  });

  it('omits a turn with no action, whose frame is a whole-display grab', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns');

    expect(res.body.turns.map((t: { turn: string }) => t.turn)).not.toContain('turn-00002');
  });

  it('serves a frame from an acted turn', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns/turn-00001/after');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('refuses a frame from a turn with no action, even though the PNG exists', async () => {
    const workingDir = await makeRun();
    const onDisk = path.join(workingDir, 'computer', 'recordings', 'run-1', 'turn-00002', 'before.png');
    await expect(fs.access(onDisk)).resolves.toBeUndefined();

    const res = await request(makeApp(workingDir)).get(
      '/api/workspaces/ws/computer/recording/turns/turn-00002/before',
    );

    expect(res.status).toBe(404);
  });

  it('rejects a turn name that tries to walk out of the run directory', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns/..%2F..%2Fetc/before');

    expect(res.status).toBe(400);
  });
});
