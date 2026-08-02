// ────────────────────────────────────────────────────────────────
// Composer types — slash commands, @-mention files, and previews
// shared across the chat input, its menu popover, and the hooks.
// ────────────────────────────────────────────────────────────────

export type SlashCommandKind = 'prompt' | 'skill' | 'agent' | 'command';

/**
 * A slash command surfaced in the composer's `/` menu. Prompts and skills are
 * modeled as commands too (per product spec: "prompts are also considered
 * slash commands"). Built-in commands (`/browser`, `/terminal`) wrap the
 * user's free text into an instruction the agent can act on.
 */
export interface SlashCommand {
  /** Stable id (e.g. `builtin:browser`, `system:<artifactId>`). */
  id: string;
  /** Trigger token without the leading slash (e.g. `browser`). */
  name: string;
  description?: string;
  kind: SlashCommandKind;
  source: 'system' | 'project' | 'builtin';
  /** Placeholder shown in the textarea once the command is active. */
  argHint?: string;
  /** Whether the command accepts free-text input after selection. */
  takesInput: boolean;
  /**
   * Builds the final prompt sent to the agent from the user's typed input.
   * For prompt-template commands the resolved template text is passed as
   * `template` (already fetched by the caller); builtins/skills ignore it.
   */
  format: (input: string, template?: string) => string;
  /** Optional lazy loader for a prompt template's body (fetched on send). */
  loadTemplate?: () => Promise<string>;
}

export type MentionFileSource = 'workspace' | 'source' | 'artifacts' | 'worktree';

/** A repo/workspace file discoverable through the `@` mention menu. */
export interface MentionFile {
  /** Relative path within its source root. */
  path: string;
  source: MentionFileSource;
  /** Worktree alias when `source === 'worktree'`. */
  worktreeAlias?: string;
  /** Basename used for display + fuzzy matching. */
  label: string;
}

export type CaptureSource = 'browser' | 'terminal' | 'file' | 'mention';

/**
 * An attachment shown as a removable chip above the textarea. Wraps the raw
 * `File` with provenance so the preview can render the right icon/label.
 */
export interface ComposerAttachment {
  /** Stable id for React keys + removal. */
  id: string;
  file: File;
  source: CaptureSource;
  /** Human label (defaults to file name). */
  label?: string;
}

/** Active menu state driven by the `/` or `@` trigger character. */
export interface ComposerMenuState {
  type: 'slash' | 'mention';
  /** Query text typed after the trigger char. */
  query: string;
  /** Caret index of the trigger char within the textarea value. */
  triggerIndex: number;
}
