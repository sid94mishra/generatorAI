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
| G-02 | Chat list v2: status, Changes ±, last activity, filters, paging | P3 | P2 | M |
| G-03 | Server switcher: server list, reachability, desktop IPC | P3 | P2 | M |
| G-04 | Desktop update state in the renderer ("Restart to update") | P3 | P2 | S |
| G-05 | Attention counts in the desktop main process (tray, menu, badge) | P3 | P2 | S |
| G-06 | Transcript view mode Normal / Verbose / Summary | P4 | P4 (client only) | S |
| G-07 | Computer consent plan + scope; Pause agent / Take over | P4 (degrades) | P2 | M–L |
| G-08 | Deep links keep an allowlisted query string | P4 | P2 (desktop) | S |
| G-09 | Model-picker provider methods on the platform client | P4 | P2 | S |
| G-10 | Stats summary (Home This week, Workflows strip, automation stats) | P5 (PW later) | P2 | M |
| G-11 | Recently finished activity | P5 | P2 | M |
| G-12 | System info (version, database size, disk, agent capacity) | P5 | P2 | S |
| G-13 | Project summaries (Projects columns, tab counts) | P5 | P2 | S–M |
| G-14 | ProjectDetail Chats tab (project filter on the client) | P5 | P2 (via G-02) | S |
| G-15 | ProjectDetail Runs tab (`projectId` filter on runs) | P5 | P2 | S |
| G-16 | Codebase fetch/clone logs and live status | P5 | P2 | M |
| G-17 | Worktree size, linked entity, reclaimable space | P5 | P2 | M |
| G-18 | Palette entity search (+ recents) | P5 | P2 | M |
| G-19 | Per-project customization enable/disable on the server | P5 | P2 | M |
| G-20 | Background-task cancel attribution | P4 (optional) | P2 | S |
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
  - `hooks/attentionQueries.ts` `useAttention({ projectId? })`: the snapshot through React Query, plus a `global` subscription through `platform/muxStream.ts` that applies the reducer to the cached snapshot;
  - `useAttentionCounts()`.
  - `hooks/useLiveOperations.ts` is deleted in the Home PR.

**Consumers.** Sidebar and rail (P3), ChatsList status (P3), Home (P5), ProjectDetail banner (P5), palette (P5), tray (G-05), mobile drawer, Home and notifications (`08-mobile-readiness.md` M-09).

**Owner / phase / effort.** P2 · needed by P3 · **L**. This is the first item of the track.

### G-02 — Chat list v2

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

**Consumers.** Sidebar and popover (P3), Windows strip chip (P3), Settings Security (P6), mobile drawer switcher.

**Owner / phase / effort.** P2 · P3 · **M**. Until it lands, the switcher shows the active server only, with no status dot.

### G-04 — Update state in the renderer

**Elements & boards.** DesktopWindows "Restart to update" pill, the Linux sidebar-header pill (D-23), and Home System "Version … · Up to date / Update · Restart".

**Exists today.** `apps/desktop/src/main/updater.ts:46` shows a native dialog on `update-downloaded`. The renderer gets nothing. The web knows its own build version (`__APP_VERSION__`, `settings/sections/General.tsx:53`).

**Needed.**
- **IPC** `updates.getState()` → `{ status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'; currentVersion; nextVersion? }`, plus `updates.onChanged` and `updates.install()` (`quitAndInstall`).
- The native dialog is shown only while no window is visible.
- **Web:** `lib/desktop.ts` wrapper and `useUpdateState()`.

**Owner / phase / effort.** P2 · P3 · **S**.

### G-05 — Attention counts in the desktop main process

**Elements & boards.** DesktopMac menu-bar menu: "Server running · 3 agents :3100", and the "Workflows 1" badge under Go to. The tray on every OS.

**Exists today.** `tray.ts:60` shows only the server state. The main process has no domain data. The renderer already pushes `MenuState` to main (`useDesktopIntegration.ts` `pushMenuState`; `apps/desktop/src/main/ipc.ts:222`).

