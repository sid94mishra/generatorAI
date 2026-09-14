// ────────────────────────────────────────────────────────────────
// /api/workspaces/:id/scm/* — readiness, the flow, conflicts (doc §3 / §4)
//
// The flow service does the git work; these pin the HTTP contract: which
// directory and alias each mount resolves to, the exact object handed to the
// service, what is refused before it is called, and the two outcomes that
// clients most easily mistake for errors — a partially-resolved merge, and a
// blocked flow — staying on the 200 path.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createWorkspaceRoutes } from '../routes/workspaces.js';

const getWorkspaceInfo = vi.fn();
const readiness = vi.fn();
const run = vi.fn();
const generate = vi.fn();
const startConflictMerge = vi.fn();
const continueAfterConflicts = vi.fn();
const abortConflicts = vi.fn();
const buildAgentConflictPrompt = vi.fn();
const sendPrompt = vi.fn();
const getById = vi.fn();

const INFO = {
  id: 'ws1',
  ownerType: 'chat',
  ownerId: 'c1',
  rootPath: '/ws/ws1',
  workingDirectory: '/ws/ws1/repo',
  mounts: [
    { alias: 'repo', path: '/ws/ws1/repo' },
    { alias: 'docs', path: '/ws/ws1/docs' },
  ],
  worktrees: [],
};

