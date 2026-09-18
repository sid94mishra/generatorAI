import { describe, expect, it } from 'vitest';

import { displayChatName, parseChatName } from '../components/common/chatName';

describe('parseChatName', () => {
  it('strips the orchestrator worker marker and flags the chat as a sub-agent', () => {
    expect(parseChatName('⚙ slow-readme')).toEqual({ title: 'slow-readme', subAgent: true });
    // With the emoji variation selector, and extra spacing.
    expect(parseChatName('⚙️  counter-changelog')).toEqual({ title: 'counter-changelog', subAgent: true });
    expect(parseChatName('  ⚙slow')).toEqual({ title: 'slow', subAgent: true });
  });

  it('leaves ordinary names alone', () => {
    expect(parseChatName('Fix the ⚙ gear icon')).toEqual({ title: 'Fix the ⚙ gear icon', subAgent: false });
    expect(parseChatName('UI stop test')).toEqual({ title: 'UI stop test', subAgent: false });
  });

  it('never returns an empty title', () => {
    expect(parseChatName('⚙ ').title).toBe('Untitled chat');
    expect(parseChatName(null).title).toBe('Untitled chat');
    expect(parseChatName('', 'Chat').title).toBe('Chat');
    expect(displayChatName('⚙ task')).toBe('task');
  });
});
