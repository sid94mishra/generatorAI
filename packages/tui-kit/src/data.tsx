// ────────────────────────────────────────────────────────────────
// Data display: tables, virtualised lists, trees, empty states.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import {
  formatCell,
  readPath,
  singleLine,
  statusTone,
  type ColumnSpec,
} from '@generatorai/cli-core';
import { statusStyle, useTheme, type Theme } from './theme.js';
import { useTerminalSize, useVirtualWindow, useSpinnerFrame } from './hooks.js';

// ── StatusPill ────────────────────────────────────────────────────

export function StatusPill({ status }: { status: string | null | undefined }): React.JSX.Element {
  const theme = useTheme();
  const { color, glyph } = statusStyle(theme, statusTone(status));
  return (
    <Text color={color}>
      {glyph} {status ?? 'unknown'}
    </Text>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral';
}): React.JSX.Element {
  const theme = useTheme();
  const { color } = statusStyle(theme, tone);
  return (
    <Text color={color}>
      [{children}]
    </Text>
  );
}

// ── Spinner ───────────────────────────────────────────────────────

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  const theme = useTheme();
  // Animation is suppressed where it would be noise or waste: CI logs and
  // screen readers both get a static marker instead.
  const animate = !/^(ascii)$/.test(theme.glyphs.spinner[0] ?? '') && theme.ladder !== 'none';
  const frame = useSpinnerFrame(80, animate);
  const glyph = animate
    ? theme.glyphs.spinner[frame % theme.glyphs.spinner.length]
    : theme.glyphs.running;

  return (
    <Text color={theme.c('running')}>
      {glyph}
      {label ? ` ${label}` : ''}
    </Text>
  );
}

// ── EmptyState ────────────────────────────────────────────────────

export interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: string;
}

