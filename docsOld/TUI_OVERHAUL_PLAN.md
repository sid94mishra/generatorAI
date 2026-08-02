# GeneratorAI TUI Overhaul — Implementation Plan

## Executive Summary
Transform the CLI from an in-process direct-service client into a modern TUI that operates as a true client to the server (like the web UI), with both interactive full-screen mode and non-interactive scripting mode.

## Architecture Change

### Current: DirectPlatformClient (In-Process)
```
CLI → DirectPlatformClient → Core Services → DB (all in one process)
```

### Target: Dual-Mode Client
```
Interactive TUI  → HttpPlatformClient → Server HTTP API → Core Services → DB
Non-Interactive  → HttpPlatformClient → Server HTTP API → Core Services → DB
Fallback         → DirectPlatformClient → Core Services → DB (offline mode)
```

## Research Findings — Modern TUI Best Practices

### From Claude Code, OpenAI Codex, OpenCode:
1. **Full-screen terminal UI** with distinct zones (header, content, input, status bar)
2. **Keyboard-driven navigation** (Tab to switch views, Ctrl+C to cancel, / to search)
3. **Real-time streaming** with thinking indicators, tool call display, code highlighting
4. **Client/server architecture** — TUI is just one frontend (OpenCode design)
5. **Two modes**: Interactive (default when TTY) and non-interactive (piped/scripted)
6. **Minimal chrome** — content-first, status indicators in periphery
7. **Responsive** — adapts to terminal width/height
8. **ASCII art/box drawing** for visual structure (borders, trees, flow graphs)

## Implementation Phases

### Phase 1: HttpPlatformClient (Server-Mode Client)

**New File: `apps/cli/src/platform/HttpPlatformClient.ts`**

Mirrors the web's HttpPlatformClient but for Node.js:
- Uses `fetch` for REST API calls (Node 18+ native fetch)
- Uses `eventsource` package for SSE subscriptions
- Implements full `IPlatformClient` + extended automation/stage/edge methods
- Connection health checking with auto-reconnect
- Configurable base URL (default: `http://localhost:3100`)

**Changes to `apps/cli/src/platform/composition-root.ts`:**
- Export factory: `createClient(mode: 'http' | 'direct', config)`
- HTTP mode creates HttpPlatformClient
- Direct mode creates DirectPlatformClient (current behavior)

