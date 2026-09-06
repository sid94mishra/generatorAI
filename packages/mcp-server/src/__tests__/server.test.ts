import { describe, expect, it, vi } from 'vitest';
import { CustomToolRegistry } from '@generatorai/core';
import { GeneratorAiMcpServer, type AiFacade, type AiChatSummary } from '../server.js';

// The old `McpServerScaffold.start()` was a single log line — the package
// had `@modelcontextprotocol/sdk` in node_modules and a name promising a
// real server, but no transport and nothing that dispatched a tool call.
// This exercises the real dispatch path (`callTool`) without needing a live
// stdio transport or a real `@generatorai/sdk` `GeneratorAI` instance —
// `AiFacade` is a narrow structural interface a fake can satisfy directly.

function fakeAi(overrides: Partial<AiFacade> = {}): AiFacade {
  const chats: AiChatSummary[] = [{ id: 'c1', name: 'Existing chat', status: 'active' }];
  return {
    chat: {
      list: vi.fn(async () => chats),
      create: vi.fn(async (opts) => ({ id: 'new-chat-id', ...opts })),
      send: vi.fn(async () => undefined),
    },
    workflows: {
      run: vi.fn(async (definitionId) => ({ id: 'run-1', status: 'running', definitionId })),
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

  it('generatorai_run_workflow forwards to ai.workflows.run', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_run_workflow', {
      definitionId: 'def-1',
      variables: { foo: 'bar' },
    });
    expect(ai.workflows.run).toHaveBeenCalledWith('def-1', { variables: { foo: 'bar' }, projectId: undefined });
    expect(result).toMatchObject({ id: 'run-1', status: 'running' });
  });

  it('an unknown tool with no registry throws', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    await expect(server.callTool('not_a_real_tool', {})).rejects.toThrow('Unknown tool');
  });

  it('dispatches a registered custom tool (TOL-05) alongside the built-ins', async () => {
    const registry = new CustomToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echoes its input',
      parametersSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: async (args) => ({ echoed: args }),
    });
    const server = new GeneratorAiMcpServer({ ai: fakeAi(), registry });
    expect(server.listTools().map((t) => t.name)).toContain('echo');
    const result = await server.callTool('echo', { text: 'hi' });
    expect(result).toEqual({ echoed: { text: 'hi' } });
  });
});
