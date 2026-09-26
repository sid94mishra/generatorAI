# Traceability matrix

Every issue from the audit register (W-01..W-49), every new finding (W-50..W-66) and every product-owner requirement (R1..R12) is mapped to the phase and work package that closes it.

Status values: `open` → `in progress` → `closed (PR #)` / `accepted (rationale)`. The coding agent updates this file in each phase PR.

## Requirements

| ID | Requirement | Phase / WP | Status |
|---|---|---|---|
| R1 | One invocation path across clients | P04 WP-4.1–4.5 | closed (6fd9adc: `POST /api/workflow-invocations` / `WorkflowInvocationService` for web, desktop, mobile, CLI, TUI, SDK, MCP, automations, scripts, forks; one lifecycle) |
| R2 | Streamlined creation, stages and config | P01 WP-1.5–1.8; P02 SessionSpec; P03 WP-3.1, 3.11 | in progress (P01 part done: 1d67d0f, 28f9c5e; P02 SessionSpecEditor a220bb3) |
| R3 | A stage is a compact chat with every chat capability | P02 (all); P03b; P04 design 7 (mounts) | in progress (P02 done: one SessionComposer, binder, gates, TurnRecorder, permission source — see Phase 02 closure; P03b done: the stage conversation API and clients — see Phase 03b closure) |
| R4 | DAG evaluation; retries; a **generic** loop (fix ↔ review is one example) with a budget | README §5.1; P03 WP-3.3–3.6; P05 §2–§3, WP-5A.1–5A.5 (tests: loop matrix, examples L1–L6, v59 migration, Windows `check`) | closed (P05: loop 0c3f4e2..4d6ba7e, map/sub-workflow/wait 3eb76c9..dcd3b60; tests deferred to the final pass) |
| R5 | Codex goals and Claude Code dynamic workflows research and support (as DAG constructs, no slash commands) | README §5.3; P05 examples L1–L6, M1–M3; P08 (judge panel + expansion; script runtime gated by PD-21) | in progress (P05 done: templates L1–L6, M1–M3, W1–W3, S1, completeness critic generated from presets, c46fe80; P08 remains) |
| R6 | Remove legacy and back-compat code | P01 WP-1.1–1.4; P03 WP-3.7; P04 WP-4.1 (orchestrator, worktrees), 4.4 (MCP embedded), 4.6; `check-no-legacy` | in progress (P01–P04 parts done: orchestrator, preprocessor, run-start routes, MCP embedded mode deleted; 110 bans) |
| R7 | Chat and the orchestrator invoke workflows | P06 WP-6.1–6.4 | closed (a55a1bf, 52e5497, 966e114, c44ba88, cf0ac96: one workflow tool set for chats, orchestrators and stages; chat bridge and cards) |
| R8 | An authoring skill for any agent | P06 WP-6.5–6.8 | closed (52e5497, ba3759a, e0f06ac, fc3f9dc: authoring service and routes, the generated skill, CLI, MCP tools and resources) |
| R9 | Review the earlier document | README §4 | closed (this plan) |
| R10 | Evidence-backed recommendations | "Why" paragraphs in every phase; evidence folder | closed (this plan) |
| R11 | A phase-by-phase plan for a coding agent | PHASE-00..09 | closed (this plan) |
| R12 | Independent critical review, incorporated | REVIEW-LOG.md (44 findings dispositioned) | closed (plan v1.1) |

## Issue register

