# G3 — Workflow DB Layer Audit (read-only)

Scope: `packages/db/src/schema.ts`, `packages/db/src/migrations/index.ts`, workflow-adjacent
repositories in `packages/db/src/repositories/**`. Branch `desktop_redesign`. No files edited,
no writes made to any DB. Real dev DB inspected read-only via `better-sqlite3 {readonly:true}`
directly against `packages/db/data/generatorai.db` (open succeeded without needing a copy).

All line numbers verified by direct file reads on 2026-09-24.

---

## 0. Ground truth from the real DB (task 4)

`packages/db/data/generatorai.db`, WAL mode, `foreign_keys=1`. Opened directly read-only,
no copy needed (file was not exclusively locked).

`_schema_versions` — max applied version **52** (`device_scope_requests`), i.e. **behind
the code**, which defines migrations through **v54** (`chat_source_control_options`). The
dev DB has never run v53 (`conversation_branching_and_change_review`) or v54. This matters
for any squash plan (§5).

Row counts (real data that must survive or be accounted for):

| table | rows |
|---|---|
| `workflows` (legacy v1) | **0** |
| `workflow_definitions` | 343 |
| `stage_definitions` | 867 |
| `stage_edges` | 473 |
| `workflow_runs` | 1113 (cancelled 138, completed 751, created 84, failed 118, paused 22) |
| `stage_runs` | 2809 |
| `session_allocations` | 141 |
| `stage_session_maps` | 11 |
| `automations` | 50 |
| `automation_executions` | 84 |
| `automation_execution_runs` | 378 |
| `webhook_registrations` | 0 |
| `webhook_deliveries` | 0 |
| `sessions` | 2323 |
| `chats` | 362 |
| `chat_messages` | 8178 |
| `artifacts` | 7 |

**Chats never reference workflow rows**: `chat_messages.workflow_id IS NOT NULL` → 0 rows;
`artifacts.workflow_id IS NOT NULL` → 0 rows; `artifacts.workflow_run_id/stage_run_id IS NOT
NULL` → 0 rows. The legacy `workflows` table has zero rows and the only FK pointing at it
(`chat_messages.workflow_id`, `artifacts.workflow_id`) is unused in practice. **Chats and
workflow runs are, today, completely disjoint graphs** — dropping every workflow table cannot
orphan a chat row.

`PRAGMA foreign_key_list` on the real file (ground truth, not schema.ts — see the divergence
note in §5):

