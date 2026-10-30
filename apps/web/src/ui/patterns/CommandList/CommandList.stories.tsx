import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { StatusBadge } from '../../primitives/StatusBadge/StatusBadge.js';
import { CommandList, type CommandGroup, type CommandListProps } from './CommandList.js';

const OPEN_ACTIONS = [
  { value: 'open', label: 'Open', icon: 'forward', chords: [['↵']] },
  { value: 'open-tab', label: 'Open in new tab', icon: 'external-link' },
  { value: 'copy-link', label: 'Copy link', icon: 'link' },
] as const;

const PALETTE_GROUPS: CommandGroup[] = [
  {
    label: 'Go to',
    items: [
      { value: 'nav:home', label: 'Home', icon: 'home', chords: [['G'], ['H']], actions: OPEN_ACTIONS },
      { value: 'nav:chats', label: 'Chats', icon: 'chats', chords: [['G'], ['C']], actions: OPEN_ACTIONS },
      { value: 'nav:workflows', label: 'Workflows', icon: 'workflows', chords: [['G'], ['W']], actions: OPEN_ACTIONS },
      { value: 'nav:automations', label: 'Automations', icon: 'automations', chords: [['G'], ['A']], actions: OPEN_ACTIONS },
    ],
  },
  {
    label: 'Actions',
    items: [
      { value: 'cmd:chat.new', label: 'New chat', icon: 'plus', chords: [['N']] },
      { value: 'cmd:workflow.new', label: 'New workflow', icon: 'plus', chords: [['Shift', 'N']] },
      { value: 'cmd:theme.toggle', label: 'Toggle theme', icon: 'mode-dark', meta: 'Dark → Light', keywords: ['dark', 'light'] },
      { value: 'cmd:app.settings', label: 'Open settings', icon: 'settings', chords: [['G'], [',']] },
    ],
  },
  {
    label: 'Recent chats',
    items: [
      {
        value: 'chat:1',
        label: 'Fix flaky checkout test',
        icon: 'message',
        meta: 'payments-service',
        badge: <StatusBadge state="needs_you" context="chat" />,
        actions: OPEN_ACTIONS,
      },
      {
        value: 'chat:2',
        label: 'Upgrade React Flow to v12',
        icon: 'message',
        meta: 'web-dashboard',
        badge: <StatusBadge state="running" label="4:12" />,
        actions: OPEN_ACTIONS,
      },
    ],
  },
];

const EMPTY_RECENTS: CommandGroup[] = [
  PALETTE_GROUPS[0]!,
  { label: 'Recent chats', items: [{ value: 'chat:none', label: 'No recent chats', disabled: true, note: true }] },
];

function Controlled(props: Omit<CommandListProps, 'query' | 'onQueryChange'> & { initialQuery?: string }) {
  const [query, setQuery] = useState(props.initialQuery ?? '');
  return (
    // Stand-in for the palette frame (S-10): a 640-wide overlay box.
    <div className="flex h-[520px] w-dialog flex-col overflow-hidden rounded-dialog border border-line bg-overlay text-fg shadow-pop">
      <CommandList {...props} query={query} onQueryChange={setQuery} />
    </div>
  );
}

const meta = {
  component: CommandList,
  tags: ['vrt-themes'],
  // The result list scrolls but is never focused itself: keyboard users move
  // through it from the query input (combobox + aria-activedescendant, the
  // highlighted row is scrolled into view), the WAI-ARIA combobox pattern.
  // axe's scrollable-region-focusable cannot see that.
  parameters: { a11y: { config: { rules: [{ id: 'scrollable-region-focusable', enabled: false }] } } },
  args: { query: '', onQueryChange: fn(), groups: PALETTE_GROUPS, onSelect: fn(), onAction: fn() },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof CommandList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All groups, the first row highlighted, footer hints. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const first = canvas.getByRole('option', { name: /Home/ });
    await waitFor(() => expect(first).toHaveAttribute('data-highlighted'));
    await expect(canvas.getByText('Navigate')).toBeVisible();
    await expect(canvas.getByText('Actions', { selector: 'span' })).toBeVisible();
  },
};

/** Typing filters, shows the result count and bolds the match; Enter opens the highlighted row. */
export const Filtering: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('combobox', { name: 'Search or jump to' });
    await userEvent.type(input, 'work');
    await waitFor(() => expect(canvas.getByText('2 results')).toBeVisible());
    await expect(canvas.queryByRole('option', { name: /Home/ })).toBeNull();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'nav:workflows' }));
  },
};

/** Arrow keys move the highlight across groups. */
export const ArrowNavigation: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('combobox', { name: 'Search or jump to' });
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(canvas.getByRole('option', { name: /New chat/ })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(canvas.getByRole('option', { name: /Automations/ })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'nav:automations' }));
  },
};

/** Tab lists the highlighted row's actions; Enter runs one; Escape goes back with the query restored. */
export const TabActions: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: 'Search or jump to' });
    await userEvent.type(input, 'flaky');
    await waitFor(() => expect(canvas.getByRole('option', { name: /Fix flaky checkout test/ })).toHaveAttribute('data-highlighted'));
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(canvasElement.querySelector('[data-view="actions"]')).not.toBeNull());
    await expect(input).toHaveFocus();
    await expect(canvas.getByText('3 actions')).toBeVisible();
    await expect(canvas.getByRole('option', { name: /Copy link/ })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'chat:1' }),
      expect.objectContaining({ value: 'copy-link' }),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvasElement.querySelector('[data-view="results"]')).not.toBeNull());
    await expect(canvas.getByRole('combobox', { name: 'Search or jump to' })).toHaveValue('flaky');
  },
};

/** Shift+Tab also goes back; Tab on a row without actions stays in the results. */
export const TabWithoutActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: 'Search or jump to' });
    await userEvent.type(input, 'new chat');
    await userEvent.keyboard('{Tab}');
    await expect(canvasElement.querySelector('[data-view="results"]')).not.toBeNull();
    await expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, 'home');
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(canvasElement.querySelector('[data-view="actions"]')).not.toBeNull());
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await waitFor(() => expect(canvasElement.querySelector('[data-view="results"]')).not.toBeNull());
  },
};

/** Nothing matches. */
export const NoResults: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search or jump to' }), 'zzzz');
    await waitFor(() => expect(canvas.getByText('No results for “zzzz”')).toBeVisible());
    await expect(canvas.getByText('0 results')).toBeVisible();
  },
};

/** A group with no data shows a disabled note row while the query is empty; it never counts as a result. */
export const EmptyGroupNote: Story = {
  args: { groups: EMPTY_RECENTS },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('option', { name: 'No recent chats' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search or jump to' }), 'o');
    await waitFor(() => expect(canvas.queryByRole('option', { name: 'No recent chats' })).toBeNull());
  },
};
