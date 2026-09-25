# Workflow definitions and runs: configuration fields

Generated from `packages/shared/src/config/WorkflowDefinitionSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## PromptDefinitionSchema

Zod schema for PromptDefinition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| label | string | `required` | min 1 |
| text | string | `required` | min 1 |
| waitForCompletion | boolean | `default true` | — |

## SkillDefinitionSchema

Zod schema for Skill reference (independent of prompts)

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1 |
| directory | string | `optional` | — |
| description | string | `optional` | — |

## AgentDefinitionSchema

Zod schema for Agent reference (independent of prompts)

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1 |
| description | string | `optional` | — |
| instructions | string | `optional` | — |
| tools | array of string | `optional` | — |

## RetryPolicySchema

Zod schema for RetryPolicy

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| maxRetries | number | `default 0` | int; min 0; max 10 |
| backoffMs | number | `default 1000` | int; min 100 |
| backoffMultiplier | number | `default 2` | min 1 |

## StageConditionSchema

Zod schema for StageCondition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| type | "always" / "on_success" / "on_failure" / "expression" | `required` | — |
| expression | string | `optional` | — |

## VariableDefinitionSchema

Zod schema for VariableDefinition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| label | string | `required` | min 1 |
| description | string | `optional` | — |
| required | boolean | `default false` | — |
| defaultValue | unknown | `optional` | — |
| options | array of string | `optional` | — |

## CreateWorkflowDefinitionSchema

Zod schema for creating a WorkflowDefinition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| sessionMode | "single" / "per-stage" / "auto" | `default "auto"` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
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
| harnessConfig.availableTools | array of string | `optional` | — |
| harnessConfig.excludedTools | array of string | `optional` | — |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | — |
| harnessConfig.skillDirectories | array of string | `optional` | — |
| harnessConfig.disabledSkills | array of string | `optional` | — |
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
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
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
| variables | array of object | `default []` | maxLength 50 |
| variables[] | object | `required` | unknown keys: strip |
| variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| variables[].type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| variables[].label | string | `required` | min 1 |
| variables[].description | string | `optional` | — |
| variables[].required | boolean | `default false` | — |
| variables[].defaultValue | unknown | `optional` | — |
| variables[].options | array of string | `optional` | — |
| tags | array of string | `default []` | maxLength 20 |
| orchestratorConfig | object | `optional` | unknown keys: strip |
| orchestratorConfig.category | "system" / "custom" / "derived" | `default "custom"` | — |
| orchestratorConfig.parentTemplateId | string | `optional` | — |
| orchestratorConfig.codebaseAliases | array of string | `default []` | maxLength 5 |
| orchestratorConfig.preprocessingSteps | array of object | `default []` | — |
| orchestratorConfig.preprocessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.preprocessingSteps[].type | "run_script" / "validate_input" / "set_variable" / "conditional" | `required` | — |
| orchestratorConfig.preprocessingSteps[].name | string | `required` | min 1 |
| orchestratorConfig.preprocessingSteps[].config | map of unknown | `required` | — |
| orchestratorConfig.preprocessingSteps[].failOnError | boolean | `default true` | — |
| orchestratorConfig.preprocessingSteps[].order | number | `default 0` | int; min 0 |
| orchestratorConfig.resultValidations | array of object | `default []` | — |
| orchestratorConfig.resultValidations[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].stageIndex | number | `required` | int; min 0 |
| orchestratorConfig.resultValidations[].rules | array of object | `required` | — |
| orchestratorConfig.resultValidations[].rules[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].rules[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| orchestratorConfig.resultValidations[].rules[].value | union (string / number / map of unknown) | `optional` | — |
| orchestratorConfig.resultValidations[].rules[].message | string | `required` | — |
| orchestratorConfig.requiresCodebase | boolean | `default false` | — |
| orchestratorConfig.autoCommit | boolean | `optional` | — |
| orchestratorConfig.autoPush | boolean | `optional` | — |
| orchestratorConfig.autoCreatePR | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps | array of object | `default []` | — |
| orchestratorConfig.postProcessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.postProcessingSteps[].type | string | `required` | — |
| orchestratorConfig.postProcessingSteps[].name | string | `optional` | — |
| orchestratorConfig.postProcessingSteps[].config | map of unknown | `optional` | — |
| orchestratorConfig.postProcessingSteps[].failOnError | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps[].order | number | `optional` | — |
| projectId | string | `optional` | uuid |
| skills | array of object | `default []` | maxLength 20 |
| skills[] | object | `required` | unknown keys: strip |
| skills[].name | string | `required` | min 1 |
| skills[].directory | string | `optional` | — |
| skills[].description | string | `optional` | — |
| agents | array of object | `default []` | maxLength 10 |
| agents[] | object | `required` | unknown keys: strip |
| agents[].name | string | `required` | min 1 |
| agents[].description | string | `optional` | — |
| agents[].instructions | string | `optional` | — |
| agents[].tools | array of string | `optional` | — |
| hooks | array of object | `optional` | maxLength 50 |
| hooks[] | object | `required` | unknown keys: strip |
| hooks[].id | string | `required` | — |
| hooks[].name | string | `required` | — |
| hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooks[].type | "script" / "http" / "function" | `required` | — |
| hooks[].priority | number | `default 0` | — |
| hooks[].enabled | boolean | `default true` | — |
| hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooks[].timeoutMs | number | `default 30000` | — |
| hooks[].retries | number | `default 0` | — |
| hooks[].config | variants by type (object / object / object) | `required` | — |
| hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooks[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile | object | `optional` | unknown keys: strip |
| hooksFile.version | 1 | `required` | — |
| hooksFile.workflow | array of object | `default []` | — |
| hooksFile.workflow[] | object | `required` | unknown keys: strip |
| hooksFile.workflow[].id | string | `required` | — |
| hooksFile.workflow[].name | string | `required` | — |
| hooksFile.workflow[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooksFile.workflow[].type | "script" / "http" / "function" | `required` | — |
| hooksFile.workflow[].priority | number | `default 0` | — |
| hooksFile.workflow[].enabled | boolean | `default true` | — |
| hooksFile.workflow[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooksFile.workflow[].timeoutMs | number | `default 30000` | — |
| hooksFile.workflow[].retries | number | `default 0` | — |
| hooksFile.workflow[].config | variants by type (object / object / object) | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooksFile.workflow[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile.stages | map of array of object | `default {}` | — |
| selectedArtifacts | object | `optional` | unknown keys: strip |
| selectedArtifacts.skillIds | array of string | `optional` | — |
| selectedArtifacts.agentIds | array of string | `optional` | — |
| selectedArtifacts.promptIds | array of string | `optional` | — |
| useWorktree | boolean | `optional` | — |
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
| defaultAgentRef | string | `optional` | max 128 |

## UpdateWorkflowDefinitionSchema

Zod schema for updating a WorkflowDefinition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `optional` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| sessionMode | "single" / "per-stage" / "auto" | `optional` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
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
| harnessConfig.availableTools | array of string | `optional` | — |
| harnessConfig.excludedTools | array of string | `optional` | — |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | — |
| harnessConfig.skillDirectories | array of string | `optional` | — |
| harnessConfig.disabledSkills | array of string | `optional` | — |
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
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
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
| variables | array of object | `optional` | maxLength 50 |
| variables[] | object | `required` | unknown keys: strip |
| variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| variables[].type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| variables[].label | string | `required` | min 1 |
| variables[].description | string | `optional` | — |
| variables[].required | boolean | `default false` | — |
| variables[].defaultValue | unknown | `optional` | — |
| variables[].options | array of string | `optional` | — |
| tags | array of string | `optional` | maxLength 20 |
| orchestratorConfig | object | `optional` | unknown keys: strip |
| orchestratorConfig.category | "system" / "custom" / "derived" | `default "custom"` | — |
| orchestratorConfig.parentTemplateId | string | `optional` | — |
| orchestratorConfig.codebaseAliases | array of string | `default []` | maxLength 5 |
| orchestratorConfig.preprocessingSteps | array of object | `default []` | — |
| orchestratorConfig.preprocessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.preprocessingSteps[].type | "run_script" / "validate_input" / "set_variable" / "conditional" | `required` | — |
| orchestratorConfig.preprocessingSteps[].name | string | `required` | min 1 |
| orchestratorConfig.preprocessingSteps[].config | map of unknown | `required` | — |
| orchestratorConfig.preprocessingSteps[].failOnError | boolean | `default true` | — |
| orchestratorConfig.preprocessingSteps[].order | number | `default 0` | int; min 0 |
| orchestratorConfig.resultValidations | array of object | `default []` | — |
| orchestratorConfig.resultValidations[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].stageIndex | number | `required` | int; min 0 |
| orchestratorConfig.resultValidations[].rules | array of object | `required` | — |
| orchestratorConfig.resultValidations[].rules[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].rules[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| orchestratorConfig.resultValidations[].rules[].value | union (string / number / map of unknown) | `optional` | — |
| orchestratorConfig.resultValidations[].rules[].message | string | `required` | — |
| orchestratorConfig.requiresCodebase | boolean | `default false` | — |
| orchestratorConfig.autoCommit | boolean | `optional` | — |
| orchestratorConfig.autoPush | boolean | `optional` | — |
| orchestratorConfig.autoCreatePR | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps | array of object | `default []` | — |
| orchestratorConfig.postProcessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.postProcessingSteps[].type | string | `required` | — |
| orchestratorConfig.postProcessingSteps[].name | string | `optional` | — |
| orchestratorConfig.postProcessingSteps[].config | map of unknown | `optional` | — |
| orchestratorConfig.postProcessingSteps[].failOnError | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps[].order | number | `optional` | — |
| projectId | string | `optional; null accepted` | uuid |
| skills | array of object | `optional` | maxLength 20 |
| skills[] | object | `required` | unknown keys: strip |
| skills[].name | string | `required` | min 1 |
| skills[].directory | string | `optional` | — |
| skills[].description | string | `optional` | — |
| agents | array of object | `optional` | maxLength 10 |
| agents[] | object | `required` | unknown keys: strip |
| agents[].name | string | `required` | min 1 |
| agents[].description | string | `optional` | — |
| agents[].instructions | string | `optional` | — |
| agents[].tools | array of string | `optional` | — |
| hooks | array of object | `optional` | maxLength 50 |
| hooks[] | object | `required` | unknown keys: strip |
| hooks[].id | string | `required` | — |
| hooks[].name | string | `required` | — |
| hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooks[].type | "script" / "http" / "function" | `required` | — |
| hooks[].priority | number | `default 0` | — |
| hooks[].enabled | boolean | `default true` | — |
| hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooks[].timeoutMs | number | `default 30000` | — |
| hooks[].retries | number | `default 0` | — |
| hooks[].config | variants by type (object / object / object) | `required` | — |
| hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooks[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile | object | `optional` | unknown keys: strip |
| hooksFile.version | 1 | `required` | — |
| hooksFile.workflow | array of object | `default []` | — |
| hooksFile.workflow[] | object | `required` | unknown keys: strip |
| hooksFile.workflow[].id | string | `required` | — |
| hooksFile.workflow[].name | string | `required` | — |
| hooksFile.workflow[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooksFile.workflow[].type | "script" / "http" / "function" | `required` | — |
| hooksFile.workflow[].priority | number | `default 0` | — |
| hooksFile.workflow[].enabled | boolean | `default true` | — |
| hooksFile.workflow[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooksFile.workflow[].timeoutMs | number | `default 30000` | — |
| hooksFile.workflow[].retries | number | `default 0` | — |
| hooksFile.workflow[].config | variants by type (object / object / object) | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooksFile.workflow[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile.stages | map of array of object | `default {}` | — |
| selectedArtifacts | object | `optional` | unknown keys: strip |
| selectedArtifacts.skillIds | array of string | `optional` | — |
| selectedArtifacts.agentIds | array of string | `optional` | — |
| selectedArtifacts.promptIds | array of string | `optional` | — |
| useWorktree | boolean | `optional` | — |
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
| defaultAgentRef | string | `optional; null accepted` | max 128 |

## CreateStageSchema

Zod schema for creating a StageDefinition

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| workflowDefinitionId | string | `required` | uuid |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| order | number | `optional` | int; min 0 |
| prompts | array of object | `default []` | — |
| prompts[] | object | `required` | unknown keys: strip |
| prompts[].label | string | `required` | min 1 |
| prompts[].text | string | `required` | min 1 |
| prompts[].waitForCompletion | boolean | `default true` | — |
| harnessConfigOverrides | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.model | string | `optional` | — |
| harnessConfigOverrides.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfigOverrides.systemMessage | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| harnessConfigOverrides.systemMessage.content | string | `required` | — |
| harnessConfigOverrides.systemPromptAppend | string | `optional` | — |
| harnessConfigOverrides.streaming | boolean | `optional` | — |
| harnessConfigOverrides.mcpServers | map of object | `optional` | — |
| harnessConfigOverrides.mcpServers.{key} | object | `required` | unknown keys: strip |
| harnessConfigOverrides.mcpServers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| harnessConfigOverrides.mcpServers.{key}.url | string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.headers | map of string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.command | string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.args | array of string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.env | map of string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.cwd | string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.tools | array of string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.timeoutMs | number | `optional` | int; min 0 |
| harnessConfigOverrides.mcpServers.{key}.enabled | boolean | `optional` | — |
| harnessConfigOverrides.availableTools | array of string | `optional` | — |
| harnessConfigOverrides.excludedTools | array of string | `optional` | — |
| harnessConfigOverrides.excludedMcpServerIds | array of string | `optional` | — |
| harnessConfigOverrides.skillDirectories | array of string | `optional` | — |
| harnessConfigOverrides.disabledSkills | array of string | `optional` | — |
| harnessConfigOverrides.customAgents | array of object | `optional` | — |
| harnessConfigOverrides.customAgents[] | object | `required` | unknown keys: strip |
| harnessConfigOverrides.customAgents[].name | string | `required` | — |
| harnessConfigOverrides.customAgents[].description | string | `required` | — |
| harnessConfigOverrides.customAgents[].instructions | string | `required` | — |
| harnessConfigOverrides.customAgents[].tools | array of string | `optional` | — |
| harnessConfigOverrides.provider | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.provider.name | string | `required` | — |
| harnessConfigOverrides.provider.baseUrl | string | `required` | url |
| harnessConfigOverrides.provider.apiKey | string | `required` | — |
| harnessConfigOverrides.provider.model | string | `optional` | — |
| harnessConfigOverrides.configDir | string | `optional` | — |
| harnessConfigOverrides.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfigOverrides.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfigOverrides.maxTurns | number | `optional` | int; min 1 |
| harnessConfigOverrides.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| harnessConfigOverrides.planModeInstructions | string | `optional` | max 20000 |
| harnessConfigOverrides.agentRef | string | `optional` | max 128 |
| harnessConfigOverrides.agentOverrides | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfigOverrides.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| harnessConfigOverrides.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfigOverrides.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| harnessConfigOverrides.agentOverrides.tools | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.agentOverrides.tools.browser | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.widgets | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.orchestration | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.fileRead | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.shell | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.tools.web | boolean | `optional` | — |
| harnessConfigOverrides.agentOverrides.runtime | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.agentOverrides.runtime.model | string | `optional` | max 200 |
| harnessConfigOverrides.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| harnessConfigOverrides.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| harnessConfigOverrides.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfigOverrides.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| harnessConfigOverrides.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| harnessConfigOverrides.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| harnessConfigOverrides.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| harnessConfigOverrides.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| harnessConfigOverrides.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| hooks | array of object | `default []` | — |
| hooks[] | object | `required` | unknown keys: strip |
| hooks[].id | string | `required` | — |
| hooks[].name | string | `required` | — |
| hooks[].phase | "pre_run" / "post_run" / "pre_clone" / "post_clone" / "pre_prompt" / "post_prompt" / "pre_commit" / "post_commit" / "on_error" / "on_cancel" / "pre_tool_use" / "post_tool_use" / "on_message" / "on_reasoning" / "on_session_start" / "on_session_idle" / "on_session_error" / "on_session_cancelled" / "on_client_start" / "on_client_stop" / "on_client_error" / "on_client_restart" / "on_permission" / "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooks[].type | "script" / "http" / "function" | `required` | — |
| hooks[].priority | number | `default 0` | — |
| hooks[].enabled | boolean | `default true` | — |
| hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooks[].timeoutMs | number | `default 30000` | — |
| hooks[].retries | number | `default 0` | — |
| hooks[].config | variants by type (object / object / object) | `required` | — |
| hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooks[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| retryPolicy | object | `optional` | unknown keys: strip |
| retryPolicy.maxRetries | number | `default 0` | int; min 0; max 10 |
| retryPolicy.backoffMs | number | `default 1000` | int; min 100 |
| retryPolicy.backoffMultiplier | number | `default 2` | min 1 |
| timeoutMs | number | `optional` | int; min 1000 |
| condition | object | `optional` | unknown keys: strip |
| condition.type | "always" / "on_success" / "on_failure" / "expression" | `required` | — |
| condition.expression | string | `optional` | — |
| contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| contextSources | array of string | `optional` | maxLength 50 |
| outputFormat | "text" / "json" | `optional` | — |
| skills | array of object | `optional` | maxLength 10 |
| skills[] | object | `required` | unknown keys: strip |
| skills[].name | string | `required` | min 1 |
| skills[].directory | string | `optional` | — |
| skills[].description | string | `optional` | — |
| resultValidation | array of object | `optional` | maxLength 20 |
| resultValidation[] | object | `required` | unknown keys: strip |
| resultValidation[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| resultValidation[].value | union (string / number / map of unknown) | `optional` | — |
| resultValidation[].message | string | `required` | — |
| expectedOutput | string | `optional` | max 5000 |
| outputSchema | map of unknown | `optional` | — |
| approvalRequired | boolean | `optional` | — |
| agentMode | "auto" / "plan" | `optional` | — |
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
| agentRef | string | `optional; null accepted` | max 128 |

## CreateEdgeSchema

Zod schema for creating a StageEdge

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| workflowDefinitionId | string | `required` | uuid |
| fromStageId | string | `required` | uuid |
| toStageId | string | `required` | uuid |
| edgeType | "on_success" / "on_failure" / "on_completion" / "always" | `default "on_success"` | — |

## CreateWorkflowRunSchema

Zod schema for creating a WorkflowRun

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| workflowDefinitionId | string | `required` | uuid |
| variables | map of unknown | `default {}` | — |
| projectId | string | `optional` | uuid |

## WorkflowDefinitionSchema

Full WorkflowDefinition validation schema (for import/export)

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | uuid |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| version | number | `required` | int; min 1 |
| sessionMode | "single" / "per-stage" / "auto" | `required` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
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
| harnessConfig.availableTools | array of string | `optional` | — |
| harnessConfig.excludedTools | array of string | `optional` | — |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | — |
| harnessConfig.skillDirectories | array of string | `optional` | — |
| harnessConfig.disabledSkills | array of string | `optional` | — |
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
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
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
| variables | array of object | `required` | — |
| variables[] | object | `required` | unknown keys: strip |
| variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| variables[].type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| variables[].label | string | `required` | min 1 |
| variables[].description | string | `optional` | — |
| variables[].required | boolean | `default false` | — |
| variables[].defaultValue | unknown | `optional` | — |
| variables[].options | array of string | `optional` | — |
| tags | array of string | `required` | — |
| skills | array of object | `optional` | — |
| skills[] | object | `required` | unknown keys: strip |
| skills[].name | string | `required` | min 1 |
| skills[].directory | string | `optional` | — |
| skills[].description | string | `optional` | — |
| agents | array of object | `optional` | — |
| agents[] | object | `required` | unknown keys: strip |
| agents[].name | string | `required` | min 1 |
| agents[].description | string | `optional` | — |
| agents[].instructions | string | `optional` | — |
| agents[].tools | array of string | `optional` | — |
| createdAt | date (coerced) | `required` | — |
| updatedAt | date (coerced) | `required` | — |

## ImportWorkflowJsonSchema

Zod schema for importing a full workflow from a JSON file upload

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| sessionMode | "single" / "per-stage" / "auto" | `default "auto"` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `optional` | — |
| harnessConfig.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
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
| harnessConfig.availableTools | array of string | `optional` | — |
| harnessConfig.excludedTools | array of string | `optional` | — |
| harnessConfig.excludedMcpServerIds | array of string | `optional` | — |
| harnessConfig.skillDirectories | array of string | `optional` | — |
| harnessConfig.disabledSkills | array of string | `optional` | — |
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
| harnessConfig.contextTier | "default" / "long_context" | `optional` | — |
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| harnessConfig.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
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
| variables | array of object | `default []` | maxLength 50 |
| variables[] | object | `required` | unknown keys: strip |
| variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| variables[].type | "string" / "number" / "boolean" / "choice" / "text" | `required` | — |
| variables[].label | string | `required` | min 1 |
| variables[].description | string | `optional` | — |
| variables[].required | boolean | `default false` | — |
| variables[].defaultValue | unknown | `optional` | — |
| variables[].options | array of string | `optional` | — |
| tags | array of string | `default []` | maxLength 20 |
| stages | array of object | `required` | minLength 1; maxLength 100 |
| stages[] | object | `required` | unknown keys: strip |
| stages[].name | string | `required` | min 1; max 200 |
| stages[].description | string | `optional` | max 2000 |
| stages[].order | number | `required` | int; min 0 |
| stages[].prompts | array of object | `default []` | — |
| stages[].prompts[] | object | `required` | unknown keys: strip |
| stages[].prompts[].label | string | `required` | min 1 |
| stages[].prompts[].text | string | `required` | min 1 |
| stages[].prompts[].waitForCompletion | boolean | `default true` | — |
| stages[].harnessConfigOverrides | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.model | string | `optional` | — |
| stages[].harnessConfigOverrides.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| stages[].harnessConfigOverrides.systemMessage | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| stages[].harnessConfigOverrides.systemMessage.content | string | `required` | — |
| stages[].harnessConfigOverrides.systemPromptAppend | string | `optional` | — |
| stages[].harnessConfigOverrides.streaming | boolean | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers | map of object | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key} | object | `required` | unknown keys: strip |
| stages[].harnessConfigOverrides.mcpServers.{key}.type | "http" / "sse" / "stdio" | `required` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.url | string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.headers | map of string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.command | string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.args | array of string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.env | map of string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.cwd | string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.tools | array of string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.timeoutMs | number | `optional` | int; min 0 |
| stages[].harnessConfigOverrides.mcpServers.{key}.enabled | boolean | `optional` | — |
| stages[].harnessConfigOverrides.availableTools | array of string | `optional` | — |
| stages[].harnessConfigOverrides.excludedTools | array of string | `optional` | — |
| stages[].harnessConfigOverrides.excludedMcpServerIds | array of string | `optional` | — |
| stages[].harnessConfigOverrides.skillDirectories | array of string | `optional` | — |
| stages[].harnessConfigOverrides.disabledSkills | array of string | `optional` | — |
| stages[].harnessConfigOverrides.customAgents | array of object | `optional` | — |
| stages[].harnessConfigOverrides.customAgents[] | object | `required` | unknown keys: strip |
| stages[].harnessConfigOverrides.customAgents[].name | string | `required` | — |
| stages[].harnessConfigOverrides.customAgents[].description | string | `required` | — |
| stages[].harnessConfigOverrides.customAgents[].instructions | string | `required` | — |
| stages[].harnessConfigOverrides.customAgents[].tools | array of string | `optional` | — |
| stages[].harnessConfigOverrides.provider | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.provider.name | string | `required` | — |
| stages[].harnessConfigOverrides.provider.baseUrl | string | `required` | url |
| stages[].harnessConfigOverrides.provider.apiKey | string | `required` | — |
| stages[].harnessConfigOverrides.provider.model | string | `optional` | — |
| stages[].harnessConfigOverrides.configDir | string | `optional` | — |
| stages[].harnessConfigOverrides.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| stages[].harnessConfigOverrides.contextTier | "default" / "long_context" | `optional` | — |
| stages[].harnessConfigOverrides.maxTurns | number | `optional` | int; min 1 |
| stages[].harnessConfigOverrides.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| stages[].harnessConfigOverrides.planModeInstructions | string | `optional` | max 20000 |
| stages[].harnessConfigOverrides.agentRef | string | `optional` | max 128 |
| stages[].harnessConfigOverrides.agentOverrides | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.agentOverrides.addSkillIds | array of string | `optional` | maxLength 100 |
| stages[].harnessConfigOverrides.agentOverrides.removeSkillIds | array of string | `optional` | maxLength 100 |
| stages[].harnessConfigOverrides.agentOverrides.addMcpServerIds | array of string | `optional` | maxLength 100 |
| stages[].harnessConfigOverrides.agentOverrides.removeMcpServerIds | array of string | `optional` | maxLength 100 |
| stages[].harnessConfigOverrides.agentOverrides.tools | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.agentOverrides.tools.browser | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.widgets | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.extensionAuthoring | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.orchestration | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.fileRead | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.fileWrite | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.shell | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.tools.web | boolean | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.runtime | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.agentOverrides.runtime.model | string | `optional` | max 200 |
| stages[].harnessConfigOverrides.agentOverrides.runtime.harnessType | "copilot" / "claude-agent" / "codex" / "opencode" / "acp" | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.runtime.reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.runtime.contextTier | "default" / "long_context" | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.runtime.maxTurns | number | `optional` | int; min 1; max 1000 |
| stages[].harnessConfigOverrides.agentOverrides.runtime.permissionMode | "default" / "acceptEdits" / "bypassPermissions" / "plan" / "dontAsk" | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.runtime.defaultAgentMode | "auto" / "plan" | `optional` | — |
| stages[].harnessConfigOverrides.agentOverrides.appendInstructions | string | `optional` | max 16000 |
| stages[].harnessConfigOverrides.agentOverrides.extraAllow | array of string | `optional` | maxLength 200 |
| stages[].harnessConfigOverrides.agentOverrides.extraDeny | array of string | `optional` | maxLength 200 |
| stages[].hooks | array of object | `default []` | — |
| stages[].hooks[] | object | `required` | unknown keys: strip |
| stages[].hooks[].id | string | `required` | — |
| stages[].hooks[].name | string | `required` | — |
| stages[].hooks[].phase | "pre_run" / "post_run" / "pre_clone" / "post_clone" / "pre_prompt" / "post_prompt" / "pre_commit" / "post_commit" / "on_error" / "on_cancel" / "pre_tool_use" / "post_tool_use" / "on_message" / "on_reasoning" / "on_session_start" / "on_session_idle" / "on_session_error" / "on_session_cancelled" / "on_client_start" / "on_client_stop" / "on_client_error" / "on_client_restart" / "on_permission" / "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| stages[].hooks[].type | "script" / "http" / "function" | `required` | — |
| stages[].hooks[].priority | number | `default 0` | — |
| stages[].hooks[].enabled | boolean | `default true` | — |
| stages[].hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| stages[].hooks[].timeoutMs | number | `default 30000` | — |
| stages[].hooks[].retries | number | `default 0` | — |
| stages[].hooks[].config | variants by type (object / object / object) | `required` | — |
| stages[].hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| stages[].hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| stages[].hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| stages[].hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| stages[].hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| stages[].hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| stages[].hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| stages[].hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| stages[].hooks[].config&lt;variant 2&gt;.url | string | `required` | url |
| stages[].hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| stages[].hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| stages[].hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| stages[].hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| stages[].hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| stages[].hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| stages[].hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| stages[].hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| stages[].retryPolicy | object | `optional` | unknown keys: strip |
| stages[].retryPolicy.maxRetries | number | `default 0` | int; min 0; max 10 |
| stages[].retryPolicy.backoffMs | number | `default 1000` | int; min 100 |
| stages[].retryPolicy.backoffMultiplier | number | `default 2` | min 1 |
| stages[].timeoutMs | number | `optional` | int; min 1000 |
| stages[].condition | object | `optional` | unknown keys: strip |
| stages[].condition.type | "always" / "on_success" / "on_failure" / "expression" | `required` | — |
| stages[].condition.expression | string | `optional` | — |
| stages[].contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| stages[].contextSources | array of string | `optional` | maxLength 50 |
| stages[].outputFormat | "text" / "json" | `optional` | — |
| stages[].skills | array of object | `optional` | maxLength 10 |
| stages[].skills[] | object | `required` | unknown keys: strip |
| stages[].skills[].name | string | `required` | min 1 |
| stages[].skills[].directory | string | `optional` | — |
| stages[].skills[].description | string | `optional` | — |
| stages[].resultValidation | array of object | `optional` | maxLength 20 |
| stages[].resultValidation[] | object | `required` | unknown keys: strip |
| stages[].resultValidation[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| stages[].resultValidation[].value | union (string / number / map of unknown) | `optional` | — |
| stages[].resultValidation[].message | string | `required` | — |
| stages[].expectedOutput | string | `optional` | max 5000 |
| stages[].outputSchema | map of unknown | `optional` | — |
| stages[].approvalRequired | boolean | `optional` | — |
| stages[].agentMode | "auto" / "plan" | `optional` | — |
| stages[].browserConfig | object | `optional` | unknown keys: strict |
| stages[].browserConfig.enabled | boolean | `optional` | — |
| stages[].browserConfig.mode | "auto" / "native" / "screencast" | `optional` | — |
| stages[].browserConfig.visibility | "visible" / "headless" / "off" | `optional` | — |
| stages[].browserConfig.headless | boolean | `optional` | — |
| stages[].browserConfig.viewport | object | `optional` | unknown keys: strip |
| stages[].browserConfig.viewport.width | number | `required` | int; min 320; max 3840 |
| stages[].browserConfig.viewport.height | number | `required` | int; min 240; max 2160 |
| stages[].browserConfig.allowedHosts | array of string | `optional` | maxLength 100 |
| stages[].browserConfig.persistProfile | boolean | `optional` | — |
| stages[].browserConfig.screencastFps | number | `optional` | int; min 1; max 15 |
| stages[].browserConfig.screencastQuality | number | `optional` | int; min 20; max 95 |
| stages[].browserConfig.idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| stages[].browserConfig.evalAllowed | boolean | `optional` | — |
| stages[].browserConfig.dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| stages[].browserConfig.permissions | array of string | `optional` | maxLength 20 |
| stages[].browserConfig.piiRedaction | boolean | `optional` | — |
| stages[].browserConfig.injectionDefense | "off" / "classifier" | `optional` | — |
| stages[].browserConfig.recordVideo | boolean | `optional` | — |
| stages[].browserConfig.allowLocalhostSelfSigned | boolean | `optional` | — |
| stages[].agentRef | string | `optional` | max 128 |
| edges | array of object | `default []` | maxLength 500 |
| edges[] | object | `required` | unknown keys: strip |
| edges[].fromStageIndex | number | `required` | int; min 0 |
| edges[].toStageIndex | number | `required` | int; min 0 |
| edges[].edgeType | "on_success" / "on_failure" / "on_completion" / "always" | `default "on_success"` | — |
| skills | array of object | `default []` | maxLength 20 |
| skills[] | object | `required` | unknown keys: strip |
| skills[].name | string | `required` | min 1 |
| skills[].directory | string | `optional` | — |
| skills[].description | string | `optional` | — |
| agents | array of object | `default []` | maxLength 10 |
| agents[] | object | `required` | unknown keys: strip |
| agents[].name | string | `required` | min 1 |
| agents[].description | string | `optional` | — |
| agents[].instructions | string | `optional` | — |
| agents[].tools | array of string | `optional` | — |
| orchestratorConfig | object | `optional` | unknown keys: strip |
| orchestratorConfig.category | "system" / "custom" / "derived" | `default "custom"` | — |
| orchestratorConfig.parentTemplateId | string | `optional` | — |
| orchestratorConfig.codebaseAliases | array of string | `default []` | maxLength 5 |
| orchestratorConfig.preprocessingSteps | array of object | `default []` | — |
| orchestratorConfig.preprocessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.preprocessingSteps[].type | "run_script" / "validate_input" / "set_variable" / "conditional" | `required` | — |
| orchestratorConfig.preprocessingSteps[].name | string | `required` | min 1 |
| orchestratorConfig.preprocessingSteps[].config | map of unknown | `required` | — |
| orchestratorConfig.preprocessingSteps[].failOnError | boolean | `default true` | — |
| orchestratorConfig.preprocessingSteps[].order | number | `default 0` | int; min 0 |
| orchestratorConfig.resultValidations | array of object | `default []` | — |
| orchestratorConfig.resultValidations[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].stageIndex | number | `required` | int; min 0 |
| orchestratorConfig.resultValidations[].rules | array of object | `required` | — |
| orchestratorConfig.resultValidations[].rules[] | object | `required` | unknown keys: strip |
| orchestratorConfig.resultValidations[].rules[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| orchestratorConfig.resultValidations[].rules[].value | union (string / number / map of unknown) | `optional` | — |
| orchestratorConfig.resultValidations[].rules[].message | string | `required` | — |
| orchestratorConfig.requiresCodebase | boolean | `default false` | — |
| orchestratorConfig.autoCommit | boolean | `optional` | — |
| orchestratorConfig.autoPush | boolean | `optional` | — |
| orchestratorConfig.autoCreatePR | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps | array of object | `default []` | — |
| orchestratorConfig.postProcessingSteps[] | object | `required` | unknown keys: strip |
| orchestratorConfig.postProcessingSteps[].type | string | `required` | — |
| orchestratorConfig.postProcessingSteps[].name | string | `optional` | — |
| orchestratorConfig.postProcessingSteps[].config | map of unknown | `optional` | — |
| orchestratorConfig.postProcessingSteps[].failOnError | boolean | `optional` | — |
| orchestratorConfig.postProcessingSteps[].order | number | `optional` | — |
| projectId | string | `optional` | uuid |
| hooks | array of object | `optional` | maxLength 50 |
| hooks[] | object | `required` | unknown keys: strip |
| hooks[].id | string | `required` | — |
| hooks[].name | string | `required` | — |
| hooks[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooks[].type | "script" / "http" / "function" | `required` | — |
| hooks[].priority | number | `default 0` | — |
| hooks[].enabled | boolean | `default true` | — |
| hooks[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooks[].timeoutMs | number | `default 30000` | — |
| hooks[].retries | number | `default 0` | — |
| hooks[].config | variants by type (object / object / object) | `required` | — |
| hooks[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooks[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooks[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooks[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooks[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooks[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooks[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooks[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooks[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooks[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooks[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooks[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile | object | `optional` | unknown keys: strip |
| hooksFile.version | 1 | `required` | — |
| hooksFile.workflow | array of object | `default []` | — |
| hooksFile.workflow[] | object | `required` | unknown keys: strip |
| hooksFile.workflow[].id | string | `required` | — |
| hooksFile.workflow[].name | string | `required` | — |
| hooksFile.workflow[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| hooksFile.workflow[].type | "script" / "http" / "function" | `required` | — |
| hooksFile.workflow[].priority | number | `default 0` | — |
| hooksFile.workflow[].enabled | boolean | `default true` | — |
| hooksFile.workflow[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| hooksFile.workflow[].timeoutMs | number | `default 30000` | — |
| hooksFile.workflow[].retries | number | `default 0` | — |
| hooksFile.workflow[].config | variants by type (object / object / object) | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.command | string | `required` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.url | string | `required` | url |
| hooksFile.workflow[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| hooksFile.workflow[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| hooksFile.workflow[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| hooksFile.stages | map of array of object | `default {}` | — |
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
| defaultAgentRef | string | `optional` | max 128 |

## StageRunOverrideSchema

Per-stage override schema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| stageName | string | `optional` | — |
| stageIndex | number | `optional` | int; min 0 |
| agentName | string | `optional` | — |
| contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| timeoutMs | number | `optional` | int; min 1000 |
| variables | map of unknown | `optional` | — |
| skip | boolean | `optional` | — |

## RunProfileSchema

RunProfile Zod schema for validation

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| version | 1 | `required` | — |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| workflowDefinitionId | string | `required` | uuid |
| runName | string | `optional` | max 200 |
| variables | map of unknown | `default {}` | — |
| permissionMode | "bypassPermissions" / "default" / "acceptEdits" / "plan" | `optional` | — |
| sessionMode | "single" / "per-stage" / "auto" | `optional` | — |
| projectId | string | `optional` | uuid |
| selectedCodebases | array of string | `optional` | — |
| stageOverrides | array of object | `optional` | maxLength 100 |
| stageOverrides[] | object | `required` | unknown keys: strip; refinement |
| stageOverrides[].stageName | string | `optional` | — |
| stageOverrides[].stageIndex | number | `optional` | int; min 0 |
| stageOverrides[].agentName | string | `optional` | — |
| stageOverrides[].contextFilter | "full" / "summary-only" / "none" / "structured" | `optional` | — |
| stageOverrides[].timeoutMs | number | `optional` | int; min 1000 |
| stageOverrides[].variables | map of unknown | `optional` | — |
| stageOverrides[].skip | boolean | `optional` | — |
| promptFiles | array of string | `optional` | — |
| skillFiles | array of string | `optional` | — |
| agentFiles | array of string | `optional` | — |
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

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete WorkflowDefinitionSchemas.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// WorkflowDefinition Zod validation schemas
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../types/ProviderConfig.js';
import { HookDefinitionSchema, WorkflowHookDefinitionSchema, HooksFileConfigSchema } from './WorkflowTemplate.js';
import { BrowserConfigSchema } from './BrowserConfigSchema.js';
import { McpServerConfigSchema, AgentOverridesSchema } from './AgentSchemas.js';
import { AgentModeSchema } from './ChatSchemas.js';

/** Zod schema for PromptDefinition */
export const PromptDefinitionSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
  waitForCompletion: z.boolean().default(true),
});

/** Zod schema for Skill reference (independent of prompts) */
export const SkillDefinitionSchema = z.object({
  name: z.string().min(1),
  directory: z.string().optional(),
  description: z.string().optional(),
});

/** Zod schema for Agent reference (independent of prompts) */
export const AgentDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

/** Zod schema for RetryPolicy */
export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(0),
  backoffMs: z.number().int().min(100).default(1000),
  backoffMultiplier: z.number().min(1).default(2),
});

/** Zod schema for StageCondition */
export const StageConditionSchema = z.object({
  type: z.enum(['always', 'on_success', 'on_failure', 'expression']),
  expression: z.string().optional(),
});

/** Zod schema for VariableDefinition */
export const VariableDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier'),
  type: z.enum(['string', 'number', 'boolean', 'choice', 'text']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

/** Agent harness config schema — provider-agnostic (supports copilot, claude-agent, etc.) */
const HarnessConfigSchema = z.object({
  model: z.string().optional(),
  /**
   * Agent provider that should run this stage / workflow. Omit to route by
   * `model` (the provider whose live catalog owns it), falling back to the
   * server's primary provider. Lets stage 1 run on Claude and stage 2 on
   * Copilot within the same run.
   */
  harnessType: z.enum(HARNESS_PROVIDER_IDS).optional(),
  systemMessage: z.object({
    mode: z.enum(['append', 'replace']).default('append'),
    content: z.string(),
  }).optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().optional(),
  mcpServers: z.record(McpServerConfigSchema).optional(),
  availableTools: z.array(z.string()).optional(),
  excludedTools: z.array(z.string()).optional(),
  excludedMcpServerIds: z.array(z.string()).optional(),
  skillDirectories: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
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
  contextTier: z.enum(['default', 'long_context']).optional(),
  maxTurns: z.number().int().min(1).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
  planModeInstructions: z.string().max(20_000).optional(),
  /** Portable `scope:slug` ref of the agent driving this scope. */
  agentRef: z.string().max(128).optional(),
  /** Additive capability delta layered on top of the bound agent. */
  agentOverrides: AgentOverridesSchema.optional(),
}).partial();

/** Zod schema for PreprocessingStep */
const PreprocessingStepSchema = z.object({
  type: z.enum(['run_script', 'validate_input', 'set_variable', 'conditional']),
  name: z.string().min(1),
  config: z.record(z.unknown()),
  failOnError: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});

/** Zod schema for a single ResultValidationRule */
const ResultValidationRuleSchema = z.object({
  type: z.enum(['contains', 'not_contains', 'min_length', 'max_length', 'regex', 'custom_script', 'json_schema', 'llm_validation']),
  value: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
  message: z.string(),
});

/** Zod schema for StageResultValidation */
const StageResultValidationSchema = z.object({
  stageIndex: z.number().int().min(0),
  rules: z.array(ResultValidationRuleSchema),
});

/** Zod schema for OrchestratorConfig — uses project/codebase model (no direct git repo cloning) */
const OrchestratorConfigSchema = z.object({
  category: z.enum(['system', 'custom', 'derived']).default('custom'),
  parentTemplateId: z.string().optional(),
  /** Codebase aliases from the linked project to use for this workflow */
  codebaseAliases: z.array(z.string().min(1).max(50)).max(5).default([]),
  preprocessingSteps: z.array(PreprocessingStepSchema).default([]),
  resultValidations: z.array(StageResultValidationSchema).default([]),
  requiresCodebase: z.boolean().default(false),
  autoCommit: z.boolean().optional(),
  /** Push the run's work branch after committing (implied by autoCreatePR). */
  autoPush: z.boolean().optional(),
  autoCreatePR: z.boolean().optional(),
  postProcessingSteps: z.array(z.object({
    type: z.string(),
    name: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    failOnError: z.boolean().optional(),
    order: z.number().optional(),
  })).default([]),
});

/** Zod schema for creating a WorkflowDefinition */
export const CreateWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).default([]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  /** Project ID — scopes this workflow to a project and its codebases */
  projectId: z.string().uuid().optional(),
  /** Skills to use in this workflow (independent of stage prompts) */
  skills: z.array(SkillDefinitionSchema).max(20).default([]),
  /** Agents to use in this workflow (independent of stage prompts) */
  agents: z.array(AgentDefinitionSchema).max(10).default([]),
  /** Workflow-level lifecycle hooks */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Selected artifact IDs for skills/agents/prompts */
  selectedArtifacts: z.object({
    skillIds: z.array(z.string()).optional(),
    agentIds: z.array(z.string()).optional(),
    promptIds: z.array(z.string()).optional(),
  }).optional(),
  /** Whether to create worktrees for project codebases during execution */
  useWorktree: z.boolean().optional(),
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the default agent for stages that do not bind their own. */
  defaultAgentRef: z.string().max(128).optional(),
});

/** Zod schema for updating a WorkflowDefinition */
export const UpdateWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  projectId: z.string().uuid().optional().nullable(),
  skills: z.array(SkillDefinitionSchema).max(20).optional(),
  agents: z.array(AgentDefinitionSchema).max(10).optional(),
  /** Workflow-level lifecycle hooks */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Selected artifact IDs for skills/agents/prompts */
  selectedArtifacts: z.object({
    skillIds: z.array(z.string()).optional(),
    agentIds: z.array(z.string()).optional(),
    promptIds: z.array(z.string()).optional(),
  }).optional(),
  /** Whether to create worktrees for project codebases during execution */
  useWorktree: z.boolean().optional(),
  /** Integrated Browser configuration (workflow-level default). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the default agent for stages that do not bind their own. */
  defaultAgentRef: z.string().max(128).optional().nullable(),
});

/** Zod schema for creating a StageDefinition */
export const CreateStageSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** When omitted, the service auto-appends (`max existing order + 1`). */
  order: z.number().int().min(0).optional(),
  prompts: z.array(PromptDefinitionSchema).default([]),
  harnessConfigOverrides: HarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: StageConditionSchema.optional(),
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  /** Explicit list of stage names to pull context from (overrides DAG predecessors) */
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  /** Output format: 'text' for summary, 'json' for schema-validated JSON */
  outputFormat: z.enum(['text', 'json']).optional(),
  /** Skills specifically for this stage */
  skills: z.array(SkillDefinitionSchema).max(10).optional(),
  /** Per-stage result validation rules */
  resultValidation: z.array(ResultValidationRuleSchema).max(20).optional(),
  /** Expected output description appended to the stage prompt */
  expectedOutput: z.string().max(5000).optional(),
  /** JSON Schema describing the expected structured output */
  outputSchema: z.record(z.unknown()).optional(),
  /** When true, pause the stage in `awaiting_input` after completion for human review before advancing the DAG. Default false. */
  approvalRequired: z.boolean().optional(),
  /** Per-stage agent mode ('auto' | 'plan'). */
  agentMode: AgentModeSchema.optional(),
  /** Integrated Browser overrides for this stage (deep-merged with workflow-level). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the agent driving this stage. */
  agentRef: z.string().max(128).optional().nullable(),
});

/** Zod schema for creating a StageEdge */
export const CreateEdgeSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  fromStageId: z.string().uuid(),
  toStageId: z.string().uuid(),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

/** Zod schema for creating a WorkflowRun */
export const CreateWorkflowRunSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  variables: z.record(z.unknown()).default({}),
  projectId: z.string().uuid().optional(),
});

/** Full WorkflowDefinition validation schema (for import/export) */
export const WorkflowDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  version: z.number().int().min(1),
  sessionMode: z.enum(['single', 'per-stage', 'auto']),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema),
  tags: z.array(z.string()),
  skills: z.array(SkillDefinitionSchema).optional(),
  agents: z.array(AgentDefinitionSchema).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/** Inline stage definition for JSON upload (no workflowDefinitionId needed) */
const ImportStageSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  order: z.number().int().min(0),
  prompts: z.array(PromptDefinitionSchema).default([]),
  harnessConfigOverrides: HarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: StageConditionSchema.optional(),
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  /** Explicit list of stage names to pull context from (overrides DAG predecessors) */
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  /** Output format: 'text' for summary, 'json' for schema-validated JSON */
  outputFormat: z.enum(['text', 'json']).optional(),
  skills: z.array(SkillDefinitionSchema).max(10).optional(),
  /** Per-stage result validation rules */
  resultValidation: z.array(ResultValidationRuleSchema).max(20).optional(),
  /** Expected output description appended to the stage prompt */
  expectedOutput: z.string().max(5000).optional(),
  /** JSON Schema describing the expected structured output */
  outputSchema: z.record(z.unknown()).optional(),
  /** When true, pause after completion for human review before advancing. */
  approvalRequired: z.boolean().optional(),
  /** Per-stage agent mode ('auto' | 'plan'). */
  agentMode: AgentModeSchema.optional(),
  /** Integrated Browser overrides for this stage (deep-merged with workflow-level). */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the agent driving this stage. */
  agentRef: z.string().max(128).optional(),
});

/** Edge definition using stage array indices instead of UUIDs */
const ImportEdgeSchema = z.object({
  fromStageIndex: z.number().int().min(0),
  toStageIndex: z.number().int().min(0),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

/** Zod schema for importing a full workflow from a JSON file upload */
export const ImportWorkflowJsonSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),
  harnessConfig: HarnessConfigSchema.optional(),
  variables: z.array(VariableDefinitionSchema).max(50).default([]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  stages: z.array(ImportStageSchema).min(1, 'At least one stage is required').max(100),
  edges: z.array(ImportEdgeSchema).max(500).default([]),
  /** Skills for the entire workflow */
  skills: z.array(SkillDefinitionSchema).max(20).default([]),
  /** Agents for the entire workflow */
  agents: z.array(AgentDefinitionSchema).max(10).default([]),
  /** Orchestrator configuration */
  orchestratorConfig: OrchestratorConfigSchema.optional(),
  /** Project ID to link to */
  projectId: z.string().uuid().optional(),
  /** Workflow-level lifecycle hooks (on_run_start, on_run_complete, etc.) */
  hooks: z.array(WorkflowHookDefinitionSchema).max(50).optional(),
  /** Imported hooks file config (.hooks.json) */
  hooksFile: HooksFileConfigSchema.optional(),
  /** Integrated Browser configuration */
  browserConfig: BrowserConfigSchema.optional(),
  /** Portable `scope:slug` ref of the default agent for stages that do not bind their own. */
  defaultAgentRef: z.string().max(128).optional(),
});

export type ImportWorkflowJson = z.infer<typeof ImportWorkflowJsonSchema>;

// ────────────────────────────────────────────────────────────────
// RunProfile — Reusable run configuration (CLI + Web)
// ────────────────────────────────────────────────────────────────

/** Per-stage override schema */
export const StageRunOverrideSchema = z.object({
  stageName: z.string().optional(),
  stageIndex: z.number().int().min(0).optional(),
  agentName: z.string().optional(),
  // SCHEMA-2: include 'structured' so runtime/profile overrides can set it,
  // matching StageDefinition.contextFilter and the script-profile override enum.
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  variables: z.record(z.unknown()).optional(),
  skip: z.boolean().optional(),
}).refine(
  (data) => data.stageName !== undefined || data.stageIndex !== undefined,
  { message: 'Either stageName or stageIndex must be provided' },
);

/** RunProfile Zod schema for validation */
export const RunProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  workflowDefinitionId: z.string().uuid(),
  runName: z.string().max(200).optional(),
  variables: z.record(z.unknown()).default({}),
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  sessionMode: z.enum(['single', 'per-stage', 'auto']).optional(),
  projectId: z.string().uuid().optional(),
  selectedCodebases: z.array(z.string()).optional(),
  stageOverrides: z.array(StageRunOverrideSchema).max(100).optional(),
  promptFiles: z.array(z.string()).optional(),
  skillFiles: z.array(z.string()).optional(),
  agentFiles: z.array(z.string()).optional(),
  /** Runtime override — deep-merged on top of workflow.browserConfig. */
  browserConfig: BrowserConfigSchema.optional(),
});

export type RunProfileInput = z.infer<typeof RunProfileSchema>;
```

</details>
