// U-16 (D-147) — "Allow for this chat / for this run": remembering a gate's rules, and later gates of the same
// owner allowed without asking (every command covered), while other owners, other commands, the never-list and
// file writes in plan mode still ask.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzlePermissionRuleRepository } from '@generatorai/db';
import { permissionRuleKey, type AgentEvent, type PermissionRule } from '@generatorai/shared';
import type { PermissionRequest } from '../../src/domain/ports/IAgentHarness.js';
import type { IPermissionRuleRepository, PermissionRuleOwner, StoredPermissionRule } from '../../src/domain/ports/IPermissionRuleRepository.js';
import { PermissionRuleService } from '../../src/services/PermissionRuleService.js';
import { StageGatePort } from '../../src/services/session/StageGatePort.js';
import { StageConversationService } from '../../src/services/engine/StageConversationService.js';
import type { SessionOwner, TurnContext } from '../../src/services/session/types.js';
import { bootCore, type TestEnv } from './boot.js';

const envs: TestEnv[] = [];
afterEach(() => {
  for (const e of envs.splice(0)) e.dispose();
});

/** An in-memory rule store (the Drizzle one is covered in packages/db). */
class MemoryRules implements IPermissionRuleRepository {
  readonly rows: Array<StoredPermissionRule & { owner: string }> = [];
  private key = (o: PermissionRuleOwner) => `${o.kind}:${o.id}`;
  async list(o: PermissionRuleOwner) {
    return this.rows.filter((r) => r.owner === this.key(o));
  }
  async add(o: PermissionRuleOwner, rules: readonly PermissionRule[]) {
    for (const r of rules) {
      if (!this.rows.some((x) => x.owner === this.key(o) && permissionRuleKey(x) === permissionRuleKey(r))) {
        this.rows.push({ ...r, id: `${this.rows.length}`, createdAt: new Date(), owner: this.key(o) });
      }
    }
  }
  async remove(o: PermissionRuleOwner, id: string) {
    const i = this.rows.findIndex((r) => r.owner === this.key(o) && r.id === id);
    if (i >= 0) this.rows.splice(i, 1);
    return i >= 0;
  }
  async clear(o: PermissionRuleOwner) {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) if (this.rows[i]!.owner === this.key(o)) this.rows.splice(i, 1);
    return before - this.rows.length;
  }
}

function turn(owner: SessionOwner, over: Partial<TurnContext> = {}): TurnContext {
  return {
    owner,
    sessionId: owner.sessionId,
    turnId: 't1',
    agentMode: 'auto',
    permissionMode: 'acceptEdits',
    planIds: [],
    interactionIds: [],
    nextSequence: 0,
    cardSequence: new Map(),
    ...over,
  };
}

const stage = (stageRunId: string, workflowRunId = 'run-1'): SessionOwner => ({
  kind: 'stage',
  stageRunId,
  workflowRunId,
  workflowDefinitionId: 'def-1',
  sessionId: `sess-${stageRunId}`,
});

/** A Claude Bash request (`details.input.command`). */
const bash = (command: string): PermissionRequest => ({
  type: 'shell_exec',
  description: `Run ${command}`,
  details: { toolName: 'Bash', input: { command } },
});

