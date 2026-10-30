import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button/Button.js';
import { IconButton } from '../IconButton/IconButton.js';
import { Separator } from './Separator.js';

const meta = {
  component: Separator,
  tags: ['vrt-themes'],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex w-64 flex-col gap-2 text-ui text-fg-2">
      Above
      <Separator {...args} />
      Below
    </div>
  ),
};

/** Horizontal (soft/default) and vertical 16 / 20 in a header and a bar. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <Separator />
      <Separator tone="default" />
      <div className="flex items-center">
        <Button size="sm" variant="ghost">
          Save
        </Button>
        <Separator orientation="vertical" tone="default" />
        <IconButton size="sm" icon="more" label="More" />
        <Separator orientation="vertical" size="lg" />
        <Button size="sm" variant="ghost">
          Run
        </Button>
      </div>
    </div>
  ),
};
