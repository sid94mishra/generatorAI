import type { Meta, StoryObj } from '@storybook/react-vite';
import { HARNESS_PROVIDER_IDS, harnessProviderLabel } from '@generatorai/shared';
import { ProviderLogo, type ProviderLogoSize } from './ProviderLogo.js';

const PROVIDERS = [...HARNESS_PROVIDER_IDS, 'faux', 'unknown-provider'];
const SIZES: ProviderLogoSize[] = [12, 14, 16, 20, 24];

const meta = {
  component: ProviderLogo,
  tags: ['vrt-themes'],
  args: { provider: 'claude-agent', size: 16, variant: 'color', label: true },
  argTypes: {
    provider: { control: 'select', options: PROVIDERS },
    size: { control: 'select', options: SIZES },
    variant: { control: 'inline-radio', options: ['color', 'mono'] },
  },
} satisfies Meta<typeof ProviderLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every provider × size × variant. Unknown ids fall back to the neutral mark. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-small text-fg-2">
      {PROVIDERS.map((provider) => (
        <div key={provider} className="flex items-center gap-4">
          <span className="w-36 truncate">{harnessProviderLabel(provider)}</span>
          {(['color', 'mono'] as const).map((variant) => (
            <span key={variant} className="flex items-center gap-2">
              {SIZES.map((size) => (
                <ProviderLogo key={size} provider={provider} size={size} variant={variant} label={`${harnessProviderLabel(provider)} ${variant} ${size}`} />
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Decorative next to the provider's name (the common case: picker rows, settings). */
export const WithName: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-ui text-fg">
      {HARNESS_PROVIDER_IDS.map((provider) => (
        <span key={provider} className="inline-flex items-center gap-2">
          <ProviderLogo provider={provider} />
          {harnessProviderLabel(provider)}
        </span>
      ))}
    </div>
  ),
};

/** On a selected (tinted) row the mono variant follows the row's text colour. */
export const OnSelectedRow: Story = {
  render: () => (
    <div className="flex w-56 flex-col gap-0.5">
      {HARNESS_PROVIDER_IDS.map((provider, i) => (
        <span
          key={provider}
          className={i === 0 ? 'flex items-center gap-2 rounded-control-sm bg-selected px-2 py-1 text-ui text-fg' : 'flex items-center gap-2 px-2 py-1 text-ui text-fg-2'}
        >
          <ProviderLogo provider={provider} variant={i === 0 ? 'mono' : 'color'} />
          {harnessProviderLabel(provider)}
        </span>
      ))}
    </div>
  ),
};
