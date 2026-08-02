# Phase 3+ Backlog — Consolidated Work Items

Comprehensive task list covering: (a) roadmap items not yet addressed in Phases 0/1/2, (b) partial fixes that need finishing passes, (c) SOTA gaps from the modern-agents comparison, (d) cleanup opportunities, (e) architectural rewrites against 2026 standards.

Each task has a stable ID. Phase-wise sequencing at the end references these IDs.

**Legend**
- **Effort:** XS (<1d), S (1-2d), M (3-5d), L (1-2w+)
- **Source:** `RM §x.y` = IMPROVEMENT_ROADMAP section; `MAC §x` = MODERN_AGENTS_COMPARISON section; `P0-2 partial` = landed partially in earlier phases; `NEW` = surfaced during this audit

---

## 1. Security & Hardening

### SEC-01 · Sandbox loud fallback - 
- **Source:** RM §2.3, MAC §4 Part 4 #8
- **Issue:** `SandboxLifecycleManager` silently falls back to `HostProcessSandboxProvider` (no isolation) when Docker is missing. Users get zero warning that untrusted code is running on the host.
- **Fix:** Require env opt-in `GENERATORAI_ALLOW_HOST_SANDBOX=true`. Log ERROR on every run when host fallback is active. Fail-fast at boot otherwise.
- **Files:** `packages/core/src/services/SandboxLifecycleManager.ts`, `packages/shared/src/config/AppConfig.ts`
- **Effort:** S

### SEC-02 · CORS reject `*` with credentials
- **Source:** RM §2.5
- **Issue:** Current CORS config allows `origin:'*'` together with `credentials:true`, which browsers reject but server accepts — real risk once auth cookies land.
- **Fix:** Read allowlist from config; error on startup if `credentials:true` and origin is `'*'`.
- **Files:** `apps/server/src/app.ts`
- **Effort:** XS

### SEC-03 · Query-string + body size limits
- **Source:** RM §2.5
- **Issue:** No global limits → a malicious client can POST multi-GB bodies or 10k query parameters.
- **Fix:** `express.urlencoded({parameterLimit:100, limit:'10mb'})`, `express.json({limit:'10mb'})`.
- **Files:** `apps/server/src/app.ts`
- **Effort:** XS

### SEC-04 · Per-session SSE connection cap
- **Source:** RM §2.5
- **Issue:** A single session id can open unlimited EventSources — DoS vector against the browser-6-per-origin limit and the server's FD budget.
- **Fix:** Reject new connections with 503 after N (default 6) per session id; metric on rejections.
- **Files:** `apps/server/src/composition/StreamSubscriptions.ts`
- **Effort:** S

### SEC-05 · Path-traversal hardening
- **Source:** RM §2.5
- **Issue:** `resolveWithinBase` prevents `..` traversal but a symlink inside the base pointing outside is still followed.
- **Fix:** Add `fs.realpath` check after `resolveWithinBase`; reject if real path escapes base.
- **Files:** `packages/core/src/utils/safePath.ts`
- **Effort:** S

### SEC-06 · File upload magic-byte check
- **Source:** RM §2.5
- **Issue:** Upload route trusts Content-Type; a `.txt`-named `.exe` slips through.
- **Fix:** Validate magic bytes via `file-type`; blocklist executable extensions (`.py/.js/.sh/.bat/.exe/.ps1/.cmd`) unless explicitly whitelisted by the caller.
- **Files:** apps/server upload routes, new `utils/fileMagic.ts`
- **Effort:** M

### SEC-07 · Rate limiting
- **Source:** RM §6.2
- **Issue:** No rate limit on any endpoint — single API key can burst-flood the server.
- **Fix:** `express-rate-limit` with SQLite store; per-API-key + global budgets; 429 with `Retry-After`; metric `api.rate_limited.total`.
- **Files:** new `apps/server/src/middleware/rateLimit.ts`
- **Effort:** M

### SEC-08 · API versioning
- **Source:** RM §4.10, §6.3
- **Issue:** No `/api/v1` / `/api/v2` discrimination — breaking changes risk client fleet breakage.
- **Fix:** Mount current routes at `/api/v2`; mirror v1 with `Sunset` + `Deprecation` headers and a hardcoded sunset date.
- **Files:** `apps/server/src/routes/index.ts`
- **Effort:** M

### SEC-09 · Graceful shutdown with SSE drain
- **Source:** RM §2.5, §6.18
- **Issue:** SIGTERM kills the process immediately — in-flight runs lose state, SSE clients see a connection reset instead of a graceful close.
- **Fix:** 60-90s shutdown window; send `event: close` to every SSE connection then close; persist in-flight run cursors before exit.
- **Files:** `apps/server/src/index.ts`
- **Effort:** M

### SEC-10 · StartupRecoveryService summary log
- **Source:** RM §2.3, §6.19
- **Issue:** Recovery runs but logs nothing about how many sessions/containers/leases it reclaimed — ops has no visibility.
- **Fix:** Log `{recovered, failed, orphansReaped, leasesReleased, pollingIntervalsCleared}` at boot.
- **Files:** `packages/core/src/services/StartupRecoveryService.ts`
- **Effort:** XS

### SEC-11 · Expanded logger redaction
- **Source:** RM §2.9
- **Issue:** Redaction list covers `apiKey/token/secret/password` but misses `bearerToken`, `accessToken`, `refreshToken`, `cookie`, `csrf_token`, `aws_*_key`, `private_key_pem`.
- **Fix:** Expand list; switch to pattern-based redaction (regex) rather than name matching.
- **Files:** `packages/shared/src/logger/index.ts`
- **Effort:** S

### SEC-12 · Webhook HMAC algorithm pinning
- **Source:** NEW (audit)
- **Issue:** Webhook verification accepts configurable algorithm — MD5 still accepted.
- **Fix:** Pin to SHA-256+; reject weaker algorithms; document allowed set.
- **Files:** `apps/server/src/routes/webhooks.ts`
- **Effort:** XS

---

## 2. Cleanup & Dead-Code Removal

### CLN-01 · Delete `apps/desktop/`
- **Source:** RM §1.1
- **Issue:** Empty scaffold referenced only as a workspace dep. Bloats install and confuses onboarding.
- **Fix:** Remove directory; drop from `pnpm-workspace.yaml`.
- **Effort:** XS

### CLN-02 · Delete `packages/ui/`
- **Source:** RM §1.2
- **Issue:** Empty stub, nothing imports it.
- **Fix:** Remove from `apps/web/package.json` and `apps/desktop/package.json` (the latter also going away via CLN-01); delete package.
- **Effort:** XS

### CLN-03 · Delete `docsOld/` and `oldDocs/`
- **Source:** RM §1.3
- **Issue:** Stale docs that contradicted the real code; the new `.claude/docs/` already supersedes them.
- **Fix:** Delete both directories.
- **Effort:** XS

### CLN-04 · Move or delete debug scripts
- **Source:** RM §1.4
- **Issue:** `packages/db/_debug.cjs` and `_query_cron.cjs` are ad-hoc scripts sitting in a library package.
- **Fix:** Move to `scripts/debug/` or delete.
- **Effort:** XS

