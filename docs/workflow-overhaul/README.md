# Workflow Module Overhaul: Master Plan

Status: **v1.2**. v1.1 was revised after an independent review of the whole plan (44 findings). v1.2 reworks Phase 05 into generic control-flow building blocks with no slash commands, after a second independent review of that phase (48 findings, all accepted). See `REVIEW-LOG.md`.
Date: 2026-09-24. Branch baseline: `desktop_redesign` @ `a83a7bf`.
Audience: a coding agent (Claude Code or similar) working phase by phase, and the human reviewer.

The plan turns GeneratorAI's workflow module into a single, streamlined engine:
- one definition model;
- one invocation path;
- one session composer shared with chat;
- one execution engine with loops, maps, sub-workflows, typed outputs and budgets;
- agent-facing tools and an authoring skill.

It removes every legacy path along the way, because the product is not live and **no backward compatibility is required**.

---

## 0. How to use this plan (read this first, coding agent)

1. **Work strictly phase by phase, in the order of §6** (00 → 01 → 02 → 03 → 03b → 04 → 05 → 06 → 07 → [08 if PD-21] → 09). Each phase file (`PHASE-xx-*.md`) is self-contained. It gives goals, preconditions, the files to read first, work packages (WP) with exact file changes, the tests to write, acceptance criteria and a handoff checklist.
2. **Read the evidence before coding.** Every WP cites evidence as `A-7`, `B-3`, `G5 §3.5` and so on. The files are in `docs/workflow-audit/evidence/`:

   | Evidence file | Contents |
   |---|---|
   | `A_definitions_db.md` | Definitions, DB and import/export audit |
   | `B_runtime.md` | Run-time engine audit |
   | `C_orchestration_integrations.md` | Orchestrator, harness matrix, integrations, security |
   | `D_web_ui.md` | Builder, run page and right pane |
   | `E_modern_engines_research.md` | 22-engine benchmark |
   | `F_live_tests.md` | Live E2E results |
   | `G1_goals_dynamic_workflows_research.md` | Codex goals, Claude Code workflows, Agent Skills, loop patterns |
   | `G2_chat_stage_parity.md` | Chat-vs-stage parity and the SessionComposer design |
   | `G3_legacy_inventory.md` (+ `G3_part_*.md`) | Legacy, duplicate and dead code inventory, plus DB facts |
   | `G4_invocation_tools_skill.md` | Invocation path, workflow tools and the authoring skill |
   | `G5_scheduler_v2_loops.md` | Scheduler v2, loops, retries, state machines, data model |

   The consolidated issue register (W-01..W-49) is in `docs/workflow-audit/WORKFLOW-AUDIT-2026-09.html`. W-50..W-66 are new in this round; see §4.3.
3. **Follow the rules in §8.** They are not optional. Two matter most: no compatibility shims and no half-migrated call sites.
4. **One phase = one branch** (`wf/phase-NN-<slug>`). Commit per WP. Every commit builds and passes its package tests. **Merge each green sub-milestone to the base branch**, rather than holding one long-lived branch (RV-38). Order the sub-milestones so every merge leaves exactly one working path.
5. **When the plan and the code disagree** (a line number moved, a file was renamed), trust the code, keep the intent of the WP, and write the discrepancy in the PR description. When a WP turns out to be wrong, stop and write a short note in `docs/workflow-overhaul/DEVIATIONS.md` before deviating.
6. **Never touch the user's running server (port 3100) or the real DB directly.** Use the isolated test setup described in `PHASE-00-baseline.md` WP-0.3.

---

## 1. What the product owner asked for, and where it is answered

