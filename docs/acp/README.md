# ACP agents — every agent in the ACP Registry, installable from Settings

Owner request (2026-11-11): an ACP section in Settings › Model providers that lists every agent supporting the
Agent Client Protocol, with its icon; installed and signed-in agents appear in the model picker with their models.
Research (registry, client behaviour, protocol, parity): kept out of the repo; the facts this design relies on are
cited inline.

## Decisions

- **ACP-1 One driver, many agents.** The provider id stays `acp` (`HARNESS_PROVIDER_IDS` is unchanged, no
  migration). `AcpProvider` multiplexes: one ACP connection (one agent process) per enabled agent, a conversation
  bound to the agent its model names. Persisted chat config keeps `harnessType: 'acp'`.
- **ACP-2 Model ids name the agent.** An ACP model id is `<agentId>/<value>` where `value` is the agent's
  `configOptions` option value for category `model` (spec: session config options, stable since v0.10.8). An agent
  that publishes no model option offers one model, id `<agentId>`, named "<Agent> (agent's default model)".
  Effort = the `thought_level` option; mode = the `mode` option.
- **ACP-3 Sub-providers.** `HarnessProviderStatus` for `acp` carries `subProviders[]` (one per enabled agent: id,
  label, icon mark, installed / authenticated / ready / error, version) and each `HarnessCatalogModel` carries
  `subProvider`. The model picker draws one provider entry per sub-provider (key `acp:<agentId>`, the agent's own
  label and icon); selecting a model still sets provider `acp`.
- **ACP-4 Registry-backed catalogue.** Index: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
  (github.com/agentclientprotocol/registry). The server caches it under its data dir (refresh at most hourly, plus a
  manual refresh, `If-None-Match`), falling back to a bundled snapshot. `GENERATORAI_ACP_REGISTRY_URL` overrides the
  URL (tests, air-gapped installs).
- **ACP-5 Icons are sanitised server-side.** Registry icons are 16×16 monochrome `currentColor` SVGs. The server
  parses each against an element/attribute allow-list and serves `{viewBox, nodes}`; the web never loads a
  third-party URL. Icons are the vendors' marks, used only to identify the agent (like `provider-logos.ts`).
- **ACP-6 Install, all three OSes.** `binary` distributions: download, verify `sha256` (unverified installs are
  labelled), extract with JS extractors (zip / tar.gz / tar.bz2 / raw), reject path traversal, `chmod +x`, keep the
  launch path inside the install dir. `npx` distributions: `npm install <pkg@ver> --save-exact --prefix <dir>` with
  the system Node (login-shell PATH) and launch `node <bin>` — never `npx` (no `npx.cmd` on Windows, no network on
  launch). Windows `.cmd`/`.bat` launchers go through `cmd.exe /d /s /c` with strict quoting. `uvx` is shown as not
  supported yet. Layout: `<data>/acp/agents/<id>/<version>/`.
- **ACP-7 Natively supported agents stay listed.** The registry includes Claude, Codex, GitHub Copilot and OpenCode,
  which have first-class providers. They are listed with "Also available as a native provider" and can still be
  enabled; the native provider is the recommended one.
- **ACP-8 Sign-in.** The client advertises `auth.terminal`. `agent` auth methods call `authenticate`; `terminal`
  methods run the agent's own command plus the method's `args`/`env` in an app terminal, then the connection
  re-initialises. Readiness: installed → initialised → authenticated (`auth/status` when advertised, otherwise a
  model probe that does not return `-32000`).
- **ACP-9 Stability.** `acp` becomes `stable`: the ACP section is always shown; with no agent enabled the provider
  reports "No ACP agents enabled" and the picker shows nothing for it.
- **ACP-10 Custom agents.** A typed command (`{command, args, env}`) remains for an agent not in the registry, as a
  "Custom agent" entry in the same section.
- **ACP-11 Agent state is a JSON store, not `harness_instances`.** `harness_instances` rows are separate adapters
  (one per account); ACP agents are sub-providers of the ONE `acp` adapter (ACP-1). Which agents are enabled, their
  installed version and the names of their env vars live in `<data>/acp/agents.json` (beside
  `provider-visibility.json`); the env values are in the secret store under `harness/acp-<id>`. The old
  typed-command `acp` instance row is gone (no migration, pre-release).
