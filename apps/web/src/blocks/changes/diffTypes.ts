// ────────────────────────────────────────────────────────────────
// Diff view contracts — what the Changes hooks hand a diff renderer.
//
// Owned here (not by the renderer) so the data hooks in this block and any
// renderer — today `components/diff/DiffCodeView`, B-07 DiffView after the
// P4-09 port — agree on one shape without the hooks importing a component.
// ────────────────────────────────────────────────────────────────

/** Annotation payload we attach to lines (review threads, CI notes, …). */
export type DiffAnnotationMeta = Record<string, unknown>;

export type DiffViewMode = 'split' | 'unified';

/** One file to render, already resolved to content or a patch. */
export interface DiffSource {
  /** Stable id — `${alias}:${path}`. Drives scrollTo/selection/reconciliation. */
  id: string;
  alias: string;
  path: string;
  /** Old/new contents. Preferred: enables "expand unchanged context". */
  oldContents?: string | null;
  newContents?: string | null;
  /** Unified patch fallback when the bodies are too large to ship. */
  patch?: string;
  lang?: string;
  /** `<oldBlob>:<newBlob>` — the worker pool's AST cache key. */
  cacheKey?: string;
  collapsed?: boolean;
  /** Rendered under the given line via `renderAnnotation`. */
  annotations?: DiffAnnotation[];
}

export interface DiffAnnotation {
  side: 'additions' | 'deletions';
  /** 0 = file-level, above the first hunk. */
  lineNumber: number;
  metadata: Record<string, unknown>;
}

export interface DiffLineRange {
  start: number;
  end: number;
  side: 'additions' | 'deletions';
  endSide?: 'additions' | 'deletions';
}

/** Imperative surface for hosts that need to drive the viewer. */
export interface DiffCodeViewHandle {
  /**
   * Drop the current line selection, in the viewer AND in our mirror of it.
   *
   * Needed because the selection is what the composer is written against:
   * abandoning the comment has to abandon the highlight too, or the diff is
   * left asserting that lines are selected when nothing is going to happen
   * to them.
   */
  clearSelection(): void;
  /**
   * Bring one file's header to the top of the scroll container.
   *
   * The list is virtualized, so a file that is not on screen has no element
   * to scroll to — only the viewer knows where it would be. Marking a file
   * active without this leaves the highlight somewhere the user cannot see.
   */
  scrollToItem(id: string): void;
}
