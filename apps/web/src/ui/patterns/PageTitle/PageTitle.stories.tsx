import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { PageTitle } from './PageTitle.js';

const meta = {
  component: PageTitle,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: {
    title: 'Chats',
    count: 48,
    actions: (
      <Button variant="primary" icon="plus" shortcut={['Ctrl', 'N']}>
        New chat
      </Button>
    ),
  },
  decorators: [(Story) => <div className="w-[1136px]">{Story()}</div>],
} satisfies Meta<typeof PageTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Chats' })).toBeVisible();
  },
};

export const WithDescription: Story = {
  args: { title: 'Agents', count: 6, description: 'Reusable roles with their own model, tools and instructions.' },
};

/** Detail variant: description + a mono meta line. */
export const Detail: Story = {
  args: {
    variant: 'detail',
    title: 'Nightly dependency audit',
    count: undefined,
    description: 'Lists every dependency upgrade with its changelog link and risk.',
    meta: ['wf_01J9ZQ4N7X', 'Published v7', 'Updated 2h ago'],
    actions: (
      <>
        <Button>Edit</Button>
        <Button variant="primary" icon="play" shortcut={['Ctrl', '↵']}>
          Run
        </Button>
      </>
    ),
  },
};

export const LongText: Story = {
  args: { title: 'Fix the coupon/total race in checkout and add a regression test for rounding in every currency' },
};
