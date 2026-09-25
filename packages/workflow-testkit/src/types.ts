// ────────────────────────────────────────────────────────────────
// Engine-neutral types of the workflow testkit (P00 review R20).
//
// Tests talk to a `TestEngine`; the `TestEngine` talks to an
// `EngineAdapter`. Everything that knows how the engine works — its
// supervisor, the commands API mapping, the v57 tables read raw for
// snapshots, `turn_role` turn classification — lives in `adapters/v2.ts`
// (the v1 adapter was deleted with the v1 engine at the P03 cutover).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import type { CoreServices } from '@generatorai/core';
import type { AppDatabase } from '@generatorai/db';
import type { ChatMessage, StageReviewOutcome, StageRun, WorkflowRun } from '@generatorai/shared';
import type { TestClock } from './clock.js';
import type { HarnessCall, ScriptBook, ScriptedFauxHarness, ScriptSource, StageKey, TurnKind } from './harness.js';
import type { WorkflowSpecJson } from './definitions.js';

/**
 * Engine timing, scaled down from production so whole runs take
 * milliseconds (the supervisor's lock, ownership and reaper periods).
 */
export interface TestEngineTiming {
  /** A crashed generation's engine lock goes stale after this (prod 30 s). */
  lockStaleMs?: number;
  /** Lock and ownership renewal (prod 10 s). */
  lockRenewMs?: number;
  /** Run ownership lease (prod 60 s). */
  ownershipTtlMs?: number;
  /** Lease reaper period (prod 15 s). */
  reaperEveryMs?: number;
  /** How long `settle()` waits by default. */
  settleMs?: number;
}

export const DEFAULT_TIMING: Required<TestEngineTiming> = {
  lockStaleMs: 150,
  lockRenewMs: 40,
  ownershipTtlMs: 60_000,
  reaperEveryMs: 100,
  settleMs: 100,
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
  /** Stable address of the instance inside the run: G5's `instance_path` (e.g. `review_loop#2/fix`). */
  instancePath: string;
  name: string;
  status: StageRun['status'];
  /** Attempts that ended `failed` or `interrupted` (what `retry.maxAttempts` counts). */
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
  /** The instance's attempts, oldest first. */
  attempts?: Array<{ attemptNo: number; mode: string; status: string; errorCode: string | null; repairCount: number; sessionId: string | null }>;
  /** Why the instance is in its status (`interrupted:process_restart_unsafe`, `retry:resume`, …). */
  statusReason?: string | null;
}

export interface RunSnapshot {
  run: WorkflowRun;
  /** Instances keyed by `instancePath`. */
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

/** Operator commands, as shortcuts over the commands API and fork. */
export type RunCommand =
  | { type: 'start' }
  /** `pause {mode: interrupt}` on the run. */
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  /** Fork the terminal run (`forkRun`, default options); `runId` of the result is the fork. */
  | { type: 'retry-run'; request?: Record<string, unknown> }
  /** `retry {mode: resume}` of a paused instance. */
  | { type: 'retry-stage'; stageRunId: string }
  | { type: 'approve'; stageRunId: string; body?: ApproveBody }
  /** Any `RunCommand` of `@generatorai/workflow-spec`, as the commands API takes it. */
  | { type: 'command'; command: Record<string, unknown> };

/** What a command returned, in HTTP terms. `runId` is set for a fork. */
export interface CommandResult {
  status: number;
  body?: unknown;
  runId?: string;
}

export interface RestartOptions {
  /** Start the engine (lock + recovery) on the new generation. Default true. */
  recover?: boolean;
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
  /** Secret store contents (`namespace/name` → value); wires the MCP hub + vault when set. */
  secrets?: Record<string, string>;
}

/** Everything engine-specific the testkit needs. One per engine version. */
export interface EngineAdapter {
  readonly name: string;
  /** Current process generation (0 at boot, +1 per restart). */
  readonly generation: number;
  /** The engine's service graph. */
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
  /** The instance id for an instance path (or a stage name). */
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
  /** The admission controller's ordinary lane: how many stages run at once (prod default 8). */
  maxConcurrentStages?: number;
  /** The engine under test. Default: `createV2Adapter`. */
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
