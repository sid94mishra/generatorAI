# Automations and datasets: configuration fields

Generated from `packages/shared/src/config/AutomationSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## TestDataSourceSchema

Standalone schema for testing a data source configuration (E1)

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | variants by type (object / object / object / object) | `required` | — |
| &lt;variant 1&gt; | object | `required` | unknown keys: strip |
| &lt;variant 1&gt;.type | "script" | `required` | — |
| &lt;variant 1&gt;.command | string | `required` | min 1; max 2000 |
| &lt;variant 1&gt;.workingDirectory | string | `optional` | max 500 |
| &lt;variant 1&gt;.timeout | number | `optional` | int; min 1000; max 300000 |
| &lt;variant 1&gt;.outputFormat | "json_array" / "csv" / "jsonl" | `optional` | — |
| &lt;variant 1&gt;.env | map of string | `optional` | — |
| &lt;variant 1&gt;.schema | object | `optional` | unknown keys: strip |
| &lt;variant 1&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| &lt;variant 1&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| &lt;variant 2&gt; | object | `required` | unknown keys: strip |
| &lt;variant 2&gt;.type | "http" | `required` | — |
| &lt;variant 2&gt;.url | string | `required` | min 1; max 2000 |
| &lt;variant 2&gt;.method | "GET" / "POST" | `optional` | — |
| &lt;variant 2&gt;.headers | map of string | `optional` | — |
| &lt;variant 2&gt;.body | string | `optional` | max 50000 |
| &lt;variant 2&gt;.resultPath | string | `optional` | max 200 |
| &lt;variant 2&gt;.timeout | number | `optional` | int; min 1000; max 60000 |
| &lt;variant 2&gt;.schema | object | `optional` | unknown keys: strip |
| &lt;variant 2&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| &lt;variant 2&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| &lt;variant 3&gt; | object | `required` | unknown keys: strip |
| &lt;variant 3&gt;.type | "file" | `required` | — |
| &lt;variant 3&gt;.filePath | string | `required` | min 1; max 500 |
| &lt;variant 3&gt;.format | "json_array" / "csv" / "jsonl" | `optional` | — |
| &lt;variant 3&gt;.allowHidden | boolean | `optional` | — |
| &lt;variant 3&gt;.schema | object | `optional` | unknown keys: strip |
| &lt;variant 3&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| &lt;variant 3&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| &lt;variant 4&gt; | object | `required` | unknown keys: strip |
| &lt;variant 4&gt;.type | "workflow_script" | `required` | — |
| &lt;variant 4&gt;.scriptId | string | `required` | min 1; max 200 |
| &lt;variant 4&gt;.profileName | string | `optional` | max 100 |
| &lt;variant 4&gt;.iterationVariable | string | `optional` | max 100 |

## DataSchemaSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| version | 1 | `required` | — |
| format | "json_array" / "csv" / "jsonl" | `required` | — |
| fields | array of object | `required` | minLength 1; maxLength 100 |
| fields[] | object | `required` | unknown keys: strip |
| fields[].name | string | `required` | min 1; max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/; refinement |
| fields[].type | "string" / "number" / "boolean" / "date" / "json" | `required` | — |
| fields[].required | boolean | `optional` | — |
| fields[].description | string | `optional` | max 500 |
| fields[].defaultValue | unknown | `optional` | — |
| fields[].enum | array of string | `optional` | maxLength 200 |
| primaryKey | string | `optional` | max 100 |

## IterationModeSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | variants by kind (object / object / object) | `required` | — |
| &lt;variant 1&gt; | object | `required` | unknown keys: strip |
| &lt;variant 1&gt;.kind | "each_row" | `required` | — |
| &lt;variant 2&gt; | object | `required` | unknown keys: strip |
| &lt;variant 2&gt;.kind | "group_by" | `required` | — |
| &lt;variant 2&gt;.fields | array of string | `required` | minLength 1; maxLength 10 |
| &lt;variant 2&gt;.groupVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| &lt;variant 3&gt; | object | `required` | unknown keys: strip |
| &lt;variant 3&gt;.kind | "single" | `required` | — |
| &lt;variant 3&gt;.datasetVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |

## AutomationDatasetSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| format | "json_array" / "csv" / "jsonl" | `required` | — |
| data | string | `required` | max 5000000 |
| parsedRowCount | number | `optional` | int; min 0 |

## AutomationRetryPolicySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| maxAttempts | number | `required` | int; min 1; max 10 |
| initialBackoffMs | number | `required` | int; min 100; max 60000 |
| backoffMultiplier | number | `required` | min 1; max 10 |
| maxBackoffMs | number | `required` | int; min 1000; max 600000 |
| retryOn | array of "timeout" / "network" / "workflow_failed" | `required` | minLength 1; maxLength 3 |

## TriggerAutomationBodySchema

Body accepted by `POST /api/automations/:id/trigger`.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| dataset | object | `optional` | unknown keys: strip |
| dataset.format | "json_array" / "csv" / "jsonl" | `required` | — |
| dataset.data | string | `required` | max 5000000 |
| dataset.parsedRowCount | number | `optional` | int; min 0 |
| saveAsDefault | boolean | `optional` | — |

## PreviewIterationsBodySchema

Body accepted by `POST /api/automations/preview-iterations`.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| dataSchema | object | `required` | unknown keys: strip; refinement; refinement |
| dataSchema.version | 1 | `required` | — |
| dataSchema.format | "json_array" / "csv" / "jsonl" | `required` | — |
| dataSchema.fields | array of object | `required` | minLength 1; maxLength 100 |
| dataSchema.fields[] | object | `required` | unknown keys: strip |
| dataSchema.fields[].name | string | `required` | min 1; max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/; refinement |
| dataSchema.fields[].type | "string" / "number" / "boolean" / "date" / "json" | `required` | — |
| dataSchema.fields[].required | boolean | `optional` | — |
| dataSchema.fields[].description | string | `optional` | max 500 |
| dataSchema.fields[].defaultValue | unknown | `optional` | — |
| dataSchema.fields[].enum | array of string | `optional` | maxLength 200 |
| dataSchema.primaryKey | string | `optional` | max 100 |
| iterationMode | variants by kind (object / object / object) | `required` | — |
| iterationMode&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 1&gt;.kind | "each_row" | `required` | — |
| iterationMode&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 2&gt;.kind | "group_by" | `required` | — |
| iterationMode&lt;variant 2&gt;.fields | array of string | `required` | minLength 1; maxLength 10 |
| iterationMode&lt;variant 2&gt;.groupVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| iterationMode&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 3&gt;.kind | "single" | `required` | — |
| iterationMode&lt;variant 3&gt;.datasetVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| dataset | object | `required` | unknown keys: strip |
| dataset.format | "json_array" / "csv" / "jsonl" | `required` | — |
| dataset.data | string | `required` | max 5000000 |
| dataset.parsedRowCount | number | `optional` | int; min 0 |

## CreateAutomationSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| triggerType | "manual" / "schedule" / "webhook" | `required` | — |
| cronExpression | string | `optional` | min 1; max 100; refinement |
| timezone | string | `optional` | min 1; max 64; refinement |
| missedRunPolicy | "skip" / "run_once" | `optional` | — |
| overlapPolicy | "skip" / "queue" | `optional` | — |
| workflowIds | array of string | `required` | minLength 1 |
| inputMode | "single" / "loop" / "batch" / "script" | `default "single"` | — |
| loopVariable | string | `optional` | max 100 |
| loopItems | array of unknown | `optional` | — |
| batchDataFormat | "json" / "csv" / "jsonl" | `optional` | — |
| batchData | string | `optional` | max 500000 |
| batchColumns | array of string | `optional` | maxLength 100 |
| batchColumnMapping | map of string | `optional` | refinement |
| dataSourceConfig | variants by type (object / object / object / object / object) | `optional` | — |
| dataSourceConfig&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 1&gt;.type | "static" | `required` | — |
| dataSourceConfig&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 2&gt;.type | "script" | `required` | — |
| dataSourceConfig&lt;variant 2&gt;.command | string | `required` | min 1; max 2000 |
| dataSourceConfig&lt;variant 2&gt;.workingDirectory | string | `optional` | max 500 |
| dataSourceConfig&lt;variant 2&gt;.timeout | number | `optional` | int; min 1000; max 300000 |
| dataSourceConfig&lt;variant 2&gt;.outputFormat | "json_array" / "csv" / "jsonl" | `optional` | — |
| dataSourceConfig&lt;variant 2&gt;.env | map of string | `optional` | — |
| dataSourceConfig&lt;variant 2&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 2&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 2&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 3&gt;.type | "http" | `required` | — |
| dataSourceConfig&lt;variant 3&gt;.url | string | `required` | min 1; max 2000 |
| dataSourceConfig&lt;variant 3&gt;.method | "GET" / "POST" | `optional` | — |
| dataSourceConfig&lt;variant 3&gt;.headers | map of string | `optional` | — |
| dataSourceConfig&lt;variant 3&gt;.body | string | `optional` | max 50000 |
| dataSourceConfig&lt;variant 3&gt;.resultPath | string | `optional` | max 200 |
| dataSourceConfig&lt;variant 3&gt;.timeout | number | `optional` | int; min 1000; max 60000 |
| dataSourceConfig&lt;variant 3&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 3&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 3&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 4&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 4&gt;.type | "file" | `required` | — |
| dataSourceConfig&lt;variant 4&gt;.filePath | string | `required` | min 1; max 500 |
| dataSourceConfig&lt;variant 4&gt;.format | "json_array" / "csv" / "jsonl" | `optional` | — |
| dataSourceConfig&lt;variant 4&gt;.allowHidden | boolean | `optional` | — |
| dataSourceConfig&lt;variant 4&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 4&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 4&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 5&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 5&gt;.type | "workflow_script" | `required` | — |
| dataSourceConfig&lt;variant 5&gt;.scriptId | string | `required` | min 1; max 200 |
| dataSourceConfig&lt;variant 5&gt;.profileName | string | `optional` | max 100 |
| dataSourceConfig&lt;variant 5&gt;.iterationVariable | string | `optional` | max 100 |
| variables | map of unknown | `default {}` | — |
| maxConcurrency | number | `default 1` | int; min 1; max 10 |
| onError | "continue" / "stop" | `default "continue"` | — |
| projectId | string | `optional` | uuid |
| useWorktree | boolean | `optional` | — |
| dataSchema | object | `optional` | unknown keys: strip; refinement; refinement |
| dataSchema.version | 1 | `required` | — |
| dataSchema.format | "json_array" / "csv" / "jsonl" | `required` | — |
| dataSchema.fields | array of object | `required` | minLength 1; maxLength 100 |
| dataSchema.fields[] | object | `required` | unknown keys: strip |
| dataSchema.fields[].name | string | `required` | min 1; max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/; refinement |
| dataSchema.fields[].type | "string" / "number" / "boolean" / "date" / "json" | `required` | — |
| dataSchema.fields[].required | boolean | `optional` | — |
| dataSchema.fields[].description | string | `optional` | max 500 |
| dataSchema.fields[].defaultValue | unknown | `optional` | — |
| dataSchema.fields[].enum | array of string | `optional` | maxLength 200 |
| dataSchema.primaryKey | string | `optional` | max 100 |
| iterationMode | variants by kind (object / object / object) | `optional` | — |
| iterationMode&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 1&gt;.kind | "each_row" | `required` | — |
| iterationMode&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 2&gt;.kind | "group_by" | `required` | — |
| iterationMode&lt;variant 2&gt;.fields | array of string | `required` | minLength 1; maxLength 10 |
| iterationMode&lt;variant 2&gt;.groupVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| iterationMode&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 3&gt;.kind | "single" | `required` | — |
| iterationMode&lt;variant 3&gt;.datasetVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| defaultDataset | object | `optional` | unknown keys: strip |
| defaultDataset.format | "json_array" / "csv" / "jsonl" | `required` | — |
| defaultDataset.data | string | `required` | max 5000000 |
| defaultDataset.parsedRowCount | number | `optional` | int; min 0 |
| retryPolicy | object | `optional` | unknown keys: strip |
| retryPolicy.maxAttempts | number | `required` | int; min 1; max 10 |
| retryPolicy.initialBackoffMs | number | `required` | int; min 100; max 60000 |
| retryPolicy.backoffMultiplier | number | `required` | min 1; max 10 |
| retryPolicy.maxBackoffMs | number | `required` | int; min 1000; max 600000 |
| retryPolicy.retryOn | array of "timeout" / "network" / "workflow_failed" | `required` | minLength 1; maxLength 3 |

## UpdateAutomationSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `optional` | min 1; max 200 |
| description | string | `optional` | max 2000 |
| triggerType | "manual" / "schedule" / "webhook" | `optional` | — |
| cronExpression | string | `optional` | min 1; max 100; refinement |
| timezone | string | `optional; null accepted` | min 1; max 64; refinement |
| missedRunPolicy | "skip" / "run_once" | `optional` | — |
| overlapPolicy | "skip" / "queue" | `optional` | — |
| workflowIds | array of string | `optional` | minLength 1 |
| inputMode | "single" / "loop" / "batch" / "script" | `optional` | — |
| loopVariable | string | `optional` | max 100 |
| loopItems | array of unknown | `optional` | — |
| batchDataFormat | "json" / "csv" / "jsonl" | `optional` | — |
| batchData | string | `optional` | max 500000 |
| batchColumns | array of string | `optional` | maxLength 100 |
| batchColumnMapping | map of string | `optional` | refinement |
| dataSourceConfig | variants by type (object / object / object / object / object) | `optional` | — |
| dataSourceConfig&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 1&gt;.type | "static" | `required` | — |
| dataSourceConfig&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 2&gt;.type | "script" | `required` | — |
| dataSourceConfig&lt;variant 2&gt;.command | string | `required` | min 1; max 2000 |
| dataSourceConfig&lt;variant 2&gt;.workingDirectory | string | `optional` | max 500 |
| dataSourceConfig&lt;variant 2&gt;.timeout | number | `optional` | int; min 1000; max 300000 |
| dataSourceConfig&lt;variant 2&gt;.outputFormat | "json_array" / "csv" / "jsonl" | `optional` | — |
| dataSourceConfig&lt;variant 2&gt;.env | map of string | `optional` | — |
| dataSourceConfig&lt;variant 2&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 2&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 2&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 3&gt;.type | "http" | `required` | — |
| dataSourceConfig&lt;variant 3&gt;.url | string | `required` | min 1; max 2000 |
| dataSourceConfig&lt;variant 3&gt;.method | "GET" / "POST" | `optional` | — |
| dataSourceConfig&lt;variant 3&gt;.headers | map of string | `optional` | — |
| dataSourceConfig&lt;variant 3&gt;.body | string | `optional` | max 50000 |
| dataSourceConfig&lt;variant 3&gt;.resultPath | string | `optional` | max 200 |
| dataSourceConfig&lt;variant 3&gt;.timeout | number | `optional` | int; min 1000; max 60000 |
| dataSourceConfig&lt;variant 3&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 3&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 3&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 4&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 4&gt;.type | "file" | `required` | — |
| dataSourceConfig&lt;variant 4&gt;.filePath | string | `required` | min 1; max 500 |
| dataSourceConfig&lt;variant 4&gt;.format | "json_array" / "csv" / "jsonl" | `optional` | — |
| dataSourceConfig&lt;variant 4&gt;.allowHidden | boolean | `optional` | — |
| dataSourceConfig&lt;variant 4&gt;.schema | object | `optional` | unknown keys: strip |
| dataSourceConfig&lt;variant 4&gt;.schema.requiredFields | array of string | `optional` | maxLength 50 |
| dataSourceConfig&lt;variant 4&gt;.schema.maxItems | number | `optional` | int; min 1; max 10000 |
| dataSourceConfig&lt;variant 5&gt; | object | `required` | unknown keys: strip |
| dataSourceConfig&lt;variant 5&gt;.type | "workflow_script" | `required` | — |
| dataSourceConfig&lt;variant 5&gt;.scriptId | string | `required` | min 1; max 200 |
| dataSourceConfig&lt;variant 5&gt;.profileName | string | `optional` | max 100 |
| dataSourceConfig&lt;variant 5&gt;.iterationVariable | string | `optional` | max 100 |
| variables | map of unknown | `optional` | — |
| maxConcurrency | number | `optional` | int; min 1; max 10 |
| onError | "continue" / "stop" | `optional` | — |
| projectId | string | `optional` | uuid |
| useWorktree | boolean | `optional` | — |
| dataSchema | object | `optional; null accepted` | unknown keys: strip; refinement; refinement |
| dataSchema.version | 1 | `required` | — |
| dataSchema.format | "json_array" / "csv" / "jsonl" | `required` | — |
| dataSchema.fields | array of object | `required` | minLength 1; maxLength 100 |
| dataSchema.fields[] | object | `required` | unknown keys: strip |
| dataSchema.fields[].name | string | `required` | min 1; max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/; refinement |
| dataSchema.fields[].type | "string" / "number" / "boolean" / "date" / "json" | `required` | — |
| dataSchema.fields[].required | boolean | `optional` | — |
| dataSchema.fields[].description | string | `optional` | max 500 |
| dataSchema.fields[].defaultValue | unknown | `optional` | — |
| dataSchema.fields[].enum | array of string | `optional` | maxLength 200 |
| dataSchema.primaryKey | string | `optional` | max 100 |
| iterationMode | variants by kind (object / object / object) | `optional; null accepted` | — |
| iterationMode&lt;variant 1&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 1&gt;.kind | "each_row" | `required` | — |
| iterationMode&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 2&gt;.kind | "group_by" | `required` | — |
| iterationMode&lt;variant 2&gt;.fields | array of string | `required` | minLength 1; maxLength 10 |
| iterationMode&lt;variant 2&gt;.groupVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| iterationMode&lt;variant 3&gt; | object | `required` | unknown keys: strip |
| iterationMode&lt;variant 3&gt;.kind | "single" | `required` | — |
| iterationMode&lt;variant 3&gt;.datasetVariable | string | `optional` | max 100; regex /^[A-Za-z_][A-Za-z0-9_]*$/ |
| defaultDataset | object | `optional; null accepted` | unknown keys: strip |
| defaultDataset.format | "json_array" / "csv" / "jsonl" | `required` | — |
| defaultDataset.data | string | `required` | max 5000000 |
| defaultDataset.parsedRowCount | number | `optional` | int; min 0 |
| retryPolicy | object | `optional; null accepted` | unknown keys: strip |
| retryPolicy.maxAttempts | number | `required` | int; min 1; max 10 |
| retryPolicy.initialBackoffMs | number | `required` | int; min 100; max 60000 |
| retryPolicy.backoffMultiplier | number | `required` | min 1; max 10 |
| retryPolicy.maxBackoffMs | number | `required` | int; min 1000; max 600000 |
| retryPolicy.retryOn | array of "timeout" / "network" / "workflow_failed" | `required` | minLength 1; maxLength 3 |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete AutomationSchemas.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// AutomationSchemas — Zod validation schemas for automation API
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { validateCronExpression, isValidTimezone } from '../utils/cron.js';

// Cron expression validator. Delegates to the SAME parser the scheduler
// fires from (`utils/cron.ts`) so "accepted here" and "fires there" can
// never disagree again: field ranges are checked (`99 * * * *` is
// refused) and month / weekday names are accepted (`0 9 * * MON-FRI`).
const cronExpressionSchema = z.string().min(1).max(100).superRefine((value, ctx) => {
  const result = validateCronExpression(value);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid cron expression: ${result.error}` });
  }
});