- **ACP-12 Terminal sign-in runs in the client.** App terminals are workspace-bound (`/workspaces/:id/terminals`),
  and a sign-in belongs to no workspace, so the server does not spawn it: `POST /api/acp/agents/:id/terminal-auth`
  returns the exact command, args, env and cwd (plus POSIX and PowerShell command lines); the client runs it in a
  terminal and calls `POST /api/acp/agents/:id/reinitialize` once it exits 0.

## Implementation map

| Piece | Where |
|---|---|
| Shared wire types (`ProviderMark`, `HarnessSubProviderStatus`, `/api/acp` shapes) | `packages/shared/src/types/AcpAgents.ts`; `HarnessProviderStatus.subProviders`, `HarnessCatalogModel.subProvider` in `HarnessCatalog.ts` |
| One agent process | `packages/agent-harness-providers/src/providers/acp/AcpAgentConnection.ts` |
| The `acp` provider (multiplexer) | `…/providers/acp/AcpProvider.ts` (`setAgents`, `restartAgent`, `ensureAgent`, `agentStatus`, `getSubProviders`) |
| Config options → models | `…/providers/acp/configOptions.ts` |
| cmd normalisation, zip-slip guard, Windows `.cmd` wrapping, terminal command lines | `…/providers/acp/launch.ts` |
| Registry parse, platform choice, icon sanitiser, catalogue cache, installer | `…/providers/acp/registry/*` |
| Bundled snapshot | `…/providers/acp/registry/snapshot/*.json`, regenerated by `node scripts/acp/update-registry-snapshot.mjs` |
| Server service (store, installs, launches, sign-in) | `apps/server/src/settings/acpAgents.ts` |
| Routes | `apps/server/src/routes/acp.ts` (policy `/acp`: read `read:status`, write `admin:harnesses`) |
| Tests | `…/providers/acp/__tests__/*` (fake agent `fixtures/fakeAcpAgent.mjs`), `apps/server/src/__tests__/acpAgents.test.ts` |

On disk (`<data>` = the server data directory, `dirname(DB_PATH)`):
`<data>/acp/agents.json`, `<data>/acp/registry/{registry.json,meta.json,icons.json}`,
`<data>/acp/agents/<id>/<version>/` (each with `.gai-acp-install.json`; npx agents keep their `node_modules` there).

## API

All routes are under `/api/acp`. Reads need `read:status`; everything else `admin:harnesses` (like `/api/harness`).
Every mutation answers the full `AcpAgentsResponse`, so a client replaces its list in one step. Errors are
`{ error: { code, message } }`: `NOT_FOUND` 404, `INVALID`/`INVALID_BODY` 400, `CONFLICT` and `UNAVAILABLE` 409.

| Method + path | Body | Answer | Notes |
|---|---|---|---|
| `GET /agents` | — | `AcpAgentsResponse` | Never blocks on the network; when the last registry check is older than an hour a background refresh starts (poll again to see it). |
| `POST /registry/refresh` | — | `AcpAgentsResponse` | Fetches the index now (`If-None-Match`), re-checks Node.js. |
| `POST /agents/:id/install` | — | 202 `AcpAgentsResponse` | Installs the registry's version in the background; the agent carries `installing` (phase, bytes) until done, then `installed` or `installError`. |
| `POST /agents/:id/update` | — | 202 `AcpAgentsResponse` | Same as install when `updateAvailable`; an enabled agent restarts on the new version, the old version is removed. |
| `DELETE /agents/:id/install` | — | `AcpAgentsResponse` | Disables, stops and removes the agent. |
| `PUT /agents/:id/enabled` | `AcpSetEnabledRequest` `{ enabled }` | `AcpAgentsResponse` | Registry agents must be installed (409 otherwise). Takes effect at once: the provider starts/stops the agent and its models enter/leave the picker. |
| `PUT /agents/:id/env` | `AcpSetEnvRequest` `{ env: { NAME: value \| null } }` | `AcpAgentsResponse` | Values go to the secret store and are never sent back (`env: [{ name, set: true }]`). An enabled agent restarts with the new environment. |
| `POST /agents/:id/authenticate` | `AcpAuthMethodRequest` `{ methodId }` | `AcpAgentsResponse` | `agent` methods only (409 for a terminal method). Resolves when the agent finishes (it may open a browser; up to 10 min). |
| `POST /agents/:id/logout` | — | `AcpAgentsResponse` | Only when `status.supportsLogout`. |
| `POST /agents/:id/terminal-auth` | `AcpAuthMethodRequest` | `AcpTerminalAuthSpec` | `terminal` methods only. `{ command, args, env, cwd, posixCommandLine, powershellCommandLine }` = the agent's launch + the method's args/env. Show args/env to the user before running (spec guidance). `env` includes the user's per-agent secrets. |
| `POST /agents/:id/reinitialize` | — | `AcpAgentsResponse` | Restarts the agent's process and re-probes it — call after a terminal sign-in exited 0. |
| `POST /agents/:id/test` | — | `AcpTestResult` | A separate, fresh connection (installed or custom agent, enabled or not): starts, `authState`, model count, `agentInfo`, duration. |
| `POST /custom` | `AcpCustomAgentRequest` `{ name, command, args?, env? }` | 201 `AcpAgentsResponse` | ACP-10. Enabled at once; id `custom-<slug>-<6 hex>`. |
| `DELETE /custom/:id` | — | `AcpAgentsResponse` | Also deletes its env secrets. |

