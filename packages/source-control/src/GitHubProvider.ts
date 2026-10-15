// ────────────────────────────────────────────────────────────────
// GitHubProvider — GitHub REST API (token) with `gh` CLI fallback
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type {
  IScmHttpClient,
  IScmProcessRunner,
  ISourceControlProvider,
  ScmHttpResponse,
} from './ports.js';
import type {
  ChecksSummary,
  CheckConclusion,
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
  PullRequestState,
  PullRequestSummary,
} from './types.js';
import { ProviderNotConfiguredError, PullRequestNotMergeableError, SourceControlError } from './errors.js';

export interface GitHubProviderOptions {
  /** GitHub token (PAT / installation). When absent, REST calls are unavailable. */
  token?: string;
  /** Enterprise host base (e.g. `https://ghe.acme.com`). Omit for github.com. */
  host?: string;
  /** Enable the `gh` CLI fallback when no token is configured. Default true. */
  allowCliFallback?: boolean;
}

interface GitHubPr {
  number: number;
  html_url: string;
  title: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
}

interface GitHubPrDetail extends GitHubPr {
  body?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  labels?: Array<{ name?: string }>;
}

interface GitHubPrFile {
  filename: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface GitHubComment {
  id: number | string;
  body?: string | null;
  created_at?: string;
  html_url?: string;
  user?: { login?: string } | null;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  labels?: Array<{ name?: string } | string>;
  user?: { login?: string } | null;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  /** Present when the "issue" is a pull request (the issues API lists both). */
  pull_request?: unknown;
}

/**
 * One instance per connected account: `{ token, host }` identify the account,
 * so an Enterprise account and a github.com account are two providers.
 */
export class GitHubProvider implements ISourceControlProvider {
  readonly id = 'github' as const;
  private readonly allowCliFallback: boolean;

  constructor(
    private readonly http: IScmHttpClient,
    private readonly logger: ILogger,
    private readonly options: GitHubProviderOptions = {},
    private readonly processRunner?: IScmProcessRunner,
  ) {
    this.allowCliFallback = options.allowCliFallback ?? true;
  }

  /** Enterprise host base this provider was constructed for (undefined = github.com). */
  get host(): string | undefined {
    return this.options.host;
  }

  async isConfigured(): Promise<boolean> {
    if (this.options.token) return true;
    if (this.allowCliFallback && this.processRunner) {
      try {
        const res = await this.processRunner.run('gh', ['auth', 'status'], {
          cwd: process.cwd(),
          timeout: 5_000,
        });
        return res.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    if (this.options.token) {
      return this.createViaApi(input);
    }
    if (this.allowCliFallback && this.processRunner && input.repoDir) {
      return this.createViaCli(input);
    }
    throw new ProviderNotConfiguredError(
      'GitHub provider requires a token, or the `gh` CLI with a local repo directory',
    );
  }

  async getPullRequest(ref: PullRequestRef): Promise<PullRequest | null> {
    this.requireToken('getPullRequest');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status === 404) return null;
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('read the pull request', res));
    }
    return this.mapPr(JSON.parse(res.body) as GitHubPr);
  }

