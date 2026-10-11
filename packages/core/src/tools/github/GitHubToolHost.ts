// ────────────────────────────────────────────────────────────────
// GitHubToolHost — what the agent's GitHub tools do (D-146).
//
// Bound to a PROJECT: the repository is resolved from the project's
// codebases (their git remote → owner/repo, the connected account for that
// host → provider), never taken from the model. The token stays inside the
// provider; nothing here returns it. A tool names a codebase by alias only
// when the project has more than one GitHub repository.
// ────────────────────────────────────────────────────────────────

import {
  CloseIssueBodySchema,
  CreateIssueBodySchema,
  IssueCommentBodySchema,
  PullRequestMergeMethodSchema,
  type IssueComment,
  type IssueSummary,
  type MergePullRequestResult,
  type ProjectCodebase,
} from '@generatorai/shared';
import type { ISourceControlProvider } from '@generatorai/source-control';
import type { ResolvedCodebaseRemote, RepoSlugRef } from '../../services/scm/CodebaseRemoteResolver.js';
import { mergePullRequest } from '../../services/scm/mergePullRequest.js';

export interface GitHubToolHostDeps {
  codebases: { getByProjectId(projectId: string): Promise<ProjectCodebase[]> };
  resolver: { resolve(codebase: ProjectCodebase): Promise<ResolvedCodebaseRemote> };
}

/** A refusal the model can act on (pick a codebase, fix an argument, connect an account). */
export class GitHubToolRefusal extends Error {
  constructor(
    readonly code: 'NO_PROJECT' | 'NO_REPOSITORY' | 'AMBIGUOUS_CODEBASE' | 'UNKNOWN_CODEBASE' | 'INVALID_ARGUMENT' | 'NOT_FOUND',
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GitHubToolRefusal';
  }
}

interface Target {
  codebase: ProjectCodebase;
  slug: RepoSlugRef;
  provider: ISourceControlProvider;
}

