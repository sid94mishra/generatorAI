---
description: Trigger ordered workflows manually, by schedule, or by webhook, with batch data and execution history.
---
# Automations

An automation stores when to run, which workflows to execute, and how to turn input data into iterations. Each trigger creates an execution record; that execution links the individual workflow runs. This separates reusable configuration, one invocation, and the work done for each row or group.

## Create and run

1. Open **Automations → Create Automation**.
2. Enter a name and optional description.
3. Choose Manual, Schedule, or Webhook trigger.
4. Select global or project scope and add workflows in their intended sequence.
5. Choose an input mode or enable the schema-driven dataset configuration.
6. Set variables, concurrency, and error behavior where applicable; preview input data before saving.
7. Choose the **permission mode** its runs start with (default: accept edits, ask for the rest). An automation cannot be saved without one. Full access (`bypassPermissions`) on a webhook trigger requires the `admin:settings` scope.
8. Open the detail page and use **Run Now** for a controlled initial execution.

An automation must be enabled for the detail page's Run Now action. **Disable** prevents eligible future triggers; cancelling an already running execution is a separate control in execution history.

## Trigger types

| Trigger | Configuration and behavior |
| --- | --- |
| Manual | Start from Run Now; schema-driven runs can supply a dataset and optionally save it as the default |
| Schedule | Cron expression, with next-run/last-run reporting; the server must be available to execute work |
| Webhook | Authenticated HTTP POST, with credentials shown once on creation or rotation |

The server contract additionally supports IANA timezone, missed-run policy (`skip` or `run_once`), and overlap policy (`skip` or `queue`). Not all of these have controls in the current creation form. Use the API/configuration reference for advanced scheduling instead of inferring a UI control exists.

Webhook tokens and signing secrets are not returned by ordinary list/detail queries. Save the values when the credentials dialog presents them. Rotation creates replacement credentials. Requests use the webhook token and, when configured, an `X-Signature-256: sha256=<hex>` HMAC over the raw request body. `X-Webhook-Token` can carry the token instead of exposing it as the meaningful URL token value. This webhook endpoint has a different authentication contract from a paired application's normal API requests.

## Input modes

| Mode | Input |
| --- | --- |
| Single | One execution of the ordered workflow set with base variables |
| Loop | JSON array of values assigned to one named loop variable |
| Batch | CSV, JSON array, or JSONL rows; column-to-variable mapping can rename fields |
| Script | A host-side command produces dynamic rows as JSON array, CSV, or JSONL |

The creation form includes script command, output format, timeout, environment, testing/preview, concurrency, and error controls. Dynamic source contracts also support HTTP, project-confined files, and workflow-script profiles. Those contract capabilities should not be confused with four identically featured visual editors.

## Typed datasets

The optional schema-driven pipeline declares a row shape instead of relying solely on the legacy modes. Fields support string, number, boolean, date, and JSON; they can be required, have defaults, and have string enumerations. A primary key can label rows.

| Iteration mode | Workflow input |
| --- | --- |
| Each row | One iteration per validated row |
| Group by | One iteration per group; a configured variable contains the group's rows |
| Single | One iteration containing the full dataset in a configured variable |

Preview reports row count, planned iterations, sample variable bags, and warnings. Reserved iteration metadata includes `__iteration_index` and `__iteration_total`. A scheduled automation needs usable default input because there is no interactive dataset dialog at firing time. Dataset snapshots on executions record what actually ran.

Example batch input for a workflow with `area` and `objective` variables:

```csv
area,objective
authentication,Review error handling
checkout,Add missing validation tests
documentation,Check setup instructions
```

## Failure and history

Concurrency bounds simultaneous workflow work; error policy is Continue or Stop. The contract supports per-iteration retry attempts, exponential backoff with a ceiling, and retry classes for timeout, network, or workflow failure. The baseline is one attempt; advanced retry configuration is not a universal visible form field.

The detail page presents execution history, iteration labels/variables, linked workflow runs, status, and cancellation. Completed, partial, failed, and cancelled are distinct outcomes: **partial** means successes and failures occurred in the same execution. Open the affected workflow run and inspect its error before retrying side-effecting work.

## Source evidence

`apps/web/src/pages/CreateAutomationPage.tsx`, `apps/web/src/pages/AutomationDetailPage.tsx`, `apps/web/src/components/automation/TriggerAutomationModal.tsx`, `apps/web/src/components/automation/WebhookCredentialsDialog.tsx`, `packages/shared/src/types/Automation.ts`, `packages/shared/src/types/DataSchema.ts`, and `apps/server/src/routes/automations.ts`.

## Configuration and worked examples

[Automations](../configuration/automations.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
