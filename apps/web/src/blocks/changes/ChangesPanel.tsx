// ────────────────────────────────────────────────────────────────
// F-dock-01 ChangesPanel — the Changes dock tab (chat, workflow run,
// automation run). 03-domain §3.3 / §6.3; board DockChanges; D-28.
//
// Summary-first: GET /changes lists every file at once (metadata only), a row
// fetches its body when expanded, B-07 DiffView virtualizes the rows and
// highlights in workers. The data layer is the P4-04 hooks in this block;
// this file only composes them with the pure parts:
//
//   ChangesToolbar   ± · N changes · [Comments] tree · expand · view · checkpoints · refresh
//   CompareBar       This turn / This chat / Branch · Compare against
//   ChangesListBar   +N workspace files · Keep all · Undo all
//   MountGroupsBar   (several mounts)
//   PendingCommentsBar, comment composer, send preview (review)
//   error banner
//   body             CheckpointScrubber strip · [FileTree] DiffView (ChangeFileRow headers) · Kept (N)
//   CommitBar        commit → push → PR (hidden at 0 changes)
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useRef } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DiffCodeView } from '@/blocks/diff/DiffCodeView.js';
import { DiffProviders } from '@/blocks/diff/DiffProviders.js';
import { ReviewComposerPopover } from '@/blocks/diff/review/ReviewComposerPopover.js';
import { ReviewThreadCard } from '@/blocks/diff/review/ReviewThreadCard.js';
import { FileTree } from '@/blocks/files/FileTree.js';
import { CommitBar } from '@/blocks/scm/CommitBar.js';
import type { ReviewIntent, ReviewScope, ReviewSubmitTarget } from '@/types/review.js';
import { ChangeFileRow } from './ChangeFileRow.js';
import { ChangesListBar, CompareBar } from './CompareBar.js';
import { ChangesToolbar } from './ChangesToolbar.js';
import { MountGroupsBar } from './MountGroupsBar.js';
import { CheckpointScrubber } from './checkpoints/CheckpointScrubber.js';
import { CommentsPopover } from './review/CommentsPopover.js';
import { PendingCommentsBar } from './review/PendingCommentsBar.js';
import type { DiffAnnotation, DiffCodeViewHandle } from './diffTypes.js';
import { useChangesEditor } from './useChangesEditor.js';
import { useChangesModel } from './useChangesModel.js';
import { useChangesNavigation } from './useChangesNavigation.js';
import { useChangesViewSettings, useCheckpointPanel } from './useChangesViewSettings.js';
import { useDiffSources, useExpandedDiffs } from './useDiffSources.js';
import { useFileActions, type ChangesNotice, type ConfirmRequest } from './useFileActions.js';
import { useKeptFiles } from './useKeptFiles.js';
import { useReviewOverlay } from './useReviewOverlay.js';
import { useRowHeight } from './useRowHeight.js';

export interface ChangesPanelProps {
  workspaceId?: string;
  /**
   * The chat that owns this workspace, when there is one. Only source control
   * uses it: "Ask the agent" to resolve a conflict is a chat turn.
   */
  chatId?: string;
  /** Seeds generated commit messages / PR text (the chat or run name). */
  scmHint?: string;
  /** Pre-select a base revision, e.g. `stage:<stageRunId>` on a run page. Seeds state once. */
  defaultBase?: string;
  /** Inline review comments: line selection, threads under their anchor, the pending bar. */
  enableReview?: boolean;
  /** Scope the review threads belong to. Required when `enableReview`. */
  reviewScope?: { scope: ReviewScope; scopeId: string };
  /** Where "Send all" delivers the batch. Omit to disable sending. */
  reviewTarget?: ReviewSubmitTarget;
  /** Why sending is unavailable (shown beside the disabled Send all). */
  reviewDisabledReason?: string;
  /** A host that presents checkpoints elsewhere; replaces the built-in scrubber. */
  onOpenCheckpoints?: () => void;
  /**
   * Imperative "show me this file" (display path: `<alias>/<path>`, or
   * `<path>` with one mount). A fresh `token` re-fires for the same path.
   */
  focusFile?: { path: string; token: number } | null;
}

/** Skipped-path reports from Undo: a partial failure, so an error toast (D-30). */
function warnToast(notice: ChangesNotice) {
  toast.error(notice.title, { description: notice.description });
}

