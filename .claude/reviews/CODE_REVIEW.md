# Code Review — Consolidated Findings

Five adversarial review passes (core, server+streaming, web, CLI+bridge+db+shared) produced ~120 findings. This document consolidates them by severity with file:line references and recommendations. Severity labels: **[CRITICAL]** (data loss / security / silent failure), **[HIGH]** (will bite production), **[MEDIUM]** (correctness in edge cases), **[LOW]** (style/debt).

## Executive summary

GeneratorAI is architecturally sound — clear ports+adapters, typed event model, DAG engine with state machines, SSE streaming, and a coherent SQLite event log. But it is **not production-ready** as currently built. The three load-bearing problems are:

1. **No authentication anywhere on the API.** Any network-reachable client can create/delete/modify every resource and upload arbitrary files.
2. **Durability guarantees are oversold.** "Durable" streaming is in-memory; `EventBus` silently drops events on DB failure; in-memory sequence counters race across processes; no transactions anywhere in the DB layer.
3. **Sandbox is opt-in and fallback is silent.** When Docker is unavailable, the system falls back to `HostProcessSandboxProvider` with zero isolation and only an INFO log. Users who think they are sandboxed are not.

Below are the top 15 critical findings; the full catalog follows.

### Top 15 must-fix-before-any-production-use

1. **Zero API auth** — `apps/server/src/app.ts:27-59`. No bearer/APIkey check. Bind non-localhost → RCE via workflow definitions + copilot + orchestrator file management. *Add mandatory global auth middleware.*
2. **Silent sandbox fallback to host** — `packages/core/src/services/SandboxLifecycleManager.ts:88-89`. When Docker is unavailable, falls back to running on the host with zero isolation at INFO log level. *Require explicit opt-in to host fallback; ERROR log loudly if triggered.*
3. **EventBus DB failure swallow** — `packages/core/src/events/EventBus.ts:47`. `eventRepo.insert(...).catch(() => {})` loses events silently — SSE clients see the event but it never persists, so reconnect via REST replay loses history. *Retry + dead-letter or fail the emit.*
4. **In-memory sequence counter race** — `packages/db/src/repositories/EventRepository.ts` + `EventBus`. Two processes hitting the same DB race on next-sequence allocation. *Allocate sequence IDs in SQL (`AUTOINCREMENT` or `RETURNING`) inside a transaction.*
5. **DAG cache stale-after-update** — `packages/core/src/services/DAGScheduler.ts:26-27`. `dagCache` never invalidated when stages/edges are updated via API. Runs use outdated topology. *Hash definitions and invalidate on mismatch; clear in `WorkflowDefinitionService.update*`.*
6. **30s SSE buffer auto-clear** — `apps/server/src/routes/workflowRuns.ts:77-86`. Per-run buffer deleted 30s after terminal state. Late reconnect (e.g., after network hiccup) loses all events. *Extend to ≥5 min or move to DB-backed replay.*
7. **SessionAllocator memory-only** — `packages/core/src/services/SessionAllocator.ts:26`. Allocation map lost on crash → orphaned Copilot sessions consuming resources. *Persist allocations or rebuild from DB during startup recovery.*
8. **SessionAllocator ref-count off-by-one** — `SessionAllocator.ts:71-84`. Shared session is removed from map but never destroyed when refCount hits 0 → session leak. *Destroy at refCount===0.*
9. **No database transactions** — entire `packages/db/src/repositories/*`. Multi-row operations (create run + N stage_runs + emit events) are not atomic. Partial failure leaves corrupt state. *Wrap multi-step writes in `db.transaction()`.*
10. **Path traversal in workspace writes** — `packages/core/src/services/StageExecutionService.ts:171-179` + server's `routes/orchestrator.ts:285-327`. Symlink-based bypass possible (path.resolve doesn't follow symlinks). *Use `fs.realpath` and a `nofollow` mount or deny symlinks outright.*
11. **Timeouts don't cancel underlying work** — `HookExecutor.ts:119-122`, `StageExecutionService.ts:522-525`, CopilotAdapter `sendPromptAndWait`. `Promise.race` rejects but script/HTTP/SDK call keeps running. *Propagate `AbortController` to child process + fetch; call `copilot.abortConversation` on timeout.*
12. **No backpressure on SSE** — `packages/streaming/src/SSETransport.ts:154-165`, `multiplexedStream.ts:61-67`. Slow consumer → unbounded write buffer → OOM. *Check `res.write()` return; pause on false; wait for `'drain'`.*
13. **Cron re-entrancy across restart** — `packages/core/src/services/AutomationService.ts:66-69`. Cron jobs in-memory; restart while running → double execution. Multi-process → no row lock on `automations.next_run_at`. *Move to a cron-with-lease pattern (DB lock or dedicated scheduler service).*
14. **Startup recovery orphans** — `packages/core/src/services/StartupRecoveryService.ts`. Non-terminal rows marked paused/failed but polling intervals, sandboxes, and in-flight LLM calls are not cleaned up. *Enumerate stale Docker containers + clear polling maps on boot.*
15. **Webhook delivery not idempotent** — `apps/server/src/routes/webhooks.ts`. No dedup by `x-github-delivery` / `delivery_id`. GitHub retries spawn duplicate workflow runs. *Store delivery IDs; return 200 OK if already processed.*

