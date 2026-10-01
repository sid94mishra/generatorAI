# Final review of all phases (2026-10-01)

One review across P0–P7 (owner rule: no per-phase cycles; one review, one fix pass, one end-to-end verification).
Method: plan parity (every 07 task, the 05 gap matrix, the 03 kit inventory), decisions (01, as-built D-43…D-82), follow-up
lists (`reviews/*`), and a design comparison of 45 screen boards against the running app (seeded sandbox, Instrument
dark, ink accent, board viewport; `docs/redesign/shots/review/compare-<Board>.png`, PNGs gitignored). Regression state is in
the README P7 row (e2e 84/84, unit 1558, stories 1730/1731→fixed, tokens 533, desktop smokes on macOS).

## Verdict

The redesign is functionally complete against the plan. Every 07 task is done except owner/CI items (P0-06, P1-R7/P3-08
VRT baselines, the Windows/Linux smoke matrix). Every kit component in the 03 inventory exists (S-05 PageHeaderSlot was
deleted on purpose in P7). All G-01…G-20 gaps are built. Screens match their boards in structure, hierarchy, tokens and
type; the differences are polish defects (below), decided deviations (D-36 data gating, D-77/78/82), and seed data.

## Findings

Severity: **M** fix now (visible defect or plan gap), **S** fix now (small polish), **D** decided deviation (no change),
**O** open, outside this pass.

| # | Sev | Area | Finding | Resolution |
|---|---|---|---|---|
| 1 | M | Agent editor | No page title row (glyph, name, slug · version · updated) and no sticky "Unsaved changes · Discard / Save" footer; only a floating Save | **Fixed** |
| 2 | M | Agent editor | "Used by" aside not wired although `GET /api/agents/:id/usage` exists (D-78 follow-up) | **Fixed** |
| 3 | D | New chat dialog + create page | No Effort control in the screenshot | No change: Effort renders once a model with reasoning levels is picked (the sandbox had none selected) |
| 4 | S | Chats list | Zero changes render as green "+0" / red "−0"; board shows "—" | **Fixed** |
| 5 | S | Projects, Workflows lists | Footnote pinned to the page bottom instead of under the table (Automations is right) | **Fixed** |
| 6 | S | Project detail | Header lacks "Run workflow"; meta line prints the full root path and wraps | **Fixed** |
| 7 | S | Workflow builder | Canvas fits at 130 %; nodes oversized against the board's 100 % | **Fixed** |
| 8 | S | Workflow detail | "Runs · 30 d…" stat label truncates | **Fixed** |
| 9 | S | Automation detail | Trigger badge stretches across the side card | **Fixed** |
| 10 | S | Automations list | Missing Permission and Dataset columns (data exists) | **Fixed** |
| 11 | S | New workflow | Full sidebar; board (and the builder) use the rail | **Fixed** |
| 12 | S | Dock deep link | `?dock=<tab>` for a tab the chat does not offer (Tasks, Computer) keeps the last tab | **Fixed** |
| 13 | D | Agents | Robot glyph instead of initials (AgentGlyph, DF-13) | Keep |
| 14 | D | Workflow detail / run | Stages table instead of the mini-DAG; no lifecycle card, Agent/Attempt columns, run number (D-82, D-36) | Keep |
| 15 | D | Workflows / Automation detail | No published version / status filters, no Edit, no median cost (D-82) | Keep |
| 16 | D | Settings · Security | Single column (board: two) — content and order match D-74/P6-04 | Keep |
| 17 | D | Chat view seg | Normal/Verbose/Summary above the transcript, board puts it in the header row | Keep |
| 18 | O | Terminal in emulated browsers (not a product defect) | Under Playwright viewport emulation the WebGL canvas draws at the wrong DPR (the real Electron app is correct; screenshot kept in `terminal-desktop-smoke`) | Note for VRT setup |
| 19 | O | Diff-review smoke | With the real Copilot provider the turn's `after` checkpoint is not recorded (Faux records it) | Investigate separately (costs real provider calls) |
| 20 | O | Tests | Load-sensitive tests (batch-P3P4-followups), cli `tui-e2e` needs :3100 | Follow-up |
| 21 | O | Chats | Home retry resends without attachments; chat-workspace mounts write no `worktrees` rows (G-17 chat link) | Follow-up |
| 22 | O | Docs site | Product pages cite pre-redesign source paths | Follow-up |
| 23 | S | README | P1–P4 rows still say "in progress" | **Fixed** |

## Fix pass (2026-10-01)

- Agent editor: PageTitle h1 (name · `scope:slug` · version · updated) for existing agents (the breadcrumb is the h1 only
  for a new agent), a "Used by" card from `useAgentUsage` (workflows with their stages, chats; hidden when unbound), and
  Discard in the ActionBar while there are unsaved changes.
- `ui/templates/ListPage`: with a footer note the content takes its own height, so the note sits under the rows.
- `ui/patterns/PageTitle`: the detail meta line stays on one line; a long first part (a root path) truncates with the
  full text as a tooltip.
- Chats list: a chat with no changes shows "—". Project detail: Run workflow in the header. Builder: fit view caps at
  100 %. Workflow detail: "30-day runs". Automation detail: the trigger badge sizes to its label. Automations list:
  Dataset and Permission columns. New workflow: `forceRail`. Dock: a `?dock=` tab the surface does not offer lands on
  the default tab.
- README progress rows brought up to date.
Verified by re-capturing the affected screens against their boards (`shots/review/compare-*`).
