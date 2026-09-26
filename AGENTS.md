# GeneratorAI — agent instructions (branch `mobile_redesign`)

This worktree hosts the **mobile design overhaul** (iOS 27 + Android 17, Expo / React Native in `apps/mobile`).

**Read `apps/mobile/AGENTS.md` before any work.** It holds the binding rules. The plan is in `docs/redesign/mobile/`: start at `docs/redesign/mobile/README.md`.

**Repository map.** For the monorepo layout, see `.github/AGENTS.md`: `apps/server`, `apps/web`, `apps/desktop`, `apps/mobile`, and `packages/*` (shared, client-core, client-runtime, client-transport, design-tokens, core, db). Tooling is pnpm + turbo on Node.

**Ownership rules for this branch:**
- Mobile work only. Never edit `apps/web/**`, `apps/desktop/**`, or the web/desktop plan docs (`docs/redesign/*.md` outside `docs/redesign/mobile/`).
- The web/desktop redesign runs in parallel on `desktop_redesign`. It is merged into this branch regularly (`docs/redesign/mobile/09-codex-playbook.md` §5).
- Shared packages (`packages/shared`, `client-core`, `client-runtime`, `client-transport`, `design-tokens`) change **additively only**. Log every change in `docs/redesign/mobile/COORDINATION.md`.
- Server changes are API-first and additive (`docs/redesign/mobile/05-gap-matrix.md`).
- Never commit to `desktop_redesign`, never push, never open PRs, unless the owner asks.

**Other agent files.** `.claude/CLAUDE.md` is the rulebook of the Claude session that builds the web/desktop redesign. Its branch rule does not apply here, and its layer and style rules apply to `apps/web` only.

**Standing rules for the whole repo:**
- **Cross-platform.** Windows, Linux and macOS are first-class, and so are iOS and Android. Never fix a bug for one OS only; find the platform-independent cause.
- **Scripts** are Node `.mjs`, using `path` and `os.tmpdir()`, never bash-only.
- **No backward compatibility.** The product is pre-release with one developer: replace shapes and delete old code in the same task.
- **Isolated test servers only.**
  - Use `node scripts/redesign/sandbox.mjs` (seeded, :3197).
  - A test server needs bare `DB_PATH`, `ARTIFACTS_DIR`, `WORKSPACES_DIR` and `EXTENSIONS_DIR`, plus `GENERATORAI_BIND_HOST=127.0.0.1`.
  - Never use the developer's real database.
- **Git and source-control features** are tested against a throwaway repo (`node scripts/redesign/make-dummy-repo.mjs`), never this checkout.
- **The app's Codex provider** is tested with GPT-5.6-Terra or GPT-5.6-Luna, never GPT-5.3-Codex-Spark.
