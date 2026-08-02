# @generatorai/desktop

A native **Electron** desktop application for GeneratorAI with **full feature and look‑and‑feel parity** with the web UI, and full capability parity with the CLI at the API layer.

## How it works (architecture)

The desktop app does **not** reimplement the UI. It runs the real, unmodified GeneratorAI web SPA, served by an embedded instance of the real GeneratorAI server. This guarantees zero UI divergence and automatic parity with every feature the web app and CLI already expose.

```
┌─────────────────────────── Electron main process ───────────────────────────┐
│  ServerManager  ── spawns ──▶  GeneratorAI server (NODE_ENV=production)       │
│   • picks a free loopback port                 • serves apps/web/dist at  /   │
│   • data dirs under userData/data              • serves REST + SSE at /api    │
│   • waits for GET /api/health                                                 │
│   • graceful SIGTERM shutdown on quit                                         │
│                                                                               │
│  WindowManager · Menu · Tray · Deep links · Downloads · IPC · Auto‑update     │
└───────────────────────────────────┬───────────────────────────────────────--┘
                                     │ loads http://127.0.0.1:<port>/
                                     ▼
                       BrowserWindow (the web SPA, same‑origin)
                       preload → window.generatoraiDesktop bridge
```

Because the window loads the web app **same‑origin** from the embedded server:

- All relative `/api` calls, the `EventSource` SSE stream, `localStorage` (theme, API key), and routing work **unchanged** — no CORS, no web code edits.
- The native shell adds: application menu (navigates every route), system tray, deep links (`generatorai://…`), native Save/Open dialogs, OS‑theme sync, window‑state persistence, single‑instance lock, splash + error screens, crash auto‑restart, and an auto‑update scaffold.

## Run it

