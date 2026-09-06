# 03 — Server / shared-package API surface for a mobile client

Scope: `apps/server`, `apps/relay`, `packages/auth`, `packages/relay-protocol`, `packages/client-core`, `packages/client-runtime`, `packages/client-transport`, `packages/shared`, `packages/changes`, `packages/checkpoints`, host apps (`apps/pty-host`, `apps/browser-host`, `apps/cua-host`). UI code in `apps/mobile/src` and `apps/web` deliberately NOT read.
All paths are relative to `C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI`. Branch `arch-redesign`, 2026-09-06.

---

## 0. Headline findings (read this first)

1. **Auth is per-device DPoP, not a shared key.** Every route resolves a `Principal` with a scope list; transport (loopback/LAN/relay) never grants authority (`packages/auth/src/scopes.ts:1-8`, `AuthService.ts:1-20`).
2. **Mobile has an explicit default grant** (`DEFAULT_MOBILE_SCOPES`, `packages/auth/src/scopes.ts:80-93`): read everything, `write:chats`, `write:reviews`, `stream:events`, `exec:agent`. It deliberately **excludes** `write:workflows`, `write:projects`, `write:workspaces`, `write:files`, `exec:terminal`, `exec:browser`, `exec:computer`, and all `admin:*`. An admin can widen it per device via `PUT /api/auth/devices/:id/scopes`.
3. **Relay is not usable by a client today.** `POST /api/auth/pair` returns `409 RELAY_CLIENT_UNAVAILABLE` whenever `includeRelay:true` (`apps/server/src/routes/auth.ts:333-342`); `/server-info` hard-codes `transports.relay: false` (`auth.ts:139`); `packages/client-transport` ships only `DirectTransport` (no relay adapter); `e2ee.ts` is not wired into any transport (`packages/relay-protocol/src/index.ts:7-10`). Off-LAN mobile therefore requires a reachable https origin (`GENERATORAI_ADVERTISED_URL`) or a VPN.
4. **Live streams a phone can attach to over plain HTTP/WS:** unified SSE (single-scope or multiplexed), STT/TTS WebSockets, terminal WebSocket (needs `exec:terminal`), browser live-view WebSocket (needs `exec:browser`), computer preview (needs `exec:computer`). All go through `authorizeWebSocketUpgrade` and accept either a DPoP header or a 30-second single-use ticket (`apps/server/src/middleware/wsAuth.ts`).
5. **Push exists and is mobile-specific**: `PUT/DELETE /api/auth/push-token`, `PUT /api/auth/push-token/mute` (Expo/APNs/FCM), dispatcher in `packages/core/src/services/push/PushDispatcher.ts`. Only three event families produce a notification; **tool-permission prompts (`chat.permission.requested`) do not push** (`notificationPolicy.ts:80-175`).
6. **Attachments**: `POST /api/chats/:id/prompt` is multipart, 10 MB/file, max 5 files (multer `files: 5` but `upload.array('attachments', 10)` — the multer limit wins) (`routes/chats.ts:25-27,368-371`). Mobile's capability ledger declares `fileAttachment: enforced(false)` because the app has no picker (`packages/shared/src/transport/TransportCapabilities.ts:289-321`).

---

## 1. Route table (every mounted router; `/api` prefix implied)

Scope column is what `packages/auth/src/routePolicy.ts` requires, resolved by longest-prefix match; GET/HEAD/OPTIONS use `read`, everything else `write`. Un-listed prefixes fail closed to `admin:settings` (`DEFAULT_POLICY`). Mounted in `apps/server/src/routes/index.ts`; WebSockets are attached in `apps/server/src/index.ts:663-691`.

Legend: **[SSE]** server-sent events, **[WS]** WebSocket upgrade, **[MUX]** multiplexed SSE, **[PUB]** public.

### 1.1 Auth / pairing / devices — `routes/auth.ts`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/auth/server-info` | PUB | Host identity: `serverId` (X25519 hostId), `serverPublicKey`, `tokenPublicJwk`, `protocolVersion:2`, `authentication{required,dpopRequired:true,legacyApiKeyAccepted}`, `transports{loopback,lan,privateNetwork,relay:false}`, `endpoints[]`, `scopes[]` (`auth.ts:119-146`) |
| POST | `/auth/nonce` | PUB | 204 + `DPoP-Nonce` header for clock-skewed clients |
| POST | `/auth/pair/preview` | PUB | `{pairingToken}` -> `{serverId,serverPublicKey,serverName,endpoints,deviceNameHint,platform,requestedScopes,expiresAt}`; non-consuming, throttled (10/min/source, 60/min global) |
| POST | `/auth/pair/complete` | PUB + DPoP proof | `{pairingToken, publicJwk, deviceName?, platform?, connectionMode?}` -> `DeviceSessionResult {deviceId,deviceName,scopes,accessToken,accessTokenExpiresAt,resumeSecret,resumeExpiresAt,credentialVersion}` (201) |
| POST | `/auth/token/refresh` | PUB + DPoP proof | `{resumeSecret}` -> new session; resume secret rotates each use |
| POST | `/auth/pair` | `admin:devices` | Create grant: `{deviceName, platform:'web'\|'desktop'\|'cli'\|'mobile'\|'other', scopes?, ttlMs?(30s-10m), includeRelay?}` -> `{grantId,expiresAt,shortCode,joinUrl,pairingCode(QR blob),pairingUrl(generatorai://pair?...),requestedScopes,serverId}`. `includeRelay:true` => 409 today |
| GET | `/auth/pair/pending` | `admin:devices` | List pending grants |
| DELETE | `/auth/pair/:grantId` | `admin:devices` | Revoke grant |
| GET | `/auth/devices` | `admin:devices` | List devices (`?includeRevoked=true`) |
| GET | `/auth/devices/:deviceId` | `admin:devices` | One device |
| PATCH | `/auth/devices/:deviceId` | `admin:devices` | Rename |
| PUT | `/auth/devices/:deviceId/scopes` | `admin:devices` | Replace scopes; cannot exceed caller's; high-risk grants audited critical |
| POST | `/auth/devices/:deviceId/rotate` | `admin:devices` | Rotate credentials |
| DELETE / POST | `/auth/devices/:deviceId` / `.../revoke` | `admin:devices` | Revoke (POST alias "for the mobile app's historical call shape", `auth.ts:557-560`) |
| PUT | `/auth/push-token` | `read:status` (own device only) | `{provider:'expo'\|'apns'\|'fcm', token(<=512), platform}`; 403 if principal is not `paired-device`; 501 if `GENERATORAI_PUSH=0` |
| DELETE | `/auth/push-token` | `read:status` | Remove own token |
| PUT | `/auth/push-token/mute` | `read:status` | `{mutedUntil: epochMs\|null}`; approvals ignore mute |
| GET | `/auth/audit` | `admin:settings` | Security audit log (`?limit<=500,action,deviceId,since`) |

### 1.2 Streaming — `routes/stream.ts` (mounted only if `config.streaming.enabled`)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/stream/tickets` | `stream:events` + per-scope | `{scope, id?}` -> `{ticket, expiresAt}` (30 s, single-use). Scopes: `session,run,chat,global,automation,workspace` (SSE) or `terminal,browser,stt,tts` (socket). Socket tickets require the socket's own scope (`exec:terminal`, `exec:browser`, `write:chats`, `read:chats`); cannot be minted by a ticket/signed-link principal (`stream.ts:196-268`) |
| POST | `/stream/connections` | `stream:events` + per-sub | **[MUX]** `{subs:[{scope,id,filter?}], cursors?:{[scopeKey]:seq}}` -> `{connectionId, ticket, expiresAt, maxSubscriptions:32}`; 8 connections/principal, 60 s unattached TTL (`streamConnectionRegistry.ts:37-49`) |
| POST | `/stream/connections/:id/subs` | `stream:events` + per-sub | **[MUX]** `{add:[sub], remove:[scopeKey]}` -> 202; authoritative `subs` frame arrives on the stream |
| GET | `/stream?c=<id>&ticket=<t>` | (ticket) | **[MUX SSE]** one socket, many scopes; frames `{s:scopeKey,q:seq,e:globalRowId,k:kind,d:payload,...}`; control events `hello`, `subs`, per-scope `gap` |
| GET | `/stream?scope=&id=&filter=&afterSeq=` | `stream:events` + per-scope | **[SSE]** single-scope; `Last-Event-ID` resume; `hello` before replay; heartbeat comments; per-(scope,id) cap default 6 (`GENERATORAI_SSE_CAP_PER_SCOPE`) |
| GET | `/stream/replay?scope=&id=&afterSeq=&limit=` | `stream:events` | REST replay, `limit<=500` |

