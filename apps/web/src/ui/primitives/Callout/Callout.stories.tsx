import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { InlineCode } from '../InlineCode/InlineCode.js';
import { Callout, type CalloutTone } from './Callout.js';

const TONES: CalloutTone[] = ['info', 'warn', 'err', 'ok', 'neutral'];

const meta = {
  component: Callout,
  tags: ['vrt-themes'],
  args: { tone: 'info', children: 'This chat runs in a sandbox; network access is off.' },
  argTypes: { tone: { control: 'inline-radio', options: TONES } },
  decorators: [(Story) => <div className="w-120">{Story()}</div>],
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This chat runs in a sandbox; network access is off.')).toBeVisible();
  },
};

/** tone × (one line | title + second line | with action) (Components board "Callouts"). */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-3">
      {TONES.map((tone) => (
        <div key={tone} className="flex flex-col gap-2">
          <Callout tone={tone}>One line in the {tone} tone.</Callout>
          <Callout tone={tone} title={`Title in the ${tone} tone`}>
            A second line with detail: the install step exited with code 1.
          </Callout>
          <Callout tone={tone} title="Branch is 3 commits behind main" action={<Button size="sm">Rebase</Button>}>
            Rebase before merging to keep history linear.
          </Callout>
        </div>
      ))}
      <Callout tone="warn" icon="lock">
        Custom icon: <InlineCode>main</InlineCode> is protected in this workspace.
      </Callout>
      <Callout tone="err" title="The run failed">
        A very long error message that wraps across several lines to show that the icon stays pinned to the first line
        and the text never runs under it, even in a narrow dock at 440 pixels wide.
      </Callout>
    </div>
  ),
};

export const WithAction: Story = {
  args: {
    tone: 'err',
    title: 'Could not reach the server',
    children: 'Check the connection and try again.',
    action: <Button size="sm" onClick={fn()}>Retry</Button>,
  },
};

/** The only focusable part is the trailing action. */
export const FocusVisible: Story = {
  args: WithAction.args,
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Retry' })).toHaveFocus();
  },
};