describe('StageGatePort with run-scoped rules', () => {
  function port(rules: PermissionRuleService) {
    const parked: Array<Record<string, unknown>> = [];
    const emitted: Array<{ kind: string; data: Record<string, unknown> }> = [];
    let next: { outcome: 'approved' | 'changes_requested'; value?: unknown } = { outcome: 'approved' };
    const p = new StageGatePort({
      park: async (_t, data) => {
        parked.push(data);
        return next;
      },
      eventBus: { emit: async (_s: string, e: AgentEvent) => void emitted.push(e as never) } as never,
      harnessTypeOf: () => 'claude-agent',
      readPermissionMode: async () => 'acceptEdits',
      permissionRules: () => rules,
    });
    return { p, parked, emitted, answer: (n: typeof next) => (next = n) };
  }

  it('a gate offers its rules; once remembered for the run, another stage of the run is allowed without parking', async () => {
    const rules = new PermissionRuleService(new MemoryRules());
    const { p, parked, emitted, answer } = port(rules);

    // Stage A asks; the payload carries what "Allow for this run" would remember.
    answer({ outcome: 'approved', value: { remembered: [{ kind: 'command', match: 'pnpm lint' }] } });
    await expect(p.permission(bash('pnpm lint'), turn(stage('A')))).resolves.toMatchObject({ granted: true });
    expect(parked[0]).toMatchObject({ kind: 'tool_permission', rememberRules: [{ kind: 'command', match: 'pnpm lint' }] });
    expect(emitted.find((e) => e.kind === 'stage.permission.resolved')!.data).toMatchObject({ remembered: [{ kind: 'command', match: 'pnpm lint' }] });

    await rules.remember({ kind: 'run', id: 'run-1' }, [{ kind: 'command', match: 'pnpm lint' }]);
    parked.length = 0;
    emitted.length = 0;

    // Stage B of the same run: covered → no park, an auditable auto_allowed event.
    await expect(p.permission(bash('pnpm lint --fix 2>&1 | pnpm lint'), turn(stage('B')))).resolves.toEqual({ granted: true });
    expect(parked).toHaveLength(0);
    expect(emitted).toEqual([
      expect.objectContaining({
        kind: 'stage.permission.auto_allowed',
        data: expect.objectContaining({ stageRunId: 'B', workflowRunId: 'run-1', rules: [{ kind: 'command', match: 'pnpm lint' }] }),
      }),
    ]);
  });

  it('still parks a command the rules do not fully cover, a never-listed one, another run, and a plan-mode write', async () => {
    const rules = new PermissionRuleService(new MemoryRules());
    await rules.remember({ kind: 'run', id: 'run-1' }, [
      { kind: 'command', match: 'pnpm lint' },
      { kind: 'command', match: 'git push' }, // never honoured, even if it somehow got stored
      { kind: 'tool', match: 'Write' },
    ]);
    const { p, parked } = port(rules);
    await p.permission(bash('pnpm lint && pnpm test'), turn(stage('A')));
    await p.permission(bash('git push origin main'), turn(stage('A')));
    await p.permission(bash('pnpm lint'), turn(stage('X', 'run-2')));
    await p.permission(
      { type: 'file_write', description: 'Write a.ts', details: { toolName: 'Write', input: { file_path: 'a.ts' } } },
      turn(stage('A'), { permissionMode: 'plan' }),
    );
    expect(parked).toHaveLength(4);
    expect(parked[1]).toMatchObject({ rememberRules: [], rememberRefusal: expect.stringMatching(/Risky|push/) });
  });

  it('never remembers an always-ask tool', async () => {
    const { p, parked } = port(new PermissionRuleService(new MemoryRules()));
    await p.permission(
      { type: 'other', description: 'Merge', details: { toolName: 'github_merge_pull_request', input: { number: 1 }, provider: 'platform', alwaysAsk: true } },
      turn(stage('A'), { permissionMode: 'default' }),
    );
    expect(parked[0]).toMatchObject({ rememberRules: [], rememberRefusal: expect.stringMatching(/every time/) });
  });
});

