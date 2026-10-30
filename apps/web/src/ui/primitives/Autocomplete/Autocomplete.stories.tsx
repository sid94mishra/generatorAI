import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { Autocomplete, type AutocompleteGroup, type AutocompleteItem, type AutocompleteProps } from './Autocomplete.js';

const GROUPS: AutocompleteGroup[] = [
  {
    label: 'Go to',
    items: [
      { value: 'home', label: 'Home', icon: 'home', shortcut: ['G', 'H'] },
      { value: 'chats', label: 'Chats', icon: 'chats', shortcut: ['G', 'C'] },
      { value: 'workflows', label: 'Workflows', icon: 'workflows' },
    ],
  },
  {
    label: 'Chats',
    items: [
      { value: 'c1', label: 'Fix flaky checkout test', icon: 'chats', meta: 'payments-service' },
      { value: 'c2', label: 'Upgrade React Flow to v12', icon: 'chats', meta: 'web-dashboard' },
    ],
  },
  {
    label: 'Commands',
    items: [
      { value: 'new', label: 'New chat', icon: 'plus', shortcut: ['Ctrl', 'N'] },
      { value: 'theme', label: 'Toggle light / dark', icon: 'mode-dark', keywords: ['theme', 'appearance'] },
    ],
  },
];

const onSelect = fn();

function Controlled(props: Partial<AutocompleteProps>) {
  const [value, setValue] = useState('');
  return (
    <div className="w-100">
      <Autocomplete label="Search" placeholder="Search or run a command" {...props} value={value} onValueChange={setValue} />
    </div>
  );
}

const meta = {
  component: Autocomplete,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { label: 'Search', groups: GROUPS, onSelect },
  render: (args) => <Controlled {...(args as Partial<AutocompleteProps<AutocompleteItem>>)} />,
} satisfies Meta<typeof Autocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Typing filters (label + keywords), the match is bold, Enter selects; the popup is a D-19 overlay. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('combobox', { name: 'Search' });
    await userEvent.type(input, 'flow');
    await waitFor(() => expect(screen.getByRole('option', { name: /Upgrade React Flow/ })).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="combobox"]')).not.toBeNull();
    await expect(screen.queryByRole('option', { name: /Home/ })).toBeNull();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalled();
  },
};

/** Inline, always-open list with 36h palette rows (the command palette body). */
export const InlinePalette: Story = {
  args: { inline: true, density: 'palette' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('option', { name: /Chats/ })).toBeVisible();
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search' }), 'theme');
    await waitFor(() => expect(canvas.getByRole('option', { name: /Toggle light/ })).toBeVisible());
  },
};

export const Empty: Story = {
  args: { inline: true, emptyText: 'No matches for this query' },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search' }), 'zzzz');
    await waitFor(() => expect(canvas.getByText('No matches for this query')).toBeVisible());
  },
};

export const Flat: Story = {
  args: {
    groups: undefined,
    items: [
      { value: 'a', label: 'Bug Fixer' },
      { value: 'b', label: 'Orchestrator' },
      { value: 'c', label: 'Release Scribe' },
    ],
    placeholder: 'Pick an agent',
    icon: null,
  },
};
