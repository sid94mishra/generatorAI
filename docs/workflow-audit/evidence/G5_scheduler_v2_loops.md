# G5: Scheduler v2 (loops, retries, control flow and the execution model)

Status: design proposal. Branch `desktop_redesign`, 2026-09-24. No backward-compatibility requirement: runs may be dropped, but chats must survive.
Inputs: `docs/workflow-audit/evidence/B_runtime.md` (B-n), `E_modern_engines_research.md` (E §n), `F_live_tests.md` (F-n), plus the code:
- `packages/core/src/services/DAGScheduler.ts` (SCH)
- `WorkflowRunService.ts` (WRS)
- `StageExecutionService.ts` (SES)
- `DurableExecutionEngine.ts`
- `domain/dag/*`, `domain/state-machines/*`
- `packages/db/src/schema.ts`, `packages/db/src/repositories/StageRunRepository.ts`
- `packages/shared/src/types/StageDefinition.ts`

---

## 0. Decisions at a glance

| # | Decision | Rationale |
|---|---|---|
| D1 | Keep a **pure scheduling core**, widened to `decide(graph, state, input, now) → Decision[]` | This keeps today's one-predicate property of `reconcileDAG`. Decisions become replayable and property-testable. |
| D2 | **Loops are a structured loop block**: a container node with a body sub-DAG, `maxIterations`, `until` and a budget. The evaluator-optimizer pair ships as a builder *preset* over it. There are no back-edges. | The outer graph stays acyclic, so readiness, skip propagation, terminal status and layout all still hold. Each iteration gets its own memo key for free. |
| D3 | **One `stage_runs` row per node instance** (definition × `instance_path`) and **one `stage_attempts` row per attempt** | The status map is keyed by `stageDefinitionId` (`SCH:552-558`), which structurally blocks loops and maps. The attempt table fixes the lost retry history (F O-5). |
| D4 | **A per-run serial actor** (mailbox) replaces the event and 3 s poll hybrid. Executors post results straight into the run mailbox, and a poll runs only as a 15 s backstop. | Fixes B-1. Nothing blocking runs in the actor: validation happens in the executor, and backoff is a durable timer. |
| D5 | **Every status write is a CAS**: `transition(id, from[], to, expectedVersion?)`, checked against the state-machine table | Fixes B-2, B-3, B-7, F-1, F-5 and B-23 at the root. The state machine becomes the write gate, not an after-the-fact assertion. |
| D6 | New states `ready`, `starting`, `validating`, `retry_wait`, `waiting`. A stage is not `completed` until its output contract validates. | Fixes F-5 and the ticks blocked by validation. |
| D7 | **Error classes** (transient / deterministic / repairable / interrupted). Precedence is **repair → retry → `on_failure` edge → onExhausted (pause or fail)**, with **pause** as the default. | Follows Restate 1.5 (E §C4). Deterministic errors stop burning retries, and repair gets its own budget. |
| D8 | **Typed stage outputs** (`output.schema`, taken from a `submit_output` tool or, failing that, the final JSON block of the *current attempt*) and **Expression v2** with `stages.<key>.output.<field>`, type-checked at save | Loop exit, routing and joins all need typed outputs (B-22, F-6, F-7). |
| D9 | **Join policy per node**: `all` / `any` / `n_of_m`, plus `cancelRemaining`, evaluated per predecessor. **Only `on_failure` edges (or ones with `handlesFailure`) absorb a failure.** | Fixes B-18 and B-16. |
| D10 | **Map, sub-workflow and dynamic expansion reuse the container-scope machinery** | One mechanism instead of four. |
| D11 | **A single forward migration (v55)**: drop and recreate the run-side tables, alter the definition tables in place, and delete only stage-owned sessions | Chats and definitions survive. Run history is dropped. |

---

## 1. Evaluation of today's DAG scheduling

### 1.1 Strengths to keep

1. **A pure readiness and reconcile core.** `resolveStageReadiness` and `reconcileDAG` (`SCH:124-269`) are the only definition of "ready" and "skip". The skip cascade runs to a fixed point in memory, which is correct dead-path elimination. v2 keeps this shape and widens what goes in (typed outputs, instances, join policy) and what comes out (a decision list).
2. **A frozen snapshot DAG per run** (`definitionSnapshot`, `SCH:512-527`). It is promoted to immutable `workflow_definition_versions`, compiled once. The executor, validator and retry path must read it too; today they re-read live definitions (B-13).
3. **An idempotent atomic claim** (`claimForExecution`, `StageRunRepository.ts:167-177`). It generalizes into `transition()` for every change.
4. **A per-run FIFO lock** (`SCH:412-444`). It becomes the per-run actor mailbox.
5. **The durable turn journal** (`withEffect`, epoch a-retry-v-validation, `SES:1504-1666`). Keep it, but fix three things:
   - settlement ordering (F-3a);
   - the in-flight `never` turn being skipped and then completed (B-10);
   - the op-id scheme, so resume and iteration keys are explicit.
6. **Admission lanes and the stage semaphore.** The admission wait moves into the `ready` state and out of `executeStage`.

### 1.2 Weaknesses and root causes

| Weakness | Evidence | Root cause | v2 answer |
|---|---|---|---|
| Event routing is dead, so every hop waits for the 3 s poll | B-1; F O-4 | SES `emit(session)` against WRS `subscribeGlobal` | Executors call `RunSupervisor.post(runId, msg)`. The EventBus serves the UI only (via the outbox). |
| Validation and backoff block the tick | WRS:1022-1063, 1339, 1681 | Validation and sleep happen inside the non-reentrant tick | Validation runs in the executor (`validating`). Backoff = `retry_wait` + a durable timer. The actor only awaits its own synchronous transaction. |
| No CAS | `update()` is unconditional; `version` is never compared; the state machine asserts after the write (SES:1062, 1097, 1360) | About 15 raw status writers | `transition()` is the only status writer. Legal pairs come from the state-machine table, which the property tests also use. |
| Completed before validated | F-5 | SES writes completed and WRS validates later | A `validating` state. The run cannot finalize while one exists. |
| Veto join, no OR-join, unsatisfiable fan-in | B-18, S4 | Per-edge veto (SCH:138-151) | `join` policy per node, evaluated per predecessor |
| Failure masking | B-16 | always/on_completion count as handled (SCH:195-201) | Only `on_failure` or `handlesFailure: true` absorbs a failure |
| No loops, fan-out or sub-workflows | B-17; IterationConfig has no executor | Status map keyed by definition id, one row per definition | Node instances plus container nodes |
| Retries restart from step 0; unclassified default retry; one budget shared by execution and validation; recursion inside catch; not cancellation-aware | SES:2665-2688, 3279-3317; B-3; O-8 | No error model and no attempt entity | `stage_attempts`, `ErrorClass`, resume mode, a separate repair budget, retries scheduled by the actor |
| Heartbeat = process liveness, not stamped on re-entry | B-2, B-8, F-4 | setInterval beat plus raw status writes | Lease set inside the CAS; separate progress watchdog |
| Crash mid-turn completes the stage empty | B-10, F-3 | Synthetic result, then empty string, then continue | `interrupted` attempt → `paused`, unless the journal proves the turn settled |
| In-memory dedup processedStageRuns | WRS:1296-1299, 1413-1416 | Events are not idempotent | Deleted. Idempotency = CAS + (stage_run_id, attempt_no). |
| Finalize is check-then-act; post-processing listener has a TTL | B-23, B-19 | No CAS; post-processing hangs off a listener | Run `finalizing` state entered by CAS. Post-processing and compensation run inside it. |
| Conditions cannot see outputs; not fail-safe | B-22, O-7 | Ad-hoc string parser | Expression v2: AST plus save-time type checking |
| Validation reads every assistant message; json_schema broken | F-6, F-7, B-11 | No per-attempt output boundary | `OutputContract`: extraction scoped to the current attempt, plus ajv |

---

## 2. The loop construct

### 2.1 The user's scenario

```
[triage] --on_success--> +------- loop: review_loop (max 4, until review.verdict == 'approve') -------+ --> [open_pr]
                         |  [fix] --on_success--> [review]                                             |
                         |   ^ iteration k+1 gets review(k).comments; the fix session CONTINUES         |
                         +------------------------------------------------------------------------------+
                            (loop exhausted: pause for a human to grant +N, accept, or fail)
```

### 2.2 Options compared

