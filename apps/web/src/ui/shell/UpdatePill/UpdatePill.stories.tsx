import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { UpdatePill } from './UpdatePill.js';

/**
 * "Restart to update" (board DesktopWindows): the strip pill, the sidebar
 * footer pill and the rail icon. Shown by the shell only while an update is
 * ready; never on the web.
 */
const meta = {
  component: UpdatePill,
  tags: ['vrt-themes'],
  args: { version: '0.0.2-alpha.1', placement: 'strip', onClick: fn() },
  decorators: [(Story) => <div className="flex items-center gap-2 bg-ground p-4">{Story()}</div>],
} satisfies Meta<typeof UpdatePill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title strip (Windows, Linux custom title bar), before the server chip. */
export const Strip: Story = {
  play: async ({ canvas, args }) => {
    const pill = canvas.getByRole('button', { name: 'Restart to update' });
    await userEvent.click(pill);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** Sidebar footer (macOS, Linux native frame): full width above the connection row. */
export const Footer: Story = {
  args: { placement: 'footer' },
  decorators: [(Story) => <div className="w-54">{Story()}</div>],
};

/** Collapsed rail: a run-toned download icon; the tooltip names the version. */
export const Rail: Story = {
  args: { placement: 'rail' },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Restart to update' }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** The install is starting: spinner, clicks ignored (every placement). */
export const Busy: Story = {
  args: { busy: true },
  render: (args) => (
    <>
      <UpdatePill {...args} placement="strip" />
      <div className="w-54">
        <UpdatePill {...args} placement="footer" />
      </div>
      <UpdatePill {...args} placement="rail" />
    </>
  ),
  play: async ({ canvas, args }) => {
    for (const pill of canvas.getAllByRole('button', { name: 'Restart to update' })) {
      await expect(pill).toHaveAttribute('aria-busy', 'true');
      await userEvent.click(pill);
    }
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

/** The last attempt failed (the app kept running): the pill stays, the tooltip says why. */
export const AfterFailure: Story = {
  args: { error: 'The installer did not start.' },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Restart to update' }));
    await waitFor(async () => expect(await screen.findByText(/could not be installed: The installer did not start\./)).toBeVisible());
  },
};
