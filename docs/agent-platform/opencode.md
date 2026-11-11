# OpenCode 2 provider

Date: 2026-11-11. Code: `packages/agent-harness-providers/src/providers/opencode/`. Pinned contract: OpenCode
**2.2.7** (`schemas/opencode/openapi.json` = `packages/protocol/openapi.json` at the `v2.2.7` tag; types in
`protocol/opencode.generated.ts`, `pnpm generate:schemas`). Minimum version: **2.0.0**. OpenCode 1 (`opencode-ai`) is
not supported.

## How it runs

| Part | What it does |
|---|---|
| `resolveOpenCodeBinary.ts` | Finds the user's install (nothing is bundled): `harness.opencode.binaryPath` → `OPENCODE_BIN` → `OPENCODE_BIN_PATH` → `opencode2` / `opencode` on PATH (the desktop gives its server the login shell's PATH) → `~/.opencode/bin`, Homebrew, `/usr/local/bin`, `~/.local/bin`, npm's global prefix, `~/.bun/bin`; on Windows `%USERPROFILE%\.opencode\bin\opencode.exe`, `%APPDATA%\npm\opencode(2).cmd`, Scoop, WinGet. An npm launcher (`opencode.cjs`, or the `.cmd` shim Windows cannot spawn without a shell) is replaced by the platform package's native binary, the launcher's own lookup. None found: the provider stays unconfigured and Settings shows the install hint. |
| `server.ts` | Spawns `opencode serve --stdio --port 0` with a random `OPENCODE_PASSWORD`: a private, lease-owned server that prints one `{"url"}` line and exits when our stdin closes (so it cannot outlive the app). Every request uses HTTP Basic `opencode:<password>`. `GET /api/info` is the version gate: below 2.0.0, or a 1.x server (404 on `/api/info`, or no `--stdio`), fails with "update OpenCode". Stop = interrupt in-flight turns, close stdin, SIGTERM, SIGKILL. |
| `events.ts` | One `GET /api/event?types=…` subscription for the whole server (V2 envelope `{id, created, type, data}`, `server.connected` first, a heartbeat every 15 s, live-only). A drop fails what is waiting and the next call reconnects (respawning the server if it died). |
| `permissions.ts` | The chat's permission mode as **session rules** (below); `permission.asked` as the app's `PermissionRequest`. |
| `forms.ts` | The `question` tool's form (`metadata.kind === "question"`) as the question card; the answer back as `{q0: label \| [labels]}`. |
| `clientMcp.ts` | The platform's tools (`params.tools`: `record_plan`, browser, widgets, custom tools, structured output) as a client-hosted MCP server: one WebSocket per working directory to `/api/experimental/client-mcp`, listing the union of the tools registered there; each call is dispatched to the conversation whose session made it (`_meta["ai.opencode/sessionID"]`), any other session gets an error result. A changed list sends `notifications/tools/list_changed`; a turn waits (≤ 5 s) until OpenCode has listed the tools. |
| `models.ts` | `GET /api/model?types=chat` + `/api/model/default` → the catalog (`providerID/id`, vision from `capabilities.input`, `promptTokenLimit = limit.input ?? limit.context`, pricing from `cost[0]`). Reasoning efforts are the model's **variants** named `low/medium/high/xhigh/max`; the chat's effort is sent as `model.variant`. |
| `config.ts` | GeneratorAI's own config file for the server it starts (`OPENCODE_CONFIG` → `<dataDir>/opencode/generatorai.json`): `compaction` from the app's auto-compaction setting and `skills` = the union of the live conversations' skill directories. The server watches it; when nothing waits on a gate the provider also calls `POST /api/location/reload`. The user's own config files are never written. |

## Endpoints used

`GET /api/info` · `GET /api/event` · `POST /api/session` · `GET|PATCH|DELETE /api/session/{id}` ·
`GET /api/session/active` · `POST …/prompt` · `POST …/interrupt` · `POST …/model` · `POST …/agent` · `POST …/move` ·
`PUT …/environment` · `POST …/compact` · `POST …/fork` · `POST …/revert/stage` + `…/revert/commit` ·
`GET …/message` (paged) · `POST …/permission/{id}/reply` · `POST …/form/{id}/reply` · `DELETE …/form/{id}?message=` ·
`PUT /api/experimental/session/{id}/instructions/entries/generatorai-system` · `PUT /api/experimental/mcp/{name}` ·
`GET /api/experimental/client-mcp` (WebSocket) · `GET /api/model` · `GET /api/model/default` · `GET /api/agent` ·
`POST /api/location/reload`.

