# G1: Codex Goals, Claude Code dynamic workflows, Agent Skills, loop patterns, agent-authored workflows

Research date: 2026-09-24. Every claim has a source. Anything I could not confirm from a primary source (vendor docs, vendor repo source, or vendor changelog) is marked **(unverified)**. Primary sources I read directly:

- openai/codex repo source, fetched through the GitHub API with `gh`.
- code.claude.com docs.
- agentskills.io.
- platform.claude.com.
- LangGraph, ADK, Mastra, Microsoft Learn, AWS, Temporal and Inngest docs.

**Access note.** developers.openai.com/codex/* now redirects (308) to learn.chatgpt.com, which returned HTTP 403 to the fetcher. For Codex I therefore relied on three kinds of source instead of the docs site:

1. **Source code**, which is authoritative for semantics.
2. **The OpenAI cookbook**, which is still fetchable.
3. **Search-result snippets** of the docs pages. These are marked where they are used.

GeneratorAI facts come from this repo at the current `desktop_redesign` HEAD. File paths are cited inline.

---

## 1. OpenAI Codex "goals" and related Codex features

### 1.1 What a goal is (precise semantics)

- **Release.** `/goal` shipped in Codex CLI **0.128.0** (Apr 30, 2026). It is persisted across app-server APIs, model tools, runtime continuation and TUI controls.
  - Sources: https://simonwillison.net/2026/Apr/30/codex-goals/ ; https://github.com/openai/codex/releases/tag/rust-v0.128.0 ; https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- **Feature flag.** On current `main` the `goals` feature is `Stage::Stable, default_enabled: true`.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs
  - An earlier third-party analysis describes it as `UnderDevelopment`, default-off, at launch: https://gist.github.com/patleeman/b1b5768393f9bf2f60865b1defeeb819 (secondary). The flag has since graduated.
- **Scope.** A goal is **persisted thread state**. It is not global memory and not project instructions. It records "the objective, lifecycle, budget, and progress accounting." There is one goal per thread.
  - Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- **Data model** (generated TS protocol type): `ThreadGoal = { threadId, objective, status, tokenBudget: number|null, tokensUsed, timeUsedSeconds, createdAt, updatedAt }`.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoal.ts
- **Statuses:** `"active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete"`.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoalStatus.ts
  - Note that `blocked` and `usageLimited` are newer than the four statuses (active/paused/budget_limited/complete) that the early third-party write-ups list.
- **Human controls:** `/goal <objective>`, `/goal` (view), `/goal pause`, `/goal resume`, `/goal clear`. The app-server exposes `thread/goal/set|get|clear` plus `ThreadGoalUpdated`/`Cleared` notifications, so any client, including an IDE or desktop app, can drive the goal.
  - Sources: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex ; the `ThreadGoal*Params.ts` files under https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript/v2
- **Budget config:** `[goals] max_goal_token_budget` is "Maximum token budget allowed for a goal and default budget for new goals."
  - Source: `GoalsToml` in https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json

### 1.2 Model-facing tools (asymmetric control)

Source for this section: https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/spec.rs

- **`create_goal {objective, token_budget?}`.** "Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks." It fails if an unfinished goal exists.
- **`update_goal {status: "complete" | "blocked" | "paused"}`.** The model may only move a goal to these three states.
  - `paused` requires an explicit user request.
  - `blocked` is allowed only after "the same blocking condition has repeated for at least three consecutive goal turns".
  - "You cannot use this tool to resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system."
- **`get_goal`** returns the goal, its usage and the remaining tokens.

### 1.3 The loop: how Codex continues until done

Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex

- **Continuation is event-driven at safe boundaries.** A turn runs "after a turn has finished, when no other work is pending, when no user input is queued, and when the thread is idle."
- **Anti-spin rule.** "If a turn produces no tool calls, the next automatic continuation is suppressed so Codex does not spin."
- **Runtime entry point.** The runtime calls `start_turn_if_idle` with a continuation steering item and honours a "continuation deferral".
  - Source: https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/runtime.rs
- **Continuation prompt.** Each automatic turn injects `templates/goals/continuation.md`, filled with the objective (wrapped as *user-provided data, not higher-priority instructions*) and the budget (tokens used, budget, remaining). The key rules it encodes:
  - **Persistence and fidelity.** "Keep the full objective intact… do not redefine success around a smaller or easier task." It also says "Do not substitute a narrower, safer, smaller… or easier-to-test solution."
  - **Work from evidence.** "Use the current worktree and external state as authoritative… inspect the current state before relying on [previous conversation]."
  - **No-progress check.** The model classifies the previous turn as *progress*, *verified wait* or *no progress*. A verified wait must poll a specific live handle; "never restart solely because observation expired."
  - **Completion audit.** This is the core of "how completion is judged". The model derives concrete requirements. For every requirement, artifact, command, test or gate it identifies the authoritative evidence and classifies it as proves, contradicts, incomplete, too weak, or missing. The prompt says "Treat uncertain or indirect evidence as not achieved" and "The audit must prove completion, not merely fail to find obvious remaining work." Only then does it call `update_goal(complete)`.
  - **Blocked audit.** The goal becomes blocked only after the same blocker has held for 3 consecutive goal turns. A resumed goal starts a fresh blocked audit.
  - **Progress visibility.** It uses `update_plan` for multi-step work.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/continuation.md
- **Budget exhaustion.** The system marks the goal `budget_limited` and injects `budget_limit.md`: "do not start new substantive work… Wrap up this turn soon: summarize useful progress, identify remaining work or blockers, and leave the user with a clear next step… budget_limited takes precedence over paused."
  - Source: https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/budget_limit.md
  - The cookbook adds: "Reaching a budget limit is not the same as completing the objective."
- **Accounting.** Token and wall-clock deltas are computed per turn and pushed atomically to SQLite (`thread_goals` table). A `budget_limiting` steering item is injected mid-turn when the budget is crossed.
  - Sources: https://gist.github.com/patleeman/b1b5768393f9bf2f60865b1defeeb819 (secondary, consistent with `ext/goal/src/accounting.rs` and `steering.rs`; not independently re-read line by line, so **partially unverified**)
- **Recommended objective structure** (cookbook): outcome; verification surface; constraints; boundaries; iteration policy; blocked stop condition. The suggested template reads: `/goal <end state> verified by <evidence> while preserving <constraints>. Use <boundaries>. Between iterations, <how to choose next action>. If blocked, <what to report>.`
  - Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- **Decomposition.** Codex does **not** produce an explicit DAG from a goal. Decomposition happens inside turns via `update_plan` and, optionally, subagents. The goal is a single persisted objective plus an evaluator-by-self-audit loop.
  - Sources: continuation.md above; cookbook.

### 1.4 Related Codex primitives

- **Subagents (multi-agent tools).**
  - v1 tools: `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`.
  - v2 tools: `spawn_agent {task_name, message}`, `send_message`, `followup_task`, `wait_agent` (mailbox), `list_agents`, `interrupt_agent`.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs
  - Config keys under `[agents]`: `max_concurrent_threads_per_session`, `max_depth` (v1 only), `default_subagent_model`, `default_subagent_reasoning_effort`. Named roles can take a `description`, a `config_file` and `nickname_candidates`.
  - Source: `AgentsToml` / `AgentRoleToml` in https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json
  - Docs page: https://developers.openai.com/codex/subagents (the snippet says it triggers on "spawn two agents", "use one agent per point"; **the page itself was not fetchable**).
- **Hooks.**
  - Events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`.
  - Handler types: `command` (with `async`, `timeout`, `commandWindows`, `additionalContextLimit`), `mcp_tool`, `prompt`.
  - Source: `HooksToml` / `HookHandlerConfig` in https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json ; JSON I/O schemas in https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated
- **Skills.**
  - Codex adopts SKILL.md. It reads `name`, `description` and `metadata.short-description`. Codex-specific policy lives in a sidecar `agents/openai.yaml` (`policy.allow_implicit_invocation`, default true). Explicit invocation is `$skill-name`.
  - Sources: search snippet of https://developers.openai.com/codex/skills ; https://github.com/openclaw/openclaw/pull/115735 (third-party analysis of Codex's parser) (**unverified against Codex source**). The config schema confirms `skills` is "User-level skill config entries keyed by SKILL.md path" (https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
- **AGENTS.md.** Codex reads project docs. The config has `project_doc_max_bytes`, `project_doc_fallback_filenames` and `project_root_markers`.
  - Source: config.schema.json above; docs page https://developers.openai.com/codex/guides/agents-md (redirect, not fetched).
- **`codex exec` (non-interactive).**
  - Flags: `--output-schema FILE` ("JSON Schema file describing the model's final response shape"), `--json` (JSONL events), `--output-last-message`, `--ephemeral`, `--skip-git-repo-check`, `--worktree`.
  - Subcommands: `resume [SESSION_ID|--last]`, `fork`, `review` (`--uncommitted`/`--base`/`--commit`).
  - Source: https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs
- **Codex SDK (TypeScript).**
  - `new Codex().startThread()`, `thread.run()` / `runStreamed()`, per-turn `outputSchema` (JSON Schema), and `resumeThread(id)`. Threads are persisted in `~/.codex/sessions`.
  - The SDK spawns the CLI and exchanges JSONL over stdio.
  - Source: https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- **Best-of-N.** `codex cloud exec --attempts N` means "Number of assistant attempts (best-of-N)", validated to **1–4**. `codex cloud apply --attempt N` picks which attempt to apply.
  - Source: https://github.com/openai/codex/blob/main/codex-rs/cloud-tasks/src/cli.rs
- **Automations / scheduled tasks (Codex app).**
  - Scheduled tasks run a prompt or skill on a schedule, in the local project or in a dedicated background worktree. The machine and app must be running.
  - Sources: search snippets of https://developers.openai.com/codex/app/automations and https://developers.openai.com/codex/app/automations.md (**page 403, snippet only: unverified**).
  - A cloud-scheduling request is tracked at https://github.com/openai/codex/issues/47660.
- **Guardian auto-review.** The config has `auto_review` ("Optional policy instructions for the guardian auto-reviewer") and `approvals_reviewer`. This is an LLM approver for tool calls.
  - Source: config.schema.json above.

---

## 2. Claude Code "dynamic workflows" and related primitives

### 2.1 What they are

Source for this whole subsection: https://code.claude.com/docs/en/workflows

- **Definition.** A dynamic workflow is a **JavaScript script that orchestrates many subagents**. "Claude writes the script for the task you describe, and a runtime executes it in the background while your session stays responsive."
- **Comparison with other primitives.** The docs compare subagents, skills, agent teams and workflows on "who decides what runs next":

| | Subagents | Skills | Agent teams | Workflows |
|---|---|---|---|---|
| Who decides what runs next | Claude, turn by turn | Claude, following the prompt | The lead agent | **The script** |
| Where intermediate results live | Claude's context | Claude's context | Shared task list | **Script variables** |
| Scale | a few per turn | same | a handful of peers | **dozens to hundreds per run** |
| Interruption | restarts the turn | restarts the turn | teammates keep running | **resumable in the same session** |

- **Availability.** All paid plans, the Anthropic API, Bedrock, Vertex (Google Cloud's Agent Platform) and Foundry. Surfaces: CLI, Desktop, IDE extensions, `claude -p`, and the Agent SDK.
- **Built-in workflow.** `/deep-research` "fans out web searches… fetches and cross-checks the sources… votes on each claim, and returns a cited report with claims that didn't survive cross-checking filtered out." A claim whose verifiers failed (rate limit or API error) is listed as **unverified**, not refuted.

### 2.2 Script API

Sources: https://code.claude.com/docs/en/workflows plus the bundled `/workflow-authoring` skill reference shipped with Claude Code v2.1.248+ (the docs say "run the `/workflow-authoring` bundled skill to load the script-writing reference").

**Header block**
- `export const meta = { name, description, whenToUse?, phases?: [{title, detail?, model?}] }`.
- It must be the first statement and a **pure literal**. Otherwise the saved `/<name>` command drops out of autocomplete.

**`agent(prompt, opts)`** spawns one subagent. Options:
- `label`, `phase`
- `schema`: JSON Schema, which forces a `StructuredOutput` tool call and returns a validated object
- `model`, `effort`
- `isolation: 'worktree'`
- `agentType`: a custom subagent from `.claude/agents`

Return and schema behaviour:
- Returns `null` if the agent was stopped or hit an unrecoverable API error.
- Schemas are checked for provable contradictions before the agent starts. The docs' example: "a `required` key that `additionalProperties: false` rules out".
- Validation failures retry up to **5** times (`MAX_STRUCTURED_OUTPUT_RETRIES`). After that the call fails with the last validation error.

**Composition primitives**
- **`pipeline(items, stage1, stage2, …)`** runs each item through all stages with **no barrier between stages**. A stage that throws turns that item into `null`.
- **`parallel(thunks)`** is a **barrier**. It never rejects; failed thunks become `null`.
- **`workflow(nameOrRef, args)`** calls a saved workflow inline. Nesting is **one level only**. The child shares the concurrency cap, agent counter, abort signal and budget.

**Progress and inputs**
- **`phase(title)`** groups agents in the progress view. **`log(msg)`** prints a narrator line.
- **`args`** is the invocation input, passed as structured JSON.
- **`budget`** is `{total, spent(), remaining()}` from a user "+500k"-style directive. It is a **hard** ceiling: once `spent()` reaches `total`, further `agent()` calls throw. The pool is shared across the main loop and all workflows in the turn. (Source: the workflow-authoring skill. The public page does not document `budget`, so this detail is from the bundled reference.)

**Determinism**
- `Date.now()`, `Math.random()` and argument-less `new Date()` **throw**, so that a relaunch replays the same `agent()` calls.
- No `import()`, no filesystem or shell access from the script itself. Agents do the I/O.

### 2.3 Kinds of workflow supported

These are the docs' own example prompts plus the authoring reference's quality patterns (https://code.claude.com/docs/en/workflows ; workflow-authoring skill):

1. **Fan-out / fan-in audit.** One agent per file, then collect findings, e.g. "audit every route handler… adversarially verify each finding".
2. **Iterate-until-pass.** "Run `tsc --noEmit` and keep fixing… until the type check passes **or two rounds in a row make no progress**." A `while` loop in the script.
3. **Parallel migration with isolation.** One agent per file, each in its own worktree copy (`isolation: 'worktree'`), then verify.
4. **Map-reduce review.** A reviewer per changed file, then one agent merges, ranks and dedupes.
5. **Multi-source research.** Parallel readers, then synthesis, cross-check and vote (`/deep-research`).
6. **Loop-until-dry.** "Stop once two rounds in a row find nothing new." Deduplicate against *all seen* items, not just confirmed ones, or the loop never converges.
7. **Adversarial verify.** N independent skeptics per finding, each prompted to refute; the finding is killed on a majority refutation.
8. **Perspective-diverse verify.** Distinct lenses (correctness, security, perf, repro) instead of N identical refuters.
9. **Judge panel / tournament.** N independent attempts from different angles, then parallel judges score them, then synthesis from the winner with grafts from runners-up.
10. **Multi-modal sweep.** Parallel search strategies (by container, content, entity, time).
11. **Completeness critic.** A final agent asks "what's missing"; its answer seeds the next round.
12. **Loop-until-count / loop-until-budget.** Accumulate to N results, or keep going while `budget.remaining() > X`.
13. **Chained single-phase workflows.** Understand → Design (judge panel) → Review → Research → Migrate, run as separate workflows so a human stays in the loop between phases.
14. **Composed workflows** via `workflow()`, one level deep.

### 2.4 Limits, cost, determinism and resume

Source for this whole subsection: https://code.claude.com/docs/en/workflows

**Runtime limits**
- **No mid-run user input.** A run pauses only for agent permission prompts and usage-limit waits. "For sign-off between stages, run each stage as its own workflow."
- **Concurrency:** up to **16** concurrent agents by default (fewer on low-CPU hosts). `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` accepts 1–256 (v2.1.269+).
- **Item and agent caps:** max **4,096 items** per `parallel()`/`pipeline()`, which is an explicit error, not truncation. Max **1,000 agents per run** ("prevents runaway loops").
- **Cache stagger:** fan-out agents that share a prompt-cache prefix are held up to `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS` (5000 ms) so they read the first agent's cached prefix.

**Cost and sizing**
- A **"Large workflow"** advisory warning appears when a run schedules more than 25 agents or its projected tokens exceed 1.5M. It does not pause or limit the run.
- **Size guideline** setting (advice to the author model, not a cap): `small` (<5 agents), `medium` (<10, the default), `large` (<50), `unrestricted`. Pro defaults to `small`.

**Approval**
- The per-run approval prompt shows the planned phases. Options: Yes, "don't ask again for `<name>` in `<path>`" (saved, bundled and plugin workflows only), View raw script, and No.
- In `-p` and the SDK, approval goes through normal permission evaluation: a `Workflow` / `Workflow(<name>)` allow rule, auto mode, a PreToolUse hook, or the host's `canUseTool`.
- **Keyword safety:** since v2.1.210 the `ultracode` keyword does not start a workflow when it arrives via `-p`, an un-stamped SDK prompt, a scheduled prompt, a webhook or a PR comment. Only typed human input counts.

**Resume** replays in agent start order:
- **Completed** agents return their cached result, until the first agent whose *prompt differs* from the previous run. That agent and **every agent after it** re-run.
- **Still-running** agents start over.
- **Failed** agents re-run, and so does every agent started after them. Stopping a single agent counts as failing it.
- Resume works within the same session, from a backgrounded session, and via `claude --resume` (results are kept under `~/.claude/projects/`). A fresh session starts over. A missing journal gives a `nothing to resume` error.
- Usage-limit waits are capped at 2 per run and require the reset to be under 24h.

**Persistence and reuse**
- Every run's script is written under the session directory and can be diffed and edited.
- Runs can be saved from `/workflows` with `s` to `.claude/workflows/` (project, nearest ancestor in a monorepo, symlink-checked) or `~/.claude/workflows/` (personal). Plugins ship workflows in `workflows/`, namespaced `/plugin:name`.

**Ultracode**
- `/effort ultracode` means xhigh effort plus automatic workflow orchestration for every substantive task. Alternatively, the `ultracode` keyword opts in a single prompt.

### 2.5 Related Claude Code primitives

- **`/goal`** is the direct analogue of Codex goals.
  - Source: https://code.claude.com/docs/en/goal
  - It is "a wrapper around a session-scoped prompt-based Stop hook." After each turn, a small fast model (Haiku by default) judges the condition against the transcript. **It does not run tools.** It returns *Not yet met* (the reason becomes guidance for the next turn), *Met* (goal cleared, achieved entry) or *Impossible* (goal cleared, failed entry).
  - The condition can be up to 4,000 chars. Turn and time bounds go *inside* the condition ("or stop after 20 turns"); there is no separate budget field.
  - **No-progress guard:** "no tool use for several turns in a row" stops the loop with the goal still set.
  - **Error handling:** auth, credit, context-overflow and model-unavailable errors clear the goal. Transient errors auto-retry up to 3 times, then pause. Rate limits and usage limits pause.
  - Background work defers evaluation, with check-ins at 30 min, then backing off to at most 4×. Resume restores the condition but resets the counters.
  - Works in `-p`, the desktop app and Remote Control.
- **Stop hooks.** `prompt` hooks (a single LLM call; `ok:false` + `reason` keeps Claude working; `impossible:true` allows the stop) and `agent` hooks (a subagent with tools, up to 50 tool turns, 60 s default timeout; experimental). Claude Code overrides a Stop hook after it **blocks 8 times in a row without progress** (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). Scripts should honour `stop_hook_active`.
  - Source: https://code.claude.com/docs/en/hooks-guide
- **Subagents** are `.claude/agents/*.md` files.
  - Frontmatter fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns` (returns partial output), `skills` (preloaded), `mcpServers`, `hooks`, `memory`, `background`, `isolation: worktree`, `effort`, `omitClaudeMd`, `initialPrompt`.
  - Defaults: nesting depth 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), 20 concurrent (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
  - Source: https://code.claude.com/docs/en/sub-agents
- **Skills** are covered in §3. They add `context: fork` + `agent:` to run a skill in a subagent, `!`cmd`` dynamic context injection, and `$ARGUMENTS`.
  - Source: https://code.claude.com/docs/en/skills
- **`/loop` and cron tools** (`CronCreate`/`CronList`/`CronDelete`).
  - Session-scoped, 1-minute minimum, up to 50 tasks per session, 7-day expiry for recurring tasks, deterministic jitter, no catch-up for missed fires.
  - A self-paced `/loop` picks a 1 min–1 h delay and can end itself via `ScheduleWakeup(stop:true)`.
  - `loop.md` replaces the built-in "maintenance" prompt.
  - Source: https://code.claude.com/docs/en/scheduled-tasks
- **Routines.** Cloud, research preview. Each routine is a prompt + repos + connectors + environment.
  - Triggers: schedule (at least 1 h), API `/fire` with a bearer token (fire text arrives wrapped as untrusted `<routine-fire-payload>`), and GitHub PR/release events with filters.
  - A daily run cap applies. "A green status… does not mean the task in your prompt succeeded."
  - Source: https://code.claude.com/docs/en/routines
- **Other parallelism modes:** agent view (`claude agents`), agent teams (experimental, shared task list), `/batch` (5–30 worktree-isolated subagents, each opening a PR), and forked subagents.
  - Source: https://code.claude.com/docs/en/agents

---

## 3. Agent Skills open standard (SKILL.md)

- **Origin.** "Originally developed by Anthropic, released as an open standard." It is maintained at agentskills.io, with discussion at github.com/agentskills/agentskills.
  - Source: https://agentskills.io/
  - Announcement date **Dec 18, 2025**. Sources: https://the-decoder.com/anthropic-publishes-agent-skills-as-an-open-standard-for-ai-platforms/ and https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard (secondary; **date not confirmed on an Anthropic page**).
- **Adopters listed on agentskills.io's client showcase** (primary):
  - Coding agents and CLIs: Claude Code, Claude (apps/API), ChatGPT & Codex, GitHub Copilot, VS Code, Cursor, Gemini CLI, OpenCode, OpenHands, Amp, Goose, Junie (JetBrains), Kiro, Roo Code, Factory, Letta, Mistral Vibe, TRAE, Tabnine.
  - Platforms: Spring AI, Databricks Genie Code, Snowflake Cortex Code, Pulumi Neo, Laravel Boost, OpenClaw, Hermes Agent.
  - The showcase lists about 45 in total.
  - Source: https://agentskills.io/
- **Format** (https://agentskills.io/specification):
  - A skill is a directory containing `SKILL.md` plus optional `scripts/`, `references/` and `assets/`.
  - **Frontmatter:**
    - `name` (required): 1–64 chars, lowercase a–z, 0–9 and `-`; no leading, trailing or double hyphen; must match the directory name.
    - `description` (required): 1–1024 chars; describe what it does *and when to use it*.
    - `license`, `compatibility` (≤500 chars), `metadata` (string→string map), and `allowed-tools` (space-separated, *experimental*).
  - **Progressive disclosure:**
    1. Metadata, about 100 tokens, loaded at startup for all skills.
    2. The body, recommended under 5,000 tokens and under 500 lines, loaded on activation.
    3. Resources, loaded on demand.
  - Keep file references one level deep. Validate with `skills-ref validate ./my-skill`.
  - The platform docs add two constraints: no XML tags, and the reserved words "anthropic" and "claude" are not allowed in `name`. Source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- **Vendor extensions:**
  - **Claude Code** adds `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `background`, `model`, `effort`, `disallowed-tools`, `paths`, `shell` and `hooks`. It also supports `!`cmd`` pre-render injection and `${CLAUDE_SKILL_DIR}`.
    - Source: https://code.claude.com/docs/en/skills
  - **Codex** puts invocation policy and dependencies in `agents/openai.yaml` (see §1.4; partly unverified).
- **Best practices for a skill that teaches an agent to author structured artifacts** (for example, workflow JSON validated by a schema, CLI or MCP tool):
  - **Set degrees of freedom to fragility.** Use *low freedom* (exact scripts and commands) for fragile, consistency-critical operations. Emitting a schema-valid definition is one of these.
    - Source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
  - **Plan → validate → execute.** "Have Claude first create a plan in a structured format, then validate that plan with a script before executing it… analyze → **create plan file** → **validate plan** → execute → verify." Make validators verbose with actionable errors, e.g. "Field 'signature_date' not found. Available fields: …".
    - Source: same page.
  - **Feedback loop.** "Run validator → fix errors → repeat… Only proceed when validation passes."
    - Source: same page.
  - **Ship utility scripts rather than letting the model write them.** They are more reliable, save tokens, and "only the script's output consumes tokens." Make the intent explicit: "Run X" versus "See X".
    - Source: same page.
  - **Design scripts for agents** (https://agentskills.io/skill-creation/using-scripts):
    - No interactive prompts. Provide `--help`.
    - Structured JSON on stdout, diagnostics on stderr, distinct exit codes.
    - Idempotency, `--dry-run`, closed enums, safe defaults, predictable output size, pinned versions.
  - **Templates and examples.** Give a strict template for data formats, plus input/output examples.
  - **For MCP tools, use fully qualified `Server:tool` names.**
    - Source: platform best practices, above.
  - **Evaluation-driven development:** at least 3 evals, a baseline without the skill, and testing on Haiku, Sonnet and Opus.
    - Source: same page.
- **Relevance to GeneratorAI.** My memory index records that GeneratorAI's extension/widget skill `.md` is never read by the live model; the live hint comes from `ChatManagementService.ts`. A workflow-authoring skill therefore needs a real load path.

---

## 4. Loop / iterate-until-pass patterns across engines

| Engine | Loop construct | State carried between iterations | Budget / bound | On exhaustion | Retry-on-failure | Source |
|---|---|---|---|---|---|---|
| **LangGraph** | Cycles via conditional edges or `Command(goto=…)`; `Send` for dynamic fan-out | Graph state with per-key reducers (e.g. `operator.add` accumulates) | `recursion_limit` counts **super-steps**; default **1000** since 1.0.6; per-invoke config | Raises `GraphRecursionError`; the `RemainingSteps` managed value lets nodes degrade gracefully first | Node retry policies (not researched here) | https://docs.langchain.com/oss/python/langgraph/graph-api |
| **Mastra** | `.dowhile(step, cond)` / `.dountil(step, cond)`; `.foreach(step, {concurrency})` | Condition receives `inputData` and `iterationCount` | No built-in cap; the docs say to throw when `iterationCount` exceeds your threshold | Your thrown error fails the step and the workflow | Step `retryConfig` (**not verified** on this page) | https://mastra.ai/docs/workflows/control-flow |
| **Google ADK `LoopAgent`** | Runs sub-agents in sequence, repeatedly | `session.state` via `output_key` and `{placeholders}` (writer→critic→refiner example) | `max_iterations` | Stops regardless of completion; early exit when a sub-agent's `exit_loop` tool sets `actions.escalate = True` | n/a | https://adk.dev/agents/workflow-agents/loop-agents/ |
| **OpenAI Agents SDK** | No graph loop; an ordinary Python `while` around `Runner.run` (the official `llm_as_a_judge.py` example: generator → evaluator with `output_type` `{feedback, score: pass/needs_improvement/fail}`, history via `to_input_list()`) | Input item list / Sessions | `max_turns` per run (`DEFAULT_MAX_TURNS = 10`); the loop bound is user code | `MaxTurnsExceeded`, or a run error handler returns a controlled final output | App-level | https://openai.github.io/openai-agents-python/running_agents/ ; https://github.com/openai/openai-agents-python/blob/main/examples/agent_patterns/llm_as_a_judge.py ; `src/agents/run_config.py` |
| **CrewAI Flows** | `@router` returns a label; `@listen(label)` can target an earlier method, creating cycles | Pydantic or dict `self.state` (auto `id`); `@persist` to SQLite; resume by id; fork via `restore_from_state_id` | **None documented**; "manual design vigilance" | n/a | n/a; `@human_feedback` routes approve/reject | https://docs.crewai.com/en/concepts/flows |
| **AWS Step Functions** | A `Choice` state whose `Next` points back to an earlier state (back-edge); `Assign` variables | State JSON (256 KiB cap) / variables | Your counter in `Choice`; hard **25,000 history events** per Standard execution, after which the execution **fails** ("start a new execution" to avoid it) | Execution fails | `Retry`: `ErrorEquals`, `IntervalSeconds` (1), `MaxAttempts` (**3**), `BackoffRate` (**2.0**), `MaxDelaySeconds`, `JitterStrategy`; then `Catch` → fallback state with `ResultPath` | https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html ; https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html ; https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html |
| **Temporal** | A plain `while` in deterministic workflow code; **Continue-As-New** checkpoints state into a fresh run (same Workflow ID, new Run ID) | Passed as workflow arguments to the new run | History: warning at 10,240 events / 10 MB; **terminated at 51,200 events / 50 MB** | Termination unless you continue-as-new ("Temporal will tell your Workflow when it's approaching…") | Activity retry policies (not researched here) | https://docs.temporal.io/workflow-execution/continue-as-new ; https://docs.temporal.io/workflow-execution/limits |
| **Inngest** | A plain loop around `step.run` with **unique step IDs per iteration** (memoized replay; code outside steps re-runs) | Memoized step results | **1,000 steps per function** (from a search snippet of inngest.com, **not fetched**) | n/a | 4 retries per step by default, each step with its own counter (search snippet, **unverified**) | https://www.inngest.com/docs/guides/working-with-loops ; https://www.inngest.com/docs/usage-limits/inngest |
| **Inngest AgentKit** | A Network of agents with a router loop (code, LLM or hybrid router) | Shared network `state` (messages + KV) | `maxIter` | The loop stops when the router returns `undefined` or `maxIter` is hit | n/a | https://agentkit.inngest.com/concepts/networks |
| **Microsoft Agent Framework** | Graph: executors + conditional/switch/fan-out/fan-in edges, Pregel/BSP supersteps; Python functional API with native loops; GroupChat and Magentic orchestrations | Shared state, checkpoints at superstep boundaries (per `@step` caching in the functional API) | GroupChat: `MaximumIterationCount` / `termination_condition` / custom `ShouldTerminate`. Magentic: `max_round_count`, `max_stall_count` (stalls → **replan**), `max_reset_count` | Terminates; Magentic replans on stall | n/a | https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/builder-and-execution ; https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat ; https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic |
| **n8n** | The `Loop Over Items` node (batches, `done` output) plus an `If` node for the exit condition with the reset option | Item data | **None**: "If your termination condition never matches, your workflow execution will get stuck in an infinite loop" (search snippet) | n/a | Node-level retry (not researched) | https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches ; https://docs.n8n.io/flow-logic/looping/ (404 at fetch time) |
| **Anthropic "evaluator-optimizer"** | "One LLM call generates a response while another provides evaluation and feedback in a loop"; agents need "stopping conditions (such as a maximum number of iterations)" | Feedback text | Max iterations | n/a | n/a | https://www.anthropic.com/engineering/building-effective-agents (Dec 19, 2024) |
| **Codex `/goal`** | Runtime auto-continuation of the same thread | The thread transcript plus a persisted goal row; each continuation re-anchors on the *current worktree*, not memory | Token budget (`tokenBudget`, `max_goal_token_budget`); anti-spin (no tool calls → suppress); blocked after 3 identical-blocker turns | `budgetLimited` → wrap-up turn with summary, blockers and next step; not complete | Transient failures do not end the goal (`usageLimited` status) | §1 |
| **Claude Code `/goal`** | Prompt-based Stop hook; a Haiku evaluator decides per turn | Transcript; the evaluator's reason becomes next-turn guidance | Bound written inside the condition text; Stop-hook block cap of 8 non-progress blocks; no-tool-use guard | Goal cleared as *met* or *impossible*, or loop halted with the goal kept | 3 auto-retries on transient errors, then pause | §2.5 |
| **Claude Code workflow** | A plain JS `while` inside the script (fix → check until pass, or K dry rounds) | Script variables; each round's agents get prior findings through the prompt | `budget` hard ceiling (throws); 1,000 agents/run; 16 concurrent | `agent()` throws, or the script's own exit | `agent()` → `null` on terminal API error; schema retries (5); resume re-runs failed + later agents | §2.2–2.4 |

**Cross-cutting observations**

1. **Two kinds of bound.**
   - Structural bounds exist in almost every engine: max iterations, steps or turns.
   - Resource bounds (tokens or $) are first-class only in the agent-native systems. Codex has a goal token budget. Claude Code has `budget` in workflows and `maxBudgetUsd` in the SDK.
2. **Exhaustion is rarely treated as "done".**
   - Codex explicitly separates `budgetLimited` from `complete` and forces a wrap-up turn.
   - Claude Code distinguishes *met* from *impossible* from *paused*.
   - Step Functions and Temporal simply *fail* on their history caps.
3. **No-progress detection is the key LLM-specific addition.**
   - Codex: a turn with no tool calls suppresses continuation, and 3 turns with the same blocker lead to `blocked`.
   - Claude Code `/goal`: several turns without tool use stop the loop.
   - Claude Code Stop hooks: 8 blocks without progress triggers the override.
   - Magentic: `max_stall_count` triggers a replan.
   - Workflow authoring guide: "two rounds in a row make no progress".
4. **Observability of iterations.**
   - Magentic emits plan-created, replanned and per-round progress-ledger events.
   - Claude Code shows each evaluator verdict and reason (Ctrl+O), and `/workflows` shows per-phase and per-agent tokens and time.
   - Codex exposes goal usage via `get_goal` and `ThreadGoalUpdated`.
   - Step Functions and Temporal keep full event histories, which are also what they are capped on.

---

## 5. Agent-authored ("dynamic") workflow generation and guardrails

| Platform | How the agent authors the workflow | Guardrails | Source |
|---|---|---|---|
| **Claude Code dynamic workflows** | The model writes a JS orchestration script at runtime (via `ultracode` or an explicit request) and the runtime executes it | Approval prompt showing the **phase list**, "View raw script", and `Ctrl+G` to edit. Schema-contradiction check before an agent starts. Determinism constraints (no clock or random) for replay. Hard caps (1,000 agents, 4,096 items, 16 concurrent). Advisory size guideline and "Large workflow" warning. Hard `budget`. The script is persisted and diffable. Agents keep normal permissions; in auto mode, script-computed prompts do *not* count as user intent. `ultracode` accepted only from typed human input | https://code.claude.com/docs/en/workflows |
| **Codex** | No DAG authoring. `/goal` plus `update_plan` plus runtime subagent spawning (model-driven, turn by turn) | Goal creation only when explicitly requested; model cannot resume or unblock; token budget; evidence audit before completion | §1 |
| **LangGraph** | `Send` for runtime fan-out inside a fixed graph; plan-and-execute pattern (planner LLM emits a step list, executor runs it, re-planner decides finish or new plan) | Graph is compiled code; `recursion_limit` | https://docs.langchain.com/oss/python/langgraph/graph-api ; https://langchain-ai.github.io/langgraphjs/tutorials/plan-and-execute/plan-and-execute/ |
| **Microsoft Agent Framework: Magentic** | The manager LLM writes a task ledger (facts + plan) and re-plans on stalls; it selects the next agent each round | **Plan review**: `enable_plan_review` (Python, off by default) / `RequirePlanSignoff` (.NET, **on** by default), with approve or revise before execution. Round, stall and reset caps. Graph build-time validation (type compatibility, reachability, duplicate edges) for graph workflows | https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic ; https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/builder-and-execution |
| **Inngest AgentKit** | LLM routing agent picks the next agent at runtime (network) | `maxIter`; hybrid code+LLM router | https://agentkit.inngest.com/concepts/networks |
| **n8n AI Workflow Builder** | Natural language → nodes placed and configured on the canvas; refine by chat | Review the required credentials and parameters; **credential details not sent to the LLM**; "Execute and refine" test (costs a credit); monthly credit caps per plan | https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder ; credit numbers (Trial 20 / Starter 50 / Pro 150) from a search snippet (**unverified**) |
| **Zapier Copilot** | Prompt → trigger + actions outline, then configure and test each step | Choose **auto-build or ask-for-confirmation**; Zaps start as **drafts**; side-by-side diff of draft versus published before Publish | https://help.zapier.com/hc/en-us/articles/23503999825421 ; https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions (search snippets; pages not fetched: **partially unverified**) |
| **Make (Maia)** | Conversational builder places modules in the Scenario Builder | Review → approve → connect accounts → **test** before use; closed beta | https://www.make.com/en/blog/maia-conversational-ai-coworker-for-ai-agents-and-automation ; https://help.make.com/maia-by-make-system-card (search snippets: **unverified**) |
| **Microsoft Copilot Studio** | Natural language → agent-flow **plan** shown first, then the full flow built with connections and parameters | Plan review before build; confirm; open in designer; test sets and a grader library before and after publish | https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-nl (search snippet: **partially unverified**) |
| **Dify** | No first-party generator found. The ecosystem uses Agent Skills that emit importable Dify DSL YAML (e.g. a Claude Code skill) | Import-time validation by Dify | https://github.com/langgenius/dify/discussions/34916 ; https://github.com/yzmw123/dify-workflow-dsl-skill (community: **unverified as official**) |
| **Flowise** | Agentflow V2 reportedly has an AI flow generator that produces nodes and edges but not prompts | Unknown | https://docs.flowiseai.com/using-flowise/agentflowv2 ; community note (**unverified**) |

**Guardrail patterns that recur**

1. **Schema or structural validation at build time**: MS Agent Framework graph validation, Claude Code schema-contradiction check, Dify import.
2. **Show the plan before running it**: Claude Code phase list, Copilot Studio plan, Magentic plan sign-off, Zapier confirm mode.
3. **Draft/published separation with diff**: Zapier.
4. **Dry-run or test execution before activation**: n8n "Execute and refine", Make test, Copilot Studio test sets.
5. **Hard resource caps**: agents, items, iterations, budget.
6. **Credential isolation from the authoring LLM**: n8n.
7. **Provenance-aware consent**: Claude Code does not treat script-computed prompts, webhooks or scheduled prompts as user consent. Routines wrap fire text as untrusted.
8. **Cost signal**: Claude Code "Large workflow" warning and Desktop approval card with a "token-usage caution".
   - An **explicit pre-run $ estimate** was *not* found in any product researched.

---

## 6. Workflow kinds (Claude Code dynamic workflows / Codex goals) vs GeneratorAI today

GeneratorAI grounding, read from this repo:

**What already exists**
- Workflows are DAGs; the builder **rejects cycles** (Kahn's algorithm, `packages/shared/src/builders/WorkflowBuilder.ts:431-463`).
- Max 50 stages (`MAX_STAGES_PER_WORKFLOW`) and 10 concurrent stage sessions (`MAX_CONCURRENT_STAGE_SESSIONS`) (`packages/shared/src/constants/index.ts:39,45`).
- Edge types `on_success`/`on_failure`/`on_completion`/`always` with string conditions.
- `retryPolicy.maxRetries ≤ 10` with backoff.
- `resultValidation` rules (`contains`, `regex`, `json_schema`, `llm_validation`, `custom_script`…) that trigger in-session retries.
- `approvalRequired` HITL gates.
- `retryRun` creates a new run with `ancestorRunId` and copies completed stage results (`packages/core/src/services/WorkflowRunService.ts:580-640`).
- Automations with `schedule`/`webhook` triggers and a `workflow_script` data source that runs one workflow per item (`packages/shared/src/types/Automation.ts`).

**Declared but inert or partial**
- **`iterationConfig`** (`maxIterations`, `exitField`, `exitValue`, `subWorkflowDefinitionId`) is declared in the schema (`packages/shared/src/config/WorkflowScriptSchema.ts`) and persisted (`WorkflowDefinitionService.ts:270`). **No runtime code reads it**: `git grep maxIterations|exitField|subWorkflowDefinitionId` in `packages/core/src` and `apps/server/src` finds nothing outside persistence.
- **`outputSchema`** is injected into the prompt and extracted by regex from an `output.json` fenced block. Parse failures are swallowed and there is no schema check or retry (`StageExecutionService.ts:2240-2250`).
- **Budgets** exist only as the claude-agent-provider-level `maxBudgetUsd` / `maxTurns` (`AppConfig.ts:98-99`). There is no per-run or cross-harness budget.

| # | Workflow kind | Seen in | GeneratorAI today | Primitive needed |
|---|---|---|---|---|
| 1 | Static fan-out / fan-in (N fixed parallel branches → join) | CC workflow `parallel()`; MAF fan-out/fan-in | **Yes** (parallel DAG branches, 10 concurrent) | none |
| 2 | Linear multi-phase with human sign-off between phases | CC "run each stage as its own workflow"; Magentic plan review | **Yes** (`approvalRequired` HITL) | none |
| 3 | Map over a **runtime-discovered** list (one agent per file/finding) | CC `pipeline(found.files, …)`; LangGraph `Send` | **Partial**: only at automation level (one *whole run* per data-source item); nothing inside a run | A `map` stage: iterate over a JSON array from a predecessor's structured output, instantiate a per-item stage or sub-DAG, with item cap + concurrency + per-item null-on-failure |
| 4 | Per-item pipeline with **no barrier** between stages | CC `pipeline(items, s1, s2)` | **No** (DAG joins are barriers) | Per-item chains inside the map primitive (item A in stage 3 while B is in stage 1) |
| 5 | Structured output with enforced schema + retry | CC `agent({schema})` (5 retries); Codex `--output-schema` / SDK `outputSchema` | **Partial**: `outputSchema` is prompt-only, regex-extracted, silently dropped on parse failure; `resultValidation: json_schema` + retry exists separately | Enforce at the harness layer (Claude SDK structured output / Codex `outputSchema` / Copilot tool) and validate with Zod/Ajv. Retry N times with the validation error fed back; fail the stage with the last error. Unify with `resultValidation` |
| 6 | Adversarial verify (N skeptics per finding, majority vote) | CC workflow pattern; `/deep-research` voting | **No** | Map (row 3) plus a `vote`/`reduce` stage (k-of-n) and a "refute by default" verdict schema |
| 7 | Judge panel / best-of-N (N independent attempts → judge → pick or synthesize) | CC judge panel; Codex cloud `--attempts 1-4` + `apply --attempt N` | **Partial**: can hand-wire N parallel copies + a judge stage; no attempts primitive, no winner selection, no per-attempt isolation | `attempts: N` on a stage (each in its own worktree) + `select` stage (judge → winner id) + apply-winner post-processing |
| 8 | Iterate-until-pass (fix → check → fix until approved or no progress) | CC "keep fixing until `tsc` passes or 2 rounds make no progress"; ADK LoopAgent; Codex goal | **Partial / effectively no**: cycles rejected; `iterationConfig` inert; the only loop is a bounded in-stage validation retry | A **loop block** (bounded back-edge or loop container): body sub-DAG; exit on a deterministic check (script exit code / `resultValidation`) or an evaluator verdict; `maxIterations`; **no-progress detection** (N rounds without state change); iteration-indexed stage runs so history survives; feedback of the last check into the next iteration's context; terminal states `passed` / `exhausted` / `stalled` |
| 9 | Loop-until-dry (until K rounds find nothing new) | CC workflow pattern | **No** | Loop block (row 8) + run-scoped accumulator (a "seen" set with a dedup key) + dry-round counter |
| 10 | Goal mode (single agent keeps taking turns until an objective is verifiably met) | Codex `/goal`; CC `/goal` (Stop-hook evaluator) | **No** (a stage ends when its turn ends; `maxTurns` only caps) | A `goal` stage mode: objective + evaluator (fresh small-model judge like CC, or a Codex-style completion-audit prompt) + token budget + statuses `active/paused/blocked/budgetLimited/complete` + wrap-up turn on budget + anti-spin (no tool calls → stop) + blocked-after-3 rule |
| 11 | Parallel mutation with per-agent isolation (500-file migration) | CC `isolation:'worktree'`; `/batch` | **Partial**: `useWorktree` is workflow-level for project codebases, not per stage or item | Per-stage and per-item `isolation: worktree` + a merge/PR strategy (CC `/batch` opens one PR per worktree) |
| 12 | Budget-bounded exploration (loop while budget remains) | CC `budget.remaining()`; Codex `tokenBudget` | **Partial**: claude-agent `maxBudgetUsd` / `maxTurns` per session only | A run-level budget pool (tokens and $) across all harnesses, exposed to conditions; hard ceiling → stages refuse to start → run ends `budget_limited` with a summary stage |
| 13 | Resume after interruption reusing completed work | CC prefix-replay journal; Codex `resumeThread` | **Partial / Yes at stage granularity** (`retryRun` copies completed stage runs into a new run) | Sufficient for DAGs. Map and loop blocks would need item- and iteration-level result caching keyed by input hash |
| 14 | Nested / composed workflow (call a saved workflow as a step) | CC `workflow()` (one level) | **No** (`iterationConfig.subWorkflowDefinitionId` declared, never executed) | A `subworkflow` stage type with input/output mapping, a depth limit of 1–2, and shared budget and concurrency |
| 15 | Completeness critic → next round | CC pattern | **No** (needs a loop) | Loop block + a critic stage whose structured output seeds the next iteration's work list |
| 16 | Agent authors the workflow at runtime, then runs it | CC `ultracode` / script; Magentic planner; n8n / Copilot Studio builders | **Partial**: `.workflow.mjs` scripts and JSON import are Zod-validated (`WorkflowScriptOutputSchema`), so a model *could* emit them, but there is no tool for an agent to validate, dry-run, approve and run, and no authoring skill the model actually reads | An MCP/CLI tool set: `workflow.validate` (Zod + DAG + cycle + reachability; verbose errors), `workflow.dry_run` (resolve variables, show phase list, agent/stage count, estimated tokens/$), `workflow.create_draft`, `workflow.run` gated by an approval card; plus a SKILL.md using plan → validate → execute |
| 17 | Scheduled / recurring runs | Codex automations; CC `/loop`, routines | **Yes** (Automations: schedule/webhook/manual, catch-up/overlap policies) | none (could add a self-paced "until condition" schedule) |

---

## 7. Takeaways for the GeneratorAI redesign

The table points to three missing primitives. Adding them covers almost every workflow kind above:

1. **Map.** A dynamic fan-out over a structured list, which can optionally run as a per-item pipeline.
2. **Loop.** A bounded loop with an exit check, `maxIterations`, stall detection and iteration history.
3. **Goal stage.** An evaluator-gated continuation of a single session with a token budget.

A fourth piece is a prerequisite rather than a primitive. **Enforced structured output**, validated at the tool layer with retry, is what map, vote and select all depend on. The `iterationConfig` schema is a head start on the loop, but today it is dead config that the runtime never reads, and it should be finished or removed.

For agent-authored workflows, the patterns that recur in the products above are:
- a validator that returns verbose errors;
- a dry-run that shows the phase list and a cost estimate;
- an approval gate that does not treat machine-sourced prompts as consent;
- hard caps on agents, items, iterations and budget.

---

## Sources

**OpenAI / Codex**
- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- https://simonwillison.net/2026/Apr/30/codex-goals/
- https://github.com/openai/codex/releases/tag/rust-v0.128.0
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/continuation.md
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/templates/goals/budget_limit.md
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/spec.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/tool.rs
- https://github.com/openai/codex/blob/main/codex-rs/ext/goal/src/runtime.rs
- https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs
- https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoal.ts
- https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoalStatus.ts
- https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadGoalSetParams.ts
- https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json
- https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs
- https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated
- https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs
- https://github.com/openai/codex/blob/main/codex-rs/cloud-tasks/src/cli.rs
- https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- https://gist.github.com/patleeman/b1b5768393f9bf2f60865b1defeeb819 (secondary)
- https://developers.openai.com/codex/subagents , https://developers.openai.com/codex/skills , https://developers.openai.com/codex/app/automations , https://developers.openai.com/codex/changelog (redirect → learn.chatgpt.com, 403; search snippets only)
- https://github.com/openai/codex/issues/47660
- https://github.com/openclaw/openclaw/pull/115735 (secondary, Codex skill parsing)
- https://github.com/openai/openai-agents-python/blob/main/examples/agent_patterns/llm_as_a_judge.py
- https://openai.github.io/openai-agents-python/running_agents/

**Anthropic / Claude Code**
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/goal
- https://code.claude.com/docs/en/agents
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/scheduled-tasks
- https://code.claude.com/docs/en/routines
- https://code.claude.com/docs/llms.txt
- Claude Code bundled `/workflow-authoring` skill (local reference shipped with Claude Code; source of the `budget` / `workflow()` / pattern details)
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://www.anthropic.com/engineering/building-effective-agents

**Agent Skills**
- https://agentskills.io/
- https://agentskills.io/specification
- https://agentskills.io/skill-creation/using-scripts
- https://the-decoder.com/anthropic-publishes-agent-skills-as-an-open-standard-for-ai-platforms/ (secondary)
- https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard (secondary)

**Loop engines**
- https://docs.langchain.com/oss/python/langgraph/graph-api
- https://langchain-ai.github.io/langgraphjs/tutorials/plan-and-execute/plan-and-execute/
- https://mastra.ai/docs/workflows/control-flow
- https://adk.dev/agents/workflow-agents/loop-agents/
- https://docs.crewai.com/en/concepts/flows
- https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html
- https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html
- https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html
- https://docs.temporal.io/workflow-execution/continue-as-new
- https://docs.temporal.io/workflow-execution/limits
- https://www.inngest.com/docs/guides/working-with-loops
- https://www.inngest.com/docs/usage-limits/inngest (snippet)
- https://www.inngest.com/docs/features/inngest-functions/error-retries/retries (snippet)
- https://agentkit.inngest.com/concepts/networks
- https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/
- https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/builder-and-execution
- https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat
- https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches (snippet)

**Workflow builders**
- https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder
- https://help.zapier.com/hc/en-us/articles/23503999825421 (snippet)
- https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions (snippet)
- https://www.make.com/en/blog/maia-conversational-ai-coworker-for-ai-agents-and-automation (snippet)
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-nl (snippet)
- https://github.com/langgenius/dify/discussions/34916 (community)
- https://docs.flowiseai.com/using-flowise/agentflowv2 (snippet)
