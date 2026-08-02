# Technology Stack Research & Analysis for Autonomous AI Agent Application
## Modern Architecture Patterns & Best Practices (2025–2026)

> **Date**: February 20, 2026  
> **Scope**: Comprehensive technology research for building an autonomous AI agent with Copilot SDK — supporting Desktop (Electron), Web (React), CLI, and Webhook interfaces.

---

## Table of Contents

1. [Monorepo Build Systems](#1-monorepo-build-systems)
2. [Real-time Streaming Architecture](#2-real-time-streaming-architecture)
3. [SQLite in Node.js](#3-sqlite-in-nodejs)
4. [Electron.js with React](#4-electronjs-with-react)
5. [Modern CLI Frameworks for Node.js](#5-modern-cli-frameworks-for-nodejs)
6. [State Management](#6-state-management)
7. [Process Management in Node.js](#7-process-management-in-nodejs)
8. [Webhook / Event-driven Architecture](#8-webhook--event-driven-architecture)
9. [Modern Design Patterns](#9-modern-design-patterns-for-autonomous-agents)
10. [Security Patterns](#10-security-patterns)

---

## 1. Monorepo Build Systems

### Comparison: Turborepo vs Nx vs pnpm Workspaces

| Feature | **Turborepo** | **Nx** | **pnpm Workspaces** |
|---|---|---|---|
| **Primary Purpose** | Task runner & build orchestrator | Full monorepo framework with plugins | Package manager with workspace linking |
| **Caching** | Local + Remote (Vercel) | Local + Remote (Nx Cloud) | None (requires external tool) |
| **Task Parallelization** | Automatic based on dependency graph | Automatic with sophisticated task graph | Manual via scripts |
| **Configuration** | Single `turbo.json` — minimal | `nx.json` + project configs — more complex | `pnpm-workspace.yaml` — minimal |
| **Learning Curve** | Low — just wraps existing scripts | Medium-High — plugin ecosystem, generators | Low — just a package manager |
| **Code Generation** | None built-in | Built-in generators & schematics | None |
| **Module Boundaries** | None built-in | Enforces module boundary rules | None |
| **Language Support** | JS/TS focused | Polyglot (JS, Java, Go, .NET, etc.) | JS/TS only |
| **Incremental Builds** | Yes (via caching) | Yes (advanced affected analysis) | No |
| **IDE Integration** | Basic | Nx Console (VSCode/JetBrains) | None |
| **Stars (GitHub)** | ~27k | ~24k | ~30k (pnpm overall) |
| **Overhead** | Very low — zero config approach | Higher — full framework | Zero — it's just your package manager |

### **Recommendation: Turborepo + pnpm Workspaces**

**Why this combination is optimal for an AI Agent monorepo:**

1. **pnpm workspaces** handles dependency management with strict isolation, symlinked packages, and the `workspace:` protocol. It is the most disk-efficient package manager (content-addressable store) and is used by Vue, Vite, Next.js, Prisma, and Turborepo itself.

2. **Turborepo** sits on top as the task runner. It provides:
   - **Zero-config caching**: Never rebuild unchanged packages. With an `turbo.json` defining task pipelines, builds of server/CLI/desktop/web are parallelized automatically.
   - **Remote caching**: Optional Vercel Remote Cache or self-hosted. Critical for CI/CD when multiple developers are working.
   - **Minimal overhead**: It doesn't rewrite your build scripts — it just orchestrates `package.json` scripts you already have.
   - **Pipeline dependencies**: `turbo.json` defines `"build": { "dependsOn": ["^build"] }` so shared packages build before consumers.

3. **Why not Nx?** Nx is more opinionated and better suited for massive enterprise monorepos (100+ packages). For a project with 4-6 packages (server, CLI, desktop, web, shared/core), Turborepo's lightweight approach avoids unnecessary complexity. Nx's plugin ecosystem is powerful but adds configuration burden. Turborepo's incremental adoption model is simpler.

### Recommended Monorepo Structure

```
generatorai/
├── apps/
│   ├── server/          # Express/Fastify backend
│   ├── desktop/         # Electron app
│   ├── web/             # React web client
│   └── cli/             # CLI application (Ink)
├── packages/
│   ├── core/            # Business logic, session/workflow engine
│   ├── shared/          # TypeScript types, constants, utils
│   ├── db/              # SQLite + Drizzle schema & migrations
│   ├── copilot-bridge/  # Copilot SDK integration layer
│   ├── streaming/       # SSE/streaming utilities
│   └── ui/              # Shared React components (web + desktop)
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### Key Considerations & Tradeoffs

- **Turborepo + pnpm** = best DX-to-complexity ratio for 4-6 package repos
- **Type sharing** across packages is seamless with TypeScript project references and pnpm's `workspace:*` protocol
- **Build order** is automatically resolved by Turborepo's dependency graph
- **CI/CD**: Turborepo's `--filter` flag lets you build only changed packages
- **Tradeoff**: No built-in code generators (unlike Nx). Use `plop` or custom scripts if needed.

### How it applies to Copilot SDK Agent

The monorepo allows the `copilot-bridge` package to be shared across CLI, desktop, and server. Core session/workflow logic lives in `packages/core` and is consumed by all apps. The streaming package provides unified SSE handling for web and desktop. This modularity directly supports the requirement for extensibility and multi-interface support.

---

## 2. Real-time Streaming Architecture

### Comparison: SSE vs WebSockets vs Durable Streams

| Feature | **SSE (Server-Sent Events)** | **WebSockets** | **Durable Streams** |
|---|---|---|---|
| **Direction** | Server → Client (unidirectional) | Bidirectional | Server → Client with persistence |
| **Protocol** | HTTP/1.1 or HTTP/2 | ws:// or wss:// (upgrade from HTTP) | Concept/pattern, not a standard protocol |
| **Auto-reconnect** | Built-in with `Last-Event-ID` | Must implement manually | Built-in by design |
| **Message resumption** | Via event IDs | Must implement manually | Core feature (cursor-based) |
| **Browser support** | All modern browsers + `EventSource` API | All modern browsers | Requires custom implementation |
| **Complexity** | Very low | Medium | Medium-High |
| **Proxy/Firewall friendly** | Yes — standard HTTP | Problematic with some proxies | Yes — standard HTTP |
| **Connection limit (HTTP/1.1)** | 6 per domain per browser | No per-domain limit | 6 per domain (if HTTP/1.1 based) |
| **Binary data** | No (text only, Base64 encode) | Yes | Depends on implementation |
| **Overhead** | Very low | Low (after handshake) | Low |
| **Best for** | AI token streaming, logs, notifications | Chat, gaming, collaborative editing | Resumable AI streaming, persistent logs |

### **Recommendation: SSE as primary transport + Durable Stream pattern for persistence**

**Why SSE is the right choice:**

1. **AI streaming is inherently unidirectional**: Copilot SDK sends tokens/events to the client. The user sends prompts via standard HTTP POST. This is a perfect match for SSE.

2. **Modern AI agents use SSE**: 
   - **Claude Code** uses terminal-based streaming (stdout) 
   - **Cursor/Windsurf** use SSE for streaming AI completions from their backend
   - **OpenAI API** uses SSE (`text/event-stream`) for ChatGPT streaming responses
   - **Anthropic API** uses SSE for Claude streaming responses
   - **GitHub Copilot extensions** use SSE for streaming suggestions

3. **SSE provides auto-reconnection**: The `EventSource` API automatically reconnects with the `Last-Event-ID` header, enabling clients to resume from where they dropped off — crucial for long-running workflow sessions.

4. **HTTP/2 eliminates the connection limit**: Under HTTP/2, SSE connections are multiplexed over a single TCP connection, eliminating the old 6-connection browser limit.

### Durable Streams Pattern (Not a TC39 Proposal — An Architecture Pattern)

"Durable Streams" is not a finalized TC39 specification — it's an **architectural pattern** for making event streams resumable and persistent. The pattern involves:

```
┌──────────────┐     SSE      ┌──────────────┐
│  Copilot SDK │─────────────▶│   Server     │
│  (Source)    │  Events       │  (Persists   │
└──────────────┘              │   to SQLite) │
                              └──────┬───────┘
                                     │
                          SSE with   │  SSE with
                          Event IDs  │  Event IDs
                              ┌──────┴───────┐
                              │              │
                         ┌────▼───┐    ┌─────▼──┐
                         │Desktop │    │  Web   │
                         │Client  │    │ Client │
                         └────────┘    └────────┘
```

**Implementation approach:**
1. Server receives events from Copilot SDK
2. Each event is assigned a **monotonic sequence ID** and persisted to SQLite
3. Events are broadcast to connected clients via SSE with the sequence ID as the event `id`
4. On reconnection, the client sends `Last-Event-ID` and the server replays missed events
5. CLI clients consume the same event stream via HTTP or direct event bus

### Streaming Architecture for the Agent

```typescript
// Server-side SSE endpoint
app.get('/api/sessions/:id/stream', (req, res) => {
  const lastEventId = parseInt(req.headers['last-event-id'] || '0');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Disable Nginx buffering
  });

  // Replay missed events from SQLite
  const missedEvents = db.getEventsAfter(sessionId, lastEventId);
  missedEvents.forEach(event => {
    res.write(`id: ${event.sequenceId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
  });

  // Subscribe to live events
  const unsubscribe = eventBus.subscribe(sessionId, (event) => {
    res.write(`id: ${event.sequenceId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
  });

  req.on('close', unsubscribe);
});
```

### Event Types for the Agent

```typescript
type AgentEvent = 
  | { type: 'copilot.token'; data: { text: string } }
  | { type: 'copilot.complete'; data: { result: string } }
  | { type: 'copilot.tool_call'; data: { tool: string; args: any } }
  | { type: 'workflow.started'; data: { workflowId: string } }
  | { type: 'workflow.step_complete'; data: { step: number } }
  | { type: 'git.clone_progress'; data: { percent: number } }
  | { type: 'git.commit'; data: { sha: string; message: string } }
  | { type: 'script.stdout'; data: { line: string } }
  | { type: 'script.stderr'; data: { line: string } }
  | { type: 'attachment.available'; data: { url: string; name: string } }
  | { type: 'session.status'; data: { status: SessionStatus } }
  | { type: 'error'; data: { message: string; code: string } };
```

### Key Considerations

- **Heartbeat**: Send a comment line (`: ping`) every 15-30 seconds to keep the connection alive through proxies
- **Backpressure**: If a client is slow, buffer events in the SQLite event log and let the client catch up
- **Multi-tab**: Each tab creates its own SSE connection, which is fine under HTTP/2
- **CLI streaming**: For the CLI (non-browser), use `fetch` with `ReadableStream` or a lightweight SSE client library like `eventsource`
- **Electron**: Electron's renderer process can use the native `EventSource` API just like a browser

---

## 3. SQLite in Node.js

### Comparison: better-sqlite3 vs sql.js vs node-sqlite3

| Feature | **better-sqlite3** | **sql.js** | **node-sqlite3** |
|---|---|---|---|
| **API Style** | Synchronous | Synchronous (WASM) | Asynchronous (callbacks) |
| **Performance** | **Fastest** (native C++ addon) | Slowest (WASM overhead) | 2.9x–24.4x slower than better-sqlite3 |
| **Installation** | Requires native compilation (prebuild available) | Pure JS/WASM — zero native deps | Requires native compilation |
| **Transaction Support** | Excellent, built-in `.transaction()` | Manual | Manual |
| **Worker Thread Support** | Yes (built-in) | Yes (runs in any context) | No |
| **Electron Compatibility** | Good (requires rebuild for Electron) | Excellent (no native deps) | Good (requires rebuild) |
| **WAL Mode** | Yes (critical for performance) | No (in-memory or file via FS) | Yes |
| **Use Case** | Desktop/Server apps | Browser/Electron renderer, serverless | Legacy projects |
| **GitHub Stars** | 6.9k | 12.8k | 6k |
| **Used By** | Drizzle, libSQL, Turso | Browser-based apps | Legacy Node apps |

### ORM Comparison: Drizzle vs Prisma vs TypeORM

| Feature | **Drizzle ORM** | **Prisma** | **TypeORM** |
|---|---|---|---|
| **Schema Definition** | TypeScript code (schema.ts) | Prisma Schema Language (.prisma) | Decorators or EntitySchema |
| **Type Safety** | End-to-end, inferred from schema | Generated types from schema | Partial (decorator-based) |
| **Query Builder** | SQL-like, chainable, lightweight | Custom query API (Prisma Client) | QueryBuilder or Active Record |
| **Raw SQL Access** | First-class (`sql` template tag) | `$queryRaw` (limited) | `query()` |
| **Bundle Size** | ~50KB | ~2MB+ (engine binary) | ~500KB |
| **SQLite Support** | Native (libsql, better-sqlite3) | Yes (ships own SQLite binary) | Yes |
| **Migration** | `drizzle-kit generate/migrate/push` | `prisma migrate` | Built-in migration system |
| **Performance** | Excellent — thin layer over driver | Good — but engine overhead | Good |
| **Learning Curve** | Low (SQL-like) | Medium (new schema language) | Medium-High |
| **Runtime Dependencies** | Minimal | Heavy (Prisma Engine binary) | Moderate |
| **Edge/Serverless** | Excellent | Improving (Prisma Accelerate) | Poor |

### **Recommendation: better-sqlite3 + Drizzle ORM**

**Why better-sqlite3:**
1. **Performance leader**: Benchmarks show it is 2.9x–24.4x faster than node-sqlite3 for various operations
2. **Synchronous API is actually better for SQLite**: SQLite is an embedded database — operations are microseconds. Async wrappers add overhead without benefit. The synchronous API avoids callback hell and integrates perfectly with Drizzle.
3. **WAL mode**: Critical for concurrent reads while writing — necessary when multiple sessions write events while the UI reads them
4. **Transaction API**: Built-in `db.transaction()` that wraps operations in a single transaction — perfect for batch event persistence
5. **Worker threads**: For heavy queries, offload to worker threads without impacting the main event loop
6. **176k+ dependents** — battle-tested in production

**Why Drizzle ORM:**
1. **TypeScript-native**: Schema is defined in TypeScript — types flow from schema definition to query results with zero code generation step
2. **SQL-like query builder**: Developers who know SQL can be productive immediately. No new DSL to learn.
3. **Minimal bundle**: ~50KB vs Prisma's 2MB+ engine — critical for Electron app size
4. **No binary engine**: Unlike Prisma (which ships a Rust-based query engine binary), Drizzle is pure TypeScript
5. **First-class better-sqlite3 support**: Direct driver integration
6. **Migration tooling**: `drizzle-kit` provides schema diffing, migration generation, and `push` for rapid development
7. **Works in monorepo**: Schema lives in `packages/db`, consumed by server, CLI, and desktop

### Schema Example for the Agent

```typescript
// packages/db/src/schema.ts
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', { enum: ['created', 'running', 'paused', 'completed', 'cancelled'] }).notNull().default('created'),
  repoUrl: text('repo_url'),
  baseFolder: text('base_folder'),
  requiresCodebase: integer('requires_codebase', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status', { enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
  order: integer('order').notNull(),
  config: text('config', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  sequenceId: integer('sequence_id').notNull(),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  attachments: text('attachments', { mode: 'json' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  mimeType: text('mime_type'),
  size: integer('size'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

### Key Considerations

- **Electron + better-sqlite3**: Requires `electron-rebuild` or `@electron/rebuild` to compile native bindings for Electron's Node ABI. Use `postinstall` script.
- **Concurrent writes**: SQLite with WAL mode supports concurrent readers + single writer. For multi-session writes, use a write queue or serialize writes via the main process.
- **Database location**: Store in the user's app data directory (`app.getPath('userData')` in Electron).
- **Backup**: SQLite's `.backup()` API allows hot backups while the database is in use.

---

## 4. Electron.js with React

### Architecture Best Practices

Electron follows a **multi-process architecture** inherited from Chromium:

```
┌─────────────────────────────────────────────────┐
│                  Main Process                     │
│  (Node.js — full system access)                  │
│                                                   │
│  ┌──────────────┐  ┌────────────────────────┐    │
│  │ BrowserWindow │  │ Session/Process Manager│    │
│  │ Management    │  │ (Copilot CLI spawning) │    │
│  └──────┬───────┘  └────────────────────────┘    │
│         │                                         │
│  ┌──────┴───────────────────────────────────┐    │
│  │          IPC Bridge Layer                  │    │
│  │  ipcMain.handle() / ipcMain.on()         │    │
│  └──────┬───────────────────────────────────┘    │
│         │                                         │
├─────────┼─────────────────────────────────────────┤
│         │        Preload Script                   │
│  ┌──────┴───────────────────────────────────┐    │
│  │  contextBridge.exposeInMainWorld()        │    │
│  │  Exposes typed API: window.electronAPI    │    │
│  └──────┬───────────────────────────────────┘    │
│         │                                         │
├─────────┼─────────────────────────────────────────┤
│         │        Renderer Process                 │
│  ┌──────┴───────────────────────────────────┐    │
│  │  React Application                        │    │
│  │  (Same code as web client, with platform  │    │
│  │   checks for Electron-specific features)  │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### IPC Communication Patterns

Electron provides four key IPC patterns — all of which are needed:

**Pattern 1: Renderer → Main (one-way)** — `ipcRenderer.send` / `ipcMain.on`
- Use for: Fire-and-forget actions (start session, cancel workflow)

**Pattern 2: Renderer → Main (two-way)** — `ipcRenderer.invoke` / `ipcMain.handle`  
- **Recommended as the primary pattern**
- Use for: Request/response operations (get session list, create session)
- Returns a Promise — clean async/await usage

**Pattern 3: Main → Renderer** — `webContents.send` / `ipcRenderer.on`
- Use for: Pushing events to the UI (Copilot SDK events, progress updates)
- Critical for streaming data from Copilot CLI processes

**Pattern 4: Renderer → Renderer** — via MessagePort or main process broker
- Use for: If you have multiple windows communicating

### Sharing Code Between Web and Desktop

The key insight is: **the React application should be identical between web and desktop**. Platform-specific features are abstracted behind an interface.

```typescript
// packages/shared/src/platform.ts
export interface PlatformAPI {
  // Session management
  createSession(config: SessionConfig): Promise<Session>;
  getSessions(): Promise<Session[]>;
  startSession(id: string): Promise<void>;
  
  // Streaming
  subscribeToEvents(sessionId: string, cb: (event: AgentEvent) => void): () => void;
  
  // File system (desktop only)
  selectDirectory?(): Promise<string | null>;
  openFile?(path: string): Promise<void>;
  
  // Platform info
  isDesktop: boolean;
  isWeb: boolean;
}
```

```typescript
// apps/web/src/platform.ts — HTTP-based implementation
export const webPlatform: PlatformAPI = {
  isDesktop: false,
  isWeb: true,
  createSession: (config) => fetch('/api/sessions', { method: 'POST', body: JSON.stringify(config) }).then(r => r.json()),
  subscribeToEvents: (sessionId, cb) => {
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    source.onmessage = (e) => cb(JSON.parse(e.data));
    return () => source.close();
  },
};
```

```typescript
// apps/desktop/src/preload.ts — Electron IPC-based implementation
contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  isWeb: false,
  createSession: (config: SessionConfig) => ipcRenderer.invoke('session:create', config),
  subscribeToEvents: (sessionId: string, cb: Function) => {
    const handler = (_event: any, data: AgentEvent) => cb(data);
    ipcRenderer.on(`session:event:${sessionId}`, handler);
    return () => ipcRenderer.removeListener(`session:event:${sessionId}`, handler);
  },
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
});
```

### Build Tooling

- **Electron Forge** (recommended by Electron team) or **electron-builder** for packaging
- **Vite** as the bundler for both web and desktop renderer (fast HMR, ESM-native)
- `electron-vite` provides Vite integration specific to Electron

### Key Considerations

- **Context Isolation**: Always enable `contextIsolation: true` and `nodeIntegration: false` in BrowserWindow
- **Preload scripts**: Only expose minimal, typed APIs via `contextBridge`
- **Security**: Validate all IPC inputs in the main process. Never trust renderer data.
- **UtilityProcess**: For CPU-intensive work (e.g., file indexing), use Electron's `UtilityProcess` API instead of `child_process.fork` — it supports `MessagePort` communication
- **SQLite in main process**: Run better-sqlite3 in the main process (which has full Node.js access), expose data via IPC handlers

---

## 5. Modern CLI Frameworks for Node.js

### Comparison: Commander.js vs Ink vs Oclif vs Clipanion

| Feature | **Commander.js** | **Ink** | **Oclif** | **Clipanion** |
|---|---|---|---|---|
| **Paradigm** | Imperative command parsing | React component rendering for terminal | Plugin-based CLI framework | Type-safe command parsing |
| **UI Richness** | Text output only | **Full React-based TUI** — layouts, colors, interactivity | Text + plugin-based features | Text output only |
| **GitHub Stars** | 27.9k | 35.1k | 9k | 1.6k |
| **Used By** | Vue CLI, npm, Vite | **Claude Code, Gemini CLI, GitHub Copilot CLI**, Prisma, Shopify CLI, Cloudflare Wrangler | Heroku CLI, Salesforce CLI | Yarn v2+ |
| **TypeScript** | Via `@commander-js/extra-typings` | Native TypeScript | Native TypeScript | Native TypeScript |
| **Interactive UI** | No (needs `inquirer`) | Yes — built-in hooks (`useInput`, `useFocus`) | Via plugins | No |
| **Streaming Output** | Manual `console.log` | `<Static>` + live-updating components | Manual | Manual |
| **Testing** | Unit test commands | `ink-testing-library` — render assertions | Built-in test helpers | Limited |
| **Complexity** | Very Low | Medium (React knowledge needed) | High (heavy framework) | Low |
| **Best For** | Simple CLIs, scripts | **Rich interactive CLIs, AI agents** | Enterprise plugin systems | Yarn/monorepo tooling |

### **Recommendation: Ink (React for CLI)**

**Why Ink is the optimal choice for an AI agent CLI:**

1. **Industry standard for AI coding agents**: Claude Code, Gemini CLI, and GitHub Copilot CLI all use Ink. This is not coincidental — Ink's React model is ideal for streaming AI responses with live-updating UI.

2. **Code sharing with web/desktop**: Since the web and desktop clients use React, the CLI can share React component logic and state management patterns. Hooks like `useState`, `useEffect`, and custom hooks work identically.

3. **Live-updating output**: The `<Static>` component is perfect for displaying completed workflow steps (never re-rendered), while the live region below shows current streaming output. This is exactly how Claude Code works.

4. **Flexbox layout**: Ink uses Yoga (same layout engine as React Native) for terminal layouts. Build sophisticated TUIs with `<Box>`, `<Text>`, progress bars, and tables.

5. **Input handling**: `useInput` hook handles keyboard input elegantly — arrows, enter, escape, ctrl+c.

6. **Test-friendly**: `ink-testing-library` lets you write snapshot tests for your CLI output.

### CLI Architecture with Ink

```typescript
// apps/cli/src/app.tsx
import React from 'react';
import { Box, Text, Static } from 'ink';
import { useSessionStream } from './hooks/useSessionStream';

const SessionView: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { events, currentOutput, status } = useSessionStream(sessionId);
  
  return (
    <>
      {/* Completed events - rendered once, scrolled up */}
      <Static items={events}>
        {(event) => (
          <Box key={event.id}>
            <Text color="green">✓ </Text>
            <Text>{event.message}</Text>
          </Box>
        )}
      </Static>
      
      {/* Live streaming area */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan">
        <Text bold>Current: {status}</Text>
        <Text>{currentOutput}</Text>
      </Box>
    </>
  );
};
```

### Using Commander.js + Ink Together

For the best of both worlds, use **Commander.js for argument parsing** and **Ink for rendering**:

```typescript
// apps/cli/src/index.ts
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { SessionView } from './components/SessionView';

const program = new Command();

program
  .name('agent')
  .description('Autonomous AI Agent CLI')
  .version('1.0.0');

program
  .command('session:start <id>')
  .description('Start a session with its workflows')
  .action((id) => {
    render(<SessionView sessionId={id} />);
  });

program
  .command('session:list')
  .description('List all sessions')
  .action(() => {
    render(<SessionList />);
  });

program.parse();
```

### Key Considerations

- **Headless mode**: For CI/webhook-triggered runs, Ink can render with `{ debug: true }` or use `renderToString` to capture output without terminal interaction
- **Non-TTY environments**: Ink detects CI environments and adapts rendering (only renders last frame)
- **Concurrent rendering**: Ink v6+ supports React Concurrent Mode with `{ concurrent: true }`
- **Process lifecycle**: Ink app stays alive as long as there's async work. Use `useApp().exit()` to cleanly exit.

---

## 6. State Management

### Recommendation: TanStack Query (server state) + Zustand (client state)

### TanStack Query — Server State

TanStack Query (React Query) is the **de facto standard** for server state management in React applications. For an AI agent application, it handles:

| Capability | How it applies to AI Agent |
|---|---|
| **Caching** | Cache session lists, workflow configs — avoid re-fetching |
| **Background refetching** | Auto-refresh session status when window regains focus |
| **Optimistic updates** | Immediately show "pausing" state before server confirms |
| **Mutation management** | Create/update/delete sessions with automatic cache invalidation |
| **Infinite queries** | Paginate through chat message history |
| **Streaming support** | `streamedQuery` API for consuming SSE streams |

**Key streaming integration:**

```typescript
// Using TanStack Query with SSE for real-time events
import { useQuery, useQueryClient } from '@tanstack/react-query';

function useSessionEvents(sessionId: string) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    
    source.addEventListener('copilot.token', (e) => {
      const data = JSON.parse(e.data);
      // Update the streaming state in Zustand (not TanStack Query)
      useStreamStore.getState().appendToken(sessionId, data.text);
    });
    
    source.addEventListener('session.status', (e) => {
      // Invalidate TanStack Query cache to trigger re-fetch
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    });
    
    return () => source.close();
  }, [sessionId]);
}
```

### Zustand — Client State

Zustand is chosen over Jotai for the following reasons:

| Feature | **Zustand** | **Jotai** |
|---|---|---|
| **Mental model** | Single store with selectors | Atomic (bottom-up, like Recoil) |
| **Best for** | Shared mutable state across many components | Derived state, independent atoms |
| **Streaming state** | **Ideal** — direct mutation outside React lifecycle | Requires atoms for each stream |
| **DevTools** | Redux DevTools compatible | Jotai DevTools |
| **Bundle size** | ~1.1KB | ~2.4KB |
| **API** | `const useBear = create((set) => ({...}))` | `const atom = atom(initialValue)` |

**Why Zustand for streaming:**
The killer feature of Zustand for an AI agent is that **stores can be mutated from outside React components** — from SSE event handlers, WebSocket callbacks, or IPC listeners. Jotai atoms can only be set from within React components or with special `store.set()`, which adds friction.

```typescript
// packages/shared/src/stores/streamStore.ts
import { create } from 'zustand';

interface StreamState {
  activeStreams: Record<string, {
    tokens: string[];
    status: 'streaming' | 'complete' | 'error';
    currentText: string;
  }>;
  appendToken: (sessionId: string, token: string) => void;
  completeStream: (sessionId: string) => void;
}

export const useStreamStore = create<StreamState>((set) => ({
  activeStreams: {},
  
  appendToken: (sessionId, token) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [sessionId]: {
        ...state.activeStreams[sessionId],
        tokens: [...(state.activeStreams[sessionId]?.tokens || []), token],
        currentText: (state.activeStreams[sessionId]?.currentText || '') + token,
        status: 'streaming',
      },
    },
  })),
  
  completeStream: (sessionId) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [sessionId]: {
        ...state.activeStreams[sessionId],
        status: 'complete',
      },
    },
  })),
}));

// Can be called from OUTSIDE React (SSE handler, IPC listener)
eventSource.addEventListener('copilot.token', (e) => {
  useStreamStore.getState().appendToken(sessionId, JSON.parse(e.data).text);
});
```

### State Architecture Summary

```
┌──────────────────────────────────────────────────┐
│                State Architecture                 │
│                                                    │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │  TanStack Query    │  │  Zustand Stores      │ │
│  │  (Server State)    │  │  (Client State)      │ │
│  │                    │  │                       │ │
│  │  • Session list    │  │  • Active stream      │ │
│  │  • Workflow configs│  │    tokens             │ │
│  │  • Chat history    │  │  • UI preferences     │ │
│  │  • User settings   │  │  • Current view       │ │
│  │                    │  │  • Connection status   │ │
│  │  Cached, auto-     │  │  • Sidebar state      │ │
│  │  invalidated,      │  │                       │ │
│  │  optimistic        │  │  Mutable outside      │ │
│  │                    │  │  React lifecycle       │ │
│  └───────────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 7. Process Management in Node.js

### The Challenge

Each session in the agent application can spawn one or more Copilot CLI processes. Multiple sessions can run concurrently. This requires robust process lifecycle management.

### Recommended Architecture: Process Pool with Registry Pattern

```typescript
// packages/core/src/process/ProcessManager.ts
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

interface ManagedProcess {
  id: string;
  sessionId: string;
  process: ChildProcess;
  status: 'starting' | 'running' | 'paused' | 'stopping' | 'stopped';
  startedAt: Date;
  pid: number | null;
}

class ProcessManager extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map();
  private maxConcurrent: number;
  
  constructor(maxConcurrent = 10) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.setupCleanupHandlers();
  }
  
  async spawn(sessionId: string, command: string, args: string[]): Promise<string> {
    if (this.processes.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent processes (${this.maxConcurrent}) reached`);
    }
    
    const id = crypto.randomUUID();
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SESSION_ID: sessionId },
    });
    
    const managed: ManagedProcess = {
      id,
      sessionId,
      process: proc,
      status: 'running',
      startedAt: new Date(),
      pid: proc.pid ?? null,
    };
    
    this.processes.set(id, managed);
    
    // Forward stdout/stderr as events
    proc.stdout?.on('data', (data) => {
      this.emit('output', { processId: id, sessionId, type: 'stdout', data: data.toString() });
    });
    
    proc.stderr?.on('data', (data) => {
      this.emit('output', { processId: id, sessionId, type: 'stderr', data: data.toString() });
    });
    
    proc.on('exit', (code, signal) => {
      managed.status = 'stopped';
      this.emit('exit', { processId: id, sessionId, code, signal });
      this.processes.delete(id);
    });
    
    proc.on('error', (err) => {
      managed.status = 'stopped';
      this.emit('error', { processId: id, sessionId, error: err });
      this.processes.delete(id);
    });
    
    return id;
  }
  
  async kill(processId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const managed = this.processes.get(processId);
    if (!managed) return;
    
    managed.status = 'stopping';
    managed.process.kill(signal);
    
    // Force kill after timeout
    setTimeout(() => {
      if (managed.process.killed === false) {
        managed.process.kill('SIGKILL');
      }
    }, 5000);
  }
  
  async killBySession(sessionId: string): Promise<void> {
    const sessionProcesses = [...this.processes.values()]
      .filter(p => p.sessionId === sessionId);
    await Promise.all(sessionProcesses.map(p => this.kill(p.id)));
  }
  
  getBySession(sessionId: string): ManagedProcess[] {
    return [...this.processes.values()].filter(p => p.sessionId === sessionId);
  }
  
  // Cleanup on application exit
  private setupCleanupHandlers() {
    const cleanup = () => {
      for (const [id] of this.processes) {
        this.kill(id, 'SIGKILL');
      }
    };
    
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      cleanup();
      process.exit(1);
    });
  }
}
```

### Key Patterns

1. **Registry Pattern**: `Map<processId, ManagedProcess>` tracks all spawned processes
2. **Session Isolation**: Each process is tagged with its `sessionId` for group operations
3. **Graceful Shutdown**: SIGTERM first, SIGKILL after 5s timeout
4. **Process Limits**: Configurable max concurrent processes to prevent resource exhaustion
5. **Event Forwarding**: stdout/stderr data is emitted as events and forwarded to the SSE stream
6. **Cleanup Handlers**: Register handlers for `exit`, `SIGINT`, `SIGTERM`, `uncaughtException` to kill all child processes

### Copilot CLI Process Wrapping

```typescript
// packages/copilot-bridge/src/CopilotSession.ts
class CopilotSession {
  private processId: string | null = null;
  
