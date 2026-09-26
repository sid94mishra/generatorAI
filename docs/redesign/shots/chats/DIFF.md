# ChatsList — board vs app (P3-07)

Board: `docs/redesign/boards/web/ChatsList.dc.html` rendered by
`scripts/redesign/render-boards.mjs`. App: `features/chats/ChatsListPage.tsx`
against the isolated verification server (`:3431` API / `:5431` web),
seeded via `agent-tests/vrt/seed.ts` plus ~60 extra chats via the API.
Compares: `compare-1440-dark.png`, `compare-1440-light.png`.

## Matches

- Sidebar → PageHeader (plain "Chats" title, no heading) → PageTitle (H1
  "Chats" + mono count) + "New chat" (`Ctrl N` hint) → FilterBar → DataTable
  → floating BulkActionBar: same structure, order and spacing as the board
  at both 1440×900 and 1100×760, in Instrument dark, Instrument light and
  Solarized light.
- FilterBar: SearchInput (264/`w-66`, `/` focus hint) · All/Active/Archived
  seg with live server counts · Project/Agent/Status/Tags dropdown Chips ·
  "Last activity" sort chip — same row, same order as the board's Rosetta
  ("search inp + `.seg` counts + `.chip` filters + sort").
  Below ~1024px of bar width the four chips collapse into one "Filters"
  chip (D-56); verified at 1100×760.
- DataTable columns: checkbox · Title (link) · Project · Agent (Avatar 20 +
  name) · Status · Changes (± mono) · Activity · row actions — same set,
  same order, same widths as B-26 `ChatsTable`. Project/Changes are
  `hideBelow` and correctly drop at 1100×760 (verified against the real,
  measured table width, not just the window).
- Row menu (single MenuButton, "More actions for <title>"): Archive/
  Unarchive (lifecycle-dependent) + Delete (danger). Delete opens an
  AlertDialog ("Delete "<title>""; Cancel/Delete) before calling the API.
- BulkActionBar: "N selected" (mono N) · Archive (ghost) · Delete
  (danger-ghost) · "Select all N" · "Clear Esc" — same anatomy, position
  (bottom-centre, floating) and Escape-to-clear behaviour as the board.
- Footer note "Showing N of Total · Scroll to load more" under the table,
  present once the table has rows and hidden once every row has loaded
  ("Showing 62 of 62").
- Status column: StatusBadge for a live/last-turn state, a neutral
  "Archived" chip for archived rows (D-18's chat-domain rule — Archived
  renders as a plain chip, not a status badge), and "—" for a chat that has
  never run. Chats say "Done" for a succeeded turn (context="chat").
- Empty states: "No chats yet" / "Start your first chat" + "New chat" CTA
  with no filters; "No matching chats" / "No chats match your filters." +
  "Clear filters" with an active search/filter. Error state: EmptyState
  `tone="error"` + Retry.
- Keyboard: `/` focuses search from anywhere outside an editable field;
  Escape clears/blurs the search box; the All/Active/Archived tablist uses
  arrow-key roving focus (Base UI Tabs); Tab order is search → tabs →
  Project/Agent/Status/Tags chips → sort chip → header checkbox → row
  checkboxes → row title links, all reachable and operable without a mouse.
- Infinite scroll: scrolling the table's ScrollArea loads further pages
  (`onEndReached` → `fetchNextPage`); verified from 63 seeded chats down to
  "Showing 62 of 62" (one archived during the walkthrough).

## Intentional deviations

- **Row menu is one MenuButton, not a split archive-icon + "…" pair**
  (D-36/simplicity): the board's "Audit IAM policies" row shows a
  dedicated Archive IconButton next to a separate "…" menu on hover; the
  kit's `MenuButton` (P3-01) already gives one accessible, keyboard-
  operable trigger for Archive/Unarchive + Delete, so the port uses that
  instead of adding a second bespoke row-hover affordance the domain doc
  does not otherwise call for.
- **No header "…" overflow menu.** C-01 PageHeader's generic recipe
  ("plain title + a More icon button") is followed for the title, but
  F-chats-01 defines no header-level actions for Chats beyond "New chat"
  (which the domain doc places on the TitleBlock, not the header) — so a
  "…" button with nothing real behind it was not added (D-36: no invented
  affordances).
