import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { Button } from '../../primitives/Button/Button.js';
import { Inspector } from './Inspector.js';

function WithTabs() {
  const [tab, setTab] = useState('config');
  return (
    <Inspector
      title="reviewer"
      subtitle="agent-01 · Agent stage · 2 of 6"
      actions={<IconButton icon="x" label="Close" size="sm" />}
      tabs={{
        value: tab,
        onValueChange: setTab,
        items: [
          { value: 'config', label: 'Config' },
          { value: 'history', label: 'History' },
        ],
      }}
    >
      {tab === 'config' ? (
        <Field label="Model" orientation="horizontal" labelWidth={100}>
          <Input aria-label="Model" defaultValue="claude-opus-5" />
        </Field>
      ) : (
        <div className="text-ui text-fg-2">No history yet</div>
      )}
    </Inspector>
  );
}

const meta = {
  component: Inspector,
  tags: ['vrt-themes'],
  args: { title: 'Inspector' },
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <WithTabs />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('reviewer')).toBeInTheDocument();
  },
};

/** with tabs, and a plain field body without tabs. */
export const Matrix: Story = {
  render: () => (
    <div className="flex h-[400px] gap-4">
      <Inspector title="Stage properties" subtitle="stage-02">
        <Field label="Name" orientation="horizontal" labelWidth={100}>
          <Input aria-label="Name" defaultValue="Review" />
        </Field>
      </Inspector>
    </div>
  ),
};

/** An eyebrow row (the builder's back link) above the title; the panel is a named region. */
export const WithEyebrow: Story = {
  render: () => (
    <div className="flex h-[400px]">
      <Inspector
        title="Assess risk"
        subtitle="assess_risk · Agent stage · 2 of 6"
        eyebrow={
          <Button variant="ghost" size="sm" icon="chevron-left">
            Workflow settings
          </Button>
        }
        actions={<IconButton icon="x" label="Close" size="sm" />}
      >
        <div className="text-ui text-fg-2">Body</div>
      </Inspector>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('complementary', { name: 'Assess risk' })).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Workflow settings' })).toBeInTheDocument();
  },
};
