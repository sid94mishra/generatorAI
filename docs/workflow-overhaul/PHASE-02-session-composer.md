# PHASE 02: SessionComposer (a stage is a compact chat)

**Goal:** chats and stages build their agent sessions through **one** code path. From this phase on, a stage gets every chat capability by construction, gated only by the agent's tool policy and the stage's `SessionSpec`:
- tools (browser, computer use, widgets, extension tools, orchestrator tools; workflow tools are added in P06);
- MCP with resolved secrets;
- skills that actually load;
- agents and teams with their full restrictions;
- instruction ordering;
- permission, question and plan-review gates;
- workspace exposure;
- provider-session resume;
- turn recording.

The provider capability model gains explicit levels, so the composer can **say** what a provider cannot do instead of silently dropping it.

**Estimate:** 2.5–3 weeks. **Depends on:** P01. **Branch:** `wf/phase-02-session-composer`.
**Closes:** W-07, W-18, W-19, W-36 (skills), W-40 (binder), W-50, W-51, W-52, W-53, W-54, and RV-6, RV-7, RV-8, RV-18, RV-20 (by cutting the interim rebind), RV-26, RV-30, RV-41. PD-5, PD-17, PD-18 and PD-20 are applied.

## Read first
- `G2_chat_stage_parity.md` (whole)
- `C_orchestration_integrations.md` §b, §c, §e
- `REVIEW-LOG.md` RV-6, RV-7, RV-8, RV-18, RV-20, RV-26, RV-30, RV-41
- The P00 golden snapshots

## Design
New folder: `packages/core/src/services/session/`. Modules, as in G2 §3:

| Module | Responsibility |
|---|---|
| `types.ts` | `SessionOwner`, `ComposeInput`, `ComposeResult`, `GatePort`, `PermissionModeSource`, `TurnContext` |
| `cfg.ts` | Pure helpers |
| `workspaceExposure.ts` | Workspace exposure |
| `agentProjection.ts` | `applyAgentProjection` + `appendAgentInstructions` |
| `resolveMcp.ts` | MCP merge + hub resolution |
| `PlatformToolBinder.ts` | browser, computer, widgets, custom, orchestrator, hooks (+ workflows in P06) |
| `modeConfig.ts` | Mode config and gate wiring |
| `TurnContextRegistry.ts` | Keyed by conversationId |
| `bindingKey.ts` | Conversation binding key |
| `TurnRecorder.ts` | The shared turn listener |
| `providerSession.ts` | Provider-session memory |
| `SessionComposer.ts` | `compose()` |

