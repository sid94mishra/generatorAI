# Overhaul status

The coding agent updates this file in every phase PR.

| Phase | Branch | Status | PR | Gate report | Notes |
|---|---|---|---|---|---|
| 00 Baseline | wf/phase-00-baseline | not started | | | |
| 01 Spec, legacy, definitions | wf/phase-01-spec-definitions | not started | | | |
| 02 SessionComposer | wf/phase-02-session-composer | not started | | | |
| 03 Engine v2 | wf/phase-03-engine-v2 | not started | | | |
| 03b Stage conversation | wf/phase-03b-stage-conversation | not started | | | |
| 04 Lifecycle and invocation | wf/phase-04-invocation | not started | | | |
| 05 Control flow (5A, 5B) | wf/phase-05-control-flow | not started | | | |
| 06 Agents and skill | wf/phase-06-agents-skill | not started | | | |
| 07 Economy and UX | wf/phase-07-economy-ux | not started | | | |
| 08 Dynamic workflows | wf/phase-08-dynamic | gated (PD-21) | | | |
| 09 Release gate | wf/phase-09-release | not started | | | |

## Phase 00 checklist

| WP | Item | Done |
|---|---|---|
| 0.1 | Backup + definition export script works on a DB copy | [x] |
| 0.2 | Testkit package + characterisation tests (KNOWN-BUG markers) | [ ] |
| 0.3 | `pnpm workflow:e2e` end to end on :3111 | [ ] |
| 0.4 | Dependencies + generator scaffold | [ ] |
| 0.5 | Golden session snapshots committed | [ ] |
| 0.6 | Invariant scripts wired (report-only) | [ ] |
| 0.6b | Migration lock + lint, fresh-DB baseline + tests | [ ] |
| 0.8 | Run cleanup script exercised on a DB copy | [ ] |
| 0.7 | Baseline recorded below | [ ] |

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
- typecheck:
- tests per package (pass/fail/skip):
- known failures:
- live E2E report:
- services reading `Date.now()` directly (for P03):

## Migration versions (authoritative, RV-17)

Reserve these numbers; do not reuse them.

| Version | Name | Phase | Contents |
|---|---|---|---|
| 55 | workflow_definitions_v2 | P01 | legacy drops; definitions → v2 documents; versions table; run history purge (explicit deletes); automation legacy-mode conversion; `sessions` v1 column drops; FK fix; baseline → 55 |
| 56 | session_parity | P02 | `chat_messages.complete`; `automations.permission_mode` |
| 57 | workflow_engine_v2 | P03 | run tables recreated (G5 §6.2, incl. `stage_runs.loop_state`, `scope_id`, `iteration_index`, `item_index`, + invocation and ownership columns); `stage_attempts` (+ `agent_snapshot`, `judge`, `structured_output`), `run_sessions`, timers, outbox, journal, `engine_lock`; `chat_messages.turn_role`; `stage_runs.amended_at` |
| 58 | invocation | P04 | `idempotency_keys.request_hash`; `invocation_uploads`; `mcp` device platform; run mount ownership |
| 59 | control_flow | P05 | `loop_iterations`; `stage_runs.item_key`; `workflow_run_events` (id, idempotency key, consumed_by); `stage_definitions.parent_key`, `kind` + index |
| 60 | agent_integration | P06 | `chat_workflow_runs`; `chats.created_by_principal`; definitions `authored_by` |
| 61 | reserved | P07 | only if needed (none planned) |
| 62 | dynamic_calls | P08 | only if PD-21 = yes |
