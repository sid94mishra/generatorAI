import { describe, expect, it, vi } from 'vitest';
import { GeneratorAiMcpServer, type AiFacade, type AiChatSummary } from '../server.js';

// This exercises the real dispatch path (`callTool`) without a live stdio
// transport or a running server — `AiFacade` is the narrow slice of the
// remote API (P04 remote mode) a fake can satisfy directly.

function fakeAi(overrides: Partial<AiFacade> = {}): AiFacade {
  const chats: AiChatSummary[] = [{ id: 'c1', name: 'Existing chat', status: 'active' }];
  return {
    chat: {
      list: vi.fn(async () => chats),
      create: vi.fn(async (opts) => ({ id: 'new-chat-id', ...opts })),
      send: vi.fn(async () => undefined),
    },
    workflows: {
      invoke: vi.fn(async () => ({
        invocationId: 'inv-1',
        runId: 'run-1',
        workflowDefinitionId: 'def-1',
        status: 'starting' as const,
        replayed: false,
        trigger: { kind: 'external_agent' as const, via: 'mcp' as const, principalId: 'd1' },
        links: { app: '/workflows/def-1/runs/run-1', api: '/api/workflow-runs/run-1', stream: '/api/stream?scope=run&id=run-1' },
        plan: {} as never,
        warnings: [],
      })),
    },
    ...overrides,
  } as AiFacade;
}

describe('GeneratorAiMcpServer', () => {
  it('advertises the three built-in tools', () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    const names = server.listTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['generatorai_list_chats', 'generatorai_send_prompt', 'generatorai_run_workflow']),
    );
  });

  it('generatorai_list_chats forwards to ai.chat.list', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_list_chats', { status: 'active' });
    expect(ai.chat.list).toHaveBeenCalledWith('active', undefined);
    expect(result).toEqual([{ id: 'c1', name: 'Existing chat', status: 'active' }]);
  });

  it('generatorai_send_prompt creates a chat when chatId is omitted, then sends', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_send_prompt', { message: 'hello' });
    expect(ai.chat.create).toHaveBeenCalledTimes(1);
    expect(ai.chat.send).toHaveBeenCalledWith('new-chat-id', 'hello');
    expect(result).toEqual({ chatId: 'new-chat-id', created: true });
  });

  it('generatorai_send_prompt reuses an existing chatId without creating one', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_send_prompt', { chatId: 'c1', message: 'hi again' });
    expect(ai.chat.create).not.toHaveBeenCalled();
    expect(ai.chat.send).toHaveBeenCalledWith('c1', 'hi again');
    expect(result).toEqual({ chatId: 'c1', created: false });
  });

  it('generatorai_send_prompt rejects a missing message', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    await expect(server.callTool('generatorai_send_prompt', {})).rejects.toThrow('"message" is required');
  });

  it('generatorai_run_workflow starts the run through the one invocation', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_run_workflow', {
      definitionId: 'def-1',
      variables: { foo: 'bar' },
      idempotencyKey: 'k1',
    });
    expect(ai.workflows.invoke).toHaveBeenCalledWith(
      { target: { kind: 'definition', workflowDefinitionId: 'def-1' }, variables: { foo: 'bar' }, client: 'mcp' },
      { idempotencyKey: 'k1' },
    );
    expect(result).toMatchObject({ runId: 'run-1', status: 'starting' });
  });

  it('an unknown tool throws', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    await expect(server.callTool('not_a_real_tool', {})).rejects.toThrow('Unknown tool');
  });
});
