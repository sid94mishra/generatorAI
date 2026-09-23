// ────────────────────────────────────────────────────────────────
// workbenchModel — which tools a session offers, and the one-line "glimpse"
// each shows in the workbench index.
//
// The desktop app keeps these as tabs in a right-hand pane that is always on
// screen. A phone has no room for that, so the tools moved OUT of the chat:
// the conversation owns the screen, a header button opens an index of tools
// from the right, and a tool opens as a resizable sheet from the bottom.
// The index is only worth a tap if it answers "is there anything in there?"
// before the tool is opened — that is what a glimpse is.
//
// Pure: the availability rules and the copy are unit-tested without a
// renderer, and the chat screen and the workflow run screen share them.
// ────────────────────────────────────────────────────────────────

export type ToolId =
  | 'changes'
  | 'files'
  | 'terminal'
  | 'browser'
  | 'tasks'
  | 'plan'
  | 'computer'
  | 'session';

export type ToolTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ToolDescriptor {
  id: ToolId;
  label: string;
  /** One line under the label: what is in there right now. */
  glimpse: string;
  /** A number worth a badge (changed files, running tasks). */
  count?: number;
  /** Lines added / removed, drawn green / red ahead of the glimpse. */
  stats?: { additions: number; deletions: number };
  /** Something is live behind this tool (browser up, task running). */
  live?: boolean;
  /** The device lacks the scope; the tool opens on its locked explanation. */
  locked?: boolean;
  /** Needs the person: a plan awaiting review, a consent prompt. */
  attention?: boolean;
  tone: ToolTone;
}

