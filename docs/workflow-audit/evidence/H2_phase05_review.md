# H2: Independent review of PHASE-05 (control flow)

Reviewer: independent, read-only. Target: `docs/workflow-overhaul/PHASE-05-control-flow.md` (revision dated 16:11, Sept 24 2026), read against README, P01–P04, P06–P08, STATUS, TRACEABILITY, G5, G1 and E, plus the real code (`SandboxedScriptRunner.ts`, `MountService.ts`, `WorkspaceCheckpointService.ts`, `IProviderInstance.ts`, `WorkflowDefinitionSchemas.ts`).

## Verdict

**Revise before handing to a coding agent.** The direction is right, and the product owner's four requirements are mostly met in intent:
- the loop is generic, and the scenarios are examples;
- presets are template functions that emit plain `StageSpec`;
- there are no slash or chat commands inside GeneratorAI;
- operator actions go through the commands API and run-page cards.

But the phase is **not yet sound or executable as written**:
1. **The evaluation contexts of the core loop are under-specified**, and one of them is wrong. Carry is evaluated before exits, and no prior-carry value is exposed. The result is that the flagship goal example L3 ("same blocker N times") degenerates into "blocked N times". The meaning of `loop.previous` and `loop.last` in exit context, and whether carry is assigned sequentially or simultaneously, are undefined.
2. **7 of the 13 examples are invalid against the schema or grammar as written:**
   - L2 (index and arithmetic);
   - L3 (degenerate rule, a stall that never fires, an assess prompt with no objective);
   - L4 (`critique` has no `prompts`);
   - L5 (`take` used as a template filter, `[]` literal typing, a self-referential carry type);
   - L6 (no prompts or feedback, so every iteration is identical);
   - M3 (the map results shape is undefined);
   - W2 (string `+`).
3. **The new `check` kind cannot work on Windows**, the user's own platform, through the existing `SandboxedScriptRunner`. I verified this on this machine. `check` also has no schema, and a spawn failure is indistinguishable from "tests fail", so a test-until-green loop spins to its cap.
4. **Several mechanisms rely on APIs that do not exist or behave differently:**
   - `MountService` has no "cut a mount from a checkpoint" operation, and `seedFrom` is best-effort;
   - checkpoint `capture` never throws and skips unchanged repos;
   - `restoreTurn` is best-effort per mount;
   - the signals need a post-scope effect that the pure `decide()` pipeline has no step for.
5. **Budget accounting contradicts itself.** The hard abort at 1.25× makes the body fail, which the algorithm routes to `FAIL(body_failed)`, not to `EXHAUST('budget')` plus wrap-up.
6. **The estimate (3.5–4 weeks) is not credible.** The scope equals G5's P3 + P4 + part of P5, plus a CodeMirror expression editor, plus Windows process fixes.

Blockers: 5. Majors: 27. Minors: 16.

---

## Findings

