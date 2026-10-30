// U-46: the native Claude CLI keeps Glob and Grep only when a session names them in `tools` or
// `allowedTools`; otherwise it drops them and points the model at `find` / `grep` through Bash (which
// asks in the asking modes). A chat with no tool restriction named neither and lost them.

import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import type { CreateConversationParams } from '@generatorai/core';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn(async () => {
    throw new Error('not used');
  }),
  deleteSession: vi.fn(),
}));

type Internals = { conversations: Map<string, unknown>; buildQueryOptions: (config: unknown) => Record<string, unknown> };

async function optionsFor(params: Partial<CreateConversationParams>): Promise<Record<string, unknown>> {
  const provider = new ClaudeAgentProvider({ cliPath: '/nonexistent/claude', defaultCwd: '/work' } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  await provider.createConversation({ conversationId: 'c1', workingDirectory: '/work', ...params } as CreateConversationParams);
  const internals = provider as unknown as Internals;
  return internals.buildQueryOptions(internals.conversations.get('c1'));
}

describe('Claude search tools (U-46)', () => {
  it('an unrestricted session names Glob and Grep, so the CLI keeps them', async () => {
    const options = await optionsFor({});
    expect(options['allowedTools']).toEqual(expect.arrayContaining(['Glob', 'Grep']));
  });

  it('an excluded search tool stays out', async () => {
    const options = await optionsFor({ excludedBuiltinTools: ['Grep'] });
    expect(options['allowedTools']).toEqual(expect.arrayContaining(['Glob']));
    expect(options['allowedTools']).not.toContain('Grep');
  });
});
