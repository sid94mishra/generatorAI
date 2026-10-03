// ────────────────────────────────────────────────────────────────
// Recently finished activity (G-11, docs/redesign/05-gap-matrix.md §G-11).
//
// `GET /api/activity/recent?since=&limit=20&projectId=` — Home "Recently
// finished". Merges chats' finished turns, terminal workflow runs and
// terminal automation executions into one feed, newest first.
//
// D-36 / no fake data — there are no separate pull-request or commit ITEMS:
// listing PRs is a live git-host call per codebase. Instead (mobile MG-13)
// a chat or run item carries `pullRequest` / `commit` when ITS workspace ran
// the commit → push → PR flow (`POST /workspaces/:id/scm/flow`) after the
// turn ended / the run started; the server records that outcome on the
// workspace. A run with a tracked worktree also reports its `commit.branch`.
// Nothing is invented.
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
  /** MG-13 — a PR the item's workspace opened through the SCM flow (see file header). */
  pullRequest?: { number: number; url: string };
  /**
   * The branch the item's work landed on: a commit made through the SCM flow
   * (MG-13, then `sha` is set), or a run's tracked worktree branch.
   */
  commit?: { branch: string; sha?: string };
  /** Present only on a `failed` item that has a retry action. */
  retry?: 'chat_prompt' | 'run_retry';
}

export interface RecentActivityPage {
  items: RecentActivityItem[];
}
