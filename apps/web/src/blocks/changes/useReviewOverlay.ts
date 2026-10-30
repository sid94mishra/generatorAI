// ────────────────────────────────────────────────────────────────
// useReviewOverlay — inline review comments on the Changes panel.
//
// Threads, the in-progress selection a new comment is written against, the
// per-file annotations and badges, and every thread action (reply, edit,
// resolve, delete, send one, send all, preview). Rendering stays with the
// host: it gets plain values and stable callbacks.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState, type RefObject } from 'react';
import {
  useAddReviewComment,
  useCreateReviewThread,
  useDeleteReviewThread,
  useReviewThreads,
  useSubmitReview,
  useUpdateReviewComment,
  useUpdateReviewThreadStatus,
} from '@/hooks/reviewQueries.js';
import type { ReviewIntent, ReviewScope, ReviewSubmitTarget } from '@/types/review.js';
import type { DiffAnnotation, DiffCodeViewHandle, DiffLineRange, DiffSource } from './diffTypes.js';
import { diffSourceId, type DiffSourceEntry } from './useDiffSources.js';
import type { MountRevisions } from './useFileActions.js';

export interface PendingSelection {
  file: { id: string; alias: string; path: string };
  range: DiffLineRange;
  anchorText: string;
  /** Viewport point to float the composer beside. */
  anchor: { x: number; y: number } | null;
  /** Lines the composer's range fields may address (header "Comment on"). */
  editableLineCount?: number;
}

export interface UseReviewOverlayOptions {
  workspaceId: string | undefined;
  /** The host asked for review AND gave a scope. */
  enabled: boolean;
  reviewScope: { scope: ReviewScope; scopeId: string } | undefined;
  reviewTarget: ReviewSubmitTarget | undefined;
  /** Rows still to review — the only ones a line selection can start on. */
  entries: readonly DiffSourceEntry[];
  sources: readonly DiffSource[];
  keptSources: readonly DiffSource[];
  revisionsByAlias: ReadonlyMap<string, MountRevisions>;
  display: (alias: string, path: string) => string;
  /** Put a file on screen (see useChangesNavigation). */
  reveal: (id: string, displayPath: string) => void;
  viewerRef: RefObject<Pick<DiffCodeViewHandle, 'clearSelection'> | null>;
}

const isOutstanding = (status: string) => status === 'pending' || status === 'draft';

