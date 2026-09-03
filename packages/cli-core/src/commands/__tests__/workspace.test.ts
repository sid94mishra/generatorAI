import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalCommands, workspaceCommands } from '../workspace.js';
import type { CliContext } from '../../context/CliContext.js';

const WORKSPACE_SUMMARY = {
  id: 'ws_1',
  ownerType: 'chat',
  ownerId: 'chat_12345678',
  status: 'active',
  createdAt: new Date().toISOString(),
};

function fakeContext(treeFile: ReturnType<typeof vi.fn>): CliContext {
  return {
    api: {
      workspaces: {
        list: vi.fn(async () => [WORKSPACE_SUMMARY]),
        treeFile,
      },
    },
  } as unknown as CliContext;
}

function fakeChangesContext(overrides: { changes?: ReturnType<typeof vi.fn>; filePatch?: ReturnType<typeof vi.fn> }): CliContext {
  return {
    api: {
      workspaces: {
        list: vi.fn(async () => [WORKSPACE_SUMMARY]),
        changes: overrides.changes ?? vi.fn(),
        filePatch: overrides.filePatch ?? vi.fn(),
      },
    },
  } as unknown as CliContext;
}

const cat = workspaceCommands().find((c) => c.id === 'workspace.get')!;
const changesCmd = workspaceCommands().find((c) => c.id === 'workspace.changes')!;