function makeApp() {
  const container = {
    workspaceManager: { getWorkspaceInfo, getExecutionWorkspace: vi.fn(async () => null), toMountRefs: vi.fn(async () => []) },
    changeSetService: {},
    changeSummaryService: {},
    workspaceTreeService: {},
    checkpointService: {},
    workspaceCheckpointService: {},
    workspaceFileReviewRepo: { list: vi.fn(async () => []) },
    sourceControlService: {},
    sourceControlFlowService: {
      run, generate, startConflictMerge, continueAfterConflicts,
      abortConflicts, buildAgentConflictPrompt,
    },
    repoReadinessService: { readiness },
    chatManagementService: { sendPrompt },
    chatEntityRepo: { getById },
    eventBus: { emit: vi.fn(), emitGlobal: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', createWorkspaceRoutes(container as never));
  return app;
}

function coded(code: string, message = code): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

beforeEach(() => {
  for (const fn of [
    getWorkspaceInfo, readiness, run, generate, startConflictMerge,
    continueAfterConflicts, abortConflicts, buildAgentConflictPrompt,
    sendPrompt, getById,
  ]) {
    fn.mockReset();
  }
  getWorkspaceInfo.mockResolvedValue(INFO);
  getById.mockResolvedValue({ id: 'c1', name: 'Fix the flaky login test' });
  readiness.mockImplementation(async (input: { repoDir: string; alias: string }) => ({
    alias: input.alias,
    repoDir: input.repoDir,
    isRepo: true,
  }));
});

describe('GET /api/workspaces/:id/scm/readiness', () => {
  it('answers one repo per mount when no alias is given', async () => {
    const res = await request(makeApp()).get('/api/workspaces/ws1/scm/readiness');

    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe('ws1');
    expect(res.body.repos).toEqual([
      { alias: 'repo', repoDir: '/ws/ws1/repo', isRepo: true },
      { alias: 'docs', repoDir: '/ws/ws1/docs', isRepo: true },
    ]);
  });

  it('does not answer for the root a second time when a mount already covers it', async () => {
    // `mounts[0]` IS the working directory here, so `.` must not appear as a
    // third, duplicate row — and the mount keeps its own alias.
    const res = await request(makeApp()).get('/api/workspaces/ws1/scm/readiness');
    expect(res.body.repos).toHaveLength(2);
    expect(res.body.repos.map((r: { alias: string }) => r.alias)).not.toContain('.');
  });

  it('falls back to the root when the workspace has no mounts', async () => {
    getWorkspaceInfo.mockResolvedValue({ ...INFO, mounts: [] });
    const res = await request(makeApp()).get('/api/workspaces/ws1/scm/readiness');
    expect(res.body.repos).toEqual([{ alias: '.', repoDir: '/ws/ws1/repo', isRepo: true }]);
  });

  it('answers a single repo when an alias is given', async () => {
    const res = await request(makeApp()).get('/api/workspaces/ws1/scm/readiness?alias=docs');
    expect(res.body.repos).toEqual([{ alias: 'docs', repoDir: '/ws/ws1/docs', isRepo: true }]);
    expect(readiness).toHaveBeenCalledTimes(1);
  });

  it('404s an unknown workspace', async () => {
    getWorkspaceInfo.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/workspaces/nope/scm/readiness');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(readiness).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspaces/:id/scm/flow', () => {
  it('hands the service the resolved repoDir, the alias, the request and the chat name', async () => {
    run.mockResolvedValue({ status: 'ok', alias: 'docs', steps: [], readiness: {} });
    const body = { alias: 'docs', commit: { generate: true }, push: true, hint: 'tidy the docs' };

    const res = await request(makeApp()).post('/api/workspaces/ws1/scm/flow').send(body);

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      repoDir: '/ws/ws1/docs',
      alias: 'docs',
      request: body,
      context: { chatName: 'Fix the flaky login test', hint: 'tidy the docs' },
    });
  });

  it('defaults the alias to the root and omits the context when there is no chat', async () => {
    getWorkspaceInfo.mockResolvedValue({ ...INFO, ownerType: 'workflow_run', ownerId: 'r1' });
    run.mockResolvedValue({ status: 'ok', alias: '.', steps: [], readiness: {} });

    await request(makeApp()).post('/api/workspaces/ws1/scm/flow').send({ push: true });

    expect(run).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      repoDir: '/ws/ws1/repo',
      alias: '.',
      request: { push: true },
    });
  });

  it('returns a blocked flow as a 200 — it is a state, not a failed request', async () => {
    run.mockResolvedValue({
      status: 'blocked',
      alias: '.',
      steps: [{ id: 'readiness', status: 'blocked', detail: 'No git remote' }],
      readiness: {},
    });
    const res = await request(makeApp()).post('/api/workspaces/ws1/scm/flow').send({ push: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('blocked');
  });

  it('404s an unknown workspace without calling the service', async () => {
    getWorkspaceInfo.mockResolvedValue(null);
    const res = await request(makeApp()).post('/api/workspaces/nope/scm/flow').send({});
    expect(res.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspaces/:id/scm/generate', () => {
  it('passes the request through', async () => {
    generate.mockResolvedValue({ kind: 'commit', message: 'Update 3 files', source: 'heuristic' });
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/generate')
      .send({ kind: 'commit', alias: 'docs' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Update 3 files');
    expect(generate).toHaveBeenCalledWith({
      repoDir: '/ws/ws1/docs',
      alias: 'docs',
      request: { kind: 'commit', alias: 'docs' },
      context: { chatName: 'Fix the flaky login test' },
    });
  });

  it.each([
    ['a missing kind', {}],
    ['an unknown kind', { kind: 'tag' }],
    ['a non-string kind', { kind: 7 }],
  ])('refuses %s with 400', async (_label, body) => {
    const res = await request(makeApp()).post('/api/workspaces/ws1/scm/generate').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('conflict routes', () => {
  it('starts a merge and reports the conflicted files', async () => {
    startConflictMerge.mockResolvedValue({ base: 'main', head: 'work', files: ['a.ts'], mergeStarted: true });
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/start')
      .send({ alias: 'docs', base: 'main' });

    expect(res.status).toBe(200);
    expect(res.body.files).toEqual(['a.ts']);
    expect(startConflictMerge).toHaveBeenCalledWith({
      repoDir: '/ws/ws1/docs',
      alias: 'docs',
      base: 'main',
    });
  });

  it('answers 200 with ok:false when files are still conflicted', async () => {
    continueAfterConflicts.mockResolvedValue({ ok: false, remaining: ['a.ts', 'b.ts'] });
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/continue')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, remaining: ['a.ts', 'b.ts'] });
  });

  it('answers 200 with the merge sha once everything is resolved', async () => {
    continueAfterConflicts.mockResolvedValue({ ok: true, sha: 'abc123', remaining: [] });
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/continue')
      .send({ message: 'Merge main' });

    expect(res.status).toBe(200);
    expect(res.body.sha).toBe('abc123');
    expect(continueAfterConflicts).toHaveBeenCalledWith({
      repoDir: '/ws/ws1/repo',
      alias: '.',
      message: 'Merge main',
    });
  });

  it('aborts with a 204', async () => {
    abortConflicts.mockResolvedValue(undefined);
    const res = await request(makeApp()).post('/api/workspaces/ws1/scm/conflicts/abort').send({ alias: 'docs' });
    expect(res.status).toBe(204);
    expect(abortConflicts).toHaveBeenCalledWith({ repoDir: '/ws/ws1/docs', alias: 'docs' });
  });
});

describe('POST /api/workspaces/:id/scm/conflicts/resolve-with-agent', () => {
  beforeEach(() => {
    startConflictMerge.mockResolvedValue({
      base: 'main', head: 'work', files: ['a.ts', 'b.ts'], mergeStarted: true,
    });
    buildAgentConflictPrompt.mockReturnValue('RESOLVE THESE CONFLICTS');
    sendPrompt.mockResolvedValue(undefined);
  });

  it('starts the merge, sends the built prompt and reports the files', async () => {
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/resolve-with-agent')
      .send({ alias: 'docs', chatId: 'c1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chatId: 'c1', files: ['a.ts', 'b.ts'] });
    expect(startConflictMerge).toHaveBeenCalledWith({ repoDir: '/ws/ws1/docs', alias: 'docs' });
    expect(buildAgentConflictPrompt).toHaveBeenCalledWith({
      base: 'main', head: 'work', files: ['a.ts', 'b.ts'], mergeStarted: true,
    });
    expect(sendPrompt).toHaveBeenCalledWith('c1', 'RESOLVE THESE CONFLICTS');
  });

  it('requires a chatId and touches nothing without one', async () => {
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/resolve-with-agent')
      .send({ alias: 'docs' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(startConflictMerge).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('maps the chat service coded errors the way the chat routes do', async () => {
    sendPrompt.mockRejectedValueOnce(coded('CHAT_BUSY', 'still generating'));
    const busy = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/resolve-with-agent')
      .send({ chatId: 'c1' });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toEqual({ code: 'CHAT_BUSY', message: 'still generating' });

    sendPrompt.mockRejectedValueOnce(coded('NOT_FOUND', 'no such chat'));
    const missing = await request(makeApp())
      .post('/api/workspaces/ws1/scm/conflicts/resolve-with-agent')
      .send({ chatId: 'gone' });
    expect(missing.status).toBe(404);
  });
});

describe('the legacy commit / pull-request routes still work', () => {
  it('POST /commit answers { committed } off the flow result', async () => {
    run.mockResolvedValue({
      status: 'ok', alias: '.', steps: [], readiness: {},
      commit: { sha: 'abc', message: 'Update 3 files' },
    });
    const res = await request(makeApp()).post('/api/workspaces/ws1/commit').send({ message: 'Update 3 files' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ committed: true });
    expect(run.mock.calls[0]![0]).toMatchObject({
      request: { commit: { message: 'Update 3 files' }, sync: false },
    });
  });

  it('POST /commit reports committed:false when the tree was clean', async () => {
    run.mockResolvedValue({ status: 'ok', alias: '.', steps: [], readiness: {} });
    const res = await request(makeApp()).post('/api/workspaces/ws1/commit').send({});
    expect(res.body).toEqual({ committed: false });
  });

  it('POST /pull-request answers the bare pull request as before', async () => {
    run.mockResolvedValue({
      status: 'ok', alias: '.', steps: [], readiness: {},
      pullRequest: { provider: 'github', number: 7, url: 'https://x/7', title: 'T', state: 'open', head: 'work', base: 'main' },
    });
    const res = await request(makeApp())
      .post('/api/workspaces/ws1/pull-request')
      .send({ title: 'T', body: 'B', base: 'main' });

    expect(res.status).toBe(200);
    expect(res.body.number).toBe(7);
    expect(run.mock.calls[0]![0]).toMatchObject({
      request: { push: true, pullRequest: { title: 'T', body: 'B', base: 'main', draft: false } },
    });
  });

  it('POST /pull-request still requires a title', async () => {
    const res = await request(makeApp()).post('/api/workspaces/ws1/pull-request').send({ body: 'B' });
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('POST /pull-request explains why there is no PR rather than 500-ing', async () => {
    run.mockResolvedValue({
      status: 'blocked',
      alias: '.',
      steps: [{ id: 'readiness', status: 'blocked', detail: 'No git remote' }],
      readiness: {},
    });
    const res = await request(makeApp()).post('/api/workspaces/ws1/pull-request').send({ title: 'T' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('No git remote');
  });
});
