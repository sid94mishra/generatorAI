# GeneratorAI CLI/TUI — Final Implementation Plan

## Context

The existing CLI (`apps/cli/`) has been deprecated. We are building a new CLI from scratch that provides **full feature parity** with the web UI and all 120+ server API endpoints. The new CLI follows modern agentic CLI patterns (Claude Code, Codex CLI, Aider) while supporting GeneratorAI's unique DAG-based workflow orchestration, real-time streaming, and human-in-the-loop capabilities.

**Why:** The platform needs a terminal-native interface for power users, CI/CD integration, scripted automation, and developers who prefer terminal workflows. The old CLI had architectural issues (prop drilling, no shared state, incomplete feature coverage).

**Outcome:** A production-grade CLI with two modes — scriptable commands (`generatorai <noun> <verb>`) and a full-screen interactive TUI (`generatorai tui`).

---

## 1. Package Architecture

### Location & Identity

```
apps/cli/                    # New package (old CLI already at apps/cli_depricated/)
├── package.json             # @generatorai/cli, bin: "generatorai"
├── tsconfig.json            # extends ../../tsconfig.base.json, jsx: react-jsx
├── vitest.config.ts
└── src/
    ├── index.tsx            # Entry: Commander setup, global opts, getClient()
    ├── instrumentation.ts   # OpenTelemetry bootstrap
    │
    ├── commands/            # Commander subcommand registrations (18 files)
    │   ├── index.ts         # registerAllCommands(program, getClient)
    │   ├── chat.ts          # chat start|list|show|resume|send|messages|update|archive|delete
    │   ├── workflow.ts      # workflow create|list|show|update|delete|validate|import-*|export
    │   ├── stage.ts         # workflow stage add|update|remove
    │   ├── edge.ts          # workflow edge add|remove
    │   ├── run.ts           # run create|start|list|show|watch|pause|resume|cancel|retry|delete|logs|artifacts|workspace|diff
    │   ├── run-control.ts   # run stage-*|permission-mode|pending|approve
    │   ├── orchestrator.ts  # orchestrator templates|start|context|cancel|files|upload-files|download|content|diff
    │   ├── automation.ts    # automation CRUD + trigger + rotate-token
    │   ├── automation-exec.ts # automation executions|execution|cancel-exec|watch-exec|test-data-source
    │   ├── project.ts       # project CRUD
    │   ├── codebase.ts      # project codebase link|list|unlink|fetch|branches|browse|file|status
    │   ├── project-config.ts # project config upload|list|show|update|delete + mcp-server add|list|update|remove + available-artifacts
    │   ├── template.ts      # template list|show
    │   ├── config.ts        # config show|set|get|edit|reset + profile list|create|use|delete
    │   ├── system.ts        # health|health-config|models|status|artifacts|mcp-servers
    │   ├── copilot.ts       # copilot conversations|messages|ping
    │   ├── session.ts       # session messages
    │   ├── workspace.ts     # workspace list|show|commit|archive|delete|cleanup|worktrees
    │   ├── webhook.ts       # webhook create|list|delete
    │   ├── hook.ts          # hook list|test
    │   ├── tui.ts           # launches the interactive TUI app
    │   ├── init.ts          # scaffolds ~/.generatorai/
    │   └── completions.ts   # completions bash|zsh|fish|powershell
    │
    ├── platform/            # Platform client abstraction
    │   ├── types.ts         # CLIPlatformClient extended interface
    │   ├── HttpPlatformClient.ts  # REST + SSE, talks to server
    │   ├── DirectPlatformClient.ts # In-process, embeds core
    │   ├── composition-root.ts    # DI container for direct mode
    │   └── createClient.ts        # Factory: http | direct | auto
    │
    ├── config/              # 5-layer configuration
    │   ├── loadConfig.ts    # Merge: defaults → user → project → env → CLI flags
    │   ├── schema.ts        # Zod schema for CLI-specific config
    │   ├── paths.ts         # ~/.generatorai/, project .generatorai/
    │   └── profileManager.ts # Named profiles
    │
    ├── tui/                 # Full-screen Ink TUI application
    │   ├── App.tsx          # Root component, view router, global keybindings
    │   ├── Router.tsx       # View stack + navigation context
    │   ├── theme.ts         # Colors, icons, box-drawing, keybindings
    │   ├── stores/          # Zustand stores (8)
    │   │   ├── appStore.ts          # view stack, connection, terminal dims, inputMode, notifications
    │   │   ├── chatStore.ts         # chat list, active chat, messages
    │   │   ├── workflowStore.ts     # definitions, active def stages/edges
    │   │   ├── runStore.ts          # runs list, active run, stage statuses, timeline
    │   │   ├── streamStore.ts       # per-entity StreamBlock arrays
    │   │   ├── automationStore.ts   # automation list, execution state
    │   │   ├── projectStore.ts      # project list, codebase cache
    │   │   └── configStore.ts       # resolved config, active profile
    │   ├── hooks/           # Custom React hooks
    │   │   ├── useSSE.ts            # SSE subscription lifecycle (with reconnect + REST replay fallback)
    │   │   ├── usePolling.ts        # Interval refresh
    │   │   ├── useKeymap.ts         # Context-aware keybinding
    │   │   └── useNavigation.ts     # Navigation context
    │   ├── views/           # Full-screen view components (15)
    │   │   ├── DashboardView.tsx
    │   │   ├── ChatListView.tsx
    │   │   ├── ChatView.tsx         # Interactive chat with streaming
    │   │   ├── WorkflowListView.tsx
    │   │   ├── WorkflowDetailView.tsx  # ASCII DAG of definition
    │   │   ├── WorkflowRunListView.tsx
    │   │   ├── WorkflowRunView.tsx  # Live DAG progress + per-stage streaming
    │   │   ├── AutomationListView.tsx
    │   │   ├── AutomationDetailView.tsx
    │   │   ├── AutomationExecView.tsx
    │   │   ├── ProjectListView.tsx
    │   │   ├── ProjectDetailView.tsx
    │   │   ├── TemplateListView.tsx
    │   │   ├── PendingApprovalsView.tsx  # HITL approval UI
    │   │   └── SettingsView.tsx
    │   └── components/      # Reusable TUI components (20+)
    │       ├── StreamingOutput.tsx   # Renders StreamBlocks: thinking, text, tools, usage, system
    │       ├── DAGVisualization.tsx  # ASCII DAG with dagre layout, color-coded status
    │       ├── ChatMessage.tsx      # Single message with markdown
    │       ├── TextInput.tsx        # Multi-line, history, autocomplete
    │       ├── Table.tsx            # Sortable/filterable data table
    │       ├── StatusBadge.tsx      # Color-coded status indicators
    │       ├── ToolCallDisplay.tsx  # Collapsible tool call with args/result
    │       ├── MarkdownRenderer.tsx # Terminal-safe markdown
    │       ├── CodeBlock.tsx        # Syntax-highlighted code
    │       ├── Panel.tsx            # Bordered panel with title
    │       ├── SelectList.tsx       # Arrow-key navigable list
    │       ├── ConfirmDialog.tsx    # Y/N confirmation prompt
    │       ├── Tabs.tsx
    │       ├── Header.tsx           # Top bar: logo, connection, breadcrumb
    │       ├── StatusBar.tsx        # Bottom bar: keybindings, mode
    │       ├── Spinner.tsx
    │       ├── ProgressBar.tsx
    │       ├── ErrorBox.tsx
    │       ├── ErrorBoundary.tsx    # Catches React errors, prevents TUI crash
    │       └── HelpOverlay.tsx      # Keybinding reference
    │
    ├── output/              # Non-interactive output formatters
    │   ├── json.ts          # --json flag: raw JSON
    │   ├── table.ts         # Human-readable table
    │   └── format.ts        # Unified dispatcher
    │
    └── utils/
        ├── constants.ts
        ├── formatDuration.ts
        ├── clipboard.ts
        ├── pager.ts         # Pipe long output through $PAGER
        └── retry.ts         # HTTP retry with exponential backoff (429/5xx)
```

### Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| CLI framework | Commander 13 | Already in monorepo, excellent subcommand nesting, completion plugins |
| TUI framework | Ink 5 (React for CLI) | Team has React expertise, matches web patterns, testable with ink-testing-library |
| State management | Zustand 5 | Matches web app pattern, eliminates prop drilling |
| SSE client | eventsource 4 | Auto-reconnect, Last-Event-ID support |
| Markdown | marked + marked-terminal | Terminal-safe markdown rendering |
| Syntax highlighting | cli-highlight | Code block coloring |
| DAG layout | @dagrejs/dagre | Same lib used by web's React Flow |
| Testing | Vitest + ink-testing-library | Component + unit testing |

### Key Dependencies

```json
{
  "@generatorai/shared": "workspace:*",
  "@generatorai/core": "workspace:*",
  "@generatorai/db": "workspace:*",
  "@generatorai/copilot-bridge": "workspace:*",
  "commander": "^13.1.0",
  "ink": "^5.2.1",
  "ink-spinner": "^5.0.0",
  "react": "^18.3.1",
  "zustand": "^5.0.11",
  "eventsource": "^4.1.0",
  "chalk": "^5.6.2",
  "marked": "^15.0.0",
  "marked-terminal": "^7.3.0",
  "cli-highlight": "^2.1.11",
  "@dagrejs/dagre": "^1.1.4"
}
```

