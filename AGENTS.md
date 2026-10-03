# GeneratorAI — agent instructions

Two redesign tracks share this repository. Pick the one your task belongs to:

- **Mobile overhaul** (iOS 27 + Android 17, Expo / React Native in `apps/mobile`) — built on branch `mobile_redesign` in its own worktree. **Read `apps/mobile/AGENTS.md` before any mobile work.** The plan is in `docs/redesign/mobile/` (start at `docs/redesign/mobile/README.md`). Since 2026-10-02 the mobile run is owned by Claude Code (it was Codex before).
- **Web + desktop redesign** (`apps/web`, `apps/desktop`) — built on branch `desktop_redesign`. Its binding rules are `.claude/CLAUDE.md`; the plan is `docs/redesign/*.md` (start at `docs/redesign/README.md`).

`mobile_redesign` is merged into `desktop_redesign` at mobile phase ends, so this file appears on both branches — the rules below apply to both.

**Repository map.** For the monorepo layout, see `.github/AGENTS.md`: `apps/server`, `apps/web`, `apps/desktop`, `apps/mobile`, and `packages/*` (shared, client-core, client-runtime, client-transport, design-tokens, core, db). Tooling is pnpm + turbo on Node.

**Ownership rules:**
- Mobile work edits `apps/mobile/**` and `docs/redesign/mobile/**`; web/desktop work edits `apps/web/**`, `apps/desktop/**` and the web/desktop plan docs. Neither track edits the other's app or plan.
- Shared packages (`packages/shared`, `client-core`, `client-runtime`, `client-transport`, `design-tokens`) change **additively only**; mobile logs every change in `docs/redesign/mobile/COORDINATION.md`.
- Server changes are API-first and additive (`docs/redesign/mobile/05-gap-matrix.md` for mobile gaps).
- Commit only to the branch of your track; never push and never open PRs unless the owner asks.

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
