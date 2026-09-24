---
mdx:
  format: mdx
---

import ExampleDownload from "@site/src/components/ExampleDownload";

# Worked configuration examples

These examples are validated against the current source schemas by `npm run configuration:generate`. Validation is local and does not create resources, contact endpoints, run agents, or grant permissions. Replace host paths, catalogue IDs and the example UUID with real values from your selected host.

Each JSON body has its own contract. Do not send a run profile to a definition endpoint or a schema-default object to an arbitrary settings endpoint. See the [configuration map](./index.md) for scope and precedence.

## Create a planning chat

Create a chat through the app or POST /api/chats. Replace the host folder with an existing trial repository. The example deliberately starts in plan mode and does not opt into automatic commit/push. Omit the model to use the configured provider default; for GPT-5.6 Sol, select its exact ID from the live Codex model catalogue and ensure that high reasoning is supported.

Contract: `CreateChatSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "name": "Issue tracker — design review",
  "sources": [
    {
      "kind": "folder",
      "path": "/path/to/trial-repository",
      "mode": "in-place",
      "alias": "app"
    }
  ],
  "primary": "app",
  "defaultAgentMode": "plan",
  "permissionMode": "default",
  "harnessConfig": {
    "harnessType": "codex",
    "reasoningEffort": "high"
  },
  "tags": [
    "documentation-example"
  ],
  "browserConfig": {
    "enabled": false
  }
}
```

**Verify:** Open the created chat, confirm its primary source, provider, plan mode and permissions, then send a prompt. Successful schema validation does not establish that the folder or provider exists.

<ExampleDownload file="create-chat.json" />

## Send a brownfield planning prompt

POST /api/chats/:id/prompt with the actual chat ID, or paste the prompt into the composer. For file attachments use multipart form-data with uploaded attachments; the route constructs internal file references from those uploads.

Contract: `SendChatPromptSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "prompt": "Inspect the issue filtering code and tests. Propose a priority filter that preserves saved URLs. Ask about ambiguous requirements and produce an implementation plan. Do not modify files, commit, push, or publish.",
  "mode": "plan"
}
```

**Verify:** Watch the transcript and plan surface. Verify that the plan explains migration, test cases, and existing behavior before approving implementation.

<ExampleDownload file="send-prompt.json" />

## Answer a structured interaction

POST /api/chats/:id/interactions/:interactionId/respond. Replace storage and sqlite with the actual question and option IDs supplied by that interaction; these are illustrative IDs.

Contract: `AnswerQuestionSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "answers": {
    "storage": [
      "sqlite"
    ]
  },
  "freeformResponse": "Preserve existing records and make the migration reversible."
}
```

**Verify:** The question should resolve and the running agent should receive the selected values and freeform context.

<ExampleDownload file="answer-question.json" />

## Edit a plan with optimistic concurrency

PUT /api/chats/:id/plans/:planId/content. Read the plan first and use its current revision instead of assuming 1.

Contract: `UpdatePlanContentSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "content": "# Priority filter\n\nPreserve existing URLs. Add parsing, accessible controls, and regression tests.",
  "expectedRevision": 1,
  "summary": "Add compatibility and accessibility acceptance criteria."
}
```

**Verify:** A stale revision must be reconciled after a 409 response; do not repeatedly overwrite with an old revision.

<ExampleDownload file="edit-plan.json" />

## Approve the current plan for implementation

POST /api/chats/:id/plans/:planId/decision only after reviewing that exact revision. This starts implementation and is different from saving a plan edit.

Contract: `PlanDecisionSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "approved": true,
  "action": "implement_interactive",
  "useEditedContent": true,
  "expectedRevision": 1
}
```

**Verify:** Inspect resulting changes and prompts. Plan approval does not itself authorize a commit or push.

<ExampleDownload file="approve-plan.json" />

## Create a reusable implementation agent