  async listPullRequests(input: ListPullRequestsInput): Promise<PullRequest[]> {
    this.requireToken('listPullRequests');
    const state = input.state ?? 'open';
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(input.host)}/repos/${input.owner}/${input.repo}/pulls?state=${state}&per_page=50`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('list pull requests', res));
    }
    const arr = JSON.parse(res.body) as GitHubPr[];
    return arr.map((pr) => this.mapPr(pr));
  }

  async getStatusChecks(ref: PullRequestRef): Promise<ChecksSummary> {
    this.requireToken('getStatusChecks');
    // Resolve the PR head sha first.
    const prRes = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (prRes.status >= 400) {
      throw new SourceControlError(describeFailure('read the pull request checks', prRes));
    }
    const pr = JSON.parse(prRes.body) as { head?: { sha?: string } };
    const sha = pr.head?.sha;
    if (!sha) return this.emptyChecks();

    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) return this.emptyChecks();
    const data = JSON.parse(res.body) as {
      check_runs?: Array<{ status: string; conclusion: string | null }>;
    };
    return this.summarizeChecks(data.check_runs ?? []);
  }

  // ── Account / repo metadata ──

  async getAuthenticatedUser(): Promise<ProviderUser> {
    this.requireToken('getAuthenticatedUser');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase()}/user`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('read the connected account', res));
    }
    const data = JSON.parse(res.body) as { login?: string; id?: number; name?: string | null; avatar_url?: string };
    const user: ProviderUser = { login: data.login ?? '' };
    if (typeof data.id === 'number') user.id = data.id;
    if (data.name) user.name = data.name;
    if (data.avatar_url) user.avatarUrl = data.avatar_url;
    // Classic PATs / OAuth tokens report their grants here; fine-grained PATs omit it.
    const scopes = parseScopeHeader(headerValue(res.headers, 'x-oauth-scopes'));
    if (scopes) user.scopes = scopes;
    return user;
  }

  async getRepository(owner: string, repo: string, host?: string): Promise<ProviderRepository> {
    this.requireToken('getRepository');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(host)}/repos/${owner}/${repo}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('read the repository', res));
    }
    const data = JSON.parse(res.body) as {
      default_branch?: string;
      private?: boolean;
      html_url?: string;
    };
    return {
      defaultBranch: data.default_branch ?? 'main',
      private: data.private ?? false,
      url: data.html_url ?? '',
    };
  }

  // ── Pull-request detail / files / comments ──

  /** Full PR detail. Checks are *not* fetched here — the caller composes them. */
  async getPullRequestDetail(ref: PullRequestRef): Promise<PullRequestDetail> {
    this.requireToken('getPullRequestDetail');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('read the pull request', res));
    }
    const pr = JSON.parse(res.body) as GitHubPrDetail;
    return {
      ...this.mapPr(pr),
      body: pr.body ?? '',
      mergeable: pr.mergeable ?? null,
      mergeableState: pr.mergeable_state ?? 'unknown',
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0,
      commits: pr.commits ?? 0,
      headSha: pr.head?.sha ?? '',
      baseSha: pr.base?.sha ?? '',
      labels: (pr.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
    };
  }

  async listPullRequestFiles(ref: PullRequestRef): Promise<PullRequestFile[]> {
    this.requireToken('listPullRequestFiles');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
      headers: this.headers(),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure("list the pull request's files", res));
    }
    const files = JSON.parse(res.body) as GitHubPrFile[];
    return files.map((f) => {
      const mapped: PullRequestFile = {
        path: f.filename,
        status: mapFileStatus(f.status),
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      };
      if (f.previous_filename) mapped.previousPath = f.previous_filename;
      if (f.patch !== undefined) mapped.patch = f.patch;
      return mapped;
    });
  }

  /** Review comments (anchored to a file line) + issue comments, merged oldest first. */
  async listPullRequestComments(ref: PullRequestRef): Promise<PullRequestComment[]> {
    this.requireToken('listPullRequestComments');
    const base = `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}`;
    const [reviewRes, issueRes] = await Promise.all([
      this.http.request({
        method: 'GET',
        url: `${base}/pulls/${ref.number}/comments?per_page=100`,
        headers: this.headers(),
        timeout: 20_000,
      }),
      this.http.request({
        method: 'GET',
        url: `${base}/issues/${ref.number}/comments?per_page=100`,
        headers: this.headers(),
        timeout: 20_000,
      }),
    ]);
    if (reviewRes.status >= 400) {
      throw new SourceControlError(describeFailure('read the review comments', reviewRes));
    }
    if (issueRes.status >= 400) {
      throw new SourceControlError(describeFailure('read the comments', issueRes));
    }
    const review = (JSON.parse(reviewRes.body) as GitHubComment[]).map((c) =>
      mapComment(c, 'review'),
    );
    const issue = (JSON.parse(issueRes.body) as GitHubComment[]).map((c) => mapComment(c, 'issue'));
    return [...review, ...issue].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * The open PR whose head branch is `headBranch`. Returns null when there is
   * none, and also when the host says the repo is missing or the token cannot
   * see it (404/401/403) — "no open PR" is the useful answer for readiness.
   */
  async findOpenPullRequestForHead(
    owner: string,
    repo: string,
    headBranch: string,
    host?: string,
  ): Promise<PullRequestSummary | null> {
    this.requireToken('findOpenPullRequestForHead');
    const head = `${owner}:${encodeURIComponent(headBranch)}`;
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(host)}/repos/${owner}/${repo}/pulls?state=open&head=${head}&per_page=1`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    if (res.status >= 400) {
      throw new SourceControlError(
        `GitHub findOpenPullRequestForHead failed (${res.status}): ${res.body}`,
      );
    }
    const arr = JSON.parse(res.body) as GitHubPr[];
    const first = arr[0];
    return first ? this.mapPr(first) : null;
  }

  // ── Merge ──

  async mergePullRequest(ref: PullRequestRef, input: MergePullRequestInput): Promise<MergePullRequestResult> {
    this.requireToken('mergePullRequest');
    const body: Record<string, unknown> = { merge_method: input.method };
    if (input.commitTitle) body['commit_title'] = input.commitTitle;
    if (input.commitMessage) body['commit_message'] = input.commitMessage;
    const res = await this.http.request({
      method: 'PUT',
      url: `${this.repoBase(ref)}/pulls/${ref.number}/merge`,
      headers: this.headers(),
      body: JSON.stringify(body),
      timeout: 30_000,
    });
    // 405: not mergeable (conflicts, required checks / reviews, protection,
    // a method the repo does not allow); 409: the head moved under us.
    if (res.status === 405 || res.status === 409) {
      throw new PullRequestNotMergeableError(
        `Pull request #${ref.number} cannot be merged: ${githubMessage(res.body) ?? 'the host refused the merge'}`,
      );
    }
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('merge the pull request', res));
    }
    const data = JSON.parse(res.body) as { sha?: string; merged?: boolean; message?: string };
    const result: MergePullRequestResult = {
      merged: data.merged ?? true,
      message: data.message ?? 'Pull request merged',
    };
    if (data.sha) result.sha = data.sha;
    return result;
  }

  async deleteBranch(owner: string, repo: string, branch: string, host?: string): Promise<boolean> {
    this.requireToken('deleteBranch');
    const refPath = branch.split('/').map(encodeURIComponent).join('/');
    const res = await this.http.request({
      method: 'DELETE',
      url: `${this.apiBase(host)}/repos/${owner}/${repo}/git/refs/heads/${refPath}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status === 204 || res.status === 200) return true;
    // "Reference does not exist": deleted already (the repo auto-deletes head branches).
    if (res.status === 404 || res.status === 422) return false;
    throw new SourceControlError(describeFailure(`delete the branch ${branch}`, res));
  }

  // ── Issues ──

  async listIssues(input: ListIssuesInput): Promise<IssueSummary[]> {
    this.requireToken('listIssues');
    const params = new URLSearchParams({ state: input.state ?? 'open', per_page: '100' });
    const labels = (input.labels ?? []).map((l) => l.trim()).filter(Boolean);
    if (labels.length > 0) params.set('labels', labels.join(','));
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(input.host)}/repos/${input.owner}/${input.repo}/issues?${params.toString()}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('list issues', res));
    }
    const arr = JSON.parse(res.body) as GitHubIssue[];
    return arr.filter((i) => !i.pull_request).map(mapIssue);
  }

  async getIssue(ref: IssueRef): Promise<IssueSummary | null> {
    this.requireToken('getIssue');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.repoBase(ref)}/issues/${ref.number}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure(`read issue #${ref.number}`, res));
    }
    const issue = JSON.parse(res.body) as GitHubIssue;
    return issue.pull_request ? null : mapIssue(issue);
  }

  async listIssueComments(ref: IssueRef): Promise<IssueComment[]> {
    this.requireToken('listIssueComments');
    const res = await this.http.request({
      method: 'GET',
      url: `${this.repoBase(ref)}/issues/${ref.number}/comments?per_page=100`,
      headers: this.headers(),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure(`read the comments on issue #${ref.number}`, res));
    }
    return (JSON.parse(res.body) as GitHubComment[])
      .map(mapIssueComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createIssue(input: CreateIssueInput): Promise<IssueSummary> {
    this.requireToken('createIssue');
    const body: Record<string, unknown> = { title: input.title };
    if (input.body) body['body'] = input.body;
    if (input.labels && input.labels.length > 0) body['labels'] = input.labels;
    const res = await this.http.request({
      method: 'POST',
      url: `${this.apiBase(input.host)}/repos/${input.owner}/${input.repo}/issues`,
      headers: this.headers(),
      body: JSON.stringify(body),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('create the issue', res));
    }
    return mapIssue(JSON.parse(res.body) as GitHubIssue);
  }

  async commentOnIssue(ref: IssueRef, body: string): Promise<IssueComment> {
    this.requireToken('commentOnIssue');
    const res = await this.http.request({
      method: 'POST',
      url: `${this.repoBase(ref)}/issues/${ref.number}/comments`,
      headers: this.headers(),
      body: JSON.stringify({ body }),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure(`comment on issue #${ref.number}`, res));
    }
    return mapIssueComment(JSON.parse(res.body) as GitHubComment);
  }

  async closeIssue(ref: IssueRef, input: CloseIssueInput = {}): Promise<IssueSummary> {
    this.requireToken('closeIssue');
    const res = await this.http.request({
      method: 'PATCH',
      url: `${this.repoBase(ref)}/issues/${ref.number}`,
      headers: this.headers(),
      body: JSON.stringify({ state: 'closed', state_reason: input.reason ?? 'completed' }),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure(`close issue #${ref.number}`, res));
    }
    return mapIssue(JSON.parse(res.body) as GitHubIssue);
  }

  // ── REST create ──

  private async createViaApi(input: CreatePullRequestInput): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      title: input.title,
      head: input.head,
    };
    if (input.body) body['body'] = input.body;
    if (input.draft) body['draft'] = true;
    body['base'] = input.base ?? (await this.resolveDefaultBranch(input.owner, input.repo, input.host));

    const res = await this.http.request({
      method: 'POST',
      url: `${this.apiBase(input.host)}/repos/${input.owner}/${input.repo}/pulls`,
      headers: this.headers(),
      body: JSON.stringify(body),
      timeout: 20_000,
    });
    if (res.status >= 400) {
      throw new SourceControlError(describeFailure('open the pull request', res));
    }
    return this.mapPr(JSON.parse(res.body) as GitHubPr);
  }

  private async resolveDefaultBranch(
    owner: string,
    repo: string,
    host?: string,
  ): Promise<string> {
    const res = await this.http.request({
      method: 'GET',
      url: `${this.apiBase(host)}/repos/${owner}/${repo}`,
      headers: this.headers(),
      timeout: 15_000,
    });
    if (res.status >= 400) return 'main';
    const data = JSON.parse(res.body) as { default_branch?: string };
    return data.default_branch ?? 'main';
  }

  // ── gh CLI fallback ──

  private async createViaCli(input: CreatePullRequestInput): Promise<PullRequest> {
    const args = ['pr', 'create', '--title', input.title, '--body', input.body ?? ''];
    if (input.base) args.push('--base', input.base);
    if (input.head) args.push('--head', input.head);
    if (input.draft) args.push('--draft');

    const res = await this.processRunner!.run('gh', args, {
      cwd: input.repoDir!,
      timeout: 60_000,
    });
    if (res.exitCode !== 0) {
      throw new SourceControlError(`gh pr create failed: ${res.stderr}`);
    }
    const url = res.stdout.trim();
    const match = url.match(/\/pull\/(\d+)/);
    const number = match?.[1] ? parseInt(match[1], 10) : 0;
    return {
      provider: 'github',
      number,
      url,
      title: input.title,
      state: 'open',
      head: input.head,
      base: input.base ?? '',
      draft: input.draft ?? false,
    };
  }

  // ── helpers ──

  private requireToken(op: string): void {
    if (!this.options.token) {
      throw new ProviderNotConfiguredError(`GitHub ${op} requires a configured token`);
    }
  }

  private repoBase(ref: { owner: string; repo: string; host?: string }): string {
    return `${this.apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}`;
  }

  private apiBase(host?: string): string {
    // The account's configured host is authoritative (it carries scheme and
    // port); a bare hostname parsed from a remote URL only fills in when the
    // provider was built without one.
    const raw = this.options.host ?? host;
    if (!raw || /(^|\/\/)(www\.)?github\.com/.test(raw)) {
      return 'https://api.github.com';
    }
    const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    const clean = withScheme.replace(/\/+$/, '');
    // Enterprise Server REST base is <host>/api/v3
    return clean.endsWith('/api/v3') ? clean : `${clean}/api/v3`;
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'GeneratorAI',
    };
  }

  private mapPr(pr: GitHubPr): PullRequest {
    let state: PullRequestState = 'open';
    if (pr.merged_at) state = 'merged';
    else if (pr.state === 'closed') state = 'closed';
    return {
      provider: 'github',
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      state,
      head: pr.head?.ref ?? '',
      base: pr.base?.ref ?? '',
      draft: pr.draft ?? false,
      author: pr.user?.login ?? undefined,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    };
  }

  private summarizeChecks(
    runs: Array<{ status: string; conclusion: string | null }>,
  ): ChecksSummary {
    let passed = 0;
    let failed = 0;
    let pending = 0;
    for (const r of runs) {
      if (r.status !== 'completed') {
        pending++;
      } else if (r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped') {
        passed++;
      } else {
        failed++;
      }
    }
    let conclusion: CheckConclusion = 'unknown';
    if (runs.length === 0) conclusion = 'neutral';
    else if (failed > 0) conclusion = 'failure';
    else if (pending > 0) conclusion = 'pending';
    else conclusion = 'success';
    return { total: runs.length, passed, failed, pending, conclusion };
  }

  private emptyChecks(): ChecksSummary {
    return { total: 0, passed: 0, failed: 0, pending: 0, conclusion: 'neutral' };
  }
}

