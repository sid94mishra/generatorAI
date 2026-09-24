# PHASE 05: Control flow as generic DAG building blocks (5A + 5B)

**Goal:** add general-purpose control-flow **stage kinds** to the workflow graph:
- `loop`: repeat any sub-graph until any rule fires;
- `map`: fan out any sub-graph over any runtime list;
- `subworkflow`: run another workflow as a stage;
- `wait`: approval form, external event or timer;
- `check`: one deterministic command, no LLM.

It also adds the UI for "Re-run from here", compensation, joins and a judge rule.

Every scenario, whether fix/review, test-until-green, goal-seeking, quality refinement, research-until-dry, adversarial verification or per-file migration, is **an ordinary workflow graph built from these kinds**, shipped as editable templates.

**Estimate:** 6.5 weeks, in two milestones merged separately:
- **5A** (3.5 wk): grammar and spec deltas, `check`, the generic loop engine, loop UI, templates L1–L5.
- **5B** (3 wk): map, sub-workflow, wait, fork/compensation/join UI, the expression editor, the remaining templates.

**Depends on:** P04. **Branch:** `wf/phase-05-control-flow`.
**Closes:** R4 (generically); workflow kinds 3, 4, 6, 8, 9, 10, 11, 13, 14, 15, and parts of 1, 2 and 12 (README §5.3); W-24 (`iterationConfig` replaced); W-47 (a judge rule replaces `llm_validation`). Review items P5-1..P5-48 (`docs/workflow-audit/evidence/H2_phase05_review.md`).

## Ground rules (non-negotiable)
1. **Everything is a stage in the DAG.** There are no slash commands, chat commands or special "modes". Loops, maps, waits, checks and sub-workflows are nodes. They are drawn in the builder, imported as JSON or produced by the authoring tools, and they run through the normal pipeline: invoke → engine → run page.
2. **The engine knows only the generic kinds.**
   - Presets are **template functions** in `@generatorai/workflow-spec/presets` that emit plain `StageSpec`/`EdgeSpec` JSON.
   - The shipped `templates/system/*.json` are **generated** from the presets (`pnpm generate:templates --check` in CI).
   - The `check-workflow-invariants` lint fails if an **exact preset export name or template id** appears under `packages/core/src/domain/scheduler/**` or `services/engine/**`.
3. **All loop and map semantics are Expression v2** over typed stage outputs, loop and map state, variables and signals. Everything is type-checked at save or compile time.
4. **The outer graph stays acyclic.** Repetition exists only inside a loop container (PD-1).
5. **Operator decisions are run commands:** buttons and cards on the run page, `POST /api/workflow-runs/:id/commands`, or `generatorai run command …` on the CLI. They are never chat commands.

## Read first
- `H2_phase05_review.md` (**all of it**; this file implements its fixes)
- `G5_scheduler_v2_loops.md` §2, §4.3–4.5, §4.8, §3.8–3.9, §7. Where they differ, **this file wins**.
- `G1_goals_dynamic_workflows_research.md` §1.3, §2.3, §4, §6 (design inputs only)
- P03 (`decide()`, commands API, `stage_runs`/`stage_attempts`, turn roles), P04 (invocation, triggers, mounts), P01 (spec package, Expression v2)
- Real code: `packages/core/src/infrastructure/SandboxedScriptRunner.ts`, `MountService.ts`, `WorkspaceCheckpointService.ts`

---

## 1. Foundations (5A)

### 1.1 Expression v2 grammar delta (P5-3)
Added to `@generatorai/workflow-spec/src/expr` (and to P01 `grammar.ts`, so docs and the skill regenerate):

| Addition | Detail |
|---|---|
| **List literals** | `[a, b, 'c']`. `[]` unifies with the element type of the other operand, or with `carryInit` |
| **Functions** (pure, deterministic, bounded) | `at(list, i)` (negative from the end; out of range → null), `len`, `count(list, x => p)`, `map(list, x => e)`, `filter(list, x => p)`, `some`, `every`, `concat(a, b)` (lists **or** strings), `unique(list, x => key)` (keeps the first), `diff(a, b, x => key)`, `first`, `last`, `take(list, n)`, `sort(list, x => key)` (stable, code-unit order), `sum(list, x => n)`, `max(list, x => n)`, `min(list, x => n)`, `coalesce(a, b)`, `lower`, `exists` |
| **Templates** | `{{ <any expression> \| filter }}` allows full expressions inside braces. Filters: `json`, `yaml`, `bullets` (a list of strings → `- s`; a list of objects → `- [id] body`, taking `id`/`body`/`title` if present, otherwise JSON) |
| **Scopes** | Reserved roots `loop`, `loops`, `item`, `maps`, `map`, `run`, `stages`, `variables`, `parent`, `child` (add `loops` and `maps` to the P01 reserved list) |
| **Limits** | Lists of at most 10,000 elements; evaluation step budget 100k per expression → `expr_budget_exceeded` |
| **Null and errors** | A missing path yields null; comparisons with null are false; `not null` is null, which counts as false; an evaluation error in exits is false (§2.4) |

There is no infix arithmetic. Functions keep the type rules simple. This is deliberate.

### 1.2 `check` stage kind (P5-4, P5-5, P5-24, P5-44)
```ts
const CheckStage = z.object({
  ...StageBase, kind: z.literal('check'),
  check: z.object({
    command: AllowlistedCommand,                 // validated against DEFAULT_COMMAND_ALLOWLIST (exported by the spec pkg);
                                                 // server re-validates against getAllowlist() incl. operator extras
    args: z.array(z.string().max(4000)).max(64), // LITERAL strings; '{{' is rejected
    env: z.record(Template).optional(),          // the ONLY place templated values go (non-secret); secrets must be secretref:
    mount: z.string().optional(),                // run mount alias; default = primary mount
    cwd: RelativePath.optional(),                // inside the mount; no '..'
    timeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
    parseJson: z.boolean().default(false),
    failOnNonZero: z.boolean().default(false),
    tailBytes: z.number().int().min(1024).max(262_144).default(16_384),
  }).strict(),
  retry: RetryPolicyV2.optional(),
});
// output: { exitCode, passed, timedOut, stdoutTail, stderrTail, durationMs, json?, jsonError? }
```

