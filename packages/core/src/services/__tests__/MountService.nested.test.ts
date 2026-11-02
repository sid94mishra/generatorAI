// ────────────────────────────────────────────────────────────────
// MountService — repositories inside a linked folder, against real git:
// per-repository setup, the separate copy (worktrees + links), teardown that
// never reaches the person's checkout, a folder inside a repository, and the
// commit that leaves a repository inside another out.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitClient } from '@generatorai/git';
import type { GitProcessRunOptions, GitProcessRunResult, IGitProcessRunner } from '@generatorai/git';
import type { ExecutionWorkspace, ILogger, WorkspaceMount } from '@generatorai/shared';
import type { IExecutionWorkspaceRepository } from '../../domain/ports/IExecutionWorkspaceRepository.js';
import type { IWorkspaceMountRepository } from '../../domain/ports/IWorkspaceMountRepository.js';
import { MountService } from '../MountService.js';

const execFileAsync = promisify(execFile);

class NodeGitRunner implements IGitProcessRunner {
  async run(command: string, args: string[], options: GitProcessRunOptions): Promise<GitProcessRunResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          { cwd: options.cwd, timeout: options.timeout ?? 30_000, env: options.env ? { ...process.env, ...options.env } : process.env },
          (error, out, errOut) => (error ? reject(Object.assign(error, { stdout: out, stderr: errOut })) : resolve({ stdout: out, stderr: errOut })),
        );
        child.stdin?.end(options.stdin ?? '');
      });
      return { exitCode: 0, stdout, stderr, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return { exitCode: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', durationMs: Date.now() - start };
    }
  }
}

const silent: ILogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

const roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function tmp(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mount-nested-')));
  roots.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd });
  return stdout.trim();
}

async function repo(dir: string, file = 'README.md'): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(dir, file), 'hello\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', 'init');
}

/** An in-memory mount table and workspace table — enough for plan → stage → prepare → remove. */
function harness(workspacesDir: string, rootPath: string) {
  const rows = new Map<string, WorkspaceMount>();
  const workspace = { id: 'ws-1', ownerType: 'chat', ownerId: 'chat-1', rootPath, status: 'active' } as unknown as ExecutionWorkspace;
  const mountRepo = {
    create: async (m: WorkspaceMount) => void rows.set(m.id, structuredClone(m)),
    findById: async (id: string) => rows.get(id) ?? null,
    findByWorkspace: async () => [...rows.values()],
    findByCodebase: async () => [],
    update: async (id: string, patch: Partial<WorkspaceMount>) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...patch } as WorkspaceMount);
    },
    delete: async (id: string) => void rows.delete(id),
    deleteByWorkspace: async () => rows.clear(),
  } as unknown as IWorkspaceMountRepository;
  const workspaceRepo = {
    findById: async () => workspace,
    updatePrep: async () => {},
  } as unknown as IExecutionWorkspaceRepository;
  const gitClient = new GitClient(new NodeGitRunner(), silent, { workspacesDir, defaultTimeoutMs: 60_000 });
  const service = new MountService({ mountRepo, workspaceRepo, git: gitClient, logger: silent, workspacesDir });
  return { service, rows, workspace, gitClient };
}

