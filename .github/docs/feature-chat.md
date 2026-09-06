# Feature: Chat

> Direct conversational AI interaction. One Chat ↔ One Session ↔ One harness conversation. Optional project + codebase context. Live SSE streaming.

> **Agent binding (AGT-01).** A chat can be driven by a first-class Agent via
> `agentRef` (+ an additive `agentOverrides` delta). At create time the resolved
> projection is FROZEN into `chats.agent_snapshot`; resume and replay must use
> that snapshot rather than re-resolving, or an agent edit would change the tool
> set of an in-flight conversation. See [feature-agents.md](./feature-agents.md).

---

## 1. Entity & DB shape

`chats` table (see [packages.md → db](./packages.md#db)):

```
id              text PK
name            text
description?    text
sessionId       FK → sessions.id (1:1)
model           text                                  (overrides workflow default)
harnessConfig   JSON HarnessConfig                    (override at chat level)
repoUrl         text                                  (single-repo legacy)
repoBranch      text
workspacePath   text                                  (legacy; superseded by workspaceId)
gitRepositories JSON Array<{url, alias}>              (multi-repo via paths)
tags            JSON string[]
status          enum 'active' | 'archived'
projectId?      FK → projects.id                      (links to project + codebases)
workspaceId?    FK → execution_workspaces.id
useWorktree     boolean (default true if projectId set)
codebaseIds     JSON string[]                         (selected codebases for worktree creation)
createdAt, updatedAt
```

Session row is always created and the harness `conversationId` matches `sessionId`.

---

## 2. Lifecycle

### 2.1 Create

API: `POST /api/chats`  
Body: `CreateChatParams` (validated by `CreateChatSchema`):

```typescript
{
  name: string;                       // required
  description?: string;
  model?: string;                     // overrides harness default; provider-specific
  tags?: string[];
  projectId?: string;                 // attach to project
  sources?: ChatSourceSpec[];         // what the agent works on — see feature-workspaces-files.md §3
  primary?: string;                   // alias of the mount that becomes cwd (default: first source)
  // legacy, still accepted and mapped onto `sources`:
  codebaseIds?: string[]; createWorktree?: boolean; gitRepositories?: Array<{ url; alias }>;
  harnessConfig?: Partial<HarnessConfig>;  // model, reasoningEffort, mcpServers, etc.
}
```

`ChatSourceSpec` = `{ kind: 'codebase', codebaseId, mode?: 'in-place'|'worktree', branch?, newBranch?, baseRef?, alias? } | { kind: 'folder', path, mode?, branch?, newBranch?, baseRef?, alias? }`. No sources at all → one `generated` mount at `source/main`.

Server-side flow ([ChatManagementService.createChat](../../packages/core/src/services/ChatManagementService.ts)):

1. Validate input, then **plan the mounts** (`MountService.plan`): every folder/codebase/branch is checked against disk and git before anything is written — a bad path or branch is a 400, not a half-created chat.
2. Create the Session row.
3. `workspaceManager.createWorkspace({ ownerType: 'chat', ownerId, projectId, gitEnabled: false, sources, primary })` — managed scratch root + `prepStatus: 'pending'`; `MountService.stage` writes the `workspace_mounts` rows.
4. Compute the exposure from the planned mounts (`workingDirectory` = primary mount, `additionalDirectories` = other mounts + managed root, `env`, the `[Workspace]` hint) and `harness.createConversation(...)` with it.
5. Insert the `chats` row (with `sources`, `primarySource`).
6. Kick off `MountService.prepare` in the background (worktrees, branch checkouts, shadow stores, baseline checkpoint → `prepStatus: 'ready'` + `workspace.prep` event) and the provider pre-warm.
7. Return the chat DTO — `workspacePrep.status` is `preparing` until step 6 finishes.

> **The first prompt waits.** `sendPrompt` awaits `MountService.ready(workspaceId)`; the composer shows "Preparing workspace…" and disables Send until the `workspace.prep` event flips it to ready, or shows the error with Retry / Edit sources. Nothing runs in a directory that does not exist yet.

### 2.2 Send prompt

API: `POST /api/chats/:id/prompt` (multipart for attachments)  
Body:
```
prompt       text
attachments? File[]
```

Server-side:
1. `chatManagementService.sendPrompt(chatId, text, attachments?)`.
2. Look up `sessionId` from chat.
3. Save user message into `chat_messages` table.
4. `harness.sendPrompt(sessionId, interpolatedPrompt, attachments)` — fire-and-forget.
5. Harness streams events through `eventBus`. The bridge routes them to scope=`chat`, id=`<chatId>` and scope=`session`, id=`<sessionId>`.
6. Server responds `202 Accepted` immediately.
7. Client receives tokens via SSE `GET /api/stream?scope=chat&id=<chatId>`.
8. Assistant final `harness.message_complete` triggers persistence to `chat_messages`.

### 2.3 Stream (live tokens)

Client subscribes to `/api/stream?scope=chat&id=<chatId>` with `Last-Event-ID` for resume. Events relevant to chat:

```
harness.session_start
harness.turn_start
harness.user_message
harness.token
harness.reasoning_delta
harness.reasoning_complete
harness.tool_start
harness.tool_complete
harness.message_complete           ← final assistant text
harness.usage                      ← tokens + cost
harness.turn_end
harness.idle
chat.archived                      (lifecycle)
chat.deleted                       (lifecycle)
chat.updated
permission.requested               (HITL — chat doesn't usually use, but allowed)
```

The web `StreamingMessage.tsx` component renders these as live "blocks" with cross-buffer flushing (do not refactor — line 160-183 of `sseManager.ts`).

### 2.4 Pause / Resume

Chats themselves don't have an explicit pause state — they always sit in `Session.status = 'active'` between prompts and `'running'` while a prompt is in flight. The underlying session can be `paused` if the user hits **Stop** mid-stream (UI sends an `abort` request and the harness aborts the in-progress prompt via `AbortController`).

Operation: `POST /api/chats/:id/stop` (mapped to `harness.abortConversation(sessionId)`).

### 2.5 Archive vs Delete

- **Archive** — `POST /api/chats/:id/archive` → sets `chat.status = 'archived'`. Session is closed (`SessionStateMachine.transition('archive')` → `closed`). Workspace is **archived** (status = `archived`, files retained per retention policy).
- **Delete** — `DELETE /api/chats/:id` → cascades to `chat_messages`, `events`, `artifacts`, drops the session, and **also** removes the workspace files if the workspace retention policy allows it.

### 2.6 Update

`PUT /api/chats/:id` supports updating `name`, `description`, `model`, `tags`, `projectId`, `codebaseIds`, `useWorktree`, `harnessConfig`. Changing `codebaseIds` requires recreating worktrees — handled by the service.

---

## 3. Right side pane (Changes / Browser / Terminal / Widget)

`ChatPage` renders a unified tabbed dock on the right — the `RightPane` component ([apps/web/src/components/layout/RightPane.tsx](../../apps/web/src/components/layout/RightPane.tsx)) — that is toggled from the streaming banner or input toolbar. It hosts four tab kinds, all workspace-scoped:

- **Changes** *(default, always present)* — `ChatFilesPanel`: workspace files, per-worktree files, response markdown, attachments. Same behaviour as the legacy Files & Uploads drawer.
- **Browser** *(add-able via `+` menu)* — the Integrated Browser panel. Disabled until the chat has a `workspaceId`. See [feature-integrated-browser.md](./feature-integrated-browser.md).
- **Terminal** *(add-able, `allowMultiple: true`)* — the Integrated Terminal panel. Multiple parallel PTYs per workspace. See [feature-integrated-terminal.md](./feature-integrated-terminal.md).
- **Widget** *(auto-added the first time the agent renders a `surface: 'widget'` widget)* — the [`WidgetHost`](../../apps/web/src/components/widgets/WidgetHost.tsx) that stacks sandboxed widget iframes served from `/api/widget-assets`. See [feature-extensions-widgets.md](./feature-extensions-widgets.md).

Tab state (which tabs are open, which is active, pane width) is persisted per-page in `localStorage:generatorai:rightPane:chat`. Tabs stay mounted (hidden inactive ones) so long-lived state — a Browser MJPEG stream, a Terminal xterm buffer — survives tab switches.

**Attach-to-chat pipeline (Browser Inspect + Terminal Attach):** both the BrowserPanel and TerminalPanel accept an `onCapture(file, kind)` callback wired to the ChatPage's `pendingCaptures` state. A yellow `📎 N capture pending` banner renders above `ChatInput`; the next `customSendFn` call merges the pending files into the outgoing message and clears the banner.

### 3.1 Changed files — in the transcript and on the composer

Two surfaces show what the agent changed, and they all name files the same way as the Changes tab (`<alias>/<path>` for a linked codebase, bare `<path>` for the workspace root — see [`changes/changePaths.ts`](../../apps/web/src/components/chat/changes/changePaths.ts) `toDisplayPath`):

- **Per-op step rows** — a `Write`/`Edit` step carries `+A −D` from `harness.tool_complete.fileOp`. Expanding the row renders an inline unified diff ([`InlineDiff.tsx`](../../apps/web/src/components/chat/InlineDiff.tsx)): the provider's `structuredPatch` hunks when it shipped them (Claude; capped at 160 lines, `hunksTruncated` links to the full diff), else rebuilt from the tool's `old_string`/`new_string`/`content`. The raw tool call stays one click away.
- **Composer tray** ([`ChatChangesTray.tsx`](../../apps/web/src/components/chat/ChatChangesTray.tsx)) — docked above the input: "N files changed in this chat · +A −D", a live pulse while file ops are still landing, an expandable tree (status letter, +/−, click → Changes tab at that file) and a **Review changes** button. The list is the workspace change summary (baseline → working tree) with the live stream's file ops overlaid until the summary refetches (1.5 s after each op, and again when the turn settles).

**What counts as a change.** When the workspace has a real codebase (a linked worktree or an agent-generated repo), files the agent scaffolds at the workspace root — an orchestrator's `orchestrator/state.json` (git-ignored by the workspace template), task summaries, notes — are hidden from the tray and from the Changes tab, behind a "+N workspace files" toggle ([`changeVisibility.ts`](../../apps/web/src/components/diff/changeVisibility.ts)). A workspace with no codebase keeps its root files: there they are the work. `artifacts/`, `uploads/`, `browser/` and `output/` never appear at all.

> The worktree of a project-bound chat is written to the `worktrees` table (keyed by the chat id), not `workspace_worktrees`; `WorkspaceManager.getWorkspaceInfo` unions both so `discoverRepos` sees `source/<alias>`. Before that union the Changes tab was empty for every project chat.

**Stopping a turn.** `harness.cancelled` force-settles the stream even when the turn had not produced a block yet, and the live transcript shows "Stopped before the agent responded." A Stop that lands while the server is still setting the turn up (resume, config, pre-turn checkpoint) is honoured in `ChatManagementService.sendPrompt` — the provider query is never started and the chat's busy claim is released. A send the server refuses (409 `CHAT_BUSY` / `INTERACTION_PENDING`) restores the draft and shows a "Message not sent" toast with the reason.

### 3.2 The activity timeline — grouping, failures, previews, history

**Grouped tool calls.** Consecutive steps of one kind (read / search / edit / run / generic tool / memory) fold into a single collapsible row — "Read 5 files", "Edited 3 files +54 −0", "navigate_page ×2" — with a count badge and the distinct targets as a sub-line; while the run is still live the row says "Reading files (3) <current target>". Thinking, sub-agent, warning and error steps never fold. The fold is pure data ([`groupSteps.ts`](../../apps/web/src/components/agent/groupSteps.ts)); the group's id is its first step's id so an open group stays open while the turn keeps appending to it. `StepGroupRow` in [`StepRow.tsx`](../../apps/web/src/components/agent/StepRow.tsx) renders it; expanding shows the ordinary rows.

**Failed tool calls** get a red cross (not a tick) and a "Failed" label. The provider's `is_error` travels as `harness.tool_complete.success` → client-core `completeToolCall(…, success)` → `ToolCallBlock.error` → step status `failed`, and is persisted as `metadata.toolCalls[].success` so history renders the same. The in-process browser tools never set `is_error` — they answer `{ ok: false, error }` — so that envelope counts too (`toolCallFailed` in `deriveTimeline.ts`).

**Expanded detail is capped**: whatever a row reveals (inline diff, raw args/result, sub-agent children) sits in a 260 px max-height panel that scrolls inside itself, so a multi-thousand-line result no longer pushes the transcript down by its full height.

**Image previews on hover** ([`ImageHoverPreview.tsx`](../../apps/web/src/components/shared/ImageHoverPreview.tsx), a Radix tooltip holding an `<img>`): composer attachment chips (object URL of the local `File`), attachment chips on sent messages, and the picture icon on a `screenshot_page` step. The step resolves its URL from the tool result's workspace-relative `artifactPath` via `GET /api/workspaces/:id/browser/files/<path>`; the workspace id reaches the row through the stream-actions context. Pasting an image into the composer attaches it.

**Attachments are persisted on the user message** (`ChatMessage.attachments[] = { name, path, mimeType, artifactId }`) and served by `GET /api/chats/:id/attachments/:artifactId` (artifact id scoped to the chat's session; images inline, everything else as a download). Before this the API stored the upload as an artifact but the message row never referenced it, so a reload showed a bare prompt.

**↑ / ↓ prompt history** ([`composer/promptHistory.ts`](../../apps/web/src/components/chat/composer/promptHistory.ts)): ↑ on the first line of the box recalls the previous prompt and re-materialises its attachments (fetched back into `File`s from the route above), ↓ on the last line walks forward, past the newest entry the parked draft returns, and editing a recalled prompt leaves history mode. The page derives the list from persisted user messages (widget/system-originated rows excluded); prompts sent this session are remembered locally until the server echoes them.

**Read aloud / Speak live** are hidden behind `READ_ALOUD_ENABLED` in [`featureFlags.ts`](../../apps/web/src/components/chat/featureFlags.ts); the feature stays intact.

**Motion.** One `ThinkingPlaceholder` (breathing orb + shimmering label) covers both the pending-turn gap and the pre-first-block state. Timeline rows enter with a 180 ms settle; a running row shows one thin indeterminate bar rather than fake paragraph shimmer. `useStickToBottom` coalesces follow writes into one per animation frame (instant while pinned — a smooth scroll would lag the next flush) and reserves smooth scrolling for the explicit "Jump to latest".

> **Line endings.** Checkpoint snapshots are byte-exact (`core.autocrlf=false`), so on Windows they hold CRLF blobs while a real commit's blobs are LF. When the Changes summary compares the working tree against a commit (a `ref` base, or the "Worktree HEAD" fallback for a linked worktree with no baseline yet) it materialises the working tree with the repo's own EOL config (`WriteTreeOptions.honourEol`, separate index file) — otherwise every file in a fresh project chat reported as fully rewritten (`+13 −13`).

### Workspace data behind the right pane

Every right-pane surface reads `chat.workspaceId` and calls the workspace routes: `GET /api/workspaces/:id` (mounts, prepStatus), `/changes` (per mount, kind `mount`/`nested`), `/tree` (Files tab), `/checkpoints` (rewind), `/files` (@-mention index: one `worktrees[]` entry per mount, in-place included). The **Sources** block lists the mounts (alias, mode, branch, path, status, dirty dot) and opens the same source editor as the create dialog, submitting `PUT /api/chats/:id/sources`. Full contract: [feature-workspaces-files.md](./feature-workspaces-files.md) §7.

> **Legacy chats:** workspaces created before v51 get their mounts back-filled on first read, so the panel keeps working; their old checkpoints stay in the mount's own `.git`.

---

## 4. Configurations & where they live

| Config | Set at | Persists in | Notes |
|---|---|---|---|
| `model` | dialog / API / project setting | `chats.model` (override) or harness default | Provider-specific. Falls back to `AppConfig.copilot.defaultModel` / `harness.claudeAgent.defaultModel`. |
| `reasoningEffort` | input toolbar dropdown | `harnessConfig` (chat-level) | 5 options: Default / Low / Medium / High / Extra High. |
| `tools` (custom) | SDK only (`ai.tools.register`) | n/a | Tools registered via SDK appear in all subsequent chats. |
| `availableTools` / `excludedTools` | chat-level via `harnessConfig` | `chats.harness_config` | `['*']` = all enabled. |
| `skillDirectories` / `disabledSkills` | chat-level via `harnessConfig` | `chats.harness_config` | Plus project skills auto-resolved. |
| `customAgents` | chat-level via `harnessConfig`; also `agentName` shortcut | `chats.harness_config` | One main agent per chat is common. |
| `mcpServers` | chat-level via `harnessConfig` + system + project | `chats.harness_config` | Merged: system + project + chat override. |
| `permissionMode` | chat-level `harnessConfig.onPermissionRequest` | n/a (handler) | For HITL chats. |
| `tags` | dialog | `chats.tags` | UI filter only. |
| `projectId` | dialog | `chats.project_id` | Triggers worktree creation. |
| `codebaseIds` | dialog | `chats.codebase_ids` | 0..3 codebases. |
| `gitRepositories` | API only (advanced) | `chats.git_repositories` | Bypass project; ad-hoc URLs. |
| `useWorktree` | dialog toggle | `chats.use_worktree` | Default true when projectId set. |
| `contextTier` | model picker → "Model details" | `harnessConfig.contextTier` | `'default'` (e.g. 200K) or `'long_context'` (1M) for models that expose a long-context tier — e.g. `sonnet[1m]`. Surfaced only when `model.supportsLongContext` is true. |

### 4.1 Model picker (input toolbar)

The model dropdown in the chat input is driven by a **live provider catalog**, not a hardcoded list:

- `GET /api/harness/models` returns every model across all *ready* providers, each tagged with `provider`. `GET /api/copilot/models` is the legacy single-provider alias still used by the chat input.
- Each entry carries rich metadata rendered in the "Model details" popover: `contextWindow`, `standardContextWindow`, `supportsLongContext`, `supportsReasoning`, `reasoningEfforts[]`, `defaultReasoningEffort`, `category` (`versatile` / `lightweight` / …), `description` (incl. pricing when the provider reports it).
- The provider toggle row at the top of the dropdown shows each provider's readiness. An unauthenticated provider is rendered **disabled** with its error message as the tooltip (e.g. *"GitHub Copilot — unavailable: Request models.list failed with message: Not authenticated."*), so a broken provider can never be silently selected.
- **Refresh model list** re-queries with `?refresh=1`, bypassing the registry cache.
- Provider brand icons (`BrandIcons.tsx`) render the GitHub Copilot octomark and the Anthropic glyph.

### 4.2 Voice input (speech-to-text)

The mic button next to Send streams microphone audio to a **local** transcriber over a dedicated WebSocket (`apps/server/src/stt-ws.ts`; client hook `useSpeechToText.ts`). Transcribed text goes into the textarea, so it composes with typing and attachments. Runs fully on-device — no cloud key required.

Four engines are available (`VoiceEngineFactory.ts` holds the measured
head-to-head). `auto` picks **Nemotron** when its weights are downloaded and
**Moonshine** otherwise, always keeping Whisper as the last resort.

Nemotron is the only one with a **native streaming decoder**, and that is the
difference between words appearing as you speak them and a block of text
landing after each pause. On the other three the server segments on silence
and previews the open utterance in blocks; on Nemotron the model itself emits
a growing transcript roughly every 560ms. It is also the only multilingual
engine (40 language-locales, auto-detected).

**The weights are ours and are never downloaded automatically.** The model is
the streaming ONNX export of Nemotron 3.5 ASR from
`onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4` — about 790MB,
fetched only when someone presses **Download model** in Settings → Audio, and
stored under this app's own cache root. An earlier version read the weights
out of VS Code's dictation cache; that was removed, because a user need not
have VS Code, may never have enabled its dictation, and that directory belongs
to another application that can clean it up underneath us.

Without the download, dictation still works on Moonshine — English only, no
live streaming, weaker on technical words. Settings → Audio says so rather
than implying voice is broken.

Everything the engine needs (vocab size, blank id, cache sizes, chunk length,
mel parameters, and whether the encoder takes a `lang_id` prompt) is read from
the model's own `genai_config.json`, because the published exports genuinely
differ and the wrong constants still RUN — returning fluent nonsense rather
than an error.

Settings → **Audio** exposes engine choice, spoken-punctuation handling, the
end-of-utterance pause, and the TTS voice/speed. Every control there is wired;
the engine picker reports when `GENERATORAI_STT_ENGINE` has pinned it.

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_STT` | `1` | Set `0` to disable voice input (button hidden, WS returns 501). |
| `GENERATORAI_STT_ENGINE` | `auto` | `auto`, `nemotron`, `moonshine`, `parakeet`, `whisper`, `disabled`. Anything but `auto` disables the fallback cascade. |
| `GENERATORAI_STT_PREFERRED` | per machine | Which engine `auto` tries first. Defaults to `nemotron` when its weights are present, else `moonshine`. |
| `GENERATORAI_NEMOTRON_ONNX_DIR` | our cache | Explicit path to the Nemotron streaming ONNX export. |
| `GENERATORAI_NEMOTRON_LANG_ID` | `0` (auto-detect) | Language prompt id for the multilingual build. Auto measured best — forcing a locale dropped punctuation. |
| `GENERATORAI_NEMOTRON_ENDPOINT_MS` | `500` | Silence that ends an utterance on the streaming path. |
| `GENERATORAI_NEMO_SPEECH_BIN` | unset | Path to NVIDIA's NeMo-Speech.cpp binary. Set it to run Nemotron through NVIDIA's own runtime (the only route to GPU execution) instead of in-process ONNX. |
| `STT_MODEL` | `Xenova/whisper-base.en` | Whisper model id. |
| `STT_CACHE_DIR` | platform cache dir | Where the model weights are cached on first run. |

### 4.3 Stop generation + conversation recovery

- **Stop** — the Send button becomes **Stop generation** while a turn is in flight. `POST /api/chats/:id/cancel` aborts the harness turn, closes the stream and emits `harness.idle`.
- **Conversation recovery** — `ChatManagementService.ensureConversation()` rebuilds the harness conversation from the persisted `Chat` entity if the underlying SDK conversation was destroyed (server restart, archive/unarchive, provider switch). Because tool *handlers* can't be serialized into the SDK's session store, the rebuild re-registers them via `resumeConversation(id, params)` — a bare resume would restore history without tools and the model would then refuse tool-using tasks.

---

## 5. Streaming durability + edge cases

- **Disconnect mid-stream** — Browser auto-reconnects via EventSource with `Last-Event-ID`. Server `StreamBroker` replays missed events from `stream_cursors`. UI receives the gap-fill events and replays into `StreamingMessage`.
- **Process restart** — Server boots, `StartupRecoveryService` does not currently auto-resume in-flight chat prompts (they were fire-and-forget). The user can re-send.
- **Tokens out of order** — Prevented by the `EventBus` per-session promise queue (sequential emit).
- **Tool result before message_complete** — Common with Copilot; the renderer treats `tool_complete` and subsequent `message_complete` events as the same conceptual turn via `turn_start`/`turn_end` framing.
- **Cancellation during tool execution** — `AbortController` is passed into `sendPromptAndWait`; tool subprocess is killed via signal propagation.
- **Permission requests** — If `permissionMode != 'bypassPermissions'`, the harness emits `permission.requested` events; UI prompts the user (chat doesn't currently use HITL banners — that's a workflow run feature). Configure permission mode in the chat via `harnessConfig`.

---

## 6. CLI

```powershell
generatorai chat list [--status active|archived] [--project <projId>]
generatorai chat create <name> [--description "..."] [--model claude-sonnet-4.6] [--project <id>] [--worktree] [--tags tag1 tag2]
generatorai chat show <id>
generatorai chat send <id> "<prompt>"
generatorai chat messages <id> [--limit 50] [--offset 0]
generatorai chat watch <id>                                              # subscribes to SSE and renders tokens live
generatorai chat archive <id>
generatorai chat delete <id>
```

`chat watch` uses `EventRenderer` from [apps/cli/src/streaming/](../../apps/cli/src/streaming/) to render thinking, tokens, tool calls, and final messages.

---

## 7. SDK

```typescript
const chat = await ai.chat.create({
  name: 'Bug triage',
  projectId: 'proj-123',
  tags: ['triage'],
  model: 'claude-sonnet-4.6',
});

// Subscribe to events
const unsub = await ai.chat.onMessage(chat.id, (event) => {
  if (event.kind === 'harness.token') process.stdout.write(event.data.text);
  if (event.kind === 'harness.message_complete') console.log('\n---DONE---');
});

await ai.chat.send(chat.id, 'Summarize open issues from the last 7 days.');

// Optionally drain history
const messages = await ai.services.chatMessageRepository.getByChatId(chat.id);
```

---

## 8. Common operations & quick reference

| Action | Web | CLI | SDK | Server |
|---|---|---|---|---|
| Create | `+ New Chat` button → dialog | `chat create <name>` | `ai.chat.create({...})` | `POST /api/chats` |
| Send | input textarea → Enter | `chat send <id> "..."` | `ai.chat.send(id, text)` | `POST /api/chats/:id/prompt` |
| List | `/chats` page | `chat list` | `ai.chat.list()` | `GET /api/chats` |
| Watch | open the chat page | `chat watch <id>` | `ai.chat.onMessage(id, h)` | `GET /api/stream?scope=chat&id=<id>` |
| Stop streaming | red "Stop" button in input | Ctrl-C while watching | abort via SDK service | `POST /api/chats/:id/stop` |
| Archive | menu → Archive | `chat archive <id>` | `ai.chat.archive(id)` | `POST /api/chats/:id/archive` |
| Delete | menu → Delete (confirm) | `chat delete <id>` | `ai.services.chatManagementService.delete(id)` | `DELETE /api/chats/:id` |
| View files | "Files & Changes" toggle in banner | n/a yet | `ai.services.workspaceManager.listFiles(...)` | `GET /api/chats/:id/workspace` |
| Browse codebase | left pane in ChatInput → expand | `project codebase browse <pid> <cid>` | via project service | `GET /api/projects/:pid/codebases/:cid/files` |
