import { describe, expect, it, vi } from 'vitest';

import { onMentionRequest, requestMention } from './mentionBus';

describe('mention bus (MB-26 "Mention in chat")', () => {
  it('delivers to the chat listening, or queues for the next composer of that chat', () => {
    const a = vi.fn();
    const off = onMentionRequest('c1', a);
    requestMention('c1', 'src/a.ts');
    expect(a).toHaveBeenCalledWith('src/a.ts');
    off();
    requestMention('c1', 'src/b.ts');
    expect(a).toHaveBeenCalledTimes(1);
    const b = vi.fn();
    onMentionRequest('c1', b);
    expect(b).toHaveBeenCalledWith('src/b.ts');
    requestMention('c2', 'x');
    expect(b).toHaveBeenCalledTimes(1);
  });
});
