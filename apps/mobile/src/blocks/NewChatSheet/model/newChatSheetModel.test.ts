import { describe, expect, it } from 'vitest';
import { EMPTY_NEW_CHAT_DRAFT, agentTool, capabilitiesSummary, createBlocker, createBody, setToolOverride, sourcesFootnote, whoSummary } from './newChatSheetModel';

describe('New chat model (MB-06)', () => {
  it('needs a task and, for an agent, the agent', () => {
    expect(createBlocker({ prompt: ' ', who: 'model' })).toBe('Describe the task');
    expect(createBlocker({ prompt: 'Fix it', who: 'agent' })).toBe('Choose an agent');
    expect(createBlocker({ prompt: 'Fix it', who: 'model' })).toBeNull();
  });

  it('names the chat from the task and sends the agent only for agent / orchestrator chats', () => {
    const body = createBody({ ...EMPTY_NEW_CHAT_DRAFT, prompt: 'Fix the flaky checkout test\nmore', who: 'orchestrator', agentRef: 'global:orch', overrides: { tools: { shell: false } } });
    expect(body).toMatchObject({ name: 'Fix the flaky checkout test', agentRef: 'global:orch', orchestratorMode: true, agentOverrides: { tools: { shell: false } } });
    const model = createBody({ ...EMPTY_NEW_CHAT_DRAFT, prompt: 'x', who: 'model', agentRef: 'global:a', model: 'sonnet' });
    expect(model.agentRef).toBeUndefined();
    expect(model.model).toBe('sonnet');
  });

  it('says what the sources create and who works on it', () => {
    expect(sourcesFootnote([{ mode: 'worktree', branchMode: 'new' }])).toBe('1 worktree and 1 branch will be created');
    expect(sourcesFootnote([{ mode: 'in-place', branchMode: 'current' }])).toBeNull();
    expect(whoSummary('Bug Fixer', 'Sonnet 5')).toBe('Bug Fixer · Sonnet 5');
  });

  it('keeps a capability override only when it differs from the agent (Reset = remove)', () => {
    expect(agentTool({}, 'fileRead')).toBe(true);
    const on = setToolOverride({}, 'browser', true, false);
    expect(on.tools).toEqual({ browser: true });
    expect(setToolOverride(on, 'browser', false, false).tools).toBeUndefined();
    expect(capabilitiesSummary(5, 2, 5)).toBe('5 skills · 2 MCP · 5 of 8 capabilities');
  });
});
