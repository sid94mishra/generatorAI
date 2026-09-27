# PHASE 00: Baseline and safety net

**Goal:** make every later phase verifiable, before any production code changes. When this phase ends, the repo has:
- a backup and an export of the developer's workflow definitions;
- a reusable workflow test kit (fake harness plus in-memory DB);
- a repeatable live E2E harness against an isolated server;
- golden snapshots of today's session configs;
- lint invariants that later phases tighten.

**Estimate:** 3–4 days. **Depends on:** nothing. **Branch:** `wf/phase-00-baseline`.

## Read first
- `README.md` §0, §7, §8
- `docs/workflow-audit/evidence/F_live_tests.md` §0 (setup recipe), §5 (test definitions)
- `docs/workflow-audit/evidence/G3_legacy_inventory.md` §4.3–4.4 (DB facts: 7,337 of 8,178 `chat_messages` rows are stage transcripts)
- Memory notes on env gotchas: turbo typecheck, OneDrive EPERM, isolated server, pairing.

## Out of scope
Any behaviour change in `packages/core`, `apps/server`, `apps/web` or the other product packages.

---

## WP-0.1 Branch, backup and definition export

**Why:** the migrations in P01–P03 drop run history and rewrite definition storage (PD-13). The developer's own DB (`packages/db/data/generatorai.db`, about 368 MB, WAL) holds real chats, whose stage sessions are interleaved with chat sessions.

**Tasks:**
1. `git switch -c wf/phase-00-baseline` from `desktop_redesign`.
2. Add `scripts/workflow-backup.mjs`. It must:
   - refuse to run while port 3100 is listening (check with a `net.connect` probe);
   - copy `generatorai.db`, `-wal` and `-shm` to `~/.generatorai-backups/<timestamp>/`, using `fs.copyFileSync` rather than rename (OneDrive);
   - export every workflow definition, with its stages and edges, into `~/.generatorai-backups/<timestamp>/workflow-definitions.json` by reading SQLite read-only with better-sqlite3 from `packages/db`. Do not use the API; the server may be down;
   - print row counts for `sessions` by `owner_type`, `chat_messages` joined to sessions, `workflow_definitions`, `workflow_runs` and `automations`.
3. Add the root script `"workflow:backup": "node scripts/workflow-backup.mjs"`.
4. Document the procedure in `docs/workflow-overhaul/STATUS.md` (create it with a per-phase checklist table).

**Acceptance:**
- Running the script on a copy of the real DB produces a backup folder and a definitions export that is valid JSON with N definitions, where N equals `SELECT COUNT(*) FROM workflow_definitions`.

## WP-0.2 `@generatorai/workflow-testkit` (new package, test-only)

**Why:** later phases rewrite the engine. They need a deterministic, fast harness for whole runs on a fake provider, as recommended in G5 §7.4. `FauxProvider` already exists at `packages/agent-harness-providers/src/providers/faux/FauxProvider.ts`.

**Tasks:**
1. Create `packages/workflow-testkit/`: `package.json` (private, devDependency only), `tsconfig.json` (composite), `src/index.ts`.
2. Export `createTestEngine(opts)`. It must:
   - boot an in-memory SQLite database with all migrations (`migrateDB`), using the same repositories and services as `apps/server/src/composition-root.ts` (reuse `createCoreServices` if possible; otherwise build a minimal wiring and note the gap in the PR);
   - use a `FauxProvider` whose script is supplied per session: `scriptFor(sessionKeyOrStageName) => Turn[]`, where a `Turn` is `{ text?, toolCalls?, usage?, error?: HarnessErrorLike, delayMs?, hang?: true }`;
   - use a virtual clock (`opts.clock`) wherever services accept a clock. Record every service that reads `Date.now()` directly in `STATUS.md`; P03 removes them.
   - return helpers: `runWorkflow(definitionJson, variables) → {runId, waitForTerminal(), events[], db}`, `snapshotRun(runId)` (runs, stage runs, messages, events) and `killAndRestart()` (dispose services, then re-create them on the same DB, to simulate a crash).
3. Port the F-suite scenarios into tests in `packages/workflow-testkit/__tests__/current-engine/`, asserting **today's** behaviour. These are characterisation tests; P03 deletes or flips them:
   - T1 fan-out/fan-in;
   - T2 conditions;
   - T3 failure edges;
   - T4 validation rule texts;
   - T5 approve/reject/pause/cancel;
   - T6 import/export;
   - T7 context filters;
   - T8 crash.

   Mark each known-bug assertion with `// KNOWN-BUG W-xx`, so the P03 PR flips those assertions explicitly.

