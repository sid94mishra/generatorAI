import { useCallback, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { EmptyState } from '../../primitives/EmptyState/EmptyState.js';
import { DataTable, type DataTableProps, type DataTableSort } from './DataTable.js';
import { CHAT_COLUMNS, chatRowActions, sampleChats, type SampleChat } from './DataTable.fixtures.js';

type Props = DataTableProps<SampleChat>;

function Stateful(props: Partial<Props> & { frameClassName?: string }) {
  const { frameClassName, ...rest } = props;
  const [selection, setSelection] = useState<Set<string>>(new Set(['chat-9', 'chat-10']));
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'activity', direction: 'descending' });
  return (
    <div className={frameClassName ?? 'flex h-[600px] w-[1136px] flex-col'}>
      <DataTable<SampleChat>
        label="Chats"
        columns={CHAT_COLUMNS}
        rows={sampleChats()}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.title}
        selection={selection}
        onSelectionChange={setSelection}
        sort={sort}
        onSortChange={setSort}
        rowActions={chatRowActions}
        footer="Showing 12 of 48 · Scroll to load more"
        {...rest}
      />
    </div>
  );
}

const meta = {
  component: DataTable,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { label: 'Chats', columns: CHAT_COLUMNS, rows: sampleChats(), getRowId: (row: SampleChat) => row.id },
  render: () => <Stateful />,
} satisfies Meta<typeof DataTable<SampleChat>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ChatsList table at 1440 (table ≈ 1136 wide): selection, sort, hover actions. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Chats' })).toBeVisible();
    await expect(canvas.getByRole('columnheader', { name: 'Project' })).toBeVisible();
    const selectAll = canvas.getByRole('checkbox', { name: 'Select all' });
    await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
    await userEvent.click(selectAll);
    await expect(canvas.getAllByRole('row', { selected: true })).toHaveLength(12);
    const activity = canvas.getByRole('columnheader', { name: /Activity/ });
    await userEvent.click(canvas.getByRole('button', { name: /Activity/ }));
    await expect(activity).toHaveAttribute('aria-sort', 'ascending');
  },
};

/** At 1100 the table is ≈ 980 wide: Project and Changes drop (`hideBelow`). */
export const Width1100: Story = {
  render: () => <Stateful frameClassName="flex h-[600px] w-[980px] flex-col" />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('columnheader', { name: 'Project' })).toBeNull();
    await expect(canvas.queryByRole('columnheader', { name: 'Changes' })).toBeNull();
  },
};

/** `alwaysShowActions`: the actions stay visible without hover (ProjectDetail codebases: Fetch / Logs). */
export const ActionsAlwaysVisible: Story = {
  render: () => <Stateful alwaysShowActions selection={new Set()} />,
  play: async ({ canvas }) => {
    const cell = canvas.getAllByRole('cell').find((c) => c.className.includes('justify-end gap-1'));
    await expect(cell).toBeDefined();
    await expect(getComputedStyle(cell as HTMLElement).opacity).toBe('1');
  },
};

export const Loading: Story = {
  render: () => <Stateful loading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Chats' })).toHaveAttribute('aria-busy', 'true');
  },
};

export const Empty: Story = {
  render: () => (
    <Stateful
      rows={[]}
      empty={
        <EmptyState
          framed
          icon="chats"
          title="No chats yet"
          description="Start one from Home or press Ctrl N."
          action={<Button icon="plus">New chat</Button>}
        />
      }
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No chats yet')).toBeVisible();
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};

export const ErrorState: Story = {
  render: () => (
    <Stateful
      rows={[]}
      error={
        <EmptyState
          framed
          tone="error"
          icon="warning"
          title="Could not load chats"
          description="GET /api/chats → 503 Service Unavailable"
          action={<Button icon="refresh">Retry</Button>}
        />
      }
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('503');
  },
};

const onEndReached = fn();

function Virtualized() {
  const [rows, setRows] = useState(() => sampleChats(200));
  const more = useCallback(() => {
    onEndReached();
    setRows((r) => (r.length >= 5000 ? r : sampleChats(r.length + 200)));
  }, []);
  return (
    <div className="flex h-[600px] w-[1136px] flex-col">
      <DataTable<SampleChat>
        label="Chats"
        columns={CHAT_COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.title}
        rowActions={chatRowActions}
        virtualized
        onEndReached={more}
        footer={`Showing ${rows.length} of 5000 · Scroll to load more`}
      />
    </div>
  );
}

/** 200 → 5000 rows; only the visible rows are in the DOM; the header stays while the body scrolls. */
export const VirtualizedRows: Story = {
  render: () => <Virtualized />,
  play: async ({ canvasElement, canvas }) => {
    const rendered = canvasElement.querySelectorAll('[data-row-id]').length;
    await expect(rendered).toBeLessThan(60);
    // The ScrollArea viewport wraps the whole table (sticky header inside).
    const viewport = canvas.getByRole('table', { name: 'Chats' }).parentElement;
    viewport?.scrollTo({ top: 200 * 44 });
    await waitFor(() => expect(onEndReached).toHaveBeenCalled());
    await expect(canvas.getByRole('columnheader', { name: 'Title' })).toBeVisible();
  },
};

export const Compact: Story = { globals: { density: 'compact' } };