| ID | Sev | Short title | Phase / WP |
|---|---|---|---|
| W-01 | P0 | Pause/cancel mid-stage: paused stage completes empty; cancelled stage resurrects | P03 WP-3.5, 3.6 |
| W-02 | P0 | Heartbeat reaper kills healthy stages after HITL or validation retry | P03 WP-3.2 (lease in CAS), 3.5 |
| W-03 | P0 | Builder save with a new connected stage fails (local ids) | P01 WP-1.5 (edges by key), 1.8 |
| W-04 | P0 | Deleting a stage corrupts the graph (FK, non-transactional) | P01 WP-1.6, 1.7 |
| W-05 | P0 | Non-atomic save plus reload wipes edits | P01 WP-1.7, 1.8 |
| W-06 | P0 | Reserved `__*` variables are caller-controllable (webhook exfiltration) | P01 design 5 (typed codebase scope, reserved names, no interpolation in commands); P04 design 3, WP-4.2 |
| W-07 | P1 | Unattended runs default to bypass | P02 WP-2.7; P04 WP-4.2 |
| W-08 | P1 | Event routing dead; 3 s poll; validation blocks the tick | P03 WP-3.6 |
| W-09 | P1 | Linear workflows run on stage 1's session config | P02 WP-2.9; P03 (session model) |
| W-10 | P1 | Lifecycle differs by client (no PR from CLI/automations) | P04 WP-4.1 |
| W-11 | P1 | Run retry fails copied stages and loses the workspace | P03 WP-3.8 |
| W-12 | P1 | Stage retry/resume routes lose context | P03 WP-3.6 (commands), 3.8 |
| W-13 | P1 | Mid-run edits leak; deleting a stage wedges the run | P01 WP-1.6/1.7 (versions); P03 (compiled version) |
| W-14 | P1 | Cancel strands awaiting/sleeping stages | P03 WP-3.6, 3.7 |
| W-15 | P1 | Timeout counts HITL time; internal turns unbounded | P03 WP-3.5 |
| W-16 | P1 | Crash recovery completes a stage with empty output | P03 WP-3.5 (journal), 3.6 (recovery) |
| W-17 | P1 | Validation checks the wrong text; race skips validation | P03 WP-3.5 (OutputExtractor, validating state) |
| W-18 | P1 | MCP secrets not resolved for stages | P02 WP-2.3 |
| W-19 | P1 | Permission gates not enforced on Claude/Codex stages | P02 WP-2.4, 2.7 |
| W-20 | P1 | Options accepted but never stored or used | P01 WP-1.4, 1.5 |
| W-21 | P1 | Cleared settings never persist | P01 WP-1.7/1.8 (graph replace) |
| W-22 | P1 | Saved codebase selection ignored server-side | P04 WP-4.1 |
| W-23 | P1 | Post-processing steps never run | P01 WP-1.4; P04 WP-4.1 |
| W-24 | P1 | Controls with no reader (variables, files, templates, iteration, sleep, widgets, "…") | P01 WP-1.4 (delete); P02 WP-2.2 (widgets); P03b WP-3b.2 (menu); P05 (loop, subworkflow, wait) |
| W-25 | P1 | Lossy export/import; broken template; lossy script materializers | P01 WP-1.5, 1.7 |
| W-26 | P1 | Empty prompt unsaveable; duplicate definitions; weak client validation | P01 WP-1.8 |
| W-27 | P1 | Silent UI failures; lost uploads; overrides dropped | P01 WP-1.8 (delete); P03b WP-3b.2 (controls, closed 63db929); P04 WP-4.5 |
| W-28 | P1 | Variables tab focus and choice options | P01 WP-1.8 |
| W-29 | P2 | Failure masking by always/on_completion | P03 WP-3.3 |
| W-30 | P2 | Unsatisfiable fan-ins and contradictory conditions accepted | P01 WP-1.5; P03 WP-3.1 |
| W-31 | P2 | Condition evaluator not fail-safe; no output routing | P03 WP-3.1 (Expression v2) |
| W-32 | P2 | Lifecycle hygiene (dedup, leaks, boot order, CAS finalize, 24 h listener) | P03 WP-3.6; P04 WP-4.1 |
| W-33 | P2 | Run page stream and UI correctness and cost | P03 WP-3.6 (outbox); P03b WP-3b.3 (closed 63db929) |
| W-34 | P2 | Command-bearing fields need only write scope; plaintext secrets | P01 WP-1.7; P03 WP-3.5 (fencing); P09 WP-9.2 |
| W-35 | P2 | Name/order-based references fragile | P01 design 1 (keys) |
| W-36 | P2 | Worktree rm -rf; skills committed into PRs; silent capability loss; missing agent widens | P02 WP-2.4, 2.8; P04 design 7 (mounts), WP-4.1 |
| W-37 | P2 | CLI profiles no-op; legacy webhooks; upload layouts; lossy SDK create | P01 WP-1.2, 1.7; P04 WP-4.1, 4.4 |
| W-38 | P2 | Nested routes skip ownership; force-delete orphans; withTransaction leaks | P01 WP-1.7 |
| W-39 | P2 | No error classes or jitter; regex unguarded; config unwired | P03 WP-3.4 (classes, jitter); P01 WP-1.5 (re2-wasm regex, save-time validation); P01 WP-1.1 (config) |
| W-40 | P2 | Stages lack chat tools; worker clamp on Copilot | P02 WP-2.2; P06 WP-6.3 |
| W-41a | P3 | `waitForCompletion:false` fire-and-forget | P01 WP-1.4 (deleted) |
| W-41b | P3 | Pause mid-turn saves partial text as complete | P02 WP-2.9 (`complete` flag); P03 WP-3.5 (recovery rule) |
| W-41c | P3 | `pauseRun` ignores queued stages | P03 WP-3.6 (run pause via decide) |
| W-41d | P3 | Double start leaks a RunLogger or workspace | P01 WP-1.4 (RunLogger deleted); P03 (CAS `created→starting`) |
| W-41e | P3 | `pre_run` hook variables leak across siblings | P03 WP-3.5 |
| W-41f | P3 | `stage_run.cancelled` and user `stage_run.paused` never emitted | P03 WP-3.6 (outbox events per transition) |
| W-41g | P3 | Preprocessor uses `sh -c` and server cwd | P04 WP-4.1 |
| W-41h | P3 | `StageExecutionError` passes the definition id | P03 WP-3.5 |
| W-42 | P3 | Write amplification and polling cost | P03 (event-driven, no polling); P01 (RunLogger deleted); P07 WP-7.5 (measure; accept at ≤ 2.2×) |
| W-43 | P3 | Builder polish | P01 WP-1.8; P07 WP-7.6 |
| W-44 | P3 | Documentation drift | P01 WP-1.9; P09 WP-9.3 |
| W-45 | P3 | Template schema hazards | P01 WP-1.7 (templates as WorkflowGraph, boot validation) |
| W-46 | P1 | "Request changes" revision lost | P03 WP-3.5 (approval via runTurn) |
| W-47 | P2 | json_schema / llm_validation / custom_script unusable | P03 WP-3.1, 3.5; P05 WP-5.4 (judge) |
| W-48 | P2 | Short-answer output-retry pollutes output; boilerplate refusals | P03 WP-3.5; P07 WP-7.1 |
| W-49 | P2 | 2–3 turns per stage; serialized parallel launches | P03 WP-3.5 (context inline, checkpoint gating); P07 WP-7.1 |
| W-50 | P2 | Chat create/resume builder drift | P02 WP-2.4, 2.8 |
| W-51 | P2 | Stage `replace` wipes the system message; instructions not last | P02 WP-2.4 |
| W-52 | P1 | Stage team mapping drops restrictions | P02 WP-2.4 |
| W-53 | P1 | Chat does not enforce agent tool groups | P02 WP-2.6 |
| W-54 | P2 | HookBridge never wired | P02 WP-2.2 step 7 |
| W-55 | P2 | Completed-stage follow-up dropped but marked delivered | P03b WP-3b.1 (closed 0254811) |
| W-56 | P2 | CLI `script run` field bugs | P04 WP-4.4 |
| W-57 | P3 | CLI `--session-mode` rejected | P01 WP-1.1 |
| W-58 | P1 | MCP server runs its own engine on another DB | P04 WP-4.4 |
| W-59 | P1 | Retry drops the permission mode | P03 WP-3.8; P04 |
| W-60 | P3 | Inconsistent start scopes | P04 design 5 |
| W-61 | P2 | SDK composition root lacks dependencies | P01 WP-1.3 |
| W-62 | P3 | Orchestrator validation report always empty | P01 WP-1.1 |
| W-63 | P2 | Automation wait misses events and ignores approvals | P04 WP-4.2 |
| W-64 | P1 | Non-strict lossy import; no validate/plan/JSON Schema | P01 WP-1.5, 1.7; P06 WP-6.5 |
| W-65 | P2 | No permission mode at run start (web) | P03b WP-3b.2 (run page, closed 63db929); P04 WP-4.5 |
| W-66 | P2 | Two concurrency gates plus a hidden 4-turn cap | P03 WP-3.5; P07 WP-7.2 |