  constructor(
    private processManager: ProcessManager,
    private sessionId: string,
    private eventBus: EventBus,
  ) {}
  
  async start(prompt: string, options: CopilotOptions): Promise<void> {
    this.processId = await this.processManager.spawn(
      this.sessionId,
      'copilot-cli',  // or the SDK command
      ['--prompt', prompt, ...this.buildArgs(options)],
    );
    
    // Forward process output to event bus
    this.processManager.on('output', (event) => {
      if (event.processId === this.processId) {
        this.eventBus.emit(this.sessionId, {
          type: event.type === 'stdout' ? 'copilot.token' : 'script.stderr',
          data: { text: event.data },
        });
      }
    });
  }
  
  async pause(): Promise<void> {
    if (this.processId) {
      await this.processManager.kill(this.processId, 'SIGSTOP');
    }
  }
  
  async resume(): Promise<void> {
    if (this.processId) {
      await this.processManager.kill(this.processId, 'SIGCONT');
    }
  }
  
  async cancel(): Promise<void> {
    if (this.processId) {
      await this.processManager.kill(this.processId);
    }
  }
}
```

### Key Considerations

- **Windows compatibility**: `SIGSTOP`/`SIGCONT` don't work on Windows. Use a different pause mechanism (e.g., pipe control) on Windows.
- **stdin piping**: For interactive Copilot sessions, pipe user prompts to the child process's stdin
- **Memory monitoring**: Track child process memory usage via `process.memoryUsage()` or `pidusage` library
- **Process trees**: If Copilot CLI spawns child processes, use `tree-kill` to kill the entire process tree

---

## 8. Webhook / Event-driven Architecture

### Recommended Architecture

```
External Events (GitHub, CI/CD, Custom)
          │
          ▼
