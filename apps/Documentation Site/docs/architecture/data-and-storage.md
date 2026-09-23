---
title: Data and storage
description: SQLite repositories, execution files, migrations, event retention, and recovery boundaries.
---

# Data and storage

GeneratorAI stores structured application state in SQLite and execution/provider assets on disk. These two layers have different lifecycles. Deleting a conversation is not equivalent to removing every provider cache, and copying a database file alone does not copy source repositories, workspace files, or the secret vault.

## Database implementation

`packages/db/src/index.ts` opens `better-sqlite3`, wraps it with Drizzle, enables WAL journaling, uses `synchronous = NORMAL`, enables foreign keys, and sets a busy timeout. WAL improves concurrent reads while writes remain serialized on the SQLite connection.

The `createDB` factory accepts a path or a driver/URL configuration. `postgres://` and `libsql://` are recognized inputs but currently throw a “not yet wired” error. They are future driver seams, not operational deployment options.

The asynchronous `withTransaction` facade serializes transactions over the synchronous database connection and applies a deadline. Services use it for related multi-row writes. An async-shaped API does not turn SQLite into a multi-writer distributed database.

## Main persistence groups

| Group | Principal tables / records | Services and repositories |
| --- | --- | --- |
| Conversation | `chats`, `sessions`, `chat_messages` | Chat/session/message repositories; ChatManagementService and SessionService |
| Workflow definitions | `workflow_definitions`, `stage_definitions`, `stage_edges` | WorkflowDefinitionService and definition repositories |
| Workflow execution | `workflow_runs`, `stage_runs`, `session_allocations`, `stage_session_maps` | WorkflowRunService, StageExecutionService, SessionAllocator |
| Automation | `automations`, `automation_executions`, `automation_execution_runs`, `idempotency_keys` | AutomationService and AutomationRecoveryService |
| Projects | `projects`, `project_codebases`, `project_configs`, `system_configs`, `worktrees` | ProjectService, CodebaseService, ProjectConfigService, WorktreeService |
| Execution files | `execution_workspaces`, `workspace_mounts`, `workspace_artifacts`, `artifacts` | WorkspaceManager, MountService, ArtifactService |
| File state and feedback | `checkpoints`, `review_threads`, `review_comments`, `workspace_file_reviews` | CheckpointService, review service and file-review repository |
| Human decisions | `plan_documents`, `plan_revisions`, `plan_comments`, `agent_interactions` | PlanService, AgentInteractionService, HITL handling |
| Agents and extensions | `agents`, `widget_instances` | AgentService, WidgetService |
| Computer use | `computer_use_grants`, `computer_use_audit` | PendingConsentStore, ComputerService |
| Streams | `stream_cursors`, `stream_sequences`, `stream_meta` | StreamBroker and StreamCursorRepository |
| Durable operations | `registers`, `entries`, `usage_ledger` | DurableExecutionEngine and repositories |
| Provider ownership | `harness_instances`, `conversation_ownership`, `conversation_instance_ownership` | Provider instance registry and MultiHarness |
| Device/security | Device/credential/grant/nonce/replay/ticket/service-account tables, scope requests, audit, relay revocation outbox | Auth repositories and security context |
| Notifications/webhooks | Push tokens, webhook registrations and deliveries | Push dispatcher, WebhookService |

The schema and raw SQL migrations both matter: security and newer durable records are not all represented by the same exported Drizzle table list. The authoritative files are `packages/db/src/schema.ts`, `packages/db/src/migrations/index.ts`, and `packages/db/src/repositories/`.

Legacy `workflows`, `events`, and `event_sequences` remain for compatibility. New workflow execution uses definitions plus runs; the live server's unified stream uses `stream_cursors`. The EventBus can still write the legacy event log when explicitly enabled or when an embedded caller has no unified durable store.

## Migrations and schema validation

`migrateDB` applies numbered migrations using the `_schema_versions` ledger. The inspected migration set reaches version **54**; this number describes this source snapshot and should not be hard-coded by a client. Startup migration order and schema convergence are tested in the database package.

