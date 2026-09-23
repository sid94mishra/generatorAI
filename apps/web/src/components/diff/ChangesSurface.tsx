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
  CheckCheck,
  ChevronDown,
  Code2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitCommit,
  GitPullRequest,
  History,
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
  Input,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Spinner,
  Textarea,
  Select,
  useConfirm,
} from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import {
  useWorkspaceChangeSummary,
  useWorkspaceCheckpoints,
  useDiscardWorkspaceChanges,
  useReviewWorkspaceChanges,
  useEditors,
  useOpenInEditor,
} from '@/hooks/queries.js';
import { SourceControlPanel, joinPath } from '@/components/scm/SourceControlPanel.js';
import { isDesktop } from '@/lib/desktop.js';
import type { ChangeSummary } from '@/types/changes.js';
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
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import {
  shouldPrefixAlias,
  toRestorePath,
  withAliasPrefix,
} from '@/components/chat/changes/changePaths.js';
import { splitWorkspaceChanges } from './changeVisibility.js';
import { DiffProviders } from './DiffProviders.js';
import { CheckpointTimeline } from './CheckpointTimeline.js';
import { diffSourceId, useDiffSources, useExpandedDiffs } from './useDiffSources.js';
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

/**
 * Split a summary into "still to review" and "kept".
 *
 * Kept files stay fully present — same ids, same diffs — they just move into
 * their own collapsed group so what is left in the main list is exactly the
 * work still needing a decision. Repos that end up empty on a side are
 * dropped from that side so neither list shows a heading with nothing in it.
 */