┌─────────────────────────┐
│   Webhook Receiver      │
│   POST /api/webhooks    │
│                         │
│   • Signature verify    │
│   • Rate limiting       │
│   • Payload validation  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│   Event Router          │
│                         │
│   • Match event type    │
│   • Find workflow rules │
│   • Enqueue action      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│   Action Queue          │
│   (In-process or BullMQ)│
│                         │
│   • Deduplication       │
│   • Retry with backoff  │
│   • Concurrency control │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│   Workflow Executor      │
│                         │
│   • Create session      │
│   • Attach workflows    │
│   • Start execution     │
└─────────────────────────┘
```

### Implementation

```typescript
// apps/server/src/webhooks/webhookRouter.ts
import { Router } from 'express';
import crypto from 'crypto';

const webhookRouter = Router();

// Webhook signature verification middleware
function verifyWebhookSignature(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) return res.status(401).json({ error: 'Missing signature' });
    
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
  };
}

webhookRouter.post('/github',
  verifyWebhookSignature(process.env.GITHUB_WEBHOOK_SECRET!),
  async (req, res) => {
    const event = req.headers['x-github-event'] as string;
    const payload = req.body;
    
    // Route to appropriate handler
    await webhookDispatcher.dispatch({
      source: 'github',
      event,
      payload,
      receivedAt: new Date(),
    });
    
    res.status(200).json({ received: true });
  }
);

