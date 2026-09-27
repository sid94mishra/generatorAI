# Overhaul status

The coding agent updates this file in every phase PR.

| Phase | Branch | Status | PR | Gate report | Notes |
|---|---|---|---|---|---|
| 00 Baseline | wf/overhaul (see DEVIATIONS) | done, reviewed | local only | Baseline section below | gate pass with the recorded baseline exceptions |
| 01 Spec, legacy, definitions | wf/overhaul (see DEVIATIONS) | done, reviewed | local only | part A gate 2026-09-25: typecheck 50/50; tests = the 12 baseline failures only (cli 5, core 3, git 2, server 2); lint green; no-legacy 69 bans, 0 hits, 12 comments (baseline 12); db-baseline + migrations-lock + BaselineFreshDb pass ; part B gate 2026-09-25: typecheck 52/52; workflow-spec 359/359; lint green; no-legacy 72 bans, 0 hits; generate:workflow-spec --check clean; **phase gate 2026-09-25 (part C): see "Phase 01 gate" below** | WP-1.6–1.9 done (1d67d0f, 28f9c5e, 9c61ec6, ebb4e82); v55 applied to the dev-DB copy |
| 02 SessionComposer | wf/overhaul (see DEVIATIONS) | done, reviewed | local only | **phase gate 2026-09-25: see "Phase 02 gate" below** | WP-2.0–2.11 (0c02b1c..a220bb3), bans/docs c35f905, gate fixes f14cf5a; v56 applied to the dev-DB copy |
| 03 Engine v2 | wf/overhaul (see DEVIATIONS) | done, reviewed | local only | **phase gate 2026-09-26: see "Phase 03 gate" below** (part 1 and part 2 gates below it) | WP-3.1–3.9 (dd00852..48cc4ec); the cutover is 5dad4e7; v57 applied to the dev-DB copy |
| 03b Stage conversation | wf/overhaul (see DEVIATIONS) | done, reviewed (final review 2026-09-26) | local only | **phase gate 2026-09-26: see "Phase 03b gate" below** | WP-3b.1 0254811, WP-3b.4 2529558, WP-3b.2/3b.3 63db929, docs f55692b; no migration |
| 04 Lifecycle and invocation | wf/overhaul (see DEVIATIONS) | done, reviewed (final review 2026-09-26) | local only | **phase gate 2026-09-26: see "Phase 04 gate" below** | WP-4.1–4.5 6fd9adc, bans a09e3d1, docs 5882780; v58 applied to the dev-DB copy |
| 05 Control flow (5A, 5B) | wf/overhaul (see DEVIATIONS) | done, reviewed (final review 2026-09-26) | local only | **5A gate and 5B gate 2026-09-26: see "Phase 05A gate" and "Phase 05B gate" below** | 5A: WP-5A.1 0c3f4e2, 5A.4 0eb53ad, 5A.2 5861460, 5A.3 b3fae98, 5A.6 0103a4d, 5A.5 936e7a1 + 4d6ba7e, lint f7b2626; v59 applied to the dev-DB copy. 5B: spec 3eb76c9, engine 5ffd0a4, fork 1d195c3, builder 429933a, expression editor c8640ef, run page 046f193, clients dcd3b60, templates c46fe80, docs 9e41d05 + 51aee1b, fixes/bans ad2f99d; no migration. Handoffs notes/P05A-handoff.md, notes/P05B-handoff.md |
| 06 Agents and skill | wf/overhaul (see DEVIATIONS) | done, reviewed (final review 2026-09-26) | local only | **phase gate 2026-09-26: see "Phase 06 gate" below** | v60 21393c6; WP-6.1 a55a1bf (+a569934, 4d7869c), 6.2 52e5497/966e114/c44ba88/a7aadc2, 6.3 a55a1bf, 6.4 cf0ac96, 6.5 52e5497, 6.6 ba3759a, 6.7 e0f06ac, 6.8 fc3f9dc, 6.9 3e685fd/f1db906, deviations 59f9b29; v60 applied to the dev-DB copy |
| 07 Economy and UX | wf/p07, merged into wf/overhaul (ff6e4b6) | done, reviewed (final review 2026-09-26) | local only | **phase gate 2026-09-26: see "Phase 07 gate" below** | WP-7.1–7.7 (3a93d7f..6ebfac0); no migration; notes/P07-report.md |
| 08 Dynamic workflows | wf/overhaul (see DEVIATIONS) | WP-8.3, 8.4 done, reviewed (final review 2026-09-26); WP-8.1/8.2/8.8 gated (PD-21), WP-8.5–8.7 backlog | local only | **phase gate 2026-09-26: see "Phase 08 gate" below** | WP-8.3 a0c64df (judge panel, map winner merge), WP-8.4 c090f3e (plan-then-execute expansion); no migration |
| 09 Release gate | wf/overhaul (see DEVIATIONS) | done where the gate and smoke cover it; WP-9.1/9.2/9.5 and the docs rewrite deferred (product owner: minimal testing) | local only | **final review gate 2026-09-26: see "Final review gate" below** | fix batches A (on the branch), B (merge 35fb83c), C (merge 9696be3); follow-ups aec47e0; test fixes c77f651, 216571d; smoke PASS, smoke-live (Haiku) PASS |

## Phase 00 checklist

| WP | Item | Done |
|---|---|---|
| 0.1 | Backup + definition export script works on a DB copy | [x] |
| 0.2 | Testkit package + characterisation tests (KNOWN-BUG markers) | [x] |
| 0.3 | `pnpm workflow:e2e` end to end on :3111 | [x] |
| 0.4 | Dependencies + generator scaffold | [x] |
| 0.5 | Golden session snapshots committed | [x] |
| 0.6 | Invariant scripts wired (report-only) | [x] |
| 0.6b | Migration lock + lint, fresh-DB baseline + tests | [x] |
| 0.8 | Run cleanup script exercised on a DB copy | [x] |
| 0.7 | Baseline recorded below | [x] |

## Backup procedure (P00 WP-0.1; run before any migration WP touches a real DB)

1. Stop the developer server on :3100. The script refuses to run while :3100 is listening.
2. `pnpm workflow:backup`. Defaults: `--db` is `$DB_PATH`, else `<repo>/packages/db/data/generatorai.db`; `--out-root` is `$GENERATORAI_BACKUP_ROOT`, else `~/.generatorai-backups`.
   It copies `generatorai.db`, `-wal` and `-shm` with `fs.copyFileSync` into `<root>/<YYYYMMDD-HHMMSS>/`, opens the **copy** read-only, and writes:
   - `workflow-definitions.json`: every definition with its stages and edges, as raw rows (lossless);
   - `manifest.json`: the copied files and row counts (sessions and chat_messages by owner_type, chats, definitions, stages, edges, runs, stage runs, automations).
3. Check that `workflow-definitions.json` `count` equals `SELECT COUNT(*) FROM workflow_definitions`, and keep the printed counts: the migration WPs compare chat counts against them.
4. Run `pnpm workflow:cleanup-runs` (WP-0.8) before v55/v57 purge run history.

Exercised on 2026-09-24 against a copy of the developer DB (`C:/gaiwf/dbcopy`, backup root `C:/gaiwf/backups`):
- schema v52 (the developer DB is two migrations behind head v54);
- sessions `{chat: 392, stage_run: 1931}`; chat_messages `{chat: 841, stage_run: 7337}`; chats 362;
- workflow_definitions 343 (export `count` 343, 867 stages); stage_edges 473;
- workflow_runs 1113; stage_runs 2809; automations 50.

## Baseline (filled in P00 WP-0.7)

The §7 gate was run once on 2026-09-24 at `wf/overhaul` @ 23fca90 (Windows 11, Node 26.8.2, pnpm 10.29.2).