describe('workspace cat', () => {
  it('reads content through treeFile with no alias — the route that used to call a nonexistent method', async () => {
    const treeFile = vi.fn(async () => ({
      alias: '',
      path: 'README.md',
      contents: 'hello world',
      size: 11,
      isBinary: false,
      isTooLarge: false,
      lang: 'markdown',
      cacheKey: 'x',
    }));
    const ctx = fakeContext(treeFile);

    const result = await cat.handler(ctx, { args: { workspace: 'ws_1', path: 'README.md' }, flags: {} } as never);

    expect(result.data).toBe('hello world');
    expect(treeFile).toHaveBeenCalledWith('ws_1', { path: 'README.md' });
  });

  it('passes --alias through and reads the real "contents" field, not "content"', async () => {
    const treeFile = vi.fn(async () => ({
      alias: 'worktree-a',
      path: 'a.ts',
      contents: 'export const a = 1;',
      size: 20,
      isBinary: false,
      isTooLarge: false,
      lang: 'typescript',
      cacheKey: 'y',
    }));
    const ctx = fakeContext(treeFile);

    const result = await cat.handler(ctx, {
      args: { workspace: 'ws_1', path: 'a.ts' },
      flags: { alias: 'worktree-a' },
    } as never);

    expect(result.data).toBe('export const a = 1;');
    expect(treeFile).toHaveBeenCalledWith('ws_1', { path: 'a.ts', alias: 'worktree-a' });
  });

  it('rejects a binary file with a clear error instead of printing an empty string', async () => {
    const treeFile = vi.fn(async () => ({
      alias: '',
      path: 'image.png',
      contents: null,
      size: 5000,
      isBinary: true,
      isTooLarge: false,
      lang: 'binary',
      cacheKey: 'z',
    }));
    const ctx = fakeContext(treeFile);

    await expect(
      cat.handler(ctx, { args: { workspace: 'ws_1', path: 'image.png' }, flags: {} } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('writes content to --out when given', async () => {
    const treeFile = vi.fn(async () => ({
      alias: '',
      path: 'README.md',
      contents: 'hello world',
      size: 11,
      isBinary: false,
      isTooLarge: false,
      lang: 'markdown',
      cacheKey: 'x',
    }));
    const ctx = fakeContext(treeFile);
    const dir = mkdtempSync(join(tmpdir(), 'generatorai-workspace-cat-'));
    const out = join(dir, 'out.md');
    try {
      await cat.handler(ctx, { args: { workspace: 'ws_1', path: 'README.md' }, flags: { out } } as never);
      expect(readFileSync(out, 'utf8')).toBe('hello world');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('workspace changes', () => {
  it('flattens the repo-grouped response instead of looking for a nonexistent "files" field', async () => {
    const changes = vi.fn(async () => ({
      workspaceId: 'ws_1',
      hasGit: true,
      stats: { files: 2, additions: 3, deletions: 1 },
      repos: [
        {
          alias: '.',
          kind: 'git',
          hasBaseline: true,
          stats: { files: 1, additions: 2, deletions: 0 },
          files: [{ path: 'a.ts', status: 'modified', additions: 2, deletions: 0, isBinary: false, isTooLarge: false }],
        },
        {
          alias: 'sub',
          kind: 'git',
          hasBaseline: true,
          stats: { files: 1, additions: 1, deletions: 1 },
          files: [{ path: 'b.ts', status: 'modified', additions: 1, deletions: 1, isBinary: false, isTooLarge: false }],
        },
      ],
    }));
    const ctx = fakeChangesContext({ changes });

    const result = await changesCmd.handler(ctx, { args: { workspace: 'ws_1' }, flags: {} } as never);

    expect(result.data).toEqual([
      { alias: '.', path: 'a.ts', status: 'modified', additions: 2, deletions: 0, isBinary: false, isTooLarge: false },
      { alias: 'sub', path: 'b.ts', status: 'modified', additions: 1, deletions: 1, isBinary: false, isTooLarge: false },
    ]);
  });

  it('prints the unified patch text for a single file, not the wrapper object', async () => {
    const filePatch = vi.fn(async () => ({
      path: 'a.ts',
      alias: '.',
      patch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
      truncated: false,
      cacheKey: 'x',
    }));
    const ctx = fakeChangesContext({ filePatch });

    const result = await changesCmd.handler(ctx, {
      args: { workspace: 'ws_1', path: 'a.ts' },
      flags: {},
    } as never);

    expect(result.data).toBe('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n');
  });

  it('warns, rather than silently truncating, when the server truncated the patch', async () => {
    const filePatch = vi.fn(async () => ({
      path: 'a.ts',
      alias: '.',
      patch: '(truncated)',
      truncated: true,
      cacheKey: 'x',
    }));
    const ctx = fakeChangesContext({ filePatch });

    const result = await changesCmd.handler(ctx, {
      args: { workspace: 'ws_1', path: 'a.ts' },
      flags: {},
    } as never);

    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('truncated')]));
  });
});

// Phase 7 item 1 — two real bugs found while building the TUI's workspace
// tree pane on top of this same command: the `--alias` branch treated
// `WorkspaceTree` (`{workspaceId, hasGit, repos, totalPaths}`) as a bare
// array or `{entries: [...]}` (neither matches, so it always returned
// nothing); the no-`--alias` branch called `workspaces.files()`, whose real
// response isn't an array at all. Both branches now go through one
// `tree()` call, since the server already returns every repo when `alias`
// is omitted.
describe('workspace tree', () => {
  const treeCmd = workspaceCommands().find((c) => c.id === 'workspace.tree')!;

  function fakeTreeContext(tree: ReturnType<typeof vi.fn>): CliContext {
    return {
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]), tree } },
    } as unknown as CliContext;
  }

  it('flattens every repo (main + worktrees) into one row list, tagged by alias', async () => {
    const tree = vi.fn(async () => ({
      workspaceId: 'ws_1',
      hasGit: true,
      totalPaths: 3,
      repos: [
        { alias: '.', kind: 'root', paths: ['a.ts', 'b.ts'], truncated: false },
        { alias: 'frontend', kind: 'linked', paths: ['src/index.ts'], truncated: false },
      ],
    }));
    const ctx = fakeTreeContext(tree);

    const result = await treeCmd.handler(ctx, { args: { workspace: 'ws_1' }, flags: {} } as never);

    expect(result.data).toEqual([
      { alias: '.', name: 'a.ts' },
      { alias: '.', name: 'b.ts' },
      { alias: 'frontend', name: 'src/index.ts' },
    ]);
    // `alias` passed through unset — the server-side "all repos" behavior,
    // not a client-side guess.
    expect(tree).toHaveBeenCalledWith('ws_1', undefined);
  });

  it('passes --alias straight through to the same call', async () => {
    const tree = vi.fn(async () => ({
      workspaceId: 'ws_1',
      hasGit: true,
      totalPaths: 1,
      repos: [{ alias: 'frontend', kind: 'linked', paths: ['src/index.ts'], truncated: false }],
    }));
    const ctx = fakeTreeContext(tree);

    await treeCmd.handler(ctx, { args: { workspace: 'ws_1' }, flags: { alias: 'frontend' } } as never);

    expect(tree).toHaveBeenCalledWith('ws_1', 'frontend');
  });

  it('filters client-side by the path arg — the server ignores any such filter itself', async () => {
    const tree = vi.fn(async () => ({
      workspaceId: 'ws_1',
      hasGit: true,
      totalPaths: 2,
      repos: [{ alias: '.', kind: 'root', paths: ['src/a.ts', 'test/b.ts'], truncated: false }],
    }));
    const ctx = fakeTreeContext(tree);

    const result = await treeCmd.handler(ctx, {
      args: { workspace: 'ws_1', path: 'src/' },
      flags: {},
    } as never);

    expect(result.data).toEqual([{ alias: '.', name: 'src/a.ts' }]);
  });
});

// The real field names are `worktreePath`/`branchName` (`WorktreeDetail`,
// `packages/shared/src/types/Workspace.ts`), not `path`/`branch` — the old
// column keys matched neither, so both columns rendered empty for every row.
describe('workspace worktrees', () => {
  it('lists worktrees under their real field names', async () => {
    const worktrees = vi.fn(async () => [
      {
        codebaseId: 'cb_1',
        alias: 'frontend',
        branchName: 'feature/foo',
        baseBranch: 'main',
        worktreePath: 'source/frontend',
        status: 'active',
      },
    ]);
    const ctx = {
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]), worktrees } },
    } as unknown as CliContext;
    const worktreesCmd = workspaceCommands().find((c) => c.id === 'workspace.worktrees')!;

    const result = await worktreesCmd.handler(ctx, { args: { workspace: 'ws_1' }, flags: {} } as never);

    expect(result.data).toEqual([
      {
        codebaseId: 'cb_1',
        alias: 'frontend',
        branchName: 'feature/foo',
        baseBranch: 'main',
        worktreePath: 'source/frontend',
        status: 'active',
      },
    ]);
  });
});

