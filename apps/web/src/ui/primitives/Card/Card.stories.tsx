import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { Card } from './Card.js';

const meta = {
  component: Card,
  tags: ['vrt-themes'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-72">
      <Card.Header title="System" meta="v0.4.2" />
      <Card.Body>
        <p className="text-ui text-fg-2">Everything the header/body/section slots need is plain children.</p>
      </Card.Body>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('System')).toBeInTheDocument();
  },
};

/** header with a trailing action, stacked sections, and the `selected` border. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Card className="w-64">
        <Card.Header title="Codebase" action={<Button size="sm" variant="ghost">Manage</Button>} />
        <Card.Section>
          <div className="text-small text-fg-3">Branch</div>
          <div className="font-mono text-small">main</div>
        </Card.Section>
        <Card.Section>
          <div className="text-small text-fg-3">Last fetch</div>
          <div className="font-mono text-small">2m ago</div>
        </Card.Section>
      </Card>
      <Card selected className="w-64">
        <Card.Header title="Selected" />
        <Card.Body padding="sm">
          <p className="text-ui text-fg-2">Emphasised border.</p>
        </Card.Body>
      </Card>
    </div>
  ),
};
