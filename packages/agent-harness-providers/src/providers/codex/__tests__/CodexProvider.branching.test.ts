// ────────────────────────────────────────────────────────────────
// CodexProvider — conversation branching over the fake app-server.
//
// `thread/fork { lastTurnId }` branches a thread through a turn; `thread/revert
// { beforeTurnId }` drops a turn and everything after it in place, with the
// deprecated `thread/rollback { numTurns }` as the fallback when revert is not
// served. The fixture records every call so the anchors sent are asserted.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CodexProvider } from '../CodexProvider.js';
import type { CreateConversationParams } from '@generatorai/core';
import type { CodexProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fakeCodexAppServer.mjs');

const live: CodexProvider[] = [];

async function started(overrides: Partial<CodexProviderOptions> = {}): Promise<CodexProvider> {
  const p = new CodexProvider({
    binaryPath: process.execPath,
    args: [FIXTURE],
    rpcTimeoutMs: 2_000,
    shutdownGraceMs: 500,
    ...overrides,
  });
  live.push(p);
  await p.initialize();
  return p;
}

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => undefined)));
});

const CONV = (id: string): CreateConversationParams => ({ conversationId: id, model: 'gpt-5-codex' });

type Internals = { rpc: (method: string, params?: unknown) => Promise<unknown> };
async function branchingCalls(p: CodexProvider) {
  return (p as unknown as Internals).rpc('__test/branching') as Promise<{
    forkCalls: Array<{ threadId: string; params: Record<string, unknown> }>;
    revertCalls: Array<Record<string, unknown>>;
    rollbackCalls: Array<Record<string, unknown>>;
  }>;
}

describe('CodexProvider — fork', () => {
  it('declares native fork and rewind', async () => {
    const p = await started();
    expect(p.capabilities().conversationFork).toBe(true);
    expect(p.capabilities().conversationRewind).toBe(true);
  });

  it('thread/fork through the anchor turn and registers the new conversation on the forked thread', async () => {
    const p = await started();
    await p.createConversation(CONV('src'));
    const srcThread = p.getProviderSessionId('src');
    expect(srcThread).toBeTruthy();

    const result = await p.forkConversation('src', {
      newConversationId: 'branch',
      throughAnchor: { kind: 'turn', id: 'turn_7' },
      params: CONV('branch'),
    });

    const calls = await branchingCalls(p);
    expect(calls.forkCalls).toHaveLength(1);
    expect(calls.forkCalls[0]!.params).toMatchObject({ threadId: srcThread, lastTurnId: 'turn_7', excludeTurns: true });
    expect(result.providerSessionId).toBe(calls.forkCalls[0]!.threadId);
    expect(p.getProviderSessionId('branch')).toBe(result.providerSessionId);
    // The source keeps its own thread.
    expect(p.getProviderSessionId('src')).toBe(srcThread);
    // The branch can take a turn.
    await expect(p.sendPromptAndWait('branch', 'say hello')).resolves.toMatchObject({ content: 'hello ' });
  }, 15_000);

  it('forks from a persisted thread id when the source is not in memory', async () => {
    const p = await started();
    const result = await p.forkConversation('gone', {
      newConversationId: 'branch2',
      sourceProviderSessionId: 'thr_persisted',
      params: CONV('branch2'),
    });
    const calls = await branchingCalls(p);
    expect(calls.forkCalls[0]!.params).toMatchObject({ threadId: 'thr_persisted' });
    expect(calls.forkCalls[0]!.params['lastTurnId']).toBeUndefined();
    expect(result.providerSessionId).toBeTruthy();
  });

  it('rejects a message-kind anchor — Codex branches by turn', async () => {
    const p = await started();
    await p.createConversation(CONV('src'));
    await expect(
      p.forkConversation('src', { newConversationId: 'b', throughAnchor: { kind: 'message', id: 'x' }, params: CONV('b') }),
    ).rejects.toThrow(/turn id/);
  });
});

describe('CodexProvider — rewind', () => {
  it('thread/revert before the first dropped turn, in place', async () => {
    const p = await started();
    await p.createConversation(CONV('c'));
    const thread = p.getProviderSessionId('c');
    const r = await p.rewindConversation('c', {
      keepThrough: { kind: 'turn', id: 'turn_1' },
      dropFrom: { kind: 'turn', id: 'turn_2' },
      droppedTurns: 2,
      params: CONV('c'),
    });
    const calls = await branchingCalls(p);
    expect(calls.revertCalls).toEqual([{ threadId: thread, beforeTurnId: 'turn_2' }]);
    expect(calls.rollbackCalls).toHaveLength(0);
    expect(r.providerSessionId).toBe(thread);
    expect(p.getProviderSessionId('c')).toBe(thread);
  });

  it('falls back to thread/rollback by count when revert is not served', async () => {
    const p = await started({ env: { FAKE_CODEX_REVERT_UNSUPPORTED: '1' } });
    await p.createConversation(CONV('c'));
    const thread = p.getProviderSessionId('c');
    await p.rewindConversation('c', {
      keepThrough: { kind: 'turn', id: 'turn_1' },
      dropFrom: { kind: 'turn', id: 'turn_2' },
      droppedTurns: 3,
      params: CONV('c'),
    });
    const calls = await branchingCalls(p);
    expect(calls.rollbackCalls).toEqual([{ threadId: thread, numTurns: 3 }]);
  });

  it('uses rollback by count when the dropped turn has no anchor', async () => {
    const p = await started();
    await p.createConversation(CONV('c'));
    await p.rewindConversation('c', { keepThrough: { kind: 'turn', id: 'turn_1' }, droppedTurns: 1, params: CONV('c') });
    const calls = await branchingCalls(p);
    expect(calls.revertCalls).toHaveLength(0);
    expect(calls.rollbackCalls).toEqual([{ threadId: p.getProviderSessionId('c'), numTurns: 1 }]);
  });

  it('rewinding to before the first turn starts a fresh thread', async () => {
    const p = await started();
    await p.createConversation(CONV('c'));
    const before = p.getProviderSessionId('c');
    const r = await p.rewindConversation('c', { keepThrough: null, droppedTurns: 2, params: CONV('c') });
    expect(r.providerSessionId).toBeTruthy();
    expect(r.providerSessionId).not.toBe(before);
    expect(p.getProviderSessionId('c')).toBe(r.providerSessionId);
    const calls = await branchingCalls(p);
    expect(calls.revertCalls).toHaveLength(0);
    expect(calls.rollbackCalls).toHaveLength(0);
  });

  it('loads a thread it does not hold from the persisted id before reverting', async () => {
    const p = await started();
    await p.rewindConversation('cold', {
      providerSessionId: 'thr_persisted',
      keepThrough: { kind: 'turn', id: 'turn_1' },
      dropFrom: { kind: 'turn', id: 'turn_2' },
      droppedTurns: 1,
      params: CONV('cold'),
    });
    expect(p.getProviderSessionId('cold')).toBe('thr_persisted');
    const calls = await branchingCalls(p);
    expect(calls.revertCalls).toEqual([{ threadId: 'thr_persisted', beforeTurnId: 'turn_2' }]);
  });
});

describe('CodexProvider — in-app sign-in', () => {
  it('declares accountLogin and answers the ChatGPT browser flow with the URL to open', async () => {
    const p = await started();
    expect(p.capabilities().accountLogin).toBe(true);
    const r = await p.startLogin();
    expect(r.authUrl).toBe('https://auth.openai.com/fake-login');
    expect(r.loginId).toBe('login_1');
    expect(r.completed).toBeUndefined();
    await expect(p.logout()).resolves.toBeUndefined();
  });
});