Per-scope read requirement (`stream.ts:104-124`): `session`/`chat` -> `read:chats`; `run`/`automation`/`workspace` -> `read:workflows`; `computer` (ephemeral) -> `exec:computer`; `terminal` -> `exec:terminal`; `browser` -> `exec:browser`; `global` -> `admin:settings` (firehose — **a default mobile device cannot subscribe to `global`**).

### 1.3 Chats — `routes/chats.ts` (`read:chats` / `write:chats`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/chats` | Create (validated `CreateChatSchema`) |
| GET | `/chats` | List (paged, headers carry total/hasMore) |
| GET | `/chats/:id` | One chat |
| PUT | `/chats/:id/sources` | Replace chat sources (mounts) |
| POST | `/chats/:id/workspace/prepare` | Prepare workspace |
| DELETE | `/chats/:id` | Delete |
| PATCH | `/chats/:id` | Update (model, agent binding, permissionMode; `bypassPermissions` requires `admin:settings`) |
| POST | `/chats/:id/cancel` | Stop turn |
| POST | `/chats/:id/prompt` | **multipart** `prompt`, `mode?('auto'\|'plan')`, `attachments[]` (10 MB/file, 5 files). 202 `{message,chatId,mode?}`; 409 `INTERACTION_PENDING` / `CHAT_BUSY` (`chats.ts:368-492`) |
| GET | `/chats/:id/attachments/:artifactId` | Bytes of an attachment; images inline, else download |
| GET | `/chats/:id/messages` | History, paged, `ChatMessage[]` |
| GET/GET/POST | `/chats/:id/background-tasks[/:taskId[/cancel]]` | Background subagent tasks |
| GET | `/chats/:id/plans[/:planId[/content]]` | Plan docs |
| PUT | `/chats/:id/plans/:planId/content` | Edit plan |
| POST | `/chats/:id/plans/:planId/comments` | Comment on plan |
| POST | `/chats/:id/plans/:planId/decision` | Approve / changes / reject |
| POST | `/chats/:id/plans/:planId/save-to-workspace` | Save plan file |
| GET | `/chats/:id/interactions` | Pending gates `[{interactionId,kind,status,payload?}]` |
| POST | `/chats/:id/interactions/:iid/respond` | `{answers:{[qid]:string[]}, freeformResponse?}` (question) |
| POST | `/chats/:id/interactions/:iid/permission` | `{behavior:'allow'\|'deny', message?}` (tool permission) |
| PATCH | `/chats/:id/permission-mode` | `{mode}`; raising to `bypassPermissions` needs `admin:settings` |

### 1.4 Agents / sessions / orchestrator

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/agents`, `/agents/:id`, `/agents/:id/usage` | `read:workflows` | Agent catalogue (a paired device must be able to list to bind one) |
| POST/PUT/DELETE | `/agents`, `/agents/:id`, `/agents/import`, `/agents/:id/export`, `/agents/resolve-preview` | `admin:settings` | Authoring grants capability; admin only |
| GET | `/sessions/:sessionId/chat` | `read:chats` | Chat by harness session id |
| GET | `/orchestrator/system-workflows[/:id]`, `/orchestrator/runs/:id/context`, `/runs/:id/workspace[/download\|/content\|/diff]`, `/workflows/:id/files[/download]` | `read:chats` | System workflow + orchestrated-run reads |
| POST | `/orchestrator/from-template`, `/runs`, `/runs/:id/cancel`, `/workflows/:id/uploads`, `/runs/:id/uploads` (multer 10 MB, up to 20 files) | `write:chats`+`exec:agent` | Orchestrated runs |

### 1.5 Workflows / runs / automations / templates / hooks / scripts

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/workflow-definitions[/:id]`, `/:id/export` | `read:workflows` | Definitions |
| POST/PATCH/DELETE/PUT | `/workflow-definitions`, `/:id`, `/:id/stages[/:sid]`, `/:id/edges[/:eid]`, `/:id/validate`, `/import`, `/import-json` | `write:workflows` | Authoring |
| GET | `/workflow-runs`, `/:id`, `/:id/scratchpad`, `/:id/stages`, `/:id/permission-mode`, `/:id/pending-interrupts` | `read:workflows` | Run reads |
| POST | `/workflow-runs`, `/:id/start\|pause\|resume\|retry\|cancel`, DELETE `/:id`, `/:runId/stages/:sid/pause\|resume\|wake\|retry\|cancel`, PATCH `/:id/permission-mode` | `write:workflows`+`exec:agent` | Run control (NOT in mobile default) |
| POST | `/workflow-runs/:id/stages/:sid/approve` | **`exec:agent`** only | `{outcome:'approved'\|'changes_requested'\|'rejected', feedback?}` (or legacy `approved:boolean`). Carved out specifically so a paired phone can answer HITL (`routePolicy.ts:73-92`) |
| POST | `/workflow-runs/:id/stages/:sid/interrupt` | **`exec:agent`** only | `{data?, prompt?}` |
| POST | `/automations/webhooks/:token` | PUB (own token/HMAC) | Trigger delivery |
| GET | `/automations[/:id]`, `/:id/executions[/:execId]` | `read:workflows` | Reads |
| POST/PATCH/DELETE | `/automations`, `/:id`, `/:id/enable\|disable\|rotate-webhook-token\|trigger`, `/test-data-source`, `/:id/executions/:execId/cancel` | `write:workflows`+`exec:agent` | Control (NOT in mobile default) |
| GET | `/templates[/:id]` | `read:workflows` | Templates |
| GET | `/hooks/phases`, `/hooks/sessions/:id/hooks` | `read:workflows` | Hooks |
| POST | `/hooks/sessions/:id/hooks/test` | `write:workflows` | Test hook |
| GET | `/workflow-scripts[/:id[/profiles]]` | `read:workflows` | `.workflow.mjs` scripts |
| POST | `/workflow-scripts/:id/materialize\|run\|reload`, `/reload`, `/upload`, `/validate` | `write:workflows` | Script ops |

