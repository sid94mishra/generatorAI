import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { IconButton } from '../IconButton/IconButton.js';
import { Tooltip } from './Tooltip.js';

const meta = {
  component: Tooltip,
  tags: ['vrt-themes'],
  args: { content: 'Copy branch name', children: <Button icon="copy">Copy</Button> },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on keyboard focus too; the positioner carries data-gai-overlay (D-19). */
export const Default: Story = {
  play: async () => {
    await userEvent.tab();
    await waitFor(() => expect(screen.getByText('Copy branch name')).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="tooltip"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
  },
};

/** With a shortcut: 28h, Kbd after the text (Components board "Menu & tooltip"). */
export const WithShortcut: Story = {
  args: { content: 'Copy branch name', shortcut: ['Ctrl', 'C'], open: true },
};

/** The default IconButton tooltip repeats its label. */
export const OnIconButton: Story = {
  render: () => <IconButton icon="dock" label="Toggle dock" shortcut={['Ctrl', 'B']} />,
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Toggle dock' }));
    await waitFor(() => expect(screen.getByText('Toggle dock', { selector: 'span' })).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="tooltip"]')).not.toBeNull();
  },
};

export const Sides: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-16 p-12">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} content={`On the ${side}`} side={side} open>
          <Button>{side}</Button>
        </Tooltip>
      ))}
    </div>
  ),
};
