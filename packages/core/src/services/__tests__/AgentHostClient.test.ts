/**
 * W12 — AgentHostClient.
 *
 * `HostSupervisor` is faked: every case here is about the gateway-side session
 * bookkeeping, which is where the audit found the defects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEvent, AgentHostResponse, AgentHostRequest, ILogger } from '@generatorai/shared';
import { AgentHostClient } from '../AgentHostClient.js';
import type { HostSupervisor } from '../../infrastructure/HostSupervisor.js';
import type { CreateConversationParams } from '../../domain/ports/IAgentHarness.js';

class FakeSupervisor {
  readonly requests: Array<Partial<AgentHostRequest>> = [];
  state: 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'fatal' = 'running';
  /** Force the next N spawn responses to be errors. */
  failSpawnWith: string | undefined;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getState(): string {
    return this.state;
  }

  async send(req: Partial<AgentHostRequest>): Promise<AgentHostResponse> {
    this.requests.push(req);
    if (req.type === 'spawn_session' && this.failSpawnWith) {
      return { type: 'error', reqId: 'r', ok: false, message: this.failSpawnWith };
    }
    return { type: 'ack', reqId: 'r', ok: true };
  }

  spawnedSessionIds(): string[] {
    return this.requests.filter((r) => r.type === 'spawn_session').map((r) => (r as { sessionId: string }).sessionId);
  }

  as(): HostSupervisor {
    return this as unknown as HostSupervisor;
  }
}

function silentLogger(): ILogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (m: string) => { lines.push(`${level}: ${m}`); };
  return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } as unknown as ILogger & { lines: string[] };
}

const params = { harnessType: 'claude-agent' } as unknown as CreateConversationParams;

