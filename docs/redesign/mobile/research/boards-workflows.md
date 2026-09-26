# Mobile boards: workflows, runs, builder and stage editors

Scope: the 28 boards on the canvas page `workflows` ("Workflows, runs & the builder"). Each board is 1000 × 1040 and shows an
iOS 27 iPhone (402 × 874 pt) next to an Android 17 Pixel (412 × 915 dp) in the same state.

Sources read for every board: `docs/redesign/boards/png/mobile/<Board>.{dark,light}.png`, `docs/redesign/boards/mobile/project/<Board>.dc.html`
(labels, aria-labels, inline geometry), `canvas.json` (titles). Context: `MPrinciples`, `MFoundations`, `MComponents`, `MGestures`,
`docs/redesign/research/mobile-design-analysis.md`, D-35 in `01-decisions.md`, `07-phases.md` §Running in parallel,
`03-component-inventory-domain.md` §4 (desktop WF-01…WF-20), the Workflow Overhaul Plan v1.2 (artifact Kqrzv5CnsYg13EdQNTp2gC, read as data),
`packages/shared/src/types/{Workflow,WorkflowDefinition,StageDefinition,WorkflowRun,HookDefinition,WorkflowOrchestrator,RunProfile}.ts`,
`packages/shared/src/status/*`, `packages/client-core/src/api/{client,stageOverrides}.ts`, `apps/mobile/src/{components/work,components/runs,auth/stepUp.ts}`.

No instruction-like text was found in the 28 board files (the only script is the canvas theme switcher `renderVals()`).

## Conventions

**Component names** are the MComponents catalogue names: *Header* (top-level / chat-and-run / detail), *Sidebar drawer*, *Floating New*,
*Prominent* (the one ink action: Run / Send / Approve), *Buttons* (secondary, destructive), *Chips*, *Segments* (iOS segmented control /
Android connected button group), *Switches*, *Check* (iOS check circle / Android checkbox or radio), *Chat list rows* (swipe),
*Text fields* (iOS inset form row / Android outlined field), *Right pane shell* (iOS pill tabs / Android underline tabs), *Sheets*
(iOS inset sheet / Android edge sheet, grabber, detents), *Menus* (iOS pull-down or context menu / M3 menu), *Confirmation*,
*Toasts and status badges*, *Empty state and skeleton*, *Transcript kit* (Tool block, agent label, Permission / Question / Plan gate cards),
*Composer states*. The boards' CSS primitives: `gbtn` (iOS 44 glass circle), `gcap` (iOS glass capsule 44h), `aib` (Android 48 icon button),
`mbtn`/`mbtn-p` (iOS 44h capsule button, radius 22), `abtn`/`abtn-p` (Android 40h, radius 20), `mchip` (iOS 32h, radius 16),
`achip` (Android 32h, radius 8), `igroup` (iOS inset group, radius 22, `--raised`), `irow` (iOS row, min 52h), `arow` (Android row, min 64h),
`sheet-i` (inset 8 px, radius 38, `--overlay`), `sheet-a` (edge sheet, radius 28 28 0 0), `grab` (36 × 5), `afab` (Android extended FAB 56h,
radius 16, `--accent`), `ptab-i` (32h pill tab) / `ptab-a` (48h underline tab), `bdg` + `s-run|ok|warn|err|idle` (20h badge, radius 4).

**Desktop names** WF-01…WF-20 refer to `03-component-inventory-domain.md` §4.

**Data availability legend** (against the code today, not the overhaul): ✓ exists in shared/client-core types and an endpoint;
~ partly (different shape or only derivable); ✗ missing. Overhaul phase references: P01…P07 = Workflow Overhaul Plan phases.

**Headers, as drawn on every board in this group.** iOS detail header: 52 pt bar under the 62 pt safe area, `gbtn` back (44, glass),
centred 12 pt breadcrumb over a 16/600 title, trailing actions in one glass capsule (`gcap`). Android detail header: 64 dp under the 40 dp safe area,
`aib` back arrow, left-aligned 12 sp breadcrumb over an 18/600 title, trailing icon buttons. Repeated below only where a board deviates.

---

## 1. MWorkflows — "Workflows · list"

1. **Purpose.** Top-level module screen: every workflow, with its last run and 30-day success rate. One state: populated list, with one row
   swiped open (Run revealed). Presentation: top-level (sidebar module).
