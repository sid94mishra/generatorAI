# Design validation — every web/desktop board against the running apps (2026-10-03)

Branch `design_validation` (from `desktop_redesign` @ `4716a535`). One pass over all 60 boards in
`boards/web/`: each route was used like a user in the running app (navigation through the sidebar, palette and
links; create / edit / delete, menus, dialogs, filters, keyboard), compared with its rendered board
(`render-boards.mjs` + `side-by-side.mjs`), defects fixed in place, and `shots/<route>/DIFF.md` written.

## Method

- **Web:** isolated seeded sandbox `node scripts/redesign/sandbox.mjs --port=3497 --web-port=5497` (bare env names,
  temp DB asserted from the startup log, private `TMPDIR` so other sessions' `--clean` cannot delete it), Faux
  harness with a validation fixture adding scripted chats (3 file edits; a risky `git push` gate; a question; a
  provider error; an orchestrator spawning two workers; a long answer). A throwaway dummy repo
  (`make-dummy-repo.mjs`) was added as a project codebase through the UI; Changes / commit / push ran against it.
- **Screens:** headed Chrome (playwright-cli) at 1440×900 and 1100×760 in Instrument dark, Instrument light and
  Solarized light for every route (`<w>x<h>-<theme>-<mode>.png`), plus state shots (menus, dialogs, gates, errors).
- **Desktop:** packaged-mode Electron launched through Playwright's Electron API with an isolated profile; real
  clicks and typing; native-menu chords driven through the menu item that owns the accelerator (`shots/desktop/DIFF.md`).

## Per-board status

Status: **match** (no defect) · **fixed** (defects found and fixed in this pass) · **deviation** (decided, cites D-xx)
· **blocked** (cannot be reached here; reason given) · **reference** (not a screen; 04 §2).

| Board | Route / surface | Status | Notes (DIFF) |
|---|---|---|---|
| Home | `/` | fixed | `home` — model picker footer, initials, hover-only actions, raw JSON detail, worker count |
| Main | `/chats/:id` + Changes | fixed | `chat-dock` — gate command + decision persisted, Changes PR reason, failed turn, composer |
| ChatLight | `/chats/:id` light | match | `chat-dock` (light theme shot) |
| ChatNarrow | `/chats/:id` @1100 | match | `chat-dock` (rail + 380 sheet, icon-only tabs) |
| ChatFiles | Files dock | fixed | git-status letters in the tree |
| ChatTerminal | Terminal dock | match | web + Electron (node-pty) |
| ChatBrowser | Browser dock | match | Electron native view inside the dock |
| ChatTasks | Tasks dock (orchestrator) | fixed | `[system]` re-prompt rendered as the user's bubble |
| ChatComputer | Computer dock | blocked | computer use is off on the sandbox and needs a consenting host app; stories + earlier review cover it (D-69) |
| ChatPlan | Plan dock | blocked | the Faux harness cannot raise a plan review (FauxProvider TODO); stories cover it |
| ChatWorkflowRun | chat run / approval / draft cards | blocked | needs P06 workflow tool calls the Faux fixture cannot invoke; cards have stories (D-82) |
| ChatsList | `/chats` | fixed | `chats` — host-aware key hints |
| NewChat | New chat dialog | fixed | column labels, ⌘/Ctrl ↵ wired |
| ChatCreate | `/chats/new` | match | `chat-create` |
| ChatCreateModel | `/chats/new` (model) | deviation | strength warning has no API signal (D-36) |
| ChatCreateOrchestrator | `/chats/new` (orchestrator) | match | `chat-create` |
| ComposerStates | composer | fixed | placeholder names who answers, gauge bar, tray at narrow width |
| ComposerModelPicker | model picker | fixed | footer under the list |
| AgentPickerBoard | agent picker | deviation | customize-capabilities pane not built (D-77) |
| DockChanges | Changes dock | fixed | local-path remote reason; commit + push verified on the dummy repo |
| DockFiles | Files dock | fixed | status letters |
| DockTerminal | Terminal dock | match | |
| DockBrowser | Browser dock | match | |
| DockTasks | Tasks dock | match | (fix under ChatTasks) |
| Projects | `/projects` | fixed | `projects` — glyph, sort chip, labelled radios, path example |
| ProjectDetail | `/projects/:id/*` | fixed | `project-detail` — glyph, visible actions, root path, Logs copy, Chats count |
| ProjectCustomization | `…/customization` | match | |
| CodebaseDetail | `…/codebases/:cid` | fixed | `codebase` — Fetch in the meta card |
| Agents | `/agents` | fixed | `agents` — sort chip, footnote, Import label, card semantics |
| AgentEditor | `/agents/:id` | fixed | section order, labelled textareas, clipped labels |
| SettingsAppearance | `/settings/appearance` | match | `settings` |
| SettingsSecurity | `/settings/security` | deviation | single column (D-74) |
| (13 recipe sections) | `/settings/*` | fixed | `settings` — titles, badges, SectionHeader, Diagnostics, Agents rows |
| CommandPalette | palette | match | re-verified (query, groups, hints) |
| DesktopMac | Electron (macOS) | fixed | `desktop` — "This computer" label; 11/11 checks |
| DesktopWindows | Electron (Windows) | blocked | needs Windows (WCO strip) — CI matrix after a push |
| Pairing | pairing gate | blocked | the sandbox runs with loopback auth off, so AuthGate never shows; earlier review + stories |
| Workflows | `/workflows` | fixed | `workflows` — row glyph |
| WorkflowDetail | `/workflows/:id` | deviation | stages table, no lifecycle / median cost (D-82) |
| WorkflowRunDialog | `?run=1` | fixed | Dropzone phrase |
| WorkflowRun | `/workflows/:id/runs/:runId` | fixed | timestamps, dock tab overflow |
| WorkflowRunLoop | loop run | blocked | a loop run needs a loop definition run end-to-end by a real engine turn; builder side validated |
| WorkflowNew | `/workflows/new` | deviation | template radio grid without category tabs (D-82) |
| WorkflowBuilder | `/workflows/:id/edit` | fixed | `workflow-builder` — title width, Save with errors, Validate count |
| WorkflowStagePrompt | builder · Prompt | match | |
| WorkflowStageModel | builder · Session | match | |
| WorkflowStageTools | builder · Tools | match | |
| WorkflowStageHooks | builder · Hooks + Output | match | |
| WorkflowSettingsPanel | builder · settings | match | |
| WorkflowValidate | builder · problems | match | Declare fix verified |
| WorkflowLoopBuilder | builder · loop | match | Wrap in loop, loop inspector |
| WorkflowAgentDraft | builder · agent draft | blocked | needs P06 agent-authored drafts (D-82) |
| Automations | `/automations` | fixed | `automations` — workflow names |
| AutomationDetail | `/automations/:id` | fixed | table fit, rail stacking, plural |
| AutomationCreate | `/automations/new` | fixed | Stepper rows |
| Scripts | `/scripts` | fixed | `scripts` — "turned off" state + status API |
| Foundations, Components, Themes, ThemeInstrument, Audit | — | reference | token / kit references (04 §2); covered by the token suite and Storybook |

**Totals (60 boards):** fixed 24 · match 19 · deviation 5 · blocked 7 (ChatComputer, ChatPlan, ChatWorkflowRun,
DesktopWindows, Pairing, WorkflowRunLoop, WorkflowAgentDraft) · reference 5. The 13 undesigned Settings sections
(recipe, D-32) are counted separately: fixed.

## Defects fixed (commits on `design_validation`)

| Commit | Fix |
|---|---|
| `4d5614c8` | Kit: segmented radios inside a Field name themselves; "(optional)" spacing; initials skip punctuation; model picker footer under the list |
| `3912efb8` | Shell: dead legacy body classes removed |
| `9a2cd42c` | Key hints follow the host (registry / `modChord`); New chat ⌘/Ctrl ↵ handler; dialog column labels |
| `f81e93f3` | Projects: glyphs, sort chip, always-visible codebase actions (`alwaysShowActions` + story), root path wrap + copy, Logs copy, Fetch placement, server-OS path example |
| `99aa27ce` | Source control: a local-path remote no longer reads as host "var" (+ tests) |
| `eb649466` | Files dock: git-status letters |
| `e13eddaa` | Gate shows the command; tool-permission decisions persisted (`permissionCards`, + test); Allow's name includes its label; Home actions visible, no "+0 −0" |
| `55e02511` | Orchestrator re-prompt as a system note; worker chats out of project / weekly counts (+ route tests) |
| `44a26675`, `6c95ec7e` | Composer placeholder names who answers (`useModelLabel`); gauge bar fills; tray fits beside the dock |
| `a78800f3`, `365db897` | Settings: sentence-case titles, provider badge tones, System skill badge, SectionHeader truncation, one Refresh; Agents rows |
| `552a926c`, `e8f2c0ca` | Agents: sort chip, footnote, Import label; editor order; labelled Textareas (Field.Control); capability labels; card semantics |
| `15093589` | Workflows: row glyph, `formatWhen` timestamps, dock overflow, Dropzone |
| `83a74ecb` | Builder: title sizing, Save disabled with errors, Validate count spacing |
| `470d0d84` | Automations: workflow names, execution table fit, rail stacks when narrow, `lib/useNarrow`, DetailPage stacked spacing |
| `0ac31ff0` | Stepper marker beside the title |
| `ef9bd5ca` | Scripts: `GET /api/workflow-scripts/status`; "turned off" state; Reload errors shown (+ test) |
| `6edece04` | Desktop: embedded server labelled "This computer" |
| `3fa977dc` | Faux harness: a scripted error ends the turn (idle), no unhandled rejection |
| `49f27026` | A failed turn stays in the transcript with its error (core TurnRecorder + client-core replay, + tests) |
| `e872fb8c` | Home Needs-you detail names the command / path (+ tests) |

Decisions recorded as **D-86**. Selectors: no data-testid or role changed; new accessible names only ("Allow once
<tool>" for the gate's Allow button — the one unit test using the old name updated; "Model providers" heading — the
settings spec updated in the same commit).

## Gates (macOS, after the fixes)

| Gate | Result |
|---|---|
| web typecheck · lint · check:design | pass · 0 errors (75 pre-existing warnings) · OK |
| web unit (full) | 127 files, 1570/1570 |
| story tests (touched kit + blocks, 18 folders) | 25 files, 113/113 |
| web build · check:bundle · check:css | pass · OK · OK |
| client-core · shared · desktop unit | 790 · 447 · 445 pass |
| core `src/services` · source-control · agent-harness-providers | 489 · 65 · 769 pass |
| core full | 9 failures, all pre-existing and environmental (PtyHostAdapter real host after the desktop build's native rebuild; VoiceWorkerPool needs network) — identical on the base commit |
| e2e (`agent-tests/e2e`, sandbox :3497/:5497, `--workers=1`) | 83 passed, 4 skipped, 1 load flake (settings "Model providers" under load ~18; passes alone and in its spec 11/11) |
| desktop smokes (macOS, one at a time) | chrome 59/59 · right-pane pass · terminal pass · browser 11 pass · dock-browser pass (first run hit a chat-create race at startup, passed on rerun) |
| Electron walkthrough | 11/11 (`shots/desktop/DIFF.md`) |
| desktop-diff-review smoke | not run (spends real provider calls; last 10/10 in final review 2) |
| VRT | not run: no Docker (D-53) |

## Left open

- **Blocked boards** above: Windows/Linux chrome (CI matrix after a push), Pairing (needs an auth-required server),
  and states the Faux harness cannot produce (plan review, computer-use consent, P06 workflow tool cards, loop runs,
  agent drafts). Extending the Faux harness with `plan_review` would unblock ChatPlan on the sandbox.
- **Environment:** `pnpm --filter @generatorai/desktop build:server` stages Electron-ABI native modules into
  `apps/server/dist-bundle/node_modules`, after which `sandbox.mjs` cannot start its server under Node (better-sqlite3
  ABI mismatch). Workaround used: park that folder while the sandbox runs. Worth a sandbox guard (resolve native
  deps from the workspace, or refuse with a clear message).
- System card "Agents · 3 running" counts live harness conversations (incl. finished orchestrator workers) while
  Running is empty — consistent with the server's definition, but it reads oddly; not changed.
- Load-sensitive tests (one more instance above), P1-R7 VRT baselines — unchanged.
