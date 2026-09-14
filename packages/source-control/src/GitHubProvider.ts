// ────────────────────────────────────────────────────────────────
// GitHubProvider — GitHub REST API (token) with `gh` CLI fallback
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type {
  IScmHttpClient,
  IScmProcessRunner,
  ISourceControlProvider,
} from './ports.js';
import type {
  ChecksSummary,
  CheckConclusion,
  CreatePullRequestInput,
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
import { ProviderNotConfiguredError, SourceControlError } from './errors.js';

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
      throw new SourceControlError(`GitHub getPullRequest failed (${res.status}): ${res.body}`);
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
      throw new SourceControlError(`GitHub listPullRequests failed (${res.status}): ${res.body}`);
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
      throw new SourceControlError(`GitHub getStatusChecks (pr) failed (${prRes.status})`);
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
      throw new SourceControlError(`GitHub getAuthenticatedUser failed (${res.status})`);
    }
    const data = JSON.parse(res.body) as { login?: string; avatar_url?: string };
    const user: ProviderUser = { login: data.login ?? '' };
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
      throw new SourceControlError(`GitHub getRepository failed (${res.status}): ${res.body}`);
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
      throw new SourceControlError(`GitHub getPullRequestDetail failed (${res.status}): ${res.body}`);
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
      throw new SourceControlError(`GitHub listPullRequestFiles failed (${res.status}): ${res.body}`);
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
      throw new SourceControlError(
        `GitHub listPullRequestComments (review) failed (${reviewRes.status})`,
      );
    }
    if (issueRes.status >= 400) {
      throw new SourceControlError(
        `GitHub listPullRequestComments (issue) failed (${issueRes.status})`,
      );
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
      throw new SourceControlError(`GitHub createPullRequest failed (${res.status}): ${res.body}`);
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