// Generic webhook endpoint for custom integrations
webhookRouter.post('/custom/:trigger',
  async (req, res) => {
    const { trigger } = req.params;
    
    await webhookDispatcher.dispatch({
      source: 'custom',
      event: trigger,
      payload: req.body,
      receivedAt: new Date(),
    });
    
    res.status(200).json({ received: true });
  }
);
```

```typescript
// packages/core/src/webhooks/WebhookDispatcher.ts
interface WebhookRule {
  id: string;
  source: string;
  event: string;
  condition?: (payload: any) => boolean;  // Optional filter
  action: {
    type: 'create_session' | 'trigger_workflow' | 'run_script';
    config: any;
  };
}

class WebhookDispatcher {
  private rules: WebhookRule[] = [];
  
  registerRule(rule: WebhookRule) {
    this.rules.push(rule);
  }
  
  async dispatch(event: WebhookEvent): Promise<void> {
    const matchingRules = this.rules.filter(rule => 
      rule.source === event.source &&
      rule.event === event.event &&
      (!rule.condition || rule.condition(event.payload))
    );
    
    for (const rule of matchingRules) {
      await this.executeAction(rule.action, event);
    }
  }
  
  private async executeAction(action: WebhookAction, event: WebhookEvent) {
    switch (action.type) {
      case 'create_session':
        const session = await sessionManager.createSession({
          ...action.config,
          triggeredBy: { source: event.source, event: event.event },
        });
        await sessionManager.startSession(session.id);
        break;
        
      case 'trigger_workflow':
        await workflowEngine.triggerWorkflow(action.config.workflowId, event.payload);
        break;
        
      case 'run_script':
        await scriptExecutor.run(action.config.script, { env: event.payload });
        break;
    }
  }
}
```

### Key Considerations

- **Idempotency**: Webhooks can be delivered multiple times. Use delivery IDs to deduplicate.
- **Async processing**: Return 200 immediately, process in background. Webhook senders have short timeouts (10-30s).
- **Retry logic**: For failed actions, implement exponential backoff (1s, 2s, 4s, 8s, max 5 retries)
- **Audit log**: Store all received webhooks in SQLite for debugging and replay
- **Rate limiting**: Use `express-rate-limit` to prevent webhook abuse
- **Queue**: For production, use BullMQ (Redis-backed) or a simple in-process queue for lighter deployments

---

## 9. Modern Design Patterns for Autonomous Agents

### Pattern 1: Command Pattern — For Session/Workflow Actions

The **Command pattern** encapsulates operations as objects, enabling queue, undo, and logging.

```typescript
// packages/core/src/commands/Command.ts
interface Command {
  id: string;
  type: string;
  execute(): Promise<CommandResult>;
  undo?(): Promise<void>;
  serialize(): Record<string, any>;
}

