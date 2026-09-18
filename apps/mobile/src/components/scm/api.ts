// ────────────────────────────────────────────────────────────────
// Source-control endpoints (accounts, readiness, the flow, pull requests).
//
// Rides on the same authenticated fetch and the same error contract as
// `components/changes/api.ts` — `requestJson` parses `{ error: { code,
// message } }` bodies and throws `ApiError`, so every caller here can report
// the server's own reason instead of a status line.
//
// Contract: `.github/docs/feature-source-control.md` §2–§6. The shapes come
// from `@generatorai/shared` (`packages/shared/src/types/SourceControl.ts`),
// so this file never re-declares a server type — it only names the paths and
// the request bodies.
//
// Deliberately absent: `POST /api/source-control/accounts` (pasting a token
// would put a credential on the least trusted device in the chain). The
// GitHub device-code flow, where the SERVER holds the token, lives in
// `deviceLogin.ts` and `ConnectGitHubSheet.tsx`.
// ────────────────────────────────────────────────────────────────

import type {
  ProjectPullRequestsResponse,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  ScmFlowRequest,
  ScmFlowResult,
  ScmGenerateRequest,
  ScmGenerateResult,
  SourceControlSettings,
  SourceControlSettingsResponse,
  WorkspaceReadinessResponse,
} from '@generatorai/shared';

import { json, requestJson, type AuthedFetch } from '../../api/http';

/** `state` filter on the project pull-request list. */
export type PullRequestListState = 'open' | 'closed' | 'all';

export interface ReviewChatRequest {
  instructions?: string;
  model?: string;
  agentRef?: string;
}

/** `POST …/review-chat` answers with the created chat; only its id is needed. */
export interface ReviewChatResponse {
  chat: { id: string; name?: string };
}

export interface ScmApi {
  // ── Accounts / settings (§2) ──────────────────────────────────
  /** `GET /api/source-control/settings`. */
  settings: () => Promise<SourceControlSettingsResponse>;
  /** `PUT /api/source-control/settings` — mobile only ever sends `defaultAccountId`. */
  setDefaultAccount: (defaultAccountId: string | null) => Promise<SourceControlSettings>;
  /** `DELETE /api/source-control/accounts/:id` → 204. */
  disconnectAccount: (accountId: string) => Promise<void>;

  // ── Readiness + the flow (§3, §4) ─────────────────────────────
  /** `GET /api/workspaces/:id/scm/readiness[?alias=]`. */
  readiness: (workspaceId: string, alias?: string) => Promise<WorkspaceReadinessResponse>;
  /** `POST /api/workspaces/:id/scm/flow`. */
  flow: (workspaceId: string, body: ScmFlowRequest) => Promise<ScmFlowResult>;
  /** `POST /api/workspaces/:id/scm/generate` — the "Generate" buttons. */
  generate: (workspaceId: string, body: ScmGenerateRequest) => Promise<ScmGenerateResult>;
  /** `POST /api/workspaces/:id/scm/conflicts/resolve-with-agent`. */
  resolveConflictsWithAgent: (
    workspaceId: string,
    body: { alias: string; chatId: string },
  ) => Promise<{ ok?: boolean }>;
  /** `POST /api/workspaces/:id/scm/conflicts/continue`. */
  continueConflicts: (workspaceId: string, body: { alias: string }) => Promise<{ ok?: boolean }>;
  /** `POST /api/workspaces/:id/scm/conflicts/abort`. */
  abortConflicts: (workspaceId: string, body: { alias: string }) => Promise<{ ok?: boolean }>;

  // ── Pull requests under a project (§6) ────────────────────────
  /** `GET /api/projects/:id/pull-requests?state=`. */
  projectPullRequests: (
    projectId: string,
    state: PullRequestListState,
  ) => Promise<ProjectPullRequestsResponse>;
  /** `GET /api/projects/:id/codebases/:cid/pull-requests/:number`. */
  pullRequest: (projectId: string, codebaseId: string, number: number) => Promise<PullRequestDetail>;
  /** `GET …/pull-requests/:number/files`. */
  pullRequestFiles: (
    projectId: string,
    codebaseId: string,
    number: number,
  ) => Promise<PullRequestFile[]>;
  /** `GET …/pull-requests/:number/comments`. */
  pullRequestComments: (
    projectId: string,
    codebaseId: string,
    number: number,
  ) => Promise<PullRequestComment[]>;
  /** `POST …/pull-requests/:number/review-chat`. */
  reviewChat: (
    projectId: string,
    codebaseId: string,
    number: number,
    body: ReviewChatRequest,
  ) => Promise<ReviewChatResponse>;
}

