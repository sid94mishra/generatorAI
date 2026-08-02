# Research: Modern Agentic CLI Architectures

## Executive Summary

This document captures research findings on how leading AI coding assistant CLIs are built, their technology stacks, architectural patterns, and best practices for building agentic TUI/CLI applications. The findings are directly relevant to GeneratorAI's `apps/cli` (Commander + Ink 5) architecture decisions.

---

## 1. Claude Code CLI (Anthropic)

### Technology Stack
- **Language**: Primarily TypeScript (~17.7% of repo), with significant Shell (~47%) for installation, Python (~29%) for backend logic
- **Terminal UI**: Uses **Ink** (React for CLI) for the interactive terminal experience. The CLI is a React-in-terminal application
- **CLI Framework**: Commander-style argument parsing with extensive flag support
- **Package Manager**: npm (distributed as `@anthropic-ai/claude-code`, now also as native binary installers)
- **Agent SDK**: Bundles a native Claude Code binary; the SDK (`@anthropic-ai/claude-agent-sdk`) is also available as a library

### Conversation Loop Architecture
- **REPL-style loop**: User types prompt, Claude executes tools autonomously, streams back results
- **Session persistence**: Sessions stored as JSONL on filesystem, can be resumed by ID or name (`--resume`, `--continue`)
- **Conversation forking**: `--fork-session` creates a new session branching from an existing one
- **Context compaction**: Task lists persist across compactions for long-running work
- **Multi-turn**: Full conversation history maintained; `Last-Event-ID` used for SSE reconnection

### Streaming Display
- **Real-time token streaming**: Tokens rendered incrementally in the terminal as they arrive
- **Tool call display**: Tool calls shown inline; MCP calls collapsed to single lines like "Called slack 3 times" by default
- **Transcript viewer**: `Ctrl+O` toggles a detailed view showing full tool usage and execution details
- **Markdown rendering**: Response text rendered with markdown formatting and syntax highlighting
- **Task list**: `Ctrl+T` shows progress of multi-step operations (up to 5 tasks visible at a time)

### Tool System
- **Built-in tools**: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Monitor, AskUserQuestion
- **MCP integration**: Full Model Context Protocol support for external tools (databases, browsers, APIs)
- **Subagents**: Can spawn specialized sub-agents with focused tool sets and instructions
- **Background tasks**: Long-running bash commands can be backgrounded with `Ctrl+B`
- **Shell mode**: `!` prefix runs commands directly without AI interpretation

### Permission Model (Most Sophisticated in the Industry)
- **Tiered system**: Read-only (no approval) -> Bash commands (approval, permanent per project) -> File modification (approval, per session)
- **Six permission modes**:
  - `default`: Standard prompt-per-first-use
  - `acceptEdits`: Auto-accepts file edits in working directory
  - `plan`: Read-only analysis mode (no modifications)
  - `auto`: AI-driven safety classification with background checks
  - `dontAsk`: Auto-denies unless pre-approved
  - `bypassPermissions`: Skips prompts (for containers/VMs only)
- **Rule syntax**: Glob-pattern matching (`Bash(npm run *)`, `Read(./.env)`, `Edit(/src/**/*.ts)`)
- **Rule precedence**: deny -> ask -> allow (first match wins)
- **Managed settings**: Organization-level policies that cannot be overridden
- **Hooks**: PreToolUse/PostToolUse hooks for custom permission logic
- **Sandboxing**: OS-level filesystem/network isolation for Bash commands (optional, complementary to permission rules)
- **Compound command awareness**: Shell operators (`&&`, `||`, `;`, `|`) are parsed; each subcommand needs independent approval

### Human-in-the-Loop (HITL)
- **Permission prompts**: Approval dialogs with tabs (left/right arrows to navigate)
- **"Yes, don't ask again"**: Permanently saves approval per project directory and command pattern
- **Interrupt**: `Ctrl+C` cancels current generation; `Ctrl+D` exits
- **Mode cycling**: `Shift+Tab` cycles through permission modes during a session
- **Side questions**: `/btw` asks quick questions without interrupting the main agent flow
- **AskUserQuestion tool**: Agent can proactively ask for clarification with multiple choice options

