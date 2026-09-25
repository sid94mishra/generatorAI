# Operations

> Build, deploy, env vars, observability, security, troubleshooting.

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 10.29.2 (auto-installed via `corepack`) |
| Either Copilot CLI | `@github/copilot-sdk@^1.0.8` provides a bundled binary (`@github/copilot@1.0.75`); or install `copilot` CLI globally |
| Or Claude Code CLI | bundled by `@anthropic-ai/claude-agent-sdk@^0.3.220`; or install `claude` CLI globally |
| SQLite | Bundled via `better-sqlite3` (no separate install needed) |
| Git | `git` ≥ 2.30 (for worktrees) |
| Docker | Optional; needed only when `SANDBOX_ENABLED=true` |

---

## 2. Install & build

```powershell
# One-time setup
corepack enable
pnpm install

# Build everything
pnpm build

# Or just one package
pnpm --filter @generatorai/server build
pnpm --filter @generatorai/web build
pnpm --filter @generatorai/cli build
```

`pnpm install` only runs scripts for `better-sqlite3` and `esbuild` (via `pnpm.onlyBuiltDependencies` in root `package.json`). All other deps are install-only.

---

## 3. Dev mode

```powershell
# Both web + server with hot reload
pnpm dev

# Targeted
pnpm dev:server          # tsx watch on apps/server/src/index.ts (port 3100)
pnpm dev:web             # vite dev server (port 5173)
```

Transient `500` errors in the browser console can appear during `tsx watch` recompiles — they resolve within 2 seconds. Not a bug.

---

## 4. Environment variables

### Core paths

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | API server port |
| `DB_PATH` | `~/.generatorai/data.db` | SQLite path |
| `GENERATORAI_DATABASE_URL` | — | Overrides `DB_PATH` outright when set |
| `ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Projects + global artifacts root |
| `WORKSPACES_DIR` | `~/.generatorai/workspaces` | Execution workspaces + worktrees |
| `TEMPLATES_DIR` | `~/.generatorai/templates` | System templates + system MCP / artifacts. `.workflow.mjs` scripts are discovered under `<templatesDir>/scripts` — there is no separate directory override for that path. |

The Vite dev port (`5173`) is hardcoded in `apps/web/vite.config.ts`; there is no env var to change it.

### Harness provider

| Var | Default | Purpose |
|---|---|---|
| `HARNESS_TYPE` | `copilot` | Default provider: `copilot`, `claude-agent` or `codex`. Every other available provider still runs alongside it. (There is no GENERATORAI_HARNESS_TYPE alias — only the unprefixed name is read.) |
| `COPILOT_CLI_PATH` | auto-resolved | Override platform binary path |
| `COPILOT_GH_HOST` | (none) | Set for GHEC tenants (`https://<tenant>.ghe.com/`) |
| `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` | (none) | Fallback auth. **Scrub these when using `COPILOT_GH_HOST`** to avoid 401. |
| `ANTHROPIC_API_KEY` | (none) | Claude Agent uses `~/.claude/.credentials.json` by default; only set this if you've configured the SDK to read from env |
| `CODEX_CLI_PATH` | auto-resolved | Codex CLI location — the same variable the Codex desktop app reads. Resolution order: this variable (or `harness.codex.binaryPath`), then the **`@openai/codex` package pinned by this build** (an optional dependency of `packages/agent-harness-providers`, currently 0.154.0 — the exact binary the generated protocol types were captured from, present on every platform pnpm installed a platform package for), then `codex` on PATH, then the CLI bundled with the ChatGPT desktop app (macOS). A Windows npm shim (`codex.cmd`) is resolved to the `@openai/codex` script it launches. Sign-in is shared by every binary through `CODEX_HOME`. |
| `CODEX_MODEL` | account default | Model for new Codex threads when a chat names none. |
| `CODEX_APPROVAL_POLICY` | `on-request` | When Codex asks before acting. `on-request` runs sandboxed workspace commands freely and routes anything beyond the sandbox to the chat's approval UI; `untrusted` asks for more; `never` never asks (explicit opt-in only). A chat's permission mode overrides this per turn. |
| `CODEX_SANDBOX_MODE` | `workspace-write` | `read-only`, `workspace-write` or `danger-full-access`. |
| `CODEX_HOME` | `~/.codex` | Codex keeps sign-in, config and history here; forwarded to the Codex child. Codex uses your own sign-in (`codex login` or the ChatGPT desktop app) and `config.toml` — GeneratorAI only layers per-chat settings (MCP servers, instructions, host tools) on top. |
| `GENERATORAI_CLAUDE_SETTING_SOURCES` | (empty) | Comma-separated Claude Agent SDK `settingSources` (`user`, `project`, `local`). **Defaults to none** — the SDK would otherwise silently inherit the operator's local `~/.claude` settings, including hooks and permissions, into every run. |

