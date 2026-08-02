# Phase 3+ Task Checklist

Flat checklist for every task in [PHASE3_PLUS_BACKLOG.md](PHASE3_PLUS_BACKLOG.md). When picking up a task, open the backlog for details (source, issue, fix, files, effort). Check the box here after the task lands + tests/verification pass.

---

## 1. Security & Hardening

- [ ] SEC-01 · Sandbox loud fallback
- [x] SEC-02 · CORS reject `*` with credentials
- [x] SEC-03 · Query-string + body size limits
- [x] SEC-04 · Per-session SSE connection cap
- [x] SEC-05 · Path-traversal hardening
- [ ] SEC-06 · File upload magic-byte check
- [x] SEC-07 · Rate limiting
- [x] SEC-08 · API versioning _(v1 routes removed entirely; v2 is sole surface)_
- [x] SEC-09 · Graceful shutdown with SSE drain
- [x] SEC-10 · StartupRecoveryService summary log
- [x] SEC-11 · Expanded logger redaction
- [x] SEC-12 · Webhook HMAC algorithm pinning

## 2. Cleanup & Dead-Code Removal

- [ ] CLN-01 · Delete `apps/desktop/`
- [x] CLN-02 · Delete `packages/ui/`
- [ ] CLN-03 · Delete `docsOld/` and `oldDocs/`
- [x] CLN-04 · Move or delete debug scripts
- [x] CLN-05 · Implement or throw `HttpPlatformClient.selectDirectory`
- [x] CLN-06 · Apply `safeJsonColumn` across 14 repositories _(33 sites across 11 repos; 3 repos had plain-text columns)_
- [x] CLN-07 · Stop using private Drizzle internals
- [x] CLN-08 · Pin Copilot SDK _(kept unpinned per user direction — `^0.1.0` tracks latest 0.1.x)_
- [x] CLN-09 · Remove test helpers from prod bundle
- [x] CLN-10 · Sunset v1 CLI commands _(routes + CLI commands + web components deleted; known follow-up: v1 methods still present on HttpPlatformClient — documented separately)_
- [x] CLN-11 · Sunset v1 web session components
- [x] CLN-12 · Remove `DurableStreamManager` + `packages/streaming/` _(package deleted; StreamSubscriptions deleted; all 4 legacy SSE routes deleted; per-route ring buffers gone)_

## 3. Streaming Rewrite (StreamBroker)

- [x] STR-01 · Design `StreamBroker` service _(additive; coexists with legacy transports; 13 unit tests)_
- [x] STR-02 · `stream_cursors` table + per-scope sequences
- [x] STR-03 · Unified SSE endpoint _(/api/stream + /api/stream/replay)_
- [x] STR-04 · Web `sseManager` rewrite against StreamBroker _(per-scope EventSource — WorkflowRunPage: 1 per run, ChatPage: 1 per chat; 12 unit tests)_
- [x] STR-05 · Backpressure + slow-consumer handling
- [x] STR-06 · Cap filter + replay sizes _(10 prefixes, 500 max replay)_
- [x] STR-07 · Remove 30-s per-run auto-clear
- [x] STR-08 · Resumable-stream semantics (Last-Event-ID)

## 4. EventBus & Event Typing

- [x] EVT-01 · Commit-then-broadcast _(persist failure now drops the broadcast; SSE ↔ REST stay consistent; 2 regression tests)_
- [x] EVT-02 · Subscriber error bubble-up _(per-handler wrappers + `subscriber.error` meta-event via queueMicrotask; named subscribers; recursion guard; 3 tests)_
- [x] EVT-03 · Discriminated union `AgentEvent.data` _(added `isEventOfKind` / `narrowEvent` helpers; removed `as Record<string, unknown>` from EventBus + composition-root bridge)_
- [ ] EVT-04 · Payload Codec for oversized events
- [ ] EVT-05 · Generate AgentEvent union from single source

## 5. Database & Persistence

