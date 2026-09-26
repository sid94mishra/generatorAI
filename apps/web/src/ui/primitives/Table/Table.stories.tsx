import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Icon } from '../../icons/Icon.js';
import { Checkbox } from '../Checkbox/Checkbox.js';
import { IconButton } from '../IconButton/IconButton.js';
import { StatusBadge } from '../StatusBadge/StatusBadge.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from './Table.js';

const ROWS = [
  { id: 'a1', name: 'Nightly audit', state: 'succeeded', trigger: 'Daily 02:00', icon: 'calendar', last: '02:14', runs: 248 },
  { id: 'a2', name: 'Review every PR', state: 'running', trigger: 'Webhook', icon: 'webhook', last: '13:58', runs: 311 },
  { id: 'a3', name: 'Weekly release notes', state: 'paused', trigger: 'Fri 16:00', icon: 'calendar', last: 'Sep 19', runs: 36 },
  { id: 'a4', name: 'Triage flaky tests', state: 'needs_you', trigger: 'Manual', icon: 'play', last: '11:20', runs: 12 },
] as const;

const COLUMNS = [14, 'minmax(200px,1fr)', 150, 140, 80, 56, 32];

/** The Components board "Table" (44px rows, fixed columns, numbers right-aligned in mono). */
function AutomationsTable() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['a2']));
  const [sort, setSort] = useState<'ascending' | 'descending'>('descending');
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Table columns={COLUMNS} label="Automations" className="w-200">
      <TableHeader>
        <TableHeadCell>
          <Checkbox
            aria-label="Select all"
            checked={selected.size === ROWS.length}
            indeterminate={selected.size > 0 && selected.size < ROWS.length}
            onCheckedChange={(v) => setSelected(v ? new Set(ROWS.map((r) => r.id)) : new Set())}
          />
        </TableHeadCell>
        <TableHeadCell>Automation</TableHeadCell>
        <TableHeadCell>Status</TableHeadCell>
        <TableHeadCell>Trigger</TableHeadCell>
        <TableHeadCell align="end" sort={sort} onSort={() => setSort((s) => (s === 'ascending' ? 'descending' : 'ascending'))}>
          Last run
        </TableHeadCell>
        <TableHeadCell align="end">Runs</TableHeadCell>
        <TableHeadCell>
          <span className="sr-only">Actions</span>
        </TableHeadCell>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id} selected={selected.has(row.id)}>
            <TableCell>
              <Checkbox aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onCheckedChange={() => toggle(row.id)} />
            </TableCell>
            <TableCell>
              <span className="truncate">{row.name}</span>
            </TableCell>
            <TableCell>
              <StatusBadge state={row.state} />
            </TableCell>
            <TableCell className="gap-2 text-fg-2">
              <Icon concept={row.icon} size={14} className="text-fg-3" />
              <span className="truncate">{row.trigger}</span>
            </TableCell>
            <TableCell align="end" mono>
              {row.last}
            </TableCell>
            <TableCell align="end" mono>
              {row.runs}
            </TableCell>
            <TableCell actions>
              <IconButton size="sm" icon="more" label={`More for ${row.name}`} tooltip={false} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const meta = {
  component: Table,
  subcomponents: { TableHeader, TableHeadCell, TableBody, TableRow, TableCell },
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { columns: COLUMNS },
  render: () => <AutomationsTable />,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Automations' })).toBeVisible();
    const head = canvas.getByRole('columnheader', { name: /Last run/ });
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(canvas.getByRole('button', { name: /Last run/ }));
    await expect(head).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select all' }));
    await expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(4);
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } } };

/** Dense rows (run-dialog stages, package tables). */
export const Dense: Story = {
  render: () => (
    <Table columns={['1fr', 100, 80]} size="dense" inset="card" label="Packages" className="w-120">
      <TableHeader>
        <TableHeadCell>Package</TableHeadCell>
        <TableHeadCell>From</TableHeadCell>
        <TableHeadCell align="end">To</TableHeadCell>
      </TableHeader>
      <TableBody>
        {['react', 'vite', 'vitest'].map((name, i) => (
          <TableRow key={name}>
            <TableCell className="font-mono text-small">{name}</TableCell>
            <TableCell mono>{`${i + 18}.2.0`}</TableCell>
            <TableCell align="end" mono>{`${i + 19}.0.0`}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Compact: Story = { globals: { density: 'compact' } };
