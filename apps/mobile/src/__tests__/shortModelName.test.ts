import { describe, expect, it } from 'vitest';

import { shortModelName } from '../components/chat/composer/turnOptions';

const m = (name: string) => ({ id: name, name }) as Parameters<typeof shortModelName>[0];

describe('shortModelName', () => {
  it('drops the vendor word before a model family name', () => {
    expect(shortModelName(m('Claude Sonnet 5'))).toBe('Sonnet 5');
  });
  it('keeps it when only a version number would be left', () => {
    expect(shortModelName(m('GPT-6-Astra'))).toBe('GPT-6-Astra');
    expect(shortModelName(m('GPT-5.6-Terra'))).toBe('GPT-5.6-Terra');
  });
});
