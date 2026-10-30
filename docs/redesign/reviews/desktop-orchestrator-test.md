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

---

## Addendum — follow-up pass (2026-10-04)

Owner requests after the first pass: the three items left open, plus smooth streaming / scrolling and a
provider-neutral composer. Same set-up (desktop app, isolated profile/DB with the asserted `dbPath`, real Claude Code
and Codex logins, a throwaway dummy repo), plus a Faux-scripted perf profile for repeatable measurements:
`agent-tests/perf/fixtures/orchestrator-report.mjs` — one chat streaming a ~4,000-word report (12 sections, two
tables, four code blocks, lists) after 12 tool steps; `--chunk=30` delivers it in provider-like bursts.

**How it was measured.** Production web build inside Electron; CDP CPU profiles mapped through the build's source
maps; PerformanceObserver `longtask`, `layout-shift` and `long-animation-frame`; a rAF probe recording per frame the
scroll movement, the distance from the bottom and the characters revealed; Event Timing for trusted clicks. Viewport
1100×760 by CDP device-metrics emulation (Electron has no `Browser.setWindowBounds`). Web = headed Chrome against an
isolated sandbox (Vite dev). Frame-by-frame screenshot sequences: `shots/desktop-orchestrator/seq/<tag>-NN.png`.
The machine also ran another agent's iOS simulators and Android emulator, so single runs are noisy; numbers below are
medians or per-run values as noted.

### 1. Rendering cost (D-88) — `c010930d`

Hot paths found (production profiles of the 4,000-word stream):
- **The whole answer re-parsed every frame**: Streamdown keeps a document as one block when it sees `[^label]`, and
  it looked inside code — the report's `replace(/[^a-z0-9]+/g, '-')` made 25 KB one block. Markdown parse was 10.9 s
  of a 28 s stream. Fixed by masking code before splitting (`ui/patterns/Markdown/markdownBlocks.ts` + test): 1.1 s.
- **Shiki on the main thread**: the first TypeScript fence cost 0.3–0.4 s of grammar compilation, mid-stream. Now a
  module worker + result cache (remounted blocks paint at once).
- **Mode switch remounted and re-derived**: Summary rendered the answer outside `TurnBody` (remount + re-parse of the
  final answer, every code block re-highlighted) and recomputed every turn's digest. Summary now renders through the
  same `TurnBody`; the digest is counted from the derived segments; the view mode is a deferred value.
- **End of stream**: a second whole-document parse (`mode="static"`) and the live → persisted swap — blocks stay;
  the transcript's turns are a deferred value and the finished live turn stays until its persisted message rendered.

| Per-word fixture, 3 runs each | Before | After |
|---|---|---|
| Long tasks > 50 ms while streaming | 31 / 33 / 39 (max 194 / 247 / 463 ms) | 2 / 1 / 3 (max 132 / 79 / 66 ms) |
| Mode switch, click → painted frame p95 | 177 / 220 / 241 ms | 58 / 33 / 35 ms |

Final state (bursty fixture, all fixes including item 4): long tasks 2 / 2 / 1 (max 61 / 110 / 50 ms); mode switch
p95 35 / 43 / 36 ms (two-frame floor ~33 ms). Event Timing for trusted clicks reports 48–56 ms p95 — processing ≤ 2 ms,
the rest is presentation delay to the next composited frame. The perf spec `agent-tests/perf/transcript-stream.spec.ts`
(reporting, generous fences) and the `markdownBlocks` unit test guard regressions.

### 2. Tool-search label — `35372874`

"Searched select:mcp__generatorai-tools__list_models,…" now reads **"Loaded tools List models, Delegate, Check tasks,
Message task, Check task"**; orchestrator bookkeeping rows read "List models" / "Check tasks" (shared
`toolDisplayName`, `isToolSearchTool`, `toolSearchTarget` in ui-contract — web and mobile, unit-tested). Home's Running
row uses the same names (`f55b3660`, `fd517842`).

### 3. Task detail: brief, review rounds, last steps (D-89) — `65ec9354`, `6b2a031f`

