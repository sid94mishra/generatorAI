// WP-2.5 — a session's view of its workspace, and no cwd fallback for runs.

import { describe, expect, it } from 'vitest';
import type { ExecutionWorkspace, WorkspaceExposure } from '@generatorai/shared';
import type { WorkspaceManager } from '../../src/services/WorkspaceManager.js';
import { applyWorkspaceExposure, runWorkspace, workspaceExposure } from '../../src/services/session/workspaceExposure.js';

const ws = { id: 'ws-1', rootPath: '/ws/run-1' } as ExecutionWorkspace;
const base: WorkspaceExposure = {
  rootPath: '/ws/run-1',
  scratchDir: '/ws/run-1/scratch',
  workingDirectory: '/ws/run-1',
  additionalDirectories: [],
  mounts: [],
  env: { GENERATORAI_WORKSPACE_ROOT: '/ws/run-1' },
  hint: '\n\n[Workspace] /ws/run-1',
};
const manager = (found: ExecutionWorkspace | null) =>
  ({
    getExposure: async () => base,
    getExecutionWorkspace: async () => found,
    findWorkspaceByOwner: async () => found,
  }) as unknown as WorkspaceManager;

describe('workspace exposure', () => {
  it('pins the engine-chosen working directory and keeps the managed root reachable', async () => {
    const e = await workspaceExposure(manager(ws), ws, { workingDirectory: '/ws/run-1/source/api' });
    expect(e.workingDirectory).toBe('/ws/run-1/source/api');
    expect(e.additionalDirectories).toEqual(['/ws/run-1']);
    expect(e.hint).toContain('/ws/run-1/source/api');
    const cfg: Record<string, unknown> = { env: { KEEP: '1' } };
    expect(applyWorkspaceExposure(cfg, e)).toBe(e.hint);
    expect(cfg).toMatchObject({
      workingDirectory: '/ws/run-1/source/api',
      additionalDirectories: ['/ws/run-1'],
      env: { KEEP: '1', GENERATORAI_WORKSPACE_ROOT: '/ws/run-1' },
    });
  });

  it('a run without a workspace is a compose error, never the server cwd (B-5)', async () => {
    await expect(runWorkspace(manager(null), { id: 'run-1' })).rejects.toMatchObject({ code: 'workspace_missing' });
    await expect(runWorkspace(manager(ws), { id: 'run-1', workspaceId: 'ws-1' })).resolves.toBe(ws);
  });
});