/** IANA zone name, e.g. `Europe/Berlin`. Validated against the runtime's tz data. */
const timezoneSchema = z.string().min(1).max(64).refine(isValidTimezone, {
  message: 'timezone must be a valid IANA zone name (e.g. "America/New_York")',
});

const missedRunPolicySchema = z.enum(['skip', 'run_once']);
const overlapPolicySchema = z.enum(['skip', 'queue']);

// ── Data Source Config Schemas (E1) ──

const DataSourceSchemaValidator = z.object({
  requiredFields: z.array(z.string().max(100)).max(50).optional(),
  maxItems: z.number().int().min(1).max(10_000).optional(),
}).optional();

const ScriptDataSourceSchema = z.object({
  type: z.literal('script'),
  command: z.string().min(1).max(2000),
  workingDirectory: z.string().max(500).optional(),
  timeout: z.number().int().min(1000).max(300_000).optional(), // 1s to 5min
  outputFormat: z.enum(['json_array', 'csv', 'jsonl']).optional(),
  env: z.record(z.string().max(1000)).optional(),
  schema: DataSourceSchemaValidator,
});

const HttpDataSourceSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1).max(2000),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string().max(1000)).optional(),
  body: z.string().max(50_000).optional(),
  resultPath: z.string().max(200).optional(),
  timeout: z.number().int().min(1000).max(60_000).optional(),
  schema: DataSourceSchemaValidator,
});

