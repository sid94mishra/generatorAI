// ────────────────────────────────────────────────────────────────
// Composer draft types (web): the attachment chips and the `/` / `@` menu
// state. Slash commands and mention files are shared with mobile and live in
// client-core (`SlashCommand`, `MentionFile`).
// ────────────────────────────────────────────────────────────────

export type CaptureSource = 'browser' | 'terminal' | 'file' | 'mention';

/**
 * An attachment shown as a removable chip above the textarea. Wraps the raw
 * `File` with provenance so the chip can render the right icon/label.
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
