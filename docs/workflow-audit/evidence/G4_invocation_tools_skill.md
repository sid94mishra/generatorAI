# G4 — One invocation path, workflow tools for chat/orchestrator/stages, and a workflow-authoring skill

Branch `desktop_redesign`, read-only analysis, 2026-09-24. Builds on `docs/workflow-audit/evidence/C_orchestration_integrations.md` (C-1, C-3, C-5, C-9, C-10, C-16, C-17, C-18 are referenced, not re-proven). All paths are repo-relative. Line numbers were re-read on this branch.

---

## 1. One invocation path across all clients

### 1.1 Current state: every way a run is created or started

There are **two server lifecycles** and **six HTTP/in-process entry shapes**. Only `WorkflowOrchestrator.startOrchestratedRun` (`packages/core/src/services/WorkflowOrchestrator.ts:308-388`) runs the full envelope (preprocess, clone/worktrees with `codebaseAliases`, upload wiring, sandbox, post-processing autoCommit/push/PR, orchestrator hooks). Everything else goes through `WorkflowRunService.createRun` (`WorkflowRunService.ts:408`) + `startRun` (`:675`), which provisions a workspace/worktrees itself (`:684-752`) and skips the rest (C-1).

| # | Client / trigger | Call chain (file:line) | Server lifecycle |
|---|---|---|---|
| 1 | Web definition page | `WorkflowDefinitionPage.tsx:118-176` `executeRun` → orchestrated **iff** `definition.orchestratorConfig` (`:81`) **or uploads present** (`:128`) → `useStartOrchestratedRun` (`hooks/workflowQueries.ts:470-487`) → `HttpPlatformClient.startOrchestratedRun` (`platform/HttpPlatformClient.ts:1321-1343`, multipart when uploads) → `POST /api/orchestrator/runs` (`routes/orchestrator.ts:158-225`). Else `createRun.mutateAsync` → `startRun.mutateAsync` (`:164-166`) → `HttpPlatformClient.createRun/startRun` (`:1093, :1113`) → `POST /workflow-runs` (`routes/workflowRuns.ts:36`) + `POST /:id/start` (`:122-140`) | orchestrated or plain |
| 2 | Web builder page | `WorkflowBuilderPage.tsx:479-537`. **Different predicate**: orchestrated iff `store.projectId \|\| store.gitRepositories.length>0` (`:490`), ignoring `orchestratorConfig`. Plain path uploads **after** `createRun` via `uploadRunFiles` then `startRun` (`:520-524`) — the exact legacy sequence the definition page's comment (`WorkflowDefinitionPage.tsx:123-127`) says writes to an abandoned folder | orchestrated or plain; same definition can take a different path than from the definition page |
| 3 | Desktop (Electron) | Embeds the web app same-origin; no run IPC of its own (grep of `apps/desktop/src` for run routes: none). Jump-list `generatorai://workflows/new` only (`apps/desktop/src/main/index.ts:421-428`) | = web |
| 4 | Mobile workflow | `apps/mobile/src/components/work/StartRunSheet.tsx:159-206`. Orchestrated iff `orchestratorConfig` (`:128`) → `admin.orchestrator.startRun` (`packages/client-core/src/api/admin.ts:828-829`), **no `selectedCodebases`** (`:163-168`), uploads sent **after** start through `/orchestrator/runs/:id/uploads` (`:170-181`, C-16). Else `admin.runs.create` + fire-and-forget `admin.runs.start` (`:187-206`); upload UI only rendered when orchestrated (`:393`) | orchestrated or plain |
| 5 | Mobile script | `apps/mobile/app/scripts/[id].tsx:107-116` → `admin.scripts.run` (`admin.ts:812-813`) → `POST /workflow-scripts/:id/run` | plain |
| 6 | CLI `run start` | `packages/cli-core/src/commands/run.ts:288-420`: profile (`loadRunProfile` `:83`, unvalidated) + `--var` → `__stageOverrides` injected raw in CLI shape `{stageId, patch}` (`:369-372`, C-10) → `ctx.api.runs.create` (`:374`) → **follow-up** `permissionMode.set` PATCH (`:385-398`, because `CreateWorkflowRunSchema` strips it) → `runs.start` (`:408`). `--name` accepted and discarded (`:307-312, :401-404`) | plain only; no CLI way to start an orchestrated run |
| 7 | CLI `run retry` / `run stage retry` | `run.ts:469-500` → `admin.runs.retry` (`admin.ts:326`); `run.ts:546-560` → `runs.stage.retry` | plain (retry) / in-run |
| 8 | CLI `script run` | `commands/platform.ts:340-370`. **Two live bugs**: sends `{profile}` but the route reads `profileName` (`routes/workflowScripts.ts:203-214`), so the profile is silently ignored; reads `run.id` but the route returns `{definitionId, runId, status}` (`workflowScripts.ts:341-345`), so it prints "Started run undefined" and `--watch` watches `undefined`. Mobile already works around the shape (`scriptModel.ts:144-148`) | plain |
| 9 | TUI | `apps/cli/src/tui/App.tsx:2915` `runner.runWithForm('run.start', …)` → same `CommandSpec` as #6 | = CLI |
| 10 | SDK | `packages/sdk/src/facades/WorkflowFacade.ts:150-156` `createRun`, `:170-177` `run()` (plain), `:190-199` `orchestrate()` (`as never` cast). `ScriptFacade.ts:143-167` materialize + createRun + startRun. All **in-process**, not HTTP | plain or orchestrated |
| 11 | MCP server | `packages/mcp-server/src/server.ts:90-101, 173-182` `generatorai_run_workflow` → `ai.workflows.run()` (#10 plain). `cli.ts:28-34` boots its **own embedded core against `./generatorai.db`** by default — a different database and a second executor, not the user's running server | plain, separate process |
| 12 | Automations (manual / schedule / webhook) | `routes/automations.ts:324-450` (idempotency via `runWithIdempotency` `:92-158`) → `AutomationService.triggerManual/triggerWebhook` (`AutomationService.ts:441, 473`) → `executeAutomation` (`:565`) → `runSingleWorkflow` (`:1136-1260`): `createRun({variables:{…, __triggeredBy}})` (`:1167-1175`) → `startRun` (`:1198`) → `waitForRunCompletion` (`:1329-1370`, 2 h) | plain |
| 13 | Legacy webhooks | `routes/webhooks.ts` → `WebhookService` → `SessionService.createSession({workflows})`: never runs anything (C-14) | dead |
| 14 | Script run (HTTP) | `routes/workflowScripts.ts:193-345`: materializes a **new definition every run** (`:262`), `createRun` (`:311`), `setPermissionMode` after create (`:322-333`), `startRun` (`:336`) | plain |
| 15 | Run retry | `POST /workflow-runs/:id/retry` (`workflowRuns.ts:174-200`) → `retryRun` (`WorkflowRunService.ts:599-672`): new run with ancestor variables minus execution context, `projectId: undefined`, **permissionMode not carried** (reverts to NULL = bypass), uploads not carried, orchestrator phases lost even if the ancestor was orchestrated → `startRun` | plain |
| 16 | Stage retry | `POST /workflow-runs/:runId/stages/:stageId/retry` (`workflowRuns.ts:330-351`) — within an existing run, not a new invocation | n/a |
| 17 | Chat / chat orchestrator | **None.** No tool creates or monitors a run (grep `run_workflow\|list_workflows` in `packages/core/src`: none) | — |

**Auth scopes differ by path** (`packages/auth/src/routePolicy.ts`): `/orchestrator` writes need `write:chats + exec:agent` (`:89`); `/workflow-runs` writes need `write:workflows + exec:agent` (`:114`); `/workflow-scripts/:id/run` needs `write:workflows + exec:agent` (`:120-124`). A default paired phone (`DEFAULT_MOBILE_SCOPES`, `packages/auth/src/scopes.ts:89-102`, no `write:workflows`) can therefore start an **orchestrated** run but gets 403 on a **plain** one. That is the same act of starting a run.

### 1.2 Current state: inputs and lifecycle per entry point

Legend: Y = supported, N = not possible, P = partial or broken.

| Input / phase | Web def page | Web builder | Mobile | CLI/TUI | SDK run / orchestrate | MCP | Automation | Script | Retry |
|---|---|---|---|---|---|---|---|---|---|
| variables | Y | Y | Y | Y | Y | Y | Y (+`__*` passthrough, C-3) | Y | inherited |
| stage overrides (skip/vars) | Y, but only when the workflow has variables (the no-variables modal branch `VariableInputModal.tsx:265-281` submits `onSubmit({}, uploads)` with no overrides) | Y (same) | Y | P (wrong shape, no-op, C-10) | orchestrate only | N | N | Y (profile) | inherited in vars |
| codebases selection | from definition (`:136-143`) | store `selectedCodebases` | **N** (all codebases) | N | orchestrate only | N | N | N | N |
| base branch per codebase | N | N | N | N | N | N | N | N | N |
| uploads (skills/agents/prompts) | Y (multipart start) | P (post-create legacy dir on plain path) | P (post-start race) | N | N | N | N | N | lost |
| permissionMode at start | **N** (web removed the setting; `WorkflowRunPageV2.tsx:753-755` "always bypassPermissions") | N | mid-run sheet only | P (PATCH after create) | N | N | **N** (no field) | P (profile, PATCH after create) | **lost** |
| per-run model override | N | N | N | N | N | N | N | N | N |
| run name | N | N | N | discarded | N | N | N | N | N |
| profile | N | N | N | P (unvalidated) | N | N | N | Y | N |
| idempotency | N | N | N | N | N | N | Y (5 min, header) | N | N |
| trigger metadata | none | none | none | none | none | none | `__triggeredBy` variable only | tag `script:<id>` | `ancestorRunId` |
| preprocess / legacy clone / sandbox / upload scan | if orchestrated | if orchestrated | if orchestrated | N | orchestrate only | N | N | N | N |
| post-processing (autoCommit/push/PR) | if orchestrated | if orchestrated | if orchestrated | **N** | orchestrate only | **N** | **N** | **N** | **N** |
| run hooks | twice when orchestrated (C-17) | same | same | once | — | once | once | once | once |
| waiting for "done" | UI | UI | UI | `run watch` | `stream()` (empty replay, C-SDK) | N | `workflow_run.completed` — fires **before** orchestrator post-processing (`WorkflowOrchestrator.ts:1056-1069` handles terminal *after* that event) | — | — |

Other structural facts that shape the design:

* `CreateWorkflowRunSchema` (`packages/shared/src/config/WorkflowDefinitionSchemas.ts:283-287`) has three fields. `validate()` replaces `req.body` with the stripped parse (`apps/server/src/middleware/validate.ts:28-45`), which is why every client bolts on follow-up calls.
* `OrchestratedRunParams` (`packages/shared/src/types/WorkflowOrchestrator.ts:206-215`) has no permissionMode, model, idempotency, trigger or uploads.
* Stage overrides travel in the user variable bag as `__stageOverrides` (`WorkflowRunService.findStageOverride` `:1862-1882`); only `skip` and `variables` are applied (`:1503-1510`).
* `workflow_runs` has `permission_mode`, `parent_stage_run_id` (indexed, `packages/db/src/schema.ts:509-515, 542`) and `ancestor_run_id`, but **no trigger, invoker, idempotency key, parent run, depth or run-level overrides**. `parent_stage_run_id` is never mapped by `WorkflowRunRepository.ts` (only `StageRunRepository.ts:86,391` maps its own copy), so the column is dead.
* Reusable idempotency infrastructure exists: `idempotency_keys` table (`schema.ts:800-814`), `DrizzleIdempotencyKeyRepository` (`composition-root.ts:747`), claim-then-finalize helper (`routes/automations.ts:92-158`), sweeper (`AutomationRecoveryService`). It is route-local and has no request-hash column.
* Run-level token/cost accounting does not exist (grep for `costUsd|tokenBudget|maxTokens` in core services/shared types: only `orchestrator/prompts.ts`).

### 1.3 Proposed design

#### 1.3.1 One lifecycle first

`invoke()` must not pick between two lifecycles. Collapse them (C-1 fix): `WorkflowOrchestrator` becomes the run **lifecycle owner** for every run, and its phases are no-ops when the definition has no `orchestratorConfig`. `WorkflowRunService.startRun` stops provisioning workspaces for new runs (keep that branch only for crash recovery of pre-migration runs) and never fires run-level hooks that the orchestrator also fires (C-17). Add one terminal event, `workflow_run.finalized`, emitted after post-processing (or immediately for runs without post steps). `wait` semantics everywhere (automations, tools, CLI `--watch`, SDK) key on `finalized`, not `completed`.

#### 1.3.2 Service

```ts
// packages/core/src/services/workflow-invocation/WorkflowInvocationService.ts
export class WorkflowInvocationService {
  /** The only way a run comes into existence. */
  invoke(req: InvocationRequest, ctx: InvocationContext): Promise<InvocationResult>;
  /** Same validation + planning, no rows written. */
  plan(req: InvocationRequest, ctx: InvocationContext): Promise<InvocationPlan>;
  /** Resolves on workflow_run.finalized, on a pending approval (if stopOnApproval), or at timeout. */
  waitFor(runId: string, opts: { timeoutMs: number; stopOnApproval?: boolean; signal?: AbortSignal }): Promise<RunDigest>;
  digest(runId: string, opts?: { detail?: 'brief' | 'full' }): Promise<RunDigest>;
}

/** Trusted, server-derived. Never taken from a request body. */
export interface InvocationContext {
  principal: { kind: 'device' | 'service_account' | 'local' | 'system'; id: string; scopes: readonly Scope[] };
  trigger: InvocationTrigger;          // see schema below
  lineage?: { rootRunId: string; parentRunId?: string; parentStageRunId?: string; depth: number; ancestryDefinitionIds: string[] };
  callerPermissionCeiling?: WorkflowRunPermissionMode; // e.g. the chat's own mode
  budget?: InvocationBudget;           // remaining budget of the caller
}
```

Steps inside `invoke`, in order:

1. **Idempotency claim** (`scope = invoke:<principal.id>`, key from header, body or derived — see below). A replay returns the original `InvocationResult` with `replayed: true`. A replay with a different request hash returns 409 `IDEMPOTENCY_KEY_REUSED`.
2. **Resolve target** (definition, script → materialize once per script version instead of per run, or retry → ancestor).
3. **Validate** (zod, then semantic): variables against `VariableDefinition` (moves the check from `createRun :429-472` into a shared `validateRunVariables`), **reject any `__`-prefixed key** in `variables` and in `stageOverrides[].variables` (C-3), stage override names/indices exist, codebase aliases belong to the project, `requiresCodebase`, model exists in the harness catalog, permission mode not above the caller's ceiling or the deployment default (C-9), lineage limits (depth, recursion), budget.
4. **Create run** with first-class columns (no more `__triggeredBy`/`__stageOverrides`/`__projectId` in the user bag): `trigger`, `invocation_id`, `idempotency_key`, `parent_run_id`, `parent_stage_run_id`, `root_run_id`, `depth`, `permission_mode` (default = `getDefaultChatPermissionMode()` posture, not NULL), `run_overrides` (model, harnessType, reasoningEffort, sessionMode), `stage_overrides`, `codebase_selection`, `name`.
5. **Stage uploads into the run workspace before start** (from pre-staged upload ids, one writer, always `<name>/SKILL.md`, C-16).
6. **Hand to the lifecycle** (`WorkflowOrchestrator.prepareAndStart(run)`), asynchronously.
7. Emit `workflow_run.invoked` with the trigger, and return.

#### 1.3.3 `InvocationRequest` (zod, in `packages/shared/src/config/WorkflowInvocationSchemas.ts`)

```ts
import { z } from 'zod';
import { StageRunOverrideSchema } from './WorkflowDefinitionSchemas.js';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../types/ProviderConfig.js';

const UserVariablesSchema = z.record(z.unknown()).superRefine((vars, ctx) => {
  for (const k of Object.keys(vars)) if (k.startsWith('__'))
    ctx.addIssue({ code: 'custom', path: [k], message: 'Reserved variable names (__*) cannot be supplied by callers' });
});

export const InvocationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definition'), workflowDefinitionId: z.string().uuid(), version: z.number().int().optional() }),
  z.object({ kind: z.literal('script'), scriptId: z.string().min(1), profileName: z.string().optional() }),
  z.object({ kind: z.literal('retry'), ancestorRunId: z.string().uuid(),
             /** Re-use ancestor inputs (default) or replace them with this request's inputs. */
             inputs: z.enum(['inherit', 'replace']).default('inherit') }),
]);

export const CodebaseSelectionSchema = z.object({
  alias: z.string().min(1).max(50),
  /** Branch/ref the worktree is cut from. Omit = codebase default branch. */
  baseRef: z.string().max(200).optional(),
  /** 'worktree' (default, isolated) | 'in_place' (edits the checkout; requires admin:settings). */
  mode: z.enum(['worktree', 'in_place']).default('worktree'),
});

export const InvocationStageOverrideSchema = StageRunOverrideSchema.innerType().extend({
  variables: UserVariablesSchema.optional(),
  model: z.string().max(200).optional(),         // new: per-stage model for this run
  // agentName / contextFilter / timeoutMs: implement or drop (C-10). Proposal: implement.
}).refine((o) => o.stageName !== undefined || o.stageIndex !== undefined, 'stageName or stageIndex required');

export const RunOverridesSchema = z.object({
  model: z.string().max(200).optional(),
  harnessType: z.enum(HARNESS_PROVIDER_IDS).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']).optional(),
}).strict();

export const InvocationBudgetSchema = z.object({
  /** Wall clock for the whole run, enforced by a run watchdog (new). */
  maxDurationMs: z.number().int().min(10_000).max(24 * 3600_000).optional(),
  /** Nested invocations this run (and its descendants) may make. */
  maxChildRuns: z.number().int().min(0).max(50).optional(),
  /** Advisory until token usage is recorded on stage runs. */
  maxTokens: z.number().int().positive().optional(),
}).strict();

export const InvocationRequestSchema = z.object({
  target: InvocationTargetSchema,
  variables: UserVariablesSchema.default({}),
  projectId: z.string().uuid().optional(),
  codebases: z.array(CodebaseSelectionSchema).max(10).optional(),
  stageOverrides: z.array(InvocationStageOverrideSchema).max(100).optional(),
  overrides: RunOverridesSchema.optional(),
  /** Ids returned by POST /workflow-invocations/uploads. */
  uploads: z.array(z.object({ uploadId: z.string(), category: z.enum(['skills', 'agents', 'prompts']) })).max(60).optional(),
  profile: z.string().max(200).optional(),        // server-side RunProfile (RunProfileSchema) name
  name: z.string().max(200).optional(),
  budget: InvocationBudgetSchema.optional(),
  /** Accepted in body for clients that cannot set headers (MCP, tools). Header wins. */
  idempotencyKey: z.string().regex(/^[!-~]{1,200}$/).optional(),
  /** Client label only (web|desktop|mobile|cli|tui|sdk|mcp|http). Server decides the trigger. */
  client: z.enum(['web', 'desktop', 'mobile', 'cli', 'tui', 'sdk', 'mcp', 'http']).optional(),
  /** Skip post-processing (commit/push/PR) for this run. Needs write:workflows. */
  skipPostProcessing: z.boolean().optional(),
}).strict();

export const InvocationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), client: z.string(), principalId: z.string() }),
  z.object({ kind: z.literal('automation'), automationId: z.string(), executionId: z.string(),
             via: z.enum(['manual', 'schedule', 'webhook']), iterationIndex: z.number().int().optional() }),
  z.object({ kind: z.literal('chat'), chatId: z.string(), turnId: z.string().optional(), toolCallId: z.string().optional() }),
  z.object({ kind: z.literal('orchestrator'), chatId: z.string(), taskId: z.string().optional() }),
  z.object({ kind: z.literal('stage'), runId: z.string(), stageRunId: z.string(), toolCallId: z.string().optional() }),
  z.object({ kind: z.literal('external_agent'), via: z.enum(['mcp', 'http', 'sdk']), clientName: z.string().optional(), principalId: z.string() }),
  z.object({ kind: z.literal('retry'), ancestorRunId: z.string(), principalId: z.string() }),
]);
```

Trigger derivation (never from the body): the HTTP route maps the authenticated principal to `user` (device/local) or `external_agent` (service account, or `client:'mcp'`). Automation, chat, orchestrator, stage and retry triggers are only constructed by in-process callers.

#### 1.3.4 Response

```ts
export interface InvocationResult {
  invocationId: string;
  runId: string;
  workflowDefinitionId: string;
  status: 'created' | 'starting';
  replayed: boolean;
  trigger: InvocationTrigger;
  links: { app: string /* /workflows/:def/runs/:run */; api: string; stream: string /* /api/stream?scope=run&id= */ };
  plan: InvocationPlan;   // what will actually happen
  warnings: string[];     // e.g. provider capability loss (C-11), single-session binding loss (C-1b)
}
export interface InvocationPlan {
  stages: Array<{ index: number; name: string; layer: number; skipped: boolean; model?: string; harnessType?: string; agentRef?: string; approvalRequired: boolean }>;
  codebases: Array<{ alias: string; baseRef: string; mode: 'worktree' | 'in_place' }>;
  preprocessing: string[]; postProcessing: string[];   // e.g. ['autoCommit', 'autoPush', 'autoCreatePR']
  permissionMode: WorkflowRunPermissionMode;
  lineage: { depth: number; rootRunId?: string };
}
```

Errors are one envelope: `{ error: { code, message, issues: Array<{ code, path, message, severity }> } }`, with codes `VALIDATION_ERROR`, `IDEMPOTENCY_KEY_REUSED`, `DEPTH_LIMIT`, `RECURSION`, `BUDGET_EXHAUSTED`, `PERMISSION_ESCALATION`, `CODEBASE_REQUIRED`, `FORBIDDEN_SCOPE`.

#### 1.3.5 Idempotency

* Keys come from `Idempotency-Key` header, else `body.idempotencyKey`, else **derived** for in-process callers: chat `chat:<chatId>:<toolCallId>`, stage `stage:<stageRunId>:<toolCallId>`, automation `auto:<executionId>:<iteration>:<attempt>`. Derived keys make a replayed tool call (harness resume, provider retry) return the same run instead of starting a second one.
* Lift `runWithIdempotency` out of `routes/automations.ts:92-158` into `packages/core/src/services/IdempotencyService.ts`. Add a `request_hash` column to `idempotency_keys`. TTL: 24 h for invocations (5 min stays for webhooks).
* The claim row's `execution_id` stores the `invocationId`.

#### 1.3.6 One route, one client method

* `POST /api/workflow-invocations` — JSON `InvocationRequest` → 202 `InvocationResult`. Also accepts `multipart/form-data` with a `request` JSON field + `skills|agents|prompts` files, converted into upload ids server-side, so web keeps a single request.
* `POST /api/workflow-invocations/uploads` — multipart → `{ uploads: [{ uploadId, category, name }] }` (TTL 1 h). This is what mobile, CLI and MCP use.
* `POST /api/workflow-invocations/plan` — same body → `InvocationPlan` (dry run, no rows).
* `GET /api/workflow-invocations/:runId/digest?wait=30` — long-poll digest (for MCP/CLI clients without SSE).
* Route policy: new entry `{ prefix: '/workflow-invocations', read: ['read:workflows'], write: ['exec:agent', 'read:workflows'] }`, plus in-handler checks: `target.kind==='script'` needs `write:workflows` (it materializes a definition); `overrides.permissionMode==='bypassPermissions'` off-loopback and `codebases[].mode==='in_place'` need `admin:settings` (mirrors `routes/chats.ts:194, 307`). This makes "start a run" one scope decision instead of three. **Product decision to confirm:** it lets a default paired phone start plain runs (today it can already start orchestrated ones).
* Old routes become adapters that build an `InvocationRequest` and call the service, with a `Deprecation` header: `POST /workflow-runs` + `/:id/start` (a create-without-start maps to `invoke` with a new `startMode:'deferred'` flag, or is removed), `POST /orchestrator/runs`, `POST /workflow-scripts/:id/run`, `POST /workflow-runs/:id/retry`. Legacy `/webhooks/*` return 410 or forward to automations (C-14).

Client method in `packages/client-core/src/api/admin.ts`:

```ts
workflows: {
  invoke: (req: InvocationRequest, opts?: { idempotencyKey?: string; files?: InvocationFiles }) => Promise<InvocationResult>;
  plan: (req: InvocationRequest) => Promise<InvocationPlan>;
  uploads: (files: Array<{ category; name; data: Uint8Array; mimeType? }>) => Promise<{ uploads: UploadRef[] }>;
  digest: (runId: string, opts?: { waitSeconds?: number }) => Promise<RunDigest>;
}
```

Every client generates an idempotency key per "Start" press (`crypto.randomUUID()` kept in component state), so a double-tap or network retry does not double-start.

#### 1.3.7 Run-start options parity and UI exposure

| Option | Web (definition page, builder, desktop) | Mobile | CLI / TUI | SDK | MCP / tools |
|---|---|---|---|---|---|
| variables | existing form | existing form | `--var k=v`, profile | `variables` | `variables` |
| stage skip + stage vars | "Stages" section, **shown even when the workflow has no variables** (fix `VariableInputModal.tsx:265-281`) | Advanced → Stages (exists) | `--skip <stage>` (new), `--stage-var stage.k=v`, profile (validated with the canonical `StageRunOverrideSchema`) | `stageOverrides` | `stageOverrides` |
| per-stage model | Stages section: model picker per row | Advanced → Stages: model row | `--stage-model stage=model` | yes | yes |
| run model / effort | new "Run options" disclosure: model + effort (populated from `/models`) | Advanced → Model | `--model`, `--effort` | `overrides` | `overrides` |
| codebases + base branch | picker for linked project codebases (checkbox + branch combobox), default from `orchestratorConfig.codebaseAliases` | Advanced → Codebases (new; today it sends nothing) | `--codebase alias[@ref]` repeatable | `codebases` | `codebases` |
| permission mode | Run options: radio (Ask / Accept edits / Plan / Full auto), default = deployment posture; restores what `WorkflowRunPageV2.tsx:753` removed | existing `PermissionModeSheet` reused at start | `--permission-mode` (in the request, no follow-up PATCH) | `overrides.permissionMode` | capped by caller |
| uploads | existing drop zones → `uploads` (one path for builder and definition page) | pre-upload then invoke (no post-start race) | `--skill-file/--agent-file/--prompt-file` | `uploads` | not exposed to agents |
| profile | "Load profile" menu (server-side profiles) | profile chips | `--profile` | `profile` | `profile` |
| run name | optional name field | optional | `--name` (finally applied) | `name` | `name` |
| budget | Run options: "Stop after N min" | — | `--timeout` | `budget` | inherited/capped |

#### 1.3.8 File-level change list (section 1)

New:
* `packages/shared/src/config/WorkflowInvocationSchemas.ts` (+ export from `packages/shared/src/index.ts`), `packages/shared/src/types/WorkflowInvocation.ts`.
* `packages/core/src/services/workflow-invocation/WorkflowInvocationService.ts`, `validateInvocation.ts`, `planInvocation.ts`, `RunDigest.ts`.
* `packages/core/src/services/IdempotencyService.ts` (lifted from `routes/automations.ts:92-158`).
* `apps/server/src/routes/workflowInvocations.ts`; register in `apps/server/src/app.ts`; `apps/server/src/openapi/spec.ts` entries.
* DB migration: `workflow_runs` add `trigger` (json), `invocation_id`, `idempotency_key`, `parent_run_id`, `root_run_id`, `depth`, `run_overrides` (json), `stage_overrides` (json), `codebase_selection` (json), `system_vars` (json, for the `__*` values moved out of `variables`); map `parent_stage_run_id` in `packages/db/src/repositories/WorkflowRunRepository.ts`; `idempotency_keys.request_hash`; `invocation_uploads` table.

Changed (server/core):
* `packages/core/src/services/WorkflowOrchestrator.ts:308-388` → `prepareAndStart(run)`, used for all runs; emit `workflow_run.finalized`; fix duplicate hooks (`:485, :1003-1009`).
* `packages/core/src/services/WorkflowRunService.ts:408` (`createRun` takes the new fields; variable validation moved out), `:599-672` (`retryRun` carries permissionMode, overrides, codebases, uploads, lineage; becomes `invoke({target:{kind:'retry'}})`), `:675-752` (`startRun` no longer provisions for new runs), `:1862-1882` (`findStageOverride` reads the column; implement `agentName/contextFilter/timeoutMs/model`).
* `packages/core/src/services/AutomationService.ts:1167-1198` → `invoke(…, {trigger:{kind:'automation'…}})` + `waitFor` on `finalized`; add `permissionMode` to `CreateAutomationSchema` (`packages/shared/src/config/AutomationSchemas.ts:187`).
* `apps/server/src/routes/workflowRuns.ts:36-47, 122-140, 174-200`, `routes/orchestrator.ts:158-225`, `routes/workflowScripts.ts:193-345` → adapters.
* `apps/server/src/routes/webhooks.ts` → 410/forward.
* `packages/auth/src/routePolicy.ts` → `/workflow-invocations` entry; align `/orchestrator` and `/workflow-runs` write scopes during the deprecation window.

Changed (clients):
* `packages/client-core/src/api/admin.ts:314-326, 828-862` → `workflows.invoke/plan/uploads/digest`; mark `runs.create/start`, `orchestrator.startRun/uploadRunFiles` deprecated. Delete `stageOverrides.ts` dual encoding (`encodeStageOverrides`, `:73-82`) once all callers send `stageOverrides` directly.
* Web: `apps/web/src/pages/WorkflowDefinitionPage.tsx:118-176`, `WorkflowBuilderPage.tsx:479-537`, `hooks/workflowQueries.ts:374, 470-487` (+ create/start hooks) → `useInvokeWorkflow`; `platform/HttpPlatformClient.ts:1093-1140, 1321-1343, 1373, 2556` delegate to client-core; `components/workflow/VariableInputModal.tsx` (Run options, codebases, always-visible stages); `pages/WorkflowRunPageV2.tsx:359` retry; `pages/ScriptDetailPage.tsx:51`.
* Mobile: `apps/mobile/src/components/work/StartRunSheet.tsx:150-206, 393`; `apps/mobile/app/scripts/[id].tsx:107-116`; `src/api/useRunControl.ts` (retry); `src/auth/featureGate.ts:80-88` (new scope rule).
* CLI/TUI: `packages/cli-core/src/commands/run.ts:288-420, 469-500` (single `workflows.invoke`, profile parsed with `RunProfileSchema`, `--name/--model/--codebase/--skip`), `commands/platform.ts:340-370` (script run via invoke; fixes both bugs), `commands/platform.ts:452+` (drop "orchestrator" start confusion). TUI inherits via `run.start`.
* SDK: `packages/sdk/src/facades/WorkflowFacade.ts:150-199` (`run()` and `orchestrate()` both → `invocation.invoke`, `orchestrate` deprecated alias), `ScriptFacade.ts:143-167`.
* MCP: `packages/mcp-server/src/server.ts:90-182` (tool → invoke) and `cli.ts` (add remote mode, see 2.5).

Tests to add: one per entry point asserting the same `InvocationPlan` and post-processing for a definition with `autoCommit` (the C-1 regression), idempotent replay, `__*` rejection, permission ceiling, retry carrying permission mode.

---

## 2. Chat and orchestrator can invoke workflows

### 2.1 Current state

* Chat tool binding lives in `ChatManagementService` and is **duplicated** for the create path (`packages/core/src/services/ChatManagementService.ts:1809-2011`: browser `:1809`, computer `:1874`, widgets `:1902-1932` with the `uiHint` system append `:1924-1931`, SCM hint, MCP hub `:1957-1972`, custom tools `:1980-1989` filtered by `selectCustomTools` `:1288-1294`, orchestrator `:1994-2011`) and the resume path (`:2354-2470`). Any new tool family has to be added twice today.
* Orchestrator tools (`packages/core/src/tools/orchestrator/index.ts:25-202`): six (optionally seven) tools, all `skipPermission: true`, built by a closure over `OrchestratorService` + `parentChatId`, stable key order for prompt-cache hashing. Bound only for orchestrator chats without `parentChatId` (`ChatManagementService.ts:1994`), so workers cannot recurse (depth 1 by construction).
* Progress back to a chat: `chat.background_task.{spawned,status,progress,completed,failed}` on the parent chat scope (`packages/shared/src/types/AgentEvent.ts:193-210`), progress throttled to 500 ms, tool starts unthrottled (`OrchestratorService.ts:958-1011`), idle parent re-invoked via `nudgeParentAfterWave` → `chatManagementService.sendPrompt(parentChatId, '[system] …')` (`:785-807`).
* `ToolDefinition` (`packages/core/src/domain/ports/IAgentHarness.ts:332-357`) supports `skipPermission`, `requiredPermissions`, `owner`. With `skipPermission:false` the call goes through the conversation's permission handler, **but** on Claude/Codex under a bypass per-turn mode the handler is never consulted (C-5). Hard safety rules therefore have to live in the tool handler, not in the approval prompt.
* Tool policy groups (`packages/shared/src/types/Agent.ts:39-76`): `browser, widgets, extensionAuthoring, orchestration, fileRead, fileWrite, shell, web`. There is no group for workflows.
* Stages bind only browser tools (`StageExecutionService.ts:1216-1259`, append at `:1242-1243`). No custom, widget, computer or orchestration tools (C-18).
* HITL approve logic lives **in the route** (`routes/workflowRuns.ts:476-565`: outcome mapping, completion-review detection, follow-up injection), so an in-process tool cannot reuse it without copying.
* Waiting: `AutomationService.waitForRunCompletion` (`:1329-1370`) subscribes **after** its fast-path `getById` (a terminal event in between is missed until timeout), ignores `awaiting_input` (a run parked on approval burns the full 2 h), and returns before orchestrator post-processing.
* Sub-workflows: `iterationConfig` is persisted and never executed (C-13); `parent_stage_run_id` column unused.

### 2.2 Where the tools live

`packages/core/src/tools/workflows/index.ts`:

```ts
export interface WorkflowToolSetDeps {
  invocation: WorkflowInvocationService;
  definitions: WorkflowDefinitionService;
  approvals: WorkflowApprovalService;       // new, extracted from routes/workflowRuns.ts:476-565
  authoring?: WorkflowAuthoringService;     // validate / plan / createDraft (section 3)
  caller: WorkflowToolCaller;               // who is calling; drives lineage, ceiling, idempotency
  groups: { run: boolean; authoring: boolean };
}
export type WorkflowToolCaller =
  | { kind: 'chat'; chatId: string; sessionId: string; workspaceId?: string; permissionMode: WorkflowRunPermissionMode; orchestrator: boolean }
  | { kind: 'stage'; runId: string; stageRunId: string; lineage: Lineage; deadlineAt?: number; permissionMode: WorkflowRunPermissionMode };
export function buildWorkflowToolSet(deps: WorkflowToolSetDeps): ToolDefinition[];
```

Binding goes through a single **`PlatformToolBinder`** (`packages/core/src/tools/PlatformToolBinder.ts`) that both `ChatManagementService` (replacing the duplicated blocks at `:1809-2011` and `:2354-2470`) and `StageExecutionService` (`:1216-1259`) call. It takes the resolved `toolPolicy.groups` and returns `{ tools, systemAppend }`. The same `buildWorkflowToolSet` is adapted to MCP (2.5), so chat, orchestrator, stage and external MCP clients share one implementation and one description text.

New policy groups (`AgentToolPolicy`, `AgentToolPolicySchema` in `packages/shared/src/config/AgentSchemas.ts:23-34`, `AGENT_TOOL_GROUPS`):
* `workflows` — list / describe / run / check / cancel / respond-approval. Default **true** for top-level chats, **true** for orchestrator chats, **false** for orchestrator workers (workers must not fan out further) and **false** for stages unless the stage's agent grants it.
* `workflowAuthoring` — validate / dry-run / create draft. Default **false**, like `extensionAuthoring` (`Agent.ts:69-74`).

Tool order: append the workflow tools **after** existing tools, in fixed order, so existing chats' tool prefixes hash identically (the same constraint noted at `tools/orchestrator/index.ts:196-201`).

### 2.3 Tool specifications

| Tool | Args (JSON Schema, stable key order) | Returns | Gate |
|---|---|---|---|
| `list_workflows` | `query?`, `projectId?`, `tag?`, `limit?` (≤50) | `[{ id, name, description, variables:[{name,type,required}], stageCount, requiresCodebase, postProcessing:['autoCreatePR'…], lastRun? }]` | `skipPermission:true` (read-only) |
| `describe_workflow` | `workflowId` | variables (type, required, default, options), stages (name, agentRef, model, approvalRequired, condition, agentMode), edges, codebases required, post-processing, **risk flags** (opens a PR, writes files, bypass default), capability warnings | `skipPermission:true` |
| `run_workflow` | `workflowId`, `variables?`, `codebases?`, `stageOverrides?`, `model?`, `permissionMode?`, `workspace?` (`'isolated'` default \| `'from_chat_branch'`), `wait?` (`'none'` default \| `'until_done'` \| `'until_approval_or_done'`), `waitSeconds?` (≤ 600, capped by caller budget), `reason` (one line shown in the approval prompt and stored on the trigger) | `{ runId, status, link, replayed, plan, digest? }`; when `wait` times out, `{ status:'running', …, hint:'call check_workflow_run' }` | `skipPermission:false`; hard checks in handler (below) |
| `check_workflow_run` | `runId`, `wait?` (bool), `waitSeconds?` | `RunDigest`: status, per-stage `{name,status,summary≤600 chars, error?}`, `pendingApprovals:[{stageRunId, stageName, kind, prompt}]`, `artifacts:[path]`, `postProcessing:{commit?, branch?, prUrl?, error?}`, `link` | `skipPermission:true`; only runs in the caller's lineage or started by the same principal |
| `respond_workflow_approval` | `runId`, `stageRunId`, `outcome` (`approved`\|`changes_requested`\|`rejected`), `followUpPrompt?`, `reason` | `{ ok, outcome }` or 409 | `skipPermission:false`, and **only** for `stage_completion_review` gates on runs this caller started **and** whose invocation set `approvalDelegate:'invoker'`. Tool-permission HITL (a stage asking to run a tool) is never answerable by an agent; the tool returns `{ ok:false, error:'needs a human', link }` and the chat renders an approval card |
| `cancel_workflow_run` | `runId`, `reason` | `{ ok, status }` | `skipPermission:true` for runs the caller started; otherwise refused |
| `get_workflow_authoring_guide` | `topic?` (`overview`\|`stages`\|`edges`\|`conditions`\|`variables`\|`agents`\|`orchestration`\|`hooks`\|`examples`\|`schema`) | markdown section (generated, see 3.4) | `workflowAuthoring`, `skipPermission:true` |
| `validate_workflow` | `definition` (ImportWorkflowJson) | `{ valid, issues:[{code,severity,path,stageIndex?,edgeIndex?,message,hint}] }` | `workflowAuthoring`, `skipPermission:true` |
| `dry_run_workflow` | `definition` **or** `workflowId`, `variables?`, `stageOverrides?` | `InvocationPlan` + evaluated conditions per stage + unresolved `{{vars}}` + capability warnings | `workflowAuthoring`, `skipPermission:true` |
| `create_workflow` | `definition`, `projectId?`, `replacesWorkflowId?` | `{ workflowId, status:'draft', reviewLink }` | `workflowAuthoring`, `skipPermission:false`; always a **draft** (3.3) |

`wait_workflow_run` is folded into `check_workflow_run({wait:true})`, mirroring `check_background_agent(wait)`. That keeps the tool count (and cached prefix) smaller.

Hard checks inside `run_workflow` (independent of the harness permission path):
1. **Permission ceiling**: `effective = min(requested ?? definition default, caller.permissionMode, deploymentDefault)`, ordering `plan < default < acceptEdits < bypassPermissions`. A chat in `acceptEdits` cannot start a bypass run.
2. **Lineage limits**: depth = caller depth + 1. Chat caller depth 0 (an orchestrator worker chat counts as 1). Stage caller depth = its run's depth. Max depth 3 (`GENERATORAI_WORKFLOW_MAX_DEPTH`). Refuse with `RECURSION` if `workflowId ∈ ancestryDefinitionIds` unless the definition sets `allowRecursion: { maxDepth }`. Per-root `maxChildRuns` (default 10). Per-chat concurrent runs (default 3, counted like the orchestrator cap `OrchestratorService.ts:404-419`).
3. **Budget**: child `maxDurationMs = min(requested, caller remaining)`. A stage caller's remaining = stage `timeoutMs` minus elapsed. An orchestrator caller's remaining = its episode time budget (30 min, `OrchestratorService.evaluateTermination :819-891`). Enforce with a new run watchdog that cancels at `deadlineAt`, since runs outlive chat episodes. `maxTokens` stays advisory until stage runs record usage.
4. **Idempotency**: key `chat:<chatId>:<toolCallId>` (or `stage:<stageRunId>:<toolCallId>`); the harness tool-call id must be threaded into the handler (add an optional second `ctx` argument `{ toolCallId, turnId }` to `ToolDefinition.handler`).
5. **Scopes**: in-process tools act for the chat's creating principal. Record `createdByPrincipal` + scopes on the chat, and require `exec:agent` for `run_workflow` and `write:workflows` for `create_workflow`. A chat created from a default phone (no `write:workflows`) can run workflows but not author them.

### 2.4 How results flow back into the chat

* **Tool result**: compact JSON (runId, status, link, plan summary). Never the full transcript, in line with the digest discipline of the orchestrator.
* **Live progress**: a `ChatWorkflowRunBridge` (core) subscribes to `workflow_run.*` / `stage_run.*` for runs whose trigger is this chat and emits on the chat scope, mirroring background tasks:
  * `chat.workflow_run.linked` `{chatId, runId, workflowId, workflowName, toolCallId, link}`
  * `chat.workflow_run.progress` `{chatId, runId, status, currentStage, stagesDone, stagesTotal, lastText?}` (500 ms throttle; stage transitions unthrottled)
  * `chat.workflow_run.awaiting_approval` `{chatId, runId, stageRunId, stageName, kind, prompt}`
  * `chat.workflow_run.finalized` `{chatId, runId, status, summary, prUrl?}`
  Add the kinds to `AgentEvent.ts` and `eventClass.ts` (`'item'`). Web/mobile render an inline run card (reuse the Background Tasks panel list) with a deep link, and an approval card that calls the same approve endpoint as the run page.
* **Persistence**: add a `chat_workflow_runs` link table (chatId, runId, toolCallId, createdAt), or reuse the background-task table with `kind:'workflow_run'`, so the cards survive reload and restart.
* **Nudge**: when a chat-started run finalizes (or parks on an approval the agent may answer) and the chat is idle, send one `[system] Workflow run "<name>" finished (<status>). Call check_workflow_run for details.` prompt, using the same guard as `nudgeParentAfterWave` (`OrchestratorService.ts:790-807`: skip when streaming or suppressed).

### 2.5 External agents (MCP) get the same tools

`packages/mcp-server` should advertise `buildWorkflowToolSet` output (names prefixed `generatorai_`) through an adapter like `toolAdapter.ts`, with trigger `external_agent`. Add a **remote mode** to `cli.ts`: `GENERATORAI_URL` + a paired service-account credential through `@generatorai/client-core` + `client-transport` (the CLI's stack), so MCP clients drive the **running** server and its database instead of an embedded core on `./generatorai.db` (`cli.ts:28-34`). Keep embedded mode for tests only. Idempotency for MCP: `body.idempotencyKey` (MCP tool calls have no headers).

### 2.6 Chat-started runs and the chat's workspace

* Default `workspace:'isolated'`: the run gets its own workspace and worktrees cut from each codebase's default branch (or `codebases[].baseRef`), exactly like any other run. The chat's mounts are never shared with a concurrently running workflow, which would give two writers in one directory.
* `workspace:'from_chat_branch'`: for each chat mount that is a worktree on a branch, the run's worktree is cut from **the chat branch HEAD**. Uncommitted chat changes are first captured as a checkpoint commit through the chat's existing checkpoint mechanism, or the call is refused with `CHAT_DIRTY`. The run's results come back as its own branch, which the chat can merge or review. Record `parentWorkspaceId` on the run workspace.
* The run's `projectId` defaults to the chat's project. Its artifacts stay in the run workspace, and the digest lists their paths so the chat can open them read-only.

### 2.7 Should a stage invoke another workflow? Yes, through two doors that share `invoke`

1. **Agent-driven (dynamic)**: bind `buildWorkflowToolSet` in `StageExecutionService` through the `PlatformToolBinder` when the stage's resolved `toolPolicy.groups.workflows` is true. The trigger is `stage`, lineage is inherited, the budget is capped by the stage timeout, and the child run records `parent_run_id` + `parent_stage_run_id`. Approvals raised in the child are mirrored into the parent run's pending-approvals list (`HitlService.listPending` joined over descendants) so an operator sees one queue.
2. **Declarative (deterministic)**: revive `iterationConfig` as a real **workflow stage** (`stage.kind:'workflow'`, `subWorkflow:{definitionId, inputMapping, outputMapping, wait:true, maxIterations}`) that `DAGScheduler` executes without an LLM session by calling `invoke` and waiting on `finalized`. That is cheaper and more predictable than an LLM stage idling in a tool wait. It is also the only honest way to express loops, because `validateDAG` rejects cycles (`packages/core/src/domain/dag/DAGValidator.ts:160`).

Recommendation: ship the declarative stage first for authored composition, and gate the tool in stages behind `workflows:true` on the agent for dynamic cases. Both paths hit the same depth, recursion and budget checks.

### 2.8 File-level change list (section 2)

New: `packages/core/src/tools/workflows/index.ts`, `packages/core/src/tools/PlatformToolBinder.ts`, `packages/core/src/services/WorkflowApprovalService.ts` (extracted from `apps/server/src/routes/workflowRuns.ts:476-565`; the route calls it), `packages/core/src/services/workflow-invocation/ChatWorkflowRunBridge.ts`, `packages/core/src/services/workflow-invocation/RunWatchdog.ts`, a system hint `WORKFLOW_TOOLS_HINT` in `packages/core/src/services/chatSystemHints.ts`, and a migration for `chat_workflow_runs` plus chat `created_by_principal`.

Changed: `ChatManagementService.ts:1809-2011, 2354-2470` (binder), `StageExecutionService.ts:1216-1259` (binder), `packages/shared/src/types/Agent.ts:39-76` + `config/AgentSchemas.ts:23-34` (groups), `packages/core/src/domain/ports/IAgentHarness.ts:332-357` (handler ctx with `toolCallId`; each provider adapter passes it), `packages/shared/src/types/AgentEvent.ts` + `eventClass.ts` (new kinds), `OrchestratorService.ts` (expose the episode deadline to the binder; workers get `workflows:false`), `AutomationService.ts:1329-1370` (replaced by `invocation.waitFor`: subscribe before the fast path, handle `awaiting_input`, key on `finalized`), `DAGScheduler.ts` + `StageExecutionService` (workflow-kind stage), `packages/mcp-server/src/server.ts` + `cli.ts` (shared tool set, remote mode), web/mobile chat renderers (run card, approval card).

---

## 3. A skill that lets any agent author a GeneratorAI workflow

### 3.1 Current state

**Skills infrastructure**
* `AgentStagingService.ensureStaged` (`packages/core/src/services/AgentStagingService.ts:45-117`) copies an agent's catalog skills into `<workspaceRoot>/.generatorai/skills/<name>/SKILL.md` and adds frontmatter to plain-markdown legacy skills (`:69-74`). `ensurePlatformSkill` (`:136-147`) stages one platform-owned skill; the only caller is computer use (`ChatManagementService.ts:1225-1245`).
* Bundled "system" skills are flat markdown files: `templates/system/artifacts/skills/{code-generation,computer-use,documentation,extension-author,test-generation}.md`, listed through `SystemArtifactService` / `ArtifactCatalog.ts:116`.
* **Memory note verified.** `extension-author.md` is only a comment reference (`packages/core/src/tools/extensionAuthorTools.ts:15`). The live model gets `EXTENSION_AUTHORING_HINT` (`chatSystemHints.ts:126+`) appended through `uiHint` (`ChatManagementService.ts:1924-1931`). The `.md` reaches a model only if an agent explicitly selects that catalog skill. Even then, Claude receives skills by name with `settingSources: []` (`ClaudeAgentProvider.ts:2568, 2628-2631`) and warns on `skillDirectories` (`:1323-1328`), so staged skills are effectively dead on Claude (C-19). Conclusion: inside GeneratorAI, **knowledge must travel in tool descriptions, a short system hint and a guide tool**, not in a staged `SKILL.md`.
* External agents: the repo has Claude Code skills (`.claude/skills/*/SKILL.md`) and GitHub skills (`.github/skills/*`), nothing GeneratorAI-specific.

**Authoring surfaces**
* JSON format: `ImportWorkflowJsonSchema` (`packages/shared/src/config/WorkflowDefinitionSchemas.ts:352-377`) with `ImportStageSchema` (`:305-343`) and index-based `ImportEdgeSchema` (`:346-350`). Edge types `on_success | on_failure | on_completion | always`. Condition `{type: always|on_success|on_failure|expression, expression}` (`:50-53`), grammar in `ConditionEvaluator.ts:54-68` (comparisons, `AND/OR/NOT`, `&&/||/!`, parentheses, `variables.x.y` paths).
* HTTP: `POST /workflow-definitions/import-json` (`routes/workflowDefinitions.ts:238-249`, zod errors as a `fields` map); `POST /workflow-definitions/:id/validate` (`:206-216`) — **saved definitions only**; `GET /:id/export` (`:251-259`) returns the **WorkflowTemplate** format, not the import format.
* CLI: `workflow import-json <file|->` (`packages/cli-core/src/commands/workflow.ts:367-397`), `workflow validate <ref>` (`:306-341`, saved definitions only, surfaces structured `issues`), `workflow export`.
* MCP: 3 tools; nothing for definitions (`packages/mcp-server/src/server.ts:60-101`).
* Structured DAG issues exist and are pure: `validateDAG(stages, edges)` returns `issues[{severity, code, message, stageIds…}]` with codes `empty-graph, stage-without-prompts, self-edge, unknown-source-stage, unknown-target-stage, duplicate-edge, cycle, no-root-stages, disconnected-stages` (`packages/core/src/domain/dag/DAGValidator.ts:22-200`). It lives in `@generatorai/core`, which `cli-core` does not depend on (`packages/cli-core/package.json:21-28`).
* Templates: `templates/system/*.json` use the **WorkflowTemplate** shape (`category`, `requiresCodebase`, `preprocessingSteps`, `resultValidations`, `isLocked`), not ImportWorkflowJson. `templates/workflow-upload-template.json` still uses the pre-rename key `copilotConfig`, which zod strips silently.

**Gaps found while tracing import (new, beyond slice C)**
1. `importFromJSON` silently drops accepted fields. Definition level: `orchestratorConfig`, `browserConfig`, `defaultAgentRef`, `selectedArtifacts`, `useWorktree` are not passed to `createDefinition` (`WorkflowDefinitionService.ts:583-595`). Stage level: `agentMode`, `promptType`, `browserConfig` are not in `templateStageToCreateParams` (`packages/shared/src/config/WorkflowTemplate.ts:438-467`). An agent-authored "plan-only reviewer" stage or an `autoCreatePR` workflow imports as something else, and the import reports success.
2. Schemas are non-strict: unknown/misspelled keys are stripped, not reported.
3. DAG errors on import become one prose string after rows were created and rolled back (`WorkflowDefinitionService.ts:621-626`); the structured `issues` are discarded.
4. Export and import are not a round trip: export emits WorkflowTemplate, drops `orchestratorConfig` post-processing, `agentMode`, `browserConfig`, `defaultAgentRef`, and can emit variable types `git_url|git_urls` that `VariableDefinitionSchema` (`WorkflowDefinitionSchemas.ts:56-64`) rejects.
5. Condition expressions are never validated. Parse errors evaluate to `false` by design (`ConditionEvaluator.ts:69-85`), so a typo silently skips a stage.
6. No stateless validate endpoint, no dry run (the only dry-run is hooks, `HookExecutor.ts:256-354`), no JSON Schema export (no `zod-to-json-schema` usage; it is present only transitively in the lockfile), and zod fields carry JSDoc comments but no `.describe()`, so a generated schema would have no descriptions.
7. No draft or publish state on definitions. An imported workflow is immediately runnable by automations.
8. Three run-profile schemas: `RunProfileSchema` (`WorkflowDefinitionSchemas.ts:402-419`), `WorkflowRunProfileSchema` (`WorkflowTemplate.ts:390`), and the CLI's own type (`run.ts:36-42`).

### 3.2 Skill design: `generatorai-workflow-author`

Single source: `packages/workflow-spec/` (new package, depends only on `zod`). It holds the canonical schemas, moved or re-exported from shared, plus the pure validator. The skill bundle under `skills/generatorai-workflow-author/` is **generated** from it.

```
skills/generatorai-workflow-author/
  SKILL.md                         hand-written core, frontmatter name/description; includes generated fragments
  reference/
    schema.md                      GENERATED: every field, type, default, limits, description (from .describe())
    stages.md                      prompts, {{variables}}, contextFilter/contextSources, outputFormat/outputSchema,
                                   resultValidation, expectedOutput, approvalRequired, agentMode, agentRef, retryPolicy, timeoutMs
    edges-and-conditions.md        edge types, fan-out/fan-in, condition types, GENERATED expression grammar,
                                   "no cycles: loops = retryPolicy | resultValidation retry | workflow stage | automation loop"
    variables.md                   types, required/default, choice options, reserved __ prefix forbidden
    agents-and-models.md           agentRef, harnessConfig, GENERATED provider capability matrix (from capabilities())
    orchestration.md               orchestratorConfig: codebaseAliases, createWorktrees, preprocessing, autoCommit/autoPush/autoCreatePR
    hooks.md                       workflow + stage hooks
    pitfalls.md                    session mode 'auto' → single for linear DAGs drops per-stage config (C-1b); approval gates;
                                   what bypassPermissions means; keep prompts self-contained
  schema/
    workflow.schema.json           GENERATED from ImportWorkflowJsonSchema (strict)
    invocation.schema.json         GENERATED from InvocationRequestSchema
    validation-issue.schema.json   GENERATED
  examples/                        each file is CI-validated and round-tripped
    01-linear-plan-implement-review.json
    02-parallel-fan-out-fan-in.json
    03-failure-branch-and-retry.json
    04-conditional-by-variable.json
    05-project-worktree-autopr.json
    06-human-approval-gate.json
    07-structured-json-handoff.json   (outputFormat json + outputSchema + contextFilter structured)
  scripts/
    validate.mjs                   zero-install fallback: ajv + the bundled schema + a port of validateDAG
                                   (generated bundle of packages/workflow-spec), exit 1 with JSON issues
```

`SKILL.md` body (outline):
1. **When to use**: the user asks for a workflow, pipeline, multi-stage automation, or "make this repeatable".
2. **Process** (mandatory order): (a) inspect existing workflows and agents (`list_workflows`, `list_available_agents`, or `generatorai workflow list`, `generatorai agent list`) and reuse before inventing; (b) draft JSON against `schema/workflow.schema.json`; (c) **validate** and fix until there are zero errors; (d) **dry-run** with realistic variables and read the plan (stage layers, skipped stages, codebases, post-processing, warnings); (e) show the human a summary: stages, what each can touch, permission mode, whether it commits or opens a PR; (f) **submit as a draft** and give the review link; never publish or run it yourself unless the human asks.
3. **Hard rules**: no `__` variables; no cycles; every stage needs prompts or an `agentRef`; conditions must parse; name stages uniquely (contextSources and overrides match by name); set `sessionMode:'per-stage'` when stages differ in agent, model or tool policy; `approvalRequired` before any stage that pushes or opens a PR.
4. **Submission channel table** (below).
5. Links to the reference files, loaded on demand (progressive disclosure).

### 3.3 How each agent submits, validates, dry-runs and gets approval

| Consumer | Where the skill lives | Validate | Dry run | Submit | Human approval |
|---|---|---|---|---|---|
| GeneratorAI chat / orchestrator | Not staged as a file (dead on Claude). `WORKFLOW_AUTHORING_HINT` (≈600 chars) appended when `workflowAuthoring` is on; full text served by `get_workflow_authoring_guide(topic)`; tool descriptions carry the critical rules | `validate_workflow` | `dry_run_workflow` | `create_workflow` → draft | Tool is `skipPermission:false`, **plus** a draft that only a human principal can publish (the chat renders a review card with a link to the builder in "agent draft" mode) |
| GeneratorAI stage (agent granted `workflowAuthoring`) | same as chat | same | same | same, trigger `stage` | draft; the stage cannot publish |
| Claude Code | `generatorai skill install --target claude [--project]` copies the bundle to `.claude/skills/generatorai-workflow-author/` or `~/.claude/skills/` | MCP `generatorai_validate_workflow`, or `generatorai workflow lint file.json` (offline), or `node scripts/validate.mjs` | MCP `generatorai_dry_run_workflow` or `generatorai workflow plan file.json --var k=v` | MCP `generatorai_create_workflow`, or `generatorai workflow import-json file.json --draft` | draft + review URL printed; publish in app or `generatorai workflow publish <id>` from a user principal |
| Codex | `generatorai skill install --target codex` copies to the Codex skills directory (`$CODEX_HOME/skills/…`; confirm the path against the installed Codex version) and prints the `[mcp_servers.generatorai]` snippet for `config.toml` | same | same | same | same |
| Any MCP client | MCP **resources** `generatorai://workflow-author/SKILL.md`, `…/reference/*`, `…/schema/workflow.schema.json`, `…/examples/*`; MCP **prompt** `author_workflow` that inlines SKILL.md | `generatorai_validate_workflow` | `generatorai_dry_run_workflow` | `generatorai_create_workflow` | draft + review URL |

Server endpoints behind all of these (one implementation, `WorkflowAuthoringService` in core):
* `POST /api/workflow-definitions/validate` (stateless) — body `{ definition }` → 200 `{ valid, issues[] }`. Issue shape: `{ code, severity:'error'|'warning', path: JSON-pointer, stageIndex?, edgeIndex?, message, hint? }`. Layers: (1) strict zod (unknown keys are errors, with a "did you mean" hint, e.g. `copilotConfig → harnessConfig`); (2) edge index bounds, `validateDAG` issues mapped to indices; (3) `{{var}}` references resolve to declared variables; `contextSources` name existing stages; stage names unique; (4) condition expressions parsed with a new `parseConditionExpression()` that returns errors (the evaluator keeps its fail-safe `false`); (5) `agentRef` exists and is enabled, model exists in the catalog, per-stage provider capability conflicts (C-11) as warnings, session-mode binding loss (C-1b) as a warning; (6) "field accepted but not persisted" as an error until import is fixed.
* `POST /api/workflow-definitions/plan` — `{ definition | workflowId, variables?, stageOverrides? }` → `InvocationPlan` + per-stage `conditionResult` (evaluated against the supplied variables and assumed success of predecessors) + unresolved placeholders. No rows are written. It reuses `planInvocation` from section 1, so "what will run" is computed in one place.
* `POST /api/workflow-definitions/import-json?draft=true` (and `create_workflow`) — strict, persists **every** accepted field, returns `issues` instead of prose, creates `status:'draft'`, tags `agent-authored`, stores `authoredBy` (trigger).
* `POST /api/workflow-definitions/:id/publish` — requires `write:workflows` from a **user** principal (device/local). Agent triggers and service accounts cannot publish unless an admin enables `allowAgentPublish`. Automations, the invoke route and the tools refuse `draft` definitions, except `dry_run` and an explicit "test run" from the review UI.
* `GET /api/workflow-definitions/schema` — `{ version, hash, jsonSchema }`, so an agent holding an old skill can detect drift (the skill embeds the hash; the tools compare it and warn).
* `GET /api/workflow-definitions/:id/export?format=import-json` — round-trippable export (the current template export stays available as `format=template`).

### 3.4 Keeping the skill in sync with the schema

1. Add `.describe()` to every field of `ImportWorkflowJsonSchema`, `ImportStageSchema`, `HarnessConfigSchema`, `OrchestratorConfigSchema`, `VariableDefinitionSchema`, `StageConditionSchema`, `RetryPolicySchema`, `ResultValidationRuleSchema`, and `InvocationRequestSchema` (convert the existing JSDoc comments, which already contain the text).
2. `scripts/generate-workflow-skill.ts` (sibling of `scripts/generate-schemas.ts`, same `--check` drift convention): `zod-to-json-schema` (add as a direct dev dependency, zod 3.25) → `schema/*.json`; walk the schema to render `reference/schema.md`; render the condition grammar from a table exported by `ConditionEvaluator`; render the capability matrix from each provider's `capabilities()`; stamp `SKILL.md` frontmatter with `schemaVersion` + hash. Wire `pnpm generate:workflow-skill` and a CI `--check` job.
3. Tests (vitest, `packages/workflow-spec/__tests__`): every `examples/*.json` passes strict validation, imports into an in-memory DB, and **round-trips** (`export?format=import-json` deep-equals the input minus ids). A snapshot test fails when a zod field has no `.describe()`.
4. The in-app guide tool and the MCP resources read the **same generated files** at runtime (shipped under `templates/system/skills/generatorai-workflow-author/`), so the three channels cannot diverge.
5. `validate.mjs` is a generated bundle of `packages/workflow-spec` (esbuild), so the offline validator runs the exact server rules, not a re-implementation.

### 3.5 What is missing in the codebase today

| Needed | Status | Where to add |
|---|---|---|
| JSON Schema export of the definition | missing | `packages/workflow-spec`, `scripts/generate-workflow-skill.ts`, `GET /workflow-definitions/schema` |
| `.describe()` on zod fields | missing (JSDoc only) | `packages/shared/src/config/WorkflowDefinitionSchemas.ts`, `WorkflowTemplate.ts` |
| Stateless validate with structured issues | missing (`/:id/validate` needs a saved id; import returns prose for DAG errors) | `WorkflowAuthoringService.validate`, `routes/workflowDefinitions.ts` |
| Pure validator usable offline | `validateDAG` is pure but in core | move `DAGValidator.ts` + `ConditionEvaluator` parse into `packages/workflow-spec`; core re-exports |
| Condition parse errors | missing (fail-safe `false`) | `parseConditionExpression()` in workflow-spec |
| Dry run / plan | missing | `planInvocation` (section 1), `POST /workflow-definitions/plan` |
| Import persists every accepted field | broken (orchestratorConfig, browserConfig, defaultAgentRef, agentMode, promptType dropped) | `WorkflowDefinitionService.importFromJSON :563-627`, `templateStageToCreateParams` |
| Strict schemas | missing (keys silently stripped) | `.strict()` on the import schemas, with a legacy-key map for hints |
| Round-trip export | missing (template format, lossy) | `exportAsImportJson` |
| Draft / publish state | missing | `workflow_definitions.status`, publish route, invoke refuses drafts |
| Workflow tools for agents | missing | section 2 |
| MCP definition tools, resources, prompts, remote mode | missing (3 tools, embedded DB) | `packages/mcp-server` |
| CLI `workflow lint`, `workflow plan`, `import-json --draft`, `workflow publish`, `skill install` | missing | `packages/cli-core/src/commands/workflow.ts`, new `skill.ts` |
| A skill channel that works on Claude inside the app | missing (staged skills dead on Claude) | tool descriptions + `WORKFLOW_AUTHORING_HINT` + guide tool |
| Up-to-date sample | stale (`copilotConfig` in `templates/workflow-upload-template.json`) | regenerate from `examples/01-*.json` |

### 3.6 File-level change list (section 3)

New: `packages/workflow-spec/**` (schemas, `validateWorkflowJson`, `planWorkflow` pure parts, `parseConditionExpression`, DAG validator), `packages/core/src/services/WorkflowAuthoringService.ts`, `scripts/generate-workflow-skill.ts`, `skills/generatorai-workflow-author/**` (SKILL.md, reference, examples, generated schema, `scripts/validate.mjs`), a copy under `templates/system/skills/generatorai-workflow-author/` for runtime reads, `packages/cli-core/src/commands/skill.ts`, `packages/mcp-server/src/resources.ts` and `prompts.ts`.

Changed: `packages/shared/src/config/WorkflowDefinitionSchemas.ts` (describe, strict, re-export from workflow-spec), `packages/shared/src/config/WorkflowTemplate.ts:438-467`, `packages/core/src/services/WorkflowDefinitionService.ts:365-379, 486-561, 563-627`, `packages/core/src/domain/dag/{DAGValidator,ConditionEvaluator}.ts` (moved), `apps/server/src/routes/workflowDefinitions.ts:206-259` (validate, plan, draft import, publish, schema, export format), `packages/client-core/src/api/admin.ts` (`definitions.validateJson/plan/publish/schema`), `packages/cli-core/src/commands/workflow.ts:306-397` (lint, plan, `--draft`, publish), `packages/mcp-server/src/server.ts`, `packages/core/src/services/chatSystemHints.ts` (`WORKFLOW_AUTHORING_HINT`), web builder (agent-draft banner, publish button, diff against the previous version), `templates/workflow-upload-template.json` (regenerated), DB migration `workflow_definitions.status` + `authored_by`.

---

## Suggested order

1. Lifecycle collapse + `workflow_run.finalized` (C-1). Without it, "one invocation path" still behaves differently per definition.
2. `InvocationRequest` + service + route + client method; migrate CLI/TUI, SDK, MCP, automations, then web and mobile; old routes become adapters.
3. Import fidelity + strict schemas + stateless validate/plan (these also unblock the builder).
4. `PlatformToolBinder` + workflow tools for chat/orchestrator (read + run + check first; approvals and cancel next).
5. Draft/publish + authoring tools + MCP remote mode + generated skill bundle.
6. Declarative workflow stage, then workflow tools in stages.
