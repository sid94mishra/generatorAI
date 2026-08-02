# GeneratorAI — Codebase Analysis & Issue Triage

> **Status:** Generated from a full end-to-end source review (code is the source of truth; docs were intentionally ignored). Two waves of parallel exploration agents covered Core, hooks/harness, templates/scripts, Web UI, CLI, the SDK, the dual execution paths, script-upload, CLI↔Web parity, SDK distribution (with web research), and a broad bug sweep.
>
> **Open this file in the editor:** `docs/CODEBASE_ANALYSIS_AND_ISSUE_TRIAGE.md`
>
> This document has two halves:
> - **Part A — System Analysis** (how everything actually works).
> - **Part B — Issue Catalog** (every issue found, with location, why it matters, root cause, and details for triage).

---

## ⚠️ Corrections to `CLAUDE.md` proven by the code

1. The harness adapter package is **`packages/agent-harness-providers`**, not `copilot-bridge`.
2. `harness.type` is **`'copilot' | 'claude-agent'`** (the alt SDK is the **Claude Agent SDK** `@anthropic-ai/claude-agent-sdk`), **not** `'anthropic'`.
3. The web UI **does** have a harness/provider switch (Settings → Provider tab, `GET/POST /api/harness`). An earlier assumption that it was missing is false.
4. The CLI **has no working Direct mode** — `createClient` throws `"Direct mode is not yet implemented"`. The "local-first, no-server" CLI path does not exist today.

---

# PART A — SYSTEM ANALYSIS

## A1. WorkflowDefinition model (all options)

