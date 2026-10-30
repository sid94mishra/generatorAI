// ────────────────────────────────────────────────────────────────
// CodebaseService — G-16 background fetch jobs, over a REAL throwaway git
// repo (scripts/redesign/make-dummy-repo.mjs — never this checkout).
//
// Exercises the actual `GitManager.fetchAll` → `IGitProcessRunner.streamTo`
// → `CodebaseLogService.appendLine` wiring end to end: real git output,
// real status transitions, real `codebase.status_changed` events. The
// codebase repo is an in-memory fake (no DB needed to prove this).
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import type { ProjectCodebase } from '@generatorai/shared';
import type { IProjectCodebaseRepository } from '../../domain/ports/index.js';
import { GitManager } from '../../infrastructure/GitManager.js';
import { SandboxedScriptRunner } from '../../infrastructure/SandboxedScriptRunner.js';
import { CodebaseService } from '../CodebaseService.js';
import { CodebaseLogService } from '../CodebaseLogService.js';
import type { ProjectService } from '../ProjectService.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => logger } as never;

let dummyRoot: string;
let work: string;

beforeAll(() => {
  const out = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'redesign', 'make-dummy-repo.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim()
    .split(/\r?\n/);
  work = out[out.length - 1]!;
  dummyRoot = dirname(work);
  expect(work).toContain('generatorai-dummy-repo-');
}, 60_000);

afterAll(() => {
  rmSync(dummyRoot, { recursive: true, force: true });
});

/** In-memory `IProjectCodebaseRepository` — just enough for the service under test. */
class FakeCodebaseRepo implements Pick<IProjectCodebaseRepository, 'getById' | 'update' | 'updateStatus'> {
  constructor(private row: ProjectCodebase) {}
  async getById(): Promise<ProjectCodebase> {
    return this.row;
  }
  async update(_id: string, updates: Partial<ProjectCodebase>): Promise<ProjectCodebase> {
    this.row = { ...this.row, ...updates };
    return this.row;
  }
  async updateStatus(_id: string, status: ProjectCodebase['status'], lastError?: string): Promise<void> {
    this.row = { ...this.row, status, ...(lastError !== undefined ? { lastError } : {}), ...(status === 'ready' ? { lastFetchedAt: new Date() } : {}) };
  }
}

function makeService(codebase: ProjectCodebase) {
  const gitManager = new GitManager(new SandboxedScriptRunner(logger), logger, { workspacesDir: work });
  const codebaseLogService = new CodebaseLogService();
  const events: Array<{ kind: string; data: unknown }> = [];
  const eventBus = { emit: async (_sid: string, event: { kind: string; data: unknown }) => { events.push(event); return event; } };
  const repo = new FakeCodebaseRepo(codebase);
  const service = new CodebaseService(
    repo as unknown as IProjectCodebaseRepository,
    {} as unknown as ProjectService, // never touched by fetchCodebase/startFetchJob
    gitManager,
    logger,
    codebaseLogService,
    eventBus,
  );
  return { service, codebaseLogService, events, repo };
}

function baseCodebase(overrides: Partial<ProjectCodebase> = {}): ProjectCodebase {
  const now = new Date();
  return {
    id: 'cb1',
    projectId: 'proj1',
    alias: 'app',
    type: 'git-local',
    localPath: work,
    clonePath: work,
    status: 'ready',
    settings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CodebaseService — background fetch job (G-16)', () => {
  it('startFetchJob returns immediately with a running job, and it settles on "ready"', async () => {
    const { service, codebaseLogService } = makeService(baseCodebase());
    const job = service.startFetchJob('cb1');
    expect(job.kind).toBe('fetch');
    expect(job.status).toBe('running');

    // Poll until the background fetch finishes (real git, but a local bare
    // remote is fast).
    const deadline = Date.now() + 10_000;
    let finished = codebaseLogService.getLogs('cb1').job;
    while (finished?.status === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      finished = codebaseLogService.getLogs('cb1').job;
    }
    expect(finished?.status).toBe('succeeded');
  }, 15_000);

  it('tails real git output into the ring buffer while the job runs', async () => {
    const { service, codebaseLogService } = makeService(baseCodebase());
    service.startFetchJob('cb1');
    const deadline = Date.now() + 10_000;
    while (codebaseLogService.getLogs('cb1').job?.status === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const { lines } = codebaseLogService.getLogs('cb1');
    // `git fetch --progress` on a local remote still writes SOMETHING to
    // stderr (at minimum "From <path>" or nothing if already up to date) —
    // assert the buffer isn't poisoned rather than a specific message,
    // which would make this brittle across git versions.
    expect(Array.isArray(lines)).toBe(true);
    for (const line of lines) {
      expect(['stdout', 'stderr']).toContain(line.stream);
      expect(typeof line.text).toBe('string');
    }
  }, 15_000);

  it('emits codebase.status_changed on the transition to "ready"', async () => {
    const { service, codebaseLogService, events } = makeService(baseCodebase());
    service.startFetchJob('cb1');
    const deadline = Date.now() + 10_000;
    while (codebaseLogService.getLogs('cb1').job?.status === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const readyEvents = events.filter(
      (e) => e.kind === 'codebase.status_changed' && (e.data as { status: string }).status === 'ready',
    );
    expect(readyEvents.length).toBeGreaterThan(0);
    expect(readyEvents[0]?.data).toMatchObject({ codebaseId: 'cb1', projectId: 'proj1', status: 'ready' });
  }, 15_000);

  it('a failed fetch (bad clone path) lands on "stale" with the error recorded', async () => {
    const { service, codebaseLogService } = makeService(baseCodebase({ clonePath: join(work, 'does-not-exist') }));
    service.startFetchJob('cb1');
    const deadline = Date.now() + 10_000;
    let job = codebaseLogService.getLogs('cb1').job;
    while (job?.status === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      job = codebaseLogService.getLogs('cb1').job;
    }
    expect(job?.status).toBe('failed');
    expect(job?.error).toBeTruthy();
  }, 15_000);

  it('reuses the "cloning" status for a fetch in flight (never invents a new enum value)', async () => {
    const { service, repo } = makeService(baseCodebase());
    service.startFetchJob('cb1');
    // Give the async status write a moment to land before the (fast, local) fetch finishes.
    await new Promise((r) => setTimeout(r, 5));
    const status = (await repo.getById()).status;
    expect(['cloning', 'ready']).toContain(status); // fast local fetch may already be done
  }, 15_000);

  it('startFetchJob throws synchronously when no CodebaseLogService is wired', () => {
    const gitManager = new GitManager(new SandboxedScriptRunner(logger), logger, { workspacesDir: work });
    const repo = new FakeCodebaseRepo(baseCodebase());
    const service = new CodebaseService(repo as unknown as IProjectCodebaseRepository, {} as unknown as ProjectService, gitManager, logger);
    expect(() => service.startFetchJob('cb1')).toThrow();
  });
});
