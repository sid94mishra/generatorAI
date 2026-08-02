# 99 — Medium + Low backlog

These items were flagged in [../CODE_REVIEW.md](../CODE_REVIEW.md) but not analyzed for the implementation plan per the scope decision (Critical + High only, with detailed specs; Medium + Low listed for later pickup).

Treat this as a checklist — pull items opportunistically when touching the surrounding code. Most are S-sized cleanups.

---

## A — Core orchestration (`packages/core`)

### Medium
- `StageRunStateMachine.ts:37-48` — terminal state transitions implicit (empty transition maps) rather than explicit. Document or make explicit.
- `SessionAllocator.ts:118-131` — `resumeConversation` swallows error from SDK silently. Log warning + mark session broken.
- `infrastructure/DockerSandboxProvider.ts:95-96` — unsafe `err as { code?: ... }` cast; use `instanceof Error` + proper unwrapping.
- `StartupRecoveryService.ts:125-134` — session rehydration silently swallows mass failures; return a summary report.
- `ConfigResolver.ts`, `ChatManagementService.ts` — `as unknown as` / `as any` casts.
- `WorkflowRunService.ts` — per-run workspace creation guard "if not already set" suggests race potential; clarify ownership.
- `RunLogger` (`events/StreamLogger.ts`) — synchronous `appendFileSync` on every event; could bottleneck high-volume runs.
- `EventBus` — `globalHandlers` Set's memory-leak fix (High 2.2) needs testing under load.
- DAG `ConditionEvaluator` — only supports simple comparisons; may not need multi-parent AND/OR logic yet; verify real use cases before expanding further.

### Low
- `StageRunStateMachine.ts:37-48` — style: explicitly list terminal-state empty transition maps for clarity.
- `HostProcessSandboxProvider.ts:131` — error cast quality.
- `SandboxLifecycleManager` — `MAX_ACTIVE_SANDBOXES = 50` hardcoded; make configurable.
- `StageExecutionService.DEFAULT_RETRY_POLICY` — hardcoded `{maxRetries:1, backoffMs:3000, multiplier:1}`; consider config.
- `RunLogger.writeLine` bare `try {} catch {}` — swallows I/O errors silently; log at least once per failure cluster.
- `DAGScheduler` cache — no TTL; memory grows with distinct definition IDs.
- `WorkflowPreprocessor` script variable interpolation — docs ("scripts must never eval variables") should be surfaced in template docs.

---

## B — Server + streaming (`apps/server`, `packages/streaming`)

### Medium
- `routes/orchestrator.ts:217-231` — file-type whitelist has no magic-bytes check. Attacker uploads shellcode as `.json`.
- `middleware/validate.ts:28-44` — Zod error messages leak supported-values info in 400s. Log server-side; return generic message in prod.
- `packages/streaming/src/SSETransport.ts:67-69` — replay buffer unbounded at reconnect (10 k events sync write); cap at 100 per reconnect; rest via REST cursor.
- `composition-root.ts:89-96` — OTel disabled by default in production; flip default on; fail-fast on exporter unreachable when enabled.
- `routes/multiplexedStream.ts:154-176` — `resolveEventContext` falls through on unknown kinds to "session"; should 400.
- `routes/stream.ts:38-39` — filter param has no cap; `?filter=a,b,×1000` DoS; cap to 10 prefixes.
- Three parallel subscription implementations (chat/workflowRun/composition-root) — consolidated by 1.10 StreamBroker; backlog until rewrite.
- `app.ts:40-46` — global JSON 10 MB limit, but no query-string size limit (`parameterLimit`).
- `routes/orchestrator.ts:643-664` — git-diff parsing O(n²) in file count. Pre-parse fullDiff into Map once.

### Low
- `routes/index.ts:26-100` — no API versioning; `/api/v1/...` + `/api/v2/...` prefixes would help; tracked as Phase 2.
- `middleware/cors.ts:17` — `allowedOrigins=['*']` + `credentials:true` is unsafe; reject when both.
- `routes/sessions.ts:72` — deprecated session routes still fully functional; count usage metric; sunset with header.
- `packages/streaming/src/DurableStreamManager.ts:60-82` — no per-sessionId connection limit; attacker opens 1000 EventSources.
- `routes/multiplexedStream.ts:18` — `MAX_BUFFER=2000` arbitrary; make config.
- `routes/chat.ts:9-11` — multer memory storage 50 MB; use disk + per-session quota.
- `instrumentation.ts:22-83` — OTel SDK startup failure silent; fail fast when enabled.
- Graceful shutdown per-connection timeout (Phase 1 enhancement on top of the 60 s timeout fix).

---

## C — Web frontend (`apps/web`)