### Agents (AGT-01)

Agents need no configuration to work, but two paths matter operationally:

| Path | Purpose |
|---|---|
| `<templatesDir>/artifacts/agents/*.agent.md` | Bundled `system`-scope agents. Re-synced on **every boot** — edits made in the UI to a system agent would be overwritten, which is why they are read-only. Deleting a file disables the row rather than removing it, so existing bindings keep their frozen snapshot. |
| `<workspaceRoot>/.generatorai/skills/` | Where an agent's selected skills are staged at run time (5 MB / 200-file budget, content-addressed `manifest.json`). Cleaned up on workspace delete. |

Authoring an agent requires the `admin:settings` scope; listing them requires
only `read:workflows`. See [feature-agents.md](./feature-agents.md).

### Logging & observability

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `OTEL_SERVICE_NAME` | `generatorai-server` / `generatorai-cli` | OTel service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (none) | OTLP collector endpoint (HTTP) |
| `OTEL_SDK_DISABLED` | `false` | Read by the OTel SDK itself (`@opentelemetry/sdk-node`), not by our code. Disables OTel entirely regardless of `OTEL_ENABLED`. |

Pretty-printing is NOT configurable — pino auto-selects `pino-pretty` when `NODE_ENV=development` and structured JSON otherwise. There is no GENERATORAI_LOG_PRETTY env var.

### Sandbox

| Var | Default | Purpose |
|---|---|---|
| `SANDBOX_ENABLED` | `false` | Enable Docker sandbox for hooks + script runner |
| `SANDBOX_IMAGE` | `generatorai/sandbox:latest` | Override sandbox image |
| `SANDBOX_PROVIDER` | `auto` | `docker` (require Docker, error if unavailable), `host` (explicit unsandboxed opt-in), or `auto` (prefer Docker, fall back to host-process — but only if `GENERATORAI_ALLOW_HOST_SANDBOX=true` is also set; otherwise boot fails rather than running agent code unsandboxed) |
| `GENERATORAI_ALLOW_HOST_SANDBOX` | `false` | Required alongside `SANDBOX_PROVIDER=auto` to permit the unsandboxed host-process fallback when Docker is unavailable |
| `GENERATORAI_SCM_ALLOWED_HOSTS` | unset | Comma-separated hostnames of source-control hosts on private networks (e.g. an on-prem GitHub Enterprise) that the source-control HTTP client may call despite the private-address policy |
| `GENERATORAI_GITHUB_OAUTH_CLIENT_ID` | unset | OAuth App client id enabling "Sign in with GitHub" (device flow) in Settings → Source Control |

### Streaming

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_SSE_CAP_PER_SCOPE` | session/run/chat=6, global=32 | Per-(scope,id) SSE connection cap |
| `SSE_HEARTBEAT_MS` | `15000` | SSE heartbeat interval |

Event retention (`events` + `stream_cursors`, TTL 30 days) is NOT configurable via env var — `retention.eventPayloadTtlDays` has no env override wired up; changing it requires editing the Zod default in `packages/shared/src/config/AppConfig.ts`. There is no GENERATORAI_EVENT_TTL_DAYS env var.

### Speech-to-text (voice input)

Local, on-device transcription behind a dedicated WebSocket (`apps/server/src/stt-ws.ts`). No cloud key required. `auto` prefers Nemotron when its weights are present (streaming, multilingual, punctuated) and Moonshine otherwise, with Whisper always last. See [feature-chat.md](./feature-chat.md#42-voice-input-speech-to-text) for the full table.

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_STT` | `1` | Set `0` to disable voice input entirely (mic button hidden, WS returns 501). |
| `GENERATORAI_STT_ENGINE` | `auto` | Pin one engine; anything but `auto` gives up the fallback cascade. |
| `GENERATORAI_STT_PREFERRED` | per machine | Which engine `auto` tries first. |
| `GENERATORAI_NEMOTRON_ONNX_DIR` | our cache | Explicit path to the Nemotron ONNX export (~790MB, never auto-downloaded; fetched from Settings → Audio). |
| `STT_MODEL` | `Xenova/whisper-base.en` | Whisper model id. Larger models = better accuracy, slower first load. |
| `STT_CACHE_DIR` | platform cache dir | Where model weights are cached after the first download. |

