# 05 — DB + shared (`packages/db` + `packages/shared`)

Detailed implementation plan for the 2 Critical + 7 High findings across sections F (Database) and G (Shared) of [../CODE_REVIEW.md](../CODE_REVIEW.md).

---

## Database

### [CRITICAL] No transactions anywhere — `packages/db/src/repositories/*`

**Issue.** Multi-step writes (create run + N stage runs + emit events; onStageCompleted cascading status updates; automation execution + iteration runs) are sequences of auto-commit statements. Mid-sequence failure leaves partial state.

**Fix.**
1. **Transaction helper on `AppDatabase`** (`packages/db/src/index.ts`):
   ```ts
   export function createDB(dbPath: string) {
     const sqlite = new Database(dbPath, /*…*/);
     // pragmas…
     const drizzleDb = drizzle(sqlite, { schema });
     return Object.assign(drizzleDb, {
       async transaction<T>(fn: (tx: typeof drizzleDb) => Promise<T>): Promise<T> {
         const sqlite = (drizzleDb as any).session.client as Database.Database;
         sqlite.exec('BEGIN');
         try { const r = await fn(drizzleDb); sqlite.exec('COMMIT'); return r; }
         catch (e) { sqlite.exec('ROLLBACK'); throw e; }
       },
     });
   }
   ```
   (Better-sqlite3 transactions are synchronous; above wrapper lets async callers batch their awaits but all writes flush before COMMIT. Acceptable for single-writer SQLite.)
2. **Call sites requiring wrapping** (Phase 0 scope):
   - `WorkflowRunService.createRun` — run row + N stage_run rows + `workflow_run.created` event persisted via EventBus.
   - `WorkflowRunService.onStageCompleted` — stage_run update + skipped stages + run final update.
   - `WorkflowRunService.onStageFailed` — stage_run update + run update.
   - `StageExecutionService.executeStage` — stage_run running → stage_run completed + chat_messages inserts + artifact rows.
   - `AutomationService.executeAutomation` — execution row + per-iteration `automation_execution_runs` + workflow_run creates.
3. **EventBus + transaction coordination.** EventBus's `emit` must participate: when called inside a transaction scope, the insert into `events` goes in the same tx. Simplest approach: inject tx context via AsyncLocalStorage or thread it explicitly; cleanest is explicit — have services pass the tx to EventBus or queue events and flush after commit. Recommended: services use `db.transaction(async tx => { /* writes */; /* event emit after commit via local collector */ })` to avoid half-emitted events.

**Effort:** M. **Ripple.** Every repository stays single-statement but accepts the wider transaction. Services own transaction boundaries. Tests need integration-level verification of rollback.

### [CRITICAL] In-memory sequence counter race across processes — `EventRepository.ts:12-13, 103-132`

**Issue.** `globalSequence` held in-process. Two processes race on `INSERT INTO events (session_id, sequence_id, …)`; both read `max=100`, both try to insert `101` → UNIQUE index violation, or worse, interleaved inconsistent order.

