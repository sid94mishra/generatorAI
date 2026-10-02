// ────────────────────────────────────────────────────────────────
// Diff row model — pure.
//
// The server answers `GET /workspaces/:id/changes/file?form=patch` with a
// raw unified diff; client-core's `parseUnifiedDiff` turns it into hunks and
// rows. This module turns THAT into what a virtualised list can draw:
//
//   * one flat array of rows (hunk header | line | notice), every row a
//     fixed height at the current font size so LegendList never measures;
//   * per-hunk collapse without re-parsing;
//   * split-view pairing (old | new) for wide screens;
//   * the content width the unwrapped surface needs, computed from the
//     longest line instead of the old `width: 760` guess (D13).
//
// CRLF is normalised BEFORE parsing. The server snapshots are byte-exact, so
// a Windows checkout can hand back `\r\n` rows whose trailing `\r` renders as
// a phantom glyph and — worse — makes an anchor stored from the phone differ
// from the LF text the server later re-matches it against. Web strips it in
// `anchorTextFor`; the phone strips it once, here, for everything.
//
// No React Native import: everything in here is unit-tested in node.
// ────────────────────────────────────────────────────────────────

import { parseUnifiedDiff, type DiffHunk, type DiffRow, type ParsedDiff } from '@generatorai/client-core';

export type DiffSide = 'additions' | 'deletions';

export interface HunkRowModel {
  type: 'hunk';
  key: string;
  hunkIndex: number;
  hunk: DiffHunk;
  label: string;
  collapsed: boolean;
  /** Rows hidden behind a collapsed header. */
  hiddenCount: number;
}

export interface LineRowModel {
  type: 'line';
  key: string;
  hunkIndex: number;
  row: DiffRow;
  /** The line number a review comment anchors to, and on which side. */
  anchor: { side: DiffSide; line: number };
}

export interface NoticeRowModel {
  type: 'notice';
  key: string;
  tone: 'warning' | 'muted';
  text: string;
}

export type DiffRowModel = HunkRowModel | LineRowModel | NoticeRowModel;

/** Strip `\r` from every line end so CRLF and LF files render — and anchor — alike. */
export function normalizeEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/** Parse a patch with CRLF normalised first. Never throws (see client-core). */
export function parsePatch(patch: string): ParsedDiff {
  return parseUnifiedDiff(normalizeEol(patch));
}

export function hunkLabel(hunk: DiffHunk): string {
  const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return hunk.section ? `${range} ${hunk.section}` : range;
}

/** Which side a row's comment anchors to, and the number on that side. */
export function anchorFor(row: DiffRow): { side: DiffSide; line: number } {
  if (row.kind === 'del') return { side: 'deletions', line: row.oldNumber ?? 0 };
  return { side: 'additions', line: row.newNumber ?? row.oldNumber ?? 0 };
}

export interface BuildRowsOptions {
  /** Hunk indices whose lines are hidden. */
  collapsed?: ReadonlySet<number>;
  /** Server said the patch was cut short. */
  truncated?: boolean;
}

/**
 * Flatten hunks into list rows.
 *
 * Keys carry the hunk index because line numbers repeat between hunks and
 * are absent on one side of every add/delete.
 */
export function buildRows(parsed: ParsedDiff, options: BuildRowsOptions = {}): DiffRowModel[] {
  const collapsed = options.collapsed ?? new Set<number>();
  const rows: DiffRowModel[] = [];

  parsed.hunks.forEach((hunk, hi) => {
    const isCollapsed = collapsed.has(hi);
    rows.push({
      type: 'hunk',
      key: `h${hi}`,
      hunkIndex: hi,
      hunk,
      label: hunkLabel(hunk),
      collapsed: isCollapsed,
      hiddenCount: isCollapsed ? hunk.rows.length : 0,
    });
    if (isCollapsed) return;
    hunk.rows.forEach((row, ri) => {
      rows.push({ type: 'line', key: `h${hi}r${ri}`, hunkIndex: hi, row, anchor: anchorFor(row) });
    });
  });

  if (options.truncated || parsed.truncated) {
    rows.push({
      type: 'notice',
      key: 'truncated',
      tone: 'warning',
      text: 'The server truncated this diff because the file is very large.',
    });
  }

  return rows;
}

/** Indices of the hunk headers, for `stickyHeaderIndices`. */
export function hunkHeaderIndices(rows: readonly { type: string }[]): number[] {
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (row.type === 'hunk') out.push(i);
  });
  return out;
}

// ── Geometry ─────────────────────────────────────────────────────

export const MIN_DIFF_FONT = 10;
export const MAX_DIFF_FONT = 18;
export const DEFAULT_DIFF_FONT = 12;

export function clampFont(size: number): number {
  return Math.min(MAX_DIFF_FONT, Math.max(MIN_DIFF_FONT, Math.round(size)));
}

