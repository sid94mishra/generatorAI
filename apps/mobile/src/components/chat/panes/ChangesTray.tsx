// ────────────────────────────────────────────────────────────────
// ChangesTray — "what has this chat changed so far", docked on the composer.
//
// The mobile port of desktop's ChatChangesTray:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ › ◫ 2 files changed +39 −2            ✓  ↺  [ Review ]   │
//   ├──────────────────────────────────────────────────────────┤
//   │   ▸ src/pricing                                          │
//   │       discounts.js                           M  +2 −2    │
//   │   ▸ test                                                 │
//   │       discounts.test.js                      A  +37 −0   │
//   └──────────────────────────────────────────────────────────┘
//
// A card inset like the composer below it (12pt corners, as desktop's tray), not a full-width strip
// between two hairlines. Tapping the header expands a folder tree of the
// changed files (desktop's tree, single-child folders collapsed), capped at
// a fixed height and scrolled beyond it, so a hundred-file change never
// pushes the composer off screen. Expanded, it also offers desktop's
// bulk review: a tick keeps every file, a rewind undoes them all (after a
// confirmation; a snapshot is written first, so even that can be rewound).
// "Review" opens the Changes pane; a file opens that file there.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronRight, FileDiff, FileText, Folder, Undo2 } from 'lucide-react-native';
import type { ChangeFileEntry, ChangeSummary } from '@generatorai/client-core';

import { useApi } from '../../../api/useApi';
import { useCapability } from '../../review';
import { scmKeys } from '../../scm/api';
import { ConfirmSheet } from '../../ui/ActionSheet';
import { Collapsible, useChevronTurn } from '../../ui/Collapsible';
import { IconButton } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { Touchable } from '../../ui/Touchable';
import { MAX_SCALE } from '../../ui/accessibility';
import { haptics } from '../../ui/haptics';
import { useTheme } from '../../../theme/ThemeProvider';
import { useChatMotion } from '../chatMotion';
import { changeTreeRows } from './changeTree';

/** Tallest the file list grows before it scrolls — about seven rows. */
const LIST_MAX_HEIGHT = 232;
const ROW_HEIGHT = 32;
const INDENT = 14;

const STATUS_LETTER: Record<ChangeFileEntry['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_BG: Record<ChangeFileEntry['status'], string> = {
  added: 'bg-success-muted',
  modified: 'bg-warning-muted',
  deleted: 'bg-danger-muted',
  renamed: 'bg-info-muted',
};