| # | Request (paraphrased) | Answer in this plan |
|---|---|---|
| R1 | Streamline how a workflow is invoked across all clients | PHASE-04: one `InvocationRequest`, `WorkflowInvocationService`, `POST /api/workflow-invocations`, one client-core method used by web, desktop, mobile, CLI, TUI, SDK, MCP (remote mode) and automations; tools use it from P06. The two lifecycles are merged. |
| R2 | Streamline workflow creation, stages and config | PHASE-01: one schema package (`@generatorai/workflow-spec`) with derived mappers, an atomic graph save, versions, draft/publish and a canonical import/export. PHASE-02: one `SessionSpec` for chats and stages. PHASE-03: stage spec v2 with typed kinds. |
| R3 | A stage is a compact chat, so it gets every chat capability | PHASE-02: one `SessionComposer`, `PlatformToolBinder`, `GatePort`, `TurnRecorder` and `PermissionModeSource` for chat and stage. PHASE-03b: stage conversation API and UI (send, stop, attach, approve, answer, amend). PHASE-04: runs on the chat mount model. |
| R4 | Evaluate DAG scheduling; retry on failure; loops (fix → review → fix until approved, under a turn budget) | README §5.1 (evaluation). PHASE-03: CAS state machine, per-run actor, error classes, retry v2 with resume, repair turns, pause-on-exhaustion, split timeouts, budgets. PHASE-05: a **generic** loop (any body sub-graph, typed exit rules with streaks, carried state, budget and wrap-up, stall rules). Fix/review (L1), test-until-green (L2), goal-seeking (L3), refinement (L4) and research-until-dry (L5) are editable **templates** built from it, plus map, sub-workflow, wait, `check`, joins and fork/rerun-from. |
| R5 | Research Codex goals and Claude Code dynamic workflows; support those workflow kinds | README §5.3 (18 workflow kinds and how each is supported). They are supported **as DAG constructs, never as slash or chat commands**. PHASE-05: generic loop/map templates (goal L3, adversarial verify M3, research-until-dry L5, completeness critic). PHASE-08: the judge-panel template and plan-then-execute; the script runtime is decision-gated (PD-21). |
| R6 | Remove legacy and backward-compat code | PHASE-01 WP-1.1–1.4 (purge, about 4–6.6k LOC). Each later phase deletes the code it replaces: the v1 engine and StartupRecoveryService in PHASE-03; the old run routes, WorkflowOrchestrator, legacy worktrees and MCP embedded mode in PHASE-04. §8 rules R-1..R-3 forbid shims; `check-no-legacy` enforces it. |
| R7 | Chat and the orchestrator can invoke workflows through tools | PHASE-06 WP-6.1–6.4: the workflow tool set (list, describe, run, check, respond-approval, cancel), bound through the shared binder to chat, orchestrator and stages, with lineage, depth, budget and permission ceilings. |
| R8 | A skill so any agent (GeneratorAI chat or orchestrator, Codex, Claude Code, any MCP client) can author workflows | PHASE-06 WP-6.5–6.9: `WorkflowAuthoringService` (validate, plan, draft), a generated skill bundle `generatorai-workflow-author`, MCP tools/resources/prompts with a remote mode, CLI `lint/plan/skill install`, and the in-app guide tool. |
| R9 | Review the earlier audit document fully | §4 below: corrections, gaps and new findings. |
| R10 | Evidence-backed, optimal recommendations | Every WP has a **Why this approach** paragraph citing code evidence and external references (E, G1 source lists). |
| R11 | A plan a coding agent can execute phase by phase | Phase files 00–09. Each has preconditions, a read-first list, WPs with file-level changes, tests, acceptance criteria, gate commands and a handoff checklist. |
| R12 | An independent critical review of the plan, incorporated | `REVIEW-LOG.md` (44 findings, each with a disposition) and §11. |

---

## 2. Principles (apply to every line of code in this plan)

1. **One source of truth per concept.**
   - One schema package defines every workflow, stage, edge, session, invocation and expression shape. Everything else derives from it: DB mapping, API validation, UI forms, JSON Schema, docs and the skill.
   - One composer builds every agent session.
   - One engine runs every run.
   - One invocation path starts every run.
2. **State transitions are data.** Every status change goes through `transition(from[], to, expectedVersion)` against a declared table (compare-and-set). Nothing else writes `status`.
3. **Desired state first.** Cancel and pause write the target state *before* aborting work. Executors re-check state after every turn.
4. **Runs are pinned.** A run executes an immutable definition version, and nothing it does reads live definition rows.
5. **Deterministic scheduling, non-deterministic work.** Deterministic scheduling means a pure `decide()`: no clock, no randomness, deterministic ids. Stage results are memoized by `(run, instance_path, attempt)`. Recovery never re-asks an LLM for a decision that was already recorded.
6. **Exhaustion is not success.** Budgets and retries that run out end in `paused` (for a human) or `failed`, never silently in `completed` (the Codex `budgetLimited` / Restate 1.5 model; E §C4, G1 §1.3).
7. **Agents propose, humans publish.** Agent-authored workflows are drafts. Machine-sourced prompts are never consent (Claude Code workflow guardrails; G1 §5).
8. **Parity by construction, not by copy.** Chats and stages share code paths, so a capability added to one appears in the other.
9. **Delete, don't deprecate.** No `@deprecated` aliases, no adapters, no "legacy" branches. The DB is migrated forward once per phase that needs it. The developer's chats are preserved; workflow run history may be dropped.

---

## 3. Target architecture

```
                      ┌───────────────────── @generatorai/workflow-spec (zod, pure) ─────────────────────┐
                      │ SessionSpec · WorkflowSpec · StageSpec(kind: agent|loop|map|subworkflow|wait)      │
                      │ EdgeSpec · Expression v2 (parse/typecheck/eval/render) · validateWorkflow · plan   │
                      │ InvocationRequest · RunCommand · JSON Schema export · state-machine tables (data)  │
                      └───────────────▲──────────────────────────▲──────────────────────────▲──────────────┘
                                      │ derive                   │ derive                   │ generate
   web/desktop · mobile · CLI/TUI · SDK · MCP · automations · chat tools · stage tools      skill bundle, docs,
                      │                                                                      JSON Schema
                      ▼
      POST /api/workflow-invocations ──► WorkflowInvocationService.invoke()  (validate · idempotency · lineage
                                                     │                        · permission ceiling · plan)
                                                     ▼
   RunSupervisor ─► RunActor(runId) [serial mailbox] ─► decide(graph, state, msg, now) ─► RunStore.apply (1 sync tx, CAS)
        ▲  ▲  ▲                                                                               │ effects after commit
        │  │  └ TimerService (retry/wait/ttl)                                                 ▼
        │  └── LeaseReaper (15 s backstop)                      launch ─► AdmissionController ─► StageExecutor
        └───── attempt_settled / usage_tick ◄────────────────────────────────────────────────────┘      │
                                                                                                        ▼
                                  SessionComposer.compose(owner = chat | stage)  ◄── ChatManagementService
                                   ├ PlatformToolBinder (browser · computer · widgets · custom · orchestrator · workflows)
                                   ├ resolveMcp (hub, secretref) · agent projection · workspace exposure
                                   ├ GatePort (permission · question · planReview · recordPlan) via TurnContextRegistry
                                   └ PermissionModeSource (chat row | run row | deployment posture)
                                                     ▼
                                   MultiHarness → claude-agent · copilot · codex · opencode · acp
   Lifecycle phases run inside run states:  starting = workspace/worktrees/uploads/preprocess/sandbox
                                            finalizing = compensation · onExit · commit/push/PR (journalled effects)
   Outbox → StreamBroker (run scope, awaited) → mux SSE → web/mobile/TUI run pages; chat run cards
```

