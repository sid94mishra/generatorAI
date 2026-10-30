import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { IterationsTable, type IterationsColumn } from './IterationsTable.js';

interface DemoIteration {
  id: string;
  index: number;
  label: string;
  state: 'succeeded' | 'running' | 'failed';
  changed: number;
  turns: number;
  cost: string;
}

const ROWS: DemoIteration[] = [
  { id: '1', index: 1, label: 'web-dashboard PR 246', state: 'succeeded', changed: 44, turns: 12, cost: '$0.41' },
  { id: '2', index: 2, label: 'checkout-web PR 247', state: 'succeeded', changed: 10, turns: 8, cost: '$0.22' },
  { id: '3', index: 3, label: 'payments-api PR 248', state: 'running', changed: 2, turns: 3, cost: '$0.09' },
];

const COLUMNS: readonly IterationsColumn<DemoIteration>[] = [
  { id: 'index', header: '#', width: 32, cell: (row) => row.index },
  { id: 'label', header: 'Label', width: 'minmax(160px,1fr)', cell: (row) => row.label },
  {
    id: 'status',
    header: 'Status',
    width: 110,
    cell: (row) => <StatusBadge state={row.state === 'succeeded' ? 'succeeded' : row.state === 'running' ? 'running' : 'failed'} context="run" />,
  },
  { id: 'changed', header: 'Changed', width: 80, align: 'end', mono: true, cell: (row) => row.changed },
  { id: 'turns', header: 'Turns', width: 64, align: 'end', mono: true, cell: (row) => row.turns },
  { id: 'cost', header: 'Cost', width: 72, align: 'end', mono: true, cell: (row) => row.cost },
];

const meta = {
  component: IterationsTable<DemoIteration>,
  tags: ['vrt-themes'],
  args: { label: 'Iterations', columns: COLUMNS, rows: ROWS, getRowId: (row: DemoIteration) => row.id },
} satisfies Meta<typeof IterationsTable<DemoIteration>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('web-dashboard PR 246')).toBeInTheDocument();
  },
};

export const WithRowActions: Story = {
  args: {
    onRowClick: () => {},
    rowActions: (row) => <span className="text-small text-fg-3">Run: {row.id}…</span>,
  },
};
