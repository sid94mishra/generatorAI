---
title: Settings and configuration surfaces
description: Every desktop/web settings section, its controls and persistence scope, plus mobile and CLI equivalents.
---

# Settings and configuration surfaces

Settings belong to different scopes. A theme preference is local to a client. A provider login, source-control account or enabled extension usually belongs to the selected server. Chat, stage and project configuration can override defaults for a particular piece of work. Check the selected server and the scope of a setting before expecting another device to inherit it.

## Desktop and web: all fifteen sections

The settings page is routed at `/settings/:section`; `/settings` opens General. The navigation registry groups sections into App, Agents, Integrations and System. The tables below document actual controls, not every internal configuration field supported by the server.

### General

Route: `/settings/general`. Select a **default model for new chats** from the model catalogue and inspect application information. This preference is stored in browser local storage at `generatorai:defaultChatModel`. It preselects future chat creation and does not rewrite existing conversations.

### Appearance

Route: `/settings/appearance`. Choose **System, Light or Dark**, a theme palette, and an accent. Preview cards show the resulting semantic colors. The registry provides both light and dark variants, theme-specific radius/fonts, and a shared accent selection. Local keys are `generatorai-theme`, `generatorai-theme-palette` and `generatorai-accent`. Desktop synchronizes the appearance mode with native menus/system theme. See [design system](../design/system.md).

### Model Providers

Route: `/settings/providers`. Inspect provider installation, client connection, authentication, readiness and models. Refresh/re-probe, initiate the provider's supported login flow, sign out, or select the default provider. Multiple ready providers can be used at once; the default handles requests that do not explicitly select another.

The surface calls `/api/harness/providers`, provider login/logout routes and `/api/harness/switch`. Installed, authenticated and ready are distinct states. A model appearing in cached data is not enough to prove the provider can execute it.

### Agents

Route: `/settings/agents`. Browse reusable agents, inspect configuration and enabled state, and open the dedicated agent editor. Agents package instructions with selected skills, MCP servers and capabilities, and can be bound to chats, workflow stages or an orchestrator team. Definition and enabled-state mutations are server-side administration.

### Skills

Route: `/settings/skills`. Inspect system skill artifacts and their contents, and enable or disable them. Disabled skills are removed from normal slash menus and pickers. This is a catalogue preference; it does not delete the underlying source artifact or edit a skill's Markdown in place.

### MCP Servers

Route: `/settings/mcp`. Browse built-in and custom servers, inspect source/type/command or URL, and enable or disable entries. Built-in entries can expose structured input/configuration fields. Add or edit custom local-command and remote-URL connections, arguments, environment variables/headers and timeout. Header/environment key names may be displayed without exposing stored secret values.

These servers extend an agent's tool catalogue. This settings page is unrelated to launching the outbound [GeneratorAI MCP bridge](./sdk-mcp.md). A saved configuration still needs a successful connection and provider-compatible tool setup.

### Templates

Route: `/settings/templates`. Browse workflow templates and create a workflow from a selected template. The resulting definition can then be configured in the workflow editor; a template catalogue entry is not an already running workflow.

### Source Control

Route: `/settings/source-control`. Connect accounts using the methods the server advertises: GitHub device sign-in, a pasted token or the host's GitHub CLI. Support includes multiple accounts and GitHub Enterprise hosts. Select the default account, disconnect accounts, select the model/provider for generated commit and pull-request text, choose an editor, and set a fallback base branch.

Configuration maps to source-control settings fields such as `defaultAccountId`, `generation`, `editor.defaultEditor` and `defaultBase`. Tokens are submitted to the server and are not returned in account-list responses. Repository remote-host matching helps select an account. Connecting a source-control account does not grant an agent provider login, or vice versa.

### Browser & Terminal

Route: `/settings/browser-terminal`.

| Control | Scope / effect |
| --- | --- |
| Allow full browser interaction | Web-only local preference `generatorai:browser:webInteractivity`; desktop already has native interaction |
| Default shell | Local `generatorai:terminal:shell`; applied when creating a terminal on the server |
| Load PowerShell profile | Local `generatorai:terminal:loadPwshProfile`; shown when server health reports Windows |
| Allow SSH agent / AWS session environment | Local `generatorai:terminal:allowSecrets`; opts into sensitive server-environment inheritance |

Changing spawn preferences affects the next terminal session, not the already running shell. Platform-specific controls use the server OS, because the browser may be on a different machine.

### Computer Use

Route: `/settings/computer-use`. Inspect the desktop driver and readiness, enable computer use, and separately allow actions that take over the screen. The latter permits input requiring focus, such as keystrokes, hotkeys, scroll and drag. With foreground actions disabled, operations that require screen takeover are refused rather than silently focusing an application.

This host capability is off by default and is separate from browser automation. Per-device `exec:computer`, application consent/grants and OS accessibility/screen permissions remain relevant after enabling it.

### Audio

Route: `/settings/audio`. Inspect/download/remove the server speech-recognition model; select the local microphone; configure speech-to-text engine, spoken punctuation and pause before committing; enable voice output, choose a voice and set speaking speed.

