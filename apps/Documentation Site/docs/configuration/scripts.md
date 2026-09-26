# Definition records, templates and script profiles: configuration fields

Generated from `packages/workflow-spec/src/definition.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## SaveGraphRequestSchema

`PUT /workflow-definitions/:id/graph`. The graph is validated separately.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| graph | unknown | `optional` | — |
| expectedRevision | number | `required` | int; min 1 |

## ImportTemplateRequestSchema

`POST /workflow-definitions` and `POST /workflow-definitions/import` with a template.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| templateId | string | `required` | min 1; max 100 |
| name | string | `optional` | min 1; max 200 |
| projectId | string | `optional; null accepted` | uuid |

## WorkflowTemplateSchema

A template file (`templates/system/*.json`): an id, a category and a graph.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | regex /^[a-z0-9][a-z0-9-]{0,63}$/ |
| category | "system" / "code-generation" / "code-review" / "testing" / "e2e-testing" / "refactoring" / "documentation" / "deployment" / "custom" | `required` | — |
| graph | object | `required` | unknown keys: strict |
| graph.formatVersion | 2 | `required` | — |
| graph.workflow | object | `required` | unknown keys: strict |
| graph.workflow.name | string | `required` | min 1; max 200 |
| graph.workflow.description | string | `optional` | max 2000 |
| graph.workflow.session | object | `default {}` | unknown keys: strict |
| graph.workflow.session.model | string | `optional` | max 200 |
| graph.workflow.session.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| graph.workflow.session.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| graph.workflow.session.contextTier | "default" / "long_context" | `optional` | — |
| graph.workflow.session.maxTurns | number | `optional` | int; min 1; max 1000 |
| graph.workflow.session.provider | object | `optional` | unknown keys: strict |
| graph.workflow.session.provider.name | string | `required` | min 1; max 100 |
| graph.workflow.session.provider.baseUrl | string | `required` | url; max 2000 |
| graph.workflow.session.provider.apiKey | string | `required` | min 1; max 500 |
| graph.workflow.session.provider.model | string | `optional` | max 200 |
| graph.workflow.session.agentRef | string | `optional` | min 1; max 128 |
| graph.workflow.session.agentOverrides | object | `optional` | unknown keys: strict |
| graph.workflow.session.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| graph.workflow.session.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| graph.workflow.session.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| graph.workflow.session.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| graph.workflow.session.agentOverrides.tools | object | `optional` | unknown keys: strict |
| graph.workflow.session.agentOverrides.tools.browser | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.widgets | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.orchestration | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.fileRead | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.shell | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.tools.web | boolean | `optional` | — |
| graph.workflow.session.agentOverrides.runtime | object | `optional` | unknown keys: strict |
| graph.workflow.session.agentOverrides.runtime.model | string | `optional` | max 200 |
| graph.workflow.session.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| graph.workflow.session.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| graph.workflow.session.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| graph.workflow.session.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| graph.workflow.session.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| graph.workflow.session.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| graph.workflow.session.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| graph.workflow.session.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| graph.workflow.session.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| graph.workflow.session.systemMessage | object | `optional` | unknown keys: strict |
| graph.workflow.session.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| graph.workflow.session.systemMessage.content | string | `required` | max 100000 |
| graph.workflow.session.systemPromptAppend | string | `optional` | max 100000 |
| graph.workflow.session.planModeInstructions | string | `optional` | max 20000 |
| graph.workflow.session.tools | object | `optional` | unknown keys: strict |
| graph.workflow.session.tools.available | array of string | `optional` | maxLength 500 |
| graph.workflow.session.tools.excluded | array of string | `optional` | maxLength 500 |
| graph.workflow.session.mcp | object | `optional` | unknown keys: strict |
| graph.workflow.session.mcp.servers | map of object | `optional` | — |
| graph.workflow.session.mcp.servers.{key} | object | `required` | unknown keys: strict |
| graph.workflow.session.mcp.servers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| graph.workflow.session.mcp.servers.{key}.url | string | `optional` | max 2000 |
| graph.workflow.session.mcp.servers.{key}.headers | map of string | `optional` | — |
| graph.workflow.session.mcp.servers.{key}.command | string | `optional` | max 1000 |
| graph.workflow.session.mcp.servers.{key}.args | array of string | `optional` | maxLength 64 |
| graph.workflow.session.mcp.servers.{key}.env | map of string | `optional` | — |
| graph.workflow.session.mcp.servers.{key}.cwd | string | `optional` | max 1000 |
| graph.workflow.session.mcp.servers.{key}.tools | array of string | `optional` | maxLength 500 |
| graph.workflow.session.mcp.servers.{key}.timeoutMs | number | `optional` | int; min 0; max 600000 |
| graph.workflow.session.mcp.servers.{key}.enabled | boolean | `optional` | — |
| graph.workflow.session.mcp.excludedIds | array of string | `optional` | maxLength 200 |
| graph.workflow.session.skills | object | `optional` | unknown keys: strict |
| graph.workflow.session.skills.directories | array of string | `optional` | maxLength 100 |
| graph.workflow.session.skills.disabled | array of string | `optional` | maxLength 500 |
| graph.workflow.session.customAgents | array of object | `optional` | maxLength 50 |
| graph.workflow.session.customAgents[] | object | `required` | unknown keys: strict |
| graph.workflow.session.customAgents[].name | string | `required` | min 1; max 120 |
| graph.workflow.session.customAgents[].description | string | `required` | min 1; max 2000 |
| graph.workflow.session.customAgents[].instructions | string | `required` | min 1; max 64000 |
| graph.workflow.session.customAgents[].tools | array of string | `optional` | maxLength 200 |
| graph.workflow.session.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| graph.workflow.session.defaultAgentMode | "auto" / "plan" | `optional` | — |
| graph.workflow.session.browser | object | `optional` | unknown keys: strict |
| graph.workflow.session.browser.enabled | boolean | `optional` | — |
| graph.workflow.session.browser.mode | "auto" / "native" / "screencast" | `optional` | — |
| graph.workflow.session.browser.visibility | "visible" / "headless" / "off" | `optional` | — |
| graph.workflow.session.browser.headless | boolean | `optional` | — |
| graph.workflow.session.browser.viewport | object | `optional` | unknown keys: strict |
| graph.workflow.session.browser.viewport.width | number | `required` | int; min 320; max 3840 |
| graph.workflow.session.browser.viewport.height | number | `required` | int; min 240; max 2160 |
| graph.workflow.session.browser.allowedHosts | array of string | `optional` | maxLength 100 |
| graph.workflow.session.browser.persistProfile | boolean | `optional` | — |
| graph.workflow.session.browser.screencastFps | number | `optional` | int; min 1; max 15 |
| graph.workflow.session.browser.screencastQuality | number | `optional` | int; min 20; max 95 |
| graph.workflow.session.browser.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| graph.workflow.session.browser.evalAllowed | boolean | `optional` | — |
| graph.workflow.session.browser.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| graph.workflow.session.browser.permissions | array of string | `optional` | maxLength 20 |
| graph.workflow.session.browser.piiRedaction | boolean | `optional` | — |
| graph.workflow.session.browser.injectionDefense | "off" / "classifier" | `optional` | — |
| graph.workflow.session.browser.recordVideo | boolean | `optional` | — |
| graph.workflow.session.browser.allowLocalhostSelfSigned | boolean | `optional` | — |
| graph.workflow.session.computerUse | boolean | `optional` | — |
| graph.workflow.session.widgets | boolean | `optional` | — |
| graph.workflow.session.orchestrator | boolean | `optional` | — |
| graph.workflow.variables | array of object | `default []` | maxLength 50 |
| graph.workflow.variables[] | object | `required` | unknown keys: strict; refinement |
| graph.workflow.variables[].name | string | `required` | min 1; max 64; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| graph.workflow.variables[].type | "string" / "number" / "boolean" / "choice" / "text" / "list" / "json" | `required` | — |
| graph.workflow.variables[].label | string | `required` | min 1; max 200 |
| graph.workflow.variables[].description | string | `optional` | max 2000 |
| graph.workflow.variables[].required | boolean | `default false` | — |
| graph.workflow.variables[].defaultValue | unknown | `optional` | — |
| graph.workflow.variables[].options | array of string | `optional` | maxLength 100 |
| graph.workflow.hooks | array of object | `default []` | maxLength 50 |
| graph.workflow.hooks[] | object | `required` | unknown keys: strict; refinement |
| graph.workflow.hooks[].id | string | `required` | min 1; max 100 |
| graph.workflow.hooks[].name | string | `required` | min 1; max 200 |
| graph.workflow.hooks[].type | "script" / "http" / "function" | `required` | — |
| graph.workflow.hooks[].priority | number | `default 0` | int; min -1000; max 1000 |
| graph.workflow.hooks[].enabled | boolean | `default true` | — |
| graph.workflow.hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| graph.workflow.hooks[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.workflow.hooks[].retries | number | `default 0` | int; min 0; max 5 |
| graph.workflow.hooks[].config | variants by type (object / object / object) | `required` | refinement |
| graph.workflow.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| graph.workflow.hooks[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| graph.workflow.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| graph.workflow.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| graph.workflow.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| graph.workflow.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| graph.workflow.hooks[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| graph.workflow.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| graph.workflow.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| graph.workflow.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| graph.workflow.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| graph.workflow.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| graph.workflow.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| graph.workflow.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| graph.workflow.hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| graph.workflow.onExit | array of object | `optional` | maxLength 20 |
| graph.workflow.onExit[] | object | `required` | unknown keys: strict |
| graph.workflow.onExit[].name | string | `required` | min 1; max 200 |
| graph.workflow.onExit[].config | variants by type (object / object / object) | `required` | refinement |
| graph.workflow.onExit[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onExit[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| graph.workflow.onExit[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| graph.workflow.onExit[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| graph.workflow.onExit[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| graph.workflow.onExit[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| graph.workflow.onExit[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onExit[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| graph.workflow.onExit[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| graph.workflow.onExit[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| graph.workflow.onExit[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| graph.workflow.onExit[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| graph.workflow.onExit[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onExit[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| graph.workflow.onExit[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| graph.workflow.onExit[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| graph.workflow.onExit[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| graph.workflow.onExit[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.workflow.onExit[].retries | number | `default 0` | int; min 0; max 5 |
| graph.workflow.onFailure | array of object | `optional` | maxLength 20 |
| graph.workflow.onFailure[] | object | `required` | unknown keys: strict |
| graph.workflow.onFailure[].name | string | `required` | min 1; max 200 |
| graph.workflow.onFailure[].config | variants by type (object / object / object) | `required` | refinement |
| graph.workflow.onFailure[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onFailure[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| graph.workflow.onFailure[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| graph.workflow.onFailure[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| graph.workflow.onFailure[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| graph.workflow.onFailure[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| graph.workflow.onFailure[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onFailure[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| graph.workflow.onFailure[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| graph.workflow.onFailure[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| graph.workflow.onFailure[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| graph.workflow.onFailure[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| graph.workflow.onFailure[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.onFailure[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| graph.workflow.onFailure[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| graph.workflow.onFailure[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| graph.workflow.onFailure[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| graph.workflow.onFailure[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.workflow.onFailure[].retries | number | `default 0` | int; min 0; max 5 |
| graph.workflow.lifecycle | object | `default {}` | unknown keys: strict |
| graph.workflow.lifecycle.codebaseAliases | array of string | `default []` | maxLength 5 |
| graph.workflow.lifecycle.useWorktree | boolean | `default true` | — |
| graph.workflow.lifecycle.requiresCodebase | boolean | `default false` | — |
| graph.workflow.lifecycle.sandbox | "required" / "optional" | `default "required"` | — |
| graph.workflow.lifecycle.preprocessingSteps | array of object | `default []` | maxLength 50 |
| graph.workflow.lifecycle.preprocessingSteps[] | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].name | string | `required` | min 1; max 200 |
| graph.workflow.lifecycle.preprocessingSteps[].failOnError | boolean | `default true` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config | variants by type (object / object / object / object / object) | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt;.type | "clone_repo" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt;.repoAlias | string | `required` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.type | "run_script" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.script | string | `required` | min 1; max 20000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.cwd | string | `optional` | max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.timeoutMs | number | `optional` | int; min 1000; max 3600000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.type | "validate_input" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.variableName | string | `required` | min 1; max 64 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules | array of variants by type (object / object / object / object) | `required` | minLength 1; maxLength 20 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[] | variants by type (object / object / object / object) | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt;.type | "required" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt;.message | string | `required` | min 1; max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.type | "regex" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.pattern | string | `required` | min 1; max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.flags | string | `optional` | regex /^[ims]{0,3}$/ |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.message | string | `required` | min 1; max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.type | "min_length" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.value | number | `required` | int; min 0; max 1000000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.message | string | `required` | min 1; max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.type | "max_length" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.value | number | `required` | int; min 0; max 1000000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.message | string | `required` | min 1; max 1000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.type | "set_variable" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.variableName | string | `required` | min 1; max 64 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.value | string | `required` | max 100000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.type | "conditional" | `required` | — |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.condition | string | `required` | min 1; max 2000 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.thenSteps | array of lazy | `required` | maxLength 20 |
| graph.workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.elseSteps | array of lazy | `optional` | maxLength 20 |
| graph.workflow.lifecycle.postProcessing | object | `default {}` | unknown keys: strict |
| graph.workflow.lifecycle.postProcessing.autoCommit | boolean | `default false` | — |
| graph.workflow.lifecycle.postProcessing.autoPush | boolean | `default false` | — |
| graph.workflow.lifecycle.postProcessing.autoCreatePR | boolean | `default false` | — |
| graph.workflow.lifecycle.postProcessing.steps | array of object | `default []` | maxLength 50 |
| graph.workflow.lifecycle.postProcessing.steps[] | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.postProcessing.steps[].name | string | `required` | min 1; max 200 |
| graph.workflow.lifecycle.postProcessing.steps[].failOnError | boolean | `default true` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config | variants by type (object / object / object) | `required` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.type | "commit_and_push" | `required` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.repoAlias | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.commitMessage | string | `required` | min 1; max 100000 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.push | boolean | `optional` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.generateMessage | boolean | `optional` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.baseBranch | string | `optional` | max 200 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.type | "create_pr" | `required` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.repoAlias | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.title | string | `required` | min 1; max 100000 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.body | string | `required` | max 100000 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.baseBranch | string | `optional` | max 200 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.generateText | boolean | `optional` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.draft | boolean | `optional` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.type | "run_script" | `required` | — |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.script | string | `required` | min 1; max 20000 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.cwd | string | `optional` | max 1000 |
| graph.workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.timeoutMs | number | `optional` | int; min 1000; max 3600000 |
| graph.workflow.budget | object | `optional` | unknown keys: strict |
| graph.workflow.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| graph.workflow.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| graph.workflow.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| graph.workflow.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| graph.workflow.maxParallel | number | `optional` | int; min 1; max 32 |
| graph.workflow.outputs | map of string | `optional` | — |
| graph.workflow.tags | array of string | `default []` | maxLength 20 |
| graph.workflow.projectId | string | `optional; null accepted` | uuid |
| graph.stages | array of variants by kind (object / object / object / object / object / object) | `required` | maxLength 100 |
| graph.stages[] | variants by kind (object / object / object / object / object / object) | `required` | — |
| graph.stages[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 1&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 1&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 1&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 1&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 1&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 1&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 1&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 1&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 1&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 1&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 1&gt;.kind | "agent" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.prompts | array of object | `default []` | maxLength 50 |
| graph.stages[]&lt;variant 1&gt;.prompts[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.prompts[].label | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.prompts[].text | string | `required` | min 1; max 100000 |
| graph.stages[]&lt;variant 1&gt;.followUpPrompts | array of object | `optional` | maxLength 50 |
| graph.stages[]&lt;variant 1&gt;.followUpPrompts[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.followUpPrompts[].label | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.followUpPrompts[].text | string | `required` | min 1; max 100000 |
| graph.stages[]&lt;variant 1&gt;.session | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.model | string | `optional` | max 200 |
| graph.stages[]&lt;variant 1&gt;.session.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.contextTier | "default" / "long_context" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.maxTurns | number | `optional` | int; min 1; max 1000 |
| graph.stages[]&lt;variant 1&gt;.session.provider | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.provider.name | string | `required` | min 1; max 100 |
| graph.stages[]&lt;variant 1&gt;.session.provider.baseUrl | string | `required` | url; max 2000 |
| graph.stages[]&lt;variant 1&gt;.session.provider.apiKey | string | `required` | min 1; max 500 |
| graph.stages[]&lt;variant 1&gt;.session.provider.model | string | `optional` | max 200 |
| graph.stages[]&lt;variant 1&gt;.session.agentRef | string | `optional` | min 1; max 128 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.browser | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.widgets | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.orchestration | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.fileRead | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.shell | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.tools.web | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.model | string | `optional` | max 200 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| graph.stages[]&lt;variant 1&gt;.session.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| graph.stages[]&lt;variant 1&gt;.session.systemMessage | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| graph.stages[]&lt;variant 1&gt;.session.systemMessage.content | string | `required` | max 100000 |
| graph.stages[]&lt;variant 1&gt;.session.systemPromptAppend | string | `optional` | max 100000 |
| graph.stages[]&lt;variant 1&gt;.session.planModeInstructions | string | `optional` | max 20000 |
| graph.stages[]&lt;variant 1&gt;.session.tools | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.tools.available | array of string | `optional` | maxLength 500 |
| graph.stages[]&lt;variant 1&gt;.session.tools.excluded | array of string | `optional` | maxLength 500 |
| graph.stages[]&lt;variant 1&gt;.session.mcp | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers | map of object | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key} | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.url | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.headers | map of string | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.command | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.args | array of string | `optional` | maxLength 64 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.env | map of string | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.cwd | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.tools | array of string | `optional` | maxLength 500 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.timeoutMs | number | `optional` | int; min 0; max 600000 |
| graph.stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.enabled | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.mcp.excludedIds | array of string | `optional` | maxLength 200 |
| graph.stages[]&lt;variant 1&gt;.session.skills | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.skills.directories | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.skills.disabled | array of string | `optional` | maxLength 500 |
| graph.stages[]&lt;variant 1&gt;.session.customAgents | array of object | `optional` | maxLength 50 |
| graph.stages[]&lt;variant 1&gt;.session.customAgents[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.customAgents[].name | string | `required` | min 1; max 120 |
| graph.stages[]&lt;variant 1&gt;.session.customAgents[].description | string | `required` | min 1; max 2000 |
| graph.stages[]&lt;variant 1&gt;.session.customAgents[].instructions | string | `required` | min 1; max 64000 |
| graph.stages[]&lt;variant 1&gt;.session.customAgents[].tools | array of string | `optional` | maxLength 200 |
| graph.stages[]&lt;variant 1&gt;.session.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.defaultAgentMode | "auto" / "plan" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.browser.enabled | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.mode | "auto" / "native" / "screencast" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.visibility | "visible" / "headless" / "off" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.headless | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.viewport | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.session.browser.viewport.width | number | `required` | int; min 320; max 3840 |
| graph.stages[]&lt;variant 1&gt;.session.browser.viewport.height | number | `required` | int; min 240; max 2160 |
| graph.stages[]&lt;variant 1&gt;.session.browser.allowedHosts | array of string | `optional` | maxLength 100 |
| graph.stages[]&lt;variant 1&gt;.session.browser.persistProfile | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.screencastFps | number | `optional` | int; min 1; max 15 |
| graph.stages[]&lt;variant 1&gt;.session.browser.screencastQuality | number | `optional` | int; min 20; max 95 |
| graph.stages[]&lt;variant 1&gt;.session.browser.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| graph.stages[]&lt;variant 1&gt;.session.browser.evalAllowed | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.permissions | array of string | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 1&gt;.session.browser.piiRedaction | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.injectionDefense | "off" / "classifier" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.recordVideo | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.browser.allowLocalhostSelfSigned | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.computerUse | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.widgets | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.session.orchestrator | boolean | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.sessionReuse | "fresh" / "continue" | `default "fresh"` | — |
| graph.stages[]&lt;variant 1&gt;.compactAfter | number | `optional` | int; min 1; max 20 |
| graph.stages[]&lt;variant 1&gt;.sessionGroup | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 1&gt;.context | object | `default {}` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.context.from | array of string | `optional` | maxLength 50 |
| graph.stages[]&lt;variant 1&gt;.context.mode | "summary" / "output" / "structured" / "none" | `default "summary"` | — |
| graph.stages[]&lt;variant 1&gt;.output | object | `default {}` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.format | "text" / "json" | `default "text"` | — |
| graph.stages[]&lt;variant 1&gt;.output.schema | map of unknown | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.output.extraction | "auto" / "native" / "tool" / "final_json_block" | `default "auto"` | — |
| graph.stages[]&lt;variant 1&gt;.output.instructions | string | `optional` | max 5000 |
| graph.stages[]&lt;variant 1&gt;.output.rules | array of variants by type (object / object / object / object / object / object / object / object) | `default []` | maxLength 20 |
| graph.stages[]&lt;variant 1&gt;.output.rules[] | variants by type (object / object / object / object / object / object / object / object) | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.type | "contains" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.value | string | `required` | min 1; max 10000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.type | "not_contains" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.value | string | `required` | min 1; max 10000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.type | "min_length" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.value | number | `required` | int; min 0; max 10000000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.type | "max_length" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.value | number | `required` | int; min 0; max 10000000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.type | "regex" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.pattern | string | `required` | min 1; max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.flags | string | `optional` | regex /^[ims]{0,3}$/ |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.type | "custom_script" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.command | string | `required` | min 1; max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.args | array of string | `default []` | maxLength 64 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.env | map of string | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.timeoutMs | number | `default 60000` | int; min 1000; max 600000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.type | "json_schema" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.schema | map of unknown | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.type | "judge" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.rubric | string | `required` | min 1; max 10000 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.threshold | number | `required` | min 0; max 10 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.model | string | `optional` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.include | array of "diff" | `optional` | maxLength 1 |
| graph.stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.message | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.retry | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.retry.maxAttempts | number | `default 2` | int; min 1; max 10 |
| graph.stages[]&lt;variant 1&gt;.retry.initialDelayMs | number | `default 2000` | int; min 0; max 3600000 |
| graph.stages[]&lt;variant 1&gt;.retry.backoffMultiplier | number | `default 2` | min 1; max 10 |
| graph.stages[]&lt;variant 1&gt;.retry.maxDelayMs | number | `default 60000` | int; min 0; max 3600000 |
| graph.stages[]&lt;variant 1&gt;.retry.jitter | "full" / "equal" / "none" | `default "full"` | — |
| graph.stages[]&lt;variant 1&gt;.retry.retryOn | array of "rate_limited" / "overloaded" / "provider_5xx" / "transport" / "provider_crashed" / "idle_timeout" / "attempt_timeout" / "auth" / "model_not_found" / "quota_exhausted" / "context_overflow" / "max_turns" / "budget_exceeded" / "config_invalid" / "agent_not_found" / "agent_disabled" / "pre_run_hook_abort" / "rejected_by_human" / "pause_expired" / "condition_error" / "queue_timeout" / "check_launch_failed" / "check_failed" / "loop_body_failed" / "loop_exit_fail" / "loop_limit" / "loop_wall_clock" / "loop_carry_too_large" / "restore_failed" / "map_items_invalid" / "map_too_large" / "map_duplicate_item_key" / "map_tolerance_exceeded" / "mount_fork_failed" / "item_setup_failed" / "merge_conflict" / "merge_failed" / "subworkflow_start_failed" / "subworkflow_output_drift" / "subworkflow_failed" / "wait_timeout" / "output_schema" / "validation_rule" / "judge_below_threshold" / "missing_artifact" / "process_restart_unsafe" / "lease_expired" | `optional` | maxLength 40 |
| graph.stages[]&lt;variant 1&gt;.retry.mode | "resume" / "restart" | `default "resume"` | — |
| graph.stages[]&lt;variant 1&gt;.retry.restoreCheckpointOnRestart | boolean | `default true` | — |
| graph.stages[]&lt;variant 1&gt;.repair | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.repair.maxRepairs | number | `default 2` | int; min 0; max 5 |
| graph.stages[]&lt;variant 1&gt;.repair.restartOnExhausted | boolean | `default true` | — |
| graph.stages[]&lt;variant 1&gt;.onExhausted | "pause" / "fail" | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.timeouts | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.timeouts.queueMs | number | `optional` | int; min 1000; max 86400000 |
| graph.stages[]&lt;variant 1&gt;.timeouts.attemptMs | number | `optional` | int; min 1000; max 86400000 |
| graph.stages[]&lt;variant 1&gt;.timeouts.idleMs | number | `optional` | int; min 1000; max 86400000 |
| graph.stages[]&lt;variant 1&gt;.timeouts.totalMs | number | `optional` | int; min 1000; max 604800000 |
| graph.stages[]&lt;variant 1&gt;.budget | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| graph.stages[]&lt;variant 1&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| graph.stages[]&lt;variant 1&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| graph.stages[]&lt;variant 1&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| graph.stages[]&lt;variant 1&gt;.approval | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.approval.prompt | string | `optional` | max 5000 |
| graph.stages[]&lt;variant 1&gt;.approval.allowChanges | boolean | `default true` | — |
| graph.stages[]&lt;variant 1&gt;.approval.maxRounds | number | `default 3` | int; min 1; max 10 |
| graph.stages[]&lt;variant 1&gt;.hooks | array of object | `default []` | maxLength 50 |
| graph.stages[]&lt;variant 1&gt;.hooks[] | object | `required` | unknown keys: strict; refinement |
| graph.stages[]&lt;variant 1&gt;.hooks[].id | string | `required` | min 1; max 100 |
| graph.stages[]&lt;variant 1&gt;.hooks[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 1&gt;.hooks[].type | "script" / "http" / "function" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].priority | number | `default 0` | int; min -1000; max 1000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].enabled | boolean | `default true` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].retries | number | `default 0` | int; min 0; max 5 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config | variants by type (object / object / object) | `required` | refinement |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| graph.stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| graph.stages[]&lt;variant 1&gt;.hooks[].phase | "pre_run" / "post_run" / "pre_prompt" / "post_prompt" / "on_error" / "on_cancel" / "pre_tool_use" / "post_tool_use" / "on_message" / "on_reasoning" / "on_session_start" / "on_session_idle" / "on_session_error" / "on_session_cancelled" | `required` | — |
| graph.stages[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 2&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 2&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 2&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 2&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 2&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 2&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 2&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 2&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 2&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 2&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 2&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 2&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 2&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 2&gt;.kind | "check" | `required` | — |
| graph.stages[]&lt;variant 2&gt;.check | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.check.command | string | `required` | regex /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/ |
| graph.stages[]&lt;variant 2&gt;.check.args | array of string | `default []` | maxLength 64 |
| graph.stages[]&lt;variant 2&gt;.check.env | map of string | `optional` | — |
| graph.stages[]&lt;variant 2&gt;.check.mount | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| graph.stages[]&lt;variant 2&gt;.check.cwd | string | `optional` | min 1; max 1000; regex /^(?![\\/])(?![A-Za-z]:)(?!(.*[\\/])?\.\.([\\/]&#124;$)).+$/ |
| graph.stages[]&lt;variant 2&gt;.check.timeoutMs | number | `default 600000` | int; min 1000; max 3600000 |
| graph.stages[]&lt;variant 2&gt;.check.parseJson | boolean | `default false` | — |
| graph.stages[]&lt;variant 2&gt;.check.failOnNonZero | boolean | `default false` | — |
| graph.stages[]&lt;variant 2&gt;.check.tailBytes | number | `default 16384` | int; min 1024; max 262144 |
| graph.stages[]&lt;variant 2&gt;.retry | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.retry.maxAttempts | number | `default 2` | int; min 1; max 10 |
| graph.stages[]&lt;variant 2&gt;.retry.initialDelayMs | number | `default 2000` | int; min 0; max 3600000 |
| graph.stages[]&lt;variant 2&gt;.retry.backoffMultiplier | number | `default 2` | min 1; max 10 |
| graph.stages[]&lt;variant 2&gt;.retry.maxDelayMs | number | `default 60000` | int; min 0; max 3600000 |
| graph.stages[]&lt;variant 2&gt;.retry.jitter | "full" / "equal" / "none" | `default "full"` | — |
| graph.stages[]&lt;variant 2&gt;.retry.retryOn | array of "rate_limited" / "overloaded" / "provider_5xx" / "transport" / "provider_crashed" / "idle_timeout" / "attempt_timeout" / "auth" / "model_not_found" / "quota_exhausted" / "context_overflow" / "max_turns" / "budget_exceeded" / "config_invalid" / "agent_not_found" / "agent_disabled" / "pre_run_hook_abort" / "rejected_by_human" / "pause_expired" / "condition_error" / "queue_timeout" / "check_launch_failed" / "check_failed" / "loop_body_failed" / "loop_exit_fail" / "loop_limit" / "loop_wall_clock" / "loop_carry_too_large" / "restore_failed" / "map_items_invalid" / "map_too_large" / "map_duplicate_item_key" / "map_tolerance_exceeded" / "mount_fork_failed" / "item_setup_failed" / "merge_conflict" / "merge_failed" / "subworkflow_start_failed" / "subworkflow_output_drift" / "subworkflow_failed" / "wait_timeout" / "output_schema" / "validation_rule" / "judge_below_threshold" / "missing_artifact" / "process_restart_unsafe" / "lease_expired" | `optional` | maxLength 40 |
| graph.stages[]&lt;variant 2&gt;.retry.mode | "resume" / "restart" | `default "resume"` | — |
| graph.stages[]&lt;variant 2&gt;.retry.restoreCheckpointOnRestart | boolean | `default true` | — |
| graph.stages[]&lt;variant 2&gt;.timeouts | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 2&gt;.timeouts.queueMs | number | `optional` | int; min 1000; max 86400000 |
| graph.stages[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 3&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 3&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 3&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 3&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 3&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 3&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 3&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 3&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 3&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 3&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 3&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 3&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 3&gt;.kind | "loop" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.maxIterations | number | `required` | int; min 1; max 50 |
| graph.stages[]&lt;variant 3&gt;.loop.exits | array of object | `default []` | maxLength 12 |
| graph.stages[]&lt;variant 3&gt;.loop.exits[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.exits[].when | string | `required` | min 1; max 2000 |
| graph.stages[]&lt;variant 3&gt;.loop.exits[].action | "complete" / "fail" / "pause" / "exhaust" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop.exits[].consecutive | number | `default 1` | int; min 1; max 10 |
| graph.stages[]&lt;variant 3&gt;.loop.exits[].reason | string | `required` | regex /^[a-z][a-z0-9_]{0,39}$/ |
| graph.stages[]&lt;variant 3&gt;.loop.carryInit | map of string | `optional` | — |
| graph.stages[]&lt;variant 3&gt;.loop.carry | map of string | `optional` | — |
| graph.stages[]&lt;variant 3&gt;.loop.carrySchema | map of map of unknown | `optional` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit | variants by mode (object / object / object / object) | `default {"mode":"pause"}` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 1&gt;.mode | "pause" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 2&gt;.mode | "fail" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 3&gt;.mode | "accept_last" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt;.mode | "accept_best" | `required` | — |
| graph.stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt;.score | string | `required` | min 1; max 2000 |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.stage | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.prompt | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.prompt.label | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.prompt.text | string | `required` | min 1; max 100000 |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.maxTurns | number | `default 1` | int; min 1; max 5 |
| graph.stages[]&lt;variant 3&gt;.loop.wrapUp.maxCostShare | number | `default 0.1` | min 0; max 0.5 |
| graph.stages[]&lt;variant 3&gt;.loop.onBodyFailure | "fail" / "next_iteration" | `default "fail"` | — |
| graph.stages[]&lt;variant 3&gt;.loop.checkpointEachIteration | boolean | `optional` | — |
| graph.stages[]&lt;variant 3&gt;.loop.output | object | `default {}` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.loop.output.select | map of string | `optional` | — |
| graph.stages[]&lt;variant 3&gt;.budget | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 3&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| graph.stages[]&lt;variant 3&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| graph.stages[]&lt;variant 3&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| graph.stages[]&lt;variant 3&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| graph.stages[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 4&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 4&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 4&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 4&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 4&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 4&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 4&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 4&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 4&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 4&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 4&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 4&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 4&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 4&gt;.kind | "map" | `required` | — |
| graph.stages[]&lt;variant 4&gt;.map | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.map.items | string | `required` | min 1; max 2000 |
| graph.stages[]&lt;variant 4&gt;.map.itemKey | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 4&gt;.map.maxItems | number | `default 50` | int; min 1; max 200 |
| graph.stages[]&lt;variant 4&gt;.map.concurrency | number | `default 4` | int; min 1; max 16 |
| graph.stages[]&lt;variant 4&gt;.map.toleratedFailurePercent | number | `default 0` | min 0; max 100 |
| graph.stages[]&lt;variant 4&gt;.map.workspace | "shared" / "mount_per_item" | `default "shared"` | — |
| graph.stages[]&lt;variant 4&gt;.map.merge | "none" / "sequential" / "pr_per_item" | `default "none"` | — |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup | array of object | `optional` | maxLength 5 |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].command | string | `required` | regex /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/ |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].args | array of string | `default []` | maxLength 64 |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].env | map of string | `optional` | — |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].mount | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].cwd | string | `optional` | min 1; max 1000; regex /^(?![\\/])(?![A-Za-z]:)(?!(.*[\\/])?\.\.([\\/]&#124;$)).+$/ |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].timeoutMs | number | `default 600000` | int; min 1000; max 3600000 |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].parseJson | boolean | `default false` | — |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].failOnNonZero | boolean | `default false` | — |
| graph.stages[]&lt;variant 4&gt;.map.itemSetup[].tailBytes | number | `default 16384` | int; min 1024; max 262144 |
| graph.stages[]&lt;variant 4&gt;.map.output | object | `default {}` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.map.output.select | map of string | `optional` | — |
| graph.stages[]&lt;variant 4&gt;.budget | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 4&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| graph.stages[]&lt;variant 4&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| graph.stages[]&lt;variant 4&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| graph.stages[]&lt;variant 4&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| graph.stages[]&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 5&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 5&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 5&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 5&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 5&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 5&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 5&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 5&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 5&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 5&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 5&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 5&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 5&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 5&gt;.kind | "subworkflow" | `required` | — |
| graph.stages[]&lt;variant 5&gt;.subworkflow | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef | union (object / object) | `required` | — |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 1&gt;.id | string | `required` | min 1; max 100 |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt;.projectScope | "project" / "global" | `optional` | — |
| graph.stages[]&lt;variant 5&gt;.subworkflow.version | union ("pin_at_run_start" / number) | `default "pin_at_run_start"` | — |
| graph.stages[]&lt;variant 5&gt;.subworkflow.inputs | map of string | `default {}` | — |
| graph.stages[]&lt;variant 5&gt;.subworkflow.workspace | "inherit" / "isolated" | `default "inherit"` | — |
| graph.stages[]&lt;variant 5&gt;.budget | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 5&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| graph.stages[]&lt;variant 5&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| graph.stages[]&lt;variant 5&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| graph.stages[]&lt;variant 5&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| graph.stages[]&lt;variant 6&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 6&gt;.name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 6&gt;.description | string | `optional` | max 2000 |
| graph.stages[]&lt;variant 6&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.stages[]&lt;variant 6&gt;.guard | string | `optional` | min 1; max 2000 |
| graph.stages[]&lt;variant 6&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| graph.stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| graph.stages[]&lt;variant 6&gt;.position | object | `optional` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.position.x | number | `required` | finite |
| graph.stages[]&lt;variant 6&gt;.position.y | number | `required` | finite |
| graph.stages[]&lt;variant 6&gt;.compensate | array of object | `optional` | maxLength 20 |
| graph.stages[]&lt;variant 6&gt;.compensate[] | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.compensate[].name | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 6&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| graph.stages[]&lt;variant 6&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| graph.stages[]&lt;variant 6&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| graph.stages[]&lt;variant 6&gt;.kind | "wait" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.wait | variants by type (object / object / object) | `required` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.type | "approval" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt.label | string | `required` | min 1; max 200 |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt.text | string | `required` | min 1; max 100000 |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.form | map of unknown | `optional` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.timeoutMs | number | `optional` | int; min 1000; max 2592000000 |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.onTimeout | "fail" / "complete" | `default "fail"` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.type | "event" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.eventKey | string | `required` | min 1; max 2000 |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.timeoutMs | number | `optional` | int; min 1000; max 2592000000 |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.onTimeout | "fail" / "complete" | `default "fail"` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt;.type | "timer" | `required` | — |
| graph.stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt;.durationMs | number | `required` | int; min 1000; max 2592000000 |
| graph.edges | array of object | `default []` | maxLength 500 |
| graph.edges[] | object | `required` | unknown keys: strict |
| graph.edges[].from | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.edges[].to | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| graph.edges[].on | "success" / "failure" / "completion" / "always" | `default "success"` | — |
| graph.edges[].when | string | `optional` | min 1; max 2000 |
| graph.edges[].handlesFailure | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete definition.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// Persisted definitions (P01 WP-1.7): the records the definition API
// returns around a `WorkflowGraph`, the request bodies it accepts, and
// the template file format. Timestamps are ISO strings: these are wire
// documents, shared by the server, every client and the CLI.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { WorkflowGraphSchema, type WorkflowGraph } from './schemas/graph.js';

export const DEFINITION_STATUSES = ['draft', 'published'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export const VERSION_KINDS = ['published', 'test'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/** A definition: its working graph plus the store's bookkeeping. */
export interface WorkflowDefinitionRecord {
  id: string;
  status: DefinitionStatus;
  /** Bumped by every graph save; `saveGraph` requires the current value. */
  revision: number;
  /** The version runs use (the latest published one); null for a never-published draft. */
  currentVersionId: string | null;
  /** True when the working graph differs from the current published version. */
  hasUnpublishedChanges: boolean;
  archivedAt: string | null;
  /** Notes a migration left for the author; cleared by the next save. */
  needsAttention: string[];
  createdAt: string;
  updatedAt: string;
  graph: WorkflowGraph;
}

