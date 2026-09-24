# Workflow module audit, slice C: orchestration and integrations

Branch `desktop_redesign`, read-only audit, 2026-09-24. Every claim was traced from where the config is stored to where the runtime reads it. All paths are relative to the repo root.

---

## (a) Orchestration architecture

### Two unrelated things are called "orchestrator"

| Name | What it actually is | Entry points |
|---|---|---|
| **WorkflowOrchestrator** (`packages/core/src/services/WorkflowOrchestrator.ts`) | A *lifecycle wrapper* around the DAG runner. It runs these phases: workspace → hooks → clone/worktrees → project-config wiring → preprocessing → upload scan → sandbox → `WorkflowRunService.startRun` → post-processing (autoCommit/PR). **There is no LLM orchestrator agent.** "Orchestrated mode" just means "the definition has `orchestratorConfig`, and the run was started through `POST /orchestrator/runs`". | `apps/server/src/routes/orchestrator.ts:158-225`, web `WorkflowDefinitionPage.tsx:128` (when `orchestratorConfig` or uploads exist), mobile `StartRunSheet.tsx:128,161`, SDK `WorkflowFacade.orchestrate()` `:151` |
| **OrchestratorService** (`packages/core/src/services/orchestrator/OrchestratorService.ts`) | A **chat-only** background-agent system. An orchestrator chat spawns worker *chats* through tool calls. | `ChatManagementService.ts:1994-2011` binds `buildOrchestratorToolSet` only for orchestrator chats |

**Plain DAG mode** (`POST /workflow-runs` + `/start`) uses `WorkflowRunService.createRun/startRun` (`WorkflowRunService.ts:408, 675`) directly. It is used by the CLI `run start` (`packages/cli-core/src/commands/run.ts:371-409`), by automations (`AutomationService.ts:1167,1198`), by the SDK `run()` (`WorkflowFacade.ts:140-148`), by the MCP server `generatorai_run_workflow` (`packages/mcp-server/src/server.ts:173-182`), by script runs (`routes/workflowScripts.ts:311,335`), and by retries.

Plain mode **skips** every orchestrator phase: preprocessing steps, legacy `gitRepositories` clone, run/workflow/project uploads (skills/agents/prompts), sandbox, requiresCodebase validation, **post-processing (autoCommit / autoPush / autoCreatePR / explicit post steps)**, and the orchestrator's `pre_clone`/`post_clone`/`pre_commit`/`post_commit`/`on_pr_created` hooks. What a workflow does therefore depends on which client starts it (see C-1).

When the orchestrated path is used, the orchestrator pre-seeds `__workingDirectory` and `__artifactsDirectory` (`WorkflowOrchestrator.ts:474-476`), so `startRun` skips its own workspace/worktree setup (`WorkflowRunService.ts:684`). **It never sets `__workspaceId`** (only on the run row, `:465`), and the stage runtime keys browser tools and artifact tracking on exactly that variable (C-6).

### Chat orchestrator (OrchestratorService)

* **Tools** (`packages/core/src/tools/orchestrator/index.ts:25-202`): `list_models`, `spawn_background_agent`, `check_background_agents`, `check_background_agent`, `send_to_background_agent`, `list_background_agents`, plus optional `list_available_agents` (only for agent-driven orchestrators, `ChatManagementService.ts:2001`). All are `skipPermission: true`.
* **Spawn** (`OrchestratorService.ts:383-636`): the termination arbiter runs first (`:392`). The concurrency cap counts only `spawned|running` (`:404-419`). The worker model is resolved as brief → env default → cheapest non-high tier → parent (`:1231-1246`) and validated against the model list (`:426-439`). `agentRef` is restricted to `listAssignableAgents` (team, or every non-orchestrator agent) (`:362-375, 444-457`). Warm-first waits up to 3 s for the wave leader's first output (`:463-468`). The worker chat is created with `orchestratorMode: false`, shares the parent workspace by default, and has a constant `WORKER_SYSTEM_PROMPT` appended (`:483-522`). The brief goes as the first user message, fire-and-forget (`:627-633`).
* **Termination** (`evaluateTermination` `:819-891`): time budget (30 min), wave cap (10), and convergence of the *current* wave from explicit `converged:true` digests. Budgets are per request, because `episodeEnded` resets them when the parent goes idle (`:1278-1288`).
* **Progress**: `chat.background_task.progress` is throttled to 500 ms, and tool starts are unthrottled (`:967-1011`). The parent is nudged when a wave settles (`:1075-1077, 790-807`).
* **Worker release**: the harness conversation is destroyed 90 s after idle (`scheduleWorkerRelease` `:1326-1342`). There is **no wall-clock kill**: `workerTimeoutMs` only bounds `check_*(wait)` (`:690, 705`). `budget.maxTokens/maxToolCalls` is text in the brief only (`prompts.ts:203-207`) and nothing enforces it.
* **Capability inheritance** (G15, `inheritWorkerCapabilities` `:225-265`): MCP servers, skills, custom agents, provider, harnessType, effort, maxTurns, permissionMode, browserConfig, excludedTools ∪ the parent's snapshot deny list, and an allow-list inheritance. `agentRef` is deliberately not inherited. **But** the parent's built-in denials go into `harnessConfig.excludedTools`. On Copilot, `excludedTools` does not filter built-ins (the codebase says so itself at `ChatManagementService.ts:1400-1403`), so the clamp only holds on Claude (C-15).
* **Workflow stages never get orchestrator tools.** A stage bound to an `role:'orchestrator'` agent gets `orchestration:true` from the resolver (`AgentResolver.ts:164, 413`), but `StageExecutionService` never calls `buildOrchestratorToolSet`. Its team becomes SDK sub-agents (`customAgents`, `StageExecutionService.ts:444-452`), which is the mechanism the feature doc explicitly rejected (`.github/docs/feature-orchestrator-chat.md` §1). On Codex/OpenCode/ACP, `customAgents` is dropped altogether.

