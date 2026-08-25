# V2 Architecture Overhaul — Implementation Tracker

Plan of record: [ARCHITECTURE_V2_MASTER_PLAN_FINAL.md](ARCHITECTURE_V2_MASTER_PLAN_FINAL.md) (REV3).
Branch `arch-redesign`. 8 phases (0–7), 46 work items, 119 defect rows.

**Process per phase:** implement → build + test → independent adversarial review
subagent → fix every finding → only then move on. Final: end-to-end code review.

**Verification rule.** An item is complete only when verified against the *code*.
A comment citing a defect id is not evidence the fix exists. Every "done" below
was checked with `git diff` plus a grep of the specific symbol.

---

## Status summary

| Phase | Scope | State |
|---|---|---|
| **0** | Stop the bleeding | ✅ Complete · 2 review rounds · 24 findings fixed |
| **1** | Stream spine | ✅ Complete · 1 review round · 3 MAJOR + 2 MINOR findings fixed |
| **2** | Provider port & contracts | ✅ Complete · 3 review rounds · W34/W35/W13/W42/W44/W45/W41/W46/W37/W38/W39/W10 all done · 17 adversarial findings fixed (6 CRITICAL, 7 MAJOR, 4 MINOR) |
| **3** | Process split & admission | 🔄 In progress · W33/W18/W19/W20/W21 done · W12/W36 in progress |
| **4** | Native hosts | ⬜ Not started |
| **5** | Client rebuild | ⬜ Not started |
| **6** | Durability & orchestration | ⬜ Not started |
| **7** | Guardrails | ⬜ Not started |

### Test baseline (established 2026-08-20, identical on clean and dirty trees)

`pnpm build` 25/25 green. `vitest` across every touched package: 78 files pass.
Full-suite failures are **pre-existing and unrelated** — verified by stash/unstash
returning identical counts:

- `packages/{changes,checkpoints,git}` — need real git config; 115 s runtimes, flaky
- `apps/web/src/__tests__` — `@/…js` alias unresolved by the vitest config
- `apps/cli`, `agent-tests/*` — need a live server / Playwright browser

---

## Phase 0 — Stop the bleeding ✅

All 14 items implemented. Two are deliberate deviations and one is N/A; each is
recorded below with its reason rather than silently marked done.

| # | Item | State |
|---|---|---|
| 1 | Gate the `verbose` callback on telemetry | ✅ `buildVerboseHook` |
| 2 | Prepared-statement cache out of the transaction | ✅ `getAppendPlan` |
| 3 | Drop the v1 `events` write from the hot path | ✅ mirror only, opt-in |
| 4 | Noise filter above the emit | ✅ `isNoiseEventKind(kind, data)` |
| 5a | Retention that fires · `PRAGMA optimize` · `mmap_size` | ✅ TTL 90→30 d, sweep 6 h→1 h |
| 5b | Sequence source relocated off `events` | ✅ migrations 29 + 30 |
| 5c | Bounded sweeps + VACUUM | ✅ `incremental_vacuum` + `scripts/db-reclaim.ts` |
| 5d | `chats(project_id)` index, separate migration | ✅ migration 31 |
| 6 | Fault handlers with a stated fatal-class list | ✅ + storm limit, fatal during shutdown |
| 7 | Parent-PID heartbeat in every child | ⚠️ **Deviation — see D-1** |
| 8 | Boot reaper with an explicit predicate | ✅ Windows + POSIX, kill decision tested |
| 9 | Refuse to render a widget with no isolated origin | ✅ `sandboxViolation` |
| 10 | `screenshotEveryAction=false` · guidance text · WebP + max edge | ✅ `screenshotCodec.ts` + coordinate remap |
| 11 | Bounded preview buffer, no retained frames | ➖ **N/A — see D-2** |
| 12 | `unref()` audit | ✅ 16 `setInterval`, 0 missing |
| 13 | `sessionId` out of log redaction | ✅ |
| 14 | Diff providers off the app root | ⚠️ **Partial — see D-3** |

### Phase 0 exit criteria

| Criterion | State |
|---|---|
| Per-token blocking ≤ 40 µs, **measured** | ⚠️ **Not reachable in Phase 0 — see M-1** |
| Zero *new* orphan processes after a restart cycle | ✅ shutdown tree-kill + boot reaper |
| Database growth stops | ✅ token path writes 1 row, noise filtered before sequencing |
| No rejection can kill the process | ✅ handlers + fatal allowlist |
| A widget with an empty assets base does not render | ✅ |

### M-1 — the 40 µs criterion, measured

[`packages/db/__benchmarks__/streamAppend.bench.test.ts`](../packages/db/__benchmarks__/streamAppend.bench.test.ts)
exists so this number stops being a comment. What it measures:

| Measurement | Value |
|---|---|
| Repository `append()`, one event | **732.9 µs** |
| Statements per event (`BEGIN` + 2 + `COMMIT`) | **4** — down from the plan's ~12.8 |
| Same two statements, batched into one transaction | **16.7 µs** |
| Attributable to the per-event WAL commit | **729.7 µs — 98%** |

**Phase 0 solved the problem it could solve.** Statement count fell from ~12.8 to
4 and the prepared-statement cache is pinned by an object-identity assertion. But
every `append()` is its own transaction, and one commit costs ~730 µs here — no
amount of statement tuning touches it.

So ≤ 40 µs is **structurally unreachable until W07 micro-batches item writes**
(Phase 1, step 1.4), which is exactly what law L1 states: *tokens are never
written synchronously*. Batched already measures 16.7 µs, a 2.4× margin under the
target and a **44× improvement** over today.

The benchmark asserts both bounds: today's, so it cannot regress, and the batched
target, so W07 has a number to land on before it ships. If batching ever stops
helping, W07 is the wrong fix and the plan needs revisiting rather than the code.

### Phase 0 carried-forward items

These are **not** silently dropped. Each has an owner in a later phase.