---

## Full findings by subsystem

### A. Orchestration core (`packages/core`)

#### Critical
- **DAG cache invalidation** — `services/DAGScheduler.ts:26-27`. See #5 above.
- **EventBus silently swallows DB failure** — `events/EventBus.ts:47`. See #3.
- **EventBus subscriber exception swallow** — `events/EventBus.ts:74-86`. Errant subscriber's exceptions caught + logged but emission continues. An errant SSE broadcast handler fails silently.
- **SessionAllocator memory-only map** — `SessionAllocator.ts:26`. See #7.
- **StageExecutionService unsafe cast** — `StageExecutionService.ts:352`. `{kind:..., data:enriched} as unknown as AgentEvent` bypasses discriminated-union typing.
- **Orchestrator upload accumulation** — `WorkflowOrchestrator.ts:137-162`. Copies `workflows/{id}/uploads/` into every run — large ML-model uploads duplicated forever. *Symlink/hardlink or GC.*
- **Silent sandbox fallback** — `SandboxLifecycleManager.ts:88-89`. See #2.
- **Startup recovery orphans** — `StartupRecoveryService.ts:99-109`. See #14.

#### High
- **DAG condition evaluator only supports `== != < > <= >=`** — `domain/dag/ConditionEvaluator.ts`. No AND/OR/NOT, no multi-parent expressions.
- **DAG `withLock` swallows prior failures** — `DAGScheduler.ts:17-23`. `.catch(() => {})` hides scheduling errors; next tick sees stale state.
- **Session paused but chat enabled** — `SessionStateMachine.ts:66-68`. Inconsistent UX.
- **WorkflowRun failed state no retry path** — `WorkflowRunStateMachine.ts:40-41`.
- **Max listeners hardcoded 1000** — `EventBus.ts:39-40`. Silent drop at listener 1001.
- **Global handlers memory leak** — `EventBus.ts:21-22`. Missing unsubscribe → leak per request.
- **SessionAllocator refcount off-by-one** — `SessionAllocator.ts:71-84`. See #8.
- **Stage retry race** — `StageExecutionService.ts:618-619`. `incrementRetryCount` without row version; two processes can both retry.
- **Path traversal** — `StageExecutionService.ts:171-179`. See #10.
- **Variable interpolation regex too simple** — `StageExecutionService.ts:485-486`. No nested, no dotted, potential recursion via `{{var}}` in values.
- **Preprocessor script shell injection risk** — `WorkflowPreprocessor.ts:414`. Variables passed as env is safe, but scripts that `eval ${VAR}` are not.
- **ResultValidator custom_script silent pass** — `ResultValidator.ts:127-132`. Returns `true` for unsupported rule type.
- **Hook timeouts don't cancel** — `HookExecutor.ts:119-122`. See #11.
- **Hook retry backoff unbounded** — `HookExecutor.ts:73-91`. No `maxBackoffMs`.
- **pre_tool_use abort semantics unclear** — `HookInterceptor.ts:63-72`. Tool may already be in-flight in SDK before hook returns `false`.
- **Function hooks unimplemented** — `HookExecutor.ts:108-114`. Case defined, implementation missing.
- **Cron re-entrancy** — `AutomationService.ts:66-69`. See #13.
- **Webhook token rotation missing** — `AutomationService.ts:96-98`.
- **Data-source script output unvalidated** — `DataSourceResolver.ts:134-180`. 5 MB cap post-execution; no schema.
- **Automation cancellation soft-flag only** — `AutomationService.ts:68-69`. Blocked I/O never sees the flag.
- **Sandbox creation sleeps event loop** — `SandboxLifecycleManager.ts:29-31`. 500 ms per start; 100 concurrent starts = 50 s block.
- **Sandbox crash orphans** — `SandboxLifecycleManager.ts:140-151`. No Docker-side cleanup.
- **Recovery orphans polling intervals** — `StartupRecoveryService.ts:44-82`. Old intervals never cleared.