Repositories validate JSON writes and parse JSON reads through `validateJsonColumn` and `safeJsonColumn` helpers. A malformed persisted field should become a diagnosed invalid value rather than an unhandled JSON parse failure across an entire page.

Database maintenance scripts are exposed at the root for backup, reclamation, schema generation/checking, reset, and distribution preparation. Use the operations documentation and inspect the script before a destructive reset; migrations are not a promise that every alpha downgrade is supported.

## Files and effective paths

| Data | Owner / location rule |
| --- | --- |
| SQLite file | `DB_PATH` or effective server/desktop configuration; source-mode default in `packages/db/data/generatorai.db` |
| Managed workspaces | `WORKSPACES_DIR`; source entry point defaults to `~/.generatorai/workspaces` |
| General artifacts | `ARTIFACTS_DIR`; source entry point defaults to `~/.generatorai/artifacts` |
| Built-in templates | `TEMPLATES_DIR`; source entry point resolves repository `templates/` |
| User extensions | `GENERATORAI_EXTENSIONS_DIR` / effective extension configuration |
| Secret material | Secret store rooted from configured security data directory; `secrets/secrets.vault.json` plus selected key-provider material |
| Source mounts | User directory for in-place mode, or managed worktree/generated directory |
| Checkpoints | Workspace-private shadow stores under `.checkpoints/` for mounts |
| Workflow uploads | Managed workspace `config/` when available; legacy artifact fallbacks for older paths |
| Provider history/cache | Provider-owned runtime home/config directory; per-instance homes can isolate accounts |
| MCP settings | Server-side settings store associated with the database directory; credentials remain vault references |

Desktop startup supplies its own effective paths. Do not infer actual deployed paths from a source-mode default or assume that every directory is relocated by one environment variable. The configuration reference documents the relevant settings.

## Streams and retention

`StreamWriteBatcher` batches durable event inserts; `StreamBroker` waits for commit before fan-out. Stream sequence spaces are independent for `session`, `run`, `chat`, and `global`, and database identity persists across process restarts.

Retention is finite. If a reconnect cursor has expired or the bounded replay cannot cover it, the server reports that the client must resnapshot. It must not silently claim the missing range was delivered. `EventRetentionService` owns retention of event data; workspace retention is a different service and policy.

The optional `DeltaLog` currently **duplicates** delta writes into files when enabled. Replay still reads SQL. It is not a replacement event store or a completed disk-usage optimization.

## Recovery and consistency

The server wires recovery services for interrupted turns, running sessions, pending workflow post-processing, automation executions, durable iterations, and orphan resources. Recovery completes before scheduled automation starts. This ordering prevents a newly scheduled execution from racing unreconciled prior work.

Recovery does not imply exactly-once external side effects. Durable operation records distinguish committed intent from settlement and apply replay policy. A non-repeatable effect without a settlement can be returned as an uncertain/synthetic error instead of executed twice. See [Execution and durability](./execution.md).

## Backup and restore boundary

A useful installation backup needs a consistent database backup, managed artifacts/workspaces that matter, and the matching secret vault/key strategy. In-place source trees need their own backup policy. The vault cannot be recovered merely by copying the database; losing its key can invalidate credentials and host identity.

Restore into a separate installation before replacing live state. Validate the schema version, readable secret backend, workspace paths, provider readiness, and stream identity behavior. Be especially deliberate about resuming enabled automations after a restore.

## Source evidence

- `packages/db/src/index.ts`, `schema.ts`, and `migrations/index.ts`
- `packages/db/src/services/EventRetentionService.ts`
- `packages/core/src/services/WorkspaceManager.ts`, `WorkspaceRetentionService.ts`, and `MountService.ts`
- `packages/core/src/services/StreamBroker.ts`, `StreamWriteBatcher.ts`, and `DeltaLog.ts`
- `apps/server/src/index.ts` and `apps/server/src/composition-root.ts`

Continue with [Workspaces](./workspaces.md), [Execution](./execution.md), or [Configuration](../reference/configuration.md).
