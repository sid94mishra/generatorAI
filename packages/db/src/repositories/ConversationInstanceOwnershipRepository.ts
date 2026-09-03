// ────────────────────────────────────────────────────────────────
// ConversationInstanceOwnershipRepository — persists conversation→provider
// INSTANCE ownership (W34 finger completion).
//
// `ConversationOwnershipRepository` (above) only ever recorded a driver
// TYPE ('copilot', 'claude-agent', …), which is the one-adapter-per-type
// ceiling this table exists to remove: two accounts of the same driver
// need their OWN conversation-ownership key, not a shared one. This is a
// deliberately separate table (not a repurposed column on the existing
// one) so single-account deployments — the common case — are completely
// unaffected: nothing here is consulted unless a conversation was actually
// routed to a specific `ProviderInstanceId`.
//
// Satisfies `ProviderInstanceRegistry`'s `ProviderInstanceStore` interface
// (agent-harness-providers/src/ProviderInstanceRegistry.ts) via structural
// typing — see that file's own doc comment for the field-name contract
// (`conversationId`/`instanceId`, not the historically-inverted names).
//
// B1 — the full binding now round-trips. Migration 44 added the six columns
// that carry the rest of `ProviderRuntimeBinding`, but for the whole of W34
// they had no writer and no reader: `save()`/`load()` touched three columns,
// so five of the binding's seven fields lived only in the registry's
// in-memory map and were lost on every restart. `saveBinding`/`loadBindings`
// below are that writer and reader; `ProviderInstanceRegistry` prefers them
// automatically (they are the optional half of `ProviderInstanceStore`).
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import type { ProviderInstanceId, ProviderWireProtocol } from '@generatorai/core';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';

/**
 * How a thread came to be bound to its instance. Mirrors `BindingOrigin` in
 * `@generatorai/agent-harness-providers` — duplicated rather than imported
 * because `@generatorai/db` does not (and must not) depend on the provider
 * package; the two meet through structural typing at the composition root.
 */
export type PersistedBindingOrigin = 'explicit' | 'migrated-unambiguous' | 'migrated-ambiguous';

/**
 * The lowest trust level: "this binding was inferred, not chosen."
 *
 * Used for migration 44's back-fill, for any row written through the narrow
 * `save()` path, and as the fallback for an unrecognised stored value. Never
 * assume `explicit` — that claims a human picked the account, and picking the
 * wrong account is how a thread resumes against credentials its owner never
 * selected.
 */
const LOWEST_TRUST_ORIGIN: PersistedBindingOrigin = 'migrated-ambiguous';

const BINDING_ORIGINS: ReadonlySet<string> = new Set<PersistedBindingOrigin>([
  'explicit',
  'migrated-unambiguous',
  'migrated-ambiguous',
]);

const WIRE_PROTOCOLS: ReadonlySet<string> = new Set<ProviderWireProtocol>([
  'claude-agent-sdk',
  'copilot-sdk',
  'codex-rpc',
  'opencode-http',
  'acp',
]);

/**
 * The persisted shape of one `ProviderRuntimeBinding`.
 *
 * `resumeCursor` and `runtimePayload` are OPAQUE: stored verbatim (the payload
 * as JSON) and never parsed for meaning here. They are only ever handed back
 * to the adapter that issued them, and only while `providerInstanceId` still
 * matches — a cursor belongs to the account that minted it.
 */
export interface PersistedProviderRuntimeBinding {
  threadId: string;
  provider: string;
  providerInstanceId: ProviderInstanceId;
  adapterKey: string;
  resumeCursor?: string;
  runtimePayload?: Readonly<Record<string, unknown>>;
  runtimeMode?: ProviderWireProtocol;
  bindingOrigin: PersistedBindingOrigin;
}

interface BindingRow {
  conversation_id: string;
  instance_id: string;
  provider: string | null;
  adapter_key: string | null;
  resume_cursor: string | null;
  runtime_payload: string | null;
  runtime_mode: string | null;
  binding_origin: string | null;
}

export class SqliteConversationInstanceOwnershipRepository {
  private readonly loadStmt: BetterSqlite3.Statement;
  private readonly loadBindingsStmt: BetterSqlite3.Statement;
  private readonly saveStmt: BetterSqlite3.Statement;
  private readonly saveBindingStmt: BetterSqlite3.Statement;
  private readonly removeStmt: BetterSqlite3.Statement;

