// ────────────────────────────────────────────────────────────────
// Presentation for the scriptable surface.
//
// Handlers return data. This decides what it looks like. The split is what
// lets the same command feed a human table, a `jq` pipeline, an NDJSON
// stream and the TUI without any of them knowing about the others.
// ────────────────────────────────────────────────────────────────

import Table from 'cli-table3';
import pc from 'picocolors';
import { stringify as toYaml } from 'yaml';
import stringWidth from 'string-width';
import {
  formatCell,
  readPath,
  singleLine,
  statusTone,
  type ColumnSpec,
  type CommandResult,
  type CommandSpec,
  type TerminalCapabilities,
} from '@generatorai/cli-core';

export type OutputMode = 'auto' | 'json' | 'ndjson' | 'yaml' | 'quiet';

/** The envelope every `--json` payload is wrapped in. Scripts depend on it. */
export interface JsonEnvelope {
  apiVersion: 1;
  kind: string;
  data: unknown;
  warnings?: string[];
  message?: string;
}

/**
 * One versioned NDJSON line. Every frame carries `v`/`frame`/`kind` so a
 * consumer can dispatch on shape alone without guessing from field
 * presence — the previous NDJSON output was the raw internal `CliEvent`
 * dumped as-is, unversioned, with no marker for "the command is done".
 */
export interface NdjsonFrame {
  v: 1;
  frame: 'lifecycle' | 'data' | 'warning' | 'error' | 'completion';
  /** Command id for a `completion` frame; the underlying event's own kind otherwise. */
  kind: string;
  data?: unknown;
  message?: string;
  warnings?: string[];
}

export interface RendererOptions {
  mode: OutputMode;
  capabilities: TerminalCapabilities;
  color: boolean;
  unicode: boolean;
  write: (text: string) => void;
  writeError: (text: string) => void;
}

const TONE_COLOR: Record<string, (text: string) => string> = {
  running: pc.cyan,
  success: pc.green,
  failure: pc.red,
  warning: pc.yellow,
  idle: pc.dim,
  neutral: (text) => text,
};

export class Renderer {
  constructor(private readonly options: RendererOptions) {}

  get mode(): OutputMode {
    return this.options.mode;
  }

  private colour(text: string, fn: (t: string) => string): string {
    return this.options.color ? fn(text) : text;
  }

  /** Entry point used by the command runner. */
  render(spec: CommandSpec, result: CommandResult): void {
    switch (this.options.mode) {
      case 'quiet':
        this.renderWarnings(result.warnings);
        return;
      case 'json':
        this.options.write(`${JSON.stringify(this.envelope(spec, result))}\n`);
        return;
      case 'ndjson':
        this.renderNdjson(spec, result);
        return;
      case 'yaml':
        this.options.write(toYaml(this.envelope(spec, result)));
        return;
      case 'auto':
        this.renderHuman(spec, result);
        this.renderWarnings(result.warnings);
        return;
    }
  }

  private envelope(spec: CommandSpec, result: CommandResult): JsonEnvelope {
    return {
      apiVersion: 1,
      kind: spec.id,
      data: result.data,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      ...(result.message ? { message: result.message } : {}),
    };
  }

  /**
   * One versioned frame per line.
   *
   * A list emits one `data` frame per ROW rather than one line holding the
   * array, because the entire point of NDJSON is that a consumer can
   * process it without buffering the whole response. Either way this ends
   * with exactly one `completion` frame, so a consumer reading the stream
   * live knows when the command itself is actually done — as opposed to
   * merely having emitted its most recent data row.
   */
  private renderNdjson(spec: CommandSpec, result: CommandResult): void {
    if (Array.isArray(result.data)) {
      for (const row of result.data) {
        this.writeFrame({ v: 1, frame: 'data', kind: spec.id, data: row });
      }
      this.writeFrame({
        v: 1,
        frame: 'completion',
        kind: spec.id,
        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
        ...(result.message ? { message: result.message } : {}),
      });
      return;
    }
    this.writeFrame({
      v: 1,
      frame: 'completion',
      kind: spec.id,
      data: result.data,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      ...(result.message ? { message: result.message } : {}),
    });
  }

  private writeFrame(frame: NdjsonFrame): void {
    this.options.write(`${JSON.stringify(frame)}\n`);
  }

  private renderWarnings(warnings: string[] | undefined): void {
    if (!warnings?.length) return;
    for (const warning of warnings) {
      this.options.writeError(`${this.colour('warning:', pc.yellow)} ${warning}\n`);
    }
  }

