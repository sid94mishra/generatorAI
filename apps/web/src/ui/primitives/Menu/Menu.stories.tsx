import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { IconButton } from '../IconButton/IconButton.js';
import { StatusDot } from '../StatusDot/StatusDot.js';
import {
  ContextMenu,
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
} from './Menu.js';

const onRename = fn();

/** The Components board "Menu & tooltip" row menu. */
function RowMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Menu.Root defaultOpen={defaultOpen}>
      <Menu.Trigger render={<IconButton icon="more" label="More actions" tooltip={false} />} />
      <Menu.Popup>
        <Menu.Group>
          <Menu.GroupLabel>Fix flaky checkout test</Menu.GroupLabel>
          <Menu.Item icon="edit" shortcut={['F2']} onClick={onRename}>
            Rename
          </Menu.Item>
          <Menu.Item icon="pin">Pin to sidebar</Menu.Item>
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger icon="projects">Move to project</Menu.SubmenuTrigger>
            <Menu.Popup side="inline-end" align="start" sideOffset={2}>
              <Menu.Item>payments-service</Menu.Item>
              <Menu.Item>web-dashboard</Menu.Item>
              <Menu.Item disabled>infra-terraform</Menu.Item>
            </Menu.Popup>
          </Menu.SubmenuRoot>
          <Menu.Item icon="link">Copy link</Menu.Item>
          <Menu.Item icon="archive" shortcut={['E']}>
            Archive
          </Menu.Item>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item icon="trash" shortcut={['Del']} danger>
          Delete…
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

const meta = {
  component: MenuPopup,
  subcomponents: {
    MenuItem,
    MenuCheckboxItem,
    MenuRadioGroup,
    MenuRadioItem,
    MenuSubmenuRoot,
    MenuSubmenuTrigger,
    MenuGroup,
    MenuGroupLabel,
    MenuSeparator,
  },
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  render: () => <RowMenu />,
} satisfies Meta<typeof MenuPopup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open from the keyboard, arrow through, Escape returns focus to the trigger. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    await expect(document.querySelector('[data-gai-overlay="menu"]')).not.toBeNull();
    await expect(within(menu).getByRole('menuitem', { name: /Delete/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

/** Opened for the visual baseline. */
export const Open: Story = {
  render: () => (
    <div className="min-h-80">
      <RowMenu defaultOpen />
    </div>
  ),
};

/** Keyboard: Enter opens, ArrowRight enters the submenu. */
export const Submenu: Story = {
  render: () => (
    <div className="min-h-80">
      <RowMenu />
    </div>
  ),
  play: async ({ canvas }) => {
    canvas.getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{Enter}');
    const sub = await screen.findByRole('menuitem', { name: 'Move to project' });
    sub.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'payments-service' })).toBeVisible());
    await expect(document.querySelectorAll('[data-gai-overlay="menu"]').length).toBe(2);
  },
};

function ViewMenu() {
  const [columns, setColumns] = useState({ project: true, changes: false });
  const [server, setServer] = useState('local');
  return (
    <Menu.Root defaultOpen>
      <Menu.Trigger render={<Button trailingIcon="chevron-down">View</Button>} />
      <Menu.Popup className="w-70">
        <Menu.Group>
          <Menu.GroupLabel>Columns</Menu.GroupLabel>
          <Menu.CheckboxItem checked={columns.project} onCheckedChange={(v) => setColumns((c) => ({ ...c, project: v }))}>
            Project
          </Menu.CheckboxItem>
          <Menu.CheckboxItem checked={columns.changes} onCheckedChange={(v) => setColumns((c) => ({ ...c, changes: v }))}>
            Changes
          </Menu.CheckboxItem>
        </Menu.Group>
        <Menu.Separator />
        <Menu.RadioGroup value={server} onValueChange={(v) => setServer(String(v))}>
          <Menu.GroupLabel>Servers</Menu.GroupLabel>
          <Menu.RadioItem
            value="local"
            icon="computer"
            description="local:3100"
            trailing={
              <>
                <StatusDot tone="ok" size="sm" />
                Connected
              </>
            }
          >
            This computer
          </Menu.RadioItem>
          <Menu.RadioItem value="studio" icon="server" description="studio.lan:3100" trailing="Offline">
            Studio Mac
          </Menu.RadioItem>
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.Item icon="settings" trailing="Security & devices">
          Manage servers
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

/** Checkbox items and two-line radio items (the Servers menu). */
export const CheckboxAndRadio: Story = {
  render: () => (
    <div className="min-h-80">
      <ViewMenu />
    </div>
  ),
  play: async () => {
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Changes' });
    await userEvent.click(item);
    await expect(item).toHaveAttribute('aria-checked', 'true');
  },
};

/** Right-click opens the same menu parts at the pointer. */
export const Context: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="flex h-row w-80 items-center justify-center rounded-card border border-dashed border-line text-small text-fg-3">
        Right-click this row
      </ContextMenu.Trigger>
      <ContextMenu.Popup>
        <ContextMenu.Item icon="edit" shortcut={['F2']}>
          Rename
        </ContextMenu.Item>
        <ContextMenu.Item icon="copy">Copy link</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item icon="trash" danger>
          Delete…
        </ContextMenu.Item>
      </ContextMenu.Popup>
    </ContextMenu.Root>
  ),
  play: async ({ canvas }) => {
    await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByText('Right-click this row') });
    await screen.findByRole('menu');
    await expect(document.querySelector('[data-gai-overlay="menu"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  },
};

export const Compact: Story = {
  globals: { density: 'compact' },
  render: () => (
    <div className="min-h-80">
      <RowMenu defaultOpen />
    </div>
  ),
};
