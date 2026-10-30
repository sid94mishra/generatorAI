// MB-40 StatsCards rules (03 MB-40; D-58, MD-27, MD-84): the "This week" strip and the automation strip from
// `stats.summary`, the server footer line. A rate or an average the server left out (zero denominator, NG-03) is
// omitted, never "—". Pure, unit-tested.
import type { StatsSummary, SystemInfo } from '@generatorai/shared';

import type { StatItem } from '../../ui/layout/StatStrip';

/** A finished duration, short: "45s", "6m 12s", "1h 3m". */
export function formatDurationShort(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** 0.9412 → "94%". */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** MHomeMore "This week": Chats · Runs · Succeeded % · Avg run (the last two only when the server has them). */
export function weekStatItems(summary: StatsSummary): StatItem[] {
  const items: StatItem[] = [
    { id: 'chats', value: summary.chats.created, label: 'Chats' },
    { id: 'runs', value: summary.runs.total, label: 'Runs' },
  ];
  if (summary.runs.successRate !== undefined) items.push({ id: 'success', value: formatRate(summary.runs.successRate), label: 'Succeeded' });
  if (summary.runs.avgDurationMs !== undefined) items.push({ id: 'avg', value: formatDurationShort(summary.runs.avgDurationMs), label: 'Avg run' });
  return items;
}

/** MAutomationDetail: executions in the range, success rate, average duration (each only when present). */
export function automationStatItems(summary: StatsSummary): StatItem[] {
  const a = summary.automations;
  if (!a) return [];
  const items: StatItem[] = [{ id: 'runs', value: a.executions, label: 'Runs' }];
  if (a.executions > 0) items.push({ id: 'success', value: formatRate(a.succeeded / a.executions), label: 'Succeeded' });
  if (a.avgDurationMs !== undefined) items.push({ id: 'avg', value: formatDurationShort(a.avgDurationMs), label: 'Avg run' });
  return items;
}

/** The footer's mono half: "local:3100 · 0.0.1-alpha.1" (the version only when the server reports one). */
export function serverFooterDetail(address: string | null, info: Pick<SystemInfo, 'serverVersion'> | undefined): string {
  const version = info?.serverVersion && info.serverVersion !== 'unknown' ? info.serverVersion : null;
  return [address, version].filter(Boolean).join(' · ');
}
