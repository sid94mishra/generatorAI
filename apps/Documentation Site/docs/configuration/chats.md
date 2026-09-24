# Chats and interactions: configuration fields

Generated from `packages/shared/src/config/ChatSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## AgentModeSchema

Agent mode: `auto` or `plan`.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "auto" / "plan" | `required` | — |

## ChatSourceSpecSchema

One source to mount into a chat's workspace.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | variants by kind (object / object) | `required` | — |
| &lt;variant 1&gt; | object | `required` | unknown keys: strip |
| &lt;variant 1&gt;.kind | "codebase" | `required` | — |
| &lt;variant 1&gt;.codebaseId | string | `required` | min 1; max 200 |
| &lt;variant 1&gt;.mode | "in-place" / "worktree" | `optional` | — |
| &lt;variant 1&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 1&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 1&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 1&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |
| &lt;variant 2&gt; | object | `required` | unknown keys: strip |
| &lt;variant 2&gt;.kind | "folder" | `required` | — |
| &lt;variant 2&gt;.path | string | `required` | min 1; max 1000 |
| &lt;variant 2&gt;.mode | "in-place" / "worktree" | `optional` | — |
| &lt;variant 2&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 2&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 2&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| &lt;variant 2&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |

## UpdateChatSourcesSchema

PUT /api/chats/:id/sources — replace the mount plan of an idle chat.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| sources | array of variants by kind (object / object) | `required` | maxLength 8 |
| sources[] | variants by kind (object / object) | `required` | — |
| sources[]&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| sources[]&lt;variant 1&gt;.kind | "codebase" | `required` | — |
| sources[]&lt;variant 1&gt;.codebaseId | string | `required` | min 1; max 200 |
| sources[]&lt;variant 1&gt;.mode | "in-place" / "worktree" | `optional` | — |
| sources[]&lt;variant 1&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |
| sources[]&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| sources[]&lt;variant 2&gt;.kind | "folder" | `required` | — |
| sources[]&lt;variant 2&gt;.path | string | `required` | min 1; max 1000 |
| sources[]&lt;variant 2&gt;.mode | "in-place" / "worktree" | `optional` | — |
| sources[]&lt;variant 2&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |
| primary | string | `optional` | max 64 |

## CreateChatSchema

Zod schema for creating a Chat

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| model | string | `optional` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.systemMessage | object | `optional` | unknown keys: strip |
| harnessConfig.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| harnessConfig.systemMessage.content | string | `required` | — |
| harnessConfig.systemPromptAppend | string | `optional` | — |
| harnessConfig.streaming | boolean | `optional` | — |
| harnessConfig.mcpServers | map of object | `optional` | — |
| harnessConfig.mcpServers.{key} | object | `required` | unknown keys: strip |
| harnessConfig.mcpServers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| harnessConfig.mcpServers.{key}.url | string | `optional` | — |
| harnessConfig.mcpServers.{key}.headers | map of string | `optional` | — |
| harnessConfig.mcpServers.{key}.command | string | `optional` | — |
| harnessConfig.mcpServers.{key}.args | array of string | `optional` | — |
| harnessConfig.mcpServers.{key}.env | map of string | `optional` | — |
| harnessConfig.mcpServers.{key}.cwd | string | `optional` | — |
| harnessConfig.mcpServers.{key}.tools | array of string | `optional` | — |
| harnessConfig.mcpServers.{key}.timeoutMs | number | `optional` | int; min 0 |
| harnessConfig.mcpServers.{key}.enabled | boolean | `optional` | — |
| harnessConfig.availableTools | array of string | `optional` | maxLength 500 |
| harnessConfig.excludedTools | array of string | `optional` | maxLength 500 |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | maxLength 200 |
| harnessConfig.skillDirectories | array of string | `optional` | maxLength 100 |
| harnessConfig.disabledSkills | array of string | `optional` | maxLength 500 |
| harnessConfig.customAgents | array of object | `optional` | — |
| harnessConfig.customAgents[] | object | `required` | unknown keys: strip |
| harnessConfig.customAgents[].name | string | `required` | — |
| harnessConfig.customAgents[].description | string | `required` | — |
| harnessConfig.customAgents[].instructions | string | `required` | — |
| harnessConfig.customAgents[].tools | array of string | `optional` | — |
| harnessConfig.provider | object | `optional` | unknown keys: strip |
| harnessConfig.provider.name | string | `required` | — |
| harnessConfig.provider.baseUrl | string | `required` | url |
| harnessConfig.provider.apiKey | string | `required` | — |
| harnessConfig.provider.model | string | `optional` | — |
| harnessConfig.configDir | string | `optional` | — |
| harnessConfig.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| harnessConfig.planModeInstructions | string | `optional` | max 20000 |
| harnessConfig.agentRef | string | `optional` | max 128 |
| harnessConfig.agentOverrides | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.tools | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.tools.browser | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.widgets | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.orchestration | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.fileRead | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.shell | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.web | boolean | `optional` | — |
| harnessConfig.agentOverrides.runtime | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.runtime.model | string | `optional` | max 200 |
| harnessConfig.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfig.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfig.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| harnessConfig.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| harnessConfig.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| harnessConfig.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| harnessConfig.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| harnessConfig.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| projectId | string | `optional` | uuid |
| codebaseIds | array of string | `optional` | maxLength 5 |
| createWorktree | boolean | `optional` | — |
| useWorktree | boolean | `optional` | — |
| gitRepositories | array of object | `optional` | maxLength 3 |
| gitRepositories[] | object | `required` | unknown keys: strip |
| gitRepositories[].url | string | `required` | min 1; max 500 |
| gitRepositories[].alias | string | `required` | min 1; max 100 |
| sources | array of variants by kind (object / object) | `optional` | maxLength 8 |
| sources[] | variants by kind (object / object) | `required` | — |
| sources[]&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| sources[]&lt;variant 1&gt;.kind | "codebase" | `required` | — |
| sources[]&lt;variant 1&gt;.codebaseId | string | `required` | min 1; max 200 |
| sources[]&lt;variant 1&gt;.mode | "in-place" / "worktree" | `optional` | — |
| sources[]&lt;variant 1&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 1&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |
| sources[]&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| sources[]&lt;variant 2&gt;.kind | "folder" | `required` | — |
| sources[]&lt;variant 2&gt;.path | string | `required` | min 1; max 1000 |
| sources[]&lt;variant 2&gt;.mode | "in-place" / "worktree" | `optional` | — |
| sources[]&lt;variant 2&gt;.branch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.newBranch | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.baseRef | string | `optional` | min 1; max 200; regex /^[^\s~^:?*[\]\\]+$/ |
| sources[]&lt;variant 2&gt;.alias | string | `optional` | min 1; max 64; regex /^[A-Za-z0-9._-]+$/ |
| primary | string | `optional` | max 64 |
| tags | array of string | `default []` | maxLength 20 |
| browserConfig | object | `optional` | unknown keys: strict |
| browserConfig.enabled | boolean | `optional` | — |
| browserConfig.mode | "auto" / "native" / "screencast" | `optional` | — |
| browserConfig.visibility | "visible" / "headless" / "off" | `optional` | — |
| browserConfig.headless | boolean | `optional` | — |
| browserConfig.viewport | object | `optional` | unknown keys: strip |
| browserConfig.viewport.width | number | `required` | int; min 320; max 3840 |
| browserConfig.viewport.height | number | `required` | int; min 240; max 2160 |
| browserConfig.allowedHosts | array of string | `optional` | maxLength 100 |
| browserConfig.persistProfile | boolean | `optional` | — |
| browserConfig.screencastFps | number | `optional` | int; min 1; max 15 |
| browserConfig.screencastQuality | number | `optional` | int; min 20; max 95 |
| browserConfig.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| browserConfig.evalAllowed | boolean | `optional` | — |
| browserConfig.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| browserConfig.permissions | array of string | `optional` | maxLength 20 |
| browserConfig.piiRedaction | boolean | `optional` | — |
| browserConfig.injectionDefense | "off" / "classifier" | `optional` | — |
| browserConfig.recordVideo | boolean | `optional` | — |
| browserConfig.allowLocalhostSelfSigned | boolean | `optional` | — |
| sourceControl | unknown | `optional` | — |
| orchestratorMode | boolean | `optional` | — |
| parentChatId | string | `optional` | uuid |
| backgroundTask | object | `optional` | unknown keys: strip |
| backgroundTask.orchestratorChatId | string | `required` | uuid |
| backgroundTask.taskName | string | `required` | min 1; max 120 |
| backgroundTask.taskIndex | number | `optional` | int; min 0 |
| backgroundTask.status | "spawned" / "running" / "needs_review" / "completed" / "failed" / "cancelled" | `optional` | — |
| defaultAgentMode | "auto" / "plan" | `optional` | — |
| permissionMode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| agentRef | string | `optional` | max 128 |
| agentOverrides | object | `optional` | unknown keys: strip |
| agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| agentOverrides.tools | object | `optional` | unknown keys: strip |
| agentOverrides.tools.browser | boolean | `optional` | — |
| agentOverrides.tools.widgets | boolean | `optional` | — |
| agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| agentOverrides.tools.orchestration | boolean | `optional` | — |
| agentOverrides.tools.fileRead | boolean | `optional` | — |
| agentOverrides.tools.fileWrite | boolean | `optional` | — |
| agentOverrides.tools.shell | boolean | `optional` | — |
| agentOverrides.tools.web | boolean | `optional` | — |
| agentOverrides.runtime | object | `optional` | unknown keys: strip |
| agentOverrides.runtime.model | string | `optional` | max 200 |
| agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| agentOverrides.appendInstructions | string | `optional` | max 16000 |
| agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |

## UpdatePlanContentSchema

PUT /api/chats/:id/plans/:planId/content

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| content | string | `required` | min 1; max 500000 |
| summary | string | `optional` | max 2000 |
| expectedRevision | number | `required` | int; min 1 |

## CreatePlanCommentSchema

POST /api/chats/:id/plans/:planId/comments

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| body | string | `required` | min 1; max 10000 |
| revision | number | `required` | int; min 1 |
| anchor | object | `optional` | unknown keys: strip |
| anchor.startLine | number | `required` | int; min 0 |
| anchor.endLine | number | `required` | int; min 0 |
| anchor.quotedText | string | `required` | max 10000 |
| anchor.contentHash | string | `required` | max 128 |

## PlanDecisionSchema

POST /api/chats/:id/plans/:planId/decision

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| approved | boolean | `required` | — |
| action | "exit_only" / "implement_interactive" / "implement_autopilot" | `optional` | — |
| feedback | string | `optional` | max 50000 |
| useEditedContent | boolean | `optional` | — |
| expectedRevision | number | `optional` | int; min 1 |

## AnswerQuestionSchema

POST /api/chats/:id/interactions/:interactionId/respond

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| answers | map of array of string | `default {}` | — |
| freeformResponse | string | `optional` | max 20000 |

## SetChatPermissionModeSchema

PATCH /api/chats/:id/permission-mode

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| mode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `required` | — |

## ResolveToolPermissionSchema

POST /api/chats/:id/interactions/:interactionId/permission — answer a
tool-permission prompt raised while the chat runs in `default` /
`acceptEdits` mode.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| behavior | "allow" / "deny" | `required` | — |
| message | string | `optional` | max 2000 |

## UpdateChatSchema

PATCH /api/chats/:id — every field optional, every field validated.

`harnessConfig` goes through the same schema as chat creation so tool
allow/deny lists, MCP servers and provider overrides are never assigned
raw from the request body. Unknown keys are stripped rather than rejected
so older clients that PATCH fields the route ignores keep working.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `optional` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| model | string | `optional` | max 200 |
| tags | array of string | `optional` | maxLength 20 |
| status | "active" / "archived" | `optional` | — |
| projectId | string | `optional; null accepted` | uuid |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.systemMessage | object | `optional` | unknown keys: strip |
| harnessConfig.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| harnessConfig.systemMessage.content | string | `required` | — |
| harnessConfig.systemPromptAppend | string | `optional` | — |
| harnessConfig.streaming | boolean | `optional` | — |
| harnessConfig.mcpServers | map of object | `optional` | — |
| harnessConfig.mcpServers.{key} | object | `required` | unknown keys: strip |
| harnessConfig.mcpServers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| harnessConfig.mcpServers.{key}.url | string | `optional` | — |
| harnessConfig.mcpServers.{key}.headers | map of string | `optional` | — |
| harnessConfig.mcpServers.{key}.command | string | `optional` | — |
| harnessConfig.mcpServers.{key}.args | array of string | `optional` | — |
| harnessConfig.mcpServers.{key}.env | map of string | `optional` | — |
| harnessConfig.mcpServers.{key}.cwd | string | `optional` | — |
| harnessConfig.mcpServers.{key}.tools | array of string | `optional` | — |
| harnessConfig.mcpServers.{key}.timeoutMs | number | `optional` | int; min 0 |
| harnessConfig.mcpServers.{key}.enabled | boolean | `optional` | — |
| harnessConfig.availableTools | array of string | `optional` | maxLength 500 |
| harnessConfig.excludedTools | array of string | `optional` | maxLength 500 |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | maxLength 200 |
| harnessConfig.skillDirectories | array of string | `optional` | maxLength 100 |
| harnessConfig.disabledSkills | array of string | `optional` | maxLength 500 |
| harnessConfig.customAgents | array of object | `optional` | — |
| harnessConfig.customAgents[] | object | `required` | unknown keys: strip |
| harnessConfig.customAgents[].name | string | `required` | — |
| harnessConfig.customAgents[].description | string | `required` | — |
| harnessConfig.customAgents[].instructions | string | `required` | — |
| harnessConfig.customAgents[].tools | array of string | `optional` | — |
| harnessConfig.provider | object | `optional` | unknown keys: strip |
| harnessConfig.provider.name | string | `required` | — |
| harnessConfig.provider.baseUrl | string | `required` | url |
| harnessConfig.provider.apiKey | string | `required` | — |
| harnessConfig.provider.model | string | `optional` | — |
| harnessConfig.configDir | string | `optional` | — |
| harnessConfig.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| harnessConfig.planModeInstructions | string | `optional` | max 20000 |
| harnessConfig.agentRef | string | `optional` | max 128 |
| harnessConfig.agentOverrides | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfig.agentOverrides.tools | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.tools.browser | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.widgets | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.orchestration | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.fileRead | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.shell | boolean | `optional` | — |
| harnessConfig.agentOverrides.tools.web | boolean | `optional` | — |
| harnessConfig.agentOverrides.runtime | object | `optional` | unknown keys: strip |
| harnessConfig.agentOverrides.runtime.model | string | `optional` | max 200 |
| harnessConfig.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfig.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfig.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| harnessConfig.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| harnessConfig.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| harnessConfig.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| harnessConfig.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| harnessConfig.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| defaultAgentMode | "auto" / "plan" | `optional` | — |
| permissionMode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| agentRef | string | `optional; null accepted` | max 128 |
| agentOverrides | object | `optional; null accepted` | unknown keys: strip |
| agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| agentOverrides.tools | object | `optional` | unknown keys: strip |
| agentOverrides.tools.browser | boolean | `optional` | — |
| agentOverrides.tools.widgets | boolean | `optional` | — |
| agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| agentOverrides.tools.orchestration | boolean | `optional` | — |
| agentOverrides.tools.fileRead | boolean | `optional` | — |
| agentOverrides.tools.fileWrite | boolean | `optional` | — |
| agentOverrides.tools.shell | boolean | `optional` | — |
| agentOverrides.tools.web | boolean | `optional` | — |
| agentOverrides.runtime | object | `optional` | unknown keys: strip |
| agentOverrides.runtime.model | string | `optional` | max 200 |
| agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| agentOverrides.appendInstructions | string | `optional` | max 16000 |
| agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| orchestratorMode | boolean | `optional` | — |
| sourceControl | unknown | `optional` | — |

## StageReviewDecisionSchema

POST /api/workflow-runs/:runId/stages/:stageId/approve

`outcome` is the modern tri-state verdict. The legacy boolean `approved` is
still accepted so existing clients keep working: `true` → approved,
`false` → changes_requested (never `rejected`, which must be explicit
because it terminates the run).

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| outcome | "approved" / "changes_requested" / "rejected" | `optional` | — |
| approved | boolean | `optional` | — |
| followUpPrompt | string | `optional` | max 50000 |
| reason | string | `optional` | max 10000 |
| value | unknown | `optional` | — |

## SendChatPromptSchema

Zod schema for sending a chat prompt

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| prompt | string | `required` | min 1; max 100000 |
| attachments | array of object | `optional` | — |
| attachments[] | object | `required` | unknown keys: strip |
| attachments[].type | "file" | `required` | — |
| attachments[].path | string | `required` | — |
| attachments[].displayName | string | `optional` | — |
| mode | "auto" / "plan" | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete ChatSchemas.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// Chat Zod validation schemas
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../types/ProviderConfig.js';
import { BrowserConfigSchema } from './BrowserConfigSchema.js';
import { McpServerConfigSchema, AgentOverridesSchema } from './AgentSchemas.js';
import { AGENT_MODES, type AgentMode } from '../types/AgentMode.js';

/** Agent mode: `auto` or `plan`. */
export const AgentModeSchema = z.enum(AGENT_MODES as [AgentMode, ...AgentMode[]]);

/** Agent harness configuration — provider-agnostic settings for LLM sessions */
const AgentHarnessConfigSchema = z.object({
  model: z.string().optional(),
  systemMessage: z.object({
    mode: z.enum(['append', 'replace']).default('append'),
    content: z.string(),
  }).optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().optional(),
  mcpServers: z.record(McpServerConfigSchema).optional(),
  // Bounded: these lists reach the harness verbatim, so an unbounded array
  // from a `write:chats` holder would be a free denial-of-service lever.
  availableTools: z.array(z.string().max(200)).max(500).optional(),
  excludedTools: z.array(z.string().max(200)).max(500).optional(),
  excludedMcpServerIds: z.array(z.string().max(200)).max(200).optional(),
  skillDirectories: z.array(z.string().max(1000)).max(100).optional(),
  disabledSkills: z.array(z.string().max(200)).max(500).optional(),
  customAgents: z.array(z.object({
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  provider: z.object({
    name: z.string(),
    baseUrl: z.string().url(),
    apiKey: z.string(),
    model: z.string().optional(),
  }).optional(),
  configDir: z.string().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  /**
   * Agent provider for this chat. Omit to route by `model`, falling back to
   * the server's primary provider.
   */
  harnessType: z.enum(HARNESS_PROVIDER_IDS).optional(),
  contextTier: z.enum(['default', 'long_context']).optional(),
  maxTurns: z.number().int().min(1).optional(),
  /**
   * Permission policy for this chat's tool calls. Defaults to
   * `bypassPermissions` — which preserves today's fully-autonomous behaviour.
   * Plan mode forces `plan` for the duration of a planning turn.
   */
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  /**
   * Claude-native: replaces the default plan-mode workflow body in the
   * plan-mode system reminder. Copilot approximates this via the system message.
   */
  planModeInstructions: z.string().max(20_000).optional(),
  /** Portable `scope:slug` ref of the agent driving this scope. */
  agentRef: z.string().max(128).optional(),
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides: AgentOverridesSchema.optional(),
}).partial();

const branchName = z.string().min(1).max(200).regex(/^[^\s~^:?*[\]\\]+$/, 'Invalid git ref name');

const sourceCommon = {
  mode: z.enum(['in-place', 'worktree']).optional(),
  branch: branchName.optional(),
  newBranch: branchName.optional(),
  baseRef: branchName.optional(),
  alias: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'Alias may contain letters, digits, . _ -').optional(),
};

/** One source to mount into a chat's workspace. */
export const ChatSourceSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('codebase'), codebaseId: z.string().min(1).max(200), ...sourceCommon }),
  z.object({ kind: z.literal('folder'), path: z.string().min(1).max(1000), ...sourceCommon }),
]);

/** PUT /api/chats/:id/sources — replace the mount plan of an idle chat. */
export const UpdateChatSourcesSchema = z.object({
  sources: z.array(ChatSourceSpecSchema).max(8),
  primary: z.string().max(64).optional(),
});

/**
 * Agent-native source control on a chat (commit / push / open a PR after a
 * turn). Deliberately lenient here — the chats route owns the shape checks,
 * the upward normalisation of the three flags and the error messages, so all
 * this has to do is stop Zod's unknown-key stripping from dropping the field
 * on its way to the route handler.
 */
const ChatSourceControlInputSchema = z.unknown().optional();

/** Zod schema for creating a Chat */
export const CreateChatSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  model: z.string().optional(),
  /** Agent harness configuration (provider-agnostic — works with copilot, claude-agent, etc.) */
  harnessConfig: AgentHarnessConfigSchema.optional(),
  /** Project ID — scopes this chat to a project and its codebases */
  projectId: z.string().uuid().optional(),
  /** Codebase IDs from the project to link to this chat */
  codebaseIds: z.array(z.string().uuid()).max(5).optional(),
  /** Whether to create a worktree for code changes (optional — user chooses) */
  createWorktree: z.boolean().optional(),
  /** Whether to use a worktree (alias for createWorktree, used by workspace management) */
  useWorktree: z.boolean().optional(),
  /** Local folder paths to use as working directory */
  gitRepositories: z.array(z.object({
    url: z.string().min(1).max(500),
    // Required to match ChatLocalFolder — downstream services key codebases by
    // `alias`, so an omitted alias would surface as `undefined` at runtime.
    alias: z.string().min(1).max(100),
  })).max(3).optional(),
  /**
   * What the agent works on. Each entry is a project codebase or a local
   * folder, mounted in place or as a worktree, optionally on a branch.
   * Supersedes `codebaseIds` + `createWorktree` + `gitRepositories`, which
   * are still accepted and mapped onto sources.
   */
  sources: z.array(ChatSourceSpecSchema).max(8).optional(),
  /** Alias of the primary mount (the agent's cwd). Defaults to the first source. */
  primary: z.string().max(64).optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  /**
   * Integrated Browser configuration (v13). When `enabled: true`, chat
   * creation auto-boots a per-workspace Chromium and appends CDP endpoint
   * details to the harness system prompt so the `playwright-cli` skill can
   * attach.
   */
  browserConfig: BrowserConfigSchema.optional(),
  /** Agent-native source control for this chat (validated in the route). */
  sourceControl: ChatSourceControlInputSchema,
  /**
   * Orchestrator mode — when true, this chat runs the orchestrator system
   * prompt and gets the background-agent tool set. The UI restricts this to
   * powerful models; the server injects the prompt + tools on create.
   */
  orchestratorMode: z.boolean().optional(),
  /** Set on WORKER chats spawned by an orchestrator: the parent chat id. */
  parentChatId: z.string().uuid().optional(),
  /** Set on WORKER chats: background-task metadata. */
  backgroundTask: z.object({
    orchestratorChatId: z.string().uuid(),
    taskName: z.string().min(1).max(120),
    taskIndex: z.number().int().min(0).optional(),
    status: z.enum(['spawned', 'running', 'needs_review', 'completed', 'failed', 'cancelled']).optional(),
  }).optional(),
  /** Sticky per-chat default agent mode; overridable per turn from the composer. */
  defaultAgentMode: AgentModeSchema.optional(),
  /** Chat-scoped permission policy (defaults to `bypassPermissions`). */
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  /** Portable `scope:slug` ref of the agent that should drive this chat. */
  agentRef: z.string().max(128).optional(),
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides: AgentOverridesSchema.optional(),
});

// ────────────────────────────────────────────────────────────────
// Plan mode request schemas
// ────────────────────────────────────────────────────────────────

/** PUT /api/chats/:id/plans/:planId/content */
export const UpdatePlanContentSchema = z.object({
  content: z.string().min(1).max(500_000),
  summary: z.string().max(2000).optional(),
  /** Optimistic concurrency — rejects with 409 when the plan moved on. */
  expectedRevision: z.number().int().min(1),
});

/** POST /api/chats/:id/plans/:planId/comments */
export const CreatePlanCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  revision: z.number().int().min(1),
  anchor: z
    .object({
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
      quotedText: z.string().max(10_000),
      contentHash: z.string().max(128),
    })
    .optional(),
});

/** POST /api/chats/:id/plans/:planId/decision */
export const PlanDecisionSchema = z.object({
  approved: z.boolean(),
  action: z.enum(['exit_only', 'implement_interactive', 'implement_autopilot']).optional(),
  feedback: z.string().max(50_000).optional(),
  /** Use the latest user-edited revision as the approved content. */
  useEditedContent: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

/** POST /api/chats/:id/interactions/:interactionId/respond */
export const AnswerQuestionSchema = z.object({
  answers: z.record(z.array(z.string().max(4000))).default({}),
  freeformResponse: z.string().max(20_000).optional(),
});

/** PATCH /api/chats/:id/permission-mode */
export const SetChatPermissionModeSchema = z.object({
  mode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']),
});

/**
 * POST /api/chats/:id/interactions/:interactionId/permission — answer a
 * tool-permission prompt raised while the chat runs in `default` /
 * `acceptEdits` mode.
 */
export const ResolveToolPermissionSchema = z.object({
  behavior: z.enum(['allow', 'deny']),
  /** Relayed to the agent as the denial reason. */
  message: z.string().max(2000).optional(),
});

/**
 * PATCH /api/chats/:id — every field optional, every field validated.
 *
 * `harnessConfig` goes through the same schema as chat creation so tool
 * allow/deny lists, MCP servers and provider overrides are never assigned
 * raw from the request body. Unknown keys are stripped rather than rejected
 * so older clients that PATCH fields the route ignores keep working.
 */
export const UpdateChatSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  model: z.string().max(200).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  status: z.enum(['active', 'archived']).optional(),
  projectId: z.string().uuid().nullable().optional(),
  harnessConfig: AgentHarnessConfigSchema.optional(),
  defaultAgentMode: AgentModeSchema.optional(),
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  agentRef: z.string().max(128).nullable().optional(),
  agentOverrides: AgentOverridesSchema.nullable().optional(),
  orchestratorMode: z.boolean().optional(),
  /** Agent-native source control for this chat (validated in the route). */
  sourceControl: ChatSourceControlInputSchema,
});

/**
 * POST /api/workflow-runs/:runId/stages/:stageId/approve
 *
 * `outcome` is the modern tri-state verdict. The legacy boolean `approved` is
 * still accepted so existing clients keep working: `true` → approved,
 * `false` → changes_requested (never `rejected`, which must be explicit
 * because it terminates the run).
 */
export const StageReviewDecisionSchema = z.object({
  outcome: z.enum(['approved', 'changes_requested', 'rejected']).optional(),
  approved: z.boolean().optional(),
  /** Free-text change request sent to the agent as a follow-up prompt. */
  followUpPrompt: z.string().max(50_000).optional(),
  /** Why the stage was rejected — surfaced on the failed stage. */
  reason: z.string().max(10_000).optional(),
  value: z.unknown().optional(),
});

/** Zod schema for sending a chat prompt */
export const SendChatPromptSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  attachments: z.array(z.object({
    type: z.literal('file'),
    path: z.string(),
    displayName: z.string().optional(),
  })).optional(),
  /**
   * Per-turn agent mode. Omit to fall back to the chat's `defaultAgentMode`,
   * then to {@link DEFAULT_AGENT_MODE}.
   */
  mode: AgentModeSchema.optional(),
});
```

</details>
