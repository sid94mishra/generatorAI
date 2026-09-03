// ────────────────────────────────────────────────────────────────
// ConversationOwnershipRepository — persists conversation→harnessType ownership
// so that multi-harness routing survives a server restart.
//
// P1-42 fix (W34): MultiHarness was created with `store: undefined`, meaning
// ownership was in-memory only and lost on restart. Every restart then routed
// previously-created conversations to the wrong (primary) provider, causing
// "session id not found" errors on providers that did not create them.
//
// The table is intentionally minimal: conversationId → harnessType TEXT pair.
// There is no foreign key to `chats` — a harness conversation may exist without
// a DB chat row (e.g. background agent tasks), and cascade deletes would silently
// lose routing for those.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';

/**
 * Satisfies the {@link ConversationOwnershipStore} interface declared in
 * MultiHarness.ts (agent-harness-providers). TypeScript structural typing
 * matches these at the call site without an import that would create a cycle.
 */
export class SqliteConversationOwnershipRepository {
  // W34-M4: All statements prepared once in the constructor, not per-call.
  // Phase 0 fixed this pattern in StreamCursorRepository (P0-2); re-introducing
  // it here would silently undo that work. Statement caches are pinned by
  // object-identity: DO NOT inline prepare() calls into individual methods.
  private readonly loadStmt: BetterSqlite3.Statement;
  private readonly saveStmt: BetterSqlite3.Statement;
  private readonly removeStmt: BetterSqlite3.Statement;

  constructor(db: AppDatabase) {
    const sqlite = sqliteHandle(db);
    /* W34-M4 */ this.loadStmt = sqlite.prepare(
      `SELECT conversation_id, harness_type FROM conversation_ownership`,
    );
    /* W34-M4 */ this.saveStmt = sqlite.prepare(
      `INSERT INTO conversation_ownership (conversation_id, harness_type, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         harness_type = excluded.harness_type,
         updated_at   = excluded.updated_at`,
    );
    /* W34-M4 */ this.removeStmt = sqlite.prepare(
      `DELETE FROM conversation_ownership WHERE conversation_id = ?`,
    );
  }

  // ── ConversationOwnershipStore interface (MultiHarness routing) ──
  // Returns { conversationId, harnessType } — consumed by MultiHarness.hydrate()
  // to restore the conversation→provider routing map after a server restart.
  // The `harness_type` column stores the HarnessType string (e.g. 'claude-agent').
  //
  // Note: ProviderInstanceRegistry.ProviderInstanceStore uses a SEPARATE interface
  // with { conversationId, instanceId } fields. That store is satisfied by
  // `SqliteConversationInstanceOwnershipRepository` (its own table,
  // `conversation_instance_ownership`), not this class — see that file.

  async load(): Promise<Array<{ conversationId: string; harnessType: string }>> {
    const rows = this.loadStmt.all() as Array<{ conversation_id: string; harness_type: string }>;
    return rows.map((r) => ({ conversationId: r.conversation_id, harnessType: r.harness_type }));
  }

  async save(conversationId: string, harnessType: string): Promise<void> {
    this.saveStmt.run(conversationId, harnessType, Date.now());
  }

  async remove(conversationId: string): Promise<void> {
    this.removeStmt.run(conversationId);
  }
}
