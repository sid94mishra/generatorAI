// ────────────────────────────────────────────────────────────────
// deriveRunView — Convert the workflow run store data + the run's
// pinned graph (stage specs and edges, keyed by stage key) + per-stage
// stream state into the RunView our redesigned UI consumes.
//
// This module is pure: no queries/subscriptions. All inputs are
// passed in. Called from a page-level useMemo. The run clock is not an
// input (it lives in the run header, D-24), and a `StageViewCache` hands
// back the SAME StageView object for a stage whose inputs did not change,
// so the memoised timeline rows re-render only when their stage changed.
// ────────────────────────────────────────────────────────────────

import type {
  WorkflowRunWithStages, StageRun, StageRunStatus, WorkflowRunStatus,
  WorkflowRunPermissionMode,
} from '@generatorai/shared';
import { mapMergeMode, plannerKeyOf, type EdgeSpec, type StageSpec } from '@generatorai/workflow-spec';
import { interpolateVariables } from '@generatorai/shared';
import type { StreamState, StreamHookInvocation } from '@/stores/streamStore.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';
import type { RunView, StageView, StageStatus, RunStatus, HookInvocation, MapView, WaitView } from './types.js';
import { deriveTimeline, deriveAnswer, deriveSegments, widgetBlocks } from '@/components/agent/deriveTimeline.js';
import { deriveLoopView, parseLoopPath } from './loopView.js';
import type { AdmissionWait } from '@/stores/workflowRunStore.js';

// ── Status normalizers ────────────────────────────────────────

const STAGE_STATUS_MAP: Record<StageRunStatus, StageStatus> = {
  pending:        'pending',
  ready:          'ready',
  starting:       'ready',
  running:        'running',
  validating:     'running',
  waiting:        'waiting',
  retry_wait:     'waiting',
  paused:         'paused',
  completed:      'completed',
  failed:         'failed',
  cancelled:      'cancelled',
  skipped:        'skipped',
  awaiting_input: 'awaiting_input',
};

const RUN_STATUS_MAP: Record<WorkflowRunStatus, RunStatus> = {
  created:    'pending',
  starting:   'starting',
  running:    'running',
  waiting:    'waiting',
  finalizing: 'finalizing',
  paused:     'paused',
  cancelling: 'cancelling',
  completed:  'completed',
  failed:     'failed',
  cancelled:  'cancelled',
};

// ── Topological depth per stage ───────────────────────────────

/**
 * Compute a "depth" for each stage using Kahn's algorithm over the DAG
 * edges. Root stages (no predecessors) get depth 0, their successors 1,
 * etc. Depth is used purely for a visual indent in the spine.
 */
function computeDepths(
  stages: StageSpec[],
  edges: EdgeSpec[],
): Map<string, number> {
  const stageByKey = new Map(stages.map((s) => [s.key, s]));
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const s of stages) {
    inbound.set(s.key, []);
    outbound.set(s.key, []);
  }
  for (const e of edges) {
    if (!stageByKey.has(e.from) || !stageByKey.has(e.to)) continue;
    inbound.get(e.to)!.push(e.from);
    outbound.get(e.from)!.push(e.to);
  }
  const depth = new Map<string, number>();
  // Frontier: stages with no inbound edges.
  const queue: string[] = [];
  for (const s of stages) {
    if ((inbound.get(s.key) ?? []).length === 0) {
      depth.set(s.key, 0);
      queue.push(s.key);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const succ of outbound.get(id) ?? []) {
      const next = Math.max(depth.get(succ) ?? 0, d + 1);
      if (next !== depth.get(succ)) {
        depth.set(succ, next);
        queue.push(succ);
      }
    }
  }
  // Anything not reached (defensive) → depth 0
  for (const s of stages) {
    if (!depth.has(s.key)) depth.set(s.key, 0);
  }
  return depth;
}

// ── Overlap sweep-line (ported from WorkflowMessages) ─────────

