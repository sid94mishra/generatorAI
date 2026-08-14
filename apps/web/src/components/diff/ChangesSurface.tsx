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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  FileDiff,
  GitCommit,
  GitPullRequest,
  History,
  ListTree,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/index.js';
import {
  useWorkspaceChangeSummary,
  useWorkspaceCheckpoints,
  useRestoreWorkspaceCheckpoint,
  useCommitWorkspaceChanges,
  useSourceControlStatus,
  useCreateWorkspacePullRequest,
  useWorkspacePullRequests,
} from '@/hooks/queries.js';
import type { ChangeSummaryFile } from '@/types/changes.js';
import type {
  ReviewIntent,
  ReviewScope,
  ReviewSubmitTarget,
} from '@/types/review.js';
import {
  useReviewThreads,
  useCreateReviewThread,
  useAddReviewComment,
  useUpdateReviewComment,
  useUpdateReviewThreadStatus,
  useDeleteReviewThread,
  useSubmitReview,
} from '@/hooks/reviewQueries.js';
import {
  DiffCodeView,
  type DiffAnnotation,
  type DiffCodeViewHandle,
  type DiffLineRange,
} from './DiffCodeView.js';
import { ChangesTree, type TreeGitStatus } from './ChangesTree.js';
import { CheckpointTimeline } from './CheckpointTimeline.js';
import { diffSourceId, useDiffSources, useExpandedDiffs } from './useDiffSources.js';
import { ReviewThreadCard } from './review/ReviewThreadCard.js';
import { ReviewComposerPopover } from './review/ReviewComposerPopover.js';
import { ReviewCommentsPopover } from './review/ReviewCommentsPopover.js';
import { ReviewBatchBar } from './review/ReviewBatchBar.js';

