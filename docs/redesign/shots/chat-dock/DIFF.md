# Chat dock — board vs app (P4-06)

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
