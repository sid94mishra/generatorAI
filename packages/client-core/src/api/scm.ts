// Source-control contracts shared by native and browser clients.
import type {
  DeviceLoginStart,
  DeviceLoginStatus,
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

type EndpointRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

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
  deviceLogin: {
    start: (host?: string) => Promise<DeviceLoginStart>;
    poll: (loginId: string) => Promise<DeviceLoginStatus>;
  };
  // ── Accounts / settings (§2) ──────────────────────────────────
  /** `GET /api/source-control/settings`. */
  settings: () => Promise<SourceControlSettingsResponse>;
  /** `PUT /api/source-control/settings` — updates only `defaultAccountId`. */
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

export function createScmMethods(request: EndpointRequest): ScmApi {
  return {
    deviceLogin: {
      start: (host) => request('/api/source-control/accounts/device/start',
        json({ provider: 'github', ...(host?.trim() ? { host: host.trim() } : {}) })),
      poll: (loginId) => request(`/api/source-control/accounts/device/${enc(loginId)}`),
    },
    settings: () => request('/api/source-control/settings'),
    setDefaultAccount: (defaultAccountId) =>
      request('/api/source-control/settings', json({ defaultAccountId }, 'PUT')),
    disconnectAccount: (accountId) =>
      request(`/api/source-control/accounts/${enc(accountId)}`, { method: 'DELETE' }),

    readiness: (workspaceId, alias) => {
      const q = alias ? `?alias=${enc(alias)}` : '';
      return request(`/api/workspaces/${enc(workspaceId)}/scm/readiness${q}`);
    },
    flow: (workspaceId, body) =>
      request(`/api/workspaces/${enc(workspaceId)}/scm/flow`, json(body)),
    generate: (workspaceId, body) =>
      request(`/api/workspaces/${enc(workspaceId)}/scm/generate`, json(body)),
    resolveConflictsWithAgent: (workspaceId, body) =>
      request(
        `/api/workspaces/${enc(workspaceId)}/scm/conflicts/resolve-with-agent`,
        json(body),
      ),
    continueConflicts: (workspaceId, body) =>
      request(`/api/workspaces/${enc(workspaceId)}/scm/conflicts/continue`, json(body)),
    abortConflicts: (workspaceId, body) =>
      request(`/api/workspaces/${enc(workspaceId)}/scm/conflicts/abort`, json(body)),

    projectPullRequests: (projectId, state) =>
      request(`/api/projects/${enc(projectId)}/pull-requests?state=${state}`),
    pullRequest: (projectId, codebaseId, number) =>
      request(prPath(projectId, codebaseId, number)),
    pullRequestFiles: (projectId, codebaseId, number) =>
      request(`${prPath(projectId, codebaseId, number)}/files`),
    pullRequestComments: (projectId, codebaseId, number) =>
      request(`${prPath(projectId, codebaseId, number)}/comments`),
    reviewChat: (projectId, codebaseId, number, body) =>
      request(`${prPath(projectId, codebaseId, number)}/review-chat`, json(body)),
  };
}

// ── Query keys ───────────────────────────────────────────────────
//
// One place, so an action that changes readiness can invalidate every view
// of it without each screen inventing its own key shape.

export const scmKeys = {
  settings: () => ['source-control', 'settings'] as const,
  /** Folded `chat.scm.result` events for one chat. */
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
