// ────────────────────────────────────────────────────────────────
// Source-control contract — shared between server, web, desktop and mobile.
//
// One vocabulary for "connect a VCS host account", "is this mount ready to
// commit / push / open a PR and if not, why", the commit → sync → push → PR
// flow (with conflict reporting), pull-request browsing, generated commit /
// PR text, agent-native options on a chat, and opening a path in an editor.
// Tokens never appear in any of these shapes.
// ────────────────────────────────────────────────────────────────

/** VCS host providers. GitHub is the only implementation today; the union is the extension point. */
export type SourceControlProviderId = 'github';

export type SourceControlAuthMethod = 'token' | 'device' | 'gh-cli';

/** A connected account on a provider. The token lives in the secret store, keyed by `id`. */
export interface SourceControlAccount {
  id: string;
  provider: SourceControlProviderId;
  /** Display name, e.g. `octocat @ github.com`. */
  label: string;
  /** Enterprise host base URL (omit for the provider's public host). */
  host?: string;
  /** User login as reported by the host. */
  login?: string;
  /** The host's numeric user id and profile name: the default account commits as them when git has no identity (U-83). */
  userId?: number;
  displayName?: string;
  avatarUrl?: string;
  scopes?: string[];
  authMethod: SourceControlAuthMethod;
  createdAt: string;
}

export interface SourceControlProviderInfo {
  id: SourceControlProviderId;
  name: string;
  /** Which sign-in methods the server can run for this provider right now. */
  loginMethods: SourceControlAuthMethod[];
}

/** The editors "Open in" offers: VS Code and Cursor (owner, 2026-10-20). */
export type EditorId = 'vscode' | 'cursor';

export const EDITOR_IDS: readonly EditorId[] = ['vscode', 'cursor'];

export interface EditorInfo {
  id: EditorId;
  name: string;
  /** The server host can launch this editor (CLI found). */
  available: boolean;
  /** URL scheme for a browser-side fallback, e.g. `vscode`. */
  scheme: string;
}

/** Client-safe settings (no tokens). */
export interface SourceControlSettings {
  accounts: SourceControlAccount[];
  /** Account used when a repo's host matches more than one, or none match. */
  defaultAccountId: string | null;
  /** Model used to write commit messages and PR text. Null = heuristic text. */
  generation: { provider: string | null; model: string | null };
  editor: { defaultEditor: EditorId | null };
  /** Fallback base branch when a repo's default branch cannot be resolved. */
  defaultBase: string | null;
}

export interface SourceControlSettingsResponse {
  settings: SourceControlSettings;
  providers: SourceControlProviderInfo[];
  editors: EditorInfo[];
}

export interface DeviceLoginStart {
  loginId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceLoginStatus {
  loginId: string;
  status: 'pending' | 'complete' | 'expired' | 'error';
  account?: SourceControlAccount;
  error?: string;
}

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestSummary {
  provider: SourceControlProviderId;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  head: string;
  base: string;
  draft?: boolean;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'pending' | 'unknown';

export interface ChecksSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  conclusion: CheckConclusion;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  /** `null` while the host is still computing mergeability. */
  mergeable: boolean | null;
  mergeableState?: 'clean' | 'dirty' | 'blocked' | 'unstable' | 'behind' | 'unknown' | string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  headSha: string;
  baseSha: string;
  labels: string[];
  checks?: ChecksSummary;
}

export interface PullRequestFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  /** Unified diff hunk text (absent for binary / very large files). */
  patch?: string;
}

export interface PullRequestComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** Present for review comments anchored to a file line. */
  path?: string;
  line?: number;
  kind: 'review' | 'issue';
}

/** A PR row as listed under a project, with the codebase it belongs to. */
export interface ProjectPullRequest extends PullRequestSummary {
  codebaseId: string;
  codebaseAlias: string;
}

export interface ProjectPullRequestsResponse {
  items: ProjectPullRequest[];
  /** Codebases that could not be listed, with a user-facing reason. */
  unavailable: Array<{ codebaseId: string; alias: string; reason: string }>;
}

// ── Merging a pull request ──

/** How a pull request lands on its base: a merge commit, one squashed commit, or rebased commits. */
export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

/** `POST /api/projects/:id/codebases/:cid/pull-requests/:number/merge` body. */
export interface MergePullRequestRequest {
  method: PullRequestMergeMethod;
  /** Delete the head branch on the host once merged. */
  deleteBranch?: boolean;
  commitTitle?: string;
  commitMessage?: string;
}

