# G3 — Workflow module: legacy / duplicate / dead-code inventory

Branch `desktop_redesign` @ `a83a7bf`, 2026-09-24. Read-only; no repo file or DB was modified.
Premise from the product owner: not live, no users, **no backward compatibility**. Goal: one clean implementation per concern.

Sources: my own reads and greps of core, server, SDK and composition roots. Three sub-audits:
- `G3_part_db.md`: DB layer, including read-only queries against `packages/db/data/generatorai.db`
- `G3_part_web.md`: web, mobile, client-core
- `G3_part_shared_cli_sdk.md`: shared, CLI, SDK, templates, docs

Where a sub-audit got something wrong, I re-checked it and the correction is marked **[corrected]**.

Legend:
- Risk: **L** (low), **M** (medium), **H** (high).
- Comment classes: **(a)** legacy that can be removed, **(b)** defensive code to keep, **(c)** real TODO or product decision.
- Callers were counted by grep over `packages/` and `apps/`, excluding `__tests__`, `dist`, `dist-bundle` and `.claude/worktrees`.

---

## 0. Headline findings

1. **Two run lifecycles.** They behave differently depending on which client starts the run.
   - **PATH A:** `POST /api/orchestrator/runs` → `WorkflowOrchestrator.startOrchestratedRun`. Used by web and mobile, but only for project-linked runs.
   - **PATH B:** `POST /workflow-runs` + `/start` → `WorkflowRunService.startRun`. Used by the CLI, automations, `/workflow-scripts/:id/run`, SDK `run()`, retry, and non-project web/mobile runs.
   - PATH B never runs preprocessing steps, post-processing (autoCommit, autoPush, autoCreatePR), uploads scanning, the sandbox, the `requiresCodebase` check, or the `pre_clone`, `post_clone`, `pre_commit`, `post_commit` and `on_pr_created` hooks.
   - PATH A runs **both** layers' run-level hooks. `on_run_start`, `on_run_complete`, `on_run_failed` and `on_run_cancelled` fire twice. `on_run_cancelled` can fire three times.
   - `on_run_start` can abort in PATH A (`WorkflowOrchestrator.ts:485-488`) but its result is ignored in PATH B (`WorkflowRunService.ts:224-261,773-785`).
2. **A whole v1 "session → workflows" stack is still wired but can never run a workflow.** It spans:
   - server: `WebhookService`, `SessionService.createSession/startSession`, `routes/webhooks.ts`, `routes/hooks.ts` `GET /sessions/:id/hooks`
   - DB: `DrizzleWorkflowRepository`, the `workflows` table
   - shared: `Workflow`/`WorkflowStateMachine`, `CreateSessionParams.workflows`
   - web: 11 zero-caller hooks and `IPlatformClient` session/workflow methods that call routes that no longer exist
3. **The event-driven DAG routing path is dead.**
   - `WorkflowRunService.subscribeRunEvents` (`:932-947`) and `WorkflowOrchestrator.setupResultValidation` (`:816-880`) both use `eventBus.subscribeGlobal`.
   - Global handlers only fire from `emitGlobal` (`EventBus.ts:430-540`).
   - `stage_run.completed` and `stage_run.failed` are emitted per-session (`StageExecutionService.ts:2586,2714,2919,2933,3088,3104`).
   - Result: runs advance only on the 3 s reconciler tick, and the orchestrator's `stageValidationResults` report is always empty.
4. **The SDK is a second composition root with weaker wiring** (`packages/sdk/src/GeneratorAI.ts:384-560`).
   - It passes no `registerRepo`/`entryRepo`, so there is no `DurableExecutionEngine`.
   - It passes no `scmFlow` to `WorkflowPreprocessor` (`:471-476`).
   - So every "when durable engine absent" fallback, and the GitManager post-processing fallback, is live **only** in SDK mode.
   - These fallbacks cannot be deleted until the SDK wiring matches the server.
5. **DB (real dev DB).**
   - No chat row references a workflow row.
   - But **7,337 of 8,178 `chat_messages` rows are stage transcripts**: their session `owner_type` is `stage_run`, and 1,931 of 2,323 `sessions` rows are stage sessions.
   - Workflow data and chat data share `sessions`, `chat_messages` and `stream_cursors`. Any "wipe workflow data" step must filter by `sessions.owner_type`.
   - Dropping the `workflows` table **before** dropping `chat_messages.workflow_id` breaks every chat INSERT (`no such table: main.workflows`). I reproduced this in-memory on the bundled SQLite 3.53.2.

---

## 1. Legacy fields and aliases

