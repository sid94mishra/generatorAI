---
title: Clients and capability matrix
description: How desktop, web, mobile, CLI, and programmatic interfaces connect to GeneratorAI.
---

# Clients and capability matrix

GeneratorAI has four user-facing clients: an Electron desktop application, a React web application, an Expo mobile application, and a command-line application with an interactive terminal workbench. They share server contracts and domain services; they do not expose identical controls.

This documentation describes the checked-out source. A screen or command existing does not prove a provider, native driver, credential, or network route will work in a particular installation. The [architecture overview](../architecture/overview.md) explains the server and worker processes behind these clients.

## Choose a client

| Client | Best suited to | Runtime and connection |
| --- | --- | --- |
| [Desktop](./desktop.md) | Authoring, long chats, code review, browser and terminal work | Electron shell around the web renderer; embedded local server or a selected remote server |
| [Web](./web.md) | The main visual authoring surface from a browser | React/Vite SPA talking to a separately running server |
| [Mobile](./mobile.md) | Monitoring, approvals, chat, review, and scoped remote actions | Expo/React Native for iOS and Android; paired connection to a host |
| [CLI and TUI](./cli.md) | Scripts, terminal-first operation, automation and interactive panes | Node process, shared command registry, HTTP/SSE/WebSocket client |
| [SDK and MCP bridge](./sdk-mcp.md) | In-repository embedding and experimental external MCP access | Separate in-process engine composition; not a published HTTP SDK |

## Capability matrix

“Scoped” means the server must grant the device the necessary permissions. All clients remain subject to provider readiness, server configuration, and operating-system support.

| Capability | Desktop / web | Mobile | CLI / TUI |
| --- | --- | --- | --- |
| Dashboard and current activity | Dashboard with navigation and summaries | Home with attention queue and active work | Dashboard pane and diagnostic commands |
| Projects and codebases | Create/edit projects; local paths or Git remotes; repository detail | Create/edit with `write:projects`; add Git URL; cannot browse a host folder picker | Project/codebase commands and panes |
| Agent definitions | Dedicated list/editor and settings catalogue | Agent detail/catalogue; selected administration requires `admin:settings` | List/show/import/export/delete/resolve/usage; administration views |
| Chat | Streaming composer, configuration, attachments, questions and plans | Streaming composer, model/options sheets, captures, voice, attachments with scope | Chat commands and interactive transcript/composer |
| Workflow authoring | Visual DAG builder and definition configuration | Definition inspection and template-derived creation; full graph editing opens host web UI | Registry commands and TUI definition/stage/edge forms |
| Workflow runs | Start, monitor, inspect stages, answer gates, control lifecycle | Monitor and approve; start/pause/cancel with run-control scopes | Run commands, watch streams and interactive controls |
| Script workflows | Discover, inspect, materialize and run | Script detail and start form | Script commands, including file-oriented operations |
| Automations | Create/configure/enable/trigger and inspect executions | Inspect existing automation, enable/disable and trigger when scoped; full authoring on web/desktop | Automation commands and TUI forms |
| Changes and review | Diffs, checkpoints, comments, keep/undo and source-control flows | Diffs, review comments/checkpoints and scoped source-control flows | Workspace diff/review commands and diff pane |
| Workspace files | File tree and read-only preview; open in an external editor | Tree, code/Markdown preview, copy/share; no general file editor | Read/write/upload/download and host editor flows |
| Terminal | Server-side PTY in an xterm panel | Native WebView terminal with `exec:terminal` | PTY attach and interactive terminal panes |
| Browser | Desktop native view or web screencast/controls | Remote preview/navigation, capture and scoped control | Browser commands and preview pane |
| Computer use | Host-driver control and consent when enabled | View frames, consent/grants with `exec:computer` | Status/activity/frames/consent/grant commands and pane |
| Interactive widgets | Extension widget surfaces | No equivalent full widget renderer | Widget commands and terminal-oriented surface |
| Notifications and app lock | Native desktop notifications; OS-dependent integration | Push categories, approvals, local biometric/passcode lock | Blocked-work queue inside TUI |
| Administration | Fifteen [settings sections](./settings.md) | Twelve settings routes with a narrower set of controls | Config, provider, security, device and integration command groups |

## What is shared

The clients reuse `@generatorai/client-core` for the platform API and `@generatorai/client-runtime` for runtime behavior. Transport, pairing, stream restoration, and platform storage are adapted to the host. `@generatorai/design-tokens` provides semantic themes for web, native and terminal output. The application engine stays on the server/host, so closing a phone or browser is not the same as cancelling server work.

The mobile bundle deliberately resolves the browser-safe shared entry and excludes Node server internals. The Electron preload exposes a bounded native bridge rather than giving React unrestricted Node access. The CLI command registry projects the same command definitions into Commander, command forms, completion scripts and companion RPC.

## Evidence and maintenance

Primary sources: `apps/web/src/router.tsx`, `apps/desktop/src/main/index.ts`, `apps/mobile/app/`, `apps/mobile/src/auth/featureGate.ts`, `apps/mobile/src/components/chat/panes/paneModel.ts`, `apps/cli/src/index.tsx`, `packages/cli-core/src/commands/index.ts`, `packages/sdk/src/index.ts`, and `packages/mcp-server/src/cli.ts`.

The old mobile About screen and some repository READMEs understate newer review/source-control features or describe older packaging. This matrix follows the implemented screens and current package scripts. Re-check those sources when a capability changes.
