// Integration tests for WorkspaceTreeService against real temporary git repos.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { GitClient } from '@generatorai/git';
import type { IGitProcessRunner } from '@generatorai/git';
import type { ILogger } from '@generatorai/shared';
import { WorkspaceTreeService } from '../src/WorkspaceTreeService.js';

const realRunner: IGitProcessRunner = {
  run(command, args, options) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) =>
        resolve({ exitCode: code ?? 0, stdout, stderr, durationMs: Date.now() - started }),
      );
      child.on('error', (err) =>
        resolve({ exitCode: 1, stdout, stderr: String(err), durationMs: Date.now() - started }),
      );
    });
  },
};

const silentLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ILogger;

async function removeDirWithRetry(dir: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

/**
 * Create a repository at `dir` with a raw `git init`.
 *
 * `GitClient.initIfNeeded` deliberately refuses here: it first asks
 * `rev-parse --is-inside-work-tree`, which answers "yes" for any directory
 * under an existing repo. Nested repos therefore have to be created directly.
 */
async function initRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const result = await realRunner.run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (result.exitCode !== 0) throw new Error(`git init failed: ${result.stderr}`);
}

describe('WorkspaceTreeService (real git)', () => {
  let tmpRoot: string;
  let git: GitClient;
  let service: WorkspaceTreeService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-tree-'));
    git = new GitClient(realRunner, silentLogger, { workspacesDir: tmpRoot });
    await git.initIfNeeded(tmpRoot);
    service = new WorkspaceTreeService(git, silentLogger);
  });

  afterEach(async () => {
    await removeDirWithRetry(tmpRoot);
  });

  const params = () => ({ workspaceId: 'ws', rootPath: tmpRoot });

  it('lists tracked and untracked files, honouring .gitignore', async () => {
    await fs.mkdir(path.join(tmpRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    await fs.writeFile(path.join(tmpRoot, 'README.md'), '# hi\n');
    await fs.writeFile(path.join(tmpRoot, '.gitignore'), 'secret.txt\n');
    await fs.writeFile(path.join(tmpRoot, 'secret.txt'), 'nope\n');

    const tree = await service.listTree(params());

    const root = tree.repos.find((r) => r.alias === '.');
    expect(root).toBeDefined();
    expect(root!.paths).toContain('src/a.ts');
    expect(root!.paths).toContain('README.md');
    // The whole point of using `git ls-files --exclude-standard`: ignored
    // paths (node_modules, build output, secrets) never reach the client.
    expect(root!.paths).not.toContain('secret.txt');
    expect(root!.truncated).toBe(false);
  });

  it('never reports a nested repository as a phantom path in its parent', async () => {
    await fs.writeFile(path.join(tmpRoot, 'root.txt'), 'root\n');
    const nested = path.join(tmpRoot, 'service-a');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'main.py'), 'print("hi")\n');
    await initRepo(nested);

    const tree = await service.listTree(params());

    const root = tree.repos.find((r) => r.alias === '.')!;
    const child = tree.repos.find((r) => r.alias === 'service-a')!;

    expect(child.paths).toEqual(['main.py']);
    // `git ls-files --others` in the parent reports the nested repo as a
    // single opaque `service-a/` directory entry. Left in, it would render as
    // a leaf that cannot be opened, duplicating files already listed above.
    expect(root.paths).toContain('root.txt');
    expect(root.paths.some((p) => p.startsWith('service-a'))).toBe(false);
  });

  it('reads a file that is not part of any diff', async () => {
    await fs.mkdir(path.join(tmpRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'docs', 'guide.md'), '# Guide\n\nbody\n');

    const file = await service.readFile({
      rootPath: tmpRoot,
      alias: '.',
      filePath: 'docs/guide.md',
    });

    expect(file.contents).toBe('# Guide\n\nbody\n');
    expect(file.lang).toBe('markdown');
    expect(file.isBinary).toBe(false);
    expect(file.isTooLarge).toBe(false);
    expect(file.cacheKey).toContain('docs/guide.md');
  });

  it('flags binary files instead of returning mojibake', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'blob.bin'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
    );

    const file = await service.readFile({
      rootPath: tmpRoot,
      alias: '.',
      filePath: 'blob.bin',
    });

    expect(file.isBinary).toBe(true);
    expect(file.contents).toBeNull();
  });

  it('refuses to read outside the repository', async () => {
    await expect(
      service.readFile({ rootPath: tmpRoot, alias: '.', filePath: '../../etc/passwd' }),
    ).rejects.toThrow(/Invalid file path/);
  });

  it('tolerates an alias-prefixed path so tree ids can be passed verbatim', async () => {
    const nested = path.join(tmpRoot, 'service-a');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'main.py'), 'print("hi")\n');
    await initRepo(nested);

    const file = await service.readFile({
      rootPath: tmpRoot,
      alias: 'service-a',
      filePath: 'service-a/main.py',
    });

    expect(file.path).toBe('main.py');
    expect(file.contents).toBe('print("hi")\n');
  });
});