Create this definition in Agents or POST /api/agents. Add actual skill/MCP catalogue IDs after testing those resources. For project scope include the real projectId.

Contract: `CreateAgentSchema` in `packages/shared/src/config/AgentSchemas.ts`.

```json
{
  "scope": "global",
  "slug": "careful-implementer",
  "name": "Careful implementer",
  "description": "Implements focused changes while preserving existing behavior and reporting tests.",
  "instructions": "Inspect the repository first. Follow existing conventions. Ask before destructive changes. Run focused tests. Never commit or push unless the user requests it.",
  "role": "agent",
  "projection": "append",
  "skillIds": [],
  "mcpServerIds": [],
  "tools": {
    "fileRead": true,
    "fileWrite": true,
    "shell": true,
    "browser": false,
    "widgets": false,
    "extensionAuthoring": false,
    "orchestration": false,
    "web": false
  },
  "runtime": {
    "harnessType": "codex",
    "reasoningEffort": "high",
    "permissionMode": "default",
    "defaultAgentMode": "auto"
  }
}
```

**Verify:** Preview effective capabilities in the editor; bind the saved portable agent reference to a chat or stage and inspect the resolved tools.

<ExampleDownload file="create-agent.json" />

## Add a skill while narrowing tools

Place this object in a chat or stage agentOverrides field, or use the effective-capability preview. Replace the skill ID with a real selectable catalogue ID.

Contract: `AgentOverridesSchema` in `packages/shared/src/config/AgentSchemas.ts`.

```json
{
  "addSkillIds": [
    "REPLACE_WITH_CATALOG_SKILL_ID"
  ],
  "removeMcpServerIds": [],
  "tools": {
    "browser": false,
    "shell": false
  },
  "appendInstructions": "For this review, inspect files and propose changes without executing commands."
}
```

**Verify:** Confirm the effective capabilities rather than assuming an override grants capabilities forbidden by the host, device, or provider.

<ExampleDownload file="agent-overrides.json" />

## Import a multi-stage brownfield workflow

Import JSON through Workflows (the import-json API accepts this shape). Select the actual project and codebases before running: requiresCodebase does not create them. The stage-level plan gate waits for review. If the provider also exposes a separate plan decision, avoid starting implementation there: the next stage owns implementation. A failed verification selects the failure edge; success does not run the failure-only stage.

Contract: `ImportWorkflowJsonSchema` in `packages/shared/src/config/WorkflowDefinitionSchemas.ts`.

```json
{
  "name": "Priority filter — reviewed delivery",
  "sessionMode": "per-stage",
  "harnessConfig": {
    "harnessType": "codex",
    "reasoningEffort": "high",
    "permissionMode": "default"
  },
  "variables": [
    {
      "name": "feature",
      "type": "text",
      "label": "Requested feature",
      "required": true,
      "defaultValue": "Add a priority filter without breaking saved URLs."
    }
  ],
  "tags": [
    "reviewed-change"
  ],
  "orchestratorConfig": {
    "requiresCodebase": true,
    "autoCommit": false,
    "autoPush": false,
    "autoCreatePR": false
  },
  "stages": [
    {
      "name": "Inspect and plan",
      "order": 0,
      "prompts": [
        {
          "label": "Task",
          "text": "Inspect the codebase for {{feature}}. Write a plan with compatibility risks and acceptance tests. Do not implement yet.",
          "source": "inline",
          "waitForCompletion": true
        }
      ],
      "approvalRequired": true,
      "agentMode": "plan",
      "timeoutMs": 300000,
      "contextFilter": "none"
    },
    {
      "name": "Implement",
      "order": 1,
      "prompts": [
        {
          "label": "Task",
          "text": "Implement the approved plan for {{feature}}. Preserve current behavior and keep changes scoped.",
          "source": "inline",
          "waitForCompletion": true
        }
      ],
      "agentMode": "auto",
      "contextFilter": "full",
      "timeoutMs": 600000,
      "retryPolicy": {
        "maxRetries": 1,
        "backoffMs": 1000,
        "backoffMultiplier": 2
      }
    },
    {
      "name": "Verify",
      "order": 2,
      "prompts": [
        {
          "label": "Task",
          "text": "Run the relevant tests. Inspect the diff. Report commands, results, and unresolved defects. Do not commit or push.",
          "source": "inline",
          "waitForCompletion": true
        }
      ],
      "contextFilter": "summary-only",
      "timeoutMs": 600000,
      "resultValidation": [
        {
          "type": "min_length",
          "value": 80,
          "message": "Provide a substantive verification report."
        }
      ]
    },
    {
      "name": "Failure triage",
      "order": 3,
      "prompts": [
        {
          "label": "Task",
          "text": "Explain the failed verification, identify the likely cause, and propose the smallest follow-up. Do not hide failures.",
          "source": "inline",
          "waitForCompletion": true
        }
      ],
      "contextFilter": "full",
      "timeoutMs": 300000
    }
  ],
  "edges": [
    {
      "fromStageIndex": 0,
      "toStageIndex": 1,
      "edgeType": "on_success"
    },
    {
      "fromStageIndex": 1,
      "toStageIndex": 2,
      "edgeType": "on_success"
    },
    {
      "fromStageIndex": 2,
      "toStageIndex": 3,
      "edgeType": "on_failure"
    }
  ]
}
```

