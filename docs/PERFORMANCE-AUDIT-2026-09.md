# Performance audit — September 2026

Measured against the **Claude Agent SDK** harness (`HARNESS_TYPE=claude-agent`, primary provider,
via the local Claude CLI), driving the running application in a real browser with a realistic
dataset: **359 chats, 343 workflow definitions, 527,380 `stream_cursors` rows, a 351 MB database.**

Every number below was measured, not estimated. Where a fix was applied, the "after" number comes
from re-running the same measurement against a restarted server.

---

## 1. The retention sweep blocked the event loop for five seconds at every boot

**The most serious finding, and it was mine.** The event-class retention split added earlier in this
work used one statement with a correlated `NOT EXISTS` per candidate row:

| | Query time |
|---|---|
| Age-only delete (before the split) | **1 ms** |
| The split, as written | **827 ms** |

Run twice per sweep, synchronously, on the server's only thread. The server's own wedge detector
caught it: **three consecutive boots each logged `EVENT LOOP WEDGE DETECTED — main loop has not
ticked for ~5.1–5.3 s`**, and `/api/health` was observed taking over 10 s under load while
answering in 0.22 s when idle.

Two causes, both fixed:

1. **No index covered the sweep's access path.** `stream_cursors` had `(ts)` and `(scope_id, seq)`;
   the sweep filters on `(kind, ts)`. Migration 49 adds `idx_stream_cursors_kind_ts`.
2. **The correlated subquery ran once per row.** It now runs once per *stream*: candidates are
   selected on the new index, then the last terminal event is looked up for only the streams those
   candidates touch — a 2,000-row batch spans about 18 streams — and the "is this turn finished?"
   decision is made in memory.

| Phase | Before | After |
|---|---|---|
| Candidate selection | 258 ms | **3 ms** |
| Terminal-event lookup | (per row) | **4 ms** |
| Boot wedges observed | 3 boots, 3 wedges | **0** |
| `/api/health`, idle | 0.21 s | 0.21 s |

The correctness property is unchanged: deltas prune on a short TTL, items on the full TTL, and an
unfinished turn's rows survive both until a hard cutoff.

---

## 2. Two thirds of everything written to the stream log was empty

`stream_cursors` is 527,380 rows and 102 MB of payload for only 8,178 chat messages. Broken down:

| Kind | Rows | Payload | Status |
|---|---|---|---|
| `harness.session_info` | 201,189 | 21.3 MB | still being written |
| `harness.unknown` | 138,220 | 54.8 MB | already suppressed; last written 2026-08-10 |
| `harness.reasoning_delta` | 63,710 | 4.4 MB | true delta |
| `harness.token` | 29,820 | 2.6 MB | true delta |

`harness.session_info` was the **single largest live writer**: 32,287 rows in the last seven days.
Of those, 21,870 were `assistant_streaming_delta` — and **every one of them had `message: ""`**.
They are duplicate frames of the `harness.token` stream with the text removed: an INSERT each,
rendering nothing.

Fixed by suppressing an *empty* streaming delta at the existing pre-persistence noise filter.
Suppression is on emptiness, not on the type, so a delta that carries text keeps flowing —
`tool_input_delta` rows with real content are still persisted.

**Verified after the fix: 0 empty `assistant_streaming_delta` rows written.**

The 54.8 MB of `harness.unknown` is historical: those events carry `ephemeral: true` from the
provider and stopped being written on 2026-08-10. Retention now reclaims them.

### A third writer, examined and deliberately left alone

`extension.installed` holds **36,972 rows for 28 distinct payloads** — each extension recorded
about 1,320 times. `ExtensionManager.activate()` emits it on every *activation*, and the boot scan
activates every installed extension, so each server start durably records the whole inventory.

This looks alarming and mostly is not: the dev server runs under `tsx watch` and restarts on every
source edit, so a month of development is easily a thousand restarts. In production the cost is
28 rows per boot, not 1,320 per extension. Changing it means giving the extension lifecycle a
notion of "already announced in a previous process", which is a real semantic change to a
subsystem this audit did not otherwise touch — so it is recorded here rather than changed on the
strength of a number inflated by watch mode.

---

## 3. Chat turns spawned six git subprocesses each

The workspace checkpoint runs `rev-parse --is-inside-work-tree` → `add -A` → `write-tree`, once
before a turn and once after. The `rev-parse` probe asks a question whose answer cannot change,
and it accounted for **25 of the git processes spawned during a short chat session** — a third of
them — at roughly 300 ms of process start each on Windows.

