# Implementation tracker

This file tracks the implementation of every work package (WP) in the overhaul plan. It is the task-level companion to `STATUS.md`, which holds the phase and migration tables.

**Working copy:** git worktree `C:/gaiwf/repo`, branch `wf/overhaul`, created from `desktop_redesign` @ `a83a7bf`. It is local only and never pushed.

**Loop per phase:**
1. Implement every WP, with one commit per WP.
2. Run the §7 gate.
3. An independent review agent audits the phase against its plan file.
4. Fix the findings, then re-gate.
5. Mark the phase **done** here and in `STATUS.md`.

**Legend:**
- `todo`: not started.
- `wip`: in progress.
- `done`: implemented, with tests passing.
- `reviewed`: the independent review passed and its findings are fixed.
- `deferred`: deferred by a plan decision. The reason is given in the notes.
- `n/a`: not applicable.

## Phase summary

| Phase | Title | Impl | Review | Gate | Commits | Notes |
|---|---|---|---|---|---|---|
| 00 | Baseline and safety net | done | todo | pass | cbb9fb6..d772ee3 | Gate passes with the baseline exceptions recorded in STATUS.md. Deviations in DEVIATIONS.md (7 P00 rows). |
| 01 | Spec v2, legacy purge, definitions | todo | todo | todo | | |
| 02 | SessionComposer | todo | todo | todo | | |
| 03 | Engine v2 | todo | todo | todo | | |
| 03b | Stage conversation and run page | todo | todo | todo | | |
| 04 | Lifecycle and invocation | todo | todo | todo | | |
| 05 | Control flow (5A + 5B) | todo | todo | todo | | |
| 06 | Agent integration and skill | todo | todo | todo | | |
| 07 | Economy, observability, UX | todo | todo | todo | | |
| 08 | Dynamic workflows | todo | todo | todo | | PD-21 default is **deferred**. WP-8.3 and WP-8.4 ship. WP-8.1, 8.2 and 8.8 are gated. WP-8.5–8.7 are backlog. |
| 09 | Release gate | todo | todo | todo | | |

