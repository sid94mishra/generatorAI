// ────────────────────────────────────────────────────────────────
// Ports — source-control provider interface + tiny infra ports
// ────────────────────────────────────────────────────────────────

import type { ScmLabel, ScmPerson } from '@generatorai/shared';
import type {
  ChecksSummary,
  CloseIssueInput,
  CreateIssueInput,
  CreatePullRequestInput,
  IssueComment,
  IssueRef,
  IssueSummary,
  ListIssuesInput,
  MergePullRequestInput,
  MergePullRequestResult,
  ListPullRequestsInput,
  ProviderRepository,
  ProviderUser,
  PullRequest,
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  PullRequestRef,
  PullRequestSummary,
  SourceControlProviderId,
} from './types.js';

/** A VCS host provider (GitHub, GitLab, …). GitHub is the only impl for now. */
export interface ISourceControlProvider {
  readonly id: SourceControlProviderId;
  /** Whether the provider has valid credentials configured. */
  isConfigured(): Promise<boolean>;
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequest>;
  getPullRequest(ref: PullRequestRef): Promise<PullRequest | null>;
  listPullRequests(input: ListPullRequestsInput): Promise<PullRequest[]>;
  getStatusChecks(ref: PullRequestRef): Promise<ChecksSummary>;

  /** The account behind the configured credentials — login, avatar and granted scopes. */
  getAuthenticatedUser(): Promise<ProviderUser>;
  /** Host metadata for one repository. */
  getRepository(owner: string, repo: string, host?: string): Promise<ProviderRepository>;
  /** Full PR detail (body, mergeability, diff stats, labels). Checks are composed by the caller. */
  getPullRequestDetail(ref: PullRequestRef): Promise<PullRequestDetail>;
  /** Files changed by a PR, with unified-diff patches when the host provides them. */
  listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]>;
  /** Review + issue comments on a PR, merged and sorted oldest first. */
  listPullRequestComments(ref: PullRequestRef): Promise<PullRequestComment[]>;
  /** The open PR whose head is `headBranch`, or null when there is none (or no access). */
  findOpenPullRequestForHead(
    owner: string,
    repo: string,
    headBranch: string,
    host?: string,
  ): Promise<PullRequestSummary | null>;

  /**
   * Merge a pull request. A PR the host refuses to merge (conflicts, required
   * checks or reviews, a stale head) throws `PullRequestNotMergeableError`
   * carrying the host's reason.
   */
  mergePullRequest(ref: PullRequestRef, input: MergePullRequestInput): Promise<MergePullRequestResult>;
  /** Delete a branch on the host. False when it does not exist (already deleted). */
  deleteBranch(owner: string, repo: string, branch: string, host?: string): Promise<boolean>;

  // ── Issues (pull requests are never returned, even where the host lists them together) ──
  listIssues(input: ListIssuesInput): Promise<IssueSummary[]>;
  /** The issue, or null when there is none (or the number is a pull request). */
  getIssue(ref: IssueRef): Promise<IssueSummary | null>;
  /** Comments on an issue, oldest first. */
  listIssueComments(ref: IssueRef): Promise<IssueComment[]>;
  createIssue(input: CreateIssueInput): Promise<IssueSummary>;
  commentOnIssue(ref: IssueRef, body: string): Promise<IssueComment>;
  closeIssue(ref: IssueRef, input?: CloseIssueInput): Promise<IssueSummary>;

  // ── Pull-request metadata (the PR form's sidebar) ──
  /** People who can be assigned to (and asked to review) the repository's PRs and issues. */
  listAssignableUsers(owner: string, repo: string, host?: string): Promise<ScmPerson[]>;
  listLabels(owner: string, repo: string, host?: string): Promise<ScmLabel[]>;
  /**
   * Request reviewers, add assignees and labels on an open PR. Each part is
   * tried on its own; what failed comes back as one line per part, never thrown,
   * because the PR itself is already open.
   */
  addPullRequestMetadata(ref: PullRequestRef, meta: PullRequestMetadata): Promise<string[]>;
}

export interface PullRequestMetadata {
  reviewers?: string[];
  assignees?: string[];
  labels?: string[];
}

/** Minimal HTTP port (structurally compatible with core's IHttpClient). */
export interface ScmHttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface ScmHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface IScmHttpClient {
  request(options: ScmHttpRequestOptions): Promise<ScmHttpResponse>;
}

/** Minimal process runner (for the optional `gh` CLI fallback). */
export interface ScmProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface IScmProcessRunner {
  run(
    command: string,
    args: string[],
    options: { cwd: string; timeout?: number; env?: Record<string, string> },
  ): Promise<ScmProcessRunResult>;
}
