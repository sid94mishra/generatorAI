# Workflow module audit, slice A: definitions, DB, CRUD, import/export, templates, scripts, builders

Branch `desktop_redesign`, audited 2026-09-24. Read-only; I changed no repo files.

**Method.** Every claim cites `file:line`. Where a field is "read at runtime", I traced it from where it is written (route → service → repository → column) to where it is read (StageExecutionService / WorkflowRunService / DAGScheduler / WorkflowOrchestrator / WorkflowPreprocessor). A grep hit alone did not count as proof. I also ran an **empirical probe** with `tsx`: the real `WorkflowDefinitionService`, the real Drizzle repositories and `migrateDB` on an in-memory SQLite database, all from `src`. The script is `scratchpad/roundtrip.mts`, and its output is quoted wherever it proves a claim. A second probe ran the built `ConditionEvaluator` (`packages/core/dist`). Its logic matches `src`.

---

## (a) Architecture

```
Web builder (WorkflowBuilderPage.tsx + workflowBuilderStore.ts)      CLI (cli-core/commands/workflow.ts)   Mobile (TemplatePickerSheet)
   │  N sequential HTTP calls per Save (no server-side batch)            │ export/import-json/clone/from-template
   ▼                                                                      ▼
HttpPlatformClient / client-core admin.ts ──► /api/workflow-definitions/*  (routes/workflowDefinitions.ts, zod `validate()` strips unknown keys)
                                              /api/workflow-scripts/*      (routes/workflowScripts.ts, NO zod; calls service directly)
                                              /api/orchestrator/* (createFromTemplate → importFromTemplate)
   ▼
WorkflowDefinitionService (packages/core/src/services/WorkflowDefinitionService.ts)
   createDefinition / updateDefinition / deleteDefinition(force) / addStage / updateStage / deleteStage / addEdge / deleteEdge
   validateDefinition (DAGValidator) / importFromTemplate / exportAsTemplate / importFromJSON
   ├─ uses templateStageToCreateParams (packages/shared/src/config/WorkflowTemplate.ts:438)
   ├─ TemplateRegistry (JSON templates parsed by WorkflowTemplateSchema at boot)
   └─ withTransaction (packages/db/src/index.ts:220), used ONLY for imports + deleteDefinition
   ▼
Drizzle repositories (packages/db/src/repositories/*): explicit column-by-column mapping in create/update/mapRow
   ▼
SQLite: workflow_definitions / stage_definitions / stage_edges / workflow_runs(definition_snapshot) / stage_runs
   ▲
Runtime readers: WorkflowRunService (createRun snapshot, launch, validation, context), StageExecutionService.executeStage
(reads the LIVE stage row), DAGScheduler (DAG from the snapshot), WorkflowOrchestrator + WorkflowPreprocessor (orchestratorConfig).

Parallel "authoring" paths that bypass the route schema:
  WorkflowBuilder/StageBuilder (.workflow.mjs) → WorkflowScriptLoader (dynamic import) → routes/workflowScripts.ts materialize (hand-mapped ×2)
  SDK ScriptFacade.materialize (hand-mapped, a 4th copy) and SDK WorkflowFacade.create (a 5th, minimal).
```

The main structural pattern behind most bugs here: **one field must be carried through 6 or more hand-written mappings**. They are the zod schema, the service entity literal, the repository `create`/`update`/`mapRow`, the DB column, the web `toStageParams`, `exportAsTemplate`, `templateStageToCreateParams`/`WorkflowTemplateStageSchema`, and three script materializers. Each earlier "fix" added the field to some of these layers and missed others.

---

## (b) Complete option catalog

Legend for the **Status** column:
- **LIVE**: settable, persisted, and read at runtime.
- **DEAD-READ**: persisted but never read at runtime.
- **NOT-PERSISTED**: accepted by the schema but dropped before the DB.
- **UNREACHABLE**: read at runtime, but nothing can persist it.

"UI" means the web StagePropertiesPanel/WorkflowConfigPanel, and the builder save path `toStageParams` (`apps/web/src/pages/WorkflowBuilderPage.tsx:66-86`).

### b.1 StageDefinition fields

