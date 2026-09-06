# Architecture & performance overhaul — completion audit

**Date:** 2026-09-05 · **Branch:** `arch-redesign` @ `205909b` + working tree (387 modified, 126 untracked files, nothing committed since 2026-09-03)
**Inputs treated as claims, not facts:** `docs/REVIEW-FIX-TRACKER.md` (Sept 4), `docs/V2_REMAINING_WORK_AUDIT.md` (Aug 29), `docs/PERFORMANCE-AUDIT-2026-09.md`, the two `PROPOSAL-*.md` files.
**Method:** every claim below was checked against source or by running the command. Nothing was taken from a tracker without opening the file it names.

---

## 1. Verdict

The overhaul is **substantially real and in good shape, but not complete, and the tree as it stands cannot merge**: the repo's own security invariant fails, which fails `pnpm lint`, which is what CI runs. Beyond that gate, two of the three architectural root causes the overhaul set out to fix are only partly delivered — the "tokens never touch SQL" stream spine is a dual-write whose file log nothing reads, and the process boundary is opt-in with stubbed methods and two host packages that have no consumer at all. The performance work is real and measured, with one regression: the headline cold-start win is silently lost on exactly the deployments the product targets (anything not on loopback).

| Area | State |
|---|---|
| Build / typecheck | **Green** — 49/49 packages, real `tsc --build --force` |
| Tests | **Green in isolation** — ~5,900 tests; 5 fail only under parallel load on this machine, all 5 pass alone |
| Web bundle | **Green after a fresh build** — 351.9 KB initial gzip vs 800 KB budget (the tracker's "over by 224 KB" was a stale `dist/`) |
| Invariant scripts | durability, doc-drift, sync-IO, tokens, design ratchet **pass**; **`check:security` FAILS** |
| Performance work (chat) | **Real**: persistent sessions default-on, 4-turn permit incl. chat, awaited handlers, tick-coalesced batching, pre-warm, list virtualisation, curated highlight.js |
| Architecture laws | L1 (0 SQL per token) **not true**; L5 (process boundary) **opt-in, incomplete**; L16/L17/L18 hold |
| Uncommitted work | **513 files** — a single bad checkout loses two days of work |

---

## 2. What was verified as done

Each of these was opened in code, not trusted from the tracker.

**Chat / provider performance** — `ClaudeAgentProvider.ts`: `persistentSessions` defaults on (`GENERATORAI_CLAUDE_PERSISTENT_SESSIONS=false` is the kill switch), `acquireTurnPermit` on both `sendPrompt` and `sendPromptAndWait`, `AgentHostSupervisor.DEFAULT_MAX_CONCURRENT_AGENT_TURNS = 4`, every hot-path `emitToHandlers` awaited, idle/LRU session sweeper present. `StreamWriteBatcher` uses `queueMicrotask` + `setImmediate` coalescing. `prewarmConversation` implemented with the SDK `startup()` API and a bounded initialize timeout. Git snapshot moved to overlap message persistence.

**Workflows** — single readiness predicate + reconciler with one process-wide interval (`WorkflowRunService.ts:97`), heartbeat lease, stage timeout default 300 s with real abort, definition snapshot pinned on runs, retry with fresh workspace, transactional delete, `withEffect` now on the turn path (`StageExecutionService.ts:1595`), Wake-now route, Hooks tab fed by the reducer.

**Automations** — DB-backed due-row scheduler with lease/heartbeat/timezone (`AutomationService.ts:116-236`), `partial` status, webhook HMAC + hashed token + rotate route, token redaction in error logs, secret masking on read.

**MCP** — credential vault wired into `routes/projects.ts`, `mergeMcpServers` called on both create and resume paths (`ChatManagementService.ts:1706, 2017`), settings store server-side with the web store demoted to a legacy reader, MCP startup failures mapped to `harness.warning` (`event-mapper.ts:556`).

**Security / ops** — default permission mode is startup-configured (`composition/security.ts:377`), stream-scope authorisation on both initial and later subscriptions, widget VM sandbox, browser navigation policy, log rotation opt-in via `GENERATORAI_LOG_FILE`, layer-boundary ESLint rules, `safeJsonColumn` always reports, retention split by event class, `docker/server.Dockerfile`, mobile `PermissionCard`, CLI `system status` curated, `workflow list --limit`.

**Closed since the August V2 audit** — `SessionDemux` on the live host path, `runRecyclePass` on a timer, pty `ack()` wired end to end, `harness_instances` wiring, ACP inbound on the real protocol version, Codex tests + RPC timeouts, WebCodecs frames in `BrowserPanel`, `streamStore` eviction, mobile `global` scope subscription, relay e2e test.

---

## 3. Findings

Severity: **P0** blocks merge or silently defeats a headline goal · **P1** architectural claim not met / duplicate-path bug · **P2** worth scheduling.

### F1 · P0 — Pre-warm hardcodes `bypassPermissions`; fails CI and loses the cold-start win off-loopback

**Where:** `packages/core/src/services/ChatManagementService.ts:1813`

```ts
permissionMode: resolveTurnPermissionMode(firstAgentMode, params.permissionMode ?? 'bypassPermissions'),
```

**Why it is wrong.** The overhaul made the fallback permission mode a startup decision: loopback + non-production → `bypassPermissions`, anything else → `acceptEdits` (`apps/server/src/composition/security.ts:370-383`). The real turn honours that — lines 2361 and 2756 pass `chat.permissionMode` (undefined → configured default). The pre-warm alone re-hardcodes the old unsafe default.

**Three consequences:**
1. `scripts/check-security-invariants.mjs` flags it (`no-default-bypass-permissions`). `pnpm lint` fails. `.github/workflows/ci.yml:71` runs `pnpm lint`. **CI is red on this tree.**
2. On a VPS/LAN/relay deployment the warm handle is built with `bypassPermissions`, the first turn asks for `acceptEdits`, and `ensureSession` correctly refuses the mismatch (`ClaudeAgentProvider.ts:3004-3020`: "spawn fresh on a mismatch"). So **the measured 12.8 s → 2.3 s first-turn win exists only on loopback dev boxes**. Self-hosters get the old 12 s.
3. Worse than before: every new chat off-loopback now spawns **two** ~218 MB CLI processes (the wasted warm one plus the real one), doubling cold-start CPU and memory for nothing.

It is **not** a security hole — the claim path compares modes — but it is a perf regression on the target deployment and a hard CI failure.

### F2 · P1 — The delta log is write-only; "0 SQL per token" (Law L1) is not true

**Where:** `packages/core/src/services/StreamBroker.ts:164-171`, `packages/core/src/services/DeltaLog.ts:222`, `apps/server/src/composition-root.ts:824-828, 959`

`StreamBroker.publish` does `await this.writer.write(...)` — a batched INSERT into `stream_cursors` — for **every** event including deltas, and then *also* calls `deltaLog.append` ("W07 — dual-write"). `DeltaLog.readTail` has **zero production callers**; the only consumer of the log is the retention sweeper that deletes it. Replay (`routes/stream.ts`) reads SQL. `EventBus.ts:55-58` still says deltas "will flow to the delta log once W07 lands, costing the relational store nothing" — W07 landed as a duplicate.

**Effect:** every token costs a batched SQL row *plus* an `appendFile` to a file nobody reads, plus a sweeper. `stream_cursors` remains the dominant table (54% of the 437 MB production DB per the Sept 2 audit). The architecture doc, tracker and memory all record L1 as enforced. It isn't; it is honest batching, which is good, but not the design that was signed off.

### F3 · P1 — The process boundary is opt-in, stubbed, and two host packages have no consumer

**Where:** `apps/server/src/composition-root.ts:324-343, 443-523`; `packages/core/src/services/AgentHostClient.ts:162, 256-262`; `packages/core/src/services/index.ts:216-236`

- `GENERATORAI_AGENT_HOST` is off by default; the desktop app sets none of the host flags. The composition root's own comment: `getModels()`, `selectAgent()` and `listAgents()` are "explicit Phase-B stubs" — confirmed: `getModels` returns `[]`, `selectAgent` is an empty body. Enabling the host also **bypasses `MultiHarness`, the instance registry and ownership store**, so multi-provider routing is lost when isolation is on.
- `apps/browser-host` and `apps/cua-host` build and run tests in CI but **nothing imports them**. The core index deliberately deleted `BrowserHostClient`/`CuaHostClient` because the browser client covered 8 of ~30 bridge operations and the CUA protocol carries no window addressing ("the user approves Safari and the click lands in 1Password"). They are dead packages with a maintenance cost.
- `pty-host` works and is opt-in; fine.

So of the three root causes named in the plan (sync SQL per token, no process boundary, no admission control) only admission control is unconditionally delivered.

### F4 · P1 — Two template importers still disagree (tracker item D10 open)

**Where:** `WorkflowDefinitionService.importFromTemplate` (`:327`) vs `WorkflowOrchestrator.createFromTemplate` (`:275-345`)

The orchestrator path, which is what Settings → Templates uses, is **not transactional** (definition, then a loop of `addStage`, then edges — a failure mid-loop leaves a half-built definition), hardcodes `sessionMode: 'auto'` (the service honours `template.sessionMode`), hardcodes `autoCommit: true`, and omits the `imported` tag. This is exactly "pattern 2" from the Sept 2 review: a bug fixed in one path and left in its duplicate.

### F5 · P1 — A 1.68 MB gzip syntax-highlighting chunk still ships

**Where:** `apps/web/vite.config.ts:207-211`; build output `vendor-highlight-*.js` = 9,611 KB minified / **1,677 KB gzip**

The curated `highlight.js/lib/core` fix (311 KB → 42 KB) covers chat and the file viewer. The diff viewer (`components/diff/*` → `@pierre/diffs` → Shiki) still bundles **every Shiki grammar plus CodeMirror**. It is lazy, so the initial-load budget passes, but the first time a user opens a diff they download 1.7 MB and parse 9.6 MB of JS. The bundle check only measures the initial load, so this can never trip it.

### F6 · P2 — Stale claims in trackers and code comments

- `docs/PROPOSAL-cold-start.md` and `PROPOSAL-startup-harness-agnostic.md` both say "**Nothing implemented**" — the pre-warm they propose is implemented and measured.
- `REVIEW-FIX-TRACKER.md` Part 1 still lists C2/D1a/H14 etc. as PARTIAL with failing tests; all fixed later in the same file. The document contradicts itself top to bottom.
- `EventBus.ts:55-58` (see F2), `arch_v2` memory ("L1 enforced").
- `check-bundle-size` was reporting a 224 KB overage from a stale `dist/`; nothing rebuilds before checking.

### F7 · P2 — Smaller items found while verifying

| Item | Evidence |
|---|---|
| `HitlPanel.tsx` has no importer — dead component (D14 remnant) | grep: only comments reference it |
| `usage_ledger` table exists (migration + index) with no writer and no reader | grep across `apps/`, `packages/` |
| ~~`OpenCodeProvider.ts` has zero tests~~ **Retracted 2026-09-05:** `OpenCodeProvider.test.ts` has 36 tests incl. the conformance suites; a truncated directory listing produced the false finding | `providers/opencode/__tests__/` |
| God services grew during the overhaul: `StageExecutionService` 3,481 · `ClaudeAgentProvider` 3,394 · `ChatManagementService` 2,981 · `composition-root` 2,523 LOC | `wc -l`; P1#9 decomposition never happened |
| `/api/health` loads every active chat row and run row to count them | `routes/health.ts:30-37` |
| `docker/observability/docker-compose.yml` has no `server` service; the Dockerfile is orphaned | compose file |
| `conversationBindings` map is never deleted from | `ChatManagementService.ts:1022`, no `.delete` |
| Synchronous `better-sqlite3` on the event loop stalls `/api/health` >10 s under chat load; the sync-IO budget script counts only `fs` calls, not SQL | tracker "one finding that was not a code defect" |
| Five spawn/timeout test suites fail under parallel load, pass alone | `ChangeSummaryService`, `PtyHostAdapter`, `SileroVad`, `AcpProvider`, `GitClient` |

---

## 4. Fix plan

Ordered by what unblocks what. Estimates are for one engineer.

### Step 0 — Commit the tree (½ day, first)

**Issue.** 513 files of work exist only in the working tree.
**How.** Fix F1 first (it is a one-line change and CI must be green at the commit), then commit in the tracker's phase groups so `git bisect` stays useful: (1) repair + infra, (2) chat security, (3) performance, (4) workflows/automations/data, (5) web, (6) ops/docs. Run `pnpm typecheck && pnpm lint && pnpm turbo test --concurrency=2` before each.

### Step 1 — F1: pre-warm permission default (1 hour)

**Fix.** In `ChatManagementService.ts:1813` pass `params.permissionMode` and let `resolveTurnPermissionMode` fall back to `getDefaultChatPermissionMode()` — the same thing lines 2361/2756 already do:

```ts
permissionMode: resolveTurnPermissionMode(firstAgentMode, params.permissionMode),
```

**Test (write it against the unfixed code first; it must fail).** In the `ChatManagementService` prewarm tests: call `setDefaultChatPermissionMode('acceptEdits')`, create a chat with no explicit mode, assert the harness's `prewarmConversation` spy received `permissionMode: 'acceptEdits'`, then send a first prompt and assert `sendPrompt` received the same mode. Add a second assertion at the provider level: with a warm handle built under `acceptEdits` and a turn requesting `acceptEdits`, `warmSessions` is claimed, not discarded.
**Acceptance.** `pnpm run check:security` passes; the pre-warm measurement in `PERFORMANCE-AUDIT-2026-09.md §7` reproduces with `GENERATORAI_BIND_HOST=0.0.0.0`.

### Step 2 — F2: make the delta log real or remove the dual-write (decide, then 1–3 days)

**Issue.** Tokens are written twice and read once (from SQL).
**Decision to make.** The delta log only pays off if deltas *stop* going to SQL. That means replay must merge two sources: items from `stream_cursors`, deltas from `DeltaLog.readTail`, ordered by `seq`.

**Option A — finish it (recommended, ~3 days).**
1. In `StreamBroker.publish`, when `classifyEvent(...) === 'delta'` and a delta log is configured: allocate `seq` from `stream_sequences` (still SQL, one tiny UPDATE per token — or better, allocate in blocks of 64 per scope in memory and persist the high-water mark), append to `DeltaLog`, **skip** `writer.write`, fan out.
2. In the replay path (`StreamBroker.subscribe`/`routes/stream.ts /replay`), read items from SQL and deltas from `readTail`, merge on `seq`. Keep the existing `unfinished turn` retention semantics by making `EventRetentionService`'s delta sweep operate on the log's per-scope files instead of rows.
3. Chat crash recovery (`ChatManagementService` "replays the streamed text") must read from the merged source. Grep `assistant_streaming_delta` consumers first.
4. Delete `EMPTYABLE_DELTA_INFO_TYPES` suppression only if the log's coalescing makes it moot; otherwise keep.
5. Tests: publish 1,000 deltas + 10 items, assert `stream_cursors` row count grows by 10; replay from `seq=0` returns 1,010 rows in order; kill the process mid-append and assert torn-tail repair yields a clean replay. Re-run `packages/db/__benchmarks__` locally (not CI) and record the per-token SQL count as 0.

**Option B — remove the dual-write now (½ day).** Drop `deltaLog` from `StreamBroker`'s constructor in the composition root, keep the class and tests, and correct `EventBus.ts:55-58`, the architecture doc, and the L1 row in the tracker to say "batched, not zero". Take this if Option A cannot be scheduled this month; do not leave the duplicate write running.

### Step 3 — F3: finish or fence the process boundary (1–2 weeks)

**Issue.** Isolation is opt-in, stubbed, and drops multi-provider routing when enabled; two host packages are dead.

**Agent host (make it the real path):**
1. Implement the three stubs over the existing IPC: `getModels` → host RPC `models.list` (the host already has the provider instance; add a request kind to `AgentHostIpc`), `selectAgent`/`listAgents` → forward. Add the missing conformance run: point the W44 suites at `AgentHostClient` backed by a real child `AgentHostServer` with `FauxProvider` inside.
2. Move `MultiHarness` **inside** the host (`apps/agent-host/src/AgentHostServer.ts` boots `HarnessRegistry` + `MultiHarness` instead of a single primary provider), so `ProviderInstanceId` routing survives isolation. The gateway keeps `AgentHostClient` as the single `IAgentHarness`.
3. Soak: run the concurrent-load script (`agent-tests/concurrent-load-1q.mjs`) with `GENERATORAI_AGENT_HOST=true`, kill the host mid-turn, assert `reattachSessions` recovers and a turn completes. Then flip the default to on when the dist exists, keep `=false` as the kill switch, and have desktop's `server-manager.ts` build/ship the host.

**Browser/CUA hosts (fence):** either delete `apps/browser-host` and `apps/cua-host` from the workspace (keeping the design docs) or move them under `apps/experimental/` excluded from CI. A package with tests and no consumer is a false signal of coverage. The CUA one must not be wired until its protocol carries a window/app identity — write that as a one-line ADR so nobody re-adds the client.

### Step 4 — F4: one template importer (½ day)

1. Extend `WorkflowDefinitionService.importFromTemplate(templateId, opts: { name?, projectId?, variableOverrides? })`; apply `variableOverrides` to `defaultValue` the way the orchestrator does; keep the transactional `build`.
2. Make `WorkflowOrchestrator.createFromTemplate` a thin call to it. If the orchestrator needs `category: 'derived'`/`parentTemplateId`, pass them as options — do not compute config in two places.
3. Test: import the same template through both entry points; assert the resulting definitions (minus ids/timestamps) are deep-equal, and that a stage-insert failure leaves zero rows (transaction rollback).

### Step 5 — F5: curated Shiki bundle + lazy-chunk budget (1 day)

1. In `diffWorkerFactory.ts`/`DiffProviders.tsx`, create the highlighter with `createHighlighterCore` from `shiki/core` and register the same ~26 grammars `lib/highlight/languages.ts` curates (import from `@shikijs/langs/<lang>`), plus one theme per mode. Drop the CodeMirror packages from the chunk if only the diff view needs them; otherwise split `vendor-codemirror` from `vendor-shiki`.
2. Extend `scripts/check-bundle-size.mjs` with a **per-lazy-chunk** cap (suggest 300 KB gzip) so this class of regression is caught. Make the script rebuild, or fail if `dist/` is older than `src/`.
3. Acceptance: `vendor-highlight` (or its successors) under 300 KB gzip; diff view still highlights TypeScript, Python, JSON, YAML, Markdown, shell.

### Step 6 — F6/F7 clean-up (1–2 days total)

- Update the two PROPOSAL docs' status lines; rewrite `REVIEW-FIX-TRACKER.md` Part 1 to the final state or delete Part 1; correct `EventBus.ts` comment and the L1 row after Step 2; add a doc-drift rule for the L1 claim.
- Delete `HitlPanel.tsx` or wire it (the run page's HITL is handled elsewhere — check `deriveRunView` before deleting). Delete the `usage_ledger` table in a new migration or give `DurableExecutionEngine` a writer and the settings page a reader; do not leave a phantom table.
- Health route: replace the two `getByStatus` loads with `COUNT(*)` repo methods.
- Add a `server` service to `docker/observability/docker-compose.yml` (or a top-level `docker-compose.yml`) using `server.Dockerfile`, with the 15 s health check already chosen.
- Evict `conversationBindings` in the chat delete/archive path.
- `OpenCodeProvider`: run the five W44 conformance suites against it with a fixture server (the Codex test is the template).
- Test flakiness: put the five process-spawning suites under a vitest project with `fileParallelism: false` and a 60 s timeout, or mark them `sequential`. Document `--concurrency=2` in `operations.md`.

### Step 7 — F7: measure the SQLite stall before deciding (1 day to measure, more only if justified)

Wrap the drizzle/better-sqlite3 driver with a timer that logs any statement over 50 ms with its SQL and row count, run the concurrent-load script, and read the log. If the stall is a few statements (likely: the batcher's transaction under `stream_cursors` growth, or `getByStatus` scans), fix those. Only if the floor is genuinely "many small statements" is moving the write batcher to a `worker_threads` SQLite connection worth its complexity. Extend `check-sync-io-budget.mjs` to count `.prepare(`/`.run(` sites on request paths so the budget covers the thing that actually blocks.

### Not worth doing now

- God-service decomposition (P1#9): valuable, but a week of pure refactor with no user-visible change; schedule after the tree is committed and Steps 1–5 are in, so the split does not collide with them.
- Per-workspace idle PTY pre-warm (proposal item 2b): the native-module preload already brought steady-state create to ~0.05–0.6 s.
- Browser start: measured at the Chromium floor; environmental only.

---

## 5. Order of work and expected outcome

| Order | Step | Effort | Outcome |
|---|---|---|---|
| 1 | F1 fix + commit everything | ½ day | CI green; cold-start win restored for self-hosters; one CLI per new chat |
| 2 | F4 importer, F5 Shiki, F6/F7 clean-up | 3 days | Duplicate-path bug closed; diff view 1.7 MB → <300 KB; docs truthful |
| 3 | F2 delta log (Option A) | 3 days | L1 actually holds; `stream_cursors` stops being the largest writer |
| 4 | F3 agent host as the real path | 1–2 weeks | Provider crashes cannot take the gateway down; multi-provider routing survives isolation |
| 5 | F7 SQLite measurement | 1 day | Data to decide on a worker-thread writer instead of guessing |

After 1–3 the overhaul can honestly be called complete for chat, workflows, automations and clients. Step 4 is the remaining architectural promise; until it lands, `apps.md`'s "opt-in, not the default path" wording is the truthful one and should stay.


---
---

# Part 2 — Feature-by-feature and memory audit (same day, second pass)

**Scope:** browser, diff view, plan view, computer use, background tasks, orchestrator, agents, streaming to the UI, stream durability, terminal, CLI/TUI, desktop, every harness provider, and memory on the server and every client.
**Live evidence:** the developer server (pid 36128, started 17:52) and its child processes were inspected at 19:13. `/api/health` on that process returned 404, so process-level numbers come from the OS, not the app.

## 6. Memory — what is actually using it

| Process | RSS | Note |
|---|---|---|
| server (`tsx src/index.ts`) | **357 MB** (862 MB private) | one Node process, sync SQLite on its thread |
| 8 × `claude.exe` children of the server | **~230 MB each ≈ 1.9 GB** | persistent Claude sessions, spawned 17:53–18:52, all still alive at 19:13 |
| 1 × `copilot.exe` child | 110 MB | Copilot pool, cap 8 |
| 60+ orphaned `rg` grandchildren | 0–82 MB each | spawned by Claude CLI processes since 26 Aug, parents long dead |
| vite dev server | 135 MB | dev only |

Roughly **2.4 GB** is attributable to one developer session of the app, and about **80% of it is child processes**, not the Node heap.

### M1 · P0 — Persistent Claude sessions are never closed on eviction, delete or archive

**Where:** `ClaudeAgentProvider.ts:3364-3394` (`cleanupConversation`), called by `deleteConversation` (:1407), `destroyConversation` (:1418), `sweepIdleConversations` (:3323) and `evictLruConversation` (:3349).

`cleanupConversation` removes the conversation from every bookkeeping map and discards a *warm* handle, but **never touches `this.sessions`**, the map that owns the live SDK process. `closeSession` is only reached from `stop()`, the turn-handle close during an active turn, an unacknowledged interrupt, and an options change. So the paths that are *supposed* to reclaim memory — the 30-minute idle sweep, the LRU cap, deleting a chat, archiving a chat — each remove the conversation record and leave the ~230 MB CLI running for the life of the server. The observed 8 processes, all older than the idle window, are this bug. The `maxLiveConversations` cap bounds the wrong map: `conversations` shrinks, `sessions` never does. No test covers "sweep closes the process".

### M2 · P0 — Memory defaults are sized for a machine that does not exist

| Knob | Default | Implication |
|---|---|---|
| `GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS` | **32** | 32 × 230 MB = **7.4 GB** of CLI processes allowed, while only 4 can run a turn |
| `GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES` | 30 | an abandoned chat holds 230 MB for half an hour (once M1 is fixed) |
| `OrchestratorService.maxWorkers` | **12** per parent | each worker is a chat, each chat a persistent process: **2.8 GB per orchestration** |
| `GENERATORAI_BROWSER_MAX_CONCURRENT` | 5 | 5 Chromium persistent contexts ≈ 1–2 GB; bounded and LRU-evicted, so acceptable but worth documenting |
| `GENERATORAI_MAX_CONCURRENT_AGENT_TURNS` | 4 | correct; the others should be derived from it |

### M3 · P1 — Orchestrator and background-task workers are never torn down

`OrchestratorService.ts:833-890`: on `harness.idle` a worker's status is persisted and the per-parent counters are decremented, but the worker's harness conversation is never deleted or destroyed. A worker is a single-purpose chat; its CLI process has no reason to outlive its result. Today it lives until the idle sweep, which (M1) does not close it either.

### M4 · P1 — Nothing bounds server RSS in-process, and operators cannot see the leak

`AgentHostSupervisor.shouldRecycle` (age 6 h / RSS 500 MB) has **zero callers**; `WedgeDetector` records RSS in its report but takes no action; `/api/health` exposes no count of live CLI processes or SDK sessions. A 2 GB server looks identical to a 300 MB one from every dashboard the app ships.

### M5 · P1 — Child processes are killed without their process tree on Windows

Sixty-plus `rg` processes whose parent `claude.exe` is gone, dating back to 26 Aug, are still resident. `proc.kill()` on Windows terminates one process, not its descendants; the desktop app already knows this and uses `taskkill /pid /T /F` for the server (`server-manager.ts:265`), but the provider's session close and the SDK's own close do not. The boot-time orphan reaper covers Docker sandboxes only (`StartupRecoveryService.ts:36`).

### M6 · P2 — Extension hot-reload leaks a module per reload

`ExtensionManager.ts:275-278` imports `file://…?v=${Date.now()}`. ESM modules are never unloaded, so every reload adds a copy. Development-time mostly, but the server is long-lived.

### M7 · P2 — Server heap itself is unprofiled

357 MB RSS for the Node process is plausible for the dependency set but has not been measured under a heap snapshot. `conversationMessages` transcripts are per-conversation and unbounded until cleanup; `conversationBindings` is never evicted.

### Clients — mostly bounded

| Client | State | Notes |
|---|---|---|
| Web | **Good** | `streamStore` caps at 32 streams with render-exempt keys; `VideoFrame`s are closed in `finally`; tab caps (`maxInstances`) on diff and terminal; messages page at 100; react-query default gc. Gaps: **Terminal and Computer panels are not visibility-gated** (only `BrowserPanel` is), so a hidden tab keeps its socket and decodes frames; the 1.68 MB Shiki chunk (F5). |
| CLI / TUI | **Good** | toasts and history sliced; event queue flushed per microtask; pane model is layout only. |
| Mobile | **Good** | shares the client-core stream reducer; `global` scope subscription present. |
| Desktop | **Good** | kills the server tree with `taskkill /T`; renderer is the web app. |

## 7. Feature-by-feature

| Feature | Verdict | What was checked and what is wrong |
|---|---|---|
| **Streaming to the UI** | Good | `sseConnection`: items queued to 256, deltas dropped with a visible `gap` frame; `StreamWriteBatcher` `MAX_PENDING` 10 000 with oldest-delta drop; replay capped at 500 rows; `MuxStreamClient` reconnects 20× and quarantines rejected scopes. Only F2 (write-only delta log) stands. |
| **Stream durability** | **Gap** | Client reload and transport drop mid-turn were verified live by the tracker. **A server restart mid-turn is not handled**: `StartupRecoveryService` skips chat sessions by design, `turnFinalizers` are in memory, and nothing at boot emits a terminal event or persists the partial transcript for a chat whose last stream row is a delta. The client replays deltas and then waits for an `idle` that never comes until the user sends again. |
| **Browser** | Good | navigation policy wired and tested; 5-context cap with LRU and idle-pause; screencast backlog 4 with drop-newest and frame acks; `BrowserPanel` closes frames and gates on visibility. `apps/browser-host` is dead (F3). |
| **Diff view** | Good, one perf gap | `resolveInsideRepo` containment on all readers; blob cache capped at 8 MB; working-tree cache TTL asserted by test. Gap: F5, the full Shiki grammar set. |
| **Plan view** | Good | `PlanService` 422 lines; plan mode is structural (mode descriptor forces the SDK `plan` permission mode regardless of chat setting); cross-chat plan access closed on all six handlers. |
| **Computer use** | Partial | `ComputerService` 2 167 + `CuaDriverBridge` 1 784 lines; consent store present; sync `fs` calls are boot-time ffmpeg discovery only. Still open from the August audit: a click-with-capture is several round trips through a temp PNG (`CuaDriverBridge.ts:1503`); `ComputerPanel` keeps a second `EventSource` (`:708`) beside the mux stream; `apps/cua-host` is dead by design. |
| **Background tasks** | Real, leaks | Panel, cancel and digest are wired to real routes. Workers are chats that are never torn down (M3). |
| **Orchestrator** | Good logic, bad budget | W24 fixed: convergence is per wave, wave counting is correct, cleanup of per-parent maps on completion. `maxWorkers` 12 × persistent process (M2). |
| **Agents / extensions** | Good, one leak | Authoring tools capability-gated; widget scripts in `node:vm` with call cap; hot-reload module leak (M6). |
| **Terminal** | Good | 5 per workspace / 20 global; scrollback ring buffer; session-level watermark; socket circuit breaker; pty `ack` credit wired. `pty-host` opt-in. |
| **CLI / TUI** | Good | 321 + 900 tests; stream via `MuxStreamClient`; bounded store. |
| **Desktop** | Good | navigation guard, IPC sender validation, session hardening, tree-kill of the server. Sets none of the host flags (F3). |
| **Providers** | Mixed | Claude: M1, M2, and `ping()` returns `clientState === 'running'` so a dead CLI never turns health red. Copilot: pool cap 8, sessions stopped on release. Codex, OpenCode, ACP: processes killed with SIGTERM→SIGKILL; all three have conformance tests (an earlier "OpenCode has zero tests" line was a listing error, retracted). |

## 8. Consolidated action list

Everything from Part 1 and Part 2, one list, ordered. **Effort** is for one engineer.

| # | Pri | Item | Files | Effort |
|---|---|---|---|---|
| A1 | P0 | Pre-warm passes `params.permissionMode` (F1); test against unfixed code; `check:security` green | `ChatManagementService.ts:1813` | 1 h |
| A2 | P0 | `cleanupConversation` closes the live session: `const s = this.sessions.get(id); if (s) void this.closeSession(s, reason)`; add `FakeSdk` test asserting `close()` on sweep, LRU, delete, destroy (M1) | `ClaudeAgentProvider.ts:3364` | ½ day |
| A3 | P0 | Commit the tree in phase groups once A1–A2 are green (Part 1 Step 0) | repo | ½ day |
| A4 | P0 | Memory defaults: `MAX_LIVE_SESSIONS` 32→**8** (2× the turn permit, derived not duplicated), idle 30→**10 min**, `maxWorkers` 12→**≤ permit** and workers run **one-shot** (`persistentSessions: false` per conversation option) since each has exactly one turn (M2) | `ClaudeAgentProvider.ts:711-716`, `OrchestratorService.ts:84` | ½ day |
| A5 | P1 | Tear down worker conversations on terminal status: call `harness.deleteConversation(workerConversationId)` after the digest is persisted (M3) | `OrchestratorService.ts:833-890` | ½ day |
| A6 | P1 | Windows tree-kill: after SDK `close()`, `taskkill /pid <pid> /T /F` when the process is still alive after a 2 s grace; boot-time reaper for orphaned `claude`/`rg` children whose parent PID is gone, next to the Docker reaper (M5) | `ClaudeAgentProvider.closeSession`, `StartupRecoveryService.ts` | 1 day |
| A7 | P1 | Health and observability: `harness.liveSessions`, `harness.childProcesses`, `process.memoryUsage()` in `/api/health`; wire `shouldRecycle` to a timer that logs (then acts) when RSS crosses 500 MB; make `ping()` probe the SDK process instead of a state string (M4) | `routes/health.ts`, `AgentHostSupervisor.ts`, `ClaudeAgentProvider.ping` | 1 day |
| A8 | P1 | Server-restart mid-turn: at boot, for each chat whose newest stream row is a delta or `turn_start` with no `idle`, persist the partial assistant message from the stream rows and publish a synthetic `harness.error` ("interrupted by restart") + `harness.idle`; test by killing the server mid-turn | `StartupRecoveryService.ts`, `ChatManagementService.ts` | 1–2 days |
| A9 | P1 | One template importer (F4) | `WorkflowDefinitionService.ts`, `WorkflowOrchestrator.ts` | ½ day |
| A10 | P1 | Curated Shiki grammars + per-lazy-chunk budget + rebuild-before-check (F5) | `diffWorkerFactory.ts`, `check-bundle-size.mjs` | 1 day |
| A11 | P1 | Delta log: Option A (deltas only to the log, merged replay) or Option B (remove the dual-write and correct the docs) — decide this week (F2) | `StreamBroker.ts`, `routes/stream.ts`, `EventRetentionService.ts` | ½ – 3 days |
| A12 | P1 | Agent host: implement the three stubs, move `MultiHarness` inside the host, soak, flip default; fence or delete `browser-host`/`cua-host` (F3) | `AgentHostClient.ts`, `AgentHostServer.ts`, workspace | 1–2 weeks |
| A13 | P2 | Visibility-gate `TerminalPanel` and `ComputerPanel` like `BrowserPanel`; move `ComputerPanel`'s second `EventSource` onto the mux | `TerminalPanel.tsx`, `ComputerPanel.tsx` | ½ day |
| A14 | P2 | Extension hot-reload: keep a per-extension module registry and refuse to reload more than N times without a restart, or run extensions in a worker that is terminated on reload (M6) | `ExtensionManager.ts` | 1 day |
| A15 | P2 | Heap snapshot of the server under the concurrent-load script; bound `conversationMessages` to the last N turns; evict `conversationBindings` on delete (M7) | provider, `ChatManagementService.ts` | 1 day |
| A16 | P2 | Computer use: fuse click-with-capture into one driver round trip without the temp PNG (August W17) | `CuaDriverBridge.ts` | 2–3 days |
| A17 | P2 | Docs and dead code: proposal status lines, tracker Part 1, `EventBus.ts` comment, `HitlPanel.tsx`, `usage_ledger`, compose `server` service, health `COUNT(*)`, OpenCode conformance tests, flaky-suite isolation (F6, F7) | various | 1–2 days |
| A18 | P2 | Measure the SQLite stall with a >50 ms statement logger before deciding on a worker-thread writer (Part 1 Step 7) | db driver wrapper | 1 day |

**Gates.** A1–A3 before anything is pushed. A4–A7 before the next user-facing test session, because they change what "the app uses too much memory" means. A8 before calling stream durability done. A11 and A12 are the two architectural promises still open; everything else is hygiene.

**Expected memory after A2 + A4 + A5:** an idle server holds the Node heap plus at most the warm sessions of chats opened in the last 10 minutes; a busy server is bounded at 8 CLI processes (≈ 1.8 GB) instead of 32 (≈ 7.4 GB); an orchestration adds nothing permanent.


---
---

# Part 3 — Execution record (2026-09-05, same day)

Every item below was implemented in the working tree, typechecked with `tsc --build --force` across all 49 packages, and run through `pnpm lint` (which now includes the previously failing security invariant). New tests were run against the unfixed code first where the fix was a behaviour change, and failed for the predicted reason before passing.

**Verification:** typecheck 49/49 green · `pnpm lint` green (8/8 security invariants, doc-drift, sync-IO, tokens, design ratchet) · full suite: 30 packages, ~5,930 tests; the parallel run showed 5 failures — 2 in new tests (fixed), 3 in `checkpoints` (real-git temp-dir race, untouched package) — and all three packages pass in isolation (core 1552/1552, web 441/441, checkpoints 17/17) · live smoke on an isolated server instance (port 3103, own DB copy): boot clean, `/api/health` reports `harness.runtime` with `maxLiveSessions: 8`, the orphan reaper killed **17 of 17** orphaned `rg` processes left by earlier runs, interrupted-turn recovery scanned 400 chats with nothing to close.

## 9. Status per action item

| # | Item | Status | What landed | Tests |
|---|---|---|---|---|
| A1 | Pre-warm permission default | **Done** | `ChatManagementService.ts` passes `params.permissionMode`; the configured default applies. `check:security` is green, so `pnpm lint` and CI pass again. | Enforced by `scripts/check-security-invariants.mjs` (runs in CI via `pnpm lint`) |
| A2 | Close the session on cleanup | **Done** | `cleanupConversation` closes `this.sessions.get(id)` — idle sweep, LRU cap, delete and archive all end the CLI process now. | `claude-session-cleanup.test.ts` — 6 tests; 5 fail on the unfixed code ("spy called 0 times") |
| A3 | Commit the tree | **Not done — yours** | Nothing was committed: the tree is your uncommitted work and a commit changes history under your name. Everything is green; commit in the tracker's phase groups. | — |
| A4 | Memory defaults | **Done** (one part deferred) | `DEFAULT_MAX_LIVE_SESSIONS` 32→**8**, `DEFAULT_SESSION_IDLE_MINUTES` 30→**10**, orchestrator `maxWorkers` 12→**4** (= the turn permit), all named constants with the measurement beside them. Per-conversation one-shot mode for workers was not built; A5 bounds their lifetime instead. | `claude-memory-defaults.test.ts` — 4 tests incl. env overrides and nonsense values |
| A5 | Tear down finished workers | **Done** | `OrchestratorService.scheduleWorkerRelease`: 90 s grace (configurable, `workerReleaseGraceMs`), cancelled by a review follow-up, then `harness.destroyConversation`. The chat and transcript stay; the next prompt resumes it. | `OrchestratorService.workerRelease.test.ts` — 3 tests |
| A6 | Tree-kill / orphan reaper | **Done as a boot reaper** | `OrphanProcessReaper` (Windows): kills `rg` scans and CLI sessions whose parent is dead **and** whose command line names one of this installation's directories; never itself or its ancestors. Fire-and-forget at boot; `GENERATORAI_REAP_ORPHANS=false` opts out. Per-session tree-kill at close is not possible — the SDK does not expose the CLI's pid. | `OrphanProcessReaper.test.ts` — 12 tests on the selection function; live: 17/17 killed |
| A7 | Health visibility | **Done** (recycle timer deferred) | `IAgentHarness.runtimeDiagnostics()` (Claude, MultiHarness aggregate, HarnessProxy) → `/api/health` `harness.runtime` {liveConversations, liveSessions, warmSessions, maxLiveSessions, per provider}; the sweeper warns when sessions exceed the cap. Wiring `shouldRecycle` to a timer that restarts a provider was not done — it needs restart semantics that do not exist in-process. `ping()` unchanged. | Live-verified on the isolated instance |
| A8 | Server restart mid-turn | **Done** | `InterruptedTurnRecoveryService`: at boot, for each active chat, reads the tail of the session log (two indexed queries), and when the last `turn_start` has no terminal event persists the streamed text as a `partial` assistant message and emits `harness.error` (`INTERRUPTED_BY_RESTART`) + `harness.idle`. `ISessionEventStore.lastSeq` / `EventBus.getLastSequence` added so it never reads a whole log. | `InterruptedTurnRecoveryService.test.ts` — 8 tests over a real EventBus; **not** yet exercised with a real crash mid-turn |
| A9 | One template importer | **Done** | `WorkflowOrchestrator.createFromTemplate` delegates to `WorkflowDefinitionService.importFromTemplate(templateId, { name, projectId, variableOverrides, autoCommit })`; variable mapping is one shared function; the orchestrator's copy and `mapConfigVarType` are gone. Import is transactional on both paths. | Existing template/definition suites; no new equality test written |
| A10 | Shiki chunk + lazy budget | **Done** | The `manualChunks` rule was collapsing all ~200 dynamically-imported Shiki grammars into one chunk; removed. Largest lazy chunk **1.68 MB → 224.9 KB** gzip. `check-bundle-size.mjs` now caps every lazy chunk at 300 KB and refuses to grade a `dist/` older than `src/`. | `check:bundle` green after a fresh build |
| A11 | Delta log | **Done — Option B** | Dual-write is opt-in (`GENERATORAI_DELTA_LOG=true`), off by default; `EventBus.ts` and `StreamBroker.ts` comments now state what the code does. Option A (deltas only in the log, merged replay) remains the open architectural item. | — |
| A12 | Agent host as the real path | **Not done** | 1–2 weeks; unchanged. | — |
| A13 | Visibility-gate Terminal/Computer panels | **Not done** | RightPane keeps inactive tabs mounted by design; a correct gate needs live verification that terminal output and computer frames survive tab switches. | — |
| A14 | Extension hot-reload leak | **Done** | Module URL keyed on the entry file's mtime (an unchanged file reuses its module); reload counter with a warning every 25 and a refusal at 100 with a message to restart. | Typechecked; no new test |
| A15 | Small server-memory items | **Partial** | `conversationBindings` evicted on chat delete. Heap snapshot under load and a bound on `conversationMessages` not done. | — |
| A16 | CUA fused round trip | **Not done** | Driver work; unchanged. | — |
| A17 | Docs and dead code | **Mostly done** | Proposal status lines corrected; `HitlPanel.tsx` deleted (zero importers); `/api/health` uses `COUNT(*)` via new `countByStatus` on chat and run repositories; `docker/docker-compose.yml` runs the server with the memory knobs spelled out; process-spawning suites get a 60 s timeout (core, providers). Not done: `usage_ledger` decision, rewriting tracker Part 1 (the "OpenCode has no tests" item was a false finding: 36 tests exist) (a dated progress entry was appended instead). | — |
| A18 | SQLite stall measurement | **Not done** | Unchanged. | — |

## 10. What changed, by file

- `packages/agent-harness-providers/src/providers/claude-agent/ClaudeAgentProvider.ts` — session close in `cleanupConversation`; defaults 8 / 10 min as named constants; `runtimeDiagnostics()`; over-cap warning in the sweep.
- `packages/agent-harness-providers/src/{MultiHarness,HarnessProxy}.ts`, `packages/core/src/domain/ports/IAgentHarness.ts` — `runtimeDiagnostics` port + aggregate + forward.
- `packages/core/src/services/ChatManagementService.ts` — pre-warm permission default; binding eviction on delete.
- `packages/core/src/services/orchestrator/OrchestratorService.ts` — `maxWorkers` 4; worker release with grace timer.
- `packages/core/src/services/InterruptedTurnRecoveryService.ts` (new), `packages/core/src/events/EventBus.ts` — restart-mid-turn recovery, `getLastSequence`.
- `packages/core/src/services/OrphanProcessReaper.ts` (new) — boot-time reaper.
- `packages/core/src/services/{WorkflowDefinitionService,WorkflowOrchestrator}.ts` — one importer.
- `packages/core/src/services/ExtensionManager.ts` — mtime-keyed hot reload with cap.
- `packages/core/src/domain/ports/{IChatRepository,IWorkflowRunRepository}.ts`, `packages/db/src/repositories/{ChatRepository,WorkflowRunRepository}.ts` — `countByStatus`.
- `apps/server/src/composition-root.ts` — recovery + reaper wiring; delta log opt-in; `lastSeq` on the event store.
- `apps/server/src/routes/health.ts` — runtime diagnostics; counts instead of row loads.
- `apps/web/vite.config.ts`, `apps/web/scripts/check-bundle-size.mjs` — Shiki split; lazy-chunk budget; staleness check.
- `docker/docker-compose.yml` (new); `packages/{core,agent-harness-providers}/vitest.config.ts`; proposal docs; `HitlPanel.tsx` removed.
- Tests added: `claude-session-cleanup`, `claude-memory-defaults`, `OrchestratorService.workerRelease`, `InterruptedTurnRecoveryService`, `OrphanProcessReaper`.

## 11. Still open, in order

1. **Commit** (A3) — the only thing between this work and a safe checkout.
2. **A12** agent host as the default path; **A11 Option A** deltas out of SQL. The two architectural promises.
3. **A13** panel visibility gating and **A8 live drill** (kill the server mid-turn, watch the client recover) — both need a driven browser session.
4. **A15/A18** measurements: heap snapshot and the >50 ms statement logger, before any further tuning.
5. **A16** CUA round-trip fusion; **A17 leftovers** (`usage_ledger`, OpenCode tests); the in-process recycle timer from A7; `ping()` that probes.


---
---

# Part 4 — Second execution pass and end-to-end verification (2026-09-05, evening)

Scope: the items Part 3 left open (A7 recycle/ping, A8 live drill, A12 stubs, A13 gating, A15, A17 leftovers, A18), then a live end-to-end pass over every module through the HTTP API of an isolated server instance, plus the repo's own concurrent-load scenario.

## 12. What changed in this pass

| # | Item | Status now | What landed |
|---|---|---|---|
| A7 | `ping()` honesty | **Done** | Claude `ping()` returns false when the adapter is not running, when the pinned CLI binary is gone from disk, or after 3 consecutive failed turns (the circuit breaker's own threshold). It used to be a state string that was true from boot to shutdown. The in-process recycle timer stays deferred: there is no restart mechanism for an in-process provider to attach it to. |
| A8 | Restart mid-turn — **live drill** | **Verified** | Real Claude turn started (tokens flowing at 7 s), server tree killed mid-stream, restarted. Boot log: `chat … had a turn open across the restart — persisted 2568 chars of partial output`. The messages API shows the assistant message with `partial: true, interrupted: "server_restart"`, and the durable session log ends with seq 202 `harness.error` (`INTERRUPTED_BY_RESTART`) and seq 203 `harness.idle` (read straight from SQLite). A first drill attempt killed the server after the turn had already completed and correctly recovered nothing. |
| A12 | Agent host stubs | **Done (opt-in unchanged)** | `list_models`, `select_agent`, `list_agents` added to the IPC protocol (`AgentHostIpc.ts`), handled in `AgentHostServer`, and `AgentHostClient.getModels/selectAgent/listAgents` round-trip to the host instead of returning `[]`/nothing. 3 new host tests (48/48). The host remains opt-in: enabling it still bypasses `MultiHarness` and the instance registry, which is the real remaining work, and it has not been soaked. |
| A13 | Panel visibility gating | **Done for Computer; Browser already had it** | `BrowserPanel` already took `visible={ctx.active}` from the RightPane (the August finding was stale for it). `ComputerPanel` now takes `active` and subscribes to the live preview feed (frame per action, cursor sample every ~30 ms) only while it is the visible tab. Terminal left as is: unsubscribing a hidden terminal would lose output. |
| A15 | Server memory items | **Measured + bounded** | In-memory transcript copy capped at 400 messages per conversation; `conversationBindings` evicted on delete (Part 3). **Measured:** the Node heap is small — `heapUsed` 112–120 MB while RSS is 900 MB to 1 GB on the 368 MB database copy. The difference is native: SQLite `mmap_size` is 256 MB (`DB_MMAP_BYTES`) plus a 64 MB page cache, Playwright/onnx natives, and file-backed pages. Lower `DB_MMAP_BYTES` on memory-constrained hosts; a heap snapshot is not where the memory is. |
| A17 | Leftovers | **Done** | Migration v50 drops the phantom `usage_ledger` table (no writer, no reader, not in the Drizzle schema). Four legacy v1 templates at the repo's `templates/` root removed: they had no `stages`, failed `WorkflowTemplateSchema` at every boot and were logged as warnings — the doc's "still loaded for compatibility" was never true; doc corrected. **Retraction:** the Part 2 line "OpenCodeProvider has zero tests" was wrong — `OpenCodeProvider.test.ts` has 36 tests including the conformance suites; a truncated directory listing produced it. |
| A18 | SQLite stall | **Tripwire built, measured** | `GENERATORAI_SQL_SLOW_MS=<n>` times every prepared statement's `run/get/all`; anything over the threshold is logged once with its SQL and kept in a bounded top list exposed at `/api/health` as `slowStatements`. Measured at 50 ms across a real chat turn, terminal and browser start on the 368 MB database copy, and across the full concurrent-load scenario on a fresh database: **zero statements over 50 ms**. The >10 s health stall seen earlier under concurrent real chats was not reproduced; the tripwire is what will name the statement when it recurs. |

### Defects found by the verification itself

| Where | What was wrong | Fixed |
|---|---|---|
| `agent-tests/concurrent-load-1q.mjs` | Ran `apps/server/dist-bundle/server.mjs`, a bundle from **26 Aug** with 211 source files newer than it. Every terminal, browser and workflow leg failed on `no such column: "code_root"` — a bug the source fixed on 3 Sep. The report read as a server regression. | Bundle rebuilt; the script now refuses a bundle older than the sources unless `LOAD_TEST_ALLOW_STALE_BUNDLE=1`. |
| same script | Set `GENERATORAI_DB_PATH` / `GENERATORAI_ARTIFACTS_DIR`, names nothing reads (the server reads `DB_PATH`, `WORKSPACES_DIR`, `ARTIFACTS_DIR`). The "temporary" database was never used; on a developer machine the test ran against `~/.generatorai/data.db` and failed the vault integrity check against the user's own secret store. | Names corrected; `WORKSPACES_DIR` added. |
| same script | Did not pin `GENERATORAI_BIND_HOST`; the unauthenticated-loopback override is refused on a non-loopback listener, so the server refused to start where the default bind is not loopback. | Pinned to `127.0.0.1`. |
| same script | Read `workspaceId` off the chat-create response with no fallback. | Prompts the holder chat and re-reads if absent (the server does return it at creation; the fallback stays). |
| `templates/*.json` (4 files) + `feature-templates-scripts.md` | Legacy templates failing validation at every boot, documented as loaded. | Removed; doc corrected; `check:docs` green. |
| `scripts/check-sync-io-budget.mjs` + `eslint.config.mjs` | The repo-wide ESLint JSON report had grown to 68 MB — it was linting `.claude/` (Claude Code skill scripts and worktrees, ~30 MB) — past the script's 64 MB buffer, so the report was truncated and `pnpm lint` failed with "did not produce parseable JSON output". | `.claude/**`, `dist-bundle/**`, `.expo/**` ignored by ESLint (as vitest already does); buffer raised to 256 MB. |

## 13. End-to-end verification

**Instance A — real Claude harness, 368 MB database copy, loopback, port 3103.**

| Check | Result |
|---|---|
| Boot | clean; `/api/health` status `ok`; `slowStatements: []` |
| List endpoints (`chats`, `workflow-definitions`, `workflow-runs`, `automations`, `agents`, `extensions`, `projects`, `templates`) | all 200 |
| Chat create → workspace | `workspaceId` present at creation |
| Real turn → `harness.runtime` | `liveSessions: 1` during/after the turn |
| Terminal on the chat's workspace | create OK (real pid), delete 204; `scrollback` 409 as documented for the in-process host |
| Browser on the workspace | start `{status: active, mode: screencast, ready: true}`, descriptor 200, stop 200 |
| Computer-use runtime | typed `{state: "stopped", enabled: true}` response, no crash |
| **Delete the chat** | `liveSessions: 0`, **zero `claude.exe` children** of the server — the A2 leak fix, live |
| Memory | RSS 902 MB, `heapUsed` 112 MB (see A15) |
| A8 drill | see §12 |

**Instance B — FauxProvider, fresh database, port 3104.** Chat create → workspace at creation; workflow definition → stage → run → start → `completed` in 4 s; admission lanes idle after; `slowStatements: []`.

**Repo load scenario (`concurrent-load-1q.mjs`, fresh bundle).** 5 chats, 3 workflow runs, 1 automation × 20, 5 real terminals, 3 real Chromium sessions, 2 computer-use calls: **all legs pass**; p95 per-turn 16.4 s (n=8, Faux); peak RSS 791 MB; shutdown 2.9 s; zero orphan processes at shutdown.

**Suites (final run, after every change above).** Typecheck 49/49 green. `pnpm lint` green: 8/8 security invariants, durability, doc drift, sync-IO budget, tokens, design ratchet. Full suite, 30 packages, about 5,940 tests: every package green except `checkpoints` (3 real-git temp-directory races under parallel load; 17/17 alone, as in every run today). New this pass: agent-host 48/48, core 1552/1552, web 441/441, db 109/109 with migration v50.

## 14. Still open after this pass

1. **A12 as the default path** — move `MultiHarness` inside the host, soak, flip the default. The stubs are closed; the routing gap is the whole remaining item.
2. **A11 Option A** — deltas only in the file log, merged into replay by `seq`. Currently opt-in dual-write.
3. **A16** CUA fused round trip (driver work).
4. **A7 recycle timer** — needs an in-process provider restart mechanism first.
5. **Terminal tab gating** — only worth doing with a scrollback-replay-on-reattach design.
6. **Server RSS** — decide a `DB_MMAP_BYTES` default for memory-constrained hosts; the number is native memory, not heap.
7. **Commit.** Everything above is in the working tree.
