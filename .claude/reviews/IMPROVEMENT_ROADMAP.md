# Improvement Roadmap

Consolidates the [code review](CODE_REVIEW.md) and [modern-agents comparison](MODERN_AGENTS_COMPARISON.md) into concrete decisions. Each item is classified:

- **REMOVE** — dead/misleading/harmful; delete.
- **OPTIMIZE** — keep the shape, fix specific issues.
- **REDEVELOP** — current implementation is wrong-enough to warrant rewrite; keep the feature.
- **REBUILD TO SOTA** — redesign against modern patterns (durable-exec / MCP / OTel GenAI / sandbox / HITL).
- **KEEP** — works, don't touch.
- **BUILD** — missing, required.
- **BUILD (NICE-TO-HAVE)** — missing, defer.

---

## 1. Remove

1. **`apps/desktop/`** — pure empty scaffold referenced nowhere except as a workspace dep. Delete the directory and drop it from `pnpm-workspace.yaml`.
2. **`packages/ui/`** — empty stub; no file is imported from it. Remove the dependency from `apps/web/package.json` and `apps/desktop/package.json`, delete the package.
3. **`oldDocs/`, `docsOld/`** — stale, already contradicted the code. Delete them so nobody else reads them.
4. **`packages/db/_debug.cjs`, `packages/db/_query_cron.cjs`** — ad-hoc debug scripts; move to `scripts/debug/` or delete.
5. **`apps/cli` v1 legacy commands** (`start`, `stop`, `list`, `status`, `watch`, `chat-legacy`) once v2 migration window closes. They already emit deprecation warnings.
6. **v1 session components in `apps/web/src/components/`** that have v2 equivalents — after v1 API sunset.
7. **`packages/copilot-bridge` unused options** — `defaultModel`, `defaultTimeoutMs`, `cliPath` accepted but ignored. Either wire them or remove.
8. **`DurableStreamManager`** — three other ring-buffer implementations have eclipsed it in the server. Consolidate: keep one canonical streaming transport, remove the rest.
9. **Module-level `runAllSubscribed`, `chatEventSubscribed` guards** in `apps/server/src/routes/*.ts`. Replace with container-level single subscription.
10. **`apps/web/src/platform/HttpPlatformClient.ts#selectDirectory`** — no-op stub. Either implement via File System Access API or throw clearly. Don't silently return null.

## 2. Optimize (same shape, fix specific defects)

### 2.1 DB & persistence
- **Add transactions** around multi-step writes (run+stage_runs creation, stage completion + event persist, automation execution + execution_runs). Use `db.transaction()`.
- **Add missing indexes**: `chat_messages(chat_id)`, `webhook_deliveries(registration_id)`, composite `(status, created_at)` on `workflow_runs` and `stage_runs`.
- **Fix sequence-id allocation**: allocate inside a transaction using `RETURNING` or `AUTOINCREMENT`. Remove in-memory counter.
- **JSON column validation**: validate on load (Zod schema) in each repository instead of blindly casting.
- **Move migrations to versioned files** instead of idempotent boot-time `CREATE IF NOT EXISTS` chains. Use Drizzle-Kit.
- **Stop using private Drizzle internals** in `migrate-v1-to-v2.ts` — use public `db.run()`.
- **Document SQLite WAL backup** (`PRAGMA wal_checkpoint(TRUNCATE);` before copy).

### 2.2 EventBus & streaming
- **Stop `.catch(()=>{})` on eventRepo.insert** — retry with backoff; persist to an `events_deadletter` table after N failures. Surface a metric.
- **Return `false` bubble-up on subscriber error** — emit a `subscriber.error` event with context instead of silent swallow.
- **Collapse the three ring buffers** (DurableStreamManager + per-run + per-chat + multiplexed) into one broker keyed by `(scope, id)` where `scope ∈ {session, run, chat, global}`.
- **Fix 30s per-run buffer auto-clear**: extend to 5–10 min or remove and rely on the persistent `events` table for late reconnect.
- **Add backpressure**: check `res.write()` return; pause broadcast on the connection; wait for `'drain'`.
- **Cap filter parameter** to max 10 prefixes. Cap replay to 100 events synchronously; rest via REST cursor.
- **Monotonic event IDs** per scope instead of per session; emit `id: <scope>:<seq>` so clients can resume per-scope.