Created via `WorkflowDefinitionService.createDefinition` ([WorkflowDefinitionService.ts:36](../packages/core/src/services/WorkflowDefinitionService.ts#L36)); schema [WorkflowDefinitionSchemas.ts:153](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L153); DB row [schema.ts:303](../packages/db/src/schema.ts#L303).

Fields: `name` (1–200), `description` (≤2000), `sessionMode` (`single|per-stage|auto`, default `auto`), `harnessConfig` (stored in legacy DB column `copilot_config`), `variables[]` (max 50), `tags[]` (max 20), `orchestratorConfig`, `projectId`, `skills[]` (max 20), `agents[]` (max 10), `hooks[]` (max 50), `hooksFile`. Service-managed: `version` (increments per update, busts DAG cache), `selectedArtifacts`. DB-only: `scope`, `useWorktree` (DB default `true`, **no schema setter**).

**HarnessConfigSchema** ([schema:63](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L63)): `model`, `systemMessage{mode,content}`, `systemPromptAppend`, `streaming`, `mcpServers{type:http|stdio,url?,command?,args?}`, `availableTools[]`, `excludedTools[]`, `skillDirectories[]`, `disabledSkills[]`, `customAgents[]`, `provider{name,baseUrl,apiKey,model?}` (BYOK / alternate provider), `configDir`, `reasoningEffort(low|medium|high|xhigh)`, `maxTurns`.

**OrchestratorConfigSchema** ([schema:130](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L130)): `category(system|custom|derived)`, `parentTemplateId`, `codebaseAliases[]` (max 5), `createWorktrees` (default true), `preprocessingSteps[]`, `resultValidations[]`, `requiresCodebase` (default false), `autoCommit`, `autoCreatePR`, `postProcessingSteps[]`.

## A2. StageDefinition model (how to create stages)

Created via `addStage` ([WorkflowDefinitionService.ts:98](../packages/core/src/services/WorkflowDefinitionService.ts#L98)); schema [schema:192](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L192).

Fields: `workflowDefinitionId`, `name`, `description`, `templateId?`, `order` (auto `maxOrder+1`), `prompts[]`, `promptType(inline|file)`, `harnessConfigOverrides` (deep-merged at execution), `variables`, `hooks[]`, `retryPolicy{maxRetries 0–10, backoffMs≥100, backoffMultiplier≥1}`, `timeoutMs`, `condition{type:always|on_success|on_failure|expression}`, `contextFilter(full|summary-only|none|structured, default summary-only)`, `contextSources[]`, `outputFormat(text|json)`, `agentName`, `skills[]`, `resultValidation[]` (max 20), `expectedOutput` (≤5000), `outputSchema` (JSON Schema), `iterationConfig` (sub-workflow loops, `maxIterations` 1–100).

## A3. Edges & conditions

Edge: `{fromStageId, toStageId, edgeType: on_success|on_failure|on_completion|always}`. **DB UNIQUE index on `(fromStageId,toStageId)`** ([schema.ts:390](../packages/db/src/schema.ts#L390)) — only one edge per stage pair.

Edge semantics ([DAGScheduler.ts:178](../packages/core/src/services/DAGScheduler.ts#L178)): `on_success`→completed; `on_failure`→failed; `on_completion`→completed|failed; `always`→any terminal.

Conditions evaluated by a hand-rolled tokenizer + shunting-yard parser (no `eval`) in `ConditionEvaluator.ts`. Supports literals, comparisons, `AND/OR/NOT` (+ `&&/||/!`), parentheses, `status`/`parentStatus`/`variables.x.y`. Unparseable → `false` (fail-safe).

## A4. DAGScheduler

Hash-based DAG cache keyed by `definitionId` (SHA-1 of stages+edges) — mid-run edits auto-bust the cache (the old "stale cache" gotcha is fixed). `validateDAG` rejects self-edges, missing refs, duplicate edges, cycles (Kahn), no-roots; unreachable nodes = warning only. Ready = `pending` + all predecessors terminal. Routing filters outgoing edges by status then evaluates the target's `condition`.

## A5. State machines

- **WorkflowRun** (8): `created→starting→running→{completed|failed|cancelling→cancelled}`, `paused`, `failed --user:retry--> created`.
- **StageRun** (10): adds `sleeping` (durable sleep) and `awaiting_input` (HITL).
- **Session** (6): `created→active↔paused→closing→closed`, recoverable `error`.

## A6. Running a workflow — handoff artifacts

Per-run layout via `WorkspaceManager`: `<root>` working dir, `<root>/artifacts`, `<root>/config` (uploads), `<root>/source/<alias>` (git worktrees). Each stage produces: code-block extraction → workspace files (with traversal/symlink defense), markdown artifacts (`<stage>_response_<n>.md`), structured `outputData` (from `output.json`), `artifactManifest`, scratchpad aggregation, and `stream-log.jsonl` (one JSON line per event). System vars: `__workingDirectory`, `__artifactsDirectory`, `__workflowRunId`, `repo_path_<alias>`, etc.

Run-time options: session allocation (`single`/`per-stage`/`auto`—auto≡per-stage today), retry policies, validation-retry, pause/resume/cancel, HITL (`awaiting_input` + persisted `interrupt_data`), durable sleep, permission modes (`bypassPermissions|default|acceptEdits|plan`), RunProfiles (`stageOverrides`, `selectedCodebases`, etc.).

## A7. Hooks

Shape: `{id,name,phase,type(script|http|function),priority,enabled,failurePolicy(abort|skip|continue),timeoutMs,retries,config}` returning `HookResult{variables,contextMessages,attachments,abort,abortReason}`. Backends: `script` (subprocess), `http` (webhook), `function` (`modulePath` subprocess or in-process `handlerName`). Synchronous `HookBridge` installs into the SDK's native hook surface so `pre_tool_use` can truly block a tool. Policy bridge runs `evaluateToolPermissions`. Phases span stage-level (`pre_run/post_prompt/post_run/on_error/on_cancel`), workflow-level (`on_run_start`, `pre/post_clone`, `pre/post_commit`, `on_run_complete/failed/cancelled`, etc.), SDK-event-mapped, and client-lifecycle. **Several declared phases never fire** (see ISSUE HOOK-1).

## A8. Harness

`IAgentHarness` port is SDK-agnostic. `createHarnessProvider(config)` switches on `config.type` with lazy dynamic imports (unused SDK need not be installed), wrapped in `HarnessProxy`. Config in `AppConfig.ts`: `harness.type` (default `copilot`), `harness.copilot{...}`, `harness.claudeAgent{...}`. Event mappers normalize both providers to identical-shaped `AgentEvent`s. Copilot passes `mcpServers` through; Claude builds an in-process MCP server `generatorai-tools`.

## A9. Three workflow-creation paths

| Path | Schema | Endpoint | Edge form | Inline JS hooks |
|---|---|---|---|---|
| Registered template | `WorkflowTemplateSchema` | `POST /api/workflow-definitions/import {templateId}` | index | No |
| Full JSON upload | `ImportWorkflowJsonSchema` | `POST /api/workflow-definitions/import-json` | index | No |
| `.workflow.mjs` script | `WorkflowScriptOutputSchema` | `POST /api/workflow-scripts/:id/materialize` or `/run` | localId | **Yes** |

All converge on `createDefinition → addStage×N → addEdge×M`. Scripts are the only path supporting inline JavaScript hook closures (registered in `HookExecutor` under `script:<workflowId>:<hookId>`). System templates: `system-code-generation`, `system-code-review`, `system-e2e-testing`, `system-refactoring`, `system-test-generation`.

## A10. Script lifecycle & how a user adds their own script

Scripts are discovered **server-side** by `WorkflowScriptLoader` from fixed dirs `[templatesDir/scripts, templatesDir]` at boot or via `POST /api/workflow-scripts/reload`. The example `templates/scripts/e2e-feature-coverage.workflow.mjs` builds a diamond DAG `classify → {summarize, keywords} → synthesize` exercising all variable types, inline+declarative hooks, conditions, and 3 profiles.

**The only supported way for a user to add a script today:** place the `.mjs` on the server host filesystem in `templates/scripts/`, then `reload`. There is **no upload endpoint or UI** (see ISSUE SCRIPT-1). Web UI (`/scripts`) and CLI (`script`) can list/show/profiles/validate/materialize/run/reload already-discovered scripts.

## A11. Dual execution paths (the 2.1 question, resolved)

There are **not two competing engines** — there is **one engine + one optional envelope**:

- **PATH B = `WorkflowRunService.startRun`** ([WorkflowRunService.ts:264](../packages/core/src/services/WorkflowRunService.ts#L264)) — the actual DAG runtime. Owns DAG build, stage scheduling, `onStageCompleted/onStageFailed`, validation-retry, lifecycle. Driven forward by a **3-second polling loop** (`startPolling`).
- **PATH A = `WorkflowOrchestrator.startOrchestratedRun/executeOrchestration`** ([WorkflowOrchestrator.ts:355](../packages/core/src/services/WorkflowOrchestrator.ts#L355)) — a setup/teardown envelope adding clone, worktrees, project-config cascade, preprocessing, sandbox, workflow-level hooks, cross-stage result validation, and post-processing (auto-commit/PR). At **Phase 5 it calls PATH B** ([WorkflowOrchestrator.ts:727](../packages/core/src/services/WorkflowOrchestrator.ts#L727)).

**Both are used; neither is dead.** PATH B is also called standalone by 4 callers: `POST /workflow-runs/:id/start`, `/retry`, `/workflow-scripts/:id/run`, and `AutomationService.runSingleWorkflow`.

**Caller → path map:**

| Trigger | Path | Heavy envelope? |
|---|---|---|
| `POST /api/workflow-runs/:id/start` | B | No |
| `POST /api/workflow-runs/:id/retry` | B | No |
| `POST /api/workflow-scripts/:id/run` | B | No |
| `POST /api/orchestrator/runs` | A→B | Yes |
| SDK `workflows.run()` | createRun **only** (never executes!) | No |
| SDK `workflows.orchestrate()` | A→B | Yes |
| Web non-orchestrated def | createRun + B | No |
| Web orchestrated def | A→B | Yes |
| CLI `run start` | createRun + B | No |
| CLI `orchestrator start` | A→B | Yes |
| Automation | createRun + B | No |

**Recommendation: keep both, but** (1) extract the duplicated workspace/worktree setup into one helper (it exists in both files, surviving only because of an implicit `__workingDirectory`-set guard — see ISSUE EXEC-1); (2) add event-driven stage routing and demote polling to a safety-net (see EXEC-2); (3) fix/deprecate the SDK `workflows.run()` foot-gun (see SDK-6). Do **not** delete either path or merge into one god-service.

---

# PART B — ISSUE CATALOG

**Severity legend:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

## B0. Summary table

| ID | Title | Sev | Area |
|---|---|---|---|
| EXEC-1 | Duplicated workspace/worktree setup across both execution paths | 🟡 | Core |
| EXEC-2 | No event-driven DAG routing; 3s polling is the sole driver | 🟠 | Core |
| EXEC-3 | Overlapping poll ticks can double-process a stage during validation retry | 🟠 | Core |
| EXEC-4 | Double result-validation across orchestrator + run-service paths | 🟠 | Core |
| EXEC-5 | `onStageFailed` marks whole run failed even after a successful `on_failure` recovery branch | 🟠 | Core |
| EXEC-6 | `always`/`on_completion` edges out of a *skipped* stage never route | 🟡 | Core |
| EXEC-7 | `executeStage(...).catch(()=>{})` swallows pre-status launch errors → run hangs | 🟡 | Core |
| EXEC-8 | `SessionAllocator` shared-refcount leak on retry re-allocation | 🟡 | Core |
| EXEC-9 | `processedStageRuns` set unbounded; never pruned | 🟢 | Core |
| DATA-1 | Chat worktrees always treated as orphaned → live-chat worktree deletion | 🟠 | DB/Core |
| DATA-2 | Per-project worktree cleanup endpoint triggers a global all-projects sweep | 🟡 | Server |
| DATA-3 | FK-violation detection by substring match is fragile | 🟡 | DB |
| DATA-4 | `chats.codebase_ids` JSON-mode schema vs raw-TEXT migration drift | 🟢 | DB |
| DATA-5 | `copilot_config` legacy column/var naming lies about harness abstraction | 🟢 | DB/Core |
| SEC-1 | Auto-approve permissions + HostProcessSandbox host fallback = effective RCE | 🔴 | Security |
| SEC-2 | Webhook signature re-verification in service is broken (rejects valid GitHub deliveries) | 🟠 | Server |
| SEC-3 | Webhook auth entirely optional; unconfigured deploy auto-starts runs from any caller | 🟡 | Server |
| SEC-4 | Host sandbox env allowlist forwards `PATH`/`APPDATA`/`USERPROFILE` (secret leakage) | 🟡 | Security |
| SEC-5 | Config-upload filePath derived from client filename without sanitization (traversal) | 🟢 | Server |
| SEC-6 | `WebhookService.evaluateCondition` walks payload paths with no proto-pollution guard | 🟢 | Server |
| SEC-7 | `validateScriptPath` does not resolve symlinks | 🟢 | Core |
| SCHEMA-1 | Two incompatible `permissionMode` vocabularies; invalid values persisted (PWS-08) | 🟠 | Shared |
| SCHEMA-2 | `StageRunOverrideSchema.contextFilter` missing `'structured'` | 🟡 | Shared |
| SCHEMA-3 | `variables.*` condition expressions are dead (scheduler only passes `parentStatus`) | 🟡 | Core |
| API-1 | HITL resume uses divergent endpoints: web `/approve` vs CLI `/resume` | 🟡 | Server |
| API-2 | `/interrupt` endpoint fires HITL fire-and-forget; test hook leaking into prod API | 🟡 | Server |
| API-3 | Codebase-delete verification uses an exception as control flow | 🟡 | Server |
| API-4 | Rate limits raised 10× with no rationale (no-auth DoS surface) | 🟡 | Server |
| WEB-1 | `archiveChat` PATCH vs `DELETE /chats/:id` now hard-deletes — accidental data loss | 🟡 | Web/Server |
| WEB-2 | "Retry" stage button is mis-wired to `resumeRun` | 🟠 | Web |
| WEB-3 | Toast store module-global singleton leaks across HMR/unmount | 🟢 | Web |
| FEAT-1 | `auto` session mode is identical to `per-stage` (not adaptive) | 🟡 | Core |
| FEAT-2 | `maxTurns` stored but not passed to the Copilot SDK | 🟡 | Harness |
| FEAT-3 | Explicit `timeoutMs` silently floored to 5 min | 🟡 | Core |
| HOOK-1 | Dormant hook phases never fire (`on_stage_completed/failed/parallel_join/pr_created`) | 🟡 | Core |
| HOOK-2 | `resolveStageHooks` / `.hooks.json` per-stage merge not wired into live path | 🟡 | Core |
| SCRIPT-1 | No way to upload a user-authored script via API/UI (host-FS only) | 🟠 | Server/Web |
| SCRIPT-2 | Script `contextSources` (`.contextFrom`) dropped during materialize/run | 🟡 | Server |
| SDK-1 | SDK is a parallel, unconsumed composition root — server/CLI bypass it; will drift | 🟠 | SDK |
| SDK-2 | SDK is unpublishable: exports point to `./src/*.ts`, no `files`, stale `dist` | 🟠 | SDK |
| SDK-3 | SDK depends on 4 `private:true` source-only packages | 🟠 | SDK |
| SDK-4 | No API-surface contract/versioning; core internals leak through barrel | 🟠 | SDK |
| SDK-5 | `ScriptFacade` missing `run`/`materialize` (doc-comment lies) | 🟠 | SDK |
| SDK-6 | SDK `workflows.run()` creates a run that never executes (foot-gun) | 🟡 | SDK |
| SDK-7 | Edge conditions not exposable via `WorkflowFacade.create` | 🟡 | SDK |
| SDK-8 | No template facade in SDK | 🟡 | SDK |
| SDK-9 | `SandboxConfig` accepted but ignored (no-op) | 🟡 | SDK |
| SDK-10 | No typed harness/session config on `GeneratorAIConfig` | 🟢 | SDK |
| SDK-11 | Run profiles not first-class in SDK | 🟢 | SDK |
| SDK-12 | Heavy `as never`/`as unknown` casts erase types at facade boundaries | 🟢 | SDK |
| PARITY-1 | Web cannot retry a failed run (`retryRun` absent from web client) | 🟠 | CLI/Web |
| PARITY-2 | True per-stage controls (pause/resume/cancel/retry) are CLI-only | 🟠 | CLI/Web |
| PARITY-3 | Web has no workspace lifecycle mgmt (archive/commit/delete/cleanup) | 🟠 | CLI/Web |
| PARITY-4 | Web has no webhook-registration management | 🟠 | CLI/Web |
| PARITY-5 | CLI cannot upload workflow/run files (501 NOT_IMPLEMENTED) | 🟡 | CLI/Web |
| PARITY-6 | CLI cannot upload/update project configs (501; no commands) | 🟡 | CLI/Web |
| PARITY-7 | Run diff/handoff is web-only; CLI client hits a different path, no command | 🟡 | CLI/Web |
| PARITY-8 | Web cannot list hook phases or test hooks | 🟡 | CLI/Web |
| PARITY-9 | Web cannot rotate automation webhook tokens | 🟡 | CLI/Web |
| PARITY-10 | Web has no Copilot conversation inspection / ping | 🟡 | CLI/Web |
| PARITY-11 | CLI "method-only" surfaces (codebase fetch/branches/status, MCP servers, worktrees) | 🟢 | CLI |
| PARITY-12 | `exportDefinition` missing from web client | 🟢 | Web |
| PARITY-13 | Run scratchpad endpoint unused by both clients | 🟢 | CLI/Web |
| CLI-1 | CLI Direct mode non-functional (`createClient` throws) | 🟠 | CLI |
| CLI-2 | CLI TUI is list-only (no run/stage/artifact/stream/DAG/HITL views) | 🟡 | CLI |
| TEST-1 | `agent-harness-providers` event mapper / session translation untested | 🟡 | Test |
| TEST-2 | Sandbox/script-runner infrastructure untested | 🟡 | Test |
| TEST-3 | New edge-routing/validation-retry semantics have only E2E fixtures, no unit tests | 🟡 | Test |
| REPO-1 | `test-results/*.json` + scratch `*-id.txt` not gitignored (in-flight noise) | 🟢 | Repo |

---

## B1. Execution engine (EXEC)

> ### ✅ RESOLUTION STATUS — all EXEC issues fixed (verified, typecheck + build + tests green)
> | ID | Fix shipped | Where |
> |---|---|---|
> | EXEC-1 | Worktree setup extracted to `setupProjectWorktrees()` + guard documented | WorkflowRunService |
> | EXEC-2 | Event-driven routing added (`subscribeRunEvents` on `stage_run.completed/failed`); polling demoted to backstop | WorkflowRunService |
> | EXEC-3 | Polling made non-reentrant (`pollInFlight`); retry flips status off-terminal **before** backoff + dedup reset moved into `retryStageAfterValidation` | WorkflowRunService |
> | EXEC-4 | Single-owner validation in `onStageCompleted` (merges per-stage + workflow-level rules); orchestrator listener is now reporting-only | WorkflowRunService + WorkflowOrchestrator |
> | EXEC-5 | New `DAGScheduler.computeTerminalRunStatus()` (handled-failure fixpoint) + single `finalizeRunIfComplete()` used by both handlers → deterministic, recovery-aware run status | DAGScheduler + WorkflowRunService |
> | EXEC-6 | `getSkippableStages` uses `isEdgeActiveForStatus` (so `always`-from-skipped stays active); new `onStageSkipped()` + `scheduleSuccessorsAfterSkip()` route always-edges out of skipped stages | DAGScheduler + WorkflowRunService |
> | EXEC-7 | All fire-and-forget `executeStage(...).catch` now route to `onStageFailed` (no more silent hang) | WorkflowRunService |
> | EXEC-8 | `allocateSingleMode` ref-count is idempotent per stageRunId (no leak on retry re-alloc) | SessionAllocator |
> | EXEC-9 | `pruneProcessedForRun()` clears dedup keys on complete/cancel/delete | WorkflowRunService |
>
> **Tests added:** `DAGScheduler.test.ts` (computeTerminalRunStatus ×5, skip-routing ×2), `WorkflowRunService.test.ts` (recovery completion; repurposed in-progress test), `SessionAllocator.test.ts` (new, ref-count ×3), `WorkflowRunLifecycle.e2e.test.ts` (new engine-level E2E: linear, unhandled-failure, F1 recovery diamond). Suite: core 308 ✓, server 74 ✓, web 167 ✓; full `turbo typecheck` + `turbo build` ✓.
> Also fixed (pre-existing, surfaced by the build/tests, not EXEC): WEB hook-editor union-spread typecheck error (HooksTab + StagePropertiesPanel); stale `chats-e2e` DELETE test (route is now a hard delete, see WEB-1).


### EXEC-1 🟡 Duplicated workspace/worktree setup across both execution paths
- **Where:** [WorkflowOrchestrator.ts:543-616](../packages/core/src/services/WorkflowOrchestrator.ts#L543) vs [WorkflowRunService.ts:273-365](../packages/core/src/services/WorkflowRunService.ts#L273)
- **What:** Workspace + worktree creation is implemented twice, in near-identical blocks. For orchestrated runs the `startRun` block is skipped only because of the guard `if (!run.variables?.['__workingDirectory'] || !run.variables?.['__artifactsDirectory'])`.
- **Why it's an issue:** The two copies can drift; the guard is the *only* thing preventing double workspace/worktree creation. Fragile coupling.
- **Root cause:** PATH A grew an envelope that re-implemented PATH B's setup instead of sharing it.
- **Fix direction:** Extract one `prepareRunWorkspace(run, definition)` helper used by both.

### EXEC-2 🟠 No event-driven DAG routing; 3-second polling is the sole driver
- **Where:** `startPolling` [WorkflowRunService.ts:458-484](../packages/core/src/services/WorkflowRunService.ts#L458); `onStageCompleted/onStageFailed` are never subscribed to the EventBus.
- **What:** `StageExecutionService` only writes final status to the DB; it never calls back. The DAG is advanced by a 3s `setInterval` polling the DB (plus a `.catch()` failure path and a couple of recursive calls). There is no event-driven completion routing.
- **Why it's an issue:** Up to 3 s of latency per stage transition, constant DB churn, and a design that's easy to mistake for event-driven. Removing polling without a replacement would silently break all progression.
- **Root cause:** Fire-and-forget stage execution with DB-status as the only completion signal.
- **Fix direction:** Subscribe `onStageCompleted/onStageFailed` to `stage_run.completed/failed`; keep the poll as a backstop for the "promise never settles" case. Must preserve the `processedStageRuns` dedup (both drivers would then be live).

### EXEC-3 🟠 Overlapping poll ticks can double-process a stage during validation retry
- **Where:** `setInterval(async …, 3000)` [WorkflowRunService.ts:458](../packages/core/src/services/WorkflowRunService.ts#L458); dedup keys deleted at [:679](../packages/core/src/services/WorkflowRunService.ts#L679), [:888-889](../packages/core/src/services/WorkflowRunService.ts#L888).
- **What:** `setInterval` doesn't await the async callback. A tick running `retryStageAfterValidation` (which sleeps `backoffMs * multiplier^retryCount`) can exceed 3 s, so the next tick fires concurrently. Because `processedStageRuns` keys are deliberately deleted before retry, a concurrent tick can re-enter `onStageCompleted` for the same `stageRunId` → double validation, double retry increment, duplicate `stage_run.retrying` events.
- **Why it's an issue:** Real race on the actively-developed validation-retry feature; produces duplicate work and corrupt retry counters.
- **Root cause:** Non-reentrancy-guarded `setInterval` + dedup key deletion window.
- **Fix direction:** Use a self-scheduling `setTimeout` loop (await each pass), or a per-run mutex around `onStageCompleted/onStageFailed`.

### EXEC-4 🟠 Double result-validation across the two paths
- **Where:** `WorkflowRunService.onStageCompleted` [:650-709](../packages/core/src/services/WorkflowRunService.ts#L650) duplicates `WorkflowOrchestrator.setupResultValidation` [WorkflowOrchestrator.ts:807-895](../packages/core/src/services/WorkflowOrchestrator.ts#L807); both wired in `composition-root.ts`.
- **What:** For an orchestrated run, a stage with `resultValidation` rules can be validated (and retried/failed) by both the orchestrator's EventBus listener and the run-service poller.
- **Why it's an issue:** Duplicate retries / conflicting failure decisions; no guard prevents both firing.
- **Root cause:** Validation logic added to PATH B without removing/guarding the PATH A listener.
- **Fix direction:** Single owner for result validation (preferably PATH B), or a shared dedup guard.

### EXEC-5 🟠 `onStageFailed` marks the whole run failed even after a successful `on_failure` recovery branch
- **Where:** [WorkflowRunService.ts:813-816](../packages/core/src/services/WorkflowRunService.ts#L813)
- **What:** On DAG completion the run is marked `failed` if *any* stage has `status==='failed'`, even when an `on_failure` recovery branch ran and the final stage completed (exactly the `test-results/e2e-failure-f1.json` scenario).
- **Why it's an issue:** Recovery DAGs (the headline use of `on_failure`/`on_completion` edges) report `failed` despite recovering successfully — defeats the feature.
- **Root cause:** Run-status derivation looks at raw stage statuses instead of leaf/terminal reachability.
- **Fix direction:** Derive run status from terminal leaf stages / DAG-completion semantics, not "any failed."

### EXEC-6 🟡 `always`/`on_completion` edges out of a *skipped* stage never route
- **Where:** `isEdgeActiveForStatus` documents `always` as any terminal status [DAGScheduler.ts:171-187](../packages/core/src/services/DAGScheduler.ts#L171); `getSkippableStages` returns false for skipped predecessors [:353-357](../packages/core/src/services/DAGScheduler.ts#L353); `routeFromTerminalStage` only invoked with `completed`/`failed`.
- **What:** A diamond/fan-in target reached by an `always` edge from a *skipped* predecessor gets skipped, contradicting `always` semantics; skipped stages silently drop their outgoing `always`/`on_completion` edges.
- **Why it's an issue:** Correctness gap for fan-in DAGs that rely on `always`/`on_completion` to converge after a skip.
- **Fix direction:** Route from skipped stages too, or redefine skip semantics for `always` edges explicitly.

### EXEC-7 🟡 `executeStage(...).catch(()=>{})` swallows pre-status launch errors
- **Where:** [:740-742](../packages/core/src/services/WorkflowRunService.ts#L740), [:799-801](../packages/core/src/services/WorkflowRunService.ts#L799), [:527-529](../packages/core/src/services/WorkflowRunService.ts#L527), [:443](../packages/core/src/services/WorkflowRunService.ts#L443).
- **What:** Comment says "handled by polling," but polling only sees DB status transitions. If `executeStage` throws *before* writing `running`/`failed` (e.g., session allocation or config-resolve throws), the stage stays `pending` forever → run hangs silently.
- **Fix direction:** In the `.catch`, write a `failed` status / route `onStageFailed` for pre-status errors.

### EXEC-8 🟡 `SessionAllocator` shared-refcount leak on retry re-allocation
- **Where:** `releaseSession`/`allocateSingleMode` [SessionAllocator.ts:114-148, :201](../packages/core/src/services/SessionAllocator.ts#L114)
- **What:** In `single` mode, every allocate (including retry re-allocation/reuse) increments `sharedRefCount`, but a stage that allocated twice and releases once leaves the count permanently > 0 → shared SDK conversation never destroyed (leak).
- **Fix direction:** Idempotent per-stage allocation tracking; don't double-increment on reuse.

### EXEC-9 🟢 `processedStageRuns` set is unbounded
- **Where:** [WorkflowRunService.ts:49](../packages/core/src/services/WorkflowRunService.ts#L49); not pruned in `deleteRun`/`cancelRun`.
- **What:** Grows for the process lifetime; minor memory leak on long-lived servers.

---

## B2. Data / DB (DATA)

> ### ✅ RESOLUTION STATUS — DATA fixes shipped (typecheck + build + tests green)
> | ID | Verdict | Fix shipped | Where |
> |---|---|---|---|
> | DATA-1 | True (data loss) | `isWorktreeOrphaned` is now owner-type-aware: `manual` (chat) worktrees consult the **chat** repo (`active`=live, `archived`=orphaned); when no chat repo is wired it conservatively does NOT orphan. Chat repo injected in composition-root. | WorktreeCleanupService + composition-root |
> | DATA-2 | True | New `runCleanupForProject(projectId)` (extracted `_cleanupProject`); both project cleanup routes now scope to the requested project instead of the global `runCleanup()`, eliminating the cross-project sweep + double-clean. | WorktreeCleanupService + projects.ts |
> | DATA-3 | True | FK-violation detection prefers the stable sqlite code `SQLITE_CONSTRAINT_FOREIGNKEY` (message match kept only as fallback). | StageDefinitionRepository + WorkflowDefinitionRepository |
> | DATA-4 | Benign | `chats.codebase_ids` JSON-vs-TEXT drift is harmless (repo maps NULL→undefined). No change. | — |
> | DATA-5 | Cosmetic | `copilot_config` column rename blocked by no-drop rule. No change. | — |
>
> **Tests added:** `WorktreeCleanupService.test.ts` (chat-active not orphaned, chat-archived orphaned, run terminal/active, no-chat-repo conservative, per-project scoping). core suite 313 ✓.


### DATA-1 🟠 Chat worktrees are always treated as orphaned → live-chat worktree deletion
- **Where:** `WorktreeCleanupService.isWorktreeOrphaned` [WorktreeCleanupService.ts:194-205](../packages/core/src/services/WorktreeCleanupService.ts#L194); chats pass `runId = chatId` to `createRunWorktrees`.
- **What:** `isWorktreeOrphaned` resolves `workflowRunRepo.getById(runId)`. For chat worktrees `runId` is a `chatId`, so `getById` throws → caught → returns `true` (orphaned). Every active chat worktree is flagged orphaned and removed once the age threshold passes.
- **Why it's an issue:** **Data loss / broken live sessions** — pulls the working directory out from under an active chat. Introduced by the chat-worktree feature interacting with cleanup.
- **Root cause:** Orphan check assumes worktree owner is always a workflow run.
- **Fix direction:** Make the orphan check owner-type-aware (chat vs run); look up chats too.

### DATA-2 🟡 Per-project cleanup endpoint triggers a global all-projects sweep
- **Where:** `projects.ts` `POST /projects/:id/worktrees/cleanup` now also calls `worktreeCleanupService.runCleanup()` which iterates all active projects [WorktreeCleanupService.ts:77-79](../packages/core/src/services/WorktreeCleanupService.ts#L77).
- **What:** A scoped endpoint silently cleans every project; also double-deletes the same rows (per-project + global).
- **Fix direction:** Scope the endpoint to the project id only.

### DATA-3 🟡 FK-violation detection by substring match is fragile
- **Where:** `StageDefinitionRepository.ts:155-170`, `WorkflowDefinitionRepository.ts:120-135` — `msg.includes('FOREIGN KEY')`.
- **What:** Works for better-sqlite3 today but is driver/locale-dependent and can misclassify unrelated errors.
- **Fix direction:** Check the error code `SQLITE_CONSTRAINT_FOREIGNKEY`.

### DATA-4 🟢 `chats.codebase_ids` JSON-mode schema vs raw-TEXT migration drift
- **Where:** `schema.ts:283` (`mode:'json'`, no default) vs `migrations/index.ts:480` (plain TEXT). Pre-existing rows get `NULL`; repo maps with fallback `undefined` (OK), but the typing drift is worth noting.

### DATA-5 🟢 `copilot_config` legacy naming
- **Where:** DB column `copilot_config`; aliased as `copilotConfig` in `WorkflowRunService` [:721, :790](../packages/core/src/services/WorkflowRunService.ts#L721).
- **What:** The name lies about the harness abstraction (the Claude Agent harness also flows through it). Cosmetic tech debt; do not rename the column (no-drop rule) but consider a domain-level rename.

---

## B3. Security (SEC)

> ### ✅ RESOLUTION STATUS — SEC fixes shipped / verified (typecheck + build + tests green)
> | ID | Verdict | Fix / finding | Where |
> |---|---|---|---|
> | SEC-1 | Already mitigated | Silent host-sandbox fallback is **already gated** — requires `GENERATORAI_ALLOW_HOST_SANDBOX=true` or `provider="host"`, else throws; logs at ERROR. Auto-approve remains the intended autonomous posture (HITL permission modes are the control); not changed (would break autonomous workflows). Verified, documented. | composition-root.ts:176-202 |
> | SEC-2 | True (breaks GitHub) | Removed the broken service-side re-verification (`JSON.stringify(payload)` HMAC). Raw-body HMAC in the route middleware is now the single source of truth. | WebhookService |
> | SEC-3 | Hardening | Unauthenticated webhook deliveries (no secret/token configured) now log a loud WARN. | webhooks.ts |
> | SEC-4 | Not a real fix | Host fallback isn't an isolation boundary by design; env passthrough (`APPDATA`/`USERPROFILE`/`PATH`) is required for tooling. No change. | — |
> | SEC-5 | True (weak guard) | Hardened `ProjectConfigService` traversal check from `startsWith(resolvedDir)` to a trailing-separator comparison (closes the sibling-prefix hole) in both upload + update paths. | ProjectConfigService |
> | SEC-6 | True | `WebhookService.evaluateCondition` now rejects prototype-chain keys (`__proto__`/`constructor`/`prototype`) and traverses safely (null/non-object guard). | WebhookService |
> | SEC-7 | True | `validateScriptPath` resolves symlinks via `realpathSync` (with resolve() fallback) before the containment check, so a symlink inside an allowed dir can't smuggle a file in. | WorkflowScriptLoader |


### SEC-1 🔴 Auto-approve permissions + HostProcessSandbox host fallback = effective RCE
- **Where:** `SessionAllocator.createSession` defaults `onPermissionRequest` to `async () => ({granted:true})` [SessionAllocator.ts:331](../packages/core/src/services/SessionAllocator.ts#L331); `HostProcessSandboxProvider` runs on host with no isolation [HostProcessSandboxProvider.ts:38-60](../packages/core/src/infrastructure/HostProcessSandboxProvider.ts#L38).
- **What:** Every workflow stage auto-approves all tool calls; the documented sandbox fallback runs directly on the host. A malicious/buggy prompt can run arbitrary host commands with the server's privileges.
- **Why it's an issue:** With "no user auth" and any non-localhost exposure, this is remote code execution. Effectively critical.
- **Root cause:** Convenience defaults (auto-approve) + optional sandbox.
- **Fix direction:** Default to a restrictive permission policy in non-dev; require explicit opt-in for host sandbox; surface a loud startup warning.

### SEC-2 🟠 Webhook signature re-verification in the service is broken
- **Where:** `WebhookService.handleGitHub` re-verifies via `JSON.stringify(payload)` [WebhookService.ts:46-49, :185](../packages/core/src/services/WebhookService.ts#L46); route already verified raw body in middleware [webhookAuth.ts:82-84](../apps/server/src/middleware/webhookAuth.ts#L82).
- **What:** Re-serializing the parsed body produces different bytes than GitHub signed, so when `githubSecret` is set the service rejects every legitimate delivery.
- **Why it's an issue:** Breaks GitHub webhook integration whenever a secret is configured.
- **Fix direction:** Remove the duplicate service-side verification; trust the raw-body middleware (single source of truth).

### SEC-3 🟡 Webhook auth entirely optional
- **Where:** `webhooks.ts:30-40` (GitHub), `:67-77` (custom) skip verification when no secret configured.
- **What:** An unconfigured deployment accepts any webhook and auto-starts runs (`reg.autoStart`).
- **Fix direction:** Refuse unsigned webhooks (or hard-warn) outside dev mode.

### SEC-4 🟡 Host sandbox env allowlist forwards `PATH`/`APPDATA`/`USERPROFILE`
- **Where:** [HostProcessSandboxProvider.ts:25-31](../packages/core/src/infrastructure/HostProcessSandboxProvider.ts#L25). Secrets stored under these (npm tokens in APPDATA, etc.) reach sandboxed commands.

### SEC-5 🟢 Config-upload filePath from client filename without sanitization
- **Where:** `projects.ts` derives `filePath` from `req.file?.originalname`/`req.body.filePath` (diff `:249-266`). A `../` originalname is a traversal vector at the write consumer (`projectConfigService`).
- **Fix direction:** `basename`/normalize guard before any disk write.

### SEC-6 🟢 `WebhookService.evaluateCondition` no proto-pollution guard
- **Where:** [WebhookService.ts:217-240](../packages/core/src/services/WebhookService.ts#L217). Walks arbitrary `payload` paths via `split('.')`; read-only so low risk, but filter `__proto__`/`constructor` keys.

### SEC-7 🟢 `validateScriptPath` does not resolve symlinks
- **Where:** [WorkflowScriptLoader.ts:387-400](../packages/core/src/services/WorkflowScriptLoader.ts#L387). Textual confinement to allowed dirs passes a symlink inside `templates/scripts/` pointing outside. Low risk given the operator-trust model, but add `realpath`.

---

## B4. Schemas (SCHEMA)

> ### ✅ RESOLUTION STATUS — SCHEMA fixes shipped (typecheck 14/14 + build + tests green)
> | ID | Fix shipped | Where |
> |---|---|---|
> | SCHEMA-1 | Script-profile permissionMode (`askOnEachTool`/`askOnce`/`bypassPermissions`) is now **mapped** to the canonical run vocabulary (`askOnEachTool→default`, `askOnce→acceptEdits`, others pass through) before `setPermissionMode`; unknown values are dropped, not persisted. | `mapScriptPermissionMode` in workflowScripts route |
> | SCHEMA-2 | `StageRunOverrideSchema.contextFilter` enum gained `'structured'` (matches stage defs + script-profile overrides). | WorkflowDefinitionSchemas |
> | SCHEMA-3 | `DAGScheduler` now takes an optional `runRepo` and passes the run's `variables` into edge-condition evaluation, so `variables.*` expressions resolve to real values (were always undefined→false). Wired in `createCoreServices`. | DAGScheduler + ConditionEvaluator context + createCoreServices |
>
> **Tests added:** DAGScheduler `variables.*` conditions ×3 (true/false/no-repo). core 316→ (suite green).

### SCHEMA-1 🟠 Two incompatible `permissionMode` vocabularies; invalid values persisted
- **Where:** `ScriptRunProfileSchema.permissionMode = [askOnEachTool, askOnce, bypassPermissions]` [WorkflowScriptSchema.ts:191](../packages/shared/src/config/WorkflowScriptSchema.ts#L191) vs everywhere else `[bypassPermissions, default, acceptEdits, plan]` ([WorkflowDefinitionSchemas.ts:346](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L346); `setPermissionMode` [:600-606](../packages/core/src/services/WorkflowRunService.ts#L600)). PWS-08 (diff `workflowScripts.ts:264-275`) casts a script profile's value and calls `setPermissionMode` without validation.
- **What:** A profile with `askOnce`/`askOnEachTool` is stored as an invalid permission mode.
- **Fix direction:** Unify the vocabulary or map script values → canonical set before persisting.

### SCHEMA-2 🟡 `StageRunOverrideSchema.contextFilter` missing `'structured'`
- **Where:** [WorkflowDefinitionSchemas.ts:329](../packages/shared/src/config/WorkflowDefinitionSchemas.ts#L329) — override enum lacks `structured`, though stage defs and script-profile overrides include it. Runtime/profile overrides silently can't set `structured`.

### SCHEMA-3 🟡 `variables.*` condition expressions are dead
- **Where:** `ConditionEvaluator` supports `variables.x.y`, but `DAGScheduler` only passes `{parentStatus}` [DAGScheduler.ts:279, :370](../packages/core/src/services/DAGScheduler.ts#L279).
- **What:** Any condition referencing `variables.*` resolves to undefined → `false` in practice.
- **Fix direction:** Pass run/stage variables into `evaluateCondition`, or document the limitation.

---

## B5. Server API (API)

> ### ✅ RESOLUTION STATUS — API fixes shipped (server 77 tests green)
> | ID | Fix shipped | Where |
> |---|---|---|
> | API-1 | The CLI's HITL `resumeStage` (which carries an `{approved,value,reason}` resolution) now targets `/approve` like web — previously it hit `/resume` (pause/resume), which ignored the resolution body. Pause/resume keeps its own `resumeStageRun`. Both clients' HITL resume now reconcile on one endpoint. | cli HttpPlatformClient |
> | API-2 | Stale `/interrupt` comment corrected (referenced `POST /resume`; HITL resume is now `/approve`). Endpoint kept (legitimate operator/E2E HITL driver). | workflowRuns route |
> | API-3 | Codebase-delete verification distinguishes the not-found case (delete confirmed) from real errors (rethrown) instead of treating *any* throw as success. | projects route |
> | API-4 | Rate-limit comment made truthful (code is 600/6000, not 60/600) with rationale: single-user localhost + TanStack-Query fan-out + SSE reconnect bursts; tighten via env beyond localhost. Behavior unchanged (lowering would 429 normal dashboard use). | app.ts |

### API-1 🟡 HITL resume uses divergent endpoints
- **Where:** Web `resumeStage` → `POST /stages/:stageId/approve`; CLI `resumeStage` → `POST /stages/:stageId/resume`. Both exist server-side ([workflowRuns.ts:247 resume, :414 approve](../apps/server/src/routes/workflowRuns.ts#L247)).
- **What:** Same user intent, two different handlers — behavior may diverge.
- **Fix direction:** Reconcile to one endpoint.

### API-2 🟡 `/interrupt` fires HITL fire-and-forget; test hook in prod API
- **Where:** [workflowRuns.ts:367-386](../apps/server/src/routes/workflowRuns.ts#L367). `hitlService.interrupt(...)` resolution promise is dropped; only flips the row to `awaiting_input`. Plus a stale comment at `:376`.
- **Fix direction:** Either wire the awaiter or remove the test-only endpoint from the public surface.

### API-3 🟡 Codebase-delete verification uses an exception as control flow
- **Where:** `projects.ts` (diff `:160-194`) — treats a successful `getCodebaseStatus` as failure, expecting a throw.
- **What:** A soft "not found" return is misread as failure; unrelated throws read as success.
- **Fix direction:** Explicit existence check, not exception-as-signal.

### API-4 🟡 Rate limits raised 10×
- **Where:** `app.ts` (diff `:86-91`) per-key 60→600, global 600→6000, no rationale. With no auth, widens DoS surface.

---

## B6. Web (WEB)

> ### ✅ RESOLUTION STATUS — WEB + PARITY-1/2 fixes shipped (web 167 tests green)
> | ID | Fix shipped | Where |
> |---|---|---|
> | WEB-1 | Audited: archive uses `PATCH {status:'archived'}` (soft); the only `DELETE` call sites are explicitly labeled destructive bulk-delete ("cannot be undone"). No archive UI maps to DELETE — consistent, no code change needed. | (audit) Header.tsx, ChatsListPage, queries |
> | WEB-2 | The stage "Retry" button was wired to `resumeRun`; now wired to a true per-stage retry. | RunControls StageRunControls |
> | WEB-3 | Toast auto-dismiss timers are now tracked + cleared on early dismiss (no leaked timers). | Toast.tsx |
> | PARITY-1 | Web client gained `retryRun` + `useRetryWorkflowRun`; run-level "Retry" button added for failed/cancelled runs. | HttpPlatformClient + workflowQueries + RunControls |
> | PARITY-2 | Web gained dedicated per-stage controls (`pauseStageRun/resumeStageRun/retryStageRun/cancelStageRun` + hooks); StageRunControls now hits `/stages/:id/*` endpoints instead of cascading to run-level. | client + hooks + RunControls |
>
> Shared `IPlatformClient` extended with `retryRun` + the four stage controls (both clients + MockPlatformClient implement them).

### WEB-1 🟡 `archiveChat` PATCH vs `DELETE /chats/:id` hard-delete
- **Where:** `HttpPlatformClient.archiveChat` PATCHes `{status:'archived'}` (diff `:394-399`); `DELETE /chats/:id` changed to hard delete (`chats.ts` diff `:84-95`).
- **What:** Any caller still issuing `DELETE` expecting a soft archive now permanently deletes.
- **Fix direction:** Audit all "archive" call sites; ensure none map to DELETE.

### WEB-2 🟠 "Retry" stage button mis-wired to `resumeRun`
- **Where:** `StageRunControls` retry button [RunControls.tsx:209-218](../apps/web/src/components/workflow/RunControls.tsx#L209) calls `resumeRun`.
- **What:** The button labeled "Retry" performs a resume, not a retry. Combined with PARITY-1 (no `retryRun` in web client), there is no true retry from the web.
- **Fix direction:** Add `retryRun` to the web client and wire the button correctly.

### WEB-3 🟢 Toast store module-global singleton
- **Where:** [Toast.tsx:25-42](../apps/web/src/components/Toast.tsx#L25). Module-level `toasts/listeners/nextId` + `setTimeout` with no unmount cleanup; can `setState` after unmount during HMR.

---

## B7. Feature correctness (FEAT) & Hooks (HOOK)

> ### ✅ RESOLUTION STATUS — FEAT + HOOK fixes shipped (core 326 tests green)
> | ID | Fix shipped | Where |
> |---|---|---|
> | FEAT-1 | `auto` is now genuinely adaptive: resolved at run start from the DAG's execution layers — linear DAG → `single` (shared context across the chain), any parallelism (a layer >1 stage or multiple roots) → `per-stage`. Resolved mode is persisted so every later re-fetch sees it. | WorkflowRunService.startRun |
> | FEAT-2 | Copilot SDK has no session turn-limit (only `infiniteSessions` compaction); the Claude provider already honors `maxTurns`. The Copilot provider now **warns** when `maxTurns` is set instead of silently dropping it (use `harness.type='claude-agent'` to enforce). | CopilotProvider |
> | FEAT-3 | Explicit `timeoutMs` is now honored — the 5-minute `Math.max` floor that silently raised any 1s–5min value was dropped (replaced by a 1s sanity floor). | StageExecutionService |
> | HOOK-1 | The four dormant phases now fire: `on_stage_completed`/`on_stage_failed` in onStageCompleted/onStageFailed; `on_parallel_join` when a >1-predecessor (fan-in) stage is scheduled; `on_pr_created` after a successful `create_pr` post-processing step. | WorkflowRunService + WorkflowOrchestrator |
> | HOOK-2 | `StageExecutionService` now merges the definition's `hooksFile` (per-stage + wildcard) into each stage's hooks via `resolveStageHooks` (was dormant — only inline stage hooks fired). Optional `workflowDefinitionRepo` wired in `createCoreServices`. | StageExecutionService + createCoreServices |
>
> **Tests added:** FEAT-1 auto→single (linear) / auto→per-stage (parallel) ×2.

### FEAT-1 🟡 `auto` session mode ≡ `per-stage`
- **Where:** [SessionAllocator.ts:100-103](../packages/core/src/services/SessionAllocator.ts#L100). "Auto" is not adaptive; it creates a new session per stage. Misleading option.

### FEAT-2 🟡 `maxTurns` not passed to the Copilot SDK
- **Where:** [CopilotProvider.ts:248](../packages/agent-harness-providers/src/providers/copilot/CopilotProvider.ts#L248). Stored in domain config but the Copilot `SessionConfig` doesn't support it. Silently ignored.

### FEAT-3 🟡 `timeoutMs` floored to 5 minutes
- **Where:** [StageExecutionService.ts:69, :756](../packages/core/src/services/StageExecutionService.ts#L69) — `Math.max(stageDef.timeoutMs, 300_000)`. Values 1 s–5 min have no effect.

### HOOK-1 🟡 Dormant hook phases never fire
- **Where:** `on_stage_completed`, `on_stage_failed`, `on_parallel_join`, `on_pr_created` are in the union/schema but have no firing site (verified by repo-wide grep).
- **Fix direction:** Wire them or remove from the public schema.

### HOOK-2 🟡 `resolveStageHooks` / `.hooks.json` per-stage merge not wired
- **Where:** `resolveStageHooks` is exported but `StageExecutionService` reads `stageDef.hooks` directly, so the `hooksFile.stages['*' | name]` merge is dormant.

---

## B8. Scripts (SCRIPT)

> ### ✅ RESOLUTION STATUS — SCRIPT fixes shipped (server 77 tests green, incl. 3 new upload-gate tests)
> | ID | Fix shipped | Where |
> |---|---|---|
> | SCRIPT-1 | Added `POST /api/workflow-scripts/upload` + `WorkflowScriptLoader.saveScript` + `uploadScript` on both platform clients. Because scripts run in-process with full privileges (RCE surface), the endpoint is **gated behind `GENERATORAI_ALLOW_SCRIPT_UPLOAD=true`** (403 when disabled, mirroring the host-sandbox opt-in), with route-boundary + loader-level filename/path-containment guards. Full in-process VM sandboxing (the long-term hardening) remains future work; the gate + guards make the capability available without changing the default trust posture. | workflowScripts route + WorkflowScriptLoader + web/cli clients |
> | SCRIPT-2 | `contextSources` (`.contextFrom([...])`) is now forwarded in both the materialize and run `addStage` calls (was silently dropped). | workflowScripts route |

### SCRIPT-1 🟠 No way to upload a user-authored script via API/UI
- **Where:** `apps/server/src/routes/workflowScripts.ts` has no multer/file route; loader scans only fixed dirs [composition-root.ts:635-639](../apps/server/src/composition-root.ts#L635); `ScriptsListPage`/`ScriptDetailPage` have list/run/materialize/reload only.
- **What:** A user must have server filesystem access to drop a `.mjs` into `templates/scripts/`, then `reload`. There is no "write script → upload via Web UI → run" path. `POST /validate` only dry-runs a file already in an allowed dir; it neither uploads nor registers.
- **Why it's an issue:** Blocks the stated UX ("user creates a script then uses the Web UI to upload and use it").
- **Root cause / constraint:** Scripts execute arbitrary JS in-process via dynamic `import()` with full server privileges and no sandbox/auth — so an upload endpoint would be RCE by design.
- **Fix direction (must be paired):** (a) add a script-source/multipart endpoint that writes into `templates/scripts/` and triggers a single-file load; (b) add `uploadScript` to both platform clients; (c) add a UI file-picker/editor; **and critically** (d) execute scripts in an isolated worker/VM/sandbox process with capability restrictions + add authn/authz. Without (d), do not add upload.

### SCRIPT-2 🟡 Script `contextSources` dropped during materialize/run
- **Where:** Builder produces `contextSources` ([StageBuilder.ts:237](../packages/shared/src/builders/StageBuilder.ts#L237)) but the materialize/run routes pass only `contextFilter` to `addStage` ([workflowScripts.ts:106, :236](../apps/server/src/routes/workflowScripts.ts#L106)).
- **What:** `.contextFrom([...])` in a script is silently lost; `importFromJSON` does accept it.
- **Fix direction:** Forward `contextSources` in both routes' `addStage` calls.

---

## B9. SDK distribution (SDK)

> Research basis: OpenAI Agents JS (`@openai/agents`), Anthropic Claude Agent SDK, Mastra, LangGraph JS, Temporal TS SDK, Inngest, Vercel AI SDK; pnpm `workspace:` protocol + Changesets. See cited URLs in B12.

> ### ✅ RESOLUTION STATUS — SDK: concrete fixes shipped; architecture items scoped
> | ID | Status | Detail |
> |---|---|---|
> | SDK-2 | ✅ Fixed | package.json `exports`/`main`/`types` now point at `./dist` (was `./src/*.ts` — unrunnable); added `"files":["dist","README.md"]`, `"sideEffects":false`, `prepublishOnly` build, `publishConfig.access`. `pnpm build` regenerates fresh `dist` (verified). |
> | SDK-5 | ✅ Fixed | `ScriptFacade.materialize()` + `run()` implemented (createDefinition→addStage×N→addEdge×M, then createRun→startRun; honors profile variables) — the doc-comment no longer lies. |
> | SDK-6 | ✅ Fixed | `WorkflowFacade.run()` now creates AND starts the run (was create-only foot-gun); added `createRun()` for the create-only path. |
> | SDK-7 | ✅ Documented | Conditions live on the **target stage** (`condition`), not on edges — already exposed via the stage input. Added a doc note on the edges field. |
> | SDK-9 | ✅ Fixed | `GeneratorAI.create` now **warns** when `sandbox.enabled` is requested (SDK mode wires no sandbox provider) instead of silently ignoring it. |
> | SDK-1, SDK-3, SDK-4 | 🔭 Scoped | Single shared composition root (server building atop the SDK), publishing the 4 `private` sibling packages in lockstep (or bundling via tsup `noExternal`), and a curated/versioned public API surface (Changesets + `/internal` subpath + API-snapshot test) are coordinated multi-package packaging/architecture efforts. Deferred deliberately — implementing them hastily risks destabilizing the server/CLI that wire core directly today. Path documented in B9 + B12. |
> | SDK-8/10/11/12 | 🔭 Scoped | Template facade, typed harness/session config, first-class run-profile types, and removing `as never`/`as unknown` casts are ergonomic enhancements layered on the SDK-4 curated surface. |

### SDK-1 🟠 SDK is a parallel, unconsumed composition root
- **Where:** `@generatorai/sdk` `GeneratorAI.create()` [GeneratorAI.ts:179](../packages/sdk/src/GeneratorAI.ts#L179) re-wires the whole stack; server wires core directly [composition-root.ts:5-11,42,76,101](../apps/server/src/composition-root.ts#L5); CLI uses its own `HttpPlatformClient`. Repo-wide grep for `@generatorai/sdk` in `apps/` = **zero** matches.
- **What:** Two composition roots for the same core; they already diverge (SDK passes `undefined` for sandbox provider/lifecycle [GeneratorAI.ts:339-340](../packages/sdk/src/GeneratorAI.ts#L339), server wires real sandbox providers).
- **Why it's an issue:** The SDK is not the central entry point — it's a third client that will drift from the server's behavior.
- **Best-practice fix:** Make the SDK (or a shared `createCoreServices` wrapper it owns) the single composition root and have the server build on top of it, injecting server-only concerns via config — the way `@openai/agents` sits atop `@openai/agents-core`. Dogfood the SDK.

### SDK-2 🟠 SDK is unpublishable (exports → `./src/*.ts`, no `files`, stale `dist`)
- **Where:** [packages/sdk/package.json:6-17](../packages/sdk/package.json#L6) points `exports`/`main`/`types` at `./src/index.ts`; no `files`, no `.npmignore`, no `prepublishOnly`. `dist/` exists but is stale — `dist/index.d.ts:3` exports 6 facades while `src/index.ts` exports 10 (missing Project/Hook/Hitl/Workspace).
- **What:** `npm install @generatorai/sdk` would deliver TypeScript Node can't run, with wrong/missing types.
- **Best-practice fix:** Point exports at `./dist`, add `"files":["dist"]`, `prepublishOnly` build (tsup or tsc, dual ESM/CJS + `.d.ts`), `"sideEffects": false`. Mirror `@openai/agents` (`files:[dist]`, subpath exports) and Mastra (granular subpaths).

### SDK-3 🟠 SDK depends on 4 `private:true` source-only packages
- **Where:** `@generatorai/{shared,core,db,agent-harness-providers}` all `"private": true` (each `package.json:4`) and export `./src/*.ts`. Scripts import `WorkflowBuilder` from `@generatorai/shared` ([e2e-feature-coverage.workflow.mjs:27](../templates/scripts/e2e-feature-coverage.workflow.mjs#L27)).
- **What:** npm can't resolve private deps from a registry; an installed consumer's `.workflow.mjs` would import `.ts` at runtime and fail. (`workspace:*` itself is fine — pnpm rewrites it on publish.)
- **Best-practice fix:** Either publish shared/core/db/providers in lockstep (drop `private`, ship `dist`, version via Changesets — OpenAI/Temporal model), or bundle them into the SDK's `dist` with tsup `noExternal`. Re-export `WorkflowBuilder` from `@generatorai/sdk` so scripts import the SDK, not `@generatorai/shared`.

### SDK-4 🟠 No API-surface contract/versioning; internals leak through the barrel
- **Where:** [index.ts:91-151](../packages/sdk/src/index.ts#L91) re-exports concrete core classes (`WorkflowOrchestrator`, `StreamBroker`, `WorkflowScriptLoader`, …), all port interfaces, `CoreServices`, state machines, DAG internals; public fields `services/orchestrator/streamBroker` on `GeneratorAI`. All packages at `0.1.0`, no CHANGELOG/changesets.
- **What:** Every core refactor is a silent breaking change to the "0.1.0" surface; the version conveys no contract.
- **Best-practice fix:** Curated public surface (facades + builders + a few types); move power-user internals behind `@generatorai/sdk/internal` marked unstable (Mastra/LangGraph isolate subpaths). Adopt Changesets for semver + changelog (Inngest/Vercel practice). Add a public-API snapshot test.

### SDK-5 🟠 `ScriptFacade` missing `run`/`materialize`
- **Where:** [ScriptFacade.ts](../packages/sdk/src/facades/ScriptFacade.ts) has only `list/get/validate/reload/reloadScript`; `GeneratorAI.ts:68` doc-comment advertises "list, get, run, materialize."
- **What:** The SDK's headline feature (load + run a `.workflow.mjs`) is absent; consumers must reach into `services`. Contract lies.
- **Fix direction:** Implement `run`/`materialize` wiring through `WorkflowScriptLoader` + orchestrator.

### SDK-6 🟡 SDK `workflows.run()` creates a run that never executes
- **Where:** [WorkflowFacade.ts:140](../packages/sdk/src/facades/WorkflowFacade.ts#L140) calls only `createRun`. JSDoc says so, but it's a foot-gun next to `orchestrate()`.
- **Fix direction:** Rename to `createRun()` or have it call `startRun` after creation.

### SDK-7 🟡 Edge conditions not exposable via `WorkflowFacade.create`
- **Where:** `CreateWorkflowInput.edges` [WorkflowFacade.ts:31-35](../packages/sdk/src/facades/WorkflowFacade.ts#L31) has no `condition` field, though the platform/builder/JSON path support conditional edges.

### SDK-8 🟡 No template facade
- **What:** System/user JSON templates (`templateRegistry`) have no SDK surface (list/import/instantiate).

### SDK-9 🟡 `SandboxConfig` accepted but ignored
- **Where:** `GeneratorAI.create` hard-wires sandbox provider/lifecycle to `undefined` [GeneratorAI.ts:339-340](../packages/sdk/src/GeneratorAI.ts#L339); `resolveConfig` defaults `sandbox.enabled=false`. The option exists but does nothing.

### SDK-10 🟢 No typed harness/session config on `GeneratorAIConfig`
- **What:** `providerOptions: Record<string,unknown>`; `claude-agent` options blindly spread. No exported typed config interface for the constructor.

### SDK-11 🟢 Run profiles not first-class
- **What:** No `RunProfileConfig` type; `orchestrate` takes untyped `stageOverrides: Array<Record<string,unknown>>`.

### SDK-12 🟢 Heavy `as never`/`as unknown` casts
- **Where:** WorkflowFacade hooks/orchestrate, AutomationFacade.get, ProjectFacade, WorkspaceFacade, `tool()`. Consumers get loose `unknown` shapes instead of domain types.

---

## B10. CLI ↔ Web parity (PARITY) & CLI structure (CLI)

> Both clients hit the same Express server. Severity = how impactful the missing capability is on the deprived side.

> ### ✅ RESOLUTION STATUS — PARITY + CLI (typecheck/build/test green)
> | ID | Status | Detail |
> |---|---|---|
> | PARITY-1 | ✅ Fixed | `retryRun` added to web client + hook + run-level Retry button (see WEB banner). |
> | PARITY-2 | ✅ Fixed | True per-stage controls in web (see WEB banner). |
> | PARITY-3 | ✅ Fixed | Web client gained workspace lifecycle methods: `listWorkspaces/getWorkspace/archiveWorkspace/commitWorkspace/deleteWorkspace/cleanupWorkspaces`. |
> | PARITY-4 | ✅ Fixed | Web client gained `listWebhookRegistrations/createWebhookRegistration/deleteWebhookRegistration`. |
> | PARITY-5 | ✅ Fixed | CLI `uploadWorkflowFiles`/`uploadRunFiles` implemented via Node 20 global `FormData`/`Blob` (were 501 stubs). |
> | PARITY-6 | ✅ Fixed | CLI `uploadProjectConfig` (multipart) + `updateProjectConfig` (JSON PUT) implemented (were 501 stubs). |
> | PARITY-8 | ✅ Fixed | Web client gained `listHookPhases` + `testHook`. |
> | PARITY-9 | ✅ Fixed | Web client gained `rotateWebhookToken`. |
> | PARITY-12 | ✅ Fixed | Web client gained `exportDefinition`. |
> | PARITY-7/10/11/13 | 🔭 Documented | Run-diff path reconciliation, web Copilot-conversation inspection, CLI method-only command registration, and the unused scratchpad endpoint are low-value/verification items; client methods exist where endpoints do. UI wiring of the new web client methods (PARITY-3/4/8/9/12) is follow-up UX. |
> | CLI-1 | 🔭 Scoped | A functional `DirectPlatformClient` must implement the full `CLIPlatformClient` surface (~80 methods) against in-process `createCoreServices`; large feature. The misleading `auto`-mode "direct fallback" doc-comment was corrected. |
> | CLI-2 | 🔭 Scoped | TUI run/stage/artifact/stream/DAG/HITL detail views are a large UI effort; interactive depth currently lives in Commander commands. |

### PARITY-1 🟠 Web cannot retry a failed run
- `retryRun` absent from web `HttpPlatformClient`; server exposes `POST /workflow-runs/:id/retry`. Web users must use CLI `run retry`. (See also WEB-2.)

### PARITY-2 🟠 True per-stage controls are CLI-only
- Web `StageRunControls` routes pause/resume/cancel to **run-level** mutations [RunControls.tsx:150-177](../apps/web/src/components/workflow/RunControls.tsx#L150); CLI `run stage …` uses dedicated `/stages/:id/{pause,resume,retry,cancel}` endpoints. Pausing one stage in web pauses the whole run.

### PARITY-3 🟠 Web has no workspace lifecycle management
- CLI `workspace list/show/archive/commit/delete/cleanup` → `/api/workspaces*`. Web client only has `getWorkspaceFiles`/`getWorkspaceFileContent`. Committing workspace git changes / reclaiming disk is CLI-only.

### PARITY-4 🟠 Web has no webhook-registration management
- `/api/webhooks/registrations` CRUD reachable only via CLI `webhook list/create/delete`.

### PARITY-5 🟡 CLI cannot upload workflow/run files
- `uploadWorkflowFiles`/`uploadRunFiles` throw `501 NOT_IMPLEMENTED` (cli `HttpPlatformClient.ts:644-647, 665-667`). Web does multipart. Workflows needing uploaded skills/agents/prompts are web-only.

### PARITY-6 🟡 CLI cannot upload/update project configs
- `uploadProjectConfig`/`updateProjectConfig` throw 501 (cli `HttpPlatformClient.ts:809-823`); no `project config` commands.

### PARITY-7 🟡 Run diff/handoff is web-only + path mismatch
- Web `getRunDiff` → `/orchestrator/runs/:id/workspace/diff` (structured `repos[]`); CLI `getRunDiff` → `/orchestrator/runs/:id/diff` (raw string), no command surfaces it. Verify both server paths exist.

### PARITY-8 🟡 Web cannot list hook phases or test hooks
- `listHookPhases`/`testHook` (CLI `hook phases`/`hook test`) have no web equivalent. Hook authoring exists in web but dry-run testing doesn't.

### PARITY-9 🟡 Web cannot rotate automation webhook tokens
- `rotateWebhookToken` is CLI-only (`automation rotate-token`).

### PARITY-10 🟡 Web has no Copilot conversation inspection / ping
- `copilot conversations/messages/ping` are CLI-only.

### PARITY-11 🟢 CLI "method-only" surfaces
- CLI client implements codebase fetch/branches/status/update, project MCP-server add/list/update/remove, project worktree list/remove/cleanup — but registers **no commands** for them. Reachable programmatically only; web exposes all.

### PARITY-12 🟢 `exportDefinition` missing from web client
- CLI `workflow export` has it; web could re-derive JSON from `getDefinition`.

### PARITY-13 🟢 Run scratchpad endpoint unused by both clients
- `/workflow-runs/:id/scratchpad` ([workflowRuns.ts:90](../apps/server/src/routes/workflowRuns.ts#L90)) is dead on both sides.

### CLI-1 🟠 CLI Direct mode non-functional
- [createClient.ts:28-31](../apps/cli/src/platform/createClient.ts#L28) throws `"Direct mode is not yet implemented."` No `DirectPlatformClient` file. Every CLI invocation requires a running server — the "local-first, no-server" path doesn't exist.

### CLI-2 🟡 CLI TUI is list-only
- `apps/cli/src/tui/` has 5 list views; `*-detail` view states fall back to the list ([TUIApp.tsx:20-30](../apps/cli/src/tui/TUIApp.tsx#L20)). No run-detail, streaming, artifacts, DAG, or HITL views. All interactive depth lives in Commander commands (`run watch`/`run show`/`run workspace`), not the TUI.

---

## B11. Testing (TEST) & Repo hygiene (REPO)

> ### ✅ RESOLUTION STATUS — TEST + REPO (all green)
> | ID | Status | Detail |
> |---|---|---|
> | TEST-1 | ✅ Fixed | New `agent-harness-providers/__tests__/copilot-event-mapper.test.ts` — 10 tests covering SDK→domain event mapping (token/message/tool/session/unknown/null-data/batch) + `mapPermissionKind` (known/unknown/full-map). First tests in the package; runs under `turbo test`. |
> | TEST-2 | ✅ Fixed | New `core/__tests__/HostProcessSandboxProvider.test.ts` — 8 tests: exec success/failure exit codes, missing-sandbox + empty-command errors, cwd traversal guard, **env allowlist drops secrets but forwards PATH**, explicit exec-env override, availability/inspect. |
> | TEST-3 | ✅ Covered | Edge-routing / validation-retry semantics are covered by `DAGScheduler.test.ts` (computeTerminalRunStatus ×5, skip-routing ×2, variables.* ×3) + `WorkflowRunLifecycle.e2e.test.ts` (linear / unhandled-failure / F1 recovery) added in the EXEC + SCHEMA waves. |
> | REPO-1 | ✅ Fixed | `.gitignore` now ignores in-flight E2E scratch artifacts (`test-results/*-id.txt`, `*-run-id.txt`, `import-result.json`, `cli-profile.json`, `artifacts/`, `e2e-*.json`). Verified none are referenced by code/tests. |

### TEST-1 🟡 `agent-harness-providers` event-mapper / session translation untested
- The provider event mappers + session translation (the integration boundary) have no tests.

### TEST-2 🟡 Sandbox / script-runner infrastructure untested
- No tests for `HostProcessSandboxProvider`, `DockerSandboxProvider`, `SandboxedScriptRunner`/`SandboxScriptRunner` — the actual command-execution + isolation code.

### TEST-3 🟡 New edge-routing / validation-retry semantics lack unit tests
- The new `routeFromTerminalStage`/`getSkippableStages` edge-type logic and the validation→failure bridge ship with only E2E JSON fixtures in `test-results/`, no unit tests.

### REPO-1 🟢 In-flight artifacts not gitignored
- `test-results/*.json` (E2E fixtures for validation-retry/failure routing), `*-id.txt`/`*-run-id.txt` scratch files, plus the new `templates/scripts/e2e-feature-coverage.workflow.mjs` and `docs/WORKFLOW_END_TO_END_DETAILED_ANALYSIS.md` are uncommitted and not ignored — they'd be committed as noise.

---

## B12. Research sources (for SDK distribution recommendations)

- OpenAI Agents JS — https://github.com/openai/openai-agents-js (`files:[dist]`, subpath exports, exact-version lockstep siblings)
- Anthropic Claude Agent SDK — https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk (ships built `sdk.mjs`+`sdk.d.ts`, subpath exports)
- Mastra `@mastra/core` — https://www.npmjs.com/package/@mastra/core (granular subpath exports for internals)
- LangGraph JS — https://www.npmjs.com/package/@langchain/langgraph (curated root + `/web` runtime entry)
- Temporal TS SDK — https://github.com/temporalio/sdk-typescript (multi-package, shared-version peer deps)
- Inngest TS SDK — https://www.inngest.com/blog/typescript-types-as-api (types-as-contract; Changesets)
- Vercel AI SDK — built with tsup, dual ESM/CJS, `sideEffects:false`
- pnpm workspaces / `workspace:` protocol rewrite — https://pnpm.io/workspaces · Changesets — https://pnpm.io/using-changesets

---

## B13. Suggested triage order (most load-bearing first)

1. **SEC-1** (auto-approve + host sandbox) — security posture before any non-localhost exposure.
2. **DATA-1** (chat worktrees always orphaned) — active data-loss risk.
3. **EXEC-3 / EXEC-4 / EXEC-5** — correctness on the actively-developed validation-retry/failure-routing feature.
4. **SEC-2** (broken webhook re-verification) — breaks GitHub integration when a secret is set.
5. **SCHEMA-1** (permissionMode vocab split) — invalid data persisted.
6. **SDK-1…SDK-5** — required before the SDK can be distributed at all.
7. **PARITY-1/2/3/4 + WEB-2** — user-facing capability/correctness gaps.
8. **SCRIPT-1 (+ sandboxing)** — required for the "user uploads a script via Web UI" UX.
9. Remaining MEDIUM/LOW + TEST/REPO hygiene.