Prerequisites: from the repo root run `pnpm install` once. (If Electron's binary fails to extract on Windows, see Troubleshooting.)

### Standalone (the real product — embedded server)

```powershell
# Build the web SPA the server will serve, then launch the desktop app.
pnpm --filter @generatorai/web build
pnpm --filter @generatorai/desktop start
```

`start` builds the main/preload bundle and launches Electron. With no dev‑server env set, the app spawns its **own** embedded server (production mode) on a free port, using an **isolated** data directory under the OS user‑data folder, and opens onto it.

### Dev (web HMR via the existing dev servers)

```powershell
# Terminal 1 — the normal dev servers (server :3100 + web :5173)
pnpm dev

# Terminal 2 — Electron attached to the Vite dev server (full HMR)
pnpm --filter @generatorai/desktop dev
```

`dev` sets `DESKTOP_DEV_SERVER_URL=http://localhost:5173`; the app attaches to that instead of spawning its own server.

## Project layout

```
apps/desktop/
├── src/
│   ├── main/            Electron main process
│   │   ├── index.ts            lifecycle + orchestration
│   │   ├── server-manager.ts   embedded server spawn / health / restart / shutdown
│   │   ├── window-manager.ts   splash + main window + state persistence + navigation
│   │   ├── menu.ts             native application menu (all routes + actions)
│   │   ├── tray.ts             system tray
│   │   ├── ipc.ts              IPC handlers (dialogs, theme, server status, settings)
│   │   ├── downloads.ts        native Save‑As for in‑app downloads
│   │   ├── deep-link.ts        generatorai:// protocol
│   │   ├── updater.ts          electron-updater scaffold
│   │   ├── config.ts           settings store (userData/settings.json)
│   │   ├── paths.ts            dev vs packaged path resolution
│   │   ├── ports.ts            free‑port discovery
│   │   └── logger.ts           file + console logging
│   ├── preload/index.ts  contextBridge `window.generatoraiDesktop` + native picker shim
│   └── shared/ipc.ts     IPC channel + payload contract
├── resources/            splash.html, error.html, generated icons
├── scripts/              dev launcher + icon generator
├── tsup.config.ts        bundles main/preload → CJS
└── package.json          electron, electron-builder, tsup, electron-updater
```

## Configuration & data

Runtime data is isolated per‑user and never collides with a dev server:

| What | Location |
|---|---|
| SQLite DB | `<userData>/data/generatorai.db` |
| Workspaces | `<userData>/data/workspaces` |
| Artifacts | `<userData>/data/artifacts` |
| Settings | `<userData>/settings.json` |
| Logs | `<userData>/logs/main.log` |

`<userData>` is `%APPDATA%/GeneratorAI` (Windows), `~/Library/Application Support/GeneratorAI` (macOS), `~/.config/GeneratorAI` (Linux).

The embedded server is launched with `HARNESS_TYPE` (default `copilot`) from settings, `WEB_DIST_DIR` pointed at the built SPA, `CORS_ORIGINS` set to the loopback origin, and `NODE_ENV=production`. Override the Node used to spawn the server with `GENERATORAI_DESKTOP_NODE`.

## Native features

- **Application menu** — File / Edit / Go / View / Server / Window / Help. Every page is reachable (`Cmd/Ctrl+1..8`), plus New Chat/Workflow/Project/Automation, Reload Scripts, Back/Forward, Restart Server, Open Data Folder, View Logs, Health, API Docs.
- **System tray** — open, quick navigation, live server state, restart, quit.
- **Deep links** — `generatorai://chats/<id>`, `generatorai://workflows`, etc.
- **Native downloads** — in‑app downloads route through a native Save‑As dialog and reveal in the file manager.
- **Native folder picker** — the web's `showDirectoryPicker` is transparently backed by the OS dialog.
- **OS theme sync** — follows the system light/dark setting (`nativeTheme`); the in‑app Settings → Appearance toggle still works.
- **Window state** persisted across launches; **single‑instance** lock; **splash** screen during boot; **error** screen on failure with auto‑restart.

## Testing

A scripted end‑to‑end smoke test launches the standalone app (embedded server) and drives real flows (health, templates, create‑workflow‑from‑template + DB persistence, React Flow builder, New Chat dialog):

```powershell
pnpm --filter @generatorai/web build      # the server serves this
node agent-tests/desktop-smoke.mjs
```

## Packaging (productionization)

`electron-builder` config lives in `package.json` (`build`). Targets: NSIS (Windows), DMG (macOS), AppImage (Linux). The server `dist`, web `dist`, and `templates` are bundled as `extraResources`, and `better-sqlite3` is unpacked from the asar.

Two productionization steps are required for a distributable installer:

1. **Build server + web first** — `pnpm build` (root) so `apps/server/dist` and `apps/web/dist` exist for `extraResources`.
2. **Native ABI for `better-sqlite3`** — when the packaged app runs the server on Electron's bundled Node, rebuild the native module for Electron's ABI:
   ```powershell
   pnpm --filter @generatorai/desktop rebuild   # @electron/rebuild -f -w better-sqlite3
   pnpm --filter @generatorai/desktop package
   ```
   (In dev/standalone the server runs on system Node via `tsx`, so the prebuilt binary already matches — no rebuild needed.)

> Note: bundling the monorepo server's full dependency tree into the installer (the workspace `@generatorai/*` packages + their deps) is the one remaining packaging task; the recommended approach is to esbuild‑bundle `apps/server` into a single self‑contained file with `better-sqlite3` kept external. The dev and standalone run paths above are fully functional today.

## Troubleshooting

- **"Electron failed to install correctly"** — pnpm occasionally completes Electron's postinstall without extracting the binary. Extract the cached zip manually:
  ```powershell
  $zip = "$env:LOCALAPPDATA\electron\Cache\<hash>\electron-v33.4.11-win32-x64.zip"
  $dist = "node_modules\.pnpm\electron@33.4.11\node_modules\electron\dist"
  Expand-Archive $zip $dist -Force; "electron.exe" | Set-Content -NoNewline "$dist\..\path.txt"
  ```
- **Server won't start** — open the error screen's message, then Server → View Logs (`<userData>/logs/main.log`). The embedded server logs are prefixed `[server]`.
- **Port already in use** — the app picks a free port automatically; set `serverPort` in `settings.json` to pin one.