### 2.3 Orchestration correctness
- **DAG cache invalidation** — hash definition; invalidate on mismatch; clear from `WorkflowDefinitionService.updateDefinition/addStage/...`.
- **DAG scheduler `withLock`** — log caught errors; propagate critical ones.
- **Extend `ConditionEvaluator`** to support AND/OR/NOT and multi-parent expressions. Use `jsep` + tiny evaluator or a narrow expression language.
- **Extend `WorkflowRunStateMachine` with `user:retry`** from `failed`.
- **Fix `SessionAllocator` ref-count**: destroy at refCount===0.
- **Persist `SessionAllocator` state** or rebuild from the DB during `StartupRecoveryService` so crash doesn't orphan SDK sessions.
- **Cancel underlying work on timeout**: plumb `AbortController` through `IScriptRunner`, `IHttpClient`, `ICopilotPort.sendPromptAndWait`; kill child process / abort fetch / call `copilot.abortConversation` in the timeout catch.
- **Retry-count race fix**: use SQL `UPDATE stage_runs SET retry_count = retry_count + 1 WHERE id = ? AND retry_count = ?` + rowversion, or a single `RETURNING` transaction.
- **Sandbox loud fallback**: require env opt-in `GENERATORAI_ALLOW_HOST_SANDBOX=true`; log ERROR every run otherwise refuse to start without Docker.
- **Sandbox async creation**: replace `MIN_CREATION_INTERVAL_MS` sleep with a concurrency queue.
- **Docker reaper on boot** — enumerate containers matching our label and destroy orphans.
- **Startup recovery** — clear `pollingIntervals`, clean up orphaned containers, and log a summary of (recovered, failed) counts instead of silent marks.

### 2.4 Hooks
- **Propagate timeout**: use `AbortController` for scripts + fetch.
- **Cap hook retry backoff** with `maxBackoffMs`.
- **Make `pre_tool_use` abort actually block** the SDK tool call — requires coordinating with `HookInterceptor` to intercept *before* SDK execution, not after the event.
- **Remove or implement `function` hook** case.

### 2.5 Server
- **Consolidate all event subscriptions** into composition-root; pass a single broadcaster to routes.
- **Webhook idempotency**: dedup by `x-github-delivery` / bearer-delivery-id; 200 OK on replay.
- **Error handler**: always include `requestId` in prod response; log full stack with request-id to Pino so ops can correlate.
- **Path-traversal hardening**: `fs.realpath` + nofollow mount.
- **File magic-byte check** in uploads; reject `.py/.js/.sh` outright for user uploads unless explicitly intended.
- **Global query-string size limit** via `express.urlencoded({parameterLimit:100, limit:'1mb'})`.
- **Extend graceful shutdown** to 60-90s; add per-connection 10s timeout for SSE close.
- **Per-route error boundary on web**; per-session SSE connection cap on server.
- **CORS**: reject `'*'` when `credentials:true`.

### 2.6 Web
- **Discriminated-union event types** — retire `data as Record<string, unknown>`.
- **Virtualize long chat histories** (react-virtual).
- **Lazy-render workflow message sections** per stage; memoize `getOverlappingStages`.
- **Blob-URL lifecycle**: `try/finally` revoke; no arbitrary 5 s delay.
- **ThemeProvider SSR guard** on `localStorage`.
- **Message dedup by ID** instead of content.
- **Per-route error boundary** with "go back" recovery.
- **Bundle-size budget** via `vite-plugin-visualizer` + CI check.
- **Remove test helpers** (`_resetForTests`) from production bundles.

### 2.7 CLI
- **Extract shared composition-root** into a new package or `packages/core/src/bootstrap/` so server and CLI cannot drift.
- **Ctrl+C in HTTP mode** — call `client.cancelRun(runId)` before exit.
- **Async workspace file listing** with filtering (`.gitignore`, `node_modules`, symlink-cycle detection via inode set).
- **Config merge** — use generic `deepMerge` for all nested objects.
- **`--detach` polling helper** — auto `workflow status` every N seconds if no `--json`.

### 2.8 Copilot-bridge
- **Type-safe event data** — narrow `SessionEvent` via discriminated union; remove `as unknown as`.
- **Remove unused options** or wire them (`defaultTimeoutMs` should gate `sendPromptAndWait`).
- **Enforce timeout in `sendPromptAndWait`** with an `AbortSignal`.
- **Pin SDK version** to `~0.1.25` or vendor the current release until 1.0.
- **Fix `resumeConversation`** to always reconcile with SDK when needed for cross-process recovery.
- **Cleanup tracking** — bound listener Set; detect and warn if growing.
- **Generate permission-kind mapping** from SDK enum at build time.

