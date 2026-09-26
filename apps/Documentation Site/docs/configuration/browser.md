# Workspace browser: configuration fields

Generated from `packages/shared/src/config/BrowserConfigSchema.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## BrowserConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| enabled | boolean | `optional` | — |
| mode | "auto" / "native" / "screencast" | `optional` | — |
| visibility | "visible" / "headless" / "off" | `optional` | — |
| headless | boolean | `optional` | — |
| viewport | object | `optional` | unknown keys: strip |
| viewport.width | number | `required` | int; min 320; max 3840 |
| viewport.height | number | `required` | int; min 240; max 2160 |
| allowedHosts | array of string | `optional` | maxLength 100 |
| persistProfile | boolean | `optional` | — |
| screencastFps | number | `optional` | int; min 1; max 15 |
| screencastQuality | number | `optional` | int; min 20; max 95 |
| idlePauseMinutes | number | `optional` | int; min 1; max 120 |
| evalAllowed | boolean | `optional` | — |
| dialogPolicy | "dismiss" / "accept" / "ask" | `optional` | — |
| permissions | array of string | `optional` | maxLength 20 |
| piiRedaction | boolean | `optional` | — |
| injectionDefense | "off" / "classifier" | `optional` | — |
| recordVideo | boolean | `optional` | — |
| allowLocalhostSelfSigned | boolean | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete BrowserConfigSchema.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// BrowserConfigSchema — Zod validator for the workspace/workflow/stage
// `browserConfig` block. Stages read the run workspace's resolved block
// through `BrowserService.resolveConfig`.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const BrowserConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['auto', 'native', 'screencast']).optional(),
    /**
     * User-facing visibility control. Default `'headless'` (safe). See
     * `BrowserConfig.visibility` in `types/BrowserSession.ts` for the
     * full precedence rules relative to the low-level `headless` field.
     */
    visibility: z.enum(['visible', 'headless', 'off']).optional(),
    headless: z.boolean().optional(),
    viewport: z
      .object({
        width: z.number().int().min(320).max(3840),
        height: z.number().int().min(240).max(2160),
      })
      .optional(),
    allowedHosts: z.array(z.string().min(1).max(200)).max(100).optional(),
    persistProfile: z.boolean().optional(),
    screencastFps: z.number().int().min(1).max(15).optional(),
    screencastQuality: z.number().int().min(20).max(95).optional(),
    idlePauseMinutes: z.number().int().min(1).max(120).optional(),
    evalAllowed: z.boolean().optional(),
    dialogPolicy: z.enum(['dismiss', 'accept', 'ask']).optional(),
    permissions: z.array(z.string().min(1).max(50)).max(20).optional(),
    piiRedaction: z.boolean().optional(),
    injectionDefense: z.enum(['off', 'classifier']).optional(),
    recordVideo: z.boolean().optional(),
    /**
     * Trust self-signed/invalid TLS certs — for a dev server at
     * `https://localhost:PORT`. Off by default. While on, top-level
     * `https://` navigation is restricted to loopback hosts so the
     * exemption cannot silently cover a public origin — see
     * `BrowserConfig.allowLocalhostSelfSigned` in types/BrowserSession.ts.
     */
    allowLocalhostSelfSigned: z.boolean().optional(),
  })
  .strict();

export type BrowserConfigInput = z.input<typeof BrowserConfigSchema>;
```

</details>