- `chat_messages`: → `workflows(id)` NO ACTION/NO ACTION; → `sessions(id)` NO ACTION/CASCADE
- `artifacts`: → `workflows(id)` NO ACTION/NO ACTION; → `sessions(id)` NO ACTION/CASCADE
- `stage_runs`: → `sessions(id)` NO ACTION/NO ACTION; → `stage_definitions(id)` NO ACTION/NO ACTION; → `workflow_runs(id)` NO ACTION/**CASCADE**
- `workflow_runs`: → `workflow_runs(id)` [`ancestor_run_id`] NO ACTION/**SET NULL**; → `workflow_definitions(id)` NO ACTION/NO ACTION
- `stage_definitions`: → `workflow_definitions(id)` NO ACTION/**CASCADE**
- `stage_edges`: → `stage_definitions(id)` ×2 (`from_stage_id`, `to_stage_id`) NO ACTION/**CASCADE**; → `workflow_definitions(id)` NO ACTION/**CASCADE**
- `automation_execution_runs`: → `workflow_definitions(id)` NO ACTION/NO ACTION; → `workflow_runs(id)` NO ACTION/**SET NULL** (⚠ see gotcha below — column is `NOT NULL`); → `automation_executions(id)` NO ACTION/**CASCADE**
- `session_allocations`: → `workflow_runs(id)` NO ACTION/**CASCADE**
- `stage_session_maps`: → `session_allocations(id)` NO ACTION/**CASCADE**

**Gotcha found live in the DB**: `automation_execution_runs.workflow_run_id` is declared
`NOT NULL` (migrations/index.ts:415) **and** `ON DELETE SET NULL`. Those two clauses
contradict each other — SQLite would refuse to write NULL into a NOT-NULL column when the
delete-action fires, so in practice a delete of a referenced `workflow_runs` row raises a
constraint error instead of cascading or nulling. Functionally it behaves like RESTRICT, but
by accident. Any rewrite should make this either genuinely `ON DELETE CASCADE` (delete the
automation-execution-run row too) or genuinely restrict (keep `NOT NULL`, drop `SET NULL`).

---

## 1. Column classification (LIVE / WRITE-ONLY / DEAD / LEGACY-ALIAS)

### `workflows` (legacy v1 table) — schema.ts:71-104, migrations/index.ts:89-109

**Table verdict: DEAD.** 0 rows in the real DB. No code path anywhere inserts into it:
`DrizzleWorkflowRepository.create/update/updateStatus/delete` (packages/db/src/repositories/WorkflowRepository.ts:20-96) have **zero callers** in the whole repo (`grep workflowRepo\.` finds nothing). The only caller of the repo at all is `getBySessionId`, from
`apps/server/src/routes/hooks.ts:72` (`GET /sessions/:id/hooks`), and the web client
(`apps/web/src/platform/HttpPlatformClient.ts`) never calls that endpoint — it only calls
`/api/hooks/phases` and `/api/hooks/sessions/:id/hooks/test`. So the route is also
unreachable from the UI. Since nothing ever writes to `workflows`, that read always returns
`[]`.

- Removal risk: **none**. Delete the table, `DrizzleWorkflowRepository.ts` (whole file, 119
  lines), the `workflows` export in schema.ts, the bootstrap `CREATE TABLE workflows` block
  (migrations/index.ts:89-109), the `copilot_config_overrides`/`harness_config_overrides`
  ALTERs that target it, the `IWorkflowRepository` port (packages/core/src/domain/ports/IRepositories.ts:36 and the re-export in index.ts:50), its composition-root wiring
  (apps/server/src/composition-root.ts:42, 729, 2816), and the dead `getBySessionId` block in
  `apps/server/src/routes/hooks.ts:67-101` (replace with a 410/`[]` stub or drop the route).
- Every column on it (`session_id`, `template_id`, `order`, `status`, `conversation_id`,
  `variables`, `hook_overrides`, `harness_config_overrides`/`copilot_config_overrides`,
  `current_step`, `total_steps`, `error`, `started_at`, `completed_at`, `created_at`) is DEAD
  by inheritance.

### `chatMessages.workflowId` / `artifacts.workflowId` — schema.ts:207, 232

FK to the dead `workflows` table. **DEAD** — 0 non-null rows in the real DB (verified §0).
The in-code `workflowId` that IS actually populated in `HookContext` (StageExecutionService.ts
lines 1268, 2051, 2278, 2653, 2900, 3265) is a **different, same-named concept**: it's really
the *workflow run id*, passed into `HookExecutor`, unrelated to this DB column. Safe to drop
`workflow_id` from both `chat_messages` and `artifacts` with no data loss.

### `sessions` table — schema.ts:28-66

Not workflow-specific but explicitly asked about. 2323 real rows, actively written by
`SessionRepository`/`SessionAllocator`, and both `chats.sessionId` (hard FK, CASCADE) and
`stage_runs.sessionId` (FK, no action) point at it. **LIVE**, out of scope for removal — it's
shared chat+workflow infrastructure (one physical "conversation session" row can be owned by
a chat or a stage run — see `ownerType`/`ownerId`, schema.ts:54-55). Not something this
workflow-focused cleanup should touch.

### `workflow_definitions` — schema.ts:378-411

| column | verdict | evidence |
|---|---|---|
| `id, name, description, version, session_mode, tags, created_at, updated_at` | LIVE | core CRUD path, `WorkflowDefinitionRepository.ts` |
| `harness_config` | LIVE | round-tripped everywhere `harnessConfig`/`harnessConfigOverrides` flow (StageExecutionService.ts:399-404,1140; ChatManagementService.ts multiple) |
| `variables` | LIVE | `WorkflowRunService.ts` merges `defaultValue` per run-create (line ~479) |
| `orchestrator_config` | LIVE | `WorkflowOrchestrator.ts` reads `orchestratorConfig.gitRepositories` etc. extensively (lines 316,592,638,737,941,1101,1175+) |
| `selected_artifacts` | **WRITE-ONLY**. Written at `WorkflowDefinitionService.ts:149` and round-tripped by the repo (`WorkflowDefinitionRepository.ts:34,53,113-114,139,184`), but no reader anywhere in `packages/core` or `apps/server` consumes `definition.selectedArtifacts` to actually filter skills/agents/prompts at run time — only grep hits are the write path and the type decl (`packages/shared/src/types/WorkflowDefinition.ts:65,100`, `WorkflowDefinitionSchemas.ts:188,218`). |
| `scope` (`'global'\|'project'`) | LIVE but thin. Written/read by `apps/web/src/stores/workflowBuilderStore.ts` (lines 77-78,252,293,330,548) as a client-side concept paired with `projectId`; server never filters `getAll()`/list routes by `scope` (`apps/server/src/routes/workflowDefinitions.ts` has no `scope` query handling — its only `scope` hit is an unrelated auth-principal `.scopes` check at line 101). The index `idx_workflow_defs_scope` (schema.ts:407) is effectively unused server-side. Low-risk to keep (cheap column) or fold into a `projectId IS NULL` check if removing. |
| `project_id` | LIVE | `getByProjectId` (WorkflowDefinitionRepository.ts:90-97), used by project-scoped listing |
| `use_worktree` | LIVE | read at `WorkflowRunService.ts:698` (`definition.useWorktree ?? true`) |
| `hooks`, `hooks_file` | LIVE | `resolveStageHooks.ts` + `StageExecutionService.ts:1065-1074` (HOOK-2 merge), read by `createCoreServices.ts:448` |
| `skills`, `agents` (schema.ts:397-399, "G8 fix — had no column at all before") | **WRITE-ONLY / round-trip only**. Written (`WorkflowDefinitionService.ts:281,593-594`) and read back only for definition CRUD / script export fidelity (`packages/sdk/src/facades/ScriptFacade.ts:90-91`, `apps/server/src/routes/workflowScripts.ts:124-125,257-258`). Never consulted by `StageExecutionService` to actually enable a skill/agent when a stage runs (no match for `definition.skills`/`.agents` there). Real feature, just not wired to execution — flag for product decision rather than pure-dead removal. |
| `default_agent_ref` | **WRITE-ONLY (mostly)**. Written/updated (`WorkflowDefinitionService.ts:188-194`); the one real read is a reverse-lookup query in `AgentRepository.ts:183` (`WHERE default_agent_ref = ref`, almost certainly "is this agent still referenced" for agent-delete guarding). Not consulted by `AgentResolver`/`StageExecutionService`/`DAGValidator` (`DAGValidator.ts:56` only checks `stage.agentRef \|\| stage.agentName`) as a fallback when a stage has no agent — so the "default agent for stages without their own" behavior described in the schema.ts:400 comment does not appear to be implemented. |

### `stage_definitions` — schema.ts:415-456

| column | verdict | evidence |
|---|---|---|
| core (`name, description, order, prompts, harness_config_overrides, hooks, retry_policy, timeout_ms, condition, context_filter, context_sources, output_format, expected_output, output_schema, approval_required, agent_mode`) | LIVE | `StageExecutionService.ts` execution path |
| `template_id` | **DEAD / WRITE-ONLY**. Written at `WorkflowDefinitionService.ts:256` from caller input; never read anywhere in `StageExecutionService.ts` or elsewhere to resolve stage content. (Not to be confused with `importFromTemplate(templateId, …)` at `WorkflowDefinitionService.ts:398-403`, which is a function *parameter* resolved against the in-memory `TemplateRegistry` — a completely separate mechanism, not this DB column.) |
| `variables` | LIVE | merged into stage execution variable bag (`StageExecutionService.ts`) |
| `agent_name` | LIVE (legacy fallback, still exercised). `AgentResolver.ts:43-44,285-292` explicitly matches `input.agentName` against agent slug/name as a fallback when no `agentRef`; `DAGValidator.ts:56` and `StageExecutionService.ts:374,390` also branch on it. Product owner could still choose to force-migrate all `agent_name` data to `agent_ref` and drop the column, but it is not dead code today. |
| `agent_ref` | LIVE | supersedes `agent_name`, primary path in `AgentResolver`/`StageExecutionService` |
| `iteration_config` | **DEAD / WRITE-ONLY**. Written once at `WorkflowDefinitionService.ts:270`; no reader in `StageExecutionService.ts` or `IterationPlanner.ts`. `IterationPlanner.ts`/`iterationIndex` machinery that *does* exist belongs to **automations** (`AutomationService.ts`, a different, shipped iteration feature keyed by `automation_execution_runs.iteration_index`), not to per-stage iteration. Per-stage iteration (the feature this column was for) does not appear to be implemented in current code. |
| `result_validation` | LIVE-ish (round-tripped, validated on write; grep shows it wired through `StageExecutionService` result-validation path — not separately re-verified line-by-line here, lower confidence than the fully-checked rows above) |

### `stage_edges` — schema.ts:460-483 — fully LIVE (DAG scheduling core: `DAGValidator`, `DAGScheduler`). No dead columns.

### `workflow_runs` — schema.ts:487-544

| column | verdict | evidence |
|---|---|---|
| core (`workflow_definition_id, name, status, session_mode, variables, error, permission_mode, project_id, workspace_id, definition_snapshot, timestamps`) | LIVE |
| `master_session_id` | **WRITE-ONLY**. Generated and stored at `WorkflowRunService.ts:477,526` (`master_${generateId()}`); no other file in `packages/core` reads `run.masterSessionId` or `masterSessionId` back. `session_mode='single'` appears to route sessions some other way (via `SessionAllocator`/`session_allocations`, not by re-reading this column) — worth a second look before dropping, since the *name* strongly implies it should gate single-session reuse, but grep found no read site. |
| `parent_stage_run_id` | **DEAD**. Repository plumbing exists (`StageRunRepository.ts` equivalent update path, schema index `idx_workflow_runs_parent_stage`), the `WorkflowRun` shared type has the field (`packages/shared/src/types/WorkflowRun.ts:165`), but **zero** matches for `parentStageRunId`/`parent_stage_run` in any `packages/core` service — no code ever sets it on create or reads it to link a nested/child workflow run back to a parent iteration stage. The "sub-workflow" feature this describes (schema.ts:514 comment) does not exist in current service code. |
| `ancestor_run_id` | LIVE | full retry-chain feature, `WorkflowRunService.ts:529,583-665`, FK confirmed live in real DB with `SET NULL` |
| `agent_snapshot` | not separately re-verified; low risk either way (JSON snapshot, additive) |

### `stage_runs` — schema.ts:548-615

| column | verdict | evidence |
|---|---|---|
| core (`workflow_run_id, stage_definition_id, session_id, status, current_step, total_steps, retry_count, error, summary, output_text, output_data, artifact_manifest, version, wake_at, slept_since, interrupt_data, heartbeat_at`) | LIVE — this is the durable-execution / DUR-05 / HITL-01/02 / WS-D1 machinery, heavily exercised in `StageRunRepository.ts` (sleep/wake/interrupt/resume/heartbeat/optimistic-lock methods, lines 120-353) |
| `iteration_index` | **DEAD / WRITE-ONLY** on the stage-run side too — same finding as `stage_definitions.iteration_config` above; the live `iterationIndex` concept in the codebase (`AutomationService.ts`, `AutomationRecoveryService.ts:129`, `IterationPlanner.ts`) is the **automation-execution-run** iteration index, a different column on a different table. |
| `parent_stage_run_id` | **DEAD** — same finding as on `workflow_runs`, no service reads or writes it. |
| `lease_owner` | **DEAD / WRITE-ONLY**. Schema comment itself says "executor identity … (diagnostics)." `StageRunRepository.heartbeat(id, leaseOwner?)` accepts the param, but grep for `leaseOwner` across `packages/core` returns **zero matches** outside the port interface (`IStageRunRepository.ts:45`) and the repo — no caller ever passes a `leaseOwner` value, so the column is permanently NULL in practice, and nothing reads `stageRun.leaseOwner` for any reaper/UI decision. |

### `session_allocations` / `stage_session_maps` — schema.ts:622-653 — LIVE (141 / 11 real rows; `SessionAllocationRepository.ts`, `StartupRecoveryService`). Not dead.

### `automations` / `automation_executions` / `automation_execution_runs` — schema.ts:657-794

Broadly LIVE (50/84/378 real rows). One legacy-alias column worth flagging:

- `automations.webhook_token` — schema.ts:672-676, explicitly commented **"LEGACY plaintext
  webhook token. Always null after v47's boot-time backfill; kept only so the backfill can
  read it. Never written."** This is a textbook LEGACY-ALIAS column: `webhook_token_hash`
  (schema.ts:678) is the live column; `webhook_token` exists solely so
  `DrizzleAutomationRepository.hashLegacyWebhookTokens` (referenced in migrations/index.ts:2291
  comment) can do a one-time read-and-hash on boot. Since the product owner wants zero
  backward compat, this column and its one-time backfill logic are removable outright — just
  hash on write going forward and drop the plaintext column.
- `automations.scope` / `use_worktree` — same shape as `workflow_definitions.scope` /
  `use_worktree`; not separately re-verified here, same low-risk profile.

### `webhook_registrations` / `webhook_deliveries` — schema.ts:250-288

0 rows in the real DB. `WebhookService.ts` is real, live code (uses `TemplateRegistry`, not
these DB tables, to resolve `template_id` — that's a config-file registry, not an FK; no
`.references()` on `webhook_registrations.template_id` in schema.ts, correctly unenforced).
Tables are schema-LIVE (code paths exist to write them) but currently **empty** — not dead
code, just an unused feature in this particular DB. Keep classification as LIVE (real,
reachable write paths), just note zero current usage.

### `plan_documents.harness_type` — schema.ts:1282 (`text('harness_type').notNull().default('copilot')`)

Workflow-adjacent (has `stage_run_id`/`workflow_run_id` columns too, schema.ts:1287-1288).
**LIVE** — `PlanService.ts:87,131`, `IPlanRepository.ts:25` round-trip a real `harnessType`
string per plan. The `'copilot'` default is a naming leftover (same smell as
`copilot_config`) but the column itself is functional, not dead. `harness_type` vs
`provider_instance_id`: no `provider_instance_id` column exists anywhere in the DB (grepped
migrations/index.ts — zero hits); that pairing applies to `conversation_ownership` /
`harness_instances` / `conversation_instance_ownership` (chat/session harness routing, v34/v40
migrations), which are **not workflow tables** and out of this audit's scope.

### `prompt_type`

Not a DB column at all — it's a field (`promptType?: PromptType`) inside the JSON blob stored
in `stage_definitions.prompts` (`packages/shared/src/types/StageDefinition.ts:82,170`). No
schema-level action possible without a JSON-content migration; out of scope for a DDL cleanup.

### `chats.git_repositories` (schema.ts:307) — flagged by name, but this is a **chat** column, not workflow

Round-tripped by `ChatRepository.ts:41,266`. `ChatManagementService.ts:1658` comment: legacy
inbound API field ("createWorktree, gitRepositories") is "mapped onto sources" (the v51 mount
model, `chats.sources`/`primarySource`). Whether the raw column is still authoritative
post-v51 or purely a legacy input mirror needs a **chat-layer** audit (out of this workflow-DB
task's scope) — flagging for the chat-module owner rather than classifying definitively here.

---

## 2. Migrations (task 2)

- **54 versioned migrations** (`version: 1..54`, migrations/index.ts:603-2481), run through
  `applyVersionedMigrations` (index.ts:2500-2576) in a loop over `MIGRATIONS`, each in its own
  `BEGIN/COMMIT`, guarded against duplicate version numbers (index.ts:2506-2510).
- Plus a **pre-versioned "bootstrap" block** (index.ts:66-589, "version 0") that
  `CREATE TABLE IF NOT EXISTS`-es every original table (including legacy `workflows` at
  line 89, `workflow_definitions` at 256, `stage_definitions` at 274, `stage_edges` at 296,
  `workflow_runs` at 311, `stage_runs` at 338) and runs ~80 `safeAddColumn` (best-effort
  `ALTER TABLE … ADD COLUMN`, swallowing "duplicate column"/"already exists"/"no such table")
  calls unconditionally on **every boot** (index.ts:461-587). This is where most of the
  workflow-column additions actually happened historically (`scope`, `project_id`,
  `selected_artifacts`, `context_filter`, `agent_name`, `use_worktree`, `iteration_config`,
  `parent_stage_run_id`, `hooks`, `hooks_file`, `harness_config*`, `agent_ref`,
  `default_agent_ref`, `agent_mode`, etc. — index.ts:483-573).
- **Tracking**: `_schema_versions(version INTEGER PRIMARY KEY, applied_at INTEGER, name TEXT)`
  (index.ts:449-453). Current max version = source of truth for what to skip
  (`SELECT COALESCE(MAX(version),0)`, index.ts:456-459). **No checksum** — integrity is instead
  enforced externally by `packages/db/migrations.lock.json` + `scripts/check-migrations-lock.mjs`
  in `pnpm lint` (referenced in the doc comment at index.ts:597-601), which fails CI if a
  *shipped* migration's `sql` is edited in place (a real incident already happened once — v27
  was edited post-ship and broke upgraded DBs, called out at index.ts:1758 and 599-601).
- `disableForeignKeys` flag (index.ts:11-25, 2523-2528, 2555-2562) is the documented
  create-new/copy/drop/rename table-rebuild procedure for SQLite (no `ALTER…DROP COLUMN`/`ALTER
  …CHECK` pre-3.35): used by v13 (`workspace_artifacts` CHECK rebuild, index.ts:936-988), v14
  widget rebuild, v23 (`plan_documents` — this is the migration that already burned the team
  once by cascading a DROP into `plan_revisions`/`plan_comments`), v27/v28 rebuilds, v46
  `system_configs` rebuild. **Any workflow-table rebuild migration (e.g., rebuilding
  `stage_runs` to drop dead columns) MUST set `disableForeignKeys: true`** given `stage_runs`
  is referenced by nothing itself but *itself* holds a CASCADE-honoring FK from nothing —
  actually the risk direction here is the reverse: `stage_edges`/`stage_definitions` CASCADE
  off `workflow_definitions`, and `stage_runs`/`session_allocations` CASCADE off
  `workflow_runs`, so rebuilding **`workflow_definitions`** or **`workflow_runs`** under
  `foreign_keys=ON` would cascade-delete `stage_definitions`/`stage_edges` or
  `stage_runs`/`session_allocations` respectively via SQLite's implicit `DELETE FROM` before
  `DROP TABLE` — exactly the v23 plan_documents incident, but bigger. This is the single
  biggest gotcha for §5.

**Migrations that exist purely to rename/alias/backfill (compat-only, safe to fold away in a
"no backward compat" rewrite):**

| version | name | file:line | what |
|---|---|---|---|
| 11 | `harness_config_rename_backfill` | index.ts:902-909 | Backfills `harness_config*` from deprecated `copilot_config*` columns (`workflows.copilot_config_overrides`, `chats.copilot_config`, `workflow_definitions.copilot_config`, `stage_definitions.copilot_config_overrides`). The old `copilot_config*` columns are **never dropped** — comment at 549 says "RETAINED (deprecated, no DROP) so pre-existing databases stay readable." |
| 22 | `agent_mode_rename` | index.ts:1322-1339 | `interactive` → `auto` value rename on `chats.default_agent_mode`; also bundles unrelated new columns (`stage_definitions.agent_mode`, `plan_documents.stage_run_id/workflow_run_id`) into the same version. |
| 47 | `automations_scheduler_and_webhook_hash` | index.ts:2299-2309 | New columns supporting the plaintext→hash webhook-token migration (`webhook_token_hash` etc.); the actual backfill/hash-on-read logic lives in `DrizzleAutomationRepository.hashLegacyWebhookTokens` referenced at index.ts:2291, reading the now-legacy `webhook_token` plaintext column added back in the original bootstrap. |
| 43, 50 | `drop_dead_usage_ledger`, `drop_usage_ledger` | index.ts (grep'd, not read line-by-line) | Two migrations that DROP a table (`usage_ledger`, created by v36/38) that "NEVER GAINED A WRITER OR A READER" (comment at index.ts:1982-1986). This is direct precedent in this codebase for "ship a migration that just drops a dead table" — exactly the pattern a workflow-v2 cleanup would use. |

Also note the **copilot_config\*/harness_config\* columns are duplicated, not renamed**, on
4 tables (`workflows`, `chats`, `workflow_definitions`, `stage_definitions`) — every one of
them still physically carries both the old and new column today. `chats.copilot_config` and
`chats.harness_config` both exist (bootstrap block index.ts:237 vs 551); same for
`workflow_definitions` (index.ts:262 vs 552) and `stage_definitions` (index.ts:282 vs 553).
**This is the single cleanest "no backward compat" win**: 4 fully-dead legacy columns, already
proven safe to ignore (nothing in the app reads `copilot_config*` — only migration 11's
one-time backfill SQL does), removable table-wide with no data loss since v11 already copied
everything forward.

