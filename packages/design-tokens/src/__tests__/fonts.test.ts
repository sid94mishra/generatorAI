// Font stacks (D-16, 02 §5.1): a theme's named fonts first, then the bundled
// family, then generic system fonts — except the system-font themes, whose
// choice IS the platform font.

import { describe, expect, it } from 'vitest';
import { BUNDLED_FONT_FAMILIES, SYSTEM_MONO, SYSTEM_SANS, THEMES } from '../index.js';

const families = (stack: string): string[] => stack.split(',').map((f) => f.trim().replace(/^"|"$/g, ''));

/** Platform fonts and generic keywords: nothing a theme names as its own. */
const SYSTEM_FAMILIES = new Set([
  'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Segoe UI Variable',
  'Helvetica', 'Arial', 'Noto Sans', 'sans-serif',
  'ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace',
]);

function assertBundledBeforeSystem(stack: string, bundled: string, label: string): void {
  const list = families(stack);
  const bundledAt = list.indexOf(bundled);
  const firstSystem = list.findIndex((f) => SYSTEM_FAMILIES.has(f));
  expect(bundledAt, `${label}: ${bundled} missing from ${stack}`).toBeGreaterThanOrEqual(0);
  expect(bundledAt, `${label}: ${bundled} must precede the system fallbacks`).toBeLessThan(firstSystem);
}

describe('theme font stacks (D-16)', () => {
  const [sans, mono] = BUNDLED_FONT_FAMILIES;

  for (const theme of THEMES) {
    it(`${theme.id}: bundled families back the named fonts`, () => {
      if (theme.fonts.sans !== SYSTEM_SANS) assertBundledBeforeSystem(theme.fonts.sans, sans, `${theme.id} sans`);
      if (theme.fonts.mono !== SYSTEM_MONO) assertBundledBeforeSystem(theme.fonts.mono, mono, `${theme.id} mono`);
    });
  }

  it('GitHub keeps the pure system stacks (the pinned "no visual change" theme)', () => {
    const github = THEMES.find((t) => t.id === 'github')!;
    expect(github.fonts).toEqual({ sans: SYSTEM_SANS, mono: SYSTEM_MONO });
  });

  it('Instrument leads with the bundled families', () => {
    const instrument = THEMES.find((t) => t.id === 'instrument')!;
    expect(families(instrument.fonts.sans)[0]).toBe(sans);
    expect(families(instrument.fonts.mono)[0]).toBe(mono);
  });
});
