import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { FindBarFrame, type FindBarFrameProps } from './FindBarFrame.js';

// Demo frame height: fixed story scaffolding (a named constant, not a literal in `style`).
const FRAME = { height: 320 };

const onPrev = fn();
const onNext = fn();
const onClose = fn();

function InCard(props: Partial<FindBarFrameProps>) {
  const [query, setQuery] = useState(props.query ?? 'checkout');
  return (
    <div className="relative w-full overflow-hidden rounded-panel border border-line-soft bg-surface" style={FRAME}>
      <div className="flex h-bar items-center border-b border-line-soft px-4 text-ui font-semibold text-fg">Page header</div>
      <p className="p-4 text-body text-fg-2">Page content under the find bar.</p>
      <FindBarFrame onPrev={onPrev} onNext={onNext} onClose={onClose} {...props} query={query} onQueryChange={setQuery} />
    </div>
  );
}

const meta = {
  component: FindBarFrame,
  tags: ['vrt-themes'],
  args: { query: 'checkout', matches: { current: 2, total: 7 }, onQueryChange: fn(), onPrev, onNext, onClose },
  render: (args) => <InCard {...args} />,
} satisfies Meta<typeof FindBarFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Anchored under the 44px header at the card's right edge; keeps the `find-bar` testid. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const bar = canvas.getByTestId('find-bar');
    await expect(bar).toHaveAttribute('role', 'search');
    await expect(canvas.getByText('2 of 7')).toBeVisible();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Find in page' }), '{Enter}');
    await expect(onNext).toHaveBeenCalled();
  },
};

/** A query with no hits: "No results", previous / next disabled. */
export const NoResults: Story = {
  args: { query: 'zzz', matches: { current: 0, total: 0 } },
};