export function useReviewOverlay({
  workspaceId,
  enabled,
  reviewScope,
  reviewTarget,
  entries,
  sources,
  keptSources,
  revisionsByAlias,
  display,
  reveal,
  viewerRef,
}: UseReviewOverlayOptions) {
  const threadsQuery = useReviewThreads(
    workspaceId,
    reviewScope ? { scope: reviewScope.scope, scopeId: reviewScope.scopeId } : {},
    enabled,
  );
  const createThread = useCreateReviewThread(workspaceId);
  const addComment = useAddReviewComment(workspaceId);
  const updateComment = useUpdateReviewComment(workspaceId);
  const updateStatus = useUpdateReviewThreadStatus(workspaceId);
  const deleteThread = useDeleteReviewThread(workspaceId);
  const submitReview = useSubmitReview(workspaceId);

  const threads = useMemo(() => threadsQuery.data?.threads ?? [], [threadsQuery.data]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  /** Thread to open expanded after a "show me this one" jump. */
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreviewPrompt(null), []);

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
  }, [viewerRef]);

  const threadCounts = useMemo(() => {
    let pending = 0;
    let submitted = 0;
    let addressed = 0;
    for (const t of threads) {
      if (isOutstanding(t.status)) pending++;
      else if (t.status === 'submitted') submitted++;
      else if (t.status === 'addressed') addressed++;
    }
    return { pending, submitted, addressed };
  }, [threads]);

  /** Annotations, grouped by DiffSource id, so the viewer can place them. */
  const annotationsById = useMemo(() => {
    const map = new Map<string, DiffAnnotation[]>();
    if (!enabled) return map;
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
  }, [threads, enabled]);

  const threadsById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  /**
   * Open threads per file, keyed by DiffSource id, for the row badge.
   *
   * Resolved and outdated threads are excluded on purpose: the badge exists
   * to answer "is there anything still outstanding here?", and counting
   * closed conversations would leave every reviewed file permanently flagged.
   */
  const openThreadCountByFile = useMemo(() => {
    const map = new Map<string, number>();
    if (!enabled) return map;
    for (const thread of threads) {
      if (thread.status === 'resolved' || thread.status === 'outdated') continue;
      const id = diffSourceId(thread.repoAlias, thread.path);
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [threads, enabled]);

  /** Extract the selected source lines to use as the comment's anchor. */
  const anchorTextFor = useCallback(
    (fileId: string, range: DiffLineRange): string => {
      const source = sources.find((s) => s.id === fileId);
      if (!source) return '';
      const content = range.side === 'deletions' ? source.oldContents : source.newContents;
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

  /** A line range picked in the viewer (gutter "+" / drag). */
  const selectRange = useCallback(
    (itemId: string, range: DiffLineRange, anchor: { x: number; y: number } | null) => {
      if (!enabled) return;
      const entry = entries.find((e) => e.id === itemId);
      if (!entry) return;
      setPendingSelection({
        file: { id: entry.id, alias: entry.alias, path: entry.file.path },
        range,
        anchorText: anchorTextFor(itemId, range),
        anchor,
      });
    },
    [entries, enabled, anchorTextFor],
  );

  /**
   * Start a comment from a file header's "Comment on" control: line 1 of the
   * side that has content, with range fields bounded by that side's length.
   */
  const commentOnFile = useCallback(
    (
      file: { id: string; alias: string; path: string },
      side: DiffLineRange['side'],
      content: string,
      anchor: { x: number; y: number },
    ) => {
      const range: DiffLineRange = { start: 1, end: 1, side };
      setPendingSelection({
        file,
        range,
        anchorText: anchorTextFor(file.id, range),
        anchor,
        editableLineCount: content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length,
      });
    },
    [anchorTextFor],
  );

  /** Move the pending comment's range (the composer's range fields). */
  const setPendingRange = useCallback(
    (start: number, end: number) => {
      setPendingSelection((current) => {
        if (!current) return current;
        const range = { ...current.range, start, end };
        return { ...current, range, anchorText: anchorTextFor(current.file.id, range) };
      });
    },
    [anchorTextFor],
  );

  /**
   * Create the pending comment's thread, optionally sending just it.
   *
   * It anchors to its OWN mount's base/head checkpoint ids: a checkpoint id
   * belongs to one mount, and the server resolves an id from another mount as
   * that mount's baseline — so a thread on any mount but the first used to
   * measure "what changed since this comment" from the start of the session.
   */
  const submitPendingComment = useCallback(
    async (body: string, intent: ReviewIntent, sendNow: boolean) => {
      if (!pendingSelection || !reviewScope) return;
      const revisions = revisionsByAlias.get(pendingSelection.file.alias);
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
        baseCheckpointId: revisions?.base?.id ?? '',
        headCheckpointId: revisions?.head?.id ?? '',
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
    [pendingSelection, reviewScope, revisionsByAlias, createThread, viewerRef, reviewTarget, submitReview],
  );

  /** Send every pending/draft thread, or preview the prompt that would go. */
  const sendBatch = useCallback(
    async (note: string, preview = false) => {
      if (!reviewTarget) return;
      const ids = threads.filter((t) => isOutstanding(t.status)).map((t) => t.id);
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

  const sendThread = useCallback(
    (id: string) => {
      if (!reviewTarget) return;
      void submitReview.mutateAsync({ threadIds: [id], target: reviewTarget });
    },
    [reviewTarget, submitReview],
  );

  const replyToThread = useCallback(
    (threadId: string, body: string) => void addComment.mutateAsync({ threadId, body }),
    [addComment],
  );
  const editComment = useCallback(
    (threadId: string, commentId: string, body: string) =>
      void updateComment.mutateAsync({ threadId, commentId, body }),
    [updateComment],
  );
  const resolveThread = useCallback(
    (threadId: string) => void updateStatus.mutateAsync({ threadId, status: 'resolved' }),
    [updateStatus],
  );
  const deleteThreadById = useCallback(
    (threadId: string) => void deleteThread.mutateAsync(threadId),
    [deleteThread],
  );
  /** Throw away every comment not yet sent. */
  const discardPending = useCallback(() => {
    for (const t of threads) {
      if (isOutstanding(t.status)) void deleteThread.mutateAsync(t.id);
    }
  }, [threads, deleteThread]);

  /**
   * Reveal a thread picked from the comments list: open its file (and the
   * Kept group, if that is where it lives), mark it active so the tree
   * agrees, and expand that one card.
   */
  const jumpToThread = useCallback(
    (thread: { id: string; repoAlias: string; path: string }) => {
      setCommentsOpen(false);
      setFocusedThreadId(thread.id);
      reveal(diffSourceId(thread.repoAlias, thread.path), display(thread.repoAlias, thread.path));
    },
    [reveal, display],
  );

  /** Overlay review annotations onto the sources. */
  const decoratedSources = useMemo(
    () => decorate(sources, annotationsById),
    [sources, annotationsById],
  );
  /** The same overlay for the kept group — a kept file still takes comments. */
  const decoratedKeptSources = useMemo(
    () => decorate(keptSources, annotationsById),
    [keptSources, annotationsById],
  );

  return {
    threads,
    threadsById,
    threadCounts,
    openThreadCountByFile,
    focusedThreadId,
    commentsOpen,
    setCommentsOpen,
    previewPrompt,
    closePreview,
    pendingSelection,
    cancelPendingSelection,
    selectRange,
    commentOnFile,
    setPendingRange,
    submitPendingComment,
    sendBatch,
    sendThread,
    replyToThread,
    editComment,
    resolveThread,
    deleteThread: deleteThreadById,
    discardPending,
    jumpToThread,
    decoratedSources,
    decoratedKeptSources,
    /** A send (one or all) is in flight. */
    sending: submitReview.isPending,
    /** The new thread is being created. */
    creating: createThread.isPending,
  };
}

function decorate(
  sources: readonly DiffSource[],
  annotationsById: ReadonlyMap<string, DiffAnnotation[]>,
): DiffSource[] {
  if (annotationsById.size === 0) return sources as DiffSource[];
  return sources.map((s) => {
    const annotations = annotationsById.get(s.id);
    return annotations?.length ? { ...s, annotations } : s;
  });
}
