# GeneratorAI — Harness Research & Revised Architecture

> **Companion to** [docs/ARCHITECTURE_PERFORMANCE_REVIEW.md](ARCHITECTURE_PERFORMANCE_REVIEW.md). That document audited *our* code. This one audits **five external systems** and converts them into concrete changes — including several places where it **reverses or materially sharpens** the recommendations in the first review.
> **Date:** 2026-08-17 · **Status:** review document, no code written.
> **Sources audited (full source read, not docs):**
> `referenceProjects/pi` (Pi / `pi-mono` v0.84.2) · `referenceProjects/KiroCrew` · `vscode` @ `dd766a81` · `referenceProjects/OpenMausBot` v0.1.22 · plus live primary-source web research on Hermes Agent, OpenHands, Anthropic Computer Use, Playwright/Chrome-DevTools MCP, Stagehand, E2B/Modal, Temporal/Restate/Inngest/LangGraph, ACP/A2A/AG-UI, xterm.js flow control, WebCodecs, Selkies/Neko, Node.js concurrency.

---

## 0. The five sentences that matter

1. **Every system examined persists at *message/item* granularity. Not one persists per token.** Pi writes one JSONL line per `message_end`. KiroCrew writes JSONL + a 5-second dirty flush. OpenMausBot writes a JSON file per thread. Hermes writes SQLite rows per message. Our 12.8 SQL statements per token is not a tuning problem, it is a category error.
2. **Backpressure does not require a credit protocol.** Pi gets end-to-end backpressure in ~15 lines: dispatch listeners *sequentially with `await`*, then register one no-op subscriber that awaits the slow sink's drain. The agent loop blocks itself. VS Code's ack-on-render credit loop is still correct for terminals — but we do not need to build one for chat.
3. **The answer to "one shared provider CLI process" is not "spawn more" — it is *single-reader demux*.** KiroCrew runs one `kiro-cli` and routes frames by `sessionId` into per-session queues, then recycles the process by age (6 h) and RSS (500 MB). That is a 300-line change, not an architecture rewrite.
4. **We should stop inventing our own agent protocol and speak ACP.** Zed, VS Code and JetBrains are ACP *clients*; Hermes ships `acp_adapter/`; OpenHands' Agent Canvas runs "any ACP-compatible agent." ACP already standardises streaming, cancellation-as-`cancelled`-stop-reason, client-owned permission UI, a **client-provided terminal capability**, `usage_update` with cost, and `messageId` stream segmentation. Every one of those is something we are currently hand-rolling badly.
5. **Computer use should not run in our server at all, and one UI step should be one round trip.** OpenMausBot's host process owns the CUA daemon and publishes a *connection descriptor*; the server never touches the action path. Its cloud proxy fuses `act + settle + capture + base64` into a single command and returns the frame **in the same tool result** — which, in their words, *"halves the model inferences per UI step."*

---

# PART I — Pi (`pi-mono`)

**What it is:** a 10-package TypeScript monorepo — `agent`, `ai`, `client`, `coding-agent`, `evals`, `protocol`, `server`, `session-backends/sqlite-node`, `telemetry`, `tui`. Strictly downward dependencies, enforced by build order.

**Three corrections to what we assumed:** there is no `packages/web-ui`; there is no PTY, browser, computer-use or MCP integration; and **the shipping agent has no in-process concurrency at all** — `Agent.prompt()` throws `"Agent is already processing a prompt"` ([`agent.ts:355`]). Concurrency is achieved by spawning more processes.

**What is actually valuable:** `packages/agent/docs/harness.md` is a **2,940-line, 229 KB normative specification** for a durable, multi-lane, crash-recoverable agent harness whose *storage substrate is fully implemented and conformance-tested* and whose *driver is deliberately stubbed*. It is the single most useful artifact in any of the five repos for us.

## I.1 The harness spec — four ideas we should adopt wholesale

**Three stores, one invariant** (`harness.md §0.3`):
> `entries` (write-once, append-only) · `registers` (namespaced typed cells, overwrite or delete) · `usage ledger` (append-only rows). *"Every payload is in an entry, a register, or the ledger; there is no third place."*

**Atomic transactions as the only write primitive:**
> *"There is no crash state inside a transaction. This is the only write primitive."*

**The durable program counter** — this replaces resume-by-log-scan with resume-by-switch-statement:
> *"After every step the harness overwrites `op.state/{operationId}` with the **complete** current state. Recovery does not replay a journal or infer position from what is missing; it reads that register and switches on it. The state is total — it never depends on a previous state."*

**The effect sandwich:**
```
commit:  "about to do X; its output will use ids R and U"   ← intent (ids RESERVED here)
         do X                                                ← the uncertain part
commit:  output + usage + next state                         ← settlement
```
with a **per-tool replay policy** in the type itself: `HarnessTool = AgentTool & { replay?: "never" | "safe" }` ([`agent-harness.ts:216`]). On restart, a call left at `effect_pending` with `replay: "never"` gets a **synthetic error result written under the id reserved in the intent** — the conversation stays coherent, every tool call has a result, nothing ran twice. `replay: "safe"` re-executes with the persisted arguments.

For us: terminal commands, computer-use actions, file writes and git operations are `never`. Reads, greps, searches, `list_windows` are `safe`.

**Lanes** (`harness.md §2.3`) — the concurrency model we need:
> *"A lane owns its leaf, model configuration, queues, and at most one operation. Additional lanes support Slack threads, subagents, and other parallel work over shared history."*
> *"Creating a lane copies no tree content, no history, and no configuration from its anchor. Two lanes at the same leaf simply diverge on their next append."*

A lane is exactly three registers: `lane.leaf/{name}`, `lane.config/{name}` (**total** — *"a setter overwrites the whole register; it is never a patch"*), `lane.state/{name}`. N concurrent runs over one session cost three registers each and **zero history duplication**.

**Rejection is a typed value, not an exception** ([`agent-harness.ts:30`]):
```ts
export class LaneBusy extends TaggedError("LaneBusy")<{
  lane: string; operationId: string;
  operationKind: "run" | "compaction" | "navigation"; message: string }> {}
export type RunResult = Result<{ runId: string } & RunOutcome,
  LaneBusy | InvalidMessage | UnknownSkill | Closed>;
```
Callers cannot forget to handle "busy"; the UI renders a specific message instead of a spinner that never resolves.

**The append-only context invariant** (`§2.5`) — the rule that will save us the most money:
> *"Across the requests of one lane, provider context must only grow at the tail. An insertion before the previous request's tail invalidates the provider's KV cache and multiplies cost. This is why mid-run writes defer to checkpoints, where they append at the tail. Compaction is the one deliberate cache invalidation."*

Every hook that injects context, every workflow stage that prepends a system note, every variable substitution that lands before the tail is silently multiplying our provider bill.

## I.2 Backpressure in fifteen lines

`Agent.processEvents` ([`agent.ts:588`]) dispatches **sequentially and awaited**:
```ts
for (const listener of this.listeners) { await listener(event, signal); }
```
Then [`output-guard.ts:92`] + [`rpc-mode.ts:361`]:
```ts
session.subscribe((event) => { output(toJsonEvent(event)); });
session.agent.subscribe(async () => { await waitForRawStdoutBackpressure(); });
```
```ts
export async function waitForRawStdoutBackpressure(): Promise<void> {
  while (true) { const tail = rawStdoutWriteTail; await tail; if (tail === rawStdoutWriteTail) return; }
}
```
A slow consumer grows the write queue → the awaited no-op subscriber blocks → the agent loop's `await emit(...)` blocks → **token consumption from the provider stops.** Zero credit protocol. The fixpoint loop correctly handles writes enqueued *while* draining.

**This directly replaces the dead `drainWaiters` code in [apps/server/src/routes/stream.ts](../apps/server/src/routes/stream.ts) (finding P0-7).**

## I.3 Snapshots in-process, deltas on the wire

`streamAssistantResponse` emits `message_update` carrying **both** the incremental event *and* a full `{...partialMessage}` snapshot — O(n²) bytes over a turn. The fix is at the serialization boundary only ([`modes/json-event.ts:30`]):
```ts
/** message_start provides the initial message, deltas build it, and message_end
 *  provides the final authoritative message. Cumulative usage remains available
 *  because its size is constant. */
const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
return { type: "message_update", usage: event.message.usage, assistantMessageEvent: deltaEvent };
```
In-process listeners keep the free snapshot; anything crossing IPC/WS/SSE gets deltas only. Note `usage` is deliberately exempted.

## I.4 Persistence: lazy materialization + torn-tail repair

**Granularity: one JSONL line per `message_end`** ([`agent-session.ts:638-660`]). Not per token, not per delta.

**Nothing hits disk until the first assistant message** ([`session-manager.ts:981`]) — a session opened and abandoned leaves no file; then the whole buffered prefix is written in one `openSync(file, "wx")` + N writes.

**Torn-tail repair with a precise discrimination** ([`jsonl/storage.ts:84-95`]): a syntax error **on the last line only** is an unacknowledged partial append → rewrite the valid prefix via `tmp` + `rename`. A syntax error anywhere else is `invalidFile(path, line, error)` — fatal, never repaired. Plus `if (!content.endsWith("\n")) appendFile(path, "\n")`.

**Corruption is a closed enum, not a string** ([`reducer.ts:15-32`]): `multiple_open_operations | unknown_operation | record_after_finish | non_consecutive_attempt | … | invalid_deferred_handle`, with:
> *"These indicate states the single-writer record protocol cannot produce… Restore must **reject** such states rather than repair or continue."*

**Fenced writer lease** for shared SQLite ([`writer-leases.ts`]):
```sql
INSERT INTO writer_leases (session_id, owner_id, fence, expires_at_ms) VALUES (...)
ON CONFLICT(session_id) DO UPDATE SET owner_id=excluded.owner_id, fence=writer_leases.fence+1, ...
WHERE writer_leases.expires_at_ms <= ?   -- only steal an EXPIRED lease
RETURNING owner_id, fence, expires_at_ms
```
Renewal asserts `changes === 1`; heartbeat is `unref()`'d. ~50 lines that make "two writers corrupted my session" structurally impossible — relevant because our Electron main, CLI and mobile relay can all touch one DB.

## I.5 Five more Pi mechanisms worth taking

| Mechanism | File | Fixes |
|---|---|---|
| **Per-key mutex map that deletes its own tail entry** — `finally { releaseNext(); if (state.queues.get(key) === chained) state.queues.delete(key); }`, rooted in a `WeakMap<Owner, State>` | `harness/tools/file-mutation-queue.ts` | Our unbounded maps (P1-37), in three lines |
| **Promise-tail serialization**, four independent uses, with `.then(noop, noop)` on the tail so a rejection reaches its caller but never poisons the queue | `jsonl/storage.ts:258`, `output-guard.ts:11`, `snapshots.ts:23`, `shell-output.ts:66` | Our `withTransaction` global mutex (P1-5) |
| **Fail *every* tool call when `stopReason === "length"`** — *"a truncated message can yield tool calls whose arguments parse and validate but are silently incomplete"* | `agent-loop.ts:186-190, 373` | A live correctness bug we almost certainly have |
| **Late-`onUpdate` guard**: `acceptingUpdates` flag + `await Promise.all(updateEvents)` in **both** success and catch paths | `agent-loop.ts:664-712` (+ regression test `5208-late-bash-output`) | Stuck spinners / resurrected tool cards |
| **Lazy provider modules behind a synchronously-returned stream** — `lazyStream()` returns immediately; a failed import or auth arrives as an in-band `{type:"error"}` event | `ai/src/api/lazy.ts` + 12 `*.lazy.ts` shims | Booting both Copilot and Claude adapters at startup |

Plus the **two-limit truncation record** (`DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`, 12-field `TruncationResult`, **tail** for bash / **head** for read, overflow spilled to a temp file whose path is given *to the model*), and **`ExecutionEnv`** — every fs/process operation behind one injected interface returning `Result<T,E>`, never throwing. That last one is the seam that would let the same harness code run local, sandboxed, or remote.

## I.6 The TUI (relevant to our Ink TUI's 200 reconciles/sec)

`MIN_RENDER_INTERVAL_MS = 16` with **two distinct paths** ([`tui.ts:772-822`]):
- Data → throttled `setTimeout(delay)` where `delay = max(0, 16 - elapsed)`, re-armed if a render was requested mid-render.
- **Input → `requestImmediateRender()` on `process.nextTick`, which explicitly `cancelRenderTimer()`s the pending throttled frame.**
> *"Keyboard input is latency-sensitive. Avoid the throttled timer path, where even `setTimeout(0)` can take a full 16 ms tick on Windows."*

Diff is line-granular whole-string comparison producing **one contiguous dirty range**, emitted inside DEC 2026 synchronized output (`\x1b[?2026h` … `l`) so there is no tearing. Seven documented full-redraw escape hatches, each logged under `PI_DEBUG_REDRAW=1`.

**And the testing pattern that makes it stick** — `tui.fullRedraws` is a counter on the hot path, asserted in ~12 tests:
```ts
assert.strictEqual(tui.fullRedraws, redrawsAfterShrink, "Append should stay on the differential path");
```
Non-flaky, no timing, and it catches exactly the regression class we suffer from: *someone made the fast path stop being taken.*

## I.7 What Pi will not teach us

No in-process multi-session concurrency. No `maxParallelTools` cap (`Promise.all` over whatever the model emitted, [`agent-loop.ts:540`]). `EventStream` is unbounded. No PTY/browser/computer-use/MCP. Server broadcast is a sequential `await` loop, so one stuck client delays all others. **`AgentHarness` — the thing we most want — does not run.** We are transferring a specification and a storage substrate.

---

# PART II — KiroCrew

**What it is, and why it matters more than it looks:** KiroCrew is **not an agent runtime**. It is a *gateway that multiplexes surfaces onto one*. From `docs/architecture/overview.md:18-33`:

> *"**kiro-cli** is an agent runtime, not an agent… **Kiro Crew** is the gateway: a single asyncio process that multiplexes surfaces onto that runtime and adds everything a runtime deliberately has no opinion about."*