| # | Field | Where (file:line) | Why legacy | Replacement | Risk | Dependents / notes |
|---|---|---|---|---|---|---|
| 1.1 | `orchestratorConfig.gitRepositories` / `GitRepositoryConfig` | Type `shared/types/WorkflowOrchestrator.ts:11-20,180` (required in the TS type); **not in zod** `shared/config/WorkflowDefinitionSchemas.ts:145-166`. Core: `WorkflowOrchestrator.ts:62,315-316,576-607,592,638,737,941,1101,1175,1196-1201`; `WorkflowRunService.ts:874-888`; `WorkflowPreprocessor.ts:110,222-255,599-639`; `WorkflowDefinitionService.ts:427`. Web: `workflowBuilderStore.ts:69,248,288,296-301,326,538`; `ProjectCodebasesTab.tsx:20-61`; `WorkflowBuilderPage.tsx:268-282,490`; `WorkflowDefinitionPage.tsx:86-96,137-142`. Shared: `WorkflowTemplate.ts:402-406` (`WorkflowRunProfileSchema.gitRepositories`) | zod strips it on every create/update, so it is always `[]` server-side. The whole PATH A "legacy clone" branch (`WorkflowOrchestrator.ts:576-607`) and `WorkflowPreprocessor.cloneRepositories` are therefore unreachable except via a hand-built SDK call | `codebaseAliases` + project worktrees. The clone-a-URL capability that is actually used is `repositoryFromInputs` (`WorkflowPreprocessor.ts:788-804`) inside the `clone_repo` step | M | ~20 sites across 4 core services, 4 web files and shared types. Removing it also removes the `repo_path_target` compat alias (`WorkflowOrchestrator.ts:570-575`, `WorkflowRunService.ts:914-917`). Check that `templates/system/*.json` stop using `{{repo_path_target}}` first. `ChatManagementService`/`ChatSchemas` `gitRepositories` is a **separate chat field**, out of scope |
| 1.2 | `codebaseAliases` read server-side only for export | `WorkflowDefinitionService.ts:506`. The run path gets aliases from the client (`selectedCodebases`) | Stored, but the server run path never reads it. PATH B uses all ready codebases (`WorkflowRunService.ts:889-891`) | Make the server read `definition.orchestratorConfig.codebaseAliases` in the single lifecycle and drop `selectedCodebases` from the request | M | `WorkflowDefinitionPage.tsx:137-142`, `StartRunSheet.tsx` (mobile) |
| 1.3 | `createWorktrees` | `WorkflowOrchestrator.ts` type `:~184`; zod `OrchestratorConfigSchema` | **Zero readers** (grep). PATH A hardcodes `useWorktree: true` (`WorkflowOrchestrator.ts:456`). **[corrected]**: the shared sub-audit called it live | `definition.useWorktree` | L | none |
| 1.4 | `agentName` (stage) | `shared/types/StageDefinition.ts:106-109` (`@deprecated`), `:178-180`; `WorkflowDefinitionSchemas.ts:252,324`; `WorkflowTemplate.ts:331,459`; `StageBuilder.ts:96-111` (`.agent()`); `AgentResolver.ts:43-44,285-292`; `StageExecutionService.ts:374,390`; `DAGValidator.ts:56`; `WorkflowDefinitionService.ts:266,535`; `workflowScripts.ts:145,278`; `orchestrator.ts:188` (override); `WorkflowRunService.ts:1867-1883` (override `agentName`, parsed then **ignored**); web `StageNode.tsx:106,218-221`, `workflowBuilderStore.ts:667` | Superseded by `agentRef`. Only **1** row in the dev DB has it | `agentRef` | L-M | DB column `stage_definitions.agent_name` (§4) |
| 1.5 | `interactive` agentMode alias | `shared/types/AgentMode.ts:118-144` (`LEGACY_MODE_ALIASES`, `coerceAgentMode`); `ChatSchemas.ts:11-30`; `WorkflowDefinitionSchemas.ts:266,336` (comments) | DB values were already migrated (v22). Only old exported JSON still carries it | `isAgentMode` directly | L | Shared with chat. `coerceAgentMode` is also used by the chat schema, so remove it in one change |
| 1.6 | `promptType` / `PromptTypeSchema` | `StageDefinition.ts:12,82,170`; `WorkflowDefinitionSchemas.ts:24-25,240,312`; `WorkflowDefinitionService.ts:282`; web `StageNode.tsx:96` compares to `'skills'`/`'agents'`, values the enum cannot hold | No reader. Not even a DB column (it lives in stage JSON) | nothing | L | — |
| 1.7 | `prompts[].source` / `prompts[].filePath` | `StageDefinition.ts:15-24`; `WorkflowDefinitionSchemas.ts:13-22`; `StageBuilder.ts:78-87` (`promptFile()` sends `text: ''`, a **live bug**) | No runtime reads a file prompt | Delete `promptFile()` or resolve the file at build time | L | 3 shipped `.workflow.mjs` do not call `promptFile` (grep of `templates/scripts`) |
| 1.8 | `prompts[].attachments` (builder "Files" tab) | web `PromptFilePicker.tsx:30-75` writes it; runtime reads only `variables.__promptDirectories` (`StageExecutionService.ts:1187-1190,1957`); only reader is the dead `ConfigResolver.resolve` (`ConfigResolver.ts:76`) | Dead control. A Files pick with no text creates a prompt with `text: ''`, and the save then fails with 400 | Either wire `attachments` into `workflowPromptAttachments`, or delete the Files tab | M (UI) | `PromptEditor.tsx`, `WorkflowListPage.tsx` |
| 1.9 | Stage-level `variables` | `StageDefinition.variables`; `WorkflowDefinitionService.ts:523`; `ConfigResolver.ts:114` (dead); `workflowScripts.ts:139-141,272-274` (merges run vars into stage vars, which does nothing); web `StagePropertiesPanel.tsx` VariableEditor (~`:321-326,880-945`) | **Never merged at run time.** Stages launch with `run.variables` plus override vars (`WorkflowRunService.ts:~1508-1522`). **[corrected]**: the DB sub-audit called this live | Definition-level `variables` | L-M | Remove the editor, schema field and column |
| 1.10 | `templateId` (stage) / `stageTemplateId` / `StageTemplate` | `WorkflowDefinitionService.ts:256`; `WorkflowTemplate.ts:246-273` (`StageTemplateSchema`), `:282`, `:446` (mapper casts `templateId`); `TemplateRegistry.ts:13,40-61,83-97,102-104` (`loadStageTemplates` **never called**); web `StagePropertiesPanel.tsx:74-77,101,199-205` (select filled from **workflow** templates), `StageNode.tsx:95,101,212` | Nothing reads it. 0 dev-DB rows. No shipped template uses `stageTemplateId` | nothing | L | `getTemplateCount` in `health.ts:137` (adjust) |
| 1.11 | `iterationConfig` (+ `workflow_runs.parent_stage_run_id`, `stage_runs.iteration_index`, `stage_runs.parent_stage_run_id`) | `StageDefinition.ts:42-56`; `WorkflowDefinitionSchemas.ts:134-142,263,333`; `WorkflowTemplate.ts:464`; `StageBuilder.ts:37,219-222`; `ScriptFacade.ts:116`; `workflowScripts.ts:155,288`; `WorkflowDefinitionService.ts:270`; `workflowRunOrder.ts:2-12` (sorts on `iterationIndex`, which is never set) | Sub-workflow iteration was never built. `AGENTS.md` §10 says "deferred". 1 dev-DB row | Automation loop/batch | L | (c) product decision, but dead today |
| 1.12 | `selectedArtifacts` | `WorkflowDefinitionService.ts:149`; `WorkflowDefinitionRepository.ts:34,53,113-114` | **Write-only.** No reader in core, server, web or mobile, and 0 non-empty rows. **[corrected]**: the shared sub-audit said web reads it; grep finds no reader | Agent binding (`agentRef`) | L | — |
| 1.13 | `defaultAgentRef` | `WorkflowDefinitionService.ts:188-194`; read only in `AgentRepository.ts:183` (reverse lookup) | Never used as the stage fallback. The fallback is `harnessConfig.agentRef` (`StageExecutionService.ts:372`). 0 rows. **[corrected]**: "live" per the shared sub-audit | `harnessConfig.agentRef` | L | Index `idx_workflow_defs_agent_ref` (`migrations/index.ts:1677`) |
| 1.14 | Definition `skills` / `agents` | Written by `workflowScripts.ts:124-125,257-258`, `ScriptFacade.ts:90-91`, `WorkflowDefinitionService.ts:281,593-594` | Round-trip only. `StageExecutionService` never reads definition-level skills or agents | Agent binding | M | (c) wire it or delete it |
| 1.15 | `scope` (workflow definition) | web `workflowBuilderStore.ts:77,139,252,293` (`as unknown as` cast), `:330,548` (`setScope`, 0 callers); DB column + `idx_workflow_defs_scope` | The server never filters by it. All 343 rows are `'global'` | `projectId IS NULL` | L | Automations have their own `scope` (out of scope) |
| 1.16 | `masterSessionId` | `WorkflowRunService.ts:476-477,526`; `WorkflowRunRepository.ts:51,130,173`; `WorkflowRun.ts:91`; `sdk/facades/WorkflowFacade.ts:216-217` | A random `master_<id>` that no event is ever emitted to, so the SDK replay by it always returns `[]` | `stream` scope=`run` | L | SDK `WorkflowFacade.watch/events` |
| 1.17 | `harnessType` hardcoded `'copilot'` fallbacks | `StageExecutionService.ts:399` (`?? 'copilot'` passed into AgentResolver), `:3377` (every stage plan is recorded as `harnessType: 'copilot'`); `plan_documents.harness_type DEFAULT 'copilot'` | Pre-multi-harness default. The plan row lies for claude-agent/codex stages | The resolved `sessionConfig.harnessType`, or the provider router default | L | `PlanService` |
| 1.18 | `waitForCompletion: false` | `StageExecutionService.ts:1995-2016` (`sendPrompt` fire-and-forget with no deadline and no output capture) | Live, but breaks stage output, summary and validation semantics | Always wait | M | Web `PromptEditor.tsx`. (c) decision |
| 1.19 | `PostProcessingStep.enabled` | `WorkflowOrchestrator.ts` type `:111-121` has it; zod omits it; `WorkflowPreprocessor.ts:262` filters on `s.enabled`, so **every explicit post-processing step is dropped** | Dead on arrival | Remove the flag | L | — |
| 1.20 | `sessionMode 'auto'` persisted on runs | `WorkflowRunService.ts:815-822` resolves it at start. Still branches on `'auto'` later: `SessionAllocator.ts:138-141,172`, `StageExecutionService.ts:2613`, `WorkflowRunService.ts:1386,1436` | Once resolved, `'auto'` never reaches these branches. 305 dev runs still show `auto` (created, never started) | Resolve in `createRun` and keep `auto` only on the definition | L | `ISessionAllocator` doc `:16` is wrong |
| 1.21 | Script permission vocabulary `askOnEachTool` / `askOnce` | `workflowScripts.ts:28-45` (`mapScriptPermissionMode`); `WorkflowScriptSchema.ts:196-202`; `builders/types.ts:216-219` | A second vocabulary kept only so old scripts load | Canonical `WorkflowRunPermissionMode` | L | 3 shipped scripts (check their profiles) |
| 1.22 | HITL boolean `approved` | `HitlService.ts:109-129` (`resolutionOutcome`); `workflowRuns.ts:487-495` | "Legacy two-state verdict" kept for old clients | `outcome` only | L | CLI `run.ts:620`, mobile PermissionCard/HITL, web `InlineHitlControls` |
| 1.23 | `automations.webhook_token` (plaintext) + `hashLegacyWebhookTokens` | `schema.ts:672-676`; `AutomationService.ts:68-71` | Kept only for the v47 boot-time backfill | `webhook_token_hash` | L | `AutomationRepository` |
| 1.24 | `AutomationExecutionSummary.totalRuns/completedRuns/failedRuns` | `client-core/src/api/client.ts:533-536` (`@deprecated`) | 0 readers | `*Iterations` | L | — |
| 1.25 | Mobile `AutomationView.workflowDefinitionId` | `apps/mobile/src/components/work/automationModel.ts:32-33,149-152` | Single-workflow wire shape | `workflowIds` | L | — |
| 1.26 | `copilotConfig` | `templates/workflow-upload-template.json:14` (orphan file, 0 references). DB `copilot_config*` columns on 4 tables (§4) | Rename finished in code | `harnessConfig` | L | — |
| 1.27 | `startPolling(runId, _workflowDefinitionId)` | `WorkflowRunService.ts:975-987` | Signature kept "compatible with previous call sites" | `startPolling(runId)` | L | — |
| 1.28 | `DAGScheduler` unused `_completedStageDefId` arguments | `DAGScheduler.ts:594-632` | Interface compat | — | L | See 5.9 |
| 1.29 | `importFromTemplate(templateId, opts: string \| Options)` | `WorkflowDefinitionService.ts:396-402`; caller `workflowDefinitions.ts:228` passes a bare string | "Bare string for backward compatibility" | Options object | L | — |
| 1.30 | Unused override fields `agentName`, `timeoutMs`, `contextFilter` | `WorkflowRunService.ts:1863-1883`; `orchestrator.ts:188` | Parsed, never applied | Apply them or drop them from the override schema | L | CLI run profiles (`C-10` in `C_orchestration_integrations.md`) |

