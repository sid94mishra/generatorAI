// ────────────────────────────────────────────────────────────────
// createTestEngine — the whole workflow engine, in process, on a fake model.
//
// An in-memory SQLite database migrated with the real `migrateDB`, a scripted
// fake provider (`ScriptedFauxHarness`), and an ENGINE ADAPTER that boots the
// engine under test over them (`adapters/v2.ts`, the engine since P03).
// This file is engine-neutral: it owns the shared state (DB, clock, script,
// captured calls/events/logs), the run handles and polling, and delegates
// every engine-specific step — starting a run, operator commands, snapshots,
// crash/restart — to the adapter (P00 review R20).
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { CoreServices } from '@generatorai/core';
import { closeDB, createDB, migrateDB, type AppDatabase } from '@generatorai/db';
import type { StageRun } from '@generatorai/shared';
import { RealClock, type TestClock } from './clock.js';
import { ScriptBook, type HarnessCall, type ScriptedFauxHarness } from './harness.js';
import type { WorkflowSpecJson } from './definitions.js';
import { createV2Adapter } from './adapters/v2.js';
import {
  DEFAULT_TIMING,
  type ApproveBody,
  type CapturedEvent,
  type CommandResult,
  type EngineAdapter,
  type LogLine,
  type RestartOptions,
  type RunCommand,
  type RunSnapshot,
  type RunStartPermissionMode,
  type TestEngineOptions,
} from './types.js';

export interface RunHandle {
  runId: string;
  definitionId: string;
  /** Stage definition ids by name. */
  stageIds: Record<string, string>;
  db: AppDatabase;
  /** Events for this run (live view). */
  readonly events: CapturedEvent[];
  /** Instance id for an instance path (or a stage name). */
  stageRunId(instancePath: string): string;
  /** Resolve once the run is terminal (the adapter decides what that means). */
  waitForTerminal(timeoutMs?: number): Promise<RunSnapshot>;
  /** Resolve once `predicate(snapshot)` holds. */
  waitFor(predicate: (snap: RunSnapshot) => boolean, timeoutMs?: number, label?: string): Promise<RunSnapshot>;
  /** Resolve once the instance reaches one of `statuses`. */
  waitForStage(instancePath: string, statuses: StageRun['status'] | StageRun['status'][], timeoutMs?: number): Promise<RunSnapshot>;
  snapshot(): Promise<RunSnapshot>;
}

/** Convenience wrappers over `EngineAdapter.command`, one per operator action. */
export interface RunCommands {
  start(runId: string): Promise<void>;
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  /** Fork a terminal run (every instance that did not complete runs again) — returns the fork's id. */
  fork(runId: string): Promise<string>;
  retryStage(runId: string, stageRunId: string): Promise<void>;
  approve(runId: string, stageRunId: string, body?: ApproveBody): Promise<CommandResult>;
  /** Any command, as data. */
  send(runId: string, cmd: RunCommand): Promise<CommandResult>;
}

export interface TestEngine {
  readonly db: AppDatabase;
  readonly sqlite: Database.Database;
  readonly workDir: string;
  readonly clock: TestClock;
  readonly book: ScriptBook;
  /** Every harness call across generations. */
  readonly calls: HarnessCall[];
  /** Every event across generations. */
  readonly events: CapturedEvent[];
  readonly logs: LogLine[];
  /** The engine under test. */
  readonly adapter: EngineAdapter;
  /** Current process generation (0 at boot, +1 per `killAndRestart`). */
  readonly generation: number;
  readonly services: CoreServices;
  readonly harness: ScriptedFauxHarness;
  readonly commands: RunCommands;
  /** Create a published definition through the definition service materializer. */
  importDefinition(spec: WorkflowSpecJson): Promise<{ definitionId: string; stageIds: Record<string, string> }>;
  /**
   * Import `definition` (or reuse `{definitionId}`), create a run with
   * `variables` and start it the way `POST /:id/start` does (fire and
   * forget). Pass `{start: false}` to only create it, `{testRun: true}` to
   * run a definition's working (draft) graph.
   */
  runWorkflow(
    definition: WorkflowSpecJson | { definitionId: string },
    variables?: Record<string, unknown>,
    opts?: { start?: boolean; testRun?: boolean; permissionMode?: RunStartPermissionMode },
  ): Promise<RunHandle>;
  handle(runId: string): Promise<RunHandle>;
  snapshotRun(runId: string): Promise<RunSnapshot>;
  /**
   * Simulate a crash and a reboot on the same database: the current
   * generation's harness dies (its in-flight turns never settle), its timers
   * stop, its engine lock stays behind, and a fresh service graph is built
   * over the same DB. With `recover` (default) the new generation starts its
   * engine (the lock, then recovery).
   */
  killAndRestart(opts?: RestartOptions): Promise<void>;
  /** Let pending async work land. */
  settle(ms?: number): Promise<void>;
  dispose(): Promise<void>;
}

