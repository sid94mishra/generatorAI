# Implementation Plan — Index

Consolidates all Critical + High findings from [../CODE_REVIEW.md](../CODE_REVIEW.md) into a phased, file-level implementation plan. Medium + Low items are listed for later in [99-backlog-medium-low.md](99-backlog-medium-low.md) (no analysis, just tracked).

## Structure

| File | Scope | Critical | High |
|---|---|---|---|
| [01-core-orchestration.md](01-core-orchestration.md) | `packages/core/` — DAG scheduler, EventBus, SessionAllocator, StageExecution, Hooks, Automation, Sandbox, StartupRecovery | 8 | 22 |
| [02-server-streaming.md](02-server-streaming.md) | `apps/server/` + `packages/streaming/` — auth, SSE, path traversal, webhooks, error handler, DI | 4 | 6 |
| [03-web.md](03-web.md) | `apps/web/` — sseManager, streamStore, blob URLs, error boundaries | 5 | 7 |
| [04-cli-copilot-bridge.md](04-cli-copilot-bridge.md) | `apps/cli/` + `packages/copilot-bridge/` — composition drift, `--detach`, SDK adapter, type casts | 2 | 9 |
| [05-db-shared.md](05-db-shared.md) | `packages/db/` + `packages/shared/` — transactions, sequence race, indexes, JSON validation, redaction, AgentEvent registry | 2 | 7 |
| [99-backlog-medium-low.md](99-backlog-medium-low.md) | Medium + Low items from the review — backlog list only | 30+ | — |

## Effort rollup

| Bucket | Count | Effort |
|---|---|---|
| S (≤½ day) | ~28 | ~10–14 days |
| M (½–2 days) | ~35 | ~30–60 days |
| L (2–5 days) | ~6 | ~15–25 days |
| XL (>5 days) | 0 | — |
| **Total** | **~69 items** | **~55–100 person-days** |

(Variance from parallelization, testing depth, and second-order ripple.)

## Phase-ordered delivery plan

Follows the phases in [../IMPROVEMENT_ROADMAP.md](../IMPROVEMENT_ROADMAP.md). Within each phase, ordering is derived from code dependencies — items earlier in the list unblock later ones.

---

### Phase 0 — Security + correctness (blocker for any deployment). ~15–20 days.

Goal: make the platform safe to expose on anything beyond a trusted local network; stop silent data loss.

| # | Item | File | Sev | Effort |
|---|---|---|---|---|
| 0.1 | API auth middleware (Bearer token; whitelist health + webhooks) | 02 | Critical | M |
| 0.2 | Loud sandbox fallback; `REQUIRE_DOCKER` env var | 01 | Critical | S |
| 0.3 | EventBus DB-failure → retry/dead-letter, no silent drop | 01 | Critical | M |
| 0.4 | DB transactions around multi-row writes (run create, stage completion, automation exec) | 05 | Critical | M |
| 0.5 | SQL-allocated per-session sequence (new `event_sequences` table) | 05 | Critical | M |
| 0.6 | Path traversal via `fs.realpath` (server uploads + stage workspace writes) | 02 + 01 | High | S |
| 0.7 | Webhook idempotency via `delivery_id` dedup | 02 | High | M |
| 0.8 | SessionAllocator ref-count fix (destroy at 0) | 01 | High | S |
| 0.9 | Extend per-run SSE buffer cleanup from 30 s → 5 min (Phase 0 band-aid) | 02 | Critical | S |
| 0.10 | Update web + CLI clients to send auth header (0.1 ripple) | 02 | Critical | M |
| 0.11 | Error handler: always include `requestId` in response | 02 | High | S |
| 0.12 | Circular DI safeguards (null checks + clear init ordering) | 02 | High | S |
| 0.13 | Graceful shutdown 30 s → 60 s + per-conn timeout | 02 | High | S |

Gate for Phase 1: Phase 0 landed + deployed internally; security review passed.

---

### Phase 1 — Subsystem rewrites + reliability. ~20–30 days.

Goal: retire the three load-bearing weak spots — streaming, EventBus, SessionAllocator — and the infrastructure that hides bugs (no tests, no transactions, stale cache).

