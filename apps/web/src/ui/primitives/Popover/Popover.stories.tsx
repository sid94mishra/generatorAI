import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { PopoverClose, PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from './Popover.js';

const meta = {
  component: PopoverPopup,
  tags: ['vrt-themes'],
  decorators: [(Story) => <div className="flex min-h-80 items-center justify-center p-6">{Story()}</div>],
} satisfies Meta<typeof PopoverPopup>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ side = 'top', defaultOpen = false }: { side?: 'top' | 'bottom'; defaultOpen?: boolean }) {
  return (
    <PopoverRoot defaultOpen={defaultOpen}>
      <PopoverTrigger render={<Button>Sources</Button>} />
      <PopoverPopup side={side} className="w-72 p-3">
        <PopoverTitle className="text-ui font-medium text-fg">Sources · 2 mounts</PopoverTitle>
        <p className="mt-1 text-small text-fg-2">Edits apply to the next turn; existing mounts keep their history.</p>
        <div className="mt-3 flex justify-end">
          <PopoverClose render={<Button size="sm">Done</Button>} />
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}

export const Default: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sources' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(async () => expect(await body.findByText('Sources · 2 mounts')).toBeVisible());
    await expect(canvasElement.ownerDocument.querySelector('[data-gai-overlay="popover"]')).not.toBeNull();
    await userEvent.click(body.getByRole('button', { name: 'Done' }));
  },
};

export const OpenAbove: Story = { render: () => <Demo side="top" defaultOpen /> };
export const OpenBelow: Story = { render: () => <Demo side="bottom" defaultOpen /> };