class StartSessionCommand implements Command {
  id = crypto.randomUUID();
  type = 'session:start';
  
  constructor(private sessionId: string, private sessionManager: SessionManager) {}
  
  async execute(): Promise<CommandResult> {
    await this.sessionManager.startSession(this.sessionId);
    return { success: true, sessionId: this.sessionId };
  }
  
  async undo(): Promise<void> {
    await this.sessionManager.pauseSession(this.sessionId);
  }
  
  serialize() {
    return { type: this.type, sessionId: this.sessionId };
  }
}
```

**Why this matters for the agent:** All user actions (create session, start workflow, send prompt) become Command objects that can be queued, serialized, logged, and undone. Webhook triggers create the same Command objects as UI actions.

### Pattern 2: Observer/EventEmitter — For Real-time Event Distribution

The **Observer pattern** (implemented via Node.js EventEmitter) is the backbone of the streaming architecture.

```typescript
// packages/core/src/events/EventBus.ts
class EventBus extends EventEmitter {
  private sequenceCounters: Map<string, number> = new Map();
  
  emitSessionEvent(sessionId: string, event: Omit<AgentEvent, 'sequenceId'>) {
    const seq = (this.sequenceCounters.get(sessionId) || 0) + 1;
    this.sequenceCounters.set(sessionId, seq);
    
    const fullEvent = { ...event, sequenceId: seq };
    
    // Persist to DB
    this.persistEvent(sessionId, fullEvent);
    
    // Broadcast to subscribers
    this.emit(`session:${sessionId}`, fullEvent);
    this.emit('session:*', { sessionId, ...fullEvent });
  }
}
```

### Pattern 3: Strategy Pattern — For Workflow Execution

Different workflow types (code generation, code review, testing, deployment) use different execution strategies.

```typescript
// packages/core/src/workflows/strategies/WorkflowStrategy.ts
interface WorkflowStrategy {
  name: string;
  validate(config: WorkflowConfig): boolean;
  execute(context: WorkflowContext): AsyncGenerator<AgentEvent>;
}

