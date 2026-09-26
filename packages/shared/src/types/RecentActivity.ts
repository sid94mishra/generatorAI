// ────────────────────────────────────────────────────────────────
// Recently finished activity (G-11, docs/redesign/05-gap-matrix.md §G-11).
//
// `GET /api/activity/recent?since=&limit=20&projectId=` — Home "Recently
// finished". Merges chats' finished turns, terminal workflow runs and
// terminal automation executions into one feed, newest first.
//
// D-36 / no fake data — **pull-request- and commit-derived items are left
// out of this pass entirely**: the only existing source
// (`sourceControlService.listPullRequests` / `GET /projects/:id/pull-
// requests`) makes a live git-host call per codebase, and fanning that out
// across every codebase on every dashboard load would be slow, flaky
// (rate limits, auth) and outside this gap's **M** effort — better to omit
// the source than to fake or silently drop failures. `commit.branch` is
// populated only where a workflow run has a tracked worktree; it is never
// invented. `pullRequest` is always absent for now.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
// ────────────────────────────────────────────────────────────────

/** The three sources this pass merges. (`pull_request` / `commit` are reserved for later.) */
export type ActivityEntity = 'chat' | 'run' | 'automation_execution';

export type ActivityOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface RecentActivityQuery {
  /** ISO timestamp; only items that ended after this are returned. */
  since?: string;
  /** Default 20. */
  limit?: number;
  projectId?: string;
}

export interface RecentActivityChanges {
  files: number;
  additions: number;
  deletions: number;
}

export interface RecentActivityItem {
  /** Stable, unique across the whole feed: `${entity}:${entityId}`. */
  key: string;
  entity: ActivityEntity;
  entityId: string;
  title: string;
  /** A web route the item's title links to. */
  href: string;
  project?: { id: string; name: string };
  /** ISO timestamp — the turn/run/execution's end time. */
  endedAt: string;
  outcome: ActivityOutcome;
  /** One line, e.g. the failure's first error line. */
  summary: string;
  /** Chats only — the workspace's net change stats (G-02). */
  changes?: RecentActivityChanges;
  /** Reserved — always absent in this pass (see file header). */
  pullRequest?: { number: number; url: string };
  /** Workflow runs only, and only when a tracked worktree exists for the run. */
  commit?: { branch: string };
  /** Present only on a `failed` item that has a retry action. */
  retry?: 'chat_prompt' | 'run_retry';
}

export interface RecentActivityPage {
  items: RecentActivityItem[];
}