describe('AgentHostClient', () => {
  let supervisor: FakeSupervisor;
  let logger: ILogger & { lines: string[] };
  let client: AgentHostClient;

  beforeEach(() => {
    supervisor = new FakeSupervisor();
    logger = silentLogger();
    client = new AgentHostClient(supervisor.as(), logger);
  });

  it('binds the CALLER-supplied id when resuming a conversation the host does not know', async () => {
    // Regression: resumeConversation called createConversation(), which minted a
    // fresh randomUUID() and threw it away — the caller's id was never bound, so
    // the next sendPrompt returned SESSION_NOT_FOUND permanently.
    await client.resumeConversation('caller-chosen-id', params);

    expect(supervisor.spawnedSessionIds()).toEqual(['caller-chosen-id']);
    expect(client.hasLiveConversation('caller-chosen-id')).toBe(true);
    expect(await client.listConversations()).toEqual(['caller-chosen-id']);
  });

  it('subscribing to an unknown id does not make it look live', async () => {
    // Regression: onConversationEvent auto-created a handler set for ANY id and
    // hasLiveConversation() read that same map, so one stray subscribe made
    // resumeConversation short-circuit on its second attempt and never spawn.
    client.onConversationEvent('ghost', () => {});
    expect(client.hasLiveConversation('ghost')).toBe(false);

    await client.resumeConversation('ghost', params);
    expect(supervisor.spawnedSessionIds()).toEqual(['ghost']);
    expect(client.hasLiveConversation('ghost')).toBe(true);
  });

  it('does not mark a conversation live when the spawn fails', async () => {
    supervisor.failSpawnWith = 'no runtime';
    await expect(client.createConversation(params)).rejects.toThrow(/no runtime/);
    expect(await client.listConversations()).toEqual([]);
  });

  it('delivers agent events to the conversation handlers', async () => {
    const id = await client.createConversation(params);
    const seen: AgentEvent[] = [];
    client.onConversationEvent(id, (e) => seen.push(e));

    client.handleHostEvent({ type: 'agent_event', sessionId: id, event: { kind: 'harness.token', data: { text: 'hi' } } as AgentEvent, seq: 1 });
    expect(seen).toHaveLength(1);
  });

  it('reports dropped frames from the host gap marker and from a seq jump', async () => {
    const id = await client.createConversation(params);
    const evt = (seq: number, droppedBefore?: number): Parameters<AgentHostClient['handleHostEvent']>[0] => ({
      type: 'agent_event',
      sessionId: id,
      event: { kind: 'harness.token', data: { text: 't' } } as AgentEvent,
      seq,
      ...(droppedBefore !== undefined ? { droppedBefore } : {}),
    });

    client.handleHostEvent(evt(1));
    client.handleHostEvent(evt(5, 3));
    expect(client.getDroppedEventCount()).toBe(3);

    // A seq jump with no explicit marker is still counted, once.
    client.handleHostEvent(evt(9));
    expect(client.getDroppedEventCount()).toBe(6);
    expect(logger.lines.some((l) => l.includes('Sequence gap'))).toBe(true);
  });

  it('handles session_ended instead of dropping it', async () => {
    // Regression: handleHostEvent tested only `msg.type === 'agent_event'` and
    // silently dropped everything else, so session_ended was dead end to end.
    const id = await client.createConversation(params);
    const seen: AgentEvent[] = [];
    client.onConversationEvent(id, (e) => seen.push(e));

    // The terminal event was dropped by the host's bounded queue: only
    // session_ended arrives. Without synthesis the pending turn hangs forever.
    client.handleHostEvent({ type: 'session_ended', sessionId: id, reason: 'error', error: 'provider died' });

    expect(seen).toHaveLength(1);
    expect((seen[0] as { kind: string }).kind).toBe('harness.error');
    expect((seen[0] as { data: { message: string } }).data.message).toBe('provider died');
  });

  it('does not double-deliver a terminal event that already arrived', async () => {
    const id = await client.createConversation(params);
    const seen: AgentEvent[] = [];
    client.onConversationEvent(id, (e) => seen.push(e));

    client.handleHostEvent({ type: 'agent_event', sessionId: id, event: { kind: 'harness.idle', data: {} } as AgentEvent, seq: 1 });
    client.handleHostEvent({ type: 'session_ended', sessionId: id, reason: 'complete' });

    expect(seen.map((e) => (e as { kind: string }).kind)).toEqual(['harness.idle']);
  });

  it('sendPromptAndWait settles from a session_ended even when its terminal event was dropped', async () => {
    const id = await client.createConversation(params);
    const pending = client.sendPromptAndWait(id, 'hello');
    await Promise.resolve();

    client.handleHostEvent({
      type: 'agent_event',
      sessionId: id,
      event: { kind: 'harness.message_complete', data: { content: 'answer' } } as AgentEvent,
      seq: 1,
    });
    client.handleHostEvent({ type: 'session_ended', sessionId: id, reason: 'complete' });

    await expect(pending).resolves.toEqual({ content: 'answer' });
  });

  // ── Re-attach across a host restart ────────────────────────────────────────

  it('re-spawns every live session under the SAME id after a host restart', async () => {
    // Regression: the restarted host booted with empty session maps while the
    // client kept its handler map, so every later turn failed SESSION_NOT_FOUND
    // forever and the gateway reported everything alive.
    const a = await client.createConversation(params);
    const b = await client.createConversation(params);
    supervisor.requests.length = 0;

    await client.reattachSessions();

    expect(supervisor.spawnedSessionIds().sort()).toEqual([a, b].sort());
    expect(client.hasLiveConversation(a)).toBe(true);
    expect(client.hasLiveConversation(b)).toBe(true);
  });

  it('re-sends the original params so the host can rebuild the session', async () => {
    const distinctive = { harnessType: 'claude-agent', model: 'opus', cwd: '/w' } as unknown as CreateConversationParams;
    const id = await client.createConversation(distinctive);
    supervisor.requests.length = 0;

    await client.reattachSessions();

    const spawn = supervisor.requests.find((r) => r.type === 'spawn_session') as { sessionId: string; params: Record<string, unknown> };
    expect(spawn.sessionId).toBe(id);
    expect(spawn.params).toMatchObject({ model: 'opus', cwd: '/w' });
  });

  it('fails a lost session LOUDLY rather than leaving a live-looking zombie', async () => {
    const id = await client.createConversation(params);
    const seen: AgentEvent[] = [];
    client.onConversationEvent(id, (e) => seen.push(e));
    supervisor.failSpawnWith = 'runtime gone';

    await client.reattachSessions();

    expect(client.hasLiveConversation(id)).toBe(false);
    expect((seen[0] as { kind: string }).kind).toBe('harness.error');
    expect(client.getClientState()).toBe('error');
  });

  // ── Fatal host ─────────────────────────────────────────────────────────────

  it('stops reporting "running" once the host is unrecoverable', async () => {
    // Regression: restart-cap exhaustion left clientState at 'running', so
    // getClientState() lied about a process that no longer existed.
    await client.initialize();
    expect(client.getClientState()).toBe('running');

    const id = await client.createConversation(params);
    const seen: AgentEvent[] = [];
    client.onConversationEvent(id, (e) => seen.push(e));
    const clientEvents: string[] = [];
    client.onClientEvent((e) => clientEvents.push(e.type));

    client.handleHostFatal('crashed 6 times in 60s');

    expect(client.getClientState()).toBe('error');
    expect(clientEvents).toContain('client.error');
    expect((seen[0] as { kind: string }).kind).toBe('harness.error');
    expect(client.hasLiveConversation(id)).toBe(false);
  });

  it('reports error state from the supervisor even when onFatal was never wired', async () => {
    await client.initialize();
    supervisor.state = 'fatal';
    expect(client.getClientState()).toBe('error');
  });

  it('warns on an unhandled host notification type rather than silently dropping it', () => {
    client.handleHostEvent({ type: 'nonsense' } as never);
    expect(logger.lines.some((l) => l.includes('Unhandled host notification'))).toBe(true);
  });

  it('releases local state when delete_session fails on a dead host', async () => {
    const id = await client.createConversation(params);
    vi.spyOn(supervisor, 'send').mockRejectedValueOnce(new Error('not connected'));
    await client.deleteConversation(id);
    expect(client.hasLiveConversation(id)).toBe(false);
  });
});