### 1.6 Projects / source control / workspaces / files / changes / checkpoints / review

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/projects[/:id]`, `/:id/codebases[/:cid[/branches\|status\|worktrees\|files\|files/content]]`, `/:id/configs[/:cid]`, `/:id/mcp-servers`, `/:id/available-artifacts`, `/:id/worktrees` | `read:projects` | Project reads (incl. codebase file browse/content) |
| POST/PUT/DELETE | everything else under `/projects` (`/:id/configs` is multer 10 MB single file) | `write:projects` | NOT in mobile default |
| GET/PUT | `/source-control/config`, GET `/source-control/status` | `read:projects`/`write:projects` | GitHub provider config |
| GET | `/workspaces`, `/:id`, `/:id/changes`, `/:id/changes/file`, `/:id/changes/content`, `/:id/checkpoints`, `/:id/tree`, `/:id/tree/file`, `/:id/pull-requests`, `/:id/worktrees`, `/:id/files`, `/:id/files/content` (512 KB truncation) | `read:workspaces` | Workspace + Changes tab + checkpoints list + file read |
| POST | `/:id/archive`, `/:id/commit`, `/:id/checkpoints` (manual snapshot), `/:id/checkpoints/:cid/restore`, `/:id/pull-request`, `/cleanup`; DELETE `/:id`; PUT `/:id/files/content` (512 KB cap, 413 above) | `write:workspaces` | NOT in mobile default (so a phone can *view* diffs and checkpoints but not restore/commit/write files) |
| GET | `/workspaces/:id/review/threads` | `read:reviews` | Review threads |
| POST/PATCH/DELETE | `/workspaces/:id/review/threads[...]`, `/submit` | `write:reviews` | Mobile default **includes** `write:reviews` |
| GET | `/fs/dirs`, `/fs/git-info`; POST `/fs/scrub-legacy-refs` | falls to DEFAULT (`admin:settings`) **and** loopback-gated (`routes/fs.ts:24`) | Directory picker; never reachable from a phone |

### 1.7 Terminal / browser / computer (workspace sub-resources; all `riskLevel:'high'`)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/workspaces/:id/terminals` | `exec:terminal` | Create PTY session (`CreateTerminalRequest`) |
| GET | `/workspaces/:id/terminals[/:sid[/scrollback]]` | `exec:terminal` | List / describe / scrollback |
| POST | `/:sid/resize`, `/:sid/signal`; DELETE `/:sid` | `exec:terminal` | Control |
| WS | `/api/workspaces/:id/terminals/:sid/stream` | `exec:terminal` (ticket scope `terminal`, id=sid) | **[WS]** binary=raw PTY bytes; JSON control (see §8.1). Disabled by `GENERATORAI_TERMINAL=0` |
| POST | `/workspaces/:id/browser/start\|stop\|cookies/import\|actions\|selection\|attach\|detach\|capture\|read-page\|input\|resize` | `exec:browser` | Integrated browser control |
| GET | `/workspaces/:id/browser/descriptor\|snapshots\|files/*\|screencast.jpg\|scroll` | `exec:browser` | `screencast.jpg` = ONE JPEG per request; "what the mobile client ... use[s]" (`routes/browser.ts:15-22`) |
| WS | `/api/workspaces/:id/browser/stream` | `exec:browser` (ticket scope `browser`, id=workspaceId) | **[WS]** binary 16-byte header + JPEG/VP8 frames; JSON `hello{accept}` / `request_keyframe`; `BrowserInputEvent` (see §8.2) |
| GET | `/workspaces/:id/computer/consent\|grants\|runtime\|activity\|frames[/:artifactId]\|recording/video\|recording/turns[/:turn/:kind]` | `exec:computer` | Frames are PNG artifacts of type `computer_screenshot` |
| POST | `/workspaces/:id/computer/consent\|runtime\|recording`; DELETE `/grants/:appIdentity` | `exec:computer` | Answer consent prompt / recording control |
| GET | `/workspaces/:id/computer/preview/stream` | `exec:computer` | **[SSE]** live preview (legacy single-scope; the same feed is scope `computer` on MUX) |

