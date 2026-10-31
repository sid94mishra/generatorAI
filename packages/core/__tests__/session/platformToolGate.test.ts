// D-181: the platform tools bind only with the `platform` group, are appended after the tools already there (R-10),
// and their writes ask like the GitHub writes (askBeforeActing): asked in the asking modes, refused while planning;
// reads never ask.

import { describe, expect, it, vi } from 'vitest';
import { PlatformToolBinder, type BindTarget } from '../../src/services/session/PlatformToolBinder.js';
import type { TurnContext } from '../../src/services/session/types.js';
import type { PlatformToolHost } from '../../src/tools/platform/PlatformToolHost.js';

type Tool = { name: string; handler: (args: Record<string, unknown>) => Promise<unknown> };

const targetWith = (platform: boolean): BindTarget => ({
  owner: { kind: 'chat', chatId: 'c1', sessionId: 's1' },
  sessionId: 's1',
  conversationId: 'conv-1',
  groups: { platform } as never,
});
const turnIn = (permissionMode: string) => ({ permissionMode }) as unknown as TurnContext;

function bind(mode: string, opts: { platform?: boolean; permission?: (...a: unknown[]) => Promise<{ granted: boolean }> } = {}) {
  const host = {
    listChats: vi.fn(async () => ({ chats: [] })),
    createChat: vi.fn(async () => ({ chatId: 'n1' })),
  };
  const cfg: Record<string, unknown> = { conversationId: 'conv-1', tools: [{ name: 'existing_tool' }] };
  const permission = opts.permission ?? vi.fn(async () => ({ granted: true }));
  new PlatformToolBinder({ platformTools: host as unknown as PlatformToolHost }).platform(cfg as never, targetWith(opts.platform ?? true), {
    turnOf: () => undefined,
    port: { permission } as never,
    gateTurnOf: () => turnIn(mode),
  });
  const tools = cfg['tools'] as Tool[];
  return { host, tools, permission, tool: (name: string) => tools.find((t) => t.name === name)! };
}

describe('platform tools in a session (D-181)', () => {
  it('bind only with the platform group, after the existing tools', () => {
    expect(bind('acceptEdits', { platform: false }).tools.map((t) => t.name)).toEqual(['existing_tool']);
    const names = bind('acceptEdits').tools.map((t) => t.name);
    expect(names[0]).toBe('existing_tool');
    expect(names.slice(1, 3)).toEqual(['list_chats', 'read_chat']);
    expect(names).toHaveLength(14);
  });

  it('creating a chat asks in Accept edits, listing does not; planning refuses the write', async () => {
    const { host, tool, permission } = bind('acceptEdits');
    await tool('list_chats').handler({});
    await tool('create_chat').handler({ name: 'x' });
    expect(permission).toHaveBeenCalledTimes(1);
    expect(host.createChat).toHaveBeenCalledTimes(1);

    const planning = bind('plan');
    await expect(planning.tool('create_chat').handler({ name: 'x' })).rejects.toThrow('not available while planning');
    expect(planning.host.createChat).not.toHaveBeenCalled();
    await planning.tool('list_chats').handler({});
    expect(planning.host.listChats).toHaveBeenCalledTimes(1);
  });
});
