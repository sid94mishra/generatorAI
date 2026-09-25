# Feature: Streaming & Events

> The entire backbone that delivers real-time updates from harness → server → client. Implemented across `EventBus` (in-process), `StreamBroker` (durable), and the unified SSE endpoint `/api/stream`.

For higher-level event flow see [architecture.md §5](./architecture.md#5-real-time-eventing). This doc focuses on the implementation details and durability guarantees.

---

## 1. Event taxonomy

`AgentEventKind` (defined in [packages/shared/src/types/AgentEvent.ts](../../packages/shared/src/types/AgentEvent.ts)) is a discriminated union of ~60 kinds across categories:

```
harness.*               token, message_complete, reasoning_delta, reasoning_complete,
                        tool_start, tool_complete, idle, error,
                        session_start, session_info, turn_start, turn_end,
                        user_message, usage, unknown

session.*               starting, running, paused, completed, cancelled, error

chat.*                  created, updated, archived, deleted

workflow_run.*          starting, running, paused, resumed, cancelling, cancelled,
                        completed, failed, retrying

stage_run.*             queued, running, completed, failed, cancelled, skipped, retrying,
                        awaiting_input, approved, rejected

automation.*            triggered, execution_started, execution_progress,
                        execution_completed, execution_failed, execution_cancelled,
                        iteration_started, iteration_completed, iteration_failed

git.*                   clone_start, clone_progress, clone_complete,
                        commit, push, pr_created

script.*                stdout, stderr, exit

hook.*                  started, completed, failed, skipped

permission.*            requested, granted, denied, timeout

artifact.*              created, available

client.*                started, stopped, error, restarting        (harness client lifecycle)

browser.*               session_created, session_stopped, session_updated,
                        action_started, action_completed, snapshot,
                        selection, error                            (Integrated Browser —
                                                                    scope=`browser:<workspaceId>`)

terminal.*              session_created, session_closed,
                        session_resized                             (Integrated Terminal —
                                                                    scope=`terminal:<workspaceId>`;
                                                                    raw PTY output is NOT on SSE — it
                                                                    lives on the dedicated WS
                                                                    `/api/workspaces/:id/terminals/:sid/stream`)

harness.widget.*        render, state, action, closed               (Widgets — agent-rendered UI;
                                                                    fan-out follows the owning
                                                                    session/chat/workflow_run scope.
                                                                    See feature-extensions-widgets.md)
```

Factory: `createAgentEvent(kind, data, opts?)` ensures shape consistency. Every event has `id`, `kind`, `data`, `timestamp`, and (after persistence) `sequence`.

---

## 2. EventBus (in-process)

[packages/core/src/events/EventBus.ts](../../packages/core/src/events/EventBus.ts).

### Public API

```typescript
emit(sessionId: string, event: AgentEvent): Promise<PersistedEvent>;
emitGlobal(event: AgentEvent): Promise<PersistedEvent>;
subscribe(sessionId, handler): () => void;
subscribeGlobal(handler): () => void;
subscribeAll(handler): () => void;        // every event regardless of session
```

### Per-session promise queue

```typescript
private emitQueues = new Map<sessionId, Promise<void>>();
```

Each `emit(sessionId, event)`:
1. Chains onto `emitQueues.get(sessionId)` via `.then(...)`.
2. Inside the chain:
   - Persists to `events` table (legacy v1 stream).
   - Allocates a `sequenceId` via `SequenceAllocator` (atomic SQL).
   - Broadcasts to subscribers including the `StreamBroker` bridge.
3. Returns the resolved `PersistedEvent`.

**Why:** without serialization, two concurrent `emit()` calls could finish DB inserts out-of-order, breaking sequence monotonicity and SSE replay determinism. **Do not refactor away the queue.**

If `_doEmit()` throws (rare DB error), the failure is logged and the next event in the queue proceeds. This produces a sequence gap (e.g., seq 42 missing) — replay sees the gap; clients must tolerate it.

---

## 3. StreamBroker (durable)

[packages/core/src/services/StreamBroker.ts](../../packages/core/src/services/StreamBroker.ts).

### Public API

```typescript
publish(scope, scopeId, kind, data): Promise<{seq, id, ts}>;
subscribe(scope, scopeId, handler, opts?): Promise<() => void>;
replay(scope, scopeId, afterSeq, limit?): Promise<StreamEventRow[]>;
subscriberCount(scope, scopeId): number;
prune(olderThanMs): Promise<number>;
```

### `publish` — commit then broadcast

```
1. DB transaction:
     INSERT INTO stream_sequences (scope, scope_id, last_seq) VALUES (?,?,1)
       ON CONFLICT DO UPDATE SET last_seq = last_seq + 1
       RETURNING last_seq;
     INSERT INTO stream_cursors (scope, scope_id, seq, kind, payload, ts) VALUES (?,?,?,?,?,?);
2. Notify in-memory subscribers (Set<handler>) — fire-and-forget; isolated try/catch.
```

**Invariant:** if a subscriber sees an event, it is already persisted. Read-your-writes guarantee for SSE replay.

### `subscribe` — 3-phase

```
Phase 1: Buffering
  Attach wrapped handler that pushes onto a buffer queue.

Phase 2: Replay
  Fetch from DB: SELECT * FROM stream_cursors WHERE scope=? AND scope_id=? AND seq > afterSeq LIMIT syncReplayLimit (default 100, max 1000).
  Sort ascending by seq.

Phase 3: Drain & go live
  Track deliveredUpTo (the max seq just replayed).
  Flush the buffer, dropping any events with seq <= deliveredUpTo (already replayed).
  Swap handler to live-mode for new events.
```

**Race-safe:** events arriving during replay land in the buffer; dedup by `deliveredUpTo` after replay.

`kindPrefixes` option filters server-side (e.g., `['harness.', 'stage_run.']`). Up to 10 prefixes.

---

## 4. Multi-scope routing

The bridge inside `composition-root.ts`:

```typescript
const bridgeEvent = (event) => {
  const runId  = event.data?.workflowRunId;
  const chatId = event.data?.chatId;

  // Primary scope: session (or 'global' for cross-session events)
  const primaryScope = event.sessionId === '__global__' ? 'global' : 'session';
  const primaryId    = event.sessionId === '__global__' ? 'all'    : event.sessionId;
  streamBroker.publish(primaryScope, primaryId, event.kind, event.data);

  // Secondary scopes
  if (runId)  streamBroker.publish('run',  runId,  event.kind, event.data);
  if (chatId) streamBroker.publish('chat', chatId, event.kind, event.data);
};

eventBus.subscribeAll(bridgeEvent);
eventBus.subscribeGlobal(e => bridgeEvent({ sessionId: '__global__', ...e }));
```

Each scope maintains its own monotonic sequence. A single `harness.token` event for run `r1`, session `s1` is published to scopes `session/s1` AND `run/r1` with independent sequence counters. A subscriber to `scope=run` sees only the `run` sequence, so its Last-Event-ID resumes are scoped correctly.

---

## 5. Unified SSE endpoint

[apps/server/src/routes/stream.ts](../../apps/server/src/routes/stream.ts).

### Request

```
GET /api/stream?scope=<session|run|chat|global>&id=<scopeId>&afterSeq=<n>&filter=<csv>
Headers:
  Last-Event-ID: <seq>           browser auto-sends on reconnect
Query (alt to header):
  afterSeq=<n>                   fallback when Last-Event-ID is missing
  filter=harness.,stage_run.    csv of kind prefixes, up to 10
```

### Response

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-store, must-revalidate
Connection: keep-alive
X-Accel-Buffering: no            disable nginx buffering

: initial-comment-frame

id: 42
data: {"id":42,"kind":"harness.token","payload":{"text":"Hi"},"ts":1715601600000,"scope":"run","scopeId":"r1","seq":42}

id: 43
data: {…}

: heartbeat 2026-06-12T12:00:15.000Z
```

- **No `event:` field** — all events fire `onmessage`. UI demuxes on the `kind` JSON field. Avoids the browser's 6-distinct-event-type limit.
- **Heartbeat** every `config.streaming.heartbeatIntervalMs` (default 15s).
- **Initial comment frame** flushes any reverse-proxy buffer immediately.

### Backpressure (STR-05)

```
HIGH_WATER = 256 queued frames per connection.
On res.write() returning false → pause publishing, await 'drain'.
If queue exceeds HIGH_WATER → send `slow_consumer_dropped` frame + disconnect.
```

Client distinguishes `slow_consumer_dropped` from a network error and surfaces a "stream lagging" indicator.

### Connection cap (SEC-04)

`acquireSseSlot(scope, id)` returns `{ ok, release }`. Default caps:
- `session`, `run`, `chat`: 6 connections each
- `global`: 32 connections
- Overridable via `GENERATORAI_SSE_CAP_PER_SCOPE` (applies uniformly).

`release()` is **idempotent** and must be called in `res.on('close', release)`. Missing this leaks slots.

### REST replay fallback

```
GET /api/stream/replay?scope=&id=&afterSeq=&limit=

→ { "rows": [StreamEventRow…], "nextAfterSeq": <max seq> }
```

`limit` default 100, max 500. Always returns oldest-first.

---

## 6. Client-side (web sseManager)

[apps/web/src/stores/sseManager.ts](../../apps/web/src/stores/sseManager.ts).

- Per-scope `EventSource` (one per scope+id).
- Pre-emptive REST replay from `lastSeq` then subscribes to SSE.
- Dedup window: last 600 seq IDs (Set-based).
- Grouping by `stageRunId` for parallel-stage rendering.
- **Cross-buffer flush** (lines ~160–183 in source, load-bearing):
  - When a `harness.token` arrives → flush thinking buffer first.
  - When a `harness.reasoning_delta` arrives → flush token buffer first.
  - Preserves correct thinking↔token interleaving during multi-turn flows.
- Per-connection 100ms flush timer batches token deliveries to keep React happy.

`processEvent()` is ~500 LOC handling each of the ~60 event kinds — surfacing into `chatStore`, `workflowStore`, etc.

---

## 7. Client-side (CLI SSEClient)

[apps/cli/src/streaming/SSEClient.ts](../../apps/cli/src/streaming/SSEClient.ts).

Wraps `eventsource` package with:
- Auto-reconnect with exponential backoff (1s → 30s, ±500ms jitter).
- Max 20 attempts before declaring disconnect.
- `Last-Event-ID` header included automatically on reconnect.
- Hooks `onConnected`, `onReconnecting`, `onDisconnected`.

`EventRenderer.handleEvent()` renders:
- `harness.token` → write to stdout
- `harness.reasoning_delta` → magenta thinking output (if `--verbosity verbose`)
- `harness.tool_start` → `[tool:read_file]` cyan
- `harness.tool_complete` → indented result preview
- `harness.usage` → token counts + cost in grey
- `harness.error` → red error message
- `stage_run.*`, `workflow_run.*` → status badges

---

## 8. Durability matrix

| | Durable? | Recovery |
|---|---|---|
| **`stream_cursors` rows** | ✅ Yes (SQLite WAL, FK ON) | Survives crash. Up to `eventPayloadTtlDays` before pruning. |
| **`stream_sequences.last_seq`** | ✅ Yes | Survives crash. Never decremented. |
| **`events` legacy log** | ✅ Yes | Same retention. |
| **Subscriber set** | ❌ In-memory only | Process restart drops all clients; they reconnect with Last-Event-ID. |
| **Heartbeat timers** | ❌ In-memory only | Restarted on reconnect. |
| **Per-connection backpressure state** | ❌ In-memory only | Reset on reconnect. |
| **EventBus per-session queue** | ❌ In-memory only | Per-event try/catch; on DB failure, sequence gap possible. |

### Known durability gaps

1. **EventBus persist failure causes seq gap** — design tolerates this (best-effort, not ACID). Mitigation: caller retries at app level (e.g., re-emit on error).
2. **StreamBroker subscriber exception** — caught and isolated; broken subscriber doesn't affect others (EVT-02).
3. **Stale Last-Event-ID after retention sweep** — client sends a seq that was pruned. `replayAfter` returns 0 rows. Client must fall back to REST replay. *Correct behavior — no silent data loss.*
4. **Mid-replay process kill** — client may miss final buffered events. Mitigated by Last-Event-ID resume + REST replay on reconnect.

---

## 9. EventRetentionService (DB-04)

[packages/db/src/services/EventRetentionService.ts](../../packages/db/src/services/EventRetentionService.ts).

```typescript
config = {
  enabled: true,
  eventPayloadTtlDays: 30,        // rows older than this deleted
  sweepIntervalMs: 60 * 60 * 1000, // hourly
  maxDeletePerSweep: 10_000,       // per table per sweep
}
```

Runs on a (unref'd) timer. Each sweep:
1. Computes `cutoff = Date.now() - ttlDays * 86400000`.
2. `DELETE FROM stream_cursors WHERE ts < cutoff LIMIT maxDeletePerSweep` (oldest first).
3. Same for `events`.
4. Pluggable custom sweepers via `registerSweeper()` (future EVT-04 blob cleanup).

Does **not** reset sequence counters — stale Last-Event-IDs simply find no rows.

---

## 10. Adding a new event kind

1. Extend `AgentEventKind` union in [packages/shared/src/types/AgentEvent.ts](../../packages/shared/src/types/AgentEvent.ts).
2. Add a typed payload variant in the same file's data discriminator.
3. Emit via:
   ```typescript
   eventBus.emit(sessionId, createAgentEvent('myKind', { … }, { workflowRunId, chatId }));
   ```
   The bridge auto-routes to all relevant scopes.
4. Handle in [apps/web/src/stores/sseManager.ts](../../apps/web/src/stores/sseManager.ts) `processEvent()` if it should drive UI state.
5. Handle in [apps/cli/src/streaming/EventRenderer.ts](../../apps/cli/src/streaming/EventRenderer.ts) `handleEvent()` if it should render in `run watch`.

No route or DB schema change required.

---

## 11. Diagnostics

- `GET /api/health` reports current SSE subscriber counts per scope.
- `GENERATORAI_LOG_LEVEL=debug` enables per-event logging in EventBus + StreamBroker.
- OTel metrics: `stream.events.published`, `stream.events.dropped` (slow consumer), `stream.subscribers.active`.

---

## 12. Edge cases & gotchas

1. **Order of operations** — `EventBus` queue serialization happens *before* `StreamBroker.publish`, which itself serializes via DB transaction. Concurrent emits across different sessions/scopes are fine; concurrency *within* a session is preserved.
2. **`slow_consumer_dropped` frames** — UI shows a yellow banner "Stream lagging — refresh to catch up". Don't auto-reconnect aggressively; the user typically wants to refresh.
3. **Per-(scope, id) cap reached** — server returns `429` immediately for new connections. UI shows "Too many open tabs for this run; close some and reload".
4. **Replay limit exceeded** — `syncReplayLimit` clamps at 1000. If clients fall too far behind they get the most recent 1000 events, then live. The cap is intentional to avoid memory bloat on reconnect storms.
5. **Multi-tab scenarios** — same browser, multiple tabs of the same run all share `EventSource` via `BroadcastChannel` in `sseManager` (planned, currently each tab opens its own).
6. **CLI watching an already-complete run** — `subscribeToRunEvents` replays all events; the renderer fires `onComplete` when it sees `workflow_run.completed`. Pass `--from-sequence 0` to replay from scratch.
7. **Event kinds with no payload** — allowed; `data` is `{}`. Don't infer values from missing keys.
8. **Heartbeat frames** are SSE comments (`: heartbeat …`) — do not parse as data. Native EventSource skips them. Custom clients must too.
9. **Server-Sent Events behind Cloudflare/CDN** — set `Cache-Control: no-store` (already done) and disable buffering. CF Workers will buffer otherwise; consider using a `transfer-encoding: chunked` warmup frame.
10. **Browser EventSource auto-reconnect interval** — default 3s; not configurable from the server. Our `Last-Event-ID` resume handles it.