### 2.9 Shared
- **`deepMerge` cycle detection** — maintain visited WeakSet.
- **Logger redaction**: expand list (bearerToken, accessToken, refreshToken, cookie, csrf_token, aws_*_key, private_key_pem) and switch to pattern-based.
- **Generate `AgentEvent` union + zod parser** from a single TOML/JSON source to keep mapper + types + docs in sync.

---

## 3. Redevelop (wrong-enough to warrant a rewrite, but keep the feature)

1. **Streaming layer.** Remove `DurableStreamManager`, remove the three per-route ring buffers, replace with a single `StreamBroker` service on the server that:
   - keys by `(scope, id)` where scope is session/run/chat/global
   - writes to one persistent `stream_cursors` table for resume
   - exposes a unified SSE endpoint with per-scope subscription via query params
   - implements backpressure and `drain` handling
   - reads monotonic per-scope sequence from SQL
2. **`EventBus`** — rewrite as persistent-first: every `emit` goes through a SQL transaction; broadcast happens *after* commit (read-your-writes for SSE). Remove the `.catch(()=>{})`. Persistence is not optional. See Temporal/Inngest journaling pattern.
3. **`SessionAllocator`** — replace in-memory state with DB-persisted allocation table keyed by (runId, stageRunId), with ref-count column and lease TTL. Startup recovery scans for expired leases and releases.
4. **DB migrations** — move to Drizzle-Kit with versioned migration files. Current idempotent-every-boot approach is incompatible with large tables.
5. **`WorkflowPreprocessor` + `GitManager`** — adopt **per-stage `git worktree`** instead of copying per-run workspaces. Shared `.git` object store eliminates `index.lock` contention for parallel stages. See Augment's public blueprint.

## 4. Rebuild to SOTA (new shape, new pattern)

### 4.1 Durable execution
Replace the 1 s polling + in-memory run state with step-memoized durable execution. Options:
- **(Pragmatic)** Adopt **Inngest** (or Hatchet, Trigger.dev) and port `WorkflowRunService` to `step.run`. `step.sleep`, `step.waitForEvent` get us cron + HITL for free. Cost: add a runtime dependency.
- **(Independent)** Implement memoization in-house: hash `{prompt, model, toolArgs, seed}` → cache in `events` table; on retry, skip cached outputs. Adopt LangGraph's `Checkpointer` interface so we can swap backends.

Either way: journal side-effect results, not inputs. Dedup tool calls by `tool_call.id`.

### 4.2 Observability with OTel GenAI semconv
- Emit `gen_ai.*` attributes on every LLM call and tool execution in `StageExecutionService` and `CopilotAdapter`.
- Use `gen_ai.operation.name ∈ {chat, execute_tool, invoke_agent, create_agent}`; `gen_ai.agent.{id,name,version}` tied to stage + definition; `gen_ai.tool.{name, call.id}`.
- Span tree: `agent.invoke` (run level) → `chat` (LLM call) → `execute_tool` (each tool) with W3C traceparent.
- Make OTel enabled by default; fail-fast if `OTEL_ENABLED=true` and exporter unreachable.
- Integrate Langfuse as the default self-host UI (OSS + OTel-native ingest).

### 4.3 Human-in-the-loop
- Add a first-class `await ctx.interrupt(data)` primitive in `StageExecutionService`. Stage transitions to new state `awaiting_input`; UI renders approval UI; POST to `/stages/:id/resume { value }` resumes with injected value.
- Mirror LangGraph's `Command(resume=...)` semantics.
- Persist interrupt payload in `stage_runs.interrupt_data` (new column); persist resume in `chat_messages`.

### 4.4 Resumable streaming
- Switch to AI SDK UI's `resumable-stream` pattern: every chunk gets a monotonic server ID; server persists stream to SQLite; client sends `Last-Event-ID` on reconnect; server replays from cursor.
- Separate consumption vs emission cursor; document cleanup policy (default: keep for 7 days).

