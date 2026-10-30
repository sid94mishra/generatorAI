// ────────────────────────────────────────────────────────────────
// Project-scoped workflow runs (G-15, docs/redesign/05-gap-matrix.md §G-15).
//
// `GET /api/projects/:id/runs` — the ProjectDetail Runs tab. `WorkflowRun`
// carries no `projectId` itself (the project belongs to the definition), so
// this is served from `/projects/:id/runs` rather than `/workflow-runs?
// projectId=` — `apps/server/src/routes/workflowRuns.ts` is Workflow-
// Overhaul-owned engine code (07-phases.md §"Running in parallel") and is
// never edited here; only its repositories' existing read methods are
// called, from a route this redesign track owns.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
// ────────────────────────────────────────────────────────────────

import type { WorkflowRun, WorkflowRunStatus } from './WorkflowRun.js';

/** One row of `GET /projects/:id/runs` — a run plus its definition's current name. */
export type ProjectRunListItem = WorkflowRun & { definitionName: string };

export interface ProjectRunListQuery {
  /** One or more statuses, any-of. Omitted = every status. */
  status?: WorkflowRunStatus | readonly WorkflowRunStatus[];
  /** `nextCursor` of the previous page, issued for the same project + status filter. */
  cursor?: string;
  /** Default 50, at most 200. */
  limit?: number;
}

/** Newest first (by `startedAt`, falling back to `createdAt`). */
export interface ProjectRunListPage {
  items: ProjectRunListItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Rows matching the status filter, across all pages. */
  total: number;
}