| ID | Sev | Location | Problem | Evidence | Concrete fix |
|---|---|---|---|---|---|
| P5-1 | **blocker** | §2.3 (carry before exits); L3; L5 | Carry is recomputed **before** exits, and there is no way to read the pre-update carry. L3 `pauseWhen: blocker == loop.carry.lastBlocker` compares the blocker with the carry that was *just* set from the same blocker. It is always true whenever a blocker exists, so the "same blocker" rule becomes "blocked 3× in a row". There is also no rule for whether carry keys are assigned in declaration order (sequential) or all from the prior carry (simultaneous). L5 `newItems` silently depends on JSON key order | §2.3 pseudo-code; L3 carry `lastBlocker`; the L5 note "newItems is compared against the *previous* seen" | Define: **(a)** all carry expressions are evaluated **simultaneously** against `loop.carry` = carry(k-1), so key order is irrelevant; **(b)** exits, `score` and `select` then see `loop.carry` = carry(k) and `loop.priorCarry` = carry(k-1). Rewrite L3 to compare against `loop.previous.stages.assess.output.blocker` (see corrections). Add a testkit case: "same blocker" versus "different blockers each round" must behave differently |
| P5-2 | **blocker** | §2.2 scope table; §2.3; examples | The evaluation contexts are ambiguous:<br>- `loop.last.stages.*` is used (L1 `select`) but is not in the scope table, which lists only `loop.last.signals` and `loop.last.failures`.<br>- `loop.previous` in *exit* context (k-1?) versus *template* context (k) is never stated.<br>- Signals are aggregated over the whole body, so L3 `stall: loop.last.signals.toolCalls == 0` can never fire: the `assess` stage itself makes tool calls every iteration | §2.2 table rows; L1 `output.select`; L3 `stall` | Add a **context table**:<br>- **E(k)**, used for carry, exits, `score` and `select` after iteration k: `stages.<body>` = k, `loop.last` = k, `loop.previous` = k-1, `loop.history` includes k.<br>- **T(k+1)**, used for templates of iteration k+1: `loop.previous` = `loop.last` = k, `loop.carry` = carry(k).<br>- Add `loop.last.stages.<key>.{output,status,summary}`.<br>- Make signals per stage: `loop.last.signals.stages.<key>.{toolCalls, outputHash}`, plus the aggregates `toolCalls` and `workspaceChanged` |
| P5-3 | **blocker** | §2.2 functions; L2, L5, W2, M3, carryInit | The Expression v2 grammar (P01 ← G5 §4.6) has: literals (string, number, bool, null), paths, comparisons, `in`, `and/or/not`, and `len/count/exists/lower`. It has **no** indexing `[i]`, arithmetic `-`/`+`, string concatenation or list literals, and templates only allow `{{path \| filter}}` with the filters `bullets/json/yaml`. So these fail to parse or type-check:<br>- L2 `loop.history[len(loop.history)-2]`;<br>- W2 `'ci:' + sha`;<br>- L5 `{{loop.carry.seen \| take(200) \| bullets}}` (`take` is a *function*, not a filter);<br>- `carryInit {"seen": "[]"}`;<br>- M3 `["correctness",…]`.<br>Generic carry also lacks `map` and `filter` | G5 §4.6 grammar; P01 design decision 4; P05 §2.2 functions list | Put a **grammar delta** in WP-5.1, reflected in P01 `grammar.ts`:<br>- list literals `[a, b]`;<br>- `at(list, i)` (a negative index counts from the end);<br>- `concat` overloaded for strings;<br>- `map(list, x => e)`, `filter(list, x => p)`, `some`, `every`;<br>- the exact signatures of `max/min` (`max(list, x => n)`);<br>- **full expressions inside `{{ }}`** (the filters `bullets/json/yaml` stay).<br>Prefer functions over infix arithmetic, to keep typing simple. Fix the examples (see corrections) |
| P5-4 | **blocker** | §1 `check`; WP-5.3; L2, L6 | **`check` is broken on Windows.** `resolveOnPath` tries the extensionless candidate first (`['', ...PATHEXT]`), so `pnpm` resolves to the POSIX shim `…\npm\pnpm`, and spawn fails with ENOENT. If it resolves `pnpm.cmd` instead, Node (≥18.20.2 / 20.12.2, CVE-2024-27980) throws **EINVAL** for `.cmd`/`.bat` with `shell:false`. The same applies to `npm`, `npx`, `tsc`, `eslint`, `vitest`, `jest` and `prettier` (all `.cmd` shims) | Verified here on Node v26.8.2: resolved `C:\Users\sidmishra\AppData\Roaming\npm\pnpm` → `spawn ENOENT`; spawning `pnpm.cmd` with `shell:false` → `spawn EINVAL` (thrown synchronously). `SandboxedScriptRunner.ts:resolveOnPath`, `run()` uses `shell:false` | Add a WP-5.3 task "Windows process launch":<br>- on win32, skip extensionless candidates;<br>- run `.cmd`/`.bat` shims through `ComSpec /d /s /c` with cross-spawn-grade argument escaping (args are author-time literals, see P5-24), **or** resolve npm-style shims to `node <script.js>`.<br>Add a Windows CI test for `pnpm --version`, `npx vitest --version` and `tsc -v` through the runner |
| P5-5 | **blocker** | §1, WP-5.1, WP-5.3 | **`CheckStage` has no schema.** The fields are scattered across the text (`command`, `args`, `env`, `timeoutMs`, `parseJson`, `failOnNonZero`). There is no mount or cwd selection, although runs can have several mounts (P04), and no tail sizes. A **spawn or config failure** (ENOENT/EINVAL, not allow-listed, exit -1 on timeout) comes out as `passed:false`, which a loop treats as "tests fail" and keeps iterating on | §1 table; WP-5.3 "non-zero exit is not a failure"; runner returns `exitCode:-1` for errors and timeouts | Define it in zod: `check: {command, args: string[] (literal, no {{}}), env?: Record<string, Template>, mount?: alias (default primary), cwd?: relative path (no ..), timeoutMs (default 600000, max 3600000), parseJson=false, failOnNonZero=false, tailBytes=16384}`. Output: `{exitCode, passed, timedOut, stdoutTail, stderrTail, durationMs, json?, jsonError?}`. **Spawn, policy and resolution errors fail the stage** (deterministic, `check_launch_failed`) and never yield `passed:false`. Set `NO_COLOR=1` and `FORCE_COLOR=0` by default. Strip ANSI from the tails |
| P5-6 | major | §2.3; WP-5.2 "Signals" | The steps are circular. `decide()` decides that scope k is terminal, but the tree hash and the per-iteration checkpoint need an **effect** after that point and before carry and exits. The text says the effects layer writes signals "before posting `scope_settled`", but no component posts `scope_settled`: settlement is a decision, not an executor event | WP-5.2 bullet "Signals"; G5 §5.3 (decide is pure) | Add a loop sub-state: `scope terminal → emit effect capture_iteration_end{treeHash, checkpoint?}` → the loop's `loop_state.phase='settling'` → the effect posts `iteration_captured{k, treeHash, checkpointId}` → decide evaluates carry and exits. Tool-call counts and output hashes are aggregated purely from the persisted attempts at that point |
| P5-7 | major | §2.3 step 6; WP-5.2 "Budget"; G5 §2.11 | The hard abort at 1.25× makes the in-flight body instances `failed{budget_exceeded}`. The algorithm then hits `outcome == failed and onBodyFailure == 'fail' → FAIL(loop,'body_failed')` **before** any budget check, so the wrap-up never runs and G5's "the loop then exhausts" is violated. The wrap-up is also said to be allowed "up to 1.25×", but after a hard abort there is no headroom left | §2.3 lines 139–149; §2.3 "Budget wrap-up" | Special-case it: if any body failure has `code ∈ {budget_exceeded, loop_wall_clock}`, go to `EXHAUST('budget')`. Give the wrap-up its **own** allowance (`onBudget.wrapUp.maxTurns` default 1, cost cap 10% of `maxCostUsd`), outside the 1.25× hard cap. Update the property test to `cost ≤ 1.25×budget + wrapUpAllowance + one in-flight usage` |
| P5-8 | major | §2.1 `sessionReuse` | The shape changed from P01's `sessionReuse: 'fresh'\|'continue'` (already stored since P01 and enabled in P03) to a union of a string and an object. That forces a spec rewrite in v59 (R-1 forbids read-both shims), and the examples mix the two forms | P01 design decision 2 and the gate list; L1 `"fresh"` versus `{mode:'continue'}` | Keep the P01 enum and add a sibling `compactAfter?: int 1..20` (valid only with `continue`; validator code `compact-without-continue`). No data migration is needed. Fix every example (`"sessionReuse": "continue"`) |
| P5-9 | major | §2.1 `LoopStage = {...StageBase, loop:{budget, onExhausted…}}` | **There are two budgets and two `onExhausted` fields on one node.** P01's StageBase already has `budget` and `onExhausted: pause\|fail` (retry exhaustion). `retry`, `repair`, `timeouts.attemptMs`, `approval`, `context` and `hooks` have no meaning for containers, wait or subworkflow | P01 design decision 2 table; P05 §2.1 | Define `StageBase` explicitly (key, name, parentKey, guard, join, position, compensate) and give each kind its applicable fields. For loops, use **StageBase.budget** as the cumulative loop budget and delete `loop.budget`, or forbid StageBase.budget on loops. Rename `loop.onExhausted` to `loop.onLimit` to avoid the collision. Add a validator code `field-not-applicable` |
| P5-10 | major | §2.2 carry typing; WP-5.1 `carry-type` | The carry type is "typed from its expression", but a self-reference (`seen = unique(concat(loop.carry.seen, …))`) is recursive, and `carryInit "[]"` has no element type. The rule "a carry referenced before it is initialised needs a carryInit" rejects L1, where `openComments` is used in iteration 0 inside `{{#if loop.previous}}` and in `followUpPrompts` (iteration ≥ 1 only) | L1, L5 | Type rule: the carry type is inferred from the `carry` expression with self-references typed from `carryInit`. An empty-list literal unifies with the other operand's element type. Optionally allow `carrySchema: Record<name, JSONSchema>` as an escape hatch. Without `carryInit`, a carry is **nullable** (`T \| null`) in iteration 0, and there is no error. Replace "needs carryInit" with that nullability rule |
| P5-11 | major | §2.3 | The semantics of **evaluation errors and nulls** are undefined for exits, carry, `score` and `select`. G5 said an `until` error counts as "not satisfied" plus `loop.until_error`. Open cases: a skipped or failed body stage yields null outputs (`onBodyFailure: next_iteration`); `len(null)`; and `not null` when a signal is unavailable could fire `stall` spuriously | G5 §2.5; P05 silent | Exit: an error or null counts as **false**, emits `loop.exit_error {rule, message}` and breaks that rule's streak. Carry: an error keeps the previous value and emits `loop.carry_error`. `not null` = null (false). Signals that cannot be computed are null, never `false` |
| P5-12 | major | §2.3 `consecutive` | Streak semantics are incomplete: does a streak survive an operator command? After `pauseWhen {consecutive:3}` parks the loop and the operator sends `continue_with_input`, the next iteration re-parks after one round because the streak is still ≥ 3. Codex: "a resumed goal starts a fresh blocked audit". Also undefined: whether a failed iteration or an evaluation error breaks the streak | G1 §1.3; §2.3 | The streak = the number of trailing iterations where the rule evaluated to **true**, counted since the later of (the loop start, the last operator command, the last time **this** rule fired). Store `streaks` in `loop_state`. Test: pause → continue → it must not re-park for N-1 more iterations |
| P5-13 | major | §2.1 exit slots | **Genericity (PO requirement 1).** There are exactly four fixed slots (`until/failWhen/pauseWhen/stall`). Two independent success, pause or fail conditions with different reasons or streaks cannot be expressed (for example pause on "needs credentials" at once and on "same blocker ×3"). Joining them with `or` loses the per-rule `consecutive` and `reason` | §2.1 schema | Replace them with `exits: ExitRule[]`, where `ExitRule = {when, consecutive, action: 'complete'\|'fail'\|'pause'\|'exhaust', reason?}`. Fixed precedence: **fail > complete > pause > exhaust**, then array order. The builder shows the same four "quick rows" as sugar that writes into `exits` |
| P5-14 | major | §2.3 `accept_best`; WP-5.2 | `accept_best` has several gaps:<br>- **(a)** The `score` expression must be evaluated in E(k) and stored per iteration, otherwise the argmax cannot be computed. Ties, all-null scores, and whether the loop's `output.last` becomes the **chosen** iteration are undefined.<br>- **(b)** `accept_iteration {k}` with `checkpointEachIteration:false` cannot restore anything.<br>- **(c)** The real APIs: `WorkspaceCheckpointService.capture()` "never throws" and returns `[]` on failure; with `skipIfUnchanged` (the default) it writes no record for unchanged repos; `restoreTurn()` is best-effort **per mount** and returns `ok` per mount, so "on failure → `restore_failed`" needs an explicit check, and a partial restore leaves the mounts mixed | `WorkspaceCheckpointService.ts:265` (never throws; `skipIfUnchanged ?? true`), `:132` (`restoreTurn`, per-mount result, falls back to the newest earlier snapshot) | Store `history[k].score` and `history[k].checkpointTurnId` (synthetic `<loopInstanceId>#k`, phase `after`). Ties → the latest iteration. All null → behave as `pause`. The loop output `last` = the chosen iteration. `accept_iteration k≠last` is refused (409 `checkpoint_unavailable`) unless checkpoints are on. The restore effect asserts `result.mounts.every(m => m.ok)`; otherwise it re-restores `preRestoreCheckpointId` on the mounts that succeeded and then fails `restore_failed`. Capture with `skipIfUnchanged:false` for iteration checkpoints |
| P5-15 | major | §2.3 Signals; WP-5.2 | `workspaceChanged` "from the mount checkpoint hashes … (P07 incremental capture)" is a **dependency inversion**: P07 comes after P05. P03 WP-3.5 also skips checkpoint capture for stages with no write or shell groups, so the hashes can be missing | P03 WP-3.5; P07 WP-7.1 §3 | P05 computes its own cheap tree hash per mount at iteration start and end (`git add -A` into the shadow index + `write-tree`, or a hash of the `status --porcelain=v2` output) inside the `capture_iteration_end` effect (P5-6). It does not depend on P07 |
| P5-16 | major | §2.3 wrap-up; WP-5.2 | The wrap-up turn has **no instance row**, so it violates ground rule 1 ("everything is a stage"). Its output (the summary the goal example exists for) is exposed nowhere: the loop output lacks it. `turn_role: 'wrap_up'` and `'digest'` are not in P03's `turn_role` value list | §1 loop output; P03 WP-3.2 `turn_role (context\|feedback\|prompt\|repair\|summary\|approval_feedback\|operator)` | Model the wrap-up as instance `<loop>#wrapup/<stageKey>` (a normal agent instance that reuses the continuing session). Add `wrapUp: {text, output?} \| null` to the loop output. Add `wrap_up`, `digest` and `iteration_input` to the P03 turn_role list, and make sure v57 declares `turn_role` **without** a CHECK constraint (adding a value later would mean rebuilding `chat_messages`) |
| P5-17 | major | §2.3 `continue_with_input`; §2.2 `loop.operatorInput` | **Dead-UI risk.** No shipped example or template references `{{loop.operatorInput}}`, so the "Continue with input" decision card does nothing with every template (the dead-UI pattern already seen in this codebase) | L1–L6 prompts | When `operatorInput` is set, the executor **automatically** prepends a `turn_role: operator` message to each root stage of the next iteration (as well as exposing `loop.operatorInput`). Test: "continue with input X", then the prompt of the next iteration contains X |
| P5-18 | major | §2.1 `compactAfter`; WP-5.2 | The digest is undefined. Is it an LLM turn (cost and nondeterminism, counted against the budget?) or deterministic from `loop_state.history`, as G5 §2.7 says? Is it applied once or every n iterations? | WP-5.2 "Sessions" | Deterministic digest (no LLM): the objective prompt, plus per-iteration one-liners from the history and the last outputs of the stage's own instances (≤ 8 KB). It is applied **every** n iterations. It is recorded as `turn_role: digest` and counts 0 turns |
| P5-19 | major | §2.3 history; WP-5.5 "Re-run from here" at `<loop>#k`; WP-5.7 "carry values of each iteration are visible" | `history[k]` stores `{exitValues, usage, signals, durationMs}` but **not the carry**. That makes forking from iteration k (which needs carry(k-1)) and per-iteration carry display impossible. Storing it in `loop_state` would make that row up to 50 × 256 KB = 12.8 MB, rewritten on every CAS | §2.3; G5 §3.8 | Add a table `loop_iterations(stage_run_id, k, carry, exit_values, streaks, signals, score, checkpoint_turn_id, usage, started_at, ended_at, PRIMARY KEY(stage_run_id,k))` in v59, written in the same transaction as the next scope's create_instances. `loop_state` keeps only `{k, phase, effectiveMax, budgetDelta, streaks, exitReason}` |
| P5-20 | major | §4.1 map | The map **results element shape** is undefined; the loop has `last: {bodyKey: output}`, the map has nothing. Is `output.select` evaluated **per item** or over the aggregate? (M3 needs per item.) The instance path is inconsistent: G5 uses `<map>#<index>`, P05 redrives by `<map>#<itemKey>/…`. An arbitrary `itemKey` can contain `/` or `#`, and duplicate keys are unhandled | §4.1; WP-5.3 "per-item redrive"; M3 | `results[i] = {index, key, item, status, stages: {<bodyKey>: output}, ...select}`, with `select` evaluated **per item scope**. `instance_path` uses the **index** (`<map>#<i>`); the key is stored in `stage_runs.item_key` and fork accepts either form. Duplicate keys → deterministic `map_duplicate_item_key`. `maxItems` default 50 and `concurrency` default 4 (as in G5) |
| P5-21 | major | §4.1 `mount_per_item`; WP-5.3 | The mount mechanics do not match the real `MountService`:<br>- **(a)** There is no "cut a mount from a checkpoint" API. `prepare(workspaceId)` works per workspace, and `seedFrom` is **best-effort** (per-file failures are logged and skipped), which breaks the "items see upstream uncommitted changes" guarantee.<br>- **(b)** `generated`/`in-place` mounts have no git, so the merge strategies are impossible.<br>- **(c)** Item mounts have no `node_modules` (seeding filters it out), so a `check` inside the item body fails.<br>- **(d)** Nothing covers retention or cleanup of N item mounts (the known disk-growth issue).<br>- **(e)** Other DAG branches can write to the run mount **during** the map; the singleton key only covers merges | `MountService.ts:450` (`prepare(workspaceId, scope)`), `:768` (`seedFrom`, best-effort, `node_modules` filtered); memory: disk growth and workspace retention | Specify:<br>- a new `MountService.forkFromSnapshot(runWorkspaceId, snapshotCommit, itemWorkspaceId)` that is **all-or-nothing**;<br>- `mount_per_item` requires git-backed mounts (an invoke-time error otherwise);<br>- an optional `map.itemSetup: check[]` (for example `pnpm install --offline`) or linking `node_modules`;<br>- item mounts are released after merge or on map terminal (retention applies);<br>- while a `mount_per_item` map is running, writers outside the map that target the same mount wait on `worktree:<mountId>` (the map holds a **shared** lease), or else merges are 3-way against the current head |
| P5-22 | major | §4.1 merge | The behaviour on a merge **conflict** is unspecified; only a test name exists. `pr_per_item` interacts with run-level `autoCreatePR` (the run mount does not contain the item changes). Per-item push and PR gating is unspecified | WP-5.3; "Tests: sequential merge conflict" | Conflict → that item gets `failed{merge_conflict}` and counts toward `toleratedFailurePercent`; its mount is kept for inspection. `pr_per_item`: branch `generatorai/<run>-<index>`, journalled effect op `merge/<map>/<index>`, honouring `lifecycle.postProcessing.autoPush/autoCreatePR` as permission. The item result gets `pr: {url, branch}`. `merge: none` → item mounts are retained until run finalize, and results carry a diff reference |
| P5-23 | major | M2; P01 variables | `map.items: variables.sources` cannot type-check: the variable types are `string\|number\|boolean\|choice\|text`, with no list or JSON | `packages/shared/src/config/WorkflowDefinitionSchemas.ts:56-64` | Add a `list` (items JSON Schema) and a `json` variable type to P01 `VariableDefinition`, with builder and invocation-form support; or change M2 to map over an upstream stage's output |
| P5-24 | major | §1/WP-5.3 `check` security | The allowlist is **not a sandbox**:<br>- `pnpm test`, `vitest`, `tsc` (plugins) and `eslint` (configs) execute **repo code that the loop's agent just edited**, so the agent gets shell execution with server privileges **outside its permission mode** (for example a run in `plan` or `default` mode);<br>- `pwsh -Command …` is not blocked (only `-EncodedCommand` is);<br>- the hard-coded list in P05 differs from the real one (`pip`, `pip3`, `python3`, operator `extraAllowlist`);<br>- the validator lives in the browser-safe spec package, so it cannot know the server's effective allowlist | `SandboxedScriptRunner.ts` `DEFAULT_COMMAND_ALLOWLIST`, `PWSH_ENCODED_FLAGS` | Threat model: a `check` counts as the run capability **`shell`**. It is refused when the run's effective permission is `plan`; the invocation plan and `describe_workflow` show a "runs repo code" risk flag. Runs use `buildChildEnv` (already the case) and the run's sandbox when one is configured. Block `pwsh -Command/-c` and `-File` outside the mount. The spec validator checks against `DEFAULT_COMMAND_ALLOWLIST` exported from the spec package, and the server re-validates with `getAllowlist()`. Add `GET /api/settings/script-allowlist` for the builder picker. P01 says "env **or argv**", P05 says env only: pick **env only for templated values; args are literal** (needed for Windows `cmd /c`, P5-4) |
| P5-25 | major | §4.2 subworkflow | Several gaps:<br>- **(a)** `workspace:'inherit'`: the child's own P04 lifecycle would run `prepare` (worktrees) and `finalize` (commit, push, PR) on the **parent's** mount.<br>- **(b)** `workflowDefinitionId` is a DB id, not portable across export/import or templates.<br>- **(c)** Output types can drift: the parent is type-checked against the child's current version, but `pin_at_run_start` can pick a newer one.<br>- **(d)** A paused child (an exhausted loop) shows no decision card in the parent; only approvals are mirrored.<br>- **(e)** The `subworkflow-draft` **save** error blocks drafting a parent before the child is published | §4.2; P04 design decision 1 | **(a)** `inherit` → the child runs with its lifecycle `prepare.worktrees` and `postProcess` **suppressed** (mounts are passed through, and its commit and PR are the parent's). **(b)** Reference by `workflowRef: {id} \| {name, projectScope}`, resolved at save and export. **(c)** At invoke, re-check the child outputs against the parent's expectations; incompatible → `subworkflow-output-drift`. **(d)** Mirror *all* child decision cards (loop park, wait) into the parent's pending list. **(e)** Draft child → warning at save, error at publish and invoke |
| P5-26 | major | §4.3 wait / `workflow_run_events` | `PRIMARY KEY(run_id, event_key)` means a key can be delivered **once per run**. A `wait` inside a loop or map with a repeating key (for example the same SHA) either matches a stale event or can never be re-delivered. Early arrival (an event before the wait is reached) is undefined. Scope `exec:agent` for CI means handing CI a credential that can **run any workflow** | §4.3; WP-5.1 migration; P04 design decision 5 scopes | Table: `workflow_run_events(id, run_id, event_key, data, received_at, consumed_by_stage_run_id NULL)`, with a unique `(run_id, event_key, idempotency_key)`. A wait consumes the oldest unconsumed matching event (buffering early arrivals, documented). A duplicate delivery with the same idempotency key → 200 `replayed`; different data under the same key → 409. Auth: the wait mints a **per-wait callback token** (HMAC of run, instance and eventKey; Step Functions task-token style), exposed as `stages.<wait>.callbackUrl` or `callbackToken`, so CI needs no `exec:agent` |
| P5-27 | major | "Tests to add" | Missing tests:<br>- the **judge rule** (WP-5.4 has none: below threshold → repair, `stage_attempts.judge` stored, cost counted, max repairs exhausted);<br>- the **migration v59 test** (R-3 requires one);<br>- nested containers (loop-in-loop session keys, map-in-loop, loop-in-map item mounts);<br>- a wait inside a loop (event re-delivery);<br>- subworkflow `inherit` suppressing the lifecycle;<br>- Windows `check` launch;<br>- `check` launch failure versus non-zero exit;<br>- fork from `<loop>#k` and `<map>#i`;<br>- compensation and join UI;<br>- builder and run-page UI tests (group wrap and unwrap, expression editor, decision cards);<br>- mobile, TUI and CLI command parity;<br>- `continue_with_input` reaching the prompt;<br>- streak reset;<br>- `accept_iteration` without checkpoints;<br>- the budget-abort → exhaust path;<br>- expression function determinism (sort order by code unit, `unique` keeps the first) | "Tests to add" | Add them all; put the judge tests and the v59 migration test in the hard gate |
| P5-28 | major | Estimate | 3.5–4 weeks covers G5 P3 (loops) + P4 (primitives) + part of P5 (accept-best), plus a new kind, a function library, a CodeMirror editor, builder group nodes, run-page iteration UI, mobile/TUI/CLI, 7 templates, Windows process fixes and a large test matrix. P03 alone is 5–6 weeks | G5 §8; README §6 | Re-estimate at **6–7 weeks**, or split into **5A** (spec deltas, loop + check engine, templates L1–L5, minimal loop panel and decision cards; 3.5 weeks) and **5B** (map, subworkflow, wait, fork/compensation/join UI, expression editor, remaining templates; 3 weeks) |
| P5-29 | major | Examples L1–L6 "abridged" versus acceptance "validate and run" | The schemas in the examples omit types (`score` has no `"type":"number"`, `findings` items have no `url`, `files` items have no `path`), so `>= 8`, `f => f.url` and `item.path` fail strict type-checking ("unknown identifiers are errors") | G5 §4.6; the examples | State that templates carry **complete** schemas, and fix the examples (see corrections). Add a test that renders every example JSON in this file through `validateWorkflow` (extract the fenced blocks) |
| P5-30 | major | WP-5.1 `exit-unbound` | Too strict and inconsistent. It rejects legitimate rules over `loop.history`, `loop.usage` or `loop.priorCarry`, and it allows `loop.last.signals` but not `loop.previous` | WP-5.1 | Rule: an exit must reference at least one path that varies per iteration (a body `stages.*`, `loop.carry/priorCarry/last/previous/history/usage/iteration`). Also add a warning `exit-unreachable` when `consecutive > maxIterations` |
| P5-31 | major | README R4/R5 rows; P08 | Scenario-specific wording survives elsewhere (it contradicts PO requirement 1). See the cross-file list | README lines 52–53 | Fix as listed below |
| P5-32 | major | §2.3 wall clock | `maxWallClockMs` is unclear: does it count time parked awaiting an operator, and what does the timer do mid-iteration (abort? exhaust at the boundary?) | WP-5.2 "wall-clock timer is `loop_wall_clock`" | Wall clock excludes `awaiting_input` time (as P03 excludes HITL). When it fires mid-iteration it aborts the in-flight body → `EXHAUST('budget')` (P5-7) |
| P5-33 | minor | WP-5.1 `accept-best-needs-checkpoint` "auto-enables it" | A validator should not mutate the spec | WP-5.1 | The compiler sets the effective value; the validator emits `info`. Better still: a schema refinement that sets the default to true when `mode == accept_best` |
| P5-34 | minor | §1 `Budget` | There is no `maxTokens`, yet `loop.usage.tokens` exists, README kind 12 promises token budgets, and Codex goals are token-budgeted. `maxCostUsd` on providers without cost reporting never fires | `IProviderInstance.ts` `budgetTracking` | Add `maxTokens`. Validator warning `budget-cost-unsupported` when the effective provider lacks `budgetTracking` |
| P5-35 | minor | §2.2 nested loops | Inside a nested loop, `loop.*` shadows the outer loop, so there is no way to read the outer iteration or carry | §2.1 "nested loops" | Add `loops.<loopKey>.*` (the ancestors' loop scopes by key) |
| P5-36 | minor | §2.3 output hash | `outputHash` over a `check` output includes `durationMs`, so it differs every run; over agent outputs, key-order differences also matter | L2 (original stall) | The hash is taken over canonical JSON (sorted keys) excluding `durationMs` and `timedOut`. Document it |
| P5-37 | minor | Preset versus template sources | There are 8 preset functions and 7 JSON templates, and the sets differ: `adversarialVerify` and `fanOutOverList` have no template, `per-file-migration` mixes M1 and L6, and there is no critic, subworkflow or W2 template. Two sources will drift | WP-5.1 presets; WP-5.8 | Generate `templates/system/*.json` **from** the presets (`generate:templates --check` in CI), so each template = one preset call with example params. Add `adversarial-verify` and `completeness-critic` (P08 claims both ship in P05) |
| P5-38 | minor | Ground rule 2 lint | "mentions a preset name" gives false positives if it matches scenario words: the engine legitimately has `completion_review` (P03) | P03 WP-3.5 | Lint the exact preset export names and template ids only |
| P5-39 | minor | WP-5.6 CodeMirror 6 | This is a new dependency, which conflicts with PD-19 "existing components only". The web app has no `@codemirror/*` today, and there is a known 1.7 MB chunk concern | `apps/web/package.json` | Call it out as an allowed new dependency and lazy-load the editor chunk, with a bundle-size budget |
| P5-40 | minor | §2.1 `onBudget.wrapUp.prompt: z.string()` | It is not a `PromptDefinition`, so it has no templating or file prompt | §2.1 | Use `PromptDefinition` |
| P5-41 | minor | §4.3 unattended waits | A `wait` with no `timeoutMs` on an automation or webhook run hangs forever | P03 PD-2 pause TTL | Apply the `pause_ttl` (72 h) to waits of unattended runs |
| P5-42 | minor | WP-5.7 CLI | `generatorai run command <run> <instance> <command> [--n] [--text]` cannot carry `deliver_event {eventKey,data}`, `approve {data}` or `raise_budget {delta}` | WP-5.7 | Use `--json '<payload>'`, and `--event-key`/`--data @file` |
| P5-43 | minor | §4.4 judge rule | The threshold scale, the judge's inputs (output only, or a diff?), multiple judge rules and repair exhaustion are undefined | WP-5.4 | Score 0–10. Inputs: the output plus an optional `include: ['diff']`. `stage_attempts.judge` holds an array per repair round. Below the threshold after `repair.maxRepairs` → a repairable error → P03 precedence |
| P5-44 | minor | WP-5.3 check admission | A check's admission lane and retry classification are unstated | WP-5.3 | Flow key `check:global` (default 2), separate from the provider lanes. Only a spawn `EAGAIN`/`EBUSY` is transient; timeouts and non-zero exits are deterministic |
| P5-45 | minor | L3 `session: {model:'haiku'}` | This is an alias, not a catalog id. P04 validates "the model exists in the catalog" | P04 WP-4.2 | Use a catalog id or document alias resolution |
| P5-46 | minor | Header "Closes" | It omits kind 6, which README credits to P05, and says kinds 1, 2 and 12 are only partly P05 | README §5.3 | Align: 3, 4, 6, 8, 9, 10, 11, 13, 14, 15 (plus parts of 1, 2, 12) |
| P5-47 | minor | WP-5.1 "Add `followUpPrompts` … `WorkflowSpec.outputs` (new)" | Both already exist in P01 design decision 2 | P01 | Say "enable/extend", not "add" |
| P5-48 | minor | §2.1 `map-shared-write-concurrency` | The validator cannot know statically whether a body is "write-capable": agent tool groups resolve at run time (agent snapshot, P02) | WP-5.1 | Check it at compile and invoke time from the agent snapshot, with a save-time warning only |

---

## Example corrections (exact replacements)

These assume the fixes above: the E(k)/T(k+1) contexts, simultaneous carry plus `loop.priorCarry`, per-stage signals, list literals, `at()`, `map()`, string `concat`, expressions inside `{{ }}`, and `sessionReuse` enum + `compactAfter`. If P5-13 (an `exits[]` list) is adopted, the four slots below translate 1:1 into `exits` entries.

### L1 (fix → review; mostly fine)
The corrections:
- `sessionReuse` becomes the enum form;
- the review schema is completed;
- an explicit null-safe `select`;
- operator input is covered by the automatic operator turn (P5-17), so no template change is needed.

```jsonc
{ "key": "fix_review", "kind": "loop",
  "budget": { "maxTurns": 250, "maxCostUsd": 12 },
  "loop": {
    "maxIterations": 5,
    "until": { "when": "stages.review.output.verdict == 'approve'", "reason": "approved" },
    "stall": { "when": "not loop.last.signals.workspaceChanged", "consecutive": 2, "reason": "no_changes" },
    "carry": { "openComments": "stages.review.output.comments" },
    "onExhausted": { "mode": "pause" },
    "output": { "select": { "summary": "loop.last.stages.review.output.summary" } } } },
{ "key": "fix", "parentKey": "fix_review", "kind": "agent", "sessionReuse": "continue",
  "prompts":         [{ "text": "Fix issue {{variables.issue_url}}. Triage: {{stages.triage.output.summary}}" }],
  "followUpPrompts": [{ "text": "The reviewer requested changes:\n{{loop.carry.openComments | json}}\nAddress each one, run the tests, and report per comment id in `addressed`." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["changes", "addressed"],
    "properties": { "changes": { "type": "string" },
      "addressed": { "type": "array", "items": { "type": "object", "required": ["id", "resolution"],
        "properties": { "id": { "type": "string" }, "resolution": { "enum": ["fixed", "wontfix"] }, "note": { "type": "string" } } } } } } } },
{ "key": "review", "parentKey": "fix_review", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "text": "Review the diff for {{variables.issue_url}}.{{#if loop.previous}} Verify these earlier comments were addressed: {{loop.carry.openComments | json}}. Fix report: {{stages.fix.output.addressed | json}}{{/if}}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["verdict", "comments", "summary"],
    "properties": { "verdict": { "enum": ["approve", "changes_requested"] }, "summary": { "type": "string" },
      "comments": { "type": "array", "maxItems": 50, "items": { "type": "object", "required": ["id", "severity", "body"],
        "properties": { "id": { "type": "string" }, "severity": { "enum": ["blocker", "major", "minor", "nit"] },
          "file": { "type": "string" }, "line": { "type": "integer" }, "body": { "type": "string" } } } } } } } }
// edges: triage -> fix_review ; fix -> review (body) ; fix_review -> open_pr
```
(If P5-9 keeps `loop.budget` instead of StageBase.budget, move `budget` back inside `loop`.) `bullets` on a list of objects is not specified, so `json` is used; alternatively define `bullets` on objects as `- [id] body`.

### L2 (test until green)
The original stall used `loop.history[len(...)-2]` (invalid) and hashed volatile output.

```jsonc
{ "key": "green", "kind": "loop",
  "loop": { "maxIterations": 6,
    "until": { "when": "stages.tests.output.passed", "reason": "tests_pass" },
    "stall": { "when": "not stages.tests.output.passed and stages.tests.output.json.numFailedTests >= loop.previous.stages.tests.output.json.numFailedTests",
               "consecutive": 2, "reason": "no_fewer_failures" },
    "carry": { "lastFailure": "stages.tests.output.stdoutTail" },
    "onExhausted": { "mode": "pause" } } },
{ "key": "fix", "parentKey": "green", "kind": "agent", "sessionReuse": "continue",
  "prompts":         [{ "text": "Make the test suite pass without weakening tests." }],
  "followUpPrompts": [{ "text": "Tests still fail:\n{{loop.carry.lastFailure}}\nFix the root cause." }] },
{ "key": "tests", "parentKey": "green", "kind": "check",
  "check": { "command": "pnpm", "args": ["exec", "vitest", "run", "--reporter=json", "--silent"],
             "parseJson": true, "timeoutMs": 600000 } }
// body edge: fix -> tests
```
Notes:
- `>= null` is false in iteration 0, so there is no false stall.
- Vitest's JSON reporter prints `numFailedTests`, and failing tests leave the JSON on stdout.
- `pnpm exec vitest` passes the runner's package-runner rule (`vitest` is allow-listed).
- It requires the P5-4 Windows fix.
- The failure text lives in the JSON (`testResults[].message`), so the carry could instead be `map(filter(stages.tests.output.json.testResults, r => r.status == 'failed'), r => r.message)`.

### L3 (goal-seeking)
The corrections:
- "same blocker" compares against the **previous iteration**, not a just-updated carry;
- `consecutive: 2` of "same as previous" = 3 identical blockers in a row (Codex);
- the stall uses the **work** stage's tool calls only (Codex anti-spin);
- assess is given the objective.

```jsonc
{ "key": "goal", "kind": "loop",
  "budget": { "maxTurns": 400, "maxCostUsd": 25 },
  "loop": { "maxIterations": 20,
    "until":     { "when": "stages.assess.output.status == 'met'", "reason": "met" },
    "failWhen":  { "when": "stages.assess.output.status == 'impossible'", "reason": "impossible" },
    "pauseWhen": { "when": "stages.assess.output.status == 'blocked' and stages.assess.output.blocker == loop.previous.stages.assess.output.blocker",
                   "consecutive": 2, "reason": "blocked" },
    "stall":     { "when": "loop.last.signals.stages.work.toolCalls == 0", "consecutive": 2, "reason": "no_progress" },
    "carry":     { "gaps": "coalesce(stages.assess.output.gaps, [])" },
    "onBudget":  { "wrapUp": { "stage": "work", "prompt": { "text": "Budget reached. Summarise verified progress, remaining work, blockers, and the next step. Do not start new work." } } } } },
{ "key": "work", "parentKey": "goal", "kind": "agent", "sessionReuse": "continue", "compactAfter": 8,
  "prompts":         [{ "text": "Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nConstraints: {{variables.constraints}}\nWork from evidence in the current workspace, and keep the full objective." }],
  "followUpPrompts": [{ "text": "The assessment found these unmet requirements:\n{{loop.carry.gaps | bullets}}\nContinue." }] },
{ "key": "assess", "parentKey": "goal", "kind": "agent", "sessionReuse": "fresh",
  "session": { "model": "<catalog id of a small model>" },
  "prompts": [{ "text": "Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nAudit whether the objective is met in the current workspace. For each requirement cite the evidence and classify it as proves / contradicts / missing. Uncertain means not met. If you are blocked, give a short stable identifier for the blocker in `blocker`." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["status", "gaps"],
    "properties": { "status": { "enum": ["met", "not_met", "blocked", "impossible"] }, "blocker": { "type": "string" },
                    "gaps": { "type": "array", "items": { "type": "string" } } } } } }
// body edge: work -> assess ; the wrap-up output appears at stages.goal.output.wrapUp (P5-16)
```

### L4 (refine, keep the best)
The original `critique` had no `prompts`, which is invalid (`prompts.min(1)`). The `score` type was missing, and so was the edge.

```jsonc
{ "key": "refine", "kind": "loop",
  "loop": { "maxIterations": 4,
    "until": { "when": "stages.critique.output.score >= 8", "reason": "good_enough" },
    "carry": { "issues": "stages.critique.output.issues" },
    "onExhausted": { "mode": "accept_best", "score": "stages.critique.output.score" },
    "output": { "select": { "notes": "loop.last.stages.draft.output" } } } },
{ "key": "draft", "parentKey": "refine", "kind": "agent", "sessionReuse": "continue",
  "prompts": [{ "text": "Write the release notes for {{variables.version}}. Output only the notes." }],
  "followUpPrompts": [{ "text": "Improve the draft. Critique:\n{{loop.carry.issues | bullets}}" }] },
{ "key": "critique", "parentKey": "refine", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "text": "Score these release notes 0-10 for accuracy, completeness and clarity, and list concrete issues:\n{{stages.draft.output}}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["score", "issues"],
    "properties": { "score": { "type": "number", "minimum": 0, "maximum": 10 },
                    "issues": { "type": "array", "items": { "type": "string" } } } } } }
// body edge: draft -> critique. checkpointEachIteration is implied by accept_best (compiler).
// With accept_best, loop.last = the chosen iteration (P5-14), so `notes` is the best draft.
```

### L5 (research until dry)
```jsonc
{ "key": "research", "kind": "loop",
  "loop": { "maxIterations": 8,
    "carryInit": { "seen": "[]" },
    "carry": { "newItems": "diff(stages.find.output.findings, loop.carry.seen, f => f.url)",
               "seen": "take(unique(concat(loop.carry.seen, stages.find.output.findings), f => f.url), 2000)" },
    "until": { "when": "len(loop.carry.newItems) == 0", "consecutive": 2, "reason": "dry" },
    "output": { "select": { "findings": "loop.carry.seen" } } } },
{ "key": "find", "parentKey": "research", "kind": "agent", "sessionReuse": "fresh",
  "prompts": [{ "text": "Find sources on {{variables.topic}}. Do not repeat these URLs:\n{{ take(map(loop.carry.seen, f => f.url), 200) | bullets }}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["findings"],
    "properties": { "findings": { "type": "array", "items": { "type": "object", "required": ["url", "title"],
      "properties": { "url": { "type": "string" }, "title": { "type": "string" }, "summary": { "type": "string" } } } } } } } }
```
Under the P5-1 semantics, both carry keys read carry(k-1), so `newItems` is correct whatever the key order. `[]` unifies with the findings item type (P5-10).

### L6 (nested)
The original had no prompts on `plan`, and no feedback, so every iteration was identical.

```jsonc
{ "key": "migrate_until_clean", "kind": "loop",
  "loop": { "maxIterations": 3, "until": { "when": "stages.typecheck.output.passed", "reason": "clean" } } },
{ "key": "plan", "parentKey": "migrate_until_clean", "kind": "agent",
  "prompts": [{ "text": "List every file that must change to migrate to the new API." }],
  "followUpPrompts": [{ "text": "Typecheck still fails:\n{{loop.previous.stages.typecheck.output.stdoutTail}}\nList only the files that still need changes." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["files"],
    "properties": { "files": { "type": "array", "maxItems": 100, "items": { "type": "object", "required": ["path"],
      "properties": { "path": { "type": "string" }, "reason": { "type": "string" } } } } } } } },
{ "key": "per_file", "parentKey": "migrate_until_clean", "kind": "map",
  "map": { "items": "stages.plan.output.files", "itemKey": "item.path", "maxItems": 100, "concurrency": 4,
           "workspace": "mount_per_item", "merge": "sequential" } },
{ "key": "edit", "parentKey": "per_file", "kind": "agent",
  "prompts": [{ "text": "Migrate {{item.path}} to the new API. Reason: {{item.reason}}" }] },
{ "key": "typecheck", "parentKey": "migrate_until_clean", "kind": "check",
  "check": { "command": "pnpm", "args": ["typecheck"], "timeoutMs": 900000 } }
// body edges: plan -> per_file -> typecheck
```

### M3 (adversarial verification)
This needs the P5-20 results shape and a per-item `select`.

```jsonc
{ "key": "verify_findings", "kind": "map",
  "map": { "items": "stages.audit.output.findings", "itemKey": "item.id", "maxItems": 50, "concurrency": 4, "workspace": "shared", "merge": "none",
           "output": { "select": { "confirmed": "count(stages.verify_map.output.results, r => r.stages.verify.output.real) >= 2" } } } },
{ "key": "verify_map", "parentKey": "verify_findings", "kind": "map",
  "map": { "items": "['correctness', 'security', 'reproducibility']", "maxItems": 3, "concurrency": 3, "workspace": "shared", "merge": "none" } },
{ "key": "verify", "parentKey": "verify_map", "kind": "agent",
  "prompts": [{ "text": "Independently verify this finding from the {{item}} angle. Default to real=false unless you can demonstrate it:\n{{ loop_parent_item_placeholder }}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["real", "evidence"],
    "properties": { "real": { "type": "boolean" }, "evidence": { "type": "string" } } } } }
```
The inner body needs the **outer** item. `item` is shadowed, exactly the P5-35 problem for maps. Add `maps.<mapKey>.item`, and write `{{maps.verify_findings.item | json}}` in place of the placeholder. Also: a read-only body in `shared` passes `map-shared-write-concurrency` only if the `verify` agent has no write groups; say so.

### M2
Either add a `list` variable type (P5-23), or change it to `items: "stages.collect.output.sources"`.

### W2
```jsonc
"wait": { "type": "event", "eventKey": "concat('ci:', stages.push.output.sha)", "timeoutMs": 3600000, "onTimeout": "fail" }
```
With P5-26, CI posts to `stages.wait_ci.callbackUrl` (per-wait token) instead of holding an `exec:agent` credential.

### W1 and W3
Valid as described. W1's timeout route needs an edge `approve -> escalate` with `when: "stages.approve.output.outcome == 'timeout'"` and `on: "completion"` (a timeout with `onTimeout: 'fail'` would otherwise need `on: failure`). Say which applies.

### S1
Replace `workflowDefinitionId` with `workflowRef: { name: "security-review" }` (P5-25b), and declare `outputs: { verdict: "stages.review.output.verdict" }` on the child.

---

## Cross-file inconsistencies to fix

1. **README §1 R4 row (line 52)** still reads "the 'Review loop' preset (exactly this scenario), the 'Goal' preset". Rewrite: "generic loop; fix/review and goal are templates L1/L3".
2. **README R5 row (line 53)** says "PHASE-05 presets (goal, review loop, judge panel, adversarial verify)". The judge panel is P08.
3. **README §5.3 kind 10** says `pauseWhen {consecutive: 3}`. After the L3 fix it becomes `{consecutive: 2}` comparing against the previous blocker (= 3 identical in a row).
4. **P05 header "Closes"** versus the README phase map and §5.3: add kind 6 and mention 1, 2 and 12 as partial.
5. **P01 design decision 2** has `sessionReuse: fresh|continue`, while P05 changes the shape. Keep the enum and add `compactAfter` (P5-8); update the P01 gate list if `compactAfter` must be gated.
6. **P01 already has `followUpPrompts` and `WorkflowSpec.outputs`**, but P05 says "add"/"new".
7. **P01 `VariableDefinition`** needs `list`/`json` types (M2, and `map.items` over variables).
8. **P01 Expression v2 / `grammar.ts`** needs the P05 grammar delta (list literals, `at`, `map`, `filter`, string `concat`, expressions inside `{{ }}`, reserved roots `loops` and `maps`). P01 reserved roots: add `loops` and `maps` if P5-35 is adopted.
9. **P01 design decision 5** says values reach command-bearing fields by "env vars or argv", while P05 says env only. Align on env for templated values, with args literal (needed for Windows `cmd /c` escaping). P01 WP-1.7 also says "hook `env` values must be `secretref:`": clarify that `check.env` may hold templated non-secret values, and that secrets must be `secretref:`.
10. **P03 WP-3.2 `turn_role` list**: add `wrap_up`, `digest`, `iteration_input`, and state that there is no CHECK constraint. Otherwise P05 would have to rebuild `chat_messages`.
11. **P03 WP-3.6 commands list**: `approve {outcome, feedback?}` needs `data?` (wait forms), and the P05 commands (`grant_iterations`, `raise_budget`, `continue_with_input`, `accept`, `accept_iteration`, `deliver_event`) should be listed as P05 additions to the same schema.
12. **P03 WP-3.5 and P07 WP-7.1** say checkpoints are skipped for read-only stages (P03) and when unchanged (P07). P05 must not depend on P07; add its own iteration tree hash (P5-15).
13. **P04** never enumerates trigger kinds. P05 needs trigger `stage` (or `subworkflow`) at P04 time, but it is introduced only in G4 and P06 (P06 line 45). Define the trigger union in P04 WP-4.2.
14. **P06 WP-6.2 `WorkflowApprovalService`** is extracted in P06, but P05 already mirrors child approvals. Either move the extraction into P05 or have P05 mirror through the commands API only.
15. **P06 WP-6.8 MCP "Prompt: `author_workflow`"** appears in Claude Code as the slash command `/mcp__generatorai__author_workflow`. This is external to GeneratorAI, but it conflicts with a strict reading of PO requirement 3. Drop the MCP prompt (resources plus tools suffice), or document explicitly that it is an external-client affordance and not a GeneratorAI command.
16. **P08 line 65** says "Adversarial verify, loop-until-dry and completeness critic already ship in P05 as templates (M3, L5 and the critic pattern)". P05 WP-5.8 ships no adversarial-verify or critic template. **P08 line 5** says kind 7 is expressed "through presets" after P05/P06, but the judge panel is P08 WP-8.3.
17. **STATUS.md**:
    - the v59 row should add `loop_iterations` (P5-19), the `workflow_run_events` shape change (P5-26) and `stage_runs.item_key` (P5-20);
    - the v57 row should name `stage_runs.loop_state`, `scope_id`, `iteration_index` and `item_index` explicitly (they come from G5 §6.2 but are easy to miss);
    - the README phase-map estimate should change if P5-28 is accepted.
18. **G5 §2.11** says a hard budget abort → the loop exhausts, but the P05 algorithm routes it to `body_failed` (P5-7). "This file wins" should not be applied here; fix P05.
19. **P07 WP-7.2 flow keys** should list `check:global` (P5-44) next to `worktree:<mountId>`.
20. **TRACEABILITY R4/R5** are fine. After the fixes, add the new test names (the judge rule, v59, Windows check) to the gate rows.

---

## PO requirement check (summary)

| Requirement | Status |
|---|---|
| 1. A generic loop: any body, any exit | **Mostly met.** It is limited by the four fixed exit slots (P5-13). Otherwise generic |
| 2. Goal, test-until-green, refinement and research-until-dry through the same primitives, with clear examples | **Intent met; the examples are wrong.** L2, L3, L4, L5 and L6 need the corrections above before they can serve as reference templates or skill examples |
| 3. No slash or chat commands | **Met inside GeneratorAI.** Everything is DAG, builder, JSON or commands API. The only residue is P06's MCP prompt (cross-file #15) |
| 4. Sound, consistent and executable | **Not yet.** 5 blockers (the evaluation contexts, the grammar, the Windows check, the check schema, the carry/exit order) and 27 majors, notably the effect step, the budget path, the mount APIs, the map shape, the event table and the tests |
