// ────────────────────────────────────────────────────────────────
// /computer/frames and /computer/activity — lookup shape and tenancy.
//
// Both routes used to answer a single-id question by loading every artifact row
// the workspace has ever produced. `/activity` is POLLED, so that read repeated
// once a second and grew for the life of the session. These pin the shape of
// the lookups, not just their output — the output was already correct, which is
// exactly why the cost went unnoticed.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { WorkspaceArtifactRecord } from '@generatorai/shared';
import { createComputerRoutes } from '../routes/computer.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface AuditRow {
  action: string;
  appLabel: string;
  verified: boolean;
  artifactPath?: string;
  createdAt: Date;
}

/**
 * A fresh workspace id per test.
 *
 * The activity join is memoised per workspace in module scope, so two tests
 * sharing an id would share a cache and the call-count assertions would be
 * measuring each other rather than the route.
 */
let wsCounter = 0;
function nextWs(): string {
  wsCounter += 1;
  return `ws-${wsCounter}`;
}

function artifact(id: string, workspaceId: string, file: string): WorkspaceArtifactRecord {
  return {
    id,
    workspaceId,
    artifactType: 'computer_screenshot',
    relativePath: path.join('computer', file),
    fileSize: PNG.byteLength,
    mimeType: 'image/png',
    createdAt: new Date(),
  };
}

/** One audit row pointing at a captured frame. */
function auditFor(file: string): AuditRow {
  return {
    action: 'snapshot',
    appLabel: 'Editor',
    verified: true,
    artifactPath: path.join('computer', file),
    createdAt: new Date(),
  };
}

async function makeHarness(
  build: (ws: string) => WorkspaceArtifactRecord[],
  audit: AuditRow[] = [],
) {
  const ws = nextWs();
  const rows = build(ws);
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frames-'));
  await fs.mkdir(path.join(workingDir, 'computer'), { recursive: true });
  for (const row of rows) {
    await fs.writeFile(path.join(workingDir, row.relativePath), PNG);
  }

  const findByWorkspace = vi.fn(async (workspaceId: string) =>
    rows.filter((r) => r.workspaceId === workspaceId),
  );
  const findById = vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null);

  const container = {
    workspaceArtifactRepo: { findByWorkspace, findById },
    workspaceManager: {
      getExecutionWorkspace: vi.fn(async () => ({ id: ws })),
      getWorkingDirectory: vi.fn(() => workingDir),
    },
    computerService: { isEnabled: () => true },
    computerUseRepo: { listAudit: vi.fn(async () => audit) },
    computerConsentStore: {},
    screenCast: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces/:id/computer', createComputerRoutes(container as never));
  return { app, ws, rows, audit, findByWorkspace, findById, workingDir };
}

describe('GET /computer/frames/:artifactId', () => {
  it('resolves the frame by id without loading the whole workspace', async () => {
    const h = await makeHarness((ws) => [artifact('a1', ws, 'one.png'), artifact('a2', ws, 'two.png')]);

    const res = await request(h.app).get(`/api/workspaces/${h.ws}/computer/frames/a2`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(h.findById).toHaveBeenCalledWith('a2');
    // The point of the change: a per-thumbnail route must not do a table scan.
    expect(h.findByWorkspace).not.toHaveBeenCalled();
  });

  it('404s a frame belonging to a different workspace', async () => {
    // The old `findByWorkspace(...).find(a => a.id === …)` got this for free.
    // Moving to `findById`, which is keyed by id alone, means the workspace
    // comparison has to be made explicitly or it is simply lost.
    const h = await makeHarness(() => [artifact('a1', 'someone-elses-workspace', 'one.png')]);

    const res = await request(h.app).get(`/api/workspaces/${h.ws}/computer/frames/a1`);

    expect(res.status).toBe(404);
  });

  it('404s an id that is not a screenshot artifact', async () => {
    const h = await makeHarness((ws) => [
      { ...artifact('a1', ws, 'one.png'), artifactType: 'log' as never },
    ]);

    expect((await request(h.app).get(`/api/workspaces/${h.ws}/computer/frames/a1`)).status).toBe(404);
  });
});

describe('GET /computer/activity', () => {
  it('joins audit rows to artifact ids', async () => {
    const h = await makeHarness((ws) => [artifact('a1', ws, 'one.png')], [auditFor('one.png')]);

    const res = await request(h.app).get(`/api/workspaces/${h.ws}/computer/activity`);

    expect(res.status).toBe(200);
    expect(res.body.entries[0].artifactId).toBe('a1');
  });

  it('does not re-read every artifact row on every poll', async () => {
    const h = await makeHarness((ws) => [artifact('a1', ws, 'one.png')], [auditFor('one.png')]);

    for (let i = 0; i < 5; i += 1) {
      await request(h.app).get(`/api/workspaces/${h.ws}/computer/activity`);
    }

    expect(h.findByWorkspace).toHaveBeenCalledTimes(1);
  });

  it('re-reads as soon as an audit row names a frame it has never seen', async () => {
    // Staleness is what makes a cache wrong, and a NEW capture is the only
    // thing that can add a path — so that, not the clock, is the invalidation.
    const h = await makeHarness((ws) => [artifact('a1', ws, 'one.png')], [auditFor('one.png')]);

    await request(h.app).get(`/api/workspaces/${h.ws}/computer/activity`);
    expect(h.findByWorkspace).toHaveBeenCalledTimes(1);

    h.rows.push(artifact('a2', h.ws, 'two.png'));
    h.audit.push(auditFor('two.png'));

    const res = await request(h.app).get(`/api/workspaces/${h.ws}/computer/activity`);

    expect(h.findByWorkspace).toHaveBeenCalledTimes(2);
    expect(
      res.body.entries.map((e: { artifactId: string | null }) => e.artifactId).sort(),
    ).toEqual(['a1', 'a2']);
  });

  it('does not re-read forever for a frame that was pruned away', async () => {
    // An audit row outlives its frame by design (pruning keeps the newest N).
    // A cache that rebuilt whenever a wanted path was missing would therefore
    // rebuild on every single poll for the rest of the session — the one case
    // where the fix would have been worse than the bug.
    const h = await makeHarness(() => [], [auditFor('gone.png')]);

    for (let i = 0; i < 5; i += 1) {
      await request(h.app).get(`/api/workspaces/${h.ws}/computer/activity`);
    }

    expect(h.findByWorkspace).toHaveBeenCalledTimes(1);
  });
});
