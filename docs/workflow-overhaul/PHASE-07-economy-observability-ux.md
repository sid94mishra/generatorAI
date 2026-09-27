# PHASE 07: Economy, flow control, observability alignment, UX polish

**Goal:**
- Cut per-stage model overhead.
- Make concurrency limits explicit and configurable through flow keys.
- Show budgets and cost where providers report them.
- Align the **existing** tracing with the GenAI conventions.
- Finish the builder and run-page UX gaps.

The review trimmed this phase: no pricing table, no stream-index rewrite, no greenfield OTel.

**Estimate:** 1.5–2 weeks. **Depends on:** P05. It may run in parallel with P06.
**Branch:** `wf/phase-07-economy-ux`.
**Closes:** W-49 (the rest), W-66 (the rest), the D §f UX gaps, F O-1..O-6. W-42 is closed as **accepted, measured** (see WP-7.5).

## Read first
- `F_live_tests.md` §3 O-1..O-6, §4
- `D_web_ui.md` §f, D-24, D-28
- `REVIEW-LOG.md` RV-36, and the §4 cut list

## WP-7.1 Turn economy
1. **Summary policy:** `output.summary: 'none' | 'auto' | 'llm'`, default `auto`.
   - `auto`: JSON stages use `output.summary` or the output keys. Text stages use the first ~1,200 characters plus the headings. There is no LLM turn unless a successor uses `context.mode: summary` **and** the output is larger than 6k characters.
   - `llm`: runs asynchronously on `workflowSummaryModel` after `completed`. Only the successors that need it wait on `summary_ready`.
2. **Prompt boilerplate:** the "How to create files…" block moves into the **system** message, and only for stages with write tools (O-6).
   - Delete the fenced-block scrape that fabricates files from assistant text (`SES:934,952` class; now in StageExecutor).
3. **Checkpoints:** incremental; skipped when `git status --porcelain` on the mount is empty.
4. **Benchmarks:** `bench/stage-overhead.bench.ts` on the testkit (zero-latency FauxProvider) must show under 150 ms of engine overhead per stage. Live T10 (advisory) runs within 1.3× of the critical-path model time.

## WP-7.2 Flow keys (the P05 singleton was the first key)
- `AdmissionController` flow keys, in config and the settings UI:
  - `global`;
  - `provider:<id>`, which **surfaces** the hidden claude-agent 4-turn cap (`GENERATORAI_MAX_CONCURRENT_AGENT_TURNS`, O-2) as a configurable key;
  - `model:<id>` (optional);
  - `worktree:<mountId>` (shared/exclusive) and `check:global`, both introduced in P05 and surfaced here in settings;
  - `run:<id>`, from `maxParallel`.
- The **agent host** enforces the same keys over IPC when it is enabled (RV-26).
- The run UI shows "ready · waiting for provider claude-agent (4/4)".
- A debounce for automation webhook and cron triggers.

## WP-7.3 Budgets UI and cost
- The run header shows usage against budget (turns, tokens, wall clock), and **$ only when the provider reports cost** (claude-agent `total_cost_usd`; others show tokens). **There is no hand-maintained pricing table** (review cut).
- `workflow_run.budget_exhausted` is sent as a push notification.

## WP-7.4 Tracing alignment (not greenfield; RV-36)
- Tracing already exists (`shared/src/telemetry/tracing.ts`; spans in the engine and providers). Rename and add attributes to match the OTel GenAI conventions:
  - `invoke_agent` per attempt, and `chat`/`execute_tool` from the providers;
  - `gen_ai.request.model`, `gen_ai.usage.*`;
  - `workflow.run`/`workflow.stage` with `instance_path`;
  - loop and map iteration spans.
- Content capture stays opt-in.
- Add the engine metrics from G5 §2.13.

## WP-7.5 Write amplification: measure, don't rewrite
- The stream index rewrite is deferred (review cut). The P01 RunLogger deletion and the P03 outbox already remove one copy.
- Add a metric `workflow.stream.rows_per_event`, and a soft CI check on the testkit T1 run.
- Close W-42 as **accepted** if the ratio is at most 2.2×. Otherwise open a follow-up with the numbers.

## WP-7.6 UX (behaviour; the redesign skins later, PD-19)
- **Builder:**
  - `{{` autocomplete in prompts (variables, `stages.<key>.output.*` from output schemas, `run.codebases.*`, `loop.*`, `item.*`);
  - inline errors with quick-fixes;
  - version history (list, diff two versions, restore as a draft);
  - a searchable "Add stage" menu in the builder toolbar (no slash commands).
- **Run page:**
  - per-stage history across runs;
  - a usage roll-up;
  - run search and filters (status, date, trigger, variables);
  - a raw event log per stage.
- **Lists:** status and trigger filters.

## WP-7.7 Docs
An operations guide covering flow keys, budgets and tracing setup.

## Tests
- A property test that in-flight count never exceeds any key's limit (with the agent host on and off).
- Benchmarks as a soft gate (a warning, failing only if more than 25% worse than baseline).
- A span-tree snapshot.
- Playwright checks for autocomplete, version restore and filters.

## Acceptance criteria
- Live T10 (advisory) completes in under 60% of the P00 baseline wall time (421 s).
- The flow keys are visible and configurable.
- No hidden concurrency caps remain.