describe('StageConversationService answering with remember', () => {
  function service(interruptData: Record<string, unknown>, rules: PermissionRuleService | undefined) {
    const command = vi.fn(async () => ({ ok: true }));
    const engine = {
      running: true,
      stores: { stages: { getInstance: () => ({ workflowRunId: 'run-1', kind: 'agent', status: 'awaiting_input' }) } },
      command,
    };
    const svc = new StageConversationService({
      engine: engine as never,
      stageRuns: { getById: async () => ({ interruptData, version: 3 }) } as never,
      permissionRules: () => rules,
    });
    return { svc, command };
  }

  it('stores the parked gate\'s rules for the run, then delivers the allow carrying them', async () => {
    const repo = new MemoryRules();
    const { svc, command } = service(
      { kind: 'tool_permission', interactionId: 'i1', rememberRules: [{ kind: 'command', match: 'pnpm test' }] },
      new PermissionRuleService(repo),
    );
    await svc.resolveInteraction('run-1', 'inst-1', 'i1', { kind: 'permission', behavior: 'allow', remember: 'owner' });
    expect(await repo.list({ kind: 'run', id: 'run-1' })).toEqual([expect.objectContaining({ kind: 'command', match: 'pnpm test' })]);
    expect(command).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'approved', data: { interactionId: 'i1', remembered: [{ kind: 'command', match: 'pnpm test' }] } }),
    );
  });

  it('"Allow for this project" stores the rules for the run\'s project, tagged as project rules', async () => {
    const repo = new MemoryRules();
    const command = vi.fn(async () => ({ ok: true }));
    const svc = new StageConversationService({
      engine: { running: true, stores: { stages: { getInstance: () => ({ workflowRunId: 'run-1', kind: 'agent', status: 'awaiting_input' }) } }, command } as never,
      stageRuns: { getById: async () => ({ interruptData: { kind: 'tool_permission', interactionId: 'i1', rememberRules: [{ kind: 'command', match: 'pnpm test' }] }, version: 3 }) } as never,
      permissionRules: () => new PermissionRuleService(repo),
      projectOfRun: async () => 'proj-1',
    });
    await svc.resolveInteraction('run-1', 'inst-1', 'i1', { kind: 'permission', behavior: 'allow', remember: 'project' });
    expect(await repo.list({ kind: 'run', id: 'run-1' })).toEqual([]);
    expect(await repo.list({ kind: 'project', id: 'proj-1' })).toEqual([expect.objectContaining({ kind: 'command', match: 'pnpm test' })]);
    expect(command).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ data: { interactionId: 'i1', remembered: [{ kind: 'command', match: 'pnpm test', scope: 'project' }] } }),
    );
  });

  it('refuses to remember a gate that always asks (and delivers nothing)', async () => {
    const { svc, command } = service(
      { kind: 'tool_permission', interactionId: 'i1', rememberRules: [], rememberRefusal: 'Risky requests always ask (pushes to a git remote).' },
      new PermissionRuleService(new MemoryRules()),
    );
    await expect(svc.resolveInteraction('run-1', 'inst-1', 'i1', { kind: 'permission', behavior: 'allow', remember: 'owner' })).rejects.toMatchObject({
      code: 'NOT_REMEMBERABLE',
      httpStatus: 422,
    });
    expect(command).not.toHaveBeenCalled();
  });
});

