# Quick start

Use the desktop application when you want a local host and native workspace in one place. Use a standalone server and web client for development or a separate host. Mobile and CLI can connect to that same host.

## Build from this repository

The root package requires Node.js **22 or newer** and declares **pnpm 10.29.2**. Native dependencies include SQLite, Electron, and PTY bindings; install and build on the operating system you intend to run.

From the repository root:

```bash
corepack enable
pnpm install
pnpm build
```

These are **product setup commands**. To run only this documentation site, follow [Hosting this site](../about/hosting.md); it has its own isolated dependency lockfile.

## Run the server and web client

```bash
pnpm dev
```

The server entrypoint uses port `3100` by default, and the web development server starts at `5173`. Check the actual startup output because occupied ports and server identity checks affect startup. The web client proxies `/api` to the local server.

Authentication is enabled by default. A pairing offer must come from the same host that the web client uses. If you use a desktop host’s **Settings → Security** invitation, point `GENERATORAI_DEV_API_TARGET` at that host’s actual port; an independently started desktop host can have different data and a different port. For standalone host bootstrap/invitation commands, see the [CLI guide](../clients/cli.md). For an isolated development session, the server explicitly supports the following opt-in:

```bash
GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1 pnpm dev
```

That flag is restricted to non-production loopback operation; it does not authorize a remote browser. It grants broad local authority, so use it only with a development environment you control. See [Security](../architecture/security.md) for the actual trust boundaries.

To point the web dev client at a different host:

```bash
GENERATORAI_DEV_API_TARGET=http://127.0.0.1:3200 pnpm dev:web
```

## Run desktop

For desktop development, leave `pnpm dev` running first; the desktop launcher expects the Vite renderer at port 5173.

```bash
pnpm dev:desktop
```

For the bundled production-style host and renderer:

```bash
pnpm preview:desktop
```

See [Desktop](../clients/desktop.md) for the exact mode, build, packaging, and remote-host behavior. Desktop and plain server startup do not necessarily resolve the same data paths.

## Connect a provider

Open **Settings → Model Providers** and inspect the providers discovered on the host. Configure or sign in to the provider runtime where required. Model catalogs come from those runtimes; choose a model currently offered for your account instead of copying a historical model name from an example.

`HARNESS_TYPE` chooses the host's default provider; other available providers can still be registered alongside it. Provider IDs, discovery, tools, approval behavior, and experimental paths are documented in [Providers](../architecture/providers.md).

## Complete a first task

1. Open **Projects** and create a project. Attach a codebase you are comfortable using for a trial task.
2. Open **Chats** and create a conversation with that project or a selected source.
3. Choose an available provider, model, and agent. Review workspace mode, tool permissions, and source-control options before sending.
4. Ask for a small change with a clear acceptance condition, such as adding input validation and a focused test.
5. Read tool activity and answer any permission requests or structured questions.
6. Open the workspace tools to inspect changes and files. Review the result before committing, pushing, or creating a pull request.

For a larger worked example, use [Development scenarios](./scenarios.md).

## Add another client

Use [Mobile](../clients/mobile.md) for device pairing and native development builds, or [CLI](../clients/cli.md) for connection profiles and the TUI. A remote client operates against the host's files and execution environment. It does not make its own local files automatically available to the host.

## Source evidence

`package.json`, `pnpm-workspace.yaml`, `apps/server/src/index.ts`, `apps/server/.env.example`, `apps/web/vite.config.ts`, `apps/desktop/package.json`, `packages/shared/src/config/AppConfig.ts`.
