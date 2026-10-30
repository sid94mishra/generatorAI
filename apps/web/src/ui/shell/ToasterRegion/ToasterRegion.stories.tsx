import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { toast } from '../../primitives/Toast/Toast.js';
import { ToasterRegion } from './ToasterRegion.js';

/** The frame's kit toaster: errors and background completions only (D-30). */
const meta = {
  component: ToasterRegion,
  tags: ['vrt-themes'],
  render: (args) => (
    <>
      <Button onClick={() => toast.error('Push failed', { description: 'The remote rejected the branch.' })}>
        Show an error
      </Button>
      <ToasterRegion {...args} />
    </>
  ),
} satisfies Meta<typeof ToasterRegion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show an error' }));
    await waitFor(() => expect(screen.getByText('Push failed')).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="toast"]')).not.toBeNull();
    toast.dismiss();
  },
};
