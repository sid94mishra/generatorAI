// StructuredOutputView model (03 §6.7; MWorkflowRunPane; MG-32): a stage's JSON output as a table when it is an array of
// flat objects (the columns are the keys in first-seen order, at most four), otherwise as a key / value tree (nested
// objects indent, arrays of scalars join). No presentation hints exist yet (MG-32), so column names are the keys.
// Pure, unit-tested.

export type OutputCell = string;

export type OutputView =
  | { kind: 'table'; title: string | null; columns: string[]; rows: OutputCell[][]; total: number }
  | { kind: 'tree'; rows: Array<{ depth: number; key: string; value: string | null }> }
  | { kind: 'text'; text: string };

const MAX_COLUMNS = 4;
const MAX_DEPTH = 3;

const isScalar = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const cell = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

function flatObjects(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every((r) => r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every(isScalar));
}

/** "proposed_upgrades" → "Proposed upgrades". */
export function humanKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function outputView(value: unknown): OutputView {
  if (typeof value === 'string') return { kind: 'text', text: value };
  // An object whose one big member is a table: show that member as the table.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const tables = entries.filter(([, v]) => flatObjects(v));
    if (tables.length === 1 && entries.length <= 3) return table(tables[0]![1] as Array<Record<string, unknown>>, humanKey(tables[0]![0]));
  }
  if (flatObjects(value)) return table(value, null);
  const rows: Array<{ depth: number; key: string; value: string | null }> = [];
  const walk = (v: unknown, depth: number, key: string): void => {
    if (isScalar(v) || depth >= MAX_DEPTH) {
      rows.push({ depth, key, value: cell(v) });
      return;
    }
    if (Array.isArray(v)) {
      if (v.every(isScalar)) {
        rows.push({ depth, key, value: v.map(cell).join(', ') || '—' });
        return;
      }
      rows.push({ depth, key, value: null });
      v.forEach((item, i) => walk(item, depth + 1, `#${i + 1}`));
      return;
    }
    rows.push({ depth, key, value: null });
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, depth + 1, k);
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, 0, k);
  else walk(value, 0, 'value');
  return { kind: 'tree', rows };
}

function table(list: Array<Record<string, unknown>>, title: string | null): OutputView {
  const columns: string[] = [];
  for (const row of list) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
  const shown = columns.slice(0, MAX_COLUMNS);
  return { kind: 'table', title, columns: shown, rows: list.map((r) => shown.map((c) => cell(r[c]))), total: list.length };
}