const FileDataSourceSchema = z.object({
  type: z.literal('file'),
  filePath: z.string().min(1).max(500),
  format: z.enum(['json_array', 'csv', 'jsonl']).optional(),
  /** Hidden files (`.env`, `.git/…`) are refused unless explicitly allowed. */
  allowHidden: z.boolean().optional(),
  schema: DataSourceSchemaValidator,
});

const StaticDataSourceSchema = z.object({
  type: z.literal('static'),
});

const WorkflowScriptDataSourceSchema = z.object({
  type: z.literal('workflow_script'),
  scriptId: z.string().min(1).max(200),
  profileName: z.string().max(100).optional(),
  iterationVariable: z.string().max(100).optional(),
});

const DataSourceConfigSchema = z.discriminatedUnion('type', [
  StaticDataSourceSchema,
  ScriptDataSourceSchema,
  HttpDataSourceSchema,
  FileDataSourceSchema,
  WorkflowScriptDataSourceSchema,
]);

/** Standalone schema for testing a data source configuration (E1) */
export const TestDataSourceSchema = z.discriminatedUnion('type', [
  ScriptDataSourceSchema,
  HttpDataSourceSchema,
  FileDataSourceSchema,
  WorkflowScriptDataSourceSchema,
]);

// ── Track C — Schema-driven pipeline ──

