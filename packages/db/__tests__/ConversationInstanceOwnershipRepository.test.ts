// ────────────────────────────────────────────────────────────────
// SqliteConversationInstanceOwnershipRepository — W34 fix.
//
// Migration 40 adds `conversation_instance_ownership`, the persistence
// layer that lets a conversation be routed to a SPECIFIC provider
// instance (e.g. `copilot:work` vs `copilot:personal`) rather than only a
// driver type. This test pins the round trip and — the point of the whole
// migration — that it coexists with the pre-existing type-level
// `conversation_ownership` table without either one clobbering the other.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeProviderInstanceId } from '@generatorai/core';

import { createDB, migrateDB, type AppDatabase } from '../src/index.js';
import { SqliteConversationInstanceOwnershipRepository } from '../src/repositories/ConversationInstanceOwnershipRepository.js';
import { SqliteConversationOwnershipRepository } from '../src/repositories/ConversationOwnershipRepository.js';
import { sqliteHandle } from '../src/repositories/AuthRepositories.js';

let dir: string;
let dbPath: string;
let db: AppDatabase;
let repo: SqliteConversationInstanceOwnershipRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-instance-ownership-'));
  dbPath = join(dir, 'w.db');
  db = createDB(dbPath);
  migrateDB(db);
  repo = new SqliteConversationInstanceOwnershipRepository(db);
});

