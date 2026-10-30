// ────────────────────────────────────────────────────────────────
// The last commit / pull request a workspace produced through the SCM flow
// (mobile MG-13; Home "Recently finished" rows such as "PR #1176 opened").
//
// PR records are not stored anywhere (listing them is a live git-host call),
// so the flow route stamps its own outcome on the workspace's existing
// `metadata` JSON — no new table, no column. `GET /activity/recent` reads it
// back for the chat or run that owns the workspace.
// ────────────────────────────────────────────────────────────────

import type { ExecutionWorkspace, RecentActivityItem, ScmFlowResult } from '@generatorai/shared';

export const SCM_OUTCOME_KEY = 'scmOutcome';

export interface ScmOutcome {
  /** ISO timestamp of the flow run. */
  at: string;
  branch?: string;
  commit?: { sha: string };
  pullRequest?: { number: number; url: string };
}

interface WorkspaceMetadataRepo {
  findById(id: string): Promise<ExecutionWorkspace | null>;
  updateStatus(id: string, status: ExecutionWorkspace['status'], updates?: Partial<ExecutionWorkspace>): Promise<void>;
}

/** The outcome worth remembering from a flow result, or null when it committed and opened nothing. */
export function scmOutcomeFrom(result: ScmFlowResult, at: Date): ScmOutcome | null {
  if (!result.commit && !result.pullRequest) return null;
  return {
    at: at.toISOString(),
    ...(result.branch ? { branch: result.branch } : {}),
    ...(result.commit ? { commit: { sha: result.commit.sha } } : {}),
    ...(result.pullRequest ? { pullRequest: { number: result.pullRequest.number, url: result.pullRequest.url } } : {}),
  };
}

/** Best effort: a metadata write must never fail the flow the user just ran. */
export async function recordScmOutcome(repo: WorkspaceMetadataRepo, workspaceId: string, outcome: ScmOutcome): Promise<void> {
  try {
    const ws = await repo.findById(workspaceId);
    if (!ws) return;
    const previous = readScmOutcome(ws.metadata);
    // A later push without a new PR keeps the PR the workspace already opened.
    const merged: ScmOutcome = {
      ...outcome,
      ...(!outcome.pullRequest && previous?.pullRequest ? { pullRequest: previous.pullRequest } : {}),
    };
    await repo.updateStatus(workspaceId, ws.status, { metadata: { ...(ws.metadata ?? {}), [SCM_OUTCOME_KEY]: merged } });
  } catch {
    /* the flow result already reached the client */
  }
}

export function readScmOutcome(metadata: Record<string, unknown> | undefined): ScmOutcome | null {
  const raw = metadata?.[SCM_OUTCOME_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<ScmOutcome>;
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null;
  return value as ScmOutcome;
}

/**
 * The `pullRequest` / `commit` fields of an activity item whose work started
 * at `sinceMs`: only an outcome recorded at or after that moment belongs to
 * the item (MD-164).
 */
export function activityScmFields(
  outcome: ScmOutcome | null,
  sinceMs: number,
): Pick<RecentActivityItem, 'pullRequest' | 'commit'> {
  if (!outcome || Date.parse(outcome.at) < sinceMs) return {};
  return {
    ...(outcome.pullRequest ? { pullRequest: outcome.pullRequest } : {}),
    ...(outcome.commit && outcome.branch ? { commit: { branch: outcome.branch, sha: outcome.commit.sha } } : {}),
  };
}
