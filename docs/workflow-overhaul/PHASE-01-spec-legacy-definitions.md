# PHASE 01: Spec v2, legacy purge, definition model

**Goal:**
- Create `@generatorai/workflow-spec`, holding the **final (v2) shapes**: the SessionSpec schema, StageSpec v2 (agent kind), EdgeSpec v2, WorkflowSpec v2, Expression v2 (conditions and templating), the validator, JSON Schema, and the state-machine tables as data.
- Remove every legacy, duplicate and dead path on the definition side and in the composition roots.
- Rebuild definition persistence as a versioned v2 document with an atomic graph save, immutable versions, draft/publish, and a lossless canonical import/export.
- Build the builder **once**, on v2.
- Migrate **once** (v55). Workflow run history is dropped here, after a backup.

The **v1 engine keeps running** on v2 definitions through two small, final-form changes: it evaluates `guard`/`when` with Expression v2, and it validates with `output.rules`. The validator **rejects** v2 features the v1 engine cannot execute yet. Those features are enabled in P03. This is validation, not a shim: nothing is translated back to v1 shapes.

**Estimate:** 3 weeks. **Depends on:** P00. **Branch:** `wf/phase-01-spec-definitions`. Merge sub-milestones to the base branch when green (README §0.4).
**Closes:** W-03, W-04, W-05, W-13 (definition side), W-20, W-21, W-23 (schema side), W-24 (deletions), W-25, W-26, W-28, W-30 (validator), W-31 (grammar), W-34 (definition fields), W-35, W-38, W-43 (part), W-45, W-57, W-61, W-62, W-64 (import side), RV-13, RV-14, RV-15, RV-16, RV-22, RV-32, RV-42. PD-7, PD-8, PD-10, PD-11, PD-12 and PD-16 are applied.

## Read first
- `G3_legacy_inventory.md` (the whole file) plus `G3_part_db.md`, `G3_part_web.md`, `G3_part_shared_cli_sdk.md`
- `A_definitions_db.md` (the option catalog, A-1..A-35)
- `D_web_ui.md` D-1..D-11, D-25..D-30
- `G5_scheduler_v2_loops.md` §2.3 (StageSpec v2), §4.1 (join), §4.6 (Expression v2), §5.9–5.10 (state tables), §6.1
- `REVIEW-LOG.md` RV-1, RV-2, RV-13..RV-16, RV-22, RV-32, RV-33, RV-42

