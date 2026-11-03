// ────────────────────────────────────────────────────────────────
// ChatManagementService.deleteChat — workspace teardown (P0-d)
//
// `deleteChat` never called `deleteWorkspace`, so none of the `beforeDelete`
// listeners fired: the Chromium instance, every PTY, the CUA session, the
// workspace row and the on-disk tree all survived a chat deletion — and once
// the chat row was gone the workspace (keyed by `ownerId = chatId`) was
// unreachable from the UI, so it leaked permanently.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { Chat, Session } from '@generatorai/shared';
import { ChatManagementService } from '../ChatManagementService.js';

interface Fakes {
  service: ChatManagementService;
  deleteWorkspace: ReturnType<typeof vi.fn>;
  chatDelete: ReturnType<typeof vi.fn>;
  sessionDelete: ReturnType<typeof vi.fn>;
  getExecutionWorkspace: ReturnType<typeof vi.fn>;
}

function build(opts: {
  chat: Partial<Chat>;
  /** `ownerId` of the workspace row `getExecutionWorkspace` resolves to. */
  workspaceOwnerId?: string | null;
  deleteWorkspaceImpl?: () => Promise<void>;
  withWorkspaceManager?: boolean;
}): Fakes {
  const chatId = opts.chat.id ?? 'chat-1';
  const chat: Chat = {
    id: chatId,
    name: 'test',
    sessionId: 'sess-1',
    tags: [],
    status: 'active',
    ...opts.chat,
  } as Chat;
  const session = { id: 'sess-1', conversationId: undefined } as unknown as Session;

  const chatDelete = vi.fn(async () => {});
  const sessionDelete = vi.fn(async () => {});
  const deleteWorkspace = vi.fn(opts.deleteWorkspaceImpl ?? (async () => {}));
  const getExecutionWorkspace = vi.fn(async (id: string) =>
    opts.workspaceOwnerId === null ? null : { id, ownerId: opts.workspaceOwnerId ?? chatId },
  );

  const service = new ChatManagementService(
    { getById: async () => chat, delete: chatDelete, listSideChats: async () => [] } as never,
    { getById: async () => session, delete: sessionDelete } as never,
    { deleteBySession: async () => {} } as never,
    {} as never,
    { deleteSessionEvents: async () => {}, emitGlobal: async () => {} } as never,
    opts.withWorkspaceManager === false
      ? {}
      : { workspaceManager: { getExecutionWorkspace, deleteWorkspace } as never },
  );

  return { service, deleteWorkspace, chatDelete, sessionDelete, getExecutionWorkspace };
}

describe('ChatManagementService.deleteChat (P0-d)', () => {
  it('tears the chat-owned workspace down so beforeDelete listeners actually fire', async () => {
    const f = build({ chat: { id: 'chat-1', workspaceId: 'ws-1' } });

    await f.service.deleteChat('chat-1');

    expect(f.deleteWorkspace).toHaveBeenCalledWith('ws-1');
    expect(f.chatDelete).toHaveBeenCalledWith('chat-1');
  });

  it('tears the workspace down BEFORE dropping the chat row', async () => {
    const order: string[] = [];
    const f = build({
      chat: { id: 'chat-1', workspaceId: 'ws-1' },
      deleteWorkspaceImpl: async () => {
        order.push('workspace');
      },
    });
    f.chatDelete.mockImplementation(async () => {
      order.push('chat');
    });

    await f.service.deleteChat('chat-1');

    // Reversing this would leave an unreachable workspace behind if teardown
    // failed: nothing else points at a workspace whose chat is gone.
    expect(order).toEqual(['workspace', 'chat']);
  });

  it('never deletes a SHARED workspace owned by another chat', async () => {
    const f = build({
      chat: { id: 'worker-chat', workspaceId: 'ws-orchestrator' },
      workspaceOwnerId: 'orchestrator-chat',
    });

    await f.service.deleteChat('worker-chat');

    expect(f.deleteWorkspace).not.toHaveBeenCalled();
    expect(f.chatDelete).toHaveBeenCalledWith('worker-chat');
  });

  it('deletes a chat that never had a workspace', async () => {
    const f = build({ chat: { id: 'chat-1' } });

    await expect(f.service.deleteChat('chat-1')).resolves.toBeUndefined();
    expect(f.getExecutionWorkspace).not.toHaveBeenCalled();
    expect(f.sessionDelete).toHaveBeenCalledWith('sess-1');
  });

  it('deletes a chat when no workspace manager is wired at all', async () => {
    const f = build({ chat: { id: 'chat-1', workspaceId: 'ws-1' }, withWorkspaceManager: false });

    await expect(f.service.deleteChat('chat-1')).resolves.toBeUndefined();
    expect(f.chatDelete).toHaveBeenCalled();
  });

  it('tolerates a workspace row that has already gone', async () => {
    const f = build({ chat: { id: 'chat-1', workspaceId: 'ws-1' }, workspaceOwnerId: null });

    await f.service.deleteChat('chat-1');

    expect(f.deleteWorkspace).not.toHaveBeenCalled();
    expect(f.chatDelete).toHaveBeenCalled();
  });

  it('still deletes the chat when workspace teardown fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = build({
      chat: { id: 'chat-1', workspaceId: 'ws-1' },
      deleteWorkspaceImpl: async () => {
        throw new Error('EBUSY');
      },
    });

    // A user must always be able to get rid of a chat; the workspace row
    // survives (deleteWorkspace keeps it) for the retention sweep to retry.
    await expect(f.service.deleteChat('chat-1')).resolves.toBeUndefined();
    expect(f.chatDelete).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ChatManagementService.deleteChat — provider sessions', () => {
  it('deletes the session the chat runs on and every session it left on another provider', async () => {
    const chat = { id: 'chat-1', name: 't', sessionId: 'sess-1', tags: [], status: 'active' } as unknown as Chat;
    const session = { id: 'sess-1', conversationId: 'conv-1', providerSessionId: 'claude-current' } as unknown as Session;
    let owner: string | undefined = 'claude-agent';
    const deleted: Array<[string, string | undefined]> = [];
    const harness = {
      abortConversation: async () => {},
      // The router forgets the conversation once it is deleted.
      deleteConversation: async () => void (owner = undefined),
      conversationHarness: () => owner ?? 'copilot',
      deleteProviderSession: async (id: string, type?: string) => void deleted.push([id, type]),
    };
    const messages = [
      { id: 'm1', role: 'assistant', metadata: { leftProviderSession: { harnessType: 'claude-agent', providerSessionId: 'claude-current' } } },
      { id: 'm2', role: 'assistant', metadata: { leftProviderSession: { harnessType: 'codex', providerSessionId: 'codex-thread' } } },
    ];
    const service = new ChatManagementService(
      { getById: async () => chat, delete: async () => {}, listSideChats: async () => [] } as never,
      { getById: async () => session, delete: async () => {} } as never,
      { deleteBySession: async () => {}, getByChatId: async () => messages } as never,
      harness as never,
      { deleteSessionEvents: async () => {}, emitGlobal: async () => {} } as never,
      {},
    );

    await service.deleteChat('chat-1');

    expect(deleted).toEqual([
      ['claude-current', 'claude-agent'],
      ['codex-thread', 'codex'],
    ]);
  });
});
