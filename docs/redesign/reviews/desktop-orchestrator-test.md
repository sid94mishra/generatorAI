# Desktop orchestrator real-user test (2026-10-03)

Branch `desktop_redesign`. The desktop app (Electron, `apps/desktop`) driven like a user through orchestrator mode
with real models, the Tasks dock, worker chats and the transcript view modes on long responses; every defect found
fixed in place and re-verified in the app. Also the Home System card fix (task 1).

## Set-up

- **App:** unpackaged Electron in standalone mode (`electron .` in `apps/desktop`, embedded server run from source
  with `tsx`, renderer = `apps/web/dist`), launched with an isolated `--user-data-dir` and bare `DB_PATH`,
  `WORKSPACES_DIR`, `ARTIFACTS_DIR`, `EXTENSIONS_DIR` under the session scratchpad, `GENERATORAI_BIND_HOST=127.0.0.1`.
  The startup log's `dbPath` was asserted to be the scratchpad DB on every launch (3 launches). Embedded server on an
  OS-picked port (:57465), CDP on :9339 — none of the reserved ports.
- **Providers:** real — the logged-in Claude Code CLI and Codex. Orchestrator **Claude Sonnet 5.5** (effort medium);
  workers chosen by the orchestrator per the brief: **gpt-5.6-sol** ×4 and **sonnet** ×2.
- **Project:** a throwaway dummy repo (`make-dummy-repo.mjs`) added through New project → Add repository → Local git.
- **Driving:** Playwright over CDP against the Electron renderer: real clicks, typing (`pressSequentially`), Enter and
  ⌘↵, drag on the dock separator; screenshots at every step under `docs/redesign/shots/desktop-orchestrator/`
  (PNGs gitignored). Window 1440×870 (2× DPR).
- **Not hit:** the validation's `sandbox.mjs` / staged-native-modules issue — no `build:server` was run (the
  unpackaged app runs the server from source). The e2e sandbox did hit a different environment limit: with `TMPDIR`
  set to the (long) session scratchpad path, `tsx`'s IPC pipe path exceeds the Unix socket length and the seed step
  fails (`listen EINVAL`); worked around with a short `TMPDIR` (`/private/tmp/gaiorch`, removed afterwards).

## Scenario as run

| Step | What | Time |
|---|---|---|
| 1 | Projects → New project "Orchestrator Test" + local-git codebase `demo` (`01`–`04`) | |
| 2 | Sidebar ✎ → New chat dialog → project, include `demo`, model Sonnet 5.5, Options → Orchestrate mode → "More options — open the full page" → "An orchestrator" → task → ⌘↵ (`05`–`12`) | |
| 3 | Wave 1: feature (slugify + 9 node:test cases, gpt-5.6-sol), refactor (greet/farewell, sonnet), docs (ARCHITECTURE.md + README usage, gpt-5.6-sol), then a ≥1500-word report (`13`, `14`) | ~3 min |
| 4 | Home during/after (`15`), the three modes on the finished turn (`16`–`19`), Tasks dock → open each task → Open task chat → worker chat (`20`, `21`) | |
| 5 | Quit (SIGTERM, server shut down cleanly, no stray provider processes) → relaunch → Chats → reopen: transcript, 3 tasks, modes, worker header, dialog hand-off (`22`–`27`) | |
| 6 | Wave 2 from the composer: greet tests (gpt-5.6-sol), package.json + tsconfig (sonnet), CHANGELOG (gpt-5.6-sol), then a ≥3000-word report with 10+ sections, every `src/` file and two tables (`28`–`37`); Home/System card mid-wave (`31`); modes switched while the report streamed (`33-*`) | ~3 min |
| 7 | Long plain answers (~1500 words) to probe stick-to-bottom (`34`, `35`), then, after the fixes, steps + a long answer with Verbose/Summary/Normal cycled live (`38-*`, `39`) | ~1 min |
| 8 | Narrowed dock with Tasks selected (`40`); orchestrator create page nudge (`41`); board comparisons (`compare-*.png`) | |

Six workers in two waves, all completed; 10 files changed (+217 −3) in the dummy repo's worktree.

## Defects found → fixes

