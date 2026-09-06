// ────────────────────────────────────────────────────────────────
// Memory-bound defaults. Each live persistent session is a ~230 MB CLI
// process, so these numbers ARE the memory budget of a default deployment:
//
//   - live sessions were capped at 32 (7.4 GB of processes) against a
//     4-turn execution permit; now 8.
//   - idle eviction was 30 minutes; now 10.
//
// Pinned here so a later "just raise it" shows up as a failing test with the
// measurement in this comment next to it. Overrides still work through the
// documented environment variables.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn(async () => { throw new Error('not used'); }),
  deleteSession: vi.fn(),
}));

type Internals = { maxLiveConversations: number; sessionIdleMs: number };

const ENV_KEYS = ['GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS', 'GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function build(): Internals {
  const provider = new ClaudeAgentProvider({
    cliPath: '/nonexistent/claude',
    defaultCwd: '/tmp',
    persistentSessions: true,
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  return provider as unknown as Internals;
}

describe('Claude provider memory defaults', () => {
  it('caps live sessions at 8 (twice the default 4-turn permit), not 32', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(build().maxLiveConversations).toBe(8);
  });

  it('evicts an idle conversation after 10 minutes, not 30', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(build().sessionIdleMs).toBe(10 * 60_000);
  });

  it('honours the environment overrides', () => {
    process.env['GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS'] = '3';
    process.env['GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES'] = '2';
    const i = build();
    expect(i.maxLiveConversations).toBe(3);
    expect(i.sessionIdleMs).toBe(2 * 60_000);
  });

  it('falls back to the defaults on a nonsensical override instead of disabling the bound', () => {
    process.env['GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS'] = 'lots';
    process.env['GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES'] = 'soon';
    const i = build();
    expect(i.maxLiveConversations).toBe(8);
    expect(i.sessionIdleMs).toBe(10 * 60_000);
  });
});
