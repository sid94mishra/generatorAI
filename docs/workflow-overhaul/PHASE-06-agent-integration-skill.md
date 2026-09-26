# PHASE 06: Agent integration and the workflow-authoring skill

**Goal:**
- Chats, orchestrator chats and workflow stages can **discover, run, monitor, approve and cancel** workflows through tools.
- Any agent can **author** a workflow through a validate → plan → draft → human-publish pipeline: GeneratorAI chat or orchestrator, a stage, Claude Code, Codex, or any MCP client.
- A **generated skill bundle** (`generatorai-workflow-author`) teaches that pipeline, delivered through three channels that share one source: in-app tools and guide, skill directories, and MCP resources.
- The MCP server runs against the user's real running server (remote mode).

**Estimate:** 2–3 weeks. **Depends on:** P04 (invocation), P05 (sub-workflow stage, presets).
**Branch:** `wf/phase-06-agents-skill`.
**Closes:** R7, R8, W-58, W-64 (the authoring side), C-18 (chat → workflow), C-15 (the worker clamp on Copilot). PD-14 applied.

## Read first
- `G4_invocation_tools_skill.md` §2 (tools, gates, lineage, progress bridge, workspace semantics, stage invocation) and §3 (skill design, channels, endpoints, generation, gaps)
- `G1_goals_dynamic_workflows_research.md` §3 (Agent Skills spec and best practices: plan → validate → execute, verbose validators, bundled scripts, low freedom for fragile artifacts) and §5 (guardrails of agent-authored workflows)
- `C_orchestration_integrations.md` §a (OrchestratorService tools and termination), C-15

## Design decisions
1. **One tool set, many bindings.** `buildWorkflowToolSet(deps)` in `packages/core/src/tools/workflows/` is bound through the P02 `PlatformToolBinder` for chats, orchestrator chats and stages. The **same** definitions are exposed over MCP through an adapter. *Why:* one implementation and one description text; no drift between the channels (G4 §2.2, §2.5).
2. **Hard limits live inside the tool handler, not in the approval prompt.** On Claude or Codex under bypass, the approval prompt is never consulted (C-5). The handler enforces:
   - the permission ceiling;
   - depth ≤ 3 and recursion checks through the invocation lineage;
   - `maxChildRuns` per root (default 10) and concurrent runs per chat (default 3);
   - budget and deadline caps derived from the caller;
   - idempotency from the tool-call id.
3. **Policy groups.** `workflows` (run, check, cancel, respond): on for orchestrators; opt-in for plain chats (PD-23); off for orchestrator **workers**; off for stages unless their agent grants it. `workflowAuthoring` (guide, validate, plan, create draft) defaults off everywhere and is granted per agent. *Why:* the same model as `extensionAuthoring` (G4 §2.2).
4. **Agents can never answer tool-permission HITL.** An agent may answer a completion review only on runs it started **and** whose invocation set `approvalDelegate: 'invoker'` (G4 §2.3). Machine-sourced prompts are never consent (Claude Code guardrail, G1 §5).
5. **The in-app skill travels through three carriers, chosen by provider capability** (corrected per RV-8). The earlier claim "skill files are never read" is true only of the extension-author file, not of skills in general:
   - **everywhere:** the tool descriptions carry the critical rules; the ~600-character `WORKFLOW_AUTHORING_HINT`; the `get_workflow_authoring_guide(topic)` tool serving the generated reference;
   - **where the provider supports skills** (P02 `capabilities().skills`: the claude-agent plugin, Copilot/Codex directories): the generated bundle is **also** staged as a real skill for agents granted `workflowAuthoring`.

   External agents (Claude Code, Codex) get the same bundle as a skill directory.
6. **Agent-authored workflows are drafts.** Publishing requires a user principal, unless the admin setting `allowAgentPublish` is on (default off). The invoke path refuses drafts except explicit test runs. *Why:* Zapier drafts and diffs; Copilot Studio and Magentic plan sign-off; n8n test-before-activate (G1 §5).
7. **Generated from the schemas.** The JSON Schema, the field reference, the expression grammar, the provider capability matrix and the examples are all generated from `@generatorai/workflow-spec` and the providers' `capabilities()`. CI fails on drift. The offline validator is a bundle of the spec package: the same rules as the server.

---

## WP-6.1 Workflow tool set (`packages/core/src/tools/workflows/index.ts`)
Implement the tools from G4 §2.3, adapted to the v2 names:

| Tool | Behaviour |
|---|---|
| `list_workflows {query?, projectId?, tag?, limit≤50}` | Published definitions only (drafts are listed when `workflowAuthoring` is on and flagged `status:'draft'`) |
| `describe_workflow {workflowId}` | Variables, stages (key, kind, agent, model, approval, guard), edges, required codebases, post-processing, **risk flags** (writes files, opens a PR, bypass), capability warnings, declared outputs |
| `run_workflow {workflowId, variables?, codebases?, stageOverrides?, model?, permissionMode?, workspace?: 'isolated'\|'from_chat_branch', wait?: 'none'\|'until_done'\|'until_approval_or_done', waitSeconds≤600, approvalDelegate?: 'human'\|'invoker', reason}` | `WorkflowInvocationService.invoke` with trigger `chat` / `orchestrator` / `stage`. Returns `{runId, status, link, replayed, plan, digest?}` |
| `check_workflow_run {runId, wait?, waitSeconds?}` | `RunDigest`: status, per-stage key/status/summary (≤600 chars)/error, pending approvals, artifacts, post-processing result (commit, branch, prUrl), link. Only runs in the caller's lineage or started by the same principal |
| `respond_workflow_approval {runId, instanceId, outcome, feedback?, reason}` | Completion reviews only, under design decision 4 |
| `cancel_workflow_run {runId, reason}` | Runs the caller started |
| `get_workflow_authoring_guide {topic?}` | Generated markdown section (`workflowAuthoring`) |
| `validate_workflow {graph}` | `validateWorkflow` issues (`workflowAuthoring`) |
| `plan_workflow {graph \| workflowId, variables?, stageOverrides?}` | `InvocationPlan` plus per-stage guard evaluation, unresolved templates and capability warnings (`workflowAuthoring`) |
| `create_workflow_draft {graph, projectId?, replacesWorkflowId?}` | A draft with `authoredBy: trigger`; returns the review link (`workflowAuthoring`) |

- The tool order is fixed, and the tools are appended **after** the existing tools, so the *ordering* of existing tools is unchanged. **Correction (RV-25):** Anthropic caches tools first, so adding any tool costs every affected chat **one** full prompt-cache miss on its next turn. That is accepted as a one-time cost. Measure the per-turn token delta in the PR, with the ~6 tool schemas budgeted at under 2k tokens.
- **Default (PD-23):** the `workflows` group is **on** for orchestrator chats, and **on** for top-level chats only when the chat's agent grants it **or** the user enables "Workflows" in the chat's tool toggles (default **off** for plain chats). This avoids a token cost on every chat. The product owner may flip the default.
- `ToolDefinition.handler` gets a second argument `{toolCallId, turnId}`. Every provider adapter passes it, and it feeds idempotency.
- `WorkflowApprovalService` (extracted in **P05** WP-5B.2) is reused: the route, the run page and the tools call the same service.

## WP-6.2 Chat ↔ run bridge and UI
- `ChatWorkflowRunBridge` (core) re-emits `workflow_run.*` / `stage_run.*` events for runs whose trigger is a chat, onto the chat scope:
  - `chat.workflow_run.linked`
  - `chat.workflow_run.progress` (500 ms throttle; stage transitions unthrottled)
  - `chat.workflow_run.awaiting_approval`
  - `chat.workflow_run.finalized`

  Add them to `AgentEvent.ts` and `eventClass.ts`.
- **Persistence:** migration (next free version) `chat_workflow_runs(chat_id, run_id, tool_call_id, created_at)` and `chats.created_by_principal`. In-process tools act for the chat's creating principal, whose scopes gate `run_workflow` (`exec:agent`) and `create_workflow_draft` (`write:workflows`).
- **Nudge:** when a chat-started run finalizes, or parks on an approval, and the chat is idle, send one `[system]` message. Use the same guard as `nudgeParentAfterWave`.
- **Web and mobile chat renderers:**
  - an inline **run card** (status, current stage, progress, link), reusing the Background Tasks list component;
  - an **approval card** that calls the same commands endpoint as the run page;
  - a **draft card** for `create_workflow_draft`, with "Open in builder (agent draft)" and "Publish".
- **Workspace semantics** (G4 §2.6):
  - `isolated` (default): the run gets its own worktrees from the codebase base refs;
  - `from_chat_branch`: the chat's uncommitted changes are checkpoint-committed first, or the call is refused with `CHAT_DIRTY`, and the run's worktree is cut from the chat branch HEAD.
  - `parentWorkspaceId` is recorded.