### Session/Conversation Persistence
- **JSONL files**: Sessions persisted to local filesystem
- **Resume by ID or name**: `claude --resume "auth-refactor"`
- **Continue most recent**: `claude -c` continues last conversation in current directory
- **PR-linked sessions**: `--from-pr 123` resumes sessions linked to a pull request
- **Cross-surface**: Sessions can be continued across terminal, VS Code, desktop app, web, and mobile

### Configuration Management
- **Layered settings**: Managed > CLI args > Local project > Shared project > User settings
- **Settings files**: `~/.claude/settings.json` (user), `.claude/settings.json` (project), `.claude/settings.local.json` (local)
- **CLAUDE.md**: Project-level instructions loaded at session start (markdown file at project root or `.claude/CLAUDE.md`)
- **Auto memory**: Learns patterns/commands across sessions without manual writing
- **Environment variables**: Extensive env var support for CI/headless use

### Key UI Features
- **Vim mode**: Full vim-style editing in the input prompt (via `/config`)
- **Reverse search**: `Ctrl+R` for command history search
- **File autocomplete**: `@` triggers file path completion
- **Prompt suggestions**: AI-generated follow-up suggestions appear as grayed-out text
- **Session recap**: One-line summary of session activity when returning after being away
- **PR status indicator**: Colored link in footer showing PR review state
- **Voice input**: Hold Space for dictation (configurable)
- **Fullscreen rendering**: Optional full-screen mode with native scrollback search

---

## 2. OpenAI Codex CLI

### Technology Stack
- **Language**: Rust (96.2% of codebase)
- **Terminal UI**: **Ratatui** (Rust TUI framework) + **Crossterm** (terminal input/output handling)
- **Build System**: Bazel (for the monorepo) + pnpm for any Node.js components
- **Async Runtime**: Tokio (multi-threaded with process, signal, IO features)
- **Streaming**: `eventsource-stream` for SSE, `tokio-tungstenite` for WebSocket
- **Architecture**: Modular monorepo with 50+ internal `codex-*` crates

### TUI Architecture
- **Ratatui-based rendering**: Frame-based rendering with animation tick intervals
- **ChatWidget**: Core UI component managing the conversation display
- **Transcript cells**: Messages stored as transcript cells with history replay buffering
- **Multi-thread support**: Multiple agent threads with `ThreadEventChannel` (32,768 capacity event channels)
- **Agent navigation state**: Side-thread tracking and navigation between agents

### Permission/Autonomy Model
- **Tiered permission profiles**: Configurable workspace access levels
- **FileSystemSandboxKind**: Restricted mode support
- **Approval workflows**: `AskForApproval` configuration determines when user review is required
- **Auto-review mode**: `ApprovalsReviewer::AutoReview` with `OnRequest` approval policies
- **Per-request approval**: Fine-grained control over which operations need human approval

### Sandboxing (Most Comprehensive)
- **macOS**: `/usr/bin/sandbox-exec` with Seatbelt profiles
- **Linux**: Landlock and bubblewrap (bwrap) backends with user namespace creation
- **Windows**: Elevated and restricted-token backends with split filesystem policies
- **Dedicated crates**: `codex-sandboxing`, `codex-windows-sandbox`, `codex-execpolicy`

### Agent Loop
- **Event-driven**: Uses async channels (`async-channel`) for message passing between agent and TUI
- **Multi-agent**: Supports multiple threads with agent navigation state
- **MCP support**: Server elicitation and thread lifecycle events
- **Plugin system**: `codex-plugin` crate for extensibility

### Key Design Decisions
- **Rust for performance**: 96% Rust gives native performance, memory safety, and reliable terminal handling
- **Separation of core/TUI**: `codex-rs/core` handles business logic; `codex-rs/tui` is the UI layer
- **Platform-specific sandboxing**: Each OS gets its own tailored sandbox implementation
- **Bazel build**: Supports the large monorepo with many internal crates

---

## 3. Aider

### Technology Stack
- **Language**: Python (80% of codebase)
- **Terminal UI**: **Rich** (terminal formatting) + **prompt_toolkit** (interactive input)
- **CLI Framework**: **Click** + **Typer** (CLI argument parsing)
- **Markdown Rendering**: Rich's `Markdown` class with custom code block formatting
- **Syntax Highlighting**: Pygments (`PygmentsLexer(MarkdownLexer)`) for input highlighting
- **Git Integration**: **GitPython** + **gitdb**
- **HTTP/Streaming**: **aiohttp** + **httpx** (async HTTP with streaming)
- **Code Parsing**: **Tree-sitter** (3.9% of codebase -- supports 100+ languages for repo mapping)
- **Configuration**: **configargparse** + **python-dotenv** + **pyyaml**

