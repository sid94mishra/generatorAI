# 05 — Mobile gap matrix (server / API / shared-contract gaps)

Status: **plan, binding for the mobile pass** once the owner accepts it. Implementer: Codex (MD-13).

Every designed element maps to an existing API or to a gap here (MD-27, D-36). A gap marked **now** is built API-first in this pass, before the screen that needs it, in the phase given. A gap marked **later** stays hidden: the element is not rendered (MD-06, MD-27). A gap marked **WO** is owned by the Workflow Overhaul (`docs/redesign/07-phases.md` §Running in parallel; plan artifact `https://claude.ai/artifact/Kqrzv5CnsYg13EdQNTp2gC`) and the mobile element waits for it.

Screens and routes are in `04-screen-map.md`. Desktop gaps `G-xx` are in `docs/redesign/05-gap-matrix.md`.

**Every "current state" below was verified by reading the code on `mobile_redesign` (2026-09-26).** Paths are repo-relative.

---

## 0. Rules for every MG change (MD-12, D-36)

1. **Additive only in shared packages.** `packages/shared`, `client-core`, `client-runtime`, `client-transport`, `design-tokens`: new files, new exports, new optional fields. No renames, no behaviour change to what web uses, never a rewrite of `packages/client-*`. Log each change in `docs/redesign/mobile/COORDINATION.md`.
2. **Server changes are API-first and append-only** in `apps/server/src/routes/index.ts`, `apps/server/src/routes/openapi.ts` (+ `apps/server/src/openapi/spec.ts`), `apps/web/src/platform/HttpPlatformClient.ts` and `packages/shared/src/types/IPlatformClient.ts`. Every new route gets: a zod schema, a `packages/auth/src/routePolicy.ts` entry (scope + `riskLevel`), an OpenAPI entry, a typed client-core method, and tests (route + client).
3. **Storage.** Prefer a JSON settings file (`apps/server/src/settings/*.ts`, e.g. `audio.json`) or an existing JSON column (`projects.settings`). When a column is unavoidable, add it in the idempotent `ADD COLUMN` block of `packages/db/src/migrations/index.ts` (the v26 comment explains why ADD COLUMN lives there); a new table takes the next free migration version at merge time (latest today: v57, `migrations/index.ts:2600`) and is renumbered on conflict.
4. **Desktop parity (D-36).** A feature that is not platform-native gets its web/desktop counterpart named in the row; the web UI for it is built by the web pass (the mobile pass never edits `apps/web/**`), so the API must serve both.
5. **Cross-platform.** Server code uses Node APIs and the existing git/process runners, never shell-specific commands (Windows, macOS, Linux are first-class).
6. **Tests before screens.** A "now" gap lands with its tests before the screen task that renders it starts.

---

## 1. Summary

| MG | Gap | Boards (main) | When | Needed by (built in) | Server | DB |
|---|---|---|---|---|---|---|
| MG-01 | Self-service read of the own device record (scopes) without `admin:devices` | MSettings, MSetSecurity, MSetBrowserTerminal, MScopeRequest | now | M7 (M7-09) | yes | none |
| MG-02 | Pinned and unread chats | MChats, MSidebarChats | now | M6 (M2-10) | yes | 2 columns on `chats` |
| MG-03 | Model label on chat rows without an agent | MChats, MChatNoAgent | now | M6 (M2-10) | yes | none |
| MG-04 | Gate `risk` flag on chat gates, attention asks and pushes | Main, MNotifications, MHome | now | M6 (M2-10) | yes | none |
| MG-05 | Biometric-signed risky approvals (device approval key + server verification) | Main, MRunApproval, MWorkflowRunPane, MNotifications | now | M6 (M2-10) | yes | 2 columns on `auth_devices` |
| MG-06 | Push payload v2 (server id, web `href`, question options, attention counts, risk) | MNotifications, MLiveActivity, MServers | now | M5 (part A, built in M2-10), M9 (part B, M9-02) | yes | none |
| MG-07 | Live run/turn state model in client-core (Live Activity phase 1, widgets, quick-action subtitles) | MLiveActivity, MWidgets, MShortcuts, MSetWidgets | now | M9 (M9-01) | no | none |
| MG-08 | Live Activity / Live Update push tokens, push gateway, silent widget refresh | MLiveActivity, MWidgets, MSetWidgets | later | — | yes | new table |
| MG-09 | Share-to-agent single-request ingest | MShortcuts | now | M9 (M9-08) | yes | none |
| MG-10 | Automation drafts ("Save draft") | MAutomationCreate1–4 | WO | P02 (G-26 sub-item) | yes | WO |
| MG-11 | Remote branch list before clone | MAddCodebase, MProjectCreate | now | M7 (M7-09) | yes | none |
| MG-12 | Agent `.agent.md` import preview | MAgentImport | now | M7 (M7-09) | yes | none |
| MG-13 | Pull-request and commit outcomes in "Recently finished" | MHomeMore | now | M7 (M7-09) | yes | none |
| MG-14 | Per-chat "Let this chat run workflows" toggle | MComposerPlus, MNewChat | WO | P06 (G-25) | yes | WO |
| MG-15 | Server-side notification preferences (categories, chat replies, quiet hours, digest, per-project levels, hide previews at source) | MSetNotifications, MSetAppLock | later | — | yes | JSON column on `device_push_tokens` |
| MG-16 | Pause / resume all agents + running count | MWidgets (control/tile), MNotifications (Android QS) | later | — | yes | settings JSON |
| MG-17 | Dictation language | MSetAudio, MComposerVoice | now | M7 (M7-09) | yes | none (`audio.json`) |
| MG-18 | Server log tail + diagnostics export | MSetDiagnostics | later | — | yes | none |
| MG-19 | Multi-server client (server registry, per-server runtime and caches) | MServers, MSidebar, MSetSecurity, MPairing | now | M5 (M2-08) | no | none |
| MG-20 | Shared deep-link module (+ `server`, `code` keys) and `routeForAttention()` | all deep-link entry points | now | M5 (M2-09) | no | none |
| MG-21 | Platform-neutral artifact download (the `Buffer` type) | Main (attachments), MPaneFiles | now | M6 (M2-10) | no | none |
| MG-22 | Typed client-core wrappers for existing routes mobile calls | many (listed) | now | M6 / M7 (M2-10 / M7-09) | no | none |
| MG-23 | Scope labels, sensitivity and named pairing presets in shared | MScopeRequest, MSetPairDevice, MSetSecurity | now | M7 (M7-09) | no | none |
| MG-24 | Element pick on the server-side browser for comments from a remote client | MPaneBrowser | now (spike-gated) | M6 (M2-10) | yes | none |
| MG-25 | Storage breakdown + retention dry-run | MSetStorage | later | — | yes | none |
| MG-26 | `SystemInfo` runtime version + update availability | MSetGeneral, MSetDiagnostics | later | — | yes | none |
| MG-27 | Restart the server from a remote client | MSetSecurity | later | — | yes | none |
| MG-28 | Run-pane tab contract (Output, Files, Hooks, Variables, Changes, Terminal, Browser) | MWorkflowRunPane | WO | P03b (run page) | no | none |
| MG-29 | Sequential run number per workflow (`#248`) | MWorkflowRun, MChatWorkflowRun, MLiveActivity, MHome | WO | request to WO | yes | WO |
| MG-30 | Template categories | MWorkflowNew | WO | request to WO (P05 templates) | yes | WO |
| MG-31 | Per-stage tokens / cost and per-stage context % | MWorkflowRun, MWorkflowRunPane | WO | P03 / P07 (G-23, G-29) | yes | WO |
| MG-32 | Structured-output presentation hints | MWorkflowRunPane | WO | request to WO | yes | WO |
| MG-33 | Validation quick-fix payloads | MWorkflowValidate | WO | P01 (G-28) | yes | WO |
| MG-34 | Risk flags on workflow approvals | MRunApproval, MChatWorkflowRun, MWorkflowAgentDraft | WO | P06 (G-25) | yes | WO |
| MG-35 | Multi-file skill listing | MSkillDetail | later | — | yes | none |
| MG-36 | Orchestrator wave / worker limit on the wire | MPaneTasks | later | — | yes | none (columns exist) |
| MG-37 | Live tool-output tail for a running step | MChatStepDetail, MChatRunning, MChatToolsExpanded | later | — | yes | none |
| MG-38 | "Always allow" (a remembered permission rule) on permission gates | Main, MComponents | later | — | yes | none |

**Totals: 38 gaps — 18 now, 11 later, 9 WO.** MG-37 and MG-38 were added during plan integration from `03-components.md` (MB-14), `04-screen-map.md` (MChatStepDetail) and `10-design-feedback.md` (MDF-49, MDF-50), which render those elements only once their API exists.

---

## 2. Gaps

Each gap: **Needs** (what the design needs) · **Boards** · **Current state (verified)** · **Proposed API** · **Types / client** · **Server files** · **DB** · **Web/desktop counterpart** · **When**.

### MG-01 — Self-service read of the own device record

