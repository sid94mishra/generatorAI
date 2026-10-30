// D-155 — an isolated stage's worktree on a throwaway repository: cut from
// the run folder (uncommitted work included, dependencies linked), merged
// back cleanly beside a parallel stage, and a conflict handed back with its
// markers so the next merge is clean.

import { execFile } from 'node:child_process';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { GitClient, type GitProcessRunOptions, type GitProcessRunResult, type IGitProcessRunner } from '@generatorai/git';
import type { ILogger, WorkflowRun, WorkspaceMount } from '@generatorai/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MountService } from '../../src/services/MountService.js';
import { linkDependencies, StageIsolation } from '../../src/services/engine/StageIsolation.js';
import { WorktreeLeases } from '../../src/services/engine/WorktreeLeases.js';
import type { WorkspaceManager } from '../../src/services/WorkspaceManager.js';

const execFileAsync = promisify(execFile);
const silent: ILogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

class Runner implements IGitProcessRunner {
  async run(command: string, args: string[], options: GitProcessRunOptions): Promise<GitProcessRunResult> {
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          { cwd: options.cwd, timeout: options.timeout ?? 30_000, env: options.env ? { ...process.env, ...options.env } : process.env, maxBuffer: 32 * 1024 * 1024 },
          (error, out, errOut) => (error ? reject(Object.assign(error, { stdout: out, stderr: errOut })) : resolve({ stdout: out, stderr: errOut })),
        );
        child.stdin?.end(options.stdin ?? '');
      });
      return { exitCode: 0, stdout, stderr, durationMs: 0 };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return { exitCode: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', durationMs: 0 };
    }
  }
}

const git = async (cwd: string, ...args: string[]) => (await execFileAsync('git', args, { cwd })).stdout;
const write = async (dir: string, rel: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), content, 'utf-8');
};
const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf-8');

let root: string;
let repo: string;
let iso: StageIsolation;
const run = { id: 'run-0001-abcd', workspaceId: 'ws-run' } as WorkflowRun;

