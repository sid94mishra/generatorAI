# Feature: Workflows from Agents

An agent can find, run, follow, answer and cancel saved workflows, and it can author new ones.
"Agent" means a GeneratorAI chat, an orchestrator chat, a workflow stage, Claude Code, Codex or
any MCP client. They all use **one tool set with one description text and one implementation**
(`WorkflowToolHost`, `packages/core/src/tools/workflows/`), bound:

- into chats, orchestrator chats and stages by the session composer (`PlatformToolBinder.workflows`);
- over MCP through the server's tool route (`/api/workflow-tools`), which runs the same handlers
  for an external caller and which the `generatorai-mcp` server adapts.

There are **no slash commands and no MCP prompts** (an MCP prompt shows up as a slash command in
Claude Code). Agents get tools and resources only. Agent-authored workflows are **drafts**: a
person reviews and publishes them (PD-14).

The design is [PHASE-06](../../docs/workflow-overhaul/PHASE-06-agent-integration-skill.md) and
G4 §2–3 (`docs/workflow-audit/evidence/G4_invocation_tools_skill.md`); deviations are in
[DEVIATIONS.md](../../docs/workflow-overhaul/DEVIATIONS.md) (P06 rows). How a run starts is in
[feature-workflow-runs.md](./feature-workflow-runs.md); the document format in
[feature-workflows.md](./feature-workflows.md) and
[feature-workflow-control-flow.md](./feature-workflow-control-flow.md).

---

## 1. The tools

Two tool groups of the agent tool policy (`AgentToolPolicy`, the same place as `browser`,
`widgets`, `orchestration`):

| Group | Tools | Default |
|---|---|---|
| `workflows` | `list_workflows`, `describe_workflow`, `run_workflow`, `check_workflow_run`, `respond_workflow_approval`, `cancel_workflow_run` | **on** for orchestrator chats (written onto the chat at creation, and the default of an orchestrator-role agent); **opt-in** for plain chats (the chat's tool toggles, or its agent); **off** for orchestrator workers; **off** for stages unless the stage's agent grants it (PD-23) |
| `workflowAuthoring` | `get_workflow_authoring_guide`, `validate_workflow`, `plan_workflow`, `create_workflow_draft` | off everywhere; granted per agent (like `extensionAuthoring`) |

The workflow tools are appended **after** every other tool of a session, so a session without
them keeps its tool prefix byte-identical (R-10); a chat that turns them on pays one prompt-cache
miss. When `workflowAuthoring` is on, a ~600-character `WORKFLOW_AUTHORING_HINT` is appended to
the system message. Inside GeneratorAI a skill file is not what the model reads: the tool
descriptions carry the rules, and `get_workflow_authoring_guide(topic)` serves the generated
guide (§5).

| Tool | Arguments | Answer |
|---|---|---|
| `list_workflows` | `query?`, `projectId?`, `tag?`, `limit?` (≤ 50) | published workflows (drafts too, flagged, when authoring is on): id, name, variables, stage count, codebase requirement, post-processing |
| `describe_workflow` | `workflowId` | variables, stages (key, kind, agent, model, approval, guard), edges, codebases, post-processing, outputs, **risk flags** (`writes_files`, `commits`, `pushes`, `opens_pr`, `bypass_permissions`, `runs_repo_code`, `starts_other_workflows`, `worktree_per_item`), warnings |
| `run_workflow` | `workflowId`, `variables?`, `codebases?`, `stageOverrides?`, `model?`, `permissionMode?`, `workspace?` (`isolated` \| `from_chat_branch`), `wait?` (`none` \| `until_done` \| `until_approval_or_done`), `waitSeconds?` (≤ 600), `approvalDelegate?` (`human` \| `invoker`), `reason`, `projectId?` | `{runId, status, link, replayed, plan, digest?, hint?}` |
| `check_workflow_run` | `runId`, `wait?`, `waitSeconds?` | the run digest: status, stages with summaries (≤ 600 chars), pending decisions (`answerableByYou`), post-processing results, link |
| `respond_workflow_approval` | `runId`, `instanceId`, `outcome`, `feedback?`, `reason` | `{ok, outcome}`, or `{ok: false, error: 'needs a human', link}` |
| `cancel_workflow_run` | `runId`, `reason` | `{ok, status}` |
| `get_workflow_authoring_guide` | `topic?` (`overview`, `schema`, `stages`, `edges`, `expressions`, `control-flow`, `agents`, `lifecycle`, `pitfalls`, `examples`) | the guide section (markdown) |
| `validate_workflow` | `graph`, `schemaHash?` | `{valid, issues[], schema: {version, hash}, schemaDrift?}` |
| `plan_workflow` | `graph` or `workflowId`, `variables?`, `stageOverrides?` | `{plan, guards, unresolved, warnings}`; nothing is written |
| `create_workflow_draft` | `graph`, `projectId?`, `replacesWorkflowId?` | `{workflowId, status: 'draft', name, reviewLink, warnings}` |

A handler never throws at the model: a refusal is `{ok: false, code, error}` (the invocation
codes, plus `FORBIDDEN`, `FORBIDDEN_SCOPE`, `CONCURRENCY_LIMIT`, `CHAT_DIRTY`, `DRAFT_NOT_RUNNABLE`).

## 2. Limits the agent cannot raise

The limits live **in the tool handler**, not in an approval prompt (on Claude or Codex under a
bypass mode the prompt is never consulted, C-5):

- **Permission ceiling.** A run never gets more than its caller: the chat's turn mode (else the
  chat's mode), the stage's run mode. An explicit `permissionMode` above it is
  `PERMISSION_ESCALATION`; the workflow's own mode is capped to it.
- **Depth and recursion.** Runs nest at most 3 deep; a workflow cannot start itself through its
  ancestors (`DEPTH_LIMIT`, `RECURSION`), through the invocation lineage.
- **Child runs.** A run tree starts at most `maxChildRuns` nested runs (the root's budget, else
  10, `GENERATORAI_WORKFLOW_MAX_CHILD_RUNS`); a chat has at most 3 runs going at once
  (`GENERATORAI_WORKFLOW_CHAT_CONCURRENCY`).
- **Time.** A child never outlives its caller: an orchestrator's episode (30 min), a stage's
  attempt/total timeout, the run's wall clock cap `waitSeconds` and become the child run's
  `maxDurationMs`.
- **Idempotency.** The provider's tool-call id (Claude's tool_use id, Copilot's `toolCallId`,
  Codex's `callId`) keys the invocation (`chat:<chatId>:<toolCallId>`,
  `stage:<stageRunId>:<toolCallId>`; `idempotencyKey` over MCP): a replayed call answers the same
  run (`replayed: true`).