**Verify:** Run with a disposable trial repository. Check the plan gate, stage context, timeouts, retry history, Changes, Files, Terminal, and the final report. min_length only checks output length; it does not prove the tests passed.

<ExampleDownload file="review-workflow.json" />

## Configure an individual workflow run

Use a run profile with the actual saved workflowDefinitionId. Definition import JSON, stored definition objects, and run profiles are distinct contracts.

Contract: `RunProfileSchema` in `packages/shared/src/config/WorkflowDefinitionSchemas.ts`.

```json
{
  "version": 1,
  "name": "Priority filter trial",
  "workflowDefinitionId": "11111111-1111-4111-8111-111111111111",
  "variables": {
    "feature": "Add a priority filter without breaking saved URLs."
  },
  "permissionMode": "default",
  "sessionMode": "per-stage",
  "stageOverrides": [
    {
      "stageName": "Verify",
      "timeoutMs": 900000,
      "contextFilter": "full"
    }
  ]
}
```

**Verify:** The run should show the resolved variable values and Verify timeout. Existing definition defaults remain where no override was supplied.

<ExampleDownload file="workflow-run-profile.json" />

## Request changes at a workflow gate

POST /api/workflow-runs/:runId/stages/:stageId/approve at a waiting review gate. outcome rejected terminates that stage; the legacy approved:false means changes_requested, not rejected.

Contract: `StageReviewDecisionSchema` in `packages/shared/src/config/ChatSchemas.ts`.

```json
{
  "outcome": "changes_requested",
  "followUpPrompt": "Add a regression test for the legacy bookmarked URL before continuing."
}
```

**Verify:** Confirm the stage resumes with the requested follow-up and presents its next review state.

<ExampleDownload file="request-stage-changes.json" />

## Run a typed dataset through a workflow

Create in Automations or POST /api/automations, replacing workflowIds with tested definitions. Preview iterations before triggering. Each row exposes its declared fields; maxConcurrency limits simultaneous iterations.

Contract: `CreateAutomationSchema` in `packages/shared/src/config/AutomationSchemas.ts`.

