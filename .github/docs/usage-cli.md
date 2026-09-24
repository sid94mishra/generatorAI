# Usage — CLI (`generatorai`)

> A Commander.js + Ink CLI ([apps/cli](../../apps/cli/)). Talks to a running server via REST + SSE.

For the full command surface organized by feature, see each `feature-*.md` doc.

`generatorai agent …` (`list` · `show` · `create` · `export` · `usage` · `delete`
· `resolve`) manages first-class agents; `generatorai chat create --agent <ref>`
binds one. See [feature-agents.md](./feature-agents.md#9-cli).

---

## 1. Install / run

```powershell
# From the monorepo
pnpm --filter @generatorai/cli build
node apps/cli/dist/index.js <command>

# Or while developing
pnpm dev:cli -- <command>

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
| `--config-profile <name>` | Use a named config profile. |
| `--connection <name>` | Use a named server from the connection catalog. |
| `--ndjson` | One JSON object per line — streams without buffering. |
| `--yaml` | YAML output. |
| `-q, --quiet` | Suppress output; report through the exit code only. |
| `-y, --yes` | Assume yes for confirmations. |
| `--timeout <ms>` | Abort the command after this many milliseconds. |
| `--verbose` | Enable debug-level logging to stderr. |
| `--no-color` | Disable ANSI colors. |
| `--no-unicode` | ASCII-only output. |
| `-i, --interactive` | Launch the TUI instead of running a command. |

---

## 3. Command surface

Everything below is generated from the command registry in
[packages/cli-core/src/commands/](../../packages/cli-core/src/commands/). The
same registry produces the `--help` text, the shell completions, the TUI command
palette and the companion RPC method table, so these can never disagree.

<!-- @generated-commands:start — regenerate with `pnpm cli:docs`; do not edit by hand -->

```
generatorai
├── connect               # Servers this CLI knows about, and which one it is talking to
│     add · endpoint add · endpoint remove · list · remove · rename · test
│     · use
├── device                # Pairing, this installation's credential, and the device registry
│     audit · forget · invite · invites · list · pair · revoke · scopes ·
│     status
├── chat                  # Conversations against a provider, optionally scoped to a project
│     archive · cancel · create · delete · list · messages ·
│     permission-mode · plan · plans · send · show · tasks · update ·
│     watch
├── agent                 # First-class agent definitions
│     delete · export · import · list · resolve · show · usage
├── workflow (wf)         # Workflow definitions: stages, edges, variables and validation
│     clone · create · delete · edge add · edge delete · edge list ·
│     export · from-template · import-json · list · show · stage add ·
│     stage delete · stage hook add · stage hook list · stage hook remove
│     · stage list · stage update · stage variables · update · validate
├── run                   # Workflow run lifecycle, stage controls and human-in-the-loop gates
│     cancel · delete · diff · hitl approve · hitl changes-request · hitl
│     mode · hitl pending · hitl reject · list · messages · pause ·
│     profile generate · profile list · profile validate · resume · retry
│     · show · stage cancel · stage list · stage pause · stage resume ·
│     stage retry · start · watch · workspace
├── automation (auto)     # Scheduled, webhook and manual triggers that fan out into runs
│     create · datasource test · delete · disable · enable · execution
│     cancel · execution list · execution show · list ·
│     rotate-webhook-token · show · trigger · update
├── project (proj)        # Projects, linked codebases, configs, MCP servers and worktrees
│     codebase branches · codebase browse · codebase fetch · codebase file
│     · codebase link · codebase list · codebase unlink · config delete ·
│     config list · config upload · create · delete · list · mcp add · mcp
│     list · mcp remove · show · update · worktree cleanup · worktree list
│     · worktree remove
├── workspace (ws)        # Per-run filesystems, their files, changes and checkpoints
│     archive · cat · changes · checkpoints · cleanup · commit · delete ·
│     list · pr · put · restore · show · tree · worktree list
├── terminal (term)       # PTYs attached to a workspace
│     attach · create · kill · list · scrollback · signal
├── script (sc)           # Programmatic workflow scripts (.workflow.mjs)
│     list · materialize · profiles · reload · run · show · validate
├── template              # System workflow templates
│     list · show
├── orchestrator (orch)   # System workflows and orchestrated runs
│     cancel · templates
├── extension (ext)       # Hot-loadable extensions
│     disable · enable · list · reload · show · uninstall
├── widget                # Agent-rendered widget surfaces
│     close · list · read · set-state
├── review                # Review threads on workspace files
│     create · list · reply · resolve · submit · unresolve
├── browser               # Workspace-scoped Chromium
│     back · dom · forward · navigate · read · reload · screenshot ·
│     snapshots · start · status · stop
├── computer              # Computer Use: desktop windows and audit
│     activity · answer · frames · grants · pending · revoke · runtime ·
│     status
├── hook                  # Lifecycle hooks
│     list · phases · test
├── webhook               # Incoming and outgoing webhooks
│     create · delete · list
├── harness               # AI provider selection
│     show · switch
├── source-control (scm)  # Git provider and pull-request configuration
│     config · status
├── security              # Security posture, devices and audit
│     audit · network-access · posture
├── system                # Server health, models, artifacts and diagnostics
│     artifact · artifacts · config · doctor · health · mcp-servers ·
│     models · version
└── config                # Configuration, profiles and key bindings
      get · keymap list · keymap set · path · profile create · profile
      delete · profile list · profile use · reset · set · show · unset
```

### `connect`

Servers this CLI knows about, and which one it is talking to

| Command | What | Flags |
|---|---|---|
| `connect add <url> [options]` | Register a server and make it active | `--label` `--local` |
| `connect endpoint add <connection> <url>` | Add another route to the same server | — |
| `connect endpoint remove <connection> <url>` | Remove a route | — |
| `connect list` | Servers this CLI can reach | — |
| `connect remove <connection>` | Forget a server | — |
| `connect rename <connection> <label>` | Rename a connection | — |
| `connect test [connection]` | Probe every known route to a server | — |
| `connect use <connection>` | Switch the active server | — |

### `device`

Pairing, this installation's credential, and the device registry

| Command | What | Flags |
|---|---|---|
| `device audit [options]` | Authentication events | `--limit` |
| `device forget [connection]` | Delete this installation's credential for a server | — |
| `device invite [options]` | Mint a pairing code for a new device | `--scopes` `--name` `--platform` `--ttl` `--data-dir` |
| `device invites` | Pairing codes that have not been redeemed yet | — |
| `device list [options]` | Devices paired with the server | `--all` |
| `device pair <code> [options]` | Pair this CLI with a server using a pairing code | `--name` |
| `device revoke <device>` | Revoke another device's credential | — |
| `device scopes <device> [scopes]` | Show or set a device's scopes | — |
| `device status` | This installation's credential and where it is stored | — |

### `chat`

Conversations against a provider, optionally scoped to a project

| Command | What | Flags |
|---|---|---|
| `chat archive <chat>` | Archive a chat | — |
| `chat cancel <chat>` | Stop the in-flight turn | — |
| `chat create <name> [options]` | Create a chat | `--description` `--model` `--project` `--agent` `--codebase` `--folder` `--worktree` `--no-worktree` `--primary` `--tags` `--permission-mode` |
| `chat delete <chat>` | Delete a chat and its messages | — |
| `chat list [options]` | List chats | `--status` `--project` `--limit` |
| `chat messages <chat> [options]` | Message history | `--limit` `--before` |
| `chat permission-mode <chat> [mode]` | Show or set the chat permission mode | — |
| `chat plan <chat> <planId> [options]` | Print a plan document, or approve/reject it | `--approve` `--reject` `--note` |
| `chat plans <chat>` | Plans produced in a chat | — |
| `chat send <chat> <prompt> [options]` | Send a prompt and stream the reply | `--verbosity` `--no-stream` `--model` `--agent` `--attach` |
| `chat show <chat>` | Show one chat | — |
| `chat tasks <chat>` | Background tasks spawned by an orchestrator chat | — |
| `chat update <chat> [options]` | Rename or retag a chat | `--name` `--description` `--tags` `--model` `--agent` |
| `chat watch <chat> [options]` | Attach to a chat and stream events as they arrive | `--verbosity` |

### `agent`

First-class agent definitions

| Command | What | Flags |
|---|---|---|
| `agent delete <agent> [options]` | Delete an agent | `--force` |
| `agent export <agent> [options]` | Export an agent as markdown | `--out` |
| `agent import <file> [options]` | Import an agent from a markdown file | `--scope` `--project` `--overwrite` |
| `agent list [options]` | List agents | `--scope` `--project` |
| `agent resolve [agent] [options]` | Preview the effective agent after overrides and project config | `--scope` `--project` `--harness` |
| `agent show <agent>` | Show an agent | — |
| `agent usage <agent>` | Chats, stages and workflows bound to an agent | — |

### `workflow` (alias: `wf`)

Workflow definitions: stages, edges, variables and validation

| Command | What | Flags |
|---|---|---|
| `workflow clone <workflow> [name]` | Copy a definition, stages and edges included | — |
| `workflow create <name> [options]` | Create an empty workflow definition | `--description` `--project` `--tags` |
| `workflow delete <workflow>` | Delete a definition | — |
| `workflow edge add <workflow> [options]` | Connect two stages | `--from` `--to` `--on` |
| `workflow edge delete <workflow> <edge>` | Delete an edge | — |
| `workflow edge list <workflow>` | Edges in a definition | — |
| `workflow export <workflow> [options]` | Export a definition as JSON | `--out` |
| `workflow from-template <template> [options]` | Create a definition from a system template | `--name` |
| `workflow import-json <file> [options]` | Import a definition from a JSON file | `--name` |
| `workflow list [options]` | List workflow definitions | `--project` `--tag` `--limit` |
| `workflow show <workflow>` | Show a definition with its stages and edges | — |
| `workflow stage add <workflow> [options]` | Add a stage | `--name` `--prompt` `--prompt-file` `--model` `--agent` `--order` `--timeout` `--retries` `--var` `--condition` `--condition-expression` |
| `workflow stage delete <workflow> <stage>` | Delete a stage and its edges | — |
| `workflow stage hook add <workflow> <stage> [options]` | Attach a lifecycle hook to a stage | `--name` `--phase` `--type` `--config` `--priority` `--timeout` `--retries` `--failure-policy` `--disabled` |
| `workflow stage hook list <workflow> <stage>` | A stage's lifecycle hooks | — |
| `workflow stage hook remove <workflow> <stage> <hook>` | Detach a lifecycle hook from a stage | — |
| `workflow stage list <workflow>` | Stages in a definition | — |
| `workflow stage update <workflow> <stage> [options]` | Patch a stage | `--name` `--prompt` `--prompt-file` `--model` `--agent` `--timeout` `--retries` `--var` `--clear-vars` `--condition` `--condition-expression` |
| `workflow stage variables <workflow> <stage>` | A stage's variables | — |
| `workflow update <workflow> [options]` | Patch a definition | `--name` `--description` `--tags` |
| `workflow validate <workflow>` | Check a definition for cycles, orphans and bad references | — |

### `run`

Workflow run lifecycle, stage controls and human-in-the-loop gates

| Command | What | Flags |
|---|---|---|
| `run cancel <run>` | Cancel a run | — |
| `run delete <run>` | Delete a run record | — |
| `run diff <run>` | Unified diff of everything a run changed | — |
| `run hitl approve <run> <stage> [options]` | Approve a waiting stage | `--value` `--reason` `--follow-up` |
| `run hitl changes-request <run> <stage> [options]` | Send a waiting stage back for changes | `--value` `--reason` `--follow-up` |
| `run hitl mode <run> [mode]` | Show or set the run permission mode | — |
| `run hitl pending <run>` | Gates waiting for a human decision | — |
| `run hitl reject <run> <stage> [options]` | Reject a waiting stage and fail the run | `--value` `--reason` `--follow-up` |
| `run list [options]` | List workflow runs | `--status` `--definition` `--limit` |
| `run messages <run> [options]` | Messages recorded for a run, optionally one stage | `--stage` |
| `run pause <run>` | Pause a run | — |
| `run profile generate <workflow> [options]` | Write a run-profile template for a workflow | `--out` |
| `run profile list` | Run profiles visible from here | — |
| `run profile validate <workflow> <profile>` | Check a run profile against a workflow definition | — |
| `run resume <run>` | Resume a run | — |
| `run retry <run> [options]` | Retry a run | `--watch` `--verbosity` |
| `run show <run> [options]` | Show a run and its stages | `--stages` |
| `run stage cancel <run> <stage>` | Cancel one stage | — |
| `run stage list <run>` | Stage runs for a run | — |
| `run stage pause <run> <stage>` | Pause one stage | — |
| `run stage resume <run> <stage>` | Resume one stage | — |
| `run stage retry <run> <stage>` | Retry one stage | — |
| `run start <workflow> [options]` | Create and start a run<br>⚠️ `--name` — The server has no route that names a run, so this value is accepted and discarded. | `--name` ⚠️ `--var` `--profile` `--project` `--permission-mode` `--watch` `--verbosity` `--no-start` |
| `run watch <run> [options]` | Stream a run until it reaches a terminal state | `--verbosity` |
| `run workspace <run>` | Workspace a run executed in | — |

### `automation` (alias: `auto`)

Scheduled, webhook and manual triggers that fan out into runs

| Command | What | Flags |
|---|---|---|
| `automation create [options]` | Create an automation | `--name` `--workflow` `--trigger` `--schedule` `--input-mode` `--loop-variable` `--loop-items` `--batch-format` `--batch-data` `--batch-data-file` `--var` `--max-concurrency` `--on-error` `--data-source` `--project` `--enabled` |
| `automation datasource test <config>` | Dry-run a data-source config and print what it would yield | — |
| `automation delete <automation>` | Delete an automation | — |
| `automation disable <automation>` | Disable an automation | — |
| `automation enable <automation>` | Enable an automation | — |
| `automation execution cancel <automation> <execution>` | Cancel an execution and its runs | — |
| `automation execution list <automation>` | Executions of an automation | — |
| `automation execution show <automation> <execution>` | One execution and its nested runs | — |
| `automation list [options]` | List automations | `--project` |
| `automation rotate-webhook-token <automation>` | Issue a new webhook token + signing secret, invalidating the old ones | — |
| `automation show <automation>` | Show an automation with recent executions | — |
| `automation trigger <automation> [options]` | Fire an automation now | `--var` `--payload` |
| `automation update <automation> [options]` | Patch an automation | `--name` `--schedule` `--max-concurrency` `--on-error` `--var` |

### `project` (alias: `proj`)

Projects, linked codebases, configs, MCP servers and worktrees

| Command | What | Flags |
|---|---|---|
| `project codebase branches <project> <codebase>` | Branches in a codebase | — |
| `project codebase browse <project> <codebase> [path]` | List files in a codebase | — |
| `project codebase fetch <project> <codebase>` | Fetch the latest commits for a codebase | — |
| `project codebase file <project> <codebase> <path>` | Print a file from a codebase | — |
| `project codebase link <project> [options]` | Link a repository or directory to a project | `--alias` `--type` `--url` `--local-path` `--default-branch` |
| `project codebase list <project>` | Codebases linked to a project | — |
| `project codebase unlink <project> <codebase>` | Unlink a codebase | — |
| `project config delete <project> <config>` | Delete a project config | — |
| `project config list <project> [options]` | Project-scope agents, prompts, skills and other configs | `--type` |
| `project config upload <project> <type> <file>` | Upload a project config file | — |
| `project create <name> [options]` | Create a project | `--description` |
| `project delete <project> [options]` | Delete a project | `--force` |
| `project list [options]` | List projects | `--status` |
| `project mcp add <project> [options]` | Add an MCP server to a project | `--name` `--type` `--command` `--url` `--config` |
| `project mcp list <project>` | MCP servers configured for a project | — |
| `project mcp remove <project> <server>` | Remove an MCP server from a project | — |
| `project show <project>` | Show a project with its codebases | — |
| `project update <project> [options]` | Patch a project | `--name` `--description` |
| `project worktree cleanup <project>` | Garbage-collect orphaned worktrees | — |
| `project worktree list <project>` | Worktrees carved from a project | — |
| `project worktree remove <project> <worktree>` | Remove one worktree | — |

### `workspace` (alias: `ws`)

Per-run filesystems, their files, changes and checkpoints

| Command | What | Flags |
|---|---|---|
| `workspace archive <workspace>` | Archive a workspace | — |
| `workspace cat <workspace> <path> [options]` | Print a file from a workspace | `--alias` `--out` |
| `workspace changes <workspace> [path] [options]` | Files a workspace changed, or the unified diff of one | `--alias` `--base` `--head` |
| `workspace checkpoints <workspace>` | Checkpoints taken in a workspace | — |
| `workspace cleanup [options]` | Garbage-collect old or oversized workspaces | `--retention-hours` `--max-disk-mb` |
| `workspace commit <workspace> [options]` | Commit the workspace worktrees | `--message` |
| `workspace delete <workspace>` | Delete a workspace and everything in it | — |
| `workspace list [options]` | List execution workspaces | `--status` `--project` `--limit` |
| `workspace pr <workspace> [options]` | Open a pull request from a workspace, or list existing ones | `--title` `--body` `--base` `--draft` |
| `workspace put <workspace> <path> [options]` | Write a local file into a workspace | `--file` `--source` `--alias` `--no-create-dirs` |
| `workspace restore <workspace> <checkpoint> [options]` | Restore a workspace to a checkpoint | `--path` |
| `workspace show <workspace>` | Show a workspace with its worktrees | — |
| `workspace tree <workspace> [path] [options]` | List files in a workspace | `--alias` |
| `workspace worktree list <workspace>` | Worktrees inside a workspace | — |

### `terminal` (alias: `term`)

PTYs attached to a workspace

| Command | What | Flags |
|---|---|---|
| `terminal attach <workspace> [terminal]` | Attach this terminal to a workspace PTY (Ctrl+] detaches) | — |
| `terminal create <workspace> [options]` | Start a PTY in a workspace | `--cols` `--rows` |
| `terminal kill <workspace> <terminal>` | Kill a terminal | — |
| `terminal list <workspace>` | Terminals attached to a workspace | — |
| `terminal scrollback <workspace> <terminal>` | Print a terminal buffer | — |
| `terminal signal <workspace> <terminal> [signal]` | Send a signal to the process group | — |

### `script` (alias: `sc`)

Programmatic workflow scripts (.workflow.mjs)

| Command | What | Flags |
|---|---|---|
| `script list` | List programmatic workflow scripts | — |
| `script materialize <script> [options]` | Turn a script into a concrete workflow definition | `--profile` |
| `script profiles <script>` | Profiles a script exposes | — |
| `script reload [script]` | Re-read scripts from disk without restarting the server | — |
| `script run <script> [options]` | Materialize and start a script | `--profile` `--watch` `--verbosity` |
| `script show <script>` | Show a script | — |
| `script validate <file>` | Validate a script file without registering it | — |

### `template`

System workflow templates

| Command | What | Flags |
|---|---|---|
| `template list` | System workflow templates | — |
| `template show <template>` | Show one template | — |

### `orchestrator` (alias: `orch`)

System workflows and orchestrated runs

| Command | What | Flags |
|---|---|---|
| `orchestrator cancel <run>` | Cancel an orchestrated run and everything under it | — |
| `orchestrator templates` | System workflows available to the orchestrator | — |

### `extension` (alias: `ext`)

Hot-loadable extensions

| Command | What | Flags |
|---|---|---|
| `extension disable <extension>` | Disable an extension | — |
| `extension enable <extension>` | Enable an extension | — |
| `extension list` | Installed extensions | — |
| `extension reload [extension]` | Reload extensions from disk | — |
| `extension show <extension>` | Show one extension and what it contributes | — |
| `extension uninstall <extension>` | Uninstall an extension | — |

### `widget`

Agent-rendered widget surfaces

| Command | What | Flags |
|---|---|---|
| `widget close <widget>` | Tear down a widget | — |
| `widget list [options]` | Open widget surfaces for a chat, run or session | `--chat` `--run` `--session` |
| `widget read <widget> [options]` | Read a widget as text, with what a terminal cannot show | `--chat` `--run` `--session` |
| `widget set-state <widget> <state>` | Write a widget's state — the degraded way to drive one | — |

### `review`

Review threads on workspace files

| Command | What | Flags |
|---|---|---|
| `review create <workspace> <path> <body> [options]` | Start a review thread on a line range | `--start-line` `--end-line` `--side` `--anchor-text` `--alias` `--scope` `--scope-id` `--base-checkpoint` `--head-checkpoint` `--intent` |
| `review list <workspace> [options]` | Review threads in a workspace | `--path` `--status` |
| `review reply <workspace> <thread> <body>` | Reply on a thread | — |
| `review resolve <workspace> <thread>` | Mark a thread resolved | — |
| `review submit <workspace> [options]` | Hand a batch of threads to the agent | `--thread` `--note` `--preview` |
| `review unresolve <workspace> <thread>` | Mark a thread open | — |

### `browser`

Workspace-scoped Chromium

| Command | What | Flags |
|---|---|---|
| `browser back <workspace>` | Go back | — |
| `browser dom <workspace> [options]` | Capture a full DOM snapshot as a workspace artifact | `--out` |
| `browser forward <workspace>` | Go forward | — |
| `browser navigate <workspace> <url>` | Navigate to a URL | — |
| `browser read <workspace> [options]` | The page's accessibility tree as text | `--out` |
| `browser reload <workspace>` | Reload the page | — |
| `browser screenshot <workspace> [options]` | Capture the page as a PNG | `--out` |
| `browser snapshots <workspace>` | Captures taken in this workspace | — |
| `browser start <workspace> [options]` | Start a Chromium session in a workspace | `--url` `--width` `--height` |
| `browser status <workspace>` | Current browser descriptor | — |
| `browser stop <workspace>` | Stop the browser session | — |

### `computer`

Computer Use: desktop windows and audit

| Command | What | Flags |
|---|---|---|
| `computer activity <workspace>` | Audit trail of computer-use actions | — |
| `computer answer <workspace> <request> <decision> [options]` | Answer a pending consent prompt | `--app` |
| `computer frames <workspace>` | Captured window frames | — |
| `computer grants <workspace>` | Per-application grants | — |
| `computer pending <workspace>` | Consent prompts waiting for an answer | — |
| `computer revoke <workspace> <app>` | Revoke an application grant | — |
| `computer runtime <workspace> <action>` | Start, restart or stop the Computer Use driver | — |
| `computer status <workspace>` | Computer Use runtime and consent state | — |

### `hook`

Lifecycle hooks

| Command | What | Flags |
|---|---|---|
| `hook list <session>` | Hooks registered on a session — global definitions plus per-workflow overrides | — |
| `hook phases` | Hook phases the server can invoke | — |
| `hook test <session> <phase> [options]` | Dry-run one hook against a session | `--type` `--config` `--priority` `--timeout` `--retries` `--failure-policy` |

### `webhook`

Incoming and outgoing webhooks

| Command | What | Flags |
|---|---|---|
| `webhook create <url> [options]` | Register an outgoing webhook | `--event` `--secret` |
| `webhook delete <webhook>` | Remove a webhook registration | — |
| `webhook list` | Outgoing webhook registrations | — |

### `harness`

AI provider selection

| Command | What | Flags |
|---|---|---|
| `harness show [options]` | Active provider and its readiness | `--refresh` |
| `harness switch <provider>` | Change the default provider | — |

### `source-control` (alias: `scm`)

Git provider and pull-request configuration

| Command | What | Flags |
|---|---|---|
| `source-control config [options]` | Show or set source-control configuration | `--provider` `--default-base` `--draft` |
| `source-control status` | Provider connection and repository status | — |

### `security`

Security posture, devices and audit

| Command | What | Flags |
|---|---|---|
| `security audit [options]` | Authentication and device audit log | `--limit` |
| `security network-access [options]` | Show or set whether the server listens beyond loopback | `--mode` |
| `security posture` | Auth mode, secret backend and network exposure | — |

### `system`

Server health, models, artifacts and diagnostics

| Command | What | Flags |
|---|---|---|
| `system artifact <id>` | Print one system artifact | — |
| `system artifacts [options]` | System-scope skills, prompts and agents | `--type` |
| `system config` | Non-sensitive server configuration | — |
| `system doctor` | Diagnose connection, credential and terminal-capability problems | — |
| `system health` | Server uptime, database path and active counts | — |
| `system mcp-servers` | System-scope MCP servers | — |
| `system models [options]` | Models available from the active provider | `--provider` `--refresh` |
| `system version` | CLI and server versions, and whether they are compatible | — |

### `config`

Configuration, profiles and key bindings

| Command | What | Flags |
|---|---|---|
| `config get <key> [options]` | Read one setting | `--reveal` |
| `config keymap list [options]` | Every key binding and its id | `--context` |
| `config keymap set <action> <keys>` | Remap a key binding | — |
| `config path` | Print the user config file path | — |
| `config profile create <name>` | Create a profile from the current settings | — |
| `config profile delete <name>` | Delete a profile | — |
| `config profile list` | Named config profiles | — |
| `config profile use <name>` | Make a profile active | — |
| `config reset` | Reset the user config to defaults | — |
| `config set <key> <value>` | Write one setting to the user config | — |
| `config show [options]` | Resolved configuration after all five layers | `--sources` `--reveal` |
| `config unset <key>` | Restore one setting to its default | — |

<!-- @generated-commands:end -->

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

Launches the workbench: a tabbed, splittable terminal UI over the same command
registry the binary uses. Panes hold chats, workflow runs, workflow authoring,
workspace diffs and files, terminals, browsers, computer-use consent, and
administration views.

The key table below is GENERATED from the keymap the app actually resolves
keystrokes through (`packages/cli-core/src/keymap/Keymap.ts`), so it cannot
drift from the code and a remap under `keymap` in your config is reflected in
the app, the help overlay and here alike.

<!-- @generated-keymap:start — regenerate with `pnpm cli:docs`; do not edit by hand -->

#### Anywhere

Active in every pane.

| Key | Action |
|---|---|
| `ctrl+k` / `ctrl+p` | Command palette |
| `?` | Toggle help |
| `ctrl+c` | Quit |
| `ctrl+r` | Refresh current view |
| `escape` | Back / close overlay |
| `tab` | Focus next region |
| `shift+tab` | Focus previous region |
| `ctrl+g` | Toggle right pane |
| `ctrl+t` | Cycle theme |
| `g d` | Dashboard |
| `g c` | Chats |
| `g w` | Workflows |
| `g r` | Runs |
| `g a` | Automations |
| `g p` | Projects |
| `g o` | Workspaces |
| `g e` | Agents |
| `g s` | Scripts |
| `g x` | Extensions |
| `g ,` | Settings |
| `g m` | Administration views… |
| `alt+l` | Leader prefix (panes & tabs) |

#### Leader (after the prefix)

Press the leader prefix first; the next key is resolved here. tmux grammar, so muscle memory transfers.

| Key | Action |
|---|---|
| `c` | New tab |
| `n` | Next tab |
| `p` | Previous tab |
| `%` | Split vertically |
| `"` | Split horizontally |
| `left` / `h` | Focus pane left |
| `right` / `l` | Focus pane right |
| `up` / `k` | Focus pane up |
| `down` / `j` | Focus pane down |
| `z` | Zoom / unzoom pane |
| `x` | Close pane |
| `,` | Rename tab |
| `d` | Detach stream (run keeps going) |
| `[` | Scrollback mode |
| `?` | Leader key help |
| `}` | Grow focused pane |
| `{` | Shrink focused pane |
| `<` | Move tab left |
| `>` | Move tab right |
| `t` | Jump to tab… |
| ``` | Toggle last tab |
| `b` | Blocked work / notifications… |
| `i` | Client diagnostics (stream health) |

#### Lists

Any pane with rows, and the fallback for several others.

| Key | Action |
|---|---|
| `/` | Search in view |
| `down` / `j` | Move down |
| `up` / `k` | Move up |
| `pagedown` / `ctrl+f` | Page down |
| `pageup` | Page up |
| `home` / `g g` | First item |
| `end` / `G` | Last item |
| `return` | Open |
| `n` | New |
| `e` | Edit |
| `d` | Delete |
| `space` | Toggle selection |
| `f` | Filter |
| `s` | Sort |
| `y` | Copy id |

#### Chat

A chat pane, outside the prompt.

| Key | Action |
|---|---|
| `ctrl+x` | Stop generating |
| `ctrl+l` | Clear view |
| `alt+r` | Toggle reasoning blocks |
| `alt+g` | Answer pending question / plan review |
| `pageup` | Scroll transcript back |
| `pagedown` | Scroll transcript forward |
| `alt+s` | Search transcript |

#### The prompt

Executed by the composer itself, so an edit reads the caret the previous keystroke wrote.

| Key | Action |
|---|---|
| `return` | Send |
| `shift+return` | New line |
| `alt+e` | Compose in $EDITOR |
| `ctrl+o` | Change model |
| `alt+a` | Change agent |
| `ctrl+p` | Cycle permission mode |
| `up` | Previous prompt |
| `down` | Next prompt |
| `@` | Mention agent / file / codebase |
| `/` | Slash command |
| `ctrl+a` | Start of line |
| `ctrl+e` | End of line |
| `ctrl+b` | Back one character |
| `ctrl+f` | Forward one character |
| `alt+b` | Back one word |
| `alt+f` | Forward one word |
| `ctrl+k` | Kill to end of line |
| `ctrl+u` | Kill to start of line |
| `ctrl+w` | Kill word before caret |
| `alt+d` | Kill word after caret |
| `ctrl+y` | Paste last kill |
| `ctrl+d` | Delete character ahead |
| `ctrl+j` | New line (works everywhere) |
| `ctrl+_` | Undo edit |

#### Runs

Watching a workflow run.

| Key | Action |
|---|---|
| `p` | Pause run |
| `r` | Resume run |
| `c` | Cancel run |
| `R` | Retry run |
| `a` | Approve pending gate |
| `x` | Reject pending gate |
| `s` | Stage detail |
| `v` | Cycle log verbosity |

#### Workflow authoring

Editing a workflow definition.

| Key | Action |
|---|---|
| `ctrl+n` / `]` / `j` | Next stage |
| `ctrl+p` / `[` / `k` | Previous stage |
| `n` | Add a stage |
| `e` | Edit the selected stage |
| `d` | Delete the selected stage |
| `E` | Connect this stage to another |
| `D` | Delete an edge on this stage |
| `v` | Edit the stage's variables |
| `h` | Manage the stage's hooks |
| `V` | Validate — jump from a finding to its stage |
| `r` | Start a run of this workflow |
| `R` | Reload the definition |

#### Changes and review

A workspace diff, its checkpoints and its review threads.

| Key | Action |
|---|---|
| `ctrl+n` / `]` | Next file |
| `ctrl+p` / `[` | Previous file |
| `n` | Next hunk |
| `N` | Previous hunk |
| `down` / `j` | Next line |
| `up` / `k` | Previous line |
| `w` | Unified / side-by-side |
| `c` | Comment on line |
| `o` | Resolve thread |
| `t` | Terminal for this workspace |
| `b` | Browser for this workspace |
| `p` | Checkpoints — restore one |
| `C` | Commit the worktrees |
| `P` | Pull requests — list or open one |
| `T` | Review threads — read and reply |
| `S` | Hand the open threads to the agent |
| `R` | Re-fetch the changed-file list |

#### Workspace files

The workspace file browser.

| Key | Action |
|---|---|
| `e` | Edit in $EDITOR |
| `d` | Download to a local path |
| `u` | Upload a local file here |
| `t` | Tree / flat list |
| `left` / `h` | Collapse directory |
| `right` / `l` | Expand directory |
| `R` | Re-read the workspace |

#### Terminal

An embedded terminal pane.

| Key | Action |
|---|---|
| `return` | Attach (raw takeover, Ctrl+] detaches) |
| `n` | New terminal |
| `d` | Kill terminal |
| `l` | List / switch terminal |
| `pageup` | Scroll back |
| `pagedown` | Scroll forward |
| `end` | Jump to the live tail |
| `alt+s` | Search scrollback |
| `y` | Copy the visible screen |

#### Browser

An integrated-browser pane.

| Key | Action |
|---|---|
| `o` | Open URL |
| `H` | Back |
| `L` | Forward |
| `r` | Reload |
| `s` | Screenshot |
| `i` | Session info |
| `k` | Stop browser session |
| `a` | Read the page (accessibility tree) |
| `c` | Computer-use consent, grants and activity |

#### Computer use

Consent, grants and the audit trail.

| Key | Action |
|---|---|
| `r` | Refresh runtime, consent and activity |
| `a` | Answer the selected consent prompt |
| `x` | Revoke the selected standing grant |
| `R` | Start / restart / stop the driver |
| `s` | Next section (prompts / grants / activity) |

#### Automations

An automation and its executions.

| Key | Action |
|---|---|
| `ctrl+n` / `]` | Next execution |
| `ctrl+p` / `[` | Previous execution |
| `return` | Open the selected execution's run |
| `c` | Cancel the selected execution |

#### Administration views

A registry-command-backed admin pane.

| Key | Action |
|---|---|
| `return` | Inspect the selected row |
| `R` | Re-run the view's command |
| `v` | Switch to another administration view |

<!-- @generated-keymap:end -->

Lists refresh from the event stream; the poll timer is a slow backstop for
entities with no events and repair after a missed reconnect.

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

## 9. Connection model (there is no in-process mode)

Every command talks to a running GeneratorAI server over HTTP + WebSocket through `createCliClient()` in `packages/cli-core`. There is no `--mode direct`, `--local`, or in-process fallback, and no `apps/cli/src/platform/createClient.ts` — earlier revisions of this page described plumbing that was never committed. Pick the server with `--server <url>` or a saved connection (`connect add` / `--connection`); if it is unreachable the command fails with a connection error rather than silently doing anything locally.

Two operations are deliberately shell-only and are hidden from the TUI palette: anything that collects a secret, and `terminal attach` (raw PTY takeover). Inside the TUI the palette shows them disabled with the hint *"Run `generatorai <cmd>` in your shell — needs a secret/terminal"*.

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