| Field | Type / allowed | Default | Validation (CreateStageSchema `WorkflowDefinitionSchemas.ts:232-272`) | DB column (`schema.ts:415-457`) | Runtime reader | UI can set? | Status |
|---|---|---|---|---|---|---|---|
| `name` | string | "Stage N" (UI) | min 1, max 200 | `name` | stage_run.name copy; **contextSources match by name** `WorkflowRunService.ts:1817-1818`; profile overrides by name `:1880` | yes | LIVE (not unique, see A-22) |
| `description` | string | – | max 2000 | `description` | none at runtime (display) | yes | display-only |
| `templateId` | string | – | – | `template_id` | none. Template import path never sets it (template schema calls it `stageTemplateId`, `WorkflowTemplate.ts:282` vs mapper `:447`) | display | DEAD-READ |
| `order` | int ≥0 | max+1 (`WorkflowDefinitionService.ts:249,257`) | int min 0 | `order` | layout; **workflow-level resultValidations matched by `stageIndex === stageDef.order`** `WorkflowRunService.ts:1329` | yes | LIVE (fragile, A-22) |
| `prompts[].label` | string | – | min 1 | `prompts` JSON | UI/labels | yes | LIVE |
| `prompts[].text` | string with `{{var}}` | – | min 1 | 〃 | interpolated `StageExecutionService.ts:1855` | yes | LIVE |
| `prompts[].source` | `'inline'|'file'` | `'inline'` | enum | 〃 | **never read** (no `source`/`filePath` reader in core; `WorkflowPreprocessor` has none) | no | DEAD-READ (A-13) |
| `prompts[].filePath` | string | – | optional | 〃 | never read | no | DEAD-READ |
| `prompts[].attachments` | string[] | – | optional | 〃 | `ConfigResolver.ts:76` / SES prompt attachments | yes (PromptFilePicker) | LIVE |
| `prompts[].waitForCompletion` | bool | true | default true | 〃 | `StageExecutionService.ts:1995` (false means fire-and-forget `sendPrompt`, no deadline) | yes | LIVE |
| `promptType` | `'inline'|'file'` | 'inline' | `PromptTypeSchema` | **no column** | none (StageNode.tsx:96 compares to `'skills'`/`'agents'`, values the enum cannot hold) | no | NOT-PERSISTED + DEAD |
| `harnessConfigOverrides` | Partial<HarnessConfig> (see b.3) | – | HarnessConfigSchema (`:67-110`) | `harness_config_overrides` | copied key-by-key over the workflow config `StageExecutionService.ts:1152-1163` (only `mcpServers` shallow-merged); passed as `runtimeOverrides` to AgentResolver `:385-394` | model + reasoningEffort only | LIVE |
| `variables` | Record<string,unknown> | {} | record | `variables` | **never read**. Only `ConfigResolver.resolveStageConfig` (`ConfigResolver.ts:103-158`) merges it, and nothing calls that method. Stage launch passes `run.variables` (+ override vars) only: `WorkflowRunService.ts:1508-1522` | yes | DEAD-READ (A-11) |
| `hooks` | HookDefinition[] | [] | HookDefinitionSchema (`WorkflowTemplate.ts:11-84`) | `hooks` | pre_run/post_prompt/post_run `StageExecutionService.ts:1265-1288,2047,2275`; merged with `hooksFile.stages` `:1073-1074` | yes | LIVE |
| `retryPolicy` | {maxRetries 0-10, backoffMs ≥100, backoffMultiplier ≥1} | unset → error-retry default `{1,3000,1}` (`SES:192,2670`, `WRS:1653`), but validation-retry default 0 (`SES:215`, `WRS:1346`) | RetryPolicySchema `:43-47` | `retry_policy` | SES:2670, WRS:1346,1653 | yes | LIVE (inconsistent defaults, A-31) |
| `timeoutMs` | int ≥1000 | 300 000 (`SES:254`) per turn | min 1000, no max | `timeout_ms` | `SES:1995-1998` | yes | LIVE |
| `condition` | `{type: always|on_success|on_failure|expression, expression?}` | none (= run) | StageConditionSchema `:50-53` | `condition` | `DAGScheduler.ts:153-161` → `ConditionEvaluator.ts:27` evaluated against **each activating parent status**, `some()` | yes | LIVE (evaluator hazards, A-21) |
| `contextFilter` | `full|summary-only|none|structured` | `summary-only` (repo `:62`) | enum | `context_filter` | `StageExecutionService.ts:1672-1700` | yes | LIVE |
| `contextSources` | string[] (stage **names**) | undefined = DAG predecessors; [] = none | max 50 | `context_sources` | `WorkflowRunService.ts:1814-1824` | **no** (toStageParams omits) | LIVE via import/script only |
| `outputFormat` | `text|json` | `text` | enum | `output_format` | `SES:1807,3439` | **no** | LIVE via import/script only |
| `outputSchema` | JSON Schema | – | record | `output_schema` | `SES:1905,2079,2242` | **no** | LIVE via import only (script materialize drops it, A-17) |
| `expectedOutput` | string | – | max 5000 | `expected_output` | `SES:1898-1901` | **no** | LIVE via import only |
| `agentName` | string (legacy) | – | – | `agent_name` | `SES:374,390` → AgentResolver slug match | no | LIVE (legacy) |
| `agentRef` | `scope:slug` | – | max 128, nullable | `agent_ref` | `SES:372` (`stageDef.agentRef ?? workflow harnessConfig.agentRef`) | yes | LIVE |
| `skills` | `{name,directory?,description?}[]` | – | max 10 | **no column** | none | no | NOT-PERSISTED (A-1). Probe: `addStage` returned `skills=[{"name":"stage-skill"}]`, re-read `skills=undefined` |
| `resultValidation` | rule[] (b.5) | – | max 20 | `result_validation` | `WorkflowRunService.ts:1327-1332` (**live row**) | yes | LIVE |
| `iterationConfig` | {subWorkflowDefinitionId uuid, inputMapping, outputMapping, exitValue?, exitField?, maxIterations 1-100 (default 10)} | – | `:135-142` | `iteration_config` | **none**. The only references are schema, repository and service copies (`grep iterationConfig` over core returns only `WorkflowDefinitionService.ts:270`) | no | DEAD-READ (A-12) |
| `approvalRequired` | bool | false | optional | `approval_required` | `SES:2301` (HITL park) | yes | LIVE |
| `agentMode` | `auto|plan` (accepts the `interactive` alias) | inherit `auto` | AgentModeSchema | `agent_mode` | `SES:1929-1930,2322,3400` | **no** | LIVE via API/import only; **lost on export** (A-15) |
| `browserConfig` | BrowserConfig | – | BrowserConfigSchema | **no column** | none (no `stageDef.browserConfig` reader) | no | NOT-PERSISTED + DEAD (A-1) |
| `createdAt` | Date | now | – | `created_at` | – | – | – |

### b.2 WorkflowDefinition fields

| Field | Allowed | Default | Create schema | Persisted on **create**? (`WorkflowDefinitionService.ts:138-154`) | Persisted on **PATCH**? (`WorkflowDefinitionRepository.ts:129-145`) | Runtime reader | Status |
|---|---|---|---|---|---|---|---|
| `name` | 1-200 | – | yes | yes | yes | run name | LIVE |
| `description` | ≤2000 | – | yes | yes | yes (cannot clear from web, A-10) | – | display |
| `version` | int | 1 | – | yes | bumped only by PATCH `:196`; **not** by stage/edge edits; never checked | none | informational |
| `sessionMode` | single/per-stage/auto | auto | yes | yes | yes | run creation, `auto` resolved at start | LIVE |
| `harnessConfig` | b.3 | route injects `availableTools:['*'], streaming:true` (`routes/workflowDefinitions.ts:29-38`) | yes | yes | yes | `SES:1135-1150` + AgentResolver | LIVE (partially, A-32) |
| `variables` | VariableDefinition[] ≤50 (name regex `^[a-zA-Z_]\w*$`, type string/number/boolean/choice/text) | [] | yes | yes | yes | defaults merged `WorkflowRunService.ts:484-492`; type-checked `:430-472` | LIVE |
| `tags` | ≤20 × ≤50 chars | [] | yes | yes | yes | – | display |
| `orchestratorConfig` | b.4 | – | yes | yes | yes (full replace) | WorkflowOrchestrator/Preprocessor | partially LIVE (b.4) |
| `projectId` | uuid | – | yes | yes | yes (`null` allowed in zod; web never sends null, A-10) | workspace + worktrees `WRS:879` | LIVE |
| `skills` | SkillReference[] ≤20 | – | yes | **NO** (not copied) | yes | **none** | NOT-PERSISTED on create + DEAD-READ |
| `agents` | AgentReference[] ≤10 | – | yes | **NO** | yes | **none** | NOT-PERSISTED on create + DEAD-READ |
| `selectedArtifacts` | {skillIds,agentIds,promptIds} | {} | yes | yes | yes | **none server-side** | DEAD-READ |
| `useWorktree` | bool | DB default true | yes | **NO** | **NO** (no branch in repo update) | `WorkflowRunService.ts:698` | UNREACHABLE (always true) |
| `hooks` | WorkflowHookDefinition[] ≤50, 15 phases | [] | yes | yes | yes (web cannot delete the last hook, A-10) | `executeWorkflowHooks` `WRS:780-786,1399,1445,1517` | LIVE |
| `hooksFile` | {version:1, workflow[], stages{}} | – | yes | yes | yes | `hooksFile.stages` only (`SES:1073`); **`hooksFile.workflow` never read** | partial |
| `browserConfig` | BrowserConfig | – | yes | **NO** (no column) | **NO** | `WorkflowRunService.ts:705-707` | UNREACHABLE (A-1) |
| `defaultAgentRef` | `scope:slug` ≤128, nullable | – | yes | **NO** | yes | **none**. Only a reverse lookup in `AgentRepository.ts:183`. Stages fall back to `harnessConfig.agentRef` (`SES:372`) | DEAD-READ (A-3) |
| `scope` (DB only) | text | 'global' | not in schema | never written | never | none (web reads it via cast; `setScope` action is never called) | vestigial |

Probe output for create:
`[create] persisted skills= undefined agents= undefined browserConfig= undefined defaultAgentRef= undefined useWorktree= true`, even though the input had all five set.

### b.3 HarnessConfig (workflow `harnessConfig` and stage `harnessConfigOverrides`, `WorkflowDefinitionSchemas.ts:67-110`)

