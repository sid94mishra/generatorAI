// ────────────────────────────────────────────────────────────────
// ChangesSurface — the unified Changes tab (chat / run / automation)
// ────────────────────────────────────────────────────────────────
//
// Replaces the previous ChangesPanel + custom diff renderer. The whole
// surface is driven by the summary-first API:
//
//   1. GET /changes  → file list renders immediately (metadata only)
//   2. expand a file → GET /changes/file (ETag'd, cached by blob pair)
//   3. CodeView virtualizes rows, workers do the highlighting
//
// A base-revision picker turns the same surface into "everything this
// session changed" or "just what this message changed".

import { useCallback, useMemo, useRef } from 'react';
import {
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  GitBranch,
  RotateCcwClock,
  ListTree,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Settings2,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Spinner,
  Select,
  useConfirm,
} from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import { SourceControlPanel } from '@/components/scm/SourceControlPanel.js';
import type {
  ReviewIntent,
  ReviewScope,
  ReviewSubmitTarget,
} from '@/types/review.js';
import {
  useChangesEditor,
  useChangesModel,
  useChangesNavigation,
  useChangesViewSettings,
  useCheckpointPanel,
  useDiffSources,
  useExpandedDiffs,
  useFileActions,
  useKeptFiles,
  useReviewOverlay,
  type ChangesNotice,
  type DiffAnnotation,
  type DiffCodeViewHandle,
} from '@/blocks/changes/index.js';
import { DiffCodeView } from './DiffCodeView.js';
import { ChangesTree } from './ChangesTree.js';
import { DiffProviders } from './DiffProviders.js';
import { CheckpointTimeline } from './CheckpointTimeline.js';
import { ReviewThreadCard } from './review/ReviewThreadCard.js';
import { ReviewComposerPopover } from './review/ReviewComposerPopover.js';
import { ReviewCommentsPopover } from './review/ReviewCommentsPopover.js';
import { ReviewBatchBar } from './review/ReviewBatchBar.js';

export interface ChangesSurfaceProps {
  workspaceId?: string;
  /**
   * The chat that owns this workspace, when there is one.
   *
   * Only used by source control: "Ask the agent" to resolve a merge conflict
   * is a real chat turn, so it is offered only where a chat exists (the run
   * page has none).
   */
  chatId?: string;
  /** Seeds generated commit messages / PR text. The chat or run name. */
  scmHint?: string;
  /** Renders without outer chrome (inside the RightPane host). */
  embedded?: boolean;
  /** Pre-select a base revision, e.g. `stage:<stageRunId>` on a run page. */
  defaultBase?: string;
  /**
   * Enables inline review comments: line selection, the gutter "+" button,
   * threads rendered under their anchor, and the batch bar.
   */
  enableReview?: boolean;
  /** Scope the review threads belong to. Required when `enableReview`. */
  reviewScope?: { scope: ReviewScope; scopeId: string };
  /** Where "Send all" delivers the batch. Omit to disable sending. */
  reviewTarget?: ReviewSubmitTarget;
  /** Explains why sending is unavailable (shown on the disabled button). */
  reviewDisabledReason?: string;
  onOpenCheckpoints?: () => void;
  /**
   * Imperative "show me this file": the transcript's per-op diff icons, the
   * end-of-turn summary and the composer tray all hand over a display path
   * (`<alias>/<path>`, or `<path>` for the workspace root). A fresh `token`
   * re-fires the focus even for the same path.
   */
  focusFile?: { path: string; token: number } | null;
}

/**
 * Git status presentation, shared by the diff rows and the file tree.
 *
 * `color` is handed to the tree as its `--trees-git-*-color` overrides so the
 * A/M/D marker is literally the same colour in both places — the two views
 * are of the same eight files, and having "modified" be amber in one and
 * something else in the other is a needless translation step for the reader.
 */
const STATUS_STYLE: Record<string, { label: string; title: string; className: string; color: string }> = {
  added: {
    label: 'A',
    title: 'Added',
    className: 'bg-success-muted text-success',
    color: 'var(--color-success)',
  },
  modified: {
    label: 'M',
    title: 'Modified',
    className: 'bg-warning-muted text-warning',
    color: 'var(--color-warning)',
  },
  deleted: {
    label: 'D',
    title: 'Deleted',
    className: 'bg-danger-muted text-danger',
    color: 'var(--color-danger)',
  },
  renamed: {
    label: 'R',
    title: 'Renamed',
    className: 'bg-info-muted text-info',
    color: 'var(--color-info)',
  },
};