### 1.8 Harness / copilot / system / security / health / extensions / widgets / webhooks / docs

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/harness`, `/harness/providers?refresh=1`, `/harness/models?provider=&refresh=` | `read:status` | Provider readiness + `ModelInfo[]` catalogue |
| POST | `/harness/switch` | `admin:harnesses` | Change default provider |
| GET | `/copilot/models\|state\|conversations[/:id/messages]`; POST `/copilot/ping` | `read:status` / `admin:harnesses` | Legacy Copilot SDK views |
| GET | `/system/artifacts[/:id]`, `/system/mcp-servers`, `/system/audio[/model]`, `/system/workspace-retention`, `/system/computer-use` | `read:status` | System settings reads |
| PUT/POST/DELETE | `/system/mcp-servers/custom[/:id]`, `/system/mcp-servers/system/:id`, `/system/audio`, `/system/audio/model`, `/system/workspace-retention[/run]`, `/system/computer-use` | `admin:settings` | Settings writes |
| GET | `/security/posture`, `/security/network-access` | `read:status` | Auth posture, bind host, loopbackOnly |
| POST | `/security/network-access` | `admin:settings` | Switch loopback/network (restart pending) |
| GET | `/health`, `/health/loop-turn`, `/health/config` | PUB | Health + SSE subscriber counts + config snapshot |
| GET | `/extensions`, `/extensions/widgets`, `/extensions/:id`, `/extensions/:id/*` | `read:status` | Installed extensions, widget descriptors |
| POST/PATCH/DELETE | `/extensions[...]`, `/reload` | `admin:settings` | Install/reload |
| GET | `/widgets[/:id]` | `read:status` | Active widget instances |
| POST/PATCH/DELETE | `/widgets`, `/:id/state\|actions\|invoke-result\|context\|teardown-ack`, DELETE `/:id` | `write:chats` | Widget<->server bridge |
| GET | `http://127.0.0.1:3101/api/widget-assets/:ext/*` | PUB, **separate loopback-only origin** (`index.ts:693-708`) | Widget bundles — **not reachable from a phone** |
| POST | `/webhooks/github`, `/webhooks/custom/:trigger` | PUB (HMAC) | Inbound |
| GET/POST/DELETE | `/webhooks/registrations[/:id]` | DEFAULT (`admin:settings`) | Registrations |
| GET | `/openapi.json`, `/docs` | PUB | OpenAPI + Swagger |
| POST | `/internal/browser/cdp-endpoint`, `/internal/computer/endpoint\|consent`, `/internal/desktop/pairing` | Not under `/api`; loopback + own guard | Desktop/host-process plumbing; never for clients |

### 1.9 Voice WebSockets (`apps/server/src/stt-ws.ts`, `tts-ws.ts`)

| Path | Scope | Frames |
|---|---|---|
| `ws://host/api/stt/stream` | `write:chats` (ticket scope `stt`, id null) | C->S binary = 16 kHz mono Float32 PCM; JSON `{t:'start',lang?,interim?}`, `stop`, `cancel`, `pause`, `resume`. S->C `{t:'ready'}`, `{t:'interim',text}`, `{t:'segment',text}`, `{t:'final',text}`, `{t:'error',message}`, `paused`, `resumed`. Whisper/Parakeet on CPU; `GENERATORAI_STT=0` disables |
| `ws://host/api/tts/stream` | `read:chats` (ticket scope `tts`) | C->S `{t:'speak',text}`, `{t:'speak_stream',sessionId}`, `{t:'stop'}`. S->C `{t:'ready',sampleRate}`, `{t:'sentence'}` (boundary marker "because React Native can only play whole files"), binary Float32 PCM, `{t:'done'}`, `{t:'error'}`. Kokoro on CPU; `GENERATORAI_TTS=0` disables |

No REST STT/TTS routes exist; `/stt` and `/tts` policy entries cover the sockets only. Audio engine settings: `GET/PUT /system/audio`, `GET/POST/DELETE /system/audio/model`.

---

## 2. Scope table (`packages/auth/src/scopes.ts`)

| Scope | Unlocks | Mobile default | Device default | CLI default | High-risk | Signed-link forbidden |
|---|---|---|---|---|---|---|
| `read:status` | health/config, harness+models, system reads, security posture, extensions/widgets reads, own push-token | Y | Y | Y | | |
| `read:projects` | projects, codebases, codebase files, source-control reads | Y | Y | Y | | |
| `read:workspaces` | workspaces, changes, tree, files/content, checkpoints list, PR list | Y | Y | Y | | |
| `read:chats` | chats, messages, attachments, plans, interactions, sessions, orchestrator reads, `session`/`chat` streams, TTS socket | Y | Y | Y | | |
| `read:workflows` | definitions, runs, stages, automations, templates, hooks, scripts, agents list, `run`/`automation`/`workspace` streams | Y | Y | Y | | |
| `read:files` | (declared; no route currently maps to it — file reads sit under `read:workspaces`/`read:projects`) | Y | Y | Y | | |
| `read:reviews` | review threads | Y | Y | Y | | |
| `write:projects` | project/codebase/config/MCP writes, source-control config | | | Y | | |
| `write:workspaces` | archive, commit, checkpoints create/restore, PR create, file write, delete, cleanup | | | Y | | |
| `write:chats` | create/update/delete chats, prompt, cancel, plans, interactions, widgets bridge, STT socket, orchestrator writes (+exec:agent) | Y | Y | Y | | |
| `write:workflows` | definition authoring, run control, automations, hooks test, scripts | | Y | Y | | |
| `write:files` | (declared; no route maps to it) | | | Y | | |
| `write:reviews` | review thread writes, submit | Y | Y | Y | | |
| `stream:events` | `/stream/*` endpoint (per-scope checks apply on top) | Y | Y | Y | | |
| `exec:agent` | HITL: stage approve/interrupt, run/automation control (with write:workflows), orchestrator writes | Y | Y | Y | | |
| `exec:terminal` | terminals REST + WS + `terminal` stream/ticket | | | Y | Y | Y |
| `exec:browser` | browser REST + WS + `browser` stream/ticket | | | | Y | Y |
| `exec:computer` | computer REST/preview + `computer` stream | | | | | |
| `admin:harnesses` | `/harness/switch`, copilot writes | | | | | Y |
| `admin:credentials` | `/auth/service-accounts` | | | | Y | Y |
| `admin:devices` | pairing grants, device list/rename/scopes/rotate/revoke | | | | Y | Y |
| `admin:settings` | system writes, extensions writes, agents writes, `global` stream, unclassified routes, `bypassPermissions`, audit log | | | | Y | Y |
| `admin:relay` | `/relay` (policy entry exists; no `/api/relay` router is mounted) | | | | Y | Y |

Principal types (`principals.ts:11-26`): `local-desktop`, `paired-device`, `user-session` (Phase 7, unused), `service-account` (incl. legacy `GENERATORAI_API_KEY`), `signed-link`, `internal-service`. Credential kinds: `access-token`, `service-account`, `stream-ticket`, `signed-link`. Tickets/links can never mint further tickets (`canMintDerivedCredentials`).

---

## 3. Device pairing model (`packages/auth`)

- **Grant**: `DeviceService.createPairingGrant` — TTL <= 10 min (`PAIRING_GRANT_TTL_MS`), attempt-limited, pending grants coalesce per device-name hint. Token is a human-typeable code (`formatPairingCode`, 12+ chars) that is also embedded in the QR blob.
- **Offer (QR) format** (`packages/relay-protocol/src/pairingOffer.ts`): `PairingOffer v2 = { v:2, endpoint, endpoints?:[{origin, reachability:'loopback'|'lan'|'private-network'|'public', priority}] (<=16), serverId (43-char base64url), serverPublicKey (32-byte X25519), certificateFingerprint?, pairingGrant (12-256 chars), pairingExpiresAt, requestedScopes[] (1-40), transportCapabilities:['loopback'|'lan'|'ssh'|'relay'] , serverName, relay?:{v:1,directorUrl,cellUrl,assignmentEpoch,relayHostId,inviteToken,inviteExpiresAt,e2eeFraming:1} }`. Encoded via `encodePairingOffer` (<= 8 KB) and as URL `generatorai://pair?...` (`pairingOfferUrl`). `PairingEndpointSchema` rejects plain `http:` unless host is loopback/RFC1918/`.local`; anything public must be `https`.
- **Endpoint selection for mobile** (`apps/server/src/network/advertisedEndpoints.ts:144-153`): loopback and virtual-switch origins are removed; if nothing remains -> `409 NO_REACHABLE_ENDPOINT` ("Enable network access or configure GENERATORAI_ADVERTISED_URLS"). Origins come from `GENERATORAI_ADVERTISED_URLS`/`GENERATORAI_ADVERTISED_URL` plus interface scan when bound beyond loopback.
- **Complete**: client generates a P-256 (or Ed25519) key, sends `DPoP` proof over `POST /auth/pair/complete` with `publicJwk`; server checks thumbprint == proof key, persists device, returns session. `platform:'mobile'` selects `DEFAULT_MOBILE_SCOPES` unless the grant carried explicit scopes.
- **Session**: access token Ed25519 JWS, 10 min (`ACCESS_TOKEN_TTL_MS`, max 15), DPoP-bound (`cnf.jkt`); resume secret opaque, hashed, **sliding 48 h** (`RESUME_CREDENTIAL_TTL_MS`, env `GENERATORAI_SESSION_TTL_HOURS`), rotated on every refresh. Stream ticket 30 s single-use. Signed link <= 1 h.
- **DPoP verification** (`dpop.ts`): 12 checks (typ, alg allow-list, signature, htm/htu, iat window, jti replay, nonce, ath, cnf.jkt). `htu` = scheme+authority+path — so the client must sign the origin the server believes it serves (`TransportAdapter.endpoint` doc, `client-transport/src/TransportAdapter.ts:24-33`).
- **Revoke**: `revokeDevice` bumps credential version, cascades push-token row, and enqueues a relay revocation into `relay_revoke_outbox` if the device had a `relayBinding` (`DeviceService.ts:682-695`). Client detects via `DEVICE_REVOKED` -> `DeviceRevokedError` in `AuthenticatedClientRuntime`.
- **Per-device audit** (`SecurityAuditService`): `auth.denied`, `exec.terminal_opened`, `deviceScopesChanged`, `pushTokenRegistered`, etc., readable at `GET /auth/audit` (admin).
- **LAN vs relay**: `DeviceRecord.connectionMode: 'loopback'|'lan'|'ssh'|'relay'|'auto'` and `relayBinding` exist in the schema, and `Principal.transport` records how a request arrived, but the only transport that works end-to-end today is direct HTTP(S) (loopback/LAN/advertised URL).

---

## 4. Relay (`apps/relay`, `packages/relay-protocol`, `apps/server/src/relay`)

- **What it does**: self-hostable director+cell (`apps/relay/src/index.ts`). Host dials OUT (`RelayHostBroker`), so no inbound firewall rule. Routes from `RELAY_ROUTES` (`relayRoutes.ts:25-33`): `GET /relay/assignment?relayHostId=`, `WS /relay/host`, `WS /relay/client`, `WS /relay/data?streamId=`, `GET /healthz`.
- **Host handshake** (`relayProtocol.ts`): `host_hello{relayHostId, hostPublicKey, hostBinding(sig), assignmentEpoch, previousGeneration, resumeIntent}` -> `challenge{nonce, relayEphemeralPublicKey, relayOrigin,...}` -> `challenge_response{signature}` -> `attached{generation, leaseExpiresAt}` (lease 10 min, reconnect supersedes with close code 4409). Control msgs: `create_invite`/`invite_created`, `revoke_device`/`revoke_ack`, `stream_open{streamId, credentialKind:'invite'|'resume', relayBinding}`, `stream_close`, `error`.
- **Client side**: `client_hello{relayHostId, credentialKind, credential, relayBinding?}` on `/relay/client` -> cell validates invite (5 attempts, 10 min) or checks binding not revoked -> `stream_open` to host -> `client_ready{streamId}`; thereafter the socket is a **raw byte pipe**: bytes are forwarded to the host, which opens a TCP connection to `127.0.0.1:<port>` (`RelayStreamBridge.ts:1-25`). The phone therefore speaks **HTTP/1.1 over WebSocket frames** — `packages/client-transport/src/httpCodec.ts` (64 KB header cap, 32 MB body cap, chunked/Content-Length/close framing, no compression).
- **Limits** (`relayProtocol.ts:38-42`): control message 64 KB, data frame 1 MB (ws `maxPayload`), 64 streams/host (mirrored in bridge `MAX_ACTIVE_STREAMS`), cell buffers up to 4 MB per stream before the host attaches, 500 hosts default (`GENERATORAI_RELAY_MAX_HOSTS`), assignment JSON body 16 KB.
- **E2EE status**: `e2ee.ts` is complete and tested but "NO transport in this repository currently calls" it (`index.ts:7-10`, `RelayHostBroker.ts:22-25`, `RelayStreamBridge.ts:11-14`). The relay operator can read traffic; TLS to the cell is the only protection.
- **Reconnection**: host lease/generation as above; client streams have **no resume** — a dropped `/relay/client` socket means a new `client_hello` and a new HTTP connection; SSE resume is then carried by the application layer (cursor map / `Last-Event-ID`).
- **Server-side enablement**: `config.security.relayEnabled` (default `false`, `packages/shared/src/config/AppConfig.ts:184`), broker wired in `composition-root.ts:260`, bridge attached in `index.ts:712-718`. Even when enabled, `POST /auth/pair` refuses `includeRelay` (409) and there is no `/api/relay` router despite the `admin:relay` policy entry.
- **Client packages**: `TransportAdapter` interface has `kind:'relay'` and `EndpointSupervisor` orders LAN before relay, but there is **no relay adapter implementation** — only `DirectTransport` (`client-transport/src/index.ts`).

---

## 5. Shared client packages

### 5.1 `packages/client-core` (platform-agnostic; may import only `@generatorai/shared`)

- **Block model** (`stream/types.ts`): `StreamStatus = idle|pending|streaming|thinking|complete|error`. Blocks: `ThinkingBlock{text,isComplete}`, `TextBlock{content}`, `ToolCallBlock{callId,tool,args,result?,status:'running'|'complete',fileOp?,parentCallId?,error?}`, `SystemBlock{message,category:'system'|'subagent'|'error'|'warning'}`, `WidgetBlock{instanceId,descriptorId,extensionId,component,title?,surface:'inline'|'widget',assetsBase,entry,props,state?,status,error?}`, `PlanBlock{planId,revision,title,fileName?,summary,status:PlanStatus,actions[],recommendedAction?,interactionId?,openedAt?}`, `QuestionBlock{interactionId,questions[{id,header,question,options[{label,description?,preview?}],multiSelect,allowFreeform}],status,answers?,freeformResponse?,openedAt?}`, `PermissionBlock{interactionId,toolName,permissionType,description,inputSummary,permissionMode,status:'pending'|'allowed'|'denied'|'expired',message?,openedAt?}`.
- **Tool-call extras**: `ToolFileOp{kind:'create'|'update'|'edit'|'delete', filePath, additions, deletions, hunks?:ToolFileOpHunk[], hunksTruncated?}` from `harness.tool_complete.fileOp`; `parentCallId` (subagent nesting); `error` (provider `is_error`).
- **StreamState** (per session key): `text, thinkingText, status, toolCalls[], systemMessages[], blocks[], _nextBlockId, _toolCallCounter, hooks[StreamHookInvocation], _hookCounter, pendingUserMessage, turnUserMessage, turnId, serverTurnId, usage:StreamUsage|null, contextUsage:ContextUsageSnapshot|null, cancelRequested, typing, lastActivityAt`. `StreamsRecord = Record<key, StreamState>`; bounded by `pruneStreams`.
- **Pipeline**: `StreamEventRouter` (`eventRouter.ts`) turns SSE events into `StreamEffect[]` (ops: `appendToken, appendThinking, completeThinking, startPending, appendTokenIfNoText, addToolCall, completeToolCall, addSystemMessage, hookStarted, hookCompleted, processInlineToolCalls, completeStream, errorStream, setServerTurnId, setTyping, setUsage, setContextUsage, upsertPlan, setPlanStatus, upsertQuestion, answerQuestion, expireQuestion, upsertPermission, resolvePermission, expirePermission, addWidget, updateWidgetState, setWidgetStatus, invalidate`). `applyStreamEffect` (`applyEffects.ts`) applies non-`invalidate` effects to the record; hosts route `invalidate` to their query layer. Cross-buffer flush preserves token/thinking order; on surfaces with `highLatencyBlockDelivery` (mobile) text is held to markdown block boundaries with a `setTyping` effect.
- **Handled kinds** (grep of `eventRouter.ts`): `harness.*` (token, reasoning_*, tool_*, message_complete, idle, error, warning, cancelled, usage, context_usage, turn_*, session_*, client_*, widget.*), `chat.*` (created/archived/deleted/agent_changed/prompt_*/background_task.*/plan.*/question.*/permission.*), `agent.*`, `hook.*`, `workflow_run.*`, `stage_run.*`, `session.*`, `checkpoint.*`, `workspace.changed`/`prep`, `copilot.turn_start`/`usage`.
- **Other**: `SseParser` (WHATWG, for React Native which has no `EventSource`), `MuxStreamClient` (Node port of the web mux client: cursor map, dedup on global row id `e`, reconciliation from `hello`/`subs`), `scheduleFrame` (rAF+timer drain), `StopController` (two-phase stop), `contextUsage`, `parseInlineToolCalls`, `parseUnifiedDiff`.
- **API client** (`api/client.ts`): `createApiClient(fetch)` with typed helpers and `queryKeys`; shapes `ChatSummary, ChatMessage{id,chatId,role,content,timestamp,metadata{turnId,agentMode,toolCalls[]}}, PlanSummary, InteractionSummary, BackgroundTaskSummary, ModelInfo{id,name,provider?,contextWindow?,promptTokenLimit?,maxOutputTokens?,supportsReasoning?,reasoningEfforts?:string[]|string,...}, WorkflowSummary, WorkflowRunSummary, StageRunSummary, PendingInterrupt, AutomationSummary, ChangeSummary/ChangeFileEntry/ChangeFilePatch, ReviewThread, ProjectSummary, CodebaseSummary, AgentSummary, WorkspaceSummary, WorkspaceTree, WorkspaceFile, WorkspaceCheckpoint, RestoreResult, TerminalDescriptor, ProviderStatus, HealthSnapshot, SystemArtifact, McpServerEntry, SourceControlConfig/Status`. `api/admin.ts` covers admin surfaces.