| Key | Stage path reads it? |
|---|---|
| model, harnessType, reasoningEffort, contextTier, maxTurns, permissionMode | yes, via `SES:1135-1150` and `AgentResolver.runtimeFromHarnessConfig` (`AgentResolver.ts:430-440`) |
| systemMessage {mode append/replace, content} | yes (`SES:1140`) |
| systemPromptAppend | stage-level yes (generic copy `SES:1154-1163`); **workflow-level no** (not copied at `SES:1135-1150`) |
| streaming | not used on the stage path |
| mcpServers (record of McpServerConfigSchema, stdio or http) | yes; stage overrides shallow-merge |
| availableTools / excludedTools | yes (an empty or absent list means unrestricted, `CopilotProvider.ts:201-207`, `ClaudeAgentProvider.ts:1272`) |
| excludedMcpServerIds, agentOverrides, agentRef | yes via AgentResolver (`AgentResolver.ts:116-173`) |
| skillDirectories, disabledSkills, customAgents, provider (BYOK incl. **plaintext apiKey**), configDir | yes (`SES:1144-1149`) |
| planModeInstructions | not on the workflow stage path |

### b.4 OrchestratorConfig (`WorkflowDefinitionSchemas.ts:145-166`; TS type `WorkflowOrchestrator.ts:174-203`)

| Key | Zod | Runtime reader | Status |
|---|---|---|---|
| category | enum, default custom | none meaningful | informational |
| parentTemplateId | optional | none | informational (wiped by web save, A-9) |
| **gitRepositories** | **not in zod, so stripped** (TS type marks it *required*) | `WorkflowOrchestrator.ts:316`, `WorkflowRunService.ts:886` | UNREACHABLE through the API; only `importFromTemplate` (repo write, no zod) stores `[]` |
| **codebaseAliases** | ≤5 × ≤50, default [] | **none server-side** (grep over core/server finds only a comment at `WorkflowOrchestrator.ts:1201`). Only web `WorkflowDefinitionPage.tsx:137-141` and the builder store read it client-side | DEAD-READ server-side (A-4) |
| **createWorktrees** | default true | **none** | DEAD-READ |
| preprocessingSteps | type run_script/validate_input/set_variable/conditional (**`clone_repo` missing** here but present in template schema `WorkflowTemplate.ts:217`), failOnError default **true** (template default **false**) | `WorkflowOrchestrator.ts:624-638` | LIVE (orchestrated runs only) |
| resultValidations | {stageIndex, rules[]} | `WorkflowRunService.ts:1327-1331` (matched by `order`) | LIVE (fragile) |
| requiresCodebase | default false | `WorkflowOrchestrator.ts:322` | LIVE |
| autoCommit / autoPush / autoCreatePR | optional | `WorkflowOrchestrator.ts:1186-1240` | LIVE (neutralised by A-5) |
| postProcessingSteps | {type string, name?, config?, failOnError?, order?}. **`enabled` stripped, `config` optional** | `WorkflowPreprocessor.ts:262` filters `s.enabled` | effectively DEAD via the API (A-5) |

### b.5 ResultValidationRule types (`WorkflowDefinitionSchemas.ts:122-126`, executed in `ResultValidator.ts:129-233`)
`contains`, `not_contains`, `min_length`, `max_length`, `regex`, `custom_script` (**runs `value` as a host command** via scriptRunner, cwd = run workspace, `ResultValidator.ts:146-172`), `json_schema`, `llm_validation`. `message` is required. The template variant (`WorkflowTemplate.ts:226-233`) allows only the first 5 and requires `value`.

### b.6 Edges

| edgeType | Active when predecessor is (`DAGScheduler.ts:92-103`) |
|---|---|
| `on_success` (default) | `completed` |
| `on_failure` | `failed` |
| `on_completion` | `completed` or `failed` |
| `always` | any terminal status (incl. skipped and cancelled) |

Readiness (`DAGScheduler.ts:127-164`):
- Every predecessor must be terminal.
- An inactive edge from a completed/failed/cancelled predecessor vetoes the stage (skip).
- An inactive edge from a *skipped* predecessor is neutral.
- At least one inbound edge must be active.
- Then `condition` must hold for at least one activating parent. A root stage uses the status `completed`.

Run terminal status: a failure is "handled" when an active out-edge leads to a completed stage (`:175-213`).

DB constraint: `UNIQUE(from_stage_id, to_stage_id)` (`schema.ts:482`), regardless of type. Edges have **no condition field**, although `WorkflowBuilder.edge(from,to,type,condition)` and the CLI docs suggest one.

### b.7 Condition expression syntax (`ConditionEvaluator.ts:53-385`)
- Leaves: `true`, `false`, and `left OP right` with OP in `== != < <= > >=`.
- Operands: `status` / `parentStatus`, `variables.a.b` (dotted path into **run.variables**, `DAGScheduler.ts:574`), quoted strings, numbers.
- Logic: `AND OR NOT` (case-insensitive), `&& || !`, and parentheses.
- Errors in the parse → false. However, **an unresolvable operand resolves to `undefined`, and `undefined == undefined` → true** (see A-21).

---

## (c) DB schema and operations

**Tables** (`packages/db/src/schema.ts`):

| Table | Structure | Indexes |
|---|---|---|
| `workflow_definitions` | `:378-412` | created_at, scope, project_id, default_agent_ref |
| `stage_definitions` | `:415-457`, FK→defs **CASCADE** | workflow, (workflow, order), agent_ref |
| `stage_edges` | `:460-484`, FK→defs CASCADE, FK→stages CASCADE ×2 | workflow, from, to, UNIQUE(from, to) |
| `workflow_runs` | `:487-545`, FK→defs **no cascade** (`:493`); columns `definition_snapshot` (`:530`), `agent_snapshot`, `ancestor_run_id` | definition, project, status, created, (status, created), parent_stage |
| `stage_runs` | `:548-619`, FK→runs CASCADE, **FK→stage_definitions no cascade** (`:557`; DDL `migrations/index.ts:341`); `version` optimistic lock, `heartbeat_at`, `lease_owner`, `wake_at` | – |
| `automation_execution_runs` | DDL `migrations/index.ts:412-419`: `workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE SET NULL` (**self-contradictory**), and `workflow_definition_id` FK with no cascade. Drizzle says `onDelete:'restrict'` (`schema.ts:774`), which does **not match** the real DDL. | – |

FK enforcement is ON (`db/src/index.ts:334`).

**Missing columns** relative to the domain types: `stage_definitions.skills`, `.prompt_type`, `.browser_config`, and `workflow_definitions.browser_config`. `use_worktree` exists (migration `:503`) but no code path writes it.

**JSON columns.** Validation is shape-only (`jsonArray` / `jsonRecord` guards, `StageDefinitionRepository.ts:26-33`). The update path even validates `resultValidation` with the *hooks* guard and `contextSources` with the *prompts* guard (`:112-115`), which is harmless but shows the guards are generic. Semantic validation happens only at the route (zod). The script materializers, the SDK facades and `importFromTemplate` call the service directly and **bypass zod entirely**.

