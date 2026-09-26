// ────────────────────────────────────────────────────────────────
// P03 WP-3.5/3.6 — the engine's turn journal, lock and ownership on a real
// SQLite:
//   - a turn is settled only by its settlement row, written with its
//     assistant message (complete = 1) in one transaction; an intent alone
//     is "in flight" whatever it streamed (RV-10);
//   - the single-engine lock refuses a second live engine and is taken over
//     only once its heartbeat is stale (RV-27);
//   - a forced ownership claim bumps the epoch and fences the old owner.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDB, createDB, createEngineStores, migrateDB, type AppDatabase } from '../index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});
const raw = (db: AppDatabase): Database.Database => (db as unknown as { session: { client: Database.Database } }).session.client;
const T = 1_800_000_000_000;

function setup() {
  const db = createDB(':memory:');
  open.push(db);
  migrateDB(db);
  const s = raw(db);
  s.prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES ('sess', 's', 'active', ?, ?, 'conv', 'stage_run', 'i')`).run(T, T);
  s.prepare(`INSERT INTO workflow_definitions (id, name, spec, created_at, updated_at) VALUES ('d', 'D', '{}', ?, ?)`).run(T, T);
  s.prepare(`INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at) VALUES ('v', 'd', 1, 'h', 'published', '{}', ?)`).run(T);
  s.prepare(
    `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, status, permission_mode, root_run_id, created_at, updated_at)
     VALUES ('r', 'd', 'v', 'Run', 'running', 'default', 'r', ?, ?)`,
  ).run(T, T);
  return { s, stores: createEngineStores(db) };
}

const msg = (role: 'user' | 'assistant', content: string) => ({
  id: `${role}-${content}`,
  sessionId: 'sess',
  role,
  content,
  turnRole: 'prompt' as const,
  metadata: { stageRunId: 'i' },
  complete: true,
});

describe('turn journal (RV-10)', () => {
  it('intent → in flight; settle writes the settlement and the complete message together', () => {
    const { s, stores } = setup();
    stores.turns.intent('i', 'a1/prompt/0', { role: 'prompt', policy: 'never', now: T, message: msg('user', 'do it') });
    expect(stores.turns.get('i', 'a1/prompt/0')).toMatchObject({ state: 'intent', policy: 'never' });
    expect(stores.turns.inFlight('i', 'a1/')).toEqual([{ opId: 'a1/prompt/0', role: 'prompt', policy: 'never' }]);
    // A partial answer never settles the turn.
    stores.turns.recordPartial(msg('assistant', 'half'), T + 1);
    expect(stores.turns.inFlight('i', 'a1/')).toHaveLength(1);

    stores.turns.settle('i', 'a1/prompt/0', { role: 'prompt', content: 'done' }, { now: T + 2, message: msg('assistant', 'done') });
    expect(stores.turns.get('i', 'a1/prompt/0')).toMatchObject({ state: 'settled', turn: { content: 'done' } });
    expect(stores.turns.inFlight('i', 'a1/')).toEqual([]);
    expect(s.prepare(`SELECT role, content, complete, turn_role FROM chat_messages ORDER BY rowid`).all()).toEqual([
      { role: 'user', content: 'do it', complete: 1, turn_role: 'prompt' },
      { role: 'assistant', content: 'half', complete: 0, turn_role: 'prompt' },
      { role: 'assistant', content: 'done', complete: 1, turn_role: 'prompt' },
    ]);
  });

  it('a failing message insert leaves the turn unsettled (one transaction)', () => {
    const { stores } = setup();
    stores.turns.intent('i', 'a1/prompt/0', { role: 'prompt', policy: 'safe', now: T });
    const orphan = { ...msg('assistant', 'x'), sessionId: 'no-such-session' };
    expect(() => stores.turns.settle('i', 'a1/prompt/0', { role: 'prompt', content: 'x' }, { now: T, message: orphan })).toThrow();
    expect(stores.turns.get('i', 'a1/prompt/0')).toMatchObject({ state: 'intent' });
  });

  it('discard and release retract the journal; prefixes separate epochs', () => {
    const { stores } = setup();
    stores.turns.intent('i', 'a1/prompt/0', { role: 'prompt', policy: 'never', now: T });
    stores.turns.intent('i', 'a3/prompt/0', { role: 'prompt', policy: 'never', now: T });
    expect(stores.turns.inFlight('i', 'a3/').map((t) => t.opId)).toEqual(['a3/prompt/0']);
    stores.turns.discard('i', 'a3/prompt/0');
    expect(stores.turns.get('i', 'a3/prompt/0')).toBeNull();
    stores.turns.release('i');
    expect(stores.turns.get('i', 'a1/prompt/0')).toBeNull();
  });
});

describe('single-engine lock and run ownership (RV-27)', () => {
  it('a second live engine is refused; a stale lock is taken over; renew and release are the holder\'s', () => {
    const { stores } = setup();
    expect(stores.lock.acquire('host-a', 'boot-a', T, 30_000)).toBe(true);
    expect(stores.lock.acquire('host-b', 'boot-b', T + 10_000, 30_000)).toBe(false);
    expect(stores.lock.acquire('host-a', 'boot-a', T + 10_000, 30_000)).toBe(true); // the holder again
    expect(stores.lock.renew('boot-b', T + 20_000)).toBe(false);
    expect(stores.lock.renew('boot-a', T + 20_000)).toBe(true);
    expect(stores.lock.acquire('host-b', 'boot-b', T + 50_001, 30_000)).toBe(true); // stale: 30 s without a beat
    expect(stores.lock.get()).toMatchObject({ ownerId: 'host-b', bootId: 'boot-b' });
    stores.lock.release('boot-a');
    expect(stores.lock.get()?.bootId).toBe('boot-b');
    stores.lock.release('boot-b');
    expect(stores.lock.acquire('host-c', 'boot-c', T + 50_002, 30_000)).toBe(true);
  });

  it('a forced claim bumps the epoch; the old owner can no longer renew or apply', () => {
    const { stores } = setup();
    const e1 = stores.runs.claimOwnership('r', 'boot-a', 60_000, T)!;
    expect(stores.runs.claimOwnership('r', 'boot-b', 60_000, T + 1)).toBeNull();
    const e2 = stores.runs.claimOwnership('r', 'boot-b', 60_000, T + 1, { force: true })!;
    expect(e2).toBe(e1 + 1);
    expect(stores.runs.renewOwnership('r', 'boot-a', e1, 60_000, T + 2)).toBe(false);
    expect(stores.runs.renewOwnership('r', 'boot-b', e2, 60_000, T + 2)).toBe(true);
    expect(stores.runStore.apply('r', e1, [{ t: 'run_patch', patch: { statusReason: 'x' } }], { now: T + 3 })).toMatchObject({ ok: false, reason: 'fenced' });
  });
});