class CodeGenerationStrategy implements WorkflowStrategy {
  name = 'code-generation';
  
  validate(config: WorkflowConfig): boolean {
    return !!config.prompt && !!config.targetRepo;
  }
  
  async *execute(context: WorkflowContext): AsyncGenerator<AgentEvent> {
    // Step 1: Clone repo
    yield { type: 'workflow.step_started', data: { step: 'clone' } };
    await context.git.clone(context.config.targetRepo);
    yield { type: 'workflow.step_complete', data: { step: 'clone' } };
    
    // Step 2: Run Copilot SDK
    yield { type: 'workflow.step_started', data: { step: 'generate' } };
    for await (const token of context.copilot.stream(context.config.prompt)) {
      yield { type: 'copilot.token', data: { text: token } };
    }
    yield { type: 'workflow.step_complete', data: { step: 'generate' } };
    
    // Step 3: Run hooks
    if (context.config.hooks?.postGenerate) {
      yield { type: 'workflow.step_started', data: { step: 'hooks' } };
      await context.scriptExecutor.run(context.config.hooks.postGenerate);
      yield { type: 'workflow.step_complete', data: { step: 'hooks' } };
    }
  }
}

class WorkflowEngine {
  private strategies: Map<string, WorkflowStrategy> = new Map();
  