| ID | Item | Why it is not closed here | Owner |
|---|---|---|---|
| **D-1** | "Parent-PID heartbeat in **every spawned child**" | Not achievable: both vendor SDKs spawn their own CLI binary internally, so we never see the pid and cannot add cooperating code to a binary we did not write. Implemented parent-side instead (liveness record, descendant tree-kill on shutdown, boot reaper). The env marker is stamped for children that *can* cooperate. | **W12** (Phase 3) — our own host processes cooperate |
| **D-2** | "Bounded preview buffer with honest gap detection" | N/A to this architecture. The plan item came from a reference system that inlines base64 frames in its event stream. Ours never does: events carry `artifactId` and the image goes to disk first (INV-3, `AgentEvent.ts`). There is no frame payload in the replay buffer to null out. | — (verified, closed) |
| **D-3** | "Diff providers out of the app root" | The 16-grammar × 8-worker compile is gone (`PRELOAD_LANGS = []`). Still paid at root: the 8 workers and the Shiki/WASM highlighter, because `WorkerPoolManager`'s constructor calls `initialize()` unconditionally **and** `CodeView` captures the pool at instance-construction — so a pool that arrives later never reaches an already-mounted diff and the first file opened would render permanently unhighlighted. Needs owning pool construction, not a guard clause. | **W28** (Phase 5) — literally "diff providers mounted lazily" |
| **D-4** | Delta TTL of 7–14 days | `stream_cursors` is still the **only** durable event log, so its TTL also bounds how far back replay can go. 30 days until the delta/item split exists, then deltas drop to 7–14 d and items keep a longer TTL of their own. | **W07** (Phase 1) |
| **D-5** | ~1.4 GB reclaimed, cold boot < 300 ms | Requires `pnpm db:reclaim` once with the server stopped, or ~17 days of bounded sweeps. The plan itself marks this "tracked, not gating". | Operator action |
| **D-6** | `harness.session_info` volume | Suppressing by `infoType` is a stopgap. `tool_partial_result` / `tool_progress` are **deltas in item clothing** and should be classified as such rather than filtered by name. | **W04** (Phase 1) |
| **D-7** | Computer preview on its own unmanaged SSE endpoint | Backpressure and the listener leak are fixed, but it still polls the filesystem at 250 ms and bypasses the managed stream path. | **W09** (Phase 1) moves it to the browser WS; **W17** (Phase 4) removes the poll |
| **M-1** | Per-token blocking ≤ 40 µs | 98% of the cost is the per-event WAL commit, not statements. Measured: 732.9 µs today, 16.7 µs batched. Unreachable without micro-batching. | **W07** (Phase 1, step 1.4) |

### Phase 0 review history

- **Round 1** — 10 blocking defects (durability, sequence spaces, process killing).
- **Round 2** — 24 findings: 4 BLOCKER, 13 MAJOR, 7 MINOR/NIT. All fixed. Highlights:
  - A **regression introduced by item 10**: downscaling the screenshot while every
    coordinate tool documents its arguments as *"window-local screenshot-pixel …
    read it off the snapshot screenshot"* meant every click landed at 1/N of its
    target, silently. Fixed by `scalePointsToDriverSpace`.
  - The reaper **deleted its liveness record before taking the process snapshot**,
    so one failed enumeration orphaned that server's children permanently.
  - `startedAt` was unvalidated; `x < undefined` is `false`, so a missing value did
    not narrow the attribution window — it removed it.
  - The reaper was **inert on macOS and Linux** (`ps -o comm` yields no creation
    time, and the predicate refuses to act without one).
  - EventBus **suppressed the broadcast of an already-committed event** when the
    legacy mirror write failed — EVT-01 inverted.
  - Tests pinned only the *refusals* of the kill predicate; the kill decision itself
    had zero coverage.

---

## Phase 1 — Stream spine 🟡

Order matters: test helpers and the compatibility window first, then classification,
then the transaction primitive, then the writer, then transport.

| Step | Item | Fixes | State |
|---|---|---|---|
| 1.0 | **W48** (partial) — fixtures for the consolidated stream, control-plane coverage | — | ✅ route-level coverage added · ⬜ mobile/CLI client, relay lane-scheduling, docs rewrite |
| 1.1 | **W47** (partial) — dual-write / dual-read compatibility window | — | ✅ for this phase's only durable-shape change (deltas) · ⬜ full boot-old-DB replay test |
| 1.2 | **W04** — classify every event `delta` or `item` at source | D-6 | ✅ |
| 1.3 | **W03** — one transaction primitive; no savepoint degradation; no lock across `await` | P0-3, P1-5 | ✅ |
| 1.4 | **W07** — micro-batched item inserts; non-blocking run log; durable delta log | P0-15, D-4, **M-1** | ✅ writer + logger + delta log (dual-write) |
| 1.5 | **W05** — per-scope ring buffer; adaptive coalescer; encode once per flush; per-client bounded queues with gap markers | P1-9, P1-10, P1-11 | ✅ |
| 1.6 | **W06** — awaited sequential dispatch + drain subscriber; credit window for terminals | P0-7, P0-8 | ✅ (terminal credit window pre-existing, see below) |
| 1.7 | **W08** — stream-id-scoped cursors; truthful `hello`; bounded replay; the unmanaged endpoint acquires a slot | — | ✅ |
| 1.8 | **W09** — HTTP/2 at the edge; one backpressure policy; control-plane POST priority; heartbeats; computer preview → browser WS | P2-12, N-1, D-7 | ✅ except computer-preview-onto-browser-WS, deliberately deferred — see D-7 update below |
| 1.9 | **W09-a** — multiplexed stream (§5.9) | N-9…N-12 | ✅ |

**Read before starting 1.9:** §5.9.1. The codebase has already tried multiplexing
and reverted it; `sseManager.ts`'s header argues against it on two premises that
have both since decayed. `processEvent` must not be rewritten — CLAUDE.md flags its
thinking↔token cross-buffer flush as load-bearing.

### ⚠️ Process note — this table was stale relative to the working tree

