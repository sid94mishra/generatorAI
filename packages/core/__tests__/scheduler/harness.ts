// ────────────────────────────────────────────────────────────────
// A tiny in-memory driver for decide() (P03 WP-3.3 tests).
//
// It plays the actor (decide → applyDecisions) and the executor (the
// executor-owned claim/running/validating transitions), and checks two G5
// §7.2 invariants on every step: every transition decided is legal in the
// spec's state tables, and nothing is launched while the run is not
// running or waiting.
// ────────────────────────────────────────────────────────────────

import {
  isLegalStageRunTransition,
  isLegalWorkflowRunTransition,
  parseGraph,
  type StageRunState,
  type WorkflowGraphInput,
} from '@generatorai/workflow-spec';
import { expect } from 'vitest';

import { classified, type ClassifiedError } from '../../src/domain/errors/StageError.js';
import {
  applyDecisions,
  decide,
  type Decision,
  type InstanceState,
  type RunMessage,
  type RunRecord,
  type RunState,
  type Usage,
} from '../../src/domain/scheduler/index.js';
import { compile, type CompiledWorkflow } from '../../src/domain/workflow-graph/index.js';

type StageInput = { key: string; [k: string]: unknown };
type EdgeInput = { from: string; to: string; [k: string]: unknown };

export function graphOf(stages: Array<string | StageInput>, edges: Array<[string, string] | EdgeInput> = [], workflow: Record<string, unknown> = {}): CompiledWorkflow {
  const input = {
    formatVersion: 2,
    workflow: { name: 'test', ...workflow },
    stages: stages.map((s) => {
      const base = typeof s === 'string' ? { key: s } : s;
      return { name: base.key, kind: 'agent', prompts: [{ label: 'main', text: `do ${base.key}` }], ...base };
    }),
    edges: edges.map((e) => (Array.isArray(e) ? { from: e[0], to: e[1] } : e)),
  } as unknown as WorkflowGraphInput;
  return compile(parseGraph(input));
}

export function newRun(over: Partial<RunRecord> = {}): RunState {
  return {
    run: {
      id: 'run-1',
      name: 'Run',
      status: 'created',
      statusReason: null,
      outcome: null,
      version: 0,
      variables: {},
      codebases: {},
      usage: {},
      budget: null,
      unattended: false,
      startedAt: null,
      ...over,
    },
    instances: [],
  };
}

export class Sim {
  state: RunState;
  now = 1_000_000;
  readonly log: Array<{ msg: RunMessage; decisions: Decision[] }> = [];

  constructor(
    readonly graph: CompiledWorkflow,
    run: Partial<RunRecord> = {},
  ) {
    this.state = newRun(run);
  }

  send(msg: RunMessage): Decision[] {
    const before = this.state;
    const decisions = decide(this.graph, before, msg, this.now);
    checkInvariants(before, decisions);
    this.state = applyDecisions(before, decisions, this.now);
    this.log.push({ msg, decisions });
    return decisions;
  }

  /** start + prepared: the run is running and its roots are scheduled. */
  boot(): Decision[] {
    this.send({ type: 'start' });
    return this.send({ type: 'prepared' });
  }

  inst(path: string): InstanceState {
    const i = this.state.instances.find((x) => x.instancePath === path);
    if (!i) throw new Error(`no instance ${path}`);
    return i;
  }

  status(path: string): StageRunState {
    return this.inst(path).status;
  }

  statuses(): Record<string, string> {
    return Object.fromEntries([...this.state.instances].sort((a, b) => a.instancePath.localeCompare(b.instancePath)).map((i) => [i.instancePath, i.status]));
  }

  /** An executor-owned transition (claim, session ready, output ready). */
  exec(path: string, to: StageRunState, leaseOwner: string | null = `boot:${path}`): void {
    const i = this.inst(path);
    expect(isLegalStageRunTransition(i.status, to), `executor ${i.status} → ${to}`).toBe(true);
    this.state = {
      ...this.state,
      instances: this.state.instances.map((x) => (x.id === i.id ? { ...x, status: to, version: x.version + 1, leaseOwner } : x)),
    };
  }

  /** Claim and run to `validating`, then report success. */
  succeed(path: string, output: { data?: unknown; text?: string } = { text: `${path} done` }, usage?: Usage): Decision[] {
    const i = this.inst(path);
    if (i.status === 'ready') this.exec(path, 'starting');
    if (this.status(path) === 'starting') this.exec(path, 'running');
    if (this.status(path) === 'running') this.exec(path, 'validating');
    return this.send({
      type: 'attempt_settled',
      stageRunId: i.id,
      attemptNo: this.inst(path).currentAttempt,
      outcome: { kind: 'succeeded', output, ...(usage ? { usage } : {}) },
    });
  }

  /** Claim and fail the current attempt. */
  fail(path: string, error: ClassifiedError = classified('overloaded', 'busy'), safeReplay = false): Decision[] {
    const i = this.inst(path);
    if (i.status === 'ready') this.exec(path, 'starting');
    if (this.status(path) === 'starting') this.exec(path, 'running');
    return this.send({
      type: 'attempt_settled',
      stageRunId: i.id,
      attemptNo: this.inst(path).currentAttempt,
      outcome: { kind: 'failed', error, safeReplay },
    });
  }

  /** Fire the live timer of a kind for an instance (or the run). */
  fire(kind: 'retry' | 'queue_timeout' | 'pause_ttl' | 'run_budget_wall_clock', path: string | null): Decision[] {
    return this.send({ type: 'timer_fired', timerId: 't', kind, stageRunId: path === null ? null : this.inst(path).id });
  }
}

/** G5 §7.2 invariants 1 and 3, on one decision batch. */
export function checkInvariants(before: RunState, decisions: readonly Decision[]): void {
  const statuses = new Map(before.instances.map((i) => [i.id, i.status as StageRunState]));
  let runStatus = before.run.status;
  for (const d of decisions) {
    if (d.t === 'transition') {
      const from = statuses.get(d.id) ?? 'pending';
      expect(d.from).toContain(from);
      expect(isLegalStageRunTransition(from, d.to), `${from} → ${d.to}`).toBe(true);
      statuses.set(d.id, d.to);
    } else if (d.t === 'create_instances') {
      for (const r of d.rows) if (!statuses.has(r.id)) statuses.set(r.id, 'pending');
    } else if (d.t === 'run_transition') {
      expect(d.from).toContain(runStatus);
      expect(isLegalWorkflowRunTransition(runStatus, d.to), `run ${runStatus} → ${d.to}`).toBe(true);
      runStatus = d.to;
    } else if (d.t === 'launch' || d.t === 'create_attempt') {
      expect(['running', 'waiting']).toContain(runStatus);
    }
  }
}

export const kinds = (ds: readonly Decision[]) => ds.map((d) => d.t);
export const only = <T extends Decision['t']>(ds: readonly Decision[], t: T) => ds.filter((d) => d.t === t) as Array<Extract<Decision, { t: T }>>;
export const events = (ds: readonly Decision[]) => only(ds, 'emit').map((d) => d.event.kind);