/** Field names must be valid identifiers so they can be used in
 *  `{{name}}` interpolation and JS object access. */
const dataFieldNameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Blocked field names — reserved either by JS prototype semantics or
 *  by the iteration variable envelope (`__iteration_*`). */
const RESERVED_FIELD_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__iteration_index',
  '__iteration_total',
]);

const DataFieldDefSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(dataFieldNameRegex, 'Field name must be a valid identifier')
    .refine((n) => !RESERVED_FIELD_NAMES.has(n), {
      message: 'Field name is reserved and cannot be used',
    }),
  type: z.enum(['string', 'number', 'boolean', 'date', 'json']),
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
  defaultValue: z.unknown().optional(),
  enum: z.array(z.string().max(200)).max(200).optional(),
});

export const DataSchemaSchema = z.object({
  version: z.literal(1),
  format: z.enum(['json_array', 'csv', 'jsonl']),
  fields: z.array(DataFieldDefSchema).min(1, 'DataSchema must declare at least one field').max(100),
  primaryKey: z.string().max(100).optional(),
}).refine(
  (schema) => {
    if (!schema.primaryKey) return true;
    return schema.fields.some((f) => f.name === schema.primaryKey);
  },
  { message: 'primaryKey must reference one of the declared fields', path: ['primaryKey'] },
).refine(
  (schema) => {
    const names = schema.fields.map((f) => f.name);
    return new Set(names).size === names.length;
  },
  { message: 'Field names must be unique', path: ['fields'] },
);

