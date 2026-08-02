import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentInteractionService } from '../src/services/AgentInteractionService.js';
import type { IAgentInteractionRepository } from '../src/domain/ports/IPlanRepository.js';
import type { AgentInteraction, AgentInteractionStatus } from '@generatorai/shared';

/**
 * PLN-01 — the chat-scoped gate.
 *
 * The invariants under test are the ones that were hard-won in HitlService and
 * are easy to regress:
 *   - the waiter is registered synchronously, so a cancel that races the DB
 *     write still settles the promise instead of wedging the agent turn
 *   - resolution is conditional, so exactly one approver wins
 *   - cancellation settles the in-memory promise, not just the DB row
 */

class FakeRepo implements IAgentInteractionRepository {
  rows = new Map<string, AgentInteraction>();

  async create(params: Parameters<IAgentInteractionRepository['create']>[0]) {
    for (const row of this.rows.values()) {
      if (
        row.status === 'pending' &&
        row.chatId === params.chatId &&
        row.turnId === params.turnId &&
        row.kind === params.kind
      ) {
        throw new Error('UNIQUE constraint failed: one pending gate per (chat, turn, kind)');
      }
    }
    const interaction: AgentInteraction = {
      id: params.id,
      scopeKind: params.scopeKind,
      scopeId: params.scopeId,
      ...(params.chatId ? { chatId: params.chatId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.turnId ? { turnId: params.turnId } : {}),
      kind: params.kind,
      status: 'pending',
      payload: params.payload,
      createdAt: new Date(),
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
    };
    this.rows.set(params.id, interaction);
    return interaction;
  }

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async listPendingByChat(chatId: string) {
    return [...this.rows.values()].filter((r) => r.chatId === chatId && r.status === 'pending');
  }

  async listPendingByScope(scopeKind: 'chat' | 'stage_run', scopeId: string) {
    return [...this.rows.values()].filter(
      (r) => r.scopeKind === scopeKind && r.scopeId === scopeId && r.status === 'pending',
    );
  }

  async resolve(id: string, status: AgentInteractionStatus, resolution: unknown) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending') return false;
    this.rows.set(id, { ...row, status, resolution, resolvedAt: new Date() });
    return true;
  }

  async cancelForTurn(chatId: string, turnId: string, reason: string) {
    const ids: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.chatId === chatId && row.turnId === turnId && row.status === 'pending') {
        this.rows.set(id, { ...row, status: 'cancelled', resolution: { reason } });
        ids.push(id);
      }
    }
    return ids;
  }

  async cancelForChat(chatId: string, reason: string) {
    const ids: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.chatId === chatId && row.status === 'pending') {
        this.rows.set(id, { ...row, status: 'cancelled', resolution: { reason } });
        ids.push(id);
      }
    }
    return ids;
  }

  async expireStale(olderThan: Date) {
    const ids: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.scopeKind === 'chat' && row.status === 'pending' && row.createdAt < olderThan) {
        this.rows.set(id, { ...row, status: 'expired' });
        ids.push(id);
      }
    }
    return ids;
  }

  async expireAllPendingChatGates(reason: string) {
    const ids: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.scopeKind === 'chat' && row.status === 'pending') {
        this.rows.set(id, { ...row, status: 'expired', resolution: { reason } });
        ids.push(id);
      }
    }
    return ids;
  }
}

const SCOPE = { kind: 'chat', chatId: 'chat-1', sessionId: 'sess-1', turnId: 'turn-1' } as const;

