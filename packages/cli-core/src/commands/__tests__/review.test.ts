import { describe, expect, it, vi } from 'vitest';
import { reviewCommands } from '../platform.js';
import type { CliContext } from '../../context/CliContext.js';

const WORKSPACE_SUMMARY = { id: 'ws_1', ownerType: 'chat', ownerId: 'chat_abc', status: 'active', createdAt: 0 };

function fakeContext(opts: {
  ownerType?: string;
  ownerId?: string;
  createThread?: ReturnType<typeof vi.fn>;
}): CliContext {
  const createThread = opts.createThread ?? vi.fn(async (id: string, body: unknown) => ({ id: 'thread_1', ...(body as object) }));
  return {
    api: {
      workspaces: {
        list: vi.fn(async () => [WORKSPACE_SUMMARY]),
        get: vi.fn(async () => ({
          id: 'ws_1',
          ownerType: opts.ownerType ?? 'chat',
          ownerId: opts.ownerId ?? 'chat_abc',
          status: 'active',
          rootPath: '/tmp',
          createdAt: 0,
        })),
      },
      review: { createThread },
    },
  } as unknown as CliContext;
}

const create = reviewCommands().find((c) => c.id === 'review.create')!;

describe('review create', () => {
  it('derives scope/scopeId from a chat-owned workspace and sends the real field names', async () => {
    const createThread = vi.fn(async () => ({ id: 'thread_1' }));
    const ctx = fakeContext({ ownerType: 'chat', ownerId: 'chat_abc', createThread });

    await create.handler(ctx, {
      args: { workspace: 'ws_1', path: 'a.ts', body: 'fix this' },
      flags: { startLine: 10, side: 'additions' },
    } as never);

    expect(createThread).toHaveBeenCalledWith('ws_1', {
      path: 'a.ts',
      body: 'fix this',
      anchorText: '',
      scopeId: 'chat_abc',
      baseCheckpointId: '',
      headCheckpointId: '',
      side: 'additions',
      startLine: 10,
      endLine: 10, // defaults to startLine
      scope: 'chat',
    });
  });

  it('refuses to guess a scope for a non-chat-owned workspace', async () => {
    const ctx = fakeContext({ ownerType: 'workflow_run', ownerId: 'run_1' });

    await expect(
      create.handler(ctx, {
        args: { workspace: 'ws_1', path: 'a.ts', body: 'fix this' },
        flags: { startLine: 1, side: 'additions' },
      } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('skips the workspace lookup entirely when both --scope and --scopeId are given', async () => {
    const getSpy = vi.fn();
    const createThread = vi.fn(async () => ({ id: 'thread_1' }));
    const ctx = {
      api: {
        workspaces: { list: vi.fn(async () => [WORKSPACE_SUMMARY]), get: getSpy },
        review: { createThread },
      },
    } as unknown as CliContext;

    await create.handler(ctx, {
      args: { workspace: 'ws_1', path: 'a.ts', body: 'fix this' },
      flags: { startLine: 5, endLine: 8, side: 'deletions', scope: 'run', scopeId: 'run_9' },
    } as never);

    expect(getSpy).not.toHaveBeenCalled();
    expect(createThread).toHaveBeenCalledWith(
      'ws_1',
      expect.objectContaining({ scope: 'run', scopeId: 'run_9', startLine: 5, endLine: 8, side: 'deletions' }),
    );
  });
});
