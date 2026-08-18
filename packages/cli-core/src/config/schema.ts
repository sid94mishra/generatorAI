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
  /** tmux-compatible prefix for pane and tab operations. */
  leaderKey: z.string().default('ctrl+b'),
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
