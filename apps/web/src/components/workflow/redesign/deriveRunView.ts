// ────────────────────────────────────────────────────────────────
// deriveRunView — Convert the workflow run store data + workflow
// definition + per-stage stream state into the RunView our redesigned
// UI consumes.
//
// This module is pure: no queries/subscriptions. All inputs are
// passed in. Called from a page-level useMemo.
// ────────────────────────────────────────────────────────────────

import type {
  WorkflowRunWithStages, StageRun, StageRunStatus, WorkflowRunStatus,
  StageDefinition, StageEdge, WorkflowRunPermissionMode,
} from '@generatorai/shared';
import { interpolateVariables } from '@generatorai/shared';
import type { StreamState } from '@/stores/streamStore.js';
import type { UsageInfo } from '@/components/chat/redesign/types.js';
import type { RunView, StageView, StageStatus, RunStatus, FileChange } from './types.js';
import { deriveTimeline, deriveAnswer, deriveSegments, countTools } from '@/components/agent/deriveTimeline.js';

// ── Status normalizers ────────────────────────────────────────

const STAGE_STATUS_MAP: Record<StageRunStatus, StageStatus> = {
  pending:        'pending',
  queued:         'queued',
  running:        'running',
  paused:         'paused',
  completed:      'completed',
  failed:         'failed',
  cancelled:      'cancelled',
  skipped:        'skipped',
  sleeping:       'sleeping',
  awaiting_input: 'awaiting_input',
};

