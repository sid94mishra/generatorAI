import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { CompactionDivider } from './CompactionDivider.js';

const meta = {
  title: 'Blocks/Transcript/CompactionDivider',
  component: CompactionDivider,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CompactionDivider>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The user compacted; the provider reported the fill before and after and the summary it continues from. */
export const ManualWithSummary: Story = {
  args: {
    record: {
      trigger: 'manual',
      preTokens: 152_400,
      postTokens: 21_300,
      summary: '**Goal** — fix the flaky checkout test.\n\n**Done** — `src/cart/applyCoupon.ts` awaits the coupon before the totals.\n\n**Next** — run the suite 20 times.',
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Conversation compacted · 152K → 21K tokens')).toBeVisible();
    await userEvent.click(c.getByRole('button', { name: 'Summary' }));
    await expect(c.getByRole('button', { name: 'Hide summary' })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** The provider compacted on its own and reported no numbers or summary (Codex, OpenCode). */
export const AutoBare: Story = {
  args: { record: { trigger: 'auto' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Conversation compacted automatically')).toBeVisible();
    await expect(c.queryByRole('button')).toBeNull();
  },
};

/** The app compacted for a provider without a compaction of its own: a summary, no token counts. */
export const Synthetic: Story = {
  args: { record: { trigger: 'manual', synthetic: true, summary: 'The user is building a parser in `src/parser.ts`; tests are next.' } },
};