beforeEach(async () => {
  root = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'gai-iso-')));
  repo = path.join(root, 'run', 'source', 'app');
  await fs.mkdir(repo, { recursive: true });
  await git(repo, '-c', 'init.defaultBranch=main', 'init');
  for (const [k, v] of [['user.email', 't@g.local'], ['user.name', 'T'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await git(repo, 'config', k!, v!);
  await write(repo, '.gitignore', 'node_modules\n');
  await write(repo, 'a.txt', 'one\ntwo\nthree\n');
  await write(repo, 'packages/b/index.js', 'module.exports = 1;\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', 'init');

  const gitClient = new GitClient(new Runner(), silent, { workspacesDir: root, defaultTimeoutMs: 60_000 });
  const workspaces = new Map<string, { id: string; ownerId: string; rootPath: string }>([['ws-run', { id: 'ws-run', ownerId: run.id, rootPath: path.join(root, 'run') }]]);
  const mounts = new Map<string, WorkspaceMount[]>([
    ['ws-run', [{ id: 'm-run', workspaceId: 'ws-run', alias: 'app', path: repo, position: 0, status: 'ready', git: { isRepo: true } } as unknown as WorkspaceMount]],
  ]);
  const manager = {
    getExecutionWorkspace: async (id: string) => workspaces.get(id) ?? null,
    findWorkspaceByOwner: async (owner: string) => [...workspaces.values()].find((w) => w.ownerId === owner) ?? null,
    createWorkspace: async (p: { ownerId: string }) => {
      const ws = { id: `ws-${workspaces.size}`, ownerId: p.ownerId, rootPath: path.join(root, p.ownerId) };
      await fs.mkdir(ws.rootPath, { recursive: true });
      workspaces.set(ws.id, ws);
      return ws;
    },
    deleteWorkspace: async (id: string) => {
      await fs.rm(workspaces.get(id)!.rootPath, { recursive: true, force: true });
      workspaces.delete(id);
    },
  } as unknown as WorkspaceManager;
  const svc = {
    git: gitClient,
    list: async (id: string) => mounts.get(id) ?? [],
    forkFromSnapshot: async (_runWs: string, snapshot: Record<string, string>, ws: { id: string; rootPath: string }, opts: { branchFor: (a: string) => string }) => {
      const dir = path.join(ws.rootPath, 'source', 'app');
      await git(repo, 'worktree', 'add', '-b', opts.branchFor('app'), dir, snapshot['app']!);
      const row = { id: `m-${ws.id}`, workspaceId: ws.id, alias: 'app', path: dir, position: 0, status: 'ready', git: { isRepo: true, branch: opts.branchFor('app') } } as unknown as WorkspaceMount;
      mounts.set(ws.id, [row]);
      return [row];
    },
    remove: async (id: string, opts: { deleteBranch?: boolean }) => {
      for (const [ws, rows] of mounts) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        await git(repo, 'worktree', 'remove', '--force', row.path);
        if (opts.deleteBranch && row.git?.branch) await git(repo, 'branch', '-D', row.git.branch);
        mounts.set(ws, rows.filter((r) => r.id !== id));
      }
    },
  } as unknown as MountService;
  iso = new StageIsolation({ workspaceManager: manager, leases: new WorktreeLeases(), platform: () => ({ mounts: svc }), logger: silent });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('StageIsolation', () => {
  it('cuts each stage a worktree of the run folder as it is, and merges both back', async () => {
    await write(repo, 'wip.txt', 'uncommitted\n');
    const backend = (await iso.place(run, 'backend'))!;
    const frontend = (await iso.place(run, 'frontend'))!;
    expect(backend.primaryDir).not.toBe(frontend.primaryDir);
    expect(await read(backend.primaryDir, 'wip.txt')).toBe('uncommitted\n');
    // A loop's next iteration (or a retry) finds the same folder.
    expect((await iso.place(run, 'backend'))!.primaryDir).toBe(backend.primaryDir);

    await write(backend.primaryDir, 'api.ts', 'export const api = 1;\n');
    await write(frontend.primaryDir, 'ui.tsx', 'export const ui = 1;\n');
    // Neither sees the other's work while they run.
    expect(existsSync(path.join(frontend.primaryDir, 'api.ts'))).toBe(false);

    expect(await iso.merge(run, 'backend', backend, 'sr-b', () => false)).toEqual({ ok: true, changed: true });
    await iso.release(run, 'backend');
    expect(await iso.merge(run, 'frontend', frontend, 'sr-f', () => false)).toEqual({ ok: true, changed: true });
    await iso.release(run, 'frontend');
    expect(await read(repo, 'api.ts')).toBe('export const api = 1;\n');
    expect(await read(repo, 'ui.tsx')).toBe('export const ui = 1;\n');
    expect(existsSync(backend.primaryDir)).toBe(false);
    expect((await git(repo, 'for-each-ref', 'refs/generatorai/iso/')).trim()).toBe('');
  });

  it('hands a conflict back with its markers, and merges the resolution', async () => {
    const one = (await iso.place(run, 'one'))!;
    const two = (await iso.place(run, 'two'))!;
    await write(one.primaryDir, 'a.txt', 'one\nTWO by one\nthree\n');
    await write(two.primaryDir, 'a.txt', 'one\nTWO by two\nthree\n');
    expect((await iso.merge(run, 'one', one, 'sr-1', () => false)).ok).toBe(true);

    const r = await iso.merge(run, 'two', two, 'sr-2', () => false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.conflict.paths).toEqual(['a.txt']);
    // Nothing of the conflicting stage was applied.
    expect(await read(repo, 'a.txt')).toBe('one\nTWO by one\nthree\n');

    await iso.markConflicts(run, 'two', two, r.conflict);
    const marked = await read(two.primaryDir, 'a.txt');
    expect(marked).toContain('<<<<<<<');
    expect(marked).toContain('TWO by one');
    expect(marked).toContain('TWO by two');

    await write(two.primaryDir, 'a.txt', 'one\nTWO by one and two\nthree\n');
    expect(await iso.merge(run, 'two', two, 'sr-2', () => false)).toEqual({ ok: true, changed: true });
    expect(await read(repo, 'a.txt')).toBe('one\nTWO by one and two\nthree\n');
  });

  it('links installed dependencies; a workspace link resolves inside the worktree', async () => {
    await write(repo, 'node_modules/left-pad/index.js', 'module.exports = "pad";\n');
    await fs.mkdir(path.join(repo, 'node_modules', '@app'), { recursive: true });
    await fs.symlink(path.join('..', '..', 'packages', 'b'), path.join(repo, 'node_modules', '@app', 'b'), process.platform === 'win32' ? 'junction' : 'dir');
    const fork = path.join(root, 'fork');
    await git(repo, 'worktree', 'add', '-b', 'fork', fork, 'HEAD');
    await write(fork, 'packages/b/index.js', 'module.exports = 2;\n');

    await linkDependencies(repo, fork);
    expect(await read(fork, 'node_modules/left-pad/index.js')).toBe('module.exports = "pad";\n');
    // @app/b is the worktree's own package (the stage's edit), not the run folder's.
    expect(await read(fork, 'node_modules/@app/b/index.js')).toBe('module.exports = 2;\n');
    // The links stay ignored: the stage's tree holds none of them.
    expect((await git(fork, 'status', '--porcelain')).trim()).toBe('M packages/b/index.js');
  });
});
