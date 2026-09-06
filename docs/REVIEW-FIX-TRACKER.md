# Review fix tracker — APPLICATION-REVIEW-2026-09 execution

Consolidated 2026-09-04 after ten parallel workstreams were stopped mid-flight.
Baseline: HEAD `205909b`. Working tree: 263 files changed, **typecheck passes**, **35 tests failing** (all caused by unfinished in-flight work; baseline had 1 pre-existing failure).

Status key: **DONE** = implemented + test present · **PARTIAL** = code landed, not wired or tests failing · **TODO** = not started.

---

## Part 1 — Landed work (verify, don't redo)

| # | Item | Status | Evidence |
|---|---|---|---|
| G1 | Desktop navigation origin guard + fail-closed | DONE | `apps/desktop/src/main/navigation-guard.ts` + test |
| G2 | Desktop IPC sender validation (all 43 handlers) | DONE | `ipc-guard.ts` + test |
| G3 | Desktop pairing-grant gate (rate limit + confirm) | PARTIAL | `pairing-gate.ts` + test; server test failing |
| G4 | Electron session CSP + permission handlers | DONE | `session-hardening.ts` + test |
| G5 | Desktop restart/remote-switch repoint | DONE | `repoint.ts` + test |
| G6 | Desktop tray close handler | DONE | `tray.ts` |
| G7 | Desktop settings value validation | DONE | `settings-schema.ts` + test |
| G8 | Unsigned-release guard | DONE | `electron-builder.mjs`, `build-config.mjs` |
| G9 | CLI `--local` residue removal + doc fixes | DONE | `esbuild.config.mjs`, `package.json`, catalogs |
| G10 | TUI shell-only commands, error reasons, status tone, close keys | DONE | `connectionStatus.ts` + 4 tests |
| G11 | SDK freeze (README, stability, no publishConfig) | DONE | `packages/sdk/*` |
| G12 | Mobile EAS build config + push project id | DONE | `eas.json`, `app.config.ts`, `pushStatus.ts` |
| G13 | Mobile Android cleartext policy | DONE | `plugins/`, tests |
| G14 | Mobile revoke-device route + confirmation | PARTIAL | `deviceRequests.ts` + test; server alias test failing |
| G15 | Mobile notification preference wiring | DONE | `notificationFilter.ts` + test |
| G16 | Relay route unification + host binding | DONE | `relayRoutes.ts`, `hostBinding.ts`, `app.ts`, e2e test |
| G17 | Relay false-E2EE claims removed | DONE | `pairingOffer.ts`, tunnel plan doc |
| H1 | Migration v45 `code_root` (fresh-install fix) | DONE | `migrations/index.ts` |
| H2 | Migration v23 FK-off plan-wipe fix | DONE | `MigrationV23PlanRebuild.test.ts` |
| H3 | Schema convergence tests | PARTIAL | test written and **failing** |
| H4 | `safeAddColumn` error-wording test | PARTIAL | test written and **failing** |
| H5 | KeyProvider refuses wrong-length key | DONE | `KeyProvider.ts` + test |
| H6 | Backup includes secrets dir | DONE | `copySecretsDir.mjs`, `db-backup.ts` |
| H7 | Global security headers | DONE | `securityHeaders.ts` + test |
| H8 | Bounded flush on fault paths | DONE | `boundedFlush.ts` + test |
| H9 | BrowserService.dispose in shutdown | DONE | `BrowserService.ts` |
| H10 | Dependency bumps + Dependabot + CodeQL | DONE | `dependabot.yml`, `codeql.yml`, lockfile |
| H11 | CI: e2e job, design ratchet, SHA pinning | DONE | `ci.yml` (+156 lines) |
| H12 | SECURITY.md real contact | DONE | `SECURITY.md` |
| H13 | nginx / Grafana / observability hardening | DONE | `docker/` |
| H14 | Host protocol version handshake | PARTIAL | `hostProtocol.ts` + test; **breaks 21 host tests** |
| H15 | `check-security-invariants` regex fix | DONE | `scripts/check-security-invariants.mjs` |
| C1 | Concurrency default 16→4 + chat permit | DONE | `AgentHostSupervisor.ts` |
| C2 | Claude provider streaming-input session | PARTIAL | `ClaudeAgentProvider.ts` +587; **4 tests failing** |
| D1a | Single readiness predicate + reconcile | PARTIAL | `DAGScheduler.ts` rewritten; **7 tests failing** |
| D1b | Stage-run version bumps | PARTIAL | `StageRunRepository.ts`; **1 test failing** |
| D2a | Script runner guard (command scanned, path resolve) | DONE | `SandboxedScriptRunner.ts`, `shellWords.ts` |
| D2b | Script gate moved to loader | PARTIAL | `WorkflowScriptLoader.ts`; **2 server tests failing** |
| D2c | Real hook dry-run | DONE | `HookExecutor.ts`, `routes/hooks.ts` |
| D2d | Worktree retention respected | PARTIAL | `WorktreeCleanupService.ts`; **1 test failing** |
| E1 | SSRF-safe fetch + DNS pinning | DONE | `safeFetch.ts`, `DataSourceResolver.ts` |
| E2 | File data source uses projectRoot | DONE | `DataSourceResolver.ts` |
| E3 | Recovery-service status inversion | DONE | `AutomationRecoveryService.ts` |
| E4 | Cron validator shared rules | DONE | `utils/cron.ts`, `AutomationSchemas.ts` |
| F1a | Global mutation error handler | DONE | `QueryProvider.tsx` + test |
| F1b | Connection gap badge rendered | DONE | `ConnectionStatus.tsx`, `Header.tsx` |
| F1c | RightPane real components + responsive | DONE | `RightPane.tsx` + test, `useMediaQuery.ts` |
| F1d | Timeline memo identity | DONE | `deriveTimeline.ts` + test |
| F2a | Radix Select swap | DONE | `Select.tsx`, `SearchableSelect.tsx` |
| F2b | Drawer/Modal/useConfirm primitives | PARTIAL | `Drawer.tsx`, `useConfirm.tsx`; **FloatingCard test failing** |
| F2c | Theme tokens `--color-surface*` + contrast script | DONE | `globals.css`, `check-theme-contrast.mjs` |
| F2d | Mechanical a11y pass (pages, agents, diff, codebase) | PARTIAL | ~20 files; ChatInput not done |
| I1 | MCP credential vault + wire + merge helper | PARTIAL | `packages/core/src/mcp/*`; not wired to routes |
| I2 | MCP settings store (server-side) | PARTIAL | `McpSettingsStore.ts`; web form not switched |
| A1 | Extension tools gated by capability | DONE | `extensionAuthorTools.ts`, `agentModePolicy.ts` |
| A2 | Permission-mode schema/type groundwork | PARTIAL | `ChatSchemas.ts`, `AgentMode.ts`; handler not built |
| A3 | `isNavigationAllowed` (file://, metadata, loopback) | PARTIAL | `hostMatcher.ts`; **zero callers — not wired** |

---

## Part 2 — PENDING work, in execution order

### Phase R — Repair the tree (blocks everything)

**DONE so far:** R1 (21 host tests — fixture now sends the protocol hello; the four host dists were stale and are rebuilt), R2 (7 DAGScheduler tests — the deleted frontier optimisation removed, and the diamond-hang regression from finding 5.5 is now covered by real tests), R4 (5 db tests), plus three genuine unfinished implementations found by a real compile: the provider session sweeper/LRU, the eight missing turn/session lifecycle methods behind the persistent-session work, and the automation service exports.

**Infrastructure fix:** `pnpm typecheck` was giving FALSE GREENS. `tsc --noEmit` on a composite project with a stale `.tsbuildinfo` exits 0 without checking, which is how 18 real compile errors survived a clean typecheck run. All 27 composite packages now use `tsc --build --force`. **Never trust `tsc --noEmit` in this repo.**


| # | Task | Root cause |
|---|---|---|
| R1 | `HostSupervisor` (11) + `PtyHostAdapter` (8) + `browser-host` (2) tests | H14 handshake: hosts now send `hello`, fakes/fixtures don't |
| R2 | `DAGScheduler` frontier tests (7) | D1a rewrite changed frontier semantics |
| R3 | `agent-harness-providers` W12-recycle (3) + W41-lazy-load (1) | C2 provider rewrite |
| R4 | `db`: SchemaConvergence, safeAddColumn, ConversationInstanceOwnership, StageRunResumeFromInterrupt, streamAppend bench (5) | H3/H4 new tests + D1b version bumps + migration additions |
| R5 | `server`: workflowScripts-upload (2), internal-desktop (2) | D2b gate move, G3 rate limit |
| R6 | `desktop` window-manager test file error (1) | G1/G4 refactor |
| R7 | `web` FloatingCard (1) | F2b overlay swap |
| R8 | `web` bundle-size budget exceeded by 224 KB | Pre-existing; needs F1e (highlight split) |

### Phase A — Chat security and correctness

**DONE:** A4 server half (real blocking permission gate on the durable interaction service, resolve route, policy tests), A5 (Copilot create AND resume both bridge the handler — resume used to hardcode approve-everything), A6 (chat PATCH validated; raising to bypassPermissions now needs an admin scope), A7 (plan cross-chat leak closed on all six handlers, tested), A10 (widget scripts run in a real node:vm context with a 5s timeout; tested that process/require are unreachable and an infinite loop is stopped), A11 (symlink guard uses lstat + realpath containment), A13 (browser navigation policy wired and pinned by 17 tests). **A4 web/CLI UI is in progress.**


| # | Task | Files |
|---|---|---|
| A4 | DONE for server + web + CLI. **Mobile permission card still pending.** | mobile |







| A12 | Remove widget-assets mount from main origin | `routes/index.ts` |


### Phase C — Performance

| # | Task | Files |
|---|---|---|
| C3 | Await event handlers → real backpressure | `ClaudeAgentProvider.ts` |
| C4 | 125 events/sec ceiling (batcher/EventBus serialisation) | `EventBus.ts`, `StreamWriteBatcher.ts` |
| C5 | Checkpoint TTL 1.5s vs 2s mismatch + skip unchanged rebuilds | `ChangeSummaryService.ts`, `WorkspaceCheckpointService.ts` |
| C6 | Conversation-binding cache key (4-part vs 5-part) | `ChatManagementService.ts` |
| C7 | Non-blocking pre-message git snapshot | `ChatManagementService.ts` |
| C8 | Model-catalog cache no longer self-invalidating | `ClaudeAgentProvider.ts` |
| C9 | Trim widget system hint to a pointer | `chatSystemHints.ts` |

### Phase D — Workflows

| # | Task | Files |
|---|---|---|
| D3 | Stage timeout default + clear timer + real cancellation | `StageExecutionService.ts` |
| D4 | Heartbeat lease + stale-stage sweeper | `StageExecutionService.ts`, `WorkflowRunService.ts` |
| D5 | Retry: fresh workspace, copy outputs, lineage | `WorkflowRunService.ts` |
| D6 | Result validation reads own stage output | `ResultValidator.ts` |
| D7 | Skip overrides honoured on failure branches | `WorkflowRunService.ts` |
| D8 | Pin run to a definition snapshot | `WorkflowRunService.ts`, schema |
| D9 | Definition validation on create/edit | `WorkflowDefinitionService.ts` |
| D10 | One template importer (no field loss) | `WorkflowDefinitionService.ts` |
| D11 | Transactional delete + "delete runs first" guard test | `WorkflowDefinitionService.ts` |
| D12 | Auto-commit/PR persisted across restart | `WorkflowOrchestrator.ts` |
| D13 | Workspace file-read containment | `ChangeSummaryService.ts`, `routes/workspaces.ts` |
| D14 | Dead workflow UI: Wake now, Hooks tab, Template picker, HitlPanel, undo history | web workflow components |

### Phase E — Automations

| # | Task | Files |
|---|---|---|
| E5 | **DB-backed due-row scheduler** (next_run_at, lease, timezone, catch-up, overlap) | `AutomationService.ts`, migration 47 |
| E6 | Three-way status incl. `partial` + alerting | `AutomationService.ts`, types |
| E7 | Webhooks: public route, HMAC, hashed token, header token | `routes/automations.ts`, `routePolicy.ts` |
| E8 | Token redaction in error logs and idempotency scope | `errorHandler.ts` |
| E9 | Data-source credentials to vault + redacted API | `AutomationService.ts`, repo |
| E10 | Un-awaited `emitGlobal` (7 sites) + dead try/catch | `AutomationService.ts` |
| E11 | Web + CLI automation UI: next run, partial status, secrets masked | web/CLI |

### Phase F — Web

| # | Task | Files |
|---|---|---|
| F1e | Curated highlight imports + bundle under budget | `SyntaxHighlightedCode.tsx`, `FileViewerComponents.tsx` |
| F1f | ChatPage narrow subscription + memoised panel defs | `ChatPage.tsx` |
| F1g | Builder error state + reset on every id change | `WorkflowBuilderPage.tsx` |
| F1h | Builder store selector subscriptions | `WorkflowBuilderPage.tsx`, `WorkflowDefinitionPage.tsx` |
| F2e | ChatInput responsive (360–414 px) | `ChatInput.tsx` |
| F2f | Remaining a11y names + design baseline reset | web |

### Phase I — MCP and provider honesty

| # | Task | Files |
|---|---|---|
| I3 | Project MCP routes accept/store credentials | `routes/projects.ts`, migration 48 |
| I4 | Wire `mergeMcpServers` into chat config build | `ChatManagementService.ts` |
| I5 | Settings MCP form → server persistence | web settings, `customMcpStore.ts` |
| I6 | MCP startup failure surfaced as an event | provider + web/CLI |
| I7 | Provider list honesty (hide unconfigured, fix logo) | `HarnessRegistry.ts`, web |
| I8 | `packages/mcp-server` stub: implement or delete | package |

### Phase H — Remaining ops

| # | Task | Files |
|---|---|---|
| H16 | Retention split by event class (keep unfinished turns) | `EventRetentionService.ts` |
| H17 | `safeJsonColumn` onInvalid logging (59 sites) | `packages/db` |
| H18 | Layer boundary lint rule + fix violations | `eslint.config.mjs` |
| H19 | Log rotation | server logger |
| H20 | `docker/server.Dockerfile` + compose service | `docker/` |
| H21 | Ops docs env-var names + drift-checker rule | `.github/docs`, `check-doc-drift.mjs` |

### Phase Z — Verification (after all above)

| # | Task |
|---|---|
| Z1 | Full typecheck + lint + test green |
| Z2 | Independent code review of the whole diff |
| Z3 | Live browser E2E: every feature, every path, real chat streaming |
| Z4 | CLI + TUI driven as a real user |
| Z5 | Mobile/responsive visual check at 390×844 |
| Z6 | Fix everything found, re-verify |


---

## Progress log — 2026-09-04

### Repaired
All 35 tests that the interrupted work left broken are fixed, plus three genuinely
half-written implementations found only by compiling for real: the provider's idle/LRU
session sweeper, eight missing turn/session lifecycle methods behind the persistent-session
work, and the automation service's public surface.

**`pnpm typecheck` was lying.** `tsc --noEmit` on a composite project with a stale
`.tsbuildinfo` exits 0 without checking anything — 18 real compile errors survived a clean
run. All 27 composite packages now run `tsc --build --force`. Never trust `tsc --noEmit` here.

### Chat security (finding 5.1 and neighbours) — done
- Tool-permission prompts are real end to end: a durable blocking gate, a resolve route,
  and cards in the web app and the terminal. Copilot's resume path silently reverted to
  approve-everything; both paths now share one bridge. **Mobile card still to do.**
- Extension-authoring tools (write + hot-load code into the server process) are no longer
  handed to every chat — they need an explicit per-agent capability, off by default.
- Widget scripts run in a real `node:vm` context with a 5 s timeout; `process` and `require`
  are unreachable and an infinite loop is stopped. The old comment claimed all of this while
  `new Function` gave the script the global scope.
- Cross-chat plan access closed on all six handlers.
- The live stream authorises per subscription, so a phone grant can no longer watch the
  desktop screen.
- Widget assets are served only from their dedicated origin; the symlink guard uses `lstat`
  plus realpath containment.
- Raising a chat to `bypassPermissions` needs an admin scope; the chat update route is
  validated.
- A second prompt while one is generating is refused with 409 instead of silently discarding
  the first response.
- The browser navigation policy is wired and pinned by 17 tests: `file:`, cloud metadata and
  loopback are refused by default.

### Performance — done
- Event handlers are awaited, so backpressure is real.
- Delta writes coalesce to the end of the tick instead of always waiting the batching timer.
  Same-tick batching is preserved; the ~125 events/second per-conversation ceiling is gone.
- The conversation binding key is written and compared by ONE formatter, so a chat's first
  message no longer forces a full rebuild.
- The working-tree cache TTL now exceeds the live-snapshot interval, with the invariant
  asserted by a test. It could never hit before.
- The standing widget prompt drops from 8,097 characters to 499; the detail is returned by
  `search_widget`, and the authoring block only goes to chats that have those tools.
- Full `highlight.js` replaced by the curated grammar set: 311.9 KB gzip to 42.0 KB.
- ChatPage subscribes narrowly with the per-token work isolated in leaf components; the
  workflow builder no longer subscribes to its whole store.

### Workflows / automations / data — done
- One readiness predicate and one reconcile; the diamond-with-a-failed-branch hang is fixed
  and covered by regression tests.
- Stage timeouts have a real default, clear their timer, and abort the underlying call; a
  heartbeat plus the existing reconciler reaps stuck stages.
- Result validation reads its own stage's output; retries get a fresh workspace and inherit
  predecessor outputs; runs are pinned to a definition snapshot.
- The automation scheduler is database-backed: due-row claim, lease held for the work,
  timezone, missed-run and overlap policies, three-way status including `partial`.
- Migration v45 fixes fresh installs; v23 no longer wipes saved plans; schema convergence and
  `safeAddColumn` wording are pinned by tests.
- A substituted JSON column is always reported — one change covering all 59 call sites.
- The hourly retention sweep drops from 50,000 rows to 2,000, four times as often.

### Still to do
Mobile permission card · MCP credentials end to end and provider honesty · webhook public
route with signature verification and hashed tokens · workflow template importer and
transactional delete · remaining dead workflow UI · accessibility pass and design-system
ratchet · log rotation, container file, ops docs · **then the live browser and terminal
testing.**


---

## Live testing findings (2026-09-04)

Driving the terminal client against a running server, as a user would.

**Fixed — `GET /chats` ignored both filters every client sends.**
`generatorai chat list --limit 3` returned 343 rows, and `--status archived` returned
active chats. The flags are documented and the shared client sends them; the route read
only `status` (while the client sends `archived`) and ignored `limit` entirely. So every
client — web, mobile and terminal — also fetched the whole table on every list.
Covered by `apps/server/__tests__/routes/chats-list-filters.test.ts`.

**Noted, not yet fixed.**
- `system status` prints raw JSON blobs (`harness`, `memory`, `admission`) inside an
  otherwise human-readable table.
- `chat list` takes `--limit`; `workflow list` does not. Sibling list commands should agree,
  but the server-side list must honour it first — adding the flag alone would repeat exactly
  the bug above.


---

## Live browser testing (2026-09-04)

Driven with Playwright's bundled Chromium against the real dev stack. The installed
Google Chrome refuses remote debugging under an enterprise policy on this machine, which is
worth knowing before anyone tries the same thing.

### Verified working
- Every page loads with **zero page errors and zero failed API requests**: dashboard, chats,
  agents, workflows, automations, projects, scripts, settings.
- **No horizontal overflow at 390 px** on chats, workflows or settings.
- A workflow that fails to load now shows "Failed to load this workflow" with the reason,
  instead of a blank editable canvas.
- **The core chat path works end to end**: create a chat, type into the composer, press Enter,
  the message renders immediately, the transcript starts growing after 61 ms, and a real
  streamed reply arrives. No errors.

### Bugs found live and fixed
1. **`GET /chats` ignored both filters every client sends.** `chat list --limit 3` returned all
   343 chats and `--status archived` returned active ones. The route read only `status` while
   the shared client sends `archived`, and dropped `limit` entirely — so web, mobile and
   terminal all fetched the whole table on every list.
2. **"New Chat" was broken out of the box.** The default model was pinned to
   `claude-sonnet-4.6`, which this account's catalogue no longer offers, so every new chat died
   at creation. It surfaced as a bare 502 naming no alternative. The default is now `auto`,
   which the provider always offers, and an unavailable model now returns a message naming the
   models that ARE available.
3. **The secrets vault could not be written, and it was fatal at boot.** An atomic rename over
   the vault file fails with `EPERM` whenever another process holds the destination — here
   OneDrive, because the repository lives under a synced Desktop. Sixteen orphaned `.tmp` files
   dating back to April show it had been failing for months. The write now retries and then
   falls back to copying into the existing file, so the server starts.

### Noted, not fixed
- List rows are buttons, not links, so a chat or workflow cannot be middle-clicked, opened in a
  new tab, or copied as a URL.
- `system status` in the terminal prints raw JSON blobs inside an otherwise formatted table.
- `chat list` takes `--limit`; `workflow list` does not.
- The full test suite is flaky under parallel load ON THIS MACHINE: tests that spawn real
  processes or write files fail together and pass individually. The disk was at 100% for part of
  the session. Use `--concurrency=2`, and treat a lone failure as suspect until re-run alone.


---

## Independent review of the change set, and what it caught

A separate reviewer read the whole diff with one brief: find defects this work INTRODUCED, and
claims it makes that are not true. It found six, and **three were my own comments overstating
what the code did** — the exact failure this review exists to correct. All six are fixed.

1. **The stream scope check guarded the side door, not the front one.** Subscriptions added
   later were authorised; the initial list sent when the connection is opened was not. So a
   caller could name another chat — or `global` — in the first payload and receive it, while the
   comment above claimed a connection "can never be used to widen access". Now checked in both
   places.
2. **Approvals-off was gated on update but not on creation**, and a chat created without an
   explicit mode defaulted to approvals off. The front door was open. Creation now needs the
   admin scope to ask for it, and a caller without that scope gets a gated chat by default.
3. **Only explicit navigation was policy-checked.** Clicking a link, a redirect, or page script
   moving the page all bypassed it, so the agent could still click through to a `file://` path
   or the cloud metadata address and read it back in a screenshot. The check now runs on the
   URL the page actually ended up at, after every action.
4. **The MCP merge disagreed with itself again, in the opposite direction.** Creation let the
   chat's own override win; resume let the agent's config win. A per-chat override worked until
   the first restart and then silently reverted. Both paths now call the one merge.
5. **The "one turn at a time" guard had a race.** The check and the lock it depends on were 250
   lines and several awaits apart, so two quick prompts could both pass — reproducing the very
   bug the guard was added to prevent. The chat is now claimed in the same tick as the check.
6. **The widget timeout did not stop an async loop.** It bounded how long the caller waited, not
   the script, so `while (true) { await widget.act() }` kept driving the widget forever. The
   deadline now disarms every injected call, and a call cap bounds what a script may DO as well
   as how long it may take — time alone was not a bound, because a tight loop exhausts memory
   well inside five seconds.


---

## The pre-message git snapshot, finally measured

Review item 25 said to measure this on a real workspace before deciding how urgent it is. Timed
against the running server on THIS workspace (a large repository with 458 modified files):

| Stage | Elapsed |
|---|---|
| Prompt accepted → `harness.turn_start` | **3.1 s** |
| → first token | 9.9 s |
| → turn complete | 10.2 s |

`git add -A` alone takes 2.0 s here. So roughly **3 seconds of every message is spent before the
agent starts**, on a checkpoint that is awaited before the message is even saved. That is about
30% of the wait on this workspace, and it grows with repository size rather than with how much
changed — the opposite of what the code comment claims.

**Fixed** — and the framing above was wrong. "Make it non-blocking" would break the thing the
checkpoint is for: if the agent starts before the snapshot lands, the snapshot is no longer the
state the prompt was written against, so both the turn diff and the rewind target are wrong.

What the snapshot actually has to precede is the AGENT, not the user's own message. It was
awaited roughly 150 lines too early, in front of persisting the user message and emitting
`turn_start` — none of which touch the working tree. The capture is now STARTED at the same
point and AWAITED immediately before `harness.sendPrompt`, which is the last moment the
guarantee still holds. The snapshot overlaps message persistence and event emission instead of
delaying them, and the user sees their message and the thinking state right away.

The correctness property is unchanged: no agent tool can run until the `before` checkpoint has
resolved.


---

## Final pass — remaining phase items, closed

Every item below was verified in code rather than by grep, because a grep for a symbol name
found several things that existed and did nothing.

| Item | What was actually wrong | Resolution |
|---|---|---|
| D13 | `ChangeSummaryService` joined a caller-supplied relative path onto the repo root in three readers, so `../` escaped the repository. | `resolveInsideRepo` resolves and realpath-checks containment; applied to all three readers. 4 new tests. |
| H16 | Stream retention pruned by age alone, deleting the streamed text that chat crash recovery replays. | Three-way split: deltas on a short TTL, items on the full TTL, and an unfinished turn's rows exempt from both up to a hard multiple. 5 new tests, plus two new config knobs. |
| E11 | `partial` had no `StatusBadge` entry, so an execution that half-failed showed as a neutral grey pill. The scheduler's `nextRunAt` was never displayed anywhere. | `partial` is now a warning-toned "Partly failed". Next run shown on the automations list, the detail page, and the CLI table. Secret masking was already correct. |
| D14 (Wake now) | The button's only handler was `e.stopPropagation()`. The whole wake path existed but had no on-demand entry point. | `DurableSleepService.wakeNow`, a `POST …/stages/:id/wake` route with run-ownership and not-sleeping guards, client method, hook, and the button wired. 6 route tests + 4 service tests. |
| D14 (Hooks tab) | `deriveRunView` hardcoded `hooks: undefined`, so the tab was permanently empty although the server emits the events with the exact fields the inspector needs. | Hook invocations accumulate in the stream reducer and are attributed per stage. 6 new reducer tests. |
| A4 (mobile) | Mobile rendered plan and question gates but not tool permissions, so a permission prompt hung the turn with no way to answer. | `PermissionCard`, ordered first among the gates because the agent is stopped mid-tool. 409 treated as already-answered. |
| List rows | Rows were `div role="button"` calling `navigate()`: no middle-click, no ctrl-click, no copy-link, nothing for a screen reader to announce. | `EntityListRow` takes `href` and renders a stretched real anchor; chats, workflows, automations and run rows converted. Selection mode still uses a click handler. |
| CLI `system status` | Printed the whole `/api/health` diagnostic payload, dumping four nested objects as raw indented JSON. | New `fieldsOnly` record option plus a curated field set. `--json` still returns everything. |
| CLI `workflow list` | No `--limit`, unlike every other list command. | Added, applied after the tag filter. |

### Verified by driving the running application

- **Stream durability.** Transport severed mid-turn: reconnected, resumed, finished, no lost and
  no duplicated content, assistant message persisted. Mid-turn page reload: transcript restored
  and the turn completed. Forced 503s on the stream endpoint: the answer still arrived and no
  dead-end error was shown.
- **Interrupt.** Stop halts streaming promptly and the chat accepts a new turn immediately after.
- **Concurrent turns.** A second prompt during a live turn is refused with 409 `CHAT_BUSY`.
- **Workflow runs.** A pending run lists its stages; a running one shows the live timeline,
  elapsed time and stage prompts; it survives a transport drop; the UI agrees with the server.
- **Mobile widths.** Chats, automations, workflows and settings all fit 390 px with no overflow.

### One finding that was not a code defect

Under live chat load, `/api/health` was observed taking over 10 s while answering at 0.22 s idle.
The cause is the synchronous `better-sqlite3` work this server does on its only thread. The
`docker/server.Dockerfile` health check had a 5 s timeout, which would have marked a merely BUSY
container unhealthy and had the orchestrator restart it mid-turn. Timeout raised to 15 s with
five retries. The underlying single-thread stall is a real characteristic worth its own work,
but it is not a regression and not something a health check should adjudicate.



---

## Progress log — 2026-09-05 (audit execution)

Consolidated audit and action list: `docs/ARCH_PERF_AUDIT_2026-09-05.md` (Parts 1–3). Executed
the same day: A1 (pre-warm permission default — CI green again), A2 (persistent Claude sessions
now closed on sweep/LRU/delete/archive; the leak behind ~1.9 GB of `claude.exe` children), A4
(live-session cap 32→8, idle 30→10 min, orchestrator workers 12→4), A5 (finished workers release
their runtime), A6 (boot-time orphan reaper; 17/17 killed live), A7 (`/api/health` →
`harness.runtime`), A8 (server-restart-mid-turn recovery), A9 (one template importer), A10 (Shiki
lazy chunk 1.68 MB → 225 KB; per-chunk budget), A11 Option B (delta log opt-in, comments honest),
A14 (extension hot-reload leak), A15/A17 in part. Not done: A3 commit (yours), A12 agent host,
A13 panel gating, A16 CUA, A18 SQLite measurement — see Part 3 §9/§11 for the exact state.

### Second pass, same evening
A7 ping honesty, A8 **live drill verified** (kill mid-turn → partial persisted, error+idle at seq 202/203),
A12 host stubs (list_models/select_agent/list_agents round-trip; host still opt-in), A13 Computer panel
gated on tab visibility (Browser already was), A15 measured (RSS is native: 256 MB mmap + caches; heap
~115 MB), A17 (`usage_ledger` dropped in v50; 4 legacy templates removed; "OpenCode has no tests"
RETRACTED — 36 exist), A18 slow-statement tripwire (`GENERATORAI_SQL_SLOW_MS`) + `/api/health`
`slowStatements`; zero statements >50 ms measured. The repo load scenario was failing on a STALE
`dist-bundle` and wrong env names in the script — fixed; all legs pass on a fresh bundle. Details:
`docs/ARCH_PERF_AUDIT_2026-09-05.md` Part 4.
