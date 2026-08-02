# Usage — CLI (`generatorai`)

> A Commander.js + Ink CLI ([apps/cli](../../apps/cli/)). Talks to a running server via REST + SSE.

For the full command surface organized by feature, see each `feature-*.md` doc.

---

## 1. Install / run

```powershell
# From the monorepo
pnpm --filter @generatorai/cli build
node apps/cli/dist/index.js <command>

# Or while developing
pnpm start:cli -- <command>

# After a global install (future):
generatorai <command>
```

The CLI scaffolds `~/.generatorai/` on first run (via `init` command, invoked automatically).

---

## 2. Global flags

| Flag | What |
|---|---|
| `--json` | Emit JSON instead of human-formatted output (great for `jq` piping). |
| `--server <url>` | Override server URL (default `http://localhost:3100`). |
| `--api-key <key>` | If the server is auth-protected (future), supply API key. |
| `--config-profile <name>` | Use a named subtree of `~/.generatorai/config.json`. |
| `--verbose` | Enable debug-level logging. |
| `--no-color` | Disable ANSI colors. |

---

## 3. Command groups (19)

```
generatorai
├── system         # health / status / models / artifacts / mcp-servers
├── health         # alias: system health
├── models         # alias: system models
├── copilot        # conversations / messages / ping
├── config         # show / set / get / edit / reset / profile {list,create,use,delete}
├── chat           # list / create / show / send / messages / watch / archive / delete
├── workflow|wf    # CRUD + validate + import-json + import-template + export + from-template
│                   #   stage {add,update,delete} / edge {add,delete}
├── run            # start / show / watch / pause / resume / cancel / retry / messages / workspace
│                   #   stage {pause,resume,retry,cancel,list}
│                   #   hitl {mode,pending,resume}
│                   #   profile {generate,validate,list}
├── orchestrator|orch  # templates / template / create / start / context / runs / cancel
├── automation|auto    # list / create / show / update / delete / enable / disable / trigger
│                       #   rotate-webhook-token / execution {list,show,cancel}
├── project|proj   # list / create / show / update / delete
│                   #   codebase {list,link,fetch,branches,browse,file,update,unlink}
│                   #   config {list,upload,get,update,delete}
│                   #   mcp {list,add,update,remove}
│                   #   worktree {list,remove,cleanup}
├── workspace|ws   # list / show / archive / commit / delete / cleanup / worktree list
├── browser        # start / stop / status / navigate / screenshot / snapshot
│                   #   inspect / snapshots / tail  — all scoped to a workspaceId
├── webhook        # list / create / delete
├── hook           # phases / test
├── harness        # show / switch
├── script|sc      # list / show / profiles / materialize / run / validate / reload
├── init           # bootstrap ~/.generatorai/ and project .generatorai/
├── completions    # bash | zsh | fish | powershell — shell completion script
└── tui            # launch the Ink terminal UI
```

For deep coverage of each, see the matching feature doc:

