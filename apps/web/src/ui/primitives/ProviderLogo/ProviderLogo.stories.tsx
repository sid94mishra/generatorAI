import type { Meta, StoryObj } from '@storybook/react-vite';
import { HARNESS_PROVIDER_IDS, harnessProviderLabel, type ProviderMark } from '@generatorai/shared';
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

// Server-supplied marks (ACP agents, ACP-5): `{viewBox, nodes}` as the server sanitised them. Drawn for these stories.
const PATH_MARK: ProviderMark = {
  viewBox: '0 0 16 16',
  nodes: [{ tag: 'path', attrs: { fill: 'currentColor', d: 'M3 1h2.5v5.5L9 1h3L8.5 6.5 12.5 13H9.5L6 8v5H3V1z' } }],
};
const SHAPES_MARK: ProviderMark = {
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'rect', attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', x: '2.5', y: '2.5', width: '11', height: '11', rx: '2.5' } },
    { tag: 'circle', attrs: { cx: '8', cy: '8', r: '2.5' } },
    { tag: 'line', attrs: { stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', x1: '5', y1: '11', x2: '11', y2: '11' } },
  ],
};
const GROUP_MARK: ProviderMark = {
  viewBox: '0 0 160 160',
  nodes: [
    {
      tag: 'g',
      attrs: { transform: 'translate(0,160) scale(1,-1)', fill: 'currentColor' },
      children: [
        { tag: 'polygon', attrs: { points: '80,10 150,150 10,150' } },
        { tag: 'g', attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '8' }, children: [{ tag: 'ellipse', attrs: { cx: '80', cy: '110', rx: '24', ry: '16' } }] },
      ],
    },
  ],
};
// What the client refuses even if a server sent it: an unknown tag and foreign paint are not drawn.
const HOSTILE_MARK = {
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'script', attrs: { d: 'M0 0' } },
    { tag: 'path', attrs: { fill: 'red', onclick: 'alert(1)', d: 'M2 2h12v12H2z' } },
  ],
} as unknown as ProviderMark;

const MARKS: { name: string; mark: ProviderMark | undefined }[] = [
  { name: 'Path only', mark: PATH_MARK },
  { name: 'Rect, circle, line', mark: SHAPES_MARK },
  { name: 'Transformed group', mark: GROUP_MARK },
  { name: 'Unknown tag and paint dropped', mark: HOSTILE_MARK },
  { name: 'No mark (fallback)', mark: undefined },
];

/** A server-supplied mark (an ACP agent's registry icon) at every size; no mark falls back to the generic mark. */
export const ServerMark: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-small text-fg-2">
      {MARKS.map(({ name, mark }) => (
        <div key={name} className="flex items-center gap-4">
          <span className="w-56 truncate">{name}</span>
          {SIZES.map((size) => (
            <ProviderLogo key={size} provider="acp" mark={mark} size={size} label={`${name} ${size}`} />
          ))}
        </div>
      ))}
    </div>
  ),
};