### CLN-05 · Implement or throw `HttpPlatformClient.selectDirectory`
- **Source:** RM §1.10
- **Issue:** Silently returns `null` — callers can't distinguish "user cancelled" from "not supported".
- **Fix:** Implement via File System Access API where available, throw `NotSupportedError` otherwise.
- **Files:** `apps/web/src/platform/HttpPlatformClient.ts`
- **Effort:** S

### CLN-06 · Apply `safeJsonColumn` across 14 repositories
- **Source:** P0-2 partial (Phase 2 added the helper but no callers)
- **Issue:** Helper exists in `packages/db/src/utils/safeJsonColumn.ts`; every repo's `mapRow` still blindly trusts Drizzle-parsed JSON. Malformed rows leak into service code.
- **Fix:** Add Zod schemas per JSON column; use `safeJsonColumn(row.col, schema, {fallback, onInvalid: logger.warn})` in every `mapRow`.
- **Files:** `packages/db/src/repositories/*.ts` (14 files)
- **Effort:** M

### CLN-07 · Stop using private Drizzle internals
- **Source:** RM §2.1
- **Issue:** `migrate-v1-to-v2.ts` reaches into Drizzle private APIs — breaks on minor bumps.
- **Fix:** Use public `db.run(sql)` with `drizzle-orm/sql` helpers.
- **Files:** `packages/db/src/migrate-v1-to-v2.ts`
- **Effort:** S

### CLN-08 · Pin Copilot SDK
- **Source:** RM §2.8
- **Issue:** `^0.1.0` accepts any 0.1.x; SDK is pre-1.0 and can break semver at any time.
- **Fix:** Pin to `~0.1.25` until 1.0.
- **Files:** `packages/copilot-bridge/package.json`
- **Effort:** XS

### CLN-09 · Remove test helpers from prod bundle
- **Source:** RM §2.6
- **Issue:** `_resetForTests`, `__TEST__`-prefixed exports ship to prod.
- **Fix:** Vite `define`/`build.rollupOptions.treeshake` to strip; or guard with `import.meta.env.MODE === 'test'`.
- **Files:** `apps/web/vite.config.ts`, store files
- **Effort:** S

### CLN-10 · Sunset v1 CLI commands
- **Source:** RM §1.5
- **Issue:** `start/stop/list/status/watch/chat-legacy` still shipped with deprecation warnings.
- **Fix:** Remove after announced sunset; redirect flags to v2 equivalents where clear.
- **Files:** `apps/cli/src/commands/*.ts(x)`
- **Effort:** M

### CLN-11 · Sunset v1 web session components
- **Source:** RM §1.6
- **Issue:** v1 session views still in `apps/web/src/components/` after v2 WorkflowRun views landed.
- **Fix:** Delete v1 components + stores + routes after v1 API sunset.
- **Files:** `apps/web/src/components/sessions/*`, related stores
- **Effort:** M

### CLN-12 · Remove `DurableStreamManager` + `packages/streaming/`
- **Source:** RM §1.8, blocked by STR-* rewrite
- **Issue:** Three other ring buffers have eclipsed it. Keeping it doubles maintenance.
- **Fix:** After streaming rewrite ships, delete the package and its references.
- **Files:** `packages/streaming/`, imports
- **Effort:** S (after STR-*)

---

## 3. Streaming Rewrite (StreamBroker)

### STR-01 · Design `StreamBroker` service
- **Source:** RM §3.1, MAC §4 Part 4 #3
- **Issue:** Four streaming transports coexist (per-session, per-run, per-chat, global) with divergent dedup, replay, and buffer rules.
- **Fix:** One `StreamBroker` in `packages/core/src/services/`. API: `publish(scope, id, event)`, `subscribe(scope, id, {afterSeq})`, `replay(scope, id, {from, to})`. Scopes = `session | run | chat | global`.
- **Effort:** M

### STR-02 · `stream_cursors` table + per-scope sequences
- **Source:** RM §3.1, §2.2
- **Issue:** Sequences are per-session only. Per-scope resume impossible.
- **Fix:** Add `stream_cursors(scope, scope_id, seq PK, event_id FK, ts)` and `SequenceAllocator.allocate(scope, id)`.
- **Files:** `packages/db/src/schema.ts`, `SequenceAllocator.ts`
- **Effort:** M

### STR-03 · Unified SSE endpoint
- **Source:** RM §3.1
- **Issue:** Four route handlers duplicate identical SSE boilerplate.
- **Fix:** `GET /api/stream?scope=<s>&id=<id>` with `Last-Event-ID` header; server-sent frames include `scope`/`scopeId` attributes. Deprecate old endpoints.
- **Files:** new `apps/server/src/routes/stream.ts`
- **Effort:** L

### STR-04 · Web `sseManager` rewrite against StreamBroker
- **Source:** RM §2.6
- **Issue:** Multiplex logic is intricate and correctness-sensitive (cross-buffer flush bug documented in CLAUDE.md:155-160).
- **Fix:** Single EventSource to `/api/stream`; per-scope routing by the `scope` attribute; dedup by `(scope, seq)`.
- **Files:** `apps/web/src/stores/sseManager.ts`
- **Effort:** M

### STR-05 · Backpressure + slow-consumer handling 
- **Source:** RM §2.2
- **Issue:** `writeSSEFrame` added drain-awaiting (Phase 0) but no timeout for permanently slow consumers.
- **Fix:** Per-connection write queue with high-water mark; drop slow consumers after threshold with `event: slow_consumer_dropped`.
- **Files:** `apps/server/src/composition/sseWrite.ts`
- **Effort:** S

### STR-06 · Cap filter + replay sizes
- **Source:** RM §2.2
- **Issue:** `?filter=a,b,c,...` is unbounded; `afterSeq` can request thousands of events synchronously.
- **Fix:** 400 if filter has > 10 prefixes; cap sync replay at 100 events — remainder via REST cursor.
- **Files:** stream routes
- **Effort:** XS

### STR-07 · Remove 30-s per-run auto-clear
- **Source:** CLAUDE.md known gotcha
- **Issue:** Per-run buffer clears 30s after terminal status; late reconnect silently misses events.
- **Fix:** Delete the timer. Late reconnects hit `stream_cursors` + `events` table for replay.
- **Files:** route handler teardown
- **Effort:** XS

### STR-08 · Resumable-stream semantics (Last-Event-ID)
- **Source:** MAC §4 Part 3 & #3
- **Issue:** No server-side persistent emission cursor.
- **Fix:** Already covered by STR-02/STR-03 but explicit task: confirm Last-Event-ID → `afterSeq` mapping works across restart.
- **Effort:** S

---

## 4. EventBus & Event Typing

### EVT-01 · Commit-then-broadcast
- **Source:** RM §3.2
- **Issue:** Current EventBus broadcasts before SQL commit — SSE clients can see events the REST replay endpoint doesn't yet return.
- **Fix:** Rewrite emit as: SQL insert → commit → broadcast. Guarantees read-your-writes for SSE.
- **Files:** `packages/core/src/events/EventBus.ts`
- **Effort:** M

### EVT-02 · Subscriber error bubble-up
- **Source:** RM §2.2
- **Issue:** Subscriber exceptions are silently swallowed.
- **Fix:** Emit `subscriber.error` event with `{subscriberName, error}`; expose metric `event.subscriber_errors.total`.
- **Files:** `EventBus.ts`
- **Effort:** S