---

## 2. Legacy code paths

### 2.1 The v1 "session → workflows" and legacy-webhook stack (delete as one unit)

| Item | file:line | Evidence |
|---|---|---|
| `routes/webhooks.ts` (`/webhooks/github`, `/webhooks/custom/:trigger`, `/webhooks/registrations` CRUD) | `apps/server/src/routes/webhooks.ts:1-172`; mounted at `routes/index.ts:109-110` | Self-described `@deprecated (Track A4)` with a Sunset header. Replaced by `POST /api/automations/webhooks/:token`. Unauthenticated when no secret is set (`:44-54,89-96`) |
| `WebhookService` | `packages/core/src/services/WebhookService.ts:1-231` | Calls `sessionService.createSession({workflows:[…]})`, but `createSession` ignores `workflows` (`SessionService.ts:31-54`). **No workflow ever runs**, yet the delivery is logged `processed`. Its condition grammar (`:201-230`) is a third grammar |
| `SessionService` create/start/pause/resume/cancel/delete/getSessions | `SessionService.ts:31-160` | Only callers: `WebhookService` (create/start) and `acp-entry.ts:103,146` (`getSession` only). Can shrink to `sessionRepo.getById` |
| `SessionStateMachine` | `core/domain/state-machines/SessionStateMachine.ts` (99), `shared/types/SessionStateMachine.ts` (19), SDK export `sdk/src/index.ts:107` | Used only by `SessionService` |
| `CreateSessionParams.workflows` | `shared/types/CreateSessionParams.ts:33-39` | Only the webhook uses it |
| `Workflow` entity, `WorkflowStatus`, `WorkflowStateMachine` | `shared/types/Workflow.ts:53-70`, `shared/types/WorkflowStateMachine.ts` (25), `types/index.ts:55` | v1 entity (`HarnessConfig` in the same file stays) |
| `IWorkflowRepository` + `DrizzleWorkflowRepository` | `core/domain/ports/IRepositories.ts:34-43`; `ports/index.ts:50`; `db/repositories/WorkflowRepository.ts` (119); `db/src/index.ts:47,458,489`; `composition-root.ts:42,729,2343,2816` | 0 rows. Only reader is `hooks.ts:72` |
| `GET /hooks/sessions/:id/hooks` | `apps/server/src/routes/hooks.ts:67-101` | Reads the empty `workflows` table. The web client never calls it |
| `IWebhookRepository` + `WebhookRepository` + `webhook_registrations` / `webhook_deliveries` tables | `IRepositories.ts:97-109`; `db/repositories/WebhookRepository.ts` (143); schema `:250-288` | 0 rows |
| `verifyGitHubSignature`, `verifyWebhookToken` | `apps/server/src/middleware/webhookAuth.ts:58-110,149-168` | Only used by `routes/webhooks.ts`. Keep `verifySignedPayload` (automations) |
| `AppConfig.webhooks` (+ SDK `config.ts:132-134`, `createCoreServices.ts:273`) | `shared/config/AppConfig.ts:218+` | Only the legacy webhook uses it |
| `IPlatformClient` session and workflow methods | `shared/types/IPlatformClient.ts:71-86` (`createSession`, `getSession: SessionWithWorkflows`, `getSessions`, `deleteSession`, `start/pause/resume/cancelSession`, `getWorkflows`, `pauseWorkflow`, `resumeWorkflow`); web `HttpPlatformClient.ts:437-490` | **The server has no such routes.** `routes/sessions.ts` only has `GET /:sessionId/chat`, so every call 404s. **[corrected]**: the web sub-audit filed these as a separate "chat sub-workflow" concept |
| Web hooks with 0 callers | `apps/web/src/hooks/queries.ts:37,46,64,243,255,268,281,294,307,341,354` (`useSessions`, `useSession`, `useWorkflows`, `useCreateSession`, `useStart/Pause/Resume/Cancel/DeleteSession`, `usePauseWorkflow`, `useResumeWorkflow`) | grep: 0 callers each |
| `SessionWithWorkflows` | `shared/types/Session.ts:40` | Only the dead client uses it |
| `ConfigResolver.resolveGlobalHooks` | `ConfigResolver.ts:164-188`; `composition-root.ts:2468`; `sdk/GeneratorAI.ts:239`; `hooks.ts:91` | Reads `on_client_*` hooks from workflow templates. **No shipped template declares any** (`grep on_client_ templates/` finds nothing). (c) delete, or move global hooks to real config |