**Fix.**
1. **New table** `event_sequences(session_id PK, next_sequence INT NOT NULL DEFAULT 1)`.
2. **SQL-allocated via UPDATE … RETURNING** — atomic:
   ```sql
   UPDATE event_sequences SET next_sequence = next_sequence + 1 WHERE session_id = ? RETURNING next_sequence;
   ```
   If 0 rows affected (row doesn't exist): `INSERT INTO event_sequences (session_id, next_sequence) VALUES (?, 2)` and return 1. Handle `UNIQUE` race on the INSERT by recursing (another process just initialized).
3. **New port** `ISequenceAllocator { allocateSequence(sessionId): Promise<number> }`. Drizzle impl `DrizzleSequenceAllocator`.
4. **Wire into EventBus** — new constructor arg; remove in-memory counter from EventRepository; `insert()` now expects sequence_id to be pre-allocated by the caller (EventBus).
5. **Boot migration** — on first run after deploy, seed `event_sequences` from existing max values per session.

**Effort:** M. **Deps:** 1.1 migrations for the new table. **Acceptance:** two concurrent Node processes hitting the same DB each call `allocateSequence('s1')` 1000× in parallel — no UNIQUE violations; total allocations = 2000; all distinct.

### [HIGH] Missing indexes — `packages/db/src/schema.ts`

**Fix.** Add to schema + migration:
- `idx_chat_messages_chat_id` on `(chat_id)`
- `idx_webhook_deliveries_registration` on `(registration_id)`
- `idx_webhook_deliveries_status` on `(status)`
- `idx_workflow_runs_status_created` on `(status, created_at)`
- `idx_stage_runs_status_created` on `(status, created_at)`

**Effort:** S. **Acceptance:** `EXPLAIN QUERY PLAN` on "recent failed runs" uses the composite index.

### [HIGH] JSON columns unvalidated against TS types — `schema.ts` (variables, hooks, metadata, etc.)

**Fix.**
1. Define per-column Zod schemas in `packages/shared/src/schemas/DatabaseSchemas.ts` (WorkflowRunVariables, StageDefinitionVariables, CopilotConfig, HooksArray, ChatMessageMetadata, OrchestratorConfig, AutomationDataSourceConfig, etc.).
2. In each repository's `mapRow` (or create one if missing): `const variables = WorkflowRunVariablesSchema.parse(row.variables ?? {})`. Log (and surface to ops) when parse fails; optionally fall back to default + mark row for manual repair.
3. On write paths, validate before insert too — prevents malformed data from entering via buggy services.

**Effort:** M.

### [HIGH] `migrateDB` runs every boot on potentially massive tables — `packages/db/src/index.ts:76-446`

**Fix.**
1. `_schema_versions(version INT PK, applied_at INT NOT NULL)` table.
2. Rewrite `migrateDB` as numbered migration blocks:
   ```ts
   const migrations = [
     { version: 1, name: 'initial_schema', sql: [ /* current v1 CREATE TABLEs */ ] },
     { version: 2, name: 'v2_tables', sql: [ /* CREATE TABLEs for chats, workflow_definitions, … */ ] },
     { version: 3, name: 'missing_indexes', sql: [ /* indexes from finding F.H1 */ ] },
     { version: 4, name: 'event_sequences', sql: [ /* table for finding F.C2 */ ] },
     { version: 5, name: 'session_allocations', sql: [ /* finding A.C4 */ ] },
     …
   ];
   const currentVersion = sqlite.prepare('SELECT COALESCE(MAX(version), 0) as v FROM _schema_versions').get().v;
   for (const m of migrations) if (m.version > currentVersion) {
     for (const stmt of m.sql) sqlite.exec(stmt);
     sqlite.prepare('INSERT INTO _schema_versions (version, applied_at) VALUES (?, ?)').run(m.version, Date.now());
   }
   ```
3. Keep the existing idempotent `addColumnIfNotExists` helper available for ALTER cases within a migration.
4. Future schema changes append a new version; existing deployments catch up automatically.

**Effort:** M. **Acceptance:** first boot post-deploy applies all migrations; second boot performs zero DDL.

---

## Shared

### [HIGH] `deepMerge` no cycle detection — `utils/index.ts:16-44`

**Fix.** Pass a `WeakSet<object>` through recursion; if either `target` or `source` is already in the set, return `target` unchanged. Handles the edge case without changing the public API.

**Effort:** S.

### [HIGH] Batch parser limits hardcoded — `utils/batchDataParser.ts:9, 12`

**Fix.**
1. New `BatchParserConfigSchema` in `packages/shared/src/config/`. `maxRowCount` default 10 000, `maxColumnCount` default 100.
2. `parseBatchData(format, data, config = DEFAULT)` threads config into parsers.
3. Composition roots load overrides from env (`BATCH_MAX_ROWS`, `BATCH_MAX_COLS`) and pass into `AutomationService` / `DataSourceResolver`.

**Effort:** S.

### [HIGH] Logger redaction list misses fields — `logging/Logger.ts:18`

**Fix.** Expand: `['*.apiKey', '*.token', '*.secret', '*.password', '*.bearerToken', '*.accessToken', '*.refreshToken', '*.cookie', '*.csrf_token', '*.csrfToken', '*.aws_secret_access_key', '*.awsSecretAccessKey', '*.private_key_pem', '*.privateKeyPem', '*.authorization', '*.x-api-key']`.

For defense in depth, add pattern-based redaction via Pino's `redact: { paths, censor }` with a `censor` function that scans string values for JWT-like patterns (`eyJ…`) and Bearer prefixes.

**Effort:** S.

### [HIGH] `AgentEvent` hand-maintained discriminated union — `types/AgentEvent.ts`

**Fix.** Single source of truth via `EVENT_REGISTRY`:

```ts
// packages/shared/src/types/EventRegistry.ts
import { z } from 'zod';

export const EVENT_REGISTRY = [
  { kind: 'copilot.token' as const,              dataSchema: z.object({ text: z.string() }) },
  { kind: 'copilot.message_complete' as const,   dataSchema: z.object({ content: z.string() }) },
  { kind: 'copilot.tool_start' as const,         dataSchema: z.object({ tool: z.string(), args: z.unknown(), callId: z.string().nullable() }) },
  { kind: 'copilot.tool_complete' as const,      dataSchema: z.object({ callId: z.string().nullable(), tool: z.string(), result: z.unknown(), success: z.boolean() }) },
  { kind: 'copilot.usage' as const,              dataSchema: z.object({ model: z.string().optional(), inputTokens: z.number().optional(), outputTokens: z.number().optional(), cost: z.number().optional(), durationMs: z.number().optional() }) },
  { kind: 'workflow_run.created' as const,       dataSchema: z.object({ workflowRunId: z.string(), name: z.string(), workflowDefinitionId: z.string() }) },
  { kind: 'workflow_run.completed' as const,     dataSchema: z.object({ workflowRunId: z.string() }) },
  { kind: 'stage_run.started' as const,          dataSchema: z.object({ stageRunId: z.string(), workflowRunId: z.string() }) },
  // … all ~50 kinds
] as const;

export type AgentEvent = {
  [K in typeof EVENT_REGISTRY[number] as K['kind']]: { kind: K['kind']; data: z.infer<K['dataSchema']> };
}[typeof EVENT_REGISTRY[number]['kind']];

export type AgentEventKind = typeof EVENT_REGISTRY[number]['kind'];

export function getEventSchema(kind: AgentEventKind): z.ZodTypeAny { /* lookup */ }
export function parseEventData(kind: AgentEventKind, data: unknown) { return getEventSchema(kind).parse(data); }
export function createAgentEvent<K extends AgentEventKind>(kind: K, data: Extract<AgentEvent,{kind:K}>['data']): Extract<AgentEvent,{kind:K}> { /* validated constructor */ }
```

**Consumers to update:**
1. `packages/copilot-bridge/src/event-mapper.ts` — use `createAgentEvent(kind, data)` instead of plain object literals.
2. `packages/core/src/services/StageExecutionService.ts` — also the enrichment helper (ties to A's unsafe-cast fix).
3. `apps/web/src/stores/sseManager.ts` — import `parseEventData` for incoming SSE; `getEventData` helper for typed access (ties to 03's Critical #1).
4. `packages/core/src/events/EventBus.ts` — validate on `emit` call; throw on shape mismatch so the bug is caught at emission, not at consumption.

**Predicates** (`isCopilotEvent`, `isWorkflowEvent`, etc.): derive from a small `EVENT_CATEGORY_PREDICATES` table keyed by prefix.

**Effort:** L (2–3 days). Worth it — ~50 event kinds × 3 downstream consumers means this finding is a bug-factory; registry pays back on every future event kind added.

---

## Landing sequence within Phase 1

1. **1.1 versioned migrations** first — everything else wants new tables/indexes.
2. **1.2 indexes** — free win, land before transaction and sequence work for perf baseline.
3. **0.4 transactions + 0.5 sequence allocator** — they touch the same call sites (`EventBus`, run/stage repos). Merge PRs together.
4. **1.6 SessionAllocator persistence** — depends on (1.1) migrations.
5. **JSON validation (F.H2)** can land incrementally — one repo at a time.
6. **2.17 EVENT_REGISTRY** — largest shared refactor; do after 0.x security so test coverage is stable, coordinate with 1.15 (web `getEventData`).