---

## (b) Skills / agents / MCP / tools injection (stage path)

The stage session config is built in `StageExecutionService.executeStage` (`:1131-1259`) and passed wholesale to `SessionAllocator.createSession` → `harness.createConversation` (`SessionAllocator.ts:387-394`).

| Input | Where read | Notes |
|---|---|---|
| workflow `harnessConfig` (model, harnessType, systemMessage, mcpServers, availableTools, excludedTools, skillDirectories, disabledSkills, customAgents, provider, configDir, reasoningEffort, maxTurns) | `:1136-1152` | `contextTier`, `permissionMode`, `agentOverrides`, and `excludedMcpServerIds` only arrive through the resolver (`AgentResolver.runtimeFromHarnessConfig` `:428-439`) |
| stage `harnessConfigOverrides` | `:1155-1165` (shallow, except `mcpServers` which is deep-merged) | The builder writes `model`, `agentOverrides.addSkillIds` (`SkillSelector.tsx:57-68`), and `excludedMcpServerIds` (`McpServerSelector.tsx:45-52`) |
| `agentRef` / `agentName` (stage → workflow `harnessConfig.agentRef`) | `resolveStageAgent` `:366-477` → `AgentResolver.resolve` | Runtime scalars, skills (names + staged dirs), MCP (baseline ∪ explicit − removed), tool-group deny → `excludedBuiltinTools`, team → `customAgents`, and the driving agent's instructions wrapped in `<generatorai:agent trust="user">` (`:454-470`). **`harnessType` defaults to `'copilot'`** (`:399`) (C-4). A missing or disabled agent is only a warning (`AgentResolver.ts:275-281`, `StageExecutionService.ts:472-475`) (C-12) |
| **stage `skills: StageSkillReference[]`** | **nowhere** | No DB column (`packages/db/src/schema.ts:415-450`) and not mapped in `StageDefinitionRepository.ts:48-73,189-216`. `StageNode.tsx:101` badge reads it, so it always shows 0 (C-13) |
| **stage `browserConfig`** | **nowhere** | Same as above: no column, dropped by the repo (C-13) |
| **stage `agentMode`** | `resolveStageTurnOptions` `:3399-3405` → per-turn `agentMode` + `permissionMode` | The agent's `runtime.defaultAgentMode` is ignored in stages |
| run uploads `__skillDirectories` / `__customAgents` / `__promptDirectories` | `:1175-1190`; prompts delivered as attachments per turn (`:1957`, `workflowPromptAttachments.ts`) | Wired only on the orchestrated path (`WorkflowOrchestrator.scanAndWireUploads` `:1269-1334`). **These are ordinary run variables, so any caller can supply them** (C-3) |
| Skill staging | `agentStaging.ensureStaged(workingDirectory, …)` `:415-423` | Stages into `<workingDirectory>/.generatorai/skills`. For project runs `workingDirectory` **is the git worktree**, whereas chats stage at the workspace root (`ChatManagementService.ts:1386-1387`). Gets committed by autoCommit (C-8) |
| MCP servers | `projection.mcpServers` merged into `sessionConfig.mcpServers` `:426-431` | **Never passes through `mcpHub.resolveForRun`**, so `secretref:` credential pointers are sent to the provider literally (C-2). Chats go through the hub (`ChatManagementService.ts:1957-1972`) |
| Browser tools | `:1216-1259`, only if `variables.__workspaceId` is set and `groups.browser` | Never true on orchestrated runs (C-6) |
| **Widget tools** | **not bound** | `buildWidgetTools` is only in `ChatManagementService.ts:1903, 2413`. The run page's Widget tab (`WorkflowRunPageV2.tsx:719-731`, `WidgetHost sessionId="stageRun:<id>"`) is **still dead UI**, as the prior audit found |
| **Computer use** | **not bound** | `buildComputerToolSet` is chat-only (`ChatManagementService.ts:1874, 2383`) |
| Extension/custom tools (`customToolRegistry`) | **not bound** | Chat-only (`ChatManagementService.ts:1981-1989`). Stages cannot use tools contributed by extensions |
| Permission gate | `buildPermissionHandler` `:701-783` | Agent-group deny first, then the run's `permissionMode` from the DB (default `bypassPermissions`, `:738`). Effectiveness depends on the provider (C-5) |

