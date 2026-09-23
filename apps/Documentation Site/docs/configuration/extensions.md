# Extension manifests and installation: configuration fields

Generated from `packages/shared/src/config/ExtensionManifestSchema.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## WidgetSurfaceSchema

Widget surface schema. Accepts any string and normalizes to one of the
two canonical surfaces (`inline` | `widget`).

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | string | `required` | transform |

## ExtensionManifestSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| id | string | `required` | min 1; regex /^[a-z0-9][a-z0-9._-]*$/i |
| name | string | `required` | min 1 |
| version | string | `required` | min 1 |
| description | string | `optional` | — |
| author | union (string / object) | `optional` | — |
| author&lt;variant 2&gt; | object | `required` | unknown keys: strip |
| author&lt;variant 2&gt;.name | string | `required` | — |
| author&lt;variant 2&gt;.email | string | `optional` | — |
| author&lt;variant 2&gt;.url | string | `optional` | — |
| license | string | `optional` | — |
| repository | string | `optional` | — |
| publisher | string | `optional` | — |
| engines | object | `optional` | unknown keys: strip |
| engines.generatorai | string | `required` | — |
| permissions | array of string | `optional` | — |
| entry | string | `required` | min 1 |
| icon | string | `optional` | — |
| signature | string | `optional` | — |

## InstallExtensionParamsSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| path | string | `optional` | — |
| source | string | `optional` | — |
| scope | "system" / "user" / "workspace" | `optional` | — |
| workspaceId | string | `optional` | — |
| force | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete ExtensionManifestSchema.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// ExtensionManifestSchema — Zod validator for `extension.json`.
//
// The manifest is intentionally thin: identity + metadata + an `entry`
// pointer to the ES module whose default export is `loadExtension(ai)`.
// All contributions (widgets, tools, hooks, …) are registered
// imperatively from the entry file — there is no declarative
// `contributes` block.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { normalizeWidgetSurface } from '../types/Widget.js';

/**
 * Widget surface schema. Accepts any string and normalizes to one of the
 * two canonical surfaces (`inline` | `widget`).
 */
export const WidgetSurfaceSchema = z.string().transform((v) => normalizeWidgetSurface(v));

const ExtensionAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
]);

export const ExtensionManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'extension id must be alphanumeric, dot, dash, underscore'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: ExtensionAuthorSchema.optional(),
  license: z.string().optional(),
  repository: z.string().optional(),
  publisher: z.string().optional(),
  engines: z
    .object({ generatorai: z.string() })
    .optional(),
  permissions: z.array(z.string()).optional(),
  /**
   * Relative path to the ES module whose default (or named
   * `loadExtension`) export receives the per-extension `ExtensionAPI`
   * handle (`ai`) and registers contributions imperatively.
   *
   * Example: `"entry": "./index.js"`.
   */
  entry: z.string().min(1),
  icon: z.string().optional(),
  signature: z.string().optional(),
});

export const InstallExtensionParamsSchema = z.object({
  path: z.string().optional(),
  source: z.string().optional(),
  scope: z.enum(['system', 'user', 'workspace']).optional(),
  workspaceId: z.string().optional(),
  force: z.boolean().optional(),
});

export type ExtensionManifestParsed = z.infer<typeof ExtensionManifestSchema>;
```

</details>