### Workspace retention (nightly cleanup)

Every chat and workflow run gets a directory under `<WORKSPACES_DIR>/executions/<ownerId>`, and until this existed nothing ever removed them: `WorkspaceManager.cleanupExpiredWorkspaces()` was reachable only from `POST /api/workspaces/cleanup`, so it ran when somebody remembered. Measured on a developer machine after a few months: 1,136 directories, 6.3GB, growing ~50/day.

`WorkspaceRetentionService` now runs a sweep **once per calendar day, on the first check at or after 03:00 local**. It is deliberately not a 24-hour interval anchored to boot — a desktop install closed overnight would never fire a job pinned to 03:00, so a machine launched at noon sweeps shortly after launch instead.

**It is opt-in and OFF by default.** This is the only scheduled job in the product that deletes the user's files, so it waits for an explicit choice in **Settings → Storage** rather than deleting work on upgrade. Preferences are re-read on every tick, so toggling it off applies without a restart.

Each sweep does two passes:

| Pass | What it removes |
|---|---|
| Tracked | Workspaces the database knows about, deleted through `WorkspaceManager` (rows + files). Includes `active` workspaces untouched for the retention period — chat-owned workspaces never reach `completed`, because only `WorkflowRunService` calls `completeWorkspace()`. |
| Orphans | Directories under `executions/` that **no** database row claims. Changing `DB_PATH` orphans the whole previous tree, and a row-driven sweep can never see those. |

Protections: workspaces with uncommitted changes are archived rather than deleted; anything still held open is skipped and retried the next night; a directory any row claims is never touched by the orphan pass, whatever its age; and if the workspace list cannot be read the orphan pass deletes **nothing**, because without a reliable claim set every directory looks orphaned.

| Setting | Default | Purpose |
|---|---|---|
| Settings → Storage → *Run a nightly cleanup* | off | Opt in to the scheduled sweep. Persisted server-side in `workspace-retention.json` next to the database. |
| Settings → Storage → *Keep workspaces for* | 30 days | Retention period, 1–365. An out-of-range or corrupt value resolves to 30 — never to the minimum, so a typo cannot become the most destructive setting. |

`POST /api/system/workspace-retention/run` sweeps immediately, and works even while the nightly job is off — "clean up now" is an explicit instruction, not a scheduled deletion.

### Widget asset origin

Widgets are served from a **separate loopback origin** so their iframes are cross-origin to the app and get a real browser sandbox (independent storage, `fetch`, CSP). The server opens a second listener at boot — you'll see `[Server] Widget asset origin listening on http://127.0.0.1:<port>`. See [feature-extensions-widgets.md](./feature-extensions-widgets.md).

| Var | Default | Purpose |
|---|---|---|
| `WIDGET_PORT` | `3101` (API port + 1) | Port for the widget asset origin. In desktop/standalone mode this is auto-assigned next to the ephemeral API port. |
| `WIDGET_ORIGIN` | computed from `WIDGET_PORT` | Full origin URL injected into widget iframe `src`. Override when fronting behind a proxy. |
| `WIDGET_CONNECT_SRC` | the API origin | CSP `connect-src` granted to widgets so they can call back into `/api`. |

### Integrated Browser