**Transactions.**
- **Transactional:** `importFromTemplate` and `importFromJSON` (`WorkflowDefinitionService.ts:483,638`), and `deleteDefinition` (`:237-241`).
- **Not transactional:**
  - `deleteStage` (edges deleted one by one, then the stage, `:317-326`)
  - `reorderStages` (`StageDefinitionRepository.ts:149-159`)
  - `addEdge` validate-then-insert (TOCTOU, `:335-353`)
  - script materialize (`routes/workflowScripts.ts:116-175, 249-308`)
  - SDK create (`WorkflowFacade.ts`)
  - the web builder Save: 1 + N + M sequential HTTP calls (`WorkflowBuilderPage.tsx:299-470`), so any mid-save failure leaves a half-saved definition.
- **Caveat:** `withTransaction` keeps a raw `BEGIN` open across `await`s on the single shared connection (`db/src/index.ts:258-270`). Any unrelated async write issued meanwhile (event persistence, heartbeats) lands inside the import transaction and is rolled back with it.

**Definition versioning and mid-run edits.**
- `createRun` freezes `{stages, edges}` into `workflow_runs.definition_snapshot` (`WorkflowRunService.ts:408-423`), and `DAGScheduler.buildDAGForRun` builds topology from it (`DAGScheduler.ts:508-515`).
- However, `StageExecutionService.executeStage` re-reads the **live** stage row (`SES:1063`), as do result validation (`WRS:1327-1332`), the retry path (`WRS:1652`) and the orchestrator (`WorkflowOrchestrator.ts:840`).
- The definition's harnessConfig, hooks and orchestratorConfig are also re-read live at `WRS:779,1149,1225,1398,1444,1496,1568,1696,1752`.
- So an edit made while a run is in progress changes prompts, models, approval gates, retry and validation rules for stages that have not started yet. The snapshot already contains the full `StageDefinition` objects; the executor just does not use them (A-6).

**Soft delete.** None. Everything is a hard delete.

**Optimistic locking.**
- On definitions: none. `version` is bumped but never compared, so the last write wins across tabs/devices.
- On stages/edges: none.
- `stage_runs.version` exists for execution only.

**Orphans and deletes.**
- `deleteDefinition(force)` deletes runs through the repository (`:226-230`), not `WorkflowRunService.deleteRun` (`WRS:1269-1285`, which cancels active runs first). Running executors are orphaned.
- Deleting a definition referenced by an automation execution fails on the FK. The error is then mis-mapped to "existing workflow runs reference it" (`WorkflowDefinitionRepository.ts:163-166`).
- `deleteStage` on any stage that has ever run fails on the `stage_runs` FK *after* its edges are gone.
  - Probe: `[deleteStage] threw: SqliteError FOREIGN KEY constraint failed` → `[deleteStage] after failure: stages= [ 'A', 'B' ] edges= 0`

**Query shape / N+1.**
- `addStage` / `addEdge` each re-read all stages and edges to validate the DAG (`:248,290,346-347`), so importing 100 stages and 500 edges costs O(n²) queries.
- `deleteDefinition` loads every run row (including snapshot JSON) just to count them (`:217`).
- `listDefinitions` has no pagination (`WorkflowDefinitionRepository.ts:82-88`).
- `validateDAG` uses `sorted.includes` inside a filter (O(n²), `DAGValidator.ts:158`).

---

## (d) Import, export and templates

**Flows traced**

1. **Import JSON (web).**
   - Path: `WorkflowListPage.tsx:207-247` (checks `.json`, 5 MB, name, stages) → `HttpPlatformClient.importFromJSON` → `POST /import-json` with `validate(ImportWorkflowJsonSchema)` (`routes/workflowDefinitions.ts:239`) → `importFromJSON` (`WorkflowDefinitionService.ts:563-639`).
   - Edge indices are pre-checked (`:565-578`). Then everything happens in one transaction: createDefinition, addStage × N via `templateStageToCreateParams`, addEdge × M (each validates the DAG), and a final validate.
   - Cycles, self-edges and duplicate (from, to) pairs roll the whole import back: the first two via `DAGValidationError`, the third via the UNIQUE constraint → `ConflictError` 409 (`StageEdgeRepository.ts:30-34`).
   - Unknown keys are **silently stripped** (zod default strip, no `.strict()`). There is **no format/schema version** field.
   - Duplicate workflow or stage names are accepted.
   - A `'json-import'` tag is appended each time (`:589`), so repeated clones accumulate duplicate tags.
2. **Export.** `GET /:id/export` → `exportAsTemplate` (`:486-559`) returns a `WorkflowTemplate`-shaped object (not an `ImportWorkflowJson`). Edge indices fall back to `?? 0` (`:540-541`) instead of failing.
3. **Clone (CLI)** = export → delete `id` → import-json (`cli-core/commands/workflow.ts:425-437`). Every fidelity gap below therefore also hits `workflow clone`.
4. **Create from template.**
   - Two entry points: `POST /workflow-definitions/import` (`routes:219-236`, autoCommit **false**) and `WorkflowOrchestrator.createFromTemplate` (`WorkflowOrchestrator.ts:272-292`, autoCommit **true**).
   - Both go to `importFromTemplate` (`:398-484`) → `templateStageToCreateParams`.
   - Out-of-range template edges are **silently skipped** (`:464`).
   - Templates come from `TemplateRegistry.loadWorkflowTemplates` (`TemplateRegistry.ts:18-38`, invalid files are logged and skipped). `loadStageTemplates` is never called (only `loadWorkflowTemplates` at `composition-root.ts:2385,2390`), so `stageTemplateId` references are never resolved.

**Round-trip fidelity** (probe `export → ImportWorkflowJsonSchema → importFromJSON`):

| Survives | Lost |
|---|---|
| name, description, sessionMode, harnessConfig, variables, tags(+json-import), hooks; stage name, description, prompts (label/text/waitForCompletion/attachments), harnessConfigOverrides, variables, hooks, retryPolicy, timeoutMs, condition, contextFilter, contextSources, outputFormat, resultValidation, expectedOutput, outputSchema, approvalRequired, agentName, agentRef; edges and their types | **Stage:** `agentMode` (probe: `agentMode= undefined`; a plan-gated stage comes back as `auto`), `iterationConfig`, `templateId`, `prompts[].source/filePath`, (`skills`/`browserConfig`/`promptType` never persisted anyway). **Workflow:** entire `orchestratorConfig` (probe: `orchestratorConfig= undefined`). The export writes `preprocessingSteps`, `resultValidations` and `requiresCodebase` at top level, and ImportWorkflowJsonSchema strips them (probe list: `id, category, version, requiresCodebase, supportsMultipleCodebases, preprocessingSteps, resultValidations`). autoCommit/autoPush/autoCreatePR/codebaseAliases/postProcessingSteps are not exported at all. Also lost: `projectId`, `skills`, `agents`, `defaultAgentRef`, `hooksFile`, `selectedArtifacts`, `browserConfig`. `importFromJSON` also ignores the `orchestratorConfig`, `browserConfig` and `defaultAgentRef` that its own schema accepts (`:583-595`). |

System templates are not importable as JSON: 4 of 5 use `git_url` variables, which ImportWorkflowJsonSchema rejects (tplcheck probe).

