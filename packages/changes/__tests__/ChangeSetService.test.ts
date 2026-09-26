// ────────────────────────────────────────────────────────────────
// ChangeSetService tests — real git repos via GitClient
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { GitClient } from '@generatorai/git';
import type {
  IGitProcessRunner,
  GitProcessRunOptions,
  GitProcessRunResult,
} from '@generatorai/git';
import type { ILogger } from '@generatorai/shared';
import { ChangeSetService, isMetadataPath, extractFileDiff } from '../src/ChangeSetService.js';


class NodeGitRunner implements IGitProcessRunner {
  async run(
    command: string,
    args: string[],
    options: GitProcessRunOptions,
  ): Promise<GitProcessRunResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          {
            cwd: options.cwd,
            timeout: options.timeout ?? 30_000,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            maxBuffer: 32 * 1024 * 1024,
          },
          (error, out, errOut) => (error ? reject(Object.assign(error, { stdout: out, stderr: errOut })) : resolve({ stdout: out, stderr: errOut })),
        );
        // `git commit -F -` reads the message from stdin; close it either way.
        child.stdin?.end(options.stdin ?? '');
      });
      return { exitCode: 0, stdout, stderr, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? '',
        durationMs: Date.now() - start,
      };
    }
  }
}

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

async function write(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

async function removeDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

let tmpRoot: string;
let git: GitClient;
let svc: ChangeSetService;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'changeset-'));
  git = new GitClient(new NodeGitRunner(), silentLogger, {
    workspacesDir: path.join(tmpRoot, 'ws'),
    defaultTimeoutMs: 60_000,
  });
  svc = new ChangeSetService(git, silentLogger);
});

afterEach(async () => {
  await removeDirWithRetry(tmpRoot);
});

describe('isMetadataPath', () => {
  it('flags runtime metadata paths', () => {
    expect(isMetadataPath('artifacts/response.md')).toBe(true);
    expect(isMetadataPath('uploads/skill.md')).toBe(true);
    expect(isMetadataPath('.workspace.json')).toBe(true);
    expect(isMetadataPath('scratchpad.json')).toBe(true);
  });
  it('does not flag real source paths', () => {
    expect(isMetadataPath('src/app.ts')).toBe(false);
    expect(isMetadataPath('README.md')).toBe(false);
  });
});

describe('extractFileDiff', () => {
  it('extracts a single file section from a combined diff', () => {
    const combined = [
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.txt b/b.txt',
      'index 333..444 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -0,0 +1 @@',
      '+bee',
    ].join('\n');
    const a = extractFileDiff(combined, 'a.txt');
    expect(a).toContain('a/a.txt');
    expect(a).toContain('+new');
    expect(a).not.toContain('+bee');
    expect(extractFileDiff(combined, 'missing.txt')).toBe('');
  });
});

describe('ChangeSetService.getChangeSet — no git', () => {
  it('returns hasGit=false when the workspace has no repos', async () => {
    const ws = path.join(tmpRoot, 'ws-empty');
    await fs.mkdir(ws, { recursive: true });
    await write(ws, 'notes.txt', 'hi\n');
    const set = await svc.getChangeSet({ rootPath: ws, autoInit: false });
    expect(set.hasGit).toBe(false);
    expect(set.repos).toEqual([]);
  });
});

describe('ChangeSetService.getChangeSet — root repo', () => {
  it('reports uncommitted changes in the workspace root repo', async () => {
    const ws = path.join(tmpRoot, 'ws-root');
    await fs.mkdir(ws, { recursive: true });
    await git.initIfNeeded(ws);
    await write(ws, 'a.txt', 'first\n');
    await git.commit(ws, 'baseline');
    await write(ws, 'a.txt', 'changed\n');
    await write(ws, 'b.txt', 'new file\n');

    const set = await svc.getChangeSet({ rootPath: ws });
    expect(set.hasGit).toBe(true);
    const root = set.repos.find((r) => r.alias === '.');
    expect(root?.kind).toBe('root');
    const paths = root!.files.map((f) => f.path).sort();
    expect(paths).toContain('a.txt');
    expect(paths).toContain('b.txt');
    const a = root!.files.find((f) => f.path === 'a.txt');
    expect(a?.status).toBe('modified');
    expect(a?.diff).toContain('+changed');
    const b = root!.files.find((f) => f.path === 'b.txt');
    expect(b?.status).toBe('added');
  });

  it('surfaces committed-since-baseline changes even when the tree is clean', async () => {
    const ws = path.join(tmpRoot, 'ws-committed');
    await fs.mkdir(ws, { recursive: true });
    await git.initIfNeeded(ws);
    await write(ws, 'a.txt', 'v1\n');
    await git.commit(ws, 'baseline');
    await write(ws, 'a.txt', 'v2\n');
    await write(ws, 'c.txt', 'brand new\n');
    await git.commit(ws, 'work'); // now clean tree, but changed vs baseline

    const set = await svc.getChangeSet({ rootPath: ws });
    const root = set.repos.find((r) => r.alias === '.')!;
    const paths = root.files.map((f) => f.path).sort();
    expect(paths).toContain('a.txt');
    expect(paths).toContain('c.txt');
  });

  it('filters out runtime metadata files', async () => {
    const ws = path.join(tmpRoot, 'ws-meta');
    await fs.mkdir(ws, { recursive: true });
    await git.initIfNeeded(ws);
    await write(ws, 'src/app.ts', 'export {}\n');
    await write(ws, 'artifacts/response.md', '# out\n');
    await write(ws, '.workspace.json', '{}\n');

    const set = await svc.getChangeSet({ rootPath: ws });
    const root = set.repos.find((r) => r.alias === '.')!;
    const paths = root.files.map((f) => f.path);
    expect(paths).toContain('src/app.ts');
    expect(paths.some((p) => p.includes('artifacts/'))).toBe(false);
    expect(paths).not.toContain('.workspace.json');
  });
});

