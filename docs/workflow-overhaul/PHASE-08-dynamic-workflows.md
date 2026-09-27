# PHASE 08: Dynamic (script) workflows and advanced patterns [DECISION-GATED]

> **Status: deferred behind PD-21.** The independent review (RV-11, RV-12, §4) judged the script runtime to be over-engineering relative to the request. The request was to *research and assess* support for Claude Code-style dynamic workflows.
>
> **What ships without this phase:** after P05/P06, GeneratorAI already expresses workflow kinds 6, 9 and 15 through generic templates. Kind 7 (judge panel) needs this phase's WP-8.3. Kind 16 (an agent authors, then runs) is covered by the authoring skill. Kind 18 (a script decides what runs next) is approximated by *an agent authors a graph* plus *plan-then-execute expansion* (WP-8.4, which is **not** gated and may be pulled into P05 if needed).
>
> **Gate:** after P06 ships, review usage. Proceed with WP-8.1/8.2/8.8 only if the product owner confirms (PD-21). WP-8.3 (pattern presets) and WP-8.4 (expansion) are recommended regardless. WP-8.5–8.7 are backlog items.

**Goal:** support the "script decides what runs next" model of Claude Code dynamic workflows, alongside the declarative DAG. Ship the remaining advanced patterns:
- judge panel / best-of-N;
- adversarial verify;
- loop-until-dry;
- plan-then-execute expansion.

It also adds the differentiators the research found missing everywhere (run diff) or valuable while authoring (stage test with pinned data, opt-in stage cache).

**Estimate:** 3–4 weeks. **Depends on:** P05, P06. **Branch:** `wf/phase-08-dynamic`.
**Closes:** workflow kinds 6, 7, 9, 15, 16 and 18 (README §5.3). PD-15 applied.

## Read first
- `G1_goals_dynamic_workflows_research.md` §2 (the Claude Code workflow script API: `agent/parallel/pipeline/phase/log/args/budget/workflow`, determinism rules, caps, resume semantics, approval guardrails) and §6 rows 6, 7, 9, 15, 16
- `E_modern_engines_research.md` §E8 (dynamic DAGs, journalled decisions), §H6 (caching), §J2 (run diff opportunity), §K (pinned-data testing)
- `G5_scheduler_v2_loops.md` §4.7 (dynamic expansion)

## Design decisions
1. **`kind: 'dynamic'` workflows are deterministic scripts, run in a sandbox, whose only side effects are engine calls.** The script is plain JavaScript. It exports a pure-literal `meta` and runs with these host functions:
   - `stage(spec)`: runs one agent stage with an inline `StageSpec` (agent kind) and returns its typed output, or `null` on failure;
   - `parallel(thunks)` (a barrier) and `pipeline(items, ...stages)` (no barrier);
   - `workflow(ref, inputs)`: a sub-workflow, one level deep inside a dynamic script;
   - `phase(title)`, `log(msg)`;
   - `args`, the invocation variables;
   - `budget {total, spent(), remaining()}`, from the run budget.

   This mirrors Claude Code's API (G1 §2.2), so authors and agents can transfer knowledge.
2. **Sandbox: QuickJS** (`quickjs-emscripten`), in a worker thread. It has no `import`, filesystem, network or timers; `Date.now`, `Math.random` and arg-less `new Date()` throw; memory and CPU are capped per step. *Why:*
   - agent-authored code must not get host access;
   - Node `vm` is not a security boundary;
   - QuickJS gives deterministic, isolated execution in pure WASM with no native build on Windows.
3. **Durability is replay by structural call path** (corrected per RV-11). A global sequence number is unsound under `pipeline()`/`parallel()`, where calls complete in a non-deterministic order.
   - Each host call gets a **structural id**: the parent call id + the call-site ordinal inside that parent + the item index for `pipeline`/`parallel` fan-out (e.g. `root/3/pipeline[7]/stage[1]`), plus the spec hash.
   - On resume, the script re-runs from the top in replay mode. A call whose structural id **and** spec hash match a journalled result returns that result immediately; a mismatch runs live. Replay therefore works per path, not per global prefix, and it is order-independent.
   - This is **stronger** than Claude Code's own resume, which is a best-effort, user-initiated relaunch that replays the longest unchanged prefix. Say so in the docs. Each call is a real `stage_runs` instance in a dynamic scope (`dyn#<callSeq>/<key>`), so the UI, budgets, retries, repair, approvals and the stage conversation all work unchanged.
   - *Why:* this reuses the P03 instance, attempt and journal machinery. The script is the only new component, and its determinism rules make prefix replay sound (Temporal/Restate journaling; E §A).
