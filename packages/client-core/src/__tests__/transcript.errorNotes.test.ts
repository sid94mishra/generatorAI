import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import { chatMessageToBlocks } from '../transcript/chatMessageToBlocks.js';

const msg = (content: string, systemMessages?: string[]): ChatMessage =>
  ({ id: 'm', sessionId: 's', role: 'assistant', content, timestamp: new Date(0), metadata: { systemMessages } }) as ChatMessage;

describe('chatMessageToBlocks — provider errors', () => {
  it('closes a failed turn with its error note, after the text', () => {
    const blocks = chatMessageToBlocks(msg('Running the build…', ['Error: pnpm typecheck exited 2']));
    expect(blocks.map((b) => b.type)).toEqual(['text', 'system']);
    expect(blocks[1]).toMatchObject({ category: 'error', message: 'Error: pnpm typecheck exited 2' });
  });
  it('ignores non-error system notes', () => {
    expect(chatMessageToBlocks(msg('ok', ['Compacted the context'])).map((b) => b.type)).toEqual(['text']);
  });
});
