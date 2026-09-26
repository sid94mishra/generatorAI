# 05 — Gap matrix

Every designed element whose data or behaviour the current API, stores and desktop bridge do not provide. D-36 applies to all of them: a gap is built API-first, its read model goes in `packages/client-core` so mobile gets it too, and **a designed element whose gap is open is not rendered.** Never render placeholder or fake data.

**How this was checked.**
- Every "exists today" claim was checked against `apps/server/src/routes/*.ts`, `apps/web/src/platform/HttpPlatformClient.ts`, `hooks/*Queries.ts`, `packages/shared` types and `apps/desktop/src/{main,preload}` on `desktop_redesign @ a83a7bf`.
- `file:line` references point at the handler or declaration.
- Server paths are relative to `/api`, which `apps/server/src/routes/index.ts` mounts.

**Every new endpoint needs the same five wiring steps.** Each gap below repeats them only where something differs:
1. A route in `apps/server/src/routes/`, mounted in `routes/index.ts`.
2. A prefix entry with read/write scopes in `packages/auth/src/routePolicy.ts`. An unmatched prefix is refused.
3. An entry in the OpenAPI document (`routes/openapi.ts`).
4. A method on `IPlatformClient` (`packages/shared/src/types/IPlatformClient.ts`), implemented in `HttpPlatformClient.ts` and in `packages/client-core/src/api/client.ts`, so the CLI and mobile use the same call.
5. A TanStack Query hook in the matching `apps/web/src/hooks/*Queries.ts`.

**Every new SSE event kind** that a list view needs goes in `LIFECYCLE_EVENT_KINDS` (`apps/server/src/composition/streamScopes.ts`), so that it reaches the `global` scope. Devices holding only `read:activity` can open `global` (`routes/stream.ts:138`).

**Owners and effort.**
- **P2** = the redesign's backend track.
- **PW** = the Workflow Overhaul Plan, with its own phase and work-package codes.
- Effort: S ≤ 1 day · M 2–4 days · L ≥ 1 week.

---

## 1. Index

| ID | Element | Needed by | Owner | Effort |
|---|---|---|---|---|
| G-01 | Attention feed (Needs you + Running, live) — **built (P2-01)** | P3 | P2 | L |
| G-02 | Chat list v2: status, Changes ±, last activity, filters, paging — **built (P2-02)** | P3 | P2 | M |
| G-03 | Server switcher: server list, reachability, desktop IPC — **built (P2-03)** | P3 | P2 | M |
| G-04 | Desktop update state in the renderer ("Restart to update") — **built (P2-03)** | P3 | P2 | S |
| G-05 | Attention counts in the desktop main process (tray, menu, badge) — **built (P2-03)** | P3 | P2 | S |
| G-06 | Transcript view mode Normal / Verbose / Summary | P4 | P4 (client only) | S |
| G-07 | Computer consent plan + scope; Pause agent / Take over — **built (P2-04)** | P4 (degrades) | P2 | M–L |
| G-08 | Deep links keep an allowlisted query string — **built (P2-04)** | P4 | P2 (desktop) | S |
| G-09 | Model-picker provider methods on the platform client — **built (P2-04)** | P4 | P2 | S |
| G-10 | Stats summary (Home This week, Workflows strip, automation stats) — **built (P2-05)** | P5 (PW later) | P2 | M |
| G-11 | Recently finished activity — **built (P2-05)**, minus PR/commit sources | P5 | P2 | M |
| G-12 | System info (version, database size, disk, agent capacity) — **built (P2-05)** | P5 | P2 | S |
| G-13 | Project summaries (Projects columns, tab counts) — **built (P2-05)** | P5 | P2 | S–M |
| G-14 | ProjectDetail Chats tab (project filter on the client) — **built (P2-02)** | P5 | P2 (via G-02) | S |
| G-15 | ProjectDetail Runs tab (`projectId` filter on runs) — **built (P2-05)** | P5 | P2 | S |
| G-16 | Codebase fetch/clone logs and live status — **built (P2-06)** | P5 | P2 | M |
| G-17 | Worktree size, linked entity, reclaimable space — **built (P2-06)** | P5 | P2 | M |
| G-18 | Palette entity search (+ recents) — **built (P2-06)** | P5 | P2 | M |
| G-19 | Per-project customization enable/disable on the server — **built (P2-06)** | P5 | P2 | M |
| G-20 | Background-task cancel attribution — **built (P2-04)** | P4 (optional) | P2 | S |
| G-21 … G-29 | Workflow, automation and script engine features | PW | PW | — |

---

## 2. Gaps owned by the redesign (P2 backend track)

### G-01 — Attention feed

**Status: built in P2-01.** `AttentionService` (`packages/core/src/services/AttentionService.ts`), `GET /attention` (`apps/server/src/routes/attention.ts`, policy `read:activity`, OpenAPI `AttentionSnapshot`), `attention.upsert|remove|counts` on `global` with per-principal redaction in `routes/stream.ts`, `packages/client-core/src/attention/`, `IPlatformClient.getAttention`, `hooks/attentionQueries.ts`. No migration. Deviations from the text below, all forced by the parallel-work rules or the code:
- `HitlService.listAllPending()` is not added (workflow engine is PW-owned): stage asks are read with `IStageRunRepository.getByRunId` for every live run, which is the same set.
- `ChatManagementService.getStreamingSince()` is backed by `StreamingChatRegistry` (the existing in-flight map), which also exposes `onStreamingChange`; the service listens to that rather than inferring streaming from `session.active` / `harness.idle`, which race the map.
- Bus events are triggers only: each one re-reads the affected entity and the result is diffed, so a missed or reordered event cannot leave a stale ask.
- An entity with an ask is listed under Needs you only (never also under Running).
- `progress.label` is optional (omitted when there is no step title), per the "If there is none, the field is omitted" rule below.
- `seq` starts at `Date.now() × 1000` per process, so a client that outlives a server restart sees a gap and refetches.
- **P1-review fixes (P2-R12…R19):** `attention.counts` is emitted only when the totals change (a new tool-step label is an upsert without counts). The boot rebuild reads live automation executions with one indexed query (`listAutomationExecutionIdsByStatus`, `packages/db/src/repositories/AttentionQueries.ts`, read-only over the PW-owned table) instead of every automation's history. `chat.updated` is a chat trigger, so a rename or project move reaches the item's title/project. A computer-consent prompt with no `chatId` is listed on the top-level chat that owns its workspace (`chats.getByWorkspaceId`). A question's or plan review's `ask.summary` (free text written by the agent) is replaced by "Your agent has a question" / "Review the plan" for principals without the entity's read scope; tool, app and stage names stay. `GET /attention` answers **503 `ATTENTION_UNAVAILABLE`** until the service has started (never an empty "nothing needs you"). The web hook wraps client-core's `createAttentionStore` (below) — one implementation of the seq rules — and the store never cancels a snapshot request: deltas that arrive while it is in flight are held and replayed past the response's `seq`, so a delta burst cannot stall it and an older response cannot roll the view back.

**Elements & boards.**
- Sidebar "Needs you" (two-line rows) and "Running" (title + elapsed), plus the rail's needs-you dot and running counter. Every board with a sidebar shows them; ChatNarrow and WorkflowBuilder show the rail form.
- Home Needs you (inline Review / Approve / Open / Allow once) and Running (live step, timer, Stop).
- The ProjectDetail needs-you banner.
- The ChatsList Status column ("Needs you", "Running").
- Palette recents status.
- Tray and menu-bar counts (G-05).

**Exists today.** Only per-entity reads, and nothing live across entities:
- `GET /chats/:id/interactions` (`chats.ts:1145`) → `AgentInteractionRepository.listPendingByChat` (`packages/core/src/domain/ports/IPlanRepository.ts:92`). Interaction kinds are `plan_review | question | tool_permission` (`packages/shared/src/types/AgentMode.ts:332`).
- `GET /workflow-runs/:id/pending-interrupts` (`workflowRuns.ts:420`) → `HitlService.listPending(runId)` (`packages/core/src/services/HitlService.ts:497`).
- `GET /health` returns `runningChatIds` and `activeWorkflowRuns` (`health.ts:17`), from `ChatManagementService.getStreamingChatIds()` (`ChatManagementService.ts:1327`). There are no start times.
- Pending computer consent per workspace: `GET /workspaces/:id/computer/consent` (`computer.ts:339`), `PendingConsentStore.listPending(workspaceId)` (`PendingConsentStore.ts:191`).
- The web merges polled lists client-side in `hooks/useLiveOperations.ts`. It does not see chat asks (permission, question, plan).
- `global` SSE carries only the lifecycle kinds (`streamScopes.ts` `LIFECYCLE_EVENT_KINDS`). The ask events (`chat.permission.requested`, `chat.question.asked`, `chat.plan.review_requested`, `stage_run.awaiting_input`, `computer.consent_required`) reach only chat, session, run and workspace scopes. The web never subscribes to `global`.

**Needed.**
- **Service:** `packages/core/src/services/AttentionService.ts`. It holds the snapshot in memory, rebuilds it from repositories at boot, and updates it from bus events.
- **New repository/port methods:**
  - `AgentInteractionRepository.listPendingAll()`;
  - `HitlService.listAllPending()` (stage runs in `awaiting_input` across runs);
  - `PendingConsentStore.listAllPending()`;
  - `ChatManagementService.getStreamingSince(): Map<chatId, Date>`, recorded when a turn starts.
- **Endpoint:** `GET /attention?projectId=` → `AttentionSnapshot`. Policy prefix `/attention`, read scope `read:activity`.
  ```ts
  interface AttentionSnapshot {
    seq: number;                       // monotonic; SSE deltas carry the next seq
    generatedAt: string;
    needsYou: AttentionItem[];         // oldest ask first
    running: AttentionItem[];          // longest-running first
    counts: { needsYou: number; running: number;
              byEntity: Record<AttentionEntity, { needsYou: number; running: number }> };
  }
  type AttentionEntity = 'chat' | 'workflow_run' | 'automation_execution';
  interface AttentionItem {
    key: string;                       // `${entity}:${entityId}` (+ `:${ask.id}` for asks)
    entity: AttentionEntity;
    entityId: string;
    title: string;                     // chat name, "PR review pipeline #311"
    href: string;                      // route per 04 §1, incl. ?dock= (R-4)
    project?: { id: string; name: string };
    parent?: { entity: 'chat'; id: string; title: string };   // worker chat → orchestrator chat
    state: VisualState;                // D-18 map in packages/shared ('needs_you' | 'running' | 'waiting' | 'paused' | 'queued')
    since: string;                     // ISO: started needing you / started running
    ask?: {
      kind: 'tool_permission' | 'question' | 'plan_review' | 'stage_approval' | 'stage_input'
          | 'computer_consent' | 'run_paused';
      id: string;                      // interactionId | stageRunId | consent requestId | runId
      summary: string;                 // "Allow git push?", "Approve “Apply upgrades”"
      detail?: string;                 // command / "Stage 3 of 6 · 14 packages, 3 majors" (see scope rule)
      actions: Array<'allow_once' | 'deny' | 'approve' | 'reject' | 'answer' | 'open'>;
    };
    progress?: { label: string; step?: number; of?: number };  // "Running pnpm build", stage n of m
    stoppable: boolean;
  }
  ```
