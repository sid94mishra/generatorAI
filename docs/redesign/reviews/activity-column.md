# Activity column + desktop Back/Forward (2026-10-04)

Branch `desktop_redesign`. The owner's Enhancements page (boards EnhActivityColumn, EnhSidebarHidden,
EnhRailQuickAccess, EnhActivityCards, EnhActivityPopovers; snapshot 49e96647) built on the kit, plus Back/Forward in
the desktop app. Decisions: **D-92** (column), **D-93** (Back/Forward), **D-94** (attention-feed corrections found by
the test). Screens and the board comparison: `shots/activity/DIFF.md`.

## 1. Design analysis — what the boards ask for and what already existed

| Board element | Existing data / component | Gap → what was built |
|---|---|---|
| Needs you / Running rows | Attention feed (G-01, SSE, `client-core` store; D-87 counting, workers fold into their orchestrator) | Reused as is. Items gain `meta` (agent, model, worker tally, automation trigger) — additive |
| Failed / Recent (today) | G-11 recent activity (Home "Recently finished") | Reused with `?since=<local midnight>`; items gain `meta`, `unread`; titles lose the minted run suffix; failures name the failed stage (D-94) |
| Card kinds chat / orchestrator / workflow / automation | `Chat.orchestratorMode`, background tasks | Kind derived in the shared model from `meta.workers` |
| "2 running · 1 done · 1 queued" | Background tasks (in-memory list) | Tally from the worker chats' `backgroundTask.status` (durable), kept current by `chat.background_task.*` |
| Stage bar "stage 4 of 6" | `progress.step/of` on running runs | Stage asks now carry `progress` too (D-94) |
| "Automation · every hour" | `cronExpression` | Shared `describeSchedule` (common cron shapes in words, else the cron as written) |
| Popover details | Chat, workspace info, run (+ stages), automation (+ executions), background tasks | Lazy reads while open, refetched when the card changes (no polling) |
| Inline Allow / Deny, Approve / Reject, Stop, Retry | Home's `useAttentionAction`, `useRetryActivity` | Added `deny`, `reject`, automation stop; Cancel run on a waiting run |
| Server filter, server name per card | Desktop server list (G-03) — but the feed is the connected server's only | Not drawn (D-36); the project takes the slot |
| Rail tiles | Rail running counter | Replaced by tiles + "+N" |
| Kind tabs | P-25 SegmentedControl | New `distribute="content"` variant |
| Card, popover, column frame | ActivityRow (Home) is a table row, not a card | New kit parts `ActivityCard`, `ActivityPopover*`, `ActivityColumn`, `RailLiveTile` / `RailLiveOverflow` (stories for every variant/state, axe in three appearances) |

Shared for mobile: `client-core` `activity/` (grouping, ordering, counting, status line, meta line, stage bar, time
label, dismissal key, gate subject), `shared/ui-contract/activity.ts` (kinds, groups, labels, icons, schedule words).

## 2. Problems in the design and how they were resolved