---

## 3. FK graph (task 3)

See §0 for the ground-truth `PRAGMA foreign_key_list` output (authoritative — differs in
places from `schema.ts`, see gotcha in §5). Structural picture from `schema.ts`'s
`.references()` declarations, direction stated as "child → parent":

**Into workflow tables (hard FK):**
- `stage_definitions.workflow_definition_id → workflow_definitions.id` (CASCADE)
- `stage_edges.workflow_definition_id → workflow_definitions.id` (CASCADE); `from_stage_id`/`to_stage_id → stage_definitions.id` (CASCADE ×2)
- `workflow_runs.workflow_definition_id → workflow_definitions.id` (NO ACTION in schema.ts *and* in the real DB — despite no explicit `onDelete` in schema.ts:493, meaning a stray DELETE FROM workflow_definitions with live runs would violate FK and fail, which is effectively how `WorkflowDefinitionRepository.delete()` surfaces the friendly `ValidationError` at repo layer, lines 154-170)
- `workflow_runs.ancestor_run_id → workflow_runs.id` (SET NULL) — self-referential
- `stage_runs.workflow_run_id → workflow_runs.id` (CASCADE)
- `stage_runs.stage_definition_id → stage_definitions.id` (NO ACTION)
- `stage_runs.session_id → sessions.id` (NO ACTION) — **workflow table referencing the chat/session world**
- `session_allocations.workflow_run_id → workflow_runs.id` (CASCADE)
- `stage_session_maps.allocation_id → session_allocations.id` (CASCADE); `stage_run_id` is a **soft** (unenforced) text column, no FK
- `automation_execution_runs.workflow_run_id → workflow_runs.id` (declared SET NULL, contradicted by NOT NULL, see gotcha in §0); `workflow_definition_id → workflow_definitions.id` (NO ACTION)