Risk **L** for server, core and DB. Risk **M** for the `IPlatformClient` interface change because web, mobile and test mocks implement it. Estimated ~1,300 LOC.

### 2.2 Other legacy paths

| # | Item | file:line | Why | Replacement | Risk |
|---|---|---|---|---|---|
| 2.2.1 | `ConfigResolver.resolve` (template+session) and `resolveStageConfig` (3-level merge) | `ConfigResolver.ts:12-157,190-223` | 0 callers. `StageExecutionService` hand-merges the harness config instead (`:1128-1190`), so this is a duplicate of 5.6 | One merge function used by the stage path | L |
| 2.2.2 | Legacy upload dir `{artifactsDir}/runs/{id}/uploads` | `WorkflowOrchestrator.ts:136-155` (`getRunUploadsDir` fallback), `:170-196` (`getRunWorkspaceDirs` fallback), `:466-474` (Phase 0 fallback); `WorkflowRunService.ts:713-720`; route comment `workflowRuns.ts:127-128` | `WorkspaceManager` is always wired in both roots (`composition-root.ts:1560`, `sdk/GeneratorAI.ts:430`). Only unit tests reach the fallback. Uploads that arrive before Phase 0 land in the abandoned dir (`C-17`) | Make `WorkspaceManager` a required constructor arg | L |
| 2.2.3 | Legacy clone path (`gitRepositories`) | `WorkflowOrchestrator.ts:576-607`; `WorkflowPreprocessor.ts:222-255` (`cloneRepositories`), `:603-610` (`declared` lookup), `:633-638` ("fallback to global workspace (legacy)" `gitManager.clone`) | See 1.1 | Worktrees plus the `clone_repo` step from inputs | M |
| 2.2.4 | Preprocessor legacy `GitManager` commit/PR fallback | `WorkflowPreprocessor.ts:133-142,469-477,527-550` | Live **only in the SDK** (no `scmFlow`) | Wire `SourceControlFlowService` in the SDK, then delete | M |
| 2.2.5 | `StageExecutionService` "legacy auto-approve" when no run repo or HITL | `StageExecutionService.ts:719-727` | Both are always wired (`createCoreServices.ts:448-450`) | Required dependency | L |
| 2.2.6 | `HitlService` in-memory waiter fallback (no durable engine) | `HitlService.ts:179-187,294,373` | Live only in the SDK (no durable repos) | Wire the durable repos in the SDK | M |
| 2.2.7 | `AutomationService` in-memory iteration loop (no durable engine) | `AutomationService.ts:201-207,837-940,1080` | Same as above | Same | M |
| 2.2.8 | `AutomationService` legacy input pipeline (`inputMode` single/loop/batch/script, `batchData*`, `loopItems`, `loopVariable`, `batchColumnMapping`, `dataSourceConfig`) vs schema-driven `dataSchema` + `IterationPlanner` | `AutomationService.ts:466-520` (legacy webhook var extraction), `:650-667`, `:739-790` ("Legacy E1", "Legacy batch", "Legacy loop"); `cancelledExecutions` "legacy Set" `:172-180,1584` | Two ways to feed iterations. **Both are live in the web UI** (`CreateAutomationPage.tsx:31-205`) and the CLI | Pick one (the schema-driven one is the newer design) | H (c) |
| 2.2.9 | `/workflow-runs/:runId/stages/:stageId/interrupt` | `workflowRuns.ts:429-465` | Test-only route that forces HITL, shipped in the production API | Test harness | L |
| 2.2.10 | "Legacy HITL flow" follow-up injection | `workflowRuns.ts:510-554` (`markFollowUpPending` + `sendStageFollowUp`); `StageExecutionService.ts:537-541,2951-3120` | A second feedback channel next to the `stage_completion_review` loop inside `executeStage` | One review loop | M (c) |
| 2.2.11 | `StartupRecoveryService` "no re-drive wired" branch | `StartupRecoveryService.ts:40-45,250-256` | `redriveRun` is always wired. **Keep** `parkRunAsPaused` for re-drive *failure*: (b) | — | L |
| 2.2.12 | Durable sleep (`sleeping` state, `wake_at`, `slept_since`, `DurableSleepService`, `/stages/:id/wake`, "Wake now" UI) | `DurableSleepService.ts` (296); `composition-root.ts:1075-1106,2567,2622`; `sdk/GeneratorAI.ts:539-560`; `workflowRuns.ts:283-327`; `StageRunStateMachine` `:131-134,159-167`; web `workflowQueries.ts:409`, `HttpPlatformClient.ts:1157`; client-core `admin.ts:340`, `eventRouter.ts:1764-1781`; mobile `useRunControl.ts:27`; CLI `runTimeline.ts` | `DurableSleepService.sleep()` has **no production caller** and 0 dev-DB rows ever had `wake_at`. There is no script or tool API to enter sleep | Delete it, or expose `step.sleep` | M (c) |
| 2.2.13 | Web `?legacy=1` no-op effect and V1 comments | `apps/web/src/pages/WorkflowRunPageV2.tsx:1-11,256-261`; `RunHeaderBar.tsx:3` | The V1 page file is gone; the router mounts only V2 (`router.tsx:80`) | Rename `WorkflowRunPageV2` to `WorkflowRunPage` | L |
| 2.2.14 | Stale SSE header comment | `apps/server/src/routes/stream.ts:20-22` ("legacy per-scope routes still exist for backward compat") | The routes are gone (`workflowRuns.ts:565`) | Fix the comment | L |
| 2.2.15 | `workflowRunStore` write-only state | `apps/web/src/stores/workflowRunStore.ts:47,57,103,108,283,338-350`; writers `sseManager.ts:515-564` | 0 readers | — | L |
| 2.2.16 | `sseManager.connectAutomationExecution` / `disconnectAutomationExecution` | `sseManager.ts:1353-1364` | 0 callers. Duplicates `useAutomationExecutionStream.ts` | — | L |
| 2.2.17 | 12 dead workflow hooks + `useUpdateAutomation` | `workflowQueries.ts:128,136,356,398,404,422,442,490,548,578,588,605`; `automationQueries.ts:143` | 0 callers (`usePauseStageRun`, `useResumeStageRun`, `useCancelStageRun`, `useOrchestratorContext`, `useImportFromTemplate`, and others) | — | L |
| 2.2.18 | Web shims | `components/workflow/StyledSelect.tsx`, `ToggleSwitch.tsx`, `redesign/deriveTimeline.ts` (0 importers) | Re-export shims | Canonical imports | L |
| 2.2.19 | Widget tab on the run page | `WorkflowRunPageV2.tsx:719-731` | Server side: `StageExecutionService`/`WorkflowRunService` have **0** widget references, and `buildWidgetTools` is only bound in `ChatManagementService.ts:1903,2413`. The tab can never populate. **[corrected]**: the web sub-audit said "needs live check"; the server has no producer | Wire widgets into stages, or delete the tab | L |
| 2.2.20 | Dead "Stage actions ⋯" button | `redesign/StageTimelineItem.tsx:243-256` | `onClick` only calls `stopPropagation` | — | L |
| 2.2.21 | Unused `AppConfig.workflow` knobs and setters | `shared/config/AppConfig.ts:59-72`; `StageExecutionService.ts:244-267,557-570` (`setDefaultStageTimeoutMs`, `setHeartbeatIntervalMs`: 0 callers); `WorkflowRunService.ts:127-140` (`setHeartbeatPolicy`: 0 callers) | Config the runtime never reads. `maxStageTimeoutMs` is read nowhere | Constants, or wire the config | L |
| 2.2.22 | `RunLogger` per-run `stream-log.jsonl` | `core/events/StreamLogger.ts` (321); `WorkflowRunService.ts:~752-758` | **Write-only.** No reader, and it is excluded from diffs (`WorkspaceManager.ts:1067`, `ChangeSetService.ts:187-190`, `WorkflowRunPageV2.tsx:776`). A third copy of every event (SQLite `events` + `stream_cursors` + JSONL) | `stream_cursors` replay | L-M |
| 2.2.23 | `DeltaLog` | `core/services/DeltaLog.ts` (480); `composition-root.ts:920-932,1067-1070` | Opt-in (`GENERATORAI_DELTA_LOG`) and write-only (`readTail` has no production caller). Chat-wide, not workflow-specific | — | M (c), out of workflow scope |
| 2.2.24 | Dead SM transitions | `WorkflowRunStateMachine.ts:39-45` (`sys:recover`, `user:retry`: retry makes a new run), `:24-25,33` (`sys:stage_failed`, `sys:all_stopped`, `sys:all_stages_done` never applied); `StageRunStateMachine.ts:150-152` (`sys:retry`), `:126,143` (`sys:parent_pause`/`resume`) | The SMs are instantiated only at `WorkflowRunService.ts:681` (2 transitions) and `StageExecutionService.ts:1062` (2 transitions). Every other status change is a direct `updateStatus`, so the SM is decorative | Either route every write through the SM, or delete the SMs and keep a `canTransition` table in the repo's CAS | M |
| 2.2.25 | `WorkflowOrchestrator` `resultValidator` constructor argument | `WorkflowOrchestrator.ts:75` | `this.resultValidator` has 0 uses | — | L |
| 2.2.26 | Orchestrator validation "reporting" listener | `WorkflowOrchestrator.ts:806-890` | Its stage branch never fires (see §0.3). It is in-memory, so a restart loses it | The run service already owns validation (`WorkflowRunService.ts:1308-1360`) | L |
| 2.2.27 | `GET /orchestrator/runs/:id/context` + `activeContexts` | `orchestrator.ts:228-243`; `WorkflowOrchestrator.ts:69,369,426-428`; web `useOrchestratorContext` (0 callers) | An in-memory view, empty after a restart | Run row plus events | L |
| 2.2.28 | CLI `SESSION_MODES` | `packages/cli-core/src/commands/workflow.ts:34,212,221` (`isolated`/`shared`/`continue`) | The server accepts `single`/`per-stage`/`auto`, so every CLI value is rejected (**live bug**) | Import the shared enum | L |
| 2.2.29 | Orphan `templates/workflow-upload-template.json` | whole file | `AGENTS.md` calls top-level `templates/*.json` "v1 templates (legacy)". 0 references | — | L |

