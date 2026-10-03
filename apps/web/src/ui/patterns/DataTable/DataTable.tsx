// ────────────────────────────────────────────────────────────────
// C-05 DataTable (03 §3 C-05; Rosetta `.th` / `.tr`; ChatsList).
//
// P-43 Table parts driven by column definitions: `width`, `align`, `mono`,
// `hideBelow` (the column drops when the TABLE is narrower than that many
// px — measured, so it follows the main card, not the window), `sortable`.
// Optional checkbox column with a mixed select-all, row click, trailing row
// actions (shown on hover / focus / selection), a footer note.
// States: `loading` (skeleton rows, `aria-busy`), `error` and `empty` (the
// node you pass — a framed EmptyState — replaces the table).
// The table scrolls inside a ScrollArea with a sticky header;
// `virtualized` renders only the visible rows (TanStack Virtual 3, rows are
// measured so density changes need no estimate) and `onEndReached` asks for
// the next page near the bottom.
// Keyboard: put a Link in the title cell; row click is a pointer shortcut.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../lib/cn.js';
import { Checkbox } from '../../primitives/Checkbox/Checkbox.js';
import { ScrollArea } from '../../primitives/ScrollArea/ScrollArea.js';
import { SkeletonRows } from '../../primitives/Skeleton/Skeleton.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHeadCell,
  TableHeader,
  TableRow,
  type TableInset,
  type TableSize,
} from '../../primitives/Table/Table.js';

export interface DataTableColumn<Row> {
  id: string;
  /** Header text (also the column's accessible name). */
  header: ReactNode;
  /** Track size: px number or CSS track (`'minmax(240px,1fr)'`). */
  width: number | string;
  align?: 'start' | 'end';
  /** Mono micro fg-3 cells (paths, times, counts). */
  mono?: boolean;
  /** Hide the column when the table is narrower than this (px). */
  hideBelow?: number;
  sortable?: boolean;
  cell: (row: Row) => ReactNode;
  className?: string;
}

export interface DataTableSort {
  columnId: string;
  direction: 'ascending' | 'descending';
}

export interface DataTableProps<Row> {
  /** Accessible name of the table ("Chats"). */
  label: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Selected ids; with `onSelectionChange` a checkbox column appears. */
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** Name used in the row checkbox label ("Select Fix flaky checkout test"). */
  getRowLabel?: (row: Row) => string;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  /** Trailing actions (sm IconButtons, a MenuButton). */
  rowActions?: (row: Row) => ReactNode;
  actionsWidth?: number;
  /** Keep the row actions visible instead of revealing them on hover / focus / selection. */
  alwaysShowActions?: boolean;
  onRowClick?: (row: Row) => void;
  virtualized?: boolean;
  /** Called when the last rows scroll into view (virtualized). */
  onEndReached?: () => void;
  loading?: boolean;
  loadingRows?: number;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Shown instead of the table when loading failed (takes precedence). */
  error?: ReactNode;
  /** Note under the table ("Showing 12 of 48 · Scroll to load more"). */
  footer?: ReactNode;
  size?: TableSize;
  inset?: TableInset;
  className?: string;
  'data-testid'?: string;
}

