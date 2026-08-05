# GeneratorAI

An agentic developer workspace. Run AI agents against your codebase from a
native desktop app, a web UI, a CLI, or your phone — with a provider-agnostic
harness that works with GitHub Copilot or the Claude Agent SDK.

> [!WARNING]
> **Alpha software (`0.0.1-alpha`).** Breaking changes land without notice,
> data migrations may not be provided, and nothing has been security audited.
> Agents execute code on your machine. Don't point it at anything you'd mind
> losing, and don't expose it to an untrusted network.

## Requirements

- **Node.js** >= 20
- **pnpm** 10 (`corepack enable`)
- A supported agent harness (GitHub Copilot CLI or Claude Agent SDK)

## Quick start

```bash
pnpm install
pnpm build
pnpm dev            # server + web UI
```

Other entry points:

```bash
pnpm dev:cli        # CLI
pnpm dev:desktop    # desktop shell against the Vite dev server
pnpm preview:desktop  # desktop shell with the embedded production server
pnpm package:desktop  # build installers for this platform
```

## Layout

```
apps/
  desktop/   Electron shell — embeds the server and serves the web UI
  server/    HTTP + SSE + WebSocket API
  web/       React SPA (also served to mobile through the relay)
  cli/       Command-line client
  mobile/    Companion app
  relay/     Optional end-to-end-encrypted remote-access relay
packages/    Shared libraries — auth, db, core, secrets, harness providers, …
```

## Development

```bash
pnpm typecheck
pnpm lint          # eslint + security invariants + design-token check
pnpm test
```

`pnpm lint` runs two custom gates alongside eslint: `check:security`
(security invariants, and a check that no app-wide CDP port is opened) and
`check:tokens` (design tokens match their generated output). Both are enforced
in CI.

## Packaging

Build desktop installers for your current platform:

```bash
pnpm package:desktop     # → apps/desktop/release/
```

Windows gets an `nsis` installer and a portable exe, macOS a `dmg` and `zip`,
Linux an `AppImage`, `deb` and `rpm`. Each carries the whole stack — Electron
shell, web SPA, and the server bundled with its native dependencies compiled
against Electron's ABI.

Two constraints are worth knowing before you start: you must build on the
platform you are targeting, and the installer architecture must match the
staged server runtime.

Step-by-step commands, cross-architecture builds, signing, update channels and
release publishing are in
**[.github/docs/packaging.md](.github/docs/packaging.md)**.

## Configuration

Configuration is environment-driven; see [apps/server/.env.example](apps/server/.env.example).
Frequently used:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | `3000` | API port |
| `GENERATORAI_BIND_HOST` | `127.0.0.1` | Bind interface. Anything non-loopback forces authentication on |
| `GENERATORAI_HOME` | `~/.generatorai` | Data root |
| `GENERATORAI_SESSION_TTL_HOURS` | `48` | How long a paired device may resume before pairing again |
| `HARNESS_TYPE` | `copilot` | Agent harness to use |

## Security

The threat model, supported versions and private reporting process are in
[SECURITY.md](SECURITY.md). Please report vulnerabilities privately rather
than opening an issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are welcome, but note
that the architecture is still moving quickly during alpha — open an issue to
discuss anything substantial before writing it.

## License

[MIT](LICENSE)
