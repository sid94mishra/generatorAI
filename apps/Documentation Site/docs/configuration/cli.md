# CLI and TUI configuration: configuration fields

Generated from `packages/cli-core/src/config/schema.ts` by `npm run configuration:generate`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.

Start with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.

Nested fields apply only when their parent/union variant is present. Arrays use `[]`; records use `{key}`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.

## OutputFormatSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "auto" / "json" / "ndjson" / "yaml" / "quiet" | `required` | — |

## ColorModeSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | "auto" / "always" / "never" | `required` | — |

## ServerConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| url | string | `default "http://localhost:3100"` | url |
| apiKey | string | `optional` | — |
| timeoutMs | number | `default 120000` | int; min 0 |

## CliBehaviourSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| output | "auto" / "json" / "ndjson" / "yaml" / "quiet" | `default "auto"` | — |
| color | "auto" / "always" / "never" | `default "auto"` | — |
| unicode | boolean | `default true` | — |
| verbose | boolean | `default false` | — |
| assumeYes | boolean | `default false` | — |
| defaultModel | string | `optional` | — |
| defaultProjectId | string | `optional` | — |
| pageSize | number | `default 50` | int; min 1; max 500 |

## TuiConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| theme | string | `default "auto"` | — |
| appearance | "auto" / "light" / "dark" | `default "auto"` | — |
| accent | "blue" / "violet" / "green" / "orange" / "rose" / "teal" | `default "blue"` | — |
| maxFps | number | `default 30` | int; min 5; max 120 |
| mouse | boolean | `default false` | — |
| alternateScreen | boolean | `default true` | — |
| incrementalRendering | boolean | `default false` | — |
| restoreLayout | boolean | `default true` | — |
| refreshMs | number | `default 15000` | int; min 0 |
| showThinking | boolean | `default true` | — |
| collapseTools | boolean | `default true` | — |
| graphics | "auto" / "kitty" / "iterm2" / "sixel" / "halfblock" / "ascii" | `default "auto"` | — |

## KeymapOverridesSchema

`{ "chat.send": "ctrl+enter" }` — merged over the built-in keymap.

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| (value) | map of string | `required` | — |

## ConnectionEntrySchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| serverId | string | `required` | — |
| label | string | `required` | — |
| endpoint | string | `required` | — |
| endpoints | array of string | `default []` | — |
| kind | "local" / "remote" | `default "remote"` | — |
| managed | boolean | `default false` | — |
| lastConnectedAt | number | `default null; null accepted` | — |

## ProfileOverridesSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| server | object | `optional` | unknown keys: strip |
| server.url | string | `optional` | url |
| server.apiKey | string | `optional` | — |
| server.timeoutMs | number | `optional` | int; min 0 |
| cli | object | `optional` | unknown keys: strip |
| cli.output | "auto" / "json" / "ndjson" / "yaml" / "quiet" | `optional` | — |
| cli.color | "auto" / "always" / "never" | `optional` | — |
| cli.unicode | boolean | `optional` | — |
| cli.verbose | boolean | `optional` | — |
| cli.assumeYes | boolean | `optional` | — |
| cli.defaultModel | string | `optional` | — |
| cli.defaultProjectId | string | `optional` | — |
| cli.pageSize | number | `optional` | int; min 1; max 500 |
| tui | object | `optional` | unknown keys: strip |
| tui.theme | string | `optional` | — |
| tui.appearance | "auto" / "light" / "dark" | `optional` | — |
| tui.accent | "blue" / "violet" / "green" / "orange" / "rose" / "teal" | `optional` | — |
| tui.maxFps | number | `optional` | int; min 5; max 120 |
| tui.mouse | boolean | `optional` | — |
| tui.alternateScreen | boolean | `optional` | — |
| tui.incrementalRendering | boolean | `optional` | — |
| tui.restoreLayout | boolean | `optional` | — |
| tui.refreshMs | number | `optional` | int; min 0 |
| tui.showThinking | boolean | `optional` | — |
| tui.collapseTools | boolean | `optional` | — |
| tui.graphics | "auto" / "kitty" / "iterm2" / "sixel" / "halfblock" / "ascii" | `optional` | — |
| activeConnection | string | `optional` | — |

## CliConfigSchema

