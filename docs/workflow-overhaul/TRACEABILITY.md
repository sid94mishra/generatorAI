# Traceability matrix

Every issue from the audit register (W-01..W-49), every new finding (W-50..W-66) and every product-owner requirement (R1..R12) is mapped to the phase and work package that closes it.

Status values: `open` → `in progress` → `closed (PR #)` / `accepted (rationale)`. The coding agent updates this file in each phase PR.

## Requirements

| ID | Requirement | Phase / WP | Status |
|---|---|---|---|
| R1 | One invocation path across clients | P04 WP-4.1–4.5 | open |
| R2 | Streamlined creation, stages and config | P01 WP-1.5–1.8; P02 SessionSpec; P03 WP-3.1, 3.11 | open |
| R3 | A stage is a compact chat with every chat capability | P02 (all); P03b; P04 design 7 (mounts) | open |
| R4 | DAG evaluation; retries; a **generic** loop (fix ↔ review is one example) with a budget | README §5.1; P03 WP-3.3–3.6; P05 §2–§3, WP-5A.1–5A.5 (tests: loop matrix, examples L1–L6, v59 migration, Windows `check`) | open |
| R5 | Codex goals and Claude Code dynamic workflows research and support (as DAG constructs, no slash commands) | README §5.3; P05 examples L1–L6, M1–M3; P08 (judge panel + expansion; script runtime gated by PD-21) | open |
| R6 | Remove legacy and back-compat code | P01 WP-1.1–1.4; P03 WP-3.7; P04 WP-4.1 (orchestrator, worktrees), 4.4 (MCP embedded), 4.6; `check-no-legacy` | open |
| R7 | Chat and the orchestrator invoke workflows | P06 WP-6.1–6.4 | open |
| R8 | An authoring skill for any agent | P06 WP-6.5–6.8 | open |
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
| W-27 | P1 | Silent UI failures; lost uploads; overrides dropped | P01 WP-1.8 (delete); P03b WP-3b.2 (controls); P04 WP-4.5 |
| W-28 | P1 | Variables tab focus and choice options | P01 WP-1.8 |
| W-29 | P2 | Failure masking by always/on_completion | P03 WP-3.3 |
| W-30 | P2 | Unsatisfiable fan-ins and contradictory conditions accepted | P01 WP-1.5; P03 WP-3.1 |
| W-31 | P2 | Condition evaluator not fail-safe; no output routing | P03 WP-3.1 (Expression v2) |
| W-32 | P2 | Lifecycle hygiene (dedup, leaks, boot order, CAS finalize, 24 h listener) | P03 WP-3.6; P04 WP-4.1 |
| W-33 | P2 | Run page stream and UI correctness and cost | P03 WP-3.6 (outbox); P03b WP-3b.3 |
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
| W-55 | P2 | Completed-stage follow-up dropped but marked delivered | P03b WP-3b.1 |
| W-56 | P2 | CLI `script run` field bugs | P04 WP-4.4 |
| W-57 | P3 | CLI `--session-mode` rejected | P01 WP-1.1 |
| W-58 | P1 | MCP server runs its own engine on another DB | P04 WP-4.4 |
| W-59 | P1 | Retry drops the permission mode | P03 WP-3.8; P04 |
| W-60 | P3 | Inconsistent start scopes | P04 design 5 |
| W-61 | P2 | SDK composition root lacks dependencies | P01 WP-1.3 |
| W-62 | P3 | Orchestrator validation report always empty | P01 WP-1.1 |
| W-63 | P2 | Automation wait misses events and ignores approvals | P04 WP-4.2 |
| W-64 | P1 | Non-strict lossy import; no validate/plan/JSON Schema | P01 WP-1.5, 1.7; P06 WP-6.5 |
| W-65 | P2 | No permission mode at run start (web) | P03b WP-3b.2; P04 WP-4.5 |
| W-66 | P2 | Two concurrency gates plus a hidden 4-turn cap | P03 WP-3.5; P07 WP-7.2 |

## Independent review findings

All 44 findings (RV-1..RV-44) are dispositioned in `REVIEW-LOG.md`. Accepted findings are implemented in the WPs cited there. The coding agent verifies each accepted RV item in the phase PR that implements it.