export interface WorkbenchInput {
  /** Null until the agent has run once in this session. */
  workspaceId: string | null;
  changes?: { files: number; additions: number; deletions: number; firstPaths: readonly string[] } | undefined;
  scm?:
    | {
        branch: string | null;
        /** HEAD is not on a branch. A null `branch` without this means an unborn one. */
        detached?: boolean;
        ahead: number | null;
        behind: number | null;
        openPullRequest: { number: number } | null;
        conflicts: number;
        repoCount: number;
      }
    | undefined;
  tasks?: { orchestrator: boolean; total: number; running: number } | undefined;
  plan?: { title: string; status: string } | undefined;
  browser?: { ready: boolean; url: string | null } | undefined;
  terminalLocked?: boolean;
  browserLocked?: boolean;
  computer?: { enabled: boolean; locked: boolean; needsAnswer: boolean } | undefined;
  session?: { model: string | null; contextPercent: number | null } | undefined;
  /** Workflow runs have no chat-level Plan / Tasks / Session tools. */
  surface?: 'chat' | 'run';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fileName(path: string): string {
  const clean = path.replace(/\\/g, '/');
  return clean.slice(clean.lastIndexOf('/') + 1) || clean;
}

/** "auth.ts, login.tsx +3" — enough to recognise the change set at a glance. */
export function changedFilesGlimpse(paths: readonly string[], total: number): string {
  const shown = paths.slice(0, 2).map(fileName);
  if (shown.length === 0) return '';
  const rest = total - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

export function planStatusLabel(status: string): string {
  switch (status) {
    case 'awaiting_review':
      return 'Waiting for your review';
    case 'approved':
      return 'Approved';
    case 'executing':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'rejected':
      return 'Rejected';
    case 'superseded':
      return 'Superseded';
    case 'draft':
      return 'Draft';
    default:
      return status.replace(/_/g, ' ');
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return m ? m[1]! : url;
}

/**
 * The tools on offer, in a fixed order: review first (Changes, which carries
 * commit / push / pull request as on desktop), then the workspace (Files, Terminal, Browser, Computer), then the
 * session itself (Tasks, Plan, Session).
 *
 * Terminal and Browser are listed even without their scope — the tool opens
 * on a locked page with the reason and a "Request access" route. Hiding a
 * destination is worse than explaining it.
 */
export function workbenchTools(input: WorkbenchInput): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  const chat = (input.surface ?? 'chat') === 'chat';
  const hasWorkspace = Boolean(input.workspaceId);

  if (hasWorkspace) {
    // Changes carries source control, exactly as the desktop Changes tab does:
    // the diff list with the commit → push → pull-request block under it. Its
    // glimpse therefore leads with the branch state when there is a repo.
    const c = input.changes;
    const scm = input.scm && input.scm.repoCount > 0 ? input.scm : null;
    const branchBits: string[] = [];
    if (scm) {
      branchBits.push(scm.detached ? 'detached HEAD' : (scm.branch ?? 'no branch'));
      if (scm.ahead) branchBits.push(`↑${scm.ahead}`);
      if (scm.behind) branchBits.push(`↓${scm.behind}`);
      if (scm.openPullRequest) branchBits.push(`PR #${scm.openPullRequest.number}`);
      if (scm.conflicts > 0) branchBits.push(plural(scm.conflicts, 'conflict'));
    }
    const conflicted = Boolean(scm && scm.conflicts > 0);
    const filesBit =
      c && c.files > 0
        ? c.firstPaths.length > 0
          ? changedFilesGlimpse(c.firstPaths, c.files)
          : plural(c.files, 'file')
        : 'No changes yet';
    out.push({
      id: 'changes',
      label: 'Changes',
      // Files first: the question the row answers is "what changed". A work
      // branch's generated name (generatorai/chat-22-sep-5-26pm) led before
      // and pushed every file name off a phone-width row.
      glimpse: [filesBit, ...branchBits].join(' · '),
      ...(c && c.files > 0 ? { count: c.files, stats: { additions: c.additions, deletions: c.deletions } } : {}),
      ...(conflicted ? { attention: true } : {}),
      tone: conflicted ? 'danger' : 'neutral',
    });

    out.push({ id: 'files', label: 'Files', glimpse: 'Browse and search the workspace', tone: 'neutral' });

    out.push({
      id: 'terminal',
      label: 'Terminal',
      glimpse: input.terminalLocked ? 'Not enabled on this device' : 'A shell in the workspace',
      ...(input.terminalLocked ? { locked: true } : {}),
      tone: 'neutral',
    });

    const b = input.browser;
    out.push({
      id: 'browser',
      label: 'Browser',
      glimpse: input.browserLocked
        ? 'Not enabled on this device'
        : b?.ready
          ? (hostOf(b.url) ?? 'Running')
          : 'Not started',
      ...(input.browserLocked ? { locked: true } : {}),
      ...(b?.ready && !input.browserLocked ? { live: true } : {}),
      tone: b?.ready && !input.browserLocked ? 'success' : 'neutral',
    });

    if (input.computer?.enabled) {
      out.push({
        id: 'computer',
        label: 'Computer',
        glimpse: input.computer.locked
          ? 'Not enabled on this device'
          : input.computer.needsAnswer
            ? 'Waiting for your consent'
            : 'Screen and activity',
        ...(input.computer.locked ? { locked: true } : {}),
        ...(input.computer.needsAnswer ? { attention: true, live: true } : {}),
        tone: input.computer.needsAnswer ? 'warning' : 'neutral',
      });
    }
  }

  if (chat) {
    const t = input.tasks;
    if (t && (t.orchestrator || t.total > 0)) {
      out.push({
        id: 'tasks',
        label: 'Background tasks',
        glimpse:
          t.total === 0
            ? 'No tasks yet'
            : t.running > 0
              ? `${t.running} running · ${t.total} total`
              : `${plural(t.total, 'task')} · none running`,
        ...(t.running > 0 ? { count: t.running, live: true } : {}),
        tone: t.running > 0 ? 'info' : 'neutral',
      });
    }

    const p = input.plan;
    out.push(
      p
        ? {
            id: 'plan',
            label: 'Plan',
            glimpse: `${planStatusLabel(p.status)} · ${p.title}`,
            ...(p.status === 'awaiting_review' ? { attention: true } : {}),
            tone: p.status === 'awaiting_review' ? 'warning' : 'neutral',
          }
        : { id: 'plan', label: 'Plan', glimpse: 'No plan yet', tone: 'neutral' },
    );

    const s = input.session;
    const bits: string[] = [];
    if (s?.model) bits.push(s.model);
    if (s?.contextPercent != null) bits.push(`${Math.round(s.contextPercent)}% context`);
    out.push({
      id: 'session',
      label: 'Session',
      glimpse: bits.length > 0 ? bits.join(' · ') : 'Usage, context and connection',
      tone: s?.contextPercent != null && s.contextPercent >= 85 ? 'warning' : 'neutral',
    });
  }

  return out;
}

/** What the header button's badge shows: attention beats live beats count. */
export function workbenchBadge(tools: readonly ToolDescriptor[]): { kind: 'attention' | 'live' | 'count'; count?: number } | null {
  if (tools.some((t) => t.attention)) return { kind: 'attention' };
  const changes = tools.find((t) => t.id === 'changes');
  if (changes?.count) return { kind: 'count', count: changes.count };
  if (tools.some((t) => t.live)) return { kind: 'live' };
  return null;
}

/**
 * Tools that are expensive to build and hold a connection (a WebView with
 * xterm, a screencast socket). Once opened they stay mounted while the sheet
 * is open so switching back is instant — but only the most recent few, so a
 * session with every tool visited does not keep seven live views around.
 */
export const HEAVY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['terminal', 'browser', 'computer']);
export const KEEP_ALIVE_LIMIT = 2;

/** Most-recent-first list of heavy tools to keep mounted after opening `opened`. */
export function nextKeepAlive(current: readonly ToolId[], opened: ToolId, limit = KEEP_ALIVE_LIMIT): ToolId[] {
  if (!HEAVY_TOOLS.has(opened)) return [...current];
  return [opened, ...current.filter((id) => id !== opened)].slice(0, Math.max(0, limit));
}

/** Composer slash commands and deep links name tools loosely; map them. */
export function toolForSection(section: string): ToolId | null {
  switch (section) {
    case 'changes':
    case 'files':
    case 'terminal':
    case 'browser':
    case 'tasks':
    case 'plan':
    case 'computer':
      return section;
    // Source control lives inside Changes, as on desktop.
    case 'scm':
      return 'changes';
    case 'inspector':
    case 'session':
      return 'session';
    default:
      return null;
  }
}