| | |
|---|---|
| Needs | The phone shows its own scopes ("12 of 24", Granted / Request rows), its name and key protection, and decides which settings rows are scope-limited (MD-30), without `admin:devices`. |
| Boards | MSettings, MSettingsMore, MSetSecurity, MSetBrowserTerminal, MScopeRequest, every S state |
| Current state | Own **scope requests** are already self-service: `GET/POST /auth/devices/me/scope-requests` and `DELETE …/:requestId` need only `read:status` (`apps/server/src/routes/scopeRequests.ts:84,122,138`; policy carve-out `packages/auth/src/routePolicy.ts:59-61`; client `api.auth.scopeRequests.create/mine/cancel`, `packages/client-core/src/api/client.ts:1762-1782`). There is **no own-device read**: `/auth/devices/me` falls under the `/auth/devices` prefix, which needs `admin:devices` even to read (`routePolicy.ts:63`; test `packages/auth/src/__tests__/scopeRequestPolicy.test.ts:38`). The session's `StoredSession.scopes` (`packages/client-runtime/src/AuthenticatedClientRuntime.ts:25-36`) is written at pairing and goes stale after an approval. |
| Proposed API | `GET /api/auth/devices/me` → `200 SelfDeviceView`. Principal's `deviceId` from the credential, never from the path or body. |
| Types / client | `packages/shared/src/types/Device.ts` (new, additive): `interface SelfDeviceView { deviceId: string; name: string; platform: 'web'\|'desktop'\|'cli'\|'mobile'\|'other'; scopes: string[]; createdAt: string; lastSeenAt?: string; connectionMode: string; credentialVersion: number }`. Client: `api.auth.devices.me(): Promise<SelfDeviceView>`. |
| Server files | `apps/server/src/routes/auth.ts` (new handler before the `/devices/:deviceId` routes), `packages/auth/src/routePolicy.ts` (carve-out `{ prefix: '/auth/devices/me', read: ['read:status'], exact: true }`, ordered before `/auth/devices`), `packages/auth/src/DeviceService.ts` (reuse the device read), `apps/server/src/routes/openapi.ts`. |
| DB | none (`auth_devices`, `migrations/index.ts:1410`). |
| Web/desktop | Desktop Settings › Security "This device" row uses the same route (web never holds `admin:devices` in a browser session either). |
| When | **now — M7** — built in M7-09 (M6 S states read `StoredSession.scopes`, refreshed by this route once it lands). |

### MG-02 — Pinned and unread chats

| | |
|---|---|
| Needs | "Pinned" section, pin glyph, swipe/menu Pin and Mark unread, an unread indicator. |
| Boards | MChats, MSidebarChats, MComponents (row) |
| Current state | No pin or read fields anywhere: `Chat` (`packages/shared/src/types/Chat.ts`), `ChatListItem`/`ChatListSummary` (`packages/shared/src/types/ChatList.ts:43,58-69,75`), `ChatRowModel` (`packages/shared/src/ui-contract/chats.ts:28`). The `chats` table (`migrations/index.ts:231`) has only typed columns — no JSON column to hold them. |
| Proposed API | `PATCH /api/chats/:id` (existing route) accepts two new optional fields `{ pinned?: boolean; unread?: boolean }`. `GET /api/chats` gains `?pinned=only\|exclude` (default: both, pinned rows first on the first page). Opening a chat marks it read: the client sends `PATCH {unread: false}` when the chat screen gains focus. `chat.updated` SSE carries the new fields. |
| Types / client | `Chat.pinnedAt?: string`; `ChatListSummary.unread?: boolean` (true when `lastActivityAt > lastReadAt`); `ChatListQuery.pinned?: 'only'\|'exclude'`. Client: `api.chats.setPinned(id, pinned)`, `api.chats.setUnread(id, unread)` (wrappers over `update`). `chatRowState` unchanged. |
| Server files | `apps/server/src/routes/chats.ts` (PATCH schema; list at `:467`), the chat repository / list read model in `packages/core`, `packages/shared/src/config/ChatSchemas.ts`, `openapi.ts`. |
| DB | `ALTER TABLE chats ADD COLUMN pinned_at INTEGER` and `ADD COLUMN last_read_at INTEGER` in the idempotent block; index `(pinned_at)` partial where not null. Unavoidable: the table has no JSON column. |
| Web/desktop | ChatsList row menu Pin / Mark unread + Pinned group on web (D-59 has no pinning; the owner accepts the addition with this gap). |
| When | **now — M6** — built in M2-10 |

### MG-03 — Model label on chat rows with no agent

| | |
|---|---|
| Needs | Row meta "project · Claude Sonnet 5" and StatusLine "Done · Claude Sonnet 5" for model-only chats. |
| Boards | MChats, MChatNoAgent, MSearch (recent rows) |
| Current state | The id exists: `Chat.model?: string` (`Chat.ts:100`) and `ChatListItem = Chat & {summary}` (`ChatList.ts:75`); `harnessConfig` holds the provider. No display label: the catalog (`buildModelPickerCatalog`, `packages/client-core/src/models/pickerCatalog.ts:121`) lists only **ready** providers, so a row for a signed-out provider cannot be labelled client-side. |
| Proposed API | `GET /api/chats` rows and `GET /api/chats/:id` gain `summary.model`. |
| Types / client | `ChatListSummary.model?: { id: string; label: string; provider?: string }` (label from the harness registry's static model metadata, falling back to the id). No new client method. |
| Server files | chat list read model in `packages/core` (join with the harness model metadata), `apps/server/src/routes/chats.ts:467`. |
| DB | none. |
| Web/desktop | ChatsList rows on web show the same label (ChatRowModel gains an optional `modelLabel` when web adopts it). |
| When | **now — M6** — built in M2-10 |

### MG-04 — Gate risk flag

| | |
|---|---|
| Needs | The server decides which approvals are risky (MD-31): risky ones open the app and require a biometric signature (MG-05); ordinary ones can be answered from the lock screen. |
| Boards | Main, MNotifications, MHome, MSidebar |
| Current state | No `risk` field anywhere: `ToolPermissionType = 'file_write'\|'file_read'\|'shell_exec'\|'network'\|'other'` (`packages/shared/src/types/AgentMode.ts:381`), `ToolPermissionRequestPayload` (`:384`), `PermissionCardSummary` (`:404`), `AttentionAsk` (`packages/shared/src/types/Attention.ts:45`), `PushData` (`packages/core/src/services/push/PushDispatcher.ts:51-59`). `HIGH_RISK_SCOPES` exists for routes only (`packages/auth/src/scopes.ts:142-149`). |
| Proposed API | No new route. The server stamps `risk` on permission gates when it creates them, and copies it to the attention ask and the push. Rule (pure, shared): `risky` when `type` is `shell_exec` or `network`, or the command is a `git push`, or the tool writes outside the workspace; otherwise `standard`. |
| Types / client | `packages/shared/src/security/gateRisk.ts` (new, client-safe): `type GateRisk = 'standard'\|'risky'`; `classifyPermissionRisk(input: {type: ToolPermissionType; toolName: string; inputSummary?: string}): {risk: GateRisk; reasons: string[]}`. Optional fields `risk?: GateRisk; riskReasons?: string[]` on `ToolPermissionRequestPayload`, `PermissionCardSummary`, `AttentionAsk`, `PushData`. Client fallback while a field is absent: MD-31 default (shell, network, git push and every workflow approval are risky). |
| Server files | `packages/core/src/services/AgentInteractionService.ts` (stamp on create), `packages/core/src/services/AttentionService.ts` (copy to the ask), `PushDispatcher.ts` (copy to data). |
| DB | none (the interaction payload is stored as JSON in `agent_interactions`, `migrations/index.ts:1286`). |
| Web/desktop | GateCard shows a neutral "Risky" Badge on web and desktop (display only; desktop approvals stay a click). |
| When | **now — M6** — built in M2-10 |

### MG-05 — Biometric-signed risky approvals

| | |
|---|---|
| Needs | A risky approval is signed with a biometric-gated hardware key and the server verifies the signature (MD-31); the 10-minute step-up cache does not apply; devices without biometrics or a passcode cannot approve risky gates. |
| Boards | Main, MRunApproval, MWorkflowRunPane, MChatWorkflowRun, MNotifications |
| Current state | Step-up is client-only: `apps/mobile/src/auth/stepUp.ts` (`requireStepUp`, `hasFreshStepUp`) gates local biometrics and produces nothing the server checks. The native module exposes `isSupported, generate, exists, load, backing, sign, remove` (`apps/mobile/modules/generatorai-device-key/ios/GeneratorAIDeviceKeyModule.swift:63-113`, `…/android/src/main/java/dev/generatorai/devicekey/GeneratorAIDeviceKeyModule.kt:74-114`) for the DPoP key only. The server verifies DPoP proofs (`packages/auth/src/dpop.ts`) and has a nonce table (`auth_nonces`, `migrations/index.ts:1472`), but no approval proof. Answer routes: `POST /chats/:id/interactions/:iid/permission` (`apps/server/src/routes/chats.ts:1341`), `…/respond` (`:1306`), `POST /chats/:id/plans/:planId/decision` (`:1198`), `POST /workflow-runs/:runId/stages/:stageId/approve` (`apps/server/src/routes/workflowRuns.ts:476`), computer consent `POST /workspaces/:id/computer/consent` (`apps/server/src/routes/computer.ts:358`). |
| Proposed API | The protocol is written out in `06-platform-and-shell.md` §6.3; this row is the API contract both documents use. 1) `POST /api/auth/approval-nonce` → `{ nonce, expiresAt }`: a server-issued, single-use nonce, valid 60 s, stored in `auth_nonces`. 2) `PUT /api/auth/devices/me/approval-key` body `{ publicJwk: JsonWebKey (P-256), keyProtection: 'secure-enclave'\|'strongbox'\|'tee', presence: 'biometry'\|'passcode', proof: string }` → `204`, where `proof` is the new key's signature over the canonical JSON `{"deviceId","nonce","serverId","typ":"gai-approval-key"}`; `DELETE` same path. Policy: `read:status` carve-out like MG-01, `riskLevel: 'high'`, the request itself DPoP-signed. 3) Every answer route above accepts an optional body field `approvalProof: { v: 1; payload: ApprovalPayload; signature: string /* base64url ES256 (r‖s) over the canonical JSON of payload */ }`. 4) Server rule: when the gate's `risk` is `risky` and the principal is a `mobile` device, the answer is rejected with `403 APPROVAL_PROOF_REQUIRED` unless a valid proof is present, and with `403 APPROVAL_KEY_MISSING` when the device has no registered key. A proof is valid when the ES256 signature verifies, `serverId` is this server, `deviceId` is the DPoP principal's device, `gate.kind` / `gate.id` / `gate.entityId` and `decision` match the route and body, the nonce was issued to this device, is unused and younger than 60 s, and `|now − iat| ≤ 120 s`; otherwise `403 APPROVAL_PROOF_INVALID`. |
| Types / client | `packages/shared/src/security/approvalProof.ts` (new, client-safe): `interface ApprovalPayload { v: 1; typ: 'gai-approval'; gate: { kind: 'tool_permission'\|'question'\|'plan_review'\|'stage_approval'\|'stage_input'\|'computer_consent'\|'scope_grant'; id: string /* interactionId, planId or stageRunId */; entityId: string /* chat or run id */ }; decision: 'allow'\|'deny'\|'approve'\|'reject'\|'answer'; serverId: string; deviceId: string; digest?: string /* b64url SHA-256 of the summary shown */; iat: number /* seconds */; nonce: string }`, `canonicalApprovalPayload(p): string` (keys sorted, no whitespace, UTF-8). Client: `api.auth.approvalNonce()`, `api.auth.devices.setApprovalKey(body)`, `removeApprovalKey()`; the answer methods (`api.chats.respondPermission`, `respond`, `decidePlan`, `api.runs.approve`) take an optional `approvalProof`. Native: the `modules/generatorai-device-key` additions of `06-platform-and-shell.md` §6.3 (`generateApprovalKey`, `approvalKeyStatus`, `signWithPrompt`, `removeApprovalKey`; alias `gai.approval.<serverId>`; biometry-bound key with the device-passcode fallback MD-31 allows; Android StrongBox when present). |
| Server files | `apps/server/src/routes/auth.ts`, `packages/auth/src/approvalProof.ts` (new verifier), `packages/auth/src/routePolicy.ts`, the five answer routes listed, `openapi.ts`. |
| DB | `ALTER TABLE auth_devices ADD COLUMN approval_public_jwk TEXT` and `ADD COLUMN approval_key_created_at INTEGER` (idempotent block). Unavoidable: `auth_devices` has no JSON column; a revoke already invalidates the device. |
| Web/desktop | none needed (platform-native security; the rule only binds `mobile` principals). Desktop keeps click approvals. |
| Resolution | The first drafts of 05 and 06 described different wire formats (a header vs a body field, different payload fields and error codes). This row is the single contract; 06 §6.3 follows it. |
| When | **now — M6** — built in M2-10 (chat gates); workflow approvals use it in M8. |