**That framing is the single most transferable decision in any of these repos.** Our "one shared provider CLI process" is *their baseline assumption*. They just built a proper multiplexer on top of it. Nine surfaces — CLI, web, Electron, Slack, Discord, Teams, Telegram, Webex, WeCom, Weixin — over one core.

## II.1 Single-reader demux — the fix for our P0-13

[`acp/runtime.py:1-12`]:
> *"Single-reader demux architecture: one `AcpRuntime` owns the subprocess and a reader task that routes frames by `sessionId` to per-session queues."*

One reader owns stdout; it routes by session id into per-session queues; each `AcpSessionHandle` owns exactly one queue and exposes prompt/cancel/approve/reject. On top: **process recycling by age and memory** ([`runtime.py:160-168`]) — `_DEFAULT_MAX_AGE_SECS = 6h`, `_DEFAULT_MAX_RSS_MB = 500`, with `_RSS_PROBE_MIN_AGE_SECS = 300` so the hot reuse path stays CPU-only for young runtimes.

**This is a materially different recommendation from our first review**, which proposed either accepting the single process with a priority lane or sharding into a pool. Demux + recycling is cheaper than both and solves the head-of-line problem at the frame router rather than at the pipe.

## II.2 Six thread pools, split by *blocking class*

`executors.py` is the highest-value single file in the repo.

| Pool | Size | Why separate |
|---|---|---|
| `maintenance_executor` | 4 | orphan/PID sweeps — **must stay responsive** |
| `subprocess_executor` | 8 | PTY `os.close`, `ps`/`pgrep`, `os.kill` — **can block on a wedged kernel resource** |
| `cron_executor` | 4 | user cron jobs, minutes long |
| `discovery_executor` | 4 | browser-triggerable `os.walk` |
| `embed_executor` | 8 | network calls that eat the full timeout |
| `governance_executor` | 4 | per-inbound-message governance — **rate driven by remote senders** |

The stated failure mode ([`executors.py:1-10`]):
> *"When long-running maintenance work… piles onto that default pool it can saturate it and starve the loop's own DNS resolution — which is exactly the failure mode that turns a brief network blip into a multi-second event-loop stall."*

And the anti-coupling rule, which is the part to internalise ([`:20-27`]):
> *"These can hang indefinitely, so they get their OWN pool: a storm of wedged teardowns can occupy every worker here WITHOUT starving the `maintenance_executor` orphan sweep that is the recovery action for the wedge (the bug the wedge fix would otherwise create by coupling the recovery mechanism to the same pool as the work that wedges)."*

**Rule: the pool that recovers from a wedge must never be the pool that wedges.**

They also name the endgame ([`:43-46`]): *"this blocking work should move into a dedicated supervised process (the VS Code extension-host model)… These bounded pools are the in-process containment until that process split lands."*

## II.3 Admission control that queues and publishes queue depth

[`dashboard/state.py:3211-3221`]:
```python
MAX_BACKGROUND_TURNS = 4          # default in-flight unattended turns
MAX_BACKGROUND_TURNS_CEIL = 16    # hard ceiling — config can raise up to here
_BACKGROUND_QUEUE_WAIT_SECS = 1800
```
The bug it fixes ([`:3204-3210`]): *"Nothing capped chat slots or concurrent turns… so an app that arms N worker slots could put N turns on the runtime at once and exhaust it."*

Four decisions worth copying verbatim:
1. **Queue, never reject** — *"a rejected crew turn loses the issue it was mid-way through, while a queued one only starts late."*
2. **`asyncio.wait_for(sema.acquire(), 1800)`** so the queue wait cannot consume the turn's own 7200 s ceiling and misattribute the failure.
3. **Log at INFO when queued** — *"this is the difference between 'the fleet is throttled' and 'a worker is hung'."*
4. **Publish `{cap, running, waiting}` in `/api/status`.**

**And the lane discriminator costs nothing:** `if not slot.unattended: return await coro` — human-watched turns bypass the cap entirely; unattended work queues. That single predicate is our interactive-vs-background priority lane.

Rejection *does* exist, per-resource, with a **fallback rather than a failure**: `PoolAtCapacity` → the stub runs the MCP backend unpooled; `BackendUnavailable` (breaker OPEN) → same; terminals → HTTP 429.

**Dynamic sizing from a learned cost store** ([`subagent.py:756`]):
```python
mem_term = floor((avail_gb * buf - pool_size * mem_cost) / mem_cost)
cpu_term = floor((cpu_count * buf) / cpu_cost)
result   = max(3, min(min(mem_term, cpu_term), hard_cap))   # hard_cap ≤ 64
```
Per-subagent `peak_rss_gb` / `peak_cpu_cores` are sampled from the process subtree and fed back. The startup log **names which bound is active** (`hard_cap|floor|mem_term|cpu_term`) — *"an explainable startup log."*

**Config clamps as an audited security control** ([`config/loader.py:3625-3652`]): `_SECURITY_BOUNDED_FIELDS` clamps `subagent_auto_max` (3..64), `chat_turn_timeout_secs` (300..7200), `loop_stall_exit_after_secs` (10..300), `session.pool_size` (0..10). Out-of-range → clamp + WARNING + audit event, *"so tampering is detectable after the fact even though the loader self-heals."*

## II.4 The channel/surface architecture — our "one core, many surfaces" answer

Five layers, and the separation is exact:

| Layer | Module | Owns |
|---|---|---|
| Transport | `messaging/transport.py` | `MessagingTransport` ABC + `TransportCapabilities` |
| Driver | `messaging/driver.py` | `TurnDriver` — provider events → channel-neutral `OutputEvent`s; redaction + approval ladder, **once** |
| Renderer | `messaging/renderer.py` | per-channel `OutputEvent` → native widget |
| Pipeline | `messaging/dispatch.py` | `drive_turn()` — governance → session → context → driver → persist → release |
| Splitter | `messaging/split.py` | fence-safe, **prefix-stable** markdown chunking |

**`TransportCapabilities` has an enforced HONESTY CONTRACT** ([`transport.py:32-113`]):
> *"A declaration here is a claim other code is entitled to trust, so every field carries its real enforcement status below and `test/test_capability_ledger.py` forces any new field to be classified. History: several flags drifted into being false (a channel declaring `threads=False` while threading end to end; a `max_buttons` cap no renderer applied; docstrings describing gates that did not exist). **Declare what the CODE does today — not the platform ceiling, and not intent.**"*

Fields split **ENFORCED** (`max_message_chars`, `supports_proactive_send`, `supports_session_resume`, `max_buttons`) vs **ASPIRATIONAL** (`streaming`, `edit`, `reactions`, `rich_blocks`, `threads`, `files_*`), with defaults set to the most restrictive surface so a forgetful adapter degrades rather than over-promises.

**Prefix stability is a streaming contract** ([`split.py:1-62`]):
> *"Splitting is greedy left-to-right and every cut depends only on the text BEFORE it, so re-splitting a longer prefix of the same stream reproduces every chunk except the last one byte-for-byte. A streaming caller can therefore send each sealed chunk as it appears and keep only the final chunk as a live buffer."*

Plus **real fence grammar, not backtick parity** (*"Counting ``` occurrences misreads a ``` line inside a ````diff block as a closer and then inverts the open/closed state for the rest of the message"*) and **self-contained chunks** (a cut inside a fence seals with a synthetic closer and reopens with the original opener line, info string and indent included). It exists because *"Six splitters grew independently… so a fix landed in one never reached the others."* — we have the same problem across web/CLI/mobile.

**Per-channel throttles, each justified rather than copied:** Slack `1.0 s`, Discord `1.2 s`, WeCom `0.7 s`, Weixin chunk delay `0.3 s`, Webex `_TOOL_EDIT_BUDGET = 6`. And the Telegram decision is the lesson ([`telegram/renderer.py:43-51`]):
> *"Telegram has no native token streaming: 'streaming' meant editing one message on every chunk, and each edit is a full HTTP round-trip + a whole-bubble re-render, which reads as a stutter… Instead we do 'block streaming': hold a live 'typing…' indicator while the answer forms, then post the finished answer as one clean block."*

**Do not stream where streaming makes the surface feel worse.** That applies directly to our mobile app on a poor connection.

Three more pipeline details:
- The `finally` guards `renderer.close()` **before** `sessions.release()`, because *"the semaphore is keyed by SESSION, so a lost release wedges every later message in that conversation."*
- **`SilentRenderer` is substituted, not flagged** — a muted conversation never even shows a typing indicator; the turn still runs and still lands in the session.
- **Streaming-safe redaction**: two independent rolling-buffer redactors per turn, because *"per-chunk redaction misses a credential split across streaming boundaries"* — and protocol de-framing must run **before** redaction, because a marker splitting a credential run reassembles downstream.

## II.5 Coalescing that never ships a stale frame

[`state.py:5569-5625`], window `_SLOTS_BROADCAST_INTERVAL_S = 0.2`:
> *"Coalesces on a leading plus trailing edge: the first call after an idle period broadcasts immediately, further calls inside the window are absorbed, and one trailing broadcast carries the final state… **The trailing flush re-serializes at delivery time, so a coalesced frame is never a stale frame.**"*

Plus a **depth-counted suspend context manager** for bulk restores ([`:5547-5568`]):
> *"`get_or_create_slot` broadcasts the FULL slot list on each call, so a bulk restore of N tabs serializes 1+2+…+N slots — O(N²) `to_dict`/redaction work for intermediate states no client will ever render (measured ~1.3 s at N=77, and it grows quadratically)."*

We have the identical shape in `push_slots`-equivalent paths and in our RightPane tab restore.

## II.6 Backpressure policy stated **per hop**

- **MCP backend → stub: bounded queue, drop the slow consumer.** `_STUB_INBOX_MAXSIZE = 4096`; *"A wedged stub must never apply backpressure to the shared stdout pump nor let a chatty backend grow gateway RSS without bound; dropping the one slow stub protects every co-pooled session."*
- **ACP runtime → session handle: unbounded, and admitted as such.** They call this out in a design note as a known gap. **Do not copy it** — the `_STUB_INBOX_MAXSIZE` pattern exists 200 files away in the same repo.

## II.7 Wedge detection, and the criterion that generalises

Two layers fed by one heartbeat ([`dashboard/loop_watchdog.py`], `exit_after=25.0`, `stall_after=30.0`, `poll=5.0`):
1. **Authoritative:** each beat re-arms `faulthandler.dump_traceback_later(exit_after, repeat=False, file=dumpfile, exit=True)` — *"That timer lives on faulthandler's own C thread and reads thread states in C, so it fires even when the loop thread is wedged in a syscall."*
2. **Fallback:** a daemon thread comparing monotonic clocks, dumping **without** exiting — works because *"CPython releases the GIL around blocking syscalls such as `close()` / `waitpid()`, which is exactly the class of wedge observed in production."*

Budget coupling is stated explicitly: `exit_after` (25 s) is kept **below** the external prober's kill window (3 × 10 s ≈ 20 s+) *"so this in-process path generally wins and the dump is captured… The two budgets are close rather than comfortably separated, so they must be kept in sync if either side is tuned."*

**Journal problem and its fix:** `dump_traceback_later` targets one fd, so hard-exit dumps land only in the dedicated file. `server.py` therefore **detects and replays the dump content to the logger at WARNING on the next startup**, capped at 120 lines / 8 KB — *"so journal-only operators see the stacks one restart later — exactly when they are investigating why the gateway died."*

**And the Electron-side liveness finding is one we will hit verbatim** ([`website/electron/gateway-liveness.js:5-18`]):
> *"`waitForGateway` runs exactly ONCE, at boot. After the dashboard loads, nothing re-checks the backend. The 'Connected (live)' badge tracks the websocket, which stays TCP-connected even when the backend's asyncio loop is wedged — so a wedged gateway leaves the UI on an eternal spinner with a green badge and no recovery. **(Observed: a blocking `close()` on the loop thread froze the backend for ~10h while the app sat connected-but-blank.)**"*

Fix: poll a **loop-turning endpoint**, not the socket. `failureThreshold = 3` at `10_000 ms`, an `inFlight` guard, fire `onUnresponsive` once per episode, `timer.unref()`.

**The general criterion**, from `design-notes/tool-stall-watchdog-placement.md`:
> *"**A detector must not be downstream of the failure it detects.** Put a check in the read loop when the failure leaves the read loop itself scheduled and waiting; put it out of band when the failure can freeze, delete, or starve the very code that would notice."*

with a **non-lethality bar**: *"Every in-band probe is designed so a wrong verdict costs a regeneration and never a session."* Out-of-band action **unblocks**, never terminates. And — *"log the decision NOT to act, at WARNING"*; they had to diagnose an incident from the absence of a log line.

## II.8 Computer use, done carefully

- **Side-effect-free import** ([`computer_use/__init__.py:1-6`]): *"no native framework is loaded, no `CDLL` runs, no file is read, and no platform branch is taken until `get_shared_backend()` is actually called."*
- **Sync/async split at the module boundary** ([`service.py:11-18`]): the blocking body lives in a module with no async imports at all, *"so a future caller cannot accidentally await a blocking body"* — and the handler offloads **once per request**, not once per native step.
- **Nested deadlines**: per-call `AX_MESSAGING_TIMEOUT_SECS = 2.0` **and** aggregate `MAX_WALK_SECS = 10.0` (the per-call timeout *"is not sufficient on its own"*), with node/depth/children caps `1200 / 64 / 512`.
- **Element cache keyed `(session_key, window_key)`** with three bounds: **hard fail, never lazy re-snapshot** (*"A lazy re-walk would silently let the model act on a tree it was never shown"*); `SNAPSHOT_TTL_SECS = 90` on **`time.monotonic()`**; and fingerprint-drift verification against a fresh walk before every mutating action. The window half of the key exists because *"two documents of the same app routinely have identically-shaped toolbars"* — fingerprinting alone cannot catch that aliasing. And the honest limit: *"fingerprinting narrows the race, it does not eliminate it."*
- **Frame relay never re-captures**: *"It adds no capture of its own: no second `CGWindowListCreateImage` call, no timer, no full-screen grab. One frame per tool-call capture, and only when that capture already happened."*
- **Ordered dispatch chokepoint** ([`tools.py:19-52`]) — one function, 11 numbered steps, one exit for refusals that applies the **same** redaction as the success path, *"A refusal is prose about the operator's desktop… Surfacing any of those verbatim would make the one path that skips the egress pass the easiest way to read a token out of a status bar."*

