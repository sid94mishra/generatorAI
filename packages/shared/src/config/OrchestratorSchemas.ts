// ────────────────────────────────────────────────────────────────
// Orchestrator Mode — Zod schemas for the background-agent contract
//
// These define the wire shape of:
//   • the Task Brief   (orchestrator → worker; the spawn_background_agent arg)
//   • the Result Digest (worker → orchestrator; compact reference-based result)
//
// See docs/ORCHESTRATOR_MODE_RESEARCH_AND_PLAN.md §5.3 / §5.4.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** Per-task budget the worker must respect. */
export const TaskBudgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
}).optional();

/**
 * The self-contained brief the orchestrator hands to a background worker. All
 * per-task content lives here (NOT in the worker system prompt) so every
 * worker's tools+system prefix stays byte-identical and prompt-cache-shareable.
 */
export const TaskBriefSchema = z.object({
  /** Short, unique-ish task name shown in the UI. */
  taskName: z.string().min(1).max(120),
  /**
   * Model TIER or explicit model for the worker. Optional — falls back to the
   * configured default worker model. Validated against the active provider.
   */
  model: z.string().min(1).max(120).optional(),
  /** The ONE outcome this worker must produce. */
  objective: z.string().min(1).max(8000),
  /**
   * ONLY the facts/decisions the worker needs — self-contained, no "see above".
   * The worker inherits nothing else.
   */
  context: z.string().max(20000).optional().default(''),
  /** Read-only artifact paths the worker may open (references, not pasted content). */
  inputArtifacts: z.array(z.string().min(1).max(500)).max(20).optional().default([]),
  /** Explicit out-of-scope list to prevent overlap with sibling tasks. */
  boundaries: z.string().max(4000).optional().default(''),
  /**
   * Share the orchestrator's workspace (default true) so this worker's file
   * changes land in the SAME filesystem the orchestrator sees. Set false only
   * for a fully-isolated worker (e.g. throwaway exploration).
   */
  sharedWorkspace: z.boolean().optional().default(true),
  /** Per-task budget. */
  budget: TaskBudgetSchema,
  /**
   * Optional `scope:slug` ref of a custom agent that should drive this worker.
   * Validated against the orchestrator's team when it declares one.
   */
  agentRef: z.string().max(128).optional(),
});

export type TaskBrief = z.infer<typeof TaskBriefSchema>;

/** Digest status returned by a worker. */
export const TaskResultStatusSchema = z.enum([
  'completed',
  'failed',
  'needs_input',
  'partial',
]);

/** A single artifact reference in a digest. */
export const TaskArtifactRefSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative().optional(),
  kind: z.string().optional(),
});

/**
 * The compact digest returned to the orchestrator (never the full transcript).
 * Large output stays in workspace artifacts; only refs + summary cross back.
 */
export const TaskResultDigestSchema = z.object({
  status: TaskResultStatusSchema,
  summary: z.string().default(''),
  keyFindings: z.array(z.string()).optional().default([]),
  artifacts: z.array(TaskArtifactRefSchema).optional().default([]),
  risks: z.array(z.string()).optional().default([]),
  openQuestions: z.array(z.string()).optional().default([]),
  reviewHook: z.string().optional(),
});

export type TaskResultDigest = z.infer<typeof TaskResultDigestSchema>;