  constructor(db: AppDatabase) {
    const sqlite = sqliteHandle(db);
    this.loadStmt = sqlite.prepare(
      `SELECT conversation_id, instance_id FROM conversation_instance_ownership`,
    );
    // Only rows that actually carry the full shape. A row with a null
    // `provider` predates it (or was written through the narrow `save()`
    // path), and reading it back as a binding would fabricate facts nobody
    // recorded — see `loadBindings` for why that matters.
    this.loadBindingsStmt = sqlite.prepare(
      `SELECT conversation_id, instance_id, provider, adapter_key, resume_cursor,
              runtime_payload, runtime_mode, binding_origin
         FROM conversation_instance_ownership
        WHERE provider IS NOT NULL AND adapter_key IS NOT NULL`,
    );
    this.saveStmt = sqlite.prepare(
      `INSERT INTO conversation_instance_ownership (conversation_id, instance_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         instance_id = excluded.instance_id,
         updated_at  = excluded.updated_at`,
    );
    // Every binding column is written on every save, including the nullable
    // ones. A partial UPDATE would leave the PREVIOUS account's cursor and
    // payload attached to a rebound thread, which is precisely the
    // cross-account replay W34 exists to prevent.
    this.saveBindingStmt = sqlite.prepare(
      `INSERT INTO conversation_instance_ownership
         (conversation_id, instance_id, updated_at, provider, adapter_key,
          resume_cursor, runtime_payload, runtime_mode, binding_origin)
       VALUES (@conversationId, @instanceId, @updatedAt, @provider, @adapterKey,
               @resumeCursor, @runtimePayload, @runtimeMode, @bindingOrigin)
       ON CONFLICT(conversation_id) DO UPDATE SET
         instance_id     = excluded.instance_id,
         updated_at      = excluded.updated_at,
         provider        = excluded.provider,
         adapter_key     = excluded.adapter_key,
         resume_cursor   = excluded.resume_cursor,
         runtime_payload = excluded.runtime_payload,
         runtime_mode    = excluded.runtime_mode,
         binding_origin  = excluded.binding_origin`,
    );
    this.removeStmt = sqlite.prepare(
      `DELETE FROM conversation_instance_ownership WHERE conversation_id = ?`,
    );
  }

  async load(): Promise<Array<{ conversationId: string; instanceId: string }>> {
    const rows = this.loadStmt.all() as Array<{ conversation_id: string; instance_id: string }>;
    return rows.map((r) => ({ conversationId: r.conversation_id, instanceId: r.instance_id }));
  }

  /**
   * Full-shape read, used by `ProviderInstanceRegistry.hydrate()`.
   *
   * Deliberately returns ONLY rows that have the full shape. Legacy rows are
   * left to `load()` so the registry's REV2 promotion rules still see them and
   * can decide — from the instances actually configured right now — whether
   * the row is unambiguous, ambiguous, or must stay unbound. Returning them
   * here with a manufactured `provider` would bypass that decision entirely.
   */
  async loadBindings(): Promise<PersistedProviderRuntimeBinding[]> {
    const rows = this.loadBindingsStmt.all() as BindingRow[];
    return rows.map((r) => {
      const binding: PersistedProviderRuntimeBinding = {
        threadId: r.conversation_id,
        provider: r.provider ?? '',
        providerInstanceId: r.instance_id as ProviderInstanceId,
        adapterKey: r.adapter_key ?? '',
        bindingOrigin: BINDING_ORIGINS.has(r.binding_origin ?? '')
          ? (r.binding_origin as PersistedBindingOrigin)
          : LOWEST_TRUST_ORIGIN,
      };
      if (r.resume_cursor !== null) binding.resumeCursor = r.resume_cursor;
      if (r.runtime_mode !== null && WIRE_PROTOCOLS.has(r.runtime_mode)) {
        binding.runtimeMode = r.runtime_mode as ProviderWireProtocol;
      }
      const payload = parsePayload(r.runtime_payload);
      if (payload) binding.runtimePayload = payload;
      return binding;
    });
  }

  async save(conversationId: string, instanceId: string): Promise<void> {
    this.saveStmt.run(conversationId, instanceId, Date.now());
  }

  /** Full-shape write. Every column is set, so a rebind cannot inherit a stale cursor. */
  async saveBinding(binding: PersistedProviderRuntimeBinding): Promise<void> {
    this.saveBindingStmt.run({
      conversationId: binding.threadId,
      instanceId: binding.providerInstanceId,
      updatedAt: Date.now(),
      provider: binding.provider,
      adapterKey: binding.adapterKey,
      resumeCursor: binding.resumeCursor ?? null,
      runtimePayload: binding.runtimePayload ? JSON.stringify(binding.runtimePayload) : null,
      runtimeMode: binding.runtimeMode ?? null,
      bindingOrigin: BINDING_ORIGINS.has(binding.bindingOrigin)
        ? binding.bindingOrigin
        : LOWEST_TRUST_ORIGIN,
    });
  }

  async remove(conversationId: string): Promise<void> {
    this.removeStmt.run(conversationId);
  }
}

/**
 * An unreadable payload must not take the whole hydrate down with it: one
 * corrupt row would otherwise strand every OTHER thread's binding, turning a
 * cosmetic defect into a server that cannot route anything. The binding still
 * loads; only the opaque payload is dropped.
 */
function parsePayload(raw: string | null): Readonly<Record<string, unknown>> | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