## WP-6.3 Orchestrator integration
- Orchestrator chats get the `workflows` group by default. Their episode deadline (30 min) caps `waitSeconds` and the child run `maxDurationMs`.
- Workers get `workflows: false`, so they cannot fan out further.
- **Worker clamp fix (C-15):** the parent's built-in denials go into the worker's `excludedBuiltinTools`, and are folded into the resolver as `extraDeny`, so the clamp holds on Copilot.
- **Replay safety comes from invocation idempotency** (the review cut the separate journal). `run_workflow` derives its key from `chat:<chatId>:<toolCallId>` (P04), so a replayed orchestrator tool call returns the same run. Add a separate decision journal for `spawn_background_agent` only if a replay bug is demonstrated.

## WP-6.4 Stages invoking workflows
- **Declarative** (preferred): the P05 `subworkflow` stage.
- **Dynamic:** a stage whose agent grants `workflows` gets the tool set through the binder, with trigger `stage` and inherited lineage. The budget is capped by the stage's remaining `attemptMs`/`totalMs`. The child's `parent_stage_run_id` is set. Approvals are mirrored into the parent run's pending list (P05 WP-5.3).

## WP-6.5 `WorkflowAuthoringService` and endpoints
In `packages/core/src/services/WorkflowAuthoringService.ts`, following G4 §3.3, adapted to P01 routes:
- `validate(graph)`: the spec package's `validateWorkflow`, plus server-only checks:
  - `agentRef` exists and is enabled;
  - the model exists in the catalog;
  - provider capability conflicts (warnings);
  - command-bearing fields that need `admin:settings` (errors for callers without it).
- `plan(graph|id, vars, overrides)`: the invocation planner without writing rows.
- `createDraft(graph, {authoredBy})`: tagged `agent-authored`.
- `publish(id, principal)`: user principals only, unless `allowAgentPublish`.
- `GET /api/workflow-definitions/schema` → `{version, hash, jsonSchema}`, so an agent holding an old skill can detect drift. The tools compare hashes and warn.
- The builder shows an **agent-draft banner**: authored by (chat, agent or external), a diff against the replaced workflow (if any), risk flags, and Publish / Discard.

## WP-6.6 Skill bundle generation
- `scripts/generate-workflow-skill.ts` (in the same generator family as `generate-workflow-spec`) produces `skills/generatorai-workflow-author/`:

  ```
  SKILL.md                     hand-written core + generated fragments; frontmatter: name, description (≤1024 chars,
                               "Use when…"), metadata {schemaVersion, schemaHash}
  reference/schema.md          GENERATED field reference (from .describe())
  reference/stages.md          agent/check/loop/map/subworkflow/wait, output contracts, judge rule, context, sessionReuse, approval
  reference/edges-and-expressions.md  edges, join policies, Expression v2 grammar (GENERATED from the parser table)
  reference/control-flow.md    generic loop/map/subworkflow/wait/check semantics + the P05 examples (GENERATED from templates)
  reference/agents-and-models.md  session spec, capability matrix (GENERATED from providers' capabilities())
  reference/lifecycle.md       codebases, worktrees, preprocessing, post-processing, hooks, budgets
  reference/pitfalls.md        keys not names; no __ vars; approval before PR/push; loops need budgets; draft/publish
  schema/workflow.schema.json  GENERATED
  schema/invocation.schema.json GENERATED
  examples/*.json              the shipped templates + small focused examples, each CI-validated and round-tripped
  scripts/validate.mjs         GENERATED esbuild bundle of @generatorai/workflow-spec validate (no install needed);
                               JSON issues on stdout, exit 1 on errors, --help, no prompts
  ```

- **SKILL.md body** (low freedom, because the artifact is fragile; G1 §3):
  1. When to use it.
  2. **The mandatory process:** inspect existing workflows and agents → draft the JSON against the schema → **validate until zero errors** → **plan** with realistic variables and read the result → summarise it for the human (stages, what each can touch, permission, whether it commits or opens a PR, budget) → **submit as a draft**. Never publish or run unless the human asks.
  3. Hard rules.
  4. The channel table.
  5. Links to references, one level deep.
- **Body budget:** under 500 lines and under 5k tokens (agentskills.io spec).
- Wire `pnpm generate:workflow-skill` and a CI `--check`.
- A copy ships under `templates/system/skills/generatorai-workflow-author/`, read at runtime by the guide tool and MCP resources, so all three channels read the **same files**.
- **Evals** (G1 §3, evaluation-driven): at least 3 authoring tasks, among them "create the issue-triage fix/review loop" and "fan out over changed files", run with Haiku, Sonnet and Opus.
  - Measure: validation passes within 3 tries; the plan is shown before the draft; no forbidden fields.
  - Keep the tasks in `skills/generatorai-workflow-author/evals/`.

