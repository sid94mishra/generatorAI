import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { InlineCode } from './InlineCode.js';

const meta = {
  component: InlineCode,
  tags: ['vrt-themes'],
  args: { children: 'pnpm test' },
} satisfies Meta<typeof InlineCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const code = canvas.getByText('pnpm test');
    await expect(code.tagName).toBe('CODE');
  },
};

/** In running text (ui / body / err line) and the dense 11px size; the colour inherits. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <p className="text-ui text-fg">
        Run <InlineCode>pnpm test</InlineCode> before committing to <InlineCode>desktop_redesign</InlineCode>.
      </p>
      <p className="text-body text-fg-2">
        The agent edited <InlineCode>apps/web/src/ui/primitives/Button/Button.tsx</InlineCode> and three stories.
      </p>
      <p className="text-small text-err">
        Command <InlineCode>git push --force</InlineCode> is blocked by policy.
      </p>
      <p className="text-micro text-fg-3">
        Cron <InlineCode dense>0 2 * * 1</InlineCode> · timezone <InlineCode dense>Europe/Berlin</InlineCode>
      </p>
    </div>
  ),
};

/** Not interactive: nothing takes focus. */
export const FocusVisible: Story = {
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('code').length).toBeGreaterThan(0);
    await expect(canvasElement.querySelector('code[tabindex]')).toBeNull();
  },
};
