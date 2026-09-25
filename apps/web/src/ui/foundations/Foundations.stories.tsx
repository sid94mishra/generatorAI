import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  type AccentId,
  type Density,
  type FontSizeSetting,
} from '@generatorai/design-tokens';
import type { AppliedAppearance } from '../lib/appearance.js';
import { Foundations } from './Foundations.js';

/**
 * The toolbar globals as the accent swatches need them. The preview decorator
 * themes <html> from the same globals; the toolbar only offers valid values.
 */
function appearanceOf(globals: Record<string, unknown>): AppliedAppearance {
  return {
    resolved: globals['mode'] === 'light' ? 'light' : 'dark',
    theme: String(globals['theme']),
    accent: globals['accent'] as AccentId,
    density: globals['density'] as Density,
    fontSize: String(globals['fontSize']) as FontSizeSetting,
    reduceMotion: globals['reduceMotion'] === 'on',
  };
}

const meta = {
  component: Foundations,
  // vrt-themes: axe (test:stories) and VRT also run it in Instrument light and
  // Solarized light (09 §3.6, §4.3, §9.1).
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  // `render` replaces it with the toolbar globals, so it is not a control.
  args: {
    appearance: {
      resolved: 'dark',
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
      density: DEFAULT_DENSITY,
      fontSize: DEFAULT_FONT_SIZE,
      reduceMotion: false,
    },
  },
  argTypes: { appearance: { table: { disable: true } } },
  render: (args, { globals }) => <Foundations {...args} appearance={appearanceOf(globals)} />,
} satisfies Meta<typeof Foundations>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every token in the toolbar's theme, mode, accent and density. */
export const Default: Story = {};

/** The same vocabulary at compact density: control and row heights shrink (D-15). */
export const Compact: Story = {
  globals: { density: 'compact' },
};
