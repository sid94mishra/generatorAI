// The replay index is the one place a Computer Use capture can reach the user's
// browser, so it carries a privacy rule worth pinning down.
//
// The recorder grabs the WHOLE PHYSICAL DISPLAY whenever an action has no target
// process to scope to — an abandoned turn, or a `launch_app` for an app that is
// not running yet. Measured at 1920x1200 against 1918x1138 for genuine window
// captures, and observed containing an unrelated chat app's private messages and
// a lock screen. The driver labels these itself in `evidence.json`, which is
// what both routes key off.

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

const SCOPED = { before: { state: { status: 'captured' } }, after: { state: { status: 'captured' } } };
const UNSCOPED = {
  before: { state: { status: 'not_applicable', classification: 'no_target_pid' } },
  after: { state: { status: 'not_applicable', classification: 'no_target_pid' } },
};

/**
 * A run with one window-scoped turn, one `launch_app` turn the driver could not
 * scope, and one abandoned turn that never recorded an action at all.
 */
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
  await fs.writeFile(path.join(acted, 'evidence.json'), JSON.stringify(SCOPED));

  const launched = path.join(run, 'turn-00002');
  await fs.mkdir(launched, { recursive: true });
  await fs.writeFile(path.join(launched, 'before.png'), PNG);
  await fs.writeFile(path.join(launched, 'action.json'), JSON.stringify({ tool: 'launch_app' }));
  await fs.writeFile(path.join(launched, 'evidence.json'), JSON.stringify(UNSCOPED));

  const abandoned = path.join(run, 'turn-00003');
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

    expect(res.body.turns.map((t: { turn: string }) => t.turn)).not.toContain('turn-00003');
  });

  it('omits a launch_app turn the driver could not scope to a window', async () => {
    // This one DOES have an action.json, so only the evidence classification
    // distinguishes it. It is the frame that showed a lock screen in the panel.
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns');

    expect(res.body.turns.map((t: { turn: string }) => t.turn)).not.toContain('turn-00002');
    expect(res.body.turns).toHaveLength(1);
  });

  it('refuses an unscoped launch_app frame, even though the PNG exists', async () => {
    const workingDir = await makeRun();
    const onDisk = path.join(workingDir, 'computer', 'recordings', 'run-1', 'turn-00002', 'before.png');
    await expect(fs.access(onDisk)).resolves.toBeUndefined();

    const res = await request(makeApp(workingDir)).get(
      '/api/workspaces/ws/computer/recording/turns/turn-00002/before',
    );

    expect(res.status).toBe(404);
  });

  it('serves a frame from an acted turn', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns/turn-00001/after');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('refuses a frame from a turn with no action, even though the PNG exists', async () => {
    const workingDir = await makeRun();
    const onDisk = path.join(workingDir, 'computer', 'recordings', 'run-1', 'turn-00003', 'before.png');
    await expect(fs.access(onDisk)).resolves.toBeUndefined();

    const res = await request(makeApp(workingDir)).get(
      '/api/workspaces/ws/computer/recording/turns/turn-00003/before',
    );

    expect(res.status).toBe(404);
  });

  it('rejects a turn name that tries to walk out of the run directory', async () => {
    const app = makeApp(await makeRun());
    const res = await request(app).get('/api/workspaces/ws/computer/recording/turns/..%2F..%2Fetc/before');

    expect(res.status).toBe(400);
  });

  it('ignores an empty run folder that a restart left in front of a real one', async () => {
    // Re-arming a preview mints a fresh folder, so the newest run is routinely
    // empty. Measured: a 0-turn folder shadowed 20 turns and a 406 MB video,
    // and the panel reported that nothing had been recorded.
    const workingDir = await makeRun();
    const root = path.join(workingDir, 'computer', 'recordings');
    const empty = path.join(root, 'run-2');
    await fs.mkdir(empty, { recursive: true });
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(empty, later, later);

    const res = await request(makeApp(workingDir)).get('/api/workspaces/ws/computer/recording/turns');

    expect(res.body.turns).toHaveLength(1);
    expect(res.body.turns[0].turn).toBe('turn-00001');
  });

  it('still reports the newest run when every run is empty', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-'));
    await fs.mkdir(path.join(workingDir, 'computer', 'recordings', 'run-1'), { recursive: true });

    const res = await request(makeApp(workingDir)).get('/api/workspaces/ws/computer/recording/turns');

    expect(res.status).toBe(200);
    expect(res.body.turns).toEqual([]);
  });
});