| # | Item | File | Sev | Effort |
|---|---|---|---|---|
| 1.1 | Versioned DB migrations (`_schema_versions` table; migrateDB becomes incremental) | 05 | High | M |
| 1.2 | Add missing DB indexes (chat_messages.chat_id, webhook_deliveries.registration_id, composite status+created_at) | 05 | High | S |
| 1.3 | Extract shared composition-root into `packages/core/src/bootstrap/Container.ts` | 04 | High | M |
| 1.4 | DAG cache hash-based invalidation + explicit invalidate on WorkflowDefinitionService writes | 01 | Critical | M |
| 1.5 | DAGScheduler `withLock` queue rewrite (no more `.catch(()=>{})`) | 01 | High | M |
| 1.6 | SessionAllocator persistence via new `session_allocations` + `stage_session_maps` tables | 01 | Critical | M |
| 1.7 | StartupRecovery: Docker orphan reaper + polling-interval cleanup + SessionAllocator rehydrate | 01 | Critical | M |
| 1.8 | Sandbox creation queue (replace event-loop sleep) | 01 | High | M |
| 1.9 | Sandbox destroy retry + orphan tracking + periodic cleanup | 01 | High | M |
| 1.10 | Consolidate SSE: move subscriptions into `StreamSubscriptions` container service; remove module-level booleans | 02 | Critical | M |
| 1.11 | SSE backpressure via `res.write()` return + `'drain'` handler | 02 | Critical | M |
| 1.12 | Run-stream cross-contamination fix: enumerate valid session IDs on connect | 02 | High | S |
| 1.13 | Webhook delivery audit table (`webhook_deliveries` with `delivery_id` UNIQUE) | 02 | High | M |
| 1.14 | copilot-bridge test suite (CopilotAdapter, event-mapper, tool-factory) | 04 | Critical | L |
| 1.15 | Discriminated-union extractor `getEventData(kind, data)` for web `sseManager` | 03 | Critical | S |
| 1.16 | Replay-vs-live dedup off-by-one (`<` instead of `<=`) + pruning window | 03 | Critical + High | S |
| 1.17 | Atomic thinking/text flush action in `streamStore` | 03 | Critical | M |
| 1.18 | Blob URL download helper (`try/finally` + delayed revoke) | 03 | Critical | S |
| 1.19 | Polling disable on terminal run status | 03 | Critical | S |
| 1.20 | Per-route `PageErrorBoundary` | 03 | High | M |
| 1.21 | ThemeProvider `localStorage.setItem` guard | 03 | High | S |
| 1.22 | Query staleTime split (event-driven = 0, static = 5 min) | 03 | High | S |
| 1.23 | Cross-process cron via row-level lease (`locked_until` column) | 01 | High | L |
| 1.24 | Propagate AbortSignal through `IScriptRunner`, `IHttpClient`, `ICopilotPort.sendPromptAndWait` — hook + stage + automation timeouts actually cancel | 01 | High | L |
| 1.25 | `incrementRetryCount` optimistic-lock (add `version` column on `stage_runs`) | 01 + 05 | High | M |

Gate for Phase 2: Phase 1 landed; tests green; 24 h soak with 100+ concurrent runs.

---

### Phase 2 — Feature + maintainability. ~15–25 days.

Goal: close maintainability holes surfaced by the review; fix user-facing quirks.