#### Medium
- **StageRun terminal state transitions implicit** — `StageRunStateMachine.ts:37-48`.
- **SessionAllocator resumeConversation error swallowed** — `SessionAllocator.ts:118-131`.
- **DockerSandbox error cast unsafe** — `infrastructure/DockerSandboxProvider.ts:95-96`.
- **Recovery session rehydration silent failures** — `StartupRecoveryService.ts:125-134`.
- **`as unknown as` in ConfigResolver + ChatManagementService** — loses type safety.

#### Test coverage gaps
Zero tests: `WorkflowOrchestrator`, `WorkflowPreprocessor`, `ResultValidator`, `HookExecutor`, `HookInterceptor`, `ConfigResolver`, `SessionAllocator`, `AutomationService`, `DataSourceResolver`, `SandboxLifecycleManager`, `StartupRecoveryService`, `SandboxedScriptRunner`, `GitManager`, `FetchHttpClient`, `DockerSandboxProvider`, `HostProcessSandboxProvider`.

### B. Server + streaming (`apps/server` + `packages/streaming`)

#### Critical
- **No API auth** — `app.ts:27-59`. See #1.
- **30s buffer auto-clear** — `routes/workflowRuns.ts:77-86`. See #6.
- **No SSE backpressure** — `packages/streaming/src/SSETransport.ts:154-165`, `routes/multiplexedStream.ts:61-67`. See #12.
- **Brittle module-level subscription guards** — `routes/workflowRuns.ts:22-23`, `chats.ts:28-29`, `globalEvents.ts`. Factory recall silently re-subscribes; memory leak.

#### High
- **Run stream cross-contamination** — `routes/workflowRuns.ts:38-44`. `runSessionIds` maps runs to session IDs but doesn't verify requester's ownership. Any client can open any run's stream.
- **Path traversal via symlink** — `routes/orchestrator.ts:285-327`. `path.resolve` doesn't follow symlinks; attacker-planted link escapes baseDir.
- **Webhook delivery not idempotent** — See #15.
- **Error handler stack leak (dev) / silent loss (prod)** — `middleware/errorHandler.ts:67-69`. No request-id correlation in prod.
- **Circular DI via setters** — `composition-root.ts:222-224`. Fragile init order.
- **30s graceful shutdown too short** — `index.ts:146-150`. With many SSE clients, forced-kill leaves abrupt disconnects.