/** Measures an element's width (for `hideBelow`). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const ESTIMATED_ROW = 44;

/** A data-driven list table: columns, selection, sort, row actions, states, virtualization. */
export function DataTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  selection,
  onSelectionChange,
  getRowLabel,
  sort,
  onSortChange,
  rowActions,
  alwaysShowActions = false,
  actionsWidth = 64,
  onRowClick,
  virtualized = false,
  onEndReached,
  loading = false,
  loadingRows = 5,
  empty,
  error,
  footer,
  size = 'md',
  inset = 'page',
  className,
  'data-testid': testId,
}: DataTableProps<Row>) {
  // TanStack Virtual's useVirtualizer returns a mutable instance whose methods
  // the React Compiler cannot track, so memoised children would go stale
  // (P8-02, D-85).
  'use no memo';
  const [containerRef, width] = useWidth<HTMLDivElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // The sticky header's height (density changes it) offsets the virtual rows.
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerObserver = useRef<ResizeObserver | null>(null);
  const headerRef = useCallback((node: HTMLDivElement | null) => {
    headerObserver.current?.disconnect();
    if (!node) return;
    setHeaderHeight(node.offsetHeight);
    headerObserver.current = new ResizeObserver(() => setHeaderHeight(node.offsetHeight));
    headerObserver.current.observe(node);
  }, []);
  const selectable = onSelectionChange !== undefined;
  const selected = selection ?? new Set<string>();

  const visible = columns.filter((c) => c.hideBelow === undefined || width === null || width >= c.hideBelow);
  const tracks = [...(selectable ? [14] : []), ...visible.map((c) => c.width), ...(rowActions ? [actionsWidth] : [])];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 8,
    // The sticky header scrolls with the body: rows start below it.
    scrollMargin: headerHeight,
    getItemKey: (index) => {
      const row = rows[index];
      return row === undefined ? index : getRowId(row);
    },
  });
  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];
  const lastVisible = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (virtualized && onEndReached && rows.length > 0 && lastVisible >= rows.length - 5) onEndReached();
  }, [virtualized, onEndReached, lastVisible, rows.length]);

  const allIds = rows.map(getRowId);
  const selectedCount = allIds.filter((id) => selected.has(id)).length;
  const toggleAll = (checked: boolean) => onSelectionChange?.(checked ? new Set(allIds) : new Set());
  const toggleRow = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  };

  const onSort = (column: DataTableColumn<Row>) => {
    const direction = sort?.columnId === column.id && sort.direction === 'descending' ? 'ascending' : 'descending';
    onSortChange?.({ columnId: column.id, direction });
  };

  const renderRow = (row: Row, index: number, virtual?: { start: number }) => {
    const id = getRowId(row);
    const isSelected = selected.has(id);
    return (
      <TableRow
        key={id}
        selected={selectable ? isSelected : undefined}
        interactive={onRowClick !== undefined}
        aria-rowindex={virtual ? index + 2 : undefined}
        data-row-id={id}
        {...(virtual
          ? {
              'data-index': index,
              ref: virtualizer.measureElement,
              style: { transform: `translateY(${virtual.start - headerHeight}px)` },
              className: 'absolute inset-x-0 top-0',
            }
          : {})}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {selectable ? (
          <TableCell onClick={(event: MouseEvent) => event.stopPropagation()}>
            <Checkbox
              aria-label={`Select ${getRowLabel ? getRowLabel(row) : id}`}
              checked={isSelected}
              onCheckedChange={(checked) => toggleRow(id, checked)}
            />
          </TableCell>
        ) : null}
        {visible.map((column) => (
          <TableCell key={column.id} align={column.align} mono={column.mono} className={column.className}>
            {column.cell(row)}
          </TableCell>
        ))}
        {rowActions ? (
          <TableCell actions={alwaysShowActions ? 'always' : true} onClick={(event: MouseEvent) => event.stopPropagation()}>
            {rowActions(row)}
          </TableCell>
        ) : null}
      </TableRow>
    );
  };

  const showState = !loading && rows.length === 0 ? (error ?? empty ?? null) : !loading && error ? error : null;

  return (
    <div ref={containerRef} className={cn('flex min-h-0 min-w-0 flex-col gap-3', className)} data-testid={testId}>
      {showState ?? (
        // The border lives on this wrapper and the ScrollArea wraps the whole
        // table (sticky header inside): neither the focusable viewport nor the
        // loading skeleton (a status region) may be a child of role="table"
        // (aria-required-children).
        <div className="flex min-h-0 shrink flex-col overflow-hidden rounded-card border border-line-soft">
          <ScrollArea viewportRef={viewportRef} className="min-h-0 shrink">
            <Table
              columns={tracks}
              size={size}
              inset={inset}
              label={label}
              bare
              aria-busy={loading || undefined}
              aria-rowcount={virtualized && !loading ? rows.length + 1 : undefined}
            >
              <TableHeader ref={headerRef} className="sticky top-0 z-sticky bg-surface">
                {selectable ? (
                  <TableHeadCell>
                    <Checkbox
                      aria-label="Select all"
                      checked={rows.length > 0 && selectedCount === rows.length}
                      indeterminate={selectedCount > 0 && selectedCount < rows.length}
                      disabled={loading || rows.length === 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHeadCell>
                ) : null}
                {visible.map((column) => (
                  <TableHeadCell
                    key={column.id}
                    align={column.align}
                    {...(column.sortable && onSortChange
                      ? { sort: sort?.columnId === column.id ? sort.direction : 'none', onSort: () => onSort(column) }
                      : {})}
                  >
                    {column.header}
                  </TableHeadCell>
                ))}
                {rowActions ? (
                  <TableHeadCell>
                    <span className="sr-only">Actions</span>
                  </TableHeadCell>
                ) : null}
              </TableHeader>
              {loading ? null : virtualized ? (
                <TableBody className="relative" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualItems.map((item) => {
                    const row = rows[item.index];
                    return row === undefined ? null : renderRow(row, item.index, { start: item.start });
                  })}
                </TableBody>
              ) : (
                <TableBody>{rows.map((row, index) => renderRow(row, index))}</TableBody>
              )}
            </Table>
          </ScrollArea>
          {loading ? <SkeletonRows rows={loadingRows} label={`Loading ${label.toLowerCase()}`} /> : null}
        </div>
      )}
      {footer != null && !showState ? <p className="shrink-0 text-small text-fg-3">{footer}</p> : null}
    </div>
  );
}