## Phase 01 closure (2026-09-25, review pending)

The P01 plan's **Closes** list, with the commits and the tests that pin each item. "Definition side" / "schema side" / "part" mean the rest stays with the phase in the register above.

| ID | What P01 closed | Commits | Evidence |
|---|---|---|---|
| W-03 | Edges and stages are keyed by stage key end to end (store, API, builder) | 1d67d0f, 28f9c5e | builder store D-1 test; testkit T6 |
| W-04 | Stage delete is part of one transactional graph save; FKs by key | 1d67d0f, 28f9c5e | builder D-2 test; store transaction |
| W-05 | Whole-graph save in one transaction with `expectedRevision`; no reload while saving/dirty | 1d67d0f, 28f9c5e | server 409 test; builder page test |
| W-13 (definition side) | Runs pin an immutable definition version | 1d67d0f | T6 pinned-version test; WorkflowRunService pinning test |
| W-20 | Every accepted field is stored (one strict document) | 1d67d0f | T6 round trip |
| W-21 | Cleared settings persist (graph replace; clearing deletes the field) | 1d67d0f, 28f9c5e | builder clearing test |
| W-23 (schema side) | Post-processing steps are lifecycle fields with v2 shapes | 1d67d0f | postProcessing tests |
| W-24 (deletions) | Dead controls removed | 28f9c5e (and part A) | — |
| W-25 | Canonical export/import; templates and scripts through `createFromSpec` | 1d67d0f | T6 round trip; script build check |
| W-26 | Client validation = server validation; save blocked on errors | 28f9c5e | builder validation tests |
| W-28 | Variables tab: stable ids, raw option text | 28f9c5e | variableLabel tests |
| W-30 (validator) | Broken definitions are rejected at save | 1d67d0f | T6 malformed imports; T2 |
| W-31 (grammar) | Guards read upstream stages; typed Expression v2 | 1d67d0f | T2 |
| W-34 (definition fields) | Command-bearing fields need `admin:settings` | 1d67d0f | server 403 test; T6; WorkflowDefinitionService test |
| W-35 | Keys instead of names/order | 1d67d0f | — |
| W-38 | Nested routes, force-delete and `withTransaction` gone; delete archives when runs exist | 1d67d0f | server archive test; T6 |
| W-43 (part) | Builder polish items of WP-1.8 | 28f9c5e | — |
| W-45 | Templates are `WorkflowGraph`s validated at boot | 1d67d0f | TemplateRegistry strict load |
| W-47 (part) | `json_schema` uses a real validator; `custom_script` runs command + args (found fixed by T4) | 1d67d0f | T4 |
| W-57, W-61, W-62 | (part A) | part A commits | — |
| W-64 (import side) | Strict import of v2 documents only; `/validate` endpoint | 1d67d0f | T6; server validate test |
| RV-13..RV-16, RV-22, RV-32, RV-42 | Spec/validator/scope items (part B) wired into the store, engine and clients | 1d67d0f | — |
| RV-1, RV-33 | v55: FKs off with explicit child deletes; frozen schema copies | 1d67d0f | migration55 test |

