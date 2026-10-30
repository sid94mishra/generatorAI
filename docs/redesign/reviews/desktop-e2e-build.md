# Desktop end-to-end build test (2026-10-04 → 10-05)

Branch `desktop_redesign`. The desktop app (Electron) used like a person to build a complex application to
completion — project, agents, plan-mode architecture chat, Changes dock, an orchestrator with a mixed Claude/Codex
team, a workflow with a loop and an approval gate, an automation, Terminal and Browser docks — then the app's own
prompts optimised from what the run showed, and every defect fixed at its layer. Decisions **D-95…D-99**.
Screenshots: `docs/redesign/shots/e2e-build/` (PNGs gitignored).

## Set-up

- **App:** unpackaged Electron in standalone mode (`electron apps/desktop`, server from source with `tsx`, renderer =
  `apps/web/dist`), launched detached with an isolated `--user-data-dir` and bare `DB_PATH` / `WORKSPACES_DIR` /
  `ARTIFACTS_DIR` / `EXTENSIONS_DIR`, `GENERATORAI_BIND_HOST=127.0.0.1`. The startup log's `dbPath` was asserted on
  every launch (13 launches over two environments: `/private/tmp/gaie2e`, then `/private/tmp/gae2` after the first
  was removed to free disk). Embedded server on OS-picked ports (55171, 57385), CDP :9461, main-process inspector
  :9462 — none of the reserved ports.
- **Driving:** Playwright over CDP against the renderer — real clicks, typing, drag (canvas edges), ⌘↵; native-menu
  chords (⌘K, ⌘F, ⌘[, ⌘], ⌘., ⌘B) fired through the menu item that owns the accelerator (main-process inspector), since
  CDP key events never reach Electron's menu. API calls only to verify state.
- **Providers (real):** logged-in Claude Code CLI and Codex. Claude **Sonnet 5.5** (default, orchestrator, workers),
  **Opus 5.5** (Architect), Haiku as the Tech Lead's default worker model; Codex **GPT-5.6-Terra** (Frontend Dev) and
  **GPT-5.6-Luna** (Reviewer). Never GPT-5.3-Codex-Spark.
- **Throwaway projects:** `tasktracker` (fresh `git init`, local-git codebase) for the build; `notes-svc` (scaffold)
  for the prompt before/after and re-verification. Both deleted at the end.

## Scenario as run

| # | What | Result |
|---|---|---|
| 1 | New project "Team Task Tracker" + local-git codebase; Customization (skills, prompts, agents, MCP); Settings: Claude Code made default provider, default model Sonnet 5.5 | pass (fixes below) |
| 2 | Agents in the editor: Backend Dev (Sonnet), Frontend Dev (Terra), Architect (Opus, High), Reviewer (Luna, Write files off), Tech Lead orchestrator (team of 5, max 4 workers, default worker model Haiku); edit + tag | pass after fixes |
| 3 | Architecture chat (Architect, **Plan first**): plan review, inline plan comment, Request changes, revision 2, Approve with notes; permission gates (Approvals: Ask first) — allow and deny-with-reason; WP0 scaffold; Changes dock: line comment → Add & send, Keep all, generated commit message, commit; find (⌘F), Normal/Verbose/Summary, @file attach, model switch, fork | pass after fixes |
| 4 | Orchestrator "Build the tracker" (Tech Lead): WP1 → (WP2–WP7 + review) → (WP8–WP10 + reviews) → WP11 + gap fix → clean `npm ci` verification; Tasks dock, task detail, Home, Activity column | **done:** 16 workers, ~21 min after the restart, 77 files +7349 −752 |
| 5 | Workflow "Feature delivery" in the builder: Implement → Test (check) wrapped in a **loop** (until `stages.test.output.passed == true`) → Review (Reviewer agent) → **Approve** (approval wait) → Merge; variable, workflow hook, validate, publish; Run dialog; run on a real feature (task search `q`), approval from the run page | **done:** loop passed on iteration 1, review accepted (server 94 / web 15 tests), approved, committed on the run branch |
| 6 | Automation "Nightly test run" (schedule `0 2 * * *`) on a "Nightly tests" workflow (Install + `npm test` checks); Run now; execution history | ran — exposed D-99 |
| 7 | Shell: sidebar, rail, palette (entity search), Back/Forward (menu + strip buttons), Activity column docked / sidebar hidden / 1100×760 overlay + rail, inline Allow/Deny from a popover, restarts mid-work | pass after fixes |
| 8 | Completion: Terminal dock — typecheck OK, server 93/93, web 14/14, build OK; seed; `npm run dev`; `/api/health` → `{"ok":true}`; Browser dock: login (seeded user), teams, task list with URL-synced filters and overdue badges, task detail, comment, create task | **the app runs; all tests pass** |

