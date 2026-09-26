import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { StatusBadge } from '../../primitives/StatusBadge/StatusBadge.js';
import { CommandList, type CommandGroup } from '../../patterns/CommandList/CommandList.js';
import { CommandPaletteFrame, type CommandPaletteFrameProps } from './CommandPaletteFrame.js';

const OPEN_ACTIONS = [
  { value: 'open', label: 'Open', icon: 'forward' },
  { value: 'copy-link', label: 'Copy link', icon: 'link' },
] as const;

// Board CommandPalette, minus the entity-search group (P5-12).
const GROUPS: CommandGroup[] = [
  {
    label: 'Go to',
    items: [
      { value: 'nav:home', label: 'Home', icon: 'home', chords: [['Ctrl', '1']], actions: OPEN_ACTIONS },
      { value: 'nav:chats', label: 'Chats', icon: 'chats', chords: [['Ctrl', '2']], actions: OPEN_ACTIONS },
      { value: 'nav:workflows', label: 'Workflows', icon: 'workflows', chords: [['Ctrl', '5']], actions: OPEN_ACTIONS },
      { value: 'nav:automations', label: 'Automations', icon: 'automations', chords: [['Ctrl', '6']], actions: OPEN_ACTIONS },
    ],
  },
  {
    label: 'Actions',
    items: [
      { value: 'cmd:chat.new', label: 'New chat', icon: 'plus', chords: [['Ctrl', 'N']] },
      { value: 'cmd:workflow.new', label: 'New workflow', icon: 'plus', chords: [['Ctrl', 'Shift', 'N']] },
      { value: 'cmd:theme.toggle', label: 'Toggle theme', icon: 'mode-dark', meta: 'Dark → Light' },
      { value: 'cmd:app.settings', label: 'Open settings', icon: 'settings', chords: [['Ctrl', ',']] },
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

const onSelect = fn();

function Palette({ open, onOpenChange }: Pick<CommandPaletteFrameProps, 'open' | 'onOpenChange'>) {
  const [query, setQuery] = useState('');
  return (
    <CommandPaletteFrame open={open} onOpenChange={onOpenChange}>
      <CommandList
        query={query}
        onQueryChange={setQuery}
        groups={GROUPS}
        onSelect={(item) => {
          onSelect(item);
          onOpenChange(false);
        }}
      />
    </CommandPaletteFrame>
  );
}

/** A page with a text field; Ctrl/Cmd+K opens the palette from anywhere, the field included. */
function Page({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="flex min-h-screen flex-col gap-2 bg-ground p-6">
      <label className="text-small text-fg-3" htmlFor="pal-composer">
        Message
      </label>
      <textarea id="pal-composer" className="w-100 rounded-control border border-line bg-sunken p-2 text-ui text-fg" rows={3} />
      <Palette open={open} onOpenChange={setOpen} />
    </div>
  );
}

const meta = {
  component: CommandPaletteFrame,
  tags: ['vrt-themes'],
  // The result list scrolls but is never focused itself: keyboard users move
  // through it from the query input (combobox + aria-activedescendant, the
  // highlighted row is scrolled into view), the WAI-ARIA combobox pattern.
  // axe's scrollable-region-focusable cannot see that.
  parameters: { layout: 'fullscreen', a11y: { config: { rules: [{ id: 'scrollable-region-focusable', enabled: false }] } } },
  args: { open: true, onOpenChange: fn(), children: null },
  render: () => <Page initialOpen />,
} satisfies Meta<typeof CommandPaletteFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open (visual baseline): 640 wide at the top, scrim behind, a D-19 `palette` overlay; focus in the query. */
export const Open: Story = {
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toHaveAttribute('data-gai-overlay', 'palette');
    await expect(document.querySelector('[data-gai-overlay="backdrop"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search or jump to' })).toHaveFocus());
  },
};

/** Mod+K from a textarea opens it; arrows move, Enter runs and closes; Escape returns focus to the textarea. */
export const KeyboardFlow: Story = {
  render: () => <Page />,
  play: async ({ canvas }) => {
    const field = canvas.getByRole('textbox', { name: 'Message' });
    await userEvent.click(field);
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search or jump to' });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'nav:chats' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());

    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());
  },
};

/** Escape inside a row's action list goes back to the results; the palette stays open until the next Escape. */
export const EscapeFromActions: Story = {
  render: () => <Page initialOpen />,
  play: async () => {
    const input = await screen.findByRole('combobox', { name: 'Search or jump to' });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(screen.getByRole('option', { name: /Copy link/ })).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('option', { name: /Home/ })).toBeVisible());
    await expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};