describe('AgentHostClient turn gates (P07 WP-7.2)', () => {
  // ECON-R3: a session routed by model counts against its own provider, not claude-agent.
  it("admits a turn on the provider the session's model routes to, and a stop withdraws a queued turn", async () => {
    const supervisor = new FakeSupervisor();
    const client = new AgentHostClient(supervisor.as(), silentLogger());
    const asked: string[] = [];
    let release: (() => void) | undefined;
    client.useTurnGates(
      (provider) => {
        asked.push(provider);
        return {
          tryAcquire: () => undefined,
          acquire: (signal?: AbortSignal) =>
            new Promise<() => void>((resolve, reject) => {
              release = () => resolve(() => undefined);
              signal?.addEventListener('abort', () => reject(Object.assign(new Error('withdrawn'), { name: 'AbortError' })));
            }),
        };
      },
      async (model) => (model.startsWith('gpt') ? 'copilot' : 'claude-agent'),
    );
    const id = await client.createConversation({ model: 'gpt-5' } as unknown as CreateConversationParams);
    const events: string[] = [];
    client.onConversationEvent(id, (e) => events.push(String((e as { kind?: string }).kind)));
    const turn = client.sendPrompt(id, 'hi');
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual(['copilot']);
    await client.abortConversation(id);
    await turn;
    expect(events).toContain('harness.cancelled');
    expect(supervisor.requests.some((r) => r.type === 'send_turn')).toBe(false);
    expect(release).toBeDefined();
  });
});