### EVT-03 · Discriminated union `AgentEvent.data`
- **Source:** RM §2.6, §2.8
- **Issue:** `data as Record<string, unknown>` appears dozens of times in web + bridge + core; loses type safety.
- **Fix:** Typed discriminated union in `AgentEvent.ts`; narrow in mapper/router; delete all `as Record<string, unknown>` / `as unknown as` at this boundary.
- **Files:** `packages/shared/src/types/AgentEvent.ts`, web sseManager, copilot-bridge event-mapper, core StageExecutionService
- **Effort:** L

### EVT-04 · Payload Codec for oversized events
- **Source:** MAC §4 Part 4 #12
- **Issue:** Large LLM responses bloat the `events` table; long runs slow queries and balloon DB size.
- **Fix:** If serialized `data` > 256KB, persist blob to `artifactsDir/events/{eventId}.json` and store `{payloadRef}` reference. Reader lazy-loads.
- **Files:** `EventBus.ts`, new `EventPayloadStore`
- **Effort:** M

### EVT-05 · Generate AgentEvent union from single source (2.17 deferred)
- **Source:** RM §2.9
- **Issue:** Event kinds defined in 3 places (type, SDK mapper, web router) — drift risk.
- **Fix:** Single TOML/JSON registry; codegen `AgentEvent` union + Zod parser + mapper scaffolding.
- **Files:** new `tools/event-registry/`, generated outputs
- **Effort:** L

---

## 5. Database & Persistence

### DB-01 · Drizzle-Kit versioned migration files
- **Source:** RM §3.4
- **Issue:** Current approach runs `CREATE IF NOT EXISTS` + numbered migrations on every boot. Incompatible with large tables (ALTER TABLE blocks).
- **Fix:** Migrate to Drizzle-Kit with versioned SQL files; `migrateDB()` applies only pending.
- **Files:** `packages/db/src/index.ts`, new `packages/db/migrations/`
- **Effort:** L

### DB-02 · SQLite WAL backup documentation
- **Source:** RM §2.1
- **Issue:** Users copy the DB file mid-WAL and get a broken backup.
- **Fix:** Document `PRAGMA wal_checkpoint(TRUNCATE);` before copy; provide `pnpm db:backup` script.
- **Files:** `docs/data-model.md`, new `scripts/db-backup.ts`
- **Effort:** XS

### DB-03 · JSON column validation at write
- **Source:** NEW (complements CLN-06 read-side)
- **Issue:** `safeJsonColumn` guards reads; writes are still `as Record<string, unknown>`.
- **Fix:** Validate against same Zod schema on insert/update; throw `ValidationError` on mismatch.
- **Files:** repositories
- **Effort:** M

### DB-04 · Payload offloading table retention policy
- **Source:** Ties to EVT-04
- **Issue:** External blob files accumulate forever.
- **Fix:** Background job deletes blobs where linked event is > 90 days old; config `EVENT_PAYLOAD_TTL_DAYS`.
- **Files:** new `EventPayloadRetentionJob`
- **Effort:** S

---

## 6. Orchestration Correctness

### ORC-01 · AbortController through `IScriptRunner` + `IHttpClient`
- **Source:** RM §2.3 (timeout cancellation)
- **Issue:** Timeouts reject the promise but the child process / fetch keeps running, burning CPU + tokens.
- **Fix:** Plumb `AbortSignal` into both ports; script runner kills child, HTTP client aborts fetch.
- **Files:** `IScriptRunner.ts`, `IHttpClient.ts`, adapters, `SandboxScriptRunner.ts`
- **Effort:** M

### ORC-02 · AbortController in HookExecutor
- **Source:** RM §2.4
- **Issue:** Hook timeouts don't abort underlying script/fetch calls.
- **Fix:** Thread signal through `HookExecutor.run`; cap with `maxBackoffMs` already added in Phase 0.
- **Files:** `HookExecutor.ts`
- **Effort:** S

### ORC-03 · Remove or implement `function` hook case
- **Source:** RM §2.4
- **Issue:** `HookExecutor` has a stubbed `function` branch that throws.
- **Fix:** Either wire an in-process callback registration API or delete the branch with schema update.
- **Files:** `HookExecutor.ts`, hook schemas
- **Effort:** XS

### ORC-04 · Ctrl+C in CLI HTTP mode cancels run
- **Source:** RM §2.7
- **Issue:** CLI SIGINT exits without telling the server; run keeps going.
- **Fix:** `process.on('SIGINT', () => client.cancelRun(currentRunId))` before exit.
- **Files:** `apps/cli/src/commands/workflowRun.tsx`
- **Effort:** S

### ORC-05 · CopilotAdapter listener-leak guard
- **Source:** RM §2.8
- **Issue:** Per-conversation handler Set grows unbounded if cleanups fail.
- **Fix:** Warn when count > 50 per conversation; metric `copilot.listeners.high_water_mark`.
- **Files:** `packages/copilot-bridge/src/CopilotAdapter.ts`
- **Effort:** S

### ORC-06 · Permission-kind mapping generated from SDK
- **Source:** RM §2.8
- **Issue:** Hardcoded `kindToType` map drifts when SDK adds a kind.
- **Fix:** Codegen step reads SDK's enum at build, generates the map, fails build on unmapped kinds.
- **Files:** new `packages/copilot-bridge/src/permissionMap.generated.ts`
- **Effort:** M

---

## 7. Hooks & Interception

### HKS-01 · Hook event-stream integration parity (harness-agnostic)
- **Source:** MAC §4 Part 1
- **Issue:** Claude's 9 hook phases wire directly into the SDK's streaming event stream; our 22 phases don't — hooks fire on lifecycle transitions, not on every token.
- **Fix:** Route the Claude-equivalent phases (`pre_tool_use`, `post_tool_use`,
  `user_prompt_submit`, `stop`, `subagent_stop`, `notification`, `pre_compact`,
  `session_start`, `session_end`) through the event bus so a hook can
  intercept streaming events. **Each harness adapter** bridges its native
  hook surface into these domain phases:
    - Copilot adapter: SDK `OnPreToolUse` → `pre_tool_use`, session events
      → `session_*`, idle/error mapping already partial.
    - Future Claude adapter: direct 1:1 phase mapping.
    - Future OpenAI adapter: emit manually around tool-execution gate.
  This is the foundation for TOL-04 (plan-mode evaluates inside
  `pre_tool_use`) and MEM-03 (`pre_compact`).
- **Files:** `HookExecutor.ts`, `HookInterceptor.ts`, per-adapter bridge
- **Effort:** M
- **Blocks:** TOL-04, MEM-03

### HKS-02 · Guardrail tripwires (input/output/tool)
- **Source:** MAC §4 Part 1 (OpenAI Agents SDK), RM §4.5 (adjacent)
- **Issue:** No first-class guardrails — content-safety checks rely on ad-hoc hooks.
- **Fix:** Add `Guardrail` interface; three levels (input, output, tool); `GuardrailTripwireError` fails stage cleanly with visible reason.
- **Files:** new `packages/core/src/guardrails/`
- **Effort:** M

---

## 8. Custom Tool Layer + MCP