See [feature-integrated-browser.md](./feature-integrated-browser.md).

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_BROWSER_MAX_CONCURRENT` | `5` | Server-wide cap on concurrent Chromium sessions. LRU-evict on overflow. |
| `GENERATORAI_BROWSER_STREAM_FPS` | `20` | Framerate of the MJPEG WebSocket stream. |
| `GENERATORAI_BROWSER_STREAM_QUALITY` | `60` | JPEG quality 0–100. Higher = crisper text, larger frames. |
| `GENERATORAI_DESKTOP_NATIVE_BROWSER` | (unset) | Desktop-only. Set to `1` before launching Electron to enable the `ElectronBridgeAdapter` (native `WebContentsView` — no MJPEG). |
| `CORS_ORIGINS` | (loopback allowlist) | Comma-separated list of extra origins allowed on the browser + terminal WS upgrade paths. |

### Integrated Terminal

See [feature-integrated-terminal.md](./feature-integrated-terminal.md).

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_TERMINAL` | `1` | Set `0` to disable the feature entirely. REST + WS return 501. |
| `GENERATORAI_TERMINAL_MAX_PER_WORKSPACE` | `5` | Per-workspace concurrent PTY cap. |
| `GENERATORAI_TERMINAL_MAX_GLOBAL` | `20` | Server-wide concurrent PTY cap. Overflow returns HTTP 429. |
| `GENERATORAI_TERMINAL_IDLE_TTL_MS` | `1800000` (30 min) | Idle reap threshold. Bumped on any activity (input/output/resize/ACK), so background processes don't get reaped. |
| `GENERATORAI_TERMINAL_IDLE_REAPER_MS` | `60000` | Idle reaper tick interval. |
| `GENERATORAI_TERMINAL_SCROLLBACK_BYTES` | `4194304` (4 MiB) | Per-session in-memory ring buffer size. Older bytes trimmed on append. |
| `GENERATORAI_TERMINAL_PWSH_PROFILE` | (unset) | Set `1` to load `$PROFILE` in PowerShell. Off by default for fast startup. |
| `GENERATORAI_TERMINAL_ALLOW_SECRETS` | (unset) | Set `1` to inherit `SSH_AUTH_SOCK` / AWS session tokens into the shell env. Off by default for safety. |

### Not implemented (planned)

The internal terminal Phase 2 plan describes flags for features that have not been built yet. None of the following are read anywhere in the codebase today — setting them has **no effect**. Do not configure them expecting a result:

- GENERATORAI_TERMINAL_SANDBOX — would-be sandbox-attached terminal toggle on workflow-run pages.
- GENERATORAI_TERMINAL_PROPOSALS — would-be `terminal.propose` agent tool + inline confirmation card.
- GENERATORAI_TERMINAL_PERSIST — would-be DB-backed session + scrollback persistence (survives server restart).
- GENERATORAI_TERMINAL_RECORD — would-be session recording (asciinema `.cast` files).

### Git

| Var | Default | Purpose |
|---|---|---|
| `GIT_SSH_COMMAND` | (system) | Read by the `git` binary itself, not by our code. Override SSH command for git pull/clone. |

Per-operation git timeout is hardcoded (120s in `GitClient`, shorter for individual read-only calls) — there is no GENERATORAI_GIT_TIMEOUT_MS env var.

### Webhooks

| Var | Default | Purpose |
|---|---|---|
| `WEBHOOK_TOKEN` | (none) | Shared token required on inbound custom-automation webhook triggers (`x-webhook-token` header) |

There is no WEBHOOK_AUTOMATION_BASE_URL env var — nothing in the codebase constructs webhook URLs from a configurable base; there is no such mechanism today.

---

## 5. Production deployment

### Single-process (recommended for solo / small teams)

```powershell
pnpm build
HARNESS_TYPE=copilot \
DB_PATH=/var/lib/generatorai/data.db \
ARTIFACTS_DIR=/var/lib/generatorai/artifacts \
WORKSPACES_DIR=/var/lib/generatorai/workspaces \
PORT=3100 \
node apps/server/dist/index.js
```

Behind a reverse proxy (nginx / Caddy) for TLS. Make sure:

- **WebSocket upgrade IS required.** This line previously said the opposite —
  "WebSocket upgrade is NOT needed (we use SSE, not WS)" — which was true once
  and has not been for a long time. The integrated terminal, the integrated
  browser, speech-to-text, and the phone app's entire live connection are all
  WebSocket. A proxy that does not forward `Upgrade` and `Connection` gives you
  an install where chat works and the terminal silently never connects, which
  gets reported as a product bug.
- `proxy_buffering off` (or an honoured `X-Accel-Buffering: no`) on the SSE
  stream endpoint, or events arrive in batches instead of as they happen.
- `proxy_read_timeout` ≥ 600s for long-running runs, and longer still on the
  WebSocket routes — a terminal session can idle for as long as someone leaves
  it open.