export function EmptyState({ title, hint, action }: EmptyStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      <Text color={theme.c('muted')}>{title}</Text>
      {hint ? <Text color={theme.c('muted')}>{hint}</Text> : null}
      {action ? (
        <Box marginTop={1}>
          <Text color={theme.c('primary')}>{action}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── Table ─────────────────────────────────────────────────────────

export interface TableProps<T> {
  rows: T[];
  columns: ColumnSpec[];
  selectedIndex?: number;
  /** Viewport height in rows, excluding the header. */
  height: number;
  onRenderCell?: (row: T, column: ColumnSpec, text: string) => React.ReactNode;
  emptyMessage?: string;
}

/**
 * A virtualised table.
 *
 * Column widths are computed from the VISIBLE window rather than the whole
 * dataset: measuring 10,000 rows to size a column costs more than rendering
 * the twenty that are on screen, and the widths would jitter anyway as the
 * user scrolls past a long value.
 */
export function Table<T>({
  rows,
  columns,
  selectedIndex = 0,
  height,
  onRenderCell,
  emptyMessage = 'Nothing here yet.',
}: TableProps<T>): React.JSX.Element {
  const theme = useTheme();
  const { columns: terminalColumns } = useTerminalSize();
  const bodyHeight = Math.max(1, height - 1);
  const window = useVirtualWindow(rows.length, bodyHeight, selectedIndex);

  const visibleRows = rows.slice(window.start, window.end);
  const layout = useMemo(
    () => computeLayout(columns, visibleRows, terminalColumns - 4, theme),
    [columns, visibleRows, terminalColumns, theme],
  );

  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.c('muted')}>{'  '}</Text>
        {layout.map((column) => (
          <Text key={column.spec.key} bold color={theme.c('muted')}>
            {pad(column.spec.header, column.width, column.spec.align)}
            {'  '}
          </Text>
        ))}
      </Box>

      {visibleRows.map((row, offset) => {
        const index = window.start + offset;
        const selected = index === selectedIndex;
        return (
          <Box key={index}>
            <Text color={selected ? theme.c('primary') : undefined}>
              {selected ? `${theme.glyphs.arrowRight} ` : '  '}
            </Text>
            {layout.map((column) => {
              const raw = readPath(row, column.spec.key);
              const text = pad(
                singleLine(
                  formatCell(raw, column.spec.format, { unicode: theme.glyphs === undefined ? false : true }),
                  column.width,
                ),
                column.width,
                column.spec.align,
              );
              const custom = onRenderCell?.(row, column.spec, text);
              if (custom !== undefined && custom !== null) {
                return (
                  <Box key={column.spec.key} marginRight={2}>
                    {custom}
                  </Box>
                );
              }
              return (
                <Text
                  key={column.spec.key}
                  color={cellColour(theme, column.spec, raw, selected)}
                  bold={selected && column.spec.priority === 0}
                >
                  {text}
                  {'  '}
                </Text>
              );
            })}
          </Box>
        );
      })}

      {window.hasBelow || window.hasAbove ? (
        <Text color={theme.c('muted')}>
          {'  '}
          {window.start + 1}–{window.end} of {rows.length}
        </Text>
      ) : null}
    </Box>
  );
}

interface LaidOutColumn {
  spec: ColumnSpec;
  width: number;
}

/**
 * Fits columns into the available width.
 *
 * Priority-0 columns are never dropped: a table without its identity column
 * is not narrower, it is useless. Remaining space is shared between the
 * flexible columns rather than given entirely to the first.
 */
function computeLayout<T>(
  columns: ColumnSpec[],
  rows: T[],
  available: number,
  _theme: Theme,
): LaidOutColumn[] {
  const natural = columns.map((spec) => {
    const header = stringWidth(spec.header);
    const widest = rows.reduce((max, row) => {
      const text = formatCell(readPath(row, spec.key), spec.format, {});
      return Math.max(max, stringWidth(singleLine(text, 80)));
    }, 0);
    return { spec, width: Math.min(spec.width ?? 48, Math.max(header, widest, 3)) };
  });

  const gutter = 2;
  const totalGutter = gutter * natural.length + 2;
  let total = natural.reduce((sum, c) => sum + c.width, 0) + totalGutter;

  if (total <= available) return natural;

  // Drop the lowest-priority columns until it fits.
  const dropOrder = [...natural]
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => (column.spec.priority ?? 2) > 0)
    .sort((a, b) => (b.column.spec.priority ?? 2) - (a.column.spec.priority ?? 2));

  const dropped = new Set<number>();
  for (const { column, index } of dropOrder) {
    if (total <= available) break;
    dropped.add(index);
    total -= column.width + gutter;
  }

  const kept = natural.filter((_, index) => !dropped.has(index));

  // Still too wide (all that is left is priority 0): shrink proportionally
  // rather than letting Ink wrap and break row alignment.
  const keptTotal = kept.reduce((sum, c) => sum + c.width, 0) + gutter * kept.length + 2;
  if (keptTotal > available && kept.length > 0) {
    const scale = (available - gutter * kept.length - 2) / (keptTotal - gutter * kept.length - 2);
    return kept.map((column) => ({ ...column, width: Math.max(4, Math.floor(column.width * scale)) }));
  }

  return kept;
}