---

## 4. Review of the earlier audit document

The earlier document is `docs/workflow-audit/WORKFLOW-AUDIT-2026-09.html`, published as an artifact.

### 4.1 What still holds

- The 49 register items are correct as stated. The following were confirmed again this round, by source re-read in G2–G5 or by live evidence:
  - W-01, W-02, W-03, W-04, W-06 (reserved `__` variables);
  - W-08 (event routing: G3 §0.3 found the same, and also that the orchestrator's validation report is always empty);
  - W-09, W-10, W-13, W-16, W-17, W-18, W-20..W-25.
- The three root-cause patterns hold: hand-carried fields, unconditional transitions, and the split lifecycle. G3 adds a fourth structural duplicate: **two composition roots** (server vs SDK). Several "fallback when a dependency is missing" paths are live only in SDK mode (G3 §0.4, 5.11).
- The benchmark conclusions (step memoization, pinned versions, rerun-from-stage, pause-on-exhaustion) are unchanged. G1 strengthens them with Codex goals and Claude Code workflow semantics.

### 4.2 Corrections to the earlier document

| # | Earlier statement | Correction |
|---|---|---|
| C1 | Its Phase 0 proposed interim patches: FK `ON DELETE SET NULL`, "interim: read from snapshot", ordering fixes in the v1 executor | They conflict with the no-back-compat directive and would be thrown away when the engine is replaced. This plan applies each fix **once, in its final form**. The v1 executor gets only the changes needed to keep it runnable until PHASE-03 replaces it. |
| C2 | Chat → workflow tools were listed as a Phase 3 "differentiator" | They are a core requirement (R7). Moved to PHASE-06, right after the invocation path they depend on. |
| C3 | "Keep the poll as a 30 s backstop" | Now 15 s: a lease reaper plus a recovery tick, not a scheduler (G5 D4). |
| C4 | The loop was sketched as "loop block with maxIterations" | Fully specified in G5 §2: a structured loop block, per-iteration `instance_path`, `sessionReuse: continue` for the generator and `fresh` for the evaluator, a feedback binding, budgets, pause-on-exhaustion, and operator commands. Back-edges were evaluated and rejected, with reasons. |
| C5 | Session mode `single`/`per-stage`/`auto` treated as a fixable run setting | It is replaced. Each stage gets `sessionReuse: fresh | continue` plus an optional `sessionGroup` for stages that should share one conversation. A binding-key check rebinds or refreshes when configs differ (G5 §2.7, G2 §3.5). |
| C6 | W-24 grouped the dead controls together | G3 corrects the sub-audits: `selectedArtifacts`, `defaultAgentRef`, `createWorktrees` and stage `variables` are **not** live. The Widget tab is dead because no stage producer exists (G3 §1.3, 1.9, 1.12, 1.13, 2.2.19). |
| C7 | W-19 "needs one live confirmation on Claude" | Still open. It becomes an explicit test in PHASE-02 WP-2.7 (Claude and Codex stages honour the run's permission mode). |
| C8 | The earlier document had no coverage of invocation-path detail, a legacy inventory, dynamic workflow kinds or an authoring skill | Added in this round (G1–G5) and planned in PHASE-01/04/05/06/08. |
| C10 | Evidence errors found by the independent review | G3_part_db's claim that `migrations.lock.json` exists is false (P00 now creates it). G5 §6.3's "`chat_messages` cascades" is false under `disableForeignKeys` (migrations now delete children explicitly). The claim "skill files are never read by the model" held only for one file (P06 corrected). The OTel work was not greenfield (P07 corrected) |
| C9 | Stats tile: "23 verified" | Unchanged for W-01..W-49. The new items W-50..W-66 are code-traced by G2–G4. Items marked "reproduced" in G3 were reproduced in memory. |

### 4.3 New findings in this round

These are not in the earlier register. Each is closed by the plan.

| ID | Sev | Finding | Evidence | Closed in |
|---|---|---|---|---|
| W-50 | P2 | Chat create and resume builders have drifted: `systemPromptAppend`/`maxTurns` are forwarded only on resume, and list-field precedence flips after a restart | G2 §0.1 (CMS:1760 vs 2290-2304, 1776-1787 vs 2293/2303) | PHASE-02 WP-2.4 |
| W-51 | P2 | Stage agent `projection: replace` wipes the workflow author's whole system message, and agent instructions are appended **before** platform blocks (chat appends them last) | G2 §0.2 (SES:454-470, 1244-1254) | PHASE-02 WP-2.4 |
| W-52 | P1 | Stage team mapping drops `tools`, `disallowedTools`, `maxTurns`, `permissionMode` and `reasoningEffort` for sub-agents, so a restricted team member is unrestricted inside a stage | G2 §0.2 (SES:445-451 vs CMS:1418-1429) | PHASE-02 WP-2.4 |
| W-53 | P1 | The chat permission handler never enforces agent tool-group policy; it relies on `excludedBuiltinTools`, which is advisory on Copilot | G2 table A5 (CMS:586-649; SES:694-699) | PHASE-02 WP-2.6 |
| W-54 | P2 | `HookBridge` is never wired in production (dead in chat too) | G2 T9 (`buildHookBridge` unassigned in composition-root) | PHASE-02 WP-2.2 |
| W-55 | P2 | A follow-up to a completed stage is silently dropped (its session was released), yet the review route marks the batch delivered | G2 §4.1 (SES:2991-2999; `routes/review.ts:282-288`) | PHASE-03b WP-3b.1 |
| W-56 | P2 | CLI `script run` sends `profile` (the server expects `profileName`) and reads `run.id` (the server returns `runId`) | G4 §1.1 #8 | PHASE-04 WP-4.4 |
| W-57 | P3 | CLI `--session-mode` values (`isolated`/`shared`/`continue`) are all rejected by the server | G3 2.2.28 | PHASE-01 WP-1.1 (option deleted; `session` is per stage now) |
| W-58 | P1 | The MCP server boots its own embedded core against `./generatorai.db`, which is a second executor on a different DB | G4 §1.1 #11; `mcp-server/src/cli.ts:28-34` | PHASE-04 WP-4.4 (remote mode; embedded mode deleted) |
| W-59 | P1 | Run retry drops the permission mode, so the retry runs with bypassPermissions | G4 §1.1 #15 | PHASE-04 (fork carries it) |
| W-60 | P3 | Scopes are inconsistent: a default paired phone can start orchestrated runs but gets a 403 on plain runs | G4 §1.1 auth | PHASE-04 WP-4.3 |
| W-61 | P2 | The SDK composition root lacks the durable engine, `scmFlow`, sandbox and admission, so the "absent dependency" fallbacks are live only in the SDK | G3 §0.4, 5.11 | PHASE-01 WP-1.3 |
| W-62 | P3 | The orchestrator's `stageValidationResults` report is always empty (global subscription) | G3 §0.3, 2.2.26 | PHASE-01 WP-1.1 (deleted) |
| W-63 | P2 | Automation `waitForRunCompletion` subscribes after its fast path (it can miss the terminal event), ignores `awaiting_input` (burns 2 h), and returns before post-processing | G4 §2.1 | PHASE-04 WP-4.2 (`waitFor` on `finalized`) |
| W-64 | P1 | Import is non-strict and silently drops accepted fields. DAG errors come back as prose. There is no stateless validate, no plan/dry-run and no JSON Schema | G4 §3.1 gaps 1-8 | PHASE-01 WP-1.7, PHASE-06 WP-6.5 |
| W-65 | P2 | The web run page and the web run start cannot set a permission mode; the UI says "always bypass" | G4 §1.2; D §c | PHASE-03b WP-3b.2, PHASE-04 WP-4.5 |
| W-66 | P2 | Two concurrency gates exist on stage launch (Semaphore(8) + admission lane), both needing pause/resume around HITL, plus a hidden claude-agent 4-turn cap | G3 5.8; F O-2 | PHASE-03 WP-3.5, PHASE-07 WP-7.2 |

---

## 5. Evaluation summary (the "why" behind the design)

### 5.1 DAG scheduling today

What to **keep**:
- the pure readiness and reconcile core;
- the frozen topology snapshot;
- the idempotent claim;
- the per-run FIFO lock;
- the durable turn journal.

Live runs confirmed the scheduling *logic* is correct: joins, AND/OR/NOT, skip cascade and a 25-stage DAG, with scheduler overhead of about 3% (F T1/T2/T10).

What to **replace**:

| Weakness | Evidence | v2 fix |
|---|---|---|
| Routing depends on a 3 s poll (terminal events go to the wrong channel) | B-1 | Per-run actor mailbox (PHASE-03) |
| Validation and backoff run inside the tick | B-1 | Validation runs in the executor (`validating` state); backoff is a durable timer |
| No compare-and-set, and status is written before validation | B-2, B-3, F-1, F-5 | `transition()` with CAS and new states |
| Veto join; failure masking by `always`/`on_completion` | B-16, B-18 | Join policies; only failure-handler edges absorb a failure |
| No loops, maps or sub-workflows (status keyed by definition id) | G5 §1.2 | Instances keyed by `instance_path` |
| Retries restart from step 0 and are unclassified; one shared budget; not cancellation-aware | B §c, O-8 | Error classes, resume mode, a separate repair budget |
| The heartbeat measures process liveness, not progress | B-2, B-8 | Lease stamped inside the CAS, plus a progress watchdog |
| A crash mid-turn completes the stage with empty output | B-10, F-3 | `interrupted` → `paused` unless the journal proves the turn settled |

### 5.2 Why these designs (short form; each phase file has the long form)

- **Structured loop block, not back-edges.**
  - It keeps every acyclic invariant (readiness, skip cascade, terminal status, layout).
  - It gives unique per-iteration memo keys by construction, avoiding the Mastra #24044/#24581 collision class.
  - It makes the budget a property of one entity.
  - It reuses the container machinery that map and sub-workflow need anyway.
  - Precedents: Mastra `.dowhile`, ADK `LoopAgent`, Anthropic's evaluator-optimizer.
  - Back-edges (LangGraph/Step Functions) need strongly-connected-component re-arming and non-local OR-joins, the BPMN OR-join problem (G5 §2.2).
- **Per-run actor plus a pure `decide()` plus a single synchronous SQLite transaction.**
  - The engine is a declarative DAG interpreter of expensive, non-replayable steps, so step memoization is the right durability model (DBOS, Inngest, Cloudflare) and event-sourced code replay (Temporal) is not (E §1).
  - better-sqlite3 transactions are synchronous. A serial mailbox per run needs no lock manager, and the CAS makes executor and actor races lose cleanly (G5 §5).
- **Error classes, resume-by-default retries and pause-on-exhaustion.**
  - Restate 1.5 pauses on exhausted retries; Inngest has `NonRetriableError` and `RetryAfterError`; Temporal has non-retryable types; Step Functions has `JitterStrategy: FULL` (E §C).
  - Resuming keeps settled turns, so the expensive LLM work is not paid for twice.
- **Typed outputs through a `submit_output` tool, validated with ajv, plus a repair turn.**
  - Claude Code `agent({schema})` retries 5 times; Codex has `--output-schema`; OpenAI has `output_type`; Mastra has step schemas (G1 §2.2, §1.4).
  - This fixes F-6/F-7 (validation read the wrong text) and enables typed conditions, loop exits, maps and votes.
- **One SessionComposer for chat and stage.** Three builders exist today and have already drifted into bugs (W-50..W-53). Extracting the chat path, which is documented as canonical, keeps the chat prompt-cache prefix byte-identical (G2 §3).
- **One invocation service with server-derived triggers, idempotency and lineage limits.**
  - Seventeen entry points and two lifecycles exist today (G4 §1.1).
  - Idempotency and lineage follow Restate/Trigger.dev idempotency keys and Claude Code's "machine-sourced prompts are not consent" rule (E §A3, G1 §5).
- **The authoring skill is generated from the schemas and ships through three channels** (in-app tools and guide, the skill directory for Claude Code/Codex, MCP resources). Agent Skills best practice is plan → validate → execute, with verbose validators and bundled scripts (G1 §3). Skill files are never read by the live model inside GeneratorAI, so knowledge must travel in tool descriptions (G4 §3.1).

### 5.3 Workflow kinds: before and after

Source: G1 §6.

| # | Kind | Today | After the plan | Where |
|---|---|---|---|---|
| 1 | Static fan-out / fan-in | Yes | Yes, plus join policies (all / any / N-of-M, cancel losers) | P3/P5 |
| 2 | Linear with human sign-off | Yes | Yes, plus `wait: approval` with timeout routing | P5 |
| 3 | Map over a runtime list | No | `map` stage (cap, concurrency, tolerated %, per-item redrive) | P5 |
| 4 | Per-item pipeline, no barrier | No | Map body sub-DAG; each item scope is independent | P5 |
| 5 | Enforced structured output + retry | Partial | OutputContract + `submit_output` + repair | P3 |
| 6 | Adversarial verify / vote | No | Nested map + `count` projection (example M3) | P5 |
| 7 | Judge panel / best-of-N | Partial | Preset: map over angles (mount per item) → judge → apply winner | P8 (presets, not gated) |
| 8 | Iterate-until-pass (fix ↔ review, test until green, refine until score) | No | **Generic loop** (any body sub-graph, typed exit rules, carry, budget, stall); examples L1/L2/L4 are templates, not features | P5 |
| 9 | Loop-until-dry | No | Generic loop + `carry` accumulator + `until {consecutive: 2}` (example L5) | P5 |
| 10 | Goal-seeking (the concept behind Codex goals; **as a DAG loop, not a command**) | No | Generic loop over a continuing work stage plus a fresh assess stage; exit rules (complete on met, fail on impossible, pause on the same blocker for 3 rounds, exhaust on no progress); budget wrap-up (example L3) | P5 |
| 11 | Parallel mutation with isolation | Partial | `map.workspace: mount_per_item` (checkpoint at fan-out) + merge strategy | P5 |
| 12 | Budget-bounded exploration | Partial | Stage, loop and run budgets (turns / $ / tokens / wall clock) exposed to expressions | P3/P5 |
| 13 | Resume, reusing completed work | Partial | Memoized attempts + fork/rerun-from-stage | P3/P5 |
| 14 | Nested / composed workflow | No | `subworkflow` stage (version-pinned, depth ≤ 3) + `run_workflow` tool | P5/P6 |
| 15 | Completeness critic → next round | No | Generic loop; the critic's gaps are carried into the next iteration's follow-up prompt | P5 |
| 16 | Agent authors the workflow, then runs it | Partial | Authoring tools + skill + draft/publish + dry-run + approval | P6 |
| 17 | Scheduled / recurring | Yes | Yes, through the single invocation path | P4 |
| 18 | Dynamic script workflow (Claude Code model) | No | Covered by an agent authoring a graph (skill) + plan-then-execute expansion. A full sandboxed script runtime with structural replay is **gated** (PD-21) | P6/P8 |

---

## 6. Phase map

| Phase | Title | Est. | Depends on | Delivers | Closes |
|---|---|---|---|---|---|
| 00 | Baseline and safety net | 1 wk | none | Backup and definition export; run-worktree cleanup; testkit (FauxProvider workflow harness); isolated E2E harness (advisory live gate); golden session snapshots; lint invariants; **migration lock and fresh-DB baseline mechanism** | none (enables everything) |
| 01 | Spec v2, legacy purge, definition model | 3 wk | 00 | `@generatorai/workflow-spec` with the **final** v2 shapes (SessionSpec, StageSpec v2, EdgeSpec v2, Expression v2 + templating sugar, state tables, validator with an engine capability gate, JSON Schema); v1 session/webhook stack and dead fields deleted; required deps in `createCoreServices`; document store + atomic versioned graph save + versions + draft/publish + canonical import/export; builder on v2 (behaviour only); migration v55, which converts definitions once and drops run history | W-03, W-04, W-05, W-13 (definitions), W-20..W-26, W-28, W-30, W-31 (grammar), W-35, W-38, W-45, W-57, W-61, W-62, W-64 (import) |
| 02 | SessionComposer: a stage is a compact chat | 2.5–3 wk | 01 | One composer, binder, gate ports, turn recorder, permission source for chat and stage; provider capability levels; Claude skills via plugins; MCP hub for stages; unattended permission defaults; agent-host IPC; migration v56 (message completeness, automation permission) | W-07, W-18, W-19, W-36, W-40, W-50..W-54 |
| 03 | Engine v2 (core and cutover) | 5–6 wk | 02 | CAS state machines, fenced RunStore, actor/supervisor with a single-engine lock, `decide()`, StageExecutor, error classes, retry v2, repair, native/tool/fallback structured output, leases, timers, outbox, recovery, budgets, commands API, `forkRun`; migration v57; v1 engine deleted; the engine gate flips to v2 | W-01, W-02, W-08, W-09, W-11, W-12, W-14..W-17, W-29, W-32, W-39, W-41, W-46..W-48, W-59, W-66 |
| 03b | Stage conversation and run page | 2 wk | 03 | Send, stop, attach, gate cards and amend for stages; stage "…" menu; run-page permission control; streaming correctness and cost fixes | W-27, W-33, W-55, W-65 |
| 04 | One lifecycle, one invocation path | 2.5–3 wk | 03 | Lifecycle phases in `starting`/`finalizing` on **MountService**; `WorkflowInvocationService`; one route and client method; every client migrated; old routes deleted; MCP remote mode with `mcp` device pairing (embedded mode deleted); migration v58 | W-06, W-10, W-22, W-23, W-37, W-56, W-58, W-60, W-63 |
| 05 | Control flow as generic DAG building blocks (5A + 5B) | 6.5 wk | 04 | 5A: grammar delta, deterministic `check` stage (works on Windows), generic `loop` (any body, exit-rule list with streaks and precedence, simultaneous carry, explicit evaluation contexts, signals, budget + wrap-up instance, accept-best, operator commands). 5B:; `map` (mount per item, atomic merges); `subworkflow`; `wait` (approval/event/timer via commands); deterministic `check` stage; judge rule; fork/compensation/join UI; expression editor; templates (fix/review, test-until-green, goal, refine, research-until-dry, fan-out, approval) that are **plain graphs**; **no slash or chat commands**; migration v59 | R4; kinds 3/4/6/8/9/10/11/13/14/15 |
| 06 | Agent integration and authoring skill | 2–3 wk | 04, 05 | Workflow tools for chat/orchestrator/stages; chat run cards; approval service; authoring service; generated skill bundle (staged as a real skill where supported); MCP tools, resources and prompts; CLI lint/plan/publish/skill install; migration v60 | R7, R8, W-64 |
| 07 | Economy, flow keys, tracing alignment, UX | 1.5–2 wk | 05 (parallel with 06) | Turn economy; explicit flow keys; budgets and cost UI (provider-reported); alignment of existing tracing to GenAI conventions; UX gaps | W-42 (measured), W-49, W-66 |
| 08 | Dynamic script workflows + advanced patterns | **gated (PD-21)** | 05, 06 | Judge-panel/best-of-N template and plan-then-execute (recommended); QuickJS script runtime with structural replay (only if PD-21 says yes); run diff, pinned-data tests, cache (backlog) | kind 7; 18 if gated in |
| 09 | Release gate | 1 wk | all shipped phases | Full testkit and live suite; security review; docs from source; register reconciliation; resource budgets | residuals |

About 28–34 engineer-weeks for P00–P07 plus P09. P08 is decision-gated. P07 may run in parallel with P06.

---

## 7. Global phase gate (every phase must pass before its PR merges)

Run all of the following from the repo root.

1. `pnpm install --frozen-lockfile`
2. `pnpm turbo typecheck`. Composite packages must use `tsc --build --force`; `--noEmit` gives false greens (memory: turbo-typecheck-composite-projects).
3. `pnpm turbo test --concurrency=2`. The suite is flaky under parallel load on this machine. Re-run a lone failure alone before believing it. The known Windows symlink EPERM test is allowed to fail and must be listed in the PR.
4. `pnpm lint`. This includes `check:durability`, `check:security`, `check:docs` and the new `check:workflow-invariants` from PHASE-00.
5. **Hard gate:** the phase's testkit scenarios (FauxProvider, deterministic). **Advisory:** the live E2E, `pnpm workflow:e2e --phase NN` on the isolated server, retried up to 2 times on failure, with the report attached (RV-35).
5b. **Fresh-DB check:** `migrateDB` on an empty file reaches head through the baseline, and the result matches `schema.ts`. A backup copy of the developer DB also migrates cleanly (RV-2).
6. `node scripts/check-no-legacy.mjs`, added in PHASE-00. It greps for banned identifiers that the phase has removed (the list grows per phase) and for `@deprecated`, `legacy`, `backward compat` or `fallback for old` comments in the workflow module.
7. Update `docs/workflow-overhaul/STATUS.md`: check off the WPs and register IDs closed.

---

## 8. Rules for the coding agent (non-negotiable)

- **R-1 No compatibility shims.**
  - No `@deprecated` re-exports and no alias fields.
  - No "read v1, write v2" adapters. No old routes returning `Deprecation` headers; old routes are deleted.
  - No feature flags that keep an old path alive. When a WP replaces something, the old thing is deleted in the same WP.
- **R-2 No half-migrated call sites.**
  - A WP that changes a shape updates **every** caller in the monorepo in the same commit: web, desktop, mobile, CLI, TUI, SDK, mcp-server, client-core, templates, tests and docs.
  - Use `pnpm turbo typecheck` to find them, not grep alone.
- **R-3 Migrations are forward-only and chat-safe.**
  - **Never edit the legacy bootstrap block.** Fresh DBs use the generated `baseline.sql` (P00 WP-0.6b); every migration regenerates it and bumps `BASELINE_VERSION`.
  - Every migration updates `schema.ts`, adds its hash to `migrations.lock.json` (created in P00), and keeps its own **frozen schema copies** under `migrations/vNN/`. Migration code never imports live schemas (RV-33).
  - Deletes run with foreign keys **off**, so children are deleted **explicitly**. Never rely on `ON DELETE CASCADE` inside a migration (RV-1).
  - Every migration uses `disableForeignKeys: true` whenever it rebuilds a table.
  - Every migration carries a test that builds the previous-version DB, including chats and stage sessions, migrates it, and asserts chat rows, messages and sessions are unchanged.
  - Deletes filter on `owner_type`/`scope`, never on "not a chat".
- **R-4 Every status write goes through `transition()`,** from PHASE-03 onward. A lint check enforces it.
- **R-5 No blind waits, no fire-and-forget without an owner.** Every async side effect has an owner that awaits it or journals it (an outbox, a timer row, or the effect journal).
- **R-6 Schemas are strict and described.** `.strict()` on inputs, and `.describe()` on every field. The generated JSON Schema and docs must be regenerated (`pnpm generate:workflow-spec --check` in CI).
- **R-7 Tests first for semantics.** For each engine semantic (a transition, a precedence rule, a join policy), write the table/property test before the implementation.
- **R-8 Security defaults.**
  - Permission mode defaults to the deployment posture.
  - `__*` keys are never accepted from callers.
  - Command-bearing fields need an elevated scope.
  - Secrets are `secretref:` only.
  - Stage-to-stage context is fenced as untrusted.
- **R-9 Environment gotchas.**
  - The repo is under OneDrive: atomic rename can EPERM, so use the existing `writeFileAtomicRestricted` helper.
  - Keep test paths short (use `C:/gaiwf/…`); deep paths break git.
  - Two dev servers cannot share a DB or vault.
  - Installed Chrome refuses CDP, so use the Playwright-bundled Chromium path from memory.
- **R-10 Keep the chat prompt-cache prefix stable.** Tool order and system-block order for existing chat configurations must stay byte-identical unless a WP says otherwise. Golden snapshots enforce this (PHASE-00 WP-0.5).

---

## 9. Product decisions (defaults the plan uses; change any before the phase starts)

| # | Decision | Default in this plan | Alternative | Phase |
|---|---|---|---|---|
| PD-1 | Loop model | One **generic** structured loop block; scenarios are templates; no slash/chat commands | Back-edges with a per-edge max | 05 |
| PD-2 | Loop or retry exhaustion | **Pause** for a human; unattended runs fail after `pauseTtl` 72 h and notify | fail / accept_last | 03/05 |
| PD-3 | Message sent to a stage while it is mid-turn | Refuse with 409 `STAGE_BUSY` (chat parity) | Queue as the next operator turn | 03 |
| PD-4 | Follow-up on a completed stage | **Amends** that stage's output; successors are not re-run automatically; the UI offers "Re-run downstream" (fork) | Auto-fork | 03 |
| PD-5 | Computer use in stages | Opt-in per stage; refused when the run is bypass | Off entirely | 02 |
| PD-6 | Can a default paired phone start runs? | Yes (`exec:agent` + `read:workflows`); authoring still needs `write:workflows` | Require `write:workflows` | 04 |
| PD-7 | Durable sleep | Deleted; replaced by `wait {type: timer}` | Keep a `sleep` API | 01/05 |
| PD-8 | Automation input modes | Keep the schema-driven `dataSchema` + IterationPlanner; delete the legacy single/loop/batch/script modes | Keep both | 01 |
| PD-9 | HITL feedback paths | One: the completion-review loop plus the stage conversation API; the route-injected follow-up is deleted | — | 03 |
| PD-10 | `waitForCompletion:false` prompts | Deleted (always wait) | Keep with an explicit "fire and forget" stage kind | 01 |
| PD-11 | Definition-level `skills`/`agents` | Deleted; use `session.agentRef` / `agentOverrides` | Wire them | 01 |
| PD-12 | `RunLogger` JSONL | Deleted | Keep as an export feature | 01 |
| PD-13 | Run history at the engine migration | Dropped. Definitions, automations and chats preserved; DB backed up first | Export runs to JSON first | 03 |
| PD-14 | Agent-authored workflows | Draft only; publish needs a human principal (`allowAgentPublish` admin setting, default off) | Auto-publish | 06 |
| PD-15 | Dynamic script workflows | Ship in P8 behind the `write:workflows` + `admin:settings` scope to create; the sandbox is QuickJS (no I/O) | Skip | 08 |
| PD-17 | Permission modes per provider gating level | `per_call` allows all; `exec_and_patch` (Codex) allows default/acceptEdits with a warning, and plan via the read-only sandbox; `none` (opencode) refuses default/plan | Refuse everything that is not per-call | 02 |
| PD-18 | Default permission for unattended runs | Automations **must** declare one (UI default `acceptEdits`); bypass on webhook-triggered automations needs an admin-scoped opt-in; CLI/SDK without a mode use the deployment posture | Force explicit on every trigger | 02 |
| PD-19 | Order vs the in-flight UI redesign | The overhaul lands data, API, stores and **behaviour** with existing components; the redesign reskins once afterwards | Pause the overhaul UI until the redesign lands | all UI WPs |
| PD-20 | Chat API/storage change to `session` | **No.** Share the `SessionSpec` type internally; chat columns and wire shape stay | Fold chats into a JSON `session` | 02 |
| PD-21 | Ship the dynamic script runtime (P08 WP-8.1/8.2/8.8)? | **Deferred.** Decide after P06 with usage data; the presets and expansion ship regardless | Ship it in P08 | 08 |
| PD-22 | MCP remote credential | Device pairing with platform `mcp` (reuses pairing and the keychain) | Build service-account issuance | 04 |
| PD-23 | Workflow tools in plain chats | Opt-in (agent grant or a chat tool toggle); on for orchestrators | On by default (one-time cache miss plus a per-turn token cost) | 06 |
| PD-16 | `.workflow.mjs` authoring scripts | Keep them as authoring-time builders that compile to the canonical spec; there is exactly one materializer (`createFromSpec`) | Delete the builder SDK | 01 |

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Instance | A `stage_runs` row for one node in one scope (`instance_path`, e.g. `review_loop#2/fix`) |
| Attempt | A `stage_attempts` row: one execution try of an instance, in `fresh`, `resume` or `restart` mode |
| Scope | A container's child context: one loop iteration, map item, sub-workflow or expansion |
| Decision | Output of the pure `decide()`; applied atomically by `RunStore.apply` |
| Composer | `SessionComposer.compose()`, which builds the conversation params for a chat or a stage |
| Invocation | One call of `WorkflowInvocationService.invoke()`, which creates exactly one run (or replays an idempotent one) |
| Finalized | The run event after post-processing and compensation. Waiters key on it, not on `completed` |

---

## 11. Independent plan review log

The plan was audited by an independent reviewer agent: 44 findings, two of them blockers, both in the DB migrations. Every finding and its disposition is in `REVIEW-LOG.md`. The phase files reflect the accepted changes. Structural changes that resulted:
- spec v2 moved into P01 (one conversion, one builder);
- run history is dropped once;
- explicit child deletes in migrations;
- a fresh-DB baseline and the migration lock;
- workflows moved onto MountService;
- MCP remote mode moved to P04;
- P03 split into 03 and 03b;
- P07 trimmed and P08 gated.