**Single-session mode drops per-stage config.** `SessionAllocator.allocateSingleMode` (`:248-296`) returns the existing shared session and ignores the `config` (model, harnessType, agent binding, MCP, tools, systemMessage, **and the `onPermissionRequest` closure, which is bound to the first stage's `stageRunId` and tool groups**). `auto` resolves to `single` for every linear DAG (`WorkflowRunService.ts:813-821`), and `auto` is the default (`WorkflowDefinitionService.ts:143`). Details in C-1b.

---

## (c) Stage option × harness matrix

Evidence: `ClaudeAgentProvider.ts:1255-1440, 2533-2640`, `CopilotProvider.ts:874-1085, 1226`, `CodexProvider.ts:1137-1165, 1270-1330, 2305-2340, 2674`, `OpenCodeProvider.ts:407-560, 1250`, `AcpProvider.ts:398-460, 777`. "Warn" means a `FIELD_UNSUPPORTED_BY_PROVIDER` warning is recorded, but **no core service ever reads `getConversationWarnings`** (grep: only conformance and proxies), so every warn is silent in practice (C-11).

| Stage option → CreateConversationParams | claude-agent | copilot | codex | opencode | acp |
|---|---|---|---|---|---|
| model | ✅ | ✅ | ✅ | ✅ only when `provider/model` is qualified (else warn) | ❌ configured on the agent binary |
| harnessType routing | explicit, or inferred from model (`MultiHarness.ts:321-347`) | same | same | same | same |
| systemMessage (agent instructions, browser hint) | ✅ append/replace on the `claude_code` preset | ✅ | ✅ developer/base instructions | ⚠️ content only; `mode` lost (`:1250-1253`) | ❌ dropped; **agent instructions never reach ACP** |
| `tools` (browser tools, host tools) | ✅ in-process MCP | ✅ | ✅ `dynamicTools` (experimental) | ❌ silent | ❌ silent |
| mcpServers | ✅ | ✅ | ✅ (unsupported transports warn) | ❌ **silent, although `capabilities().mcpServers` says true** (`:417`) | ❌ (`mcpServers:false`) |
| `secretref:` resolution for MCP creds (stage path) | ❌ not resolved (C-2) | ❌ | ❌ | n/a | n/a |
| skills (names) | ⚠️ `Options.skills` names only; with `settingSources: []` nothing loads them | ✅ via skillDirectories | ✅ skill roots, **global across all conversations** (`syncSkillRoots` `:1240-1250`) | ❌ | ❌ |
| skillDirectories (staged / uploaded) | ❌ warn (`:1323-1328`) | ✅ | ✅ (global) | ❌ silent | ❌ silent |
| disabledSkills | ❌ silent | ✅ | ❌ silent | ❌ | ❌ |
| customAgents (agent team, uploaded agents) | ✅ `agents` | ✅ | ❌ silent | ❌ | ❌ |
| availableTools (allow-list) | ✅ allowedTools + tools | ✅ | ❌ silent | ❌ | ❌ |
| excludedTools | ✅ → disallowedTools | ⚠️ custom/MCP only | ❌ | ❌ | ❌ |
| excludedBuiltinTools (agent tool-group deny) | ✅ disallowedTools, **but names are computed for `copilot` unless `harnessType` is explicit** (C-4) | ⚠️ `defaultAgent.excludedTools`, advisory per `StageExecutionService.ts:695-699` | ❌ except Agent/Task → `multi_agent:false` | ❌ | ❌ |
| reasoningEffort | ✅ | ✅ | ✅ per turn | ❌ | ❌ |
| maxTurns | ✅ | ❌ warn | ❌ warn | ❌ silent | ❌ silent |
| contextTier / configDir / provider (BYOK) | ❌ warn | ✅ | ❌ silent | ❌ | ❌ |
| onPermissionRequest (agent deny + run HITL) | ⚠️ **only invoked when the per-turn mode is not bypass**; stage turns send the deployment default, which is `bypassPermissions` on loopback (C-5) | ✅ always invoked | ⚠️ only if `approvalPolicy≠never`; a per-turn bypass maps to `never` (`:2305-2308`) | ❌ none | ✅ |
| per-turn permissionMode / agentMode (plan) | ✅ | ✅ agentMode → session mode; permissionMode ignored | ✅ plan → read-only sandbox | ❌ (`planMode:false`) | ❌ |
| hooks bridge | ✅ | ✅ | ❌ (UNMODELED) | ❌ | ❌ |
| workingDirectory | ✅ | ✅ | ✅ | ✅ | ✅ |

Only **copilot** comes close to honouring everything a stage author can configure. For **claude-agent**, skills are effectively dead, and HITL and the tool-group deny depend on per-turn mode and on `harnessType` being set explicitly. **codex** ignores allow/deny lists and teams. **opencode** and **acp** ignore MCP, tools, skills, teams and permission gating (opencode) or instructions (acp). Nothing tells the author (C-11).

---

## (d) Integrations inventory

| Integration | Exists? | How wired | Gaps |
|---|---|---|---|
| Projects / codebases / worktrees | yes | Orchestrated: `WorkflowOrchestrator.ts:505-577` (selectedCodebases → falls back to all ready codebases). Plain: `WorkflowRunService.setupProjectWorktrees` `:872-918` | The plain path ignores `orchestratorConfig.codebaseAliases` (uses gitRepositories aliases or ALL codebases). Mobile never sends `selectedCodebases` (`StartRunSheet.tsx:162-167`), so all codebases get worktrees. Orchestrator cancel/failure deletes worktrees with `rm -rf` (C-7) |
| Git autoCommit / autoPush / autoCreatePR / post steps | orchestrated only | `buildPostProcessingSteps` `WorkflowOrchestrator.ts:1189-1255` → `WorkflowPreprocessor.executePostProcessing` → SourceControlFlowService | **Never runs for CLI, automations, SDK `run()`, MCP, script runs or retries** (C-1). Restart re-arm loses `baseBranches` (`:1098-1104` does not persist it), so the PR targets origin/HEAD |
| Webhooks (automation) | yes | `POST /api/automations/webhooks/:token` (`routes/automations.ts:386-450`) → `AutomationService.triggerWebhook` `:473-523` | The dataset path passes arbitrary `__*` keys through (`IterationPlanner.ts:23-29, 184-188`) (C-3). Runs default to `bypassPermissions` (C-9) |
| Webhooks (legacy `/webhooks/github`, `/webhooks/custom/:trigger`) | **dead** | `WebhookService.handleGitHub/handleCustom` → `SessionService.createSession({workflows:[…]})` | `createSession` ignores `workflows` and `startSession` only flips a status (`SessionService.ts:31-75`). **No workflow ever runs**, yet deliveries are logged "processed" and the endpoints are unauthenticated when no secret is set (`routes/webhooks.ts:38-54, 82-96`) (C-14) |
| Automations (schedule / manual / webhook) | yes | `AutomationService.runSingleWorkflow` `:1136-1260` → plain createRun/startRun | No orchestrated path (C-1). No permissionMode on automations. A schedule strips `__workingDirectory`, a webhook does not (`WorkflowRunService.ts:506-517`) |
| CLI | partial | `workflow` (list/show/create/update/delete/validate/export/import-json/from-template/clone/stage */edge */hook *), `run` (list/start/show/watch/pause/resume/cancel/delete/stage */hitl */profile */messages/diff/workspace), `orchestrator` (templates/context/cancel) | **No way to start an orchestrated run from the CLI.** `orchestrator cancel` hits the rm -rf path. Run profiles are broken (C-10) |
| Run profiles `.generatorai/run-profiles` | CLI only | `loadRunProfile` `run.ts:83-110` (unvalidated `JSON.parse` cast) | CLI `stageOverrides` use the shape `{stageId, patch}` (`run.ts:36-42, 783-788`), but the server matches `stageName`/`stageIndex` (`WorkflowRunService.ts:1862-1882`), so overrides are silently no-ops. The shared `RunProfileSchema` (`WorkflowDefinitionSchemas.ts:402-419`: sessionMode, selectedCodebases, prompt/skill/agentFiles, browserConfig) is read by nothing. `profile generate` writes `permissionMode:'default'` |
| SDK | yes | `WorkflowFacade.run()` (plain) / `orchestrate()` (orchestrated, `as never` cast `:159`) | `stream()` on a terminal run replays `masterSessionId` events, but nothing ever emits on a master session id (only created at `WorkflowRunService.ts:477`), so the replay is empty |
| Mobile | yes | `StartRunSheet.tsx` (orchestrated vs plain like web), approvals, `PermissionModeSheet` | Uploads are sent *after* the orchestrated start (`:170-180`) through `POST /orchestrator/runs/:id/uploads`. They race Phase 0/3 and are written as loose `skills/x.md` (C-16). The permission-mode sheet has no effect on Claude/Codex stages (C-5) |
| MCP server (GeneratorAI as an MCP server) | yes, standalone | `packages/mcp-server/src/server.ts:90-182` | Uses the plain path (no autoCommit) |
| Chat → workflow | **missing** | No chat tool starts or monitors a workflow | An agent in chat cannot kick off or await a workflow |
| Notifications / push | partial | `notificationPolicy.ts:135-280`: `stage_run.awaiting_input`, `workflow_run.failed/completed` | Orchestration failures emit only `workflow_run.orchestration_failed` (`WorkflowOrchestrator.ts:754-763`), so no push. Post-processing (PR) failure is not notified. Stage tool approvals have no lock-screen actions (chat permissions do) |
| Stage artifacts | yes | `persistStageArtifacts` `StageExecutionService.ts:899-1028` (md responses to `artifacts/`, fenced files to the workspace) | `trackArtifact` needs `__workspaceId`, so orchestrated runs record no workspace artifacts (C-6). `hook-attachments/` and fenced-block files land in the worktree and get committed |
| Sub-workflows (`iterationConfig`) | **dead** | Persisted (`StageDefinitionRepository.ts:70`) and never executed (grep: only `WorkflowDefinitionService.ts:270`) | — |
| Hooks | yes | Orchestrator plus WorkflowRunService | Orchestrated runs fire `on_run_start`/`on_run_complete`/`on_run_failed`/`on_run_cancelled` **twice** (C-17) |

---

## (e) Security analysis

1. **Unattended permission default.** A run's `permissionMode` is NULL, which reads as `bypassPermissions` (`StageExecutionService.ts:738`, `WorkflowRunService.ts:1249,1263`). The G14 posture that makes *chats* default to `acceptEdits` off-loopback (`composition/security.ts:382-388`) does **not** apply to workflow runs, and automations have no permission field at all. A webhook-triggered run on a LAN, relay or production deployment therefore runs agents with full shell and file access (C-9).
2. **Prompt injection surfaces.**
   * Webhook payload fields become variables and are interpolated verbatim into stage prompts (`interpolateVariables`, `shared/utils/pure.ts:107-124`; `StageExecutionService.ts:1854-1856`), with no delimiting and no trust label.
   * Predecessor output goes to the next stage as a *user* message (`:1672-1737`). `contextFilter:'full'` injects the raw output. Agent instructions are fenced as `trust="user"` (`:463-468`), but stage-to-stage context is not fenced at all.
   * Worker digests flow to the orchestrator as tool results, and the orchestrator can then `send_to_background_agent` (skipPermission).
   * Result-validation feedback, hook context messages and replay recaps are more unfenced user turns.
3. **Reserved-variable injection** (`__promptDirectories`, `__skillDirectories`, `__customAgents`, `__workingDirectory`/`__artifactsDirectory`, `__stageOverrides`, `__projectId`). Any API caller can set these, and so can a webhook sender through the dataset path. The consequences: arbitrary host directories attached to the model prompt; the agent's cwd moved anywhere with workspace isolation skipped (`WorkflowRunService.ts:684`); agent definitions injected (C-3).
4. **Secrets in variables.** There is no `secret` variable type (`WorkflowDefinition.ts:20-28`). Values are stored plaintext in `workflow_runs.variables`, interpolated into prompts (sent to the provider), written to the RunLogger JSONL, exported as `GEN_VAR_*` env to preprocessing scripts (`WorkflowPreprocessor.ts:93-105`), passed to hooks, and copied into retries.
5. **MCP credentials.** Stages bypass the hub, so tokens are not resolved (a functional break, C-2). The chat path resolves them correctly.
6. **`.workflow.mjs` scripts.** In-process `import()` with full privileges, gated by an operator opt-in (`WorkflowScriptLoader.ts:102-139, 397-428`), with filename and containment checks. Acceptable as long as the opt-in stays off by default. Preprocessing `run_script` defaults its cwd to the **server's `process.cwd()`** (`WorkflowPreprocessor.ts:664`), not the run workspace, and uses `sh -c` (absent on stock Windows).
7. **Clone URL from variables** (`repositoryFromInputs` `WorkflowPreprocessor.ts:788-804` → `git clone --depth 1 [--branch b] <url> <dir>` `GitClient.ts:329-331`). There is no scheme validation and no `--` separator. Low exploitability as written, but it is cheap hardening.
8. **Worker clamp only on Claude** (C-15). Also, a missing or disabled agent widens a stage to platform defaults (C-12).

---

## (f) Issues

### C-1 — P1 — A workflow's git/SCM, preprocessing and uploads depend on which client started it
**Evidence:** plain entry points: CLI `run.ts:371-409`, automations `AutomationService.ts:1167-1198`, SDK `WorkflowFacade.ts:140-148`, MCP `server.ts:177`, scripts `workflowScripts.ts:311-335`, retry `WorkflowRunService.ts:626`. Post-processing exists only in `WorkflowOrchestrator.handleRunTerminal` `:903-982`. Web goes orchestrated only when `orchestratorConfig` or uploads exist (`WorkflowDefinitionPage.tsx:128`).
**Scenario:** a nightly automation (or `generatorai run start fix-bugs`) of a project workflow with `autoCommit + autoCreatePR`. The agent edits the worktree, the run reports "completed", and **no commit, push or PR ever happens**. The same workflow run from the web opens a PR. Preprocessing `run_script`/`validate_input` steps and project skill/agent configs are skipped too. A retry of an orchestrated run also loses all of it.
**Fix:** move the orchestrator phases into `WorkflowRunService.startRun`/`completeRun` (one lifecycle), or make every entry point (automation, CLI, SDK.run, MCP, retry) call `startOrchestratedRun` whenever `orchestratorConfig` exists. Add a regression test: automation run → post steps executed.

### C-1b — P1 — Default session mode silently ignores stage 2..N's agent, model, provider, tools, MCP and permission gate
**Evidence:** `auto → single` for linear DAGs (`WorkflowRunService.ts:813-821`, default `auto` at `WorkflowDefinitionService.ts:143`). `allocateSingleMode` reuses the session and ignores `config` (`SessionAllocator.ts:248-296`). The permission handler closes over the first stage's `stageRunId` and groups (`StageExecutionService.ts:1322-1327`). Contrast the comment at `StageExecutionService.ts:1138-1139` ("allows stage 1 on Claude and stage 2 on Copilot").
**Scenario:** a two-stage linear workflow. Stage 1 is "Research" bound to a read-only agent. Stage 2 is "Implement" on another model with a `fileWrite:true` agent and extra MCP servers. Stage 2 runs on stage 1's conversation: stage 1's model and provider, stage 1's instructions, and **stage 1's deny policy**. Or the reverse: a read-only reviewer stage inherits a write-capable session. A HITL tool approval raised during stage 2 is filed against stage 1's (completed) stage run.
**Fix:** in `single` mode, compare a binding key (harnessType, model, agentRef/version, tool policy, MCP set) per stage and allocate a fresh session when it differs, or resolve `auto` to `per-stage` when stages differ in binding. Pass the per-stage permission handler through a mutable per-conversation slot rather than a creation-time closure.

### C-2 — P1 — MCP credentials are never resolved for workflow stages
**Evidence:** the catalog carries `secretref:` pointers (`ArtifactCatalog.ts:16-18`, `mcpWire.ts:4`), and only `mcpHub.resolveForRun` swaps them (`IMcpHub.ts:80-99`). Its only callers are chat (`ChatManagementService.ts:1962, 2340`). Stage: `StageExecutionService.ts:426-431` (projection servers go straight to the harness).
**Scenario:** a stage uses the GitHub or Jira MCP server configured with a token in Settings. The provider launches it with header or env `secretref:mcp/...`, authentication fails, and the model improvises without the tool. The same server works in chat. Disabled-in-hub servers are not stripped either.
**Fix:** run `mcpHub.resolveForRun({workflowDefinitionId, workflowRunId, declared})` on `sessionConfig.mcpServers` before `allocateSession`, and surface `dropped` as a `harness.session_info` event.

### C-3 — P1 (security) — Reserved `__*` run variables are caller-controllable, including from webhooks
**Evidence:** they are read at `StageExecutionService.ts:1168-1190, 1957`, and `WorkflowRunService.startRun` skips workspace provisioning when `__workingDirectory` and `__artifactsDirectory` are present (`:684`). `createRun` copies caller variables wholesale (`:478`). Only `schedule` triggers strip the directory keys (`:506-517`). The webhook dataset path keeps extra fields matching `/^[A-Za-z_]\w*$/`, including `__x` (`IterationPlanner.ts:23-29, 184-188`). The legacy webhook path blocks `__` (`AutomationService.ts:506`), which is inconsistent.
**Scenario:** someone holding a webhook token for an automation with a `dataSchema` posts `[{"topic":"x","__promptDirectories":["C:/Users/me/.ssh"],"__workingDirectory":"C:/Users/me","__artifactsDirectory":"C:/tmp"}]`. Every private key file is attached to the stage prompt and sent to the model provider, and the agent runs in the home directory with `bypassPermissions`.
**Fix:** strip every `__`-prefixed key from externally supplied variables in `createRun`, `triggerWebhook`, `IterationPlanner` and `startOrchestratedRun`, keeping an explicit allow-list (`__stageOverrides` from trusted clients only). Store system variables in a separate column instead of the user bag. Validate `__promptDirectories`/`__skillDirectories` against the run's uploads dir.

### C-4 — P1 — Agent tool-group denials use the wrong provider's tool names when the stage picks its provider by model
**Evidence:** `harnessType: sessionConfig['harnessType'] ?? 'copilot'` (`StageExecutionService.ts:399`). The deny expansion is per `harnessType` (`AgentResolver.ts:180-186`). The builder sets only `model` per stage (`StagePropertiesPanel.tsx:209-228`, no `harnessType` anywhere in the workflow UI), and `MultiHarness` routes by model (`MultiHarness.ts:332-339`). The same default exists in chat (`ChatManagementService.ts:1371`).
**Scenario:** a stage with model `claude-sonnet-*` bound to an agent with `tools.fileWrite:false, shell:false`. The resolver emits Copilot names (`create`, `powershell`, …) into `disallowedTools`, so Claude's `Write`/`Bash` stay enabled. On loopback the per-turn mode is bypass, so `canUseTool` never runs (C-5), and the "read-only" agent writes files and runs shell.
**Fix:** resolve the effective provider *before* agent resolution (for example `harness.resolveProviderForModel(model)`), or expand deny lists for all providers (names are harmless when absent, per the file's own comment at `AgentResolver.ts:71-74`).

### C-5 — P1 — The run's HITL `permissionMode` is not enforced on claude-agent or codex stages under the default posture
**Evidence:** every stage turn sends `permissionMode = resolveTurnPermissionMode(auto) = defaultChatPermissionMode` (`StageExecutionService.ts:3399-3405`, `agentModePolicy.ts:98-107`), which is `bypassPermissions` on loopback (`composition/security.ts:382-387`). On Claude the per-turn mode wins over the HITL coercion (`ClaudeAgentProvider.ts:2542-2548`), so in bypass `canUseTool` (which hosts the domain handler) is not consulted. Codex maps a per-turn bypass to `approvalPolicy:'never'` (`CodexProvider.ts:2305-2308`), so its `onPermissionRequest` (`:2674`) never fires. Copilot always calls the handler (`CopilotProvider.ts:1226`).
**Scenario:** an operator runs `generatorai run hitl mode <run> default` (or uses mobile `PermissionModeSheet`) to gate a risky run. Copilot stages park in `awaiting_input` as expected. Claude/Codex stages execute every tool unprompted. Off-loopback, the per-turn mode is `acceptEdits`, so Claude auto-approves edits even when the run says `default`/`plan`. (Needs one live confirmation of Claude CLI behaviour with `bypassPermissions` and `allowDangerouslySkipPermissions:false`: either tools run ungated, or the turn errors. Both are wrong.)
**Fix:** derive the stage's per-turn `permissionMode` from `run.permissionMode` (and `stageDef.agentMode`), not from the chat default. Re-read it per turn so mid-run changes apply. Check `capabilities().fullToolGating` and refuse `default`/`plan` runs on providers that cannot gate (opencode).

### C-6 — P2 — Orchestrated runs never get browser tools or workspace artifact tracking
**Evidence:** the orchestrator sets `__workingDirectory`, `__workflowRunId` and `__artifactsDirectory` but not `__workspaceId` (`WorkflowOrchestrator.ts:465, 474-476`). The stage requires it for browser tools (`StageExecutionService.ts:1216-1219`) and for `trackArtifact` (`:2231, 2888`). The orchestrator's `createWorkspace` also omits `definition.browserConfig` and `definition.useWorktree` (`:452-460` vs `WorkflowRunService.ts:696-707`).
**Scenario:** a web-launched workflow with `orchestratorConfig` (every template import) has a stage "test the page in the browser". No browser tools are bound and the agent falls back to shell or its own Chromium. The same definition started from the CLI gets the tools.
**Fix:** `setSystemVariable(context, '__workspaceId', workspace.id)`, and pass `browserConfig`/`useWorktree` through. Better: collapse the lifecycles (C-1).

### C-7 — P2 — Orchestrator cancel and failure `rm -rf` project worktrees
**Evidence:** `clonedRepositories` is populated with worktree paths (`WorkflowOrchestrator.ts:552-560`). `cancelOrchestratedRun` (`:412-417`) and the orchestration-failure catch (`:776-778`) call `preprocessor.cleanup` → `GitClient.cleanup` = `fs.rm(recursive, force)` (`GitClient.ts:654-661`). This contradicts `:984-985` ("We do NOT cleanup per-run clones").
**Scenario:** `generatorai orchestrator cancel <run>` (flagged destructive, but documented as cancel), or a failing preprocessing step. The run's worktree, including partial work, is deleted without `git worktree remove`, which leaves dangling `.git/worktrees/*` metadata, the branch, and `workspace_worktrees` rows for the reaper to trip over.
**Fix:** only delete legacy clones (track worktrees separately), use `WorktreeService` removal for worktrees, and never delete on cancel.

### C-8 — P2 — Agent skills staged inside the user's worktree get committed by autoCommit
**Evidence:** `ensureStaged(workingDirectory, …)` (`StageExecutionService.ts:415-416`) → `<workingDirectory>/.generatorai/skills/<name>/SKILL.md` + `manifest.json` (`AgentStagingService.ts:34-36, 99, 117`), whose own design says "never inside a worktree". For project runs `workingDirectory` = the worktree (`WorkflowOrchestrator.ts:567`, `WorkflowRunService.ts:908`). The commit uses `git add -A` (`GitClient.ts:424, 1625`). Hook attachments (`StageExecutionService.ts:1297-1305`) land in the same place.
**Scenario:** a project workflow with a skill-bearing agent and autoCreatePR opens a PR containing `.generatorai/skills/**` and `hook-attachments/**`.
**Fix:** stage at the workspace root (`workspaceManager.findWorkspaceByOwner(runId).rootPath`) as chat does, and write hook attachments outside the worktree or add them to `info/exclude`.

### C-9 — P1 (security) — Unattended workflow runs default to `bypassPermissions` regardless of deployment posture
**Evidence:** `StageExecutionService.ts:734-745` and `WorkflowRunService.ts:1249,1263` (NULL means bypass). Automations have no permission field (`AutomationService.ts:1167-1175`). Chats get `acceptEdits` off-loopback (`composition/security.ts:382-388`).
**Scenario:** a relay/LAN deployment exposes an automation webhook. The payload text reaches the prompt verbatim (injection), and the agent has unrestricted shell with no approval gate.
**Fix:** default `run.permissionMode` to `getDefaultChatPermissionMode()`. Add `permissionMode` to automations and require an explicit opt-in for bypass on webhook-triggered automations. Wrap interpolated external variables in an untrusted-data fence.

### C-10 — P2 — CLI run profiles: stage overrides are silently no-ops and most profile fields are dead
**Evidence:** CLI type `{stageId, patch}` (`run.ts:36-42`), validated against stage ids (`:783-788`), injected raw into `__stageOverrides` (`:366-368`). The server matches `stageName`/`stageIndex` (`WorkflowRunService.ts:1862-1882`). The shared `RunProfileSchema` (`WorkflowDefinitionSchemas.ts:402-419`) has no runtime reader. Override `agentName`/`contextFilter`/`timeoutMs` are accepted by the route and schema (`orchestrator.ts:194`, `WorkflowDefinitionSchemas.ts:385-398`) but only `skip`/`variables` are applied (`WorkflowRunService.ts:1503-1510`).
**Scenario:** `run profile validate` says "Profile is valid" and `run start --profile quick-surface` still runs every stage the profile meant to skip.
**Fix:** make the CLI emit and validate the server shape through `StageRunOverrideSchema`, parse profiles with `RunProfileSchema`, and implement or remove `agentName`/`contextFilter`/`timeoutMs`.

### C-11 — P2 — Provider capability loss is invisible to workflow authors
**Evidence:** no core caller of `getConversationWarnings` (grep). `SessionAllocator` discards the result (`:387-394`). The only signal is a startup log (`HarnessRegistry.ts:659-675`). OpenCode claims `mcpServers:true` but never sends them (`OpenCodeProvider.ts:417` vs `createConversation` `:490-560`).
**Scenario:** a stage routed to opencode/acp/codex silently loses its MCP servers, skills, agent team, or permission gate, and the run "succeeds" with degraded behaviour.
**Fix:** after `createConversation`, read the warnings and emit `harness.session_info` on the stage stream. Validate stage options against `capabilitiesFor()` at save time (builder) and at start. Fix OpenCode's capability flag.

### C-12 — P2 — A missing or disabled agent silently widens a stage to platform defaults
**Evidence:** `AgentResolver.ts:273-283` returns `null` + warning, and the fold falls to `DEFAULT_AGENT_TOOL_POLICY` (`:405`). The stage only `console.warn`s (`StageExecutionService.ts:472-475`), although `:375-380` states "silently running a stage without its agent's … tool policy is worse than not running it".
**Scenario:** someone disables the restrictive "reviewer" agent. Every stage bound to it now runs with file-write and shell enabled.
**Fix:** fail the stage (or at least block with HITL) on `AGENT_NOT_FOUND`/`AGENT_DISABLED` when `agentRef` is set.

### C-13 — P3 — Dead stage fields: `skills`, `browserConfig`, `iterationConfig`
**Evidence:** no columns (`schema.ts:415-450`), not persisted or mapped (`StageDefinitionRepository.ts`). Scripts pass `skills` (`workflowScripts.ts:157, 290`). The `StageNode.tsx:101` badge reads `stage.skills`. `iterationConfig` is persisted but never executed.
**Fix:** delete the fields from `StageDefinition`/`CreateStageParams`, or add columns and wiring. Point the badge at `harnessConfigOverrides.agentOverrides.addSkillIds`.

### C-14 — P2 — The legacy webhook endpoints accept and "process" deliveries but never run anything
**Evidence:** `WebhookService.ts:73-102, 136-157` → `SessionService.createSession/startSession` (`SessionService.ts:31-75`), which ignore `workflows`. Unauthenticated when no secret is set (`routes/webhooks.ts:38-54, 82-96`).
**Scenario:** an existing GitHub webhook registration logs "Webhook processed" and nothing happens. It is also an unauthenticated DB-write endpoint (delivery log, sessions).
**Fix:** remove the routes, or return 410 Gone, or forward them to automations.

### C-15 — P2 — The worker capability clamp (G15) does not hold on Copilot
**Evidence:** the parent's built-in deny list goes into `harnessConfig.excludedTools` (`OrchestratorService.ts:229-249`). On Copilot `excludedTools` filters only custom/MCP tools (`ChatManagementService.ts:1400-1403`). The worker's own projection only adds the worker agent's denials to `excludedBuiltinTools` (`:1404-1411`). Chat workers on bypass have no permission handler.
**Scenario:** a locked-down orchestrator (fileWrite:false) on Copilot spawns a worker, and the worker writes files.
**Fix:** inherit into `excludedBuiltinTools` and fold the parent's denials into the resolver as `extraDeny` for the worker.

### C-16 — P2 — Uploads: several routes, several layouts, some never wired
**Evidence:** `POST /orchestrator/runs` writes skills as `skills/<name>/SKILL.md` (`orchestrator.ts:204-213`). `POST /workflows/:id/uploads` and `POST /runs/:id/uploads` write loose `skills/<file>` (`:296-311, 474-489`), which providers do not discover. Run uploads after start miss the one-shot `scanAndWireUploads` (Phase 3, `WorkflowOrchestrator.ts:669-673`). If they land before Phase 0 they go to the abandoned legacy dir (`getRunUploadsDir` `:141-154`). Mobile uploads after start and its comment claims a lazy scan (`StartRunSheet.tsx:170-180`). `copyWorkflowUploadsToRun` cannot link directories and silently skips them (`:213-251`).
**Fix:** one upload writer (always `<name>/SKILL.md`). Mobile should use the multipart start like web. Rescan uploads per stage or reject post-start uploads.

### C-17 — P2 — Orchestrated runs fire run-level hooks twice
**Evidence:** `on_run_start` at `WorkflowOrchestrator.ts:485` and `WorkflowRunService.ts:780-785`. `on_run_complete`/`failed`/`cancelled` at `WorkflowOrchestrator.ts:1003-1009` and `WorkflowRunService.ts:1753, 1570, 1576, 1226`.
**Scenario:** an HTTP hook posts "run started/finished" to Slack twice, and a script hook that provisions resources runs twice (once before clone, once after).
**Fix:** let one owner fire each phase. Keep the orchestrator-only phases in the orchestrator and remove the duplicates there.

### C-18 — P3 — Stages lack chat-parity tools: widgets (Widget tab dead), computer use, extension tools, chat→workflow
**Evidence:** chat-only bindings (`ChatManagementService.ts:1874, 1903, 1981-1989`). The run page Widget tab is `WorkflowRunPageV2.tsx:719-731`. No workflow-start tool exists for chats.
**Fix:** factor a shared "platform tool binder" used by both chat and stage (browser/computer/widgets/custom tools/orchestration, gated by `toolPolicy.groups`), or hide the Widget tab. Add a `run_workflow`/`check_workflow_run` tool pair for chats.

### C-19 — P3 — Orchestrator doc and config drift
`GENERATORAI_ORCH_WORKER_TIMEOUT_MS` is documented as "per-worker wall clock before it is failed" (`feature-orchestrator-chat.md` §12), but it only bounds `check(wait)` (`OrchestratorService.ts:690, 705`). `budget` is advisory. `AppConfig.workflow.stageTimeoutMs`/`heartbeatIntervalMs` are never wired (`setDefaultStageTimeoutMs`/`setHeartbeatIntervalMs` have no callers). Codex skill roots are process-global (`CodexProvider.ts:1240-1250`), so one stage's skills leak into every Codex conversation. On Claude, skills are passed by name only with `settingSources: []`, so staged skills never load. **Fix:** document or enforce; wire the config; scope Codex skill roots per thread; give Claude a real skill source (plugins, or `.claude/skills` under the workspace root with the `project` setting source).

### C-20 — P3 — Hardening
Preprocessing `run_script` defaults its cwd to the server's `process.cwd()` and uses `sh -c` (`WorkflowPreprocessor.ts:564, 660-664`), so it breaks on Windows without Git Bash. Clone args have no `--` or scheme check (`GitClient.ts:329-331`). There is no secret variable type (§e.4). Predecessor/stage-output context is not fenced as untrusted (§e.2). **Fix:** default the cwd to `runWorkspaceDir` and pick the shell per platform; `git clone … -- <url> <dir>` and allow only https/ssh; add `type:'secret'` stored in the vault and redacted from logs and env; wrap injected context in `<generatorai:stage-output trust="untrusted">`.