Events: `session.created` (subagent sessions), `session.execution.started|succeeded|failed|interrupted` (the only turn
boundary), `session.step.started|ended`, `session.text.delta`, `session.reasoning.delta|ended`,
`session.tool.input.started|called|progress|success|failed`, `session.retry.scheduled`,
`session.compaction.started|ended|failed`, `permission.asked`, `form.created`.

## A conversation

- **Create**: `POST /api/session {title, location: {directory}, model, agent?, metadata: {"generatorai.conversationId": id},
  permissions: <rules for the mode>}`, then the system-prompt append as an instruction entry, the session environment
  (`buildHarnessEnv` + the chat's `GENERATORAI_*` variables — it replaces `process.env` for that session's commands),
  the chat's MCP servers (runtime-added at its directory, `codemode: false`) and the host tools.
- **Resume** (`resumeProviderSessionId`, e.g. after a restart): `GET` the session (404 → "OpenCode no longer has it"),
  `PATCH` metadata + rules, move it if the working directory changed, switch model/agent if they differ; environment,
  MCP servers and the client-MCP socket are in OpenCode's memory only and are re-sent before the next turn.
- **Turn**: the turn's state is brought up to date (rules for the turn's mode — a plan turn uses `plan` — model, agent,
  instructions, environment, MCP, host tools; unchanged state is not re-sent), then `POST …/prompt {text, files}` (files
  are `file://` URIs; OpenCode sniffs the type). The prompt is only *admitted*; the turn ends on the run's terminal.
  Text and reasoning stream as deltas; each step closes with `harness.message_complete {providerMessageId:
  assistantMessageID}` (the fork/rewind anchor); a step that ends with `finish: length` fails the open tool calls (W13).
  One `harness.usage` per turn (USD in `costUsd`), `harness.context_usage` after every step.
