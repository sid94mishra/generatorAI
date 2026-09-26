import { describe, expect, it, vi } from 'vitest';
import type { WorkflowToolAdvert } from '@generatorai/workflow-spec';
import { GeneratorAiMcpServer, type AiFacade, type AiChatSummary } from '../server.js';

// This exercises the real dispatch path (`callTool`, `listTools`,
// `listResources`, `readResource`) without a live stdio transport or a
// running server — `AiFacade` is the narrow slice of the remote API (P04
// remote mode) a fake can satisfy directly.

const ADVERTS: WorkflowToolAdvert[] = [
  {
    name: 'list_workflows',
    description: 'List workflows',
    parametersSchema: { type: 'object', properties: { query: { type: 'string' } } },
    readOnly: true,
  },
  {
    name: 'run_workflow',
    description: 'Run a workflow',
    parametersSchema: { type: 'object', properties: { workflowId: { type: 'string' }, reason: { type: 'string' } }, required: ['workflowId', 'reason'] },
    readOnly: false,
  },
];

function fakeAi(): AiFacade {
  const chats: AiChatSummary[] = [{ id: 'c1', name: 'Existing chat', status: 'active' }];
  return {
    chat: {
      list: vi.fn(async () => chats),
      create: vi.fn(async (opts) => ({ id: 'new-chat-id', ...opts })),
      send: vi.fn(async () => undefined),
    },
    workflowTools: {
      list: vi.fn(async () => ADVERTS),
      call: vi.fn(async (name: string) => (name === 'run_workflow' ? { runId: 'run-1', status: 'starting' } : { workflows: [] })),
    },
    skill: {
      index: vi.fn(async () => ({ name: 'generatorai-workflow-author', schemaHash: 'h1', files: ['SKILL.md', 'schema/workflow.schema.json', 'scripts/validate.mjs'] })),
      file: vi.fn(async (path: string) => `contents of ${path}`),
    },
  };
}

describe('GeneratorAiMcpServer', () => {
  it('advertises the chat tools and every server workflow tool under the generatorai_ prefix', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    const tools = await server.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'generatorai_list_chats',
      'generatorai_send_prompt',
      'generatorai_list_workflows',
      'generatorai_run_workflow',
    ]);
    const run = tools.find((t) => t.name === 'generatorai_run_workflow')!;
    expect(run.annotations).toEqual({ readOnlyHint: false });
    expect((run.inputSchema['properties'] as Record<string, unknown>)['idempotencyKey']).toBeDefined();
    const list = tools.find((t) => t.name === 'generatorai_list_workflows')!;
    expect(list.annotations).toEqual({ readOnlyHint: true });
    expect((list.inputSchema['properties'] as Record<string, unknown>)['idempotencyKey']).toBeUndefined();
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

  it('a workflow tool is called on the server, with the idempotencyKey lifted out of the arguments', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_run_workflow', {
      workflowId: 'def-1',
      reason: 'test',
      idempotencyKey: 'k1',
    });
    expect(ai.workflowTools.call).toHaveBeenCalledWith('run_workflow', { workflowId: 'def-1', reason: 'test' }, { idempotencyKey: 'k1' });
    expect(result).toMatchObject({ runId: 'run-1', status: 'starting' });
  });

  it('serves the skill bundle as resources', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    expect(await server.listResources()).toEqual([
      { uri: 'generatorai://workflow-author/SKILL.md', name: 'SKILL.md', mimeType: 'text/markdown' },
      { uri: 'generatorai://workflow-author/schema/workflow.schema.json', name: 'schema/workflow.schema.json', mimeType: 'application/json' },
      { uri: 'generatorai://workflow-author/scripts/validate.mjs', name: 'scripts/validate.mjs', mimeType: 'text/javascript' },
    ]);
    expect(await server.readResource('generatorai://workflow-author/SKILL.md')).toBe('contents of SKILL.md');
    expect(ai.skill.file).toHaveBeenCalledWith('SKILL.md');
    await expect(server.readResource('file:///etc/passwd')).rejects.toThrow('Unknown resource');
  });

  it('an unknown tool throws', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    await expect(server.callTool('not_a_real_tool', {})).rejects.toThrow('Unknown tool');
    await expect(server.callTool('generatorai_not_a_tool', {})).rejects.toThrow('Unknown tool');
  });
});
