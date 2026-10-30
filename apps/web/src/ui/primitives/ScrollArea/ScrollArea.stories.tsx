import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { ScrollArea } from './ScrollArea.js';

const ROWS = Array.from({ length: 40 }, (_, i) => `Chat ${i + 1} · payments-service`);

const meta = {
  component: ScrollArea,
  tags: ['vrt-themes'],
  args: { label: 'Chats', className: 'h-60 w-72 rounded-card border border-line-soft' },
  render: (args) => (
    <ScrollArea {...args}>
      <ul className="flex flex-col">
        {ROWS.map((row) => (
          <li key={row} className="flex h-row items-center border-b border-line-soft px-3 text-ui text-fg-2 last:border-b-0">
            {row}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The viewport scrolls from the keyboard. */
export const KeyboardScroll: Story = {
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Chats' });
    region.focus();
    await userEvent.keyboard('{PageDown}');
    await expect(region).toBeVisible();
  },
};

export const Both: Story = {
  args: { orientation: 'both' },
  render: (args) => (
    <ScrollArea {...args}>
      <div className="w-200 p-3 font-mono text-small text-fg-2">
        {ROWS.map((row) => (
          <div key={row} className="whitespace-nowrap">
            {row.repeat(4)}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