```json
{
  "name": "Review queued fixes",
  "triggerType": "manual",
  "workflowIds": [
    "11111111-1111-4111-8111-111111111111"
  ],
  "inputMode": "single",
  "maxConcurrency": 1,
  "onError": "stop",
  "dataSchema": {
    "version": 1,
    "format": "json_array",
    "primaryKey": "issueId",
    "fields": [
      {
        "name": "issueId",
        "type": "string",
        "required": true
      },
      {
        "name": "feature",
        "type": "string",
        "required": true
      },
      {
        "name": "priority",
        "type": "number",
        "required": true
      }
    ]
  },
  "iterationMode": {
    "kind": "each_row"
  },
  "defaultDataset": {
    "format": "json_array",
    "data": "[{\"issueId\":\"ISSUE-101\",\"feature\":\"Fix bookmarked priority filter\",\"priority\":1},{\"issueId\":\"ISSUE-102\",\"feature\":\"Improve empty-state instructions\",\"priority\":2}]"
  },
  "retryPolicy": {
    "maxAttempts": 2,
    "initialBackoffMs": 1000,
    "backoffMultiplier": 2,
    "maxBackoffMs": 10000,
    "retryOn": [
      "network",
      "timeout"
    ]
  }
}
```

**Verify:** Expect two iterations with distinct issue IDs and child runs. Review the failing row and policy rather than assuming a successful trigger means all children succeeded.

<ExampleDownload file="manual-automation.json" />

## Schedule a bounded daily run

Save only after the selected workflow succeeds manually. This means 09:00 weekdays in the named IANA timezone. run_once coalesces missed work; it does not promise replay of every missed tick.

Contract: `CreateAutomationSchema` in `packages/shared/src/config/AutomationSchemas.ts`.

```json
{
  "name": "Weekday repository review",
  "triggerType": "schedule",
  "cronExpression": "0 9 * * MON-FRI",
  "timezone": "Asia/Kolkata",
  "missedRunPolicy": "run_once",
  "overlapPolicy": "skip",
  "workflowIds": [
    "11111111-1111-4111-8111-111111111111"
  ],
  "inputMode": "single",
  "variables": {
    "feature": "Inspect dependency updates and report actionable changes."
  },
  "maxConcurrency": 1,
  "onError": "stop"
}
```

**Verify:** Check the calculated next run time, overlap behavior, execution history, and the host being available at the scheduled time.

<ExampleDownload file="scheduled-automation.json" />

## Preview grouped automation iterations

POST /api/automations/preview-iterations. The grouping keys must exist in the schema; use the preview to inspect the variable envelope before execution.

Contract: `PreviewIterationsBodySchema` in `packages/shared/src/config/AutomationSchemas.ts`.

```json
{
  "dataSchema": {
    "version": 1,
    "format": "json_array",
    "fields": [
      {
        "name": "team",
        "type": "string",
        "required": true
      },
      {
        "name": "issueId",
        "type": "string",
        "required": true
      }
    ]
  },
  "iterationMode": {
    "kind": "group_by",
    "fields": [
      "team"
    ],
    "groupVariable": "teamIssues"
  },
  "dataset": {
    "format": "json_array",
    "data": "[{\"team\":\"web\",\"issueId\":\"101\"},{\"team\":\"web\",\"issueId\":\"102\"},{\"team\":\"mobile\",\"issueId\":\"103\"}]"
  }
}
```

**Verify:** Expect two groups, web and mobile, with two and one rows respectively.

<ExampleDownload file="group-dataset.json" />

## Read automation input from HTTP

Use Test data source in the automation form with your actual permitted endpoint. The URL is illustrative and is not contacted by documentation validation. Add secrets through the host configuration path, not public example files.

Contract: `TestDataSourceSchema` in `packages/shared/src/config/AutomationSchemas.ts`.

```json
{
  "type": "http",
  "url": "https://api.example.com/issues",
  "method": "GET",
  "resultPath": "items",
  "timeout": 10000,
  "schema": {
    "requiredFields": [
      "issueId",
      "feature"
    ],
    "maxItems": 100
  }
}
```

**Verify:** Inspect the extracted rows, required-field errors, timeout behavior, and host network restrictions.

<ExampleDownload file="http-data-source.json" />

## Enable a bounded workspace browser

