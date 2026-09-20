---
description: Build reusable agents with instructions, explicit capabilities, runtime defaults, and orchestrator teams.
---
# Agents and teams

An agent bundles instructions, selected skills and MCP servers, tool capabilities, and runtime defaults. Bind it to a chat, workflow stage, or orchestrator worker rather than repeatedly copying its instructions into prompts.

## Scope and identity

| Scope | Meaning |
| --- | --- |
| System | Built-in agent; shown as read-only in the editor |
| Global | User-authored agent available across projects |
| Project | Agent belonging to one project |

Agents have a portable `scope:slug` reference, such as `global:code-reviewer`. The display name is user-facing; the slug is a stable binding identifier. A description is required and acts as a routing signal when another agent delegates work. Instructions describe how the agent should perform its job.

## Create or edit an agent

1. Open **Agents → New Agent**.
2. Set identity, description, scope, project where required, tags, and enabled state.
3. Write instructions. Choose whether to add to the default prompt or replace its base instructions. Platform tool instructions remain available in replacement mode.
4. Choose Agent or Orchestrator role.
5. Select skills and vetted MCP servers, then configure capabilities.
6. Set runtime defaults only where this agent needs an explicit policy.
7. Inspect **Effective capabilities** and resolution warnings before saving and binding the agent.

The instruction body has a 32 KiB hard limit and an 8 KiB warning threshold in the shared contract. Large instructions consume context on repeated turns.

## Capabilities and runtime

Tool groups include browser, widgets, extension authoring, orchestration, file read, file write, shell, and web access. A persisted group can be On, Off, or inherited. Disabling a group is a policy decision, not a request for the model to voluntarily avoid it.

Extension authoring is off by default because it writes and hot-loads executable extensions. Orchestration is enabled for orchestrator agents. Selected MCP servers must come from the vetted registry; an agent definition does not accept arbitrary inline server configurations.

Runtime settings include provider, model, reasoning effort, context tier, maximum turns, permission mode, and default agent mode. Empty fields inherit from the binding site or server defaults. Provider support differs; the editor and resolver can report unsupported fields, missing skills, disabled servers, incomplete credentials, and unavailable team agents.

## Orchestrator teams

An orchestrator can delegate to selected enabled agents. Its **Team** section sets eligible agent references, a worker limit, and optional default worker model. An empty team list allows enabled non-orchestrator agents according to the resolver's rules. Workers remain visible in the parent chat's **Background Tasks** surface.

Define narrow descriptions so delegation has a clear target: implementation, test design, documentation, or review. Keep worker permission and tool policies appropriate to their role. A worker being complete does not by itself prove that the overall user's acceptance criteria have been met.

## Bindings and portability

Chat and stage bindings can apply overrides: add/remove skills or MCP servers, adjust tool/runtime policy, append instructions, and allow/deny named tools. Capability lists combine with removal/denial taking precedence. The central resolver computes the effective projection and emits warnings.

Agent records are versioned on mutation, and source-synchronized agents can identify a `.agent.md` path. The catalog supports import/export for portability. An exported definition does not export secrets from an MCP credential store; its referenced catalog items must exist on the destination host.

## Source evidence

`apps/web/src/pages/AgentsListPage.tsx`, `apps/web/src/pages/AgentEditorPage.tsx`, `apps/web/src/components/agents`, `packages/shared/src/types/Agent.ts`, `packages/shared/src/config/AgentSchemas.ts`, and the agent-resolution services under `packages/core/src`.

## Configuration and worked examples

[Agents](../configuration/agents.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
