# Contributing to GeneratorAI

Thanks for your interest. GeneratorAI is alpha software under fast, breaking
development — **please open an issue before starting anything substantial**, so
you don't build against something that's about to be rewritten.

## Reporting security issues

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Getting set up

```bash
corepack enable
pnpm install
pnpm build
```

`pnpm build` must run before typechecking an app: packages are TypeScript
project references, so apps consume the generated `.d.ts` files from `dist/`.

## Before you open a pull request

```bash
pnpm typecheck
pnpm lint
pnpm test
```

All three run in CI across Linux, macOS and Windows. `pnpm lint` also enforces
the security invariants and the design-token check.

## House style

The codebase has a few conventions worth matching:

- **Comments explain _why_, not _what_.** Prefer noting the constraint that
  forced a decision over narrating the code.
- **Keep changes scoped.** No drive-by refactors, reformatting, or unrelated
  "improvements" in a PR that claims to fix one thing.
- **No new abstractions for a single call site.**
- **Validate at boundaries**, not in the middle of internal call chains.

## Security-sensitive areas

Changes touching these get extra scrutiny, and CI enforces invariants over
them — expect review to be slower:

- `packages/auth/` — tokens, DPoP, pairing, scopes
- `packages/secrets/` — the vault and key providers
- `apps/relay/`, `packages/relay-protocol/` — remote access and E2EE
- `apps/desktop/src/main/` — the Electron main process and IPC boundary

If you add an IPC channel, a scope, or an env var that relaxes a default,
say so explicitly in the PR description.

## Commits and pull requests

- One logical change per PR; describe what and why.
- Note any breaking change, migration, or new environment variable.
- Include test coverage for behaviour changes.

## License

Contributions are licensed under the [MIT License](LICENSE).