## Phase 02 closure (2026-09-25, review pending)

The P02 plan's **Closes** list, with the commits and the tests that pin each item. Commits: 0c02b1c (2.1), a8324be (2.2), 2ea6ce0 (2.3), 7666200 (capability levels), 52df8ae (2.4), 1fb1574 (2.5), 47806a2 (2.6), 8cfe62a (2.7), 1cb1991 (2.10), 8f3dbe3 (2.8), ad35d22 (2.9), a220bb3 (2.11), c35f905 (bans, docs).

| ID | What P02 closed | Commits | Evidence |
|---|---|---|---|
| W-07 | No bypass default: run → stage → workflow → trigger → posture; automations must declare a mode (PD-18); `DEFAULT_WORKFLOW_RUN_PERMISSION_MODE` deleted and banned | 8cfe62a, 1cb1991 | session/permission.test.ts; migration56.test.ts |
| W-18 | MCP `secretref:` values resolved per owner through the hub; unresolved servers dropped with a warning, no pointer reaches a provider; v1 engine gate lifted | 2ea6ce0, 8f3dbe3 | session/resolveMcp.test.ts; workflow-spec validate test |
| W-19 | The run's permission mode reaches Claude and Codex stages per turn; their gates park in HITL; a provider that never asks is refused (PD-17) | 8cfe62a, 8f3dbe3 | session/composer.test.ts (composer level; live E2E not run) |
| W-36 (skills) | Skills delivered per provider level: Claude local plugin root (settingSources stays []), Copilot/Codex directories (Codex warns process-global), others warn; a stage with a missing/disabled agent fails (C-12) | 52df8ae, 8f3dbe3 | session/agentProjection.test.ts; providers workspace-mounts test; composer.test.ts |
| W-40 (binder) | Stages get the chat's tools: browser, computer use (opt-in, never on bypass), widgets, custom tools, orchestrator, session hooks | a8324be, 8f3dbe3 | composer.test.ts; golden g; agent-host binderContract test |
| W-50 | Chat create and resume share one precedence rule and order | 52df8ae, 8f3dbe3 | golden a–e (W-50 fields flipped, the rest byte-identical) |
| W-51 | Agent instructions last; `replace` drops only the replaceable base | 52df8ae, 8f3dbe3 | golden f; agentProjection.test.ts |
| W-52 | Stage team mapping keeps tools/disallowedTools/effort/maxTurns/permissionMode | 52df8ae, 8f3dbe3 | golden f; agentProjection.test.ts |
| W-53 | Chats enforce the agent's tool groups before any gate | 47806a2 | session/gates.test.ts |
| W-54 | Session hook bridge wired for chats and stages (`SessionHookRegistry`) | a8324be | session/sessionHooks.test.ts |
| RV-6, RV-9 (levels) | `approvalGating` / `hostTools` / `structuredOutput` / `skills` levels replace the booleans; one table (shared) checked against every provider | 7666200, a220bb3 | agent-harness-providers capabilityLevels.test.ts |
| RV-7, RV-8 | Claude skills as a local plugin; skills staged only where the provider loads them | 52df8ae | agentProjection.test.ts; workspace-mounts test |
| RV-10 (P02 half) | `chat_messages.complete`; written false for a stopped turn by the TurnRecorder | 1cb1991, ad35d22 | migration56.test.ts; session/turnRecorder.test.ts |
| RV-18 / PD-20 | Chats keep their columns; `chatSessionSpec` maps them to the composer's SessionSpec | 52df8ae | golden a–e |
| RV-20 | Interim single-mode rebind cut (the shared session keeps its config; rebind is P03) | 8f3dbe3 | DEVIATIONS (binding key) |
| RV-26 | Tools, gates and hooks cross the agent-host IPC as callbacks; turn options on `send_turn` | a8324be | agent-host binderContract.test.ts (host on/off) |
| RV-30 / PD-18 | Automations require a permission mode; webhook + bypass needs admin:settings | 8cfe62a, 1cb1991 | permission.test.ts; server automation routes |
| RV-41 | T4 (tool policy), T7 (record_plan), P6 (question/plan-review gates), P7 (plan prefix only without a native gate), R9 (bind failure → error + idle, stage failed) | 47806a2, 8f3dbe3 | gates.test.ts; composer.test.ts; SES tests |
| F-3b | Stage sessions record and resume the provider session handle | 8f3dbe3, ad35d22 | turnRecorder.test.ts |
| PD-5, PD-17, PD-19 | Computer use opt-in for stages and never on bypass; gating refusals/warnings at compose and run start; SessionSpecEditor with inline warnings | 8f3dbe3, 8cfe62a, a220bb3 | composer.test.ts; SessionSpecEditor.test.tsx |

