// The icon concept registry (packages/design-tokens/src/icons.ts, D-17) names
// lucide icons by string. This is the test that the names are real in the
// lucide-react apps/web actually has installed, and that the status map's
// glyphs (packages/shared/src/status, D-18) are all registered concepts.
import { describe, expect, it } from 'vitest';
import { icons } from 'lucide-react';
import { ICON_CONCEPTS, isIconConcept } from '@generatorai/design-tokens';
import { STATUS_STATES, STATUS_STATE_DEFS } from '@generatorai/shared';

const pascal = (kebab: string) =>
  kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

describe('ICON_CONCEPTS against the installed lucide-react', () => {
  it.each(Object.entries(ICON_CONCEPTS))('%s → lucide "%s" exists', (_concept, def) => {
    expect(icons, def.lucide).toHaveProperty(pascal(def.lucide));
  });
});

describe('status glyphs', () => {
  it.each(STATUS_STATES)('%s glyph is a registered concept', (state) => {
    expect(isIconConcept(STATUS_STATE_DEFS[state].glyph)).toBe(true);
  });
});
