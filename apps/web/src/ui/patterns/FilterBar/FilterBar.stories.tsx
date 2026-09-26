import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Chip } from '../../primitives/Chip/Chip.js';
import { SearchInput } from '../../primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '../../primitives/SegmentedControl/SegmentedControl.js';
import { FilterBar } from './FilterBar.js';

/** The ChatsList filter bar (search · scope · chips · sort). */
function ChatsFilterBar() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  return (
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
  );
}

const meta = {
  component: FilterBar,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  render: () => (
    <div className="w-[1136px]">
      <ChatsFilterBar />
    </div>
  ),
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 1440 (content ≈ 1136): every chip shows. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Project' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Filters' })).toBeNull();
  },
};

/** Below 1024px (the 1100 window) the chips collapse into one "Filters" chip. */
export const Narrow: Story = {
  render: () => (
    <div className="w-[980px]">
      <ChatsFilterBar />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Filters' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Project' })).toBeNull();
  },
};

export const Compact: Story = { globals: { density: 'compact' } };
