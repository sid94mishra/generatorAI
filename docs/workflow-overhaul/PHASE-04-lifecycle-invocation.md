# PHASE 04: One lifecycle, one invocation path

**Goal:** every run, however it was triggered, goes through **one** lifecycle and **one** invocation service.
- The lifecycle is owned by the engine's run states: `starting` for workspace, worktrees, uploads, preprocessing and the sandbox; `finalizing` for compensation, `onExit`, and commit/push/PR as journalled effects.
- The invocation service is `WorkflowInvocationService.invoke()`, behind one route and one client-core method, with server-derived triggers, idempotency, lineage limits, a permission ceiling and a dry-run plan.
- Every client moves to it: web, desktop, mobile, CLI, TUI, SDK, MCP, automations and scripts.
- The old run-start routes and `WorkflowOrchestrator` are **deleted**.

**Estimate:** 2–3 weeks. **Depends on:** P03. **Branch:** `wf/phase-04-invocation`.
**Closes:** W-06, W-10, W-22, W-23 (runtime), W-27, W-37 (profiles, uploads, legacy webhooks), W-56, W-59, W-60, W-63, W-65; C-1, C-6, C-7, C-8 (lifecycle side), C-10, C-14, C-16, C-17. PD-6 applied.

## Read first
- `G4_invocation_tools_skill.md` §1 (current map of the 17 entry points; service, schema, route and client design; the per-client options table; file list)
- `C_orchestration_integrations.md` C-1, C-3, C-6, C-7, C-9, C-10, C-14, C-16, C-17
- `G3_legacy_inventory.md` 5.1, 5.7
- `G5_scheduler_v2_loops.md` §3.9 (finalizing, compensation, post-processing as effects), §5.10