| | (a) Back-edges + per-edge maxTraversals (LangGraph / Step Functions) | (b) Structured loop block (Mastra dowhile, ADK LoopAgent) | (c) Evaluator-optimizer pair primitive |
|---|---|---|---|
| Authoring | Most free-form: draw an arrow back | Wrap stages in a group; set max and until | One node with two prompts |
| Expressiveness | Arbitrary cycles, including cycles that cross parallel branches | Any sub-DAG as the body (Fix → Test → Review works); nestable | Only generator + evaluator; Fix → Test → Review cannot be expressed |
| Scheduler impact | **Severe.** Readiness ("all predecessors terminal") must exclude back-edges, so they must be classified anyway. Re-arming cycle nodes needs SCC computation. Dead-path elimination and OR-join inside cycles are non-local (the BPMN OR-join problem). Topological order, layers and terminal status all break. | **Local.** The loop is one node to the outer graph. The body is reconciled by the same pure function once per iteration scope. | Local, but needs a special-case executor |
| Memo keys | Per-edge traversal counters threaded into every node key (the Mastra #24044 collision class) | `instance_path = review_loop#k/fix`, unique by construction | pair#k/gen, pair#k/eval |
| Bounding | Several back-edges multiply; the bound is hard to prove | One maxIterations plus budgets on the container | One cap |
| Exit semantics | Implicit: whichever edge condition fires | Explicit do-while `until`; the exit reason is recorded | Explicit |
| Run UI | Visually fine, but "which traversal?" is confusing | Group node with an n/max badge and iteration tabs | Single node |
| Validator | Cycle rejection must become "every cycle is guarded" (weaker) | Kahn's algorithm stays; add scope rules | Unchanged |

**Decision: (b), with (c) as a builder preset.** "Review loop" generates a loop block containing an agent generator, an agent evaluator and a canned review output schema.

Why:
1. It keeps every audited-and-fixed invariant of the acyclic scheduler: the WS-D1 single predicate and the skip cascade.
2. It gives a natural per-iteration memo and op key.
3. It makes the budget a property of one entity.
4. It matches E §E2.
5. Map, sub-workflow and dynamic expansion need the same "container node with child scopes" machinery anyway (§4.8). Option (a) would still need all of that and adds cycle semantics on top.

### 2.3 Definition schema

These types go in `packages/shared/src/types/StageDefinition.ts`. The zod lives in `packages/shared/src/schemas/stage.ts` so the server routes, SDK and script materializers all validate the same way; today the materializers bypass zod (slice A).

```ts
// common
const StageKey = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);  // unique per workflow; replaces name refs (F-13)
const Expr     = z.string().min(1).max(2000);                 // Expression v2 (§4.6), parsed + type-checked at save

const Budget = z.object({
  maxTurns:       z.number().int().positive().optional(),     // sum of harness turns (one per harness.usage event)
  maxCostUsd:     z.number().positive().optional(),           // sum of harness.usage cost
  maxWallClockMs: z.number().int().positive().optional(),
}).strict();

const Timeouts = z.object({
  queueMs:   z.number().int().positive().default(1_800_000),  // ready -> starting (admission wait)
  attemptMs: z.number().int().positive().optional(),          // agent time per attempt; HITL wait excluded (B-7)
  idleMs:    z.number().int().positive().default(600_000),    // no harness event while running (B-8)
  totalMs:   z.number().int().positive().optional(),          // across attempts
}).strict();

const JoinPolicy = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('any'),    cancelRemaining: z.boolean().default(false) }),
  z.object({ mode: z.literal('n_of_m'), n: z.number().int().min(1), cancelRemaining: z.boolean().default(false) }),
]);

const OutputContract = z.object({
  format:     z.enum(['text', 'json']).default('text'),
  schema:     z.record(z.unknown()).optional(),               // real JSON Schema (ajv 2020-12)
  extraction: z.enum(['auto', 'tool', 'final_json_block']).default('auto'),
  rules:      z.array(ResultValidationRule).default([]),      // hard rules; custom_script gains args[] (F-9)
}).strict();

const StageBase = {
  id: z.string(), key: StageKey, name: z.string().min(1),
  parentId: z.string().nullable().default(null),              // enclosing container (loop/map); null = top level
  guard: Expr.optional(),                                     // replaces StageCondition; false => skipped(guard_false)
  join: JoinPolicy.default({ mode: 'all' }),
  retry: RetryPolicyV2.optional(),                            // §3.2
  repair: RepairPolicy.optional(),                            // §3.2, §3.4
  onExhausted: z.enum(['pause', 'fail']).default('pause'),
  timeouts: Timeouts.optional(),
  budget: Budget.optional(),
  compensate: z.array(HookDefinition).optional(),             // §3.9
};

const AgentStage = z.object({
  ...StageBase, kind: z.literal('agent'),
  prompts: z.array(PromptDefinition).min(1),
  followUpPrompts: z.array(PromptDefinition).optional(),      // used when iteration > 0 or feedback present; default = prompts
  agentRef: z.string().optional(),
  harnessConfigOverrides: HarnessConfigPartial.optional(),
  output: OutputContract.default({}),
  context: z.object({                                         // replaces contextFilter / contextSources
    from: z.array(StageKey).optional(),                       // default: direct preds (body roots inherit the loop's preds)
    mode: z.enum(['summary', 'output', 'structured', 'none']).default('summary'),
  }).default({}),
  session: z.enum(['fresh', 'continue']).default('fresh'),    // continue = same conversation across loop iterations
  sessionGroup: z.string().optional(),                        // sequential stages sharing one conversation (replaces run 'single', B-9)
  feedback: z.object({                                        // §2.6
    from: z.array(StageKey).min(1),                           // body stages of the SAME loop fed back from iteration k-1
    render: z.enum(['message', 'none']).default('message'),
    select: Expr.optional(),                                  // default: loop.previous.stages.<from>.output.comments
  }).optional(),
  approval: ApprovalGate.optional(),
  expands: DynamicExpansion.optional(),                       // §4.7
});

const LoopStage = z.object({
  ...StageBase, kind: z.literal('loop'),
  loop: z.object({
    maxIterations: z.number().int().min(1).max(25),           // required hard cap
    until: Expr,                                              // do-while: evaluated after each iteration's body is terminal
    budget: Budget.optional(),                                // cumulative over all iterations of this loop instance
    onExhausted: z.enum(['pause', 'fail', 'accept_last']).default('pause'),
    onBodyFailure: z.enum(['fail', 'next_iteration']).default('fail'),
    output: z.enum(['last', 'all']).default('last'),
  }).strict(),
});

const MapStage         = z.object({ ...StageBase, kind: z.literal('map'),         map: MapConfig });          // §4.3
const SubworkflowStage = z.object({ ...StageBase, kind: z.literal('subworkflow'), subworkflow: SubwfConfig }); // §4.4
const WaitStage        = z.object({ ...StageBase, kind: z.literal('wait'),        wait: WaitConfig });        // §4.5
export const StageSpec = z.discriminatedUnion('kind', [AgentStage, LoopStage, MapStage, SubworkflowStage, WaitStage]);

export const EdgeSpec = z.object({
  id: z.string(), from: z.string(), to: z.string(),
  on: z.enum(['success', 'failure', 'completion', 'always']).default('success'),
  when: Expr.optional(),                                      // typed edge condition; false => edge inactive
  handlesFailure: z.boolean().optional(),                     // lets on=completion|always count as handling a failure (B-16)
}).strict();
```

`IterationConfig` and the `stage_definitions.iteration_config` column are deleted; `subworkflow` replaces them.

**Validator rules** (added to `validateDAG` in `domain/dag/DAGValidator.ts`, each with a new `DAGValidationIssue.code`):
- `edge-crosses-scope`: an edge's `from` and `to` must share a `parentId`. External predecessors connect to the loop node, and external successors connect from it.
- `empty-body`: a container has at least one child, and its body has at least one root.
- `cycle`: Kahn's algorithm runs per scope. The container tree has depth ≤ 3 (`nesting-too-deep`).
- `duplicate-key`: stage keys are unique within the workflow.
- `until-unbound`: `loop.until` must reference a typed field of at least one body stage.
- `expr-type`: every `guard`, `when` and `until` expression parses and type-checks against the declared `output.schema`s. It may only reference stages that precede it in its own scope, the loop's current or previous iteration, or ancestors' predecessors.
- `feedback-scope`: every `feedback.from` stage is in the same loop body.
- `session-continue-outside-loop` (warning): `session: continue` has no effect outside a loop.

### 2.4 How the review verdict is produced

The review stage declares a typed output contract:

```jsonc
"output": { "format": "json", "extraction": "auto", "schema": {
  "type": "object", "required": ["verdict", "comments"], "additionalProperties": false,
  "properties": {
    "verdict":  { "enum": ["approve", "changes_requested"] },
    "summary":  { "type": "string", "maxLength": 4000 },
    "score":    { "type": "number", "minimum": 0, "maximum": 10 },
    "comments": { "type": "array", "maxItems": 50, "items": {
      "type": "object", "required": ["id", "severity", "body"],
      "properties": { "id": { "type": "string", "pattern": "^C[0-9]+$" },
        "severity": { "enum": ["blocker", "major", "minor", "nit"] },
        "file": { "type": "string" }, "line": { "type": "integer" },
        "body": { "type": "string" }, "suggestion": { "type": "string" } } } } } } }
```

A new `OutputExtractor` (`packages/core/src/services/engine/OutputExtractor.ts`) resolves `extraction: auto` in order:
1. **Tool channel (preferred).** When the provider supports in-process custom tools (Claude Agent SDK in-process MCP, Codex function tools), the executor registers a `submit_output` tool whose input schema is `output.schema`, and appends one instruction line: "When done, call submit_output exactly once".
   - The handler validates with ajv. On failure it returns the ajv errors **as the tool result**, so the model repairs inside the same turn at zero extra turns.
   - The first valid call is stored as `stage_attempts.structured_output`.
2. **Fallback.** Take the **last fenced json block of the last assistant message of the current attempt's prompt turns**, and validate it with ajv. Messages carry a new `turn_role` (context, feedback, prompt, repair, summary, approval_feedback), so context-ack, summary and earlier attempts are excluded. This fixes F-6, F-7 and B-11.
3. **Still invalid:** raise `RepairableError('output_schema', ajvErrors)` and go to the repair turn (§3.5 step 1).

For `format: json` stages the text summary turn is dropped: the summary is `output.summary` or else a list of keys. That saves one model turn per iteration (F O-3). The output-retry-under-50-chars turn (F-10) is deleted; the output contract replaces it.

### 2.5 The exit condition

The simple form is `until: "stages.review.output.verdict == 'approve'"`. Stricter variants in Expression v2:
- `count(stages.review.output.comments, c => c.severity in ['blocker','major']) == 0`
- `stages.review.output.score >= 8`

`until` is evaluated **only after every instance in iteration scope k is terminal**. An evaluation error (a missing field) counts as **not satisfied**: the loop emits `loop.until_error` and continues, still bounded by `maxIterations` and the budget.

### 2.6 Carrying feedback into the next Fix iteration

There are two complementary mechanisms. The actor resolves both at launch time into `LaunchRequest.inputs`, so the executor never reads other stages.

1. **Templating scopes.** Handlebars-lite syntax with `{{path | filter}}` and `{{#if path}}`. Paths are Expression v2 paths:
   - `loop.iteration` (0-based), `loop.number` (1-based), `loop.maxIterations`, `loop.remaining`
   - `loop.previous.stages.review.output.comments` (filters: `bullets`, `json`, `yaml`)
   - `stages.triage.output.summary`: outside the loop, from an earlier stage
   - `stages.fix.output.addressed`: the current iteration

   In iteration 0, `loop.previous` is null. That is legal and typed as nullable, so it renders empty with no unresolved-variable warning.
2. **The `feedback` binding** (the default on generator stages in the preset). For iteration k ≥ 1 the executor sends one structured feedback turn before `followUpPrompts`:

   ```
   ## Review feedback: iteration {k} of {max} (changes requested)
   Address EVERY comment. Report each as {id, resolution: fixed|wontfix, note} in your output field `addressed`.
   - [C1][blocker] src/a.ts:42 Null deref when ... (suggestion: ...)
   - [C2][minor] ...
   ```

   - It is persisted with `turn_role: feedback` and journalled as op `e{n}.r0/feedback/0`.
   - The review prompt of iteration k ≥ 1 gets both the previous comments and `stages.fix.output.addressed`, so the reviewer verifies each item by id instead of re-reviewing from scratch.

### 2.7 Session reuse across iterations

| Stage | Default | Why |
|---|---|---|
| Generator (Fix) | `session: continue` | The model remembers what it changed and why. This is cheaper (no context re-injection or re-exploration) and addresses the comments precisely. |
| Evaluator (Review) | `session: fresh` | The reviewer stays unbiased and does not anchor on its own earlier verdict. The previous comments are injected explicitly (§2.6). |

Mechanics:
- `stage_runs.session_key` is chosen as follows:
  - `continue`: `{loopInstanceId}/{stageKey}`
  - `sessionGroup`: `{scopeInstanceId}/group/{name}`
  - otherwise: the stage_run id.
- A new `run_sessions(run_id, session_key)` table maps keys to live sessions. It replaces `session_allocations` and `stage_session_maps`.
- `SessionAllocator.acquire(runId, sessionKey, configHash)` returns the live session when the config hash matches. Otherwise it creates a new session seeded with a recap.
- **Release rule.** A session is released when the **scope owning its key** reaches a terminal state (for `continue`, the loop instance), or when the run finalizes. Stage completion never releases it. This fixes B-12 and B-15 as a class.
- **Crash or lost provider session.** A new session is seeded with the existing replay recap (`injectReplayedTurns`, `SES:1532-1573`) plus one-line summaries of previous iterations taken from `loop_state.history`.
  - Resume must use `sessions.provider_session_id`, which fixes F-3b.
- **Context growth.** This is bounded by `loop.budget.maxTurns`. There is an optional `compactAfterIterations: n`, off by default, which switches the generator to fresh plus a digest after n iterations.

### 2.8 Runtime semantics (pure; `packages/core/src/domain/scheduler/loops.ts`)

```ts
export function decideLoop(loop: CompiledLoop, inst: InstanceState, scopes: ScopeView, usage: UsageView, now: number): Decision[] {
  switch (inst.status) {
    case 'ready':                                   // deps satisfied: open iteration 0
      return [T(inst, ['ready'], 'running', { loopState: initLoopState(now) }), ...createIteration(loop, inst, 0)];
    case 'running': {
      const k = inst.loopState.iteration;
      const it = scopes.get(inst.path + '#' + k);
      if (!it.allTerminal) return enforceBudgetsMidIteration(loop, inst, usage, now); // may emit abort_executor
      const outcome = it.terminalOutcome();         // same algorithm as the run level (§3.6)
      if (outcome === 'failed' && loop.onBodyFailure === 'fail') return failLoop(inst, 'body_failed');
      const done = outcome !== 'failed' && evalUntil(loop.until, it.outputs(), inst.loopState) === true;
      const hist = appendHistory(inst.loopState, k, it, usage);
      if (done) return completeLoop(inst, hist, 'condition');
      if (k + 1 >= effectiveMax(loop, inst)) return exhaust(loop, inst, hist, 'max_iterations');
      const b = budgetExceeded(loop.budget, hist, now);        // 'budget_turns' | 'budget_cost' | 'wall_clock'
      if (b) return exhaust(loop, inst, hist, b);
      return [T(inst, ['running'], 'running', { loopState: { ...hist, iteration: k + 1 } }), ...createIteration(loop, inst, k + 1)];
    }
    default: return [];                              // awaiting_input (exhausted, pause) waits for a command
  }
}
function exhaust(loop, inst, hist, reason): Decision[] {
  if (loop.onExhausted === 'fail') return failLoop(inst, reason);
  if (loop.onExhausted === 'accept_last') return completeLoop(inst, hist, 'exhausted_accepted');
  return [T(inst, ['running'], 'awaiting_input', { loopState: { ...hist, exitReason: reason },
           interrupt: { kind: 'loop_exhausted', reason, iterations: hist.history.length, last: hist.last } })];
}
```

- **`createIteration`** emits `create_instances` for every body node, with `instance_path = {loopPath}#{k}/{key}`, status `pending`. Body roots then become `ready` through the normal readiness predicate, where their external predecessors are the loop's (already terminal) predecessors.
- **Operator commands on an exhausted loop** go to `POST /workflow-runs/:id/instances/:instanceId/commands`:
  - `grant_iterations {n, budgetDelta?}`: returns to `running`, with `maxIterationsOverride` stored in `loop_state`, and creates the next iteration.
  - `accept`: completes with `exitReason: accepted`.
  - `fail`: fails the loop.
- **Loop output** becomes `stages.review_loop.output`:
  ```
  {iterations, exitReason, last: {bodyKey: output}, history: [{iteration, verdict, costUsd, turns, durationMs}], all?}
  ```
  Downstream stages read `stages.review_loop.output.last.review.summary`. Body stages are not addressable by key from outside the loop; the type checker enforces this.

### 2.9 `stage_runs` modelling for the scenario (approved at iteration 3)

| instance_path | kind | scope_id | iteration_index | status | session_key | attempts |
|---|---|---|---|---|---|---|
| triage | agent | null | 0 | completed | sr id | 1 |
| review_loop | loop | null | 0 | completed (loop_state.iteration=2, exitReason=condition) | null | none |
| review_loop#0/fix | agent | review_loop | 0 | completed | review_loop/fix | 1 |
| review_loop#0/review | agent | review_loop | 0 | completed (changes_requested) | sr id | 1 |
| review_loop#1/fix | agent | review_loop | 1 | completed | review_loop/fix (same conversation) | 2 (529 overloaded, resumed) |
| review_loop#1/review | agent | review_loop | 1 | completed (changes_requested) | sr id | 1 (1 repair) |
| review_loop#2/fix | agent | review_loop | 2 | completed | review_loop/fix | 1 |
| review_loop#2/review | agent | review_loop | 2 | completed (approve) | sr id | 1 |
| open_pr | agent | null | 0 | completed | sr id | 1 |

- `id = uuidv5(NS, runId + '|' + instance_path)`. It is deterministic, so replayed decisions produce identical ids. Combined with the UNIQUE index on `(workflow_run_id, instance_path)`, `INSERT ... ON CONFLICT DO NOTHING` makes instance creation idempotent.
- `scope_id` is the stage_run id of the enclosing container instance. `iteration_index` and `item_index` are denormalized for the UI.
- Nested loops produce paths like `outer#1/inner#0/fix`.

### 2.10 Durable operation-id keys

| Level | Key | Notes |
|---|---|---|
| Run | workflow_runs.id | |
| Node instance | stage_runs.id = uuidv5(runId, instance_path) | The iteration and map item are in the path, so keys cannot collide across iterations (the Mastra #24044 / #24581 class). |
| Attempt | stage_attempts (stage_run_id, attempt_no) UNIQUE | |
| Journal scope | DurableContext { scope: stage_run, scopeId: stageRunId } | The API is unchanged. |
| Turn op id | `e{epoch}.r{repair}/{turnKind}/{i}`, for example `e1.r0/feedback/0`, `e1.r0/prompt/0`, `e1.r1/repair/0` | Rules below. |
| Loop decision | `loop_state.history[k]` | Written in the same transaction as the create_instances for k+1. A replayed decision finds the rows already there. |

Turn op-id rules:
- `epoch` increments only on a **restart** retry.
- A **resume** retry keeps the epoch. Settled turns replay, and only the failed turn re-runs. On a reported (non-crash) failure the executor calls `discardOperation(ctx, opId)` (which already exists in `DurableExecutionEngine`) on the in-flight op, so the resume re-executes it.
- `repair` increments once per repair turn within an attempt.
- `turnKind` is one of: context, feedback, prompt, repair, summary, approval_feedback.
- The instance path appears in logs and spans, not in the op id, because the scope id already disambiguates.

### 2.11 Budgets and exhaustion

**Accounting.**
- The executor accumulates `usage {turns, costUsd, inputTokens, outputTokens}` from `harness.usage` events into `stage_attempts.usage`.
- While the attempt is live, it posts throttled `usage_tick` messages to the actor (at most one per 5 s).
- On settlement, the actor rolls usage up into `stage_runs.usage`, the container's `loop_state.usage` and `workflow_runs.usage`, all in the same transaction.

**Stage-level limits** are passed to the harness where supported: Claude `maxTurns` and `maxBudgetUsd` map to `error_max_turns` and `error_max_budget_usd`. For other providers the engine enforces them through `usage_tick`.

**Loop-level limits:**
1. **Iteration boundary (soft).** Do not open iteration k+1 when a budget is exceeded, or when `used + avgIterationCost > max`. The projection applies to cost only and is on by default.
2. **Mid-iteration (hard).** When usage exceeds 1.25 times the maximum, the actor emits `abort_executor(reason: budget)` for in-flight body instances.
   - They settle as `failed {class: deterministic, code: budget_exceeded}` and are never retried.
   - The loop then exhausts, with the last complete iteration as its output.
3. **Wall clock.** A `workflow_timers` row of kind `loop_wall_clock` is armed at loop start.

**Run-level budget.** `workflow_runs.budget` works the same way: it refuses new launches, and the run pauses when it is reached.

**Default on exhaustion is pause.** For coding loops a human should decide whether to spend more, accept, or fail. `fail` throws the work away, and `accept_last` silently ships unapproved code.
- Unattended runs (automation or webhook triggered) get `pauseTtlMs`, default 72 h, stored as a `workflow_timers` row of kind `pause_ttl`. When it expires the instance fails with code `pause_expired`.
- "Take best" is `accept_last` with `select: best_by` over `history[].score`. It is only meaningful when the workspace can be restored to that iteration's git checkpoint, which `CheckpointService` captures per attempt. This is a phase-5 extension.

### 2.12 UI

| Where | What | Files |
|---|---|---|
| Builder | "Wrap in loop" on a multi-select. The loop is a React Flow group node (parentId, extent: parent). The side panel holds max, until (expression editor with autocomplete from output schemas), budget and onExhausted. The "Review loop" preset lives here. | apps/web/src/pages/WorkflowBuilderPage.tsx; new components/workflow/builder/LoopGroupNode.tsx and ExpressionEditor.tsx |
| Run graph | The loop group shows an `n/max` badge and a status ring. Hovering shows per-iteration history (verdict, cost). An exhausted loop shows an amber "Needs decision" chip. | components/workflow/RuntimeDAGCanvas.tsx, RuntimeStageNode.tsx; new RuntimeLoopGroup.tsx |
| Iteration tabs | Tabs (Iter 1, Iter 2, Iter 3 current) in the group and in the stage panel switch which instance rows render. The Fix conversation is one transcript with iteration dividers. `turn_role = feedback` messages render as a "Review feedback" card linking to the comments. | pages/WorkflowRunPageV2.tsx; new components/workflow/IterationTabs.tsx |
| Timeline | The loop is a lane, and each iteration is a segment coloured by its verdict. Attempts and repairs are sub-bars, which fixes F O-5. | components/workflow/RunTimeline.tsx |
| Decision card | For `loop_exhausted`: "Grant +1 / +2", "Raise budget", "Accept current", "Fail", with the last review comments shown | new components/workflow/LoopExhaustedCard.tsx |
| Why? | Skipped or blocked nodes show `skip_reason` / `blocked_on` from the decision journal | RuntimeStageNode.tsx |

### 2.13 Observability

**Events** (outbox, then run scope and global):
- `loop.iteration_started {loopInstanceId, iteration, maxIterations}`
- `loop.iteration_completed {iteration, outcome, untilValue, verdict, costUsd, turns, durationMs}`
- `loop.exhausted {reason, iterations}`
- `loop.completed {exitReason, iterations}`
- `loop.until_error`
- `stage_run.attempt_started / attempt_failed {attemptNo, mode, errorClass, errorCode, retryInMs}`
- `stage_run.repairing {repairNo, reason}`

**Metrics:**
- `workflow.loop.iterations` histogram (labels: workflow, loop key, exitReason)
- `workflow.loop.cost_usd`
- `workflow.stage.attempts`
- `workflow.stage.repairs`
- `workflow.scheduler.decision_latency_ms`
- `workflow.scheduler.cas_conflicts`

**OTel spans:** workflow.run, then workflow.loop review_loop, then workflow.iteration 2, then invoke_agent fix (with gen_ai usage attributes), then chat / execute_tool.

**Decision journal.** The `scheduler_journal` table (§6) records every processed message with its decisions and a state hash. It powers the "Why?" UI and the replay tests.

### 2.14 The scenario as a definition (abridged)

```jsonc
{ "stages": [
  { "key": "triage", "kind": "agent", "prompts": [{ "text": "Triage issue {{variables.issue_url}} ..." }],
    "output": { "format": "json", "schema": { "required": ["summary", "files", "plan"] } } },
  { "key": "review_loop", "kind": "loop",
    "loop": { "maxIterations": 4, "until": "stages.review.output.verdict == 'approve'",
              "budget": { "maxCostUsd": 15, "maxTurns": 300, "maxWallClockMs": 5400000 }, "onExhausted": "pause" } },
  { "key": "fix", "parentId": "review_loop", "kind": "agent", "session": "continue",
    "prompts": [{ "text": "Fix the issue. Triage: {{stages.triage.output.summary}}. Plan: {{stages.triage.output.plan | bullets}}" }],
    "followUpPrompts": [{ "text": "Address the review feedback above, re-run the tests, then submit your output." }],
    "feedback": { "from": ["review"] },
    "output": { "format": "json", "schema": { "required": ["changes", "addressed"] } },
    "retry": { "maxAttempts": 3, "mode": "resume" } },
  { "key": "review", "parentId": "review_loop", "kind": "agent", "session": "fresh",
    "prompts": [{ "text": "Review the diff for {{variables.issue_url}}. {{#if loop.previous}}Previous comments: {{loop.previous.stages.review.output.comments | json}}. Fix report: {{stages.fix.output.addressed | json}}{{/if}}" }],
    "output": { "format": "json", "schema": "<review schema, §2.4>" }, "repair": { "maxRepairs": 2 } },
  { "key": "open_pr", "kind": "agent", "prompts": [{ "text": "Open a PR. Review summary: {{stages.review_loop.output.last.review.summary}}" }] } ],
  "edges": [ { "from": "triage", "to": "review_loop" }, { "from": "fix", "to": "review" }, { "from": "review_loop", "to": "open_pr" } ] }
```

---

## 3. Retry and failure

### 3.1 Error taxonomy

`packages/core/src/domain/errors/StageError.ts` (new):

```ts
export type ErrorClass = 'transient' | 'deterministic' | 'repairable' | 'interrupted';
export type StageErrorCode =
  | 'rate_limited' | 'overloaded' | 'provider_5xx' | 'transport' | 'provider_crashed' | 'idle_timeout' | 'attempt_timeout'   // transient
  | 'auth' | 'model_not_found' | 'quota_exhausted' | 'context_overflow' | 'max_turns' | 'budget_exceeded'
  | 'config_invalid' | 'agent_not_found' | 'pre_run_hook_abort' | 'rejected_by_human' | 'pause_expired' | 'condition_error' // deterministic
  | 'output_schema' | 'validation_rule' | 'missing_artifact'                                                                 // repairable
  | 'process_restart_unsafe' | 'lease_expired';                                                                             // interrupted
export interface ClassifiedError {
  class: ErrorClass; code: StageErrorCode; message: string;
  retryAfterMs?: number;         // honoured over computed backoff (429 Retry-After)
  inFlightOpId?: string;         // turn that was running; discarded before a resume
  details?: unknown;             // e.g. ajv errors, failing rule ids
}
export function classifyStageError(err: unknown): ClassifiedError;   // maps HarnessError codes, AdmissionTimeoutError, etc.
```

- Providers throw `HarnessError {code}`. The mapping lives in `packages/agent-harness-providers/src/errors.ts`. Unknown errors default to `transient` with code `transport`, but **at most one retry**, so an unclassified bug does not burn the whole budget.
- Errors thrown **before** the attempt body (agent resolution, `pre_run` abort, session allocation) also go through `classifyStageError`. This fixes the "no retry, no on_error hook" gap in B `(c)`.

| Class | Default action | Examples |
|---|---|---|
| transient | retry with backoff; mode = resume | 429, 529, 5xx, socket reset, CLI crash, idle watchdog |
| deterministic | no retry; go to routing and onExhausted | auth, model missing, budget, max_turns, human rejection |
| repairable | repair turn(s) in the same session, then (optionally) a restart retry with feedback | schema-invalid JSON, failed validation rule |
| interrupted | never-replay turn in flight at crash: **pause** (operator: resume / mark done / restart). Safe-replay turn: automatic resume | process restart, lease expiry |

### 3.2 Retry policy v2

```ts
const RetryPolicyV2 = z.object({
  maxAttempts:       z.number().int().min(1).max(10).default(3),   // includes the first attempt
  initialDelayMs:    z.number().int().min(0).default(2000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
  maxDelayMs:        z.number().int().default(60_000),
  jitter:            z.enum(['full', 'equal', 'none']).default('full'),
  retryOn:           z.array(StageErrorCode).optional(),           // default: every transient code
  mode:              z.enum(['resume', 'restart']).default('resume'),
  restoreCheckpointOnRestart: z.boolean().default(true),           // git checkpoint captured at attempt 1 start
});
const RepairPolicy = z.object({
  maxRepairs:         z.number().int().min(0).max(5).default(2),   // separate budget from retries (fixes O-8)
  restartOnExhausted: z.boolean().default(true),                   // consume one retry attempt as a restart carrying feedback
});
// delay(n) for the n-th retry (n >= 1):
//   base = min(maxDelayMs, initialDelayMs * backoffMultiplier^(n-1))
//   full: rand(0, base) | equal: base/2 + rand(0, base/2) | none: base
//   final = max(retryAfterMs ?? 0, delay)
```

The randomness is drawn in the executor/effects layer, **not** in `decide()`. `decide` emits `schedule_timer {kind: retry, baseDelay, jitter}`, and the effects layer computes the concrete `fire_at` and persists it. Replay reads the persisted `fire_at`, so `decide` stays deterministic.

Defaults:
- Agent stages: `maxAttempts: 2`. Transient errors only.
- Wait, loop and map containers: no retry. Their children retry.
- Execution retry and validation are no longer coupled. The old default of one blind retry is gone.

### 3.3 Resume in session vs restart

| | Resume (default for transient and interrupted-safe errors) | Restart |
|---|---|---|
| Session | Same `session_key`, so the same conversation. If the provider session is gone, a new session plus a journal recap. | New session, and a new `session_key` generation unless `continue` is set |
| Journal | Same epoch. Settled turns replay; the in-flight op is `discardOperation`'d and re-run. | New epoch: nothing is memoized |
| First message | Before re-sending the failed turn: "The previous request failed (overloaded). Continue from where you stopped; do not redo completed steps." | Prompts from step 0. With repair exhaustion, the validation feedback is included (`{{attempt.previousError}}`). |
| Workspace | Untouched | Optionally restored to the attempt-1 "before" checkpoint (`restoreCheckpointOnRestart`) so the agent does not build on half-applied edits |
| When chosen | `retry.mode = resume`, and the error class is transient or interrupted-safe | `retry.mode = restart`; repair exhausted with `restartOnExhausted`; operator chose "Restart" |

### 3.4 Repair turn mechanics (inside the executor, not the actor)

1. The attempt reaches `validating` through CAS `running → validating`.
2. The executor runs, in order: `OutputExtractor`, the ajv schema check, then the hard `rules`. Each rule is bounded: `custom_script` has a 60 s timeout, and all rules share a per-process validation semaphore of 4.
3. On failure with `repair_count < maxRepairs`, the executor does CAS `validating → running` with `repair_count + 1`. It then sends the repair message, which is the specific failures (ajv paths, rule ids) and "resubmit via submit_output", as op `e{n}.r{m}/repair/0`, and loops back to step 1.
4. On success it posts `attempt_settled {succeeded, output}`. The actor's transaction then does `validating → completed` and activates successors (§5.5).
5. When repairs are exhausted it posts `attempt_settled {failed, class: repairable}`, and the actor applies §3.5.

### 3.5 Exact precedence

```text
on attempt_settled(failed, e) for instance S (actor, one transaction):
 0. if S.status not in {starting, running, validating} (cancelled/paused by user first): drop outcome (CAS fails). STOP.
 1. REPAIR     handled in the executor before it reports (3.4). A repairable error arriving here means repairs are exhausted.
 2. RETRY      if run.status in {running, waiting}
               and (e.class == transient, or e.class == interrupted with a safe replay,
                    or (e.class == repairable and repair.restartOnExhausted))
               and e.code in retry.retryOn
               and attempt_no < retry.maxAttempts
               and totalMs deadline not passed and no budget exhausted
             => S: -> retry_wait; next_attempt_at = now + delay; timer(kind=retry); attempt.mode = resume or restart.
               STOP.
 3. ROUTE      if S has >= 1 outgoing edge with on == failure, or handlesFailure (active under edge.when)
             => S: -> failed(error_class, error_code); reconcile activates the on_failure successors.
               STOP. The failure is "handled" only if a handler path completes (3.6).
 4. EXHAUSTED  S.onExhausted == pause => S: -> paused(status_reason = retries_exhausted | deterministic:<code>).
                                        The run becomes waiting if no other work remains. The operator decides (3.7).
               S.onExhausted == fail  => S: -> failed. Reconcile skips dependents; the run finalizes to failed.
Exceptions:
 - rejected_by_human: skip steps 2 and 4-pause, and go straight to failed (routing still applies).
 - cancelled: never retried and never routed as a failure. cancelled is its own terminal state.
 - Inside a loop body: the same algorithm within the scope. An unhandled body failure makes the scope outcome failed,
   and the loop applies onBodyFailure, then the loop's own ROUTE/EXHAUSTED steps. The loop has no RETRY step.
```

### 3.6 on_failure routing and the run's terminal outcome (fixes B-16)

The v2 replacement for `computeTerminalRunStatusFor` is `computeScopeOutcome` in `domain/scheduler/terminal.ts`. A failed instance F is **handled** when some outgoing edge `e` of F is **active** and a **failure handler** (`e.on == failure`, or `e.handlesFailure`), and `e.to` is `completed` or is itself a handled failed instance. `always` and `on_completion` edges still *run* their targets (cleanup and notify), but they no longer absorb the failure.
- Scope outcome is `failed` if any unhandled `failed` instance exists.
- Otherwise it is `cancelled` if any unhandled `cancelled` instance exists.
- Otherwise it is `completed`.

`paused` is not terminal, so a run with a paused stage is never finalized.

### 3.7 Pause on exhaustion: operator actions

These go to `POST /workflow-runs/:runId/instances/:instanceId/commands`. The body is `{command, expectedVersion, ...}`, and a stale `expectedVersion` returns 409.

| Command | Transition | Effect |
|---|---|---|
| retry {mode: resume or restart, promptOverride?, variablesOverride?} | paused → ready | A new attempt. Overrides are stored on the attempt row, which is auditable. |
| skip {as: completed or skipped, output?} | paused → skipped (skip_reason = operator; `gate_as` = completed or skipped) | `gate_as: completed` makes on_success successors run, which settles B-18's override question. The optional output must validate against the schema. |
| fail | paused → failed | Normal routing |
| cancel | paused → cancelled | |

`pause_ttl` timers apply to unattended runs (§2.11).

### 3.8 Rerun from a stage, and fork

A terminal run is never mutated (the X-24 principle is kept). `WorkflowRunService.forkRun` replaces `retryRun`:

```ts
forkRun(sourceRunId: string, opts: {
  rerunFrom: string[];                       // instance paths, e.g. ['review_loop'] or ['review_loop#1/fix']
  definition: 'pinned' | 'latest';           // 'latest' => memoize only instances whose compiled-spec hash matches
  variablesOverride?: Record<string, unknown>;
  workspace: 'restore_checkpoint' | 'reuse' | 'fresh';
  idempotencyKey?: string;                   // double-click safe (F-15)
}): Promise<WorkflowRun>
```

- **Memoized set** = every instance not downstream of any `rerunFrom` path. Those rows are copied with `copied_from_stage_run_id` set and status `completed`. They are never re-validated, because validation is part of the attempt and not of the actor (this fixes B-6).
- **Rerunning inside a loop** (`review_loop#1/fix`): iterations 0 through k-1 are copied, and the loop instance is re-created in `running` with `loop_state.iteration = k`.
- **Workspace:** `restore_checkpoint` restores the git checkpoint captured before the earliest re-run instance's first attempt. Checkpoints are already stored per stage attempt. It also re-runs the orchestrator phases (clone, preprocess) inside the run's `starting` state, which fixes B-6 and C-1.
- **In-place retry** exists only for **non-terminal** runs (a paused instance, §3.7). The route `POST /stages/:id/retry` without context is deleted (B-5).

### 3.9 Compensation hooks

- **Per stage:** `compensate: HookDefinition[]` plus the built-in `{type: 'restore_checkpoint'}`.
- **Per workflow:** `onExit: HookDefinition[]` and `onFailure: HookDefinition[]`.
- **When they run:** in the run's `finalizing` state (outcome failed) or `cancelling` state. Compensations run for `completed` instances that declare them, in **reverse completion order** (LIFO, the saga pattern). Each one is journalled as an effect with op id `compensate/{stageRunId}` in the run scope, with 3 retries. A failed compensation marks the run `failed` with `status_reason = compensation_failed`, but does not stop the others.
- **Post-processing** (commit, push, PR) also moves into `finalizing` (outcome completed) as journalled run-scope effects. This deletes the 24 h listener (B-19), and because the transition is a CAS it cannot double-fire.

### 3.10 Crash and interrupt handling

On boot, `RunSupervisor.recover()` handles each non-terminal run:
1. Take the run ownership lease.
2. **Rehydrate sessions first** (fixes B-20).
3. For every instance in starting, running or validating whose lease owner is not this boot id:
   - Settled turn in the journal but no attempt outcome: the executor resumes the attempt, and settled turns replay.
   - The last op is `intent` with replay policy **safe**: re-run it (resume).
   - The last op is `intent` with replay policy **never**:
     - If the persisted assistant message with `turn_role = prompt` exists for that op, treat it as settled. The executor writes settlement and the message in one transaction from now on, which fixes F-3a.
     - Otherwise post `attempt_settled {failed, class: interrupted, code: process_restart_unsafe}`. By §3.5 this leads to `paused` with the reason shown, and **never** to `completed` (fixes B-10 / F-3c).
4. `awaiting_input` instances: the approval payload is durable. After the verdict arrives, the actor moves the instance to `ready`, and a resume attempt carries the verdict. Tool-permission interrupts inside a lost turn become `paused (interrupted)`.
5. `retry_wait` and `waiting` instances: their timers are re-armed from `workflow_timers`.
6. Recovery **never** resets `currentStep` or nulls sessions. The journal is the source of truth.

---

## 4. Other control-flow primitives in the same model

### 4.1 Join policies and the readiness predicate v2

`packages/core/src/domain/scheduler/readiness.ts`:

```ts
type PredState = 'pending' | 'active' | 'dead' | 'neutral';
function predState(pred: Inst, edges: CompiledEdge[] /* all edges pred -> node */, ctx: EvalCtx): PredState {
  if (!isTerminal(pred.status)) return 'pending';
  if (edges.some(e => edgeActive(e.on, pred) && evalWhen(e.when, ctx) === true)) return 'active';
  return pred.status === 'skipped' && pred.gateAs !== 'completed' ? 'neutral' : 'dead';
}
// edgeActive: success -> completed or gateAs completed; failure -> failed;
//             completion -> completed or failed; always -> any terminal state.
export function readiness(node: CompiledNode, preds: Map<string, PredState>): 'ready' | 'blocked' | { skip: SkipReason } {
  const c = count(preds);   // {pending, active, dead, neutral}
  switch (node.join.mode) {
    case 'all':    if (c.dead > 0) return { skip: 'join_unsatisfiable' };    // veto kept: all means all
                   if (c.pending > 0) return 'blocked';
                   return c.active > 0 || preds.size === 0 ? 'ready' : { skip: 'upstream_skipped' };
    case 'any':    if (c.active > 0) return 'ready';                          // discriminator: first satisfied wins
                   return c.pending > 0 ? 'blocked' : { skip: 'join_unsatisfiable' };
    case 'n_of_m': if (c.active >= node.join.n) return 'ready';
                   return c.active + c.pending < node.join.n ? { skip: 'join_unsatisfiable' } : 'blocked';
  }
}
// After 'ready', the node guard is evaluated. false => skip 'guard_false'. An eval error => fail with 'condition_error' (not a silent skip).
```

- Grouping is **per predecessor**, which fixes B-18.
- DB `UNIQUE(from, to)` already allows only one edge per pair. The validator now agrees with it: its duplicate key drops the edge type.
- **`cancelRemaining`** (race): when an `any` or `n_of_m` node becomes ready, the actor cancels still-pending or in-flight predecessors that are **exclusive** to this join, meaning every path out of them leads only into this node. Cancellation is recursive up the exclusive chain, and those instances get `skip_reason = cancelled_loser` (status cancelled). Cancelled losers count as handled for scope outcome, so no false run failure.
- **Late arrivals** after the join has fired are ignored for gating, but their outputs remain addressable.

### 4.2 Explicit skipped propagation

- `skip_reason` values: `guard_false`, `edge_inactive`, `upstream_skipped`, `join_unsatisfiable`, `operator`, `cancelled_loser`, `scope_aborted`.
- A skipped instance is **neutral** to `all` joins, unless `gate_as = completed` (operator skip).
- `always` edges from skipped predecessors activate, which keeps today's behaviour.
- Skip cascades are computed to a fixed point inside `decide`, the same as today, but each skip carries its reason and the id of the causing instance (`skip_cause_id`) for the "Why?" UI.

### 4.3 Map (fan-out over a list output)

```ts
const MapConfig = z.object({
  items: Expr,                                                   // must type-check to an array, e.g. stages.plan.output.tasks
  maxItems: z.number().int().min(1).max(200).default(50),        // more items than this fails the map (deterministic: map_too_large)
  concurrency: z.number().int().min(1).max(16).default(4),
  toleratedFailurePercent: z.number().min(0).max(100).default(0),
  itemLabel: Expr.optional(),                                    // for the UI, e.g. item.title
  output: z.enum(['results', 'results_and_failures']).default('results'),
});
```

- The body is a sub-DAG exactly like a loop body. The actor creates scope `map#i` for every item when the map becomes `running`, so rows exist up front for a stable UI and redrive.
- Readiness of body roots inside scope i is additionally gated by a **scope concurrency counter** computed in `decide`: count the scopes with any non-terminal, non-pending instance. That keeps it pure.
- `item`, `item.index` and `map.count` are template and expression scopes.
- **Outcome:** `failedScopes / total * 100 <= toleratedFailurePercent` gives completed with `output {results: [...], failures: [...]}`; otherwise failed.
- **Fork** can target `map#3/...`, which gives per-item redrive.
- Op keys come for free via `instance_path`.

### 4.4 Sub-workflow

```ts
const SubwfConfig = z.object({
  workflowDefinitionId: z.string(),
  version: z.union([z.literal('pin_at_run_start'), z.number().int()]).default('pin_at_run_start'),
  inputs: z.record(Expr),                                        // child variables = evaluated expressions
  workspace: z.enum(['inherit', 'isolated']).default('inherit'),
  budgetShare: Budget.optional(),                                // carved out of the parent budget
});
```

- **Version pinning:** at parent run creation, the compiler resolves each sub-workflow to a `workflow_definition_versions.id` and embeds that id in the parent's compiled spec. This is recursive, with cycle detection over the definition-id stack and a hard depth limit of 3 (`subworkflow-depth`), and the validator checks it.
- **Runtime:** the stage instance goes `ready → running` and creates a child `workflow_runs` row with `parent_stage_run_id`, `root_run_id` and `depth + 1`. The child's terminal outcome is posted to the parent actor as `child_run_settled`, and its output is the child's declared `outputs` map (`Record<string, Expr>` on the child definition).
- **Cancel and pause** propagate down. Usage rolls up into the parent's budget.
- This replaces `IterationConfig`. A sub-workflow inside a loop body gives "loop over a whole workflow".

### 4.5 Wait and approval

```ts
const WaitConfig = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approval'), form: z.record(z.unknown()).optional(),   // JSON Schema for the approver's input
             prompt: z.string(), timeoutMs: z.number().int().optional(),
             onTimeout: z.enum(['fail', 'complete']).default('fail') }),
  z.object({ type: z.literal('event'), eventKey: Expr, timeoutMs: z.number().int().optional(),
             onTimeout: z.enum(['fail', 'complete']).default('fail') }),
  z.object({ type: z.literal('timer'), durationMs: z.number().int().positive() }),
]);
```

- The instance moves `ready → waiting`. It holds **no** executor, lease or admission slot, which fixes W18 and B-7 by construction.
- A `workflow_timers` row is armed for the timeout. The resolution arrives through the command API or an event with an idempotent CAS `waiting → completed`.
- **Output** is `{outcome: 'approved' | 'rejected' | 'event' | 'timeout', data, by, at}`. Branching uses `when: stages.gate.output.outcome == 'timeout'`, so timeout is a first-class route (E §E5) without a new edge type.
- `approval` stays available as an **agent-stage option** (the review-after-work gate). Internally the executor runs the stage and then parks it in `awaiting_input`.

### 4.6 Expression v2 (conditions on typed outputs)

Location: `packages/core/src/domain/expr/` with `parse.ts` (Pratt parser producing an AST), `typecheck.ts`, `evaluate.ts` and `render.ts` (templating). The ConditionEvaluator and the preprocessor's second grammar are both deleted.

- **Grammar:** literals (strings in quotes, numbers, booleans, null); paths; `== != < <= > >=`; `in`; `and`, `or`, `not` (and `&& || !`); parentheses; functions `len(x)`, `count(list, x => pred)`, `exists(path)`, `lower(s)`.
- **Scopes:**
  - `variables.*`
  - `stages.<key>.{status, output.*, summary, attempts, usage}`
  - `loop.{iteration, number, maxIterations, remaining, previous.stages.<key>.*}`
  - `item`, `map.count`
  - `parent.status`: the edge source, used only in edge `when` expressions
- **Save time:** the parser runs, then the type check uses the JSON Schemas of referenced stages. Unknown identifiers are errors, which fixes B-22 and O-7. Unquoted bare words are errors, not silently false.
- **Runtime:** a path through a missing or null value yields null, and comparisons with null are false. Operand-count errors are impossible after parsing.
- **Equality** is strict by JSON type. The loose `'02134' == 2134` is gone.

### 4.7 Dynamic stage insertion (plan-then-execute)

```ts
const DynamicExpansion = z.object({
  maxStages: z.number().int().min(1).max(20).default(8),
  allowedAgentRefs: z.array(z.string()).min(1),                 // capability clamp
  allowKinds: z.array(z.enum(['agent'])).default(['agent']),    // no nested expansion, loops or sub-workflows in v2
  join: z.enum(['all', 'tolerate']).default('all'),
});
```

- The orchestrator stage's `output.schema` is forced to `{stages: StageSpecLite[], edges: EdgeSpecLite[]}`.
- When it completes, the actor, **in the same transaction as the completion** (a durable decision, per E §E8):
  1. validates the plan against `DynamicExpansion` and the DAG validator;
  2. stores the compiled sub-graph in `stage_runs.expansion`;
  3. creates instances in scope `{path}~x/`.
- Successors of the orchestrator stage wait on an implicit **expansion scope node**, which is a container like map with one scope.
- Recovery replays the stored expansion and **never re-asks the LLM**.

### 4.8 One model for all of them

| Primitive | Container? | Child scopes | Scope outcome → container status | Container output |
|---|---|---|---|---|
| loop | yes | `#0 .. #k`, created lazily | until / budget / onBodyFailure | `{iterations, exitReason, last, history}` |
| map | yes | `#0 .. #n-1`, created eagerly | tolerated failure % | `{results, failures}` |
| subworkflow | yes (child run) | child `workflow_runs` | child terminal outcome | child `outputs` |
| dynamic expansion | yes (implicit) | `~x` | join all or tolerate | `{results}` |
| wait | no | none | resolution or timeout | `{outcome, data}` |
| agent | no | none | attempts | typed output |

`decide()` walks the container tree top-down. For each scope instance it runs the same `readiness` and skip fixed point, then calls the container-specific `decideLoop` / `decideMap` / `decideSubworkflow` when the scope is terminal.

---

## 5. Execution model

### 5.1 Components

```
 routes / SDK / automations --commands--> RunSupervisor --post(runId, msg)--> RunActor(runId)  [serial mailbox]
                                              ^   ^                              1. state = store.loadRunState(runId)    (sync read)
 StageExecutor --attempt_settled/usage_tick---+   |                              2. ds = decide(graph, state, msg, now)  (pure)
 TimerService  --timer_fired----------------------+                              3. res = store.apply(runId, ds)        (ONE sync tx, CAS)
 LeaseReaper   --lease_expired (15 s backstop)----+                              4. effects.dispatch(res.effects)       (after commit)

 effects: launch -> AdmissionController -> StageExecutor.start();  abort -> executor.abort();
          timers -> TimerService.arm();  outbox -> OutboxDispatcher -> EventBus / StreamBroker
```

New code lives under `packages/core/src/`:
- `domain/scheduler/` (pure): `decide.ts`, `readiness.ts`, `terminal.ts`, `loops.ts`, `maps.ts`, `subworkflow.ts`, `expansion.ts`, `types.ts`
- `domain/workflow-graph/compile.ts`: CompiledWorkflow from a definition version (scope tree, per-scope DAG, expressions pre-parsed)
- `domain/state-machines/`: v2 transition tables exported as data
- `services/engine/`: `RunSupervisor.ts`, `RunActor.ts`, `StageExecutor.ts` (carved out of SES), `OutputExtractor.ts`, `ErrorClassifier.ts`, `TimerService.ts`, `LeaseReaper.ts`, `OutboxDispatcher.ts`, `EffectsDispatcher.ts`

`WorkflowRunService` shrinks to a facade: create, start, commands and fork. `DAGScheduler` is deleted, and its pure functions move into `domain/scheduler`.

### 5.2 RunActor

```ts
type RunMessage =
  | { type: 'start' }
  | { type: 'attempt_settled'; stageRunId: string; attemptNo: number; outcome: AttemptOutcome }
  | { type: 'usage_tick'; stageRunId: string; attemptNo: number; usage: Usage }
  | { type: 'child_run_settled'; stageRunId: string; childRunId: string; outcome: 'completed' | 'failed' | 'cancelled'; output?: unknown }
  | { type: 'timer_fired'; timerId: string }
  | { type: 'lease_expired'; stageRunId: string; owner: string }
  | { type: 'command'; command: RunCommand; expectedVersion?: number; reply: (r: CommandResult) => void }
  | { type: 'tick' };                                         // backstop and recovery

type AttemptOutcome =
  | { kind: 'succeeded'; output: StageOutput; usage: Usage }
  | { kind: 'failed'; error: ClassifiedError; usage: Usage }
  | { kind: 'aborted'; reason: 'cancel' | 'pause' | 'budget' | 'superseded' };

export class RunActor {
  post(msg: RunMessage): void;                               // enqueue; processed strictly serially
  private async process(msg: RunMessage): Promise<void> {
    for (let i = 0; i < 3; i++) {                            // bounded retry on CAS conflict
      const state = this.store.loadRunState(this.runId);     // sync reads, about 1 ms for hundreds of rows
      const ds = decide(this.graph, state, msg, this.clock.now());
      const res = this.store.apply(this.runId, ds);          // one synchronous transaction
      if (res.ok) { this.effects.dispatch(res.effects); this.journal(msg, ds, res); return; }
      // res.conflict: an executor-owned CAS raced us, so re-read and re-decide
    }
    this.logger.error('actor: persistent CAS conflict');     // the next tick retries
  }
}
```

- **One actor per active run**, held by `RunSupervisor`. It is created on start or recovery and disposed when the run is terminal.
- **The actor never awaits** a harness call, validation, network I/O or a sleep. Only synchronous DB work happens inside `process`, so a slow stage cannot stall its siblings (B-1).
- **Run ownership lease.** `workflow_runs.owner_id` and `owner_expires_at` form a run-ownership lease, so that in a future multi-process setup only one process hosts a given actor.

### 5.3 decide()

```ts
export function decide(graph: CompiledWorkflow, state: RunState, input: RunMessage, now: number): Decision[];

type Decision =
  | { t: 'transition'; id: string; from: StageRunStatus[]; to: StageRunStatus; expectedVersion?: number; patch?: InstancePatch }
  | { t: 'create_instances'; rows: NewInstance[] }            // deterministic ids; ON CONFLICT DO NOTHING
  | { t: 'create_attempt'; stageRunId: string; attemptNo: number; mode: 'fresh' | 'resume' | 'restart'; overrides?: unknown }
  | { t: 'launch'; stageRunId: string; attemptNo: number }    // effect: admission, then StageExecutor.start(LaunchRequest)
  | { t: 'abort'; stageRunId: string; reason: 'cancel' | 'pause' | 'budget' | 'loser' }
  | { t: 'timer'; kind: TimerKind; stageRunId?: string; baseDelayMs: number; jitter?: Jitter }
  | { t: 'cancel_timer'; kind: TimerKind; stageRunId?: string }
  | { t: 'run_transition'; from: WorkflowRunStatus[]; to: WorkflowRunStatus; patch?: RunPatch }
  | { t: 'usage_rollup'; stageRunId: string; usage: Usage }
  | { t: 'emit'; event: OutboxEvent }                         // persisted in the same tx, dispatched after commit
  | { t: 'finalize'; outcome: 'completed' | 'failed' | 'cancelled' };   // effect: compensation, onExit, post-processing
```

**Determinism rules**, enforced by the replay test:
- no `Date.now()`: use the `now` argument;
- no randomness: jitter is resolved in the effects layer and `fire_at` is persisted;
- ids come from uuidv5;
- iteration order is by `instance_path`;
- it reads nothing outside `state`.

`LaunchRequest` is built by the effects layer from the compiled spec and the state:

```
{stageRunId, attemptNo, mode, epoch, spec, inputs {variables, context, feedback, templateScope}, sessionKey, budgets, deadlines}
```

`spec` always comes from the definition version, never from the live definition (B-13).

### 5.4 CAS API

Implemented in `packages/db/src/repositories/StageRunRepository.ts`, with the port in `packages/core/src/domain/ports/IStageRunRepository.ts`:

```ts
type TransitionResult = { ok: true; row: StageRun } | { ok: false; current: StageRun | null };
transition(id: string, from: readonly StageRunStatus[], to: StageRunStatus, opts?: {
  expectedVersion?: number;
  patch?: InstancePatch;
  lease?: { owner: string; ttlMs: number } | 'clear';
}): TransitionResult;
renewLease(id: string, owner: string, ttlMs: number): boolean;   // only while owner matches and status is starting/running/validating
markProgress(id: string, owner: string, at: number): void;       // caller throttles to one write per 10 s
```

The SQL shape is:

```sql
UPDATE stage_runs
   SET status = :to, version = version + 1, updated_at = :now, <patch columns>, <lease columns>
 WHERE id = :id AND status IN (:from) [AND version = :expected]
RETURNING *;
```

- **Guard:** every `(from, to)` pair must appear in `STAGE_RUN_TRANSITIONS`. Dev and test builds throw; production logs and rejects.
- Entering starting or running always sets `lease_owner`, `lease_expires_at`, `heartbeat_at` and `last_progress_at` in the same statement. That fixes B-2 by construction.
- `status` is removed from `update()`. These methods are deleted, all replaced by `transition()`: `updateStatus`, `batchUpdateStatus`, `interrupt`, `resumeFromInterrupt`, `wake`, `sleep`, `resetForRetry`, `claimForExecution`.
- `WorkflowRunRepository.transition(id, from, to, expectedVersion)` is the run equivalent.
- These methods are **synchronous** (better-sqlite3) so they compose inside `store.apply`.

### 5.5 One transaction for "stage completed plus successors activated"

`RunStore.apply(runId, decisions)` lives in `packages/db/src/repositories/RunStore.ts`. It uses **`sqlite.transaction(() => ...)()`**, the synchronous better-sqlite3 transaction.
- It must **not** use the async `withTransaction` (`db/src/index.ts:245-290`). That helper keeps a raw `BEGIN` open across awaits on the shared connection, and unrelated writes leak into it (slice A).
- Because it is synchronous, nothing else can interleave.

Inside the single transaction:
1. `stage_attempts` gets the outcome, usage and error. The executor has already written the structured output to the attempt row.
2. `transition(S, [validating], completed, patch {output_data, output_text, summary, artifact_manifest, usage})`. A CAS failure means the user cancelled or paused first, so the whole batch is rejected, re-read and re-decided.
3. Successor instances: `transition(succ, [pending], ready)` or `transition(succ, [pending], skipped, reason)`, cascaded.
4. `create_instances` rows (next loop iteration, map scopes, expansion).
5. `workflow_timers` inserts and cancels.
6. `usage` roll-ups on the container and the run.
7. `workflow_runs` transition (running, waiting, finalizing), using a CAS on `version`.
8. `workflow_outbox` rows (one per emit, with sequential `run_seq`).
9. A `scheduler_journal` row: `{seq, message, decisions, stateHashAfter}`.

A crash before commit leaves nothing, and the message is re-derived by the backstop tick from DB state. A crash after commit but before dispatch is covered by the outbox and by launch idempotency (§5.6), because `ready` rows are re-launched by recovery.

### 5.6 Leases, heartbeat and progress

- **Claim:** `transition(S, [ready], starting, {lease: {owner: executorId, ttlMs: 60_000}})`. `executorId` is `{bootId}:{stageRunId}:{attemptNo}`. A duplicate `launch` loses the CAS and becomes a no-op.
- **Liveness:** while the executor frame is alive, `renewLease` runs every 20 s. This covers process death: after a crash the lease expires within 60 s, and on boot every foreign `bootId` is treated as expired at once.
- **Progress** (wedge detection, B-8):
  - Every harness event updates an in-memory `lastProgressAt`, persisted by `markProgress` at most every 10 s.
  - The in-process watchdog aborts the attempt when `now - lastProgressAt > timeouts.idleMs` while the stage is `running`, *and* no permission prompt is open, *and* no tool is marked long-running.
  - The attempt then fails as `transient/idle_timeout`.
  - **Every** turn is wrapped in the attempt deadline, including context, summary, repair and feedback turns (fixes B-8 and F-14).
- **awaiting_input / waiting / retry_wait / paused** set the lease to `clear`. They are never reaped (fixes B-2), and HITL time does not count toward `attemptMs` (fixes B-7).
- **LeaseReaper** (every 15 s) runs:
  ```sql
  SELECT id, lease_owner FROM stage_runs
   WHERE status IN ('starting', 'running', 'validating') AND lease_expires_at < :now
  ```
  For each row it posts `lease_expired`. The actor does a CAS on `(status, lease_owner)`, then aborts best-effort and settles the attempt as `interrupted/lease_expired`. The safe-replay check (§3.10) decides between resume and pause.

### 5.7 Timers

- The `workflow_timers` table has kinds: `retry`, `wait_timeout`, `wait_timer`, `loop_wall_clock`, `pause_ttl`, `queue_timeout`, `run_budget_wall_clock`.
- **TimerService** keeps one in-memory min-heap per process, loaded from `SELECT ... WHERE fired_at IS NULL` at boot. `armTimer` chaining handles delays over 2^31 ms.
- **Firing:** `UPDATE workflow_timers SET fired_at = :now WHERE id = :id AND fired_at IS NULL` (a CAS), then post `timer_fired` to the run actor.
- `DurableSleepService` and the `wake_at` / `slept_since` columns are replaced by this.

### 5.8 Outbox and events

- `OutboxDispatcher` drains `workflow_outbox` in `run_seq` order after each commit, and on boot. It publishes to StreamBroker scope `run`, which is the commit point and **awaited**, and to global lifecycle. Then it sets `dispatched_at`.
- This fixes the run-scope holes from the fire-and-forget republish bridge (B-21) for engine events. Harness deltas keep their current session-scope path.
- `stage_run.completed` and `stage_run.failed` are now emitted by the engine, not by SES on the session channel, so routing cannot depend on the channel again.

### 5.9 Stage-run state machine v2

- **States (13):** `pending`, `ready`, `starting`, `running`, `validating`, `awaiting_input`, `waiting`, `retry_wait`, `paused`, and the terminal states `completed`, `failed`, `skipped`, `cancelled`.
- `sleeping` is folded into `waiting`.
- **Ownership rule:**
  - The **executor** owns in-attempt transitions: starting, running, validating, and the interrupt/resume of awaiting_input while its frame is alive.
  - The **actor** owns everything else.
  - The two only meet through CAS, so the loser stops.
- **Desired-state-first rule:** cancel and pause write the target state **before** aborting the executor, and the executor's next CAS fails. This fixes B-3 and F-1.

| From | To | Event | Owner | Guard / side effects |
|---|---|---|---|---|
| pending | ready | sched:deps_satisfied | actor | join satisfied and guard true |
| pending | skipped | sched:skip | actor | skip_reason, skip_cause_id |
| pending | cancelled | run:cancel | actor | |
| ready | starting | exec:claim | executor | lease set; stage_attempts row status=running |
| ready | skipped | sched:cancel_loser / user:skip | actor | |
| ready | paused | user:pause | actor | |
| ready | cancelled | user:cancel, run:cancel | actor | |
| ready | failed | sched:queue_timeout | actor | deterministic `queue_timeout`; replaces the 30-min admission failure |
| starting | running | exec:session_ready | executor | heartbeat and progress stamped |
| starting, running, validating | retry_wait | sched:attempt_failed (retryable) | actor | timer(retry), lease cleared |
| starting, running, validating | failed | sched:attempt_failed (terminal) | actor | §3.5 steps 3 and 4 (fail) |
| starting, running, validating | paused | sched:attempt_failed (onExhausted=pause); lease_expired unsafe; user:pause; run:pause(interrupt) | actor | abort executor after the write |
| starting, running, validating | cancelled | user:cancel, run:cancel, sched:budget_abort_cancel | actor | abort executor after the write |
| running | validating | exec:output_ready | executor | |
| running | awaiting_input | exec:input_request (tool permission, approval gate) | executor | lease cleared, interrupt_data set |
| validating | running | exec:repair | executor | repair_count + 1; lease re-stamped |
| validating | completed | sched:attempt_succeeded | actor | same transaction as successor activation (§5.5) |
| awaiting_input | running | exec:input_received (frame alive) | executor | lease re-stamped |
| awaiting_input | ready | sched:input_received (no frame, after restart) | actor | resume attempt carries the verdict |
| awaiting_input | failed | user:reject | actor | rejected_by_human |
| awaiting_input | cancelled | user:cancel, run:cancel | actor | cancelWaiter (fixes B-4) |
| waiting | completed | sched:wait_resolved | actor | wait stages only; output = outcome |
| waiting | failed | timer(wait_timeout) with onTimeout=fail | actor | |
| waiting | cancelled | user:cancel, run:cancel | actor | |
| retry_wait | ready | timer(retry) | actor | create_attempt(mode) |
| retry_wait | paused | user:pause, run:pause | actor | cancel_timer |
| retry_wait | cancelled | user:cancel, run:cancel | actor | cancel_timer |
| paused | ready | user:resume / user:retry | actor | new attempt (resume or restart) |
| paused | skipped | user:skip | actor | gate_as = completed or skipped |
| paused | failed | user:fail; timer(pause_ttl) | actor | |
| paused | cancelled | user:cancel, run:cancel | actor | |

**Container nodes** (loop, map, subworkflow, expansion) use a subset, with the actor as the only owner:
- `pending` → `ready` → `running`, where child scopes are created.
- `running` → `awaiting_input`: loop exhausted with onExhausted=pause.
- `awaiting_input` → `running` on grant, or → `completed` on accept, or → `failed`.
- `running` → `completed`, `failed` or `cancelled` from the scope outcome.
- `running` → `paused`, cascaded from run pause. Its children are paused too.

**Terminal states have no exits.** A re-run is a fork (§3.8). This table is exported as `STAGE_RUN_TRANSITIONS: ReadonlyArray<{from, to, event, owner}>`. It is the only source used by `transition()`, the UI's action enablement and the property tests.

### 5.10 Run state machine v2

**States:** `created`, `starting`, `running`, `waiting`, `paused`, `finalizing`, `cancelling`, and the terminal states `completed`, `failed`, `cancelled`.
- `waiting` means nothing is launchable or in flight, but something is `awaiting_input`, `waiting`, `retry_wait` or `paused`. The UI shows "Needs attention" when a paused instance exists, and the backstop tick cadence drops to 60 s.
- `outcome` is decided at the moment of entering `finalizing`.

| From | To | Event | Notes |
|---|---|---|---|
| created | starting | user:start | idempotent via CAS (fixes "double start") |
| starting | running | sys:ready | workspace, clone, preprocess and snapshot done: the orchestrator phases run here for **every** entry point (fixes C-1) |
| starting | failed | sys:setup_error | |
| starting | cancelling | user:cancel | now reachable |
| running | waiting | sys:idle | computed by decide after every message |
| waiting | running | sys:work_available | |
| running, waiting | paused | user:pause {mode: drain or interrupt} | drain stops new launches only; interrupt also pauses in-flight instances (desired state first) |
| paused | running | user:resume | paused-by-run instances go to ready |
| running, waiting | finalizing | sys:scope_terminal {outcome} | CAS; exactly once (B-23) |
| finalizing | completed | sys:finalized | outcome=completed, after onExit and post-processing |
| finalizing | failed | sys:finalized | outcome=failed, after compensation and onFailure/onExit; also when post-processing fails |
| created, starting, running, waiting, paused | cancelling | user:cancel | all non-terminal instances get desired state `cancelled` first (includes awaiting_input and waiting: B-4) |
| cancelling | cancelled | sys:all_stopped | after executors acknowledge or leases expire, then compensation and onExit |
| finalizing | cancelling | user:cancel | skips post-processing, still runs compensation |

- **Pause TTL:** a run paused for longer than `pauseTtlMs` (unattended only) moves to `cancelling`.
- **Retrying a terminal run** is always a fork (§3.8).
- The dead `failed → created` transitions (`sys:recover`, `user:retry`) are removed.

### 5.11 Concurrency

- **Pure limits, enforced in decide:** per-run `maxParallel` (default 4), per-map `concurrency`, per-loop body (loop bodies are usually sequential anyway), plus the `sessionGroup` exclusivity rule: one live stage per session group.
- **Process limits:** the admission lane and the stage semaphore stay in the effects layer. A `launch` waits in the admission queue while the instance stays `ready`. The claim to `starting` happens only once a slot is granted, so the admission wait is never inside an attempt and never burns `attemptMs`.
- **Flow-control keys** (E §I, a later phase): `provider:model`, `harness`, `worktree` (a singleton writer per worktree).
- **The checkpoint lock** (F O-1) moves into `starting` and is skipped for stages without write tools.

---

## 6. Data model and migration

### 6.1 Definition side (altered in place, so definitions survive)

```sql
-- stage_definitions: new columns
ALTER TABLE stage_definitions ADD COLUMN key TEXT;                      -- backfilled, then unique
ALTER TABLE stage_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent';   -- agent | loop | map | subworkflow | wait
ALTER TABLE stage_definitions ADD COLUMN parent_stage_id TEXT REFERENCES stage_definitions(id) ON DELETE CASCADE;
ALTER TABLE stage_definitions ADD COLUMN spec TEXT;   -- JSON: kind-specific config (loop, map, subworkflow, wait, expands),
                                                      -- plus retry v2, repair, onExhausted, timeouts, budget, join, guard,
                                                      -- session, sessionGroup, feedback, followUpPrompts, output contract, compensate
ALTER TABLE stage_definitions DROP COLUMN iteration_config;
CREATE UNIQUE INDEX idx_stage_defs_key ON stage_definitions(workflow_definition_id, key);
CREATE INDEX idx_stage_defs_parent ON stage_definitions(parent_stage_id);

-- stage_edges
ALTER TABLE stage_edges ADD COLUMN when_expr TEXT;
ALTER TABLE stage_edges ADD COLUMN handles_failure INTEGER NOT NULL DEFAULT 0;
-- edge_type keeps its 4 values; UNIQUE(from_stage_id, to_stage_id) is kept (it matches the per-predecessor join)

-- immutable published versions; runs and sub-workflows pin these
CREATE TABLE workflow_definition_versions (
  id                     TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  version                INTEGER NOT NULL,
  content_hash           TEXT NOT NULL,       -- sha256 of the canonical compiled spec
  spec                   TEXT NOT NULL,       -- CompiledWorkflow JSON: stages, edges, harness, hooks, orchestratorConfig, agent projections, subworkflow version ids
  created_at             INTEGER NOT NULL,
  UNIQUE (workflow_definition_id, version),
  UNIQUE (workflow_definition_id, content_hash)
);
ALTER TABLE workflow_definitions ADD COLUMN archived_at INTEGER;       -- soft delete; versions referenced by runs are never deleted
```

Legacy columns such as `condition`, `context_filter`, `retry_policy` and `result_validation` are read once by the backfill into `spec` and then ignored. The drizzle schema drops them from the model, and a later cleanup migration can drop the columns.

### 6.2 Run side (dropped and recreated)

```sql
CREATE TABLE workflow_runs (
  id                     TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  definition_version_id  TEXT NOT NULL REFERENCES workflow_definition_versions(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling', 'completed', 'failed', 'cancelled')),
  status_reason TEXT,
  outcome TEXT CHECK (outcome IN ('completed', 'failed', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 0,
  variables TEXT NOT NULL DEFAULT '{}',
  permission_mode TEXT,
  project_id TEXT, workspace_id TEXT,
  parent_stage_run_id TEXT,                    -- sub-workflow child; FK added below (circular)
  root_run_id TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0,
  ancestor_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  fork_spec TEXT,                              -- {rerunFrom[], definition, variablesOverride, workspace}
  budget TEXT, usage TEXT NOT NULL DEFAULT '{}',
  owner_id TEXT, owner_expires_at INTEGER,
  run_seq INTEGER NOT NULL DEFAULT 0,          -- outbox sequence
  idempotency_key TEXT UNIQUE,
  agent_snapshot TEXT,
  error TEXT, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER
);
CREATE INDEX idx_wr_status ON workflow_runs(status, created_at);
CREATE INDEX idx_wr_definition ON workflow_runs(workflow_definition_id, created_at);
CREATE INDEX idx_wr_parent ON workflow_runs(parent_stage_run_id) WHERE parent_stage_run_id IS NOT NULL;

CREATE TABLE stage_runs (
  id TEXT PRIMARY KEY,                         -- uuidv5(run_id, instance_path)
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_definition_id TEXT NOT NULL,           -- id inside the pinned version spec (no FK: definitions may change)
  stage_key TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
  instance_path TEXT NOT NULL,                 -- 'triage', 'review_loop#2/fix', 'fanout#3/impl'
  scope_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,   -- enclosing container instance
  iteration_index INTEGER, item_index INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'starting', 'running', 'validating', 'awaiting_input', 'waiting', 'retry_wait', 'paused', 'completed', 'failed', 'skipped', 'cancelled')),
  status_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  current_attempt INTEGER NOT NULL DEFAULT 0,
  epoch INTEGER NOT NULL DEFAULT 1,
  session_key TEXT,
  skip_reason TEXT, skip_cause_id TEXT, gate_as TEXT,
  output_data TEXT, output_text TEXT, summary TEXT, artifact_manifest TEXT,
  loop_state TEXT,                             -- {iteration, maxIterationsOverride, exitReason, usage, history[], last}
  expansion TEXT,                              -- compiled dynamic sub-graph (4.7)
  interrupt_data TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  error TEXT, error_class TEXT, error_code TEXT,
  lease_owner TEXT, lease_expires_at INTEGER, heartbeat_at INTEGER, last_progress_at INTEGER,
  copied_from_stage_run_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
  UNIQUE (workflow_run_id, instance_path)
);
CREATE INDEX idx_sr_run_status ON stage_runs(workflow_run_id, status);
CREATE INDEX idx_sr_scope ON stage_runs(scope_id);
CREATE INDEX idx_sr_lease ON stage_runs(status, lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX idx_sr_awaiting ON stage_runs(status) WHERE status IN ('awaiting_input', 'paused');
```

```sql
CREATE TABLE stage_attempts (
  id TEXT PRIMARY KEY,
  stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fresh', 'resume', 'restart')),
  epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'aborted', 'interrupted')),
  session_id TEXT,                              -- sessions.id (no FK: sessions may be purged)
  repair_count INTEGER NOT NULL DEFAULT 0,
  structured_output TEXT,                       -- submit_output payload or extracted JSON
  error TEXT, error_class TEXT, error_code TEXT, error_details TEXT,
  overrides TEXT,                               -- operator prompt or variables override (3.7)
  checkpoint_before_id TEXT,                    -- checkpoints.id captured at attempt start (restart restore, fork)
  usage TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL, ended_at INTEGER,
  UNIQUE (stage_run_id, attempt_no)
);

CREATE TABLE run_sessions (                     -- replaces session_allocations + stage_session_maps
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  owner_scope_id TEXT,                          -- the instance whose terminal state releases it (loop instance for continue)
  config_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'released')),
  created_at INTEGER NOT NULL, released_at INTEGER,
  UNIQUE (workflow_run_id, session_key)
);

CREATE TABLE workflow_timers (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  fire_at INTEGER NOT NULL, fired_at INTEGER, cancelled_at INTEGER,
  payload TEXT
);
CREATE INDEX idx_wt_due ON workflow_timers(fire_at) WHERE fired_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX idx_wt_live_kind ON workflow_timers(workflow_run_id, IFNULL(stage_run_id, ''), kind) WHERE fired_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE workflow_outbox (
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  run_seq INTEGER NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, dispatched_at INTEGER,
  PRIMARY KEY (workflow_run_id, run_seq)
);
CREATE INDEX idx_outbox_pending ON workflow_outbox(dispatched_at) WHERE dispatched_at IS NULL;

CREATE TABLE scheduler_journal (                -- decision log: "Why?" UI + replay tests; pruned 30 days after run terminal
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  message TEXT NOT NULL, decisions TEXT NOT NULL, state_hash TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (workflow_run_id, seq)
);

-- recreated with its FK intact (the DDL and drizzle currently disagree, slice A)
CREATE TABLE automation_execution_runs ( ... same columns ...,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL );
```

**Deleted:**
- `session_allocations`, `stage_session_maps`
- `stage_runs.wake_at`, `slept_since`, `retry_count`, `current_step`, `total_steps`, `parent_stage_run_id` (superseded by the attempt, timer and scope columns)
- `workflow_runs.session_mode`, `master_session_id`, `definition_snapshot` (superseded by version plus session policy)

### 6.3 Migration v55 `workflow_engine_v2` (`packages/db/src/migrations/index.ts`, `disableForeignKeys: true`)

1. **Purge stage-owned conversation data without touching chats.** `chats.session_id` references `sessions(id) ON DELETE CASCADE`, so this guard is essential:
   ```sql
   DELETE FROM sessions
    WHERE (owner_type IN ('stage_run', 'workflow_run')
           OR id IN (SELECT session_id FROM stage_runs WHERE session_id IS NOT NULL))
      AND id NOT IN (SELECT session_id FROM chats WHERE session_id IS NOT NULL);
   ```
   `chat_messages` of those sessions cascade.
2. Purge the run-scoped durable data:
   - `DELETE FROM entries WHERE scope IN ('stage_run', 'workflow_run')`, and the same for `registers`;
   - `DELETE FROM stream_cursors WHERE scope = 'run'`, and the same for `stream_sequences`;
   - `DELETE FROM checkpoints WHERE workflow_run_id IS NOT NULL`;
   - `DELETE FROM execution_workspaces WHERE owner_type = 'workflow_run'`. Workspace directories are left to `WorkspaceRetentionService`.
3. `UPDATE automation_executions SET status = 'cancelled' WHERE status IN ('pending', 'running')`. Then `DROP TABLE` in this order: `automation_execution_runs`, `stage_session_maps`, `session_allocations`, `stage_runs`, `workflow_runs`.
4. Run the definition-side `ALTER`s (§6.1).
5. **Backfill:**
   - `key`: slugify(name). Duplicates get a `_2`, `_3` suffix in `order`, then `id` order. This is done in the migration's JS pre-step: a `Migration.run?(sqlite)` hook, a small addition to the runner.
   - `spec`: built from the legacy columns: `retry_policy` becomes `retry {maxAttempts = maxRetries + 1, ...}`; `result_validation` becomes `output.rules`; `output_schema` / `output_format` become `output`; `condition` of type expression becomes `guard`; `context_filter` / `context_sources` become `context` (names mapped to keys).
   - Unparseable legacy conditions become a **definition validation error**, surfaced on next open. No silent skip.
6. Create the new tables and indexes (§6.2).
7. Run `PRAGMA foreign_key_check`. The runner already fails only on newly introduced violations.
8. **Migration test** (`packages/db/src/__tests__/migration55.test.ts`):
   - Build a v54 database with 2 chats (messages, a forked chat, an orchestrator worker chat), 1 definition with 3 stages (duplicate names), 1 run with 3 stage runs and stage sessions, and 1 automation execution.
   - Migrate.
   - Assert: chats, chat_messages and chat sessions are unchanged (row counts and content hash); stage sessions are gone; definitions have unique keys and valid `spec`; new tables exist; `foreign_key_check` is empty.

Workflow definitions are published into `workflow_definition_versions` lazily, at the first `createRun` after the migration. No eager backfill is needed.

---

## 7. Test strategy

**7.1 Pure unit tests** (`packages/core/__tests__/scheduler/*.test.ts`)
- Readiness table tests for `all`, `any` and `n_of_m`, crossed with pending, active, dead and neutral predecessors, including B-18 shapes and the T2/S1–S5 probes from the audit (ported as regression cases).
- `computeScopeOutcome`: B-16 (notify stage via on_completion no longer masks failure); `handlesFailure: true` does absorb it.
- `decideLoop`: condition exit, max exit, budget exits (turns, cost, wall clock), onBodyFailure, grant, accept, fail, and until_error.
- Expression v2: parser fuzz (fast-check string arbitraries, which must never throw past `parse`), type-check fixtures, null semantics, and the strict equality table.
- `classifyStageError`: a table over provider error fixtures from the Claude, Codex and Copilot adapters.

**7.2 Property and model-based tests** (add `fast-check` as a devDependency of `packages/core`)
- **Generators:**
  - random compiled workflows: 1–12 nodes, random edges (acyclic per scope), join modes, guards over random typed outputs, 0–2 loops (bodies of 1–3 nodes, maxIterations 1–4), 0–1 maps (1–5 items);
  - random environment scripts: for every launched attempt, pick succeeded (random typed output), failed (a random ErrorClass), crash (lease expiry), or hang; interleaved with user commands (pause, resume, cancel, retry, skip, grant) at random points.
- **Harness:** `RunActor` over an **in-memory `RunStore`** that implements the same CAS semantics, plus a fake `EffectsDispatcher` that turns `launch` into scripted `attempt_settled` messages and a virtual clock.
- **Invariants,** checked after every message:
  1. Every persisted transition is in `STAGE_RUN_TRANSITIONS` / `WORKFLOW_RUN_TRANSITIONS`.
  2. At most one live attempt per stage_run, and `attempt_no` is strictly increasing.
  3. No `launch` or `create_attempt` for an instance whose run is terminal, cancelling or paused (catches B-3 and B-4).
  4. A run is terminal exactly when every instance is terminal and no live timers remain. No instance is non-terminal after the run is terminal.
  5. **Liveness:** if the environment eventually settles every launched attempt and issues no pause, the run reaches terminal within `O(nodes × maxIterations × maxAttempts)` messages (no hang; catches diamond and join hangs).
  6. Loop iterations never exceed `maxIterations + granted`. Loop cost never exceeds `1.25 × budget + max single in-flight usage`.
  7. **Failure is not masked:** outcome `completed` implies every failed instance has a completed failure-handler path.
  8. **No validated output is lost:** `completed` implies `output_data` validates against the stage schema.
  9. Retries happen only for retryable classes. Deterministic errors never produce `retry_wait`.
  10. **Determinism:** re-running `decide` over the recorded message log from the initial state yields byte-identical decisions and state hashes.
- **Concurrency model check:** the same generator plus an adversarial interleaving of executor-owned CAS writes against actor writes (a claim racing a cancel, a repair racing a pause). The invariants must hold, and every loser must observe `ok: false`.

**7.3 Scheduler replay tests** (Temporal-style)
- The `scheduler_journal` of real runs (dev and dogfood) is exported as fixtures in `packages/core/__tests__/fixtures/scheduler/*.jsonl`: the compiled spec plus the message log.
- `replay.test.ts` replays every fixture through the current `decide` and asserts identical decisions. An intentional semantic change regenerates fixtures with `UPDATE_FIXTURES=1` and must be called out in review.
- This catches AND/OR, skip and join regressions (E §K).

**7.4 Loop integration tests with a fake harness** (`packages/core/__tests__/engine/LoopReviewFix.e2e.test.ts`)
- **Stack:** real SQLite (`:memory:` plus the migrations), the real `RunSupervisor`, `StageExecutor` and `OutputExtractor`, and `FauxProvider` (`packages/agent-harness-providers/src/providers/faux/FauxProvider.ts`), scripted per session.
- **Test cases:**
  1. Review returns changes_requested twice and then approve. Assert:
     - 3 iterations, with instance paths `review_loop#0..2/*`;
     - every fix instance shares one `session_key` and one conversation id;
     - the iteration 1 and 2 fix conversations contain a feedback turn with the prior comment ids;
     - op ids are unique per scope;
     - the loop output has exitReason condition, and `open_pr` receives `last.review.summary`.
  2. Review always requests changes (maxIterations 2). Assert the loop is `awaiting_input` with a `loop_exhausted` interrupt and the run is `waiting`. `grant_iterations {n: 1}` then gives a third iteration; `accept` completes with exitReason accepted.
  3. Budget: FauxProvider usage cost 2 USD per turn with `maxCostUsd` 5. The loop stops at the iteration boundary, or aborts in flight at 1.25×.
  4. The review's first output is invalid JSON. Expect one repair turn (`e1.r1/repair/0`), then success. Attempts stay at 1.
  5. The fix gets a 529 on prompt 0. Expect `retry_wait`, then a resume attempt: same session, settled turns are not re-sent, and the failed turn is re-sent once.
  6. Crash mid-iteration: dispose the supervisor with an in-flight never-replay turn, then boot a new supervisor on the same DB. Assert the instance is `paused(process_restart_unsafe)`, **not** completed, and that iteration 1 is **not** re-run.
  7. Cancel during fix: the status is `cancelled` before the harness abort, there is no later `ready` or `starting` (B-3), and the session is released.
  8. Pause (interrupt) during review, then resume: the same attempt resumes and the output is not empty (F-1).
- **Chaos regression:** port the F-suite probes (pause mid-stage, cancel, crash, validation retry, HITL changes-requested) as tests against v2.

**7.5 SQLite-level tests** (`packages/db/src/__tests__/`)
- `transition()` CAS: two racing transitions and exactly one wins; version pinning; an illegal pair throws.
- `RunStore.apply` atomicity: inject a throw after step 5 of §5.5 and assert nothing persisted.
- Outbox redelivery after a simulated crash between commit and dispatch; the dispatcher is idempotent by `(run, run_seq)`.
- Timer CAS: fire twice and deliver once.
- Migration v55 test (§6.3).

---

## 8. Sequencing and file map

| Phase | Scope | Main files | Exit criteria |
|---|---|---|---|
| P0 Foundations | State-machine v2 tables; `transition()` CAS; `RunStore.apply` (sync tx); `ErrorClassifier` plus `HarnessError` codes; Expression v2; `workflow_definition_versions` plus compiler; migration v55 | `domain/state-machines/*`, `db/src/repositories/{StageRunRepository,WorkflowRunRepository,RunStore,StageAttemptRepository}.ts`, `domain/expr/*`, `domain/workflow-graph/compile.ts`, `db/src/migrations/index.ts` (v55 plus a `run?` hook) | 7.1, 7.5 and the migration test pass |
| P1 Engine core | Pure `decide` (readiness v2, joins, skip reasons, terminal v2); `RunActor`, `RunSupervisor`, `TimerService`, `LeaseReaper`, `OutboxDispatcher`; `StageExecutor` carved from SES (attempt lifecycle, validating state, per-turn deadlines, progress watchdog, desired-state-first cancel and pause); retry v2 plus precedence; recovery; delete `DAGScheduler`, `processedStageRuns`, the 3 s reconciler, `retryStage`, `retryStageAfterValidation` and `retryInSession` | `domain/scheduler/*`, `services/engine/*`, `services/WorkflowRunService.ts` (facade), `services/StageExecutionService.ts` (shrinks to turn helpers), `composition-root.ts` | 7.2 invariants; F-suite chaos regressions green |
| P2 Typed outputs | `OutputExtractor` (`submit_output` tool plus fallback), ajv, repair turns, `turn_role` on messages, no summary turn for json, removal of the output-retry turn; templating v2 | `services/engine/OutputExtractor.ts`, provider adapters (custom tool registration), `shared/src/utils/template.ts` | Review JSON e2e passes on Claude and Codex |
| P3 Loops | Loop block (compile, validate, `decideLoop`), `session_key` plus `run_sessions`, feedback binding, loop budgets, commands API, UI (group node, badge, iteration tabs, exhausted card, timeline lanes), Review-loop preset | `domain/scheduler/loops.ts`, `services/engine/SessionAllocator.ts` (rewritten), `apps/server/src/routes/workflowRuns.ts` (commands), `apps/web/src/components/workflow/*` | 7.4 cases 1–8 |
| P4 Primitives | Map, wait (approval, event, timer), sub-workflow (version pinning, depth limit), fork plus rerun-from, compensation plus `finalizing` post-processing | `domain/scheduler/{maps,subworkflow}.ts`, `WorkflowRunService.forkRun`, `WorkflowOrchestrator.ts` (phases move into `starting` and `finalizing`) | Property tests extended; T5 retry and fork scenarios |
| P5 Advanced | Dynamic expansion; best-of accept with checkpoint restore; flow-control keys; OTel spans | `domain/scheduler/expansion.ts` | – |

**Deleted or replaced code:**
- `DAGScheduler.ts` (its pure parts move to `domain/scheduler`)
- `ConditionEvaluator.ts` and the preprocessor's grammar
- `DurableSleepService.ts` (replaced by `TimerService`)
- `SessionAllocator` single mode (replaced by `sessionGroup`)
- `IterationConfig`
- `WRS.retryStageAfterValidation`, `SES.retryStage`, `SES.retryInSession`, `SES.sendStageFollowUp` (becomes a `command` that creates a resume attempt)
- `ResultValidator` message concatenation (replaced by `OutputExtractor` plus rules over the current attempt)

---

## 9. Risks and open questions

1. **Provider support for `submit_output`.** Claude (in-process MCP) and Codex (function tools) are fine. Copilot custom-tool support must be verified, or those stages fall back to final-JSON-block extraction, which is still attempt-scoped and so still fixes F-6.
2. **`session: continue` context growth** on long loops. It is mitigated by the loop `maxTurns` and optional `compactAfterIterations`. The per-provider compaction behaviour needs measurement.
3. **The pause default for unattended runs** could leave automations hanging. The `pauseTtlMs` default of 72 h, plus a notification (push token infrastructure exists), is the mitigation. Product should confirm the TTL.
4. **Shared worktree across parallel map items.** Map items editing the same checkout will conflict. The recommendation is `map.workspace: 'worktree_per_item'` (P4), or restricting map bodies with write tools to `concurrency: 1` through the validator.
5. **Actor state loading cost.** It is O(instances) per message. With a 25-iteration loop over 5-node bodies that is about 130 rows, which is fine. For maps of 200 items, cache `RunState` in the actor and invalidate it by `version`.
6. **Dropping run history** is accepted by the brief. Communicate it in release notes; users can export runs before upgrading (`GET /workflow-runs/:id` JSON).
