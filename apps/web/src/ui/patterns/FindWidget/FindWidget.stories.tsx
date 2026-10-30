import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { FindWidget, type FindWidgetProps } from './FindWidget.js';

const onPrev = fn();
const onNext = fn();
const onClose = fn();
const onQueryChange = fn();

function Controlled(props: Partial<FindWidgetProps>) {
  const [query, setQuery] = useState(props.query ?? '');
  return (
    <FindWidget
      onPrev={onPrev}
      onNext={onNext}
      onClose={onClose}
      {...props}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        onQueryChange(next);
      }}
    />
  );
}

const meta = {
  component: FindWidget,
  tags: ['vrt-themes'],
  args: { query: 'error', matches: { current: 3, total: 12 }, onQueryChange, onPrev, onNext, onClose },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof FindWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A floating search landmark (D-19 overlay); Enter / Shift+Enter / Escape drive next / previous / close. */
export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    const search = canvas.getByRole('search', { name: 'Find' });
    await expect(search).toHaveAttribute('data-gai-overlay', 'popover');
    await expect(canvas.getByText('3 of 12')).toBeVisible();
    const input = canvas.getByRole('textbox', { name: 'Find' });
    await userEvent.type(input, 's');
    await expect(onQueryChange).toHaveBeenLastCalledWith('errors');
    await userEvent.keyboard('{Enter}');
    await expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await expect(onPrev).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    await expect(onClose).toHaveBeenCalledTimes(1);
    assertTargetSize(canvasElement);
  },
};

/** with matches · no matches (prev/next disabled) · not searched yet. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      {/* Distinct names: several search landmarks on one page must be distinguishable. */}
      <Controlled label="Find in terminal" query="error" matches={{ current: 3, total: 12 }} />
      <Controlled label="Find in output" query="zzz" matches={{ current: 0, total: 0 }} />
      <Controlled label="Find in page" query="" />
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Find' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Previous match' })).toHaveFocus();
  },
};

/** Compact density: the 20px icon buttons keep 24×24 targets. */
export const Compact: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
