import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { Badge } from '../Badge/Badge.js';
import { Button } from '../Button/Button.js';
import { Dialog, DialogBody, DialogClose, DialogFooter, type DialogProps } from './Dialog.js';

const body = (
  <>
    <DialogBody>
      <p className="text-ui text-fg-2">
        Start from the project default model and agent, or pick a different one for this chat. The workspace is created
        when the first message is sent.
      </p>
      <p className="text-ui text-fg-2">Everything here can be changed later from the chat header.</p>
    </DialogBody>
    <DialogFooter hint="Opens in this window">
      <DialogClose render={<Button shortcut={['Esc']} />}>Cancel</DialogClose>
      <Button variant="primary" shortcut={['Ctrl', '↵']}>
        Start chat
      </Button>
    </DialogFooter>
  </>
);

const meta = {
  component: Dialog,
  tags: ['vrt-themes'],
  args: {
    title: 'New chat',
    trigger: <Button>New chat</Button>,
    onOpenChange: fn(),
    children: body,
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens from its trigger, carries the D-19 attrs, traps focus; Escape closes and focus returns to the trigger. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole('button', { name: 'New chat' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'New chat' });
    await expect(dialog).toHaveAttribute('data-gai-overlay', 'dialog');
    await expect(document.querySelector('[data-gai-overlay="backdrop"]')).not.toBeNull();
    // Focus starts inside and Tab cycles within the dialog (trap).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      // Base UI's focus guards sit just outside the popup and hand focus back on the next task.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
  },
};

/** The header close button and a footer DialogClose both close it. */
export const CloseButtons: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'New chat' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'New chat' }));
    await userEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** Open for the visual baseline: `md` 640, centred, header + body + footer. */
export const Open: Story = { args: { defaultOpen: true } };

export const WithBadge: Story = {
  args: { defaultOpen: true, title: 'Run workflow', badge: <Badge>6 stages</Badge> },
};

export const SizeSmall: Story = { args: { defaultOpen: true, size: 'sm', title: 'Rename chat' } };
export const SizeLarge: Story = { args: { defaultOpen: true, size: 'lg', title: 'Settings' } };
export const SizeExtraLarge: Story = { args: { defaultOpen: true, size: 'xl', title: 'Run “Nightly dependency audit”' } };

/** `placement="top"`, no header (the command palette frame's shape); the title is announced only. */
export const TopHeaderless: Story = {
  args: {
    defaultOpen: true,
    placement: 'top',
    header: false,
    title: 'Command palette',
    overlay: 'palette',
    children: <DialogBody>Palette content</DialogBody>,
  },
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toHaveAttribute('data-gai-overlay', 'palette');
    await expect(screen.queryByRole('heading', { name: 'Command palette' })).toBeNull();
  },
};

/**
 * Opened from the keyboard with no trigger (Mod+K from a text field): Escape
 * returns focus to the field that had it.
 */
function KeyboardOpened(props: Partial<DialogProps>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-small text-fg-3" htmlFor="dlg-notes">
        Notes
      </label>
      <textarea id="dlg-notes" className="rounded-control border border-line bg-sunken p-2 text-ui text-fg" rows={2} />
      <Dialog {...props} title="Quick switch" open={open} onOpenChange={setOpen} placement="top">
        <DialogBody>
          <Button>First action</Button>
        </DialogBody>
      </Dialog>
    </div>
  );
}

export const FocusReturnsWithoutTrigger: Story = {
  args: { trigger: undefined },
  render: (args) => <KeyboardOpened {...args} />,
  play: async ({ canvas }) => {
    const field = canvas.getByRole('textbox', { name: 'Notes' });
    await userEvent.click(field);
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Quick switch' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());
  },
};