## Phase 03 closure (2026-09-26, review pending)

The P03 plan's **Closes** list, with the commits and the tests that pin each item. Commits: dd00852 (3.2), 7d4ecb4 (3.4), 5d7b3e9 (3.3), 527f41c (3.1), 9732b79 (3.5), 08c1206 (3.6), 5dad4e7 (3.7 + 3.8, the cutover), 48cc4ec (3.9). The v2 engine is the only engine since 5dad4e7.

| ID | What P03 closed | Commits | Evidence |
|---|---|---|---|
| W-01 | Pause/cancel write the desired state before aborting; a paused stage never completes, a resume continues its conversation | 9732b79, 08c1206 | testkit T5 pause/cancel; decide commands tests |
| W-02 | No heartbeat reaper: an executor lease renewed while the attempt lives; a slow repair is not reaped | 527f41c, 9732b79 | testkit T4 slow repair (F-4) |
| W-08 | Event routing on the actor's hop (no 3 s poll, no subscribeRunEvents); validation inside the attempt | 08c1206, 5dad4e7 | testkit T1 (join within one hop) |
| W-09 (session model) | `sessionReuse` / `sessionGroup` on `run_sessions`; a fresh session per stage by default with its own config | 9732b79 | testkit T7 fresh sessions |
| W-11 | A re-run is a fork: completed instances are memoized (never re-validated), workspace fresh/reuse/restore_checkpoint | 5dad4e7 | testkit fork.test.ts |
| W-12 | Stage retry/resume are commands on paused instances (resume attempts keep the conversation); run retry is a guarded, idempotent fork | 08c1206, 5dad4e7 | T3, T5, T8; fork.test.ts (409 on live, idempotency key) |
| W-14 | Cancel reaches every live instance, parked ones included (their frame is aborted after the write) | 08c1206 | T5 cancel; decide commands tests |
| W-15 | Every turn inside the attempt deadline; parked time excluded | 9732b79 | T3 deadline test |
| W-16 | Recovery never completes on missing work: unsafe interrupted turns pause the stage, safe ones replay | 9732b79, 08c1206 | T8 crash tests |
| W-17 | Rules judge the latest answer only, inside the attempt (`validating`); nothing completes unvalidated | 9732b79 | T4; output-contract tests |
| W-29 | Only `on: failure` / `handlesFailure` absorbs a failure | 5d7b3e9 | T3 (always no longer masks); readiness tests |
| W-31 (runtime) | A guard/when evaluation error fails the stage (`condition_error`), never a silent skip | 5d7b3e9 | decide/readiness tests; T2 |
| W-32 | Boot-order race gone (no allocator map; `run_sessions` read at bind time), CAS finalize, no 24 h poll listeners in the engine | 08c1206, 5dad4e7 | T8 |
| W-39 (engine) | Error classes, retry precedence, jitter drawn in the store | 7d4ecb4, 5d7b3e9 | errors tests; T3 |
| W-41 (engine sub-items) | `pre_run` hook variables scoped to the attempt; errors carry the instance id | 9732b79 | executor code; T3 |
| W-46 | "Request changes" runs a journalled revision that reaches the successor | 9732b79 | T5 changes |
| W-47 (runtime) | JSON Schema contract with ajv, native/tool/final-block extraction, repair turns | 9732b79 | output-contract tests; T4 |
| W-48 (output retry) | No output-retry turn, no file-writing boilerplate on prompts | 9732b79 | T1, T7 |
| W-59 | A fork keeps the permission mode, overrides, project and trigger lineage | 5dad4e7 | fork.test.ts |
| W-66 | One concurrency gate (the admission controller); no stage Semaphore | 9732b79, 5dad4e7 | T1; `maxConcurrentStages` banned in core/server |
| RV-1, RV-5, RV-9, RV-10, RV-17, RV-20, RV-27 | v57 explicit purge; RV-5 terminal events from the outbox; output strategies; turn settlement with the message; migration numbers; rebind; engine lock + fencing | dd00852..5dad4e7 | migration57, RunStore, T8 lock refusal |

