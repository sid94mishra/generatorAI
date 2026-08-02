// ────────────────────────────────────────────────────────────────
// Ports — source-control provider interface + tiny infra ports
// ────────────────────────────────────────────────────────────────

import type {
  ChecksSummary,
  CreatePullRequestInput,
  ListPullRequestsInput,
  PullRequest,
  PullRequestRef,
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