function rawSqlite(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

export async function createTestEngine(opts: TestEngineOptions = {}): Promise<TestEngine> {
  const timing = { ...DEFAULT_TIMING, ...(opts.timing ?? {}) };
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'gai-wftk-'));
  const ownsWorkDir = !opts.workDir;
  const clock = opts.clock ?? new RealClock();
  const book = new ScriptBook(opts.script);
  const calls: HarnessCall[] = [];
  const events: CapturedEvent[] = [];
  const logs: LogLine[] = [];
  const db = createDB(':memory:');
  migrateDB(db);
  const sqlite = rawSqlite(db);

  const adapter = (opts.adapter ?? createV2Adapter)({
    db,
    sqlite,
    workDir,
    clock,
    book,
    calls,
    events,
    logs,
    timing,
    ...(opts.maxConcurrentStages !== undefined ? { maxConcurrentStages: opts.maxConcurrentStages } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
  });

  const poll = async (runId: string, predicate: (s: RunSnapshot) => boolean, timeoutMs: number, label: string) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snap = await adapter.snapshot(runId);
      if (predicate(snap)) return snap;
      if (Date.now() > deadline) {
        const stages = snap.instanceOrder.map((n) => `${n}=${snap.stages[n]!.status}`).join(' ');
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}; run=${snap.run.status} ${stages}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  const makeHandle = async (runId: string): Promise<RunHandle> => {
    const snap = await adapter.snapshot(runId);
    return {
      runId,
      definitionId: snap.run.workflowDefinitionId,
      stageIds: await adapter.stageIds(runId),
      db,
      get events() {
        return events.filter((e) => e.data['workflowRunId'] === runId);
      },
      stageRunId: (instancePath) => adapter.instanceId(runId, instancePath),
      waitForTerminal: (timeoutMs = 15_000) => poll(runId, (s) => adapter.isTerminal(s), timeoutMs, 'a terminal run status'),
      waitFor: (predicate, timeoutMs = 15_000, label = 'predicate') => poll(runId, predicate, timeoutMs, label),
      waitForStage: (instancePath, statuses, timeoutMs = 15_000) => {
        const want = Array.isArray(statuses) ? statuses : [statuses];
        return poll(
          runId,
          (s) => !!s.stages[instancePath] && want.includes(s.stages[instancePath]!.status),
          timeoutMs,
          `instance ${instancePath} in [${want.join(', ')}]`,
        );
      },
      snapshot: () => adapter.snapshot(runId),
    };
  };

  const commands: RunCommands = {
    send: (runId, cmd) => adapter.command(runId, cmd),
    start: async (runId) => void (await adapter.command(runId, { type: 'start' })),
    pause: async (runId) => void (await adapter.command(runId, { type: 'pause' })),
    resume: async (runId) => void (await adapter.command(runId, { type: 'resume' })),
    cancel: async (runId) => void (await adapter.command(runId, { type: 'cancel' })),
    fork: async (runId) => {
      const r = await adapter.command(runId, { type: 'retry-run' });
      if (!r.runId) throw new Error(`fork refused (${r.status}): ${JSON.stringify(r.body)}`);
      return r.runId;
    },
    retryStage: async (runId, stageRunId) => void (await adapter.command(runId, { type: 'retry-stage', stageRunId })),
    approve: (runId, stageRunId, body) =>
      adapter.command(runId, { type: 'approve', stageRunId, ...(body ? { body } : {}) }),
  };

  return {
    db,
    sqlite,
    workDir,
    clock,
    book,
    calls,
    events,
    logs,
    adapter,
    get generation() {
      return adapter.generation;
    },
    get services() {
      return adapter.services;
    },
    get harness() {
      return adapter.harness;
    },
    commands,
    importDefinition: (spec) => adapter.importDefinition(spec),
    async runWorkflow(definition, variables = {}, runOpts = {}) {
      const definitionId =
        'definitionId' in definition && typeof definition.definitionId === 'string'
          ? definition.definitionId
          : (await adapter.importDefinition(definition as WorkflowSpecJson)).definitionId;
      return makeHandle(await adapter.startRun(definitionId, variables, runOpts));
    },
    handle: makeHandle,
    snapshotRun: (runId) => adapter.snapshot(runId),
    killAndRestart: (restartOpts) => adapter.killAndRestart(restartOpts),
    async settle(ms = timing.settleMs) {
      await new Promise((r) => setTimeout(r, ms));
    },
    async dispose() {
      await adapter.dispose();
      try {
        closeDB(db);
      } catch {
        /* already closed */
      }
      if (ownsWorkDir) {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* Windows handle release race; the vitest teardown sweeps gai-* dirs */
        }
      }
    },
  };
}
