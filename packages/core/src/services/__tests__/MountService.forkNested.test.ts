// ────────────────────────────────────────────────────────────────
// A fork of a chat gets a copy of its own of every repository — the
// repositories inside a linked folder included — starting from where the
// parent's checkout of each is, with the parent's uncommitted work carried
// over (against real git). A plain folder worked on in place stays shared.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitClient } from '@generatorai/git';
import type { GitProcessRunOptions, GitProcessRunResult, IGitProcessRunner } from '@generatorai/git';
import type { ChatSourceSpec, ExecutionWorkspace, ILogger, WorkspaceMount } from '@generatorai/shared';
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
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mount-fork-')));
  roots.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd });
  return stdout.trim();
}

async function repo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', 'init');
}

const read = (...p: string[]) => fs.readFile(path.join(...p), 'utf8');
const exists = (...p: string[]) => fs.access(path.join(...p)).then(() => true, () => false);

/** Two chats' workspaces (parent and fork) over one in-memory mount table. */
function harness(workspacesDir: string) {
  const rows = new Map<string, WorkspaceMount>();
  const workspaces = new Map<string, ExecutionWorkspace>();
  for (const id of ['parent', 'fork']) {
    workspaces.set(id, { id, ownerType: 'chat', ownerId: `chat-${id}`, rootPath: path.join(workspacesDir, 'executions', id), status: 'active' } as unknown as ExecutionWorkspace);
  }
  const mountRepo = {
    create: async (m: WorkspaceMount) => void rows.set(m.id, structuredClone(m)),
    findById: async (id: string) => rows.get(id) ?? null,
    findByWorkspace: async (ws: string) => [...rows.values()].filter((m) => m.workspaceId === ws),
    findByCodebase: async () => [],
    update: async (id: string, patch: Partial<WorkspaceMount>) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...patch } as WorkspaceMount);
    },
    delete: async (id: string) => void rows.delete(id),
    deleteByWorkspace: async (ws: string) => {
      for (const [id, m] of rows) if (m.workspaceId === ws) rows.delete(id);
    },
  } as unknown as IWorkspaceMountRepository;
  const workspaceRepo = {
    findById: async (id: string) => workspaces.get(id) ?? null,
    updatePrep: async () => {},
  } as unknown as IExecutionWorkspaceRepository;
  const gitClient = new GitClient(new NodeGitRunner(), silent, { workspacesDir, defaultTimeoutMs: 60_000 });
  const service = new MountService({ mountRepo, workspaceRepo, git: gitClient, logger: silent, workspacesDir });
  const open = async (id: string, sources: ChatSourceSpec[], slug: string) => {
    const ws = workspaces.get(id)!;
    await service.stage(id, await service.plan(ws.rootPath, undefined, sources, { branchSlug: slug }));
    await service.prepare(id);
    return [...rows.values()].filter((m) => m.workspaceId === id);
  };
  return { service, open };
}

