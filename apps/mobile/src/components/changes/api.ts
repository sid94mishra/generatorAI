// ────────────────────────────────────────────────────────────────
// Workspace endpoints client-core does not wrap yet.
//
// Commit, manual checkpoints and the v2 change summary exist on the server
// (`apps/server/src/routes/workspaces.ts`) and web calls them through its
// HttpPlatformClient. client-core's `workspaces.*` stops at checkpoints, so
// these ride on the same authenticated fetch with the same error contract.
//
// The source-control half (readiness, the commit → PR flow, pull-request
// browsing) lives in `components/scm/api.ts`: committing on mobile now runs
// the whole flow, so the legacy `commit` and `pull-request` routes are not
// called from here any more.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { ChangeSummary, WorkspaceCheckpoint } from '@generatorai/client-core';

import { useAuth } from '../../auth/AuthProvider';
import { json, requestJson, type AuthedFetch } from '../../api/http';

// The primitives now live in `src/api/http.ts` so endpoints that must not
// pull in the auth provider (and the tests that exercise them) can use them.
// Re-exported here because this module has been their import site since v1.
export { ApiError, json, requestJson, type AuthedFetch } from '../../api/http';

/** The v2 summary carries which revisions it compared — the review anchors need their ids. */
export interface ChangeRevisionInfo {
  kind: 'baseline' | 'checkpoint' | 'working' | 'ref';
  id?: string;
  label?: string;
}

export type ChangeSummaryV2 = ChangeSummary & { base?: ChangeRevisionInfo; head?: ChangeRevisionInfo };

/** Checkpoint rows as the server actually returns them (client-core's type is the subset). */
export interface CheckpointRow extends WorkspaceCheckpoint {
  seq?: number;
  turnId?: string;
  phase?: 'before' | 'after';
  promptExcerpt?: string;
  additions?: number;
  deletions?: number;
  chatId?: string;
}

export interface WorkspaceExtras {
  /** `POST /api/workspaces/:id/checkpoints` — a manual snapshot. */
  createCheckpoint: (workspaceId: string, label?: string) => Promise<{ checkpoints: CheckpointRow[] }>;
  /** `GET /api/workspaces/:id/checkpoints` with the provenance fields intact. */
  checkpoints: (workspaceId: string) => Promise<{ workspaceId: string; checkpoints: CheckpointRow[] }>;
  /** `GET /api/workspaces/:id/changes?v=2&base=&head=` with `base`/`head` revision info. */
  changes: (workspaceId: string, params?: { base?: string; head?: string }) => Promise<ChangeSummaryV2>;
}

export function createWorkspaceExtras(fetchImpl: AuthedFetch): WorkspaceExtras {
  return {
    createCheckpoint: (id, label) =>
      requestJson(fetchImpl, `/api/workspaces/${id}/checkpoints`, json(label ? { label } : {})),
    checkpoints: (id) => requestJson(fetchImpl, `/api/workspaces/${id}/checkpoints`),
    changes: (id, params) => {
      const q = new URLSearchParams({ v: '2' });
      if (params?.base) q.set('base', params.base);
      if (params?.head) q.set('head', params.head);
      return requestJson(fetchImpl, `/api/workspaces/${id}/changes?${q}`);
    },
  };
}

export function useWorkspaceExtras(): WorkspaceExtras {
  const { fetch } = useAuth();
  return useMemo(() => createWorkspaceExtras(fetch), [fetch]);
}