**Needed.**
- Extend `MenuState` with `attention: { needsYou; running; runningChats; byEntity }`, pushed from the G-01 store. `tray.ts` and `menu.ts` rebuild from it.
- `app.setBadgeCount(needsYou)` where the OS supports it (macOS dock, Linux Unity). On Windows, `setOverlayIcon` through a shared helper; no ad-hoc platform checks.
- If the window has been destroyed, the counts are omitted and the item text degrades to today's.

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

### G-08 — Deep links keep an allowlisted query

**Elements.** R-4 `?dock=`, R-3 `?kind=`, R-5 `?run`, and pairing `generatorai://pair?code=` (AuthGate reads `?pair=`, `components/AuthGate.tsx:159`).

**Exists today.** `urlToRoute` (`apps/desktop/src/main/deep-link.ts:24`) drops the query and hash.

**Needed.** Keep the query but pass only the keys `pair`, `dock`, `tab`, `kind` and `run`. Check `appRouteOf` (`apps/desktop/src/main/navigation-guard.ts:55`, used for in-app popups at `window-manager.ts:217`) and apply the same rule there. Add unit tests for both.

**Owner / phase / effort.** P2 (desktop) · P4 · **S**.

### G-09 — Model-picker provider methods

**Elements & boards.** ComposerModelPicker: provider column with "Not signed in", detail pane (Context, Long context, Max output, Reasoning levels, Vision), refresh.

**Exists today (data complete):**
- `GET /harness/providers` (`harness.ts:50`: `installed`, `authenticated`, `ready`, `models`, `supportsLogin`, `stale`);
- `POST /harness/providers/:type/login|logout`;
- `GET /harness/models` (`harness.ts:148`) with `HarnessModel` fields `description`, `category`, `promptTokenLimit`, `longContext`, `maxOutputTokens`, `supportsVision`, `reasoningEfforts`, `defaultReasoningEffort` (`packages/core/src/domain/ports/IAgentHarness.ts:39`);
- `useHarnessProviders()` (`hooks/queries.ts:204`), already used by `ModelPicker`.

**Needed.** Only client methods: `getHarnessProviders({ refresh? })`, `loginProvider(type)` and `logoutProvider(type)` on the platform client. They replace the raw `fetch` calls in `settings/sections/Providers.tsx:61,84,108,143`.

**Owner / phase / effort.** P2 · P4 · **S**.

### G-10 — Stats summary

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

### G-11 — Recently finished activity

**Elements & boards.** Home "Recently finished": `+212 −48 · PR #1176 opened`, `4 of 4 stages · 3 review comments`, `Failed · pnpm typecheck exited 2` with Retry, and "All activity".

**Exists today.** No cross-entity source. PRs are per workspace (`GET /workspaces/:id/pull-requests`, `workspaces.ts:1341`). `useLiveOperations` guesses "today" from the full lists.

**Needed.** `GET /activity/recent?since=&limit=20&projectId=` → `{ items: Array<{ key, entity, entityId, title, href, project?, endedAt, outcome: 'succeeded' | 'failed' | 'cancelled', summary, changes?: { files, additions, deletions }, pullRequest?: { number, url }, commit?: { branch }, retry?: 'chat_prompt' | 'run_retry' }> }`.
- Sources: the G-02 chat columns, run `completedAt` and status, automation executions, workspace PR records.
- Retry uses the existing endpoints: resend the last prompt through `POST /chats/:id/prompt`, or `POST /workflow-runs/:id/retry` (`workflowRuns.ts:174`).
- Policy prefix `/activity`. "All activity" is a later list page and is not designed. The link is hidden until then.

**Owner / phase / effort.** P2 · P5 · **M** (after G-02).

### G-12 — System info

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

### G-13 — Project summaries