**Framing (revised 2026-04-21).** Copilot SDK is the agent harness today; the
SDK/CLI already ships a rich baseline tool surface (`grep, glob, view, edit,
write, apply_patch, shell, read_bash, write_bash, stop_bash, kill`, MCP
consumption, session hooks, permission prompts). **Reimplementing those
would split the attack surface, confuse the model, and fight the SDK's
sandboxing.** This section therefore governs:

1. Our **custom** tool layer on top of whichever harness is in use.
2. MCP consumption + exposure.
3. Plan-mode / allow-deny policy that layers over the harness's native hooks.

**Harness-agnostic by design.** Every primitive below lives in
`packages/core` as a port (`IAgentHarnessPort` — currently named `ICopilotPort`,
rename deferred until a second harness ships). Adapters per harness
(`copilot-bridge`, future `anthropic-bridge`, `openai-bridge`, …) each
translate the domain types to their vendor's surface:

| Concern | Domain (core) | Copilot adapter | Future Claude/OpenAI adapters |
|---|---|---|---|
| Tool schema | `ToolDefinition` + `CustomToolRegistry` | `defineTool()` via `tool-factory.ts` | Native tool schema of the vendor |
| Permission kinds | `Permission['type']` union (`shell_exec | file_write | file_read | network | other`) | [permissionMap.ts](../packages/copilot-bridge/src/permissionMap.ts) maps `shell/write/read/url/mcp` | Own ORC-06-style map per vendor |
| Pre-tool hook | `HookExecutor` phase `pre_tool_use` | SDK `OnPreToolUse` session hook → routes into HookExecutor | Vendor-equivalent hook or manual gate |
| Permission modes | Domain `PermissionMode` + allow/deny/ask rules | Evaluated inside the SDK `OnPreToolUse` hook before permission prompt | Evaluated by adapter's own gate |
| MCP | `IMcpHub` + persistent `mcpServers` config | SDK native `mcpServers` field | Vendor native or stdio proxy |

Every TOL-* item below names the domain artefact first; adapter notes are
secondary. Adding a new harness is a matter of implementing
`IAgentHarnessPort` + permission kind map + pre-tool hook bridge — zero
changes to the tool registry or MCP layer.

### TOL-01 · Custom-tool registry (`CustomToolRegistry`)
- **Source:** RM §4.5, MAC §4 Part 4 #4
- **Issue:** Custom tools are declared inline per workflow; no shared catalog,
  no permission metadata, no way to register once + reuse across runs.
