# Background task contracts: configuration fields

Generated from `packages/shared/src/config/OrchestratorSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## TaskBudgetSchema

Per-task budget the worker must respect.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| maxTokens | number | `optional` | int; min 0 (exclusive) |
| maxToolCalls | number | `optional` | int; min 0 (exclusive) |

## TaskBriefSchema

The self-contained brief the orchestrator hands to a background worker. All
per-task content lives here (NOT in the worker system prompt) so every
worker's tools+system prefix stays byte-identical and prompt-cache-shareable.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| taskName | string | `required` | min 1; max 120 |
| model | string | `optional` | min 1; max 120 |
| objective | string | `required` | min 1; max 8000 |
| context | string | `default ""` | max 20000 |
| inputArtifacts | array of string | `default []` | maxLength 20 |
| boundaries | string | `default ""` | max 4000 |
| sharedWorkspace | boolean | `default true` | — |
| budget | object | `optional` | unknown keys: strip |
| budget.maxTokens | number | `optional` | int; min 0 (exclusive) |
| budget.maxToolCalls | number | `optional` | int; min 0 (exclusive) |
| agentRef | string | `optional` | max 128 |

## TaskResultStatusSchema

Digest status returned by a worker.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "completed" / "failed" / "needs_input" / "partial" | `required` | — |

## TaskArtifactRefSchema

A single artifact reference in a digest.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| path | string | `required` | — |
| bytes | number | `optional` | int; min 0 |
| kind | string | `optional` | — |

## TaskResultDigestSchema

The compact digest returned to the orchestrator (never the full transcript).
Large output stays in workspace artifacts; only refs + summary cross back.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| status | "completed" / "failed" / "needs_input" / "partial" | `required` | — |
| summary | string | `default ""` | — |
| keyFindings | array of string | `default []` | — |
| artifacts | array of object | `default []` | — |
| artifacts[] | object | `required` | unknown keys: strip |
| artifacts[].path | string | `required` | — |
| artifacts[].bytes | number | `optional` | int; min 0 |
| artifacts[].kind | string | `optional` | — |
| risks | array of string | `default []` | — |
| openQuestions | array of string | `default []` | — |
| reviewHook | string | `optional` | — |
| converged | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete OrchestratorSchemas.ts source contract</summary>

```typescript
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
  /**
   * W24 fix — a worker's own signal that it has reached a stable end state
   * and needs no further follow-up this wave. `OrchestratorConfig.convergenceThreshold`
   * (packages/core/src/services/orchestrator/OrchestratorService.ts) reads
   * this field to decide whether the current wave has converged; before this
   * field existed there was nothing for a worker to set, so the threshold
   * config was declared and validated but structurally could never be
   * satisfied by anything other than `status === 'completed'`. Optional and
   * additive — a worker (or an older/other harness) that never sets it is
   * still evaluated via the `status === 'completed'` fallback.
   */
  converged: z.boolean().optional(),
});

export type TaskResultDigest = z.infer<typeof TaskResultDigestSchema>;
```

</details>