// ── module helpers ──

/** Case-insensitive header lookup (http clients differ on casing). */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** `repo, workflow` → `['repo','workflow']`. Undefined when the header is absent. */
function parseScopeHeader(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const scopes = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes;
}

function mapFileStatus(status: string | undefined): PullRequestFile['status'] {
  switch (status) {
    case 'added':
    case 'copied':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    case 'modified':
    case 'changed':
      return 'modified';
    default:
      return 'modified';
  }
}

function mapComment(c: GitHubComment, kind: 'review' | 'issue'): PullRequestComment {
  const mapped: PullRequestComment = {
    id: String(c.id),
    author: c.user?.login ?? '',
    body: c.body ?? '',
    createdAt: c.created_at ?? '',
    kind,
  };
  if (c.html_url) mapped.url = c.html_url;
  if (kind === 'review') {
    if (c.path) mapped.path = c.path;
    const line = c.line ?? c.original_line;
    if (typeof line === 'number') mapped.line = line;
  }
  return mapped;
}

/** GitHub's own error text: `message` plus any field-level `errors[].message`. */
function githubMessage(body: string): string | undefined {
  try {
    const data = JSON.parse(body) as { message?: unknown; errors?: unknown };
    const parts: string[] = [];
    if (typeof data.message === 'string' && data.message.trim()) parts.push(data.message.trim());
    if (Array.isArray(data.errors)) {
      for (const e of data.errors) {
        const m = typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message;
        if (typeof m === 'string' && m.trim()) parts.push(m.trim());
      }
    }
    return parts.length > 0 ? parts.join(' — ') : undefined;
  } catch {
    return undefined;
  }
}