### Streaming Display Architecture
- **MarkdownStream class**: Progressive markdown rendering using Rich's Live display
- **Sliding window strategy**: Stable (already-rendered) lines emit to console above the Live window; unstable content updates in the Live area
- **Throttled at 20fps**: Delays adjusted based on render time for smooth output
- **Custom formatting**: `NoInsetCodeBlock` and `LeftHeading` classes customize code block and header display
- **StringIO buffer**: Incoming markdown converted via Rich's Markdown parser

### Edit Formats (Unique Feature)
- **Whole**: Returns complete updated files (simple but costly)
- **Diff**: Search/replace blocks (efficient, model returns only changed parts)
- **Diff-fenced**: File path inside fence (optimized for Gemini models)
- **Udiff**: Simplified unified diff format (reduces "lazy coding" in certain models)
- **Editor-diff/editor-whole**: Two-model architect pattern where architect plans and editor produces syntactically correct edits

### User Interaction
- **PromptSession**: Interactive input with multiline support (`{` triggers multiline mode)
- **AutoCompleter**: Completes file names, commands, and tokenized code symbols
- **Key bindings**: `Ctrl+Up/Down` for history, `Ctrl+X Ctrl+E` for external editor
- **Input history persistence**: Command history saved across sessions
- **Voice input**: Supported via optional voice module

### Tool/Agent Model
- **Not a general tool-calling agent**: Aider is specialized for code editing
- **Repo map**: Tree-sitter-based map of the entire repo provides context to the LLM
- **File watching**: Monitors for changes to tracked files
- **Git integration**: Automatic commits with descriptive messages after edits
- **Linting**: Can lint after edits and auto-fix issues

### Session Persistence
- **Chat history files**: Conversation logged to `.aider.chat.history.md`
- **Input history**: Past commands persisted for readline-style recall
- **Git-based**: Changes tracked through git commits, providing built-in undo via git

### Configuration
- **configargparse**: Supports config files, environment variables, and CLI args
- **`.aider.conf.yml`**: YAML config file in project root
- **`.env`**: Environment variable loading via python-dotenv
- **Model-specific settings**: Different edit formats, context windows, and behaviors per model

---

## 4. Continue.dev

### Technology Stack
- **Language**: TypeScript (84.4%), with Kotlin (3.8%), Python (2.2%), Rust
- **Architecture**: Primarily an IDE extension (VS Code, JetBrains), not a standalone CLI
- **CLI (`cn`)**: Available as a lightweight command for running agents as GitHub status checks on PRs
- **Core packages**: `config-types`, `config-yaml`, `continue-sdk`, `openai-adapters`, `hub`, `llm-info`, `fetch`, `terminal-security`

### CLI Architecture (Limited)
- **Not a full interactive TUI**: The `cn` CLI is primarily for CI/CD automation, running agents as PR checks
- **Agent checks**: Agents stored as markdown files in `.continue/checks/` that run on pull requests
- **Output**: Green/red status with suggested diffs rather than interactive terminal UI
- **Focus**: Code review automation, not interactive coding assistance

### Key Observations
- Continue.dev's strength is IDE integration, not terminal-based workflows
- The CLI is a thin runner for headless agent execution, not comparable to Claude Code or Aider
- No evidence of Ink, Blessed, or any interactive terminal UI framework usage in the CLI

---

## 5. General Best Practices for Agentic TUI/CLI Apps

### Framework Comparison

| Framework | Language | Architecture | Best For |
|-----------|----------|-------------|----------|
| **Ink** | TypeScript/Node.js | React component model, Flexbox via Yoga | Complex interactive UIs, component reuse, React ecosystem |
| **Ratatui** | Rust | Immediate-mode rendering, crossterm backend | High performance, native feel, complex layouts |
| **Rich + prompt_toolkit** | Python | Separate rendering + input libraries | Progressive enhancement, markdown rendering, streaming |
| **Bubbletea** | Go | Elm architecture (Model-Update-View) | Composable TUIs, functional style |
| **Blessed** | Node.js | Curses-like widget system | Traditional TUI layouts, ncurses replacement |
| **Clack** | TypeScript | Opinionated prompt components | Quick CLI prompts, wizard-style flows |
| **Terminal-kit** | Node.js | Low-level terminal manipulation | Full terminal control, custom rendering |

