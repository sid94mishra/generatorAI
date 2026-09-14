// ────────────────────────────────────────────────────────────────
// /api/editor/* — "Open in editor" (doc §7)
//
// `POST /open` launches a desktop process on the server host with a
// caller-supplied path, so the containment check is the point of this file.
// Every rejection asserts that the launcher was NOT called: a 403 that still
// spawned the editor would be a pass that means nothing.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import path from 'node:path';
import request from 'supertest';

import { createEditorRoutes } from '../routes/editor.js';

const listEditors = vi.fn();
const open = vi.fn();
const listWorkspaces = vi.fn();
const listProjects = vi.fn();
const getByProjectId = vi.fn();
const listWorktrees = vi.fn();

/** Absolute in a way that is valid on every platform this ships to. */
const ROOT = path.resolve(path.sep, 'srv', 'repo');
const OUTSIDE = path.resolve(path.sep, 'etc', 'shadow');
/** The prefix trap: a sibling whose string starts with ROOT. */
const SIBLING = `${ROOT}-evil`;
const CODEBASE = path.resolve(path.sep, 'srv', 'codebases', 'web');
const WORKTREE = path.resolve(path.sep, 'srv', 'worktrees', 'wt1');

function makeApp() {
  const container = {
    editorLauncherService: { listEditors, open },
    workspaceManager: { listWorkspaces },
    projectService: { listProjects },
    codebaseService: { getByProjectId },
    worktreeService: { listWorktrees },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/editor', createEditorRoutes(container as never));
  return app;
}

beforeEach(() => {
  for (const fn of [listEditors, open, listWorkspaces, listProjects, getByProjectId, listWorktrees]) {
    fn.mockReset();
  }
  listEditors.mockResolvedValue([
    { id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' },
    { id: 'cursor', name: 'Cursor', available: false, scheme: 'cursor' },
  ]);
  open.mockResolvedValue({ ok: true, editor: 'vscode' });
  listWorkspaces.mockResolvedValue([
    { id: 'ws1', rootPath: ROOT, workingDirectory: ROOT, mounts: [{ alias: '.', path: ROOT }], worktrees: [] },
  ]);
  listProjects.mockResolvedValue([{ id: 'p1' }]);
  getByProjectId.mockResolvedValue([{ id: 'cb1', alias: 'web', clonePath: CODEBASE }]);
  listWorktrees.mockResolvedValue([{ id: 'wt1', worktreePath: WORKTREE }]);
});

describe('GET /api/editor/editors', () => {
  it('passes the launcher list straight through', async () => {
    const res = await request(makeApp()).get('/api/editor/editors');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({ id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' });
  });
});

describe('POST /api/editor/open — path containment', () => {
  it('opens a file inside a workspace mount', async () => {
    const target = path.join(ROOT, 'src', 'index.ts');
    const res = await request(makeApp()).post('/api/editor/open').send({ path: target, line: 12 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, editor: 'vscode' });
    expect(open).toHaveBeenCalledWith({ path: target, line: 12 });
  });

  it('opens a file inside a project codebase', async () => {
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(CODEBASE, 'README.md') });
    expect(res.status).toBe(200);
    expect(open).toHaveBeenCalled();
  });

  it('opens a file inside a worktree', async () => {
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(WORKTREE, 'a.ts') });
    expect(res.status).toBe(200);
    expect(open).toHaveBeenCalled();
  });

  it('opens a root itself, not only files under it', async () => {
    const res = await request(makeApp()).post('/api/editor/open').send({ path: ROOT });
    expect(res.status).toBe(200);
    expect(open).toHaveBeenCalled();
  });

  it('refuses a path outside every known root and launches nothing', async () => {
    const res = await request(makeApp()).post('/api/editor/open').send({ path: OUTSIDE });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses the `/repo-evil` sibling of the root `/repo`', async () => {
    // The trap a bare `startsWith` on the raw strings falls into: `/srv/repo-evil`
    // does begin with `/srv/repo`, but it is a different directory.
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(SIBLING, 'payload.ts') });

    expect(res.status).toBe(403);
    expect(open).not.toHaveBeenCalled();

    // …and the sibling directory itself, not just files under it.
    const bare = await request(makeApp()).post('/api/editor/open').send({ path: SIBLING });
    expect(bare.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a traversal that climbs back out of a root', async () => {
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(ROOT, '..', '..', 'etc', 'shadow') });
    expect(res.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses everything when no roots could be listed', async () => {
    listWorkspaces.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    listWorktrees.mockResolvedValue([]);
    const res = await request(makeApp()).post('/api/editor/open').send({ path: path.join(ROOT, 'a.ts') });
    expect(res.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it('still refuses when a root source throws rather than opening up', async () => {
    listWorkspaces.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).post('/api/editor/open').send({ path: path.join(ROOT, 'a.ts') });
    expect(res.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('POST /api/editor/open — validation', () => {
  it.each([
    ['a missing path', {}],
    ['a blank path', { path: '   ' }],
    ['a non-string path', { path: 42 }],
  ])('refuses %s with 400', async (_label, body) => {
    const res = await request(makeApp()).post('/api/editor/open').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero line', { line: 0 }],
    ['a negative line', { line: -3 }],
    ['a fractional line', { line: 1.5 }],
    ['a string line', { line: '12' }],
    ['a zero column', { column: 0 }],
  ])('refuses %s with 400', async (_label, extra) => {
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(ROOT, 'a.ts'), ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('POST /api/editor/open — launch outcome', () => {
  it('answers 200 even when the launch failed, because fallbackUrl is the next move', async () => {
    open.mockResolvedValue({ ok: false, fallbackUrl: 'vscode://file//srv/repo/a.ts', error: 'no CLI' });
    const res = await request(makeApp())
      .post('/api/editor/open')
      .send({ path: path.join(ROOT, 'a.ts') });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.fallbackUrl).toContain('vscode://');
  });
});
