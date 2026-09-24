# F: Live workflow-module tests (isolated server, 2026-09-24)

Runner: live test agent. Branch `desktop_redesign`. All runs were against an **isolated** server on `127.0.0.1:3111` (DB `C:/gaimob/data/data.db`). The user's server on :3100 and the real DB were not touched. Scripts, logs and raw results are in `C:/gaimob/wfe2e/`.

Harness: `claude-agent`, model `haiku` (resolved to `claude-haiku-4-5-20251001`, confirmed from `harness.usage` payloads). claude-agent was authenticated and ready; copilot was ready too but not used.

---

## 0. Setup recipe (what worked)

1. `sh C:/gaimob/start-server.sh > C:/gaimob/wfe2e/server.log 2>&1` (Bash `run_in_background`). The server listens after about 15 s. It loads 20 extensions plus the TTS/STT models, and its working set is about 1.4 GB before any workflow runs.
2. **Auth without the CLI and without `~/.generatorai`:** `C:/gaimob/wfe2e/client.mts` imports `packages/client-runtime/src/index.ts` by absolute `file:///` URL (run with the repo's `node_modules/.bin/tsx`). It uses a **file-backed `SecretSink`** (`CREDS` env var, default `C:/gaimob/wfe2e/creds.json`) and pairs through the loopback recovery channel:
   `POST /internal/desktop/pairing` with `Authorization: Bearer <local-admin.json token>`, then `parsePairingCode(pairingUrl)`, then `runtime.completePairing({... platform:'cli'})`. That gives an all-scope DPoP device. `runtime.fetch('/api/...')` signs every request. `runtime.buildStreamUrl('run', runId)` gives a ticketed SSE URL for `GET /api/stream?scope=run&id=`.
   - Gotcha 1: **each concurrent process needs its own creds file.** The resume secret rotates on refresh, so two processes sharing one file get `CREDENTIAL_SUPERSEDED` (401).
   - Gotcha 2: **do not pair two processes at the same moment.** Minting a new recovery grant revokes the outstanding one (`REVOKED: Pairing code has been revoked`).
   - No CLI connection was created, so there is nothing to `connect remove`. `~/.generatorai` was never written.
3. DB inspection: `C:/gaimob/wfe2e/db.mjs` (better-sqlite3 from `packages/db`, read-only, WAL-safe while the server runs).
4. Endpoints used: `POST /api/workflow-definitions`, `.../:id/stages`, `.../:id/edges`, `.../:id/export`, `.../import-json`, `.../:id/validate`; `POST /api/workflow-runs {workflowDefinitionId, variables}` then `POST /:id/start` (202, fire-and-forget); `/pause`, `/resume`, `/cancel`, `/retry`; `/:runId/stages/:stageId/{approve,retry,wake}`; `GET /:id/pending-interrupts`.
5. Generic runner: `runwf.mts <spec.json>` (definition + run + timeline + SSE capture). The spec files are `t2.json`, `t3.json`, `t3b.json`, `t4.json`, `t4b.json`, `t7.json`. Dedicated scripts: `t1.mts`, `t5.mts` (hitl|pause|cancel|retry), `t6.mts`, `t8.mts` + `t8snap.mjs`, `t10.mts`, `stageretry.mts`.

**Model noise caveat:** haiku often **refused** "Reply with exactly this line…" prompts as "prompt injection". This happened in about 30% of stages in T2/T4/T7. It affects only the *content* of some outputs, never the orchestration results below. It is probably provoked by the long `IMPORTANT: How to create files…` boilerplate that the stage executor appends to every prompt (see O-6). Where a refusal made a result inconclusive, the report says so.

---

## 1. Results table

| Test | Result | One-line verdict |
|---|---|---|
| T1 fan-out/fan-in (1→5→join→final) | **PASS (functional) / perf issues** | Join correct and run `completed`. Branch launches are serialized by a checkpoint lock (≈2.7 s per branch). Real concurrency is capped at 4 model turns. Each stage runs 2–3 model turns. |
| T2 conditional routing | **PASS** | AND/OR/NOT/&&/\|\|/!/parens/lower-case `and` all correct. Skip cascade correct. A join with a skipped predecessor runs and does not hang. An `always` edge from a skipped stage fires. Limitation: expressions cannot reference stage output. `stages.X...` silently evaluates to false (skip). |
| T3 failure paths + edge types | **PASS** | 3 attempts, backoff 2 s then 4 s. Every retry uses a fresh session. `on_failure`, `on_completion` and `always` ran; `on_success` was skipped. Run `completed` (failure handled). |
| T3b unhandled failure / default retry | **PASS w/ issues** | Default retry is 1 when no policy is set (validation's default is 0). `timeoutMs` does not bound the context turn. `single` mode re-injects context and re-sends the prompt into the shared conversation. |
| T4 result validation | **FAIL** | Validation text includes the summary / context / output-retry turns. `json_schema` compares top-level *schema keywords*. `llm_validation` is a stub. `custom_script` cannot take arguments. A validation race lets a failing stage end `completed`. |
| T4b validation retry | **FAIL** | An in-session validation retry is killed by the stale-heartbeat reaper ("executor is hung"), so retries 2..N never run. |
| T5 HITL approve / reject | **PASS** | Approve works, a second approve returns 409, approving a non-parked stage returns 409, reject fails the run without retry and skips the successor. |
| T5 HITL changes_requested | **FAIL** | The revision turn runs, but its reply is never streamed, persisted or merged into `outputText`. The approved output is the *pre-revision* one. |
| T5 pause/resume | **FAIL (data loss)** | Pausing mid-stage aborts the prompt, then the stage still runs its summary turn and is marked `completed` with **empty output** while the run is paused. On resume it is not re-run. |
| T5 cancel | **PASS w/ issue** | The run and all stages become `cancelled` and processes are gone within 33 s. The cancel call takes 3.8 s, and during that time stages keep dispatching new turns (prompt and summary prompts sent after cancel). |
| T5 run retry | **PASS w/ issues** | Returns a new run id and copies completed stages (no messages re-generated); only failed/cancelled stages re-run. Retrying a completed run gives **HTTP 502 UNKNOWN_ERROR**. The same ancestor can be retried again, which creates duplicates. |
| T5 stage retry on a terminal run | **FAIL** | Re-executes the stage, which ends `completed` although its validation rule still fails (validation skipped). The run stays `failed` with a stale error. |
| T5 wake | **PASS (negative paths only)** | 409 `STAGE_NOT_SLEEPING`; 404 for a foreign run. The sleeping path was not exercised because no API puts a stage to sleep. |
| T6 export → import round trip | **FAIL** | Loses `orchestratorConfig` (preprocessing + workflow-level validations), `hooksFile` and every stage's `agentMode`. Create itself silently drops `skills`, `agents`, `browserConfig`, `defaultAgentRef`, stage `skills` and stage `browserConfig`, and turns `useWorktree:false` into `true`. |
| T6 malformed imports | **PARTIAL** | Cycle, self-loop, missing stage, duplicate edge, negative index and zero stages are rejected. Duplicate stage names, duplicate order, unparseable conditions, `expression` without text, and unknown `contextSources` are accepted. Malformed JSON returns `UNKNOWN_ERROR/process`. |
| T7 context passing | **PASS (mechanics)** | `full` injects the full output, `none` injects nothing, `contextSources` pulls a non-predecessor, and `{{var}}`/`{{a.b}}` interpolate. An unresolved `{{x}}` is sent raw, with a `session_info` warning. Content check inconclusive (stage A refused). There is no templating of stage outputs. Context is delivered as an extra model turn. |
| T8 crash recovery | **FAIL (silent data loss)** | Recovery re-drives, there is no double execution and the run completes. But the finished prompt turn was classified "in flight" and skipped, and the summary resume failed (`--resume` with a non-UUID). The stage was marked `completed` with empty output and null summary, so the successor ran with no context. |
| T9 streaming | **PASS w/ perf notes** | No duplicate or out-of-order ids (1188/1188 unique, monotonic). Tokens arrive in ≈15–40 ms bursts after an ≈8–9 s time to first event per turn. Every event is written 3× (2 SQLite rows + JSONL). |
| T10 scale (25 stages) | see §4 | |

---

## 2. Confirmed bugs

Severity: P0 = data loss or wrong result reported as success on a common path; P1 = feature broken or silent wrong state; P2 = degraded or misleading; P3 = cosmetic or API hygiene.

### F-1 (P1): Pausing a run mid-stage turns the stage into `completed` with empty output
- **Repro:** `t5.mts pause`. The definition is L1 (a long prompt) → L2 in `per-stage` mode. Start the run, wait until L1 is running plus 6 s, then `POST /workflow-runs/:id/pause`. Wait 15 s, then `/resume`.
- **Observed** (lifecycle ms): `stage_run.step_started` 6864 → `workflow_run.paused` 15843 → `stage_run.step_completed` 19904 → **`stage_run.completed` 32617** (the run is still `paused`) → `workflow_run.resumed` 39460 → L2 runs → run `completed`. Four seconds after the pause, L1 was `paused`. At +15 s it was `completed`. L1 messages: the prompt at t=087 has **no assistant reply**. A summary prompt went out at t=101 and the summary answer was "I don't see any prior work context…". L1 `outputText` = `''`. L1 is not re-executed after resume.
- **Expected:** the stage stays `paused`, and resume continues or re-runs the prompt.
- **Suspected location:** `StageExecutionService.executeStage` prompt loop (`packages/core/src/services/StageExecutionService.ts` ~1956–2060). The aborted `sendPromptAndWait` *resolves* rather than throws, so the paused/cancelled guard in the `catch` (~2604) never runs. The code then falls through to output-retry, the summary turn and the `status:'completed'` write (~2560). The status is not re-checked after each turn.

### F-2 (P1): HITL "changes requested" revision reply is lost
- **Repro:** `t5.mts hitl`. P1 has `approvalRequired:true` → P2. When P1 is `awaiting_input`, post `approve {approved:false, followUpPrompt:'Append the word REVISED…'}`, then approve.
- **Observed** (run `46e800a1`): the follow-up user message is persisted (`isApprovalFeedback`, round 1) at t=903. The stage flips to `running`, re-parks at t=917.9 as "updated after feedback (round 2)" (so the model ran for ~15 s), but it produced **zero harness events** in session or run scope, **no assistant message**, and `outputText` is unchanged ("P1 alpha…", no REVISED). After approval P2 received the pre-revision output.
- **Cause:** `unsubscribe?.()` at `StageExecutionService.ts:2225` tears down the conversation subscription *before* the review loop (~2440–2505). The loop's comment says "existing subscription handles emission + persistence", so `turnContent` stays `''` and the merge at ~2507 is skipped.

### F-3 (P1): Crash recovery completes the interrupted stage with empty output and no summary
- **Repro:** `t8.mts a`, then `taskkill /PID <server> /T /F`, then restart, then `t8.mts b`. C1 is a long prompt → C2.
- **DB before kill:** run `running`; C1 `running` v3, heartbeat t=428. C1 prompt (t=418) **and its assistant answer (t=433) already persisted** 12 s before the kill.
- **After restart:** `[Recovery] Re-driving interrupted workflow run … (1 stage(s) reset)`. On the C1 session stream:
  - `durable_turn_skipped: Turn "prompt/0" was in flight when the process restarted… not re-run`. The turn had in fact finished: its answer was in `chat_messages`.
  - summary turn → `harness.error: --resume requires a valid session ID … Provided value "stage-1043cb98-…-1790231418121" is not a UUID`
  - `stage_run.completed` 0.6 s later.
- **Final:** C1 `completed`, `output_text=''` (len 0), `summary=NULL`. C2 had **no context message** and ran blind. Run `completed`.
- **Good:** there was no double execution (the prompt was not re-sent), no orphan claude processes after the kill, and the run did not hang.
- **Three defects:**
  - (a) the journal settle for `prompt/0` lags the assistant-message persist, so a finished turn is replayed as "in flight";
  - (b) the rehydrated session is resumed with the GeneratorAI conversation id instead of the provider session UUID (claude-agent resume path);
  - (c) a stage whose only turn was skipped and whose summary errored is still marked `completed`. The code comment at `StageExecutionService.ts:1627-1630` says this is "worse than either alternative".

### F-4 (P1): Validation retry in-session is killed by the stale-heartbeat reaper
- **Repro:** `t4b.json` stage `V_retry`, `retryPolicy {maxRetries:2, backoffMs:1000}`, with a rule that can never pass.
- **Observed:** `Validation failed … (attempt 1/3). Triggering validation retry.` (t=095.97), then 20 s later `Stage heartbeat stale: no liveness beat for 33s (limit 30s) — the executor is hung or its process is gone`. The stage ends `failed` with retryCount 1. Attempts 2 and 3 never happen, and the error message blames a hung executor.
- **Cause:** `retryInSession` (`StageExecutionService.ts:2744`) never calls `startHeartbeat`. The heartbeat is started only at `:1373` and stopped at `:2729`. The reaper is `WorkflowRunService.failStaleStage` (`:1602`). Any in-session retry whose turn plus backoff exceeds about 30 s since the last beat is reaped.

### F-5 (P1): Validation race lets a stage that fails its rules end `completed`
- **Observed** (T4 run `89f9a1c3`, 11 parallel validated stages): `V_retry` (contains `NEVER-PRESENT-XYZ`, maxRetries 2) and `V_llm` ended **`completed` r0**. There is no ResultValidator log line for either. The run was finalized `failed` at t=783.9, the same second both stages wrote `completed`.
- **Mechanism:** `executeStage` writes `status:'completed'` *before* `WorkflowRunService.onStageCompleted` validates. A concurrent reconcile (another stage's completion or failure, or the poll backstop) sees every stage terminal and finalizes the run. The late `onStageCompleted` then returns at `if (run.status !== 'running') return;` (`WorkflowRunService.ts:~1301`) without validating.
- In a run where the other stages pass, this reports **`completed` with an unvalidated, rule-violating stage**. It was observed once in a natural run. A deterministic repro was not attempted.

### F-6 (P1): Result validation checks the wrong text
- `ResultValidator.validateStageResult` joins **every assistant message** of the stage (`ResultValidator.ts:54`). That includes the context-ack turn, the output-retry turn and the **summary turn**.
- Evidence (T4 run `89f9a1c3`; the actual answer was the 54-char line `GREEN-7731 alpha … golf` in every case):
  - `max_length 200` → **failed** (summary adds ~700 chars)
  - `not_contains "instruct"` → **failed** (only the summary says "as instructed"; `instr()` = 0 on the real answer)
  - `regex ^GREEN-7731 … golf$` → **failed**
- The inverse also holds: a `contains` rule can pass because the *summary* mentions the token.

### F-7 (P2): `json_schema` rule treats the JSON Schema's keywords as required output keys
- The output was exactly ```` ```json {"name":"Bob","age":42} ``` ```` against `{type:'object', required:[…], properties:{…}}`. Log: `json_schema validation failed — missing keys: type, required, properties` (`ResultValidator.ts:190-229`). Any real JSON Schema fails. Only `{name:{}, age:{}}`-style pseudo-schemas can pass.

### F-8 (P2): `llm_validation` is a stub
- It passes whenever the output is ≥50 chars (`ResultValidator.ts:233-247`). Criteria "must be written entirely in French and mention Paris" **passed** on English output (`t4b` `V_llm_french` completed). Because the summary is included (F-6), it effectively always passes.

### F-9 (P2): `custom_script` cannot run a meaningful check
- The whole `value` string is passed as the executable with `args: []`. `SandboxedScriptRunner` (`packages/core/src/infrastructure/SandboxedScriptRunner.ts:343,353`) requires a bare, allowlisted name.
  - `node -e "…"` → `must be a bare executable name (no path separators)`. The message is misleading because the command contains no separator.
  - `hostname` → `not in the allowlist. Allowed: echo, eslint, gh, git, jest, jq, node, npm, npx, pip, pip3, pnpm, prettier, pwsh, python, python3, tsc, vitest`
- The schema has no `args` field, so custom scripts can only be bare `node`/`git`/… with no arguments.

### F-10 (P2): Every short answer triggers an extra "output retry" turn, and its text pollutes `outputText`
- If a text-mode stage's output is under 50 chars, a second prompt is sent: "Your response did not include a clear summary of your work…" (`StageExecutionService.ts:2069-2095`, up to 2 retries). Its reply is **appended to `outputText`**.
- Smoke run: `outputText` = `OK-A **Summary** The only instruction…`. `V_json_pass` output became `` ```json {...}``` You're right. I apologize… ``.
- This breaks classification/yes-no stages and JSON consumers, and costs one extra model turn (~12 s) per such stage.

### F-11 (P2): Stage retry on a terminal run bypasses validation and leaves inconsistent state
- `POST /workflow-runs/89f9a1c3…/stages/<V_contains_fail>/retry` (the run is `failed`) → 202. The stage re-executes (model turns spent) and ends **`completed` r1**, although its rule (`contains PURPLE-0000`) still cannot pass. The run stays `failed` with error text still listing that stage.
- Route: `workflowRuns.ts:330-356`. `onStageCompleted` returns early for a non-running run.

### F-12 (P2): Export/import round trip loses fields, and create silently drops fields
- `t6.mts`; diff in `t6-log.json`.
- **Create** (`POST /workflow-definitions`) returns 201 but persists `skills=NULL`, `agents=NULL`, `default_agent_ref=NULL`, **`use_worktree=1` although `false` was sent**. `browserConfig` is dropped (there is no column). Stage `skills` and stage `browserConfig` are dropped (no columns in `stage_definitions`).
- **Export → import-json** additionally loses:
  - `orchestratorConfig`: preprocessingSteps and workflow-level `resultValidations`. Export writes them at the top level; `importFromJSON` reads neither and does not pass `orchestratorConfig` even when present (`WorkflowDefinitionService.ts:563-590`).
  - `hooksFile`
  - `agentMode` on every stage (export omits it, `WorkflowDefinitionService.ts:486-560`)
- Minor diffs: `json-import` tag added; `prompts[].attachments` `undefined → []`.
- Preserved correctly: retryPolicy, timeoutMs, condition, contextFilter, contextSources, outputFormat, outputSchema, expectedOutput, resultValidation, approvalRequired, agentName, agentRef, harnessConfigOverrides, hooks, variables (incl. choice options and defaults), and all 4 edge types.

### F-13 (P2): Import/definition validation accepts broken definitions
- Accepted with 201 (and `POST /:id/validate` returns `valid:true`):
  - **duplicate stage names** (via import and via `POST /stages`). This makes `contextSources` and `hooksFile.stages` ambiguous.
  - duplicate `order`
  - condition `((( variables.x ==`, which is unparseable and evaluates to false forever, so the stage is always skipped
  - `{type:'expression'}` with no expression
  - `contextSources:['nope']`
- A run can be created on the duplicate-name definition.

### F-14 (P2): `timeoutMs` bounds only the prompt turn
- T3b `FF` (`timeoutMs:1000`, successor of A) took **33 s** wall to fail twice. The context turn (~12 s) runs before the prompt with no deadline, and the summary and output-retry turns are also unbounded (`StageExecutionService.ts:1995-2008` wraps only `sendPromptAndWait` of prompts).

### F-15 (P3): `POST /workflow-runs/:id/retry` on a completed run returns **502** `UNKNOWN_ERROR/process`
- It should be a 409/400. The service throws a plain `Error` (`WorkflowRunService.ts:~603`). Also, the same failed ancestor can be retried repeatedly (two new runs from `995dbfe5`), with no guard or idempotency.

### F-16 (P3): Malformed JSON body → 400 `code:"UNKNOWN_ERROR", category:"process"`
- It should be a validation/bad-request code.

### F-17 (P3): Sessions of terminal runs left `active`
- Sessions `770882d3` (T3b stage A, run `failed`) and `4519030b` (T4 `V_retry`, reaped) were still `status='active', closed_at=NULL` and were **re-hydrated** on restart (`[Recovery] Re-hydrated session …`). This leaks conversation ownership across restarts.

### F-18 (P2): `single` session mode re-injects context and re-sends prompts into the shared conversation
- T3b (auto resolved to `single`): stage FF got a "The following stages have already been completed…" context turn, although the same conversation already held A's full exchange. On its retry after timeout, the **same** conversation received the context message and the prompt a second time. The timed-out prompt stays in history unanswered.

---

## 3. Suspicions and observations (not bugs, or not fully proven)

- **O-1 Branch launches are serialized by the checkpoint lock.** In T1 the 5 branches were `queued` at +33.2/36.2/39.2/41.9/44.3 s and began prompting at 48.6/51.8/54.4/56.8/60.6 s: a **~12 s spread** for "parallel" stages. `executeStage` awaits `workspaceCheckpointService.capture()` before emitting `queued` (`StageExecutionService.ts:1100-1113`). Captures take a single-flight lock per (workspace, repo) (`packages/checkpoints/src/CheckpointService.ts:30-63`) and do `git add -A` + `write-tree` (~2.5 s on Windows). The checkpoints table held only 1 row (the rest were skipped as unchanged), so the cost is paid for nothing on stages that write no files.
- **O-2 Hidden concurrency cap of 4.** claude-agent turn permits default to 4 (`GENERATORAI_MAX_CONCURRENT_AGENT_TURNS`; `ClaudeAgentProvider.ts:318, 3061-3077`). The 5th branch got `harness.warning execution_queued: Waiting for a free agent slot`. This is separate from `maxConcurrentStages` (8) and the admission `ordinary` lane (16 on this box). The effective fan-out width is 4.
- **O-3 Per-stage model-turn overhead.** A root stage runs prompt + summary (2 turns). Every non-root stage runs **context-ack turn + prompt + summary (3 turns)**, plus 1–2 output-retry turns when the answer is under 50 chars. With haiku, each turn had ~8–9 s from `user_message` to first `turn_start` event, and `usage.durationMs` was 4–6 s. A trivial stage takes **26 s (root) / 41–47 s (non-root)**. The single-stage smoke run took 40 s for "OK-A".
- **O-4 Scheduler gaps are small.** Predecessor `completed` → successor `queued` took 1.6–2.6 s in T1 (join 2.6 s, final 2.8 s). Skip decisions came 3 s after the predecessor. From `/start` to `workflow_run.running` was 2.2 s, to the first stage `running` 7.6 s (3.6 s in the first checkpoint baseline), and to the first model token ~16 s.
- **O-5 Retry attempt history is not kept.** `stage_runs` keeps only the last attempt's `started_at` (T3 F: `start=398 end=400` for 3 attempts spanning 389–400). The attempt timeline came from `[MultiHarness] conversation stage-… ` log lines (388.98 / 392.92 / 398.93, which matches backoff 2 s → 4 s).
- **O-6 Prompt boilerplate provokes refusals.** Every prompt gets a ~700-char "IMPORTANT: How to create files…" suffix. Haiku repeatedly called trivial directives "prompt injection" and refused (T2 R/C_and/C_not…, T4 V_json_fail, T7 A). This is worth making optional for non-coding stages.
- **O-7 Conditions cannot see stage output.** Only `status`/`parentStatus` and `variables.*` resolve (`ConditionEvaluator.ts:resolveValue`). A string variable `'false'` is truthy, so `!variables.sflag` skipped. This is correct per the code, but it is a footgun if any UI path sends booleans as strings. There is no save-time warning for unknown identifiers.
- **O-8 Defaults differ between execution and validation.** An execution failure with no `retryPolicy` retries once (`DEFAULT_RETRY_POLICY maxRetries:1, 3 s`). A validation failure with no `retryPolicy` never retries (`?? 0`).
- **O-9 Cancel is not instantaneous.** `POST /cancel` took 3.8 s. In that window K2 received its prompt and K1/K3 received summary prompts (t=267/269, after the cancel began at 264). No assistant replies landed afterwards. Claude processes: 6 → 3 (+3 s) → 0 (+33 s).
- **O-10 Server memory** is ~1.4 GB working set at idle (TTS/STT models and extensions). Runs added little (T1: 1451 → 1460 MB).

---

## 4. Performance and scale

### T1 (8 stages, auto mode resolved to per-stage)
- Wall time was 180.9 s. Stage durations: root 26 s; branches 44–47 s; join 41 s; final 41 s.
- Critical path is 4 stages ≈ 155 s of stage time, plus ≈ 25 s of launch, checkpoint and transition overhead.
- The branches overlapped: all 5 were running between +44 s and +80 s. Process samples show up to 7 claude-related processes.

### T9 (T1's SSE stream and DB writes)
- The SSE stream carried 1202 events. By kind: `harness.token` 795, `reasoning_delta` 61, `session_info` 46, `context_usage` 44, and 23 each of `user_message`, `turn_start`, `message_complete`, `usage`, `idle`.
- Ids were unique and monotonic, and each lifecycle event arrived exactly once per stage.
- There were 13 `harness.warning` events: an `MCP_SERVER_FAILED` for the user's "claude.ai Claude Docs" MCP on each turn (stage sessions inherit the user's global MCP config), plus 1 `execution_queued`.
- Heartbeat comments came every 15 s.
- Tokens are grouped 4–6 per flush and a turn's tokens span 15–1900 ms, so delivery is incremental, but the ~8 s time to first event dominates.
- Write amplification for this 8-stage run with ~2.4 KB of real outputs:

| Where | Rows | Size |
|---|---|---|
| `stream_cursors` run scope | 1189 | 227 KB |
| `stream_cursors` session scope | 1183 | 226 KB (the same events again) |
| `artifacts/stream-log.jsonl` | n/a | 395 KB |
| `chat_messages` | 46 | 27 KB |
| `entries` (stage-output + session-lineage artifacts) | 16 | 20 KB |
| per-turn `*_response_N.md` files (context-ack and summary turns included) | 24 | n/a |

- Total is roughly **0.9 MB written for 2.4 KB of useful output**, and each stream event is written 3×.

### T10 (25 stages, 31 edges)
Run `47616615`, `contextFilter:'none'` on all stages (so 2 turns per stage), auto mode resolved to per-stage.

- **Outcome:**
  - Status **completed**: 25/25 stages completed, 0 retries, no errors.
  - Wall time **421 s**.
  - Stage durations: min 23 s, avg 34 s, max 47 s.
  - Model turns: 52 user turns (25 prompts, 25 summaries, 2 output retries).
- **Scheduler overhead** (predecessor end → successor start):

| Transition | Gap |
|---|---|
| chain links | 2–3 s |
| a4 → join1 (3-way fan-in) | 6 s |
| last p → join2 (6-way fan-in) | 1 s |

- The critical path is 12 levels × ~34 s ≈ 408 s, so the scheduler adds only ≈ 13 s (~3%). The cost is dominated by per-stage model turns (O-3).
- **Parallel group p1..p6:** start times 769/772/775/778/780/781. That is again a **~2.5 s serialized stagger** (O-1). There were 8× `execution_queued` warnings (4-turn cap, O-2) and 5× `MCP_SERVER_FAILED` warnings.
- **DB/log volume:**

| Where | Rows | Size |
|---|---|---|
| `stream_cursors` run scope | 2849 | 513 KB |
| `stream_cursors` session scope | 2843 | 510 KB |
| `stream-log.jsonl` | n/a | 915 KB |

  That is ≈ **1.9 MB per trivial 25-stage run**.
- **Memory:** 1396 MB before the crash test (old process). About 1372 MB after T10 on the restarted process. The in-script memory sampler was lost to a post-run script crash, and the numbers were recomputed from the DB (`t10post.mjs`). No growth trend was attributable to the run.
- The 25-stage / 31-edge definition was built through 57 API calls with no errors.

Extra evidence for F-3 from `server2.log`: `[DurableEngine] corruption:missing_settlement — operationId=a0v0/prompt/0: intent committed with replay:never but no settlement — returning synthetic er…`. The engine itself flags the finished prompt turn's journal as corrupt. The stage is still marked `completed`.

---

## 5. Definitions used (abbreviated; full JSON in `C:/gaimob/wfe2e/*.json`)

- **T1** (`t1.mts`): `start` → B1..B5 → `join` → `final`; all edges `on_success`; `harnessConfig {model:'haiku', harnessType:'claude-agent'}`; prompts `Reply with exactly this one line…: <NAME> alpha … hotel` (≥50 chars to avoid F-10).
- **T2** (`t2.json`): R → {C_and `variables.env == 'prod' AND variables.count > 3`, C_or_false `variables.env == 'dev' OR variables.count < 2`, C_not `NOT variables.flag`, C_bang_str `!variables.sflag`, C_amp `status == 'completed' && variables.count >= 5`, C_paren `(variables.env == 'prod' || variables.env == 'staging') && !(variables.count == 5)`, C_lower `… and …`, C_stageref `stages.R.status == 'completed'`}; C_or_false → D_after_skip; {C_and, C_or_false} → J; C_or_false -always→ J_always. Variables `{env:'prod', count:5, flag:false, sflag:'false'}`.
  - Result (expected = observed): run C_and, C_not, C_amp, C_lower, J, J_always; skip C_or_false, C_paren, C_stageref, D_after_skip. C_bang_str was skipped (the string `'false'` is truthy).
- **T3** (`t3.json`): F (`timeoutMs:1000`, `retryPolicy {maxRetries:2, backoffMs:2000, backoffMultiplier:2}`) → S on_success / Rec on_failure / OC on_completion / AL always; Rec → Z. Result: F failed r2; S skipped; Rec, OC, AL and Z completed; run **completed**.
- **T3b** (`t3b.json`): A → FF (`timeoutMs:1000`, no policy) → G. Result: FF failed r1, G skipped, run **failed**. Run retry → new run `f0e03754`: A copied (0 new messages), FF re-run and failed again.
- **T4 / T4b** (`t4.json`, `t4b.json`): one stage per rule type. Pass/fail per rule:

| Rule | Correct? | Note |
|---|---|---|
| contains-pass | ✓ | |
| contains-fail | ✓ | |
| regex `GREEN-\d{4}` | ✓ | T4b; the T4 attempt lost its backslash in my spec, a harness error |
| anchored regex | ✗ | F-6 |
| max_length | ✗ | F-6 |
| not_contains | ✗ | F-6 |
| json_schema pass | ✗ | F-7 |
| json_schema fail | ✓ | fails for the wrong reason |
| custom_script (pass and fail) | ✗ | F-9 |
| llm_validation | ✗ | F-8 |
| min_length | ✓ | |
| validation retry | ✗ | F-4, F-5 |

- **T5** (`t5.mts`): hitl (P1 `approvalRequired` → P2) ×3 verdicts; pause (L1 long → L2); cancel (root → K1..K5 long → after); retry (T3b's failed run, T1's completed run).
- **T6** (`t6.mts`): 4-stage definition with every field populated and all 4 edge types (see `t6-orig.json`, `t6-export.json`, `t6-imported.json`), plus 14 malformed imports and 5 API-level edge cases (`t6-log.json`).
- **T7** (`t7.json`): A (codeword) → B_summary / B_full (`contextFilter full`) / B_none (`none`) / B_struct (`structured`); B_none → B_srcs (`contextSources:['A']`); V_interp `TOPIC={{topic}} NESTED={{obj.inner}} MISSING={{missing_var}}` with `{topic:'otters', obj:{inner:'deep'}}`. Interpolated prompt: `TOPIC=otters NESTED=deep MISSING={{missing_var}}`, plus a `harness.session_info unresolved_variables` event in both run and session scope.
- **T8** (`t8.mts`): C1 (write 1..600) → C2. Snapshots in `t8-snapshots.jsonl`.
- **T10** (`t10.mts`): root → 3 chains a1..a4/b1..b4/c1..c4 → join1 → p1..p6 → join2 → t1 → t2 → t3 → final; `contextFilter:'none'` on all stages.

## 6. Cleanup
- The isolated :3111 server that this agent started was stopped at the end.
- The user's :3100 server was never touched.
- No `~/.generatorai` connection was created, so none needed removing.
- Test data remains in `C:/gaimob/data/data.db` and `C:/gaimob/ws/executions/*`, which is small.
