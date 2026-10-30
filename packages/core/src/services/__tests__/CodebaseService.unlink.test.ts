// ────────────────────────────────────────────────────────────────
// CodebaseService.unlinkCodebase — removing a codebase from a project only
// deletes the bare clone the app made under the project's repos dir. A
// git-local / local-dir codebase points at the user's own folder, which must
// survive the unlink untouched.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProjectCodebase } from '@generatorai/shared';
import type { IProjectCodebaseRepository } from '../../domain/ports/index.js';
import type { GitManager } from '../../infrastructure/GitManager.js';
import type { ProjectService } from '../ProjectService.js';
import { CodebaseService } from '../CodebaseService.js';

const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger } as never;

let root: string;
let reposDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gai-unlink-'));
  reposDir = join(root, 'projects', 'p1', 'repos');
  mkdirSync(reposDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function serviceFor(row: ProjectCodebase) {
  const deleted: string[] = [];
  const repo = {
    getById: async () => row,
    delete: async (id: string) => {
      deleted.push(id);
    },
  };
  const projects = { getProjectReposDir: () => reposDir };
  const service = new CodebaseService(
    repo as unknown as IProjectCodebaseRepository,
    projects as unknown as ProjectService,
    {} as unknown as GitManager,
    logger,
  );
  return { service, deleted };
}

function folderWithFile(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'keep.txt'), 'mine');
  return dir;
}

function codebase(overrides: Partial<ProjectCodebase>): ProjectCodebase {
  const now = new Date();
  return {
    id: 'cb1',
    projectId: 'p1',
    alias: 'app',
    type: 'git-remote',
    status: 'ready',
    settings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CodebaseService.unlinkCodebase', () => {
  it('deletes the bare clone of a git-remote codebase', async () => {
    const clone = folderWithFile(join(reposDir, 'app'));
    const { service, deleted } = serviceFor(codebase({ type: 'git-remote', clonePath: clone }));
    await service.unlinkCodebase('cb1');
    expect(existsSync(clone)).toBe(false);
    expect(deleted).toEqual(['cb1']);
  });

  it.each(['git-local', 'local-dir'] as const)('never deletes the folder of a %s codebase', async (type) => {
    const mine = folderWithFile(join(root, 'Users', 'me', 'code', 'app'));
    const { service, deleted } = serviceFor(codebase({ type, localPath: mine, clonePath: mine }));
    await service.unlinkCodebase('cb1');
    expect(existsSync(join(mine, 'keep.txt'))).toBe(true);
    expect(deleted).toEqual(['cb1']);
  });

  it('never deletes a git-remote clone path outside the project repos dir', async () => {
    const elsewhere = folderWithFile(join(root, 'elsewhere'));
    const { service } = serviceFor(codebase({ type: 'git-remote', clonePath: elsewhere }));
    await service.unlinkCodebase('cb1');
    expect(existsSync(join(elsewhere, 'keep.txt'))).toBe(true);
  });

  it('never deletes the repos dir itself', async () => {
    folderWithFile(join(reposDir, 'other'));
    const { service } = serviceFor(codebase({ type: 'git-remote', clonePath: reposDir }));
    await service.unlinkCodebase('cb1');
    expect(existsSync(join(reposDir, 'other', 'keep.txt'))).toBe(true);
  });
});