export function ChangesPanel({
  workspaceId,
  chatId,
  scmHint,
  defaultBase = 'baseline',
  enableReview = false,
  reviewScope,
  reviewTarget,
  reviewDisabledReason,
  onOpenCheckpoints,
  focusFile,
}: ChangesPanelProps) {
  const settings = useChangesViewSettings(defaultBase);
  const { base, setBase, viewMode, setViewMode, showTree, toggleTree, treePosition, placeTree, wrapLines, toggleWrapLines } =
    settings;
  const checkpointsPanel = useCheckpointPanel();
  const confirmer = useConfirm();
  const rowHeight = useRowHeight();

  const requestConfirmation = useCallback(
    (request: ConfirmRequest) =>
      confirmer.confirm({
        title: request.title,
        description: request.description,
        confirmLabel: request.confirmLabel ?? 'Confirm',
        tone: request.variant === 'destructive' ? 'danger' : 'primary',
      }),
    [confirmer],
  );

  const model = useChangesModel({ workspaceId, base });
  const { summary, multiMount, display, revisionsByAlias } = model;
  const editor = useChangesEditor(model.mounts);
  const { canOpenInEditor, openFile: openFileInEditor } = editor;

  const actions = useFileActions({ workspaceId, revisionsByAlias, display, requestConfirmation, warn: warnToast });
  const { confirmRevert, requestRevert, cancelRevert, busyRow, bulkBusy, canRevertFile, revertFile, undoAll } = actions;

  // Kept files move out of the main list into their own group, so what is
  // left above is exactly what still needs a decision.
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
  // The kept group's own source set: same ids, same lazy bodies.
  const {
    entries: keptEntries,
    sources: keptSources,
    loadingIds: keptLoadingIds,
  } = useDiffSources({ workspaceId, summary: keptFiles.kept, base, head: 'working', expandedIds: expandedDiffs.expandedIds });

  const allEntries = useMemo(() => [...entries, ...keptEntries], [entries, keptEntries]);
  const entryById = useMemo(() => new Map(allEntries.map((e) => [e.id, e])), [allEntries]);
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
   * Each file's header. Replaces the viewer's own so the ± come from the
   * server's numstat (right before the body arrives). Its height is the
   * number handed to the viewer as `headerHeight`.
   */
  const renderHeader = useCallback(
    (item: { id: string; path: string; alias: string }) => {
      const file = entryById.get(item.id)?.file;
      const expanded = expandedIds.has(item.id);
      const openable = !file?.isBinary && !file?.isTooLarge;
      const commentSource = sources.find((source) => source.id === item.id);
      const commentSide = commentSource?.newContents ? 'additions' : 'deletions';
      const commentContent = commentSide === 'additions' ? commentSource?.newContents : commentSource?.oldContents;
      const loading = loadingIds.has(item.id) || keptLoadingIds.has(item.id);
      const displayPath = display(item.alias, item.path);
      return (
        <ChangeFileRow
          path={item.path}
          alias={item.alias}
          showAlias={multiMount}
          displayPath={displayPath}
          file={file}
          height={rowHeight}
          expanded={expanded}
          active={activePath === displayPath}
          loading={loading}
          kept={file?.kept === true}
          busy={busyRow === item.id}
          confirmingUndo={confirmRevert === item.id}
          commentCount={openThreadCountByFile.get(item.id) ?? 0}
          onToggle={() => toggle(item.id)}
          onKeep={() => void keepFile(item.id, item.alias, item.path, file?.newBlob)}
          onUnkeep={() => void unkeepFile(item.id, item.alias, item.path)}
          {...(canOpenInEditor ? { onOpenInEditor: () => openFileInEditor(item.alias, item.path) } : {})}
          {...(canRevertFile(item.alias) ? { onRequestUndo: () => requestRevert(item.id) } : {})}
          onConfirmUndo={() => void revertFile(item.id, item.alias, item.path)}
          onCancelUndo={cancelRevert}
          {...(reviewEnabled && expanded && openable
            ? {
                onComment: (anchor: { x: number; y: number }) => {
                  if (commentContent) commentOnFile(item, commentSide, commentContent, anchor);
                },
                commentDisabled: loading || !commentContent,
              }
            : {})}
        />
      );
    },
    [
      entryById,
      expandedIds,
      sources,
      loadingIds,
      keptLoadingIds,
      display,
      multiMount,
      rowHeight,
      activePath,
      busyRow,
      confirmRevert,
      openThreadCountByFile,
      toggle,
      keepFile,
      unkeepFile,
      canOpenInEditor,
      openFileInEditor,
      canRevertFile,
      requestRevert,
      revertFile,
      cancelRevert,
      reviewEnabled,
      commentOnFile,
    ],
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6">
        <EmptyState icon="changes" title="No workspace yet — changes appear once the agent starts working." />
      </div>
    );
  }

  const { stats, hiddenWorkspaceFiles, showWorkspaceFiles } = model;
  const { threads, pendingSelection, previewPrompt } = review;

  return (
    <div ref={checkpointsPanel.surfaceRef} className="flex h-full min-h-0 flex-col bg-surface text-fg">
      <ChangesToolbar
        stats={stats}
        keptCount={keptCount}
        {...(reviewEnabled
          ? {
              commentsSlot: (
                <CommentsPopover
                  threads={threads}
                  open={review.commentsOpen}
                  onOpenChange={review.setCommentsOpen}
                  onJump={review.jumpToThread}
                  onDelete={review.deleteThread}
                  busy={review.sending}
                  {...(reviewTarget
                    ? { onSendOne: review.sendThread, onSendAll: () => void review.sendBatch('') }
                    : {})}
                />
              ),
            }
          : {})}
        showTree={showTree}
        onToggleTree={toggleTree}
        allExpanded={nav.allExpanded}
        expandDisabled={nav.expandableIds.length === 0}
        onToggleExpandAll={nav.toggleExpandAll}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        wrapLines={wrapLines}
        onToggleWrapLines={toggleWrapLines}
        treePosition={treePosition}
        onPlaceTree={placeTree}
        checkpointsOpen={checkpointsPanel.open}
        onToggleCheckpoints={onOpenCheckpoints ?? checkpointsPanel.toggle}
        refreshing={model.isRefetching}
        onRefresh={() => void model.refetch()}
      />

      <CompareBar base={base} onBaseChange={setBase} options={model.compareOptions} />

      <ChangesListBar
        hiddenWorkspaceFiles={hiddenWorkspaceFiles}
        showWorkspaceFiles={showWorkspaceFiles}
        onToggleWorkspaceFiles={model.toggleWorkspaceFiles}
        files={stats.files}
        keptCount={keptCount}
        bulkBusy={bulkBusy}
        onKeepAll={() => void keepAll()}
        onUndoAll={() => void undoAll()}
      />

      {multiMount && stats.files > 0 ? (
        <MountGroupsBar
          groups={model.mountGroups.map((group) => ({
            alias: group.alias,
            stats: group.stats,
            firstId: group.firstId,
            ...(group.mount?.path ? { path: group.mount.path } : {}),
            ...(group.mount?.git?.branch ? { branch: group.mount.git.branch } : {}),
          }))}
          onJump={nav.jumpToGroup}
        />
      ) : null}

      {reviewEnabled ? (
        <PendingCommentsBar
          pendingCount={review.threadCounts.pending}
          submittedCount={review.threadCounts.submitted}
          addressedCount={review.threadCounts.addressed}
          busy={review.sending}
          {...(reviewTarget
            ? {
                onSendAll: (note: string) => void review.sendBatch(note),
                onPreview: (note: string) => void review.sendBatch(note, true),
              }
            : {})}
          onDiscardAll={review.discardPending}
          {...(reviewDisabledReason ? { disabledReason: reviewDisabledReason } : {})}
        />
      ) : null}

      {/* The comment composer floats beside the selected lines (portal). */}
      {pendingSelection ? (
        <ReviewComposerPopover
          file={pendingSelection.file}
          range={pendingSelection.range}
          anchorPreview={pendingSelection.anchorText}
          anchor={pendingSelection.anchor}
          busy={review.creating}
          {...(pendingSelection.editableLineCount
            ? { lineCount: pendingSelection.editableLineCount, onRangeChange: review.setPendingRange }
            : {})}
          onCancel={review.cancelPendingSelection}
          onSubmit={(body, intent) => void review.submitPendingComment(body, intent, false)}
          {...(reviewTarget
            ? {
                onSubmitAndSend: (body: string, intent: ReviewIntent) =>
                  void review.submitPendingComment(body, intent, true),
              }
            : {})}
        />
      ) : null}

      {previewPrompt !== null ? (
        <div className="shrink-0 border-b border-line-soft px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2 text-small">
            <span className="font-medium text-fg">This will be sent to the agent:</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={review.closePreview}>
              Close
            </Button>
          </div>
          <pre className="max-h-52 overflow-auto rounded-control border border-line-soft bg-sunken px-2.5 py-2 font-mono text-micro whitespace-pre-wrap text-fg-2">
            {previewPrompt}
          </pre>
        </div>
      ) : null}

      {actions.error ? (
        <Callout tone="err" className="mx-3 my-2 shrink-0">
          Could not complete that action: {actions.error}{' '}
          <Button size="sm" variant="ghost" onClick={actions.dismissError}>
            Dismiss
          </Button>
        </Callout>
      ) : null}

      {/*
        The checkpoint strip is a sibling of the diff area, not a child of
        either branch below: a rewind usually drops the change count to zero,
        which swaps branches — and must not remount the strip and lose its
        result banner. Below 760 px of panel width it overlays the top of the
        list; wider, it pushes the list down.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {checkpointsPanel.open ? (
          <div
            className={cn(
              'shrink-0 border-b border-line-soft bg-surface',
              checkpointsPanel.overlay && 'absolute inset-x-0 top-0 z-sticky shadow-pop',
            )}
          >
            <CheckpointScrubber
              workspaceId={workspaceId}
              onClose={checkpointsPanel.close}
              // The scrubber hands over a selector (`turn:<id>` / `checkpoint:<id>`).
              onCompare={setBase}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1">
          {model.isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-small text-fg-3">
              <Spinner size={14} /> Loading changes…
            </div>
          ) : stats.files === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon="changes" title="No changes detected in this workspace." />
            </div>
          ) : (
            <>
              {showTree ? (
                <div
                  className={cn(
                    'w-56 shrink-0 overflow-hidden border-line-soft',
                    treePosition === 'left' ? 'order-first border-r' : 'order-last border-l',
                  )}
                >
                  <FileTree
                    paths={model.treePaths}
                    statuses={model.treeStatuses}
                    activePath={activePath}
                    onSelect={nav.selectTreePath}
                    filterPlaceholder="Filter changed files…"
                  />
                </div>
              ) : null}

              {/* DiffProviders at the point of use: the worker pool is a
                  lazily created, reference-counted singleton, so pages that
                  never open a diff never load the highlighter. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <DiffProviders>
                  <div className="min-h-0 flex-1">
                    <DiffCodeView
                      ref={viewerRef}
                      sources={review.decoratedSources}
                      viewMode={viewMode}
                      wrapLines={wrapLines}
                      enableSelection={reviewEnabled}
                      className="h-full overflow-auto"
                      renderHeader={renderHeader}
                      headerHeight={rowHeight}
                      {...(reviewEnabled ? { onSelectRange: review.selectRange, renderAnnotation } : {})}
                      emptyState={
                        <div className="flex h-full items-center justify-center p-6 text-center text-small text-fg-3">
                          {keptCount > 0 && entries.length === 0
                            ? 'Everything has been reviewed. Kept files are listed below.'
                            : 'Select a file to view its diff.'}
                        </div>
                      }
                    />
                  </div>

                  {/* Kept (N): reviewed files are set aside, not hidden — the
                      group opens to the same rows with Unkeep on each. */}
                  {keptCount > 0 ? (
                    <div
                      className={cn('shrink-0 border-t border-line-soft', showKept && 'flex min-h-0 flex-1 flex-col')}
                      data-testid="kept-group"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        onClick={keptFiles.toggleKept}
                        aria-expanded={showKept}
                        data-testid="kept-group-toggle"
                        className="shrink-0 justify-start rounded-none px-3"
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon concept={showKept ? 'chevron-down' : 'chevron-right'} size={12} />
                          <Icon concept="check" size={12} className="text-ok" />
                          <span className="text-fg">Kept ({keptCount})</span>
                          <span className="truncate font-normal text-fg-3">reviewed and set aside</span>
                        </span>
                      </Button>
                      {showKept ? (
                        <div className="min-h-0 flex-1">
                          <DiffCodeView
                            sources={review.decoratedKeptSources}
                            viewMode={viewMode}
                            wrapLines={wrapLines}
                            enableSelection={reviewEnabled}
                            className="h-full overflow-auto"
                            renderHeader={renderHeader}
                            headerHeight={rowHeight}
                            {...(reviewEnabled ? { onSelectRange: review.selectRange, renderAnnotation } : {})}
                            emptyState={null}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </DiffProviders>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Ship: commit → push → PR. Readiness-driven; nothing to ship at 0 changes. */}
      {stats.files > 0 ? (
        // Capped at half the panel: the flow's step list and result must not
        // squeeze the diff out of view.
        <div className="max-h-1/2 shrink-0 overflow-y-auto">
          <CommitBar
            workspaceId={workspaceId}
            {...(chatId ? { chatId } : {})}
            {...(scmHint ? { hint: scmHint } : {})}
            {...(canOpenInEditor ? { onOpenFile: editor.openAbsolute } : {})}
          />
        </div>
      ) : null}
      {confirmer.dialog}
    </div>
  );
}