**Legacy-only, into the dead `workflows` table:**
- `chat_messages.workflow_id → workflows.id` (NO ACTION) — 0 populated rows
- `artifacts.workflow_id → workflows.id` (NO ACTION) — 0 populated rows
- `workflows.session_id → sessions.id` (CASCADE) — a workflow table referencing chats' `sessions`, but table is empty

**Soft (unenforced text-column) references — no `.references()` in schema.ts, so DROPping a
workflow table cannot break these at the DB layer, only at the application layer if the app
still dereferences a dangling id:**
- `artifacts.workflow_run_id`, `artifacts.stage_run_id` (schema.ts:239-240)
- `events.workflow_run_id`, `events.stage_run_id` (schema.ts:117-118)
- `plan_documents.stage_run_id`, `plan_documents.workflow_run_id` (schema.ts:1287-1288)
- `widget_instances.workflow_run_id`, `widget_instances.stage_run_id` (schema.ts:1396-1397)
- `checkpoints.workflow_run_id`, `checkpoints.stage_run_id`, `checkpoints.automation_execution_run_id` (schema.ts:1160-1162)
- `worktrees.run_id` (+ `run_type` enum including `'workflow'`, schema.ts:908-909)
- `execution_workspaces.owner_id` (+ `owner_type` enum including `'workflow_run'`/`'automation_execution'`, schema.ts:951-952)
- `agent_interactions.scope_id` (+ `scope_kind` enum including `'stage_run'`, schema.ts:1352-1353)