**1. `pnpm install --frozen-lockfile`:** pass.

**2. `pnpm turbo typecheck`:** pass. 50/50 tasks, 2 min 27 s.

**3. `pnpm turbo test --concurrency=2 --continue`:** 8 min 37 s.
- 27 packages pass.
- 4 packages fail, with 12 known baseline failures, listed below. Every one fails alone too, and every one lives in code P00 did not touch.

| Package | Pass | Fail | Skip |
|---|---|---|---|
| agent-harness-providers | 698 | 0 | 0 |
| agent-host | 48 | 0 | 0 |
| auth | 45 | 0 | 0 |
| browser-host | 8 | 0 | 11 |
| changes | 46 | 0 | 0 |
| checkpoints | 19 | 0 | 0 |
| cli | 318 | **5** | 8 |
| cli-core | 901 | 0 | 0 |
| client-core | 297 | 0 | 0 |
| client-runtime | 33 | 0 | 0 |
| client-transport | 59 | 0 | 0 |
| core | 1862 | **3** | 9 |
| cua-host | 16 | 0 | 0 |
| db | 136 | 0 | 4 |
| design-tokens | 239 | 0 | 0 |
| desktop | 193 | 0 | 1 |
| git | 56 | **2** | 0 |
| mcp-server | 18 | 0 | 0 |
| mobile | 1099 | 0 | 0 |
| pty-host | 17 | 0 | 0 |
| relay | 20 | 0 | 0 |
| relay-protocol | 18 | 0 | 0 |
| review | 30 | 0 | 0 |
| sdk | 8 | 0 | 0 |
| secrets | 16 | 0 | 0 |
| server | 554 | **2** | 0 |
| shared | 322 | 0 | 0 |
| source-control | 64 | 0 | 0 |
| tui-kit | 99 | 0 | 0 |
| web | 650 | 0 | 0 |
| workflow-testkit | 38 | 0 | 0 |
| root `scripts/__tests__` (`pnpm test:scripts`, now also run by `turbo test` via `//#test:scripts`) | 28 | 0 | 0 |

**Known baseline failures.** Each is environmental on this machine, and each also fails when run alone:

- **Windows symlink EPERM** (no symlink privilege):
  - core `StageExecutionService.test.ts` › "delivers uploaded prompt files … without following symlinks";
  - server `orchestrator-uploads.test.ts` › "refuses a symlinked destination …".
- **CRLF checkouts** (`core.autocrlf=true` here and in the main checkout):
  - server `csp.test.ts` › the theme-flash hash. `apps/web/index.html` is checked out with CRLF.
  - git `GitClientScm.test.ts` › 2 merge tests. They expect `\n` and get `\r\n`.
  - core `SourceControlFlowService.test.ts` › "(e) start → continue → abort …". Same `\r\n` cause.
- **POSIX path assumption:** core `workflowPreprocessorClone.test.ts` › "clones the repository URL …" expects `/runs/run-1/target` and gets `\runs\run-1\target`.
- **CLI TUI on Windows** (deterministic):
  - cli `narrowWidths.test.ts` › 3 cases ("title bar missing");
  - `tui-e2e.test.tsx` › "resets the cursor when a pane is replaced";
  - `tui-sweep.test.ts` › "drives every binding without corrupting a frame".
- Without `--continue`, `turbo test` stops at the first failing package (cli). The gate command must include `--continue`.

**4. `pnpm lint`:** pass.
- 27/27 turbo lint tasks pass, and so do the security, durability, docs, syncio and tokens checks.
- The new checks (after the P00 review):
  - `check:workflow-invariants`: **24** direct stage-status writes, report-only with a growth ratchet (`BASELINE = 24`). The rule was widened in R9 to also catch `batchUpdateStatus`, `!`/`?.` receivers and patch variables. The 24 are 18 `update({ status })`, 3 `updateStatus`, 2 `batchUpdateStatus` and 1 patch variable, in `StageExecutionService`, `WorkflowRunService` and `StartupRecoveryService`.
  - `check:no-legacy`: 0 banned patterns. **64** legacy comments (`@deprecated` / `legacy` / `backward compat` / `fallback for old`) in the workflow module, report-only with a growth ratchet (`scripts/no-legacy.json` `comments.baseline`).
  - `check:migrations-lock`: 54 locked and unchanged.
  - `check:db-baseline`: `baseline.sql` is up to date with the migrations.

**5. Hard gate: the testkit.** `pnpm --filter @generatorai/workflow-testkit test` passes: 38/38 in about 20 s (3 consecutive runs).

**5. Advisory: the live E2E.** `pnpm workflow:e2e --phase 00 --provider claude-agent` (haiku, :3111).
- Report `scripts/workflow-e2e/out/20260924-193343/report.json` (git-ignored; copy under `C:/gaiwf/e2e-reports/`):
  - T2 PASS (140 s);
  - T3 PASS (116 s);
  - T7 PASS (157 s);
  - T10-small PASS (227 s);
  - T1 FAIL ×3 on a **harness bug**. The judge read transcripts truncated at 2000 chars, and the join's context message is longer. The run itself completed with all 8 stages done.
- After the fix, `--only T1` passed: `out/20260924-195802/report.json`, 213 s.
- Outcomes match F_live_tests §1 for these scenarios:
  - T2 skips `C_stageref` and `C_bang_str` (W-31);
  - T3: F failed r2, `S` skipped, the run completed;
  - T7: context mechanics as in F.
- Faux provider (`--provider faux`): all 5 PASS (`out/20260924-192950` + `out/20260924-193303`).
- No server was left on :3111.

**5b. Fresh DB:** pass.
- `BaselineFreshDb.test.ts`:
  - an empty DB reaches v54 through `baseline.sql` and matches `schema.ts` both ways. Declared → physical must match exactly. Physical → declared (extra columns, defaults, indexes, FKs) must match up to an explicit 20-entry allowlist (legacy `copilot_config*` columns, raw-SQL indexes, 5 indexes `schema.ts` declares that no migration creates, 2 defaults);
  - its DDL is identical to the historic path's;
  - two connections opening one empty file apply the baseline once (`BEGIN IMMEDIATE` + re-check);
  - the **real developer schema** at v52 (`fixtures/schema-v52-dev.sql`, a schema-only dump with no user rows) plus synthetic chats upgrades via the legacy path with the rows unchanged, and converges on the fresh schema up to an explicit 8-entry drift allowlist that P01's v55 must empty;
  - a v52 DB built by the migrations converges exactly.
- **Repeatable real-DB check:** `pnpm workflow:dbcopy-upgrade [--db <path>]` (default `C:/gaiwf/dbcopy/generatorai.db`). It copies the DB to a temp dir, runs `migrateDB`, compares counts and sha256 hashes of every `chats` / `sessions` / `chat_messages` row, prints the schema drift, and exits 1 on any change.
- 2026-09-24 result on the dev-DB copy: v52 → v54 via the legacy route in 63 ms. Chat rows are UNCHANGED (hashes match): chats 362; sessions 2323 (chat 392 / stage_run 1931); messages 8178.
- The drift from that run is the same 8 entries as the test allowlist:
  - `chats.selected_artifacts` and `stage_definitions.selected_artifacts` exist only on the upgraded DB;
  - `binding_origin` defaults to `'explicit'` there and `'migrated-ambiguous'` on a fresh DB;
  - the index is named `idx_idempotency_keys_scope_expires` there and `idx_idempotency_keys_expires` fresh;
  - the column order differs in `chats`, `stage_definitions` and `stage_runs`.
- P01's v55 must reconcile these.

**6. `node scripts/check-no-legacy.mjs`:** pass. 0 banned patterns (P00 bans nothing); 64 legacy comments, the recorded baseline.