`AcpAgentsResponse` = `{ registry: { url, source: network|cache|snapshot, fetchedAt?, checkedAt?, error? }, platform
(e.g. darwin-aarch64, linux-x86_64-musl, or null), node: { available, version?, error? }, agents: AcpAgentInfo[] }`.
`agents` lists every registry agent in registry order, then installed agents the registry dropped, then custom agents.

`AcpAgentInfo` fields the Settings section needs:

- Identity: `id`, `name`, `description`, `version` (registry latest), `repository`, `website`, `license`, `authors`,
  `mark` (`ProviderMark` — draw as `<svg viewBox>` with `nodes` → elements, `fill="currentColor"` on the root; absent →
  the generic agent mark), `custom`, `command` (custom agents).
- `nativeProvider`: `claude-agent` | `codex` | `copilot` | `opencode` for `claude-acp`, `codex-acp`,
  `github-copilot-cli`, `opencode`, `opencode-v2` → show "Also available as a native provider" (ACP-7).
- `distribution`: `offered` kinds; `selected` (`binary` | `npx` | `custom` | null); `unavailableReason` when it cannot
  be installed here (no build for this platform, musl without a musl build, uvx only, or npx without Node.js ≥ 18);
  `unverified: true` when the selected binary has no sha256 (label the Install button); `package` for npx.
- Install state: `installed` (`{ version, kind, installedAt, unverified }` or null), `updateAvailable`, `installing`
  (`{ phase: resolving|downloading|verifying|extracting|npm|finishing, version, receivedBytes, totalBytes? }`),
  `installError`.
