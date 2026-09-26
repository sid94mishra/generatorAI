// ────────────────────────────────────────────────────────────────
// Redesign sample — shared types (workflow run).
// Preview only. Feed mock data at /__redesign/workflow-run.
// ────────────────────────────────────────────────────────────────

import type { MapItemView, StageRunStatus } from '@generatorai/shared';
import type { TimelineStep, UsageInfo } from '@/components/chat/redesign/types.js';
import type { ContextUsageSnapshot } from '@generatorai/client-core';
import type { StreamSegment } from '@/components/agent/deriveTimeline.js';
import type { StreamBlock } from '@/stores/streamStore.js';

/**
 * The run page's visual stage states, normalized from the v2 instance states:
 * `ready` covers ready/starting, `running` covers validating, `waiting`
 * covers waiting/retry_wait.
 */
export type StageStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type RunStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'finalizing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface FileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  size?: string;
  /** Which underlying store the file lives in — used by the file viewer
   *  modal to pick the right download / content endpoint. Defaults to
   *  'workspace' when omitted (historical manifest entries). */
  source?: 'workspace' | 'artifacts' | 'uploads' | 'worktree';
}

export interface HookInvocation {
  id: string;
  phase: string;
  type: 'script' | 'http' | 'function';
  name: string;
  /** 'running' until the matching hook.completed/hook.failed event lands. */
  status: 'running' | 'ok' | 'failed';
  /** Absent while status is 'running' — never invent a duration. */
  durationMs?: number;
}

