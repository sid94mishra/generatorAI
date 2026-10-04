// ────────────────────────────────────────────────────────────────
// Home read-model helpers (F-home-03…09) — pure: wire data in, the strings
// and row decisions the page renders out. React-free so the rules are
// unit-tested.
// ────────────────────────────────────────────────────────────────

import { askDetailLine } from '@generatorai/client-core';
import type { AttentionCounts, AttentionItem } from '@generatorai/shared';

/** The H1: "2 need you · 3 running", "Nothing needs you". Undefined until the feed has loaded. */
export function homeHeadline(counts: Pick<AttentionCounts, 'needsYou' | 'running'> | undefined): string | undefined {
  if (!counts) return undefined;
  const need = counts.needsYou > 0 ? `${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you` : 'Nothing needs you';
  return counts.running > 0 ? `${need} · ${counts.running} running` : need;
}

// ── Needs you row actions ──────────────────────────────────────

export interface NeedsYouActions {
  /** The inline answer (Allow once / Approve); absent when the ask has no inline form. */
  primary?: { action: 'allow_once' | 'approve'; label: string };
  /** The navigating button (Review / Answer / Open). */
  openLabel: string;
}

/**
 * Which buttons a Needs you row shows. The inline answer is offered only for
 * the asks Home can answer with one call — a chat tool permission (Allow once),
 * a chat plan review or a workflow stage approval (Approve) — and only when
 * the server lists that action for the ask.
 */
export function needsYouActions(item: Pick<AttentionItem, 'entity' | 'ask'>): NeedsYouActions {
  const ask = item.ask;
  if (!ask) return { openLabel: 'Open' };
  const offers = (action: 'allow_once' | 'approve') => ask.actions.includes(action);
  switch (ask.kind) {
    case 'tool_permission':
      return item.entity === 'chat' && offers('allow_once')
        ? { primary: { action: 'allow_once', label: 'Allow once' }, openLabel: 'Open' }
        : { openLabel: 'Open' };
    case 'plan_review':
      return item.entity === 'chat' && offers('approve')
        ? { primary: { action: 'approve', label: 'Approve' }, openLabel: 'Review' }
        : { openLabel: 'Review' };
    case 'stage_approval':
      return item.entity === 'workflow_run' && offers('approve')
        ? { primary: { action: 'approve', label: 'Approve' }, openLabel: 'Review' }
        : { openLabel: 'Review' };
    case 'question':
    case 'stage_input':
      return { openLabel: 'Answer' };
    case 'run_paused':
      return { openLabel: 'Review' };
    default:
      return { openLabel: 'Open' };
  }
}

/** The second line of a Needs you row: the ask's detail, else its summary. */
export function needsYouDetail(item: Pick<AttentionItem, 'ask' | 'parent'>): string | undefined {
  const ask = item.ask;
  const via = item.parent ? `in ${item.parent.title}` : undefined;
  const parts = [ask?.summary, askDetailLine(ask?.detail), via].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// ── This week ──────────────────────────────────────────────────

/** The locale's first day of the week (1 = Monday … 7 = Sunday); Monday when the runtime cannot say. */
export function localeFirstDay(locale: string | undefined): number {
  try {
    const loc = new Intl.Locale(locale ?? 'en') as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    return first && first >= 1 && first <= 7 ? first : 1;
  } catch {
    return 1;
  }
}

/** The local-time week containing `now`: `from` at midnight on its first day, `to` seven days later (exclusive). */
export function weekRange(now: Date, firstDay: number): { from: Date; to: Date } {
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const offset = (day - firstDay + 7) % 7;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return { from, to };
}

/** "Sep 21 – 27" (the last day is `to` − 1 day). */
export function formatWeekRange(range: { from: Date; to: Date }, locale?: string): string {
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() - 1);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).formatRange(range.from, last);
}

/** "6m 12s", "45s", "1h 5m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 0.943 → "94%". */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ── System ─────────────────────────────────────────────────────

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal units, as the OS file managers show them: "212 MB", "1.4 GB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** "3d 4h 12m", "4h 12m", "12m", "0m". */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Times ──────────────────────────────────────────────────────

/** How long an ask has waited: "now", "3m", "2h", "4d". */
export function formatAge(sinceIso: string, now: number): string {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return '';
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** When a finished item ended: the clock time today ("13:05"), else the date ("Sep 21"). */
export function formatEndedAt(iso: string, now: Date, locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)
    : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(at);
}

/** The date line above the H1: "Sat, Sep 26 · 14:12". */
export function formatDateLine(now: Date, locale?: string): string {
  const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);
  return `${date} · ${time}`;
}