- **Launch failures fail the stage** with the deterministic error `check_launch_failed`. That covers not being on the allowlist, a resolution failure, ENOENT, EINVAL and a policy rejection. A launch failure never yields `passed: false`, so a test-until-green loop cannot spin on a broken command.
- A timeout gives `{timedOut: true, passed: false}` plus `failOnNonZero` semantics.
- Only spawn `EAGAIN`/`EBUSY` are transient. Timeouts and non-zero exits are deterministic.
- The runner sets `NO_COLOR=1` and `FORCE_COLOR=0`, and strips ANSI from the tails.
- **Windows process launch** (P5-4, verified broken today: `pnpm` resolves to the POSIX shim → ENOENT, and a `.cmd` with `shell:false` → EINVAL on Node ≥ 18.20.2). Fix `SandboxedScriptRunner` in WP-5A.2:
  - on win32, skip extensionless PATH candidates;
  - for `.cmd`/`.bat`, resolve npm-style shims to `node <package bin script>` when the shim is a standard npm or pnpm shim. Otherwise run through `%ComSpec% /d /s /c` with cross-spawn-grade escaping; this is safe because args are literals.
  - A Windows CI test runs `pnpm --version`, `pnpm exec vitest --version` and `tsc -v` through the runner.
- **Security** (P5-24). A `check` executes repository code that an agent may have just edited, so it counts as the run capability **`shell`**:
  - it is refused when the run's effective permission is `plan`;
  - it is shown as a "runs repo code" risk flag in the invocation plan and in `describe_workflow`;
  - adding or editing one requires `admin:settings` (the P01 command-bearing registry);
  - the runner blocks `pwsh -Command`/`-c`/`-EncodedCommand`, and `-File` outside the mount;
  - it runs with `buildChildEnv`, and in the run sandbox when one is configured;
  - `GET /api/settings/script-allowlist` feeds the builder's command picker.
- **Admission:** the flow key `check:global` (default 2 concurrent), separate from the provider lanes. It is added to `AdmissionController` here; P07 surfaces it in settings.

### 1.3 Per-kind fields (P5-9)
`StageBase = {key, name, description?, parentKey?, guard?, join, position, compensate?}`, and each kind declares what else applies:

| Kind | Also allows |
|---|---|
| agent | `prompts`, `followUpPrompts`, `session`, `sessionReuse`, `compactAfter`, `sessionGroup`, `context`, `output`, `retry`, `repair`, `onExhausted`, `timeouts`, `budget`, `approval`, `hooks` |
| check | `check`, `retry`, `timeouts.queueMs` |
| loop | `loop`, `budget` (the **cumulative loop budget**) |
| map | `map`, `budget` (cumulative) |
| subworkflow | `subworkflow`, `budget` (the child's share) |
| wait | `wait` |

Anything else → validator error `field-not-applicable`.
- `sessionReuse` stays the P01 enum `'fresh' | 'continue'`. `compactAfter?: 1..20` is a sibling field, valid only with `continue` (`compact-without-continue`) (P5-8).
- The Budget schema gains `maxTokens`. The validator warns `budget-cost-unsupported` when the effective provider lacks cost reporting (P5-34).

---

## 2. The generic loop (5A)

### 2.1 Schema
```ts
const ExitRule = z.object({
  when: Expr,                                              // boolean, evaluated in context E(k)
  action: z.enum(['complete', 'fail', 'pause', 'exhaust']),
  consecutive: z.number().int().min(1).max(10).default(1), // streak length (see 2.4)
  reason: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),      // recorded as exitReason, shown in UI
}).strict();

const LoopStage = z.object({
  ...StageBase, kind: z.literal('loop'),
  budget: Budget.optional(),                               // cumulative over iterations (+ wrap-up allowance below)
  loop: z.object({
    maxIterations: z.number().int().min(1).max(50),
    exits: z.array(ExitRule).max(12).default([]),
    carryInit: z.record(Expr).optional(),                  // evaluated once at loop start (context E(-1))
    carry: z.record(Expr).optional(),                      // evaluated after each iteration, SIMULTANEOUSLY (see 2.3)
    carrySchema: z.record(JSONSchema).optional(),          // optional explicit types (escape hatch)
    onLimit: z.discriminatedUnion('mode', [                // what 'exhaust' does (max iterations, budget, stall rules)
      z.object({ mode: z.literal('pause') }),              // default: park for an operator decision
      z.object({ mode: z.literal('fail') }),
      z.object({ mode: z.literal('accept_last') }),
      z.object({ mode: z.literal('accept_best'), score: Expr }),  // implies per-iteration checkpoints
    ]).default({ mode: 'pause' }),
    wrapUp: z.object({                                     // runs once on budget exhaustion before onLimit
      stage: StageKey,                                     // a body agent with sessionReuse: 'continue'
      prompt: PromptDefinition,
      maxTurns: z.number().int().min(1).max(5).default(1),
      maxCostShare: z.number().min(0).max(0.5).default(0.1), // own allowance: share of budget.maxCostUsd
    }).strict().optional(),
    onBodyFailure: z.enum(['fail', 'next_iteration']).default('fail'),
    checkpointEachIteration: z.boolean().optional(),       // compiler defaults it to true for accept_best
    output: z.object({ select: z.record(Expr).optional() }).default({}),
  }).strict(),
});
```

- The builder shows four **quick rows**: Until (→ complete), Fail when (→ fail), Pause when (→ pause) and Stall (→ exhaust). They write into `exits`. The list is open, so any number of rules with their own streaks and reasons is possible (P5-13).
- **Precedence** when several rules fire in the same iteration: **fail > complete > pause > exhaust**, then array order. Failing is the conservative choice.
- The body is every stage whose `parentKey = <loopKey>`. It can be any kinds, including nested containers, up to a depth of 3.

### 2.2 Evaluation contexts (P5-1, P5-2)

| Context | Used by | `stages.<bodyKey>` | `loop.last` | `loop.previous` | `loop.carry` | `loop.priorCarry` |
|---|---|---|---|---|---|---|
| **T(k)**: templates of iteration k | `prompts` (k=0), `followUpPrompts` (k≥1), body guards, check `env` | outer stages only (the body is not yet run in k) | iteration k-1 | iteration k-1 | carry(k-1) | carry(k-2) |
| **C(k)**: carry after iteration k | `carry` expressions | iteration k | iteration k | iteration k-1 | **carry(k-1)** | carry(k-2) |
| **E(k)**: exits, `score`, `select` after iteration k | `exits[].when`, `onLimit.score`, `output.select` | iteration k | iteration k | iteration k-1 | carry(k) | carry(k-1) |

In iteration 0, `loop.previous`, `loop.priorCarry` and any carry without `carryInit` are **null** (a nullable type, not an error).

Paths:
- `loop.iteration`, `loop.number`, `loop.maxIterations` (including grants), `loop.remaining`.
- `loop.last.stages.<key>.{output, status, summary}` and `loop.previous.stages.<key>.{…}`.
- `loop.last.signals` (see 2.5), `loop.last.failures[]` (with `onBodyFailure: next_iteration`).
- `loop.history[i]` = `{k, exitValues, signals, usage, score?, durationMs}`, read from `loop_iterations`.
- `loop.usage.{turns, costUsd, tokens}`.
- `loop.operatorInput` (string | null).
- `loops.<ancestorLoopKey>.*`: the same fields for enclosing loops (P5-35).

### 2.3 Iteration algorithm (pure `decide()` plus one capture effect; P5-6, P5-7, P5-11, P5-12)
```
loop ready:
    carry(-1) := eval(carryInit)                              # nullable where absent
    phase := 'running'; create scope <loop>#0
scope <loop>#k terminal (decide):
    phase := 'settling'; emit effect capture_iteration_end{k}  # mount tree hash (+ checkpoint if enabled)
iteration_captured{k, treeHashes, checkpointTurnId?} (message from the effect; decide):
    signals(k) := aggregate from persisted attempts + treeHashes    # pure
    outcome := scopeOutcome(k)
    if outcome == failed:
        if every failure.code in {budget_exceeded, loop_wall_clock} -> EXHAUST('budget')      # P5-7
        elif onBodyFailure == 'fail' -> FAIL('body_failed')
    carry(k) := { name: eval(expr, C(k)) for each carry entry }      # simultaneous; key order irrelevant
                # an eval error keeps carry(k-1)[name] and emits loop.carry_error
    for each exit rule r: v := eval(r.when, E(k)) (error or null -> false, emits loop.exit_error)
                          streak[r] := v ? streak[r] + 1 : 0
    fired := rules with streak[r] >= r.consecutive; pick by precedence
    persist loop_iterations row k (carry, exitValues, streaks, signals, score, checkpointTurnId, usage)
    if fired: apply action (complete | fail | pause | exhaust(reason))
    elif k+1 >= effectiveMax: EXHAUST('max_iterations')
    elif budget projected/exceeded: EXHAUST('budget')
    else create scope <loop>#(k+1); phase := 'running'
EXHAUST(reason):
    if reason == 'budget' and wrapUp: create instance <loop>#wrapup/<stage> (continuing session; own allowance)
                                      -> on its settle continue below
    apply onLimit: pause (park, decision card) | fail | accept_last | accept_best
```

- **Streaks** (P5-12) count only the trailing iterations where the rule was true, since the latest of: the loop start, the last operator command on this loop, and the last time this rule fired. An evaluation error or a failed iteration breaks every streak. So after "pause → continue with input", the loop cannot re-park until the rule has held N times again, the same as Codex's "a resumed goal starts a fresh blocked audit".
- **Budget** (P5-7, P5-32):
  - projection at the iteration boundary; a hard abort of in-flight body attempts at 1.25× budget (they settle as `budget_exceeded`, which leads to `EXHAUST('budget')`);
  - the wrap-up runs on its **own allowance** (`maxTurns`, `maxCostShare`), outside the 1.25× cap;
  - wall clock excludes time parked in `awaiting_input`. When it fires mid-iteration, it aborts the in-flight body and exhausts.
- **`accept_best`** (P5-14):
  - `score` is evaluated in E(k) and stored per iteration;
  - ties go to the latest iteration; all-null scores behave as `pause`;
  - the loop's `last` becomes the **chosen** iteration;
  - the restore effect uses `WorkspaceCheckpointService.restoreTurn(checkpointTurnId)` and asserts that **every** mount returned `ok`. Otherwise it re-restores the pre-restore checkpoint on the mounts that succeeded, and fails `restore_failed`;
  - iteration checkpoints are captured with `skipIfUnchanged: false`.
- **Operator commands** (P5-17), all through the commands API with `expectedVersion`:
  - `grant_iterations {n}`;
  - `raise_budget {maxTurns?, maxCostUsd?, maxTokens?}`;
  - `continue_with_input {text}`: the executor **automatically** prepends it as a `turn_role: operator` message to every root body stage of the next iteration, and also exposes it as `loop.operatorInput`;
  - `accept`, `accept_iteration {k}` (409 `checkpoint_unavailable` unless checkpoints were on, or k = last);
  - `fail`.

  Every command resets the streaks.
- **Wrap-up** (P5-16) is a real instance (`<loop>#wrapup/<stage>`, `turn_role: wrap_up`). Its text appears as `stages.<loop>.output.wrapUp`.
- **`compactAfter`** (P5-18): every n iterations, the continuing session is replaced by a fresh one seeded with a **deterministic** digest, with no LLM. The digest holds the stage's first prompt, one line per iteration from `loop_iterations`, and the stage's own last output, capped at 8 KB. It is recorded as `turn_role: digest` and costs 0 turns.

### 2.4 Loop output
`stages.<loop>.output = {iterations, exitReason, exitAction, last: {<bodyKey>: output}, wrapUp: {text} | null, carry, history: [{k, exitValues, score?, usage}], ...select}`. With `accept_best`, `last` refers to the chosen iteration.

### 2.5 Signals (P5-2, P5-15, P5-36)
`capture_iteration_end` computes a cheap **tree hash per mount** (`git add -A` into the shadow index + `write-tree`, or a porcelain-v2 digest for non-git mounts) at iteration start and end. It has no dependency on P07. The pure aggregation exposes:
- `loop.last.signals.toolCalls`, `.workspaceChanged`;
- `loop.last.signals.stages.<key>.{toolCalls, outputHash, status}`.

`outputHash` is taken over canonical JSON (sorted keys), excluding `durationMs` and `timedOut`. A signal that cannot be computed is null, never false.

### 2.6 Persistence (migration v59, P5-19)
- `loop_iterations(stage_run_id, k, carry JSON, exit_values JSON, streaks JSON, signals JSON, score REAL, checkpoint_turn_id, usage JSON, started_at, ended_at, PRIMARY KEY(stage_run_id, k))`. It is written in the same transaction as the next scope's `create_instances`.
- `stage_runs.loop_state` keeps only `{k, phase, effectiveMax, budgetDelta, streaks, exitReason}`.
- Carry is capped at 256 KB per iteration (`loop_carry_too_large`).

### 2.7 Why this design
- **One mechanism covers every loop shape in the research:**
  - Anthropic evaluator-optimizer, ADK LoopAgent, Mastra `.dowhile/.dountil`;
  - the `while` loops of Claude Code workflow scripts;
  - Codex goal continuation (completion audit, blocked-after-N, anti-spin, budget wrap-up).

  Each reduces to a body, typed exit rules with streaks, carried state and bounds (G1 §4).
- **Simultaneous carry, explicit contexts and a fixed precedence** make loops deterministic, replayable and property-testable (G5 §7.2).
- **Deterministic `check` exits** avoid paying an LLM to judge what a command can prove.

---

## 3. Worked loop examples (templates; complete schemas; validated in tests)

Every fenced JSON block in this section is extracted by a test and run through `validateWorkflow` inside a minimal wrapping graph.

### L1: Fix → review until approved (the product owner's scenario)
```jsonc
{ "key": "fix_review", "kind": "loop", "budget": { "maxTurns": 250, "maxCostUsd": 12 },
  "loop": { "maxIterations": 5,
    "exits": [
      { "when": "stages.review.output.verdict == 'approve'", "action": "complete", "reason": "approved" },
      { "when": "not loop.last.signals.workspaceChanged", "action": "exhaust", "consecutive": 2, "reason": "no_changes" } ],
    "carry": { "openComments": "stages.review.output.comments" },
    "onLimit": { "mode": "pause" },
    "output": { "select": { "summary": "loop.last.stages.review.output.summary" } } } },
{ "key": "fix", "parentKey": "fix_review", "kind": "agent", "sessionReuse": "continue",
  "prompts":         [{ "label": "fix", "text": "Fix issue {{variables.issue_url}}. Triage: {{stages.triage.output.summary}}" }],
  "followUpPrompts": [{ "label": "address", "text": "The reviewer requested changes:\n{{loop.carry.openComments | bullets}}\nAddress each one, run the tests, and report per comment id in `addressed`." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["changes", "addressed"],
    "properties": { "changes": { "type": "string" },
      "addressed": { "type": "array", "items": { "type": "object", "required": ["id", "resolution"],
        "properties": { "id": { "type": "string" }, "resolution": { "enum": ["fixed", "wontfix"] }, "note": { "type": "string" } } } } } } } },
{ "key": "review", "parentKey": "fix_review", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "label": "review", "text": "Review the diff for {{variables.issue_url}}.{{#if loop.previous}} Verify these earlier comments were addressed: {{loop.carry.openComments | json}}. Fix report: {{stages.fix.output.addressed | json}}{{/if}}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["verdict", "comments", "summary"],
    "properties": { "verdict": { "enum": ["approve", "changes_requested"] }, "summary": { "type": "string" },
      "comments": { "type": "array", "maxItems": 50, "items": { "type": "object", "required": ["id", "severity", "body"],
        "properties": { "id": { "type": "string" }, "severity": { "enum": ["blocker", "major", "minor", "nit"] },
          "file": { "type": "string" }, "line": { "type": "integer" }, "body": { "type": "string" } } } } } } } }
// edges: triage -> fix_review ; fix -> review (body) ; fix_review -> open_pr
```

### L2: Test until green (deterministic exit)
```jsonc
{ "key": "green", "kind": "loop",
  "loop": { "maxIterations": 6,
    "exits": [
      { "when": "stages.tests.output.passed", "action": "complete", "reason": "tests_pass" },
      { "when": "not stages.tests.output.passed and stages.tests.output.json.numFailedTests >= loop.previous.stages.tests.output.json.numFailedTests",
        "action": "exhaust", "consecutive": 2, "reason": "no_fewer_failures" } ],
    "carry": { "failures": "map(filter(coalesce(stages.tests.output.json.testResults, []), r => r.status == 'failed'), r => r.message)" },
    "onLimit": { "mode": "pause" } } },
{ "key": "fix", "parentKey": "green", "kind": "agent", "sessionReuse": "continue",
  "prompts":         [{ "label": "fix", "text": "Make the test suite pass without weakening tests." }],
  "followUpPrompts": [{ "label": "retry", "text": "Tests still fail:\n{{loop.carry.failures | bullets}}\nFix the root cause." }] },
{ "key": "tests", "parentKey": "green", "kind": "check",
  "check": { "command": "pnpm", "args": ["exec", "vitest", "run", "--reporter=json", "--silent"], "parseJson": true, "timeoutMs": 600000 } }
// body edge: fix -> tests. A comparison with null is false in iteration 0, so there is no false stall.
```

### L3: Goal-seeking (an objective with an evidence audit)
```jsonc
{ "key": "goal", "kind": "loop", "budget": { "maxTurns": 400, "maxTokens": 4000000 },
  "loop": { "maxIterations": 20,
    "exits": [
      { "when": "stages.assess.output.status == 'impossible'", "action": "fail", "reason": "impossible" },
      { "when": "stages.assess.output.status == 'met'", "action": "complete", "reason": "met" },
      { "when": "stages.assess.output.status == 'blocked' and stages.assess.output.blocker == loop.previous.stages.assess.output.blocker",
        "action": "pause", "consecutive": 2, "reason": "same_blocker" },
      { "when": "loop.last.signals.stages.work.toolCalls == 0", "action": "exhaust", "consecutive": 2, "reason": "no_progress" } ],
    "carry": { "gaps": "coalesce(stages.assess.output.gaps, [])" },
    "wrapUp": { "stage": "work", "prompt": { "label": "wrap_up", "text": "Budget reached. Summarise verified progress, remaining work, blockers and the next step. Do not start new work." } },
    "onLimit": { "mode": "pause" } } },
{ "key": "work", "parentKey": "goal", "kind": "agent", "sessionReuse": "continue", "compactAfter": 8,
  "prompts":         [{ "label": "objective", "text": "Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nConstraints: {{variables.constraints}}\nWork from evidence in the current workspace and keep the full objective." }],
  "followUpPrompts": [{ "label": "continue", "text": "The assessment found unmet requirements:\n{{loop.carry.gaps | bullets}}\nContinue." }] },
{ "key": "assess", "parentKey": "goal", "kind": "agent", "sessionReuse": "fresh",
  "session": { "model": "<catalog id of a small model>" },
  "prompts": [{ "label": "audit", "text": "Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nAudit whether the objective is met in the current workspace. For each requirement, cite evidence and classify it as proves / contradicts / missing. Uncertain means not met. If blocked, give a short stable identifier in `blocker`." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["status", "gaps"],
    "properties": { "status": { "enum": ["met", "not_met", "blocked", "impossible"] }, "blocker": { "type": "string" },
                    "gaps": { "type": "array", "items": { "type": "string" } } } } } }
// body edge: work -> assess. "Same blocker" with consecutive 2 = 3 identical blockers in a row.
// The wrap-up text is at stages.goal.output.wrapUp.
```

### L4: Quality refinement, keeping the best
```jsonc
{ "key": "refine", "kind": "loop",
  "loop": { "maxIterations": 4,
    "exits": [{ "when": "stages.critique.output.score >= 8", "action": "complete", "reason": "good_enough" }],
    "carry": { "issues": "stages.critique.output.issues" },
    "onLimit": { "mode": "accept_best", "score": "stages.critique.output.score" },
    "output": { "select": { "notes": "loop.last.stages.draft.output" } } } },
{ "key": "draft", "parentKey": "refine", "kind": "agent", "sessionReuse": "continue",
  "prompts": [{ "label": "draft", "text": "Write the release notes for {{variables.version}}. Output only the notes." }],
  "followUpPrompts": [{ "label": "improve", "text": "Improve the draft. Critique:\n{{loop.carry.issues | bullets}}" }] },
{ "key": "critique", "parentKey": "refine", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "label": "score", "text": "Score these release notes 0-10 for accuracy, completeness and clarity, and list concrete issues:\n{{stages.draft.output}}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["score", "issues"],
    "properties": { "score": { "type": "number", "minimum": 0, "maximum": 10 },
                    "issues": { "type": "array", "items": { "type": "string" } } } } } }
// body edge: draft -> critique. accept_best implies per-iteration checkpoints, and `last` = the chosen iteration.
```

### L5: Research until nothing new (an accumulator)
```jsonc
{ "key": "research", "kind": "loop",
  "loop": { "maxIterations": 8,
    "carryInit": { "seen": "[]" },
    "carry": { "newItems": "diff(stages.find.output.findings, loop.carry.seen, f => f.url)",
               "seen": "take(unique(concat(loop.carry.seen, stages.find.output.findings), f => f.url), 2000)" },
    "exits": [{ "when": "len(loop.carry.newItems) == 0", "action": "complete", "consecutive": 2, "reason": "dry" }],
    "output": { "select": { "findings": "loop.carry.seen" } } } },
{ "key": "find", "parentKey": "research", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "label": "find", "text": "Find sources on {{variables.topic}}. Do not repeat these URLs:\n{{ take(map(coalesce(loop.carry.seen, []), f => f.url), 200) | bullets }}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["findings"],
    "properties": { "findings": { "type": "array", "items": { "type": "object", "required": ["url", "title"],
      "properties": { "url": { "type": "string" }, "title": { "type": "string" }, "summary": { "type": "string" } } } } } } } }
// Both carry entries read carry(k-1) (simultaneous), so newItems is correct regardless of key order.
```

### L6: Nested: plan, fan out and verify each iteration (5B)
```jsonc
{ "key": "migrate_until_clean", "kind": "loop",
  "loop": { "maxIterations": 3, "exits": [{ "when": "stages.typecheck.output.passed", "action": "complete", "reason": "clean" }] } },
{ "key": "plan", "parentKey": "migrate_until_clean", "kind": "agent",
  "prompts": [{ "label": "plan", "text": "List every file that must change to migrate to the new API." }],
  "followUpPrompts": [{ "label": "replan", "text": "Typecheck still fails:\n{{loop.previous.stages.typecheck.output.stdoutTail}}\nList only the files that still need changes." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["files"],
    "properties": { "files": { "type": "array", "maxItems": 100, "items": { "type": "object", "required": ["path"],
      "properties": { "path": { "type": "string" }, "reason": { "type": "string" } } } } } } } },
{ "key": "per_file", "parentKey": "migrate_until_clean", "kind": "map",
  "map": { "items": "stages.plan.output.files", "itemKey": "item.path", "maxItems": 100, "concurrency": 4,
           "workspace": "mount_per_item", "merge": "sequential" } },
{ "key": "edit", "parentKey": "per_file", "kind": "agent",
  "prompts": [{ "label": "edit", "text": "Migrate {{item.path}} to the new API. Reason: {{item.reason}}" }] },
{ "key": "typecheck", "parentKey": "migrate_until_clean", "kind": "check",
  "check": { "command": "pnpm", "args": ["typecheck"], "timeoutMs": 900000 } }
// body edges: plan -> per_file -> typecheck
```

A **completeness-critic** template (`completeness-critic`) is L5-shaped: a `work` stage, plus a `critic` stage returning `{missing: string[]}`, with carry `todo = critic.missing` and the exit `len(stages.critic.output.missing) == 0`.

---

## 4. Map, sub-workflow and wait (5B)

### 4.1 Map (P5-20..P5-23, P5-48)
```ts
map: {
  items: Expr,                         // must type-check to an array
  itemKey?: Expr,                      // stable key (string); default = index; duplicates -> map_duplicate_item_key
  maxItems: 1..200 = 50, concurrency: 1..16 = 4, toleratedFailurePercent: 0..100 = 0,
  workspace: 'shared' | 'mount_per_item',
  merge: 'none' | 'sequential' | 'pr_per_item',
  itemSetup?: CheckSpec[],             // e.g. pnpm install --offline, run in each item mount before the body
  output?: { select?: Record<string, Expr> }   // evaluated PER ITEM scope
}
```

- `results[i] = {index, key, item, status, stages: {<bodyKey>: output}, ...select}`. `failures` holds the failed entries.
- `instance_path` uses the **index** (`<map>#<i>/…`). The key is stored in `stage_runs.item_key` (v59), and fork accepts either the index or the key.
- Scopes: `item`, `item.index`, `item.key`, `map.count`, and `maps.<ancestorMapKey>.item` for nested maps (M3).
- **`mount_per_item`:**
  - requires git-backed run mounts (an error at invoke otherwise);
  - at fan-out, it captures a snapshot commit of the run mount (shadow ref), then calls a new `MountService.forkFromSnapshot(runWorkspaceId, snapshotCommit, itemScopeId)`, which is **all-or-nothing**, unlike today's best-effort `seedFrom`;
  - `itemSetup` runs in each item mount;
  - item mounts are released on merge, or at map completion under `merge: none`, when they are retained until run finalize, subject to retention.
- **Writer exclusion:** while a `mount_per_item` map runs, it holds a shared lease on `worktree:<runMountId>`. Writers outside the map targeting that mount wait. Merges take the exclusive lease.
- **Merge:**
  - `sequential`: a 3-way merge onto a temporary ref, then an atomic fast-forward. A conflict fails that item with `merge_conflict` (counted toward tolerance) and keeps its mount for inspection.
  - `pr_per_item`: branch `generatorai/<run>-<index>` as a journalled effect `merge/<map>/<index>`. Push and PR follow `lifecycle.postProcessing.autoPush/autoCreatePR`. The result is `pr: {url, branch}`.
  - A cancel during a merge never leaves partial state.
- **`map-shared-write-concurrency`:** checked at compile and invoke time from the resolved agent snapshots, with only a save-time warning.

**Examples:**
- **M1, per-file migration:** `items: stages.scan.output.files`, `itemKey: item.path`, `mount_per_item`, `pr_per_item`.
- **M2, multi-source research:** a map over `variables.sources` (a new `list` variable type, P5-23) in a shared, read-only workspace → a `synthesize` stage reading `stages.sources_map.output.results`.
- **M3, adversarial verification:**
  ```jsonc
  { "key": "verify_findings", "kind": "map",
    "map": { "items": "stages.audit.output.findings", "itemKey": "item.id", "maxItems": 50, "concurrency": 4, "workspace": "shared", "merge": "none",
             "output": { "select": { "confirmed": "count(stages.verify_map.output.results, r => r.stages.verify.output.real) >= 2" } } } },
  { "key": "verify_map", "parentKey": "verify_findings", "kind": "map",
    "map": { "items": "['correctness', 'security', 'reproducibility']", "maxItems": 3, "concurrency": 3, "workspace": "shared", "merge": "none" } },
  { "key": "verify", "parentKey": "verify_map", "kind": "agent",
    "prompts": [{ "label": "verify", "text": "Independently verify this finding from the {{item}} angle. Default to real=false unless you can demonstrate it:\n{{maps.verify_findings.item | json}}" }],
    "output": { "format": "json", "schema": { "type": "object", "required": ["real", "evidence"],
      "properties": { "real": { "type": "boolean" }, "evidence": { "type": "string" } } } } }
  ```
  (The `verify` agent must have no write groups for the shared workspace.)

### 4.2 Sub-workflow (P5-25)
- `subworkflow: { workflowRef: {id} | {name, projectScope?}, version: 'pin_at_run_start' | n, inputs: Record<string, Expr>, workspace: 'inherit' | 'isolated' }`, plus StageBase `budget` for the child's share.
- `workflowRef` is resolved at save and on export/import, so it is portable.
- **Published children only.** A draft child gives a warning at save and an error at publish and invoke. A parent test run may use the child's test version.
- **`inherit`:** the child's lifecycle `prepare.mounts` and `postProcess` are **suppressed**. It works in the parent's mounts, and the parent owns commit and PR. **`isolated`:** a full child lifecycle.
- **Output drift:** at invoke, the child version's `outputs` types are re-checked against the parent's usage. Incompatible → `subworkflow-output-drift`.
- Invocation goes through the P04 service with trigger `{kind:'stage'}`; the trigger union is defined in P04 WP-4.2. Depth ≤ 3, with a cycle check at save and invoke.
- Cancel and pause propagate. Usage rolls up. **All** child decision cards (approvals, parked loops, waits) are mirrored into the parent's pending list through `WorkflowApprovalService`, which is **extracted in this phase** (it was P06, cross-file #14).
- **S1 example:** `release` uses `{ "kind": "subworkflow", "subworkflow": { "workflowRef": { "name": "security-review" }, "inputs": { "target": "stages.build.output.artifactPath" }, "workspace": "isolated" } }`. The child declares `outputs: { verdict: "stages.review.output.verdict" }`. The parent routes with an edge `when: stages.security.output.verdict == 'pass'`.

### 4.3 Wait (P5-26, P5-41)
- `wait` is one of:
  - `{type:'approval', prompt: PromptDefinition, form?: JSONSchema, timeoutMs?, onTimeout:'fail'|'complete'}`;
  - `{type:'event', eventKey: Expr, timeoutMs?, onTimeout}`;
  - `{type:'timer', durationMs}`.
- It holds no executor, lease or admission slot.
- For unattended triggers, a wait with no timeout gets the P03 `pause_ttl` (72 h).
- Output: `{outcome: approved|rejected|event|timeout|elapsed, data, by, at}`.
- **Events** (v59): `workflow_run_events(id, run_id, event_key, idempotency_key, data, received_at, consumed_by_stage_run_id NULL, UNIQUE(run_id, event_key, idempotency_key))`.
  - A wait consumes the **oldest unconsumed** matching event. Early arrivals are buffered.
  - A duplicate with the same idempotency key → 200 `replayed`; the same key with different data → 409.
  - This works inside loops and maps: each wait instance consumes its own event.
- **Delivery** is one of:
  - (a) the run command `deliver_event {eventKey, idempotencyKey, data}` (scope `exec:agent`);
  - (b) a **per-wait callback**: the wait mints an HMAC token over (run, instance, eventKey), exposed as `stages.<wait>.callbackUrl` / `callbackToken`. External systems such as CI post to the callback URL with no user credential. This is the Step Functions task-token pattern.
- **Examples:**
  - **W1:** an approval with a form `{environment: enum[staging, prod], notes}` and `onTimeout: 'complete'`. An edge `approve → escalate` with `on: completion` and `when: stages.approve.output.outcome == 'timeout'`. The deploy prompt reads `stages.approve.output.data.environment`.
  - **W2:** `eventKey: "concat('ci:', stages.push.output.sha)"`. CI posts to `callbackUrl`.
  - **W3:** a timer cool-down.

### 4.4 Judge rule vs judge stage (P5-43)
- **Judge rule:** `output.rules: [{type:'judge', rubric, threshold: 0..10, model?, include?: ['diff']}]`. It runs after the hard rules in a fresh, tool-less session.
  - `stage_attempts.judge` holds an array per repair round.
  - Below the threshold → a repair turn with the reasons. Still below after `repair.maxRepairs` → a repairable error → P03 precedence.
  - Its cost counts toward the stage budget.
  - Use it when a stage should fix itself.
- **Judge stage:** an ordinary agent stage with a score schema (L4 `critique`). Use it when a loop should decide.

---

## Work packages

### Milestone 5A (3.5 weeks)
**WP-5A.1 Spec and grammar.**
- The grammar delta (§1.1).
- `CheckStage`, `LoopStage`, `ExitRule`, per-kind field applicability (§1.3), `compactAfter`, and the Budget `maxTokens`.
- **Enable and extend** the P01 fields `followUpPrompts` and `WorkflowSpec.outputs` (they already exist).
- The `list` and `json` variable types in `VariableDefinition`, with builder and invocation-form support.
- **Validator codes:**
  - `field-not-applicable`, `compact-without-continue`;
  - `exit-unbound` (an exit must reference at least one per-iteration path: body `stages.*` or `loop.{carry, priorCarry, last, previous, history, usage, iteration}`);
  - `exit-unreachable` (warning: `consecutive > maxIterations`);
  - `loop-no-exit` (warning);
  - `carry-type` (nullable-first-iteration rule, `[]` unification, `carrySchema`);
  - `wrapup-stage`;
  - `check-command` (allowlist), `check-args-literal`;
  - `budget-cost-unsupported` (warning);
  - `nesting-too-deep`, `edge-crosses-scope`, `empty-body`, per-scope `cycle`.
- **Presets:** `fixReviewLoop`, `testUntilGreen`, `goalLoop`, `refineUntilScore`, `researchUntilDry`, `completenessCritic`, each with a parameter schema.
- `pnpm generate:templates` writes `templates/system/*.json` from the presets. `--check` runs in CI.

**WP-5A.2 `check` runtime.** The §1.2 semantics; the Windows launch fix in `SandboxedScriptRunner`; `check:global` admission; the `shell` capability rule; the risk flag in the plan; `GET /api/settings/script-allowlist`.

**WP-5A.3 Loop engine.**
- `domain/scheduler/loops.ts` implementing §2.3 exactly: contexts, simultaneous carry, streaks, precedence, budget paths, wrap-up instance, onLimit, accept_best.
- The `capture_iteration_end` effect (tree hashes, optional checkpoint).
- The commands `grant_iterations`, `raise_budget`, `continue_with_input`, `accept`, `accept_iteration` and `fail`, added to the P03 commands schema.
- The automatic operator turn.
- The deterministic `compactAfter` digest.
- The `loop.*` events: `iteration_started`, `iteration_completed`, `exit`, `exit_error`, `carry_error`, `parked`, `command_applied`.

**WP-5A.4 Migration v59.**
- `loop_iterations`;
- `stage_runs.item_key`;
- `workflow_run_events` (the §4.3 shape);
- `stage_definitions.parent_key` and `kind` (backfilled from `spec`) and the index `(workflow_definition_id, parent_key)`.

Regenerate the baseline and the lock. The migration test is a **hard gate**.

**WP-5A.5 Loop UI.** Existing components, plus the allowed new dependency below.
- **Builder:**
  - loop group nodes ("Wrap in loop" on a multi-select);
  - the loop panel: max iterations, the four quick exit rows plus "Add rule", carry table (name, expression, init, optional schema), budget and wrap-up, on-limit, on-body-failure, output select;
  - check node editing (admin only; allowlist picker);
  - for agent stages inside a loop: follow-up prompts, session reuse and compact-after.
- **Run page:**
  - loop badge `n/max`, current rule values and streaks ("same_blocker 1/2"), and a "Needs decision" chip;
  - iteration tabs: a continuing transcript with dividers; "Iteration input" cards showing each rendered follow-up; carry values per iteration from `loop_iterations`;
  - decision cards: grant +1/+2, raise budget, continue with input, accept, accept iteration k, fail.
- **Mobile, TUI and CLI:** status rows plus the decision cards. CLI `generatorai run command <run> <instance> <command> --json '<payload>'`.

**WP-5A.6 Judge rule.** §4.4.

### Milestone 5B (3 weeks)
**WP-5B.1 Map engine and mounts.** §4.1, including `MountService.forkFromSnapshot` (all-or-nothing), `itemSetup`, the shared/exclusive `worktree:<mountId>` leases, the merge strategies and the per-item result shape.

**WP-5B.2 Sub-workflow.** §4.2, including `WorkflowApprovalService` (moved from P06) and mirroring of all child decision cards.

**WP-5B.3 Wait.** §4.3, including the callback tokens (`POST /api/workflow-callbacks/:token` with HMAC verification and rate limits), the event table semantics, `deliver_event` and the unattended TTL.

**WP-5B.4 Fork, compensation and join UI.**
- "Re-run from here" on any instance, including `<loop>#k/…` (seeds carry(k-1) from `loop_iterations`) and `<map>#i/…`.
- Compensation hooks.
- Join policy selector; edge `handlesFailure`.

**WP-5B.5 Expression editor.** CodeMirror 6 is an **allowed new dependency** (P5-39). It is lazy-loaded as its own chunk with a budget of at most 250 KB gzip. Autocomplete comes from the scope model (variables, output schemas, `loop.*`/`loops.*`, `item.*`/`maps.*`, carry names, signals). It has a live parse and type check, and a hover showing the last-run value.

**WP-5B.6 Remaining templates and docs.**
- Templates:
  - `per-file-migration` (M1);
  - `migrate-until-clean` (L6);
  - `multi-source-research` (M2);
  - `adversarial-verify` (M3);
  - `approval-gated-release` (W1);
  - `ci-gated-deploy` (W2);
  - `release-with-security-review` (S1).
- The "Control flow" guide: kinds, the §2.2 context table, the §2.3 algorithm, every example, and the "presets are templates" rule. The P06 skill reuses it.

---

## Tests (hard gate = testkit; live = advisory)
**Loop:**
- each action and precedence tie;
- streak counting, reset on command, reset after a firing, and broken by errors and failures;
- simultaneous carry, independent of key order;
- `priorCarry`;
- nullable first iteration;
- `[]` unification;
- carry error keeps the previous value; carry size cap;
- `onBodyFailure: next_iteration` exposes `failures`;
- budget abort → exhaust + wrap-up (a real instance, its own allowance, output `wrapUp`);
- wall clock excludes parked time;
- `accept_best` (ties, all-null → pause, restore all-or-rollback, `last` = chosen);
- `accept_iteration` without checkpoints → 409;
- every command, plus a stale version;
- `continue_with_input` text appears in the next prompt;
- deterministic `compactAfter` digest;
- a crash in `settling` resumes via re-emitting `capture_iteration_end`;
- nested loop session keys;
- `loops.<key>` scope.

**Examples:** every fenced JSON block in this file is extracted and validated. L1–L6 and M3 run as testkit scenarios with scripted outputs:
- L1 requests changes twice, then approves;
- L3: met, impossible, same blocker ×3 → paused (while different blockers each round → no pause), no-progress, and budget wrap-up;
- L5: two dry rounds.

**Check:**
- allowlist; admin scope; literal args; env-only templating;
- launch failure → stage failed (not `passed: false`); timeout;
- `failOnNonZero`; JSON parse errors;
- refused in `plan` mode;
- ANSI stripping;
- **Windows launch** (`pnpm --version`, `pnpm exec vitest --version`, `tsc -v`) in the Windows CI job.

**Map:**
- tolerance;
- `itemKey` redrive and duplicate-key error;
- per-item `select`;
- mount per item sees uncommitted upstream changes;
- `forkFromSnapshot` all-or-nothing;
- `itemSetup`;
- writer exclusion;
- merge conflict counted toward tolerance;
- cancel during a merge;
- `pr_per_item` result;
- nested `maps.<key>.item`.

**Sub-workflow:** pinning; draft rules; depth and cycle; `inherit` suppressing the lifecycle; output drift; mirrored decision cards (approval, parked loop, wait); usage roll-up.

**Wait:** form validation; timeout routing (the W1 edge); an event inside a loop consumed per instance; early arrival; idempotency and 409 on conflict; callback-token auth; unattended TTL; no admission slot held (property test).

**Judge rule:** below the threshold → repair → pass; exhausted → repairable → P03 precedence; array stored; cost counted.

**Migration v59** (hard gate).

**Presets and lint:** generated templates match `--check`; the lint on exact preset names.

**Property tests (G5 §7.2),** extended with loops, maps and checks:
- iterations ≤ max + granted;
- cost ≤ 1.25 × budget + wrap-up allowance + one in-flight usage;
- no scope after terminal;
- determinism of `decide` given the persisted signals.

**UI** (Playwright, bundled Chromium): wrap/unwrap group; exit rules; carry table; decision cards; iteration tabs; expression-editor autocomplete.

**Live (advisory):** L1 on a fixture repo; L2 with a failing test; M1 over 3 files; W1 with a timeout.

## Acceptance criteria
- Every template and example is generated from generic kinds, validates, and runs on the testkit. No engine code names a preset or template.
- There are no slash or chat commands. Creation happens in the builder, import or authoring tools; operation happens through run-page cards, the commands API or the CLI subcommand.
- The product owner's scenario (L1) runs end to end from its template, showing iteration tabs, rendered iteration inputs, carry values, streaks, budget usage and a pause-on-limit decision card.
- `check` works on Windows and on POSIX.

## Handoff checklist
- [ ] 5A merged (WP-5A.1–5A.6), then 5B merged (WP-5B.1–5B.6).
- [ ] The v59 dry run on a backup copy is logged.
- [ ] `STATUS.md` and `TRACEABILITY.md` updated.
- [ ] Every H2 review item (P5-1..P5-48) is ticked in the PR description.
