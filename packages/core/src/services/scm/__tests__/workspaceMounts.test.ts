import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import type { WorkspaceInfo, WorkspaceMount } from '@generatorai/shared';
import { commitOrder, mountDirFor, scmMountTargets } from '../workspaceMounts.js';

const root = path.resolve('/w/acme');

function info(): WorkspaceInfo {
  const mount = (over: Partial<WorkspaceMount>): WorkspaceMount =>
    ({ id: over.alias, workspaceId: 'ws', status: 'ready', mode: 'in-place', originKind: 'folder', hasUncommittedChanges: false, ...over }) as WorkspaceMount;
  return {
    workingDirectory: root,
    mounts: [
      mount({ alias: 'acme', position: 0, path: root, git: { isRepo: true, nested: ['api', 'services/billing'] } }),
      mount({ alias: 'docs', position: 1, path: path.resolve('/w/docs'), git: { isRepo: true } }),
    ],
  } as unknown as WorkspaceInfo;
}

describe('workspace source-control targets', () => {
  it('lists each mount and then the repositories inside it, each under its own alias', () => {
    expect(scmMountTargets(info()).map((t) => t.alias)).toEqual(['acme', 'acme/api', 'acme/services/billing', 'docs']);
  });

  it('answers only for repositories a mount lists — never a path that leaves it', () => {
    expect(mountDirFor(info(), 'acme/services/billing')).toBe(path.join(root, 'services', 'billing'));
    expect(mountDirFor(info(), 'acme/../docs')).toBeNull();
    expect(mountDirFor(info(), 'nope')).toBeNull();
    expect(mountDirFor(info(), '.')).toBe(root);
  });

  it('commits a repository before the one that contains it', () => {
    expect(commitOrder(scmMountTargets(info())).map((t) => t.alias)).toEqual(['acme/services/billing', 'acme/api', 'acme', 'docs']);
  });
});
