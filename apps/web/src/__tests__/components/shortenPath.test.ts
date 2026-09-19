// The terminal header says where the shell is. Keeping a fixed number of
// segments let a 36-character workspace UUID eat the label, and the CSS
// ellipsis then removed the only part that answered the question.

import { describe, expect, it } from 'vitest';
import { shortenPath } from '@/components/terminal/TerminalPanel.js';

describe('shortenPath', () => {
  it('keeps the tail when a long id sits in the middle', () => {
    const p =
      '/Users/me/Library/Application Support/@generatorai/desktop/data/workspaces/executions/d9e3d585-5b7e-4b89-b261-99c861196c12/source/shop';
    expect(shortenPath(p)).toBe('…/source/shop');
  });

  it('returns a short path unchanged', () => {
    expect(shortenPath('/srv/app')).toBe('/srv/app');
  });

  it('never drops the final segment, however long it is', () => {
    const p = '/a/b/' + 'x'.repeat(60);
    expect(shortenPath(p)).toBe('…/' + 'x'.repeat(60));
  });

  it('handles Windows separators', () => {
    const p = String.raw`C:\Users\me\AppData\Roaming\GeneratorAI\workspaces\executions\shop\src`;
    expect(shortenPath(p)).toBe('…/workspaces/executions/shop/src');
  });

  it('is empty for an empty path', () => {
    expect(shortenPath('')).toBe('');
  });
});
