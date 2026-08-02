// Human-readable table formatter for CLI list commands

import chalk from 'chalk';

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: unknown) => string;
}

/** Render a table of records to stderr in human-readable form */
export function outputTable(
  rows: Record<string, unknown>[],
  columns: TableColumn[],
  opts?: { title?: string; emptyMessage?: string },
): void {
  if (rows.length === 0) {
    process.stderr.write(chalk.dim(`\n  ${opts?.emptyMessage ?? 'No results.'}\n\n`));
    return;
  }

  if (opts?.title) {
    process.stderr.write(chalk.bold(`\n  ${opts.title} (${rows.length})\n\n`));
  }

  // Compute column widths
  const widths = columns.map((col) => {
    if (col.width) return col.width;
    const headerLen = col.label.length;
    const maxData = rows.reduce((max, row) => {
      const val = formatCell(row[col.key], col.format);
      return Math.max(max, stripAnsi(val).length);
    }, 0);
    return Math.min(Math.max(headerLen, maxData) + 2, 50);
  });

  // Header
  const header = columns.map((col, i) => padCell(chalk.dim(col.label), widths[i]!, col.align)).join('  ');
  process.stderr.write(`  ${header}\n`);
  process.stderr.write(`  ${widths.map((w) => chalk.dim('─'.repeat(w))).join('  ')}\n`);

  // Rows
  for (const row of rows) {
    const cells = columns.map((col, i) => {
      const formatted = formatCell(row[col.key], col.format);
      return padCell(formatted, widths[i]!, col.align);
    });
    process.stderr.write(`  ${cells.join('  ')}\n`);
  }
  process.stderr.write('\n');
}

function formatCell(value: unknown, formatter?: (v: unknown) => string): string {
  if (formatter) return formatter(value);
  if (value === null || value === undefined) return chalk.dim('—');
  if (typeof value === 'boolean') return value ? chalk.green('✓') : chalk.dim('✗');
  return String(value);
}

function padCell(text: string, width: number, align?: 'left' | 'right' | 'center'): string {
  const len = stripAnsi(text).length;
  const pad = Math.max(0, width - len);
  if (align === 'right') return ' '.repeat(pad) + text;
  if (align === 'center') return ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2));
  return text + ' '.repeat(pad);
}

function stripAnsi(str: string): string {
   
  return str.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Format a status string with color */
export function formatStatus(status: string): string {
  const map: Record<string, (s: string) => string> = {
    active: chalk.green,
    running: chalk.green,
    completed: chalk.green,
    success: chalk.green,
    healthy: chalk.green,
    enabled: chalk.green,
    pending: chalk.yellow,
    queued: chalk.yellow,
    paused: chalk.yellow,
    awaiting_input: chalk.yellow,
    failed: chalk.red,
    error: chalk.red,
    cancelled: chalk.red,
    disabled: chalk.red,
    archived: chalk.dim,
    idle: chalk.dim,
    skipped: chalk.dim,
  };
  const colorFn = map[status.toLowerCase()] ?? chalk.white;
  return colorFn(status);
}

/** Truncate a string to maxLen with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Format a date for display */
export function formatDate(date: string | Date | undefined): string {
  if (!date) return chalk.dim('—');
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return chalk.dim('just now');
  if (diffMins < 60) return chalk.dim(`${diffMins}m ago`);
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return chalk.dim(`${diffHrs}h ago`);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return chalk.dim(`${diffDays}d ago`);
  return chalk.dim(d.toLocaleDateString());
}