#### Medium
- **File-type whitelist no magic bytes** — `routes/orchestrator.ts:217-231`. Binary uploaded as `.json` passes extension filter.
- **Zod validation leaks schema** — `middleware/validate.ts:28-44`. "Expected 'gpt-4' | 'gpt-3.5'" echoes supported models.
- **Replay buffer can send 10k events synchronously** — `packages/streaming/src/SSETransport.ts:67-69`. Blocks event loop.
- **OTel disabled by default** — `composition-root.ts:89-96`. Opt-in is wrong default for prod.
- **Event context resolver falls through** — `routes/multiplexedStream.ts:154-176`. Unknown kinds default to "session" → stale UI routing.
- **Filter param no cap** — `routes/stream.ts:38-39`. `?filter=…×1000` is a free DoS.
- **Triplicated subscription logic** — chat/workflowRun/composition-root. Divergence risk.
- **Query string no global limit** — `app.ts:40-46`. `?x=huge` is a free memory-exhaustion.
- **Git-diff parsing O(n²)** — `routes/orchestrator.ts:643-664`. Linear search per file.

#### Low
- No API versioning; deprecated routes still fully functional; CORS `'*' + credentials:true` possible.
- No per-session SSE connection limit; multer memory storage for 50 MB uploads.
- OTel startup failure silent.

### C. Web frontend (`apps/web`)

#### Critical
- **Event data cast without narrowing** — `stores/sseManager.ts:141`, `672`. `data as Record<string, unknown>` hides shape drift. *Discriminated-union types per kind.*
- **Replay-vs-live dedup race** — `stores/sseManager.ts:802-814`. `lastReplayedSequence` vs `maxSeenSequence - 200` pruning can drop events.
- **Cross-buffer flush non-atomic** — `stores/streamStore.ts:160-183`. Zustand batched `set()` may commit out-of-order, producing duplicated thinking blocks.
- **Blob URL leak** — `HttpPlatformClient.ts:574-587, 629-642`. Delayed `revokeObjectURL` + no error path → leaks on failed download + accumulation under rapid succession.
- **Polling vs SSE inconsistency at completion** — `pages/WorkflowRunPage.tsx:85-89`. 30s refetch can race SSE completion → UI flicker.

#### High
- **Dedup Set pruning off-by-one** — `sseManager.ts:811-816`. Out-of-order late event below threshold silently dropped.
- **Two live EventSource paths** — `sseManager.ts:835-871` + `HttpPlatformClient.ts:228`. Competing connections + watchdog reopening can duplicate events.
- **No per-route error boundary** — `router.tsx:12-24`. Page failure kills sidebar + navigation.
- **ThemeProvider unguarded localStorage** — `ThemeProvider.tsx:32`. SSR-hostile.
- **Aggressive staleTime with SSE invalidations** — `providers/QueryProvider.tsx:12-14`. Brief stale flash on nav.
- **`getOverlappingStages()` O(n²)** — `components/workflow/WorkflowMessages.tsx:59-78`.
- **Chat dedup by content** — `components/chat/ChatView.tsx:67-98`. Fragile on whitespace/edited history.

#### Medium
- Thinking/text flush ordering within a single Zustand batch.
- No auth header injection in `apiFetch.ts`.
- `selectDirectory()` returns null silently.
- `clearRun` cleanup uses `[]` deps — stale data on runId change.
- `setUsage()` ghost entries survive stream clear.
- `connectionStore` unbounded growth.
- No 404 "go back" button.
- Fixed-width right panel overflows at small sizes.

#### Low
- Light ARIA coverage.
- No DAG canvas keyboard navigation.
- Status-badge color contrast unverified against WCAG AA.
- No query cache persistence.
- `_resetForTests` etc. exported in production.
- No bundle-size budget.
- V1/v2 UI components coexist.

### D. CLI (`apps/cli`)

#### Critical
- `--detach` has no polling helper — users must manually run `workflow status`.

#### High
- Composition-root duplicates server — drift risk.
- Subscribe semantic asymmetry — Direct uses `subscribeAll + subscribeGlobal`; HTTP uses per-run/per-session EventSource.
- Synchronous `readdirSync` 10-depth artifact listing — blocks on large workspaces, no `node_modules` filter, no symlink-cycle guard beyond depth.
- `loadConfig` only deep-merges `copilot` and `webhooks` keys; everything else shallow.

#### Medium
- Ctrl+C in HTTP mode exits TUI only — run keeps going server-side. *Call `client.cancelRun` in shutdown.*
- No integration tests for signal/crash recovery.