### MG-06 — Push payload v2

| | |
|---|---|
| Needs | Part A (routing): the server id (multi-server, MD-05) and a web-shaped `href` on every push. Part B (content): question options as notification actions, needs-you / running counts for the app badge and quick-action subtitles, `risk` (MG-04), entity ids for Live Activity hand-off. |
| Boards | MNotifications, MLiveActivity, MServers, MShortcuts |
| Current state | `PushData = { route, category, threadId, chatId?, interactionId?, kind?, actions? }` (`packages/core/src/services/push/PushDispatcher.ts:51-59`, built at `:199-209`). `route` for runs is `/runs/<id>` (`notificationPolicy.ts:144,239`) — not a web path and without the workflow id. No `serverId`, no counts, no question options (`firstQuestion` only builds the body, `notificationPolicy.ts:102`). Interruption level already exists (`PushMessage.interruption: 'active'\|'timeSensitive'`, sent as `interruptionLevel`, `ExpoPushProvider.ts:80`). `serverId` exists server-side (`/api/auth/server-info` → `serverId`, `apps/server/src/routes/auth.ts:120-145`). |
| Proposed API | No new route. `PushData` gains optional fields (existing fields untouched): part A `v: 2`, `serverId: string`, `href: string` (the same path rule as `AttentionItem.href`: `/chats/<id>?dock=…`, `/workflows/<wid>/runs/<runId>`, `/automations/<id>`), `entity: AttentionEntity`, `entityId: string`, `workflowDefinitionId?`; part B `risk?: GateRisk`, `question?: { prompt: string; options: {id: string; label: string}[] /* ≤ 4 */; multiSelect: boolean; freeText: boolean }`, `counts?: { needsYou: number; running: number }` (from `AttentionService` at send time; also sent as the iOS `badge`). |
| Types / client | Move the `PushData` interface to `packages/shared/src/types/Push.ts` (new; `PushDispatcher.ts` imports it). Mobile parses with a zod schema in `apps/mobile/src/services/notifications/pushData.ts`; routing uses `href` (via `resolveDeepLink`, MG-20) and ignores `route` once `v: 2`. Answering an option uses the existing `api.chats.respond(id, iid, …)`. |
| Server files | `packages/core/src/services/push/PushDispatcher.ts`, `notificationPolicy.ts`, `ExpoPushProvider.ts` (badge), composition root wiring for `serverId` and `AttentionService` counts (`apps/server/src/composition-root.ts`). |
| DB | none. |
| Web/desktop | none (push is mobile-only); the badge count equals desktop's G-05 count. |
| When | **now — part A M5 (built in M2-10), part B M9 (built in M9-02)** |

### MG-07 — Live run/turn state model (client-core)

| | |
|---|---|
| Needs | One state model feeding in-app status, notification copy, Live Activity / Live Update content, widgets and quick-action subtitles (00 §5.10); phase 1 is local updates only (MD-32). |
| Boards | MLiveActivity, MWidgets, MShortcuts, MSetWidgets |
| Current state | Nothing: no `LiveActivity` or widget model anywhere in the repo (`research/foundations-state.md` §4). Inputs exist: attention store (`packages/client-core/src/attention/store.ts:102`), run stages (`api.runs.stages`), turn stream. |
| Proposed API | No server change. |
| Types / client | `packages/client-core/src/live/liveState.ts` (new): `interface LiveItem { serverId; entity; entityId; title; state: StatusState; href; startedAt; stage?: {index; count; name; gate?: string}; segments?: StatusState[]; step?: {verb; target?} ; updatedAt }`; `deriveLiveItems(attention: AttentionState, runs: Record<string, RunStagesSnapshot>): LiveItem[]`; `selectMostUrgent(items)`; `toWidgetSnapshot(items, counts, now): WidgetSnapshot` (JSON written to the App Group / shared prefs); `toLiveContent(item, {locked: boolean})` (redacts commands / message text when locked, MD-33). Pure, tested in Vitest. |
| Server files | none. |
| DB | none. |
| Web/desktop | desktop tray / badge already read `AttentionCounts` (G-05); the model is reusable there. |
| When | **now — M9** — built in M9-01 |

### MG-08 — Live Activity / Live Update push tokens and gateway (phase 2)

| | |
|---|---|
| Needs | Lock-screen progress while iOS suspends the app; server-sent stage/gate updates; silent widget refresh. |
| Boards | MLiveActivity, MWidgets, MSetWidgets |
| Current state | Push tokens are Expo tokens only (`PUT /api/auth/push-token {provider: 'expo'\|'apns'\|'fcm', token, platform}`, `auth.ts:570`, schema `:97-101`; table `device_push_tokens`, `migrations/index.ts:1596-1630`). No activity tokens; the Expo Push Service has no documented Live Activity support. |
| Proposed API | `PUT /api/auth/devices/me/live-activities/:activityId { pushToken, entity, entityId }`, `DELETE` same; `PUT /api/auth/push-token` gains optional `pushToStartToken`. A push gateway beside `apps/relay` holding the APNs key and FCM credentials (owner decision, MD-32 phase 2). |
| Types / client | `LiveActivityRegistration` in `packages/shared/src/types/Push.ts`. |
| Server files | `apps/server/src/routes/auth.ts`, `packages/core/src/services/push/*`, new gateway service. |
| DB | new table `device_live_activity_tokens(device_id FK ON DELETE CASCADE, activity_id, push_token, entity, entity_id, created_at)` — next free version at merge. |
| Web/desktop | none (platform-native). |
| When | **later** (MD-32 phase 2; not rendered: widgets refresh when the app runs). |

### MG-09 — Share-to-agent ingest

| | |
|---|---|
| Needs | The share extension sends text, a URL, images or files to an existing chat or a new chat, plus an optional note, in one request that survives the extension being killed (iOS hands a single upload to a background `URLSession`; a create-then-send pair cannot run after the extension exits). |
| Boards | MShortcuts |
| Current state | Existing chat: `POST /api/chats/:id/prompt` multipart via `api.chats.sendWithAttachments` (`client.ts:1088-1116`, route `chats.ts:750`), limited to 5 files × 10 MB by the shared multer instance (`chats.ts:188-190`). No create-with-attachments: `CreateChatParams` has no attachment field; a new chat needs `chats.create` then a second request. Idempotency storage exists (`idempotency_keys`, `migrations/index.ts:1036`). |
| Proposed API | `POST /api/chats/ingest` (multipart; header `Idempotency-Key` required). Parts: `target` (JSON: `{chatId: string}` or `{newChat: {name?: string; projectId?: string; agentRef?: string; model?: string}}`), `note?` (text), `text?`, `url?`, `attachments[]` (≤ 5 × 10 MB, same limits). Response `201 { chatId: string; created: boolean; messageId: string }`. The server composes the existing create + prompt services; `url` is sent as prompt text (the server does not fetch it). Scopes: `write:chats` + `exec:agent` (as prompt). |
| Types / client | `ChatIngestTarget`, `ChatIngestResult` in `packages/shared/src/types/ChatIngest.ts` (new). Client: `api.chats.ingest(form: FormData, {idempotencyKey})` for in-app use; the native extension builds the same multipart body. |
| Server files | `apps/server/src/routes/chats.ts` (new handler), `routePolicy.ts`, `openapi.ts`. |
| DB | none. |
| Web/desktop | none (OS share targets are platform-native; desktop has drag-and-drop into the composer). |
| When | **now — M9** — built in M9-08 |

