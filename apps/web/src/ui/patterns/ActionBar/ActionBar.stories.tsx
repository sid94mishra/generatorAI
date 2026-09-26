import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { KbdHintRow } from '../KbdHintRow/KbdHintRow.js';
import { ActionBar } from './ActionBar.js';

const meta = {
  component: ActionBar,
  tags: ['vrt-themes'],
  args: { primary: <Button variant="primary">Continue</Button> },
} satisfies Meta<typeof ActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ActionBar
      className="w-140"
      hint={<KbdHintRow hints={[{ keys: 'Esc', label: 'Cancel' }]} />}
      secondary={<Button variant="ghost">Save draft</Button>}
      primary={<Button variant="primary" shortcut={['Ctrl', '↵']}>Start chat</Button>}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Start chat/ })).toBeInTheDocument();
  },
};

/** hint only, and secondary + primary with a shortcut. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-140 flex-col gap-2">
      <ActionBar hint="Unsaved changes" primary={<Button variant="primary">Save</Button>} />
      <ActionBar secondary={<Button variant="ghost">Back</Button>} primary={<Button variant="primary" shortcut={['Ctrl', '↵']}>Continue</Button>} />
    </div>
  ),
};