| # | Defect (as a user saw it) | Fix | Commit |
|---|---|---|---|
| 1 | Home System card "Agents · N running" counted every streaming chat (gate-blocked ones listed under Needs you, and orchestrator workers) while the Running list showed something else | One definition (D-87): the attention feed rolls working workers into their orchestrator ("2 background tasks running", opens its Tasks dock); System card + Diagnostics read `counts.running`; `SystemInfo.agents` keeps only `max`. Verified: mid-wave headline, list, sidebar and card all "1 running"; after: all 0 | `677dc91d` |
| 2 | Live orchestrator turn: "Delegated 2 tasks — 2 done" with green Done badges while all three workers were running; the third delegation fell out of the group; worker rows not nested; digests missing. Cause: Claude calls the platform tools over MCP (`mcp__generatorai-tools__spawn_background_agent`), the router and timeline compared the bare name | `isSpawnWorkerTool` / `isCheckWorkersTool` in ui-contract; router + `deriveTimeline` use them (+ tests). Verified live in wave 2: "Delegated 3 tasks — 2 running · 1 done", per-task status and Open links | `203f0628` |
| 3 | **Verbose** did not expand anything when switched on an open chat (rails only read `defaultExpandedIds` at mount) | Verbose rails are controlled: every step open unless the reader closed it, including steps that arrive while streaming; rails keyed by mode. Verified: 10 open panels on the finished turn, live steps open | `e8af5c7a` |
| 4 | **Summary** left the live turn untouched (every step shown while streaming) and the digest had no duration | Live turn in Summary: pending gates, the latest answer and "Working · N steps"; the settled digest gains the turn duration ("10 steps · 3m 2s · 1 failed"). Stories Verbose / SummaryLive / SummaryWorking | `e8af5c7a` |
| 5 | Long responses stopped auto-following mid-stream ("Jump to latest" with the report still streaming below, before any reader action). Cause: the scroll event of our own follow write arrived after the answer had grown >80px and read as "reader left the bottom" | Only a scroll UP unpins; reaching the bottom pins; programmatic writes set the baseline (+ unit test). Verified: distance to bottom stayed 0 through a streamed report while cycling all three modes | `2ae60fdf`, `08e4e006` |
| 6 | Worker chat (Open task chat) titled "⚙ feature-slugify" with no way back to the orchestrator | Breadcrumb project / orchestrator / task; the orchestrator crumb opens its Tasks dock; `displayChatTitle` shared (mobile re-exports) | `404a235b` |
| 7 | New chat dialog → "More options": the codebase included in the dialog came back "Not included" (the chat would have started in an empty workspace) | Source drafts travel with the hand-off | `486362f9` |
| 8 | Running row label "mcp__generatorai-tools__check_background_agents · …" on Home | `describeToolStep` humanizes MCP names (+ test) | `f55b3660` |
| 9 | Finished workers showed the hand glyph "Needs review" (needs_you) in the Tasks dock — the person was told to act while only the orchestrator was reading the digest | `needs_review` → `waiting` "In review" (board DockTasks), web + mobile, spec and D-87 updated | `b47a3326` |
| 10 | The selected Tasks tab was pushed into "+ 1 more" when its label grew a count — the Tasks panel showed with no visible selected tab | DockTabStrip keeps the active tab in the row on every measure (tab/dock resize, scroll). Verified with a narrowed dock | `49f7b422` |
| 11 | "Pick a powerful model" showed for a model in orchestrate mode but not for "An orchestrator" on the same balanced model | The nudge follows orchestrate mode, whoever orchestrates | `f424d111` |

## The three layout modes on a big response (after the fixes)

- **Normal** — grouped steps ("Ran 2 commands", "Delegated 3 tasks" with live per-worker status and Open), prose and
  the full answer; failed commands keep their error visible.
- **Verbose** — every step ungrouped and open with its raw input/output (and nested worker rows), live as well as
  settled; the reader can still close one.
- **Summary** — per turn the user message, a header digest ("10 steps · 3m 2s · 1 failed") and the final answer only;
  while streaming: pending gates, the latest answer and "Working · N steps".
- Ordering and content held across switches mid-stream (no lost or reordered text; the persisted turn matched the
  live one after completion and after a restart). Mode is remembered per chat across restarts.
- Cost: switching modes on the ~40k-character, 4-turn transcript takes 20–360 ms to the next frame; while a large
  markdown answer streams the renderer shows long tasks up to ~330 ms (14–19 per ~40 s). Noted below.

## Board comparison (`compare-*.png`)

- **ChatTasks** — after fix 2 the delegation group matches (header counts, per-task rows, Open in dock). Deviations
  already recorded: no "Thought for" pill content here, composer placeholder "Reply to the orchestrator…" (board
  "Queue a message…").
- **DockTasks** — list, summary bar, filters and "In review" now match. The task detail shows the digest result,
  findings, artifacts and risks; the board's "Brief", "Last steps" and "Reviewed by Orchestrator · rounds" blocks are
  not drawn (D-36: no API data for the brief/last steps on this view).
- **ChatCreateOrchestrator** — matches except the capability-groups grid (D-77) and the team list of an orchestrator
  agent (none bound here).
- **ComposerStates** — orchestrating chip with live count, stop button, context gauge as drawn.

## Gates

| Gate | Result |
|---|---|
| web typecheck · lint · check:design | pass · 0 errors (75 pre-existing warnings) · OK |
| core / server / shared / client-core / mobile typecheck | pass |
| unit: server attention + system-info, core services (489), client-core (804), shared status, mobile ChatRow/TasksList, web related (130 + 98), new `useStickToBottom` | pass |
| story tests: TurnBody (5), DockTabStrip (9) | pass |
| web build | pass |
| e2e (sandbox :3697/:5697, `--workers=1`): chats, subsystems-live, settings-dashboard-templates, navigation | 47 passed, 1 failed: `chats` "select rows and bulk-archive them" — load flake (the row checkbox click lands while the filtered list re-renders; 1 of 2 passes with `--repeat-each=2`; ChatsList untouched). composer and streaming-turn-live skip on the Faux sandbox |
| desktop smoke `right-pane-desktop-smoke.mjs` (dock) | 9/9 on rerun; the first run timed out opening the run page's dock right after a fresh-profile launch (race, not reproduced) |
| desktop-diff-review smoke | not run (the real-provider scenario above covered real turns) |
| VRT | not run: no Docker (D-53) |

## Left open

- Mode-switch and streaming-markdown long tasks (up to ~330 ms) on very large transcripts — a profiling pass on
  `AssistantText` re-render during Summary↔Normal switches is the next step.
- "Searched select:mcp__generatorai-tools__…" (the Claude ToolSearch step) shows the raw query.
- DockTasks detail without brief / last steps / review rounds (no data on that view yet).
- Load-sensitive e2e (`chats` bulk-archive) and the right-pane smoke's first-launch race, as above.
- The agent harness ran `npm test` red in wave 2 (Node type-stripping does not resolve extensionless imports) — a
  property of the dummy repo task, not the app.