const RUN_STATUS_MAP: Record<WorkflowRunStatus, RunStatus> = {
  created:    'pending',
  starting:   'starting',
  running:    'running',
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
  stages: StageDefinition[],
  edges: StageEdge[],
): Map<string, number> {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const s of stages) {
    inbound.set(s.id, []);
    outbound.set(s.id, []);
  }
  for (const e of edges) {
    if (!stageById.has(e.fromStageId) || !stageById.has(e.toStageId)) continue;
    inbound.get(e.toStageId)!.push(e.fromStageId);
    outbound.get(e.fromStageId)!.push(e.toStageId);
  }
  const depth = new Map<string, number>();
  // Frontier: stages with no inbound edges.
  const queue: string[] = [];
  for (const s of stages) {
    if ((inbound.get(s.id) ?? []).length === 0) {
      depth.set(s.id, 0);
      queue.push(s.id);
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
    if (!depth.has(s.id)) depth.set(s.id, 0);
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
  stages: StageDefinition[],
  edges: StageEdge[],
): Map<string, string[]> {
  const stageById = new Map(stages.map((s) => [s.id, s.name]));
  const map = new Map<string, string[]>();
  for (const s of stages) map.set(s.id, []);
  for (const e of edges) {
    const from = stageById.get(e.fromStageId);
    if (!from) continue;
    map.get(e.toStageId)?.push(from);
  }
  return map;
}

// ── File change from stage artifactManifest ────────────────────

function mapFile(entry: { path: string; action: string; sizeBytes: number }): FileChange {
  const kind: FileChange['kind'] =
    entry.action === 'created' ? 'added' :
    entry.action === 'deleted' ? 'deleted' :
    entry.action === 'renamed' ? 'renamed' :
    'modified';
  const size = entry.sizeBytes < 1024
    ? `${entry.sizeBytes}B`
    : entry.sizeBytes < 1024 * 1024
      ? `${(entry.sizeBytes / 1024).toFixed(1)}KB`
      : `${(entry.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  // artifactManifest entries come from persistStageArtifacts' fenced-code
  // extraction which writes to the run workspace — surface that so the file
  // viewer modal hits the right endpoint.
  return { path: entry.path, kind, size, source: 'workspace' };
}

// ── Live duration for a stage ──────────────────────────────────

function stageDuration(sr: StageRun): number | undefined {
  if (!sr.startedAt) return undefined;
  const start = new Date(sr.startedAt).getTime();
  const end = sr.completedAt ? new Date(sr.completedAt).getTime() : Date.now();
  return end - start;
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
    provider: stream.usage.provider,
  };
}

// ── Main entry point ───────────────────────────────────────────

export interface DeriveRunViewInput {
  run: WorkflowRunWithStages;
  /** Ordered list of stage definitions for this workflow (may be empty
   *  while the definition is still loading; degrades gracefully). */
  stageDefs: StageDefinition[];
  /** Ordered list of stage edges. */
  edges: StageEdge[];
  /** Live elapsed ms for the run (from workflowRunStore). */
  elapsedMs: number;
  /** streamStore state keyed by "stageRun:<id>" (subset selector). */
  streams: Record<string, StreamState | undefined>;
  /** Effective permission mode (from HitlPanel or run). */
  permissionMode?: WorkflowRunPermissionMode;
}

export function deriveRunView(input: DeriveRunViewInput): RunView {
  const { run, stageDefs, edges, elapsedMs, streams, permissionMode } = input;

  const stageDefById = new Map(stageDefs.map((s) => [s.id, s]));
  const depths = computeDepths(stageDefs, edges);
  const parallelPeers = computeParallelPeers(run.stageRuns);
  const dependsOnByDefId = computeDependsOn(stageDefs, edges);

  // Sort stage runs by (definition order, startedAt). Definition order
  // gives us a stable spine that matches the DAG; startedAt is a tie-
  // breaker for parallel siblings so they render in the order they
  // fired.
  const sorted = [...run.stageRuns].sort((a, b) => {
    const defA = stageDefById.get(a.stageDefinitionId);
    const defB = stageDefById.get(b.stageDefinitionId);
    const orderA = defA?.order ?? Infinity;
    const orderB = defB?.order ?? Infinity;
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

  const stages: StageView[] = sorted.map((sr, idx) => {
    const def = stageDefById.get(sr.stageDefinitionId);
    const stream = streams[`stageRun:${sr.id}`];
    const status = STAGE_STATUS_MAP[sr.status] ?? 'pending';
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
    const isActive = status === 'running' || status === 'awaiting_input';

    const steps = deriveTimeline(stream?.blocks, { active: !isTerminal });
    const stepsDone = steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
    const stepsTotal = Math.max(sr.totalSteps ?? 0, steps.length);

    const answer = deriveAnswer(stream?.blocks);
    const segments = deriveSegments(stream?.blocks, { active: !isTerminal });
    const parallelIds = parallelPeers.get(sr.id) ?? [];

    // Interrupt data → InlineHitlControls props
    let interrupt: StageView['interrupt'];
    if (status === 'awaiting_input' && sr.interruptData !== undefined && sr.interruptData !== null) {
      const raw = sr.interruptData;
      if (typeof raw === 'object' && raw != null && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>;
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
          reason: typeof raw === 'string' ? raw : 'The stage is waiting for your approval.',
        };
      }
    }

    // Files from stage's artifactManifest. Filter out legacy `unnamed.<ext>`
    // entries — historical runs (pre-fix) recorded every fenced code block
    // in the manifest even when the block had no filename, producing phantom
    // files that don't exist on disk.
    const files: FileChange[] | undefined =
      sr.artifactManifest && sr.artifactManifest.length > 0
        ? sr.artifactManifest
            .filter((e) => !/^unnamed\.[A-Za-z0-9]+$/.test(e.path))
            .map(mapFile)
        : undefined;

    // Sleep remaining
    let sleepRemainingMs: number | undefined;
    if (status === 'sleeping' && sr.wakeAt) {
      const remaining = new Date(sr.wakeAt).getTime() - Date.now();
      sleepRemainingMs = Math.max(0, remaining);
    }

    // Prompt from definition (first prompt's text). Interpolate `{{var}}`
    // placeholders against the run variables so the UI matches what actually
    // reached the model. Unresolved placeholders are left as-is on purpose so
    // authors can spot missing variables at a glance.
    const runVars = (run.variables ?? {}) as Record<string, unknown>;
    const rawPrompt = def?.prompts?.[0]?.text?.trim();
    const prompt = rawPrompt ? interpolateVariables(rawPrompt, runVars) : undefined;

    return {
      id: sr.id,
      order: def?.order ?? idx + 1,
      depth: depths.get(sr.stageDefinitionId) ?? 0,
      dependsOn: dependsOnByDefId.get(sr.stageDefinitionId) ?? [],
      name: sr.name,
      status,
      prompt,
      steps,
      stepsDone,
      stepsTotal,
      answer,
      segments,
      parallelWith: parallelIds.length > 0 ? parallelIds : undefined,
      durationMs: stageDuration(sr),
      interrupt,
      sleepRemainingMs,
      error: sr.error,
      summary: sr.summary,
      outputData: sr.outputData,
      files,
      hooks: undefined,
      usage: usageFrom(stream),
      contextUsage: stream?.contextUsage ?? undefined,
      sharedContext: !!sr.sessionId && (stageCountBySession.get(sr.sessionId) ?? 0) > 1,
      model: undefined,
    };
  });

  return {
    id: run.id,
    name: run.name,
    status: RUN_STATUS_MAP[run.status] ?? 'pending',
    startedAt: run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime(),
    elapsedMs,
    permissionMode: permissionMode ?? run.permissionMode ?? 'bypassPermissions',
    stages,
    error: run.error,
  };
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
