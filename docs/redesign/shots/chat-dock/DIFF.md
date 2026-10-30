# Chat workspace + dock — boards Main, ChatLight, ChatNarrow, ChatFiles, ChatTerminal, ChatBrowser, ChatTasks, DockChanges, DockFiles, DockTerminal, DockBrowser, DockTasks

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: DV Changes (3 Faux file edits in a dummy-repo worktree) → Review changes → Changes dock (This turn / This
chat / Branch vs HEAD, Keep all, Undo all, commit message, Commit & push — pushed `10e1882` to the dummy origin);
Files dock (status letters, file preview); Terminal (shell, `echo`); Browser; DV Gate (risky shell gate → Allow once
→ reload: the decision stays); DV Question (answer); DV Orchestrator (`?dock=tasks`, two workers); DV Error (failed
turn); view seg Normal / Verbose / Summary; 1100 window (rail + dock sheet); Instrument light.
Dock frame details from P4-06 below still hold.

## Matches
- T-04 workspace: breadcrumb + branch chip header, view seg, user bubble, agent turn header, "Edited 3 files" step
  row, markdown (code block, table), changes tray, composer, key-hint row; dock 480 with pinned tabs, Maximize.
- ChatNarrow: rail, 380 sheet, icon-only inactive tabs, no branch chip. ChatLight: light theme tokens.
- Changes dock: compare seg, base select, Keep all / Undo all, per-file diffs with A/M letters, commit form, checks list.
- Permission gate card, question card, delegation cards in the Tasks dock.

## Intentional deviations
- Tasks tab only in orchestrator chats (D-27). Keep / Undo stay (D-28). No queue (D-29). "Always in this chat" has no
  API (D-67). Plan dock (ChatPlan) and Computer dock (ChatComputer) are not reachable on the sandbox: the Faux harness
  cannot raise plan reviews and computer use is off — covered by stories and earlier reviews (blocked here).

## Defects (fixed)
- Files tree had no git-status letters (board ChatFiles/DockFiles) (`eb649466`).
- Commit bar PR reason "Remote host var is not connected" for a path remote → "The remote is a local path …" (`99aa27ce`).
- Shell gate showed its JSON wrapper instead of the command; Allow's name lacked its visible label (WCAG 2.5.3);
  the allowed/denied card vanished once the turn settled — now persisted (`e13eddaa`).
- The server's "[system] Every background agent … finished" re-prompt rendered as the user's bubble → system note (`55e02511`).
- A failed turn vanished from the transcript (no text, no error) → persisted with its InlineError (`49f27026`).
- Composer placeholder "What feature are you dreaming up?" → "Message <model>…" / "Reply to <agent>…"; gauge
  popover bar never filled; tray truncated "3 file…" beside the dock (`44a26675`, `6c95ec7e`).
- Dock tab overflow left half a tab visible (`15093589`).

---

## P4-06 dock frame (unchanged; earlier pass)

Boards: `Main` (1440, dock as a panel) and `ChatNarrow` (1100, dock as a sheet), rendered by
`scripts/redesign/render-boards.mjs`; DockChanges / DockFiles / DockTerminal / DockBrowser / DockTasks were
rendered for reference (their panel bodies are P4-09…P4-11). App: `/chats/:id` with `blocks/dock` (S-08
DockFrame + S-09 NarrowDockSheet + C-19 DockTabStrip) against an isolated server (`:3491` API / `:5491` web,
temp DB, Faux harness, `agent-tests/vrt/seed.ts`). Compares: `compare-1440-dark.png`, `compare-1440-light.png`,
`compare-narrow-dark.png`. Shots: 1440×900 and 1100×760 in Instrument dark, Instrument light, Solarized light;
`1440x900-caps-dark.png` (4 terminals + 5 browsers, overflow), `1440x900-maximized-dark.png`,
`1100x760-terminal-dark.png`.

This task is the dock **frame**. The panel bodies (Changes, Files, Terminal, Browser …) are still the legacy
components and are compared in P4-09 (Changes), P4-10 (Terminal/Browser) and P4-11 (the rest).

## Matches

- Position and size: the dock sits inside the main card under the page header, 480px wide by default
  (measured 479 + 1px separator), with a 1px `line-soft` hinge and a `bg-surface` body, as in Main.
- Tab strip: 44px, Changes · Files · Terminal · Browser pinned in the board's order, sm tabs at 28px with a
  14px icon and label, the active tab on `bg-selected`, then "+", a spacer, and Maximize at the right.
- Below 1200 (ChatNarrow): a 380px non-modal sheet (`role=dialog`, `data-gai-overlay=sheet`, no
  `aria-modal`, no backdrop) with `bg-overlay`, a `line` border and `shadow-pop`. Inactive tabs are icon-only;
  Maximize and Close sit at the right; the chat column keeps a 404px gutter.
- Caps: Terminal stops at 4 and Browser at 5 (the "+" then offers only Widget). Clipped tabs are listed at the
  top of the "+" menu, whose button shows their count. At the cap, a focus request shows the inline cap notice.
- The same React tree across 1200px: 9 panel nodes (4 xterm terminals, 5 browser panels) were tagged with a
  data attribute at 1440; after 1440 → 1100 → 1440 all 9 were the same DOM nodes (no remount).
- Closing collapses rather than unmounts: the panels stay in the DOM and the surface is `visibility:hidden` +
  `inert`. Reopening restores the last size.
- Maximize covers the whole main card (dock 1198px in a 1200px card) and hides the chat column; Escape
  restores the dock.
- The separator is `role=separator` "Resize right pane" and keyboard-operable (arrows, Home/End).
  Dragging or keying past the dock's minimum collapses and closes it. Only real sizes are saved, to
  `generatorai:dock:chat:layout`.
- `?dock=terminal` opens the dock on Terminal, and the parameter is removed with `replace` (R-4).
- Keyboard: arrow keys move between tabs and Enter selects; Enter on "+" opens the menu, where arrow keys and
  Enter add a tab; Delete closes a closable tab and does nothing on a pinned one.

## Intentional deviations

- There is no Tasks tab in the app shots: Main draws Tasks on a chat that is not an orchestrator, and D-27
  (followed here, 04 §2.1 ChatComputer note) shows Tasks only in orchestrator chats.
- There is no "Unified / Split" or commit bar in the app's Changes body, and no branch chip or "…" in the
  header: those belong to the Changes panel (P4-09) and the page header (P4-12). The chat still uses the legacy
  header, which keeps the "Show side pane"/"Hide side pane" toggle.
- Tab labels truncate at 120px and show the full label as a `title`. An extra instance is numbered
  ("Terminal 2", "Browser 3").

## Defects

- None found in the dock frame.
- Seen but outside this task: after several reloads with 4 terminals, `POST /workspaces/:id/terminals`
  returned 429 (the server's rate limit on terminal creation) — P4-10 / server.
- One unexplained navigation to `/chats` happened while an HMR update of `ChatPage.tsx` arrived
  mid-script. It did not reproduce on 3 reloads or on `?dock=`.
