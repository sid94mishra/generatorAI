# Running and operating GeneratorAI

This page covers the **application host**. Publishing the static documentation website is a separate process described in [Hosting the docs](../about/hosting.md).

## Deployment shapes

| Shape | Owns execution | Suitable use |
| --- | --- | --- |
| Standalone desktop | Embedded/local server selected by desktop mode | One-person native workspace |
| Desktop in remote mode | Selected remote server | Native client on a different machine |
| Standalone server + web | Node server | Development, a controlled host, browser access |
| Server container | Container process and mounted data | Reproducible host runtime |
| Optional relay | Host still executes; relay forwards traffic | Deliberately configured remote connectivity |

The live relay path is **not end-to-end encrypted through the relay operator**. Existing cryptographic primitives are not wired into the payload path. Treat the relay as a trusted intermediary and read [Transports](../architecture/transports.md) before deploying it.

## Standalone server

Build the workspace before running the server's production entrypoint:

```bash
pnpm build
pnpm --filter @generatorai/server start
```

The entrypoint also loads `.env` one directory above its entry module (`apps/server/.env` in the source or ordinary `dist` layout), filling only variables absent from the process environment. This is not restricted to development. The development launcher additionally uses `--env-file-if-exists=.env`. Supply managed production settings explicitly, especially telemetry: preloaded instrumentation runs before the entrypoint loader. Set explicit data paths for a managed deployment and preserve the secret key/backend required to reopen the vault.

Configure reachable origins, TLS termination, and device pairing together. Browser cryptography needs a secure context for remote access. A reverse proxy must preserve the request information used for origin and DPoP validation; arbitrary host/scheme rewriting can invalidate proofs.

## Container

The repository includes `docker/server.Dockerfile` and `docker/docker-compose.yml`. The compose file binds the published port to host loopback, persists `/data`, and requires a stable secret key. Supply that key through your deployment's secret-management mechanism before starting:

```bash
cd docker
docker compose up -d --build
```

The container is single-tenant and owns a SQLite database on a persistent volume. Configure the provider's credentials and executable availability in that environment. A working provider on the desktop host does not automatically mean it is available inside a container.

The included `docker/nginx/generatorai.conf` is a starting point for proxy configuration, not proof that your domain, certificates, exposure policy, or provider setup is correct.

## Health and observability

`GET /api/health` reports health/degraded state, provider runtime information, active chats/runs, memory, admission queues, configuration corrections, slow statement summaries, and fallback counters. `/api/health/loop-turn` is a lightweight event-loop liveness probe. Interpret component state as well as HTTP status.

For example, queued turns with no executing turns can indicate a capacity or lifecycle problem. A provider failing to authenticate can leave the UI reachable while task execution is degraded.

OpenTelemetry can export traces and metrics when configured. The optional stack in `docker/observability/` includes collector, Prometheus, and Grafana configuration. See [Voice and observability](../architecture/voice-and-observability.md) and the [environment index](../reference/environment.md) for the source-backed switches.

## Back up a recoverable unit

```bash
pnpm db:backup
```

The script uses SQLite's online-backup API and copies the associated secrets directory beside the database backup. Supply explicit source, destination, and secrets paths for a non-default installation. The script's default source is `~/.generatorai/data.db`, which can differ from standalone development's database path.

Also preserve workspaces, artifacts, custom templates/configuration, and any operator-supplied vault key/passphrase required for restore. A database backup without the matching vault/key material cannot restore saved credentials. OS-key-protected material may require the original user/machine; do not assume it is portable.

For restore, stop the relevant host, restore the database and its matching secrets material together, restore needed files, and then start a compatible application version. Validate on an isolated copy before replacing a live environment. Migrations may move the schema forward; a backup is the rollback path.

## Upgrade and packaging

Inspect release/migration changes, back up, install dependencies, build, and restart under the intended runtime. Desktop packaging stages native dependencies for the target platform and architecture. Use the [desktop guide](../clients/desktop.md) for commands; do not treat cross-platform source support as proof that every signed installer or store package exists.

## Source evidence

`apps/server/src/index.ts`, `apps/server/src/routes/health.ts`, `docker/docker-compose.yml`, `docker/server.Dockerfile`, `docker/observability`, `scripts/db-backup.ts`, `scripts/lib/copySecretsDir.mjs`, `apps/desktop/package.json`.
