// ────────────────────────────────────────────────────────────────
// EngineTelemetry — the workflow engine's spans and metrics (P07 WP-7.4,
// G5 §2.13), aligned with the OpenTelemetry GenAI conventions.
//
// Spans (`@generatorai/shared` genai helpers; no-ops without an SDK):
//   workflow.run                      the run, start to `finalized`
//     workflow.loop <key>             a loop instance
//       workflow.iteration <k>        one iteration
//     workflow.map <key>              a map instance
//       workflow.item <i>             one item
//         invoke_agent <stage key>    one stage attempt (the executor)
//           chat / execute_tool       the provider's (nested through the
//                                     active context of the attempt)
// Every span carries `workflow.run.id`; stage spans `workflow.instance_path`.
// The run and container spans follow the engine's own outbox events, so
// the tracing never sits on the scheduler's path. A process that recovers
// a run mid-flight opens its run span on the first event it sees.
//
// Metrics (G5 §2.13): workflow.loop.iterations, workflow.loop.cost_usd,
// workflow.stage.attempts, workflow.stage.repairs,
// workflow.scheduler.decision_latency_ms, workflow.scheduler.cas_conflicts.
// ────────────────────────────────────────────────────────────────

import {
  contextWithSpan,
  endSpan,
  GEN_AI,
  genAiProviderName,
  getMeter,
  startSpan,
  type TraceContext,
  type TraceSpan,
} from '@generatorai/shared';

const TRACER = 'generatorai.workflow';

interface ScopeSpan {
  span: TraceSpan;
  kind: 'loop' | 'iteration' | 'map' | 'item';
  stageKey: string;
  iterations: number;
  costUsd: number;
}