- **Scopes.** In-process tools act for the chat's **creating principal** (`chats.created_by_principal`,
  v60): running needs `exec:agent`, a draft `write:workflows`. A chat created from a default paired
  phone can run workflows but not author them. A command-bearing field (scripts, stdio MCP
  servers, `custom_script` rules) in a draft needs `admin:settings`; a stage agent never writes one.
- **Drafts.** `run_workflow` refuses a draft (`DRAFT_NOT_RUNNABLE`); only a person's test run
  from the review UI runs one.
- **Workers.** An orchestrator's workers get no workflow tools, whatever their agent says.

## 3. Approvals

A run's completion reviews go to a **person** unless the invocation set
`approvalDelegate: 'invoker'`. Then the agent that started it may answer them with
`respond_workflow_approval` (`check_workflow_run` marks them `answerableByYou`). Every other
decision — a tool-permission prompt, a question, a plan review, a loop decision, an approval or
event wait — needs a person: the tool answers `needs a human` with the run link, and the chat shows
an approval card. Machine-sourced prompts are never consent. Answers go through
`WorkflowApprovalService`, the same service as the run page and the commands route.

## 4. Runs seen from the chat

A run a chat starts is linked to it (`chat_workflow_runs`, v60) and mirrored onto the chat's
stream by `ChatWorkflowRunBridge`:

| Event | When |
|---|---|
| `chat.workflow_run.linked` | the run started (the run card appears) |
| `chat.workflow_run.progress` | status and stage n of m (≤ 1 per 500 ms per run; stage transitions unthrottled) |
| `chat.workflow_run.awaiting_approval` | a decision is parked (`answerableByAgent`) |
| `chat.workflow_run.finalized` | after post-processing (summary, PR link) |

