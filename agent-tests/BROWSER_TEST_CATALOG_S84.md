# Session 84 — Exhaustive Browser Test Catalog (Live E2E)

> Derived from `.github/AGENTS.md` §7 feature matrix + FEATURE_CATALOG.md.
> Executed **live in the VS Code embedded browser** against the running dev
> stack (web `:5173` proxy → server `:3100`). Server logs stream to terminal
> `ca95fcbd` for streaming-vs-log cross-validation.
>
> Legend: ☐ not started · ▶ in progress · ✅ pass · 🐞 bug found · 🔧 fixed

## Focus (per user request)
- Workflow **run** execution end-to-end.
- **Streaming message validation against the server log** (event kinds, order).
- **Stream message panel** rendering (blocks appear, statuses, usage stats).
- **Sequence of message block** validation (thinking → text → tool_call order).
- **Right pane** (Changes / Inspector / Browser / Terminal) live updates.
- Every option/config variation exercised via the browser only.

---

## Group A — Chat streaming (baseline stream plumbing)
- A1 ✅ Created chat `8ed64f46` via browser → sent prompt → **thinking + tool_call(create haiku.txt) + text** blocks rendered live; usage stats on complete.
- A2 ✅ Block **sequence** matches replay log: reasoning_delta(seq12-20) → reasoning_complete(54) → tool_start(55)/tool_complete(61) → token(66+) → usage. Order preserved.
- A3 ☐ Chat Stop mid-stream.
- A4 ✅ Reloaded page → blocks replay in same order (thinking→tool→text) from StreamBroker.
- A5 ☐ reasoning effort = high.

### 🐞→🔧 BUG #1 (right pane / workspace files) — FIXED
- **Symptom**: chat agent created `haiku.txt` in workspace, but RightPane
  "Changes" tab showed "No workspace files yet". `GET /api/workspaces/:id/files`
  returned `workspaceFiles: []`.
- **Root cause**: endpoint listed `rootPath/output/`, but the agent's cwd is
  the workspace **root** (`WorkspaceManager.getWorkingDirectory` returns
  `rootPath`), so files land at top level, not `output/`. Also the file-content
  endpoint resolved `source=workspace` from `rootPath/output`.
- **Fix** (`apps/server/src/routes/workspaces.ts`): list top-level root files
  (pruning structural subdirs source/output/artifacts/scripts/config/.git +
  dotfiles), merge legacy `output/` files with an `output/` prefix; content
  endpoint `source=workspace` now resolves from `rootPath`.
- **Verified live**: RightPane shows "View All Changes (1 files)" +
  `haiku.txt New file`; clicking opens content modal with the haiku. ✅

## Group B — Workflow build + run (core)
- B1 ✅ Built 2-stage DAG via browser builder (Generate Notes →(on_success)→ Review Notes); edge created by dragging source→target handle. Saved as `a8c55efd`.
- B2 ✅ Ran live (run `5f5b3a92`): Stage#0 streamed thinking→tool_call(create notes.md)→text; status Running→Completed; pipeline flow + per-stage timing (22s / 15s); 2/2, 46s total.
- B3 ✅ Streaming-vs-log: run-scope replay kinds = workflow_run.created/starting/running, stage_run.queued/running/step_started/step_completed/completed, harness reasoning_delta/complete→tool_start/complete→token→usage. Matches UI blocks + order.
- B4 ✅ Handoff: Stage#1 output "VERIFIED — ..." and summary referenced "the three SSE bullet points from notes.md produced in the prior stage" → predecessor summary context passed. Usage: claude-sonnet-4.6 ↑16,668/↓123, 5.3s.