/** Line box height for a monospace line at `fontSize`. */
export function lineHeightFor(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

/** Fixed row height (a line box plus 1pt of breathing room each side). */
export function rowHeightFor(fontSize: number): number {
  return lineHeightFor(fontSize) + 2;
}

/** Hunk headers and notices carry padding and a border. */
export function headerHeightFor(fontSize: number): number {
  return lineHeightFor(fontSize) + 10;
}

/**
 * Approximate advance width of one monospace glyph. JetBrains Mono is 0.6em;
 * the system fallbacks sit within a few percent of that.
 */
export const MONO_ADVANCE = 0.6;

/** Width of the line-number gutter for numbers up to `maxLine`. */
export function gutterWidthFor(maxLine: number, fontSize: number): number {
  const digits = Math.max(2, String(Math.max(1, maxLine)).length);
  return Math.ceil(digits * fontSize * MONO_ADVANCE) + 8;
}

export function longestLine(parsed: ParsedDiff): number {
  let max = 0;
  for (const hunk of parsed.hunks) {
    for (const row of hunk.rows) if (row.content.length > max) max = row.content.length;
  }
  return max;
}

export function maxLineNumber(parsed: ParsedDiff): number {
  let max = 0;
  for (const hunk of parsed.hunks) {
    max = Math.max(max, hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines);
  }
  return max;
}

/**
 * How wide the unwrapped surface must be so nothing is clipped.
 *
 * Replaces the `width: 760` constant: a 40-column file no longer scrolls
 * sideways into empty space, and a 300-column line is finally reachable.
 */
export function contentWidthFor(input: {
  longest: number;
  gutter: number;
  fontSize: number;
  viewport: number;
  /** Extra columns for the +/- marker and right padding. */
  markerWidth?: number;
}): number {
  const marker = input.markerWidth ?? 16;
  const text = Math.ceil(input.longest * input.fontSize * MONO_ADVANCE);
  return Math.max(input.viewport, input.gutter + marker + text + 24);
}

// ── Split view ───────────────────────────────────────────────────

export interface SplitRowModel {
  type: 'split';
  key: string;
  hunkIndex: number;
  left: DiffRow | null;
  right: DiffRow | null;
}

export type SplitDiffRowModel = HunkRowModel | NoticeRowModel | SplitRowModel;

/**
 * Pair deletions with the additions that replace them, GitHub-style: a run
 * of `-` lines followed by a run of `+` lines zips row for row, and the
 * longer run pads with blanks.
 */
export function toSplitRows(rows: readonly DiffRowModel[]): SplitDiffRowModel[] {
  const out: SplitDiffRowModel[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.type !== 'line') {
      out.push(row);
      i += 1;
      continue;
    }
    if (row.row.kind === 'context') {
      out.push({ type: 'split', key: row.key, hunkIndex: row.hunkIndex, left: row.row, right: row.row });
      i += 1;
      continue;
    }
    const dels: LineRowModel[] = [];
    const adds: LineRowModel[] = [];
    while (i < rows.length) {
      const r = rows[i]!;
      if (r.type !== 'line' || r.row.kind === 'context') break;
      if (r.row.kind === 'del') {
        if (adds.length > 0) break;
        dels.push(r);
      } else adds.push(r);
      i += 1;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k += 1) {
      const left = dels[k] ?? null;
      const right = adds[k] ?? null;
      out.push({
        type: 'split',
        key: `${left?.key ?? '-'}|${right?.key ?? '-'}`,
        hunkIndex: (left ?? right)!.hunkIndex,
        left: left?.row ?? null,
        right: right?.row ?? null,
      });
    }
  }
  return out;
}

/** Split view is worth it from ~700pt: two 40-column panes with gutters. */
export const SPLIT_MIN_WIDTH = 700;

export function prefersSplit(viewportWidth: number, override: 'auto' | 'unified' | 'split' = 'auto'): boolean {
  if (override === 'split') return true;
  if (override === 'unified') return false;
  return viewportWidth >= SPLIT_MIN_WIDTH;
}

// ── Language ─────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  diff: 'diff',
  patch: 'diff',
};

/** Language alias for the highlighter: the server's hint first, then the extension. */
export function languageForPath(path: string, hint?: string | null): string | null {
  if (hint) return hint;
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return EXT_LANG[path.slice(dot + 1).toLowerCase()] ?? null;
}

// ── Selection helpers ────────────────────────────────────────────

/** Text of the lines in `[start, end]` on `side`, joined with LF — the review anchor. */
export function anchorText(parsed: ParsedDiff, side: DiffSide, start: number, end: number): string {
  const lines: string[] = [];
  for (const hunk of parsed.hunks) {
    for (const row of hunk.rows) {
      const number = side === 'deletions' ? row.oldNumber : row.newNumber;
      if (number === undefined) continue;
      if (side === 'deletions' && row.kind === 'add') continue;
      if (side === 'additions' && row.kind === 'del') continue;
      if (number >= start && number <= end) lines.push(row.content);
    }
  }
  return lines.join('\n');
}
