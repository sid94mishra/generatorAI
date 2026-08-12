// ────────────────────────────────────────────────────────────────
// AgentRepository + migration v26.
//
// The migration test is deliberately paranoid: the pre-versioned
// `safeAddColumn` block runs BEFORE the versioned loop on every boot, so a
// duplicate raw ALTER inside v26 would throw on a fresh DB, roll back, and
// stop the server from starting.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, DrizzleAgentRepository } from '../src/index.js';
import type { Agent } from '@generatorai/shared';

function makeAgent(over: Partial<Agent> = {}): Agent {
  const now = new Date();
  return {
    id: 'a1',
    scope: 'global',
    projectId: '',
    slug: 'reviewer',
    ref: 'global:reviewer',
    name: 'Reviewer',
    description: 'Reviews code carefully',
    instructions: 'You review code.',
    role: 'agent',
    projection: 'append',
    tags: ['review'],
    enabled: true,
    skillIds: ['s1'],
    mcpServerIds: [],
    tools: { shell: false },
    runtime: { model: 'claude-sonnet-4.6' },
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('migration v26', () => {
  it('applies cleanly on a fresh database', () => {
    const db = createDB(':memory:');
    expect(() => migrateDB(db)).not.toThrow();
  });

  it('is idempotent across repeated boots', () => {
    const db = createDB(':memory:');
    migrateDB(db);
    expect(() => migrateDB(db)).not.toThrow();
    expect(() => migrateDB(db)).not.toThrow();
  });

  it('records v26 in the schema ledger exactly once', () => {
    const db = createDB(':memory:');
    migrateDB(db);
    migrateDB(db);
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { all: () => unknown[] } } } })
      .session.client;
    const rows = sqlite.prepare(`SELECT version FROM _schema_versions WHERE version = 26`).all();
    expect(rows).toHaveLength(1);
  });

  it('adds the agent binding columns to every bound table', () => {
    const db = createDB(':memory:');
    migrateDB(db);
    const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { all: () => Array<{ name: string }> } } } })
      .session.client;
    const cols = (table: string) =>
      sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

    expect(cols('chats')).toEqual(
      expect.arrayContaining(['agent_ref', 'agent_id', 'agent_version', 'agent_overrides', 'agent_snapshot']),
    );
    expect(cols('chat_messages')).toEqual(expect.arrayContaining(['agent_ref', 'agent_version']));
    expect(cols('stage_definitions')).toEqual(expect.arrayContaining(['agent_ref']));
    expect(cols('workflow_definitions')).toEqual(expect.arrayContaining(['default_agent_ref']));
    expect(cols('workflow_runs')).toEqual(expect.arrayContaining(['agent_snapshot']));
  });
});

describe('DrizzleAgentRepository', () => {
  let db: ReturnType<typeof createDB>;
  let repo: DrizzleAgentRepository;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    repo = new DrizzleAgentRepository(db);
  });

  it('round-trips an agent including its JSON columns', async () => {
    await repo.create(makeAgent());
    const found = await repo.getById('a1');

    expect(found.ref).toBe('global:reviewer');
    expect(found.tags).toEqual(['review']);
    expect(found.skillIds).toEqual(['s1']);
    expect(found.tools).toEqual({ shell: false });
    expect(found.runtime).toEqual({ model: 'claude-sonnet-4.6' });
  });

  it('resolves by portable ref', async () => {
    await repo.create(makeAgent());
    expect((await repo.getByRef('global:reviewer'))?.id).toBe('a1');
    expect(await repo.getByRef('global:nope')).toBeNull();
    expect(await repo.getByRef('not-a-ref')).toBeNull();
  });

  it('enforces slug uniqueness within a scope even for global agents', async () => {
    await repo.create(makeAgent());
    // project_id is NOT NULL DEFAULT '' precisely so this collides — a nullable
    // column would let unlimited duplicates through the UNIQUE index.
    await expect(repo.create(makeAgent({ id: 'a2' }))).rejects.toThrow(/already exists/i);
  });

  it('allows the same slug in different scopes', async () => {
    await repo.create(makeAgent());
    await expect(
      repo.create(makeAgent({ id: 'a2', scope: 'system', ref: 'system:reviewer' })),
    ).resolves.toBeTruthy();
  });

  it('bumps the version on every update', async () => {
    await repo.create(makeAgent());
    const once = await repo.update('a1', { name: 'Renamed' });
    expect(once.version).toBe(2);
    const twice = await repo.update('a1', { name: 'Renamed again' });
    expect(twice.version).toBe(3);
  });

  it('rejects a malformed JSON column at the write boundary', async () => {
    await expect(
      repo.create(makeAgent({ id: 'bad', slug: 'bad', tags: 'not-an-array' as unknown as string[] })),
    ).rejects.toThrow();
  });

  it('filters by scope, role and free-text query', async () => {
    await repo.create(makeAgent());
    await repo.create(
      makeAgent({ id: 'a2', slug: 'lead', ref: 'global:lead', name: 'Delivery Lead', role: 'orchestrator' }),
    );

    expect((await repo.list({ role: 'orchestrator' })).map((a) => a.id)).toEqual(['a2']);
    expect((await repo.list({ query: 'deliv' })).map((a) => a.id)).toEqual(['a2']);
    expect((await repo.list({ scope: 'system' }))).toHaveLength(0);
  });

  it('reports no usage for an unbound agent', async () => {
    await repo.create(makeAgent());
    const usage = await repo.countUsage('global:reviewer');
    expect(usage).toEqual({ chats: [], stages: [], workflows: [] });
  });
});