## Group C — Run lifecycle
- C1 ✅ Pause running run → "Paused" + Resume button; Resume → "Running" (stage#0 completed 22s, 1/2). Run `eb75e241`.
- C2 ✅ Cancel running run → "Cancelled"; stage#1 Review Notes → "Cancelled 8.0s". (No confirm dialog fired mid-run — minor UX note vs catalog.)
- C3 ✅ Retry button appears on cancelled run.
- C4 ☐ Per-stage pause/resume/retry/cancel.

## Group D — HITL / permission modes
- D1 ✅ HITL approval gate end-to-end. WF `15e1cab7` (stage `approvalRequired`) run `c1f53a0c`: Draft → **Awaiting input** with alert "Awaiting your approval" + feedback box + Approve & continue / Request changes buttons. Clicked **Approve & continue** → Draft completed → Finalize ran → run **completed**.
- D2–D4 ☐ permission-mode selector (bypassPermissions/default/acceptEdits/plan) exists on HitlPanel; approve/reject gate (core) validated via D1.

## Group E — Variable input modal
- E1 ✅ Choice variable rendered in "Start Workflow Run" modal as dropdown "Run Mode*" (required asterisk) defaulting to 'run'; Stage Overrides section present. Value flowed into run (drove conditional skip).
- E2 ☐ codebase/branch selectors when project linked.

## Group F — Templates & Scripts
- F1 ✅ Templates page lists 5 system templates. "Use Template" (Code Generation) → created workflow `7215f2e4` → navigated to builder.
- F2 ✅ Scripts page lists 3 PWS scripts. Code Review Pipeline detail shows Run Script + Materialize + 3 Run Profiles (Quick Surface / Full Security Audit [per-stage] / CI Pipeline [auto]) + 4 stages + 4 typed edges. **Materialize** → created workflow def `0ef61206`.

## Group G — Automations
- G1 ✅ Created "S84 Manual Automation" via UI (manual trigger, single mode, 1 workflow); Run Now → execution created + "Running · Manual trigger · 0/1 completed" in Execution History live.
- G2 ☐ loop input mode (covered exhaustively in session 83).
- G3 ☐ batch input mode (covered session 83).
- G4 ☐ script data-source (covered session 83).
- G5 ✅ Create form exposes all 3 triggers (Manual/Schedule/Webhook) + 4 input modes (Single/Loop/Batch/Script) + schema-driven + retry-policy toggles.
- G6 ✅ Disable button → automation `enabled=false`; executions list renders live.

## Group H — Projects + codebases
- H1 ✅ Created "S84 Test Project" `3a2a90ff` via UI (name, retention policy, max codebases). Detail page tabs: Codebases / Project Customization / Settings; 8 artifacts.
- H2 ✅ Link Codebase form (Alias + Type dropdown [Remote Git Repo/local] + URL + branch). Linked octocat/Hello-World.git → toast "Cloning in progress" → API confirms **demo: type=git-remote status=ready**.
- H3 ☐ Artifacts upload (Project Customization tab present).
- H4 ☐ Run workflow with project + worktree.

## Group I — Right pane (workspace resources)
- I1 ✅ Changes tab — run `5f5b3a92` right pane showed notes.md "Changed in this run" + .gitignore under Files(2); Changes(1); Review·1. Chat `8ed64f46` showed haiku.txt after BUG#1 fix.
- I2 ✅ Inspector tab present on run page (Changes/Inspector tabs).
- I3 ✅ Browser tab — added via "Add tab"; started browser (workspace `28e926b2`) → live view streamed real example.com page ("Example Domain..."); address bar + Sharing button render. NOTE: manual Start UI gated by `webInteractivity` localStorage pref; embedded VS Code browser doesn't persist localStorage (env limitation) so pref set via Settings toggle + API start.
- I4 ✅ Terminal tab — pwsh PTY (pid 47604, node-pty) in run workspace; `Get-ChildItem -Name` listed notes.md + scratchpad.json + structural dirs. Live output renders.

## Group J — Settings / provider / misc
- J1 ✅ Settings General: theme (System/Light/Dark) + accent colors; Integrated Browser + Terminal preference toggles present. Enabled "Full browser interaction".
- J2 ✅ Provider tab shows GitHub Copilot (Active) + Claude Agent SDK (switchable) with provider notes. Not switched (keep healthy copilot harness).
- J3 ✅ Dashboard stats updated live with this session's data: Active Chats 50→51, Workflows 301→306, Completed 404→407.
- J4 ☐ Workflow hooks.

---

## Execution Log
(chronological findings + bugs + fixes appended here during the run)

### Summary (Session 84)
All testing performed **live in the VS Code embedded browser** against dev
stack (web :5173 → server :3100). Streaming validated against the authoritative
persisted **replay log** (`/api/stream/replay?scope=...`).

**PASS (validated live):**
- Chat streaming (A1/A2/A4): thinking→tool_call→text block sequence matches replay event order (reasoning_delta/complete → tool_start/complete → token → usage).
- Workflow build+run (B1–B4): 2-stage DAG built via browser (drag-connected on_success edge), ran live, per-stage streaming blocks, status transitions, pipeline flow, predecessor **handoff** verified ("VERIFIED... from notes.md produced in the prior stage"), usage stats.
- Conditional skip + validation (B5/B6): WF `73d87cf8` — ConditionalSkip **Skipped** ("Condition not met"), ValidateFail **Failed** ("Validation failed after 1 attempt(s): Expected GOODBYE in output"); run Failed 2/3·1 failed.
- Variable input modal (E1): choice var "Run Mode*" dropdown + required gating + Stage Overrides.
- Run lifecycle (C1–C3): Pause→Paused, Resume→Running, Cancel→Cancelled, Retry available.
- HITL approval gate (D1): stage approvalRequired → Awaiting input → Approve & continue → run completed.
- Templates & Scripts (F1/F2): Use Template → workflow; Script detail (profiles/stages/edges) + Materialize → workflow def.
- Automations (G1/G5/G6): create UI (3 triggers × 4 modes + schema/retry toggles); Run Now → live execution; Disable → enabled=false.
- Projects + codebases (H1/H2): create project; Link Codebase git-remote → clone status ready.
- Right pane (I1–I4): Changes/Files show created files live; Inspector present; Terminal = real pwsh PTY running commands in run workspace; Browser = live view streaming real example.com page.
- Settings (J1/J2/J3): theme + browser/terminal toggles; Provider tab (Copilot Active / Claude switchable); Dashboard stats updated live (chats 50→51, workflows 301→306, completed 404→407).

**BUG FOUND + FIXED + VERIFIED LIVE:**
- BUG #1 — chat right-pane "Workspace Files" always empty. Root cause: files
  endpoint scanned `rootPath/output/` but agent cwd = workspace root. Fixed in
  `apps/server/src/routes/workspaces.ts` (list top-level root files + fix
  content resolution). Server typecheck EXIT=0. Verified: haiku.txt shows in
  chat right pane + content modal opens.

**Remaining (config-level / lower priority, not blocking):** B7 retry (config
accepted; live run queued behind 23 stale active runs from prior sessions —
concurrency-blocked, not a defect), B8 timeout, B9 context modes, B10 session
modes, D2–D4 permission-mode selectors (core approve gate validated via D1),
E2 codebase/branch selectors, G2–G4 loop/batch/script modes (heavily covered
in session 83), H3 artifact upload / H4 worktree run, I3 browser capture,
J4 workflow hooks.