  private renderHuman(spec: CommandSpec, result: CommandResult): void {
    switch (spec.output.kind) {
      case 'raw':
        this.options.write(typeof result.data === 'string' ? result.data : String(result.data ?? ''));
        if (typeof result.data === 'string' && !result.data.endsWith('\n')) this.options.write('\n');
        return;

      case 'void':
        this.options.write(
          `${this.colour('✓', pc.green)} ${result.message ?? spec.output.successMessage ?? 'Done.'}\n`,
        );
        return;

      case 'stream':
        // A stream already wrote everything through `ctx.emit`; a summary line
        // here would land after the output it summarises.
        if (result.message) this.options.write(`${result.message}\n`);
        return;

      case 'list': {
        const rows = this.extractRows(result.data, spec.output.itemsAt);
        this.renderTable(rows, spec.output.columns ?? this.inferColumns(rows));
        if (result.message) this.options.write(`\n${result.message}\n`);
        return;
      }

      case 'record':
      default: {
        // A handler declaring `record` can legitimately return an array (a
        // `pr` that lists instead of creating); render whichever it actually
        // produced rather than what was declared.
        if (Array.isArray(result.data)) {
          this.renderTable(result.data, spec.output.columns ?? this.inferColumns(result.data));
        } else {
          this.renderRecord(result.data, spec.output.fields, spec.output.fieldsOnly);
        }
        if (result.message) {
          this.options.write(`\n${this.colour('✓', pc.green)} ${result.message}\n`);
        }
        return;
      }
    }
  }

  private extractRows(data: unknown, itemsAt?: string): unknown[] {
    if (Array.isArray(data)) return data;
    if (itemsAt) {
      const nested = readPath(data, itemsAt);
      if (Array.isArray(nested)) return nested;
    }
    return data === null || data === undefined ? [] : [data];
  }

  /** Columns for a payload whose shape the spec did not declare. */
  private inferColumns(rows: unknown[]): ColumnSpec[] {
    const first = rows.find((r) => typeof r === 'object' && r !== null) as
      | Record<string, unknown>
      | undefined;
    if (!first) return [];
    return Object.keys(first)
      .slice(0, 8)
      .map((key) => ({ key, header: key, priority: key === 'id' ? 0 : 2 }));
  }