/** A readable sentence for a failed call: what we tried, why the host said no, and the fix when it is ours to name. */
const PERMISSION_LABEL: Record<string, string> = {
  pull_requests: 'Pull requests',
  contents: 'Contents',
  issues: 'Issues',
  metadata: 'Metadata',
  checks: 'Checks',
  statuses: 'Commit statuses',
  workflows: 'Workflows',
  actions: 'Actions',
};

/** `pull_requests=write; contents=read` → ['"Pull requests: Read and write"', '"Contents: Read-only"'] (the token page's wording). */
export function acceptedPermissions(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name = '', level = ''] = part.split('=').map((x) => x.trim());
      const label = PERMISSION_LABEL[name] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
      return `"${label}: ${level === 'write' ? 'Read and write' : level === 'read' ? 'Read-only' : level}"`;
    });
}

function describeFailure(action: string, res: ScmHttpResponse): string {
  const reason = githubMessage(res.body) ?? `HTTP ${res.status}`;
  if (res.status === 401) {
    return `GitHub could not ${action}: the connected account's token is invalid or expired — reconnect it in Settings → Source Control`;
  }
  if (res.status === 403) {
    // U-9: a fine-grained token missing a permission — GitHub names it in X-Accepted-GitHub-Permissions.
    const needed = acceptedPermissions(headerValue(res.headers ?? {}, 'x-accepted-github-permissions'));
    if (needed.length > 0) {
      return (
        `GitHub could not ${action}: the connected token lacks ${needed.join(' and ')} on this repository — ` +
        `edit the token on GitHub (Settings → Developer settings → Fine-grained tokens), then try again`
      );
    }
    return `GitHub could not ${action}: ${reason} (the connected account needs write access to this repository)`;
  }
  if (res.status === 404) {
    return `GitHub could not ${action}: not found, or the connected account cannot see this repository`;
  }
  if (res.status === 410) return `GitHub could not ${action}: issues are disabled for this repository`;
  return `GitHub could not ${action} (${res.status}): ${reason}`;
}

function mapIssue(i: GitHubIssue): IssueSummary {
  const issue: IssueSummary = {
    provider: 'github',
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    state: i.state === 'closed' ? 'closed' : 'open',
    labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    url: i.html_url,
    createdAt: i.created_at ?? '',
    updatedAt: i.updated_at ?? i.created_at ?? '',
    comments: i.comments ?? 0,
  };
  if (i.user?.login) issue.author = i.user.login;
  if (i.state_reason === 'completed' || i.state_reason === 'not_planned' || i.state_reason === 'reopened') {
    issue.stateReason = i.state_reason;
  }
  return issue;
}

function mapIssueComment(c: GitHubComment): IssueComment {
  const mapped: IssueComment = {
    id: String(c.id),
    author: c.user?.login ?? '',
    body: c.body ?? '',
    createdAt: c.created_at ?? '',
  };
  if (c.html_url) mapped.url = c.html_url;
  return mapped;
}
