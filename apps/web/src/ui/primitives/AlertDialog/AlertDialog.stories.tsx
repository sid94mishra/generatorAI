import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { AlertDialog, useConfirm } from './AlertDialog.js';

const meta = {
  component: AlertDialog,
  tags: ['vrt-themes'],
  args: {
    trigger: <Button variant="danger" icon="trash">Delete 2 chats</Button>,
    title: 'Delete 2 chats?',
    description: 'Their transcripts and workspaces are removed from this computer. This cannot be undone.',
    confirmLabel: 'Delete',
    onConfirm: fn(),
  },
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens from its trigger, traps focus, Escape cancels and returns focus (D-19 attrs on backdrop + popup). */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole('button', { name: 'Delete 2 chats' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete 2 chats?' });
    await expect(dialog).toHaveAttribute('data-gai-overlay', 'dialog');
    await expect(document.querySelector('[data-gai-overlay="backdrop"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await expect(trigger).toHaveFocus();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const Confirm: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Delete 2 chats' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  },
};

/** Open for the visual baseline. */
export const Open: Story = { args: { open: true } };

export const PrimaryTone: Story = {
  args: {
    open: true,
    tone: 'primary',
    title: 'Restart to update?',
    description: 'Running chats pause and resume after the restart.',
    confirmLabel: 'Restart',
  },
};

function ConfirmDemo() {
  const confirmer = useConfirm();
  const [result, setResult] = useState('–');
  return (
    <div className="flex items-center gap-3 text-small text-fg-2">
      <Button
        onClick={async () => {
          const ok = await confirmer.confirm({ title: 'Archive 12 chats?', confirmLabel: 'Archive', tone: 'primary' });
          setResult(ok ? 'confirmed' : 'cancelled');
        }}
      >
        Archive
      </Button>
      <span>Result: {result}</span>
      {confirmer.dialog}
    </div>
  );
}

/** `useConfirm()` resolves true / false. */
export const UseConfirm: Story = {
  render: () => <ConfirmDemo />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Archive' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(canvas.getByText('Result: cancelled')).toBeVisible());
  },
};