## Design decisions
1. **Stage identity.** A stage has a stable `key` (`^[a-z][a-z0-9_]{0,47}$`, unique per workflow). Keys are used by edges, `context.from`, stage overrides, validations, hooksFile maps and expressions (`stages.<key>`). The display `name` is free text. *Why:* name/index matching broke on rename and skipped the wrong stage (A-22, D-29, F-13). Keys follow the pattern of Step Functions state names and Argo task names.
2. **The final spec from day one** (RV-13). StageSpec v2 for `kind: 'agent'` follows G5 §2.3:

   | Field | Replaces or adds |
   |---|---|
   | `guard?: Expr` | `condition` |
   | `join: {mode: all\|any\|n_of_m, n?, cancelRemaining?}` | new |
   | `retry?: RetryPolicyV2` (`maxAttempts`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`, `jitter`, `retryOn`, `mode`, `restoreCheckpointOnRestart`) | `retryPolicy` |
   | `repair?` | new |
   | `onExhausted: pause\|fail` | new |
   | `timeouts?: {queueMs, attemptMs, idleMs, totalMs}` | `timeoutMs` |
   | `budget?: {maxTurns, maxCostUsd, maxWallClockMs}` | new |
   | `output: {format, schema?, extraction: auto\|native\|tool\|final_json_block, rules[]}` | `outputFormat`, `outputSchema`, `expectedOutput`, `resultValidation` |
   | `context: {from?: StageKey[], mode: summary\|output\|structured\|none}` | `contextFilter`, `contextSources` |
   | `session?: Partial<SessionSpec>` | `harnessConfigOverrides`, `agentRef`, `agentMode` |
   | `sessionReuse: fresh\|continue` | new |
   | `sessionGroup?: string` | run-level `sessionMode` |
   | `approval?: {prompt?, allowChanges, maxRounds}` | `approvalRequired` |
   | `hooks[]`, `compensate?`, `followUpPrompts?`, `position` | `hooks` (others new) |

   - `EdgeSpec`: `{from, to, on, when?, handlesFailure?}`.
   - `WorkflowSpec`: `{name, description, session: SessionSpec, variables, hooks, onExit?, onFailure?, lifecycle, budget?, maxParallel?, outputs?, tags, projectId}`.
   - `lifecycle`: `{codebaseAliases, useWorktree, requiresCodebase, preprocessingSteps, postProcessing: {autoCommit, autoPush, autoCreatePR, steps[]}}`. Workflow-level validations fold into each stage's `output.rules`, so rules live in one place.
3. **The v1 engine capability gate.** `validateWorkflow(graph, {engine: 'v1'})` rejects, with code `engine-unsupported` and a hint "available after the engine upgrade", these values: `join.mode !== 'all'`, `repair`, `onExhausted: 'pause'`, `sessionReuse: 'continue'`, `sessionGroup`, `budget`, `timeouts.idleMs|queueMs|totalMs`, `output.extraction` other than `auto`, `compensate`, `onExit`, `onFailure`, `maxParallel`. The builder hides those controls until P03 flips the flag to `v2`, which is **one constant** in the spec package. *Why:* one encoding and one builder, and no hidden behaviour: the v1 engine never sees a field it would ignore.
4. **Expression v2 with templating sugar** (RV-15).
   - Conditions and edge `when` use the strict grammar (G5 §4.6).
   - Prompt templates accept `{{variables.x}}`, `{{stages.k.output.y}}` and **bare `{{x}}` as sugar for `{{variables.x}}`**. Bare `x` must be a declared variable, otherwise it is a save-time error.
   - Reserved roots (`variables`, `stages`, `run`, `loop`, `loops`, `item`, `map`, `maps`, `parent`, `child`) cannot be variable names. P05 extends the grammar with list literals, `at`, `map`, `filter`, string `concat` and full expressions inside `{{ }}` (P05 §1.1). Build the parser so functions can be added without grammar changes.
5. **Typed system scope, not magic variables** (RV-16). Codebase paths are `run.codebases.<alias>.{path, branch, baseRef}`, and they are read-only. Variable names matching `^(__|repo_path_|repo_branch_)` are rejected. Command-bearing fields (script hooks, `run_script`, `custom_script`, `check`) receive templated values **only through env vars**. `command` and `args` are literals, which keeps Windows `cmd /c` escaping safe. The validator rejects `{{…}}` in `command` and `args`. Templated env values must be non-secret; secrets are `secretref:` only.
6. **Document persistence.**
   - `stage_definitions(id, workflow_definition_id, key, name, position_x, position_y, spec JSON, created_at, updated_at)`.
   - `workflow_definitions(id, name, description, project_id, status draft|published, revision, current_version_id, archived_at, spec JSON, created_at, updated_at)`.
   - `stage_edges(id, workflow_definition_id, from_key, to_key, on, when_expr, handles_failure)`. Edges are keyed by stage **key**, which ends the D-1 local-id class for good.
7. **Optimistic concurrency and versions.** `revision` bumps on every graph save, and `PUT …/graph` requires `expectedRevision`. `workflow_definition_versions(id, workflow_definition_id, version, content_hash, kind published|test, spec, created_at)` is immutable. Runs pin `definition_version_id`. *Why:* last-writer-wins (A-24), and run pinning as in Airflow 3, Trigger.dev, Temporal and DBOS (E §B1).
8. **Draft/published** (PD-14). New definitions are drafts. Invocation of drafts is test-run only. Existing definitions migrate as `published`.
9. **One materializer** (PD-16). Script output, SDK builders, templates and import all go through `createFromSpec`.

---

## WP-1.1 Pure dead-code sweep (G3 §6 step 0, plus RV-42)

Everything below has zero production callers (G3 cites file:line).

- **Web.**
  - The re-export shims `StyledSelect.tsx`, `ToggleSwitch.tsx` and `redesign/deriveTimeline.ts`: switch importers to the canonical components.
  - The `workflowRunStore` write-only state and its SSE writers.
  - `sseManager.connect/disconnectAutomationExecution`.
  - The 12 dead workflow hooks and `useUpdateAutomation`.
  - The `?legacy=1` effect. Rename `WorkflowRunPageV2` to `WorkflowRunPage`.
  - The dead "Stage actions ⋯" button.
- **Server.**
  - Fix the stale header comment in `routes/stream.ts:20-22`.
  - `GET /orchestrator/runs/:id/context`, `activeContexts`/`getContext`, `useOrchestratorContext`.
  - The hard-coded hook-phase catalogue in `routes/hooks.ts:10-43`: derive it from the spec package's phase enums (G3 5.17).
- **Core.**
  - The `WorkflowOrchestrator` `resultValidator` argument, and the validation "reporting" listener (W-62).
  - The unused DAGScheduler views and aliases.
  - The ports `IDAGScheduler` and `ISessionAllocator`.
  - `ConfigResolver.resolve` and `resolveStageConfig`.
  - The `AppConfig.workflow` knobs and setters, replaced by module constants.
- **Signatures.** `startPolling(runId)`, `importFromTemplate` string opts, the `AutomationExecutionSummary` deprecated fields, mobile `AutomationView.workflowDefinitionId`.
- **CLI.** `SESSION_MODES` and the `--session-mode` option (W-57).
- **Templates.** Delete `templates/workflow-upload-template.json`.

Add every identifier to `scripts/no-legacy.json`.

## WP-1.2 Delete the v1 session/webhook stack (G3 §2.1)

Delete in one commit, in G3 §6 step 1 order:
- `routes/webhooks.ts`, and `routes/hooks.ts` `GET /sessions/:id/hooks`;
- `WebhookService`;
- `SessionService` (move `getSession` to `sessionRepo.getById` for `acp-entry.ts`);
- `SessionStateMachine` (core, shared, SDK export);
- `CreateSessionParams.workflows`;
- the `Workflow` entity, `WorkflowStatus` and `WorkflowStateMachine`;
- `IWorkflowRepository`, `IWebhookRepository` and their Drizzle repos;
- `verifyGitHubSignature` and `verifyWebhookToken`;
- `AppConfig.webhooks`;
- the `IPlatformClient` session/workflow methods (and in `HttpPlatformClient`/`MockPlatformClient`), plus the 11 web hooks and `SessionWithWorkflows`;
- `ConfigResolver.resolveGlobalHooks` and its callers. After this the `ConfigResolver` file is gone.

**Also delete:**
- `POST /orchestrator/from-template` and `WorkflowOrchestrator.createFromTemplate` (web `Catalogs.tsx` → `POST /workflow-definitions/import`);
- `GET /orchestrator/system-workflows[/:id]` (web and client-core → `GET /api/templates`);
- the webhook condition grammar.

The preprocessor's grammar (`WorkflowPreprocessor.ts:744-778`) is replaced by Expression v2 from the spec package.

## WP-1.3 Required dependencies in `createCoreServices` (G3 5.11; W-61; RV-32)

Both roots already call `createCoreServices` (`composition-root.ts:810`, `sdk/GeneratorAI.ts:9`). Do **not** add a new factory.
1. Make these **required** parameters: the durable repos (`registerRepo`, `entryRepo`), `scmFlow`, the sandbox, the admission controller and the workspace manager. The SDK passes them, and gains the same wiring as the server.
2. Delete the "absent dependency" fallbacks, making each constructor argument required:
   - the legacy upload dir `getRunUploadsDir`/`getRunWorkspaceDirs` (2.2.2);
   - the `WorkflowPreprocessor` GitManager commit/PR fallback (2.2.4);
   - the SES "legacy auto-approve" (2.2.5);
   - the `HitlService` in-memory waiter (2.2.6);
   - the `AutomationService` in-memory iteration loop and the `cancelledExecutions` Set (2.2.7).
3. Delete the copy-pasted `DurableSleepService.onWake` wiring (sleep is deleted in WP-1.4).

## WP-1.4 Field and feature purges (G3 §1; the PD decisions)

Make one commit per row. Each commit updates **every** layer (R-2).

| Item | Action | Replacement |
|---|---|---|
| `gitRepositories`, `GitRepositoryConfig`, the legacy clone path, `repo_path_target`, `WorkflowRunProfileSchema.gitRepositories` | delete | Project codebases (`lifecycle.codebaseAliases`) and the `clone_repo` step. Templates switch to `{{run.codebases.<alias>.path}}` |
| `createWorktrees` | delete | `lifecycle.useWorktree` |
| Stage `agentName` + `StageBuilder.agent()` + the resolver name-slug path | delete | `session.agentRef` |
| The `interactive` agentMode alias, `LEGACY_MODE_ALIASES`, `coerceAgentMode` (chat schema too) | delete | `AgentMode` |
| `promptType`, `prompts[].source/filePath`, `StageBuilder.promptFile()` | delete | Inline text. Builder scripts can read files at authoring time |
| `prompts[].attachments` and the builder Files tab | delete | Per-message stage attachments (P03b) and run uploads (P04) |
| Stage `variables` and its editor | delete | Definition variables |
| `templateId`, `StageTemplateSchema`, `stageTemplateId`, `loadStageTemplates`, the template select | delete | none |
| `iterationConfig`, the `workflowRunOrder` `iterationIndex` sort | delete | `loop` / `subworkflow` kinds (P05) |
| `selectedArtifacts`, `defaultAgentRef` (+ index), definition `skills`/`agents`, `scope` (+ index, `setScope`) | delete | `session.agentRef`; `project_id IS NULL` |
| `masterSessionId` + the SDK replay by it | delete | Run stream scope |
| `PostProcessingStep.enabled` | delete (all declared steps run); `config` becomes a required discriminated union | — |
| Script permission vocabulary (`askOnEachTool`/`askOnce`) | delete | `WorkflowRunPermissionMode` |
| HITL boolean `approved` | delete; clients send `outcome` | — |
| Plaintext `automations.webhook_token` + `hashLegacyWebhookTokens` | delete | `webhook_token_hash` |
| Automation legacy input modes (PD-8, RV-22): `inputMode`, `batchData*`, `loopItems`, `loopVariable`, `batchColumnMapping`, `dataSourceConfig`, the legacy webhook var extraction; in core, web `CreateAutomationPage.tsx` and CLI | delete; **data converted in v55** | `dataSchema` + `IterationPlanner` |
| Durable sleep (PD-7): `DurableSleepService`, the `sleeping` status, `wake_at`/`slept_since`, the wake route/UI/hooks/client/events/CLI | delete | `wait {type: timer}` (P05) |
| `waitForCompletion` + the fire-and-forget branch + the "Wait" checkbox | delete | Always wait |
| `RunLogger`/`StreamLogger` JSONL + its exclusions | delete | Stream replay |
| Unused override fields `agentName`/`timeoutMs`/`contextFilter` | delete | P04 stage overrides |
| `/workflow-runs/:runId/stages/:stageId/interrupt` (test-only) | delete; move into testkit helpers | — |
| `harnessType ?? 'copilot'` in plan recording, and `plan_documents.harness_type DEFAULT 'copilot'` | record the resolved harness; drop the default | — |
| v1 `sessions` columns `repo_url`, `requires_codebase`, `workspace_path`, `triggered_by` (RV-42) | drop in v55 | — |

## WP-1.5 `@generatorai/workflow-spec` (the final shapes)

**Create `packages/workflow-spec/`.** It depends only on `zod`, is browser-safe, and has no node built-ins.
- `src/schemas/session.ts`: `SessionSpec` (P02 design; the type is defined here now).
- `src/schemas/common.ts`: `StageKey`, `VariableDefinition` (reserved-name rule), `HookDefinition` (stage phases), `WorkflowHookDefinition` (workflow phases) and `ResultValidationRule`.
  - Rule types: `contains`, `not_contains`, `min_length`, `max_length`, `regex`, `custom_script {command, args[], env?}` and `json_schema`. `llm_validation` is removed; P05 adds a judge.
  - `regex` patterns are validated at save time, **and** run with a ReDoS-safe engine (`re2-wasm`, no native build) (RV-21).
- `src/schemas/stage.ts`: `StageSpec` (a discriminated union on `kind`, with `agent` only in this phase), following design decision 2.
- `src/schemas/edge.ts`, `src/schemas/workflow.ts`, `src/schemas/graph.ts`: `WorkflowGraph = {formatVersion: 2, workflow, stages, edges}`.
- `src/expr/`: `parse.ts` (Pratt parser to an AST), `typecheck.ts` (against declared variables and output schemas), `evaluate.ts`, `render.ts` (templating, bare-var sugar), and `grammar.ts` (an exported table for docs and the skill).
- `src/state/`: `STAGE_RUN_TRANSITIONS` and `WORKFLOW_RUN_TRANSITIONS` as data (G5 §5.9–5.10, the final tables). The v1 engine does not use them; P03 does.
- `src/validate/`: `validateWorkflow(graph, {engine}) → {valid, issues}`, where an issue is `{code, severity, path (JSON pointer), stageKey?, message, hint?}`. It runs in layers:
  1. strict zod;
  2. DAG (Kahn; `DAGValidator.ts` moves here, keyed by stage key; `edge-pair` rejects two edges per pair, W-30);
  3. references (template paths resolve; `context.from` keys exist; unique keys; reserved names);
  4. expressions (parse and type-check);
  5. security (no `{{…}}` in `command`);
  6. the engine capability gate.

  Hints cover common mistakes: an unknown `copilotConfig` → "did you mean `session`?"; `harnessConfig` → `session`.
- `src/jsonschema.ts`: `toJSONSchema()` via `zod-to-json-schema` (already in the store at 3.25.2; add it as a direct devDependency).
- `scripts/generate-workflow-spec.ts` writes `packages/workflow-spec/generated/workflow.schema.json` and `docs/workflow-overhaul/generated/FIELDS.md`. `--check` runs in CI. A test enforces `.describe()` on every field.
- **Move, don't copy.** Delete `packages/shared/src/config/{WorkflowDefinitionSchemas,WorkflowTemplate,WorkflowScriptSchema}.ts` and `packages/shared/src/builders/*`. The builders move to `@generatorai/workflow-spec/builders`, emit `WorkflowGraph`, and support every field (A-28).
- **Delete** `packages/core/src/domain/dag/ConditionEvaluator.ts` and `DAGValidator.ts`. The v1 `DAGScheduler` imports `evaluate` from the spec package, a final-form call site that P03 keeps inside `decide()`.

## WP-1.6 Migration v55 `workflow_definitions_v2` (single conversion; drops run history)

**Before running it: `pnpm workflow:backup` (P00).** The migration module is `packages/db/src/migrations/v55_workflow_definitions_v2.ts`, with its own **frozen schema copies** under `migrations/v55/` (RV-33).

Follow the G3 §4.4 order, plus RV-1:
1. `DROP INDEX` on `idx_workflow_runs_parent_stage`, `idx_stage_runs_parent`, `idx_workflow_defs_agent_ref`, `idx_workflow_defs_scope`, and any `wake_at` index.
2. `ALTER TABLE chat_messages DROP COLUMN workflow_id; ALTER TABLE artifacts DROP COLUMN workflow_id;` These must run **before** step 3.
3. `DROP TABLE workflows, webhook_deliveries, webhook_registrations`.
4. **Drop workflow run history, with explicit child deletes** (RV-1, RV-14). Foreign keys are off during rebuilds, so **no cascade happens**. Delete every child explicitly:

   ```sql
   CREATE TEMP TABLE purge_sessions AS
     SELECT id FROM sessions
      WHERE (owner_type IN ('stage_run','workflow_run')
             OR id IN (SELECT session_id FROM stage_runs WHERE session_id IS NOT NULL))
        AND id NOT IN (SELECT session_id FROM chats WHERE session_id IS NOT NULL);
   DELETE FROM chat_messages   WHERE session_id IN (SELECT id FROM purge_sessions);
   DELETE FROM artifacts       WHERE session_id IN (SELECT id FROM purge_sessions);
   DELETE FROM stream_cursors  WHERE (scope='session' AND scope_id IN (SELECT id FROM purge_sessions)) OR scope='run';
   DELETE FROM stream_sequences WHERE (scope='session' AND scope_id IN (SELECT id FROM purge_sessions)) OR scope='run';
   DELETE FROM agent_interactions WHERE scope_kind='stage_run';
   DELETE FROM entries   WHERE scope IN ('stage_run','workflow_run');
   DELETE FROM registers WHERE scope IN ('stage_run','workflow_run');
   DELETE FROM checkpoints WHERE workflow_run_id IS NOT NULL;
   DELETE FROM execution_workspaces WHERE owner_type='workflow_run';
   DELETE FROM worktrees WHERE run_type='workflow';
   DELETE FROM stage_session_maps; DELETE FROM session_allocations;
   UPDATE automation_executions SET status='cancelled' WHERE status IN ('pending','running');
   DELETE FROM automation_execution_runs; DELETE FROM stage_runs; DELETE FROM workflow_runs;
   DELETE FROM sessions WHERE id IN (SELECT id FROM purge_sessions);
   ```

   - **Verify the column names against `schema.ts` before writing this.** The names above follow G3 §4.3; adjust them to the real columns.
   - The on-disk worktrees and `generatorai/run-*` branches in user repos are removed **before** the migration by `pnpm workflow:cleanup-runs` (P00 WP-0.8, RV-29).
5. `DROP COLUMN` on:
   - `copilot_config*` (chats, definitions, stages);
   - `automations.webhook_token` and the automation legacy input columns (**after** converting them: loop/batch → `dataSchema` + `default_dataset`; unconvertible rows are logged and disabled);
   - `sessions.repo_url`, `requires_codebase`, `workspace_path`, `triggered_by`;
   - `stage_runs.wake_at`, `slept_since`, `iteration_index`, `parent_stage_run_id`;
   - `workflow_runs.master_session_id`, `parent_stage_run_id`.
6. **Rebuild `stage_definitions`, `stage_edges` and `workflow_definitions`** into the design-decision-6 shape, with `disableForeignKeys: true`. Use a JS step (`Migration.run?(sqlite)`, a small addition to the runner):
   - compute keys with slugify, deduplicated in `order`/`id` order;
   - build **v2 specs directly** with the frozen `convertLegacyStageToV2` (inside the migration module only):
     - `condition` → `guard` (or → an edge `when` for `on_success`/`on_failure` types);
     - `resultValidation` + index-matched workflow validations → `output.rules`;
     - `outputFormat`/`outputSchema`/`expectedOutput` → `output`;
     - `contextFilter`/`contextSources` → `context` (names → keys);
     - `retryPolicy` → `retry {maxAttempts: maxRetries + 1, …}`;
     - `timeoutMs` → `timeouts.attemptMs`;
     - `harnessConfigOverrides`/`agentRef`/`agentMode` → `session`;
     - `approvalRequired` → `approval`;
   - convert prompt templates: `{{repo_path_<alias>}}` → `{{run.codebases.<alias>.path}}`, and `{{repo_branch_<alias>}}` → `…branch`. Bare `{{var}}` stays; it is sugar.
   - Unparseable legacy conditions are kept as the literal expression. The definition is flagged `needs_attention` and its validation issue is shown on open. There is no silent skip.
   - `status = 'published'`; `revision` = the old `version`.
7. `CREATE TABLE workflow_definition_versions`. Add `definition_version_id` (FK) to the now-empty `workflow_runs`. Add `stage_key TEXT NOT NULL` to the now-empty `stage_runs`, and drop its FK to `stage_definitions`. These tables stay v1-shaped for the v1 engine until P03 recreates them.
8. `automation_execution_runs.workflow_run_id`: nullable, `ON DELETE SET NULL` (fixes the DDL/Drizzle contradiction).
9. **Fresh-DB baseline** (RV-2, mechanism from P00 WP-0.6): regenerate `packages/db/src/migrations/baseline.sql` from the post-v55 schema, and set the baseline head to 55. **Do not edit the legacy bootstrap block.** It runs only for existing DBs below the baseline.
10. Update `schema.ts`, and add v55 to `migrations.lock.json` (P00 WP-0.6).

**Migration test** (`packages/db/src/__tests__/migration55.test.ts`, frozen fixtures):
- The v54 fixture contains:
  - 2 chats, one with messages;
  - an orchestrator worker chat;
  - a stage session with 5 messages;
  - 2 definitions (duplicate names; index-based validation; contextSources by name; `repo_path_*` templates; one unparseable condition);
  - 1 run with stage runs;
  - 3 automations (single, loop, batch).
- Assert:
  - chats, chat messages and chat sessions are unchanged (counts and a content hash);
  - `chat_messages` shrank by **exactly** the stage-session messages;
  - `PRAGMA foreign_key_check` is empty;
  - the keys are deterministic;
  - every spec parses with the **frozen** v2 schema copy;
  - templates are converted;
  - the unparseable condition is flagged;
  - the automations are converted or disabled, and logged.
- **Fresh-DB test:** `migrateDB(':memory:')` reaches head through the baseline, and the result matches `schema.ts`.

## WP-1.7 Definition service, store and API

**`WorkflowDefinitionService`** (rewritten), returning a `WorkflowGraph` from every method:
- `get(id)`.
- `create(graph, {status, authoredBy})`.
- `saveGraph(id, graph, expectedRevision)`: one **synchronous** better-sqlite3 transaction. It upserts, deletes and inserts stages by key, replaces the edges, bumps the revision, and returns 409 `REVISION_CONFLICT` with the current graph on a mismatch.
- `createFromSpec(spec)`.
- `publish(id, principal)`: creates or reuses a `published` version by content hash.
- `resolveVersionForRun(id, {testRun})`.
- `listVersions`, `getVersion`, `archive`/`delete` (hard delete only without runs), `exportGraph`, `import`.

**Delete:**
- `addStage`, `updateStage`, `deleteStage`, `addEdge`, `deleteEdge`, `reorderStages`;
- `exportAsTemplate`, `importFromJSON`, `importFromTemplate`, `templateStageToCreateParams`;
- the async `withTransaction` helper (A-34). Replace its other callers with sync transactions, or with a dedicated connection where an await is unavoidable.

**Store:** `WorkflowDefinitionStore` (`getGraph`, `replaceGraph`, `insertVersion`, `getVersion`) replaces the three repositories. Mapping is `StageSpec.parse(JSON.parse(row.spec))` plus the key columns.

**Routes:**
- `GET /workflow-definitions?projectId&status&q&cursor`;
- `POST /workflow-definitions` → a draft;
- `GET /:id`, `PUT /:id/graph`, `POST /:id/publish`, `GET /:id/versions[/:versionId]`, `DELETE /:id`;
- `POST /workflow-definitions/validate` (stateless);
- `POST /workflow-definitions/import` (`WorkflowGraph | {templateId}`; `?publish=true` for user principals only);
- `GET /:id/export`.

**Delete** every nested stage and edge route (A-25).

**Scopes and secrets (W-34):**
- Adding or changing a command-bearing field (script/function hooks, stdio MCP, `run_script`, `custom_script`, and from P05 `check` stages) requires `admin:settings`, decided by fingerprint comparison. Implement the fingerprint over a **registry of command-bearing paths** that later phases extend.
- `session.provider.apiKey` must be `secretref:`. Hook `headers`/`env` and `check.env` may contain templated **non-secret** values, but any secret-bearing value must be `secretref:`. The validator rejects values matching secret patterns (tokens, keys) that are not secretrefs. GET never returns secrets.
- Script upload validates before an atomic rename (use `writeFileAtomicRestricted`, moved from `packages/secrets` into a shared util). It requires `admin:settings`, never overwrites shipped names, and enforces the `.workflow.mjs` extension (A-19).

**Templates:** convert `templates/system/*.json` to v2 `WorkflowGraph` (a one-time script, deleted after it runs). `TemplateRegistry` validates them at boot, and an invalid template **fails the boot** in dev and test.

**v1 engine, final-form changes only:**
- `createRun` stores `definitionVersionId`.
- `DAGScheduler.buildDAGForRun`, SES, validation, retry and the orchestrator read the pinned version's `WorkflowGraph` through `RunDefinitionReader.get(versionId)`. This is not a cache adapter: P03's compiler takes the same input.
- Guards and edge `when` evaluate with the spec package.
- Validation uses `output.rules`.
- Context resolves `context.from` by key.
- Stage overrides match by key.
- `session` is read through `resolveSessionSpec` (P02 turns this into the composer).

**Clients (R-2):**
- client-core `definitions.{list,get,create,saveGraph,publish,versions,validate,import,export,delete}`.
- CLI `workflow create|import|export|validate|publish|versions`. `stage add|update|remove` and `edge add|remove` become read-modify-write with `expectedRevision`, retrying once on 409.
- SDK `WorkflowFacade.create(graph)`.
- Mobile uses the new endpoints.

## WP-1.8 Builder on v2 (behaviour, not layout; PD-19)

The UI must use **existing** components and tokens. The in-flight redesign reskins them later (PD-19, RV-37).
1. The store holds a `WorkflowGraph` keyed by stage key. New stages get generated keys.
2. Save is `PUT /:id/graph` with `expectedRevision` (or `POST` for new workflows), switching to update mode after the first create (D-5). There is **no reload from query data while `isSaving || isDirty`** (D-3). A 409 opens a conflict dialog.
3. Client validation uses `validateWorkflow(graph, {engine: ENGINE_LEVEL})`. Issues map to nodes and fields (D-25).
4. Positions persist, and auto-layout is recorded in undo (D-28). `null` clears work because the graph is replaced wholesale (D-4).
5. **Stage panel on v2 fields** (the controls that the engine gate hides are rendered but disabled with a tooltip):
   - guard (an expression textarea with a live parse);
   - retry (attempts, backoff, jitter);
   - timeouts (attempt);
   - output (format, JSON Schema editor, rules including `custom_script` args; the regex placeholder has no slashes, D-26);
   - context (from + mode);
   - session (reuses the chat model/agent pickers for now; `SessionSpecEditor` arrives in P02);
   - approval;
   - hooks.
6. **Edge badge:** `on`, `when`, and `handlesFailure` (disabled until P03).
7. **Delete the dead controls:**
   - stage Variables editor;
   - Files tab;
   - Template select;
   - the Wait checkbox;
   - the node pills that read dead fields (D-30).
8. **Variables tab:** stable row ids (D-10), a raw options string parsed on blur (D-11), and reserved-name validation.
9. **Delete:** archive when runs exist (D-6). Add a Draft/Published badge, Publish, and "Test run" for drafts. "Save and run" for dirty published workflows (D-17). Add Export and Import on the canonical format.

## WP-1.9 Docs
- Generate `FIELDS.md`.
- Rewrite `feature-workflows.md` and `feature-stages.md` for graph save, keys, versions, draft/publish, import/export, Expression v2, the typed codebase scope and the removed fields. Delete the fictional SDK example.
- Update `AGENTS.md`.

---

## Tests to add
- **Spec package:**
  - describe coverage;
  - strictness and hints;
  - every F-13 case rejected;
  - key and reference checks;
  - reserved names;
  - `{{…}}` in commands rejected;
  - the engine gate;
  - Expression v2 parse, type-check and evaluate tables (strict equality, null paths);
  - a parser fuzz test that never throws past `parse`;
  - templating sugar;
  - the ReDoS-safe regex;
  - the round-trip property `import(export(g)) ≡ g` (fast-check).
- **Definitions:**
  - `saveGraph` atomicity;
  - revision conflict;
  - deleting a stage that has runs;
  - command-field scope;
  - secretref enforcement;
  - `createFromSpec` with every field;
  - template boot validation.
- **Migration v55 test and fresh-DB test** (WP-1.6).
- **Web:**
  - key-based edges (D-1 regression);
  - delete a stage and connect across it (D-2);
  - 409;
  - no reload during save;
  - positions;
  - the Variables tab.
- **Testkit and E2E** (the live run is advisory, RV-35):
  - T6 round trip with zero diffs;
  - create draft → test run → publish → run;
  - edit mid-run (the pinned version is used, W-13);
  - re-import every definition from the P00 export;
  - T1/T2/T3 still pass on the v1 engine with v2 specs.

## Acceptance criteria
- `check-no-legacy` passes.
- `packages/shared` has no workflow schemas.
- The ConditionEvaluator and DAGValidator files are gone from core.
- The P00 characterisation tests for T6 flip to PASS.
- The developer DB (a backup copy) migrates to v55, chats are intact, and every definition opens and validates or shows actionable issues.
- A fresh empty DB boots to head.

## Handoff checklist
- [ ] WP-1.1 … 1.9 done; sub-milestones merged.
- [ ] `STATUS.md` and `TRACEABILITY.md` updated.
- [ ] Any deviations recorded in `DEVIATIONS.md`.
