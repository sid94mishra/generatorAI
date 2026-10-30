# P3-04 app frame — board vs app

Walkthrough: headed Chrome (`playwright-cli -s=shell … --browser=chrome --headed`) against an isolated server
(:3411, temp DB under `os.tmpdir()/generatorai-p304-*`, dbPath asserted, Faux harness, `agent-tests/vrt/seed.ts`)
and Vite :5411. Plain web = the `native` layout. Screenshots: `<w>x<h>-<theme>-<mode>-{chat,home}.png` for
Instrument dark / Instrument light / Solarized light at 1440×900 and 1100×760, plus `-flyout`, `-rail-collapsed`,
`-404`, `-palette`. Compares: `compare-Main-{dark,light}.png` (1440, frame only), `compare-ChatNarrow-dark.png`
(1100, rail), `compare-DesktopWindows-dark.png` (the web frame against the Windows board: only the sidebar body is
comparable; the strip needs Electron on Windows). DesktopMac / DesktopWindows chrome (traffic-light row, 36px strip)
cannot be rendered in a browser tab; those rows are covered by `agent-tests/desktop-chrome-smoke.mjs` at batch end.

Checked by hand: every nav destination (Home … Scripts) navigates, is `aria-current`, and still renders its
legacy Header in `legacy-header`; the chat page keeps Open in editor, Archive and the side-pane toggle; the
Needs you row opens its chat; Collapse → rail (48) → Expand → sidebar (232); at 1100 the rail is forced and
Expand opens the flyout (Esc closes it and focus returns to Expand; following a link closes it); the sidebar
Search opens the P3-05 palette; `/definitely-not-a-page` renders the Gate inside the card with the sidebar kept.
Tab order: Hide sidebar → Search → New chat → 7 nav links → Needs you row → Settings → page. Console: 0 errors,
0 warnings.

## Matches
- Frame: `ground` window, 232 sidebar without border, inset `surface` card with `panel` radius and 8/8/8/0
  margins; rail 48 with the card flush against it (ChatNarrow).
- Sidebar order and geometry: app mark + "GeneratorAI" + collapse, Search (30h, `Ctrl K`/`⌘K` hint) + square
  New chat, seven nav rows (30h, selected wash on the current one), "Needs you" label + warn count, two-line
  rows with warn dot, footer rule + dot + "Connected" + Settings gear.
- Rail: mark, Expand, divider, Search, New chat, divider, seven icons with the selected wash and Home's warn
  dot, connection dot + Settings at the bottom.
- Card header row is 44px on every legacy page (the legacy Header was 40px).

## Intentional deviations
- **Server line / address absent on web.** The switcher's "This computer" and the footer's `local:3100` come
  from `useServers()`; the plain-web connection catalog of this sandbox is empty (loopback dev auth), so both are
  omitted rather than invented (D-36). The desktop app lists its embedded server and shows both.
- **Switcher has no chevron and is not a button** until P3-06 adds the Servers popover (no dead control).
- **Running list / rail counter absent** in these shots: the seeded Faux chat is waiting on a permission, so the
  attention feed has it under Needs you only (an entity with an ask is never also Running, D-49).
- **Page bodies are the legacy pages** (Mission Control on `/`, the old chat page) — ported later (P4/P5); only
  the frame is compared.
- **Kbd hint** reads `⌘ K` on macOS web (formatted from the registry for the host), `Ctrl K` elsewhere.
- **No phone drawer**: below 768px the rail stays (04 §4.1 row 3), overriding 06 §2.5's drawer.
- Bottom-right round icon is the TanStack Query devtools button (dev builds only).

## Defects
- None open in the frame. (Fixed during the walkthrough: flyout focus return after Escape; flyout Escape
  swallowed by a focused button's tooltip; duplicate "Sidebar"/"Main" landmarks while the flyout covers the rail.)
