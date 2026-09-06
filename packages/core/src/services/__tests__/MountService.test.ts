// ────────────────────────────────────────────────────────────────
// MountService — plan validation and exposure
//
// `plan()` is the gate in front of every code path that touches a user's
// repository: it is the last place a bad source list can be rejected before
// directories are created, branches are cut and an agent is pointed at a tree.
// `buildExposure` is the pure counterpart — what the harness is told, byte for
// byte, on create AND on resume (the prompt-cache prefix depends on it).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type {
  ChatSourceSpec,
  ExecutionWorkspace,
  ILogger,
  ProjectCodebase,
  WorkspaceMount,
} from '@generatorai/shared';
import { ValidationError } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import type { IProjectCodebaseRepository } from '../../domain/ports/IProjectCodebaseRepository.js';
import type { IExecutionWorkspaceRepository } from '../../domain/ports/IExecutionWorkspaceRepository.js';
import type { IWorkspaceMountRepository } from '../../domain/ports/IWorkspaceMountRepository.js';
import { MountService, buildExposure, SCRATCH_DIR } from '../MountService.js';

function makeLogger(): ILogger {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

/**
 * Only the handful of read-only git calls `plan()` makes are stubbed; anything
 * else being reached from a planning test is itself the bug.
 */
function makeGit() {
  return {
    branchExists: vi.fn(async () => false),
    revParse: vi.fn(async () => 'deadbeef'),
    worktreeHoldingBranch: vi.fn(async () => null),
    isClean: vi.fn(async () => true),
    nestedRepos: vi.fn(async () => []),
    createBranch: vi.fn(async () => {}),
    checkoutBranch: vi.fn(async () => {}),
    addWorktree: vi.fn(async () => {}),
    initShadowRepo: vi.fn(async () => true),
    commonObjectsDir: vi.fn(async () => null),
    getConfig: vi.fn(async () => null),
    withGitDir: vi.fn(),
  };
}

const mountRepo = (): IWorkspaceMountRepository =>
  ({
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    findByWorkspace: vi.fn(async () => []),
    findByCodebase: vi.fn(async () => []),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    deleteByWorkspace: vi.fn(async () => {}),
  }) as unknown as IWorkspaceMountRepository;

const workspaceRepo = (): IExecutionWorkspaceRepository =>
  ({
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    findByOwner: vi.fn(async () => null),
    findByProject: vi.fn(async () => []),
    list: vi.fn(async () => []),
    updateStatus: vi.fn(async () => {}),
    updatePrep: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }) as unknown as IExecutionWorkspaceRepository;

let tmpRoots: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mount-test-'));
  tmpRoots.push(dir);
  return dir;
}

function makeService(opts: { workspacesDir: string; codebases?: ProjectCodebase[] } ) {
  const git = makeGit();
  const codebaseRepo = {
    getById: vi.fn(async (id: string) => {
      const cb = opts.codebases?.find((c) => c.id === id);
      if (!cb) throw new Error(`codebase not found: ${id}`);
      return cb;
    }),
    getByAlias: vi.fn(async (_projectId: string, alias: string) =>
      opts.codebases?.find((c) => c.alias === alias),
    ),
  } as unknown as IProjectCodebaseRepository;
  const service = new MountService({
    mountRepo: mountRepo(),
    workspaceRepo: workspaceRepo(),
    git: git as unknown as IGitClient,
    logger: makeLogger(),
    workspacesDir: opts.workspacesDir,
    codebaseRepo,
  });
  return { service, git, codebaseRepo };
}

afterEach(async () => {
  for (const dir of tmpRoots) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpRoots = [];
});

// ── plan() validation ────────────────────────────────────────────