**Acceptance:**
- `pnpm --filter @generatorai/workflow-testkit test` passes.
- The suite runs in under 60 s on this machine.

## WP-0.3 Isolated live E2E harness (`scripts/workflow-e2e/`)

**Why:** live runs found issues static review could not (F-1/F-2/F-3/F-5). Every phase gate re-runs them.

**Tasks:**
1. Copy and clean the working recipe from `C:/gaimob/wfe2e/` (`client.mts`, `pair.mts`, `runwf.mts`, `db.mjs`, `t*.mts`, `t*.json`) into `scripts/workflow-e2e/`.
   - **Never copy `creds*.json`** (device credentials, RV-34).
   - Add `scripts/workflow-e2e/.gitignore` covering `out/` and `creds*`.
   - Credential files live under `C:/gaiwf/creds/`.

   Keep the approach:
   - a file-backed `SecretSink` credential, one file per concurrent process;
   - pairing through `POST /internal/desktop/pairing` with the local-admin token;
   - `runtime.fetch` for DPoP-signed calls;
   - `buildStreamUrl('run', id)` for SSE capture.
2. `scripts/workflow-e2e/server.mjs` starts an isolated server:
   - `PORT=3111`, `DB_PATH=C:/gaiwf/data/data.db`, `WORKSPACES_DIR=C:/gaiwf/ws`, `ARTIFACTS_DIR=C:/gaiwf/art`, `GENERATORAI_BIND_HOST=127.0.0.1`;
   - `HARNESS_TYPE` taken from the environment;
   - the paths stay short.

   It then waits for `/api/health`, and it stops **only the process it started**.
3. `scripts/workflow-e2e/run.mjs --phase NN [--provider claude-agent|faux] [--only T1,T5]` runs the scenario list for that phase (a registry file `scenarios.json` that each phase appends to). It writes `scripts/workflow-e2e/out/<ts>/report.json` with pass/fail, timings, captured events and DB snapshots.
4. Default model: `haiku` on claude-agent. Keep prompts free of the "reply exactly" phrasing that triggered refusals (F §0 caveat). Use "Write one line containing the token X".
5. Add the root script `"workflow:e2e": "node scripts/workflow-e2e/run.mjs"`.

6. **Gate policy (RV-35).**
   - Every phase's hard gate is the **testkit** (FauxProvider scripts, deterministic, including forced review rounds).
   - The live `claude-agent` run is **required but advisory**: retry a failed scenario up to 2 times and attach the transcripts. A persistent live failure blocks only if it reproduces on the testkit, or the PR explains why it is model noise.

**Acceptance:**
- `pnpm workflow:e2e --phase 00 --provider claude-agent` runs T1/T2/T3/T7/T10-small, produces a report, and leaves no stray server running.
- The report matches F_live_tests §1 for the scenarios run, including the known failures.

## WP-0.4 Dependencies and generators scaffold

