// ────────────────────────────────────────────────────────────────
// ChangesList — the file list every Changes surface shares.
//
// Summary-first: the list carries per-file stats and blob SHAs, and a file's
// diff is fetched only when its row expands (inline, capped) or opens full
// screen. A run touching 300 files must not pull 300 patches to render a
// list.
//
// Long-press a row for the file menu: open full screen, open in Files, copy
// path, discard. Discard is the one destructive action here, so it confirms
// through a sheet and is itself undoable (the server snapshots first).
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, ChevronRight, Copy, FolderOpen, Maximize2, Undo2 } from 'lucide-react-native';
import type { ReviewThread } from '@generatorai/client-core';

import { useTheme } from '../../theme/ThemeProvider';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { ConfirmSheet } from '../ui/ActionSheet';
import { IconButton } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { FileDiff, type CommentRequest } from './FileDiff';
import { STATUS_BG, STATUS_LETTER, STATUS_TITLE, STATUS_TONE, splitPath } from './statusStyle';
import type { DiffSide } from './diffModel';
import type { ChangeRow } from './useChangesSummary';

export interface ChangesListProps {
  workspaceId: string;
  files: readonly ChangeRow[];
  base?: string;
  /** Ids (`alias:path`) whose diff is open inline. */
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Open threads per file id, for the badge and the inline markers. */
  threadsByFile?: ReadonlyMap<string, ReviewThread[]>;
  onOpenFile: (row: ChangeRow) => void;
  onOpenInFiles?: (row: ChangeRow) => void;
  /** Absent when the device cannot restore checkpoints. */
  onDiscard?: (row: ChangeRow) => void;
  discarding?: boolean;
  onComment?: (row: ChangeRow, request: CommentRequest) => void;
  onOpenThreads?: (row: ChangeRow, side: DiffSide, line: number) => void;
  commentDisabledReason?: string | null;
  /** Show the mount alias on every row (more than one mount). */
  multiMount?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function ChangesList({
  workspaceId,
  files,
  base = 'baseline',
  expanded,
  onToggle,
  threadsByFile,
  onOpenFile,
  onOpenInFiles,
  onDiscard,
  discarding = false,
  onComment,
  onOpenThreads,
  commentDisabledReason,
  multiMount = false,
  ListHeaderComponent,
  ListFooterComponent,
  onRefresh,
  refreshing = false,
}: ChangesListProps): React.ReactElement {
  const [confirmDiscard, setConfirmDiscard] = useState<ChangeRow | null>(null);

  return (
    <>
      <LegendList
        data={files}
        keyExtractor={(row) => row.id}
        estimatedItemSize={62}
        // Rows close over `expanded` and the thread map, none of which are in
        // `data`. Without this the list keeps the rows it already built and
        // expanding a file does nothing on screen.
        extraData={`${[...expanded].join()}|${threadsByFile?.size ?? 0}|${discarding}`}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={ListHeaderComponent ?? null}
        ListFooterComponent={ListFooterComponent ?? null}
        {...(onRefresh ? { onRefresh, refreshing } : {})}
        renderItem={({ item }) => (
          <FileRow
            row={item}
            workspaceId={workspaceId}
            base={base}
            multiMount={multiMount}
            expanded={expanded.has(item.id)}
            threads={threadsByFile?.get(item.id)}
            onToggle={onToggle}
            onOpen={onOpenFile}
            onOpenInFiles={onOpenInFiles}
            onAskDiscard={onDiscard ? setConfirmDiscard : undefined}
            onComment={onComment}
            onOpenThreads={onOpenThreads}
            commentDisabledReason={commentDisabledReason ?? null}
          />
        )}
      />
      <ConfirmSheet
        visible={confirmDiscard !== null}
        onClose={() => setConfirmDiscard(null)}
        title={confirmDiscard ? `Discard changes to ${splitPath(confirmDiscard.path).name}?` : 'Discard?'}
        message="The file goes back to the compare base. A snapshot is saved first, so this can be undone from Checkpoints."
        confirmLabel="Discard changes"
        onConfirm={() => {
          if (confirmDiscard && onDiscard) onDiscard(confirmDiscard);
          setConfirmDiscard(null);
        }}
      />
    </>
  );
}

const FileRow = React.memo(function FileRow({
  row,
  workspaceId,
  base,
  multiMount,
  expanded,
  threads,
  onToggle,
  onOpen,
  onOpenInFiles,
  onAskDiscard,
  onComment,
  onOpenThreads,
  commentDisabledReason,
}: {
  row: ChangeRow;
  workspaceId: string;
  base: string;
  multiMount: boolean;
  expanded: boolean;
  threads: ReviewThread[] | undefined;
  onToggle: (id: string) => void;
  onOpen: (row: ChangeRow) => void;
  onOpenInFiles: ((row: ChangeRow) => void) | undefined;
  onAskDiscard: ((row: ChangeRow) => void) | undefined;
  onComment: ((row: ChangeRow, request: CommentRequest) => void) | undefined;
  onOpenThreads: ((row: ChangeRow, side: DiffSide, line: number) => void) | undefined;
  commentDisabledReason: string | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const toast = useToast();
  const { name, dir } = splitPath(row.path);
  const readable = !row.isBinary && !row.isTooLarge;
  const openThreads = (threads ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'outdated').length;

  const menuItems: ContextMenuItem[] = [
    ...(readable
      ? [
          {
            label: 'Open full screen',
            icon: <Maximize2 size={18} color={colors.foreground} />,
            onPress: () => onOpen(row),
          },
        ]
      : []),
    ...(onOpenInFiles && row.status !== 'deleted'
      ? [
          {
            label: 'Open in Files',
            icon: <FolderOpen size={18} color={colors.foreground} />,
            onPress: () => onOpenInFiles(row),
          },
        ]
      : []),
    {
      label: 'Copy path',
      icon: <Copy size={18} color={colors.foreground} />,
      onPress: () => {
        void Clipboard.setStringAsync(row.path);
        toast({ message: 'Path copied', tone: 'success' });
      },
    },
    ...(onAskDiscard
      ? [
          {
            label: 'Discard changes…',
            destructive: true,
            icon: <Undo2 size={18} color={colors.danger} />,
            onPress: () => onAskDiscard(row),
          },
        ]
      : []),
  ];

  const comment = useCallback(
    (request: CommentRequest) => onComment?.(row, request),
    [onComment, row],
  );
  const openThreadsAt = useCallback(
    (side: DiffSide, line: number) => onOpenThreads?.(row, side, line),
    [onOpenThreads, row],
  );

  return (
    <View className="border-b border-border-muted">
      <View className="flex-row items-center">
        <ContextMenu
          items={menuItems}
          title={row.path}
          accessibilityLabel={`${STATUS_TITLE[row.status]} ${row.path}`}
          a11yRole="button"
          onPress={() => (readable ? onToggle(row.id) : onOpen(row))}
          className="min-h-14 flex-1 flex-row items-center gap-2.5 py-2 pl-3"
        >
          {readable ? (
            expanded ? (
              <ChevronDown size={14} color={colors['muted-foreground']} />
            ) : (
              <ChevronRight size={14} color={colors['muted-foreground']} />
            )
          ) : (
            <View className="w-3.5" />
          )}
          <View
            className={`h-5 w-5 items-center justify-center rounded ${STATUS_BG[row.status]}`}
            accessibilityLabel={STATUS_TITLE[row.status]}
          >
            <Text className={`font-mono text-xs font-bold ${STATUS_TONE[row.status]}`}>
              {STATUS_LETTER[row.status]}
            </Text>
          </View>
          <View className="flex-1">
            <Text numberOfLines={1} className="text-sm font-medium text-foreground">
              {row.oldPath ? (
                <Text className="text-muted-foreground line-through">
                  {splitPath(row.oldPath).name}
                  {' → '}
                </Text>
              ) : null}
              {name}
            </Text>
            <Text numberOfLines={1} className="text-xs text-muted-foreground">
              {multiMount && row.alias !== '.' ? `${row.alias}/` : ''}
              {dir || '·'}
            </Text>
          </View>
          {openThreads > 0 ? (
            <View className="rounded-full bg-accent px-1.5 py-0.5">
              <Text className="text-xs text-primary">{openThreads}</Text>
            </View>
          ) : null}
          {row.isBinary ? (
            <Text className="text-xs text-muted-foreground">binary</Text>
          ) : row.isTooLarge ? (
            <Text className="text-xs text-muted-foreground">too large</Text>
          ) : (
            <View className="flex-row gap-1.5">
              <Text className="font-mono text-xs text-success">+{row.additions}</Text>
              <Text className="font-mono text-xs text-danger">−{row.deletions}</Text>
            </View>
          )}
        </ContextMenu>
        {readable ? (
          <IconButton
            accessibilityLabel={`Open ${row.path} full screen`}
            icon={<Maximize2 size={14} color={colors['muted-foreground']} />}
            onPress={() => onOpen(row)}
          />
        ) : null}
      </View>

      {expanded && readable ? (
        <FileDiff
          workspaceId={workspaceId}
          path={row.path}
          alias={row.alias}
          base={base}
          embedded
          {...(row.oldBlob ? { oldBlob: row.oldBlob } : {})}
          {...(row.newBlob ? { newBlob: row.newBlob } : {})}
          {...(row.lang ? { lang: row.lang } : {})}
          {...(threads ? { threads } : {})}
          {...(onComment ? { onComment: comment } : {})}
          {...(onOpenThreads ? { onOpenThreads: openThreadsAt } : {})}
          onOpenFull={() => onOpen(row)}
          commentDisabledReason={commentDisabledReason}
        />
      ) : null}
    </View>
  );
});
