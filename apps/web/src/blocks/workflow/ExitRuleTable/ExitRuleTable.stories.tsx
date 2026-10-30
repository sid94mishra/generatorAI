import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { ExitRule } from '@generatorai/workflow-spec';
import { Input } from '@/ui/primitives/Input/Input.js';
import { ExitRuleTable, type ExitConditionSlot } from './ExitRuleTable.js';

const RULES: ExitRule[] = [
  { when: "stages.review.output.verdict == 'approve'", action: 'complete', consecutive: 1, reason: 'approved' },
  { when: 'not loop.last.signals.workspaceChanged', action: 'exhaust', consecutive: 2, reason: 'no_changes' },
];

/** A plain input stands in for the builder's expression editor. */
function condition(slot: ExitConditionSlot) {
  return (
    <Input
      mono
      size="sm"
      value={slot.value}
      onChange={(e) => slot.onChange(e.target.value)}
      aria-label={slot.ariaLabel}
      placeholder={slot.placeholder}
    />
  );
}

function Stateful({ initial }: { initial: ExitRule[] }) {
  const [rules, setRules] = useState(initial);
  return (
    <div className="w-inspector p-4">
      <ExitRuleTable rules={rules} onChange={setRules} renderCondition={condition} />
    </div>
  );
}

const meta = {
  component: ExitRuleTable,
  tags: ['vrt-themes'],
  args: { rules: RULES, onChange: () => {}, renderCondition: condition },
} satisfies Meta<typeof ExitRuleTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The board: Until and Stall set, Fail when and Pause when empty. */
export const Default: Story = {
  render: () => <Stateful initial={RULES} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('×2 in a row → Exhaust · no_changes')).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Fail when condition' }), 'true');
    await expect(canvas.getByText('→ Fail · failed')).toBeInTheDocument();
  },
};

/** No rule yet. */
export const Empty: Story = { render: () => <Stateful initial={[]} /> };

/** A second complete rule lands under "More rules"; an invalid reason shows its error. */
export const MoreRules: Story = {
  render: () => (
    <Stateful initial={[...RULES, { when: 'loop.iteration > 3', action: 'complete', consecutive: 1, reason: 'Bad Reason' }]} />
  ),
};