---

## 3. Comment sweep in core and server workflow files

Keywords searched: legacy, deprecated, back-compat, fallback, BUGFIX, TODO, "for older", migration, shim, alias. Web, shared and CLI hits are classified in `G3_part_web.md` §3 and `G3_part_shared_cli_sdk.md` §4. No `TODO`/`FIXME` markers exist in these files.

| Hit | Class | Note |
|---|---|---|
| `WorkflowRunService.ts:425` BUGFIX (variable type validation) | (b) | Real validation. Drop the "BUGFIX" label |
| `WorkflowRunService.ts:714` "Fallback: manual directory creation (legacy)" | (a) | 2.2.2 |
| `WorkflowRunService.ts:799` FEAT-1 "was a silent alias" | (b) | Keep the logic. Collapse the persisted `auto` (1.20) |
| `WorkflowRunService.ts:874-917` `gitRepositories` + "Backward-compat `repo_path_target`" | (a) | 1.1 |
| `WorkflowRunService.ts:980` "signature kept compatible" | (a) | 1.27 |
| `WorkflowRunService.ts:1144,1291,1410` BUGFIX (pass vars; retryCount dedup) | (b) | Real behaviour. Drop the labels |
| `WorkflowRunService.ts:1797,1821` contextSources fallback to DAG predecessors | (b) | Defined semantics |
| `StageExecutionService.ts:199,2216` `SUMMARY_FALLBACK_MAX_CHARS` | (b) | Summary on abort |
| `StageExecutionService.ts:263` "must stay compatible" (heartbeat) | (b) | Real coupling. The config knobs are (a), see 2.2.21 |
| `StageExecutionService.ts:720` "legacy auto-approve" | (a) | 2.2.5 |
| `StageExecutionService.ts:934,952` fenced-block scrape fallback | (b)/(c) | Guards agents that do not use tools. Consider deleting (it fabricates files) |
| `StageExecutionService.ts:2608` note on MultiHarness primary-provider fallback | (b) | Explains the session hold |
| `StageExecutionService.ts:2673,3228` BUGFIX (interpolation on retry) | (b) | Drop the labels |
| `WorkflowOrchestrator.ts:139,171,188,467` legacy dir fallback | (a) | 2.2.2 |
| `WorkflowOrchestrator.ts:204` link → symlink → copy fallback | (b) | Genuine |
| `WorkflowOrchestrator.ts:315` "legacy backward compat" `gitRepos` | (a) | 1.1 |
| `WorkflowOrchestrator.ts:499,513` project codebase fallback | (b) | Becomes the only path |
| `WorkflowOrchestrator.ts:570-572` `repo_path_target` compat | (a) | 1.1 |
| `WorkflowOrchestrator.ts:712` "fallback to host execution" when the sandbox fails | (b)/(c) | A security decision: failing open to the host is questionable |
| `WorkflowOrchestrator.ts:1085` "no migration" | (b) | Intent is persisted in `variables`. Could become a column in v55 |
| `WorkflowOrchestrator.ts:1196-1201,1215` legacy `gitRepositories` / "legacy (no flow service) path" | (a) | 1.1 and 2.2.4 |
| `WorkflowDefinitionService.ts:396` bare-string opts "backward compatibility" | (a) | 1.29 |
| `WorkflowPreprocessor.ts:139-140,469,527,531` legacy GitManager fallback | (a) once the SDK is wired | 2.2.4 |
| `WorkflowPreprocessor.ts:633` "Fallback to global workspace (legacy)" | (a) | 2.2.3 |
| `DAGScheduler.ts:89` "Missing edgeType on legacy rows" | (a) | Make `edge_type` NOT NULL in v55 |
| `DAGScheduler.ts:594,606,615,624` "interface compatibility" / "Alias of getReadyStages" | (a) | 5.9 |
| `DurableExecutionEngine.ts:558` "Migration 42 makes … unique" | (b) | Real constraint note |
| `HitlService.ts:109` "Legacy two-state verdict" | (a) | 1.22 |
| `HitlService.ts:179` "FALLBACK path" (no durable engine) | (a) once the SDK is wired | 2.2.6 |
| `AutomationService.ts:70` legacy plaintext token | (a) | 1.23 |
| `AutomationService.ts:179,205,1584` legacy Set / legacy in-memory loop | (a) | 2.2.7 |
| `AutomationService.ts:470,499,618,650,739,753,768` legacy input modes | (c) | 2.2.8 |
| `AutomationService.ts:1148` default-dataset fallback | (b) | — |
| `StartupRecoveryService.ts:252` fallback park-as-paused | (b) | Keep for re-drive failure |
| `WebhookService.ts:37` "old fallback" | (a) | The whole file goes (2.1) |
| `orchestrator/OrchestratorService.ts:430,436,912` | n/a | Chat orchestrator, out of scope |
| `routes/webhooks.ts:4-9,135-146` `@deprecated` + Sunset header | (a) | 2.1 |
| `routes/workflowRuns.ts:127-128` legacy fallback comment | (a) | 2.2.2 |
| `routes/workflowRuns.ts:487-495` legacy boolean verdict | (a) | 1.22 |
| `routes/workflowRuns.ts:518-554` "legacy HITL flow only" | (c) | 2.2.10 |
| `routes/stream.ts:20-22` legacy per-scope routes | (a) | 2.2.14 (stale comment) |
| `routes/workflowScripts.ts:28-45,318-323` script permission vocabulary | (a) | 1.21 |
| `routes/orchestrator.ts:770` "Preserve the existing wire shape" | (b) | — |
| `core/domain/ports/IStageRunRepository.ts:28` "callers … (legacy) can omit expectedVersion" | (a) | Make `expectedVersion` required |

