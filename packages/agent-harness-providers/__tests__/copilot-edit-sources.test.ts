// ────────────────────────────────────────────────────────────────
// Copilot follows "Edit sources" on a live chat (D-137)
//
// `updateChatSources` drops the conversation binding, so the next turn calls
// `resumeConversation(id, cfg)` with the new roots. Copilot used to return
// early for a live session, so the agent went on working in the folder the
// chat no longer pointed at. Now a changed cwd moves the conversation to the
// CLI client for the new cwd and resumes the SDK session there by id (history
// kept); an unchanged exposure keeps the live session untouched.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateConversationParams } from '@generatorai/core';

interface FakeSession {
  id: string;
  cwd: string | undefined;
  systemMessage: unknown;
  disconnect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const sdk = vi.hoisted(() => ({
  clients: [] as Array<{
    workingDirectory: string | undefined;
    created: Array<{ sessionId: string; workingDirectory?: string }>;
    resumed: Array<{ id: string; workingDirectory?: string; systemMessage?: unknown }>;
  }>,
  sessions: [] as unknown[],
  failResume: false,
}));

vi.mock('@github/copilot-sdk', () => {
  function makeSession(id: string, cwd: string | undefined, systemMessage: unknown): FakeSession {
    const s: FakeSession = {
      id,
      cwd,
      systemMessage,
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue('m1'),
      setModel: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnValue(() => {}),
    };
    sdk.sessions.push(s);
    return s;
  }
  class CopilotClient {
    readonly record;
    constructor(opts: { workingDirectory?: string }) {
      this.record = { workingDirectory: opts.workingDirectory, created: [], resumed: [] } as (typeof sdk.clients)[number];
      sdk.clients.push(this.record);
    }
    async start() {}
    async stop() {}
    async forceStop() {}
    async ping() {}
    async createSession(cfg: { sessionId: string; workingDirectory?: string; systemMessage?: unknown }) {
      this.record.created.push(cfg);
      return makeSession(cfg.sessionId, cfg.workingDirectory, cfg.systemMessage);
    }
    async resumeSession(id: string, cfg: { workingDirectory?: string; systemMessage?: unknown }) {
      if (sdk.failResume) throw new Error('Session not found');
      this.record.resumed.push({ id, ...cfg });
      return makeSession(id, cfg.workingDirectory, cfg.systemMessage);
    }
  }
  return {
    CopilotClient,
    approveAll: async () => ({ kind: 'approve-once' }),
    defineTool: (name: string, def: object) => ({ name, ...def }),
    RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }), forUri: () => ({ kind: 'uri' }) },
  };
});

const { CopilotProvider } = await import('../src/providers/copilot/CopilotProvider.js');
const { WorkspacedCopilotPool } = await import('../src/providers/copilot/WorkspacedCopilotPool.js');

const SERVER_CWD = '/srv/generatorai';
const OLD = '/work/old';
const NEW = '/work/new';
const EXTRA = '/work/extra';

function params(p: Partial<CreateConversationParams>): CreateConversationParams {
  return { conversationId: 'c1', ...p } as CreateConversationParams;
}

function liveSession(provider: object, id = 'c1'): FakeSession | undefined {
  return (provider as { conversations: Map<string, FakeSession> }).conversations.get(id);
}

const toStop: Array<{ forceStop(): Promise<void> }> = [];
afterEach(async () => {
  for (const p of toStop.splice(0)) await p.forceStop();
  sdk.clients.length = 0;
  sdk.sessions.length = 0;
  sdk.failResume = false;
});

