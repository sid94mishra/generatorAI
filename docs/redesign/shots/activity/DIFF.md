# Activity column — app vs boards (2026-10-04)

App: the Electron desktop app (macOS, isolated profile/DB, real Claude / Codex chats, an orchestrator with workers,
workflow runs and automations). Screens at 1440×900 and 1100×760 in Instrument dark, Instrument light and Solarized
light (`<w>x<h>-<theme>-<mode>[-state].png`). Compares (`node scripts/redesign/side-by-side.mjs`):
`compare-1440-dark.png`, `compare-1440-light.png` (EnhActivityColumn, popover open), `compare-1100-dark.png`
(EnhRailQuickAccess, tile popover), `compare-1440-light-sidebar-hidden.png` (EnhSidebarHidden). PNGs are gitignored.

## Matches

- Column between the sidebar (or rail) and the card on the ground, 288 wide, line-soft left edge; header "Activity" +
  amber / blue / red count badges, filter and close; full-width kind tabs with counts; Needs you / Failed / Running /
  Recent "today" sections with counts.
- Cards: 26 px kind tile (unread blue dot), title + mono time, tinted status line (amber ask with mono command, red
  error, run spinner, ok tick "Done" + diff stat), 3-segment-style stage bar on runs, meta line; amber card for asks,
  red for failures, warn ring on the selected ask card, selected = the open page.
- Popover 320 wide beside the card: kind · context, title + status badge, ask / error / progress band with inline
  Deny / Allow once, Review / Reject / Approve, Full log / Retry run; key/value details; Workers / Stages lists; sunken
  footer with Open ↵ and Stop all / Cancel run / Dismiss.
- Sidebar hidden: rail + column + chat + dock; orchestrator chevron expands its workers inline.
- 1100×760: no column, status-tinted kind tiles in the rail with the hover ring, "+N", the same popover.
- Activity (pulse) toggle in the sidebar header next to the collapse button, and in the rail.

## Intentional deviations

| Board | App | Why |
|---|---|---|
| Server filter row, server name per card, "server offline" card | not drawn; project name in the server slot | D-92 / D-36: one server's feed |
| Order Needs you, Failed, Running (drawing) vs comment Running before Failed | Needs you → Failed → Running → Recent | D-92: actionable first |
| "Run #248 · stage 4 of 6" | "Stage 4 of 6" | D-82: no run numbers |
| Chat popover recent tool steps, Context gauge, Effort / Server rows always present | rows only when the data exists | D-36 |
| Six rail tiles at 1100 | as many as fit the rail's free space (2 + "+N" on desktop with Back/Forward) | D-92 #7: they overflowed Settings |
| Meta text fg-3 on tinted cards | fg-2 (amber) / fg (red) | WCAG 4.5:1 (D-92) |
| Stage bar 3 px | 4 px (`h-meter`) | design height tokens only |
| Close icon (panel glyph) | ✕ "Hide activity" | the panel glyph is the sidebar toggle's |
| Back / Forward not on the boards' macOS rows | at the end of the traffic-light row and in the rail | D-93 (owner) |

## Defects → fixed

| Defect (seen in the app) | Fix |
|---|---|
| Approval wait listed as Running "Waiting" (and missing from Home) | D-94: Needs you with Approve / Reject |
| Approval band "Stage 2 of 6" for the 4th stage | D-94: graph order on ties |
| Automation's run listed beside its execution | D-94: rolls up |
| "PR review pipeline - Run 1791123895582", "PR review pipeline failed" | D-94: plain title, "Review diff: The command was refused …" |
| "All 12" tab truncated to "A." | `SegmentedControl distribute="content"` |
| Rail tiles pushed Settings off the 760 px rail | tiles fill the free space only |
| Esc in a popover lost focus; the popover reopened on the returned focus | focus back to the card, no reopen |
| Tab stopped on the list scroller | not a tab stop |
| Allow once in the overlay column closed the whole column | only Open closes it |
| No Cancel on a run waiting for approval | Stop/Cancel targets a stoppable asking run |
