# Distribution Guide

How GeneratorAI is delivered to end users in its three consumption modes — **SDK**,
**CLI**, and **Web + Server** — and how to prepare a clean database for shipping.

> Status: the library packages are *publish-ready* (correct `dist` exports, type
> declarations, `publishConfig`), but are not yet published to a registry. This guide
> documents the supported delivery paths and the exact steps.

---

## Package layout & publishability

| Package | Publishable | Role for consumers |
|---|---|---|
| `@generatorai/sdk` | ✅ | Primary entry — embed the orchestration engine in your app |
| `@generatorai/core` | ✅ | Engine internals (orchestrator, services, ports) — transitive dep of SDK |
| `@generatorai/db` | ✅ | SQLite + Drizzle repositories + migrations — transitive dep of SDK |
| `@generatorai/shared` | ✅ | Types, Zod schemas, errors, logger — transitive dep of SDK |
| `@generatorai/agent-harness-providers` | ✅ | Copilot / Claude Agent adapters — transitive dep of SDK |
| `@generatorai/server` | private | Run as an app (REST+SSE API) |
| `@generatorai/web` | private | Run as an app (SPA, talks to server) |
| `@generatorai/cli` | private | Run as an app (`generatorai` TUI/CLI) |

**Dev vs published resolution.** In the monorepo, every library package's `exports`
point at TypeScript **source** so `pnpm dev` / `tsx` / `vite` run without a build step.
At publish time, pnpm applies each package's `publishConfig` block, which swaps `main`,
`types`, and `exports` to the compiled **`dist`** outputs (`.js` + `.d.ts`). This keeps
the dev experience fast while shipping a correct, type-complete package.

---

## Mode 1 — SDK (embed the engine)

```bash
npm install @generatorai/sdk
# optional: install the harness SDK(s) you actually use
npm install @github/copilot-sdk            # for provider: 'copilot'
npm install @anthropic-ai/claude-agent-sdk # for provider: 'claude-agent'
```

```ts
import { createGeneratorAI } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  provider: 'copilot',          // or 'claude-agent', or a custom IAgentHarness
  database: './generatorai.db', // created + migrated automatically on first use
});

await ai.workflows.run(definitionId, { variables: { code: '...' } });
```

The harness SDKs are **optional peer dependencies** of
`@generatorai/agent-harness-providers` — only the one matching your `provider` needs to
be installed.

---

## Mode 2 — CLI (`generatorai`)

Within the monorepo:

```bash
pnpm build
pnpm start:cli -- <command>
```

The CLI (`apps/cli`, bin name `generatorai`) is a Commander + Ink TUI. To distribute it
standalone, bundle it with its workspace deps (e.g. `tsup`/`esbuild`) into a single
executable and publish, or ship the built `dist` plus a `node_modules` install.

---

## Mode 3 — Web + Server

```bash
pnpm build
pnpm --filter @generatorai/server start    # REST + SSE API on :3100
pnpm --filter @generatorai/web preview      # static SPA, proxies /api → :3100
```

The web app is a static SPA that talks to the server's REST+SSE API. For deployment,
serve `apps/web/dist` from any static host and run the server process separately
(point the SPA's API base at the server URL).

---

## Database preparation for distribution

The runtime database is SQLite. By default it lives at `~/.generatorai/data.db` (override
with the `DB_PATH` env var or the SDK `database` option). Migrations run idempotently on
every boot via `migrateDB()`.

Two scripts manage clean databases (both run the canonical `migrateDB()` path, so the
shipped schema can never drift from what the app expects):

```bash
# Reset a local/dev database (deletes the file + WAL/SHM, recreates empty + migrated)
pnpm db:reset [path]            # explicit path
pnpm db:reset --force          # wipe the default ~/.generatorai/data.db (--force required)

# Produce a clean, empty, migrated TEMPLATE database for shipping
pnpm db:prepare-dist [path]     # default: packages/db/data/template.db
```

`db:prepare-dist` writes a single self-contained `.db` file (WAL folded in via
`wal_checkpoint(TRUNCATE)`) suitable for bundling. On first run, an app copies the
template to its runtime DB path; alternatively, just let `migrateDB()` create the DB
fresh on first boot.

To back up a live database safely (WAL-aware online backup):

```bash
pnpm db:backup [source.db] [destination.db]
```

> **Do not ship a developer database.** Local dev DBs accumulate event/stream rows and
> can grow to gigabytes. Always distribute the empty `template.db` from `db:prepare-dist`,
> or rely on first-boot migration. The `events` / `stream_cursors` tables are pruned at
> runtime by `EventRetentionService` (configurable TTL).