2. **Header.** iOS: `gbtn` sidebar toggle (glass) left, trailing glass capsule "Import JSON" (aria: "Import JSON: a WorkflowGraph file,
   validated before it is saved as a draft"); large title "Workflows" 32/600 with mono count `10` *below* the bar. Android: `aib` sidebar toggle,
   title "Workflows 10" 22/600 in the bar, trailing outlined `abtn` "Import JSON".
3. **Components.** Search field ("Search workflows") + filter button (aria "Filter and sort: run status, project, tags, automation");
   Segments All 10 / Published 8 / Drafts 2; summary line "212 runs in 30 days · 93.4% succeeded" + sort menu "Updated ⌄"; list rows
   (title + tag chips + status glyph + `v4 · #34 · 2h ago · payments-service` + right-aligned `71% / success`); Agent draft badge (`bdg s-idle`,
   sparkle glyph, "Drafted by Orchestrator"), Draft badge ("Never run"); swipe action Run; Floating New "New workflow".
   New: **WorkflowRow** (not a chat row: it carries version, last run number, success rate).
4. **iOS vs Android.** iOS rows sit in one `igroup` (inset grouped, hairline separators); Android rows are separate tonal cards with gaps
   (segmented M3 list). iOS segmented control (32h, sunken track) vs Android connected button group with a check on the selected segment.
   iOS New = glass capsule (not filled); Android New = extended FAB filled with `--accent` (ink). Import JSON: glass capsule vs outlined button.
5. **Native features.** Row swipe (trailing Run, ink-filled; haptic "swipe threshold" = iOS impact light / Android TOGGLE_ON), pull to refresh
   (implied by module lists, not drawn), document picker for Import JSON (UIDocumentPicker / SAF `ACTION_OPEN_DOCUMENT`), search field
   (iOS searchable nav bar style drawn as an inline field), sort pull-down menu.
6. **States / gestures.** Drawn: populated, one row swiped. Swipe Run has a button equivalent (Run on the detail screen) but no long-press
   menu is drawn. Not drawn: empty (no workflows), loading skeleton, search with no results, filter sheet, Import JSON flow and its
   validation errors, offline.
7. **Data.** name ✓, tags ✓, project ✓ (`projectId`), description ✓. Version `v7` ~ (`WorkflowDefinition.version` is a bare integer; P01 adds
   versions). Published/Draft status ✗ (P01). "Agent draft · Drafted by Orchestrator" ✗ (P06 `authoredBy`). Last run number `#248` ✗ —
   **runs have no sequential number anywhere** (ids are UUIDs; no `runNumber` in server, shared or client-core). Last run status/time ~ (needs a
   per-workflow "last run" read model). 30-day success % per workflow and "212 runs in 30 days · 93.4% succeeded" ✗ (no stats read model; and
   PD-13 drops run history at the engine migration). Filters by run status / automation ✗ server-side.
8. **Issues.**
   - Status glyph semantics: the agent-draft row shows the dashed Queued glyph for "never run"; a draft is not queued. Use no glyph or a
     neutral "Draft" badge only.
   - Tag chips truncate the title on both platforms ("Nightly dependency a…"); tags should drop first, not the name.
   - Swipe action Run is ink-filled while the Floating New is glass on iOS: two prominent controls on one screen on Android (FAB + swipe Run).
   - Android New FAB is filled ink but iOS New is glass; principle 6 says "Run is the only filled control". Decide whether the Android FAB
     uses a tonal container instead.
   - Success "%" for a draft shows "—" with the label "success"; the label should disappear.
   - Swipe-to-run is a side-effecting action on a swipe; principles forbid Approve/Delete on swipes but not Run. A full swipe must not trigger
     Run; confirm it opens the Run sheet (MWorkflowLaunch), not a direct start.

## 2. MWorkflowDetail — "Workflow detail · Nightly dependency audit"

1. **Purpose.** Pushed detail of one workflow: status, description, read-only graph preview, 30-day stats, recent runs, setup (continues in
   MWorkflowDetailMore). Presentation: pushed from the list.
2. **Header.** iOS: back `gbtn`, breadcrumb "Workflows", title "Nightly dependency audit", trailing `gbtn` "⋯" (aria "More: edit in builder,
   version history, duplicate, export, delete"). Android: back arrow, same breadcrumb/title left-aligned, trailing overflow ⋮.
3. **Components.** Version badge "Published v7" (`bdg s-idle`) + "revision 12 · Sep 22 by you" + "Versions" link; description with inline mono
   `payments_api`; chips row (horizontal scroll) "6 stages", "1 approval gate", "deps · nightly", "Created Sep 2"; **mini graph** card (dot grid,
   6 nodes 2 rows × 3, edge label mono `when max_risk == 'high'`, dashed red `on failure`, caption "Published v7 · read-only", button "Tap for
   full screen"); stat tiles 94% Succeeded / 11m 52s Median run / 93 Runs · 30d; section "Recent runs 248 · View all"; run rows (status glyph,
   `#248`, status word coloured, `v7 · Manual`, duration mono, chevron); Floating Prominent "Run" (iOS ink capsule 52h; Android `afab`).
   New: **MiniGraph** (read-only graph thumbnail), **StatTiles**, **RunRow** (workflow-scoped: number, version, trigger).
4. **iOS vs Android.** Header shape only; chips `mchip` (pill) vs `achip` (radius 8); run rows inset group vs tonal cards; Run capsule vs FAB.
5. **Native features.** Horizontal chip scroll; pull-down menu (see DetailMore); tap on graph → full screen (destination not designed).
6. **States / gestures.** Drawn: published workflow with one needs-you run. Not drawn: draft workflow (no runs; Run → Test run?), workflow
   with a running run, empty recent runs, loading. "View all" (per-workflow run history), "Versions" and "Tap for full screen" destinations
   are not drawn in this group (Version history appears only as a builder sheet).
7. **Data.** description ✓, stages/edges ✓, "1 approval gate" ~ (derived from `approvalRequired`), edge `when` label ✗ (today the condition
   lives on the stage, `StageCondition.expression`; P01 moves it to `EdgeSpec.when`), node positions ✗ (P01 `position`), revision / published
   by / date ✗ (P01), stats ✗, run number ✗, run version ✗ (P01 pins `definition_version_id`), trigger (Manual / Fork of #246 / Chat · name /
   Automation · name / CLI) ✗ (P04 trigger union; `ancestorRunId` ✓ gives only "Fork"), duration ~ (derivable).
8. **Issues.**
   - Mini graph at phone width: node labels already truncate ("Scan dependen…", "Apply upgra…"); readable only as a shape. Acceptable as a
     thumbnail if the whole card is one button with an accessible summary.
   - "Tap for full screen" has no board; MRunGraph is the runtime graph of a run, not the definition graph.
   - Status badge for "Published v7" is `s-idle`; desktop WF-01 uses `s-ok`. Pick one.
   - Recent-run row status words are coloured text ("Needs you" in warn) in addition to the glyph; fine (glyph + word), but the rule
     "status colour never tints a bar" is respected only because the row is not tinted.

## 3. MWorkflowDetailMore — "Workflow detail · setup, variables, menu (scrolled)"

1. **Purpose.** Same screen scrolled to Setup and Variables, with the "⋯" menu open. Presentation: pushed; menu = iOS pull-down (anchored to
   the header button), Android M3 menu.
2. **Header.** As MWorkflowDetail; the breadcrumb header stays (no large-title collapse on detail screens).
3. **Components.** Setup group rows: Versions (v7 · published Sep 22 · revision 12 · 7 versions), Project, Codebases (`payments_api` ·
   "payments-api @ main · worktree per run"), Default session ("Claude Sonnet 5 · Accept edits / No agent · effort default"),
   Post-processing (Commit → Push → PR), Workflow hooks (`on_failure` → HTTP · "Slack · secretref"), Automation ("Nightly audit · daily 02:00" ›);
   Variables 5 "asked for at launch" rows (glyph `(x)`, mono name, type · Required, "default", mono value); footnote "Change setup and
   variables in the builder, then publish v8"; Menu items: Edit in builder, Version history (v7), Duplicate as draft, Export JSON,
   separator, Delete workflow (destructive, red).
4. **iOS vs Android.** iOS menu is a glass pull-down (radius ≈ 16) with trailing icons; Android M3 menu with leading icons and the version
   `v7` as trailing text. Both put Delete in its own group at the bottom (correct for both platforms).
5. **Native features.** Pull-down / M3 menu; Export JSON → share sheet (UIActivityViewController / Android Sharesheet) or save to Files/SAF
   (not specified); Delete → Confirmation (not drawn).
6. **States.** Menu open. Not drawn: delete confirmation (and the "archive when runs exist" rule from P01), duplicate result, export result toast.
7. **Data.** Project ✓, codebases ~ (`orchestratorConfig.codebaseAliases` ✓; branch per codebase ✗), worktree per run ✓ (`useWorktree`),
   default session ~ (`harnessConfig` model/permission/effort ✓, `defaultAgentRef` ✓), post-processing ✓ (`autoCommit/autoPush/autoCreatePR`),
   workflow hooks ~ (✓ `hooks[]`, but the phases drawn — `on_failure`, `on_exit` — are P01 `onFailure/onExit`; today's phases are
   `on_run_failed` / `on_run_complete`; `secretref:` ✗ P01), linked automation ✓ (via automations filtered by `workflowDefinitionId`),
   variables ✓ (5 types today).
8. **Issues.**
   - The iOS Floating Run capsule covers the last line of the footnote on both platforms (no bottom content inset for the floating button).
   - The variable count here (5, incl. `reviewer_notes`) disagrees with MWorkflowSettings (6, incl. `ignore_packages`, `upgrade_policy`, no
     `reviewer_notes`) and with the builder row "6 variables · 2 hooks"; hooks here are 1, in MStageHooks 2 (`on_exit`, `on_failure`).
     Treat as board-data drift, but it hides a real question: does the detail show the *published* version while the builder shows the draft?
     If so, the detail must say which version it shows.
   - Menu has 6 items in 2 groups — within the "three groups at most" rule.

## 4. MWorkflowNew — "New workflow · start from a template"

1. **Purpose.** Create a workflow: choose Blank canvas / From a template / Import JSON, then pick a template. Presentation: full-screen modal
   (close X top-left), bottom-pinned Prominent "Create draft and open builder →".
2. **Header.** iOS: `gbtn` Close (X) left, centred breadcrumb "Workflows" + title "New workflow". Android: X icon + left title.
3. **Components.** Intro "New workflows start as a draft."; source choice rows (Blank canvas / From a template "18 templates, plain graphs you
   can edit." / Import JSON "A `WorkflowGraph` file, validated first."); Templates 18 + Search link; Segments All / Review / Loops / Fan-out /
   Gated; template rows (title + kind chips Loop / Check + description + "3 stages" mono + selected check); template preview card
   (Loop `fix_review` · max 5 · until approved; Fix `fix` → Review `review`; Inputs `issue_url · target_branch`); footer summary
   (Draft badge + "Issue fix with review from Fix → review until approved"); Prominent button.
   New: **TemplateRow**, **TemplatePreview**, **SourceChoice** (radio rows).
4. **iOS vs Android.** Selection = iOS filled check circle vs Android radio buttons; iOS segmented control with 5 segments vs Android connected
   button group with check; bottom button `mbtn-p` (44h, radius 22) vs `abtn-p` (≈ 48h here).
5. **Native features.** Template search (inline, destination not drawn), Import JSON → document picker.
6. **States.** From a template selected, Loops filter, first template selected. Not drawn: Blank canvas path, Import JSON path (file picked,
   validation errors), search results, loading templates, dirty-dismiss confirmation.
7. **Data.** Templates ~ (a v1 `TemplateRegistry` exists; categories Review/Loops/Fan-out/Gated ✗; loop templates ✗ — P05 presets
   `fixReviewLoop`, `testUntilGreen`, `goalLoop`, `refineUntilScore`, `researchUntilDry`, `completenessCritic`); template "inputs" ✓ (variables);
   stage count ✓; draft status ✗ (P01).
8. **Issues.**
   - Principles define a full-screen modal as "Cancel and Save in the header; no swipe to dismiss". This board uses X + a bottom primary button.
     Either amend the principle or move the action to the header (the principle's IA map does not list New workflow at all).
   - iOS HIG caps segmented controls at about 5 segments on iPhone; Review/Loops/Fan-out/Gated/All already fill 370 pt and will clip at larger
     Dynamic Type. Use a scrollable chip row or a filter menu.
   - "3 stages" for the fix → review template counts the loop container as a stage, while the created draft (MBuilderLoop) has 5 nodes
     (triage, fix_review{fix, review}, open_pr). Define whether counts include containers and children.

## 5. MWorkflowNewBasics — "New workflow · basics (scrolled)"

1. **Purpose.** Same modal scrolled: name, description, project, codebases, default session. Presentation: full-screen modal.
2. **Header.** As MWorkflowNew.
3. **Components.** Text fields Name, Description (optional, multi-line); Project picker (folder glyph + `payments-service`); Codebases
   "1 of 2 · by alias · up to 3" multi-select rows (check + branch glyph + mono alias + URL · branch + "Ready" `s-ok` badge); Default session
   "stages inherit it" rows Model / Agent (None, optional) / Effort / Permission ("Accept edits · when a run doesn't pick one"); hint "Stages can
   continue a conversation with Session reuse in the builder."; footer summary + Prominent.
4. **iOS vs Android.** iOS inset form rows with label on top and pop-up buttons (up/down chevrons, UIMenu pop-up style); Android outlined text
   fields with floating labels and exposed dropdown menus (chevron down); codebase selection check circle vs checkbox.
5. **Native features.** Keyboard for Name/Description (keyboard avoidance, return key = next), pop-up menus (iOS `UIButton` menu /
   Android `ExposedDropdownMenu`).
6. **States.** Filled form. Not drawn: validation errors (empty name, duplicate name, more than 3 codebases), codebase not ready, keyboard up.
7. **Data.** name/description ✓, project ✓, codebase aliases ✓ (`GitRepositoryConfig.alias`), codebase readiness ~ (project codebases have
   status; confirm), "up to 3" limit ✗ (no such rule in code or plan), default session ~ (`harnessConfig`; P02 `SessionSpec`).
8. **Issues.**
   - "Up to 3" codebases is a new product rule with no source in the overhaul plan.
   - Model before Agent: if an agent is picked, the model becomes "from agent" (MStageModel); order Agent → Model would match the stage
     editor.
   - "Permission · when a run doesn't pick one" is a workflow default; P02 PermissionModeSource layers make run > stage > workflow > trigger
     > posture — the hint should say that.

## 6. MWorkflowLaunch — "Workflow · Run sheet · variables and stages"

1. **Purpose.** Start a run: typed variables, stage selection with per-stage model override. Page "1 of 2" of the Run sheet.
   Presentation: sheet at the large detent over the workflow detail (iOS inset sheet `sheet-i`, Android edge sheet `sheet-a`, grabber).
2. **Header.** In-sheet: iOS `gbtn` X (aria "Cancel") + centred title "Run workflow" / subtitle "Nightly dependency audit · v7" + mono "1 of 2";
   Android X + left title + "1 of 2".
3. **Components.** Variables "5 · typed": `target_branch` (branch-glyph field "main"), `max_major_bumps` stepper (− 3 +), `dry_run` switch,
   `package_manager` pop-up (pnpm), `reviewer_notes` text field ("For the approver"); each row shows mono name + "Type · Required/default X";
   Stages "6 of 6 · clear to skip · tap for overrides": check + name + mono key + approval glyph on apply_upgrades + model pop-up per stage
   (Haiku 4.5 / Opus 5.5 / Sonnet 5); footer buttons Review plan (secondary) / Test run (disabled) / Run (Prominent) + note "Test run is for
   drafts. Published workflows run v7."
   New: **VariableForm** (typed inputs), **StageSelectRow** (skip + model override), **RunSheetFooter**.
4. **iOS vs Android.** iOS stepper = segmented − | + pill; Android = outlined − 3 + stepper; switches 51×31 vs 52×32 with thumb; pop-ups vs
   exposed dropdowns; check circle vs checkbox.
5. **Native features.** Sheet with detents and drag-to-dismiss (a dirty sheet should ask first, per principles); keyboard for text variables;
   pop-up menus; haptic selection tick on stepper/switch.
6. **States.** Valid form. Not drawn: required variable missing (Run disabled + reason), a stage cleared (skip), "tap for overrides" destination
   (per-stage overrides form), List/JSON variable inputs (types exist in MWorkflowSettings), draft workflow (Test run enabled, Run disabled),
   submitting / error / idempotent double-tap.
7. **Data.** Variables ✓ (5 types; list/json ✗ P05). Skip per stage ✓ (`StageRunOverride.skip`, client-core `stageOverrides.ts`).
   **Per-stage model override ✗** (`StageRunOverride` has agentName/contextFilter/timeout/variables/skip, no model; P04 adds `model`).
   Approval glyph ✓ (`approvalRequired`). Version pin ✗ (P01). Test run ✗ (P01/P04).
8. **Issues.**
   - "1 of 2" reads as a wizard step, yet Run is enabled on page 1 and "Review plan" is optional; call it a page indicator or drop it.
   - "clear to skip · tap for overrides": tapping the row both toggles and opens overrides? Split the check (skip) from the row tap
     (overrides) explicitly and give the overrides form a board.
   - Per-stage model pop-ups make every row a nested control inside a sheet; on Android the dropdown overlaps the next row at 1.3× font.
   - Model names here are display names ("Haiku 4.5"); the builder shows raw ids ("haiku-4-5"). Use one.

## 7. MWorkflowLaunchAdvanced — "Workflow · Run sheet · advanced (scrolled)"

1. **Purpose.** Page 1 scrolled: run options, permission mode, codebases, uploads. Presentation: same sheet.
2. **Header.** As MWorkflowLaunch.
3. **Components.** Advanced "run options": Model ("workflow default", pop-up Claude Sonnet 5), Effort (Default), Run name (placeholder
   "Nightly audit #249"), Stop after (stepper "30 min"); Permission mode "default: this device": option rows Plan (Read-only, plans first) /
   Default (Asks before edits) / Accept edits (selected) / Bypass (locked glyph, "Needs admin off this computer"); Codebases "sent with the run":
   selected `payments_api` + branch pop-up `main`; Uploads "uploaded before start": file chip `sbom-2026-09.json` with ok glyph + remove, "Add files".
   New: **PermissionModePicker** (radio list with locked option), **UploadChip**.
4. **iOS vs Android.** Radio = check circle vs radio button; locked Bypass shown dimmed with lock glyph on both.
5. **Native features.** File picker for uploads (UIDocumentPicker / SAF; camera/photos not offered); background upload before start.
6. **States.** One upload done. Not drawn: upload in progress / failed, Bypass unlocked (admin), codebase branch picker open.
7. **Data.** Run-level model/effort override ✗ (P04 `runOverrides`), run name ~ (`WorkflowRun.name` ✓ but not settable at create; P04),
   Stop after ✗ (P04 budget), permission mode ~ (`WorkflowRunPermissionMode` ✓ on the run, but not accepted at create today — W-65; P04),
   "Bypass needs admin off this computer" ✗ (P04 scope rule "bypass off-loopback requires admin:settings"), codebases ~ (`selectedCodebases`
   aliases ✓; branch/baseRef ✗ P04), uploads ~ (today `uploadRunFiles`; P04 upload ids).
8. **Issues.**
   - "default: this device" contradicts P04/PD-18 (default = deployment posture of the server). On a phone the device has no posture; say
     "default: server".
   - Effort shows "Default" only here, but the stage editor offers a fixed 5-step segment; efforts must come from the model's supported levels
     (`REASONING_EFFORTS` is 6 values, model-dependent).
   - Truncation on iOS: `sbom-2026-09...` loses the extension; allow two lines.

## 8. MWorkflowLaunchPlan — "Workflow · Run sheet · plan preview"

1. **Purpose.** Page 2: server-computed invocation plan before starting. Presentation: same sheet, pushed within the sheet (back chevron/arrow,
   aria "Back to run options").
2. **Header.** Back instead of Close; title "Plan preview"; "2 of 2".
3. **Components.** Layers "5 layers · 1 approval gate" rows L1…L5 (mono keys, approval glyph + "approval", parallel marker `‖`,
   "Conditional" `s-idle` badge); guard explanation text with inline mono; Setup rows (Codebases `payments_api @ main` worktree, Permission,
   Model · 30 min, Post-processing Commit → Push → PR); Warnings 1 "won't block the run": warn-tinted card with mono code `permission-gating`
   + stage `run_tests` + "Codex asks per command, not per tool."; footer Options (back) / Test run / Run.
   New: **PlanLayers** (mobile counterpart of desktop WF-11), **WarningCard**.
4. **iOS vs Android.** Header shape only.
5. **Native features.** In-sheet navigation stack (iOS sheet with its own nav; Android sheet page swap) — the back gesture inside a sheet must
   not dismiss the sheet.
6. **States.** One warning. Not drawn: plan loading, plan errors (blocking), skipped stages, statically-false guards, lineage.
7. **Data.** Entire plan ✗ (P04 `POST /api/workflow-invocations/plan` → `InvocationPlan`). Warning codes ✗ (P01/P02 validator + provider
   capability warnings).
8. **Issues.**
   - Board data conflict: the warning says `run_tests` runs on Codex, but the stage list (MWorkflowLaunch, MBuilderList) gives `run_tests`
     Sonnet 5. The warning must name the provider/model it comes from.
   - Warning card is fully `warn-bg` tinted; MFoundations says status colour never tints a bar. A card is allowed on desktop (Callout);
     confirm for mobile.
   - The plan should show the budget ("Stop after 30 min") explicitly; it is folded into the Model row ("· 30 min"), which reads as a model property.

## 9. MWorkflowRun — "Workflow run #248 · needs you"

1. **Purpose.** The run screen: header metrics, lifecycle strip, needs-you banner, stage timeline with the focused stage expanded.
   Presentation: pushed (from detail, Home, notifications, sidebar Needs you).
2. **Header.** Chat-and-run header. iOS: back `gbtn`, breadcrumb "Workflows › Nightly dependency aud…", title "Run #248", trailing glass capsule
   with pane toggle (count badge 3; aria "Open run pane: output, files, hooks, variables, changes, terminal, browser") and "⋯" (aria "More:
   pause, cancel, retry failed, copy run ID, export"). Android: back arrow, breadcrumb/title, pane toggle with badge, overflow ⋮.
3. **Components.** Meta line `v7 · Needs you (s-warn badge) · 12m 40s · Manual`; chips "Permission: Accept edits ⌄" (aria "Permission mode
   for this run… Change") and "42% context" (ring glyph; aria "Context used by the focused stage"); usage line "118 turns · 1.4M tokens · $3.12
   of $10" + progress bar; lifecycle strip Setup ✓ — Stages 2/6 (needs-you glyph) — Finalize pending, with "Setup · 6 phases done" and
   "Finalize · Compensate · Hooks · Commit → Push → PR · Release"; banner "Apply upgrades needs you · Completion review · round 1 of 3" +
   Prominent "Review"; "Stages 2 of 6 done" + links Graph / Events; stage rows (glyph, name, mono key, time; agent glyph + name ·
   "attempt 1 of 3 · fresh"); focused stage expanded: model · effort, "Open chat", Tool block ("Read 1 file, ran 3 commands, edited 2 files ·
   6 steps · 3m 28s"), "Completion review round 1 of 3 3m 00s", Output card ("48.2K in · 6.1K out · $0.41", summary text with mono branch,
   chips Structured / 3 files / Details); queued stages; "Notify owner · Guarded · on max_risk or test failure".
   New: **RunHeaderMeta**, **BudgetMeter** (WF-06), **ContextGauge** (WF-07), **LifecycleStrip** (compact WF-05), **NeedsYouBanner**,
   **StageRow** (WF-04), **StageOutputCard**.
4. **iOS vs Android.** Header shape; chips `mchip` vs `achip`; group vs cards. Otherwise identical.
5. **Native features.** Live updates over SSE (and a Live Activity / ongoing notification for the same run — MLiveActivity board);
   haptics only after server confirmation; pull to refresh not applicable while streaming; Tool block expands in place.
6. **States.** Drawn: needs-you (completion review). Not drawn: running (no gate), paused, failed stage with retry, cancelling, completed with
   finalize results (commit, branch, PR link), cancelled, lifecycle Setup running / failed (`setup:<phase>`), reconnecting.
7. **Data.** Run status ✓ (`awaiting_input` → Needs you via `STATUS_MAPS.stageRun`), duration ✓, run number ✗, pinned version ✗ (P01),
   trigger "Manual" ✗ (P04), permission mode ✓ on the run (change mid-run ✗ route, P03b), per-stage context % ✗ (P03b), turns/tokens/$ of
   budget ✗ (P03 budgets, P07 cost; $ only when the provider reports cost), Setup/Finalize phases ✗ (P04 `phase_started/completed`), agent ✓
   via definition, "attempt 1 of 3 · fresh" ~ (`retryCount` ✓, max from `retryPolicy.maxRetries` ✓, attempt mode ✗ P03 `stage_attempts`),
   tool block ✓ (stage session messages), review round ✗ (P01/P03 `approval.maxRounds`), per-stage tokens in/out/$ ✗, output structured/files ✓
   (`outputData`, `artifactManifest`), Guarded ~ (condition ✓; label is a presentation of Queued + guard), Events log ✗ (P07).
8. **Issues.**
   - Density: header meta + 2 chips + usage + lifecycle strip + banner take ≈ 280 pt before the first stage; on a 402 × 874 phone the focused
     stage starts below the fold at larger text sizes. Collapse the lifecycle strip once Setup is done.
   - The banner is a warn-tinted bar; MFoundations says status colour never tints a bar. Either allow it for Needs-you banners (desktop
     GateCard header is tinted) or use a bordered card with a tinted header only (the gate-card pattern).
   - "42% context" of *which* stage: the focused one is implicit; label it with the stage name in its accessibility value.
   - "Guarded" is not one of the 8 status states; it is Queued + a guard. Keep the Queued glyph and move "Guarded" to the meta line.
   - Where does "Review" go: MRunApproval (pushed screen) or the run pane Output tab (MWorkflowRunPane)? Both approve the same gate.

## 10. MWorkflowRunMenu — "Workflow run #248 · run menu (pause, cancel, retry)"

1. **Purpose.** Run-level actions. Presentation: iOS pull-down menu from "⋯"; Android M3 menu from ⋮.
2. **Header.** As MWorkflowRun.
3. **Components.** Menu section title "Pause run": Finish current turns (mono `drain`), Interrupt now (`interrupt`); Cancel run… (destructive);
   Retry failed (`fork`); Copy run ID; Export.
4. **iOS vs Android.** iOS glass menu with section header and trailing icons; Android M3 menu with leading icons and mono hints trailing.
5. **Native features.** Menu; Cancel run… → Confirmation dialog (ellipsis promises one; not drawn); Copy → pasteboard + toast; Export → share sheet.
6. **States.** Open over a needs-you run. Not drawn: menu for a paused run (Resume), completed/failed run (Retry enabled only then), cancel
   confirmation.
7. **Data.** Pause ✓ (single `user:pause`), drain vs interrupt ✗ (P03 `pause {drain|interrupt}`), cancel ✓, retry as fork ~ (retry creates a new
   run with `ancestorRunId` ✓; P03 `forkRun`, P04 `invoke {target: fork}`), export ✗.
8. **Issues.**
   - "Retry failed" is enabled on a run with no failed stage; it must be disabled or hidden by state.
   - iOS convention puts destructive items last; Cancel run… sits in the middle of the menu (Android does the same). Move it to the last group.
   - The iOS PNG shows a blurred artefact behind "Retry failed" (render glitch in the board, not a design element).
   - The mono hints (`drain`, `interrupt`, `fork`) are engine words; keep them out of VoiceOver labels.

## 11. MRunStageChat — "Run #248 · Apply upgrades as a compact chat · stage menu"

1. **Purpose.** One stage as a chat (P03b "a stage is a compact chat"): prompt, transcript, gate card, stage composer; stage menu open.
   Presentation: pushed from the run ("Open chat").
2. **Header.** Chat-and-run header; breadcrumb "Nightly dependency audit › Run #248" (the "Workflows" segment collapses), title "Apply upgrades",
   pane toggle (aria "Open run pane, 3 changes") + stage menu. Status line under the title: `Needs you · Bug Fixer` badge + "attempt 1 of 3 · fresh".
3. **Components.** Stage prompt bubble (user-side, with mono refs), agent label (Bug Fixer · Sonnet 5 · 14:08), Tool block, agent message,
   **Completion review gate card** (warn header "Completion review · round 1 of 3", body "14 packages, 3 majors · 3 files · Upgrades",
   "On approve, `run_tests` starts.", Reject (destructive text) / Request changes / Approve (Prominent)); Composer in "waiting" state
   ("Decide the review first", placeholder "Message Bug Fixer in this stage…", + attach, locked agent chip Bug Fixer, model chip Sonnet 5,
   dictate, Stop disabled — aria "Stop, disabled while the review is pending"); stage menu: Pause stage, Resume (disabled), Cancel stage
   (destructive) / Retry → Resume ("keeps turns"), Restart / Skip as completed, Copy output, Open in inspector, Re-run from here.
   New: **ReviewCard** (WF-09 on the gate-card frame), **StageComposer** (compact Composer), **StageMenu**.
4. **iOS vs Android.** Menu styling; composer glass (iOS) vs tonal (Android) per Composer states.
5. **Native features.** Keyboard + composer (input accessory), dictation (Speech framework / Android SpeechRecognizer), attachments picker,
   long-press message menu (transcript), biometric confirm on Approve if risky (see MRunApproval).
6. **States.** Waiting-for-you composer; stage menu open. Not drawn: stage running (Stop enabled, "Queue a follow-up"), stage completed
   (amend semantics PD-4: "Re-run downstream"), 409 `STAGE_BUSY` feedback, submenu interaction for Retry.
7. **Data.** Stage transcript ✓ (session messages; `turn_role` ✗ P03), gate ✓ (`interruptData` for `completion_review`), rounds ✗,
   send message to a stage ✗ (P03b `POST …/instances/:id/messages`), stage commands ✗ (P03 commands API: pause, resume, cancel,
   retry {mode}, skip {as}; P05 re-run from here), Copy output ✓ (`outputText`).
8. **Issues.**
   - Stage menu: 10 items in 4 groups (principles: three groups at most) with an inline nested "Retry ▸ Resume / Restart"; iOS supports a real
     submenu (UIMenu child) and Android M3 supports cascading menus — use them.
   - Two items both labelled "Resume" (resume a paused stage vs retry-resume keeping turns) — rename the retry one "Retry, keep turns".
   - "Open in inspector": mobile has no Inspector (the run pane flattens it into Output/Files/Hooks/Variables). Rename "Open in run pane".
   - Composer shows a model chip; desktop WF-17 StageMessageBox has **no** model/mode/effort chips (a stage's session is defined by the
     stage). Remove the model chip or make it read-only.
   - Reject is a red text button on the left, Approve ink on the right: matches MComponents gate cards; fine.

## 12. MWorkflowRunPane — "Workflow run · right pane (Output)"

1. **Purpose.** The run workspace pane, Output tab, for the focused stage, including approve controls. Presentation: right pane (iOS 356 pt,
   Android 364 dp) over a scrim with the run visible on the left.
2. **Header.** Pane header: title "Apply upgrades" + needs-you glyph, subtitle "Run #248 · apply_upgrades · stage 3 of 6 ⌃⌄" (stage switcher),
   Open full screen (aria), Close pane (aria). Tabs: Output · Files 3 · Hooks 1 · Variables · Changes 3 · Terminal · Browser (horizontally scrolling).
3. **Components.** "Proposed upgrades 14 · 3 major" + "View diff"; table rows (mono package, `dev` tag, from → to mono, Risk badge Medium
   `s-warn` / Low `s-idle`); "Show 7 more"; meta "Completion review · round 1 of 3 · requested 14:11 / On approve, `run_tests` starts";
   feedback field "Feedback for Request changes…"; Approve (Prominent, full width, with Face ID glyph on iOS / fingerprint glyph on Android),
   Request changes, Reject (destructive).
   New: **StructuredOutputView** (renders `outputData` by schema — here a table), **StageSwitcher**.
4. **iOS vs Android.** Pill tabs (`ptab-i` 32h) vs underline tabs (`ptab-a` 48h); biometric glyph differs by platform.
5. **Native features.** Pane slides from the right (swipe right closes it; button equivalent Close); full-screen expansion; biometric glyph
   signals the Approve will prompt; keyboard for feedback inside the pane.
6. **States.** Output with a pending review. Not drawn: Files / Hooks / Variables tabs for a run (the pane boards cover chat tabs), Output for a
   text-format stage, stage without output yet.
7. **Data.** `outputData` ✓ (validated JSON), rendering it as a table with "Risk" ✗ (needs schema-driven rendering hints — the schema has no
   presentation info), artifact manifest ✓, hook invocations ~ (`HookInvocationStatus` exists; per-stage list read model ✗), variables ✓,
   changes ✓ (workspace diff), approval outcome ✓ (`ApprovalOutcome`: approved | changes_requested | rejected), feedback ✓, rounds ✗.
8. **Issues.**
   - "Risk: Medium" uses the `warn` status colour for a domain value, not a state (MFoundations: colour carries state only).
   - The pane tabs drop desktop's Tools inspector sub-tab; confirm intentional.
   - Approve in the pane duplicates the ReviewCard in the stage chat and MRunApproval; all three must call one command and share one component.
   - Android glyph is a fingerprint even on face-unlock devices; the glyph must follow `BiometricManager`'s available authenticator
     (or be a neutral shield/lock).
   - Rendering an arbitrary JSON output as a table needs a rule (array of flat objects → table; otherwise JSON tree); the board implies a
     bespoke per-workflow view.

## 13. MRunApproval — "Run approval · completion review + biometric confirm"

1. **Purpose.** Full review screen for the gate, and the biometric step-up on Approve. Presentation: pushed ("Completion review" title with back);
   the OS biometric prompt over it.
2. **Header.** Breadcrumb "Nightly dependency audit › Run #248", title "Completion review", trailing "View diff" (`gbtn` / `aib`).
3. **Components.** `Needs you` badge + "Apply upgrades `apply_upgrades`"; headline "14 packages, 3 majors" (Title); agent line "Bug Fixer ·
   Claude Sonnet 5 · smoke tests 38 of 38 (ok)"; "Round 1 of 3 · requested 14:11 · on approve, `run_tests` starts"; Proposed upgrades list
   (8 rows + "Show 6 more"); Feedback field "sent with Request changes"; footer Approve / Request changes / Reject. Biometric: iOS Face ID alert
   ("Face ID", "Approve Apply upgrades?", "Verify it's you to approve 14 upgrades in run #248.", Cancel / Use passcode); Android BiometricPrompt
   bottom sheet ("GeneratorAI", title, subtitle, fingerprint icon, "Touch the fingerprint sensor", Cancel / Use PIN).
4. **iOS vs Android.** The biometric UI is system UI on both; drawn to match each OS.
5. **Native features.** **Biometric confirm for risky approvals** (LocalAuthentication `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` /
   `BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`); success haptic only after the server confirms the approve command.
6. **States.** Prompt shown. Not drawn: auth failed / cancelled (stay on screen, no command sent), server rejects (409 stale version), approved
   (success state, where does the user land), request-changes sent, round 3 of 3 (last round).
7. **Data.** Gate + outcome ✓; "smoke tests 38 of 38" ✗ (would be a structured output field or a check-stage result); rounds ✗.
8. **Issues.**
   - The iOS drawing is not the real Face ID flow: iOS shows a system Face ID HUD with only the app-supplied `localizedReason`; a custom
     title ("Approve Apply upgrades?") and a Cancel / Use passcode alert appear only after a failed match. Treat the text as the
     `localizedReason` content.
   - `apps/mobile/src/auth/stepUp.ts` caches a successful step-up for 10 minutes; the principle "risky ones ask for Face ID" per approval
     conflicts with that cache. Decide whether approvals bypass the cache.
   - What makes an approval "risky" is undefined. Candidate source: P06 risk flags (writes files, opens a PR, runs repo code) or the stage's
     capability set. It must be server data, not a client guess.
   - Principles' IA lists "Approve gate" as a **sheet**; this board is a pushed screen.

## 14. MRunGraph — "Workflow run · runtime graph (full screen)"

1. **Purpose.** Live DAG of the run: node status, edges with labels, pinch/zoom, minimap. Presentation: pushed (back + breadcrumb), despite
   the board title "full screen".
2. **Header.** Breadcrumb "Nightly dependency audit › Run #248", title "Graph", trailing "Events" (history glyph).
3. **Components.** Floating needs-you banner (glass on iOS, tonal on Android) with Prominent "Review"; canvas with dot grid; nodes 212 × 66,
   radius 14 (status glyph + name, agent line, mono key + time/status; focused needs-you node has a 1.5 px warn border + 4 px warn-bg ring);
   edges: solid (success, green when traversed), dashed red "on failure", dotted with mono label `when max_risk == 'high'`, "on success" label;
   minimap (bottom-left, status-coloured bars); zoom control (− 100% + | Fit) + hint "Pinch to zoom · drag to pan".
   New: **GraphCanvas** (read-only runtime variant), **GraphNode**, **EdgeLabel**, **Minimap**, **ZoomControl**.
4. **iOS vs Android.** iOS floating controls are glass; Android controls are tonal (verified: no glass class in the Android half).
5. **Native features.** Pinch-zoom and pan (gesture-handler pinch + pan, simultaneous), double-tap zoom (MGestures), fit-to-screen,
   tap a node → stage (not specified), haptic none (MGestures).
6. **States.** Needs-you. Not drawn: node tap destination, loop/map containers at runtime, large graphs (> 12 nodes), minimap interaction.
7. **Data.** Stages/edges + per-stage status ✓; edge labels (`when`) ✗ (P01 EdgeSpec); node positions ✗ (P01 `position`; mobile needs the same
   layout as desktop or its own layered layout); loop/map instance paths ✗ (P05).
8. **Issues.**
   - Green edges for "traversed" use the `ok` status colour on edges (bars/lines tinted by status); confirm against the foundations rule.
   - Minimap is colour-only (green/yellow/grey bars): a11y needs the glyph/word elsewhere — the minimap should be hidden from VoiceOver/TalkBack.
   - The graph must have a list alternative for screen readers (the run screen's stage list is it; say so and hide the canvas from a11y or
     expose nodes as elements in topological order).
   - The "Events" button uses the same history glyph as "Version history" in the builder.

## 15. MRunLoop — "Run · loop status + Needs decision (Issue fix with review)"

1. **Purpose.** A run parked by a loop exhaust: decision card + loop status. Presentation: pushed run screen (Run #29).
2. **Header.** Run header; breadcrumb "Workflows › Issue fix with review", pane badge 2 (aria "Open run pane, 2 changes").
3. **Components.** Meta `v3 · Needs you · 38m 12s · Stabilise checkout` (chat trigger with chat name); **DecisionCard**: warn header "Needs decision"
   + loop glyph + mono `fix_review`; "Paused · budget reached"; reason "`fix` used its 40-turn stage budget in iteration #2. The review still has
   2 open comments."; seven equal buttons Grant +1, Grant +2, Raise budget, Continue with input…, Accept, Accept iteration…, Fail (destructive);
   Stages 1 of 3 done; Triage row; **LoopGroup** "Fix and review `fix_review` 3/5 · Loop · max 5 · until approved · paused"; iteration chips
   #0 ✓ #1 ✓ #2 (paused, selected); rule rows Until `approved` ✗ "last verdict: changes", Stall `no_changes 1/2` "in a row", Carry
   `openComments 2` "from review", Budget `162/250 turns` bar `$7.40/$12`; child rows Fix (Bug Fixer · Continue · Paused), Review (Code Reviewer ·
   Fresh · changes); Open PR queued.
   New: **DecisionCard** (WF-08), **LoopGroup** (runtime), **IterationChips**, **LoopRuleRow**.
4. **iOS vs Android.** Buttons `mbtn` (44h) vs `abtn` (40h); otherwise identical.
5. **Native features.** "Continue with input…" and "Accept iteration…" open inputs (sheet with keyboard / iteration picker — not drawn);
   Fail → Confirmation (not drawn).
6. **States.** Parked on budget. Not drawn: loop running (iteration k live), completed with exitReason, other park reasons (max iterations,
   stall, pause rule), the input sheets, iteration chip tap (history per iteration).
7. **Data.** Everything loop-related ✗ (P05: `loop_iterations`, `stage_runs.loop_state`, commands `grant_iterations`, `raise_budget`,
   `continue_with_input`, `accept`, `accept_iteration`, `fail`, `loop.*` events). Session reuse Continue/Fresh ✗ (P01 `sessionReuse`).
8. **Issues.**
   - No recommended action: seven equal-weight buttons. The park reason is budget, so Grant +1/+2 (iterations) cannot help; Raise budget should
     be the Prominent action for a budget park, Grant for a max-iterations park.
   - "Grant +1" has no unit; say "+1 iteration".
   - "3/5" next to "iteration #2" mixes 1-based count and 0-based index; the overhaul exposes both `loop.iteration` and `loop.number`. Pick
     one for UI ("Iteration 3 of 5").
   - Two budgets appear (40-turn *stage* budget vs 162/250 *loop* budget); the reason names the first, the meter shows the second.
   - Overhaul P05 WP-5A.5 plans only "status rows plus the decision cards" for mobile; this board also shows carry and streak detail, which is fine
     read-only.

## 16. MBuilderList — "Builder · stage list (reorder)"

1. **Purpose.** Edit a workflow as an ordered list of stages with edge annotations; one stage mid-drag. Presentation: drawn as pushed
   (back + breadcrumb "Workflows › Nightly depende…", title "Edit workflow").
2. **Header.** iOS trailing glass capsule with Version history / Undo / Redo. Android: three `aib` icons (history, undo, redo), no overflow.
   Sub-toolbar: view switch List | Graph (iOS segmented, Android connected buttons), "Published v7" badge, "• Unsaved changes", "Save" (text button).
3. **Components.** Stage cards (index number, kind glyph, name, badge "Approval" `s-warn`, drag handle 36 × 28, mono key · agent glyph + name,
   right mono model id `haiku-4-5`); connector rail with "on success" labels; branch callouts (dashed box "→ Notify owner · when max_risk ==
   'high'", red dashed "→ Notify owner · on failure · handles failure"); note "Reached only by the two branches above"; lifted card during drag
   (rotated, shadow); "Workflow settings · 6 variables · 2 hooks ›"; bottom toolbar Add stage / Validate / Publish v8 / Run (Prominent).
   New: **StageCard** (builder), **EdgeCallout**, **BuilderToolbar**, **ViewSwitch**.
4. **iOS vs Android.** iOS bottom toolbar is one glass capsule (4 actions); Android a row of outlined buttons + filled Run. Android header shows
   3 action icons.
5. **Native features.** **Drag to reorder** (MGestures: "In the builder's edit mode, drag a handle to move a stage. Edges update on drop";
   haptic impact light on lift, selection tick per slot; button equivalent "Move up / down in the stage menu"); undo/redo (iOS also
   shake-to-undo by default — decide whether to keep it); unsaved-changes guard on back (iOS swipe-back and Android predictive back must be
   intercepted when dirty).
6. **States.** Dirty published workflow, drag in progress. Not drawn: clean state, saving, 409 revision conflict, discard-changes confirmation,
   stage tap (opens the stage editor — implied), long-press menu with Move up/down.
7. **Data.** Stages ✓, order ✓ (`order`), edge types ✓ (`StageEdgeType` on_success/on_failure/on_completion/always), `when` on edges ✗ (P01),
   `handlesFailure` ✗ (P01/P03), keys ✗ (P01), revision/unsaved/Save/Publish ✗ (P01 `PUT /:id/graph` with `expectedRevision`, `POST /:id/publish`),
   version history ✗ (P01/P07).
8. **Issues.**
   - **Reordering a DAG is ill-defined.** In P01 stages are keyed and wired by edges; list order is display only. "Edges update on drop" must be
     specified (rewire the linear chain? keep edges and only change display order?). This is the biggest semantic gap in the builder boards.
   - Android header breaks MFoundations ("max 2 icons + overflow"): three icons. Move Version history into the overflow.
   - Drag handle 36 × 28 is below the 44 pt / 48 dp minimum target.
   - "Move up / down" fallback is promised by MGestures but no stage menu exists on this board, and the stage editor menu offers only
     duplicate/delete.
   - Model ids in mono (`haiku-4-5`) vs display names elsewhere.
   - "Reached only by the two branches above" on Open PR is wrong for the drawn graph (Open PR follows run_tests on success).
   - Run with unsaved changes: which version runs? P01 WP-1.8 has "Save and run" for dirty published workflows; the toolbar shows plain Run.
   - Principles' IA marks Builder as a **full-screen modal** (↗, Cancel/Save in header, no swipe dismiss); boards draw it pushed with a back
     button. Pick one; a modal fits "unsaved changes" better.

## 17. MBuilderGraph — "Builder · graph view + Add stage"

1. **Purpose.** Graph view of the builder with a selected node, its floating action bar, and the Add stage sheet. Presentation: builder
   (as above) + sheet (medium detent) "Add stage after Apply upgrades".
2. **Header.** As MBuilderList; Graph selected in the view switch.
3. **Components.** Legend card (On success / On failure / On completion / Handles failure); zoom column (+, −, Fit); nodes 196 × 50, radius 12
   (kind glyph, name, mono key · agent); selected node 2 px `--fg` border; floating selection bar Edit (pencil) / Duplicate / Delete (red);
   edge labels; Add stage sheet: title + "after Apply upgrades", Close, search "Search stage kinds", 2 × 3 grid of kind tiles: Agent ("An agent
   turn (the default)", selected), Check (lock glyph, "Runs one allowlisted command, no LLM (admin)"), Loop, Map, Sub-workflow, Wait.
   New: **GraphCanvas** (editable variant), **SelectionBar**, **StageKindPalette** (WF-16 on mobile), **EdgeLegend**.
4. **iOS vs Android.** Sheet style; iOS zoom column glass vs Android tonal.
5. **Native features.** Pinch/pan/double-tap zoom, tap to select, sheet detents, search keyboard in sheet.
6. **States.** Node selected, sheet open. Not drawn: edge selection/editing, creating an edge, moving a node, delete confirmation or undo toast,
   empty canvas (Blank canvas start), a Map/Sub-workflow/Wait node.
7. **Data.** Stage kinds ✗ (P05: check/loop/map/subworkflow/wait; today only agent + unexecuted `iterationConfig`), Check admin gate ✗
   (P01 command-bearing fingerprint + P05 allowlist `GET /api/settings/script-allowlist`), positions ✗.
8. **Issues.**
   - **No way to create or edit edges on the phone** in any board: Add stage implies an on-success edge from the selected node; failure edges,
     `when` guards, `handlesFailure`, joins (Policy tab has Join) and multi-parent edges have no UI. Desktop WF-16 puts the edge kind first
     in the Add stage palette; mobile drops it.
   - Delete in the selection bar has no confirmation; acceptable only with an Undo toast (undo exists in the header).
   - Graph editing at 402 pt with 196 × 50 nodes is feasible for ~6–10 stages; nested loops/maps (depth ≤ 3 allowed) will not fit. Decide
     whether the phone builder supports containers beyond one level (MBuilderLoop shows one level in the list view only).
   - Legend card overlaps nodes at 100% zoom (fixed-position overlay on the canvas).

## 18. MBuilderLoop — "Builder · loop group + loop settings"

1. **Purpose.** A loop container in the list view and its settings sheet. Presentation: builder + sheet "Loop settings `fix_review`".
2. **Header.** Builder header; badge "Draft" (not published), Unsaved changes, Save.
3. **Components.** List: Triage issue (model shown instead of agent: "Claude Sonnet 5"), loop card "Fix and review `fix_review`" with badge
   "Loop · max 5 · until approved" (selected, 2 px border), nested children 1 Fix (Continue) → 2 Review (Fresh · JSON verdict) with "on success"
   rail, Open PR; toolbar Add stage / Validate / Publish / **Test run** (Prominent). Sheet: Max iterations stepper (5), Exit rules + Add rule:
   Until "→ complete · approved" `stages.review.output.verdict == 'approve'`, Stall "×2 in a row → exhaust · no_changes"
   `not loop.last.signals.workspaceChanged`; Carry `openComments = stages.review.output.comments`; Budget "250 turns · $12 ›"; On limit
   Segments Pause / Fail / Accept last / Accept best.
   New: **LoopGroup** (builder), **ExitRuleRow**, **CarryRow**, **LoopSettingsSheet** (mobile WF-18).
4. **iOS vs Android.** Segments; sheet style.
5. **Native features.** Sheet detents (medium → large to see the loop behind); expression editing with keyboard (not drawn).
6. **States.** Loop selected, settings open. Not drawn: editing an exit rule (expression editor + action + consecutive + reason), carry init,
   wrap-up, on-body-failure, output select (all in the P05 loop panel), Accept best's score expression, adding a stage inside the loop,
   "Wrap in loop" on multi-select.
7. **Data.** All ✗ (P05 `LoopStage`, `ExitRule`, `onLimit`, `carry`, `budget`); sessionReuse ✗ (P01); JSON verdict ✓ (`outputFormat: json`).
8. **Issues.**
   - The sheet shows only Until and Stall; P05's four quick rows are Until / Fail when / Pause when / Stall. Missing two.
   - Accept best requires a score expression; selecting it in a segmented control has nowhere to put it.
   - Loop children have no drag handles: can a stage be dragged into/out of a loop? (P05 `parentKey`.)
   - Test run is Prominent here (draft) and Run is Prominent in MBuilderList (published): consistent with "one ink action", good.

## 19. MWorkflowAgentDraft — "Builder · agent draft + version history"

1. **Purpose.** Review an agent-authored draft that replaces v7; version history sheet. Presentation: builder + sheet "Version history".
2. **Header.** Builder header; badges "Draft" + "Agent draft"; "Saved" + Save (disabled look).
3. **Components.** Draft banner: sparkle glyph, "Drafted by **Orchestrator** in chat "Stabilise checkout" · replaces v7", risk chips Writes files /
   Opens a PR / Runs repo code (warn-tinted pills), "+1 stage `check_licenses` (Check) · 1 changed", View diff (link), Discard, Publish v8
   (Prominent); list with diff badges "+ Added" (`add-bg`) and "Changed" (`s-idle`); Check stage row shows the command `pnpm licenses list --json`;
   edge note "on success · also from Apply upgrades". Sheet: "Agent draft · revision 13 · not published" row; versions v7 (Live · Sep 22 · by you ·
   mono hash `a41f9c2`) … v3 with multi-select checks (v7, v6 checked); buttons Diff v6 ↔ v7, Restore v6 as draft.
   New: **AgentDraftBanner** (WF-14 banner variant), **RiskChips**, **DiffBadge**, **VersionHistorySheet** (WF-10).
4. **iOS vs Android.** Check circle vs checkbox in the version list.
5. **Native features.** Sheet; diff viewer (View diff / Diff v6 ↔ v7 destinations not drawn).
6. **States.** Two versions selected. Not drawn: the diff screen, restore confirmation, Discard confirmation, publish confirmation /
   `allowAgentPublish` off message, one version selected (what do the buttons do?).
7. **Data.** All ✗: versions list + content hash (P01 `workflow_definition_versions`), agent authorship + replacesWorkflowId (P06
   `create_workflow_draft`, `authoredBy`), risk flags (P06 `describe_workflow`), diff (P07 WP-7.6), restore as draft (P07).
8. **Issues.**
   - Two Prominent (ink) actions at once: Publish v8 in the banner and Test run in the toolbar (hidden under the sheet here but present).
   - Risk chips use the warn status colour as decoration (not a state).
   - "Restore v6 as draft" with v6 and v7 both checked is ambiguous; restore should act on one selected version (row menu), diff on two.
   - The agent added a **Check** stage, which needs `admin:settings` to add (P05); the draft banner must say who can publish it.
   - The version hash (`a41f9c2`) looks like a git hash; P01 uses a content hash — fine, but label it or hide it.

## 20. MWorkflowSettings — "Workflow settings · Variables"

1. **Purpose.** Workflow-level settings, Variables tab, adding a variable with a reserved-name error. Presentation: pushed from the builder
   ("Workflow settings ›").
2. **Header.** Breadcrumb "Workflows › Nightly dependency audit", title "Workflow settings", subtitle "Default session: Claude Sonnet 5 ·
   Accept edits". Tabs General / Project / Variables 6 / Hooks 2 / Tags 3 / Budget (iOS 6-segment segmented control; Android underline tabs,
   "Budget" clipped at the edge).
3. **Components.** "Variables 6 · + Add variable"; rows mono name / type · required / mono default / chevron; inline "New variable" card with
   Cancel / Add, Name field in error (red outline, "run is reserved. Pick another name."), Type chips String, Number, Boolean, Choice, Text,
   List (selected), JSON; footnote listing reserved names ("variables, stages, run, loop, item, map, parent, child, and names starting __,
   repo_path_ or repo_branch_").
   New: **VariableEditor**, **TypeChips**, **ReservedNameHint**.
4. **iOS vs Android.** Segmented control vs scrollable underline tabs; outlined error field on Android; chips pill vs radius 8 (Android selected chip
   shows a check).
5. **Native features.** Keyboard (name field; `autocapitalize=none`, `autocorrect=off`, ASCII-capable keyboard for identifiers).
6. **States.** Reserved-name error. Not drawn: General/Project/Hooks/Tags/Budget tabs, variable detail (chevron), Choice options editor,
   List/JSON default editors, delete variable.
7. **Data.** Variables ✓ (`VariableDefinition`: string/number/boolean/choice/text); List and JSON ✗ (P05); reserved-name validation ✗ (P01
   rule; today only `__` names are blocked, W-06); workflow Budget ✗ (P01 `WorkflowSpec.budget`); Tags ✓.
8. **Issues.**
   - iOS: six segments with counts in a 370 pt segmented control at 13 px is over capacity (and fails at larger Dynamic Type). Use a list of
     sections (grouped rows → pushed pages) on iPhone, like iOS Settings.
   - Missing "Edit workflow" crumb: settings belong to the draft being edited; the breadcrumb suggests the published workflow.
   - No Save/Done: changes presumably join the builder draft (Unsaved changes). State it.
   - Error state relies on red outline + red text + ✗ glyph (ok for a11y).

## 21. MWorkflowValidate — "Builder · validation results"

1. **Purpose.** Validation results sheet over the builder list, with quick fixes. Presentation: sheet (medium/large detent).
2. **Header.** Builder; Validate button carries a badge "3".
3. **Components.** Stage cards with error count badges (`s-err` "1"), error outline on the selected card; sheet header "3 errors · 1 warning",
   Check again (aria), Close; banner (lock glyph) "Publish and Run are blocked until errors are fixed. Save still works."; issue rows: status glyph,
   stage name (or "Run test suite → Open PR" for an edge), mono code chip (`undeclared-variable`, `unknown-stage-key`, `edge-pair` in err tint;
   `permission-gating` in warn tint), message with mono refs, "Did you mean `run_tests`?", quick-fix button Declare / Replace / Go to.
   New: **ValidationList** (mobile WF-03), **IssueRow**, **QuickFixButton**.
4. **iOS vs Android.** Quick fixes are plain text buttons on iOS, outlined `abtn` on Android.
5. **Native features.** Sheet; Go to → scroll/select the stage (and close or shrink the sheet to the low detent).
6. **States.** Errors present. Not drawn: all clear ("No problems"), validating spinner, warnings only, Declare flow (pre-filled New variable).
7. **Data.** Issues ✗ today (P01 `validateWorkflow → {code, severity, path, stageKey?, message, hint?}`; P01 `POST /workflow-definitions/validate`);
   quick-fix payloads ✗ (WF-03 notes `fix?: {kind, payload}` — not in the P01 issue shape; needs adding). Codes drawn match P01
   (`edge-pair`, reference and expression checks) and P02 warnings (`permission-gating`).
8. **Issues.**
   - Android quick-fix buttons overflow the sheet's right padding (the "Declare" button touches the edge).
   - Code chips use err/warn tints on the mono code as well as the glyph: colour + glyph + word — ok.
   - Validation can run client-side (the spec package is browser-safe, zod only) — mobile can validate offline and show live counts.
   - The `permission-gating` warning names Codex while the stage runs Sonnet 5 (same board-data conflict as MWorkflowLaunchPlan).

## 22. MStagePrompt — "Stage editor · Prompt"

1. **Purpose.** Edit one stage — Prompt tab: name/key/description, context sources and mode, prompt text with variable tokens, insert-variable
   popover, inline undeclared-variable error. Presentation: pushed from the builder (tap a stage / Edit).
2. **Header.** Breadcrumb "Workflows › Nightly dependency audit", title "Assess risk", trailing "⋯" (aria "Stage actions: duplicate, delete").
   Tabs: Prompt 1 / Session / Tools 5 / Output 2 / Policy / Hooks 3 (iOS 6-segment segmented control 32h; Android underline tabs 48h).
3. **Components.** Name field + "Key · from name" mono field (`assess_risk`) + Description; Context from: token chip `scan ×` + add (aria "Add a
   predecessor"); Mode Segments Summary / Output / Structured / None; "Prompts 1 · + Add prompt"; **prompt editor** with line numbers (mono),
   inline variable tokens (`stages.scan.output.packages`, `run.codebases.payments_api.path`, `target_branch`, `max_major_bumps`) and an error token
   (`risk_threshold` in err outline); error strip (err-bg) "risk_threshold isn't declared." + Declare; editor toolbar Insert variable ⌃ (active),
   Preview, "5 refs", ⋯ (aria "Prompt actions"); popover: Variables 6 (`target_branch` String), Earlier stages `scan` (`stages.scan.output.packages`
   List), Run 3 (`run.codebases.payments_api.path` String).
   New: **PromptEditor** (token-aware text editor), **InsertVariablePopover**, **ContextFromField**, **StageEditorTabs**.
4. **iOS vs Android.** Segmented control vs underline tabs; outlined fields on Android; popover vs M3 menu surface.
5. **Native features.** **Keyboard for prompt editing** (multi-line, monospaced, no autocorrect/smart quotes in templates; input accessory
   bar on iOS / toolbar above IME on Android carrying Insert variable), text selection and insertion at cursor, `{{` trigger for autocomplete
   (P07 WP-7.6).
6. **States.** Undeclared-variable error, popover open. Not drawn: keyboard visible (the popover and the error strip must sit above it),
   Preview (rendered prompt), multiple prompts (reorder/remove), follow-up prompts (loop children, P05), file-sourced prompts.
7. **Data.** name ✓, key ✗ (P01), description ✓, context sources ✓ (`contextSources`), mode ~ (`contextFilter` full / summary-only /
   structured / none → Summary / **Output** / Structured / None; P01 renames to `context.mode summary|output|structured|none`), prompts ✓
   (`prompts[]`), `run.codebases.<alias>.path` ✗ (P01 typed system scope), template reference validation ✗ (P01 expression typecheck), Preview ✗
   (render endpoint or client-side `render.ts` from the spec package).
8. **Issues.**
   - React Native `TextInput` cannot render inline token chips; the design needs a rich text editor (see B. PromptEditor) — the heaviest
     native dependency in this group.
   - Line numbers + soft wrap: long lines wrap on a phone; line numbers must follow logical lines.
   - The Mode segment "Output" means the full raw output; "Output" is also the name of a tab. Use "Full".
   - iOS six-segment tab bar (see MWorkflowSettings).
   - Stage menu offers duplicate/delete only; MGestures says Move up/down lives in the stage menu.

## 23. MStageModel — "Stage editor · Session"

1. **Purpose.** Session tab: agent, capabilities, model, provider, effort, context window, agent mode, max turns, permission, session reuse and group.
   Presentation: stage editor (pushed).
2. **Header.** Stage editor header; Session tab selected (the file is `MStageModel`, the tab is "Session").
3. **Components.** Agent (optional) row: bot glyph, "Security Auditor" + mono `global:security-auditor`, remove × (aria "Remove agent, use a model
   only"), chevron; Customize capabilities "2 skills · 3 MCP ›"; Model "from agent" "Claude Opus 5.5" + mono `claude-opus-5-5`; Provider
   "Claude Code"; Reasoning effort Segments Default / Low / Medium / High / Extra high; Context window Segments Standard 200K / Long 1M; Agent
   mode Auto / Plan; Max turns 40; Permission "Inherit workflow · Accept edits" pop-up; warn note "Accept edits still asks before shell commands.";
   Session reuse Fresh / Continue; Session group "Optional".
   New: **AgentPickerRow**, **ModelPickerRow**, **EffortSegments**, **SessionReuseSegments** (all reusable from chat's Turn setup).
4. **iOS vs Android.** iOS: Model and Provider as separate rows; Android: Model and Provider side by side as outlined dropdowns; Max turns
   plain value (iOS) vs outlined field (Android); Session group row "Optional ›" (iOS) vs outlined text field (Android).
5. **Native features.** Pickers (the chat Model picker sheet and Agent picker — MModelPicker, MAgentPicker boards), number keyboard for Max turns.
6. **States.** Agent bound. Not drawn: no agent (model-only), model not supported by provider, Continue selected (Session group required?),
   Plan mode warnings.
7. **Data.** agentRef ✓, agentOverrides ✓ (capabilities), model ✓, provider ✓ (`harnessType`), effort ✓ (`reasoningEffort`; values
   low/medium/high/xhigh/max/ultra), context tier ✓ (`contextTier` default/long_context), agentMode ✓, maxTurns ✓, permissionMode ✓,
   sessionReuse ✗ and sessionGroup ✗ (P01; engine P03).
8. **Issues.**
   - Effort segments are fixed at 5 labels; shared types have 6 values and the picker must use the live model's supported levels. Data-driven
     segments (or a pop-up when > 4).
   - Model is listed before Provider on iOS, but the provider scopes the model list; Android puts them side by side. Choose Provider → Model or
     make Model imply Provider (as the chat picker does).
   - Max turns appears here **and** in Policy › Budget ("Max turns 40"). One field, one place (P01 has `budget.maxTurns` and `session.maxTurns`
     — the plan itself has both; the owner should decide which the UI shows).
   - Customize capabilities (2 skills · 3 MCP) duplicates the Tools tab.

## 24. MStageTools — "Stage editor · Tools"

1. **Purpose.** Tools tab: skills, MCP servers, platform tools for this stage. Presentation: stage editor.
2. **Header.** Stage editor; Tools 5.
3. **Components.** Skills "2 of 4 on" + search; rows: check + mono skill + description; locked rows "From agent" (lock glyph, disabled check);
   MCP servers "3 of 8 on · Show all 8"; Platform tools: Browser (on), Computer use (off, warn note "Blocked when the run uses Bypass"), Widgets,
   Workflows ("Run other workflows · off by default") with Switches.
   New: **CapabilityToggleRow** (check + lock-from-agent variant).
4. **iOS vs Android.** Check circle vs checkbox; iOS ink switch vs Android M3 switch with check thumb.
5. **Native features.** Search field (keyboard), switches (haptic selection).
6. **States.** Mixed. Not drawn: "Show all 8" expansion, search results, a tool blocked by the agent policy.
7. **Data.** skills ✓ (`skills`), MCP ✓ (`excludedMcpServerIds`, `mcpServers`), browser ✓ (`browserConfig`), computer use per stage ✗ (P02
   `session.computerUse`, PD-5), widgets per stage ✗ (P02), workflows tool group ✗ (P06), "From agent" ~ (resolved agent projection needed).
8. **Issues.**
   - Badge "Tools 5" but 6 items are on (2 skills + 3 MCP + Browser). Define what the count counts.
   - "Blocked when the run uses Bypass" is a warn-coloured note; fine (it is a warning).
   - Same data is summarised in Session › Customize capabilities: one of them should link to the other.

## 25. MStageOutput — "Stage editor · Output"

1. **Purpose.** Output tab: format, schema, extraction, summary, validation rules, repairs. Presentation: stage editor.
2. **Header.** Stage editor; Output 2.
3. **Components.** Format Segments Text / JSON; JSON Schema row "5 fields · Edit ›"; Extraction Segments Auto / Native / Tool / Final JSON block
   with hint "Claude Code: native structured output"; Summary Segments Auto / LLM / None; Rules 2: JSON Schema ("Output matches the schema ·
   5 fields") ×, Regex (mono `"risk":\s*"(low|medium|high)"`) ×; "+ Add rule" expanded chip palette Contains, Not contains, Min length,
   Max length, Regex, JSON Schema, Custom script (lock · Admin), Judge; "Judge: rubric, pass mark 0–10, fresh tool-less session."; Max repairs
   stepper 2 + note "A failed rule sends the reasons back to the agent before retrying."
   New: **RuleRow**, **RulePalette**, **SchemaSummaryRow**.
4. **iOS vs Android.** Segments; Android JSON Schema row as a tonal card with a document glyph.
5. **Native features.** Keyboard for rule values (regex needs a symbol-friendly keyboard with smart punctuation off).
6. **States.** JSON with 2 rules. Not drawn: **JSON Schema editor** (Edit ›), each rule's editor (Contains value, Judge rubric/threshold/model,
   Custom script command/args/env), Text format state, invalid regex.
7. **Data.** format ✓ (`outputFormat`), schema ✓ (`outputSchema`), extraction ✗ (P01/P03), summary mode ✗, rules ~ (`ResultValidationRule`
   contains / not_contains / min_length / max_length / regex / custom_script / json_schema / llm_validation → Judge is P05 `judge` with rubric,
   threshold), repairs ✗ (P03 `repair`).
8. **Issues.**
   - A JSON Schema editor on a phone is the hard part and has no board; options: a structured field list (name, type, required) that compiles to
     JSON Schema, plus a raw JSON view.
   - "JSON Schema" appears as both a rule and the schema row; adding a second JSON Schema rule must be prevented.
   - Summary Auto/LLM/None has no definition in the overhaul spec (P03 says summary turns happen only when a successor needs `summary`);
     confirm it is a real field.

## 26. MStagePolicy — "Stage editor · Policy"

1. **Purpose.** Policy tab (top): approval, join, guard, timeouts, budget. Presentation: stage editor.
2. **Header.** Stage editor; Policy.
3. **Components.** Approval switch (hand glyph; "A person approves, requests changes or rejects.") with dependent rows Allow changes (switch,
   disabled) and Max rounds (stepper 3, disabled); Join Segments All / Any / N of M + explanation "Runs when every incoming edge has fired." +
   Cancel the rest switch; Guard "Run only when (optional)" expression field `variables.dry_run == false` (keyword `false` in `--run` blue) +
   parse status "✓ Parses · boolean · reads variables.dry_run" (ok colour); Timeouts grid Attempt 10m / Idle 3m / Total 30m / Queue —;
   Budget grid Max turns 40 / Max cost $2.00 / Wall clock 30m.
   New: **ExpressionField** (with live parse), **DurationGrid**, **BudgetGrid**, **JoinSelector**.
4. **iOS vs Android.** iOS inline grid cells in one group; Android outlined fields per value.
5. **Native features.** Numeric/duration keyboard (a duration picker — UIDatePicker countdown mode / Material time input — would be more
   native than free text "10m").
6. **States.** Approval off. Not drawn: N of M (needs an N field), guard parse error, approval on.
7. **Data.** approval ✓ (`approvalRequired`), allowChanges / maxRounds ✗ (P01 `approval`), join ✗ (P01/P03), guard ~ (`condition.expression` ✓;
   typed parse ✗ — P01 Expression v2 in the browser-safe spec package), timeouts ~ (`timeoutMs` ✓ = one value; attempt/idle/total/queue ✗),
   budget ✗ (P01/P03).
8. **Issues.**
   - Syntax colouring uses `--run` (a status colour) for a literal; status colours must not decorate code. Use a code token colour set.
   - "✓ Parses" uses `--ok` for a validation result — acceptable (it is a state).
   - Disabled dependent rows when Approval is off: hide them instead (fewer controls on a phone), or explain why disabled.
   - Guard on this stage ("dry_run == false") would skip risk assessment in dry-run mode; board data only.

## 27. MStagePolicyMore — "Stage editor · Policy (scrolled)"

1. **Purpose.** Policy tab scrolled: budget, retry, exhaustion. Presentation: stage editor.
2. **Header.** As MStagePolicy.
3. **Components.** Budget grid (repeat); Retry: Retry on failure switch (on), Max attempts 3 / Initial delay 1s / Multiplier 2× / Max delay 60s,
   Jitter switch; Retry on chips Transient / Rate limit / Timeout / Provider error (multi-select, all on); Mode Segments Resume / Restart +
   "Resume keeps settled turns"; computed summary "Waits 1s, 2s, then gives up after 3 attempts."; When exhausted "After the last attempt"
   Segments Pause for a person / Fail.
   New: **RetryPolicyEditor**.
4. **iOS vs Android.** Android chips show a check when selected; **iOS selected chips have no check and look like the unselected chip fill**
   (all four are on and indistinguishable from off).
5. **Native features.** Switches, numeric inputs.
6. **States.** Retry on. Not drawn: retry off (collapsed), invalid combinations (max delay < initial).
7. **Data.** retry ~ (`RetryPolicy` maxRetries / backoffMs / backoffMultiplier ✓; maxDelay, jitter, retryOn, mode ✗ — P01 `RetryPolicyV2`),
   onExhausted ✗ (P01/P03).
8. **Issues.**
   - iOS multi-select chips need a selected state that is not colour/fill-only (a check glyph, as on Android).
   - "Max attempts 3" vs "attempt 1 of 3" on the run: consistent. The summary sentence is good and should be generated from shared code.

## 28. MStageHooks — "Stage editor · Hooks"

1. **Purpose.** Stage hooks list with one hook expanded, compensation, and the workflow hooks summary. Presentation: stage editor.
2. **Header.** Stage editor; Hooks 3.
3. **Components.** "Stage hooks 3 · + Add hook"; collapsed hook rows: leading Switch, name, chips (Pre run, Script / On error, HTTP), lock glyph,
   mono command or `secretref:slack_payments_webhook`, expand chevron; expanded "Fetch advisories": Admin only badge (`s-idle` + lock),
   delete (aria "Delete hook"), collapse; phase pop-up "Pre run"; type Segments Script / HTTP / Function; Command `pnpm` and Args `audit --json`
   (mono fields); "Env · templated values go here" `ADVISORY_BRANCH = target_branch` (token); "Command and args are literals."; Timeout 30s;
   If it fails "Skip hook" pop-up; Compensate row "Undo step if a later stage fails · + Add"; "Workflow hooks · Settings ›" with rows `on_exit`
   Clean up worktree (Script), `on_failure` Notify #payments-oncall (HTTP).
   New: **HookRow** (collapsible), **HookEditor**, **EnvTemplateRow**, **CompensateRow**.
4. **iOS vs Android.** Leading switches on both (iOS convention places switches trailing); disclosure chevron vs expand arrow.
5. **Native features.** Accordion expansion (animated), keyboard for command/args (monospace, no autocorrect), destructive delete (should confirm
   or offer undo).
6. **States.** One expanded. Not drawn: HTTP and Function type editors (URL, method, headers, body template), adding a hook, admin-locked
   editing for a non-admin (read-only state), compensate editor.
7. **Data.** HookDefinition ✓ (phase `pre_run`/`on_error`, type script/http/function, enabled, failurePolicy abort/skip/continue, timeoutMs,
   ScriptHookConfig command/args/env), templated env with literal command/args ~ (P01 rule; today command strings may contain templates),
   `secretref:` ✗ (P01), Admin only ✗ (P01 command-bearing fingerprint needs `admin:settings`), compensate ✗ (P01/P04), workflow hooks
   `on_exit`/`on_failure` ✗ names (today `on_run_complete`/`on_run_failed`).
8. **Issues.**
   - Leading switch on iOS rows is non-standard (iOS puts switches trailing); here the trailing slot holds the chevron. Consider the enable toggle
     inside the expanded editor.
   - "Admin only": on a paired phone, the device's scopes decide; a non-admin phone must see the hook read-only with the reason.
   - `secretref:` values must never be revealed; the row shows the ref name only — good.

---

## A. Workflow / run IA on mobile

```text
Sidebar › Workflows (top-level list)                                   [MWorkflows]
  ├─ Import JSON (document picker → validate → draft)                   [not drawn]
  ├─ New workflow (full-screen modal: source → template → basics)       [MWorkflowNew, MWorkflowNewBasics]
  │     └─ "Create draft and open builder" → Builder
  └─ Workflow (pushed)                                                  [MWorkflowDetail, MWorkflowDetailMore]
       ├─ ⋯ menu: Edit in builder · Version history · Duplicate as draft · Export JSON · Delete
       ├─ Versions → Version history sheet                              [only drawn inside the builder]
       ├─ Tap mini graph → definition graph full screen                 [not drawn]
       ├─ View all → run history for this workflow                      [not drawn]
       ├─ Run (floating) → Run sheet (large detent, 2 pages)            [MWorkflowLaunch/Advanced → MWorkflowLaunchPlan]
       │     └─ Run → Run screen
       └─ Recent run row → Run #N (pushed)                              [MWorkflowRun, MRunLoop]
            ├─ ⋯ run menu (pause drain/interrupt, cancel, retry, copy, export)   [MWorkflowRunMenu]
            ├─ pane toggle → Run pane (right pane, 7 tabs)             [MWorkflowRunPane]
            ├─ Review → Completion review (pushed) + biometric          [MRunApproval]
            ├─ Graph → Runtime graph (pushed)                           [MRunGraph]
            ├─ Events → run event log                                   [not drawn]
            └─ Open chat → Stage as compact chat (pushed) + stage menu  [MRunStageChat]
Builder ("Edit workflow"; drawn pushed, IA says full-screen modal)
  ├─ List view (reorder)  ⇄  Graph view (pinch/zoom, select)          [MBuilderList, MBuilderGraph, MBuilderLoop]
  ├─ Add stage → kind sheet                                             [MBuilderGraph]
  ├─ Loop → Loop settings sheet                                         [MBuilderLoop]
  ├─ Validate → validation sheet                                        [MWorkflowValidate]
  ├─ Version history (header) → sheet; agent draft banner               [MWorkflowAgentDraft]
  ├─ Workflow settings → pushed, tabs General/Project/Variables/Hooks/Tags/Budget   [MWorkflowSettings]
  └─ Stage → Stage editor (pushed), tabs Prompt · Session · Tools · Output · Policy · Hooks
                                                                        [MStagePrompt, MStageModel, MStageTools, MStageOutput,
                                                                         MStagePolicy, MStagePolicyMore, MStageHooks]
Other entries into runs: Home (Needs you / Running), sidebar Needs you / Running, notifications with Approve action,
Live Activity / ongoing notification, chat run cards (MChatWorkflowRun, other group), search/palette.
```

**Runs have no module of their own** (same as desktop): they live under their workflow. Deep links need a stable run URL
(`generatorai://…/runs/<id>`), and breadcrumbs must be reconstructible from a run alone (the run must carry its workflow name and version).

**Presentation inconsistencies to settle** (principles IA vs boards):

| Screen | MPrinciples IA | Boards |
|---|---|---|
| Builder | full-screen modal (↗), Cancel/Save in header, no swipe dismiss | pushed, back + breadcrumb, Save in a sub-toolbar |
| Approve gate | sheet | pushed screen (MRunApproval) + in-pane (MWorkflowRunPane) + in stage chat card |
| New workflow | not listed | full-screen modal with X and a bottom primary button |
| Run graph | not listed | title says "full screen", drawn pushed |
| Stage editor | pushed | pushed, but breadcrumb omits the "Edit workflow" level |

**Phone vs tablet.** No tablet board covers workflows (`MTabletIOS`/`MTabletAndroid` show chat only). Proposal, derived from the
principles (same screens, platform chrome only):
- Phone: everything above. Graph views are secondary (list is the default, per MGestures). Builder editing on the phone should be limited to
  what is drawn: add after, edit, duplicate, delete, reorder, loop settings, stage tabs. Edge editing needs a design (see D).
- Tablet (iPad / Android ≥ 600 dp): list + detail side by side; run screen with the run pane docked (not over a scrim); builder with the graph
  as the main view and the stage editor as a trailing inspector (the desktop layout), because the graph becomes usable at ≥ 1024 pt.
  This needs boards.

## B. Domain composite components

Engine note for every graph and editor below: `apps/mobile` already ships `react-native-svg`, `react-native-reanimated` 4,
`react-native-gesture-handler`, `@gorhom/bottom-sheet`, `expo-haptics`, `expo-local-authentication`, `react-native-webview`. It does not ship
Skia, a reorderable-list library, a native menu library or a rich-text editor.

| Component | Props sketch | Platform differences | Native vs JS-drawn |
|---|---|---|---|
| **WorkflowRow** | `{workflow: {id,name,tags,version,status: 'published'\|'draft', authoredBy?}, lastRun?: {number,status,at}, successRate30d?, project?, onRun}` | inset group row vs tonal card; swipe Run | RN views; swipe via gesture-handler `Swipeable`/`ReanimatedSwipeable` |
| **RunRow** | `{run: {number,status,version,trigger,durationMs}, onPress}` | group vs card | RN |
| **VersionChip** (WF-01) | `{status, version, revision?}` | badge only | RN |
| **MiniGraph** | `{graph, layout}` read-only, whole card is one button with an a11y summary ("6 stages, 1 approval gate, 2 branches") | none | SVG (static) |
| **GraphCanvas** | `{graph, layout, statusByKey?, selectedKey?, onSelect, editable, onZoomChange}` | iOS glass controls vs Android tonal | **Recommendation:** nodes as native RN `View`s (accessible, text scales), edges as `react-native-svg` paths, one Reanimated transform layer driven by pinch/pan/double-tap from gesture-handler. Skia (`@shopify/react-native-skia`) only if profiling shows jank beyond ~50 nodes; a WebView running desktop xyflow is **not** recommended (gesture conflicts with the edge-swipe back, no native a11y, no Dynamic Type). Layout must come from shared code (P01 persists `position`; otherwise a layered layout in `client-core` so desktop and mobile agree). |
| **GraphNode / EdgeLabel / Minimap / ZoomControl** | `{stage, status}`, `{edge: {on, when?, handlesFailure?}}`, `{bounds, viewport}`, `{zoom, onZoom, onFit}` | glass vs tonal | RN + SVG; minimap hidden from a11y |
| **StageRow** (WF-04) | `{stage: {key,name,agent,model,effort}, run: {status, attempt, maxAttempts, attemptMode, durationMs, guardText?}, expanded, children}` | group vs card | RN; embeds Tool block and StageOutputCard |
| **RunHeaderMeta / BudgetMeter (WF-06) / ContextGauge (WF-07)** | `{version, status, elapsed, trigger}`, `{usage: {turns,tokens,costUsd?}, budget}`, `{percent, stageName}` | chips `mchip` vs `achip` | RN; ProgressBar shared with chat's context gauge; `$` only when the provider reports cost (P07) |
| **LifecycleStrip** (WF-05 compact) | `{setup: Phase[], stagesDone, stagesTotal, finalize: Phase[]}` | none | RN |
| **NeedsYouBanner** | `{stageName, gateKind, round?, onReview}` | iOS glass (graph) vs tonal | RN |
| **GateCard / ReviewCard** (WF-09) / **DecisionCard** (WF-08) | `{kind: 'completion_review'\|'loop_decision'\|…, header, summary, actions: Command[], feedbackRequired?, risky}` | buttons `mbtn` vs `abtn` | RN; one component on run screen, pane, stage chat, approval screen, chat card, notification deep link |
| **BiometricConfirm** | `requireApproval(reason): Promise<boolean>` | LAContext vs BiometricPrompt | **Native (system UI)** via `expo-local-authentication`; separate from `stepUp.ts`'s 10-minute cache |
| **LoopGroup** (runtime + builder) / **IterationChips** / **LoopRuleRow** | `{loop: {key, max, iteration, exits: ExitRule[], streaks, carry, budget, usage, phase}, children}` | none | RN |
| **LoopSettingsSheet** (WF-18) | `{loop, onChange}`; four quick exit rows + Add rule; carry rows; budget; on-limit (+ score field when Accept best) | sheet style | RN inside the platform sheet |
| **StageMessageBox / StageComposer** (WF-17) | Composer `variant="stage"`: `{onSend, stopState, blockedReason?, agentLabel}` — no model chip | glass vs tonal | Reuse the chat Composer |
| **StageMenu / RunMenu** | `{commands: {id,label,enabled,destructive,submenu?}[]}` from the server state | iOS `UIMenu` (submenus, destructive attribute) vs M3 menu (cascading) | **Native menus** (e.g. a native menu module) or JS-drawn menus matching MComponents; decide once for the app |
| **StructuredOutputView** | `{value: unknown, schema?: JSONSchema}` → table for arrays of flat objects, else key/value tree | none | RN |
| **VariableForm** | `{variables: VariableDefinition[], values, errors, onChange}` with inputs per type (string, number stepper, boolean switch, choice pop-up, text multiline, **list**, **json**) | iOS pop-up/stepper vs Android dropdown/outlined stepper | RN; extend existing `apps/mobile/src/components/work/variableForm.ts` |
| **StageSelectRow** | `{stage, skip, modelOverride, onToggle, onOverrides}` | check circle vs checkbox | RN; override shape from P04 `stageOverrides` by key |
| **PermissionModePicker** | `{value, options: {mode, locked?, reason?}[]}` | radio vs check circle | RN; reuse `components/runs/PermissionModeSheet.tsx` |
| **PlanLayers** (WF-11) | `{plan: InvocationPlan}` | none | RN |
| **UploadChip** | `{file, progress, state, onRemove}` | none | RN + document picker (native) |
| **BuilderStageCard** + **ReorderableStageList** | `{stages, onMove(key, toIndex)}`; drag handle ≥ 44/48 target; a11y actions "Move up"/"Move down" | haptics: iOS impact light on lift + selection per slot; Android GESTURE_START / SEGMENT_TICK | gesture-handler + Reanimated (a reorderable-list library is optional); a11y custom actions on both |
| **EdgeCallout** | `{edge: {to, on, when?, handlesFailure?}}` | none | RN |
| **SelectionBar** | `{onEdit, onDuplicate, onDelete}` + Undo toast | glass vs tonal | RN |
| **StageKindPalette** (WF-16) | `{kinds: {id,label,description,locked?}[], edgeKind, onPick}` (edge kind first, as on desktop) | sheet style | RN in sheet |
| **ValidationList** (WF-03) | `{issues: {code,severity,stageKey?,path,message,hint?,fix?}[], onFix, onGoTo, onRecheck}` | text vs outlined buttons | RN; validate client-side with `@generatorai/workflow-spec` |
| **VersionHistorySheet** (WF-10) / **AgentDraftBanner** / **RiskChips** / **DiffBadge** | `{versions, draft?, selected[]}`, `{authoredBy, replaces, risks[], summary}` | check vs checkbox | RN |
| **VariableEditor** | `{definition, reservedNames, onSave}` with type chips and per-type default editors | segmented vs tabs | RN |
| **StageEditorTabs** | six tabs with counts | iPhone: replace the 6-segment control with a scrollable pill tab row (as the pane) or grouped sections; Android: scrollable underline tabs | RN |
| **PromptEditor** | `{value, tokens: TemplateRef[], diagnostics, onInsert, onChange}`; line numbers; `{{` autocomplete | input accessory (iOS) / IME toolbar (Android) | **Hardest native piece.** RN `TextInput` cannot show inline chips or colour ranges. Options: (a) a native-styled TextInput with range styling (e.g. a live-markdown-style parser module that styles `{{…}}` ranges without chips); (b) a native module on UITextView (TextKit 2 attachments) and Android `EditText` spans; (c) read view with chips + plain mono TextInput in edit mode. (a) or (c) first; the design's chip look needs (b). Parsing/validation from the spec package (`expr/parse`, `render`). |
| **ExpressionField** | `{value, scope, onChange}` → live parse/typecheck status ("Parses · boolean · reads …") | none | same editor family as PromptEditor, single line |
| **ContextFromField** | `{sources: StageKey[], mode, available}` token chips + add | none | RN |
| **CapabilityToggleRow** | `{item, on, lockedBy?: 'agent'\|'admin', warning?}` | check vs checkbox / switch styles | RN |
| **RuleRow / RulePalette / SchemaSummaryRow** + **SchemaEditor** | `{rule}`, `{types, locked}`, `{schema}`; schema editor as a field list compiling to JSON Schema + raw view | none | RN (SchemaEditor not designed) |
| **RetryPolicyEditor / DurationGrid / BudgetGrid / JoinSelector** | `{retry}`, `{timeouts}`, `{budget}`, `{join: {mode, n?, cancelRemaining}}` | grid cells vs outlined fields | RN; durations via a duration picker or validated text |
| **HookRow / HookEditor / EnvTemplateRow / CompensateRow** | `{hook, locked?, onToggle, onChange, onDelete}` | leading switch (both) | RN |

## C. Dependencies on the Workflow Overhaul (fields/endpoints that must exist first)

Per D-35 the workflow screens are built by the Workflow Overhaul; per D-36 a designed element with no API is not rendered. Mobile can
ship each screen only after the listed phase lands.

| Phase | Needed by (boards) | What mobile needs from it |
|---|---|---|
| **P01** spec v2, definitions | all builder and stage boards, Detail, New, Validate, AgentDraft, Settings | `@generatorai/workflow-spec` (browser-safe; runs in RN for client-side validate/parse/render); stage `key`; `EdgeSpec {from,to,on,when?,handlesFailure?}`; `position`; `status draft\|published`, `revision`, `PUT /:id/graph` + `expectedRevision` (409 `REVISION_CONFLICT`); `POST /:id/publish`; `GET /:id/versions[/:vid]`; `POST /workflow-definitions/validate`; `/import`, `/export`; reserved names; `run.codebases.<alias>`; `approval {allowChanges,maxRounds}`; `join`; `guard`; `timeouts`; `budget`; `RetryPolicyV2`; `onExhausted`; `output {format,schema,extraction,rules}`; `context {from,mode}`; `sessionReuse`/`sessionGroup`; `compensate`, `onExit`, `onFailure`; `secretref:`; admin fingerprint for command-bearing fields; v2 templates. Controls hidden until `ENGINE_LEVEL = 'v2'` (P03). |
| **P02** SessionComposer | MStageModel, MStageTools, LaunchPlan warnings | `SessionSpec` (provider, agent overrides, contextTier, agentMode, maxTurns, permission, computerUse, widgets); provider capability warnings (`permission-gating`, computer use blocked under bypass). |
| **P03** engine v2 | Run, RunMenu, StageChat, Approval, Policy | Commands API `POST /workflow-runs/:id/commands` (pause drain/interrupt, resume, cancel, retry {mode}, skip {as}, fail, approve {outcome, feedback}); `stage_attempts` (attempt n of m, mode fresh/resume/restart); budgets and usage; `forkRun`; approval rounds; permission mode on the run row. |
| **P03b** stage conversation | MRunStageChat, MWorkflowRun | `POST …/instances/:id/messages` (409 `STAGE_BUSY` / `INTERACTION_PENDING`, amend on completed), `turn/cancel`, gate routes; run-header permission change; per-stage context gauge; stage "…" menu contract. P03b WP-3b.4 already names mobile: reuse `Composer.tsx` in the stage transcript. |
| **P04** lifecycle + invocation | Launch, LaunchAdvanced, LaunchPlan, Run (Setup/Finalize, trigger), Detail (trigger) | `POST /api/workflow-invocations` (variables, stage overrides by key incl. model, run overrides model/effort/permission, name, budget, codebases with baseRef, upload ids, `testRun`, idempotency key); `/plan` → `InvocationPlan`; `/uploads`; `/:runId/digest`; trigger union (user/automation/chat/orchestrator/stage/external_agent/fork); lifecycle events `workflow_run.phase_*`, `finalized`; bypass-needs-admin rule. P04 WP-4.5 names mobile `StartRunSheet.tsx` (options under Advanced, codebases sent, pre-uploads, permission picker). |
| **P05** control flow | MBuilderGraph (kinds), MBuilderLoop, MRunLoop, MWorkflowNew (loop templates), MStageOutput (Judge), MWorkflowSettings (List/JSON), MRunStageChat (Re-run from here) | `check`/`loop`/`map`/`subworkflow`/`wait` kinds; `ExitRule`, `carry`, `onLimit`, loop `budget`; loop commands (`grant_iterations`, `raise_budget`, `continue_with_input`, `accept`, `accept_iteration`, `fail`); `loop_iterations` read; `loop.*` events; judge rule; `list`/`json` variable types; presets/templates; re-run from here; join/compensation UI; allowlist endpoint. Note: P05 WP-5A.5 scopes mobile to "status rows plus the decision cards". |
| **P06** agent integration | MWorkflowAgentDraft, MWorkflows (Agent draft row) | `create_workflow_draft` drafts with `authoredBy`, `replacesWorkflowId`; risk flags; `allowAgentPublish`; draft banner data; chat run/approval/draft cards (other group). |
| **P07** economy + UX | BudgetMeter `$`, AgentDraft (diff/restore), Builder (Add stage search, `{{` autocomplete), Run (Events) | provider-reported cost; version diff and restore-as-draft; raw event log per stage; run filters. |

**Not in the overhaul plan at all** (new API work, D-36 gap-matrix candidates):
- Sequential **run number** per workflow (`#248`) — used on every run surface, Home, notifications and Live Activity.
- Per-workflow **stats**: success rate and run count over 30 days, median duration, list header totals — and PD-13 drops run history at the
  engine migration, so these start empty.
- Per-workflow **last run** summary for the list.
- Template **categories** (Review / Loops / Fan-out / Gated).
- Per-stage **token in/out and cost** on the output card; per-focused-stage context %.
- Output **presentation hints** for StructuredOutputView (the "Risk" table).
- Validation **quick-fix payloads** (`fix: {kind: declare|replace|goto, payload}`) — WF-03 lists them, the P01 issue shape does not.
- **"Risky approval"** flag for biometric confirm.
- Codebase limit "up to 3" (a product rule without an owner).

## D. Open questions / conflicts for the owner

1. **Full builder on a phone.** Earlier mobile DESIGN.md said the DAG builder stays on desktop, and overhaul P05 WP-5A.5 scopes mobile to
   status rows + decision cards. These boards bring the whole builder (reorder, graph, loop settings, six stage tabs, hooks, schema, expressions).
   Confirm scope: (a) read-only builder + run on phone, edit on tablet/desktop; (b) phone edits limited to simple fields; (c) full parity as drawn.
2. **Edge editing.** No board shows creating, deleting or editing edges (on failure, `when`, `handlesFailure`, join inputs). Without it the phone
   builder cannot build the drawn workflow. Design needed, or declare edges desktop-only.
3. **Reorder semantics.** What does dragging a stage in a keyed DAG do ("Edges update on drop")? Rewire a linear chain only? Refuse when the
   stage has branches?
4. **Builder presentation.** Full-screen modal (principles) or pushed (boards)? The unsaved-changes guard, Save placement and back gestures follow
   from this.
5. **Approval surfaces.** Four places approve the same gate (run banner → MRunApproval, run pane Output, stage chat card, chat card /
   notification). Which is canonical from the "Review" button, and is MRunApproval a sheet (principles) or pushed (board)?
6. **Biometric policy.** Which approvals are "risky" (server flag? P06 risk flags?), and do they bypass the 10-minute step-up cache in
   `stepUp.ts`? What happens on a device without biometrics or passcode (stepUp resolves true today)?
7. **One ink action.** MWorkflowAgentDraft shows two Prominent buttons; MWorkflows shows an ink swipe action next to an ink Android FAB.
   Is the Android extended FAB ink (drawn) or tonal (to keep Run/Send/Approve the only filled controls)?
8. **Status colour on bars and non-states.** Needs-you banner and warning card are fully tinted; Risk Medium, capability risk chips and guard
   syntax (`--run`) use status colours for non-states. Allowed exceptions or violations?
9. **Headers.** Android builder header has 3 icons (rule: 2 + overflow). iPhone stage editor and workflow settings use 6-segment segmented
   controls (HIG ~5 max; breaks with Dynamic Type). Accept a scrollable tab row instead?
10. **Stage composer model chip.** Mobile stage composer shows a model chip; desktop WF-17 has none. Remove on mobile?
11. **Run pane.** Mobile flattens desktop's Inspector (Output/Files/Tools/Hooks/Variables) into top-level tabs and drops Tools. Intentional?
    "Open in inspector" in the stage menu has no mobile target.
12. **Duplicated fields.** Max turns in Session and in Policy › Budget; capabilities in Session › Customize and in Tools. Which one is the editor?
13. **Effort values.** Fixed five segments vs model-dependent levels (6 in shared types).
14. **Permission default wording.** "default: this device" vs the overhaul's deployment posture (server).
15. **Board data drift to resolve before implementation:** variables 5 vs 6 and hooks 1 vs 2 between Detail, Settings and Builder; `run_tests`
    model Sonnet 5 vs the Codex `permission-gating` warning; Tools badge 5 vs 6 enabled; template "3 stages" vs 5 nodes in the created draft;
    "Reached only by the two branches above" on Open PR; Retry failed enabled with no failure.
16. **Missing screens:** empty/loading/error states for every list; Import JSON flow; definition graph full screen; per-workflow run history
    ("View all"); run Events log; failed / completed (commit + PR link) / cancelled / paused runs; run-pane Files/Hooks/Variables for runs;
    stage overrides form in the Run sheet; delete/cancel/discard/publish confirmations; 409 revision conflict; JSON Schema editor; rule editors
    (Judge, Custom script); HTTP/Function hook editors; editors for check/map/sub-workflow/wait stage kinds; wait approval forms at runtime;
    map runs; keyboard-visible states for prompt/expression editing; tablet layouts.
17. **Presentation vocabulary drift vs memory.** The `mobile-visual-parity` memory says corner-rounded chips and no grey fills/pills; iOS boards
    use pill chips (`mchip` radius 16), pill buttons and a grey (`--selected`) search fill, while Android uses radius-8 chips. Confirm the boards
    supersede the memory for iOS.
18. **Version badge tone.** "Published v7" is `s-idle` on mobile, `s-ok` on desktop WF-01.