**Services that read the wall clock directly.** P03 removes these; none accepts a clock today, so the testkit's `VirtualClock` only drives scripted turn delays. Counts are `Date.now()` / `new Date()` call sites.

| Service | `Date.now()` | `new Date()` | Timers |
|---|---|---|---|
| `WorkflowRunService` | 2 | 10 | reconciler `setInterval`, validation backoff `setTimeout` |
| `StageExecutionService` | 5 | 26 | heartbeat `setInterval`, stage timeout, retry backoff |
| `DurableExecutionEngine` | 6 | 0 | awakeable timeout `setTimeout` |
| `DurableSleepService` | 3 | 1 | sweeper |
| `HitlService` | 2 | 0 | |
| `StartupRecoveryService` | 3 | 0 | |
| `SessionAllocator` | 1 (conversation id) | 3 | |
| `AdmissionController` | 3 | 0 | |
| `AutomationService` | 0 | 12 | poll `setInterval` |
| `AutomationRecoveryService` | 2 | 2 | idempotency sweep `setInterval` |
| `DAGScheduler` | 0 | 1 | |
| `WorkflowDefinitionService` | 0 | 2 | |
| `EventBus` | 7 | 0 | |
| db `StageRunRepository` / `WorkflowRunRepository` | 0 / 0 | 2 / 2 | |
| db `RegisterRepository` / `EntryRepository` | 2 / 4 | 0 / 0 | |
| `HookExecutor` | 2 | 0 | hook timeout `setTimeout` |
| `WorkflowPreprocessor` | 6 | 0 | |
| `WorkflowScriptLoader` | 2 | 0 | script-load timeout `setTimeout` |
| `WorkflowOrchestrator` | 0 | 1 | two safety `setTimeout`s (post-processing, completion wait) |

Two timing facts the testkit had to work around, which P03 should keep in mind:
- `stage_runs.heartbeat_at` (and `started_at` / `completed_at`) have **one-second** precision, so any stale window under about 1.5 s reaps healthy stages;
- routing is driven only by the reconciler tick (W-08). The testkit therefore runs a 20 ms tick and a 2 s stale window (200 ms × 10).

**New findings during P00** (recorded against existing register items):
- **W-32 boot-order race.** `StartupRecoveryService.recover()` re-drives interrupted runs (step 2) before it rehydrates `SessionAllocator` (step 4). A relaunched stage that reaches `allocateSession` first fails with `UNIQUE constraint failed: session_allocations.workflow_run_id`. Live, the ~2.5 s checkpoint capture usually hides it. Pinned by T8.
- **W-17 finalize race.** The race is deterministic under the production 3 s tick: two validated root stages that both finish before the first tick. Pinned by T4.

## Phase 01 gate (2026-09-25, after part C)

Run at `wf/overhaul` @ ebb4e82 plus the tracker update (Windows 11, Node 26.8.2, pnpm 10.29.2).

- **`pnpm install --frozen-lockfile`:** pass.
- **`pnpm turbo typecheck`:** pass, 52/52 (forced, 2 min 30 s).
- **`pnpm turbo test --concurrency=2 --continue`:** 9 min 25 s. Every failure is a recorded baseline failure: cli 5 (TUI on Windows), core 1 (symlink EPERM), git 2 (CRLF), server 2 (symlink EPERM, CSP hash). Two baseline failures are gone: core `SourceControlFlowService` (e) (the test now clones with `core.autocrlf=false`) and `workflowPreprocessorClone` (the expectation uses `path.join`). The run also showed two new failures, fixed in 9c61ec6 and re-run: db `migrations lock` (v55 re-locked) and `test:scripts` `workflowCleanupRuns` (its fixture now builds the v54 schema the cleanup runs against); db 134 pass / 4 skip, scripts 28/28.
- **Counts that moved** (P01 deleted or rewrote the tests of removed code): core 1721 pass (was 1862), cli-core 872 (901), client-core 295 (297), mobile 1098 (1099), shared 326 (322), workflow-spec 355 (359; the constants drift test moved to shared), server 539 (554), web 636 (650), workflow-testkit 43 (38), db 134 (136). Everything else is unchanged.
- **`pnpm lint`:** pass (turbo lint 28/28, security, durability, docs, syncio, tokens; workflow-invariants 24 = baseline).
- **`check-no-legacy`:** 78 banned patterns, 0 hits; 11 legacy comments, baseline lowered to 11.
- **`check:migrations-lock`:** 55 locked and unchanged. **`check:db-baseline`:** baseline v55 up to date. **`check:workflow-spec`:** generated files up to date.
- **Testkit (hard gate):** 43/43. T1–T8 run v2 specs on the v1 engine; T6 is PASS (round trip with zero diffs, every malformed import rejected, draft → test run → publish → run, pinned version W-13, revision conflict, command scope, archive on delete).
- **Fresh DB:** `BaselineFreshDb.test.ts` passes. An empty DB reaches v55 through `baseline.sql`; the P00 install-drift allowlist is **empty** (v55 reconciled all 8 entries); the real v52 developer schema plus synthetic chats reaches v55 with chat rows intact and stage-run history purged.
- **`pnpm workflow:dbcopy-upgrade`** (`C:/gaiwf/dbcopy/generatorai.db`, a copy of the developer DB; the real DB was not opened): v52 → v55 via the legacy route in 3.9 s. Chat rows **UNCHANGED** (hashes match): chats 362, chat sessions 392, chat messages 841. All rows before/after: sessions 2323 → 392 (the 1931 stage-run sessions go with the run history), messages 8178 → 841. Schema drift against a fresh DB: **0**. An earlier conversion run on the same copy: 343 definitions converted (47 with `needs_attention` notes), 1113 runs and 1931 stage-run sessions purged, loop/batch automations converted, 3 script-mode automations disabled, 1 plaintext webhook token hashed.
- **Live E2E** (advisory, RV-35): not run in this part.

## Phase 02 gate (2026-09-25)

Run at `wf/overhaul` @ f14cf5a (Windows 11, Node 26.8.2, pnpm 10.29.2).

- **`pnpm install --frozen-lockfile`:** pass.
- **`pnpm turbo typecheck`:** pass, 52/52.
- **`pnpm turbo test --concurrency=2 --continue`:** 9 min 16 s. Failures: cli 5 (TUI on Windows), core 1 (symlink EPERM), git 2 (CRLF), server 3. Two server failures are baseline (symlink EPERM, CSP hash); the third, `automations.test` "mints a one-time signing secret", was new: the test predates PD-18 and created an automation without the now-required permission mode (400). Fixed in f14cf5a; server re-run 540 pass / the 2 baseline failures. Core re-run after the gate fixes: 1757 pass / the baseline failure. The web task's `check-bundle-size` "FAIL" lines are the script's own unit-test fixtures, not the real bundle.
- **Counts that moved:** core 1757 (1721 at P01; composer/session tests added), db 137 (134), web 640 (636), shared 326, workflow-spec 364 (355), agent-harness-providers 704, agent-host 50, client-core 294 (295), server 542 (539), workflow-testkit 43.
- **`pnpm lint`:** pass (turbo lint 28/28; security, durability, docs, syncio, tokens; workflow-invariants 24 = baseline). Three security knownDebt entries (the run bypass defaults P02 deleted) were stale and are removed; the R9 bind-failure status write and the `sendTurn` dispatch carry inline waivers with reasons.
- **`check-no-legacy`:** 90 banned patterns (12 added for P02), 0 hits; 11 legacy comments (baseline 11).
- **`check:migrations-lock`:** 56 locked and unchanged. **`check:db-baseline`:** baseline v56 up to date. **`check:workflow-spec`:** generated files up to date.
- **Testkit (hard gate):** 43/43. T8's W-32 characterisation now pins that the relaunched stage completes: the race is masked by timing in the testkit (the stage composes before allocating), not fixed (DEVIATIONS).
- **Golden snapshots (R-10):** chat snapshots a–e byte-identical apart from the deliberate W-50 fields (systemPromptAppend and maxTurns on create; b gains `mcpServers: {}`); stage snapshots f/g flipped for W-51/W-52 and regenerated.
- **Fresh DB:** `BaselineFreshDb.test.ts` 10/10: an empty DB reaches v56 through `baseline.sql`; the v52 developer schema reaches head with chats intact.
- **`pnpm workflow:dbcopy-upgrade`** (`C:/gaiwf/dbcopy/generatorai.db`; the real DB was not opened): v52 → v56 via the legacy route in 2.7 s. Chat rows **UNCHANGED** (362 chats, 392 chat sessions, 841 messages); drift 0. Found and fixed on the way: with the baseline at 56 a v55 database took the legacy route and failed (`VERSIONED_ONLY_FROM = 55`, DEVIATIONS).
- **W-19 / C7:** covered at composer level (session/composer.test.ts). **Live E2E** (advisory, `P02-perm` and the other P02 scenarios): not run.
- **Acceptance:** no session-config builders outside `services/session/` (the SES and CMS blocks are deleted and banned); chat and stage bound to one agent get the same tools, blocks and MCP servers apart from the documented owner differences (golden + composer tests); a stage widget now carries its stage run id so the run page Widget tab routes it to that stage (unit-tested; not checked in a browser); an automation cannot be saved without a permission mode (schema + route + web form).

