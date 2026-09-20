# Widget instances and actions: configuration fields

Generated from `packages/shared/src/config/WidgetSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## WidgetSurfaceSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | string | `required` | transform |

## CreateWidgetInstanceSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| descriptorId | string | `required` | min 1 |
| sessionId | string | `required` | min 1 |
| chatId | string | `optional` | — |
| workflowRunId | string | `optional` | — |
| stageRunId | string | `optional` | — |
| messageId | string | `optional` | — |
| surface | string | `optional` | transform |
| props | map of unknown | `optional` | — |
| state | map of unknown | `optional` | — |

## UpdateWidgetStateSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| state | map of unknown | `required` | — |
| patch | map of unknown | `optional` | — |

## DispatchWidgetActionSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| action | string | `required` | min 1 |
| payload | unknown | `optional` | — |
| from | "agent" / "user" | `default "user"` | — |

## WidgetInvokeResultSchema

Body for `POST /api/widgets/:id/invoke-result` — the client bridge
posts the result of a `widget:invoke` round-trip back to the server so
the pending `widget_action` / `widget_exec` promise resolves.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| invokeId | string | `required` | min 1 |
| result | unknown | `optional` | — |
| error | string | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete WidgetSchemas.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// WidgetSchemas — Zod validators for widget REST + tool inputs.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { WidgetSurfaceSchema } from './ExtensionManifestSchema.js';

export { WidgetSurfaceSchema };

export const CreateWidgetInstanceSchema = z.object({
  descriptorId: z.string().min(1),
  sessionId: z.string().min(1),
  chatId: z.string().optional(),
  workflowRunId: z.string().optional(),
  stageRunId: z.string().optional(),
  messageId: z.string().optional(),
  surface: WidgetSurfaceSchema.optional(),
  props: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
});

export const UpdateWidgetStateSchema = z.object({
  state: z.record(z.unknown()),
  patch: z.record(z.unknown()).optional(),
});

export const DispatchWidgetActionSchema = z.object({
  action: z.string().min(1),
  payload: z.unknown().optional(),
  from: z.enum(['agent', 'user']).default('user'),
});

/**
 * Body for `POST /api/widgets/:id/invoke-result` — the client bridge
 * posts the result of a `widget:invoke` round-trip back to the server so
 * the pending `widget_action` / `widget_exec` promise resolves.
 */
export const WidgetInvokeResultSchema = z.object({
  invokeId: z.string().min(1),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
```

</details>