describe('chat-scoped rules (ChatManagementService)', () => {
  type Gate = (chatId: string, req: PermissionRequest, ctx: unknown) => Promise<{ granted: boolean }>;

  async function boot() {
    const env = bootCore();
    envs.push(env);
    env.extensions.permissionRules = new PermissionRuleService(new DrizzlePermissionRuleRepository(env.db));
    const chats = env.services.chatManagementService;
    const a = await chats.createChat({ name: 'A' });
    const b = await chats.createChat({ name: 'B' });
    const gate = (chats as unknown as { chatPermission: Gate }).chatPermission.bind(chats);
    const ctx = (chatId: string) =>
      turn({ kind: 'chat', chatId, sessionId: chatId === a.id ? a.sessionId : b.sessionId }, { permissionMode: 'acceptEdits' });
    const pending = async (chatId: string) => {
      for (let i = 0; i < 80; i += 1) {
        const open = (await chats.listPendingInteractions(chatId)).find((x) => x.kind === 'tool_permission');
        if (open) return open;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('no pending gate');
    };
    return { env, chats, a, b, gate, ctx, pending };
  }

  it('"Allow for this chat" remembers; the chat then allows covered commands unasked; another chat still asks', async () => {
    const { chats, a, b, gate, ctx, pending } = await boot();

    const first = gate(a.id, bash('pnpm lint'), ctx(a.id));
    const open = await pending(a.id);
    expect(open.payload).toMatchObject({ rememberRules: [{ kind: 'command', match: 'pnpm lint' }] });
    await expect(chats.resolveToolPermission(a.id, open.id, { behavior: 'allow', remember: 'owner' })).resolves.toEqual({ ok: true });
    await expect(first).resolves.toMatchObject({ granted: true });

    // Same chat, covered: answered at once, no new gate.
    const coveredTurn = ctx(a.id);
    await expect(gate(a.id, bash('pnpm lint --quiet'), coveredTurn)).resolves.toEqual({ granted: true });
    // Kept for the turn's transcript (a note, not a card).
    expect(coveredTurn.autoAllowedPermissions).toEqual([
      expect.objectContaining({ status: 'allowed', autoAllowed: true, remembered: [{ kind: 'command', match: 'pnpm lint' }] }),
    ]);
    expect(await chats.listPendingInteractions(a.id)).toEqual([]);

    // Another chat: the rule does not leak.
    const other = gate(b.id, bash('pnpm lint'), ctx(b.id));
    const openB = await pending(b.id);
    await chats.resolveToolPermission(b.id, openB.id, { behavior: 'deny' });
    await expect(other).resolves.toMatchObject({ granted: false });

    // Same chat, not covered: asks.
    const uncovered = gate(a.id, bash('pnpm lint && pnpm test'), ctx(a.id));
    const openA2 = await pending(a.id);
    await chats.resolveToolPermission(a.id, openA2.id, { behavior: 'deny' });
    await expect(uncovered).resolves.toMatchObject({ granted: false });
  });

  it('"Allow for this project" covers every chat of the project, chat rules and project rules combine, other projects still ask', async () => {
    const { env, chats, a, b, gate, ctx, pending } = await boot();
    const c = await chats.createChat({ name: 'C' });
    const now = Date.now();
    const sqlite = (env.db as unknown as { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }).$client;
    for (const p of ['proj-1', 'proj-2']) {
      sqlite.prepare(`INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, '/tmp', ?, ?)`).run(p, p, now, now);
    }
    sqlite.prepare(`UPDATE chats SET project_id = ? WHERE id IN (?, ?)`).run('proj-1', a.id, b.id);
    sqlite.prepare(`UPDATE chats SET project_id = ? WHERE id = ?`).run('proj-2', c.id);

    const first = gate(a.id, bash('pnpm test'), ctx(a.id));
    const open = await pending(a.id);
    await expect(chats.resolveToolPermission(a.id, open.id, { behavior: 'allow', remember: 'project' })).resolves.toEqual({ ok: true });
    await expect(first).resolves.toMatchObject({ granted: true });

    // Another chat of the same project: allowed unasked, recorded as a project rule.
    const turnB = ctx(b.id);
    await expect(gate(b.id, bash('pnpm test'), turnB)).resolves.toEqual({ granted: true });
    expect(turnB.autoAllowedPermissions).toEqual([
      expect.objectContaining({ autoAllowed: true, remembered: [{ kind: 'command', match: 'pnpm test', scope: 'project' }] }),
    ]);

    // B's own chat rule plus the project's rule cover a line that needs both.
    const lint = gate(b.id, bash('pnpm lint'), ctx(b.id));
    const openLint = await pending(b.id);
    await chats.resolveToolPermission(b.id, openLint.id, { behavior: 'allow', remember: 'owner' });
    await lint;
    await expect(gate(b.id, bash('pnpm lint && pnpm test'), ctx(b.id))).resolves.toEqual({ granted: true });

    // A chat of another project still asks.
    const other = gate(c.id, bash('pnpm test'), turn({ kind: 'chat', chatId: c.id, sessionId: c.sessionId }, { permissionMode: 'acceptEdits' }));
    const openC = await pending(c.id);
    await chats.resolveToolPermission(c.id, openC.id, { behavior: 'deny' });
    await expect(other).resolves.toMatchObject({ granted: false });
  });

  it('refuses "Allow for this project" in a chat outside any project', async () => {
    const { chats, a, gate, ctx, pending } = await boot();
    const call = gate(a.id, bash('pnpm test'), ctx(a.id));
    const open = await pending(a.id);
    await expect(chats.resolveToolPermission(a.id, open.id, { behavior: 'allow', remember: 'project' })).resolves.toMatchObject({
      ok: false,
      code: 'NOT_REMEMBERABLE',
    });
    await chats.resolveToolPermission(a.id, open.id, { behavior: 'allow' });
    await expect(call).resolves.toMatchObject({ granted: true });
  });

  it('refuses "Allow for this chat" on a never-listed command and leaves the gate open', async () => {
    const { chats, a, gate, ctx, pending } = await boot();
    const call = gate(a.id, bash('sudo ls'), ctx(a.id));
    const open = await pending(a.id);
    await expect(chats.resolveToolPermission(a.id, open.id, { behavior: 'allow', remember: 'owner' })).resolves.toMatchObject({
      ok: false,
      code: 'NOT_REMEMBERABLE',
    });
    expect((await chats.listPendingInteractions(a.id)).map((x) => x.id)).toEqual([open.id]);
    await chats.resolveToolPermission(a.id, open.id, { behavior: 'allow' });
    await expect(call).resolves.toMatchObject({ granted: true });
  });
});
