import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { SearchInput, type SearchInputProps } from './SearchInput.js';

function Controlled(props: Partial<SearchInputProps>) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <div className="w-64">
      <SearchInput label="Search chats" placeholder="Search chats" {...props} value={value} onValueChange={setValue} />
    </div>
  );
}

const meta = {
  component: SearchInput,
  tags: ['vrt-themes'],
  args: { label: 'Search chats', placeholder: 'Search chats', value: '', onValueChange: () => undefined },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: the "/" hint; typing shows the clear button; Escape clears. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const box = canvas.getByRole('searchbox', { name: 'Search chats' });
    await userEvent.keyboard('/');
    await expect(box).toHaveFocus();
    await userEvent.type(box, 'flaky');
    await expect(canvas.getByRole('button', { name: 'Clear search' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(box).toHaveValue('');
  },
};

export const WithValue: Story = { args: { value: 'checkout' } };

export const Small: Story = { args: { size: 'sm', placeholder: 'Filter settings' } };

export const NoShortcut: Story = { args: { shortcut: null } };

export const Compact: Story = { globals: { density: 'compact' }, args: { value: 'checkout' } };
