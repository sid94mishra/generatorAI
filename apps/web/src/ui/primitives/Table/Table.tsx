// ────────────────────────────────────────────────────────────────
// P-43 Table parts (03 §2 P-43; Rosetta `.th` / `.tr`).
//
// A CSS-grid table of divs with ARIA roles (`table`, `row`, `columnheader`,
// `cell`) so TanStack Virtual can virtualise rows (C-05 DataTable). The
// column track list is set once on <Table columns={[…]}> and every row reuses
// it. Container: 1px line-soft, card radius. Header 32h (h-th) small 500 fg-3;
// rows 44h (h-row), gap 16, pad-x 20 (`inset="card"` 12, `inset="compact"` 16),
// border-b line-soft (none on the last), hover `bg-hover`, selected
// (`aria-selected`) `bg-selected`. `size="dense"` 28h rows / 24h header in
// micro; `size="lg"` 56h two-line rows. Cells: `align="end"`, `mono`,
// truncation. A trailing actions cell shows on row hover, focus or selection.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export type TableSize = 'dense' | 'md' | 'lg';
export type TableInset = 'page' | 'compact' | 'card';

interface TableContextValue {
  template: string;
  size: TableSize;
  inset: TableInset;
}

const TableContext = createContext<TableContextValue>({ template: '', size: 'md', inset: 'page' });

/** Grid tracks for a column list: numbers are px, strings pass through (`'1fr'`, `'minmax(240px,1fr)'`). */
export function columnTemplate(columns: readonly (number | string)[]): string {
  return columns.map((c) => (typeof c === 'number' ? `${c}px` : c)).join(' ');
}

const INSET: Record<TableInset, string> = { page: 'px-5', compact: 'px-4', card: 'px-3' };

export interface TableProps extends ComponentProps<'div'> {
  /** Column track sizes, one per column (px numbers or CSS track strings). */
  columns: readonly (number | string)[];
  size?: TableSize;
  inset?: TableInset;
  /** Accessible name ("Chats"). */
  label?: string;
  /** Hide the outer border/radius (the table sits inside a card). */
  bare?: boolean;
}

/** The table container; rows and header cells inherit its column template. */
export function Table({ columns, size = 'md', inset = 'page', label, bare = false, className, children, ...rest }: TableProps) {
  return (
    <TableContext.Provider value={{ template: columnTemplate(columns), size, inset }}>
      <div
        role="table"
        aria-label={label}
        className={cn('flex min-w-0 flex-col text-ui text-fg', !bare && 'overflow-hidden rounded-card border border-line-soft', className)}
        {...rest}
      >
        {children}
      </div>
    </TableContext.Provider>
  );
}

function useRowGrid(style?: CSSProperties): CSSProperties {
  const { template } = useContext(TableContext);
  return { ...style, gridTemplateColumns: template };
}

/** Header row group: one row of TableHeadCells. */
export function TableHeader({ className, children, style, ...rest }: ComponentProps<'div'>) {
  const { size, inset } = useContext(TableContext);
  const grid = useRowGrid(style);
  return (
    <div role="rowgroup" className={cn('shrink-0 border-b border-line-soft', className)} {...rest}>
      <div
        role="row"
        style={grid}
        className={cn(
          'grid items-center gap-4 font-medium text-fg-3',
          size === 'dense' ? 'min-h-6 text-micro' : 'h-th text-small',
          INSET[inset],
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Body row group. */
export function TableBody({ className, ...rest }: ComponentProps<'div'>) {
  return <div role="rowgroup" className={cn('flex min-w-0 flex-col', className)} {...rest} />;
}

export const tableRowVariants = cva(
  'group/row grid items-center gap-4 border-b border-line-soft transition-control last:border-b-0 hover:bg-hover aria-selected:bg-selected',
  {
    variants: {
      size: { dense: 'min-h-7', md: 'h-row', lg: 'h-footer' },
      interactive: { true: 'cursor-pointer', false: '' },
    },
    defaultVariants: { size: 'md', interactive: false },
  },
);

export interface TableRowProps extends ComponentProps<'div'> {
  /** Selected look + `aria-selected` (inside a selectable DataTable). */
  selected?: boolean;
  /** Pointer cursor (the row opens something on click). */
  interactive?: boolean;
}

/** One body row; lays its cells on the table's column template. */
export function TableRow({ selected, interactive = false, className, style, ...rest }: TableRowProps) {
  const { size, inset } = useContext(TableContext);
  const grid = useRowGrid(style);
  return (
    <div
      role="row"
      aria-selected={selected}
      style={grid}
      className={cn(tableRowVariants({ size, interactive }), INSET[inset], className)}
      {...rest}
    />
  );
}

export interface TableHeadCellProps extends ComponentProps<'div'> {
  align?: 'start' | 'end';
  /** Sortable column: current direction or `none`, and the toggle handler. */
  sort?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
}

/** A column header. Sortable heads render a button with a 12px chevron and `aria-sort`. */
export function TableHeadCell({ align = 'start', sort, onSort, className, children, ...rest }: TableHeadCellProps) {
  const sortable = onSort !== undefined;
  return (
    <div
      role="columnheader"
      aria-sort={sortable ? (sort ?? 'none') : undefined}
      className={cn('group/head flex min-w-0 items-center', align === 'end' && 'justify-end text-right', className)}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex min-h-6 min-w-0 cursor-pointer items-center gap-1 rounded-badge hover:text-fg',
            sort && sort !== 'none' && 'text-fg-2',
            focusRing,
          )}
        >
          <span className="truncate">{children}</span>
          <Icon
            concept={sort === 'ascending' ? 'chevron-up' : 'chevron-down'}
            size={12}
            className={sort && sort !== 'none' ? 'opacity-100' : 'opacity-0 group-hover/head:opacity-100'}
          />
        </button>
      ) : (
        <span className="truncate">{children}</span>
      )}
    </div>
  );
}

export interface TableCellProps extends ComponentProps<'div'> {
  align?: 'start' | 'end';
  /** Mono micro fg-3 (paths, times, numbers). */
  mono?: boolean;
  /** Trailing row-actions cell: visible on row hover, focus-within or selection. */
  actions?: boolean;
  children?: ReactNode;
}

/** One cell. Content truncates; wrap two-line content yourself (lg rows). */
export function TableCell({ align = 'start', mono = false, actions = false, className, ...rest }: TableCellProps) {
  return (
    <div
      role="cell"
      className={cn(
        'flex min-w-0 items-center',
        align === 'end' && 'justify-end text-right',
        mono && 'font-mono text-micro text-fg-3',
        actions &&
          'justify-end gap-1 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-aria-selected/row:opacity-100',
        className,
      )}
      {...rest}
    />
  );
}