describe('MountService.plan validation', () => {
  it('refuses a folder that does not exist', async () => {
    const workspacesDir = await tmpDir();
    const { service } = makeService({ workspacesDir });
    const missing = path.join(workspacesDir, '..', 'no-such-folder-here');

    const sources: ChatSourceSpec[] = [{ kind: 'folder', path: missing }];
    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, sources),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, sources),
    ).rejects.toThrow(/does not exist/);
  });

  it('refuses a relative folder path', async () => {
    const workspacesDir = await tmpDir();
    const { service } = makeService({ workspacesDir });

    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'folder', path: './relative' },
      ]),
    ).rejects.toThrow(/must be absolute/);
  });

  it('refuses a folder that lives inside the managed workspaces directory', async () => {
    const workspacesDir = await tmpDir();
    // A real, existing directory — it is refused for WHERE it is, not because
    // it is missing. Mounting managed storage would let an agent edit another
    // workspace's tree.
    const inside = path.join(workspacesDir, 'executions', 'someone-else');
    await fs.mkdir(inside, { recursive: true });
    const { service } = makeService({ workspacesDir });

    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'folder', path: inside },
      ]),
    ).rejects.toThrow(/managed workspaces directory/);
  });

  it('refuses two mounts whose directories overlap', async () => {
    const workspacesDir = await tmpDir();
    const home = await tmpDir();
    const outer = path.join(home, 'repo');
    const inner = path.join(outer, 'packages', 'web');
    await fs.mkdir(inner, { recursive: true });
    const { service } = makeService({ workspacesDir });

    // Two mounts sharing a subtree means the same file has two identities:
    // diff, checkpoints and discard would each see it twice.
    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'folder', path: outer },
        { kind: 'folder', path: inner },
      ]),
    ).rejects.toThrow(/overlaps another mount/);
  });

  it('refuses to mount a git-remote codebase in place', async () => {
    const workspacesDir = await tmpDir();
    const home = await tmpDir();
    const clonePath = path.join(home, 'api.git');
    await fs.mkdir(clonePath, { recursive: true });
    const codebase: ProjectCodebase = {
      id: 'cb-api',
      projectId: 'proj',
      alias: 'api',
      type: 'git-remote',
      url: 'https://example.invalid/api.git',
      clonePath,
      status: 'ready',
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service } = makeService({ workspacesDir, codebases: [codebase] });

    // A bare clone has no working copy — "in place" would point the agent at
    // a directory of git objects.
    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'codebase', codebaseId: 'cb-api', mode: 'in-place' },
      ]),
    ).rejects.toThrow(/remote clone with no working copy/);
  });

  it('refuses a codebase that is not ready', async () => {
    const workspacesDir = await tmpDir();
    const codebase: ProjectCodebase = {
      id: 'cb-api',
      projectId: 'proj',
      alias: 'api',
      type: 'git-remote',
      clonePath: workspacesDir,
      status: 'cloning',
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service } = makeService({ workspacesDir, codebases: [codebase] });

    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'codebase', codebaseId: 'cb-api' },
      ]),
    ).rejects.toThrow(/is not ready/);
  });

  it('puts the requested primary mount first and renumbers positions', async () => {
    const workspacesDir = await tmpDir();
    const home = await tmpDir();
    const web = path.join(home, 'web');
    const api = path.join(home, 'api');
    await fs.mkdir(web, { recursive: true });
    await fs.mkdir(api, { recursive: true });
    const { service } = makeService({ workspacesDir });
    const root = path.join(workspacesDir, 'executions', 'chat-1');

    const planned = await service.plan(root, undefined, [
      { kind: 'folder', path: web },
      { kind: 'folder', path: api },
    ], { primary: 'api' });

    // Position 0 is the agent's cwd, so ordering is not cosmetic.
    expect(planned.map((m) => m.alias)).toEqual(['api', 'web']);
    expect(planned.map((m) => m.position)).toEqual([0, 1]);
    expect(planned[0]?.path).toBe(api);
    expect(planned[0]?.mode).toBe('in-place');
  });

  it('refuses a primary that is not one of the sources', async () => {
    const workspacesDir = await tmpDir();
    const home = await tmpDir();
    const web = path.join(home, 'web');
    await fs.mkdir(web, { recursive: true });
    const { service } = makeService({ workspacesDir });

    await expect(
      service.plan(path.join(workspacesDir, 'executions', 'chat-1'), undefined, [
        { kind: 'folder', path: web },
      ], { primary: 'nope' }),
    ).rejects.toThrow(/is not one of the sources/);
  });

  it('plans a single generated mount when there are no sources at all', async () => {
    const workspacesDir = await tmpDir();
    const { service } = makeService({ workspacesDir });
    const root = path.join(workspacesDir, 'executions', 'chat-1');

    const planned = await service.plan(root, undefined, []);

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      mode: 'generated',
      originKind: 'generated',
      position: 0,
      path: path.join(root, 'source', 'main'),
    });
  });
});