**Canonical order** (the chat create path; it keeps the chat's tool and system-block order):
1. base;
2. resume id;
3. workspace exposure;
4. agent projection;
5. explicit spec, with one precedence rule for create and resume;
6. workspace hint;
7. binder: browser → computer → widgets → SCM hint → MCP → custom → orchestrator → hooks;
8. mode config;
9. **agent instructions last**.

**SessionSpec** (defined in `@generatorai/workflow-spec` in P01) is the single *type*:
- **Chats keep their table columns** (PD-20, RV-18). The chat repository maps row ↔ `SessionSpec`. That mapping is the storage mapping, not a shim. `CreateChatParams` is **unchanged** on the wire.
- **Workflows** use `WorkflowSpec.session`, and stages use `StageSpec.session` (already v2 since P01).
- **One merge:** `resolveSessionSpec(...layers)` (scalars most-specific-wins; exclusions union; MCP servers key-merged; `agentOverrides` via the resolver fold).
- **`PermissionModeSource`** layers are: run row → stage `session.permissionMode` → workflow `session.permissionMode` → trigger default (PD-18) → deployment posture. It is re-read **every turn**.

**Provider capability levels** (`ProviderCapabilities` in `packages/agent-harness-providers`; RV-6, RV-9):

| Field | Values |
|---|---|
| `approvalGating` | `'per_call'` (Copilot, ACP, claude-agent with the default tool gate) \| `'exec_and_patch'` (Codex) \| `'none'` (opencode) |
| `hostTools` | `'full'` \| `'start_only'` (Codex today: `dynamicTools` only on `thread/start`) \| `'none'` (opencode, ACP) |
| `structuredOutput` | `'native'` (claude-agent `outputFormat`; Codex `outputSchema`) \| `'tool'` \| `'none'` |
| `skills` | `'plugin'` (claude-agent) \| `'directories'` (Copilot, Codex) \| `'none'` |

This **replaces** `fullToolGating` and `skillDirectories`. Correct them per provider against the code (for example, Copilot declares `skillDirectories: false` but passes them, RV-8). Add a table test per provider.

**Permission-mode rules per gating level (PD-17):**

| `approvalGating` | Allowed run modes |
|---|---|
| `per_call` | all |
| `exec_and_patch` | `default` and `acceptEdits` allowed, with a composer warning "Codex asks per command/patch, not per tool"; `plan` allowed via the Codex read-only sandbox |
| `none` | only `bypassPermissions`/`acceptEdits`; `default`/`plan` → refuse at start with `PERMISSION_GATING_UNSUPPORTED` |

**Why this approach:**
- Three builders exist, and they have drifted into security bugs (W-50..W-53). Extracting the canonical chat path keeps the chat prompt order stable.
- A per-conversation turn registry fixes misfiled approvals (the chat pattern, CMS:283-290).
- Explicit capability levels turn silent capability loss (C-11) into visible warnings and start-time refusals.

---

## WP-2.0 Golden snapshots first
Re-run the P00 golden tests (green). Every later WP updates them **only** in expected places, and each commit names the W/RV id it fixes.

## WP-2.1 Pure helpers
Extract `appendSystemBlock`, `appendTools` and `unionList`. Replace the roughly 10 inline copies in CMS and SES. There is no behaviour change.

## WP-2.2 PlatformToolBinder
1. Move the chat create (CMS:1809-2031) and resume (2354-2483) blocks into the binder. The chat snapshots stay identical.
2. **Browser for stages:** the workspace comes from `workspaceManager.findWorkspaceByOwner(runId)` (never a variable). Stages use the shared `BROWSER_SYSTEM_HINT`.
3. **Widgets for stages** (T3), plus the **widget interaction digest** prepended to the next stage prompt (T4, RV-41).
4. **Custom/extension tools for stages** (T5). The authoring pair is excluded unless the `extensionAuthoring` group is granted.
5. **Computer use for stages** (PD-5): only when `session.computerUse === true` and the effective mode is not bypass. Otherwise add the composer warning `computer_use_blocked_bypass`.
6. **Orchestrator tools for stages whose agent role is `orchestrator`** (T6). `OrchestratorService` gets `parentOwner: chat | stage`, and workers remain chats. The worker-digest nudge for a stage owner is posted as a stage conversation message once P03b lands; until then, digests are returned through `check_*` tools.
7. **Hooks** (W-54): assign `buildHookBridge` in `apps/server/src/composition-root.ts`, and add a test proving a chat hook fires.
8. **Agent host IPC** (RV-26). When `apps/agent-host` is enabled, host tools, the gate callbacks, the hook bridge and the per-call context `{toolCallId, turnId}` must cross IPC. Extend `AgentHostClient` and its protocol types. Run the binder contract tests with the agent host **on** and **off**.

## WP-2.3 resolveMcp for both owners (W-18)
- Extract the chat MCP block into `resolveMcp(cfg, spec, owner)`. Stages pass `{workflowDefinitionId, workflowRunId}`.
- `dropped` servers become composer `warnings`, emitted as `harness.session_info {infoType:'mcp_dropped'}`.
- Explicit spec overrides beat agent defaults, for stages too.
- **Test:** `secretref:` headers are resolved for a stage; hub-disabled servers are dropped.

## WP-2.4 Agent projection, instructions and skills (W-50, W-51, W-52, W-36, RV-7, RV-8)
- `applyAgentProjection` replaces the CMS projection and `resolveStageAgent`:
  - it takes a scope (`chat|stage`);
  - it freezes a `snapshot` on resume;
  - stages store the snapshot on the run for now (P03 moves it to the attempt).
- **Teams** carry `tools`, `disallowedTools`, `reasoningEffort`, `maxTurns` and `permissionMode` (W-52).
- **`appendAgentInstructions` runs last.** `replace` drops only the replaceable base (W-51).
- `applyExplicitSpec` is one precedence rule for create and resume. `systemPromptAppend` and `maxTurns` apply on create (W-50).
- **Skill staging root** = the run workspace **root**, never a worktree (W-36 / C-8).
- **Skills actually load, per provider capability** (RV-7, RV-8):
  - `skills: 'plugin'` (claude-agent): generate a local plugin root `<workspaceRoot>/.generatorai/plugin/{.claude-plugin/plugin.json, skills/<name>/SKILL.md}`, then pass `plugins: [{type:'local', path}]` plus `skills: [names]`. **Keep `settingSources: []`.** A test asserts that a repository's `.claude/settings.json` hooks are **not** loaded.
  - `skills: 'directories'` (Copilot, Codex): pass the staged directories. Codex skill roots are process-global today (`syncSkillRoots`); scope them per thread if the app-server supports it, otherwise emit a warning (C-19).
  - `skills: 'none'`: emit a warning.
- **Missing or disabled `agentRef`** → the stage fails with `agent_not_found` / `agent_disabled` (C-12).

## WP-2.5 Workspace exposure for stages
Stages get `workingDirectory`, `additionalDirectories`, `env` and the `[Workspace]` hint from the run's `ExecutionWorkspace`. Delete every `process.cwd()` fallback in SES (B-5). A missing workspace is a composer error.

## WP-2.6 GatePort, TurnContextRegistry and the tool-policy wrapper (W-53; RV-41)
- **`ChatGatePort`** wraps the existing chat handlers.
- **`StageGatePort`** is backed by durable `HitlService`:
  - `permission` → `kind:'tool_permission'`;
  - `question` (new) → `kind:'question'`;
  - `planReview` (new) → `kind:'plan_review'`;
  - `recordPlan` → `PlanService`, **including the `record_plan` tool for stages** (T7).
- **Mode config for stages** (RV-41 P6/P7): the plan-mode system block (`planModeInstructions`, `AUTO_MODE_PLAN_INSTRUCTIONS`); the plan prefix **only** for providers without a native plan gate (`capabilitiesFor().planMode`).
- **Stage gate events** use the chat shapes (`*.permission.requested/resolved/expired`, `*.question.asked`, `*.plan.review_requested`) with `stageRunId`. The StreamPanel cards and lock-screen push actions then work for stages.
- **`withAgentToolPolicy(gate, groups)`** wraps both ports, so chats enforce agent tool groups too (W-53).
- **`TurnContextRegistry`** is keyed by conversationId, and SES sets it before every turn.
- **Bind failure** (R9): the stage emits `error` + `idle` on the stage stream and fails with a classified error (the P03 classifier; until then `stage_run.failed` carries the message).

## WP-2.7 PermissionModeSource, unattended defaults and per-turn options (W-07, W-19; PD-17, PD-18; RV-30)
- `ComposeResult.turnOptions(agentMode)` re-reads the source every turn.
- Delete `DEFAULT_WORKFLOW_RUN_PERMISSION_MODE = 'bypassPermissions'` (`shared/types/WorkflowRun.ts:81`). A NULL run mode resolves through the layers; it is never bypass.
- **PD-18, unattended runs.** Automations **must** declare `permissionMode`. Add a **required** field to `CreateAutomationSchema` in this phase (not P04), defaulting in the UI to `acceptEdits`. Existing automations are migrated to `acceptEdits` in migration v56. Bypass on webhook-triggered automations needs an explicit, admin-scoped opt-in. CLI and SDK runs without a mode use the deployment posture.
- Follow-up and review turns get turn options.
- Refusal per PD-17 at run start.
- **W-19 test** (`P02-perm`, testkit with a fake provider per gating level, plus a live advisory run):
  - claude-agent with `default` parks on its first write tool;
  - Codex with `default` parks on its first command/patch approval;
  - opencode with `default` is refused at start.

## WP-2.8 Composer assembly and caller switch
- `SessionComposer.compose()` assembles WP-2.1–2.7.
- CMS `createChat` and `buildConversationConfig` call it. Delete the old copies.
- SES computes `resolveSessionSpec(workflow.session, stage.session, runOverrides)` and calls `compose({owner:{kind:'stage',…}, permissionSource:{kind:'run'}, gates: stageGatePort, attended: true})`.
- **Delete:** `resolveStageAgent`, the SES `buildPermissionHandler`, `resolveStageTurnOptions`, and the SES session-config block (1131-1259).
- Composer `warnings` are emitted as `harness.session_info`: capability loss, MCP dropped, computer use blocked, skills unsupported and the gating-level warning. Nothing is silent any more (C-11).
- **Shared conversations** (the v1 `single` mode) are **not** touched. The interim rebind is cut (RV-20), and P03 replaces the mode.

## WP-2.9 TurnRecorder and provider-session resume
- `TurnRecorder` replaces the three listeners (CMS:3010-3225, SES:1393-1481, SES:3024-3078). Stage messages gain `turnId`, `success`, `fileOp`, `sequence` and live checkpoints.
- **Completeness marker** (RV-10): every persisted assistant message carries `complete: boolean`. It is `true` only when written on the provider's final turn event, and `false` for partial-on-cancel. The column is added in migration v56.
- `rememberProviderSession` is called for stage sessions too (fixes F-3b).

## WP-2.10 Migration v56 `session_parity`
Small and chat-safe (explicit, no cascades):
- `chat_messages.complete INTEGER NOT NULL DEFAULT 1`. Existing rows count as complete; partial rows are already flagged in metadata, so backfill `0` where `json_extract(metadata,'$.partial') = 1`.
- `automations.permission_mode TEXT NOT NULL DEFAULT 'acceptEdits'`, backfilled.
- Regenerate the baseline, and update the lock and `schema.ts`.
- **Migration test:** chats unchanged except `complete`; automations get the mode.

## WP-2.11 UI: SessionSpecEditor (behaviour first, PD-19)
- `apps/web/src/components/session/SessionSpecEditor.tsx` is used by the stage panel, the workflow General tab (**adds** the workflow-level model/agent controls, D-31) and `CreateChatDialog`.
- Controls: model, effort, context tier, harness, agent plus overrides, default mode (the `agentMode` control, which was missing), skills, MCP, permission, and browser/computer/widgets toggles.
- Show capability warnings inline.
- Build it from existing primitives only.
- Add a permission-mode field to the automation editor (PD-18).

## Out of scope (explicitly)
These chat features do not apply to stages. A run has its own fork and rewind (P03 `forkRun`):
- prewarm (L9);
- rewind and restore notice (L10, L11);
- conversation seed (L12);
- per-turn auto source control (W6).

---

## Tests to add
- **Golden snapshot deltas** for exactly W-50/51/52/53. Other chat snapshots stay byte-identical.
- **Composer unit tests:**
  - tool order;
  - instructions last;
  - replace semantics;
  - team fields;
  - MCP precedence plus hub;
  - computer-use gating;
  - widget and custom gating;
  - the skills mechanism per provider (plugin root generated; settingSources stays empty; repo hooks not loaded);
  - warnings per capability level.
- **Gate tests:**
  - the active stage is filed in a shared conversation;
  - chats enforce the tool policy;
  - question and plan-review round trips survive a restart (testkit `killAndRestart`);
  - `record_plan` for stages.
- **Permission tests:**
  - layers resolve;
  - no bypass default;
  - automation mode required;
  - PD-17 refusals;
  - per-turn re-read.
- **Agent host on/off contract run** (WP-2.2 step 8).
- **Migration v56 test.**
- **Testkit + advisory E2E:** `P02-perm`, `P02-mcp-secret`, `P02-widgets-stage`, `P02-skill-claude`, `P02-question-stage`.

## Acceptance criteria
- There are no session-config builders outside `services/session/`.
- A chat and a stage bound to the same agent receive the same tools, blocks and MCP servers, apart from the documented owner-specific differences.
- The run page Widget tab renders a stage widget.
- An automation cannot be saved without a permission mode.

## Handoff checklist
- [ ] WP-2.0 … 2.11 done; snapshot deltas reviewed.
- [ ] `STATUS.md` and `TRACEABILITY.md` updated.