**Elements & boards.** Projects columns: Codebases, Active chats ("3 · 1 needs you"), Last run (status + name + #), Worktrees. ProjectDetail tab counts (Codebases 2, Chats 6, Runs 14). Palette project results.

**Exists today.** `GET /projects?status` (`projects.ts:70`) returns `Project` with no counts. Counts would take N calls: codebases (`:161`), worktrees (`:567`), chats `?projectId`.

**Needed.** `GET /projects?status=&include=summary` → each project plus `summary: { codebases, activeChats, needsYou, running, worktrees: { active, orphaned }, runs, lastRun?: { runId, definitionId, name, status, at } }`. Build it with grouped SQL plus G-01 counts by project. `GET /projects/:id?include=summary` takes the same parameter.

**Owner / phase / effort.** P2 · P5 · **S–M**.

### G-14 — ProjectDetail Chats tab

**Exists today.** The server already filters with `GET /chats?projectId` (`chats.ts:330`). The client drops the parameter (`HttpPlatformClient.ts:720`, `queries.ts:394`).

**Needed.** Delivered by G-02's list signature: `useChats({ projectId })`.

**Owner / phase / effort.** P2 · P5 · **S**.

### G-15 — ProjectDetail Runs tab

**Exists today.** `GET /workflow-runs?status|definitionId` (`workflowRuns.ts:49`). `WorkflowRun` has no `projectId` (`packages/shared/src/types/WorkflowRun.ts:84`): the project belongs to the definition (`GET /workflow-definitions?projectId`, `workflowDefinitions.ts:51`).

**Needed.** `GET /workflow-runs?projectId=&status=&cursor=&limit=`, joined through the definition, returning `{ items, nextCursor, total }` (the same shape as G-02). The platform client's `listRuns` gains the filter.

**Owner / phase / effort.** P2 · P5 · **S**. Coordinate with PW P01 as for G-10.

### G-16 — Codebase fetch/clone logs and live status

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

### G-17 — Worktree enrichment

**Elements & boards.** CodebaseDetail: Size column, "1.27 GB on disk · frees 385 MB", "Linked to" (chat or run title with status), "removes in 26h".

**Exists today.** `WorktreeInfo { id, runId?, runType?, worktreePath, branchName, status, createdAt, cleanedUpAt }` (`packages/shared/src/types/Project.ts:134`). Lists at `projects.ts:497,567`; cleanup at `:517`.

**Needed.** `GET …/worktrees?include=usage,link` adds `sizeBytes`, `link: { entity, id, title, status }` and `expiresAt` (from the project retention policy), plus a list summary `{ totalBytes, reclaimableBytes }`.
- Sizes come from an async, cached directory walk with the Node `fs` APIs (no `du`), refreshed at most every 10 minutes.

**Owner / phase / effort.** P2 · P5 · **M**.

### G-18 — Palette entity search

**Elements & boards.** CommandPalette: typing "run nig" yields a Workflows group with an inline "Run '…'" action and "Automations › Nightly audit" under Go to, plus Recent chats with status.

**Exists today.** No search route (no `search` handler in `apps/server/src/routes`). The chats list is capped at 500.

**Needed.** `GET /search?q=&types=chat,project,agent,workflow,automation,script&limit=20` → `{ results: Array<{ type, id, title, subtitle?, href, status?: VisualState, actions?: Array<'open' | 'run' | 'new_chat'> }> }`.
- SQL `LIKE` over names, descriptions and tags, scored by prefix match and recency.
- The results respect each type's read scope.
- Settings entries and navigation targets are matched client-side.
- Recents: `GET /chats?sort=activity&limit=5` (G-02) plus G-01 state.
- `useSearch(q)` is debounced by 120 ms.

**Owner / phase / effort.** P2 · P5 · **M**.

### G-19 — Per-project customization enablement on the server

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

### G-20 — Background-task cancel attribution

**Elements & boards.** DockTasks "Cancelled · by you at 14:09".

**Exists today.** `BackgroundTaskStatus` includes `cancelled` (`packages/shared/src/types/Chat.ts:31`). The cancel route is `chats.ts:888`. Neither the actor nor the time is stored.

**Needed.** `cancelledBy: 'user' | 'orchestrator'` and `cancelledAt` on `BackgroundTaskMeta`, set by the cancel route or the orchestrator.

**Owner / phase / effort.** P2 · P4 (optional) · **S**.

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