describe('AgentInteractionService', () => {
  let repo: FakeRepo;
  let service: AgentInteractionService;
  let events: unknown[];

  beforeEach(() => {
    repo = new FakeRepo();
    events = [];
    service = new AgentInteractionService(
      repo,
      (e) => {
        events.push(e);
      },
      undefined,
      { sweepIntervalMs: 0 },
    );
  });

  it('blocks until resolved and returns the resolution', async () => {
    const gate = service.open(SCOPE, 'plan_review', { summary: 'x' });
    const [pending] = await service.listPendingByChat('chat-1');
    expect(pending).toBeDefined();

    const outcome = service.resolve(pending!.id, 'approved', { approved: true });
    await expect(gate).resolves.toEqual({ status: 'approved', value: { approved: true } });
    await expect(outcome).resolves.toEqual({ ok: true });
  });

  it('only one approver wins; the loser gets ok:false', async () => {
    void service.open(SCOPE, 'plan_review', {});
    const [pending] = await service.listPendingByChat('chat-1');

    const first = await service.resolve(pending!.id, 'approved', { approved: true });
    const second = await service.resolve(pending!.id, 'rejected', { approved: false });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('already approved');
  });

  it('rejects a second pending gate for the same (chat, turn, kind)', async () => {
    void service.open(SCOPE, 'plan_review', {});
    await expect(service.open(SCOPE, 'plan_review', {})).rejects.toThrow(/UNIQUE/);
  });

  it('allows different kinds to be pending on the same turn', async () => {
    void service.open(SCOPE, 'plan_review', {});
    void service.open(SCOPE, 'question', {});
    expect(await service.listPendingByChat('chat-1')).toHaveLength(2);
  });

  it('cancelForTurn settles the blocked promise, not just the DB row', async () => {
    const gate = service.open(SCOPE, 'plan_review', {});
    await service.listPendingByChat('chat-1');

    await service.cancelForTurn('chat-1', 'turn-1', 'user_cancelled');

    // Without settling the waiter the SDK callback would hang forever even
    // though the vendor turn was aborted.
    await expect(gate).resolves.toEqual({ status: 'cancelled', reason: 'user_cancelled' });
  });

  it('cancelForChat settles every pending gate', async () => {
    const a = service.open(SCOPE, 'plan_review', {});
    const b = service.open(SCOPE, 'question', {});

    await service.cancelForChat('chat-1', 'archived');

    await expect(a).resolves.toMatchObject({ status: 'cancelled' });
    await expect(b).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('expireOrphans expires pending chat gates and settles any surviving waiter', async () => {
    const gate = service.open(SCOPE, 'plan_review', {});
    await service.listPendingByChat('chat-1');

    const count = await service.expireOrphans();

    expect(count).toBe(1);
    expect(await service.listPendingByChat('chat-1')).toHaveLength(0);
    // A surviving waiter must be settled, otherwise its provider callback
    // would block forever even though the gate is gone.
    await expect(gate).resolves.toEqual({ status: 'expired', reason: 'server_restart' });
  });

  it('sweepExpired expires abandoned gates at runtime', async () => {
    const shortLived = new AgentInteractionService(repo, undefined, undefined, {
      maxAgeMs: -1,
      sweepIntervalMs: 0,
    });
    const gate = shortLived.open(SCOPE, 'plan_review', {});
    await shortLived.listPendingByChat('chat-1');

    const expired = await shortLived.sweepExpired();

    expect(expired).toBe(1);
    await expect(gate).resolves.toEqual({ status: 'expired', reason: 'timeout' });
    shortLived.dispose();
  });

  it('emits opened and resolved events', async () => {
    void service.open(SCOPE, 'question', { questions: [] });
    const [pending] = await service.listPendingByChat('chat-1');
    await service.resolve(pending!.id, 'answered', { answers: {} });

    expect(events.map((e) => (e as { type: string }).type)).toEqual(['opened', 'resolved']);
  });

  it('does not leave a dangling waiter when the DB write fails', async () => {
    const failing = new AgentInteractionService(
      { ...repo, create: vi.fn().mockRejectedValue(new Error('db down')) } as unknown as IAgentInteractionRepository,
      undefined,
      undefined,
      { sweepIntervalMs: 0 },
    );
    await expect(failing.open(SCOPE, 'plan_review', {})).rejects.toThrow('db down');
    failing.dispose();
  });
});
