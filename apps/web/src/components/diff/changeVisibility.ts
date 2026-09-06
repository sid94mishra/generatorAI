// ────────────────────────────────────────────────────────────────
// changeVisibility — which repos of a change summary count as "the code".
//
// Historically a managed workspace was itself a git repository (alias `.`,
// kind `root`) wrapping the linked codebases under `source/<alias>/`, and
// anything the agent scaffolded at that root — an orchestrator's state file,
// task summaries, scratch notes — landed in it. When a real codebase was
// present those files were supporting material, not the change under review,
// so they are hidden by default and offered behind a toggle. A workspace with
// NO codebase (an ad-hoc "write me a script" chat) keeps them: there they ARE
// the work.
//
// Under the mount model the managed root is never a mount, so a new workspace
// has no `root` repo at all and nothing is hidden. This rule survives for the
// workspaces that predate that.
// ────────────────────────────────────────────────────────────────

import type { ChangeSummary, ChangeSummaryRepo } from '@/types/changes.js';

export interface SplitChangeSummary {
  /** The summary with only the repos that should be reviewed. */
  visible: ChangeSummary | undefined;
  /** Root-repo files that were hidden (0 when nothing was). */
  hiddenWorkspaceFiles: number;
}

/** True when this repo is a mount rather than the legacy workspace wrapper. */
export function isCodebaseRepo(repo: Pick<ChangeSummaryRepo, 'kind'>): boolean {
  return repo.kind !== 'root';
}

function statsOf(repos: ChangeSummaryRepo[]): ChangeSummary['stats'] {
  return repos.reduce(
    (acc, r) => ({
      files: acc.files + r.stats.files,
      additions: acc.additions + r.stats.additions,
      deletions: acc.deletions + r.stats.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

export function splitWorkspaceChanges(
  summary: ChangeSummary | undefined,
  showWorkspaceFiles: boolean,
): SplitChangeSummary {
  if (!summary) return { visible: summary, hiddenWorkspaceFiles: 0 };
  const hasCodebase = summary.repos.some(isCodebaseRepo);
  if (!hasCodebase || showWorkspaceFiles) return { visible: summary, hiddenWorkspaceFiles: 0 };
  const visibleRepos = summary.repos.filter(isCodebaseRepo);
  const hidden = summary.repos
    .filter((r) => !isCodebaseRepo(r))
    .reduce((n, r) => n + r.files.length, 0);
  if (hidden === 0) return { visible: summary, hiddenWorkspaceFiles: 0 };
  return {
    visible: { ...summary, repos: visibleRepos, stats: statsOf(visibleRepos) },
    hiddenWorkspaceFiles: hidden,
  };
}