export const IterationModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('each_row') }),
  z.object({
    kind: z.literal('group_by'),
    fields: z.array(z.string().max(100)).min(1).max(10),
    groupVariable: z.string().max(100).regex(dataFieldNameRegex).optional(),
  }),
  z.object({
    kind: z.literal('single'),
    datasetVariable: z.string().max(100).regex(dataFieldNameRegex).optional(),
  }),
]);

export const AutomationDatasetSchema = z.object({
  format: z.enum(['json_array', 'csv', 'jsonl']),
  data: z.string().max(5_000_000, 'Dataset exceeds 5MB'),
  parsedRowCount: z.number().int().min(0).optional(),
});

export const AutomationRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  initialBackoffMs: z.number().int().min(100).max(60_000),
  backoffMultiplier: z.number().min(1).max(10),
  maxBackoffMs: z.number().int().min(1000).max(600_000),
  retryOn: z.array(z.enum(['timeout', 'network', 'workflow_failed'])).min(1).max(3),
});

/** Body accepted by `POST /api/automations/:id/trigger`. */
export const TriggerAutomationBodySchema = z.object({
  dataset: AutomationDatasetSchema.optional(),
  saveAsDefault: z.boolean().optional(),
});

/** Body accepted by `POST /api/automations/preview-iterations`. */
export const PreviewIterationsBodySchema = z.object({
  dataSchema: DataSchemaSchema,
  iterationMode: IterationModeSchema,
  dataset: AutomationDatasetSchema,
});

