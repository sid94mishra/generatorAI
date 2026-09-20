# Project, host and client preferences

These settings complement the [generated schemas](./index.md). Several routes validate their bodies manually, and several preferences live only on a client. The tables distinguish declared fields from the place they are applied.

## Project and codebase settings

Create a project with `name`, optional `description` and optional `settings`; update adds `status` (`active` or `archived`). The current route requires a non-empty name but does not run a complete Zod validator over `ProjectSettings`. Do not treat its TypeScript interface as runtime validation.

| Project setting | Declared value | Meaning / limit |
| --- | --- | --- |
| `defaultModel` | string | Project model preference; explicit execution configuration can supersede it |
| `defaultSessionMode` | `single`, `per-stage`, `auto` | Declared project session preference; inspect the saved workflow/run's resolved mode |
| `maxCodebases` | number | Project codebase setting; it does not override separate chat source-count limits |
| `worktreeRetention` | `immediate`, `hours-24`, `hours-72`, `manual` | Project worktree policy; distinct from global completed-workspace cleanup |
| `autoFetchInterval` | number | Declared project interval; do not infer units from the codebase field below |
| `harnessConfig` | partial harness config | Project-level provider/runtime configuration; consumers determine effective merging |

A codebase requires `alias` and `type` (`git-remote`, `git-local`, `local-dir`), plus the appropriate `url` or host `localPath`. Optional fields are `defaultBranch`, `subdirectory`, and `settings`. Update supports correcting the URL/path as well as alias/branch/subdirectory/settings.

| Codebase setting | Declared value | Use |
| --- | --- | --- |
| `autoFetchEnabled` | boolean | Automatic fetch preference |
| `autoFetchIntervalMinutes` | number | Interval explicitly in minutes |
| `shallowClone` | boolean | Shallow-clone preference |
| `worktreeInclude` | string array | Extra paths included during worktree setup |

These are declared contracts; readiness, host filesystem/Git behavior and each service's actual consumption remain authoritative. The [project guide](../features/projects.md) explains local folders, Git sources, lifecycle and cleanup.

Example bodies for a trial repository:

```json
{ "name": "Issue tracker trial", "description": "Disposable documentation walkthrough" }
```

```json
{
  "alias": "app",
  "type": "git-local",
  "localPath": "/path/to/trial-repository",
  "defaultBranch": "main"
}
```

Send the first to `POST /api/projects`, then the second to `POST /api/projects/:id/codebases` with the actual ID and an existing host path. Inspect readiness and errors before selecting it in a chat. These illustrative bodies are reviewed against the route and TypeScript contracts rather than included in the shared-schema example validation count.

## Host audio preferences

Settings → Audio uses `/api/system/audio`. The update is partial; omitted fields retain their stored values. Storage is beside the database in the host data directory.

| Field | Choices / limits | Default |
| --- | --- | --- |
| `sttEngine` | `auto`, `nemotron`, `moonshine`, `parakeet`, `whisper` | `auto` |
| `textFormatter` | `rule-based`, `none` | `rule-based` |
| `endpointSilenceMs` | integer 200–3000 ms | `800` |
| `interimResults` | boolean | `true` |
| `ttsEnabled` | boolean | `true` |
| `ttsVoice` | non-empty string, up to 64 characters | `af_heart` |
| `ttsSpeed` | 0.5–2.0 | `1` |

For slower speech, a partial preference body is `{"endpointSilenceMs":1200,"ttsSpeed":0.9}`. Engine selection does not download every engine's weights; inspect model readiness separately. Microphone permission and device choice are client-side concerns.

## Computer use and workspace retention

| Surface | Fields and defaults | Important behavior |
| --- | --- | --- |
| `/api/system/computer-use` | `enabled` required boolean; `allowSynthetic` optional boolean; default both off | Synthetic input can take screen focus; persisted disable and operator kill switch must be respected |
| `/api/system/workspace-retention` | `enabled` required boolean; `retentionDays` optional integer 1–365; defaults off/30 days | Applies to eligible workspaces; it is not database backup or a general history-deletion policy |

Use the visible Settings controls for these host-wide preferences. Global event-payload TTL, artifact retention, worktree retention, browser idle pause, and workspace cleanup are different mechanisms with different objects and defaults. Their schema fields are listed in [Server runtime](./server.md); inspect the [storage architecture](../architecture/data-and-storage.md) before changing retention.

## Source-control preferences

`PUT /api/source-control/settings` accepts a partial object. Omitted properties stay unchanged; supported nullable values clear a preference.

