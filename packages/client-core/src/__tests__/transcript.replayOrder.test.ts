// Replay order of a persisted turn: one saved without ordinals (stage turns before U-42) still ends with its closing
// answer, and a revised plan replays the person's reply where they sent it, the card after the edits it led to.
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

describe('chatMessageToBlocks — a revised plan', () => {
  it("replays the person's reply where they sent it and the card at its latest revision's place", () => {
    const blocks = chatMessageToBlocks(turn({
      textSegments: [{ content: 'Drafting a plan.', sequence: 0 }, { content: 'Issue opened: #13', sequence: 6 }],
      toolCalls: [{ id: 't1', tool: 'ExitPlanMode', args: {}, status: 'complete', sequence: 1 }, { id: 't2', tool: 'Edit', args: {}, status: 'complete', sequence: 3 }],
      planCards: [{
        planId: 'p1', revision: 2, title: 'Plan', fileName: 'plan.md', summary: '', status: 'approved', sequence: 4,
        notes: [{ revision: 1, decision: 'changes_requested', text: 'Rename the test file', sequence: 2 }],
      }],
    }));
    expect(shape(blocks)).toEqual(['Drafting a plan.', 'ExitPlanMode', 'system', 'Edit', 'plan', 'Issue opened: #13']);
    expect(blocks[2]).toMatchObject({ category: 'operator', message: 'Rename the test file', label: 'Changes requested' });
  });
});