- `enabled`, `env` (names), `distributionEnv` (the registry's own non-secret env, for display).
- `status` (enabled agents only): `{ connected, authState: authenticated|unauthenticated|not_required|unknown, ready,
  modelCount, error?, authMethods: AcpAuthMethodInfo[], supportsLogout, agentInfo?, checkedAt? }`.

**Status semantics.** installed → enabled → `connected` (the process answered `initialize`) → signed in
(`authState` `authenticated` or `not_required`: from `auth/status` when the agent advertises it, else inferred — an
agent with no auth methods is `not_required`; a model probe answering `-32000` makes it `unauthenticated`; a probe
that succeeds makes it `authenticated`) → `ready` (its models are listed). `authMethods` is empty until the agent has
connected once. A signed-out agent has no models — never an empty-but-ready catalog. `status.error` says why an
agent is not ready ("Sign in to X…", a start failure with the tail of its stderr, …).

**In `GET /api/harness/providers`.** The `acp` entry (label "ACP agents", always served — stable) is `ready` when at
least one enabled agent lists models; with none enabled its `error` is "No ACP agents enabled…". It carries
`subProviders: HarnessSubProviderStatus[]` — one per enabled agent, in store order: `{ id, label, mark?, version?,
installed, connected, authState, authenticated, ready, error?, modelCount }`. Its `models` are every ready agent's
models with ids `<agentId>/<value>` (or `<agentId>` for an agent's default model) and `subProvider: <agentId>`;
`category` is the agent's option group, `isDefault` its current value, and only the current model carries
`reasoningEfforts` (the agent's `thought_level` choices depend on the model). The picker draws one provider entry per
sub-provider (key `acp:<agentId>`) and still sets provider `acp` with the model id. `supportsLogin` is false for
`acp` (sign-in is per agent, through `/api/acp`).

## Parity (provider × ACP spec)

| Feature | Status | Notes |
|---|---|---|
| Spawn, stdio transport, `initialize` + version check | ✅ | Windows `.cmd`/`.bat` via `cmd.exe /d /s /c` with strict quoting (`"`, `%`, line breaks refused); stderr tail in errors. |
| Client capabilities | ✅ | `auth.terminal`, `session.configOptions.boolean`, `session.notices`, `session.compaction`, `plan`; `fs`/`terminal` false (deliberate). |
| `agentInfo`, `authMethods`, `agentCapabilities` kept | ✅ | In `agentStatus` / the API. |
| `authenticate` (agent methods), terminal methods | ✅ | Terminal methods run by the client (ACP-12). |
| `auth/status`, `auth/status_update`, `logout` | ✅ | Gated on `agentCapabilities.auth`. |
| `-32000` → signed out | ✅ | Probe, session setup and prompt failures all mark the agent unauthenticated. |
| Models / effort / mode from `configOptions` | ✅ | `session/options` when advertised, else a throwaway `session/new` in `os.tmpdir()` (closed when `session/close` is advertised). |
| Apply model/effort on creation and mid-chat | ✅ | Initial `configOptions` when `sessionCapabilities.options`, else `session/set_config_option`; a rebind with another model/effort changes it in place. |
| Plan mode | partial | Plan turns switch to the agent's own `plan`-like mode and back; no native plan gate (planMode stays false, so the host's plan prompt is used). |
| `config_option_update`, `current_mode_update` | ✅ | `harness.session_info` `config_options`, `harness.mode_changed`; the catalog's value lists follow live changes. |
| Persistence: `session/resume`, `session/load` | ✅ | From `resumeProviderSessionId` (`<agentId>/<sessionId>`); load's history replay is dropped (the transcript is ours); failure → `CONVERSATION_RESTARTED`. |
| `session/fork` | ✅ (whole session) | A cut at an anchor is not expressible, so the chat service falls back to a synthetic fork. |
| `session/list`, `session/delete` | ❌ | Not needed by the app (our transcript is the history). |
| `session/close`, `additionalDirectories` | ✅ gated | Only when advertised; extra roots otherwise reported as a warning. |
| MCP servers | ✅ | stdio always; http/sse per `mcpCapabilities`; `acp` transport (MCP-over-ACP) not used. |
| `systemPrompt` | ✅ gated | `sessionCapabilities.systemPrompt`; `append`/`override`. |
| Attachments | ✅ | Images (`promptCapabilities.image`, sets `vision`), text files as embedded resources (`embeddedContext`), else `resource_link`. Audio not sent. |
| Plan entries (`plan`, `plan_update`, `plan_removed`) | ✅ | `harness.session_info` `plan_update` (Codex-compatible steps). |
| Available commands | ✅ | `/compact` drives native compaction; the list is broadcast as `session_info` `available_commands` (composer wiring is UI work). |
| `tool_call_update` content / diff / locations | ✅ | Running calls → `session_info` `tool_progress`; completions carry text/diff summaries and a `fileOp` for the first diff. |
| Usage, cost | ✅ | `usage_update` → context gauge; per-turn tokens (`PromptResponse.usage`) and cost (cumulative `usage_update.cost`, USD → `costUsd`) → `harness.usage`. |
| Notices | ✅ | warning/error → `harness.warning`; info → `session_info`. |
| Compaction, Tier-B gate, permissions, cancel | ✅ | Unchanged. |
| Client `fs/*`, `terminal/*`, elicitation | ❌ | Deliberate: agents get an honest -32601. |
| Host tools | ❌ | ACP has no host tools (MCP-over-ACP is unstable); `hostTools: 'none'`. |
| uvx agents | ❌ | Shown with "Needs uv (Python), which is not supported yet". |
| Managed Node.js download for npx agents | ❌ | System Node ≥ 18 on the (login-shell) PATH only; without it npx agents say why. |
| Binary checksum fallback (GitHub release `digest`) | ❌ | No sha256 in the registry → installed and labelled `unverified`. |