| Field | Accepted value |
| --- | --- |
| `defaultAccountId` | string or `null`; use an actual connected account ID |
| `generation.provider` | string or `null` |
| `generation.model` | string or `null`; use a live model catalogue value |
| `editor.defaultEditor` | `vscode`, `vscode-insiders`, `cursor`, `windsurf`, or `null` |
| `defaultBase` | non-empty branch string or `null` |

```json
{
  "generation": { "provider": null, "model": null },
  "editor": { "defaultEditor": "vscode" },
  "defaultBase": "main"
}
```

Null generation settings select the service's heuristic path instead of an explicitly chosen model. Accounts are created through the supported sign-in flows, not by writing arbitrary entries into the returned `accounts` array. Available login methods depend on host capabilities. Chat `sourceControl` is a separate, route-validated execution policy; review commit/push/PR controls for that chat rather than assuming host account configuration enables automatic publication.

## Pairing, networking and device grants

Settings → Security & Devices owns network exposure, invitations, paired-device names/scopes and revocation. The [route contracts](./route-contracts.md) include pairing TTL, device public-key inputs, platform metadata, push registration and mute payloads. The [security architecture](../architecture/security.md) explains authenticated requests and scope enforcement.

Configure in this order: select the intended server, verify host identity and protected secret storage, choose the required exposure mode, create a time-limited invitation with appropriate capabilities, then pair and inspect the resulting device. A device can request additional access; it cannot grant itself administrator capabilities. Relay reachability and encrypted transport are separate from trusting the relay operator. Never copy an actual pairing token, refresh token or private key into an example.

## Desktop and web local preferences

| Preference | Storage / behavior |
| --- | --- |
| Default new-chat model | `generatorai:defaultChatModel`; empty means no explicit local preference |
| Mode | `generatorai-theme`; `system`, `light`, `dark`; application renderer default dark |
| Palette | `generatorai-theme-palette`; one of 17 registered palettes, default `github` |
| Accent | `generatorai-accent`; blue/violet/green/orange/rose/teal; initial choice follows the palette default |
| Web browser interaction | `generatorai:browser:webInteractivity`; local browser-client opt-in |
| Terminal shell | `generatorai:terminal:shell`; used when opening a new host terminal |
| PowerShell profile | `generatorai:terminal:loadPwshProfile`; relevant to Windows hosts |
| Sensitive terminal environment | `generatorai:terminal:allowSecrets`; governs supported SSH/AWS environment inheritance |
| Pane state | Per-entity selected tabs plus shared size/maximize/collapse preferences; does not configure host execution |

The Electron `settings.json` additionally stores `theme` (default system), `serverPort` (0 means automatic), `lastServerPort`, `harnessType` (legacy `copilot`/`claude-agent`/`anthropic`), `minimizeToTray` (false), `lastRoute`, `window` and `servers`. Default window size is 1440 × 900. Valid ports are integers 0–65535; window width is 200–20000 and height 150–20000. Route values must be SPA paths, not arbitrary URLs. The renderer IPC only exposes a whitelist of these keys. Native shell defaults are distinct from web-renderer defaults and the current multi-provider runtime catalogue.

## Mobile local preferences

| Setting | Values / default | Scope |
| --- | --- | --- |
| Appearance | Mode/palette/accent axes from the shared registry | This device |
| Motion | `system` (default), `reduced`, `full` | Navigation and component animations |
| Haptics | Boolean; default on | Supported device feedback |
| App lock | Boolean; default off | Local privacy lock, not host credential revocation |
| Lock grace | 0, 60, 300, 900 seconds; default 60 | Time in background before rearming |
| Collapsing large titles | Boolean; default on | Screen chrome |
| Text size / contrast | OS accessibility settings and the app's supported adaptations | Verify with the native renderer |
| Approval/question notifications | Default on | Foreground presentation; server approval delivery has separate policy |
| Run outcomes | Default on | Foreground category filtering and combined background mute |
| Chat replies | Default off | Foreground category filtering and combined background mute |

When both non-approval categories are off, the client requests a server mute for those categories. Disabling only one does not provide independent background filtering for that category. Native permissions, EAS push configuration and current connection status also affect delivery. The mobile [settings matrix](../clients/settings.md#mobile-settings) includes providers, source control, extensions, tools, diagnostics and scoped administration.

## Sources

`packages/shared/src/types/Project.ts`, `apps/server/src/routes/{projects,system,sourceControl,auth}.ts`, `apps/server/src/settings/{audio,computerUse,workspaceRetention}.ts`, `apps/desktop/src/main/{config,settings-schema}.ts`, `apps/mobile/src/prefs/preferences.tsx`, `apps/mobile/src/notifications/notificationFilter.ts`, `apps/web/src/lib/appPreferences.ts`, `apps/web/src/components/settings/sections/`.
