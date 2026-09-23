---
title: Desktop application
description: Electron modes, navigation, workbench panels, native integration, development, and packaging.
---

# Desktop application

The desktop client is an Electron shell around the same React renderer used by the web client. The shell supplies a managed local backend, native menus and dialogs, secure credential storage, browser integration and process lifecycle management. It can also connect to a remote GeneratorAI host.

## Start the application

Run these commands from the repository root after installing the monorepo dependencies:

```bash
# Standalone: build resources, then launch Electron with its own backend.
pnpm --filter @generatorai/web build
pnpm --filter @generatorai/desktop preview
```

For hot reload, run the server and Vite first, then Electron in a second terminal:

```bash
# Terminal 1
pnpm dev

# Terminal 2
pnpm --filter @generatorai/desktop dev
```

The development launcher supplies `DESKTOP_DEV_SERVER_URL` for the renderer. Standalone startup waits for the embedded server health endpoint before loading the UI. An error window and logs provide recovery information when startup fails.

## Local and remote modes

Use **Server → This Computer** to use the managed backend. Use **Server → Add Server…** to register another endpoint, then select it from the Server menu. A server address identifies a route; pairing establishes trust in the host identity and grants this device scopes.

In remote mode, repository paths and terminal commands belong to the selected server. A native folder dialog on the desktop machine cannot choose a folder on a different server; project repository picking therefore uses a server-aware directory browser. Switching the renderer does not make a remote checkout local.

The embedded server normally listens on loopback. LAN access and pairing are managed in **Settings → Security & Devices**. The remembered server port keeps the renderer origin stable between launches, preserving origin-bound UI preferences and credentials.

## Navigation and workbench

The sidebar and command palette expose Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations and Settings. Detailed route coverage is in the [web client](./web.md), because both clients use `apps/web/src/router.tsx`.

A typical development session is:

1. Open or create a project and attach the intended codebase.
2. Start a chat or select an agent; choose a ready provider/model and appropriate permission mode.
3. Inspect streamed reasoning, tool activity and questions. Resolve approvals deliberately; cancelling a turn and closing a panel are different actions.
4. Open Changes to review the resulting workspace edits. Inspect files, run verification in Terminal, and use Browser for a generated application.
5. Use the source-control flow to prepare a commit or pull request only when ready to publish that work.

### Right-hand panels

The right pane owns tabs, tab persistence, resize, maximize and collapse. The default tab remains present; other allowed tabs can be added from **+** and closed individually. Panels keep their mounted state when switched, while expensive background work should respect the active tab flag.

| Panel | Purpose |
| --- | --- |
| Changes | Workspace diff, file selection, checkpoints, review comments and source-control actions |
| Files / opened file tabs | Browse and inspect files in a read-only viewer; use the agent, terminal or an external editor to edit |
| Terminal | One or more workspace-scoped PTY sessions with retained scrollback |
| Browser | Native embedded web contents in desktop, address/navigation/inspection and agent browser sharing |
| Plan | Read and act on the current plan |
| Background Tasks | Inspect spawned tasks and their lifecycle; open the associated chat |
| Computer | Host desktop automation frames, activity and consent where computer use is enabled |
| Widget | Extension-provided interactive content |
| Inspector | Workflow-run/stage inspection on the run page |

Available tabs depend on page type, workspace presence, provider activity and configuration. The pane turns into a full-width sheet when its host cannot accommodate readable side-by-side columns. Its state is scoped by chat/run, avoiding one conversation inheriting another's tabs.

## Native integration

The main process owns application menus, system tray, window state, single-instance handling, deep links, downloads, find-in-page, theme synchronization, updates and backend lifecycle. Native Save/Open operations use asynchronous dialogs. The preload bridge is exposed as `window.generatoraiDesktop`; the renderer should consume the bridge rather than importing Electron.

Useful menu shortcuts include:

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+N` | New chat |
| `Cmd/Ctrl+Shift+N` | New workflow |
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+B` | Toggle sidebar |
| `Cmd/Ctrl+Alt+B` | Toggle right panel |
| `Cmd/Ctrl+,` | Settings |
| `Cmd/Ctrl+F` | Native find-in-page |
| `Cmd/Ctrl+/` | Keyboard shortcut help |

The actual Go/View menu displays platform-specific navigation shortcuts. Use those labels as authority instead of assuming Windows and macOS share every chord.

## Data and packaging

User data contains `settings.json`, logs, and a `data` directory for the managed database, workspaces and artifacts. Typical OS roots are `~/Library/Application Support/GeneratorAI` on macOS, `%APPDATA%/GeneratorAI` on Windows and `~/.config/GeneratorAI` on Linux. A development backend and a standalone backend can have different data; an empty dashboard after switching modes does not necessarily mean data loss.

Current package scripts prepare the renderer, main/preload bundles, server bundle and staged runtime:

```bash
# Build an unpacked app for inspection.
pnpm --filter @generatorai/desktop package:dir

# Build configured installers.
pnpm --filter @generatorai/desktop package

# Validate release manifest requirements.
pnpm --filter @generatorai/desktop verify:release
```

The current scripts supersede older README advice describing server dependency staging as unfinished. Installer creation is not proof of signing, notarization, auto-update hosting or successful installation on every OS; those require release credentials and platform validation.

## Troubleshooting

- **Startup screen remains visible:** inspect **Help → Troubleshooting → View Logs** and server health. Confirm the web build and server resources exist.
- **Wrong projects or settings:** check the selected Server and whether you are using the development or managed data directory.
- **Cannot browse a repository:** check permissions and the path on the server machine.
- **Browser/terminal tab appears unavailable:** check workspace creation, feature scopes and server-side host readiness.
- **Native computer actions fail:** review Computer Use status and the OS permissions reported by the desktop driver. Browser permission alone does not grant desktop automation.
- **Preference disappears across launches:** inspect origin/port changes and native settings persistence before deleting data.

Sources: `apps/desktop/package.json`, `apps/desktop/src/main/{index,server-manager,backend-switcher,menu,window-manager,settings-schema}.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/scripts/`, `apps/web/src/components/layout/RightPane.tsx`, `apps/web/src/pages/ChatPage.tsx`.