### E. Copilot-bridge (`packages/copilot-bridge`)

#### Critical
- **Zero tests.**

#### High
- Heavy `as unknown as` / `Record<string, unknown>` casts (`CopilotAdapter.ts:69,196,230,372,397`, `event-mapper.ts:38,43,62`, `tool-factory.ts:22`).
- Unused options `defaultModel`, `defaultTimeoutMs`, `cliPath` accepted but ignored (CopilotAdapter.ts:42-53).
- `resumeConversation` no-ops when handle is in-memory (lines 246-267) — cross-process recovery broken.
- `sendPromptAndWait` has no timeout — caller must enforce via external deadline.

#### Medium
- `conversationListenerCleanups` Set grows per session without pruning.
- `@github/copilot-sdk@^0.1.0` on 0.x semver — any minor bump breaks.
- Permission-kind map hardcoded; new SDK kinds silently → `other`.

### F. Database (`packages/db`)

#### Critical
- No transactions anywhere.
- In-memory sequence counter race across processes.

#### High
- Missing indexes: `chat_messages.chat_id`, `webhook_deliveries.registration_id`, composite `(status, created_at)` on runs.
- JSON columns unvalidated against TS types.
- `migrateDB` runs every boot on potentially massive tables.

#### Medium
- `_debug.cjs` + `_query_cron.cjs` in package root.
- `migrate-v1-to-v2.ts:42` uses private Drizzle internal via type-assert.
- Cascade delete blast-radius on sessions.
- `automation.next_run_at` advisory only — multi-process cron unsafe.
- Zero tests.

#### Low
- WAL backup/restore undocumented.

### G. Shared (`packages/shared`)

#### High
- `deepMerge` no cycle detection (`utils/index.ts:16-44`).
- Batch parser limits hardcoded (10k rows × 100 cols).
- Logger redaction list misses `bearerToken`, `accessToken`, `refreshToken`, `cookie`, `csrf_token`, `aws_secret_access_key`, `private_key_pem` (logging/Logger.ts:18).
- `AgentEvent` discriminated union (~50 kinds) hand-maintained; changes easy to miss.

#### Medium
- Telemetry helpers only 2 test files.
- `OrchestratorConfig` type referenced with no Zod schema.
- `ILogger.child` merges without conflict detection.
- V1 and v2 types duplicate (`Session` vs `SessionStateMachineV2`).

### H. UI + Desktop

Both are empty scaffolds still declared as `workspace:*` deps of web/desktop. If intentional, document it; otherwise remove to stop confusing new contributors.

### I. CI & ops

- Single CI workflow, no security/SAST, no dependency scanning, no bundle budget, no deploy/release pipeline, no agent-tests hook to a running server.
- No health/readiness probe semantics beyond `/health`.
- No container image build.

---

## Priority ordering for fixes

**Sprint 0 — before any user-exposed deployment:**
1. API auth middleware + rate limiting + CORS tightening.
2. Make sandbox fallback opt-in + loud.
3. Fix EventBus DB-failure handling (retry or fail the emit).
4. Fix SessionAllocator ref-count and persist allocations for crash recovery.
5. Add DB transactions around multi-row mutations.
6. Fix webhook idempotency.

**Sprint 1 — correctness:**
7. Fix DAG cache staleness.
8. Fix 30s buffer cleanup.
9. Fix SessionAllocator memory-only state.
10. Tighten SSE backpressure.
11. Fix hook + stage timeout cancellation propagation.
12. Fix startup recovery to clean up sandboxes + polling.

**Sprint 2 — foundation:**
13. Extract shared composition-root module.
14. Consolidate SSE subscription logic.
15. Comprehensive tests on orchestration + hooks + automation + copilot-bridge + streaming.
16. Tool registry + MCP alignment.

**Sprint 3 — UX + observability:**
17. Per-route error boundaries + virtualization on web.
18. OTel on by default; GenAI semantic conventions.
19. Observability dashboard with traces + evals.
20. Retire v1 domain after migration window.