- **Sources for items:**
  - pending interactions give `tool_permission`, `question` and `plan_review` asks;
  - stage runs in `awaiting_input` give `stage_approval` and `stage_input`;
  - pending consent gives `computer_consent`;
  - runs in `running | starting | cancelling` go to Running, and runs in `paused` become the `run_paused` ask;
  - streaming chats go to Running;
  - running automation executions go to Running.
- **Worker chats roll up.** A worker chat's ask appears with `parent` set, and its `href` is the parent chat with `?dock=tasks`. This matches DockTasks, where a worker's ask is pinned in the parent.
- **`progress.label`.** The service keeps the latest step title per chat and run, taken from tool-start and stage events. If there is none, the field is omitted.
- **SSE:** add `attention.upsert` (`{ seq, item }`), `attention.remove` (`{ seq, key }`) and `attention.counts` to `LIFECYCLE_EVENT_KINDS`.
  - The service subscribes to: `chat.permission.*`, `chat.question.*`, `chat.plan.review_requested|decided|expired`, `stage_run.awaiting_input|input_received`, `workflow_run.*`, `automation_execution.*`, `session.active`, `harness.idle`, `harness.error` and `computer.consent_required`. It emits the deltas.
  - Reconnect replays by `seq`. On a gap the client refetches the snapshot.
- **Scope rule.** `ask.detail` and `progress.label` can contain commands and file names. Strip both, in the route and in SSE fan-out, for principals that lack `read:chats` (chat items) or `read:workflows` (run items).
- **Quick actions reuse existing endpoints.** No new write API:
  - `POST /chats/:id/interactions/:iid/permission` (`chats.ts:1200`) and `…/respond` (`:1165`);
  - `POST /chats/:id/plans/:pid/decision` (`:1058`);
  - `POST /workflow-runs/:runId/stages/:stageId/approve` (`workflowRuns.ts:476`);
  - `POST /workspaces/:id/computer/consent` (`computer.ts:345`);
  - Stop: `POST /chats/:id/cancel` (`chats.ts:582`) and `POST /workflow-runs/:id/cancel` (`workflowRuns.ts:204`).
- **client-core:** `packages/client-core/src/attention/`.
  - `attentionReducer(state, event)` (pure);
  - `createAttentionStore(api, mux)`;
  - selectors `selectNeedsYou`, `selectRunning`, `selectCounts`, `selectAttentionFor(entity, id)`, `selectAttentionByProject(projectId)`.
- **Client call:** `getAttention(filter?)` on `IPlatformClient`.
- **Web:**
  - `hooks/attentionQueries.ts` `useAttention({ projectId?, enabled? })` → `{ data, error, isLoading, refetch }`: client-core's `createAttentionStore` over `platform/muxStream.ts`, shared per platform + project and reference-counted, read through `useSyncExternalStore` (as built after P2-R12; the React Query version is gone);
  - `useAttentionCounts(options?)` — `useDesktopIntegration` passes `{ enabled: isDesktop }`, so a plain browser tab opens no feed nobody reads (P2-R18).
  - `hooks/useLiveOperations.ts` is deleted in the Home PR.

**Consumers.** Sidebar and rail (P3), ChatsList status (P3), Home (P5), ProjectDetail banner (P5), palette (P5), tray (G-05), mobile drawer, Home and notifications (`08-mobile-readiness.md` M-09).

**Owner / phase / effort.** P2 · needed by P3 · **L**. This is the first item of the track.

### G-02 — Chat list v2

**Status: built in P2-02.** Migration **v55** `chat_list_summary_columns` — the next free number here; migration versions must be contiguous (`SchemaConvergence.test.ts`), so the Workflow Overhaul's planned v55 (run-history drop) and this one renumber on merge, whichever lands second (07 §Running in parallel). Shapes as built — `packages/shared/src/types/ChatList.ts` is the source of truth:
- **Columns** (`chats`): `last_activity_at` (epoch ms), `last_turn_status` / `last_turn_ended_at` (ms) / `last_turn_error`, `changes_files` / `changes_additions` / `changes_deletions`; indexes on `last_activity_at` and `workspace_id`. Backfill: activity = newest message, else creation; last turn = newest assistant reply (`partial` → cancelled, an `Error:` system line → failed, else succeeded). Change columns start NULL and are filled lazily (below).
- **`GET /chats`** (replaces the bare array; the old `archived=` spelling is gone) — `status=active|archived`, `projectId`, `agentRef`, `tag`, `state=needs_you|running|done|failed` (these four **repeat for "any of"**; different filters AND), `q` (case-insensitive substring of name, description **or a tag**), `sort=activity|created|name` (activity and created newest first, name A→Z), `cursor`, `limit` (default 50, **clamped to 200**), `workers=false`. Answers `ChatListPage = { items: ChatListItem[]; nextCursor: string | null; total; counts: { all; active; archived } }`; `total` matches every filter, `counts` every filter except `status`. Cursors are opaque keyset positions (base64url `{s, v, i}`), valid only for the sort they were issued under (else 400). Invalid parameters answer 400 `VALIDATION_ERROR`.
- **`ChatListItem = Chat & { summary: ChatListSummary }`** with `summary = { lastActivityAt; lastTurn?: { status: 'succeeded'|'failed'|'cancelled'; endedAt; error? }; changes?: { files; additions; deletions }; agent?: { ref; name; role? }; preview?: { text; role; at } }`. Deviations from the text below: the one-line `preview` moved from the top-level `preview`/`previewRole`/`previewAt` fields into `summary.preview`; `agent.role` is optional (absent for an unresolvable ref); `agent` prefers the live agent (renames show) and falls back to the frozen `agentSnapshot`, then the bare ref; `changes` is absent (render "—") until computed; `lastTurn.error` only on `failed`.
- **State filter:** `needs_you` / `running` come from `AttentionService.getSnapshot()` via `liveChatIds` (shared), where a worker chat's ask or run also counts for its orchestrator; `done` / `failed` are the last turn's outcome of a chat that is not live right now.
- **Turn columns** are written by `ChatManagementService`: activity at turn start, and at turn end (idle, provider error, send failure, cancel — whichever finalisation route wins) the outcome: cancelled if the turn was stopped, failed if any `harness.error` arrived or the prompt could not be sent, else succeeded.
- **Change columns**: `ChatChangeStatsService` (core) recomputes the workspace's baseline → working summary (the change-summary engine; the legacy `root` repo excluded when a codebase is mounted, like the Changes tab) on `workspace.changed`, `checkpoint.restored` and `harness.idle`, coalesced per workspace (1.5 s window), and once per workspace per process for a listed row whose columns are NULL. At most 3 summaries run at once across all workspaces (FIFO queue, P2-R9), and each drops only its own repos' memoised working tree (`getSummary({ freshWorkingTree: true })`). A repo the engine fails on keeps the previous value (its zeros are placeholders). Every chat on a shared workspace (orchestrator + workers) gets the same stats. A commit does not move baseline → working, so it triggers nothing.
- **Bulk (03-domain F-chats-01):** `POST /chats/archive` and `POST /chats/delete` with `{ ids }` (1–200) → `ChatBulkResult = { succeeded: string[]; failed: Array<{ id; code; message }> }`; an already archived chat counts as archived. **Contract for more than 200 (P2-R1): the client batches.** `runChatBulk(ids, send)` in `packages/shared` de-duplicates, sends sequential requests of at most `CHAT_BULK_MAX_IDS` and merges the per-id results; every client uses it (web `HttpPlatformClient.archiveChats/deleteChats`, client-core `chats.archiveMany/removeMany`, so mobile and CLI inherit it). A request that fails outright is thrown when nothing succeeded yet; after a batch has succeeded, the remaining ids are reported as failed with that error rather than thrown, so the chats that were removed are never hidden.
- **SSE:** `chat.updated` `{ chatId }` (lifecycle kind) — emitted when a summary column moves **and by `PATCH /chats/:id` whenever a list-visible field changes** (`name`, `description`, `tags`, `status` incl. unarchive, `projectId`, `agentRef`; P2-R2). Live lists therefore need no polling safety net. The attention feed treats it as a chat trigger (titles follow renames). `chat.deleted` was declared but never emitted; `deleteChat` now emits it on the global path. Web lists fold a burst of list events into one refetch per 250 ms and never cancel a request in flight (P2-R20).
- **Status map:** `chatTurn` domain in `packages/shared/src/status/maps.ts` (succeeded → "Done", failed, cancelled → skipped "Cancelled"; 02 §7.3).
- **client-core:** `chats.list(query)` → `ChatListPage<ChatListRow>`, `chats.archiveMany`, `chats.removeMany`; read model `packages/client-core/src/chats/` — `chatRowState(row, chatLiveSets(attentionSnapshot))` (archived › needs_you › running › last turn › idle), `chatRowStatus`, `chatListInvalidatedBy` / `chatListStreamFilter` (attention kinds only for a live-state filter), `chatListKey`, `mergeChatListPages`.
- **Platform client:** `IPlatformClient.listChats(query?: ChatListQuery): Promise<ChatListPage>` (replaced in place), `archiveChats(ids)`, `deleteChats(ids)` (appended).
- **Web:** `hooks/chatListQueries.ts` — `useChats(query)` (one page), `useChatPages(query)` (infinite, merged), `useBulkArchiveChats`, `useBulkDeleteChats`; live through one `global` subscription per hook, no polling. The legacy `ChatsListPage` pages, searches and filters on the server (scroll loads the next page); `DashboardPage` reads `counts.active`; `useLiveOperations` reads the first 100 active chats by activity. Mobile, `cli-core` `chat list` and the TUI read `.items`.

**Elements & boards.** ChatsList:
- the Status column (Needs you / Running / Done / Failed / Archived);
- the **Changes ±** column;
- the Agent column;
- the Activity column and the "Last activity" sort;
- the Project / Agent / Status / Tags chips;
- "Showing 12 of 48 · scroll to load";
- seg counts.

Palette "Recent chats" also uses it.

**Exists today.**
- `GET /chats?status|archived&projectId&limit` (`chats.ts:328`) returns the whole list, capped at 500, with a preview. It has no cursor or offset, no total, no agent/tag/text filter and no sort.
- `Chat` has `status: 'active' | 'archived'` only, plus `tags`, `agentRef` and `agentSnapshot`. There is no last-turn outcome.
- `HttpPlatformClient.listChats` sends only `status` (`HttpPlatformClient.ts:720`).
- `useChats` filters out worker chats client-side and polls every 30s (`hooks/queries.ts:394`).
- Change counts exist only per workspace (`GET /workspaces/:id/changes`, `workspaces.ts:620`), which would mean N requests. Checkpoint stats are per-parent churn, not a net diff (`packages/shared/src/types/Checkpoint.ts` `CheckpointStats`).

**Needed.**
- **Database migration** (`packages/db`): chat columns `last_activity_at`, `last_turn_status` (`succeeded | failed | cancelled`), `last_turn_ended_at`, `last_turn_error`, `changes_files`, `changes_additions` and `changes_deletions`.
  - `ChatManagementService` writes the turn columns at turn end (idle, error, cancel).
  - The change columns are recomputed with the existing change-summary service (baseline → working): at turn end, and on a debounced `workspace.changed` (discard, restore, commit).
- **Endpoint (replaces the current list; no compatibility shim):**
  `GET /chats?status=&projectId=&agentRef=&tag=&q=&state=needs_you|running|done|failed&sort=activity|created|name&cursor=&limit=50&workers=false`
  → `{ items: ChatListItem[]; nextCursor: string | null; total: number; counts: { all: number; active: number; archived: number } }`.
  - `ChatListItem = Chat & { summary: { lastActivityAt: string; lastTurn?: { status; endedAt; error? }; changes?: { files; additions; deletions }; agent?: { ref; name; role } } }`.
  - `state=needs_you|running` is resolved with G-01. `workers=false` does the worker filtering on the server.
