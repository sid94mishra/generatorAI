# G3 — Legacy/duplicate audit: shared types/config/builders, cli-core, sdk facades, mcp-server, templates, workflow docs

Scope covered: packages/shared/src/{types,config,builders}, packages/cli-core/src/commands/{workflow,run}.ts,
packages/sdk/src/facades/{WorkflowFacade,ScriptFacade}.ts, packages/mcp-server, templates/**, .github/docs/feature-{workflows,stages,workflow-runs}.md.

No files were edited — read-only analysis per instructions.

---

## 1. Legacy fields / aliases in schemas & types

### 1.1 `agentName` (vs `agentRef`) — REMOVABLE, low-med risk
- `packages/shared/src/types/StageDefinition.ts:106-109` — `agentName?: string` explicitly marked `@deprecated superseded by agentRef`; `agentRef?: string` sits right below it. Also on `CreateStageParams:178-180`.
- `packages/shared/src/config/WorkflowDefinitionSchemas.ts:252-253,270-271` (`CreateStageSchema`), `:324,341` (`ImportStageSchema`) — both fields co-exist; comment says "`agentRef` … Supersedes `agentName`" but there is **no zod `.transform`/alias** — both are independently optional, no migration logic maps one to the other.
- `packages/shared/src/config/WorkflowTemplate.ts:331-332` (`WorkflowTemplateStageSchema`) — same duplication; `templateStageToCreateParams` (`:459-460`) forwards both `agentName` and `agentRef` verbatim.
- `packages/shared/src/builders/StageBuilder.ts:96-111` — `.agent(name)` (legacy artifact-name lookup, comment says so explicitly at line 104-106) vs `.agentRef(ref)` — two builder methods for the same concept.
- Readers: `packages/core/src/services/AgentResolver.ts`, `WorkflowDefinitionService.ts`, `WorkflowRunService.ts`, `StageExecutionService.ts` all handle `agentName` as a fallback path alongside `agentRef` (grep hit in all of them — 90 total repo-wide hits of `agentName`, many are UI/route plumbing that would need updating too: `apps/web/src/components/workflow/StageNode.tsx`, `apps/web/src/stores/workflowBuilderStore.ts`, `apps/web/src/pages/ChatPage.tsx`, `apps/server/src/routes/orchestrator.ts`, `apps/server/src/routes/workflowScripts.ts`).
- **Verdict**: genuine legacy alias, explicitly labeled `@deprecated` in source. Since no back-compat is required, collapse to `agentRef` only. Removal touches shared types/schemas/builders + ~8 core/server/web files. Risk: **medium** (UI still writes `agentName` in `apps/web/src/stores/workflowBuilderStore.ts` — must be migrated to `agentRef` first).

### 1.2 `copilotConfig` (vs `harnessConfig`) — MOSTLY DONE, one orphan
- Type/schema layer is already clean: no `copilotConfig` field exists in `WorkflowDefinition`, `StageDefinition`, or any Zod schema in scope — the June-2026 rename completed there.
- **Orphan**: `templates/workflow-upload-template.json:14` — `"copilotConfig": {}` top-level key, a sample/example JSON meant for the manual "upload a workflow JSON" flow. It is not referenced anywhere in code (`grep -rln "workflow-upload-template"` → no hits), so it is dead sample content using the pre-rename field name; importing it today would just have that key silently stripped by `ImportWorkflowJsonSchema` (which has no `copilotConfig` field). **Removable, trivial, no risk** — either delete the file or fix the key to `harnessConfig`.
- `packages/sdk/src/config.ts` and `packages/sdk/README.md` also reference `copilotConfig` but that's SDK-level provider config, out of the workflow scope of this audit.

### 1.3 `interactive` agentMode alias — GENUINE, keep (per product's own words) but worth flagging
- `packages/shared/src/types/AgentMode.ts:118-144` — `LEGACY_MODE_ALIASES = { interactive: 'auto' }`, `coerceAgentMode()` folds it onto `'auto'`, documented as "v1 name … persisted rows are migrated (v22), but API clients, workflow definitions exported before the rename … may still send it."
- `packages/shared/src/config/ChatSchemas.ts:11-30` — `AgentModeSchema` explicitly built around `coerceAgentMode`, comment: "Exported workflow definitions and older API clients still send `'interactive'`."
- `packages/shared/src/config/WorkflowDefinitionSchemas.ts:266,336` — stage `agentMode` field comment: "Accepts the legacy `'interactive'` alias."
- **Verdict**: this is explicit backward-compat for exported JSON files and DB rows already migrated (v22). Since "no backward compatibility required," and DB rows are already migrated forward, this alias only matters for **externally exported workflow JSON files created before the rename**. Given no live users/no compat requirement, this is removable — drop `LEGACY_MODE_ALIASES`, `coerceAgentMode`, and use `isAgentMode` directly. **Risk: low** (self-contained in `AgentMode.ts` + 3 call sites: `ChatSchemas.ts:11-30`, and two doc comments in `WorkflowDefinitionSchemas.ts`).

### 1.4 `gitRepositories` (vs `codebaseAliases`) — GENUINE LEGACY, confirmed by repo's own docs
- `packages/shared/src/types/WorkflowOrchestrator.ts:11-20` (`GitRepositoryConfig`), `:179-184` (`OrchestratorConfig.gitRepositories`, required, non-optional in the TS type).
- **Not in the Zod schema at all**: `packages/shared/src/config/WorkflowDefinitionSchemas.ts:145-166` (`OrchestratorConfigSchema`) has `codebaseAliases` but no `gitRepositories` field — confirmed by `.github/docs/feature-workflows.md:220-222,239-241`: *"`gitRepositories` is the older clone-a-URL path; the server schema does not declare it, so anything sent there is silently dropped by zod."*
- Every live construction of an `OrchestratorConfig` object hard-codes `gitRepositories: []`: `packages/core/src/services/WorkflowDefinitionService.ts:427`, and `packages/core/src/services/WorkflowOrchestrator.ts:737` (fallback object literal).
- `packages/core/src/services/WorkflowOrchestrator.ts:316` — `// Merge git repos from definition config (legacy backward compat)` `const gitRepos = orchestratorConfig?.gitRepositories ?? [];` — always `[]` in practice since nothing can populate it through the schema-validated create/update/import paths.
- A **separate, still-live** mechanism achieves URL-based repos: `repositoryFromInputs('target', variables)` (`packages/core/src/services/WorkflowPreprocessor.ts:788`) builds a repo config on the fly from a `target` variable of type `git_url`, independent of `OrchestratorConfig.gitRepositories`. So the `gitRepositories` *field* is dead weight; the *capability* (clone a URL) lives elsewhere.
- `.github/docs/feature-workflows.md:266-269` also documents a **"Legacy fallback"** for post-processing when no `SourceControlFlowService` is wired (SDK's own composition) — `commit_and_push` degrades to `GitManager.commitAndPush` / `create_pr` to `SourceControlService`/`gh` CLI directly. That is a genuine defensive fallback for the SDK-embedding case, not dead code — keep.
- Also duplicated wire shape: `packages/shared/src/config/WorkflowTemplate.ts:401-406` — `WorkflowRunProfileSchema.gitRepositories` (a *third* shape, `{url, branch, alias}` all-optional) — unclear consumer; not found read anywhere in `packages/core` (only referenced by the schema itself and type export). Likely dead too — worth a follow-up grep on `WorkflowRunProfile` consumers (this schema/type appears to be legacy relative to `RunProfileSchema` in `WorkflowDefinitionSchemas.ts:402-419`, which is the one CLI (`packages/cli-core/src/commands/run.ts`) actually uses).
- **Verdict**: `OrchestratorConfig.gitRepositories` / `GitRepositoryConfig` type, the `CloneRepoStepConfig`/`clone_repo` preprocessing step, and `WorkflowRunProfileSchema.gitRepositories` are removable (or at minimum need `gitRepositories` deleted from the `OrchestratorConfig` TS interface to match the already-stripped Zod schema — they're already inconsistent). Keep the `target`-variable clone-a-URL capability (`repositoryFromInputs`) since it's the *actual* live path, but rename/reframe it independent of `gitRepositories`. **Risk: medium** — touches `WorkflowOrchestrator.ts` (~10 call sites), `WorkflowPreprocessor.ts`, `WorkflowDefinitionService.ts:427`, `WorkflowRunService.ts:874-887`.

### 1.5 `scope` — NOT a real field in this scope
- `.github/docs/feature-workflows.md:203-207` documents `scope = 'global' | 'project'`, but no `scope` field exists on `WorkflowDefinition`/`CreateWorkflowDefinitionSchema` in the type/schema files read — it's derived from `projectId` presence (`projectId` undefined = global). Doc is describing a *virtual* concept, not a stored legacy field. Not removable (nothing to remove); flag doc wording as slightly misleading but out of scope for code changes.

### 1.6 `promptType` — REMOVABLE, dead
- `packages/shared/src/types/StageDefinition.ts:12` (`PromptType = 'inline'|'file'`), `:82` (`StageDefinition.promptType?`).
- `packages/shared/src/config/WorkflowDefinitionSchemas.ts:25` (`PromptTypeSchema`), `:240` (`CreateStageSchema.promptType`), `:312` (`ImportStageSchema.promptType`).
- Each `PromptDefinition` already carries its own `source: 'inline'|'file'` (see 1.7 below) — `promptType` at the stage level is a **second, redundant** discriminator that nothing in `packages/core` reads (no `\.promptType\b` hits found outside the schema/type declarations themselves and `WorkflowScriptSchema.ts` doesn't even declare it on `StageOutputSchema.config`, meaning scripts can't set it). **Dead field — safe to delete.** Risk: **low**.

### 1.7 `prompts[].source` / `prompts[].filePath` — REMOVABLE, confirmed dead + causes a real bug
- `packages/shared/src/types/StageDefinition.ts:15-24` (`PromptDefinition.source`/`filePath`), `WorkflowDefinitionSchemas.ts:13-22` (`PromptDefinitionSchema`).
- **Confirmed dead on the read side**: `grep -rn "source === 'file'|source: 'file'"` across `packages/core` and `apps/server` returns **zero hits** outside `packages/shared/src/builders/StageBuilder.ts:82` (the write side). No service resolves a `filePath` prompt into text at run time.
- `packages/shared/src/builders/StageBuilder.ts:78-87` — `.promptFile(path)` sets `text: ''` and `source: 'file', filePath: path` — since nothing downstream reads `filePath`, **any `.workflow.mjs` script calling `.promptFile()` silently sends an empty-string prompt to the agent.** This is exactly the bug flagged in the task brief — real, live, in-scope builder API that is broken by the removed/never-built file-resolution path.
- **Verdict**: either (a) implement file resolution (out of scope — this is "no back-compat" cleanup, not new features) or (b) delete `source`/`filePath`/`PromptType`/`promptType` entirely and delete `StageBuilder.promptFile()`. Given the product direction (strip dead paths), **(b) is the right call**. Risk: **low** (well-contained; `promptFile()` is likely unused by the only 3 shipped `.workflow.mjs` scripts — worth a quick grep of `templates/scripts/*.mjs` for `.promptFile(` before deleting, not done in this pass).

### 1.8 `iterationConfig` — SCHEMA IS LIVE, but the runtime feature is explicitly deferred
- `.github/AGENTS.md` §10: *"`StageDefinition.iterationConfig` has a schema but the runtime "iteration" feature is deferred (use Automation `input mode: loop`/`batch` instead)."* — this is the repo's own status doc calling it out.
- `packages/shared/src/types/StageDefinition.ts:42-56`, `WorkflowDefinitionSchemas.ts:134-142,263,333`, `WorkflowTemplate.ts` (not present at template-stage level, only carried through `templateStageToCreateParams:464` via an `as {iterationConfig}` cast), `StageBuilder.ts:37,219-222` (`.iterationConfig()`), `ScriptFacade.ts:116` (passes it through to `addStage`).
- **Verdict**: (c) real TODO / product decision needed, not simply "legacy" — it's forward-declared but never executed. Given "strip dead code," this qualifies for removal too since nothing consumes it at runtime (no reader in `packages/core/src/services/StageExecutionService.ts` or `WorkflowRunService.ts` was found acting on `stage.iterationConfig` to spawn a sub-workflow). Recommend removing the field + schema + builder method + `IterationConfigSchema`/`IterationConfigOutputSchema`, and pointing users at Automation loop/batch mode as the doc already says. **Risk: low-med** (schema-only feature, but UI may render an iteration config panel — not checked, flag for web-scope audit).

### 1.9 `hooksFile` — GENUINE FEATURE, keep
- `WorkflowDefinition.hooksFile` / `HooksFileConfig` (`.hooks.json` import) is a real, documented import path (`HooksFileConfigSchema` in `WorkflowTemplate.ts:133-137`), not legacy — no removal recommended.

### 1.10 `selectedArtifacts` — LIVE, keep
- `WorkflowDefinition.selectedArtifacts` / `CreateWorkflowDefinitionSchema.selectedArtifacts` (`WorkflowDefinitionSchemas.ts:187-192,218-222`) is read by web (skills/agents/prompts artifact picker) — not flagged as legacy by any comment; out of scope to remove without a web-side check.

### 1.11 `defaultAgentRef` — LIVE (newer AGT-01 feature), keep.

### 1.12 `useWorktree` — LIVE, keep (AGENTS.md invariant #7 calls it load-bearing).

### 1.13 `masterSessionId` (WorkflowRun) — used in `WorkflowFacade.ts:216` (`run.masterSessionId`); not verified further, out of the strict scope list but flagged since the task named it — no legacy-alias comment found near it in files read; treat as live until proven otherwise.

### 1.14 HarnessType fallback vs ProviderInstanceId — not found in scope
- No `ProviderInstanceId` type exists in the files read. `HarnessConfig.harnessType?: HarnessProviderId` (`Workflow.ts:33`) is the only provider-routing field; comment says "Omit to route by `model` … falling back to the server's primary provider" — this is documented routing behavior, not a legacy alias. No action.

### 1.15 `waitForCompletion` — LIVE, not legacy (controls whether the orchestrator blocks on a prompt before sending the next one). No deprecation comment found.

### 1.16 Stage templates / `stageTemplateId` — PARTIALLY DEAD
- `packages/shared/src/config/WorkflowTemplate.ts:246-273` defines a full `StageTemplateSchema` (reusable per-stage blueprint, `id/name/category/prompts/…`), and `WorkflowTemplateStageSchema.stageTemplateId` (`:282`) is meant to reference one ("Either inline prompts OR a reference to a stage template").
- **No template JSON in `templates/system/*.json` uses `stageTemplateId`** (`grep -rln "stageTemplateId" templates` → no hits) and no stage-template *registry* file/loader was found in the scanned scope (`TemplateRegistry` per AGENTS.md loads JSON templates directly — stage templates are a separate, apparently unused indirection layer). **Verdict: dead schema-only feature** — `StageTemplateSchema`, `StageTemplate` type export, and `WorkflowTemplateStageSchema.stageTemplateId` are all removable. Risk: **low** (nothing observed to read them in `packages/core` in this pass — recommend a final grep of `packages/core` for `getStageTemplate`/`stageTemplateRegistry` before deleting).

### 1.17 `preprocessing`/`postprocessing` "enabled" field — CONFIRMED
- `packages/shared/src/types/WorkflowOrchestrator.ts:111-121` — `PostProcessingStep.enabled: boolean` exists on the **post**-processing step type but **not** on `PreprocessingStep` (`:31-40`, no `enabled` field there — asymmetric). `packages/shared/src/config/WorkflowDefinitionSchemas.ts:159-165` — the zod `postProcessingSteps` array object omits `enabled` entirely (only `type/name/config/failOnError/order`), so the TS type's `enabled` field can never be set through the validated create/update/import paths — it's **dead on arrival**, always `undefined`, and nothing was seen reading `.enabled` on a post-processing step to skip it. **Removable** (delete `PostProcessingStep.enabled` from the type, since the schema already lacks it). Risk: **low**.

### 1.18 `browserConfig` — LIVE feature (Integrated Browser), keep; not legacy.

### 1.19 Stage `skills`/`agents` — LIVE (per-stage skill/agent references), keep; used by `StageOutputSchema` in `WorkflowScriptSchema.ts:101` and `StageBuilder.skill()`. Note: **workflow-level `agents` is NOT accepted by `WorkflowScriptOutputSchema.definition`** (only `skills` at `:183`, `agents` at `:184` — actually both ARE present, re-checked: line 183-184 has both `skills` and `agents`). No issue.

### 1.20 `createWorktrees` — LIVE (`OrchestratorConfigSchema.createWorktrees`, default true) — real, actively read alongside `codebaseAliases`; keep.

---

## 2. Unused `AppConfig.workflow` knobs — CONFIRMED DEAD WIRING

`packages/shared/src/config/AppConfig.ts:65-72` (`workflow` section, comment "WS-D1"):

| Field | Declared default | Reader found? |
|---|---|---|
| `stageTimeoutMs` | 300_000 | **No config-value reader.** `packages/core/src/services/StageExecutionService.ts:254` hard-codes its own `DEFAULT_STAGE_TIMEOUT_MS = 300_000` "to match" the config default (comment says so), with a setter `setDefaultStageTimeoutMs()` (`:557`) meant for a composition root to wire the live config value through — **grep confirms `setDefaultStageTimeoutMs(` is never called anywhere** outside its own definition. |
| `maxStageTimeoutMs` | 4h | **Zero readers anywhere** in `packages/core`/`apps/server` besides the schema declaration itself. Not even a hard-coded mirror exists. Completely dead. |
| `heartbeatIntervalMs` | 10_000 | Same pattern as `stageTimeoutMs`: `StageExecutionService.ts:267` hard-codes `DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000`, setter `setHeartbeatIntervalMs()` (`:565`) **never called**. `WorkflowRunService.ts:127-129` has its own independent `heartbeatPolicy = { heartbeatIntervalMs: …, staleMultiplier: 3 }` object with `setHeartbeatPolicy()` (`:134`) **also never called**. |
| `heartbeatStaleMultiplier` | 3 | Mentioned **only in a comment** (`StageExecutionService.ts:262`); the actual value is hard-coded as `staleMultiplier: 3` in `WorkflowRunService.ts:129`. No config plumbing at all. |

**Verdict**: the entire `AppConfig.workflow.*` section is disconnected from runtime. The comment at `AppConfig.ts:59-64` describes intended wiring ("the heartbeat is written … the run reconciler fails a stage …") that was never completed — `composition-root.ts` never calls `setDefaultStageTimeoutMs`/`setHeartbeatIntervalMs`/`setHeartbeatPolicy` with the live config. This is either (a) dead config to delete, or (c) a real TODO to wire it up. Given "no back-compat, strip dead paths," and since the hard-coded defaults already match the schema defaults 1:1, **recommend deleting the whole `AppConfig.workflow` section** and keeping the hard-coded constants (simpler, and removes a config surface nobody can actually tune). Risk: **low** (nothing depends on runtime-tuning these values today).

`workflowScriptsEnabled` (`AppConfig.ts:257`, in a different section) **is** live — read by `WorkflowScriptLoader.ts`, `composition-root.ts`, `apps/server/src/routes/workflowScripts.ts`. Not legacy.

---

## 3. Duplicate implementations

### 3.1 `WorkflowFacade.create()` vs `ScriptFacade.materialize()` — parallel, drifted stage-mapping code
- `packages/sdk/src/facades/WorkflowFacade.ts:82-133` (`create()`) hand-builds stages from a narrow `CreateWorkflowInput` shape and **only forwards** `name/description/order/prompts/variables/hooks/harnessConfigOverrides/condition` to `addStage` — drops `agentRef`, `contextFilter`, `contextSources`, `outputFormat`, `retryPolicy`, `timeoutMs`, `iterationConfig`, `skills`, `resultValidation`, `expectedOutput`, `outputSchema`, `approvalRequired` that `ScriptFacade.materialize()` (`:96-118`) *does* forward. Same underlying `addStage()` call, two different field-completeness levels — exactly the "hand-picked six fields" anti-pattern the codebase's own comment in `WorkflowDefinitionService.ts:441-444` already flagged and fixed for the *template* importer (`templateStageToCreateParams`), but **`WorkflowFacade.create()` was never updated to use it**.
- Also a live bug in `WorkflowFacade.create()`: `stageInput.systemPrompt` (`WorkflowFacade.ts:103`) is spread into the `prompts[0]` object, but `PromptDefinition` (both type and Zod schema) has **no `systemPrompt` field** — it's silently dropped by `CreateStageSchema.parse`, and `hooks: stageInput.hooks as never` (`:106`) papers over a real type mismatch (the input `hooks` shape `{phase,config}` doesn't match `HookDefinition`, which needs `id/name/type/priority/enabled/failurePolicy/timeoutMs/retries`).
- **Verdict**: consolidate — have `WorkflowFacade.create()` delegate to the same `templateStageToCreateParams`-style full-field mapping `ScriptFacade.materialize()` uses, or have `WorkflowFacade.create()` call into `ScriptFacade`'s stage-creation helper. Risk: **medium** (public SDK surface — `CreateWorkflowInput` type may need broadening). Est. ~40 LOC consolidated.

### 3.2 Three separate stage-param mappers, still not fully unified
1. `packages/shared/src/config/WorkflowTemplate.ts:438-467` `templateStageToCreateParams()` — the "one importer" per its own doc comment, used by `WorkflowDefinitionService.importFromJSON` + `WorkflowOrchestrator.createFromTemplate`.
2. `packages/sdk/src/facades/ScriptFacade.ts:96-118` — a **second**, independently hand-written mapper for `.workflow.mjs` → `addStage`, duplicating almost the same field list as #1 but not calling it (different source shape — `WorkflowTemplateStage` vs `StageOutput` — so some duplication is structurally forced, but the two lists have already drifted: `templateStageToCreateParams` includes `expectedOutput`/`outputSchema`/`approvalRequired`; `ScriptFacade.materialize` does **not** forward `expectedOutput`, `outputSchema`, or `approvalRequired` at all (compare `WorkflowTemplate.ts:461-465` vs `ScriptFacade.ts:107-117`) — a script-authored `.workflow.mjs` cannot set those three stage fields even though `WorkflowScriptSchema.ts`'s `StageOutputSchema` doesn't declare `expectedOutput`/`outputSchema`/`approvalRequired` either, so the gap is schema-deep, not just the mapper.
3. `WorkflowFacade.create()` (§3.1) — a third, even-narrower mapper.
- **Verdict**: real duplication with real drift (missing fields differ per path). Est. LOC to remove/consolidate: ~60-80 across the three sites if unified into one shared stage-param builder.

### 3.3 `workflow.stage.add`/`workflow.stage.update` CLI SESSION_MODES mismatch — latent bug, not exactly "duplicate," but a drifted constant
- `packages/cli-core/src/commands/workflow.ts:34` — `const SESSION_MODES = ['isolated', 'shared', 'continue'] as const;` used for `--session-mode` choices on `workflow create`/`workflow update`.
- Actual accepted values (`CreateWorkflowDefinitionSchema.sessionMode`, `WorkflowDefinitionSchemas.ts:172,205`, and the domain type `WorkflowSessionMode` in `WorkflowDefinition.ts:17`) are `'single' | 'per-stage' | 'auto'`.
- **This means every `--session-mode` value the CLI offers (`isolated`/`shared`/`continue`) is rejected by the server schema** — a CLI user following `--help` cannot successfully set a session mode at all via `workflow create`/`update`. This is a live, user-facing bug from constant drift, not from back-compat — flagging because "no back-compat" cleanup is a good time to fix it (delete the wrong local const, import/reuse the real enum). **Risk: low, high value** (bug fix, ~3 LOC).

### 3.4 CLI `orchestrator` vs `workflow run` vs `run` overlap
- `apps/server/src/routes/orchestrator.ts:122` `POST /from-template` and `:158` `POST /runs` (orchestrated run start with git-clone/upload support) duplicate, at the route layer, what `packages/core/src/services/WorkflowRunService.createRun`+`startRun` (used by `run.start` CLI command, `packages/cli-core/src/commands/run.ts:340-420`) and `WorkflowDefinitionService.importFromTemplate` (used by `workflow.fromTemplate` CLI command, `workflow.ts:398-414`) already do through the plain definitions/runs API. `.github/docs/feature-workflows.md:335` labels `POST /api/orchestrator/runs` explicitly **"legacy orchestrator path"** in the doc's own API table, alongside the (implicitly current) `POST /api/workflow-definitions/from-template/:id`.
- The CLI itself only talks to the non-legacy paths (`ctx.api.definitions.*`, `ctx.api.runs.*`) — `workflow.ts`/`run.ts` have **no** commands hitting `/api/orchestrator/*` directly except `run.ts:854` (`ctx.api.orchestrator.runDiff`) and `:872` (`ctx.api.orchestrator.runWorkspace`), which are workspace/diff endpoints, not the legacy run-start path. So the CLI already avoids the legacy orchestrator run-start route — good sign it's only kept for the web UI's "start from template" flow (out of this audit's file scope) or truly dead there too. **Flagged for cross-reference with the apps/server-scope audit** — recommend checking `apps/web` callers of `POST /api/orchestrator/runs` before removing `orchestrator.ts:158-227`.

### 3.5 MCP server — no workflow-tool duplication found
- `packages/mcp-server/src/toolAdapter.ts` is a generic `ToolDefinition` → MCP `Tool` adapter (`toMcpTool`/`advertiseRegistry`/`invokeRegisteredTool`) with **zero** workflow-specific logic — it doesn't duplicate CLI/SDK workflow commands. AGENTS.md §10 itself flags: *"`packages/mcp-server/` exposes a tool adapter but does not yet ship a standalone MCP server binary."* Not a legacy/duplicate finding — out of scope, nothing to remove here.

### 3.6 Builder methods dropped server-side — CONFIRMED, all four named in the brief
- `StageBuilder.outputSchema()` (`StageBuilder.ts:154-157`) → forwarded fine, `outputSchema` **is** in `CreateStageSchema` (`WorkflowDefinitionSchemas.ts:261`) and `StageExecutionService` presumably validates against it — **not dropped**, false lead; keep.
- `WorkflowBuilder.preprocessingStep()` (`WorkflowBuilder.ts:235-238`) → feeds `_preprocessingSteps` → `buildOrchestratorConfig()` (`:417-428`) → **but `buildOrchestratorConfig()` never includes `preprocessingSteps` in its output object** (`:419-421` only sets it if `this._preprocessingSteps.length > 0`... wait, it DOES: `config['preprocessingSteps'] = this._preprocessingSteps;` at line 420). Re-checked — **this one is actually wired correctly.** Correction: it IS included.
- `WorkflowBuilder.resultValidation()` (`:240-245`) → `buildOrchestratorConfig()` **does** include `resultValidations` (`:422-424`) — wired correctly.
- `WorkflowBuilder.requiresCodebase()` (`:247-250`) → `buildOrchestratorConfig()` **does** include `requiresCodebase` (`:425-427`) — wired correctly.
- `WorkflowBuilder.useWorktree()` (`:252-255`) → sets `_useWorktree`, forwarded at `build():334` as `definition.useWorktree` — this lands on `WorkflowScriptOutputSchema.definition.useWorktree` (`WorkflowScriptSchema.ts:182`, present) — **wired correctly**, not dropped.
- **Correction to the task brief's hint**: on closer inspection, `.outputSchema()`, `.preprocessingStep()`, `.resultValidation()`, `.requiresCodebase()`, `.useWorktree()` are all **correctly wired end-to-end** through `WorkflowBuilder.build()` → `WorkflowScriptOutputSchema` → `ScriptFacade.materialize()`. The **one genuinely broken builder method is `StageBuilder.promptFile()`** (§1.7 above) — confirmed real, the others were not reproducible as bugs in this pass. `WorkflowBuilder.postProcessingSteps`, `autoCommit`, `autoPush`, `autoCreatePR` are **not exposed on `WorkflowBuilder` at all** (no builder method sets them) even though `OrchestratorConfig` supports them — a gap, but that's a missing-feature, not a legacy/duplicate item.

---

## 4. Comment grep (legacy/deprecated/back-compat/fallback/BUGFIX/TODO/FIXME/migration/shim/alias)

| Hit | Classification |
|---|---|
| `StageDefinition.ts:106` `@deprecated superseded by agentRef` | (a) removable legacy — see §1.1 |
| `AgentMode.ts:118-144` `LEGACY_MODE_ALIASES`/"Legacy value accepted at every boundary" | (a) removable now that DB rows are migrated and no back-compat required — see §1.3 |
| `WorkflowDefinitionSchemas.ts:266,336` "Accepts the legacy 'interactive' alias" | same as above, (a) |
| `StageBuilder.ts:104-106` "the legacy artifact-name lookup" (re: `.agent()`) | (a) removable — see §1.1 |
| `WorkflowOrchestrator.ts:315-316` "Merge git repos from definition config (legacy backward compat)" | (a) removable — see §1.4, field is dead-on-arrival |
| `WorkflowOrchestrator.ts:1196-1201` "A run has something to commit if it either cloned legacy `gitRepositories`…" | (b) genuine defensive code around a dead field — once `gitRepositories` is deleted this whole branch collapses to the `codebaseAliases`/worktree case only; simplifies naturally |
| `.github/docs/feature-workflows.md:220-222,239-241,266-269,335` (4 "LEGACY"/"legacy" mentions) | mixed: `gitRepositories` = (a) removable; `POST /api/orchestrator/runs "legacy orchestrator path"` = (a) candidate pending web-side cross-check (§3.4); "Legacy fallback" for SDK-embedder post-processing = (b) genuine defensive/embedding-compat code, keep |
| `AppConfig.ts:255` "implied by the legacy `GENERATORAI_ALLOW_SCRIPT_UPLOAD=true`" | outside workflow scope (script-upload security flag), not evaluated here |
| `AppConfig.ts:285` "the legacy `events` table" | outside workflow scope (event/DB legacy, different subsystem) |
| `run.ts:620-622` "sending the legacy `approved: false` silently means…" | (b)/documentation only — describes a hazard the CLI code *avoids* by using explicit `outcome`; no legacy code to remove, it's a comment warning against a footgun in a lower layer (server route) not in this file's scope |
| No `TODO`/`FIXME`/`BUGFIX`/`shim`/"for older"/"migration" hits | in the exact files grepped (other than the ones above) — none found |

---

## 5. Templates — legacy formats, duplicate directories, docs to update

- **`templates/workflow-upload-template.json`** (repo root of `templates/`) — the sole top-level template JSON; per `.github/AGENTS.md`'s own repo map comment, `templates/*.json` at top level = **"v1 templates (legacy)"** vs `templates/system/*.json` = "v2 system DAG templates (5 built-ins)". Contains the orphaned `copilotConfig` key (§1.2) and is not referenced by any loader in the scanned code — it reads as a stale hand-authored "here's the JSON shape" example, not a loaded template. **Recommend deleting or rewriting it to the current schema** (rename `copilotConfig`→`harnessConfig`, drop if a fresh minimal example is wanted).
- **`templates/system/*.json`** (5 files: code-generation, code-review, e2e-testing, + 2 more not spot-checked) — current v2 format, fields all map cleanly onto `WorkflowTemplateSchema` (checked `code-generation-workflow.json`/`code-review-workflow.json` field names against the schema — no legacy keys found: `preprocessingSteps`, `resultValidations`, `requiresCodebase`, `supportsMultipleCodebases` all match; **no** `stageTemplateId` usage in any shipped template, confirming §1.16 (stage-template indirection is unused even by the system templates that could use it)).
- **No duplicate template directories** found — `templates/system/` (JSON DAG templates + artifacts + extensions) and `templates/scripts/` (`.workflow.mjs` PWS) are two genuinely different mechanisms (JSON vs programmatic), not duplicates of each other.
- **Template registry vs file templates**: `TemplateRegistry` loads the JSON files directly per AGENTS.md — no separate DB-backed "template registry" table was found in the scoped files (would need `packages/db` scope to confirm; not read in this pass).
- **Docs needing updates once fields are removed**: `.github/docs/feature-workflows.md` §3.6 (`gitRepositories` example block, lines 210-269) and §5 (line 335, the "legacy orchestrator path" API line) will need rewriting once §1.4/§3.4 removals land; `.github/AGENTS.md`'s repo-map comment ("v1 templates (legacy)") should be updated/removed once `workflow-upload-template.json` is deleted.

---

## Estimated LOC removable per package (this scope only, rough)

| Package | Item(s) | Est. LOC |
|---|---|---|
| `packages/shared` | `agentName` field+comments (types+schemas+builder), `LEGACY_MODE_ALIASES`/`coerceAgentMode`, `gitRepositories`/`GitRepositoryConfig`/`CloneRepoStepConfig`/`WorkflowRunProfileSchema.gitRepositories`, `promptType`/`PromptTypeSchema`, `PromptDefinition.source`/`filePath`, `StageBuilder.promptFile()`, `iterationConfig` (type+schema+builder+output schema), `StageTemplateSchema`/`stageTemplateId`, `PostProcessingStep.enabled`, `AppConfig.workflow` section | ~230-280 |
| `packages/core` | corresponding readers/fallbacks in `WorkflowOrchestrator.ts`, `WorkflowPreprocessor.ts`, `WorkflowDefinitionService.ts`, `StageExecutionService.ts`, `WorkflowRunService.ts`, `AgentResolver.ts` (dead `heartbeatPolicy`/timeout setters can be deleted along with the config section) | ~80-120 |
| `packages/sdk` | `WorkflowFacade.create()` stage-mapper consolidation (rewrite, not pure deletion) ~40; `ScriptFacade.materialize()` field-gap fix (add, not remove) | ~40 net |
| `packages/cli-core` | `SESSION_MODES` constant fix (bugfix, ~3 LOC changed, not removed) | ~3 |
| `templates/` | delete `workflow-upload-template.json` (30 lines) | ~30 |
| `.github/docs` | rewrite `feature-workflows.md` §3.6 gitRepositories block + §5 legacy API line | ~60 lines of docs |

**Total code LOC realistically removable in this scope: roughly 350-430**, concentrated in `packages/shared` (types/schemas/builders) and its direct `packages/core` consumers. The single highest-value, lowest-risk fix is the CLI `SESSION_MODES` bug (§3.3) since it's a live user-facing breakage, not just cleanup.