| Field | Type / choices | Input / default | Constraints |
| --- | --- | --- | --- |
| configVersion | number | `default 2` | int |
| server | object | `default {}` | unknown keys: strip |
| server.url | string | `default "http://localhost:3100"` | url |
| server.apiKey | string | `optional` | — |
| server.timeoutMs | number | `default 120000` | int; min 0 |
| cli | object | `default {}` | unknown keys: strip |
| cli.output | "auto" / "json" / "ndjson" / "yaml" / "quiet" | `default "auto"` | — |
| cli.color | "auto" / "always" / "never" | `default "auto"` | — |
| cli.unicode | boolean | `default true` | — |
| cli.verbose | boolean | `default false` | — |
| cli.assumeYes | boolean | `default false` | — |
| cli.defaultModel | string | `optional` | — |
| cli.defaultProjectId | string | `optional` | — |
| cli.pageSize | number | `default 50` | int; min 1; max 500 |
| tui | object | `default {}` | unknown keys: strip |
| tui.theme | string | `default "auto"` | — |
| tui.appearance | "auto" / "light" / "dark" | `default "auto"` | — |
| tui.accent | "blue" / "violet" / "green" / "orange" / "rose" / "teal" | `default "blue"` | — |
| tui.maxFps | number | `default 30` | int; min 5; max 120 |
| tui.mouse | boolean | `default false` | — |
| tui.alternateScreen | boolean | `default true` | — |
| tui.incrementalRendering | boolean | `default false` | — |
| tui.restoreLayout | boolean | `default true` | — |
| tui.refreshMs | number | `default 15000` | int; min 0 |
| tui.showThinking | boolean | `default true` | — |
| tui.collapseTools | boolean | `default true` | — |
| tui.graphics | "auto" / "kitty" / "iterm2" / "sixel" / "halfblock" / "ascii" | `default "auto"` | — |
| keymap | map of string | `default {}` | — |
| activeConnection | string | `optional` | — |
| connections | array of object | `default []` | — |
| connections[] | object | `required` | unknown keys: strip |
| connections[].serverId | string | `required` | — |
| connections[].label | string | `required` | — |
| connections[].endpoint | string | `required` | — |
| connections[].endpoints | array of string | `default []` | — |
| connections[].kind | "local" / "remote" | `default "remote"` | — |
| connections[].managed | boolean | `default false` | — |
| connections[].lastConnectedAt | number | `default null; null accepted` | — |
| profiles | map of object | `default {}` | — |
| profiles.{key} | object | `required` | unknown keys: strip |
| profiles.{key}.server | object | `optional` | unknown keys: strip |
| profiles.{key}.server.url | string | `optional` | url |
| profiles.{key}.server.apiKey | string | `optional` | — |
| profiles.{key}.server.timeoutMs | number | `optional` | int; min 0 |
| profiles.{key}.cli | object | `optional` | unknown keys: strip |
| profiles.{key}.cli.output | "auto" / "json" / "ndjson" / "yaml" / "quiet" | `optional` | — |
| profiles.{key}.cli.color | "auto" / "always" / "never" | `optional` | — |
| profiles.{key}.cli.unicode | boolean | `optional` | — |
| profiles.{key}.cli.verbose | boolean | `optional` | — |
| profiles.{key}.cli.assumeYes | boolean | `optional` | — |
| profiles.{key}.cli.defaultModel | string | `optional` | — |
| profiles.{key}.cli.defaultProjectId | string | `optional` | — |
| profiles.{key}.cli.pageSize | number | `optional` | int; min 1; max 500 |
| profiles.{key}.tui | object | `optional` | unknown keys: strip |
| profiles.{key}.tui.theme | string | `optional` | — |
| profiles.{key}.tui.appearance | "auto" / "light" / "dark" | `optional` | — |
| profiles.{key}.tui.accent | "blue" / "violet" / "green" / "orange" / "rose" / "teal" | `optional` | — |
| profiles.{key}.tui.maxFps | number | `optional` | int; min 5; max 120 |
| profiles.{key}.tui.mouse | boolean | `optional` | — |
| profiles.{key}.tui.alternateScreen | boolean | `optional` | — |
| profiles.{key}.tui.incrementalRendering | boolean | `optional` | — |
| profiles.{key}.tui.restoreLayout | boolean | `optional` | — |
| profiles.{key}.tui.refreshMs | number | `optional` | int; min 0 |
| profiles.{key}.tui.showThinking | boolean | `optional` | — |
| profiles.{key}.tui.collapseTools | boolean | `optional` | — |
| profiles.{key}.tui.graphics | "auto" / "kitty" / "iterm2" / "sixel" / "halfblock" / "ascii" | `optional` | — |
| profiles.{key}.activeConnection | string | `optional` | — |
| activeProfile | string | `optional` | — |

## Complete validation contract

The following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.

<details>
<summary>Read the complete schema.ts source contract</summary>