A working configuration for all of the above ships in
[docker/nginx/generatorai.conf](../../docker/nginx/generatorai.conf): it has a
dedicated `location` for the SSE stream with buffering off, and one for the
`*-ws` routes with the upgrade headers set. Start from that file rather than
from these bullets.

### Multi-process (horizontal scaling)

Current state:
- DB locking: SQLite + WAL handles concurrent reads + serialized writes. Multi-process write is possible but contentious; prefer a single owner per DB.
- Harness: each process spawns its own Copilot/Claude CLI subprocess. Coordinate by sharding sessions to a single process (sticky sessions in your LB).
- StreamBroker: in-memory subscribers are per-process. Cross-process SSE fan-out requires an external broker (not shipped).

For real horizontal scaling consider:
1. Sharding by `workflowRunId` → each process owns a stable subset.
2. Running multiple SDK processes behind a shared Postgres (Postgres support is **not yet implemented**; would require swapping the Drizzle dialect).
3. Custom LLM provider (BYOK) that doesn't rely on a local CLI subprocess.

### Docker

Build images:

```powershell
docker build -t generatorai/server -f docker/server.Dockerfile .
docker run -p 3100:3100 \
  -e HARNESS_TYPE=copilot \
  -e DB_PATH=/data/data.db \
  -v generatorai_data:/data \
  generatorai/server
```

`docker/observability/` ships an `docker-compose.yml` with OTel collector, Prometheus, Grafana for local observability.

`docker/sandbox-template/` is the base image for sandboxed script execution. Built and pushed separately.

---

## 6. Database maintenance

```powershell
# Backup
pnpm db:backup
# Wraps scripts/db-backup.ts which copies the DB to a timestamped file in artifactsDir.

# Generate Drizzle migrations
pnpm db:generate

# Apply migrations (idempotent; runs on server boot automatically)
pnpm db:reset      # CAUTION: drops and re-creates the DB

# Prepare distributable DB schema
pnpm db:prepare-dist
```

Migrations are tracked in `_schema_versions`. To inspect:
```sql
SELECT * FROM _schema_versions ORDER BY version;
```

### Disk pressure

- **`stream_cursors`** / **`events`** are pruned hourly by `EventRetentionService` (TTL default 30 days).
- **Workspaces** are NOT auto-pruned. Run `POST /api/workspaces/cleanup?retentionHours=168&maxDiskMb=5000` periodically.
- **Worktrees** are auto-pruned per project's `worktreeRetention` setting (default `hours-24`).

---

## 7. Logging

Structured JSON logs via pino:
```json
{ "level": 30, "time": ..., "service": "generatorai-server", "msg": "...", "runId": "...", "sessionId": "..." }
```

There is no per-run JSONL log file; run events are replayed from the persisted stream.

`GENERATORAI_LOG_LEVEL=debug` enables detailed logs in `EventBus`, `StreamBroker`, `DAGScheduler`, harness providers.

---

## 8. Observability (OTel)

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (HTTP) to ship telemetry. Both server and CLI export.

Metrics shipped:

```
copilot.prompts.total           counter
copilot.prompt.duration_ms      histogram
copilot.active_sessions         updowncounter
copilot.listeners.high_water_mark  updowncounter
copilot.listeners.leak_warnings    counter

claude_agent.queries.total      counter
claude_agent.query.duration_ms  histogram
claude_agent.active_sessions    updowncounter

db.queries.total                counter
db.query.duration_ms            histogram

stream.events.published         counter
stream.events.dropped           counter (slow consumer)
stream.subscribers.active       updowncounter

hook.executions.total           counter
hook.executions.duration_ms     histogram
hook.failures.total             counter
```

Traces:
- Top-level spans for run start, stage execute, harness call, hook execution.
- DB query spans (auto-instrumented).
- HTTP request spans (auto-instrumented for fetch + Express).

Local stack: `docker compose -f docker/observability/docker-compose.yml up -d`.

---

## 9. Security checklist

For deploying to others (org users / public web):