## Final review gate (2026-09-26, after merging fix batches B and C)

Run at `wf/overhaul` after the merges 35fb83c (batch B) and 9696be3 (batch C) and the follow-ups aec47e0 (Windows 11, Node 26.8.2, pnpm 10.29.2). Batch A was already on the branch (786994e). TRACKER "Final review" lists every finding.

- **`pnpm install --frozen-lockfile --offline`:** passes. The lockfile changed for batch C's `mcp-server` bundle.
- **Generated files:** `generate:workflow-spec`, `generate:templates` and `generate:workflow-skill` were re-run after the merges. The skill validator bundle conflicted and was regenerated, not hand-merged. The scheduler replay fixtures still replay identically, so they were not regenerated (only ids and timestamps would change).
- **`pnpm turbo typecheck --concurrency=2`:** 51/51.
  - The first run after the merges failed, in core: recovery called batch B's `maps.leaseKeys(runId, stageRunId)` without the `stageRunId`. Fixed in aec47e0.
- **`pnpm lint`:** exit 0. This covers turbo lint and every `check:*`: workflow-spec, templates, workflow-skill, migrations-lock, db-baseline, workflow-invariants and doc-drift.
- **`node scripts/check-no-legacy.mjs`:** 127 banned patterns, 1,986 files scanned, 0 hits. Legacy comments: 0 (baseline 0).
- **Full `pnpm turbo test --concurrency=2 --continue`, run once:** 27 of 33 tasks passed.
  - The six failing tasks, and what happened to each:
    - **`//#test:scripts`**, 2 files: `workflowE2eJudge` and `workflowInvariants` failed with a SyntaxError on import. The imported shebang `.mjs` scripts are checked out with CRLF in this worktree (`core.autocrlf=true`); the blobs are LF. After the working copy was normalized to LF, `pnpm test:scripts` passed alone: 5/5 files, 33 tests. This is environmental and needed no commit.
    - **`@generatorai/workflow-testkit`**, 4 failures in `review-replay` (R1, R8, R9, R10). This was a cross-batch conflict: batch A's tests used the testkit `followUpPrompt` alias, which batch C deleted. c77f651 fixed it, and the package re-ran at 55/55.
    - **`@generatorai/db`**, 1 failure in `BaselineFreshDb` reverse schema: batch B dropped `stage_runs.expansion` from `schema.ts`. c77f651 fixed it, and the package re-ran at 155 pass / 4 skipped.
    - **`@generatorai/server`**, 1 failure: the baseline CSP-hash test (544/545).
    - **`@generatorai/git`**, 2 failures: baseline (`GitClientScm` merge; 56/58).
    - **`@generatorai/cli`**, 5 failures: the baseline TUI tests (`tui-e2e`, `tui-sweep`, 3× `narrowWidths`; 318 pass / 8 skipped).
  - Everything else passed. core: 1,704 pass / 9 skipped, with no Kokoro or voice failure this run.
    - web 638; mobile 1,097; agent-harness-providers 743; cli-core 888; server 544 + 1 baseline; workflow-spec 341; shared 326; client-core 293.
    - design-tokens 239; desktop 193; tui-kit 99; source-control 64; client-transport 59; agent-host 50; auth 46; changes 46.
    - client-runtime 33; review 30; relay 20; checkpoints 19; relay-protocol 18; pty-host 17; secrets 16; cua-host 16; mcp-server 9; sdk 8; browser-host 8.
- **Live sanity** (isolated server on :3111; `E2E_ROOT=C:/gaiwf/e2e-int`, a fresh data dir deleted afterwards):
  - `pnpm workflow:e2e --phase smoke --retries 0`: SMOKE-check **PASS**. Three `node --version` check stages, no LLM.
  - `pnpm workflow:e2e --phase smoke-live --retries 0`: SMOKE-loop **PASS**, on claude-agent with model `haiku`. The run completed in about 20 s:
    1. the agent stage `hello` answered `HELLO`;
    2. loop `twice` ran its check body `tick` twice;
    3. the loop exited `max_iterations`, `accept_last`, `iterations: 2`.
  - The first smoke-live attempt failed on the scenario's own expectation (agent text is judged from `output`, which only non-agent stages fill). The run itself was correct. The expectation was fixed in 216571d.
  - Every server started was stopped, and :3111 was free afterwards.
- **Not run (product owner: minimal testing):** the full live E2E suite (WP-9.1), the `security-review` skill run (WP-9.2), the performance and resource budgets (WP-9.5), the tests the phases deferred, and the model/property tests.

## Phase 07 gate (2026-09-26, after the merge ff6e4b6)

P07 was built on `wf/p07` (worktree `C:/gaiwf/p07`, from 52e5497) in parallel with P06, then merged into `wf/overhaul` (P06 + P08 WP-8.3/8.4) in ff6e4b6. IMPLEMENTATION FIRST: no new tests; no migration (v61 stays reserved). The branch's own gate is in notes/P07-report.md §4; the gate below is the one after the merge, in `C:/gaiwf/repo`.

