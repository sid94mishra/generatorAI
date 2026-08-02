// Unified output dispatcher — routes to JSON or human-readable based on --json flag

import chalk from 'chalk';
import { outputJson } from './json.js';
import { outputTable, type TableColumn } from './table.js';

export type { TableColumn } from './table.js';
export { outputJson } from './json.js';
export { outputTable, formatStatus, formatDate, truncate } from './table.js';

export interface FormatOptions {
  json?: boolean;
}

/** Output a single object: JSON when --json, human key-value pairs otherwise */
export function outputRecord(
  data: Record<string, unknown>,
  opts: FormatOptions & { title?: string; fields?: Array<{ key: string; label: string; format?: (v: unknown) => string }> },
): void {
  if (opts.json) {
    outputJson(data);
    return;
  }

  if (opts.title) {
    process.stderr.write(chalk.bold(`\n  ${opts.title}\n`));
    process.stderr.write(chalk.dim('  ' + '─'.repeat(50)) + '\n');
  }

  type FieldDef = { key: string; label: string; format?: (v: unknown) => string };
  const fields: FieldDef[] = opts.fields ?? Object.keys(data).map((k) => ({ key: k, label: k }));
  for (const field of fields) {
    const val = field.format ? field.format(data[field.key]) : String(data[field.key] ?? '—');
    process.stderr.write(`  ${chalk.dim(field.label + ':')}  ${val}\n`);
  }
  process.stderr.write('\n');
}

/** Output a list: JSON array when --json, table otherwise */
export function outputList(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
  opts: FormatOptions & { title?: string; emptyMessage?: string },
): void {
  if (opts.json) {
    outputJson(rows);
    return;
  }
  outputTable(rows, columns, { title: opts.title, emptyMessage: opts.emptyMessage });
}

/** Output a success message */
export function outputSuccess(message: string, opts?: FormatOptions): void {
  if (opts?.json) {
    outputJson({ ok: true, message });
    return;
  }
  process.stderr.write(chalk.green(`\n  ✓ ${message}\n\n`));
}

/** Output an error message */
export function outputError(message: string, opts?: FormatOptions): void {
  if (opts?.json) {
    outputJson({ ok: false, error: message });
    return;
  }
  process.stderr.write(chalk.red(`\n  ✗ ${message}\n\n`));
}
