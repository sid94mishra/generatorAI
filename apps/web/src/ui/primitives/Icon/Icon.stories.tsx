import type { Meta, StoryObj } from '@storybook/react-vite';
import { ICON } from '@generatorai/design-tokens';
import { ICON_REGISTRY, type IconConcept } from '../../icons/index.js';
import { Icon } from './Icon.js';

const CONCEPTS = Object.keys(ICON_REGISTRY) as IconConcept[];

const meta = {
  component: Icon,
  args: { concept: 'changes', size: 16 },
  argTypes: {
    concept: { control: 'select', options: CONCEPTS },
    size: { control: 'inline-radio', options: ICON.sizes },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With `label` the glyph is an image with that accessible name. */
export const Labelled: Story = { args: { concept: 'warning', label: 'Warning', className: 'text-warn' } };

/** Every size (12/14/16/20) × the status tones. */
export const Matrix: Story = {
  render: () => (
    <div className="grid grid-cols-5 items-center gap-3 text-fg">
      {(['text-fg', 'text-fg-3', 'text-run', 'text-ok', 'text-err'] as const).map((tone) => (
        <div key={tone} className={`flex items-center gap-2 ${tone}`}>
          {ICON.sizes.map((size) => (
            <Icon key={size} concept="status-succeeded" size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The whole concept registry, one glyph per concept (D-17). */
export const Registry: Story = {
  render: () => (
    <div className="grid max-w-240 grid-cols-6 gap-x-4 gap-y-2">
      {CONCEPTS.map((concept) => (
        <div key={concept} className="flex min-w-0 items-center gap-2 text-small text-fg-2">
          <Icon concept={concept} />
          <span className="truncate font-mono text-micro">{concept}</span>
        </div>
      ))}
    </div>
  ),
};
