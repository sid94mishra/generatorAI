import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Chip } from '../../primitives/Chip/Chip.js';
import { EmptyState } from '../../primitives/EmptyState/EmptyState.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { SearchInput } from '../../primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '../../primitives/SegmentedControl/SegmentedControl.js';
import { ToolbarButton } from '../../primitives/Toolbar/Toolbar.js';
import { BulkActionBar } from '../../patterns/BulkActionBar/BulkActionBar.js';
import { DataTable, type DataTableSort } from '../../patterns/DataTable/DataTable.js';
import { CHAT_COLUMNS, chatRowActions, sampleChats, type SampleChat } from '../../patterns/DataTable/DataTable.fixtures.js';
import { FilterBar } from '../../patterns/FilterBar/FilterBar.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { PageTitle } from '../../patterns/PageTitle/PageTitle.js';
import { ListPage } from './ListPage.js';

type State = 'ready' | 'loading' | 'empty' | 'error';

/** The ChatsList page composed from the kit, in a main-card-sized frame. */
function ChatsPage({ state = 'ready', frame }: { state?: State; frame: string }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [selection, setSelection] = useState<Set<string>>(new Set(['chat-9', 'chat-10']));
  const [sort, setSort] = useState<DataTableSort>({ columnId: 'activity', direction: 'descending' });
  const rows = state === 'ready' ? sampleChats() : [];
  return (
    <div className={`${frame} overflow-hidden rounded-panel border border-line-soft`}>
      <ListPage
        header={<PageHeader title="Chats" actions={<IconButton icon="more" label="More" />} />}
        title={
          <PageTitle
            title="Chats"
            count={48}
            actions={
              <Button variant="primary" icon="plus" shortcut={['Ctrl', 'N']}>
                New chat
              </Button>
            }
          />
        }
        filters={
          <FilterBar
            search={<SearchInput size="sm" label="Search chats" placeholder="Search chats" value={query} onValueChange={setQuery} />}
            scope={
              <SegmentedControl
                semantics="tabs"
                label="Chat scope"
                value={scope}
                onValueChange={setScope}
                items={[
                  { value: 'all', label: 'All', count: 48 },
                  { value: 'active', label: 'Active', count: 41 },
                  { value: 'archived', label: 'Archived', count: 7 },
                ]}
              />
            }
            filters={
              <>
                {['Project', 'Agent', 'Status', 'Tags'].map((f) => (
                  <Chip key={f} dropdown onClick={() => undefined}>
                    {f}
                  </Chip>
                ))}
              </>
            }
            filtersCollapsed={
              <Chip dropdown icon="list" onClick={() => undefined}>
                Filters
              </Chip>
            }
            sort={
              <Button variant="ghost" size="sm" icon="sort">
                Last activity
              </Button>
            }
          />
        }
        content={
          <DataTable<SampleChat>
            label="Chats"
            columns={CHAT_COLUMNS}
            rows={rows}
            getRowId={(row) => row.id}
            getRowLabel={(row) => row.title}
            selection={selection}
            onSelectionChange={setSelection}
            sort={sort}
            onSortChange={setSort}
            rowActions={chatRowActions}
            virtualized
            loading={state === 'loading'}
            footer="Showing 12 of 48 · Scroll to load more"
            empty={
              <EmptyState
                framed
                icon="chats"
                title="No chats yet"
                description="Start one from Home or press Ctrl N."
                action={<Button icon="plus">New chat</Button>}
              />
            }
            error={
              state === 'error' ? (
                <EmptyState
                  framed
                  tone="error"
                  icon="warning"
                  title="Could not load chats"
                  description="GET /api/chats → 503 Service Unavailable"
                  action={<Button icon="refresh">Retry</Button>}
                />
              ) : undefined
            }
          />
        }
        overlay={
          <BulkActionBar
            count={selection.size}
            total={48}
            onClear={() => setSelection(new Set())}
            actions={
              <>
                <ToolbarButton render={<Button variant="ghost" size="sm" icon="archive" />}>Archive</ToolbarButton>
                <ToolbarButton render={<Button variant="danger-ghost" size="sm" icon="trash" />}>Delete</ToolbarButton>
              </>
            }
          />
        }
      />
    </div>
  );
}

// Main-card sizes: 1440×900 window → 1192×884 card; 1100×760 → 1036×744 (rail, D-22).
const FRAME_1440 = 'h-[884px] w-[1192px]';
const FRAME_1100 = 'h-[744px] w-[1036px]';

const meta = {
  component: ListPage,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { header: null, title: null, content: null },
  render: () => <ChatsPage frame={FRAME_1440} />,
} satisfies Meta<typeof ListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ChatsList at 1440: header, title, filters, table (sticky header), footer note, bulk bar. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Chats' })).toBeVisible();
    await expect(canvas.getByRole('table', { name: 'Chats' })).toBeVisible();
    await expect(canvas.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(canvas.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
  },
};

/** At 1100 (card 1036): Project/Changes drop and the filter chips collapse into "Filters". */
export const Width1100: Story = {
  render: () => <ChatsPage frame={FRAME_1100} />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('columnheader', { name: 'Project' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Filters' })).toBeVisible();
  },
};

export const Loading: Story = {
  render: () => <ChatsPage state="loading" frame={FRAME_1440} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Chats' })).toHaveAttribute('aria-busy', 'true');
  },
};

export const Empty: Story = {
  render: () => <ChatsPage state="empty" frame={FRAME_1440} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No chats yet')).toBeVisible();
  },
};

export const ErrorState: Story = {
  render: () => <ChatsPage state="error" frame={FRAME_1440} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('503');
  },
};

export const Compact: Story = { globals: { density: 'compact' } };