export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']),
  cronExpression: cronExpressionSchema.optional(),
  timezone: timezoneSchema.optional(),
  missedRunPolicy: missedRunPolicySchema.optional(),
  overlapPolicy: overlapPolicySchema.optional(),
  workflowIds: z.array(z.string().uuid()).min(1, 'At least one workflow is required'),
  inputMode: z.enum(['single', 'loop', 'batch', 'script']).default('single'),
  loopVariable: z.string().max(100).optional(),
  loopItems: z.array(z.unknown()).optional(),
  batchDataFormat: z.enum(['json', 'csv', 'jsonl']).optional(),
  batchData: z.string().max(500_000).optional(), // Up to ~500KB of batch data
  batchColumns: z.array(z.string().max(100)).max(100).optional(),
  batchColumnMapping: z.record(z.string().max(100)).optional().refine(
    (mapping) => {
      if (!mapping) return true;
      const values = Object.values(mapping).filter((v) => v.trim() !== '');
      return new Set(values).size === values.length;
    },
    { message: 'Column mapping cannot have duplicate target variable names' },
  ),
  dataSourceConfig: DataSourceConfigSchema.optional(),
  variables: z.record(z.unknown()).default({}),
  maxConcurrency: z.number().int().min(1).max(10).default(1),
  onError: z.enum(['continue', 'stop']).default('continue'),
  projectId: z.string().uuid().optional(),
  useWorktree: z.boolean().optional(),
  // ── Track C ──
  dataSchema: DataSchemaSchema.optional(),
  iterationMode: IterationModeSchema.optional(),
  defaultDataset: AutomationDatasetSchema.optional(),
  retryPolicy: AutomationRetryPolicySchema.optional(),
}).refine(
  (data) => {
    if (data.triggerType === 'schedule' && !data.cronExpression) {
      return false;
    }
    return true;
  },
  { message: 'cronExpression is required for schedule triggers', path: ['cronExpression'] },
).refine(
  (data) => {
    // When using the new schema-driven pipeline, iterationMode is required.
    if (data.dataSchema && !data.iterationMode) return false;
    return true;
  },
  { message: 'iterationMode is required when dataSchema is set', path: ['iterationMode'] },
).refine(
  (data) => {
    // Legacy refinements only apply when NOT using the schema-driven pipeline.
    if (data.dataSchema) return true;
    if (data.inputMode === 'loop' && !data.loopVariable) return false;
    return true;
  },
  { message: 'loopVariable is required for loop input mode', path: ['loopVariable'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'loop' && (!data.loopItems || data.loopItems.length === 0)) return false;
    return true;
  },
  { message: 'loopItems must not be empty in loop mode', path: ['loopItems'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'batch' && !data.batchDataFormat) return false;
    return true;
  },
  { message: 'batchDataFormat is required for batch input mode', path: ['batchDataFormat'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'batch' && (!data.batchData || data.batchData.trim() === '')) return false;
    return true;
  },
  { message: 'batchData is required for batch input mode', path: ['batchData'] },
).refine(
  (data) => {
    // Cannot provide both static batchData and a dynamic data source
    const hasBatchData = data.batchData && data.batchData.trim() !== '';
    const hasDynamicSource = data.dataSourceConfig && data.dataSourceConfig.type !== 'static';
    return !(hasBatchData && hasDynamicSource);
  },
  { message: 'Cannot specify both batchData and a dynamic dataSourceConfig', path: ['dataSourceConfig'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'script') {
      return data.dataSourceConfig && data.dataSourceConfig.type !== 'static';
    }
    return true;
  },
  { message: 'dataSourceConfig is required for script input mode', path: ['dataSourceConfig'] },
).refine(
  (data) => {
    // Schedule triggers must have a way to source data at run time.
    if (data.triggerType !== 'schedule') return true;
    if (data.dataSchema) return !!data.defaultDataset;
    // Legacy pipeline: single mode is fine, otherwise the legacy data
    // must be inline on the automation.
    return true;
  },
  { message: 'Schedule triggers require a defaultDataset when using dataSchema', path: ['defaultDataset'] },
);

