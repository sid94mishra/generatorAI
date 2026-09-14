// ────────────────────────────────────────────────────────────────
// Pull-request presentation, as data.
//
// The list screen and the detail screen share these: state tone, the checks
// and mergeability summaries, grouping by codebase, and the patch reader
// that turns a unified diff into coloured rows. Pure, so the rules are
// testable without a device.
// ────────────────────────────────────────────────────────────────

import type {
  ProjectPullRequest,
  PullRequestDetail,
  PullRequestFile,
  // Prefixed in shared's barrel to avoid clashing with older exports.
  ScmChecksSummary as ChecksSummary,
  ScmPullRequestState as PullRequestState,
} from '@generatorai/shared';

import type { PullRequestListState } from './api';

export type PrTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export const PR_STATE_SEGMENTS: ReadonlyArray<{ value: PullRequestListState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function prStateTone(state: PullRequestState): PrTone {
  if (state === 'open') return 'success';
  if (state === 'merged') return 'primary';
  return 'neutral';
}

export function prStateLabel(state: PullRequestState, draft?: boolean): string {
  if (state === 'open' && draft) return 'Draft';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** The server filters; this keeps the rendered list honest if it does not. */
export function matchesState(pr: { state: PullRequestState }, filter: PullRequestListState): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return pr.state === 'open';
  return pr.state !== 'open';
}

export interface PrGroup {
  codebaseId: string;
  alias: string;
  items: ProjectPullRequest[];
}

/** Group by codebase, keeping first-seen order — a project can mount several. */
export function groupByCodebase(items: readonly ProjectPullRequest[]): PrGroup[] {
  const groups: PrGroup[] = [];
  const index = new Map<string, PrGroup>();
  for (const item of items) {
    let group = index.get(item.codebaseId);
    if (!group) {
      group = { codebaseId: item.codebaseId, alias: item.codebaseAlias, items: [] };
      index.set(item.codebaseId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function checksSummaryLabel(checks: ChecksSummary | undefined): string | null {
  if (!checks || checks.total === 0) return null;
  const parts: string[] = [];
  if (checks.passed) parts.push(`${checks.passed} passed`);
  if (checks.failed) parts.push(`${checks.failed} failed`);
  if (checks.pending) parts.push(`${checks.pending} pending`);
  return parts.length > 0 ? parts.join(' · ') : `${checks.total} checks`;
}

export function checksTone(checks: ChecksSummary | undefined): PrTone {
  if (!checks) return 'neutral';
  switch (checks.conclusion) {
    case 'success':
      return 'success';
    case 'failure':
      return 'danger';
    case 'pending':
      return 'info';
    case 'cancelled':
      return 'warning';
    default:
      return 'neutral';
  }
}

export interface MergeabilityView {
  label: string;
  tone: PrTone;
}

export function mergeability(detail: Pick<PullRequestDetail, 'mergeable' | 'mergeableState' | 'state'>): MergeabilityView {
  if (detail.state === 'merged') return { label: 'Merged', tone: 'primary' };
  if (detail.state === 'closed') return { label: 'Closed without merging', tone: 'neutral' };
  if (detail.mergeable === null || detail.mergeableState === 'unknown') {
    return { label: 'Checking mergeability…', tone: 'info' };
  }
  if (detail.mergeable === false) {
    return {
      label: detail.mergeableState === 'dirty' ? 'Conflicts with the base branch' : 'Cannot be merged',
      tone: 'danger',
    };
  }
  if (detail.mergeableState === 'blocked') return { label: 'Blocked by a required check or review', tone: 'warning' };
  if (detail.mergeableState === 'behind') return { label: 'Behind the base branch', tone: 'warning' };
  if (detail.mergeableState === 'unstable') return { label: 'Mergeable — some checks failed', tone: 'warning' };
  return { label: 'Ready to merge', tone: 'success' };
}

export function fileStat(file: Pick<PullRequestFile, 'additions' | 'deletions'>): string {
  return `+${file.additions} −${file.deletions}`;
}

export function fileStatusLetter(status: PullRequestFile['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'removed':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}

export function fileStatusTone(status: PullRequestFile['status']): PrTone {
  switch (status) {
    case 'added':
      return 'success';
    case 'removed':
      return 'danger';
    case 'renamed':
      return 'info';
    default:
      return 'warning';
  }
}

export type PatchRowKind = 'hunk' | 'add' | 'del' | 'context' | 'meta';

export interface PatchRow {
  kind: PatchRowKind;
  text: string;
}

/** Rows to render before a patch is truncated — a 4 000-line diff must not block the list. */
export const PATCH_ROW_LIMIT = 400;

/**
 * A unified diff as rows.
 *
 * Deliberately forgiving: the host's `patch` is hunk text with no file
 * header, may use CRLF, and can carry `\ No newline at end of file` markers.
 * Anything unrecognised renders as context rather than disappearing.
 */
export function parsePatchRows(patch: string | undefined, limit = PATCH_ROW_LIMIT): PatchRow[] {
  if (!patch) return [];
  const rows: PatchRow[] = [];
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (rows.length >= limit) {
      rows.push({ kind: 'meta', text: `… ${lines.length - limit} more lines` });
      break;
    }
    if (line.startsWith('@@')) rows.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) {
      rows.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) rows.push({ kind: 'add', text: line });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line });
    else rows.push({ kind: 'context', text: line });
  }
  // A trailing newline produces one empty context row; it is noise.
  if (rows.length > 0 && rows[rows.length - 1]!.kind === 'context' && rows[rows.length - 1]!.text === '') {
    rows.pop();
  }
  return rows;
}

/** "3 files · +48 −12" for the detail header. */
export function diffStatLabel(detail: Pick<PullRequestDetail, 'changedFiles' | 'additions' | 'deletions'>): string {
  const files = `${detail.changedFiles} ${detail.changedFiles === 1 ? 'file' : 'files'}`;
  return `${files} · +${detail.additions} −${detail.deletions}`;
}