- **Merge conflicts:** `.github/AGENTS.md` (both doc rows kept), `StagePropertiesPanel.tsx` (lucide imports: P08's `ListTree` kept, `AlertCircle` dropped, P07 no longer uses it), `deriveRunView.ts` (the view cache compares both `plannerName` and `admission`), `WorkflowBuilderPage.tsx` (the agent-draft banner plus the Add-stage menu, version history and issue quick-fixes). Every line either side added survives in the merged files (checked per file).
- **Semantic fixes in the merge:** `RunSupervisor.flowKeysOf` resolved a stage through the pinned graph only, so a planned stage (P08 expansion) was admitted on `global` alone; it now goes through `graphForInstance` and gets its provider key. `runFlows()` counts planned stages in `run:<id>`. `decide()`'s `awaitsSummary` sees a planner behind its `<planner>~x` node (the planner's success edges leave from it), so a successor of a planner with `output.summary: llm` waits for that summary.
- **Generated artefacts:** regenerated, not hand-merged: `pnpm generate:workflow-spec` (JSON Schemas, FIELDS.md, INVOCATION.md), `pnpm generate:templates` (17 templates, `output.summary` now in the P08 `judge-panel` and `plan-then-execute`), `pnpm generate:workflow-skill` (both bundles; schema hash a36f6e71bcb07de2; 27 examples).
- **`pnpm turbo typecheck`:** pass, 51/51.
- **`pnpm lint`:** pass (exit 0) — turbo lint 28/28; security 8/8, durability 5/5, docs, syncio (25), tokens, workflow-invariants (0 direct stage status writes; no-preset-in-engine 0), no-legacy, migrations-lock (60), db-baseline (v60 up to date), workflow-spec, templates, workflow-skill all up to date.
- **`check-no-legacy`:** 122 banned patterns (P06 4 + P07 4 on top of 114), 0 hits; legacy comments 0; `comments.phase` bumped 03b → 07 (deferred by P07 to the merge).
- **Affected package tests** (in this worktree, `pnpm --filter <pkg> test`): workflow-spec 364, db 155 / 4 skipped (`BaselineFreshDb` 10/10 — the CRLF load failure on `wf/p07` does not occur here), core 1681 / 9 skipped, cli-core 887, workflow-testkit 47, web 635, server 536 + the CSP-hash baseline failure, `test:scripts` 28 (5 files; the CRLF load failures on `wf/p07` do not occur here).
- **Found, not changed (for the final review):** nine `banned` patterns in `scripts/no-legacy.json` (P03b, P04, P05, P06 entries) are written `"\bword\b"` with a single JSON backslash, which JSON reads as a backspace character, so they never match. Written as `\\b` they report 7 hits: `followUpPrompt` in the testkit (`adapters/v2.ts`, `types.ts`) and the mobile helper `itemLabel` (`loopModel.ts`, `StageTimeline.tsx`; a false positive of the P05 `itemLabel` ban).
- **Tests deferred to the final pass:** notes/P07-report.md §5.
- **Live E2E / T10** (advisory): not run.

## Phase 08 gate (2026-09-26, WP-8.3 and WP-8.4)

Run at `wf/overhaul` after c090f3e (Windows 11, Node 26, pnpm 10), in parallel with P07 in its own worktree (no shared file edited beyond the scheduler/map files P08 needed). IMPLEMENTATION FIRST: no new tests (P08 has no migration); the per-phase gate is typecheck, lint (the preset lint, `check:templates`, `check:workflow-skill`, `check:workflow-spec`), check-no-legacy and the affected package tests. PD-21 stays deferred: WP-8.1, 8.2 and 8.8 (the script runtime) are not implemented; WP-8.5–8.7 stay backlog.