### Medium
- `sseManager.ts:158-165, 176-184` — minor ordering within Zustand batch (handled adequately by the `flushAnd*` atomic action; any residual edge cases → medium priority).
- `platform/apiFetch.ts:17-56` — missing Authorization header infrastructure; introduce `AuthError` subclass for 401s.
- `platform/HttpPlatformClient.ts:261-264` — `selectDirectory()` no-op stub; throw clear error instead of returning null.
- `pages/WorkflowRunPage.tsx:85-89` — `clearRun` cleanup effect has `[]` deps; stale data on runId change; add `runId` to deps.
- `streamStore.ts:358-365` — `setUsage` ghost entries persist after stream cleared.
- `connectionStore.ts` — no max limit on connections Record; warn at >100.
- `router.tsx` — 404 page needs a "Go back" button (`useNavigate(-1)`).
- `pages/WorkflowRunPage.tsx:195` — fixed-width right panel (420/500 px); make responsive / resizable.

### Low
- Light ARIA coverage across custom interactive components. Audit with axe; prefer Radix UI for dialogs + menus.
- React Flow DAG canvas has no keyboard navigation.
- `RunStatusBadge` — unverified WCAG AA contrast on status colors.
- `QueryProvider` — no cache persistence across reload; consider `@tanstack/react-query-persist-client`.
- `sseManager.ts:1120-1137` — `_resetForTests` and friends exported in production build; guard with `import.meta.env.DEV`.
- `package.json` / Vite — no bundle-size budget; add `vite-plugin-visualizer` + CI budget.
- Dead code: v1 session components coexisting with v2 chat.
- Modal stacking: multiple `createPortal(document.body)` modals risk z-index collisions; use Radix Dialog.

---

## D — CLI (`apps/cli`)

### Medium
- `apps/cli/src/index.tsx:1288-1294, 153, 1326` — Ink `exitOnCtrlC:true` + process SIGINT handler races; covered by the "Ctrl+C cancel server-side" fix in 04-cli-copilot-bridge.md.
- CLI test harness — add integration tests for signal / crash recovery in `--direct` and `--http` modes.

---

## E — Copilot-bridge (`packages/copilot-bridge`)

### Medium
- `CopilotAdapter.ts:62` — `conversationListenerCleanups` Set grows unbounded per session; prune on listener-count threshold.
- `package.json` — `@github/copilot-sdk@^0.1.0` on 0.x semver; pin to `~0.1.25` or vendor the release until 1.0.
- `CopilotAdapter.ts:218-236` — permission-kind mapping is hardcoded; new SDK kinds silently map to `other`. Generate from SDK enum or assert coverage.

---

## F — Database (`packages/db`)

### Medium
- `_debug.cjs`, `_query_cron.cjs` in package root — move to `scripts/debug/` or delete.
- `migrations/migrate-v1-to-v2.ts:42` — uses private Drizzle internal via type-assertion; fragile with Drizzle upgrades; use public `db.run()`.
- Zero test coverage in `packages/db`. Add integration tests for: migration correctness, cascade delete blast radius, JSON column data integrity, concurrent-write safety.
- `schema.ts:59` workflows + `chat_messages` cascade delete on sessions — huge blast radius; consider soft-delete (`deleted_at` column).
- `automation.next_run_at` advisory locking for cron — covered by 1.23 full fix; medium version here is "warn users not to deploy multi-process without the lease fix".

### Low
- WAL backup/restore procedure undocumented. Add to CLAUDE.md: `PRAGMA wal_checkpoint(TRUNCATE)` before backup.

---

## G — Shared (`packages/shared`)

### Medium
- `telemetry/` — only 2 test files; no end-to-end test of trace/metric emission.
- `errors/index.ts` — error hierarchy has no `ERROR_CODE_MAP` constant for reverse lookup from logs.
- `types/WorkflowOrchestrator.ts` — `OrchestratorConfig` referenced with no Zod schema; add `OrchestratorConfigSchema`.
- `logging/Logger.ts:55-57` — `ILogger.child` merges bindings without conflict detection; document merge order.

### Low
- 33 type files; v1 + v2 duplication (Session vs SessionStateMachineV2). Deprecate v1 with a timeline; alias v1 → v2 where possible.

---

## H — UI package + desktop stubs

- `packages/ui/src/index.ts` — empty; decide: populate (Phase 2+ UI extraction) or delete. Currently referenced as `workspace:*` by both web and desktop without any actual imports.
- `apps/desktop/src/{main,preload,renderer}/index.ts` — placeholders. Either start implementation with Tauri or delete the package to avoid confusion.

---

## I — CI + ops

- `.github/workflows/ci.yml` — single workflow; no security/SAST, no dependency scanning, no bundle-size budget, no deploy pipeline. Phase 3 roadmap item.
- No container image build for the server. Phase 3.
- `agent-tests/` Playwright tests are not wired into CI. Needs a test-server-startup step in a separate workflow.
- `/health` probe is binary; no readiness vs liveness distinction.