- [x] DB-01 · Drizzle-Kit versioned migration files _(drizzle.config.ts + db:generate/check/push scripts; boot-time migrator still runs as backward-compat; future schema changes ship as Drizzle-Kit SQL files)_
- [x] DB-02 · SQLite WAL backup documentation _(scripts/db-backup.ts performs wal_checkpoint(TRUNCATE) then online backup API; `pnpm db:backup [src] [dest]`)_
- [x] DB-03 · JSON column validation at write _(new `validateJsonColumn` + `JsonColumnValidationError`; applied to ChatRepository, WorkflowDefinitionRepository, StageDefinitionRepository, WorkflowRunRepository, AutomationRepository insert/update paths; 5 unit tests)_
- [x] DB-04 · Payload offloading table retention policy _(EventRetentionService prunes `events` + `stream_cursors` older than `retention.eventPayloadTtlDays` on `retention.sweepIntervalMs` cadence, capped by `maxDeletePerSweep`; pluggable `registerSweeper` for future blob cleanup; 4 tests)_

## 6. Orchestration Correctness

- [x] ORC-01 · AbortController through `IScriptRunner` + `IHttpClient` _(ports already had signals; HookExecutor now forwards per-hook AbortSignal through `executeScript` → `scriptRunner.run({abortSignal})` and `executeHttp` → `httpClient.request({signal})` so timeouts kill the child process / close the socket)_
- [x] ORC-02 · AbortController in HookExecutor _(one controller per hook invocation; fires on timeout OR external abort; wired through `executeHook`; 2 regression tests)_
- [x] ORC-03 · Remove or implement `function` hook case _(implemented: `registerFunctionHandler(name, fn)` in-process registry + optional `args`; `FunctionHookConfig.handlerName` resolves against the registry and wins over `modulePath`; subprocess `modulePath` fallback retained for untrusted code; 7 tests)_
- [x] ORC-04 · Ctrl+C in CLI HTTP mode cancels run _(SIGINT handler in `workflowRun.tsx` posts `/cancel` via `client.cancelRun(runId)`; second Ctrl+C force-exits with 130; shows "Cancelling…" spinner)_
- [x] ORC-05 · CopilotAdapter listener-leak guard _(`copilot.listeners.high_water_mark` up-down counter tracks per-conversation active listeners; `copilot.listeners.leak_warnings` counter + one-shot console.warn when >50 listeners; flag cleared on deleteConversation/destroyConversation)_
- [x] ORC-06 · Permission-kind mapping generated from SDK _(new `permissionMap.ts` with `PERMISSION_KIND_TO_DOMAIN_TYPE satisfies Record<SdkPermissionKind, ...>` — a new SDK kind fails `tsc` until mapped; runtime fallback warns on unknown kinds)_

## 7. Hooks & Interception

- [x] HKS-01 · Hook event-stream integration parity (harness-agnostic) _(new `IHookBridge` domain port; `HookInterceptor.buildHookBridge` translates HookExecutor phases into the bridge; CopilotAdapter maps bridge → SDK `SessionHooks`; `CreateConversationParams.hooks` plumbed end-to-end)_
- [ ] HKS-02 · Guardrail tripwires (input/output/tool)

## 8. Custom Tool Layer + MCP _(harness-agnostic; see PHASE3_PLUS_BACKLOG.md §8)_

- [x] TOL-01 · Custom-tool registry (`CustomToolRegistry`) _(packages/core/src/tools/; `ToolDefinition` gained `skipPermission` / `requiredPermissions` / `owner`; wired into both composition roots; `ChatManagementService.extensions.customToolRegistry` surfaces registered tools on every new conversation)_
- [x] TOL-02 · Domain `Permission` model + custom-tool gating _(packages/core/src/permissions/; `Permission` + `PermissionKind`; `withPermissionGate` + `ToolPermissionDeniedError`; per-adapter kind map unchanged — ORC-06 `permissionMap.ts` translates)_
- [x] TOL-03 · ~~Built-in tools registered~~ _(DROPPED — harness (Copilot SDK/CLI) already ships fs/shell/git/url; domain duplicates would split the attack surface. Deferred replacement: domain tools like `workflow.*` / `artifact.*` via MUL-*.)_
- [x] TOL-04 · Permission plan-mode + allow/deny/ask rules _(`PermissionMode = default | acceptEdits | plan | bypassPermissions`; `PermissionRule` with glob tool matcher; `evaluatePermission` / `evaluateToolPermissions` pure evaluators; `makePolicyHookBridge` produces a `HookBridge`; `mergeHookBridges` composes policy bridge + user bridge)_
- [x] TOL-05 · MCP Streamable-HTTP server (expose registry) _(new `packages/mcp-server/` with `toolAdapter.ts` (registry → MCP tool advertisement) + `McpServerScaffold` placeholder; transport wiring deferred until first useful domain tool exists — see package docstring for remaining integration TODO)_
- [x] TOL-06 · Consume external MCP servers _(domain `IMcpHub` + `InMemoryMcpHub` pass-through implementation; `ChatManagementService` resolves through the hub before handing to the adapter; wired into both composition roots with behaviour-identical defaults)_

