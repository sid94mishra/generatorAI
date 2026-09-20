# MCP connections: configuration fields

Generated from `packages/shared/src/config/McpSchemas.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## McpTransportSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "stdio" / "http" / "sse" | `required` | — |

## McpServerBodySchema

Body for creating / replacing an MCP server (project or custom scope).
`headers` is only meaningful for http/sse, `env` for stdio; the wrong one
for the transport is rejected rather than silently dropped.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| name | string | `required` | trim; min 1; max 120 |
| description | string | `optional` | trim; max 2000 |
| serverType | "stdio" / "http" / "sse" | `default "http"` | — |
| url | string | `optional` | trim; url |
| command | string | `optional` | trim; min 1; max 1000 |
| args | array of string | `optional` | maxLength 64 |
| timeoutMs | number | `optional` | int; min 0 (exclusive); max 3600000 |
| enabled | boolean | `optional` | — |
| headers | map of string | `optional` | refinement |
| env | map of string | `optional` | refinement |

## SystemMcpPrefsBodySchema

Body for the per-bundled-server preferences (`PUT /system/mcp-servers/system/:id`).

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| enabled | boolean | `optional` | — |
| inputs | map of string | `optional` | — |
| env | map of string | `optional` | refinement |
| headers | map of string | `optional` | refinement |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete McpSchemas.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// MCP request-body schemas — shared by the project MCP routes and the
// global Settings MCP routes so both accept exactly the same shape.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** `KEY` → value. Keys are trimmed, non-empty, and free of whitespace/`=`. */
const credentialMap = z
  .record(z.string().min(1).max(200), z.string().max(64 * 1024))
  .refine(
    (m) => Object.keys(m).every((k) => /^[^\s=]+$/.test(k)),
    { message: 'credential keys must not contain whitespace or "="' },
  );

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse']);

/**
 * Body for creating / replacing an MCP server (project or custom scope).
 * `headers` is only meaningful for http/sse, `env` for stdio; the wrong one
 * for the transport is rejected rather than silently dropped.
 */
export const McpServerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    serverType: McpTransportSchema.default('http'),
    url: z.string().trim().url().optional(),
    command: z.string().trim().min(1).max(1000).optional(),
    args: z.array(z.string().max(4000)).max(64).optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    enabled: z.boolean().optional(),
    headers: credentialMap.optional(),
    env: credentialMap.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.serverType === 'stdio') {
      if (!v.command) ctx.addIssue({ code: 'custom', path: ['command'], message: 'command required for stdio type' });
      if (v.headers && Object.keys(v.headers).length > 0) {
        ctx.addIssue({ code: 'custom', path: ['headers'], message: 'headers apply to http/sse servers only' });
      }
    } else {
      if (!v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: `url required for ${v.serverType} type` });
      if (v.env && Object.keys(v.env).length > 0) {
        ctx.addIssue({ code: 'custom', path: ['env'], message: 'env applies to stdio servers only' });
      }
    }
  });

export type McpServerBody = z.infer<typeof McpServerBodySchema>;

/** Body for the per-bundled-server preferences (`PUT /system/mcp-servers/system/:id`). */
export const SystemMcpPrefsBodySchema = z.object({
  enabled: z.boolean().optional(),
  inputs: z.record(z.string().min(1).max(100), z.string().max(4000)).optional(),
  env: credentialMap.optional(),
  headers: credentialMap.optional(),
});

export type SystemMcpPrefsBody = z.infer<typeof SystemMcpPrefsBodySchema>;
```

</details>
