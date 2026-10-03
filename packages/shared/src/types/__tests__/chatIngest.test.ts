import { describe, expect, it } from 'vitest';

import { ChatIngestTargetSchema } from '../../config/ChatSchemas.js';
import { chatIngestName, chatIngestPrompt } from '../ChatIngest.js';

describe('chat ingest (MG-09)', () => {
  it('builds the prompt from the note, text and URL, or names the files', () => {
    expect(chatIngestPrompt({ note: ' look ', text: 'log line', url: 'https://x.dev' })).toBe('look\n\nlog line\n\nhttps://x.dev');
    expect(chatIngestPrompt({ fileNames: ['a.txt'] })).toBe('Shared file: a.txt');
    expect(chatIngestPrompt({ note: '  ', fileNames: ['a.txt', 'b.png'] })).toBe('Shared files: a.txt, b.png');
    expect(chatIngestPrompt({})).toBe('');
  });

  it('names a new chat from the first line, shortened', () => {
    expect(chatIngestName('\nFix the flaky test\nmore')).toBe('Fix the flaky test');
    expect(chatIngestName('x'.repeat(80))).toHaveLength(58);
  });

  it('accepts an existing or a new chat target only', () => {
    expect(ChatIngestTargetSchema.safeParse({ chatId: 'c1' }).success).toBe(true);
    expect(ChatIngestTargetSchema.safeParse({ newChat: {} }).success).toBe(true);
    expect(ChatIngestTargetSchema.safeParse({ newChat: { projectId: 'not-a-uuid' } }).success).toBe(false);
    expect(ChatIngestTargetSchema.safeParse({ chatId: 'c1', newChat: {} }).success).toBe(false);
  });
});