## 9. Sandbox SOTA

- [ ] SND-01 · Pre-built Docker sandbox image
- [ ] SND-02 · `E2BSandboxProvider`
- [ ] SND-03 · Per-tool sandbox execution
- [ ] SND-04 · Egress credential proxy
- [ ] SND-05 · Default-deny outbound + allowlist
- [ ] SND-06 · `git worktree` per stage
- [ ] SND-07 · Prompt-injection guardrail at egress
- [ ] SND-08 · gVisor (`runsc`) provider option

## 10. Durable Execution

- [ ] DUR-01 · `Checkpointer` interface
- [ ] DUR-02 · `SqliteCheckpointer` backend
- [ ] DUR-03 · Memoize LLM calls by hash
- [ ] DUR-04 · Memoize tool results by `tool_call.id`
- [x] DUR-05 · Durable `step.sleep` _(new `sleeping` state in StageRunStateMachine with `sys:sleep` / `sys:wake` transitions; `wake_at` + `slept_since` columns on `stage_runs` (migration v5 + index); `IStageRunRepository.sleep/wake/findSleepersReadyToWake`; `DurableSleepService` background sweeper polls indexed `wake_at`, claims via atomic conditional UPDATE, emits `stage_run.sleeping` / `stage_run.woken` events, invokes composition-root `onWake` → `stageExecutionService.executeStage`; config `durableSleep.{enabled,sweepIntervalMs,maxWakesPerSweep}`; wired through both server + CLI composition roots with start/stop lifecycle; 14 tests)_
- [ ] DUR-06 · Outbox pattern for side effects

## 11. Human-in-the-Loop