export interface MergePullRequestResult {
  merged: boolean;
  /** The merge (or squash / last rebased) commit on the base branch. */
  sha?: string;
  /** The host's own message ("Pull Request successfully merged"). */
  message: string;
  /** Present when `deleteBranch` was asked for: true when the host deleted it, false when it was already gone. */
  branchDeleted?: boolean;
  /** Why the head branch could not be deleted (the merge itself succeeded). */
  branchDeleteError?: string;
}

// ── Issues ──

export type IssueState = 'open' | 'closed';

/** Why a closed issue was closed (GitHub's `state_reason`). */
export type IssueCloseReason = 'completed' | 'not_planned';

/** A host issue (never a pull request, even where the host lists both together). */
export interface IssueSummary {
  provider: SourceControlProviderId;
  number: number;
  title: string;
  /** Markdown; empty when the issue has no description. */
  body: string;
  state: IssueState;
  stateReason?: IssueCloseReason | 'reopened';
  labels: string[];
  author?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  /** Number of comments on the issue. */
  comments: number;
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
}

/** `GET /api/projects/:id/codebases/:cid/issues/:number`. */
export interface IssueDetailResponse {
  issue: IssueSummary;
  comments: IssueComment[];
}

/** An issue row as listed under a project, with the codebase it belongs to. */
export interface ProjectIssue extends IssueSummary {
  codebaseId: string;
  codebaseAlias: string;
}

export interface ProjectIssuesResponse {
  items: ProjectIssue[];
  /** Codebases that could not be listed, with a user-facing reason. */
  unavailable: Array<{ codebaseId: string; alias: string; reason: string }>;
}

/** `POST /api/projects/:id/codebases/:cid/issues` body. */
export interface CreateIssueRequest {
  title: string;
  body?: string;
  labels?: string[];
}

/** `POST …/issues/:number/close` body. */
export interface CloseIssueRequest {
  reason?: IssueCloseReason;
  /** Posted as a comment before the issue is closed. */
  comment?: string;
}

/** Everything the client needs to decide which SCM actions to offer for one mount. */
export interface RepoReadiness {
  alias: string;
  repoDir: string;
  isRepo: boolean;
  hasRemote: boolean;
  remoteUrl?: string;
  slug?: { owner: string; repo: string; host: string };
  providerId?: SourceControlProviderId;
  /** Account that will be used for host operations, when one matches. */
  accountId?: string;
  connected: boolean;
  branch: string | null;
  detached: boolean;
  /** The branch exists by name but has no commits yet (a fresh `git init`). */
  unborn?: boolean;
  defaultBranch: string | null;
  onDefaultBranch: boolean;
  dirty: boolean;
  changedFiles: number;
  /** Against the branch's own upstream (`origin/<branch>`), or the remote default branch before the first push. */
  ahead: number | null;
  behind: number | null;
  hasUpstream: boolean;
  /** How the branch stands against the remote default branch; absent on that branch or without a remote. */
  vsBase?: { branch: string; ahead: number; behind: number };
  mergeInProgress: boolean;
  /** The branch an in-progress merge brings in (from git's merge message); absent otherwise. */
  mergingFrom?: string;
  conflictedFiles: string[];
  /** Open PR whose head is the current branch, when one exists. */
  openPullRequest: PullRequestSummary | null;
  can: { commit: boolean; push: boolean; pullRequest: boolean };
  reasons: { commit?: string; push?: string; pullRequest?: string };
}

export interface WorkspaceReadinessResponse {
  workspaceId: string;
  repos: RepoReadiness[];
}

export interface ScmFlowRequest {
  /** Mount alias (`.` for the root). */
  alias?: string;
  commit?: { message?: string; generate?: boolean };
  push?: boolean;
  pullRequest?: {
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
    generate?: boolean;
    /** Logins asked to review once the PR is open (the author is skipped by the host). */
    reviewers?: string[];
    assignees?: string[];
    labels?: string[];
    /** Issues the PR closes: `Closes #n` lines are appended to the body (given or generated). */
    closesIssues?: number[];
  };
  /** Merge the base branch into the current branch before push/PR. Default true when pushing or opening a PR. */
  sync?: boolean;
  /** When on the default branch, cut a work branch first. Default true when pushing or opening a PR. */
  branch?: { createIfOnDefault?: boolean; name?: string };
  /** Hint for generated text (e.g. the chat's task description). */
  hint?: string;
}

export type ScmFlowStepId = 'readiness' | 'branch' | 'commit' | 'sync' | 'push' | 'pull_request';

export interface ScmFlowStep {
  id: ScmFlowStepId;
  status: 'done' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
}

export interface ScmConflictReport {
  base: string;
  head: string;
  files: string[];
  /** True when the merge was applied to the working tree and conflict markers are present. */
  mergeStarted: boolean;
}