export function splitKeptFiles(summary: ChangeSummary | undefined): {
  pending: ChangeSummary | undefined;
  kept: ChangeSummary | undefined;
  keptCount: number;
} {
  if (!summary) return { pending: undefined, kept: undefined, keptCount: 0 };
  const keptRepos: ChangeSummary['repos'] = [];
  const pendingRepos: ChangeSummary['repos'] = [];
  let keptCount = 0;
  for (const repo of summary.repos) {
    const kept = repo.files.filter((f) => f.kept === true);
    const pending = repo.files.filter((f) => f.kept !== true);
    keptCount += kept.length;
    if (kept.length > 0) keptRepos.push({ ...repo, files: kept });
    if (pending.length > 0) pendingRepos.push({ ...repo, files: pending });
  }
  if (keptCount === 0) return { pending: summary, kept: undefined, keptCount: 0 };
  return {
    pending: { ...summary, repos: pendingRepos },
    kept: { ...summary, repos: keptRepos },
    keptCount,
  };
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
  // The timeline lives here rather than in each host page so every surface
  // that renders changes gets rewind for free. `onOpenCheckpoints` still wins
  // when a host wants to present it somewhere else.
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  // Width of this surface, so the checkpoint timeline can pick a layout. The
  // surface is used at very different widths — a ~640px side pane and a
  // full-width run page — and the viewport says nothing about either.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [checkpointsOverlay, setCheckpointsOverlay] = useState(false);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      // 288px of timeline plus a diff still worth reading.
      setCheckpointsOverlay((entry?.contentRect.width ?? 0) < 760);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** File id awaiting discard confirmation, and the last discard failure. */
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  /**
   * Which row is mid-flight, by diff source id.
   *
   * Per row, not per mutation: react-query's `isPending` is one flag shared
   * by every call the hook makes, so undoing one file greyed out — and
   * showed "Discarding…" on — the discard button of every other file at once.
   */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** True while a bulk Keep all / Undo all is running. */
  const [bulkBusy, setBulkBusy] = useState<null | 'keep' | 'undo'>(null);
  /** Whether the "Kept (N)" group at the bottom is open. */
  const [showKept, setShowKept] = useState(false);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();

  const summaryQuery = useWorkspaceChangeSummary(workspaceId, {
    base,
    head: 'working',
  });
  /**
   * The workspace's mounts — the authority for how many things this chat is
   * working on, what each is called, and what each branch was cut from.
   *
   * Two things hang off it: whether a displayed path carries its alias (only
   * worth it when there is more than one mount), and the "Branch base" entries
   * in the compare picker, which need each mount's `git.baseCommit`.
   */
  const workspaceInfo = useWorkspaceInfo(workspaceId);
  const mounts = useMemo(
    () => (workspaceInfo.data?.mounts ?? []).filter((m) => m.status !== 'removed'),
    [workspaceInfo.data],
  );
  const checkpoints = useWorkspaceCheckpoints(workspaceId);
  const reviewChanges = useReviewWorkspaceChanges(workspaceId);
  const discardChanges = useDiscardWorkspaceChanges(workspaceId);

  // "Open in editor", per file. Hidden when the server host has no editor AND
  // we are not in the desktop shell — in a plain browser talking to a remote
  // server the `vscode://` fallback is the only thing that could work, and
  // offering it where nothing is installed anywhere is a dead control.
  const editors = useEditors();
  const openInEditor = useOpenInEditor();
  const canOpenInEditor =
    (editors.data?.some((e) => e.available) ?? false) || isDesktop;
  const mountPathByAlias = useMemo(
    () => new Map(mounts.map((m) => [m.alias, m.path])),
    [mounts],
  );
  const openFileInEditor = useCallback(
    (alias: string, filePath: string) => {
      const root = mountPathByAlias.get(alias);
      if (!root) return;
      openInEditor.mutate({ path: joinPath(root, filePath) });
    },
    [mountPathByAlias, openInEditor],
  );

  // Supporting files the agent scaffolds at the workspace root stay out of the
  // way while a real codebase is being reviewed — see changeVisibility.ts.
  const [showWorkspaceFiles, setShowWorkspaceFiles] = useState(false);
  const { visible: summary, hiddenWorkspaceFiles } = useMemo(
    () => splitWorkspaceChanges(summaryQuery.data, showWorkspaceFiles),
    [summaryQuery.data, showWorkspaceFiles],
  );
  const { expandedIds, toggle, expandAll, collapseAll } = useExpandedDiffs();

  /**
   * Whether a row's path is prefixed with its mount alias.
   *
   * Only when there is a choice to disambiguate. With one mount the alias is
   * the same word on every row, and worse, it makes the path wrong to copy
   * into a terminal. Falls back to the summary's repo count while the
   * workspace document is still loading, so the prefix never flickers on.
   */
  const mountCount = mounts.length || (summary?.repos.length ?? 0);
  const multiMount = shouldPrefixAlias(mountCount);
  const display = useCallback(
    (alias: string, path: string) => withAliasPrefix(alias, path, multiMount),
    [multiMount],
  );

  /** Per-mount roll-up for the group bar: what changed, and where. */
  const mountGroups = useMemo(() => {
    const byAlias = new Map(mounts.map((m) => [m.alias, m]));
    return (summary?.repos ?? []).map((repo) => ({
      alias: repo.alias,
      kind: repo.kind,
      stats: repo.stats,
      firstId: repo.files[0] ? diffSourceId(repo.alias, repo.files[0].path) : null,
      mount: byAlias.get(repo.alias),
    }));
  }, [summary, mounts]);

  /**
   * What "compare against" offers.
   *
   * Turn checkpoints are grouped by `turnId`: one turn writes one checkpoint
   * PER MOUNT, so listing them raw produced the same prompt three times over.
   * `turn:<id>` is the selector the server resolves to that turn's snapshot.
   *
   * "Branch base" is the commit a mount's branch was cut from — the answer to
   * "what does this branch add?", which no checkpoint can express because
   * checkpoints only start at session start.
   */
  const baseOptions = useMemo(() => {
    const options = [{ value: 'baseline', label: 'Since session start' }];

    for (const mount of mounts) {
      const sha = mount.git?.baseCommit;
      if (!sha) continue;
      options.push({
        value: `ref:${sha}`,
        label: `Branch base (${mount.git?.baseRef ?? mount.git?.branch ?? mount.alias})`,
      });
    }

    const seenTurns = new Set<string>();
    for (const c of checkpoints.data?.checkpoints ?? []) {
      if (c.kind === 'baseline' || c.kind === 'pre_restore') continue;
      if (c.turnId) {
        if (seenTurns.has(c.turnId)) continue;
        seenTurns.add(c.turnId);
      }
      options.push({
        value: c.turnId ? `turn:${c.turnId}` : `checkpoint:${c.id}`,
        label: `${c.label ?? c.kind} · ${new Date(c.createdAt).toLocaleTimeString()}`,
      });
      if (options.length > 30) break;
    }
    return options;
  }, [mounts, checkpoints.data]);

  /**
   * Reviewed files are pulled out of the main list into their own group, so
   * what remains above is exactly what still needs a decision.
   */
  const { pending: pendingSummary, kept: keptSummary, keptCount } = useMemo(
    () => splitKeptFiles(summary),
    [summary],
  );

  const { entries, sources, loadingIds } = useDiffSources({
    workspaceId,
    summary: pendingSummary,
    base,
    head: 'working',
    expandedIds,
  });
  // A second source set for the kept group. Same ids and the same lazy
  // fetching, so a kept file is still fully expandable and diffable.
  const {
    entries: keptEntries,
    sources: keptSources,
    loadingIds: keptLoadingIds,
  } = useDiffSources({
    workspaceId,
    summary: keptSummary,
    base,
    head: 'working',
    expandedIds,
  });

  /** Every row on the surface, kept or not — for lookups by id. */
  const allEntries = useMemo(() => [...entries, ...keptEntries], [entries, keptEntries]);
  const entryById = useMemo(
    () => new Map(allEntries.map((e) => [e.id, e])),
    [allEntries],
  );
  const keptIds = useMemo(() => new Set(keptEntries.map((e) => e.id)), [keptEntries]);

  /**
   * Each mount's OWN base revision.
   *
   * The response-level `summary.base` is the FIRST mount's, which is why
   * discard used to be hidden whenever that one happened to have no
   * checkpoint id — including on workspaces where every other mount could
   * perfectly well be undone. A mount can be undone as soon as it resolved a
   * base tree-ish at all; the server restores from a commit just as happily
   * as from a checkpoint row.
   */
  const baseByAlias = useMemo(() => {
    const map = new Map<string, { treeish?: string; label?: string }>();
    for (const repo of summaryQuery.data?.repos ?? []) {
      // Fall back to the response-level revision for a server that predates
      // per-repo bases — wrong for the second mount, but no worse than before.
      const revision = repo.base ?? summaryQuery.data?.base;
      map.set(repo.alias, {
        ...(revision?.treeish ? { treeish: revision.treeish } : {}),
        ...(revision?.label ? { label: revision.label } : {}),
      });
    }
    return map;
  }, [summaryQuery.data]);

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
    editableLineCount?: number;
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
      const displayPath = display(thread.repoAlias, thread.path);
      setCommentsOpen(false);
      setFocusedThreadId(thread.id);
      setActivePath(displayPath);
      if (!expandedIds.has(id)) toggle(id);
      pendingScrollRef.current = id;
    },
    [expandedIds, toggle, display],
  );

  /** Overlay review annotations onto the sources. */
  const decoratedSources = useMemo(() => {
    if (annotationsById.size === 0) return sources;
    return sources.map((s) => {
      const annotations = annotationsById.get(s.id);
      return annotations?.length ? { ...s, annotations } : s;
    });
  }, [sources, annotationsById]);

  /** The same overlay for the kept group — a kept file still takes comments. */
  const decoratedKeptSources = useMemo(() => {
    if (annotationsById.size === 0) return keptSources;
    return keptSources.map((s) => {
      const annotations = annotationsById.get(s.id);
      return annotations?.length ? { ...s, annotations } : s;
    });
  }, [keptSources, annotationsById]);

  const allIds = useMemo(() => allEntries.map((e) => e.id), [allEntries]);

  /**
   * Files that can actually be opened. Binary and oversized files render a
   * placeholder instead of a diff, so counting them would leave "Expand all"
   * looking stuck: it could never reach the all-expanded state.
   */
  const expandableIds = useMemo(
    () =>
      allEntries.filter((e) => !e.file.isBinary && !e.file.isTooLarge).map((e) => e.id),
    [allEntries],
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
      for (const f of repo.files) out.add(display(repo.alias, f.path));
    }
    // No sort: the server already returns files in tree order, and the tree
    // component orders its own rows anyway.
    return [...out];
  }, [summary, display]);

  const treeStatuses = useMemo(() => {
    if (!summary) return [];
    const out: Array<{ path: string; status: TreeGitStatus }> = [];
    for (const repo of summary.repos) {
      for (const f of repo.files) {
        out.push({ path: display(repo.alias, f.path), status: f.status as TreeGitStatus });
      }
    }
    return out;
  }, [summary, display]);

  // External focus (transcript → this file). Waits for the summary to list
  // the file: a click on a just-written file can arrive before the refetch
  // that adds it, and the request must not be lost to that race.
  const lastFocusToken = useRef<number | null>(null);
  useEffect(() => {
    if (!focusFile || lastFocusToken.current === focusFile.token) return;
    const entry = allEntries.find((e) => display(e.alias, e.file.path) === focusFile.path);
    if (!entry) return;
    lastFocusToken.current = focusFile.token;
    setActivePath(focusFile.path);
    // A kept file lives in the collapsed group at the bottom; jumping to one
    // without opening that group would highlight a row nobody can see.
    if (keptIds.has(entry.id)) setShowKept(true);
    if (!expandedIds.has(entry.id)) toggle(entry.id);
    pendingScrollRef.current = entry.id;
  }, [focusFile, allEntries, keptIds, expandedIds, toggle, display]);

  const handleTreeSelect = useCallback(
    (path: string) => {
      const entry = allEntries.find((e) => display(e.alias, e.file.path) === path);
      if (!entry) return;
      setActivePath(path);
      if (keptIds.has(entry.id)) setShowKept(true);
      if (!expandedIds.has(entry.id)) toggle(entry.id);
      // Highlighting a file the user cannot see is not an answer. The list is
      // virtualized, so only the viewer knows where the row is; aligning to
      // the top also means the diff that is about to expand opens into view
      // rather than below the fold.
      pendingScrollRef.current = entry.id;
    },
    [allEntries, keptIds, expandedIds, toggle, display],
  );

  /**
   * Undo one file's changes, returning it to its mount's base revision.
   *
   * Deliberately a server-side restore rather than a reverse-applied patch:
   * restoring is tree-to-tree (adds, deletes and renames all behave), it
   * writes a `pre_restore` checkpoint so the undo is itself undoable, and it
   * refuses to write through symlinks. Reverse-applying would reimplement all
   * of that plus a new failure mode whenever the patch no longer applies.
   *
   * Per FILE, per MOUNT. The previous implementation posted every mount's
   * files at the first mount's checkpoint id and was simply hidden whenever
   * that mount's base was not a checkpoint row — which is the normal case for
   * a linked worktree (its base is the branch commit) and for a plain git
   * folder mounted in place (its first commit).
   */
  const canRevertFile = useCallback(
    (alias: string) => !!workspaceId && !!baseByAlias.get(alias)?.treeish,
    [workspaceId, baseByAlias],
  );

  /** Report paths the server refused rather than dropping them silently. */
  const reportSkipped = useCallback(
    (skipped: Array<{ alias: string; path: string; reason: string }>) => {
      if (skipped.length === 0) return;
      const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ');
      toast({
        variant: 'warning',
        title: `${skipped.length} ${skipped.length === 1 ? 'file was' : 'files were'} skipped`,
        description: `${reasons}. ${skipped
          .slice(0, 4)
          .map((s) => display(s.alias, s.path))
          .join(', ')}${skipped.length > 4 ? '…' : ''}`,
      });
    },
    [display],
  );

  const revertFile = useCallback(
    async (id: string, alias: string, filePath: string) => {
      setRevertError(null);
      setBusyRow(id);
      try {
        // REPO-RELATIVE, never alias-prefixed: a mount's base tree is that
        // mount's tree, so `<alias>/<path>` names a file that is not in it.
        const result = await discardChanges.mutateAsync({
          files: [{ alias, path: toRestorePath(filePath, alias) }],
        });
        reportSkipped(result.skipped);
        const failed = result.mounts.find((m) => !m.ok);
        if (failed?.error) setRevertError(failed.error);
      } catch (err) {
        setRevertError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyRow(null);
        setConfirmRevert(null);
      }
    },
    [discardChanges, reportSkipped],
  );

  /**
   * Mark one file reviewed, at exactly the content on screen.
   *
   * The blob is what makes this durable AND self-correcting: the server
   * stores it, and the file drops back out of "Kept" by itself the moment
   * the agent edits it again.
   */
  const keepFile = useCallback(
    async (id: string, alias: string, filePath: string, blob: string | undefined) => {
      setRevertError(null);
      setBusyRow(id);
      try {
        await reviewChanges.mutateAsync({
          // A deleted file has no head blob; `''` is the sentinel for it.
          keep: [{ alias, path: toRestorePath(filePath, alias), blob: blob ?? '' }],
        });
      } catch (err) {
        setRevertError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyRow(null);
      }
    },
    [reviewChanges],
  );

  const unkeepFile = useCallback(
    async (id: string, alias: string, filePath: string) => {
      setRevertError(null);
      setBusyRow(id);
      try {
        await reviewChanges.mutateAsync({
          unkeep: [{ alias, path: toRestorePath(filePath, alias) }],
        });
      } catch (err) {
        setRevertError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyRow(null);
      }
    },
    [reviewChanges],
  );

  /** Accept everything currently changed. Resolved server-side, on live blobs. */
  const keepAll = useCallback(async () => {
    setRevertError(null);
    setBulkBusy('keep');
    try {
      await reviewChanges.mutateAsync({ keepAll: true });
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(null);
    }
  }, [reviewChanges]);

  /**
   * Throw away every change in the workspace. Confirmed first: this is the
   * one action on this surface that can lose a whole turn's work — though
   * the per-mount `pre_restore` checkpoints still make it recoverable from
   * the rewind timeline.
   */
  const undoAll = useCallback(async () => {
    const ok = await confirmAction({
      title: 'Undo all changes?',
      description:
        `This restores every changed file in this workspace to its base revision. ` +
        `A checkpoint is written first, so it can still be rewound.`,
      confirmLabel: 'Undo all',
      variant: 'destructive',
    });
    if (!ok) return;
    setRevertError(null);
    setBulkBusy('undo');
    try {
      const result = await discardChanges.mutateAsync({ all: true });
      reportSkipped(result.skipped);
      const failed = result.mounts.find((m) => !m.ok);
      if (failed?.error) setRevertError(failed.error);
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(null);
    }
  }, [confirmAction, discardChanges, reportSkipped]);

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
            className="h-4 w-4 shrink-0 rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
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
                  setConfirmRevert(null);
                }}
                className="h-auto rounded px-1.5 py-px text-[10px] font-normal hover:bg-accent"
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
                    const range: DiffLineRange = { start: 1, end: 1, side: commentSide };
                    setPendingSelection({
                      file: item, range, anchorText: anchorTextFor(item.id, range),
                      anchor: { x: rect.left, y: rect.bottom },
                      editableLineCount: commentContent.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length,
                    });
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
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-success hover:bg-accent"
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
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-success"
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
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                    setConfirmRevert(item.id);
                  }}
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
      anchorTextFor,
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
      ref={surfaceRef}
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
          options={baseOptions}
        />

        {(hiddenWorkspaceFiles > 0 || showWorkspaceFiles) && (
          <Button variant="unstyled"
            type="button"
            onClick={() => setShowWorkspaceFiles((v) => !v)}
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="View settings"
                aria-label="View settings"
                className="h-6 w-6 rounded hover:bg-accent"
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

      {/* ── Mount groups ───────────────────────────────────────
          The diff list below is already ordered mount by mount; this names
          each group and says which branch it is on, which is the one thing a
          multi-repo change set cannot be read without. Clicking a group jumps
          to its first file. */}
      {multiMount && stats.files > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1" data-testid="mount-groups">
          {mountGroups.map((group) => (
            <Button
              key={group.alias}
              type="button"
              variant="ghost"
              size="sm"
              disabled={!group.firstId}
              onClick={() => {
                if (!group.firstId) return;
                pendingScrollRef.current = group.firstId;
                setActivePath(null);
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
          {...(pendingSelection.editableLineCount ? {
            lineCount: pendingSelection.editableLineCount,
            onRangeChange: (start: number, end: number) => {
              const range = { ...pendingSelection.range, start, end };
              setPendingSelection({ ...pendingSelection, range, anchorText: anchorTextFor(pendingSelection.file.id, range) });
            },
          } : {})}
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPreviewPrompt(null)}
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
          ? { onOpenFile: (absolutePath: string) => openInEditor.mutate({ path: absolutePath }) }
          : {})}
      />

      {/* ── Body ───────────────────────────────────────────────── */}
      {revertError && (
        <div className="mx-2 mt-1 rounded bg-danger-muted px-2 py-1 text-[11px] text-danger">
          Could not complete that action: {revertError}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRevertError(null)}
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
          {summaryQuery.isLoading ? (
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
                          onClick={() => setShowKept((v) => !v)}
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
                              sources={decoratedKeptSources}
                              viewMode={viewMode}
                              wrapLines={wrapLines}
                              enableSelection={reviewEnabled}
                              style={{ height: '100%', overflow: 'auto' }}
                              renderHeader={renderHeader}
                              headerHeight={FILE_HEADER_HEIGHT}
                              {...(reviewEnabled ? { onSelectRange: handleSelectRange } : {})}
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

        {showCheckpoints && workspaceId && (
          // Beside the diff when there is room, over it when there is not.
          // As a fixed 288px column it took nearly half of the right pane and
          // squeezed the diff to a few words per line, with the file header
          // truncated to a single character.
          <div
            className={cn(
              'shrink-0',
              checkpointsOverlay
                ? 'absolute inset-y-0 right-0 z-20 w-full border-l bg-background shadow-xl'
                : 'w-72',
            )}
          >
            <CheckpointTimeline
              workspaceId={workspaceId}
              onClose={() => setShowCheckpoints(false)}
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
      className="h-auto w-full items-center justify-start gap-2 rounded px-2 py-1 text-left text-[11.5px] font-normal hover:bg-accent"
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
        'h-6 w-6 rounded hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      {children}
    </Button>
  );
}