- **Subagents**: a child session (`session.created.parentID` is ours) joins the conversation; its tool calls are
  forwarded under the spawning call (`parentToolCallId`, linked through the subagent call's progress metadata), its
  prose is not. Children inherit the session's rules (core `Session.create`), and its permission asks reach the same gate.
- **Abort**: `POST …/interrupt`; settled on `session.execution.interrupted`, or locally after 3 s.
- **Fork**: messages are listed oldest first; "through anchor M" = `POST …/fork {before: <the message after M>}` (no
  `before` when M is last). OpenCode re-keys the copies (`<event id>_<seq>`), so the provider returns an `anchorMap`, and
  binds the fork as the new conversation (its own metadata and rules).
- **Rewind**: `revert/stage {messageID: <first dropped>, files: false}` + `revert/commit` (files are the app's checkpoints).
- **Compaction**: docs/compaction/README.md §6 (OpenCode 2).

## Permission mapping

Session rules are evaluated after the agent's rules and the **last match wins**; with no rules OpenCode never asks, so
every session the app creates or resumes carries the full set.

| Mode | Rules (in order) |
|---|---|
| `bypassPermissions` | `* * allow` |
| `acceptEdits` | `* * ask`, reads allowed (`read`, `glob`, `grep`; `.env` reads ask), `question`/`todowrite`/`skill`/`subagent` allowed, `edit * allow`, the chat's extra roots as `external_directory` allows |
| `default`, `plan` | as `acceptEdits` without `edit` (edits, shell, web, MCP tools, outside paths ask). A plan turn's writes reach the app's gate, which treats them as plan mode does for every per-call provider. |
| `dontAsk` | `* * deny` + the same allows (nothing waits for a human) |
| every mode | skill allow-list / `disabledSkills` as `skill` rules; "don't ask again" answers; `generatorai_* allow` (the platform's tools, gated by the app itself); **`execute * deny` last** |

`execute` is denied so Code Mode is off: OpenCode then lists every tool directly (core `Tool.snapshot`), so each call is
its own gated, rendered, recorded tool call, and the client-hosted tools reach the model as `generatorai_<tool>`.

An ask (`permission.asked`, any of the conversation's sessions) goes to `onPermissionRequest`: kind from the action
(`edit/write/patch` → file_write, `read/glob/grep/external_directory` → file_read, `shell` → shell_exec,
`webfetch/websearch` → network, else other); reply `once` or `reject` (+ the reason as `message`). "Don't ask again" is
kept as a **session** rule (OpenCode's proposed `save` pattern) instead of OpenCode's `always`, which would save a
project-wide approval into the user's own OpenCode as well. No handler → `reject`.

## Recovery

- Stopping (dispose, shutdown, force-stop) interrupts every turn and compaction the provider started first. A deliberate
  interrupt releases OpenCode's execution claim; a shutdown without it keeps the claim, and OpenCode's managed service
  (`opencode service`, the desktop app) resumes claimed sessions at its next boot.
- On every (re)connect, before new work, sessions the server reports running (`GET /api/session/active`) that carry our
  owner metadata are interrupted. A `--stdio` server never runs the restart sweep itself (only the managed service does).
- **Data directory: shared, on purpose.** OpenCode keeps provider credentials in the same SQLite database as sessions
  (`credential` table in `$XDG_DATA_HOME/opencode/opencode.db`, core `credential/sql.ts`; v2.1 imported `auth.json` into
  it). A separate `OPENCODE_DB`/`XDG_DATA_HOME` would sign the user out of every model provider, so the provider uses the
  user's own data directory. Consequence: app sessions are visible in the user's OpenCode, and a turn orphaned by a hard
  crash (no interrupt possible) can be resumed by the user's OpenCode service — under the session's own rules, so in
  `default`/`plan` it stops at the first ask.

## Capabilities

| Capability | OpenCode 2 | How |
|---|---|---|
| streaming text / reasoning | yes | `session.text.delta`, `session.reasoning.delta|ended` |
| tool events, subagents | yes | `session.tool.*`, child sessions with `parentToolCallId` |
| `approvalGating` | `per_call` | session rules + `permission.asked` |
| questions | yes | `question` tool forms → `onQuestionRequest` |
| `hostTools` | `full` | client-hosted MCP (experimental route) |
| `structuredOutput` | `tool` | through a host tool |
| `skills` | `directories` | `skills` in GeneratorAI's config layer (process-wide, like Codex) + `skill` rules |
| `planMode` | false (prefix + `record_plan`) | no plan tool of its own; OpenCode's `plan` agent forbids implementing after approval, so it is not used |
| system prompt | append | instruction entry; `replace` is appended with a `FIELD_COERCED` warning |
| models / efforts / context limits | yes | catalog + variants |
| `harness.context_usage` / usage + cost | yes (`derived`) / yes (USD) | step tokens |
| `conversationCompact` / instructions | yes / no | `POST …/compact` |
| auto-compaction setting | yes (own server) | config layer |
| `conversationFork` / `conversationRewind` | yes / yes | fork / revert |
| resume after restart | yes | durable sessions, `providerSessionExists` / `deleteProviderSession` |
| attachments, MCP servers, env, cwd move, `additionalDirectories` | yes | `files`, runtime MCP, `PUT …/environment`, `POST …/move`, `external_directory` rules |
| `budgetTracking`, `prewarm`, `accountLogin`, `computerUse`, hooks | no | see below |

## Not supported (and why)

- **`customAgents`, `maxTurns`, BYOK `provider`, tool allow/deny lists, `plugins`, `contextTier`** — agents, step limits,
  providers and plugins are OpenCode configuration, not session state; each is reported as
  `FIELD_UNSUPPORTED_BY_PROVIDER`. `defaultAgent` / `selectAgent` work for OpenCode's own primary agents.
- **Replacing the system prompt** — no API; appended instead (`FIELD_COERCED`).
- **Compaction instructions** — `compact` takes none.
- **Budget ceiling** — cost is reported, but OpenCode has no limit to set.
- **Sign-in from the app** — the user signs in to model providers in OpenCode itself. Provider API keys in the server's
  environment are not passed through (the child-env allowlist strips them), so only OpenCode's stored credentials count.
- **Hooks bridge** — OpenCode hooks are in-process plugins (`UNMODELED_CAPABILITIES.opencode = ['hooks']`).
- **An external server (`baseUrl`)** cannot take the app's compaction setting or skill directories (its own config
  decides); both are reported as warnings.

## Limits worth knowing

- Client-hosted MCP, instruction entries and runtime MCP servers are **experimental** routes in 2.2.7. The contract is
  pinned and covered by `fakeOpenCodeServe.mjs`; an OpenCode upgrade should re-capture the schema and re-run the suite.
- An attached MCP tool call is capped at **10 minutes** by OpenCode (`ATTACHED_EXECUTION_TIMEOUT`): a `record_plan`
  review left open longer fails that call (the model is told, and can file the plan again).
- MCP servers added for a chat are visible to every OpenCode session at that directory (OpenCode scopes them per location).
- Skill directories and the compaction setting are server-wide (`skills_process_global` warns, as for Codex).
- Project config (`opencode.json`, `.opencode/`) outranks GeneratorAI's config layer.

## Tests

`src/providers/opencode/__tests__/OpenCodeProvider.test.ts` runs the provider against
`fixtures/fakeOpenCodeServe.mjs` (a stand-in following the 2.2.7 contract, spawned the way OpenCode is): the W44
conformance suites, the version gate, rules per mode, gates, host tools over a real WebSocket, subagents, compaction,
fork/rewind/resume and recovery. `opencodeHelpers.test.ts` covers binary resolution per OS, the rule sets, form mapping
and the config layer. Not yet run against a real OpenCode 2 binary on this machine (not installed).
