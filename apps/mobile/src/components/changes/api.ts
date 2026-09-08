// ────────────────────────────────────────────────────────────────
// Workspace endpoints client-core does not wrap yet.
//
// Commit, pull requests, manual checkpoints and the source-control status
// probe exist on the server (`apps/server/src/routes/workspaces.ts`,
// `routes/sourceControl.ts`) and web calls them through its
// HttpPlatformClient. client-core's `workspaces.*` stops at checkpoints, so
// these ride on the same authenticated fetch with the same error contract.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { ChangeSummary, WorkspaceCheckpoint } from '@generatorai/client-core';

import { useAuth } from '../../auth/AuthProvider';

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parse `{ error: { code, message } }` bodies; fall back to the status text. */
export async function requestJson<T>(fetchImpl: AuthedFetch, path: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.message) message = body.error.message;
      code = body?.error?.code;
    } catch {
      // Not JSON; the status line is the best we have.
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

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

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  state: string;
  head: string;
  base: string;
}

export interface WorkspaceExtras {
  /** `POST /api/workspaces/:id/commit` — stages everything and commits. */
  commit: (workspaceId: string, message?: string) => Promise<{ committed: boolean }>;
  /** `GET /api/source-control/status` — whether a PR provider is configured. */
  sourceControlStatus: () => Promise<{ activeProvider: string; enabled: boolean }>;
  /** `POST /api/workspaces/:id/pull-request`. */
  createPullRequest: (
    workspaceId: string,
    body: { title: string; body?: string; base?: string; head?: string; alias?: string; draft?: boolean },
  ) => Promise<PullRequestInfo>;
  /** `GET /api/workspaces/:id/pull-requests?alias=`. */
  pullRequests: (workspaceId: string, alias?: string) => Promise<{ provider: string; pullRequests: PullRequestInfo[] }>;
  /** `POST /api/workspaces/:id/checkpoints` — a manual snapshot. */
  createCheckpoint: (workspaceId: string, label?: string) => Promise<{ checkpoints: CheckpointRow[] }>;
  /** `GET /api/workspaces/:id/checkpoints` with the provenance fields intact. */
  checkpoints: (workspaceId: string) => Promise<{ workspaceId: string; checkpoints: CheckpointRow[] }>;
  /** `GET /api/workspaces/:id/changes?v=2&base=&head=` with `base`/`head` revision info. */
  changes: (workspaceId: string, params?: { base?: string; head?: string }) => Promise<ChangeSummaryV2>;
}

export function createWorkspaceExtras(fetchImpl: AuthedFetch): WorkspaceExtras {
  return {
    commit: (id, message) =>
      requestJson(fetchImpl, `/api/workspaces/${id}/commit`, json(message ? { message } : {})),
    sourceControlStatus: () => requestJson(fetchImpl, '/api/source-control/status'),
    createPullRequest: (id, body) => requestJson(fetchImpl, `/api/workspaces/${id}/pull-request`, json(body)),
    pullRequests: (id, alias = '.') =>
      requestJson(fetchImpl, `/api/workspaces/${id}/pull-requests?alias=${encodeURIComponent(alias)}`),
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