function computeParallelPeers(stageRuns: StageRun[]): Map<string, string[]> {
  const overlaps = new Map<string, string[]>();
  interface Endpoint { time: number; kind: 'start' | 'end'; sr: StageRun; }
  const now = Date.now();
  const endpoints: Endpoint[] = [];
  for (const sr of stageRuns) {
    if (!sr.startedAt) continue;
    overlaps.set(sr.id, []);
    const start = new Date(sr.startedAt).getTime();
    const end = sr.completedAt ? new Date(sr.completedAt).getTime() : now;
    endpoints.push({ time: start, kind: 'start', sr });
    endpoints.push({ time: end, kind: 'end', sr });
  }
  endpoints.sort((a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === 'start' ? -1 : 1));
  const active = new Map<string, StageRun>();
  for (const ep of endpoints) {
    if (ep.kind === 'start') {
      for (const other of active.values()) {
        overlaps.get(ep.sr.id)!.push(other.id);
        overlaps.get(other.id)!.push(ep.sr.id);
      }
      active.set(ep.sr.id, ep.sr);
    } else {
      active.delete(ep.sr.id);
    }
  }
  return overlaps;
}

// ── Predecessor names per stage (for pending "Waiting for X" text) ──

function computeDependsOn(
  stages: StageSpec[],
  edges: EdgeSpec[],
): Map<string, string[]> {
  const nameByKey = new Map(stages.map((s) => [s.key, s.name]));
  const map = new Map<string, string[]>();
  for (const s of stages) map.set(s.key, []);
  for (const e of edges) {
    const from = nameByKey.get(e.from);
    if (!from) continue;
    map.get(e.to)?.push(from);
  }
  return map;
}

// ── Duration of a finished stage ───────────────────────────────

/** Finished stages only: a live duration would need a clock per row (the run header has the one clock, D-24). */
function stageDuration(sr: StageRun): number | undefined {
  if (!sr.startedAt || !sr.completedAt) return undefined;
  return new Date(sr.completedAt).getTime() - new Date(sr.startedAt).getTime();
}

const HOOK_TYPES = new Set<HookInvocation['type']>(['script', 'http', 'function']);

/**
 * Map a stage's stream-level hook records to `HookInvocation`s.
 *
 * Only records carrying THIS stage's `stageRunId` are kept — a hook without
 * one landed here via the router's stage-fallback key and cannot be
 * attributed with confidence (see `eventRouter.ts`'s `note`/`key` comment).
 * `hookType` is a free-form optional string on the wire, so anything outside
 * the known set narrows to 'function' rather than widening the UI's union.
 */
function hooksFrom(stream: StreamState | undefined, stageRunId: string): HookInvocation[] | undefined {
  const records = stream?.hooks?.filter((h: StreamHookInvocation) => h.stageRunId === stageRunId);
  if (!records || records.length === 0) return undefined;
  return records.map((h) => ({
    id: h.id,
    phase: h.phase,
    type: HOOK_TYPES.has(h.hookType as HookInvocation['type']) ? (h.hookType as HookInvocation['type']) : 'function',
    name: h.hookName,
    status: h.status,
    ...(h.durationMs !== undefined ? { durationMs: h.durationMs } : {}),
  }));
}

function usageFrom(stream: StreamState | undefined): UsageInfo | undefined {
  if (!stream?.usage) return undefined;
  return {
    model: stream.usage.model,
    inputTokens: stream.usage.inputTokens,
    outputTokens: stream.usage.outputTokens,
    durationMs: stream.usage.durationMs ?? 0,
    cacheReadTokens: stream.usage.cacheReadTokens,
    cacheWriteTokens: stream.usage.cacheWriteTokens,
    cost: stream.usage.cost,
    costUsd: stream.usage.costUsd,
    provider: stream.usage.provider,
  };
}

// ── Main entry point ───────────────────────────────────────────

export interface DeriveRunViewInput {
  run: WorkflowRunWithStages;
  /** Stages of the run's pinned graph, in graph order (may be empty while
   *  the version is still loading; degrades gracefully). */
  stageDefs: StageSpec[];
  /** Edges of the run's pinned graph. */
  edges: EdgeSpec[];
  /** streamStore state keyed by "stageRun:<id>" (subset selector). */
  streams: Record<string, StreamState | undefined>;
  /** Effective permission mode (from HitlPanel or run). */
  permissionMode?: WorkflowRunPermissionMode;
  /** `ready` instances waiting for an admission slot, by instance id (P07). */
  admission?: Record<string, AdmissionWait>;
  /** Per-stage memo (one per mounted page): unchanged stages keep their StageView object. */
  cache?: StageViewCache;
}

