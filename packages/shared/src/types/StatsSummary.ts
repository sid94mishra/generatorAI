// ────────────────────────────────────────────────────────────────
// Stats summary (G-10, docs/redesign/05-gap-matrix.md §G-10).
//
// `GET /api/stats/summary?from=&to=&projectId=&definitionId=&automationId=
// &groupBy=definition` — Home "This week", the Workflows stat strip,
// AutomationDetail's stat row and WorkflowDetail's rail. The client
// computes `from`/`to` in its own local time zone (the week starts per
// locale); the server does no default-range guessing.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
//
// D-36 / no fake data: `successRate`, `avgDurationMs` and
// `medianDurationMs` are omitted (not `0`) whenever their denominator is
// zero (no terminal runs, no timed runs) — a rate or average of nothing is
// not "0%", it is unknown. `chats.turns` (a per-chat cumulative turn
// counter) has no data source anywhere in the schema today (only the most
// RECENT turn is tracked, `ChatListActivity.lastTurn`) and is therefore
// left out of this shape entirely rather than invented.
// ────────────────────────────────────────────────────────────────

import type { WorkflowRunStatus } from './WorkflowRun.js';

export interface StatsSummaryQuery {
  /** ISO timestamp, inclusive. Required — the server never guesses a range. */
  from: string;
  /** ISO timestamp, inclusive. */
  to: string;
  projectId?: string;
  definitionId?: string;
  automationId?: string;
  /** Adds `byDefinition` (per-definition success rate + last run). */
  groupBy?: 'definition';
}

export interface StatsChatsSummary {
  /** Chats created within the range. */
  created: number;
}

export interface StatsRunsSummary {
  /** Every run in the range, any status. */
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** `succeeded / (succeeded + failed + cancelled)`. Absent when that's `0/0`. */
  successRate?: number;
  /** Over runs with both `startedAt` and `completedAt` in the range. Absent when none. */
  avgDurationMs?: number;
  medianDurationMs?: number;
}

export interface StatsAutomationsSummary {
  /** Executions in the range. */
  executions: number;
  succeeded: number;
  /** Over executions with both `startedAt` and `completedAt`. Absent when none. */
  avgDurationMs?: number;
}

export interface StatsByDefinitionRow {
  definitionId: string;
  /** The definition's most recent run, of any status, regardless of the range. Absent if it has never run. */
  lastRun?: { id: string; status: WorkflowRunStatus; startedAt?: string };
  /** Over this definition's runs in the range. Absent when it has none there. */
  successRate?: number;
}

export interface StatsSummary {
  range: { from: string; to: string };
  chats: StatsChatsSummary;
  runs: StatsRunsSummary;
  /** Present when the deployment has any automations (scoped by `projectId`/`automationId`). */
  automations?: StatsAutomationsSummary;
  /** Present only when `groupBy=definition` was requested. */
  byDefinition?: StatsByDefinitionRow[];
}
