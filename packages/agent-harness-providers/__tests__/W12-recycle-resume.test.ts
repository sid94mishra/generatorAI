// ────────────────────────────────────────────────────────────────
// W12-recycle-resume.test.ts
//
// BLOCKER B3, adapter half.
//
// A runtime recycle stands up a BRAND-NEW adapter instance and hands it the
// same `CreateConversationParams`. Those params carried no resume field, and
// `sdkSessionId` — the value that becomes `options.resume`, i.e. the entire
// message history — was only ever carried over from the adapter's OWN previous
// config. A new instance has none, so the recycled conversation started the
// model from zero, silently, mid-chat.
//
// These tests drive the shipped `createConversation` and then read the object
// the SDK is actually handed (`buildQueryOptions`), so they fail if the resume
// field stops being honoured OR stops reaching the SDK.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import type { CreateConversationParams } from '@generatorai/core';

type StoredConfig = { conversationId: string } & Record<string, unknown>;

function makeProvider(): ClaudeAgentProvider {
  // The constructor spawns nothing — only `initialize()` / `query()` do.
  return new ClaudeAgentProvider({
    cliBinaryPath: '/nonexistent/claude',
    defaultModel: 'sonnet',
    defaultCwd: '/tmp',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
}

/** The options object the SDK would be handed for this conversation's next turn. */
function resumeOf(provider: ClaudeAgentProvider, conversationId: string): unknown {
  const config = (provider as unknown as { conversations: Map<string, StoredConfig> }).conversations.get(
    conversationId,
  )!;
  const options = (provider as unknown as {
    buildQueryOptions(c: StoredConfig): { resume?: unknown };
  }).buildQueryOptions(config);
  return options.resume;
}

const base = (extra: Partial<CreateConversationParams> = {}): CreateConversationParams =>
  ({ conversationId: 'c1', model: 'sonnet', ...extra }) as CreateConversationParams;

describe('W12/B3 — provider-side session id survives a runtime recycle', () => {
  it('a fresh adapter resumes from resumeProviderSessionId', async () => {
    const replacement = makeProvider();
    await replacement.createConversation(base({ resumeProviderSessionId: 'sdk-session-abc' }));

    expect(replacement.getProviderSessionId('c1')).toBe('sdk-session-abc');
    // The proof that matters: the SDK is told to resume, not to start over.
    expect(resumeOf(replacement, 'c1')).toBe('sdk-session-abc');
  });

  it('without it, a fresh adapter starts the conversation cold', async () => {
    // Pins the defect itself: this is what a recycle used to do every time.
    const replacement = makeProvider();
    await replacement.createConversation(base());
    expect(resumeOf(replacement, 'c1')).toBeUndefined();
  });

  it('an adapter that already holds the conversation keeps its own session id', async () => {
    // A live adapter's own session always wins — a caller-supplied token must
    // never clobber the session the SDK is mid-way through.
    const provider = makeProvider();
    await provider.createConversation(base());
    (provider as unknown as { conversations: Map<string, StoredConfig> }).conversations.get('c1')!['sdkSessionId'] =
      'sdk-live';

    await provider.createConversation(base({ resumeProviderSessionId: 'sdk-stale' }));
    expect(provider.getProviderSessionId('c1')).toBe('sdk-live');
  });

  it('getProviderSessionId is undefined for a conversation this adapter never had', () => {
    // The honest answer the host needs in order to say "no history carried
    // over" instead of assuming continuity.
    expect(makeProvider().getProviderSessionId('nope')).toBeUndefined();
  });
});
