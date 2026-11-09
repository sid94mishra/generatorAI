// ────────────────────────────────────────────────────────────────
// CodexProvider — conversation compaction (docs/compaction)
// ────────────────────────────────────────────────────────────────
//
// `thread/compact/start` answers `{}` and Codex runs the compaction as a turn
// of its own, which no prompt of ours awaits; Codex also compacts on its own,
// inside a turn or with none of ours running. Every one of them must reach the
// chat once, as the shared compaction vocabulary, with the right trigger —
// before this every compaction read "(auto)", a manual one could not be asked
// for, and one outside a turn was dropped. Runs against the real-protocol
// stand-in, `fixtures/fakeCodexAppServer.mjs`.

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CodexProvider } from '../CodexProvider.js';
import type { AgentEvent } from '@generatorai/shared';
import { COMPACTION_INFO } from '@generatorai/shared';
import type { CreateConversationParams } from '@generatorai/core';
import type { CodexProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fakeCodexAppServer.mjs');

const live: CodexProvider[] = [];

async function started(env: Record<string, string> = {}, overrides: Partial<CodexProviderOptions> = {}): Promise<CodexProvider> {
  const p = new CodexProvider({
    binaryPath: process.execPath,
    args: [FIXTURE],
    rpcTimeoutMs: 3_000,
    shutdownGraceMs: 500,
    env,
    ...overrides,
  });
  live.push(p);
  await p.initialize();
  return p;
}

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => undefined)));
});

const CONV = (id: string, extra: Partial<CreateConversationParams> = {}): CreateConversationParams =>
  ({ conversationId: id, model: 'gpt-5-codex', ...extra }) as CreateConversationParams;

function collect(p: CodexProvider, id: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  p.onConversationEvent(id, (e) => events.push(e));
  return events;
}

const info = (e: AgentEvent): Record<string, unknown> | undefined =>
  e.kind === 'harness.session_info' ? (e.data as unknown as Record<string, unknown>) : undefined;

/** The compaction events and the turn's end, in order: `start:manual`, `compact_boundary:manual`, `idle`… */
function trail(events: readonly AgentEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.kind === 'harness.idle') return ['idle'];
    const d = info(e);
    if (!d || !(Object.values(COMPACTION_INFO) as unknown[]).includes(d['infoType'])) return [];
    return [`${String(d['infoType'])}:${String(d['trigger'])}`];
  });
}

type Internals = { rpc: (method: string, params?: unknown) => Promise<unknown> };

describe('CodexProvider — compaction', () => {
  it('declares native compaction without instructions', async () => {
    const p = await started();
    expect(p.capabilities()).toMatchObject({ conversationCompact: true, compactInstructions: false });
  });

  it('compacts on request: start, one manual boundary with the size before, the gauge, then idle', async () => {
    const p = await started();
    await p.createConversation(CONV('c'));
    // A turn first, so the conversation has a size to compact from.
    await p.sendPromptAndWait('c', 'AUTO_COMPACT');
    const events = collect(p, 'c');

    await p.compactConversation('c');

    expect(trail(events)).toEqual([`${COMPACTION_INFO.start}:manual`, `${COMPACTION_INFO.boundary}:manual`, 'idle']);
    const boundary = events.map(info).find((d) => d?.['infoType'] === COMPACTION_INFO.boundary)!;
    expect(boundary['preTokens']).toBe(182_000);
    expect(String(boundary['message'])).toBe('Conversation compacted · from 182K tokens');
    expect(events.some((e) => e.kind === 'harness.context_usage')).toBe(true);
    // The conversation takes the next prompt.
    await expect(p.sendPromptAndWait('c', 'hello')).resolves.toBeDefined();
  }, 20_000);

  it('a failed compaction rejects and says so, and the conversation stays usable', async () => {
    const p = await started({ FAKE_CODEX_COMPACT_FAIL: '1' });
    await p.createConversation(CONV('f'));
    const events = collect(p, 'f');

    await expect(p.compactConversation('f')).rejects.toThrow(/summary request failed/);

    expect(trail(events)).toEqual([`${COMPACTION_INFO.start}:manual`, `${COMPACTION_INFO.failed}:manual`, 'idle']);
    await expect(p.sendPromptAndWait('f', 'hello')).resolves.toBeDefined();
  }, 20_000);

  it('refuses while a turn is running', async () => {
    const p = await started();
    await p.createConversation(CONV('busy'));
    const turn = p.sendPromptAndWait('busy', 'HANG');
    await expect(p.compactConversation('busy')).rejects.toThrow(/in flight/);
    await p.abortConversation('busy');
    await turn;
  }, 20_000);

  it("Codex's own compaction inside a turn is one auto boundary (item and thread/compacted together)", async () => {
    const p = await started();
    await p.createConversation(CONV('a'));
    const events = collect(p, 'a');

    await p.sendPromptAndWait('a', 'AUTO_COMPACT');

    expect(trail(events)).toEqual([`${COMPACTION_INFO.start}:auto`, `${COMPACTION_INFO.boundary}:auto`, 'idle']);
  }, 20_000);

  it('a compaction with no turn of ours running still reaches the chat, once', async () => {
    const p = await started();
    await p.createConversation(CONV('idle'));
    const events = collect(p, 'idle');

    await (p as unknown as Internals).rpc('__test/compactIdle', { threadId: p.getProviderSessionId('idle') });
    await new Promise((r) => setTimeout(r, 200));

    expect(trail(events)).toEqual([`${COMPACTION_INFO.start}:auto`, `${COMPACTION_INFO.boundary}:auto`]);
  }, 20_000);
});

