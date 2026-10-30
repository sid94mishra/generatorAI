# Web design delta v1 → v2 (2026-09-24) and workflow-engine sequencing

Sources: `web-v1/` vs `artifact-files/45d76aa2-…/project/` (78 boards, 17 changed + 5 new + canvas.json), the "Workflow Overhaul Plan" v1.2 artifact (14 docs, extracted to `wfplan/*.md`), the "Workflow Engine Audit" artifact (its Part V plan is marked superseded by the Overhaul Plan; its W-01..W-49 register still applies), plus greps of the repo at `a83a7bf`.

**Summary.** v2 is not a visual refresh. It draws the Workflow Overhaul Plan's end state: spec v2, SessionSpec, engine v2, a single invocation path, loops and other control flow, and agent authoring. None of that exists in the code today. The design system itself has barely moved: the shared style block, tokens and class vocabulary are unchanged. The main effect on plan-v1 is on **sequencing**, not architecture.

---

## (a) v1 → v2 change list

**Shared `<helmet><style>` block: unchanged.** All 60 non-theme boards, including the 5 new ones, still hash to the same block (`1b5b4c2c`), and the 17 theme boards are identical. There are no new CSS variables and no new classes, with one exception: `i16` is used twice in ChatWorkflowRun but is **not defined** in the shared block. This is a design bug, but the kit needs a 16px icon size anyway.

**Foundations.** The status map grows from **7 to 8 states**:
- **Waiting** is added: clock glyph, `fg-2`, `s-idle`, meaning "wait stage on an event, timer or form".
- **Paused** is redefined as "needs a decision (budget, retries, restart)". It was "suspended or sleeping".
- **Running** now reads "finalizing shows its phase".
- "Sleeping" is gone.

These map to engine v2 states (`waiting`, `finalizing`, `paused(reason)`) and to PD-7 (durable sleep is deleted).

**Components.**
- A Waiting badge is added.
- The "Sleeping until CI finishes" row becomes "Waiting · CI event · ci:3f9a2c1 · 4m".
- The agent initials avatar ("BF") becomes a bot icon. That change applies to every workflow board: `.av` counts drop 6→0 in Builder, Run and Detail, and 5→0 in Scripts. **Agents are no longer shown with initials avatars on workflow surfaces.**

**canvas.json.**
- 5 boards are added, at y=2040 on the `workflows` and `wfcreate` pages, and appended to `order`.
- Retitled: `WorkflowStageModel` is now "stage **Session**", and `WorkflowStageHooks` is now "stage Hooks + **Output**".

**Common to all builder boards** (Builder, Stage×4, Settings, Validate):
- Header: a "Published v7" badge, "Unsaved changes", Save, and a new **Publish v8** button.
- Nodes show the stage **key** in mono (`assess_risk`). Pills change: "Timeout 5m" becomes "5m", and the new pills are "Guard", "Join any" and "Retry 3×".
- Edges:
  - "if risk = high" becomes `when max_risk == 'high'`;
  - "Always" becomes "Handles failure";
  - the edge menu gains a "Handles failure" option.
- The inspector subtitle reads "`key` · Agent stage · n of 6".
- Inspector tabs are now **Prompt / Session / Tools / Output / Policy / Hooks**. There are 6; "Output" is new and "Model" was renamed "Session".

**Per-board changes.**