afterEach(() => {
  try {
    sqliteHandle(db).close();
  } catch {
    /* already closed by a restart simulation */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

/**
 * A real restart, not a mocked one: closes the connection, discards the repo
 * and its prepared statements, and reopens the SAME file through the same
 * `createDB` + `migrateDB` boot path the server uses. Anything that only ever
 * lived in memory is gone by construction.
 */
function restart(): SqliteConversationInstanceOwnershipRepository {
  sqliteHandle(db).close();
  db = createDB(dbPath);
  migrateDB(db);
  repo = new SqliteConversationInstanceOwnershipRepository(db);
  return repo;
}

describe('SqliteConversationInstanceOwnershipRepository', () => {
  it('round-trips a save through load', async () => {
    await repo.save('conv-1', 'copilot:work');
    const rows = await repo.load();
    expect(rows).toEqual([{ conversationId: 'conv-1', instanceId: 'copilot:work' }]);
  });

  it('upserts on repeated save for the same conversation', async () => {
    await repo.save('conv-1', 'copilot:work');
    await repo.save('conv-1', 'copilot:personal');
    const rows = await repo.load();
    expect(rows).toEqual([{ conversationId: 'conv-1', instanceId: 'copilot:personal' }]);
  });

  it('remove() deletes exactly one conversation', async () => {
    await repo.save('conv-1', 'copilot:work');
    await repo.save('conv-2', 'claude-agent:default');
    await repo.remove('conv-1');
    const rows = await repo.load();
    expect(rows).toEqual([{ conversationId: 'conv-2', instanceId: 'claude-agent:default' }]);
  });

  it('two accounts of the SAME driver are independently addressable', async () => {
    await repo.save('conv-work', 'copilot:work');
    await repo.save('conv-personal', 'copilot:personal');
    const rows = await repo.load();
    const byConv = Object.fromEntries(rows.map((r) => [r.conversationId, r.instanceId]));
    expect(byConv['conv-work']).toBe('copilot:work');
    expect(byConv['conv-personal']).toBe('copilot:personal');
  });

  it('coexists with the type-level conversation_ownership table without interference', async () => {
    const typeRepo = new SqliteConversationOwnershipRepository(db);
    // Same conversation id recorded at BOTH granularities — the type-level
    // table (legacy/default routing) and the instance-level table (specific
    // account), as MultiHarness does when an instance is resolved.
    await typeRepo.save('conv-1', 'copilot');
    await repo.save('conv-1', 'copilot:work');

    const typeRows = await typeRepo.load();
    const instanceRows = await repo.load();
    expect(typeRows).toEqual([{ conversationId: 'conv-1', harnessType: 'copilot' }]);
    expect(instanceRows).toEqual([{ conversationId: 'conv-1', instanceId: 'copilot:work' }]);

    // Removing from one table must not touch the other.
    await repo.remove('conv-1');
    expect(await typeRepo.load()).toEqual([{ conversationId: 'conv-1', harnessType: 'copilot' }]);
    expect(await repo.load()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// B1 — the full ProviderRuntimeBinding must actually round-trip.
//
// Migration 44 added six columns (provider, adapter_key, resume_cursor,
// runtime_payload, runtime_mode, binding_origin). Before this fix the
// repository wrote and read exactly three (conversation_id, instance_id,
// updated_at), so five of the binding's seven fields existed only in
// `ProviderInstanceRegistry`'s in-memory map and died with the process.
// ────────────────────────────────────────────────────────────────

const FULL_BINDING = {
  threadId: 'conv-full',
  provider: 'copilot',
  providerInstanceId: makeProviderInstanceId('copilot:work'),
  adapterKey: 'copilot-sdk',
  resumeCursor: 'opaque-cursor-abc123',
  runtimePayload: { cwd: '/srv/app', nested: { retries: 2 } },
  runtimeMode: 'copilot-sdk',
  bindingOrigin: 'explicit',
} as const;

describe('W34 — ProviderRuntimeBinding persistence (B1)', () => {
  it('round-trips every binding field across a real restart', async () => {
    await repo.saveBinding({ ...FULL_BINDING });

    const reopened = restart();
    const bindings = await reopened.loadBindings();

    expect(bindings).toEqual([{ ...FULL_BINDING }]);
  });

  it('keeps the narrow load()/resolve pair working for a full-shape row', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    const reopened = restart();
    expect(await reopened.load()).toEqual([
      { conversationId: 'conv-full', instanceId: 'copilot:work' },
    ]);
  });

  it('upserts a binding in place — a rebind does not leave the old cursor behind', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    await repo.saveBinding({
      threadId: 'conv-full',
      provider: 'claude-agent',
      providerInstanceId: makeProviderInstanceId('claude-agent:personal'),
      adapterKey: 'claude-agent',
      runtimeMode: 'claude-agent-sdk',
      bindingOrigin: 'explicit',
    });

    const bindings = await restart().loadBindings();
    expect(bindings).toEqual([
      {
        threadId: 'conv-full',
        provider: 'claude-agent',
        providerInstanceId: 'claude-agent:personal',
        adapterKey: 'claude-agent',
        runtimeMode: 'claude-agent-sdk',
        bindingOrigin: 'explicit',
      },
    ]);
    // The stale cursor and payload must be GONE, not merely shadowed: a
    // cursor is meaningful only to the account that issued it.
    expect(bindings[0]).not.toHaveProperty('resumeCursor');
    expect(bindings[0]).not.toHaveProperty('runtimePayload');
  });

  it('remove() clears the persisted binding so a restart cannot resurrect it', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    await repo.remove('conv-full');
    expect(await restart().loadBindings()).toEqual([]);
  });

  it('omits legacy rows from loadBindings() so the registry still promotes them', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    await repo.save('conv-legacy', 'copilot:personal'); // narrow write — no provider

    const reopened = restart();
    // The legacy row has no provider/adapter_key, so it is NOT a binding: it
    // must reach `ProviderInstanceRegistry.promoteLegacyRow` via `load()`
    // rather than being read back as a fabricated full binding.
    expect((await reopened.loadBindings()).map((b) => b.threadId)).toEqual(['conv-full']);
    expect((await reopened.load()).map((r) => r.conversationId).sort()).toEqual([
      'conv-full',
      'conv-legacy',
    ]);
  });

  it('tolerates a corrupt runtime_payload rather than failing the whole hydrate', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    sqliteHandle(db)
      .prepare(`UPDATE conversation_instance_ownership SET runtime_payload = ? WHERE conversation_id = ?`)
      .run('{not json', 'conv-full');

    const bindings = await restart().loadBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).not.toHaveProperty('runtimePayload');
    expect(bindings[0]?.resumeCursor).toBe('opaque-cursor-abc123');
  });
});

// ────────────────────────────────────────────────────────────────
// B2 — migration 44's back-fill trust level.
//
// A row that predates the full binding shape was written by the narrow
// `save()` path: nobody recorded WHICH account family it belonged to, and
// nobody asked a human. Back-filling it as `'explicit'` — the highest trust
// level — asserts a fact that was never established, and makes the REV2
// promotion rules unreachable for exactly the rows they exist to govern.
// ────────────────────────────────────────────────────────────────

describe('W34 — migration 44 back-fill (B2)', () => {
  /** Rewind the schema to its pre-44 shape with a legacy row already in it. */
  function rewindToPre44(): void {
    const sqlite = sqliteHandle(db);
    sqlite
      .prepare(
        `INSERT INTO conversation_instance_ownership (conversation_id, instance_id, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run('conv-legacy', 'copilot:work', Date.now());
    for (const col of [
      'provider',
      'adapter_key',
      'resume_cursor',
      'runtime_payload',
      'runtime_mode',
      'binding_origin',
    ]) {
      sqlite.exec(`ALTER TABLE conversation_instance_ownership DROP COLUMN ${col};`);
    }
    // Every version from 44 up, not just 44: the runner replays from the
    // highest applied version, so leaving a later one recorded would make it
    // skip 44 and this rewind would silently test nothing.
    sqlite.prepare(`DELETE FROM _schema_versions WHERE version >= 44`).run();
  }

  it('back-fills a pre-existing legacy row at the LOWEST trust level, not `explicit`', () => {
    rewindToPre44();

    migrateDB(db); // migration 44 replays against the existing row

    const row = sqliteHandle(db)
      .prepare(`SELECT binding_origin, provider FROM conversation_instance_ownership WHERE conversation_id = ?`)
      .get('conv-legacy') as { binding_origin: string; provider: string | null };

    // 'explicit' claims a human chose this account. Nobody did.
    expect(row.binding_origin).not.toBe('explicit');
    expect(row.binding_origin).toBe('migrated-ambiguous');
    expect(row.provider).toBeNull();
  });

  it('stamps a narrow save() at the lowest trust level too, not `explicit`', async () => {
    await repo.save('conv-narrow', 'copilot:work');
    const row = sqliteHandle(db)
      .prepare(`SELECT binding_origin FROM conversation_instance_ownership WHERE conversation_id = ?`)
      .get('conv-narrow') as { binding_origin: string };
    expect(row.binding_origin).not.toBe('explicit');
  });

  it('is re-runnable: replaying migration 44 on an already-migrated DB is a no-op', async () => {
    await repo.saveBinding({ ...FULL_BINDING });
    const sqlite = sqliteHandle(db);
    // Every version from 44 up, not just 44: the runner replays from the
    // highest applied version, so leaving a later one recorded would make it
    // skip 44 and this rewind would silently test nothing.
    sqlite.prepare(`DELETE FROM _schema_versions WHERE version >= 44`).run();

    expect(() => migrateDB(db)).not.toThrow(); // duplicate-column tolerance

    const bindings = await repo.loadBindings();
    expect(bindings).toEqual([{ ...FULL_BINDING }]);
  });
});