describe('a fork of a chat that works in a folder of repositories', () => {
  it('gets its own worktree of every repository inside, from where the parent is, with the parent\'s uncommitted work', async () => {
    const home = await tmp();
    const acme = path.join(home, 'acme');
    await repo(path.join(acme, 'api'));
    await repo(path.join(acme, 'web'));
    await fs.writeFile(path.join(acme, 'docker-compose.yml'), 'services: {}\n');
    const { service, open } = harness(path.join(home, 'workspaces'));

    const sources: ChatSourceSpec[] = [
      { kind: 'folder', path: acme, mode: 'worktree', repos: [{ path: 'api', mode: 'worktree' }, { path: 'web', mode: 'in-place' }] },
    ];
    const [parent] = await open('parent', sources, 'parent');
    // The parent's agent at work: api on its branch (one commit, one edit, one new file), web edited where
    // the person keeps it (linked in), the loose files of the copy changed, and a repository created.
    await fs.writeFile(path.join(parent!.path, 'api', 'README.md'), 'hello api\n');
    await git(path.join(parent!.path, 'api'), 'commit', '-qam', 'api work');
    await fs.writeFile(path.join(parent!.path, 'api', 'README.md'), 'hello api, uncommitted\n');
    await fs.writeFile(path.join(parent!.path, 'api', 'new.ts'), 'export {};\n');
    await fs.writeFile(path.join(acme, 'web', 'README.md'), 'hello web\n');
    await fs.writeFile(path.join(parent!.path, 'docker-compose.yml'), 'services: { api: {} }\n');
    await fs.writeFile(path.join(parent!.path, 'NOTES.md'), 'notes\n');
    await repo(path.join(parent!.path, 'tools'));
    await service.rescanNested('parent');
    const apiHead = await git(path.join(parent!.path, 'api'), 'rev-parse', 'HEAD');

    const forkSources = await service.sourcesForFork('parent', sources);
    expect(forkSources).toEqual([
      {
        kind: 'folder',
        path: acme,
        mode: 'worktree',
        alias: 'acme',
        repos: [
          { path: 'api', mode: 'worktree', baseRef: apiHead },
          { path: 'web', mode: 'worktree', baseRef: await git(path.join(acme, 'web'), 'rev-parse', 'HEAD') },
        ],
      },
    ]);

    const [fork] = await open('fork', forkSources, 'fork');
    expect(await service.seedFrom('parent', 'fork')).toBeGreaterThan(0);
    expect(await service.sharedWithParent('parent', 'fork')).toEqual([]);

    // api: a worktree on a branch of the fork's own, from the parent's commit, with its uncommitted work.
    const forkApi = path.join(fork!.path, 'api');
    expect(await git(forkApi, 'rev-parse', 'HEAD')).toBe(apiHead);
    expect(await git(forkApi, 'rev-parse', '--abbrev-ref', 'HEAD')).not.toBe(await git(path.join(parent!.path, 'api'), 'rev-parse', '--abbrev-ref', 'HEAD'));
    expect(await read(forkApi, 'README.md')).toBe('hello api, uncommitted\n');
    expect(await read(forkApi, 'new.ts')).toBe('export {};\n');
    // web: no longer the person's checkout — a worktree with its uncommitted edit.
    expect((await fs.lstat(path.join(fork!.path, 'web'))).isSymbolicLink()).toBe(false);
    expect(await read(fork!.path, 'web', 'README.md')).toBe('hello web\n');
    // The copy's loose files are the parent's copy's; the repository the parent's agent made comes whole.
    expect(await read(fork!.path, 'docker-compose.yml')).toBe('services: { api: {} }\n');
    expect(await read(fork!.path, 'NOTES.md')).toBe('notes\n');
    expect(await git(path.join(fork!.path, 'tools'), 'log', '--oneline')).toContain('init');

    // The fork's work stays its own: an edit there reaches neither the parent nor the person's folder.
    await fs.writeFile(path.join(fork!.path, 'web', 'README.md'), 'fork only\n');
    expect(await read(acme, 'web', 'README.md')).toBe('hello web\n');
  });

  it('branches a repository the parent edits in place, and shares a plain folder it edits in place', async () => {
    const home = await tmp();
    const shop = path.join(home, 'shop');
    await repo(shop);
    const notes = path.join(home, 'notes');
    await fs.mkdir(notes);
    await fs.writeFile(path.join(notes, 'todo.md'), '- one\n');
    const { service, open } = harness(path.join(home, 'workspaces'));

    const sources: ChatSourceSpec[] = [
      { kind: 'folder', path: shop, mode: 'in-place' },
      { kind: 'folder', path: notes, mode: 'in-place' },
    ];
    await open('parent', sources, 'parent');
    await fs.writeFile(path.join(shop, 'README.md'), 'edited in place\n');

    const forkSources = await service.sourcesForFork('parent', sources);
    expect(forkSources[0]).toMatchObject({ kind: 'folder', path: shop, mode: 'worktree', baseRef: await git(shop, 'rev-parse', 'HEAD') });
    expect(forkSources[1]).toEqual(sources[1]);

    const [forkShop, forkNotes] = await open('fork', forkSources, 'fork');
    await service.seedFrom('parent', 'fork');
    expect(forkShop!.path).not.toBe(shop);
    expect(await read(forkShop!.path, 'README.md')).toBe('edited in place\n');
    expect(forkNotes!.path).toBe(notes);
    expect(await service.sharedWithParent('parent', 'fork')).toEqual(['notes']);
    // The person's checkout stays on its branch.
    expect(await git(shop, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(await exists(shop, 'README.md')).toBe(true);
  });
});
