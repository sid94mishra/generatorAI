// ────────────────────────────────────────────────────────────────
// Run list filters (P07 WP-7.6; ported from components/workflow/runs/
// RunFilterBar.tsx): the run name or id, statuses, trigger kinds, a creation
// date range and variable values (`name=value`). They become the server's
// run search (`GET /workflow-runs`), so a list shows exactly the runs that
// match.
// ────────────────────────────────────────────────────────────────

import type { WorkflowRunListFilter } from '@generatorai/shared';

export interface RunFilters {
  q: string;
  statuses: string[];
  triggers: string[];
  /** `yyyy-mm-dd`, inclusive, in local time. */
  from: string;
  to: string;
  variables: Array<{ name: string; value: string }>;
}

export const EMPTY_RUN_FILTERS: RunFilters = { q: '', statuses: [], triggers: [], from: '', to: '', variables: [] };

/** How many filters (not the search text) are set. */
export function activeFilterCount(f: RunFilters): number {
  return f.statuses.length + f.triggers.length + (f.from ? 1 : 0) + (f.to ? 1 : 0) + f.variables.length;
}

/** The server search of a set of filters (dates are local days, inclusive). */
export function toRunListFilter(f: RunFilters, base: WorkflowRunListFilter = {}): WorkflowRunListFilter {
  const day = (d: string, end: boolean) => {
    const [y, m, dd] = d.split('-').map(Number);
    return end ? new Date(y!, m! - 1, dd!, 23, 59, 59, 999) : new Date(y!, m! - 1, dd!);
  };
  return {
    ...base,
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.statuses.length ? { status: f.statuses } : {}),
    ...(f.triggers.length ? { trigger: f.triggers } : {}),
    ...(f.from ? { from: day(f.from, false).toISOString() } : {}),
    ...(f.to ? { to: day(f.to, true).toISOString() } : {}),
    ...(f.variables.length ? { variables: Object.fromEntries(f.variables.map((v) => [v.name, v.value])) } : {}),
  };
}

const VARIABLE_ENTRY = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** `name=value` → the entry, or null when it isn't one. */
export function parseVariableFilter(text: string): { name: string; value: string } | null {
  const m = VARIABLE_ENTRY.exec(text);
  return m ? { name: m[1]!, value: m[2]!.trim() } : null;
}

export function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
