// U-24: a domain tool that declares `skipPermission` (github_get_issue,
// list_workflows …) is never gated on Claude — Copilot honours the flag
// natively; Claude mapped every domain tool to `other`, which acceptEdits asks for.
import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

type CanUseTool = (toolName: string, input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ behavior: string }>;

function canUseToolFor(skip: string[], onPermissionRequest: () => Promise<unknown>): CanUseTool {
  const provider = new ClaudeAgentProvider({ cliBinaryPath: '/nonexistent/claude', defaultModel: 'sonnet', defaultCwd: '/tmp' } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  const internals = provider as unknown as {
    conversations: Map<string, unknown>;
    skipPermissionTools: Map<string, Set<string>>;
    buildQueryOptions(c: unknown): { canUseTool?: CanUseTool };
  };
  const config = { conversationId: 'c1', model: 'sonnet', workingDirectory: '/tmp', permissionMode: 'acceptEdits', onPermissionRequest };
  internals.conversations.set('c1', config);
  internals.skipPermissionTools.set('c1', new Set(skip));
  return internals.buildQueryOptions(config).canUseTool!;
}

describe('skipPermission domain tools on Claude (U-24)', () => {
  it('allows a skipPermission tool without asking', async () => {
    const ask = vi.fn(async () => ({ behavior: 'deny' }));
    const can = canUseToolFor(['mcp__generatorai-tools__github_get_issue'], ask);
    const out = await can('mcp__generatorai-tools__github_get_issue', { number: 11 }, { signal: new AbortController().signal, toolUseID: 't1' });
    expect(out.behavior).toBe('allow');
    expect(ask).not.toHaveBeenCalled();
  });

  it('still asks for the other domain tools', async () => {
    const ask = vi.fn(async () => ({ behavior: 'deny', message: 'no' }));
    const can = canUseToolFor(['mcp__generatorai-tools__github_get_issue'], ask);
    await can('mcp__generatorai-tools__github_comment_issue', { number: 11, body: 'x' }, { signal: new AbortController().signal, toolUseID: 't2' });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
