import type { Meta, StoryObj } from '@storybook/react-vite';
import { Kbd } from './Kbd.js';

const meta = {
  component: Kbd,
  tags: ['vrt-themes'],
  args: { keys: ['Ctrl', 'K'] },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** One box per chord; separate boxes for keys pressed one after another. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-small text-fg-2">
      <div className="flex items-center gap-2">
        <Kbd keys="/" /> <Kbd keys="Esc" /> <Kbd keys="↵" /> <Kbd keys={['Ctrl', '↵']} /> <Kbd keys="⌘K" />
      </div>
      <div className="flex items-center gap-1">
        <Kbd keys="↑" />
        <Kbd keys="↓" /> Navigate
        <span className="ml-3" />
        <Kbd keys="G" />
        <Kbd keys="H" /> Home
      </div>
      <div className="flex items-center gap-2 rounded-control bg-accent px-2.5 py-1 text-on-accent">
        New chat <Kbd keys={['Ctrl', 'N']} onAccent />
      </div>
    </div>
  ),
};

export const OnAccent: Story = {
  args: { keys: ['Ctrl', '↵'], onAccent: true },
  render: (args) => (
    <span className="inline-flex items-center gap-2 rounded-control bg-accent px-2.5 py-1 text-ui text-on-accent">
      Approve plan <Kbd {...args} />
    </span>
  ),
};