---

## 4. DB (details in `G3_part_db.md`, re-checked here)

### 4.1 Columns and tables

| Object | Verdict | Dev-DB data |
|---|---|---|
| `workflows` table (+ bootstrap `migrations/index.ts:89-109`) | DEAD | 0 rows |
| `chat_messages.workflow_id`, `artifacts.workflow_id` (FK → `workflows`) | DEAD | 0 non-null. No index on either in the real DB |
| `copilot_config` / `copilot_config_overrides` on `workflows`, `chats`, `workflow_definitions`, `stage_definitions` | LEGACY duplicate (v11 backfilled `harness_config*` and never dropped these) | — |
| `webhook_registrations`, `webhook_deliveries` | DEAD with 2.1 | 0 / 0 |
| `workflow_definitions.selected_artifacts`, `.default_agent_ref` (+ index), `.scope` (+ index) | WRITE-ONLY | 0 / 0 / all `global` |
| `workflow_definitions.skills`, `.agents` | Round-trip only | (c) |
| `stage_definitions.template_id`, `.iteration_config`, `.agent_name`, `.variables` | DEAD, DEAD, LEGACY, DEAD | 0 / 1 / 1 / — |
| `workflow_runs.master_session_id` | WRITE-ONLY | — |
| `workflow_runs.parent_stage_run_id` (+ `idx_workflow_runs_parent_stage`) | DEAD | — |
| `stage_runs.iteration_index`, `.parent_stage_run_id` (+ `idx_stage_runs_parent`), `.lease_owner` | DEAD | `lease_owner` 0 |
| `stage_runs.wake_at`, `.slept_since` | DEAD with 2.2.12 | `wake_at` 0 ever |
| `automations.webhook_token` | LEGACY | — |
| `stage_edges.edge_type` nullable | Make it NOT NULL (`DAGScheduler.ts:89`) | — |
| `plan_documents.harness_type DEFAULT 'copilot'` | Default is wrong (1.17) | — |
| `automation_execution_runs.workflow_run_id` NOT NULL **and** `ON DELETE SET NULL` (`migrations/index.ts:415`) while `schema.ts:774` says restrict | Contradiction; `schema.ts` and the SQL have drifted | Fix it in v55 |

### 4.2 Migrations

- There are 54 versioned migrations plus a "version 0" bootstrap.
- The bootstrap runs `CREATE TABLE IF NOT EXISTS` and about 80 `safeAddColumn` calls **on every boot** (`migrations/index.ts:66-589`). **Dropping a column or table in a migration without also editing the bootstrap re-creates it on the next boot.**
- Tracking: `_schema_versions(version, applied_at, name)`, with no checksum. Integrity comes from `migrations.lock.json` plus a CI lint.
- The dev DB is at v52; code defines v54.
- Compat-only migrations:
  - v11: `harness_config_rename_backfill`
  - v22: `agent_mode_rename` (`interactive` → `auto`)
  - v47: plaintext → hashed webhook token
- Precedent for "drop a dead table": v43 and v50 (`usage_ledger`).

### 4.3 FK graph (from `PRAGMA foreign_key_list` on the real DB)

**Workflow tables referencing each other** (child → parent):
- `stage_definitions`→`workflow_definitions` CASCADE
- `stage_edges`→`stage_definitions`×2 and `workflow_definitions` CASCADE
- `workflow_runs`→`workflow_definitions` NO ACTION
- `workflow_runs.ancestor_run_id`→`workflow_runs` SET NULL
- `stage_runs`→`workflow_runs` CASCADE, and →`stage_definitions` NO ACTION
- `session_allocations`→`workflow_runs` CASCADE
- `stage_session_maps`→`session_allocations` CASCADE

**Workflow → chat world:**
- `stage_runs.session_id`→`sessions` (NO ACTION)
- Stage transcripts live in `chat_messages` via `sessions.owner_type='stage_run'`

| | Stage (workflow) | Chat |
|---|---|---|
| `sessions` rows | 1,931 | 392 |
| `chat_messages` rows | **7,337** | 841 |

- `stream_cursors` also holds `scope='run'` (23,734 rows) and stage `session` rows.

**Automations → workflow:**
- `automations.workflow_ids` (JSON, 50 rows)
- `automation_execution_runs`→`workflow_definitions` (NO ACTION) and →`workflow_runs` (see the contradiction in 4.1)

**Soft references (no FK)** to workflow ids:
- `checkpoints.workflow_run_id/stage_run_id`: **388 rows**
- `execution_workspaces.owner_type='workflow_run'`: **594 rows**, plus directories on disk
- `worktrees.run_type='workflow'`: 2 rows
- `plan_documents.*_run_id`: 0
- `widget_instances.*_run_id`: 0
- `events.*_run_id`: 0
- `agent_interactions.scope_kind='stage_run'`

**Chats do not reference any workflow table.** Chats are only exposed through the shared `sessions`, `chat_messages` and `stream_cursors` tables.

### 4.4 Squash vs one forward "workflow v2" migration

**Recommendation: do not squash. Add one forward migration, v55 `workflow_v2`, and edit the bootstrap in the same PR.**

Why not squash:
- The version-keyed `_schema_versions` means renumbering either re-runs different SQL on existing DBs or silently skips it.
- The developer's own DB (v52, with real chats) would be the casualty.
- A squash is only safe with a "baseline" detector plus a dump and restore of chats. That is a separate project.

The bundled SQLite is **3.53.2**, so `ALTER TABLE … DROP COLUMN` is available and most of v55 needs no table rebuild. Required order (the first rule was reproduced in memory):
1. `DROP INDEX` for every index on a column being dropped:
   - `idx_workflow_runs_parent_stage`
   - `idx_stage_runs_parent`
   - `idx_workflow_defs_agent_ref`
   - `idx_workflow_defs_scope`
   - any `wake_at` index, if sleep is deleted