describe('CodexProvider — the auto-compact setting', () => {
  const threadConfig = async (p: CodexProvider, id: string): Promise<Record<string, unknown>> => {
    const echoed = JSON.parse((await p.sendPromptAndWait(id, 'ECHO_PARAMS')).content) as { thread: { config?: Record<string, unknown> } };
    return echoed.thread.config ?? {};
  };

  it('off: a token limit no context window reaches', async () => {
    const p = await started();
    await p.createConversation(CONV('off', { autoCompact: { enabled: false } }));
    expect((await threadConfig(p, 'off'))['model_auto_compact_token_limit']).toBe(Number.MAX_SAFE_INTEGER);
  }, 20_000);

  it('a percentage becomes tokens once the model window is known, and is a warning before', async () => {
    const p = await started();
    await p.createConversation(CONV('first', { autoCompact: { enabled: true, thresholdPct: 50 } }));
    expect(p.getConversationWarnings('first')).toEqual([
      expect.objectContaining({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: expect.objectContaining({ field: 'autoCompact.thresholdPct' }) }),
    ]);
    expect((await threadConfig(p, 'first'))['model_auto_compact_token_limit']).toBeUndefined();

    // A turn reports the window (200K in the stand-in); the next thread on that model gets the limit.
    await p.sendPromptAndWait('first', 'AUTO_COMPACT');
    await p.createConversation(CONV('second', { autoCompact: { enabled: true, thresholdPct: 50 } }));
    expect(p.getConversationWarnings('second')).toEqual([]);
    expect((await threadConfig(p, 'second'))['model_auto_compact_token_limit']).toBe(100_000);
  }, 20_000);

  it('the thread that could not take the percentage asks for a rebind, and the rebind reopens it with the limit', async () => {
    const p = await started();
    const params = CONV('early', { autoCompact: { enabled: true, thresholdPct: 50 } });
    await p.createConversation(params);
    const thread = p.getProviderSessionId('early');
    expect(p.hasLiveConversation('early')).toBe(true);
    await p.sendPromptAndWait('early', 'AUTO_COMPACT');
    // The window is known now: the chat service sees "not live" and resumes with the full config.
    expect(p.hasLiveConversation('early')).toBe(false);
    const events: AgentEvent[] = [];
    p.onConversationEvent('early', (e) => events.push(e));
    await p.resumeConversation('early', params);
    expect(p.hasLiveConversation('early')).toBe(true);
    expect(p.getProviderSessionId('early')).toBe(thread);
    expect((await threadConfig(p, 'early'))['model_auto_compact_token_limit']).toBe(100_000);
    // The listener registered before the reopen still hears the thread.
    expect(events.length).toBeGreaterThan(0);
  }, 20_000);

  it('a changed setting reopens a live thread with the new limit', async () => {
    const p = await started();
    await p.createConversation(CONV('chg', { autoCompact: { enabled: true } }));
    await p.resumeConversation('chg', CONV('chg', { autoCompact: { enabled: false } }));
    expect((await threadConfig(p, 'chg'))['model_auto_compact_token_limit']).toBe(Number.MAX_SAFE_INTEGER);
  }, 20_000);
});
