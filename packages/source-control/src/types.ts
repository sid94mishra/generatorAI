// ────────────────────────────────────────────────────────────────
// Source-control types — VCS-host (PR) provider abstraction
// ────────────────────────────────────────────────────────────────

/** Identifier of a source-control host provider. GitHub is the only one enabled for now. */
export type SourceControlProviderId = 'github';

/** Active provider selection — a provider id, or `none` (disabled). */
export type ActiveProvider = SourceControlProviderId | 'none';

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequest {
  provider: SourceControlProviderId;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  head: string;
  base: string;
  draft?: boolean;
}

export interface CreatePullRequestInput {
  /** Repo owner / org (e.g. `acme`). */
  owner: string;
  /** Repo name (e.g. `web`). */
  repo: string;
  /** Source branch. */
  head: string;
  /** Target branch (defaults to the repo default when omitted). */
  base?: string;
  title: string;
  body?: string;
  draft?: boolean;
  /** Local repo directory — used only by the `gh` CLI fallback. */
  repoDir?: string;
  /** Enterprise host override (e.g. `https://ghe.acme.com`). */
  host?: string;
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  host?: string;
}

export interface ListPullRequestsInput {
  owner: string;
  repo: string;
  state?: PullRequestState | 'all';
  host?: string;
}

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'pending' | 'unknown';

export interface ChecksSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  conclusion: CheckConclusion;
}

/** Persisted configuration for the source-control feature. */
export interface SourceControlConfig {
  activeProvider: ActiveProvider;
  github?: {
    /** Personal-access / installation token (stored server-side only). */
    token?: string;
    /** Enterprise host base URL (omit for github.com). */
    host?: string;
    /** Default base branch for new PRs. */
    defaultBase?: string;
  };
}