## Design decisions
1. **Lifecycle phases are recorded steps inside run states.** They are not a wrapper service. `starting` runs `prepare` phases in order: workspace → project worktrees (from `lifecycle.codebaseAliases` or the request's `codebases`) → uploads → project configs → preprocessing steps → sandbox. Each phase is a run-scope journalled effect (op id `lifecycle/<phase>`), so a crash resumes at the right phase. `finalizing` runs compensation (LIFO) → `onFailure`/`onExit` hooks → post-processing (commit, push, PR) → release sessions.
   - A new event, `workflow_run.finalized`, is emitted **after** all of this. Every waiter keys on it (W-63).
   - *Why:* the split lifecycle (C-1, G3 5.1) is the reason behaviour depends on the client. Moving the phases into the state machine gives resume-at-phase for free, and deletes the 24 h post-processing listener (B-19) and the duplicate hooks (C-17). Argo `onExit` and Prefect transactions treat setup and teardown as part of the workflow (E §G).
2. **One request schema and one service.**
   - `InvocationRequest` follows G4 §1.3.3: target definition/script/fork; variables with `__*` rejected; codebases with `baseRef` and mode; stage overrides by **key** (skip, variables, model); run overrides (model, harnessType, reasoningEffort, permissionMode); upload ids; profile; name; budget; idempotencyKey; client label.
   - The **trigger is server-derived**, never taken from the body.
   - *Why:* 17 entry points exist today with divergent inputs, scopes and phases (G4 §1.1–1.2).
3. **System variables leave the user bag.** `__workingDirectory`, `__artifactsDirectory`, `__workspaceId`, `__skillDirectories`, `__customAgents`, `__promptDirectories`, `__stageOverrides`, `__projectId` and `__triggeredBy` are **deleted** as variables. They become typed run columns: `system_vars`, `stage_overrides`, `trigger`, `workspace_id`. The executor reads them from the run row. This closes W-06 by construction, not by filtering.
4. **Idempotency.** Key sources, in order: header, `body.idempotencyKey`, then derived for in-process callers (`chat:<chatId>:<toolCallId>`, `stage:<stageRunId>:<toolCallId>`, `auto:<executionId>:<iteration>:<attempt>`). `IdempotencyService` is lifted out of `routes/automations.ts`, and `idempotency_keys.request_hash` is added. The TTL is 24 h for invocations.
5. **Scopes** (PD-6):
   - `POST /api/workflow-invocations` requires `exec:agent` + `read:workflows`.
   - `target.kind: 'script'` additionally requires `write:workflows`.
   - Bypass off-loopback and `codebases[].mode: 'in_place'` require `admin:settings`.

   This closes W-60.
6. **Draft protection.** `invoke` refuses definitions whose status is `draft`, unless `testRun: true` comes from a user principal. A test run uses a `test` version.
7. **Runs use the chat mount model** (RV-19). Chats already use `MountService` (`workspace_mounts`, v51): shadow git stores that never write into the user's `.git`, a readiness gate, and per-mount checkpoints. The lifecycle's `worktrees` phase is **replaced** by `MountService.plan/stage/prepare/ready` with owner `{kind:'workflow_run', runId}`. It is not ported from `setupProjectWorktrees`/`WorktreeService.createRunWorktrees`. Checkpoints and Changes use the per-mount stores, the same as chat, which makes "a stage is a compact chat" hold for the Changes, checkpoint and diff surfaces too. Post-processing commit/push/PR goes through `SourceControlFlowService` on the mount. **Delete** `WorktreeService.createRunWorktrees`, `setupProjectWorktrees`, the `worktrees` rows for runs, and `ChangeSetService` v1 if the run page was its last user.

---

## WP-4.1 Lifecycle into the engine

1. New `packages/core/src/services/engine/lifecycle/`:
   - `prepare.ts`, with the phases `workspace`, `worktrees`, `uploads`, `projectConfigs`, `preprocess` and `sandbox`;
   - `finalize.ts`, with `compensate`, `hooks`, `postProcess` and `release`.

   Each phase is a pure-ish function `(ctx) => Promise<PhaseResult>`, executed as a run-scope durable effect.
2. `decide()` gains:
   - `created → starting`, which emits `run_phase` effects in sequence;
   - `starting → running`, once all prepare phases have settled;
   - `→ finalizing {outcome}`, which runs the finalize phases, then `→ completed|failed|cancelled`, then emits `workflow_run.finalized`.

   A prepare failure fails the run with `status_reason: setup:<phase>`.
3. **Port the code:**
   - from `WorkflowOrchestrator`: workspace creation (merged with `WRS:684-748`), `setupProjectWorktrees`, `scanAndWireUploads`, `buildPostProcessingSteps`, `handleRunTerminal` (as `postProcess`);
   - from `WorkflowPreprocessor`: `execute` and `executePostProcessing`.

   Fix these defects while porting:
   - **Mounts** (design decision 7): codebases come from `request.codebases` → `lifecycle.codebaseAliases` → (only if `requiresCodebase` and nothing is selected) an error. **Never "all codebases"** (W-22). Each selected codebase becomes a run mount (`in_place` requires `admin:settings`, `worktree` is the default).
   - **`__workspaceId` bug:** the workspace id is a run column, so browser tools and artifact tracking work on every run (C-6).
   - **No `rm -rf` of worktrees on cancel or failure.** Worktrees are removed through `WorktreeService` by the retention policy only (C-7).
   - **Staged skills** live in the workspace root, not in the worktree (already done in P02). Hook attachments are written outside the worktree or added to `.git/info/exclude` (C-8).
   - **Preprocessing `run_script`:** cwd = the run workspace, and the shell is chosen per platform (`pwsh -NoProfile -Command` on Windows, `sh -c` elsewhere) (C-20).
   - **`clone_repo`:** only `https`/`ssh` schemes are allowed, plus a `--` separator (C-20).
   - **Sandbox failure** fails closed (`setup:sandbox`) unless `lifecycle.sandbox: 'optional'` (G3 comment at `WorkflowOrchestrator.ts:712`).
   - **The post-processing PR target** uses the persisted `baseRef` per codebase (C §d "restart re-arm loses baseBranches").
4. **Uploads.** There is one writer: `RunUploads.write(runId, category, file)`, which always produces `skills/<name>/SKILL.md` and `agents/<name>.md` (C-16). Uploads are staged **before** the run starts, through upload ids (WP-4.3), and are scanned in the `uploads` phase.
5. **Delete:**
   - `WorkflowOrchestrator.ts`, `WorkflowPreprocessor.ts` (moved), and `routes/orchestrator.ts`. The workspace, diff and download read routes move to `GET /workflow-runs/:id/workspace*`.
   - The `workflow_run.orchestration_*` events, replaced by `workflow_run.phase_started/phase_completed/phase_failed {phase}`.
   - `DurableSleepService` leftovers, if any.
   - The client-side `startOrchestratedRun`, `uploadRunFiles`, `useStartOrchestratedRun` and mobile `admin.orchestrator.*`.

## WP-4.2 `WorkflowInvocationService`

In `packages/core/src/services/workflow-invocation/`:
- `WorkflowInvocationService.ts` exposes `invoke(req, ctx)`, `plan(req, ctx)`, `waitFor(runId, {timeoutMs, stopOnApproval, signal})` and `digest(runId, {detail})`.
  - `waitFor` **subscribes before** its fast-path read, returns on `finalized` or on an approval (when asked), and handles timeouts (W-63).
- `validateInvocation.ts` runs:
  - zod;
  - variable typing (moved out of `createRun`);
  - `__*` rejection;
  - stage keys exist;
  - codebase aliases belong to the project;
  - `requiresCodebase`;
  - the model exists in the catalog;
  - the provider can gate the requested permission mode (P02);
  - the permission ceiling: `min(requested ?? definition, caller ceiling, deployment posture)`, ordered `plan < default < acceptEdits < bypassPermissions`;
  - lineage: depth ≤ 3, and recursion over `ancestryDefinitionIds`;
  - budget.
- `planInvocation.ts` → `InvocationPlan` (G4 §1.3.4):
  - stages with layers, skipped (by override or statically false guards) and model/agent;
  - codebases;
  - prepare and post phases;
  - permission mode;
  - lineage;
  - warnings (capability loss, sessionGroup rebinding).
- `InvocationContext` (trusted): principal, trigger, lineage, `callerPermissionCeiling`, budget.
- **Trigger union** (defined here and used by P05 and P06): `user`, `automation`, `chat`, `orchestrator`, `stage` (a sub-workflow stage or a stage tool call; carries `runId`, `stageRunId`, `toolCallId?`), `external_agent`, `fork`. It is server-derived only (G4 §1.3.3).
- Steps: idempotency claim → resolve target (a definition; a script materialized once per content hash; a fork of an ancestor run through `forkRun`) → validate → create run (typed columns) → post `start` to the supervisor → emit `workflow_run.invoked`.
- **Automations:** `AutomationService.runSingleWorkflow` calls `invoke(…, {trigger: {kind:'automation', …}})` then `waitFor(finalized)`. Delete `waitForRunCompletion`. The automation's `permissionMode` (required since P02, PD-18) is passed as the run's permission.
- The **webhook dataset path** (`IterationPlanner`) rejects `__*` fields and rejects any field not in `dataSchema` (C-3).

## WP-4.3 One route and one client method
- `apps/server/src/routes/workflowInvocations.ts`:
  - `POST /api/workflow-invocations`, JSON, or multipart with a `request` field plus files that become upload ids;
  - `POST /api/workflow-invocations/uploads` → `{uploads:[{uploadId, category, name}]}` (TTL 1 h, table `invocation_uploads`);
  - `POST /api/workflow-invocations/plan`;
  - `GET /api/workflow-invocations/:runId/digest?wait=30`.
- A single error envelope, `{error:{code, message, issues[]}}`.
- Route policy entry in `packages/auth/src/routePolicy.ts`, plus the in-handler scope checks from design decision 5.
- **Delete these routes:**
  - `POST /workflow-runs` (create);
  - `POST /workflow-runs/:id/start`;
  - `POST /workflow-runs/:id/retry` (replaced by `invoke {target:{kind:'fork'}}`);
  - `POST /workflow-scripts/:id/run`;
  - everything under `/orchestrator/runs*`.

  Read routes stay: `GET /workflow-runs`, `GET /workflow-runs/:id`, commands, instances and workspace.
- `packages/client-core/src/api/admin.ts`: `workflows.invoke(req, {idempotencyKey?, files?})`, `.plan(req)`, `.uploads(files)`, `.digest(runId, {waitSeconds})`. Delete `runs.create`, `runs.start`, `runs.retry`, `orchestrator.startRun`, `orchestrator.uploadRunFiles`, `scripts.run` and `stageOverrides.ts` (`encodeStageOverrides`).
- The web `HttpPlatformClient` workflow run methods **delegate to client-core** (G3 5.13), which removes the second hand-written client for workflows.
- **Migration v58:** `idempotency_keys.request_hash`, plus the `invocation_uploads` table. The run columns already exist from v57.

## WP-4.4 Client migration: CLI, TUI, SDK, MCP, scripts
- **CLI** `packages/cli-core/src/commands/run.ts` and `platform.ts`:
  - `run start <workflow>` → `workflows.invoke`, with the flags `--var`, `--stage-var key.k=v`, `--skip <key>`, `--stage-model key=model`, `--model`, `--effort`, `--codebase alias[@ref][:in_place]`, `--permission-mode`, `--name` (now applied), `--timeout`, `--profile`, `--skill-file/--agent-file/--prompt-file`, `--test-run` and `--idempotency-key`;
  - `--watch` uses the digest or SSE, until finalized;
  - run profiles are parsed with the canonical `RunProfileSchema` (in workflow-spec; keys, not ids; C-10), and the two other profile schemas are deleted;
  - `run retry` → `invoke {target:{kind:'fork', rerunFrom: failed}}`;
  - `script run` → `invoke {target:{kind:'script'}}`, which fixes both bugs in W-56;
  - `run plan` → `workflows.plan`.
- **TUI:** its `run.start` form inherits the new flags, and shows the plan before starting.
- **SDK:** `WorkflowFacade.run()` → invoke through the in-process service with the trigger `external_agent via sdk`. Delete `orchestrate()`; there is nothing to alias. `ScriptFacade.run` → invoke `script`. `stream()` replays the run scope, not `masterSessionId`.
- **MCP server: remote mode here** (RV-23; closes W-58 for invocation).
  - `packages/mcp-server/src/cli.ts` talks to the running server at `GENERATORAI_URL` through `@generatorai/client-core` + `client-transport`, with the trigger `external_agent via mcp`. **Delete embedded mode entirely.** MCP tests run against the testkit or the isolated E2E server.
  - **Credential (PD-22):** reuse device pairing with a new platform value `mcp`, rather than building service-account issuance. `generatorai device invite --platform mcp --scopes exec:agent,read:workflows[,write:workflows]` prints a pairing URL. `generatorai-mcp pair <url>` stores the device key in the OS keychain through the existing `secrets` package. Add the `mcp` platform to `packages/auth` platform enums and the route policy, and add revocation from the Devices settings page.
  - `generatorai_run_workflow` → `workflows.invoke`. The full tool set, resources and prompts arrive in P06.

## WP-4.5 Client migration: web, desktop, mobile (run-start parity)
- **Web:** one `useInvokeWorkflow` hook, used by the definition page, the builder (test run) and the script page. `VariableInputModal` becomes **RunDialog**, with:
  - variables;
  - a **Stages** section that is always visible (D-15): skip, stage variables, and a per-stage model;
  - **Run options:** model, effort, permission mode (default = posture, W-65), run name, "stop after N min" budget;
  - **Codebases:** checkboxes and a branch combobox, defaulting from `lifecycle.codebaseAliases`;
  - uploads (pre-uploaded, then sent as ids);
  - a **Plan preview** (from `plan`) showing layers, skipped stages, codebases, post-processing and warnings.

  A per-mount idempotency key (`crypto.randomUUID()`) guards against double clicks. Errors are shown inline.
- **Desktop:** nothing extra; it embeds the web app.
- **Mobile** `StartRunSheet.tsx`:
  - the same options, under Advanced;
  - **codebases are sent** (today it sends none);
  - uploads are pre-uploaded, then invoked (this removes the race);
  - the permission-mode picker is reused at start.

  `scripts/[id].tsx` → invoke `script`. Retry → fork.

## WP-4.6 Legacy removal checklist for this phase
Add every deleted identifier to `no-legacy.json`:
- `startOrchestratedRun`, `WorkflowOrchestrator`, `WorkflowPreprocessor`, `orchestratorConfig`, `useStartOrchestratedRun`, `encodeStageOverrides`, `__stageOverrides`;
- every `__*` variable name listed in design decision 3;
- `waitForRunCompletion`, `runs.create`, `runs.start`, `/orchestrator/runs`.

## WP-4.7 Docs
- Rewrite the run-start sections of the feature docs.
- Add `docs/workflow-overhaul/generated/INVOCATION.md`, generated from `InvocationRequest.describe()`.
- Update the CLI docs (`pnpm cli:docs`).

---

## Tests to add
- **One test per entry point** (web hook, mobile, CLI, TUI form, SDK, MCP, automation schedule, automation webhook, script, fork). Each asserts the same `InvocationPlan` **and** the same finalize behaviour for a definition with `autoCommit + autoCreatePR`: a commit and a PR (mocked SCM) regardless of the entry point. This is the C-1 regression.
- Hooks fire exactly once per phase (C-17).
- **Idempotency:**
  - the same key and the same body replay the same run;
  - the same key with a different body → 409;
  - a derived key for a tool call replay.
- **Security:**
  - `__*` is rejected in variables, stage overrides and webhook datasets;
  - the permission ceiling holds;
  - bypass off-loopback requires `admin:settings`;
  - a draft is refused unless test run.
- **Lifecycle:**
  - a crash during `worktrees`, then a resume that continues at that phase;
  - a prepare failure → `failed(setup:…)`;
  - cancel during `finalizing` → compensation runs and post-processing is skipped;
  - worktrees are never deleted on cancel.
- **`waitFor`:**
  - a terminal event that arrives between the subscribe and the read is not missed;
  - `stopOnApproval` returns early.
- **E2E phase 04:**
  - run the same project workflow from the web (Playwright), the CLI, the SDK and an automation; all four produce a PR branch in the test repo;
  - a mobile start through Expo web, if the harness is available; otherwise skip and record the skip;
  - a fork of a failed run;
  - a script run.

## Acceptance criteria
- `grep -rn "orchestrator/runs\|startOrchestratedRun\|__workingDirectory\|__stageOverrides" packages apps` returns nothing, excluding migrations.
- The G4 §1.2 inputs × clients table shows **Y** in every cell except the documented exceptions (uploads not exposed to agents).
- `workflow_run.finalized` fires exactly once per run.

## Handoff checklist
- [ ] WP-4.1 … 4.7 are done.
- [ ] No client calls a deleted route (typecheck plus a grep).
- [ ] `STATUS.md` updated.