describe('WorkspacedCopilotPool — Edit sources on a live chat (D-137)', () => {
  function makePool() {
    const pool = new WorkspacedCopilotPool({ defaultCwd: SERVER_CWD, verbose: false });
    toStop.push(pool);
    return pool;
  }

  it('moves the conversation to the CLI for the new cwd and resumes the session by id', async () => {
    const pool = makePool();
    await pool.createConversation(params({ workingDirectory: OLD, systemPromptAppend: '[Workspace] old' }));
    const oldClient = sdk.clients.find((c) => c.workingDirectory === OLD)!;
    expect(oldClient.created.map((c) => c.workingDirectory)).toEqual([OLD]);
    const before = sdk.sessions[0] as FakeSession;

    await pool.resumeConversation(
      'c1',
      params({ workingDirectory: NEW, additionalDirectories: [EXTRA], systemPromptAppend: '[Workspace] new' }),
    );

    expect(before.disconnect).toHaveBeenCalledTimes(1);
    const newClient = sdk.clients.find((c) => c.workingDirectory === NEW)!;
    expect(newClient.resumed).toHaveLength(1);
    expect(newClient.resumed[0]).toMatchObject({
      id: 'c1',
      workingDirectory: NEW,
      systemMessage: { mode: 'append', content: '[Workspace] new' },
    });
    expect(newClient.created).toHaveLength(0);
    expect(pool.hasLiveConversation('c1')).toBe(true);

    // The next turn runs on the resumed session in the new cwd.
    await pool.sendPrompt('c1', 'hello');
    const after = sdk.sessions.at(-1) as FakeSession;
    expect(after.cwd).toBe(NEW);
    expect(after.send).toHaveBeenCalledTimes(1);
    expect(before.send).not.toHaveBeenCalled();
  });

  it('an unchanged exposure keeps the live session (no rebind)', async () => {
    const pool = makePool();
    await pool.createConversation(params({ workingDirectory: OLD, additionalDirectories: [EXTRA] }));
    await pool.resumeConversation('c1', params({ workingDirectory: OLD, additionalDirectories: [EXTRA, EXTRA] }));

    expect(sdk.clients.every((c) => c.resumed.length === 0)).toBe(true);
    expect((sdk.sessions[0] as FakeSession).disconnect).not.toHaveBeenCalled();
    expect(sdk.sessions).toHaveLength(1);
  });

  it('starts a fresh session in the new cwd when the resume fails, so the turn still runs', async () => {
    const pool = makePool();
    await pool.createConversation(params({ workingDirectory: OLD }));
    sdk.failResume = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pool.resumeConversation('c1', params({ workingDirectory: NEW }));

    warn.mockRestore();
    const newClient = sdk.clients.find((c) => c.workingDirectory === NEW)!;
    expect(newClient.created.map((c) => [c.sessionId, c.workingDirectory])).toEqual([['c1', NEW]]);
    expect(pool.hasLiveConversation('c1')).toBe(true);
  });
});

describe('CopilotProvider — Edit sources on a live chat (D-137)', () => {
  function makeProvider() {
    const provider = new CopilotProvider({ defaultCwd: SERVER_CWD, verbose: false });
    toStop.push(provider);
    return provider;
  }

  it('rebinds a live session to the workspace client for the new cwd', async () => {
    const provider = makeProvider();
    await provider.createConversation(params({ workingDirectory: OLD }));
    const before = liveSession(provider)!;

    await provider.resumeConversation('c1', params({ workingDirectory: NEW }));

    expect(before.disconnect).toHaveBeenCalledTimes(1);
    const newClient = sdk.clients.find((c) => c.workingDirectory === NEW)!;
    expect(newClient.resumed.map((r) => [r.id, r.workingDirectory])).toEqual([['c1', NEW]]);
    expect(liveSession(provider)!.cwd).toBe(NEW);
  });

  it('rebinds in place when only the extra directories change (the [Workspace] hint moves)', async () => {
    const provider = makeProvider();
    await provider.createConversation(params({ workingDirectory: OLD, systemPromptAppend: 'a' }));
    await provider.resumeConversation(
      'c1',
      params({ workingDirectory: OLD, additionalDirectories: [EXTRA], systemPromptAppend: 'b' }),
    );

    const oldClient = sdk.clients.find((c) => c.workingDirectory === OLD)!;
    expect(oldClient.resumed).toHaveLength(1);
    expect(oldClient.resumed[0]).toMatchObject({ workingDirectory: OLD, systemMessage: { content: 'b' } });
  });

  it('an unchanged exposure does not rebind', async () => {
    const provider = makeProvider();
    await provider.createConversation(params({ workingDirectory: OLD }));
    await provider.resumeConversation('c1', params({ workingDirectory: OLD }));

    expect(sdk.clients.every((c) => c.resumed.length === 0)).toBe(true);
    expect(liveSession(provider)!.disconnect).not.toHaveBeenCalled();
  });
});