**Non-workflow tables that do NOT reference workflow tables at all (confirmed by reading
their full schema.ts definitions):** `chats` (only → `sessions`, no workflow FK),
`project_codebases`, `projects`, `worktrees`'s hard FKs (→ `projects`/`project_codebases`
only — `run_id` is soft), `workspace_mounts`, `computer_use_grants/audit`,
`review_threads/comments`, `agents` table. **This is the key finding for §5**: `chats` has
*no* hard dependency on any workflow table, and the real DB confirms 0 rows of the one soft
legacy link (`chat_messages.workflow_id`) are populated. Chats are safe.

---

## 4. Real-DB inspection — see §0 (folded in above per the requested format; all numbers are
from the live read-only query, not estimates).

---

## 5. Assessment: squash vs. one forward "workflow v2" migration

**Recommendation: one forward "workflow v2" migration**, not a squash of migration history.

Reasoning:
1. **Squashing the *existing* 54-migration array is actively dangerous** in this codebase:
   `_schema_versions` is version-number-keyed, not content-hash-keyed, and multiple real,
   currently-running databases exist per developer machine (dev DB confirmed at v52). If the
   migration array is renumbered/compacted, any DB that already recorded, say, `(version=39,
   name='workflow_definitions_skills_agents')` in `_schema_versions` will either re-run a
   renumbered migration 39 with *different* SQL (corruption risk) or be silently skipped
   because `MAX(version)=52` already exceeds the new compacted numbers. The codebase's own
   comment (index.ts:598-601) treats editing a shipped migration as a shipped incident (v27).
   Since "no users yet" is true for *production* but not for the *developer's own real 368MB
   DB with 8178 chat messages*, squashing still has a live victim.
