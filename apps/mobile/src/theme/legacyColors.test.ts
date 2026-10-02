import { describe, expect, it } from 'vitest';
import { ACCENT_IDS, THEMES } from '@generatorai/design-tokens';
import { resolveTokenSet } from '@generatorai/design-tokens/emit';
import { legacyColors } from './legacyColors';

describe('legacyColors (M3-05 bridge until M3-08)', () => {
  it('equals the NativeWind-era token bag for every theme × appearance × accent', () => {
    for (const theme of THEMES) {
      for (const appearance of ['dark', 'light'] as const) {
        for (const accent of ACCENT_IDS) {
          const expected = Object.fromEntries(
            Object.entries(resolveTokenSet(theme.id, appearance, accent)).map(([k, v]) => [k.slice(2), v]),
          );
          expect(legacyColors(theme.id, appearance, accent)).toEqual(expected);
        }
      }
    }
  });
});
