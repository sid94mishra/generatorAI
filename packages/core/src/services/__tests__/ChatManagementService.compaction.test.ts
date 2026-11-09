// ────────────────────────────────────────────────────────────────
// Conversation compaction (docs/compaction/README.md): the chat service's
// half — the Compact button's turn (native and synthetic), its guards, the
// one row a compaction leaves in the transcript, and the handoff seed that
// starts from the summary.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { COMPACTION_INFO, type AgentEvent, type Chat, type ChatMessage, type Session } from '@generatorai/shared';
import { ChatManagementService } from '../ChatManagementService.js';
import { compactionFromEvent } from '../chatCompaction.js';
import { buildConversationSeed } from '../chatTranscript.js';

const CONV = 'conv-1';

function msg(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `${role}-${content.slice(0, 12)}-${Math.random()}`, sessionId: 'sess-1', chatId: 'chat-1', role, content, timestamp: new Date(), ...extra } as ChatMessage;
}

const HISTORY: ChatMessage[] = [
  msg('user', 'Build the parser', { metadata: { turnId: 't1' } }),
  msg('assistant', 'Built src/parser.ts', { metadata: { turnId: 't1' } }),
];

interface Rig {
  service: ChatManagementService;
  events: AgentEvent[];
  rows: ChatMessage[];
  chat: Chat;
  harness: Record<string, ReturnType<typeof vi.fn>> & { emit: (e: AgentEvent) => void };
}

function rig(opts: { native: boolean; instructions?: boolean; history?: ChatMessage[]; compact?: (emit: (e: AgentEvent) => void) => Promise<void> }): Rig {
  const chat = { id: 'chat-1', name: 'c', sessionId: 'sess-1', tags: [], status: 'active', model: 'm-1' } as unknown as Chat;
  const session = { id: 'sess-1', conversationId: CONV } as unknown as Session;
  const rows: ChatMessage[] = [...(opts.history ?? HISTORY)];
  const events: AgentEvent[] = [];
  const listeners = new Set<(e: AgentEvent) => void>();
  const emit = (e: AgentEvent) => { for (const l of [...listeners]) l(e); };
  const harness = {
    emit,
    hasLiveConversation: vi.fn(() => true),
    capabilities: vi.fn(() => ({ conversationCompact: opts.native, compactInstructions: opts.instructions ?? false })),
    onConversationEvent: vi.fn((_id: string, h: (e: AgentEvent) => void) => { listeners.add(h); return () => listeners.delete(h); }),
    compactConversation: vi.fn(async () => {
      if (opts.compact) return opts.compact(emit);
      emit({ kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.start, message: 'Compacting…', trigger: 'manual' } } as AgentEvent);
      emit({ kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.boundary, message: 'done', trigger: 'manual', preTokens: 150_000, postTokens: 20_000 } } as AgentEvent);
      emit({ kind: 'harness.idle', data: {} } as AgentEvent);
    }),
    destroyConversation: vi.fn(async () => {}),
    createConversation: vi.fn(async () => 'x'),
    sendPromptAndWait: vi.fn(async () => ({ content: 'SUMMARY: parser built in src/parser.ts; next: tests' })),
    deleteConversation: vi.fn(async () => {}),
  } as unknown as Rig['harness'];
  const service = new ChatManagementService(
    {
      getById: async () => chat,
      update: vi.fn(async (_id: string, patch: Partial<Chat>) => Object.assign(chat, patch)),
      touchActivity: async () => {},
      recordTurnEnd: async () => {},
    } as never,
    { getById: async () => session, update: async () => {} } as never,
    {
      getByChatId: async () => rows,
      create: async (m: ChatMessage) => { rows.push(m); return m; },
    } as never,
    harness as never,
    { emit: async (_s: string, e: AgentEvent) => { events.push(e); } } as never,
    {},
  );
  // The conversation is live and bound to what the chat asks for: no resume.
  const s = service as unknown as { conversationBindings: Map<string, string>; conversationBindingKey(c: Chat): string };
  s.conversationBindings.set(CONV, s.conversationBindingKey(chat));
  return { service, events, rows, chat, harness };
}

const info = (events: AgentEvent[]) =>
  events.filter((e) => e.kind === 'harness.session_info').map((e) => (e.data as { infoType: string }).infoType);