## II.9 Browser as a shell capability, not a tool namespace

`docs/system-specs/modules/browser.md:6-32`:
> *"Each browser action is one `playwright-cli` invocation on the agent's ordinary command path, so there is no MCP server to register, no tool schemas re-sent per request, and no per-message browse marker."*
> *"**The stdout line is the contract.** Every command prints the resulting page URL, the page title, and a filesystem path to a snapshot YAML. Roughly 250 characters of stdout carry a complete action result, and the accessibility tree stays on disk until the agent decides it needs it. This is why no compression layer exists: a wrapper that read the YAML and summarized it would put the tree back into the model context, which is the cost the on-disk handoff removes."*

They then **iframe `playwright-cli show`** for the live view rather than building a screencast — with three hard-won operational rules: bind `127.0.0.1` explicitly (the default listener is IPv6-only and an iframe pointed at `127.0.0.1` fails), health-check for *any* response not 200 (root answers 302), and treat `show` as a supervised child process. *"Never pass `--host 0.0.0.0`."*

Electron gets a real `WebContentsView` instead ([`browser-view.js`]) — partial-rect `setBounds`, **no preload**, sandbox on, http(s) only, popups denied, and a `WeakSet` of untrusted `webContents` so permission handlers refuse **by identity before any origin heuristic runs** (otherwise browsing to `http://localhost:<port>` inherits the dashboard's mic grant). And the layering constraint: a native view **composites above the SPA and cannot be CSS-layered**, so the renderer must tell main when an overlay is up — kept as a pure, tested `computeVisible` function.

## II.10 Persistence, terminals, extensibility — condensed

**No hot-path SQLite.** JSONL append-only per session, auto-rotating at 512 KB keeping the last 200 lines, archives at `sessions/archive/<stem>__<stamp>.jsonl` with 7-day retention. The delimiter is `__` not `.` *"because session keys legitimately contain dots (a Slack thread_ts)."* Slot UI state is in-memory with a **5-second dirty flush**. SQLite is used only for FTS/vector/graph, always with WAL + `busy_timeout` + autocommit, and **every call that could block on `busy_timeout` is explicitly offloaded with a comment saying why**.

**Delete-by-rename into a trash dir with an append-only manifest** ([`session_storage.py`]) — instant, reversible, and *"A batch can span six figures of sessions, so a whole-document manifest rewritten per move would cost quadratic bytes; appending also leaves a partial batch fully restorable after an interruption."*

**Terminals** ([`handlers/terminal.py`]): `_MAX_SESSIONS = 12` → HTTP 429; `_ORPHAN_TIMEOUT_S = 900`; `_SCROLLBACK_MAX = 50 KB` ring replayed on reconnect; **byte-for-byte forwarding** (*"xterm.js runs its own incremental decoder, so a multi-byte character split across two reads is reassembled on the client"*); one `asyncio.Lock` per session because the WS writer is not concurrency-safe and three producers contend; and the **capture-and-revalidate** idiom (`live = sess.ws` into a local, re-checked after the lock await) *"because touching it after a suspension point can raise `AttributeError`, which `except OSError` does NOT catch — that would kill this task and stop PTY draining."*

**Extensibility = Protocol + shipped Default + core never branches.** `platform/interfaces.py` defines ~25 `Protocol` extension points, each with a `Default*`, bundled into a frozen `PlatformContext` read via `current_context()`. The invariant: *"The core never imports a companion edition and never branches on which edition is running"* — and `tunnel/manager.py` is the reference: *"there is no `isinstance`/identity check against the Default provider (that would be an edition branch by proxy)."* Config schema is **generated by dataclass introspection** and pinned by a checked-in `config-baseline.json`.

**And the one operational finding worth its own paragraph** — `docs/architecture/resource-protection.md`:
> *"`preexec_fn` forces CPython off `posix_spawn`/`vfork` onto a plain `fork()` of the multi-GB, roughly-118-thread gateway… `subprocess.Popen._execute_child` blocks in an unbounded `os.read(errpipe_read, ...)`. **For `asyncio.create_subprocess_exec` that read runs on the event loop thread with no `await` point, so no `asyncio.wait_for` can interrupt it and the whole gateway stops.** … the wedged child still holds a duplicate of every inherited fd, `gateway.lock` and the dashboard's listening socket included, which then outlive the gateway. **This is observed behavior, not theory.**"*

The general rule transfers to Node directly: **do no work between fork and exec in a multi-threaded, multi-GB process.** They enforce it with an **AST tripwire test** that fails on any *new* offending call site, with a shrink-only ratchet on the 10 that remain.

## II.11 Three things KiroCrew got wrong — do not copy

1. **The ACP per-session event queue is unbounded** (admitted in their own design note).
2. **The PTY read loop uses the default executor** (`run_in_executor(None, reader)`) despite `executors.py` existing precisely to prevent that. 12 sessions × one pinned default-pool worker each.
3. **Anything snapshotted at process birth and used hours later is wrong by then** — their pytest-xdist worker cap is captured at session spawn and never refreshed. Refresh at the *use* boundary.

---

# PART III — VS Code (the mechanisms, with their numbers)

Full audit in the subagent report; here are the ten that map onto our open defects.

## III.1 Main relays nothing hot

[`src/vs/platform/agentHost/node/agentHostService.ts:17-22`]:
> *"Main-process service that manages the agent host utility process lifecycle (lazy start, crash recovery, logger forwarding). The renderer communicates with the utility process directly via MessagePort — **this class does not relay any agent service calls.**"*

Processes: main, renderer(s), **pty host**, **agent host** (Copilot/Claude/Codex SDKs), shared process, extension host, file watcher fork, ripgrep, `WebContentsView`. Every one is spawned via `utilityProcess` with `MaxRestarts = 5`, lazily (*the pty host is not spawned at boot — it is spawned when the first window asks for a connection*), and the renderer gets a raw `MessagePort` minted in main and transferred. **Terminal bytes, agent tokens and extension RPC never traverse the main event loop.**

## III.2 The terminal flow-control loop, verbatim

[`src/vs/platform/terminal/common/terminal.ts:871-891`]:
```ts
HighWatermarkChars = 100000,   // pause the pty above this many unacked chars
LowWatermarkChars  = 5000,     // resume below this
CharCountAckSize   = 5000      // client acks in 5000-char batches
```
> *"…ideally while the pty is paused the number of unacknowledged chars would always be greater than 0 or the client will appear to stutter. In reality this balance is hard to accomplish though so heavy commands will likely pause as latency grows, **not flooding the connection is the important thing as it's shared with other core functionality**."*

**The ack fires from inside the consumer's parse-completion callback** ([`terminalInstance.ts:1679-1687`]):
```ts
this.xterm?.raw.write(data, () => {
  this._latestXtermParseData = messageId;
  this._processManager.acknowledgeDataEvent(data.length);
  ...
});
```
batched by `AckDataBufferer`, with the counter clamped at 0 *"to heal from errors."* The ack means **"the pixels exist"**, not "the bytes left the kernel."

**Scrollback is a headless xterm, not a byte buffer** ([`ptyService.ts:1032-1060`]) — `new XtermTerminal({cols, rows, scrollback, allowProposedApi: true})` inside the pty host, serialized with `@xterm/addon-serialize`. Memory is **O(lines × cols)**, not O(bytes emitted): default `scrollback: 1000`, and only **100** for cross-restart revive. Where a byte buffer is used (`terminalRecorder.ts`) it is a `string[]` with `shift()` from the head at `MaxRecorderDataSize = 10 MB` — **zero concat on the write path**; concat happens once, when someone asks.

Data pty→renderer is coalesced in a **5 ms** window per terminal id (`terminalDataBuffering.ts`).

**This is the direct replacement for our `Buffer.concat`-per-chunk (P0-23) and our missing coalescer (P1-27).**

## III.3 `ThrottledWorker` — the admission-control primitive we don't have

[`src/vs/base/common/async.ts:1391-1450`]:
> *"there is a maximum of units the worker can handle at once (`maxWorkChunkSize`); there is a maximum of units the worker will keep in memory for processing (`maxBufferedWork`); after having handled `maxWorkChunkSize` units, the worker needs to rest (`throttleDelay`)"*

`work(units)` returns `boolean` — **false means rejected**. Real tuning, verbatim ([`parcelWatcher.ts:179-188`]):
```ts
maxWorkChunkSize: 500,   // only process up to 500 changes at once before...
throttleDelay: 200,      // ...resting for 200ms until we process events again...
maxBufferedWork: 30000   // ...but never buffering more than 30000 events in memory
```

Plus the rest of the vocabulary we should be using instead of ad-hoc `setTimeout`: `Limiter(n)` + `whenIdle()`, `ResourceQueue` (a `Queue` per URI that **auto-disposes when drained** — the fix for maps that only grow), `LimitedQueue` (1 running + 1 *replaceable* pending — "only the latest matters"), `Throttler`, `RunOnceWorker`, `raceCancellation`.

And for CPU loops ([`arrays.ts:306-335`]): `await new Promise(resolve => setTimeout(resolve)); // any other delay function would starve I/O`.

## III.4 rAF-coalesced markdown — our O(N²) fix, already solved in this repo

`chatIncrementalRendering/`:
- `IncrementalDOMMorpher.tryMorph()` first checks `newMarkdown.startsWith(this._lastMarkdown)` — **pure-append fast path**, full re-render only on divergence.
- `_scheduleRender()` collapses any number of token arrivals into **at most one re-render per animation frame**.
- A **word-rate buffer** on top: `MIN_RATE = 40`, `MAX_RATE = 2000`, `MIN_RATE_AFTER_COMPLETE = 80`, `DEFAULT_RATE = 8` words/sec, driven by the model's own `impliedWordLoadRate`.
- Fallback timer is a plain **50 ms** interval — nowhere near per-token.

**Visibility gating is a hard early-return, not a flag check** ([`chatListRenderer.ts:1779-1781`]):
```ts
private doNextProgressiveRender(...): boolean {
  if (!this._isVisible) { return true; }   // treat as "done" — stop the loop entirely
```
And for iframes the default is **release**, not retain — `retainContextWhenHidden` is opt-in. That is the inverse of our RightPane.

## III.5 Six more, compressed

| Mechanism | Evidence | Fixes |
|---|---|---|
| **Parent-PID heartbeat in every child** — `setInterval(() => { try { process.kill(parentPid, 0); } catch { process.exit(); } }, 5000)` | `src/bootstrap-fork.ts:169-180` | Our **24 orphaned `claude.exe`**, permanently, in ~10 lines |
| **Every host installs `uncaughtException` *and* `unhandledRejection` and logs** — and the watcher **deregisters them on dispose** | `bootstrap-fork.ts:157-167`, `sharedProcessMain.ts:529-530`, `parcelWatcher.ts:198-208` | P0-40 (one rejection kills the server) |
| **Conditional restart, not blind restart** — don't restart for a single failing sub-request; don't restart on `EMFILE` / `No space left on device` *"this is not recoverable anyway"* | `platform/files/common/watcher.ts:241-264` | Restart loops that are worse than staying down |
| **Ack-counter unresponsiveness** — `UNRESPONSIVE_TIME = 3000`, checker **cancelled when `_unacknowledgedCount` hits 0** so an idle host costs no timers; the far side acks **before** running the handler | `rpcProtocol.ts:121, 183-221, 380` | Telling "the model is thinking" from "the host is wedged" |
| **Freeze → sampled JS stacks → attributed telemetry** — 1 s interval / 15 s period; any stack ≥20 % of samples becomes a reported error; `Error.stackTraceLimit = 0` while constructing it; analysis in a **worker**; normalized against a per-machine `perfBaseline` | `windowImpl.ts:734-737, 1659-1727` | "Why did the UI freeze" |
| **Delayed DI**: injecting a service does not construct it; **subscribing to `onDid*`/`onWill*` does not either** (listeners are parked and replayed); `GlobalIdleValue` constructs in idle time anyway so the first real call is warm | `instantiationService.ts:298-380` | Eager services and boot cost |

And two IPC lessons that cut both ways: `ProtocolWriter` **coalesces every message in a tick into one `VSBuffer.concat`** — then the socket layer **re-chunks at `MaxWebSocketMessageLength = 256 KB`**, because *"the actual writing will only happen after all of the 100MB have been deflated… we will get a single onData event when all the 100MB have arrived, delaying processing the 1000 received messages until all have arrived, instead of processing them as each one arrives."*

Finally: **stop screenshotting the browser.** `WebContentsView` + `setBounds` — the renderer sends **bounds**, the compositor does the rest, **zero frames cross IPC**. `capturePage` exists only as an explicit, size-capped (`MAX_FULL_PAGE_SCREENSHOT_DIMENSION = 2576`) on-demand action, with `awaitNextPaint` documented as *"Adds ~1 frame of latency… so leave off for captures that don't follow a DOM teardown."*

---

# PART IV — OpenMausBot (channels, connections, CUA, "desktop streaming")

**Headline correction:** OpenMausBot has **no desktop streaming.** Every live-desktop surface is a **polled still-frame** (3 s / 4 s / 6 s) delivered as base64-in-JSON and rendered into `<img src="data:...">`. The only real-time path is **noVNC opened in an external browser tab**. The value is entirely in the **action** path and the **channel discipline**.

## IV.1 Channel inventory

| Channel | Direction | Framing | Notes |
|---|---|---|---|
| Electron IPC `ipcMain.handle` × 13 | R→M req/resp | structured clone | `credential:set` is **name-allowlisted**; `perm:open-settings` uses `Object.hasOwn` (prototype-safe); `engine:open-terminal` **never becomes argv** — `clipboard.writeText(cmd); openBlankTerminal()` |
| `webContents.send` × 3 | M→R fire-and-forget | — | `speech:transcript`, `speech:end`, `update:state` |
| Preload `contextBridge` | — | 14 members exactly | `ipcRenderer` never exposed; listener registrars return unsubscribe closures |
| HTTP `127.0.0.1:8799` ~70 routes | R→S | JSON | **Two gates before routing**: `isLoopbackHost(host)` → 403, `isAllowedOrigin(origin)` → 403 |
| **SSE `GET /api/events`** | S→R | `id: <streamId>:<seq>` | `?screens=off` opt-out; `?since=`/`Last-Event-ID` resume; 25 s `: keepalive` |
| Webhook ingress `127.0.0.1:8800` | ext→S | JSON | **separate server** *"so Funnel or a future hosted relay never has to expose the rest of the control surface"*; 256 KB cap enforced **streamingly**; auth checked **before** buffering |
| stdio JSON-RPC (MCP) × 6 | S/agent→proxies | newline-delimited, hand-rolled, **no MCP SDK** | `computer-proxy`, `permission-proxy`, `agents-proxy`, `container-mcp`, `dweb-proxy`, `cua-driver mcp` |
| Agent CLI stdio | S→CLI | `--output-format stream-json`, prompt over **stdin, never argv (ARG_MAX)**; `setEncoding("utf8")` because *"a raw `buf += chunk` splits multibyte characters that straddle two reads"* | Claude / ACP / Codex |
| Unix sockets / named pipes × 4 | — | — | POSIX `${DATA_DIR}/perm-${tag}.sock`; Windows `\\.\pipe\openmausbot-perm-${pid}-${tag}` |
| **File-as-channel × 3** | — | JSON / NDJSON / marker files | `cua-connection.json` (atomic tmp+rename); speech NDJSON tailed via `watchFile(path,{interval:50})` with a byte offset; stop/finish marker files |
| noVNC WS | container→external browser tab | — | `window.open`, not embedded |

**Identity-checked port acquisition** ([`main.mjs:139-155`]): the health endpoint returns `{app, pid, static}` and the parent only accepts a child whose `pid` matches the one it forked — *"a dev harness server has the same API shape, so only the child we actually forked counts as ours."* Port ladder `[8799, 18799, 28799]` × 2 passes. **We will hit this the first time a user runs `pnpm dev` and the desktop app together.**

## IV.2 The resume protocol (better than ours)

[`index.ts:237-255, 1567-1587`]:
```ts
const STREAM_ID = randomUUID().slice(0, 8);
const REPLAY_MAX = 500;
// frame: `id: ${STREAM_ID}:${seq}\ndata: ${JSON.stringify({...payload, seq})}\n\n`
```
> *"The stream id makes the cursor safe across restarts: sequence numbers begin again at 1 on boot, so a cursor from a previous run must be rejected rather than used to replay a different run's frames. **It rides inside the SSE `id:` field, which means a browser EventSource resumes correctly through its own Last-Event-ID with no client code at all.**"*

**Gap honesty:**
```ts
const resumed = since !== null && since <= lastSeq &&
  (replayBuffer.length === 0 ? since === lastSeq : replayBuffer[0].seq <= since + 1);
res.write(`data: ${JSON.stringify({ kind:"hello", cursor:`${STREAM_ID}:${lastSeq}`, resumed })}\n\n`);
```
> *"If the client's cursor fell off the end, saying so is the only honest answer — **a partial replay would leave a permanent hole in its state.**"*

**And the snapshot/stream boundary** ([`store.tsx:1128-1160`]) — the piece most apps get wrong:
```ts
if (frame.kind === "hello") { clearTimeout(hydrationFallback); if (!frame.resumed) hydrate(); return; }
if (hydrated) handleFrame(frame); else pendingFrames.push(frame);
```
> *"Start hydration only after the stream says hello, queue frames that arrive while the REST snapshot is in flight, then apply them on top. Otherwise a late hydrate can overwrite a newer event, or an event can land between an eager request and the stream opening and disappear entirely."*

Plus a `rehydrateRequested` re-entrancy guard and a 1 s `hydrationFallback` so a dead SSE still shows saved state.

**The single best line in the repo** ([`index.ts:261-263`]):
```ts
replayBuffer.push({ seq, kind, frame: kind === "screen" ? null : frame })
```
> *"Live desktop captures can each be hundreds of kilobytes and become stale as soon as the next one arrives. **Keep their sequence slots so resume-gap detection stays honest, but never retain their base64 payloads.**"*

Plus **per-client subscription filters**: `?screens=off` → `const wants = (client, kind) => kind !== "screen" || client.screens`.

## IV.3 CUA — three hosting modes, and the constraint that drives all of them

**Policy, written down as policy** (`docs/computer-use-integration.md:35`):
> *"**Decision (Milind, 2026-08-12): CUA is the ONLY computer-use provider. No cliclick, no robotjs/nut.js, no Python computer-server, no fallbacks.**"*
> *"If a capability is missing… it is added to cua-driver upstream or requested as a driver tool — never bolted on beside it."*

**Mode A — host macOS.** The critical constraint ([`cua.mjs:26-31`]):
> *"macOS TCC attributes a spawned child to its 'responsible process'. Spawned from Electron main → the grant is OpenMausBot's… Spawned from a Node gateway/daemon → the identity silently becomes the gateway's and `check_permissions` cannot detect the misattribution. **The harness must ask Electron main for the driver socket path over IPC, not spawn the driver.**"*

```
Electron main ──EmbeddedCuaDriverHost.start()──▶ cua-driver daemon (Rust) ──unix socket
     └─ writes <userData>/cua-connection.json {mode, socketPath, mcpCommand, mcpArgs, mcpEnv}
            harness READS it and passes it verbatim into --mcp-config
                agent CLI spawns `cua-driver mcp --embedded --socket <p>` ──▶ same daemon
```
**The server is not on the action path at all. Zero server hops. Zero DB writes.** Quit is `preventDefault()`ed and deferred on `stopCua()` with a **2500 ms cap** — *"Cap the defer so a wedged daemon cannot keep the app alive forever."*

**Mode B — container.** Pinned base image by digest, **SHA-256-verified** cua-driver wheel, a **supervisor program** so the daemon starts/restarts/stops with the desktop, and the MCP entry is a **60-line pure pipe passthrough** whose header states the design: *"This process defines no tools and parses no MCP messages."* Sandbox: `--memory 4g --memory-swap 4g --cpus 2 --pids-limit 512 --cap-drop ALL --shm-size 512m`, one bind mount, and `-p 127.0.0.1:6080:6901` — with a test that asserts `not.toContain(" -p 6080:6901")`.

**Mode C — cloud box: the one that resembles our architecture, and the one they optimised hardest** ([`computer-proxy.ts:8-30`]):
> *"Transport: every action goes through the box's REST run-command endpoint… so a round trip is expensive (~TLS + shell spawn). **The whole design is therefore built around ONE round trip per step:** act + settle + capture + base64 all run in a single shell command, and the resulting frame rides back in the SAME tool result as an MCP image block ('act and observe'). The agent never needs a follow-up screenshot call, **which halves the model inferences per UI step**."*

```ts
const command = [ENV, GEOMETRY, ensureRemoteCuaCommand(), guarded,
                 observe ? captureBlock(settleOf(args)) : "true", 'echo "ACT $ACT"'].join("; ");
```
```ts
const SHOT_WIDTH = 1280;          // "the coordinate space the model sees"
const JPEG_QUALITY = 75;
const SETTLE_MS = 350;            // "how long the desktop gets to repaint before the fused capture"
const ACTION_GAP_MS = 120;        // "so focus changes land before typing"
const INLINE_MAX_BYTES = 400_000; // above this, fetch over HTTP instead of stdout
```

**Coordinate scaling happens box-side, in shell arithmetic**, so there is never a "how big is the display" round trip:
```ts
`if [ "$W" -gt ${SHOT_WIDTH} ]; then ${varName}=$(( ${v} * W / ${SHOT_WIDTH} )); else ${varName}=${v}; fi`
```
> *"on a 1024-wide desktop the frame is native size and a blind /1280 would put every click at 80% of where the model aimed."*

**Frame integrity — 15 lines we should copy verbatim** ([`:265-282`]):
```ts
function wholeImage(bytes: Buffer, expectedBytes?: number): boolean {
  if (bytes.length < 512) return false;
  if (expectedBytes && bytes.length !== expectedBytes) return false;
  // …JPEG must end with FFD9, PNG must end with IEND
}
```
> *"Checking the magic number alone is not enough: the box's command stdout has been observed truncating a payload, **and a truncated JPEG still starts with a valid header — it just renders as a grey half-frame for the model.**"*

with a one-way latch: `let inlineWorks = true; // flipped off for the proxy's life on first garbage`.

**Duplicate-frame suppression** ([`computer-observation.ts:118-160`]) — SHA-256 of the **canonical full-screen** frame (hashed *before* cropping); if unchanged, send text only:
```ts
if (!observation.changed) return text(id, `${note}\n(the screen is identical to the frame you already have.` +
  " Don't repeat the action — it may already have succeeded. …)");
```
> *"it already has it, and **it costs ~1.2k tokens**"* — and the guidance deliberately does **not** say retry: *"re-clicking a button that already submitted is the expensive kind of wrong."*
Fail-open rule: *"If the box cannot provide a full-frame hash, fail open and send the valid image. Suppressing a possibly-new crop would be worse."*

**`computer_batch`** (capped at 24 actions) runs a whole mechanical sequence in one round trip with one frame at the end, and failure is not swallowed: `if { a; b; c; }; then ACT=ok; else ACT=failed; fi` — *"Joining with ';' alone made a failed action look identical to one that did nothing."*

**Semantic-over-pixel browser control**: `Accessibility.getFullAXTree` filtered to 13 roles, capped at 250 elements, refs `b<backendDOMNodeId>`, and refs are **cleared after every semantic action** — *"DOM mutations can invalidate backend node IDs; force a fresh snapshot after every semantic action instead of risking a click on an old target."*

**Credential isolation on every agent-issued command**: `exec env -i HOME=… USER=… PATH=… DISPLAY=… /bin/bash -c '<quoted>'`.

**Single-writer lease for the local VM** ([`index.ts:339, 820`]): *"Two agents driving it simultaneously would mix clicks, keystrokes and screenshots, so only one thread may lease it at a time."* Claim happens **before the first `await`** — *"neither side can enter while the other is between inspection and mutation."* And explicit destinations fail closed: *"Local VM must never fall through to host CUA and accidentally click on the user's Mac."*

## IV.4 What NOT to copy from OpenMausBot

1. **The entire preview pipeline** — three separate polling loops, base64-in-JSON → data URL → `<img>` swap.
2. **Local-VM capture: two `docker exec` spawns per frame returning full-resolution PNG as a data URL.** A 2560×1600 XFCE PNG is 1–3 MB, +33 % base64, every 3 s. No downscale, no JPEG, no change detection — *despite the same repo having all three in `computer-proxy.ts`*.
3. **`desktopCapturer.getSources()` on a 3 s interval** — full source enumeration per frame.
4. **No visibility gating anywhere** — a background window keeps capturing forever.
5. **No slow-consumer handling on SSE** — `try { res.write(frame) } catch { delete }`. Node's socket buffer is the only backpressure.
6. **JSON-file persistence with whole-thread rewrite per message** — they document the O(n²) themselves and patch it with a 4-frame prune.
7. **No CSP** on an origin that renders model-authored markdown.
8. **Two independent capture pipelines that don't share code** — agent frames are JPEG/downscaled/hashed/validated; human preview frames are none of those. **One capture module, one policy.**
9. **`cuaOrX11()` runs `cua-driver status` on *every single action*** and silently degrades to `xdotool` — an extra subprocess per action plus two behaviour contracts for one tool surface, violating their own stated CUA-only policy.
10. **Fire-and-forget `void (async () => …)()` for turn dispatch**, with a comment admitting an unhandled rejection *"is fatal to the harness, which in the packaged app kills the server child"* — and then relying on remembering `.catch()` at every call site. We have this exact bug (P0-40).

---

# PART V — Hermes and the modern-harness landscape

## V.1 Hermes: two different things, and only one is a runtime

**Hermes-Function-Calling** is *not* a harness — it is a reference repo with a single-process recursive loop (`--max_depth` default 5). Its value is the **wire format**: ChatML turns, tools advertised in the system prompt inside `<tools>…</tools>`, model emits `<tool_call>{...}</tool_call>`, results return on a **`tool` role** inside `<tool_response>`. Two implications for a provider abstraction: the parser must tolerate multiple tool-call blocks per turn *and* markdown-fenced JSON; and **correlation is positional, not by ID** — normalising Anthropic/OpenAI tool IDs into a Hermes-shaped provider means synthesising IDs ourselves. Hermes-3 adds a `<scratch_pad>` GOAP block (`Goal` / `Actions` / `Observation` / `Reflection`).

**Hermes Agent** (`NousResearch/hermes-agent`, v0.20.2) **is** a real runtime and is architecturally close to us:

| | |
|---|---|
| Entry points | CLI, **Gateway**, **`acp_adapter/` (stdio JSON-RPC for VS Code/Zed/JetBrains)**, batch runner, API server, Python library |
| Core principle | One `AIAgent` class serves **all** entry points — *"Platform differences live in the entry point, not the agent."* |
| Providers | `runtime_provider.py` maps `(provider, model)` → `(api_mode, api_key, base_url)` across **3 API modes** (`chat_completions`, `codex_responses`, `anthropic_messages`), 18+ providers, OAuth, credential pools |
| Tools | **Self-registering at import time** — `registry.register()` at module top level; *"Any `tools/*.py` file with a top-level `registry.register()` call is auto-discovered."* 70+ tools |
| Terminal backends | **7**: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox |
| Prompt | Three ordered tiers **`stable → context → volatile`**, explicitly so caching works: *"System prompt doesn't change mid-conversation. No cache-breaking mutations except explicit user actions (/model)."* |
| Context | Pluggable `ContextEngine` **ABC** with the default lossy summarizer as one implementation, plus `plugins/context_engine/`. Same for memory. |
| Concurrency | **Profile isolation**: `hermes -p <name>` → own `HERMES_HOME`, config, memory, session DB, gateway PID. *"Multiple profiles run concurrently."* |
| Cron | Each tick creates a **fresh `AIAgent` with no history**, injects attached skills, delivers to a platform |
| State | SQLite + FTS5, **session lineage tracking (parent/child) across compressions** |

**What Hermes does not have that we need:** no durable-execution journal. The agent loop is *"the synchronous orchestration engine"*; crash mid-tool-call means replay from session history, not from a step journal. Its concurrency bet is **process-per-profile**, not in-process multiplexing.

## V.2 OpenHands — Action/Observation over a REST-mediated sandbox

Strict duality: `Agent --Action--> EventStream --REST--> ActionExecutor --Observation--> EventStream --> Agent`. The agent never touches the sandbox. Three interchangeable `Runtime` impls (`Docker`, `Local`, `Remote`) all speaking the same `/execute_action` contract.

Two mechanisms worth taking:
- **File-locked port-range allocation** (`find_available_port_with_lock`) for the runtime port, VSCode port, and two app-port ranges — the concrete answer to "many concurrent sandboxes on one host without collisions."
- **Overlay/COW bind mounts** — `":ro,overlay"` with `SANDBOX_VOLUME_OVERLAYS` supplying per-container upper/work dirs. Per-run isolated writable views of a shared repo **without copying the tree and without a git worktree**.

And the 2026 restructure is a direct precedent for us: the frontend is now **Agent Canvas** (TypeScript/Electron), the backend is an **Agent Server** — *"a REST API for running multiple agents on a single machine"* — the Canvas connects to and switches between **multiple** Agent Servers, and it natively runs *"OpenHands, Claude Code, Codex, Gemini, or any ACP-compatible agent."* **One UI, N backends, protocol-mediated.**

## V.3 Anthropic Computer Use — the numbers

Tool type `computer_20251124` (beta header `computer-use-2025-11-24`), now with **`enable_zoom`** and a `zoom` action taking `region: [x1,y1,x2,y2]`. Schema-less — the input schema is baked into the model.

| Cost | Value |
|---|---|
| Beta system prompt overhead | 466–499 tokens |
| Computer tool definition | **735 input tokens** |
| Each screenshot | **~1,000–1,800 input tokens** — *"a 200k context window can fill up in well under 100 screenshots"* |

| Model family | Max long edge | Max total pixels |
|---|---|---|
| Claude 4.6 family | 1568 px | 1.15 MP |
| Opus 4.7 / 4.8 / Opus 5 / Sonnet 5 | 2576 px | 3.75 MP |

**Scaling must be ours, not the API's:** *"Relying on the image resizing behavior in the API will result in lower model accuracy and slower performance than implementing scaling in your tools directly"* — because the model returns coordinates **in the space of the image it saw**. Factor: `min(1, MAX_LONG_EDGE/long_edge, sqrt(MAX_PIXELS/(w·h)))`. Start at **1280×720**; 1080p for Opus 4.7; avoid below 960×540; avoid 1920×1080+ on the 4.6 family. macOS Retina DPR=2 is named as a top cause of 2× offsets.

**Tested and did *not* help:** tiling into quadrants; overlaying a coordinate grid; resize-algorithm choice (LANCZOS vs sips — *"produced identical results"*).

**Context recipe:** four cache breakpoints — **1 on the stable prefix, up to 3 on the most recent `tool_result` blocks, cleared and re-placed each turn** (*"If your most recent breakpoint is invalidated… an earlier breakpoint can still hit, and you keep paying 10% of the full input cost instead of 100%"*). Prune screenshots **in batches**: `keep_n = 3`, `interval = 25` — so the prefix is **byte-identical for 25 turns** between invalidations. When server-side compaction fires (~150k input tokens), **mirror the truncation client-side** via `applied_edits[].message_index_after_compaction` or the cache prefix breaks.

**Two one-line wins:** put the **text instruction before the image** in the content array (documented to improve click accuracy); and use the **official tool type** purely to get prompt-injection classifiers that run *"with approximately zero additional latency and no additional cost"* — and which **do not run on custom tool definitions**.

**Effort tuning is per-model, not global:** on OSWorld Verified, **Opus 4.7 @ `low` ≈ Sonnet 4.6 @ `max` at ~1/10 the tokens**; `high` reaches near-peak at ~half the output tokens of `max`; on 4.6 `max` gives no accuracy benefit; and `low` uses **fewer total output tokens than disabling thinking**, because fewer mistakes means fewer retries.

Also: **`computer_batch`/`browser_batch`** for visually-independent sequences (*"a workflow with N mechanical actions is a single round trip instead of N"*), an `advisor_20260301` server-side tool letting a cheap executor consult Opus mid-generation with `max_uses`, ~20-turn **reminder nudges** because executors forget which tools exist, and a **Teach Mode** that records human demonstrations (action, description, **selector *and* coordinates**, viewport dims, annotated screenshot) replayed as *context*, not a script, with strict / adaptive / goal-oriented modes.

And the eight-section compaction prompt: `USER INSTRUCTIONS` (**verbatim**, every DO NOT/ALWAYS/MUST) / `TASK TEMPLATE` / `CONSTRAINTS AND RULES` / `ACTIONS TAKEN` / `ERRORS AND FIXES` / `PROGRESS TRACKING` / `CURRENT STATE` / `NEXT STEP`.

The reference `computer-use-demo` README states plainly that its agent loop *"can only be used by one session at a time, and must be restarted or reset between sessions."* **It is not a concurrency model.**

## V.4 Browser stacks: accessibility tree vs pixels

**Playwright MCP** — *"structured accessibility snapshots, bypassing the need for screenshots or visually-tuned models… Deterministic tool application."* Coordinate tools are **opt-in** (`--caps=vision`). Token knobs: `--snapshot-mode full|none` (the auto-attached snapshot is the dominant cost), **`--snapshot-boxes`** (a11y tree **plus** `[box=x,y,w,h]` viewport-relative CSS px — one representation serving both selector-clicking and CUA-clicking), `--mobile` (*"Mobile pages are usually lighter, which saves tokens"*), `--timeout-settle` default **500 ms**.
Hard concurrency constraint: *"A persistent profile can only be used by one browser instance at a time, so concurrent MCP clients sharing the same workspace will conflict."*

**Chrome DevTools MCP** — **`--experimentalPageIdRouting`**: *"expose pageId on page-scoped tools and route requests by page ID (useful for concurrent agent sessions)"* — the cleanest published answer to "N agents, one browser." Also `--screenshotFormat jpeg|png|webp` (*"JPEG and WebP are ~3-5× smaller than PNG"*), server-side `--screenshotMaxWidth/Height`, **`--slim`** (3 tools only, to cut schema tokens), and `--blockedUrlPattern`/`--allowedUrlPattern` which *"silently detaches from targets with blocked URLs upon connection, and blocks runtime requests (including navigations and subresources)"* — subresource blocking is what tool-level checks miss.

**Stagehand** — caching rules that generalise to *any* a11y pipeline: scope by `selector` so changes outside the container don't move the key; use **`variables`** (`"type %email% into…"`) because *"the cache key is built from the variable keys, not the values"*; pin viewport/UA/locale and **block third-party analytics/A-B/ad requests**, which *"inject DOM nodes that shift the cache key on every load"*; keep prompts deterministic. Commit the cache to VCS for CI determinism.

**And Microsoft's own position on their own MCP server** is worth internalising: CLI invocations *"avoid loading large tool schemas and verbose accessibility trees into the model context"* and win for high-throughput coding agents; MCP wins for *"exploratory automation, self-healing tests, or long-running autonomous workflows."* **A per-tool decision, not a platform decision** — which is exactly KiroCrew's "browser as a shell capability" conclusion, reached independently.

## V.5 Durable execution — three models, pick deliberately

| | Temporal | Restate | Inngest |
|---|---|---|---|
| Model | **Deterministic replay** — workflow re-executed from the top, completed work skipped via Event History | **Journaled steps** — `ctx.run()` per step, journal replayed, completed steps skipped | **Step memoization** — each step hashed by ID+index, result injected on re-execution |
| Determinism rules on user code | Yes, strict | No | **No** — *"standard language features with no custom runtime rules"* |
| Hard limits | Warn at **10,240 events**; **terminated past 51,200 events / 2,000 Updates / 10,000 Signals** | — | — |
| Self-host | Server | Server | **Single binary with SQLite or Postgres** |

**Restate's coordination primitives are the important part**, because they are three, not one:
- **Signal** — durable notification by invocation ID + name; *"the same named signal can be resolved multiple times, and each wait receives the next resolution."* Their own example: **"Steer an ongoing agent."**
- **Awakeable** — one-shot, external system resolves/rejects via a generated ID, *"similar to a task token."* Example: "Wait for an external approval callback."
- **Workflow promise** — named, workflow-key-scoped, resolved once, readable many times.

Plus **suspension** (*"Handlers consume no resources while sleeping and resume at exactly the right time, even across restarts"* — a 3-day HITL pause costs nothing), **Virtual Objects** with a single-writer guarantee per key and state *"never out of sync with the execution"*, and **flow control as a first-class server feature**, motivated verbatim by *"expensive concurrent work, such as AI agent calls that translate directly into model or API spend"* and *"keep scheduling fair: distribute capacity evenly between invocations competing on the same partition."*

**LangGraph's `interrupt()` documents four hard-won rules we will otherwise rediscover:**
1. On resume **the entire node re-runs from the beginning** — side effects before the interrupt must be idempotent.
2. **Resume values are matched by index** — so a `while True:` validation loop causes *exponential re-execution* (resume 1 replays 1 iteration, resume 2 replays 2, …). Call the gate **once per node**, store the re-prompt in state, loop with a conditional edge.
3. **Never wrap `interrupt()` in a bare `try/except`** — it pauses by raising.
4. Parallel gates resume with an **ID-keyed map**, not a list.

## V.6 The protocol landscape — and what we should speak

| | **ACP** | **A2A** | **AG-UI** | MCP |
|---|---|---|---|---|
| Axis | Client(editor) ↔ Agent | Agent ↔ Agent | Agent ↔ Frontend | Agent ↔ Tools |
| Transport | JSON-RPC 2.0, agent as **subprocess over stdio** | JSON-RPC/HTTP+SSE, gRPC, REST+SSE | transport-agnostic; HTTP SSE + binary | — |
| Cancel | `session/cancel`; agent **MUST** return `stopReason: "cancelled"`, not an error | `CancelTask` (idempotent) | `RunError` / interrupt | — |
| Permissions | **`session/request_permission` — the CLIENT owns the approval UI** | `TASK_STATE_AUTH_REQUIRED` | `RunFinished{outcome:{type:"interrupt"}}` | — |
| Terminal | **client-provided**: `terminal/create|output|wait_for_exit|kill|release` | — | — | — |
| Who implements | **Zed, VS Code, JetBrains; Hermes `acp_adapter/`; OpenHands Canvas** | Linux Foundation, v1.0 | CopilotKit | — |

**ACP details we are currently hand-rolling badly:**
- **`usage_update`** carries `{used, size, cost:{amount, currency}}` — a standardised live context gauge *and* cost meter, identical on every surface.
- **`messageId` on every chunk**: same ID = same message, changed ID = new message. Removes all heuristic message-boundary detection from renderers — directly relevant to our streaming-markdown segmentation.
- Client also provides `fs/read_text_file`, `fs/write_text_file`, `elicitation/create`.
- Conventions: **all file paths MUST be absolute; line numbers 1-based**; keys `camelCase`, discriminators `snake_case`.
- The cancellation warning is a bug we have already shipped: *"API client libraries often throw when aborted… Agents MUST catch these errors and return the semantically meaningful `cancelled` stop reason"* — otherwise clients render an error toast for a user-initiated stop.

**A2A data-model ideas worth taking even if we never speak the wire protocol:**
- **Task immutability**: a terminal task cannot restart. Refinements are *new tasks under the same `contextId`* with `referenceTaskIds` pointing at the ancestor. Rationale: clean input→output mapping, granular tracking, no ambiguity.
- **Messages are explicitly unreliable**: *"Clients using streaming MAY not receive all status update messages if disconnected… Messages MUST NOT be considered a reliable delivery mechanism for critical information."* Results belong in **Artifacts** (with `append` / `lastChunk` chunking and a stable `artifactId`).
- **Multi-stream broadcast is normative**: *"Events MUST be broadcast to all active streams… Each stream MUST receive the same events in the same order. Closing one stream MUST NOT affect other active streams. **The task lifecycle is independent of any individual stream's lifecycle.**"* That is the spec for web + desktop + mobile watching one run.

**AG-UI ideas:**
- **`ActivitySnapshot` / `ActivityDelta`** (RFC-6902 JSON Patch), typed by `activityType: "PLAN" | "SEARCH"` — a channel for structured in-progress work that is *neither a chat message nor global state*. **That is exactly what our gate cards and stage gauges are.**
- **`*Chunk` convenience events** auto-expanded client-side into Start/Content/End, auto-closing when the ID changes or the stream ends — kills the whole "producer crashed before emitting End → spinner stuck forever" class **at the protocol layer**.
- `StateSnapshot` + `StateDelta` with client-detected divergence triggering a fresh snapshot request; `MessagesSnapshot` for transcript resync.
- **`ReasoningEncryptedValue`** — opaque encrypted chain-of-thought bound to a `messageId`/`toolCallId`, stored and forwarded without decryption, preserving reasoning across turns under ZDR/`store:false`.

## V.7 Multi-agent orchestration — the five patterns and their named failure modes

From Anthropic (Apr 2026):

| Pattern | Named failure |
|---|---|
| Generator-verifier | Verifier with no explicit criteria rubber-stamps; loops oscillate without converging |
| **Orchestrator-subagent** | **The orchestrator is an information bottleneck** — cross-subagent findings round-trip through it and get summarized away. *"Unless explicitly parallelized, subagents run one after another, meaning the system incurs multi-agent token costs without the speed benefit."* |
| Agent teams | No inter-teammate channel; **completion detection is hard** (2 min vs 20 min); shared filesystem conflicts |
| Message bus | Router misclassification **fails silently** |
| Shared state | Duplicate work; **reactive loops** — *"Agent A writes a finding, Agent B reads it and writes a follow-up, Agent A sees the follow-up and responds. The system keeps burning tokens on work that isn't converging."* |

Their termination guidance is the operational bit: ship **all three** of a time budget, a **convergence threshold (no new findings for N cycles)**, and a designated arbiter — because *"systems that treat termination as an afterthought tend to cycle indefinitely or stop arbitrarily when one agent's context fills."*

Default recommendation: **start with orchestrator-subagent**, evolve on observed pressure, and hybridize (orchestrator-subagent overall + shared state for one collaboration-heavy subtask).

## V.8 Sandboxes, transports, Node — the numbers

**E2B:** pause ≈ **4 s per GiB of RAM**, resume ≈ **1 s**; paused sandboxes retained **indefinitely** (explicit `kill()` required); `onTimeout: 'pause' | 'kill'` (default `kill`) + `autoResume`; and — the non-obvious part — *"After a sandbox is paused and resumed, the continuous runtime limit is reset."*

**Modal:** boot ≈ 1 s; gVisor `runsc` checkpoint/restore; **restore ≈ 2.5× faster than standard start** (`import torch` cold start 5 s → **1.05 s p50**), because *"`import torch` alone is 26,000 syscalls"* and restore recreates memory mappings directly. Snapshots invalidated by CPU featureset, driver version, container runtime version — **always keep a cold-start fallback**. Three separate knobs: `scaledown_window` (idle TTL, default 60 s), `min_containers` (floor), and **`buffer_containers`** (headroom *while active*) — *"particularly useful for bursty request patterns, where the arrival of one input predicts the arrival of more inputs, like when a new user starts hitting the Function."* That third knob is exactly "the user just opened a chat, more turns are coming."

**Streaming a desktop — the surprise:** **Selkies** (started by Google engineers) *"streams over plain WebSockets by default, with WebRTC available as an opt-in transport"* while claiming *"at least 60 frames per second on Full HD."* It explicitly targets *"researchers studying Agentic AI."* Neko is the WebRTC counterpoint (audio + multi-participant control). **No published latency/CPU/bandwidth benchmark exists for either** — but the WebRTC-demoted-to-opt-in inversion directly contradicts the usual advice.

**WebCodecs** is the concrete upgrade path: `EncodedVideoChunk` is **10–100× smaller** than the corresponding raw `VideoFrame`; `encoder.encodeQueueSize` is the backpressure signal (`if (encoder.encodeQueueSize > 2) frame.close();` — **drop, never queue**, because a stale frame has negative value); `VideoFrame` is transferable and `transferControlToOffscreen()` moves rendering off the main thread; **always `close()` every frame**; codec strings must be fully specified (`"vp09.00.40.08.00"`) and gated on `isConfigSupported`; and **never call `flush()` for pacing** — *"Calling it unnecessarily will affect encoder quality and cause decoders to require the next input to be a key frame."*

**xterm.js flow control**, with numbers: producers hit **GB/s**, xterm.js processes **5–35 MB/s**; the write buffer has a **hardcoded 50 MB cap and data beyond it is silently discarded**; per-chunk `pause()/resume()` is explicitly called out as inefficient (a kernel context switch per chunk, worst case per byte); recommended **HIGH ≤ 500K**; and callback pressure is reduced by attaching a callback only every ~100 KB and counting **pending callbacks** (HIGH=5, LOW=2) instead of bytes. Over WebSockets you *cannot* flow-control the socket — the prescribed approach is to treat it as an infinite-buffer sink and span the accounting client→server with a **custom ACK message**, with the warning that *"a custom flow control mechanism can easily stop the whole stream forever if the limits are not calculated/applied correctly."*

**Node.js, measured:**
- `JSON.parse`/`stringify` of a 50 MB string: **0.7 s to stringify, 1.3 s to parse** (0.03 s to `indexOf`). For a server that JSON-serialises large tool results per turn, this is a first-order event-loop hazard.
- Backpressure honoured vs ignored on the same 9 GB workload: **87.81 MB RSS vs 1.52 GB (~17×)**, GC sweeps steady at 4–8 ms vs long drawn-out, and **no throughput gain** (55.3 s vs 55.9 s).
- Default `highWaterMark` is **16 KB**. `readable.on('data', d => writable.write(d))` is named as the anti-pattern; use `pipeline()` (`.pipe()` does not destroy the source/transform on downstream failure).
- **Worker-pool starvation:** *"each relatively long Task effectively decreases the size of the Worker Pool by one until it is completed"* — with a worked exploit (path traversal + `/dev/random` permanently consumes all `k` workers). Use `fs.read()`/`ReadStream`, never `fs.readFile()` on agent-controlled paths.
- **CPU-bound and I/O-bound work must not share a pool**: a CPU-bound worker only progresses when scheduled (5 workers on 4 cores = pure overhead); I/O workers progress while descheduled.

---

# PART VI — Twelve places this research changes our plan

These are the deltas against [ARCHITECTURE_PERFORMANCE_REVIEW.md](ARCHITECTURE_PERFORMANCE_REVIEW.md) Part E. Everything not listed here stands as written.

### R1 · Backpressure: build Pi's 15-line version first, not a credit protocol
**Was:** Phase 1 item 6 — wire `sseWrite.ts`, add credit/ack granted at the client's consume point.
**Now:** do Pi's awaited-sequential-dispatch + no-op drain subscriber **first** (days, not weeks). Keep credit/ack **only for the terminal path**, where VS Code's ack-on-render is genuinely necessary because the producer is a PTY we can `pause()`. For chat tokens the producer is a CLI we already control, so blocking our own read loop is sufficient and correct.

### R2 · The provider process: single-reader demux + recycling, not a pool
**Was:** "either accept one CLI and add a priority lane above the pipe, or shard into a pool keyed by workspace."
**Now:** **demux.** One reader task owns the CLI's stdout and routes frames by session id into **bounded** per-session queues (KiroCrew leaves theirs unbounded — do not copy that). Add process recycling by **age (6 h)** and **RSS (500 MB)**, with an RSS probe floor (`>5 min` old) so the hot path stays CPU-only. This directly fixes P0-13's head-of-line blocking without changing the process count.

### R3 · Speak ACP. This is new and it is strategic.
Not in the original review at all. One JSON-RPC-over-stdio adapter buys us, simultaneously:
- **Inbound**: Zed, VS Code, JetBrains and OpenHands Agent Canvas can drive GeneratorAI.
- **Outbound**: Claude Code, Codex, Gemini and any other ACP agent become pluggable backends behind `IAgentHarness` with **no bespoke adapter per provider**.
- **For free**: `session/cancel` → `stopReason: "cancelled"` (fixes our cancel-renders-as-error bug), `session/request_permission` with the **client** owning approval UI (fixes HITL surface divergence), `usage_update` with cost (one context gauge for web/CLI/mobile/desktop), `messageId` stream segmentation (removes heuristic block detection), and a **client-provided terminal capability** — see R4.

### R4 · Invert terminal ownership on the desktop surface
ACP standardises `terminal/create | output | wait_for_exit | kill | release` as **client-provided**. In Electron that means the desktop shell owns the PTY (as VS Code's pty host does) and the agent *borrows* it — so an agent-run command and a user-typed command are **the same terminal object**, with one flow-control implementation, one scrollback, one lifecycle. This is a better answer than our Phase 3 "fix the server-side PTY host" for the desktop surface specifically, and it composes with the server-side host for web/mobile.

### R5 · Durable execution: step memoization, and three gate primitives not one
**Was:** "persist the automation iteration queue; claim rows atomically."
**Now, additionally:**
- Adopt **step memoization** (Inngest model) over deterministic replay — no determinism rules on our TypeScript, and it self-hosts on SQLite which we already have. Temporal's **51,200-event ceiling** is a real hazard if any part of a token stream reaches the journal.
- **Keep token streams out of the journal entirely.** Journal stage boundaries; checkpoint the assembled text once per stage.
- **Split our single "pause and wait" primitive into three**: a **Signal** for mid-flight steering (named, resolvable repeatedly, each wait gets the next resolution), an **Awakeable** for HITL approval (one-shot, external token), and a **workflow promise** for read-many results. Conflating them is why steering during a gate is currently awkward.
- Adopt **suspension semantics**: a run awaiting a gate must hold **zero** process resources. Today a pending gate pins in-memory state indefinitely.
- Enforce LangGraph's four `interrupt()` rules as **lint/review rules**: pre-gate side effects must be idempotent; **ban `while (invalid) { await gate() }` inside a stage** (exponential re-execution); never swallow the pause exception; resume parallel gates with an **ID-keyed map**, never a positional list.

### R6 · Run identity: A2A task immutability + Artifacts vs Messages
**New.** Two model changes with large downstream simplification:
- **A terminal run never restarts.** "Retry" creates a **new run in the same `contextId`** with `referenceTaskIds` pointing at the ancestor. This removes an entire class of "what state is this row in" ambiguity from `WorkflowRunStateMachine`, and makes parallel follow-ups first-class.
- **Messages are unreliable; Artifacts are the result.** Stage *outputs* become artifacts with a stable `artifactId` and `append`/`lastChunk` chunking; chatter stays in messages. Our "reconnect loses content" bugs are structural, not transport bugs.
- Adopt the normative **multi-stream broadcast** contract verbatim — all active streams for a run get the same events in the same order; closing one does not affect others; **run lifecycle is independent of stream lifecycle.**

### R7 · Computer use: get the driver out of our process, and fuse act+observe
**Was:** "move the NAPI driver out of the server process on Windows too; split the semaphore reader/writer."
**Now, additionally and more importantly:**
- Adopt OpenMausBot's **descriptor** model: the host process (Electron main, or a supervised sidecar in server mode) owns the driver daemon and publishes `{mode, socketPath, mcpCommand, mcpArgs, mcpEnv}`; the harness **reads** it and hands the spawn contract to the agent. **Our server leaves the action path entirely** — which also removes the need for the global semaphore of 1, because concurrency becomes the driver's problem, per target.
- **Fuse act + settle + capture into one round trip** and return the frame in the **same tool result**. Their measured claim: this *"halves the model inferences per UI step."* Constants to start from: `SETTLE_MS = 350`, `ACTION_GAP_MS = 120`, `SHOT_WIDTH = 1280`, `JPEG_QUALITY = 75`.
- **Scale coordinates at the far end** from geometry resolved in the same command; never a separate "how big is the display" call; never an unconditional divide.
- **`wholeImage()`** terminator + byte-length validation, with a one-way `inlineWorks = false` latch. A truncated JPEG has a valid header and renders as a grey half-frame to the model.
- **Duplicate-frame suppression** by SHA-256 of the *canonical* full frame (hashed before cropping), with a response that explicitly tells the agent **not to retry**. ~1.2k tokens each, and it prevents the worse failure of re-clicking a submitted button.
- **`screenshotEveryAction` → false**, and adopt Anthropic's **batched pruning** (`keep_n = 3`, `interval = 25`) so the prompt prefix stays byte-identical for 25 turns.
- **Own the downscale, record the factor per capture**, per-model limits (1568 px/1.15 MP vs 2576 px/3.75 MP), and put the **instruction text before the image**.
- Use the **official `computer_20251124` tool type** to get prompt-injection classifiers for free — they do not run on custom tool definitions, and our computer-use surface handles untrusted screen content.

### R8 · Live view: WebCodecs over our existing WebSocket — not WebRTC, not JPEG
**Was:** "single-slot latest-wins JPEG frame coalescing + binary header."
**Now:** do that as the immediate fix, then upgrade to **CDP screencast → `VideoFrame` → `VideoEncoder` (VP9/H.264) in a worker → `EncodedVideoChunk` over the existing WS → `VideoDecoder` → `OffscreenCanvas`**, with `encodeQueueSize > 2` as the drop signal. `EncodedVideoChunk` is 10–100× smaller than the raw frame, encoding is hardware-accelerated and off-main-thread, and we keep one transport with no SFU/ICE/TURN. Selkies is the existence proof that WebSocket transport at 60 fps/1080p is viable.

**And one line that fixes our uncapped preview SSE today** (OpenMausBot `index.ts:261`):
```ts
replayBuffer.push({ seq, kind, frame: kind === "screen" ? null : frame })
```
Keep the sequence slot, drop the payload. Pair with **per-client subscription filters** (`?screens=off`) so a chat-only client never pays for CUA frames.

### R9 · Browser: hybrid a11y+box snapshots, page-ID routing, and a slim tool profile
**New.** Three changes that cut both token cost and CPU:
- Emit **hybrid snapshots** — a11y tree with per-element `[box=x,y,w,h]` viewport-relative CSS px (Playwright MCP's `--snapshot-boxes`). One representation serves deterministic selector clicking *and* coordinate-based CUA clicking, so we stop paying for a snapshot **and** a screenshot per step.
- **Stop auto-attaching a snapshot to every tool result** (`--snapshot-mode none` semantics). It is the dominant token cost in a browser loop.
- **Route concurrent browser agents through one Chrome via page-ID routing** rather than one browser per workspace (this is a cleaner version of our P1-26 "one Chromium, N contexts"), and enforce URL allow/blocklists **at the CDP layer** so subresources are blocked too.
- Screenshot codec default **WebP/JPEG with a server-side max-width**, never PNG — *"~3-5× smaller than PNG."*
- Consider KiroCrew's stronger position: **browser as a shell capability with an on-disk tree handoff** — ~250 chars of stdout (url, title, snapshot path) as the whole action result, tree read only if the agent asks. That removes browser tool schemas from every request entirely.

### R10 · Admission control: queue and publish, don't reject — and the lane predicate is free
**Was:** "reject with a typed retryable error (Codex `-32001`)."
**Now, refined:** reject for *control-plane* overload (a client hammering an endpoint), but **queue for agent work**, because *"a rejected turn loses the issue it was mid-way through, while a queued one only starts late."* Concretely: `MAX_BACKGROUND_TURNS = 4`, `CEIL = 16`, `wait_for(acquire, 1800s)` so the queue wait can't be misattributed to the turn timeout, **log at INFO on queue**, publish `{cap, running, waiting}` in `/api/health`. And the lane discriminator is one predicate: **attended turns bypass the cap; unattended work queues.**

Add **dynamic sizing from measured cost**: derive the cap from `min(mem_term, cpu_term)` clamped to `[floor, hard_cap]`, feed back per-run peak RSS/CPU, and **log which bound is active**.

### R11 · Thread/worker pools split by blocking class, with the anti-coupling rule
**Was:** implicit in "process isolation."
**Now explicit.** Node's own guidance and KiroCrew's converge: **CPU-bound and I/O-bound work must not share a pool**, and **the pool that recovers from a wedge must never be the pool that wedges.** Minimum split for us: `maintenance` (sweeps, reapers), `blockingTeardown` (PTY close, process kill, `taskkill`), `scan` (agent/skill discovery, `os.walk`-equivalents — browser-triggerable), `embed/network`. Plus a hard size cap and a **streaming fallback** on `JSON.parse`/`stringify` of tool results (50 MB = 0.7 s + 1.3 s of pure stall).

### R12 · Surface parity as a testable contract, not a convention
**New.** Three mechanisms, all cheap:
- **`TransportCapabilities` with an enforced honesty ledger** per surface (web / desktop / CLI / mobile / relay): `maxMessageChars`, `maxButtons`, `streaming`, `edit`, `supportsProactiveSend`, `supportsSessionResume` — each classified **ENFORCED** or **ASPIRATIONAL**, with a test that fails when a new field is unclassified, and defaults set to the most restrictive surface.
- **One `TurnDriver` + per-surface `Renderer`**, with the shared pipeline owning the `finally` that closes the renderer **before** releasing the session semaphore.
- **One prefix-stable, fence-aware markdown splitter** shared by every surface. Its streaming contract (*"re-splitting a longer prefix reproduces every chunk except the last one byte-for-byte"*) is strictly better than the "block-level streaming markdown" we proposed, because it gives the same property to mobile, CLI and channel adapters for free.
- Plus **shipped conformance suites as package exports** (Pi's `session/testing/conformance.ts` is 36.6 KB and exported): any new harness provider or storage backend runs the identical suite. Turns "does this adapter behave?" from a review question into a CI question.

---

# PART VII — Usability / UX findings worth shipping

These came out of the same research and are cheap relative to their perceived impact.

1. **A real context gauge and cost meter, on every surface.** ACP's `usage_update` → `{used, size, cost:{amount, currency}}` as a first-class stream event, not derived client-side. Web, CLI, mobile and desktop get the identical gauge with no duplicated token estimation.
2. **Tell the user when their idle gap cost money.** Pi's `cache-stats.ts`: `CACHE_TTL_MS = 5 min`, `NOISE_FLOOR_TOKENS = 1024`, miss = `min(prev.promptTokens, promptTokens) - usage.cacheRead`, priced at the *actually paid* rate from that message's own cost breakdown, attributed to `idleMs` / `modelChanged`, with a sticky `reportedCache` flag so providers that never report caching don't produce false positives. Surfaced on `message_end` as a notice. For an app running many concurrent long-lived sessions, cache misses are the dominant avoidable cost and today they are invisible.
3. **An Activity channel for gate cards and stage progress.** AG-UI's `ActivitySnapshot`/`ActivityDelta` (JSON Patch, typed by `activityType`). Our gate cards are neither chat messages nor global state, and forcing them into the message stream is why their chronology keeps breaking.
4. **`*Chunk` events with client-side Start/End synthesis.** Auto-open on a new ID, auto-close when the ID changes or the stream ends. Eliminates stuck spinners at the protocol layer instead of with client timeouts.
5. **Two-phase stop with a visible escalation.** KiroCrew's soft-stop: `soft_stop_budget_secs = 10.0` clamped `[0.5, 60]`; the client's grace must be `max(floor, callerBudget)` *"so a grace shorter than the caller's budget would make the loop bail first and force a session-losing hard kill even though the caller was still willing to wait"*; a **400 ms arming window** so a double-tap can't hard-kill; and a **15 s escape hatch** that re-labels the button **"Force reset"** when the kill itself stalls. Backend `_stop_state` is authoritative for "second press", never the client's echoed state.
6. **Restart-proof interactive widgets.** Encode `(sessionKey, transcriptTs)` base64url into the widget's own id and judge a click by comparing against the persisted transcript. Zero server state; a gateway restart cannot turn a superseded button back into a live one. Unparseable = cannot prove stale = honour it.
7. **Widget overflow degrades in shared code.** Keep the first `maxButtons` as widgets and render the remainder as a **numbered text list continuing the same numbering**, with a cross-surface contract test that fails any widget-capable renderer that skips the helper.
8. **Don't stream where streaming feels worse.** Telegram's "block streaming" lesson applies to our mobile app on a poor connection: a live typing indicator plus one clean final block beats a stuttering per-chunk edit. Make it a `TransportCapabilities` decision, not a hardcode.
9. **Capture failure is a permissions UX signal.** OpenMausBot counts consecutive empty frames and at `>= 3` shows *"No frames yet — the preview needs Screen Recording permission"* with an **Open Settings** button, because on macOS 15+ every pre-grant detection mechanism is unreliable and *"the one reliable path is the first real in-process capture."*
10. **Refuse honestly, and log the refusal.** Suppressed duplicate frames tell the agent *not* to retry. Blocked apps return the same shape as "no such app" so the blocklist can't be enumerated. And — KiroCrew's hard-won one — **log the decision NOT to act, at WARNING**; they had to diagnose an incident from the absence of a log line.
11. **Explainable startup.** Log which concurrency bound is active (`hard_cap | floor | mem_term | cpu_term`) and publish `{cap, running, waiting}`. "The fleet is throttled" and "a worker is hung" must not look the same in the UI.
12. **`fullRedraws`-style counters, surfaced.** A monotonic counter on every expensive fallback (full re-render, full context rebuild, cache miss, provider process restart, screencast fallback to polling), exposed in a debug panel and asserted in tests. It is the only non-flaky way to catch "someone made the fast path stop being taken."

---

# PART VIII — Revised roadmap

Phases 0–5 from the original review stand. These are the insertions and re-orderings.

### Phase 0 (unchanged, still first) — hours, ~11× on the token path
`verbose` gate, prepared-statement cache, drop the v1 `events` write, noise filter above `_doEmit`, retention TTL, missing index, `uncaughtException` handler, `DiffProviders` out of the root, `sessionId` out of `redact`.

**Add to Phase 0** (all one-liners, all from this research):
- Parent-PID heartbeat in every spawned child (`setInterval(() => { try { process.kill(ppid, 0); } catch { process.exit(); } }, 5000)`) — deletes the 24-orphan class permanently.
- `replayBuffer.push({ seq, kind, frame: kind === 'screen' ? null : frame })` — bounded preview buffer with honest gap detection.
- `screenshotEveryAction → false`.
- Instruction text **before** image in CUA turns.
- Screenshot codec → WebP/JPEG with a server-side max width.
- `unref()` audit on every long-lived timer.

### Phase 1 — streaming spine (revised)
Delta/item split and batched item writes **as written**, plus:
- **Pi's awaited-dispatch backpressure** instead of building a credit protocol (R1).
- **Strip cumulative snapshots at the serialization boundary only** (`toJsonEvent`).
- **Leading+trailing-edge coalescing that re-serializes at delivery time**, with a depth-counted suspend for bulk restores.
- **Stream-id-scoped cursors in the SSE `id:` field** + the `hello{resumed}` honesty flag + the client hydrate-after-hello / queue-frames-meanwhile boundary.
- **Per-client subscription filters.**
- **One prefix-stable, fence-aware splitter** shared by all surfaces.

### Phase 1.5 — **NEW: protocol adoption** (do this before Phase 2)
ACP adapter inbound and outbound; A2A task/contextId/artifact data model for run persistence; AG-UI event vocabulary internally for our own surfaces. This is small, and doing it *before* the process split means the process boundary is drawn on a stable contract rather than on our current ad-hoc events.

### Phase 2 — process isolation (revised)
- **Single-reader demux + process recycling** for the provider CLI (R2) — replaces the "pool vs priority lane" decision.
- pty host and computer-use driver out of process **as written**, plus the ACP client-provided terminal capability for the desktop surface (R4).
- **Pools split by blocking class** with the anti-coupling rule (R11).
- **Admission control that queues and publishes**, with the attended/unattended lane predicate (R10).
- **Two-layer wedge detector** (event-loop-delay monitor on a worker thread + `writeReport()` on trip + replay-the-dump-on-next-boot), and **poll a loop-turning endpoint, not the socket** (II.7).

### Phase 3 — native resources (revised)
As written, plus:
- CUA **descriptor model** + **fused act+observe** + `wholeImage()` + duplicate suppression + batched pruning + owned downscale (R7).
- **WebCodecs live view** with `encodeQueueSize` drop (R8).
- **Hybrid a11y+box snapshots**, page-ID routing, slim tool profile, CDP-layer URL policy (R9).
- **`terminalRecorder`-shaped scrollback** (`string[]` + `shift()`), 5 ms coalescing window, and a headless-xterm scrollback model in the pty host so memory is O(lines × cols).

### Phase 4 — frontend (revised)
As written, plus:
- **rAF-coalesced append-only rendering with a `startsWith` fast path** and a **word-rate buffer** (`MIN_RATE = 40`, `MAX_RATE = 2000`, `DEFAULT_RATE = 8`) rather than a fixed flush timer.
- **Visibility gating as a hard early-return**, not a flag check; hidden iframes **released** by default with retain as opt-in.
- Two-phase stop UX, Activity channel, `*Chunk` synthesis, context+cost gauge (Part VII).

### Phase 5 — durability & orchestration (revised)
As written, plus:
- **Step memoization**, **token streams out of the journal**, **Signal vs Awakeable vs promise**, **suspension**, and the four `interrupt()` rules as lint (R5).
- **A2A task immutability + Artifacts vs Messages + multi-stream broadcast** (R6).
- **Pi's durable program counter + effect sandwich + per-tool `replay: never|safe`** for stage/tool recovery (I.1).
- **Termination conditions as first-class** for orchestrator waves: time budget **and** convergence threshold **and** arbiter.

### Phase 6 — **NEW: guardrails**
- **Shipped conformance suites** as package exports for harness providers and storage backends.
- **`TransportCapabilities` honesty ledger** + the test that forces classification.
- **AST/lint tripwires**: no new sync-fs on the loop; no `.on('data', d => w.write(d))`; disposables registered at creation; layering rules that stop shared code importing Express/Electron/`better-sqlite3` (without this, nothing can move out of process cleanly).
- **Benchmarks beside the code** (`*.bench.test.ts`, `skipIf(!benchEnabled)`) for tokens/s through the spine, terminal MB/s end-to-end, browser fps at N sessions, time-to-first-token.
- **Counters on every expensive fallback**, asserted in tests.
- **Every tuning constant carries its measurement in a comment; every risky optimisation gets an env kill switch.**

---

# PART IX — Adopt / adapt / reject register

| # | Technique | Source | Verdict | Fixes |
|---|---|---|---|---|
| 1 | Persist at `message_end`, never per token | Pi `agent-session.ts:638` | **Adopt** | P0-1..6 (12.8 SQL/token) |
| 2 | Strip cumulative snapshots at the wire boundary only | Pi `json-event.ts:30` | **Adopt** | O(n²) IPC/SSE bytes |
| 3 | Awaited sequential dispatch + no-op drain subscriber | Pi `agent.ts:588`, `output-guard.ts:92` | **Adopt** | P0-7, P0-8 |
| 4 | Promise-tail serialization with `.then(noop,noop)` | Pi ×4 sites | **Adopt** | P1-5 global tx mutex |
| 5 | Per-key mutex map that deletes its own tail entry, in a `WeakMap` | Pi `file-mutation-queue.ts` | **Adopt** | P1-37 unbounded maps |
| 6 | Typed rejection (`Result<T, LaneBusy \| Closed>`) | Pi `agent-harness.ts:30` | **Adopt** | No admission control |
| 7 | Lanes: 3 registers, ≤1 operation, zero history copy | Pi `harness.md §2.3` | **Adopt** | Concurrent runs per session |
| 8 | Durable program counter + effect sandwich + `replay: never\|safe` | Pi `harness.md §0.3`, `§4.5` | **Adopt** | P0-41 lost automation work |
| 9 | Torn-tail repair (last line only) + atomic publish | Pi `jsonl/storage.ts:84` | **Adopt** | Append-only log durability |
| 10 | Fenced writer lease (fence++, steal only expired) | Pi `writer-leases.ts` | **Adopt** | Multi-surface DB writers |
| 11 | Fail all tool calls on `stopReason === "length"` | Pi `agent-loop.ts:186` | **Adopt** | Silent truncated-arg execution |
| 12 | Late-`onUpdate` guard | Pi `agent-loop.ts:664` | **Adopt** | Stuck/resurrected tool cards |
| 13 | Lazy provider modules behind a sync-returned stream | Pi `api/lazy.ts` | **Adopt** | Boot cost, P2-22 |
| 14 | Two-limit truncation record + spill-to-file path given to the model | Pi `truncate.ts`, `bash.ts:130` | **Adopt** | Unbounded tool output |
| 15 | Two-tier render scheduling (throttled data / preemptive input) | Pi `tui.ts:772` | **Adopt** | P2-55 CLI reconciles |
| 16 | `fullRedraws`-style counters asserted in tests | Pi `tui.ts:296` | **Adopt** | Fast-path regressions |
| 17 | Conformance suites shipped as package exports | Pi `session/testing/` | **Adopt** | Provider pluggability |
| 18 | Single-reader demux + recycle by age/RSS | KiroCrew `acp/runtime.py` | **Adopt** | P0-13 head-of-line |
| 19 | Six pools split by blocking class; recovery pool ≠ wedging pool | KiroCrew `executors.py` | **Adopt** | P1-30 libuv contention |
| 20 | Queue-don't-reject admission control + publish depth + INFO log | KiroCrew `state.py:3211` | **Adopt** | No admission control |
| 21 | Attended/unattended predicate as the lane discriminator | KiroCrew `state.py` | **Adopt** | No priority lanes |
| 22 | Leading+trailing coalescing, re-serialize at delivery, depth-counted suspend | KiroCrew `state.py:5569` | **Adopt** | O(N²) bulk restore |
| 23 | Prefix-stable, fence-aware splitter, one implementation | KiroCrew `messaging/split.py` | **Adopt** | P0-47, surface drift |
| 24 | `TransportCapabilities` honesty ledger + classification test | KiroCrew `transport.py:32` | **Adopt** | Surface parity |
| 25 | One `TurnDriver` + per-surface `Renderer`; pipeline owns the `finally` | KiroCrew `driver.py`/`dispatch.py` | **Adopt** | Duplicated turn loops |
| 26 | Streaming redaction with a rolling withhold buffer, after de-framing | KiroCrew `chat_runner.py:3758` | **Adopt** | Secrets split across chunks |
| 27 | Per-message edit lock with **interest counting** (not `locked()`) | KiroCrew `slack/outbound.py:66` | **Adopt** | Racing stream vs finalizer |
| 28 | Stale-widget tokens in the message, judged against the transcript | KiroCrew `slack/outbound.py:83` | **Adopt** | Restart-proof widgets |
| 29 | Evict by **settled-ness**, not age; exceed the cap rather than break correctness | KiroCrew `outbound.py:145` | **Adopt** | P1-37 done correctly |
| 30 | Two-layer wedge watchdog + replay-dump-on-next-boot | KiroCrew `loop_watchdog.py` | **Adopt** | No wedge attribution |
| 31 | Poll a **loop-turning endpoint**, not the socket | KiroCrew `gateway-liveness.js` | **Adopt** | Green badge, dead backend |
| 32 | "A detector must not be downstream of the failure it detects" + non-lethality bar | KiroCrew design note | **Adopt** | Watchdog design rule |
| 33 | Side-effect-free native import; sync/async split at module boundary | KiroCrew `computer_use/` | **Adopt** | P1-30 in-process NAPI |
| 34 | Nested deadlines (per-call **and** aggregate) for FFI walks | KiroCrew `snapshot_macos.py` | **Adopt** | Parked workers |
| 35 | Element cache `(session, window)` + hard-fail + monotonic TTL + drift check | KiroCrew `computer_use/index.py` | **Adopt** | Cross-session CUA corruption |
| 36 | Frame relay never re-captures | KiroCrew `screencast.py` | **Adopt** | Doubled capture cost |
| 37 | Protocol + shipped `Default*`; core never branches on implementation | KiroCrew `platform/interfaces.py` | **Adopt** | Provider `if` ladders |
| 38 | Generated config schema + checked-in baseline | KiroCrew `config/schema.py` | **Adopt** | Config surface drift |
| 39 | Post-`exec` limits, never `preexec_fn`; AST tripwire | KiroCrew `resource-protection.md` | **Adopt (rule)** | Spawn wedges |
| 40 | Delete-by-rename + append-only manifest | KiroCrew `session_storage.py` | **Adopt** | Slow/irreversible cleanup |
| 41 | Watermark flow control, ack **on parse completion**, batched acks | VS Code `terminal.ts:871`, `terminalInstance.ts:1679` | **Adopt** | P0-23, P1-27, P1-28 |
| 42 | Scrollback as `string[]` + `shift()`; better, headless xterm in the pty host | VS Code `terminalRecorder.ts`, `ptyService.ts:1032` | **Adopt** | P0-23 |
| 43 | `ThrottledWorker` (chunk / delay / buffer cap, `work()` returns false) | VS Code `async.ts:1391` | **Adopt** | Admission control primitive |
| 44 | `Limiter` / `ResourceQueue` / `LimitedQueue` / `Throttler` vocabulary | VS Code `async.ts` | **Adopt** | Ad-hoc `setTimeout` |
| 45 | rAF-coalesced append rendering + `startsWith` fast path + word-rate buffer | VS Code `chatIncrementalRendering/` | **Adopt** | P0-47 |
| 46 | Visibility gating as a hard early-return; hidden iframes released by default | VS Code `chatListRenderer.ts:1779` | **Adopt** | P1-50 |
| 47 | Parent-PID heartbeat in every child | VS Code `bootstrap-fork.ts:169` | **Adopt** | 24 orphaned CLIs |
| 48 | Both `uncaughtException` + `unhandledRejection`, logged, deregistered on dispose | VS Code, multiple | **Adopt** | P0-40 |
| 49 | Conditional restart predicate (`EMFILE`, single-request failure) | VS Code `watcher.ts:241` | **Adopt** | Restart loops |
| 50 | Ack-counter unresponsiveness; checker cancelled at zero outstanding | VS Code `rpcProtocol.ts:183` | **Adopt** | Thinking vs wedged |
| 51 | Freeze → sampled stacks → ≥20 % attribution, analysed off-thread, perf-baselined | VS Code `windowImpl.ts:1659` | **Adopt** | UI freeze attribution |
| 52 | Delayed DI; `onDid*` subscription doesn't construct; idle construction | VS Code `instantiationService.ts:298` | **Adopt** | Boot cost |
| 53 | Coalesce writes per tick, then **re-chunk at 256 KB** | VS Code `ipc.net.ts:268,498` | **Adopt** | Large tool-result stalls |
| 54 | `WebContentsView` + bounds; zero frames cross IPC | VS Code `browserView.ts:146` | **Adopt** | P1-33 20 fps fallback |
| 55 | `listView` virtualization (`relativeComplement` + `RowCache.transact` + `RangeMap`) | VS Code `listView.ts:908` | **Adopt** | P0-48 50-message cap |
| 56 | `measure`/`modify` rAF priority lanes (+10000 / −10000) | VS Code `dom.ts:500` | **Adopt** | Layout thrash |
| 57 | Emitter lazy wiring + leak detector (`dominated` vs `popular`, refuse at `threshold²`) | VS Code `event.ts:901,1008` | **Adopt** | P0-49, leak discovery |
| 58 | CUA descriptor model — server off the action path | OpenMausBot `cua.mjs:100` | **Adopt** | P1-29, P1-30 |
| 59 | Fused act + settle + capture, frame in the same tool result | OpenMausBot `computer-proxy.ts:686` | **Adopt** | Halves inferences per UI step |
| 60 | Far-end coordinate scaling from same-command geometry | OpenMausBot `computer-proxy.ts:180` | **Adopt** | Off-by-20 % clicks |
| 61 | `wholeImage()` terminator + length check, one-way latch | OpenMausBot `computer-proxy.ts:265` | **Adopt** | Grey half-frames |
| 62 | Duplicate-frame suppression + "don't retry" guidance | OpenMausBot `computer-observation.ts:118` | **Adopt** | ~1.2k tokens/frame |
| 63 | Screen frames keep sequence slots, drop payloads in the replay buffer | OpenMausBot `index.ts:261` | **Adopt** | P1-11 uncapped preview |
| 64 | Per-client stream subscription filters | OpenMausBot `index.ts:243` | **Adopt** | Fan-out cost |
| 65 | Stream-id-scoped cursor in the SSE `id:` field + `hello{resumed}` | OpenMausBot `index.ts:237` | **Adopt** | Resume correctness |
| 66 | Hydrate-after-hello, queue frames meanwhile, re-entrancy guard | OpenMausBot `store.tsx:1128` | **Adopt** | Snapshot/stream race |
| 67 | Credentials in a 0600 temp file, deleted on settle; never argv | OpenMausBot `claude.ts:384` | **Adopt** | Secrets in `ps` |
| 68 | `env -i` allowlist for agent-issued shell | OpenMausBot `computer-proxy.ts:107` | **Adopt** | Credential leakage |
| 69 | Cross-platform process-tree kill | OpenMausBot `procs.ts:70` | **Adopt** | Orphaned MCP proxies |
| 70 | Synchronous claim-before-await lease for exclusive resources | OpenMausBot `local-vm-lease.ts` | **Adopt** | Global semaphore of 1 |
| 71 | Identity-checked port acquisition (`{app,pid,static}`) | OpenMausBot `main.mjs:139` | **Adopt** | Dev/packaged port hijack |
| 72 | Capability negotiation as a pure, testable function | OpenMausBot `capabilities.cjs` | **Adopt** | Surface parity |
| 73 | Speak **ACP** inbound and outbound | ACP spec, Hermes, OpenHands | **Adopt** | Provider pluggability, cancel, permissions, terminal, usage |
| 74 | A2A **task immutability**, Artifacts vs Messages, multi-stream broadcast | A2A spec | **Adopt** | Retry model, reconnect loss, multi-surface |
| 75 | AG-UI **Activity** channel + `*Chunk` synthesis + `ReasoningEncryptedValue` | AG-UI spec | **Adopt** | Gate cards, stuck spinners, ZDR reasoning |
| 76 | Step memoization over deterministic replay; journal stage boundaries only | Inngest / Temporal limits | **Adopt** | P0-41; 51,200-event ceiling |
| 77 | Signal vs Awakeable vs workflow promise; suspension | Restate | **Adopt** | Steer-during-gate; idle gate cost |
| 78 | The four `interrupt()` rules as lint | LangGraph | **Adopt** | Duplicate side effects, exponential replay |
| 79 | Owned downscale + per-model limits + text-before-image + batched pruning + official tool type | Anthropic CUA docs | **Adopt** | Click accuracy, cost, injection classifiers |
| 80 | Hybrid a11y+box snapshots; `--snapshot-mode none`; page-ID routing; slim profile; CDP URL policy | Playwright / Chrome DevTools MCP | **Adopt** | Browser token + CPU cost |
| 81 | Cache browser actions on `(instruction, scoped subtree, options)` with variables; block third-party requests | Stagehand | **Adapt** | E2E determinism |
| 82 | WebCodecs over existing WS; `encodeQueueSize > 2` → drop; worker + OffscreenCanvas | WebCodecs / Selkies | **Adopt** | Live view CPU + bandwidth |
| 83 | File-locked port-range allocation; COW overlay mounts | OpenHands | **Adapt** | Concurrent sandboxes; worktree cost |
| 84 | Pause-not-kill sandbox lifecycle; `buffer_containers`-style warm headroom | E2B / Modal | **Adapt** | Cold start, idle cost |
| 85 | Profile isolation as the heavyweight concurrency unit | Hermes | **Adapt** | Failure containment |
| 86 | `stable → context → volatile` prompt tiers as a stated invariant | Hermes | **Adopt** | Cache invalidation |
| 87 | Import-time tool self-registration | Hermes | **Adopt** | "New tool missing on one surface" |
| 88 | Fresh agent with no history for scheduled runs | Hermes | **Adopt** | Automation context drift |
| 89 | Session lineage (parent/child) across compressions | Hermes | **Adopt** | Post-compaction auditability |
| 90 | Termination conditions: budget **and** convergence **and** arbiter | Anthropic multi-agent | **Adopt** | Non-converging waves |
| — | Unbounded per-session queue | KiroCrew ACP runtime | **Reject** | Bound it |
| — | PTY read on the default executor | KiroCrew `terminal.py:748` | **Reject** | Use the bounded pool |
| — | Polled still-frame "streaming" (3 s/4 s/6 s, base64→data URL) | OpenMausBot preview | **Reject** | Use screencast/WebCodecs |
| — | `docker exec` ×2 per frame returning full-res PNG | OpenMausBot local VM | **Reject** | Worse than our current path |
| — | `desktopCapturer.getSources()` on an interval | OpenMausBot `main.mjs:262` | **Reject** | Use `getDisplayMedia`/CDP |
| — | Two independent capture pipelines that don't share code | OpenMausBot | **Reject** | One module, one policy |
| — | JSON-file persistence with whole-thread rewrite per message | OpenMausBot `store.ts` | **Reject** | Keep the DB |
| — | Fire-and-forget `void (async()=>…)()` for turn dispatch | OpenMausBot `index.ts:690` | **Reject** | Supervised task runner |
| — | Runtime-status probe subprocess on **every** action with silent degradation | OpenMausBot `cuaOrX11()` | **Reject** | One contract per tool surface |
| — | `Promise.all` over unbounded model-emitted tool calls | Pi `agent-loop.ts:540` | **Reject** | Add `maxParallelTools` |
| — | Unbounded `EventStream` / sequential broadcast `await` loop | Pi `event-stream.ts`, `snapshots.ts:59` | **Reject** | Bound + per-client queues |
| — | Anything snapshotted at process birth and used hours later | KiroCrew xdist cap | **Reject (rule)** | Refresh at the use boundary |

---

## X. Closing

The first review said our problem is that **there is no layer that reasons about the subsystems together.** This research says something sharper: **every one of these five systems solved that by drawing a process boundary and a protocol boundary, and then making the boundary the only place coordination happens.**

- VS Code: utility processes + `MessagePort` straight to the renderer; main relays nothing hot.
- KiroCrew: a gateway that multiplexes nine surfaces onto a commodity runtime; six pools split by blocking class; admission control that queues.
- Pi: three stores, one write primitive, a durable program counter, lanes.
- Hermes: one `AIAgent`, platform differences at the entry point, process-per-profile.
- OpenHands: Action/Observation over a REST-mediated sandbox; one Canvas, N Agent Servers, ACP-mediated.

We currently have **no** process boundary and **no** protocol boundary. Everything coordinates by sharing one event loop, one DB connection, and one bag of in-memory maps.

The two highest-leverage decisions in this document are therefore not on the performance axis at all:

1. **Adopt ACP** (Phase 1.5) so the boundary has a contract before we draw it.
2. **Draw the boundary** (Phase 2) — provider demux, pty host, CUA descriptor — with clients talking to each host directly.

Everything else in Parts VI–IX is a well-evidenced detail hung off those two, and Phase 0 remains worth doing tomorrow regardless.