`GitClient.isGitRepo` now caches positive answers per directory (5-minute TTL; negatives are never
cached, since `initIfNeeded` turns a non-repo into one; `git init` primes the cache).

| | Before | After |
|---|---|---|
| `--is-inside-work-tree` spawns, 4-prompt session | **25** | **1** |
| Warm turn, time to first token | 2,750 / 2,778 ms | **2,554 / 2,287 ms** |

---

## 4. Chat latency on the Claude harness

| | TTFT | Total |
|---|---|---|
| **First turn in a new chat** | **17.0 s** | 17.6 s |
| Second turn | 2.55 s | 3.16 s |
| Third turn | 2.29 s | 2.88 s |
| 40-line answer | 2.69 s | 3.30 s |

The first turn costs roughly **7× a warm one**. The breakdown from server timestamps: about 8 s of
workspace creation and baseline checkpointing (14 git processes), then an 11.5 s gap that is the
Agent SDK cold start — spawning the Claude CLI and its MCP servers for a new conversation.

Throughput is not the problem: a 40-line answer costs the same as a one-word one. **The cold start
is the remaining chat-performance item**, and closing it means pre-warming a conversation, which
trades idle processes for first-turn latency and is a product decision rather than a bug fix.

---

## 5. List pages render every row

Measured on load, authenticated, against the real dataset:

| Page | Settled | DOM nodes | Long tasks | Worst single task |
|---|---|---|---|---|
| **workflows** | 1,545 ms | **13,887** | **889 ms** | **495 ms** |
| **chats** | 1,669 ms | **7,538** | 512 ms | 334 ms |
| dashboard | 2,309 ms | 826 | 519 ms | 84 ms |
| projects | 1,612 ms | 2,843 | 454 ms | 285 ms |
| automations | 1,696 ms | 2,235 | 262 ms | 143 ms |
| agents / scripts / settings | ≤ 2,066 ms | ≤ 1,018 | ≤ 472 ms | ≤ 80 ms |

A 495 ms task is a half-second of frozen main thread, and the cost grows linearly with the user's
data.

**Fixed.** Both pages now virtualize with `@tanstack/react-virtual` (already a dependency).
`PageContainer` — whose `h-full overflow-y-auto` div is the real scroll parent, not the window —
forwards its ref so the virtualizer can observe it, and a `scrollMargin` measured after each commit
accounts for the header, toolbar and conditional banners above the list. Grid view virtualizes by
row-of-cards, with the column count derived from the same breakpoints the Tailwind grid already
uses.

Measured independently after the change, on the same dataset (two runs; the numbers below are the
clean run — a first attempt was polluted by a stray browser process and is discarded):

| Page | DOM nodes | Worst long task | Total long tasks |
|---|---|---|---|
| workflows | 13,887 → **1,595** | 495 ms → **241 ms** | 889 ms → **509 ms** |
| chats | 7,538 → **836** | 334 ms → **154 ms** | 512 ms → **274 ms** |

About **8.7× fewer nodes** and roughly **half the main-thread blocking**, and the cost no longer
grows with the user's data: 28–35 rows are mounted at a time out of 343.

Behaviour was verified in the browser rather than assumed: scrolling to the bottom of the workflows
list mounts 35 rows none of which were in the top window (so windowing genuinely moves), row
`href`s remain real targets, and entering selection mode and clicking a checkbox toggles selection
without navigating.

---

## 6. Backend and subsystem latency

API round trips, with the 0.75 s CLI start-up subtracted:

| Endpoint | Time |
|---|---|
| `system status` | 0.08 s |
| `automation list` | 0.14 s |
| `agent list` | 0.17 s |
| `chat list --limit 50` | 0.37 s |
| `run list --limit 50` | 0.50 s |
| `workflow list` (343 defs, 252 KB) | 0.66 s |
| `project list` | 0.68 s |

Terminal and browser:

| Operation | Time |
|---|---|
| PTY create, cold (spawns pty-host) | 2.44 s |
| PTY create, warm | 1.32 s |
| `terminal list` | 0.20 s |
| Browser start (cold Chromium) | 6.06 s |
| `browser navigate` | 0.04 s |
| `browser status` | 0.08 s |

Cold starts dominate both; steady-state operations are fast. Boot-time model loading (Silero VAD
1.6 s, Moonshine 2.5 s off-thread) and the harness provider probe (11.3 s, background) are off the
critical path and do not block requests.

---

## What was fixed here

