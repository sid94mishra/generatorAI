// ────────────────────────────────────────────────────────────────
// WF-19 IterationsTable (03-component-inventory-domain.md §4): the compact,
// embedded row table for a batch of iterations — the loop inspector's
// "# · verdict · open · changed · turns · cost" rows, and an automation
// execution's per-row iteration list. A lighter cousin of C-05 DataTable:
// no selection/sort/virtualization (iteration counts are small), `size="dense"`
// (28h) rows by default. Plain typed props — no workflow/automation endpoint
// calls (§4 "Rule": a WF piece renders what it is given).
// ────────────────────────────────────────────────────────────────

import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow, type TableSize } from '@/ui/primitives/Table/Table.js';

export interface IterationsColumn<Row> {
  id: string;
  header: ReactNode;
  width: number | string;
  align?: 'start' | 'end';
  mono?: boolean;
  cell: (row: Row) => ReactNode;
}

export interface IterationsTableProps<Row> {
  /** Accessible name ("Iterations", "Execution #31 iterations"). */
  label: string;
  columns: readonly IterationsColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  /** Trailing per-row content (a "Changes" toggle, "Run: <id>…" link). */
  rowActions?: (row: Row) => ReactNode;
  actionsWidth?: number;
  size?: TableSize;
  className?: string;
  'data-testid'?: string;
}

/** A small, non-virtualized table of iteration rows (loop iterations, automation execution runs). */
export function IterationsTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  onRowClick,
  rowActions,
  actionsWidth = 120,
  size = 'dense',
  className,
  'data-testid': testId,
}: IterationsTableProps<Row>) {
  const tracks = [...columns.map((c) => c.width), ...(rowActions ? [actionsWidth] : [])];
  return (
    <Table columns={tracks} size={size} inset="compact" label={label} bare className={cn('gap-0', className)} data-testid={testId}>
      <TableHeader>
        {columns.map((column) => (
          <TableHeadCell key={column.id} align={column.align}>
            {column.header}
          </TableHeadCell>
        ))}
        {rowActions ? (
          <TableHeadCell>
            <span className="sr-only">Actions</span>
          </TableHeadCell>
        ) : null}
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const id = getRowId(row);
          return (
            <TableRow key={id} interactive={onRowClick !== undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((column) => (
                <TableCell key={column.id} align={column.align} mono={column.mono}>
                  {column.cell(row)}
                </TableCell>
              ))}
              {rowActions ? (
                <TableCell actions onClick={(event: MouseEvent) => event.stopPropagation()}>
                  {rowActions(row)}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