### The built app (final state, before deletion)

npm-workspaces monorepo: `server/` (Express 5, better-sqlite3 with numbered migrations, zod contract shared with the
web, JWT auth with bcrypt and a login rate limiter, helmet, teams/members/tasks/comments, a maintenance job marking
overdue tasks and writing daily digests, seed script, 93→94 vitest+supertest tests) and `web/` (React 19 + Vite,
React Router, TanStack Query, auth context, task list with status/priority/assignee filters in the URL, detail with
comments, create/edit forms mapping server field errors, MSW-backed tests 14→15), `docs/ARCHITECTURE.md`, README,
GitHub Actions CI (Node 22/24), `.env.example`. Commits: scaffold → WP1 → WP2–WP6 → WP7 → WP8–WP10 → WP11 → task
search. **Quality notes:** architecture and code were coherent and well tested; the frontend shipped **unstyled**
(plain HTML — the plan said "CSS modules", no brief asked for styling) and the detail view shows raw enum values
(`in_progress`). CI never ran (no remote).

## Defects found → fixes

| # | Defect (as a user saw it) | Commit |
|---|---|---|
| 1 | Model picker search only searched the open provider ("terra" → "No models match" though Codex has it) | `36d7f073` |
| 2 | Picking an agent kept the dialog's default model/effort, and the session model outranks the agent's: an Opus/High Architect would run on Sonnet/Medium; no way to start in plan mode; effort read "xhigh"/"Xhigh" | `253b6579` (D-95), `8696168f` |
| 3 | The create flows never sent the chosen effort / context tier (decorative controls) | `0e726524` |
| 4 | New chat Who row: five effort levels truncated to "L. M… H. Ex… M"; agent Clear covered the chevron | `8ce66ec8` |
| 5 | The plan file counted as "1 file changed +211" (with Undo all) while Changes said 0 | `9fe7b971` |
| 6 | Plan dock showed the plan title twice | `d3461ee6` |
| 7 | No UI could make a chat ask before tools run (permission gates unreachable) | `9da546fe` (D-96) |
| 8 | "Approve & implement" notes never reached the agent; revision 1's comments re-sent with revision 2 | `61bc607b` |
| 9 | Shell gate showed raw JSON when the call had options / when the summary was cut off | `c380e6ab`, `02604c33` |
| 10 | Review-comment "Add & send" showed the XML agent prompt as the user's message | `5e9353cc` |
| 11 | Commit bar: "No git remote configured · No git remote" | `957edbb4` |
| 12 | Desktop find: typing lost focus after one character; Enter / Next restarted at match 1 (Electron `findNext` inverted + focus/selection reset) | `af7e3afc`, `fe43eee3` |
| 13 | Reading the file you just attached asked for permission | `7fed591e` |
| 14 | Fork's compare mode read "Branch vs <40-char sha>" | `7a0181e3` |
| 15 | Tasks dock rows didn't say which agent ran a worker ("WS" initials) | `16231f7b` |
| 16 | **After WP1 every further spawn was refused ("Convergence threshold met")** — dependent waves impossible; 30-min budget too short for a build | `ec623197` (D-97), `1dcb33c0` |
| 17 | A quit/restart mid-turn dropped the whole turn (only the user's message survived) | `cd3e1ea0` |
| 18 | Orchestrator's `model` overrode the bound agent's (Terra/Luna workers ran on Sonnet); the Tech Lead's max workers / default worker model were never read | `9b828f10` (D-98) |
| 19 | `check_background_agents({wait:true})` abandoned at the 120 s tool budget (and counted toward quarantine) | `3a91654f` |
| 20 | Terminal footer kept "80×24" | `07d25215` |
| 21 | Run aborted by a failing hook said only "aborted by an on_run_start hook"; On Run Start runs before codebases are mounted, unexplained | `c44bd9b7` |
| 22 | Run dialog plan preview: body stages as parallel layers, models for check/wait stages, "review: sonnet" for a Luna-bound stage, approval waits not listed | `ff92f0b0` |
| 23 | Run page: loop body stages badged "parallel(2)"; Stage prompt showed `{{ stages.… }}` raw (the engine had sent it rendered) | `8731bff5` |
| 24 | Run page: a passed check kept a loading skeleton; stage composer showed a model picker it never used | `6cf5acab` |
| 25 | Builder: renaming a stage key remounted the inspector and then reflowed it — the next click (Add prompt, Arguments) was lost and typing hit canvas shortcuts | `0740d7dd`, `6fa37a26` |
| 26 | **A failing `npm test` check completed with passed:false and the automation reported "Succeeded"** | `4a0440d9` (D-99) |
| 27 | A digest with "< TASK_RESULT>" arrived as raw JSON | `8ffeb350` |
| 28 | Claude "Default (recommended)" (= Opus 5.5) tiered Balanced/medium — the orchestrator's cheap-model heuristic picked Opus for a README | `2e927879` |
| 29 | **Claude chats lost their whole conversation on any app restart** (provider session id never persisted: idle was published before the id was recorded) | `85f5796a` |
| 30 | A turn finishing on screen left the open chat "unread" in Activity/list | `92503590` |
| — | Stale palette test after D-93; activity spec picked the seed chat | `a1e99629`, `bacaf4ca` |

## Prompt optimisation (with evidence)

Evidence from the Claude CLI transcripts of the build (they outlive the app's temp dir) and a before/after on one
task: *notes REST API (CRUD + search + README), team Backend Dev ×2 + Reviewer (Luna) + Docs Writer, Tech Lead
max 2 workers*, same scaffold, same models.

**1. Orchestrator + worker prompts (`perf(prompts)` `835c7668`).** Build transcript (63 orchestrator tool calls):
3 of 7 spawns refused by the worker cap the prompt never mentioned (and the error said "consolidate"); 2 follow-ups
because reviewer digests said "reported the fix list" without it; fixes sent to a new cold worker; the orchestrator had
to tell a worker it had already run `npm install`. Changes: refusal ≠ failure (collect the wave, then spawn), rework
goes to the worker that built it, review findings as `path:line — problem — fix` in `keyFindings`, one owner for
installs and no worker commits, acceptance (owned files + scoped commands) in briefs, the brief no longer forbids
editing the files the objective covers.

| Same task | Before | After |
|---|---|---|
| Review findings in the digest | 1 finding, no file/line | 5 findings, each `src/…:line — problem — fix` |
| Rework routing | 1 follow-up (pointer to `tasks/review/notes.md`) | 3 follow-ups, all to the original workers, scoped by file; README re-synced after the code changed |
| New workers for fixes | (build: `wp1-fixes`, `gaps-dev-cors`) | 0 |
| Docs Writer model | `default` = Opus 5.5 (fix #28) | Sonnet 5.5 |
| Orchestrator tool calls / wall time | 13 / ~5 min | 17 / ~6 min |
| Claude tool calls, all sessions / output tokens | 36 / 35.6k | 53 / 45.7k (3 rework rounds) |
| Final | 23/23 tests | 24/24 tests |

Single sample per side: the reviewer finding 5 required fixes instead of 1 is partly model variance; the structural
effects (findings format, rework routing, README resync) are the prompt's.

**2. Bundled skills (`d6c6d45e`).** code-generation / test-generation / documentation had no frontmatter: pickers
showed "System skill: code-generation" and the staged SKILL.md got "Instructions for code-generation" — nothing for a
model to route on; bodies hard-coded TypeScript strict mode and Vitest/Jest/Playwright. Now provider- and
stack-neutral with when-to-use descriptions (code-review / refactoring prompts gained descriptions too).

**3. Tool and catalogue texts tied to the fixes:** spawn `model` / `list_available_agents` descriptions (D-98), worker
`converged` only when the brief asks (D-97), hook phase descriptions (On Run Start vs Post Clone).

Not changed (observed fine): the Architect's plan-mode output (data model, contract, 11 work packages with
acceptance commands) and title/summary generation; compaction was not reached.

## Gates (macOS)

| Gate | Result |
|---|---|
| web typecheck · lint · check:design | pass · 0 errors (75 pre-existing warnings) · OK |
| web unit (full) | 1607/1610 in the full run; the 3 failures: palette test stale since D-93 (fixed `a1e99629`), 2 ChangesSurface review tests timing out under load (pass alone) |
| story tests (whole storybook project) | 617/619; CodeBlock + Markdown failed under load, pass alone (20/20) |
| web build · check:bundle · check:css | pass · OK · OK |
| core (orchestrator, plans, hooks, chat services: 50 files) · agent-harness-providers (62 files) · shared · workflow-spec · desktop | 593 · 775 · 469 · 341 · 452 pass |
| server typecheck + route tests (scm, chats, activity, attention) | pass, 72/72 (no OpenAPI test exists; the spec gained `agentRef`/`agentName`) |
| e2e (sandbox :3697/:5697, `--workers=1`): chats, composer, changes-dock, workflow-builder, workflow-run, activity-column, nav-history | 24 passed, 2 skipped (live-provider), 1 failed: the activity gate spec picked the sandbox's same-named seeded gate chat (Needs you is oldest first) — spec fixed `bacaf4ca`, then activity-column 3/3 on a fresh sandbox |
| desktop smokes (macOS, after `desktop build`): chrome · right-pane | 59/59 · all checks pass; screenshots inspected |
| dock-browser, terminal, browser smokes | not run (owner asked to limit to chrome + right-pane) |
| VRT | not run: no Docker (D-53) |

## Re-verification (fresh env `/private/tmp/gae2`, notes-svc)

- **Restart mid-work:** quitting during a streaming turn keeps the partial turn ("Stopped before the response
  finished."); after `85f5796a` a Claude chat asked "what code word did I give you?" after a restart answered
  PELICAN-42 (before the fix it had no memory of the conversation).
- **Activity column:** docked at 1440 with the sidebar open and hidden (⌘B); a pending shell gate's card opens the
  popover (Allow this command?, model, effort, workspace, waiting time) and **Deny** from the popover settles the gate
  in the transcript; at 1100×760 the column opens as an overlay over the card and live items become rail tiles.
- **Back / Forward:** Workflows → Agents → Home via ⌘[ ⌘[ ⌘] and the strip's Back / Forward buttons land on the
  expected routes. Palette (⌘K) entity search "gate demo" → Enter opens the chat.
- **Builder (D-99 + click fix):** a new check stage reads "Fail the stage on a non-zero exit" on; after renaming a stage
  key one click on Add prompt adds the prompt and the check's Arguments keep `--test test/`.

## Left open

Nothing that can be done on this machine. Two items need things this environment does not have, and are on the
owner's backlog:

- **Windows / Linux runs** of the desktop smokes and the per-OS matrix (09 §6.7): CI, after a push.
- **VRT baselines** (`pnpm vrt`): Docker.

By design rather than open: the unpackaged app's menu reads "@generatorai/desktop" (a packaged build takes
`productName`; renaming the dev app would move every developer's userData). A cheap worker model (Haiku) sometimes
"waits" with `run_in_background` and reports done early — model behaviour, not platform.

## Addendum — open items closed (2026-10-06)

Fresh isolated environment (`/private/tmp/gae3`: own `--user-data-dir`, `DB_PATH` asserted on each of 4 launches,
server on an OS-picked port), throwaway project `ping-svc` (a socket test: `listen(0)` on 127.0.0.1 + `fetch`), real
providers (Claude Haiku for the orchestrator and Ask-mode chats, Codex **GPT-5.6-Luna** for D-101).

| # | Item | Decision · commits | Evidence |
|---|---|---|---|
| 1 | Orchestrator workers did not survive a restart | **D-100** — `78d43a0b`, `4959950c`; also `a81eda41` (found here) | Spawned a worker, quit the app while it ran, relaunched: the Tasks dock showed it **Interrupted** with **Resume** (screens 315–316); Resume → running → In review, and the wave-complete nudge woke the orchestrator, which collected the digest (317–318). The restart also showed the orchestrator's partial turn twice (quit flush + boot recovery) — fixed in `a81eda41`. Unit: `OrchestratorService.restart.test.ts`, resume route over SQLite, dock model. |
| 2 | Read-only Codex reviewer could not run HTTP tests | **D-101** — `2e17dbe3` | Before: `codex sandbox -P :workspace -- npm test` → `listen EPERM: operation not permitted 127.0.0.1` (also `:read-only`). After: a GPT-5.6-Luna chat on `ping-svc` ran `npm test` → `✔ GET /ping answers pong over a real localhost socket`, pass 1 (308). Unit: thread config + per-turn `networkAccess`, off switch. |
| 3 | Browser / widget tools pre-approved in Ask mode | **D-102** — `86fa827e`, `0149b5b0` | Ask-mode Haiku chat asked to open example.com → a gate for `open_browser_page` appeared (310, 319). The first try exposed a second bug: answering after 120 s found the call abandoned by the tool budget and its question still pending (the retry then hit the one-pending-gate-per-turn index) — fixed in `0149b5b0`; re-checked by allowing after 135 s: "Tool call allowed" and the tool ran (320). Unit: `askBeforeRunning` (modes, deny, no channel, budget), golden snapshots. |
| 4 | Automations could not pick a branch | **D-103** — `c9574b03` (migration v66, OpenAPI, wizard + detail) | Wizard: Workflow step lists `app` with branch suggestions (`feature/marker`, `main`, …) (324–325); detail shows "app @ feature/marker" (326); Run now: the server cut the worktree from `feature/marker` (`git worktree add … feature/marker`; `MARKER.txt` present) and the run succeeded after the check was switched to `npm test` (run #1 failed by my own `node -e` check, which policy refuses) (327–330). Unit/route: service, zod (project required, no duplicate alias, no blank branch), form model. |
| 5 | Wrap in loop did not rewrite references | **D-104** — `bbdb615c`, `4b11ec0b` | Imported a 3-stage graph whose Review prompt reads `{{ stages.test.output.passed }}`; Wrap in loop on Test → prompt became `stages.loop_1.output.last.test.passed`, **Workflow is valid** (335). The first version wrote `…last.test.output.passed`, which the validator refused (334) — `last.<key>` is the output itself; fixed in `4b11ec0b`. Unwrap → `stages.test.output.passed`, valid (336). Unit: `stageRefs.test.ts`, store wrap/unwrap. |
| 6 | Mobile parity for D-95 / D-96 | `5c95e41f` | `mobile/reviews/PENDING.md` **MV-41** (create flow: agent model/effort, effort/context tier sent, Plan first, effort labels; composer Approvals → `PATCH /chats/:id/permission-mode`) and **MV-42** (D-99/100/103/104 contract changes); `COORDINATION.md`: migration v66 taken, next mobile migration v67. |

**Gates (macOS):** web typecheck · lint (0 errors) · check:design · full web unit 1614/1614 · web build ·
check:bundle · check:css; core 1834 · workflow-spec 344 · shared 469 · providers 776 · client-core 829 · db 169 ·
server 713 + background-task and automation route tests; migrations lock + DB baseline v66; e2e on a fresh sandbox:
chats, workflow-builder, workflow-run, workflows-crud, automations 31/31, then builder + chats again after the D-104
correction 18/18; desktop smokes chrome 59/59 and right-pane (all checks) on a fresh isolated profile. No OpenAPI test
exists; the spec documents the resume route and `Automation.codebases`.

## Final addendum — desktop work complete (2026-10-06)

The owner's last list, each verified in the desktop app (isolated profiles and DBs, `DB_PATH` asserted on every
launch, real Claude Haiku / Codex providers, throwaway repos) and committed per fix.

| Item | Decision · commits | Evidence in the app |
|---|---|---|
| `open_browser_page` failed with the Browser dock closed | **D-105** — `94304ca4`, `ecf1c1a7`, `e07a95b4` | A fresh chat with the dock closed: the server asks main over IPC, main opens a hidden agent tab in a never-shown window (1280×800), and open + read + **screenshot** succeed ("Example Domain"; screens 340–343). A view hidden in, or placed outside, the app window rendered at 0×0, so screenshots failed until the agent tab moved into its own window. Opening the Browser dock afterwards shows the agent's page and the agent tab is destroyed (345). The never-loaded agent window page stalled CDP clients; it loads `about:blank`. |
| Every shell gate "Risky" | **D-106** — `ed2a5f9e` | Ask-mode chat: `touch note.txt` → no badge; `git push origin main` → **Risky** (350–351). Unit: 20+ command cases, JSON / cut-off summaries, unreadable command stays risky; mobile Vitest 1108/1108 with the shared change. |
| "Allow this command?" with the raw type `other` | **D-107** — `575eb57e` | Cards read "Run this command? · Shell command" and "Open a page in the browser? · Browser" (350–352); the Needs you summary and Activity use the same words; the payload carries `title` / `kindLabel` for mobile. |
| Skipped smokes | — | dock-browser (all checks), terminal (all checks), browser (all checks), each alone on a fresh isolated profile. |
| Step group nested itself on expand (parent session `039619a0`) | — | Normal: "3 browser actions" expands to Opened browser · Took screenshot · Read page, once (346); Verbose lists them flat; Summary collapses to "4 steps". |

Found and fixed while re-verifying the items the earlier addenda listed as unit-tested only:

| Defect (seen in the app) | Commit |
|---|---|
| A chat in a one-codebase project started in an empty workspace (**D-108**: the only codebase is included) | `a830449c` (360) |
| The run header read "0 turns · 0 tokens" mid-turn — now "Usage after the first turn" | `b439bff7` |
| Terminal footer stayed 80×24 (the `ready` frame overwrote the fitted size) — now matches `stty size` (63×33) | `0c557873` (363–364) |
| A queued stage's prompt rendered unfinished references empty ("Tests passed: .") and an exhausted loop's last iteration read "#1 running" | `6bd9d90b` (367–370) |
| An imported workflow lost its `lifecycle.codebaseAliases` (the create overwrote them with an empty field) | `9aca7779` (371) |
| Activity spec flaky (Esc closed a card's popover first) | `e3dd38ce` |

Also re-checked in the app, no change needed: the attached-file read ran with no gate in Ask mode (361); a turn that
finished on screen left no unread dot (362); the run page's loop body has no "parallel" badge, a finished check shows
no loader, and the stage composer has no model picker (367–369).

**Final gates (macOS):** web typecheck · lint (0 errors) · check:design · full web unit 1624/1624 · story tests for
the touched blocks · web build · check:bundle · check:css; shared 476 · client-core 829 · core 1836 · workflow-spec
344 · providers 776 · db 169 · desktop 455 · server 713; mobile Vitest 1108 (read-only, shared changes); migrations
lock + DB baseline v66; full e2e suite on a fresh sandbox **89 passed, 4 skipped** (live-provider specs; an earlier
run's activity-column flake was fixed in `e3dd38ce`, then 3/3 alone and green in the suite); desktop smokes chrome
59/59, right-pane, dock-browser, terminal, browser — all pass. diff-review (real provider) not run (optional).
