import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { ReviewComposerPopover } from './ReviewComposerPopover.js';

const meta = {
  component: ReviewComposerPopover,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-120 bg-surface p-4 text-fg">
        <Story />
      </div>
    ),
  ],
  args: {
    file: { path: 'src/cart/applyCoupon.ts', alias: 'app' },
    range: { start: 19, end: 20, side: 'additions' },
    anchorPreview: 'const { discount } = await api.applyCoupon(code);\nsetTotals(recalculate(cart, discount));',
    // The gutter "+" the user pressed, in viewport coordinates.
    anchor: { x: 48, y: 32 },
    onCancel: fn(),
    onSubmit: fn(),
    onSubmitAndSend: fn(),
  },
} satisfies Meta<typeof ReviewComposerPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** From the gutter: focus lands in the comment box; Mod+Enter adds it with the chosen intent. */
export const Default: Story = {
  play: async ({ args }) => {
    const box = await screen.findByRole('textbox', { name: 'Review comment' });
    await expect(document.querySelector('[data-gai-overlay="popover"]')).not.toBeNull();
    await waitFor(() => expect(box).toHaveFocus());
    await expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Question' }));
    await userEvent.type(box, 'Why a second fetch here?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect(args.onSubmit).toHaveBeenCalledWith('Why a second fetch here?', 'question');
  },
};

/** "Add & send" adds the comment and sends just that one to the agent. */
export const AddAndSend: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'Rename to applyCoupon');
    await userEvent.click(screen.getByRole('button', { name: /Add & send/ }));
    await expect(args.onSubmitAndSend).toHaveBeenCalledWith('Rename to applyCoupon', 'fix');
  },
};

/** From the file header: editable bounds, validated against the file's length. */
export const LineRange: Story = {
  args: { range: { start: 1, end: 1, side: 'additions' }, anchorPreview: '', lineCount: 12, onRangeChange: fn() },
  play: async ({ args }) => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'Check this range');
    const end = screen.getByRole('spinbutton', { name: 'End line' });
    await userEvent.clear(end);
    await userEvent.type(end, '13');
    await expect(screen.getByRole('alert')).toHaveTextContent('Choose an ordered range from 1 to 12.');
    await expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled();
    await userEvent.clear(end);
    await userEvent.type(end, '5');
    await expect(args.onRangeChange).toHaveBeenLastCalledWith(1, 5);
    await expect(screen.queryByRole('alert')).toBeNull();
  },
};

/** Escape dismisses from anywhere, even while typing. */
export const Dismiss: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'draft');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(args.onCancel).toHaveBeenCalled());
  },
};