### 5.2 `packages/client-runtime`

`AuthenticatedClientRuntime` (device key + DPoP proofs, access token + single-flight refresh, nonce handling, pairing import/complete, stream tickets, revocation detection). Public API: `initialize()`, `completePairing()`, `refreshSession()`, `forget()`, `fetch(path, init)`, `createStreamTicket(scope,id)`, `buildStreamUrl(scope,id)`, `buildSocketUrl(path,scope,id)`, `currentState`, `endpoint`, `isLegacyKeyMode`, `setFetchImpl`, `setAllowUnauthenticated`. Stores: `IndexedDbDeviceKeyStore`/`LocalStorageSessionStore` (browser), `SecretSinkDeviceKeyStore`/`SecretSinkSessionStore`/`Memory*` (Node). Mobile must supply a `DeviceKeyStore` backed by the platform keystore (`deviceKey.ts:33-38`). `connections.ts` = multi-server catalogue keyed by `serverId`. `pairing.ts` = strict `parsePairingCode` -> `PairingConsent` (must be shown before completing).

### 5.3 `packages/client-transport`

`TransportAdapter{kind, endpoint, open, fetch, streamUrl(path,'http'|'ws'), close}`, `DirectTransport` (loopback/LAN), `EndpointSupervisor` (verify pinned `serverId` via unauthenticated `/auth/server-info` BEFORE sending credentials; jittered `Backoff`; failover; status `idle|connecting|connected|reconnecting|offline|host-mismatch`), `httpCodec` (relay HTTP/1.1 framing). **No relay adapter, no offline/outbox queue** anywhere in client-core/runtime/transport.

### 5.4 Surface capability ledger (`packages/shared/src/transport/TransportCapabilities.ts`)

`SurfaceId = web|desktop|cli|mobile|sdk`. `MOBILE_CAPABILITIES`: `sse`, `eventReplay`, `highLatencyBlockDelivery` enforced true; `websocketStreaming`, `markdownRendering`, `diffRendering`, `browserPanelRendering`, `terminalRendering`, `hitlGates` asserted true; `widgetRendering`, `computerPanelRendering`, `keyboardShortcuts`, `crossTabEventSource` false; `fileAttachment` **enforced false**. This is a client-side ledger; the **server does not negotiate capabilities per client** — it only knows `platform` at pairing time and uses it for (a) default scopes and (b) endpoint selection.

---

## 6. `packages/shared` — wire types a mobile client needs