- **Tags is a free-text chip, not an enumerated checkbox list** like
  Project/Agent/Status: there is no "list distinct tags" endpoint (checked
  `packages/shared/src/types/IPlatformClient.ts`, the chats routes and
  `05-gap-matrix.md`), so the board's generic dropdown-Chip anatomy is kept
  but its content is an `Input` (add on Enter) + removable `Chip`s for the
  tags already applied — real filtering against the existing `?tag=`
  repeatable query param, not an invented list (D-36).
- **Row data**: the board's 12 sample rows show rich state (Needs you,
  Running, Done, Failed, changed-file counts, named agents/projects) drawn
  from static board data; the walkthrough's seeded chats are mostly fresh
  ("Paging chat NN") with no turns yet, so most rows show "—" in Agent/
  Status and "+0 −0" in Changes. This is real data behaving correctly
  (D-36: a chat that never ran shows no status badge and zero-valued,
  computed changes — not invented data), not a layout difference; the
  seeded "Sandbox — Active/Archived/Needs you" chats and the bulk/row
  action screenshots (`*-bulk-select.png`, `*-row-delete-confirm.png`,
  `*-no-match.png`) show Status/Changes/selection rendering with real
  varied values.

## Defects

None found. `console error` was empty on every reload across all three
themes × both sizes and through every interaction below.

## Keyboard-only walkthrough performed

1. `/` (unfocused) → search box gets focus, no literal character typed.
2. Type a query → list filters, header count and tab counts update live.
3. Escape → search clears/blurs.
4. Tab → All/Active/Archived tablist; ArrowRight/ArrowLeft moves the
   roving-tabindex selection (Active ⇄ All) without re-tabbing.
5. Tab ×4 → Project, Agent, Status, Tags chips in DOM order.
6. Tab → sort chip ("Last activity").
7. Tab → header "Select all" checkbox.
8. Tab ×2 → first row's title link (a real `<a href="/chats/:id">`, Enter
   would navigate).

## Interactions verified against the seeded, isolated server

- Search narrows the table and updates the H1 count + tab counts.
- Project filter chip lists real projects (`useProjects()`), toggles a
  checkbox, filters the table, and reduces the header count.
- Tags chip: typed "feature" + Enter → chip shows "Tags (1)" with a
  removable "feature" chip; table filters to the chats seeded with that
  tag (every 4th paging chat); "×" on the chip removes the filter.
- Row checkbox → BulkActionBar shows "1 selected"; Archive moves the chat
  to Archived (Status cell → "Archived" chip, Active/Archived tab counts
  update) and the bar closes.
- Row "More actions" → Unarchive (shown only for an archived row) moves it
  back to Active; Status cell returns to "—" (never ran).
- Row "More actions" → Delete → AlertDialog "Delete "<title>"" → Delete →
  row removed, table shows "No matching chats" once the (filtered) list
  is empty.
- Infinite scroll loads further pages until "Showing N of N" (no
  "Scroll to load more").

## Observation for `e2e/chats.spec.ts`

The FilterBar's chip-collapse (D-56, ~1024px of *bar* width) and the
DataTable's `hideBelow` columns both key off the measured card/table width,
not the window width. Playwright's bundled Chromium (`agent-tests`'
`playwright.config.ts`, viewport 1440×900) measures a narrower MainCard than
`playwright-cli --browser=chrome` did at the same nominal viewport (Chrome
channel), enough to cross both thresholds — the collapsed "Filters" chip and
the Project/Changes columns hidden appear in the e2e run's error-context
snapshot at 1440×900, while the playwright-cli walkthrough's 1440×900
screenshots show the expanded chips and both columns. Both are the design's
intended responsive behaviour for their measured width, so `chats.spec.ts`'s
"Tags filter" test checks for either the "Tags" or the "Filters" chip rather
than assuming one.

## Not covered here (owned elsewhere / later phases)

- Sidebar Needs-you/Running live lists, server switcher, "This computer"
  subtitle, connection footer: P3-04 (app shell), already landed and
  rebased onto.
- "New chat" opens the legacy `CreateChatDialog` (R-1); replaced by the
  new create-chat page/dialog in P5-09.
- Command-palette `Mod+K` binding for the visual "Ctrl N" shortcut hint on
  "New chat": the registry entry is P1-S2/D-24 scope, not this page.
