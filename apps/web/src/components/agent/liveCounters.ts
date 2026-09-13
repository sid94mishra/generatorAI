// ────────────────────────────────────────────────────────────────
// liveCounters — "what is in flight right now", derived from stream blocks.
//
// During an orchestrator turn the transcript scrolls faster than anyone can
// read it, and the one question a user actually has — is anything still
// running, and how much — had no answer anywhere on screen. This turns the
// block model into that answer: a handful of integers a strip above the
// composer renders as "2 tools running · 3 sub-agents running · 1 pending".
//
// A PURE selector over blocks. It owns no clock and no store, so the same
// numbers can be asserted in a unit test and reused by mobile.
// ────────────────────────────────────────────────────────────────

import type { StreamBlock } from '@/stores/streamStore.js';

/** Tool names that ARE a sub-agent rather than a tool (SDK delegation tools). */
const SUBAGENT_TOOLS = new Set(['task', 'agent']);

/**
 * A background worker that exists but has not reported any activity yet.
 * `spawned` is the router's distinct pre-first-event state; see
 * `chat.background_task.spawned` in `eventRouter`.
 */
const PENDING_TASK_STATUSES = new Set(['spawned', 'pending', 'queued']);

/** Background-worker statuses that mean "still working". */
const RUNNING_TASK_STATUSES = new Set(['running']);

export interface LiveCounters {
  /** Ordinary tool calls still open (sub-agent tool calls excluded). */
  tools: number;
  /**
   * Sub-agents still running: in-process SDK sub-agents (a running `Task` /
   * `Agent` tool call) plus orchestrator background workers that have
   * reported activity.
   */
  subagents: number;
  /** Background workers spawned but not yet started. */
  pending: number;
  /** True when there is nothing at all to report. */
  idle: boolean;
}

export const EMPTY_COUNTERS: Readonly<LiveCounters> = Object.freeze({
  tools: 0,
  subagents: 0,
  pending: 0,
  idle: true,
});

/** Is this tool call one of the SDKs' delegation tools? */
function isSubagentTool(tool: string): boolean {
  return SUBAGENT_TOOLS.has(tool.toLowerCase());
}

/**
 * Count what is in flight.
 *
 * Nested tool calls (a sub-agent's own Read/Grep storm, which carry
 * `parentCallId`) are counted too: they are genuinely running work, and
 * omitting them made the strip read "1 sub-agent running" while eight tools
 * were open underneath it.
 */
export function computeLiveCounters(blocks: readonly StreamBlock[] | undefined): LiveCounters {
  if (!blocks || blocks.length === 0) return { ...EMPTY_COUNTERS };

  let tools = 0;
  let subagents = 0;
  let pending = 0;

  for (const b of blocks) {
    if (b.type === 'tool_call') {
      if (b.status !== 'running') continue;
      if (isSubagentTool(b.tool)) subagents += 1;
      else tools += 1;
      continue;
    }
    if (b.type === 'background_task') {
      if (RUNNING_TASK_STATUSES.has(b.status)) subagents += 1;
      else if (PENDING_TASK_STATUSES.has(b.status)) pending += 1;
    }
  }

  return { tools, subagents, pending, idle: tools === 0 && subagents === 0 && pending === 0 };
}

/**
 * Render the counters as the strip's one line, or `null` when there is
 * nothing to say (so the caller renders no strip rather than an empty one).
 */
export function formatLiveCounters(counters: LiveCounters): string | null {
  const parts: string[] = [];
  if (counters.tools > 0) {
    parts.push(`${counters.tools} tool${counters.tools === 1 ? '' : 's'} running`);
  }
  if (counters.subagents > 0) {
    parts.push(`${counters.subagents} sub-agent${counters.subagents === 1 ? '' : 's'} running`);
  }
  if (counters.pending > 0) parts.push(`${counters.pending} pending`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * How many background workers are running or pending — the Background Tasks
 * tab's count badge. Separate from `computeLiveCounters` because the tab
 * counts workers only, never in-process sub-agents or tools.
 */
export function countRunningBackgroundTasks(
  blocks: readonly StreamBlock[] | undefined,
): number {
  if (!blocks) return 0;
  let n = 0;
  for (const b of blocks) {
    if (b.type !== 'background_task') continue;
    if (RUNNING_TASK_STATUSES.has(b.status) || PENDING_TASK_STATUSES.has(b.status)) n += 1;
  }
  return n;
}
