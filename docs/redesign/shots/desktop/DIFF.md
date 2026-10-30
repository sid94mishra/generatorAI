# Desktop (Electron, macOS) — boards DesktopMac, DesktopWindows (+ Main / dock flows in the shell)

Packaged-mode Electron (`pnpm --filter @generatorai/desktop build:server && build`) launched through Playwright's
Electron API with an isolated `--user-data-dir` (`agent-tests/helpers/desktop-profile.mjs`), standalone mode.
Native-menu chords are driven by clicking the menu item that owns the accelerator (what macOS does for ⌘K / ⌘N;
synthetic CDP keys never reach the menu). Shots `mac-*.png` (gitignored); `compare-DesktopMac-dark.png`.

Checked (11/11): mac layout frame; sidebar → rail and back; ⌘K palette; ⌘N New chat (Start chat enabled with a
task); open a chat from the Chats list; dock Terminal (zsh via node-pty, `echo` round trip in the shot); dock
Browser (native view inside the dock); Settings › Appearance Solarized light → window background `#EEE8D5`; native
menu bar (App, File, Edit, View, Server, Window, Help); `generatorai://agents` deep link; 1100 window → rail; no
console errors after reload. Desktop smokes on macOS: chrome 59/59, right-pane, terminal, browser, dock-browser pass.

## Matches
- DesktopMac: traffic lights in the 44px sidebar row, switcher (app name + "This computer"), Search ⌘K, nav, footer
  Connected + port + gear; rail mode with the drag row.

## Intentional deviations
- Tray menu is native (not capturable) — covered by `desktop-chrome-smoke`. No prompt sent (the packaged server runs
  real providers); chat flows with gates were walked on the web sandbox.

## Blocked
- DesktopWindows (36px strip, WCO caption buttons) and Linux rows need those OSes — CI matrix after a push.

## Defects (fixed)
- Switcher subtitle read "This computer (@generatorai/desktop)" (npm package name) → "This computer" (`6edece04`).
