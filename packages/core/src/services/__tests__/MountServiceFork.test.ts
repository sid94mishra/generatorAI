// A forked chat gets its own copy of the parent's files.
//
// Forks used to SHARE the parent's workspace. "Undo all" in the fork reverted
// the parent's work, either chat's rewind moved both, and deleting the parent
// deleted the directory the fork was still working in. These pin the two
// halves of the replacement: what the fork is created from, and how the
// parent's uncommitted work gets into it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { WorkspaceMount, ILogger } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { MountService } from '../MountService.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger } as unknown as ILogger;
let roots: string[] = [];
afterEach(async () => {
  for (const r of roots) await fs.rm(r, { recursive: true, force: true }).catch(() => {});
  roots = [];
});
async function tmp(): Promise<string> {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fork-mount-')));
  roots.push(d);
  return d;
}
const write = async (dir: string, rel: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
};
const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir: string, rel: string) => fs.stat(path.join(dir, rel)).then(() => true, () => false);

function mount(over: Partial<WorkspaceMount>): WorkspaceMount {
  return {
    id: 'm', workspaceId: 'w', position: 0, alias: 'shop', originKind: 'codebase', mode: 'worktree', path: '/x',
    git: { isRepo: true, branch: 'generatorai/parent' }, status: 'ready', hasUncommittedChanges: false,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as WorkspaceMount;
}

function service(byWorkspace: Record<string, WorkspaceMount[]>, git: Partial<IGitClient>) {
  return new MountService({
    mountRepo: { findByWorkspace: vi.fn(async (id: string) => byWorkspace[id] ?? []) } as never,
    workspaceRepo: {} as never,
    git: git as IGitClient,
    logger,
    workspacesDir: os.tmpdir(),
  });
}

describe('sourcesForFork', () => {
  it('cuts a NEW branch from the commit the parent is on, never reusing the parent branch', async () => {
    const svc = service(
      { parent: [mount({ codebaseId: 'cb1', path: '/parent/shop' })] },
      { revParse: vi.fn(async () => 'abc1234') },
    );
    const out = await svc.sourcesForFork('parent', [
      { kind: 'codebase', codebaseId: 'cb1', mode: 'worktree', newBranch: 'generatorai/parent', baseRef: 'main' },
    ]);
    expect(out).toEqual([{ kind: 'codebase', codebaseId: 'cb1', mode: 'worktree', alias: 'shop', baseRef: 'abc1234' }]);
  });

  it('leaves an in-place source alone — there is only one of the user\'s folder', async () => {
    const svc = service(
      { parent: [mount({ mode: 'in-place', originKind: 'folder', originPath: '/home/me/app', path: '/home/me/app' })] },
      { revParse: vi.fn(async () => 'abc') },
    );
    const spec = { kind: 'folder' as const, path: '/home/me/app', mode: 'in-place' as const };
    expect(await svc.sourcesForFork('parent', [spec])).toEqual([spec]);
  });
});

describe('seedFrom', () => {
  it('carries the parent\'s uncommitted edits, new files, deletions and renames into a worktree fork', async () => {
    const parent = await tmp();
    const child = await tmp();
    // What both start with (the commit the fork was cut from)…
    for (const dir of [parent, child]) {
      await write(dir, 'src/kept.js', 'same\n');
      await write(dir, 'src/edited.js', 'old\n');
      await write(dir, 'src/gone.js', 'bye\n');
      await write(dir, 'src/before-rename.js', 'moved\n');
    }
    // …and what the parent has done since, uncommitted.
    await write(parent, 'src/edited.js', 'new\n');
    await write(parent, 'src/deep/added.js', 'fresh\n');
    await fs.rm(path.join(parent, 'src/gone.js'));
    await fs.rename(path.join(parent, 'src/before-rename.js'), path.join(parent, 'src/after-rename.js'));

    const svc = service(
      { p: [mount({ path: parent })], c: [mount({ path: child, workspaceId: 'c' })] },
      {
        changedFilesSummary: vi.fn(async () => [
          { code: 'M', path: 'src/edited.js' },
          { code: 'A', path: 'src/deep/added.js' },
          { code: 'D', path: 'src/gone.js' },
          { code: 'R', path: 'src/after-rename.js', oldPath: 'src/before-rename.js' },
        ]),
      } as never,
    );

    expect(await svc.seedFrom('p', 'c')).toBe(4);
    expect(await read(child, 'src/edited.js')).toBe('new\n');
    expect(await read(child, 'src/deep/added.js')).toBe('fresh\n');
    expect(await exists(child, 'src/gone.js')).toBe(false);
    expect(await exists(child, 'src/before-rename.js')).toBe(false);
    expect(await read(child, 'src/after-rename.js')).toBe('moved\n');
    expect(await read(child, 'src/kept.js')).toBe('same\n');
    // The parent is only ever read.
    expect(await read(parent, 'src/edited.js')).toBe('new\n');
  });

  it('copies a generated project wholesale, without its dependencies', async () => {
    const parent = await tmp();
    const child = await tmp();
    await write(parent, 'package.json', '{}');
    await write(parent, 'src/app.js', 'app\n');
    await write(parent, 'node_modules/big/index.js', 'x');
    const gen = { mode: 'generated' as const, originKind: 'generated' as const, alias: 'project' };
    const svc = service({ p: [mount({ ...gen, path: parent })], c: [mount({ ...gen, path: child })] }, {});

    await svc.seedFrom('p', 'c');
    expect(await read(child, 'src/app.js')).toBe('app\n');
    expect(await exists(child, 'node_modules')).toBe(false);
  });

  it('never copies onto an in-place mount, which IS the parent\'s directory', async () => {
    const dir = await tmp();
    const changed = vi.fn(async () => [{ code: 'M', path: 'a.js' }]);
    const inPlace = { mode: 'in-place' as const, path: dir };
    const svc = service({ p: [mount(inPlace)], c: [mount(inPlace)] }, { changedFilesSummary: changed } as never);
    expect(await svc.seedFrom('p', 'c')).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });
});