const enc = encodeURIComponent;

function prPath(projectId: string, codebaseId: string, number: number): string {
  return `/api/projects/${enc(projectId)}/codebases/${enc(codebaseId)}/pull-requests/${number}`;
}

export function createScmApi(fetchImpl: AuthedFetch): ScmApi {
  return {
    settings: () => requestJson(fetchImpl, '/api/source-control/settings'),
    setDefaultAccount: (defaultAccountId) =>
      requestJson(fetchImpl, '/api/source-control/settings', json({ defaultAccountId }, 'PUT')),
    disconnectAccount: (accountId) =>
      requestJson(fetchImpl, `/api/source-control/accounts/${enc(accountId)}`, { method: 'DELETE' }),

    readiness: (workspaceId, alias) => {
      const q = alias ? `?alias=${enc(alias)}` : '';
      return requestJson(fetchImpl, `/api/workspaces/${enc(workspaceId)}/scm/readiness${q}`);
    },
    flow: (workspaceId, body) =>
      requestJson(fetchImpl, `/api/workspaces/${enc(workspaceId)}/scm/flow`, json(body)),
    generate: (workspaceId, body) =>
      requestJson(fetchImpl, `/api/workspaces/${enc(workspaceId)}/scm/generate`, json(body)),
    resolveConflictsWithAgent: (workspaceId, body) =>
      requestJson(
        fetchImpl,
        `/api/workspaces/${enc(workspaceId)}/scm/conflicts/resolve-with-agent`,
        json(body),
      ),
    continueConflicts: (workspaceId, body) =>
      requestJson(fetchImpl, `/api/workspaces/${enc(workspaceId)}/scm/conflicts/continue`, json(body)),
    abortConflicts: (workspaceId, body) =>
      requestJson(fetchImpl, `/api/workspaces/${enc(workspaceId)}/scm/conflicts/abort`, json(body)),

    projectPullRequests: (projectId, state) =>
      requestJson(fetchImpl, `/api/projects/${enc(projectId)}/pull-requests?state=${state}`),
    pullRequest: (projectId, codebaseId, number) =>
      requestJson(fetchImpl, prPath(projectId, codebaseId, number)),
    pullRequestFiles: (projectId, codebaseId, number) =>
      requestJson(fetchImpl, `${prPath(projectId, codebaseId, number)}/files`),
    pullRequestComments: (projectId, codebaseId, number) =>
      requestJson(fetchImpl, `${prPath(projectId, codebaseId, number)}/comments`),
    reviewChat: (projectId, codebaseId, number, body) =>
      requestJson(fetchImpl, `${prPath(projectId, codebaseId, number)}/review-chat`, json(body)),
  };
}

// ── Query keys ───────────────────────────────────────────────────
//
// One place, so an action that changes readiness can invalidate every view
// of it without each screen inventing its own key shape.

export const scmKeys = {
  settings: () => ['source-control', 'settings'] as const,
  /** Folded `chat.scm.result` events for one chat — see `scmResults.ts`. */
  chatResults: (chatId: string) => ['scm', 'chat-results', chatId] as const,
  readiness: (workspaceId: string) => ['scm', 'readiness', workspaceId] as const,
  projectPullRequests: (projectId: string, state: PullRequestListState) =>
    ['scm', 'project-prs', projectId, state] as const,
  pullRequest: (projectId: string, codebaseId: string, number: number) =>
    ['scm', 'pr', projectId, codebaseId, number] as const,
  pullRequestFiles: (projectId: string, codebaseId: string, number: number) =>
    ['scm', 'pr-files', projectId, codebaseId, number] as const,
  pullRequestComments: (projectId: string, codebaseId: string, number: number) =>
    ['scm', 'pr-comments', projectId, codebaseId, number] as const,
};