- **Harness ids**: `HarnessType = 'copilot' | 'claude-agent' | 'codex' | 'opencode' | 'acp'` (`agent-harness-providers/src/types.ts:17`; core port narrows to `copilot|claude-agent`). `GET /harness` returns `{type, availableTypes, knownTypes}`.
- **Chat modes**: `AgentMode = 'auto'|'plan'` (per turn). `ChatPermissionMode = 'bypassPermissions'|'default'|'acceptEdits'|'plan'` (default `bypassPermissions`). `AgentPermissionMode` adds `dontAsk`. `WorkflowRunPermissionMode` same four values.
- **Interactions**: `AgentInteractionKind = plan_review|question|tool_permission`; statuses `pending|approved|changes_requested|answered|rejected|cancelled|expired|failed`; `ToolPermissionType = file_write|file_read|shell_exec|network|other`; `PlanStatus`, `PlanAction`, `StageReviewOutcome = approved|changes_requested|rejected`.
- **Model catalogue**: `ModelInfo` (above) from `/harness/models`; provider readiness `ProviderStatus` from `/harness/providers`.
- **Workflow/run/automation**: `WorkflowRunStatus`, `StageRunStatus` (incl. `sleeping`, `awaiting_input`), `AutomationTriggerType = manual|schedule|webhook`, `AutomationInputMode`, `AutomationExecutionStatus = pending|running|completed|partial|failed|cancelled`.
- **Changes** (`packages/changes/src/summaryTypes.ts`): `ChangeSummary{workspaceId,hasGit,base:ChangeRevision,head:ChangeRevision,repos:ChangeSummaryRepo[],stats}`; `ChangeSummaryFile{path,oldPath?,status:'added'|'modified'|'deleted'|'renamed',additions,deletions,isBinary,isTooLarge,oldBlob?,newBlob?,lang?}`; `ChangeFilePatch`, `ChangeFileVersions`, `ChangeRevisionKind`.
- **Checkpoints** (`shared/types/Checkpoint.ts`): `CheckpointKind = baseline|turn|stage|autorun|live|manual|pre_restore`, `CheckpointRecord`, `RestoreCheckpointResult`, `CheckpointDiffFile`; service in `packages/checkpoints` (`CheckpointService`, git shadow refs).
- **Workspace**: `MountMode = in-place|worktree|generated`, `WorkspaceArtifactType` (incl. `browser_screenshot`, `computer_screenshot`), `BrowserSessionStatus`.
- **Terminal** (`Terminal.ts:84-108`): `TerminalInputFrame = input|resize|ack|signal|kill`; `TerminalOutputFrame = exit|resized|ready{descriptor}|error`; `TerminalSessionDescriptor`, `TerminalHostKind = node-pty|fallback-child-process|sandbox|pty-host`.
- **Browser** (`BrowserSession.ts`): `BrowserMode = native|screencast|off`, `BrowserActionKind` (navigate…download), `BrowserSessionDescriptor`, `BrowserInspectorSelection`.
- **Computer use** (`ComputerUse.ts`): `ComputerConsentDecision = allow_once|allow_run|always_allow|deny`, `ComputerRefusalCode`, `ComputerSnapshot`, `ComputerScreenshot`, `ComputerConsentRequest`, `ComputerCapabilities`.
- **Voice** (`Voice.ts`): `SttClientFrame`, `SttServerFrame`, `TtsClientFrame`, `TtsServerFrame`, `SttEngineKind = whisper|parakeet`.
- **Events**: `AgentEvent` union of **175 kinds** (`AgentEvent.ts`); `EVENT_CLASS` maps each to `delta` (droppable under backpressure) or `item` (queued).

---

## 7. Event table — global vs per-chat

Source: `apps/server/src/composition/streamScopes.ts` (the doc `.github/docs/feature-streaming-events.md §1` lists ~60 kinds and is stale relative to the 175-kind union; §4/§8 routing and durability text still match the code).

Routing: every event lands on its primary `session/<sessionId>` scope (or `global/all` if emitted via `emitGlobal`). Secondary fan-out: `run/<workflowRunId>`, `chat/<chatId>`, `automation/<executionId|automationId>`, `workspace/<workspaceId>` when the payload carries that id; plus **`global/all` for lifecycle kinds** so list views update without polling.

| Family | Kinds | Scope(s) a phone would subscribe to |
|---|---|---|
| **Global / activity (LIFECYCLE_EVENT_KINDS)** | `chat.created, chat.archived, chat.deleted, chat.mode_changed, chat.agent_changed, workflow_run.created/starting/running/paused/resumed/cancelling/completed/failed/cancelled/retried, automation_execution.started/completed/failed/cancelled/recovered` | `global` — **requires `admin:settings`**, so a default mobile device cannot get an activity feed; it must subscribe per chat/run or poll lists |
| Chat transcript | `harness.token, message_complete, user_message, reasoning_delta/complete, tool_start/complete, idle, error, warning, cancelled, session_start/info, usage, context_usage, turn_start/end, unknown, client_started/stopped/error/restarting, plan_changed, mode_changed` | `chat/<id>` (`read:chats`) |
| Chat gates | `chat.plan.drafting/created/updated/review_requested/decided/expired/extraction_failed, chat.question.asked/answered/expired, chat.permission.requested/resolved/expired, chat.prompt_sent/prompt_failed, chat.background_task.*` | `chat/<id>` |
| Widgets | `harness.widget.render/state/action/invoke/teardown/closed/error` | owning chat/run scope |
| Workflow runs | `workflow_run.*` (25 kinds incl. preprocessing/postprocessing/sandbox/worktree), `stage_run.*` (16 kinds incl. `awaiting_input`, `input_received`), `hook.*`, `script.*`, `git.*`, `artifact.*`, `permission.*` | `run/<id>` (`read:workflows`) |
| Automations | `automation_execution.*` (12), `automation.schedule_skipped/deferred` | `automation/<id>` |
| Workspace | `workspace.changed, workspace.prep, checkpoint.created, checkpoint.restored` | `workspace/<id>` (`read:workflows`) |
| Browser | `browser.session_created/stopped/updated, action_started/completed, snapshot, selection, error` | workspace/chat scope (`browser:*` ticket only for the WS) |
| Terminal | `terminal.session_created/closed/resized` (raw bytes are NOT on SSE) | workspace scope |
| Computer | `computer.session_started/stopped, snapshot, action, refusal, consent_required, consent_resolved, error`; ephemeral preview kinds `computer.preview.open/run/frame/cursor/window` | `computer/<workspaceId>` ephemeral (`exec:computer`) |
| Voice | `voice.stt_session_started/ended/paused/resumed, tts_session_started/ended` | session scope |
| Extensions / agents / sessions | `extension.installed/uninstalled/reloaded/error`, `agent.created/updated/deleted`, `session.created/active/paused/closing/closed/error`, `subscriber.error` | session; `agent.*` are not lifecycle-global |

Frame shape (single-scope): `data: {"id","kind","payload","ts","scope","scopeId","seq"}`; MUX: `{s,q,e,k,d,ts}` plus control `hello{subs,cursors}`, `subs{active,rejected[{s,reason}]}`, `gap{s,from,to}`. Backpressure: deltas dropped + `gap`; items queued (256 frames / 8 MB single-scope; 64/scope + 8 MB total mux) then `slow_consumer_dropped`.

---

## 8. Terminal / browser / computer-use attach protocols

Host processes (`apps/pty-host`, `apps/browser-host`, `apps/cua-host`) are **child processes of the server** speaking versioned IPC (`packages/shared/src/protocol/hostProtocol.ts`, `ipc/*HostIpc.ts`); they expose no network listener a client could reach. Everything a remote client sees goes through the server's REST/WS layer.