// ── buildExposure ────────────────────────────────────────────────

describe('buildExposure', () => {
  const workspace: ExecutionWorkspace = {
    id: 'ws-1',
    ownerType: 'chat',
    ownerId: 'chat-1',
    rootPath: path.join(path.sep, 'ws', 'executions', 'chat-1'),
    status: 'active',
    gitEnabled: false,
    useWorktree: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function mount(overrides: Partial<WorkspaceMount> & { alias: string; path: string }): WorkspaceMount {
    return {
      id: `m-${overrides.alias}`,
      workspaceId: workspace.id,
      position: 0,
      originKind: 'folder',
      mode: 'in-place',
      status: 'ready',
      hasUncommittedChanges: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('names the working directory, the scratch dir and every mount in the hint', () => {
    const api = path.join(path.sep, 'home', 'me', 'api');
    const web = path.join(path.sep, 'home', 'me', 'web');
    const exposure = buildExposure(workspace, [
      mount({ alias: 'web', path: web, position: 1, git: { isRepo: true, branch: 'feature/x' } }),
      mount({ alias: 'api', path: api, position: 0, git: { isRepo: true } }),
    ]);

    const scratchDir = path.join(workspace.rootPath, SCRATCH_DIR);
    expect(exposure.workingDirectory).toBe(api);
    expect(exposure.scratchDir).toBe(scratchDir);
    expect(exposure.additionalDirectories).toEqual([web, workspace.rootPath]);
    expect(exposure.env).toEqual({
      GENERATORAI_WORKSPACE_ROOT: workspace.rootPath,
      GENERATORAI_SCRATCH_DIR: scratchDir,
    });

    // The hint is the ONLY place the agent is told where it is.
    expect(exposure.hint).toContain(`Working directory: ${api}`);
    expect(exposure.hint).toContain(`Also mounted: ${web}`);
    expect(exposure.hint).toContain('mount "api"');
    expect(exposure.hint).toContain('mount "web"');
    expect(exposure.hint).toContain('branch feature/x');
    expect(exposure.hint).toContain(`Scratch directory: ${scratchDir}`);
  });

  it('is byte-identical for the same mounts, whatever order they arrive in', () => {
    const api = path.join(path.sep, 'home', 'me', 'api');
    const web = path.join(path.sep, 'home', 'me', 'web');
    const a = mount({ alias: 'api', path: api, position: 0 });
    const b = mount({ alias: 'web', path: web, position: 1 });

    // Resume reads the rows back in whatever order the store returns them; a
    // different hint would silently invalidate the prompt-cache prefix.
    expect(buildExposure(workspace, [a, b]).hint).toBe(buildExposure(workspace, [b, a]).hint);
  });

  it('ignores removed mounts and falls back to the managed root', () => {
    const gone = path.join(path.sep, 'home', 'me', 'gone');
    const exposure = buildExposure(workspace, [
      mount({ alias: 'gone', path: gone, position: 0, status: 'removed' }),
    ]);

    expect(exposure.mounts).toEqual([]);
    expect(exposure.workingDirectory).toBe(workspace.rootPath);
    // cwd is the root itself, so the root is not repeated as an extra.
    expect(exposure.additionalDirectories).toEqual([]);
  });
});
