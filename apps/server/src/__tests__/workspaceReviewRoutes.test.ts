// ────────────────────────────────────────────────────────────────
// Changes-tab review routes — Keep / Undo, and `kept` on the summary.
// ────────────────────────────────────────────────────────────────
//
// The change engine and the checkpoint engine have their own integration
// tests against real git repositories; what is unproven there — and is
// entirely this layer's responsibility — is the orchestration:
//
//   • `kept` is derived from CONTENT (accepted blob vs current head blob),
//     so an edit un-keeps a file without anything invalidating a flag
//   • rows that can never match again are swept on read, but only from the
//     one view that can see the whole change set
//   • a discard restores each mount from ITS OWN base, including the mounts
//     whose base is a bare commit rather than a checkpoint row
//
// A real `DrizzleWorkspaceFileReviewRepository` over an in-memory database
// is used (the rows are the thing under test); the git-facing services are
// stubbed, since a fixture summary states the situation far more precisely
// than building four flavours of repository on disk would.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { ILogger } from '@generatorai/shared';
import type { ChangeSummary, ChangeSummaryFile } from '@generatorai/changes';
import { createDB, migrateDB, DrizzleWorkspaceFileReviewRepository } from '@generatorai/db';
import { createWorkspaceRoutes } from '../routes/workspaces.js';
import type { Container } from '../composition-root.js';

const logger: ILogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child: () => logger,
} as unknown as ILogger;

const WS = 'ws_1';

function file(partial: Partial<ChangeSummaryFile> & { path: string }): ChangeSummaryFile {
  return {
    status: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    isTooLarge: false,
    lang: 'text',
    ...partial,
  };
}

/**
 * Two mounts, deliberately with DIFFERENT kinds of base:
 *   `.`   — a checkpoint baseline (has an id)
 *   `api` — a bare commit ("Worktree HEAD", no id), the case that had no
 *           discard action at all before per-repo bases existed.
 */
function summaryFixture(): ChangeSummary {
  return {
    workspaceId: WS,
    hasGit: true,
    base: { kind: 'baseline', id: 'cp_root', treeish: 'tree_root', label: 'Session start' },
    head: { kind: 'working', treeish: 'tree_work' },
    stats: { files: 3, additions: 3, deletions: 0 },
    repos: [
      {
        alias: '.',
        kind: 'mount',
        hasBaseline: true,
        base: { kind: 'baseline', id: 'cp_root', treeish: 'tree_root', label: 'Session start' },
        head: { kind: 'working', treeish: 'tree_work' },
        stats: { files: 2, additions: 2, deletions: 0 },
        files: [
          file({ path: 'a.txt', newBlob: 'a'.repeat(40), oldBlob: 'f'.repeat(40) }),
          file({ path: 'gone.txt', status: 'deleted', oldBlob: 'e'.repeat(40) }),
        ],
      },
      {
        alias: 'api',
        kind: 'mount',
        hasBaseline: false,
        base: { kind: 'baseline', treeish: 'commit_api', label: 'Worktree HEAD', normalized: true },
        head: { kind: 'working', treeish: 'tree_work_api' },
        stats: { files: 1, additions: 1, deletions: 0 },
        files: [file({ path: 'src/b.ts', newBlob: 'b'.repeat(40) })],
      },
    ],
  };
}

