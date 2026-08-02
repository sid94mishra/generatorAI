# Feature: Chat

> Direct conversational AI interaction. One Chat ↔ One Session ↔ One harness conversation. Optional project + codebase context. Live SSE streaming.

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
  codebaseIds?: string[];             // 0..3 codebases to mount as worktrees
  createWorktree?: boolean;           // default true if projectId+codebaseIds present
  gitRepositories?: Array<{           // alternative to projectId for ad-hoc paths
    url: string;
    alias: string;
  }>;
  useWorktree?: boolean;              // when projectId set
  harnessConfig?: Partial<HarnessConfig>;  // model, reasoningEffort, mcpServers, etc.
}
```

Server-side flow ([ChatManagementService.createChat](../../packages/core/src/services/ChatManagementService.ts)):

1. Validate input.
2. `sessionService.createSession({ ownerType: 'chat', ownerId: chatId })` — allocates a Session row + transitions through `SessionStateMachine`.
3. **If `workspaceManager` is wired and `projectId|gitRepositories` set:**
   - `workspaceManager.createWorkspace({ ownerType: 'chat', ownerId, projectId, useWorktree, gitEnabled, stageSystemArtifacts: true })` — creates execution workspace + DB row.
   - `worktreeService.createRunWorktrees(projectId, chatId, codebaseIds, 'manual', targetDir)` — copies/checks-out the selected codebases into `<workspace>/source/<alias>/`.
   - First worktree path becomes `__workingDirectory`.
4. Insert `chats` row.
5. `harness.createConversation({ conversationId: sessionId, model, systemMessage, tools, workingDirectory, … })`.
6. Emit `chat.created` event on EventBus.
7. Return chat DTO.

> **Edge case — worktree creation latency:** for large repos this can take 10-30s. The dialog shows the "create chat" mutation pending until the API returns. Frontend code already uses `mutateAsync()` — don't refactor to fire-and-forget without handling the pending state in the UI.

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

### `GET /api/chats/:id/workspace` (Changes tab data)

```jsonc
{
  "workspaceId": "...",
  "workspaceFiles": ["foo.ts", "src/util.ts"],       // generated files in workspace root
  "artifactFiles":  ["responses/stage-1.md"],         // assistant response files
  "sourceFiles":    [],                               // (typically empty for chat)
  "worktrees": [
    { "alias": "main-repo", "files": ["src/index.ts", …] }
  ]
}
```

`GET /api/chats/:id/workspace/files?filePath=...&source=workspace|artifacts|source|worktree&worktreeAlias=...` returns raw file content with syntax highlighting in the modal.

> **Edge case — `workspaceId` missing:** if the chat predates the workspace migration (v8) and `useWorktree: false`, the panel will be empty. The fix is to either re-create the chat or run `POST /api/chats/:id/workspace/create` (admin endpoint) to backfill.

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

The mic button next to Send streams microphone audio to a **local Whisper** transcriber over a dedicated WebSocket (`apps/server/src/stt-ws.ts`; client hook `useSpeechToText.ts`). Transcribed text is appended into the textarea, so it composes with typing and attachments. Runs fully on-device — no cloud key required.

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_STT` | `1` | Set `0` to disable voice input (button hidden, WS returns 501). |
| `STT_MODEL` | `Xenova/whisper-base.en` | Whisper model id to load. |
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