1. **Add auth in front of the server.** No built-in auth yet.
2. **Restrict CORS** to your own origins in `apps/server/src/app.ts`.
3. **Enable sandbox** (`SANDBOX_ENABLED=true`) so user-supplied `script` hooks run isolated.
4. **Don't expose `/api/copilot/*` publicly** — those endpoints reveal model lists and harness state.
5. **Webhook secrets** — set a per-automation webhook secret (HMAC, `X-Signature-256`); rotate automation webhook tokens regularly.
6. **DB at rest** — encrypt the volume if persisting on shared infra. SQLite plain text is the default.
7. **Path traversal** — enforced by `PathResolver`; don't bypass it in custom code.
8. **GHEC tokens** — never log them; scrub from spawned environments.
9. **SSE caps** — default 6 per session/run/chat. Tune via `GENERATORAI_SSE_CAP_PER_SCOPE`.
10. **Cron lease lock** — when running multiple processes against the same DB, the lease prevents duplicate fires; lease TTL = 60s.

---

## 10. Troubleshooting

### `Copilot CLI not found at .../node_modules/@github/index.js`
The SDK's bundled-binary resolver doesn't work with pnpm's hoisted layout. We work around it by resolving the platform package directly (`@github/copilot-<plat>-<arch>`). If you see this error, the provider hasn't been correctly initialized — check that `apps/server/src/composition-root.ts` is on the **session 67** fix or later, and `packages/agent-harness-providers/src/providers/copilot/CopilotProvider.ts` uses `RuntimeConnection.forStdio({ path })`.

### `Not authenticated. Please authenticate first.` (harness/providers shows `copilot` not ready)
The Copilot CLI has no usable stored credential — usually because a previous login expired. Fix it interactively on the host:
```
copilot
/login
```
Then restart the server. `GET /api/harness/providers?refresh=1` should flip `copilot` to `ready: true` with a non-zero `modelCount`.

> Do **not** work around this by exporting `GH_TOKEN` / `GITHUB_TOKEN` from `gh auth token`. That token is scoped to github.com and, on an Enterprise tenant, gets you past auth only to fail later with `Access denied by policy settings`.

### `You are not authorized to use this Copilot feature`
You're on GitHub Enterprise Cloud with data residency. **First just try `copilot` → `/login`** — CLI ≥ 1.0.75 resolves the tenant from its own stored credential (Windows Credential Manager: `copilot-cli/<host>:<user>`), so `COPILOT_GH_HOST` is usually unnecessary.

If the CLI still picks the wrong host, pin it:
```
COPILOT_GH_HOST=https://<tenant>.ghe.com/
```
And **scrub** `COPILOT_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` from the server env — an ambient github.com token takes precedence over the stored tenant credential.

### A chat keeps answering as the old model after switching models
Fixed in the provider. `client.resumeSession(id, { model })` does *not* override the model a session was created with — the SDK rehydrates it from its persistent store. `CopilotProvider.resumeConversation` now calls `session.setModel(...)` for both the in-place switch and the post-restart resume. If you see this again, confirm you are running a build that contains that call. Note that chats created while a provider was *unhealthy* can stay stuck; create a new chat after fixing the provider.

### `Failed to validate SDK token (401): Bad credentials` (after setting COPILOT_GH_HOST)
VS Code's Copilot extension injects `COPILOT_GITHUB_TOKEN` into spawned child processes. That token is for github.com, not your tenant. Scrub it from the env before starting the server.

### Claude Agent: `Could not find claude config`
Run `claude login` once on the host to populate `~/.claude/.credentials.json`. The SDK reads from there. No env var needed in our provider.

### `Claude Code returned an error result: There's an issue with the selected model`
A workflow's or stage's `session.model` is provider-specific. Switching `HARNESS_TYPE` without clearing/aliasing model overrides fails. Either:
- Set the model field to a provider-appropriate value (`claude-sonnet-4-6` for Claude Agent; `claude-sonnet-4.6` for Copilot).
- Remove the override to fall back to provider default.

### `Invalid DAG: Cycle detected involving stages: …`
The graph has a cycle, so no stage can start. `validateWorkflow` rejects cycles and edges to unknown stage keys at save, publish and run start, so this only appears for a graph that bypassed validation. Run `generatorai workflow validate <workflow>` to see the offending keys.

### `gpt-5.3-codex` hangs / no tokens
The auto-router on some GHEC tenants picks `gpt-5.3-codex` and the model never emits anything. Default was switched to `claude-sonnet-4.6`. Override at the workflow/stage level if you want a specific model.

### SSE shows `slow_consumer_dropped`
The client fell behind > 256 frames. The UI shows a banner; refresh the page to catch up.

