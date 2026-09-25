// ────────────────────────────────────────────────────────────────
// Engine-neutral types of the workflow testkit (P00 review R20).
//
// Tests talk to a `TestEngine`; the `TestEngine` talks to an
// `EngineAdapter`. Everything that knows how TODAY's engine works — the
// copied route logic, the v1 tables, the private heartbeat map, the
// `stage-<id>-<ts>` conversation ids, prompt-text turn classification —
// lives in `adapters/v1.ts`. PHASE-03 adds a v2 adapter beside it; the
// characterisation tests it keeps, and every new scenario test, run
// against either by choosing `createTestEngine({ adapter })`.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import type { CoreServices } from '@generatorai/core';
import type { AppDatabase } from '@generatorai/db';
import type { ChatMessage, StageReviewOutcome, StageRun, WorkflowRun } from '@generatorai/shared';
import type { TestClock } from './clock.js';
import type { HarnessCall, ScriptBook, ScriptedFauxHarness, ScriptSource, StageKey, TurnKind } from './harness.js';
import type { WorkflowSpecJson } from './definitions.js';

/**
 * Service timing, scaled down from production so whole runs take
 * milliseconds. Every knob maps to a setter the services already expose.
 */
export interface TestEngineTiming {
  /** WorkflowRunService reconciler tick (prod 3000). */
  reconcileIntervalMs?: number;
  /** Stage heartbeat period (prod 10000). */
  heartbeatIntervalMs?: number;
  /** Stale after `heartbeatIntervalMs * staleMultiplier` (prod 3). */
  staleMultiplier?: number;
  /** Deadline for a waited prompt turn with no `timeoutMs` (prod 30 min). */
  defaultStageTimeoutMs?: number;
}

/**
 * `stage_runs.heartbeat_at` had ONE-SECOND precision before v57 (it is
 * milliseconds now), so a stale window under ~1.5 s reaped healthy stages.
 * 200 ms × 10 = 2 s keeps a real margin while still letting a test provoke
 * the reaper (W-02) with a few seconds of delay.
 */
export const DEFAULT_TIMING: Required<TestEngineTiming> = {
  reconcileIntervalMs: 20,
  heartbeatIntervalMs: 200,
  staleMultiplier: 10,
  defaultStageTimeoutMs: 60_000,
};

export interface CapturedEvent {
  seq: number;
  generation: number;
  /** Session id, or `'__global__'`. */
  sessionId: string;
  kind: string;
  data: Record<string, unknown>;
  at: number;
}

export interface LogLine {
  generation: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/** One executed node of a run: a stage today; a loop iteration's stage or map item later. */
export interface StageSnapshot {
  /**
   * Stable address of the instance inside the run. v1 has no scopes, so it
   * is the stage name; v2 uses G5's `instance_path` (e.g. `review_loop#2/fix`).
   */
  instancePath: string;
  name: string;
  status: StageRun['status'];
  retryCount: number;
  outputText?: string;
  summary?: string;
  error?: string;
  outputData?: Record<string, unknown>;
  interruptData?: unknown;
  sessionId?: string;
  /** The engine's own row, for assertions the neutral fields do not cover. */
  row: StageRun;
  /** Chat messages that belong to this instance. */
  messages: Array<Pick<ChatMessage, 'role' | 'content'> & { metadata?: Record<string, unknown>; turnRole?: string; complete?: boolean }>;
  /** Engine v2: the instance's attempts, oldest first. */
  attempts?: Array<{ attemptNo: number; mode: string; status: string; errorCode: string | null; repairCount: number; sessionId: string | null }>;
  /** Engine v2: why the instance is in its status (`interrupted:process_restart_unsafe`, `retry:resume`, …). */
  statusReason?: string | null;
}

export interface RunSnapshot {
  run: WorkflowRun;
  /** Instances keyed by `instancePath` (v1: the stage name). */
  stages: Record<string, StageSnapshot>;
  /** Instance paths in definition order. */
  instanceOrder: string[];
  /** Events whose payload names this run, in emission order. */
  events: CapturedEvent[];
  /** Harness calls made for this run's instances. */
  calls: HarnessCall[];
  /** Sessions owned by this run's instances. */
  sessions: Array<{ id: string; status: string; ownerId: string | null; closedAt: number | null }>;
}

export interface ApproveBody {
  outcome?: StageReviewOutcome;
  value?: unknown;
  reason?: string;
  followUpPrompt?: string;
}

/** Operator commands, engine-neutral (they become the P03 commands API). */
export type RunCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'retry-run' }
  | { type: 'retry-stage'; stageRunId: string }
  | { type: 'approve'; stageRunId: string; body?: ApproveBody }
  /** Force a stage into `awaiting_input` (the deleted test-only interrupt route, WP-1.4). */
  | { type: 'interrupt'; stageRunId: string; data?: unknown; prompt?: string }
  /** Engine v2: any `RunCommand` of `@generatorai/workflow-spec`, as the commands API takes it. */
  | { type: 'command'; command: Record<string, unknown> };