export interface ChangesSurfaceProps {
  workspaceId?: string;
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

export function ChangesSurface({
  workspaceId,
  embedded = false,
  defaultBase = 'baseline',
  enableReview = false,
  reviewScope,
  reviewTarget,
  reviewDisabledReason,
  onOpenCheckpoints,
}: ChangesSurfaceProps) {
  const [base, setBase] = useState(defaultBase);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified');
  /**
   * Whether the file tree is docked beside the diff.
   *
   * Off by default: with every file rendered as a collapsed header the diff
   * pane already IS the file list, so the tree is a second copy of the same
   * information until the user asks for it.
   */
  const [showTree, setShowTree] = useState(false);
  const [treePosition, setTreePosition] = useState<'left' | 'right'>('left');
  const [wrapLines, setWrapLines] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [showPrForm, setShowPrForm] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  // The timeline lives here rather than in each host page so every surface
  // that renders changes gets rewind for free. `onOpenCheckpoints` still wins
  // when a host wants to present it somewhere else.
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  /** File id awaiting discard confirmation, and the last discard failure. */
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const summaryQuery = useWorkspaceChangeSummary(workspaceId, {
    base,
    head: 'working',
  });
  const checkpoints = useWorkspaceCheckpoints(workspaceId);
  const restoreCheckpoint = useRestoreWorkspaceCheckpoint(workspaceId);
  const scmStatus = useSourceControlStatus();
  const commit = useCommitWorkspaceChanges(workspaceId);
  const createPr = useCreateWorkspacePullRequest(workspaceId);
  const scmEnabled = scmStatus.data?.enabled ?? false;
  const prs = useWorkspacePullRequests(workspaceId, '.', scmEnabled);

  const summary = summaryQuery.data;
  const { expandedIds, toggle, expandAll, collapseAll } = useExpandedDiffs();

  const { entries, sources, loadingIds } = useDiffSources({
    workspaceId,
    summary,
    base,
    head: 'working',
    expandedIds,
  });

  // ── Review ───────────────────────────────────────────────────

  const reviewEnabled = enableReview && !!reviewScope;
  const threadsQuery = useReviewThreads(
    workspaceId,
    reviewScope ? { scope: reviewScope.scope, scopeId: reviewScope.scopeId } : {},
    reviewEnabled,
  );
  const createThread = useCreateReviewThread(workspaceId);
  const addComment = useAddReviewComment(workspaceId);
  const updateComment = useUpdateReviewComment(workspaceId);
  const updateStatus = useUpdateReviewThreadStatus(workspaceId);
  const deleteThread = useDeleteReviewThread(workspaceId);
  const submitReview = useSubmitReview(workspaceId);

  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data]);
  const [pendingSelection, setPendingSelection] = useState<{
    file: { id: string; alias: string; path: string };
    range: DiffLineRange;
    anchorText: string;
    /** Viewport point to float the composer beside. */
    anchor: { x: number; y: number } | null;
  } | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  /** Thread to open expanded after a "show me this one" jump. */
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const viewerRef = useRef<DiffCodeViewHandle>(null);
  /**
   * File the viewer still owes us a scroll to, flushed by the effect below.
   *
   * Scrolling straight from the click does not survive: marking a file active
   * re-renders this component, which hands `CodeView` a new `renderHeader`
   * and therefore a new options object, and applying those options discards
   * any scroll still in flight. Parking the request and replaying it after
   * the commit puts it last, where nothing is left to cancel it.
   */
  const pendingScrollRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (id == null) return;
    pendingScrollRef.current = null;
    viewerRef.current?.scrollToItem(id);
  });

  /**
   * Abandon the in-progress comment AND the highlight it was written
   * against.
   *
   * Leaving the lines selected after a cancel is not a cosmetic bug: the
   * highlight is the only thing telling the user which lines the next
   * comment will attach to, so a stale one silently mis-aims the next
   * comment they write.
   */
  const cancelPendingSelection = useCallback(() => {
    setPendingSelection(null);
    viewerRef.current?.clearSelection();
  }, []);

  const threadCounts = useMemo(() => {
    let pending = 0;
    let submitted = 0;
    let addressed = 0;
    for (const t of threads) {
      if (t.status === 'pending' || t.status === 'draft') pending++;
      else if (t.status === 'submitted') submitted++;
      else if (t.status === 'addressed') addressed++;
    }
    return { pending, submitted, addressed };
  }, [threads]);

  /** Annotations, grouped by DiffSource id, so the viewer can place them. */
  const annotationsById = useMemo(() => {
    const map = new Map<string, DiffAnnotation[]>();
    if (!reviewEnabled) return map;
    for (const thread of threads) {
      const id = diffSourceId(thread.repoAlias, thread.path);
      const list = map.get(id) ?? [];
      list.push({
        side: thread.side,
        // Anchor to the LAST line of the range so the card sits below the
        // whole selection rather than splitting it.
        lineNumber: thread.endLine,
        metadata: { threadId: thread.id },
      });
      map.set(id, list);
    }
    return map;
  }, [threads, reviewEnabled]);

  const threadsById = useMemo(
    () => new Map(threads.map((t) => [t.id, t])),
    [threads],
  );

  /**
   * Open threads per file, keyed by DiffSource id, for the row badge.
   *
   * Resolved and outdated threads are excluded on purpose: the badge exists
   * to answer "is there anything still outstanding here?", and counting
   * closed conversations would leave every reviewed file permanently flagged.
   */
  const openThreadCountByFile = useMemo(() => {
    const map = new Map<string, number>();
    if (!reviewEnabled) return map;
    for (const thread of threads) {
      if (thread.status === 'resolved' || thread.status === 'outdated') continue;
      const id = diffSourceId(thread.repoAlias, thread.path);
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [threads, reviewEnabled]);

  /** Extract the selected source lines to use as the comment's anchor. */
  const anchorTextFor = useCallback(
    (fileId: string, range: DiffLineRange): string => {
      const source = sources.find((s) => s.id === fileId);
      if (!source) return '';
      const content =
        range.side === 'deletions' ? source.oldContents : source.newContents;
      if (!content) return '';
      // Normalise CRLF first: the anchor is re-matched against server-side
      // content that is read as LF, so a stray \r would make the stored text
      // differ from what it is later compared to.
      return content
        .replace(/\r\n/g, '\n')
        .split('\n')
        .slice(range.start - 1, range.end)
        .join('\n');
    },
    [sources],
  );

  const handleSelectRange = useCallback(
    (itemId: string, range: DiffLineRange, anchor: { x: number; y: number } | null) => {
      if (!reviewEnabled) return;
      const entry = entries.find((e) => e.id === itemId);
      if (!entry) return;
      setPendingSelection({
        file: { id: entry.id, alias: entry.alias, path: entry.file.path },
        range,
        anchorText: anchorTextFor(itemId, range),
        anchor,
      });
    },
    [entries, reviewEnabled, anchorTextFor],
  );

  const submitPendingComment = useCallback(
    async (body: string, intent: ReviewIntent, sendNow: boolean) => {
      if (!pendingSelection || !reviewScope) return;
      const created = await createThread.mutateAsync({
        scope: reviewScope.scope,
        scopeId: reviewScope.scopeId,
        alias: pendingSelection.file.alias,
        path: pendingSelection.file.path,
        side: pendingSelection.range.side,
        startLine: pendingSelection.range.start,
        endLine: pendingSelection.range.end,
        anchorText: pendingSelection.anchorText,
        body,
        intent,
        baseCheckpointId: summary?.base.id ?? '',
        headCheckpointId: summary?.head.id ?? '',
      });
      setPendingSelection(null);
      // The comment now lives on those lines, so the transient selection has
      // done its job — leaving it lit would suggest the next action still
      // applies to them.
      viewerRef.current?.clearSelection();
      if (sendNow && reviewTarget) {
        await submitReview.mutateAsync({
          threadIds: [created.id],
          target: reviewTarget,
        });
      }
    },
    [pendingSelection, reviewScope, createThread, summary, reviewTarget, submitReview],
  );

  const sendBatch = useCallback(
    async (note: string, preview = false) => {
      if (!reviewTarget) return;
      const ids = threads
        .filter((t) => t.status === 'pending' || t.status === 'draft')
        .map((t) => t.id);
      if (ids.length === 0) return;
      const result = await submitReview.mutateAsync({
        threadIds: ids,
        target: reviewTarget,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(preview ? { preview: true } : {}),
      });
      if (preview) setPreviewPrompt(result.prompt);
    },
    [threads, reviewTarget, submitReview],
  );

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
          busy={submitReview.isPending}
          onReply={(id, body) => void addComment.mutateAsync({ threadId: id, body })}
          onEdit={(id, commentId, body) =>
            void updateComment.mutateAsync({ threadId: id, commentId, body })
          }
          onResolve={(id) =>
            void updateStatus.mutateAsync({ threadId: id, status: 'resolved' })
          }
          onDelete={(id) => void deleteThread.mutateAsync(id)}
          {...(reviewTarget
            ? {
                onSend: (id: string) =>
                  void submitReview.mutateAsync({
                    threadIds: [id],
                    target: reviewTarget,
                  }),
              }
            : {})}
        />
      );
    },
    [
      threadsById,
      addComment,
      updateComment,
      updateStatus,
      deleteThread,
      submitReview,
      reviewTarget,
      focusedThreadId,
    ],
  );

  /**
   * Reveal a thread picked from the comments list: open its file, mark it
   * active so the tree agrees, and expand that one card.
   */
  const jumpToThread = useCallback(
    (thread: { id: string; repoAlias: string; path: string }) => {
      const id = diffSourceId(thread.repoAlias, thread.path);
      const displayPath =
        thread.repoAlias === '.' ? thread.path : `${thread.repoAlias}/${thread.path}`;
      setCommentsOpen(false);
      setFocusedThreadId(thread.id);
      setActivePath(displayPath);
      if (!expandedIds.has(id)) toggle(id);
      pendingScrollRef.current = id;
    },
    [expandedIds, toggle],
  );

  /** Overlay review annotations onto the sources. */
  const decoratedSources = useMemo(() => {
    if (annotationsById.size === 0) return sources;
    return sources.map((s) => {
      const annotations = annotationsById.get(s.id);
      return annotations?.length ? { ...s, annotations } : s;
    });
  }, [sources, annotationsById]);

  const allIds = useMemo(() => entries.map((e) => e.id), [entries]);

  /**
   * Files that can actually be opened. Binary and oversized files render a
   * placeholder instead of a diff, so counting them would leave "Expand all"
   * looking stuck: it could never reach the all-expanded state.
   */
  const expandableIds = useMemo(
    () =>
      entries.filter((e) => !e.file.isBinary && !e.file.isTooLarge).map((e) => e.id),
    [entries],
  );
  const allExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expandedIds.has(id));

  // Auto-expand a small change set — for one or two files the extra click is
  // pure friction, and the payload is trivial.
  const autoExpandKey = allIds.join('\u0000');
  useEffect(() => {
    if (allIds.length > 0 && allIds.length <= 3) expandAll(allIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpandKey]);

  /**
   * Paths for the tree — the CHANGED files only.
   *
   * This surface answers "what changed?", so listing every file in the
   * workspace here would contradict the header count right above it ("8
   * changes" over a tree of hundreds) and duplicate the Files tab, which
   * exists precisely to browse everything. Deleted files are included even
   * though they are gone from disk: they are exactly what a reviewer wants
   * to click on.
   */
  const treePaths = useMemo(() => {
    const out = new Set<string>();
    for (const repo of summary?.repos ?? []) {
      const prefix = repo.alias === '.' ? '' : `${repo.alias}/`;
      for (const f of repo.files) out.add(prefix + f.path);
    }
    // No sort: the server already returns files in tree order, and the tree
    // component orders its own rows anyway.
    return [...out];
  }, [summary]);

  const treeStatuses = useMemo(() => {
    if (!summary) return [];
    const out: Array<{ path: string; status: TreeGitStatus }> = [];
    for (const repo of summary.repos) {
      const prefix = repo.alias === '.' ? '' : `${repo.alias}/`;
      for (const f of repo.files) {
        out.push({ path: prefix + f.path, status: f.status as TreeGitStatus });
      }
    }
    return out;
  }, [summary]);

  const handleTreeSelect = useCallback(
    (path: string) => {
      const entry = entries.find(
        (e) => (e.alias === '.' ? e.file.path : `${e.alias}/${e.file.path}`) === path,
      );
      if (!entry) return;
      setActivePath(path);
      if (!expandedIds.has(entry.id)) toggle(entry.id);
      // Highlighting a file the user cannot see is not an answer. The list is
      // virtualized, so only the viewer knows where the row is; aligning to
      // the top also means the diff that is about to expand opens into view
      // rather than below the fold.
      pendingScrollRef.current = entry.id;
    },
    [entries, expandedIds, toggle],
  );

  /**
   * Discard one file's changes, returning it to the base revision.
   *
   * This is deliberately a single-path checkpoint restore rather than a
   * reverse-applied patch. Restoring is already the tested primitive: it is
   * tree-to-tree (so adds, deletes and renames are all handled), it writes a
   * `pre_restore` checkpoint so the discard is itself undoable, and it
   * refuses to write through symlinks. Reverse-applying a patch would
   * reimplement all of that, with a new failure mode whenever the patch no
   * longer applies cleanly.
   *
   * Requires a real checkpoint to restore from, which is why it is hidden
   * when the base is the working tree or an arbitrary git ref.
   */
  const baseCheckpointId = summary?.base.id;
  const canRevert = !!workspaceId && !!baseCheckpointId;

  const revertFile = useCallback(
    async (alias: string, path: string) => {
      if (!baseCheckpointId) return;
      // Restore takes workspace-relative paths; a non-root repo is addressed
      // through its alias prefix.
      const target = alias === '.' ? path : `${alias}/${path}`;
      setRevertError(null);
      try {
        await restoreCheckpoint.mutateAsync({
          checkpointId: baseCheckpointId,
          paths: [target],
        });
      } catch (err) {
        setRevertError(err instanceof Error ? err.message : String(err));
      } finally {
        setConfirmRevert(null);
      }
    },
    [baseCheckpointId, restoreCheckpoint],
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
      const entry = entries.find((e) => e.id === item.id);
      const file = entry?.file;
      const badge = STATUS_STYLE[file?.status ?? 'modified'] ?? STATUS_STYLE['modified']!;
      const confirming = confirmRevert === item.id;
      const expanded = expandedIds.has(item.id);
      const loading = loadingIds.has(item.id);
      const openable = !file?.isBinary && !file?.isTooLarge;
      const displayPath = item.alias === '.' ? item.path : `${item.alias}/${item.path}`;
      const isActive = activePath === displayPath;
      const commentCount = openThreadCountByFile.get(item.id) ?? 0;
      return (
        <div
          className={cn(
            'group relative flex h-full w-full min-w-0 items-center gap-1.5 border-b pl-2 pr-1 text-xs transition-colors',
            // Tints are built on `--color-primary` (a solid colour), NOT
            // `--color-accent`, which is already a ~10%-alpha wash of it —
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (openable) toggle(item.id);
            }}
            disabled={!openable}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${item.path}` : `Expand ${item.path}`}
            title={expanded ? 'Hide changes' : 'Show changes'}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
          {/* File-type icon, leading the row. Real brand-coloured glyphs
              (the same set the tree uses) so a file is recognisable by shape
              and colour before the path is read. */}
          <FileTypeIcon
            name={item.path.split('/').pop() ?? item.path}
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate font-mono" title={item.path}>
            {item.alias !== '.' && (
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
          {canRevert &&
            (confirming ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void revertFile(item.alias, item.path);
                  }}
                  disabled={restoreCheckpoint.isPending}
                  className="rounded bg-amber-500 px-1.5 py-px text-[10px] font-medium text-white disabled:opacity-50"
                >
                  {restoreCheckpoint.isPending ? 'Discarding…' : 'Confirm discard'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRevert(null);
                  }}
                  className="rounded px-1.5 py-px text-[10px] hover:bg-accent"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                title="Discard this file's changes (undoable)"
                aria-label={`Discard changes to ${item.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmRevert(item.id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Undo2 className="h-3 w-3" />
              </button>
            ))}
        </div>
      );
    },
    [
      entries,
      canRevert,
      confirmRevert,
      revertFile,
      restoreCheckpoint.isPending,
      expandedIds,
      loadingIds,
      toggle,
      activePath,
      openThreadCountByFile,
    ],
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No workspace yet — changes appear once the agent starts working.
      </div>
    );
  }

  const stats = summary?.stats ?? { files: 0, additions: 0, deletions: 0 };

  return (
    // `bg-background` is load-bearing, not decoration. The code viewer paints
    // its own canvas (pinned to this same token in `diffHostStyle`), so
    // without it the tree, the toolbar and the file rows would sit on the
    // host pane's translucent card tint while the diff sat on the solid
    // background — two near-blacks a few percent apart, with a visible seam
    // down the middle of the panel.
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-background',
        !embedded && 'rounded-lg border',
      )}
    >
      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">
          {stats.files} {stats.files === 1 ? 'change' : 'changes'}
        </span>
        {(stats.additions > 0 || stats.deletions > 0) && (
          <span className="font-mono text-[10px]">
            <span className="text-emerald-500">+{stats.additions}</span>{' '}
            <span className="text-rose-500">−{stats.deletions}</span>
          </span>
        )}

        {/* Base revision picker — turns this surface into "since session
            start" vs "since this turn/stage". */}
        <select
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="ml-1 h-6 max-w-[190px] rounded border bg-transparent px-1 text-[11px]"
          title="Compare against"
          aria-label="Compare against"
        >
          <option value="baseline">Since session start</option>
          {(checkpoints.data?.checkpoints ?? [])
            .filter((c) => c.kind !== 'baseline' && c.kind !== 'pre_restore')
            .slice(0, 25)
            .map((c) => (
              <option key={c.id} value={`checkpoint:${c.id}`}>
                {c.label ?? c.kind} · {new Date(c.createdAt).toLocaleTimeString()}
              </option>
            ))}
        </select>

        <div className="ml-auto flex items-center gap-0.5">
          {/* Every comment on this diff, in one list — the same affordance
              the integrated browser puts on its own toolbar. */}
          {reviewEnabled && (
            <ReviewCommentsPopover
              threads={threads}
              open={commentsOpen}
              onOpenChange={setCommentsOpen}
              onJump={jumpToThread}
              onDelete={(id) => void deleteThread.mutateAsync(id)}
              busy={submitReview.isPending}
              {...(reviewTarget
                ? {
                    onSendOne: (id: string) =>
                      void submitReview.mutateAsync({
                        threadIds: [id],
                        target: reviewTarget,
                      }),
                    onSendAll: () => void sendBatch(''),
                  }
                : {})}
            />
          )}
          {/* Dock the tree beside the diff. Off by default because the diff
              pane already lists every file as a collapsed header. */}
          <IconButton
            title={showTree ? 'Hide file tree' : 'Show file tree'}
            onClick={() => setShowTree((v) => !v)}
            active={showTree}
          >
            <ListTree className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            title={allExpanded ? 'Collapse all files' : 'Expand all files'}
            onClick={() => (allExpanded ? collapseAll() : expandAll(expandableIds))}
            disabled={expandableIds.length === 0}
          >
            {allExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </IconButton>

          {/* View preferences. Grouped behind a gear so the bar stays
              readable at the narrow widths the right pane is usually at. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="View settings"
                aria-label="View settings"
                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
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
              <MenuCheckItem checked={wrapLines} onSelect={() => setWrapLines((w) => !w)}>
                Wrap lines
              </MenuCheckItem>
              <MenuSeparator />
              <MenuLabel>File tree position</MenuLabel>
              <MenuCheckItem
                checked={treePosition === 'left'}
                onSelect={() => {
                  setTreePosition('left');
                  setShowTree(true);
                }}
              >
                Left
              </MenuCheckItem>
              <MenuCheckItem
                checked={treePosition === 'right'}
                onSelect={() => {
                  setTreePosition('right');
                  setShowTree(true);
                }}
              >
                Right
              </MenuCheckItem>
            </PopoverContent>
          </Popover>

          <IconButton
            title="Checkpoints & rewind"
            onClick={onOpenCheckpoints ?? (() => setShowCheckpoints((v) => !v))}
            active={showCheckpoints}
          >
            <History className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            title="Refresh"
            onClick={() => void summaryQuery.refetch()}
            disabled={summaryQuery.isRefetching}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', summaryQuery.isRefetching && 'animate-spin')}
            />
          </IconButton>
        </div>
      </div>

      {/* ── Review batch ───────────────────────────────────────── */}
      {reviewEnabled && (
        <ReviewBatchBar
          pendingCount={threadCounts.pending}
          submittedCount={threadCounts.submitted}
          addressedCount={threadCounts.addressed}
          busy={submitReview.isPending}
          {...(reviewTarget ? { onSendAll: (note: string) => void sendBatch(note) } : {})}
          {...(reviewTarget
            ? { onPreview: (note: string) => void sendBatch(note, true) }
            : {})}
          onDiscardAll={() => {
            for (const t of threads) {
              if (t.status === 'pending' || t.status === 'draft') {
                void deleteThread.mutateAsync(t.id);
              }
            }
          }}
          {...(reviewDisabledReason ? { disabledReason: reviewDisabledReason } : {})}
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
          busy={createThread.isPending}
          onCancel={cancelPendingSelection}
          onSubmit={(body, intent) => void submitPendingComment(body, intent, false)}
          {...(reviewTarget
            ? {
                onSubmitAndSend: (body: string, intent: ReviewIntent) =>
                  void submitPendingComment(body, intent, true),
              }
            : {})}
        />
      )}

      {/* ── Submission preview ─────────────────────────────────── */}
      {previewPrompt !== null && (
        <div className="border-b p-2">
          <div className="mb-1 flex items-center gap-2 text-[11px]">
            <span className="font-medium">This will be sent to the agent:</span>
            <button
              type="button"
              onClick={() => setPreviewPrompt(null)}
              className="ml-auto rounded border px-1.5 text-[10px] hover:bg-accent"
            >
              Close
            </button>
          </div>
          <pre className="max-h-52 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-tight whitespace-pre-wrap">
            {previewPrompt}
          </pre>
        </div>
      )}

      {/* ── Source-control actions ─────────────────────────────── */}
      {scmEnabled && stats.files > 0 && (
        <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
          <button
            type="button"
            onClick={() => void commit.mutateAsync(undefined)}
            disabled={commit.isPending}
            className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            {commit.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <GitCommit className="h-3 w-3" />
            )}
            Commit
          </button>
          <button
            type="button"
            onClick={() => setShowPrForm((v) => !v)}
            className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] hover:bg-accent"
          >
            <GitPullRequest className="h-3 w-3" />
            Pull request
          </button>
          {commit.isSuccess && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
              <Check className="h-3 w-3" /> Committed
            </span>
          )}
        </div>
      )}

      {showPrForm && (
        <div className="space-y-1.5 border-b px-2 py-2">
          <input
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder="Pull request title"
            className="h-7 w-full rounded border bg-transparent px-2 text-xs"
          />
          <textarea
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full resize-none rounded border bg-transparent px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={!prTitle.trim() || createPr.isPending}
            onClick={() => {
              void createPr.mutateAsync({ title: prTitle.trim(), body: prBody }).then(() => {
                setShowPrForm(false);
                setPrTitle('');
                setPrBody('');
              });
            }}
            className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            {createPr.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Create
          </button>
        </div>
      )}

      {(prs.data?.pullRequests?.length ?? 0) > 0 && (
        <div className="border-b px-2 py-1.5">
          {prs.data!.pullRequests.map((pr) => (
            <a
              key={pr.number}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 py-0.5 text-[11px] hover:underline"
            >
              <GitPullRequest className="h-3 w-3 shrink-0" />
              <span className="truncate">#{pr.number} {pr.title}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
            </a>
          ))}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      {revertError && (
        <div className="mx-2 mt-1 rounded bg-danger-muted px-2 py-1 text-[11px] text-danger">
          Could not discard the file: {revertError}
          <button onClick={() => setRevertError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}
      {/*
        The checkpoint panel is a sibling of the diff area, NOT a child of
        either branch below. A successful rewind usually drops the change
        count to zero, which would swap branches and remount the timeline —
        discarding the result banner and its skipped-path warnings at exactly
        the moment the user needs to read them.
      */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1">
          {summaryQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading changes…
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
                    paths={treePaths}
                    gitStatus={treeStatuses}
                    statusColors={TREE_STATUS_COLORS}
                    activePath={activePath}
                    onSelect={handleTreeSelect}
                    searchPlaceholder="Filter changed files…"
                    style={{ height: '100%' }}
                  />
                </div>
              )}

              {/* Diff viewer */}
              <div className="min-w-0 flex-1">
                <DiffCodeView
                  ref={viewerRef}
                  sources={decoratedSources}
                  viewMode={viewMode}
                  wrapLines={wrapLines}
                  enableSelection={reviewEnabled}
                  style={{ height: '100%', overflow: 'auto' }}
                  renderHeader={renderHeader}
                  headerHeight={FILE_HEADER_HEIGHT}
                  {...(reviewEnabled ? { onSelectRange: handleSelectRange } : {})}
                  {...(reviewEnabled ? { renderAnnotation } : {})}
                  emptyState={
                    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
                      Select a file to view its diff.
                    </div>
                  }
                />
              </div>
            </>
          )}
        </div>

        {showCheckpoints && workspaceId && (
          <div className="w-72 shrink-0">
            <CheckpointTimeline
              workspaceId={workspaceId}
              onClose={() => setShowCheckpoints(false)}
              onCompare={(id) => setBase(`checkpoint:${id}`)}
            />
          </div>
        )}
      </div>
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
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onSelect}
      {...(hint ? { title: hint } : {})}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11.5px] hover:bg-accent"
    >
      <Check
        className={cn('h-3 w-3 shrink-0', checked ? 'opacity-100' : 'opacity-0')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
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
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-50',
        active && 'bg-accent',
      )}
    >
      {children}
    </button>
  );
}

