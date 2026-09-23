# Configuration

GeneratorAI has several configuration layers. Environment settings configure a process; persisted settings configure its host; project and agent definitions configure reusable behavior; chat and stage overrides configure one execution. A visible control on one client does not imply that every other client can edit it.

See the [complete configuration map](../configuration/index.md), [field-level contracts](../configuration/server.md), [persisted host/client preferences](../configuration/projects-and-settings.md), and [validated examples](../configuration/examples.md).

## Configuration authorities

| Layer | Authority | Examples |
| --- | --- | --- |
| Server startup | `apps/server/src/index.ts`, then `AppConfigSchema` | Ports, paths, provider default, streaming, security |
| Schema defaults | `packages/shared/src/config/AppConfig.ts` | Validation, bounds, fallback values |
| Host settings | Dedicated services and preference files beside the data store | Exposure mode, computer-use preferences, source control |
| Project/codebase | Project services and configuration routes | Skills, prompts, agents, MCP, templates |
| Agent definition | `AgentSchemas.ts`, resolver and staging services | Instructions, tools, provider/model preferences |
| Workflow and stage | `WorkflowDefinitionSchemas.ts` | DAG, context, execution overrides, validation |
| Chat | `ChatSchemas.ts`, creation and update routes | Source, agent, model, permissions, source-control policy |
| Client-local | Client stores and native preferences | Appearance, layout, connections, notifications |

See [Settings](../clients/settings.md) for every desktop/web settings section and the mobile configuration surface.

## Common server environment variables

The values below describe the **standalone server entrypoint**. Desktop supplies some paths and ports itself. The schema's default database path is not the standalone entrypoint's path.

| Variable | Default or behavior | Purpose |
| --- | --- | --- |
| `PORT` | `3100` | Requested HTTP port; inspect startup output for actual binding |
| `DB_PATH` | `packages/db/data/generatorai.db` relative to the source checkout's root resolution | SQLite database |
| `WORKSPACES_DIR` | `~/.generatorai/workspaces` | Workspace allocation |
| `ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Artifact storage |
| `TEMPLATES_DIR` | Repository `templates` directory | Built-in and custom templates |
| `GENERATORAI_EXTENSIONS_DIR` / `EXTENSIONS_DIR` | `~/.generatorai/extensions`; first name takes precedence | User extensions |
| `LOG_LEVEL` | `info` | Host logging |
| `MAX_CONCURRENT_SESSIONS` | `10` | Session cap; parsing and schema validation both apply |
| `HARNESS_TYPE` | `copilot` | Default harness; available providers can coexist |
| `COPILOT_MODEL` | `auto` | Let the provider select, or supply a current model ID |
| `CODEX_CLI_PATH` | Discovery | Explicit Codex executable |
| `CODEX_MODEL` | Provider/account default | Codex model preference |
| `CODEX_APPROVAL_POLICY` | Provider configuration | One of schema-supported approval policies |
| `CODEX_SANDBOX_MODE` | Provider configuration | Codex filesystem/sandbox mode |
| `SSE_HEARTBEAT_MS` | `15000` | Stream keepalive interval |
| `SSE_MAX_REPLAY` | `10000` | Replay bound |
| `SSE_BUFFER_CLEANUP_DELAY_MS` | `300000` | Post-terminal in-memory buffer retention |
| `WEBHOOKS_ENABLED` | Only `true` enables | Global webhook receiver configuration |
| `GITHUB_WEBHOOK_SECRET` / `WEBHOOK_TOKEN` | Unset | Webhook authentication material |
| `CORS_ORIGINS` | Schema's local development origins | Comma-separated allowed origins |
| `GENERATORAI_BIND_HOST` | Explicit override; otherwise persisted exposure mode | Bind policy; first-run loopback |
| `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK` | Off; `1` opts in | Non-production loopback development only |
| `GENERATORAI_REQUIRE_SECURE_SECRETS` | Forced on for production/non-loopback | Require protected or operator-keyed storage |
| `GENERATORAI_SECRET_KEY` / `GENERATORAI_SECRET_PASSPHRASE` | Supplied by operator when used | Stable vault key source; preserve across restarts |
| `GENERATORAI_SESSION_TTL_HOURS` | `48` | Sliding paired-device session lifetime; schema bounds apply |
| `GENERATORAI_RELAY_ENABLED` | `1` enables | Optional outbound relay connector |
| `GENERATORAI_RELAY_DIRECTOR_URL` | Unset | Relay director origin |
| `GENERATORAI_ALLOW_WORKFLOW_SCRIPTS` | `true` enables | Trusted workflow-script loading gate |
| `GENERATORAI_ALLOW_SCRIPT_UPLOAD` | `true` also enables the script flag | Legacy/alternate script opt-in |
| `SANDBOX_ENABLED` | `true` enables | Optional configured sandbox execution |
| `OTEL_ENABLED` | `true` enables | OpenTelemetry collection |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Schema default | Telemetry collector |

Boolean spellings are deliberately explicit: different settings use `1`, `true`, or a disable token. Do not assume a single global boolean parser. See the complete [environment read index](./environment.md) for provider/session limits, diagnostic variables, internal launch channels, and exact source locations.

`GENERATORAI_HOME` appears in older overview material but is not the general standalone path switch in the current entrypoint. Use the explicit path variables above and inspect `/api/health/config` through an authorized client.

## Secrets and provider credentials

Keep real credentials in the configured secret backend or provider authentication flow. The documentation generator reads **variable names from source**, not values from your environment or `.env` files. The entrypoint also reads a `.env` file one directory above the entry module, filling variables absent from the process environment in both development and production. The development launcher additionally uses `--env-file-if-exists=.env`. Preloaded instrumentation runs earlier, so configure telemetry through the real environment for production.

A GitHub Enterprise host changes token resolution. The server avoids blindly forwarding ambient GitHub.com credentials when a GHEC host is configured. If models fail to load, inspect provider diagnostics and the host/token combination rather than repeatedly changing model IDs.

## Configuration schemas

The [coverage inventory](./coverage.md#shared-configuration-contracts) lists every shared configuration module. Important contracts include chat and agent inputs, workflow definitions and scripts, automation inputs, MCP configuration, browser options, widget contracts, and extension manifests. Zod schemas are request-validation authorities; TypeScript types alone do not validate a request.

## Source evidence

`apps/server/src/index.ts`, `apps/server/.env.example`, `packages/shared/src/config/AppConfig.ts`, `packages/shared/src/config/numericEnv.ts`, `apps/server/src/composition/security.ts`, `apps/server/src/routes/health.ts`.
