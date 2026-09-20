---
description: Locate all application settings and understand which choices apply to a client, host, or execution.
---
# Settings

Settings groups application preferences, provider readiness, catalogs, integrations, security, storage, and diagnostics. The detailed [client settings reference](../clients/settings.md) describes individual controls and mobile differences. This page is the task-oriented index.

## Where to make a change

| Section | Use it to |
| --- | --- |
| General | Choose the default model for new chats and inspect application information |
| Appearance | Select mode, theme, and accent with a live preview |
| Model Providers | Inspect installed/connected/authenticated providers and their discovered models |
| Agents | Inspect or manage reusable agent availability |
| Skills | Search and preview built-in skills; control picker availability |
| MCP Servers | Add/configure tool connections and their inputs/credentials |
| Templates | Inspect workflow templates and create definitions from them |
| Source Control | Connect accounts and configure source-control/editor defaults |
| Browser & Terminal | Control web browser interaction and new terminal preferences |
| Computer Use | Enable supported desktop automation and takeover behavior |
| Audio | Select input device/recognition engine, punctuation behavior, and voice output |
| Extensions | Install, enable, reload, inspect, or uninstall hot-loaded packages |
| Security & Devices | Connect servers, inspect posture/network exposure, pair/revoke devices, and grant scopes |
| Storage | Configure automatic completed-workspace cleanup and retention |
| Diagnostics | Inspect server health, telemetry, sandbox configuration, runtime, and running-session state |

## Three kinds of setting

**Client preferences** include layout, appearance, some catalog choices, and terminal preferences persisted in that client. They may differ between a desktop installation and a browser connected to the same host.

**Host configuration** includes provider readiness, secret storage, server networking, paired-device grants, and execution capabilities. These refer to the server machine. Changing a mobile microphone preference does not install a provider executable on the host.

**Execution policy** includes the selected chat mode/model, agent runtime/capabilities, workflow stage settings, and automation iteration policy. A default setting does not necessarily overwrite an existing chat or a saved definition with its own explicit choices.

## Common checks

If a model is missing, inspect Model Providers for readiness and live discovery. If a tool is unavailable, inspect the agent's effective capabilities, MCP configuration, device scopes, and host support. If a workspace disappeared, inspect Storage retention and project worktree policy. If a stream appears stuck, inspect connection status and Diagnostics before creating duplicate work.

Provider authentication, operating-system permissions, and account entitlements remain external prerequisites. The interface exposes what the current host reports rather than assuming every configured provider is immediately ready.

## Source evidence

`apps/web/src/components/settings/sectionRegistry.tsx`, `apps/web/src/components/settings/sections`, `apps/web/src/stores/settingsUiStore.ts`, and `apps/web/src/lib/appPreferences.ts`.

## Configuration and worked examples

[Projects And Settings](../configuration/projects-and-settings.md), [Server](../configuration/server.md), [Cli](../configuration/cli.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