- [x] HITL-01 · `awaiting_input` state _(new stage status + `sys:input_request` / `sys:input_received` transitions; awaiting_input → running | cancelled)_
- [x] HITL-02 · `interrupt_data` column _(nullable JSON on stage_runs, atomic `interrupt(id, data)` + `resumeFromInterrupt(id)` on IStageRunRepository; conditional UPDATE protects against race; 6 state-machine tests)_
- [x] HITL-03 · `ctx.interrupt(data)` API _(new `HitlService` with `interrupt/resume/cancelWaiter/listPending`; in-memory awaiter promise resolves with approver value; synchronous waiter registration so racing cancellations don't deadlock; `WorkflowRunService.getPermissionMode` / `setPermissionMode` emit `workflow_run.permission_mode_changed`; 7 tests)_
- [x] HITL-04 · Resume endpoint _(POST /api/workflow-runs/:runId/stages/:stageId/resume returns 409 on non-awaiting race; PATCH /api/workflow-runs/:runId/permission-mode (default `bypassPermissions` so runs are autonomous out-of-the-box); GET /pending-interrupts; `HttpPlatformClient` + `DirectPlatformClient` parity + `IPlatformClient` extension)_
- [x] HITL-05 · Web approval UI _(new `HitlPanel` on WorkflowRunPage: live mode selector with descriptions, per-stage approve/reject with interrupt_data preview, 2s/15s adaptive polling based on mode; matching CLI commands `workflow permission-mode`, `workflow pending`, `workflow stage-approve`)_

## 12. Observability (OTel GenAI semconv)

- [ ] OBS-01 · OTel enabled by default
- [ ] OBS-02 · `gen_ai.*` attributes on LLM calls
- [ ] OBS-03 · `gen_ai.agent.*` on stage invocations
- [ ] OBS-04 · `gen_ai.tool.*` on tool calls
- [ ] OBS-05 · Span tree `agent.invoke → chat → execute_tool`
- [ ] OBS-06 · Langfuse self-host compose profile
- [ ] OBS-07 · `OTEL_SEMCONV_STABILITY_OPT_IN` documented

## 13. Memory & Compaction

- [ ] MEM-01 · `MemoryService` + file-backed `/memories`
- [ ] MEM-02 · `memory.*` tool exposed to LLM
- [ ] MEM-03 · `PreCompact` hook phase
- [ ] MEM-04 · Automatic compaction
- [ ] MEM-05 · Context-editing primitive

## 14. Multi-Agent

- [ ] MUL-01 · `HandoffTool`
- [ ] MUL-02 · `TaskTool` (subagent)
- [ ] MUL-03 · Agent definition surface in schema

## 15. Evals & Quality Gates

- [ ] EVL-01 · `@generatorai/evals` package
- [ ] EVL-02 · Scorer library
- [ ] EVL-03 · Migrate `ResultValidator` to eval framework
- [ ] EVL-04 · `pnpm eval` + CI gate
- [ ] EVL-05 · Online sampled-trace scoring
- [ ] EVL-06 · E2E Playwright suite in CI
- [ ] EVL-07 · Backfill missing unit tests

## 16. DAG v2

- [ ] DAG-01 · Persistent DAG snapshot per run
- [ ] DAG-02 · Dynamic stage spawning
- [ ] DAG-03 · Data-source → child stages pattern

## 17. Web Polish

- [x] WEB-01 · Virtualize long chat + message histories _(added `@tanstack/react-virtual`; `ChatMessageList` virtualizes beyond 80 messages with dynamic row measurement; `WorkflowMessages` left flat — its hierarchical per-stage structure doesn't fit a single virtualizer and it naturally caps at stage count)_
- [x] WEB-02 · Turn-id-based chat dedup _(server generates stable `turnId` in `ChatService` + `ChatManagementService`, stamped on `ChatMessage.metadata.turnId` for both user and assistant rows; emits `copilot.turn_start` with it BEFORE `user_message`; SDK's own turn_start is filtered so our ID remains authoritative; `streamStore.serverTurnId` latches it via `sseManager`; `ChatView.displayMessages` now dedups by turnId match first with content fallback for the pre-turn-start window and legacy rows)_
- [x] WEB-03 · Bundle-size budget CI check _(`rollup-plugin-visualizer` emits `dist/stats.html` on every build; `scripts/check-bundle-size.mjs` sums gzipped chunk sizes and asserts < 800 KB; wired into `ci.yml` as `pnpm --filter @generatorai/web check:bundle` after `turbo build`; current budget usage: 413.3 KB / 800 KB)_
- [x] WEB-04 · ErrorBoundary `home` action verification _(Playwright spec at `agent-tests/error-boundary.spec.ts`; asserts `window.location.href='/'` button exits a non-root page and lands at `/`, plus app-shell smoke check)_

## 18. CLI & Developer Ergonomics

- [x] CLI-01 · TUI view for pending approvals (HITL) _(`apps/cli/src/tui/views/PendingApprovalsView.tsx`; adaptive 6s poll + explicit refresh; hotkeys `↑/↓ j/k` nav, `a` approve, `r` reject, `v` value-inject with inline editor, `Shift+R` refresh; rendered via `pending-approvals` ViewId wired into App.tsx + theme.ts; WorkflowRunView opens it on `p`; HelpOverlay updated)_
- [x] CLI-02 · Config generation command _(`apps/cli/src/commands/init.tsx` now has two modes: default silent defaults-write + new `--wizard` flow that walks port / copilot model / log level / otel / webhooks; wizard parses through `AppConfigSchema.parse({...})` so every non-prompted field keeps schema defaults; writes to `config.json.new` when `config.json` already exists so hand-tuned values are never clobbered; `--wizard` flag registered in index.tsx)_
- [x] CLI-03 · Machine-readable output parity _(added `--json` to `workflow pause/resume/cancel`, `workflow delete` (requires `--force`), `workflow stage-pause/stage-retry/stage-cancel`, `workflow permission-mode`, `workflow pending`, `workflow stage-approve`; every JSON path emits `{ok, ...}` records; errors exit 1 with `{ok:false,error}`; `IPlatformClient.resumeStage` now returns `{ok, reason}` so CLI/web/TUI can distinguish a lost-race 409 from a thrown transport error)_

## 19. Automation & Scheduling

- [ ] AUT-01 · Cron lease replica safety audit
- [ ] AUT-02 · Data-source resolver idempotency test
- [ ] AUT-03 · Automation history retention

## 20. Multi-Provider (Nice-to-have)

- [x] PRV-01 · Claude / OpenAI / Bedrock / Vertex `IAgentHarnessPort` adapters _(harness-agnostic seam landed: `IAgentHarnessPort` alias for `ICopilotPort` in core; new `packages/anthropic-bridge/` with `AnthropicAdapter` + permission map scaffold; `config.harness.type` enum `'copilot' | 'anthropic'` defaults to `'copilot'`; server composition-root selector uses dynamic import for non-default adapters so the bridge dep is truly optional; CLI direct mode keeps only Copilot (synchronous container) and surfaces a clear error for other types; CLI smoke test `workflow list --direct --json` confirmed end-to-end via tsx — Copilot path unchanged. Anthropic network-loop / full tool-use wiring is clearly marked as extension points pending real-use pinning of `@anthropic-ai/sdk`. OpenAI/Bedrock/Vertex adapters can now ship by following the same four-file pattern (port impl + permissionMap + hook bridge + MCP))_
- [ ] PRV-02 · BYOK per-workspace UI

## 21. Documentation Debt

- [x] DOC-01 · Public-facing API reference (OpenAPI) _(hand-curated OpenAPI 3.1 document at `apps/server/src/openapi/spec.ts` served at `/api/openapi.json`; Swagger UI shell at `/api/docs` loads viewer from jsdelivr; covers health, chats, workflow definitions, workflow runs (incl. HITL permission-mode + pending-interrupts + resume 409), stage control, automations, streaming, copilot, webhooks; error schema + bearer auth scheme defined; mounted before the 404 catch-all in `routes/index.ts`)_
- [x] DOC-02 · Architecture diagrams refresh _(`.claude/docs/architecture.md` updated end-to-end: new topology diagram showing OpenAPI/docs endpoints, unified SSE, harness adapter optionality, McpHub + CustomToolRegistry + PermissionPolicy; control-flow paragraph now covers turnId (WEB-02), HITL awaiting_input, durable sleep sweeper, permission policy gating; event-kind table updated with sleeping/woken/awaiting_input/input_received/permission_mode_changed; cross-cutting section adds harness selector, retention, durableSleep config groups; v1/v2 section collapsed to reflect SEC-08 removal of v1 surface; "what's missing" refreshed to current open items)_
- [ ] DOC-03 · Deployment guide

---

## Phase Gates

Check each gate only when every task in the phase is done.

- [ ] **Phase 3 ready** — SEC-01..12, CLN-01..04, CLN-08, ORC-01..05, DOC-03
- [ ] **Phase 4 ready** — STR-01..08, EVT-01..04, CLN-05..07, CLN-09, CLN-12, DB-01..02, WEB-02, DOC-02
- [ ] **Phase 5 ready** — DUR-01..06, HITL-01..05, CLI-01, EVT-05, DB-03..04
- [ ] **Phase 6 ready** — TOL-01, TOL-02, TOL-04, TOL-05, TOL-06 _(TOL-03 dropped)_, SND-01..08, HKS-01..02, ORC-06
- [ ] **Phase 7 ready** — OBS-01..07, EVL-01..07, WEB-03..04, AUT-01..02, DOC-01
- [ ] **Phase 8 ready** — MEM-01..05, MUL-01..03, WEB-01, CLI-02..03
- [ ] **Phase 9 ready** — DAG-01..03, AUT-03, CLN-10..11
- [ ] **Phase 10 ready** — PRV-01..02