/** What a command returned, in HTTP terms. `runId` is set for a retry. */
export interface CommandResult {
  status: number;
  body?: unknown;
  runId?: string;
}

export interface RestartOptions {
  /** Run the engine's boot recovery on the new generation. Default true. */
  recover?: boolean;
  /**
   * v1 only. Rehydrate `SessionAllocator` BEFORE `recover()`. `recover()`
   * re-drives runs (step 2) before it rehydrates the allocator (step 4); a
   * relaunched stage that reaches `allocateSession` first inserts a second
   * `session_allocations` row and fails on its UNIQUE key (W-32). On the live
   * server the relaunch first spends ~2.5 s in the workspace checkpoint
   * capture, so the allocator usually wins; this flag stands in for that
   * latency, which the testkit does not have. Default false (the code's order).
   */
  allocatorFirst?: boolean;
}

/** State shared by the facade and the adapter; survives every generation. */
export interface AdapterContext {
  db: AppDatabase;
  sqlite: Database.Database;
  workDir: string;
  clock: TestClock;
  book: ScriptBook;
  calls: HarnessCall[];
  events: CapturedEvent[];
  logs: LogLine[];
  timing: Required<TestEngineTiming>;
  maxConcurrentStages?: number;
  resultValidation: boolean;
  /** Secret store contents (`namespace/name` → value); wires the MCP hub + vault when set. */
  secrets?: Record<string, string>;
}

/** Everything engine-specific the testkit needs. One per engine version. */
export interface EngineAdapter {
  readonly name: string;
  /** Current process generation (0 at boot, +1 per restart). */
  readonly generation: number;
  /** The engine's service graph (engine-specific; v1: `CoreServices`). */
  readonly services: CoreServices;
  readonly harness: ScriptedFauxHarness;
  /** The stage instance speaking through a provider conversation. */
  resolveStage(conversationId: string): StageKey;
  /** What kind of turn a prompt is (engine metadata first, text as a fallback). */
  classifyTurn(conversationId: string, prompt: string): TurnKind;
  importDefinition(spec: WorkflowSpecJson): Promise<{ definitionId: string; stageIds: Record<string, string> }>;
  /** Create a run; start it unless `start: false`. Returns the run id. */
  startRun(
    definitionId: string,
    variables: Record<string, unknown>,
    opts?: { start?: boolean; testRun?: boolean; permissionMode?: RunStartPermissionMode },
  ): Promise<string>;
  command(runId: string, cmd: RunCommand): Promise<CommandResult>;
  snapshot(runId: string): Promise<RunSnapshot>;
  isTerminal(snap: RunSnapshot): boolean;
  /** Stage keys by name for the run's pinned definition version. */
  stageIds(runId: string): Promise<Record<string, string>>;
  /** The instance id (v1: stage run id) for an instance path. */
  instanceId(runId: string, instancePath: string): string;
  killAndRestart(opts?: RestartOptions): Promise<void>;
  dispose(): Promise<void>;
}

export type AdapterFactory = (ctx: AdapterContext) => EngineAdapter;

export interface TestEngineOptions {
  /** Per-stage model script (see `ScriptSource`). */
  script?: ScriptSource;
  /** Clock for scripted `delayMs` waits. Services still use real time. */
  clock?: TestClock;
  timing?: TestEngineTiming;
  /** Scratch directory for artifacts/workspaces. Default: a fresh temp dir. */
  workDir?: string;
  /** Stage Semaphore width (prod default 8). */
  maxConcurrentStages?: number;
  /** Wire `ResultValidator` like the server does. Default true. */
  resultValidation?: boolean;
  /** The engine under test. Default: today's engine (`createV1Adapter`). */
  adapter?: AdapterFactory;
  /**
   * Secret store contents (`namespace/name` → value). When set, the MCP hub
   * and credential vault are wired as the server wires them, so `secretref:`
   * values resolve (P02 `P02-mcp-secret`).
   */
  secrets?: Record<string, string>;
}

/** A run's own permission mode at creation (the run row). */
export type RunStartPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