```typescript
// ────────────────────────────────────────────────────────────────
// CLI configuration schema.
//
// Zod is the contract, not documentation: an unknown key or a wrong type is
// rejected at load with the path that caused it, rather than surfacing three
// commands later as `undefined`.
//
// The shape is versioned (`configVersion`) so `config migrate` has something
// to branch on when the layout changes.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const CONFIG_VERSION = 2;

export const OutputFormatSchema = z.enum(['auto', 'json', 'ndjson', 'yaml', 'quiet']);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export const ColorModeSchema = z.enum(['auto', 'always', 'never']);

export const ServerConfigSchema = z.object({
  /** Fallback endpoint used when no connection is selected. */
  url: z.string().url().default('http://localhost:3100'),
  /**
   * Deprecated shared secret. Still honoured so existing scripts keep
   * working; every surface warns once when it is used.
   */
  apiKey: z.string().optional(),
  /**
   * Milliseconds before a REST call is abandoned. `0` disables the timeout.
   *
   * Defaulted rather than unbounded because a wedged provider SDK behind the
   * server accepts the connection and then never answers, which without a
   * bound looks identical to a CLI that has simply frozen.
   */
  timeoutMs: z.number().int().min(0).default(120_000),
});

export const CliBehaviourSchema = z.object({
  output: OutputFormatSchema.default('auto'),
  color: ColorModeSchema.default('auto'),
  unicode: z.boolean().default(true),
  verbose: z.boolean().default(false),
  /** Skips confirmation on destructive commands. Off by design. */
  assumeYes: z.boolean().default(false),
  defaultModel: z.string().optional(),
  defaultProjectId: z.string().optional(),
  /** Page size for list commands. */
  pageSize: z.number().int().min(1).max(500).default(50),
});

export const TuiConfigSchema = z.object({
  /** Theme id from @generatorai/design-tokens, or 'auto'. */
  theme: z.string().default('auto'),
  appearance: z.enum(['auto', 'light', 'dark']).default('auto'),
  accent: z.enum(['blue', 'violet', 'green', 'orange', 'rose', 'teal']).default('blue'),
  /** Render cap. Lower reduces CPU on high-token-rate streams. */
  maxFps: z.number().int().min(5).max(120).default(30),
  /**
   * Mouse reporting. Off by default: enabling it takes text selection away
   * from the terminal, which users experience as the app being broken.
   */
  mouse: z.boolean().default(false),
  /** Full-screen alternate buffer; preserves the user's scrollback. */
  alternateScreen: z.boolean().default(true),
  /** Redraw only changed lines. */
  /**
   * Redraw only the lines that changed.
   *
   * Off by default: it leaves stale cells behind whenever a line gets shorter
   * or contains wide characters (emoji, CJK), which shows up as text written
   * over borders and fragments of old frames. The full redraw is cheap enough
   * at the frame rates a TUI runs at.
   */
  incrementalRendering: z.boolean().default(false),
  /** Restore the previous pane layout on launch. */
  restoreLayout: z.boolean().default(true),
  /** Poll interval for entities with no SSE coverage. 0 disables polling. */
  refreshMs: z.number().int().min(0).default(15_000),
  /** Show reasoning/thinking blocks inline. */
  showThinking: z.boolean().default(true),
  /** Collapse tool calls to one line until expanded. */
  collapseTools: z.boolean().default(true),
  /** Graphics protocol override; 'auto' defers to capability detection. */
  graphics: z.enum(['auto', 'kitty', 'iterm2', 'sixel', 'halfblock', 'ascii']).default('auto'),
});

/** `{ "chat.send": "ctrl+enter" }` — merged over the built-in keymap. */
export const KeymapOverridesSchema = z.record(z.string());

export const ConnectionEntrySchema = z.object({
  /** Server host fingerprint. The durable identity; a URL is only a route. */
  serverId: z.string(),
  label: z.string(),
  endpoint: z.string(),
  endpoints: z.array(z.string()).default([]),
  kind: z.enum(['local', 'remote']).default('remote'),
  managed: z.boolean().default(false),
  lastConnectedAt: z.number().nullable().default(null),
});

export const ProfileOverridesSchema = z.object({
  server: ServerConfigSchema.partial().optional(),
  cli: CliBehaviourSchema.partial().optional(),
  tui: TuiConfigSchema.partial().optional(),
  activeConnection: z.string().optional(),
});

export const CliConfigSchema = z.object({
  configVersion: z.number().int().default(CONFIG_VERSION),
  server: ServerConfigSchema.default({}),
  cli: CliBehaviourSchema.default({}),
  tui: TuiConfigSchema.default({}),
  keymap: KeymapOverridesSchema.default({}),
  /** `serverId` of the connection commands use when none is given. */
  activeConnection: z.string().optional(),
  connections: z.array(ConnectionEntrySchema).default([]),
  profiles: z.record(ProfileOverridesSchema).default({}),
  activeProfile: z.string().optional(),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

/**
 * Config after profile overlay and flag application.
 *
 * Distinct from `CliConfig` so nothing downstream can accidentally read the
 * pre-overlay values and get a different answer than the command did.
 */
export interface ResolvedCliConfig extends CliConfig {
  /** Absolute path each layer was read from, for `config show --sources`. */
  readonly sources: {
    user: string | null;
    project: string | null;
    env: string[];
    flags: string[];
  };
}

export const DEFAULT_CONFIG: CliConfig = CliConfigSchema.parse({});
```

</details>
