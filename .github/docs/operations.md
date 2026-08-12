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
| `GENERATORAI_PORT` | `3100` | API server port |
| `GENERATORAI_WEB_PORT` | `5173` | Vite dev port (dev only) |
| `GENERATORAI_DB_PATH` | `~/.generatorai/data.db` | SQLite path |
| `GENERATORAI_ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Projects + global artifacts root |
| `GENERATORAI_WORKSPACES_DIR` | `~/.generatorai/workspaces` | Execution workspaces + worktrees |
| `GENERATORAI_TEMPLATES_DIR` | `~/.generatorai/templates` | System templates + system MCP / artifacts |
| `GENERATORAI_SCRIPTS_DIR` | `<templatesDir>/scripts` | `.workflow.mjs` discovery |

### Harness provider

| Var | Default | Purpose |
|---|---|---|
| `HARNESS_TYPE` | `copilot` | `copilot` or `claude-agent` |
| `GENERATORAI_HARNESS_TYPE` | (alias) | same |
| `COPILOT_CLI_PATH` | auto-resolved | Override platform binary path |
| `COPILOT_GH_HOST` | (none) | Set for GHEC tenants (`https://<tenant>.ghe.com/`) |
| `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` | (none) | Fallback auth. **Scrub these when using `COPILOT_GH_HOST`** to avoid 401. |
| `ANTHROPIC_API_KEY` | (none) | Claude Agent uses `~/.claude/.credentials.json` by default; only set this if you've configured the SDK to read from env |
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
| `GENERATORAI_LOG_PRETTY` | `true` in dev | Pretty-print pino logs |
| `OTEL_SERVICE_NAME` | `generatorai-server` / `generatorai-cli` | OTel service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (none) | OTLP collector endpoint (HTTP) |
| `OTEL_SDK_DISABLED` | `false` | Disable OTel entirely |

### Sandbox

| Var | Default | Purpose |
|---|---|---|
| `SANDBOX_ENABLED` | `false` | Enable Docker sandbox for hooks + script runner |
| `SANDBOX_DOCKER_IMAGE` | `generatorai/sandbox:latest` | Override sandbox image |
| `SANDBOX_PREFER_DOCKER` | `true` | If Docker unavailable, fall back to `HostProcessSandboxProvider` |

### Streaming

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_SSE_CAP_PER_SCOPE` | session/run/chat=6, global=32 | Per-(scope,id) SSE connection cap |
| `GENERATORAI_HEARTBEAT_MS` | `15000` | SSE heartbeat interval |
| `GENERATORAI_EVENT_TTL_DAYS` | `30` | Event retention (events + stream_cursors) |

### Speech-to-text (voice input)

Local Whisper transcription behind a dedicated WebSocket (`apps/server/src/stt-ws.ts`). No cloud key required. See [feature-chat.md](./feature-chat.md#42-voice-input-speech-to-text).

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_STT` | `1` | Set `0` to disable voice input entirely (mic button hidden, WS returns 501). |
| `STT_MODEL` | `Xenova/whisper-base.en` | Whisper model id. Larger models = better accuracy, slower first load. |
| `STT_CACHE_DIR` | platform cache dir | Where model weights are cached after the first download. |

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

Phase 2 opt-in flags (see [docs/INTEGRATED_TERMINAL_PHASE2_PLAN.md](../../docs/INTEGRATED_TERMINAL_PHASE2_PLAN.md)):

| Var | Purpose |
|---|---|
| `GENERATORAI_TERMINAL_SANDBOX=1` | Enable the sandbox-attached terminal toggle on workflow-run pages. |
| `GENERATORAI_TERMINAL_PROPOSALS=1` | Enable the `terminal.propose` agent tool + inline confirmation card. |
| `GENERATORAI_TERMINAL_PERSIST=1` | Enable DB-backed session + scrollback persistence (survives server restart). |
| `GENERATORAI_TERMINAL_RECORD=1` | Enable session recording (asciinema `.cast` files). |

### Git

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_GIT_TIMEOUT_MS` | `60000` | Per-operation timeout |
| `GIT_SSH_COMMAND` | (system) | Override SSH command for git pull/clone |

### Webhooks

| Var | Default | Purpose |
|---|---|---|
| `WEBHOOKS_ENABLED` | `false` | Master switch for incoming webhook handlers |
| `WEBHOOK_GITHUB_SECRET` | (none) | HMAC shared secret for GitHub webhooks |
| `WEBHOOK_AUTOMATION_BASE_URL` | (server URL) | Used when emitting webhook URLs in API responses |

---

## 5. Production deployment

### Single-process (recommended for solo / small teams)

```powershell
pnpm build
HARNESS_TYPE=copilot \
GENERATORAI_DB_PATH=/var/lib/generatorai/data.db \
GENERATORAI_ARTIFACTS_DIR=/var/lib/generatorai/artifacts \
GENERATORAI_WORKSPACES_DIR=/var/lib/generatorai/workspaces \
GENERATORAI_PORT=3100 \
node apps/server/dist/index.js
```

Behind a reverse proxy (nginx / Caddy) for TLS and (eventually) auth. Make sure:
- `proxy_buffering off` (or `X-Accel-Buffering: no` honored) for SSE.
- WebSocket upgrade is NOT needed (we use SSE, not WS).
- Increase `proxy_read_timeout` to ≥ 600s for long-running runs.

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
  -e GENERATORAI_DB_PATH=/data/data.db \
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

Per-run JSONL logs are written to `<workspace>/artifacts/logs/run.jsonl` by `RunLogger`. Each line is one event.

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
5. **Webhook secrets** — set `WEBHOOK_GITHUB_SECRET`; rotate automation webhook tokens regularly.
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
A workflow stage's `harnessConfigOverrides.model` is provider-specific. Switching `HARNESS_TYPE` without clearing/aliasing model overrides fails. Either:
- Set the model field to a provider-appropriate value (`claude-sonnet-4-6` for Claude Agent; `claude-sonnet-4.6` for Copilot).
- Remove the override to fall back to provider default.

### `Workflow has no root stages`
The DAG has no entry point. Either (a) every stage has incoming edges (cycle hiding via `condition: on_failure`), or (b) you have edges referencing non-existent stage IDs. Run `workflow validate <id>` to see the offenders.

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

- **`sessionMode: 'single'`** is fastest for sequential stages on cheap models.
- **`sessionMode: 'per-stage'`** maximizes parallelism but multiplies harness sessions.
- **`reasoningEffort: 'low'`** halves Claude/Copilot latency at the cost of quality.
- **`harnessConfig.availableTools`** — restricting tools speeds up model decision-making.
- **`contextFilter: 'summary-only'`** (default) is much smaller than `'full'` for long predecessor outputs.
- **`stream_cursors` retention** — shorten `GENERATORAI_EVENT_TTL_DAYS` if disk is tight.
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