- **Fix:** Domain `CustomToolRegistry` keyed by name. Entries:
  `{name, description, inputSchema: ZodType, handler, skipPermission?, requiredPermissions?: Permission[], owner}`.
  Adapters read the registry at session-create time and compile entries to
  the vendor's tool format. The Copilot adapter already does this via
  [tool-factory.ts](../packages/copilot-bridge/src/tool-factory.ts); this
  task centralises the registry + metadata in `packages/core/src/tools/`.
  **Note:** SDK issue [github/copilot-sdk#947](https://github.com/github/copilot-sdk/issues/947)
  — `CustomAgentConfig.tools` whitelist currently drops SDK custom tools.
  Track when we land Section 14 (multi-agent handoffs).
- **Files:** new `packages/core/src/tools/`, `composition-root.ts`,
  `packages/copilot-bridge/src/tool-factory.ts` (confirm registry consumption)
- **Effort:** S

### TOL-02 · Domain `Permission` model + custom-tool gating
- **Source:** RM §4.5
- **Issue:** ORC-06 typed the SDK↔domain permission-kind mapping for the
  Copilot adapter. Custom tools still have no declarative permission
  surface — each handler does ad-hoc checks.
- **Fix:** Single domain `Permission` type + allow/deny rule schema in
  `packages/core/src/permissions/`. Custom tools declare
  `requiredPermissions` in the registry (TOL-01); a wrapper enforces them
  before invoking the handler. For native-tool prompts each adapter
  continues to use its own permission-kind map (ORC-06 pattern). Set
  `skipPermission: true` on inherently safe custom tools (passed through to
  the harness when supported — Copilot SDK honours it natively).
- **Files:** new `packages/core/src/permissions/`, `packages/core/src/tools/`
- **Effort:** S

### TOL-03 · ~~Built-in tools registered~~ **(DROPPED — deferred replacement)**
- **Rationale:** The Copilot SDK/CLI already ships `fs/shell/git/url`
  equivalents (`grep, glob, view, edit, write, apply_patch, shell,
  read_bash, write_bash, stop_bash, kill`) with tiered auto/confirm/dangerous
  approval. Future harnesses (Claude Agent SDK, OpenAI Agents) ship their
  own equivalents. Domain duplicates would split the attack surface,
  confuse the model ("which shell?"), and defeat the harness's sandbox
  enforcement.
- **Deferred replacement:** if a future use-case needs harness-agnostic
  domain tools (e.g. `workflow.get_status`, `artifact.list`, `artifact.read`
  so multi-agent flows can introspect their own run), register them through
  TOL-01's `CustomToolRegistry` at that time. Track as MUL-* follow-on.
- **Effort:** —

### TOL-04 · Permission plan-mode + allow/deny/ask rules
- **Source:** MAC §4 Part 1
- **Issue:** No declarative policy layer. Users get one permission prompt
  per call, no "plan before executing", no preset rules.
- **Fix:** Domain defines four modes (`default | acceptEdits | plan | bypassPermissions`)
  and a rule schema (`tool, action, pattern → allow | deny | ask`). Each
  adapter routes its native pre-tool hook into `HookExecutor` and evaluates
  the modes + rules there:
    - **Copilot adapter**: implement via SDK's `OnPreToolUse` session hook
      (returns `{decision: "allow" | "deny"}` **before** the SDK consults
      `onPermissionRequest`). Cleanest layering point.
    - **Future Claude adapter**: map directly to Claude's native modes
      (the same four modes — no translation needed).
    - **Future OpenAI/other adapters**: evaluate inside the adapter's own
      tool-execution gate before firing the tool.
- **Files:** `packages/core/src/permissions/`, `packages/core/src/services/HookExecutor.ts`,
  `packages/copilot-bridge/src/CopilotAdapter.ts` (wire `OnPreToolUse`)
- **Effort:** S
- **Depends on:** HKS-01 (pre-tool hook phase wiring)

### TOL-05 · MCP Streamable-HTTP server (expose our surface)
- **Source:** RM §4.5
- **Issue:** External MCP clients (Claude Code, Cursor, IDE extensions)
  cannot consume our custom/domain tools.
- **Fix:** New `packages/mcp-server/` exposes `CustomToolRegistry` as an
  MCP Streamable-HTTP server. Harness-agnostic — sits above the registry,
  not above any adapter.
- **Depends on:** TOL-01 (registry) and at least one useful tool to expose
  (otherwise this serves an empty registry; revisit when MUL-* adds
  `workflow.*` / `artifact.*` domain tools).
- **Files:** new `packages/mcp-server/`
- **Effort:** M

### TOL-06 · Consume external MCP servers
- **Source:** RM §4.5
- **Issue:** No persistent place to configure per-workflow MCP servers;
  no UI.
- **Fix:** Domain `IMcpHub` interface + persistence schema on
  `workflow_definitions.copilot_config.mcpServers` (already typed in
  `CreateConversationParams.mcpServers` — the SDK accepts it natively, see
  [ICopilotPort.ts:103](../packages/core/src/domain/ports/ICopilotPort.ts#L103)).
  Add web UI to configure servers per workflow + default GitHub-MCP
  template. Adapters pass the resolved config to their vendor — Copilot
  supports native MCP consumption out of the box; Claude Agent SDK also
  supports MCP natively; other vendors bridge via stdio.
- **Files:** `WorkflowPreprocessor.ts` (confirm wiring), `packages/core/src/mcp/`
  (new `IMcpHub`), `apps/web` settings page, schema
- **Effort:** S (down from M — native support in current + planned harnesses
  means the work is persistence + UI, not protocol plumbing)

---

## 9. Sandbox SOTA

### SND-01 · Pre-built Docker sandbox image
- **Source:** RM §4.6
- **Issue:** First-run has to build the image locally; 10+ minutes on cold machines.
- **Fix:** Publish `ghcr.io/generatorai/sandbox:<version>`; compose pulls by tag.
- **Files:** `docker/sandbox/Dockerfile`, CI publish step
- **Effort:** S

### SND-02 · `E2BSandboxProvider`
- **Source:** RM §4.6, MAC §4 Part 3 sandbox table
- **Issue:** Self-hosted Docker is the only option; Firecracker-class isolation needs managed provider.
- **Fix:** Implement `ISandboxProvider` against E2B API (`E2B_API_KEY` config).
- **Files:** new `packages/core/src/infrastructure/E2BSandboxProvider.ts`
- **Effort:** M

### SND-03 · Per-tool sandbox execution
- **Source:** RM §4.6
- **Issue:** Tools like `shell.exec` run in the host process even when a sandbox exists.
- **Fix:** Tool executor sends args over socket into the sandbox; file ops restricted to the stage's worktree.
- **Files:** tool registry + sandbox protocol
- **Effort:** L

### SND-04 · Egress credential proxy
- **Source:** RM §4.6, MAC §4 Part 3 "security checklist"
- **Issue:** Agent process sees raw API keys via env vars; prompt-injection risk.
- **Fix:** Reverse proxy injects bearer tokens on allowlisted domains; agent calls proxy URL with no secret. Log all outbound.
- **Files:** new `packages/egress-proxy/`, sandbox hook
- **Effort:** L

### SND-05 · Default-deny outbound + allowlist
- **Source:** RM §4.6
- **Issue:** Sandbox default-allows network.
- **Fix:** Docker `--network` with strict egress policy; allowlist (npm, pip, github, vendor APIs, user-configured).
- **Files:** sandbox config
- **Effort:** M

### SND-06 · `git worktree` per stage
- **Source:** RM §3.5
- **Issue:** Parallel stages clone the repo fresh — `.git` duplicated, `index.lock` contention on shared paths.
- **Fix:** Shared `.git` object store; `git worktree add` per stage; cleanup on stage end.
- **Files:** `packages/core/src/infrastructure/GitManager.ts`, `WorkflowPreprocessor.ts`
- **Effort:** L

### SND-07 · Prompt-injection guardrail at egress
- **Source:** MAC §4 Part 3
- **Issue:** Agent's outbound LLM calls can exfiltrate data if a prompt-injection succeeded upstream.
- **Fix:** Optional Lakera / Protect AI plug-in in egress proxy; metric on blocked requests.
- **Files:** egress proxy
- **Effort:** M

### SND-08 · gVisor (`runsc`) provider option
- **Source:** MAC §4 Part 3
- **Issue:** Only Docker or host today; gVisor offers Firecracker-adjacent isolation without microVM tooling.
- **Fix:** Adapter selects Docker / gVisor / E2B via config.
- **Files:** `SandboxLifecycleManager.ts`
- **Effort:** S

---

## 10. Durable Execution

### DUR-01 · `Checkpointer` interface
- **Source:** RM §4.1, MAC §4 Part 4 #1
- **Issue:** Retries re-execute from the top of the stage; no memoization. Wastes tokens + time.
- **Fix:** LangGraph-compatible `Checkpointer`: `get(runId, stageId, stepKey)`, `put`, `list`.
- **Files:** new `packages/core/src/checkpoint/Checkpointer.ts`
- **Effort:** M

### DUR-02 · `SqliteCheckpointer` backend
- **Source:** RM §4.1
- **Issue:** Need concrete backing store.
- **Fix:** Table `checkpoints(run_id, stage_run_id, step_key, result_json, ts)`.
- **Files:** `packages/db/src/repositories/CheckpointRepository.ts`, schema
- **Effort:** S

### DUR-03 · Memoize LLM calls by hash
- **Source:** RM §4.1, MAC §4 Part 3 "must persist"
- **Issue:** On retry, we burn tokens redoing the same prompt.
- **Fix:** Key = `sha256(prompt + model + toolArgsHash + seed)`; on replay, skip call if checkpoint exists.
- **Files:** `StageExecutionService.ts`
- **Effort:** M

### DUR-04 · Memoize tool results by `tool_call.id`
- **Source:** MAC §4 Part 3
- **Issue:** Tool replays re-invoke external side effects.
- **Fix:** Use model-emitted `tool_call.id` as idempotency key; cached result returned on retry.
- **Files:** `StageExecutionService.ts`, `HookInterceptor.ts`
- **Effort:** M

### DUR-05 · Durable `step.sleep`
- **Source:** MAC §4 Part 4 #10
- **Issue:** Long-lived agent tasks (wait N minutes, retry later) burn a process.
- **Fix:** Stage in `sleeping` state with `wake_at`; background scheduler wakes; no active process needed.
- **Files:** new `DurableSleepService`, state machine extension
- **Effort:** M

### DUR-06 · Outbox pattern for side effects
- **Source:** MAC §4 Part 4 #11
- **Issue:** Crash between "commit state" and "call external API" duplicates effects on retry.
- **Fix:** Service writes intent to `outbox_events` inside the same tx; background worker publishes with `delivery_id` idempotency.
- **Files:** new `outbox_events` table, `OutboxWorker`
- **Effort:** L

---

## 11. Human-in-the-Loop

### HITL-01 · `awaiting_input` state
- **Source:** RM §4.3, MAC §4 Part 4 #2
- **Issue:** No first-class pause-for-approval. Users stitch it together with hooks.
- **Fix:** New state in `StageRunStateMachine`: transitions `running → awaiting_input → running`.
- **Files:** `StageRunStateMachine.ts`
- **Effort:** S

### HITL-02 · `interrupt_data` column
- **Source:** RM §4.3
- **Issue:** No place to persist the payload that needs approval.
- **Fix:** `stage_runs.interrupt_data JSON` — opaque payload set at interrupt, cleared at resume.
- **Files:** schema, migration
- **Effort:** XS

### HITL-03 · `ctx.interrupt(data)` API
- **Source:** RM §4.3
- **Issue:** Stage code has no primitive to pause.
- **Fix:** `interrupt(data)` inside stage execution persists data, transitions state, awaits resume event.
- **Files:** `StageExecutionService.ts`
- **Effort:** M

### HITL-04 · Resume endpoint
- **Source:** RM §4.3
- **Issue:** No way for a human to inject the approval.
- **Fix:** `POST /api/stages/:id/resume { value }` emits resume event with value.
- **Files:** new `apps/server/src/routes/stages.ts`
- **Effort:** S

### HITL-05 · Web approval UI
- **Source:** RM §4.3
- **Issue:** No UI surface for pending approvals.
- **Fix:** Show interrupts with approve/reject/custom-value controls; call resume endpoint.
- **Files:** new `apps/web/src/components/workflow/InterruptApproval.tsx`
- **Effort:** M

---

## 12. Observability (OTel GenAI semconv)

### OBS-01 · OTel enabled by default
- **Source:** RM §4.2, MAC §4 Part 3
- **Issue:** Opt-in only; default install emits zero telemetry.
- **Fix:** Default-on; fail-fast if `OTEL_ENABLED=true` and exporter unreachable after 3 retries.
- **Files:** `packages/shared/src/telemetry/`
- **Effort:** S

### OBS-02 · `gen_ai.*` attributes on LLM calls
- **Source:** MAC §4 Part 3 required attributes
- **Issue:** Spans exist but lack `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, usage tokens, finish reasons — traces won't correlate in Langfuse/Arize/Datadog.
- **Fix:** Add the full required set in `CopilotAdapter` (see MAC §4 Part 3).
- **Files:** `packages/copilot-bridge/src/CopilotAdapter.ts`
- **Effort:** M

### OBS-03 · `gen_ai.agent.*` on stage invocations
- **Source:** MAC §4 Part 3
- **Issue:** Stage spans exist but no agent metadata.
- **Fix:** Attach `gen_ai.agent.{id,name,version,description}` where id = stage run id, name = stage name.
- **Files:** `StageExecutionService.ts`
- **Effort:** S

### OBS-04 · `gen_ai.tool.*` on tool calls
- **Source:** MAC §4 Part 3
- **Issue:** Tool spans anonymous.
- **Fix:** `gen_ai.tool.{name, call.id, type}`.
- **Files:** tool executor
- **Effort:** S

### OBS-05 · Span tree `agent.invoke → chat → execute_tool`
- **Source:** MAC §4 Part 3 community convention
- **Issue:** Current traces are flat.
- **Fix:** Root span per stage run; children for each LLM call and tool execution; W3C traceparent propagation.
- **Files:** `StageExecutionService.ts`
- **Effort:** M

### OBS-06 · Langfuse self-host compose profile
- **Source:** RM §4.2, MAC §4 Part 3
- **Issue:** No default OSS UI for GenAI traces.
- **Fix:** Add Langfuse + Postgres service to `docker/observability/`; default OTel endpoint points there.
- **Files:** `docker/observability/docker-compose.yml`
- **Effort:** M

### OBS-07 · `OTEL_SEMCONV_STABILITY_OPT_IN` documented
- **Source:** MAC §4 Part 3
- **Issue:** Without this env var, OTel SDK uses pre-experimental attribute names.
- **Fix:** Set to `gen_ai_latest_experimental` in default compose + docs.
- **Files:** compose, docs
- **Effort:** XS

---

## 13. Memory & Compaction

### MEM-01 · `MemoryService` + file-backed `/memories`
- **Source:** RM §4.8, MAC §4 Part 4 #5
- **Issue:** No persistent memory across sessions; context growth is entirely the SDK's problem.
- **Fix:** Per-session `/memories/*.md`; service API `read/write/list/delete`.
- **Files:** new `packages/core/src/services/MemoryService.ts`
- **Effort:** M

### MEM-02 · `memory.*` tool exposed to LLM
- **Source:** RM §4.8
- **Issue:** Agent has no way to use memory even if the store exists.
- **Fix:** Register `memory.{read,write,list,delete}` in tool registry; mark as always-available.
- **Files:** tool registry
- **Effort:** S

### MEM-03 · `PreCompact` hook phase
- **Source:** RM §4.8 (Claude parity)
- **Issue:** Compaction (when it runs, via SDK) is invisible and unhookable.
- **Fix:** New `PreCompact` hook phase; fires before context-window compaction with current transcript.
- **Files:** `HookExecutor.ts`, schemas
- **Effort:** S

### MEM-04 · Automatic compaction
- **Source:** RM §4.8
- **Issue:** No automatic summarize-to-fit; long workflows hit context limit and fail.
- **Fix:** When estimated tokens > threshold, summarize transcript + preserve memory files + keep last N turns.
- **Files:** `StageExecutionService.ts`
- **Effort:** M

### MEM-05 · Context-editing primitive
- **Source:** RM §4.8 (`context-management-2025-06-27`)
- **Issue:** No way to clear old tool results / thinking blocks selectively.
- **Fix:** Expose API that drops specific blocks from the SDK's conversation state.
- **Files:** `CopilotAdapter.ts`
- **Effort:** S

---

## 14. Multi-Agent

### MUL-01 · `HandoffTool`
- **Source:** RM §4.7, MAC §4 Part 4 #6
- **Issue:** No intra-session agent-to-agent handoff with shared history.
- **Fix:** LLM-invokable `handoff.transfer_to(agentName)`; control transfers; history preserved.
- **Files:** tool registry
- **Effort:** M

### MUL-02 · `TaskTool` (subagent)
- **Source:** RM §4.7
- **Issue:** No way to spawn focused child sessions (Claude's Task pattern).
- **Fix:** `task.spawn({prompt, tools, systemMessage})` → fresh-context child session; returns final message only.
- **Files:** tool registry
- **Effort:** M

### MUL-03 · Agent definition surface in schema
- **Source:** NEW
- **Issue:** Handoffs need somewhere to register named agents + their toolsets.
- **Fix:** `workflow_definitions.agents JSON[]` column with `{name, systemMessage, tools[], handoffs[]}`.
- **Files:** schema, type
- **Effort:** S

---

## 15. Evals & Quality Gates

### EVL-01 · `@generatorai/evals` package
- **Source:** RM §4.9, MAC §4 Part 4 #9
- **Issue:** Zero eval framework; no CI gate on agent quality regressions.
- **Fix:** New package with dataset + scorer + runner primitives.
- **Files:** new `packages/evals/`
- **Effort:** M

### EVL-02 · Scorer library
- **Source:** RM §4.9
- **Issue:** No scorers to use.
- **Fix:** Ship `exactMatch`, `regex`, `embedding` (vendor-pluggable), `llmJudge`.
- **Files:** `packages/evals/src/scorers/`
- **Effort:** M

### EVL-03 · Migrate `ResultValidator` to eval framework
- **Source:** RM §4.9
- **Issue:** `ResultValidator` has ad-hoc rules (contains/regex/min_length); duplicates what scorers would do.
- **Fix:** Reimplement on top of eval framework; keep existing rule names as presets.
- **Files:** `packages/core/src/services/ResultValidator.ts`
- **Effort:** S

### EVL-04 · `pnpm eval` + CI gate
- **Source:** RM §4.9
- **Issue:** Manual only.
- **Fix:** `turbo eval` task; `.github/workflows/ci.yml` runs against baseline and fails on regression.
- **Files:** `turbo.json`, package scripts, CI
- **Effort:** S

### EVL-05 · Online sampled-trace scoring
- **Source:** RM §4.9, MAC §4 Part 3
- **Issue:** Prod drift invisible.
- **Fix:** Sample N% of prod runs; emit scores as OTel attributes → Langfuse surfaces them.
- **Files:** new `OnlineEvalSampler`
- **Effort:** M

### EVL-06 · E2E Playwright suite in CI
- **Source:** RM §6.16
- **Issue:** `agent-tests/` exists but never runs in CI.
- **Fix:** CI boots the server; runs `agent-tests/*.spec.ts`; attaches traces on failure.
- **Files:** `.github/workflows/ci.yml`, `agent-tests/`
- **Effort:** M

### EVL-07 · Backfill missing unit tests
- **Source:** RM §6.15
- **Issue:** Coverage uneven — absent on infrastructure (GitManager, script runners), hooks, automation, sandbox, startup recovery, copilot-bridge internals, streaming, db concurrent writes.
- **Fix:** Target 70%+ coverage per package; start with highest-risk (GitManager, hooks, sandbox).
- **Files:** `packages/*/__tests__/`
- **Effort:** L

---

## 16. DAG v2

### DAG-01 · Persistent DAG snapshot per run
- **Source:** RM §4.11, CLAUDE.md known gotcha
- **Issue:** Definition updates corrupt in-flight runs (cached DAG goes stale).
- **Fix:** `workflow_runs.dag_snapshot JSON` captured at run start; scheduler reads snapshot, never live definition.
- **Files:** schema, `WorkflowRunService.createRun`, `DAGScheduler.ts`
- **Effort:** M

### DAG-02 · Dynamic stage spawning
- **Source:** RM §4.11
- **Issue:** Stages can't programmatically append children; batch items become separate executions.
- **Fix:** `ctx.spawnChild({stageDef, variables})` appends to snapshot; scheduler picks up next tick.
- **Files:** DAG engine, stage context
- **Effort:** L

### DAG-03 · Data-source → child stages pattern
- **Source:** RM §4.11
- **Issue:** Each batch row creates a separate automation execution; hard to observe as one unit.
- **Fix:** Optional mode: rows become child stages within one run; shared summary/artifacts.
- **Files:** automation + DAG
- **Effort:** M

---

## 17. Web Polish

### WEB-01 · Virtualize long chat + message histories
- **Source:** RM §2.6
- **Issue:** 10k-message chat re-renders every node on update.
- **Fix:** `@tanstack/react-virtual` in `ChatView` + `WorkflowMessages`.
- **Files:** `apps/web/src/components/chat/ChatView.tsx`, `workflow/WorkflowMessages.tsx`
- **Effort:** M

### WEB-02 · Turn-id-based chat dedup (completes 2.28)
- **Source:** RM §2.6, P0-2 partial
- **Issue:** Content-based dedup collides when same text is sent twice.
- **Fix:** Server emits stable `turnId` on `copilot.turn_started`; persisted on `ChatMessage.metadata.turnId`; web dedups by turnId.
- **Files:** server event emission, `ChatMessage` schema, `ChatView.tsx`
- **Effort:** M

### WEB-03 · Bundle-size budget CI check
- **Source:** RM §2.6
- **Issue:** Bundle grows unchecked.
- **Fix:** `vite-plugin-visualizer` + CI assertion total < 800KB gzipped.
- **Files:** `apps/web/vite.config.ts`, `.github/workflows/ci.yml`
- **Effort:** S

### WEB-04 · ErrorBoundary `home` action verification
- **Source:** NEW — confirm Phase 2 implementation routes correctly
- **Issue:** Need to audit that each lazy-route boundary's "go home" button lands on `/` in all deploy paths.
- **Fix:** Playwright test for the error boundary recovery path.
- **Files:** `agent-tests/error-boundary.spec.ts`
- **Effort:** S

---

## 18. CLI & Developer Ergonomics

### CLI-01 · TUI view for pending approvals (HITL)
- **Source:** Complements HITL workstream
- **Issue:** CLI has no surface for `awaiting_input` stages.
- **Fix:** Ink view that lists pending interrupts, shows payload, hotkeys to approve/reject/value-inject.
- **Files:** `apps/cli/src/tui/views/PendingApprovalsView.tsx`
- **Effort:** M

### CLI-02 · Config generation command
- **Source:** NEW
- **Issue:** First-time setup requires editing `~/.generatorai/config.json` by hand.
- **Fix:** `generatorai init --wizard` walks through config + writes file.
- **Files:** `apps/cli/src/commands/init.tsx`
- **Effort:** S

### CLI-03 · Machine-readable output parity
- **Source:** NEW
- **Issue:** Some commands support `--json`, others don't.
- **Fix:** Audit every command; add `--json` where it makes sense; document in command help.
- **Files:** `apps/cli/src/commands/*.ts(x)`
- **Effort:** M

---

## 19. Automation & Scheduling

### AUT-01 · Cron lease replica safety audit
- **Source:** NEW — verify Phase 1 lease pattern
- **Issue:** Need to confirm that two replicas genuinely cannot double-fire the same cron under clock skew.
- **Fix:** Add integration test booting two instances against the same DB; assert exactly one fire.
- **Files:** new `apps/server/__tests__/cron-multiprocess.test.ts`
- **Effort:** S

### AUT-02 · Data-source resolver idempotency test
- **Source:** NEW
- **Issue:** HTTP data-source retries could double-fetch — no dedup key.
- **Fix:** Hash `{url, headers, body}` → cache result within the execution.
- **Files:** `DataSourceResolver.ts`
- **Effort:** S

### AUT-03 · Automation history retention
- **Source:** NEW
- **Issue:** `automation_executions` grows unbounded.
- **Fix:** Config-driven retention (`AUTOMATION_HISTORY_DAYS`); nightly cleanup job.
- **Files:** new retention job
- **Effort:** S

---

## 20. Multi-Provider (Nice-to-have)

### PRV-01 · Claude / OpenAI / Bedrock / Vertex `IAgentHarnessPort` adapters
- **Source:** RM §7.1
- **Issue:** Locked to GitHub Copilot SDK as the agent harness.
- **Fix:** Implement `IAgentHarnessPort` (current `ICopilotPort`, rename
  once a second adapter lands) against Anthropic + OpenAI APIs. Phase 6
  groundwork (TOL-01/02/04 + HKS-01) means the tool registry, permission
  model, plan-mode, and MCP hub are already harness-agnostic — each new
  adapter only needs to ship:
    1. The port implementation (session lifecycle, prompt, events).
    2. A vendor-specific permission-kind map (ORC-06 pattern — our Copilot
       version is [permissionMap.ts](../packages/copilot-bridge/src/permissionMap.ts)).
    3. A pre-tool hook bridge (HKS-01 pattern) so `HookExecutor` phases
       fire correctly.
    4. MCP wiring — Claude Agent SDK supports MCP natively; OpenAI/Bedrock/
       Vertex bridge via stdio proxy.
- **Files:** new `packages/anthropic-bridge/`, `packages/openai-bridge/`,
  rename `ICopilotPort` → `IAgentHarnessPort` (core)
- **Effort:** L
- **Depends on:** TOL-01, TOL-02, TOL-04, HKS-01 _(all of these unblock this
  work by lifting harness-specific logic into per-adapter translators)_

### PRV-02 · BYOK per-workspace UI
- **Source:** RM §7.2
- **Issue:** No user-facing key management.
- **Fix:** Encrypted `workspace_secrets` table; settings UI per workspace.
- **Files:** schema, web settings page
- **Effort:** M

---

## 21. Documentation Debt

### DOC-01 · Public-facing API reference (OpenAPI)
- **Source:** RM §4.10
- **Issue:** No OpenAPI spec; clients / integrators must read route code.
- **Fix:** Zod schemas → OpenAPI via `zod-to-openapi`; serve at `/api/openapi.json`; Stoplight UI at `/api/docs`.
- **Effort:** M

### DOC-02 · Architecture diagrams refresh
- **Source:** NEW
- **Issue:** After streaming + EventBus + SessionAllocator rewrites, current `.claude/docs/architecture.md` will be inaccurate.
- **Fix:** Update after Phase 4 lands.
- **Effort:** S

### DOC-03 · Deployment guide
- **Source:** NEW
- **Issue:** No production deployment docs (reverse proxy, TLS, rate limits, observability, backup).
- **Fix:** New `docs/deployment.md`.
- **Effort:** S

---

# Phase Plan

Each phase is a coherent deliverable. IDs listed are the tasks that belong in that phase. Effort estimates sum approximately and assume a single engineer.

## Phase 3 — Production readiness (~2 sprints)

**Goal:** make the server safe to deploy outside localhost. Ship-blocker for external users.

| Category | IDs |
|---|---|
| Security | SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-12 |
| Cleanup (low-risk deletes) | CLN-01, CLN-02, CLN-03, CLN-04, CLN-08 |
| Correctness finishing | ORC-01, ORC-02, ORC-03, ORC-04, ORC-05 |
| Documentation | DOC-03 |

**Exits when:** server refuses insecure configs, rate-limited, versioned, drains cleanly on shutdown; AbortSignal plumbed end-to-end; dead workspaces gone.

## Phase 4 — Streaming + EventBus rewrite (~2 sprints)

**Goal:** kill the 4-transport streaming sprawl and make events persistent-first. Load-bearing for every Phase 5+ feature.

| Category | IDs |
|---|---|
| Streaming | STR-01, STR-02, STR-03, STR-04, STR-05, STR-06, STR-07, STR-08 |
| EventBus | EVT-01, EVT-02, EVT-03, EVT-04 |
| Cleanup (post-rewrite) | CLN-05, CLN-06, CLN-07, CLN-09, CLN-12 |
| DB | DB-01, DB-02 |
| Web | WEB-02 (turnId — depends on EVT-03) |
| Docs | DOC-02 |

**Exits when:** one `StreamBroker`, one SSE endpoint, Last-Event-ID across restart works, `as unknown as` gone from event path, 14 repositories use `safeJsonColumn`.

## Phase 5 — Durable execution + HITL (~3 sprints)

**Goal:** Temporal-class replay guarantees + LangGraph-class HITL. Unlocks long-running + human-approval workflows.

| Category | IDs |
|---|---|
| Durable | DUR-01, DUR-02, DUR-03, DUR-04, DUR-05, DUR-06 |
| HITL | HITL-01, HITL-02, HITL-03, HITL-04, HITL-05 |
| CLI | CLI-01 |
| EventBus | EVT-05 |
| DB | DB-03, DB-04 |

**Exits when:** retries skip memoized work; `interrupt()/resume` primitive exposed end-to-end (API + web UI + TUI); outbox guarantees exactly-once side effects.

## Phase 6 — Custom tool layer + MCP + Sandbox SOTA (~2-3 sprints)

**Goal:** Harness-agnostic custom tool registry, plan-mode + allow/deny
rules layered over the active harness's native hook surface, MCP in and
out, E2B-class sandbox isolation.

| Category | IDs |
|---|---|
| Custom tools + MCP | TOL-01, TOL-02, TOL-04, TOL-05, TOL-06 _(TOL-03 dropped — harness already ships base tools)_ |
| Sandbox | SND-01, SND-02, SND-03, SND-04, SND-05, SND-06, SND-07, SND-08 |
| Hooks | HKS-01 _(pre-tool bridge; TOL-04 depends on this)_, HKS-02 |
| Bridge | ORC-06 |

**Exits when:** custom tools are declared once in `CustomToolRegistry` and
consumed by whichever harness is active; plan-mode + guardrails work via
the adapter's pre-tool hook; per-workflow MCP servers configurable from
the web UI; Docker + gVisor + E2B providers selectable; per-stage git
worktrees; credential proxy live.

## Phase 7 — Observability + Evals (~2 sprints)

**Goal:** default-on OTel with GenAI semconv; CI eval gate blocking quality regressions.

| Category | IDs |
|---|---|
| Observability | OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07 |
| Evals | EVL-01, EVL-02, EVL-03, EVL-04, EVL-05, EVL-06, EVL-07 |
| Web | WEB-03, WEB-04 |
| Automation | AUT-01, AUT-02 |
| Docs | DOC-01 |

**Exits when:** traces surface in Langfuse with `gen_ai.*` attributes; `pnpm eval` CI step gates merges; E2E Playwright in CI.

## Phase 8 — Memory + Multi-agent (~2 sprints)

**Goal:** long-running agents + multi-agent coordination.

| Category | IDs |
|---|---|
| Memory | MEM-01, MEM-02, MEM-03, MEM-04, MEM-05 |
| Multi-agent | MUL-01, MUL-02, MUL-03 |
| Web | WEB-01 |
| CLI | CLI-02, CLI-03 |

**Exits when:** agents persist state across sessions; handoffs + subagents work end-to-end; UI scales to long histories.

## Phase 9 — DAG v2 + polish (~1-2 sprints)

**Goal:** eliminate known DAG caching gotchas; enable dynamic workflows.

| Category | IDs |
|---|---|
| DAG | DAG-01, DAG-02, DAG-03 |
| Automation | AUT-03 |
| Cleanup (v1 sunset) | CLN-10, CLN-11 |

**Exits when:** in-flight runs are immune to definition changes; stages spawn children programmatically; v1 surface removed.

## Phase 10 — Multi-provider + BYOK (nice-to-have, ~2 sprints)

**Goal:** break vendor lock-in.

| Category | IDs |
|---|---|
| Providers | PRV-01, PRV-02 |

---

# Delivery summary

| Phase | Focus | Sprints | Risk of blocking next phase |
|---|---|---|---|
| 3 | Security / correctness | 2 | None — all additive |
| 4 | Streaming rewrite | 2 | **HIGH** — foundation for 5+ |
| 5 | Durable + HITL | 3 | Medium |
| 6 | Tools + sandbox | 3 | Medium |
| 7 | Observability + evals | 2 | Low |
| 8 | Memory + multi-agent | 2 | Low |
| 9 | DAG v2 + sunset | 1-2 | None |
| 10 | Multi-provider | 2 | None — optional |

**Total:** ~17-18 sprints to full SOTA parity + production hardening from current `dev` branch state.

**Fastest path to production (no SOTA features):** Phase 3 only (~2 sprints). Everything downstream is feature work that can ship incrementally.

**Recommended immediate action:** Phase 3 (SEC-* + ORC-* + low-risk CLN-*). These tasks are well-specified, additive, and block deployment.
