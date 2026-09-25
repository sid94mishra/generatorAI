# GeneratorAI CLI

A full-featured command-line interface for [GeneratorAI](../../) — manage chats, workflows, runs, automations, projects and more from your terminal.

```
generatorai [options] <command>
```

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Config file](#config-file)
  - [Environment variables](#environment-variables)
  - [CLI flags](#cli-flags)
  - [Config commands](#config-commands)
  - [Profiles](#profiles)
- [Global Options](#global-options)
- [Commands](#commands)
  - [system](#system)
  - [chat](#chat)
  - [workflow](#workflow-wf)
  - [run](#run)
  - [orchestrator](#orchestrator)
  - [automation](#automation-auto)
  - [project](#project-proj)
  - [workspace](#workspace-ws)
  - [webhook](#webhook)
  - [copilot](#copilot)
  - [config](#config)
  - [init](#init)
  - [tui](#tui)
  - [completions](#completions)
- [Streaming & HITL](#streaming--hitl)
- [Output Formats](#output-formats)
- [Exit Codes](#exit-codes)
- [TUI Reference](#tui-reference)
- [Development](#development)

---

## Installation

> **Prerequisites:** Node.js ≥ 18, pnpm, a running GeneratorAI server.

From the monorepo root:

```bash
pnpm install
pnpm --filter @generatorai/cli build
```

The binary is available at `apps/cli/dist/index.js`. During development use the `dev` script to run directly from source:

```bash
# From apps/cli/
pnpm dev -- <command> [options]

# Or via the monorepo root
pnpm --filter @generatorai/cli dev -- <command> [options]
```

To install globally (optional):

```bash
npm install -g .   # from apps/cli/
generatorai --version
```

---

## Quick Start

```bash
# 1. Point at your server
generatorai config set server.url http://localhost:3100

# 2. Check connectivity
generatorai system health

# 3. List available AI models
generatorai system models

# 4. Start chatting
generatorai chat create "My first chat"
generatorai chat send <chat-id> "Hello, world!"

# 5. Launch the interactive TUI
generatorai tui
```

---

## Configuration

Configuration is loaded from five sources in order (later layers win):

| Priority | Source |
|----------|--------|
| 1 (lowest) | Built-in defaults |
| 2 | User config `~/.generatorai/config.json` |
| 3 | Project config `.generatorai/config.json` |
| 4 | Environment variables |
| 5 (highest) | CLI flags (`--server`, `--api-key`) |

### Config file

Default location: `~/.generatorai/config.json`

```json
{
  "server": {
    "url": "http://localhost:3100",
    "apiKey": "your-api-key"
  },
  "cli": {
    "defaultOutput": "human",
    "color": "auto",
    "pager": true,
    "streamVerbosity": "normal",
    "confirmDestructive": true,
    "defaultModel": "gpt-4o"
  },
  "tui": {
    "theme": "auto",
    "showUsage": true,
    "collapseTools": true,
    "maxStreamHistory": 500
  }
}
```

#### Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `server.url` | string | `http://localhost:3100` | GeneratorAI server URL |
| `server.apiKey` | string | — | API key for authentication |
| `cli.defaultOutput` | `human`\|`json` | `human` | Default output format |
| `cli.color` | `auto`\|`always`\|`never` | `auto` | Terminal color mode |
| `cli.pager` | boolean | `true` | Enable pager for long output |
| `cli.streamVerbosity` | `minimal`\|`normal`\|`verbose` | `normal` | SSE stream detail level |
| `cli.confirmDestructive` | boolean | `true` | Prompt before destructive operations |
| `cli.defaultModel` | string | — | Default AI model |
| `cli.editor` | string | `$EDITOR` | Editor for `config edit` |
| `tui.theme` | `dark`\|`light`\|`auto` | `auto` | TUI color theme |
| `tui.showUsage` | boolean | `true` | Show token usage in TUI |
| `tui.collapseTools` | boolean | `true` | Collapse tool calls in TUI |
| `tui.maxStreamHistory` | number | `500` | Max events retained in TUI |

### Environment variables

```bash
GENERATORAI_SERVER_URL=http://my-server:3100
GENERATORAI_API_KEY=sk-...
GENERATORAI_OUTPUT=json         # human | json
GENERATORAI_COLOR=always        # auto | always | never
GENERATORAI_VERBOSITY=verbose   # minimal | normal | verbose
GENERATORAI_PROFILE=production  # activate a named profile
```

### CLI flags

Flags override everything else for that invocation:

```bash
generatorai --server http://other-server:3100 --api-key sk-xxx system health
```

### Config commands

```bash
generatorai config show                  # display resolved config
generatorai config get server.url        # read a single key
generatorai config set server.url http://localhost:3100
generatorai config set cli.defaultOutput json
generatorai config edit                  # open config file in $EDITOR
generatorai config reset                 # restore defaults
```

### Profiles

Profiles let you switch between multiple server environments.

```bash
generatorai config profile list
generatorai config profile create staging --server-url http://staging:3100 --api-key sk-stg
generatorai config profile use staging
generatorai config profile delete staging
```

---

## Global Options

These flags work with every command:

| Flag | Description |
|------|-------------|
| `--server <url>` | Override server URL for this invocation |
| `--api-key <key>` | Override API key for this invocation |
| `--profile <name>` | Use a named profile |
| `--json` | Output raw JSON instead of human-readable tables |
| `--verbose` | Enable verbose logging |
| `--version` | Print CLI version |
| `-h, --help` | Show help |

---

## Commands

### system

Server health, models, status, and infrastructure.

```bash
generatorai system health           # server health + uptime
generatorai system health-config    # server runtime configuration
generatorai system models           # list available AI models
generatorai system status           # overall platform status
generatorai system artifacts        # list system-level artifacts
generatorai system mcp-servers      # list registered MCP servers
```

**Examples:**

```bash
# Check health with JSON output for scripting
generatorai system health --json | jq .status

# List models and filter GPT ones
generatorai system models --json | jq '.[].id | select(startswith("gpt"))'
```

---

### chat

Create and manage AI chat conversations with real-time streaming.

```bash
generatorai chat list [--status active|archived] [--project <id>]
generatorai chat create <name> [--model <model>] [--project <id>] [--description <desc>] [--tags tag1,tag2] [--worktree]
generatorai chat show <id>
generatorai chat send <id> <message> [--stream] [--verbosity minimal|normal|verbose] [--thinking]
generatorai chat messages <id>
generatorai chat watch <id>          # tail live events (Ctrl+C to stop)
generatorai chat delete <id>
```

**Examples:**

```bash
# Create a chat and immediately send a message
generatorai chat create "code review" --model gpt-4o
generatorai chat send abc12345 "Review the auth module for security issues"

# Stream with full verbosity (shows tool calls, thinking)
generatorai chat send abc12345 "Refactor this function" --stream --verbosity verbose --thinking

# Watch all events in real time from another terminal
generatorai chat watch abc12345

# CI-friendly: get chat ID from JSON output
CHAT_ID=$(generatorai chat create "ci-run" --json | jq -r .id)
generatorai chat send "$CHAT_ID" "Run linting" --json
```

---

### workflow (wf)

A workflow definition is one v2 document (`WorkflowGraph`: workflow settings,
stages keyed by `key`, edges between keys). Definitions start as drafts; runs
use the latest published version (`run start --test-run` runs the draft).

```bash
generatorai workflow list [--project <ref>|global] [--status draft|published] [--search <text>] [--tag <tag>] [--archived]
generatorai wf create <file.json> [--name <name>] [--project <ref>] [--tags a,b] [--publish]
generatorai wf create --name <name>                  # an empty draft
generatorai wf import <file.json> [--publish]        # a canonical (exported) document
generatorai wf import --template <templateId> [--name <name>] [--publish]
generatorai wf export <workflow> [--out file.json]   # canonical document; import gives it back unchanged
generatorai wf validate <file.json|workflow>         # issues with JSON pointer, stage key and hint
generatorai wf publish <workflow>
generatorai wf versions <workflow>
generatorai wf show <workflow>
generatorai wf update <workflow> [--name <name>] [--description <text>] [--tags a,b]
generatorai wf clone <workflow> [name]
generatorai wf delete <workflow>                     # archived instead when runs pin it

# Stages (by key or name)
generatorai wf stage list <workflow>
generatorai wf stage add <workflow> --name <name> [--key <key>] [--prompt <text>|--prompt-file <file>]
    [--guard <expr>] [--retry-attempts <n>] [--timeout-ms <ms>] [--output-format text|json]
    [--context-from a,b] [--context-mode summary|output|structured|none]
    [--agent <scope:slug>] [--model <id>] [--approval on|off]
generatorai wf stage update <workflow> <stage> [same flags, --name]
generatorai wf stage remove <workflow> <stage>
generatorai wf stage hook list|add|remove <workflow> <stage> ...

# Edges (one per stage pair)
generatorai wf edge list <workflow>
generatorai wf edge add <workflow> --from <stage> --to <stage> [--on success|failure|completion|always] [--when <expr>]
generatorai wf edge remove <workflow> --from <stage> --to <stage>
```

Every stage and edge command edits the whole graph: it reads the definition,
changes it, validates it locally and saves it with the revision it read. If
someone else saved in between (409), the change is re-applied once to a fresh
read; a second conflict is reported and nothing is saved.

**Example: build a code review workflow:**

```bash
generatorai wf create --name "Code Review"
generatorai wf stage add "Code Review" --name "Lint check" --prompt "Run linting and report issues"
generatorai wf stage add "Code Review" --name "Security scan" --prompt "Check for security vulnerabilities" --approval on
generatorai wf edge add "Code Review" --from lint_check --to security_scan
generatorai wf validate "Code Review"
generatorai wf publish "Code Review"
generatorai wf export "Code Review" --out workflows/code-review.json
```

---

### run

Start and monitor workflow run executions.

```bash
generatorai run list [--status created|starting|paused|completed|failed|cancelled] [--definition <id>] [--limit 20]
generatorai run start <workflow> [--var key=value ...] [--profile <name>] [--skip <stageKey> ...] [--stage-var <stageKey>.<name>=<value> ...] [--test-run] [--watch] [--permission-mode <mode>]
generatorai run show <id>
generatorai run watch <id> [--verbosity minimal|normal|verbose] [--thinking]
generatorai run cancel <id>
generatorai run retry <id>

# Human-in-the-loop (HITL)
generatorai run hitl mode <id> <mode>          # set permission mode
generatorai run hitl pending <id>              # list pending approvals
generatorai run hitl resume <runId> <stage> [--approve] [--reject] [--reason <text>] [--value <json>]

# Stage-level controls
generatorai run stage pause <runId> <stage>
generatorai run stage resume <runId> <stage>
generatorai run stage retry <runId> <stage>
generatorai run stage cancel <runId> <stage>
```

**Permission modes:**

| Mode | Description |
|------|-------------|
| `bypassPermissions` | Auto-approve all actions (default) |
| `default` | Standard permission checks |
| `acceptEdits` | Auto-accept file edits, prompt for others |
| `plan` | Plan mode — propose but don't execute |

**Example: Run with live watching:**

```bash
# Start and immediately tail events
generatorai run start abc12345 --name "release-v2.0" \
  --var version=2.0 --var env=production \
  --watch --permission-mode acceptEdits

# In another terminal — check pending approvals
generatorai run hitl pending <run-id>

# Approve a stage
generatorai run hitl resume <run-id> <stage-id> --approve --reason "Looks good"

# Reject with feedback
generatorai run hitl resume <run-id> <stage-id> --reject --reason "Needs more context"
```

---

### orchestrator

High-level orchestrated workflow runs via system templates.

```bash
generatorai orchestrator start --definition <id> [--project <id>] [--vars '{"key":"value"}']
generatorai orchestrator cancel <runId>
```

---

### automation (auto)

Automate workflows via webhooks, schedules, or manual triggers.

```bash
generatorai automation list [--project <id>]
generatorai auto create --name <name> --definition <id> [--trigger webhook|schedule|manual] [--schedule <cron>] [--project <id>]
generatorai auto show <id>
generatorai auto enable <id>
generatorai auto disable <id>
generatorai auto trigger <id>                # manually trigger
generatorai auto delete <id>
generatorai auto executions <id>             # list past executions
generatorai auto rotate-token <id>           # rotate webhook secret
```

**Example: Schedule a nightly workflow:**

```bash
# Create a daily automation at 2am UTC
generatorai auto create \
  --name "Nightly Code Audit" \
  --definition abc12345 \
  --trigger schedule \
  --schedule "0 2 * * *"

# Enable it
generatorai auto enable <automation-id>

# Check last executions
generatorai auto executions <automation-id>
```

---

### project (proj)

Organize work into projects with linked codebases.

```bash
generatorai project list [--status active|archived]
generatorai proj create <name> [--description <desc>]
generatorai proj show <id>
generatorai proj update <id> [--name <name>] [--description <desc>]
generatorai proj delete <id>

# Codebases
generatorai proj codebase link <projectId> <path> [--type git-remote|git-local|local-dir] [--name <name>]
generatorai proj codebase unlink <projectId> <codebaseId>
generatorai proj codebase list <projectId>

# Artifacts
generatorai proj artifacts <projectId>
```

---

### workspace (ws)

Manage AI workspaces (git worktrees used by runs and chats).

```bash
generatorai workspace list [--status active|archived|deleted] [--project <id>]
generatorai ws show <id>
generatorai ws archive <id>
generatorai ws commit <id> [--message <msg>]   # commit pending changes
generatorai ws delete <id>
generatorai ws cleanup                          # remove stale workspaces
```

---

### hook

Hook phases and dry-run testing.

```bash
generatorai hook phases
generatorai hook test <sessionId> <phase> [--payload '{"key":"value"}']
```

---

### copilot

Copilot conversation management.

```bash
generatorai copilot conversations           # list copilot conversations
generatorai copilot messages <sessionId>    # list messages in a conversation
generatorai copilot ping                    # check copilot bridge connectivity
```

---

### config

Manage CLI configuration and profiles (see [Configuration](#configuration) for full details).

```bash
generatorai config show
generatorai config get <key>
generatorai config set <key> <value>
generatorai config edit
generatorai config reset

generatorai config profile list
generatorai config profile create <name> [--server-url <url>] [--api-key <key>]
generatorai config profile use <name>
generatorai config profile delete <name>
```

---

### init

Initialize a GeneratorAI configuration in the current directory.

```bash
generatorai init [--force]
```

Creates a `.generatorai/config.json` in the current directory. Existing config is preserved unless `--force` is passed.

---

### tui

Launch the interactive terminal UI (full keyboard-driven interface).

```bash
generatorai tui
```

See [TUI Reference](#tui-reference) for keyboard shortcuts and navigation.

---

### completions

Generate shell completion scripts.

```bash
# Bash
generatorai completions bash >> ~/.bashrc
source ~/.bashrc

# Zsh
generatorai completions zsh > ~/.zsh/completions/_generatorai
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc

# Fish
generatorai completions fish > ~/.config/fish/completions/generatorai.fish

# PowerShell
generatorai completions powershell >> $PROFILE
```

---

## Streaming & HITL

### SSE streaming

Commands that stream live events (`chat send`, `chat watch`, `run watch`) use Server-Sent Events. Streaming shows:

- **Token output** — AI response text as it's generated
- **Tool calls** — functions the AI is invoking
- **Thinking** — internal reasoning (if `--thinking` flag is set)
- **HITL prompts** — approval requests requiring your input
- **Usage** — token counts on completion

Control verbosity with `--verbosity`:

| Level | Shows |
|-------|-------|
| `minimal` | Final text only |
| `normal` | Text + tool names (default) |
| `verbose` | Text + full tool args/results + thinking |

### Human-in-the-Loop (HITL)

When a run requires human approval, the watching terminal will display a prompt. You can respond from any terminal:

```bash
# See what's waiting
generatorai run hitl pending <run-id>

# Approve
generatorai run hitl resume <run-id> <stage-id> --approve

# Reject with reason
generatorai run hitl resume <run-id> <stage-id> --reject --reason "Please use a different approach"

# Approve with structured value
generatorai run hitl resume <run-id> <stage-id> --approve --value '{"selectedBranch":"main"}'
```

---

## Output Formats

### Human (default)

Formatted tables and colored output to stderr. Designed for interactive use.

```
  Chats                                                   2 items
  ──────────────────────────────────────────────────────────────
  ID        Name                  Status    Model       Created
  ──────────────────────────────────────────────────────────────
  abc12345  code review           active    gpt-4o      2 mins ago
  def67890  nightly audit         archived  claude-3-5  1 day ago
```

### JSON (`--json`)

Raw JSON to stdout. Use for scripting and piping to `jq`.

```bash
# Get all active chat IDs
generatorai chat list --json | jq -r '.[] | select(.status=="active") | .id'

# Start run and capture ID
RUN_ID=$(generatorai run start abc12345 --json | jq -r .id)

# Poll run status
generatorai run show "$RUN_ID" --json | jq .status
```

### ID prefixes

All commands that accept an `<id>` support short prefix matching — you only need enough characters to be unambiguous:

```bash
generatorai chat show abc1   # matches abc12345... if unique
generatorai run cancel def6
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Timeout |
| `3` | Cancelled (Ctrl+C) |
| `4` | Resource not found |
| `5` | Authentication failure |
| `126` | Permission denied / cannot execute |
| `127` | Command not found |

Use these in scripts:

```bash
generatorai system health
if [ $? -ne 0 ]; then
  echo "Server is down!" && exit 1
fi
```

---

## TUI Reference

Launch with `generatorai tui`.

### Navigation

| Key | Action |
|-----|--------|
| `1` | Dashboard |
| `2` | Chats |
| `3` | Workflows |
| `4` | Runs |
| `5` | Settings |
| `↑` / `↓` | Move selection in list |
| `Enter` | Open selected item |
| `Esc` | Go back |
| `r` | Refresh data |
| `?` | Toggle help overlay |
| `q` / `Ctrl+C` | Quit |

### Views

| View | Description |
|------|-------------|
| **Dashboard** | Summary stats — active chats, runs, workflows |
| **Chats** | Browse and select chat conversations |
| **Workflows** | Browse workflow definitions |
| **Runs** | Monitor workflow run statuses |
| **Settings** | View current configuration |

Data auto-refreshes every 5 seconds. Press `r` to refresh immediately.

---

## Development

### Running from source

```bash
cd apps/cli
pnpm dev -- system health          # run any command from source
pnpm dev -- tui                    # launch TUI from source
```

### Typecheck

```bash
pnpm typecheck
# or
npx tsc --noEmit --skipLibCheck
```

### Build

```bash
pnpm build       # compiles to dist/
```

### Tests

```bash
pnpm test
```

### Project structure

```
apps/cli/
├── src/
│   ├── index.tsx              # Entry point, Commander program
│   ├── commands/              # All CLI command modules
│   │   ├── index.ts           # Command registry
│   │   ├── system.ts          # system health/models/status
│   │   ├── chat.ts            # chat lifecycle + streaming
│   │   ├── workflow.ts        # workflow CRUD + stages + edges
│   │   ├── run.ts             # run lifecycle + HITL
│   │   ├── orchestrator.ts    # orchestrated runs
│   │   ├── automation.ts      # automation CRUD
│   │   ├── project.ts         # project + codebases
│   │   ├── workspace.ts       # workspace management
│   │   ├── webhook.ts         # webhooks + hook phases
│   │   ├── copilot.ts         # copilot bridge
│   │   ├── config.ts          # config + profiles
│   │   ├── init.ts            # project init
│   │   └── completions.ts     # shell completions
│   ├── config/                # Configuration system
│   │   ├── schema.ts          # Zod schema
│   │   ├── paths.ts           # File path helpers
│   │   ├── loadConfig.ts      # 5-layer config loading
│   │   └── profileManager.ts  # Profile CRUD
│   ├── platform/              # Server client
│   │   ├── types.ts           # CLIPlatformClient interface
│   │   ├── HttpPlatformClient.ts  # REST + SSE implementation
│   │   └── createClient.ts    # Client factory
│   ├── streaming/             # SSE streaming
│   │   ├── SSEClient.ts       # EventSource with reconnection
│   │   └── EventRenderer.ts   # Terminal event rendering
│   ├── output/                # Output formatting
│   │   ├── json.ts            # JSON formatter
│   │   ├── table.ts           # Table formatter
│   │   └── format.ts          # Unified dispatcher
│   ├── tui/                   # Interactive TUI (Ink/React)
│   │   ├── index.tsx          # launchTUI()
│   │   ├── TUIApp.tsx         # Root component
│   │   ├── stores/appStore.ts # Zustand state
│   │   ├── hooks/             # useStore, useKeyboard, useDataLoader
│   │   ├── components/        # StatusBar, NavBar, HelpOverlay
│   │   └── views/             # Dashboard, Chats, Workflows, Runs, Settings
│   ├── utils/
│   │   ├── constants.ts       # EXIT_CODES, DEFAULT_SERVER_URL
│   │   ├── formatDuration.ts  # Human-readable durations
│   │   └── retry.ts           # Exponential backoff
│   └── instrumentation.ts     # OpenTelemetry bootstrap
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Adding a new command

1. Create `src/commands/mycommand.ts` following the existing pattern:

```typescript
import { Command } from 'commander';
import type { CLIPlatformClient } from '../platform/types.js';

export function registerMyCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const cmd = program.command('mycommand').description('My new command');

  cmd
    .command('list')
    .description('List things')
    .action(async () => {
      const client = await getClient();
      const items = await client.listSomething();
      // ... format and output
    });
}
```

2. Register it in `src/commands/index.ts`:

```typescript
import { registerMyCommands } from './mycommand.js';
// ...
registerMyCommands(program, getClient);
```

3. Typecheck: `pnpm typecheck`

---

## License

Private — part of the GeneratorAI monorepo.