function pad(text: string, width: number, align: ColumnSpec['align'] = 'left'): string {
  const actual = stringWidth(text);
  if (actual > width) {
    // Truncate by code points, then re-measure: slicing by length breaks CJK
    // and emoji, which occupy two columns per code point.
    let out = '';
    let used = 0;
    for (const char of text) {
      const charWidth = stringWidth(char);
      if (used + charWidth > width - 1) break;
      out += char;
      used += charWidth;
    }
    return align === 'right' ? `…${out}`.padStart(width) : `${out}…`.padEnd(width);
  }
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

function cellColour(
  theme: Theme,
  spec: ColumnSpec,
  raw: unknown,
  selected: boolean,
): string | undefined {
  if (spec.format === 'status') return statusStyle(theme, statusTone(String(raw))).color;
  if (spec.format === 'id') return theme.c('muted');
  if (selected) return theme.c('foreground');
  if ((spec.priority ?? 2) >= 3) return theme.c('muted');
  return undefined;
}

// ── VirtualList ───────────────────────────────────────────────────

export interface VirtualListProps<T> {
  items: T[];
  selectedIndex: number;
  height: number;
  renderItem: (item: T, index: number, selected: boolean) => React.ReactNode;
  emptyMessage?: string;
}

export function VirtualList<T>({
  items,
  selectedIndex,
  height,
  renderItem,
  emptyMessage = 'Nothing here yet.',
}: VirtualListProps<T>): React.JSX.Element {
  const theme = useTheme();
  const window = useVirtualWindow(items.length, Math.max(1, height), selectedIndex);

  if (items.length === 0) return <EmptyState title={emptyMessage} />;

  return (
    <Box flexDirection="column">
      {window.hasAbove ? (
        <Text color={theme.c('muted')}>{`  ${theme.glyphs.ellipsis} ${window.start} more above`}</Text>
      ) : null}
      {items.slice(window.start, window.end).map((item, offset) => {
        const index = window.start + offset;
        return (
          <Box key={index}>{renderItem(item, index, index === selectedIndex)}</Box>
        );
      })}
      {window.hasBelow ? (
        <Text color={theme.c('muted')}>
          {`  ${theme.glyphs.ellipsis} ${items.length - window.end} more below`}
        </Text>
      ) : null}
    </Box>
  );
}

// ── Tree ──────────────────────────────────────────────────────────

export interface TreeNode {
  id: string;
  label: string;
  depth: number;
  isLast: boolean;
  status?: string | null;
  detail?: string;
  /** Rendered as a back-reference rather than expanded again. */
  repeat?: boolean;
}

export function Tree({
  nodes,
  selectedIndex,
  height,
}: {
  nodes: TreeNode[];
  selectedIndex?: number;
  height: number;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <VirtualList
      items={nodes}
      selectedIndex={selectedIndex ?? 0}
      height={height}
      emptyMessage="No stages."
      renderItem={(node, _index, selected) => (
        <Text color={selected ? theme.c('primary') : undefined}>
          {selected ? theme.glyphs.arrowRight : ' '}
          {' '.repeat(node.depth * 2)}
          {node.depth > 0 ? (node.isLast ? theme.glyphs.treeLast : theme.glyphs.treeBranch) : ''}
          {node.status ? ` ${statusStyle(theme, statusTone(node.status)).glyph}` : ''} {node.label}
          {node.repeat ? <Text color={theme.c('muted')}> (see above)</Text> : null}
          {node.detail ? <Text color={theme.c('muted')}>{`  ${node.detail}`}</Text> : null}
        </Text>
      )}
    />
  );
}

// ── ProgressBar / Gauge ───────────────────────────────────────────

export function ProgressBar({
  value,
  max = 1,
  width = 20,
  tone = 'running',
}: {
  value: number;
  max?: number;
  width?: number;
  tone?: 'running' | 'success' | 'failure' | 'warning';
}): React.JSX.Element {
  const theme = useTheme();
  const ratio = max === 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  const { color } = statusStyle(theme, tone);

  return (
    <Text>
      <Text color={color}>{theme.glyphs.progressFull.repeat(filled)}</Text>
      <Text color={theme.c('borderMuted')}>{theme.glyphs.progressEmpty.repeat(width - filled)}</Text>
    </Text>
  );
}

/** Context-window usage; turns amber then red as the window fills. */
export function ContextGauge({
  used,
  total,
  width = 12,
}: {
  used: number;
  total: number;
  width?: number;
}): React.JSX.Element {
  const theme = useTheme();
  const ratio = total === 0 ? 0 : used / total;
  const tone = ratio > 0.9 ? 'failure' : ratio > 0.75 ? 'warning' : 'running';

  return (
    <Text color={theme.c('muted')}>
      ctx {Math.round(ratio * 100)}% <ProgressBar value={ratio} width={width} tone={tone} />
    </Text>
  );
}