/** One row of the definition list. */
export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  description?: string;
  projectId: string | null;
  status: DefinitionStatus;
  revision: number;
  currentVersionId: string | null;
  tags: string[];
  stageCount: number;
  needsAttention: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An immutable version (runs pin one). */
export interface WorkflowDefinitionVersionSummary {
  id: string;
  workflowDefinitionId: string;
  version: number;
  kind: VersionKind;
  contentHash: string;
  createdAt: string;
}

export interface WorkflowDefinitionVersionRecord extends WorkflowDefinitionVersionSummary {
  graph: WorkflowGraph;
}

/** `PUT /workflow-definitions/:id/graph`. The graph is validated separately. */
export const SaveGraphRequestSchema = z
  .object({
    graph: z.unknown().describe('The whole WorkflowGraph; it replaces the stored one'),
    expectedRevision: z.number().int().min(1).describe('The revision the client edited; a mismatch is a 409 REVISION_CONFLICT'),
  })
  .strict()
  .describe('Replace a definition graph');
export type SaveGraphRequest = z.infer<typeof SaveGraphRequestSchema>;

/** `POST /workflow-definitions` and `POST /workflow-definitions/import` with a template. */
export const ImportTemplateRequestSchema = z
  .object({
    templateId: z.string().min(1).max(100).describe('Id of a registered template'),
    name: z.string().min(1).max(200).optional().describe('Name of the new definition (defaults to the template name)'),
    projectId: z.string().uuid().nullable().optional().describe('Bind the new definition to a project'),
  })
  .strict()
  .describe('Create a definition from a template');
export type ImportTemplateRequest = z.infer<typeof ImportTemplateRequestSchema>;

/** Returned with 409 when `expectedRevision` is stale. */
export interface RevisionConflict {
  code: 'REVISION_CONFLICT';
  message: string;
  current: WorkflowDefinitionRecord;
}

// ── Templates ────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = [
  'system',
  'code-generation',
  'code-review',
  'testing',
  'e2e-testing',
  'refactoring',
  'documentation',
  'deployment',
  'custom',
] as const;

/** A template file (`templates/system/*.json`): an id, a category and a graph. */
export const WorkflowTemplateSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Template ids are lower-case words joined by -')
      .describe('Stable template id'),
    category: z.enum(TEMPLATE_CATEGORIES).describe('Catalog category'),
    graph: WorkflowGraphSchema,
  })
  .strict()
  .describe('A workflow template: a canonical graph with catalog metadata');
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

/** Look a stage up by key. */
export function stageByKey(graph: WorkflowGraph, key: string): WorkflowGraph['stages'][number] | undefined {
  return graph.stages.find((s) => s.key === key);
}
```

</details>