**Template parsing hazards**
- `e2e-testing-workflow.json` still uses the pre-June-2026 key **`copilotConfig`**. WorkflowTemplateSchema strips it (probe: `topStripped= ['copilotConfig']`), so its `model: gpt-4.1` and the whole playwright-cli system message never reach definitions created from it.
- `TemplateHarnessConfigSchema` (`WorkflowTemplate.ts:155-200`):
  - When a harness object is present, it injects `model:'claude-sonnet-4.6'`, `streaming:true` and empty arrays.
  - It strips `harnessType`, `contextTier`, `permissionMode`, `agentRef`, `agentOverrides` and `excludedMcpServerIds`.
  - It narrows `mcpServers` to `{type,url,command,args}`, dropping `env`/`headers`.
  - A stage override that only sets `reasoningEffort` would therefore also force the model.
- Template `hooks` use the *stage* HookDefinitionSchema (`:380`) but are stored as *workflow* hooks, so stage phases there never fire.

**`.workflow.mjs` scripts**
- These are **arbitrary in-process code** (`import()` with a cache-bust query, `WorkflowScriptLoader.ts:196-217`).
- Gating: `assertEnabled()` defaults to disabled (`:107-137`). Upload additionally needs `GENERATORAI_ALLOW_SCRIPT_UPLOAD=true` (`routes/workflowScripts.ts:389`).
- Path containment uses realpath (`:487-503`).
- Residual risks are A-19.
- Validation uses `WorkflowScriptOutputSchema.safeParse` but then keeps the **raw** object (`:237-243`), so unvalidated extra keys flow through.
- Schema drift vs the route schema:
  - `backoffMs ≥0` vs `≥100`
  - `timeoutMs >0` vs `≥1000`
  - hook `phase: z.string()`
  - http methods GET/POST/PUT only
  - `iterationConfig.subWorkflowDefinitionId` optional vs uuid-required
  - `prompts[].text` may be empty

---

## (e) Issues

Severity scale:
- **P0**: data loss or security in a common path
- **P1**: a feature is broken or dead, or silent data loss
- **P2**: correctness or security hardening
- **P3**: hygiene, performance or docs

### Verification of the Sept 2026 "already fixed" items

| Prior fix | State on this branch |
|---|---|
| Edge-type picker | **Present.** Canvas picker `StageEdge.tsx`; save deletes and re-adds re-typed edges (`WorkflowBuilderPage.tsx:410-440`). |
| toStageParams unification | **Present but incomplete.** One mapper, but it omits contextSources, outputFormat, outputSchema, expectedOutput, agentMode, skills, browserConfig, promptType, iterationConfig, agentName (`:66-86`). |
| exportAsTemplate dropping fields | **Partially fixed.** Still drops agentMode, iterationConfig, templateId, prompt source/filePath, and all workflow-level orchestrator/project/agent fields (A-15). |
| createFromTemplate fidelity | **Fixed** in that there is now one importer. The shared mapper still omits agentMode/skills/browserConfig/promptType/iterationConfig (A-16), and one shipped template loses its harness config (A-14). |
| addStage dropping agentRef/skills/promptType/agentMode/browserConfig | **Half fixed.** The service copies them (`:280-284`) and agentRef/agentMode persist, but the **repository and DB have no columns** for skills/promptType/browserConfig, so they are still dropped (A-1). The 201 response echoes them back, which hides the loss. |
| codebaseAliases stripped by zod | **Schema fixed** (`:149`), but **nothing on the server reads it** (A-4). |

### Issue list

**A-1 (P1): Stage `skills`, `promptType`, `browserConfig` and workflow `browserConfig` are never persisted**
- Evidence:
  - no columns (`schema.ts:415-457`, `:378-412`)
  - `StageDefinitionRepository.ts:48-74,117-140,189-216`
  - `WorkflowDefinitionRepository.ts:42-61,129-145,172-194`
  - the runtime reads workflow browserConfig at `WorkflowRunService.ts:705-707`
- Scenario: a user sets a per-stage browser override or stage skills through the API, SDK or script. The call returns 201 with the values echoed. On reload they are gone, and the workflow-level Integrated Browser default can never take effect.
- Probe: `re-read skills= undefined promptType= undefined browserConfig= undefined`.
- Fix: add migration columns (`stage_definitions.skills/prompt_type/browser_config`, `workflow_definitions.browser_config`) and map them in create/update/mapRow. Return the **re-read** row from `create`. Add a repository round-trip test that iterates over every key of `CreateStageSchema.shape`.

**A-2 (P1): `createDefinition` silently drops skills, agents, defaultAgentRef, useWorktree and browserConfig**
- Evidence: `WorkflowDefinitionService.ts:138-154` builds the entity without them. `useWorktree` has no repository write on create or update (`WorkflowDefinitionRepository.ts:42-61,129-145`).
- Scenario: `import-json`, script materialize (`routes/workflowScripts.ts:124-125,257-258`) and the SDK (`ScriptFacade.ts:90-91`) all pass skills/agents, and they vanish. `useWorktree:false` is impossible, so every project workflow creates worktrees (`WRS:698`).
- Fix: spread the validated params into the entity (or derive the entity from the zod output type), and add `useWorktree` to the repository.

**A-3 (P1): `defaultAgentRef` is never used at runtime**
- Evidence: the only readers are `AgentRepository.ts:183` (reverse lookup) and the definition repository. Stage resolution uses `stageDef.agentRef ?? workflowharnessConfig?.agentRef` (`SES:372`).
- Scenario: a user sets the workflow default agent; stages without their own binding run with no agent.
- Fix: `stageDef.agentRef ?? definition.defaultAgentRef ?? harnessConfig.agentRef`, passing the definition into `executeStage`. Alternatively, remove the field and migrate it into `harnessConfig.agentRef`.

**A-4 (P1): Persisted `codebaseAliases`, `createWorktrees` and `useWorktree` have no server-side reader; direct runs use all project codebases**
- Evidence:
  - `WorkflowRunService.ts:883-892` uses `orchestratorConfig.gitRepositories`, which zod strips, else **ALL ready codebases**.
  - `WorkflowOrchestrator.ts:505-515` uses the client's `selectedCodebases`, else all.
  - `grep codebaseAliases` over core/server finds a comment only.
- Scenario: a workflow saved with `codebaseAliases:['frontend']` in a 6-codebase project, run from the CLI, mobile, an automation, a retry or a script, creates 6 worktrees and exposes every repo to the agent. Only the web builder and definition pages pass the aliases.
- Fix: in both run paths, default `selectedCodebases` to `definition.orchestratorConfig.codebaseAliases` before falling back to all. Honour `createWorktrees`/`useWorktree`.

**A-5 (P1): Explicit `postProcessingSteps` never run, and they disable `autoCommit`**
- Evidence:
  - The zod object (`WorkflowDefinitionSchemas.ts:159-165`) has no `enabled`, so it is stripped (probe: `postProcessingSteps[0].enabled = undefined`).
  - `WorkflowPreprocessor.ts:262` filters on `s.enabled`.
  - `WorkflowOrchestrator.ts:1205-1216` counts the explicit step as `hasExplicitCommit`, which suppresses the auto-commit step.
  - `config` is optional in zod, but `s.config.type` is dereferenced unguarded (`:1215`), which throws TypeError.
- Scenario: a user adds a `run_script` or `commit_and_push` post step via API/import. It is silently skipped, and autoCommit silently stops working.
- Fix: add `enabled: z.boolean().default(true)` and make `config` required with a discriminated union matching `PostProcessingStepConfig`. Treat `enabled !== false` as enabled.