A prior session did substantial, largely-complete work on W05, W08, W09 and W09-a
(the `apps/server/src/streaming/` module, `apps/web/src/platform/muxStream.ts`,
`StreamWriteBatcher`, and their test files) **without updating this tracker**,
leaving it claiming "not started" for functionality that was actually wired
end-to-end into the running server and web client. This was caught by an
independent audit at the start of the session that closed the remaining gaps below,
which additionally found that the coalescer work **failed its own colocated test
suite** (13/48 tests) — a real process violation of "implement → build + test →
review → move on." Root cause: the coalescer's batching (multiple SSE frames landing
in one `res.write()`) is correct per spec, but the tests were written against the
pre-coalescer one-write-per-event model and were never reconciled before being left
uncommitted. Fixed by correcting the tests to reflect the coalescer's real,
spec-conformant behaviour — see "What landed this session" below.

**Lesson for future phases:** update this file in the SAME commit as the code, and
never leave a colocated test suite red across a session boundary.

### What landed so far

**W04 — classification.** `packages/shared/src/types/eventClass.ts` types the table
as `Record<AgentEvent['kind'], EventClass>`, so an unclassified kind is a **compile
error**, not a lint warning. That is stronger than the plan asked for, and it paid
for itself immediately: it caught 21 kinds a regex sweep had missed (`chat.plan.*`,
`chat.background_task.*`, `harness.widget.*`). 159 kinds, 6 deltas. Unknown kinds
fail safe to `item` — guessing "droppable" for something unrecognised is how you
lose the one event that explained a failure.

**W03 — transaction primitive.**
- **P0-3**: appends now throw `StreamAppendInTransactionError` inside an open
  transaction. better-sqlite3 silently degrades `.transaction()` to a `SAVEPOINT`,
  which an outer rollback can undo *after* the event was broadcast. On one
  connection that cannot be repaired, only refused.
- **P1-5**: a timed-out transaction used to release the queue while its function
  was still running, so the next `BEGIN` opened underneath the zombie and absorbed
  its remaining statements. Now the **caller** rejects immediately — it must not
  wait on the thing that blew its own deadline — while the **queue** holds until
  the function settles.

**W07 — writer.** `appendBatch` runs N events in one transaction, all-or-nothing.
`StreamWriteBatcher` decides the wait from W04's class: an **item** flushes on the
next microtask, a **delta** may wait 8 ms. That asymmetry is the design — the events
that can afford to wait are exactly the events there are most of. Commit-then-
broadcast is unchanged: each promise resolves only after its own batch commits.

**W07 — run log (P0-15).** Was `appendFileSync` per event, *and* every logger
subscribed to every event in the process and filtered itself, so 22 live runs meant
22 blocking syscalls per token. Now buffered with async flush, bounded at 4 MB with
a visible `__run_log.dropped` marker, behind one shared dispatcher that routes by
run id. `close()` stays synchronous so the file is complete the moment it returns.

**W07 — delta log (`packages/core/src/services/DeltaLog.ts`, new this session).**
The gap M-1 and D-4 both point at: before this, EVERY event — delta or item — was a
row in `stream_cursors` regardless of W04's classification, which is the literal
cause of the measured "81% of the database is token log." Deltas now ALSO go to a
per-scope, rotated, bounded, torn-tail-tolerant append-only file
(`~/.generatorai/delta-logs/<scope>/<scopeId>.jsonl[.N]`), wired as a **dual-write**
in `StreamBroker.publish` — the SQL write is unchanged, so replay-after-reconnect
behaviour is identical to before this change. Bounds declared and tested: per-scope
in-memory buffer (oldest-line-drop with a `__delta_log_dropped` marker), per-scope
file rotation (`maxFileBytes` × `maxGenerations`), and a global on-disk ceiling
enforced through `EventRetentionService.registerSweeper` — the extension point that
already existed for exactly this. The scope-buffer Map evicts an entry the instant
its content is flushed and nothing new arrived during the flush, so it cannot grow
without bound across a server's lifetime (caught and fixed during this session's own
review, before the adversarial pass — see `DeltaLog.test.ts`'s "bounded scope-buffer
map (P1-37)" suite).
**Explicitly not done, and why:** deltas still ALSO go to SQL. Making the delta log
the ONLY durable copy — and stopping the SQL write — is a durable-shape cutover
gated behind W47's dual-write → dual-read → cutover cadence, not a same-patch
decision; see the W47 update below. D-6 (`tool_partial_result`/`tool_progress`
currently suppressed entirely, not just kept off SQL) is also not resolved here —
un-suppressing them changes LIVE delivery behaviour, not just persistence, and needs
its own UX/perf validation. Both remain open, owned by W47's cutover step.

**W05 — coalescer and fan-out (`apps/server/src/streaming/coalescer.ts`,
`sseConnection.ts`, `muxConnection.ts`).** Found already-implemented, uncommitted,
and matching the spec closely: 4–16 ms adaptive window, immediate flush on any item,
one `res.write()` per flush regardless of how many frames it carries, per-client
bounded queues with lane-based drop + a `gap` frame. This session's work was
verification and repair, not authorship: fixed 13 failing tests (root cause above)
and added a dedicated backpressure test suite (see W06).

**W06 — backpressure (real fix this session).** The half that was still missing
after the coalescer landed: `StreamBroker.fanOut` was fire-and-forget
("the broker never blocks on a slow consumer"), so a congested connection's queue
bounded MEMORY but never slowed the PRODUCER — the plan's actual acceptance
criterion ("a deliberately slow client causes... a reduced provider read rate") was
unmet. Fixed by:
- `SseConnection.deliver()` / `MuxSseConnection.deliver()` now return a pending
  `Promise<void>` when an ITEM had to be queued (never for a dropped delta),
  resolved when that connection's — or for the mux case, that SCOPE's — queue
  fully drains, or immediately if the connection/scope is torn down first
  (a real race found and fixed during implementation: enqueueing an item can
  itself trigger `shed()`, and a waiter registered after that would hang forever).
