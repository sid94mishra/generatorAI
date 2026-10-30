import { describe, expect, it } from 'vitest';

import { shortModelName } from '../blocks/Composer/model/turnOptions';

const m = (name: string) => ({ id: name.toLowerCase(), name }) as Parameters<typeof shortModelName>[0];

describe('shortModelName (D-131)', () => {
  it("shows the provider's own display name, untouched", () => {
    expect(shortModelName(m('Opus 5.5'))).toBe('Opus 5.5');
    expect(shortModelName(m('GPT-6-Luna'))).toBe('GPT-6-Luna');
    expect(shortModelName(m('Claude Sonnet 5'))).toBe('Claude Sonnet 5');
  });

  it('names the default state when no model is chosen', () => {
    expect(shortModelName(undefined)).toBe('Default model');
  });
});
