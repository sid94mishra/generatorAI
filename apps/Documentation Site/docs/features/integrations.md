---
description: Configure skills, prompts, MCP servers, and workflow templates at system and project scope.
---
# Skills and integrations

GeneratorAI catalogs reusable instructions and tool connections so a chat or workflow can select them explicitly. A skill, prompt, agent, MCP server, and workflow template solve different problems; enabling one does not automatically provide all the others.

| Resource | Purpose | Main surfaces |
| --- | --- | --- |
| Skill | Instructions and optional supporting files for a repeatable task | Settings → Skills; Project Customization; composer and workflow selectors |
| Prompt | Reusable prompt text | Project Customization; composer slash menu |
| Agent | Instructions plus capabilities/runtime/team policy | Agents; agent pickers; legacy project artifacts |
| MCP server | Registered tool server connection | Settings → MCP Servers; Project Customization; agent/workflow selectors |
| Template | Starting definition for a workflow | Settings → Templates; workflow creation and stage template selection |

## Skills and prompts

In **Settings → Skills**, search built-in entries, expand their descriptions, preview full details, and enable or disable their appearance in pickers. This preference controls what the client offers; it should not be interpreted as a host-wide revocation of a tool permission.

For project-specific material, open **Project → Project Customization**. Upload a skill folder with its entry instructions and supporting files, or upload a prompt/config artifact. The project page offers content inspection, supported editing, and deletion. System and project source badges explain where an item comes from.

In a chat, type `/` to browse commands. A skill command names the chosen skill and appends your task. A prompt command loads the template body and appends your additional details. Selecting a skill in an agent or workflow binds reusable instructions to that execution path; it is different from mentioning a similarly named external file in plain text.

## MCP servers

Use **Settings → MCP Servers** for system/custom registered servers. Add or configure a server, supply required inputs and credentials, and check its enabled and configuration state. Agent and stage selectors use these registered IDs rather than arbitrary inline definitions.

| Transport | Configuration |
| --- | --- |
| HTTP | Server URL and configured headers |
| SSE | Registered event-stream transport where supported by the selected path/provider |
| STDIO | Host command, arguments, and environment for a local process |

The shared server contract recognizes HTTP, SSE, and STDIO. The current project creation form exposes HTTP and STDIO choices. A command such as `npx` runs on the GeneratorAI server host and must be available there.

Bundled servers can declare required non-secret inputs such as a directory path or URL, and separate credential fields. Effective enablement combines the user's toggle with configuration completeness. A checked toggle on an incompletely configured entry does not make it ready for a harness.

Credential values are stored separately and redacted in ordinary API responses; UI responses expose presence and required names. An exported agent reference is not a credential export. Configure the destination host's secrets rather than copying redaction markers as values.

## Templates

Open **Settings → Templates** to inspect available workflow templates and create a definition from one. A template is a starting point, not an already executed or guaranteed-correct workflow. Review project sources, model/provider choices, variables, hooks, approval gates, and post-processing before running the derived definition.

The stage editor can also select templates. A stage template contributes stage configuration; the workflow's graph, sources, and run-level policy still matter.

## Resolve missing resources

Check the selected project, catalog enablement, agent binding, server readiness, and required credentials. A provider may not support a configured runtime field or tool shape; inspect the agent's effective capabilities and warnings. Avoid interpreting “present in Settings” as “included in every turn.”

For hot-loaded executable packages and interactive components, see [Extensions and widgets](./extensions.md). For provider authentication and client-specific settings, see [Settings reference](../clients/settings.md).

## Source evidence

`apps/web/src/components/settings/sections/Catalogs.tsx`, `apps/web/src/pages/ProjectDetailPage.tsx`, `apps/web/src/components/chat/composer/builtins.ts`, `apps/web/src/components/workflow/SkillSelector.tsx`, `apps/web/src/components/workflow/McpServerSelector.tsx`, `packages/shared/src/types/Project.ts`, and `packages/shared/src/config/McpSchemas.ts`.

## Configuration and worked examples

[Mcp](../configuration/mcp.md), [Agents](../configuration/agents.md), [Templates](../configuration/templates.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
