// ────────────────────────────────────────────────────────────────
// C-13 SettingsSection / SettingRow / SettingsTable (03 §3 C-13; recipe for
// all 15 settings sections, D-32; Rosetta "flex row gap 24 pad 12 0 border-b:
// label 13/500 + hint · control"). Replaces `components/settings/shared.tsx`
// (SectionHeader, SettingRow, InfoRow, SettingsCard, SectionListHeader,
// CatalogAccordionRow — deleted in P6-11 once every section moves off it).
//
// SettingsSection: a section's title (title step, 600) + one-line
// description, right padding 40 so long descriptions clear the modal's close
// button (S-11). A group heading inside a section reuses C-12
// `<SectionHeader variant="title">`, not a part of this file.
//
// SettingRow: label (ui 500) + optional hint (small fg-3) on the left,
// `flex-shrink-0` control on the right; `border-b line-soft` between rows,
// none on the last (Tailwind's own `last:` variant, D-56's rule against
// arbitrary selectors). `stacked` wraps a full-width block onto the next line
// (the Appearance theme-tile grid) via a `basis-full` flex child — no CSS
// grid needed for that alone.
//
// SettingsTable: P-48 Card chrome (`rounded-panel border-line bg-raised`,
// P-48 has not landed yet — P5-01) around the P-43 Table primitives directly
// (not C-05 DataTable, which draws its own card border and is built for
// paged/virtualized/selectable lists the 15 settings sections don't need).
// `size="md"` (44h rows / 32h header) is the default; pass `size="dense"`
// for the 28h-row form (devices, extensions) — Table has no built-in 36h
// step between them (noted P6-01 deviation).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHeadCell,
  TableHeader,
  TableRow,
  type TableSize,
} from '../../primitives/Table/Table.js';

export interface SettingsSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
}

/** One settings section: title + description, then its rows/groups/tables as children. */
export function SettingsSection({ title, description, children, className, ...rest }: SettingsSectionProps) {
  return (
    <section className={cn('flex flex-col gap-6', className)} {...rest}>
      <div className="flex flex-col gap-0.5 pr-10">
        <h2 className="text-title text-fg">{title}</h2>
        {description != null ? <p className="text-small text-fg-3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export interface SettingRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  /** A full-width block below the row (e.g. the Appearance theme tiles). */
  stacked?: ReactNode;
}

/** label + hint on the left, a control on the right; a border between rows in the same group. */
export function SettingRow({ label, hint, control, stacked, className, ...rest }: SettingRowProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-6 border-b border-line-soft py-3 last:border-b-0', className)} {...rest}>
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium text-fg">{label}</div>
        {hint != null ? <div className="mt-0.5 text-small text-fg-3">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
      {stacked != null ? <div className="basis-full">{stacked}</div> : null}
    </div>
  );
}

export interface SettingsTableColumn<Row> {
  id: string;
  header: ReactNode;
  width: number | string;
  align?: 'start' | 'end';
  mono?: boolean;
  cell: (row: Row) => ReactNode;
}

export interface SettingsTableProps<Row> {
  /** Accessible name of the table ("MCP servers"). */
  label: string;
  columns: readonly SettingsTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Trailing actions (sm IconButtons, a MenuButton), shown on row hover/focus. */
  rowActions?: (row: Row) => ReactNode;
  actionsWidth?: number;
  /** Shown instead of the table body when there are no rows. */
  empty?: ReactNode;
  size?: TableSize;
  className?: string;
  'data-testid'?: string;
}

/** A card-framed list for settings entities (accounts, servers, devices, extensions). */
export function SettingsTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  rowActions,
  actionsWidth = 64,
  empty,
  size = 'md',
  className,
  'data-testid': testId,
}: SettingsTableProps<Row>) {
  const tracks = [...columns.map((c) => c.width), ...(rowActions ? [actionsWidth] : [])];
  return (
    <div className={cn('overflow-hidden rounded-panel border border-line bg-raised', className)} data-testid={testId}>
      {rows.length === 0 && empty != null ? (
        <div className="p-4">{empty}</div>
      ) : (
        <Table columns={tracks} size={size} inset="card" label={label} bare>
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
                <TableRow key={id} data-row-id={id}>
                  {columns.map((column) => (
                    <TableCell key={column.id} align={column.align} mono={column.mono}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                  {rowActions ? <TableCell actions>{rowActions(row)}</TableCell> : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export interface SettingsStatusFooterProps {
  icon?: IconConcept;
  children: ReactNode;
  className?: string;
}

/** The 40h "Changes apply instantly" / "Saved on this device" status bar (S-11's footer slot). */
export function SettingsStatusFooter({ icon = 'info', children, className }: SettingsStatusFooterProps) {
  return (
    <div className={cn('flex h-panel-bar shrink-0 items-center gap-2 border-t border-line-soft px-7 text-small text-fg-3', className)}>
      <Icon concept={icon} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
