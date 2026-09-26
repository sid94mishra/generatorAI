// ────────────────────────────────────────────────────────────────
// Every workflow definition summary, for the redesign's read models (G-10
// stats, G-11 recent activity, G-13/G-15 project summary and runs, G-18
// search). The Workflow Overhaul's definition list is paged
// (`WorkflowDefinitionService.list` → `{ items, nextCursor }`); these read
// models aggregate over all of a project's (or every) definition, so this
// walks the cursor. Read-only: only the service's existing `list` is called.
// ────────────────────────────────────────────────────────────────

import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';

interface DefinitionLister {
  list(filter?: {
    projectId?: string | null;
    includeArchived?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: WorkflowDefinitionSummary[]; nextCursor?: string }>;
}

const PAGE = 200;
/** A defensive cap against a cursor chain that never ends (100,000 definitions). */
const MAX_PAGES = 500;

/**
 * All definition summaries, optionally of one project. Archived definitions
 * are included by default: their runs are still history (stats, activity,
 * project runs); search passes `includeArchived: false`.
 */
export async function listAllDefinitionSummaries(
  service: DefinitionLister,
  opts: { projectId?: string | undefined; includeArchived?: boolean } = {},
): Promise<WorkflowDefinitionSummary[]> {
  const out: WorkflowDefinitionSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await service.list({
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
      includeArchived: opts.includeArchived ?? true,
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}