**A-6 (P1): Mid-run edits leak into in-flight runs (the snapshot covers topology only)**
- Evidence: `SES:1063`, `WRS:1327-1332,1652`, `WorkflowOrchestrator.ts:840`, plus live definition reads (list in c). The snapshot includes full stage objects (`WorkflowRun.ts:15-20`).
- Scenario: while stage 1 runs, the user edits stage 3's prompt, removes its approval gate or changes its model. Stage 3 executes with the new config, so the run is not reproducible and a retry of the ancestor differs.
- Fix: have `executeStage` and validation resolve the stage from `run.definitionSnapshot.stages` (fall back to live only when there is no snapshot). Snapshot the workflow-level harnessConfig, hooks and orchestratorConfig too.

**A-7 (P1): `deleteStage` corrupts the definition for any stage that has ever run**
- Evidence: `stage_runs.stage_definition_id` has an FK with no cascade (`schema.ts:557`, `migrations/index.ts:341`). `deleteStage` deletes the edges first, outside a transaction (`WorkflowDefinitionService.ts:317-326`). The raw SqliteError is not mapped, so it surfaces as a 500.
- Probe: edges 1→0, stage kept.
- Scenario: in the builder, a user removes a stage from a workflow that has run history and clicks Save (`WorkflowBuilderPage.tsx:379-382`). Save fails with 500 and the definition has lost its edges. The stage also becomes undeletable forever.
- Fix: wrap the delete in `withTransaction`. Either (a) switch stage_runs' FK to `ON DELETE SET NULL` (stage_runs already copies `name`) or keep an archived/soft-deleted stage row, or (b) return 409 before touching the edges.

**A-8 (P1): Builder update-save breaks when a new stage is connected to an existing workflow**
- Evidence:
  - New stages get the id `stage-<ts>-<rand>` (`WorkflowBuilderPage.tsx:235`).
  - The update path adds them without recording the server id (`:394-399`).
  - It then posts edges with `fromStageId: edge.source` (`:431`).
  - `CreateEdgeSchema` requires a uuid (`WorkflowDefinitionSchemas.ts:277-278`), so the request returns 400.
  - The stage was already created. The query invalidation then reloads the store (`:202-206`), and the user's edge disappears.
- Scenario: open a saved workflow, add a stage, connect it, click Save. The save errors, the stage exists disconnected, and the edge is lost. Saving a second time after redrawing works.
- Fix: keep a `localToServerId` map in the update path too, as the create path does (`:325-339`). Better, add a server-side `PUT /:id/graph` that replaces stages and edges in one transaction.
- Recommend a live re-check (the logic is static-traced).

**A-9 (P1): Builder save wipes template-derived orchestrator settings**
- Evidence: `buildOrchestratorConfig` (`WorkflowBuilderPage.tsx:266-296`) always sends `category:'custom'`, `preprocessingSteps:[]`, `resultValidations:[]`, `postProcessingSteps:[]` and `requiresCodebase:true`, and drops `parentTemplateId`. When no codebases are selected it returns `undefined`, meaning "no change".
- Scenario:
  - A workflow created from a template with preprocessing steps and result validations loses them on its first save with a codebase selected.
  - Deselecting all codebases, or turning autoCommit off after deselecting, can never be persisted.
- Fix: start from `definition.orchestratorConfig` and overwrite only the builder-owned keys. Send an explicit empty config to clear.

**A-10 (P1): Fields cannot be cleared**
- Evidence:
  - Route schemas are `.optional()` but not `.nullable()` (probe: null for timeoutMs/retryPolicy/contextSources is rejected).
  - The repositories skip `undefined` (`StageDefinitionRepository.ts:117-140`, `WorkflowDefinitionRepository.ts:129-145`).
  - The web sends `description || undefined`, `projectId ?? undefined`, and `hooks.length>0 ? hooks : undefined` (`WorkflowBuilderPage.tsx:309,314,319,362,367,369`).
- Scenario: a user removes a stage timeout, retry policy or condition, empties the description, unlinks the project, or deletes the last workflow hook. After Save, the old value is still there.
- Fix: accept `null` as "clear" for every optional field (as `agentRef` already does) and map `null` to a column NULL. Have the web send `null` instead of `undefined`.

**A-11 (P1): Stage-local `variables` are dead**
- Evidence:
  - `ConfigResolver.resolveStageConfig` (`ConfigResolver.ts:103-158`) is the only merger and has no callers.
  - Launch passes only `run.variables` plus override vars (`WorkflowRunService.ts:1508-1522`).
  - The UI edits them (`StagePropertiesPanel` `onUpdate({variables})`).
  - Script materialize even bakes the run's variables into them (`routes/workflowScripts.ts:274-276`).
- Scenario: a per-stage `{{lang}}` default never interpolates, and a "Missing variable" warning appears.
- Fix: merge `definition var defaults → stage.variables → run vars → override vars` at launch, or delete `resolveStageConfig` and the UI field.

**A-12 (P1): `iterationConfig` (sub-workflow loop stages) is validated, persisted, exported by builders, and never executed**
- Evidence: no reader in core (grep). The `stage_runs.iteration_index` / `parent_stage_run_id` columns are also unused by definitions. The docs admit "runtime deferred" (`feature-stages.md` §7.8).
- Scenario: a script uses `.iterationConfig(...)`. The stage runs once as a normal prompt stage (or with no prompt at all).
- Fix: reject `iterationConfig` at the schema until an executor exists, or implement it.

**A-13 (P1): File prompts are dead, and `StageBuilder.promptFile()` sends an empty prompt**
- Evidence:
  - `StageBuilder.ts:78-87` sets `text:''` with `source:'file'`.
  - No code reads `source` or `filePath` (grep of core; `WorkflowPreprocessor` has none, contrary to `feature-stages.md` §7.2).
  - `promptType` is not persisted (A-1).
- Scenario: an SDK/script author uses `.promptFile('prompts/review.md')`. The agent receives an empty user message. A later web PUT of that stage fails with 400 (`text.min(1)`).
- Fix: resolve `filePath` at execution (within the project prompts directory, using realpath containment), or remove `promptFile`, `source`, `filePath` and `promptType`.

**A-14 (P1): The shipped e2e-testing template loses its model and system prompt**
- Evidence: `templates/system/e2e-testing-workflow.json` uses the key `copilotConfig`, which WorkflowTemplateSchema has no field for, so it is stripped (tplcheck probe).
- Scenario: Settings → Templates → E2E Testing creates a workflow with no `gpt-4.1` and no playwright-cli instructions. The agent does not know the tool exists.
- Fix: rename the key to `harnessConfig`, and add a CI test that parses every template with `.strict()`, or at least fails when a top-level key is stripped.

**A-15 (P1): Export → import (and CLI `workflow clone`) is lossy**
- Evidence: `exportAsTemplate` (`WorkflowDefinitionService.ts:486-559`), `ImportWorkflowJsonSchema` (`WorkflowDefinitionSchemas.ts:352-377`), and `importFromJSON` ignoring orchestratorConfig/browserConfig/defaultAgentRef (`:583-595`). The probe output is in section (d).
- Scenario: `workflow clone` of a project-linked, auto-PR workflow with a plan-mode approval stage produces a copy with no project, no codebases, no auto-commit/PR, no workflow result validations, no preprocessing, and a stage that implements without a plan.
- Fix:
  - Make export emit exactly `ImportWorkflowJson` plus a `formatVersion` field, and include every persisted field.
  - Make import pass them all through.
  - Add a property test: `import(export(def)) ≅ def` over every field of the stage and definition schemas.