Use as browserConfig on a chat/workflow or a stage override. Headless still supports the streamed browser surface. Hosts and permissions must match the actual preview; do not use a wildcard merely to bypass an error.

Contract: `BrowserConfigSchema` in `packages/shared/src/config/BrowserConfigSchema.ts`.

```json
{
  "enabled": true,
  "mode": "auto",
  "visibility": "headless",
  "viewport": {
    "width": 1280,
    "height": 800
  },
  "allowedHosts": [
    "localhost",
    "127.0.0.1"
  ],
  "persistProfile": false,
  "screencastFps": 8,
  "screencastQuality": 75,
  "idlePauseMinutes": 10,
  "evalAllowed": false,
  "dialogPolicy": "ask",
  "recordVideo": false,
  "allowLocalhostSelfSigned": false
}
```

**Verify:** Start the preview server, open Browser, navigate to its host, and verify that disallowed destinations and unsupported operations are refused.

<ExampleDownload file="browser-config.json" />

## Register a remote MCP connection

Use Settings → MCP Servers or the project MCP form with your actual endpoint. Supply required headers through the credential controls. For http/sse, env is rejected when non-empty; credentials in headers are transport-specific.

Contract: `McpServerBodySchema` in `packages/shared/src/config/McpSchemas.ts`.

```json
{
  "name": "Team docs",
  "serverType": "http",
  "url": "https://mcp.example.com/mcp",
  "timeoutMs": 30000,
  "enabled": true
}
```

**Verify:** Check readiness and actual tools after connection; a saved enabled flag alone does not establish connectivity.

<ExampleDownload file="mcp-http.json" />

## Register a host-side MCP command

Replace the path with a trusted MCP implementation on the GeneratorAI host. The documentation does not install or launch this command. stdio requires command and rejects non-empty headers.

Contract: `McpServerBodySchema` in `packages/shared/src/config/McpSchemas.ts`.

```json
{
  "name": "Local review tools",
  "serverType": "stdio",
  "command": "node",
  "args": [
    "/path/to/trusted-mcp-server/index.js"
  ],
  "timeoutMs": 30000,
  "enabled": true
}
```

**Verify:** Confirm host executable discovery and handshake errors. The command runs on the host, not on the phone or browser client.

<ExampleDownload file="mcp-stdio.json" />

## Describe an executable extension

Save as extension.json beside a real ES-module entry exporting the extension loader. Register contributions imperatively through the ExtensionAPI; there is no declarative contributes block.

Contract: `ExtensionManifestSchema` in `packages/shared/src/config/ExtensionManifestSchema.ts`.

```json
{
  "id": "example.review-tools",
  "name": "Review Tools",
  "version": "1.0.0",
  "description": "Workspace review helpers",
  "entry": "./index.js",
  "permissions": []
}
```

**Verify:** Install in User scope and inspect load errors. Manifest validation cannot establish that the entry file exists or that its code behaves correctly.

<ExampleDownload file="extension-manifest.json" />

## Define a bounded worker brief

This is the background-agent brief contract used by orchestrator tooling, not a standalone REST chat-creation body. Worker model and agent references are resolved against available provider/team policy.

Contract: `TaskBriefSchema` in `packages/shared/src/config/OrchestratorSchemas.ts`.

```json
{
  "taskName": "Review URL compatibility",
  "objective": "Inspect priority-filter URL parsing and report compatibility regressions with file references.",
  "context": "A new priority filter must preserve existing bookmarked issue URLs.",
  "boundaries": "Read only. Do not edit files, install dependencies, commit, or push.",
  "sharedWorkspace": true,
  "budget": {
    "maxTokens": 8000,
    "maxToolCalls": 30
  }
}
```

**Verify:** Inspect the Background tasks pane and digest artifacts. Shared workspace means changes would be visible to the parent; boundaries must be explicit.

<ExampleDownload file="background-task.json" />

## Configure CLI output and TUI behavior