describe('repositories inside a linked folder', () => {
  it('finds repositories up to three levels deep, skipping dependencies', async () => {
    const home = await tmp();
    const acme = path.join(home, 'acme');
    await repo(path.join(acme, 'api'));
    await repo(path.join(acme, 'services', 'billing'));
    await repo(path.join(acme, 'node_modules', 'left-pad'));
    await repo(path.join(acme, 'a', 'b', 'c', 'too-deep'));
    const { gitClient } = harness(home, path.join(home, 'ws'));
    expect(await gitClient.nestedRepos(acme)).toEqual(['api', 'services/billing']);
  });

  it('builds a separate copy: a worktree on its own branch, a link to the checkout left in place, and the loose files copied', async () => {
    const home = await tmp();
    const acme = path.join(home, 'acme');
    await repo(path.join(acme, 'api'));
    await repo(path.join(acme, 'web'));
    await fs.writeFile(path.join(acme, 'docker-compose.yml'), 'services: {}\n');
    const workspacesDir = path.join(home, 'workspaces');
    const rootPath = path.join(workspacesDir, 'executions', 'chat-1');
    const { service, rows, workspace } = harness(workspacesDir, rootPath);

    const planned = await service.plan(rootPath, undefined, [
      {
        kind: 'folder',
        path: acme,
        mode: 'worktree',
        repos: [
          { path: 'api', mode: 'worktree', newBranch: 'generatorai/fix' },
          { path: 'web', mode: 'in-place' },
        ],
      },
    ]);
    await service.stage(workspace.id, planned);
    await service.prepare(workspace.id);

    const mount = [...rows.values()][0]!;
    expect(mount.status).toBe('ready');
    expect(mount.git?.isRepo).toBe(false);
    expect(mount.git?.nested).toEqual(['api', 'web']);
    expect(mount.git?.nestedState?.['api']).toMatchObject({ mode: 'worktree', branch: 'generatorai/fix', createdBranch: true });
    expect(mount.git?.nestedState?.['web']).toMatchObject({ mode: 'in-place', branch: 'main' });

    // The copy: loose file copied, api a worktree, web a link to the person's checkout.
    expect(await fs.readFile(path.join(mount.path, 'docker-compose.yml'), 'utf8')).toContain('services');
    expect(await git(path.join(mount.path, 'api'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('generatorai/fix');
    expect((await fs.lstat(path.join(mount.path, 'web'))).isSymbolicLink()).toBe(true);
    // The person's checkout of api did not move.
    expect(await git(path.join(acme, 'api'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    // Removing the mount: the link goes, the person's web checkout stays whole; api's worktree and branch go.
    await service.remove(mount.id, { deleteBranch: true });
    await expect(fs.access(mount.path)).rejects.toThrow();
    expect(await fs.readFile(path.join(acme, 'web', 'README.md'), 'utf8')).toBe('hello\n');
    expect(await git(path.join(acme, 'api'), 'branch', '--list', 'generatorai/fix')).toBe('');
    expect(await git(path.join(acme, 'api'), 'worktree', 'list')).not.toContain(mount.path);
  });

  it('switches a repository in place to a new branch while it has uncommitted changes (they come along)', async () => {
    const home = await tmp();
    const acme = path.join(home, 'acme');
    await repo(path.join(acme, 'api'));
    await fs.writeFile(path.join(acme, 'api', 'README.md'), 'edited\n');
    const workspacesDir = path.join(home, 'workspaces');
    const rootPath = path.join(workspacesDir, 'executions', 'chat-1');
    const { service, rows, workspace } = harness(workspacesDir, rootPath);

    const planned = await service.plan(rootPath, undefined, [
      { kind: 'folder', path: acme, repos: [{ path: 'api', newBranch: 'generatorai/try' }] },
    ]);
    await service.stage(workspace.id, planned);
    await service.prepare(workspace.id);

    expect([...rows.values()][0]?.status).toBe('ready');
    expect(await git(path.join(acme, 'api'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('generatorai/try');
    expect(await fs.readFile(path.join(acme, 'api', 'README.md'), 'utf8')).toBe('edited\n');
  });

  it('refuses a separate copy of one repository while its folder is edited in place, and a path that is no repository', async () => {
    const home = await tmp();
    const acme = path.join(home, 'acme');
    await repo(path.join(acme, 'api'));
    const workspacesDir = path.join(home, 'workspaces');
    const rootPath = path.join(workspacesDir, 'executions', 'chat-1');
    const { service } = harness(workspacesDir, rootPath);

    await expect(
      service.plan(rootPath, undefined, [{ kind: 'folder', path: acme, repos: [{ path: 'api', mode: 'worktree' }] }]),
    ).rejects.toThrow(/only get a separate copy when acme is a separate copy too/);
    await expect(
      service.plan(rootPath, undefined, [{ kind: 'folder', path: acme, repos: [{ path: 'docs' }] }]),
    ).rejects.toThrow(/docs is not a git repository inside acme/);
  });

  it('links a folder inside a repository as that repository, starting in the folder', async () => {
    const home = await tmp();
    const mono = path.join(home, 'mono');
    await repo(mono);
    await fs.mkdir(path.join(mono, 'packages', 'web'), { recursive: true });
    const workspacesDir = path.join(home, 'workspaces');
    const rootPath = path.join(workspacesDir, 'executions', 'chat-1');
    const { service } = harness(workspacesDir, rootPath);

    const [mount] = await service.plan(rootPath, undefined, [{ kind: 'folder', path: path.join(mono, 'packages', 'web') }]);
    expect(mount).toMatchObject({ alias: 'web', path: mono, originPath: mono, workdir: 'packages/web', intent: { isRepo: true } });
  });

  it('refuses the home folder as too broad', async () => {
    const home = await tmp();
    const workspacesDir = path.join(home, 'workspaces');
    const { service } = harness(workspacesDir, path.join(workspacesDir, 'executions', 'chat-1'));
    await expect(service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [{ kind: 'folder', path: os.homedir() }])).rejects.toThrow(
      /too broad to work in/,
    );
  });
});

describe('committing a repository that holds another', () => {
  it('leaves the inner repository out of the commit instead of recording a broken embedded repository', async () => {
    const home = await tmp();
    const outer = path.join(home, 'outer');
    await repo(outer);
    await repo(path.join(outer, 'api'));
    await fs.writeFile(path.join(outer, 'notes.md'), 'n\n');
    await fs.writeFile(path.join(outer, 'api', 'x.ts'), 'x\n');
    const { gitClient } = harness(home, path.join(home, 'ws'));

    expect(await gitClient.embeddedRepos(outer)).toEqual(['api']);
    expect((await gitClient.changedFilesSummary(outer)).map((e) => e.path)).toEqual(['notes.md']);
    const result = await gitClient.commitWithSha(outer, 'notes');
    expect(result).not.toBeNull();
    expect(await git(outer, 'show', '--name-only', '--format=', 'HEAD')).toBe('notes.md');
    // The inner repository's own change is still its own, uncommitted.
    expect(await git(path.join(outer, 'api'), 'status', '--porcelain')).toContain('x.ts');
    // And the outer repository reads clean: the inner one is not its change.
    expect(await gitClient.isClean(outer)).toBe(true);
  });
});
