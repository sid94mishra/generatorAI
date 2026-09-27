# Independent plan review: log and dispositions

- **Reviewer:** an independent agent with no authorship stake. It was instructed to be skeptical, evidence-driven and read-only.
- **Input:** plan v1.0, the evidence A–G5, the audit HTML and the codebase at `desktop_redesign` @ `a83a7bf`.
- **Full review text:** `docs/workflow-audit/evidence/H_plan_review.md`.
- **Verdict on v1.0:** "not ready to hand to a coding agent"; 2 blockers and about 22 majors. The architecture direction was judged sound.

**Outcome:**
- **41 accepted** and implemented in plan v1.1.
- **3 modified** (accepted in intent, solved differently): RV-24, RV-25, RV-36.
- **0 rejected.**

| RV | Sev | Finding (short) | Disposition | Where it is fixed |
|---|---|---|---|---|
| RV-1 | B | v57 relied on cascades while foreign keys were off | **Accepted.** All purges delete children explicitly through a `purge_sessions` temp table, with a test asserting the exact message delta and a clean `foreign_key_check` | P01 WP-1.6 step 4; P03 WP-3.2; README R-3 |
| RV-2 | B | Editing the bootstrap breaks fresh installs (v11 references legacy tables) | **Accepted.** A fresh-DB `baseline.sql` plus `BASELINE_VERSION`; the legacy bootstrap is never edited; fresh-DB and legacy-path tests | P00 WP-0.6b; README R-3, gate 5b |
| RV-3 | M | `migrations.lock.json` does not exist | **Accepted.** Created in P00 with a lint | P00 WP-0.6b |
| RV-4 | M | REVIEW-LOG missing, yet R12 claimed closed | **Accepted.** This file; status is v1.1 | README header, §11 |
| RV-5 | M | P03 criterion unmeetable; terminal events needed by orchestrator/automation until P04 | **Accepted.** An event-contract clause plus a regression test; the grep criterion was fixed | P03 WP-3.6, acceptance |
| RV-6 | M | Codex `fullToolGating:false` contradicts the W-19 test | **Accepted.** `approvalGating` levels plus PD-17 rules; per-provider W-19 expectations | P02 design, WP-2.7; README PD-17 |
| RV-7 | M | The Claude skill mechanism was wrong ("project source limited to a dir") | **Accepted.** A local plugin root via SDK `plugins`, keeping `settingSources: []`, with a test that repo hooks are not loaded | P02 WP-2.4 |
| RV-8 | m | "Skill files never read" was over-generalised | **Accepted.** Skills are staged where the provider supports them; capability flags corrected | P02 WP-2.4; P06 design 5 |
| RV-9 | M | `submit_output` needs host tools; the native structured output was ignored | **Accepted.** `hostTools` and `structuredOutput` capabilities; strategy order native → tool → final block; Codex resume caveat; binding exemptions | P02 design; P03 WP-3.5; P06 acceptance |
| RV-10 | M | "Message exists = settled" conflicts with partial persistence | **Accepted.** A `complete` flag on messages; unsettled turns are always interrupted | P02 WP-2.9; P03 WP-3.5 |
| RV-11 | M | Prefix replay by global sequence is unsound under `pipeline()`/`parallel()` | **Accepted.** Replay by structural call path; P08 gated | P08 design 3; README PD-21 |
| RV-12 | M | Runtime-built stage specs bypass the command-field checks | **Accepted.** A call-time `DynamicStageSpec` clamp | P08 design 5 |
| RV-13 | M | Three definition encodings and builder rebuilds (throwaway work) | **Accepted.** Spec v2 lands in P01, with one conversion and one builder, plus an engine capability gate | P01 design 2–3, WP-1.5, WP-1.6 |
| RV-14 | m | Historic runs converted in v55, then dropped in v57 | **Accepted.** Run history is dropped in v55 | P01 WP-1.6 step 4 |
| RV-15 | M | Bare `{{var}}` in every prompt is rejected by Expression v2 | **Accepted.** Templating sugar: bare `{{x}}` means `variables.x`, plus reserved roots | P01 design 4 |
| RV-16 | M | `repo_path_*` stays caller-overridable (W-06 incomplete) | **Accepted.** A typed read-only `run.codebases.*` scope; reserved-prefix names rejected; no interpolation in commands | P01 design 5, WP-1.6 step 6 |
| RV-17 | M | Columns used but never migrated; ambiguous numbering | **Accepted.** An authoritative migration table (v55–v62), and each migration WP lists its columns | STATUS.md; P02 WP-2.10; P03 WP-3.2; P05 WP-5.1 |
| RV-18 | M | The chat storage fold into JSON `session` is unnecessary and risky | **Accepted.** Chats keep their columns; the type is shared internally (PD-20) | P02 design; README PD-20 |
| RV-19 | M | The chat mount model was ignored; legacy worktrees kept alive for runs | **Accepted.** Runs use MountService; legacy run worktrees deleted; map uses per-item mounts | P04 design 7; P05 design 4 |
| RV-20 | m | Interim single-mode rebind in P02 | **Accepted.** Cut; the rebind lives once in P03 `run_sessions` | P02 WP-2.8; P03 WP-3.5 |
| RV-21 | m | ReDoS guard missing | **Accepted.** `re2-wasm` plus save-time validation | P01 WP-1.5 |
| RV-22 | M | Automation legacy columns left alive; data semantics lost | **Accepted.** Converted in v55, unconvertible rows disabled and logged, columns dropped | P01 WP-1.4, WP-1.6 step 5 |
| RV-23 | m | MCP stays a second engine until P06; embedded fallback kept | **Accepted.** Remote mode in P04; embedded mode deleted | P04 WP-4.4 |
| RV-24 | M | Service-account issuance does not exist | **Modified.** Instead of building service-account issuance, reuse device pairing with a new `mcp` platform (PD-22). It is less new auth surface and uses the existing keychain storage | P04 WP-4.4; README PD-22 |
| RV-25 | m | Appending tools still busts the cache; tool cost on every chat | **Modified.** The claim is corrected, **and** workflow tools become opt-in for plain chats (PD-23) with a measured token delta | P06 WP-6.1, design 3; README PD-23 |
| RV-26 | m | Agent-host IPC not covered | **Accepted.** IPC for tools, gates, hooks and call context; contract tests with the agent host on and off; flow keys enforced in the agent host | P02 WP-2.2 step 8; P07 WP-7.2 |
| RV-27 | M | Run ownership and fencing unspecified | **Accepted.** Single-engine lock plus `owner_epoch` fencing in `RunStore.apply`; timers and reaper act on owned runs only | P03 WP-3.1, WP-3.6 |
| RV-28 | M | Per-item checkouts miss uncommitted upstream changes; merges race other writers | **Accepted.** Checkpoint commit at fan-out; the singleton merge key pulled into P05 | P05 design 4, WP-5.3 |
| RV-29 | m | Purging rows leaves git worktrees and branches in user repos | **Accepted.** A cleanup script required before v55/v57 | P00 WP-0.8 |
| RV-30 | M | Unattended runs stall after the bypass default is removed | **Accepted.** PD-18: automations must declare a permission mode, shipped in P02; the `DEFAULT_WORKFLOW_RUN_PERMISSION_MODE` constant deleted by name | P02 WP-2.7, WP-2.10 |
| RV-31 | m | Wrong README pointers; W-41 too coarse; unowned defects | **Accepted.** Pointers fixed; W-41 split into a–h with owners | README §4.3; TRACEABILITY |
| RV-32 | m | A new composition factory duplicates `createCoreServices` | **Accepted.** Dependencies made required in `createCoreServices` instead | P01 WP-1.3 |
| RV-33 | m | Migration tests against live schemas | **Accepted.** Frozen schema copies per migration | README R-3; P01 WP-1.6; P03 WP-3.2 |
| RV-34 | m | E2E folder contains device credentials | **Accepted.** Excluded and gitignored; credentials kept under `C:/gaiwf/creds/` | P00 WP-0.3 |
| RV-35 | m | Live LLM gates are flaky and costly | **Accepted.** Testkit is the hard gate; live runs are advisory with retries | P00 WP-0.3 step 6; README §7 |
| RV-36 | m | OTel was presented as greenfield | **Modified.** Kept as a small *alignment* WP (conventions plus engine metrics), not deferred entirely, because the run page's cost and usage views benefit from it | P07 WP-7.4 |
| RV-37 | M | UI rewrites collide with the in-flight redesign | **Accepted.** PD-19: behaviour with existing components; the redesign reskins later | README PD-19; every UI WP |
| RV-38 | m | Long-lived phase branches | **Accepted.** Merge green sub-milestones to the base branch | README §0.4 |
| RV-39 | m | Contradictory P07/P08 dependencies | **Accepted.** P07 after P05, in parallel with P06; P08 gated | README §6 |
| RV-40 | m | Claude Code caps misattributed | **Accepted.** Corrected, with our own caps chosen on merit | P08 design 4 |
| RV-41 | m | Unscheduled G2 parity rows | **Accepted.** T4/T7/P6/P7/R9 added; L9–L12 explicitly out of scope | P02 WP-2.2, WP-2.6, out-of-scope list |
| RV-42 | m | Unscheduled G3 items (5.17, 2.2.11, `sessions` columns) | **Accepted** | P01 WP-1.1, WP-1.4; P03 WP-3.6/3.7 |
| RV-43 | m | Codex native goal API not evaluated | **Accepted** as an optional provider optimisation | P05 design 3 |
| RV-44 | m | P03 estimate optimistic | **Accepted.** P03 re-estimated at 5–6 weeks and 03b split out | README §6; PHASE-03b |

