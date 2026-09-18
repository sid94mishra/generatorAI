// ────────────────────────────────────────────────────────────────
// Workbench › Changes — the mobile form of web's ChangesSurface.
//
// A thin pane over the shared Changes components (D20): the file list,
// the virtualised diff, the review sheet, the checkpoints sheet and the
// commit bar all live in `src/components/changes` and `src/components/
// review`; this file only decides how they are arranged on a phone.
//
// Tap a file → its diff opens inline (capped); the maximise button or the
// cap notice opens it full width inside the pane. Long-press a line →
// comment. The base picker is behind the history icon: a permanent strip
// of checkpoint chips cost a whole band of vertical space to duplicate
// what that sheet already says.
//
// `active: false` pauses every query subscription here without dropping
// the cache, so a pane the user swiped away from is free while hidden.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff as FileDiffIcon,
  History,
  MessageSquare,
  RefreshCw,
  Send,
  WrapText,
} from 'lucide-react-native';
import { checkpointTime } from '../../review/checkpointGroups';
import { Touchable } from '../../ui/Touchable';
import { Button, IconButton } from '../../ui/Button';
import { EmptyState, ErrorState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { useApi } from '../../../api/useApi';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  ChangesList,
  CommitBar,
  FileDiffPane,
  Toolbar,
  checkpointLabel,
  restorePath,
  setDiffWrap,
  useChangesSummary,
  useDiffPrefs,
  type ChangeRow,
  type CommentRequest,
  type DiffSide,
} from '../../changes';
import {
  CheckpointsSheet,
  ReviewCommentsSheet,
  batchSummary,
  countThreads,
  useCapability,
  useReviewThreads,
  useWorkspaceCheckpoints,
  type ReviewDraft,
  type ReviewFocus,
} from '../../review';

export { Toolbar } from '../../changes/Toolbar';

export interface ChangesSectionProps {
  workspaceId: string;
  /** The chat the review threads belong to and are sent back to. */
  chatId?: string | null;
  /** False while the pane is off screen: queries pause, nothing heavy renders. */
  active?: boolean;
  /** Open this file's diff on mount (deep link from a tool row or the tray). */
  focusPath?: string | null;
  /**
   * Bumped by the caller to ask for the SAME `focusPath` again (tapping one
   * tray file twice). A focus request is consumed once: the list polling in
   * the background must never re-open a file the user already backed out of.
   */
  focusNonce?: number;
  /** Hand a file to the Files pane. Omitted → the menu item is not shown. */
  onOpenInFiles?: (path: string, alias?: string) => void;
  /**
   * Controlled detail (legacy Workbench contract). When supplied the pane
   * shows that file and `onOpenFile` is asked to change it; otherwise the
   * pane keeps its own detail state.
   */
  detail?: { path: string; alias?: string } | null;
  onOpenFile?: (path: string, alias?: string) => void;
}

interface Detail {
  path: string;
  alias: string;
}