/** What a StageView was derived from; an unchanged tuple returns the cached view. */
interface StageViewInputs {
  sr: StageRun;
  stream: StreamState | undefined;
  def: StageSpec | undefined;
  order: number;
  depth: number;
  parallel: string;
  dependsOn: string;
  shared: boolean;
  vars: Record<string, unknown> | undefined;
  /** The enclosing loop or map instance's id (a body instance). */
  loopId: string | undefined;
  /** The flow key the instance waits on for a launch slot. */
  admission: AdmissionWait | undefined;
  /** The enclosing container's kind (`loop`, `map`). */
  containerKind: string | undefined;
  /** An expansion node's planner name (P08 plan-then-execute). */
  plannerName: string | undefined;
}

export type StageViewCache = Map<string, { inputs: StageViewInputs; view: StageView }>;

export function createStageViewCache(): StageViewCache {
  return new Map();
}

function sameInputs(a: StageViewInputs, b: StageViewInputs): boolean {
  return (
    a.sr === b.sr && a.stream === b.stream && a.def === b.def && a.order === b.order && a.depth === b.depth &&
    a.parallel === b.parallel && a.dependsOn === b.dependsOn && a.shared === b.shared && a.vars === b.vars &&
    a.loopId === b.loopId && a.containerKind === b.containerKind && a.plannerName === b.plannerName &&
    a.admission === b.admission
  );
}

/** Whether a stage's stream holds a conversation the user had with it in this tab (operator messages). */
function hasConversation(stream: StreamState | undefined): boolean {
  return !!stream?.blocks.some((b) => b.type === 'system' && b.category === 'operator');
}

function isLive(stream: StreamState | undefined): boolean {
  return !!stream && (stream.status === 'pending' || stream.status === 'streaming' || stream.status === 'thinking');
}

export function deriveRunView(input: DeriveRunViewInput): RunView {
  const { run, stageDefs, edges, streams, permissionMode, admission, cache } = input;

  const stageDefByKey = new Map(stageDefs.map((s) => [s.key, s]));
  const orderByKey = new Map(stageDefs.map((s, i) => [s.key, i]));
  const depths = computeDepths(stageDefs, edges);
  const parallelPeers = computeParallelPeers(run.stageRuns);
  const dependsOnByKey = computeDependsOn(stageDefs, edges);

  // Sort stage runs by (graph order, startedAt). Graph order gives us a
  // stable spine that matches the DAG; startedAt is a tie-breaker for
  // parallel siblings so they render in the order they fired.
  // An expansion node (`<planner>~x`, P08) sorts right after its planner.
  const orderOf = (key: string) => {
    const planner = plannerKeyOf(key);
    return planner !== null ? (orderByKey.get(planner) ?? Infinity) + 0.5 : (orderByKey.get(key) ?? Infinity);
  };
  const sorted = [...run.stageRuns].sort((a, b) => {
    const orderA = orderOf(a.stageKey);
    const orderB = orderOf(b.stageKey);
    if (orderA !== orderB) return orderA - orderB;
    if (a.startedAt && b.startedAt) {
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    }
    if (a.startedAt) return -1;
    if (b.startedAt) return 1;
    return a.name.localeCompare(b.name);
  });

  // Which sessions are shared by more than one stage? In `single`/`auto`
  // session modes several stages run in the same conversation, so their
  // context-window figures describe that shared window rather than each
  // stage's own spend.
  const stageCountBySession = new Map<string, number>();
  for (const sr of run.stageRuns) {
    if (!sr.sessionId) continue;
    stageCountBySession.set(sr.sessionId, (stageCountBySession.get(sr.sessionId) ?? 0) + 1);
  }

  // A body instance names its loop by `scopeId`; an instance the stream
  // inserted before the poll may only have its path (`<loop>#<k>/<body>`).
  const idByPath = new Map(run.stageRuns.map((sr) => [sr.instancePath, sr.id]));
  const loopIdOf = (sr: StageRun): string | undefined => {
    if (sr.scopeId) return sr.scopeId;
    const parsed = parseLoopPath(sr.instancePath);
    return parsed ? idByPath.get(parsed.loopPath) : undefined;
  };

  // A planned stage (P08 plan-then-execute) reads its spec from its expansion's stored plan.
  const plannedDefs = new Map<string, StageSpec>();
  for (const sr of run.stageRuns) for (const s of sr.expansionState?.stages ?? []) plannedDefs.set(`${sr.id}/${s.key}`, s as unknown as StageSpec);

  const seen = new Set<string>();
  const stages: StageView[] = sorted.map((sr, idx) => {
    const def = stageDefByKey.get(sr.stageKey) ?? (sr.scopeId ? plannedDefs.get(`${sr.scopeId}/${sr.stageKey}`) : undefined);
    const stream = streams[`stageRun:${sr.id}`];
    const parallelIds = parallelPeers.get(sr.id) ?? [];
    const dependsOn = dependsOnByKey.get(sr.stageKey) ?? [];
    const inputs: StageViewInputs = {
      sr,
      stream,
      def,
      order: idx + 1,
      depth: depths.get(sr.stageKey) ?? 0,
      parallel: parallelIds.join(','),
      dependsOn: dependsOn.join(','),
      shared: !!sr.sessionId && (stageCountBySession.get(sr.sessionId) ?? 0) > 1,
      vars: run.variables as Record<string, unknown> | undefined,
      loopId: loopIdOf(sr),
      containerKind: def?.parentKey ? stageDefByKey.get(def.parentKey)?.kind : undefined,
      plannerName: sr.kind === 'expansion' ? stageDefByKey.get(plannerKeyOf(sr.stageKey) ?? '')?.name : undefined,
      admission: admission?.[sr.id],
    };
    seen.add(sr.id);
    const cached = cache?.get(sr.id);
    if (cached && sameInputs(cached.inputs, inputs)) return cached.view;
    const view = stageView(inputs, parallelIds, dependsOn);
    cache?.set(sr.id, { inputs, view });
    return view;
  });
  if (cache) for (const id of [...cache.keys()]) if (!seen.has(id)) cache.delete(id);

  // Loop and map body instances group under their container (P05): the
  // timeline lists the container once and its iterations or items inside
  // it. A body whose container is not in the run (defensive) stays top
  // level rather than vanishing.
  const ids = new Set(stages.map((s) => s.id));
  const topLevel: StageView[] = [];
  const loopBodies: Record<string, StageView[]> = {};
  for (const s of stages) {
    if (s.loopId && ids.has(s.loopId)) (loopBodies[s.loopId] ??= []).push(s);
    else topLevel.push(s);
  }

  return {
    id: run.id,
    name: run.name,
    status: RUN_STATUS_MAP[run.status] ?? 'pending',
    startedAt: run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime(),
    ...(run.completedAt ? { completedAt: new Date(run.completedAt).getTime() } : {}),
    permissionMode: permissionMode ?? run.effectivePermissionMode ?? run.permissionMode ?? 'default',
    stages,
    topLevel,
    loopBodies,
    ...compensationOf(run),
    error: run.error,
  };
}

