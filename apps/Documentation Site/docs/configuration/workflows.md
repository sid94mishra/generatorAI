# Workflow definition documents (v2 graph): configuration fields

Generated from `packages/workflow-spec/src/schemas/graph.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## WorkflowGraphSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| formatVersion | 2 | `required` | — |
| workflow | object | `required` | unknown keys: strict |
| workflow.name | string | `required` | min 1; max 200 |
| workflow.description | string | `optional` | max 2000 |
| workflow.session | object | `default {}` | unknown keys: strict |
| workflow.session.model | string | `optional` | max 200 |
| workflow.session.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| workflow.session.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| workflow.session.contextTier | "default" / "long_context" | `optional` | — |
| workflow.session.maxTurns | number | `optional` | int; min 1; max 1000 |
| workflow.session.provider | object | `optional` | unknown keys: strict |
| workflow.session.provider.name | string | `required` | min 1; max 100 |
| workflow.session.provider.baseUrl | string | `required` | url; max 2000 |
| workflow.session.provider.apiKey | string | `required` | min 1; max 500 |
| workflow.session.provider.model | string | `optional` | max 200 |
| workflow.session.agentRef | string | `optional` | min 1; max 128 |
| workflow.session.agentOverrides | object | `optional` | unknown keys: strict |
| workflow.session.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| workflow.session.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| workflow.session.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| workflow.session.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| workflow.session.agentOverrides.tools | object | `optional` | unknown keys: strict |
| workflow.session.agentOverrides.tools.browser | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.widgets | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.orchestration | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.fileRead | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.shell | boolean | `optional` | — |
| workflow.session.agentOverrides.tools.web | boolean | `optional` | — |
| workflow.session.agentOverrides.runtime | object | `optional` | unknown keys: strict |
| workflow.session.agentOverrides.runtime.model | string | `optional` | max 200 |
| workflow.session.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| workflow.session.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| workflow.session.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| workflow.session.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| workflow.session.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| workflow.session.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| workflow.session.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| workflow.session.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| workflow.session.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| workflow.session.systemMessage | object | `optional` | unknown keys: strict |
| workflow.session.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| workflow.session.systemMessage.content | string | `required` | max 100000 |
| workflow.session.systemPromptAppend | string | `optional` | max 100000 |
| workflow.session.planModeInstructions | string | `optional` | max 20000 |
| workflow.session.tools | object | `optional` | unknown keys: strict |
| workflow.session.tools.available | array of string | `optional` | maxLength 500 |
| workflow.session.tools.excluded | array of string | `optional` | maxLength 500 |
| workflow.session.mcp | object | `optional` | unknown keys: strict |
| workflow.session.mcp.servers | map of object | `optional` | — |
| workflow.session.mcp.servers.{key} | object | `required` | unknown keys: strict |
| workflow.session.mcp.servers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| workflow.session.mcp.servers.{key}.url | string | `optional` | max 2000 |
| workflow.session.mcp.servers.{key}.headers | map of string | `optional` | — |
| workflow.session.mcp.servers.{key}.command | string | `optional` | max 1000 |
| workflow.session.mcp.servers.{key}.args | array of string | `optional` | maxLength 64 |
| workflow.session.mcp.servers.{key}.env | map of string | `optional` | — |
| workflow.session.mcp.servers.{key}.cwd | string | `optional` | max 1000 |
| workflow.session.mcp.servers.{key}.tools | array of string | `optional` | maxLength 500 |
| workflow.session.mcp.servers.{key}.timeoutMs | number | `optional` | int; min 0; max 600000 |
| workflow.session.mcp.servers.{key}.enabled | boolean | `optional` | — |
| workflow.session.mcp.excludedIds | array of string | `optional` | maxLength 200 |
| workflow.session.skills | object | `optional` | unknown keys: strict |
| workflow.session.skills.directories | array of string | `optional` | maxLength 100 |
| workflow.session.skills.disabled | array of string | `optional` | maxLength 500 |
| workflow.session.customAgents | array of object | `optional` | maxLength 50 |
| workflow.session.customAgents[] | object | `required` | unknown keys: strict |
| workflow.session.customAgents[].name | string | `required` | min 1; max 120 |
| workflow.session.customAgents[].description | string | `required` | min 1; max 2000 |
| workflow.session.customAgents[].instructions | string | `required` | min 1; max 64000 |
| workflow.session.customAgents[].tools | array of string | `optional` | maxLength 200 |
| workflow.session.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| workflow.session.defaultAgentMode | "auto" / "plan" | `optional` | — |
| workflow.session.browser | object | `optional` | unknown keys: strict |
| workflow.session.browser.enabled | boolean | `optional` | — |
| workflow.session.browser.mode | "auto" / "native" / "screencast" | `optional` | — |
| workflow.session.browser.visibility | "visible" / "headless" / "off" | `optional` | — |
| workflow.session.browser.headless | boolean | `optional` | — |
| workflow.session.browser.viewport | object | `optional` | unknown keys: strict |
| workflow.session.browser.viewport.width | number | `required` | int; min 320; max 3840 |
| workflow.session.browser.viewport.height | number | `required` | int; min 240; max 2160 |
| workflow.session.browser.allowedHosts | array of string | `optional` | maxLength 100 |
| workflow.session.browser.persistProfile | boolean | `optional` | — |
| workflow.session.browser.screencastFps | number | `optional` | int; min 1; max 15 |
| workflow.session.browser.screencastQuality | number | `optional` | int; min 20; max 95 |
| workflow.session.browser.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| workflow.session.browser.evalAllowed | boolean | `optional` | — |
| workflow.session.browser.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| workflow.session.browser.permissions | array of string | `optional` | maxLength 20 |
| workflow.session.browser.piiRedaction | boolean | `optional` | — |
| workflow.session.browser.injectionDefense | "off" / "classifier" | `optional` | — |
| workflow.session.browser.recordVideo | boolean | `optional` | — |
| workflow.session.browser.allowLocalhostSelfSigned | boolean | `optional` | — |
| workflow.session.computerUse | boolean | `optional` | — |
| workflow.session.widgets | boolean | `optional` | — |
| workflow.session.orchestrator | boolean | `optional` | — |
| workflow.variables | array of object | `default []` | maxLength 50 |
| workflow.variables[] | object | `required` | unknown keys: strict; refinement |
| workflow.variables[].name | string | `required` | min 1; max 64; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| workflow.variables[].type | "string" / "number" / "boolean" / "choice" / "text" / "list" / "json" | `required` | — |
| workflow.variables[].label | string | `required` | min 1; max 200 |
| workflow.variables[].description | string | `optional` | max 2000 |
| workflow.variables[].required | boolean | `default false` | — |
| workflow.variables[].defaultValue | unknown | `optional` | — |
| workflow.variables[].options | array of string | `optional` | maxLength 100 |
| workflow.hooks | array of object | `default []` | maxLength 50 |
| workflow.hooks[] | object | `required` | unknown keys: strict; refinement |
| workflow.hooks[].id | string | `required` | min 1; max 100 |
| workflow.hooks[].name | string | `required` | min 1; max 200 |
| workflow.hooks[].type | "script" / "http" / "function" | `required` | — |
| workflow.hooks[].priority | number | `default 0` | int; min -1000; max 1000 |
| workflow.hooks[].enabled | boolean | `default true` | — |
| workflow.hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| workflow.hooks[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| workflow.hooks[].retries | number | `default 0` | int; min 0; max 5 |
| workflow.hooks[].config | variants by type (object / object / object) | `required` | refinement |
| workflow.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| workflow.hooks[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| workflow.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| workflow.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| workflow.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| workflow.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| workflow.hooks[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| workflow.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| workflow.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| workflow.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| workflow.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| workflow.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| workflow.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| workflow.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| workflow.hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| workflow.onExit | array of object | `optional` | maxLength 20 |
| workflow.onExit[] | object | `required` | unknown keys: strict |
| workflow.onExit[].name | string | `required` | min 1; max 200 |
| workflow.onExit[].config | variants by type (object / object / object) | `required` | refinement |
| workflow.onExit[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.onExit[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| workflow.onExit[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| workflow.onExit[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| workflow.onExit[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| workflow.onExit[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| workflow.onExit[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.onExit[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| workflow.onExit[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| workflow.onExit[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| workflow.onExit[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| workflow.onExit[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| workflow.onExit[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.onExit[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| workflow.onExit[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| workflow.onExit[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| workflow.onExit[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| workflow.onExit[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| workflow.onExit[].retries | number | `default 0` | int; min 0; max 5 |
| workflow.onFailure | array of object | `optional` | maxLength 20 |
| workflow.onFailure[] | object | `required` | unknown keys: strict |
| workflow.onFailure[].name | string | `required` | min 1; max 200 |
| workflow.onFailure[].config | variants by type (object / object / object) | `required` | refinement |
| workflow.onFailure[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.onFailure[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| workflow.onFailure[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| workflow.onFailure[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| workflow.onFailure[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| workflow.onFailure[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| workflow.onFailure[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.onFailure[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| workflow.onFailure[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| workflow.onFailure[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| workflow.onFailure[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| workflow.onFailure[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| workflow.onFailure[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.onFailure[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| workflow.onFailure[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| workflow.onFailure[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| workflow.onFailure[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| workflow.onFailure[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| workflow.onFailure[].retries | number | `default 0` | int; min 0; max 5 |
| workflow.lifecycle | object | `default {}` | unknown keys: strict |
| workflow.lifecycle.codebaseAliases | array of string | `default []` | maxLength 5 |
| workflow.lifecycle.useWorktree | boolean | `default true` | — |
| workflow.lifecycle.requiresCodebase | boolean | `default false` | — |
| workflow.lifecycle.sandbox | "required" / "optional" | `default "required"` | — |
| workflow.lifecycle.preprocessingSteps | array of object | `default []` | maxLength 50 |
| workflow.lifecycle.preprocessingSteps[] | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].name | string | `required` | min 1; max 200 |
| workflow.lifecycle.preprocessingSteps[].failOnError | boolean | `default true` | — |
| workflow.lifecycle.preprocessingSteps[].config | variants by type (object / object / object / object / object) | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt;.type | "clone_repo" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 1&gt;.repoAlias | string | `required` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.type | "run_script" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.script | string | `required` | min 1; max 20000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.cwd | string | `optional` | max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 2&gt;.timeoutMs | number | `optional` | int; min 1000; max 3600000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.type | "validate_input" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.variableName | string | `required` | min 1; max 64 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules | array of variants by type (object / object / object / object) | `required` | minLength 1; maxLength 20 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[] | variants by type (object / object / object / object) | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt;.type | "required" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 1&gt;.message | string | `required` | min 1; max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.type | "regex" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.pattern | string | `required` | min 1; max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.flags | string | `optional` | regex /^[ims]{0,3}$/ |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 2&gt;.message | string | `required` | min 1; max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.type | "min_length" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.value | number | `required` | int; min 0; max 1000000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 3&gt;.message | string | `required` | min 1; max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.type | "max_length" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.value | number | `required` | int; min 0; max 1000000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 3&gt;.rules[]&lt;variant 4&gt;.message | string | `required` | min 1; max 1000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.type | "set_variable" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.variableName | string | `required` | min 1; max 64 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 4&gt;.value | string | `required` | max 100000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.type | "conditional" | `required` | — |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.condition | string | `required` | min 1; max 2000 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.thenSteps | array of lazy | `required` | maxLength 20 |
| workflow.lifecycle.preprocessingSteps[].config&lt;variant 5&gt;.elseSteps | array of lazy | `optional` | maxLength 20 |
| workflow.lifecycle.postProcessing | object | `default {}` | unknown keys: strict |
| workflow.lifecycle.postProcessing.autoCommit | boolean | `default false` | — |
| workflow.lifecycle.postProcessing.autoPush | boolean | `default false` | — |
| workflow.lifecycle.postProcessing.autoCreatePR | boolean | `default false` | — |
| workflow.lifecycle.postProcessing.steps | array of object | `default []` | maxLength 50 |
| workflow.lifecycle.postProcessing.steps[] | object | `required` | unknown keys: strict |
| workflow.lifecycle.postProcessing.steps[].name | string | `required` | min 1; max 200 |
| workflow.lifecycle.postProcessing.steps[].failOnError | boolean | `default true` | — |
| workflow.lifecycle.postProcessing.steps[].config | variants by type (object / object / object) | `required` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.type | "commit_and_push" | `required` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.repoAlias | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.commitMessage | string | `required` | min 1; max 100000 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.push | boolean | `optional` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.generateMessage | boolean | `optional` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 1&gt;.baseBranch | string | `optional` | max 200 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.type | "create_pr" | `required` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.repoAlias | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.title | string | `required` | min 1; max 100000 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.body | string | `required` | max 100000 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.baseBranch | string | `optional` | max 200 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.generateText | boolean | `optional` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 2&gt;.draft | boolean | `optional` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.type | "run_script" | `required` | — |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.script | string | `required` | min 1; max 20000 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.cwd | string | `optional` | max 1000 |
| workflow.lifecycle.postProcessing.steps[].config&lt;variant 3&gt;.timeoutMs | number | `optional` | int; min 1000; max 3600000 |
| workflow.budget | object | `optional` | unknown keys: strict |
| workflow.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| workflow.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| workflow.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| workflow.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| workflow.maxParallel | number | `optional` | int; min 1; max 32 |
| workflow.outputs | map of string | `optional` | — |
| workflow.tags | array of string | `default []` | maxLength 20 |
| workflow.projectId | string | `optional; null accepted` | uuid |
| stages | array of variants by kind (object / object / object / object / object / object) | `required` | maxLength 100 |
| stages[] | variants by kind (object / object / object / object / object / object) | `required` | — |
| stages[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 1&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 1&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 1&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 1&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 1&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 1&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 1&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 1&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 1&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 1&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 1&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 1&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 1&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 1&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 1&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 1&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 1&gt;.kind | "agent" | `required` | — |
| stages[]&lt;variant 1&gt;.prompts | array of object | `default []` | maxLength 50 |
| stages[]&lt;variant 1&gt;.prompts[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.prompts[].label | string | `required` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.prompts[].text | string | `required` | min 1; max 100000 |
| stages[]&lt;variant 1&gt;.followUpPrompts | array of object | `optional` | maxLength 50 |
| stages[]&lt;variant 1&gt;.followUpPrompts[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.followUpPrompts[].label | string | `required` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.followUpPrompts[].text | string | `required` | min 1; max 100000 |
| stages[]&lt;variant 1&gt;.session | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.model | string | `optional` | max 200 |
| stages[]&lt;variant 1&gt;.session.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.contextTier | "default" / "long_context" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.maxTurns | number | `optional` | int; min 1; max 1000 |
| stages[]&lt;variant 1&gt;.session.provider | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.provider.name | string | `required` | min 1; max 100 |
| stages[]&lt;variant 1&gt;.session.provider.baseUrl | string | `required` | url; max 2000 |
| stages[]&lt;variant 1&gt;.session.provider.apiKey | string | `required` | min 1; max 500 |
| stages[]&lt;variant 1&gt;.session.provider.model | string | `optional` | max 200 |
| stages[]&lt;variant 1&gt;.session.agentRef | string | `optional` | min 1; max 128 |
| stages[]&lt;variant 1&gt;.session.agentOverrides | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.browser | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.widgets | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.orchestration | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.fileRead | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.shell | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.tools.web | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.model | string | `optional` | max 200 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| stages[]&lt;variant 1&gt;.session.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| stages[]&lt;variant 1&gt;.session.systemMessage | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| stages[]&lt;variant 1&gt;.session.systemMessage.content | string | `required` | max 100000 |
| stages[]&lt;variant 1&gt;.session.systemPromptAppend | string | `optional` | max 100000 |
| stages[]&lt;variant 1&gt;.session.planModeInstructions | string | `optional` | max 20000 |
| stages[]&lt;variant 1&gt;.session.tools | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.tools.available | array of string | `optional` | maxLength 500 |
| stages[]&lt;variant 1&gt;.session.tools.excluded | array of string | `optional` | maxLength 500 |
| stages[]&lt;variant 1&gt;.session.mcp | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.mcp.servers | map of object | `optional` | — |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key} | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.url | string | `optional` | max 2000 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.headers | map of string | `optional` | — |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.command | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.args | array of string | `optional` | maxLength 64 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.env | map of string | `optional` | — |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.cwd | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.tools | array of string | `optional` | maxLength 500 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.timeoutMs | number | `optional` | int; min 0; max 600000 |
| stages[]&lt;variant 1&gt;.session.mcp.servers.{key}.enabled | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.mcp.excludedIds | array of string | `optional` | maxLength 200 |
| stages[]&lt;variant 1&gt;.session.skills | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.skills.directories | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.skills.disabled | array of string | `optional` | maxLength 500 |
| stages[]&lt;variant 1&gt;.session.customAgents | array of object | `optional` | maxLength 50 |
| stages[]&lt;variant 1&gt;.session.customAgents[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.customAgents[].name | string | `required` | min 1; max 120 |
| stages[]&lt;variant 1&gt;.session.customAgents[].description | string | `required` | min 1; max 2000 |
| stages[]&lt;variant 1&gt;.session.customAgents[].instructions | string | `required` | min 1; max 64000 |
| stages[]&lt;variant 1&gt;.session.customAgents[].tools | array of string | `optional` | maxLength 200 |
| stages[]&lt;variant 1&gt;.session.permissionMode | "default" / "acceptEdits" / "plan" / "bypassPermissions" / "dontAsk" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.defaultAgentMode | "auto" / "plan" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.browser.enabled | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.mode | "auto" / "native" / "screencast" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.visibility | "visible" / "headless" / "off" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.headless | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.viewport | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.session.browser.viewport.width | number | `required` | int; min 320; max 3840 |
| stages[]&lt;variant 1&gt;.session.browser.viewport.height | number | `required` | int; min 240; max 2160 |
| stages[]&lt;variant 1&gt;.session.browser.allowedHosts | array of string | `optional` | maxLength 100 |
| stages[]&lt;variant 1&gt;.session.browser.persistProfile | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.screencastFps | number | `optional` | int; min 1; max 15 |
| stages[]&lt;variant 1&gt;.session.browser.screencastQuality | number | `optional` | int; min 20; max 95 |
| stages[]&lt;variant 1&gt;.session.browser.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| stages[]&lt;variant 1&gt;.session.browser.evalAllowed | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.permissions | array of string | `optional` | maxLength 20 |
| stages[]&lt;variant 1&gt;.session.browser.piiRedaction | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.injectionDefense | "off" / "classifier" | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.recordVideo | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.browser.allowLocalhostSelfSigned | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.computerUse | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.widgets | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.session.orchestrator | boolean | `optional` | — |
| stages[]&lt;variant 1&gt;.sessionReuse | "fresh" / "continue" | `default "fresh"` | — |
| stages[]&lt;variant 1&gt;.compactAfter | number | `optional` | int; min 1; max 20 |
| stages[]&lt;variant 1&gt;.sessionGroup | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 1&gt;.context | object | `default {}` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.context.from | array of string | `optional` | maxLength 50 |
| stages[]&lt;variant 1&gt;.context.mode | "summary" / "output" / "structured" / "none" | `default "summary"` | — |
| stages[]&lt;variant 1&gt;.output | object | `default {}` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.format | "text" / "json" | `default "text"` | — |
| stages[]&lt;variant 1&gt;.output.schema | map of unknown | `optional` | — |
| stages[]&lt;variant 1&gt;.output.extraction | "auto" / "native" / "tool" / "final_json_block" | `default "auto"` | — |
| stages[]&lt;variant 1&gt;.output.instructions | string | `optional` | max 5000 |
| stages[]&lt;variant 1&gt;.output.rules | array of variants by type (object / object / object / object / object / object / object / object) | `default []` | maxLength 20 |
| stages[]&lt;variant 1&gt;.output.rules[] | variants by type (object / object / object / object / object / object / object / object) | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.type | "contains" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.value | string | `required` | min 1; max 10000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 1&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.type | "not_contains" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.value | string | `required` | min 1; max 10000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 2&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.type | "min_length" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.value | number | `required` | int; min 0; max 10000000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 3&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.type | "max_length" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.value | number | `required` | int; min 0; max 10000000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 4&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.type | "regex" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.pattern | string | `required` | min 1; max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.flags | string | `optional` | regex /^[ims]{0,3}$/ |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 5&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.type | "custom_script" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.command | string | `required` | min 1; max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.args | array of string | `default []` | maxLength 64 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.env | map of string | `optional` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.timeoutMs | number | `default 60000` | int; min 1000; max 600000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 6&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.type | "json_schema" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.schema | map of unknown | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 7&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.type | "judge" | `required` | — |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.rubric | string | `required` | min 1; max 10000 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.threshold | number | `required` | min 0; max 10 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.model | string | `optional` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.include | array of "diff" | `optional` | maxLength 1 |
| stages[]&lt;variant 1&gt;.output.rules[]&lt;variant 8&gt;.message | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.retry | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.retry.maxAttempts | number | `default 2` | int; min 1; max 10 |
| stages[]&lt;variant 1&gt;.retry.initialDelayMs | number | `default 2000` | int; min 0; max 3600000 |
| stages[]&lt;variant 1&gt;.retry.backoffMultiplier | number | `default 2` | min 1; max 10 |
| stages[]&lt;variant 1&gt;.retry.maxDelayMs | number | `default 60000` | int; min 0; max 3600000 |
| stages[]&lt;variant 1&gt;.retry.jitter | "full" / "equal" / "none" | `default "full"` | — |
| stages[]&lt;variant 1&gt;.retry.retryOn | array of "rate_limited" / "overloaded" / "provider_5xx" / "transport" / "provider_crashed" / "idle_timeout" / "attempt_timeout" / "auth" / "model_not_found" / "quota_exhausted" / "context_overflow" / "max_turns" / "budget_exceeded" / "config_invalid" / "agent_not_found" / "agent_disabled" / "pre_run_hook_abort" / "rejected_by_human" / "pause_expired" / "condition_error" / "queue_timeout" / "check_launch_failed" / "check_failed" / "loop_body_failed" / "loop_exit_fail" / "loop_limit" / "loop_wall_clock" / "loop_carry_too_large" / "restore_failed" / "map_items_invalid" / "map_too_large" / "map_duplicate_item_key" / "map_tolerance_exceeded" / "mount_fork_failed" / "item_setup_failed" / "merge_conflict" / "merge_failed" / "subworkflow_start_failed" / "subworkflow_output_drift" / "subworkflow_failed" / "wait_timeout" / "output_schema" / "validation_rule" / "judge_below_threshold" / "missing_artifact" / "process_restart_unsafe" / "lease_expired" | `optional` | maxLength 40 |
| stages[]&lt;variant 1&gt;.retry.mode | "resume" / "restart" | `default "resume"` | — |
| stages[]&lt;variant 1&gt;.retry.restoreCheckpointOnRestart | boolean | `default true` | — |
| stages[]&lt;variant 1&gt;.repair | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.repair.maxRepairs | number | `default 2` | int; min 0; max 5 |
| stages[]&lt;variant 1&gt;.repair.restartOnExhausted | boolean | `default true` | — |
| stages[]&lt;variant 1&gt;.onExhausted | "pause" / "fail" | `optional` | — |
| stages[]&lt;variant 1&gt;.timeouts | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.timeouts.queueMs | number | `optional` | int; min 1000; max 86400000 |
| stages[]&lt;variant 1&gt;.timeouts.attemptMs | number | `optional` | int; min 1000; max 86400000 |
| stages[]&lt;variant 1&gt;.timeouts.idleMs | number | `optional` | int; min 1000; max 86400000 |
| stages[]&lt;variant 1&gt;.timeouts.totalMs | number | `optional` | int; min 1000; max 604800000 |
| stages[]&lt;variant 1&gt;.budget | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| stages[]&lt;variant 1&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| stages[]&lt;variant 1&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| stages[]&lt;variant 1&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| stages[]&lt;variant 1&gt;.approval | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.approval.prompt | string | `optional` | max 5000 |
| stages[]&lt;variant 1&gt;.approval.allowChanges | boolean | `default true` | — |
| stages[]&lt;variant 1&gt;.approval.maxRounds | number | `default 3` | int; min 1; max 10 |
| stages[]&lt;variant 1&gt;.hooks | array of object | `default []` | maxLength 50 |
| stages[]&lt;variant 1&gt;.hooks[] | object | `required` | unknown keys: strict; refinement |
| stages[]&lt;variant 1&gt;.hooks[].id | string | `required` | min 1; max 100 |
| stages[]&lt;variant 1&gt;.hooks[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 1&gt;.hooks[].type | "script" / "http" / "function" | `required` | — |
| stages[]&lt;variant 1&gt;.hooks[].priority | number | `default 0` | int; min -1000; max 1000 |
| stages[]&lt;variant 1&gt;.hooks[].enabled | boolean | `default true` | — |
| stages[]&lt;variant 1&gt;.hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| stages[]&lt;variant 1&gt;.hooks[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 1&gt;.hooks[].retries | number | `default 0` | int; min 0; max 5 |
| stages[]&lt;variant 1&gt;.hooks[].config | variants by type (object / object / object) | `required` | refinement |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.command | string | `required` | min 1; max 1000 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | maxLength 64 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.url | string | `required` | url; max 2000 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | max 100000 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | max 1000 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | max 200 |
| stages[]&lt;variant 1&gt;.hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| stages[]&lt;variant 1&gt;.hooks[].phase | "pre_run" / "post_run" / "pre_prompt" / "post_prompt" / "on_error" / "on_cancel" / "pre_tool_use" / "post_tool_use" / "on_message" / "on_reasoning" / "on_session_start" / "on_session_idle" / "on_session_error" / "on_session_cancelled" | `required` | — |
| stages[]&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 2&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 2&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 2&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 2&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 2&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 2&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 2&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 2&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 2&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 2&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 2&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 2&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 2&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 2&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 2&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 2&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 2&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 2&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 2&gt;.kind | "check" | `required` | — |
| stages[]&lt;variant 2&gt;.check | object | `required` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.check.command | string | `required` | regex /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/ |
| stages[]&lt;variant 2&gt;.check.args | array of string | `default []` | maxLength 64 |
| stages[]&lt;variant 2&gt;.check.env | map of string | `optional` | — |
| stages[]&lt;variant 2&gt;.check.mount | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| stages[]&lt;variant 2&gt;.check.cwd | string | `optional` | min 1; max 1000; regex /^(?![\\/])(?![A-Za-z]:)(?!(.*[\\/])?\.\.([\\/]&#124;$)).+$/ |
| stages[]&lt;variant 2&gt;.check.timeoutMs | number | `default 600000` | int; min 1000; max 3600000 |
| stages[]&lt;variant 2&gt;.check.parseJson | boolean | `default false` | — |
| stages[]&lt;variant 2&gt;.check.failOnNonZero | boolean | `default false` | — |
| stages[]&lt;variant 2&gt;.check.tailBytes | number | `default 16384` | int; min 1024; max 262144 |
| stages[]&lt;variant 2&gt;.retry | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.retry.maxAttempts | number | `default 2` | int; min 1; max 10 |
| stages[]&lt;variant 2&gt;.retry.initialDelayMs | number | `default 2000` | int; min 0; max 3600000 |
| stages[]&lt;variant 2&gt;.retry.backoffMultiplier | number | `default 2` | min 1; max 10 |
| stages[]&lt;variant 2&gt;.retry.maxDelayMs | number | `default 60000` | int; min 0; max 3600000 |
| stages[]&lt;variant 2&gt;.retry.jitter | "full" / "equal" / "none" | `default "full"` | — |
| stages[]&lt;variant 2&gt;.retry.retryOn | array of "rate_limited" / "overloaded" / "provider_5xx" / "transport" / "provider_crashed" / "idle_timeout" / "attempt_timeout" / "auth" / "model_not_found" / "quota_exhausted" / "context_overflow" / "max_turns" / "budget_exceeded" / "config_invalid" / "agent_not_found" / "agent_disabled" / "pre_run_hook_abort" / "rejected_by_human" / "pause_expired" / "condition_error" / "queue_timeout" / "check_launch_failed" / "check_failed" / "loop_body_failed" / "loop_exit_fail" / "loop_limit" / "loop_wall_clock" / "loop_carry_too_large" / "restore_failed" / "map_items_invalid" / "map_too_large" / "map_duplicate_item_key" / "map_tolerance_exceeded" / "mount_fork_failed" / "item_setup_failed" / "merge_conflict" / "merge_failed" / "subworkflow_start_failed" / "subworkflow_output_drift" / "subworkflow_failed" / "wait_timeout" / "output_schema" / "validation_rule" / "judge_below_threshold" / "missing_artifact" / "process_restart_unsafe" / "lease_expired" | `optional` | maxLength 40 |
| stages[]&lt;variant 2&gt;.retry.mode | "resume" / "restart" | `default "resume"` | — |
| stages[]&lt;variant 2&gt;.retry.restoreCheckpointOnRestart | boolean | `default true` | — |
| stages[]&lt;variant 2&gt;.timeouts | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 2&gt;.timeouts.queueMs | number | `optional` | int; min 1000; max 86400000 |
| stages[]&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 3&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 3&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 3&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 3&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 3&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 3&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 3&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 3&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 3&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 3&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 3&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 3&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 3&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 3&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 3&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 3&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 3&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 3&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 3&gt;.kind | "loop" | `required` | — |
| stages[]&lt;variant 3&gt;.loop | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.maxIterations | number | `required` | int; min 1; max 50 |
| stages[]&lt;variant 3&gt;.loop.exits | array of object | `default []` | maxLength 12 |
| stages[]&lt;variant 3&gt;.loop.exits[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.exits[].when | string | `required` | min 1; max 2000 |
| stages[]&lt;variant 3&gt;.loop.exits[].action | "complete" / "fail" / "pause" / "exhaust" | `required` | — |
| stages[]&lt;variant 3&gt;.loop.exits[].consecutive | number | `default 1` | int; min 1; max 10 |
| stages[]&lt;variant 3&gt;.loop.exits[].reason | string | `required` | regex /^[a-z][a-z0-9_]{0,39}$/ |
| stages[]&lt;variant 3&gt;.loop.carryInit | map of string | `optional` | — |
| stages[]&lt;variant 3&gt;.loop.carry | map of string | `optional` | — |
| stages[]&lt;variant 3&gt;.loop.carrySchema | map of map of unknown | `optional` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit | variants by mode (object / object / object / object) | `default {"mode":"pause"}` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 1&gt;.mode | "pause" | `required` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 2&gt;.mode | "fail" | `required` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 3&gt;.mode | "accept_last" | `required` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt;.mode | "accept_best" | `required` | — |
| stages[]&lt;variant 3&gt;.loop.onLimit&lt;variant 4&gt;.score | string | `required` | min 1; max 2000 |
| stages[]&lt;variant 3&gt;.loop.wrapUp | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.wrapUp.stage | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 3&gt;.loop.wrapUp.prompt | object | `required` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.wrapUp.prompt.label | string | `required` | min 1; max 200 |
| stages[]&lt;variant 3&gt;.loop.wrapUp.prompt.text | string | `required` | min 1; max 100000 |
| stages[]&lt;variant 3&gt;.loop.wrapUp.maxTurns | number | `default 1` | int; min 1; max 5 |
| stages[]&lt;variant 3&gt;.loop.wrapUp.maxCostShare | number | `default 0.1` | min 0; max 0.5 |
| stages[]&lt;variant 3&gt;.loop.onBodyFailure | "fail" / "next_iteration" | `default "fail"` | — |
| stages[]&lt;variant 3&gt;.loop.checkpointEachIteration | boolean | `optional` | — |
| stages[]&lt;variant 3&gt;.loop.output | object | `default {}` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.loop.output.select | map of string | `optional` | — |
| stages[]&lt;variant 3&gt;.budget | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 3&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| stages[]&lt;variant 3&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| stages[]&lt;variant 3&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| stages[]&lt;variant 3&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| stages[]&lt;variant 4&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 4&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 4&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 4&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 4&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 4&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 4&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 4&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 4&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 4&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 4&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 4&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 4&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 4&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 4&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 4&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 4&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 4&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 4&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 4&gt;.kind | "map" | `required` | — |
| stages[]&lt;variant 4&gt;.map | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.map.items | string | `required` | min 1; max 2000 |
| stages[]&lt;variant 4&gt;.map.itemKey | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 4&gt;.map.maxItems | number | `default 50` | int; min 1; max 200 |
| stages[]&lt;variant 4&gt;.map.concurrency | number | `default 4` | int; min 1; max 16 |
| stages[]&lt;variant 4&gt;.map.toleratedFailurePercent | number | `default 0` | min 0; max 100 |
| stages[]&lt;variant 4&gt;.map.workspace | "shared" / "mount_per_item" | `default "shared"` | — |
| stages[]&lt;variant 4&gt;.map.merge | "none" / "sequential" / "pr_per_item" | `default "none"` | — |
| stages[]&lt;variant 4&gt;.map.itemSetup | array of object | `optional` | maxLength 5 |
| stages[]&lt;variant 4&gt;.map.itemSetup[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.map.itemSetup[].command | string | `required` | regex /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/ |
| stages[]&lt;variant 4&gt;.map.itemSetup[].args | array of string | `default []` | maxLength 64 |
| stages[]&lt;variant 4&gt;.map.itemSetup[].env | map of string | `optional` | — |
| stages[]&lt;variant 4&gt;.map.itemSetup[].mount | string | `optional` | min 1; max 50; regex /^[A-Za-z0-9._-]+$/ |
| stages[]&lt;variant 4&gt;.map.itemSetup[].cwd | string | `optional` | min 1; max 1000; regex /^(?![\\/])(?![A-Za-z]:)(?!(.*[\\/])?\.\.([\\/]&#124;$)).+$/ |
| stages[]&lt;variant 4&gt;.map.itemSetup[].timeoutMs | number | `default 600000` | int; min 1000; max 3600000 |
| stages[]&lt;variant 4&gt;.map.itemSetup[].parseJson | boolean | `default false` | — |
| stages[]&lt;variant 4&gt;.map.itemSetup[].failOnNonZero | boolean | `default false` | — |
| stages[]&lt;variant 4&gt;.map.itemSetup[].tailBytes | number | `default 16384` | int; min 1024; max 262144 |
| stages[]&lt;variant 4&gt;.map.output | object | `default {}` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.map.output.select | map of string | `optional` | — |
| stages[]&lt;variant 4&gt;.budget | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 4&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| stages[]&lt;variant 4&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| stages[]&lt;variant 4&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| stages[]&lt;variant 4&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| stages[]&lt;variant 5&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 5&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 5&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 5&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 5&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 5&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 5&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 5&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 5&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 5&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 5&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 5&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 5&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 5&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 5&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 5&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 5&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 5&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 5&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 5&gt;.kind | "subworkflow" | `required` | — |
| stages[]&lt;variant 5&gt;.subworkflow | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef | union (object / object) | `required` | — |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 1&gt;.id | string | `required` | min 1; max 100 |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 5&gt;.subworkflow.workflowRef&lt;variant 2&gt;.projectScope | "project" / "global" | `optional` | — |
| stages[]&lt;variant 5&gt;.subworkflow.version | union ("pin_at_run_start" / number) | `default "pin_at_run_start"` | — |
| stages[]&lt;variant 5&gt;.subworkflow.inputs | map of string | `default {}` | — |
| stages[]&lt;variant 5&gt;.subworkflow.workspace | "inherit" / "isolated" | `default "inherit"` | — |
| stages[]&lt;variant 5&gt;.budget | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 5&gt;.budget.maxTurns | number | `optional` | int; min 1; max 100000 |
| stages[]&lt;variant 5&gt;.budget.maxCostUsd | number | `optional` | min 0 (exclusive); max 100000 |
| stages[]&lt;variant 5&gt;.budget.maxWallClockMs | number | `optional` | int; min 1000; max 604800000 |
| stages[]&lt;variant 5&gt;.budget.maxTokens | number | `optional` | int; min 1; max 10000000000 |
| stages[]&lt;variant 6&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.key | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 6&gt;.name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 6&gt;.description | string | `optional` | max 2000 |
| stages[]&lt;variant 6&gt;.parentKey | string | `optional` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| stages[]&lt;variant 6&gt;.guard | string | `optional` | min 1; max 2000 |
| stages[]&lt;variant 6&gt;.join | variants by mode (object / object / object) | `default {"mode":"all"}` | — |
| stages[]&lt;variant 6&gt;.join&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.join&lt;variant 1&gt;.mode | "all" | `required` | — |
| stages[]&lt;variant 6&gt;.join&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.join&lt;variant 2&gt;.mode | "any" | `required` | — |
| stages[]&lt;variant 6&gt;.join&lt;variant 2&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 6&gt;.join&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.mode | "n_of_m" | `required` | — |
| stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.n | number | `required` | int; min 1; max 100 |
| stages[]&lt;variant 6&gt;.join&lt;variant 3&gt;.cancelRemaining | boolean | `default false` | — |
| stages[]&lt;variant 6&gt;.position | object | `optional` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.position.x | number | `required` | finite |
| stages[]&lt;variant 6&gt;.position.y | number | `required` | finite |
| stages[]&lt;variant 6&gt;.compensate | array of object | `optional` | maxLength 20 |
| stages[]&lt;variant 6&gt;.compensate[] | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.compensate[].name | string | `required` | min 1; max 200 |
| stages[]&lt;variant 6&gt;.compensate[].config | union (variants by type (object / object / object) / object) | `required` | — |
| stages[]&lt;variant 6&gt;.compensate[].config&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.compensate[].config&lt;variant 2&gt;.type | "restore_checkpoint" | `required` | — |
| stages[]&lt;variant 6&gt;.compensate[].timeoutMs | number | `default 30000` | int; min 100; max 600000 |
| stages[]&lt;variant 6&gt;.compensate[].retries | number | `default 3` | int; min 0; max 5 |
| stages[]&lt;variant 6&gt;.kind | "wait" | `required` | — |
| stages[]&lt;variant 6&gt;.wait | variants by type (object / object / object) | `required` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.type | "approval" | `required` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt.label | string | `required` | min 1; max 200 |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.prompt.text | string | `required` | min 1; max 100000 |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.form | map of unknown | `optional` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.timeoutMs | number | `optional` | int; min 1000; max 2592000000 |
| stages[]&lt;variant 6&gt;.wait&lt;variant 1&gt;.onTimeout | "fail" / "complete" | `default "fail"` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.type | "event" | `required` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.eventKey | string | `required` | min 1; max 2000 |
| stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.timeoutMs | number | `optional` | int; min 1000; max 2592000000 |
| stages[]&lt;variant 6&gt;.wait&lt;variant 2&gt;.onTimeout | "fail" / "complete" | `default "fail"` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt; | object | `required` | unknown keys: strict |
| stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt;.type | "timer" | `required` | — |
| stages[]&lt;variant 6&gt;.wait&lt;variant 3&gt;.durationMs | number | `required` | int; min 1000; max 2592000000 |
| edges | array of object | `default []` | maxLength 500 |
| edges[] | object | `required` | unknown keys: strict |
| edges[].from | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| edges[].to | string | `required` | regex /^[a-z][a-z0-9_]{0,47}$/ |
| edges[].on | "success" / "failure" / "completion" / "always" | `default "success"` | — |
| edges[].when | string | `optional` | min 1; max 2000 |
| edges[].handlesFailure | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete graph.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// WorkflowGraph: the canonical document. Import, export, the builder,
// templates, script builders and definition versions all carry exactly
// this shape.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { MAX_EDGES, MAX_STAGES, WORKFLOW_FORMAT_VERSION } from '../constants.js';
import { EdgeSpecSchema } from './edge.js';
import { StageSpecSchema } from './stage.js';
import { WorkflowSpecSchema } from './workflow.js';

export const WorkflowGraphSchema = z
  .object({
    formatVersion: z.literal(WORKFLOW_FORMAT_VERSION).describe('Document format version; always 2'),
    workflow: WorkflowSpecSchema,
    stages: z.array(StageSpecSchema).max(MAX_STAGES).describe('Stages, keyed by `key`'),
    edges: z.array(EdgeSpecSchema).max(MAX_EDGES).default([]).describe('Edges between stage keys'),
  })
  .strict()
  .describe('A complete workflow definition: settings, stages and edges');

/** A parsed graph (defaults applied). */
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
/** A graph as authored (defaults optional). */
export type WorkflowGraphInput = z.input<typeof WorkflowGraphSchema>;
```

</details>
