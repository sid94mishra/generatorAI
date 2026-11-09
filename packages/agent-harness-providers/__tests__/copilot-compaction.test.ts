import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';
import { COMPACTION_INFO } from '@generatorai/shared';
import { CopilotProvider, infiniteSessionsFor } from '../src/providers/copilot/CopilotProvider.js';
import { mapSdkEventToAgentEvents } from '../src/providers/copilot/event-mapper.js';

// docs/compaction — Copilot: the SDK's compaction events map onto the shared vocabulary, `compactConversation`
// drives `history.compact`, and the app's auto-compaction setting becomes `infiniteSessions`.

const ev = (type: string, data: unknown, extra: Record<string, unknown> = {}) =>
  ({ type, data, ...extra }) as unknown as Parameters<typeof mapSdkEventToAgentEvents>[0];

const info = (events: AgentEvent[], infoType: string) =>
  events.filter((e) => e.kind === 'harness.session_info' && (e.data as { infoType?: string }).infoType === infoType);

describe('Copilot compaction events', () => {
  it('maps start, a finished compaction (notice + gauge) and a failure', () => {
    const start = mapSdkEventToAgentEvents(ev('session.compaction_start', { trigger: 'threshold', currentTokens: 160_000 }));
    expect(info(start, COMPACTION_INFO.start)[0]?.data).toMatchObject({ trigger: 'auto', preTokens: 160_000 });

    const done = mapSdkEventToAgentEvents(ev('session.compaction_complete', {
      success: true,
      trigger: 'manual',
      preCompactionTokens: 160_000,
      postCompactionTokens: 20_000,
      tokenLimit: 200_000,
      summaryContent: 'We fixed the parser.',
    }));
    expect(info(done, COMPACTION_INFO.boundary)).toHaveLength(1);
    expect(info(done, COMPACTION_INFO.boundary)[0]?.data).toMatchObject({
      trigger: 'manual',
      preTokens: 160_000,
      postTokens: 20_000,
      summary: 'We fixed the parser.',
      provider: 'copilot',
      message: 'Conversation compacted · 160K → 20K tokens',
    });
    expect(done.filter((e) => e.kind === 'harness.context_usage')).toHaveLength(1);

    const failed = mapSdkEventToAgentEvents(ev('session.compaction_complete', { success: false, error: 'model refused' }));
    expect(info(failed, COMPACTION_INFO.failed)[0]?.data).toMatchObject({ error: 'model refused' });
    expect(failed.some((e) => e.kind === 'harness.context_usage')).toBe(false);
  });
});

/** A session whose `on` listeners can be fed SDK events, with `history.compact` stubbed. */
function fakeSession(compact: (session: { emit: (e: unknown) => void }) => Promise<unknown>) {
  const listeners = new Set<(e: unknown) => void>();
  const session = {
    emit: (e: unknown) => [...listeners].forEach((l) => l(e)),
    on: vi.fn((l: (e: unknown) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    rpc: { history: { compact: vi.fn() } },
  };
  session.rpc.history.compact.mockImplementation(() => compact(session));
  return session;
}

function providerWith(session: unknown): { provider: CopilotProvider; events: AgentEvent[] } {
  const provider = new CopilotProvider({ verbose: false });
  (provider as unknown as { conversations: Map<string, unknown> }).conversations.set('c1', session);
  const events: AgentEvent[] = [];
  provider.onConversationEvent('c1', (e) => events.push(e));
  return { provider, events };
}

describe('CopilotProvider.compactConversation', () => {
  it('passes the instructions and reports each notice once when the SDK announces it itself', async () => {
    const session = fakeSession(async (s) => {
      s.emit({ type: 'session.compaction_start', data: { trigger: 'manual' } });
      s.emit({ type: 'session.compaction_complete', data: { success: true, trigger: 'manual', preCompactionTokens: 90_000, postCompactionTokens: 9_000, tokenLimit: 128_000 } });
      return { success: true, tokensRemoved: 81_000, messagesRemoved: 40, contextWindow: { currentTokens: 9_000, tokenLimit: 128_000, messagesLength: 3 } };
    });
    const { provider, events } = providerWith(session);

    await provider.compactConversation('c1', { instructions: '  keep the API decisions ' });

    expect(session.rpc.history.compact).toHaveBeenCalledWith({ trigger: 'manual', customInstructions: 'keep the API decisions' });
    expect(info(events, COMPACTION_INFO.start)).toHaveLength(1);
    expect(info(events, COMPACTION_INFO.boundary)).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'harness.context_usage')).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe('harness.idle');
    expect(provider.capabilities()).toMatchObject({ conversationCompact: true, compactInstructions: true });
  });

  it('stands in for an announcement that did not come, from the RPC result', async () => {
    const session = fakeSession(async () => ({
      success: true,
      tokensRemoved: 50_000,
      messagesRemoved: 12,
      summaryContent: 'Summary.',
      contextWindow: { currentTokens: 10_000, tokenLimit: 200_000, messagesLength: 2 },
    }));
    const { provider, events } = providerWith(session);

    await provider.compactConversation('c1');

    expect(session.rpc.history.compact).toHaveBeenCalledWith({ trigger: 'manual' });
    expect(info(events, COMPACTION_INFO.start)).toHaveLength(1);
    expect(info(events, COMPACTION_INFO.boundary)[0]?.data).toMatchObject({ trigger: 'manual', preTokens: 60_000, postTokens: 10_000, summary: 'Summary.' });
    expect(events.find((e) => e.kind === 'harness.context_usage')?.data).toMatchObject({ currentTokens: 10_000, promptTokenLimit: 200_000 });
    expect(events.filter((e) => e.kind === 'harness.idle')).toHaveLength(1);
  });

  it('rejects and reports a failure once, without ending the turn itself', async () => {
    const session = fakeSession(async () => ({ success: false, tokensRemoved: 0, messagesRemoved: 0 }));
    const { provider, events } = providerWith(session);

    await expect(provider.compactConversation('c1')).rejects.toThrow(/Compaction failed/);
    expect(info(events, COMPACTION_INFO.failed)).toHaveLength(1);
    expect(info(events, COMPACTION_INFO.boundary)).toHaveLength(0);
    expect(events.some((e) => e.kind === 'harness.idle')).toBe(false);

    const thrown = fakeSession(async () => { throw new Error('rpc down'); });
    const second = providerWith(thrown);
    await expect(second.provider.compactConversation('c1')).rejects.toThrow('rpc down');
    expect(info(second.events, COMPACTION_INFO.failed)[0]?.data).toMatchObject({ error: 'rpc down' });
  });
});

describe('infiniteSessionsFor (the app auto-compaction setting)', () => {
  it('maps off, on, and a threshold', () => {
    expect(infiniteSessionsFor(undefined)).toBeUndefined();
    expect(infiniteSessionsFor({ enabled: false })).toEqual({ enabled: false });
    expect(infiniteSessionsFor({ enabled: true })).toEqual({ enabled: true });
    expect(infiniteSessionsFor({ enabled: true, thresholdPct: 60 })).toEqual({
      enabled: true,
      backgroundCompactionThreshold: 0.6,
      bufferExhaustionThreshold: 0.95,
    });
    // The blocking threshold never sits below the background one.
    expect(infiniteSessionsFor({ enabled: true, thresholdPct: 98 })).toMatchObject({ backgroundCompactionThreshold: 0.98, bufferExhaustionThreshold: 0.98 });
  });
});