/** The finalize `compensate` phase of the run's lifecycle journal, once it ran. */
function compensationOf(run: WorkflowRunWithStages): Pick<RunView, 'compensation'> {
  const rec = run.systemVars?.lifecycle?.['finalize/compensate'];
  return rec ? { compensation: { status: rec.status, at: rec.at, ...(rec.detail ? { detail: rec.detail } : {}) } } : {};
}

/** One stage's view (the cache miss path). */
function stageView(inputs: StageViewInputs, parallelIds: string[], dependsOn: string[]): StageView {
  const { sr, stream, def } = inputs;
  const status = STAGE_STATUS_MAP[sr.status] ?? 'pending';
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';

  const steps = deriveTimeline(stream?.blocks, { active: status === 'running' });
  const stepsDone = steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
  const stepsTotal = steps.length;

  // The stream store only holds blocks THIS browser session actually
  // received. After a reload it is empty, so a completed stage derived an
  // empty answer and the timeline rendered nothing — even though the text
  // was sitting in the database the whole time, reachable only by digging
  // through Details → Inspector → Output. Fall back to the persisted output
  // once the stage is terminal so a finished run replays inline.
  //
  // Approval gates persist the completed output before parking. A route
  // revisit may have only the first few stream blocks, so prefer that
  // persisted result for both completed and approval-waiting stages.
  // Partial ordered segments must not hide the final answer in StreamPanel.
  //
  // A stage the user is talking to in this tab (an operator message, or a
  // turn streaming now — an amendment runs on a completed stage) shows its
  // live conversation instead. An in-turn gate (tool permission, question,
  // plan) renders as its card from the stream, so only a completion review
  // prefers the persisted output.
  const raw = sr.interruptData && typeof sr.interruptData === 'object' && !Array.isArray(sr.interruptData)
    ? (sr.interruptData as Record<string, unknown>)
    : undefined;
  const completionReview = status === 'awaiting_input' && (raw?.['kind'] === undefined || raw['kind'] === 'stage_completion_review');
  const conversing = isLive(stream) || hasConversation(stream);
  const streamedAnswer = deriveAnswer(stream?.blocks);
  const persistedAnswer = (isTerminal || completionReview) && !conversing ? sr.outputText?.trim() : undefined;
  const answer = persistedAnswer || streamedAnswer;
  const segments = persistedAnswer ? [] : deriveSegments(stream?.blocks, { active: status === 'running' || isLive(stream) });

  // A completion review → InlineHitlControls props (in-turn gates are stream cards).
  let interrupt: StageView['interrupt'];
  if (completionReview && sr.interruptData !== undefined && sr.interruptData !== null) {
    if (raw) {
      const r = raw;
      interrupt = {
        reason:
          (typeof r.reason === 'string' && r.reason) ||
          (typeof r.message === 'string' && r.message) ||
          (typeof r.prompt === 'string' && r.prompt) ||
          'The stage is waiting for your approval.',
        tool: typeof r.tool === 'string' ? r.tool : (typeof r.toolName === 'string' ? r.toolName : undefined),
        args: (typeof r.args === 'object' && r.args !== null) ? (r.args as Record<string, unknown>) : undefined,
      };
    } else {
      interrupt = {
        reason: typeof sr.interruptData === 'string' ? sr.interruptData : 'The stage is waiting for your approval.',
      };
    }
  }

  // Prompt from definition (first prompt's text). Interpolate `{{var}}`
  // placeholders against the run variables so the UI matches what actually
  // reached the model. Unresolved placeholders are left as-is on purpose so
  // authors can spot missing variables at a glance.
  const runVars = inputs.vars ?? {};
  const rawPrompt = def?.kind === 'agent' ? def.prompts[0]?.text?.trim() : undefined;
  const prompt = rawPrompt ? interpolateVariables(rawPrompt, runVars) : undefined;

  return {
    id: sr.id,
    // Definition order is a zero-based sorting key, not a user-facing number.
    order: inputs.order,
    depth: inputs.depth,
    dependsOn,
    name: sr.name,
    status,
    rawStatus: sr.status,
    ...(sr.version !== undefined ? { version: sr.version } : {}),
    instancePath: sr.instancePath,
    stageKey: sr.stageKey,
    ...(inputs.admission && sr.status === 'ready' ? { admission: inputs.admission } : {}),
    ...(sr.amendedAt ? { amendedAt: new Date(sr.amendedAt).getTime() } : {}),
    prompt,
    steps,
    stepsDone,
    stepsTotal,
    answer,
    segments,
    widgets: widgetBlocks(stream?.blocks),
    parallelWith: parallelIds.length > 0 ? parallelIds : undefined,
    durationMs: stageDuration(sr),
    interrupt,
    error: sr.error,
    summary: sr.summary,
    outputData: sr.outputData,
    ...(sr.outputText ? { outputText: sr.outputText } : {}),
    streaming: isLive(stream),
    hooks: hooksFrom(stream, sr.id),
    usage: usageFrom(stream),
    contextUsage: stream?.contextUsage ?? undefined,
    sharedContext: inputs.shared,
    ...loopFields(inputs),
  };
}