- **Consumers to update in the same PR:** web `useChats`, mobile, the CLI `chat list` and `packages/client-core/src/api/client.ts`.
- **SSE:** `chat.updated` (`{ chatId }`, emitted when the summary columns change) goes in the lifecycle kinds. `useChats` invalidates on it and on `chat.created | archived | deleted`, and stops polling.

**Consumers.** ChatsList (P3), palette recents (P5), ProjectDetail Chats tab (G-14), G-11, mobile catalogue.

**Owner / phase / effort.** P2 · P3 · **M**.

### G-03 — Server switcher

**Elements & boards.**
- The sidebar server switcher row and the 280px Servers popover (status per server, "Add server…", "Manage servers").
- The Windows title-strip server chip.
- Settings › Security › Servers (Switch, status).

**Exists today.**
- The browser catalog is in `packages/client-runtime/src/connections.ts` (`ServerConnection { serverId, label, endpoint, endpoints, kind, managed, lastConnectedAt }`). Switch and forget are in `apps/web/src/platform/authRuntime.ts:346`.
- The desktop keeps a separate remote list in `apps/desktop/src/main/backend-switcher.ts` (`switchToRemote` :59, `switchToEmbedded` :77). It is reachable only from the native Server menu (`menu.ts:143`).
- There is no reachability check. `GET /auth/server-info` (`auth.ts:120`, public) returns `serverName`, `serverId` and `endpoints`.

**Needed.**
- **`packages/client-runtime`:** `probeServer(endpoint, { timeoutMs: 2500 })` → `{ status: 'connected' | 'offline' | 'unpaired'; serverName?; latencyMs? }`, using `GET /auth/server-info`.
- **Desktop IPC** (`apps/desktop/src/shared/ipc.ts` and preload `window.generatoraiDesktop.servers`):
  - `list()` → `Array<{ id; label; url; kind: 'embedded' | 'remote'; active }>`;
  - `switchTo(id)`;
  - `add()`, which reuses `promptForRemoteServer`;
  - the event `onChanged`.
- **Web:** `hooks/serverQueries.ts` `useServers()`. It picks the desktop list when `lib/desktop.ts` reports the bridge, and the client-runtime catalog otherwise, then adds probe status. The same code runs on every OS.

**As built (P2-03).**
- `probeServer(endpoint, { timeoutMs, expectedServerId? })` (`packages/client-runtime/src/connections.ts`) fetches `GET {endpoint}/api/auth/server-info` with an `AbortController` timeout (default 2500ms). The result's `status` is the shared `ServerReachability` (`packages/shared/src/types/DesktopShell.ts`): a thrown/aborted request is `offline`; a 429 or 5xx is `error` (reachable, identity not confirmed; not "pair again"); any other non-2xx, a body with no `serverId`, or a `serverId` different from `expectedServerId` is `unpaired`; a 2xx body with the expected (or any, when none is known) `serverId` is `connected`. `serverName`/`latencyMs` are carried when present. The module has no runtime imports, and is exported as the `@generatorai/client-runtime/connections` subpath so the desktop main bundle can use it (P1-review P2-R23).
- **Reachability is probed where the network allows it (P1-review P2-R6).** The app's CSP is `connect-src 'self'` (server `csp.ts`, desktop `session-hardening.ts`) and other servers send no CORS headers, so a page can only probe its own origin. Desktop: main probes every entry with Node `fetch`, in parallel (`apps/desktop/src/main/server-probe.ts`), and `getServers` returns the result. Plain web: `useServers` probes only the catalog entry on the page's own origin (passing its `serverId` as `expectedServerId`) and marks every other entry `unknown`. The CSP was not widened.
- **Desktop IPC** (`apps/desktop/src/shared/ipc.ts`): `IPC.getServers` (`desktop:getServers`) → `DesktopServerEntry[]` (`{ id; label; url; kind: 'embedded' | 'remote'; active; status; serverName?; latencyMs? }`, `id: 'embedded'` for this machine, an entry with no URL is `offline`); `IPC.switchServer` (`desktop:switchServer`, payload `id`) → `backend-switcher.ts`'s `switchServerById` (`'embedded'` routes to `switchToEmbedded`, anything else to `switchToRemote`, an unknown remote id is a no-op); `IPC.addServer` (`desktop:addServer`) → `promptForRemoteServer()`. `IPC_EVENT.serversChanged` (`desktop:servers-changed`) fires whenever `backend-switcher.ts`'s `persist()` runs (switch, add, forget), via `onServersChanged`; the same listener rebuilds the native Server menu and the tray. Preload exposes all four as `window.generatoraiDesktop.servers = { list, switchTo, add, onChanged }`.
- **Web:** `lib/desktop.ts` `desktopServers` (`list` rejects instead of returning `[]` on failure, so `useServers` reports a query error rather than "no servers", D-36) and `hooks/serverQueries.ts` (`useServers`, `switchServer`, `addServer`); `ServerListItem.status` is `ServerReachability | 'unknown'`; `useServers` invalidates its query when `desktopServers.onChanged` fires.

**Consumers.** Sidebar and popover (P3), Windows strip chip (P3), Settings Security (P6), mobile drawer switcher.

**Owner / phase / effort.** P2 · P3 · **M**. Until P3's UI lands, the switcher shows the active server only, with no status dot.

### G-04 — Update state in the renderer

**Elements & boards.** DesktopWindows "Restart to update" pill, the Linux sidebar-header pill (D-23), and Home System "Version … · Up to date / Update · Restart".

**Exists today.** `apps/desktop/src/main/updater.ts:46` shows a native dialog on `update-downloaded`. The renderer gets nothing. The web knows its own build version (`__APP_VERSION__`, `settings/sections/General.tsx:53`).

**Needed.**
- **IPC** `updates.getState()` → `{ status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'; currentVersion; nextVersion? }`, plus `updates.onChanged` and `updates.install()` (`quitAndInstall`).
- The native dialog is shown only while no window is visible.
- **Web:** `lib/desktop.ts` wrapper and `useUpdateState()`.

**As built (P2-03).**
- `DesktopUpdateState` (`packages/shared/src/types/DesktopShell.ts`, used by desktop and web) is `{ status: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing'; currentVersion; nextVersion?; downloadedVersion?; percent?; error? }`; `currentVersion` is always read live from `app.getVersion()`. `updater.ts` folds every `electron-updater` event (`checking-for-update`, `update-not-available`, `update-available`, `download-progress`, `update-downloaded`, `update-cancelled`, `error`) into it and notifies subscribers. The downloaded version is kept apart from the check/download phase and `ready` is derived from it, so a later check or a failed one only sets `error` and `installUpdate` still works; `error` is cleared by the next non-failure transition; a check that fails before anything was downloaded is `idle` + `error` (P1-review P2-R7). On macOS, `ready` also waits for Electron's native `autoUpdater` `update-downloaded`, because electron-updater's own event fires before Squirrel.Mac has fetched and verified the update and `quitAndInstall` would wait for it forever (`platform.ts` `updaterHasNativeInstallStage`, P2-R4).
- IPC: `IPC.getUpdateState` (`desktop:getUpdateState`), `IPC.installUpdate` (`desktop:installUpdate`, calls the new `installUpdate()`), `IPC_EVENT.updateStateChanged` (`desktop:update-state-changed`). Preload: `window.generatoraiDesktop.updates = { getState, install, onChange }`.
- **The native "update ready" dialog stays until P3-06 (P1-review P2-R3).** It is skipped only when a renderer has subscribed to `updateStateChanged` **and** the main window is visible. The preload's `updates.onChange` reports each subscribe/unsubscribe over `IPC.watchUpdates` (`desktop:watchUpdates`); main counts them per renderer and forgets them on every renderer reset (closed, crashed, new top-level document). Nothing in `apps/web/src` subscribes until the P3-06 pill mounts `useUpdateState`, so today the dialog shows every time an update is ready, window visible or not. "Restart Now" calls the same `installUpdate()` the pill will call.
- **Web:** `lib/desktop.ts` `desktopUpdates` (`getState` rejects on failure instead of pretending to be `null`; `onChange`; `restartToUpdate`) and `hooks/updateQueries.ts` (`useUpdateState()`, `restartToUpdate()`); `useUpdateState` is `null` on plain web (D-23: "web: never" shows the pill) and while the state is unknown.
- **Install (P1-review P2-R4, R27, R28).** Nothing is stopped before the install is committed, and on Windows and Linux the installer starts only after our shutdown (D-54 has the full per-OS sequence). **Windows/Linux (`BaseUpdater`):** a side-effect-free check (installer file present; AppImage started from `$APPIMAGE`) → `confirmDiscard()` → register an exit hand-off with `quit-coordinator` and `app.quit()`; `quitApp` accepting the quit is the commit point; after the bounded shutdown (computer host, embedded server, tray) the hand-off calls `install(false, autoRunAppAfterInstall)` immediately before `app.exit(0)`. A refused or failed install at that point (e.g. a cancelled pkexec, or an NSIS spawn error, which electron-updater reports asynchronously) relaunches the current version. **macOS:** `confirmDiscard()` → mark the window manager quitting → `quitAndInstall()`; Squirrel closes the windows and quits, the normal shutdown runs, and ShipIt installs after exit; an `error` or 60 s without a quit is a failure and the app keeps running. Once committed, `installUpdate` is a no-op returning `quitting` (a second `quitAndInstall` would reset electron-updater's guard and install twice on exit, P2-R27).
- **R5 (06 §11), corrected by P1-review P2-R5.** The P2-03 account ("`app.exit()` never emits `quit`, so `autoInstallOnAppQuit` was skipped") was wrong. Electron documents only `before-quit` and `will-quit` as skipped by `app.exit()`. In Electron's source (`shell/browser/browser.cc`, 42-x-y), `app.exit` binds to `Browser::Exit`, which sets the exit code and destroys the windows (`DestroyAllWindows`); `OnWindowAllClosed` sees `is_exiting_` and calls `Shutdown()`, which notifies `OnQuit`; `App::OnQuit` (`api/electron_api_app.cc`) emits `quit` with that exit code. electron-updater's `addQuitHandler` (`BaseUpdater.js`) installs from `app.once('quit')` when the code is 0 and `quitAndInstall` was not called. So the ordinary quit path (`before-quit` → bounded shutdown → `app.exit(0)`) installs a downloaded update on Windows and Linux, and it always did. On macOS, Squirrel.Mac's ShipIt installs after the process exits, whichever way it exits. The code now reflects this: every quit, an update install included, goes through `quitApp` (one in-flight promise, so two quits at once share it); the update install adds only its exit hand-off (P2-R28). **Not yet confirmed on a real installer:** 06 §8's `mock-update-server` run on each OS is still owed, and 07 R-10 stays open until it happens.

**Owner / phase / effort.** P2 · P3 · **S**.

### G-05 — Attention counts in the desktop main process

**Elements & boards.** DesktopMac menu-bar menu: "Server running · 3 agents :3100", and the "Workflows 1" badge under Go to. The tray on every OS.

**Exists today.** `tray.ts:60` shows only the server state. The main process has no domain data. The renderer already pushes `MenuState` to main (`useDesktopIntegration.ts` `pushMenuState`; `apps/desktop/src/main/ipc.ts:222`).

**Needed.**
- Extend `MenuState` with `attention: { needsYou; running; runningChats; byEntity }`, pushed from the G-01 store. `tray.ts` and `menu.ts` rebuild from it.
- `app.setBadgeCount(needsYou)` where the OS supports it (macOS dock, Linux Unity). On Windows, `setOverlayIcon` through a shared helper; no ad-hoc platform checks.
- If the window has been destroyed, the counts are omitted and the item text degrades to today's.

**As built (P2-03).** The mechanism is exactly what "Exists today" describes, extended rather than replaced: main never subscribes to the server itself (it has no session for it) — it reuses the existing renderer→main `setMenuState` push (`useDesktopIntegration.ts`), which now includes `attention` whenever `useAttentionCounts()` (G-01) has a snapshot.
- `DesktopShellStatePush.attention` (`packages/shared/src/types/DesktopShell.ts`) is the G-01 `AttentionCounts` type verbatim (`{ needsYou; running; byEntity: Record<'chat'|'workflow_run'|'automation_execution', {needsYou;running}> }`) or `null`; `ipc.ts`'s `setMenuState` handler validates it (non-negative integers capped at 999, per-entity rows defaulted to zero) and hands it to `attention-state.ts` (`setAttention`), which repaints the tray and the badge. "3 agents" reads as `byEntity.chat.running` — workflow runs/automations do not count there.
- **The tray shows the counts; the application menu does not.** `tray.ts`'s `refreshTrayMenu()` reads `getAttention()` to build `Server: {state} · {n} agents (:{port})`, to suffix `Home` with `(needsYou)` (the board's per-entity badges cannot be derived from aggregate counts, so only Home gets one, per 06 §8) and to set the tray tooltip. In remote mode the counts belong to the remote server, so the first line is `{remote label} · {n} agents` and the embedded server gets its own `This computer: {state} (:{port})` line (P1-review P2-R23). Because the menu shows no counts, `setMenuState` rebuilds it only when a value it shows changed (`menu.ts` `applyMenuPush`): the renderer re-sends every field whenever the counts move, and a rebuild can close a menu the user has open on macOS (P2-R16).
- **Stale counts are cleared (P1-review P2-R8).** `WindowManager.onRendererReset` fires when the main window closes, its renderer process dies, or its top frame starts a new document (a backend switch, a restart repoint, a reload, the error page); `ipc.ts` then calls `clearAttention()`, which drops the counts, repaints the tray and clears the badge on every OS. Previously the badge and tray kept the previous server's number after a switch and after the window was gone.
- `apps/desktop/src/main/badge.ts`, one function (`applyAttentionBadge`) called from `attention-state.ts` (on every push and every clear) for every platform: macOS `app.dock.setBadge`, Linux `app.setBadgeCount` (a no-op on a DE without a Unity/libunity launcher — that is graceful degradation, not a platform special-case), and Windows a per-window `setOverlayIcon` with a 16×16 dot generated in-process (no bundled asset) — real parity on all three OSes rather than skipping Windows.