| Board | Semantic change |
|---|---|
| **WorkflowBuilder (Policy tab)** | Run-condition radios, context filter and result validation are removed. New sections: **Approval** (reviewer prompt, allow changes, max rounds), **Join** (All / Any / N of M / Cancel the rest), **Guard** expression with live parse, **Timeouts** (attempt / idle / total / queue), **Budget** (turns / $ / wall clock), **Retry v2** (attempts, delay, multiplier, max delay, jitter, Resume vs Restart, retry-on error classes: Transient / Rate limit / Timeout / Provider), **When exhausted** (Pause / Fail). |
| **StagePrompt** | "Instructions: Inline / Files / Agent" is replaced by **Context** (from stage keys; mode Summary / Output / Structured / None). Prompts reference `stages.scan.output.packages` and `run.codebases.payments_api.path` (previously `repo_path_*` and `__*`). The variable popover now lists output-schema fields and the `run.*` scope, with a "Type `{{` for suggestions" hint. The Output section moves to the Output tab. |
| **StageModel → Session** | Agent (optional; "adds instructions, 2 skills, 2 MCP"), Model ("agent, then workflow default"), Effort drops Extra high, **Provider**, Agent mode, Max turns, **Permission** (inherits the workflow), **Session reuse Fresh / Continue**, **Session group**, and an inline capability warning. Stage template is removed. |
| **StageTools** | Stage variables are removed. **Platform tools** are added (Browser, Computer use "blocked when the run uses Bypass", Widgets, Workflows "off by default"). Skills are labelled "From agent". |
| **StageHooks → Hooks + Output** | Script hooks are admin only. Hooks take a literal Command + Args, plus **Env** values that are templated or `secretref:`. Timeout, retries, priority and on-fail are removed. **Compensate** is added. Workflow hooks are `on_failure` / `on_exit`. **Output tab:** Format Text / JSON, JSON Schema field chips, **Extraction** (Auto / Native / Tool / Final JSON block), Summary (Auto / LLM / None), and Rules (JSON Schema, Regex, a new **Judge** with rubric, pass threshold and optional model), plus **Max repairs**. |
| **SettingsPanel** | Tabs are General / Project / Variables / Hooks / Tags / **Budget**. A workflow-level **Default session** (model + permission) is added. The Variables tab adds **List** and **JSON** types and reserved-name errors ("run is reserved…"). "Launch prompt" becomes the "Run dialog" preview. |
| **WorkflowValidate** | Split into **3 errors / 1 warning**. Issues carry codes (`undeclared-variable`, `unknown-stage-key` with "Did you mean", `edge-pair`, a `permission-gating` warning) and quick-fixes (Declare / Replace / Go to). "Publish and Run are blocked… Save still works." |
| **WorkflowNew** | New workflows are **drafts**. There are 18 templates with a category seg (Review / Loops / Fan-out / Gated) and kind chips (Loop, Check, Map, Wait, Sub-workflow). The preview shows loop exits and budget. The **session-mode seg is removed**. Import takes a `WorkflowGraph formatVersion 2`. The action is "Create draft and open builder". |
| **WorkflowDetail** | Header: Published v7, Versions 7, Open in builder, **Test run**, Run. Stages are shown by key + agent (not model). Config rows: alias → codebase · worktree, Default session, a "Commit → Push → PR" chain, hooks with secretref. The runs table gains **Ver** and **Trigger** columns (Manual / Fork / Chat / Automation / CLI), and a Median cost stat is added. |
| **WorkflowRun** (layout change) | The pipeline strip and **Gantt are replaced by a stage table** (Stage / Key / Agent / Attempt "2 of 3 · resume" / Time). Other changes: a second 38px header row (permission control, **budget meter** "$3.12 of $10", **context gauge**, trigger · codebase @ branch · worktree); a pinned-version chip; Pause as a split button (drain / interrupt); Cancel confirm; a **Run lifecycle card** (Setup: Workspace · Mounts · Uploads · Project configs · Preprocess · Sandbox; Finalize: Compensate · Hooks · Commit → Push → PR · Release). There is an inline review card with rounds and a **stage composer** ("Message Bug Fixer in this stage…" + Stop). Dock tabs are Inspector / Changes / Terminal (Browser moves to "open another panel"). Inspector sub-tabs: Variables becomes **Events**. Also new: stage usage vs budget, timeouts, and a stage "…" menu (Pause, Resume, Cancel, Retry Resume/Restart, Skip as completed, Re-run from here, Copy output, Open in inspector). |
| **Workflows list** | A Status column (Draft rev N / Published vN). The "Never run" seg becomes a Draft · Published filter, and the Automation chip becomes **Trigger**. There is an agent-draft row. The row menu is Run…, Test run (drafts only), Open in builder, Version history, Duplicate as draft, Export JSON, Archive (has runs). |
| **Automations / Detail / Create** | "Input mode" (Single / Loop / Batch / Script) becomes **Dataset** (rows). A new **Permission** column appears and is required ("Workflow & permission" wizard step). Runs are labelled "Finalized · PR opened", and "Needs you 2 of 3 finalized". The dataset has a schema, and webhook payloads must match it. |
| **Scripts** | Materialize becomes "**as draft**". "Compiled to a workflow graph", with keys and **one loop** (`fix_until_green`, max 3, until `stages.test.output.passed`). The back-edge is removed and the session continues. Running needs `write:workflows`. |

