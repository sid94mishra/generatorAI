// ────────────────────────────────────────────────────────────────
// Frozen schema of migration v60 `agent_integration` (RV-33).
//
// The table and columns v60 adds, as the DDL it runs. Migration code never
// imports `schema.ts`: this file is the migration's own copy and is pinned
// by `migrations.lock.json` (one of v60's `lockFiles`). Never edit it; a
// later schema change is a new migration.
// ────────────────────────────────────────────────────────────────

/**
 * A run a chat (or an orchestrator chat) started through the workflow tools
 * (P06 WP-6.2): the chat's run cards survive a reload and a restart, and the
 * per-chat concurrency cap counts these. `tool_call_id` is the harness tool
 * call that started it (the idempotency key's tail). Timestamps in ms.
 */
export const CHAT_WORKFLOW_RUNS_DDL = `CREATE TABLE chat_workflow_runs (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, run_id)
)`;

export const CHAT_WORKFLOW_RUNS_INDEXES = [`CREATE INDEX idx_chat_workflow_runs_run ON chat_workflow_runs(run_id)`] as const;

/**
 * The principal that created a chat, as JSON `{kind, id, scopes}` (P06
 * WP-6.2). In-process workflow tools act for it: its scopes gate
 * `run_workflow` (`exec:agent`) and `create_workflow_draft`
 * (`write:workflows`). NULL for chats created before v60.
 */
export const CHATS_CREATED_BY_PRINCIPAL_SQL = `ALTER TABLE chats ADD COLUMN created_by_principal TEXT`;

/**
 * Who authored a definition, as JSON (P06 WP-6.5): an agent-authored draft
 * records the chat, orchestrator, stage or external agent that submitted it.
 * NULL means a person (the builder, an import, a template).
 */
export const WORKFLOW_DEFINITIONS_AUTHORED_BY_SQL = `ALTER TABLE workflow_definitions ADD COLUMN authored_by TEXT`;