describe('compactChat — native', () => {
  it('runs the provider compaction as a turn and records one compaction row', async () => {
    const r = rig({ native: true, instructions: true });
    const { done } = await r.service.compactChat('chat-1', { instructions: 'keep the API decisions' });
    expect(await done).toEqual({ mode: 'native' });
    expect(r.harness.compactConversation).toHaveBeenCalledWith(CONV, { instructions: 'keep the API decisions' });
    expect(r.events[0]).toMatchObject({ kind: 'harness.turn_start', data: { kind: 'compaction' } });
    expect(info(r.events)).toEqual([COMPACTION_INFO.start, COMPACTION_INFO.boundary]);
    expect(r.events.at(-1)?.kind).toBe('harness.idle');
    await vi.waitFor(() => expect(r.rows.filter((m) => m.metadata?.compaction)).toHaveLength(1));
    const row = r.rows.find((m) => m.metadata?.compaction)!;
    expect(row.role).toBe('system');
    expect(row.metadata?.compaction).toMatchObject({ trigger: 'manual', preTokens: 150_000, postTokens: 20_000, model: 'm-1' });
    expect(row.content).toBe('Conversation compacted · 150K → 20K tokens');
    expect(r.service.isTurnActive('chat-1')).toBe(false);
  });

  it('drops instructions a provider does not take', async () => {
    const r = rig({ native: true, instructions: false });
    await (await r.service.compactChat('chat-1', { instructions: 'focus' })).done;
    expect(r.harness.compactConversation).toHaveBeenCalledWith(CONV, {});
  });

  it('reports a failed compaction and leaves the chat free', async () => {
    const r = rig({
      native: true,
      compact: async (emit) => {
        emit({ kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.failed, message: 'x', trigger: 'manual', error: 'Not enough messages to compact.' } } as AgentEvent);
        emit({ kind: 'harness.idle', data: {} } as AgentEvent);
        throw new Error('Not enough messages to compact.');
      },
    });
    await (await r.service.compactChat('chat-1')).done;
    expect(r.events.some((e) => e.kind === 'harness.error' && /Not enough messages/.test(String((e.data as { message?: string }).message)))).toBe(true);
    expect(r.rows.some((m) => m.metadata?.compaction)).toBe(false);
    expect(r.service.isTurnActive('chat-1')).toBe(false);
  });

  it('records a compaction the provider did on its own between turns, and forwards it', async () => {
    const r = rig({ native: true });
    await (await r.service.compactChat('chat-1')).done;
    r.events.length = 0;
    r.harness.emit({ kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.boundary, message: 'auto', trigger: 'auto', preTokens: 190_000 } } as AgentEvent);
    await vi.waitFor(() => expect(r.rows.filter((m) => m.metadata?.compaction?.trigger === 'auto')).toHaveLength(1));
    expect(info(r.events)).toEqual([COMPACTION_INFO.boundary]);
  });
});

describe('compactChat — synthetic (provider without a compaction of its own)', () => {
  it('summarises the chat, ends the provider session and seeds the next prompt from the summary', async () => {
    const r = rig({ native: false });
    expect(await (await r.service.compactChat('chat-1', { instructions: 'the parser' })).done).toEqual({ mode: 'synthetic' });
    expect(r.harness.sendPromptAndWait.mock.calls[0]![1]).toContain('focus on: the parser');
    expect(r.harness.destroyConversation).toHaveBeenCalledWith(CONV);
    const row = r.rows.find((m) => m.metadata?.compaction)!;
    expect(row.metadata?.compaction).toMatchObject({ trigger: 'manual', synthetic: true, summary: expect.stringContaining('SUMMARY') });
    expect(r.chat.conversationSeed).toContain('SUMMARY: parser built');
    expect(r.chat.conversationSeed).not.toContain('Build the parser');
    expect(info(r.events)).toEqual([COMPACTION_INFO.start, COMPACTION_INFO.boundary]);
  });

  it('fails without claiming a compaction when no summary could be written', async () => {
    const r = rig({ native: false });
    r.harness.sendPromptAndWait.mockResolvedValueOnce({ content: '' });
    await (await r.service.compactChat('chat-1')).done;
    expect(info(r.events)).toEqual([COMPACTION_INFO.start, COMPACTION_INFO.failed]);
    expect(r.rows.some((m) => m.metadata?.compaction)).toBe(false);
    expect(r.harness.destroyConversation).not.toHaveBeenCalled();
  });
});

describe('compactChat — guards', () => {
  it('refuses while a turn runs', async () => {
    const r = rig({ native: true });
    (r.service as unknown as { startingTurns: Set<string> }).startingTurns.add('chat-1');
    await expect(r.service.compactChat('chat-1')).rejects.toMatchObject({ code: 'CHAT_BUSY' });
  });

  it('refuses when nothing was said since the last compaction', async () => {
    const r = rig({ native: true, history: [...HISTORY, msg('system', 'c', { metadata: { compaction: { trigger: 'manual' } } })] });
    await expect(r.service.compactChat('chat-1')).rejects.toMatchObject({ code: 'NOTHING_TO_COMPACT' });
  });
});

describe('compactionFromEvent', () => {
  it('reads a finished compaction, and ignores a sub-agent\'s and other notices', () => {
    const boundary = { kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.boundary, message: '', trigger: 'manual', preTokens: 5, summary: 's' } } as AgentEvent;
    expect(compactionFromEvent(boundary)).toEqual({ trigger: 'manual', preTokens: 5, summary: 's' });
    expect(compactionFromEvent({ ...boundary, data: { ...(boundary.data as object), agentId: 'sub-1' } } as AgentEvent)).toBeUndefined();
    expect(compactionFromEvent({ kind: 'harness.session_info', data: { infoType: COMPACTION_INFO.start, message: '' } } as AgentEvent)).toBeUndefined();
  });
});

describe('buildConversationSeed after a compaction', () => {
  const compacted = msg('system', 'Conversation compacted', { metadata: { compaction: { trigger: 'manual', summary: 'THE SUMMARY' } } });
  const later = [msg('user', 'Now add tests', { metadata: { turnId: 't2' } }), msg('assistant', 'Added tests', { metadata: { turnId: 't2' } })];

  it('starts from the summary and the turns since, not the history it replaced', () => {
    const seed = buildConversationSeed([...HISTORY, compacted, ...later]);
    expect(seed).toContain('THE SUMMARY');
    expect(seed).toContain('Now add tests');
    expect(seed).not.toContain('Build the parser');
  });

  it('is the summary alone right after a compaction', () => {
    const seed = buildConversationSeed([...HISTORY, compacted]);
    expect(seed).toContain('THE SUMMARY');
    expect(seed).toContain('[End of restored history]');
  });

  it('keeps the whole history when the compaction kept no summary', () => {
    const noSummary = msg('system', 'c', { metadata: { compaction: { trigger: 'auto' } } });
    expect(buildConversationSeed([...HISTORY, noSummary, ...later])).toContain('Build the parser');
  });
});
