import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Dropzone } from './Dropzone.js';

const meta = {
  component: Dropzone,
  tags: ['vrt-themes'],
  args: { onFiles: () => {} },
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <Dropzone {...args} className="w-96" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
  },
};

/** default and disabled. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Dropzone onFiles={() => {}} label="Drop images or" accept="image/*" />
      <Dropzone onFiles={() => {}} disabled />
    </div>
  ),
};
