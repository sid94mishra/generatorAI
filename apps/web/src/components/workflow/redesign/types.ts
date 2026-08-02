// ────────────────────────────────────────────────────────────────
// Redesign sample — shared types (workflow run).
// Preview only. Feed mock data at /__redesign/workflow-run.
// ────────────────────────────────────────────────────────────────

import type { TimelineStep, UsageInfo } from '@/components/chat/redesign/types.js';
import type { ContextUsageSnapshot } from '@generatorai/client-core';
import type { StreamSegment } from '@/components/agent/deriveTimeline.js';

export type StageStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'paused'
  | 'awaiting_input'
  | 'sleeping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type RunStatus =
  | 'pending'
  | 'starting'
  | 'running'
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
  status: 'ok' | 'failed';
  durationMs: number;
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
  /** Currently-running-with (parallel batch peer stage ids). */
  parallelWith?: string[];
  /** Ms since started; live-updated by the preview. */
  durationMs?: number;
  /** Interrupt payload when status = awaiting_input. */
  interrupt?: {
    reason: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  /** Remaining sleep in ms (status = sleeping). */
  sleepRemainingMs?: number;
  /** Error message when status = failed. */
  error?: string;
  /** Summary passed to successor stages. */
  summary?: string;
  /** Structured output JSON. */
  outputData?: Record<string, unknown>;
  /**
   * Full stage output text sourced from the run scratchpad
   * (`scratchpad.json` on disk). This is the substantive Claude
   * response for the stage; `summary` is only a one-line reduction and
   * `outputData` only exists when the stage emitted a structured block.
   */
  outputText?: string;
  /** Files this stage touched. */
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
  /** Model used. */
  model?: string;
}

export interface RunView {
  id: string;
  name: string;
  status: RunStatus;
  startedAt: number;
  elapsedMs: number;
  permissionMode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  stages: StageView[];
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
