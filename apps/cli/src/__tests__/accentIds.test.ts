// cli-core cannot depend on design-tokens, so it keeps its own copy of the
// accent ids for the config schema (02 §4.3). This pins the copy to the source.

import { describe, expect, it } from 'vitest';
import { TUI_ACCENT_IDS } from '@generatorai/cli-core';
import { ACCENT_IDS } from '@generatorai/design-tokens';

describe('TUI accent ids', () => {
  it('equal the design-token accent ids, in order', () => {
    expect([...TUI_ACCENT_IDS]).toEqual([...ACCENT_IDS]);
  });
});