describe('ChangeSetService.getChangeSet — generated subdir repos', () => {
  it('auto-inits a code subdirectory and prefixes its paths', async () => {
    const ws = path.join(tmpRoot, 'ws-gen');
    await fs.mkdir(ws, { recursive: true });
    // No root repo; a generated codebase subdir with code but no .git.
    await write(ws, 'frontend/index.html', '<h1>hi</h1>\n');

    const set = await svc.getChangeSet({ rootPath: ws, autoInit: true });
    expect(set.hasGit).toBe(true);
    const fe = set.repos.find((r) => r.alias === 'frontend');
    expect(fe?.kind).toBe('generated');
    const paths = fe!.files.map((f) => f.path);
    expect(paths).toContain('frontend/index.html');
  });

  it('does not auto-init when autoInit=false', async () => {
    const ws = path.join(tmpRoot, 'ws-noinit');
    await fs.mkdir(ws, { recursive: true });
    await write(ws, 'frontend/index.html', '<h1>hi</h1>\n');
    const set = await svc.getChangeSet({ rootPath: ws, autoInit: false });
    expect(set.hasGit).toBe(false);
  });

  it('ignores reserved directories', async () => {
    const ws = path.join(tmpRoot, 'ws-reserved');
    await fs.mkdir(ws, { recursive: true });
    await write(ws, 'node_modules/dep/i.js', 'x\n');
    await write(ws, 'artifacts/r.md', 'x\n');
    const set = await svc.getChangeSet({ rootPath: ws, autoInit: true });
    expect(set.hasGit).toBe(false);
  });
});

describe('ChangeSetService.getChangeSet — worktrees', () => {
  it('includes registered worktree repos', async () => {
    // Build an origin, bare clone, then a worktree.
    const origin = path.join(tmpRoot, 'origin');
    await fs.mkdir(origin, { recursive: true });
    await git.initIfNeeded(origin);
    await write(origin, 'README.md', '# origin\n');
    await git.commit(origin, 'init');
    const bare = path.join(tmpRoot, 'cache', 'origin.git');
    await git.bareClone(origin, bare);

    const ws = path.join(tmpRoot, 'ws-wt');
    await fs.mkdir(ws, { recursive: true });
    const wtPath = path.join(ws, 'api');
    await git.createWorktree(bare, wtPath, 'feature/api', 'main');
    // Modify inside the worktree
    await write(wtPath, 'README.md', '# origin changed\n');

    const set = await svc.getChangeSet({
      rootPath: ws,
      worktrees: [{ alias: 'api', worktreePath: wtPath }],
    });
    const api = set.repos.find((r) => r.alias === 'api');
    expect(api?.kind).toBe('linked');
    expect(api!.files.map((f) => f.path)).toContain('api/README.md');
  });
});

describe('ChangeSetService.getFileVersions', () => {
  it('returns current + baseline content for a modified file', async () => {
    const ws = path.join(tmpRoot, 'ws-versions');
    await fs.mkdir(ws, { recursive: true });
    await git.initIfNeeded(ws);
    await write(ws, 'a.txt', 'baseline content\n');
    await git.commit(ws, 'baseline');
    await write(ws, 'a.txt', 'current content\n');

    const { current, baseline } = await svc.getFileVersions(ws, 'a.txt');
    expect(current).toContain('current content');
    expect(baseline).toContain('baseline content');
  });

  it('returns null baseline for a newly added file', async () => {
    const ws = path.join(tmpRoot, 'ws-added');
    await fs.mkdir(ws, { recursive: true });
    await git.initIfNeeded(ws);
    await write(ws, 'seed.txt', 'x\n');
    await git.commit(ws, 'baseline');
    await write(ws, 'fresh.txt', 'new only\n');

    const { current, baseline } = await svc.getFileVersions(ws, 'fresh.txt');
    expect(current).toContain('new only');
    expect(baseline).toBeNull();
  });
});
