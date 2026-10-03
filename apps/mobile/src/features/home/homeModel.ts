// Home rules (MHome, MHomeMore; 04 §2.1; MD-21, MD-84, MD-164): which Needs-you rows open the approval sheet, the
// row meta, the Recently finished outcome text (PR / commit from MG-13) and the date line. Pure, unit-tested.
import type { AttentionItem, RecentActivityItem, StatusState } from '@generatorai/shared';

import { gateHref } from '../../blocks/shell/hrefs';

/** Home shows this many Needs-you rows before "See all" (the drawer's limit, MB-19). */
export const HOME_NEEDS_LIMIT = 5;
/** Recently finished rows on Home. */
export const HOME_RECENT_LIMIT = 8;

export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

const dateLine = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Wed, Sep 23" (the Home subtitle). */
export function homeDate(now: Date = new Date()): string {
  return dateLine.format(now);
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** A finish time: the clock today ("13:05"), the date before ("Sep 22"). */
export function finishTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t >= startOfToday(now) ? clock.format(t) : day.format(t);
}

/** The asks a person answers on the spot ("Review"); the rest open their item ("Open"). */
const REVIEW_KINDS = new Set(['tool_permission', 'question', 'stage_approval', 'stage_input', 'computer_consent']);
/** Chat asks the approval sheet answers itself (MB-50, signed for risky gates, MD-31). */
const SHEET_KINDS = new Set(['tool_permission', 'question']);

export interface NeedsYouAction {
  label: 'Review' | 'Open';
  /** The approval sheet for a chat gate; null → open the item's own route. */
  sheetHref: string | null;
}

/**
 * Mobile rows never answer inline (MD-21): a chat permission or question opens the approval sheet, which signs
 * risky approvals with the device key (M6-03); everything else opens its item.
 */
export function needsYouAction(item: Pick<AttentionItem, 'entity' | 'entityId' | 'ask'>): NeedsYouAction {
  const kind = item.ask?.kind;
  const label = kind && REVIEW_KINDS.has(kind) ? 'Review' : 'Open';
  const sheetHref = item.entity === 'chat' && item.ask && kind && SHEET_KINDS.has(kind) ? gateHref(item.entityId, item.ask.id) : null;
  return { label, sheetHref };
}

/** The line under a Needs-you title: the ask's own summary ("Bug Fixer wants to run git push"). */
export function needsYouMeta(item: Pick<AttentionItem, 'ask' | 'project'>): string[] {
  return [item.ask?.summary, item.project?.name].filter((s): s is string => Boolean(s));
}

/** The line under a Running title: project, then the latest step ("Stage 2 of 4", "Running pnpm build"). */
export function runningMeta(item: Pick<AttentionItem, 'progress' | 'project'>): { project?: string; detail?: string } {
  const p = item.progress;
  const detail = p?.label ?? (p?.step !== undefined && p.of !== undefined ? `Step ${p.step} of ${p.of}` : undefined);
  return { ...(item.project ? { project: item.project.name } : {}), ...(detail ? { detail } : {}) };
}

export interface RecentRowView {
  key: string;
  title: string;
  state: StatusState;
  project?: string;
  /** "PR #1176 opened", "Done · committed", "Succeeded", the failure's first line. */
  outcome: string;
  outcomeTone: 'fg-3' | 'err';
  endedAt: string;
}

const OUTCOME_STATE: Record<RecentActivityItem['outcome'], StatusState> = { succeeded: 'succeeded', failed: 'failed', cancelled: 'skipped' };

export function recentRowView(item: RecentActivityItem): RecentRowView {
  const done = item.entity === 'chat' ? 'Done' : 'Succeeded';
  let outcome: string;
  if (item.outcome === 'failed') outcome = item.summary || 'Failed';
  else if (item.outcome === 'cancelled') outcome = 'Cancelled';
  else if (item.pullRequest) outcome = `PR #${item.pullRequest.number} opened`;
  else if (item.commit?.sha) outcome = `${done} · committed`;
  else outcome = done;
  return {
    key: item.key,
    title: item.title,
    state: OUTCOME_STATE[item.outcome],
    ...(item.project ? { project: item.project.name } : {}),
    outcome,
    outcomeTone: item.outcome === 'failed' ? 'err' : 'fg-3',
    endedAt: item.endedAt,
  };
}

/** The "Finished today" tile: items that ended today (the query asks from midnight; capped by its limit). */
export function finishedTodayCount(items: readonly RecentActivityItem[], now: Date = new Date()): number {
  const start = startOfToday(now).getTime();
  return items.filter((i) => Date.parse(i.endedAt) >= start).length;
}