/**
 * The control-flow fields of a StageView (P05): a loop's badge and rules, a
 * map's items, a wait's question or outcome, a sub-workflow's child run, and
 * a body instance's container with its iteration or item.
 */
function loopFields(inputs: StageViewInputs): Partial<StageView> {
  const { sr, def } = inputs;
  const out: Partial<StageView> = { kind: sr.kind };
  const loop = deriveLoopView(sr, def);
  if (loop) {
    out.kind = 'loop';
    out.loop = loop;
  }
  const map = deriveMapView(sr, def);
  if (map) {
    out.kind = 'map';
    out.map = map;
  }
  const wait = deriveWaitView(sr, def);
  if (wait) {
    out.kind = 'wait';
    out.wait = wait;
  }
  if (sr.kind === 'expansion') {
    out.kind = 'expansion';
    const xs = sr.expansionState;
    out.expansion = {
      plannedBy: inputs.plannerName ?? sr.name,
      phase: xs?.phase ?? 'pending',
      count: xs?.stages.length ?? 0,
      join: xs?.join ?? 'all',
    };
  }
  if (sr.kind === 'subworkflow' || def?.kind === 'subworkflow') {
    out.kind = 'subworkflow';
    out.subworkflow = { phase: sr.subworkflowState?.phase ?? 'starting', childRunId: sr.subworkflowState?.childRunId ?? null };
  }
  if ((def?.compensate?.length ?? 0) > 0) out.compensates = true;
  if (inputs.loopId) {
    out.loopId = inputs.loopId;
    const parsed = parseLoopPath(sr.instancePath);
    const inMap = inputs.containerKind === 'map' || typeof sr.itemIndex === 'number';
    if (inMap) {
      if (typeof sr.itemIndex === 'number') out.itemIndex = sr.itemIndex;
      else if (parsed && typeof parsed.iteration === 'number') out.itemIndex = parsed.iteration;
      if (sr.itemKey) out.itemKey = sr.itemKey;
    } else {
      if (typeof sr.iterationIndex === 'number') out.iterationIndex = sr.iterationIndex;
      else if (parsed && typeof parsed.iteration === 'number') out.iterationIndex = parsed.iteration;
      if (parsed?.iteration === 'wrapup') out.wrapUp = true;
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A map instance's view (P05 §4.1); undefined for any other kind. */
export function deriveMapView(sr: StageRun, def: StageSpec | undefined): MapView | undefined {
  if (sr.kind !== 'map' && def?.kind !== 'map') return undefined;
  const spec = def?.kind === 'map' ? def.map : undefined;
  const ms = sr.mapState;
  const items = ms?.items ?? [];
  return {
    phase: ms?.phase ?? 'pending',
    count: ms?.count ?? 0,
    done: items.filter((i) => i.phase === 'done').length,
    failed: items.filter((i) => i.status === 'failed' || i.status === 'cancelled').length,
    ...(spec ? { concurrency: spec.concurrency, workspace: spec.workspace, merge: mapMergeMode(spec.merge), toleratedFailurePercent: spec.toleratedFailurePercent } : {}),
    items,
    ...(ms?.winner ? { winner: ms.winner } : {}),
  };
}

/** A wait instance's view (P05 §4.3): its question while waiting, its outcome once resolved. */
export function deriveWaitView(sr: StageRun, def: StageSpec | undefined): WaitView | undefined {
  if (sr.kind !== 'wait' && def?.kind !== 'wait') return undefined;
  const spec = def?.kind === 'wait' ? def.wait : undefined;
  const d = isRecord(sr.interruptData) && sr.interruptData['kind'] === 'wait' ? sr.interruptData : undefined;
  const type = (d?.['type'] as WaitView['type'] | undefined) ?? spec?.type ?? 'approval';
  const out: WaitView = { type };
  const label = typeof d?.['label'] === 'string' ? d['label'] : spec?.type === 'approval' ? spec.prompt.label : undefined;
  if (label) out.label = label;
  const prompt = typeof d?.['prompt'] === 'string' ? d['prompt'] : spec?.type === 'approval' ? spec.prompt.text : undefined;
  if (prompt) out.prompt = prompt;
  const form = isRecord(d?.['form']) ? d['form'] : spec?.type === 'approval' && spec.form ? spec.form : undefined;
  if (form) out.form = form;
  if (typeof d?.['eventKey'] === 'string') out.eventKey = d['eventKey'];
  if (typeof d?.['until'] === 'number') out.until = d['until'];
  const onTimeout = typeof d?.['onTimeout'] === 'string' ? d['onTimeout'] : spec && spec.type !== 'timer' ? spec.onTimeout : undefined;
  if (onTimeout) out.onTimeout = onTimeout;
  if (sr.callback) out.callback = sr.callback;
  const o = sr.outputData;
  if (sr.status === 'completed' && isRecord(o) && typeof o['outcome'] === 'string') {
    out.outcome = {
      outcome: o['outcome'],
      data: o['data'] ?? null,
      by: typeof o['by'] === 'string' ? o['by'] : null,
      at: typeof o['at'] === 'number' ? o['at'] : 0,
    };
  }
  return out;
}

/** Build a subset of the streamStore state limited to stage stream keys.
 *  Used with useStreamStore's `subscribe with selector` to avoid re-renders
 *  when unrelated streams (e.g. chats) change. */
export function pickStageStreams(
  allStreams: Record<string, StreamState>,
  stageRunIds: string[],
): Record<string, StreamState | undefined> {
  const out: Record<string, StreamState | undefined> = {};
  for (const id of stageRunIds) {
    out[`stageRun:${id}`] = allStreams[`stageRun:${id}`];
  }
  return out;
}
