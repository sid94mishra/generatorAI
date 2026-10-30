# Servers menu + "Restart to update" (P3-06) — boards DesktopWindows / DesktopMac vs app

Shots (isolated server :3441 + Vite :5441 on a temp DB, dbPath asserted, seeded by `agent-tests/vrt/seed.ts`, Chrome headed
on macOS, no Electron). Two sets (PNGs are gitignored; regenerate with the steps below):
- **Web host** (`web-*`): the real page in a browser tab — `web-1440-instrument-dark-menu-keyboard.png` (opened with Enter on
  the focused switcher; focus lands on the first row), `web-1440-instrument-light-menu-mouse.png`,
  `web-1440-solarized-light-menu.png`, `web-1100-solarized-light-rail-menu.png` and
  `web-1100-instrument-dark-rail-menu-keyboard.png` (rail mark + ArrowDown). No update pill: the web never shows it (D-23).
- **Stubbed desktop** (`stubbed-*`): the same page with a stub `window.generatoraiDesktop` injected by an init script —
  Windows chrome (`overlay`, strip layout) or macOS chrome (`hidden-inset`), two servers (This computer / connected,
  build-box / offline) and an updater state of `ready 0.0.2-alpha.1`. Everything above the bridge is the shipping code
  (ConnectedTitleStrip, ConnectedSidebar, ConnectedRail, ServersMenu, ConnectedUpdatePill); only the IPC answers are stubbed.
  `stubbed-windows-1440-{instrument-dark,instrument-light,solarized-light}-{menu,pill-tooltip}.png`,
  `stubbed-mac-1280-instrument-dark-{menu,footer-pill}.png`, `stubbed-mac-1100-instrument-dark-rail-update.png`.
  In the stub, choosing build-box called `servers.switchTo('srv-1')` and closed the menu; the pill called `updates.install()` once.
- Side by side: `compare-DesktopWindows-dark.png`, `compare-DesktopWindows-light.png`, `compare-DesktopMac-dark.png`.
  The page behind is still the legacy Home ("Mission Control", P5) — only the strip, the menu and the pill are compared.
- Console: no errors or warnings during the walkthrough.

## Matches
- **Servers menu** (Rosetta: `role="menu"` 280 wide → `Menu.Popup w-70`): `overlay` fill, 1px `line`, card radius,
  `shadow-pop`, pad 4. "Servers" group label (small `fg-3`). One `menuitemradio` per server, 40h two-line: check column
  (✓ on the active one), server glyph (computer for this machine, server for a remote), name + mono micro `fg-3` address
  (`local:3100`, `10.0.4.12:3100`), status at the right end in small `fg-3` — "● Connected" (ok dot) / "Offline" (no dot)
  exactly as the board draws them. Separator, "+ Add server…", "⚙ Manage servers" with the "Security & devices" hint.
- Anchoring: under the title-strip chip, right-aligned to it (Windows); under the sidebar switcher, left-aligned (mac/web);
  to the right of the rail mark in rail mode.
- **Title strip** (DesktopWindows): "Restart to update" pill right before the server chip — Button sm (26h at 13px), `run-bg`
  fill, `run` text, download glyph, no border; the chip is dot + name + chevron in the pressed-chip look (`selected` fill,
  `line` border). Tooltip "Update 0.0.2-alpha.1 is ready" (the board's `title`).
- **Sidebar switcher** (DesktopMac): logo + "GeneratorAI" / active server + chevron, 36h control-radius button; hover and
  open states use `hover`.
- Keyboard: Enter / Space / ArrowDown on any trigger opens the menu with focus on the first row; arrows move, Enter picks,
  Esc closes and returns focus to the trigger (checked on the switcher and the rail mark).

## Intentional deviations
- **Pill placement off the strip follows D-23 + the task brief:** macOS and the Linux native frame put it in the **sidebar
  footer** (full width, above the connection row), and a collapsed rail shows a run-toned download icon above the connection
  dot (06 §8 "or an icon in the rail"). No board draws these two; the pill look is the strip pill's.
- **Status words for the states the board does not draw:** `unpaired` → "● Not paired" (warn), `error` (429/5xx: reachable,
  not confirmed) → "● Not responding" (err); a web page cannot probe other origins, so their rows show **no status** rather
  than an invented one (D-36).
- **Web lists the page's own server** when the paired-server catalog has no entry for it (loopback dev auth, an unpaired LAN
  session): named and probed from its own `server-info` (here the machine name, "Siddharths-MacBook-Air.local"), marked active.
  The web has no "Add server…" (pairing happens on the pairing screen) — never an item that does nothing.
- **Kit icons:** the menu rows use the kit's 16px `current`-coloured item glyph (P-30) where the board draws 14px `fg-3`.
- Hint chips show the host's binding (`⌘ K` on this Mac host in the stub; the board's `Ctrl K` is the Windows binding).

## Defects
- None found in the new UI.
- Stub artefact, not a defect: the strip's right 138px caption-button reserve is not visible because the browser has no Window
  Controls Overlay (`trackWindowControlsOverlay` reads the live WCO rect); in Electron the chip ends before the caption buttons.
  The per-OS Electron check (smokes §6.5 + the matrix row "Update pill (`mock-update-server`)") is the lead's batch-end run.
