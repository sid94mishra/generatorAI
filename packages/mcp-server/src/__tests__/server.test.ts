import { describe, expect, it, vi } from 'vitest';
import type { PlatformToolAdvert } from '@generatorai/shared';
import type { WorkflowToolAdvert } from '@generatorai/workflow-spec';
import { GeneratorAiMcpServer, parseServeArgs, parseToolsets, serverInstructions, type AiFacade } from '../server.js';

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

const platform = (name: string, toolset: PlatformToolAdvert['toolset'], readOnly: boolean): PlatformToolAdvert => ({
  name,
  description: name,
  parametersSchema: { type: 'object', properties: { chatId: { type: 'string' } } },
  toolset,
  readOnly,
  destructive: false,
  idempotent: readOnly,
  scopes: ['read:chats'],
});

const PLATFORM: PlatformToolAdvert[] = [
  platform('list_chats', 'chats', true),
  platform('create_chat', 'chats', false),
  platform('wait_for_chat', 'chats', true),
  platform('list_projects', 'projects', true),
  platform('read_chat_file', 'files', true),
];

function fakeAi(): AiFacade {
  return {
    chat: {
      create: vi.fn(async (opts) => ({ id: 'new-chat-id', ...opts })),
      send: vi.fn(async () => undefined),
    },
    platformTools: {
      list: vi.fn(async () => PLATFORM),
      call: vi.fn(async (name: string, args: Record<string, unknown>) =>
        name === 'wait_for_chat' ? { chatId: args['chatId'], status: 'idle', reply: 'done' } : { chats: [] },
      ),
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
  it('advertises send_prompt, every platform tool and every workflow tool under the generatorai_ prefix', async () => {
    const server = new GeneratorAiMcpServer({ ai: fakeAi() });
    const tools = await server.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'generatorai_send_prompt',
      'generatorai_list_chats',
      'generatorai_create_chat',
      'generatorai_wait_for_chat',
      'generatorai_list_projects',
      'generatorai_read_chat_file',
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

  it('platform tools carry MCP annotations from their flags, and the writes take an idempotencyKey', async () => {
    const tools = await new GeneratorAiMcpServer({ ai: fakeAi() }).listTools();
    const listChats = tools.find((t) => t.name === 'generatorai_list_chats')!;
    expect(listChats.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    const create = tools.find((t) => t.name === 'generatorai_create_chat')!;
    expect(create.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect((create.inputSchema['properties'] as Record<string, unknown>)['idempotencyKey']).toBeDefined();
    const send = tools.find((t) => t.name === 'generatorai_send_prompt')!;
    expect((send.inputSchema['properties'] as Record<string, unknown>)['wait']).toBeDefined();
  });

  it('a platform tool is called on the server, with the idempotencyKey lifted out', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    await server.callTool('generatorai_create_chat', { name: 'x', idempotencyKey: 'k9' });
    expect(ai.platformTools.call).toHaveBeenCalledWith('create_chat', { name: 'x' }, { idempotencyKey: 'k9' });
    expect(ai.workflowTools.call).not.toHaveBeenCalled();
  });

  it('--toolsets and --read-only narrow what is served', async () => {
    const files = await new GeneratorAiMcpServer({ ai: fakeAi(), toolsets: ['files'] }).listTools();
    expect(files.map((t) => t.name)).toEqual(['generatorai_read_chat_file']);

    const ai = fakeAi();
    const readOnly = new GeneratorAiMcpServer({ ai, readOnly: true });
    const names = (await readOnly.listTools()).map((t) => t.name);
    expect(names).toEqual(['generatorai_list_chats', 'generatorai_wait_for_chat', 'generatorai_list_projects', 'generatorai_read_chat_file', 'generatorai_list_workflows']);
    await expect(readOnly.callTool('generatorai_create_chat', { name: 'x' })).rejects.toThrow('Unknown tool');
    await expect(readOnly.callTool('generatorai_send_prompt', { message: 'x' })).rejects.toThrow('Unknown tool');

    // Without the workflows toolset the workflow list is never fetched.
    const chatsOnly = fakeAi();
    await new GeneratorAiMcpServer({ ai: chatsOnly, toolsets: ['chats'] }).listTools();
    expect(chatsOnly.workflowTools.list).not.toHaveBeenCalled();
  });

  it('a tool list the device may not read is served empty, the rest still work', async () => {
    const ai = fakeAi();
    ai.platformTools.list = vi.fn(async () => {
      throw new Error('403');
    });
    const log = vi.fn();
    const tools = await new GeneratorAiMcpServer({ ai, log }).listTools();
    expect(tools.map((t) => t.name)).toEqual(['generatorai_send_prompt', 'generatorai_list_workflows', 'generatorai_run_workflow']);
    expect(log).toHaveBeenCalled();
  });

  it('generatorai_send_prompt creates a chat when chatId is omitted, then sends', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_send_prompt', { message: 'hello' });
    expect(ai.chat.create).toHaveBeenCalledTimes(1);
    expect(ai.chat.send).toHaveBeenCalledWith('new-chat-id', 'hello');
    expect(result).toEqual({ chatId: 'new-chat-id', created: true });
    expect(ai.platformTools.call).not.toHaveBeenCalled();
  });

  it('generatorai_send_prompt with wait returns the reply through the server\'s wait_for_chat (capped at 600 s)', async () => {
    const ai = fakeAi();
    const server = new GeneratorAiMcpServer({ ai });
    const result = await server.callTool('generatorai_send_prompt', { chatId: 'c1', message: 'hi again', wait: 9_999 });
    expect(ai.chat.create).not.toHaveBeenCalled();
    expect(ai.chat.send).toHaveBeenCalledWith('c1', 'hi again');
    expect(ai.platformTools.call).toHaveBeenCalledWith('wait_for_chat', { chatId: 'c1', timeoutSeconds: 600 }, {});
    expect(result).toEqual({ chatId: 'c1', created: false, status: 'idle', reply: 'done' });
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

describe('serve flags and instructions', () => {
  it('parses --toolsets and --read-only, refusing unknown names and options', () => {
    expect(parseServeArgs([])).toEqual({ readOnly: false });
    expect(parseServeArgs(['--toolsets', 'chats, files', '--read-only'])).toEqual({ toolsets: ['chats', 'files'], readOnly: true });
    expect(parseServeArgs(['--toolsets=workflows'])).toEqual({ toolsets: ['workflows'], readOnly: false });
    expect(() => parseToolsets('chats,nope')).toThrow('Unknown toolset');
    expect(() => parseServeArgs(['--toolsets'])).toThrow('at least one');
    expect(() => parseServeArgs(['--verbose'])).toThrow('Unknown option');
  });

  it('describes the toolsets served and the rules the server enforces', () => {
    const all = serverInstructions();
    expect(all).toContain('- chats:');
    expect(all).toContain('- workflows:');
    expect(all).toContain('never bypass');
    const narrow = serverInstructions({ toolsets: ['files'], readOnly: true });
    expect(narrow).toContain('- files:');
    expect(narrow).not.toContain('- chats:');
    expect(narrow).toContain('read-only');
  });
});
