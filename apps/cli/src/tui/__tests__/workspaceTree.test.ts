import { describe, expect, it } from 'vitest';
import * as nodePath from 'node:path';
import { combineWorkspaceRows, resolveWorkspaceLocalPath } from '../App.js';

// Phase 7 items 1/3 — pulled out for the same reason `decideClosePane`/
// `nextVerbosity` were: unit-testable without mounting the whole shell.
describe('combineWorkspaceRows', () => {
  it('flattens every repo (main + worktrees) into file rows, tagged by alias', () => {
    const rows = combineWorkspaceRows(
      {
        repos: [
          { alias: '.', paths: ['a.ts', 'b.ts'] },
          { alias: 'frontend', paths: ['src/index.ts'] },
        ],
      },
      null,
    );
    expect(rows).toEqual([
      { alias: '.', relPath: 'a.ts', kind: 'file' },
      { alias: '.', relPath: 'b.ts', kind: 'file' },
      { alias: 'frontend', relPath: 'src/index.ts', kind: 'file' },
    ]);
  });

  it("tags artifactFiles as kind 'artifact' with alias 'artifacts'", () => {
    const rows = combineWorkspaceRows(null, { artifactFiles: ['report.md'] });
    expect(rows).toEqual([{ alias: 'artifacts', relPath: 'report.md', kind: 'artifact' }]);
  });

  it('combines both sources, files after tree, and is an empty array for null/null rather than throwing', () => {
    expect(combineWorkspaceRows(null, null)).toEqual([]);
    const rows = combineWorkspaceRows(
      { repos: [{ alias: '.', paths: ['a.ts'] }] },
      { artifactFiles: ['report.md'] },
    );
    expect(rows).toEqual([
      { alias: '.', relPath: 'a.ts', kind: 'file' },
      { alias: 'artifacts', relPath: 'report.md', kind: 'artifact' },
    ]);
  });
});

describe('resolveWorkspaceLocalPath', () => {
  const workspace = {
    rootPath: '/ws/ws_1',
    workingDirectory: '/ws/ws_1/output',
    worktrees: [{ alias: 'frontend', worktreePath: 'source/frontend' }],
  };

  it('resolves a main-tree file against workingDirectory, not rootPath', () => {
    const resolved = resolveWorkspaceLocalPath({ alias: '.', relPath: 'a.ts', kind: 'file' }, workspace);
    expect(resolved).toBe(nodePath.join('/ws/ws_1/output', 'a.ts'));
  });

  it("resolves a worktree file against rootPath + that worktree's own worktreePath", () => {
    const resolved = resolveWorkspaceLocalPath(
      { alias: 'frontend', relPath: 'src/index.ts', kind: 'file' },
      workspace,
    );
    expect(resolved).toBe(nodePath.join('/ws/ws_1', 'source/frontend', 'src/index.ts'));
  });

  it("resolves an artifact against rootPath + 'artifacts', regardless of alias", () => {
    const resolved = resolveWorkspaceLocalPath(
      { alias: 'artifacts', relPath: 'report.md', kind: 'artifact' },
      workspace,
    );
    expect(resolved).toBe(nodePath.join('/ws/ws_1', 'artifacts', 'report.md'));
  });

  it('declines (returns null) for an alias that matches no known worktree — a nested "generated"-kind repo this session deliberately does not reconstruct', () => {
    const resolved = resolveWorkspaceLocalPath(
      { alias: 'some-nested-repo', relPath: 'x.ts', kind: 'file' },
      workspace,
    );
    expect(resolved).toBeNull();
  });

  it('declines when workingDirectory is missing for a main-tree file', () => {
    const resolved = resolveWorkspaceLocalPath(
      { alias: '.', relPath: 'a.ts', kind: 'file' },
      { rootPath: '/ws/ws_1' },
    );
    expect(resolved).toBeNull();
  });

  it('declines when rootPath is missing for an artifact', () => {
    const resolved = resolveWorkspaceLocalPath({ alias: 'artifacts', relPath: 'x', kind: 'artifact' }, {});
    expect(resolved).toBeNull();
  });
});
