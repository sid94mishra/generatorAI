import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { MainCard, MainCardBody } from './MainCard.js';

/** The inset card every page renders in, on the window's ground. */
const meta = {
  component: MainCard,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: {
    children: (
      <>
        <PageHeader title="Home" />
        <MainCardBody className="p-7 text-ui text-fg-2">The page renders here; the body clips and fills the card.</MainCardBody>
      </>
    ),
  },
  decorators: [(Story) => <div className="flex h-[480px] bg-ground pl-2">{Story()}</div>],
} satisfies Meta<typeof MainCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Margins 8 8 8 0 (sidebar, rail, web). */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('main')).toBeVisible();
  },
};

/** Under the Windows strip: no top margin. */
export const UnderStrip: Story = { args: { underStrip: true } };