### Ink (React for CLI) -- Relevant to GeneratorAI

**Strengths (confirmed by research)**:
- **Declarative UI**: Same mental model as React web development
- **`<Static>` component**: Permanently renders output above dynamic content -- ideal for completed tool calls, logs
- **Concurrent rendering**: `render(<App />, { concurrent: true })` enables Suspense boundaries and deferred updates
- **Flexbox layout**: Yoga-based layout engine for complex arrangements
- **State management**: Standard React hooks (`useState`, `useEffect`) plus custom hooks (`useInput`, `useApp`, `useFocus`)
- **`useWindowSize`**: Adapts to terminal dimensions
- **`maxFps` control**: Throttle rendering frequency for performance
- **`incrementalRendering`**: Only update changed lines instead of full redraw
- **Testing**: `ink-testing-library` for component testing

**Weaknesses to watch**:
- Performance ceiling compared to native rendering (Ratatui)
- Complex scrolling/viewport management requires careful implementation
- Terminal compatibility varies (especially on Windows)

### Handling Streaming AI Responses in Terminal

**Pattern 1: Sliding Window (Aider approach)**
- Stable content rendered above, unstable/in-progress content in a live updating area
- Prevents "jitter" from re-rendering settled content
- Rich's `Live` display handles the updating portion

**Pattern 2: Static + Dynamic Split (Ink approach)**
- `<Static>` component for completed messages/tool results
- Dynamic component below for currently streaming response
- Natural fit for React's rendering model

**Pattern 3: Frame-based Rendering (Ratatui/Codex approach)**
- Fixed frame rate with animation ticks
- Entire viewport re-rendered each frame
- Best for complex layouts with multiple updating regions

