// A turn persisted without turn ordinals (stage turns before U-42): its narration cannot be placed between its
// steps, but the closing answer must not render above the tool call it reports on.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import { chatMessageToBlocks } from '../transcript/chatMessageToBlocks.js';

const turn = (metadata: ChatMessage['metadata']): ChatMessage =>
  ({ id: 'm', sessionId: 's', role: 'assistant', content: 'Issue opened: #13', timestamp: new Date(0), metadata }) as ChatMessage;

const shape = (blocks: ReturnType<typeof chatMessageToBlocks>) =>
  blocks.map((b) => (b.type === 'text' ? b.content : b.type === 'tool_call' ? b.tool : b.type));

describe('chatMessageToBlocks — a turn without ordinals', () => {
  it('keeps the narration first and puts the closing answer after the steps', () => {
    const blocks = chatMessageToBlocks(turn({
      textSegments: [{ content: 'Checking open issues.' }, { content: 'Filing one issue.' }, { content: 'Issue opened: #13' }],
      toolCalls: [{ id: 't1', tool: 'list_issues', args: {}, status: 'complete' }, { id: 't2', tool: 'create_issue', args: {}, status: 'complete' }],
    }));
    expect(shape(blocks)).toEqual(['Checking open issues.', 'Filing one issue.', 'list_issues', 'create_issue', 'Issue opened: #13']);
  });

  it('leaves a turn with ordinals in the order they give', () => {
    const blocks = chatMessageToBlocks(turn({
      textSegments: [{ content: 'Checking.', sequence: 0 }, { content: 'Issue opened: #13', sequence: 2 }],
      toolCalls: [{ id: 't1', tool: 'create_issue', args: {}, status: 'complete', sequence: 1 }],
    }));
    expect(shape(blocks)).toEqual(['Checking.', 'create_issue', 'Issue opened: #13']);
  });
});
