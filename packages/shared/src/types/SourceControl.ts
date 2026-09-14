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

export type EditorId = 'vscode' | 'vscode-insiders' | 'cursor' | 'windsurf';

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
  defaultBranch: string | null;
  onDefaultBranch: boolean;
  dirty: boolean;
  changedFiles: number;
  ahead: number | null;
  behind: number | null;
  hasUpstream: boolean;
  mergeInProgress: boolean;
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
  pullRequest?: { title?: string; body?: string; base?: string; draft?: boolean; generate?: boolean };
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
