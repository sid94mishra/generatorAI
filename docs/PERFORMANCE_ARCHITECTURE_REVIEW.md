# GeneratorAI — End-to-End Performance & Concurrency Architecture Review

> Scope: what actually happens, mechanically, when GeneratorAI is asked to run **many chats and/or many workflow runs at the same time** in one server process. Every finding below is backed by a `file:line` citation against the code as of branch `dev` (2026-08-11), cross-checked against `.github/AGENTS.md` and the linked `.github/docs/*` where the docs made a claim. External comparisons (Temporal, LangGraph Platform, BullMQ/Redis-queue systems, SQLite documentation) are cited with sources.
>
> This is a **concurrency/performance** review, not a correctness review. Several of the mechanisms described here are deliberate, documented trade-offs (see `operations.md §5`, `Semaphore.ts` header comment) for GeneratorAI's stated target: **a self-hosted, single-tenant, small-team/solo tool**, not a multi-tenant SaaS. The findings below quantify *how far* that architecture can stretch before it needs the next tier of investment, and what that next tier should be.

---

## 1. Executive summary

GeneratorAI's runtime is a **single Node.js process** holding **one synchronous SQLite connection**, fronted by a **single global concurrency gate** (`Semaphore`, default 8 permits) shared by *every* workflow stage across *every* run, on top of an event-sourcing pipeline that **persists every streamed token to disk up to three times**. Layered on that is a harness abstraction where one provider (`claude-agent`) **pays a fresh OS-process cold-start (~12s, per Anthropic's own SDK issue tracker) on every single prompt turn**, and the other (`copilot`) **funnels every concurrent session through one shared stdio pipe to one CLI subprocess**.

**The single most severe finding in this review, confirmed by code-level verification (F10):** that 8-permit semaphore only gates **workflow stages** — `ChatManagementService.sendPrompt` never touches it. **Chat message sends have no concurrency limit anywhere in the system.** For the `claude-agent` provider, that means N concurrent chat messages become N completely unthrottled, simultaneous `claude` CLI subprocess spawns — the exact scenario the user asked about ("spawn multiple chat agents... in parallel") is the one code path in the entire application with *zero* admission control.

None of these are bugs in isolation — each is a reasonable choice for the documented target (a solo developer or small team running one server on one machine). They become a *compounding* problem the moment the workload shifts to what the user is asking about: **spawning multiple chats or multiple workflow runs in parallel**. The mechanisms don't fail loudly; they degrade quietly — first as added latency (event-loop contention), then as head-of-line blocking (the global semaphore), then as timeouts (`SQLITE_BUSY`, harness subprocess pileup), with no per-tenant or per-run isolation to contain the blast radius.

The project's own `operations.md §5` already candidly documents that horizontal scaling is unimplemented ("Multi-process (horizontal scaling): ... Current state: ... prefer a single owner per DB ... StreamBroker: in-memory subscribers are per-process. Cross-process SSE fan-out requires an external broker (not shipped)."). This review explains *why* that's true at the mechanism level, quantifies the single-process ceiling, and prioritizes what to fix first.

**Headline numbers to anchor the rest of the report:**