  registerStrategy(strategy: WorkflowStrategy) {
    this.strategies.set(strategy.name, strategy);
  }
  
  async executeWorkflow(workflow: Workflow, context: WorkflowContext) {
    const strategy = this.strategies.get(workflow.type);
    if (!strategy) throw new Error(`Unknown workflow type: ${workflow.type}`);
    
    for await (const event of strategy.execute(context)) {
      this.eventBus.emitSessionEvent(workflow.sessionId, event);
    }
  }
}
```

### Pattern 4: Event Sourcing — For Session Persistence

Instead of storing the current state, store the sequence of events that produced it. Reconstruct state by replaying events.

```typescript
// The events table IS the source of truth
// Session state is rebuilt by replaying events:
function reconstructSessionState(sessionId: string): SessionState {
  const events = db.select().from(eventsTable)
    .where(eq(eventsTable.sessionId, sessionId))
    .orderBy(eventsTable.sequenceId);
  
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'session.created': return { ...state, status: 'created' };
      case 'session.started': return { ...state, status: 'running' };
      case 'workflow.completed': return { ...state, completedWorkflows: state.completedWorkflows + 1 };
      case 'session.paused': return { ...state, status: 'paused' };
      // ... etc
    }
  }, initialState);
}
```

**Why Event Sourcing for the agent:**
- **Session persistence**: All Copilot SDK messages, git operations, and script output are events. When the app restarts, state is reconstructed from the event log.
- **Audit trail**: Complete history of what happened in every session.
- **Replay**: You can replay a session's events to debug issues or rebuild the UI state.
- **Streaming**: Events are the natural unit for SSE — the same events that are persisted are the ones streamed to clients.

### Pattern 5: CQRS (Command Query Responsibility Segregation) — Lightweight

Separate write operations (Commands) from read operations (Queries). Not a full event-driven CQRS, but a practical separation:

```
WRITES (mutations)              READS (queries)
─────────────────               ──────────────
POST /api/sessions              GET /api/sessions
POST /api/sessions/:id/start    GET /api/sessions/:id
POST /api/sessions/:id/prompt   GET /api/sessions/:id/events
DELETE /api/sessions/:id        GET /api/sessions/:id/stream (SSE)
```

**Writes** go through the Command pattern, produce events, update the database.  
**Reads** go directly to the database or cache, optimized for the UI's needs.

### Pattern Summary for the Agent

| Pattern | Where Applied | Benefit |
|---|---|---|
| **Command** | All user actions, webhook triggers | Queueable, undoable, serializable operations |
| **Observer/EventEmitter** | Event bus, SSE streaming | Decoupled event distribution to multiple consumers |
| **Strategy** | Workflow execution | Extensible workflow types without modifying engine |
| **Event Sourcing** | Session persistence, chat history | Complete audit trail, resumable sessions |
| **CQRS** | API design | Optimized reads, validated writes |
| **Repository** | Data access layer | Abstract DB from business logic |
| **Factory** | Session, workflow, process creation | Centralized creation with validation |
| **Middleware/Pipeline** | Hooks, pre/post workflow steps | Extensible processing chains |

---

## 10. Security Patterns

### 10.1 Git Credentials Management

```typescript
// packages/core/src/security/CredentialManager.ts

class CredentialManager {
  // Use system keychain for sensitive credentials
  // On macOS: Keychain, Windows: Credential Manager, Linux: libsecret
  
  async getGitCredentials(repoUrl: string): Promise<GitCredentials> {
    // 1. Check environment variables (CI/CD mode)
    if (process.env.GIT_TOKEN) {
      return { type: 'token', token: process.env.GIT_TOKEN };
    }
    
    // 2. Use Git Credential Manager (GCM) — delegates to system keychain
    // This is what GitHub CLI and Git use natively
    const token = await this.execGitCredentialHelper(repoUrl);
    if (token) return { type: 'token', token };
    
    // 3. Use GitHub CLI auth (if installed)
    const ghToken = await this.getGhCliToken();
    if (ghToken) return { type: 'token', token: ghToken };
    
    throw new Error('No Git credentials found. Run `gh auth login` first.');
  }
  
  private async getGhCliToken(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('gh auth token');
      return stdout.trim();
    } catch {
      return null;
    }
  }
}
```

**Best practices:**
- **Never store credentials in the database or config files**
- **Delegate to Git Credential Manager (GCM)** which handles keychain integration
- **Use `gh auth` for GitHub-specific operations** — it manages OAuth tokens securely
- **For CI/CD**: Use environment variables or GitHub Actions secrets
- **Credential rotation**: Use short-lived tokens (GitHub App installation tokens) when possible

### 10.2 API Key Management

```typescript
// packages/core/src/security/SecretStore.ts
import keytar from 'keytar';  // Cross-platform credential storage