const STATUS_TEXT: Record<ChangeFileEntry['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};

interface TrayFile {
  /** Display path: alias-prefixed when the chat has more than one mount. */
  path: string;
  /** What `onOpenFile` takes — the path the Changes pane focuses on. */
  openPath: string;
  entry: ChangeFileEntry;
}

export function ChangesTray({
  workspaceId,
  summary,
  onReview,
  onOpenFile,
}: {
  workspaceId: string | null;
  summary: ChangeSummary | undefined;
  onReview: () => void;
  onOpenFile: (path: string) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const motion = useChatMotion();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const restoreCap = useCapability('restoreCheckpoints');
  const [expanded, setExpanded] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const turn = useChevronTurn(expanded);

  const files = useMemo<TrayFile[]>(() => {
    if (!summary) return [];
    const multi = summary.repos.length > 1;
    return summary.repos.flatMap((repo) =>
      repo.files.map((entry) => ({
        path: multi ? `${repo.alias}/${entry.path}` : entry.path,
        openPath: entry.path,
        entry,
      })),
    );
  }, [summary]);
  const rows = useMemo(() => changeTreeRows(files), [files]);
  const keptCount = useMemo(() => files.filter((f) => f.entry.kept).length, [files]);

  const refresh = useCallback(() => {
    if (!workspaceId) return;
    void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
  }, [queryClient, workspaceId]);

  const keepAll = useMutation({
    mutationFn: () => api.workspaces.reviewChanges(workspaceId!, { keepAll: true }),
    onSuccess: () => {
      refresh();
      toast({ message: 'Kept every changed file', tone: 'success' });
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Could not keep the changes', tone: 'error' }),
  });
  const undoAll = useMutation({
    mutationFn: () => api.workspaces.discardChanges(workspaceId!, { all: true }),
    onSuccess: (result) => {
      refresh();
      const failed = result.mounts.find((m) => !m.ok);
      if (failed?.error) toast({ message: failed.error, tone: 'error' });
      else toast({ message: 'Undid every change. A snapshot was saved first.', tone: 'success' });
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? err.message : 'Could not undo the changes', tone: 'error' }),
  });
  const busy = keepAll.isPending || undoAll.isPending;

  if (!summary || summary.stats.files === 0) return null;
  const { stats } = summary;
  const label =
    keptCount > 0 && keptCount < files.length
      ? `${files.length - keptCount} to review · ${keptCount} kept`
      : `${stats.files} ${stats.files === 1 ? 'file' : 'files'} changed`;
  const allKept = files.length > 0 && keptCount === files.length;

  return (
    <Animated.View
      entering={motion.fadeIn(160)}
      exiting={motion.fadeOut(120)}
      // No layout transition: when a gate card enters the dock beneath it,
      // Reanimated's LinearTransition leaves this box stranded at its
      // pre-layout offset on Android, drawn UNDER the card it should sit above.
      style={{ marginHorizontal: 12, marginTop: 8 }}
    >
      {/* Desktop's tray: a card with 12pt corners and a hairline border. */}
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <View className="min-h-11 flex-row items-center gap-1 pr-1.5">
          <Touchable
            testID="changes-tray-toggle"
            accessibilityLabel={`${label}, ${stats.additions} added, ${stats.deletions} removed${expanded ? ', collapse' : ', expand'}`}
            accessibilityState={{ expanded }}
            haptic="select"
            ripple={false}
            scale="none"
            onPress={() => setExpanded((v) => !v)}
            className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2 pl-3 pr-1"
          >
            <Animated.View style={turn}>
              <ChevronRight size={14} color={colors['muted-foreground']} />
            </Animated.View>
            <FileDiff size={14} color={colors.primary} />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="shrink text-sm font-medium text-foreground"
            >
              {label}
            </Text>
            <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="font-mono text-xs">
              <Text className="text-success">+{stats.additions}</Text>{' '}
              <Text className="text-danger">−{stats.deletions}</Text>
            </Text>
          </Touchable>

          {expanded && workspaceId ? (
            <>
              <IconButton
                testID="changes-tray-keep-all"
                accessibilityLabel="Keep all changes"
                accessibilityHint="Marks every changed file as reviewed"
                variant="ghost"
                compact
                disabled={busy || allKept}
                icon={<CheckCheck size={17} color={busy || allKept ? colors['muted-foreground'] : colors.success} />}
                onPress={() => {
                  haptics.select();
                  keepAll.mutate();
                }}
              />
              {restoreCap.available ? (
                <IconButton
                  testID="changes-tray-undo-all"
                  accessibilityLabel="Undo all changes"
                  accessibilityHint="Restores every changed file to where this chat started"
                  variant="ghost"
                  compact
                  disabled={busy}
                  icon={<Undo2 size={17} color={busy ? colors['muted-foreground'] : colors.danger} />}
                  onPress={() => {
                    haptics.warn();
                    setConfirmUndo(true);
                  }}
                />
              ) : null}
            </>
          ) : null}

          <Touchable
            testID="changes-tray-review"
            accessibilityLabel="Review changes"
            accessibilityHint="Opens the Changes pane"
            haptic="tap"
            scale="none"
            onPress={onReview}
            className="h-8 flex-row items-center gap-1.5 rounded-lg bg-control px-2.5"
          >
            <FileDiff size={13} color={colors.primary} />
            <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-semibold text-primary">
              Review
            </Text>
          </Touchable>
        </View>

        <Collapsible open={expanded} className="border-t border-border-muted">
          <ScrollView
            style={{ maxHeight: LIST_MAX_HEIGHT }}
            contentContainerStyle={{ paddingVertical: 4 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {rows.map((row) =>
              row.kind === 'dir' ? (
                <View
                  key={row.key}
                  accessibilityRole="header"
                  className="flex-row items-center gap-1.5 pr-3"
                  style={{ height: ROW_HEIGHT - 6, paddingLeft: 12 + row.depth * INDENT }}
                >
                  <Folder size={13} color={colors['muted-foreground']} />
                  <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
                    {row.label}
                  </Text>
                </View>
              ) : (
                <Touchable
                  key={row.key}
                  accessibilityLabel={`${row.file!.entry.status} ${row.file!.path}, ${row.file!.entry.additions} added, ${row.file!.entry.deletions} removed`}
                  accessibilityHint="Opens this file in Changes"
                  haptic="tap"
                  ripple={false}
                  scale="none"
                  onPress={() => onOpenFile(row.file!.openPath)}
                  className="flex-row items-center gap-2 pr-3"
                  style={{ minHeight: ROW_HEIGHT, paddingLeft: 12 + row.depth * INDENT }}
                >
                  <FileText size={13} color={colors['muted-foreground']} />
                  <Text numberOfLines={1} className="min-w-0 flex-1 font-mono text-xs text-foreground">
                    {row.label}
                  </Text>
                  <View className={`h-4 w-4 items-center justify-center rounded ${STATUS_BG[row.file!.entry.status]}`}>
                    <Text className={`text-[9px] font-bold ${STATUS_TEXT[row.file!.entry.status]}`}>
                      {STATUS_LETTER[row.file!.entry.status]}
                    </Text>
                  </View>
                  <Text className="w-16 text-right font-mono text-xs">
                    <Text className="text-success">+{row.file!.entry.additions}</Text>{' '}
                    <Text className="text-danger">−{row.file!.entry.deletions}</Text>
                  </Text>
                </Touchable>
              ),
            )}
          </ScrollView>
        </Collapsible>
      </View>

      <ConfirmSheet
        visible={confirmUndo}
        onClose={() => setConfirmUndo(false)}
        title="Undo all changes?"
        message="Every changed file in this chat goes back to where the chat started. A snapshot is written first, so this can still be rewound."
        confirmLabel="Undo all"
        onConfirm={() => {
          setConfirmUndo(false);
          undoAll.mutate();
        }}
      />
    </Animated.View>
  );
}