`GET /chats/:id/background-tasks/:taskId/detail` (OpenAPI, shared type, client-core call + read model) reads the
worker chat's persisted messages. The Tasks dock detail now shows, in the board's order, **Review** ("Reviewed by the
orchestrator · accepted · 1 of 3 review rounds" + "Round 1 asked for: …"), **Brief** (objective, out of scope),
**Last steps** (the transcript's own step rows) and **Result**; mobile's task detail the same. Verified with a real
run where the orchestrator sent the docs worker one follow-up (`final-08-docs-detail.png`), and again after a restart
(`final-09`, `final-13`). The restart pass also found that every worker's **Result** read "Unknown task <id>" after a
restart — the digest now falls back to the persisted messages (`6b2a031f`).

### 4. Smooth streaming and scrolling (D-91) — `4a8df4e9`

Causes found: text painted as it arrived (Sonnet in ~50-char, Sol in ~20-char, the Faux fixture in 400–600-char
bursts on 7 % of frames); one scroll write per burst (jumps of 100–160 px); the run page not following at all (the
reader fell 800–2,700 px behind); a spinner row under the text moving with every line (most of the layout-shift score);
a clamp from shrinking content read as "the user scrolled up"; under load, a deferred markdown source skipped frames and
then committed bursts. Approach after StackBlitz's [use-stick-to-bottom](https://github.com/stackblitz-labs/use-stick-to-bottom)
(velocity spring, ResizeObserver, user-intent detection) and the AI SDK's [smoothStream](https://sdk.vercel.ai/docs/ai-sdk-ui/smooth-stream-japanese)
(word-granular smoothing): a shared pacer (client-core), a colour-only reveal fade (CSS Custom Highlights), a spring
follow, no spinner under a streaming answer.

| Surface (desktop unless noted) | Max scroll jump px/frame | Jumps > 60 px | Layout-shift sum | Long tasks (max) | Frames revealing text · max chars/frame |
|---|---|---|---|---|---|
| Faux report 1440 | 160 → 17 | 25 → 0 | 0.096 → 0.005 | 0 → 1 (53 ms) | 50 of 713 · 580 → 716 of 718 · 32 |
| Faux report 1100 | 142 → 13 | 5 → 0 | 0.060 → 0.005 | 2 (94 ms) → 0 | 11 of 691 · 380 → 719 of 721 · 30 |
| Sonnet 5.5 chat 1440 | 143 → 12 | 5 → 0 | 0.136 → 0.007 | 3 (301 ms) → 0 | 268 · 111 → 826 · 29 |
| Sonnet 5.5 chat 1100 | 103 → 11 | 9 → 0 | 0.207 → 0.045 | 6 (90 ms) → 0 | 162 · 90 → 814 · 21 |
| GPT-5.6-Sol chat 1100 | 59 → 7 | 0 → 0 | 0.305 → 0.002 | 1 (80 ms) → 0 | 405 · 40 → 497 · 21 |
| Worker chat (Sol) 1440 | 37 → 5 | 0 → 0 | 0.149 → 0.001 | 0 → 0 | 468 · 50 → 566 · 17 |
| Workflow stage output 1440 | no follow (gap 796) → follows, 9 | 0 → 0 | 0.108 → 0.68 ¹ | 1 (52 ms) → 0 | 133 · 75 → 848 · 26 |
| Workflow stage output 1100 | no follow (gap 2,683) → follows, 18 | 0 → 0 | 0.055 → 1.15 ¹ | 1 (121 ms) → 1 (66 ms) | 186 · 95 → 816 · 26 |
| Web (Chrome) Faux 1440 | 102 → 27 | 2 → 0 | 0.215 → 0.008 | 0 → 0 | 193 · 292 → 712 · 41 |
| Web (Chrome) Faux 1100 | 102 → 22 | 1 → 0 | 0.090 → 0.019 | 5 (69 ms) → 0 | 46 · 73 → 701 · 44 |

¹ On the run page the stage composer and footer sit inside the scroller below the output; while the view follows they
glide with the spring, and the Layout Instability API counts that motion (sources: `composer`, the run footer, the
caret). In the chat the composer is outside the scroller, which is why the chat's score went down. No jumps either way.

As a user: the answer now rolls in a few words per frame and the newest words settle in; the view glides with it; a
scroll up stops following at once and "Jump to latest" glides back; switching mode or scrolling away shows everything
that arrived; the end of a turn catches up within 250 ms; reduced motion reveals in steps with no fade.

### 5. Provider-neutral composer (D-90) — `398fad7a`

"Message Copilot…" / "Message Claude Code…" → **"Ask anything — @ for files, / for skills"** (no workspace: "Ask
anything — / for skills"); "Reply to <agent>…" and "Reply to the orchestrator…" stay; the empty chat reads "Type a
message below to start." Web and mobile from one ui-contract helper; web textbox name and `chat-input*` ids unchanged.

### Also found and fixed in the final pass

- `64a53d04` — ⌘/Ctrl ↵ in the New chat dialog with focus on "Orchestrate mode" flipped the switch instead of
  starting the chat (the switch took the Enter). Both create flows take the chord in the capture phase.
- `fd517842` — Home's Running row said "check_background_agents · 2 background tasks running" → "Check tasks · …".

### Final real-user pass

Sonnet 5.5 orchestrator, three workers (gpt-5.6-sol ×2, sonnet), one review round on the docs worker, a ~1,500-word
report; ⌘↵ from the focused Orchestrate switch; Tasks dock live statuses and "In review"; task detail during and after
the run; Home "1 running" on headline, list, sidebar and System card; restart → transcript, tasks, review round,
brief, last steps and result intact; Summary / Verbose / Normal; worker chat breadcrumb back to the orchestrator;
composer placeholders. Screenshots `final-01` … `final-13`.

### Gates (this pass)

web typecheck · lint (0 errors, 75 pre-existing warnings) · check:design · full unit (129 files, 1,582) · story tests
(transcript, patterns: 63 files, 283) · build · check:bundle · check:css; core orchestrator (46) and attention tests;
server attention / system-info tests; client-core (813); shared (88); mobile typecheck, vitest (156 files), Composer /
AssistantText / TasksList suites.

| Run | Result |
|---|---|
| e2e (sandbox, `--workers=1`): chats, composer, subsystems-live, settings-dashboard-templates, navigation, workflow-run | 49 passed, 1 skipped (Faux composer), 1 failed: the known `chats` bulk-archive load flake (ChatsList untouched) |
| `agent-tests/perf/transcript-stream.spec.ts` (Vite dev build, Chrome) | passed — 2 long tasks > 50 ms while streaming (dev mode), mode-switch Event Timing p95 280 ms in dev (production desktop: 48–56 ms); its fences are set for the dev build |
| `right-pane-desktop-smoke.mjs` | 9/9 on rerun (the first-launch race seen in the first pass recurred once) |
| `desktop-dock-browser-smoke.mjs` | 23/23 |
| VRT | not run: no Docker (D-53) |

### Left open

- The run page's layout-shift score while it follows a stage (footnote ¹): moving the stage composer out of the
  scroller (as the chat does) would remove it — a layout change for the run page, not done here.
- Event Timing for a mode switch reads 48–56 ms p95 in production (presentation delay; processing ≤ 2 ms).
- `chats` bulk-archive e2e load flake; the right-pane smoke's first-launch race.

## Addendum 2 — the remaining open items (2026-10-04)

Same setup: desktop_redesign, isolated profiles and sandbox DB (startup `dbPath` asserted), production web build in the
Electron app, real Sonnet 5.5 for the workflow stage, the Faux report fixture for mode switches.

### 1. Run page layout shift — `506104a9`

Cause: the focused stage's composer and the "Show event timeline" footer sat inside `run-scroll`, below the streaming
output, and glided with every frame of the follow spring; the streaming caret was an element travelling with the text.
Fix: the composer is pinned under the stages in the Workspace `bottom` slot — the chat composer's own frame
(`Composer docked`, same padding and reading width), with a "To stage <name>" line since it no longer sits in that
stage's row; `StageRow` no longer takes a composer. The footer button went (board WorkflowRun has none; the header's
More menu keeps Event timeline). The caret is the last element's `::after` (`[data-gai-caret]`) — D-91 updated.

| Real Sonnet stage, following | Layout-shift sum | Max scroll step | Long tasks |
|---|---|---|---|
| Run page 1440×900 | 0.68 → **0.027** | 10 px | 0 |
| Run page 1100×760 | 1.15 → **0.031** | 9 px | 0 |
| Chat, same build, 1440 / 1100 | 0.024 / 0.026 | 10 / 9 px | 0 |

Keyboard: from the stage row, Tab runs through the stage's controls (Actions, Copy, Details, context gauge) and then
reaches the composer (outside the scroller); at 1100×760 the composer is fully on screen (613–751 of 760 px).
Screenshot `fix1-composer-1100.png`.

### 2. Mode-switch click latency — closed as pipeline remainder (no code change)

Event Timing for a trusted click on Normal / Verbose / Summary, production build: input delay 2–4 ms, processing
1–2 ms, presentation 45–54 ms. Evidence that the remainder is not the app's work:
- Trace (CDP, `disabled-by-default-devtools.timeline.frame`, `viz`): the click's urgent commit finishes 4.8 ms after the
  handler and is activated at +5.5 ms, drawn at the next vsync (+12.4 ms); macOS presents it ~23 ms after the draw.
- Interleaved, jittered, 30 clicks each in one session: the real mode switch p50 48 / p95 56 ms; **the same radio
  restyled by a DOM-only `aria-checked` toggle with every app handler bypassed** p50 48 / p95 56 ms; an inline-style
  toggle on an injected button p50 24 / p95 48 ms. Disabling the item's transitions or ring changes nothing; the
  accessibility pass is 0.4 ms for the whole trace.
- Tried and reverted: starting the transcript re-render after the urgent frame is painted (rAF + task, and two rAFs) —
  click latency unchanged (48–64 ms), the settled frame one frame later (65 → 83 ms).
The app adds nothing measurable over restyling that control; the 8-ms-quantised Event Timing value is the Electron/
macOS frame pipeline. The rAF-based click → painted frame stays at p95 33–43 ms (addendum 1).

### 3. Chats bulk-archive e2e flake — `2da830e4`

Reproduced: 3/10 passes alone, 5/10 under load. Cause (app, user-hittable): `ChatsListPage` cleared the selection on
every filter change, including the 250 ms search debounce — a row ticked in the still-visible list was unticked when the
search landed. Fix: once the new list has loaded (not the previous list kept on screen while it fetches), the selection
keeps only the rows it still shows — P2-R14 still holds (no hidden chat reaches a bulk action); unit test for both
sides (fails without the fix). After: **10/10 alone; 5/5 full `chats.spec` runs** (`--repeat-each=2 --workers=5`, all
cores busy with a CPU burner).
Seen while proving it: "New chat dialog → Start chat" timed out once under the burner. Not a race: on Vite dev under a
full CPU burn a page load takes 25–30 s and Playwright's 10 s action timeout expires after the `New chat` click was
dispatched (15/15 passes in an instrumented run under the same load; no remount, no lost input).

### 4. Right-pane smoke first-launch timeout — `0e51442f`

Reproduced 4/5 on fresh profiles. Cause (harness): on a first launch the run route's chunk is still loading when the
URL changes, so the chat page stays on screen; the smoke's unscoped breadcrumb / `dock-toggle` waits matched the chat's
header and its click closed the chat's dock (`dock:chat:open` 1 → 0); the run page then mounted with its dock closed.
Fix: waits and click scoped to `run-workspace`, and the toggle is clicked only when the run dock is closed. After:
**right-pane 5/5 consecutive fresh-profile passes** (9/9 checks each); dock-browser: see below.

Proving it surfaced the same class of race in `desktop-dock-browser-smoke.mjs` — `401fb7f1`: it waited only for any
`#root` child (the boot screen; timeout swallowed) and then called the API through the SPA before it had paired with
the embedded server (`NotPairedError`, `Failed to fetch`; 3/5 failed while the machine ran an Android NDK build at load
20–30). It now waits for `app-frame`, as right-pane does. After: **dock-browser 5/5 consecutive fresh-profile passes**
(23/23 checks) at load 15–21.

### Gates (this pass)

web typecheck · lint (0 errors, 75 pre-existing warnings) · check:design · full unit (129 files, 1,583) · story tests
(workflows, composer, Markdown, transcript) · build · check:bundle · check:css. e2e (sandbox, `--workers=1`):
`workflow-run`, `chats`, `composer` — 12 passed, 1 skipped (Faux composer). A first attempt at load 33 timed out in two
tests (a route chunk still loading, the run badge not yet rendered); the rerun at normal load passed. Desktop smokes,
one at a time: right-pane 5/5, dock-browser 5/5. VRT not run: no Docker (D-53).

### Left open

Nothing from this list. The mode-switch Event Timing value stays at 48–56 ms p95, which is the platform's frame
pipeline (item 2).
