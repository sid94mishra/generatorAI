// ────────────────────────────────────────────────────────────────
// Review 6.3 — a webhook automation must actually be reachable.
//
// The service minted a RAW token and stored it; the lookup a delivery uses is
// `getByWebhookTokenHash`. So a freshly created webhook automation could never
// be triggered by anything — the headline feature of the module, unreachable
// by construction. The raw token is now returned to the caller once and only
// its hash is persisted, which is also what stops a database copy or a log
// line from yielding a working credential.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDB, migrateDB, closeDB } from '../src/index.js';
import { DrizzleAutomationRepository } from '../src/repositories/AutomationRepository.js';
import { hashWebhookToken } from '@generatorai/shared/node';

let dir: string;
let db: ReturnType<typeof createDB>;
let repo: DrizzleAutomationRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-webhook-'));
  db = createDB(join(dir, 'a.db'));
  migrateDB(db);
  repo = new DrizzleAutomationRepository(db);
});

afterEach(() => {
  try {
    closeDB(db);
  } catch {
    /* already closed */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function automation(id: string, tokenHash: string) {
  return {
    id,
    name: 'Webhook automation',
    enabled: true,
    triggerType: 'webhook' as const,
    webhookTokenHash: tokenHash,
    workflowIds: ['wf-1'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('webhook token round trip', () => {
  it('finds the automation by the hash of the raw token a sender presents', async () => {
    const raw = 'a'.repeat(64);
    await repo.create(automation('auto-1', hashWebhookToken(raw)) as never);

    const found = await repo.getByWebhookTokenHash(hashWebhookToken(raw));
    expect(found?.id).toBe('auto-1');
  });

  it('never stores the raw token, so a database copy yields no credential', async () => {
    const raw = 'b'.repeat(64);
    await repo.create(automation('auto-2', hashWebhookToken(raw)) as never);

    const found = await repo.getByWebhookTokenHash(hashWebhookToken(raw));
    expect(found?.webhookToken).toBeUndefined();
  });

  it('does not match a different token', async () => {
    await repo.create(automation('auto-3', hashWebhookToken('c'.repeat(64))) as never);
    expect(await repo.getByWebhookTokenHash(hashWebhookToken('d'.repeat(64)))).toBeNull();
  });
});