export const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']).optional(),
  cronExpression: cronExpressionSchema.optional(),
  // Nullable so a caller can fall back to the server zone.
  timezone: timezoneSchema.nullable().optional(),
  missedRunPolicy: missedRunPolicySchema.optional(),
  overlapPolicy: overlapPolicySchema.optional(),
  workflowIds: z.array(z.string().uuid()).min(1).optional(),
  inputMode: z.enum(['single', 'loop', 'batch', 'script']).optional(),
  loopVariable: z.string().max(100).optional(),
  loopItems: z.array(z.unknown()).optional(),
  batchDataFormat: z.enum(['json', 'csv', 'jsonl']).optional(),
  batchData: z.string().max(500_000).optional(),
  batchColumns: z.array(z.string().max(100)).max(100).optional(),
  batchColumnMapping: z.record(z.string().max(100)).optional().refine(
    (mapping) => {
      if (!mapping) return true;
      const values = Object.values(mapping).filter((v) => v.trim() !== '');
      return new Set(values).size === values.length;
    },
    { message: 'Column mapping cannot have duplicate target variable names' },
  ),
  dataSourceConfig: DataSourceConfigSchema.optional(),
  variables: z.record(z.unknown()).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  onError: z.enum(['continue', 'stop']).optional(),
  projectId: z.string().uuid().optional(),
  useWorktree: z.boolean().optional(),
  // ── Track C ── (nullable so callers can clear these back to legacy)
  dataSchema: DataSchemaSchema.nullable().optional(),
  iterationMode: IterationModeSchema.nullable().optional(),
  defaultDataset: AutomationDatasetSchema.nullable().optional(),
  retryPolicy: AutomationRetryPolicySchema.nullable().optional(),
});
```

</details>