4. **Caps** (chosen on their own merits; Claude Code's are 1,000 agents total and `min(16, CPUs − 2)` concurrent, RV-40):
   - at most 200 stage calls per run by default (configurable up to 1,000);
   - concurrency bounded by the run's `maxParallel` and the flow keys;
   - `pipeline`/`parallel` at most 4,096 items (an explicit error);
   - a hard budget: a `stage()` call throws `BudgetExhausted` when it runs out.
5. **Runtime spec clamp** (RV-12). Every `stage(spec)` call is validated **at call time** against `DynamicStageSpec`:
   - agent kind only;
   - no hooks, stdio MCP servers or `custom_script` rules;
   - permission capped by the run's ceiling;
   - `agentRef` taken from the workflow's `allowedAgentRefs`;
   - model taken from an allowlist.

   A violation fails the call with a deterministic error. This is the same clamp as G5 §4.7 `DynamicExpansion`.
6. **Authoring and approval:**
   - creating a dynamic workflow needs `write:workflows` **and** `admin:settings` (PD-15);
   - agent authoring goes through the P06 draft/publish path;
   - the approval UI shows the `meta.phases` list and the raw script (Claude Code "View raw script");
   - `validateWorkflow` for dynamic workflows parses the script (QuickJS compile), checks that `meta` is a pure literal, and statically lists the `stage()` call sites for the plan preview.
7. **Pattern presets** (declarative, not script-only):
   - **judge panel / best-of-N:** a map over angles (`mount_per_item`) → a judge stage (schema `{winner, scores[], rationale}`) → an apply-winner finalize effect that merges the winner's branch;

   Adversarial verify (`adversarial-verify`, M3), loop-until-dry (`research-until-dry`, L5) and completeness critic (`completeness-critic`) already ship in P05 as generated templates over the generic loop and map. This phase adds only the judge-panel template and the `merge: 'winner'` map option.
8. **Plan-then-execute (dynamic expansion):** G5 §4.7. An orchestrator stage outputs `{stages, edges}` (spec-lite). The actor validates it against `DynamicExpansion` (`maxStages`, `allowedAgentRefs`) in the **same transaction** as the completion, stores the expansion, and instantiates the scope `~x`. Recovery never re-asks the LLM.

---

## WP-8.1 Spec and validation for `kind: 'dynamic'`
- Add `WorkflowSpec.kind: 'graph' | 'dynamic'`. A dynamic spec is `{script: string, meta, variables, session, budget, lifecycle}`.
- The validator:
  - compiles with QuickJS;
  - enforces the pure-literal `meta` (parsed with acorn, rejecting non-literal nodes);
  - bans `import`/`require`;
  - extracts the phases;
  - checks the size limit (256 KB).

## WP-8.2 Script runtime
- `packages/core/src/services/engine/dynamic/`:
  - `ScriptRuntime.ts`: a worker thread that hosts QuickJS and exposes the host functions over a message port;
  - `DynamicActorAdapter.ts`: `decide()` gains a `dynamic` scope container whose children are created by host calls posted as `script_call` messages. Results return to the script as each instance settles.
- **The journal:** `dynamic_calls(run_id, call_path, spec_hash, instance_id, result_ref, PRIMARY KEY(run_id, call_path))` (migration v62). Replay follows design decision 3.
- **Cancel and pause:** script execution is suspended at the next host call. `budget` reads the run usage roll-up.
- **Crash recovery:** re-run the script from the start in replay mode.

## WP-8.3 Judge-panel template
- A `judgePanel` template (map over angles with a mount per item → judge stage → map `merge: {mode: 'winner', key: Expr}`), plus the engine support for the `winner` merge mode. Loop accumulation needs no engine change: P05 `carry` covers it.

## WP-8.4 Plan-then-execute expansion
- Implement G5 §4.7 in `domain/scheduler/expansion.ts`. The UI renders the expansion as a dashed group with "planned by <stage>".

## WP-8.5 Run diff
- `GET /workflow-runs/:a/diff/:b`: instances aligned by `instance_path`; per instance, the resolved prompt diff, the output diff (JSON-aware), the verdicts, the usage/cost delta and the file-change diff (checkpoints).
- UI: "Compare with parent" on forked runs, and "Compare…" from the run list.
- *Why:* no surveyed engine offers run diffing as a built-in feature (E §J2), and fork lineage (P03/P05) makes it cheap.

## WP-8.6 Stage test with pinned data
- "Test this stage" in the builder picks a past run of the same definition (any version). Its upstream outputs become pinned inputs. The stage runs in isolation in a `test` run (one instance, a scratch workspace restored from that run's checkpoint when requested).
- Saved pins form a per-stage eval set, which the judge and rules can score in batch.
- *Why:* n8n pinned data and execute-step; Mastra time travel (E §K).

## WP-8.7 Opt-in stage cache
- `stage.cache = {ttlMs, key: 'auto'}`.
- The `auto` key is a hash of: the resolved prompt, the stage spec, the session spec, the model, the input artifact hashes and the repo HEAD per codebase.
- Refused (by the validator) for stages with write/shell tools unless `cache.allowSideEffects: true`.
- A cache hit copies the recorded output and artifacts, and records `cache_hit` on the attempt.
- *Why:* Prefect cache policies, LangGraph CachePolicy, Argo memoization (E §H6). It is valuable while authoring and off by default.

## WP-8.8 Builder and run UI for dynamic workflows
- Builder: a script editor (CodeMirror, JS) with a `meta.phases` preview and the host-API type hints (a `.d.ts` served to the editor); "Validate" and "Plan".
- Run page: the phase list as the pipeline strip; stage instances under their phases; "View script" and "View journal".

## Tests
- Sandbox: every banned API throws; memory and CPU caps; no host escape (a corpus of escape attempts).
- **Structural replay:**
  - unchanged script and args → 100% cache hit, **including under `pipeline()` with randomised completion order**;
  - editing one call site → only that path re-runs live;
  - crash mid-script → resume without re-running completed stages.
- Caps and budget behaviour.
- Judge panel: picks and merges the winner.
- Expansion: the stored plan is replayed after a crash (the LLM is not re-asked).
- Run diff API and UI snapshots.
- Stage test with pins; cache hit and miss plus refusal for write stages.
- **E2E phase 08:** a dynamic script that fans out over 3 files, adversarially verifies, and loops until dry on a fixture repo. Kill the server mid-run; after resume, the completed stages are not re-run.

## Acceptance criteria
- Every row of README §5.3 marked P08 is expressible, validates, and runs in the E2E.
- A dynamic script cannot perform I/O or read the clock.
- Resume re-runs only from the first changed call.
