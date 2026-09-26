import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Tabs, TabsPanel } from './Tabs.js';

function Controlled() {
  const [value, setValue] = useState('overview');
  return (
    <div className="w-96">
      <Tabs
        label="Project sections"
        value={value}
        onValueChange={setValue}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'codebases', label: 'Codebases', count: 3 },
          { value: 'runs', label: 'Runs', count: 12 },
          { value: 'settings', label: 'Settings', disabled: true },
        ]}
      >
        <TabsPanel value={value} className="p-3 text-ui text-fg-2">
          {value} panel
        </TabsPanel>
      </Tabs>
    </div>
  );
}

const meta = {
  component: Tabs,
  tags: ['vrt-themes'],
  args: { value: 'a', onValueChange: () => {}, items: [{ value: 'a', label: 'Overview' }] },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking a tab switches the panel; disabled tabs are skipped. */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('tab', { name: 'Runs 12' }));
    await expect(canvas.getByRole('tab', { name: 'Runs 12' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByText('runs panel')).toBeInTheDocument();
  },
};

/** page density (list pages) vs panel density (inspectors, dock panels). */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <Tabs
        label="Page tabs"
        value="a"
        onValueChange={() => {}}
        density="page"
        items={[
          { value: 'a', label: 'Overview' },
          { value: 'b', label: 'Runs', count: 4 },
        ]}
      />
      <Tabs
        label="Panel tabs"
        value="x"
        onValueChange={() => {}}
        density="panel"
        items={[
          { value: 'x', label: 'Config' },
          { value: 'y', label: 'History' },
        ]}
      />
    </div>
  ),
};