## Phase 00: Baseline and safety net

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 0.1 | Branch, backup script, definition export | done | | cbb9fb6, b176da5 | No new branch (single `wf/overhaul` branch, see DEVIATIONS). `scripts/workflow-backup.mjs` (`pnpm workflow:backup`, `--db` / `--out-root` / `--port`): refuses while :3100 listens, copies db/-wal/-shm, exports definitions + stages + edges from the COPY, prints counts. Run on a copy of the dev DB: 343 definitions exported = `COUNT(*)`. 2 unit tests. |
| 0.2 | `@generatorai/workflow-testkit` + characterisation tests T1–T8 | done | | 1d54024 | Reuses `createCoreServices` + the Drizzle repos over an in-memory `migrateDB`. ScriptedFauxHarness: per-stage `Turn[]` (text, toolCalls, usage, error, delayMs, hang, on). Helpers: runWorkflow, snapshotRun, killAndRestart, route-equivalent commands. VirtualClock drives scripted delays only; no service accepts a clock (list in STATUS). Not wired: WorkspaceManager / worktrees / checkpoints, AdmissionController, browser and agent services, the StreamBroker event store. 30 characterisation tests with `KNOWN-BUG W-xx` markers + 8 unit/smoke tests; 38 pass in ~20 s. New finding: `recover()` re-drives runs before it rehydrates the allocator (W-32 race). |
| 0.3 | Isolated live E2E harness (`scripts/workflow-e2e/`) | done | | 577c19e | server.mjs (start/stop/status; kills only its own PID tree), run.mjs, scenario.mts, pair.mts, lib/client.mts, lib/db.mjs, scenarios.json (phase 00: T1, T2, T3, T7, T10-small), specs. Live claude-agent (haiku): all 5 PASS. T1 first failed on a harness bug (transcripts truncated at 2000 chars); the one-line fix landed in a61ebbe by mistake. Faux path (`GENERATORAI_LOAD_TEST_FAUX_HARNESS`): all 5 PASS. No stray server left. |
| 0.4 | Dependencies and generators scaffold | done | | 59a8de5 | fast-check (core, testkit); ajv ^8.20 + ajv-formats ^3 (core); zod-to-json-schema 3.25.2 (root, pinned to zod 3); `scripts/generate-workflow-spec.ts --check` no-op + `pnpm generate:workflow-spec`. |
| 0.5 | Golden session-composition snapshots | done | | cf9e8c9, 3a2b94a | `packages/core/__tests__/session-golden/composeGolden.test.ts`: 7 file snapshots (a–g), LF-pinned. Drifts asserted as KNOWN-DRIFT: W-50 (systemPromptAppend / maxTurns reach the provider only on resume), W-51 (replace wipes the author's message; stage instructions land before the browser block), W-52 (team restrictions dropped). |
| 0.6 | Lint invariants (report-only) + `check-no-legacy` | done | | 468dbb2 | `check:workflow-invariants` (report-only; baseline 21 direct stage-status writes) and `check:no-legacy` (+ `scripts/no-legacy.json`, empty), both in `pnpm lint`. 4 unit tests. |
| 0.6b | Migration lock + fresh-DB baseline | done | | a61ebbe | Head verified: v54 = BASELINE_VERSION. `migrations.lock.json` (54 entries, CRLF-normalised) + `check:migrations-lock` in lint. `pnpm db:baseline [--check]` writes baseline.sql + baseline.generated.ts. `migrateDB` routes: empty → baseline; at/above baseline → versioned only; older → legacy. 7 tests (fixture built at v52, not copied; see DEVIATIONS). Dev-DB copy v52 → v54: chats preserved. |
| 0.8 | Run-worktree cleanup script | done | | 23fca90 | `pnpm workflow:cleanup-runs [--dry-run]` through WorktreeService.removeWorktree. Branches deleted only if merged or never pushed; orphans listed; writes `cleanup.log` + `cleanup.json`. Real run tested on a git fixture (3 tests). Dry run on the dev-DB copy: 2 worktree rows, 33 run branches (7 deletable, 26 checked out in orphan worktrees), 72 orphan dirs. |
| 0.7 | Failure baseline recorded in STATUS.md | done | | d772ee3 | §7 gate run once: typecheck 50/50; tests 27/31 packages green + 12 environmental baseline failures (symlink EPERM, CRLF autocrlf, POSIX paths, CLI TUI on Windows); lint green incl. 3 new checks; testkit 38/38; live E2E 5/5 (T1 after a judge fix); fresh-DB pass; Date.now() service list. |

## Phase 01: Spec v2, legacy purge, definition model

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 1.1 | Pure dead-code sweep | todo | | | |
| 1.2 | Delete the v1 session/webhook stack | todo | | | |
| 1.3 | Required deps in `createCoreServices` | todo | | | |
| 1.4 | Field and feature purges (PD decisions) | todo | | | |
| 1.5 | `@generatorai/workflow-spec` final shapes | todo | | | |
| 1.6 | Migration v55 `workflow_definitions_v2` | todo | | | |
| 1.7 | Definition service, store and API | todo | | | |
| 1.8 | Builder on v2 (behaviour) | todo | | | |
| 1.9 | Docs | todo | | | |

## Phase 02: SessionComposer

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 2.0 | Golden snapshots first | todo | | | |
| 2.1 | Pure helpers | todo | | | |
| 2.2 | PlatformToolBinder | todo | | | |
| 2.3 | resolveMcp for both owners | todo | | | |
| 2.4 | Agent projection, instructions, skills | todo | | | |
| 2.5 | Workspace exposure for stages | todo | | | |
| 2.6 | GatePort, TurnContextRegistry, tool-policy wrapper | todo | | | |
| 2.7 | PermissionModeSource, unattended defaults | todo | | | |
| 2.8 | Composer assembly and caller switch | todo | | | |
| 2.9 | TurnRecorder and provider-session resume | todo | | | |
| 2.10 | Migration v56 `session_parity` | todo | | | |
| 2.11 | UI: SessionSpecEditor | todo | | | |

## Phase 03: Engine v2

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | CAS repositories and RunStore | todo | | | |
| 3.2 | Migration v57 `workflow_engine_v2` | todo | | | |
| 3.3 | Pure scheduler core (`decide()`) | todo | | | |
| 3.4 | Error taxonomy | todo | | | |
| 3.5 | StageExecutor | todo | | | |
| 3.6 | Actor, supervisor, ownership, timers, leases, outbox, recovery | todo | | | |
| 3.7 | Switch, delete v1, flip | todo | | | |
| 3.8 | forkRun | todo | | | |
| 3.9 | Docs | todo | | | |

## Phase 03b: Stage conversation and run page

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 3b.1 | StageConversationService | todo | | | |
| 3b.2 | Web: stage as a compact chat | todo | | | |
| 3b.3 | Run-page streaming correctness and cost | todo | | | |
| 3b.4 | Mobile and TUI | todo | | | |

## Phase 04: One lifecycle, one invocation path

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Lifecycle into the engine (MountService) | todo | | | |
| 4.2 | `WorkflowInvocationService` | todo | | | |
| 4.3 | One route and one client method | todo | | | |
| 4.4 | Client migration: CLI, TUI, SDK, MCP, scripts | todo | | | |
| 4.5 | Client migration: web, desktop, mobile | todo | | | |
| 4.6 | Legacy removal checklist | todo | | | |
| 4.7 | Docs | todo | | | |

## Phase 05: Control flow as generic DAG building blocks

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 5A.1 | Spec, grammar delta, validator codes, presets | todo | | | |
| 5A.2 | `check` runtime (Windows launch fix) | todo | | | |
| 5A.3 | Loop engine | todo | | | |
| 5A.4 | Migration v59 | todo | | | |
| 5A.5 | Loop UI + run commands (web, mobile, TUI, CLI) | todo | | | |
| 5A.6 | Judge rule | todo | | | |
| 5B.1 | Map engine and mounts | todo | | | |
| 5B.2 | Sub-workflow + WorkflowApprovalService | todo | | | |
| 5B.3 | Wait (approval/event/timer, callback tokens) | todo | | | |
| 5B.4 | Fork, compensation and join UI | todo | | | |
| 5B.5 | Expression editor (CodeMirror 6) | todo | | | |
| 5B.6 | Remaining templates and docs | todo | | | |

## Phase 06: Agent integration and authoring skill

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Workflow tool set | todo | | | |
| 6.2 | Chat ↔ run bridge and UI | todo | | | |
| 6.3 | Orchestrator integration | todo | | | |
| 6.4 | Stages invoking workflows | todo | | | |
| 6.5 | `WorkflowAuthoringService` and endpoints | todo | | | |
| 6.6 | Skill bundle generation | todo | | | |
| 6.7 | Channels | todo | | | |
| 6.8 | MCP tools and resources (no prompts) | todo | | | |
| 6.9 | Docs | todo | | | |

## Phase 07: Economy, flow keys, tracing, UX

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 7.1 | Turn economy | todo | | | |
| 7.2 | Flow keys | todo | | | |
| 7.3 | Budgets UI and cost | todo | | | |
| 7.4 | Tracing alignment | todo | | | |
| 7.5 | Write amplification measurement | todo | | | |
| 7.6 | UX gaps | todo | | | |
| 7.7 | Docs | todo | | | |

## Phase 08: Dynamic workflows (PD-21 gated)

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 8.1 | Spec for `kind: 'dynamic'` | deferred | | | Gated by PD-21 |
| 8.2 | Script runtime (QuickJS) | deferred | | | Gated by PD-21 |
| 8.3 | Judge-panel template | todo | | | |
| 8.4 | Plan-then-execute expansion | todo | | | |
| 8.5 | Run diff | deferred | | | Backlog in the plan |
| 8.6 | Stage test with pinned data | deferred | | | Backlog in the plan |
| 8.7 | Opt-in stage cache | deferred | | | Backlog in the plan |
| 8.8 | Builder/run UI for dynamic workflows | deferred | | | Gated by PD-21 |

## Phase 09: Release gate

| WP | Task | Status | Review | Commit | Notes |
|---|---|---|---|---|---|
| 9.1 | Full live E2E suite | todo | | | |
| 9.2 | Security review | todo | | | |
| 9.3 | Docs from source | todo | | | |
| 9.4 | Register reconciliation | todo | | | |
| 9.5 | Performance and resource budgets | todo | | | |

## Review log per phase

Each phase review appends its findings and their dispositions here.