  private renderTable(rows: unknown[], columns: ColumnSpec[]): void {
    if (rows.length === 0) {
      this.options.write(`${this.colour('(no results)', pc.dim)}\n`);
      return;
    }
    if (columns.length === 0) {
      this.options.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    const visible = this.fitColumns(columns);
    const table = new Table({
      head: visible.map((c) => (this.options.color ? pc.bold(c.header) : c.header)),
      style: { head: [], border: [], compact: true },
      chars: this.options.unicode ? undefined : ASCII_TABLE_CHARS,
      wordWrap: false,
    });

    for (const row of rows) {
      table.push(
        visible.map((column) => {
          const raw = readPath(row, column.key);
          const text = singleLine(
            formatCell(raw, column.format, { unicode: this.options.unicode }),
            column.width ?? 60,
          );
          if (column.format === 'status' && this.options.color) {
            return TONE_COLOR[statusTone(String(raw))]!(text);
          }
          if (column.format === 'id' && this.options.color) return pc.dim(text);
          return text;
        }),
      );
    }

    this.options.write(`${table.toString()}\n`);
    if (visible.length < columns.filter((c) => !this.isDropped(c)).length) {
      this.options.write(
        `${this.colour(`(${columns.length - visible.length} columns hidden — widen the terminal or use --json)`, pc.dim)}\n`,
      );
    }
  }

  private isDropped(_column: ColumnSpec): boolean {
    return false;
  }

  /**
   * Drops low-priority columns until the table fits.
   *
   * Priority 0 columns are never dropped: a table without its id or status
   * column is not a narrower table, it is a useless one. If even those do not
   * fit we let it wrap rather than hide identity.
   */
  private fitColumns(columns: ColumnSpec[]): ColumnSpec[] {
    const budget = Math.max(40, this.options.capabilities.columns - 4);
    const cost = (column: ColumnSpec) =>
      Math.min(column.width ?? 24, Math.max(stringWidth(column.header) + 2, 12)) + 3;

    const sorted = [...columns].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
    const kept: ColumnSpec[] = [];
    let used = 0;

    for (const column of sorted) {
      const next = used + cost(column);
      if ((column.priority ?? 2) === 0 || next <= budget) {
        kept.push(column);
        used = next;
      }
    }
    // Restore the author's declared order; sorting was only for the budget.
    return columns.filter((c) => kept.includes(c));
  }

  private renderRecord(data: unknown, fields?: ColumnSpec[], fieldsOnly?: boolean): void {
    if (data === null || data === undefined) {
      this.options.write(`${this.colour('(empty)', pc.dim)}\n`);
      return;
    }
    if (typeof data !== 'object') {
      this.options.write(`${String(data)}\n`);
      return;
    }

    const entries = Object.entries(data as Record<string, unknown>);
    const declared = new Map((fields ?? []).map((f) => [f.key, f]));
    const ordered = [
      ...(fields ?? []).filter((f) => readPath(data, f.key) !== undefined),
      // `fieldsOnly` suppresses the spill of undeclared keys. Without it a
      // deep diagnostic payload prints in full as indented JSON, which is
      // what `system status` used to do.
      ...(fieldsOnly && fields?.length
        ? []
        : entries
            .filter(([key]) => !declared.has(key))
            .map(([key]) => ({ key, header: key }) as ColumnSpec)),
    ];

    const labelWidth = Math.max(...ordered.map((f) => stringWidth(f.header)), 0);

    for (const field of ordered) {
      const raw = readPath(data, field.key);
      if (raw === undefined) continue;
      const label = field.header.padEnd(labelWidth);

      // Nested objects and arrays print as indented JSON rather than being
      // flattened into an unreadable single line.
      if (raw !== null && typeof raw === 'object' && !field.format) {
        const json = JSON.stringify(raw, null, 2)
          .split('\n')
          .map((line, index) => (index === 0 ? line : `${' '.repeat(labelWidth + 2)}${line}`))
          .join('\n');
        this.options.write(`${this.colour(label, pc.dim)}  ${json}\n`);
        continue;
      }

      let value = formatCell(raw, field.format, { unicode: this.options.unicode });
      if (field.format === 'status' && this.options.color) {
        value = TONE_COLOR[statusTone(String(raw))]!(value);
      }
      this.options.write(`${this.colour(label, pc.dim)}  ${value}\n`);
    }
  }

  /** Live output from a streaming command. */
  handleEvent(event: {
    type: string;
    text?: string;
    message?: string;
    level?: string;
    channel?: string;
    kind?: string;
    data?: unknown;
    row?: unknown;
  }): void {
    if (this.options.mode === 'quiet') return;

    if (this.options.mode === 'ndjson') {
      this.writeFrame(this.eventToFrame(event));
      return;
    }

    if (this.options.mode === 'json' || this.options.mode === 'yaml') {
      // `--json`/`--yaml` promise exactly one bounded document. Writing
      // each event here as it arrived is what previously interleaved raw
      // stream frames with the final envelope — a `--json` consumer got
      // several concatenated JSON values, not the one document promised.
      // The command's own return value is the single source of truth for
      // what gets printed; nothing streams ahead of it in these modes.
      return;
    }

    switch (event.type) {
      case 'chunk':
        if (event.channel === 'thinking') {
          this.options.write(this.colour(event.text ?? '', pc.dim));
        } else if (event.channel === 'stderr') {
          this.options.writeError(event.text ?? '');
        } else {
          this.options.write(event.text ?? '');
        }
        return;
      case 'log': {
        const message = event.message ?? '';
        const painted =
          event.level === 'error'
            ? this.colour(message, pc.red)
            : event.level === 'warn'
              ? this.colour(message, pc.yellow)
              : event.level === 'debug'
                ? this.colour(message, pc.dim)
                : message;
        // Logs go to stderr so `--json`-less streaming output can still be
        // piped: `run watch | tee log` must capture the model's words, not
        // the progress chatter.
        this.options.writeError(`${painted}\n`);
        return;
      }
      case 'progress':
        this.options.writeError(`${this.colour(event.message ?? '', pc.dim)}\n`);
        return;
    }
  }

  /** Maps a live `CliEvent` onto a versioned NDJSON frame. */
  private eventToFrame(event: {
    type: string;
    text?: string;
    message?: string;
    level?: string;
    channel?: string;
    kind?: string;
    data?: unknown;
    row?: unknown;
  }): NdjsonFrame {
    switch (event.type) {
      case 'chunk':
        return { v: 1, frame: 'data', kind: 'chunk', data: { text: event.text, channel: event.channel } };
      case 'row':
        return { v: 1, frame: 'data', kind: 'row', data: event.row };
      case 'stream':
        return { v: 1, frame: 'data', kind: event.kind ?? 'stream', data: event.data };
      case 'log':
        return {
          v: 1,
          frame: event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'lifecycle',
          kind: 'log',
          message: event.message,
        };
      case 'progress':
        return { v: 1, frame: 'lifecycle', kind: 'progress', message: event.message };
      default:
        return { v: 1, frame: 'data', kind: event.type, data: event };
    }
  }
}

const ASCII_TABLE_CHARS = {
  top: '-',
  'top-mid': '+',
  'top-left': '+',
  'top-right': '+',
  bottom: '-',
  'bottom-mid': '+',
  'bottom-left': '+',
  'bottom-right': '+',
  left: '|',
  'left-mid': '+',
  mid: '-',
  'mid-mid': '+',
  right: '|',
  'right-mid': '+',
  middle: '|',
};