| Fix | Evidence |
|---|---|
| Retention sweep index + restructure | 827 ms → 3 ms; 3 boot wedges → 0 |
| Empty streaming deltas suppressed | 21,870/week → 0 |
| `isGitRepo` probe cached | 25 spawns → 1; warm TTFT −12 % |
| `device invite` sent no `deviceName` | Command failed 100 % of the time on its authenticated path; now works |
| `device invite --ttl` above 10 always rejected | Bounded locally with the limit named |
| Dev API proxy target hardcoded to 3100 | Now `GENERATORAI_DEV_API_TARGET`, so a second server is reachable |
| List pages rendered every row | workflows 13,887 → 1,595 nodes, 495 ms → 241 ms worst task |

## What is measured but not fixed

- **Agent SDK cold start, ~11.5 s on the first turn of a new chat.** Needs pre-warming, which is a
  product trade-off.
- **Browser and PTY cold start** (6.1 s / 2.4 s). Same shape of trade-off.
- **`workflow list` at 0.66 s for 343 definitions.** The payload is only 252 KB, so this is query
  and serialisation cost, not transfer.


---

## 7. Implemented after the audit (items 1–4)

### Harness-agnostic conversation pre-warm — **done, 5.6× measured**

`ProviderCapabilities.prewarm` + an optional `prewarmConversation()` on the harness port, triggered
from `ChatManagementService.prewarmChat()` at chat creation. Claude implements it with the SDK's own
`startup()` / `WarmQuery`; the neutral layer also creates the workspace **baseline checkpoint** early,
which every harness otherwise pays on its first turn.

| claude-agent, first turn of a new chat | Before | After |
|---|---|---|
| With ~12 s of lead time (a user writing a first message) | 12,782 ms | **2,301 ms** |
| Second new chat, same conditions | 11,927 ms | **3,558 ms** |
| With ZERO lead (a script that sends instantly) | 12,782 ms | 12,981 ms — *unchanged* |

The benefit is entirely the lead time, exactly as the curve predicted; nobody is ever worse off.
Copilot was measured too and is **unchanged** (6,076 ms vs 7,109 ms — within noise): its provider
already creates the session eagerly at `createConversation`, so its residual ~2.7 s penalty is
provider-internal, not something the neutral layer can move.

`startup()` is called with a bounded `initializeTimeoutMs` (30 s) rather than the SDK's 60 s default —
a warm-up nobody is waiting on must not hold a half-spawned process for a minute when the CLI is
missing. Found by a test that hung on exactly that.

### Copilot pool cap — **done**

`WorkspacedCopilotPool.maxWorkspaces` defaulted to `Infinity` and **nothing in the tree ever set it**.
The pool keys a CLI process per working directory, and this product gives every chat its own
workspace, so a server that had served N chats held N Copilot processes and released none — eviction
only runs when the cap is exceeded. Now defaults to 8; the existing guard still refuses to evict a
workspace with a live turn.

### Terminal — **done**

`NodePtyHost.isAvailable()` lazily `require`s the node-pty **native addon**, and
`TerminalService.selectHost` was its first caller, so the first terminal a user opened paid that load.
The composition root now probes each host once at boot.

| | Before | After |
|---|---|---|
| First `terminal create` (over the transport baseline) | ~2.24 s | **~1.06 s** |
| Steady-state create | ~1.12 s | **~0.05–0.6 s** |

Note the earlier audit attributed the first-create cost to spawning `pty-host`. That was wrong:
`GENERATORAI_PTY_HOST` is off by default, so terminals run in-process on `NodePtyHost` and the cost
was the native module load.

### Browser — **measured, and no change made**

The audit claimed ~3.0 s of our own overhead above a ~3.0 s floor. **That was wrong**, because the
floor was measured with `chromium.launch` while the server actually uses
`chromium.launchPersistentContext`. Measured back to back on the same machine:

| Primitive | Time |
|---|---|
| `launchPersistentContext`, fresh profile | 6.2–6.9 s |
| `launchPersistentContext`, reused profile | 3.9–4.5 s |
| `launch` + `newContext` + `newPage` | 3.9–4.0 s |

The two APIs are equivalent once measured together, and Chromium startup on this machine is ~4 s
whichever is used. Our 6.06 s `browser start` is close to that floor plus transport, so switching
APIs or overlapping our own steps would buy essentially nothing. **The remaining lever is
environmental** (AV exclusions for the Playwright browser directory), which is out of scope here.
No code change was made, because none was justified by the measurement.