When a run finalizes or parks on a decision and the chat is idle, the chat gets **one**
`[system]` message (never while a turn streams, the orchestrator's wave-nudge guard). The cards
survive a reload: `GET /api/chats/:id/workflow-runs`. The web and mobile chats draw a run card, an
approval card (the run page's approve command) and a draft card (open in the builder, publish).

**Workspace.** `workspace: 'isolated'` (default) gives the run its own worktrees from the
codebases' base refs; the chat's mounts are never shared with a running workflow.
`'from_chat_branch'` cuts the run's worktrees from the chat's branches, and is refused with
`CHAT_DIRTY` while the chat has uncommitted changes; the run records the chat workspace
(`parentWorkspaceId`).

**Orchestrators.** An orchestrator chat has the `workflows` group by default; its episode
deadline caps waits and child runs. Its workers never fan out further, and inherit its built-in
tool denials through the resolver (`extraDeny` → `excludedBuiltinTools`), so the clamp holds on
Copilot too (C-15).

**Stages.** The declarative way for a stage to run another workflow is the `subworkflow` stage
(feature-workflow-control-flow.md). Dynamically, a stage whose agent grants `workflows` gets the
tool set (trigger `stage`, the run's lineage, its deadline); the child records its
`parent_stage_run_id`, and its decisions are mirrored into the parent run's pending list. A
provider that takes no host tools (opencode, ACP) gets no workflow tools, and the session reports
`workflow_tools_unsupported`; on Codex a resumed thread keeps the tools it started with.

## 5. Authoring: validate → plan → draft → a person publishes

`WorkflowAuthoringService` (`packages/core/src/services/WorkflowAuthoringService.ts`) is the one
implementation behind the tools, the MCP tools, the CLI and the routes:

1. **Inspect** existing workflows and agents (`list_workflows`, `describe_workflow`).
2. **Draft** the WorkflowGraph JSON against the schema (the guide's `schema` topic).
3. **Validate** until there are zero errors: the spec package's `validateWorkflow` (the same rules
   the offline `validate.mjs` bundles) plus the server's checks — the agent exists and is enabled,
   the model is in the catalog, provider capability conflicts (warnings), command fields.
4. **Plan** with realistic variables and read it: stages by layer, skips, guards decided now,
   unresolved variables, codebases, post-processing, permission mode, risks.
5. **Summarise** for the person: what each stage does and may touch, the mode, commits/PRs, budget.
6. **Submit a draft**: `create_workflow_draft` tags it `agent-authored` and records its author
   (`workflow_definitions.authored_by`, v60: the chat, orchestrator, stage or external agent;
   `replacesWorkflowId` when it proposes a change).
7. **A person publishes.** The builder shows an agent-draft banner: who authored it, the risk
   flags, a diff against the workflow it replaces, Publish and Discard. Service accounts, internal
   services and MCP devices cannot publish (403) unless the operator sets
   `GENERATORAI_ALLOW_AGENT_PUBLISH=true` (`workflows.allowAgentPublish`, default off). An agent
   principal's `POST /workflow-definitions` or `/import` also becomes an agent-authored draft.

`GET /api/workflow-definitions/schema` answers `{version, hash, jsonSchema}`: an agent passes its
skill's `schemaHash` to `validate_workflow` and learns when its skill is out of date.

### The `generatorai-workflow-author` skill

One generated bundle (`pnpm generate:workflow-skill`, checked in CI) from the spec package, the
shipped templates and the providers' capability levels: `SKILL.md` (the mandatory process, the
hard rules, the channels), `reference/*.md`, `schema/*.json`, `examples/*.json` (each validated
and round-tripped), `scripts/validate.mjs` (the offline validator, a bundle of the spec package)
and `evals/`. It is written to `skills/generatorai-workflow-author/` and to
`templates/system/skills/generatorai-workflow-author/`, which the server reads at run time, so the
three channels serve the **same files**:

| Channel | How the agent gets it | Validate / plan / submit |
|---|---|---|
| GeneratorAI chat, orchestrator, stage | the tool descriptions, `WORKFLOW_AUTHORING_HINT`, `get_workflow_authoring_guide` | `validate_workflow`, `plan_workflow`, `create_workflow_draft` |
| Claude Code | `generatorai skill install --target claude [--project]` (`.claude/skills/` or `~/.claude/skills/`), plus the MCP server | `generatorai_validate_workflow` / `generatorai workflow lint` / `node scripts/validate.mjs`; `generatorai_plan_workflow` / `generatorai workflow plan`; `generatorai_create_workflow_draft` / `generatorai workflow import` |
| Codex | `generatorai skill install --target codex` (the skill root the installed Codex reports), plus `[mcp_servers.generatorai]` | the same |
| Any MCP client | resources `generatorai://workflow-author/<path>` | the `generatorai_*` tools |

## 6. MCP setup (Claude Code, Codex, any client)

The MCP server drives the **running** server (remote mode, PD-22):

1. Pair it as a device of platform `mcp`: `generatorai device invite --platform mcp` (add
   `--scopes …,write:workflows` for authoring; the default grant can read and run), then
   `generatorai-mcp pair <code>`.
2. Register it with the client: Claude Code `claude mcp add generatorai -- generatorai-mcp serve`
   (or `.mcp.json`); Codex `[mcp_servers.generatorai]` with `command = "generatorai-mcp"`,
   `args = ["serve"]` in `config.toml`. `generatorai skill install` prints the snippet.
3. Tools: every workflow tool as `generatorai_<name>` (`idempotencyKey` on the ones that start or
   create something), plus `generatorai_list_chats` and `generatorai_send_prompt`. Resources: the
   skill bundle. No prompts.

## 7. HTTP and CLI

| Route | Purpose |
|---|---|
| `POST /api/workflow-definitions/validate` | validation with the server's checks (read:workflows) |
| `POST /api/workflow-definitions/plan` | `{graph \| workflowId, variables?, stageOverrides?}` → the plan (read:workflows) |
| `GET /api/workflow-definitions/schema` | `{version, hash, jsonSchema}` |
| `GET /api/workflow-definitions/authoring/skill[/file?path=]` | the skill bundle |
| `POST /api/workflow-definitions/:id/publish` | a person (or an agent when allowed) |
| `GET /api/workflow-tools`, `POST /api/workflow-tools/:name` | the tool set for an external agent (`{arguments, idempotencyKey?, clientName?}`) |
| `GET /api/chats/:id/workflow-runs` | a chat's run cards |

CLI: `generatorai workflow lint <file>` (offline), `workflow plan <file|workflow> --var k=v`,
`workflow import <file> --draft`, `workflow publish <workflow>`, `skill install --target claude|codex [--project]`,
`skill print [path]`.