### 4.5 Tool registry + MCP
- Define an in-house `Tool` type: `{name, description, inputSchema (zod), execute, requiredPermissions}`.
- Expose an **MCP Streamable-HTTP server** that mounts the registry; clients (Claude Code, Cursor, etc.) can consume it directly.
- Consume external MCP servers: persist MCP server configs in `workflow_definitions.copilot_config.mcpServers`; launch on run start; surface as `mcp__<server>__<tool>` in the prompt.
- Replace the permission-kind translation in `CopilotAdapter` with a unified `Permission` object the registry defines.

### 4.6 Sandbox
- Make Docker the hard default; ship pre-built sandbox image; **fail fast** if Docker missing unless `ALLOW_HOST_FALLBACK=true`.
- Add **E2B as a managed alternative** (provider pattern already exists): `ISandboxProvider` → `E2BSandboxProvider`. Firecracker-grade isolation without self-hosting.
- Per-tool sandbox: script/shell tools execute inside the sandbox via stdin/stdout over a local socket; file operations restricted to the workspace worktree; egress via credential proxy.
- Implement an **egress credential proxy** that injects bearer tokens on allowlisted domains and records usage. Agents never see raw secrets.
- Default-deny outbound network; allowlist (npm, pip, github.com, specific vendor APIs).

### 4.7 Multi-agent coordination
- Add **explicit handoff** — a `HandoffTool` the LLM can invoke to transfer control to another agent within the same run (shared history), distinct from stages (separate context). Model after AutoGen Swarm `HandoffMessage` + OpenAI Agents SDK handoffs.
- Add **subagents** — a `TaskTool` that spawns a child session with fresh context and a focused system prompt; returns final message only. Model after Claude's Task tool.
- Keep DAG stages for deterministic workflows; handoffs/subagents for adaptive ones.

### 4.8 Memory + compaction
- Add `MemoryService` with a **memory tool** exposed to the LLM: `memory.{read,write,list,delete}` against a per-session `/memories` directory. Model after Claude's memory tool.
- Add `PreCompact` hook phase; implement automatic compaction when context approaches limit (summarize transcript + preserve memory files + keep recent turns).
- Add context editing primitive: clear old tool results / thinking blocks, keep structure.

### 4.9 Eval framework
- New package `@generatorai/evals`: dataset + scorer + runner. Scorers: exact match, regex, embedding similarity, LLM-as-judge.
- CI integration: `pnpm eval` runs all evals against a baseline; fail build on regression.
- Ship with `ResultValidator` migrated to the eval framework.
- Online evals: sample N% of production runs; emit scores to Langfuse.

### 4.10 API layer
- Mandatory auth middleware (API key → JWT later). Surface a `/auth/whoami` endpoint.
- Per-user / per-workspace scoping on every resource.
- API versioning: `/api/v2/...` is the public surface; `/api/v1/...` wrapped with Sunset header.
- Rate limits per API key.
- OpenAPI (Zod → OpenAPI via zod-to-openapi) spec for tooling + clients.

### 4.11 DAG v2
- Replace DAG-cache-then-forget with persistent DAG snapshots per run (`workflow_runs.dag_snapshot`). Definition updates never affect in-flight runs.
- Extend condition language (AND/OR/NOT, multi-parent, JSON-path).
- Add **dynamic stage spawning** — a stage can programmatically append children to the DAG (e.g., loop over data-source items as child stages instead of separate automation executions).

---

## 5. Keep (don't touch)

1. **Architectural separation** — `core` domain/services/infrastructure layering, ports+adapters, DI via composition-root.
2. **State machine design** — 5 machines, cleanly typed transitions.
3. **DAG engine shape** — `DAGScheduler + ConditionEvaluator + DAGValidator` (but redevelop cache + extend condition language).
4. **Pino logger + Zod config + telemetry helpers in `shared`** — solid foundations.
5. **System workflow templates** — `templates/system/` is a real asset; codifies opinionated agent workflows.
6. **React Flow DAG visualization + Ink TUI** — differentiators against SDK-only competitors.
7. **SSE over HTTP (vs WebSocket)** — correct for mostly-server-to-client event streams.
8. **SQLite default** — right choice for local-first single-node deployment.
9. **Git preprocessor + feature-branch pattern** — correct primitive, just switch to `git worktree` (see Redevelop).
10. **Observability compose stack** (`docker/observability/`) — ready-made OTel Collector + Jaeger + Prometheus + Loki + Grafana.

## 6. Build (missing and required)