Use the CLI configuration commands or the resolved configuration file shown by config show --sources. Pair/select a real connection separately; this example contains no credential.

Contract: `CliConfigSchema` in `packages/cli-core/src/config/schema.ts`.

```json
{
  "configVersion": 2,
  "server": {
    "url": "http://localhost:3100",
    "timeoutMs": 120000
  },
  "cli": {
    "output": "json",
    "color": "auto",
    "unicode": true,
    "assumeYes": false,
    "pageSize": 50
  },
  "tui": {
    "theme": "github",
    "appearance": "dark",
    "accent": "blue",
    "maxFps": 30,
    "mouse": false,
    "incrementalRendering": false,
    "showThinking": true,
    "collapseTools": true
  }
}
```

**Verify:** Check resolved sources and selected connection/profile, then run a read-only list command. A profile or flag may override these file values.

<ExampleDownload file="cli-preferences.json" />

## Attach a bounded stage hook

Place this in a stage hooks array. It checks that the host can launch Node before the stage prompt. Host command allowlists and hook policy still apply. Workflow-level hooks use a separate schema and phase set.

Contract: `HookDefinitionSchema` in `packages/shared/src/config/WorkflowTemplate.ts`.

```json
{
  "id": "check-node-runtime",
  "name": "Check Node runtime",
  "phase": "pre_prompt",
  "type": "script",
  "enabled": true,
  "priority": 0,
  "failurePolicy": "abort",
  "timeoutMs": 10000,
  "retries": 0,
  "config": {
    "type": "script",
    "command": "node",
    "args": [
      "--version"
    ]
  }
}
```

**Verify:** Inspect hook output and stage status. With abort policy, a failure should be surfaced instead of silently allowing the stage to proceed.

<ExampleDownload file="stage-hook.json" />

## Configure an executable workflow profile

Use with a trusted loaded workflow script. Unlike a definition run profile, this script profile does not identify a workflowDefinitionId. The loader associates it with its script.

Contract: `ScriptRunProfileSchema` in `packages/shared/src/config/WorkflowScriptSchema.ts`.

```json
{
  "version": 1,
  "name": "review-trial",
  "variables": {
    "objective": "Inspect priority-filter compatibility"
  },
  "permissionMode": "default",
  "sessionMode": "per-stage",
  "stageOverrides": [
    {
      "stageIndex": 0,
      "timeoutMs": 300000,
      "contextFilter": "none"
    }
  ]
}
```

**Verify:** Inspect the compiled graph and selected profile before running; check the resolved variables and stage timeout.

<ExampleDownload file="script-profile.json" />

## Create an instance of an installed widget

Use the widget creation API/tool with an installed descriptor and an active owning session. Replace props/state with the fields that descriptor actually declares. This is an instance body, not an extension manifest.

Contract: `CreateWidgetInstanceSchema` in `packages/shared/src/config/WidgetSchemas.ts`.

```json
{
  "descriptorId": "REPLACE_WITH_INSTALLED_DESCRIPTOR_ID",
  "sessionId": "REPLACE_WITH_ACTIVE_SESSION_ID",
  "surface": "widget",
  "props": {
    "title": "Review checklist"
  },
  "state": {
    "items": []
  }
}
```

**Verify:** The widget should open in its own tab, complete its bridge handshake, and keep state separate from other instances.

<ExampleDownload file="widget-instance.json" />

## Dispatch a declared widget action

Use the actual action name and payload schema advertised by the widget descriptor; validate and section are illustrative. The shared envelope does not establish that a descriptor implements this action.

Contract: `DispatchWidgetActionSchema` in `packages/shared/src/config/WidgetSchemas.ts`.

```json
{
  "action": "validate",
  "payload": {
    "section": "acceptance"
  },
  "from": "user"
}
```

**Verify:** Check the action result and instance state. An unavailable action or denied capability should produce an explicit error.

<ExampleDownload file="widget-action.json" />