## WP-6.7 Channels
- **In-app chat, orchestrator and stage:** the tools, `WORKFLOW_AUTHORING_HINT` (appended when `workflowAuthoring` is on) and the guide tool.
- **Claude Code:** `generatorai skill install --target claude [--project]` copies the bundle to `.claude/skills/generatorai-workflow-author/` or `~/.claude/skills/`, and prints the MCP config snippet.
- **Codex:** `generatorai skill install --target codex` asks the installed Codex where its skill roots are: run `codex app-server` and call `skills/list`, or read `$CODEX_HOME/config.toml` `skills` entries. Sources disagree between `~/.codex/skills` and `~/.agents/skills` (RV spot-check 29), so **never hard-code the path**. It then copies the bundle there and prints the `[mcp_servers.generatorai]` `config.toml` snippet.
- **Any MCP client:** WP-6.8.
- **CLI:**
  - `workflow lint <file>`: offline, spec package;
  - `workflow plan <file|id> --var k=v`;
  - `workflow import <file> --draft` (the default for non-interactive callers);
  - `workflow publish <id>`;
  - `skill install|print`.

## WP-6.8 MCP tools, resources and prompts
Remote mode, the `mcp` device pairing and the deletion of embedded mode already landed in P04.
- **Tools** (`generatorai_` prefix): the full WP-6.1 set, through an adapter over `buildWorkflowToolSet`. Idempotency comes from the tool-call argument `idempotencyKey`.
- **Resources:** `generatorai://workflow-author/SKILL.md`, `…/reference/*`, `…/schema/workflow.schema.json`, `…/examples/*`.
- **No MCP prompts.** An MCP prompt appears as a slash command in Claude Code, and the product rule is no slash commands. Resources plus tools are enough.

## WP-6.9 Docs
- A "Workflows from agents" guide: tools, limits, approval delegation, drafts, the skill install and the MCP setup for Claude Code and Codex.

---

## Tests to add
- **Tool handler unit tests:**
  - the permission ceiling;
  - depth and recursion refusal;
  - `maxChildRuns`;
  - concurrency per chat;
  - idempotent replay by `toolCallId`;
  - lineage visibility for `check`;
  - the approval delegation rules (tool-permission HITL is never answerable);
  - draft refusal in `run`;
  - `create_workflow_draft` requires `write:workflows` from the chat principal.
- **Prompt-cache stability:** the golden snapshots show workflow tools appended after the existing tools, and the prefix is otherwise unchanged.
- **Bridge:** event mapping, throttling, the nudge guard, and cards surviving a reload (`chat_workflow_runs`).
- **Orchestrator:** workers have no workflow tools; the Copilot clamp holds (C-15); journalled decisions replay.
- **Skill:**
  - the generator `--check` is clean;
  - `scripts/validate.mjs` matches the server's `validate` on a corpus (every example plus 50 fast-check-generated invalid graphs);
  - SKILL.md passes `skills-ref validate` (if available) and the 500-line limit.
- **MCP:**
  - remote mode round trip against the isolated server: list → validate → plan → create draft → (a human publishes via the API in the test) → run → check;
  - resources are served.
- **E2E phase 06:**
  - a chat (claude-agent) is asked "run the per-file-migration workflow on files X, Y": the run card appears, finalizes, and the nudge arrives;
  - an orchestrator starts 2 workflows in parallel and checks them;
  - Claude Code headless (`claude -p`) with the installed skill and MCP config creates a valid draft for "a review loop for issue fixes" (record the transcript; skip with a note if the Claude Code CLI is not available in CI).

## Acceptance criteria
- The same tool behaviour appears in chat, orchestrator, stage and MCP (a shared contract test suite run against each binding).
- An agent cannot publish, cannot answer tool-permission HITL, cannot exceed depth 3, and cannot raise the permission mode above its caller's.
- **Exemptions** (RV-9): binding tools in **stages** requires `hostTools !== 'none'`. On opencode and ACP, stages get no workflow tools, and the composer warns. On Codex after a resume (`start_only`), the same exemption and warning apply unless the tools are re-sent.
- The skill bundle regenerates without drift, and its offline validator agrees with the server on the whole corpus.

## Handoff checklist
- [ ] WP-6.1 … 6.9 are done.
- [ ] The evals are recorded in `skills/generatorai-workflow-author/evals/RESULTS.md`.
- [ ] `STATUS.md` updated.
