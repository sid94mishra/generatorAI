// ────────────────────────────────────────────────────────────────
// Source-control types — VCS-host (PR) provider abstraction
// ────────────────────────────────────────────────────────────────
//
// The client-facing shapes live in `@generatorai/shared`
// (`packages/shared/src/types/SourceControl.ts`) and are the contract the
// server, web, desktop and mobile clients all share. This module re-exports
// them under the names this package (and its existing call sites) use, so
// there is exactly one definition of each shape. Only the types that are
// purely internal to the provider port (`CreatePullRequestInput`,
// `PullRequestRef`, `ListPullRequestsInput`, `SourceControlConfig`,
// `ActiveProvider`) are declared here.

import type {
  ScmChecksSummary,
  ScmCheckConclusion,
  ScmProviderId,
  ScmPullRequestState,
  PullRequestSummary,
} from '@generatorai/shared';

// ── Shared contract re-exports (canonical names) ──

export type {
  DeviceLoginStart,
  DeviceLoginStatus,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  PullRequestSummary,
  SourceControlAccount,
  SourceControlAuthMethod,
  SourceControlProviderInfo,
  SourceControlSettings,
} from '@generatorai/shared';

/** Identifier of a source-control host provider. GitHub is the only one enabled for now. */
export type SourceControlProviderId = ScmProviderId;

/** Active provider selection — a provider id, or `none` (disabled). */
export type ActiveProvider = SourceControlProviderId | 'none';

export type PullRequestState = ScmPullRequestState;

export type CheckConclusion = ScmCheckConclusion;

/** Aggregate CI state for a pull request (shared shape, exported as `ScmChecksSummary`). */
export type ChecksSummary = ScmChecksSummary;

/**
 * A pull request as this package returns it. Structurally the shared
 * `PullRequestSummary`; kept under its historical name for existing call
 * sites (`SourceControlService`, the workspace routes).
 */
export type PullRequest = PullRequestSummary;

// ── Provider-port inputs (not part of the client contract) ──

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

/** The authenticated user behind a provider's credentials (never carries the token). */
export interface ProviderUser {
  login: string;
  avatarUrl?: string;
  scopes?: string[];
}

/** The host's view of a repository. */
export interface ProviderRepository {
  defaultBranch: string;
  private: boolean;
  url: string;
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
