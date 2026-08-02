# 02 — Server + streaming (`apps/server` + `packages/streaming`)

Detailed implementation plan for the 4 Critical + 6 High findings in section B of [../CODE_REVIEW.md](../CODE_REVIEW.md).

---

## Critical

### [CRITICAL] No API auth — `apps/server/src/app.ts:27-59`

**Issue.** Every route is unauthenticated. `curl` against any endpoint can create runs, delete data, upload files, read workspace content. Only webhooks have auth.

**Fix.**
1. **New middleware** `apps/server/src/middleware/auth.ts` — reads `Authorization: Bearer <token>`. Rejects with 401 on missing/empty. Whitelist exemptions: `/health`, `/health/config`, `/webhooks/*`.
2. **Token store (Phase 0 interim):** a new `api_keys(id PK, key_hash, name, created_at, revoked_at?)` table; middleware hashes the incoming token and looks up; attach `req.apiKey` and `req.apiKeyId`. Token generation via a new `apps/server` CLI script `pnpm generate-key`.
3. **Wire in `app.ts`:** mount after `requestId`, before `requestMetrics`.
4. **Web client** — `apps/web/src/platform/apiFetch.ts` injects header if `localStorage.getItem('apiKey')` is set; wire a first-run setup screen that captures the key.
5. **CLI client** — `apps/cli/src/platform/HttpPlatformClient.ts` reads from `GENERATORAI_API_KEY` env or `--api-key` flag; include in every request.
6. **Test fixtures** — `apps/server/__tests__/helpers/testApp.ts` seed a test key and inject in every request via a helper.
7. **Docs** — README + CLAUDE.md note: single API key is a Phase 0 solution; Phase 2 roadmap adds user/team scoping.

**Effort:** M (2–3 days). **Ripple.** Every test fixture. Every web/CLI client call. Deployment docs must advise key generation. **Acceptance:** curl without header → 401; with valid key → 200; health still public; webhook HMAC still works.

### [CRITICAL] 30 s SSE buffer auto-clear — `routes/workflowRuns.ts:77-86`

**Issue.** Per-run ring buffer deleted 30 s after terminal state. Late reconnect misses everything (buffers gone; REST replay undiscoverable to client).

**Phase 0 fix (tactical):**
1. New config `config.streaming.bufferCleanupDelayMs` (default 300 000 = 5 min), backed by env var `SSE_BUFFER_CLEANUP_DELAY_MS`.
2. `setTimeout(…, bufferCleanupDelayMs)` in workflowRuns.ts + chats.ts + globalEvents.ts.
3. Document that clients are expected to fall back to `GET /api/sessions/:id/stream/events?afterSequence=N` for anything beyond 5 min.

**Phase 1 proper fix** (tracked under 1.10 streaming consolidation): unified `StreamBroker` with DB-backed cursors via `stream_cursors(scope, id, last_seen_sequence, created_at, updated_at)`; TTL cleanup via cron; late reconnect always works.

**Effort:** S (Phase 0); L (Phase 1 full rewrite in 1.10). **Acceptance (Phase 0):** client disconnects, waits 4 min, reconnects with Last-Event-ID → receives buffered events.

### [CRITICAL] No SSE backpressure — `packages/streaming/src/SSETransport.ts:154-165` + `routes/multiplexedStream.ts:61-67`

**Issue.** `res.write()` return value ignored. Slow client → unbounded Node writable buffer → OOM.

**Fix.**
1. **`SSETransport.writeRaw`** returns boolean (success of `res.write`). On `false` or close: do not continue writing.
2. **`SSETransport.send`** adds `paused: boolean` + `drainQueue: AgentEvent[]`. When `writeRaw` returns false: set paused, queue the event, attach `res.once('drain', …)` to flush and unpause.
3. **Per-route broadcasters** in `workflowRuns.ts` / `chats.ts` / `globalEvents.ts` / `multiplexedStream.ts`: same pattern per client. Track `clientQueues: Map<Response, {paused, queue}>`.

**Effort:** M. **Deps:** simplified by 1.10 consolidation; ideally land backpressure as part of that rewrite. **Acceptance:** stress test — 10 k events/s to a client reading 1/s; server memory stays bounded; events eventually delivered when client catches up.

### [CRITICAL] Brittle module-level subscription guards — `workflowRuns.ts:22-23`, `chats.ts:28-29`, `globalEvents.ts`

**Issue.** `let runAllSubscribed = false` at module scope. Factory recalled in tests or hot-reload → old closures + old maps remain referenced by the original EventBus subscription; memory leak + double-delivery.

**Fix.**
1. **New `StreamSubscriptions` container service** wired in `composition-root.ts`. Owns a single subscribe to `eventBus.subscribeAll` + `subscribeGlobal`. Offers `onRunEvent(cb)`, `onChatEvent(cb)`, etc.
2. Route factories register their callbacks with `container.streamSubscriptions.onRunEvent(...)` instead of subscribing directly.
3. Delete module-level booleans.