/** The same colours, in the shape the tree's git lane wants. */
const TREE_STATUS_COLORS = {
  added: STATUS_STYLE['added']!.color,
  modified: STATUS_STYLE['modified']!.color,
  deleted: STATUS_STYLE['deleted']!.color,
  renamed: STATUS_STYLE['renamed']!.color,
  untracked: STATUS_STYLE['added']!.color,
} as const;

/**
 * Height of one file header row, in pixels.
 *
 * Shared between the rendered header and `DiffCodeView.headerHeight` so the
 * virtualizer's pre-measurement layout matches what actually paints.
 */
const FILE_HEADER_HEIGHT = 28;

/** Skipped-path reports from Undo land in the app's toast region. */
function warnToast(notice: ChangesNotice) {
  toast({ variant: 'warning', title: notice.title, description: notice.description });
}

export function ChangesSurface({
  workspaceId,
  chatId,
  scmHint,
  embedded = false,
  defaultBase = 'baseline',
  enableReview = false,
  reviewScope,
  reviewTarget,
  reviewDisabledReason,
  onOpenCheckpoints,
  focusFile,
}: ChangesSurfaceProps) {
  const settings = useChangesViewSettings(defaultBase);
  const { base, setBase, viewMode, setViewMode, showTree, toggleTree, treePosition, placeTree, wrapLines, toggleWrapLines } = settings;
  // The timeline lives here rather than in each host page so every surface
  // that renders changes gets rewind for free. `onOpenCheckpoints` still wins
  // when a host wants to present it somewhere else.
  const checkpointsPanel = useCheckpointPanel();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();

  const model = useChangesModel({ workspaceId, base });
  const { summary, multiMount, display, revisionsByAlias } = model;
  const editor = useChangesEditor(model.mounts);
  const { canOpenInEditor, openFile: openFileInEditor } = editor;

  const actions = useFileActions({
    workspaceId,
    revisionsByAlias,
    display,
    requestConfirmation: confirmAction,
    warn: warnToast,
  });
  const { confirmRevert, requestRevert, cancelRevert, busyRow, bulkBusy, canRevertFile, revertFile, undoAll } = actions;

  /**
   * Reviewed files are pulled out of the main list into their own group, so
   * what remains above is exactly what still needs a decision.
   */
  const keptFiles = useKeptFiles({ workspaceId, summary, actions });
  const { keptCount, showKept, keepFile, unkeepFile, keepAll } = keptFiles;

  const expandedDiffs = useExpandedDiffs();
  const { entries, sources, loadingIds } = useDiffSources({
    workspaceId,
    summary: keptFiles.pending,
    base,
    head: 'working',
    expandedIds: expandedDiffs.expandedIds,
  });
  // A second source set for the kept group. Same ids and the same lazy
  // fetching, so a kept file is still fully expandable and diffable.
  const {
    entries: keptEntries,
    sources: keptSources,
    loadingIds: keptLoadingIds,
  } = useDiffSources({
    workspaceId,
    summary: keptFiles.kept,
    base,
    head: 'working',
    expandedIds: expandedDiffs.expandedIds,
  });

  /** Every row on the surface, kept or not — for lookups by id. */
  const allEntries = useMemo(() => [...entries, ...keptEntries], [entries, keptEntries]);
  const entryById = useMemo(
    () => new Map(allEntries.map((e) => [e.id, e])),
    [allEntries],
  );
  const keptIds = useMemo(() => new Set(keptEntries.map((e) => e.id)), [keptEntries]);

  const viewerRef = useRef<DiffCodeViewHandle>(null);
  const nav = useChangesNavigation({
    entries: allEntries,
    keptIds,
    display,
    expanded: expandedDiffs,
    openKept: keptFiles.openKept,
    viewerRef,
    focusFile,
  });
  const { activePath, expandedIds, toggle } = nav;

  // ── Review ───────────────────────────────────────────────────

  const reviewEnabled = enableReview && !!reviewScope;
  const review = useReviewOverlay({
    workspaceId,
    enabled: reviewEnabled,
    reviewScope,
    reviewTarget,
    entries,
    sources,
    keptSources,
    revisionsByAlias,
    display,
    reveal: nav.reveal,
    viewerRef,
  });
  const { threadsById, focusedThreadId, openThreadCountByFile, commentOnFile } = review;

  const renderAnnotation = useCallback(
    (annotation: DiffAnnotation) => {
      const threadId = annotation.metadata?.['threadId'];
      if (typeof threadId !== 'string') return null;
      const thread = threadsById.get(threadId);
      if (!thread) return null;
      return (
        <ReviewThreadCard
          thread={thread}
          defaultExpanded={focusedThreadId === thread.id}
          busy={review.sending}
          onReply={review.replyToThread}
          onEdit={review.editComment}
          onResolve={review.resolveThread}
          onDelete={review.deleteThread}
          {...(reviewTarget ? { onSend: review.sendThread } : {})}
        />
      );
    },
    [
      threadsById,
      focusedThreadId,
      review.sending,
      review.replyToThread,
      review.editComment,
      review.resolveThread,
      review.deleteThread,
      review.sendThread,
      reviewTarget,
    ],
  );

  /**
   * Renders each file's header. Replaces the built-in one so the +/- counts
   * come from `git diff --numstat` on the server: those are authoritative
   * (rename-aware) and available before the file body has been fetched,
   * whereas the viewer's own counts read 0/0 until then.
   *
   * Its height is fixed and mirrored to `DiffCodeView.headerHeight` — the
   * virtualizer reserves space from that number before it measures, so a
   * mismatch shows up as dead space above the first file.
   */
  const renderHeader = useCallback(
    (item: { id: string; path: string; alias: string }) => {
      const entry = entryById.get(item.id);
      const file = entry?.file;
      const badge = STATUS_STYLE[file?.status ?? 'modified'] ?? STATUS_STYLE['modified']!;
      const confirming = confirmRevert === item.id;
      const expanded = expandedIds.has(item.id);
      const loading = loadingIds.has(item.id) || keptLoadingIds.has(item.id);
      const isKept = file?.kept === true;
      const rowBusy = busyRow === item.id;
      const canUndo = canRevertFile(item.alias);
      const openable = !file?.isBinary && !file?.isTooLarge;
      const displayPath = display(item.alias, item.path);
      const isActive = activePath === displayPath;
      const commentCount = openThreadCountByFile.get(item.id) ?? 0;
      const commentSource = sources.find((source) => source.id === item.id);
      const commentSide = commentSource?.newContents ? 'additions' : 'deletions';
      const commentContent = commentSide === 'additions' ? commentSource?.newContents : commentSource?.oldContents;
      return (
        <div
          className={cn(
            'group relative flex h-full w-full min-w-0 items-center gap-1.5 border-b pl-2 pr-1 text-xs transition-colors',
            // Tints are built on `--color-primary` (a solid colour), NOT
            // `--color-accent-tint`, which is already a ~10%-alpha wash of it —
            // tinting that again lands around 1-2% and reads as nothing.
            expanded && !isActive && 'bg-primary/[0.06]',
            isActive && 'bg-primary/15',
            openable && 'cursor-pointer',
          )}
          style={{ height: FILE_HEADER_HEIGHT }}
          // The whole row toggles, not just the chevron. Clicking a file name
          // and having nothing happen is the most confusing thing this list
          // can do. Deliberately NOT `role="button"`: the row contains its own
          // buttons, and nesting controls breaks both semantics and keyboard
          // order. The chevron below carries the accessible name instead, so
          // this stays a pure pointer convenience.
          //
          // Expanding deliberately does NOT move the tree's selection.
          // Expanding is not choosing — it is normal to open several files to
          // read them side by side, and syncing each one to the tree left a
          // trail of highlighted rows that no longer meant anything.
          onClick={() => {
            if (openable) toggle(item.id);
          }}
        >
          {/* Hover wash. Deliberately an overlay rather than a `hover:bg-*`
              utility on the row: the row already carries a state tint
              (expanded / active) at the same specificity, and which of the two
              wins comes down to Tailwind's stylesheet ordering — which lost.
              A separate layer stacks on top of whatever tint is underneath, so
              hover always reads. `-z-10` keeps it above the row's own
              background but below the row's text. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-primary/10 opacity-0 transition-opacity group-hover:opacity-100"
          />
          {/* Selection marker. A background tint alone is easy to lose against
              a syntax-highlighted diff, so the active row also gets a solid
              rail — the same affordance the file tree uses. */}
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-0.5 bg-primary"
            />
          )}
          {/* The keyboard- and screen-reader-facing control for the row. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              if (openable) toggle(item.id);
            }}
            disabled={!openable}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${item.path}` : `Expand ${item.path}`}
            title={expanded ? 'Hide changes' : 'Show changes'}
            className="h-4 w-4 shrink-0 rounded text-muted-foreground hover:bg-accent-tint hover:text-foreground disabled:opacity-30"
          >
            {loading ? (
              <Spinner size="xs" />
            ) : expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
          {/* File-type icon, leading the row. Real brand-coloured glyphs
              (the same set the tree uses) so a file is recognisable by shape
              and colour before the path is read. */}
          <FileTypeIcon
            name={item.path.split('/').pop() ?? item.path}
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate font-mono" title={displayPath}>
            {multiMount && item.alias !== '.' && (
              <span className="text-muted-foreground">{item.alias}/</span>
            )}
            {file?.oldPath && (
              <span className="text-muted-foreground line-through">{file.oldPath} → </span>
            )}
            {item.path}
          </span>
          {/* Unresolved-comment marker. The threads themselves render inline
              under their anchor line, which is invisible while the file is
              collapsed — without this a reviewer cannot tell which files they
              have already commented on. */}
          {commentCount > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/15 px-1 text-[9px] font-medium text-primary"
              title={`${commentCount} comment${commentCount === 1 ? '' : 's'} on this file`}
            >
              <MessageSquare className="h-2.5 w-2.5" />
              {commentCount}
            </span>
          )}
          {file && (
            <span className="shrink-0 font-mono text-[10px]">
              {file.isBinary ? (
                <span className="text-muted-foreground">binary</span>
              ) : file.isTooLarge ? (
                <span className="text-muted-foreground">too large</span>
              ) : (
                <>
                  <span className="text-emerald-500">+{file.additions}</span>{' '}
                  <span className="text-rose-500">−{file.deletions}</span>
                </>
              )}
            </span>
          )}
          {/* Status marker, trailing. Same letter and same colour as the
              tree's git lane. */}
          <span
            className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold',
              badge.className,
            )}
            title={badge.title}
          >
            {badge.label}
          </span>
          {/* Review actions. Always mounted for a kept row (the group it sits
              in is small and deliberate); revealed on hover otherwise, so the
              list stays quiet while it is being read. */}
          {confirming ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  void revertFile(item.id, item.alias, item.path);
                }}
                disabled={rowBusy}
                data-testid="confirm-undo-file"
                className="h-auto rounded bg-amber-500 px-1.5 py-px text-[10px] font-medium text-white disabled:opacity-50"
              >
                {rowBusy ? 'Undoing…' : 'Confirm undo'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelRevert();
                }}
                className="h-auto rounded px-1.5 py-px text-[10px] font-normal hover:bg-accent-tint"
              >
                Cancel
              </Button>
            </span>
          ) : (
            <span
              className={cn(
                'flex shrink-0 items-center gap-0.5 transition-opacity',
                isKept
                  ? 'opacity-100'
                  : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
              )}
            >
              {reviewEnabled && expanded && openable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Comment on ${item.path}`}
                  title="Comment on a line range"
                  disabled={loading || !commentContent}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!commentContent) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    commentOnFile(item, commentSide, commentContent, { x: rect.left, y: rect.bottom });
                  }}
                ><MessageSquare className="h-3 w-3" aria-hidden /></Button>
              )}
              {isKept ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Put this file back in the review list"
                  aria-label={`Unkeep ${item.path}`}
                  data-testid="unkeep-file"
                  disabled={rowBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void unkeepFile(item.id, item.alias, item.path);
                  }}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-success hover:bg-accent-tint"
                >
                  {rowBusy ? <Spinner size="xs" /> : <RotateCcw className="h-3 w-3" />}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Keep this file — mark it reviewed and move it out of the list"
                  aria-label={`Keep ${item.path}`}
                  data-testid="keep-file"
                  disabled={rowBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void keepFile(item.id, item.alias, item.path, file?.newBlob);
                  }}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent-tint hover:text-success"
                >
                  {rowBusy ? <Spinner size="xs" /> : <Check className="h-3 w-3" />}
                </Button>
              )}
              {canOpenInEditor && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Open in editor"
                  aria-label={`Open ${item.path} in editor`}
                  data-testid="open-file-in-editor"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFileInEditor(item.alias, item.path);
                  }}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent-tint hover:text-foreground"
                >
                  <Code2 className="h-3 w-3" />
                </Button>
              )}
              {canUndo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Undo this file's changes (itself undoable)"
                  aria-label={`Undo changes to ${item.path}`}
                  data-testid="undo-file"
                  disabled={rowBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestRevert(item.id);
                  }}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent-tint hover:text-foreground"
                >
                  <Undo2 className="h-3 w-3" />
                </Button>
              )}
            </span>
          )}
        </div>
      );
    },
    [
      entryById,
      canRevertFile,
      confirmRevert,
      revertFile,
      cancelRevert,
      requestRevert,
      keepFile,
      unkeepFile,
      busyRow,
      expandedIds,
      loadingIds,
      keptLoadingIds,
      toggle,
      activePath,
      openThreadCountByFile,
      display,
      multiMount,
      canOpenInEditor,
      openFileInEditor,
      sources,
      reviewEnabled,
      commentOnFile,
    ],
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No workspace yet — changes appear once the agent starts working.
      </div>
    );
  }

  const { stats, hiddenWorkspaceFiles, showWorkspaceFiles } = model;
  const { threads, commentsOpen, pendingSelection, previewPrompt } = review;
  const reviewActionsDisabledProps = reviewDisabledReason ? { disabledReason: reviewDisabledReason } : {};

  return (
    // `bg-background` is load-bearing, not decoration. The code viewer paints
    // its own canvas (pinned to this same token in `diffHostStyle`), so
    // without it the tree, the toolbar and the file rows would sit on the
    // host pane's translucent card tint while the diff sat on the solid
    // background — two near-blacks a few percent apart, with a visible seam
    // down the middle of the panel.
    <div
      ref={checkpointsPanel.surfaceRef}
      className={cn(
        'flex h-full min-h-0 flex-col bg-background',
        !embedded && 'rounded-lg border',
      )}
    >
      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium" data-testid="changes-count">
          {stats.files} {stats.files === 1 ? 'change' : 'changes'}
        </span>
        {keptCount > 0 && (
          <span className="text-[10.5px] text-muted-foreground" data-testid="changes-kept-count">
            {stats.files - keptCount} to review · {keptCount} kept
          </span>
        )}
        {(stats.additions > 0 || stats.deletions > 0) && (
          <span className="font-mono text-[10px]">
            <span className="text-emerald-500">+{stats.additions}</span>{' '}
            <span className="text-rose-500">−{stats.deletions}</span>
          </span>
        )}

        {/* Base revision picker — "since session start", "since this turn",
            or the commit each mount's branch was cut from. */}
        <Select
          value={base}
          onChange={setBase}
          aria-label="Compare against"
          className="ml-1 h-6 w-auto max-w-[220px] rounded-md px-2 py-0 text-[11px]"
          options={model.compareOptions}
        />

        {(hiddenWorkspaceFiles > 0 || showWorkspaceFiles) && (
          <Button variant="unstyled"
            type="button"
            onClick={model.toggleWorkspaceFiles}
            aria-pressed={showWorkspaceFiles}
            title={
              showWorkspaceFiles
                ? 'Hide files outside the linked codebases'
                : 'Files the agent wrote at the workspace root (state, notes, summaries) — not part of a codebase'
            }
            className={cn(
              'ml-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors',
              showWorkspaceFiles
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-subtle hover:text-foreground',
            )}
            data-testid="changes-workspace-files-toggle"
          >
            {showWorkspaceFiles
              ? 'Hide workspace files'
              : `+${hiddenWorkspaceFiles} workspace ${hiddenWorkspaceFiles === 1 ? 'file' : 'files'}`}
          </Button>
        )}

        {/* Bulk review. "Keep all" accepts every changed file at its current
            content (resolved server-side, so it cannot accept something the
            agent wrote a moment ago and nobody saw); "Undo all" throws the
            whole change set away behind a confirmation. */}
        {stats.files > 0 && (
          <div className="ml-1 flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void keepAll()}
              disabled={bulkBusy !== null || stats.files === keptCount}
              loading={bulkBusy === 'keep'}
              leftIcon={<CheckCheck className="h-3 w-3" />}
              title="Mark every changed file as reviewed"
              data-testid="keep-all"
              className="h-6 rounded-md px-1.5 text-[10.5px] font-normal"
            >
              Keep all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void undoAll()}
              disabled={bulkBusy !== null}
              loading={bulkBusy === 'undo'}
              leftIcon={<Undo2 className="h-3 w-3" />}
              title="Restore every changed file to its base revision"
              data-testid="undo-all"
              className="h-6 rounded-md px-1.5 text-[10.5px] font-normal text-danger hover:bg-danger-muted"
            >
              Undo all
            </Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {/* Every comment on this diff, in one list — the same affordance
              the integrated browser puts on its own toolbar. */}
          {reviewEnabled && (
            <ReviewCommentsPopover
              threads={threads}
              open={commentsOpen}
              onOpenChange={review.setCommentsOpen}
              onJump={review.jumpToThread}
              onDelete={review.deleteThread}
              busy={review.sending}
              {...(reviewTarget
                ? {
                    onSendOne: review.sendThread,
                    onSendAll: () => void review.sendBatch(''),
                  }
                : {})}
            />
          )}
          {/* Dock the tree beside the diff. Off by default because the diff
              pane already lists every file as a collapsed header. */}
          <IconButton
            title={showTree ? 'Hide file tree' : 'Show file tree'}
            onClick={toggleTree}
            active={showTree}
          >
            <ListTree className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            title={nav.allExpanded ? 'Collapse all files' : 'Expand all files'}
            onClick={nav.toggleExpandAll}
            disabled={nav.expandableIds.length === 0}
          >
            {nav.allExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </IconButton>

          {/* View preferences. Grouped behind a gear so the bar stays
              readable at the narrow widths the right pane is usually at. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="View settings"
                aria-label="View settings"
                className="h-6 w-6 rounded hover:bg-accent-tint"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1.5">
              <MenuLabel>View</MenuLabel>
              <MenuCheckItem
                checked={viewMode === 'unified'}
                onSelect={() => setViewMode('unified')}
              >
                Unified view
              </MenuCheckItem>
              <MenuCheckItem
                checked={viewMode === 'split'}
                onSelect={() => setViewMode('split')}
                // Added and deleted files have no second side, so they stay
                // single-column in split mode. Saying so up front stops the
                // control from looking broken on a generated workspace.
                hint="Added and deleted files always render in a single column."
              >
                Split view
              </MenuCheckItem>
              <MenuSeparator />
              <MenuCheckItem checked={wrapLines} onSelect={toggleWrapLines}>
                Wrap lines
              </MenuCheckItem>
              <MenuSeparator />
              <MenuLabel>File tree position</MenuLabel>
              <MenuCheckItem
                checked={treePosition === 'left'}
                onSelect={() => placeTree('left')}
              >
                Left
              </MenuCheckItem>
              <MenuCheckItem
                checked={treePosition === 'right'}
                onSelect={() => placeTree('right')}
              >
                Right
              </MenuCheckItem>
            </PopoverContent>
          </Popover>

          <IconButton
            title="Checkpoints & rewind"
            onClick={onOpenCheckpoints ?? checkpointsPanel.toggle}
            active={checkpointsPanel.open}
          >
            <RotateCcwClock className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            title="Refresh"
            onClick={() => void model.refetch()}
            disabled={model.isRefetching}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', model.isRefetching && 'animate-spin')}
            />
          </IconButton>
        </div>
      </div>

      {/* ── Mount groups ───────────────────────────────────────
          The diff list below is already ordered mount by mount; this names
          each group and says which branch it is on, which is the one thing a
          multi-repo change set cannot be read without. Clicking a group jumps
          to its first file. */}
      {multiMount && stats.files > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1" data-testid="mount-groups">
          {model.mountGroups.map((group) => (
            <Button
              key={group.alias}
              type="button"
              variant="ghost"
              size="sm"
              disabled={!group.firstId}
              onClick={() => {
                if (!group.firstId) return;
                nav.jumpToGroup(group.firstId);
              }}
              title={group.mount?.path ?? group.alias}
              className="h-auto gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-[10.5px] font-normal hover:bg-subtle"
            >
              <span className="font-medium text-foreground">
                {group.alias === '.' ? 'workspace' : group.alias}
              </span>
              {group.mount?.git?.branch && (
                <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                  <GitBranch className="h-2.5 w-2.5" />
                  {group.mount.git.branch}
                </span>
              )}
              <span className="text-muted-foreground">
                {group.stats.files} {group.stats.files === 1 ? 'file' : 'files'}
              </span>
              <span className="font-mono">
                <span className="text-success">+{group.stats.additions}</span>{' '}
                <span className="text-danger">−{group.stats.deletions}</span>
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* ── Review batch ───────────────────────────────────────── */}
      {reviewEnabled && (
        <ReviewBatchBar
          pendingCount={review.threadCounts.pending}
          submittedCount={review.threadCounts.submitted}
          addressedCount={review.threadCounts.addressed}
          busy={review.sending}
          {...(reviewTarget ? { onSendAll: (note: string) => void review.sendBatch(note) } : {})}
          {...(reviewTarget
            ? { onPreview: (note: string) => void review.sendBatch(note, true) }
            : {})}
          onDiscardAll={review.discardPending}
          {...reviewActionsDisabledProps}
        />
      )}

      {/* ── Comment composer ───────────────────────────────────
          Rendered in a portal, floating beside the selected lines. */}
      {pendingSelection && (
        <ReviewComposerPopover
          file={pendingSelection.file}
          range={pendingSelection.range}
          anchorPreview={pendingSelection.anchorText}
          anchor={pendingSelection.anchor}
          busy={review.creating}
          {...(pendingSelection.editableLineCount ? {
            lineCount: pendingSelection.editableLineCount,
            onRangeChange: review.setPendingRange,
          } : {})}
          onCancel={review.cancelPendingSelection}
          onSubmit={(body, intent) => void review.submitPendingComment(body, intent, false)}
          {...(reviewTarget
            ? {
                onSubmitAndSend: (body: string, intent: ReviewIntent) =>
                  void review.submitPendingComment(body, intent, true),
              }
            : {})}
        />
      )}

      {/* ── Submission preview ─────────────────────────────────── */}
      {previewPrompt !== null && (
        <div className="border-b p-2">
          <div className="mb-1 flex items-center gap-2 text-[11px]">
            <span className="font-medium">This will be sent to the agent:</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={review.closePreview}
              className="ml-auto"
            >
              Close
            </Button>
          </div>
          <pre className="max-h-52 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-tight whitespace-pre-wrap">
            {previewPrompt}
          </pre>
        </div>
      )}

      {/* ── Source control ─────────────────────────────────────
          Readiness-driven: each mount says what it can do and, when it
          cannot, why — with a link to Settings when the fix is an account. */}
      <SourceControlPanel
        workspaceId={workspaceId}
        {...(chatId ? { chatId } : {})}
        {...(scmHint ? { hint: scmHint } : {})}
        {...(canOpenInEditor
          ? { onOpenFile: editor.openAbsolute }
          : {})}
      />

      {/* ── Body ───────────────────────────────────────────────── */}
      {actions.error && (
        <div className="mx-2 mt-1 rounded bg-danger-muted px-2 py-1 text-[11px] text-danger">
          Could not complete that action: {actions.error}
          <Button
            type="button"
            variant="ghost"
            onClick={actions.dismissError}
            className="ml-2 h-auto w-auto rounded p-0 font-normal underline hover:bg-transparent"
          >
            Dismiss
          </Button>
        </div>
      )}
      {/*
        The checkpoint panel is a sibling of the diff area, NOT a child of
        either branch below. A successful rewind usually drops the change
        count to zero, which would swap branches and remount the timeline —
        discarding the result banner and its skipped-path warnings at exactly
        the moment the user needs to read them.
      */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1">
          {model.isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" /> Loading changes…
            </div>
          ) : stats.files === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              No changes detected in this workspace.
            </div>
          ) : (
            <>
              {/* File tree, docked on the side the user picked. There is no
                  separate flat list: every file already renders as a
                  collapsed header in the diff pane. */}
              {showTree && (
                <div
                  className={cn(
                    'w-56 shrink-0 overflow-auto',
                    treePosition === 'left' ? 'order-first border-r' : 'order-last border-l',
                  )}
                >
                  <ChangesTree
                    paths={model.treePaths}
                    gitStatus={model.treeStatuses}
                    statusColors={TREE_STATUS_COLORS}
                    activePath={activePath}
                    onSelect={nav.selectTreePath}
                    searchPlaceholder="Filter changed files…"
                    style={{ height: '100%' }}
                  />
                </div>
              )}

              {/* Diff viewer, with the reviewed files parked underneath it. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* W28 — DiffProviders wraps the diff surface at its point of
                    use, not the app root. See DiffProviders.tsx's header for
                    why this is safe (the underlying worker pool is a true
                    singleton, lazily created on first mount here and reference-
                    counted, so this costs nothing extra if several diff
                    surfaces are visible at once) and why it removes ~10 MB of
                    eagerly-loaded highlighter/WASM code from every page load
                    that never opens a diff. */}
                <DiffProviders>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1">
                      <DiffCodeView
                        ref={viewerRef}
                        sources={review.decoratedSources}
                        viewMode={viewMode}
                        wrapLines={wrapLines}
                        enableSelection={reviewEnabled}
                        style={{ height: '100%', overflow: 'auto' }}
                        renderHeader={renderHeader}
                        headerHeight={FILE_HEADER_HEIGHT}
                        {...(reviewEnabled ? { onSelectRange: review.selectRange } : {})}
                        {...(reviewEnabled ? { renderAnnotation } : {})}
                        emptyState={
                          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
                            {keptCount > 0 && entries.length === 0
                              ? 'Everything has been reviewed. Kept files are listed below.'
                              : 'Select a file to view its diff.'}
                          </div>
                        }
                      />
                    </div>

                    {/* ── Kept (N) ───────────────────────────────────
                        Reviewed files are not hidden, only moved out of
                        the way: the group opens to the same rows, with the
                        same diffs and an "unkeep" next to each, so a second
                        look never means undoing the review to get one. */}
                    {keptCount > 0 && (
                      <div
                        className={cn('shrink-0 border-t', showKept && 'flex min-h-0 flex-1 flex-col')}
                        data-testid="kept-group"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={keptFiles.toggleKept}
                          aria-expanded={showKept}
                          data-testid="kept-group-toggle"
                          className="h-auto w-full shrink-0 justify-start gap-1.5 rounded-none px-2 py-1 text-left text-[11px] font-normal text-muted-foreground hover:bg-subtle hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn('h-3 w-3 transition-transform', showKept && 'rotate-90')}
                          />
                          <Check className="h-3 w-3 text-success" />
                          <span className="font-medium text-foreground">Kept ({keptCount})</span>
                          <span className="truncate">reviewed and set aside</span>
                        </Button>
                        {showKept && (
                          <div className="min-h-0 flex-1">
                            <DiffCodeView
                              sources={review.decoratedKeptSources}
                              viewMode={viewMode}
                              wrapLines={wrapLines}
                              enableSelection={reviewEnabled}
                              style={{ height: '100%', overflow: 'auto' }}
                              renderHeader={renderHeader}
                              headerHeight={FILE_HEADER_HEIGHT}
                              {...(reviewEnabled ? { onSelectRange: review.selectRange } : {})}
                              {...(reviewEnabled ? { renderAnnotation } : {})}
                              emptyState={<></>}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </DiffProviders>
              </div>
            </>
          )}
        </div>

        {checkpointsPanel.open && workspaceId && (
          // Beside the diff when there is room, over it when there is not.
          // As a fixed 288px column it took nearly half of the right pane and
          // squeezed the diff to a few words per line, with the file header
          // truncated to a single character.
          <div
            className={cn(
              'shrink-0',
              checkpointsPanel.overlay
                ? 'absolute inset-y-0 right-0 z-20 w-full border-l bg-background shadow-xl'
                : 'w-72',
            )}
          >
            <CheckpointTimeline
              workspaceId={workspaceId}
              onClose={checkpointsPanel.close}
              // The timeline hands over a ready-made selector (`turn:<id>` for
              // a grouped turn, `checkpoint:<id>` for a lone snapshot).
              onCompare={setBase}
            />
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

/** Section heading inside the settings popover. */
function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

/**
 * A checkable row. Radio-style groups (view mode, tree position) and plain
 * toggles (wrap) share this on purpose — the checkmark reads the same either
 * way, and the group's exclusivity is enforced by the handler, not the paint.
 */
function MenuCheckItem({
  checked,
  onSelect,
  hint,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onSelect}
      {...(hint ? { title: hint } : {})}
      className="h-auto w-full items-center justify-start gap-2 rounded px-2 py-1 text-left text-[11.5px] font-normal hover:bg-accent-tint"
    >
      <Check
        className={cn('h-3 w-3 shrink-0', checked ? 'opacity-100' : 'opacity-0')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Button>
  );
}

function IconButton({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-6 w-6 rounded hover:bg-accent-tint',
        active && 'bg-accent-tint',
      )}
    >
      {children}
    </Button>
  );
}