### MG-10 — Automation drafts

| | |
|---|---|
| Needs | "Save draft" / "Draft saved 14:02" in the create wizard. |
| Boards | MAutomationCreate1–4 |
| Current state | `Automation` has `enabled: boolean` and no draft state (`packages/shared/src/types/Automation.ts:185-230`); G-26 (automation create) does not list drafts (`docs/redesign/05-gap-matrix.md:635`). |
| Proposed API | Owned by the Workflow Overhaul: `status: 'draft'\|'active'` on automations (or a draft store) as a G-26 sub-item. Until then "Save draft" is not rendered; the wizard keeps an unsent local draft in MMKV (not presented as a server draft). |
| Types / client | WO |
| Server files | WO (`apps/server/src/routes/automations.ts`) |
| DB | WO |
| Web/desktop | AutomationCreate on desktop (PW P02) |
| When | **WO — P02 (request to add to G-26)** |

### MG-11 — Remote branch list before clone

| | |
|---|---|
| Needs | Default-branch options when adding a Git remote, before the codebase exists. |
| Boards | MAddCodebase, MProjectCreate |
| Current state | `GET /projects/:id/codebases/:cid/branches` works only for an existing codebase (`apps/server/src/routes/projects.ts:394`). No `ls-remote` anywhere in `apps/server` or `packages/core`. Codebase create: `POST /projects/:id/codebases {alias, type: 'git-remote'\|'git-local'\|'local-dir', url?, localPath?, defaultBranch?, subdirectory?, settings?}` (`projects.ts:244`). |
| Proposed API | `POST /api/source-control/remote-refs { url: string }` → `200 { defaultBranch?: string; branches: string[]; truncated: boolean }`; errors `AUTH_REQUIRED`, `NOT_FOUND`, `TIMEOUT` (15 s). The server runs `git ls-remote --symref <url>` through the existing git runner (argument array, no shell; works on Windows, macOS, Linux) with the source-control credentials; ≤ 500 branches. Scope `write:projects`. |
| Types / client | `RemoteRefs` in `packages/shared/src/types/SourceControl.ts` (additive). Client: `api.sourceControl.remoteRefs({url})`. |
| Server files | `apps/server/src/routes/sourceControl.ts`, the git service in `packages/core`, `routePolicy.ts`, `openapi.ts`. |
| DB | none. |
| Web/desktop | ProjectDetail inline add-codebase form and CreateProjectPage branch Select. |
| When | **now — M7** — built in M7-09 |

### MG-12 — Agent import preview

| | |
|---|---|
| Needs | "Parsed from the file" summary, warnings and conflict detection before importing `.agent.md`. |
| Boards | MAgentImport |
| Current state | `POST /agents/import {markdown, scope, projectId, overwrite}` parses and creates at once (`apps/server/src/routes/agents.ts:137`; client `admin.agents.import`). The parser is server-only: `parseAgentMarkdown` (`packages/core/src/services/agentMarkdown.ts:81`, limit `AGENT_MARKDOWN_MAX_BYTES = 256 KB` at `:25`). `POST /agents/resolve-preview` previews a draft agent's capabilities, not a file. |
| Proposed API | `POST /api/agents/import/preview { markdown: string; scope: 'global'\|'project'; projectId?: string }` → `200 AgentImportPreview`; `413` over 256 KB; `400 PARSE_ERROR {line?, message}`. Never writes. Same scope as import. |
| Types / client | `interface AgentImportPreview { parsed: { name; slug; role; model?; effort?; instructionsBytes: number; skills: string[]; mcp: string[] }; warnings: {code: string; message: string}[]; conflict?: { agentId: string; name: string; version?: number } }` in `packages/shared/src/types/Agent.ts` (additive). Client: `admin.agents.importPreview(body)`. |
| Server files | `apps/server/src/routes/agents.ts`, `agentMarkdown.ts` (reuse), `openapi.ts`. |
| DB | none. |
| Web/desktop | Agents list Import dialog shows the same preview. |
| When | **now — M7** — built in M7-09 |

### MG-13 — PR and commit outcomes in "Recently finished"

| | |
|---|---|
| Needs | Rows such as "PR #1176 opened" / "Done · committed". |
| Boards | MHomeMore, MHome |
| Current state | `RecentActivityItem.pullRequest?: {number, url}` and `commit?: {branch}` are **reserved and always absent**; PR/commit sources were excluded from G-11 (`packages/shared/src/types/RecentActivity.ts:8-16, 40-62`; route `apps/server/src/routes/activity.ts:51`). PR records exist per workspace (`GET /workspaces/:id/pull-requests`, `admin.workspaces.pullRequests`) and SCM flow results are written by `POST /workspaces/:id/scm/flow` (`apps/server/src/routes/workspaces.ts:374`). |
| Proposed API | No new route: `GET /api/activity/recent` fills the reserved fields for chat and run items whose workspace committed or opened a PR in the item's turn/run. |
| Types / client | none new (fields exist). |
| Server files | the recent-activity read model behind `activity.ts:51` (join workspace SCM results / PR records). |
| DB | none (derived from existing records). |
| Web/desktop | desktop Home "Recently finished" PR link (G-11 deferred item). |
| When | **now — M7** — built in M7-09 |

### MG-14 — Per-chat "Let this chat run workflows"

| | |
|---|---|
| Needs | A per-chat workflows capability toggle ("Off by default · on for orchestrators"). |
| Boards | MComposerPlus, MNewChat, MAgentPickerCaps |
| Current state | The composer tool-toggle registry ships **empty** (`apps/web/src/blocks/composer/toolToggles.ts:34-38`, D-66: capability deltas freeze at session start, so a mid-chat toggle cannot take effect); G-25 assigns the "composer Workflows toggle" to the Workflow Overhaul (`docs/redesign/05-gap-matrix.md:634`). Per-chat capability overrides do exist (see NG-05). |
| Proposed API | WO P06: the workflows tool group as an `AgentOverrides.tools` entry set at chat create, and the registered composer toggle. |
| Types / client | WO |
| Server files | WO |
| DB | WO |
| Web/desktop | web composer toggle (same registry) |
| When | **WO — P06 (G-25)**; hidden until then. |

### MG-15 — Server-side notification preferences

| | |
|---|---|
| Needs | Per-category opt-in, "Chat replies" (turn completed) pushes, quiet hours with approvals let through, morning digest, per-project levels, hide previews at the source. |
| Boards | MSetNotifications, MSetAppLock |
| Current state | Only an all-or-nothing `mutedUntil` per device (`PUT /api/auth/push-token/mute`, `auth.ts:626`; column `device_push_tokens.muted_until`). Category switches are client-only (`apps/mobile/src/notifications/notificationFilter.ts:27-52`). No turn-completed push kind in `packages/core/src/services/push/notificationPolicy.ts`. |
| Proposed API | `GET/PUT /api/auth/devices/me/notification-prefs` → `NotificationPrefs { categories: { approvals: true; questions: boolean; plans: boolean; runOutcomes: boolean; chatReplies: boolean; automations: boolean }; quietHours?: { start: 'HH:mm'; end: 'HH:mm'; days: number[]; timeZone: string; allowApprovals: true }; digest?: { enabled: boolean; time: 'HH:mm' }; projects?: Record<string, 'everything'\|'approvals'\|'muted'>; hidePreviews: boolean }`; `notificationPolicy.ts` consults it; new kind `chat.turn_completed`. |
| Types / client | `packages/shared/src/types/Push.ts`; `api.auth.devices.notificationPrefs()` / `setNotificationPrefs()`. |
| Server files | `auth.ts`, `notificationPolicy.ts`, `PushDispatcher.ts`, a digest scheduler in `packages/core`. |
| DB | `ALTER TABLE device_push_tokens ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'` (a JSON column; revoke cascade comes free). |
| Web/desktop | desktop notifications preference under Settings › General (04 §3.1). |
| When | **later** (MD-06) |

### MG-16 — Pause / resume all agents

| | |
|---|---|
| Needs | Control Center control and Quick Settings tile "Pause agents · 3 running" / "Agents paused · Tap to resume" / "Server offline". |
| Boards | MWidgets, MNotifications (Android QS row) |
| Current state | No global pause: only per-entity controls (`POST /chats/:id/cancel`, `chats.ts:717`; `POST /workflow-runs/:id/pause`, `workflowRuns.ts:144`). Running count exists (`AttentionCounts.running`). |
| Proposed API | `GET/PUT /api/system/agents/pause { paused: boolean }` → `{ paused: boolean; pausedAt?: string; running: number }` (semantics to decide: block new turns and run starts; drain-pause runs). Scope `admin:settings`. |
| Types / client | `AgentsPauseState` in shared; `admin.systemAdmin.agentsPause()` / `setAgentsPause()`. |
| Server files | `apps/server/src/routes/system.ts`, chat/run services. |
| DB | settings JSON file `apps/server/src/settings/agentsPause.ts` (no migration). |
| Web/desktop | desktop tray item and a Home control. |
| When | **later** (MD-06) |

### MG-17 — Dictation language