- **`pnpm turbo typecheck`:** pass, 51/51.
- **`pnpm lint`:** pass (exit 0) — turbo lint (0 errors; warnings unchanged in kind); security, durability, docs, syncio, tokens, workflow-invariants (0 direct stage status writes; **no-preset-in-engine: 0**), no-legacy, migrations-lock (60, unchanged), db-baseline (v60 up to date), workflow-spec (JSON Schemas, FIELDS.md, INVOCATION.md regenerated), **check:templates** (17 templates generated from the presets: + `judge-panel`, `plan-then-execute`), **check:workflow-skill** (both bundles up to date; schema hash 137c7c58ad747119; 27 examples; SKILL.md 158 lines, ~2.9k tokens).
- **`check-no-legacy`:** 118 banned patterns, 0 hits; legacy comments 0.
- **Affected package tests** (`pnpm turbo test --concurrency=2 --continue` on workflow-spec, core, db, shared, cli-core, server, workflow-testkit, web; then sdk, client-core, mcp-server, cli): workflow-spec 364 (the builders field-coverage test updated for `expands`), core 1681 / 9 skipped, db 155 / 4 skipped (`BaselineFreshDb` included; no migration), shared 326, cli-core 887, workflow-testkit 47, web 635 (the `check-bundle-size` "FAIL" lines in the log are the script's own fixtures), server 536 + the CSP-hash baseline failure, sdk 8, client-core 293, mcp-server 8, cli 318 + the 5 baseline TUI failures, scripts 28.
- **Manual engine checks** (throwaway scheduler-harness tests, deleted): the judge panel merges the judge's pick before the judge's successor starts, and a failed winner merge finalizes the run failed (`map_winner_failed`); a plan of three stages with an order edge runs after the planner and before the report, a cyclic plan fails the expansion node (`expansion_invalid`) and skips the report, `join: all` fails and `tolerate` completes on a failed planned stage.
- **Tests deferred to the final pass** (PHASE-08 "Tests", ungated rows): judge panel picks and merges the winner; the stored plan is replayed after a crash (the LLM is not re-asked); plus the clamp (allow-lists, maxStages, cycles, key collisions) and the UI rendering. The script-runtime, run-diff, pinned-data and cache tests belong to gated/backlog WPs.
- **Live E2E** (advisory): not run.

## Phase 06 gate (2026-09-26)

Run at `wf/overhaul` after 4d7869c + ba3759a (Windows 11, Node 26, pnpm 10). IMPLEMENTATION FIRST: one new test (the v60 chat-safety test); the per-phase gate is typecheck, lint (`generate:workflow-spec --check` and the new `check:workflow-skill` included), check-no-legacy, the affected package tests and the fresh-DB check.

- **`pnpm turbo typecheck`:** pass, 51/51.
- **`pnpm lint`:** pass (exit 0) — turbo lint 28/28 (0 errors; warnings unchanged in kind); security 8/8, durability 5/5, docs, syncio (25, no growth), tokens, workflow-invariants (0 direct stage status writes; no-preset-in-engine 0), no-legacy, migrations-lock (60), db-baseline (v60 up to date), workflow-spec (JSON Schemas, FIELDS.md, INVOCATION.md regenerated for the tool groups and the orchestrator trigger's `toolCallId`), templates, **check:workflow-skill** (both bundles up to date; schema hash ffff579e1a770fb4; 25 examples; SKILL.md 158 lines, ~2.9k tokens).
- **`check-no-legacy`:** 118 banned patterns (+4 for P06: `HUMAN_PRINCIPALS`, the G4 draft tool names `dry_run_workflow`/`author_workflow`, MCP prompt handlers, `import-json`), 0 hits; legacy comments 0.
- **Affected package tests** (`pnpm turbo test --concurrency=2 --continue` on core, db, server, shared, workflow-spec, client-core, cli-core, cli, mcp-server, agent-harness-providers, auth, agent-host, workflow-testkit, sdk + root scripts): core 1681 / 9 skipped, db 155 / 4 skipped (+ `migration60`), server 536 + the CSP-hash baseline failure, shared 326, workflow-spec 364, client-core 293, cli-core 887, cli 318 + the 5 baseline TUI failures, mcp-server 8 (rewritten to the new tool/resource shape), agent-harness-providers 741, auth 45, agent-host 50, workflow-testkit 47, sdk 8, scripts 28; web 635 and mobile 1097 (run with the UI commits). Updated for the new shapes: the definition route test and mock container (authoring service), the agent-host binder contract (the two groups), the CLI registry group count, CLI docs and surface snapshot. Golden session snapshots: byte-identical (no workflow tools for existing configurations; DEVIATIONS on the orchestrator golden).
- **Fresh DB:** `BaselineFreshDb` passes (an empty DB reaches v60 through the regenerated baseline and matches `schema.ts`); `migration60` passes; `pnpm workflow:dbcopy-upgrade` on `C:/gaiwf/dbcopy`: v52 → v60 via legacy in 4.4 s, chats 362 / chat sessions 392 / messages 841, chat rows UNCHANGED (hashes match), schema drift 0.
- **Live checks** (advisory, isolated server): the MCP server on :3117 paired as an `mcp` device — capabilities `{tools, resources}`, 12 tools, 36 resources, list/validate/create-draft round trip, `authoredBy.clientName` recorded, `prompts/list` refused, publish 403 for the MCP device. Skill evals with Claude Code headless (Haiku, Sonnet, Opus): tasks 01–02 pass on Sonnet/Opus, Haiku after skill fixes (`skills/generatorai-workflow-author/evals/RESULTS.md`).
- **Tests deferred to the final pass** (PHASE-06 "Tests to add"): tool handler unit tests (ceiling, depth/recursion, maxChildRuns, per-chat concurrency, idempotent replay, lineage visibility, approval delegation, draft refusal, write:workflows), prompt-cache goldens with the tools appended, bridge (mapping, throttle, nudge guard, cards after reload), orchestrator (workers, Copilot clamp), skill (`validate.mjs` vs the server on a corpus + 50 fast-check graphs, skills-ref), MCP remote round trip with a human publish, the E2E set, and the skill evals' "plan before draft" measure and task 03.
- **Live E2E** (advisory): not run.

## Phase 05B gate (2026-09-26)

Run at `wf/overhaul` after dcd3b60 (Windows 11, Node 26, pnpm 10). IMPLEMENTATION FIRST: no new tests (5B has no migration); the per-phase gate is typecheck, lint (the preset lint, `generate:workflow-spec --check` and `check:templates` included), check-no-legacy, the affected package tests, the fresh-DB check and the web bundle budget.

- **`pnpm turbo typecheck`:** pass, 51/51.
- **`pnpm lint`:** pass (exit 0) — turbo lint 28/28 (0 errors); security 8/8, durability 5/5, docs, syncio (25, no growth: the callback key's boot-only reads carry waivers), tokens, workflow-invariants (0 direct stage status writes; **no-preset-in-engine: 0**), no-legacy, migrations-lock (59, unchanged), db-baseline (v59 up to date), workflow-spec (JSON Schemas, FIELDS.md, INVOCATION.md regenerated), **check:templates** (15 templates generated from the presets).
- **`check-no-legacy`:** 114 banned patterns (+2 for 5B: the future-kind placeholder; the G5 draft shapes `budgetShare`, `itemLabel`, `results_and_failures`, `child_run_settled`), 0 hits; legacy comments 0.
- **Affected package tests:** core 1681 / 9 skipped, db 154 / 4 skipped, workflow-testkit 47, workflow-spec 364, server 536 + the CSP-hash baseline failure, shared 326, auth 45, sdk 8, client-core 293, git 56 + the 2 baseline failures (merge/CRLF), web 635 (the `check-bundle-size` "FAIL" lines in the test log are the script's own fixtures); from the client commit: cli-core 879, cli 325 + the 5 baseline TUI failures, tui-kit 99, mobile 1097. Updated for the new shapes: the server route test (decisions through the approval service, the actor argument) and its mock container, the spec's unknown-kind hint test.
- **Web bundle:** `pnpm --filter @generatorai/web build` + `check:bundle`: initial load 309.1 KB gzip (budget 800 KB); `lazy-codemirror` 104.7 KB gzip (budget 250 KB); largest lazy chunk 224.9 KB (per-chunk 300 KB): OK.
- **Fresh DB:** no migration in 5B; `BaselineFreshDb` passes in the db suite (v59).
- **Manual engine checks** (throwaway testkit scripts, deleted): a shared map with a per-item select feeding a report; approval wait (form rejected on bad data, `by`), an event delivered before its wait armed (then replay 200 / other data 409), a timer; a sub-workflow (inherit) whose child approval is mirrored and answered through the parent, its outputs routing an edge; a map inside a loop; mount_per_item with itemSetup and sequential merges (both items merged into the run mount; a conflicting item failing the map at 0 % tolerance with the other merged and its mount kept); forks from `mig#1/per#b/edit` (one item, carry(0) seeded) and `mig#1/plan`.
- **Tests deferred to the final pass** (PHASE-05 "Tests"): every Map, Sub-workflow and Wait test, the fork-from-inside tests, the example extraction for the 5B examples, the property tests extended with maps, and the Playwright UI tests (expression-editor autocomplete included).
- **Live E2E** (advisory): not run (pr_per_item needs a remote and a provider).

## Phase 05A gate (2026-09-26)

Run at `wf/overhaul` @ 4d6ba7e (Windows 11, Node 26, pnpm 10). IMPLEMENTATION FIRST: one new test (the v59 chat-safety test); the per-phase gate is typecheck, lint, check-no-legacy, the affected package tests and the fresh-DB check.

- **`pnpm turbo typecheck`:** pass, 51/51 (one earlier run hit the known transient: `agent-host` read `@generatorai/workflow-spec` while it rebuilt; re-run clean).
- **`pnpm lint`:** pass (exit 0) — turbo lint 0 errors (warnings unchanged in kind); security, durability (the judge dispatch carries its waiver), docs, syncio, tokens, workflow-invariants (FAIL mode: 0 direct stage status writes; **no-preset-in-engine: 0**), no-legacy, migrations-lock (59), db-baseline (v59), workflow-spec (JSON Schemas, FIELDS.md, INVOCATION.md regenerated), **check:templates** (6 templates generated from the presets).
- **`check-no-legacy`:** 112 banned patterns (+2 for P05; two earlier bans narrowed, DEVIATIONS), 0 hits; legacy comments 0.
- **Affected package tests:** workflow-spec 364, core 1681 / 9 skipped, db 154 / 4 skipped (+ `migration59`), workflow-testkit 47, server 536 + the CSP-hash baseline failure, client-core 293, cli-core 877, cli 318 + the 5 baseline TUI failures (narrowWidths ×3, tui-e2e, tui-sweep), tui-kit 99, web 635 (the `check-bundle-size` "FAIL" lines are the script's own fixtures), mobile 1097, shared 326, auth 45, sdk 8, checkpoints 19.
- **Fresh DB:** `BaselineFreshDb` passes (an empty DB reaches v59 through the regenerated baseline and matches `schema.ts`); `migration59` passes; `pnpm workflow:dbcopy-upgrade` on `C:/gaiwf/dbcopy`: v52 → v59 via legacy in 3.1 s, chats 362 / chat sessions 392 / messages 841, chat rows UNCHANGED (hashes match), 343 definitions, schema drift 0.
- **Manual engine checks** (throwaway testkit scripts, deleted): L1 fix/review approves on round 3 with the continuing fix conversation and the follow-up prompt rendering `loop.carry.openComments | bullets`; a loop parked at its cap → `grant_iterations` → parked again → `continue_with_input` (operator turn first) → `accept`; L5 accumulation (`diff`/`unique`/`concat` carry, dry ×2) with a `check` (`node --version`) in the body; a judge rule scoring 4 then 9 (one repair). The Windows launch of `pnpm --version`, `pnpm exec vitest --version`, `tsc -v` through `SandboxedScriptRunner`.
- **Tests deferred to the final pass** (PHASE-05 "Tests"): every loop, check, judge, example-extraction, preset/lint, property and Playwright test listed there; the Windows CI launch test.
- **Live E2E** (advisory): not run.

## Phase 04 gate (2026-09-26)

Run at `wf/overhaul` after 6fd9adc (WP-4.1–4.5) and a09e3d1 (WP-4.6) (Windows 11, Node 26, pnpm 10). IMPLEMENTATION FIRST: one new test (the v58 chat-safety test); the per-phase gate is typecheck, lint, check-no-legacy, the affected package tests and the fresh-DB check.

- **`pnpm install --frozen-lockfile`:** pass (the lockfile changed with the MCP server's dependencies: client-core, client-runtime, secrets instead of core + sdk).
- **`pnpm turbo typecheck`:** pass, 51/51 (one task fewer: the MCP server no longer builds on the SDK).
- **Affected package tests** (`pnpm turbo test --concurrency=2 --continue` on core, db, server, client-core, sdk, workflow-testkit, mcp-server, shared, workflow-spec, auth, client-runtime, git, cli-core, cli, tui-kit; web and mobile run separately): core 1681 pass / 9 skipped, db 153 / 4 skipped (+1 `migration58`), server 536 + the CSP-hash baseline failure (the symlink EPERM baseline did not fire), client-core 293, sdk 8, workflow-testkit 46 + T8 crash (flaked under the parallel load; 4/4 alone), mcp-server 7, shared 326, workflow-spec 364, auth 45, client-runtime 33, git 56 + the 2 baseline failures (merge/CRLF), cli-core 873, cli 318 + the 5 baseline failures (TUI on Windows), tui-kit 99, web 635, mobile 1097. Tests of deleted code were deleted (`WorkflowOrchestrator.*`, `orchestrator-uploads`, the MCP tool adapter, `workflowStart`); tests over changed shapes were updated (decide terminal events + `workflow_run.finalized`, replay fixtures regenerated with `UPDATE_FIXTURES=1`, RunStore outbox, idempotency repository, automation trigger/scheduler/resume, IterationPlanner, permission layers, goldens (byte-identical), preprocessor → `LifecycleSteps`, route/e2e, SDK smoke, client-core wire contracts, auth route policy).
- **`pnpm lint`:** pass — turbo lint 0 errors; security, durability, docs, syncio, tokens, workflow-invariants (FAIL mode, 0), no-legacy, migrations-lock (58), db-baseline (v58), workflow-spec (JSON Schemas, FIELDS.md and the new INVOCATION.md).
- **`check-no-legacy`:** 110 banned patterns (+9 for P04), 0 hits; legacy comments 0.
- **Fresh DB:** `BaselineFreshDb` passes (an empty DB reaches v58 through the regenerated baseline and matches `schema.ts`); `pnpm workflow:dbcopy-upgrade` on `C:/gaiwf/dbcopy`: v52 → v58 via legacy in 3.7 s, chats 362 / chat sessions 392 / messages 841, chat rows UNCHANGED (hashes match), schema drift 0.
- **Tests deferred to the final pass** (PHASE-04 "Tests to add"): one per entry point asserting the same plan and the same finalize behaviour (commit + PR with a mocked SCM) — the C-1 regression; hooks once per phase; idempotency (replay, 409 on another body, derived keys); security (`__*` in variables / stage overrides / datasets, the ceiling, bypass off loopback, drafts); lifecycle (crash during `worktrees` resumes there, prepare failure → `setup:<phase>`, cancel during finalizing, worktrees never deleted); `waitFor` (event between subscribe and read, stopOnApproval); the E2E set.
- **Live E2E** (advisory): not run; `scripts/workflow-e2e` now starts runs through the invocation, but still builds definitions with the pre-P01 nested routes.

## Phase 03b gate (2026-09-26)

Run at `wf/overhaul` @ f55692b (Windows 11, Node 26, pnpm 10). IMPLEMENTATION FIRST (product owner, 2026-09-26): no new tests; the per-phase gate is typecheck, lint, check-no-legacy and the affected package tests.

- **`pnpm turbo typecheck`:** pass, 52/52 (one earlier run hit a transient `changes` error while `workflow-spec` was rebuilding concurrently; re-run clean).
- **Affected package tests** (`pnpm turbo test --concurrency=2 --continue` on core, db, workflow-testkit, client-core, shared, server, web, sdk, workflow-spec, auth; mobile, cli, cli-core, tui-kit run with WP-3b.4): core 1687 pass / 9 skipped, db 152, workflow-testkit 47, client-core 297, shared 326, workflow-spec 364, auth 45, sdk 8, web 635 (the store's clock tests were removed with the clock), server 543 + the 2 baseline failures (symlink EPERM, CSP hash), mobile 1098, cli-core 873, tui-kit 99, cli 318 + the 5 baseline failures (TUI on Windows). The scheduler replay fixtures were regenerated (`UPDATE_FIXTURES=1`) because `stage_run.*` events now carry `stageKey`, `instancePath` and `version`. The web task's `check-bundle-size` "FAIL" lines are the script's own fixtures.
- **`pnpm lint`:** pass (exit 0) — turbo lint 0 errors, security, durability, docs, syncio, tokens, workflow-invariants (FAIL mode, 0 direct stage status writes; `IStageRunCas.amend` lives in `engineCas.ts`), no-legacy, migrations-lock (57), db-baseline (v57), workflow-spec (run-command schema + FIELDS.md regenerated for the retry's `promptOverride`).
- **`check-no-legacy`:** 100 banned patterns (+1 for P03b: `followUpPrompt`, `STAGE_NOT_AWAITING_REVIEW`, "HITL panel"), 0 hits; legacy comments 0 (baseline lowered 5 → 0, phase 03b).
- **Fresh DB:** no migration in P03b (baseline v57 unchanged).
- **Tests deferred to the final pass** (PHASE-03b "Tests"): server (send while running → 409; send to completed → amend, successors untouched, `stage_run.amended`; send between turns queued; turn cancel; attachments persisted and served; each gate type; review batch delivered only on success), web Playwright (composer, Stop, permission/question cards, "…" menu, permission control, error toast on a forced 409), store tests for D-19/D-20/D-21/D-21b.
- **Live E2E** (advisory): not run (the P03 note stands: `scripts/workflow-e2e` needs a port to the v2 document API).

## Phase 03 gate (2026-09-26, after part 3: the cutover)

Run at `wf/overhaul` @ 5dad4e7 (Windows 11, Node 26.8.2, pnpm 10.29.2). Part 3 commits: 5dad4e7 (WP-3.7 + WP-3.8), 48cc4ec (WP-3.9, tracker).

- **`pnpm turbo typecheck`:** pass, 52/52.
- **`pnpm turbo test --concurrency=2 --continue`:** failures = the recorded baseline only — cli 5 (TUI on Windows), git 2 (CRLF / merge), server 2 (symlink EPERM, CSP hash). The core symlink EPERM baseline is gone with `StageExecutionService.test.ts`. Two new failures in that run were fixed and re-run: `test:scripts` `workflowInvariants` (an apostrophe inside a template literal of `check-workflow-invariants.mjs` tripped vite's import lexer; 28/28 after the fix) and testkit T4 (nine runs finalizing at once exceeded 15 s under the suite's load; the wait is now 60 s) plus a same-millisecond flake in T5's "nothing sent after the pause" (`<` → `<=`); testkit re-run 47/47.
- **Counts that moved** (P03 deleted the v1 engine's tests): core 1687 pass / 9 skipped (1880 at part 2; −15 v1 test files, + decide `frame_lost` and skip-override cases), db 152 (156; `StageRunResumeFromInterrupt` deleted), server 545 (543 + the 2 baseline failures; commands/fork route tests replace the per-action ones), workflow-testkit 47 (64 at part 2: the 45 v1 characterisation tests are replaced by the engine suite — T1–T8, output contract, replay fixtures, fork — 47 tests), client-core 297, cli-core 869, web 639, mobile 1098, workflow-spec 364, agent-harness-providers 741, shared 326, sdk 8.
- **`pnpm lint`:** pass — turbo lint 28/28 (0 errors), security 8/8, durability 5/5 (HAZ-1 now checks `engine/*.ts`: a dispatch must be inside the journalled `StageExecutor.turn()`; retention now requires `turns.release`), docs, syncio, tokens, **workflow-invariants in FAIL mode: 0 direct stage status writes** (BASELINE 0), no-legacy, migrations-lock (57), db-baseline (v57), workflow-spec (FIELDS.md regenerated).
- **`check-no-legacy`:** 99 banned patterns (+9 for P03), 0 hits; legacy comments 5 (baseline lowered 11 → 5, phase 03).
- **Fresh DB:** no migration in P03 part 3; `BaselineFreshDb` passes in the db suite (an empty DB reaches v57 through `baseline.sql`).
- **Acceptance:** `grep -rn "DAGScheduler\|processedStageRuns\|retryInSession\|retryStageAfterValidation\|SessionAllocator\|StartupRecoveryService" packages apps` finds nothing outside migrations (and `dist`/`node_modules`); no workflow service subscribes to the global bus except the two RV-5 listeners P04 deletes (`WorkflowOrchestrator` post-processing, `AutomationService.waitForRunCompletion`); no `KNOWN-BUG` marker remains in the testkit.
- **Golden snapshots (R-10):** a–h unchanged; the stage snapshots f/g are now produced by the engine's `StageExecutor` and are byte-identical.
- **Testkit (hard gate):** T1, T2, T3, T4 (+T4b slow repair), T5, T6, T7, T8 (+ a tool permission lost to a crash), output contract, replay fixtures, fork: 47/47. T10 (25 stages) and the hop-latency p95 assertion are not written (DEVIATIONS / handoff).
- **Live E2E** (advisory): not run. `scripts/workflow-e2e` still builds definitions through the nested `/workflow-definitions/:id/stages|edges` routes P01 deleted, so it needs a port to the v2 document API first (not cheap; left for P03b/P04).

## Phase 03 part 1 gate (2026-09-25: Milestone 3A + WP-3.3/3.4)

Run at `wf/overhaul` @ 527f41c plus the HarnessError barrel fix (Windows 11, Node 26.8.2, pnpm 10.29.2). Commits: dd00852 (WP-3.2), 7d4ecb4 (WP-3.4), 5d7b3e9 (WP-3.3), 527f41c (WP-3.1).

- **`pnpm turbo typecheck`:** pass, 52/52.
- **`pnpm turbo test --concurrency=2 --continue`** (v57 recreated the v1 run tables, so the full suite ran): 9 min 2 s. Failures: the recorded baseline only — cli 5 (TUI on Windows), core 1 (symlink EPERM), git 2 (CRLF), server 2 (symlink EPERM, CSP hash) — plus one new failure, agent-harness-providers `W41-lazy-loading` (the providers barrel loaded `@generatorai/core` at runtime through the new `errors.ts`); fixed (type-only import) and re-run: agent-harness-providers 741/741. The web task's `check-bundle-size` "FAIL" lines are the script's own fixtures.
- **Counts that moved:** core 1862 pass (1757 at P02; + scheduler 78, errors 23), db 151 (137; + migration57 2, RunStore 12), agent-harness-providers 741 (704; + harness error fixtures 37), workflow-testkit 45, server 541. Everything else unchanged.
- **`pnpm lint`:** pass (turbo lint; security, durability, docs, syncio, tokens; workflow-invariants 24 = baseline, with the CAS implementation `engineCas.ts`/`RunStore.ts` allowed beside `StageRunRepository.ts`).
- **`check-no-legacy`:** 90 banned patterns, 0 hits (the P01 `leaseOwner` ban dropped: v57 brings `lease_owner` back as the v2 executor lease); 11 legacy comments (baseline 11).
- **`check:migrations-lock`:** 57 locked. **`check:db-baseline`:** baseline v57 up to date. **`check:workflow-spec`:** up to date.
- **Fresh DB:** `BaselineFreshDb.test.ts` passes (an empty DB reaches v57 through `baseline.sql`, matches `schema.ts` both ways with the existing allowlist, historic path identical); `migration57.test.ts` also migrates a fresh DB and checks the CHECKs.
- **`pnpm workflow:dbcopy-upgrade`** (`C:/gaiwf/dbcopy/generatorai.db`; the real DB was not opened): v52 → v57 via the legacy route in 7.3 s. Chat rows **UNCHANGED** (362 chats, 392 chat sessions, 841 messages); sessions 2323 → 392 and messages 8178 → 841 (stage history purged); 343 definitions, 19 invalid, all with notes; drift 0.
- **Testkit (hard gate):** 45/45 on the v1 engine over the v57 tables.
- **Not in part 1 (by the plan):** WP-3.5+ (executor, actor, supervisor, commands API, cutover), `ENGINE_LEVEL` stays `v1`. Model-based and replay tests deferred (DEVIATIONS). Live E2E not run (advisory).

## Phase 03 part 2 gate (2026-09-25: WP-3.5/3.6, additive)

Run at `wf/overhaul` @ 08c1206 (Windows 11, Node 26.8.2, pnpm 10.29.2). Commits: 9732b79 (WP-3.5), 08c1206 (WP-3.6).

- **`pnpm turbo typecheck`:** pass, 52/52.
- **Affected package tests** (the speed rule: no full-monorepo run for this part): core 1880 pass / 1 fail (the recorded symlink EPERM baseline) / 9 skipped; db 156 (+ `EngineStores` 5); agent-harness-providers 741/741; workflow-testkit 64/64 (45 v1 characterisation + 19 v2).
- **Lint:** turbo lint for core, db, shared, agent-harness-providers, workflow-testkit (0 errors; no warnings in the new files); `check:security`, `check:durability` (5 hold), `check:docs`, `check:syncio` (25, no growth), `check:workflow-invariants` (24 = baseline), `check:migrations-lock` (57), `check:db-baseline` (v57) and `check:workflow-spec` all pass.
- **`check-no-legacy`:** 90 banned patterns, 0 hits; 11 legacy comments (baseline 11).
- **Fresh DB:** no migration in part 2; `BaselineFreshDb` passes in the db suite.
- **Testkit (hard gate) on v2:** T1 fan-out/fan-in, T3 failure edges + retry + precedence, T5 approve/reject/changes/pause/cancel, T8 crash/restart (+ a second engine refused), output-contract repair/restart/rules, replay fixtures: all green. The v1 characterisation suite is untouched (it flips at the cutover).
- **Not in part 2 (by the brief):** `ENGINE_LEVEL` stays `v1`; nothing in the server runs v2; the commands route, fork, deletions and the invariant flip are WP-3.7–3.9. Live E2E not run (advisory).

## Migration versions (authoritative, RV-17)

Reserve these numbers; do not reuse them.

| Version | Name | Phase | Contents |
|---|---|---|---|
| 55 | workflow_definitions_v2 | P01 | legacy drops; definitions → v2 documents; versions table; run history purge (explicit deletes); automation legacy-mode conversion; `sessions` v1 column drops; FK fix; baseline → 55 |
| 56 | session_parity | P02 | `chat_messages.complete`; `automations.permission_mode` |
| 57 | workflow_engine_v2 | P03 | run tables recreated (G5 §6.2, incl. `stage_runs.loop_state`, `scope_id`, `iteration_index`, `item_index`, + invocation and ownership columns); `stage_attempts` (+ `agent_snapshot`, `judge`, `structured_output`), `run_sessions`, timers, outbox, journal, `engine_lock`; `chat_messages.turn_role`; `stage_runs.amended_at` |
| 58 | invocation | P04 | `idempotency_keys.request_hash`; `invocation_uploads`; `auth_devices` rebuilt with the `mcp` platform (applied 6fd9adc; run mounts need no column: a run's workspace owns them) |
| 59 | control_flow | P05 | `loop_iterations`; `stage_runs.item_key`; `workflow_run_events` (id, idempotency key, consumed_by); `stage_definitions.parent_key`, `kind` + index (applied 0eb53ad; `item_key` was not in v57) |
| 60 | agent_integration | P06 | `chat_workflow_runs`; `chats.created_by_principal`; definitions `authored_by` (applied 21393c6) |
| 61 | reserved | P07 | only if needed (none planned) |
| 62 | dynamic_calls | P08 | only if PD-21 = yes |