## Deferred or cut per the review's §4
- **P08 dynamic script runtime:** gated (PD-21).
- **Run diff, pinned-data stage test, stage cache:** backlog inside P08.
- **Pricing table and stream-index rewrite:** cut from P07.
- **Interim P02 rebind, chat storage fold, v55 historic-run conversion:** cut.
- **`orchestrator_decisions` journal:** cut (idempotency keys suffice).
- **Mobile and TUI loop/map UI:** reduced to status rows and decision cards.

## Evidence corrections recorded
- **G3_part_db** claimed `migrations.lock.json` exists. It does not; P00 creates it.
- **G5 §6.3** said "`chat_messages` cascades" during a migration with FKs off. That is incorrect; deletes are now explicit.
- **G4 §3.1 / P06:** "skill files are never read by the model" holds only for the extension-author file.
- **E/P07:** OTel tracing already exists.

---

## Second review: Phase 05 (control flow), after the product owner's feedback

**Product owner's feedback:**
- the loop must be **generic**, not tied to review;
- show it with examples;
- re-review every part of the phase;
- **no slash commands**: everything is in the workflow pipeline and DAG.

**The first rework:**
- a generic loop (any body sub-graph, exit rules over typed outputs, carried state, signals);
- review, goal, test-until-green, refine and research-until-dry recast as **templates**;
- a deterministic `check` stage;
- events folded into the commands API;
- slash-command references removed (P07's `/` palette became a searchable "Add stage" menu).

**Independent review of that rework:** `docs/workflow-audit/evidence/H2_phase05_review.md`, with 5 blockers, 27 majors and 16 minors. Verdict: "direction right; not yet sound or executable". **All 48 findings were accepted** and implemented in the current PHASE-05:

| Area | Findings | Resolution |
|---|---|---|
| Loop semantics | P5-1, P5-2, P5-11, P5-12, P5-13 | Explicit T(k)/C(k)/E(k) contexts; **simultaneous** carry plus `loop.priorCarry`; per-stage signals; an `exits[]` list with actions and precedence (quick rows as builder sugar); null and error semantics; streak reset rules |
| Grammar | P5-3 | Grammar delta: list literals, `at`, `map`, `filter`, `some`, `every`, string `concat`, full expressions inside `{{ }}`, `loops.*` and `maps.*` scopes |
| `check` kind | P5-4, P5-5, P5-24, P5-44 | Full schema; Windows launch fix (reproduced ENOENT/EINVAL); launch failure fails the stage; counts as the `shell` capability (refused in plan mode, risk flag, admin scope); `check:global` flow key |
| Engine plumbing | P5-6, P5-7, P5-15, P5-16, P5-17, P5-18, P5-19, P5-32 | `capture_iteration_end` effect plus a settling phase; budget abort → exhaust; wrap-up as a real instance with its own allowance; own tree hash (no P07 dependency); automatic operator turn; deterministic digest; `loop_iterations` table; wall clock excludes parked time |
| Spec shape | P5-8, P5-9, P5-10, P5-30, P5-33, P5-34, P5-40, P5-45, P5-47 | `sessionReuse` enum kept plus `compactAfter`; per-kind field applicability; carry typing rules; revised validator codes; Budget `maxTokens`; PromptDefinition for wrap-up |
| accept_best | P5-14 | Scores stored per iteration; ties; all-null; restore all-or-rollback; `last` = chosen |
| Map | P5-20, P5-21, P5-22, P5-23, P5-48 | Results shape; index paths plus `item_key`; `forkFromSnapshot` (all-or-nothing); `itemSetup`; writer leases; conflict and PR semantics; `list`/`json` variable types |
| Sub-workflow | P5-25 | `workflowRef`; published only; `inherit` suppresses the child lifecycle; output drift check; all decision cards mirrored; approval service moved into P05 |
| Wait | P5-26, P5-41 | Event table with idempotency and consumption; per-wait callback tokens (no `exec:agent` for CI); unattended TTL |
| Examples | P5-29 plus the corrections | Every example rewritten with complete schemas; a test extracts and validates every JSON block |
| Process | P5-27, P5-28, P5-31, P5-35..P5-39, P5-42, P5-43, P5-46 | Expanded test matrix (judge, v59, Windows, nesting, commands); 6.5 weeks split 5A/5B; templates generated from presets; exact-name lint; CodeMirror as an allowed lazy-loaded dependency; CLI `--json` payloads; judge-rule details |
| Cross-file | 20 items | Applied: README R4/R5 and kinds table; P01 reserved roots, grammar pointer and env-only templating; P03 `turn_role` without CHECK and extensible commands; P04 trigger union; P06 approval service reuse and **no MCP prompts** (they appear as slash commands in Claude Code); P07 flow keys; P08 template claims; STATUS v57/v59 |