export interface ScmFlowResult {
  status: 'ok' | 'conflicts' | 'blocked' | 'failed';
  alias: string;
  steps: ScmFlowStep[];
  branch?: string;
  commit?: { sha: string; message: string };
  pushed?: boolean;
  pullRequest?: PullRequestSummary;
  conflicts?: ScmConflictReport;
  error?: string;
  readiness: RepoReadiness;
}

export interface ScmGenerateRequest {
  alias?: string;
  kind: 'commit' | 'pull_request';
  hint?: string;
  /** Base branch for PR text (defaults to the repo default). */
  base?: string;
}

export interface ScmGenerateResult {
  kind: 'commit' | 'pull_request';
  message?: string;
  title?: string;
  body?: string;
  model?: string;
  source: 'model' | 'heuristic';
}

/** `GET /workspaces/:id/scm/branches` — the branches a PR can target, read from the remote. */
export interface ScmBranchList {
  alias: string;
  defaultBranch: string | null;
  /** The branch the work is on (never offered as a base). */
  current: string | null;
  /** Remote branch names, default first, then sorted. */
  branches: string[];
  /** False when the remote could not be reached and the list is the last fetched one. */
  fresh: boolean;
}

export interface ScmCommitEntry {
  sha: string;
  subject: string;
  author: string;
  /** ISO 8601. */
  date: string;
}

export interface ScmCompareFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

/**
 * `GET /workspaces/:id/scm/compare?base=` — what a pull request from the
 * current branch into `base` would contain, GitHub's "Comparing changes".
 */
export interface ScmCompareResult {
  alias: string;
  base: string;
  head: string | null;
  /** Commits on the branch that `base` lacks, newest first. */
  commits: ScmCommitEntry[];
  /** Files changed by those commits (merge base → HEAD). */
  files: ScmCompareFile[];
  additions: number;
  deletions: number;
  /** Commits on `base` the branch lacks; the flow merges them in before pushing. */
  behind: number;
  mergeable: 'clean' | 'conflicts' | 'unknown';
  conflictFiles: string[];
  /** Working-tree files not committed yet (a commit in the same run adds them). */
  uncommittedFiles: number;
}

export interface ScmPerson {
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface ScmLabel {
  name: string;
  /** Hex without `#`, as the host returns it. */
  color: string;
  description?: string;
}

/** `GET /workspaces/:id/scm/pull-request-options` — the PR sidebar's pickers. */
export interface ScmPullRequestOptions {
  alias: string;
  /** False when the host cannot be asked (no account, CLI-only auth); `reason` says why. */
  available: boolean;
  reason?: string;
  /** The connected account (can assign itself, cannot review its own PR). */
  viewer: string | null;
  /** People who can be assigned or asked to review. */
  people: ScmPerson[];
  labels: ScmLabel[];
  /** Open issues a PR can close. */
  issues: Array<{ number: number; title: string }>;
}

/** Agent-native options stored on a chat (and on workflow orchestrator config). */
export interface ChatSourceControlOptions {
  /** Commit the change set after every completed turn. */
  autoCommit: boolean;
  /** Push the work branch after committing. */
  autoPush: boolean;
  /** Open (once) a PR against the base branch after pushing. */
  autoPullRequest: boolean;
  /** Target branch; defaults to the repo default branch. */
  base?: string;
  draft?: boolean;
}

export interface OpenInEditorRequest {
  path: string;
  line?: number;
  column?: number;
  editor?: EditorId;
}

export interface OpenInEditorResult {
  ok: boolean;
  editor?: EditorId;
  /** For browsers: a URL the client can try when the server could not launch the editor. */
  fallbackUrl?: string;
  error?: string;
}

// ── Remote branch list before clone (mobile MG-11) ──

/** `POST /api/source-control/remote-refs` body. */
export interface RemoteRefsRequest {
  /** `https://`, `http://`, `ssh://`, `git://` or scp-style `user@host:path`. */
  url: string;
}

/**
 * The branches a Git remote advertises, read with `git ls-remote` before any
 * codebase exists — the add-codebase form's default-branch options. Errors:
 * `AUTH_REQUIRED`, `NOT_FOUND`, `TIMEOUT` (15 s), `INVALID_URL`.
 */
export interface RemoteRefs {
  /** The remote's HEAD branch, when it advertises one. */
  defaultBranch?: string;
  /** Branch names (without `refs/heads/`), default branch first, then sorted. At most 500. */
  branches: string[];
  /** True when the remote had more than 500 branches. */
  truncated: boolean;
}