1. **Authentication.** Mandatory API key middleware first; JWT / OAuth2 next; per-user scoping on all resources; audit log.
2. **Rate limiting.** Global + per-endpoint + per-API-key.
3. **Versioning.** `/api/v1` and `/api/v2` URL prefixes; Sunset headers.
4. **Per-route error boundaries on web.**
5. **Step memoization / durable execution.** See §4.1.
6. **`interrupt()` HITL primitive.** See §4.3.
7. **Memory tool + PreCompact hook.** See §4.8.
8. **Tool registry + MCP server.** See §4.5.
9. **Egress credential proxy.** See §4.6.
10. **Handoff + subagent primitives.** See §4.7.
11. **Eval framework + CI integration.** See §4.9.
12. **OTel GenAI instrumentation in `CopilotAdapter` + `StageExecutionService`.** Default-on.
13. **Observability UI.** Either integrate Langfuse or build a thin in-house dashboard that queries the `events` table + OTel spans.
14. **Resumable streaming with cursor.** See §4.4.
15. **Comprehensive test coverage** for: orchestration (orchestrator, preprocessor, result validator), hooks (executor, interceptor), automation (service, data-source resolver, cron), sandbox (lifecycle, docker, host), startup recovery, copilot-bridge (everything), db (migrations, cascades, concurrent writes), streaming.
16. **E2E tests wired into CI** — run agent-tests against a test server in GitHub Actions.
17. **Webhook idempotency (dedup by delivery ID).**
18. **Graceful shutdown that drains SSE properly.**
19. **`StartupRecoveryService` full cleanup** (polling, sandboxes, orphan sessions).
20. **DB transactions** (foundation for everything else).

## 7. Build (nice-to-have, deferrable)

1. **Claude / OpenAI / Bedrock / Vertex providers** alongside Copilot via `ICopilotPort` implementations. Tool registry enables multi-provider.
2. **BYOK UI** — let users plug their own API keys per workspace.
3. **Computer-use / browser-use** tool via Playwright-MCP (post-CVE fix; isolate via egress proxy).
4. **Desktop app** — if still on the roadmap, start from Tauri + existing web UI (nothing under `apps/desktop` is worth keeping). If not on roadmap, delete (see §1).
5. **Packaged UI library** — either populate `packages/ui` by extracting common components from `apps/web`, or delete it.
6. **Multi-tenant workspace model** — projects / teams / roles.
7. **Scheduled run archival + storage tiering** (move old `events` rows to object storage, keep indices hot).
8. **Evals marketplace** — publishable scorer packages.
9. **Template marketplace / registry** — beyond `templates/system/*.json`.
10. **A2A / agent-to-agent protocol** adoption once AP2 / A2A standards stabilize in 2026.
11. **WebAssembly sandbox option** for sub-millisecond cold starts on trusted code.
12. **Live collaboration** (multiple humans watching/steering one run).
13. **Prompt-injection guardrail at egress** (Lakera / Protect AI integration).
14. **Cost tracking per run / per user** (Helicone-style).

---

## Suggested delivery phases

**Phase 0 — security + correctness (1–2 sprints, blocker for any deployment):**
- §6.1, 6.2, 6.17, §2 DB transactions + sequence-id fix, §2 sandbox loud fallback, §2 EventBus reliability, §2 timeout cancellation, §4.10 API versioning.

**Phase 1 — foundation rewrites (2–4 sprints):**
- §3 streaming rewrite, §3 EventBus rewrite, §3 SessionAllocator rewrite, §3 DB migrations, §3 git worktree pattern, §6.15 comprehensive tests.

**Phase 2 — SOTA feature parity (4–8 sprints):**
- §4.1 durable execution, §4.3 HITL, §4.4 resumable streaming, §4.5 tool registry + MCP, §4.7 handoff/subagents, §4.8 memory + compaction.

**Phase 3 — observability + evals (2–4 sprints):**
- §4.2 OTel GenAI, §4.9 evals, §6.13 observability UI.

**Phase 4 — polish + differentiation:**
- §4.6 E2B provider + egress proxy, §4.11 DAG v2 persistent snapshot, §7 nice-to-haves.

The monorepo has good bones. The fastest path to a production-capable platform is Phase 0 (security) + Phase 1 (rewrite the three load-bearing subsystems — streaming, EventBus, SessionAllocator) and then feature work on top.