**Key considerations**:
- Throttle updates (20fps seems to be the sweet spot for Aider; Ink's `maxFps` serves similar purpose)
- Buffer incoming tokens and flush in batches to reduce render calls
- Handle terminal scrollback correctly (streaming content should not break scroll history)

### Displaying Tool Calls and Results

**Patterns observed across tools**:
1. **Inline expansion/collapse** (Claude Code): MCP calls collapse to single lines; `Ctrl+O` expands full details
2. **Streaming diff display**: Show file changes as they happen with syntax highlighting
3. **Progress indicators**: Spinners for running tools, checkmarks for completed ones
4. **Nested display**: Subagent/tool calls indented under parent operations
5. **Color coding**: Different colors for different tool types (bash = green, edit = yellow, read = blue, etc.)

### Handling HITL (Human-in-the-Loop) During Agent Execution

**Common patterns**:
1. **Permission prompt with memory**: Ask once, remember decision for session or permanently (Claude Code)
2. **Tiered autonomy modes**: Suggest -> Auto-edit -> Full-auto (Codex-style)
3. **Interrupt + resume**: Allow `Ctrl+C` to pause, then continue or modify instructions
4. **Side channels**: `/btw` in Claude Code for quick questions without derailing the main agent
5. **Background execution**: Move long operations to background, continue interaction in foreground

### Displaying DAG Progress in Terminal

**Approaches for GeneratorAI's DAG-based workflow display**:
1. **ASCII DAG visualization**: Use box-drawing characters to show stage dependencies
2. **Status table**: Columns for stage name, status (pending/running/done/failed), duration
3. **Progressive updates**: Use Ink's `<Static>` for completed stages, live area for running stages
4. **Collapsible detail**: Show summary by default, expand to see stage logs on demand
5. **Color-coded status**: Green (complete), yellow (running), red (failed), gray (pending)
6. **Example libraries**:
   - `cli-table3` or `ink-table` for tabular stage display
   - `ink-spinner` for running stage indicators
   - `figures` for Unicode symbols (checkmarks, crosses, arrows)
   - `chalk` / `ink`'s `<Text color>` for color coding

### Rich Terminal Output Libraries for Node.js

| Library | Purpose | Relevance |
|---------|---------|-----------|
| **chalk** | Terminal string styling | Color coding stages, errors, successes |
| **ora** | Elegant terminal spinners | Running operation indicators |
| **cli-table3** | Unicode table display | DAG stage status tables |
| **boxen** | Terminal boxes | Tool call results, stage summaries |
| **figures** | Unicode symbols | Status indicators (checkmarks, arrows) |
| **log-update** | Overwrite previous terminal output | Streaming updates |
| **ink-spinner** | Spinner component for Ink | Loading states within Ink apps |
| **ink-table** | Table component for Ink | Stage tables within Ink apps |
| **ink-text-input** | Text input for Ink | User prompts within Ink apps |
| **ink-select-input** | Selection input for Ink | Permission dialogs, option selection |
| **marked-terminal** | Markdown rendering for terminal | AI response display |
| **cli-highlight** | Syntax highlighting | Code block display |
| **ansi-escapes** | ANSI escape codes | Low-level terminal manipulation |

### Session/Conversation Persistence Patterns

| Tool | Approach | Format | Resume Mechanism |
|------|----------|--------|-----------------|
| Claude Code | JSONL files on disk | JSONL | By ID, name, or "continue most recent" |
| Codex | Not documented publicly | Unknown | Thread-based |
| Aider | Chat history + git | Markdown log + git commits | Git history for code; chat log for reference |
| GeneratorAI (current) | SQLite events table + stream-log.jsonl | SQLite + JSONL | REST replay + SSE with Last-Event-ID |

### Configuration Management Patterns

| Tool | Approach | Files |
|------|----------|-------|
| Claude Code | Layered JSON settings (managed > CLI > local > project > user) + CLAUDE.md | `settings.json`, `CLAUDE.md` |
| Codex | Rust config structs with `AGENTS.md` | `AGENTS.md`, config files |
| Aider | configargparse + dotenv + YAML | `.aider.conf.yml`, `.env` |
| GeneratorAI (current) | Zod schemas in `packages/shared/src/config/` | Env vars, JSON templates |

---

## 6. Key Takeaways for GeneratorAI CLI

### What GeneratorAI Already Has Right
1. **Ink 5 + Commander 13**: Matches Claude Code's technology choice (React-in-terminal + CLI framework)
2. **SQLite event persistence**: More durable than Claude Code's JSONL approach
3. **SSE streaming with Last-Event-ID**: Industry-standard reconnection pattern
4. **DAG-based orchestration**: More sophisticated than any of the tools studied (they do linear agent loops)

### Opportunities Identified
1. **Permission model**: Claude Code's tiered permission system (deny > ask > allow with glob patterns) is the gold standard. GeneratorAI has no auth/permissions currently.
2. **Streaming display**: Consider the sliding-window approach (stable above, live below) for tool call streaming. Ink's `<Static>` component enables this natively.
3. **Tool call display**: Collapsible tool call display (summary by default, expand for details) is the best UX pattern.
4. **HITL during execution**: Need a mechanism for the user to approve/deny operations during a workflow run.
5. **Session resume**: Claude Code's named sessions and PR-linked sessions are powerful patterns.
6. **DAG progress display**: No existing tool does this well -- opportunity to innovate with ASCII DAG visualization showing stage status.
7. **Configuration layering**: Claude Code's managed > CLI > local > project > user precedence chain is worth studying.
8. **Concurrent rendering**: Enable Ink's `concurrent: true` for async operations.
9. **Background tasks**: Allow long-running stages to be backgrounded while user interacts with the CLI.
10. **Markdown rendering**: Use `marked-terminal` or Rich-style markdown rendering for AI response display.

### Architecture Recommendations
1. **Keep Ink**: It is the dominant choice for TypeScript-based agentic CLIs (used by Claude Code, the market leader)
2. **Add `<Static>` for completed items**: Use Ink's Static component for completed stage results and tool calls
3. **Implement permission modes**: At minimum, support "ask always", "auto-approve reads", and "approve all" modes
4. **Build DAG progress component**: Custom Ink component showing workflow DAG with live status updates
5. **Add streaming markdown**: Render AI responses with markdown formatting using syntax highlighting
6. **Session naming**: Allow users to name and resume sessions by name (not just ID)
