import type { Meta, StoryObj } from '@storybook/react-vite';
import { Count, type CountTone } from './Count.js';

const TONES: CountTone[] = ['neutral', 'warn', 'run', 'err'];

const meta = {
  component: Count,
  tags: ['vrt-themes'],
  args: { children: '48' },
  argTypes: { tone: { control: 'inline-radio', options: TONES } },
} satisfies Meta<typeof Count>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** tone × form: inline after a title, pushed to the row end, rail bubble. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-2 text-ui text-fg">
      {TONES.map((tone) => (
        <div key={tone} className="flex items-center gap-2">
          <span>Chats</span>
          <Count tone={tone}>48</Count>
          <Count tone={tone} bubble>
            2
          </Count>
          <Count tone={tone} align="end">
            12
          </Count>
        </div>
      ))}
    </div>
  ),
};