| # | Item | File | Sev | Effort |
|---|---|---|---|---|
| 2.1 | EventBus subscriber isolation + failure tracking (`subscriberFailures` map) | 01 | Critical | S |
| 2.2 | EventBus max listeners configurable + metric; global handlers scope-based | 01 | High | S+M |
| 2.3 | DAG condition evaluator: AND/OR/NOT + multi-parent + parens | 01 | High | M |
| 2.4 | WorkflowRun `user:retry` transition + `POST /workflow-runs/:id/retry` | 01 | High | M |
| 2.5 | Workflow-uploads symlink/hardlink instead of copy | 01 | Critical | M |
| 2.6 | Hook retry backoff cap (`maxBackoffMs` = 60 s) | 01 | High | S |
| 2.7 | Hook `pre_tool_use` suppression of subsequent `tool_complete` | 01 | High | M |
| 2.8 | Hook function-type implementation (or remove if dead) | 01 | High | S |
| 2.9 | Automation cancellation via AbortSignal (replaces soft flag) | 01 | High | M |
| 2.10 | Webhook token rotation API (`POST /automations/:id/rotate-webhook-token`) | 01 | High | S |
| 2.11 | Data-source script output schema validation | 01 | High | M |
| 2.12 | ResultValidator `custom_script` via sandboxed scriptRunner | 01 | High | M |
| 2.13 | Variable interpolation upgrade (dotted paths + recursion limit) | 01 | High | M |
| 2.14 | Preprocessor shell-arg sanitization + docs | 01 | High | M |
| 2.15 | Session state machine: split paused-chat semantics from terminal-chat | 01 | High | S |
| 2.16 | StageExecution unsafe cast → `createEnrichedAgentEvent()` helper | 01 | Critical | M |
| 2.17 | Single source of truth `EVENT_REGISTRY` for AgentEvent (codegen union + Zod parser) | 05 | High | L |
| 2.18 | JSON column validation on read via Zod (all repositories) | 05 | High | M |
| 2.19 | deepMerge cycle detection (`WeakSet`) | 05 | High | S |
| 2.20 | Batch parser limits configurable (env vars) | 05 | High | S |
| 2.21 | Logger redaction list expansion | 05 | High | S |
| 2.22 | copilot-bridge: remove 10+ `as unknown as` casts | 04 | High | M |
| 2.23 | copilot-bridge: remove or implement `defaultModel` / `defaultTimeoutMs` / `cliPath` options | 04 | High | S |
| 2.24 | copilot-bridge `resumeConversation` clarified semantics + cleanup | 04 | High | S |
| 2.25 | copilot-bridge `sendPromptAndWait` internal timeout (default 5 min) | 04 | High | M |
| 2.26 | Web: two-EventSource-path documentation + dedup registry | 03 | High | M |
| 2.27 | Web: WorkflowMessages O(n log n) sweep-line + memoize | 03 | High | M |
| 2.28 | Web: chat dedup by turnId instead of content | 03 | High | M |
| 2.29 | CLI: `--detach` polling helper (`automation execution watch`) | 04 | Critical | S |
| 2.30 | CLI: generalize `loadConfig` deep-merge across all nested objects | 04 | High | S |
| 2.31 | CLI: async readdir + `node_modules`/`.git` exclusions in `DAGProgress` | 04 | High | S |
| 2.32 | CLI ↔ HTTP platform-client subscribe semantic parity | 04 | High | S |

---

## How to use this plan

- Work through the phases in order; do not skip to Phase 1 without landing Phase 0.
- Within a phase, ordering in the table is approximately dependency-aware — earlier items unblock later ones. Exceptions are called out in each subsystem doc.
- Each item links to its subsystem file for the file-level spec.
- After each item: run `pnpm turbo test typecheck lint build` locally, deploy behind a flag if behavior-changing, and verify the acceptance criteria.

## Cross-phase dependency highlights

- **0.1 API auth** → blocks the web/CLI changes in 0.10 and every test fixture update.
- **0.4 transactions + 0.5 sequence allocator** → precondition for 1.10 SSE consolidation (events must persist before broadcast).
- **1.3 shared composition-root** → precondition for clean 1.6 SessionAllocator persistence and 1.23 cron lease (both touch server + CLI wiring).
- **1.24 AbortSignal propagation** → precondition for 2.6, 2.9, 2.25 timeout cancellations.
- **2.17 `EVENT_REGISTRY`** → precondition for 1.15 web-side type narrowing (both want the same source of truth).

## What's explicitly out of scope here

- The §4 "Rebuild to SOTA" items from the roadmap (durable exec, `interrupt()`, resumable streaming cursor, tool registry/MCP, memory + compaction, handoff/subagent, egress credential proxy, OTel GenAI semconv, eval framework). Those are new subsystems, not findings from the code review. They'll want their own design docs before implementation plans.
- Medium + Low items in the review. Tracked in [99-backlog-medium-low.md](99-backlog-medium-low.md) to be pulled in opportunistically.