**Effort:** M. **Acceptance:** call route factory twice; only one upstream subscription; no event delivered twice.

---

## High

### [HIGH] Run-stream cross-contamination — `routes/workflowRuns.ts:38-44`

**Issue.** `runSessionIds` map is passively populated from arriving events. A client opening any `/workflow-runs/:id/stream` will receive events the first time a session fires for that run — no upfront ownership/existence check.

**Fix.** On SSE connect:
1. `const run = await workflowRunRepo.findById(runId); if (!run) return 404`.
2. `const stageRuns = await stageRunRepo.findByWorkflowRunId(runId)`; collect `Set<sessionId>`.
3. Store in per-client metadata map: `clientValidSessions: Map<res, Set<sessionId>>`.
4. Broadcaster filters — only deliver event if `clientValidSessions.get(res).has(event.sessionId)`.
5. When a stage is added mid-run, the `runSessionIds.add` path stays (passive) for consistency.

**Effort:** S. **Ripple.** Coordinates with 0.1 auth (future per-workspace scoping builds on this).

### [HIGH] Path traversal via symlink — `routes/orchestrator.ts:285-327`

**Issue.** `path.resolve` doesn't follow symlinks. Attacker-planted symlink escapes workspace.

**Fix.** All file endpoints (download, content, diff, delete, upload):
- `baseReal = await fs.realpath(baseDir)`.
- `targetReal = await fs.realpath(join(baseDir, filePath))` (catch ENOENT for not-yet-existing files; walk to deepest existing ancestor).
- `if (!targetReal.startsWith(baseReal + sep) && targetReal !== baseReal) → 403`.
- Upload: `fs.lstat(targetPath)`; reject if `isSymbolicLink()`.

**Effort:** S. **Same fix also required** in StageExecutionService (finding A#10). **Acceptance:** symlink bypass attempt → 403; non-existent path → 404.

### [HIGH] Webhook delivery not idempotent — `routes/webhooks.ts`

**Issue.** GitHub retries trigger duplicate workflow runs.

**Fix.**
1. Schema: existing `webhook_deliveries` already exists; add UNIQUE on `delivery_id`.
2. `WebhookService.handleGitHub` flow:
   - `deliveryId = headers['x-github-delivery']` (required; missing → 400).
   - `findByDeliveryId(deliveryId)` → if exists: log + return 200 (idempotent).
   - Insert delivery row with status `pending`.
   - Try processing; on success mark `status=success` with `workflowRunIds`; on failure mark `failed`.
3. Similarly for `/webhooks/custom/:trigger` with a generated delivery id derived from a client-supplied idempotency key header.
4. Periodic cleanup (TTL 7 days) via cron.

**Effort:** M. **Deps:** 1.1 migrations (for the UNIQUE index).

### [HIGH] Error handler stack leak / silent loss — `middleware/errorHandler.ts:67-69`

**Fix.** Always include `requestId` in the response. In production, log the stack via `logger.error` with `requestId` for correlation; do not ship stack to client. In development, include stack in response for convenience.

**Effort:** S.

### [HIGH] Circular DI via setters — `composition-root.ts:222-224`

**Phase 0 fix.** Make setters mandatory and defensive:
- In each service, `private xService: X | null = null`; setter stores; every method using it asserts with a clear error.
- In composition root, construct both, call setters, then run a no-op smoke check on each service.

**Phase 1 fix (if still worth it).** Extract via builder pattern or consolidate services so the cycle goes away.

**Effort:** S.

### [HIGH] 30 s graceful shutdown too short — `index.ts:146-150`

**Fix.**
1. Extend to 60 s (configurable via `GENERATORAI_SHUTDOWN_TIMEOUT_MS`).
2. Log per-phase progress: `[Server] SSE shutdown initiated`, `[Server] Services shutdown`, `[Server] DB closed`, with elapsed ms.
3. Phase 1: add per-connection 10 s timeout — after requesting graceful close, force-close stragglers individually.

**Effort:** S.

---

## Streaming consolidation (1.10 — Phase 1 cornerstone)

This replaces the current tangle (`DurableStreamManager` + per-run ring + per-chat ring + global ring + multiplexed ring). Recommend landing as one coordinated change to avoid half-migrations.

**Design.**
- New `packages/streaming/src/StreamBroker.ts`:
  - Keyed by `Scope = 'session' | 'run' | 'chat' | 'global'` + `id`.
  - In-memory ring buffer per (scope, id) sized from config.
  - Persistent `stream_cursors` table for long-horizon replay.
  - `subscribe(scope, id, handler, { lastEventId? }) → unsubscribe`.
  - `broadcast(scope, id, event)` — write + backpressure to all subscribers.
- Server routes become thin adapters: on SSE connect, parse scope from URL + auth, call `broker.subscribe`, replay from `Last-Event-ID`, attach stream.
- Retirement: delete `DurableStreamManager`, delete per-route ring buffers.

**Effort:** L. **Replaces:** 0.9, 1.10, 1.11 in a single rewrite.