### `Path traversal detected`
A file path supplied to a config / artifact / workspace endpoint resolves outside the configured directory. Check that paths are relative and don't contain `..`.

### `hook phases` CLI crashes with `rows.reduce is not a function`
You're on a pre-session-66 CLI. The API returns `{ totalPhases, categories: {...} }`; the CLI must flatten. Rebuild the CLI.

### Memory leak warnings for harness listeners (`ORC-05`)
You have > 50 listeners on a single conversation. Usually means an upstream service subscribes without unsubscribing. Grep for `onConversationEvent(` calls without a paired unsubscribe.

### Worktree leak
Process crashed mid-run; worktrees remained on disk. Run `generatorai project worktree cleanup <projectId>` and/or set a stricter `worktreeRetention`.

### `JsonColumnValidationError`
A write is trying to put an invalid shape into a JSON column. Likely a schema drift — re-build the DB package and re-run the request.

---

## 11. Performance tuning

- **Session sharing is automatic** — a purely linear graph runs every stage in one shared conversation (fastest for sequential stages); any parallel branch gives each stage its own session, which maximizes parallelism but multiplies harness sessions. There is no per-definition session mode.
- **`reasoningEffort: 'low'`** halves Claude/Copilot latency at the cost of quality.
- **`session.tools.available`** — restricting tools speeds up model decision-making.
- **`context.mode: 'summary'`** (default) is much smaller than `'output'` for long predecessor outputs.
- **`stream_cursors` retention** — the 30-day TTL is not env-configurable (see §4 Streaming); shorten `retention.eventPayloadTtlDays` in `AppConfig` if disk is tight.
- **`SANDBOX_ENABLED=false`** — host execution is faster than Docker; only enable in shared environments.

---

## 12. Health check

```powershell
curl http://localhost:3100/api/health
```

Returns:
```json
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "copilot": "connected",
  "harness": "copilot",
  "version": "0.1.0",
  "subscribers": { "session": 0, "run": 1, "chat": 2, "global": 1 }
}
```

`harness.runtime` (and `harness.runtime.providers.<type>`) reports what the harness is holding: `liveConversations`, `liveSessions` (one CLI process each), `warmSessions`, and for providers that cap concurrent turns, `turnsInFlight` / `maxConcurrentTurns` (default 4, `GENERATORAI_MAX_CONCURRENT_AGENT_TURNS`) / `turnsQueued`. **`turnsQueued > 0` while `turnsInFlight` is 0 means a permit leaked** — every new prompt would sit on "Waiting for a free agent slot"; `runningChatIds` lists the chats the server thinks are mid-turn.

`GET /api/health/config` returns non-sensitive resolved config (paths, models, ports, flags). Use this in CI to verify deployment.

---

## 13. Backup & restore

```powershell
# Backup
pnpm db:backup                                       # script handles DB + artifacts marker
tar czf workspaces.tar.gz ~/.generatorai/workspaces  # workspaces
tar czf artifacts.tar.gz ~/.generatorai/artifacts    # projects + assets

# Restore (offline)
# Stop the server, replace files, start.
```

The DB has no separate "data" vs "schema" mode — restoring is just file replacement. Migrations are applied lazily on next boot if schemas differ.

---

## 14. Upgrading

Within `0.x`:
1. `git pull`
2. `pnpm install`
3. `pnpm build`
4. Restart the server — migrations run on boot.

Across **major** versions (when we hit `1.0`):
- Re-read this AGENTS.md for breaking changes.
- Take a DB backup first.
- The migration is append-only; rolling back requires the backup.

---

## 15. Useful one-liners

```powershell
# Tail per-run logs
Get-Content ~/.generatorai/workspaces/<runId>/artifacts/logs/run.jsonl -Wait | ConvertFrom-Json

# List in-flight runs
curl http://localhost:3100/api/workflow-runs?status=running | jq '.[] | { id, name, status }'

# Trigger an automation
curl -X POST http://localhost:3100/api/automations/<id>/trigger

# Inspect stream from CLI
generatorai run watch <runId> --verbosity verbose

# Reload PWS scripts without restart
curl -X POST http://localhost:3100/api/workflow-scripts/reload

# Switch harness at runtime (web UI alternative)
curl -X POST http://localhost:3100/api/harness/switch -H 'Content-Type: application/json' -d '{"type":"claude-agent"}'
```