describe('workspace changes review routes', () => {
  let app: Express;
  let reviewRepo: DrizzleWorkspaceFileReviewRepository;
  let summary: ChangeSummary;
  let restore: ReturnType<typeof vi.fn>;
  let restoreFromRevision: ReturnType<typeof vi.fn>;
  let invalidateWorkingTree: ReturnType<typeof vi.fn>;
  let emitGlobal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const db = createDB(':memory:');
    migrateDB(db);
    reviewRepo = new DrizzleWorkspaceFileReviewRepository(db);
    summary = summaryFixture();

    restore = vi.fn(async (_cp: unknown, _dir: string, paths?: string[]) => ({
      preRestoreCheckpointId: 'cp_pre',
      restoredPaths: paths ?? [],
      deletedPaths: [],
      skipped: [{ path: 'link.txt', reason: 'symlink' }],
    }));
    restoreFromRevision = vi.fn(
      async (
        _ws: string,
        _alias: string,
        _dir: string,
        _treeish: string,
        paths?: string[],
      ) => ({
        preRestoreCheckpointId: 'cp_pre_api',
        restoredPaths: paths ?? [],
        deletedPaths: [],
        skipped: [],
      }),
    );
    invalidateWorkingTree = vi.fn();
    emitGlobal = vi.fn(async () => undefined);

    const container = {
      workspaceManager: {
        getExecutionWorkspace: async () => ({ id: WS, rootPath: '/ws', codeRoot: '/ws' }),
        getWorkspaceInfo: async () => ({ rootPath: '/ws', worktrees: [] }),
        toMountRefs: async () => [],
      },
      changeSetService: {},
      changeSummaryService: {
        getSummary: async () => structuredClone(summary),
        invalidateWorkingTree,
      },
      workspaceTreeService: {},
      checkpointService: {
        getById: async (id: string) =>
          id === 'cp_root' ? { id: 'cp_root', workspaceId: WS, repoAlias: '.', treeSha: 'tree_root' } : null,
        restore,
        restoreFromRevision,
        list: async () => [],
      },
      workspaceCheckpointService: {
        resolveRepoDir: async (_ws: string, alias: string) => `/ws/${alias}`,
        announceRestore: async () => undefined,
      },
      workspaceFileReviewRepo: reviewRepo,
      sourceControlService: {},
      eventBus: { emitGlobal },
      logger,
    } as unknown as Container;

    app = express();
    app.use(express.json());
    app.use('/api/workspaces', createWorkspaceRoutes(container));
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
    });
  });

  const changes = () => request(app).get(`/api/workspaces/${WS}/changes`);

  // ── kept ──

  it('marks a file kept only while its accepted blob matches the head blob', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keep: [{ alias: '.', path: 'a.txt', blob: 'a'.repeat(40) }] })
      .expect(200);

    const first = await changes().expect(200);
    const root = first.body.repos.find((r: { alias: string }) => r.alias === '.');
    expect(root.files.find((f: { path: string }) => f.path === 'a.txt').kept).toBe(true);
    expect(root.keptCount).toBe(1);
    expect(first.body.keptCount).toBe(1);

    // The agent edits the file: a new head blob, and the acceptance lapses
    // with nothing having to invalidate it.
    summary.repos[0]!.files[0]!.newBlob = 'c'.repeat(40);
    const second = await changes().expect(200);
    const rerun = second.body.repos.find((r: { alias: string }) => r.alias === '.');
    expect(rerun.files.find((f: { path: string }) => f.path === 'a.txt').kept).toBeUndefined();
    expect(second.body.keptCount).toBe(0);
  });

  it('keeps a deleted file at the empty blob', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keep: [{ alias: '.', path: 'gone.txt', blob: '' }] })
      .expect(200);

    const res = await changes().expect(200);
    const root = res.body.repos.find((r: { alias: string }) => r.alias === '.');
    expect(root.files.find((f: { path: string }) => f.path === 'gone.txt').kept).toBe(true);
  });

  it('sweeps rows it can no longer account for, but only from the full default view', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keepAll: true })
      .expect(200);
    expect(await reviewRepo.list(WS)).toHaveLength(3);

    // A file is no longer changed at all (discarded, or edited back).
    summary.repos[0]!.files = [summary.repos[0]!.files[0]!];

    // A narrowed view must not sweep: it cannot see the other mounts.
    await request(app).get(`/api/workspaces/${WS}/changes?alias=api`).expect(200);
    expect(await reviewRepo.list(WS)).toHaveLength(3);

    await changes().expect(200);
    // Sweeps happen off the response path, so let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 20));
    expect((await reviewRepo.list(WS)).map((r) => r.path).sort()).toEqual(['a.txt', 'src/b.ts']);
  });

  it('keepAll accepts every changed file at its current head blob', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keepAll: true })
      .expect(200);
    expect(res.body).toMatchObject({ workspaceId: WS, kept: 3, unkept: 0, keptCount: 3 });

    const rows = await reviewRepo.list(WS);
    expect(rows.find((r) => r.path === 'gone.txt')!.acceptedBlob).toBe('');
    expect(rows.find((r) => r.path === 'src/b.ts')!.alias).toBe('api');
    expect(emitGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workspace.review_changed' }),
    );
  });

  it('unkeep removes the acceptance', async () => {
    await request(app).post(`/api/workspaces/${WS}/changes/review`).send({ keepAll: true });
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ unkeep: [{ alias: 'api', path: 'src/b.ts' }] })
      .expect(200);
    expect((await reviewRepo.list(WS)).map((r) => r.path)).not.toContain('src/b.ts');
  });

  it('strips an alias prefix a client sent verbatim', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keep: [{ alias: 'api', path: 'api/src/b.ts', blob: 'b'.repeat(40) }] })
      .expect(200);
    expect((await reviewRepo.list(WS))[0]!.path).toBe('src/b.ts');
  });

  it('rejects a blob that is not an object id, and an empty request', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/review`)
      .send({ keep: [{ alias: '.', path: 'a.txt', blob: 'not-a-sha' }] })
      .expect(400);
    await request(app).post(`/api/workspaces/${WS}/changes/review`).send({}).expect(400);
  });

  // ── discard ──

  it('restores each mount from its own base — checkpoint for one, commit for the other', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${WS}/changes/discard`)
      .send({ all: true })
      .expect(200);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]![1]).toBe('/ws/.');
    expect(restore.mock.calls[0]![2]).toEqual(['a.txt', 'gone.txt']);

    // The `api` mount has no checkpoint row at all: before per-repo bases it
    // could not be discarded, and now it goes through the revision path.
    expect(restoreFromRevision).toHaveBeenCalledTimes(1);
    expect(restoreFromRevision.mock.calls[0]!.slice(1, 5)).toEqual([
      'api',
      '/ws/api',
      'commit_api',
      ['src/b.ts'],
    ]);

    expect(res.body.mounts.every((m: { ok: boolean }) => m.ok)).toBe(true);
    expect(res.body.discardedCount).toBe(3);
    // Skipped paths are reported rather than silently dropped.
    expect(res.body.skipped).toEqual([{ alias: '.', path: 'link.txt', reason: 'symlink' }]);
    expect(invalidateWorkingTree).toHaveBeenCalledTimes(2);
  });

  it('discards one named file without touching the other mount', async () => {
    await request(app)
      .post(`/api/workspaces/${WS}/changes/discard`)
      .send({ files: [{ alias: 'api', path: 'src/b.ts' }] })
      .expect(200);

    expect(restore).not.toHaveBeenCalled();
    expect(restoreFromRevision).toHaveBeenCalledTimes(1);
    expect(restoreFromRevision.mock.calls[0]![4]).toEqual(['src/b.ts']);
  });

  it('carries a renamed file\'s old path into the restore pathspec', async () => {
    summary.repos[1]!.files = [
      file({ path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', newBlob: 'd'.repeat(40) }),
    ];
    await request(app)
      .post(`/api/workspaces/${WS}/changes/discard`)
      .send({ files: [{ alias: 'api', path: 'src/new.ts' }] })
      .expect(200);
    // Both halves: the new name to remove, the old one to put back.
    expect(restoreFromRevision.mock.calls[0]![4]).toEqual(['src/new.ts', 'src/old.ts']);
  });

  it('drops the review rows of the files it discarded', async () => {
    await request(app).post(`/api/workspaces/${WS}/changes/review`).send({ keepAll: true });
    await request(app)
      .post(`/api/workspaces/${WS}/changes/discard`)
      .send({ files: [{ alias: '.', path: 'a.txt' }] })
      .expect(200);
    expect((await reviewRepo.list(WS)).map((r) => r.path).sort()).toEqual(['gone.txt', 'src/b.ts']);
  });

  it('reports a failing mount instead of failing the whole request', async () => {
    restoreFromRevision.mockRejectedValueOnce(new Error('index.lock held'));
    const res = await request(app)
      .post(`/api/workspaces/${WS}/changes/discard`)
      .send({ all: true })
      .expect(200);
    const api = res.body.mounts.find((m: { alias: string }) => m.alias === 'api');
    expect(api).toMatchObject({ ok: false, error: 'index.lock held' });
    expect(res.body.mounts.find((m: { alias: string }) => m.alias === '.').ok).toBe(true);
  });

  it('requires something to discard', async () => {
    await request(app).post(`/api/workspaces/${WS}/changes/discard`).send({}).expect(400);
  });
});
