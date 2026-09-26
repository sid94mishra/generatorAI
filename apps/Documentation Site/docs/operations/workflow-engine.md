---
description: How many workflow stages run at once and why a stage waits, what a run may spend, what stage summaries cost, and how to trace workflow runs.
---
# Operating the workflow engine

This page is for whoever runs the GeneratorAI server: how concurrency is limited, how budgets and cost work, what stage summaries cost, and how to trace runs. Workflow authoring is in [Workflows](../features/workflows.md) and [Workflow control flow](../features/workflow-control-flow.md).

## Concurrency: flow keys

Every workflow stage is admitted on its **flow keys**, named limits the server keeps. A stage takes all of its keys at once or waits for all of them. While it waits it stays *ready*, and the run page says what it waits for, for example **ready · waiting for provider claude-agent (4/4)**.

| Key | Limits | Default |
| --- | --- | --- |
| `global` | All agent stages of all runs | Sized from the machine, 2–16 |
| `provider:<id>` | All turns on a provider, chat turns included | `provider:claude-agent`: 4 |
| `model:<id>` | All stages on one model | Not limited until you add it |
| `check:global` | All check stages | 2 |
| `worktree:<mount>` | Writers of a repository while a per-item map uses it | Shown only |
| `run:<id>` | One run's own parallelism (`maxParallel`) | Set in the workflow |

Change them in **Settings → Workflow engine** (you need the admin scope). The table there shows each key live: how many stages or turns hold it, how many wait, and the limit. A change applies at once. Each Claude turn runs a CLI process of roughly 250 MB, so raise `provider:claude-agent` only on a machine with the memory for it.

The same page sets the **trigger debounce**: when the same automation webhook or schedule fires twice within the window with the same payload, the second trigger gets the execution the first one started.

## Budgets and cost

A workflow (or a single run) can have a budget: turns, tokens, wall-clock time and cost in dollars. A stage can have its own. Running out is never treated as success:

- a stage over its budget fails (and then retries or pauses, as the stage says);
- a run over its budget stops launching work and pauses with **Budget exhausted**. You get a push notification on your paired phone. Choose **Raise budget 50%** in the run header (or send `raise_budget` from the CLI) to continue, or cancel the run.

**Cost is shown only when the provider reports it.** Claude reports a dollar cost for each turn; other providers report tokens, and the run shows tokens instead. GeneratorAI never estimates cost from a price list. The run header shows usage against the budget, and the run page's **Usage** tab breaks it down per stage.

## Stage summaries

When a stage reads its predecessors as summaries (the default context mode), the predecessor's **summary** setting decides what the summary costs:

- **auto** (default) — no model call: a JSON stage's own `summary` field or its output keys, a text stage's first 1,200 characters and its headings. Only a text output over 6,000 characters that a later stage reads gets a model-written summary.
- **llm** — a model writes the summary after the stage finishes, on the workflow summary model you choose in Settings → Workflow engine. Only the stages that read the summary wait for it.
- **none** — no summary; readers get the output itself.

## Tracing

Set `OTEL_ENABLED=true` (and `OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4318`) to export traces and metrics over OTLP. A run produces one trace:

- `workflow.run`, with `workflow.loop` / `workflow.iteration` and `workflow.map` / `workflow.item` spans for loops and maps;
- `invoke_agent <stage>` for each stage attempt, with the model, provider and token usage as OpenTelemetry GenAI attributes;
- `chat <model>` for each model turn and `execute_tool <tool>` for each tool call.

Prompts and answers are **not** recorded unless you set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`; they can contain secrets and personal data.

Engine metrics: `workflow.loop.iterations`, `workflow.loop.cost_usd`, `workflow.stage.attempts`, `workflow.stage.repairs`, `workflow.scheduler.decision_latency_ms`, `workflow.scheduler.cas_conflicts` and `workflow.stream.rows_per_event`.