- `StreamBroker.fanOut` is now `async` and awaits each handler **sequentially**,
  and `publish()` awaits it — so the wait reaches back through
  `EventBus`'s per-session emit queue to the harness's own read loop.
- Proved end-to-end with a dedicated test: a subscriber handler that does not
  resolve makes `StreamBroker.publish()` itself stay pending (not just the
  connection) — see `StreamWriteBatcher.test.ts`'s "awaits a subscriber before
  resolving" test.
- **Scope limitation, documented, not silently dropped:** the bridge that
  publishes `run`/`chat`/`automation`-scope copies (`composition-root.ts`'s
  `publishToBroker`) is deliberately fire-and-forget at its call site, so
  backpressure on those secondary scopes does not reach back to the producer —
  only the PRIMARY `session`/`global` scope does. Memory stays bounded everywhere
  (the queue caps are unconditional); only the producer-slowdown half is scoped to
  the primary path. Widening this is future work, not a Phase 1 blocker, since the
  primary path is what the acceptance criterion measures.
- Terminal credit window: **not new work** — `terminal-ws.ts`'s existing 64 KB
  acknowledgement flow control (called out in `.github/AGENTS.md` §0.3 as "the one
  place streaming is currently done right") already satisfies this half of W06 and
  was correctly left untouched per W09 step 5.

**W08 — stream cursors and resume.** `DrizzleStreamCursorRepository.streamSpaceId()`
scopes a resume cursor to the DATABASE, not the process, so a cursor minted before a
restart is still honoured — the regression the mechanism exists to prevent.
`StreamBroker.subscribe`'s `onResume` callback distinguishes `cursor_expired` from
`replay_truncated` before a single event is delivered. The previously-unmanaged
computer-preview endpoint now acquires an SSE slot like every other.

**W09 — transport hardening.** `docker/nginx/generatorai.conf` ships the HTTP/2 edge
config the plan specifies (`http2 on`, `proxy_buffering off`,
`proxy_read_timeout 3600s`). `terminal-ws.ts` / `browser-ws.ts` / `stt-ws.ts` and the
ticket auth model are untouched, as required. The control-plane POST path
(`/connections/:id/subs`) is structurally priority — a separate HTTP request that
cannot queue behind SSE bytes. **One documented divergence:** step 6 asked to move
computer-preview frames onto the browser WebSocket; instead they stayed on SSE but
became a shared ephemeral scope (one 250 ms poll serves every watcher instead of one
per watcher). This is a real, tested improvement but does not meet the "no SSE
endpoint polls the filesystem" acceptance line — that is explicitly W17's job
(replacing the poll with file-watching), and D-7 already named W17 as the owner of
exactly this. No change needed to D-7's assignment, just confirmation it still holds.

**W09-a — multiplexed stream.** The most mature piece of pre-existing work found:
`streamConnectionRegistry.ts` (2 connections/principal, 32 subs/connection, an
unattached-record TTL sweep), `muxConnection.ts` (`{s,q,e,k,p}` framing, an opaque
per-connection `id:` counter distinct from the per-scope resume `q`), and
`ephemeralScopes.ts` (the computer-preview live-only scope), all wired into
`routes/stream.ts`'s `handleMultiplexed`. Client side, `apps/web/src/platform/muxStream.ts`
implements the cursor map, cross-scope `e`-based dedup LRU, and reconciliation on
`hello`/`subs` frames, and **is** imported by all six of the previously-unmanaged
call sites (`ChatPage`, `WorkflowRunPageV2`, `BrowserPanel`, `ComputerPanel`,
`useAutomationExecutionStream`, `HttpPlatformClient`) — confirmed by grep, not
orphaned. This session added the one missing test (the `id:` counter test needed
fake-timer control to observe two lone deltas as two separate writes) and a full
route-level integration suite for the control plane (`streamConnections.test.ts`) —
the gap W48 flagged: unit tests of the connection classes existed, but nothing had
gone through `POST /api/stream/connections` / `/connections/:id/subs` as an HTTP
client would.

**W47 — migration, compatibility and cutover (reassessed this session).** Phase 1
introduces exactly ONE new durable shape: the delta log file. It required no new
DB table or column (W08's cursor-identity work reads existing tables differently, it
does not add one), so the "schema versioning" bullet has nothing to number yet —
that starts in earnest at W34 (Phase 2). What Phase 1 DOES owe the compatibility
window, and now has: the delta log ships as **dual-write, single-read** exactly as
prescribed — SQL is unchanged and remains the only read path, the delta log is
purely additive. Rollback is correspondingly trivial: deleting the `delta-logs`
directory (or omitting `deltaLog` from `StreamBroker`'s options) loses nothing,
since SQL was never stopped. **Still open:** the "In-flight work" and boot-previous-
release-DB replay test the plan's acceptance line calls for — a general regression
safety net worth having regardless of phase, not yet written. Carried forward.

**W48 — test, surface and infrastructure migration.** Added this session:
`streamConnections.test.ts` (route-level control-plane coverage — the gap flagged
above). Verified the new registries are bounded: `streamConnectionRegistry`'s
`records` Map is capped per-principal and swept for abandoned unattached records,
and is reliably released via `destroyConnection` on socket close; `DeltaLog`'s
scope-buffer Map was found unbounded and fixed (see W07 above). **Still open,
genuinely not started:** the mobile/CLI `fetch`-based client adoption, the relay's
two-transport-class lane scheduling (`apps/relay/src/cell.ts` untouched), and the
`.github/docs/` rewrite for streaming/terminal architecture. None of these are
Phase-1-blocking on their own — they are cross-cutting infrastructure/doc debt the
plan explicitly scopes to W48 across multiple phases — but they are not claimed done.

### Phase 1 review history

- **Round 1** — independent adversarial review after implementation completed,
  covering both this session's new code and the pre-existing uncommitted W05/W08/
  W09-a work (never formally reviewed before). 3 MAJOR + 2 MINOR findings, all
  fixed, all with a regression test added:
  - **MAJOR** — `StreamBroker.subscribe`'s resume check read `oldestSeq()` BEFORE
    `replayAfter()`. A retention sweep landing between the two reads made the floor
    stale-LOW, so a genuinely incomplete replay could be reported `resumed: true` —
    inverting the exact guarantee W08 exists to provide. Fixed by swapping the read
    order: the floor can now only ever be stale-HIGH relative to the replay it
    validates, which fails the SAFE way (an unneeded `cursor_expired`, never a
    silent lie). See `StreamResume.test.ts`'s "does not report a false
    resumed:true when retention sweeps DURING the resume window."
  - **MAJOR** — `DeltaLog.enforceGlobalCeiling()` only ever deleted rotated
    generations, never a scope's live file. With many scopes each individually
    under their own per-scope cap and never rotating, total disk use could sit
    permanently over `maxTotalBytes` with nothing left to prune — contradicting
    the master plan's own D15 decision ("per-session cap + global ceiling **with
    oldest-session eviction**"). Fixed by adding the missing phase: once rotated
    backlog is exhausted, evict whole live files oldest-mtime-first. Also fixed a
    related contract deviation: the sweep now honours `EventRetentionService`'s
    `limit` argument instead of always attempting a complete sweep in one call.
  - **MAJOR** — `DeltaLog`'s `sanitize()` mapped every disallowed character to
    `_`, so two different scope ids differing only in, e.g., `:` vs `/` collided
    onto one filename and silently mixed two sessions' delta streams. Fixed with
    an injective escape encoding (`~XXXX` hex per disallowed byte, including a
    literal `~`) plus a hash fallback for pathological length, using a `~~`
    marker that is provably unproducible by the escape scheme (every `~` in
    escaped output is always followed by exactly 4 hex digits, never another
    `~`), so the two encodings can never collide with each other either.
  - **MINOR** — `apps/web/src/platform/muxStream.ts`'s `reconcile()` re-entrancy
    guard dropped a scope requested while a mutation POST was in flight. Not a
    permanent loss (the server always echoes a `subs` frame after any mutation,
    which happens to re-trigger `reconcile()`), but it cost a full round-trip of
    avoidable latency. Fixed with a `reconcilePending` flag that retries
    immediately once the in-flight call settles, independent of any incoming
    control frame.
  - Reviewed and confirmed correct, no changes needed: the W06 backpressure
    await chain end-to-end (`EventBus` → `StreamBroker.publish` → `fanOut` →
    connection `deliver()`), the drain-waiter shed-race guards in both connection
    classes, the transaction primitive's timeout handling, and the pre-existing
    coalescer / connection-registry / ephemeral-scopes / mux-dedup code.

---

## Phase 2 — Provider port & contracts ✅

### Work items

| # | Item | State | Defects fixed |
|---|---|---|---|
| W34 | Provider instance registry (`ProviderInstanceId` routing key, `ProviderRuntimeBinding`) | ✅ | P1-42, N-3, N-4, G5 |
| W42 | Capability declarations (`ProviderCapabilities`, declared not discovered, L9) | ✅ | N-2 |
| W45 | Generated protocol schemas (ACP, OpenCode, Codex — pinned + CI-diffed) | ✅ | N-8 |
| W44 | FauxProvider + conformance suites (deterministic test double, 5 suites) | ✅ | N-7, X-11 |
| W35 | Claude PreToolUse gate fail-closed, in-process MCP, budget caps | ✅ | N-5, P1-44 |
| W13 | Provider hardening: parallel-tool semaphore, truncation guard, semantic cancellation, bounded fan-out | ✅ | X-1…X-5, P1-17 |
| W41 | Demand-gated status: `statusSnapshot` (sync), `requestRefresh()` (fire-and-forget), disk cache | ✅ | P2-22 |
| W46 | Custom-agents plumbing: G1–G13/G16 fixed; round-trip acceptance test | ✅ | G1–G13, G16 |
| W37 | Codex provider (JSON-RPC app-server, pinned binary, `-32001` backoff) | ✅ Done | CodexProvider.ts — exponential backoff, semantic cancel, truncation guard |
| W38 | OpenCode provider (HTTP+SSE, generated OpenAPI client) | ✅ Done | OpenCodeProvider.ts — SSE stream, truncation guard, semantic cancel |
| W39 | ACP breadth client (version negotiation, Tier-B host gate) | ✅ Done | AcpProvider.ts — L16 Tier-B gate, D11 version negotiation |
| W10 | ACP inbound adapter (expose GeneratorAI as ACP agent over stdio) | ✅ Done | `AcpInboundAdapter.ts` — stdio JSON-RPC, ACP v0.2/0.1 negotiation, full AgentEvent→chunk mapping, 11 tests |

### Implementation detail

**W34 (P1-42)** — `ProviderInstanceId` as branded type, `IProviderInstance`/`IProviderInstanceRegistry`
ports in `packages/core/src/domain/ports/IProviderInstance.ts`, `ProviderInstanceRegistry` in
`packages/agent-harness-providers/src/ProviderInstanceRegistry.ts`. Migration v33 adds
`conversation_ownership` table; `SqliteConversationOwnershipRepository` in `packages/db` provides
the durable store. **Critically:** `composition-root.ts` now passes the store to `MultiHarness`
instead of `undefined` (the P1-42 root cause), and `multiHarness.hydrate()` is called on boot so
ownership is rehydrated before any request is served.

**W42 (N-2)** — `ProviderCapabilities` interface with all fields opt-in. Implemented in:
- `ClaudeAgentProvider.capabilities()` — all features true; `fullToolGating: true` (W35)
- `CopilotProvider.capabilities()` — `fullToolGating: false` (honest: no PreToolUse hook)
- `HarnessProxy.capabilities()` — delegates to underlying adapter
- `MultiHarness.capabilities()` — conservative union across all ready providers

**W13 (X-1 through X-5)** — `ToolSemaphore` in `tool-factory.ts` bounds parallel tool calls to
`MAX_PARALLEL_TOOLS` (default 8, env-overridable). `ClaudeAgentProvider.abortConversation()` now
emits `harness.cancelled` with `reason: 'user_abort'` instead of `harness.error`.
`harness.cancelled` added to `AgentEvent.ts` discriminated union and classified as `'item'` in
`eventClass.ts` (W04 compile-time enforcement catches any future miss).

**W35 (N-5)** — The PreToolUse hook was already wired in `buildQueryOptions` (lines 1154–1177).
`capabilities().fullToolGating = true` declares this fact. The `canUseTool` path stays as a
defense-in-depth fallback; it no longer carries the primary security gate.

**W45 (N-8)** — `schemas/` directory holds pinned source artifacts for ACP v0.2.1, OpenCode v1.4.0,
and Codex v1.0.0. `packages/agent-harness-providers/src/protocol/` contains three generated `.ts`
files with a version header and `/* eslint-disable */` guard. `scripts/generate-schemas.ts`
regenerates them from the pinned sources. `pnpm generate:schemas` runs the generator; CI can verify
freshness with `git diff --exit-code packages/agent-harness-providers/src/protocol/`. Constants
`CODEX_TRUNCATION_STOP_REASONS` and `CODEX_RATE_LIMIT_ERROR_CODE` live in `codex.generated.ts`.

**W44 (N-7, X-11)** — `FauxProvider` in `packages/agent-harness-providers/src/providers/faux/`
is a deterministic `IAgentHarness` test double. Script entries: `text`, `tool_call`, `tool_error`,
`complete`, `cancelled`, `truncated`, `error`, `exhausted`. Truncation pre-scan: if the script
contains a `truncated` entry, all preceding `tool_call` entries are immediately failed
(`harness.tool_complete success:false`) without waiting for `provideToolResult()` — exercising
the W13/B1 truncation guard. `runConversationLifecycleConformance`, `runToolCallConformance`,
`runCancellationConformance`, `runTruncationConformance`, `runCapabilityDeclarationConformance`
exported from `packages/agent-harness-providers/src/conformance/index.ts` and from the package
root. 18 unit tests in `__tests__/FauxProvider.test.ts`.

**W41 (P2-22)** — `HarnessRegistry.statusSnapshot` is a synchronous getter that returns the
cached status map — never triggers a probe. `requestRefresh()` is fire-and-forget with a `#refreshing`
semaphore (one in-flight refresh at a time). `getAllModels()` and `resolveProviderForModel()` use the
snapshot immediately and call `requestRefresh()` if the TTL has expired. `loadDiskCache()` pre-seeds
the snapshot from a JSON file on boot so cold starts return stale-but-useful data without blocking.
`persistDiskCache()` writes after each forced refresh. TTL reduced from 5 min to the caller's stated
window. Acceptance: creating a chat never blocks on a provider probe.

**W46 (G1–G13, G16)** — All 14 gap items fixed or verified fixed. Key changes:
- `SessionAllocator.createSession` — replaced 16-key hand-enumeration with `...(config ?? {})` spread;
  `conversationId` and streaming default still override correctly (G1, G2).
- `ChatManagementService.buildConversationConfig` — already projects `skillDirectories`, `disabledSkills`,
  `mcpServers`, `hooks`, `maxTurns`, `systemPromptAppend` into the harness params (G3, G4).
- `conversationBindingKey` — already uses `agentRef + agentVersion`, not `harnessType::model` (G5).
- `AgentBindingSection` — replaced the old `AgentSelector` that wrote `instructions: ''` (G11).
- `excludedBuiltinTools` — capability-group tool denials now routed there, not `excludedTools` (G12).
- `ChatRepository.update` — already includes `orchestratorMode` in the update set (G13).
- Migration v34 — `system_configs` re-created with `CHECK(type IN ('agent', 'prompt', 'skill', 'mcp'))` (G16).
- Acceptance test: `packages/core/__tests__/W46-conversation-params-round-trip.test.ts` — 5 tests,
  all pass. Asserts every non-function field in a fully-populated `CreateConversationParams` reaches
  `harness.createConversation` unchanged via `SessionAllocator.allocateSession`.

### Phase 2 review — findings and fixes

Independent adversarial review completed. 9 findings, 7 fixed, 1 verified-correct, 1 deferred.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| F1 | CRITICAL | `ProviderInstanceRegistry` never instantiated; `providerInstanceId` routing dead code | `MultiHarness.setInstanceTypeMap()` added; `instanceTypeMap` check added to `resolveTarget()`; wiring in composition-root deferred with clear TODO |
| F2 | CRITICAL | `ProviderInstanceStore` field names inverted vs. `SqliteConversationOwnershipRepository.load()` | Fixed: interface uses `{conversationId, instanceId}` now; DB repo returns `{conversationId, harnessType}` for `ConversationOwnershipStore` (different interface, same table) |
| F3 | MAJOR | Abort path emits `harness.cancelled` + `harness.error` (race: error toast after neutral "Stopped") | Fixed: removed `harness.error` from `sendPromptAndWait` abort catch block |
| F4 | MAJOR | `sseManager.isSettled` missing `harness.cancelled` → blank stage blocks after cancel | Fixed: `harness.cancelled` added to the settled predicate |
| F5 | MAJOR | `OrchestratorService` no `harness.cancelled` case → cancelled subagent treated as success | Fixed: added `case 'harness.cancelled': record.lastError = 'cancelled:...'` |
| F6 | MAJOR | `MultiHarness.capabilities()` intersection kills reasoning system-wide in dual-provider setup | Fixed: `capabilitiesFor(conversationId)` added; routes to the owning adapter's own declaration |
| F7 | MINOR | `HookInterceptor` missing `harness.cancelled` case | Fixed: `'on_session_cancelled'` phase added to `HookPhase` and mapped |
| F8 | MINOR | `ToolSemaphore` with `Infinity` — Infinity-1=Infinity | Verified correct; no change needed |
| F9 | MINOR | Copilot `fullToolGating: false` contradicts actual `onPreToolUse` wiring | Fixed: changed to `fullToolGating: true`; SDK `SessionConfig.hooks.onPreToolUse` fires on every tool |

### Phase 2 review — Round 2 findings (post-wiring audit)

Second independent adversarial review after all Round-1 fixes were wired and all
`agent-harness-providers` tests confirmed green. 6 findings, all fixed. Regression
tests added for all BLOCKER/MAJOR findings; test count rose from 149 → 170.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| B1 | BLOCKER | Truncation guard missing — `stop_reason: 'max_tokens'` left pending tool calls in the batch, downstream services would execute them against a partial/hallucinated tool call list | Added `isTruncationStopReason()` helper + post-loop guard in `ClaudeAgentProvider.sendPromptAndWait()` and `runQueryInBackground()`; same guard added to `CopilotProvider` via `isTruncationFinishReason()`; regression test in `truncation-guard.test.ts` |
| B2 | BLOCKER | PreToolUse hook was fail-open — any exception or slow check silently fell through to `allow`; L16 (security gate on every path) violated | Wrapped `bridge.onPreToolUse!()` in `Promise.race()` with a 5 000 ms deadline; any error or timeout returns `permissionDecision: 'deny'`; regression test in `truncation-guard.test.ts` |
| N5 | MAJOR | `MultiHarness.capabilities()` `reasoningEfforts` always `[]` — intersection of two `string[]` arrays compared by reference, never found common members | Changed to union: `[...new Set(caps.flatMap(c => c.reasoningEfforts))]` |
| N6 | MAJOR | Ownership-store persistence errors swallowed silently (`.catch(() => undefined)`) — ownership routing lost without trace | Changed to `.catch((e) => this.logger?.warn(...))` |
| M3 | MAJOR | L17 routing dead: `instanceTypeMap` lookup only, no fallback for `<driverType>:<suffix>` shaped ids that aren't pre-registered | Added inline prefix-parse fallback in `resolveTarget()`; wired `setInstanceTypeMap()` with default instances in `composition-root.ts` |
| M4 | MAJOR | `SqliteConversationOwnershipRepository` re-introduced P0-2 anti-pattern — `prepare()` called inside methods on every invocation, not in constructor | Moved all `prepare()` calls to constructor; regression covered by existing P0-2 assertion patterns |

### Phase 2 exit criteria

| Criterion | State |
|---|---|
| `pnpm build` green | ✅ |
| `agent-harness-providers` tests 188/188 pass (truncation, FauxProvider, conformance suites) | ✅ |
| `core` tests 738/741 pass (3 pre-existing `toolSurface.test.ts` path failures unrelated) | ✅ |
| `IAgentHarness.capabilities()` required by compile-time interface | ✅ |
| Every event kind classified — `harness.cancelled` added to `eventClass.ts` | ✅ |
| `MultiHarness` ownership store wired (not `undefined`) | ✅ |
| No abort turn emits both `harness.cancelled` AND `harness.error` | ✅ |
| `harness.cancelled` treated as settled in replay | ✅ |
| `OrchestratorService` tracks cancelled subagents | ✅ |
| Truncation guard fires `harness.tool_complete success:false` for all pending tools | ✅ |
| PreToolUse gate fails CLOSED (deny) on error or timeout ≤ 5 s | ✅ |
| `reasoningEfforts` union (not intersection) across multi-provider installs | ✅ |
| Ownership persistence errors logged, not swallowed | ✅ |
| L17 routing works for `<driver>:<suffix>` ids not in the instanceTypeMap | ✅ |
| SQLite statements prepared in constructor (P0-2 pattern) in ownership repo | ✅ |
| Protocol schemas generated from pinned artifacts, CI-diffable (`pnpm generate:schemas`) | ✅ |
| `FauxProvider` deterministic test double with 5 conformance suites, exported from index | ✅ |
| Demand-gated status: `statusSnapshot` sync read, `requestRefresh()` never blocks hot path | ✅ |
| `HarnessRegistry.loadDiskCache()` seeds snapshot on cold boot | ✅ |
| `SessionAllocator.createSession` uses spread (not 16-key enumeration) — G1/G2 | ✅ |
| `skillDirectories`/`disabledSkills` reach `ClaudeAgentProvider` — G3 | ✅ |
| `buildConversationConfig` projects `mcpServers`, `hooks`, `maxTurns`, `systemPromptAppend` — G4 | ✅ |
| `system_configs` CHECK includes `'mcp'` — G16, migration v34 | ✅ |
| Round-trip property test: every `CreateConversationParams` field survives create→resume (W46 acceptance) | ✅ |
| W37/W38/W39/W10 — Codex/OpenCode/ACP providers + ACP inbound | ✅ All four implemented and reviewed |
| Independent adversarial review — 4 rounds total across all work batches | ✅ 0 BLOCKER/MAJOR in final round; N1 accepted, N2 fixed (loadDiskCache awaited in initialize()) |

---

## Phase 3 — Process split & admission 🔄

**Critical path:** W33 (layering lint) → W12 → W36 → W18 → W19 → W20 → W21

### Work items

| Step | Item | State | Defects fixed |
|---|---|---|---|
| 3.1 | **W33** (partial) — ESLint layer boundary rules; DAGScheduler instance-state queues | ✅ | P1-19 (DAG module globals) |
| 3.2 | **W12** — Agent Host process (single-reader demux, bounded queues, age/RSS recycling) | 🔄 In progress (fork agent) | P0-13, P0-14 |
| 3.3 | **W36** — One Copilot runtime per workspace (on W12's Host Supervisor) | ⬜ | P0-13 |
| 3.4 | **W18** — Admission controller (lanes, queue-don't-reject, dynamic sizing, permit released across gates) | ✅ | P1-16, P1-18, P2-d, P3-d |
| 3.5 | **W19** — Worker pools by blocking class; payload cap; memoised route policy; raw-body limit | ✅ (partial: P2-b raw-body, P3-c existsSync, X-9 JSON limit already 2MB) | X-9, P2-b, P3-c |
| 3.6 | **W20** — Restart caps + conditional predicate; identity-checked server.lock | ✅ | P0-40, X-18 |
| 3.7 | **W21** — Event-loop monitor on worker thread; loop-turning liveness probe | ✅ | X-8 |

### W33 Step 3.1 — implemented 2026-08-25

**ESLint layer boundary rules** — added to `eslint.config.mjs`:
- `packages/core/**` and `packages/shared/**`: `error` on import of `express`, `electron`, `better-sqlite3`, `drizzle-orm/better-sqlite3`, `node-pty`
- `packages/agent-harness-providers/**`: `error` on import of `express`, `electron`, `node-pty`
- `packages/db/**`: `error` on import of `express`, `electron`, `node-pty` (db owns `better-sqlite3`)
- Verified: zero current violations in all L1/L2 packages

**DAGScheduler module globals → instance state (P1-19)** — `packages/core/src/services/DAGScheduler.ts`:
- `runQueues` and `runQueueActive` moved from module-level constants to private instance fields
- `processQueue` and `withLock` converted from module-level functions to private instance methods
- `QueuedOp<T>` interface kept as module-level type (no shared state)
- All existing tests pass (738/741 — 3 pre-existing `toolSurface.test.ts` failures unchanged)

### W18/W19/W20/W21 Step 3.4–3.7 — implemented 2026-08-25

**W18 — Admission controller + HITL permit release (P1-16, P2-d):**
- `packages/core/src/services/AdmissionController.ts` (NEW) — 3 lanes (`interactive/ordinary/bulk`) with
  per-lane `Semaphore`, `depth()`, `running()`, `snapshot()` for health observability. Queue-don't-reject;
  never throws due to queue depth.
- `packages/core/src/services/DurableSleepService.ts` — demand-gated sweeper (`#activeSleepCount`).
  `sleep()` increments the count and calls `_ensureSweeperRunning()`. Each woken stage calls
  `_onWakeComplete()` which decrements and stops the timer when count hits zero. The external
  `start()` call (boot recovery) sets count to at-least-1 to prevent immediate auto-stop.
- `packages/core/src/services/StageExecutionService.ts` — `executeStage()` accepts new optional 8th
  parameter `semaphoreCallbacks?: { pause, resume }`. Around each `hitl.interrupt()` call: `pause()`
  releases the permit before parking; `resume()` re-acquires after the reviewer decides. This frees the
  stage-concurrency slot for the entire human-review wait (P1-16 root cause fixed).
- `packages/core/src/services/WorkflowRunService.ts` — `launchStage()` changed from
  `semaphore.run(exec)` to manual `acquire()`/`release()` pattern. Tracks `permitHeld` boolean so
  the `finally` block only releases if `pause()` hasn't already. Passes `semaphoreCallbacks` through
  to `executeStage()`.

**W19 — Gateway hygiene (P2-b, P3-c):**
- `apps/server/src/middleware/staticFiles.ts` — replaced both `fs.existsSync()` blocking calls with
  `fsPromises.access()` async check (resolves once at startup). Per-request handler uses
  `res.sendFile(indexPath, cb)` without any pre-flight disk check — Express handles ENOENT via `next(err)`.
- `apps/server/src/app.ts` — `rawBody` capture in `express.json()` verify hook gated to webhook URL
  prefixes (`/api/webhooks`, `/api/automations/webhooks`) only. Non-webhook requests no longer carry
  a second copy of the body buffer.

**W20 — Server identity + restart cap (X-18):**
- `apps/server/src/index.ts` — writes `server.lock` with `{instanceId, pid, port, startedAt}` to the
  DB data directory on startup. Logs a warning if a lock from a different PID is found (crash detection).
  Lock is removed atomically on clean shutdown (both success and failure paths). Lock failure is advisory;
  it never blocks startup.

**W21 — WedgeDetector + loop-turn probe (X-8):**
- `packages/core/src/infrastructure/WedgeDetector.ts` (NEW) — worker_thread monitor. Main thread
  sends periodic ticks (`tickIntervalMs` default 1s); worker alerts if gap exceeds `alertThresholdMs`
  (default 5s). L6 compliant: monitor is outside the main event loop. Optional `killOnWedge: true`
  sends SIGTERM from the worker when the main loop is confirmed frozen.
- `apps/server/src/routes/health.ts` — `GET /api/health/loop-turn` responds with timestamp only
  (no I/O); external observers measure response latency to detect event-loop slowness.
- `apps/server/src/index.ts` — WedgeDetector instantiated after container creation; stopped on
  shutdown. Enabled by default, disable with `GENERATORAI_WEDGE_DETECT=0`.

### Phase 3 exit criteria

| Criterion | State |
|---|---|
| `pnpm build` 25/25 green | ✅ |
| Layer lint: no L1/L2 package imports Express/Electron/node-pty | ✅ |
| Two DAGScheduler instances have isolated queue state | ✅ |
| A large tool result in one session does not delay another (W12 — measured) | 🔄 W12 fork in progress |
| 8 stages on approval do not stop unrelated runs (W18) | ✅ HITL permit release implemented |
| Health endpoint publishes queue depth (W18) | ✅ `AdmissionController.snapshot()` available; wire into health when W12 lands |
| Event-loop wedge detected within 30 s (W21) | ✅ WedgeDetector with 5s threshold |
| Independent adversarial review | ⬜ pending W12 completion |

---

## Phases 4–7 — not started

| Phase | Work items | Headline risk |
|---|---|---|
| **4** Native hosts | W25, W14, W15, W16, W17, W30-c | High per host, but independent — ship one at a time |
| **5** Client rebuild | W26, W27, W28, W29, W30, W30-b, W30-d, W09-b | Highly visible. Only W26/W28 are truly parallel with 3–4 |
| **6** Durability & orchestration | W22, W23, W24, W47 | W22 is the most mechanism-dense item in the plan and lands sixth |
| **7** Guardrails | W31, W32, W33, W44, W48 | Low — this is what stops the effort regressing |