**Owner / phase / effort.** P2 · P3 · **S** (depends on G-01).

### G-06 — Transcript view mode (no server work)

**Elements & boards.** ChatLight header segment Normal / Verbose / Summary.

**Exists today.** Stream blocks already carry each step's input and output (`packages/client-core/src/stream`). StepRow can expand them.

**Decision (this document).** Client-only. D-36 listed it as an API gap; it is not one.
- **Normal:** grouped steps (the default).
- **Verbose:** every step expanded with its input and output.
- **Summary:** per turn, the user message, the final assistant text and one line "N steps · duration · +a −d".

The mode is persisted per chat in a device-local zustand store (`stores/transcriptPrefsStore.ts`). An LLM-written summary would be a new gap and is not planned.

**Owner / phase / effort.** P4 · P4 · **S**.

### G-07 — Computer consent plan, scope and take-over

**Elements & boards.** ChatComputer:
- the consent card with numbered planned actions;
- Scope "Queue Inspector only / Any app";
- "Pause agent" / "Take over".

**Exists today** (most of the board):
- consent per action and per app: `computer.consent_required` with `action`, `summary`, `appIdentity` and `scope: read | mutate | synthetic` (`PendingConsentStore.ts:139`); answers `allow_once | allow_run | always_allow | deny` (`computer.ts:306,345`);
- grants with revoke (`computer.ts:366,377`). Their `scope` maps to "Screen" (read) and "Keyboard & mouse" (mutate/synthetic);
- replay: `/activity` (`:517`), `/frames` (`:545`), `/recording` (`:444`), `/recording/turns` (`:681`), `/recording/video` (`:628`);
- runtime start/restart/stop (`:404`).

`ComputerPanel.tsx` uses all of these through raw `fetch`.

**Needed.**
- (a) `plan?: Array<{ action: string; target?: string }>` on the consent payload when the agent's tool call carries several actions, answered once for the batch.
- (b) The consent body gains `scope: 'app' | 'any'`; an `appIdentity: '*'` grant covers any app.
- (c) `POST /workspaces/:id/computer/control { mode: 'agent' | 'paused' | 'user' }` plus a `computer.control_changed` event on the workspace scope. The driver refuses agent actions unless the mode is `agent`.
- Typed methods on the platform client: `getComputerConsent`, `answerComputerConsent`, `listComputerGrants`, `revokeComputerGrant`, `setComputerControl`.

**Owner / phase / effort.** P2 · P4 · **M–L**. Until it lands, P4 renders the single-action consent card with no Scope segment and hides Pause/Take over.