Not closed by P03 (with the phase that owns them): the fast-check model test over the G5 §7.2 invariants, T10 (25 stages) and the hop-latency p95 assertion (DEVIATIONS / handoff), the run-page correctness work (P03b), clone/preprocess/post-processing in the lifecycle (P04).

## Phase 03b closure (2026-09-26, review deferred to the final review)

Commits: 0254811 (3b.1), 2529558 (3b.4), 63db929 (3b.2 + 3b.3), f55692b (docs). Tests for these items are deferred to the final pass (IMPLEMENTATION FIRST).

| ID | What P03b closed | Commits | Evidence |
|---|---|---|---|
| W-27 (run controls) | Every run-page control reports a refusal (toasts with the server's reason), cancel asks first, gate buttons disable while a verdict is in flight | 63db929 | `useRunCommand`/`useForkRun`/stage mutations `meta.errorTitle`; `useConfirm` in the run page |
| W-33 | interruptData with the status (D-19), one focus field (D-20), protected stage streams (D-21), per-instance version merge (D-21b), stage-own Inspector files (D-22), header-only clock, memoised stage views, no dead scratchpad/terminal polling (D-24) | 63db929 | `workflowRunStore.ts`, `deriveRunView.ts`, `WorkflowRunPage.tsx`; events carry `version` |
| W-55 | A follow-up on a completed stage amends its output (PD-4) through the stage conversation API; the review batch is marked delivered only when the stage took it | 0254811 | `StageConversationService.send`, `StageExecutor.amend`, `routes/review.ts` |
| W-65 (run page) | The run page has a permission-mode control (the run row's layer); run start is P04 WP-4.5 | 63db929 | `RunHeaderBar` |
| W-24 ("…" menu) | The stage "…" menu works: every item goes through the commands API | 63db929 | `StageTimelineItem` `StageMenu` |
| PD-3, PD-4, PD-9 | 409 STAGE_BUSY mid-turn; amend on completed; one feedback path (completion review + the conversation API; `followUpPrompt` banned) | 0254811, 63db929, 2529558 | `StageConversationService`; no-legacy ban |
| R3 (P03b part) | A stage is a compact chat on web, mobile, TUI and CLI: send, stop, attach, gate cards, amend | 0254811, 63db929, 2529558 | see TRACKER Phase 03b |

## Phase 04 closure (2026-09-26, review deferred to the final review)

Commits: 6fd9adc (WP-4.1–4.5), a09e3d1 (WP-4.6 bans), 5882780 (WP-4.7 docs). Tests for these items are deferred to the final pass (IMPLEMENTATION FIRST), except the v58 chat-safety test.

| ID | What P04 closed | Commits | Evidence |
|---|---|---|---|
| W-06 | Engine values are never variables: `system_vars` / typed columns (working directory, codebases, uploads, trigger ceiling, workspace id); `__*` refused in request variables, stage overrides and datasets | 6fd9adc | `validateInvocation`, `IterationPlanner`, `StageExecutor` reads `run.systemVars`; P04 `__*` ban |
| W-10 | One lifecycle for every run: prepare/finalize phases in the engine, whoever starts the run (commit/push/PR from the CLI, automations, SDK, MCP, scripts, forks too) | 6fd9adc | `engine/lifecycle/prepare.ts`, `finalize.ts`; `WorkflowOrchestrator` deleted |
| W-22 | Codebases come from the request, else `lifecycle.codebaseAliases`, else none (CODEBASE_REQUIRED when required); never "all codebases" | 6fd9adc | `codebaseSelectionOf`, `validateInvocation`; web/mobile codebase drafts |
| W-23 (runtime) | Explicit post-processing steps run in `postProcess`; only an explicit commit step suppresses the auto-commit | 6fd9adc | `buildPostProcessingSteps` |
| W-27 (run launch) | A refused run start is shown in the web dialog / mobile sheet (the envelope's message + issues), never console-only | 6fd9adc | `RunDialog`, `StartRunSheet` |
| W-37 | Profiles have one schema (`RunProfileSchema`, stage KEYS) and apply; uploads have one writer and one layout; legacy webhooks already gone | 6fd9adc | `RunProfileSchema`, `writeRunUpload`, CLI `--profile` |
| W-56 | CLI `script run` applies the profile and reads the run id (an invocation) | 6fd9adc | `platform.ts` `script run` |
| W-58 | The MCP server runs in remote mode only, as a paired `mcp` device; embedded mode deleted | 6fd9adc | `mcp-server/src/remote.ts`, `cli.ts` |
| W-60 | Starting a run is one scope decision: `exec:agent` + `read:workflows` (a default phone can); script → `write:workflows`; bypass off loopback / in place → `admin:settings` | 6fd9adc | route policy `/workflow-invocations`, `checkInvocationScopes`; mobile `runStart` gate |
| W-63 | Waiters subscribe before reading and key on `workflow_run.finalized` (after post-processing); approvals and timeouts return | 6fd9adc | `WorkflowInvocationService.waitFor`; automations; CLI `--watch` digest long-poll |
| W-65 | The web and mobile run start set the permission mode (deployment default when untouched) | 6fd9adc | `RunDialog` run options; `StartRunSheet` Advanced |
| C-1, C-6, C-7, C-8, C-10, C-14, C-16, C-17 | one lifecycle; workspace id a column; worktrees never removed on cancel/failure; uploads and hook attachments outside the mounts; profiles by key; legacy webhooks gone; one upload writer; hooks once per phase (journal) | 6fd9adc | see TRACKER Phase 04 |
| PD-6, PD-22 | a paired phone may start runs; the MCP credential is device pairing with platform `mcp` | 6fd9adc | route policy; `DEFAULT_MCP_SCOPES`; v58 |
| R1 | One invocation path across clients | 6fd9adc | above |

## Phase 05 closure (2026-09-26, review deferred to the final review)

Commits: 5A 0c3f4e2..4d6ba7e (see TRACKER); 5B 3eb76c9 (spec), 5ffd0a4 (engine), 1d195c3 (fork), ad2f99d, 429933a (builder), c8640ef (expression editor), 046f193 (run page), dcd3b60 (clients), c46fe80 (templates), 9e41d05 + 51aee1b (docs). Tests for these items are deferred to the final pass (IMPLEMENTATION FIRST), except the v59 chat-safety test.

| ID | What P05 closed | Commits | Evidence |
|---|---|---|---|
| R4 | A generic loop with exit rules, carry, budgets and operator decisions; plus map, sub-workflow and wait as generic kinds | 0c3f4e2..4d6ba7e, 3eb76c9, 5ffd0a4 | `domain/scheduler/{loops,maps,waits,subworkflows}.ts`; testkit checks by hand (STATUS 05A/05B gates) |
| W-24 (P05 part) | The old iteration/sleep controls are real stage kinds: `loop` (iterationConfig replaced), `wait` (timer/approval/event), `subworkflow` | 0c3f4e2, 3eb76c9, 5ffd0a4 | builder panels (4d6ba7e, 429933a) |
| W-47 (judge) | `llm_validation` replaced by the judge rule (`output.rules` type judge) | 0103a4d | no-legacy ban; STATUS 05A gate |
| P5-1..P5-19, P5-24, P5-27..P5-36, P5-38, P5-40, P5-43..P5-47 | 5A: contexts, grammar, check (Windows launch, security), loop engine, v59, judge | 5A commits | TRACKER Phase 05 |
| P5-20..P5-23, P5-48 | Map results shape (per-item select), paths by index with the key in `item_key`, forkFromSnapshot all or nothing, git-backed mounts, itemSetup, leases, merges and conflicts, `list` variables, shared-write warning | 3eb76c9, 5ffd0a4, 1d195c3 | DEVIATIONS 5B rows |
| P5-25 | Sub-workflow: inherit suppresses the child's mounts/post-processing, portable `workflowRef`, output drift, every child decision mirrored, draft rules | 3eb76c9, 5ffd0a4 | `WorkflowApprovalService`, `SubworkflowEffects` |
| P5-26, P5-41 | Event table semantics (idempotency, early arrival, per instance), per-wait callback tokens, the unattended TTL for waits | 5ffd0a4 | `waits.ts`, `routes/workflowCallbacks.ts` |
| P5-37 | Templates generated from presets (`check:templates`), adversarial-verify and completeness-critic shipped | c46fe80 | 15 templates |
| P5-39 | CodeMirror 6 lazy chunk with a budget | c8640ef | `check-bundle-size.mjs` (104.7 KB of 250 KB) |
| P5-42 | CLI `run command --json` (5A) plus `--eventKey/--idempotencyKey/--data @file` | 936e7a1, dcd3b60 | CLI surface snapshot |
| Cross-file #14 | `WorkflowApprovalService` extracted in P05 (P06 reuses it) | 5ffd0a4 | notes/P05B-handoff.md |

## Phase 06 closure (2026-09-26, review deferred to the final review)

Commits: 21393c6 (v60), a55a1bf (WP-6.1 core with 6.2–6.5 wiring), a569934, 52e5497 (routes), cf0ac96 (6.4), 3e685fd + f1db906 (docs), 59f9b29 (deviations), 966e114 + c44ba88 + a7aadc2 (UI), e0f06ac (CLI), fc3f9dc (MCP), 4d7869c (fixes), ba3759a (skill). Tests for these items are deferred to the final pass (IMPLEMENTATION FIRST), except the v60 chat-safety test.

| ID | What P06 closed | Commits | Evidence |
|---|---|---|---|
| R7 | Chats, orchestrators and stages find, run, follow, answer and cancel workflows through one tool set | a55a1bf, 52e5497, cf0ac96, 966e114, c44ba88 | `tools/workflows/`, `ChatWorkflowRunBridge`, web/mobile cards |
| R8 | Any agent authors a workflow: validate → plan → draft → a person publishes; the generated skill in three channels | 52e5497, ba3759a, e0f06ac, fc3f9dc | `WorkflowAuthoringService`, `skills/generatorai-workflow-author/`, CLI `skill install`, MCP resources |
| W-40 (P06 part), C-15 | The worker clamp holds on Copilot: built-in denials travel as `extraDeny` → `excludedBuiltinTools`; workers get no workflow tools | a55a1bf | `inheritWorkerCapabilitiesFrom` |
| C-18 | A chat invokes workflows (trigger chat/orchestrator, lineage, ceiling, idempotency) | a55a1bf | `WorkflowToolHost.run` |
| W-58 (P06 part) | The MCP server exposes the full workflow tool set and the skill (remote mode, no prompts) | fc3f9dc, 52e5497 | `packages/mcp-server/src/server.ts`, `/api/workflow-tools` |
| W-64 (authoring side) | Stateless validate with server checks, plan without writes, the JSON Schema + hash endpoint, agent-authored drafts | 52e5497, 4d7869c | routes `/workflow-definitions/{validate,plan,schema,authoring/skill}` |
| PD-14 | Agent-authored workflows are drafts; a person publishes (`GENERATORAI_ALLOW_AGENT_PUBLISH` for agents, default off) | 52e5497, 966e114 | `isPersonRequest`, agent-draft banner |
| PD-23 | Workflow tools opt-in for plain chats, on for orchestrators, off for workers | a55a1bf | composer, `createChat`, resolver |

## Independent review findings

All 44 findings (RV-1..RV-44) are dispositioned in `REVIEW-LOG.md`. Accepted findings are implemented in the WPs cited there. The coding agent verifies each accepted RV item in the phase PR that implements it.
