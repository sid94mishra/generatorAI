// MP-42 CodeLine contract (the row renderer of MB-24 DiffView and MB-26 FilePreview; MD-39, MD-61).
export type CodeLineKind = 'add' | 'del' | 'context' | 'plain';

export interface CodeLineProps {
  /** The line's text (no line break). */
  text: string;
  /** add / del tint the row (`bg-add-bg` / `bg-del-bg`) and draw the +/− sign; plain has no sign column. */
  kind: CodeLineKind;
  /** Highlighter alias (`ui/lib/highlight`); absent → plain text. Lines over 2,000 chars render plain. */
  language?: string | null;
  /** Diff: the old / new numbers (dual gutter); file preview: `newNumber` only. */
  oldNumber?: number;
  newNumber?: number;
  /** Width of one number column (computed from the largest number and the font size). */
  gutterWidth: number;
  /** Show both columns (diff) or one (file preview). */
  dualGutter?: boolean;
  /** Mono font size (the pinch preference, 10–20); the line box is 1.5×. */
  fontSize: number;
  wrap: boolean;
  /** The selected line: 1.5px `border-fg-2` ring (MD-61). */
  selected?: boolean;
  /** File preview: a changed line gets the 3px start bar `bg-ok` over `bg-add-bg`. */
  changed?: boolean;
  /** No newline at end of file. */
  noNewline?: boolean;
  /** Open review threads on this line: a count chip after the text. */
  commentCount?: number;
  /** Tap the number gutter ("Comment on line 20", MD-61). */
  onPressGutter?: () => void;
  /** Tap the comment chip. */
  onPressComments?: () => void;
  onLongPress?: () => void;
  /** Accessibility actions (e.g. Comment). */
  accessibilityActions?: ReadonlyArray<{ name: string; label: string }>;
  onAccessibilityAction?: (name: string) => void;
  testID?: string;
}