export interface AttemptTrace {
  /** The context the attempt's turns run in (provider spans nest under `invoke_agent`). */
  ctx: TraceContext;
  /** Usage reported during the attempt (gen_ai.usage.*). */
  usage(u: { inputTokens?: number; outputTokens?: number; costUsd?: number }): void;
  end(outcome: { kind: string; error?: unknown }): void;
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v ? v : undefined;
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export class EngineTelemetry {
  private readonly runs = new Map<string, TraceSpan>();
  private readonly scopes = new Map<string, ScopeSpan>();
  private readonly meter = getMeter(TRACER);
  private readonly loopIterations = this.meter.createHistogram('workflow.loop.iterations', {
    description: 'Iterations a loop ran before it exited (labels: loop key, exit reason)',
  });
  private readonly loopCost = this.meter.createHistogram('workflow.loop.cost_usd', {
    description: 'Provider-reported cost of a loop, in USD',
    unit: 'USD',
  });
  private readonly attempts = this.meter.createCounter('workflow.stage.attempts', { description: 'Stage attempts started (labels: mode)' });
  private readonly repairs = this.meter.createCounter('workflow.stage.repairs', { description: 'Repair turns of stage output contracts' });
  private readonly decisionLatency = this.meter.createHistogram('workflow.scheduler.decision_latency_ms', {
    description: 'decide() plus the committed apply of one run message',
    unit: 'ms',
  });
  private readonly casConflicts = this.meter.createCounter('workflow.scheduler.cas_conflicts', {
    description: 'Decision batches that lost a CAS to an executor-owned transition and were re-decided',
  });

  // ── Metrics the actor reports ────────────────────────────────

  decided(ms: number, message: string): void {
    this.decisionLatency.record(ms, { message });
  }

  conflict(): void {
    this.casConflicts.add(1);
  }

  // ── Spans ────────────────────────────────────────────────────

  private run(runId: string): TraceSpan {
    let span = this.runs.get(runId);
    if (!span) {
      span = startSpan(TRACER, 'workflow.run', { 'workflow.run.id': runId });
      this.runs.set(runId, span);
    }
    return span;
  }

  /** The context a span at `instancePath` nests in: its enclosing iteration or item, else its container, else the run. */
  private parentOf(runId: string, instancePath: string): TraceContext {
    let p = instancePath;
    for (let at = p.lastIndexOf('/'); at >= 0; at = p.lastIndexOf('/')) {
      p = p.slice(0, at);
      const scope = this.scopes.get(`${runId}|${p}`) ?? this.scopes.get(`${runId}|${p.replace(/#[^#/]*$/, '')}`);
      if (scope) return contextWithSpan(scope.span);
    }
    return contextWithSpan(this.run(runId));
  }

  private openScope(runId: string, key: string, kind: ScopeSpan['kind'], name: string, parentPath: string, stageKey: string, attrs: Record<string, string | number | undefined>): ScopeSpan {
    const id = `${runId}|${key}`;
    let s = this.scopes.get(id);
    if (!s) {
      s = {
        span: startSpan(TRACER, name, { 'workflow.run.id': runId, 'workflow.instance_path': key, 'workflow.stage.key': stageKey, ...attrs }, this.parentOf(runId, parentPath)),
        kind,
        stageKey,
        iterations: 0,
        costUsd: 0,
      };
      this.scopes.set(id, s);
    }
    return s;
  }

  private closeScope(runId: string, key: string, attrs: Record<string, string | number> = {}, error?: string): ScopeSpan | undefined {
    const id = `${runId}|${key}`;
    const s = this.scopes.get(id);
    if (!s) return undefined;
    this.scopes.delete(id);
    s.span.setAttributes(attrs);
    endSpan(s.span, error);
    return s;
  }

  /** An engine event (the outbox): run, loop and map spans; the repair counter. */
  observe(event: { kind: string; data?: unknown }): void {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const runId = str(data, 'workflowRunId');
    if (!runId) return;
    const path = str(data, 'instancePath') ?? '';
    const stageKey = str(data, 'stageKey') ?? path;
    switch (event.kind) {
      case 'workflow_run.starting':
      case 'workflow_run.running':
        this.run(runId);
        return;
      case 'workflow_run.finalized': {
        for (const [id, s] of this.scopes) {
          if (!id.startsWith(`${runId}|`)) continue;
          this.scopes.delete(id);
          s.span.end();
        }
        const span = this.run(runId);
        const status = str(data, 'status');
        if (status) span.setAttribute('workflow.run.status', status);
        this.runs.delete(runId);
        endSpan(span, status === 'failed' ? 'the run failed' : undefined);
        return;
      }
      case 'loop.iteration_started': {
        const k = num(data, 'k') ?? 0;
        const loop = this.openScope(runId, path, 'loop', `workflow.loop ${stageKey}`, path, stageKey, {});
        loop.iterations = Math.max(loop.iterations, k + 1);
        this.openScope(runId, `${path}#${k}`, 'iteration', `workflow.iteration ${k}`, `${path}#${k}/x`, stageKey, { 'workflow.iteration': k });
        return;
      }
      case 'loop.iteration_completed': {
        const k = num(data, 'k') ?? 0;
        const usage = (data['usage'] ?? {}) as Record<string, unknown>;
        const loop = this.scopes.get(`${runId}|${path}`);
        const cost = num(usage, 'costUsd');
        if (loop && cost !== undefined) loop.costUsd += cost;
        this.closeScope(runId, `${path}#${k}`, { 'workflow.iteration.outcome': str(data, 'outcome') ?? 'done' });
        return;
      }
      case 'map.started':
        this.openScope(runId, path, 'map', `workflow.map ${stageKey}`, path, stageKey, { 'workflow.map.count': num(data, 'count') });
        return;
      case 'map.item_started': {
        const i = num(data, 'index') ?? 0;
        this.openScope(runId, `${path}#${i}`, 'item', `workflow.item ${i}`, `${path}#${i}/x`, stageKey, { 'workflow.item.index': i, 'workflow.item.key': str(data, 'key') });
        return;
      }
      case 'map.item_completed': {
        const i = num(data, 'index') ?? 0;
        const status = str(data, 'status') ?? 'completed';
        this.closeScope(runId, `${path}#${i}`, { 'workflow.item.status': status }, status === 'failed' ? str(data, 'error') ?? 'the item failed' : undefined);
        return;
      }
      case 'stage_run.repairing':
        this.repairs.add(1);
        return;
      case 'stage_run.completed':
      case 'stage_run.failed':
      case 'stage_run.cancelled':
      case 'stage_run.skipped': {
        const status = event.kind.slice('stage_run.'.length);
        const reason = str(data, 'exitReason') ?? status;
        const closed = this.closeScope(runId, path, { 'workflow.stage.status': status, 'workflow.loop.exit_reason': reason }, status === 'failed' ? str(data, 'error') ?? 'the stage failed' : undefined);
        if (closed?.kind === 'loop') {
          this.loopIterations.record(closed.iterations, { loop: closed.stageKey, exitReason: reason });
          if (closed.costUsd > 0) this.loopCost.record(closed.costUsd, { loop: closed.stageKey });
        }
        return;
      }
      default:
        return;
    }
  }

  /** One stage attempt: an `invoke_agent <stage key>` span in its scope. */
  attempt(p: {
    runId: string;
    stageRunId: string;
    instancePath: string;
    stageKey: string;
    attemptNo: number;
    mode: string;
    model?: string | undefined;
    harnessType?: string | undefined;
  }): AttemptTrace {
    this.attempts.add(1, { mode: p.mode });
    const span = startSpan(
      TRACER,
      `invoke_agent ${p.stageKey}`,
      {
        [GEN_AI.OPERATION]: 'invoke_agent',
        [GEN_AI.AGENT_NAME]: p.stageKey,
        [GEN_AI.AGENT_ID]: p.stageRunId,
        [GEN_AI.REQUEST_MODEL]: p.model,
        [GEN_AI.PROVIDER]: p.harnessType ? genAiProviderName(p.harnessType) : undefined,
        'workflow.run.id': p.runId,
        'workflow.instance_path': p.instancePath,
        'workflow.stage.attempt': p.attemptNo,
        'workflow.stage.attempt_mode': p.mode,
      },
      this.parentOf(p.runId, p.instancePath),
    );
    const totals = { input: 0, output: 0, cost: 0 };
    return {
      ctx: contextWithSpan(span),
      usage: (u) => {
        totals.input += u.inputTokens ?? 0;
        totals.output += u.outputTokens ?? 0;
        totals.cost += u.costUsd ?? 0;
        span.setAttribute(GEN_AI.INPUT_TOKENS, totals.input);
        span.setAttribute(GEN_AI.OUTPUT_TOKENS, totals.output);
        if (u.costUsd !== undefined) span.setAttribute('generatorai.usage.cost_usd', totals.cost);
      },
      end: (outcome) => {
        span.setAttribute('workflow.stage.outcome', outcome.kind);
        endSpan(span, outcome.kind === 'failed' ? (outcome.error ?? 'the attempt failed') : undefined);
      },
    };
  }

  /** Process shutdown: end every open span (a restart re-opens what it recovers). */
  shutdown(): void {
    for (const s of this.scopes.values()) s.span.end();
    this.scopes.clear();
    for (const span of this.runs.values()) span.end();
    this.runs.clear();
  }
}