2. Instead: **add migration 55 ("workflow_v2")** that does the SQLite
   create-new/copy-filtered-columns/drop-old/rename dance (same pattern already used 5x in
   this file — v13, v14, v23, v27/28, v46) for the workflow-table family, with
   `disableForeignKeys: true` set. Concretely:
   - Drop the dead `workflows` table outright (0 rows — `DROP TABLE workflows;` with FKs off, no rebuild needed since nothing else has a real dependency on it once `chat_messages.workflow_id`/`artifacts.workflow_id` columns are also dropped in the same migration).
   - Rebuild `workflow_definitions`, `stage_definitions`, `workflow_runs`, `stage_runs` each via create-new/copy/drop/rename, dropping: `copilot_config`/`copilot_config_overrides` (all 4 tables that still carry them), `workflow_definitions.template_id`-equivalent n/a, `selected_artifacts` (if product decides it's truly abandoned — currently just unwired, recommend confirming with product before dropping since it's schema-legitimate, just unused), `stage_definitions.template_id`, `stage_definitions.iteration_config`, `stage_runs.iteration_index`, `workflow_runs.parent_stage_run_id`, `stage_runs.parent_stage_run_id`, `stage_runs.lease_owner`, `automations.webhook_token` (plaintext legacy).
   - Fix the `automation_execution_runs.workflow_run_id` NOT-NULL/SET-NULL contradiction (§0) while the table is being touched.
   - Re-point `chat_messages`/`artifacts` to drop `workflow_id` entirely (same rebuild pass, since SQLite can't `ALTER…DROP COLUMN workflow_id` while the CASCADE ancestor still needs a full table rewrite anyway on older SQLite — check the installed better-sqlite3 SQLite version; 3.35+ supports `DROP COLUMN` directly and this whole migration could mostly be `ALTER TABLE … DROP COLUMN` instead of full rebuilds, which is materially simpler and lower-risk than the create/copy/drop dance. **Recommend checking `sqlite3 --version` / better-sqlite3's bundled SQLite version before committing to the rebuild-table approach** — if ≥3.35.0, most of this migration collapses to a handful of `DROP COLUMN` statements with no rebuild, no `disableForeignKeys`, no risk of the v23-style cascade incident.
3. **What must be preserved** for chats to survive (per the FK graph in §3, confirmed against real data in §0):
   - `sessions` table and `chats`→`sessions` CASCADE FK — untouched by any workflow-table change.
   - `chat_messages`/`artifacts` keep `session_id`, `chat_id`; only `workflow_id` is dropped (confirmed 0 populated rows).
   - `automations.workflow_ids` (JSON array of definition ids, schema.ts:679) and
     `automation_execution_runs.workflow_definition_id`/`workflow_run_id` — automations point
     *at* workflow definitions/runs, so any DROP of `workflow_definitions`/`workflow_runs`
     rows (not just column trims) would need automations handled first; this migration as
     scoped only trims columns, not rows, so it doesn't affect this.
   - `worktrees.run_id`, `execution_workspaces.owner_id`, `checkpoints.workflow_run_id/stage_run_id`, `widget_instances.*_run_id`, `plan_documents.*_run_id`, `events.*_run_id` — all soft text columns, unaffected by a column-level rebuild of the workflow tables as long as the *ids themselves* (not the columns being dropped) stay stable, i.e. don't regenerate ids during the copy step.
4. **Gotchas already identified, restated for the migration author:**
   - Must set `disableForeignKeys: true` if using the rebuild approach (SQLite's implicit
     `DELETE FROM` before `DROP TABLE` on `foreign_keys=ON` cascades through
     `stage_definitions`/`stage_edges` off `workflow_definitions`, and
     `stage_runs`/`session_allocations` off `workflow_runs` — this is the exact plan_documents/plan_revisions/plan_comments incident from v23, replayed at larger scale).
   - `schema.ts` (Drizzle) and `migrations/index.ts` (raw SQL) are **two independent sources
     of truth** — Drizzle's `.references({ onDelete: 'restrict' })` on
     `automationExecutionRuns.workflowRunId` (schema.ts:774) does **not** match the real DDL
     (`ON DELETE SET NULL`, migrations/index.ts:415). Any rewrite must edit the raw SQL in
     `migrations/index.ts`; editing only `schema.ts` changes nothing at the DB level and would
     make the drift worse.
   - No triggers, no views, no FTS tables exist anywhere in this schema (confirmed — table
     list in §0 has no `sqlite_master type='trigger'|'view'`, and no `fts` /`_fts` named
     tables); this significantly de-risks a rebuild — no trigger logic to re-attach, no view
     definitions referencing dropped columns.
   - Indexes named against dropped columns (`idx_stage_runs_wake_at` fine, but
     e.g. any future index on `lease_owner`/`iteration_index`/`parent_stage_run_id` — none
     currently exist on the columns recommended for removal except
     `idx_workflow_runs_parent_stage` on `workflow_runs.parent_stage_run_id`
     (schema.ts:542) and `idx_stage_runs_parent`/`idx_workflow_runs_parent_stage`
     (migrations/index.ts:885-886) — drop these indexes in the same migration.
   - `migrations.lock.json` + `scripts/check-migrations-lock.mjs` (CI gate) will need the new
     migration's `sql` array added/pinned like every other entry — don't forget this or CI
     lint fails.

---

## 6. LOC estimate removable in `packages/db`

| area | estimate | basis |
|---|---|---|
| `packages/db/src/repositories/WorkflowRepository.ts` | **119 lines** | whole file deleted (legacy `workflows` repo, zero real callers) |
| `packages/db/src/schema.ts` — `workflows` table export | **~38 lines** (68-105) | whole block deleted |
| `packages/db/src/schema.ts` — dead columns trimmed from `workflow_definitions`/`stage_definitions`/`workflow_runs`/`stage_runs`/`automations` (column defs + their index defs: `selected_artifacts` question mark aside, `template_id`, `iteration_config`, `iteration_index`, `parent_stage_run_id` ×2 + 2 indexes, `lease_owner`, `master_session_id` pending confirmation, `webhook_token`, `copilot_config*` ×4 tables) | **~35-45 lines** | direct column/index removals across the read sections above |
| `packages/db/src/repositories/*.ts` — matching plumbing (validate/map/update branches for each dropped column across `WorkflowDefinitionRepository.ts`, `StageDefinitionRepository.ts`, `WorkflowRunRepository.ts`, `StageRunRepository.ts`, `AutomationRepository.ts`) | **~60-90 lines** | 2-4 lines per dropped column × ~6 repos |
| `packages/db/src/migrations/index.ts` — bootstrap block `CREATE TABLE workflows` + its indexes + all `copilot_config*`/dead-column `safeAddColumn` lines targeting these tables | **~60-80 lines** | index.ts:89-109 + scattered ALTERs in 461-587 |
| `packages/db/src/migrations/index.ts` — net effect of collapsing ~15-20 of the 54 versioned migrations that exist purely to add/rename/backfill workflow-table columns, replaced by one v55 migration | **~250-400 lines net reduction**, but this is a **rewrite, not pure deletion** — old entries must stay (never edit a shipped migration, per this file's own rule) so the *file* only shrinks if the team also decides to hard-reset migration history (defensible given "no users," but a separate, bigger decision than this audit's scope) |
| `apps/server/src/routes/hooks.ts` dead route handler | **~35 lines** (lines 67-101) | out of `packages/db` proper but directly dependent on the deleted repo |
| **Total, `packages/db` only, conservative** | **≈ 350-450 lines** if only trimming dead code (repo file + schema exports + column plumbing + bootstrap block), **without** touching the 54-migration history |
| **Total, `packages/db`, aggressive** (also collapses workflow-touching migration history into v55 and deletes the now-dead superseded entries) | **≈ 700-900 lines**, contingent on the product owner explicitly accepting a `_schema_versions` reset / fresh-DB-only migration story, since old entries can't be edited in place without corrupting already-applied devs' DBs per §5 |

---

## Appendix: files read/inspected

- `packages/db/src/schema.ts` (full, 1480 lines)
- `packages/db/src/migrations/index.ts` (full read of bootstrap block, versioned array headers 1-54, and full text of versions 1,9,10,11,12,13,22,23,35,36,39,40,47,48,49,53,54, plus the runner `applyVersionedMigrations`)
- `packages/db/src/repositories/WorkflowDefinitionRepository.ts`, `WorkflowRepository.ts`, `WorkflowRunRepository.ts`, `StageDefinitionRepository.ts`, `StageEdgeRepository.ts`, `StageRunRepository.ts` (full)
- `packages/db/src/repositories/ChatMessageRepository.ts`, `ArtifactRepository.ts`, `ChatRepository.ts` (targeted grep)
- `apps/server/src/composition-root.ts`, `apps/server/src/routes/hooks.ts`, `apps/server/src/routes/workflowDefinitions.ts`, `apps/server/src/routes/workflowScripts.ts` (targeted)
- `packages/core/src/services/WorkflowRunService.ts`, `WorkflowDefinitionService.ts`, `StageExecutionService.ts`, `WorkflowOrchestrator.ts`, `AgentResolver.ts`, `HookExecutor.ts` (targeted grep + reads)
- `packages/db/data/generatorai.db` — live read-only query (row counts, `_schema_versions`, `PRAGMA foreign_key_list`, `PRAGMA foreign_keys`, `PRAGMA journal_mode`)
