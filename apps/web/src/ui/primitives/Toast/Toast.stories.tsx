import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { toast, Toaster, ToastCard } from './Toast.js';

const meta = {
  component: ToastCard,
  tags: ['vrt-themes'],
  args: { tone: 'err', title: 'Push failed', description: 'The remote rejected fix/checkout-flake (non-fast-forward).' },
} satisfies Meta<typeof ToastCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Errors and background completions only (D-30). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ToastCard tone="err" title="Run test suite failed" description="3 of 20 tests failed." onDismiss={() => undefined} />
      <ToastCard
        tone="err"
        title="Push failed"
        description="The remote rejected the push."
        logs={'! [rejected] fix/checkout-flake -> fix/checkout-flake (non-fast-forward)\nerror: failed to push some refs'}
        action={{ label: 'Retry', onClick: () => undefined }}
        onDismiss={() => undefined}
      />
      <ToastCard
        tone="done"
        title="Nightly dependency audit finished"
        description="12 upgrades proposed."
        action={{ label: 'Open', onClick: () => undefined }}
        onDismiss={() => undefined}
      />
      <ToastCard tone="info" title="Update downloaded" description="Restart to install 0.9.2." onDismiss={() => undefined} />
    </div>
  ),
};

/** The live toaster: the region carries data-gai-overlay, each toast data-sonner-toast (D-19). */
export const Live: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="flex min-h-96 items-start bg-surface p-4">
      <Button onClick={() => toast.error('Push failed', { description: 'non-fast-forward' })}>Fire an error</Button>
      <Toaster />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(document.querySelector('[data-gai-overlay="toast"]')).not.toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Fire an error' }));
    await waitFor(() => expect(screen.getByText('Push failed')).toBeVisible());
    await expect(document.querySelector('[data-sonner-toast]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Push failed')).toBeNull());
  },
};