/** Longest issue / comment body handed back to the model. */
const BODY_LIMIT = 12_000;
const clip = (text: string): string => (text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n…[truncated]` : text);

const positiveInt = (v: unknown, name: string): number => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new GitHubToolRefusal('INVALID_ARGUMENT', `${name} must be a positive integer`);
  }
  return n;
};

const firstIssue = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string => {
  const issue = error.issues[0];
  if (!issue) return 'invalid arguments';
  return issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message;
};

export class GitHubToolHost {
  constructor(private readonly deps: GitHubToolHostDeps) {}

  /** Whether the project has at least one codebase whose remote host is connected (the tools are bound only then). */
  async hasRepository(projectId: string): Promise<boolean> {
    const codebases = await this.deps.codebases.getByProjectId(projectId);
    for (const codebase of codebases) {
      const resolved = await this.deps.resolver.resolve(codebase).catch(() => null);
      if (resolved?.ok) return true;
    }
    return false;
  }

  async listIssues(
    projectId: string,
    args: { codebase?: string; state?: string; labels?: string[]; limit?: number },
  ): Promise<Record<string, unknown>> {
    const t = await this.target(projectId, args.codebase);
    const state = args.state === 'closed' || args.state === 'all' ? args.state : 'open';
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 30), 1), 100);
    const issues = await t.provider.listIssues({
      owner: t.slug.owner,
      repo: t.slug.repo,
      state,
      host: t.slug.host,
      ...(args.labels?.length ? { labels: args.labels } : {}),
    });
    return {
      ...this.where(t),
      state,
      count: Math.min(issues.length, limit),
      issues: issues.slice(0, limit).map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: i.labels,
        author: i.author,
        comments: i.comments,
        updatedAt: i.updatedAt,
        url: i.url,
      })),
    };
  }

  async getIssue(projectId: string, args: { codebase?: string; number: unknown }): Promise<Record<string, unknown>> {
    const t = await this.target(projectId, args.codebase);
    const number = positiveInt(args.number, 'number');
    const ref = { owner: t.slug.owner, repo: t.slug.repo, number, host: t.slug.host };
    const issue = await t.provider.getIssue(ref);
    if (!issue) throw new GitHubToolRefusal('NOT_FOUND', `${this.slugText(t)}#${number} is not an issue (missing, or a pull request)`);
    const comments = issue.comments > 0 ? await t.provider.listIssueComments(ref) : [];
    return { ...this.where(t), issue: this.issueOut(issue), comments: comments.map((c) => this.commentOut(c)) };
  }

  async createIssue(projectId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const parsed = CreateIssueBodySchema.safeParse({
      title: args['title'],
      ...(args['body'] !== undefined ? { body: args['body'] } : {}),
      ...(args['labels'] !== undefined ? { labels: args['labels'] } : {}),
    });
    if (!parsed.success) throw new GitHubToolRefusal('INVALID_ARGUMENT', firstIssue(parsed.error));
    const t = await this.target(projectId, typeof args['codebase'] === 'string' ? args['codebase'] : undefined);
    const issue = await t.provider.createIssue({
      owner: t.slug.owner,
      repo: t.slug.repo,
      host: t.slug.host,
      title: parsed.data.title,
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.labels?.length ? { labels: parsed.data.labels } : {}),
    });
    return { ok: true, ...this.where(t), issue: { number: issue.number, title: issue.title, url: issue.url, labels: issue.labels } };
  }

  async commentIssue(projectId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const number = positiveInt(args['number'], 'number');
    const parsed = IssueCommentBodySchema.safeParse({ body: args['body'] });
    if (!parsed.success) throw new GitHubToolRefusal('INVALID_ARGUMENT', firstIssue(parsed.error));
    const t = await this.target(projectId, typeof args['codebase'] === 'string' ? args['codebase'] : undefined);
    const comment = await t.provider.commentOnIssue(
      { owner: t.slug.owner, repo: t.slug.repo, number, host: t.slug.host },
      parsed.data.body,
    );
    return { ok: true, ...this.where(t), number, comment: { id: comment.id, url: comment.url } };
  }

  async closeIssue(projectId: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const number = positiveInt(args['number'], 'number');
    const parsed = CloseIssueBodySchema.safeParse({
      ...(args['reason'] !== undefined ? { reason: args['reason'] } : {}),
      ...(args['comment'] !== undefined ? { comment: args['comment'] } : {}),
    });
    if (!parsed.success) throw new GitHubToolRefusal('INVALID_ARGUMENT', firstIssue(parsed.error));
    const t = await this.target(projectId, typeof args['codebase'] === 'string' ? args['codebase'] : undefined);
    const ref = { owner: t.slug.owner, repo: t.slug.repo, number, host: t.slug.host };
    if (parsed.data.comment) await t.provider.commentOnIssue(ref, parsed.data.comment);
    const issue = await t.provider.closeIssue(ref, parsed.data.reason ? { reason: parsed.data.reason } : {});
    return { ok: true, ...this.where(t), issue: { number: issue.number, state: issue.state, stateReason: issue.stateReason, url: issue.url } };
  }

  async mergePullRequest(projectId: string, args: Record<string, unknown>): Promise<MergePullRequestResult & Record<string, unknown>> {
    const number = positiveInt(args['number'], 'number');
    const method = PullRequestMergeMethodSchema.safeParse(args['method'] ?? 'merge');
    if (!method.success) throw new GitHubToolRefusal('INVALID_ARGUMENT', 'method must be one of merge, squash, rebase');
    const t = await this.target(projectId, typeof args['codebase'] === 'string' ? args['codebase'] : undefined);
    const result = await mergePullRequest(
      t.provider,
      { owner: t.slug.owner, repo: t.slug.repo, number, host: t.slug.host },
      { method: method.data, deleteBranch: args['deleteBranch'] === true },
    );
    return { ok: true, ...this.where(t), number, ...result };
  }

  // ── helpers ──

  /**
   * The codebase a call is about: the named alias, else the project's only
   * codebase with a connected GitHub remote. Unresolvable codebases are
   * reported with their reason so the model can tell the user what to fix.
   */
  private async target(projectId: string, alias: string | undefined): Promise<Target> {
    if (!projectId) throw new GitHubToolRefusal('NO_PROJECT', 'This session does not belong to a project');
    const codebases = await this.deps.codebases.getByProjectId(projectId);
    const wanted = alias?.trim();
    if (wanted) {
      const codebase = codebases.find((c) => c.alias === wanted);
      if (!codebase) {
        throw new GitHubToolRefusal('UNKNOWN_CODEBASE', `No codebase "${wanted}" in this project`, {
          codebases: codebases.map((c) => c.alias),
        });
      }
      const resolved = await this.deps.resolver.resolve(codebase);
      if (!resolved.ok) throw new GitHubToolRefusal('NO_REPOSITORY', `${codebase.alias}: ${resolved.reason}`);
      return { codebase, slug: resolved.slug, provider: resolved.provider };
    }

    const usable: Target[] = [];
    const unavailable: Array<{ codebase: string; reason: string }> = [];
    for (const codebase of codebases) {
      const resolved = await this.deps.resolver.resolve(codebase);
      if (resolved.ok) usable.push({ codebase, slug: resolved.slug, provider: resolved.provider });
      else unavailable.push({ codebase: codebase.alias, reason: resolved.reason });
    }
    if (usable.length === 1) return usable[0]!;
    if (usable.length === 0) {
      throw new GitHubToolRefusal('NO_REPOSITORY', 'No codebase of this project has a connected GitHub repository', { unavailable });
    }
    throw new GitHubToolRefusal('AMBIGUOUS_CODEBASE', 'This project has several GitHub repositories: pass `codebase` (an alias)', {
      codebases: usable.map((u) => ({ alias: u.codebase.alias, repository: this.slugText(u) })),
    });
  }

  private slugText(t: Target): string {
    return `${t.slug.owner}/${t.slug.repo}`;
  }

  private where(t: Target): { codebase: string; repository: string } {
    return { codebase: t.codebase.alias, repository: this.slugText(t) };
  }

  private issueOut(i: IssueSummary): Record<string, unknown> {
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      ...(i.stateReason ? { stateReason: i.stateReason } : {}),
      labels: i.labels,
      author: i.author,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      url: i.url,
      body: clip(i.body),
    };
  }

  private commentOut(c: IssueComment): Record<string, unknown> {
    return { author: c.author, createdAt: c.createdAt, body: clip(c.body) };
  }
}

/** A tool result for any failure: `{ok: false, code?, error}` — the tools never throw on the host's account. */
export function githubToolError(err: unknown): Record<string, unknown> {
  if (err instanceof GitHubToolRefusal) return { ok: false, code: err.code, error: err.message, ...err.extra };
  const code = (err as { code?: unknown } | null)?.code;
  return { ok: false, ...(typeof code === 'string' ? { code } : {}), error: err instanceof Error ? err.message : String(err) };
}