> **React version note:** Ink 5.x targets React 18. The CLI package uses React 18.3.x (can differ from web app's React 19 in pnpm workspaces). Before Phase 1, verify if Ink has released React 19 support — if so, upgrade to match.

---

## 2. Complete Command Hierarchy

### Global Options

```
generatorai [global-opts] <noun> <verb> [args] [--flags]

Global:
  -V, --version              Print version
  -c, --config <path>        Config file override
  -v, --verbose              Verbose logging
  -q, --quiet                Suppress non-essential output
  --json                     Machine-readable JSON output
  --server <url>             Server URL (default: http://localhost:3100)
  --direct                   Direct mode (in-process, no server)
  --profile <name>           Named config profile
  --no-color                 Disable color
  --api-key <key>            API key for auth
  --wait                     Block until async op completes (run start, automation trigger)
  --timeout <seconds>        Max wait time with --wait (default: 300s)
  --log-file <path>          Write debug logs to file
  --log-level <level>        Log verbosity: debug|info|warn|error
```

### Exit Code Conventions

```
0   — Success
1   — General error (API failure, validation error)
2   — Timeout (--wait exceeded --timeout)
3   — Cancelled (user Ctrl+C or server-side cancellation)
4   — Not found (resource doesn't exist)
5   — Auth failure (invalid/missing API key)
126 — Cannot execute (missing dependencies)
127 — Command not found
```

### Full Command Tree

```
generatorai
├── tui                                         # Launch interactive TUI
├── init                                        # Initialize ~/.generatorai/
├── completions <bash|zsh|fish|powershell>      # Output shell completion script
├── examples                                    # Show usage examples
│
├── chat
│   ├── start [--name] [--model] [--project]    # Create + interactive session
│   ├── list [--status] [--limit] [--project]
│   ├── show <id>                               # Details + messages
│   ├── resume <id>                             # Re-enter existing chat
│   ├── send <id> <prompt> [--file]...          # Non-interactive prompt
│   ├── messages <id> [--limit] [--offset]
│   ├── update <id> [--model] [--name]
│   ├── archive <id>
│   └── delete <id>
│
├── workflow
│   ├── create [--name] [--description] [--project]
│   ├── list [--project]
│   ├── show <id>                               # Show def with ASCII DAG
│   ├── update <id> [--name] [--description]
│   ├── delete <id>
│   ├── validate <id>                           # Validate DAG structure
│   ├── import-template <templateId> [--name]
│   ├── import-json <file>
│   ├── export <id> [--output <file>]
│   ├── stage
│   │   ├── add <defId> --name <n> --prompt <p> [--order] [--model]
│   │   ├── update <defId> <stageId> [--name] [--prompt] [--model]
│   │   └── remove <defId> <stageId>
│   └── edge
│       ├── add <defId> --from <id> --to <id> [--type on_success|on_failure|on_completion|always]
│       └── remove <defId> <edgeId>
│
├── run
│   ├── create <definitionId> [--var key=val]... [--project] [--codebase]...
│   ├── start <runId> [--wait] [--timeout]      # Start execution (--wait blocks until done)
│   ├── list [--definition] [--status] [--limit]
│   ├── show <runId>                            # Run + stage statuses
│   ├── watch <runId>                           # Live DAG progress (streaming)
│   ├── pause <runId>
│   ├── resume <runId>
│   ├── cancel <runId>
│   ├── retry <runId>
│   ├── delete <runId>
│   ├── logs <runId> [--stage <stageId>]
│   ├── artifacts <runId>
│   ├── workspace <runId>
│   ├── diff <runId>
│   ├── stage-pause <runId> <stageId>
│   ├── stage-resume <runId> <stageId>
│   ├── stage-retry <runId> <stageId>
│   ├── stage-cancel <runId> <stageId>
│   ├── permission-mode <runId> [mode]          # Get/set HITL mode
│   ├── pending <runId>                         # List pending interrupts
│   └── approve <runId> <stageId> [--reject] [--value <v>] [--reason <r>]
│
├── orchestrator
│   ├── templates                               # List system workflow templates
│   ├── template <id>                           # Show template details
│   ├── create-from-template <templateId> [--name] [--var key=val]... [--git-repo]...
│   ├── start <definitionId> [--var key=val]... [--project] [--codebase]... [--wait]
│   ├── context <runId>                         # Get orchestration context
│   ├── cancel <runId>
│   ├── upload-files <runId> --category <skills|agents|prompts> --file <path>...
│   ├── files <definitionId>                    # List workflow definition files
│   ├── upload-def-files <definitionId> --category <c> --file <path>...
│   ├── download-def-file <definitionId> --path <p>
│   ├── delete-def-file <definitionId> --path <p>
│   ├── workspace <runId>                       # Full workspace info
│   ├── download <runId> --path <p> [--source workspace|artifacts|uploads|worktree]
│   ├── content <runId> --path <p> [--source]   # Read file as text (max 1MB)
│   └── diff <runId>                            # Git diff for workspace repos
│
├── automation
│   ├── create --name <n> --workflow <defId> [--trigger manual|schedule|webhook] [--cron <expr>]
│   ├── list [--project]
│   ├── show <id>                               # Details + recent executions
│   ├── update <id> [--name] [--cron] [--workflow]
│   ├── enable <id>
│   ├── disable <id>
│   ├── trigger <id> [--wait] [--timeout]       # Manual trigger
│   ├── delete <id>
│   ├── rotate-token <id>                       # Regenerate webhook token
│   ├── test-data-source --config <file>
│   ├── executions <id> [--limit]
│   ├── execution <automationId> <execId>
│   ├── cancel-exec <automationId> <execId>
│   └── watch-exec <automationId> <execId>
│
├── project
│   ├── create --name <n> [--description] [--root-path]
│   ├── list [--status active|archived]
│   ├── show <id>
│   ├── update <id> [--name] [--description]
│   ├── delete <id> [--force]
│   ├── available-artifacts <id> [--type]       # Merged system+project artifacts
│   ├── codebase
│   │   ├── link <projectId> --alias <a> --type <git-remote|git-local|local-dir> [--url] [--local-path]
│   │   ├── list <projectId>
│   │   ├── update <projectId> <codebaseId> [--alias] [--branch]
│   │   ├── unlink <projectId> <codebaseId>
│   │   ├── fetch <projectId> <codebaseId>
│   │   ├── branches <projectId> <codebaseId>
│   │   ├── status <projectId> <codebaseId>
│   │   ├── browse <projectId> <codebaseId> [path]
│   │   └── file <projectId> <codebaseId> --path <p>
│   ├── config
│   │   ├── upload <projectId> --type <agent|prompt|skill> --file <path>
│   │   ├── list <projectId> [--type]
│   │   ├── show <projectId> <configId>
│   │   ├── update <projectId> <configId> --file <path>
│   │   └── delete <projectId> <configId>
│   ├── mcp-server
│   │   ├── add <projectId> --name <n> [--type stdio|sse] [--command] [--url]
│   │   ├── list <projectId>
│   │   ├── update <projectId> <serverId> [--name] [--command] [--url]
│   │   └── remove <projectId> <serverId>
│   └── worktree
│       ├── list <projectId>
│       ├── remove <projectId> <worktreeId>
│       └── cleanup <projectId>
│
├── template
│   ├── list [--category]
│   └── show <id>
│
├── workspace
│   ├── list [--project] [--owner-type] [--status] [--limit] [--offset]
│   ├── show <id>
│   ├── worktrees <id>                          # List worktrees for workspace
│   ├── commit <id> [--message]
│   ├── archive <id>
│   ├── delete <id>
│   └── cleanup [--retention-hours] [--max-disk-mb]
│
├── webhook
│   ├── create --name <n> --source <s> --event-type <e> [--template] [--condition]
│   ├── list
│   └── delete <id>
│
├── hook
│   ├── list                                    # List all 22 hook phases
│   └── test <sessionId> --phase <p> [--payload-file <f>]
│
├── copilot
│   ├── conversations                           # List active conversations
│   ├── messages <conversationId>               # Get conversation messages
│   └── ping                                    # Health ping
│
├── session
│   └── messages <sessionId> [--stage-run-id]   # Per-session/stage chat history
│
├── system
│   ├── health                                  # Server health check
│   ├── health-config                           # Public (non-sensitive) config
│   ├── models                                  # List available AI models
│   ├── status                                  # Copilot client state
│   ├── artifacts [--type agent|prompt|skill]
│   └── mcp-servers                             # System-level MCP servers
│
└── config
    ├── show                                    # Display resolved config
    ├── set <key> <value>
    ├── get <key>
    ├── edit                                    # Open in $EDITOR
    ├── reset
    └── profile
        ├── list
        ├── create <name>
        ├── use <name>
        └── delete <name>
```

---

## 3. TUI Architecture

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ GeneratorAI │ ● Connected │ Dashboard > Workflow Runs     [?]Help │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     Active View Content                           │
│              (fills remaining terminal height)                    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [d]ash [c]hat [w]orkflow [r]uns [a]uto [p]roject │ Esc:back q:quit│
└──────────────────────────────────────────────────────────────────┘
```

### Views (15 total)

| View | Description |
|------|-------------|
| DashboardView | Stats (active chats, runs, automations), recent activity, quick actions |
| ChatListView | Browse/search/create chats with status filters |
| ChatView | Interactive chat with real-time streaming (main use case) |
| WorkflowListView | Browse workflow definitions |
| WorkflowDetailView | Show definition with ASCII DAG visualization |
| WorkflowRunListView | Browse runs with status filters |
| WorkflowRunView | Live DAG progress, per-stage streaming output, timeline |
| AutomationListView | Browse automations with enable/disable toggles |
| AutomationDetailView | Automation config + execution history |
| AutomationExecView | Live execution monitoring |
| ProjectListView | Browse projects |
| ProjectDetailView | Project codebases, configs, MCP servers |
| TemplateListView | Browse and import workflow templates |
| PendingApprovalsView | HITL: approve/reject pending stage interrupts |
| SettingsView | Config editor with profile management |

### Global Keybindings (when not in text input mode)

| Key | Action |
|-----|--------|
| `d` | Dashboard |
| `c` | Chat list |
| `w` | Workflow list |
| `r` | Run list |
| `a` | Automation list |
| `p` | Project list |
| `?` | Help overlay |
| `Esc` | Go back |
| `q` | Quit (with confirm if active streams) |
| `/` | Focus search/filter |
| `n` | New (context-dependent: new chat, new workflow, etc.) |
| `R` | Refresh current view |

### Error Isolation

Each view is wrapped in `<TUIErrorBoundary>` — an Ink-compatible React error boundary that catches unhandled errors and renders: error message + stack + "press r to retry, q to quit". Prevents a single view crash from taking down the entire TUI process.

---

## 4. Platform Client Strategy

### Interface: `CLIPlatformClient`

Extends `IPlatformClient` from `@generatorai/shared` with all additional methods covering every server endpoint:

```typescript
interface CLIPlatformClient extends IPlatformClient {
  // Chat, Workflow Definitions, Workflow Runs, Orchestrator,
  // Automations, Projects, Codebases, Configs, MCP Servers,
  // Workspaces, Templates, Webhooks, Hooks, Copilot, Sessions,
  // System — 100+ methods total

  // SSE subscription
  subscribeToStream(scope: string, id: string, handler: EventHandler, opts?: SSEOpts): () => void;
  streamReplay(scope: string, id: string, afterSeq: number, limit: number): Promise<ReplayResult>;
}
```

### Two Implementations

| Mode | When | Capabilities |
|------|------|-------------|
| **HttpPlatformClient** (default) | Server running at `--server` URL | Full feature set, all endpoints |
| **DirectPlatformClient** | `--direct` flag, offline use | Core features only |

### Direct Mode Capability Matrix

| Command Group | HTTP | Direct |
|---------------|------|--------|
| chat | ✓ | ✓ |
| workflow | ✓ | ✓ |
| run | ✓ | ✓ |
| orchestrator | ✓ | ✗ (requires server workspace management) |
| automation | ✓ | ✗ (requires server cron scheduler) |
| project | ✓ | ✗ (requires server codebase management) |
| workspace | ✓ | ✗ (requires server workspace lifecycle) |
| template | ✓ | ✓ (reads from templates/ dir) |
| system | ✓ | Partial (models ✓, health ✗) |
| config | ✓ | ✓ |
| copilot | ✓ | ✓ |
| webhook/hook | ✓ | ✗ |

---

## 5. Streaming / SSE Architecture

### Connection Model

```
Server: GET /api/stream?scope={scope}&id={id}&filter={kinds}
  ↓ SSE (Server-Sent Events)
CLI: eventsource package (auto-reconnect + Last-Event-ID)
  ↓ Parse PersistedEvent
CLI: Event Router (kind → handler)
  ↓ Build StreamBlocks
CLI: Zustand streamStore
  ↓ React re-render (throttled 20fps / 50ms)
CLI: Ink components (StreamingOutput, DAGVisualization, etc.)
```

### StreamBlock Types

```typescript
type StreamBlock =
  | { type: 'thinking'; content: string; done: boolean }
  | { type: 'text'; content: string; done: boolean }
  | { type: 'tool_call'; tool: string; args: object; result?: string; status: 'running'|'success'|'error'; callId: string }
  | { type: 'usage'; model: string; inputTokens: number; outputTokens: number; durationMs: number }
  | { type: 'system'; level: 'info'|'warn'|'error'; message: string; source?: string }
  | { type: 'prompt'; label: string }
  | { type: 'code'; language: string; filename?: string; content: string }
```

### Event Routing (40+ event kinds → StreamBlocks)

| Event Kind | StreamBlock |
|-----------|-------------|
| harness.reasoning_delta | Append to current ThinkingBlock |
| harness.reasoning_complete | Close ThinkingBlock |
| harness.token | Append to current TextBlock |
| harness.message_complete | Close TextBlock |
| harness.tool_start | New ToolCallBlock (status: running) |
| harness.tool_complete | Update ToolCallBlock (status: success/error) |
| harness.usage | New UsageBlock |
| harness.error | New SystemBlock (level: error) |
| stage_run.running | New PromptBlock |
| stage_run.completed/failed/cancelled | SystemBlock |
| git.*, script.*, hook.* | SystemBlock |
| permission.requested | Trigger HITL prompt |

### Rendering Strategy

**Non-TUI streaming commands** (`chat start`, `run watch`):
- Ink `render()` with StreamingOutput component
- Completed blocks move to `<Static>` (never re-rendered — sliding window pattern)
- Live block updates in dynamic area below
- Process exits on terminal event

**TUI mode:**
- Same store-driven approach
- View subscribes to relevant scope on mount, unsubscribes on unmount
- `useSSE(scope, id)` hook manages lifecycle

**`--json` mode:**
- Raw PersistedEvent objects as newline-delimited JSON
- No rendering, pure data stream (pipeable to `jq`)

### SSE Reconnection Resilience

```
1. EventSource connects to /api/stream?scope=X&id=Y
2. On disconnect, eventsource auto-reconnects with Last-Event-ID header
3. Server replays events from StreamBroker durable log (capped at SSE_MAX_REPLAY=10000)
4. If gap > replay cap OR server responds with 410 Gone:
   a. Fall back to REST: GET /api/stream/replay?scope=X&id=Y&afterSeq=lastKnown&limit=500
   b. Paginate through missed events (increment afterSeq each page)
   c. Merge into existing StreamBlock state (dedup by sequenceId)
   d. Re-establish live SSE connection once caught up
5. If total missed events > streamStore.maxHistory: reset state, full replay from 0
```

---

## 6. Configuration Management

### 5-Layer Precedence (highest wins)

```
Layer 5: CLI flags (--server, --model, --verbose, --api-key, --log-level)
Layer 4: Environment variables (GENERATORAI_SERVER_URL, GENERATORAI_API_KEY, etc.)
Layer 3: Project config (.generatorai/config.json in CWD or git root)
Layer 2: User config (~/.generatorai/config.json)
Layer 1: Built-in defaults (from Zod schema)
```

### CLI Config Schema

```typescript
const CLIConfigSchema = z.object({
  server: z.object({
    url: z.string().default('http://localhost:3100'),
    apiKey: z.string().optional(),
  }),
  cli: z.object({
    defaultOutput: z.enum(['human', 'json']).default('human'),
    color: z.enum(['auto', 'always', 'never']).default('auto'),
    pager: z.boolean().default(true),
    editor: z.string().optional(),
    streamVerbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
    confirmDestructive: z.boolean().default(true),
    defaultModel: z.string().optional(),
  }),
  tui: z.object({
    theme: z.enum(['dark', 'light', 'auto']).default('auto'),
    showUsage: z.boolean().default(true),
    collapseTools: z.boolean().default(true),
    maxStreamHistory: z.number().default(500),
  }),
  profiles: z.record(z.object({ /* per-profile overrides */ })).optional(),
  activeProfile: z.string().optional(),
});
```

### File Locations

```
~/.generatorai/
├── config.json          # User-level config
├── profiles/            # Named profile overrides
├── history/             # Command history for autocomplete
└── cache/               # Template cache, model list cache

.generatorai/            # Project-level (in repo root)
├── config.json          # Project-specific settings
└── prompts/             # Project prompt files
```

### Auth Strategy

- Server supports optional API key auth (`GENERATORAI_API_KEY` env var)
- CLI resolution: `--api-key` flag > `GENERATORAI_API_KEY` env > `config.server.apiKey`
- If server has no auth configured, all three are ignored
- Future: token-based auth flow can be added without breaking changes

---

## 7. DAG Visualization (ASCII)

### Static Definition View (`workflow show <id>`)

```
┌─────────────────────────────────────────────┐
│ Workflow: Code Review Pipeline (3 stages)    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐                               │
│  │ Analyze  │                               │
│  └────┬─────┘                               │
│       │ on_success                          │
│  ┌────┴─────┐                               │
│  │ Review   │                               │
│  └────┬─────┘                               │
│       ├─── on_success ──┐                   │
│       │                 │                   │
│  ┌────┴─────┐    ┌─────┴────┐              │
│  │ Fix      │    │ Report   │              │
│  └──────────┘    └──────────┘              │
└─────────────────────────────────────────────┘
```

### Live Run View (`run watch <id>`)

```
┌─────────────────────────────────────────────┐
│ Run: abc123 │ Status: running │ 2m 34s      │
├─────────────────────────────────────────────┤
│  ┌──────────┐                               │
│  │ ✓ Analyze│ 45s                           │
│  └────┬─────┘                               │
│  ┌────┴─────┐                               │
│  │ ◉ Review │ 1m 12s...                    │
│  └────┬─────┘                               │
│  ┌────┴─────┐    ┌──────────┐              │
│  │ ○ Fix    │    │ ○ Report │              │
│  └──────────┘    └──────────┘              │
│                                             │
│ ─── Stage: Review (running) ───────────────│
│ > Analyzing the code changes in src/...     │
│ > Found 3 potential issues...               │
└─────────────────────────────────────────────┘

Legend: ✓ completed  ◉ running  ○ pending  ✗ failed  ⊘ skipped  ⏸ paused
```

---

## 8. HITL (Human-in-the-Loop) Support

### CLI Commands

```bash
generatorai run permission-mode <runId>                     # Check current mode
generatorai run permission-mode <runId> acceptEdits         # Set mode mid-run
generatorai run pending <runId>                             # List pending approvals
generatorai run approve <runId> <stageId>                   # Approve
generatorai run approve <runId> <stageId> --reject --reason "unsafe"  # Reject
generatorai run approve <runId> <stageId> --value '{"key":"val"}'     # Provide value
```

### TUI HITL Flow

1. Stage enters `awaiting_input` → notification badge on status bar
2. `PendingApprovalsView` shows all pending stages with context
3. User selects stage → sees what's being requested
4. User can: Approve / Reject with reason / Provide value
5. Resolution sent via `POST /api/workflow-runs/:runId/stages/:stageId/resume`

### Interactive Chat HITL

During `chat start` or TUI ChatView:
- `permission.requested` events trigger inline prompts
- User sees: `[Permission] Tool "editFile" wants to modify src/app.ts. Allow? [y/N/always]`
- "always" remembers for the session

---

## 9. Signal Handling & Error Recovery

### Signal Handling

| Signal | Context | Behavior |
|--------|---------|----------|
| First SIGINT (Ctrl+C) | During streaming | Disconnect SSE, print partial output, exit 0 |
| First SIGINT | During `--wait` | Cancel server operation (run cancel), exit 3 |
| Second SIGINT | Any | Force exit immediately |
| SIGTERM | Any | Graceful shutdown: close connections, flush logs |

### HTTP Error Recovery

| Error | Strategy |
|-------|----------|
| 429 (Rate Limited) | Respect `Retry-After` header, retry up to 3× with exponential backoff |
| 5xx (Server Error) | Retry once after 2s delay |
| Network error | Log, suggest `--server` flag or check if server is running |
| SSE disconnect | Auto-reconnect via eventsource package with Last-Event-ID |
| SSE gap > replay cap | Fallback to paginated REST replay at `/api/stream/replay` |

---

## 10. Reusable Code from Existing Codebase

### From Deprecated CLI (`apps/cli_depricated/`) — Copy + Refactor

| Source | Lines | Reuse Strategy |
|--------|-------|---------------|
| `src/platform/HttpPlatformClient.ts` | 755 | Copy, extend with missing endpoints (orchestrator, copilot, workspace) |
| `src/platform/DirectPlatformClient.ts` | 648 | Copy for --direct mode |
| `src/platform/composition-root.ts` | 360 | Copy DI wiring |
| `src/platform/createClient.ts` | 57 | Copy factory pattern |
| `src/components/StreamingOutput.tsx` | 381 | Copy, enhance with collapsible tools, sliding window |
| `src/components/DAGProgress.tsx` | 655 | Copy event routing logic, enhance DAG visualization |
| `src/components/StatusBadge.tsx` | ~50 | Copy status→icon/color map |
| `src/config/loadConfig.ts` | 175 | Copy, add layer 3 (project config) |
| `src/tui/theme.ts` | 56 | Copy colors/icons |
| `src/tui/views/PendingApprovalsView.tsx` | 300 | Copy HITL approval UI |

### From @generatorai/shared (import directly)

- `AgentEvent` type union + all type guards (`isHarnessEvent`, `isWorkflowRunEvent`, etc.)
- `PersistedEvent` type for SSE events
- `AppConfigSchema` (Zod) for config validation
- All domain types: `WorkflowDefinition`, `WorkflowRun`, `StageRun`, `Chat`, `Automation`, `Project`, etc.
- Error hierarchy: `GeneratorAIError`, `NotFoundError`, `ValidationError`, etc.
- Utilities: `createLogger()`, `deepMerge()`, `interpolateVariables()`, `parseBatchData()`

### From @generatorai/core (Direct mode only)

- `createCoreServices()` — bootstrap all services for composition-root
- `EventBus` — direct event subscription
- All service classes for delegation
- State machine types for validation

### Patterns from Web App (`apps/web/`)

- Zustand store structure (`src/stores/`)
- SSE reconnection + dedup logic (`src/stores/sseManager.ts`)
- `HttpPlatformClient` method signatures (`src/platform/`)

---

## 11. Implementation Phases

### Phase 1: Foundation & Infrastructure (2 weeks)

**Goal:** CLI boots, connects to server, basic commands work.

**Tasks:**
1. Create `apps/cli/` with `package.json`, `tsconfig.json`, `vitest.config.ts`
2. Set up Commander program with global options and signal handling
3. Implement 5-layer config loading (`config/loadConfig.ts`, `config/schema.ts`, `config/paths.ts`)
4. Copy + adapt `HttpPlatformClient` from deprecated CLI, extend with missing endpoints
5. Implement output formatters (`output/json.ts`, `output/table.ts`, `output/format.ts`)
6. Implement HTTP retry utility (`utils/retry.ts`)
7. Implement system commands: `health`, `health-config`, `models`, `status`, `artifacts`, `mcp-servers`
8. Implement `copilot` commands: `conversations`, `messages`, `ping`
9. Implement `config` commands: `show`, `set`, `get`, `edit`, `reset`, `profile *`
10. Implement `init` and `completions` commands
11. Wire into Turbo build pipeline

**Files:** ~20 | **Validation:** `generatorai health`, `generatorai models --json`, `generatorai config show`

### Phase 2: Chat Commands + Streaming (2 weeks)

**Goal:** Full chat lifecycle with real-time streaming in terminal.

**Tasks:**
1. Implement `chat` commands: `start`, `list`, `show`, `resume`, `send`, `messages`, `update`, `archive`, `delete`
2. Implement `session` commands: `messages`
3. Build `StreamingOutput` component (from deprecated + collapsible tools + sliding window)
4. Build `TextInput` component (multi-line, history, `@file:` syntax)
5. Build `MarkdownRenderer` for terminal
6. Build `ToolCallDisplay` (collapsible with Enter/Space toggle)
7. Build `StatusBadge`, `Spinner`, `ErrorBox`
8. Implement SSE subscription with reconnection resilience
9. Interactive chat loop for `chat start` / `chat resume`

**Files:** ~15 | **Validation:** `generatorai chat start` → streaming responses, tool displays, markdown

### Phase 3: Workflow Definition Commands (1.5 weeks)

**Goal:** Full workflow CRUD + DAG visualization.

**Tasks:**
1. Implement `workflow` commands: `create`, `list`, `show`, `update`, `delete`, `validate`
2. Implement `workflow stage` and `workflow edge` subcommands
3. Implement `workflow import-template`, `import-json`, `export`
4. Build `DAGVisualization` component (ASCII DAG with dagre layout)
5. Implement `template` commands: `list`, `show`
6. Build `Table` component for list displays

**Files:** ~10 | **Validation:** `generatorai workflow show <id>` renders ASCII DAG

### Phase 4: Workflow Runs + Live Monitoring (2 weeks)

**Goal:** Run lifecycle with live streaming DAG progress and HITL.

**Tasks:**
1. Implement `run` commands: `create`, `start`, `list`, `show`, `pause`, `resume`, `cancel`, `retry`, `delete`
2. Implement `run watch` with live DAG progress + per-stage streaming
3. Implement `run logs`, `run artifacts`, `run workspace`, `run diff`
4. Implement `--wait` and `--timeout` for `run start`
5. Implement HITL commands: `permission-mode`, `pending`, `approve`
6. Implement stage-level controls: `stage-pause`, `stage-resume`, `stage-retry`, `stage-cancel`
7. Build `ProgressBar` and live-updating `StatusBadge`

**Files:** ~10 | **Validation:** `generatorai run watch <id>` shows live DAG with streaming

### Phase 5: Orchestrator + Automation + Project + Remaining (2 weeks)

**Goal:** Complete all remaining command groups.

**Tasks:**
1. Implement `orchestrator` commands (templates, create-from-template, start, context, cancel, files, upload, download, content, diff)
2. Implement `automation` commands (full CRUD + trigger + rotate-token + executions + watch-exec + test-data-source)
3. Implement `project` commands (CRUD + available-artifacts)
4. Implement `codebase` commands (link, list, update, unlink, fetch, branches, status, browse, file)
5. Implement `project-config` commands (config upload/list/show/update/delete + mcp-server add/list/update/remove)
6. Implement `workspace` commands (list, show, worktrees, commit, archive, delete, cleanup)
7. Implement `webhook` and `hook` commands

**Files:** ~12 | **Validation:** Full automation lifecycle, project with linked codebases

### Phase 6: Interactive TUI — MVP (2 weeks)

**Goal:** Full-screen TUI with 7 core views.

**Tasks:**
1. Build TUI shell: `App.tsx`, `Router.tsx`, `theme.ts`
2. Build all 8 Zustand stores
3. Build layout components: `Header`, `StatusBar`, `Panel`, `HelpOverlay`, `ErrorBoundary`
4. Build navigation system with view stack and `useNavigation` hook
5. Build `useSSE` and `useKeymap` hooks
6. Build MVP views: **DashboardView**, **ChatListView**, **ChatView**, **WorkflowRunView**, **WorkflowListView**, **AutomationListView**, **SettingsView**
7. Build remaining components: `SelectList`, `ConfirmDialog`, `Tabs`
8. Wire SSE subscriptions per-view with real-time updates

**Files:** ~35 | **Validation:** `generatorai tui` → navigate views, real-time chat + run streaming

### Phase 7: TUI Full + Polish + Testing (2 weeks)

**Goal:** Production-ready quality.

**Tasks:**
1. Build remaining 8 views: WorkflowDetailView, WorkflowRunListView, AutomationDetailView, AutomationExecView, ProjectListView, ProjectDetailView, TemplateListView, PendingApprovalsView
2. Unit tests for all commands with `MockPlatformClient`
3. Component tests with `ink-testing-library`
4. Integration tests against running server
5. `--help` text for every command and subcommand
6. `generatorai examples` command with usage recipes
7. Error handling: graceful failures, network drops, auth errors, terminal resize
8. Performance: streaming render throttle, large list pagination
9. Shell completions for bash/zsh/fish/powershell

**Files:** ~30 | **Validation:** Full E2E flow test (see below)

### Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. Foundation | 2 weeks | Week 2 |
| 2. Chat + Streaming | 2 weeks | Week 4 |
| 3. Workflow Definitions | 1.5 weeks | Week 5.5 |
| 4. Runs + Monitoring | 2 weeks | Week 7.5 |
| 5. Remaining Commands | 2 weeks | Week 9.5 |
| 6. TUI MVP | 2 weeks | Week 11.5 |
| 7. TUI Full + Polish | 2 weeks | Week 13.5 |
| **Total** | **~13.5 weeks** | |

---

## 12. Testing Strategy

### Unit Tests (per command — MockPlatformClient)

```typescript
describe('chat list', () => {
  it('lists chats in table format', async () => {
    const mock = new MockPlatformClient();
    mock.listChats.mockResolvedValue([{ id: '1', name: 'Test', status: 'active' }]);
    const { stdout, exitCode } = await runCommand(['chat', 'list'], { client: mock });
    expect(stdout).toContain('Test');
    expect(exitCode).toBe(0);
  });
  it('outputs JSON with --json flag', async () => { /* ... */ });
  it('returns exit code 5 on auth failure', async () => { /* ... */ });
});
```

### Component Tests (Ink — ink-testing-library)

```typescript
import { render } from 'ink-testing-library';

describe('StreamingOutput', () => {
  it('renders thinking blocks with dimmed text', () => {
    const { lastFrame } = render(
      <StreamingOutput blocks={[{ type: 'thinking', content: 'Analyzing...', done: false }]} />
    );
    expect(lastFrame()).toContain('Analyzing...');
  });
});
```

### Integration Tests (against running server)

```typescript
describe('chat flow (integration)', () => {
  let server: TestServer;
  beforeAll(async () => { server = await startTestServer(); });
  afterAll(async () => { await server.stop(); });
  it('creates chat, sends prompt, receives streaming response', async () => {
    const { stdout } = await runCommand(['chat', 'send', chatId, 'Hello']);
    expect(stdout).toContain('assistant');
  });
});
```

---

## 13. Verification Plan

### Per-Phase Smoke Tests

| Phase | Command | Expected |
|-------|---------|----------|
| 1 | `generatorai health` | Server status JSON |
| 1 | `generatorai --json models` | JSON array of models |
| 2 | `generatorai chat start` | Interactive mode, streaming response |
| 3 | `generatorai workflow show <id>` | ASCII DAG rendered |
| 4 | `generatorai run watch <id>` | Live DAG progress with streaming |
| 5 | `generatorai automation trigger <id>` | Execution fires |
| 6 | `generatorai tui` | Full-screen renders, navigation works |

### End-to-End Flow Test

```bash
generatorai init
generatorai project create --name "Test Project"
generatorai project codebase link $PID --alias main --type local-dir --local-path .
generatorai workflow import-template code-review --name "My Review"
generatorai workflow validate $WID
generatorai run create $WID --var repo=myapp
generatorai run start $RID --wait --timeout 600
generatorai run artifacts $RID
```

### CI Integration

```yaml
# .github/workflows/ci.yml additions
- name: CLI Build
  run: pnpm --filter @generatorai/cli build

- name: CLI Type Check
  run: pnpm --filter @generatorai/cli typecheck

- name: CLI Tests
  run: pnpm --filter @generatorai/cli test
```

---

## 14. File Count Summary

| Category | Count | Key Files |
|----------|-------|-----------|
| Root config | 3 | `package.json`, `tsconfig.json`, `vitest.config.ts` |
| Commands | 22 | One per noun + `index.ts`, `tui.ts`, `init.ts`, `completions.ts` |
| Platform | 5 | `HttpPlatformClient.ts`, `DirectPlatformClient.ts`, `composition-root.ts`, `createClient.ts`, `types.ts` |
| Config | 4 | `loadConfig.ts`, `schema.ts`, `paths.ts`, `profileManager.ts` |
| TUI Shell | 3 | `App.tsx`, `Router.tsx`, `theme.ts` |
| TUI Views | 15 | One per view |
| TUI Components | 20 | `StreamingOutput`, `DAGVisualization`, `Table`, `ChatMessage`, etc. |
| TUI Stores | 8 | One per domain area |
| TUI Hooks | 4 | `useSSE`, `usePolling`, `useKeymap`, `useNavigation` |
| Output | 3 | `json.ts`, `table.ts`, `format.ts` |
| Utils | 5 | `constants.ts`, `formatDuration.ts`, `clipboard.ts`, `pager.ts`, `retry.ts` |
| Entry | 2 | `index.tsx`, `instrumentation.ts` |
| Tests | ~30 | Commands, components, integration |
| **Total** | **~124** | |
