# Development and quality checks

GeneratorAI is a pnpm/Turbo TypeScript monorepo. Apps own process/client entrypoints, while packages hold shared contracts, domain services, persistence, and adapters. See the [module map](../architecture/modules.md) before adding a cross-client feature.

## Product commands

Run from the repository root after installing dependencies:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Build output matters because apps use TypeScript project references. Product lint includes ESLint plus security, durability, documentation drift, synchronous-I/O, and design-token checks. Individual gates are available as `check:security`, `check:durability`, `check:docs`, `check:syncio`, and `check:tokens`.

Use the relevant workspace package for focused development:

```bash
pnpm --filter @generatorai/web test
pnpm --filter @generatorai/core test
pnpm --filter @generatorai/server test
```

These commands can write product build/test output. They are documentation for product development; they were not run as part of this folder-restricted documentation task.

## Where to implement a feature

1. Define shared types and boundary validation when the feature crosses processes.
2. Put domain behavior behind the appropriate service/port in `packages/core`.
3. Add persistence through repository contracts and migration policy if needed.
4. Wire implementations in the server composition root; account for startup and shutdown.
5. Add routes with explicit authorization and error behavior.
6. Extend client contracts/transports before adding UI-only assumptions.
7. Implement each applicable client surface and document gaps rather than implying parity.
8. Add focused tests for behavior and update these guides and generated indexes.

Do not import Electron APIs into shared domain services, assume the web browser and host share a filesystem, or bypass route scopes for a convenience UI.

## Test layers

| Layer | Scope |
| --- | --- |
| Unit/service tests | State machines, validation, service decisions, adapters |
| Route integration tests | Request contracts, authorization, lifecycle and error responses |
| Client tests | Stores, reducers, UI interactions, terminal behavior |
| Browser end-to-end | Navigation and real rendered flows in `agent-tests` |
| Native/device checks | Electron facilities, Expo/native modules and OS behavior |
| Invariant gates | Security boundaries, durable data behavior, token generation, performance budgets |

A mocked provider test verifies the harness contract, not the hosted model's reasoning. A route's existence does not certify its end-to-end behavior. Keep test reports explicit about the runtime, provider, fixtures, and environment used.

## Schemas, tokens, and source snapshots

Root scripts include `generate:schemas`, database migration commands, `tokens:write`, and CLI documentation/surface generation. Generated files have their own owner and update flow; inspect package scripts before regenerating them.

For this documentation site specifically, use its isolated `npm run reference:generate`, `npm run check`, `npm run build`, and `npm run test:browser` commands. See [Maintaining these docs](../about/site.md).

## Source evidence

`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`, `agent-tests/package.json`, `apps/mobile/e2e/README.md`.