### 8.1 Terminal — `apps/server/src/terminal-ws.ts`
- URL `ws(s)://<host>/api/workspaces/:id/terminals/:sid/stream`; auth `exec:terminal` via DPoP header or `?ticket=` minted with `POST /stream/tickets {scope:'terminal', id:sid}`.
- S->C: binary frames = raw PTY bytes; JSON `{t:'ready',descriptor}`, `{t:'exit',code,signal?}`, `{t:'resized',cols,rows}`, `{t:'error',message}`. Output coalesced 4 ms / 32 KB.
- C->S JSON: `input{data}`, `resize{cols,rows}` (only the first-attached socket's resize is honoured — `ResizeAuthority`), `ack{bytes}` (flow control; slowest viewer governs), `signal{name}`, `kill`. 200 msgs/s limit; 1 MB bufferedAmount circuit breaker.
- Feature flag `GENERATORAI_TERMINAL=0`. Scrollback via `GET .../terminals/:sid/scrollback`.
- **Phone today**: reachable over plain HTTP/WS if the device is granted `exec:terminal` (not default; high-risk; admin must `PUT /auth/devices/:id/scopes`). Via relay: would work in principle (raw HTTP bytes through the bridge) but no client relay transport exists.

### 8.2 Browser — `apps/server/src/browser-ws.ts` + `routes/browser.ts`
- URL `ws(s)://<host>/api/workspaces/:id/browser/stream`; auth `exec:browser` (ticket scope `browser`, id=workspaceId).
- C->S first message `{type:'hello', accept:['vp8','jpeg']}` (1.5 s timeout -> JPEG); `{type:'request_keyframe'}`; `BrowserInputEvent` (mouse/key/wheel; moves coalesced, 24 pending / 120 per s).
- S->C binary: 16-byte header `magic 0x47, version 1, codec 0=jpeg/1=vp8, flags bit0 keyframe, u16 width, u16 height, f64 pts µs` + payload; JSON `stream_unavailable{reason}`, `stream_error{message}`. Backpressure 512 KB high-water, 250 ms drain.
- Poll alternative: `GET .../browser/screencast.jpg` (one JPEG; route comment says this is what the mobile client uses), `POST .../browser/input`, `POST .../browser/actions`, `POST .../browser/read-page` (accessibility text for non-graphical clients). Underlying transport is CDP (`/internal/browser/cdp-endpoint` from desktop or `ServerPlaywrightHost`); clients never see CDP.
- **Phone today**: yes, if granted `exec:browser` (not default). VP8 needs WebCodecs; JPEG fallback works anywhere.

### 8.3 Computer use — `routes/computer.ts`, `computer/previewProducer.ts`
- No WebSocket. Live feed = SSE scope `computer/<workspaceId>` on the mux (or legacy `GET .../computer/preview/stream`). Ephemeral kinds: `computer.preview.open`, `.run{run}`, `.frame{turn,kind:'before'|'click'|'after',tool,point?}` (item, latest replayed), `.cursor{t,x,y}` (delta, not replayed), `.window{bounds}`.
- The frame event carries **metadata only**; the client fetches the PNG via `GET .../computer/recording/turns/:turn/:kind` or `GET .../computer/frames/:artifactId` (artifact type `computer_screenshot`). Video: `GET .../computer/recording/video`. Consent: `GET/POST .../computer/consent` (`ComputerConsentDecision`), grants `GET/DELETE .../computer/grants[/:appIdentity]`.
- **Phone today**: possible only with `exec:computer`, which is in **no** default grant and is explicitly intended to be withheld from phones ("a paired phone must not be able to approve a prompt about a window it cannot see", `routePolicy.ts:112-116`). Windows-only capture (Windows Graphics Capture per `previewStream.ts` header).

---

## 9. Voice — see §1.9. Summary for mobile
- STT: stream Float32 PCM 16 kHz mono; single-shot flow (`start` -> audio -> `stop` -> `final`) explicitly supported ("mobile's batch upload", `stt-ws.ts:36-40,147`). Needs `write:chats` (mobile default has it). No workspace scoping.
- TTS: `speak{text}` or `speak_stream{sessionId}`; `sentence` boundary frames exist specifically so RN can cut audio into playable files. Needs `read:chats`.
- Both need a WS that can send binary frames and either an `Authorization: DPoP` header (RN `WebSocket` supports headers) or a ticket.
- Engine settings are admin-only (`PUT /system/audio`). Feature flags `GENERATORAI_STT/TTS=0` -> upgrade path not registered (socket destroyed by no handler -> connection fails).

---

## 10. Attachments / files / changes / checkpoints
- **Chat attachments**: `POST /chats/:id/prompt` multipart field `attachments` (multer memory, 10 MB/file, `files: 5`); stored as artifacts; `GET /chats/:id/attachments/:artifactId` serves bytes (images inline). Any MIME accepted; the harness decides what it can use.
- **Other uploads**: `POST /projects/:id/configs` (single file, 10 MB, `write:projects`); `POST /orchestrator/workflows/:id/uploads` and `/runs/:id/uploads` (20 files, 10 MB each, `write:chats`+`exec:agent`).
- **JSON body limit** `GENERATORAI_JSON_BODY_LIMIT` default 2 MB; urlencoded 1 MB (`app.ts:89-90`). Relay path adds 32 MB body / 64 KB header caps client-side.
- **Workspace files**: `GET /workspaces/:id/files` (list for @-mention), `GET /workspaces/:id/files/content?path=` (512 KB, `truncated` flag), `PUT /workspaces/:id/files/content` (512 KB, 413 above; `write:workspaces`), `GET /workspaces/:id/tree`, `GET /workspaces/:id/tree/file`. Codebase files also under `/projects/:id/codebases/:cid/files[/content]` (`read:projects`).
- **Changes**: `GET /workspaces/:id/changes` (O(files) summary), `GET /workspaces/:id/changes/file?path=` (content or patch), `GET /workspaces/:id/changes/content` (old vs new). `POST /workspaces/:id/commit`, `POST /workspaces/:id/pull-request` need `write:workspaces`.
- **Checkpoints**: `GET /workspaces/:id/checkpoints?limit=` (read), `POST /workspaces/:id/checkpoints` and `POST .../:cid/restore` (`write:workspaces`). Events `checkpoint.created/restored` on `workspace` scope.

---

## 11. What the server knows about mobile clients (§7 of the brief)
- `DevicePlatform` includes `'mobile'` (`ports.ts:14`); used for **default scopes** (`DEFAULT_MOBILE_SCOPES`) and **pairing endpoint selection** (drops loopback/virtual). Nothing else branches on platform.
- No per-request client-kind header, no capability negotiation endpoint, no `X-Client`/User-Agent logic. `/auth/server-info` and `/health/config` are the only self-description endpoints.
- Mobile-specific endpoints: push-token register/remove/mute; `POST /auth/devices/:id/revoke` alias. `RESUME_CREDENTIAL_TTL_MS` comment is written around "my phone stopped working" (`TokenService.ts:34-47`).
- HITL carve-outs made for phones: stage approve/interrupt under `exec:agent` (`routePolicy.ts:73-92`); chat question/permission responses under `write:chats`.
- Push policy (`notificationPolicy.ts`): `stage_run.awaiting_input` -> approval (`read:workflows`), `chat.question_asked` / `chat.plan.review_requested` -> approval (`read:chats`), `workflow_run.failed`, `automation_execution.failed/partial/recovered(badly)` -> failed, `workflow_run.completed` -> completed. Approvals bypass mute; dedupe 60 s per (device, thread, category). Only Expo provider implemented (`ExpoPushProvider`, `EXPO_ACCESS_TOKEN`); `apns`/`fcm` accepted at registration but routed through Expo.
- **Gaps**: `chat.permission.requested` (tool approval) is not pushed; no badge/unread counts; no "device requests" flow (a phone cannot ask for a scope — an admin must grant it).

---

## 12. Feasibility for mobile — per subsystem

| Subsystem | Reachable via API today (LAN/advertised https) | Via relay | Missing server-side for a mobile client |
|---|---|---|---|
| **Chat (send/stream/history/gates)** | Yes, fully within default scopes: `POST /chats/:id/prompt`, mux SSE on `chat/<id>`, interactions respond/permission, plans decision | Bytes would pass through the bridge, but no client relay transport, pairing refuses relay, no E2EE | Nothing blocking. Nice-to-have: push for `chat.permission.requested`; `global` activity feed needs a non-admin scope |
| **Agents (pick/bind)** | List under `read:workflows`; bind via `PATCH /chats/:id` (`write:chats`) | same | Nothing; authoring is admin-only by design |
| **Workflows / runs** | Read + HITL approve/interrupt with defaults; start/pause/cancel need `write:workflows` (not default, grantable) | same | Optional: a narrower "run control" scope so a phone can cancel without full authoring rights |
| **Automations** | Read + execution history with defaults; enable/disable/trigger need `write:workflows`+`exec:agent` | same | Same as runs |
| **Changes / checkpoints** | View summary, per-file patch, old/new content, checkpoint list — all `read:workspaces` (default). Restore/commit/PR need `write:workspaces` | same | Nothing for viewing; grant `write:workspaces` for restore |
| **Files** | Read workspace/codebase files (512 KB cap) with defaults; write needs `write:workspaces`; attachments 10 MB via multipart | same (32 MB codec cap) | Nothing server-side; client lacks a picker (`fileAttachment: enforced(false)`) |
| **Terminal** | Yes with `exec:terminal` granted by an admin (`PUT /auth/devices/:id/scopes`); WS + ticket or DPoP header | Possible in principle (WS over bridge) | Nothing server-side; high-risk scope by policy |
| **Browser** | Yes with `exec:browser`; `screencast.jpg` poll or WS (JPEG fallback); input/actions/read-page REST | same | Nothing server-side; consider an H.264/JPEG-only negotiation for RN (no WebCodecs) — already handled by `accept` |
| **Computer use** | Only with `exec:computer` (no default, policy says phones should not have it); SSE preview + PNG fetch per turn | same | Product decision, not code: no scope-limited "view-only" mode; preview is metadata + separate PNG fetch (fine for RN) |
| **Voice** | STT (`write:chats`) and TTS (`read:chats`) WebSockets work with defaults; RN needs binary WS + PCM capture | same | Nothing; engines are server-local CPU models, no cloud key |
| **Extensions / widgets** | Can list extensions/widget instances (`read:status`) and drive widget bridge (`write:chats`), but widget **assets** are served only on `127.0.0.1:3101` (`index.ts:693-708`) | Bridge is loopback-only to `:<api port>`, not `:3101` | To render widgets on a phone: expose widget assets on a reachable (still isolated) origin, or proxy them; mobile ledger already declares `widgetRendering:false` |
| **Settings** | Read posture/harness/models/system with `read:status`; every write is `admin:settings`/`admin:harnesses` (not grantable safely to a phone by policy) | same | None required for a companion app; an admin phone would need `admin:*` scopes |
| **Pairing / devices** | Phone completes pairing over LAN (QR or 12-char code + preview); device management is `admin:devices` | Relay invite in offer schema exists; server refuses to issue | Client relay transport + unlock `includeRelay` + wire E2EE before advertising relay |
| **Push** | `PUT /auth/push-token` (Expo) with defaults; mute endpoint | n/a | APNs/FCM providers; permission-prompt category |

### Cross-cutting gaps for any off-LAN mobile deployment
1. Relay is server-only plumbing: `relayEnabled` default false, `includeRelay` -> 409, no client adapter, E2EE unwired. Only path today is a public https origin in `GENERATORAI_ADVERTISED_URL` (offer schema forces https off-LAN).
2. `global` stream scope requires `admin:settings`; a phone's "activity" view must fan out per-entity subscriptions (32/connection, 8 connections) or poll `GET /chats`, `GET /workflow-runs`, `GET /automations`.
3. No offline queue / outbox in shared client packages; a prompt sent while disconnected must be handled by the app.
4. `read:files` / `write:files` scopes are declared but unused by any route; file authority actually rides on `read:workspaces`/`write:workspaces`/`read:projects`.
5. Access token 10 min + sliding 48 h resume: a phone that is closed for >48 h must re-pair (`GENERATORAI_SESSION_TTL_HOURS` to tune).

---

## Appendix A — Server env flags a mobile deployment touches

| Env | Default | Effect | Source |
|---|---|---|---|
| `GENERATORAI_ADVERTISED_URL(S)` | unset | Origins put into pairing offers; required for mobile when bound to loopback | `routes/auth.ts:725-737` |
| `GENERATORAI_SERVER_NAME` | hostname | `serverName` on consent screen | `routes/auth.ts:747` |
| `GENERATORAI_SESSION_TTL_HOURS` | 48 | Sliding resume-credential TTL | `packages/auth/src/TokenService.ts:44-47` |
| `GENERATORAI_PUSH` | on (`0` disables) | Push token repo + Expo dispatcher; 501 when off | `composition-root.ts:1371` |
| `EXPO_ACCESS_TOKEN` | unset | Expo push auth | `composition-root.ts:1389` |
| `GENERATORAI_STT` / `GENERATORAI_TTS` | on | Register voice WebSockets | `stt-ws.ts:55`, `tts-ws.ts:71` |
| `GENERATORAI_TERMINAL` | on | Terminal WS upgrade | `terminal-ws.ts:190` |
| `GENERATORAI_SSE_CAP_PER_SCOPE` | 6 | Concurrent single-scope SSE per (scope,id) | `composition/sseConnectionCap.ts:29-31` |
| `GENERATORAI_JSON_BODY_LIMIT` | 2mb | JSON body cap | `app.ts:89` |
| `WIDGET_PORT` / `WIDGET_ORIGIN` | 3101 | Loopback-only widget asset origin | `index.ts:697`, `wsAuth.ts:158` |
| `security.relayEnabled` (config) | false | RelayHostBroker on/off | `AppConfig.ts:184` |
| `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK` | off | Dev override only | `AuthService.ts:17-19` |
| `GENERATORAI_API_KEY` | unset | Legacy bearer/`?apiKey=` (loopback only for query) | `AuthService.ts:125-133` |

## Appendix B — Numeric limits summary

| Limit | Value | Source |
|---|---|---|
| Access token TTL | 10 min (cap 15) | `TokenService.ts:33,147` |
| Resume credential | 48 h sliding | `TokenService.ts:47` |
| Stream ticket | 30 s, single use | `TokenService.ts:48` |
| Pairing grant | <= 10 min; 10 attempts/min/source, 60/min global | `TokenService.ts:49`, `DeviceService.ts:189-190` |
| Mux connections / principal | 8 | `streamConnectionRegistry.ts:37` |
| Subscriptions / mux connection | 32 | `streamConnectionRegistry.ts:40` |
| Unattached mux TTL | 60 s | `streamConnectionRegistry.ts:49` |
| Mux queue | 64 items/scope, 8 MB total | `muxConnection.ts:34,42` |
| Single-scope SSE queue | 256 items, 8 MB | `sseConnection.ts:106,114` |
| Replay REST | limit <= 500 | `stream.ts:152` |
| Filter prefixes | <= 10 | `stream.ts:149` |
| Chat attachments | 10 MB/file, 5 files | `chats.ts:27` |
| Orchestrator uploads | 10 MB/file, 20 files | `orchestrator.ts:82,229` |
| Workspace file read/write | 512 KB | `workspaces.ts:756,810` |
| Terminal input rate | 200 msg/s; 1 MB buffered breaker | `terminal-ws.ts:56-58` |
| Browser input | 24 pending, 120/s, burst 60; 512 KB socket HWM | `browser-ws.ts:64-66,113` |
| Relay control / data frame | 64 KB / 1 MB; 64 streams/host; invite 10 min, 5 attempts | `relayProtocol.ts:38-42` |
| Relay client HTTP codec | 64 KB headers, 32 MB body | `httpCodec.ts:32-33` |
| Pairing offer | <= 8 KB encoded, <= 16 endpoints, <= 40 scopes | `pairingOffer.ts:20,107,127` |

## Appendix C — Full `AgentEvent` kind list (175, from `packages/shared/src/types/AgentEvent.ts`)

harness: `token, message_complete, user_message, reasoning_delta, reasoning_complete, tool_start, tool_complete, idle, error, warning, cancelled, session_start, usage, context_usage, turn_start, turn_end, session_info, unknown, client_started, client_stopped, client_error, client_restarting, plan_changed, mode_changed, widget.render, widget.state, widget.action, widget.invoke, widget.teardown, widget.closed, widget.error`
chat: `created, prompt_sent, prompt_failed, archived, deleted, background_task.spawned/status/completed/failed, mode_changed, plan.drafting/created/updated/review_requested/decided/expired/extraction_failed, question.asked/answered/expired, permission.requested/resolved/expired, agent_changed`
agent: `created, updated, deleted`
workflow_run: `created, starting, running, paused, resumed, cancelling, completed, failed, cancelled, retried, orchestration_started/failed/completed, worktree_creating/created, preprocessing_started/completed/step_started/step_completed/step_failed, stage_validation, sandbox_created/destroyed, postprocessing_started/completed/step_started/step_completed/step_failed, permission_mode_changed`
stage_run: `pending, queued, running, step_started, step_completed, paused, resumed, completed, failed, cancelled, skipped, retrying, sleeping, woken, awaiting_input, input_received`
session: `created, active, paused, closing, closed, error`
git: `clone_start, clone_progress, clone_complete, commit, push, pr_created`
workspace/checkpoint: `workspace.changed, workspace.prep, checkpoint.created, checkpoint.restored`
script: `stdout, stderr, exit`; hook: `started, completed, failed, skipped`; artifact: `created, available`; permission: `requested, granted, denied`; `subscriber.error`
browser: `session_created, session_stopped, session_updated, action_started, action_completed, snapshot, selection, error`
computer: `session_started, session_stopped, snapshot, action, refusal, consent_required, consent_resolved, error`
terminal: `session_created, session_closed, session_resized`
voice: `stt_session_started, stt_session_ended, stt_paused, stt_resumed, tts_session_started, tts_session_ended`
extension: `installed, uninstalled, reloaded, error`
automation: `automation_execution.started/progress/completed/failed/partial/cancelled/recovered, automation.schedule_skipped/deferred, automation_execution.iteration_started/completed/failed/retried`
Ephemeral (never persisted, mux scope `computer` only): `computer.preview.open, run, frame, cursor, window` (`apps/server/src/computer/previewProducer.ts`).
