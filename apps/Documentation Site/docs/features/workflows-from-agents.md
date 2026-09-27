---
description: Let chats, orchestrators, workflow stages, Claude Code, Codex and any MCP client find, run, follow and author workflows — with hard limits, delegated approvals and drafts that a person publishes.
---
# Workflows from agents

Agents can use your saved workflows and write new ones. A GeneratorAI chat, an orchestrator chat, a workflow stage, Claude Code, Codex or any MCP client gets the same **workflow tools**, with the same descriptions and the same limits. There are no slash commands and no MCP prompts: agents get tools and resources only.

## Turning the tools on

| Tool group | Tools | On for |
| --- | --- | --- |
| Workflows | list, describe, run, check a run, answer an approval, cancel | orchestrator chats by default; plain chats when you switch **Workflows** on in the chat's tools (or its agent grants it); stages whose agent grants it; never for an orchestrator's workers |
| Workflow authoring | the authoring guide, validate, plan, create a draft | agents you grant it to |

## What an agent can and cannot do

- It runs **published** workflows only. A draft never runs from an agent.
- A run never gets more permission than the chat or stage that started it.
- Runs nest at most three deep, a workflow cannot start itself, a run tree starts at most 10 nested runs, and a chat runs at most 3 at once.
- A run never outlives its caller: an orchestrator's 30-minute episode or a stage's time limit caps it.
- If the model repeats a tool call, it gets the same run back instead of a second one.
- It acts with the rights of the person or device that created the chat: running needs the "run agents" right, drafting needs "edit workflows".
- It answers a stage's completion review only when you (or it) started the run with approvals delegated to the invoker. Tool-permission prompts and every other decision always wait for a person; the chat shows an approval card with a link.

## Following a run from the chat

When a chat starts a run, a **run card** appears in the chat: status, the stage running, progress and a link to the run page. It survives a reload. A decision the run waits on shows an **approval card**; a completion review can be answered from the card. When the run finishes or parks on a decision and the chat is idle, the chat gets one short system message so the agent can check the result.

By default the run works in its **own worktrees**. An agent can ask to start it **from the chat's branch** instead; that is refused while the chat has uncommitted changes.

## Authoring: validate, plan, draft, publish

An agent that writes a workflow follows one process: inspect what exists, write the workflow document, **validate** it until there are no errors, **plan** it with realistic inputs, explain it to you (what each stage does and may change, the permission mode, whether it commits or opens a pull request), then submit it as a **draft** and give you the review link. The chat shows a **draft card** with *Open in builder* and *Publish*.

The builder shows an **agent draft** banner: who wrote it, its risk flags (writes files, commits, pushes, opens a PR, bypasses approvals, runs repository code, starts other workflows), what it changes compared with the workflow it replaces, and *Publish* / *Discard*. Only a person publishes; an operator can let agents publish with `GENERATORAI_ALLOW_AGENT_PUBLISH=true`.

## The authoring skill for Claude Code and Codex

The `generatorai-workflow-author` skill is generated from the workflow schema, the shipped templates and the providers' capabilities. The in-app guide tool, the skill directories and the MCP resources all serve the same files.

1. Pair the MCP server: `generatorai device invite --platform mcp` (add `--scopes …,write:workflows` to let it draft), then `generatorai-mcp pair <code>`.
2. Install the skill: `generatorai skill install --target claude [--project]` or `generatorai skill install --target codex`. It prints the MCP configuration to add (`claude mcp add generatorai -- generatorai-mcp serve`, or a `[mcp_servers.generatorai]` block for Codex).
3. The agent then uses the `generatorai_*` tools and the `generatorai://workflow-author/…` resources. Offline, `generatorai workflow lint <file>` and the skill's `scripts/validate.mjs` validate a document; `generatorai workflow plan <file> --var k=v` plans it; `generatorai workflow import <file> --draft` submits it.

## Source evidence

`packages/core/src/tools/workflows/`, `packages/core/src/services/WorkflowAuthoringService.ts`, `packages/core/src/services/workflow-invocation/ChatWorkflowRunBridge.ts`, `packages/core/src/services/session/PlatformToolBinder.ts`, `apps/server/src/routes/workflowTools.ts`, `apps/server/src/routes/workflowDefinitions.ts`, `packages/mcp-server/src/server.ts` and `skills/generatorai-workflow-author/`.

## Configuration and worked examples

[Workflows](../configuration/workflows.md), [Workflow runs](./workflow-runs.md), [Control flow](./workflow-control-flow.md), [Agents](./agents.md).