**Changes to `apps/cli/src/index.tsx`:**
- Add `--server <url>` global option (default: http://localhost:3100)
- Add `--direct` flag to force in-process mode
- Default behavior: try HTTP first, fall back to direct if server unreachable
- Show connection status on startup

### Phase 2: Interactive TUI Shell

**New File: `apps/cli/src/tui/App.tsx`** — Root full-screen Ink application

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ ⚡ GeneratorAI          Connected ● localhost:3100  v0.1│ ← Header bar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Content Area — switches based on active view]         │
│                                                         │
│  Dashboard / Chat / Workflows / Automations / Settings  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [D]ashboard [C]hat [W]orkflows [A]utomations  ? Help    │ ← Nav bar
│ > _                                                     │ ← Input line
└─────────────────────────────────────────────────────────┘
```

**Views (new files under `apps/cli/src/tui/views/`):**

1. **DashboardView.tsx** — Stats cards, recent activity, quick actions
2. **ChatListView.tsx** — Filterable chat list, create/delete/archive
3. **ChatView.tsx** — Interactive chat with streaming (reuse ChatViewV2 enhanced)
4. **WorkflowListView.tsx** — Workflow definitions list, import/export JSON
5. **WorkflowDetailView.tsx** — DAG visualization, manage stages/edges
6. **WorkflowRunView.tsx** — Live DAG progress (reuse DAGProgress enhanced)
7. **AutomationListView.tsx** — Automation list, enable/disable/trigger
8. **AutomationDetailView.tsx** — Config view, execution history
9. **AutomationRunView.tsx** — Live execution progress (reuse AutomationProgress)
10. **SettingsView.tsx** — Config management

**Navigation:** Keyboard-driven
- `D` — Dashboard
- `C` — Chat list (or active chat)
- `W` — Workflow list
- `A` — Automation list
- `Esc` — Back / close dialog
- `Enter` — Select/confirm
- `n` — New (create new item in current view)
- `/` — Search/filter
- `?` — Help overlay
- `Tab` — Cycle through panels
- `q` — Quit
- `Ctrl+C` — Cancel current operation

**New File: `apps/cli/src/tui/Navigation.tsx`** — Router/view manager
**New File: `apps/cli/src/tui/StatusBar.tsx`** — Bottom status with connection info
**New File: `apps/cli/src/tui/Header.tsx`** — Top bar with branding + status
**New File: `apps/cli/src/tui/InputBar.tsx`** — Universal input/command bar
**New File: `apps/cli/src/tui/HelpOverlay.tsx`** — Keyboard shortcut reference

### Phase 3: Enhanced Visual Components

**Upgrade existing components:**

1. **StreamingOutput.tsx** — Already good, add syntax highlighting for common languages
2. **DAGProgress.tsx** — Enhanced flow graph with box-drawing characters:
   ```
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ ✓ Requirements   │───→│ ● Architecture   │───→│ ○ Implementation │
   │   Analysis       │    │   Design         │    │                  │
   │   32s · 1.4k tok │    │   Running... ⠴   │    │   Pending        │
   └──────────────────┘    └──────────────────┘    └──────────────────┘
   ```
3. **AutomationProgress.tsx** — Enhanced with nested workflow visualization
4. **New: FlowDiagram.tsx** — Reusable DAG renderer with box nodes and edge arrows

**New components:**
- **Table.tsx enhancement** — Sortable, paginated, selectable rows
- **Dialog.tsx** — Modal dialog for confirmations/forms
- **SearchInput.tsx** — Real-time filter input with highlights
- **Breadcrumb.tsx** — Navigation path indicator
- **Card.tsx** — Stat card for dashboard

### Phase 4: Feature Parity with Web UI

**Missing features to implement:**

1. **Bulk operations**: `--ids <id1,id2,...>` flags for delete/archive
2. **Advanced filtering**: `--filter "status:running,name:*api*"` syntax
3. **Workflow DAG detail view**: ASCII DAG with stage properties
4. **Automation data source testing**: Visual test output
5. **Batch mode visualization**: CSV/column mapping display
6. **JSON template round-trip**: `workflow export` + `workflow import-json` both present
7. **File attachment in chat**: `--file <path>` flag

### Phase 5: Non-Interactive Mode Polish

**Enhance existing commands for scripting:**
- All commands output clean JSON with `--json` flag
- Exit codes: 0=success, 1=error, 2=cancelled
- `--quiet` flag to suppress decorative output
- `--wait` flag on run/trigger to block until completion
- Pipe-friendly: `workflow list --json | jq '.[] | .id'`
- Progress to stderr, results to stdout

## File Structure

```
apps/cli/src/
├── index.tsx                    ← Entry point (add --server, --direct flags)
├── platform/
│   ├── DirectPlatformClient.ts  ← Existing (keep for offline/direct mode)
│   ├── HttpPlatformClient.ts    ← NEW: HTTP client matching web UI
│   ├── composition-root.ts      ← Existing (add factory function)
│   └── createClient.ts          ← NEW: Smart client factory
├── tui/                         ← NEW: Full-screen TUI application
│   ├── App.tsx                  ← Root TUI component
│   ├── Navigation.tsx           ← View router
│   ├── Header.tsx               ← Top status bar
│   ├── StatusBar.tsx            ← Bottom nav/status bar
│   ├── InputBar.tsx             ← Command/search input
│   ├── HelpOverlay.tsx          ← Keyboard shortcuts
│   ├── theme.ts                 ← Color palette, spacing constants
│   └── views/
│       ├── DashboardView.tsx
│       ├── ChatListView.tsx
│       ├── ChatView.tsx
│       ├── WorkflowListView.tsx
│       ├── WorkflowDetailView.tsx
│       ├── WorkflowRunView.tsx
│       ├── AutomationListView.tsx
│       ├── AutomationDetailView.tsx
│       ├── AutomationRunView.tsx
│       └── SettingsView.tsx
├── components/                  ← Enhanced shared components
│   ├── StreamingOutput.tsx      ← Existing (enhanced)
│   ├── DAGProgress.tsx          ← Existing (enhanced)
│   ├── AutomationProgress.tsx   ← Existing (enhanced)
│   ├── FlowDiagram.tsx          ← NEW: Reusable DAG renderer
│   ├── Dialog.tsx               ← NEW: Modal dialogs
│   ├── SearchInput.tsx          ← NEW: Filter input
│   ├── Breadcrumb.tsx           ← NEW: Navigation path
│   ├── Card.tsx                 ← NEW: Dashboard stat card
│   ├── Table.tsx                ← Enhanced existing
│   └── ... (existing)
├── commands/                    ← Existing commands (enhanced)
│   ├── ... (existing, enhanced with --server support)
└── utils/
    ├── constants.ts             ← Existing
    └── theme.ts                 ← NEW: Shared color/styling constants
```

## Entry Point Flow

```
generatorai                    → Interactive TUI (if TTY detected)
generatorai --no-tui           → Traditional CLI mode
generatorai tui                → Force interactive TUI
generatorai <command>          → Non-interactive command mode
generatorai --server <url>     → Connect to specific server
generatorai --direct           → Bypass server, use direct mode
```

## Implementation Order

1. **HttpPlatformClient** + createClient factory (foundation)
2. **TUI App shell** (Header, StatusBar, Navigation, App.tsx)
3. **DashboardView** (first view to prove the architecture)
4. **ChatView** (most complex, streaming, input)
5. **WorkflowListView + WorkflowRunView** (reuse DAGProgress)
6. **AutomationListView + AutomationRunView** (reuse AutomationProgress)
7. **WorkflowDetailView** (ASCII DAG builder)
8. **SettingsView** (simple)
9. **Non-interactive polish** (--json, --quiet, exit codes)
10. **Testing** (E2E with real CLI)

## Dependencies to Add
- `eventsource` — SSE client for Node.js (for HttpPlatformClient)
- No other new dependencies (Ink, React, chalk already present)

## Testing Strategy
1. Unit: HttpPlatformClient methods against mock server
2. Integration: TUI views render correctly with mock data
3. E2E: Full workflow creation → run → monitoring cycle
4. E2E: Full automation creation → trigger → monitoring cycle
5. Both modes: Interactive TUI + non-interactive commands