| | |
|---|---|
| Needs | Settings › Audio "Language" and the language used by server-side dictation. |
| Boards | MSetAudio, MComposerVoice |
| Current state | `AudioPreferences` has `sttEngine, textFormatter, endpointSilenceMs, interimResults, ttsEnabled, ttsVoice, ttsSpeed` — no language (`apps/server/src/settings/audio.ts:31-48`, persisted in `audio.json`); routes `GET/PUT /system/audio` (`apps/server/src/routes/system.ts:311,319`), model `GET/POST/DELETE /system/audio/model` (`:339,356,404`). |
| Proposed API | Additive field `sttLanguage?: string` (BCP-47 or `'auto'`) on `GET/PUT /system/audio`; `GET /system/audio/model` adds `languages: string[]` supported by the installed model. |
| Types / client | shared audio settings type + `admin.systemAdmin.audio()` / `setAudio()` (MG-22). |
| Server files | `apps/server/src/settings/audio.ts`, `system.ts`, the STT engine adapter that receives the language. |
| DB | none (`audio.json`). |
| Web/desktop | desktop Settings › Audio row. |
| When | **now — M7** — built in M7-09 |

### MG-18 — Server log tail and diagnostics export

| | |
|---|---|
| Needs | "Server log" and "Export diagnostics" in Settings › Diagnostics from a remote client. |
| Boards | MSetDiagnostics |
| Current state | No route: nothing under `apps/server/src/routes/*.ts` serves logs or a diagnostics bundle; desktop reads the local log file through the main process (Help › View Logs). |
| Proposed API | `GET /api/system/logs?tail=500&level=` → `{ lines: {ts, level, msg}[] }` (secrets redacted by the logger's redaction rules); `POST /api/system/diagnostics/export` → artifact id downloadable via the artifact route. Scope `admin:settings`, `riskLevel: 'high'`. |
| Types / client | `ServerLogPage` in shared; `admin.systemAdmin.logs()` / `exportDiagnostics()`. |
| Server files | `system.ts`, logger ring buffer in `packages/shared/src/logging` (server side). |
| DB | none. |
| Web/desktop | web (remote browser) Diagnostics gets the same rows. |
| When | **later** (needs a redaction review) |

### MG-19 — Multi-server client support

| | |
|---|---|
| Needs | Several paired servers, a switcher, sessions and caches keyed by server id (MD-05). |
| Boards | MServers, MSidebar, MSetSecurity, MPairing, MHomeMore footer |
| Current state | Server side is ready: `/api/auth/server-info` returns a stable `serverId` (`identity.hostId`) and `serverName` (`auth.ts:120-145`); `probeServer(endpoint, {timeoutMs, expectedServerId})` returns `{status, latencyMs, serverName}` (`packages/client-runtime/src/connections.ts:314-364`). The mobile app keeps one session under one key (`apps/mobile/src/auth/stores.ts:211-228`, `MobileSessionStore` over `SecureStore`); `StoredSession` already carries `serverId` (`AuthenticatedClientRuntime.ts:25-36`). |
| Proposed API | No server change. |
| Types / client | `packages/client-runtime/src/serverRegistry.ts` (new): `interface PairedServer { serverId; name; endpoint; endpoints?; addedAt; lastUsedAt }`, `createServerRegistry(storage: KeyValuePort): { list(); get(id); add(s); remove(id); current(); setCurrent(id) }`. Session storage keyed `session:<serverId>`; one `AuthenticatedClientRuntime` per server, only the current one streams, others are probed; TanStack query keys are prefixed with the server id; MMKV persister per server. |
| Server files | none. |
| DB | none. |
| Web/desktop | desktop's backend switcher (G-03, Electron main) keeps its own list; web is single-origin. |
| When | **now — M5** — built in M2-08 |

### MG-20 — Shared deep-link module and attention routing

| | |
|---|---|
| Needs | One allowlist and resolver shared with desktop (MD-34); a `server` key for multi-server links; an `AttentionItem → route` helper for notifications, widgets, Live Activities and Home rows. |
| Boards | all entry points (§1.6 of `04-screen-map.md`) |
| Current state | `DEEP_LINK_QUERY_KEYS = ['pair','dock','tab','kind','run']`, `deepLinkToRoute`, `resolveDeepLink` live in `apps/desktop/src/main/deep-link-route.ts:22-110` (Electron-free already). `DEEP_LINK_COMMAND_IDS` / `isDeepLinkCommandId` are shared (`packages/shared/src/ui-contract/commands.ts:149-155`). Mobile has no link handler beyond file routing (no `+native-intent`). `AttentionItem.href` is already a web path (`packages/shared/src/types/Attention.ts:69-88`; runs → `/workflows/<wid>/runs/<rid>`, `packages/core/src/services/AttentionService.ts:828`). No attention-to-route helper exists in client-core. |
| Proposed API | No server change. |
| Types / client | `packages/shared/src/ui-contract/links.ts` (new): `DEEP_LINK_PROTOCOL`, `DEEP_LINK_QUERY_KEYS = ['pair','dock','tab','kind','run','server','code']`, `deepLinkToRoute(url)`, `resolveDeepLink(url): DeepLinkTarget` (same behaviour as desktop plus the two keys). Desktop keeps its local copy until the owner merges (MD-34). `packages/client-core/src/attention/route.ts` (new): `routeForAttention(item: AttentionItem, opts: {serverId: string; prefer: 'page'\|'sheet'}): string` — `sheet` maps `tool_permission` / `question` asks to `/chats/<id>/gate/<askId>` and `stage_approval` to `/workflows/<wid>/runs/<rid>/approval/<askId>`; otherwise `item.href`; appends `server=`. |
| Server files | none. |
| DB | none. |
| Web/desktop | desktop imports the shared module at merge; the palette and sidebar can use `routeForAttention`. |
| When | **now — M5** — built in M2-09 |

### MG-21 — Platform-neutral artifact download

| | |
|---|---|
| Needs | Download chat attachments and artifacts on Hermes, which has no `Buffer`. |
| Boards | Main (attachment chips), MPaneFiles, MPaneBrowser (captures) |
| Current state | `IPlatformClient.downloadArtifact(id): Promise<{ data: Buffer; mimeType; name }>` (`packages/shared/src/types/IPlatformClient.ts:108`); the web implementation returns `new Uint8Array(arrayBuffer) as unknown as Buffer` (`apps/web/src/platform/HttpPlatformClient.ts:592-613`). |
| Proposed API | No server change (`GET /api/artifacts/:id/download`). |
| Types / client | Additive client-core method `api.artifacts.download(id): Promise<{ bytes: Uint8Array; mimeType: string; name: string }>`; mobile never calls `IPlatformClient.downloadArtifact`. The `Buffer` type in `IPlatformClient` is left unchanged (append-only interface) and logged in `COORDINATION.md` for the owner to retype to `Uint8Array` at merge. |
| Server files | none. |
| DB | none. |
| Web/desktop | web can switch to the client-core method (drops its cast). |
| When | **now — M6** — built in M2-10 |

### MG-22 — Typed client-core wrappers for existing routes

Mobile has 79 hand-written `/api` paths in 31 files (`research/code-audit.md` §0). M2 moves the ones client-core already covers; the routes below exist on the server but have **no** typed client-core method yet. Each is added to `createApiClient` (reads and chat-scoped writes) or `createAdminApi` (settings and admin writes), with a Vitest contract test. No server change.

| Route (verified) | Client method to add | Used by | Phase |
|---|---|---|---|
| `GET /chats/:id/background-tasks/:taskId` (`chats.ts:1012`) | `api.chats.backgroundTask(id, taskId)` | MPaneTaskDetail | M6 |
| `POST /chats/:id/plans/:planId/comments` (`chats.ts:1162`) | `api.chats.addPlanComment(id, planId, body)` | MPanePlan | M6 |
| `PUT /chats/:id/plans/:planId/content` (`chats.ts:1116`) | `api.chats.savePlanRevision(id, planId, {content, expectedRevision})` | MPanePlan | M6 |
| `GET /workspaces/:id/scm/readiness`, `POST …/scm/flow`, `POST …/scm/generate`, `POST …/scm/conflicts/{start,continue,abort,resolve-with-agent}` (`workspaces.ts:346-486`) | `api.workspaces.scm.readiness/flow/generate/conflicts.*` | MPaneOpen, MPaneCommit | M6 |
| `GET /projects/:id/codebases/:cid/branches` (`projects.ts:394`) | `api.projects.codebaseBranches(id, cid)` | MNewChatMore, MCodebase | M6 |
| `GET /fs/dirs?path=`, `GET /fs/git-info` (`apps/server/src/routes/fs.ts:46,95`; limited to local or administrative sessions, so a device without an admin scope shows the S state, MD-30) | `admin.fs.dirs(path)`, `admin.fs.gitInfo(path)` | MNewChatMore ("Add server folder"), MProjectCreate, MAddCodebase | M6 |
| `GET /projects/:id/pull-requests` (`projects.ts:1041`), `GET …/codebases/:cid/pull-requests/:number` (`:1088`), `…/files` (`:1115`), `…/comments` (`:1130`), `POST …/review-chat` (`:1149`) | `api.projects.pullRequests(id)`, `pullRequest(id, cid, n)`, `pullRequestFiles`, `pullRequestComments`, `reviewPullRequestInChat` | MProjectDetail PR tab, PR detail | M7 |
| codebase files + content routes used by `app/projects/[id]/codebases/[cid]/files.tsx` | `api.projects.codebaseFiles(id, cid, path)`, `codebaseFileContent(id, cid, path)` | MCodebaseFiles | M7 |
| `GET /agents/:id` (`agents.ts:80`) | `api.agents.get(id)` | MAgentDetail | M7 |
| `GET/PUT /system/audio` (`system.ts:311,319`), `GET/POST/DELETE /system/audio/model` (`:339,356,404`) | `admin.systemAdmin.audio/setAudio/audioModel/downloadAudioModel/deleteAudioModel` | MSetAudio | M7 |
| `PUT /system/mcp-servers/system/:id` (`system.ts:243`), `POST/PUT/DELETE /system/mcp-servers/custom[/:id]` (`:176,200,223`) | `admin.systemAdmin.setSystemMcp`, `addCustomMcp`, `updateCustomMcp`, `removeCustomMcp` | MSetMcp, MSetMcpAdd | M7 |
| `POST /source-control/accounts/device/start`, `GET /source-control/accounts/device/:loginId` (`apps/server/src/routes/sourceControl.ts:231,258`) | `api.sourceControl.startDeviceLogin()`, `deviceLogin(loginId)` | MSetSourceControl, MPaneCommit | M7 |
| `PUT /auth/push-token`, `DELETE /auth/push-token`, `PUT /auth/push-token/mute` (`auth.ts:570,617,626`) | `api.auth.pushToken.set/remove/mute` | notifications, MSetSecurityMore | M6 |
| `GET /health`, `GET /health/config` (`apps/server/src/routes/health.ts:132`, mounted `routes/index.ts:117`) | `api.health.get()`, `api.health.config()` | MSetDiagnostics | M7 |
| `GET /api/artifacts/:id/download` | `api.artifacts.download(id)` (MG-21) | attachments | M6 |

Workflow run control (`admin.runs.pause/resume/retry/cancel`, `admin.ts:332-335`), automation writes, browser/computer/terminal admin methods already exist in `createAdminApi`; mobile calls them directly (the server's scope policy decides). **When: now — M6/M7**: the chat and pane wrappers are built in M2-10, the settings and projects wrappers in M7-09; a wrapper found missing later lands in the first task that needs it.

### MG-23 — Scope labels, sensitivity and named presets

| | |
|---|---|
| Needs | Human labels and a "Sensitive" mark for each scope, and the named presets drawn in Pair a device, shared by mobile and desktop. |
| Boards | MScopeRequest, MSetPairDevice, MSetSecurity, MSetBrowserTerminal |
| Current state | `SCOPES` has 24 entries with no labels (`packages/auth/src/scopes.ts:9-45`); sensitivity is a separate list `HIGH_RISK_SCOPES` (`:142-149`); presets are constants `DEFAULT_DEVICE_SCOPES` (`:68`), `DEFAULT_MOBILE_SCOPES` (`:89`), `STANDALONE_MOBILE_SCOPES` (`:111`), `DEFAULT_CLI_SCOPES` (`:122`). Labels live only in the mobile app (`apps/mobile/src/auth/scopeLabels.ts:14-60`). The board's presets "Recommended for platform" and "Read only" have no constants. |
| Proposed API | No server change (the scope list already comes from `/api/auth/server-info` `scopes`). |
| Types / client | `packages/shared/src/ui-contract/scopes.ts` (new): `SCOPE_LABELS: Record<string, {label: string; description: string}>`, `isSensitiveScope(id)` (mirrors `HIGH_RISK_SCOPES`), `SCOPE_PRESETS: {id: 'companion'\|'standalone'\|'device'\|'cli'; label: string; scopes: readonly string[]}[]` built from the four existing constants; a unit test asserts the label keys equal `SCOPES`. Mobile deletes `scopeLabels.ts`. Presets without a constant are not offered. |
| Server files | none. |
| DB | none. |
| Web/desktop | desktop Settings › Security pairing and request approval use the same labels. |
| When | **now — M7** — built in M7-09 |

### MG-24 — Element pick on the server-side browser

| | |
|---|---|
| Needs | "Tap an element to comment" on the streamed, view-only browser (MD-37). |
| Boards | MPaneBrowser |
| Current state | Web comments are client-side picks (`apps/web/src/blocks/browser/browserAnnotations.ts`) from the desktop `WebContentsView` inspector. The server has an inspector toggle (`POST /workspaces/:id/browser/actions {kind: 'inspector', on}`, `apps/server/src/routes/browser.ts:60,195`), user input `POST …/browser/input` (`:460`) and an internal selection sink `POST …/browser/selection` (`:214`) that the inspector script posts to. Whether a selection reaches a remote client is unverified. |
| Proposed API | Spike in M6: inspector on + `input` tap at (x, y) → selection. If the selection is not delivered to the requesting client, add `POST /api/workspaces/:id/browser/pick { x: number; y: number; viewport: {width, height} }` → `200 BrowserInspectorSelection` (synchronous element-at-point in the headless page). Scope `exec:browser`. |
| Types / client | reuse `BrowserInspectorSelection`; `admin.browser.pick(workspaceId, body)`. |
| Server files | `browser.ts`, the browser service in `packages/core`. |
| DB | none. |
| Web/desktop | the web client on a headless stream (no Electron inspector) gets comments the same way. |
| When | **now — M6 (spike-gated; if the spike fails, comment mode is not rendered)** — built in M2-10 |

### MG-25 — Storage breakdown and retention dry-run

| | |
|---|---|
| Needs | GeneratorAI total, per-project sizes, orphaned size, "23 workspaces · 4.2 GB" before cleaning. |
| Boards | MSetStorage |
| Current state | `SystemInfo.disk {usedBytes, totalBytes}` for the data directory only (`apps/server/src/routes/system.ts:82-96,110-135`); per-codebase worktree sizes via G-17; `POST /system/workspace-retention/run` has no dry-run (`system.ts` retention handlers). |
| Proposed API | `GET /api/system/storage` → `{ generatorBytes; workspaces: number; orphanedBytes; projects: {id, name, bytes}[] }` (computed with `fs.promises` walks, cached 5 min); `POST /system/workspace-retention/run { dryRun: true }` → `{ wouldRemove: number; bytes: number }`. |
| Types / client | `StorageSummary` in shared; `admin.systemAdmin.storage()`. |
| Server files | `system.ts`, workspace services. |
| DB | none. |
| Web/desktop | desktop Settings › Storage. |
| When | **later** |

### MG-26 — `SystemInfo` runtime version and update availability

| | |
|---|---|
| Needs | "Runtime Node.js 24" (General) and "Server and app up to date" (Diagnostics). |
| Boards | MSetGeneral, MSetDiagnostics |
| Current state | `SystemInfo` (`packages/shared/src/types/SystemInfo.ts`, route `system.ts:110`) has `platform` (the OS) but no runtime; no update-check API (desktop's G-04 is IPC-only). |
| Proposed API | Additive `SystemInfo.runtime?: {name: 'node'; version: string}` and `SystemInfo.update?: {available: boolean; version?: string}`. |
| Types / client | shared type fields; `api.system.info()` unchanged. |
| Server files | `system.ts`, the update checker. |
| DB | none. |
| Web/desktop | web Diagnostics rows. |
| When | **later** |

### MG-27 — Restart the server remotely

| | |
|---|---|
| Needs | "Restart server" after changing network exposure. |
| Boards | MSetSecurity |
| Current state | Restart is desktop IPC only (`window.generatoraiDesktop.restartServer`); `pendingRestart` is reported by `GET /security/network-access`. |
| Proposed API | `POST /api/system/restart` (`admin:settings`, `riskLevel: 'high'`), handled by the process supervisor on each OS. |
| Types / client | `admin.systemAdmin.restart()`. |
| Server files | `system.ts`, supervisor/desktop main coordination. |
| DB | none. |
| Web/desktop | web Settings › Security. |
| When | **later** (MD-35: hidden; the callout says "Restart required on the server") |

### MG-28 — Run-pane tab contract

| | |
|---|---|
| Needs | Tab ids and `?dock=` values for the run pane: Output, Files, Hooks, Variables, Changes, Terminal, Browser. |
| Boards | MWorkflowRunPane |
| Current state | `DOCK_TAB_TYPES` / `DOCK_LINK_TABS` cover chat tabs only (`packages/shared/src/ui-contract/pane.ts:15-54`); the desktop run page keeps its legacy RightPane until PW (D-65). |
| Proposed API | WO defines `RUN_DOCK_TABS` and `parseRunDockLinkTab()` in `ui-contract/pane.ts` (additive) with the run page (P03b WP-3b.2). Until then the mobile run pane shows Changes, Files, Terminal, Browser. |
| When | **WO — P03b** |

### MG-29 — Sequential run number

| | |
|---|---|
| Needs | "Run #248" on the run header, chat run cards, Home, notifications and Live Activities. |
| Boards | MWorkflowRun, MWorkflowRunMenu, MChatWorkflowRun, MLiveActivity, MHome |
| Current state | No run number: run ids are UUIDs; `WorkflowRun.version` is an optimistic-lock counter (`packages/shared/src/types/WorkflowRun.ts:147`); not in the WO plan (`research/boards-workflows.md` §C). |
| Proposed API | `WorkflowRun.number: number` per definition (unique `(workflow_definition_id, run_number)`). Owned by WO (workflow tables are WO-owned). Mobile shows the start time instead of `#n` until it lands. |
| When | **WO — request to add** |

### MG-30 — Template categories

| | |
|---|---|
| Needs | Review / Loops / Fan-out / Gated filters in New workflow. |
| Boards | MWorkflowNew |
| Current state | templates carry no category (`admin.templates.list`, `admin.ts:891`); G-24 brings 18 templates (P05) without categories. |
| Proposed API | `category` on the template model (WO). Filters are not rendered until then. |
| When | **WO — request to add (P05)** |

### MG-31 — Per-stage tokens / cost and context %

| | |
|---|---|
| Needs | Stage usage meter, "$" budget, per-stage context gauge. |
| Boards | MWorkflowRun, MWorkflowRunPane, MStagePolicyMore |
| Current state | none; G-23 (budget meter) and G-29 (cost) are WO (`docs/redesign/05-gap-matrix.md:632,638`). |
| When | **WO — P03 / P07** |

### MG-32 — Structured-output presentation hints

| | |
|---|---|
| Needs | Rendering a stage's JSON output as a table with named columns ("Risk"). |
| Boards | MWorkflowRunPane |
| Current state | `outputData` + `outputSchema` exist; no presentation hints. Mobile renders arrays of flat objects as a table and everything else as a key/value tree without hints. |
| When | **WO — request to add** |

### MG-33 — Validation quick-fix payloads

| | |
|---|---|
| Needs | "Declare", "Replace", "Go to" buttons on validation issues. |
| Boards | MWorkflowValidate |
| Current state | `POST /workflow-definitions/:id/validate` (`admin.definitions.validate`, `admin.ts:268`); G-28 issue shape has no `fix`. |
| When | **WO — P01 (G-28)** |

### MG-34 — Risk flags on workflow approvals

| | |
|---|---|
| Needs | Server-decided risk for stage approvals (MD-31) and draft risk chips. |
| Boards | MRunApproval, MChatWorkflowRun, MWorkflowAgentDraft |
| Current state | none; P06 plans risk flags (`describe_workflow`, G-25). Until it lands every workflow approval is treated as risky (MD-31). |
| When | **WO — P06 (G-25)** |

### MG-35 — Multi-file skill listing

| | |
|---|---|
| Needs | "3 files · 2.1 KB" and file Chips on Skill detail. |
| Boards | MSkillDetail |
| Current state | `ProjectConfig` has one `filePath` + `metadata`; `GET /projects/:id/available-artifacts` (`admin.projects.availableArtifacts`, `admin.ts:458`) is unverified for file listings. |
| Proposed API | Verify `available-artifacts` first; if it lacks files, `GET /api/projects/:id/configs/:configId/files` → `{files: {path, bytes}[]}`. Single file shown until then. |
| When | **later** |

### MG-36 — Orchestrator wave and worker limit on the wire

| | |
|---|---|
| Needs | "Wave 2 · 4 of 4 workers" on the Tasks summary. |
| Boards | MPaneTasks |
| Current state | DB columns `orchestrator_wave_count`, `orchestrator_started_at` exist (`packages/db/src/migrations/index.ts:2129-2130`) but are not on the shared `Chat` type; desktop withholds the same fields (D-69). |
| Proposed API | `Chat.orchestrator?: { wave: number; maxWorkers: number; startedAt: string }` on `GET /chats/:id`. |
| When | **later** (joint with desktop) |

### MG-37 — Live tool-output tail for a running step

| | |
|---|---|
| Needs | While a shell or long tool step runs, the step detail (and the running tool block's current-step sub-row) shows the last lines of its output as they arrive ("running (live tail)"). |
| Boards | MChatStepDetail, MChatRunning, MChatToolsExpanded |
| Current state | Tool output reaches clients only on completion (`ToolCallBlock.result`). The Copilot mapper does emit per-chunk output (`tool.execution_partial_result`) inside `harness.session_info`, but `EventBus.isNoiseEventKind` suppresses it and no client reads it (`packages/shared/src/types/eventClass.ts:298-312`). The desktop inventory records the same gap (`docs/redesign/03-component-inventory-domain.md` B-23 BackgroundStepTail). |
| Proposed API | A stream event `tool_call.output_delta { callId, chunk, seq }` on the chat stream for every harness that can produce partial output, rate-limited server-side; the full output stays on `ToolCallBlock.result`. |
| Types / client | Additive event type in `packages/shared/src/types/AgentEvent.ts`; the client-core transcript reducer keeps a bounded tail (last 4 KB) per `callId`. |
| Server files | harness mappers in `packages/core` (Copilot first), `EventBus` noise filter (stop dropping the chunk kind once it is typed), the chat stream route. |
| DB | none (tails are not persisted). |
| Web/desktop | Desktop B-23 BackgroundStepTail uses the same event. |
| When | **later** (joint with desktop). Until then the running step shows "Output arrives when the command finishes" (MB-14). |

### MG-38 — "Always allow" on permission gates

| | |
|---|---|
| Needs | The boards draw "Always allow" / "Always allow in this chat" on the permission gate card. |
| Boards | Main, MComponents (gate cards) |
| Current state | `GATE_ACTIONS.permission` offers `deny`, `allow_once`, `cancel_deny` and `confirm_deny` only (`packages/shared/src/ui-contract/gates.ts:65`); `ToolPermissionResolution` is `{ behavior: 'allow' \| 'deny'; message? }` (`packages/shared/src/types/AgentMode.ts:397`). There is no remembered permission rule for a chat. |
| Proposed API | `ToolPermissionResolution.remember?: 'chat'` on `POST /chats/:id/interactions/:iid/permission`, stored as a per-chat rule the harness consults; `GATE_ACTIONS.permission` gains an `allow_always` id. Risky gates (MD-31) never accept `remember`. |
| Types / client | Additive optional field and action id in `packages/shared`; `api.chats.respondPermission` passes it through. |
| Server files | `apps/server/src/routes/chats.ts` (permission route), the permission handling in `packages/core`, `openapi.ts`. |
| DB | none (chat settings JSON). |
| Web/desktop | GateCard on web shows the same action once it exists. |
| When | **later** (MD-55: not rendered until the server exposes it). |

---

## 3. Checked — no gap

Items the design or the research flagged, verified to already exist. Mobile builds only UI for them.

| NG | Item | Evidence | Client call |
|---|---|---|---|
| NG-01 | Scope requests (create, own list, cancel; admin approve with a subset, deny) | `apps/server/src/routes/scopeRequests.ts:84,122,138,164,185,215` | `api.auth.scopeRequests.create/mine/cancel`; `admin.devices.scopeRequests.listPending/approve/deny` (`admin.ts:1030-1047`) |
| NG-02 | Webhook one-time reveal | `POST /automations/:id/rotate-webhook-token` (`apps/server/src/routes/automations.ts:300`); `webhookToken`/`webhookSecret` returned only by create and rotate (`packages/shared/src/types/Automation.ts:206-217`) | `admin.automations.rotateWebhookToken(id)`, `admin.automations.create` |
| NG-03 | Weekly stats with averages | `StatsRunsSummary.avgDurationMs`, `medianDurationMs`, `successRate` (absent when 0/0) (`packages/shared/src/types/StatsSummary.ts:39-51`) | `api.stats.summary({from, to})` |
| NG-04 | Per-workflow 30-day success and last run | `StatsByDefinitionRow {definitionId, lastRun, successRate}` with `groupBy=definition` (`StatsSummary.ts:61-66`) | `api.stats.summary({from, to, groupBy: 'definition'})` |
| NG-05 | Per-chat capability overrides | `Chat.agentOverrides` (`Chat.ts:171`), `CreateChatParams.agentOverrides` (`CreateChatParams.ts:227`), `AgentOverrides` (`Agent.ts:165-176`); applied at create, frozen at session start | `api.chats.create({agentOverrides})` |
| NG-06 | Provider sign-in / sign-out / default | `POST /harness/providers/:type/login` → `{authUrl?, loginId?, completed?}` (409 `UNSUPPORTED` when the provider has no in-app sign-in), `/logout`, `POST /harness/switch` (`apps/server/src/routes/harness.ts:100,122,172`; `HarnessCatalog.ts:84-90`) | `api.harness.login/logout/setDefault` (`client.ts:985-999`); open `authUrl` with `WebBrowser.openAuthSessionAsync`, then `api.harness.providers(true)` |
| NG-07 | Server identity for multi-server | `serverId`, `serverName` in `/api/auth/server-info` (`auth.ts:120-145`) | `probeServer` (G-03) |
| NG-08 | Keep / Unkeep / Keep all / Undo all | `POST /workspaces/:id/changes/review`, `…/changes/discard` | `api.workspaces.reviewChanges`, `discardChanges` (`client.ts:1451,1471`) |
| NG-09 | Commit message generation, push, PR, conflicts | `workspaces.ts:346-486` | MG-22 wrappers |
| NG-10 | Plan revisions, comments, decision | `chats.ts:1047,1082,1116,1162,1198` | `api.chats.plans/planContent/decidePlan` + MG-22 |
| NG-11 | Computer consent, pause, grants, runtime, audit | `apps/server/src/routes/computer.ts:352-558` | `admin.computer.*`, client-core `computer/` (G-07) |
| NG-12 | Answer questions / permissions from a notification | `chats.ts:1306,1341` | `api.chats.respond`, `respondPermission` |
| NG-13 | Time-sensitive interruption | `PushMessage.interruption` → `interruptionLevel` (`PushDispatcher.ts:61-75`, `ExpoPushProvider.ts:80`) | — |
| NG-14 | Attachments to an existing chat | `POST /chats/:id/prompt` multipart (5 × 10 MB) | `api.chats.sendWithAttachments` |
| NG-15 | Project PR data | routes at `projects.ts:1041-1149` | MG-22 wrappers |
| NG-16 | Default model, terminal/browser prefs, skill toggles | decided per device on mobile (MD-30), labelled "This device" | MMKV |

---

## 4. Landed desktop gaps mobile consumes (G-01 … G-20)

| G | What | Server route | Shared types | Client-core API mobile calls | Mobile screens |
|---|---|---|---|---|---|
| G-01 | Attention feed | `GET /api/attention` (`apps/server/src/routes/attention.ts:22`) + SSE `attention.upsert/remove/counts` | `AttentionSnapshot`, `AttentionItem`, `AttentionCounts` (`packages/shared/src/types/Attention.ts`) | `createAttentionStore(api, mux, {projectId?})` (`packages/client-core/src/attention/store.ts:102`); `selectNeedsYou`, `selectRunning`, `selectCounts`, `selectAttentionFor`, `selectAttentionByProject` | Home, Drawer, `/needs-you`, project banner, badges, widgets (MG-07) |
| G-02 | Chat list v2 | `GET /api/chats` (`chats.ts:467`), bulk archive/delete | `ChatListQuery`, `ChatListPage`, `ChatListItem`, `ChatListSummary` | `api.chats.list`, `archiveMany`, `removeMany`; `chatRowState`, `chatListKey`, `mergeChatListPages`, `chatListStreamFilter`, `chatListInvalidatedBy` (`packages/client-core/src/chats/listModel.ts`) | Chats |
| G-03 | Server reachability | `GET /api/auth/server-info` | `ServerReachability` | `probeServer(endpoint, {timeoutMs, expectedServerId})` (`packages/client-runtime/src/connections.ts:314`) | Servers, Drawer footer, Pairing |
| G-04 | Update state | IPC only | — | not consumed (desktop-only) | — |
| G-05 | Attention counts in the main process | IPC | — | not consumed; badge from `AttentionCounts` via MG-06 | — |
| G-06 | Transcript view mode | client-only (web store) | — | not consumed this pass | — |
| G-07 | Computer consent / control | `POST /workspaces/:id/computer/consent`, `/control` | `ComputerPendingConsent`, `ComputerControlState` (`packages/shared/src/types/ComputerUse.ts`) | `applyComputerEvent`, `consentAnswerOptions` (`packages/client-core/src/computer/`); `admin.computer.consent/setConsent/control/setControl` | Computer tab |
| G-08 | Deep-link allowlist | desktop | — | consumed through MG-20 | all links |
| G-09 | Model picker | `GET /api/harness/providers`, `GET /api/harness/models` | `HarnessProvidersResponse`, `HarnessProviderStatus`, `HarnessCatalogModel`, `MODEL_TIERS` | `api.harness.providers(refresh)`, `buildModelPickerCatalog` (`packages/client-core/src/models/pickerCatalog.ts:121`), `api.harness.login/logout/setDefault` | TurnSheet, pickers, Providers |
| G-10 | Stats summary | `GET /api/stats/summary?from&to&projectId&definitionId&automationId&groupBy` (`apps/server/src/routes/stats.ts:69`) | `StatsSummary` | `api.stats.summary(query)` (`client.ts:1721`) | Home "This week", Workflows, Workflow detail, Automation detail |
| G-11 | Recent activity | `GET /api/activity/recent` (`activity.ts:51`) | `RecentActivityPage`, `RecentActivityItem` | `api.activity.recent({since, limit, projectId})` (`client.ts:1745`) | Home |
| G-12 | System info | `GET /api/system/info` (`system.ts:110`) | `SystemInfo` | `api.system.info()` (`client.ts:1710`) | Home footer, General, Storage, Diagnostics |
| G-13 | Project summaries | `GET /api/projects?include=summary` | `Project.summary` | `api.projects.list/get({includeSummary: true})` (`client.ts:1573-1580`) | Projects, Project detail |
| G-14 | Project chats | `GET /api/chats?projectId=` | G-02 types | `api.chats.list({projectId})` | Project › Chats |
| G-15 | Project runs | `GET /api/projects/:id/runs` | `ProjectRunListItem`, `ProjectRunPage` | `api.projects.runs(id, {status, cursor, limit})` (`client.ts:1595`) | Project › Runs |
| G-16 | Codebase fetch + logs | `POST /projects/:id/codebases/:cid/fetch` → 202 `{jobId}` (`projects.ts:361`), `GET …/logs?limit=` (`:380`) | — | `api.projects.fetchCodebase(id, cid)`, `api.projects.codebaseLogs(id, cid, {limit})` (`client.ts:1609-1618`) | Project codebases, Codebase logs |
| G-17 | Worktree sizes and links | `GET …/worktrees?include=usage,link` (`projects.ts:717`) → `{items, totalBytes?, reclaimableBytes?}` | extended `WorktreeInfo` | `api.projects.codebaseWorktrees(id, cid, {include: ['usage', 'link']})` (`client.ts:1625`) | Codebase, Project settings impact |
| G-18 | Entity search | `GET /api/search?q&types&limit` (`apps/server/src/routes/search.ts:97`) | `SearchQuery`, `SearchResponse`, `SearchResult`, `SearchEntityType` | `api.search(query)` (`client.ts:1795`) | Search palette |
| G-19 | Per-project artifact prefs | `GET/PUT /projects/:id/artifact-prefs` (`projects.ts:631,642`) → `{disabled: [{type, id}]}` | — | `api.projects.artifactPrefs.get(id)` / `.update(id, prefs)` (`client.ts:1634-1638`) | Project › Customization |
| G-20 | Background-task cancel attribution | `POST /chats/:id/background-tasks/:taskId/cancel` (`chats.ts:1023`) | `BackgroundTaskListItem.cancelledBy/cancelledAt` | `api.chats.backgroundTasks(id)`, `api.chats.cancelBackgroundTask(id, taskId)` (`client.ts:1208-1224`) | Tasks tab, DelegationGroup |

---

## 5. Workflow-owned gaps (G-21 … G-29) and what mobile waits for

Built by the Workflow Overhaul (PW), not by the mobile pass. Mobile renders each element only after its phase lands (MD-04, MD-27); M8 tasks start with a check that the listed endpoints exist on `desktop_redesign` after the phase-start merge (MD-12).

| G | Element | Today | WO phase | Mobile boards waiting |
|---|---|---|---|---|
| G-21 | Versions, draft/publish, pinned runs, version history and diff, Draft/Published status | `workflow_definitions.version` integer (`workflowDefinitions.ts:73`) | P01 WP-1.6/1.7; diff/restore P07 WP-7.6 | MWorkflows, MWorkflowDetail(+More), MWorkflowNew, MBuilderList, MWorkflowAgentDraft |
| G-22 | Invocation: plan preview, per-run overrides, Test run, Setup/Finalize lifecycle, trigger | `POST /workflow-runs` (`workflowRuns.ts:36`), `POST /orchestrator/runs` (`orchestrator.ts:158`) | P04 WP-4.4 (WP-4.5 names mobile `StartRunSheet`) | MWorkflowLaunch, MWorkflowLaunchAdvanced, MWorkflowLaunchPlan, MWorkflowRun |
| G-23 | Engine v2 + SessionSpec: states, attempts, commands API, budget meter, per-run permission, stage composer, session reuse | pause/resume/retry/cancel/wake routes (`workflowRuns.ts:144-358`), permission mode (`:384,395`) | P02 WP-2.11, P03, P03b WP-3b.2 | MWorkflowRun, MWorkflowRunMenu, MRunStageChat, MStageModel, MStagePolicy(+More) |
| G-24 | Control-flow stages (loop, map, wait, check, sub-workflow), loop UI, decision card, 18 templates, Judge | `iterationConfig` stored, never executed | P05 WP-5A.5, WP-5A.6 | MRunLoop, MBuilderGraph (kinds), MBuilderLoop, MWorkflowNew (loop templates), MStageOutput (Judge), MWorkflowSettings (list/json) |
| G-25 | Workflow tools in chat: run/approval/draft cards, Tasks sections, composer Workflows toggle, agent-draft banner | MCP `generatorai_run_workflow` only | P06 WP-6.1/6.2/6.5 | MChatWorkflowRun, MComposerPlus (MG-14), MWorkflowAgentDraft (MG-34) |
| G-26 | Automations: dataset rows + schema, required permission, next-runs preview, trigger chip | input modes, `nextRunAt`, test-data-source (`automations.ts:199`) | P01 WP-1.6 (PD-8), P02 (PD-18) | MAutomationCreate2 (preview), MAutomationCreate3 (dataset schema), drafts (MG-10) |
| G-27 | Scripts compiled to a keyed graph with a loop; materialize as draft; `write:workflows` gate | `POST /workflow-scripts/:id/materialize`, `/run` (`workflowScripts.ts:100,194`) | P01, P05 | MScriptDetail |
| G-28 | Validation problems with codes and quick fixes | `POST /workflow-definitions/:id/validate` (`workflowDefinitions.ts:207`) | P01 | MWorkflowValidate (MG-33) |
| G-29 | Cost display with tokens-only fallback; budget in $ | — | P07 | MWorkflowRun, MWorkflowRunPane (MG-31) |

Not in the WO plan and requested from it by this file: MG-29 (run number), MG-30 (template categories), MG-32 (output presentation hints); MG-10 (automation drafts) and MG-33 (quick-fix payloads) are asked as sub-items of G-26 and G-28.

---

## 6. Order of work

A gap is built in the task named here, API-first with its tests, before the screen task that renders it (`07-phases.md`).

| Phase | Task | Gaps built first (API + tests before the screens) |
|---|---|---|
| M2 | M2-08 | MG-19 (multi-server runtime and registry) |
| M2 | M2-09 | MG-20 (shared deep-link module and `attentionItemRoute`) |
| M2 | M2-10 | the server gaps M5 and M6 need: MG-06 part A, MG-02, MG-03, MG-04, MG-05, MG-21, MG-22 (chat and pane rows), MG-24 spike |
| M7 | M7-09 (first task of M7) | MG-01, MG-11, MG-12, MG-13, MG-17, MG-22 (settings and projects rows), MG-23 |
| M8 | M8 entry check | none new; checks that the WO phases for G-21 … G-29 (MG-10, MG-14, MG-28 … MG-34) have landed |
| M9 | M9-01, M9-02, M9-08 | MG-07 (M9-01), MG-06 part B (M9-02), MG-09 (M9-08) |
| later | — | MG-08, MG-15, MG-16, MG-18, MG-25, MG-26, MG-27, MG-35, MG-36, MG-37, MG-38 |
