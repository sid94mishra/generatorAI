// ────────────────────────────────────────────────────────────────
// buildGitHubToolSet — the agent's GitHub issue + merge tools (D-146).
//
// Bound by the PlatformToolBinder into project chats and stages whose
// project has a codebase with a connected GitHub remote. Reads run unasked;
// the issue writes ask through the session's permission gate when the turn's
// mode asks ("Ask before tools run", "Accept edits"); merging a pull request
// ALWAYS asks a person, whatever the mode, and is refused where nobody can
// be asked. Every write is refused while planning. The gating is applied by
// the binder (`askBeforeActing`); this module only declares the tools.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { githubToolError, type GitHubToolHost } from './GitHubToolHost.js';

export { GitHubToolHost, GitHubToolRefusal, githubToolError } from './GitHubToolHost.js';
export type { GitHubToolHostDeps } from './GitHubToolHost.js';

export const GITHUB_READ_TOOL_NAMES = ['github_list_issues', 'github_get_issue'] as const;
export const GITHUB_WRITE_TOOL_NAMES = ['github_create_issue', 'github_comment_issue', 'github_close_issue'] as const;
export const GITHUB_MERGE_TOOL_NAME = 'github_merge_pull_request' as const;
export const GITHUB_TOOL_NAMES = [...GITHUB_READ_TOOL_NAMES, ...GITHUB_WRITE_TOOL_NAMES, GITHUB_MERGE_TOOL_NAME] as const;
export type GitHubToolName = (typeof GITHUB_TOOL_NAMES)[number];

/** Short hint appended with the tools: they exist, they act on the project's repository, and how an issue becomes a fix. */
export const GITHUB_TOOLS_HINT =
  `\n\n[GitHub]\n` +
  `The github_* tools act on this project's GitHub repository with the connected account (resolved for you; pass codebase only when ` +
  `the project has several). To fix an issue: github_get_issue, make the change on a branch, open a PR whose description says ` +
  `"Closes #N", then github_comment_issue with the PR link. Creating, commenting on and closing issues may ask the user; ` +
  `github_merge_pull_request always asks the user — say why before you call it.`;

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const CODEBASE_PARAM = {
  type: 'string',
  description: 'Codebase alias, only when the project has more than one GitHub repository',
};

export interface GitHubToolCaller {
  projectId: string;
}

export interface BuildGitHubToolSetOptions {
  owner?: string | undefined;
}

/** Tool definitions for one project. Handlers return `{ok: false, code?, error}` instead of throwing. */
export function buildGitHubToolSet(
  host: GitHubToolHost,
  caller: GitHubToolCaller,
  opts: BuildGitHubToolSetOptions = {},
): ToolDefinition[] {
  const owner = opts.owner ?? `project:${caller.projectId}`;
  const wrap = (fn: (args: Record<string, unknown>) => Promise<unknown>) => async (args: Record<string, unknown>) => {
    try {
      return await fn(args ?? {});
    } catch (err) {
      return githubToolError(err);
    }
  };
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const labelsOf = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string' && l.trim() !== '') : undefined;

  return [
    {
      name: 'github_list_issues',
      description:
        "List issues in this project's GitHub repository (pull requests excluded): number, title, state, labels, author, comment count, " +
        'last update, URL. Default: open issues, newest activity first, at most 30.',
      parametersSchema: obj({
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default open' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Only issues carrying all of these labels' },
        limit: { type: 'number', description: 'At most this many (1-100, default 30)' },
        codebase: CODEBASE_PARAM,
      }),
      skipPermission: true,
      owner,
      handler: wrap((a) =>
        host.listIssues(caller.projectId, {
          ...(str(a['codebase']) ? { codebase: str(a['codebase'])! } : {}),
          ...(str(a['state']) ? { state: str(a['state'])! } : {}),
          ...(labelsOf(a['labels']) ? { labels: labelsOf(a['labels'])! } : {}),
          ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
        }),
      ),
    },
    {
      name: 'github_get_issue',
      description:
        "Read one issue in this project's GitHub repository: title, state, labels, author, body (Markdown) and every comment, oldest first.",
      parametersSchema: obj({ number: { type: 'number', description: 'Issue number' }, codebase: CODEBASE_PARAM }, ['number']),
      skipPermission: true,
      owner,
      handler: wrap((a) =>
        host.getIssue(caller.projectId, { number: a['number'], ...(str(a['codebase']) ? { codebase: str(a['codebase'])! } : {}) }),
      ),
    },
    {
      name: 'github_create_issue',
      description:
        "Create an issue in this project's GitHub repository. Returns its number and URL. Title ≤ 256 characters; body is Markdown.",
      parametersSchema: obj(
        {
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Markdown description: what happens, what should happen, how to reproduce' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Existing label names' },
          codebase: CODEBASE_PARAM,
        },
        ['title'],
      ),
      skipPermission: false,
      owner,
      handler: wrap((a) => host.createIssue(caller.projectId, a)),
    },
    {
      name: 'github_comment_issue',
      description: "Comment on an issue (or pull request) in this project's GitHub repository. Body is Markdown.",
      parametersSchema: obj(
        { number: { type: 'number', description: 'Issue number' }, body: { type: 'string', description: 'Markdown comment' }, codebase: CODEBASE_PARAM },
        ['number', 'body'],
      ),
      skipPermission: false,
      owner,
      handler: wrap((a) => host.commentIssue(caller.projectId, a)),
    },
    {
      name: 'github_close_issue',
      description:
        "Close an issue in this project's GitHub repository, as completed (default) or not planned, optionally posting a comment first.",
      parametersSchema: obj(
        {
          number: { type: 'number', description: 'Issue number' },
          reason: { type: 'string', enum: ['completed', 'not_planned'], description: 'Default completed' },
          comment: { type: 'string', description: 'Posted before closing (e.g. the PR that fixed it)' },
          codebase: CODEBASE_PARAM,
        },
        ['number'],
      ),
      skipPermission: false,
      owner,
      handler: wrap((a) => host.closeIssue(caller.projectId, a)),
    },
    {
      name: GITHUB_MERGE_TOOL_NAME,
      description:
        "Merge a pull request in this project's GitHub repository. Always asks the user first. Refused when the PR is merged, closed, " +
        'a draft, conflicts with its base, or misses required checks or reviews — the error says which.',
      parametersSchema: obj(
        {
          number: { type: 'number', description: 'Pull request number' },
          method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Default merge (a merge commit)' },
          deleteBranch: { type: 'boolean', description: 'Delete the head branch after merging' },
          codebase: CODEBASE_PARAM,
        },
        ['number'],
      ),
      skipPermission: false,
      owner,
      handler: wrap((a) => host.mergePullRequest(caller.projectId, a)),
    },
  ];
}