The microphone choice lives in the client's microphone preference store. Recognition-model lifecycle and audio settings use the server platform API (`getAudioSettings`, `setAudioSettings`, `getSpeechModelStatus`, `downloadSpeechModel`, `deleteSpeechModel`). Browser microphone permission, available hardware and secure-context rules are additional runtime requirements.

### Extensions

Route: `/settings/extensions`. Install from an absolute host folder containing `extension.json`, inspect installed contributions, enable/disable and uninstall. Use User scope in the current Settings form: its Workspace choice does not supply the required `workspaceId`. Workspace installation needs an API request with explicit workspace context. Installation copies and hot-loads the extension into the target scope. Uninstall removes that installed folder and is presented as a destructive action.

A path entered here is on the server, not an upload from the browser's filesystem. The current extension manager activates widgets and custom tools. MCP, command, hook, skill and prompt contributions are staged, but their registration into the corresponding services is not wired end to end. Contribution counts therefore do not prove those features are usable. See [Extensions and widgets](../features/extensions.md) for the current installation and contribution limits.

### Security & Devices

Route: `/settings/security`. Inspect configured servers, active host identity, authentication status, secret-storage protection and relay status. Manage LAN/network access, mint pairing codes/QRs with device name and selected capabilities, include relay routing where supported, cancel unused invitations, review access requests, adjust paired-device capabilities and revoke credentials. Revoked devices remain distinguishable from active ones.

The server enforces scopes; hiding or disabling a control is only the client's explanation of that policy. A trusted administrator grants `admin:*` capabilities. Pairing credentials and host fingerprints should not be copied into public documentation, screenshots or logs.

### Storage

Route: `/settings/storage`. Enable nightly cleanup, choose retention days and run cleanup immediately. This configures workspace retention through `setWorkspaceRetention`; immediate cleanup uses `runWorkspaceRetention`. Read the current retention description and result before assuming it deletes all data: workspace retention is distinct from database backup, chat history and application uninstall.

### Diagnostics

Route: `/settings/diagnostics`. Refresh the server health snapshot and inspect OpenTelemetry status/service/endpoint, sandbox execution availability/provider/image/auto-destroy, runtime storage/streaming information, server time and running-chat counts. Much of this section is read-only status. Use server configuration to change telemetry or sandbox deployment; a displayed status row is not necessarily an editable preference.

## Mobile settings

The mobile settings index and eleven detail screens use a different information architecture:

| Route | Controls and purpose |
| --- | --- |
| `/settings` | Connection/provider overview and links to detail screens |
| `/settings/appearance` | Local mode, theme and accent |
| `/settings/accessibility` | System/reduced/full motion, haptics, push-to-talk, text-size status, collapsing titles, high contrast, app lock and grace period |
| `/settings/notifications` | Permission/registration status and switches for approvals/questions, run outcomes and chat replies |
| `/settings/security` | Key protection, current scopes, request/refresh access, host posture, unpair; scoped device administration and pairing |
| `/settings/providers` | Provider readiness, re-probe and default selection |
| `/settings/tools` | Capability explanations and access status for terminal, browser, voice, attachments and workflow actions |
| `/settings/capabilities` | Skills, agents, prompts and MCP catalogue; permitted administration |
| `/settings/source-control` | Account connection and source-control preferences through the scoped API |
| `/settings/extensions` | Installed extensions and permitted enablement |
| `/settings/diagnostics` | Server/transport/key backing information and reconnect diagnostics |
| `/settings/about` | App information and capability summary; some summary copy predates current review features |

Notification category preferences are device-local. Foreground filtering honors the categories independently. The server's push mute contract combines non-approval categories: it mutes them when both run outcomes and chat replies are disabled; approval behavior is separately protected. Native push requires the EAS project configuration as well as OS permission.

App lock is local privacy protection, not revocation of the host credential. Device revocation and unpairing are separate operations. Mobile administration still requires grants from the host; an ordinary device cannot self-upgrade to administrator.

## CLI and native-shell configuration

The [CLI](./cli.md) exposes `config show --sources`, `config get/set/unset`, profiles and keymap controls. Its local schema covers output, connection, timeout, TUI appearance/rendering, layout and input preferences. Provider, device and source-control command groups operate on server resources.

The Electron shell separately persists theme mode, server port, harness bootstrap selection, minimize-to-tray, last route, window state and server connections in its native settings. This file is not a complete mirror of the server settings or renderer local storage. The shell's legacy harness schema is narrower than the runtime model-provider catalogue; use the provider UI rather than assuming editing that file enables every harness.

## Source map

Section definitions: `apps/web/src/components/settings/sectionRegistry.tsx`. Controls: `apps/web/src/components/settings/sections/`. Local keys: `apps/web/src/lib/appPreferences.ts`, `packages/design-tokens/src/registry.ts`, `apps/web/src/stores/`. Mobile: `apps/mobile/app/settings/`, `apps/mobile/src/prefs/`, `apps/mobile/src/auth/featureGate.ts`. Native shell: `apps/desktop/src/main/{config,settings-schema}.ts`. CLI: `packages/cli-core/src/config/schema.ts`.