**As built (P2-04).** None of it touches workflow-owned engine files (`ComputerService`, `PendingConsentStore`, the computer tools and routes are chat/workspace code).
- **Types** (`packages/shared/src/types/ComputerUse.ts`): `ComputerPendingConsent` (the `computer.consent_required` payload and `GET …/consent` row; replaces the unused `ComputerConsentRequest` and core's `PendingConsentSummary` / `PendingConsentEntry`) with `plan?: ComputerConsentPlanStep[]` (`{ action, target? }`, never typed content); `ComputerConsentReach = 'app' | 'any'`, `COMPUTER_ANY_APP = '*'`, `defaultConsentReach(decision)`; `ComputerConsentAnswer` / `ComputerConsentAnswerResult`; `ComputerGrant`; `COMPUTER_CONTROL_MODES = agent | paused | user`, `ComputerControlState { workspaceId, mode, changedAt }`. New refusal codes `agent_paused`, `user_in_control`. New event `computer.control_changed { workspaceId, mode, previous, changedAt }` (workspace scope via `workspaceId`); `computer.consent_resolved` gains `scope`.
- **(a) Plan:** no tool carried several actions, so one was added: `computer_run_steps` (1–10 `click_point | type_text | paste_text | press_key | scroll` steps against one window) → `ComputerService.actPlan(ctx, ref, steps)`: one prompt (`summary: "N actions in <app>"`, `plan` listing every step), then the steps in order, stopping at the first failure. Element-addressed steps are refused in a plan (every action invalidates snapshots, so only the first could ever be valid). Documented in the computer-use skill.
- **(b) Scope:** `POST /workspaces/:id/computer/consent` (and `/internal/computer/consent`) accept `scope: 'app' | 'any'`, **optional** — omitted keeps each decision's historical reach (`allow_run` any app, the rest this app), so the legacy ComputerPanel, mobile and CLI answers are unchanged; the answer reports the effective `scope`. `always_allow` + `any` stores a grant on `*` (label "Any app"), checked after the app's own grant and never over a per-app deny; `allow_run` + `app` limits the run grant to that app (run grants are now a list per workspace); a deny is always per app. The consent port's `prompt()` now returns `{ decision, reach }`.
- **(c) Control:** `GET|POST /workspaces/:id/computer/control { mode }` → `ComputerControlState`. `paused` / `user` make listApps, launchApp, bringToFront, listWindows, snapshot, verify, act and actPlan refuse (`agent_paused` / `user_in_control`) before consent or the driver, and `actPlan` re-checks between steps; runtime start/stop and recording stay the user's. Process-lifetime state (like run grants). It does not physically lock the pointer — a real computer-use host is not involved.
- **Clients:** `IPlatformClient` `getComputerConsent`, `answerComputerConsent`, `listComputerGrants`, `revokeComputerGrant`, `getComputerControl`, `setComputerControl` (HttpPlatformClient + Mock); client-core `createAdminApi().computer` typed (`consent`, `setConsent`, `grants`, plus `control`, `setControl`); read model `packages/client-core/src/computer/` (`applyComputerEvent`, `seedComputerDesk`, `selectPendingConsent`, `agentHasControl`, `consentAnswerOptions`, `COMPUTER_DESK_EVENT_KINDS`); web `hooks/computerQueries.ts` (`useComputerDesk`, `useAnswerComputerConsent`, `useComputerGrants`, `useRevokeComputerGrant`, `useSetComputerControl`). CLI: `computer answer --scope app|any`, new `computer control [agent|paused|user]`, `computer pending` columns fixed to the real fields (`summary`, `expiresAt`). `ComputerPanel.tsx` keeps its raw `fetch` calls (shapes are additive); P4's Computer panel uses the hooks.
- **Tests:** real routes + real `ComputerService` / `PendingConsentStore` / grant repository on temp SQLite with a fake driver (`computer-consent-control.test.ts`), service (control, reach, plan), store, tools, client-core model, web hooks.

### G-08 — Deep links keep an allowlisted query

**Elements.** R-4 `?dock=`, R-3 `?kind=`, R-5 `?run`, and pairing `generatorai://pair?code=` (AuthGate reads `?pair=`, `components/AuthGate.tsx:159`).

**Exists today.** `urlToRoute` (`apps/desktop/src/main/deep-link.ts:24`) drops the query and hash.

**Needed.** Keep the query but pass only the keys `pair`, `dock`, `tab`, `kind` and `run`. Check `appRouteOf` (`apps/desktop/src/main/navigation-guard.ts:55`, used for in-app popups at `window-manager.ts:217`) and apply the same rule there. Add unit tests for both.

**Owner / phase / effort.** P2 (desktop) · P4 · **S**.

**As built (P2-04).**
- `apps/desktop/src/main/deep-link-route.ts` (Electron-free): `deepLinkToRoute(url)` keeps the path, drops the hash and keeps only `DEEP_LINK_QUERY_KEYS = pair, dock, tab, kind, run` (re-encoded with `URLSearchParams`); dot segments and other schemes → `null`; the scheme is matched case-insensitively. `generatorai://pair?code=X` (also `pair/?code=` as Windows passes it, and `generatorai://?pair=X`) → `/?pair=X`, which `AuthGate` reads. `findDeepLinkInArgv` also unwraps a quoted argument. The route is logged without its query (a pairing code is a secret).
- Cold start: `registerDeepLinks()` (macOS `open-url`) now runs in `main()` before `whenReady`, because a launching link is emitted during `will-finish-launching`. `WindowManager.navigateTo` holds the route (last one wins) while there is no window, the first load is running, the window shows the error page or a newly committed document (`did-navigate`) has not finished loading, and applies it on the app page's `did-finish-load`. A link that arrives on macOS with every window closed calls `restoreFromTray()` to bring one back. Warm start (`second-instance` argv, `open-url` with a window) navigates at once.
- `appRouteOf` (in-app popups) was checked and deliberately **keeps the whole query**: its URL comes from the app page itself, which can set any query with `pushState`, and in-app links use keys outside the allowlist (`?projectId=`, `?new=1`, `?legacy=1`).
- Tests: `deep-link-route.test.ts` (rules, Windows/Linux argv shapes), `deep-link.test.ts` (macOS `open-url` cold/warm, argv cold/warm), `window-manager.test.ts` (held route on cold start, error page, reload).

### G-09 — Model-picker provider methods

**Elements & boards.** ComposerModelPicker: provider column with "Not signed in", detail pane (Context, Long context, Max output, Reasoning levels, Vision), refresh.

**Exists today (data complete):**
- `GET /harness/providers` (`harness.ts:50`: `installed`, `authenticated`, `ready`, `models`, `supportsLogin`, `stale`);
- `POST /harness/providers/:type/login|logout`;
- `GET /harness/models` (`harness.ts:148`) with `HarnessModel` fields `description`, `category`, `promptTokenLimit`, `longContext`, `maxOutputTokens`, `supportsVision`, `reasoningEfforts`, `defaultReasoningEffort` (`packages/core/src/domain/ports/IAgentHarness.ts:39`);
- `useHarnessProviders()` (`hooks/queries.ts:204`), already used by `ModelPicker`.

**Needed.** Only client methods: `getHarnessProviders({ refresh? })`, `loginProvider(type)` and `logoutProvider(type)` on the platform client. They replace the raw `fetch` calls in `settings/sections/Providers.tsx:61,84,108,143`.

**Owner / phase / effort.** P2 · P4 · **S**.

**As built (P2-04).**
- **Wire types** (`packages/shared/src/types/HarnessCatalog.ts`): `HarnessCatalogModel` (replaces web's `ChatModel`), `HarnessProviderStatus` (`supportsLogin` now required), `HarnessProvidersResponse { primary, stale, providers }` (`stale` always a boolean), `HarnessLoginResult`, `HarnessSetDefaultResult`, `MODEL_TIERS = lightweight | versatile | powerful` (the "tier" is `HarnessModel.category`). The server route body is typed with them; OpenAPI documents `/harness/providers`, `…/:type/login`, `…/:type/logout`.
- **Platform client:** `getHarnessProviders({ refresh? })`, `loginProvider(type)`, `logoutProvider(type)` and also `setDefaultProvider(type)` (the fourth raw `fetch` in Providers.tsx was `/harness/switch`). client-core: `harness.providers(refresh)`, `harness.login`, `harness.logout`, `harness.setDefault`; its `ProviderStatus` / `ProvidersResponse` are replaced by the shared types (mobile updated).
- **Read model** (`packages/client-core/src/models/pickerCatalog.ts`): `buildModelPickerCatalog(response)` → `{ providers, defaultProvider, models, stale }`: providers ordered ready-first (the configured default first while it is ready), each with `availability: ready | not_installed | signed_out | unavailable`, `error`, `supportsLogin`, and models only when ready; `defaultProvider` is never a provider that is not ready (null when none is). `PickerModel` = `{ tier, description, contextTokens, longContextTokens, maxOutputTokens, vision, reasoningEfforts, defaultReasoningEffort, source }`. `readyCatalogModels` (flat, ready-only, default provider first — so "start on the first model" can never pick an unavailable provider), `findPickerModel`, `modelReasoningEfforts`, `providerAvailability`.
- **Web hooks** (`hooks/harnessQueries.ts`, moved out of `queries.ts`): `useHarnessProviders`, `useModels`, `useModelPickerCatalog`, `useRefreshHarnessProviders`, `useProviderLogin`, `useProviderLogout`, `useSetDefaultProvider` — one cache entry, polling every 3 s while `stale`. The old relative `fetch('/api/harness/providers')` (which ignored the platform's base URL) is gone.
- **Consumers:** Providers settings (all raw `fetch` removed), SourceControl, ChatInput, CreateChatDialog, AgentEditorPage, ChatPage, legacy `ModelPicker` (its default tab now comes from `buildModelPickerCatalog`), mobile ModelSheet / providers / useModels, CLI `model` completion (ready providers only; it used to offer signed-out providers' models).

### G-10 — Stats summary

**Status: built in P2-05.**

**Elements & boards.**
- Home "This week" (Chats, Workflow runs, Run success rate, Avg run time).
- Workflows stat strip (Runs 30d, Succeeded 30d, Median run time) and the per-row Last run and Success %.
- AutomationDetail stat row (Executions 30d, Success, Avg duration).
- WorkflowDetail rail (Succeeded, Median run).

**Exists today.**
- `GET /workflow-runs` with no filter returns **every** run (`workflowRuns.ts:49`, `getAll`).
- `GET /automations/:id/executions` returns every execution (`automations.ts:454`).
- `/health` has only live counts.

**Needed.** `GET /stats/summary?from=&to=&projectId=&definitionId=&automationId=&groupBy=definition` → `{ range, chats: { created, turns }, runs: { total, succeeded, failed, cancelled, successRate, avgDurationMs, medianDurationMs }, automations?: { executions, succeeded, avgDurationMs }, byDefinition?: Array<{ definitionId, lastRun?: { id, status, startedAt }, successRate }> }`.
- SQL aggregates in the chat, workflow-run and automation-execution repositories.
- The client computes `from` and `to` in its local time zone (the week starts per locale). There is no SSE: invalidate on G-01 `attention.remove` and on lifecycle events.
- Policy prefix `/stats` (`read:activity`).

**Owner / phase / effort.** P2 · P5 (PW consumes it later) · **M**. Coordinate with PW P01: migration v55 drops run history and pins runs to versions, so land this after P01 or write it against the pinned-version model.

**As built.**
- **Wire types** `StatsSummary`/`StatsSummaryQuery`/`StatsChatsSummary`/`StatsRunsSummary`/`StatsAutomationsSummary`/`StatsByDefinitionRow` (`packages/shared/src/types/StatsSummary.ts`). Deviated from the shape's `chats.turns`: **left out entirely**, not invented as `0` — there is no per-chat cumulative turn counter anywhere in the schema, only the most recent turn (`ChatListActivity.lastTurn`, G-02). Adding one would mean a new column/migration on `chats` (workflow/run-history-adjacent but actually chat-owned, so technically editable) which is out of scope for an **S–M** gap; revisit if a future gap needs it.
- **Route** `GET /stats/summary` (`apps/server/src/routes/stats.ts`, new `/stats` prefix, `read:activity` — same bar as `/attention`). Deviated from "SQL aggregates in the repositories": `workflowRunRepo` / `workflowDefinitionService` / `automationService` are Workflow-Overhaul-owned engine code (07-phases.md §"Running in parallel") — no aggregate SQL was added to them. Instead the route joins through their existing read methods (`listDefinitions(projectId)` → `getByDefinitionId(id)` per definition; `listAutomations(projectId)` → `getExecutionsByAutomation(id)` per automation) and aggregates in memory. `chatEntityRepo.getAll()`/`getByProjectId()` likewise (chats are redesign-owned, but no new repo method was needed either).
- `runs.successRate` is `succeeded / (succeeded + failed + cancelled)` — over **terminal** runs, never over `total` (which includes still-running/paused runs in range) — and is absent when that denominator is `0`. `avgDurationMs`/`medianDurationMs` are computed only over runs with both `startedAt` and `completedAt`, absent otherwise. Same "absent, not 0" rule for `automations.avgDurationMs` and every `byDefinition[].successRate`. Tolerates zero definitions / zero automations cleanly (`runs: { total: 0, ... }`, `automations` and `byDefinition` simply absent or empty).
- `byDefinition[].lastRun` is the definition's absolute most recent run (any status, any time) — not range-scoped, matching the Workflows list's "Last run" column; `successRate` per row IS range-scoped, matching "Success %" next to it.
- **Client:** `HttpPlatformClient.getStatsSummary(query)`, client-core's `api.stats.summary(query)`; not added to `IPlatformClient` (G-12 precedent). Web hook `useStatsSummary(query)` in `hooks/statsQueries.ts` — disabled until a range is supplied (no default-range guessing, matching "the client computes from/to").
- OpenAPI documents `/api/stats/summary`. New `routePolicy.ts` entry for `/stats` (`read:activity` / `write: admin:settings`, no write route exists yet).
- **Tests:** `apps/server/src/__tests__/statsRoute.test.ts` (range filtering, terminal-only success rate, duration stats, byDefinition grouping, empty run history), `wireContract.test.ts`, `apps/web/src/__tests__/hooks/statsQueries.test.tsx`.

### G-11 — Recently finished activity

**Status: built in P2-05**, minus the pull-request/commit sources (see "As built").

**Elements & boards.** Home "Recently finished": `+212 −48 · PR #1176 opened`, `4 of 4 stages · 3 review comments`, `Failed · pnpm typecheck exited 2` with Retry, and "All activity".

**Exists today.** No cross-entity source. PRs are per workspace (`GET /workspaces/:id/pull-requests`, `workspaces.ts:1341`). `useLiveOperations` guesses "today" from the full lists.

**Needed.** `GET /activity/recent?since=&limit=20&projectId=` → `{ items: Array<{ key, entity, entityId, title, href, project?, endedAt, outcome: 'succeeded' | 'failed' | 'cancelled', summary, changes?: { files, additions, deletions }, pullRequest?: { number, url }, commit?: { branch }, retry?: 'chat_prompt' | 'run_retry' }> }`.
- Sources: the G-02 chat columns, run `completedAt` and status, automation executions, workspace PR records.
- Retry uses the existing endpoints: resend the last prompt through `POST /chats/:id/prompt`, or `POST /workflow-runs/:id/retry` (`workflowRuns.ts:174`).
- Policy prefix `/activity`. "All activity" is a later list page and is not designed. The link is hidden until then.

**Owner / phase / effort.** P2 · P5 · **M** (after G-02).

**As built — one source deliberately deferred.** Chats' finished turns, terminal workflow runs and terminal automation executions are merged, sorted newest-first and paged exactly as specified: `RecentActivityItem`/`RecentActivityPage` (`packages/shared/src/types/RecentActivity.ts`), `GET /activity/recent` (`apps/server/src/routes/activity.ts`, new `/activity` prefix, `read:activity`). Every source is an existing read-only call (`chatEntityRepo.listPage` for G-02's `lastTurn`; `workflowDefinitionService.listDefinitions` + `workflowRunRepo.getByDefinitionId`; `automationService.listAutomations` + `getExecutionsByAutomation` — the latter two Workflow-Overhaul-owned, called read-only, nothing added to them).
- **Deferred: workspace PR records.** The only existing PR source (`sourceControlService.listPullRequests`, behind `GET /projects/:id/pull-requests`) makes a **live git-host call per codebase** — fanning that out across every codebase on every Home load would be slow and flaky (rate limits, expired tokens) for a feed that reloads often, and building a cached/batched version responsibly is its own gap, not a sub-task of an **M**-effort one. `pullRequest` is therefore always absent in this pass — never faked — and every consumer must treat the field as "not built yet," not "no PR." Revisit alongside G-16 (which already needs codebase-scoped async status).
- **`commit.branch`** IS populated, cheaply: for workflow-run items only, resolved from an existing tracked worktree (`worktreeService.listWorktrees(undefined, runId)`) — no live git call, and only for the final page's items (bounded extra reads), never for chats (no `chatId` on `WorktreeInfo`).
- **`chats.turns`-style copy fields** (`summary`, retry): a chat's `summary` is its last turn's error or a short status line; `retry: 'chat_prompt'` only on a failed chat, `retry: 'run_retry'` only on a failed run — never on an automation execution (no such endpoint exists). `outcome` for an automation's `partial` status reads as `failed` (it never fully succeeded).
- **Project name** is resolved per item (`projectService.getProject`), again only for the final page, with a per-request cache so a busy feed with one dominant project makes one lookup, not N.
- **Client:** `HttpPlatformClient.getRecentActivity(query)`, client-core's `api.activity.recent(query)`; not added to `IPlatformClient` (G-12 precedent). Web hook `useRecentActivity(query)` in `hooks/activityQueries.ts`.
- OpenAPI documents `/api/activity/recent`. New `routePolicy.ts` entry for `/activity` (`read:activity`).
- **Tests:** `apps/server/src/__tests__/activityRoute.test.ts` (merge + sort, `since`/`limit`, outcome mapping incl. `partial`→`failed`, retry attribution, project/commit enrichment scoped to the final page only, never-invented `pullRequest`, empty run history), `wireContract.test.ts`, `apps/web/src/__tests__/hooks/activityQueries.test.tsx`.

### G-12 — System info

**Status: built in P2-05.**

**Elements & boards.** Home System card: Server, Agents "3 running · max 8", Database "SQLite 212 MB", Disk "38% used · 182 / 476 GB", Uptime, Version. Also Settings › Diagnostics.

**Exists today.**
- `GET /health` (`health.ts:17`): status, uptime, db ok, `harness.runtime`, `runningChatIds`, memory, platform.
- `GET /health/config` (`health.ts:132`): `maxConcurrentSessions`.
- No server version, no database size, no disk usage.

**Needed.** `GET /system/info` → `{ serverName, serverVersion, platform, uptimeSec, agents: { running, max }, database: { kind: 'sqlite', sizeBytes }, disk: { usedBytes, totalBytes } }`.
- Disk comes from `fs.promises.statfs(dataDir)`, the same call on Windows, macOS and Linux.
- Database size is the database file plus its `-wal` and `-shm` files.
- Same read scope as `/health/config`.

**Owner / phase / effort.** P2 · P5 · **S**.

**As built.**
- **Wire type** `SystemInfo` (`packages/shared/src/types/SystemInfo.ts`). `database.sizeBytes` and `disk` are absent (not `0`, D-36) when the file/`statfs` call fails.
- **Route** `GET /system/info` (`apps/server/src/routes/system.ts`) under the existing `/system` prefix (`read:status`, no policy change needed); `serverDisplayName()` is exported from `auth.ts` (was module-private) so the name matches `/auth/server-info` exactly. `agents.running` reads `chatManagementService.getStreamingChatIds().length` — the same live count `/health` uses, not a run-history query, so it stays correct once the Workflow Overhaul drops run history. Database size = main file + `-wal` + `-shm` (0 when a companion is absent, `undefined` when the main file itself can't be `stat`ed). Disk usage via `fs.promises.statfs(dataDir)` (`bavail`, not `bfree`) — same call on Windows/macOS/Linux.
- **Client:** `HttpPlatformClient.getSystemInfo()` and `client-core`'s `api.system.info()` (`GET /api/system/info`) — deliberately **not** added to `IPlatformClient` (same precedent as `listProjects` / `listSystemArtifacts`: those methods are used only by the web's concrete `HttpPlatformClient` and by client-core's own HTTP surface for CLI/mobile, not by the CLI's in-process `IPlatformClient` calls). Web hook `useSystemInfo()` in `hooks/systemQueries.ts` (30s poll).
- **Tests:** `apps/server/src/__tests__/systemInfoRoute.test.ts` (real temp SQLite file, real `statfs`; asserts `sizeBytes` is real bytes on disk and is absent — never `0` — when the db file is missing), `packages/client-core/src/api/__tests__/wireContract.test.ts`, `apps/web/src/__tests__/hooks/systemQueries.test.tsx`.

### G-13 — Project summaries

**Status: built in P2-05.**

**Elements & boards.** Projects columns: Codebases, Active chats ("3 · 1 needs you"), Last run (status + name + #), Worktrees. ProjectDetail tab counts (Codebases 2, Chats 6, Runs 14). Palette project results.

**Exists today.** `GET /projects?status` (`projects.ts:70`) returns `Project` with no counts. Counts would take N calls: codebases (`:161`), worktrees (`:567`), chats `?projectId`.

**Needed.** `GET /projects?status=&include=summary` → each project plus `summary: { codebases, activeChats, needsYou, running, worktrees: { active, orphaned }, runs, lastRun?: { runId, definitionId, name, status, at } }`. Build it with grouped SQL plus G-01 counts by project. `GET /projects/:id?include=summary` takes the same parameter.

**Owner / phase / effort.** P2 · P5 · **S–M**.

**As built.**
- **Wire type** `ProjectSummary` added to `Project` (`packages/shared/src/types/Project.ts`) as an optional `summary` field — present only when the caller asked for it, matching the gap's shape exactly (`codebases`, `activeChats`, `needsYou?`, `running?`, `worktrees: { active, orphaned }`, `runs`, `lastRun?`).
- **Route** (`apps/server/src/routes/projects.ts`): `?include=summary` on the existing `GET /projects` and `GET /projects/:id` — no new endpoint, so no new OpenAPI/routePolicy entry (the base routes were never documented in `openapi.ts` either). Deviated from "grouped SQL" — every source is an **existing read-only repository/service call already exposed on `Container`** (`codebaseService.getByProjectId`, `chatEntityRepo.getByProjectId`, `worktreeService.listWorktrees`, `workflowDefinitionService.listDefinitions`, `workflowRunRepo.getByDefinitionId`, `attentionService.getSnapshot({ projectId })`), joined and aggregated in the route handler. This is deliberate, not a shortcut: `workflowRunRepo`/`workflowDefinitionService` are Workflow-Overhaul-owned engine code (07-phases.md §"Running in parallel"), off-limits for new methods or SQL — only their existing read methods may be called. `needsYou`/`running` are omitted (not `0`) while `attentionService.isAvailable()` is false. Tolerates zero definitions / zero runs cleanly (`runs: 0`, no `lastRun`) for the Workflow Overhaul's run-history migration.
- **Client:** `HttpPlatformClient.listProjects({ includeSummary })` / `getProject(id, { includeSummary })`; client-core's `projects.list/get({ includeSummary })` (its own, narrower `ProjectSummary` interface — a mobile picker row — gained an optional `summary?: ProjectSummaryDetail` field aliasing the shared type to avoid the name clash). Not added to `IPlatformClient` (same precedent as G-12).
- **Web hook:** `useProjects({ includeSummary })` / `useProject(id, { includeSummary })` in `hooks/projectQueries.ts`, cached under a separate `'summary'` key segment so plain picker queries and the Projects-page summary query don't collide.
- **Tests:** `apps/server/src/__tests__/projectSummaryRoute.test.ts` (aggregation math, bucket counts, latest-run selection, omitted-attention path, empty-run-history path), `wireContract.test.ts`, `apps/web/src/__tests__/hooks/projectQueries.test.tsx`.

### G-14 — ProjectDetail Chats tab

**Exists today.** The server already filters with `GET /chats?projectId` (`chats.ts:330`). The client drops the parameter (`HttpPlatformClient.ts:720`, `queries.ts:394`).

**Needed.** Delivered by G-02's list signature: `useChats({ projectId })`.

**Status: built in P2-02** with G-02: `GET /chats?projectId=` (repeatable) combines with every other filter and the counts follow it; `useChats({ projectId })` / `useChatPages({ projectId })` on the web, `api.chats.list({ projectId })` in client-core.

**Owner / phase / effort.** P2 · P5 · **S**.

### G-15 — ProjectDetail Runs tab

**Status: built in P2-05.**

**Exists today.** `GET /workflow-runs?status|definitionId` (`workflowRuns.ts:49`). `WorkflowRun` has no `projectId` (`packages/shared/src/types/WorkflowRun.ts:84`): the project belongs to the definition (`GET /workflow-definitions?projectId`, `workflowDefinitions.ts:51`).

**Needed.** `GET /workflow-runs?projectId=&status=&cursor=&limit=`, joined through the definition, returning `{ items, nextCursor, total }` (the same shape as G-02). The platform client's `listRuns` gains the filter.

**Owner / phase / effort.** P2 · P5 · **S**. Coordinate with PW P01 as for G-10.

**As built — deviated from the exact path.** `apps/server/src/routes/workflowRuns.ts` (which mounts `GET /workflow-runs`) is Workflow-Overhaul-owned engine code (07-phases.md §"Running in parallel", `wip/P2-05` HANDOFF note); it is never edited by this track, even to add a query parameter. Served instead as **`GET /projects/:id/runs?status=&cursor=&limit=`** on the redesign-owned `apps/server/src/routes/projects.ts`, joined through `workflowDefinitionService.listDefinitions(projectId)` + `workflowRunRepo.getByDefinitionId(id)` (both existing read-only calls; nothing added to either) and paged/sorted (newest by `startedAt ?? createdAt`) in the route handler. Same response shape as planned: `{ items, nextCursor, total }`, `items` = `WorkflowRun & { definitionName }` (`ProjectRunListItem`/`ProjectRunListPage` in `packages/shared/src/types/ProjectRuns.ts`). Cursor is a run id; an unknown cursor is `400`, an invalid status value is `400`. Tolerates a project with zero definitions / zero runs (`items: []`, `total: 0`) for the Workflow Overhaul's run-history migration. Client: `HttpPlatformClient.listProjectRuns(projectId, filter)`, client-core's `projects.runs(id, filter)`, web hook `useProjectRuns(projectId, query)`. OpenAPI documents `/api/projects/{id}/runs` (a genuinely new path, unlike G-13's additive query param). Tests: `apps/server/src/__tests__/projectRunsRoute.test.ts` (paging, status filter, invalid status/cursor, empty run history), `wireContract.test.ts`, `apps/web/src/__tests__/hooks/projectQueries.test.tsx`.

### G-16 — Codebase fetch/clone logs and live status

**Status: built in P2-06.**

**Elements & boards.**
- ProjectDetail: status "Ready / Fetching", "Last fetched 4m ago", Fetch, **Logs**, "Cloning runs in the background; progress shows in Logs".
- CodebaseDetail: the Logs button and Last fetched.

**Exists today.**
- `POST /projects/:id/codebases/:cid/fetch` is synchronous and returns only a status (`projects.ts:239`).
- `GET …/status` (`:273`).
- `CodebaseStatus` is `pending | cloning | ready | error | stale`, and `lastFetchedAt` is on `ProjectCodebase`.
- No log capture and no events.

**Needed.**
- Fetch and clone become jobs: `POST …/fetch` → `202 { jobId }`.
- `GET /projects/:id/codebases/:cid/logs?limit=200` → `{ lines: Array<{ ts, stream: 'stdout' | 'stderr', text }>, job?: { id, kind: 'clone' | 'fetch', status, startedAt, endedAt?, error? } }`, served from a per-codebase ring buffer of the last 500 lines. The last error is also persisted.
- `codebase.status_changed` (`{ projectId, codebaseId, status, lastFetchedAt, error? }`) goes in the lifecycle kinds. The web polls the logs only while the status is cloning or fetching.

**Owner / phase / effort.** P2 · P5 · **M**.

**As built.**
- `POST /projects/:id/codebases/:cid/fetch` → `202 { jobId }` exactly as specified; `GET /projects/:id/codebases/:cid/logs?limit=` → `{ lines, job? }` from a new `CodebaseLogService` (in-memory ring buffer, 500 lines, process lifetime — a restart has no in-flight job to resume either, so nothing is persisted beyond the codebase row's existing `lastError`). `packages/git`'s `GitClient.bareClone`/`fetchAll` take an optional `{ streamTo }` (threaded through the existing `IGitProcessRunner` `streamTo` already used elsewhere) and now pass `--progress`, so a local/loopback fetch actually writes something to tail.
- **Deviation — no new `CodebaseStatus` value.** The in-flight fetch reuses `'cloning'` rather than adding `'fetching'`: every existing legacy-page consumer (`ProjectDetailPage`/`CodebaseDetailPage`'s `status === 'cloning' || 'pending'` polling and copy) already treats `'cloning'` as "an async git operation is in progress" and keeps working unchanged; `job.kind === 'fetch'` (from `GET .../logs`) is what a future UI reads to say "Fetching" instead of "Cloning" for the same status value.
- `CodebaseService.setStatus` centralises every status write and emits `codebase.status_changed` on the `global` scope when an event bus is wired (optional constructor param, so every existing unit test that built the service directly keeps compiling). `codebase.status_changed` was added as a proper `AgentEvent` union member (classified `'item'` in `EVENT_CLASS`) — both exhaustive maps, so it is checked, not just fanned out.
- **Client:** `HttpPlatformClient.fetchCodebase` now returns `{ jobId }` (was `void`); `useFetchCodebase` already ignored the resolved value, so the legacy page is unaffected. New `getCodebaseLogs` / client-core `projects.codebaseLogs` / web `useCodebaseLogs`.
- **Tests:** `CodebaseLogService` (pure), a REAL-git `CodebaseService` test against `scripts/redesign/make-dummy-repo.mjs` (tails actual git stdout/stderr, verifies the `ready`/`stale` transitions and the emitted event, never this checkout), server route contract test, client-core wire-contract cases, web hook test.

### G-17 — Worktree enrichment

**Status: built in P2-06.**

**Elements & boards.** CodebaseDetail: Size column, "1.27 GB on disk · frees 385 MB", "Linked to" (chat or run title with status), "removes in 26h".

**Exists today.** `WorktreeInfo { id, runId?, runType?, worktreePath, branchName, status, createdAt, cleanedUpAt }` (`packages/shared/src/types/Project.ts:134`). Lists at `projects.ts:497,567`; cleanup at `:517`.

**Needed.** `GET …/worktrees?include=usage,link` adds `sizeBytes`, `link: { entity, id, title, status }` and `expiresAt` (from the project retention policy), plus a list summary `{ totalBytes, reclaimableBytes }`.
- Sizes come from an async, cached directory walk with the Node `fs` APIs (no `du`), refreshed at most every 10 minutes.

**Owner / phase / effort.** P2 · P5 · **M**.

**As built.**
- `?include=usage,link` on the existing `GET /projects/:id/codebases/:cid/worktrees` — bare (no `include`) is byte-for-byte unchanged, so the legacy `CodebaseDetailPage` keeps calling it exactly as before (same precedent as G-13's additive query param; no OpenAPI entry either, since the base route was never documented there).
- New `packages/core` `WorktreeSizeService`: async, cached (10-minute TTL default), bounded concurrency (default 2 in-flight walks; a request beyond the limit is simply skipped this round rather than queued — the next list poll retries it), recursive size via plain `fs.promises` (never `du` — cross-platform on Windows/macOS/Linux), never follows symlinks. `getCachedSizeBytes` never blocks and returns `undefined` (never a fake `0`) until a measurement has actually completed.
- `link` resolution: `runType: 'manual'` → `runId` is a chatId (`chatEntityRepo.getById`); otherwise `runId` is a `WorkflowRun` id (`workflowRunRepo.getById`, covers automation-triggered runs too), title preferring the definition's CURRENT name over the run's frozen one (same "live name wins" rule as G-13's `lastRun`). An owner that no longer exists omits `link` entirely — never invented.
- `expiresAt`: `WorktreeCleanupService.expiresAt(wt, retention)` is now a public static export, reusing the EXACT retention math (`RETENTION_MS`, "since `cleanedUpAt` else `createdAt`") the background sweep uses to decide when to actually delete — the list and the sweep can never disagree about "when does this expire". Omitted under `manual` retention.
- `reclaimableBytes` sums `sizeBytes` for non-`active` items only; `totalBytes`/`reclaimableBytes` are both omitted entirely (not `0`) while nothing in the response has been measured yet.
- **Client:** `HttpPlatformClient.listCodebaseWorktrees` gains a TS overload for `{ include }` (bare call's return type is unchanged); client-core `projects.codebaseWorktrees`, web `useCodebaseWorktreesUsage` (additive alongside the existing `useCodebaseWorktrees`).
- **Tests:** `WorktreeSizeService` against real temp directories (real byte counts, symlink-skip, TTL expiry, bounded-concurrency skip, missing directory), server route test (link resolution for both entity kinds, expiresAt math, omission rules, usage+link combined), client-core wire-contract cases, web hook tests.

### G-18 — Palette entity search

**Status: built in P2-06.**

**Elements & boards.** CommandPalette: typing "run nig" yields a Workflows group with an inline "Run '…'" action and "Automations › Nightly audit" under Go to, plus Recent chats with status.

**Exists today.** No search route (no `search` handler in `apps/server/src/routes`). The chats list is capped at 500.

**Needed.** `GET /search?q=&types=chat,project,agent,workflow,automation,script&limit=20` → `{ results: Array<{ type, id, title, subtitle?, href, status?: VisualState, actions?: Array<'open' | 'run' | 'new_chat'> }> }`.
- SQL `LIKE` over names, descriptions and tags, scored by prefix match and recency.
- The results respect each type's read scope.
- Settings entries and navigation targets are matched client-side.
- Recents: `GET /chats?sort=activity&limit=5` (G-02) plus G-01 state.
- `useSearch(q)` is debounced by 120 ms.

**Owner / phase / effort.** P2 · P5 · **M**.

**As built.**
- `apps/server/src/routes/search.ts`, new `/search` route + `routePolicy.ts` entry (`read:activity`, same bar as `/attention`/`/stats`/`/activity`). Every source is an EXISTING read-only call already on `Container`: chats via `chatEntityRepo.listPage({ filter: { q } })` (real SQL `q=` match, G-02's substring-over-name/description/tag); projects via `projectService.listProjects()` filtered/ranked in memory (the project repo has no query support, and project counts are always small — adding one purely for this **M**-effort gap was out of scope); agents via `agentRepo.list({ query })` (its own case-insensitive SQL match, no new method needed). `workflowDefinitionService`/`automationService`/`workflowScriptLoader` are Workflow-Overhaul-owned engine code: only their existing `listDefinitions()`/`listAutomations()`/`getAllMetadata()` are called, read-only; matching and ranking happen here, in memory (same pattern G-10/G-11/G-13/G-15 used for engine-owned data).
- **Scoring:** title-prefix/exact match beats title-substring beats description/tag-only match; a small recency bonus (linear decay over 30 days) breaks ties. Per-type candidates are capped at 25 before the final global rank + `limit` trim.
- **Scope filtering (deviation from "SQL LIKE... respect each type's read scope" as a single mechanism):** `types` is filtered down to what the calling principal can actually read BEFORE any query runs — `chat`→`read:chats`, `project`→`read:projects`, `agent`/`workflow`/`automation`/`script`→`read:workflows` — using the same `req.principal.scopes` / `null`-means-unauthenticated-loopback-dev-mode convention `attention.ts` already uses. A type the caller can't read is simply absent from the results, never a 403.
- Scripts disabled (`scripts.workflowScriptsEnabled: false`, `ScriptSecurityError`) reads as "no scripts to search" rather than failing the whole request.
- A live chat's `needs_you`/`running` state (G-01's `attentionService`, when available) overrides its finished-turn status mapping in the results.
- **Client:** `HttpPlatformClient.search`, client-core's `search(query)` (top-level, alongside `stats`/`activity`), web `useSearch(q, opts)` in `hooks/searchQueries.ts` — `q` is debounced 120ms via a small local `useDebouncedValue` before it reaches the platform client; `enabled: false` and an empty/whitespace-only `q` both hold off the request.
- OpenAPI documents `/api/search`.
- **Tests:** `apps/server/src/__tests__/searchRoute.test.ts` (per-type matching incl. scripts-disabled fallback, title-prefix vs substring ranking, `types=` filtering, `limit` default/clamp, scope filtering incl. the null/unauthenticated-loopback case), client-core wire-contract cases, web hook test (debounce, burst coalescing to one request, `enabled: false`).

### G-19 — Per-project customization enablement on the server

**Status: built in P2-06.**

**Elements & boards.** ProjectCustomization: per-item enable switches and "5 of 8 enabled".

**Exists today.**
- Per-project on/off is a device-local zustand store (`stores/projectCatalogPrefsStore.ts`). The global one is `catalogPrefsStore.ts`.
- Only system MCP preferences are stored on the server (`PUT /system/mcp-servers/system/:id`, `system.ts:164`).
- The choice does not follow the user to other devices, and mobile cannot see it.

**Needed.**
- `GET` and `PUT /projects/:id/artifact-prefs` → `{ disabled: Array<{ type: 'skill' | 'prompt' | 'agent' | 'mcp'; id }> }`.
- The artifact catalog applies it when resolving chats and stages in that project.
- Delete `projectCatalogPrefsStore.ts`.

**Owner / phase / effort.** P2 · P5 · **M**. Until it lands, the switches keep working device-locally with a "This device" note.

**As built — one deletion deliberately deferred.**
- `GET`/`PUT /projects/:id/artifact-prefs` exactly as specified, stored inline on the project's existing JSON `settings` column (`disabledArtifacts`) — no migration, same precedent as G-13. `PUT` replaces the whole set (not a merge); body validation 400s on an unknown `type` or a missing/empty `id`.
- **Enforcement at the source, one choke point:** `ArtifactCatalog.listSkills`/`listMcpServers` take an optional `getDisabledArtifactIds(projectId, type)` callback and filter the merged (system + project) list by it. This is the SAME catalog `AgentResolver` calls to resolve a chat/stage's actual skills and MCP servers, so a project-disabled entry becomes simply absent from both live resolution AND `AgentService`'s save-time validation of an agent's declared skills/MCP ids — not a second, independently-maintained enforcement path. `GET /projects/:id/available-artifacts` (agent/prompt/skill pickers) filters by the same disabled set independently, since it doesn't route through `ArtifactCatalog`.
- **Deferred: deleting `projectCatalogPrefsStore.ts`.** This gap's task explicitly built data/API + client-core read models + web hooks only, no UI (P5 builds the pages). `ProjectDetailPage`'s Customization tab still reads/writes the device-local store; deleting it now with no replacement wired up would break that currently-working legacy page (D-01, "old pages must keep working"). Left in place until P5 rebuilds that tab against `useProjectArtifactPrefs`/`useUpdateProjectArtifactPrefs`.
- **Client:** `HttpPlatformClient.getProjectArtifactPrefs`/`updateProjectArtifactPrefs`, client-core's `projects.artifactPrefs.get`/`update`, web's `useProjectArtifactPrefs`/`useUpdateProjectArtifactPrefs`.
- OpenAPI documents `/api/projects/{id}/artifact-prefs` (a genuinely new path).
- **Tests:** `ArtifactCatalog` filtering (skills/MCP, cross-project isolation, no-callback-wired backward compatibility), server route tests (GET/PUT round-trip, replace-not-merge, validation, available-artifacts filtering), client-core wire-contract cases, web hook tests.

### G-20 — Background-task cancel attribution

**Elements & boards.** DockTasks "Cancelled · by you at 14:09".

**Exists today.** `BackgroundTaskStatus` includes `cancelled` (`packages/shared/src/types/Chat.ts:31`). The cancel route is `chats.ts:888`. Neither the actor nor the time is stored.

**Needed.** `cancelledBy: 'user' | 'orchestrator'` and `cancelledAt` on `BackgroundTaskMeta`, set by the cancel route or the orchestrator.

**Owner / phase / effort.** P2 · P4 (optional) · **S**.

**As built (P2-04).**
- **Types** (`packages/shared/src/types/Chat.ts`): `BACKGROUND_TASK_CANCELLERS = user | orchestrator`, `BackgroundTaskMeta.cancelledBy?` / `cancelledAt?` (epoch ms, present only while `status === 'cancelled'`), `BackgroundTaskCancellation`, `BackgroundTaskListItem` (the `GET /chats/:id/background-tasks` row, replaces client-core's `BackgroundTaskSummary`), `BackgroundTaskCancelResult`. `chat.background_task.status` / `.completed` carry `cancelledBy` / `cancelledAt` when cancelled.
- **Who:** the Tasks panel's cancel route → `user`; `cancelWorkersForParent` (orchestrator stopped, rewound, archived, deleted) → `orchestrator`; Stop inside the worker chat (a `harness.cancelled` nothing attributed first) → `user`. The first attribution of an activation wins; a follow-up turn (`sendToBackgroundAgent`) clears it (and its stale `lastError`, which used to make the follow-up settle as `cancelled` again).
- **Storage:** migration **v57** `background_task_cancel_attribution` (`chats.background_task_cancelled_by`, `…_cancelled_at`; no backfill). `IChatRepository.updateBackgroundTaskStatus(id, status, cancellation?)` stores it with `cancelled` and clears it with any other status.
- **Route:** `POST /chats/:id/background-tasks/:taskId/cancel` → 202 `{ ok, taskId, cancelledBy, cancelledAt }`, 404 for an unknown task (was an unconditional 202). The service now also emits `chat.background_task.status { status: 'cancelled', cancelledBy, cancelledAt }` on the orchestrator's chat scope when a cancel changes the state (cancelling an idle `needs_review` worker used to emit nothing). OpenAPI documents the list and the cancel.
- **Client:** client-core `BackgroundTaskBlock.cancelledBy` / `cancelledAt` (router + reducer; dropped when the worker runs again), `createApiClient().chats.cancelBackgroundTask(id, taskId)`; `HttpPlatformClient.cancelBackgroundTask` returns the attribution; web `useCancelBackgroundTask(chatId)` writes it into the cached list (legacy `BackgroundTasksPanel` uses it; no new UI).

---

## 3. Checked: no backend gap (do not rebuild)

These were listed as gaps in earlier research (D-36, `research/plan-audit.md` C1), but the API already exists. Build them as UI work on the existing calls.

| Element & boards | What already exists |
|---|---|
| Plan revisions v1/v2/v3 + inline step comments (ChatPlan) | `GET /chats/:id/plans`, `…/:planId` (`chats.ts:907,918`); `GET …/content?revision=n` (`:942`); `PUT …/content` creates a new revision (`:977`); `POST …/comments` with `anchor { startLine, endLine, quotedText, contentHash }` (`:1022`); `POST …/decision` (`:1058`); `POST …/save-to-workspace` (`:1112`). Types are in `packages/shared/src/types/AgentMode.ts:188–260`. `PlanDocumentPanel.tsx` already has a revision switcher. A step comment is an anchor over that step's line range |
| Computer replay and grants (ChatComputer) | See G-07 "Exists today". Only the plan, scope and take-over parts are gaps |
| Model-picker details and signed-out providers | See G-09. Only client methods are missing |
| Agent export `.agent.md` (Agents, AgentEditor) | `POST /agents/:id/export` → `{ markdown }` (`agents.ts:127`); `POST /agents/import` (`:137`); `HttpPlatformClient.exportAgent/importAgent`; `useExportAgent/useImportAgent`; `Agent.version` for "v4"; `GET /agents/:id/usage` (`:116`) for "Used by" |
| Changes compare scopes (DockChanges) | `GET /workspaces/:id/changes?base=&head=&alias=` (`workspaces.ts:620`), selectors `baseline \| working \| checkpoint:<id> \| turn:<turnId> \| ref:<rev>` (`parseRevision`, `workspaces.ts:179`). This turn = `base=turn:<latest turnId>`. This chat = `baseline`. Branch vs main = `ref:<mount.git.baseCommit>` (today's "Branch base" option, `ChangesSurface.tsx:370`). "+2 workspace files" = the `.` alias |
| Checkpoint scrubber (DockChanges) | `GET /workspaces/:id/checkpoints` (`:1043`) with `turnId`, `phase`, `promptExcerpt`, `fileCount/additions/deletions`, `createdAt`; restore at `:1082`; chat rewind with scopes at `chats.ts:816` |
| Keep / Keep all / Undo all (D-28) | `POST /workspaces/:id/changes/review` (`:774`) and `/changes/discard` (`:884`) |
| Automations "Next run" | `Automation.nextRunAt` (`packages/shared/src/types/Automation.ts:298`), formatted by `lib/nextRun.ts` |
| Background tasks: review, rounds, digest, worker limit (DockTasks) | `GET /chats/:id/background-tasks[/:taskId]` (`chats.ts:866,877`); `needs_review` status; `Agent.maxWorkers`, `teamAgentRefs` |
| Home and sidebar quick actions | Listed in G-01 "Quick actions" |
| ChatCreate fields (browser visibility/eval, tags, orchestrate, overrides, sources, branches) | `POST /chats` (`chats.ts:274`, `CreateChatSchema`); branches `GET /projects/:id/codebases/:cid/branches` (`projects.ts:263`); `POST /agents/resolve-preview` (`agents.ts:153`) for the Summary and effective capabilities |
| Settings › Security board | Network access `GET/POST /security/network-access` (`security.ts:85,122`); scope requests (`scopeRequests.ts:164,185,215`); devices (`auth.ts:463–561`); pairing (`auth.ts:321`); desktop `restartServer` bridge (`preload/index.ts:38`) |
| Codebase default-branch change | `PUT /projects/:id/codebases/:cid` (`projects.ts:171`) |

---

## 4. Workflow Overhaul Plan gaps (PW-owned; the redesign only tracks them)

The redesign builds none of these. Their UI is built by PW on the kit (D-35). The IDs are here so the screen map (04 §2.6) can cite them.

| ID | Element & boards | Exists today | PW phase / WP |
|---|---|---|---|
| G-21 | Versions, draft/publish, pinned runs, version history and diff, Draft/Published status (Workflows, WorkflowDetail, Builder, WorkflowNew, AgentDraft) | `workflow_definitions.version`, an integer bumped on PATCH (`workflowDefinitions.ts:73`); no versions table | P01 WP-1.6/1.7; diff/restore UI P07 WP-7.6 |
| G-22 | Invocation: RunDialog plan preview, per-run overrides, Test run, Setup/Finalize lifecycle, Trigger and Ver columns | `POST /workflow-runs` (`workflowRuns.ts:36`), `POST /orchestrator/runs` (`orchestrator.ts:158`), `VariableInputModal` | P04 WP-4.4 |
| G-23 | Engine v2 and SessionSpec: Waiting / Finalizing / Paused(reason), attempts resume/restart, commands API, budget meter, per-run permission, stage composer, session reuse/group | Run and stage pause/resume/retry/cancel/wake routes (`workflowRuns.ts:144–358`); `permission-mode` (`:384,395`) | P02 WP-2.11, P03, P03b WP-3b.2 |
| G-24 | Control-flow stages: loop, map, wait, check, sub-workflow; loop run UI and decision card; 18 templates; Judge rule | `iterationConfig` stored but never executed | P05 (WP-5A.5, WP-5A.6) |
| G-25 | Workflow tools in chat: run/approval/draft cards, Tasks sections, composer Workflows toggle, agent-draft banner | MCP `generatorai_run_workflow` only | P06 WP-6.1/6.2/6.5 (the redesign P4 provides the extension points) |
| G-26 | Automations: dataset rows + schema, required permission, "Next 3 runs" preview (`POST /automations/schedule-preview { cron, timezone, count }` via `node-cron` in core), Trigger chip | Input modes; `nextRunAt`; test-data-source (`automations.ts:199`) | P01 WP-1.6 (PD-8), P02 (PD-18) |
| G-27 | Scripts compiled to a graph with keys and a loop; materialize as draft; `write:workflows` gate | `POST /workflow-scripts/:id/materialize` and `/run` (`workflowScripts.ts:100,194`) | P01, P05 |
| G-28 | Validation problems with codes and quick fixes | `POST /workflow-definitions/:id/validate` (`workflowDefinitions.ts:207`) | P01 |
| G-29 | Cost display with a tokens-only fallback; budget in $ | — | P07 |

If the D-35 fallback triggers (the redesign ports Workflows list, WorkflowDetail, Automations and AutomationDetail as-is at the end of P6), those ports render only today's data. G-10 is the one P2 gap they may use.

---

## 5. Grouped by the phase that needs them, and the P2 order

| Needed by | Gaps |
|---|---|
| P3 (Slice A: shell + ChatsList) | G-01, G-02, G-03, G-04, G-05 |
| P4 (Slice B: chat workspace) | G-06 (UI), G-07, G-08, G-09, G-20 |
| P5 (fan-out) | G-10, G-11, G-12, G-13, G-14, G-15, G-16, G-17, G-18, G-19 |
| P6 (settings) | none new (uses G-03, G-09, G-12) |
| PW | G-21 … G-29 |

**Recommended order for the P2 backend track.** Each item is one PR with its tests, the OpenAPI entry and the client-core read model.

1. **G-01 attention feed.** This blocks the P3 sidebar. Start it in P1, in parallel with the token work. It depends on the `packages/shared` status map (D-18), which is task P1-T10 in `07-phases.md` — land P1-T10 first, or pull it forward into this PR series if G-01 starts earlier. It also includes the four new repository methods.
2. **G-02 chat list v2.** It adds the database migration with the `last_*` and `changes_*` columns (G-11 reuses them) and the paged response. G-14 comes with it.
3. **G-03, G-04, G-05.** The desktop and client-runtime trio. They are small and touch different files, so they can run in parallel with item 2. G-05 needs item 1.
4. **G-08, G-09, G-20** (S each), then **G-07**. G-07 may slip past P4 because the UI degrades.
5. **G-12** (S), then **G-13** (needs G-01 counts), **G-14/G-15**, **G-10**, **G-11** (needs G-02).
6. **G-16, G-17, G-19, G-18.** These are independent of each other. G-18 last, because its recents rely on G-02.

**Rules for every P2 PR.**
- Write for all three OSes. Use `fs.promises.statfs` and `fs` walks, never shell tools. Put platform differences in the desktop behind shared helpers.
- Run SCM-touching tests (G-02 change columns, G-16 fetch) against a throwaway dummy repository, never this checkout.
- Replace response shapes cleanly and update every consumer (web, mobile, CLI) in the same PR, because the project keeps no backward compatibility.
- Add the mobile consumer note to `08-mobile-readiness.md` when a read model lands.
