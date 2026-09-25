# Templates, hooks and profiles: configuration fields

Generated from `packages/shared/src/config/WorkflowTemplate.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## HookDefinitionSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | — |
| name | string | `required` | — |
| phase | "pre_run" / "post_run" / "pre_clone" / "post_clone" / "pre_prompt" / "post_prompt" / "pre_commit" / "post_commit" / "on_error" / "on_cancel" / "pre_tool_use" / "post_tool_use" / "on_message" / "on_reasoning" / "on_session_start" / "on_session_idle" / "on_session_error" / "on_session_cancelled" / "on_client_start" / "on_client_stop" / "on_client_error" / "on_client_restart" / "on_permission" / "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| type | "script" / "http" / "function" | `required` | — |
| priority | number | `default 0` | — |
| enabled | boolean | `default true` | — |
| failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| timeoutMs | number | `default 30000` | — |
| retries | number | `default 0` | — |
| config | variants by type (object / object / object) | `required` | — |
| config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 1&gt;.type | "script" | `required` | — |
| config&lt;variant 1&gt;.command | string | `required` | — |
| config&lt;variant 1&gt;.args | array of string | `optional` | — |
| config&lt;variant 1&gt;.cwd | string | `optional` | — |
| config&lt;variant 1&gt;.env | map of string | `optional` | — |
| config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 2&gt;.type | "http" | `required` | — |
| config&lt;variant 2&gt;.url | string | `required` | url |
| config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 3&gt;.type | "function" | `required` | — |
| config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| config&lt;variant 3&gt;.args | map of unknown | `optional` | — |

## WorkflowHookDefinitionSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | — |
| name | string | `required` | — |
| phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| type | "script" / "http" / "function" | `required` | — |
| priority | number | `default 0` | — |
| enabled | boolean | `default true` | — |
| failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| timeoutMs | number | `default 30000` | — |
| retries | number | `default 0` | — |
| config | variants by type (object / object / object) | `required` | — |
| config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 1&gt;.type | "script" | `required` | — |
| config&lt;variant 1&gt;.command | string | `required` | — |
| config&lt;variant 1&gt;.args | array of string | `optional` | — |
| config&lt;variant 1&gt;.cwd | string | `optional` | — |
| config&lt;variant 1&gt;.env | map of string | `optional` | — |
| config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 2&gt;.type | "http" | `required` | — |
| config&lt;variant 2&gt;.url | string | `required` | url |
| config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| config&lt;variant 3&gt;.type | "function" | `required` | — |
| config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| config&lt;variant 3&gt;.args | map of unknown | `optional` | — |

## HooksFileConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| version | 1 | `required` | — |
| workflow | array of object | `default []` | — |
| workflow[] | object | `required` | unknown keys: strip |
| workflow[].id | string | `required` | — |
| workflow[].name | string | `required` | — |
| workflow[].phase | "on_run_start" / "on_run_complete" / "on_run_failed" / "on_run_cancelled" / "pre_clone" / "post_clone" / "pre_commit" / "post_commit" / "on_pr_created" / "on_preprocessing_complete" / "on_postprocessing_start" / "on_all_stages_scheduled" / "on_stage_completed" / "on_stage_failed" / "on_parallel_join" | `required` | — |
| workflow[].type | "script" / "http" / "function" | `required` | — |
| workflow[].priority | number | `default 0` | — |
| workflow[].enabled | boolean | `default true` | — |
| workflow[].failurePolicy | "abort" / "skip" / "continue" | `default "skip"` | — |
| workflow[].timeoutMs | number | `default 30000` | — |
| workflow[].retries | number | `default 0` | — |
| workflow[].config | variants by type (object / object / object) | `required` | — |
| workflow[].config&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| workflow[].config&lt;variant 1&gt;.type | "script" | `required` | — |
| workflow[].config&lt;variant 1&gt;.command | string | `required` | — |
| workflow[].config&lt;variant 1&gt;.args | array of string | `optional` | — |
| workflow[].config&lt;variant 1&gt;.cwd | string | `optional` | — |
| workflow[].config&lt;variant 1&gt;.env | map of string | `optional` | — |
| workflow[].config&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| workflow[].config&lt;variant 2&gt;.type | "http" | `required` | — |
| workflow[].config&lt;variant 2&gt;.url | string | `required` | url |
| workflow[].config&lt;variant 2&gt;.method | "GET" / "POST" / "PUT" / "PATCH" / "DELETE" | `required` | — |
| workflow[].config&lt;variant 2&gt;.headers | map of string | `optional` | — |
| workflow[].config&lt;variant 2&gt;.bodyTemplate | string | `optional` | — |
| workflow[].config&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| workflow[].config&lt;variant 3&gt;.type | "function" | `required` | — |
| workflow[].config&lt;variant 3&gt;.modulePath | string | `optional` | — |
| workflow[].config&lt;variant 3&gt;.handlerName | string | `optional` | — |
| workflow[].config&lt;variant 3&gt;.args | map of unknown | `optional` | — |
| stages | map of array of object | `default {}` | — |

## TemplateCategorySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "code-generation" / "code-review" / "testing" / "e2e-testing" / "refactoring" / "documentation" / "deployment" / "custom" / "system" | `required` | — |

## TemplateHarnessConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| model | string | `default "claude-sonnet-4.6"` | — |
| systemMessage | object | `optional` | unknown keys: strip |
| systemMessage.mode | "append" / "replace" | `default "append"` | — |
| systemMessage.content | string | `required` | — |
| systemPromptAppend | string | `optional` | — |
| streaming | boolean | `default true` | — |
| mcpServers | map of object | `default {}` | — |
| mcpServers.{key} | object | `required` | unknown keys: strip |
| mcpServers.{key}.type | "http" / "stdio" | `required` | — |
| mcpServers.{key}.url | string | `optional` | — |
| mcpServers.{key}.command | string | `optional` | — |
| mcpServers.{key}.args | array of string | `optional` | — |
| availableTools | array of string | `default []` | — |
| excludedTools | array of string | `default []` | — |
| skillDirectories | array of string | `default []` | — |
| disabledSkills | array of string | `default []` | — |
| customAgents | array of object | `default []` | — |
| customAgents[] | object | `required` | unknown keys: strip |
| customAgents[].name | string | `required` | — |
| customAgents[].description | string | `required` | — |
| customAgents[].instructions | string | `required` | — |
| customAgents[].tools | array of string | `optional` | — |
| provider | object | `optional` | unknown keys: strip |
| provider.name | string | `required` | — |
| provider.baseUrl | string | `required` | url |
| provider.apiKey | string | `required` | — |
| provider.model | string | `optional` | — |
| configDir | string | `optional` | — |
| reasoningEffort | "low" / "medium" / "high" / "xhigh" / "max" / "ultra" | `optional` | — |
| maxTurns | number | `optional` | int; min 1 |

## ConfigurableVariableSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| type | "string" / "number" / "boolean" / "choice" / "text" / "git_url" / "git_urls" | `required` | — |
| label | string | `required` | min 1 |
| description | string | `optional` | — |
| required | boolean | `default false` | — |
| defaultValue | unknown | `optional` | — |
| options | array of string | `optional` | — |

## PreprocessingStepSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| type | "clone_repo" / "run_script" / "validate_input" / "set_variable" / "conditional" | `required` | — |
| name | string | `required` | — |
| config | map of unknown | `default {}` | — |
| failOnError | boolean | `default false` | — |
| order | number | `default 0` | int; min 0 |

## ResultValidationSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| stageIndex | number | `required` | int; min 0 |
| rules | array of object | `required` | — |
| rules[] | object | `required` | unknown keys: strip |
| rules[].type | "min_length" / "max_length" / "contains" / "not_contains" / "regex" | `required` | — |
| rules[].value | union (string / number) | `required` | — |
| rules[].message | string | `required` | — |

## StageTemplatePromptSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| label | string | `required` | min 1 |
| text | string | `required` | min 1 |
| waitForCompletion | boolean | `default true` | — |

## WorkflowTemplateStageSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1 |
| description | string | `default ""` | — |
| order | number | `required` | int; min 0 |
| prompts | array of object | `default []` | — |
| prompts[] | object | `required` | unknown keys: strip |
| prompts[].label | string | `required` | min 1 |
| prompts[].text | string | `required` | min 1 |
| prompts[].waitForCompletion | boolean | `default true` | — |
| harnessConfigOverrides | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.model | string | `default "claude-sonnet-4.6"` | — |
| harnessConfigOverrides.systemMessage | object | `optional` | unknown keys: strip |
| harnessConfigOverrides.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| harnessConfigOverrides.systemMessage.content | string | `required` | — |
| harnessConfigOverrides.systemPromptAppend | string | `optional` | — |
| harnessConfigOverrides.streaming | boolean | `default true` | — |
| harnessConfigOverrides.mcpServers | map of object | `default {}` | — |
| harnessConfigOverrides.mcpServers.{key} | object | `required` | unknown keys: strip |
| harnessConfigOverrides.mcpServers.{key}.type | "http" / "stdio" | `required` | — |
| harnessConfigOverrides.mcpServers.{key}.url | string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.command | string | `optional` | — |
| harnessConfigOverrides.mcpServers.{key}.args | array of string | `optional` | — |
| harnessConfigOverrides.availableTools | array of string | `default []` | — |
| harnessConfigOverrides.excludedTools | array of string | `default []` | — |
| harnessConfigOverrides.skillDirectories | array of string | `default []` | — |
| harnessConfigOverrides.disabledSkills | array of string | `default []` | — |
| harnessConfigOverrides.customAgents | array of object | `default []` | — |
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
| harnessConfigOverrides.maxTurns | number | `optional` | int; min 1 |
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
| resultValidation | array of object | `optional` | maxLength 20 |
| resultValidation[] | object | `required` | unknown keys: strip |
| resultValidation[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| resultValidation[].value | union (string / number / map of unknown) | `optional` | — |
| resultValidation[].message | string | `required` | — |
| expectedOutput | string | `optional` | max 5000 |
| outputSchema | map of unknown | `optional` | — |
| approvalRequired | boolean | `optional` | — |
| agentRef | string | `optional` | max 128 |
| isLocked | boolean | `default false` | — |

## WorkflowTemplateEdgeSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| fromStageIndex | number | `required` | int; min 0 |
| toStageIndex | number | `required` | int; min 0 |
| edgeType | "on_success" / "on_failure" / "on_completion" / "always" | `default "on_success"` | — |

## WorkflowTemplateSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | — |
| name | string | `required` | min 1 |
| description | string | `default ""` | — |
| category | "code-generation" / "code-review" / "testing" / "e2e-testing" / "refactoring" / "documentation" / "deployment" / "custom" / "system" | `default "custom"` | — |
| version | string | `default "1.0.0"` | — |
| tags | array of string | `default []` | — |
| icon | string | `optional` | — |
| requiresCodebase | boolean | `default false` | — |
| supportsMultipleCodebases | boolean | `default false` | — |
| sessionMode | "single" / "per-stage" / "auto" | `default "auto"` | — |
| harnessConfig | object | `optional` | unknown keys: strip |
| harnessConfig.model | string | `default "claude-sonnet-4.6"` | — |
| harnessConfig.systemMessage | object | `optional` | unknown keys: strip |
| harnessConfig.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| harnessConfig.systemMessage.content | string | `required` | — |
| harnessConfig.systemPromptAppend | string | `optional` | — |
| harnessConfig.streaming | boolean | `default true` | — |
| harnessConfig.mcpServers | map of object | `default {}` | — |
| harnessConfig.mcpServers.{key} | object | `required` | unknown keys: strip |
| harnessConfig.mcpServers.{key}.type | "http" / "stdio" | `required` | — |
| harnessConfig.mcpServers.{key}.url | string | `optional` | — |
| harnessConfig.mcpServers.{key}.command | string | `optional` | — |
| harnessConfig.mcpServers.{key}.args | array of string | `optional` | — |
| harnessConfig.availableTools | array of string | `default []` | — |
| harnessConfig.excludedTools | array of string | `default []` | — |
| harnessConfig.skillDirectories | array of string | `default []` | — |
| harnessConfig.disabledSkills | array of string | `default []` | — |
| harnessConfig.customAgents | array of object | `default []` | — |
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
| harnessConfig.maxTurns | number | `optional` | int; min 1 |
| stages | array of object | `required` | minLength 1 |
| stages[] | object | `required` | unknown keys: strip |
| stages[].name | string | `required` | min 1 |
| stages[].description | string | `default ""` | — |
| stages[].order | number | `required` | int; min 0 |
| stages[].prompts | array of object | `default []` | — |
| stages[].prompts[] | object | `required` | unknown keys: strip |
| stages[].prompts[].label | string | `required` | min 1 |
| stages[].prompts[].text | string | `required` | min 1 |
| stages[].prompts[].waitForCompletion | boolean | `default true` | — |
| stages[].harnessConfigOverrides | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.model | string | `default "claude-sonnet-4.6"` | — |
| stages[].harnessConfigOverrides.systemMessage | object | `optional` | unknown keys: strip |
| stages[].harnessConfigOverrides.systemMessage.mode | "append" / "replace" | `default "append"` | — |
| stages[].harnessConfigOverrides.systemMessage.content | string | `required` | — |
| stages[].harnessConfigOverrides.systemPromptAppend | string | `optional` | — |
| stages[].harnessConfigOverrides.streaming | boolean | `default true` | — |
| stages[].harnessConfigOverrides.mcpServers | map of object | `default {}` | — |
| stages[].harnessConfigOverrides.mcpServers.{key} | object | `required` | unknown keys: strip |
| stages[].harnessConfigOverrides.mcpServers.{key}.type | "http" / "stdio" | `required` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.url | string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.command | string | `optional` | — |
| stages[].harnessConfigOverrides.mcpServers.{key}.args | array of string | `optional` | — |
| stages[].harnessConfigOverrides.availableTools | array of string | `default []` | — |
| stages[].harnessConfigOverrides.excludedTools | array of string | `default []` | — |
| stages[].harnessConfigOverrides.skillDirectories | array of string | `default []` | — |
| stages[].harnessConfigOverrides.disabledSkills | array of string | `default []` | — |
| stages[].harnessConfigOverrides.customAgents | array of object | `default []` | — |
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
| stages[].harnessConfigOverrides.maxTurns | number | `optional` | int; min 1 |
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
| stages[].resultValidation | array of object | `optional` | maxLength 20 |
| stages[].resultValidation[] | object | `required` | unknown keys: strip |
| stages[].resultValidation[].type | "contains" / "not_contains" / "min_length" / "max_length" / "regex" / "custom_script" / "json_schema" / "llm_validation" | `required` | — |
| stages[].resultValidation[].value | union (string / number / map of unknown) | `optional` | — |
| stages[].resultValidation[].message | string | `required` | — |
| stages[].expectedOutput | string | `optional` | max 5000 |
| stages[].outputSchema | map of unknown | `optional` | — |
| stages[].approvalRequired | boolean | `optional` | — |
| stages[].agentRef | string | `optional` | max 128 |
| stages[].isLocked | boolean | `default false` | — |
| edges | array of object | `default []` | — |
| edges[] | object | `required` | unknown keys: strip |
| edges[].fromStageIndex | number | `required` | int; min 0 |
| edges[].toStageIndex | number | `required` | int; min 0 |
| edges[].edgeType | "on_success" / "on_failure" / "on_completion" / "always" | `default "on_success"` | — |
| preprocessingSteps | array of object | `default []` | — |
| preprocessingSteps[] | object | `required` | unknown keys: strip |
| preprocessingSteps[].type | "clone_repo" / "run_script" / "validate_input" / "set_variable" / "conditional" | `required` | — |
| preprocessingSteps[].name | string | `required` | — |
| preprocessingSteps[].config | map of unknown | `default {}` | — |
| preprocessingSteps[].failOnError | boolean | `default false` | — |
| preprocessingSteps[].order | number | `default 0` | int; min 0 |
| variables | array of object | `default []` | — |
| variables[] | object | `required` | unknown keys: strip |
| variables[].name | string | `required` | min 1; regex /^[a-zA-Z_][a-zA-Z0-9_]*$/ |
| variables[].type | "string" / "number" / "boolean" / "choice" / "text" / "git_url" / "git_urls" | `required` | — |
| variables[].label | string | `required` | min 1 |
| variables[].description | string | `optional` | — |
| variables[].required | boolean | `default false` | — |
| variables[].defaultValue | unknown | `optional` | — |
| variables[].options | array of string | `optional` | — |
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
| resultValidations | array of object | `default []` | — |
| resultValidations[] | object | `required` | unknown keys: strip |
| resultValidations[].stageIndex | number | `required` | int; min 0 |
| resultValidations[].rules | array of object | `required` | — |
| resultValidations[].rules[] | object | `required` | unknown keys: strip |
| resultValidations[].rules[].type | "min_length" / "max_length" / "contains" / "not_contains" / "regex" | `required` | — |
| resultValidations[].rules[].value | union (string / number) | `required` | — |
| resultValidations[].rules[].message | string | `required` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete WorkflowTemplate.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// Template System — schemas for Workflow Templates
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { REASONING_EFFORTS } from '../types/ProviderConfig.js';

// ── Hook Definition (shared across templates) ──────────────────

export const HookDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum([
    'pre_run',
    'post_run',
    'pre_clone',
    'post_clone',
    'pre_prompt',
    'post_prompt',
    'pre_commit',
    'post_commit',
    'on_error',
    'on_cancel',
    'pre_tool_use',
    'post_tool_use',
    'on_message',
    'on_reasoning',
    'on_session_start',
    'on_session_idle',
    'on_session_error',
    // W13 / Finding-7 named this phase in the `HookPhase` TYPE and documented
    // that authors must opt into it separately from `on_session_error` — but
    // it was never added to this enum, so any hook declaring it was rejected
    // at the route boundary and could not be persisted at all. The type and
    // the validator must list the same phases or one of them is a lie.
    'on_session_cancelled',
    'on_client_start',
    'on_client_stop',
    'on_client_error',
    'on_client_restart',
    'on_permission',
    // Workflow-level phases (included for union compat)
    'on_run_start',
    'on_run_complete',
    'on_run_failed',
    'on_run_cancelled',
    'on_pr_created',
    'on_preprocessing_complete',
    'on_postprocessing_start',
    'on_all_stages_scheduled',
    'on_stage_completed',
    'on_stage_failed',
    'on_parallel_join',
  ]),
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
  failurePolicy: z.enum(['abort', 'skip', 'continue']).default('skip'),
  timeoutMs: z.number().default(30_000),
  retries: z.number().default(0),
  config: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('script'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      headers: z.record(z.string()).optional(),
      bodyTemplate: z.string().optional(),
    }),
    z.object({
      type: z.literal('function'),
      modulePath: z.string().optional(),
      handlerName: z.string().optional(),
      args: z.record(z.unknown()).optional(),
    }),
  ]),
});

// ── Workflow-Level Hook Definition ─────────────────────────────

export const WorkflowHookDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum([
    // Run lifecycle
    'on_run_start', 'on_run_complete', 'on_run_failed', 'on_run_cancelled',
    // Git / SCM (reuse)
    'pre_clone', 'post_clone', 'pre_commit', 'post_commit', 'on_pr_created',
    // Orchestration
    'on_preprocessing_complete', 'on_postprocessing_start', 'on_all_stages_scheduled',
    // Cross-stage coordination
    'on_stage_completed', 'on_stage_failed', 'on_parallel_join',
  ]),
  type: z.enum(['script', 'http', 'function']),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
  failurePolicy: z.enum(['abort', 'skip', 'continue']).default('skip'),
  timeoutMs: z.number().default(30_000),
  retries: z.number().default(0),
  config: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('script'),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      headers: z.record(z.string()).optional(),
      bodyTemplate: z.string().optional(),
    }),
    z.object({
      type: z.literal('function'),
      modulePath: z.string().optional(),
      handlerName: z.string().optional(),
      args: z.record(z.unknown()).optional(),
    }),
  ]),
});

// ── Hooks File Config Schema ───────────────────────────────────

export const HooksFileConfigSchema = z.object({
  version: z.literal(1),
  workflow: z.array(WorkflowHookDefinitionSchema).default([]),
  stages: z.record(z.array(HookDefinitionSchema)).default({}),
});

// ── Template Category ──────────────────────────────────────────

export const TemplateCategorySchema = z.enum([
  'code-generation',
  'code-review',
  'testing',
  'e2e-testing',
  'refactoring',
  'documentation',
  'deployment',
  'custom',
  'system',
]);

// ── Harness Config (shared LLM/agent configuration) ────────────

export const TemplateHarnessConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4.6'),
  systemMessage: z
    .object({
      mode: z.enum(['append', 'replace']).default('append'),
      content: z.string(),
    })
    .optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().default(true),
  mcpServers: z
    .record(
      z.object({
        type: z.enum(['http', 'stdio']),
        url: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
      }),
    )
    .default({}),
  availableTools: z.array(z.string()).default([]),
  excludedTools: z.array(z.string()).default([]),
  skillDirectories: z.array(z.string()).default([]),
  disabledSkills: z.array(z.string()).default([]),
  customAgents: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        instructions: z.string(),
        tools: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  provider: z
    .object({
      name: z.string(),
      baseUrl: z.string().url(),
      apiKey: z.string(),
      model: z.string().optional(),
    })
    .optional(),
  configDir: z.string().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  maxTurns: z.number().int().min(1).optional(),
}).default({});

// ── Configurable Variable ──────────────────────────────────────

export const ConfigurableVariableSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Variable name must be a valid identifier'),
  type: z.enum(['string', 'number', 'boolean', 'choice', 'text', 'git_url', 'git_urls']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

// ── Preprocessing Step ─────────────────────────────────────────

export const PreprocessingStepSchema = z.object({
  type: z.enum(['clone_repo', 'run_script', 'validate_input', 'set_variable', 'conditional']),
  name: z.string(),
  config: z.record(z.unknown()).default({}),
  failOnError: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

// ── Result Validation Rule ─────────────────────────────────────

export const ResultValidationSchema = z.object({
  stageIndex: z.number().int().min(0),
  rules: z.array(z.object({
    type: z.enum(['min_length', 'max_length', 'contains', 'not_contains', 'regex']),
    value: z.union([z.string(), z.number()]),
    message: z.string(),
  })),
});

// ── Template stage prompt ──────────────────────────────────────

export const StageTemplatePromptSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
  waitForCompletion: z.boolean().default(true),
});

// ── Workflow Template Stage ────────────────────────────────────

export const WorkflowTemplateStageSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  order: z.number().int().min(0),
  prompts: z.array(StageTemplatePromptSchema).default([]),
  harnessConfigOverrides: TemplateHarnessConfigSchema.optional(),
  hooks: z.array(HookDefinitionSchema).default([]),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(0),
    backoffMs: z.number().int().min(100).default(1000),
    backoffMultiplier: z.number().min(1).default(2),
  }).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  condition: z.object({
    type: z.enum(['always', 'on_success', 'on_failure', 'expression']),
    expression: z.string().optional(),
  }).optional(),
  /**
   * Execution settings carried through export/import.
   *
   * These are all optional and were previously absent, which meant
   * `GET /workflow-definitions/:id/export` produced JSON that dropped every
   * stage's run condition, context filter, validation rules and approval
   * gate — `import-json` has always read them, only the exporter never wrote
   * them, so a round-trip silently returned a different workflow.
   */
  contextFilter: z.enum(['full', 'summary-only', 'none', 'structured']).optional(),
  contextSources: z.array(z.string().min(1).max(200)).max(50).optional(),
  outputFormat: z.enum(['text', 'json']).optional(),
  resultValidation: z
    .array(
      z.object({
        type: z.enum([
          'contains',
          'not_contains',
          'min_length',
          'max_length',
          'regex',
          'custom_script',
          'json_schema',
          'llm_validation',
        ]),
        value: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
        message: z.string(),
      }),
    )
    .max(20)
    .optional(),
  expectedOutput: z.string().max(5000).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  approvalRequired: z.boolean().optional(),
  agentRef: z.string().max(128).optional(),

  /** Whether the user can modify this stage's prompts */
  isLocked: z.boolean().default(false),
});

// ── Workflow Template Edge ─────────────────────────────────────

export const WorkflowTemplateEdgeSchema = z.object({
  fromStageIndex: z.number().int().min(0),
  toStageIndex: z.number().int().min(0),
  edgeType: z.enum(['on_success', 'on_failure', 'on_completion', 'always']).default('on_success'),
});

// ── Workflow Template (full DAG blueprint) ─────────────────────

export const WorkflowTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: TemplateCategorySchema.default('custom'),
  version: z.string().default('1.0.0'),
  tags: z.array(z.string()).default([]),
  icon: z.string().optional(),

  /** Whether the workflow requires a codebase */
  requiresCodebase: z.boolean().default(false),
  /** Whether multiple codebases are supported */
  supportsMultipleCodebases: z.boolean().default(false),

  /** Session mode for harness sessions */
  sessionMode: z.enum(['single', 'per-stage', 'auto']).default('auto'),

  /** Workflow-level agent harness configuration */
  harnessConfig: TemplateHarnessConfigSchema.optional(),

  /** DAG stages */
  stages: z.array(WorkflowTemplateStageSchema).min(1),
  /** DAG edges (using stage array indices) */
  edges: z.array(WorkflowTemplateEdgeSchema).default([]),

  /** Preprocessing steps (run before DAG execution) */
  preprocessingSteps: z.array(PreprocessingStepSchema).default([]),

  /** Variables users fill in when creating from this template */
  variables: z.array(ConfigurableVariableSchema).default([]),

  /** Hooks at the workflow level */
  hooks: z.array(HookDefinitionSchema).default([]),

  /** Result validations (post-stage output checks) */
  resultValidations: z.array(ResultValidationSchema).default([]),
});

export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;



// ── Template stage → CreateStageParams ─────────────────────────

export type WorkflowTemplateStage = z.infer<typeof WorkflowTemplateStageSchema>;

/**
 * Map one template stage onto the params `addStage` takes.
 *
 * Both entry points that materialise a template into a real workflow —
 * `WorkflowDefinitionService.importFromJSON` (import JSON / round-trip an
 * export) and `WorkflowDefinitionService.importFromTemplate` (Settings →
 * Templates → Use) — must use this. They previously each hand-wrote the
 * mapping and had drifted apart, silently discarding retry policies,
 * timeouts, conditions, validation rules, approval gates, hooks and model
 * overrides the template declared.
 */
export function templateStageToCreateParams(
  stage: WorkflowTemplateStage,
  workflowDefinitionId: string,
  order?: number,
): Record<string, unknown> {
  return {
    workflowDefinitionId,
    name: stage.name,
    description: stage.description,
    order: order ?? stage.order,
    prompts: stage.prompts,
    harnessConfigOverrides: stage.harnessConfigOverrides,
    hooks: stage.hooks,
    retryPolicy: stage.retryPolicy ?? undefined,
    timeoutMs: stage.timeoutMs ?? undefined,
    condition: stage.condition ?? undefined,
    contextFilter: stage.contextFilter ?? undefined,
    contextSources: stage.contextSources ?? undefined,
    outputFormat: stage.outputFormat ?? undefined,
    agentRef: stage.agentRef ?? undefined,
    resultValidation: stage.resultValidation ?? undefined,
    expectedOutput: stage.expectedOutput ?? undefined,
    outputSchema: stage.outputSchema ?? undefined,
    approvalRequired: stage.approvalRequired ?? false,
  };
}
```

</details>
