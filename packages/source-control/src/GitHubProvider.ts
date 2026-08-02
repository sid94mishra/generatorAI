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
  PullRequest,
  PullRequestRef,
  PullRequestState,
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
  head?: { ref?: string };
  base?: { ref?: string };
}

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
    const h = host ?? this.options.host;
    if (!h || /(^|\/\/)(www\.)?github\.com/.test(h)) {
      return 'https://api.github.com';
    }
    const clean = h.replace(/\/+$/, '');
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
