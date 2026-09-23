// A forked chat owns its workspace but inherits its history. Rewinding it to a
// turn that ran in the PARENT used to drop the conversation and leave every
// file untouched, because the fork's workspace has no snapshot for that turn.
// `restoreTurn` now falls back to the nearest ancestor's snapshot when its
// tree is reachable from the fork's repository.

import { describe, expect, it, vi } from 'vitest';

import { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';

const record = (over: Record<string, unknown>) => ({
  id: 'cp1',
  workspaceId: 'parent',
  repoAlias: 'shopkit',
  turnId: 't1',
  phase: 'before',
  treeSha: 'tree-before-t1',
  seq: 1,
  kind: 'turn',
  label: 'Before: add coupons',
  createdAt: new Date(1_000),
  ...over,
});

function makeService(opts: { byWorkspace: Record<string, unknown[]>; objectExists: boolean }) {
  const restored = { restoredPaths: ['a.ts', 'b.ts'], deletedPaths: [], skipped: [], preRestoreCheckpointId: 'pre1' };
  const checkpoints = {
    list: vi.fn(async ({ workspaceId }: { workspaceId: string }) => opts.byWorkspace[workspaceId] ?? []),
    restore: vi.fn(async () => restored),
    restoreFromRevision: vi.fn(async () => restored),
    registerShadow: vi.fn(),
  };
  const workspaceRepo = { findById: vi.fn(async (id: string) => ({ id, rootPath: '/ws', ownerType: 'chat' })) };
  const git = { objectExists: vi.fn(async () => opts.objectExists) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new WorkspaceCheckpointService(
    checkpoints as never,
    workspaceRepo as never,
    { toMountRefs: async () => [] } as never,
    git as never,
    logger as never,
  );
  vi.spyOn(service, 'resolveRepos').mockResolvedValue([{ alias: 'shopkit', repoDir: '/ws/fork/shopkit' }] as never);
  return { service, checkpoints, git };
}

describe('restoreTurn — turns inherited by a fork', () => {
  it('restores from the ancestor snapshot when the fork has none of its own', async () => {
    const { service, checkpoints } = makeService({ byWorkspace: { fork: [], parent: [record({})] }, objectExists: true });

    const result = await service.restoreTurn('fork', 't1', {}, 'before', { ancestorWorkspaceIds: ['parent'] });

    expect(checkpoints.restoreFromRevision).toHaveBeenCalledWith(
      'fork', 'shopkit', '/ws/fork/shopkit', 'tree-before-t1', undefined, 'Before: add coupons',
    );
    expect(checkpoints.restore).not.toHaveBeenCalled();
    expect(result.mounts).toEqual([expect.objectContaining({ alias: 'shopkit', ok: true, restored: 2 })]);
    expect(result.restored).toBe(2);
  });

  it('prefers the fork’s own snapshot once it has one', async () => {
    const own = record({ id: 'own', workspaceId: 'fork', treeSha: 'own-tree' });
    const { service, checkpoints } = makeService({ byWorkspace: { fork: [own], parent: [record({})] }, objectExists: true });

    await service.restoreTurn('fork', 't1', {}, 'before', { ancestorWorkspaceIds: ['parent'] });

    expect(checkpoints.restore).toHaveBeenCalledWith(own, '/ws/fork/shopkit');
    expect(checkpoints.restoreFromRevision).not.toHaveBeenCalled();
  });

  it('walks ancestors nearest first', async () => {
    const { service, checkpoints } = makeService({
      byWorkspace: { fork: [], parent: [], grandparent: [record({ workspaceId: 'grandparent', treeSha: 'gp-tree' })] },
      objectExists: true,
    });

    await service.restoreTurn('fork', 't1', {}, 'before', { ancestorWorkspaceIds: ['parent', 'grandparent'] });

    expect(checkpoints.restoreFromRevision).toHaveBeenCalledWith(
      'fork', 'shopkit', '/ws/fork/shopkit', 'gp-tree', undefined, expect.any(String),
    );
  });

  it('reports the mount, rather than restoring, when the ancestor’s tree is not in this repository', async () => {
    const { service, checkpoints } = makeService({ byWorkspace: { fork: [], parent: [record({})] }, objectExists: false });

    const result = await service.restoreTurn('fork', 't1', {}, 'before', { ancestorWorkspaceIds: ['parent'] });

    expect(checkpoints.restoreFromRevision).not.toHaveBeenCalled();
    expect(result.mounts).toEqual([{ alias: 'shopkit', ok: false, error: 'No snapshot for this turn' }]);
  });

  it('is unchanged for a chat that was never forked', async () => {
    const { service, checkpoints, git } = makeService({ byWorkspace: { solo: [] }, objectExists: true });

    const result = await service.restoreTurn('solo', 't1');

    expect(git.objectExists).not.toHaveBeenCalled();
    expect(checkpoints.restoreFromRevision).not.toHaveBeenCalled();
    expect(result.mounts[0]).toMatchObject({ ok: false });
  });
});
