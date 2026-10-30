# Agents, models and sessions

<!-- generated:generated-note -->

Every agent stage runs in a **session**: which agent drives it, on which provider and model, with which
permission mode and tools. `workflow.session` sets the defaults; a stage's `session` is merged over it field by
field, so a stage states only what differs.

## session fields

<!-- generated:session-fields -->

Nested blocks (`agentOverrides`, `mcp`, `browser`, `provider`, …) are listed field by field in `schema.md`.

<!-- generated:provider-enums -->

## Choosing the agent and the model

- `agentRef` is a portable `scope:slug` reference to a saved agent (its instructions, skills, MCP servers and
  tool policy). Use only agents that exist: `generatorai agent list`, or the ones `describe_workflow` shows in
  similar workflows. The server's `validate_workflow` checks that the agent exists and is enabled; the offline
  validator cannot.
- Without `agentRef`, set `model` (a model id from the catalog) or leave both out to use the server default.
  `harnessType` pins the provider; omitted, the provider follows the model.
- `agentOverrides` adds to the bound agent at this stage only: extra skills or MCP servers, tool groups,
  runtime settings, appended instructions, extra allowed or denied tools.
- Give every stage only what it needs. A reviewer does not need file writes; a researcher does not need shell.

## Permission modes

- `plan`: the agent may read but not change anything. Use it for triage, review, research and verification.
- `default`: every tool call that is not auto-allowed asks a person.
- `acceptEdits`: file edits are allowed; other risky tools ask.
- `bypassPermissions`: nothing asks. It is command-bearing (saving needs `admin:settings`), it is the risk flag
  `bypass_permissions`, and computer use is never given to a bypass session. Use it only when the user asks.
- A run can be started with a lower mode than the workflow's; an agent starting a run can never raise it above
  its own.

## Tool groups

`session.agentOverrides.tools` switches platform tool groups on or off for a stage, over the agent's policy:

<!-- generated:tool-groups -->

- `workflows` gives a stage the run tools (`list_workflows`, `describe_workflow`, `run_workflow`,
  `check_workflow_run`, `respond_workflow_approval`, `cancel_workflow_run`). Runs a stage starts nest at most 3
  deep and never start their own ancestor.
- `workflowAuthoring` gives the authoring tools (`get_workflow_authoring_guide`, `validate_workflow`,
  `plan_workflow`, `create_workflow_draft`). A stage can create drafts; it cannot publish them.
- Both are off unless the agent or the stage grants them.

## Provider capabilities

What a session on each provider can be given. The validator and the run plan warn when a stage asks for more
than its provider can do.

<!-- generated:capability-matrix -->

- **Approval gating**: `per_call` asks before any tool call that is not auto-allowed; `exec_and_patch` asks only
  before commands and patches (other tools run unasked); `none` never asks, so `default` and `plan` modes cannot
  be enforced and are refused at run start: use `acceptEdits` or `bypassPermissions` there.
- **Host tools**: `full` gets the platform tools (browser, widgets, workflow tools, platform MCP servers);
  `start_only` gets them only when the session starts; `none` gets none.
- **Structured output**: `native` fills a JSON `output.schema` natively; `tool` through a `submit_output` tool;
  `none` from the last JSON block of the answer. All three are validated the same way.
- **Skills**: `plugin` and `directories` load skills; `none` ignores them.
- **Reports cost**: a `maxCostUsd` budget over stages whose provider reports no cost can never fire
  (`budget-cost-unsupported`); add `maxTurns` or `maxTokens` as well.

## Mixing providers and models

Stages may use different models and providers. Each stage gets its own conversation unless `sessionReuse:
"continue"` (in a loop) or a shared `sessionGroup` says otherwise. A cheaper model is often right for triage,
summaries and reports; use the stronger one for implementation and review.