const SERVICE_NAME = 'generatorai';

class SecretStore {
  async setApiKey(provider: string, key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, `api-key:${provider}`, key);
  }
  
  async getApiKey(provider: string): Promise<string | null> {
    return keytar.getPassword(SERVICE_NAME, `api-key:${provider}`);
  }
  
  async deleteApiKey(provider: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, `api-key:${provider}`);
  }
}
```

**Best practices:**
- Use `keytar` (or Electron's `safeStorage`) for OS-level credential encryption
- Environment variables for server/CI deployments
- Never log API keys — redact in all log output
- Rotate keys periodically and support multiple providers

### 10.3 Subprocess Execution Security

```typescript
// packages/core/src/security/SandboxedExecutor.ts

class SandboxedExecutor {
  // Allowlist of commands that can be executed
  private allowedCommands = new Set([
    'git', 'gh', 'node', 'npm', 'npx', 'pnpm',
    'copilot-cli', 'copilot',
  ]);
  
  async execute(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
    // 1. Validate command is in allowlist
    const binary = path.basename(command);
    if (!this.allowedCommands.has(binary)) {
      throw new SecurityError(`Command not allowed: ${command}`);
    }
    
    // 2. Sanitize arguments — prevent shell injection
    const sanitizedArgs = args.map(arg => {
      if (arg.includes('`') || arg.includes('$') || arg.includes(';')) {
        throw new SecurityError(`Suspicious argument detected: ${arg}`);
      }
      return arg;
    });
    
    // 3. Use spawn (not exec) — avoids shell interpretation
    const proc = spawn(command, sanitizedArgs, {
      shell: false,  // CRITICAL: never use shell: true
      cwd: options.cwd,
      env: this.sanitizeEnv(options.env),
      timeout: options.timeout || 300000,  // 5 min default timeout
      uid: options.uid,  // Optional: run as different user
    });
    
    // 4. Limit output size to prevent memory exhaustion
    let output = '';
    const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB
    
    proc.stdout?.on('data', (chunk) => {
      if (output.length < MAX_OUTPUT) {
        output += chunk.toString();
      }
    });
    
    return new Promise((resolve, reject) => {
      proc.on('exit', (code) => resolve({ code, output }));
      proc.on('error', reject);
    });
  }
  
  private sanitizeEnv(env?: Record<string, string>): Record<string, string> {
    const base = { ...process.env };
    // Remove sensitive env vars from child processes
    delete base.GITHUB_TOKEN;
    delete base.API_KEY;
    delete base.SECRET_KEY;
    return { ...base, ...env };
  }
}
```

### 10.4 Electron Security Checklist

```typescript
// apps/desktop/src/main.ts
const mainWindow = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,       // MUST be true
    nodeIntegration: false,        // MUST be false
    sandbox: true,                 // Enable V8 sandbox
    webSecurity: true,             // Enforce same-origin policy
    preload: path.join(__dirname, 'preload.js'),
    // Never disable any of these security features
  },
});

// Content Security Policy
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:*"
      ],
    },
  });
});
```

### 10.5 Input Validation

```typescript
// packages/shared/src/validation/schemas.ts
import { z } from 'zod';

export const createSessionSchema = z.object({
  name: z.string().min(1).max(255),
  repoUrl: z.string().url().optional(),
  baseFolder: z.string().regex(/^[a-zA-Z0-9\/_\-\.]+$/).optional(),
  requiresCodebase: z.boolean().default(false),
  workflows: z.array(z.object({
    type: z.enum(['code-generation', 'code-review', 'testing', 'deployment']),
    config: z.record(z.unknown()),
  })).max(10),
});

// Use at every API boundary (REST endpoint, IPC handler, webhook)
router.post('/api/sessions', async (req, res) => {
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.format() });
  }
  // ... proceed with validated data
});
```

### Security Summary

| Concern | Solution | Library/Tool |
|---|---|---|
| **Git credentials** | Delegate to GCM / `gh auth` | Git Credential Manager, GitHub CLI |
| **API keys** | OS keychain storage | `keytar`, Electron `safeStorage` |
| **Subprocess execution** | Command allowlist, no shell, spawn only | Node.js `child_process.spawn` |
| **Input validation** | Schema validation at every boundary | Zod |
| **Electron IPC** | Context isolation, preload scripts | Electron `contextBridge` |
| **Network security** | CSP headers, HTTPS | Helmet.js |
| **Secrets in logs** | Redact patterns | Custom middleware |
| **Dependency security** | Audit, lockfile | `pnpm audit`, Dependabot |
| **File system access** | Path validation, jail to workspace | `path.resolve()`, realpath checks |

---

## Final Technology Stack Summary

| Layer | Technology | Rationale |
|---|---|---|
| **Monorepo** | pnpm workspaces + Turborepo | Best DX-to-complexity ratio, used by modern AI tools |
| **Language** | TypeScript (strict mode) | End-to-end type safety across all packages |
| **Server** | Express.js or Fastify | Lightweight, SSE-friendly, massive ecosystem |
| **Database** | SQLite + better-sqlite3 + Drizzle ORM | Embedded, zero-ops, TypeScript-native, excellent performance |
| **Desktop** | Electron + React + Vite | Chromium-based, shares React code with web |
| **Web Client** | React + Vite | Modern DX, shares components with desktop |
| **CLI** | Ink + Commander.js | React for terminal, used by Claude Code/Gemini CLI/Copilot CLI |
| **Streaming** | SSE + Durable Stream pattern | Resumable, persistent, HTTP-friendly |
| **Server State** | TanStack Query | Caching, mutations, auto-refresh |
| **Client State** | Zustand | Lightweight, mutable outside React, streaming-friendly |
| **Validation** | Zod | Runtime type checking at all boundaries |
| **Process Mgmt** | Custom ProcessManager (spawn-based) | Full lifecycle control for Copilot CLI processes |
| **Security** | keytar + Zod + CSP + sandbox | OS keychain, input validation, Electron hardening |
| **Testing** | Vitest + ink-testing-library | Fast, Vite-native, component testing for CLI |
| **Bundling** | Vite (web/desktop renderer) + tsup (packages) | ESM-native, fast HMR, tree-shaking |
| **Packaging** | Electron Forge or electron-builder | Cross-platform desktop builds |

---

*This analysis provides the technical foundation for architecting the autonomous AI agent application. Each choice has been validated against the specific requirements: multi-interface support (Desktop, Web, CLI, Webhook), real-time streaming from Copilot SDK, session persistence, concurrent session management, and extensible workflow execution.*