## (b) The 5 new boards

| Board | Purpose / template | New composites | Closest code today | Feature exists? |
|---|---|---|---|---|
| **WorkflowRunDialog** | A **1040×856 modal** over WorkflowDetail: a two-column form plus a 360px **Plan preview** aside and a 56px footer (Cancel / Test run / Run Ctrl ↵). | Stage-overrides table (skip, per-stage model, variable overrides by key); Run options (model, effort, permission mode + posture note, run name, "stop after N min"); Codebases (alias, codebase, branch, worktree / in place); Uploads; Plan preview (layers L1..L5 with ‖, conditional, approval, setup/post phases, budget, warnings). | `components/workflow/VariableInputModal.tsx` (625 lines): variables, uploads, per-stage skip and stage variables. | **Partial.** There is no per-run model / effort / permission / budget / codebases, no `plan` endpoint, no idempotency, and no draft Test run. This is the P04 WP-4.4 "`VariableInputModal` becomes **RunDialog**" item, described almost verbatim. |
| **WorkflowRunLoop** | A run page (T5 variant) with a **loop row** expanded inline. | Loop badge 3/5 and iteration n of max; an exit-rule table (rule, action · reason, value, streak "no_changes 1/2"); budget; carry chips per iteration; a continuing-session transcript with iteration dividers; an "Iteration input" card; an Inspector **Iterations** tab (verdict / open / changed / turns / cost per #); a **decision card** (Paused · max iterations: Grant +1 / +2, Raise budget, Continue with input, Accept, Accept iteration, Fail). | `WorkflowRunPageV2.tsx`, `redesign/StageTimelineItem.tsx`, `RightInspector.tsx` | **No.** `iterationConfig` is persisted in `packages/shared` schemas but has **no executor**. There is no `loop_iterations` table, no `instance_path`, and no commands API. This is P05 WP-5A.5. |
| **WorkflowLoopBuilder** | A canvas editor (T6) with a **loop group node** ("Fix and review · Loop · max 5", with a "next iteration" back-arrow) and a 390px **Add-stage kind palette** (Agent, Check (admin), Loop, Map, Sub-workflow, Wait; "Wrap in loop"). The inspector for the loop has tabs Loop / Policy / Hooks. | Max iterations; four quick exit rows (Until → complete, Fail when, Pause when, Stall → exhaust) plus Add rule and an order note; a Carry table (name, expression, init); Budget; On limit (Pause / Fail / Accept last / Accept best); On body failure; Output mapping; Wrap-up. | `WorkflowBuilderPage.tsx`, `DAGCanvas.tsx`, `StageNode.tsx`, `StagePropertiesPanel.tsx` (945 lines). None of these support group nodes or stage kinds. | **No** (P05 5A/5B). The node badges "Continue / Fresh / Follow-up" depend on P03 `sessionReuse`. |
| **WorkflowAgentDraft** | A canvas editor with a **draft banner** ("Drafted by Orchestrator in chat … replaces v7", Review diff / Discard / Publish v8, risk chips, "+1 stage, 1 changed") and a 400px **Version history** aside. Nodes carry Added / Changed tags. A **Check** node (no LLM, allowlisted command) appears. | Version list (draft revision, published vN with Live, author and hash, tick-two-to-compare); a diff list (M / A per stage or edge); Restore as draft. | `WorkflowBuilderPage.tsx` | **No.** The DB has only `workflow_definitions.version` (an integer bumped on PATCH): there is no versions table, no draft/published status and no diff. P01 WP-1.6/1.7 adds the versions and status; P07 WP-7.6 adds the diff/restore UI; P06 WP-6.5 adds the banner. |
| **ChatWorkflowRun** | A chat workspace (T5) with an orchestrator transcript containing tool-call cards: `run_workflow` → **run card** (stage 2/6, v7, Open run); `check_workflow_run` → **approval card** (round 1 of 3, Reject / Request changes / Approve, "uses the same command as the run page"); `create_workflow_draft` → **draft card** (risk, "publishing needs a person", Open in builder / Publish). | Dock Tasks tab gains "Workflow runs from this chat" and "Drafts" sections next to Background agents, plus a caps note (3 per chat, 10 per root). The composer "Tools in this chat" popover has a **Workflows** toggle ("off by default, on for orchestrators"). | `ChatPage`, `chat/AssistantMessage` / `ToolMessage`, `chat/BackgroundTasksPanel`, and `PermissionCard` / `PlanCard` for the card pattern | **No.** Only an MCP `generatorai_run_workflow` exists. The audit says a chat agent cannot start or wait on a workflow. This is P06 WP-6.1/6.2 (tools, `ChatWorkflowRunBridge`, `chat_workflow_runs` table, cards). |

## (c) The workflow engine plan and what it means for the UI

**The Overhaul Plan (v1.2, 24 Sep).** It has 11 phases and takes about 28–34 engineer-weeks, plus a gated P08. It is strictly sequential, with no compatibility shims.

| Phase | Weeks | What it delivers |
|---|---|---|
| P00 | 1 | Baseline |
| P01 | 3 | `@generatorai/workflow-spec` with **stage keys**; Stage/Edge/WorkflowSpec v2 (`guard`, `join`, retry v2, `timeouts`, `budget`, `output{format, schema, extraction, rules}`, `context{from, mode}`, `session`, `sessionReuse`, `sessionGroup`, `approval{prompt, allowChanges, maxRounds}`, `compensate`); Expression v2 (`stages.k.output`, `run.codebases.*`, reserved roots); a secretref / command-args-literal policy; an atomic graph save with `expectedRevision`; **immutable versions, draft/publish, pinned runs**; migration v55 (**drops run history**, deletes the legacy automation input modes); the builder rebuilt on v2 (engine-gated controls rendered but disabled). |
| P02 | 2.5–3 | SessionComposer and `SessionSpecEditor` (workflow default session, stage session, platform tool toggles); automation `permissionMode` is required. |
| P03 | 5–6 | Engine v2: CAS states (`waiting`, `finalizing`, `paused(reason)`), attempts with resume/restart, error classes, repair, budgets, a commands API, `forkRun`. The engine gate flips, which enables the Policy controls. |
| P03b | 2 | Stage conversation (composer, "…" menu, permission control, context gauge). |
| P04 | 2.5–3 | One invocation path, the lifecycle Setup/Finalize phases on MountService, **RunDialog** with plan preview, triggers, `finalized`. |
| P05 | 6.5 | Generic **loop**, map, sub-workflow, wait, check, joins, fork / re-run from here, judge rule, CodeMirror expression editor, list/json variables, the templates. |
| P06 | 2–3 | Chat/orchestrator workflow tools, chat run/approval/draft cards, the authoring service and skill, the **agent-draft banner**. |
| P07 | 1.5–2 | Budget/cost UI (**$ only when the provider reports it**), version diff/restore UI, searchable Add stage, filters. |

**PD-19 conflicts with plan-v1.** PD-19 says: *"The overhaul lands data, API, stores and behaviour with existing components; the redesign reskins once afterwards."* Every overhaul UI WP (1.8, 2.11, 3b.2, 4.4, 5A.5, 6.2, 7.6) says "existing components only". Plan-v1 Phase 4 ports the workflow screens onto the new kit. Taken together, that means building the workflow UI three times:
1. a plan-v1 port of today's v1-shaped screens, which v2 has already made obsolete;
2. the overhaul rebuild on old components;
3. a final reskin.

**What can be built now, with no engine dependency:**
- Tokens (including the **8-state status map**), primitives, patterns, templates and the shell.
- Chat, dock, settings, projects, agents, home and command palette. Of these, only the chat dock Tasks panel and the composer tools popover need extension points for P06.
- **Engine-agnostic** workflow composites that can go into the kit ahead of time:
  - the version/status badge;
  - the key chip;
  - a problems panel with codes and quick-fixes;
  - the stage table row;
  - the run lifecycle card;
  - the budget meter and context gauge;
  - the decision/review card;
  - the modal 1040 form-plus-aside template;
  - the canvas group node;
  - the kind palette popover;
  - the version-history aside;
  - the tool-call run/approval/draft cards.

**What must wait for engine work:**

| Waits for | Screens and features |
|---|---|
| P01 | Builder, Detail, List, WorkflowNew, Validate, Stage Prompt/Output/Hooks, Scripts, the Automations dataset |
| P02 | Session tab, Settings default session, Tools platform toggles, Automation permission |
| P03 / P03b | Policy tab (live), Run page (stage table attempts, commands, composer) |
| P04 | RunDialog, the lifecycle card, the Trigger/Ver columns |
| P05 | Loop builder, run with a loop, kind palette, 18 templates, Re-run from here, expression autocomplete |
| P06 | ChatWorkflowRun, the agent-draft banner |
| P07 | Version diff/restore, $ budget |

**Design fields that map to engine concepts that will change or are gated:**
- Session mode (removed) → `sessionReuse` / `sessionGroup`.
- `repo_path_*` / `__*` → `run.codebases.*`.
- Condition → guard / `when`.
- `resultValidation` → `output.rules`. The Judge rule depends on P05 WP-5A.6.
- Automation Input mode → Dataset (PD-8).
- Sleeping → Waiting.
- "Succeeded" on runs → Finalized.
- `$` displays → tokens-only fallback for providers that don't report cost.
- Script materialize back-edges → loop.
- P08 dynamic-script UI is decision-gated (PD-21). It is not designed and should not be planned.

## (d) Concrete changes to plan-v1.md

1. **Design facts.**
   - Add "v2 (24 Sep): 78 boards; shared style block unchanged; status map now **8 states (+Waiting)**; Paused = needs decision; Finalizing is a Running phase; no initials avatars on workflow surfaces; `.i16` needed in the kit". Update the 7-state text in the Architecture section (`status.ts`).
   - Mark every workflow/automation/scripts board as **the overhaul end-state spec, not today's feature set**.
2. **Phase 4 feature ports.** Remove workflows, automations and scripts from the redesign's port list. Replace them with: "Workflow-domain screens are built by the Workflow Overhaul phases directly on `@generatorai/ui`." Do not port today's v1-shaped workflow pages; P01 WP-1.8 rewrites the builder anyway. Until their phase lands, the old workflow pages keep running inside the new shell. Only a token/alias pass is allowed on them, with no restructuring.
3. **Amend PD-19** (needs a product decision). The current wording is "existing components; reskin later". Change it to "use `@generatorai/ui` primitives/patterns from the redesign kit once Phase 2–3 merge; before that, existing components". Get redesign Phases 0–3 merged **before overhaul P01 WP-1.8** (about 4 weeks out: P00 1 wk + P01 3 wk). Record this as a cross-plan dependency in both plans.
4. **Kit scope (Phase 2/3).** Add the engine-agnostic workflow composites listed in (c), plus canvas group nodes and a lazy CodeMirror slot. Also add the **Modal-with-aside template** (the RunDialog is 1040×856, larger than the 960×640 Settings modal) and a **Tool-call card** pattern shared by chat and run.
5. **Map each new/changed board to its overhaul phase.** Add a table to `docs/redesign` mapping board → WP:
   - Builder → 1.8, 3C, 5A.5, 7.6
   - Session tab → 2.11
   - Run → 3b.2, 4.x
   - RunDialog → 4.4
   - LoopBuilder / RunLoop → 5A.5
   - AgentDraft → 1.7, 6.5, 7.6
   - ChatWorkflowRun → 6.2
   - Automations → 1.6 (PD-8), 2.x (PD-18)
   - Scripts → 1.x, 5A
6. **Chat workspace port.** Build the dock Tasks panel with pluggable sections ("Workflow runs", "Drafts"). Give the composer tool toggles a registry, so that P06 adds the Workflows toggle and the cards without reopening ChatInput. Coordinate the ChatInput split with P03b, which reuses a **compact ChatInput** as the stage composer.
7. **Open questions.**
   - Add: the PD-19 inversion; whether run history is dropped at v55 (it affects the Detail "Runs" rail and e2e fixtures); and the 72 h `pauseTtl`.
   - Resolve "queue vs no-queue" in the light of PD-3 (`STAGE_BUSY` = chat parity, which implies no queue).
   - The costs shown in the designs need a tokens-only variant (P07).
8. **Verification.** Workflow e2e in plan-v1 must use the overhaul's isolated test server and FauxProvider testkit (P00 WP-0.3). It must never touch port 3100 or the real DB, because the overhaul migrations drop run history.
9. **Mobile follow-up.** Add the overhaul's mobile items: StartRunSheet → invoke, decision/approval cards, and the Waiting status. Keep mobile at desktop parity (memory rule).