| Quantity | Value | Where it's enforced |
|---|---|---|
| Concurrent SQLite write transactions the whole process can have in flight | **1** (single sync connection, single-writer SQLite model) | `packages/db/src/index.ts:230-248` |
| Concurrent workflow *stages* across **all runs combined**, process-wide | **8** (default `maxConcurrentStages`) | `packages/core/src/bootstrap/createCoreServices.ts:404` |
| DB round-trips per streamed token, worst case (chat with a linked workflow run) | up to **~7** (1 EventBus persist + up to 3 StreamBroker scopes × 2 queries each) | `packages/core/src/events/EventBus.ts:115-188`, `packages/core/src/services/StreamBroker.ts:90-99`, composition-root bridge |
| `setInterval` timers running, process-wide | 1 **per active workflow run** (3s period) + ~6 fixed background sweepers | `packages/core/src/services/WorkflowRunService.ts:786-820` |
| Subprocess cold-start cost per turn, `claude-agent` provider | **~12s** (industry-reported; this codebase's design confirms the mechanism) | `packages/agent-harness-providers/src/providers/claude-agent/ClaudeAgentProvider.ts:893,1574`; corroborated externally (§6) |
| Requests actually stopped by the shipped rate limiter | Only **request rate** (60/min/key, 600/min global) — **not** concurrent resource usage | `apps/server/src/middleware/rateLimit.ts:71-153` |
| Concurrency cap on chat `sendPrompt` calls | **None — unbounded** | Confirmed absent from `ChatManagementService.ts` and `ClaudeAgentProvider.ts`/`CopilotProvider.ts` (F10) |

---

## 2. How a "spawn many chats/workflows in parallel" scenario actually plays out

Walk through what happens if an operator fires off, say, 15 chat messages and starts 5 workflow runs (each with 3 parallel-ready stages) within the same few seconds, on a single `node apps/server/dist/index.js` process (the documented, "recommended" deployment — `operations.md §5`):

1. **Every** `POST /api/chats/:id/messages` and every stage launch ends up calling `harness.createConversation()` / `sendPrompt()` through the *same* `IAgentHarness` instance (`packages/core/src/domain/ports/IAgentHarness.ts`), wrapped in one `HarnessProxy`.
   - If `HARNESS_TYPE=claude-agent`: **each** of those ~20 calls independently invokes the SDK's `claudeQuery()`, which spawns a **brand-new `claude` CLI OS process** per call (`ClaudeAgentProvider.ts:893` for the interactive path, `:1574` for the stage path — see `docs/packages.md §agent-harness-providers`: *"stateless per-query subprocess"*). Twenty concurrent turns ⇒ up to twenty concurrent `claude` subprocesses spinning up simultaneously, each re-paying the ~12s cold start and re-sending the full system prompt + conversation history (no session resumption for this provider: `resumeConversation` is a documented no-op).
   - If `HARNESS_TYPE=copilot`: all ~20 calls multiplex over **one** persistent `CopilotSession`/stdio connection (`RuntimeConnection.forStdio`). No process explosion, but every request now shares one pipe — see Finding F6.
2. Each of the 5 workflow runs registers its **own** `setInterval` (3000ms) in `WorkflowRunService.pollingIntervals` (`WorkflowRunService.ts:786-820`). Every tick does a synchronous `runRepo.getById` + `stageRunRepo.getByRunId` (fetches *every* stage row for that run) against the one shared SQLite connection.
3. Every **stage** that becomes "ready" must first acquire a permit from the **one process-wide** `Semaphore(8)` (`Semaphore.ts`, wired at `createCoreServices.ts:404`) before it's allowed to call the harness at all — regardless of which of the 5 runs it belongs to. With 3 ready stages × 5 runs = 15 stages contending for 8 slots, the semaphore's FIFO queue interleaves runs with **no per-run fairness or priority**: one run's stages can occupy most of the 8 slots for the duration of their harness call (which, for `claude-agent`, includes that ~12s cold start, and — per F12 — the *entire retry backoff window* if the stage fails), starving the other four runs. **The 15 chat messages, however, never touch this semaphore at all — see F10.** `ChatManagementService.sendPrompt` calls the harness directly with no gate of any kind, so all 15 chat sends fire their harness calls immediately and unconditionally, in parallel with whatever the 15 semaphore-gated stages are doing.
4. Every token the harness streams back for *any* of these 20 in-flight generations goes through `EventBus.emit()` → persisted to the `events` table → bridged (`composition-root.ts`'s `eventBus.subscribeAll(bridgeEvent)`) into `StreamBroker.publish()` **once per applicable scope** (`session`, and `run`/`chat` if the event carries those ids). Each `publish` call is its own `sequence-allocate + INSERT` DB transaction (`StreamBroker.ts:90-99`, `StreamCursorRepository.ts:48-49`). With chat/stage events plausibly firing 10s–100s of tokens/sec in aggregate across 20 concurrent generations, this is the single largest number of synchronous DB writes in the whole request lifecycle, and every one of them is a **blocking call on the one Node.js event loop thread** — while any one of these synchronous `better-sqlite3` calls is executing, *nothing else in the process* can run: not another chat's token write, not the DAGScheduler poll tick, not an incoming HTTP request, not an SSE flush.
5. The shipped protection layer, `createRateLimitMiddleware` (`apps/server/src/middleware/rateLimit.ts`), only throttles the **rate of incoming HTTP requests** (60/min per key, 600/min globally). It does nothing once a request is admitted — it has no concept of "how many harness subprocesses / DB writes / open streams are already in flight," so a client well within its rate-limit budget can still be the one that pushes the process into the degraded state described above.

None of steps 1–5 individually crashes the server. Together, under concurrent load, they compound into: rising per-token latency (event-loop contention) → rising stage queue depth (semaphore starvation) → rising subprocess count / memory (claude-agent) → eventually `SQLITE_BUSY` timeouts (5000ms busy_timeout exhausted, §4 F1) or `slow_consumer_dropped` SSE disconnects (documented in `feature-streaming-events.md §12.2`) as symptoms, with no single log line pointing at the root cause.

---

## 3. Findings (ranked by severity / blast radius)

Severity here means: **how much does this finding limit or degrade concurrent chat/workflow throughput**, not general code quality.

### F1 — Single synchronous SQLite connection is the true concurrency ceiling for the whole process

**Evidence:**
```ts
// packages/db/src/index.ts:230-248
const sqlite = new Database(dbPath, { ... });
...
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -64000');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
```
One `Database` instance is created once in `createDB()` and shared by all 25+ Drizzle repositories for the lifetime of the process. `better-sqlite3` is **synchronous by design** — every `.get()/.run()/.all()` call blocks the calling JS thread until SQLite returns (this is explicitly flagged as an "important constraint" in the file's own header comment, `packages/db/src/index.ts:163`).

**Why it matters under concurrency:** Node.js has one event-loop thread. A synchronous SQLite call is not "slow" the way an unindexed query on Postgres is slow (where other connections/backends keep serving other clients) — it is **globally blocking**: for its duration, *no other request, timer, or socket write in the entire process makes progress*, chat or workflow, unrelated or not. WAL mode's real benefit (readers never block writers) is irrelevant here because there is only ever one connection issuing statements from one thread — WAL is protecting against a scenario (multiple *separate* connections) that this process doesn't create internally. The only place WAL's promise actually matters is the *cross-process* case (§F-CLI below).

**Comparison:** every workflow engine or chat-scaling architecture surveyed for this report (Temporal, LangGraph Platform, BullMQ) puts persistent state behind either an async, connection-pooled RDBMS (Postgres) or an external, non-blocking store (Redis), precisely so that one slow write never stalls unrelated work. LangGraph Platform's own scaling guidance is explicit: server pods are stateless and *all state lives in Postgres*, "which enables clean horizontal scaling" — the opposite of a single in-process synchronous file handle.

**Quantified impact:** every DB call in the hot path (every EventBus emit, every StreamBroker publish, every 3s poll tick, every stage-run status update) serializes against every other one, process-wide. The busy_timeout (5000ms) is the failure mode's ceiling: once queued synchronous work backs up past 5s (plausible with 20 concurrent generations each firing multiple writes per token), the *next* write throws `SQLITE_BUSY` rather than just being slow.

---

### F2 — Per-token, multi-scope event persistence amplifies every streamed token into up to ~7 synchronous DB writes

**Evidence:** `EventBus.emit()` (`packages/core/src/events/EventBus.ts:84-102, 115-188`) persists **every** `AgentEvent` — including per-token `harness.token` deltas, which are *not* in the `NOISE_KINDS` exclusion set (`StreamBroker.ts:72`, which only excludes `harness.session_info` / `harness.unknown`) — to the `events` table, via a per-session promise queue that still executes each insert as its own synchronous transaction. The composition-root bridge then republishes that same event into `StreamBroker.publish()` **separately for each scope the event data carries** — `session` always, plus `run` and/or `chat` when `data.workflowRunId` / `data.chatId` are present (`architecture.md §5`, confirmed in code by the bridge's three `streamBroker.publish(...)` calls). Each `publish` call does its own sequence-allocate-then-insert against `stream_cursors` (`StreamBroker.ts:90-99`; `StreamCursorRepository.ts:48-49` calls it "one synchronous transaction" per append).

**Why it matters:** for a stage-run event carrying both `workflowRunId` and `chatId`, one streamed token becomes: 1 insert into `events` (EventBus) + 3× (sequence-allocate + insert into `stream_cursors`) for session/run/chat scopes = **up to 7 synchronous SQLite statements for a single token**. LLM streaming responses are commonly hundreds to low-thousands of token-deltas; at even a conservative 20 tokens/sec aggregate across a handful of concurrent generations, this is easily 100+ synchronous DB statements/sec competing for the one connection described in F1.

**Mitigating factor already in place:** the `NOISE_KINDS` filter (`StreamBroker.ts:66-73`) shows the team is already aware of and actively fighting this class of problem — its own comment cites a real incident: *"98% of one orchestrator turn's 19k events and ~1M rows of `stream_cursors`."* That fix covers two specific raw-SDK-passthrough kinds; it does not cover `harness.token`/`harness.reasoning_delta`, which are the actual bulk of a normal response.

---

### F3 — One global `Semaphore(8)` gates every stage in every workflow run, process-wide, with no per-run fairness

**Evidence:**
```ts
// packages/core/src/bootstrap/createCoreServices.ts:404
const stageSemaphore = new Semaphore(config.maxConcurrentStages ?? 8);
```
`Semaphore` (`packages/core/src/utils/Semaphore.ts`) is a plain FIFO async limiter with no notion of "owner" — its own header comment states the intent plainly: *"bound how many stages execute ... at once. A self-hosted instance on a small VPS must not fan out 100 ready stages into 100 concurrent CLI subprocesses."* That's a correct instinct for the single-run case; the same object is shared across `WorkflowRunService.launchStage` for **every run the process is executing**.

**Why it matters:** the semaphore has one FIFO queue and one counter, with no per-`workflowRunId` bucketing. Run A launching 8 stages that each hold their harness call for the `claude-agent` provider's ~12s cold start (F5) will occupy **all 8 permits** for that duration; Runs B, C, D, E launched in parallel get zero throughput until Run A's stages start finishing. There's no starvation protection, no priority, and no per-run minimum-guarantee — "many workflows in parallel" degrades to "one workflow finishes, then the next largely starts," not true fan-out.

**Comparison:** Temporal's task-queue model explicitly supports *multiple* task queues so that "CPU-intensive" and "I/O-bound" work — or, by extension, different tenants/runs — can be isolated with independent concurrency limits and independent worker pools, rather than one shared counter. The equivalent here would be a per-run (or per-priority-class) semaphore, or at minimum weighted-fair-queueing inside the single semaphore's waiter list.

---

### F4 — One `setInterval(3000ms)` polling loop per active workflow run; O(active runs) synchronous DB load, independent of the semaphore

**Evidence:**
```ts
// packages/core/src/services/WorkflowRunService.ts:786-820
private startPolling(runId: string, workflowDefinitionId: string): void {
  ...
  const interval = setInterval(async () => {
    if (this.pollInFlight.has(runId)) return;   // non-reentrant per run, but NOT cross-run
    ...
    const run = await this.runRepo.getById(runId);
    ...
    const stageRuns = await this.stageRunRepo.getByRunId(runId);   // fetches ALL stage rows for this run
    for (const sr of stageRuns) { ... }
  }, 3000);
  this.pollingIntervals.set(runId, interval);
}
```
This is *in addition to* the event-driven `onStageCompleted` path — it exists as a correctness backstop (per its own comment, to catch completions the event path might miss), but it runs unconditionally for every `running` workflow run for the run's entire lifetime.

**Why it matters:** with N concurrently active runs, the process carries N independent timers, each firing every 3s and each doing at least 2 synchronous DB round-trips (one of which — `getByRunId` — scales with the run's total stage count, not just the ready ones). These timers are **not staggered or jittered against each other** — because `setInterval` scheduling in Node is wall-clock-relative to when each run started, ticks from different runs will drift into and out of phase with each other over time, meaning the process periodically experiences small bursts of N simultaneous synchronous DB polls landing back-to-back, each blocking F1's single connection in turn. This is pure overhead layered on top of F1/F2 that scales *linearly with the number of concurrently active runs* — exactly the axis the user is asking about.

**Comparison:** this is the "polling as a correctness backstop" anti-pattern that durable-execution engines (Temporal) solve by having the *server* push completed-task notifications to a shared long-poll/task-queue rather than every worker independently polling every workflow's row on a fixed timer.

---

### F5 — `claude-agent` provider spawns a fresh OS subprocess per prompt turn — ~12s cold start, per Anthropic's own SDK issue tracker, with zero pooling or reuse

**Evidence:** `ClaudeAgentProvider.ts:893` and `:1574` both call `claudeQuery({ prompt, options })` — the SDK's documented behavior (and this repo's own `docs/packages.md`: *"Stateless per-query subprocess... Each `sendPrompt()` invokes `claudeQuery(...)` which spawns a fresh `claude` Code CLI subprocess"*). `resumeConversation` for this provider is a **no-op** (packages.md provider comparison table) — there is no persistent session to resume; conversation history is re-sent from an in-memory `Map<conversationId, ConversationMessage[]>` on every single turn.

**External corroboration:** Anthropic's own `claude-agent-sdk-typescript` issue tracker (anthropics/claude-agent-sdk-typescript#34, "[PERFORMANCE] Claude Agent SDK `query()` has ~12s overhead per call — No hot process reuse") documents this exact mechanism as a known, unaddressed-upstream cost: every `query()` call pays ~12s of pure process-spawn/init overhead (down from ~40s in the predecessor SDK) before any model work begins, and per-subprocess system-prompt/tool-description reload can add tens of thousands of tokens per turn on top of that.

**Why it matters for parallel workloads:** this is a **per-request** tax, not a one-time startup cost — it recurs on *every single turn* of *every single chat or stage* using this provider, and it multiplies with concurrency: 10 concurrent turns ⇒ 10 concurrent fresh Node/CLI process boots competing for host CPU/memory, on top of whatever the model call itself costs. This is likely the single largest **latency** contributor for `claude-agent`-backed concurrent workloads, and it compounds directly with F3 (each of those 12-second-plus calls occupies a semaphore permit the whole time).

---

### F6 — `copilot` provider funnels every concurrent session through one persistent CLI subprocess over one stdio pipe

**Evidence:** `docs/packages.md §agent-harness-providers`: *"Single client process; N persistent sessions multiplexed over its stdio channel"* via `RuntimeConnection.forStdio({ path })` (`CopilotProvider.ts`). This avoids F5's per-turn process-spawn tax, but introduces the opposite risk: **one OS process and one stdio pipe is the entire harness for the whole server.** If that one process stalls, deadlocks, hits an internal concurrency limit, or is restarted (`autoRestart` — "tracked manually" per `packages.md`, since SDK 1.0 removed the built-in option), **every concurrent chat and stage across every run using this provider** loses service simultaneously — there is no isolation between unrelated sessions sharing the pipe. The `docs/architecture.md §9` metric `copilot.listeners.high_water_mark` / `ORC-05`'s "warns at >50 listeners" ceiling is itself evidence that the team has already observed listener-count pressure building up on this single shared object under load.

**Why it matters:** this is the opposite failure mode from F5 — instead of unbounded resource fan-out, it's a **single point of serialization and a single point of failure** for the entire harness layer. Neither provider offers a middle ground (e.g., a small pool of N warm, reusable, isolated subprocesses) that would give both throughput *and* isolation.

---

### F7 — No horizontal scaling path; in-memory state is inherently per-process (project's own docs already say so)

**Evidence:** `operations.md §5 "Multi-process (horizontal scaling)"` states plainly: *"DB locking: ... Multi-process write is possible but contentious; prefer a single owner per DB. Harness: each process spawns its own Copilot/Claude CLI subprocess. Coordinate by sharding sessions to a single process (sticky sessions in your LB). StreamBroker: in-memory subscribers are per-process. Cross-process SSE fan-out requires an external broker (not shipped)."* This is corroborated by code: `EventBus.emitQueues`/`StreamBroker.subscribers` are plain in-process `Map`/`Set` objects (`EventBus.ts:46`, `StreamBroker.ts:76`) with no cross-process transport; `apps/server/src/index.ts` starts one Express app with no `cluster.fork()` or `worker_threads` usage.

**Why it matters:** "spawn multiple chats/workflows in parallel" has a hard ceiling at **one process's worth of CPU cores, one process's worth of RAM, and one SQLite writer** — there is no way today to add a second server instance to add throughput without breaking SSE delivery (a client connected to instance A never sees events published by instance B) and without introducing write contention on the shared SQLite file (F1, and see the CLI multi-process note below). This is not a latent bug so much as an explicitly-acknowledged, unaddressed gap — which is exactly why it belongs in a prioritized fix list rather than a "go read the docs" pointer.

---

### F8 — The shipped rate limiter throttles request *rate*, not concurrent *resource usage* — it does not protect against this report's failure modes

**Evidence:** `apps/server/src/middleware/rateLimit.ts:71-153` implements fixed-window counters (60 req/min per API key, 600/min global) purely on **HTTP request admission**. Its own header comment is explicit about scope: a "DoS-prevention layer," in-memory, per-replica. It has no concept of "how many workflow runs are currently `running`," "how many harness subprocesses are alive," or "how deep the stage semaphore's wait queue is."

**Why it matters:** a legitimate, well-behaved client — one chat message a minute, five workflow starts spread over an hour — can still be the request that tips the process into the degraded state from §2, because nothing in the admission path asks "do we have capacity for this *right now*," only "has this key made too many *requests* recently." The two problems (request flooding vs. resource exhaustion under legitimate concurrent load) are orthogonal, and only the first is covered.

---

### F9 — Concentration of logic into very large services raises the cost of finding/fixing the above under load

**Evidence (line counts, `packages/core/src/services/*.ts`):**

| Service | Lines | Owns (relevant to this review) |
|---|---|---|
| `StageExecutionService.ts` | 2762 | Per-stage harness call, retries, validation, artifact extraction — the code path gated by F3/F5 |
| `ChatManagementService.ts` | 2260 | Chat send-prompt hot path — the code path gated by F5/F6 |
| `WorkflowRunService.ts` | 1651 | Owns F4's polling loop and the DAG-advance logic that calls into F3's semaphore |
| `WorkflowOrchestrator.ts` | 1268 | Higher-level multi-run/system-template flows |
| `BrowserService.ts` | 1223 | Per-workspace Chromium session lifecycle (its own concurrency cap, `GENERATORAI_BROWSER_MAX_CONCURRENT`) |
| `AutomationService.ts` | 1192 | Cron/webhook fan-out into multiple workflow runs — a second, independent lever that can multiply load on F1/F3 |

This isn't a performance bug by itself, but it is a **risk multiplier**: a 2700-line service is where an accidental N+1 query, an accidental synchronous loop, or an accidental semaphore-permit leak is easiest to introduce and hardest to spot in review — precisely the kind of regression that would show up *only* under concurrent load, not in the single-run tests that exercise most of this code today.

---

### F10 — Chat `sendPrompt` has *no* concurrency gate at all — the global stage semaphore never applies to chats

**Evidence:** `WorkflowRunService.launchStage` wraps `executeStage(...)` in `this.stageSemaphore.run(...)` (`WorkflowRunService.ts:181`) — that is the *only* call site of the process-wide `Semaphore` anywhere in the codebase. `ChatManagementService.sendPrompt` (`ChatManagementService.ts:1665+`) calls straight into `harness.sendPrompt(...)` with no semaphore, no queue, no counter of any kind. `ClaudeAgentProvider.sendPrompt`/`sendPromptAndWait` (`ClaudeAgentProvider.ts:768→805`, `811→893`, `1564→1574`) call `claudeQuery()` unconditionally — a grep for `Semaphore|maxConcurrent|queue` across the provider returns nothing.

**Why this is the most severe finding in the review:** it is the exact scenario named in the request — "spawn multiple chat agents ... in parallel." Twenty concurrent chat sends on `HARNESS_TYPE=claude-agent` is twenty simultaneous, fully unthrottled `claude` CLI process spawns, each independently paying the ~12s cold start (F5) and each consuming its own memory/CPU, with literally nothing in the request path admitting or queuing them. The 8-permit semaphore that this report initially treated as "the" concurrency gate for the system in fact only governs **workflow stages** — chats run completely outside that safety net. Combined with F8 (the rate limiter caps request *count*, not concurrency), a burst of chat activity within the 60/min-per-key budget can still spawn dozens of concurrent subprocesses with no backpressure whatsoever.

---

### F11 — `ChatManagementService.sendPrompt` does 6+ sequential synchronous DB round-trips before the harness is even called, on top of unbounded in-process maps

**Evidence:** the hot path (`ChatManagementService.ts:1665-1817`) awaits, in sequence: `chatRepo.getById` (1671) → optionally `agentInteractionService.listPendingByChat` (1684) → `sessionRepo.getById` (1698) → optionally `workspaceCheckpointService.capture` (1784-1794) → `messageRepo.create` (1797-1805) → `eventBus.emit('harness.turn_start')` (1810-1813) → `eventBus.emit('harness.user_message')` (1814-1817) — each `eventBus.emit` itself triggering the F2 multi-scope persistence cascade. That's on the order of 6+ synchronous SQLite transactions *before* a single token streams back. The service also holds four unbounded, process-lifetime `Map`s keyed by chat/session/conversation id: `activeSubscriptions` (156), `turnContexts` (165), `turnFinalizers` (171), `conversationBindings` (831).

**Why it matters:** this multiplies F1's single-connection contention by a constant factor on *every* chat message, independent of streaming volume — a burst of N concurrent chat sends means N × 6 sequential blocking DB calls all contending for the one connection before any of them even reach the harness.

---

### F12 — A retrying stage holds its global semaphore permit through the entire backoff sleep and re-execution, silently shrinking the effective pool below 8

**Evidence:** `Semaphore.run()` (`Semaphore.ts:56-63`) holds the permit until the wrapped promise fully settles. `WorkflowRunService.launchStage` wraps the *entire* `executeStage(...)` call in one `stageSemaphore.run(...)` (`WorkflowRunService.ts:181`). Inside `executeStage`, a retryable failure calls `retryStage(...)` **in the same call stack** (`StageExecutionService.ts:1971`), which `await`s the backoff delay (`StageExecutionService.ts:2546`, default `backoffMs × multiplier^retryCount`) and then **recursively calls `executeStage` again** (`StageExecutionService.ts:2563`) — all still nested inside the original semaphore acquisition, never released and reacquired.

**Why it matters:** this is worse than F3 as originally stated — it's not just "one run can occupy all 8 permits while its stages run," it's "one *failing and retrying* stage occupies a permit for its execution time **plus every retry's backoff delay plus every retry's re-execution time**, compounding across retries." Under any real-world failure rate (rate limits, transient harness errors, validation failures), the pool of 8 usable permits shrinks further than the raw count suggests, exactly when the system is already under stress.

---

### F13 — `AutomationService.maxConcurrency` has no upper clamp, but every fan-out still bottoms out on the same global 8-permit pool as everything else

**Evidence:** `params.maxConcurrency ?? 1` (`AutomationService.ts:161`) is only floor-clamped — `Math.max(1, automation.maxConcurrency)` (line 660) — with no ceiling. An operator can configure one automation to fan out to, say, 50 concurrent workflow-run iterations (`Promise.allSettled` batches of size `maxConcurrency`, lines 664-726). Every one of those runs' stages still funnels through the *same* `stageSemaphore(8)` as manual workflow runs and every other automation running concurrently — there is no per-automation, per-project, or per-tenant sub-allocation.

**Why it matters:** this is a second, independent lever (beyond "many manual chats/runs") that draws on the identical scarce resource pool described in F3/F12, with no configuration-time warning that a large `maxConcurrency` won't actually produce proportional parallelism — it will produce queuing at the semaphore instead.

---

### F14 — `SessionAllocator`'s `auto` mode doesn't do what its own comment says, causing more session/subprocess churn than intended

**Evidence:** the inline comment (`SessionAllocator.ts:139-140`) claims `auto` mode reuses a shared session for sequential stages and allocates new sessions only for parallel ones — but the code unconditionally calls `allocatePerStageMode(...)` (line 141) regardless. `auto` currently behaves identically to `per-stage`: a brand-new session (and, for `claude-agent`, a brand-new subprocess per F5) for *every* stage, even ones that would run sequentially and could safely share one session.

**Why it matters:** any workflow relying on `sessionMode: 'auto'` for its "reuse sessions where safe" cost/latency benefit isn't getting it — every sequential stage still pays full session-allocation (and, on `claude-agent`, full ~12s subprocess-spawn) cost that the documented design intended to avoid. This directly inflates both F5's per-turn tax and general session churn under load, for a mode whose entire purpose was supposed to be reducing exactly that.

**Positive note, for contrast:** `SessionAllocator`'s per-run mutex (`serializePerRun`, lines 43-59) is correctly scoped — it serializes allocation *only* within one `workflowRunId`'s `Map` entry, so it is not a cross-run bottleneck. This part of the design is sound.

---

### F15 — CLI `--local` mode and any other multi-process access to the same SQLite file has no `SQLITE_BUSY` retry logic — concurrent CLI invocations can throw

**Evidence:** `DirectPlatformClient` (`apps/cli/src/platform/DirectPlatformClient.ts:74-75`) opens its own fresh `createGeneratorAI({ database: dbPath, ... })` — its own independent `better-sqlite3` connection — per CLI process invocation, against the same on-disk file used by the server (default `~/.generatorai/data.db`). WAL + `busy_timeout=5000` is the only protection (`packages/db/src/index.ts:244-248`); a repo-wide grep for `SQLITE_BUSY`/`BUSY` in `packages/db/src` found no application-level catch-and-retry (only unrelated workflow/automation `retryPolicy` fields).

**Why it matters:** a shell script looping many concurrent `generatorai run start` invocations against the same DB file — or simply running CLI commands while the server is also writing — relies entirely on SQLite's own 5-second internal retry before throwing an uncaught `SqliteError: SQLITE_BUSY`. This is the cross-process instance of F1, and is presently unmitigated at the application layer. *(Static-analysis finding — not confirmed by a live concurrent-process test.)*

---

### F16 — No app-level lock on concurrent `git worktree add` against the same codebase (unverified either way)

**Evidence:** `WorktreeService.createWorktree`/`createRunWorktrees` (`WorktreeService.ts:34-133`) and `GitClient.createWorktree` (`GitClient.ts:386-408`) contain no mutex/semaphore keyed by codebase/clone path — confirmed absent by grep. Git operations themselves are correctly async (`SandboxedScriptRunner.run()` uses `child_process.spawn` wrapped in a promise, never `execSync` — `SandboxedScriptRunner.ts:92-120`), so this is **not** an event-loop-blocking issue, only a possible correctness/contention issue.

**Why it matters, and why it's flagged as unverified:** many concurrent runs/chats attached to the *same* project codebase will each independently call `git worktree add` with no app-level coordination. Git has its own internal locking around `.git/worktrees`, and whether that fully covers concurrent `add` operations under heavy fan-out was not established from static reading alone — this needs a live multi-process test against a real repo before being treated as a confirmed bug, but it's a plausible failure mode worth a targeted test given everything else in this report about uncoordinated concurrent access to shared resources.

---

### A confirmed *good* pattern worth calling out: the Docker sandbox already solves this exact class of problem

**Evidence:** `SandboxLifecycleManager` caps active sandboxes at `MAX_ACTIVE_SANDBOXES = 50` (line 41), serializes new-container creation through a bounded FIFO queue (`createQueue`, `MAX_CREATE_QUEUE_SIZE = 200`) with a minimum 500ms gap between creations (`MIN_CREATION_INTERVAL_MS`), and the code's own comment notes this **replaced an earlier implementation that blocked the event loop for ~50 seconds under 100 concurrent sandbox starts.**

**Why this matters for the recommendations below:** the team has already identified and fixed exactly this failure mode — unbounded fan-out spawning expensive OS-level resources with no admission control — in one subsystem (Docker sandboxes). The queue+cap+min-interval pattern used there (`SandboxLifecycleManager`) is a ready-made template that could be applied directly to F10 (chat subprocess spawning) and F3/F12 (stage semaphore), rather than needing to invent a new mechanism.

---

## 4. How modern agentic / workflow platforms solve the same problems

This section compares GeneratorAI's current mechanisms against how three categories of production systems handle "many concurrent long-running agent sessions," so the recommendations in §5 aren't invented in a vacuum.

| Concern | GeneratorAI today | Temporal | LangGraph Platform | Redis-queue pattern (BullMQ et al.) |
|---|---|---|---|---|
| **Where does execution state live?** | In-process `Map`s (`EventBus.emitQueues`, `StreamBroker.subscribers`, `WorkflowRunService.pollingIntervals`) + SQLite | 100% server-side event history; workers are stateless and *replay* to reconstruct state | 100% Postgres; server pods are stateless w.r.t. graph state | Job payload + state in Redis; workers are stateless |
| **How is "what's ready to run next" discovered?** | Per-run `setInterval` poll (F4) *and* event callbacks (belt-and-suspenders) | Workers long-poll a task queue; server pushes tasks, no polling per-workflow | Server-driven step dispatch | Workers block-pop from a queue; no per-job polling |
| **Concurrency control granularity** | One global `Semaphore(8)` for all stages, all runs (F3) | Per-task-queue concurrency limits — isolate CPU-heavy vs I/O-bound vs per-tenant work | Per-node/subgraph parallelism; Postgres connection pool sized as `max_pods × connections_per_pod` | Per-queue concurrency setting; "a slow LLM inference job [doesn't] hold up a fast data validation job" because they're different queues |
| **Horizontal scale-out** | Not implemented; explicitly documented as unsupported today (F7) | Add worker processes; they all pull from the same task queue, no code change | Add stateless server pods behind a load balancer; state is already externalized | Add worker processes/containers pointed at the same Redis |
| **Durable execution / crash recovery** | DB-swept resumable stages (already implemented per prior review — `StageRunRepository.claimForExecution`, `StartupRecoveryService`) — this part is *already* aligned with the pattern below | Full event-history replay reconstructs exact state after any crash | Checkpointed state in Postgres; resumes from last checkpoint | Job either completed or requeued; no partial-step replay by default |
| **Per-turn model-call cost model** | `claude-agent`: fresh subprocess per turn (F5, ~12s tax); `copilot`: one shared subprocess for everything (F6) | N/A (Temporal orchestrates calls to *any* backend, including a pooled LLM client) | N/A — LangGraph nodes call the model client directly; typical deployments use a persistent HTTP client/connection pool, not a subprocess-per-call | N/A |

**Read-through:** the durable-execution *state-recovery* half of GeneratorAI's design (DB as source of truth for resumability) is already the correct shape and matches what Temporal/LangGraph do. The gap is entirely on the **concurrency-control and horizontal-scale** half: a single global counting semaphore instead of per-run/per-tenant queues, a per-run polling timer instead of server-pushed readiness, and in-process pub/sub instead of an externalized event bus. Those are exactly the three primitives the comparison systems build around, and none of them requires abandoning SQLite or the self-hosted, single-tenant target — they're applicable at any scale (see §5).

Sources: [LangGraph Platform docs](https://docs.langchain.com/oss/python/langgraph/overview), [Scaling LangGraph Agents](https://aipractitioner.substack.com/p/scaling-langgraph-agents-parallelization), [Temporal Workflow Execution overview](https://docs.temporal.io/workflow-execution), [Temporal Worker Architecture and Scaling](https://levelup.gitconnected.com/temporal-worker-architecture-and-scaling-af0c670ce6c1), [BullMQ Architecture for High Traffic](https://markaicode.com/architecture/bullmq-high-traffic-scalability-architecture/), [Building Scalable LangChain Agents with a Message Queue](https://medium.com/@mahestpm/building-scalable-langchain-agents-with-a-message-queue-service-fb7c74ae1ee9).

### SQLite's own documented ceiling (why F1 isn't a config tweak away)

SQLite's WAL mode gives concurrent *readers* and one *writer* without blocking each other, but **writer/writer contention is not solved by WAL** — "although WAL mode allows concurrent reads and writes, SQLite still enforces a single-writer model, with only one transaction able to write to the database at any given instant," and a second writer gets `SQLITE_BUSY` immediately, mitigated only by `busy_timeout`'s retry window. This is industry-documented behavior, not a GeneratorAI-specific limitation — it's the reason every scale-out guide for SQLite converges on the same advice: "PostgreSQL should be considered if you need heavy concurrent writes." Combined with F1 (only one connection exists in-process anyway, so even the "readers don't block writers" benefit is unused today), this means GeneratorAI's current data layer is well inside SQLite's comfort zone for a *single* active session, and increasingly outside it as concurrent sessions rise — exactly the axis in question.

Sources: [SQLite Write-Ahead Logging docs](https://www.sqlite.org/wal.html), ["database is locked" errors explainer](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/), [SQLite in Production: WAL, Concurrency, VFS](https://micrologics.org/blog/sqlite-in-production-optimizing-wal-mode-concurrency-and-vfs-layers-for-low-latency-app-servers).

### Node.js's own documented guidance on this exact mistake

Node's own docs are explicit that the class of bug in F1/F2/F4 — synchronous, blocking calls on the hot path — is *the* canonical Node.js performance mistake: "avoid blocking the event loop at all costs... offload heavy computation" via async APIs or `worker_threads`, with the caveat that I/O-bound work (like DB calls) is generally better served by a genuinely async driver than by a worker thread (workers help CPU-bound work; for I/O, the fix is an async-capable client, which is exactly what libSQL/Postgres would provide over `better-sqlite3`).

Source: [Node.js — Don't Block the Event Loop](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop).

---

## 5. Prioritized improvements

Each item names the finding it resolves, why it's the right next step *for this codebase specifically* (not a generic best-practice), and a rough effort size. Ordered P0 → P2 by (impact on concurrent throughput) ÷ (implementation risk).

### P0 — do before increasing concurrent chat/workflow load further

**P0-0. Gate `ChatManagementService.sendPrompt` behind a concurrency limiter — today it has none.**
- **Resolves:** F10, the single most severe finding in this review — chat sends bypass every concurrency control in the system.
- **Change:** add a dedicated `Semaphore` (or a shared one with a reserved sub-allocation, mirroring P0-1's two-tier design) around the `harness.sendPrompt`/`sendPromptAndWait` call inside `ChatManagementService.sendPrompt`, sized independently from `maxConcurrentStages` (chats and stages have different latency/priority profiles and shouldn't necessarily share one pool).
- **Why this over alternatives, and why it's not a new pattern:** the codebase already contains the exact template needed — `SandboxLifecycleManager`'s queue + hard cap + minimum-interval design (confirmed in F-sandbox-good) was built to solve precisely this failure mode (unbounded fan-out spawning expensive OS resources) for Docker sandboxes, including a documented before/after ("replaced an implementation that blocked the event loop for ~50s under 100 concurrent starts"). Applying the same shape to chat sends is implementing a pattern the team has already designed, reviewed, and shipped once — not inventing a new one.
- **Effort:** small — this is the highest-impact-per-line-of-code item in the entire list.

**P0-1. Make the stage-launch semaphore per-run, nested inside the existing global cap.**
- **Resolves:** F3 (one workflow's stages can occupy all 8 global permits and starve every other concurrent run).
- **Change:** wrap `Semaphore(maxConcurrentStages)` with a second, smaller per-`workflowRunId` `Semaphore` (e.g., default 2–3), so `launchStage` acquires *both* the run-local permit and the global permit. A run can never hog more than its local cap even while the global cap has headroom; the global cap still exists as the hard host-resource ceiling `Semaphore.ts`'s own comment describes.
- **Why this over alternatives:** `Semaphore` is already a small, dependency-free, well-tested primitive (`packages/core/src/utils/Semaphore.ts`) — this is additive, not a rewrite, and it's the same two-tier pattern Temporal uses (per-queue limits nested under overall worker capacity). No new infra, no schema change.
- **Effort:** small (new field on `WorkflowRunService`, one extra `acquire`/`release` pair around the existing call site).

**P0-2. Migrate `packages/db` off synchronous `better-sqlite3` onto the already-scoped libSQL async driver.**
- **Resolves:** F1 at the root (the single-connection, single-thread-blocking bottleneck every other finding sits on top of).
- **Why this is *already* the planned path, not a new idea:** the DB-provider seam (`DatabaseConfig {driver: 'sqlite'|'libsql'|'postgres'}`, `resolveDatabaseConfig`) was built specifically for this in the June 2026 refactor, with the explicit rationale on record: *"Consider libSQL (async, Drizzle-supported) ... since `better-sqlite3` is synchronous and blocks an embedder's event loop."* This review supplies the missing piece: a concrete, quantified mechanism (F1/F2/F4) showing *why* that migration matters for concurrent chat/workflow throughput specifically, not just "embedder ergonomics." It stays SQLite-file-compatible (no Postgres ops burden for self-hosters) while making every DB call in the hot path non-blocking.
- **Effort:** medium — swap the driver behind the existing seam, re-verify the SQLite-only SQL isolated to `ChatMessageRepository` (`packages/db/PORTABILITY.md`), re-run the full test + load suite (see P2-1).

**P0-3. Coalesce high-frequency streaming events before they hit the DB.**
- **Resolves:** F2 (up to ~7 synchronous writes per streamed token).
- **Change:** buffer `harness.token`/`harness.reasoning_delta` in `EventBus`/the composition-root bridge and flush on a short timer (e.g., every 150–250ms) or every K deltas, persisting one coalesced event per scope per flush instead of one per raw delta; flush immediately on `message_complete`/`turn_end`/session close so no content is lost, only its persistence *cadence* changes. SSE clients already batch on the receiving end (`sseManager`'s "100ms flush timer batches token deliveries" — `feature-streaming-events.md §6`), so this brings the *write* side in line with a pattern the *read* side already uses.
- **Why this over alternatives:** the `NOISE_KINDS` filter (`StreamBroker.ts:66-73`) already establishes the precedent that not every raw event needs a durable row, and that the team is willing to trade a small window of at-most-a-flush-interval event loss for a large reduction in write volume — this is the same trade, applied to the actual bulk of traffic (token deltas) rather than just SDK-internal noise.
- **Effort:** medium — needs care to preserve ordering/sequencing guarantees (§ "critical invariant #2" in `AGENTS.md`) across the coalescing boundary.

**P0-4. Add resource-aware admission control alongside the existing rate limiter.**
- **Resolves:** F8 (rate limiting protects against request floods, not against legitimate concurrent load exhausting real capacity).
- **Change:** before accepting a new chat-send or workflow-run-start request, check current in-flight counts (active harness calls, semaphore queue depth) against a configured ceiling; reject with `429` + `Retry-After` (reusing the exact response shape `rateLimit.ts` and the SSE-cap mechanism (`acquireSseSlot`) already use) rather than accepting the request and letting it degrade the whole process.
- **Why this over alternatives:** it's the same shape of solution (fixed-window/counter + 429) the codebase already ships twice (`rateLimit.ts`, `acquireSseSlot`) — this is closing a *third* instance of the same gap with a pattern the team has already chosen and reviewed, not introducing a new concept.
- **Effort:** small–medium.

### P1 — do once P0 lands, before pushing concurrency further

**P1-1. Reduce and desynchronize the per-run polling loop (F4).**
- Drop the tick interval materially (e.g., 3s → 20–30s) since it is a documented correctness *backstop* to the event-driven `onStageCompleted` path, not the primary driver — or replace N per-run timers with one process-wide timer that scans all `running` runs in a single query per tick. Either change removes an O(active runs) source of synchronous DB load that scales on exactly the axis this review is about, for negligible loss (the event path still drives normal-case advancement immediately; only the backstop's reaction time changes).
- **Effort:** small.

**P1-2. Make the `claude-agent` per-turn subprocess cost visible and steerable, not silent (F5).**
- Since the ~12s/turn cost is SDK-owned (Anthropic's `claude-agent-sdk-typescript` issue #34), the actionable move here is operational, not architectural: surface expected per-turn latency and subprocess-count-under-concurrency in `operations.md`'s performance-tuning section and in the provider-switch UI, so an operator choosing `claude-agent` for a high-chat-concurrency deployment is making an informed trade-off rather than discovering it under load. Track the upstream issue for a hot-reuse mode and plan to adopt it once shipped.
- **Effort:** small (docs + a startup log line reporting active claude-agent subprocess count via the existing `claude_agent.active_sessions` OTel metric, which is already collected — `operations.md §8` — but not currently surfaced as an operator-facing warning threshold).

**P1-3. Ship an optional external event-fan-out bridge for the multi-process case (F7).**
- Exactly the gap `operations.md §5` already names ("Cross-process SSE fan-out requires an external broker (not shipped)"): add a pluggable `StreamBroker` transport (Redis pub/sub is the smallest addition, matching the pattern already surveyed in §4) behind a flag, so an operator who *does* need more than one process's worth of throughput has a supported path, while the default single-process/SQLite deployment stays dependency-free.
- **Effort:** medium.

**P1-4. Isolate the concurrency-critical ~200-300 LOC inside `StageExecutionService`/`ChatManagementService` for independent load testing (F9).**
- Not a full service decomposition — just extract the semaphore-acquire → harness-call → event-emit sequence into a named, directly-testable unit so P2-1's load tests can exercise it without spinning up the full 2700-line service.
- **Effort:** medium.

### P2 — longer horizon

**P2-1. Add a concurrency/load test suite as a CI gate.**
- Today's test suite (347+ core tests per the last recorded run) is correctness-focused on single-run/single-chat paths; nothing in the suite currently launches N concurrent chats + M concurrent workflow runs against a real SQLite file and asserts on latency/error-rate under that load. Add one such suite covering, at minimum: (a) N concurrent stage launches across M runs against the P0-1 per-run semaphore, (b) sustained token-streaming load to catch F1/F2 regressions, (c) a multi-process SQLite contention smoke test for the CLI `--local` case. This is the tripwire that keeps every fix above from silently regressing.
- **Effort:** medium, ongoing.

**P2-2. Keep the Postgres seam exercised, not urgent to activate.**
- Per the project's own stated rollout model (self-hosted, single-tenant by design — this is a *non-goal* to over-invest in), Postgres remains correctly deprioritized as "mechanism now, driver later." The only ask here is to keep `DatabaseConfig`'s `postgres` branch covered by a compile-time/type-level test so it doesn't silently rot before it's needed.
- **Effort:** small.

---

## 6. Direct answer to "what happens if we spawn multiple chats or multiple workflows in parallel today"

- **Chats have no concurrency limit at all (F10).** Spawning many chats in parallel means spawning that many simultaneous, fully unthrottled harness calls — on `claude-agent`, that's that many simultaneous OS process spawns with no admission control anywhere between the HTTP route and the subprocess. This is the single biggest risk for the exact scenario asked about.
- **Up to ~8 concurrently-executing workflow stages, total, no matter how many runs are active** (F3), and that pool shrinks further, transiently, whenever a stage is retrying (F12) — additional runs/stages queue behind whichever ones already hold permits, with no fairness, and automations with a high `maxConcurrency` (F13) draw from the exact same pool with no separate allocation.
- **Every DB-touching operation across every one of those chats/stages serializes onto one synchronous connection** (F1), and chat sends alone add 6+ sequential DB round-trips each before the harness is even called (F11) — latency for *everyone* rises together as concurrency rises; there's no isolation between an idle chat and a busy one.
- **Streaming token volume is the dominant source of that DB load** (F2) — the more chats/stages stream simultaneously, the more this specific mechanism bites, independent of the semaphore.
- **If running on `claude-agent`, concurrent turns become concurrent OS-process spins (~12s each)** (F5, and worse than intended for `sessionMode: 'auto'` workflows per F14's doc/behavior mismatch) — CPU/memory pressure and latency both scale directly with concurrent-turn count; if on `copilot`, concurrency is safe from that specific tax but shares one subprocess/pipe as a single point of contention (F6).
- **None of this can be relieved by adding a second server process today** (F7) — the ceiling described above is the ceiling for the deployment, full stop, until P1-3/P0-2 land. A second process would also introduce new risk: each CLI/server process opens its own SQLite connection to the same file with no app-level `SQLITE_BUSY` retry (F15).
- **The system will not crash outright under this load** — it degrades gracefully into queuing/latency first (semaphore FIFO for stages, DB busy_timeout retries, SSE backpressure/`slow_consumer_dropped`), which is a reasonable failure mode for the stage path, but chats (F10) skip queuing entirely and go straight to resource exhaustion (memory/CPU from concurrent subprocesses) with no backpressure signal at all. There is currently no operator-facing signal that ties any of these symptoms back to "you have more concurrent chats/runs than this single process is provisioned for" — that diagnosis currently requires reading this document.

---

## Appendix — evidence ledger

| Finding | Primary file:line |
|---|---|
| F1 | `packages/db/src/index.ts:163,230-248` |
| F2 | `packages/core/src/events/EventBus.ts:84-102,115-188`; `packages/core/src/services/StreamBroker.ts:66-99`; `packages/db/src/repositories/StreamCursorRepository.ts:48-49` |
| F3 | `packages/core/src/utils/Semaphore.ts`; `packages/core/src/bootstrap/createCoreServices.ts:404` |
| F4 | `packages/core/src/services/WorkflowRunService.ts:786-820` |
| F5 | `packages/agent-harness-providers/src/providers/claude-agent/ClaudeAgentProvider.ts:893,1574`; `.github/docs/packages.md §agent-harness-providers` |
| F6 | `.github/docs/packages.md §agent-harness-providers`; `.github/docs/architecture.md §9` (`copilot.listeners.high_water_mark`) |
| F7 | `.github/docs/operations.md §5`; `packages/core/src/events/EventBus.ts:46`; `packages/core/src/services/StreamBroker.ts:76` |
| F8 | `apps/server/src/middleware/rateLimit.ts:71-153` |
| F9 | Line counts via direct file read, `packages/core/src/services/*.ts` |
| F10 | `packages/core/src/services/WorkflowRunService.ts:181`; `packages/core/src/services/ChatManagementService.ts:1665+`; `packages/agent-harness-providers/src/providers/claude-agent/ClaudeAgentProvider.ts:768,811,1564` |
| F11 | `packages/core/src/services/ChatManagementService.ts:156,165,171,831,1665-1817` |
| F12 | `packages/core/src/utils/Semaphore.ts:56-63`; `packages/core/src/services/WorkflowRunService.ts:181`; `packages/core/src/services/StageExecutionService.ts:1971,2546,2563` |
| F13 | `packages/core/src/services/AutomationService.ts:161,660,664-726` |
| F14 | `packages/core/src/services/SessionAllocator.ts:139-141` |
| F15 | `apps/cli/src/platform/DirectPlatformClient.ts:74-75`; `packages/db/src/index.ts:244-248` |
| F16 | `packages/core/src/services/WorktreeService.ts:34-133`; `packages/core/src/infrastructure/GitManager.ts` / `GitClient.ts:386-408` |
| F-sandbox-good | `packages/core/src/services/SandboxLifecycleManager.ts:41-43,68-72` |

All F10–F16 evidence gathered via a second, independent read-only code-verification pass (`Explore` agent) against the same `dev` branch; F14/F16 note explicitly where behavior could not be fully confirmed from static reading alone and would benefit from a targeted runtime test before being treated as fully closed findings.