- Chat: [feature-chat.md → CLI](./feature-chat.md#6-cli)
- Workflows: [feature-workflows.md → CLI](./feature-workflows.md#6-cli)
- Stages: [feature-stages.md → CLI](./feature-stages.md#6-cli)
- Runs: [feature-workflow-runs.md → CLI](./feature-workflow-runs.md#13-cli)
- Automations: [feature-automations.md → CLI](./feature-automations.md#7-cli)
- Projects: [feature-projects-codebases.md → CLI](./feature-projects-codebases.md#7-cli)
- Workspaces: [feature-workspaces-files.md → CLI](./feature-workspaces-files.md#8-cli)
- Browser: [feature-integrated-browser.md](./feature-integrated-browser.md)
- Hooks: [feature-hooks.md → CLI](./feature-hooks.md#8-cli)
- Scripts: [feature-templates-scripts.md → CLI](./feature-templates-scripts.md#4-cli)
- Skills/Agents/MCP: [feature-skills-agents-mcp.md → CLI](./feature-skills-agents-mcp.md#7-cli)

---

## 4. Config (5-layer precedence)

```
1. CLI flags                            (highest)
2. Environment variables (GENERATORAI_*)
3. Project config (./.generatorai/config.json)
4. User config (~/.generatorai/config.json)
5. Built-in defaults                    (lowest)
```

Manage via:

```powershell
generatorai config show                        # full resolved tree
generatorai config get server.url
generatorai config set server.url https://api.example.com
generatorai config edit                        # opens $EDITOR
generatorai config reset

# Profiles
generatorai config profile list
generatorai config profile create prod
generatorai config profile use prod
generatorai config profile delete prod
generatorai --config-profile prod run list
```

Config schema (Zod-validated, see [apps/cli/src/config/schema.ts](../../apps/cli/src/config/schema.ts)):

```typescript
{
  server: {
    url: string;           // default http://localhost:3100
    apiKey?: string;
  };
  cli: {
    json: boolean;
    color: boolean;
    verbose: boolean;
  };
  tui: {
    refreshMs: number;     // default 5000
    theme: 'auto' | 'light' | 'dark';
  };
  profiles: Record<string, Partial<ResolvedConfig>>;
}
```

---

## 5. TUI

```powershell
generatorai tui
```

Launches the Ink-rendered terminal UI with 5 views: **Dashboard**, **Chats**, **Workflows**, **Runs**, **Settings**.

Keyboard shortcuts:

| Key | Action |
|---|---|
| `1`–`5` | Jump to view |
| `Ctrl+D` | Dashboard |
| `?` / `Ctrl+H` | Toggle help overlay |
| `Esc` / `Ctrl+B` | Go back |
| Arrow keys | Move selection |
| `Enter` | Open detail |
| `n` | New (in lists) |

Data refreshes every 5s by default.

---

## 6. Streaming events

`run watch` / `chat watch` use [apps/cli/src/streaming/SSEClient.ts](../../apps/cli/src/streaming/SSEClient.ts) + `EventRenderer.ts`.

```powershell
generatorai run watch <runId> --verbosity verbose
```

Verbosity levels:

| Level | Shows |
|---|---|
| `minimal` | Final results, errors |
| `normal` (default) | Tokens, tool calls, usage, errors |
| `verbose` | + Reasoning deltas, debug info |

Auto-reconnects with exponential backoff (1s → 30s ±500ms jitter, up to 20 attempts). `Last-Event-ID` is sent on reconnect so events aren't missed.

---

## 7. Output formats

Default: human-formatted via [apps/cli/src/output/format.ts](../../apps/cli/src/output/format.ts), with tables via `output/table.ts` (uses ANSI-stripping + column width calculation).

`--json` switches to raw JSON (single-line; pipe to `jq` for pretty-printing). Useful for shell scripts:

```powershell
generatorai run list --status running --json | jq '.[] | .id'

$ids = (generatorai run list --status running --json | ConvertFrom-Json)
foreach ($r in $ids) { generatorai run cancel $r.id }
```

`--json` is supported on every command.

---

## 8. Shell completions

```powershell
# Bash
generatorai completions bash > /etc/bash_completion.d/generatorai

# Zsh
generatorai completions zsh > ~/.zsh/completions/_generatorai

# PowerShell (Windows)
generatorai completions powershell | Out-File -Encoding utf8 $PROFILE.CurrentUserAllHosts
```

---

## 9. Direct mode (in-process)

Future feature: `--mode direct` would skip HTTP and instantiate `createCoreServices()` in-process. The plumbing is present ([apps/cli/src/platform/createClient.ts](../../apps/cli/src/platform/createClient.ts) supports `'http' | 'direct' | 'auto'`) but the direct path is not currently used; all commands go through HTTP.

---

## 10. Common workflows

### Start a workflow and watch
```powershell
generatorai run start <wfDefId> --var topic="caching" --watch
```

### Run a PWS script with profile
```powershell
generatorai script run e2e-feature-coverage --profile quick-surface --watch
```

### Approve a HITL stage
```powershell
generatorai run hitl pending <runId>                     # see what's waiting
generatorai run hitl resume <runId> <stageId> --approve
```

### Export + re-import a workflow
```powershell
generatorai workflow export <id> > my-wf.json
generatorai workflow import-json ./my-wf.json
```

### Link a private repo to a project
```powershell
generatorai project create "Acme"
generatorai project codebase link <projId> \
  --alias core \
  --type git-remote \
  --url https://github.com/acme/core.git \
  --defaultBranch main
generatorai project codebase fetch <projId> <codebaseId>   # pull latest
```

### Trigger an automation manually
```powershell
generatorai automation trigger <id>
generatorai automation execution <id>                      # list recent executions
generatorai automation execution <id> <execId>             # see iteration results
```

### Switch harness providers
```powershell
generatorai harness                  # show current
generatorai harness switch claude-agent
```

### Maintenance
```powershell
generatorai workspace cleanup --retentionHours 168 --maxDiskMb 5000
generatorai project worktree cleanup <projId>
```

---

## 11. Edge cases

1. **Server not running** — `system health` returns a clear "Could not connect" error. Most other commands need the server.
2. **`--json` + interactive prompts** — when commands need user input (`workflow import-json` confirmation, etc.), `--json` skips prompts and assumes defaults / refuses.
3. **`Ctrl+C` while watching** — sends SIGINT; the SSE client unsubscribes cleanly. The remote run continues.
4. **`hook phases` output** — flattens `categories` object to a row list (fix from session 66). Older API responses (where it was already a list) still parse correctly.
5. **CLI version vs server version mismatch** — currently no strict compatibility check. Wire formats are backwards-compatible within a major version.
6. **Stuck `run watch`** — if the run is in `awaiting_input`, watch will idle. Use `run hitl pending <runId>` from another shell.
7. **Profile path resolution** — `--profile ./fast.json` is resolved relative to cwd; bare names (`--profile quick-surface`) look first in `.generatorai/run-profiles/` then in user dir.
