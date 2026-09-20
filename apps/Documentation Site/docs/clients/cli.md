---
title: CLI and terminal workbench
description: Command groups, connection setup, configuration, interactive panes, and companion RPC.
---

# CLI and terminal workbench

The CLI offers three surfaces behind one binary: scriptable commands, an interactive terminal UI, and a machine-oriented companion gateway. Commands are declared once in `packages/cli-core` and projected into Commander, completion scripts, TUI forms and companion methods.

## Run from this repository

```bash
# Inspect the source CLI without a published package.
pnpm --filter @generatorai/cli dev --help
pnpm --filter @generatorai/cli dev system health

# Produce compiled and distributable bundle outputs.
pnpm --filter @generatorai/cli build
pnpm --filter @generatorai/cli bundle
node apps/cli/dist-bundle/generatorai.mjs --help
```

The package declares the binary name `generatorai` and Node.js 22 or newer. Examples below use that binary name; substitute the source launcher or bundled entry if it is not installed on your PATH.

## Connect and pair

```bash
generatorai connect add http://localhost:3100 --label local
generatorai connect use local
generatorai device pair '<pairing-code-or-url>'
generatorai device status
generatorai system health
generatorai system doctor
```

Create the invitation from a trusted client, then confirm the host identity when pairing. A connection can contain several routes to the same server; `connect endpoint add` and `connect resolve` manage and inspect them. `--server` bypasses the connection catalogue for that invocation, and `--connection` selects a named entry. The legacy `--api-key` option remains for compatibility but is not the preferred pairing flow.

## All command groups

Use `generatorai <group> --help` and then `<verb> --help` for the exact argument and flag contract. Required arguments, destructive semantics and streaming output are part of the registry, not assumptions inferred from a command name.

| Group | Responsibilities |
| --- | --- |
| `connect` | Add/use/test/rename/remove hosts and alternate endpoints |
| `device` | Pair, credential status/forget, invitations, devices, scopes, revocation and auth audit |
| `chat` | Create/list/show/update/archive/delete chats, send/watch/cancel turns, messages, plans, tasks and permission mode |
| `agent` | List/show/import/export/delete/resolve agents and inspect usage |
| `workflow` | Definitions, stages, edges, variables, hooks and authoring operations |
| `run` | Start and inspect runs, stream progress, control lifecycle and answer interactions |
| `automation` | Create/update/enable/disable/trigger, executions, datasource checks and webhook-token rotation |
| `project` | Projects, codebases, settings, resources and repository operations |
| `workspace` | Workspace files, diffs, checkpoints and file-oriented operations |
| `terminal` | PTY creation, listing, attachment and lifecycle |
| `browser` | Start/stop/status, navigation, page/DOM reading, screenshots and snapshots |
| `computer` | Host desktop status/activity/frames, consent, grants and runtime control |
| `script` | Programmatic workflow discovery, detail, profiles and run operations |
| `template` | List and inspect workflow templates; create definitions with `workflow from-template` |
| `orchestrator` | System workflows and orchestrated execution |
| `extension` | List, inspect, reload, enable/disable and uninstall extensions; installation uses another client or the API |
| `widget` | Agent-rendered widget data and actions |
| `review` | Review threads and comments on workspace files |
| `hook` | List session hooks, inspect supported phases and test hooks; stage hook mutations live under `workflow stage hook` |
| `webhook` | Incoming/outgoing webhook configuration |
| `harness` | Provider catalogue, readiness and default-provider selection |
| `source-control` / `scm` | Provider/repository status and configuration; create pull requests through `workspace pr` |
| `security` | Server posture, device/security administration and audit |
| `system` | Health, non-secret config, models, system artifacts, MCP servers, version and diagnostics |
| `config` | Local preferences, profiles, provenance and keymap overrides |

Additional entry-point commands are `tui`, `companion`, `completions` and the internal completion helper. A registry entry is an exposed operation, not proof of full interactive parity with the visual client.

## Structured output and configuration

Global output flags include `--json`, `--ndjson`, `--yaml`, `--quiet`, `--no-color` and `--no-unicode`. Use NDJSON for incremental stream processing. Diagnostics belong on stderr so stdout remains machine-readable. `--timeout` bounds a command; `--yes` bypasses supported confirmation prompts and should be used deliberately for scripted mutations.

```bash
generatorai --json chat list
generatorai --ndjson chat watch '<chat-id>'
generatorai config show --sources
generatorai config get tui.maxFps
generatorai config set tui.maxFps 30
generatorai config profile list
generatorai config keymap list
```

Configuration is schema-validated and layered. `config show --sources` reports provenance; `config path` reports the user file. Profiles override server/CLI/TUI choices. Important settings include server URL and timeout, default model/project, page size, theme/appearance/accent, maximum redraw rate, mouse reporting, alternate screen, layout restore, polling interval, thinking/tool display, graphics protocol and keymap overrides.

Mouse reporting defaults off to preserve ordinary terminal selection. Incremental rendering also defaults off because shortened lines and wide characters can leave stale cells; full redraw is the conservative default. Do not enable secret-revealing output in shared logs.

## Interactive workbench

A bare invocation opens the TUI only on a TTY outside CI. Use `generatorai tui` or `-i` explicitly. Piped bare invocations display help instead of taking over stdin. `generatorai tui --restore` restores tabs; `--inline` keeps the view in normal scrollback for recordings or accessibility workflows.

The workbench includes dashboard/list/detail panes, chat transcript and composer, workflow definition/run views, automation forms, workspace files, diffs/review, terminals, browser preview, computer consent and administration views. Registry-backed forms gather typed command inputs; list, pane and overlay contexts determine active keys.

| Key | Default action |
| --- | --- |
| `Ctrl+K` or `Ctrl+P` | Command palette |
| `?` | Context-aware help outside text entry |
| `Tab` / `Shift+Tab` | Move focus between regions |
| `Esc` | Back or close current overlay |
| `Ctrl+R` | Refresh view |
| `Ctrl+G` | Toggle right pane |
| `Ctrl+T` | Cycle theme |
| `g d`, `g c`, `g w`, `g r` | Dashboard, Chats, Workflows, Runs |
| `g a`, `g p`, `g o`, `g e` | Automations, Projects, Workspaces, Agents |
| `g s`, `g x`, `g ,`, `g m` | Scripts, Extensions, Settings, Administration |
| `Alt+L` | Enter pane-leader context; consult help for split/tab controls |

The declared keymap is the authority and supports remapping. Some modified key combinations depend on terminal keyboard-protocol support. Printable shortcut characters must remain text when a composer or form owns focus.

## Companion and external tools

```bash
generatorai companion --stdio
generatorai companion --socket '<socket-path>'
generatorai completions zsh
```

The companion speaks NDJSON requests/responses and exposes registry operations plus host-only capabilities. It is distinct from the [MCP server package](./sdk-mcp.md). Completion generation supports the shells in `packages/cli-core/src/registry/toCompletions.ts`; install the generated text using your shell's normal configuration procedure.

## Troubleshooting

Use `system doctor` for connection, credentials and terminal capability problems. Inspect `device status` for the actual credential and `connect resolve` for the selected route. A successful list command does not imply write/admin scopes. For slow streaming, inspect the TUI client diagnostics pane as well as server health; server diagnostics cannot report client render queue depth.

Sources: `apps/cli/src/index.tsx`, `apps/cli/src/session.ts`, `apps/cli/src/tui/`, `apps/cli/src/companion/server.ts`, `packages/cli-core/src/commands/`, `packages/cli-core/src/config/schema.ts`, `packages/cli-core/src/keymap/Keymap.ts`, `packages/tui-kit/src/`.