| # | Problem | Resolution |
|---|---|---|
| 1 | Section order disagrees inside the board (comment: Needs you → Running → Failed → Recent; drawing: Failed before Running) | Actionable first: Needs you → Failed → Running → Recent (D-92) |
| 2 | Server filter / server per card / "server offline" state assume a multi-server feed that does not exist (a page cannot reach other origins; the desktop's feed is the active server's) | Not built (D-36); project name in the slot |
| 3 | A worker's ask drawn on its orchestrator while the same orchestrator can also be Running → listed twice | One card per entity; the orchestrator is under Needs you only |
| 4 | Several asks of one chat → several cards | One card, oldest ask, "+N" and every ask in the popover |
| 5 | "Red stays until dismissed or retried" — no store for a dismissal, and a run retry is a new run | Dismissal per failure (`key@endedAt`) on the device; a newer failure shows again |
| 6 | No width or narrow-window rule: sidebar 232 + column 288 + dock 480 leaves ~440 px for the chat at 1440 and nothing at 1200 | Resizable 248–400; docks only at ≥ 1200 px **and** while the card keeps 720 px; otherwise an overlay; the rail's tiles are the quick access (board 1100 answer); dragging never undocks |
| 7 | Rail quick access draws 6 tiles + "+2" in a rail that, on desktop, also holds Back/Forward and every nav icon — at 760 px they overflowed the Settings button (seen in the app) | Tiles fill only the space left (measured), then "+N" |
| 8 | Popover only on hover (not reachable by keyboard / touch); no keyboard model for the list; no shortcut | Popover on keyboard focus too; roving focus, ↑/↓/Home/End, → into the popover, ← / Esc back to the card, Esc closes the column and returns focus to its toggle; `activity.toggle` in the registry (Mod+. · ⌘. · Ctrl+.), palette and View menu |
| 9 | fg-3 meta text on the amber / red tints fails WCAG 4.5:1 | fg-2 on amber, fg on red (axe in Instrument dark/light and Solarized light) |
| 10 | Kind tabs: "All 10" truncates to "A." when five equal tabs share 272 px (seen in the app) | Tabs grow from their own width |
| 11 | Duplicate activity indicators: the board's sidebar keeps Needs you / Running while the column shows them | The sidebar's lists move into the column while it is open (the board comment's own rule) |
| 12 | Board "Run #248", "Mute updates", recent tool steps, context %, "Switch model" | No data or setting (D-36): not drawn |

## 3. Back / Forward on desktop (D-93)

Before: the Windows/Linux title strip and the Linux native sidebar row had buttons; macOS had none at all, no rail
had any, mouse buttons and swipe did nothing, the palette did not list Back/Forward.

| OS | Buttons | Keys | Mouse / gesture |
|---|---|---|---|
| macOS | end of the traffic-light row; rail (sidebar collapsed) | ⌘[ / ⌘] (menu accelerators) | buttons 4/5 (renderer), trackpad swipe (main, two/three-finger setting) |
| Windows | title strip (both sidebar modes) | Alt+← / Alt+→ (renderer; not inside a key-owning surface) | `app-command` (main): mouse 4/5, Browser keys |
| Linux custom title bar | title strip | as Windows | as Windows |
| Linux native frame | sidebar top row; rail | as Windows | as Windows |
| Web | none (the browser's own) | none bound | — ; the palette lists Back / Forward |

Enabled state comes from Chromium's session history (main → renderer push).

## 4. Test evidence

- **Desktop, real providers** — unpackaged Electron in standalone mode, `--user-data-dir` + bare `DB_PATH` /
  `WORKSPACES_DIR` / `ARTIFACTS_DIR` / `EXTENSIONS_DIR` under a temp dir, `GENERATORAI_BIND_HOST=127.0.0.1`; the startup
  log's `dbPath` was the temp DB on all 3 launches; embedded server on an OS-picked port, CDP on :9411. A throwaway
  dummy repo linked as the project codebase. Live at once: a Claude Haiku chat blocked on a `git push` permission
  (permission mode default), a Claude Sonnet 5 orchestrator with four Haiku workers per wave (three waves), a Codex
  GPT-5.6-Luna chat writing documents, workflow runs with an approval wait, a 10-minute check stage and a refused
  check (failed), two scheduled automations (one failing, one running).
  Driven by real clicks / keys over CDP: opened the column from the sidebar and the rail, switched to a chat from
  inside another chat, approved a stage and denied the gate from popovers (cards moved to Recent live), cancelled a
  waiting run from its popover, expanded workers inline, kind tabs, sidebar hidden + dock open, 1100×760 rail tiles
  and tile popover, overlay column.
- **Keyboard-only pass** (desktop): Enter on the toggle → focus on the open page's card + popover; ↓ / End / Home;
  → into the popover's actions, Tab; Esc → back to the card (popover stays closed); Esc → column closes, focus on the
  toggle; `Mod+.` from the page.
- **Back/Forward** (desktop): sidebar buttons (disabled state follows history), mouse buttons 4/5 (CDP
  `Input.dispatchMouseEvent` back/forward), palette Back/Forward. Not exercised here: the native ⌘[ menu accelerator
  (System Events scripting is not permitted on this machine; covered by the menu unit test), `app-command` and swipe
  on real hardware (unit-tested against a fake window).
- **Defects found and fixed in place:** approval waits shown as Running (D-94), wrong stage position, automation runs
  counted twice, raw run titles, "PR review pipeline failed" with no reason, truncated "All" tab, rail tiles overflowing
  Settings, focus lost after closing a popover with Esc, an extra tab stop on the scroller, inline actions closing the
  overlay column, no Cancel on a waiting run.
- **Gates:** typecheck, lint, check:design, unit (client-core activity 16, shared activity vocabulary + commands,
  web command host / placement / rail capacity / view helpers, desktop menu + window manager), server attention +
  activity route (32), stories (ActivityCard, ActivityPopover, ActivityColumn, Rail, Sidebar, AppFrame,
  SegmentedControl) in three appearances with axe, web build + check:bundle + check:css, check:tokens. E2E
  `activity-column.spec` (3) and `nav-history.spec` (2) new, plus navigation, chats specs green against the Faux
  sandbox; desktop smokes chrome 59/59, right-pane 9/9, dock-browser all passed (macOS).

## 5. Open

- Windows / Linux runs of the desktop smokes and a hands-on check of `app-command` / swipe on hardware (CI after a push).
- VRT baselines for the new stories (P1-R7, Docker).
- Mobile equivalent (`mobile/reviews/PENDING.md` MV-35).