describe('terminal attach', () => {
  const attach = terminalCommands().find((c) => c.id === 'terminal.attach')!;

  // Follows a PTY indefinitely, exactly like `chat watch` — the `--json`/
  // `--yaml` unbounded-stream guard in session.ts keys off this flag alone,
  // so a stream command missing it slips past the guard and hangs instead
  // of erroring.
  it("declares itself unbounded, same as chat watch's stream", () => {
    expect(attach.output).toEqual({ kind: 'stream', unbounded: true });
  });

  it('is unreachable from the palette or RPC — only a plain shell invocation', () => {
    expect(attach.inPalette).toBe(false);
    expect(attach.inRpc).toBe(false);
  });

  it('fails with USAGE, not the port, when there is no real terminal to attach from at all', async () => {
    const attachPort = vi.fn();
    const ctx = {
      capabilities: { isTTY: false, columns: 80, rows: 24 },
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]) } },
      terminalAttach: { attach: attachPort },
    } as unknown as Parameters<typeof attach.handler>[0];

    await expect(
      attach.handler(ctx, { args: { workspace: 'ws_1' }, flags: {} } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    // Refusing before ever resolving the workspace or touching the port.
    expect(attachPort).not.toHaveBeenCalled();
  });

  it('resolves the workspace and delegates to ctx.terminalAttach, omitting `terminalId` when none was given', async () => {
    const attachPort = vi.fn(async () => ({ reason: 'detached' as const }));
    const ctx = {
      capabilities: { isTTY: true, columns: 80, rows: 24 },
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]) } },
      terminalAttach: { attach: attachPort },
    } as unknown as Parameters<typeof attach.handler>[0];

    const result = await attach.handler(ctx, {
      args: { workspace: 'ws_1' },
      flags: {},
    } as never);

    expect(attachPort).toHaveBeenCalledWith({ workspaceId: WORKSPACE_SUMMARY.id });
    expect(result.message).toBe('Detached.');
  });

  it('passes the given terminal id through unchanged', async () => {
    const attachPort = vi.fn(async () => ({ reason: 'exited' as const, exitCode: 0 }));
    const ctx = {
      capabilities: { isTTY: true, columns: 80, rows: 24 },
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]) } },
      terminalAttach: { attach: attachPort },
    } as unknown as Parameters<typeof attach.handler>[0];

    const result = await attach.handler(ctx, {
      args: { workspace: 'ws_1', terminal: 'term_1' },
      flags: {},
    } as never);

    expect(attachPort).toHaveBeenCalledWith({ workspaceId: WORKSPACE_SUMMARY.id, terminalId: 'term_1' });
    expect(result.message).toBe('Terminal exited (code 0).');
  });

  it('turns a port-reported error into a real CliError rather than a success record', async () => {
    const attachPort = vi.fn(async () => ({ reason: 'error' as const, message: 'socket refused' }));
    const ctx = {
      capabilities: { isTTY: true, columns: 80, rows: 24 },
      api: { workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]) } },
      terminalAttach: { attach: attachPort },
    } as unknown as Parameters<typeof attach.handler>[0];

    await expect(
      attach.handler(ctx, { args: { workspace: 'ws_1' }, flags: {} } as never),
    ).rejects.toMatchObject({ code: 'INTERNAL', message: 'socket refused' });
  });
});
