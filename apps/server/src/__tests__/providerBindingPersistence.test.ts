// ────────────────────────────────────────────────────────────────
// W34 / B1 — the conversation→instance binding across a real restart.
//
// The two halves of this fix live in packages that cannot import each other:
// `SqliteConversationInstanceOwnershipRepository` (@generatorai/db) and
// `ProviderInstanceRegistry` (@generatorai/agent-harness-providers) meet only
// through structural typing, and only at the composition root. That is exactly
// how the original defect survived review — the registry had a full-shape read
// path, the migration had the columns, and nothing checked that the store in
// between implemented either side of the contract.
//
// So this test wires the REAL repository into the REAL registry over a REAL
// SQLite file, the way composition-root.ts does, and restarts the process
// state: close the connection, throw away the registry, reopen and hydrate.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDB,
  migrateDB,
  sqliteHandle,
  SqliteConversationInstanceOwnershipRepository,
  type AppDatabase,
} from '@generatorai/db';
import { ProviderInstanceRegistry } from '@generatorai/agent-harness-providers';
import { makeProviderInstanceId } from '@generatorai/core';
import type { IProviderInstance, ProviderInstanceId } from '@generatorai/core';

const WORK = makeProviderInstanceId('copilot:work');
const PERSONAL = makeProviderInstanceId('copilot:personal');

function instance(id: ProviderInstanceId, displayName: string): IProviderInstance {
  return {
    id,
    driverType: 'copilot',
    protocol: 'copilot-sdk',
    displayName,
    capabilities: {
      vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
      mcpServers: false, approvalGating: 'none', hostTools: 'none', structuredOutput: 'none', skills: 'none',
      sessionPersistence: false, budgetTracking: false,
    },
    enabled: true,
  };
}

let dir: string;
let dbPath: string;
let db: AppDatabase;

/** Boot a registry over the file, exactly as `composition-root.ts` does. */
async function boot(instances: IProviderInstance[]): Promise<ProviderInstanceRegistry> {
  db = createDB(dbPath);
  migrateDB(db);
  const registry = new ProviderInstanceRegistry(new SqliteConversationInstanceOwnershipRepository(db));
  for (const i of instances) registry.register(i);
  await registry.hydrate();
  return registry;
}

/** Shut the process state down: close the connection, drop the registry. */
function shutdown(): void {
  sqliteHandle(db).close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-binding-restart-'));
  dbPath = join(dir, 'w.db');
});

afterEach(() => {
  try {
    shutdown();
  } catch {
    /* already closed */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

describe('W34 — provider binding survives a server restart (B1)', () => {
  it('restores the full binding, not just the instance id', async () => {
    const first = await boot([instance(WORK, 'Copilot (work)'), instance(PERSONAL, 'Copilot (personal)')]);
    await first.assignConversation('conv-1', WORK);
    expect(first.bindingFor('conv-1')?.bindingOrigin).toBe('explicit');
    shutdown();

    const second = await boot([instance(WORK, 'Copilot (work)'), instance(PERSONAL, 'Copilot (personal)')]);

    // Every field, not just the two the old three-column store carried.
    expect(second.bindingFor('conv-1')).toEqual({
      threadId: 'conv-1',
      provider: 'copilot',
      providerInstanceId: WORK,
      adapterKey: 'copilot',
      runtimeMode: 'copilot-sdk',
      bindingOrigin: 'explicit',
    });
    expect(second.resolveForConversation('conv-1')?.id).toBe(WORK);
  });

  it('a thread bound to a since-deleted account still refuses to route after a restart', async () => {
    const first = await boot([instance(WORK, 'Copilot (work)'), instance(PERSONAL, 'Copilot (personal)')]);
    await first.assignConversation('conv-1', WORK);
    shutdown();

    // The user removed the "work" account while the server was down, so it is
    // not registered on the next boot.
    const second = await boot([instance(PERSONAL, 'Copilot (personal)')]);

    // The acceptance criterion, across a restart: the thread must remain
    // distinguishable from a never-bound one, or it silently resumes against
    // the surviving account. With only the narrow store this row promoted to
    // `personal` — the exact cross-account fallback W34 forbids.
    expect(second.orphanedBindingFor('conv-1')).toEqual({
      binding: expect.objectContaining({ providerInstanceId: WORK }),
      missingInstanceId: WORK,
    });
    expect(second.resolveForConversation('conv-1')).toBeUndefined();
    expect(second.orphanedBindingFor('never-bound')).toBeNull();
  });

  it('clearing a binding survives the restart too', async () => {
    const first = await boot([instance(WORK, 'Copilot (work)')]);
    await first.assignConversation('conv-1', WORK);
    first.clearBinding('conv-1'); // thread deleted, or rebound after an orphan
    shutdown();

    const second = await boot([instance(WORK, 'Copilot (work)')]);
    expect(second.bindingFor('conv-1')).toBeUndefined();
  });

  it('promotes a pre-W34 row written by the narrow path, at the persistence boundary', async () => {
    // Simulate a database written before the full shape existed: the narrow
    // `save()` is precisely what the old code called.
    db = createDB(dbPath);
    migrateDB(db);
    await new SqliteConversationInstanceOwnershipRepository(db).save('conv-legacy', 'copilot:gone');
    shutdown();

    const registry = await boot([instance(WORK, 'Copilot (work)')]);

    // Exactly one copilot instance is configured, so REV2 says bind — and say
    // that it was inferred.
    expect(registry.bindingFor('conv-legacy')).toMatchObject({
      providerInstanceId: WORK,
      bindingOrigin: 'migrated-unambiguous',
    });
  });
});