**Tasks:**
- Add devDependencies:
  - `fast-check` to `packages/core`, `packages/workflow-testkit` and later `packages/workflow-spec`;
  - `zod-to-json-schema` (direct, pinned to the monorepo's zod 3.x).
- Add the dependency `ajv` + `ajv-formats` (2020-12 draft) to `packages/core`. It is used from P03.
- Create a `scripts/generate-workflow-spec.ts` placeholder with a `--check` flag, following the convention of `scripts/generate-schemas.ts`. It does nothing yet except exit 0, and P01 fills it in.

## WP-0.5 Golden snapshots of session composition (chat and stage)

**Why:** P02 extracts one composer from three builders. The chat prompt-cache prefix must stay byte-identical (R-10, G2 §6 risk 1).

**Tasks:**
1. Add a test `packages/core/__tests__/session-golden/composeGolden.test.ts`. It instantiates `ChatManagementService` and `StageExecutionService` with fake deps (a harness spy recording `createConversation`/`resumeConversation` params), then serialises the params, redacting ids and paths, for:
   - (a) chat create;
   - (b) chat resume;
   - (c) orchestrator chat;
   - (d) worker chat;
   - (e) chat with an agent (team, disallowedTools, replace projection);
   - (f) stage with the same agent;
   - (g) a stage with browser enabled.

   Store the output in `__snapshots__`.
2. Record the known drifts as annotated expectations (W-50/51/52), so that P02 can flip them deliberately.

## WP-0.6 Lint invariants scaffolding

**Tasks:**
1. `scripts/check-workflow-invariants.mjs` implements rule `no-direct-stage-status-write`. It flags `stageRunRepo.updateStatus(`, `.update(` with a `status` key, and SQL `UPDATE stage_runs SET status` outside `packages/db/src/repositories/StageRunRepository.ts`. In P00 this rule runs in **report-only** mode (prints the count). P03 switches it to fail.
2. `scripts/check-no-legacy.mjs` has a banned-identifier list per phase in `scripts/no-legacy.json`, starting empty. It greps `packages/**` and `apps/**` (excluding tests, dist and node_modules) and fails on any hit.
3. Add both to the root `lint` script.

## WP-0.6b Migration lock and fresh-DB baseline (RV-2, RV-3)

**Why:** `migrations.lock.json` does not exist. Also, `migrateDB` runs the legacy bootstrap and then every versioned migration from v1 on a fresh DB. Once v55 drops legacy tables, the historic migrations (e.g. v11 updating `workflows`/`copilot_config*`) would fail on fresh installs.

1. **Lock.**
   - `packages/db/src/migrations/migrations.lock.json` maps `{version: sha256(of the migration's SQL/JS source)}` for v1..v54.
   - `scripts/check-migrations-lock.mjs` (added to `pnpm lint`) fails when an existing entry's hash changes (history is immutable) or when a migration lacks an entry.
2. **Baseline for fresh DBs.**
   - `packages/db/src/migrations/baseline.sql` is generated by `scripts/generate-db-baseline.ts`: it runs every migration on an empty DB and dumps `sqlite_master` DDL in dependency order.
   - `BASELINE_VERSION = 54` for now.
   - `migrateDB`: when `_schema_versions` is empty **and** the DB has no user tables, apply `baseline.sql` and stamp v1..BASELINE_VERSION as applied, then run the migrations above the baseline. Existing DBs keep the current path (legacy bootstrap + versioned migrations).
   - Every later phase's migration WP regenerates the baseline and bumps `BASELINE_VERSION`. The legacy bootstrap block is **never edited again**; it runs only for pre-baseline existing DBs.
3. **Tests:**
   - an empty DB reaches head via the baseline, and the result matches `schema.ts` (a drizzle introspection diff);
   - a v52 fixture DB (copied from a backup, anonymised) reaches head via the legacy path;
   - both end with identical `sqlite_master` DDL.

## WP-0.8 Run-worktree cleanup before any purge (RV-29)

`scripts/workflow-cleanup-runs.mjs` (`pnpm workflow:cleanup-runs`):
- refuses to run while :3100 is listening;
- for every `worktrees` row with `run_type='workflow'` and every `execution_workspaces` row with `owner_type='workflow_run'`, removes the git worktree through the repo's `WorktreeService.remove`, including `git worktree prune`;
- deletes the `generatorai/run-*` branches **only if merged or never pushed**;
- logs everything to `~/.generatorai-backups/<ts>/cleanup.log`;
- lists orphan directories without deleting them.

The v55 and v57 migrations require this log to exist for the current DB, and print instructions otherwise.

## WP-0.7 Record the failure baseline

- Run the §7 gate once and record the results in `STATUS.md` as the baseline:
  - typecheck;
  - the test counts per package;
  - the known flaky or failing tests (Windows symlink EPERM in `StageExecutionService.test.ts`);
  - the E2E report.

---

## Phase gate
- All §7 gate steps pass (with the recorded baseline exceptions).
- Nothing under `packages/core/src`, `apps/*/src` or `packages/db/src` changed, except test files and package.json devDependencies.

## Handoff checklist
- [ ] Backup and export script works on a DB copy.
- [ ] Testkit package, with the characterisation tests marked `KNOWN-BUG`.
- [ ] `pnpm workflow:e2e` works end to end on :3111.
- [ ] Golden session snapshots are committed.
- [ ] Invariant scripts are wired (report-only).
- [ ] Migration lock + lint, fresh-DB baseline mechanism and tests are in place.
- [ ] The run cleanup script has been exercised on a DB copy.
- [ ] `STATUS.md` holds the baseline.