**A-16 (P1): The "single mapper" `templateStageToCreateParams` does not cover the schema**
- Evidence: `WorkflowTemplate.ts:438-466` omits agentMode, skills, browserConfig and promptType. `WorkflowTemplateStageSchema` (`:277-336`) lacks them plus iterationConfig and templateId. `importFromJSON` routes `ImportStageSchema` data, which does accept those, through this mapper (`:601-606`).
- Scenario: an import JSON carrying `agentMode:'plan'` is accepted and the value is dropped.
- Fix: derive the mapper from `CreateStageSchema.omit({workflowDefinitionId})` (for example `pick` + spread) so new fields flow automatically. Add a compile-time exhaustiveness check.

**A-17 (P2): Script materialization is hand-mapped three times and loses fields**
- Evidence: `routes/workflowScripts.ts:116-175` and `:249-308`, and `ScriptFacade.ts:81-130`.
- What is dropped:
  - All three: outputSchema (so `.outputSchema()` in `e2e-feature-coverage.workflow.mjs:119` is lost), expectedOutput, resultValidation, agentMode, browserConfig, and definition `orchestratorConfig`/`useWorktree`. That makes `WorkflowBuilder.preprocessingStep/resultValidation/requiresCodebase/useWorktree` dead.
  - ScriptFacade also drops approvalRequired.
- Other problems:
  - Not transactional.
  - Bypasses route zod.
  - `/run` creates a **new definition on every run** (unbounded growth).
- Fix: build an `ImportWorkflowJson` from the script output and call `importFromJSON` (transactional and validated). For `/run`, reuse or upsert by script id plus a content hash.

**A-18 (P2): Script inline hooks break after a restart or reload**
- Evidence:
  - Handler keys are `script:<id>:<hookId>` with random ids generated on every import (`WorkflowBuilder.ts` addInlineWorkflowHook, `StageBuilder.ts:178`). They are persisted into definitions (`WorkflowScriptLoader.ts:274-296`).
  - `reloadScript` calls `unregisterScriptHooks(id)` *after* `loadScript` has already replaced the cache entry, so it unregisters the **new** handlers (`:354-373`).
  - `reloadAll` never unregisters.
  - A missing handler throws `HookConfigError` (`HookExecutor.ts:585-591`), which the default policy `continue` swallows.
- Scenario: after a server restart, every previously materialized script workflow's inline `onRunComplete` hook silently stops firing.
- Fix: use deterministic hook ids (script id + phase + ordinal). Capture the old script before swapping and unregister its keys.

**A-19 (P2, security): Script upload and validate hardening**
- Evidence:
  - Upload requires only `write:workflows` (`packages/auth/src/routePolicy.ts:125`), whereas agent writes require `admin:settings` (`:88`).
  - It writes into `templates/scripts` (`composition-root.ts:2177-2180`), so it can overwrite shipped scripts.
  - The file is written *before* validation (`WorkflowScriptLoader.ts:420-425`), so a script that fails validation stays on disk and is re-imported (executed) at every boot.
  - `/validate` imports any path under `templatesDir` with no `.workflow.mjs` check (`:436-452`).
- Fix: require `admin:settings`, write to a temp file and validate before renaming into place, refuse to overwrite shipped names, and enforce the extension in `validateScriptPath`.

**A-20 (P2, security): Definitions can execute host commands, and their secrets are readable**
- Evidence (commands):
  - Workflow and stage hooks (script `command`/`env`, function `modulePath`)
  - `harnessConfig.mcpServers` stdio commands
  - preprocessing/post-processing `run_script`
  - `resultValidation.custom_script` (`ResultValidator.ts:146-172`)
  - All of these are writable with `write:workflows` alone.
- Evidence (secrets): `harnessConfig.provider.apiKey`, hook `headers` and `env` are stored in plaintext and returned by GET, export and the list endpoint to `read:workflows` principals (there is no redaction in the route/service/repository).
- Scenario: a paired device with `write:workflows` but not `exec:agent` plants a command in a hook. It executes when the owner next runs the workflow.
- Fix: require elevated scope for command-bearing fields, and use `secretref:` for provider keys and hook headers (as MCP already does).

**A-21 (P2): Condition evaluator returns true for unresolvable comparisons**
- Evidence: `ConditionEvaluator.ts:268-276,282-322,341-367`.
- Probe:
  - `{{enable_tests}} === true` with `enable_tests=false` → **true**
  - `variables.missing == variables.other` → true
  - `retryCount < 3` → false (documented as supported but not resolvable)
  - bare `variables.enable_tests` with the string `"false"` → true
- Scenario: the shipped `e2e-feature-coverage.workflow.mjs` stage `keywords` condition (`.condition('{{enable_tests}} === true')`) is always true, so the stage never skips.
- Fix:
  - Treat unknown identifiers and `===` as parse errors (→ false).
  - Coerce the strings `'true'`/`'false'`.
  - Parse conditions at save time in `validateDAG` (the docs already claim this happens).

**A-22 (P2): Name- and order-based cross-references are fragile**
- Evidence:
  - `contextSources` resolves by `stage_run.name` with first match (`WRS:1817`).
  - Profile overrides match by name or array index (`WRS:1880`).
  - Workflow-level resultValidations match by `stageIndex === order` (`WRS:1329`). `order` is not compacted after deletes, and export rewrites `order: i` (`WorkflowDefinitionService.ts:515`).
  - There is no uniqueness check on stage names and no save-time validation of contextSources.
- Scenario: renaming stage "Plan" silently removes it from its successors' context. After deleting stage 2, a workflow validation rule attaches to a different stage, or to none.
- Fix: store stage ids for these references (translate names to ids at import time), enforce unique stage names per definition, and validate references in `validateDAG`.

**A-23 (P2): Delete semantics**
- `deleteDefinition(force)` bypasses `WorkflowRunService.deleteRun`, so active runs are not cancelled (`:226-230` vs `WRS:1269-1285`).
- `automation_execution_runs` DDL: `NOT NULL … ON DELETE SET NULL`, so deleting a run that an automation references fails. Its definition FK also has no cascade. The drizzle schema claims `restrict` (drift).
- The FK error message wrongly blames "workflow runs".
- Fix: route force-delete through the run service, fix the DDL in a new migration, and map FK errors precisely.

**A-24 (P2): No atomic graph save and no concurrency control**
- The web save is 1 + N + M HTTP calls.
- `addEdge` validate-then-insert is a TOCTOU window: two concurrent adds can close a cycle.
- Definition `version` is never compared, so the last writer wins across tabs/devices.
- Stage/edge edits do not bump `version`.
- Fix: a `PUT /workflow-definitions/:id` with `{definition, stages, edges, expectedVersion}` applied in one transaction with a DAG check.

**A-25 (P2): Nested routes do not check ownership**
- Evidence: `PUT/DELETE /:id/stages/:stageId` and `DELETE /:id/edges/:edgeId` ignore `:id` (`routes/workflowDefinitions.ts:140-165,189-200`), so one definition's URL can mutate another definition's stage.
- Fix: assert `stage.workflowDefinitionId === :id`.

