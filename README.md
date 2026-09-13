# GeneratorAI

An agentic developer workspace. Run AI agents against your codebase from a
native desktop app, a web UI, a CLI, or your phone — with a provider-agnostic
harness that works with GitHub Copilot or the Claude Agent SDK.

> [!WARNING]
> **Alpha. Not ready to use, and not supported.** Breaking changes land without
> notice, data migrations may not be provided, and nothing has been security
> audited. Agents execute code on your machine. Don't point it at anything
> you'd mind losing, and don't expose it to an untrusted network.
>
> Nothing here is announced or promoted yet. If you found this, you're early —
> please treat it as a work in progress rather than a product.

## Install

Start with the **desktop app**: it contains a server, so there is nothing else
to set up. Then point other clients at it — the phone scans a pairing code, the
command-line tool pairs with a code.

Everything below comes from the
[latest release](../../releases). Pre-releases are on the `alpha` channel and
are not offered to anyone who hasn't opted in.

| | Download | Notes |
|---|---|---|
| **Windows** | `GeneratorAI-Setup-*.exe` | Windows shows a blue **"Windows protected your PC"** screen. Choose **More info → Run anyway**. It appears because the installer isn't code-signed yet — a certificate costs money this project hasn't spent. Updates work normally after install. |
| **macOS** | `GeneratorAI-*-arm64.dmg` | **Apple Silicon (M1 and later) only.** macOS says *"Apple could not verify…"* and refuses to open it. Go to **System Settings → Privacy & Security**, scroll to the bottom, click **Open Anyway**, then launch it again. Unsigned Mac builds **cannot auto-update** — each new version is a fresh download. |
| **Linux** | `.AppImage`, `.deb`, `.rpm` | No warnings. The AppImage updates itself; deb and rpm don't. |
| **Android** | `GeneratorAI-*-android.apk` | Sideloaded, so Android asks permission to install from an unknown source. Not on Google Play, so no automatic updates — an app like Obtainium can watch this releases page for you. |
| **Server on its own** | Container image | `docker run -p 3100:3100 -v generatorai_data:/data ghcr.io/sid94mishra/generatorai-server:alpha` — needs `GENERATORAI_SECRET_KEY` set; see [operations](.github/docs/operations.md). |
| **Command line** | npm | `npm i -g @generatorai/cli@alpha` then `generatorai`. |

> [!NOTE]
> The phone app talks to your server over your local network. To reach it from
> anywhere else you need to run the optional relay yourself — that isn't
> packaged yet.

## Requirements

Only if you're building from source. The installers above carry everything.

- **Node.js** >= 22
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
| `HARNESS_TYPE` | `copilot` | Default agent provider (`copilot`, `claude-agent` or `codex`); other available providers run alongside it |
| `CODEX_CLI_PATH` | auto-resolved | Codex CLI location; unset uses PATH, then the ChatGPT desktop app's bundled CLI |

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