2. `ALTER TABLE chat_messages DROP COLUMN workflow_id; ALTER TABLE artifacts DROP COLUMN workflow_id;` This must run **before** step 3. If it runs after, every `INSERT INTO chat_messages` fails with `no such table: main.workflows`, even with NULL values.
3. `DROP TABLE workflows; DROP TABLE webhook_deliveries; DROP TABLE webhook_registrations;`
4. `DROP COLUMN` for the dead columns in 4.1, including `copilot_config*` on 4 tables and `automations.webhook_token`.
5. Rebuild only where a constraint changes: `stage_edges.edge_type NOT NULL`, and the `automation_execution_runs` FK action. Use `disableForeignKeys: true`. A rebuild under `foreign_keys=ON` cascades through `stage_definitions`/`stage_edges` or `stage_runs`/`session_allocations`, the same failure as the v23 `plan_documents` incident.
6. Edit the bootstrap block:
   - remove `CREATE TABLE workflows`
   - remove the `workflow_id` column/FK from `chat_messages` and `artifacts`
   - remove every `safeAddColumn` for dropped columns
7. Update `schema.ts`, which has already drifted from the SQL.
8. Pin v55 in `migrations.lock.json`.

"Drop and recreate the workflow tables" (wiping workflow data) is also feasible, since no chat FK blocks it. It must also do all of the following:
1. Delete `sessions WHERE owner_type='stage_run'`. This cascades to their `chat_messages`, which is 90% of that table.
2. Delete `stream_cursors` rows for scope `run` and for stage sessions.
3. Delete `checkpoints` with run ids, and `execution_workspaces WHERE owner_type='workflow_run'` plus their directories on disk.
4. Delete `worktrees WHERE run_type='workflow'`.
5. Handle the 50 automations and their execution rows, which point at definitions. Either keep definitions (trim columns only) or delete automations too.

Every delete must filter on `owner_type`/`scope`, never on "not a chat", so the 392 chat sessions and 841 chat messages survive. **Take a file backup first.** The real DB is 368 MB in WAL mode; stop the server and copy `-wal` and `-shm` along with it.

---

## 5. Duplicate implementations to consolidate

| # | Duplicate | Where | Keep | Delete / merge | Risk |
|---|---|---|---|---|---|
| 5.1 | **Two run lifecycles** (PATH A orchestrated vs PATH B plain) | A: `WorkflowOrchestrator.ts:308-785,903-1270` + `routes/orchestrator.ts:158-262` + web `useStartOrchestratedRun`, mobile `StartRunSheet.tsx:163`. B: `WorkflowRunService.ts:408-930` + `workflowRuns.ts:36-140`. Duplicated inside: workspace creation (`WO:446-477` vs `WRS:684-748`); project worktrees (`WO:501-575` vs `WRS:872-930`); `on_run_start` (`WO:483-495` vs `WRS:773-785`); terminal hooks (`WO:1004-1008` vs `WRS:1570-1576,1753`, and `WRS:1226`); cancel (`WO:394-420` vs `WRS:1186-1243`); browserConfig/useWorktree honoured only in B (`WRS:698-707`) vs hardcoded in A (`WO:456`) | One lifecycle inside `WorkflowRunService.startRun`: workspace → worktrees → uploads → project configs → preprocessing → sandbox → DAG → post-processing, as a phase list, with post-processing driven by `finalizeRun` and the persisted intent | `startOrchestratedRun`, `executeOrchestration`, `activeContexts`, `getContext`, `cancelOrchestratedRun`, `/orchestrator/runs*` (except the workspace/diff/download read routes, which move to `/workflow-runs/:id/workspace*`), `workflow_run.orchestration_*` events | H |
| 5.2 | Two template-import endpoints with different defaults | `POST /workflow-definitions/import` (`workflowDefinitions.ts:219-237`, autoCommit **false**; used by mobile, CLI, client-core `admin.ts:271`) vs `POST /orchestrator/from-template` (`orchestrator.ts:122-150` → `WorkflowOrchestrator.ts:272-297`, autoCommit **true**; used by web `Catalogs.tsx:738`). The *service* is already single (`WorkflowDefinitionService.importFromTemplate`, D10 closed) | `/workflow-definitions/import` with explicit options | `/orchestrator/from-template`, `WorkflowOrchestrator.createFromTemplate` | L |
| 5.3 | Two template-list endpoints | `GET /api/templates` (`routes/templates.ts`; web `queries.ts:97`) vs `GET /orchestrator/system-workflows[/:id]` (`orchestrator.ts:95-119`; web `WorkflowListPage.tsx:65`, client-core `admin.ts:823-825`) | `/api/templates` | `system-workflows`, `WorkflowOrchestrator.getWorkflowTemplate(s)` | L |
| 5.4 | Three condition grammars | `domain/dag/ConditionEvaluator.ts` (stage conditions); `WorkflowPreprocessor.ts:744-778` (`evaluateSimpleCondition`, preprocessing `conditional` step); `WebhookService.ts:200-230` (goes with 2.1) | `ConditionEvaluator` | Preprocessor copy, webhook copy | L |
| 5.5 | Four definition materializers (script / JSON → definition) | `workflowScripts.ts:100-191` (`/materialize`) and `:194-350` (`/run`, a copy-paste); `sdk/facades/ScriptFacade.ts:76-135`; `sdk/facades/WorkflowFacade.ts:82-133` (narrowest; drops ~12 fields, spreads a nonexistent `systemPrompt`, `hooks as never`). None is transactional, unlike `importFromTemplate`. The route/SDK copies all pass `agentName`, `iterationConfig` and stage `variables` (dead) | One `WorkflowDefinitionService.createFromSpec(spec)` (transactional, sharing `templateStageToCreateParams`) | The 3 hand-written mappers | M |
| 5.6 | Harness-config merge implemented twice | `StageExecutionService.ts:1128-1190` (field-by-field copy of 13 fields, then overrides) vs `ConfigResolver.resolveStageConfig` (dead) | One pure `mergeStageHarnessConfig()` | ConfigResolver | L |
| 5.7 | Three upload writers | `orchestrator.ts:158-222` (`/runs` multipart writes `skills/<name>/SKILL.md`), `:264-327` (`/workflows/:id/uploads` writes loose `skills/<file>`, which providers do not discover), `:433-512` (`/runs/:id/uploads`, same loose layout). Plus `copyWorkflowUploadsToRun` (`WO:209-257`) and `scanAndWireUploads` (`WO:1269-1338`, runs once, so late uploads are missed) | One `RunUploads.write(runId, category, file)` with the SKILL.md layout, scanned lazily at stage launch | 2 writers + legacy dir | M |
| 5.8 | Two concurrency gates on stage launch | `Semaphore(maxConcurrentStages ?? 8)` (`createCoreServices.ts:464`, `WorkflowRunService.ts:161-168,293-330`) **and** the AdmissionController `ordinary` lane (default 8, `composition-root.ts:1590-1600`, `WorkflowRunService.ts:339-341`); both need pause/resume across HITL | AdmissionController | `stageSemaphore`, `MAX_CONCURRENT_STAGES` | M |
| 5.9 | `DAGScheduler` surface vs what is used | Used: `buildDAGForRun`, `captureDefinitionSnapshot`, `reconcileRun`, `forgetRun`. Unused views: `getRootStages`, `getReadyStages`, `scheduleNext`, `onStageCompleted`, `onStageFailed`, `onStageSkipped`, `getSkippableStages`, `computeTerminalRunStatus` (method), `isDAGComplete`, `clearCache` (`DAGScheduler.ts:581-671`); `IDAGScheduler` + `ISessionAllocator` ports (`domain/ports/IServiceInterfaces.ts`, 97 LOC, a single implementer each) | `reconcileRun` | Aliases + ports | L |
| 5.10 | Two DAG advancement mechanisms, one dead | Event subscription (`WorkflowRunService.ts:932-957`, never receives stage events) + reconciler poll (`:1009-1086`) | Emit terminal stage events with `emitGlobal` (or subscribe with `subscribeToWorkflowRun`), keep the reconciler as a backstop, and make `completeRun`/`finalizeRun` CAS (B-1/B-23) | — | M |
| 5.11 | Two composition roots | `apps/server/src/composition-root.ts` vs `packages/sdk/src/GeneratorAI.ts:384-560`. The SDK lacks durable repos, `scmFlow`, the sandbox and AdmissionController; `DurableSleepService`'s `onWake` is copy-pasted (`composition-root.ts:1082-1106` vs `GeneratorAI.ts:539-560`) | One `createWorkflowServices()` used by both | SDK-local wiring + every "absent dep" fallback (2.2.4-2.2.7) | M |
| 5.12 | Two "orchestrator" concepts (naming) | `WorkflowOrchestrator` (workflow pre/post phases, `/api/orchestrator`) vs `services/orchestrator/OrchestratorService` (chat background workers) | Chat `OrchestratorService` keeps the name | Fold `WorkflowOrchestrator` into the lifecycle (5.1); move the workspace read routes under `/workflow-runs` | — |
| 5.13 | Two workflow HTTP clients | `apps/web/src/platform/HttpPlatformClient.ts` (implements `IPlatformClient`) vs `packages/client-core/src/api/admin.ts` (mobile, CLI) | client-core | Web's hand-written workflow methods (broader than workflows; M-H) | M-H |
| 5.14 | Three event persistence copies per workflow event | `events` table, `stream_cursors`, `RunLogger` JSONL (+ optional `DeltaLog`) | `stream_cursors` | `RunLogger` (2.2.22) | L-M |
| 5.15 | Two automation input pipelines | 2.2.8 | Schema-driven (c) | Legacy modes | H |
| 5.16 | Two HITL feedback paths | 2.2.10 | `stage_completion_review` loop | Route-injected follow-up | M |
| 5.17 | Hook-phase catalogue duplicated | `routes/hooks.ts:10-43` (22 hard-coded phases, no workflow-level phases) vs `HookPhase` / `WorkflowHookDefinition['phase']` in shared | Derive it from the shared enum | The hard-coded list | L |
| 5.18 | Run page V1/V2 | Only the V2 file remains (2.2.13) | Rename | — | L |