**A-26 (P2): Template schema hazards**
- The harness default injection and narrowing, stage-schema hooks at workflow level, never-loaded stage templates and silently dropped out-of-range edges described in (d).
- The two template endpoints disagree on autoCommit (`false` at `WorkflowDefinitionService.ts:432` vs `true` at `WorkflowOrchestrator.ts:290`).
- Fix: reuse `HarnessConfigSchema` for templates (no defaults), validate edge indices, and choose one autoCommit default.

**A-27 (P2): SDK `WorkflowFacade.create` is lossy and can write invalid data**
- Evidence (`packages/sdk/src/facades/WorkflowFacade.ts`):
  - `harnessOverrides` and `variables` are accepted and never forwarded.
  - `systemPrompt` is put on the prompt object, where it is ignored.
  - `hooks: stageInput.hooks as never` persists `{phase, config}` objects with no id, type or failurePolicy.
  - There is no retry, timeout, agentRef or approval support, and no transaction.
- `ScriptFacade.run` ignores profile `stageOverrides`, `permissionMode` and `sessionMode`, which the server honours (`routes/workflowScripts.ts:215-246`).
- Fix: accept `CreateStageParams` or builder output, and run it through the zod schemas plus `importFromJSON`.

**A-28 (P2): Builder API parity gaps**
- StageBuilder has no `resultValidation`, `agentMode` or `browserConfig`.
- `expectedOutput()` appends to the prompt text instead of setting the field, and does nothing if called before `prompt()` (`StageBuilder.ts:160-166`).
- `condition()` supports expressions only.
- `edge(…, condition)` emits a condition that has nowhere to be stored.
- `resultValidation(stageId)` called before the stage is declared maps to stageIndex 0 (`WorkflowBuilder.ts` resultValidation).
- Defaults differ from the schema: `backoffMultiplier` 1 vs 2, hook `failurePolicy` `continue` vs `skip`.

**A-29 (P3): Stage-override fields are accepted but ignored**
- RunProfile/StageRunOverride `agentName`, `timeoutMs` and `contextFilter` are accepted (`WorkflowDefinitionSchemas.ts:386-399`) but never applied. Only `skip` and `variables` are consumed (`WRS:1863-1883,1502-1511`).

**A-30 (P3): DAGValidator gaps**
- The disconnected-stages and no-root checks are unreachable once the graph is acyclic (`DAGValidator.ts:167-200`).
- The duplicate check is keyed by type, while the DB unique constraint is on (from, to) only.
- There is no validation of conditions, contextSources, iterationConfig references, JSON output without a schema, or duplicate names.

**A-31 (P3): Inconsistent retry defaults**
- With no retryPolicy, an execution error retries once (`SES:192,2670`; `WRS:1653`) but a validation failure never retries (`SES:215`; `WRS:1346`). The docs say both default to `{1,3000,1}`.

**A-32 (P3): Declared but unread at the workflow level**
- `harnessConfig.systemPromptAppend`, `planModeInstructions` and `streaming` (`SES:1135-1150`)
- `hooksFile.workflow`
- `selectedArtifacts` (server side)
- `scope` column (the `setScope` store action is dead)
- The legacy `workflows` table is only read by `routes/hooks.ts:72`.

**A-33 (P3): Performance**
- O(n²) re-reads on import.
- A full run load just to count runs on delete.
- The definition list is unpaginated.
- `validateDAG` uses `includes` inside a filter.

**A-34 (P3): `withTransaction` absorbs unrelated writes**
- Unrelated async writes on the shared connection are absorbed into an open import transaction (`db/src/index.ts:258-289`). This is a cross-cutting design risk.

**A-35 (P3): Export format hygiene**
- The export includes the source `id`.
- It has no format version.
- The edge fallback `?? 0` silently rewires dangling edges.
- `json-import` tags accumulate on repeated clones.

---

## Doc drift (`.github/docs`)

**feature-workflows.md**
- §2.1 describes inline `stages`/`edges`/`scope` on create, a transactional DAG check and a WithStages return. None of that exists; create returns a bare definition. `useWorktree` is accepted and then dropped.
- §2.2 lists query params `scope`/`tags`/`search`. Only `projectId` is supported (`routes:51-59`).
- §2.3 says stage update is PATCH; it is **PUT** (`routes:140`). "Any field bumps version" is true only for PATCH on the definition.
- The "delete with active runs" note and §2.6 say 400; the code returns **409** with `?force=true`, and the delete is manual, not an FK cascade.
- §2.4 claims "schema validation of every stage" and "condition.expression resolution check". Neither happens, and the response also has `issues`.
- §2.5 and §5 document `POST /from-template/:templateId`, which does not exist; the real route is `POST /import {templateId}`.
- §3.2 lists `reasoningEffort` twice and omits harnessType, contextTier, permissionMode, agentRef, agentOverrides and excludedMcpServerIds.
- §3.5 documents `scope`, which cannot be set.
- §3.6 lists orchestratorConfig keys that do not exist (`templateId`, `preprocessing`, `postprocessing`, `selectedArtifacts`) and says "the run path reads codebaseAliases", which is false (A-4).
- §3.7 says tags are normalised to lowercase; there is no such code.
- §4 says disconnected stages "never run" (they are roots and do run) and that evaluation happens in `onStageCompleted` (now `reconcileDAG`).
- §6: `edge add --condition` does not exist (edges have no condition, and the CLI has only `--on`); `--timeout` is in seconds, not ms.
- §7: the whole SDK example is fictional. There is no `workflow()` export, `.id()`, `.profile()`, StageBuilder `.resultValidation()` or `.agentName()`, and `ai.workflows.create` takes `CreateWorkflowInput`, not builder output.
- §8.2 says "renaming a stage does not break anything", which is false (A-22).

**feature-stages.md**
- §1 DB shape omits agent_ref, agent_mode, approval_required and expected_output.
- §2.3 documents PromptDefinition fields `source:'agent'`, `wait` and `isFollowUp`, which do not exist. The real field is `waitForCompletion`, and it defaults to **true**, not false.
- §2.5 says MCP exclusions go into `excludedTools`, contradicting the page's own header (`excludedMcpServerIds`).
- §2.6 says AgentSelector writes `agentName` and `customAgents`; it now writes `agentRef`.
- §2.7 describes stage variables as working; they are dead (A-11).
- §3.1 says `on_success` requires *all* predecessors; the code uses *any* activating parent (`DAGScheduler.ts:156-160`).
- §3.4 retry defaults apply only to execution errors (A-31).
- §5 says update is PATCH (it is **PUT**) and that delete is "in-tx" with an edge-replacement check. It is not transactional and there is no such check (A-7).
- §6 CLI example uses `--timeout 60000`, but the flag is in seconds.
- §7.2 says file prompts are read by WorkflowPreprocessor. Nothing reads them (A-13).
- §7.10 references `skipUnreachableStages`, which no longer exists.

**feature-workflow-runs.md §1**
- `workflow_runs` omits `cancelling`, `definition_snapshot`, `agent_snapshot`, `ancestor_run_id` and `parent_stage_run_id`.
- `stage_runs` omits `output_text`, `artifact_manifest`, `heartbeat_at` and `lease_owner`.
- `projectId` is shown as an FK; it has no FK.
- Nothing documents that stage config is read live mid-run (A-6).