export function ChangesSection({
  workspaceId,
  chatId = null,
  active = true,
  focusPath = null,
  focusNonce = 0,
  onOpenInFiles,
  detail: controlledDetail,
  onOpenFile,
}: ChangesSectionProps): React.ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const toast = useToast();
  const { wrap } = useDiffPrefs();
  const restoreCap = useCapability('restoreCheckpoints');

  const [base, setBase] = useState('baseline');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [ownDetail, setOwnDetail] = useState<Detail | null>(null);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [reviewSheet, setReviewSheet] = useState<{ draft?: ReviewDraft; focus?: ReviewFocus } | null>(null);

  const changes = useChangesSummary(workspaceId, { base, active });
  const checkpoints = useWorkspaceCheckpoints(workspaceId, active);
  const review = useReviewThreads(workspaceId, chatId ? { scope: 'chat', scopeId: chatId } : null, {
    active,
    target: chatId ? { kind: 'chat', chatId } : null,
  });

  const detail: Detail | null = controlledDetail
    ? { path: controlledDetail.path, alias: controlledDetail.alias ?? '.' }
    : ownDetail;

  const openDetail = useCallback(
    (path: string, alias: string) => {
      if (onOpenFile) onOpenFile(path, alias);
      else setOwnDetail({ path, alias });
    },
    [onOpenFile],
  );

  // Deep link: open the named file once its row exists — ONCE per request.
  // Keyed on path + nonce, because `changes.files` changes on every poll and
  // re-opening on each would trap the user on the diff they just closed.
  const consumedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPath) return;
    const key = `${focusPath}#${focusNonce}`;
    if (consumedFocus.current === key) return;
    const row = changes.files.find((f) => f.path === focusPath);
    if (!row) return;
    consumedFocus.current = key;
    openDetail(row.path, row.alias);
  }, [focusPath, focusNonce, changes.files, openDetail]);

  // Hardware back (Android) closes an in-pane diff before anything else
  // handles it. Registered only while a diff is open and the pane is on
  // screen; BackHandler runs the newest subscription first.
  useEffect(() => {
    if (!active || !ownDetail || controlledDetail) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOwnDetail(null);
      return true;
    });
    return () => sub.remove();
  }, [active, ownDetail, controlledDetail]);

  const multiMount = useMemo(
    () => new Set(changes.files.map((f) => f.alias)).size > 1,
    [changes.files],
  );

  /** The checkpoint a discard restores from: the compared base, else the baseline. */
  const baseCheckpointId = useMemo(() => {
    const summaryBase = changes.summary?.base;
    if (summaryBase?.id && (summaryBase.kind === 'checkpoint' || summaryBase.kind === 'baseline')) return summaryBase.id;
    if (base.startsWith('checkpoint:')) return base.slice('checkpoint:'.length);
    return checkpoints.data?.checkpoints.find((c) => c.kind === 'baseline')?.id ?? null;
  }, [changes.summary, base, checkpoints.data]);

  const reviewCheckpoints = useMemo(
    () => ({
      base: changes.summary?.base?.id ?? baseCheckpointId ?? '',
      head: changes.summary?.head?.id ?? '',
    }),
    [changes.summary, baseCheckpointId],
  );

  const baseLabel = useMemo(() => {
    if (base === 'baseline') return 'session start';
    const summaryBase = changes.summary?.base;
    if (summaryBase?.label) return summaryBase.label;
    const found = checkpoints.data?.checkpoints.find(
      (c) => `checkpoint:${c.id}` === base || (c.turnId && `turn:${c.turnId}` === base),
    );
    return found
      ? `${checkpointLabel(found)} · ${new Date(checkpointTime(found.createdAt)).toLocaleTimeString()}`
      : 'a checkpoint';
  }, [base, changes.summary, checkpoints.data]);

  // Discard is a single-path checkpoint restore, not a reverse patch — the
  // same call web makes, and undoable because the server snapshots first.
  const restore = useMutation({
    mutationFn: (vars: { checkpointId: string; paths: string[] }) =>
      api.workspaces.restoreCheckpoint(workspaceId, vars.checkpointId, { paths: vars.paths }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
      toast({ message: 'Discarded — a snapshot was saved first', tone: 'success' });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not discard', tone: 'error' }),
  });

  const discard = useCallback(
    (row: ChangeRow) => {
      if (!baseCheckpointId) {
        toast({ message: 'No checkpoint to restore from yet', tone: 'error' });
        return;
      }
      haptics.warn();
      restore.mutate({ checkpointId: baseCheckpointId, paths: [restorePath(row.alias, row.path)] });
    },
    [baseCheckpointId, restore, toast],
  );

  const commentOn = useCallback(
    (row: { path: string; alias: string }, request: CommentRequest) =>
      setReviewSheet({ draft: { path: row.path, alias: row.alias, ...request } }),
    [],
  );
  const openThreadsAt = useCallback(
    (row: { path: string; alias: string }, side: DiffSide, line: number) =>
      setReviewSheet({ focus: { path: row.path, alias: row.alias, side, line } }),
    [],
  );
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const counts = useMemo(() => countThreads(review.threads), [review.threads]);
  const commentDisabledReason = review.canWrite ? null : review.writeReason;

  const sheets = (
    <>
      <ReviewCommentsSheet
        visible={reviewSheet !== null}
        onClose={() => setReviewSheet(null)}
        review={review}
        draft={reviewSheet?.draft ?? null}
        focus={reviewSheet?.focus ?? null}
        checkpoints={reviewCheckpoints}
      />
      <CheckpointsSheet
        visible={showCheckpoints}
        onClose={() => setShowCheckpoints(false)}
        workspaceId={workspaceId}
        currentBase={base}
        onCompare={setBase}
      />
    </>
  );

  // ── Detail: one file, full width ───────────────────────────────
  if (detail) {
    const entry = changes.files.find((r) => r.path === detail.path && r.alias === detail.alias);
    const threads = review.byFile.get(`${detail.alias}:${detail.path}`);
    return (
      <View className="flex-1">
        {!controlledDetail ? (
          <Touchable
            accessibilityLabel="Back to the file list"
            haptic="tap"
            onPress={() => setOwnDetail(null)}
            className="min-h-11 flex-row items-center gap-1 px-4"
          >
            <ChevronLeft size={18} color={colors.primary} />
            <Text className="text-sm text-primary">All changes</Text>
          </Touchable>
        ) : null}
        <FileDiffPane
          workspaceId={workspaceId}
          path={detail.path}
          alias={detail.alias}
          base={base}
          {...(entry?.oldBlob ? { oldBlob: entry.oldBlob } : {})}
          {...(entry?.newBlob ? { newBlob: entry.newBlob } : {})}
          {...(entry?.lang ? { lang: entry.lang } : {})}
          {...(entry ? { additions: entry.additions, deletions: entry.deletions } : {})}
          {...(threads ? { threads } : {})}
          openThreadCount={(threads ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'outdated').length}
          onShowComments={() => setReviewSheet({ focus: { path: detail.path, alias: detail.alias } })}
          {...(review.canWrite ? { onComment: (request: CommentRequest) => commentOn(detail, request) } : {})}
          onOpenThreads={(side, line) => openThreadsAt(detail, side, line)}
          commentDisabledReason={commentDisabledReason}
        />
        {sheets}
      </View>
    );
  }

  // ── List ───────────────────────────────────────────────────────
  const allExpanded = changes.files.length > 0 && expanded.size >= changes.files.length;
  const openThreads = counts.pending + counts.submitted + counts.addressed;

  return (
    <View className="flex-1">
      <Toolbar>
        <FileDiffIcon size={14} color={colors['muted-foreground']} />
        <Text className="text-sm font-medium text-foreground">
          {changes.files.length} {changes.files.length === 1 ? 'change' : 'changes'}
        </Text>
        {changes.additions > 0 || changes.deletions > 0 ? (
          <Text className="font-mono text-xs">
            <Text className="text-success">+{changes.additions}</Text> <Text className="text-danger">−{changes.deletions}</Text>
          </Text>
        ) : null}
        <View className="flex-1" />
        {changes.files.length > 0 ? (
          <IconButton
            accessibilityLabel={allExpanded ? 'Collapse all files' : 'Expand all files'}
            compact
            icon={
              allExpanded ? (
                <ChevronsDownUp size={16} color={colors['muted-foreground']} />
              ) : (
                <ChevronsUpDown size={16} color={colors['muted-foreground']} />
              )
            }
            onPress={() => setExpanded(allExpanded ? new Set() : new Set(changes.files.map((r) => r.id)))}
          />
        ) : null}
        <IconButton
          accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
          compact
          selected={wrap}
          icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
          onPress={() => setDiffWrap(!wrap)}
        />
        {review.canRead ? (
          <IconButton
            accessibilityLabel={openThreads ? `${openThreads} review comments` : 'Review comments'}
            compact
            badge={counts.pending > 0}
            icon={<MessageSquare size={16} color={openThreads ? colors.primary : colors['muted-foreground']} />}
            onPress={() => setReviewSheet({})}
          />
        ) : null}
        <IconButton
          accessibilityLabel="Checkpoints, compare and rewind"
          compact
          selected={base !== 'baseline'}
          icon={<History size={16} color={base !== 'baseline' ? colors.primary : colors['muted-foreground']} />}
          onPress={() => setShowCheckpoints(true)}
        />
        <IconButton
          accessibilityLabel="Refresh changes"
          compact
          icon={<RefreshCw size={16} color={changes.isFetching ? colors.primary : colors['muted-foreground']} />}
          onPress={changes.refetch}
          disabled={changes.isFetching}
        />
      </Toolbar>

      {base !== 'baseline' ? (
        <View className="flex-row items-center gap-2 border-b border-border-muted bg-subtle px-3 py-1.5">
          <History size={12} color={colors['muted-foreground']} />
          <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
            Comparing against {baseLabel}
          </Text>
          <Touchable
            accessibilityLabel="Compare against session start"
            haptic="select"
            onPress={() => setBase('baseline')}
            className="rounded-full px-2 py-0.5"
          >
            <Text className="text-xs font-medium text-primary">Reset</Text>
          </Touchable>
        </View>
      ) : null}

      {changes.isLoading ? (
        <View className="flex-1 p-4">
          <SkeletonList rows={4} />
        </View>
      ) : changes.isError ? (
        <View className="flex-1">
          <ErrorState message="Could not load changes." onRetry={changes.refetch} />
        </View>
      ) : !changes.hasGit ? (
        <View className="flex-1">
          <EmptyState
            compact
            title="Not a git repository"
            message="This workspace has no git history, so there is nothing to diff."
          />
        </View>
      ) : changes.files.length === 0 ? (
        <View className="flex-1">
          <EmptyState
            title="No changes yet"
            message="Files the agent creates or edits show up here as it works."
            icon={<FileDiffIcon size={22} color={colors['muted-foreground']} />}
          />
        </View>
      ) : (
        <View className="flex-1">
          <ChangesList
            workspaceId={workspaceId}
            files={changes.files}
            base={base}
            expanded={expanded}
            onToggle={toggle}
            threadsByFile={review.byFile}
            multiMount={multiMount}
            onOpenFile={(row) => openDetail(row.path, row.alias)}
            {...(onOpenInFiles ? { onOpenInFiles: (row: ChangeRow) => onOpenInFiles(row.path, row.alias) } : {})}
            {...(restoreCap.available ? { onDiscard: discard } : {})}
            discarding={restore.isPending}
            {...(review.canWrite ? { onComment: commentOn } : {})}
            onOpenThreads={openThreadsAt}
            commentDisabledReason={commentDisabledReason}
            onRefresh={changes.refetch}
            refreshing={changes.isFetching && !changes.isLoading}
          />
        </View>
      )}

      {counts.pending > 0 ? (
        <View className="flex-row items-center gap-2 border-t border-border-muted bg-accent px-3 py-2">
          <MessageSquare size={14} color={colors.primary} />
          <Text className="flex-1 text-xs font-medium text-foreground" numberOfLines={1}>
            {batchSummary(counts)}
          </Text>
          <Button label="Review" size="sm" variant="ghost" onPress={() => setReviewSheet({})} />
          {review.canSend ? (
            <Button
              label="Send to agent"
              size="sm"
              icon={<Send size={14} color={colors['primary-foreground']} />}
              loading={review.submit.isPending}
              onPress={() => {
                haptics.success();
                review.submit.mutate({});
              }}
            />
          ) : null}
        </View>
      ) : null}

      <CommitBar
        workspaceId={workspaceId}
        fileCount={changes.files.length}
        chatId={chatId}
        active={active}
      />
      {sheets}
    </View>
  );
}