---

## 6. Deletion order (what must move together)

| Step | Change | Must go together / depends on |
|---|---|---|
| **0** | Pure dead code, no dependents (one PR, low risk): 2.2.13-2.2.18, 2.2.20, 2.2.21 (config + setters), 2.2.25, 2.2.27 (`useOrchestratorContext` and the route), 5.9, 1.27-1.29, 1.24, 1.25, 2.2.28 (CLI `SESSION_MODES` fix), 2.2.29, 2.2.14, `ConfigResolver.resolve/resolveStageConfig` (2.2.1) | Tests for the removed methods |
| **1** | v1 session/webhook stack (2.1) | Delete together, in this order: routes (`webhooks.ts`, `hooks.ts` GET) → `WebhookService` → `SessionService` (down to `getSession`) → `SessionStateMachine` → `CreateSessionParams.workflows` → `Workflow`/`WorkflowStateMachine` → `IWorkflowRepository`/`IWebhookRepository` + Drizzle repos → `webhookAuth` 2 functions → `AppConfig.webhooks` → `IPlatformClient` session/workflow methods + web `HttpPlatformClient` + 11 web hooks + `MockPlatformClient`. DB drop in step 5 |
| **2** | SDK composition parity (5.11) | Must land **before** deleting the "absent dep" fallbacks 2.2.4-2.2.7 and making `WorkspaceManager`, `hitlService`, `workflowRunRepo` and `durableEngine` required (2.2.2, 2.2.5) |
| **3** | Field purges. One PR per field, each through shared → core → server routes → db repo → web → mobile → CLI → templates → docs | 1.1 (+ legacy clone 2.2.3 + `repo_path_target` + `WorkflowRunProfileSchema.gitRepositories`); 1.3; 1.4; 1.5 (shared with chat); 1.6+1.7+1.8 together (prompt source model); 1.9; 1.10 (+ `TemplateRegistry` stage templates); 1.11 (+ `workflowRunOrder` `iterationIndex`); 1.12-1.15; 1.16; 1.19; 1.20; 1.21; 1.22 (web, mobile and CLI clients switch to `outcome` first); 1.30 |
| **4** | Lifecycle unification (5.1), template/list endpoints (5.2, 5.3), uploads (5.7), materializers (5.5), condition grammar (5.4), config merge (5.6), concurrency gate (5.8), event routing (5.10) | 5.1 requires web and mobile to switch from `/orchestrator/runs` to create+start first. Move the workspace read routes before deleting `routes/orchestrator.ts`. Dedupe the hooks as part of 5.1. Fix 5.10 in the same PR, because 5.1 makes run completion drive post-processing |
| **5** | DB v55 migration + bootstrap edit + `schema.ts` + lock file (§4.4) | After steps 1 and 3 (code no longer reads the columns). Order inside the migration is mandatory: indexes → `chat_messages`/`artifacts.workflow_id` → drop tables → drop columns → constraint rebuilds |
| **6** | Product-decision items (c): durable sleep 2.2.12, automation legacy modes 2.2.8, HITL follow-up 2.2.10, `waitForCompletion` 1.18, definition skills/agents 1.14, Widget tab 2.2.19, `RunLogger` 2.2.22, SM-or-no-SM 2.2.24, fenced-block scrape | Each is independent |
| **7** | Docs | `.github/docs/feature-workflows.md` §3.6 (`gitRepositories` block, `:210-269`), `:335` ("legacy orchestrator path"), `feature-stages.md` (§7.8 iteration; §2.7 stage variables), `AGENTS.md` repo map ("v1 templates (legacy)", iteration deferred note) |

---

## 7. LOC removable (estimates)

| Area | Conservative (steps 0-5) | With step-6 decisions |
|---|---|---|
| core services + domain (v1 stack, ConfigResolver, DAG aliases + ports, legacy fallbacks, `gitRepositories`, preprocessor duplicate grammar and GitManager fallback, validation listener, `masterSessionId`, `auto`, config setters) | ~1,500 | +900 (sleep ~300, automation legacy modes ~350, HITL follow-up ~200, SM transitions ~50) |
| core: lifecycle merge (`WorkflowOrchestrator` 1,428 LOC folded; net) | ~500-700 | — |
| core: `RunLogger` (StreamLogger) | — | +320 |
| apps/server routes + composition (webhooks 172, hooks GET 35, orchestrator run/template/context ~200, scripts `/run` copy ~120, webhookAuth ~100, sleep route ~40) | ~620 | +80 |
| packages/shared (types, schemas, builders, AppConfig) | ~350 | +60 |
| packages/db (repos, schema, bootstrap lines; migration history untouched) | ~350-450 | — |
| packages/sdk (`WorkflowFacade` mapper, `masterSessionId` replay, duplicate wiring) | ~120 | +40 |
| apps/web (sub-audit ~330 + 11 legacy session hooks/client methods ~150 + Widget tab ~20 + stage Variables editor ~65 + Files tab ~80) | ~550 | +100 (Wake UI, automation legacy mode UI) |
| apps/mobile + client-core + CLI | ~40 | +60 |
| templates + docs | ~30 code + ~150 docs | — |
| **Total** | **≈ 4,000-4,800 LOC** | **≈ 5,800-6,600 LOC** |

Test files for deleted code are not counted. Expect several hundred more.