export interface StageView {
  id: string;
  order: number;
  /** Zero-based indent level for fan-out rendering in the spine. */
  depth: number;
  /** Ids of stages this one depends on (predecessors). */
  dependsOn: string[];
  name: string;
  status: StageStatus;
  /** The instance's engine state (what the commands and the stage conversation accept). */
  rawStatus: StageRunStatus;
  /** `triage`, `review_loop#2/fix`: what a fork's `rerunFrom` names. */
  instancePath: string;
  /** When an operator follow-up last amended this completed stage's output (PD-4). */
  amendedAt?: number;
  /** A turn of this stage is streaming now (including an amendment of a completed stage). */
  streaming?: boolean;
  /** Optional short prompt to show at the top of the card. */
  prompt?: string;
  /** Steps for the ActivityTimeline (chat primitive). */
  steps: TimelineStep[];
  stepsDone: number;
  stepsTotal: number;
  /** Assistant answer (streams while running). */
  answer: string;
  /** Ordered steps ↔ answer ↔ widget segments preserving the temporal
   *  sequence the agent emitted them (interleaved prose + tool calls). */
  segments: StreamSegment[];
  /** The stage's widget blocks (inline ones render in its transcript; `stageRun:<id>` owns them). */
  widgets: Array<Extract<StreamBlock, { type: 'widget' }>>;
  /** The stage's key in the pinned graph (its history across runs is by key). */
  stageKey: string;
  /** A `ready` instance waiting for a launch slot: the flow key at its limit (P07 WP-7.2). */
  admission?: { flowKey: string; label: string; running: number; limit: number | null; queued: number };
  /** Currently-running-with (parallel batch peer stage ids). */
  parallelWith?: string[];
  /** How long a finished stage ran (running stages have none: the run header holds the one clock). */
  durationMs?: number;
  /** Interrupt payload when status = awaiting_input. */
  interrupt?: {
    reason: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  /** Error message when status = failed. */
  error?: string;
  /** Summary passed to successor stages. */
  summary?: string;
  /** Structured output JSON. */
  outputData?: Record<string, unknown>;
  /**
   * The stage's output text (`stage_runs.output_text`): the latest answer
   * of its prompt, repair and revision turns, or of an amendment.
   */
  outputText?: string;
  /**
   * Files this stage changed, from its checkpoint to the next one (D-22).
   * Only the focused stage's are fetched.
   */
  files?: FileChange[];
  /** Hook invocations. */
  hooks?: HookInvocation[];
  /** Usage stats after complete. */
  usage?: UsageInfo;
  /**
   * Context-window snapshot for the conversation this stage ran in.
   *
   * In `single` / `auto` session modes several stages share one conversation,
   * so this describes the SHARED window rather than the stage's own token
   * spend — `usage` is the per-stage figure. Keeping them separate stops a
   * stage's turn delta from being rendered as if it were the whole context.
   */
  contextUsage?: ContextUsageSnapshot;
  /**
   * True when this stage shares its conversation with other stages in the run
   * (`single` / `auto` session modes).
   *
   * Derived from the stage runs themselves rather than the run's configured
   * mode, so it reflects what actually happened. It matters for the context
   * gauge: in a shared session `contextUsage` describes the WHOLE run's
   * window, not this stage's own spend, and saying so avoids implying the
   * stage alone filled it.
   */
  sharedContext?: boolean;
  /** The node kind (`agent`, `check`, `loop`, P05). */
  kind?: string;
  /** A loop body instance: the enclosing loop instance's id (`scopeId`). */
  loopId?: string;
  /** A loop body instance: its iteration (0-based); absent on a wrap-up. */
  iterationIndex?: number;
  /** A loop's wrap-up instance (`<loop>#wrapup/<stage>`). */
  wrapUp?: boolean;
  /** A loop instance: its badge, rules, streaks and pending decision. */
  loop?: LoopView;
  /** A map body instance: the item it belongs to (P05 §4.1). */
  itemIndex?: number;
  itemKey?: string;
  /** A map instance: its items. */
  map?: MapView;
  /** A wait instance: what it waits for (P05 §4.3). */
  wait?: WaitView;
  /** A sub-workflow instance: its child run (P05 §4.2). */
  subworkflow?: { phase: string; childRunId: string | null };
  /** The stage declares compensation actions (run, last completed first, when the run fails or is cancelled). */
  compensates?: boolean;
}

/** A map instance as the run page shows it (from `mapState` and the pinned spec). */
export interface MapView {
  phase: string;
  count: number;
  /** Items settled (completed, failed or cancelled). */
  done: number;
  failed: number;
  concurrency?: number;
  workspace?: string;
  merge?: string;
  toleratedFailurePercent?: number;
  items: MapItemView[];
}

/** A wait instance: its question while it waits, its outcome once resolved. */
export interface WaitView {
  type: 'approval' | 'event' | 'timer';
  label?: string;
  prompt?: string;
  /** JSON Schema of the approver's input. */
  form?: Record<string, unknown>;
  eventKey?: string;
  /** When the timer or the timeout fires (epoch ms). */
  until?: number;
  onTimeout?: string;
  callback?: { url: string; token: string };
  /** The resolved wait's output. */
  outcome?: { outcome: string; data: unknown; by: string | null; at: number };
}

/** One exit rule of a loop with its current streak. */
export interface LoopRuleView {
  reason: string;
  action: string;
  consecutive: number;
  streak: number;
  when?: string;
}

/** What a parked loop asks the operator (`interruptData.kind === 'loop_decision'`). */
export interface LoopDecisionView {
  /** `pause` (a pause rule fired) or `exhaust` (the limit was reached). */
  action: string;
  reason: string;
  /** The last finished iteration (0-based). */
  k: number;
  iterations: number;
  maxIterations: number;
  usage: { turns?: number; costUsd?: number; inputTokens?: number; outputTokens?: number };
  budget: { maxTurns?: number; maxCostUsd?: number; maxTokens?: number; maxWallClockMs?: number };
  /** Iterations with a workspace checkpoint (accept_iteration can restore them). */
  checkpoints: number[];
  scores: Array<{ k: number; score: number | null }>;
}

/** A loop instance as the run page shows it (from `loopState` and the pinned spec). */
export interface LoopView {
  /** The current (or last) iteration, 0-based; -1 before the first one starts. */
  k: number;
  /** The effective maximum (the spec's, plus granted iterations). */
  max: number;
  phase: string;
  rules: LoopRuleView[];
  exitReason: string | null;
  exitAction: string | null;
  operatorInput: { text: string; forIteration: number } | null;
  /** Set while the loop is parked for an operator decision. */
  decision?: LoopDecisionView;
}

export interface RunView {
  id: string;
  name: string;
  status: RunStatus;
  startedAt: number;
  /** Set once the run is terminal; the header's clock stops here. */
  completedAt?: number;
  permissionMode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  stages: StageView[];
  /** The stages outside any loop, in order: what the timeline, pipeline and header list. */
  topLevel: StageView[];
  /** A loop's or a map's body instances (every iteration, the wrap-up, every item), by the container's id. */
  loopBodies: Record<string, StageView[]>;
  /** The finalize `compensate` phase, once it ran (a failed or cancelled run). */
  compensation?: { status: 'done' | 'failed'; detail?: string; at: number };
  /** Optional run-level error. */
  error?: string;
}

/** Groups stages into runs of "parallel siblings" for the center pane. */
export interface StageGroup {
  kind: 'single' | 'parallel';
  stages: StageView[];
}

export function groupParallel(stages: StageView[]): StageGroup[] {
  const groups: StageGroup[] = [];
  let current: StageView[] = [];
  for (const s of stages) {
    if ((s.parallelWith?.length ?? 0) > 0) {
      // A parallel batch is all consecutive stages that share the same
      // set of `parallelWith` ids OR whose ids appear in `parallelWith`
      // of their neighbours.
      if (current.length === 0) {
        current.push(s);
      } else {
        const prev = current[current.length - 1]!;
        const peers = new Set([prev.id, ...(prev.parallelWith ?? [])]);
        if (peers.has(s.id) || (s.parallelWith ?? []).some((p) => peers.has(p))) {
          current.push(s);
        } else {
          groups.push({ kind: current.length > 1 ? 'parallel' : 'single', stages: current });
          current = [s];
        }
      }
    } else {
      if (current.length > 0) {
        groups.push({ kind: current.length > 1 ? 'parallel' : 'single', stages: current });
        current = [];
      }
      groups.push({ kind: 'single', stages: [s] });
    }
  }
  if (current.length > 0) {
    groups.push({ kind: current.length > 1 ? 'parallel' : 'single', stages: current });
  }
  return groups;
}
